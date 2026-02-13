import { PanelPlugin } from '@grafana/data';
import { TimeseriesSelectionOptions } from './types';
import { TimeseriesPanel } from './components/TimeseriesPanel';

export const plugin = new PanelPlugin<TimeseriesSelectionOptions>(TimeseriesPanel)
  .setPanelOptions((builder) => {
    builder
      .addColorPicker({
        path: 'lineColor',
        name: 'Line color',
        defaultValue: '#4285f4',
      })
      .addSliderInput({
        path: 'fillOpacity',
        name: 'Fill opacity',
        defaultValue: 15,
        settings: { min: 0, max: 100, step: 5 },
      })
      .addNumberInput({
        path: 'thresholdValue',
        name: 'Threshold value',
        description: 'Optional horizontal threshold line',
        settings: { placeholder: 'None' },
      })
      .addColorPicker({
        path: 'thresholdColor',
        name: 'Threshold color',
        defaultValue: '#e53935',
      })
      .addTextInput({
        path: 'yAxisLabel',
        name: 'Y-axis label',
        defaultValue: 'Value',
      });
  });
