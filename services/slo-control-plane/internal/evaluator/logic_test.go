package evaluator

import (
	"testing"
	"time"
)

func TestDecideEventTransitionStarted(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	action := decideAction(decideInput{
		Now:              now,
		SeverityNow:      severityFast,
		ContinueInterval: 5 * time.Minute,
		HasPrevState:     false,
	})
	if action.EventType != "burn_started" {
		t.Fatalf("expected burn_started, got %q", action.EventType)
	}
}

func TestDecideEventTransitionResolved(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	action := decideAction(decideInput{
		Now:              now,
		SeverityNow:      severityNone,
		ContinueInterval: 5 * time.Minute,
		HasPrevState:     true,
		PrevIsBurning:    true,
		PrevSeverity:     severitySlow,
		LastContinuedAt:  now.Add(-10 * time.Minute),
	})
	if action.EventType != "burn_resolved" {
		t.Fatalf("expected burn_resolved, got %q", action.EventType)
	}
}

func TestDecideEventContinuedByInterval(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	action := decideAction(decideInput{
		Now:              now,
		SeverityNow:      severitySlow,
		ContinueInterval: 5 * time.Minute,
		HasPrevState:     true,
		PrevIsBurning:    true,
		PrevSeverity:     severitySlow,
		LastContinuedAt:  now.Add(-6 * time.Minute),
	})
	if action.EventType != "burn_continued" {
		t.Fatalf("expected burn_continued, got %q", action.EventType)
	}
}

func TestDecideEventContinuedOnSeverityChange(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	action := decideAction(decideInput{
		Now:              now,
		SeverityNow:      severityFast,
		ContinueInterval: 5 * time.Minute,
		HasPrevState:     true,
		PrevIsBurning:    true,
		PrevSeverity:     severitySlow,
		LastContinuedAt:  now.Add(-1 * time.Minute),
	})
	if action.EventType != "burn_continued" {
		t.Fatalf("expected burn_continued, got %q", action.EventType)
	}
}
