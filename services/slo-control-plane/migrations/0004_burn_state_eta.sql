ALTER TABLE slo_burn_state
ADD COLUMN IF NOT EXISTS current_burn_rate REAL NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS eta_exhaustion_seconds INTEGER;
