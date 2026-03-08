package reconciler

import (
	"context"
	"database/sql"
	"log"
	"time"

	"github.com/google/uuid"

	"github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/alerts/spec"
	"github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/grafana"
	"github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/store"
)

type Config struct {
	PollInterval       time.Duration
	BatchSize          int
	FolderUID          string
	GroupPrefix        string
	RuleIntervalSecond int
	DefaultLabels      map[string]string
	DefaultAnnotations map[string]string
}

type Worker struct {
	store   *store.Store
	grafana *grafana.Client
	cfg     Config
}

func NewWorker(st *store.Store, g *grafana.Client, cfg Config) *Worker {
	if cfg.PollInterval <= 0 {
		cfg.PollInterval = 30 * time.Second
	}
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 100
	}
	if cfg.RuleIntervalSecond <= 0 {
		cfg.RuleIntervalSecond = 60
	}
	return &Worker{store: st, grafana: g, cfg: cfg}
}

func (w *Worker) Run(ctx context.Context) {
	t := time.NewTicker(w.cfg.PollInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := w.ReconcileOnce(ctx); err != nil {
				log.Printf("alert reconciler failed: %v", err)
			}
		}
	}
}

func (w *Worker) ReconcileOnce(ctx context.Context) error {
	inputs, err := w.store.ListSLOReconcileInputs(ctx)
	if err != nil {
		return err
	}
	desiredRuleUIDs := map[string]struct{}{}
	for idx, in := range inputs {
		if idx >= w.cfg.BatchSize {
			break
		}
		desiredSpecs, err := spec.BuildDesiredRules(in, spec.BuildOptions{
			FolderUID:          w.cfg.FolderUID,
			GroupPrefix:        w.cfg.GroupPrefix,
			DefaultLabels:      w.cfg.DefaultLabels,
			DefaultAnnotations: w.cfg.DefaultAnnotations,
		})
		if err != nil {
			log.Printf("build desired rules failed slo=%s: %v", in.ID, err)
			continue
		}
		for _, ds := range desiredSpecs {
			desiredRuleUIDs[ds.RuleUID] = struct{}{}
		}
		if len(desiredSpecs) == 0 {
			continue
		}
		if err := w.applySLO(ctx, in.ID, desiredSpecs); err != nil {
			log.Printf("reconcile slo failed slo=%s: %v", in.ID, err)
		}
	}
	return w.garbageCollect(ctx, desiredRuleUIDs)
}

func (w *Worker) applySLO(ctx context.Context, sloID uuid.UUID, specs []spec.DesiredRuleSpec) error {
	start := time.Now()
	rules := make([]grafana.ProvisionedAlertRule, 0, len(specs))
	groupName := ""
	for _, ds := range specs {
		rules = append(rules, ds.Rule)
		groupName = ds.GroupName
	}
	err := w.grafana.UpsertRuleGroup(ctx, w.cfg.FolderUID, groupName, w.cfg.RuleIntervalSecond, rules)
	durationMs := int(time.Since(start).Milliseconds())
	for _, ds := range specs {
		_ = w.store.InsertAlertReconcileAttempt(ctx, store.AlertReconcileAttempt{
			ID:         uuid.New(),
			SLOID:      sloID,
			AlertKind:  ds.AlertKind,
			Success:    err == nil,
			DurationMs: durationMs,
			ErrorText:  errorText(err),
			AttemptedAt: time.Now().UTC(),
		})
		if upsertErr := w.upsertState(ctx, sloID, ds, err); upsertErr != nil {
			log.Printf("upsert alert state failed slo=%s kind=%s: %v", sloID, ds.AlertKind, upsertErr)
		}
	}
	return err
}

func (w *Worker) upsertState(ctx context.Context, sloID uuid.UUID, ds spec.DesiredRuleSpec, reconcileErr error) error {
	tx, err := w.store.BeginTx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	state := store.AlertState{
		ID:                  uuid.New(),
		SLOID:               sloID,
		AlertKind:           ds.AlertKind,
		GrafanaRuleUID:      ds.RuleUID,
		GrafanaNamespaceUID: w.cfg.FolderUID,
		GrafanaRuleGroup:    ds.GroupName,
		LastAppliedSpecHash: ds.SpecHash,
		Status:              "synced",
		LastReconciledAt:    sql.NullTime{Valid: true, Time: time.Now().UTC()},
	}
	if reconcileErr != nil {
		state.Status = "error"
		state.LastError = reconcileErr.Error()
	}
	if _, err := w.store.UpsertAlertStateTx(ctx, tx, state); err != nil {
		return err
	}
	return tx.Commit()
}

func (w *Worker) garbageCollect(ctx context.Context, keep map[string]struct{}) error {
	rules, err := w.grafana.ListRules(ctx)
	if err != nil {
		return err
	}
	managed := grafana.FilterRulesByLabels(rules, map[string]string{"managed_by": "slo-control-plane"})
	for _, rule := range managed {
		if _, ok := keep[rule.Uid]; ok {
			continue
		}
		if err := w.grafana.DeleteRule(ctx, rule.Uid); err != nil {
			log.Printf("delete orphaned grafana rule failed uid=%s: %v", rule.Uid, err)
			continue
		}
		_ = w.store.DeleteAlertStateByRuleUID(ctx, rule.Uid)
	}
	return nil
}

func errorText(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
