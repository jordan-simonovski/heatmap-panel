import { SceneObjectBase, SceneObjectState } from '@grafana/scenes';
import { getAppEvents } from '@grafana/runtime';
import { HeatmapSelection, HeatmapSelectionEvent } from './types';

export interface SelectionStateState extends SceneObjectState {
  selection: HeatmapSelection | null;
}

/**
 * Custom SceneObject that subscribes to HeatmapSelectionEvent from the panel plugin
 * and holds the current selection state for downstream comparison queries.
 */
export class SelectionState extends SceneObjectBase<SelectionStateState> {
  constructor() {
    super({ selection: null });
    this.addActivationHandler(() => this._onActivate());
  }

  private _onActivate() {
    const sub = getAppEvents().subscribe(HeatmapSelectionEvent, (event) => {
      this.setState({ selection: event.payload });
    });

    return () => {
      sub.unsubscribe();
    };
  }

  /** SQL WHERE clause fragment for spans IN the selection box */
  public getSelectionFilter(): string {
    const sel = this.state.selection;
    if (!sel) {
      return '1=0';
    }
    const fromMs = sel.timeRange.from;
    const toMs = sel.timeRange.to;
    let filter = `Timestamp >= fromUnixTimestamp64Milli(${Math.floor(fromMs)}) AND Timestamp <= fromUnixTimestamp64Milli(${Math.floor(toMs)})`;
    if (sel.latencyRange) {
      const minNano = Math.round(sel.latencyRange.min * 1e6);
      const maxNano = Math.round(sel.latencyRange.max * 1e6);
      filter += ` AND Duration >= ${minNano} AND Duration <= ${maxNano}`;
    }
    return filter;
  }

  /** SQL WHERE clause fragment for spans NOT in the selection box (baseline) */
  public getBaselineFilter(): string {
    const sel = this.state.selection;
    if (!sel) {
      return '1=1';
    }
    return `NOT (${this.getSelectionFilter()})`;
  }

  public clearSelection() {
    this.setState({ selection: null });
  }
}
