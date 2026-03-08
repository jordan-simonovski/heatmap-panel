package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type OutboxEvent struct {
	ID             uuid.UUID
	AggregateType  string
	AggregateID    uuid.UUID
	EventType      string
	Payload        map[string]any
	RetryCount     int
	IdempotencyKey string
}

func (s *Store) ClaimPendingOutbox(ctx context.Context, batchSize int) ([]OutboxEvent, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	rows, err := tx.QueryContext(ctx, `
		WITH claimed AS (
			SELECT id
			FROM outbox_events
			WHERE status = 'pending' AND next_attempt_at <= now()
			ORDER BY created_at ASC
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		)
		UPDATE outbox_events o
		SET status = 'processing', updated_at = now()
		FROM claimed
		WHERE o.id = claimed.id
		RETURNING o.id, o.aggregate_type, o.aggregate_id, o.event_type, o.payload_json, o.retry_count, o.idempotency_key
	`, batchSize)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []OutboxEvent
	for rows.Next() {
		var ev OutboxEvent
		var payload []byte
		if err := rows.Scan(&ev.ID, &ev.AggregateType, &ev.AggregateID, &ev.EventType, &payload, &ev.RetryCount, &ev.IdempotencyKey); err != nil {
			return nil, err
		}
		ev.Payload = map[string]any{}
		_ = json.Unmarshal(payload, &ev.Payload)
		events = append(events, ev)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return events, nil
}

func (s *Store) MarkOutboxDelivered(ctx context.Context, id uuid.UUID) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE outbox_events
		SET status = 'delivered', sent_at = now(), updated_at = now()
		WHERE id = $1
	`, id)
	return err
}

func (s *Store) MarkOutboxRetry(ctx context.Context, id uuid.UUID, retryCount int, errMsg string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	nextAttempt := time.Now().Add(time.Duration(1<<retryCount) * time.Second)
	if _, err := tx.ExecContext(ctx, `
		UPDATE outbox_events
		SET status = 'pending', retry_count = $2, next_attempt_at = $3, updated_at = now()
		WHERE id = $1
	`, id, retryCount, nextAttempt); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO burn_event_delivery_attempts (id, outbox_event_id, attempt_no, error_text, attempted_at)
		VALUES ($1, $2, $3, $4, now())
	`, uuid.New(), id, retryCount, errMsg); err != nil {
		return err
	}

	return tx.Commit()
}

func (s *Store) InsertBurnEventView(ctx context.Context, ev BurnEvent) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO burn_events_view (
			id, service_id, slo_id, event_type, value, threshold, observed_at, source, idempotency_key
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (idempotency_key) DO NOTHING
	`, ev.ID, ev.ServiceID, ev.SLOID, ev.EventType, ev.Value, ev.Threshold, ev.ObservedAt, ev.Source, ev.IdempotencyKey)
	return err
}

func IsNotFound(err error) bool {
	return err == sql.ErrNoRows
}
