export interface SLODefinition {
  id: string;
  name: string;
  route: string;
  type: 'latency' | 'error_rate';
  /** For latency SLOs: p99 must be below this threshold (ms) */
  thresholdMs?: number;
  /** For error_rate SLOs: fraction of 5xx responses must be below this */
  thresholdRate?: number;
  /** Fraction of 1-minute windows that must meet the threshold (e.g. 0.99 = 99%) */
  target: number;
  /** Rolling window size in minutes */
  windowMinutes: number;
}

export const SLO_DEFINITIONS: SLODefinition[] = [
  {
    id: 'checkout-latency',
    name: 'Checkout Latency',
    route: '/cart/checkout',
    type: 'latency',
    thresholdMs: 500,
    target: 0.99,
    windowMinutes: 30,
  },
  {
    id: 'orders-error-rate',
    name: 'Orders Error Rate',
    route: '/api/orders',
    type: 'error_rate',
    thresholdRate: 0.01,
    target: 0.99,
    windowMinutes: 30,
  },
  {
    id: 'users-latency',
    name: 'Users Latency',
    route: '/api/users',
    type: 'latency',
    thresholdMs: 200,
    target: 0.99,
    windowMinutes: 30,
  },
  {
    id: 'auth-latency',
    name: 'Auth Latency',
    route: '/api/auth',
    type: 'latency',
    thresholdMs: 150,
    target: 0.995,
    windowMinutes: 30,
  },
  {
    id: 'search-error-rate',
    name: 'Search Error Rate',
    route: '/api/search',
    type: 'error_rate',
    thresholdRate: 0.005,
    target: 0.99,
    windowMinutes: 30,
  },
  {
    id: 'search-latency',
    name: 'Search Latency',
    route: '/api/search',
    type: 'latency',
    thresholdMs: 300,
    target: 0.99,
    windowMinutes: 30,
  },
];

export function getSLOById(id: string): SLODefinition | undefined {
  return SLO_DEFINITIONS.find((s) => s.id === id);
}

/** Build the ClickHouse SQL for a latency SLO timeseries (1-min buckets of p99) */
export function latencyTimeseriesSql(slo: SLODefinition): string {
  return `SELECT
  toStartOfInterval(Timestamp, INTERVAL 1 minute) AS time,
  quantile(0.99)(Duration / 1000000) AS p99_ms
FROM otel_traces
WHERE $__timeFilter(Timestamp)
  AND SpanAttributes['http.route'] = '${slo.route}'
  AND ServiceName = 'api-gateway'
GROUP BY time
ORDER BY time`;
}

/** Build the ClickHouse SQL for an error-rate SLO timeseries (1-min buckets) */
export function errorRateTimeseriesSql(slo: SLODefinition): string {
  return `SELECT
  toStartOfInterval(Timestamp, INTERVAL 1 minute) AS time,
  countIf(toInt32OrZero(SpanAttributes['http.status_code']) >= 500) / count() AS error_rate
FROM otel_traces
WHERE $__timeFilter(Timestamp)
  AND SpanAttributes['http.route'] = '${slo.route}'
  AND ServiceName = 'api-gateway'
GROUP BY time
ORDER BY time`;
}

/** Build the ClickHouse SQL for current compliance (single number) */
export function complianceSql(slo: SLODefinition): string {
  if (slo.type === 'latency') {
    return `SELECT
  1 - (countIf(p99_ms > ${slo.thresholdMs}) / count()) AS compliance
FROM (
  SELECT quantile(0.99)(Duration / 1000000) AS p99_ms
  FROM otel_traces
  WHERE Timestamp >= now() - INTERVAL ${slo.windowMinutes} MINUTE
    AND SpanAttributes['http.route'] = '${slo.route}'
    AND ServiceName = 'api-gateway'
  GROUP BY toStartOfInterval(Timestamp, INTERVAL 1 minute)
)`;
  }
  // error_rate
  return `SELECT
  1 - (countIf(err_rate > ${slo.thresholdRate}) / count()) AS compliance
FROM (
  SELECT countIf(toInt32OrZero(SpanAttributes['http.status_code']) >= 500) / count() AS err_rate
  FROM otel_traces
  WHERE Timestamp >= now() - INTERVAL ${slo.windowMinutes} MINUTE
    AND SpanAttributes['http.route'] = '${slo.route}'
    AND ServiceName = 'api-gateway'
  GROUP BY toStartOfInterval(Timestamp, INTERVAL 1 minute)
)`;
}

/** Build the ClickHouse SQL for error budget remaining */
export function errorBudgetSql(slo: SLODefinition): string {
  // error_budget = compliance - target; >0 means budget remaining, <0 means breached
  const inner = slo.type === 'latency'
    ? `SELECT quantile(0.99)(Duration / 1000000) AS metric
       FROM otel_traces
       WHERE Timestamp >= now() - INTERVAL ${slo.windowMinutes} MINUTE
         AND SpanAttributes['http.route'] = '${slo.route}'
         AND ServiceName = 'api-gateway'
       GROUP BY toStartOfInterval(Timestamp, INTERVAL 1 minute)`
    : `SELECT countIf(toInt32OrZero(SpanAttributes['http.status_code']) >= 500) / count() AS metric
       FROM otel_traces
       WHERE Timestamp >= now() - INTERVAL ${slo.windowMinutes} MINUTE
         AND SpanAttributes['http.route'] = '${slo.route}'
         AND ServiceName = 'api-gateway'
       GROUP BY toStartOfInterval(Timestamp, INTERVAL 1 minute)`;

  const threshold = slo.type === 'latency' ? slo.thresholdMs : slo.thresholdRate;
  return `SELECT
  (1 - (countIf(metric > ${threshold}) / count())) - ${slo.target} AS error_budget
FROM (${inner})`;
}
