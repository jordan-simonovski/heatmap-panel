package grafana

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

type APIError struct {
	StatusCode int
	Body       string
}

func (e APIError) Error() string {
	if e.Body == "" {
		return fmt.Sprintf("grafana api error: status=%d", e.StatusCode)
	}
	return fmt.Sprintf("grafana api error: status=%d body=%s", e.StatusCode, e.Body)
}

func IsRetryable(err error) bool {
	apiErr, ok := err.(APIError)
	if !ok {
		return true
	}
	if apiErr.StatusCode == http.StatusTooManyRequests {
		return true
	}
	return apiErr.StatusCode >= 500
}

type Client struct {
	baseURL string
	token   string
	http    *http.Client
}

func NewClient(baseURL, token string, timeout time.Duration) *Client {
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		token:   token,
		http:    &http.Client{Timeout: timeout},
	}
}

type AlertRuleData struct {
	RefID      string         `json:"refId"`
	QueryType  string         `json:"queryType,omitempty"`
	Datasource map[string]any `json:"datasourceUid,omitempty"`
	Model      map[string]any `json:"model"`
	RelativeMs int64          `json:"relativeTimeRange,omitempty"`
}

type ProvisionedAlertRule struct {
	Uid          string            `json:"uid,omitempty"`
	Title        string            `json:"title"`
	Condition    string            `json:"condition,omitempty"`
	Data         []map[string]any  `json:"data,omitempty"`
	NoDataState  string            `json:"noDataState,omitempty"`
	ExecErrState string            `json:"execErrState,omitempty"`
	For          string            `json:"for,omitempty"`
	Annotations  map[string]string `json:"annotations,omitempty"`
	Labels       map[string]string `json:"labels,omitempty"`
	IsPaused     bool              `json:"isPaused,omitempty"`
}

type PutRuleGroupRequest struct {
	Name            string                 `json:"name"`
	IntervalSeconds int                    `json:"interval"`
	Rules           []ProvisionedAlertRule `json:"rules"`
}

func (c *Client) UpsertRuleGroup(ctx context.Context, folderUID, groupName string, intervalSeconds int, rules []ProvisionedAlertRule) error {
	path := fmt.Sprintf("/api/v1/provisioning/folder/%s/rule-groups/%s", url.PathEscape(folderUID), url.PathEscape(groupName))
	body := PutRuleGroupRequest{
		Name:            groupName,
		IntervalSeconds: intervalSeconds,
		Rules:           rules,
	}
	_, err := c.doJSON(ctx, http.MethodPut, path, body)
	return err
}

func (c *Client) DeleteRule(ctx context.Context, uid string) error {
	path := fmt.Sprintf("/api/v1/provisioning/alert-rules/%s", url.PathEscape(uid))
	_, err := c.doJSON(ctx, http.MethodDelete, path, nil)
	return err
}

func (c *Client) ListRules(ctx context.Context) ([]ProvisionedAlertRule, error) {
	body, err := c.doJSON(ctx, http.MethodGet, "/api/v1/provisioning/alert-rules", nil)
	if err != nil {
		return nil, err
	}
	var out []ProvisionedAlertRule
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func FilterRulesByLabels(rules []ProvisionedAlertRule, labels map[string]string) []ProvisionedAlertRule {
	var out []ProvisionedAlertRule
	for _, rule := range rules {
		if hasLabels(rule.Labels, labels) {
			out = append(out, rule)
		}
	}
	return out
}

func hasLabels(have, want map[string]string) bool {
	for k, v := range want {
		if have[k] != v {
			return false
		}
	}
	return true
}

func (c *Client) doJSON(ctx context.Context, method, path string, reqBody any) ([]byte, error) {
	tr := otel.Tracer("slo-control-plane/grafana")
	ctx, span := tr.Start(ctx, "grafana.api_request", trace.WithSpanKind(trace.SpanKindClient))
	defer span.End()
	span.SetAttributes(
		attribute.String("http.method", method),
		attribute.String("url.path", path),
	)

	var bodyReader io.Reader
	if reqBody != nil {
		raw, err := json.Marshal(reqBody)
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, err.Error())
			return nil, err
		}
		bodyReader = bytes.NewReader(raw)
		span.SetAttributes(attribute.Int("http.request.body_bytes", len(raw)))
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bodyReader)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, err
	}
	defer resp.Body.Close()
	span.SetAttributes(attribute.Int("http.status_code", resp.StatusCode))
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		span.SetStatus(codes.Error, "non-2xx response")
		return nil, APIError{StatusCode: resp.StatusCode, Body: string(body)}
	}
	return body, nil
}
