import { PLUGIN_BASE_URL } from '../constants';

export function prefixRoute(route: string): string {
  return `${PLUGIN_BASE_URL}/${route}`;
}
