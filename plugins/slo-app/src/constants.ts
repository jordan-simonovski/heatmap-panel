import pluginJson from './plugin.json';

export const PLUGIN_BASE_URL = `/a/${pluginJson.id}`;

export enum ROUTES {
  Overview = 'overview',
  Detail = 'slo/:id',
}

export const CLICKHOUSE_DS = {
  uid: 'clickhouse',
  type: 'grafana-clickhouse-datasource',
};

