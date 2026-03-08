package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	HTTPAddr                    string
	PostgresDSN                 string
	ClickHouseDSN               string
	OTelServiceName             string
	OTelExporterOTLPEndpoint    string
	OTelExporterOTLPInsecure    bool
	GrafanaURL                  string
	GrafanaToken                string
	GrafanaFolderUID            string
	GrafanaHTTPTimeout          time.Duration
	OutboxPollInterval          time.Duration
	OutboxBatchSize             int
	AlertReconcilerPollInterval time.Duration
	AlertReconcilerBatchSize    int
	AlertDefaultLabels          map[string]string
	AlertDefaultAnnotations     map[string]string
	EvaluatorInterval           time.Duration
	EvaluatorContinueInterval   time.Duration
	EvaluatorFastWindowMin      int
	EvaluatorSlowWindowMin      int
	EvaluatorFastBurnRate       float64
	EvaluatorSlowBurnRate       float64
	ShutdownGraceSeconds        int
}

func Load() (Config, error) {
	cfg := Config{
		HTTPAddr:                    getenv("SLO_API_HTTP_ADDR", ":8080"),
		PostgresDSN:                 os.Getenv("SLO_API_POSTGRES_DSN"),
		ClickHouseDSN:               os.Getenv("SLO_API_CLICKHOUSE_DSN"),
		OTelServiceName:             getenv("SLO_API_OTEL_SERVICE_NAME", "slo-control-plane"),
		OTelExporterOTLPEndpoint:    getenv("SLO_API_OTEL_EXPORTER_OTLP_ENDPOINT", ""),
		OTelExporterOTLPInsecure:    boolEnv("SLO_API_OTEL_EXPORTER_OTLP_INSECURE", false),
		GrafanaURL:                  getenv("SLO_API_GRAFANA_URL", ""),
		GrafanaToken:                getenv("SLO_API_GRAFANA_TOKEN", ""),
		GrafanaFolderUID:            getenv("SLO_API_GRAFANA_FOLDER_UID", "slo-managed"),
		GrafanaHTTPTimeout:          durationEnv("SLO_API_GRAFANA_HTTP_TIMEOUT", 10*time.Second),
		OutboxPollInterval:          durationEnv("SLO_API_OUTBOX_POLL_INTERVAL", 5*time.Second),
		OutboxBatchSize:             intEnv("SLO_API_OUTBOX_BATCH_SIZE", 100),
		AlertReconcilerPollInterval: durationEnv("SLO_API_ALERT_RECONCILER_POLL_INTERVAL", 30*time.Second),
		AlertReconcilerBatchSize:    intEnv("SLO_API_ALERT_RECONCILER_BATCH_SIZE", 100),
		EvaluatorInterval:           durationEnv("SLO_API_EVALUATOR_INTERVAL", 30*time.Second),
		EvaluatorContinueInterval:   durationEnv("SLO_API_EVALUATOR_CONTINUE_INTERVAL", 5*time.Minute),
		EvaluatorFastWindowMin:      intEnv("SLO_API_EVALUATOR_FAST_WINDOW_MIN", 5),
		EvaluatorSlowWindowMin:      intEnv("SLO_API_EVALUATOR_SLOW_WINDOW_MIN", 60),
		EvaluatorFastBurnRate:       floatEnv("SLO_API_EVALUATOR_FAST_BURN_RATE", 14.4),
		EvaluatorSlowBurnRate:       floatEnv("SLO_API_EVALUATOR_SLOW_BURN_RATE", 2.0),
		ShutdownGraceSeconds:        intEnv("SLO_API_SHUTDOWN_GRACE_SECONDS", 10),
	}
	var err error
	cfg.AlertDefaultLabels, err = jsonStringMapEnv("SLO_API_ALERT_DEFAULT_LABELS_JSON")
	if err != nil {
		return Config{}, err
	}
	cfg.AlertDefaultAnnotations, err = jsonStringMapEnv("SLO_API_ALERT_DEFAULT_ANNOTATIONS_JSON")
	if err != nil {
		return Config{}, err
	}

	if cfg.PostgresDSN == "" {
		return Config{}, fmt.Errorf("SLO_API_POSTGRES_DSN is required")
	}
	if cfg.ClickHouseDSN == "" {
		return Config{}, fmt.Errorf("SLO_API_CLICKHOUSE_DSN is required")
	}
	return cfg, nil
}

func getenv(key, fallback string) string {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	return v
}

func intEnv(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}

func durationEnv(key string, fallback time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return fallback
	}
	return d
}

func floatEnv(key string, fallback float64) float64 {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return fallback
	}
	return n
}

func boolEnv(key string, fallback bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(v)
	if err != nil {
		return fallback
	}
	return parsed
}

func jsonStringMapEnv(key string) (map[string]string, error) {
	v := os.Getenv(key)
	if v == "" {
		return map[string]string{}, nil
	}
	out := map[string]string{}
	if err := json.Unmarshal([]byte(v), &out); err != nil {
		return nil, fmt.Errorf("%s must be valid JSON object string map: %w", key, err)
	}
	return out, nil
}
