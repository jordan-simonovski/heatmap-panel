# SLO Control Plane

Standalone Go application for SLO/team/service state management.

## Capabilities

- OpenAPI-first HTTP API (`/v1/*`).
- Postgres state for `teams`, `services`, `slos`.
- Transactional outbox with background worker.
- Burn event sink into ClickHouse table `slo_burn_events`.

## Run locally

```bash
go run ./cmd/slo-control-plane
```

Environment variables:

- `SLO_API_HTTP_ADDR` (default `:8080`)
- `SLO_API_POSTGRES_DSN` (required)
- `SLO_API_CLICKHOUSE_DSN` (required)
- `SLO_API_OUTBOX_POLL_INTERVAL` (default `5s`)
- `SLO_API_OUTBOX_BATCH_SIZE` (default `100`)

## Seed and CRUD test script

Use `scripts/crud-demo.sh` to generate trace-generator-based SLO examples and exercise API CRUD flows.

```bash
# Seed teams/services/SLOs from trace-generator routes.
API_BASE_URL=http://localhost:8080 ./scripts/crud-demo.sh seed

# Run full create/list/get/update/delete flow.
API_BASE_URL=http://localhost:8080 ./scripts/crud-demo.sh full-crud
```

You can also run resource-level commands:

```bash
./scripts/crud-demo.sh team list
./scripts/crud-demo.sh service list
./scripts/crud-demo.sh slo list
./scripts/crud-demo.sh burn list
```

## API contract

Source of truth:

- `api/openapi/slo-control-plane.openapi.yaml`

Generated assets:

- Go server/types: `internal/api/apiv1.gen.go`
- TypeScript types: `plugins/slo-app/src/api/generated/types.ts`

## API docs UI

You can serve this contract with Swagger UI, Redoc, or Scalar.
For modern docs UX, Scalar is recommended.
