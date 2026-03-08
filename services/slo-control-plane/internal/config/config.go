package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	HTTPAddr             string
	PostgresDSN          string
	ClickHouseDSN        string
	OutboxPollInterval   time.Duration
	OutboxBatchSize      int
	ShutdownGraceSeconds int
}

func Load() (Config, error) {
	cfg := Config{
		HTTPAddr:             getenv("SLO_API_HTTP_ADDR", ":8080"),
		PostgresDSN:          os.Getenv("SLO_API_POSTGRES_DSN"),
		ClickHouseDSN:        os.Getenv("SLO_API_CLICKHOUSE_DSN"),
		OutboxPollInterval:   durationEnv("SLO_API_OUTBOX_POLL_INTERVAL", 5*time.Second),
		OutboxBatchSize:      intEnv("SLO_API_OUTBOX_BATCH_SIZE", 100),
		ShutdownGraceSeconds: intEnv("SLO_API_SHUTDOWN_GRACE_SECONDS", 10),
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
