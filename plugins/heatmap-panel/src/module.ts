import { PanelPlugin } from '@grafana/data';
import { HeatmapOptions } from './types';
import { HeatmapPanel } from './components/HeatmapPanel';

export const plugin = new PanelPlugin<HeatmapOptions>(HeatmapPanel).setPanelOptions((builder) => {
  return builder
    .addRadio({
      path: 'yAxisScale',
      name: 'Y-axis scale',
      defaultValue: 'log',
      settings: {
        options: [
          { value: 'linear', label: 'Linear' },
          { value: 'log', label: 'Logarithmic' },
        ],
      },
    })
    .addRadio({
      path: 'colorScheme',
      name: 'Color scheme',
      defaultValue: 'blues',
      settings: {
        options: [
          { value: 'blues', label: 'Blues' },
          { value: 'greens', label: 'Greens' },
          { value: 'oranges', label: 'Oranges' },
          { value: 'reds', label: 'Reds' },
        ],
      },
    })
    .addSliderInput({
      path: 'yBuckets',
      name: 'Y-axis buckets',
      defaultValue: 40,
      settings: {
        min: 10,
        max: 100,
        step: 5,
      },
    });
});
