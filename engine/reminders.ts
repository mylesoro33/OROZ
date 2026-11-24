import type { Reminder, ReminderStage, Importance, Settings, Ms, LogEntry, Block } from './types';
import { MIN, HOUR, DAY, at, addDays, startOfDay, parseHM, minutesOfDay, fmtTime, hashId } from './time';

// Reminder engine: pure functions that decide WHEN to nudge and HOW hard.
// Delivery (Web Push, Notification API, a future native wrapper) lives elsewhere
// and only consumes `dueNow()` output — so it can move to Capacitor later.

const AGGRESSIVE = /\b(test|exam|quiz|midterm|final|reservation|reserved|flight|interview|appointment|appt|dentist|doctor|due today|submit|deadline)\b/i;
const PASSIVE = /\b(movie|nap|read|reading|gaming|game night|hang ?out|chill|snack|tv|show)\b/i;

export interface ImportanceInput { title: string; kind?: Block['kind'] | 'task' | 'occasion'; dueAt?: Ms; priority?: 1 | 2 | 3; now: Ms }

/** Automatic importance. Users can override with one tap (importanceSetBy: 'user'). */
export function autoImportance(i: ImportanceInput, learned?: Record<string, number>): Importance {
  let level: Importance = 'normal';
  if (i.kind === 'reservation' || AGGRESSIVE.test(i.title)) level = 'aggressive';
  else if (i.kind === 'hobby' || i.kind === 'nap' || i.kind === 'meal' || PASSIVE.test(i.title)) level = 'passive';
  else if (i.priority === 1 && i.dueAt !== undefined && i.dueAt - i.now < DAY) level = 'aggressive';
  else if (i.priority === 3) level = 'passive';
  // Learned adjustment: categories the user keeps dismissing get quieter.
  const cat = reminderCategory(i.title, i.kind);
  const bias = learned?.[cat] ?? 0; // -1 (always dismissed) .. +1 (always acted on)
  if (bias < -0.5 && level !== 'passive' && !AGGRESSIVE.test(i.title)) level = level === 'aggressive' ? 'normal' : 'passive';
  return level;
}

export function reminderCategory(title: string, kind?: string): string {
  const t = title.toLowerCase();
  if (/test|exam|quiz|midterm|final/.test(t)) return 'test';
  if (/birthday|bday|anniversary|gift/.test(t)) return 'occasion';
  if (/dinner|lunch|breakfast|snack|eat/.test(t)) return 'meal';
  return kind ?? 'other';
}

export function inQuietHours(t: Ms, settings: Settings): boolean {
  const m = minutesOfDay(t);
  const qs = parseHM(settings.quietHours[0]), qe = parseHM(settings.quietHours[1]);
  return qs <= qe ? m >= qs && m < qe : m >= qs || m < qe;
}

/** Move a time out of quiet hours: to the end of quiet time if that's still before `latest`, else to just before quiet time starts. */
function outOfQuiet(t: Ms, latest: Ms, settings: Settings, preferEarlier = false): Ms {
  if (!inQuietHours(t, settings)) return t;
  const qs = parseHM(settings.quietHours[0]), qe = parseHM(settings.quietHours[1]);
  const m = minutesOfDay(t);
  const endDay = qs > qe && m >= qs ? addDays(startOfDay(t), 1) : startOfDay(t);
  const after = at(endDay, qe);
  if (after <= latest && !preferEarlier) return after;
  const startDay = qs > qe && m < qe ? addDays(startOfDay(t), -1) : startOfDay(t);
  return at(startDay, qs) - 15 * MIN;
}

export interface BuildInput { id?: string; itemId: string; itemType: Reminder['itemType']; title: string; dueAt: Ms; importance: Importance; importanceSetBy?: 'auto' | 'user'; now: Ms; settings: Settings; leadMin?: number; category?: string }

export function buildReminder(i: BuildInput): Reminder {
  return {
    id: i.id ?? `rem_${hashId(i.itemType + i.itemId)}`,
    itemId: i.itemId, itemType: i.itemType, title: i.title, dueAt: i.dueAt,
    importance: i.importance, importanceSetBy: i.importanceSetBy ?? 'auto',
    stages: buildStages(i.dueAt, i.importance, i.now, i.settings, i.leadMin ?? 30, i.title),
    firedStages: [], category: i.category ?? reminderCategory(i.title),
  };
}

export function buildStages(dueAt: Ms, imp: Importance, now: Ms, settings: Settings, leadMin = 30, title = ''): ReminderStage[] {
  const raw: ReminderStage[] = [];
  if (imp === 'passive') {
    // mentioned in that day's morning digest (or now if the morning already passed)
    const digest = Math.max(at(dueAt, parseHM(settings.wake) + 30), now);
    raw.push({ at: Math.min(digest, dueAt), label: `Today: ${title}`, stage: 'digest' });
  } else if (imp === 'normal') {
    raw.push({ at: dueAt - leadMin * MIN, label: `${title} at ${fmtTime(dueAt)}`, stage: 'lead' });
  } else {
    const headsUp = dueAt - now > 30 * HOUR ? at(addDays(dueAt, -1), '19:00') : dueAt - 3 * HOUR;
    raw.push({ at: headsUp, label: `Heads-up: ${title} ${dueAt - headsUp > 12 * HOUR ? 'tomorrow' : 'later today'} at ${fmtTime(dueAt)}`, stage: 'heads-up' });
    raw.push({ at: dueAt - Math.max(leadMin, 60) * MIN, label: `${title} in ${Math.max(leadMin, 60)} min`, stage: 'lead' });
    raw.push({ at: dueAt - 10 * MIN, label: `${title} — starting soon`, stage: 'at-time' });
    for (let k = 1; k <= 3; k++) raw.push({ at: dueAt + k * 15 * MIN, label: `Still need to do: ${title}?`, stage: 'follow-up' });
  }
  const allowQuiet = settings.quietExceptions.includes(imp);
  const out = raw.map(s => {
    const exempt = allowQuiet && (s.stage === 'at-time' || s.stage === 'lead' || s.stage === 'follow-up');
    return exempt ? s : { ...s, at: outOfQuiet(s.at, dueAt, settings, s.stage === 'heads-up') };
  }).filter(s => s.at >= now - MIN || s.stage === 'digest');
  // De-dupe stages that collapsed onto the same minute, keep order
  const seen = new Set<number>();
  return out.sort((a, b) => a.at - b.at).filter(s => { const k = Math.round(s.at / MIN); if (seen.has(k)) return false; seen.add(k); return true; });
}

export interface Fire { reminder: Reminder; stageIndex: number; stage: ReminderStage; persistentBanner: boolean }

/** Which stages should fire right now. Pure: caller marks them fired. */
export function dueNow(reminders: Reminder[], now: Ms): Fire[] {
  const out: Fire[] = [];
  for (const r of reminders) {
    if (r.done) continue;
    if (r.snoozedUntil && now < r.snoozedUntil) continue;
    // fire only the latest unfired stage that is due (avoid a burst after being offline)
    let idx = -1;
    r.stages.forEach((s, i) => { if (s.at <= now && !r.firedStages.includes(i)) idx = i; });
    if (idx >= 0) out.push({ reminder: r, stageIndex: idx, stage: r.stages[idx], persistentBanner: r.importance === 'aggressive' });
  }
  return out;
}

export function markFired(r: Reminder, stageIndex: number): Reminder {
  const fired = new Set(r.firedStages);
  for (let i = 0; i <= stageIndex; i++) fired.add(i);
  return { ...r, firedStages: [...fired].sort((a, b) => a - b) };
}

export type SnoozeOption = '10m' | '1h' | 'tomorrow';
export function snooze(r: Reminder, opt: SnoozeOption, now: Ms, settings: Settings): Reminder {
  const until = opt === '10m' ? now + 10 * MIN : opt === '1h' ? now + HOUR : at(addDays(now, 1), parseHM(settings.wake) + 60);
  const snoozeStage: ReminderStage = { at: until, label: `Snoozed: ${r.title}`, stage: 'follow-up' };
  const stages = [...r.stages, snoozeStage].sort((a, b) => a.at - b.at);
  const firedStages = stages.map((s, i) => (s !== snoozeStage && s.at <= until ? i : -1)).filter(i => i >= 0);
  return { ...r, stages, firedStages, snoozedUntil: until };
}

export function setImportance(r: Reminder, imp: Importance, now: Ms, settings: Settings): Reminder {
  return { ...r, importance: imp, importanceSetBy: 'user', stages: buildStages(r.dueAt, imp, now, settings, 30, r.title), firedStages: [] };
}

/** Learn from snoozes/dismissals per category: returns bias -1..1 with exponential decay (half-life 21 days). */
export function learnReminderBias(logs: LogEntry[], now: Ms, halfLifeDays = 21): Record<string, number> {
  const acc: Record<string, { pos: number; neg: number }> = {};
  for (const l of logs) {
    if (!l.key.startsWith('reminder:')) continue;
    const cat = l.key.slice(9);
    const w = Math.pow(0.5, (now - l.at) / (halfLifeDays * DAY));
    const a = (acc[cat] ??= { pos: 0, neg: 0 });
    if (l.action === 'dismissed') a.neg += w;
    else if (l.action === 'snoozed') a.neg += w * 0.3;
    else if (l.action === 'completed' || l.action === 'accepted') a.pos += w;
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(acc)) if (v.pos + v.neg >= 2) out[k] = (v.pos - v.neg) / (v.pos + v.neg);
  return out;
}

export function dailyDigest(reminders: Reminder[], day: Ms): Reminder[] {
  const d0 = startOfDay(day), d1 = addDays(d0, 1);
  return reminders.filter(r => !r.done && r.dueAt >= d0 && r.dueAt < d1).sort((a, b) => a.dueAt - b.dueAt);
}
