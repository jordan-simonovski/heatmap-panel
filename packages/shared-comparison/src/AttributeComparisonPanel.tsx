import React, { useCallback } from 'react';
import {
  AdHocFiltersVariable,
  QueryVariable,
  SceneComponentProps,
  SceneObjectBase,
  SceneObjectState,
  sceneGraph,
} from '@grafana/scenes';
import { GrafanaTheme2 } from '@grafana/data';
import { Icon, IconButton, Input, Tooltip, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';
import { HeatmapSelection } from './types';
import { ComparisonResult, ValueDistribution, computeComparison } from './comparison';

export interface ComparisonAttribute {
  /** Display label shown on the card */
  label: string;
  /** SQL expression for the column value — e.g. `SpanAttributes['http.route']` or `StatusCode` */
  expr: string;
}

/** Configuration injected per-app so the panel is datasource/attribute agnostic. */
export interface ComparisonPanelConfig {
  datasource: { uid: string; type: string };
  /** Static attribute list. When empty or omitted, attributes are discovered dynamically from SpanAttributes keys. */
  attributes?: ComparisonAttribute[];
  tracesTable?: string; // default 'otel_traces'
}

interface AttributeComparisonState extends SceneObjectState {
  selection: HeatmapSelection | null;
  results: ComparisonResult[];
  loading: boolean;
  filterText: string;
}

export class AttributeComparisonPanel extends SceneObjectBase<AttributeComparisonState> {
  private static readonly TOP_LEVEL_COLUMNS: ComparisonAttribute[] = [
    { label: 'StatusCode', expr: 'StatusCode' },
    { label: 'ServiceName', expr: 'ServiceName' },
  ];

  private adHocVar: AdHocFiltersVariable | null = null;
  private serviceVar: QueryVariable | null = null;
  private modeFilter = '';
  private readonly config: ComparisonPanelConfig;

  constructor(config: ComparisonPanelConfig) {
    super({ selection: null, results: [], loading: false, filterText: '' });
    this.config = config;
  }

  private get table(): string {
    return this.config.tracesTable ?? 'otel_traces';
  }

  public setAdHocVariable(v: AdHocFiltersVariable) {
    this.adHocVar = v;
  }

  public setServiceVariable(v: QueryVariable) {
    this.serviceVar = v;
  }

  /** Optional SQL WHERE fragment applied to both selection and baseline queries (e.g. status code filter). */
  public setModeFilter(filter: string) {
    this.modeFilter = filter;
  }

  public setSelection(selection: HeatmapSelection | null) {
    this.setState({ selection });
    if (selection) {
      this.runComparison(selection);
    } else {
      this.setState({ results: [], loading: false });
    }
  }

  /** Build the extra WHERE fragments from mode, service variable + ad-hoc filters */
  private getExtraFilters(): string {
    const parts: string[] = [];

    if (this.modeFilter) {
      parts.push(this.modeFilter);
    }

    // Service filter
    if (this.serviceVar) {
      const val = String(this.serviceVar.state.value ?? '%');
      if (val && val !== '' && val !== '$__all') {
        parts.push(`ServiceName = '${val}'`);
      }
    }

    // Ad-hoc filters
    if (this.adHocVar) {
      for (const f of this.adHocVar.state.filters) {
        const key = f.key;
        const val = f.value;
        const op = f.operator;
        if (op === '=') {
          parts.push(`SpanAttributes['${key}'] = '${val}'`);
        } else if (op === '!=') {
          parts.push(`SpanAttributes['${key}'] != '${val}'`);
        }
      }
    }

    return parts.length > 0 ? ' AND ' + parts.join(' AND ') : '';
  }

  public addIncludeFilter(attr: string, value: string) {
    if (!this.adHocVar) { return; }
    const existing = this.adHocVar.state.filters;
    if (existing.some((f) => f.key === attr && f.value === value && f.operator === '=')) { return; }
    this.adHocVar.setState({
      filters: [...existing, { key: attr, value, operator: '=', condition: '' }],
    });
    if (this.state.selection) {
      this.runComparison(this.state.selection);
    }
  }

  public addExcludeFilter(attr: string, value: string) {
    if (!this.adHocVar) { return; }
    const existing = this.adHocVar.state.filters;
    if (existing.some((f) => f.key === attr && f.value === value && f.operator === '!=')) { return; }
    this.adHocVar.setState({
      filters: [...existing, { key: attr, value, operator: '!=', condition: '' }],
    });
    if (this.state.selection) {
      this.runComparison(this.state.selection);
    }
  }

  private async discoverAttributes(whereFilter: string): Promise<ComparisonAttribute[]> {
    const sql = `SELECT DISTINCT arrayJoin(SpanAttributes.keys) AS key
    FROM ${this.table}
    WHERE ${whereFilter}
    ORDER BY key
    LIMIT 50`;

    try {
      const response = await lastValueFrom(
        getBackendSrv().fetch<{ results: Record<string, { frames: Array<{ data: { values: unknown[][] } }> }> }>({
          url: '/api/ds/query',
          method: 'POST',
          data: {
            queries: [{
              refId: 'A',
              datasource: this.config.datasource,
              rawSql: sql,
              format: 1,
              queryType: 'sql',
            }],
            from: '0',
            to: String(Date.now()),
          },
        })
      );

      const frames = response.data?.results?.A?.frames;
      if (!frames || frames.length === 0) {
        return [...AttributeComparisonPanel.TOP_LEVEL_COLUMNS];
      }

      const keys = (frames[0].data?.values?.[0] ?? []) as string[];
      const spanAttrs: ComparisonAttribute[] = keys.map((k) => ({
        label: k,
        expr: `SpanAttributes['${k}']`,
      }));

      return [...AttributeComparisonPanel.TOP_LEVEL_COLUMNS, ...spanAttrs];
    } catch (err) {
      console.error('Attribute discovery failed:', err);
      return [...AttributeComparisonPanel.TOP_LEVEL_COLUMNS];
    }
  }

  private async runComparison(sel: HeatmapSelection) {
    this.setState({ loading: true });

    const fromMs = Math.floor(sel.timeRange.from);
    const toMs = Math.floor(sel.timeRange.to);

    const extra = this.getExtraFilters();

    let timeAndDuration = `Timestamp >= fromUnixTimestamp64Milli(${fromMs}) AND Timestamp <= fromUnixTimestamp64Milli(${toMs})`;
    if (sel.latencyRange) {
      const minNano = Math.round(sel.latencyRange.min * 1e6);
      const maxNano = Math.round(sel.latencyRange.max * 1e6);
      timeAndDuration += ` AND Duration >= ${minNano} AND Duration <= ${maxNano}`;
    }
    const selFilter = `${timeAndDuration}${extra}`;

    const tr = sceneGraph.getTimeRange(this).state.value;
    const panelFrom = Math.floor(tr.from.valueOf());
    const panelTo = Math.floor(tr.to.valueOf());
    const panelTimeFilter = `Timestamp >= fromUnixTimestamp64Milli(${panelFrom}) AND Timestamp <= fromUnixTimestamp64Milli(${panelTo})`;
    const baseFilter = `${panelTimeFilter} AND NOT (${timeAndDuration})${extra}`;

    const staticAttrs = this.config.attributes ?? [];
    const attributes = staticAttrs.length > 0
      ? staticAttrs
      : await this.discoverAttributes(`${panelTimeFilter}${extra}`);

    const results: ComparisonResult[] = [];

    const promises = attributes.map(async (attr) => {
      try {
        const [selDist, baseDist] = await Promise.all([
          this.queryDistribution(attr.expr, selFilter),
          this.queryDistribution(attr.expr, baseFilter),
        ]);
        return computeComparison(attr.label, baseDist, selDist);
      } catch (err) {
        console.error(`Failed to query attribute ${attr.label}:`, err);
        return computeComparison(attr.label, [], []);
      }
    });

    const all = await Promise.all(promises);
    const meaningful = all.filter((r) => r.highestDiffPct > 0);
    meaningful.sort((a, b) => b.highestDiffPct - a.highestDiffPct);
    results.push(...meaningful);

    this.setState({ results, loading: false });
  }

  private async queryDistribution(expr: string, whereFilter: string): Promise<ValueDistribution[]> {
    const table = this.table;
    const sql = `SELECT
      ${expr} AS value,
      count() AS cnt
    FROM ${table}
    WHERE ${whereFilter}
      AND ${expr} != ''
    GROUP BY value
    ORDER BY cnt DESC
    LIMIT 20`;

    try {
      const response = await lastValueFrom(
        getBackendSrv().fetch<{ results: Record<string, { frames: Array<{ data: { values: unknown[][] } }> }> }>({
          url: '/api/ds/query',
          method: 'POST',
          data: {
            queries: [
              {
                refId: 'A',
                datasource: this.config.datasource,
                rawSql: sql,
                format: 1,
                queryType: 'sql',
              },
            ],
            from: '0',
            to: String(Date.now()),
          },
        })
      );

      const frames = response.data?.results?.A?.frames;
      if (!frames || frames.length === 0) {
        return [];
      }

      const frame = frames[0];
      const values = frame.data?.values;
      if (!values || values.length < 2) {
        return [];
      }

      const labels = values[0] as string[];
      const counts = values[1] as number[];
      const total = counts.reduce((a, b) => a + b, 0);

      return labels.map((v, i) => ({
        value: String(v),
        count: counts[i],
        percentage: total > 0 ? counts[i] / total : 0,
      }));
    } catch (err) {
      console.error('Query failed:', err);
      return [];
    }
  }

  public setFilterText(text: string) {
    this.setState({ filterText: text });
  }

  public static Component = ({ model }: SceneComponentProps<AttributeComparisonPanel>) => {
    const { selection, results, loading, filterText } = model.useState();
    const styles = useStyles2(getStyles);

    const onFilterChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        model.setFilterText(e.target.value);
      },
      [model]
    );

    if (!selection) {
      return (
        <div className={styles.placeholder}>
          Draw a box on the heatmap above to select spans for comparison
        </div>
      );
    }

    if (loading) {
      return <div className={styles.placeholder}>Loading comparison data...</div>;
    }

    const needle = filterText.toLowerCase();
    const filtered = needle
      ? results.filter((r) => r.attribute.toLowerCase().includes(needle))
      : results;

    return (
      <div>
        <div className={styles.filterBar}>
          <Input
            prefix={<Icon name="search" />}
            placeholder="Filter attributes..."
            value={filterText}
            onChange={onFilterChange}
            width={30}
          />
          <span className={styles.filterCount}>
            {filtered.length} / {results.length} attributes
          </span>
          <span className={styles.selectionSummary}>
            {selection.spanCount != null ? `${selection.spanCount} spans selected` : 'Time range selected'}
          </span>
        </div>
        <SignificanceLegend />
        <div className={styles.grid}>
          {filtered.map((result) => (
            <AttributeCard
              key={result.attribute}
              result={result}
              onInclude={(attr, val) => model.addIncludeFilter(attr, val)}
              onExclude={(attr, val) => model.addExcludeFilter(attr, val)}
            />
          ))}
        </div>
      </div>
    );
  };
}

// --- Significance levels ---

type Significance = 'high' | 'medium' | 'low' | 'none';

const SIGNIFICANCE_META: Record<Significance, { label: string; color: string; description: string }> = {
  high: {
    label: 'Strong signal',
    color: '#e5393580',
    description: 'This attribute strongly differentiates the selected spans from the baseline. Likely a root cause or closely correlated with one.',
  },
  medium: {
    label: 'Moderate signal',
    color: '#fb8c0080',
    description: 'This attribute shows meaningful difference. May be a contributing factor or correlated with the root cause.',
  },
  low: {
    label: 'Weak signal',
    color: '#fdd83580',
    description: 'Small difference. Unlikely to be a cause, but worth noting if other evidence supports it.',
  },
  none: {
    label: 'No signal',
    color: 'transparent',
    description: 'Distribution is similar in selection and baseline. This attribute does not explain the selected outliers.',
  },
};

function getSignificance(diffPct: number): Significance {
  const pct = diffPct * 100;
  if (pct >= 30) { return 'high'; }
  if (pct >= 10) { return 'medium'; }
  if (pct >= 3) { return 'low'; }
  return 'none';
}

// --- Legend ---

function SignificanceLegend() {
  const styles = useStyles2(getLegendStyles);
  return (
    <div className={styles.legend}>
      <span className={styles.legendTitle}>How to read:</span>
      <span className={styles.legendItem}>
        <span className={styles.legendDot} style={{ background: '#e53935' }} />
        <span><b>Strong signal</b> (&ge;30%) -- likely root cause</span>
      </span>
      <span className={styles.legendItem}>
        <span className={styles.legendDot} style={{ background: '#fb8c00' }} />
        <span><b>Moderate</b> (10-30%) -- contributing factor</span>
      </span>
      <span className={styles.legendItem}>
        <span className={styles.legendDot} style={{ background: '#fdd835' }} />
        <span><b>Weak</b> (3-10%) -- minor correlation</span>
      </span>
      <span className={styles.legendItem}>
        <span className={styles.legendDot} style={{ background: '#bdbdbd' }} />
        <span><b>No signal</b> (&lt;3%) -- not a differentiator</span>
      </span>
      <span className={styles.legendSep}>|</span>
      <span className={styles.legendItem}>
        <span className={styles.legendBar} style={{ background: '#4285f4' }} />
        <span>Baseline</span>
      </span>
      <span className={styles.legendItem}>
        <span className={styles.legendBar} style={{ background: '#f4b400' }} />
        <span>Selection</span>
      </span>
    </div>
  );
}

// --- Individual attribute comparison card ---

function AttributeCard({
  result,
  onInclude,
  onExclude,
}: {
  result: ComparisonResult;
  onInclude: (attr: string, value: string) => void;
  onExclude: (attr: string, value: string) => void;
}) {
  const styles = useStyles2(getCardStyles);
  const sig = getSignificance(result.highestDiffPct);
  const meta = SIGNIFICANCE_META[sig];
  const maxCount = Math.max(
    ...result.baseline.map((v) => v.percentage),
    ...result.selection.map((v) => v.percentage),
    0.01
  );

  const allValues = new Set<string>();
  result.selection.forEach((v) => allValues.add(v.value));
  result.baseline.forEach((v) => allValues.add(v.value));

  const selMap = new Map(result.selection.map((v) => [v.value, v]));
  const baseMap = new Map(result.baseline.map((v) => [v.value, v]));

  const sorted = Array.from(allValues).sort((a, b) => {
    const countA = (selMap.get(a)?.count ?? 0) + (baseMap.get(a)?.count ?? 0);
    const countB = (selMap.get(b)?.count ?? 0) + (baseMap.get(b)?.count ?? 0);
    return countB - countA;
  });

  const selTotal = result.selection.reduce((a, b) => a + b.count, 0);
  const baseTotal = result.baseline.reduce((a, b) => a + b.count, 0);

  return (
    <div
      className={styles.card}
      style={{ borderLeftColor: meta.color, borderLeftWidth: '3px' }}
      title={meta.description}
    >
      <div className={styles.header}>
        <span className={styles.attrName}>{result.attribute}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className={styles.signBadge} style={{ color: meta.color.replace('80', '') }}>
            {meta.label}
          </span>
          <div className={styles.donutContainer}>
            <DonutPair
              baselinePresence={baseTotal > 0 ? 1 : 0}
              selectionPresence={selTotal > 0 ? 1 : 0}
            />
          </div>
        </div>
      </div>
      <div className={styles.bars}>
        {sorted.slice(0, 10).map((val) => {
          const selPct = selMap.get(val)?.percentage ?? 0;
          const basePct = baseMap.get(val)?.percentage ?? 0;
          return (
            <div key={val} className={styles.barRow}>
              <div className={styles.barWithActions}>
                <div className={styles.barPairWrap}>
                  <div className={styles.barPair}>
                    <div
                      className={styles.barBaseline}
                      style={{ width: `${(basePct / maxCount) * 100}%` }}
                      title={`Baseline: ${(basePct * 100).toFixed(1)}%`}
                    />
                    <div
                      className={styles.barSelection}
                      style={{ width: `${(selPct / maxCount) * 100}%` }}
                      title={`Selection: ${(selPct * 100).toFixed(1)}%`}
                    />
                  </div>
                  <div className={styles.barLabel} title={val}>
                    {val}
                  </div>
                </div>
                <div className={styles.barActions}>
                  <Tooltip content={`Include ${result.attribute}=${val}`} placement="top">
                    <IconButton
                      name="search-plus"
                      size="xs"
                      variant="secondary"
                      aria-label={`Include ${val}`}
                      onClick={() => onInclude(result.attribute, val)}
                    />
                  </Tooltip>
                  <Tooltip content={`Exclude ${result.attribute}=${val}`} placement="top">
                    <IconButton
                      name="search-minus"
                      size="xs"
                      variant="destructive"
                      aria-label={`Exclude ${val}`}
                      onClick={() => onExclude(result.attribute, val)}
                    />
                  </Tooltip>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className={styles.footer}>
        <span className={styles.diffLabel}>Highest diff</span>
        <span
          className={styles.diffValue}
          style={{ color: meta.color.replace('80', '') }}
        >
          {(result.highestDiffPct * 100).toFixed(result.highestDiffPct === 0 ? 0 : 1)}%
        </span>
        <span className={styles.diffAttr} title={result.highestDiffValue}>
          {result.highestDiffValue}
        </span>
      </div>
    </div>
  );
}

function DonutPair({
  baselinePresence,
  selectionPresence,
}: {
  baselinePresence: number;
  selectionPresence: number;
}) {
  const size = 16;
  const r = 6;
  const stroke = 3;
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#ccc" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#4285f4"
          strokeWidth={stroke}
          strokeDasharray={`${baselinePresence * 2 * Math.PI * r} ${2 * Math.PI * r}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#ccc" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#f4b400"
          strokeWidth={stroke}
          strokeDasharray={`${selectionPresence * 2 * Math.PI * r} ${2 * Math.PI * r}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
    </div>
  );
}

// --- Styles ---

function getStyles(theme: GrafanaTheme2) {
  return {
    placeholder: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing(4),
      color: theme.colors.text.secondary,
      fontSize: '14px',
      minHeight: '200px',
    }),
    filterBar: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
      padding: `${theme.spacing(1)} ${theme.spacing(1)} 0`,
    }),
    filterCount: css({
      fontSize: '12px',
      color: theme.colors.text.secondary,
      whiteSpace: 'nowrap',
    }),
    selectionSummary: css({
      fontSize: '12px',
      color: theme.colors.text.primary,
      fontWeight: 500,
      whiteSpace: 'nowrap',
      marginLeft: 'auto',
    }),
    grid: css({
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
      gap: theme.spacing(1),
      padding: theme.spacing(1),
    }),
  };
}

function getCardStyles(theme: GrafanaTheme2) {
  return {
    card: css({
      display: 'flex',
      flexDirection: 'column',
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      background: theme.colors.background.primary,
      padding: theme.spacing(1),
      minHeight: '180px',
    }),
    header: css({
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: theme.spacing(0.5),
    }),
    attrName: css({
      fontWeight: 600,
      fontSize: '12px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }),
    signBadge: css({
      fontSize: '9px',
      fontWeight: 600,
      whiteSpace: 'nowrap',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
    }),
    donutContainer: css({
      flexShrink: 0,
    }),
    bars: css({
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      gap: '3px',
      overflow: 'hidden',
    }),
    barRow: css({
      display: 'flex',
      flexDirection: 'column',
    }),
    barWithActions: css({
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      '&:hover > div:last-child': {
        opacity: 1,
      },
    }),
    barPairWrap: css({
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: '1px',
    }),
    barPair: css({
      display: 'flex',
      flexDirection: 'column',
      gap: '1px',
      height: '12px',
    }),
    barBaseline: css({
      height: '5px',
      backgroundColor: '#4285f4',
      borderRadius: '1px',
      minWidth: '1px',
      transition: 'width 0.3s ease',
    }),
    barSelection: css({
      height: '5px',
      backgroundColor: '#f4b400',
      borderRadius: '1px',
      minWidth: '1px',
      transition: 'width 0.3s ease',
    }),
    barLabel: css({
      fontSize: '9px',
      color: theme.colors.text.secondary,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      lineHeight: '1',
    }),
    barActions: css({
      display: 'flex',
      gap: '2px',
      opacity: 0,
      transition: 'opacity 0.15s ease',
      flexShrink: 0,
    }),
    footer: css({
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      marginTop: theme.spacing(0.5),
      paddingTop: theme.spacing(0.5),
      borderTop: `1px solid ${theme.colors.border.weak}`,
    }),
    diffLabel: css({
      fontSize: '10px',
      color: theme.colors.text.secondary,
      fontWeight: 500,
    }),
    diffValue: css({
      fontSize: '20px',
      fontWeight: 'bold',
      lineHeight: '1.2',
    }),
    diffAttr: css({
      fontSize: '10px',
      color: theme.colors.text.secondary,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      maxWidth: '100%',
      textAlign: 'center',
    }),
  };
}

function getLegendStyles(theme: GrafanaTheme2) {
  return {
    legend: css({
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: theme.spacing(1.5),
      padding: `${theme.spacing(0.75)} ${theme.spacing(1)}`,
      margin: `0 ${theme.spacing(1)}`,
      background: theme.colors.background.secondary,
      borderRadius: theme.shape.radius.default,
      fontSize: '11px',
      color: theme.colors.text.secondary,
    }),
    legendTitle: css({
      fontWeight: 600,
      color: theme.colors.text.primary,
      fontSize: '11px',
    }),
    legendItem: css({
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
    }),
    legendDot: css({
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      flexShrink: 0,
    }),
    legendBar: css({
      width: '14px',
      height: '5px',
      borderRadius: '1px',
      flexShrink: 0,
    }),
    legendSep: css({
      color: theme.colors.border.weak,
      fontSize: '14px',
    }),
  };
}
