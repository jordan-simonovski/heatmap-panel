import { computeComparison } from '../../../packages/shared-comparison/src/comparison';

function dist(value, count, total) {
  return {
    value,
    count,
    percentage: total > 0 ? count / total : 0,
  };
}

describe('computeComparison', () => {
  it('returns no signal when selection has no values for the attribute', () => {
    const baseline = [dist('200', 90, 100), dist('500', 10, 100)];
    const selection = [];

    const result = computeComparison('StatusCode', baseline, selection);

    expect(result.highestDiffPct).toBe(0);
    expect(result.highestDiffValue).toBe('');
    expect(result.highestDiffIndex).toBe(0);
  });

  it('prefers overrepresented values in selection', () => {
    const baseline = [dist('200', 90, 100), dist('500', 10, 100)];
    const selection = [dist('200', 40, 100), dist('500', 60, 100)];

    const result = computeComparison('StatusCode', baseline, selection);

    expect(result.highestDiffValue).toBe('500');
    expect(result.highestDiffPct).toBeCloseTo(0.5);
    expect(result.highestDiffIndex).toBe(1);
  });
});
