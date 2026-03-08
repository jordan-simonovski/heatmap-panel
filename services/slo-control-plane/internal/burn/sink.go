package burn

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "github.com/ClickHouse/clickhouse-go/v2"
	"github.com/google/uuid"
)

type Event struct {
	ID             uuid.UUID
	ServiceID      uuid.UUID
	SLOID          uuid.UUID
	EventType      string
	Value          float32
	Threshold      float32
	ObservedAt     time.Time
	Source         string
	IdempotencyKey string
}

type Sink struct {
	db *sql.DB
}

func New(clickhouseDSN string) (*Sink, error) {
	db, err := sql.Open("clickhouse", clickhouseDSN)
	if err != nil {
		return nil, err
	}
	return &Sink{db: db}, nil
}

func (s *Sink) Close() error {
	return s.db.Close()
}

func (s *Sink) EnsureTable(ctx context.Context) error {
	ddl := `
CREATE TABLE IF NOT EXISTS slo_burn_events (
  id UUID,
  service_id UUID,
  slo_id UUID,
  event_type String,
  value Float32,
  threshold Float32,
  observed_at DateTime64(3),
  source String,
  idempotency_key String
)
ENGINE = ReplacingMergeTree
ORDER BY (service_id, slo_id, observed_at, idempotency_key)
`
	_, err := s.db.ExecContext(ctx, ddl)
	return err
}

func (s *Sink) InsertEvent(ctx context.Context, ev Event) error {
	if s.db == nil {
		return fmt.Errorf("clickhouse sink not initialized")
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO slo_burn_events (
			id, service_id, slo_id, event_type, value, threshold, observed_at, source, idempotency_key
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, ev.ID.String(), ev.ServiceID.String(), ev.SLOID.String(), ev.EventType, ev.Value, ev.Threshold, ev.ObservedAt, ev.Source, ev.IdempotencyKey)
	return err
}
