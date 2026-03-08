package spec

import (
	"testing"

	"github.com/google/uuid"

	"github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/store"
)

func TestBuildDesiredRulesIncludesManagedLabels(t *testing.T) {
	sloID := uuid.New()
	serviceID := uuid.New()
	in := store.SLOReconcileInput{
		SLO: store.SLO{
			ID:            sloID,
			ServiceID:     serviceID,
			Name:          "Checkout Availability",
			DatasourceUID: "clickhouse",
			OpenSLO: `apiVersion: openslo/v1
kind: SLO
metadata:
  name: checkout-availability
spec:
  service: api-gateway
  budgetingMethod: Occurrences
  objectives:
    - target: 0.99
  indicator:
    metadata:
      name: checkout-indicator
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
---
apiVersion: openslo/v1
kind: AlertCondition
metadata:
  name: checkout-burn
spec:
  severity: page
  condition:
    kind: burnrate
    op: gte
    threshold: 2
    alertAfter: 2m
`,
		},
	}
	opts := BuildOptions{
		FolderUID:          "slo-folder",
		GroupPrefix:        "slo",
		DefaultLabels:      map[string]string{"team": "sre"},
		DefaultAnnotations: map[string]string{"runbook": "https://example.com"},
	}

	specs, err := BuildDesiredRules(in, opts)
	if err != nil {
		t.Fatalf("BuildDesiredRules() error = %v", err)
	}
	if len(specs) != 1 {
		t.Fatalf("expected one rule spec, got %d", len(specs))
	}
	for _, s := range specs {
		if s.Rule.Labels["managed_by"] != "slo-control-plane" {
			t.Fatalf("missing managed_by label")
		}
		if s.Rule.Labels["slo_id"] != sloID.String() {
			t.Fatalf("missing slo_id label")
		}
		if s.Rule.Labels["service_id"] != serviceID.String() {
			t.Fatalf("missing service_id label")
		}
		if s.Rule.Labels["team"] != "sre" {
			t.Fatalf("missing default team label")
		}
		if s.SpecHash == "" {
			t.Fatalf("empty spec hash")
		}
		if len(s.RuleUID) > 40 {
			t.Fatalf("rule uid too long for Grafana provisioning: %s (%d)", s.RuleUID, len(s.RuleUID))
		}
	}
}

func TestBuildDesiredRulesNoAlertConditionsNoRules(t *testing.T) {
	in := store.SLOReconcileInput{
		SLO: store.SLO{
			ID:            uuid.New(),
			ServiceID:     uuid.New(),
			Name:          "No Alert SLO",
			DatasourceUID: "clickhouse",
			OpenSLO: `apiVersion: openslo/v1
kind: SLO
metadata:
  name: no-alert
spec:
  service: api-gateway
  budgetingMethod: Occurrences
  objectives:
    - target: 0.99
  indicator:
    metadata:
      name: no-alert-ind
    spec:
      thresholdMetric:
        metricSource:
          type: clickhouse
          spec:
            route: /health
            type: error_rate
            threshold: 0.01
            datasourceUid: clickhouse
            datasourceType: clickhouse`,
		},
	}
	specs, err := BuildDesiredRules(in, BuildOptions{FolderUID: "slo-folder"})
	if err != nil {
		t.Fatalf("BuildDesiredRules() error = %v", err)
	}
	if len(specs) != 0 {
		t.Fatalf("expected zero rules when no alert conditions, got %d", len(specs))
	}
}

func TestBuildDesiredRulesServiceMetadataOverrides(t *testing.T) {
	in := store.SLOReconcileInput{
		SLO: store.SLO{
			ID:            uuid.New(),
			ServiceID:     uuid.New(),
			Name:          "API Latency",
			DatasourceUID: "clickhouse",
			OpenSLO: `apiVersion: openslo/v1
kind: SLO
metadata:
  name: api-latency
spec:
  service: api-gateway
  budgetingMethod: Occurrences
  objectives:
    - target: 0.99
  indicator:
    metadata:
      name: api-latency-indicator
    spec:
      thresholdMetric:
        metricSource:
          type: clickhouse
          spec:
            route: /api
            type: latency
            threshold: 200
            datasourceUid: clickhouse
            datasourceType: clickhouse
---
apiVersion: openslo/v1
kind: AlertCondition
metadata:
  name: api-burn
spec:
  severity: page
  condition:
    kind: burnrate
    op: gte
    threshold: 2
    alertAfter: 2m
`,
		},
		ServiceMetadata: map[string]any{
			"alerting": map[string]any{
				"labels": map[string]any{
					"team": "payments",
				},
			},
		},
	}
	opts := BuildOptions{
		FolderUID:     "slo-folder",
		GroupPrefix:   "slo",
		DefaultLabels: map[string]string{"team": "sre"},
	}
	specs, err := BuildDesiredRules(in, opts)
	if err != nil {
		t.Fatalf("BuildDesiredRules() error = %v", err)
	}
	if specs[0].Rule.Labels["team"] != "payments" {
		t.Fatalf("expected metadata override label, got %q", specs[0].Rule.Labels["team"])
	}
}
