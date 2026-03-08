package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/config"
	opensloparser "github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/openslo"
	"github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/store"
)

func main() {
	ctx := context.Background()
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	db, err := sql.Open("pgx", cfg.PostgresDSN)
	if err != nil {
		log.Fatalf("postgres open: %v", err)
	}
	defer db.Close()
	if err := db.PingContext(ctx); err != nil {
		log.Fatalf("postgres ping: %v", err)
	}
	if err := store.RunMigrations(ctx, db, filepath.Join("migrations")); err != nil {
		log.Fatalf("run migrations: %v", err)
	}
	st := store.New(db)

	slos, err := st.ListAllSLOs(ctx)
	if err != nil {
		log.Fatalf("list slos: %v", err)
	}
	var failures []string
	updated := 0
	for _, slo := range slos {
		bundle, err := opensloparser.ParseBundle(slo.OpenSLO)
		if err != nil {
			legacy, convErr := buildLegacyOpenSLO(slo)
			if convErr != nil {
				failures = append(failures, fmt.Sprintf("%s: %v (and legacy conversion failed: %v)", slo.ID, err, convErr))
				continue
			}
			bundle, err = opensloparser.ParseBundle(legacy)
			if err != nil {
				failures = append(failures, fmt.Sprintf("%s: converted openslo invalid: %v", slo.ID, err))
				continue
			}
			slo.OpenSLO = legacy
		}

		slo.Name = bundle.Runtime.Name
		slo.Description = bundle.Runtime.Description
		slo.Target = bundle.Runtime.Target
		slo.WindowMinutes = bundle.Runtime.WindowMinutes
		slo.DatasourceType = bundle.Runtime.DatasourceType
		slo.DatasourceUID = bundle.Runtime.DatasourceUID
		slo.Canonical = opensloparser.RuntimeToMap(bundle.Runtime)

		tx, err := st.BeginTx(ctx)
		if err != nil {
			failures = append(failures, fmt.Sprintf("%s: begin tx failed: %v", slo.ID, err))
			continue
		}
		_, err = st.UpdateSLO(ctx, tx, slo)
		if err == nil {
			err = st.ReplaceSLOOpenSLOObjectsTx(ctx, tx, slo.ID, toStoreObjects(bundle.Objects))
		}
		if err == nil {
			err = tx.Commit()
		} else {
			_ = tx.Rollback()
		}
		if err != nil {
			failures = append(failures, fmt.Sprintf("%s: update failed: %v", slo.ID, err))
			continue
		}
		updated++
	}

	log.Printf("openslo migration updated %d rows", updated)
	if len(failures) > 0 {
		for _, f := range failures {
			log.Printf("migration failure: %s", f)
		}
		os.Exit(1)
	}
}

func toStoreObjects(objs []opensloparser.Object) []store.OpenSLOObject {
	out := make([]store.OpenSLOObject, 0, len(objs))
	for _, obj := range objs {
		out = append(out, store.OpenSLOObject{Kind: obj.Kind, Name: obj.Name, JSON: obj.JSON})
	}
	return out
}

func buildLegacyOpenSLO(slo store.SLO) (string, error) {
	name := sanitizeName(firstNonEmpty(slo.Name, "migrated-slo"))
	display := firstNonEmpty(slo.Name, name)
	desc := firstNonEmpty(slo.Description, "Migrated legacy SLO")
	target := slo.Target
	if target <= 0 {
		target = 0.99
	}
	window := slo.WindowMinutes
	if window <= 0 {
		window = 30
	}
	dsUID := firstNonEmpty(slo.DatasourceUID, "clickhouse")
	dsType := firstNonEmpty(slo.DatasourceType, "clickhouse")
	route := stringFromAny(slo.Canonical["route"])
	sloType := stringFromAny(slo.Canonical["type"])
	threshold := numberFromAny(slo.Canonical["threshold"])
	if threshold <= 0 {
		if sloType == "error_rate" {
			threshold = numberFromAny(slo.Canonical["thresholdRate"])
		} else {
			threshold = numberFromAny(slo.Canonical["thresholdMs"])
		}
	}
	if route == "" || sloType == "" || threshold <= 0 {
		return "", fmt.Errorf("missing route/type/threshold in legacy canonical")
	}
	ux := stringFromAny(slo.Canonical["userExperience"])

	return fmt.Sprintf(`apiVersion: openslo/v1
kind: SLO
metadata:
  name: %s
  displayName: %s
  annotations:
    heatmap.local/userExperience: %s
spec:
  description: %s
  service: migrated-service
  budgetingMethod: Occurrences
  objectives:
    - target: %.4f
  timeWindow:
    - duration: %dm
      isRolling: true
  indicator:
    metadata:
      name: %s-indicator
    spec:
      thresholdMetric:
        metricSource:
          type: %s
          spec:
            route: %s
            type: %s
            threshold: %g
            datasourceUid: %s
            datasourceType: %s
`, name, yamlSafe(display), yamlSafe(firstNonEmpty(ux, display)), yamlSafe(desc), target, window, name, yamlSafe(dsType), yamlSafe(route), yamlSafe(sloType), threshold, yamlSafe(dsUID), yamlSafe(dsType)), nil
}

func sanitizeName(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var out []rune
	lastDash := false
	for _, r := range s {
		ok := (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')
		if ok {
			out = append(out, r)
			lastDash = false
			continue
		}
		if !lastDash {
			out = append(out, '-')
			lastDash = true
		}
	}
	name := strings.Trim(string(out), "-")
	if name == "" {
		return "migrated-slo"
	}
	return name
}

func stringFromAny(v any) string {
	if s, ok := v.(string); ok {
		return strings.TrimSpace(s)
	}
	return ""
}

func numberFromAny(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case float32:
		return float64(n)
	case int:
		return float64(n)
	default:
		return 0
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		v = strings.TrimSpace(v)
		if v != "" {
			return v
		}
	}
	return ""
}

func yamlSafe(v string) string {
	return strings.ReplaceAll(v, "\n", " ")
}
