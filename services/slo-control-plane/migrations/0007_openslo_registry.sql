CREATE TABLE IF NOT EXISTS slo_openslo_objects (
  id UUID PRIMARY KEY,
  slo_id UUID NOT NULL REFERENCES slos(id) ON DELETE CASCADE,
  object_kind TEXT NOT NULL,
  object_name TEXT NOT NULL,
  object_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (slo_id, object_kind, object_name)
);

CREATE INDEX IF NOT EXISTS idx_slo_openslo_objects_slo ON slo_openslo_objects (slo_id);
CREATE INDEX IF NOT EXISTS idx_slo_openslo_objects_kind ON slo_openslo_objects (object_kind);
