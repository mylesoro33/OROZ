import type { SleepPrefs, Ms } from './types';
import { at, addDays, parseHM, startOfDay, isoDay } from './time';

export interface Night { day: Ms; bedtime: Ms; wake: Ms; weeknight: boolean; overridden: boolean; hours: number }

export const isWeeknight = (day: Ms, workDays: number[]) => workDays.includes(new Date(addDays(day, 1)).getDay());

/** "HH:MM" bedtime → timestamp on the night starting `day` (times before noon are after midnight). */
export function bedtimeAt(day: Ms, hm: string): Ms {
  const m = parseHM(hm);
  return m < 12 * 60 ? at(addDays(day, 1), m) : at(day, m);
}

export function nightFor(day: Ms, prefs: SleepPrefs, workDays: number[]): Night {
  const d = startOfDay(day);
  const wk = isWeeknight(d, workDays);
  const base = wk ? prefs.weeknight : prefs.weekend;
  const ov = prefs.overrides[isoDay(d)];
  const bedtime = bedtimeAt(d, ov ?? base.bedtime);
  // wake depends on the NEXT day's kind
  const nextBase = workDays.includes(new Date(addDays(d, 1)).getDay()) ? prefs.weeknight : prefs.weekend;
  const wake = at(addDays(d, 1), nextBase.wake);
  return { day: d, bedtime, wake, weeknight: wk, overridden: ov !== undefined, hours: Math.max(0, (wake - bedtime) / 3_600_000) };
}
