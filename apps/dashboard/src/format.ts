export const number = (value: number) => new Intl.NumberFormat('ja-JP').format(value);
export function duration(ms: number) {
  const minutes = Math.floor(ms / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : minutes ? `${minutes}m` : ms ? '<1m' : '0m';
}
export function dateTime(value: string | null | undefined, timezone: string, short = false) {
  if (!value) return '記録なし';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '日時不明';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: timezone, month: 'short', day: 'numeric', ...(!short && { year: 'numeric', hour: '2-digit', minute: '2-digit' }),
  }).format(date);
}
export const sourceLabel = (source: string) => source === 'android_reader' ? 'Android' : source === 'chrome_extension' ? 'Chrome' : '計測元なし';
export function validTimezone(value: string | null, fallback: string) {
  if (!value) return fallback;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return value; }
  catch { return fallback; }
}

function localDate(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}-${parts.find(p => p.type === 'day')!.value}`;
}
export function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function zonedMidnight(value: string, timezone: string) {
  const midnight = Date.parse(`${value}T00:00:00Z`);
  let result = midnight;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(result));
    const get = (type: string) => Number(parts.find(p => p.type === type)!.value);
    const represented = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    const next = midnight - (represented - result);
    if (next === result) break;
    result = next;
  }
  return new Date(result).toISOString();
}
export function periodQuery(period: string, timezone: string, now = new Date()) {
  const query = new URLSearchParams({ timezone });
  if (period !== 'all') {
    const today = localDate(now, timezone);
    const days = period === 'today' ? 1 : period === '30d' ? 30 : 7;
    query.set('from', zonedMidnight(shiftDate(today, 1 - days), timezone));
    query.set('to', zonedMidnight(shiftDate(today, 1), timezone));
  }
  return query;
}
