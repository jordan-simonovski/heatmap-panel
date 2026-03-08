package main

import (
	"context"
	"database/sql"
	"flag"
	"log"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/config"
	"github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/evaluator"
	"github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/store"
)

func main() {
	once := flag.Bool("once", false, "run a single evaluation pass and exit")
	flag.Parse()

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
	if err := store.RunMigrations(ctx, db, filepath.Join("migrations")); err != nil {
		log.Fatalf("run migrations: %v", err)
	}

	st := store.New(db)
	ev, err := evaluator.New(st, cfg.ClickHouseDSN, evaluator.Config{
		Interval:              cfg.EvaluatorInterval,
		ContinueInterval:      cfg.EvaluatorContinueInterval,
		FastWindowMinutes:     cfg.EvaluatorFastWindowMin,
		SlowWindowMinutes:     cfg.EvaluatorSlowWindowMin,
		FastBurnRateThreshold: cfg.EvaluatorFastBurnRate,
		SlowBurnRateThreshold: cfg.EvaluatorSlowBurnRate,
	})
	if err != nil {
		log.Fatalf("evaluator init: %v", err)
	}
	defer ev.Close()

	if *once {
		if err := ev.EvaluateOnce(ctx); err != nil {
			log.Fatalf("evaluate once: %v", err)
		}
		log.Printf("slo-evaluator completed single pass")
		return
	}

	log.Printf(
		"slo-evaluator running interval=%s continue_interval=%s fast_window=%dm slow_window=%dm fast_rate=%.2f slow_rate=%.2f",
		cfg.EvaluatorInterval,
		cfg.EvaluatorContinueInterval,
		cfg.EvaluatorFastWindowMin,
		cfg.EvaluatorSlowWindowMin,
		cfg.EvaluatorFastBurnRate,
		cfg.EvaluatorSlowBurnRate,
	)
	ev.Run(ctx)
	log.Printf("slo-evaluator stopped")
	time.Sleep(100 * time.Millisecond)
}
