package main

import "testing"

func TestDeterministicBurnDecisionSteepRoute(t *testing.T) {
	cfg := burnProfileConfig{
		Mode:           burnProfileDeterministic,
		SteepRoute:     "/cart/checkout",
		SteepErrorRate: 0.08,
		SlowRoute:      "/api/auth",
		SlowErrorRate:  0.003,
	}
	status, level, ok := deterministicBurnDecision("/cart/checkout", cfg, 0.01)
	if !ok {
		t.Fatalf("expected deterministic burn decision")
	}
	if level != burnLevelSteep {
		t.Fatalf("expected steep level, got %q", level)
	}
	if status != 504 {
		t.Fatalf("expected 504 for steep burn, got %d", status)
	}
}

func TestDeterministicBurnDecisionSlowRoute(t *testing.T) {
	cfg := burnProfileConfig{
		Mode:           burnProfileDeterministic,
		SteepRoute:     "/cart/checkout",
		SteepErrorRate: 0.08,
		SlowRoute:      "/api/auth",
		SlowErrorRate:  0.003,
	}
	status, level, ok := deterministicBurnDecision("/api/auth", cfg, 0.001)
	if !ok {
		t.Fatalf("expected deterministic burn decision")
	}
	if level != burnLevelSlow {
		t.Fatalf("expected slow level, got %q", level)
	}
	if status != 503 {
		t.Fatalf("expected 503 for slow burn, got %d", status)
	}
}

func TestDeterministicBurnDecisionNoFailureWhenSampleAboveRate(t *testing.T) {
	cfg := burnProfileConfig{
		Mode:           burnProfileDeterministic,
		SteepRoute:     "/cart/checkout",
		SteepErrorRate: 0.08,
		SlowRoute:      "/api/auth",
		SlowErrorRate:  0.003,
	}
	_, _, ok := deterministicBurnDecision("/api/auth", cfg, 0.5)
	if ok {
		t.Fatalf("expected no deterministic burn decision when sample above rate")
	}
}
