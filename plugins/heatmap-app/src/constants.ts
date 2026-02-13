import pluginJson from './plugin.json';

export const PLUGIN_BASE_URL = `/a/${pluginJson.id}`;

export enum ROUTES {
  Bubbles = 'bubbles',
}

export const CLICKHOUSE_DS = {
  uid: 'clickhouse',
  type: 'grafana-clickhouse-datasource',
};

// Attributes to compare in Bubbles view
export const COMPARISON_ATTRIBUTES = [
  'http.route',
  'http.method',
  'http.status_code',
  'service.name',
  'host.region',
  'app.build_id',
  'app.platform',
  'app.feature_flag',
  'app.tenant_id',
  'user.id',
  'db.system',
  'k8s.pod.name',
];
