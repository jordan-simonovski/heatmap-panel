# Grafana SLO Burn Alert Queries

Use these SQL queries in Grafana Alerting (ClickHouse datasource `clickhouse`).

## 1) Steep burn active

Alert when at least one SLO currently has a `fast` burn event that is not resolved.

```sql
SELECT
  now() AS time,
  count() AS steep_burns
FROM (
  SELECT
    slo_id,
    argMax(event_type, observed_at) AS last_event_type,
    argMax(source, observed_at) AS last_source
  FROM slo_burn_events
  GROUP BY slo_id
)
WHERE last_event_type != 'burn_resolved'
  AND endsWith(last_source, ':fast')
```

Condition: `steep_burns > 0`

## 2) Gradual burn active

Alert when at least one SLO currently has a `slow` burn event that is not resolved.

```sql
SELECT
  now() AS time,
  count() AS slow_burns
FROM (
  SELECT
    slo_id,
    argMax(event_type, observed_at) AS last_event_type,
    argMax(source, observed_at) AS last_source
  FROM slo_burn_events
  GROUP BY slo_id
)
WHERE last_event_type != 'burn_resolved'
  AND endsWith(last_source, ':slow')
```

Condition: `slow_burns > 0`

## 3) Error-budget exhaustion ETA

Estimate ETA from latest burn-rate event:

- fast severity uses 5-minute window
- slow severity uses 60-minute window
- ETA seconds = `(window_minutes * 60) / burn_rate`

```sql
SELECT
  now() AS time,
  min(eta_seconds) AS min_eta_seconds
FROM (
  SELECT
    slo_id,
    argMax(event_type, observed_at) AS last_event_type,
    argMax(source, observed_at) AS last_source,
    argMax(value, observed_at) AS burn_rate
  FROM slo_burn_events
  GROUP BY slo_id
)
ARRAY JOIN
  [if(endsWith(last_source, ':fast'), 5, 60)] AS window_minutes
LEFT ARRAY JOIN
  [if(burn_rate > 0, intDiv(window_minutes * 60, burn_rate), 2147483647)] AS eta_seconds
WHERE last_event_type != 'burn_resolved'
  AND (endsWith(last_source, ':fast') OR endsWith(last_source, ':slow'))
```

Recommended condition:

- warning: `min_eta_seconds < 21600` (6h)
- critical: `min_eta_seconds < 3600` (1h)

## Notes

- These queries use `slo_burn_events` (ClickHouse) and rely on source suffixes `:fast` / `:slow`.
- If there are no active burns, counts are zero and ETA will be empty.
