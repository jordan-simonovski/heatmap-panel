# SLO Control Plane Integration

This repository now includes a standalone self-hostable control-plane service:

- `services/slo-control-plane`

## What it owns

- Teams
- Services (single owning team)
- SLO definitions (OpenSLO YAML payloads + canonical JSON)
- Outbox events for burn delivery

## Burn events flow

1. Evaluator periodically computes SLO compliance from ClickHouse traces.
2. Evaluator classifies each burn as `fast` or `slow` (multi-window burn-rate), then writes transition/continue events into Postgres outbox atomically with `slo_burn_state`.
3. Outbox worker claims pending rows.
4. Worker writes burn rows into ClickHouse table `slo_burn_events`.
5. Worker marks outbox entries delivered (or retries with backoff).

`slo-control-plane` and `slo-evaluator` are separate binaries so evaluator can be moved to a dedicated deployment/CronJob later.

## Frontend integration

`plugins/slo-app` now:

- Reads API base URL from app config.
- Uses generated OpenAPI TypeScript types.
- Loads teams/services/SLOs/burn events from backend.
- Exposes create forms in-app and refreshes scene pages from API data.

## Contract-first workflow

- Source contract: `api/openapi/slo-control-plane.openapi.yaml`
- Generate bindings: `make openapi-generate`
- Lint contract: `make openapi-lint`

The API docs can be hosted with Swagger UI, Redoc, or Scalar.

## Demo data + full CRUD flow

Use:

- `services/slo-control-plane/scripts/crud-demo.sh`

The script seeds realistic SLO examples based on `trace-generator/main.go` traffic patterns (`/cart/checkout`, `/api/orders`, `/api/search`, `/api/auth`) and supports:

- team CRUD
- service CRUD
- SLO CRUD
- burn event listing

For a complete test pass, run:

```bash
API_BASE_URL=http://localhost:8080 services/slo-control-plane/scripts/crud-demo.sh full-crud
```
