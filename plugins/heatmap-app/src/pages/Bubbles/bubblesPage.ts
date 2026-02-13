import { SceneAppPage } from '@grafana/scenes';
import { bubblesScene } from './bubblesScene';
import { prefixRoute } from '../../utils/utils.routing';
import { ROUTES } from '../../constants';

export const bubblesPage = new SceneAppPage({
  title: 'Bubbles - Trace Analysis',
  url: prefixRoute(ROUTES.Bubbles),
  routePath: ROUTES.Bubbles,
  subTitle: 'Select spans on the heatmap to compare attribute distributions between selection and baseline.',
  getScene: () => bubblesScene(),
});
