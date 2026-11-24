import type { Ms } from './types';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export interface Interval { start: Ms; end: Ms }

export const startOfDay = (t: Ms): Ms => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const addDays = (t: Ms, n: number): Ms => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
export const addMin = (t: Ms, m: number): Ms => t + m * MIN;
export const minutesOfDay = (t: Ms): number => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); };
export const weekday = (t: Ms): number => new Date(t).getDay();
export const durMin = (i: Interval): number => Math.round((i.end - i.start) / MIN);

export function parseHM(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
export function hm(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
/** Timestamp at a given "HH:MM" (or minute count) on the day containing `day`. Minutes may exceed 1440. */
export function at(day: Ms, time: string | number): Ms {
  const mins = typeof time === 'string' ? parseHM(time) : time;
  const d = new Date(startOfDay(day));
  d.setMinutes(mins);
  return d.getTime();
}

export const overlaps = (a: Interval, b: Interval): boolean => a.start < b.end && b.start < a.end;
export const contains = (outer: Interval, inner: Interval): boolean => outer.start <= inner.start && inner.end <= outer.end;

export function mergeIntervals(list: Interval[]): Interval[] {
  const s = list.filter(i => i.end > i.start).map(i => ({ ...i })).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const i of s) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ start: i.start, end: i.end });
  }
  return out;
}

/** free = range minus busy */
export function subtract(range: Interval, busy: Interval[]): Interval[] {
  const merged = mergeIntervals(busy);
  const out: Interval[] = [];
  let cursor = range.start;
  for (const b of merged) {
    if (b.end <= cursor) continue;
    if (b.start >= range.end) break;
    if (b.start > cursor) out.push({ start: cursor, end: Math.min(b.start, range.end) });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < range.end) out.push({ start: cursor, end: range.end });
  return out;
}

export function fmtTime(t: Ms): string {
  const d = new Date(t);
  let h = d.getHours(); const m = d.getMinutes();
  const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  return m ? `${h}:${String(m).padStart(2, '0')}${ap}` : `${h}${ap}`;
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const dayName = (t: Ms, long = false): string => (long ? DAYS_LONG : DAYS)[weekday(t)];
export function fmtDay(t: Ms, now?: Ms): string {
  if (now !== undefined) {
    const diff = Math.round((startOfDay(t) - startOfDay(now)) / DAY);
    if (diff === 0) return 'today';
    if (diff === 1) return 'tomorrow';
    if (diff === -1) return 'yesterday';
    if (diff > 1 && diff < 7) return DAYS_LONG[weekday(t)];
  }
  const d = new Date(t);
  return `${DAYS[d.getDay()]} ${d.toLocaleString('en-US', { month: 'short' })} ${d.getDate()}`;
}
export const fmtDur = (min: number): string => {
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
};
export const daysBetween = (a: Ms, b: Ms): number => Math.round((startOfDay(b) - startOfDay(a)) / DAY);

/** Deterministic id from a seed string (FNV-1a). */
export function hashId(seed: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
let counter = 0;
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Local calendar day key, e.g. "2026-11-24". */
export function isoDay(t: Ms): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function fromIsoDay(s: string): Ms { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); }
