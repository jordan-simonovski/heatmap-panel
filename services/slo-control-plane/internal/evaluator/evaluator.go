package evaluator

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"strings"
	"time"

	_ "github.com/ClickHouse/clickhouse-go/v2"
	"github.com/google/uuid"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/store"
	"github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/telemetry"
)

type Config struct {
	Interval              time.Duration
	ContinueInterval      time.Duration
	FastWindowMinutes     int
	SlowWindowMinutes     int
	FastBurnRateThreshold float64
	SlowBurnRateThreshold float64
}

type Evaluator struct {
	store *store.Store
	chDB  *sql.DB
	cfg   Config
}

func New(st *store.Store, clickhouseDSN string, cfg Config) (*Evaluator, error) {
	ch, err := sql.Open("clickhouse", clickhouseDSN)
	if err != nil {
		return nil, err
	}
	if cfg.FastWindowMinutes <= 0 {
		cfg.FastWindowMinutes = 5
	}
	if cfg.SlowWindowMinutes <= 0 {
		cfg.SlowWindowMinutes = 60
	}
	if cfg.FastBurnRateThreshold <= 0 {
		cfg.FastBurnRateThreshold = 14.4
	}
	if cfg.SlowBurnRateThreshold <= 0 {
		cfg.SlowBurnRateThreshold = 2.0
	}
	return &Evaluator{
		store: st,
		chDB:  ch,
		cfg:   cfg,
	}, nil
}

func (e *Evaluator) Close() error {
	return e.chDB.Close()
}

func (e *Evaluator) Run(ctx context.Context) {
	t := time.NewTicker(e.cfg.Interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			_ = e.EvaluateOnce(ctx)
		}
	}
}

func (e *Evaluator) EvaluateOnce(ctx context.Context) error {
	tr := otel.Tracer("slo-control-plane/evaluator")
	ctx, span := tr.Start(ctx, "evaluator.evaluate_once", trace.WithSpanKind(trace.SpanKindInternal))
	defer span.End()

	slos, err := e.store.ListAllSLOs(ctx)
	if err != nil {
		telemetry.RecordSpanError(span, err)
		return err
	}
	span.SetAttributes(attribute.Int("slo.count", len(slos)))
	now := time.Now().UTC()
	evaluated := 0
	for _, slo := range slos {
		if slo.DatasourceType != "clickhouse" {
			continue
		}
		def, ok := parseSLIDefinition(slo)
		if !ok {
			continue
		}
		fastWindow := minPositive(def.WindowMinutes, e.cfg.FastWindowMinutes)
		slowWindow := minPositive(def.WindowMinutes, e.cfg.SlowWindowMinutes)
		fastCompliance, err := e.queryCompliance(ctx, def, fastWindow)
		if err != nil {
			continue
		}
		slowCompliance, err := e.queryCompliance(ctx, def, slowWindow)
		if err != nil {
			continue
		}
		fastBurnRate := burnRate(fastCompliance, float64(slo.Target))
		slowBurnRate := burnRate(slowCompliance, float64(slo.Target))
		severity := classifySeverity(fastBurnRate, slowBurnRate, e.cfg.FastBurnRateThreshold, e.cfg.SlowBurnRateThreshold)

		currentCompliance := slowCompliance
		currentBurnRate := slowBurnRate
		currentThreshold := e.cfg.SlowBurnRateThreshold
		currentWindowMin := slowWindow
		if severity == severityFast {
			currentCompliance = fastCompliance
			currentBurnRate = fastBurnRate
			currentThreshold = e.cfg.FastBurnRateThreshold
			currentWindowMin = fastWindow
		}

		if err := e.persistEvaluation(ctx, slo, currentCompliance, severity, currentBurnRate, currentThreshold, currentWindowMin, now); err != nil {
			continue
		}
		span.AddEvent("slo.evaluated", trace.WithAttributes(
			attribute.String("slo.id", slo.ID.String()),
			attribute.String("slo.name", slo.Name),
			attribute.String("slo.datasource_type", slo.DatasourceType),
			attribute.String("slo.severity", string(severity)),
			attribute.Float64("slo.compliance", currentCompliance),
			attribute.Float64("slo.burn_rate", currentBurnRate),
		))
		evaluated++
	}
	span.SetAttributes(attribute.Int("slo.evaluated_count", evaluated))
	return nil
}

func (e *Evaluator) persistEvaluation(
	ctx context.Context,
	slo store.SLO,
	compliance float64,
	severity burnSeverity,
	burnRate float64,
	burnThreshold float64,
	burnWindowMin int,
	now time.Time,
) error {
	tx, err := e.store.BeginTx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	prev, hasPrev, err := e.store.GetBurnStateForUpdate(ctx, tx, slo.ID)
	if err != nil {
		return err
	}

	lastContinuedAt := time.Time{}
	if hasPrev && prev.LastContinuedAt.Valid {
		lastContinuedAt = prev.LastContinuedAt.Time
	}
	action := decideAction(decideInput{
		Now:              now,
		SeverityNow:      severity,
		ContinueInterval: e.cfg.ContinueInterval,
		HasPrevState:     hasPrev,
		PrevIsBurning:    hasPrev && prev.IsBurning,
		PrevSeverity:     burnSeverity(prev.CurrentSeverity),
		LastContinuedAt:  lastContinuedAt,
	})

	next := store.BurnState{
		SLOID:             slo.ID,
		IsBurning:         severity != severityNone,
		CurrentSeverity:   string(severity),
		CurrentCompliance: float32(compliance),
		CurrentBurnRate:   float32(burnRate),
		LastTransitionAt:  prev.LastTransitionAt,
		LastContinuedAt:   prev.LastContinuedAt,
		LastEvaluatedAt:   now,
	}
	etaSeconds := timeToExhaustionSeconds(burnRate, burnWindowMin)
	if etaSeconds > 0 {
		next.ETAExhaustionSec = sql.NullInt32{Valid: true, Int32: int32(etaSeconds)}
	}

	if !hasPrev {
		next.LastTransitionAt = sql.NullTime{}
		next.LastContinuedAt = sql.NullTime{}
		next.BreachTransitionAt = sql.NullTime{}
	}

	exhaustionThreshold := float64(slo.Target) - (1.0 - float64(slo.Target))
	isBreached := compliance <= exhaustionThreshold
	next.IsBreached = isBreached
	if hasPrev {
		next.BreachTransitionAt = prev.BreachTransitionAt
	}

	if action.EmitEvent {
		if action.EventType == "burn_started" || action.EventType == "burn_resolved" {
			next.LastTransitionAt = sql.NullTime{Valid: true, Time: now}
		}
		if action.EventType == "burn_continued" {
			next.LastContinuedAt = sql.NullTime{Valid: true, Time: now}
		}

		idempotencyKey := buildIdempotencyKey(action.EventType, severity, slo.ID, now)
		err = e.store.EnqueueOutbox(ctx, tx, "slo", slo.ID, action.EventType, map[string]any{
			"serviceId":            slo.ServiceID.String(),
			"sloId":                slo.ID.String(),
			"eventType":            action.EventType,
			"value":                burnRate,
			"threshold":            burnThreshold,
			"source":               "slo-evaluator:" + string(severity),
			"severity":             string(severity),
			"etaExhaustionSeconds": etaSeconds,
			"evaluatedAt":          now.Format(time.RFC3339),
		}, idempotencyKey)
		if err != nil {
			return err
		}
	}
	wasBreached := hasPrev && prev.IsBreached
	if !hasPrev {
		wasBreached = false
	}
	if wasBreached != isBreached {
		next.BreachTransitionAt = sql.NullTime{Valid: true, Time: now}
		eventType := "error_budget_recovered"
		if isBreached {
			eventType = "error_budget_exhausted"
		}
		idempotencyKey := buildIdempotencyKey(eventType, severity, slo.ID, now)
		err = e.store.EnqueueOutbox(ctx, tx, "slo", slo.ID, eventType, map[string]any{
			"serviceId":            slo.ServiceID.String(),
			"sloId":                slo.ID.String(),
			"eventType":            eventType,
			"value":                burnRate,
			"threshold":            burnThreshold,
			"source":               "slo-evaluator:breach",
			"severity":             "critical",
			"etaExhaustionSeconds": etaSeconds,
			"evaluatedAt":          now.Format(time.RFC3339),
		}, idempotencyKey)
		if err != nil {
			return err
		}
	}

	if err := e.store.UpsertBurnStateTx(ctx, tx, next); err != nil {
		return err
	}
	return tx.Commit()
}

func buildIdempotencyKey(eventType string, severity burnSeverity, sloID uuid.UUID, ts time.Time) string {
	minuteBucket := ts.UTC().Truncate(time.Minute).Unix()
	return fmt.Sprintf("evaluator:%s:%s:%s:%d", eventType, severity, sloID.String(), minuteBucket)
}

type sliDefinition struct {
	SLOID         uuid.UUID
	Route         string
	Type          string
	Threshold     float64
	WindowMinutes int
	Target        float64
}

func parseSLIDefinition(slo store.SLO) (sliDefinition, bool) {
	def := sliDefinition{
		SLOID:         slo.ID,
		WindowMinutes: slo.WindowMinutes,
		Target:        float64(slo.Target),
	}
	def.Route = strings.TrimSpace(stringFromAny(slo.Canonical["route"]))
	def.Type = strings.TrimSpace(stringFromAny(slo.Canonical["type"]))
	def.Threshold = numberFromAny(slo.Canonical["threshold"])
	if w := int(numberFromAny(slo.Canonical["windowMinutes"])); w > 0 {
		def.WindowMinutes = w
	}
	if t := numberFromAny(slo.Canonical["target"]); t > 0 {
		def.Target = t
	}

	if def.Route == "" || def.Type == "" || def.Threshold <= 0 {
		return sliDefinition{}, false
	}
	return def, true
}

func (e *Evaluator) queryCompliance(ctx context.Context, def sliDefinition, windowMinutes int) (float64, error) {
	route := strings.ReplaceAll(def.Route, "'", "\\'")
	var sqlText string
	if def.Type == "latency" {
		sqlText = fmt.Sprintf(`SELECT
  if(count() = 0, 1.0, 1 - (countIf(p99_ms > %f) / count())) AS compliance
FROM (
  SELECT quantile(0.99)(Duration / 1000000) AS p99_ms
  FROM otel_traces
  WHERE Timestamp >= now() - INTERVAL %d MINUTE
    AND SpanAttributes['http.route'] = '%s'
    AND ServiceName = 'api-gateway'
  GROUP BY toStartOfInterval(Timestamp, INTERVAL 1 minute)
)`, def.Threshold, windowMinutes, route)
	} else {
		sqlText = fmt.Sprintf(`SELECT
  if(count() = 0, 1.0, 1 - (countIf(err_rate > %f) / count())) AS compliance
FROM (
  SELECT countIf(toInt32OrZero(SpanAttributes['http.status_code']) >= 500) / count() AS err_rate
  FROM otel_traces
  WHERE Timestamp >= now() - INTERVAL %d MINUTE
    AND SpanAttributes['http.route'] = '%s'
    AND ServiceName = 'api-gateway'
  GROUP BY toStartOfInterval(Timestamp, INTERVAL 1 minute)
)`, def.Threshold, windowMinutes, route)
	}

	var compliance float64
	if err := e.chDB.QueryRowContext(ctx, sqlText).Scan(&compliance); err != nil {
		return 0, err
	}
	return compliance, nil
}

type burnSeverity string

const (
	severityNone burnSeverity = "none"
	severitySlow burnSeverity = "slow"
	severityFast burnSeverity = "fast"
)

func burnRate(compliance float64, target float64) float64 {
	if target >= 1.0 {
		return 0
	}
	errorBudget := 1.0 - target
	if errorBudget <= 0 {
		return 0
	}
	consumed := math.Max(target-compliance, 0)
	return consumed / errorBudget
}

func classifySeverity(fastRate, slowRate, fastThreshold, slowThreshold float64) burnSeverity {
	if fastRate >= fastThreshold {
		return severityFast
	}
	if slowRate >= slowThreshold {
		return severitySlow
	}
	return severityNone
}

func minPositive(a, b int) int {
	if a <= 0 {
		return b
	}
	if b <= 0 {
		return a
	}
	if a < b {
		return a
	}
	return b
}

func timeToExhaustionSeconds(burnRate float64, windowMinutes int) int {
	if burnRate <= 0 || windowMinutes <= 0 {
		return 0
	}
	seconds := float64(windowMinutes*60) / burnRate
	if seconds <= 0 {
		return 0
	}
	return int(math.Ceil(seconds))
}

func numberFromAny(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case float32:
		return float64(n)
	case int:
		return float64(n)
	default:
		return 0
	}
}

func stringFromAny(v any) string {
	switch s := v.(type) {
	case string:
		return s
	default:
		return ""
	}
}
