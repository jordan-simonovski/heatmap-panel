ALTER TABLE slo_burn_state
ADD COLUMN IF NOT EXISTS current_severity TEXT NOT NULL DEFAULT 'none';
