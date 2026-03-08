import { SceneAppPage } from '@grafana/scenes';
import { detailScene } from './detailScene';
import { prefixRoute } from '../../utils/utils.routing';
import { getSLODefinitions, SLODefinition } from '../../sloDefinitions';

/**
 * Generate SceneAppPage sub-pages for each SLO definition.
 * These are registered as drilldown pages under the overview.
 */
export function sloDetailPages(parentPage?: SceneAppPage): SceneAppPage[] {
  return getSLODefinitions().map((slo) => sloDetailPage(slo, parentPage));
}

export function sloDetailPage(slo: SLODefinition, parentPage?: SceneAppPage): SceneAppPage {
  return new SceneAppPage({
    title: slo.name,
    url: prefixRoute(`slo/${slo.id}`),
    routePath: `slo/${slo.id}`,
    subTitle: `${slo.route} | ${slo.type === 'latency' ? `p99 < ${slo.thresholdMs}ms` : `error rate < ${((slo.thresholdRate ?? 0) * 100).toFixed(1)}%`} | target ${(slo.target * 100).toFixed(1)}%`,
    getParentPage: parentPage ? () => parentPage : undefined,
    getScene: () => detailScene(slo),
  });
}
