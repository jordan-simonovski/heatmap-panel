export const TOP_LEVEL_FILTER_COLUMNS = new Set(['StatusCode', 'ServiceName']);

function escapeSql(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function filterExpressionForKey(key: string): string {
  if (TOP_LEVEL_FILTER_COLUMNS.has(key)) {
    return key;
  }
  return `SpanAttributes['${escapeSql(key)}']`;
}

export function buildFilterClause(key: string, value: string, operator: string): string | null {
  if (operator !== '=' && operator !== '!=') {
    return null;
  }
  const expr = filterExpressionForKey(key);
  const escaped = escapeSql(value);
  return `${expr} ${operator} '${escaped}'`;
}
