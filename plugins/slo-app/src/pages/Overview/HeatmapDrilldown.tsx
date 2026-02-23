import React from 'react';
import { css } from '@emotion/css';
import {
  AdHocFiltersVariable,
  SceneComponentProps,
  SceneObjectBase,
  SceneObjectState,
  SceneQueryRunner,
  VizPanel,
} from '@grafana/scenes';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import {
  SLODefinition,
  complianceSql,
  latencyTimeseriesSql,
  errorRateTimeseriesSql,
  errorBudgetSql,
} from '../../sloDefinitions';
import { CLICKHOUSE_DS } from '../../constants';
import { getAppEvents } from '@grafana/runtime';
import { HeatmapSelectionEvent, AttributeComparisonPanel } from '@heatmap/shared-comparison';

// ── SLO Card panels (three VizPanels per SLO) ──────────────────────

export interface SloCardPanels {
  slo: SLODefinition;
  stat: VizPanel;
  sparkline: VizPanel;
  gauge: VizPanel;
}

export function buildCardPanels(slo: SLODefinition): SloCardPanels {
  const complianceQuery = new SceneQueryRunner({
    datasource: CLICKHOUSE_DS,
    queries: [{
      refId: 'compliance',
      datasource: CLICKHOUSE_DS,
      rawSql: complianceSql(slo),
      format: 1,
      queryType: 'sql',
    }],
  });

  const timeseriesQuery = new SceneQueryRunner({
    datasource: CLICKHOUSE_DS,
    queries: [{
      refId: 'timeseries',
      datasource: CLICKHOUSE_DS,
      rawSql: slo.type === 'latency'
        ? latencyTimeseriesSql(slo)
        : errorRateTimeseriesSql(slo),
      format: 1,
      queryType: 'sql',
    }],
  });

  const budgetQuery = new SceneQueryRunner({
    datasource: CLICKHOUSE_DS,
    queries: [{
      refId: 'budget',
      datasource: CLICKHOUSE_DS,
      rawSql: errorBudgetSql(slo),
      format: 1,
      queryType: 'sql',
    }],
  });

  const thresholdLabel = slo.type === 'latency'
    ? `p99 < ${slo.thresholdMs}ms`
    : `error rate < ${((slo.thresholdRate ?? 0) * 100).toFixed(1)}%`;

  return {
    slo,
    stat: new VizPanel({
      title: slo.name,
      description: `${slo.route} | ${thresholdLabel} | target ${(slo.target * 100).toFixed(1)}%`,
      pluginId: 'stat',
      $data: complianceQuery,
      fieldConfig: {
        defaults: {
          unit: 'percentunit',
          thresholds: {
            mode: 'absolute' as any,
            steps: [
              { value: -Infinity, color: 'red' },
              { value: slo.target - 0.01, color: 'orange' },
              { value: slo.target, color: 'green' },
            ],
          },
          decimals: 2,
        },
        overrides: [],
      },
      options: {
        colorMode: 'background',
        graphMode: 'none',
        reduceOptions: { calcs: ['lastNotNull'] },
      },
    }),
    sparkline: new VizPanel({
      title: '',
      pluginId: 'timeseries',
      $data: timeseriesQuery,
      fieldConfig: {
        defaults: {
          custom: {
            lineWidth: 1,
            fillOpacity: 10,
            pointSize: 3,
            showPoints: 'never' as any,
          },
        },
        overrides: [],
      },
      options: {
        legend: { showLegend: false },
        tooltip: { mode: 'single' },
      },
    }),
    gauge: new VizPanel({
      title: 'Error Budget',
      pluginId: 'gauge',
      $data: budgetQuery,
      fieldConfig: {
        defaults: {
          unit: 'percentunit',
          min: -0.05,
          max: 0.05,
          thresholds: {
            mode: 'absolute' as any,
            steps: [
              { value: -Infinity, color: 'red' },
              { value: 0, color: 'green' },
            ],
          },
          decimals: 3,
        },
        overrides: [],
      },
      options: {
        reduceOptions: { calcs: ['lastNotNull'] },
        showThresholdLabels: false,
        showThresholdMarkers: true,
      },
    }),
  };
}

// ── SLO Overview Body ───────────────────────────────────────────────
// Single SceneObject that owns the card grid + drilldown.
// Renders cards via CSS Grid with explicit-height containers for each
// VizPanel, avoiding SceneFlexLayout dimension chain issues.

interface SloOverviewBodyState extends SceneObjectState {
  cards: SloCardPanels[];
  selectedIndex: number | null;
  drilldown: HeatmapDrilldown;
}

export class SloOverviewBody extends SceneObjectBase<SloOverviewBodyState> {
  selectCard(index: number) {
    const { selectedIndex, drilldown, cards } = this.state;
    if (selectedIndex === index) {
      this.setState({ selectedIndex: null });
      drilldown.clearSlo();
      return;
    }
    this.setState({ selectedIndex: index });
    drilldown.selectSlo(cards[index].slo);
  }

  static Component = SloOverviewBodyRenderer;
}

function SloOverviewBodyRenderer({ model }: SceneComponentProps<SloOverviewBody>) {
  const { cards, selectedIndex, drilldown } = model.useState();
  const styles = useStyles2(getOverviewStyles);

  return (
    <div className={styles.root}>
      <div className={styles.grid}>
        {cards.map((card, i) => (
          <div
            key={card.stat.state.key}
            role="button"
            tabIndex={0}
            className={`${styles.card} ${i === selectedIndex ? styles.cardActive : ''}`}
            onClick={() => model.selectCard(i)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                model.selectCard(i);
              }
            }}
          >
            <div className={styles.statPanel}>
              <card.stat.Component model={card.stat} />
            </div>
            <div className={styles.sparklinePanel}>
              <card.sparkline.Component model={card.sparkline} />
            </div>
            <div className={styles.gaugePanel}>
              <card.gauge.Component model={card.gauge} />
            </div>
          </div>
        ))}
      </div>
      <drilldown.Component model={drilldown} />
    </div>
  );
}

function getOverviewStyles(theme: GrafanaTheme2) {
  return {
    root: css({
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
    }),
    grid: css({
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
      gap: theme.spacing(1),
    }),
    card: css({
      cursor: 'pointer',
      borderRadius: theme.shape.radius.default,
      border: '2px solid transparent',
      transition: 'border-color 0.2s ease',
      overflow: 'hidden',
      '&:hover': {
        borderColor: theme.colors.primary.border,
      },
    }),
    cardActive: css({
      borderColor: theme.colors.primary.main,
      '&:hover': {
        borderColor: theme.colors.primary.main,
      },
    }),
    statPanel: css({ height: 100 }),
    sparklinePanel: css({ height: 120 }),
    gaugePanel: css({ height: 120 }),
  };
}

// ── Drilldown Panel ─────────────────────────────────────────────────

function buildAdHocWhere(slo: SLODefinition, adHocFilters: AdHocFiltersVariable): string {
  const parts: string[] = [
    `SpanAttributes['http.route'] = '${slo.route}'`,
    `ServiceName = 'api-gateway'`,
  ];

  for (const f of adHocFilters.state.filters) {
    if (f.operator === '=') {
      parts.push(`SpanAttributes['${f.key}'] = '${f.value}'`);
    } else if (f.operator === '!=') {
      parts.push(`SpanAttributes['${f.key}'] != '${f.value}'`);
    }
  }

  return parts.join('\n          AND ');
}

/** Raw span query for heatmap (latency SLOs) */
function buildLatencyDrilldownSql(slo: SLODefinition, adHocFilters: AdHocFiltersVariable): string {
  const where = buildAdHocWhere(slo, adHocFilters);
  return `SELECT
          Timestamp as timestamp,
          Duration / 1000000 as duration,
          TraceId as traceId
        FROM otel_traces
        WHERE $__timeFilter(Timestamp)
          AND ${where}
        ORDER BY Timestamp
        LIMIT 10000`;
}

/** Aggregated error rate query for timeseries (error_rate SLOs) */
function buildErrorRateDrilldownSql(slo: SLODefinition, adHocFilters: AdHocFiltersVariable): string {
  const where = buildAdHocWhere(slo, adHocFilters);
  return `SELECT
          toStartOfInterval(Timestamp, INTERVAL 1 minute) AS time,
          countIf(toInt32OrZero(SpanAttributes['http.status_code']) >= 500) / count() AS error_rate
        FROM otel_traces
        WHERE $__timeFilter(Timestamp)
          AND ${where}
        GROUP BY time
        ORDER BY time`;
}

function buildDrilldownSql(slo: SLODefinition, adHocFilters: AdHocFiltersVariable): string {
  return slo.type === 'latency'
    ? buildLatencyDrilldownSql(slo, adHocFilters)
    : buildErrorRateDrilldownSql(slo, adHocFilters);
}

function buildVizPanel(slo: SLODefinition, query: SceneQueryRunner): VizPanel {
  if (slo.type === 'latency') {
    return new VizPanel({
      title: `${slo.name} — Trace Latency Heatmap`,
      pluginId: 'heatmap-bubbles-panel',
      $data: query,
      options: {
        yAxisScale: 'log',
        colorScheme: 'oranges',
        yBuckets: 40,
      },
    });
  }
  return new VizPanel({
    title: `${slo.name} — Error Rate`,
    pluginId: 'timeseries-selection-panel',
    $data: query,
    options: {
      lineColor: '#e53935',
      fillOpacity: 15,
      thresholdValue: slo.thresholdRate ?? undefined,
      thresholdColor: '#fb8c00',
      yAxisLabel: 'Error Rate',
    },
  });
}

interface DrilldownState extends SceneObjectState {
  slo: SLODefinition | null;
  vizPanel: VizPanel;
  comparisonPanel: AttributeComparisonPanel;
  adHocFilters: AdHocFiltersVariable;
}

export class HeatmapDrilldown extends SceneObjectBase<DrilldownState> {
  private drilldownQuery: SceneQueryRunner;

  constructor() {
    const adHocFilters = new AdHocFiltersVariable({
      name: 'drilldownFilters',
      label: 'Filters',
      datasource: CLICKHOUSE_DS,
      applyMode: 'manual',
      defaultKeys: [],
      filters: [],
    });

    const drilldownQuery = new SceneQueryRunner({
      datasource: CLICKHOUSE_DS,
      queries: [],
      maxDataPoints: 10000,
    });

    // Default panel (will be replaced on selectSlo)
    const vizPanel = new VizPanel({
      title: 'Drilldown',
      pluginId: 'heatmap-bubbles-panel',
      $data: drilldownQuery,
      options: {},
    });

    const comparisonPanel = new AttributeComparisonPanel({
      datasource: CLICKHOUSE_DS,
    });

    comparisonPanel.setAdHocVariable(adHocFilters);

    super({
      slo: null,
      vizPanel,
      comparisonPanel,
      adHocFilters,
    });

    this.drilldownQuery = drilldownQuery;

    // Subscribe directly on the drilldown's own activation (guaranteed to fire
    // because DrilldownRenderer calls model.useState()).  Bypasses SelectionState
    // which would need its own Component rendered to reliably activate.
    this.addActivationHandler(() => {
      const eventSub = getAppEvents().subscribe(HeatmapSelectionEvent, (event) => {
        comparisonPanel.setSelection(event.payload);
      });
      return () => eventSub.unsubscribe();
    });

    // Wire ad-hoc filter changes -> rebuild query + re-run comparison
    adHocFilters.addActivationHandler(() => {
      const sub = adHocFilters.subscribeToState((newState, prevState) => {
        if (newState.filters !== prevState.filters) {
          this.refreshDrilldownQuery();
          if (comparisonPanel.state.selection) {
            comparisonPanel.setSelection(comparisonPanel.state.selection);
          }
        }
      });
      return () => sub.unsubscribe();
    });
  }

  private refreshDrilldownQuery() {
    const { slo, adHocFilters } = this.state;
    if (!slo) {
      return;
    }

    const newSql = buildDrilldownSql(slo, adHocFilters);
    const current = this.drilldownQuery.state.queries[0];
    if (current && (current as any).rawSql === newSql) {
      return;
    }

    this.drilldownQuery.setState({
      queries: [
        {
          refId: 'drilldown',
          datasource: CLICKHOUSE_DS,
          rawSql: newSql,
          format: 1,
          queryType: 'sql',
        },
      ],
    });
    this.drilldownQuery.runQueries();
  }

  selectSlo(slo: SLODefinition) {
    // Rebuild the VizPanel for the new SLO type
    const vizPanel = buildVizPanel(slo, this.drilldownQuery);
    this.setState({ slo, vizPanel });
    this.refreshDrilldownQuery();
  }

  clearSlo() {
    this.setState({ slo: null });
    this.drilldownQuery.setState({ queries: [] });
    this.state.comparisonPanel.setSelection(null);
  }

  static Component = DrilldownRenderer;
}

function DrilldownRenderer({ model }: SceneComponentProps<HeatmapDrilldown>) {
  const { slo, vizPanel, comparisonPanel, adHocFilters } = model.useState();
  const styles = useStyles2(getDrilldownStyles);

  if (!slo) {
    return <div className={styles.empty}>Select an SLO card above to drill down.</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.filters}>
        <adHocFilters.Component model={adHocFilters} />
      </div>
      <div className={styles.vizPanel}>
        <vizPanel.Component model={vizPanel} />
      </div>
      <div className={styles.comparison}>
        <comparisonPanel.Component model={comparisonPanel} />
      </div>
    </div>
  );
}

function getDrilldownStyles(theme: GrafanaTheme2) {
  return {
    empty: css({
      padding: theme.spacing(4),
      textAlign: 'center',
      color: theme.colors.text.secondary,
      fontStyle: 'italic',
    }),
    container: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1),
      marginTop: theme.spacing(2),
    }),
    filters: css({
      padding: `0 ${theme.spacing(1)}`,
    }),
    vizPanel: css({
      height: 350,
    }),
    comparison: css({
      minHeight: 400,
    }),
  };
}
