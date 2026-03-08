package evaluator

import "testing"

func TestClassifySeverityFastWins(t *testing.T) {
	sev := classifySeverity(16.0, 3.0, 14.4, 2.0)
	if sev != severityFast {
		t.Fatalf("expected fast severity, got %q", sev)
	}
}

func TestClassifySeveritySlow(t *testing.T) {
	sev := classifySeverity(4.0, 2.5, 14.4, 2.0)
	if sev != severitySlow {
		t.Fatalf("expected slow severity, got %q", sev)
	}
}

func TestClassifySeverityNone(t *testing.T) {
	sev := classifySeverity(1.0, 1.5, 14.4, 2.0)
	if sev != severityNone {
		t.Fatalf("expected none severity, got %q", sev)
	}
}

func TestBurnRate(t *testing.T) {
	got := burnRate(0.995, 0.999)
	if got <= 0 {
		t.Fatalf("expected positive burn rate, got %f", got)
	}
}

func TestTimeToExhaustionSeconds(t *testing.T) {
	got := timeToExhaustionSeconds(2.0, 60)
	if got != 1800 {
		t.Fatalf("expected 1800 seconds, got %d", got)
	}
}

func TestTimeToExhaustionSecondsZeroRate(t *testing.T) {
	got := timeToExhaustionSeconds(0, 60)
	if got != 0 {
		t.Fatalf("expected 0 seconds, got %d", got)
	}
}
