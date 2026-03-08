CREATE TABLE IF NOT EXISTS slo_burn_state (
  slo_id UUID PRIMARY KEY REFERENCES slos(id) ON DELETE CASCADE,
  is_burning BOOLEAN NOT NULL DEFAULT false,
  current_compliance REAL NOT NULL DEFAULT 1.0,
  last_transition_at TIMESTAMPTZ,
  last_continued_at TIMESTAMPTZ,
  last_evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
