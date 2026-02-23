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
import { CLICKHOUSE_DS } from '../../constants';
import { SelectionState } from '../../components/Bubbles/SelectionState';
import { AttributeComparisonPanel } from '../../components/Bubbles/AttributeComparisonPanel';
import { ViewModeControl } from '../../components/Bubbles/ViewModeControl';

/**
 * Build the heatmap SQL with the current service + ad-hoc filter state baked in.
 * We do NOT use ${filters:raw} because the ClickHouse datasource SQL parser
 * chokes on the table.column dot-notation it produces.
 */
function buildHeatmapSql(
  serviceVar: QueryVariable,
  adHocFilters: AdHocFiltersVariable,
  mode: string
): string {
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
  const errorCol = mode === 'errors' ? `,\n          StatusCode = 'Error' as isError` : '';

  return `SELECT
          Timestamp as timestamp,
          Duration / 1000000 as duration,
          TraceId as traceId${errorCol}
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

  const viewMode = new ViewModeControl();

  const adHocFilters = new AdHocFiltersVariable({
    name: 'filters',
    label: 'Filters',
    datasource: CLICKHOUSE_DS,
    applyMode: 'manual',
    defaultKeys: [],
    filters: [],
  });

  const currentMode = () => viewMode.state.mode;

  const heatmapQuery = new SceneQueryRunner({
    datasource: CLICKHOUSE_DS,
    queries: [
      {
        refId: 'heatmap',
        datasource: CLICKHOUSE_DS,
        rawSql: buildHeatmapSql(serviceVar, adHocFilters, currentMode()),
        format: 1,
        queryType: 'sql',
      },
    ],
    maxDataPoints: 10000,
  });

  function refreshHeatmapQuery() {
    const newSql = buildHeatmapSql(serviceVar, adHocFilters, currentMode());
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

  const PANEL_TITLES: Record<string, string> = {
    latency: 'Trace Latency Heatmap',
    errors: 'Error Spans Heatmap',
  };

  const heatmapVizPanel = new VizPanel({
    title: PANEL_TITLES[currentMode()] ?? PANEL_TITLES.latency,
    pluginId: 'heatmap-bubbles-panel',
    options: {
      yAxisScale: 'log',
      colorScheme: 'blues',
      colorMode: currentMode() === 'errors' ? 'errorRate' : 'count',
      yBuckets: 40,
    },
  });

  function modeFilterSql(mode: string): string {
    return mode === 'errors' ? `StatusCode = 'Error'` : '';
  }

  comparisonPanel.setModeFilter(modeFilterSql(currentMode()));

  viewMode.addActivationHandler(() => {
    const sub = viewMode.subscribeToState((newState, prevState) => {
      if (newState.mode !== prevState.mode) {
        refreshHeatmapQuery();
        const opts = heatmapVizPanel.state.options as Record<string, unknown>;
        heatmapVizPanel.setState({
          title: PANEL_TITLES[newState.mode] ?? PANEL_TITLES.latency,
          options: { ...opts, colorMode: newState.mode === 'errors' ? 'errorRate' : 'count' },
        });
        comparisonPanel.setModeFilter(modeFilterSql(newState.mode));
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
          body: heatmapVizPanel,
        }),
        new SceneFlexItem({
          minHeight: 400,
          body: comparisonPanel,
        }),
      ],
    }),
    controls: [
      viewMode,
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
