// Python capture uses +00:00; the hosted adapter uses .000Z. Normalize at the
// transport boundary so identical instants never fail the frozen engine's
// exact opening-bar check. Prices, source identity and rules are unchanged.
export function canonicalFeed(feed) {
  const result = {...feed};
  for (const key of ['bars', 'daily', 'one_bars', 'trend_bars']) {
    if (!Array.isArray(feed[key])) continue;
    result[key] = feed[key].map(bar => {
      const at = Date.parse(bar.time);
      if (!Number.isFinite(at)) throw new Error('Invalid timestamp in '+key);
      return {...bar, time:new Date(at).toISOString()};
    });
  }
  return result;
}
