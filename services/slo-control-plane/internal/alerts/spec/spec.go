package spec

import (
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	openslov1 "github.com/thisisibrahimd/openslo-go/pkg/openslo/v1"

	"github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/grafana"
	opensloparser "github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/openslo"
	"github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/store"
)

type BuildOptions struct {
	FolderUID          string
	GroupPrefix        string
	DefaultLabels      map[string]string
	DefaultAnnotations map[string]string
}

type DesiredRuleSpec struct {
	AlertKind string
	GroupName string
	RuleUID   string
	Rule      grafana.ProvisionedAlertRule
	SpecHash  string
}

type alertConfig struct {
	Name      string
	AlertKind string
	Severity  string
	Op        string
	Threshold float64
	For       string
}

func BuildDesiredRules(in store.SLOReconcileInput, opts BuildOptions) ([]DesiredRuleSpec, error) {
	if in.DatasourceUID == "" {
		return nil, fmt.Errorf("slo %s has empty datasource uid", in.ID)
	}
	configs, err := alertsFromOpenSLO(in.OpenSLO)
	if err != nil {
		return nil, err
	}
	if len(configs) == 0 {
		return []DesiredRuleSpec{}, nil
	}
	group := buildGroupName(opts.GroupPrefix, in.ID.String())
	baseLabels := mergeLabels(opts.DefaultLabels, alertingStringMap(in.ServiceMetadata, "labels"))
	baseAnnotations := mergeLabels(opts.DefaultAnnotations, alertingStringMap(in.ServiceMetadata, "annotations"))
	baseLabels["managed_by"] = "slo-control-plane"
	baseLabels["slo_id"] = in.ID.String()
	baseLabels["service_id"] = in.ServiceID.String()

	out := make([]DesiredRuleSpec, 0, len(configs))
	for _, cfg := range configs {
		labels := withKind(baseLabels, cfg.AlertKind)
		if cfg.Severity != "" {
			labels["severity"] = cfg.Severity
		}
		labels["alert_condition"] = cfg.Name
		rule := grafana.ProvisionedAlertRule{
			Uid:       buildRuleUID(in.ID.String(), cfg.AlertKind+"-"+cfg.Name),
			Title:     fmt.Sprintf("SLO %s: %s", strings.Title(cfg.AlertKind), in.Name),
			Condition: "A",
			Data: []map[string]any{
				clickhouseQuery("A", in.DatasourceUID, buildConditionQuery(in.ID.String(), cfg)),
			},
			For:          cfg.For,
			NoDataState:  "NoData",
			ExecErrState: "Alerting",
			Labels:       labels,
			Annotations:  baseAnnotations,
		}
		h, err := stableRuleHash(group, rule)
		if err != nil {
			return nil, err
		}
		out = append(out, DesiredRuleSpec{
			AlertKind: cfg.AlertKind,
			GroupName: group,
			RuleUID:   rule.Uid,
			Rule:      rule,
			SpecHash:  h,
		})
	}
	return out, nil
}

func buildConditionQuery(sloID string, cfg alertConfig) string {
	if cfg.AlertKind == store.AlertKindBreach {
		return fmt.Sprintf(`SELECT now() AS time, count() AS active_breaches
FROM (
  SELECT argMax(event_type, observed_at) AS last_event_type
  FROM slo_burn_events
  WHERE slo_id = '%s'
)
WHERE last_event_type = 'error_budget_exhausted'`, sloID)
	}
	return fmt.Sprintf(`SELECT now() AS time, count() AS active_burns
FROM (
  SELECT
    argMax(event_type, observed_at) AS last_event_type,
    argMax(value, observed_at) AS last_burn_rate
  FROM slo_burn_events
  WHERE slo_id = '%s'
)
WHERE last_event_type IN ('burn_started', 'burn_continued', 'error_budget_exhausted')
  AND last_burn_rate %s %g`, sloID, sqlOp(cfg.Op), cfg.Threshold)
}

func clickhouseQuery(refID, datasourceUID, sqlExpr string) map[string]any {
	return map[string]any{
		"refId": refID,
		"relativeTimeRange": map[string]any{
			"from": 300,
			"to":   0,
		},
		"datasourceUid": datasourceUID,
		"model": map[string]any{
			"format":    "table",
			"rawSql":    sqlExpr,
			"refId":     refID,
			"queryType": "sql",
		},
	}
}

func withKind(base map[string]string, kind string) map[string]string {
	out := map[string]string{}
	for k, v := range base {
		out[k] = v
	}
	out["alert_kind"] = kind
	if kind == store.AlertKindBreach {
		out["severity"] = "critical"
	}
	return out
}

func mergeLabels(base map[string]string, override map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range base {
		out[k] = v
	}
	for k, v := range override {
		out[k] = v
	}
	return out
}

func alertingStringMap(metadata map[string]any, key string) map[string]string {
	rawAlerting, ok := metadata["alerting"].(map[string]any)
	if !ok {
		return map[string]string{}
	}
	rawMap, ok := rawAlerting[key].(map[string]any)
	if !ok {
		return map[string]string{}
	}
	out := map[string]string{}
	for k, v := range rawMap {
		if s, ok := v.(string); ok && s != "" {
			out[k] = s
		}
	}
	return out
}

func buildGroupName(prefix, serviceID string) string {
	base := strings.TrimSpace(prefix)
	if base == "" {
		base = "slo"
	}
	return fmt.Sprintf("%s-%s", base, serviceID[:8])
}

func buildRuleUID(sloID, kind string) string {
	sum := md5.Sum([]byte(sloID + ":" + kind))
	// Grafana provisioning enforces UID length <= 40. Keep a short deterministic UID.
	return fmt.Sprintf("slo-%s-%s", shortKind(kind), hex.EncodeToString(sum[:8]))
}

func shortKind(kind string) string {
	if kind == store.AlertKindBreach {
		return "br"
	}
	return "bn"
}

func alertsFromOpenSLO(raw string) ([]alertConfig, error) {
	bundle, err := opensloparser.ParseBundle(raw)
	if err != nil {
		return nil, err
	}
	chosenByKind := map[string]alertConfig{}
	for _, obj := range bundle.Objects {
		if obj.Kind != "AlertCondition" {
			continue
		}
		var cond openslov1.AlertCondition
		if err := json.Unmarshal(obj.JSON, &cond); err != nil {
			return nil, fmt.Errorf("invalid alert condition object %q: %w", obj.Name, err)
		}
		cfg := alertConfig{
			Name:      cond.Metadata.Name,
			Severity:  strings.TrimSpace(cond.Spec.Severity),
			Op:        string(cond.Spec.Condition.GetOp()),
			Threshold: float64(cond.Spec.Condition.GetThreshold()),
			For:       cond.Spec.Condition.GetAlertAfter(),
		}
		if cfg.Name == "" {
			cfg.Name = "unnamed-condition"
		}
		if cfg.Op == "" {
			cfg.Op = "gte"
		}
		if cfg.Threshold <= 0 {
			cfg.Threshold = 1.0
		}
		if cfg.For == "" {
			cfg.For = "2m"
		}
		lc := strings.ToLower(cfg.Name + " " + cfg.Severity)
		cfg.AlertKind = store.AlertKindBurn
		if strings.Contains(lc, "breach") || strings.Contains(lc, "exhaust") || strings.Contains(lc, "critical") {
			cfg.AlertKind = store.AlertKindBreach
		}
		if _, exists := chosenByKind[cfg.AlertKind]; !exists {
			chosenByKind[cfg.AlertKind] = cfg
		}
	}
	out := make([]alertConfig, 0, len(chosenByKind))
	if cfg, ok := chosenByKind[store.AlertKindBurn]; ok {
		out = append(out, cfg)
	}
	if cfg, ok := chosenByKind[store.AlertKindBreach]; ok {
		out = append(out, cfg)
	}
	return out, nil
}

func sqlOp(op string) string {
	switch strings.ToLower(strings.TrimSpace(op)) {
	case "lt":
		return "<"
	case "lte":
		return "<="
	case "gt":
		return ">"
	default:
		return ">="
	}
}

func stableRuleHash(group string, rule grafana.ProvisionedAlertRule) (string, error) {
	payload := map[string]any{
		"group": group,
		"rule":  rule,
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}
