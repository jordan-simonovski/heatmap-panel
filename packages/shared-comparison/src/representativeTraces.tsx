import React from 'react';
import {
  AdHocFiltersVariable,
  QueryVariable,
  SceneComponentProps,
  SceneObjectBase,
  SceneObjectState,
} from '@grafana/scenes';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';
import { HeatmapSelection } from './types';
import { rankRepresentativeTraces, RepresentativeTraceRow } from './representativeTraceRanking';

interface RepresentativeTracesState extends SceneObjectState {
  selection: HeatmapSelection | null;
  traces: RepresentativeTraceRow[];
  loading: boolean;
}

export interface RepresentativeTracesConfig {
  datasource: { uid: string; type: string };
  tracesTable?: string;
  maxTraces?: number;
  onTraceSelect?: (traceId: string) => void;
}

export class RepresentativeTracesPanel extends SceneObjectBase<RepresentativeTracesState> {
  private adHocVar: AdHocFiltersVariable | null = null;
  private serviceVar: QueryVariable | null = null;
  private modeFilter = '';
  private readonly config: RepresentativeTracesConfig;

  constructor(config: RepresentativeTracesConfig) {
    super({ selection: null, traces: [], loading: false });
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

  public setModeFilter(filter: string) {
    this.modeFilter = filter;
  }

  public setSelection(selection: HeatmapSelection | null) {
    this.setState({ selection });
    if (selection) {
      this.runQuery(selection);
    } else {
      this.setState({ traces: [], loading: false });
    }
  }

  private getExtraFilters(): string {
    const parts: string[] = [];

    if (this.modeFilter) {
      parts.push(this.modeFilter);
    }

    if (this.serviceVar) {
      const val = String(this.serviceVar.state.value ?? '%');
      if (val && val !== '' && val !== '$__all') {
        parts.push(`ServiceName = '${val}'`);
      }
    }

    if (this.adHocVar) {
      for (const f of this.adHocVar.state.filters) {
        if (f.operator === '=') {
          parts.push(`SpanAttributes['${f.key}'] = '${f.value}'`);
        } else if (f.operator === '!=') {
          parts.push(`SpanAttributes['${f.key}'] != '${f.value}'`);
        }
      }
    }

    return parts.length > 0 ? ' AND ' + parts.join(' AND ') : '';
  }

  private async runQuery(selection: HeatmapSelection) {
    this.setState({ loading: true });

    const quoteSqlString = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    const traceIdFilter =
      selection.traceIds && selection.traceIds.length > 0
        ? `TraceId IN (${selection.traceIds.map(quoteSqlString).join(', ')})`
        : '';

    const fromMs = Math.floor(selection.timeRange.from);
    const toMs = Math.floor(selection.timeRange.to);
    let timeAndDuration = `Timestamp >= fromUnixTimestamp64Milli(${fromMs}) AND Timestamp <= fromUnixTimestamp64Milli(${toMs})`;
    if (selection.latencyRange) {
      const minNano = Math.round(selection.latencyRange.min * 1e6);
      const maxNano = Math.round(selection.latencyRange.max * 1e6);
      timeAndDuration += ` AND Duration >= ${minNano} AND Duration <= ${maxNano}`;
    }

    const selectionPredicate = traceIdFilter || timeAndDuration;
    const where = `${selectionPredicate}${this.getExtraFilters()}`;
    const rawLimit = Math.max(this.config.maxTraces ?? 20, 1);

    const sql = `SELECT
      TraceId AS traceId,
      count() AS selectedSpanCount,
      max(Duration) / 1000000 AS maxDurationMs
    FROM ${this.table}
    WHERE ${where}
      AND TraceId != ''
    GROUP BY traceId
    ORDER BY selectedSpanCount DESC
    LIMIT ${rawLimit}`;

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
        this.setState({ traces: [], loading: false });
        return;
      }

      const values = frames[0].data?.values;
      if (!values || values.length < 3) {
        this.setState({ traces: [], loading: false });
        return;
      }

      const traceIds = (values[0] ?? []) as string[];
      const selectedCounts = (values[1] ?? []) as number[];
      const maxDurations = (values[2] ?? []) as number[];

      const rows: RepresentativeTraceRow[] = traceIds.map((traceId, idx) => ({
        traceId: String(traceId),
        selectedSpanCount: Number(selectedCounts[idx] ?? 0),
        maxDurationMs: Number(maxDurations[idx] ?? 0),
        errorSpanCount: 0,
      }));

      this.setState({
        traces: rankRepresentativeTraces(rows, this.config.maxTraces ?? 10),
        loading: false,
      });
    } catch (err) {
      console.error('Representative trace query failed:', err);
      this.setState({ traces: [], loading: false });
    }
  }

  public static Component = ({ model }: SceneComponentProps<RepresentativeTracesPanel>) => {
    const { selection, traces, loading } = model.useState();
    const styles = useStyles2(getStyles);

    if (!selection) {
      return <div className={styles.placeholder}>Select outliers to see representative traces</div>;
    }

    if (loading) {
      return <div className={styles.placeholder}>Loading representative traces...</div>;
    }

    if (traces.length === 0) {
      return <div className={styles.placeholder}>No representative traces found for this selection</div>;
    }

    return (
      <div className={styles.wrap}>
        <div className={styles.title}>Representative traces</div>
        <div className={styles.subtitle}>Open a trace to validate the signal and find root cause.</div>
        <div className={styles.list}>
          {traces.map((row) => (
            <button
              key={row.traceId}
              className={styles.row}
              onClick={() => model.config.onTraceSelect?.(row.traceId)}
              title={row.traceId}
            >
              <span className={styles.traceId}>{row.traceId}</span>
              <span className={styles.metric}>
                {row.selectedSpanCount} spans
                {row.errorSpanCount > 0 ? ` | ${row.errorSpanCount} errors` : ''}
                {row.maxDurationMs > 0 ? ` | max ${row.maxDurationMs.toFixed(1)}ms` : ''}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  };
}

function getStyles(theme: GrafanaTheme2) {
  return {
    placeholder: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 80,
      padding: theme.spacing(2),
      color: theme.colors.text.secondary,
      fontSize: '13px',
    }),
    wrap: css({
      margin: `${theme.spacing(0.5)} ${theme.spacing(1)} ${theme.spacing(0.75)}`,
      padding: theme.spacing(1),
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      background: theme.colors.background.primary,
    }),
    title: css({
      fontSize: '14px',
      fontWeight: 600,
      color: theme.colors.text.primary,
      marginBottom: theme.spacing(0.75),
      padding: `0 ${theme.spacing(0.25)}`,
      textTransform: 'uppercase',
      letterSpacing: '0.4px',
    }),
    subtitle: css({
      fontSize: '12px',
      color: theme.colors.text.secondary,
      marginBottom: theme.spacing(0.75),
      padding: `0 ${theme.spacing(0.25)}`,
    }),
    list: css({
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      maxHeight: '180px',
      overflowY: 'auto',
    }),
    row: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      textAlign: 'left',
      borderRadius: theme.shape.radius.default,
      padding: `${theme.spacing(0.75)} ${theme.spacing(1)}`,
      '&:hover': {
        background: theme.colors.action.hover,
      },
    }),
    traceId: css({
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: '13px',
      color: theme.colors.primary.text,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      marginRight: theme.spacing(1),
    }),
    metric: css({
      fontSize: '12px',
      color: theme.colors.text.secondary,
      whiteSpace: 'nowrap',
      flexShrink: 0,
    }),
  };
}
