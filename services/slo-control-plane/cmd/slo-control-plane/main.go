package main

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	_ "github.com/jackc/pgx/v5/stdlib"

	apiv1 "github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/api"
	"github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/burn"
	"github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/config"
	"github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/grafana"
	httpapi "github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/http"
	"github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/outbox"
	"github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/reconciler"
	"github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/store"
	"github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/telemetry"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	otelShutdown, err := telemetry.Init(context.Background(), telemetry.Config{
		ServiceName:  cfg.OTelServiceName,
		OTLPEndpoint: cfg.OTelExporterOTLPEndpoint,
		Insecure:     cfg.OTelExporterOTLPInsecure,
	})
	if err != nil {
		log.Fatalf("telemetry init: %v", err)
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = otelShutdown(shutdownCtx)
	}()

	db, err := sql.Open("pgx", cfg.PostgresDSN)
	if err != nil {
		log.Fatalf("postgres open: %v", err)
	}
	defer db.Close()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if err := db.PingContext(ctx); err != nil {
		log.Fatalf("postgres ping: %v", err)
	}
	migrationsDir := filepath.Join("migrations")
	if err := store.RunMigrations(ctx, db, migrationsDir); err != nil {
		log.Fatalf("run migrations: %v", err)
	}

	burnSink, err := burn.New(cfg.ClickHouseDSN)
	if err != nil {
		log.Fatalf("clickhouse sink: %v", err)
	}
	defer burnSink.Close()
	if err := burnSink.EnsureTable(ctx); err != nil {
		log.Fatalf("ensure clickhouse table: %v", err)
	}

	st := store.New(db)
	server := httpapi.NewServer(st)
	worker := outbox.NewWorker(st, burnSink, cfg.OutboxPollInterval, cfg.OutboxBatchSize)
	go worker.Run(ctx)
	if cfg.GrafanaURL != "" {
		grafanaClient := grafana.NewClient(cfg.GrafanaURL, cfg.GrafanaToken, cfg.GrafanaHTTPTimeout)
		alertWorker := reconciler.NewWorker(st, grafanaClient, reconciler.Config{
			PollInterval:       cfg.AlertReconcilerPollInterval,
			BatchSize:          cfg.AlertReconcilerBatchSize,
			FolderUID:          cfg.GrafanaFolderUID,
			GroupPrefix:        "slo",
			RuleIntervalSecond: 60,
			DefaultLabels:      cfg.AlertDefaultLabels,
			DefaultAnnotations: cfg.AlertDefaultAnnotations,
		})
		go alertWorker.Run(ctx)
	}

	router := chi.NewRouter()
	router.Use(httpapi.WithTracing)
	r := httpapi.WithCORS(apiv1.HandlerFromMux(server, router))
	httpServer := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), time.Duration(cfg.ShutdownGraceSeconds)*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdownCtx)
	}()

	log.Printf("slo-control-plane listening on %s", cfg.HTTPAddr)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("http server: %v", err)
	}
}
