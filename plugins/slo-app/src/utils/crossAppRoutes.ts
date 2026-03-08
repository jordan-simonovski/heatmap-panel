import { HEATMAP_APP_ID } from '../constants';

function encodePart(v: string): string {
  return encodeURIComponent(v);
}

export function heatmapTraceRoute(traceId: string): string {
  return `/a/${HEATMAP_APP_ID}/trace/${encodePart(traceId)}`;
}

export function heatmapExplorerRoute(): string {
  return `/a/${HEATMAP_APP_ID}/explorer`;
}
