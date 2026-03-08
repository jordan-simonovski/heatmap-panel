global.IntersectionObserver = class IntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { buildFilterClause } = require('@heatmap/shared-comparison');

describe('ad-hoc filter SQL semantics', () => {
  it('maps top-level keys to top-level columns', () => {
    expect(buildFilterClause('ServiceName', 'checkout-api', '=')).toBe("ServiceName = 'checkout-api'");
    expect(buildFilterClause('StatusCode', 'Error', '!=')).toBe("StatusCode != 'Error'");
  });

  it('maps non-top-level keys to SpanAttributes expressions', () => {
    expect(buildFilterClause('http.method', 'GET', '=')).toBe("SpanAttributes['http.method'] = 'GET'");
  });

  it('escapes ad-hoc values before building SQL', () => {
    expect(buildFilterClause('http.route', "a'b\\c", '=')).toBe("SpanAttributes['http.route'] = 'a\\'b\\\\c'");
  });
});
