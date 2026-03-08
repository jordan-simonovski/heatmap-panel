global.IntersectionObserver = class IntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { bubblesPage } = require('./pages/Bubbles/bubblesPage');
const { tracePage } = require('./pages/Trace/tracePage');
const { prefixRoute } = require('./utils/utils.routing');
const { ROUTES } = require('./constants');

describe('trace routing', () => {
  it('registers base bubbles page without nested drilldowns', () => {
    expect(bubblesPage.state.routePath).toBe(ROUTES.Bubbles);
    expect(bubblesPage.state.drilldowns).toBeUndefined();
  });

  it('registers explicit trace route page with bubbles parent', () => {
    expect(tracePage.state.url).toBe(prefixRoute(ROUTES.Trace));
    expect(tracePage.state.routePath).toBe(`${ROUTES.Trace}/:traceId`);
    expect(tracePage.state.getParentPage()).toBe(bubblesPage);
  });
});
