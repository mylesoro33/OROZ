import type { Block, Task, Settings, Person, Place, Profile, Ms, TaskType, MealWindow } from './types';
import { nightFor } from './sleep';
import { upcomingBirthdays } from './occasions';
import { MIN, HOUR, addDays, startOfDay, at, parseHM, overlaps, subtract, fmtTime, fmtDay, fmtDur, dayName, isoDay, type Interval } from './time';

// ---------------------------------------------------------------------------
// Soft zones: meals and sleep are bands, never events.
// ---------------------------------------------------------------------------
export interface Band { kind: 'breakfast' | 'lunch' | 'dinner' | 'sleep'; start: Ms; end: Ms }

export function bandsFor(day: Ms, s: Settings): Band[] {
  const d = startOfDay(day);
  const meals = s.meals.map(m => ({ kind: m.type, start: at(d, m.from), end: at(d, m.to) }) as Band);
  const morning = nightFor(addDays(d, -1), s.sleep, s.workDays);
  const tonight = nightFor(d, s.sleep, s.workDays);
  return [...meals, { kind: 'sleep', start: morning.bedtime, end: morning.wake }, { kind: 'sleep', start: tonight.bedtime, end: tonight.wake }];
}

/** Calendar items for a day: events plus to-dos that have a time. */
export function itemsFor(day: Ms, blocks: Block[], tasks: Task[]): Block[] {
  const d0 = startOfDay(day), d1 = addDays(d0, 1);
  const timed: Block[] = tasks.filter(t => t.at && !t.done).map(t => ({ id: `task_${t.id}`, taskId: t.id, title: t.title, kind: 'todo', start: t.at!, end: t.at! + t.durationMin * MIN, fixed: false, source: t.source, placeId: t.placeId, location: t.placeName }));
  return [...blocks, ...timed].filter(b => overlaps(b, { start: d0, end: d1 })).sort((a, b) => Number(!!b.allDay) - Number(!!a.allDay) || a.start - b.start);
}

/** Open time between wake and bed, minus events. Meal bands are *not* busy (they're soft). */
export function openTime(day: Ms, blocks: Block[], tasks: Task[], s: Settings, from = 0): Interval[] {
  const d = startOfDay(day);
  const wake = nightFor(addDays(d, -1), s.sleep, s.workDays).wake, bed = nightFor(d, s.sleep, s.workDays).bedtime;
  const busy = itemsFor(d, blocks, tasks).filter(b => !b.allDay).map(b => ({ start: b.start, end: b.end }));
  return subtract({ start: Math.max(wake, from), end: bed }, busy).filter(i => i.end - i.start >= 15 * MIN);
}

// ---------------------------------------------------------------------------
// "Fit in": suggest open slots for a flexible to-do.
// ---------------------------------------------------------------------------
export interface Slot { start: Ms; end: Ms; why: string; score: number }

const PREFERRED: Record<TaskType, [number, number]> = { errand: [10, 19], call: [9, 20], home: [8, 21], work: [9, 17], school: [15, 21], health: [9, 17], social: [16, 21] };

export function suggestSlots(task: Task, ctx: { blocks: Block[]; tasks: Task[]; settings: Settings; places: Place[]; now: Ms; days?: number; limit?: number }): Slot[] {
  const { blocks, tasks, settings, now } = ctx;
  const dur = task.durationMin * MIN;
  const until = task.by ?? addDays(startOfDay(now), ctx.days ?? 7);
  const [h0, h1] = PREFERRED[task.type];
  const out: Slot[] = [];
  for (let d = startOfDay(now); d < until; d = addDays(d, 1)) {
    const bands = bandsFor(d, settings).filter(b => b.kind !== 'sleep');
    const items = itemsFor(d, blocks, tasks).filter(b => !b.allDay);
    for (const f of openTime(d, blocks, tasks, settings, now + 30 * MIN)) {
      for (let s = Math.ceil((f.start + 10 * MIN) / (15 * MIN)) * 15 * MIN; s + dur <= f.end - 5 * MIN; s += 30 * MIN) {
        const e = s + dur; const h = new Date(s).getHours();
        let score = 0; const why: string[] = [];
        score += h >= h0 && h < h1 ? 2 : -1;
        if (bands.some(b => overlaps(b, { start: s, end: e }))) score -= 1.5; // keep meals clear when possible
        score -= (d - startOfDay(now)) / (3 * 24 * HOUR); // sooner is a bit better
        const near = nearPlace(task, items, ctx.places, s, e);
        if (near) { score += 3 - near.gap / HOUR; why.push(near.text); }
        const prev = items.filter(b => b.end <= s).at(-1);
        if (!near && prev && s - prev.end <= 45 * MIN) { score += 0.5; why.push(`after ${prev.title}`); }
        if (!why.length) why.push(`${fmtDur((f.end - f.start) / MIN)} free`);
        out.push({ start: s, end: e, why: why.join(' · '), score });
      }
    }
  }
  // best few, at most one per day so choices are actually different
  const picked: Slot[] = []; const days = new Set<string>();
  for (const s of out.sort((a, b) => b.score - a.score || a.start - b.start)) {
    if (days.has(isoDay(s.start))) continue;
    picked.push(s); days.add(isoDay(s.start));
    if (picked.length >= (ctx.limit ?? 3)) break;
  }
  return picked.sort((a, b) => a.start - b.start);
}

function placeMatches(a?: string, b?: string) {
  if (!a || !b) return false;
  const x = a.toLowerCase(), y = b.toLowerCase();
  return x.includes(y) || y.includes(x);
}
function nearPlace(task: Task, items: Block[], places: Place[], s: Ms, e: Ms): { text: string; gap: number } | undefined {
  const pname = task.placeName ?? places.find(p => p.id === task.placeId)?.name;
  if (!pname && !task.placeId) return undefined;
  const hit = items.find(b => (b.placeId && b.placeId === task.placeId) || placeMatches(b.location, pname) || placeMatches(b.title, pname));
  if (!hit) return undefined;
  const gap = Math.min(Math.abs(s - hit.end), Math.abs(hit.start - e));
  if (gap <= HOUR) return { text: `you'll be at ${hit.location ?? pname}`, gap };
  return undefined;
}

/** "You're near the pharmacy at 3 — add that errand?" */
export interface ErrandHint { taskId: string; text: string; start: Ms }
export function errandHints(day: Ms, blocks: Block[], tasks: Task[], places: Place[]): ErrandHint[] {
  const items = itemsFor(day, blocks, tasks).filter(b => !b.allDay && b.kind !== 'todo');
  const out: ErrandHint[] = [];
  for (const t of tasks.filter(t => !t.done && !t.at && (t.placeId || t.placeName))) {
    const pname = t.placeName ?? places.find(p => p.id === t.placeId)?.name;
    const hit = items.find(b => (b.placeId && b.placeId === t.placeId) || placeMatches(b.location, pname) || placeMatches(b.title, pname));
    if (hit) out.push({ taskId: t.id, start: hit.end, text: `You're at ${hit.location ?? pname} at ${fmtTime(hit.start)}. Add "${t.title}" after?` });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Day summary: what's on, what's open, what's coming.
// ---------------------------------------------------------------------------
export interface Summary { on: string; open: string; coming?: string; weather?: string }

export function daySummary(day: Ms, blocks: Block[], tasks: Task[], people: Person[], s: Settings, now: Ms, weather?: string): Summary {
  const d = startOfDay(day);
  const items = itemsFor(d, blocks, tasks);
  const timed = items.filter(b => !b.allDay);
  const allDay = items.filter(b => b.allDay);
  const on = timed.length ? `${timed.length} ${timed.length === 1 ? 'thing' : 'things'}, ${fmtTime(timed[0].start)}–${fmtTime(timed[timed.length - 1].end)}` : allDay.length ? allDay[0].title : 'Nothing scheduled';
  const open = openTime(d, blocks, tasks, s, d === startOfDay(now) ? now : 0).sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
  const openLine = open ? `Open ${fmtTime(open.start)}–${fmtTime(open.end)}` : 'No open time left';
  let coming: string | undefined;
  const bday = upcomingBirthdays(people, d, 7)[0];
  const due = tasks.filter(t => !t.done && t.by && t.by > d && t.by < addDays(d, 3)).sort((a, b) => a.by! - b.by!)[0];
  const date = blocks.filter(b => b.kind === 'date' && b.start >= d && b.start < addDays(d, 14)).sort((a, b) => a.start - b.start)[0];
  if (bday) coming = bday.inDays === 0 ? `${bday.person.name}'s birthday today` : `${bday.person.name}'s birthday ${fmtDay(bday.date, d)}`;
  else if (date) coming = `${date.title} ${fmtDay(date.start, d)}`;
  else if (due) coming = `${due.title} by ${dayName(due.by! - 1)}`;
  return { on, open: openLine, coming, weather };
}

// ---------------------------------------------------------------------------
// Weather → one quiet line (Open-Meteo daily data).
// ---------------------------------------------------------------------------
export function weatherNote(d: { tmax: number; tmin: number; precip: number; code: number }, unit: 'F' | 'C' = 'F'): string {
  const t = `${Math.round(d.tmax)}°/${Math.round(d.tmin)}°${unit}`;
  if (d.code >= 71 && d.code <= 77) return `${t} · snow, leave extra time`;
  if (d.code >= 95) return `${t} · storms likely`;
  if (d.precip >= 60) return `${t} · rain likely, bring a jacket`;
  if (d.precip >= 30) return `${t} · chance of rain`;
  if ((unit === 'F' && d.tmax >= 90) || (unit === 'C' && d.tmax >= 32)) return `${t} · hot, plan outdoor errands early`;
  if ((unit === 'F' && d.tmax <= 32) || (unit === 'C' && d.tmax <= 0)) return `${t} · freezing`;
  return t;
}

// ---------------------------------------------------------------------------
// Links: turn whatever was pasted into something readable.
// ---------------------------------------------------------------------------
export function normalizeLink(raw: string): { kind: 'ics' | 'page'; url: string } {
  let url = raw.trim().replace(/^webcals?:\/\//i, 'https://');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try {
    const u = new URL(url);
    // Google Calendar public "embed" or "cid" links → the public iCal feed
    if (u.hostname === 'calendar.google.com') {
      const src = u.searchParams.get('src') ?? u.searchParams.get('cid');
      if (src) { const id = src.includes('@') ? src : atobSafe(src); return { kind: 'ics', url: `https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/public/basic.ics` }; }
    }
    if (/\.ics($|\?)/i.test(u.pathname + u.search) || /ical|icalendar|\/feed|calendar\.ics|export/i.test(u.pathname)) return { kind: 'ics', url };
  } catch { /* fall through */ }
  return { kind: 'page', url };
}
const atobSafe = (s: string) => { try { return typeof atob === 'function' ? atob(s) : s; } catch { return s; } };

// ---------------------------------------------------------------------------
// One small question at a time.
// ---------------------------------------------------------------------------
export type NudgeAction = { type: 'profile' } | { type: 'hours'; day: Ms } | { type: 'people' } | { type: 'places' } | { type: 'dates' } | { type: 'connect' } | { type: 'sleep' };
export interface Nudge { id: string; text: string; cta: string; action: NudgeAction }

export function nudges(st: { now: Ms; profile: Profile; blocks: Block[]; people: Person[]; places: Place[]; dismissed: string[]; hasKey: boolean; connected: boolean; workDays: number[]; foundDates: boolean }): Nudge[] {
  const out: Nudge[] = []; const p = st.profile; const today = startOfDay(st.now);
  if (!st.connected) out.push({ id: 'connect', text: 'Connect your calendars to fill this in faster.', cta: 'Connect', action: { type: 'connect' } });
  if (!p.name) out.push({ id: 'name', text: 'What should I call you?', cta: 'Add', action: { type: 'profile' } });
  if (p.occupation && p.occupation !== 'retired' && p.occupation !== 'home') {
    const word = p.occupation === 'student' ? 'class schedule' : 'hours';
    for (let i = 0; i < 7; i++) {
      const d = addDays(today, i);
      if (!st.workDays.includes(new Date(d).getDay())) continue;
      if (!st.blocks.some(b => !b.allDay && (b.kind === 'class' || b.kind === 'work') && overlaps(b, { start: d, end: addDays(d, 1) }))) {
        out.push({ id: `hours-${new Date(d).getDay()}`, text: `I don't have your ${dayName(d, true)} ${word}. Want to add ${p.occupation === 'student' ? 'it' : 'them'}?`, cta: 'Add', action: { type: 'hours', day: d } });
        break;
      }
    }
  }
  if (!st.places.length) out.push({ id: 'places', text: 'Where do you go most often?', cta: 'Add places', action: { type: 'places' } });
  if (!st.people.length) out.push({ id: 'people', text: 'Whose birthdays should I remember?', cta: 'Add people', action: { type: 'people' } });
  if (st.hasKey && (p.city || p.occupation) && !st.foundDates) out.push({ id: 'dates', text: `Want me to look up important dates for you${p.city ? ` in ${p.city}` : ''}?`, cta: 'Look up', action: { type: 'dates' } });
  return out.filter(n => !st.dismissed.includes(n.id));
}

/** What kinds of dates matter, from what the person told OROZ. Used to steer the web lookup. */
export function dateTopics(p: Profile): string[] {
  const t: string[] = [];
  const level = (p.occupationDetail ?? '').toLowerCase();
  if (p.occupation === 'student' || p.occupation === 'both') {
    t.push('school breaks and holidays');
    if (/1[0-2]|junior|senior|high/.test(level)) t.push('SAT and ACT test dates', 'college application deadlines', 'FAFSA opening date and state aid deadlines');
    else if (/college|university|freshman|sophomore/.test(level)) t.push('course registration dates', 'FAFSA renewal deadline');
  }
  if (p.occupation !== 'student') t.push('federal and state tax filing deadline', 'quarterly estimated tax deadlines if self-employed', 'open enrollment for health benefits');
  t.push("driver's license and vehicle registration renewal rules", 'voter registration deadline and next election day', 'local public holidays');
  if (p.ageRange && /65|retired/.test(p.ageRange + (p.occupation ?? ''))) t.push('Medicare enrollment periods');
  return t;
}

export { parseHM, isoDay };
export type { MealWindow };
