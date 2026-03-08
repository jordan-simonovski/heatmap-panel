import { rankRepresentativeTraces } from '../../../packages/shared-comparison/src/representativeTraceRanking';

describe('rankRepresentativeTraces', () => {
  it('sorts by selected span count and uses traceId as deterministic tie-breaker', () => {
    const rows = [
      { traceId: 'trace-c', selectedSpanCount: 3, maxDurationMs: 1200, errorSpanCount: 0 },
      { traceId: 'trace-a', selectedSpanCount: 7, maxDurationMs: 800, errorSpanCount: 1 },
      { traceId: 'trace-b', selectedSpanCount: 7, maxDurationMs: 700, errorSpanCount: 0 },
      { traceId: 'trace-d', selectedSpanCount: 1, maxDurationMs: 200, errorSpanCount: 0 },
    ];

    const ranked = rankRepresentativeTraces(rows, 3);

    expect(ranked.map((r) => r.traceId)).toEqual(['trace-a', 'trace-b', 'trace-c']);
  });
});
