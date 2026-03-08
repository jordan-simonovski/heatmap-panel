package store

import (
	"context"
	"database/sql"
	"time"

	"github.com/google/uuid"
)

type BurnState struct {
	SLOID             uuid.UUID
	IsBurning         bool
	CurrentSeverity   string
	CurrentCompliance float32
	CurrentBurnRate   float32
	ETAExhaustionSec  sql.NullInt32
	LastTransitionAt  sql.NullTime
	LastContinuedAt   sql.NullTime
	LastEvaluatedAt   time.Time
}

func (s *Store) ListAllSLOs(ctx context.Context) ([]SLO, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, service_id, name, description, target, window_minutes, openslo_yaml, canonical_json,
		       datasource_type, datasource_uid, created_at, updated_at
		FROM slos
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []SLO
	for rows.Next() {
		var slo SLO
		var desc sql.NullString
		var canonical []byte
		if err := rows.Scan(
			&slo.ID, &slo.ServiceID, &slo.Name, &desc, &slo.Target, &slo.WindowMinutes, &slo.OpenSLO, &canonical,
			&slo.DatasourceType, &slo.DatasourceUID, &slo.CreatedAt, &slo.UpdatedAt,
		); err != nil {
			return nil, err
		}
		slo.Description = nullStringToString(desc)
		slo.Canonical = decodeJSONMap(canonical)
		result = append(result, slo)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (s *Store) GetBurnStateForUpdate(ctx context.Context, tx *sql.Tx, sloID uuid.UUID) (BurnState, bool, error) {
	var st BurnState
	st.SLOID = sloID

	err := tx.QueryRowContext(ctx, `
		SELECT slo_id, is_burning, current_severity, current_compliance, current_burn_rate, eta_exhaustion_seconds, last_transition_at, last_continued_at, last_evaluated_at
		FROM slo_burn_state
		WHERE slo_id = $1
		FOR UPDATE
	`, sloID).Scan(
		&st.SLOID, &st.IsBurning, &st.CurrentSeverity, &st.CurrentCompliance, &st.CurrentBurnRate, &st.ETAExhaustionSec, &st.LastTransitionAt, &st.LastContinuedAt, &st.LastEvaluatedAt,
	)
	if err == sql.ErrNoRows {
		return BurnState{}, false, nil
	}
	if err != nil {
		return BurnState{}, false, err
	}
	return st, true, nil
}

func (s *Store) UpsertBurnStateTx(ctx context.Context, tx *sql.Tx, st BurnState) error {
	var lastTransition any
	if st.LastTransitionAt.Valid {
		lastTransition = st.LastTransitionAt.Time
	}
	var lastContinued any
	if st.LastContinuedAt.Valid {
		lastContinued = st.LastContinuedAt.Time
	}
	var etaExhaustion any
	if st.ETAExhaustionSec.Valid {
		etaExhaustion = st.ETAExhaustionSec.Int32
	}

	_, err := tx.ExecContext(ctx, `
		INSERT INTO slo_burn_state (
			slo_id, is_burning, current_severity, current_compliance, current_burn_rate, eta_exhaustion_seconds, last_transition_at, last_continued_at, last_evaluated_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
		ON CONFLICT (slo_id) DO UPDATE
		SET is_burning = EXCLUDED.is_burning,
		    current_severity = EXCLUDED.current_severity,
		    current_compliance = EXCLUDED.current_compliance,
		    current_burn_rate = EXCLUDED.current_burn_rate,
		    eta_exhaustion_seconds = EXCLUDED.eta_exhaustion_seconds,
		    last_transition_at = EXCLUDED.last_transition_at,
		    last_continued_at = EXCLUDED.last_continued_at,
		    last_evaluated_at = EXCLUDED.last_evaluated_at,
		    updated_at = now()
	`, st.SLOID, st.IsBurning, st.CurrentSeverity, st.CurrentCompliance, st.CurrentBurnRate, etaExhaustion, lastTransition, lastContinued, st.LastEvaluatedAt)
	return err
}
