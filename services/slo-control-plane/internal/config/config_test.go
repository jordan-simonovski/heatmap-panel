package config

import (
	"os"
	"testing"
	"time"
)

func TestLoadGrafanaAndReconcilerSettings(t *testing.T) {
	t.Setenv("SLO_API_POSTGRES_DSN", "postgres://test")
	t.Setenv("SLO_API_CLICKHOUSE_DSN", "clickhouse://test")
	t.Setenv("SLO_API_GRAFANA_URL", "http://grafana:3000")
	t.Setenv("SLO_API_GRAFANA_TOKEN", "secret-token")
	t.Setenv("SLO_API_GRAFANA_FOLDER_UID", "slo-folder")
	t.Setenv("SLO_API_ALERT_RECONCILER_POLL_INTERVAL", "17s")
	t.Setenv("SLO_API_ALERT_RECONCILER_BATCH_SIZE", "25")
	t.Setenv("SLO_API_GRAFANA_HTTP_TIMEOUT", "9s")
	t.Setenv("SLO_API_ALERT_DEFAULT_LABELS_JSON", `{"severity":"warning","team":"sre"}`)
	t.Setenv("SLO_API_ALERT_DEFAULT_ANNOTATIONS_JSON", `{"runbook":"https://example.com/runbook"}`)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.GrafanaURL != "http://grafana:3000" {
		t.Fatalf("GrafanaURL = %q", cfg.GrafanaURL)
	}
	if cfg.GrafanaToken != "secret-token" {
		t.Fatalf("GrafanaToken = %q", cfg.GrafanaToken)
	}
	if cfg.GrafanaFolderUID != "slo-folder" {
		t.Fatalf("GrafanaFolderUID = %q", cfg.GrafanaFolderUID)
	}
	if cfg.AlertReconcilerPollInterval != 17*time.Second {
		t.Fatalf("AlertReconcilerPollInterval = %s", cfg.AlertReconcilerPollInterval)
	}
	if cfg.AlertReconcilerBatchSize != 25 {
		t.Fatalf("AlertReconcilerBatchSize = %d", cfg.AlertReconcilerBatchSize)
	}
	if cfg.GrafanaHTTPTimeout != 9*time.Second {
		t.Fatalf("GrafanaHTTPTimeout = %s", cfg.GrafanaHTTPTimeout)
	}
	if cfg.AlertDefaultLabels["team"] != "sre" {
		t.Fatalf("AlertDefaultLabels[team] = %q", cfg.AlertDefaultLabels["team"])
	}
	if cfg.AlertDefaultAnnotations["runbook"] != "https://example.com/runbook" {
		t.Fatalf("AlertDefaultAnnotations[runbook] = %q", cfg.AlertDefaultAnnotations["runbook"])
	}
}

func TestLoadRejectsInvalidAlertLabelJSON(t *testing.T) {
	t.Setenv("SLO_API_POSTGRES_DSN", "postgres://test")
	t.Setenv("SLO_API_CLICKHOUSE_DSN", "clickhouse://test")
	t.Setenv("SLO_API_ALERT_DEFAULT_LABELS_JSON", "{")

	_, err := Load()
	if err == nil {
		t.Fatalf("expected error for invalid JSON")
	}
}

func TestLoadGrafanaDefaultsAreSafe(t *testing.T) {
	t.Setenv("SLO_API_POSTGRES_DSN", "postgres://test")
	t.Setenv("SLO_API_CLICKHOUSE_DSN", "clickhouse://test")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.AlertReconcilerBatchSize <= 0 {
		t.Fatalf("AlertReconcilerBatchSize = %d", cfg.AlertReconcilerBatchSize)
	}
	if cfg.AlertReconcilerPollInterval <= 0 {
		t.Fatalf("AlertReconcilerPollInterval = %s", cfg.AlertReconcilerPollInterval)
	}
	if cfg.GrafanaHTTPTimeout <= 0 {
		t.Fatalf("GrafanaHTTPTimeout = %s", cfg.GrafanaHTTPTimeout)
	}
}

func TestLoadOTelDefaults(t *testing.T) {
	t.Setenv("SLO_API_POSTGRES_DSN", "postgres://test")
	t.Setenv("SLO_API_CLICKHOUSE_DSN", "clickhouse://test")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.OTelServiceName != "slo-control-plane" {
		t.Fatalf("OTelServiceName = %q", cfg.OTelServiceName)
	}
	if cfg.OTelExporterOTLPEndpoint != "" {
		t.Fatalf("OTelExporterOTLPEndpoint = %q", cfg.OTelExporterOTLPEndpoint)
	}
	if cfg.OTelExporterOTLPInsecure {
		t.Fatalf("OTelExporterOTLPInsecure = true")
	}
}

func TestLoadOTelCustomValues(t *testing.T) {
	t.Setenv("SLO_API_POSTGRES_DSN", "postgres://test")
	t.Setenv("SLO_API_CLICKHOUSE_DSN", "clickhouse://test")
	t.Setenv("SLO_API_OTEL_SERVICE_NAME", "slo-control-plane-dev")
	t.Setenv("SLO_API_OTEL_EXPORTER_OTLP_ENDPOINT", "otel-collector:4318")
	t.Setenv("SLO_API_OTEL_EXPORTER_OTLP_INSECURE", "true")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.OTelServiceName != "slo-control-plane-dev" {
		t.Fatalf("OTelServiceName = %q", cfg.OTelServiceName)
	}
	if cfg.OTelExporterOTLPEndpoint != "otel-collector:4318" {
		t.Fatalf("OTelExporterOTLPEndpoint = %q", cfg.OTelExporterOTLPEndpoint)
	}
	if !cfg.OTelExporterOTLPInsecure {
		t.Fatalf("OTelExporterOTLPInsecure = false")
	}
}

func TestMain(m *testing.M) {
	os.Exit(m.Run())
}
