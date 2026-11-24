import type { Block, SleepPrefs, Ms } from './types';
import { at, addDays, parseHM, MIN, overlaps, fmtTime, hashId, startOfDay, isoDay } from './time';

export interface Night {
  day: Ms;                   // the evening this night starts on
  bedtime: Ms;               // planned bedtime (override or the night's default)
  range: [Ms, Ms];           // typical range around it
  wake: Ms;
  schoolNight: boolean;
  overridden: boolean;
  block: Block;              // protected sleep (derived)
  windDownBy: Ms;            // homework should wrap by
  warning?: string;
}

/** A school night is any night before a school day. */
export const isSchoolNight = (day: Ms, schoolDays: number[]) => schoolDays.includes(new Date(addDays(day, 1)).getDay());

/** Bedtime "HH:MM" → timestamp on the night starting `day` (times before noon are after midnight). */
export function bedtimeAt(day: Ms, hm: string): Ms {
  const m = parseHM(hm);
  return m < 12 * 60 ? at(addDays(day, 1), m) : at(day, m);
}

export function nightFor(day: Ms, prefs: SleepPrefs, schoolDays: number[], fixed: Block[] = []): Night {
  const d = startOfDay(day);
  const school = isSchoolNight(d, schoolDays);
  const base = school ? prefs.schoolNight : prefs.weekend;
  const ov = prefs.overrides[isoDay(d)];
  let bed = bedtimeAt(d, ov ?? base.bedtime);
  let wake = at(addDays(d, 1), base.wake);
  const reasons: string[] = [];
  const hard = fixed.filter(b => b.fixed && !b.allDay && b.kind !== 'sleep' && overlaps(b, { start: at(d, 18 * 60), end: at(addDays(d, 1), 12 * 60) }));
  for (const ev of hard.sort((a, b) => a.start - b.start)) {
    if (!overlaps(ev, { start: bed, end: wake + 30 * MIN })) continue;
    if (ev.start < bed + (wake - bed) / 2) { bed = Math.max(bed, ev.end + 15 * MIN); reasons.push(`${ev.title} ends ${fmtTime(ev.end)}`); }
    else { wake = Math.min(wake, ev.start - 30 * MIN); reasons.push(`${ev.title} at ${fmtTime(ev.start)}`); }
  }
  let warning: string | undefined;
  if (wake - bed < prefs.minSleepMin * MIN) warning = `Only ${((wake - bed) / 3_600_000).toFixed(1)}h of sleep${reasons.length ? ` (${reasons.join(', ')})` : ''}.`;
  const flex = base.flexMin * MIN;
  return {
    day: d, bedtime: bed, range: [bed - flex, bed + flex], wake, schoolNight: school, overridden: ov !== undefined,
    windDownBy: bed - prefs.windDownMin * MIN, warning,
    block: { id: `sleep_${hashId(String(d))}`, title: 'Sleep', kind: 'sleep', start: bed, end: Math.max(wake, bed + 60 * MIN), fixed: true, source: 'manual', derived: true, reason: reasons.length ? `Adjusted: ${reasons.join('; ')}` : undefined },
  };
}

export const sleepHours = (bed: Ms, wake: Ms) => Math.max(0, (wake - bed) / 3_600_000);
