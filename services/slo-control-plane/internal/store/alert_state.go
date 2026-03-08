package store

import (
	"context"
	"database/sql"
	"time"

	"github.com/google/uuid"
)

const (
	AlertKindBurn   = "burn"
	AlertKindBreach = "breach"
)

type AlertState struct {
	ID                  uuid.UUID
	SLOID               uuid.UUID
	AlertKind           string
	GrafanaRuleUID      string
	GrafanaNamespaceUID string
	GrafanaRuleGroup    string
	LastAppliedSpecHash string
	Status              string
	LastError           string
	LastReconciledAt    sql.NullTime
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

type AlertReconcileAttempt struct {
	ID         uuid.UUID
	SLOID      uuid.UUID
	AlertKind  string
	Success    bool
	DurationMs int
	ErrorText  string
	AttemptedAt time.Time
}

type SLOReconcileInput struct {
	SLO
	ServiceMetadata map[string]any
	BurnState       *BurnState
}

func (s *Store) UpsertAlertStateTx(ctx context.Context, tx *sql.Tx, st AlertState) (AlertState, error) {
	var out AlertState
	var lastErr sql.NullString
	err := tx.QueryRowContext(ctx, `
		INSERT INTO slo_alert_state (
			id, slo_id, alert_kind, grafana_rule_uid, grafana_namespace_uid, grafana_rule_group,
			last_applied_spec_hash, status, last_error, last_reconciled_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		ON CONFLICT (slo_id, alert_kind) DO UPDATE
		SET grafana_rule_uid = EXCLUDED.grafana_rule_uid,
		    grafana_namespace_uid = EXCLUDED.grafana_namespace_uid,
		    grafana_rule_group = EXCLUDED.grafana_rule_group,
		    last_applied_spec_hash = EXCLUDED.last_applied_spec_hash,
		    status = EXCLUDED.status,
		    last_error = EXCLUDED.last_error,
		    last_reconciled_at = EXCLUDED.last_reconciled_at,
		    updated_at = now()
		RETURNING id, slo_id, alert_kind, grafana_rule_uid, grafana_namespace_uid, grafana_rule_group,
		          last_applied_spec_hash, status, last_error, last_reconciled_at, created_at, updated_at
	`, st.ID, st.SLOID, st.AlertKind, st.GrafanaRuleUID, st.GrafanaNamespaceUID, st.GrafanaRuleGroup,
		st.LastAppliedSpecHash, st.Status, nullableStr(st.LastError), nullableTime(st.LastReconciledAt)).
		Scan(&out.ID, &out.SLOID, &out.AlertKind, &out.GrafanaRuleUID, &out.GrafanaNamespaceUID, &out.GrafanaRuleGroup,
			&out.LastAppliedSpecHash, &out.Status, &lastErr, &out.LastReconciledAt, &out.CreatedAt, &out.UpdatedAt)
	out.LastError = nullStringToString(lastErr)
	return out, err
}

func (s *Store) GetAlertState(ctx context.Context, sloID uuid.UUID, alertKind string) (AlertState, error) {
	var st AlertState
	var lastErr sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT id, slo_id, alert_kind, grafana_rule_uid, grafana_namespace_uid, grafana_rule_group,
		       last_applied_spec_hash, status, last_error, last_reconciled_at, created_at, updated_at
		FROM slo_alert_state
		WHERE slo_id = $1 AND alert_kind = $2
	`, sloID, alertKind).Scan(
		&st.ID, &st.SLOID, &st.AlertKind, &st.GrafanaRuleUID, &st.GrafanaNamespaceUID, &st.GrafanaRuleGroup,
		&st.LastAppliedSpecHash, &st.Status, &lastErr, &st.LastReconciledAt, &st.CreatedAt, &st.UpdatedAt,
	)
	st.LastError = nullStringToString(lastErr)
	return st, err
}

func (s *Store) ListAlertStatesBySLO(ctx context.Context, sloID uuid.UUID) ([]AlertState, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, slo_id, alert_kind, grafana_rule_uid, grafana_namespace_uid, grafana_rule_group,
		       last_applied_spec_hash, status, last_error, last_reconciled_at, created_at, updated_at
		FROM slo_alert_state
		WHERE slo_id = $1
		ORDER BY alert_kind ASC
	`, sloID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []AlertState
	for rows.Next() {
		var st AlertState
		var lastErr sql.NullString
		if err := rows.Scan(
			&st.ID, &st.SLOID, &st.AlertKind, &st.GrafanaRuleUID, &st.GrafanaNamespaceUID, &st.GrafanaRuleGroup,
			&st.LastAppliedSpecHash, &st.Status, &lastErr, &st.LastReconciledAt, &st.CreatedAt, &st.UpdatedAt,
		); err != nil {
			return nil, err
		}
		st.LastError = nullStringToString(lastErr)
		out = append(out, st)
	}
	return out, rows.Err()
}

func (s *Store) DeleteAlertState(ctx context.Context, sloID uuid.UUID, alertKind string) error {
	res, err := s.db.ExecContext(ctx, `
		DELETE FROM slo_alert_state
		WHERE slo_id = $1 AND alert_kind = $2
	`, sloID, alertKind)
	if err != nil {
		return err
	}
	if rows, _ := res.RowsAffected(); rows == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) DeleteAlertStateByRuleUID(ctx context.Context, ruleUID string) error {
	res, err := s.db.ExecContext(ctx, `
		DELETE FROM slo_alert_state
		WHERE grafana_rule_uid = $1
	`, ruleUID)
	if err != nil {
		return err
	}
	if rows, _ := res.RowsAffected(); rows == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) ListOrphanedAlertStates(ctx context.Context) ([]AlertState, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT s.id, s.slo_id, s.alert_kind, s.grafana_rule_uid, s.grafana_namespace_uid, s.grafana_rule_group,
		       s.last_applied_spec_hash, s.status, s.last_error, s.last_reconciled_at, s.created_at, s.updated_at
		FROM slo_alert_state s
		LEFT JOIN slos o ON o.id = s.slo_id
		WHERE o.id IS NULL
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []AlertState
	for rows.Next() {
		var st AlertState
		var lastErr sql.NullString
		if err := rows.Scan(
			&st.ID, &st.SLOID, &st.AlertKind, &st.GrafanaRuleUID, &st.GrafanaNamespaceUID, &st.GrafanaRuleGroup,
			&st.LastAppliedSpecHash, &st.Status, &lastErr, &st.LastReconciledAt, &st.CreatedAt, &st.UpdatedAt,
		); err != nil {
			return nil, err
		}
		st.LastError = nullStringToString(lastErr)
		out = append(out, st)
	}
	return out, rows.Err()
}

func (s *Store) InsertAlertReconcileAttempt(ctx context.Context, a AlertReconcileAttempt) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO slo_alert_reconcile_attempts (
			id, slo_id, alert_kind, success, duration_ms, error_text, attempted_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7)
	`, a.ID, a.SLOID, a.AlertKind, a.Success, a.DurationMs, nullableStr(a.ErrorText), a.AttemptedAt)
	return err
}

func (s *Store) ListSLOReconcileInputs(ctx context.Context) ([]SLOReconcileInput, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT
			s.id, s.service_id, s.name, s.description, s.target, s.window_minutes, s.openslo_yaml,
			s.canonical_json, s.datasource_type, s.datasource_uid, s.created_at, s.updated_at,
			sv.metadata_json,
			bs.slo_id, bs.is_burning, bs.current_severity, bs.current_compliance, bs.current_burn_rate,
			bs.eta_exhaustion_seconds, bs.last_transition_at, bs.last_continued_at, bs.last_evaluated_at
		FROM slos s
		INNER JOIN services sv ON sv.id = s.service_id
		LEFT JOIN slo_burn_state bs ON bs.slo_id = s.id
		ORDER BY s.created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []SLOReconcileInput
	for rows.Next() {
		var in SLOReconcileInput
		var desc sql.NullString
		var canonical []byte
		var serviceMetadata []byte
		var bsSLOID uuid.NullUUID
		var bsIsBurning sql.NullBool
		var bsSeverity sql.NullString
		var bsCompliance sql.NullFloat64
		var bsBurnRate sql.NullFloat64
		var bsETA sql.NullInt32
		var bsTransition sql.NullTime
		var bsContinued sql.NullTime
		var bsEvaluated sql.NullTime
		if err := rows.Scan(
			&in.ID, &in.ServiceID, &in.Name, &desc, &in.Target, &in.WindowMinutes, &in.OpenSLO,
			&canonical, &in.DatasourceType, &in.DatasourceUID, &in.CreatedAt, &in.UpdatedAt,
			&serviceMetadata,
			&bsSLOID, &bsIsBurning, &bsSeverity, &bsCompliance, &bsBurnRate, &bsETA, &bsTransition, &bsContinued, &bsEvaluated,
		); err != nil {
			return nil, err
		}
		in.Description = nullStringToString(desc)
		in.Canonical = decodeJSONMap(canonical)
		in.ServiceMetadata = decodeJSONMap(serviceMetadata)
		if bsSLOID.Valid {
			bs := BurnState{
				SLOID:             bsSLOID.UUID,
				IsBurning:         bsIsBurning.Valid && bsIsBurning.Bool,
				CurrentSeverity:   bsSeverity.String,
				CurrentCompliance: float32(bsCompliance.Float64),
				CurrentBurnRate:   float32(bsBurnRate.Float64),
				ETAExhaustionSec:  bsETA,
				LastTransitionAt:  bsTransition,
				LastContinuedAt:   bsContinued,
			}
			if bsEvaluated.Valid {
				bs.LastEvaluatedAt = bsEvaluated.Time
			}
			in.BurnState = &bs
		}
		result = append(result, in)
	}
	return result, rows.Err()
}

func nullableTime(v sql.NullTime) any {
	if !v.Valid {
		return nil
	}
	return v.Time
}
