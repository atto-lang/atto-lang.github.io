/** Require a real UTC calendar date, not merely a Date.parse-normalized one.
 * Date.parse accepts nonexistent dates such as February 31 on some hosts.
 * Millisecond precision is not imposed on evidence producers.
 */
export function strictUtcTimestamp(value) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value)) {
    return false;
  }
  const instant = Date.parse(value);
  return Number.isFinite(instant) &&
    new Date(instant).toISOString().slice(0, 19) === value.slice(0, 19);
}
