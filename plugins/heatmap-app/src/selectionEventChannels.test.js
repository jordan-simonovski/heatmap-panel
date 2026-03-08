const { HeatmapSelectionEvent, HeatmapSelectionClearedEvent } = require('../../heatmap-panel/src/types');
const { TimeseriesSelectionEvent, TimeseriesSelectionClearedEvent } = require('../../timeseries-selection-panel/src/types');

describe('selection event channel compatibility', () => {
  it('uses the same selection channel across heatmap and timeseries panels', () => {
    expect(TimeseriesSelectionEvent.type).toBe(HeatmapSelectionEvent.type);
  });

  it('uses the same selection-clear channel across heatmap and timeseries panels', () => {
    expect(TimeseriesSelectionClearedEvent.type).toBe(HeatmapSelectionClearedEvent.type);
  });
});
