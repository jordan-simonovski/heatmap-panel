package openslo

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	openslov1 "github.com/thisisibrahimd/openslo-go/pkg/openslo/v1"
	"gopkg.in/yaml.v3"
)

type Runtime struct {
	Name           string
	Description    string
	UserExperience string
	Target         float32
	WindowMinutes  int
	Route          string
	Type           string
	Threshold      float32
	DatasourceType string
	DatasourceUID  string
}

type Object struct {
	Kind string
	Name string
	JSON []byte
}

type Bundle struct {
	SLO     openslov1.Slo
	Runtime Runtime
	Objects []Object
}

type datasourceDef struct {
	Type string
	UID  string
}

func ParseBundle(raw string) (Bundle, error) {
	dec := yaml.NewDecoder(strings.NewReader(raw))
	objects := make([]Object, 0, 8)
	datasources := map[string]datasourceDef{}

	var slo *openslov1.Slo
	for {
		doc := map[string]any{}
		err := dec.Decode(&doc)
		if err != nil {
			if err.Error() == "EOF" {
				break
			}
			return Bundle{}, fmt.Errorf("invalid openslo yaml: %w", err)
		}
		if len(doc) == 0 {
			continue
		}
		rawJSON, err := json.Marshal(doc)
		if err != nil {
			return Bundle{}, fmt.Errorf("marshal openslo doc: %w", err)
		}

		kind, _ := doc["kind"].(string)
		name := metadataName(doc)
		switch strings.TrimSpace(kind) {
		case "SLO":
			if slo != nil {
				return Bundle{}, fmt.Errorf("expected exactly one SLO object, got multiple")
			}
			var parsed openslov1.Slo
			if err := json.Unmarshal(rawJSON, &parsed); err != nil {
				return Bundle{}, fmt.Errorf("invalid SLO object: %w", err)
			}
			slo = &parsed
		case "SLI":
			var parsed openslov1.Sli
			if err := json.Unmarshal(rawJSON, &parsed); err != nil {
				return Bundle{}, fmt.Errorf("invalid SLI object: %w", err)
			}
		case "DataSource", "Datasource":
			md, ok := doc["metadata"].(map[string]any)
			if !ok {
				return Bundle{}, fmt.Errorf("invalid DataSource object: missing metadata")
			}
			dsName := strings.TrimSpace(toString(md["name"]))
			if dsName == "" {
				return Bundle{}, fmt.Errorf("invalid DataSource object: metadata.name required")
			}
			spec, ok := doc["spec"].(map[string]any)
			if !ok {
				return Bundle{}, fmt.Errorf("invalid DataSource object %q: missing spec", dsName)
			}
			conn, _ := spec["connectionDetails"].(map[string]any)
			datasources[dsName] = datasourceDef{
				Type: strings.TrimSpace(toString(spec["type"])),
				UID:  extractDatasourceUID(conn),
			}
		case "AlertPolicy":
			var parsed openslov1.AlertPolicy
			if err := json.Unmarshal(rawJSON, &parsed); err != nil {
				return Bundle{}, fmt.Errorf("invalid AlertPolicy object: %w", err)
			}
		case "AlertCondition":
			var parsed openslov1.AlertCondition
			if err := json.Unmarshal(rawJSON, &parsed); err != nil {
				return Bundle{}, fmt.Errorf("invalid AlertCondition object: %w", err)
			}
		case "AlertNotificationTarget":
			var parsed openslov1.AlertNotificationTarget
			if err := json.Unmarshal(rawJSON, &parsed); err != nil {
				return Bundle{}, fmt.Errorf("invalid AlertNotificationTarget object: %w", err)
			}
		case "Service":
			var parsed openslov1.Service
			if err := json.Unmarshal(rawJSON, &parsed); err != nil {
				return Bundle{}, fmt.Errorf("invalid Service object: %w", err)
			}
		default:
			return Bundle{}, fmt.Errorf("unsupported OpenSLO kind %q", kind)
		}
		objects = append(objects, Object{Kind: kind, Name: name, JSON: rawJSON})
	}
	if slo == nil {
		return Bundle{}, fmt.Errorf("bundle must include exactly one SLO object")
	}
	rt, err := compileRuntime(*slo, datasources)
	if err != nil {
		return Bundle{}, err
	}
	return Bundle{
		SLO:     *slo,
		Runtime: rt,
		Objects: objects,
	}, nil
}

func compileRuntime(slo openslov1.Slo, datasources map[string]datasourceDef) (Runtime, error) {
	rt := Runtime{
		Name: strings.TrimSpace(slo.Metadata.Name),
		Type: "latency",
	}
	if slo.Metadata.DisplayName != nil && strings.TrimSpace(*slo.Metadata.DisplayName) != "" {
		rt.Name = strings.TrimSpace(*slo.Metadata.DisplayName)
	}
	if rt.Name == "" {
		return Runtime{}, fmt.Errorf("slo metadata.name is required")
	}
	if slo.Spec.Description != nil {
		rt.Description = strings.TrimSpace(*slo.Spec.Description)
	}
	if len(slo.Spec.Objectives) == 0 || slo.Spec.Objectives[0].Target == nil {
		return Runtime{}, fmt.Errorf("slo objective target is required")
	}
	rt.Target = *slo.Spec.Objectives[0].Target
	if rt.Target <= 0 || rt.Target >= 1 {
		return Runtime{}, fmt.Errorf("slo target must be between 0 and 1")
	}

	rt.WindowMinutes = 30
	if len(slo.Spec.TimeWindow) > 0 && strings.TrimSpace(slo.Spec.TimeWindow[0].Duration) != "" {
		minutes, err := durationToMinutes(slo.Spec.TimeWindow[0].Duration)
		if err != nil {
			return Runtime{}, err
		}
		rt.WindowMinutes = minutes
	}

	if slo.Metadata.Annotations != nil {
		ann := *slo.Metadata.Annotations
		rt.UserExperience = strings.TrimSpace(ann["heatmap.local/userExperience"])
	}

	if slo.Spec.Indicator == nil || slo.Spec.Indicator.Spec == nil || slo.Spec.Indicator.Spec.ThresholdMetric == nil || slo.Spec.Indicator.Spec.ThresholdMetric.MetricSource == nil {
		return Runtime{}, fmt.Errorf("slo indicator.thresholdMetric.metricSource is required")
	}
	spec := slo.Spec.Indicator.Spec.ThresholdMetric.MetricSource.Spec
	rt.Route = toString(spec["route"])
	rt.Type = toString(spec["type"])
	rt.Threshold = toFloat32(spec["threshold"])
	rt.DatasourceUID = toString(spec["datasourceUid"])
	rt.DatasourceType = toString(spec["datasourceType"])
	if ref := strings.TrimSpace(slo.Spec.Indicator.Spec.ThresholdMetric.MetricSource.GetMetricSourceRef()); ref != "" {
		if ds, ok := datasources[ref]; ok {
			if rt.DatasourceType == "" {
				rt.DatasourceType = ds.Type
			}
			if rt.DatasourceUID == "" {
				rt.DatasourceUID = ds.UID
			}
		}
	}
	if rt.Route == "" || rt.Type == "" || rt.Threshold <= 0 || rt.DatasourceUID == "" || rt.DatasourceType == "" {
		return Runtime{}, fmt.Errorf("indicator metricSource.spec must include route,type,threshold,datasourceUid,datasourceType")
	}
	if rt.Type != "latency" && rt.Type != "error_rate" {
		return Runtime{}, fmt.Errorf("unsupported indicator type %q", rt.Type)
	}
	return rt, nil
}

func extractDatasourceUID(connectionDetails map[string]interface{}) string {
	if len(connectionDetails) == 0 {
		return ""
	}
	if v, ok := connectionDetails["uid"]; ok {
		return toString(v)
	}
	if v, ok := connectionDetails["datasourceUid"]; ok {
		return toString(v)
	}
	return ""
}

func metadataName(doc map[string]any) string {
	md, ok := doc["metadata"].(map[string]any)
	if !ok {
		return ""
	}
	name, _ := md["name"].(string)
	return strings.TrimSpace(name)
}

func toString(v any) string {
	if s, ok := v.(string); ok {
		return strings.TrimSpace(s)
	}
	return ""
}

func toFloat32(v any) float32 {
	switch n := v.(type) {
	case float64:
		return float32(n)
	case float32:
		return n
	case int:
		return float32(n)
	case int64:
		return float32(n)
	case string:
		f, _ := strconv.ParseFloat(strings.TrimSpace(n), 32)
		return float32(f)
	default:
		return 0
	}
}

func durationToMinutes(raw string) (int, error) {
	if len(raw) < 2 {
		return 0, fmt.Errorf("invalid timeWindow duration %q", raw)
	}
	unit := raw[len(raw)-1]
	n, err := strconv.Atoi(raw[:len(raw)-1])
	if err != nil || n <= 0 {
		return 0, fmt.Errorf("invalid timeWindow duration %q", raw)
	}
	switch unit {
	case 'm':
		return n, nil
	case 'h':
		return n * 60, nil
	case 'd':
		return n * 24 * 60, nil
	default:
		return 0, fmt.Errorf("unsupported timeWindow duration unit %q", string(unit))
	}
}

func RuntimeToMap(rt Runtime) map[string]any {
	m := map[string]any{
		"name":           rt.Name,
		"target":         rt.Target,
		"windowMinutes":  rt.WindowMinutes,
		"route":          rt.Route,
		"type":           rt.Type,
		"threshold":      rt.Threshold,
		"datasourceType": rt.DatasourceType,
		"datasourceUid":  rt.DatasourceUID,
	}
	if rt.Description != "" {
		m["description"] = rt.Description
	}
	if rt.UserExperience != "" {
		m["userExperience"] = rt.UserExperience
	}
	return m
}

func MapToRuntime(v map[string]any) Runtime {
	rt := Runtime{
		Name:           toString(v["name"]),
		Description:    toString(v["description"]),
		UserExperience: toString(v["userExperience"]),
		Target:         toFloat32(v["target"]),
		WindowMinutes:  int(toFloat32(v["windowMinutes"])),
		Route:          toString(v["route"]),
		Type:           toString(v["type"]),
		Threshold:      toFloat32(v["threshold"]),
		DatasourceType: toString(v["datasourceType"]),
		DatasourceUID:  toString(v["datasourceUid"]),
	}
	if rt.WindowMinutes <= 0 {
		rt.WindowMinutes = 30
	}
	return rt
}

func MarshalObjectsJSON(objects []Object) ([]byte, error) {
	type outObj struct {
		Kind string          `json:"kind"`
		Name string          `json:"name"`
		JSON json.RawMessage `json:"json"`
	}
	out := make([]outObj, 0, len(objects))
	for _, o := range objects {
		out = append(out, outObj{Kind: o.Kind, Name: o.Name, JSON: o.JSON})
	}
	return json.Marshal(out)
}

func UnmarshalObjectsJSON(blob []byte) ([]Object, error) {
	type inObj struct {
		Kind string          `json:"kind"`
		Name string          `json:"name"`
		JSON json.RawMessage `json:"json"`
	}
	var in []inObj
	if len(bytes.TrimSpace(blob)) == 0 {
		return nil, nil
	}
	if err := json.Unmarshal(blob, &in); err != nil {
		return nil, err
	}
	out := make([]Object, 0, len(in))
	for _, o := range in {
		out = append(out, Object{Kind: o.Kind, Name: o.Name, JSON: o.JSON})
	}
	return out, nil
}
