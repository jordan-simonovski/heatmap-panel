# SLO Control Plane Integration

This repository now includes a standalone self-hostable control-plane service:

- `services/slo-control-plane`

## What it owns

- Teams
- Services (single owning team)
- SLO definitions (OpenSLO YAML payloads + runtime projection)
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

## OpenSLO conventions (UX-first)

For every SLO, use a human-readable name and description that describes the user journey being protected.

Recommended YAML shape:

```yaml
apiVersion: openslo/v1
kind: SLO
metadata:
  name: checkout-success
  displayName: Checkout Success
  annotations:
    heatmap.local/userExperience: Users can check out successfully.
spec:
  description: Users can complete checkout without errors.
  service: api-gateway
  budgetingMethod: Occurrences
  objectives:
    - target: 0.99
  timeWindow:
    - duration: 30m
      isRolling: true
  indicator:
    metadata:
      name: checkout-success-indicator
    spec:
      thresholdMetric:
        metricSource:
          type: clickhouse
          spec:
            route: /cart/checkout
            type: error_rate # or latency
            threshold: 0.01
            datasourceUid: clickhouse
            datasourceType: clickhouse
```

Storage behavior:

- OpenSLO is the only write source; API no longer accepts duplicated top-level SLO fields.
- Runtime metadata is projected from OpenSLO (`name`, `target`, `window`, route/type/threshold, datasource fields, UX annotation) for evaluator/reconciler/UI reads.
- Parsed OpenSLO objects are persisted in `slo_openslo_objects` for audit and reconciliation.

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
