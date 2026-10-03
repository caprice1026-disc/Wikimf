import assert from 'node:assert/strict';
import { dateTime, duration, periodQuery, validTimezone, zonedMidnight } from '../src/format.ts';

assert.equal(zonedMidnight('2026-10-04', 'Asia/Tokyo'), '2026-10-03T15:00:00.000Z');
const springStart = Date.parse(zonedMidnight('2026-03-08', 'America/New_York'));
const springEnd = Date.parse(zonedMidnight('2026-03-09', 'America/New_York'));
assert.equal(springEnd - springStart, 23 * 3_600_000, 'DST spring day is 23 hours');
const fallStart = Date.parse(zonedMidnight('2026-11-01', 'America/New_York'));
const fallEnd = Date.parse(zonedMidnight('2026-11-02', 'America/New_York'));
assert.equal(fallEnd - fallStart, 25 * 3_600_000, 'DST fall day is 25 hours');
const today = periodQuery('today', 'Asia/Tokyo', new Date('2026-10-03T16:00:00Z'));
assert.equal(today.get('from'), '2026-10-03T15:00:00.000Z');
assert.equal(today.get('to'), '2026-10-04T15:00:00.000Z');
assert.equal(periodQuery('all', 'UTC').has('from'), false);
assert.equal(validTimezone('Invalid/Zone', 'Asia/Tokyo'), 'Asia/Tokyo');
assert.equal(duration(0), '0m');
assert.equal(duration(1000), '<1m');
assert.equal(dateTime(undefined, 'UTC'), '記録なし');
console.log('Dashboard date/time formatting checks: PASS (JST boundary and 23/25-hour DST days).');
