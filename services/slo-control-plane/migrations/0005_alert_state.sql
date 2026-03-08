CREATE TABLE IF NOT EXISTS slo_alert_state (
  id UUID PRIMARY KEY,
  slo_id UUID NOT NULL REFERENCES slos(id) ON DELETE CASCADE,
  alert_kind TEXT NOT NULL,
  grafana_rule_uid TEXT NOT NULL,
  grafana_namespace_uid TEXT NOT NULL,
  grafana_rule_group TEXT NOT NULL,
  last_applied_spec_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  last_error TEXT,
  last_reconciled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (slo_id, alert_kind),
  UNIQUE (grafana_rule_uid)
);

CREATE INDEX IF NOT EXISTS idx_slo_alert_state_slo_kind ON slo_alert_state(slo_id, alert_kind);
CREATE INDEX IF NOT EXISTS idx_slo_alert_state_status ON slo_alert_state(status);

CREATE TABLE IF NOT EXISTS slo_alert_reconcile_attempts (
  id UUID PRIMARY KEY,
  slo_id UUID NOT NULL,
  alert_kind TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  duration_ms INTEGER NOT NULL,
  error_text TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_slo_alert_reconcile_attempts_slo_time
  ON slo_alert_reconcile_attempts(slo_id, attempted_at DESC);
