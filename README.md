# Heatmap Bubbles

Trace analysis for Grafana with heatmap selection and attribute comparison, powered by ClickHouse.

## Architecture

- **Heatmap Panel Plugin** (`plugins/heatmap-panel`): Canvas-based heatmap of span latencies with box selection
- **Bubbles App Plugin** (`plugins/heatmap-app`): Comparison view showing attribute distributions for selected vs baseline spans
- **SLO App Plugin** (`plugins/slo-app`): SLO monitoring with heatmap drilldown for root-cause analysis
- **Shared Comparison** (`packages/shared-comparison`): Reusable comparison components shared across apps
- **Trace Generator** (`trace-generator`): Go service emitting synthetic traces with deliberate failure scenarios
- **Docker Compose** (`docker/`): Full stack with ClickHouse, OTel Collector, Grafana, and trace generator

## Quick Start

```bash
# Build all plugins
npm install --workspaces
npm run build

# Start the stack
cd docker && docker compose up --build
```

Open http://localhost:3000 and navigate to the Heatmap Bubbles App or SLO Analysis App.

## Trace Generator

The trace generator (`trace-generator/main.go`) emits ~50 traces/sec across 6 interconnected services. Each service gets its own TracerProvider so the `ServiceName` column in ClickHouse is populated correctly.

### Services

| Service | Routes | Downstream |
|---|---|---|
| api-gateway | all routes (root span) | order-service, user-service, search-service |
| order-service | /api/orders, /cart/checkout | postgres, payment-service, notification-service |
| user-service | /api/users, /api/auth | postgres, redis |
| search-service | /api/search, /api/products | elasticsearch |
| payment-service | (called by order-service on checkout) | external.payment.process |
| notification-service | (called by order-service on orders) | -- |

### Failure Scenarios

8 deliberate failure patterns, each discoverable through 2-3 correlated attributes in the comparison view.

| # | Name | Trigger | Symptom | Discover By |
|---|---|---|---|---|
| S1 | Slow Checkout | route=/cart/checkout, flag=new-checkout-flow, region=eu-west-1 | p99 ~1500ms, N+1 postgres queries | feature_flag, region |
| S2 | iOS Order Errors | route=/api/orders, platform=ios, build=build-7a3 | HTTP 500, ~250ms | platform, build_id |
| S3 | Redis Timeout APAC | user-svc routes, region=ap-southeast-1 | p99 ~650ms, redis slow + pg fallback | region, db.system |
| S4 | Initech Search Fail | tenant=tenant-initech, flag=dark-launch-search, route=/api/search | HTTP 500, ES timeout ~3s | tenant_id, feature_flag |
| S5 | Auth Memory Leak | route=/api/auth, build=build-7a3, pod=pod-abc-{7,8} | p99 ~800ms, intermittent 503 | build_id, k8s.pod.name |
| S6 | Payment Timeout | route=/cart/checkout, region=us-west-2, 30% prob | HTTP 504, ~5s | region |
| S7 | Umbrella EU Compliance | tenant=tenant-umbrella, region=eu-west-1 | +150ms overhead, all routes | tenant_id, region |
| S8 | Globex Batch Import | tenant=tenant-globex, route=/api/products, method=POST | Slow ES ~500ms | tenant_id, http.method |

## Development

```bash
# Watch mode for all plugins
npm run dev

# Docker stack
cd docker && docker compose up --build
```
