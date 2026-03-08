package httpapi

import (
	"testing"

	"github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/store"
)

func TestSLOToAPIUsesRuntimeProjection(t *testing.T) {
	slo := store.SLO{
		Canonical: map[string]any{
			"name":           "Checkout P99 Latency",
			"description":    "Users can complete checkout quickly.",
			"userExperience": "Checkout stays responsive from cart to confirmation.",
			"target":         0.99,
			"windowMinutes":  30,
			"route":          "/cart/checkout",
			"type":           "latency",
			"threshold":      500.0,
			"datasourceType": "clickhouse",
			"datasourceUid":  "clickhouse",
		},
	}
	api := sloToAPI(slo)
	if api.Runtime.Name != "Checkout P99 Latency" {
		t.Fatalf("runtime name mismatch: %s", api.Runtime.Name)
	}
	if api.Runtime.Type != "latency" {
		t.Fatalf("runtime type mismatch: %s", api.Runtime.Type)
	}
	if api.Runtime.Route != "/cart/checkout" || api.Runtime.Threshold != 500 {
		t.Fatalf("runtime route/threshold mismatch: %#v", api.Runtime)
	}
}
