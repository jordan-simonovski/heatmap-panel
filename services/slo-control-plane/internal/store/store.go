package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

type Store struct {
	db *sql.DB
}

func New(db *sql.DB) *Store {
	return &Store{db: db}
}

func (s *Store) startSpan(ctx context.Context, name string, attrs ...attribute.KeyValue) (context.Context, trace.Span) {
	tr := otel.Tracer("slo-control-plane/store")
	ctx, span := tr.Start(ctx, name, trace.WithSpanKind(trace.SpanKindInternal))
	if len(attrs) > 0 {
		span.SetAttributes(attrs...)
	}
	return ctx, span
}

type Team struct {
	ID        uuid.UUID
	Name      string
	Slug      string
	CreatedAt time.Time
	UpdatedAt time.Time
}

type Service struct {
	ID          uuid.UUID
	Name        string
	Slug        string
	OwnerTeamID uuid.UUID
	Metadata    map[string]any
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type SLO struct {
	ID             uuid.UUID
	ServiceID      uuid.UUID
	Name           string
	Description    string
	Target         float32
	WindowMinutes  int
	OpenSLO        string
	Canonical      map[string]any
	DatasourceType string
	DatasourceUID  string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type BurnEvent struct {
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

type Pagination struct {
	Page     int
	PageSize int
	Total    int
}

func (s *Store) ListTeams(ctx context.Context, page, pageSize int) ([]Team, Pagination, error) {
	rows, total, err := paginatedQuery(
		s.db,
		ctx,
		`SELECT id, name, slug, created_at, updated_at FROM teams ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
		`SELECT count(*) FROM teams`,
		page,
		pageSize,
		func(rows *sql.Rows) (Team, error) {
			var t Team
			if err := rows.Scan(&t.ID, &t.Name, &t.Slug, &t.CreatedAt, &t.UpdatedAt); err != nil {
				return Team{}, err
			}
			return t, nil
		},
	)
	if err != nil {
		return nil, Pagination{}, err
	}
	return rows, Pagination{Page: page, PageSize: pageSize, Total: total}, nil
}

func (s *Store) CreateTeam(ctx context.Context, id uuid.UUID, name, slug string) (Team, error) {
	var t Team
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO teams (id, name, slug)
		VALUES ($1, $2, $3)
		RETURNING id, name, slug, created_at, updated_at
	`, id, name, slug).Scan(&t.ID, &t.Name, &t.Slug, &t.CreatedAt, &t.UpdatedAt)
	return t, err
}

func (s *Store) GetTeam(ctx context.Context, id uuid.UUID) (Team, error) {
	var t Team
	err := s.db.QueryRowContext(ctx, `
		SELECT id, name, slug, created_at, updated_at
		FROM teams WHERE id = $1
	`, id).Scan(&t.ID, &t.Name, &t.Slug, &t.CreatedAt, &t.UpdatedAt)
	return t, err
}

func (s *Store) UpdateTeam(ctx context.Context, id uuid.UUID, name, slug string) (Team, error) {
	var t Team
	err := s.db.QueryRowContext(ctx, `
		UPDATE teams
		SET name = $2, slug = $3, updated_at = now()
		WHERE id = $1
		RETURNING id, name, slug, created_at, updated_at
	`, id, name, slug).Scan(&t.ID, &t.Name, &t.Slug, &t.CreatedAt, &t.UpdatedAt)
	return t, err
}

func (s *Store) DeleteTeam(ctx context.Context, id uuid.UUID) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM teams WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if rows, _ := res.RowsAffected(); rows == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) ListServices(ctx context.Context, page, pageSize int, ownerTeamID *uuid.UUID) ([]Service, Pagination, error) {
	where := ""
	args := []any{}
	if ownerTeamID != nil {
		where = "WHERE owner_team_id = $3"
		args = append(args, *ownerTeamID)
	}
	listSQL := fmt.Sprintf(`
		SELECT id, name, slug, owner_team_id, metadata_json, created_at, updated_at
		FROM services
		%s
		ORDER BY created_at DESC
		LIMIT $1 OFFSET $2
	`, where)
	countSQL := "SELECT count(*) FROM services"
	if ownerTeamID != nil {
		countSQL += " WHERE owner_team_id = $1"
	}
	rows, total, err := paginatedQueryWithArgs(
		s.db,
		ctx,
		listSQL,
		countSQL,
		page,
		pageSize,
		args,
		func(rows *sql.Rows) (Service, error) {
			var srv Service
			var metadata []byte
			if err := rows.Scan(&srv.ID, &srv.Name, &srv.Slug, &srv.OwnerTeamID, &metadata, &srv.CreatedAt, &srv.UpdatedAt); err != nil {
				return Service{}, err
			}
			srv.Metadata = decodeJSONMap(metadata)
			return srv, nil
		},
	)
	if err != nil {
		return nil, Pagination{}, err
	}
	return rows, Pagination{Page: page, PageSize: pageSize, Total: total}, nil
}

func (s *Store) CreateService(ctx context.Context, id uuid.UUID, name, slug string, ownerTeamID uuid.UUID, metadata map[string]any) (Service, error) {
	var srv Service
	blob, _ := json.Marshal(metadataOrEmpty(metadata))
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO services (id, name, slug, owner_team_id, metadata_json)
		VALUES ($1, $2, $3, $4, $5::jsonb)
		RETURNING id, name, slug, owner_team_id, metadata_json, created_at, updated_at
	`, id, name, slug, ownerTeamID, string(blob)).Scan(
		&srv.ID, &srv.Name, &srv.Slug, &srv.OwnerTeamID, &blob, &srv.CreatedAt, &srv.UpdatedAt,
	)
	srv.Metadata = decodeJSONMap(blob)
	return srv, err
}

func (s *Store) GetService(ctx context.Context, id uuid.UUID) (Service, error) {
	var srv Service
	var metadata []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT id, name, slug, owner_team_id, metadata_json, created_at, updated_at
		FROM services WHERE id = $1
	`, id).Scan(&srv.ID, &srv.Name, &srv.Slug, &srv.OwnerTeamID, &metadata, &srv.CreatedAt, &srv.UpdatedAt)
	srv.Metadata = decodeJSONMap(metadata)
	return srv, err
}

func (s *Store) UpdateService(ctx context.Context, id uuid.UUID, name, slug string, ownerTeamID uuid.UUID, metadata map[string]any) (Service, error) {
	var srv Service
	blob, _ := json.Marshal(metadataOrEmpty(metadata))
	err := s.db.QueryRowContext(ctx, `
		UPDATE services
		SET name = $2, slug = $3, owner_team_id = $4, metadata_json = $5::jsonb, updated_at = now()
		WHERE id = $1
		RETURNING id, name, slug, owner_team_id, metadata_json, created_at, updated_at
	`, id, name, slug, ownerTeamID, string(blob)).Scan(
		&srv.ID, &srv.Name, &srv.Slug, &srv.OwnerTeamID, &blob, &srv.CreatedAt, &srv.UpdatedAt,
	)
	srv.Metadata = decodeJSONMap(blob)
	return srv, err
}

func (s *Store) DeleteService(ctx context.Context, id uuid.UUID) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM services WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if rows, _ := res.RowsAffected(); rows == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) ListSLOs(ctx context.Context, page, pageSize int, serviceID *uuid.UUID) ([]SLO, Pagination, error) {
	ctx, span := s.startSpan(ctx, "store.list_slos")
	defer span.End()
	where := ""
	args := []any{}
	if serviceID != nil {
		where = "WHERE service_id = $3"
		args = append(args, *serviceID)
	}
	listSQL := fmt.Sprintf(`
		SELECT id, service_id, name, description, target, window_minutes, openslo_yaml,
		       canonical_json, datasource_type, datasource_uid, created_at, updated_at
		FROM slos
		%s
		ORDER BY created_at DESC
		LIMIT $1 OFFSET $2
	`, where)
	countSQL := "SELECT count(*) FROM slos"
	if serviceID != nil {
		countSQL += " WHERE service_id = $1"
	}
	rows, total, err := paginatedQueryWithArgs(
		s.db,
		ctx,
		listSQL,
		countSQL,
		page,
		pageSize,
		args,
		func(rows *sql.Rows) (SLO, error) {
			var slo SLO
			var desc sql.NullString
			var canonical []byte
			if err := rows.Scan(
				&slo.ID, &slo.ServiceID, &slo.Name, &desc, &slo.Target, &slo.WindowMinutes, &slo.OpenSLO,
				&canonical, &slo.DatasourceType, &slo.DatasourceUID, &slo.CreatedAt, &slo.UpdatedAt,
			); err != nil {
				return SLO{}, err
			}
			slo.Description = nullStringToString(desc)
			slo.Canonical = decodeJSONMap(canonical)
			return slo, nil
		},
	)
	if err != nil {
		return nil, Pagination{}, err
	}
	return rows, Pagination{Page: page, PageSize: pageSize, Total: total}, nil
}

func (s *Store) CreateSLO(ctx context.Context, tx *sql.Tx, slo SLO) (SLO, error) {
	ctx, span := s.startSpan(ctx, "store.create_slo", attribute.String("slo.id", slo.ID.String()))
	defer span.End()
	blob, _ := json.Marshal(metadataOrEmpty(slo.Canonical))
	var created SLO
	var desc sql.NullString
	var canonical []byte
	err := tx.QueryRowContext(ctx, `
		INSERT INTO slos (
			id, service_id, name, description, target, window_minutes, openslo_yaml, canonical_json,
			datasource_type, datasource_uid
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
		RETURNING id, service_id, name, description, target, window_minutes, openslo_yaml, canonical_json,
		          datasource_type, datasource_uid, created_at, updated_at
	`, slo.ID, slo.ServiceID, slo.Name, nullableStr(slo.Description), slo.Target, slo.WindowMinutes, slo.OpenSLO, string(blob), slo.DatasourceType, slo.DatasourceUID).Scan(
		&created.ID, &created.ServiceID, &created.Name, &desc, &created.Target, &created.WindowMinutes,
		&created.OpenSLO, &canonical, &created.DatasourceType, &created.DatasourceUID, &created.CreatedAt, &created.UpdatedAt,
	)
	created.Description = nullStringToString(desc)
	created.Canonical = decodeJSONMap(canonical)
	return created, err
}

func (s *Store) GetSLO(ctx context.Context, id uuid.UUID) (SLO, error) {
	ctx, span := s.startSpan(ctx, "store.get_slo", attribute.String("slo.id", id.String()))
	defer span.End()
	var slo SLO
	var desc sql.NullString
	var canonical []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT id, service_id, name, description, target, window_minutes, openslo_yaml, canonical_json,
		       datasource_type, datasource_uid, created_at, updated_at
		FROM slos WHERE id = $1
	`, id).Scan(
		&slo.ID, &slo.ServiceID, &slo.Name, &desc, &slo.Target, &slo.WindowMinutes, &slo.OpenSLO, &canonical,
		&slo.DatasourceType, &slo.DatasourceUID, &slo.CreatedAt, &slo.UpdatedAt,
	)
	slo.Description = nullStringToString(desc)
	slo.Canonical = decodeJSONMap(canonical)
	return slo, err
}

func (s *Store) UpdateSLO(ctx context.Context, tx *sql.Tx, slo SLO) (SLO, error) {
	ctx, span := s.startSpan(ctx, "store.update_slo", attribute.String("slo.id", slo.ID.String()))
	defer span.End()
	blob, _ := json.Marshal(metadataOrEmpty(slo.Canonical))
	var updated SLO
	var desc sql.NullString
	var canonical []byte
	err := tx.QueryRowContext(ctx, `
		UPDATE slos
		SET name = $2, description = $3, target = $4, window_minutes = $5, openslo_yaml = $6,
		    canonical_json = $7::jsonb, datasource_type = $8, datasource_uid = $9, updated_at = now()
		WHERE id = $1
		RETURNING id, service_id, name, description, target, window_minutes, openslo_yaml, canonical_json,
		          datasource_type, datasource_uid, created_at, updated_at
	`, slo.ID, slo.Name, nullableStr(slo.Description), slo.Target, slo.WindowMinutes, slo.OpenSLO, string(blob), slo.DatasourceType, slo.DatasourceUID).Scan(
		&updated.ID, &updated.ServiceID, &updated.Name, &desc, &updated.Target, &updated.WindowMinutes,
		&updated.OpenSLO, &canonical, &updated.DatasourceType, &updated.DatasourceUID, &updated.CreatedAt, &updated.UpdatedAt,
	)
	updated.Description = nullStringToString(desc)
	updated.Canonical = decodeJSONMap(canonical)
	return updated, err
}

func (s *Store) DeleteSLO(ctx context.Context, id uuid.UUID) error {
	ctx, span := s.startSpan(ctx, "store.delete_slo", attribute.String("slo.id", id.String()))
	defer span.End()
	res, err := s.db.ExecContext(ctx, `DELETE FROM slos WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if rows, _ := res.RowsAffected(); rows == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) ListBurnEvents(ctx context.Context, page, pageSize int, serviceID, sloID *uuid.UUID) ([]BurnEvent, Pagination, error) {
	conds := []string{"1=1"}
	args := []any{}
	argIdx := 3
	if serviceID != nil {
		conds = append(conds, fmt.Sprintf("service_id = $%d", argIdx))
		args = append(args, *serviceID)
		argIdx++
	}
	if sloID != nil {
		conds = append(conds, fmt.Sprintf("slo_id = $%d", argIdx))
		args = append(args, *sloID)
	}
	where := "WHERE " + joinWithAnd(conds)
	listSQL := fmt.Sprintf(`
		SELECT id, service_id, slo_id, event_type, value, threshold, observed_at, source, idempotency_key
		FROM burn_events_view
		%s
		ORDER BY observed_at DESC
		LIMIT $1 OFFSET $2
	`, where)
	countSQL := fmt.Sprintf(`SELECT count(*) FROM burn_events_view %s`, where)
	rows, total, err := paginatedQueryWithArgs(s.db, ctx, listSQL, countSQL, page, pageSize, args, func(rows *sql.Rows) (BurnEvent, error) {
		var ev BurnEvent
		err := rows.Scan(&ev.ID, &ev.ServiceID, &ev.SLOID, &ev.EventType, &ev.Value, &ev.Threshold, &ev.ObservedAt, &ev.Source, &ev.IdempotencyKey)
		return ev, err
	})
	if err != nil {
		return nil, Pagination{}, err
	}
	return rows, Pagination{Page: page, PageSize: pageSize, Total: total}, nil
}

func (s *Store) BeginTx(ctx context.Context) (*sql.Tx, error) {
	ctx, span := s.startSpan(ctx, "store.begin_tx")
	defer span.End()
	return s.db.BeginTx(ctx, nil)
}

func (s *Store) EnqueueOutbox(ctx context.Context, tx *sql.Tx, aggregateType string, aggregateID uuid.UUID, eventType string, payload any, idempotencyKey string) error {
	ctx, span := s.startSpan(
		ctx,
		"store.enqueue_outbox",
		attribute.String("outbox.aggregate_type", aggregateType),
		attribute.String("outbox.aggregate_id", aggregateID.String()),
		attribute.String("outbox.event_type", eventType),
	)
	defer span.End()
	body, _ := json.Marshal(payload)
	_, err := tx.ExecContext(ctx, `
		INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload_json, status, retry_count, next_attempt_at, idempotency_key)
		VALUES ($1, $2, $3, $4, $5::jsonb, 'pending', 0, now(), $6)
	`, uuid.New(), aggregateType, aggregateID, eventType, string(body), idempotencyKey)
	return err
}

func (s *Store) DB() *sql.DB {
	return s.db
}

func nullableStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func decodeJSONMap(v []byte) map[string]any {
	if len(v) == 0 {
		return map[string]any{}
	}
	m := map[string]any{}
	if err := json.Unmarshal(v, &m); err != nil {
		return map[string]any{}
	}
	return m
}

func nullStringToString(v sql.NullString) string {
	if !v.Valid {
		return ""
	}
	return v.String
}

func metadataOrEmpty(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}

func joinWithAnd(parts []string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += " AND "
		}
		out += p
	}
	return out
}

func paginatedQuery[T any](db *sql.DB, ctx context.Context, listSQL, countSQL string, page, pageSize int, scan func(*sql.Rows) (T, error)) ([]T, int, error) {
	return paginatedQueryWithArgs(db, ctx, listSQL, countSQL, page, pageSize, nil, scan)
}

func paginatedQueryWithArgs[T any](db *sql.DB, ctx context.Context, listSQL, countSQL string, page, pageSize int, extraArgs []any, scan func(*sql.Rows) (T, error)) ([]T, int, error) {
	offset := (page - 1) * pageSize
	listArgs := []any{pageSize, offset}
	listArgs = append(listArgs, extraArgs...)
	rows, err := db.QueryContext(ctx, listSQL, listArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var result []T
	for rows.Next() {
		item, err := scan(rows)
		if err != nil {
			return nil, 0, err
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	countArgs := extraArgs
	if countArgs == nil {
		countArgs = []any{}
	}
	var total int
	if len(countArgs) > 0 {
		if err := db.QueryRowContext(ctx, countSQL, countArgs...).Scan(&total); err != nil {
			return nil, 0, err
		}
	} else if err := db.QueryRowContext(ctx, countSQL).Scan(&total); err != nil {
		return nil, 0, err
	}
	return result, total, nil
}
