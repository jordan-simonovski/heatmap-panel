# SLO Control Plane

Standalone Go application for SLO/team/service state management.

## Capabilities

- OpenAPI-first HTTP API (`/v1/*`).
- Postgres state for `teams`, `services`, `slos`.
- Transactional outbox with background worker.
- Burn event sink into ClickHouse table `slo_burn_events`.
- Standalone SLO evaluator component (`cmd/slo-evaluator`) that emits burn transitions/continues.

## Run locally

```bash
go run ./cmd/slo-control-plane
```

Run evaluator in loop:

```bash
go run ./cmd/slo-evaluator
```

Run one-shot evaluator pass (CronJob-friendly):

```bash
go run ./cmd/slo-evaluator --once
```

Environment variables:

- `SLO_API_HTTP_ADDR` (default `:8080`)
- `SLO_API_POSTGRES_DSN` (required)
- `SLO_API_CLICKHOUSE_DSN` (required)
- `SLO_API_OUTBOX_POLL_INTERVAL` (default `5s`)
- `SLO_API_OUTBOX_BATCH_SIZE` (default `100`)
- `SLO_API_EVALUATOR_INTERVAL` (default `30s`)
- `SLO_API_EVALUATOR_CONTINUE_INTERVAL` (default `5m`)
- `SLO_API_EVALUATOR_FAST_WINDOW_MIN` (default `5`)
- `SLO_API_EVALUATOR_SLOW_WINDOW_MIN` (default `60`)
- `SLO_API_EVALUATOR_FAST_BURN_RATE` (default `14.4`)
- `SLO_API_EVALUATOR_SLOW_BURN_RATE` (default `2.0`)

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

## OpenSLO schema for `createSLO`

`POST /v1/slos` is OpenSLO-only. The request accepts `serviceId` and `openslo`; all runtime fields are derived from the OpenSLO document.

### Minimal API payload

```json
{
  "serviceId": "7f4f8f4c-0cb5-4ad6-9f91-5b6f8d3f2a11",
  "openslo": "apiVersion: openslo/v1\nkind: SLO\nmetadata:\n  name: checkout-p99-latency\n  displayName: Checkout P99 Latency\n  annotations:\n    heatmap.local/userExperience: Checkout stays responsive from cart to confirmation.\nspec:\n  description: Users can complete checkout quickly without waiting.\n  service: api-gateway\n  budgetingMethod: Occurrences\n  objectives:\n    - target: 0.99\n  timeWindow:\n    - duration: 30m\n      isRolling: true\n  indicator:\n    metadata:\n      name: checkout-p99-indicator\n    spec:\n      thresholdMetric:\n        metricSource:\n          type: clickhouse\n          spec:\n            route: /cart/checkout\n            type: latency\n            threshold: 500\n            datasourceUid: clickhouse\n            datasourceType: clickhouse"
}
```

### Expected OpenSLO YAML shape

```yaml
apiVersion: openslo/v1
kind: SLO
metadata:
  name: checkout-p99-latency
  displayName: Checkout P99 Latency
  annotations:
    heatmap.local/userExperience: Checkout stays responsive from cart to confirmation.
spec:
  description: Users can complete checkout quickly without waiting.
  service: api-gateway
  budgetingMethod: Occurrences
  objectives:
    - target: 0.99
  timeWindow:
    - duration: 30m
      isRolling: true
  indicator:
    metadata:
      name: checkout-p99-indicator
    spec:
      thresholdMetric:
        metricSource:
          type: clickhouse
          spec:
            route: /cart/checkout
            type: latency # or error_rate
            threshold: 500 # ms for latency, fraction for error_rate (for example 0.01)
            datasourceUid: clickhouse
            datasourceType: clickhouse
```

### Parsed fields (OpenSLO -> runtime projection)

- `metadata.displayName` (fallback `metadata.name`) -> runtime `name`
- `spec.description` -> runtime `description`
- `metadata.annotations["heatmap.local/userExperience"]` -> runtime `userExperience`
- `spec.objectives[0].target` -> runtime `target`
- `spec.timeWindow[0].duration` -> runtime `windowMinutes`
- `spec.indicator.spec.thresholdMetric.metricSource.spec.route` -> runtime `route`
- `spec.indicator.spec.thresholdMetric.metricSource.spec.type` -> runtime `type`
- `spec.indicator.spec.thresholdMetric.metricSource.spec.threshold` -> runtime `threshold`
- `spec.indicator.spec.thresholdMetric.metricSource.spec.datasourceUid` -> runtime `datasourceUid`
- `spec.indicator.spec.thresholdMetric.metricSource.spec.datasourceType` -> runtime `datasourceType`

### Alert generation behavior

- SLO objects alone do not create Grafana alerts.
- The reconciler only creates alerts from OpenSLO `AlertCondition` objects in the same submitted OpenSLO bundle.
- If no `AlertCondition` objects are present, no managed Grafana alerts are created for that SLO.

## API contract

Source of truth:

- `api/openapi/slo-control-plane.openapi.yaml`

Generated assets:

- Go server/types: `internal/api/apiv1.gen.go`
- TypeScript types: `plugins/slo-app/src/api/generated/types.ts`

## API docs UI

You can serve this contract with Swagger UI, Redoc, or Scalar.
For modern docs UX, Scalar is recommended.
