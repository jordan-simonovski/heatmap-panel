import { BadgeColor } from '@grafana/ui';

export type BurnSeverity = 'fast' | 'slow' | 'none';

export function getBurnSeverity(source: string): BurnSeverity {
  if (source.endsWith(':fast')) {
    return 'fast';
  }
  if (source.endsWith(':slow')) {
    return 'slow';
  }
  return 'none';
}

export function getSeverityLabel(severity: BurnSeverity): string {
  if (severity === 'fast') {
    return 'Fast burn';
  }
  if (severity === 'slow') {
    return 'Slow burn';
  }
  return 'No burn';
}

export function getSeverityBadgeColor(severity: BurnSeverity): BadgeColor {
  if (severity === 'fast') {
    return 'red';
  }
  if (severity === 'slow') {
    return 'orange';
  }
  return 'blue';
}
