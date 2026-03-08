package main

import (
	"testing"
)

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

func TestLoadBurnProfileConfigFromEnvUsesGradualDefaults(t *testing.T) {
	t.Setenv("BURN_PROFILE", "deterministic")
	t.Setenv("BURN_STEEP_ROUTE", "")
	t.Setenv("BURN_STEEP_ERROR_RATE", "")
	t.Setenv("BURN_SLOW_ROUTE", "")
	t.Setenv("BURN_SLOW_ERROR_RATE", "")

	cfg := loadBurnProfileConfigFromEnv()

	if cfg.SteepErrorRate > 0.005 {
		t.Fatalf("steep default too high for gradual burn: %f", cfg.SteepErrorRate)
	}
	if cfg.SlowErrorRate > 0.002 {
		t.Fatalf("slow default too high for gradual burn: %f", cfg.SlowErrorRate)
	}
}

func TestScenarioErrorRatesAreConservativeForLocalSLOTesting(t *testing.T) {
	if scenarioPaymentTimeoutRate > 0.10 {
		t.Fatalf("payment timeout rate too high: %f", scenarioPaymentTimeoutRate)
	}
	if scenarioAuthMemoryLeakErrorRate > 0.15 {
		t.Fatalf("auth memory leak error rate too high: %f", scenarioAuthMemoryLeakErrorRate)
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
