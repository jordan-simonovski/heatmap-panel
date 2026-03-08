import {
  EmbeddedScene,
  SceneRefreshPicker,
  SceneTimePicker,
  SceneTimeRange,
} from '@grafana/scenes';
import { getSLODefinitions } from '../../sloDefinitions';
import { SloOverviewBody, HeatmapDrilldown, buildCardPanels } from './HeatmapDrilldown';

export function overviewScene() {
  const timeRange = new SceneTimeRange({
    from: 'now-30m',
    to: 'now',
  });

  const cards = getSLODefinitions().map((slo) => buildCardPanels(slo));
  const drilldown = new HeatmapDrilldown();

  return new EmbeddedScene({
    $timeRange: timeRange,
    body: new SloOverviewBody({
      cards,
      selectedIndex: null,
      drilldown,
    }),
    controls: [
      new SceneTimePicker({ isOnCanvas: true }),
      new SceneRefreshPicker({
        intervals: ['10s', '30s', '1m', '5m'],
        isOnCanvas: true,
      }),
    ],
  });
}
