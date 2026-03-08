import { getTopDisplayValues } from '../../../packages/shared-comparison/src/displayValues';

function dist(value, count, total) {
  return {
    value,
    count,
    percentage: total > 0 ? count / total : 0,
  };
}

describe('getTopDisplayValues', () => {
  it('pins highestDiffValue to the visible list when it is not in top-N by count', () => {
    const baseline = Array.from({ length: 11 }, (_, i) => dist(`b-${i}`, 100 - i, 1000));
    const selection = [dist('s-hot', 1, 1)];
    const result = {
      attribute: 'user.id',
      baseline,
      selection,
      highestDiffValue: 's-hot',
      highestDiffPct: 0.5,
      highestDiffIndex: 0,
    };

    const displayed = getTopDisplayValues(result, 10);

    expect(displayed).toHaveLength(10);
    expect(displayed[0]).toBe('s-hot');
    expect(displayed).toContain('s-hot');
  });
});
