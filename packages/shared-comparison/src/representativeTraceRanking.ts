export interface RepresentativeTraceRow {
  traceId: string;
  selectedSpanCount: number;
  maxDurationMs: number;
  errorSpanCount: number;
}

export function rankRepresentativeTraces(rows: RepresentativeTraceRow[], limit = 10): RepresentativeTraceRow[] {
  return [...rows]
    .sort((a, b) => {
      if (b.selectedSpanCount !== a.selectedSpanCount) {
        return b.selectedSpanCount - a.selectedSpanCount;
      }
      return a.traceId.localeCompare(b.traceId);
    })
    .slice(0, limit);
}
