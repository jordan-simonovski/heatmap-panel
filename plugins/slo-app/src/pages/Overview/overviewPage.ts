import { SceneAppPage } from '@grafana/scenes';
import { overviewScene } from './overviewScene';
import { prefixRoute } from '../../utils/utils.routing';
import { ROUTES } from '../../constants';

export const overviewPage = new SceneAppPage({
  title: 'SLO Overview',
  url: prefixRoute(ROUTES.Overview),
  routePath: ROUTES.Overview,
  subTitle: 'Service Level Objectives derived from trace data. Click an SLO to drill into violations.',
  getScene: () => overviewScene(),
});
