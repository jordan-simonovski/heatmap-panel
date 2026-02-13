import { SceneAppPage } from '@grafana/scenes';
import { detailScene } from './detailScene';
import { prefixRoute } from '../../utils/utils.routing';
import { SLO_DEFINITIONS, SLODefinition } from '../../sloDefinitions';

/**
 * Generate SceneAppPage sub-pages for each SLO definition.
 * These are registered as drilldown pages under the overview.
 */
export function sloDetailPages(): SceneAppPage[] {
  return SLO_DEFINITIONS.map((slo) => sloDetailPage(slo));
}

export function sloDetailPage(slo: SLODefinition): SceneAppPage {
  return new SceneAppPage({
    title: slo.name,
    url: prefixRoute(`slo/${slo.id}`),
    routePath: `slo/${slo.id}`,
    subTitle: `${slo.route} | ${slo.type === 'latency' ? `p99 < ${slo.thresholdMs}ms` : `error rate < ${((slo.thresholdRate ?? 0) * 100).toFixed(1)}%`} | target ${(slo.target * 100).toFixed(1)}%`,
    getScene: () => detailScene(slo),
  });
}
