import { ComparisonResult } from './comparison';

export function getTopDisplayValues(result: ComparisonResult, limit = 10): string[] {
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

  const top = sorted.slice(0, limit);
  const highest = result.highestDiffValue;
  if (!highest) {
    return top;
  }

  const withoutHighest = sorted.filter((v) => v !== highest);
  return [highest, ...withoutHighest].slice(0, limit);
}
