package evaluator

import "time"

type decideInput struct {
	Now              time.Time
	SeverityNow      burnSeverity
	ContinueInterval time.Duration
	HasPrevState     bool
	PrevIsBurning    bool
	PrevSeverity     burnSeverity
	LastContinuedAt  time.Time
}

type actionDecision struct {
	EventType string
	EmitEvent bool
}

func decideAction(in decideInput) actionDecision {
	isBurningNow := in.SeverityNow != severityNone

	if !in.HasPrevState {
		if isBurningNow {
			return actionDecision{EventType: "burn_started", EmitEvent: true}
		}
		return actionDecision{}
	}

	if isBurningNow && !in.PrevIsBurning {
		return actionDecision{EventType: "burn_started", EmitEvent: true}
	}
	if !isBurningNow && in.PrevIsBurning {
		return actionDecision{EventType: "burn_resolved", EmitEvent: true}
	}
	if isBurningNow && in.PrevIsBurning {
		// Severity transitions while already burning should be visible immediately.
		if in.PrevSeverity != in.SeverityNow {
			return actionDecision{EventType: "burn_continued", EmitEvent: true}
		}
		if in.LastContinuedAt.IsZero() || in.Now.Sub(in.LastContinuedAt) >= in.ContinueInterval {
			return actionDecision{EventType: "burn_continued", EmitEvent: true}
		}
	}
	return actionDecision{}
}
