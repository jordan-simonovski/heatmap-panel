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
	httpapi "github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/http"
	"github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/outbox"
	"github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/store"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

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

	router := chi.NewRouter()
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
