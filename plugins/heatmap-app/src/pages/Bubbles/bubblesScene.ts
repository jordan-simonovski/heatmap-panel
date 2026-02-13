import {
  AdHocFiltersVariable,
  EmbeddedScene,
  QueryVariable,
  SceneControlsSpacer,
  SceneFlexItem,
  SceneFlexLayout,
  SceneQueryRunner,
  SceneRefreshPicker,
  SceneTimePicker,
  SceneTimeRange,
  SceneVariableSet,
  VariableValueSelectors,
  VizPanel,
} from '@grafana/scenes';
import { CLICKHOUSE_DS, COMPARISON_ATTRIBUTES } from '../../constants';
import { SelectionState } from '../../components/Bubbles/SelectionState';
import { AttributeComparisonPanel } from '../../components/Bubbles/AttributeComparisonPanel';

/**
 * Build the heatmap SQL with the current service + ad-hoc filter state baked in.
 * We do NOT use ${filters:raw} because the ClickHouse datasource SQL parser
 * chokes on the table.column dot-notation it produces.
 */
function buildHeatmapSql(serviceVar: QueryVariable, adHocFilters: AdHocFiltersVariable): string {
  const parts: string[] = [];

  const svc = String(serviceVar.state.value ?? '%');
  if (svc && svc !== '' && svc !== '$__all') {
    parts.push(`ServiceName = '${svc}'`);
  }

  for (const f of adHocFilters.state.filters) {
    if (f.operator === '=') {
      parts.push(`SpanAttributes['${f.key}'] = '${f.value}'`);
    } else if (f.operator === '!=') {
      parts.push(`SpanAttributes['${f.key}'] != '${f.value}'`);
    }
  }

  const extra = parts.length > 0 ? '\n          AND ' + parts.join('\n          AND ') : '';

  return `SELECT
          Timestamp as timestamp,
          Duration / 1000000 as duration,
          TraceId as traceId
        FROM otel_traces
        WHERE $__timeFilter(Timestamp)${extra}
        ORDER BY Timestamp
        LIMIT 10000`;
}

export function bubblesScene() {
  const timeRange = new SceneTimeRange({
    from: 'now-15m',
    to: 'now',
  });

  const serviceVar = new QueryVariable({
    name: 'service',
    label: 'Service',
    datasource: CLICKHOUSE_DS,
    query: {
      rawSql: `SELECT DISTINCT ServiceName FROM otel_traces WHERE ServiceName != '' ORDER BY ServiceName`,
      format: 1,
      queryType: 'sql',
      refId: 'serviceVar',
    } as any,
    defaultToAll: true,
    includeAll: true,
    allValue: '%',
  });

  const adHocFilters = new AdHocFiltersVariable({
    name: 'filters',
    label: 'Filters',
    datasource: CLICKHOUSE_DS,
    applyMode: 'manual',
    defaultKeys: COMPARISON_ATTRIBUTES.map((a) => ({ text: a, value: a })),
    filters: [],
  });

  const heatmapQuery = new SceneQueryRunner({
    datasource: CLICKHOUSE_DS,
    queries: [
      {
        refId: 'heatmap',
        datasource: CLICKHOUSE_DS,
        rawSql: buildHeatmapSql(serviceVar, adHocFilters),
        format: 1,
        queryType: 'sql',
      },
    ],
    maxDataPoints: 10000,
  });

  function refreshHeatmapQuery() {
    const newSql = buildHeatmapSql(serviceVar, adHocFilters);
    const current = heatmapQuery.state.queries[0];
    if ((current as any).rawSql === newSql) {
      return;
    }
    heatmapQuery.setState({
      queries: [{ ...current, rawSql: newSql }],
    });
    heatmapQuery.runQueries();
  }

  const selectionState = new SelectionState();
  const comparisonPanel = new AttributeComparisonPanel({
    datasource: CLICKHOUSE_DS,
    attributes: COMPARISON_ATTRIBUTES,
  });

  comparisonPanel.setAdHocVariable(adHocFilters);
  comparisonPanel.setServiceVariable(serviceVar);

  selectionState.addActivationHandler(() => {
    const sub = selectionState.subscribeToState((newState, prevState) => {
      if (newState.selection !== prevState.selection) {
        comparisonPanel.setSelection(newState.selection);
      }
    });
    return () => sub.unsubscribe();
  });

  adHocFilters.addActivationHandler(() => {
    const sub = adHocFilters.subscribeToState((newState, prevState) => {
      if (newState.filters !== prevState.filters) {
        refreshHeatmapQuery();
        if (comparisonPanel.state.selection) {
          comparisonPanel.setSelection(comparisonPanel.state.selection);
        }
      }
    });
    return () => sub.unsubscribe();
  });

  serviceVar.addActivationHandler(() => {
    const sub = serviceVar.subscribeToState((newState, prevState) => {
      if (newState.value !== prevState.value) {
        refreshHeatmapQuery();
        if (comparisonPanel.state.selection) {
          comparisonPanel.setSelection(comparisonPanel.state.selection);
        }
      }
    });
    return () => sub.unsubscribe();
  });

  return new EmbeddedScene({
    $timeRange: timeRange,
    $variables: new SceneVariableSet({
      variables: [serviceVar, adHocFilters],
    }),
    $data: heatmapQuery,
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexItem({
          height: 350,
          body: new VizPanel({
            title: 'Trace Latency Heatmap',
            pluginId: 'heatmap-bubbles-panel',
            options: {
              yAxisScale: 'log',
              colorScheme: 'blues',
              yBuckets: 40,
            },
          }),
        }),
        new SceneFlexItem({
          minHeight: 400,
          body: comparisonPanel,
        }),
      ],
    }),
    controls: [
      new VariableValueSelectors({}),
      new SceneControlsSpacer(),
      selectionState,
      new SceneTimePicker({ isOnCanvas: true }),
      new SceneRefreshPicker({
        intervals: ['10s', '30s', '1m', '5m'],
        isOnCanvas: true,
      }),
    ],
  });
}
