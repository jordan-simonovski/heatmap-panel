/**
 * Comparison utilities for Bubbles analysis.
 *
 * Given baseline and selection distributions for an attribute,
 * computes the value with the highest percentage difference.
 */

export interface ValueDistribution {
  value: string;
  count: number;
  percentage: number;
}

export interface ComparisonResult {
  attribute: string;
  baseline: ValueDistribution[];
  selection: ValueDistribution[];
  highestDiffValue: string;
  highestDiffPct: number;
  /** Index into selection array for the highest diff value */
  highestDiffIndex: number;
}

/**
 * Compute the value with the highest difference between selection and baseline.
 * Returns the absolute percentage point difference (0-1 range).
 */
export function computeComparison(
  attribute: string,
  baseline: ValueDistribution[],
  selection: ValueDistribution[]
): ComparisonResult {
  const baselineMap = new Map<string, number>();
  for (const b of baseline) {
    baselineMap.set(b.value, b.percentage);
  }

  let highestDiff = 0;
  let highestDiffValue = '';
  let highestDiffIndex = 0;

  for (let i = 0; i < selection.length; i++) {
    const sel = selection[i];
    const basePct = baselineMap.get(sel.value) ?? 0;
    const diff = Math.abs(sel.percentage - basePct);
    if (diff > highestDiff) {
      highestDiff = diff;
      highestDiffValue = sel.value;
      highestDiffIndex = i;
    }
  }

  // Also check baseline values not in selection
  const selectionMap = new Map<string, number>();
  for (const s of selection) {
    selectionMap.set(s.value, s.percentage);
  }
  for (const b of baseline) {
    if (!selectionMap.has(b.value)) {
      const diff = b.percentage; // selection pct is 0
      if (diff > highestDiff) {
        highestDiff = diff;
        highestDiffValue = b.value;
        highestDiffIndex = -1;
      }
    }
  }

  return {
    attribute,
    baseline,
    selection,
    highestDiffValue,
    highestDiffPct: highestDiff,
    highestDiffIndex,
  };
}
