import pluginJson from './plugin.json';

export const PLUGIN_BASE_URL = `/a/${pluginJson.id}`;

export enum ROUTES {
  Bubbles = 'bubbles',
  Trace = 'bubbles/trace',
}

export const CLICKHOUSE_DS = {
  uid: 'clickhouse',
  type: 'grafana-clickhouse-datasource',
};

