import type { Block, Settings, Ms } from './types';
import { at, addDays, parseHM, MIN, overlaps, fmtTime, hashId, startOfDay } from './time';

export interface SleepResult { block: Block; warning?: string }

/**
 * Protected sleep for the night that starts on `day`.
 * Hard fixed events win: a late event pushes bedtime later (with a 15 min wind-down);
 * an early event pulls wake earlier. If that leaves less than minSleep, we try to
 * extend wake later (when the morning is free) and otherwise warn.
 */
export function sleepForNight(day: Ms, settings: Settings, fixed: Block[]): SleepResult {
  const bedMin = parseHM(settings.bedtime);
  const wakeMin = parseHM(settings.wake);
  // bedtime before noon means "after midnight"
  const bed0 = bedMin < 12 * 60 ? at(addDays(day, 1), bedMin) : at(day, bedMin);
  const wake0 = at(addDays(day, 1), wakeMin);
  let bed = bed0, wake = wake0;
  const night = { start: at(day, 18 * 60), end: at(addDays(day, 1), 12 * 60) };
  const hard = fixed
    .filter(b => b.kind !== 'sleep' && b.flexibility === 'fixed' && overlaps(b, night))
    .sort((a, b) => a.start - b.start);

  const reasons: string[] = [];
  for (const ev of hard) {
    if (!overlaps(ev, { start: bed, end: wake + 30 * MIN })) continue; // need 30 min to get ready
    const mid = bed + (wake - bed) / 2;
    if (ev.start < mid) { // evening event running late
      bed = Math.max(bed, ev.end + 15 * MIN);
      reasons.push(`${ev.title} ends ${fmtTime(ev.end)}`);
    } else { // early-morning event
      wake = Math.min(wake, ev.start - 30 * MIN);
      reasons.push(`${ev.title} at ${fmtTime(ev.start)}`);
    }
  }

  let warning: string | undefined;
  const minSleep = settings.minSleepMin * MIN;
  if (wake - bed < minSleep) {
    // try sleeping in, up to the next hard event (minus 30 min to get ready)
    const nextMorning = hard.find(ev => ev.start >= wake);
    const latestWake = nextMorning ? nextMorning.start - 30 * MIN : at(addDays(day, 1), 12 * 60);
    const wanted = bed + minSleep;
    const newWake = Math.min(wanted, latestWake);
    if (newWake > wake) { wake = newWake; reasons.push('sleeping in to protect rest'); }
    if (wake - bed < minSleep) {
      const h = ((wake - bed) / 3_600_000).toFixed(1);
      warning = `Only ${h}h of sleep possible on the night of ${new Date(day).toDateString()} (${reasons.join(', ')}).`;
    }
  }

  const block: Block = {
    id: `sleep_${hashId(String(startOfDay(day)))}`,
    title: 'Sleep',
    kind: 'sleep',
    start: bed,
    end: Math.max(wake, bed + 60 * MIN),
    flexibility: 'fixed',
    source: 'planner',
    reason: reasons.length ? `Protected sleep, adjusted: ${reasons.join('; ')}` : 'Protected sleep',
  };
  return { block, warning };
}
