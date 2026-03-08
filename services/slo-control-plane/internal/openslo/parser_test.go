package openslo

import "testing"

func TestParseBundleCompilesRuntime(t *testing.T) {
	raw := `apiVersion: openslo/v1
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
      name: checkout-latency-indicator
    spec:
      thresholdMetric:
        metricSource:
          type: clickhouse
          spec:
            route: /cart/checkout
            type: latency
            threshold: 500
            datasourceUid: clickhouse
            datasourceType: clickhouse
`
	bundle, err := ParseBundle(raw)
	if err != nil {
		t.Fatalf("ParseBundle failed: %v", err)
	}
	if bundle.Runtime.Name != "Checkout P99 Latency" {
		t.Fatalf("expected displayName to be used, got %q", bundle.Runtime.Name)
	}
	if bundle.Runtime.Target != 0.99 {
		t.Fatalf("expected target 0.99, got %v", bundle.Runtime.Target)
	}
	if bundle.Runtime.WindowMinutes != 30 {
		t.Fatalf("expected 30 minute window, got %d", bundle.Runtime.WindowMinutes)
	}
	if bundle.Runtime.Route != "/cart/checkout" || bundle.Runtime.Type != "latency" {
		t.Fatalf("unexpected runtime route/type: %s %s", bundle.Runtime.Route, bundle.Runtime.Type)
	}
	if bundle.Runtime.Threshold != 500 {
		t.Fatalf("expected threshold 500, got %v", bundle.Runtime.Threshold)
	}
	if bundle.Runtime.DatasourceUID != "clickhouse" || bundle.Runtime.DatasourceType != "clickhouse" {
		t.Fatalf("unexpected datasource fields: uid=%s type=%s", bundle.Runtime.DatasourceUID, bundle.Runtime.DatasourceType)
	}
	if len(bundle.Objects) != 1 || bundle.Objects[0].Kind != "SLO" {
		t.Fatalf("expected exactly one SLO object, got %#v", bundle.Objects)
	}
}

func TestParseBundleRejectsMissingObjectiveTarget(t *testing.T) {
	raw := `apiVersion: openslo/v1
kind: SLO
metadata:
  name: broken
spec:
  service: api-gateway
  budgetingMethod: Occurrences
  objectives: [{}]
  indicator:
    metadata:
      name: i
    spec:
      thresholdMetric:
        metricSource:
          spec:
            route: /x
            type: latency
            threshold: 10
            datasourceUid: clickhouse
            datasourceType: clickhouse
`
	_, err := ParseBundle(raw)
	if err == nil {
		t.Fatalf("expected missing target validation error")
	}
}

func TestParseBundleResolvesDatasourceFromRef(t *testing.T) {
	raw := `apiVersion: openslo/v1
kind: Datasource
metadata:
  name: clickhouse-ds
spec:
  type: clickhouse
  connectionDetails:
    uid: clickhouse
---
apiVersion: openslo/v1
kind: SLO
metadata:
  name: checkout-error-rate
spec:
  service: api-gateway
  budgetingMethod: Occurrences
  objectives:
    - target: 0.99
  indicator:
    metadata:
      name: checkout-errors-indicator
    spec:
      thresholdMetric:
        metricSource:
          metricSourceRef: clickhouse-ds
          spec:
            route: /cart/checkout
            type: error_rate
            threshold: 0.01
`
	bundle, err := ParseBundle(raw)
	if err != nil {
		t.Fatalf("ParseBundle failed: %v", err)
	}
	if bundle.Runtime.DatasourceType != "clickhouse" {
		t.Fatalf("expected datasource type from DataSource, got %q", bundle.Runtime.DatasourceType)
	}
	if bundle.Runtime.DatasourceUID != "clickhouse" {
		t.Fatalf("expected datasource uid from DataSource connectionDetails.uid, got %q", bundle.Runtime.DatasourceUID)
	}
}
