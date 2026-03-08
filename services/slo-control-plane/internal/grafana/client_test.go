package grafana

import "testing"

func TestIsRetryable(t *testing.T) {
	if !IsRetryable(APIError{StatusCode: 500}) {
		t.Fatalf("expected 500 to be retryable")
	}
	if !IsRetryable(APIError{StatusCode: 429}) {
		t.Fatalf("expected 429 to be retryable")
	}
	if IsRetryable(APIError{StatusCode: 400}) {
		t.Fatalf("expected 400 to be terminal")
	}
}

func TestFilterRulesByLabels(t *testing.T) {
	rules := []ProvisionedAlertRule{
		{Uid: "a", Labels: map[string]string{"managed_by": "slo-control-plane", "slo_id": "1"}},
		{Uid: "b", Labels: map[string]string{"managed_by": "other"}},
	}
	filtered := FilterRulesByLabels(rules, map[string]string{"managed_by": "slo-control-plane"})
	if len(filtered) != 1 {
		t.Fatalf("expected 1 rule, got %d", len(filtered))
	}
	if filtered[0].Uid != "a" {
		t.Fatalf("expected uid a, got %s", filtered[0].Uid)
	}
}
