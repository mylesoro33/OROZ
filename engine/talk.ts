import type { Block, Task, TaskType, Place, Ms } from './types';
import { parseCapture, extractDate } from './parser';
import { at, addDays, startOfDay, MIN, uid, fmtTime, fmtDay } from './time';

// Offline "Tell OROZ": one natural line → a draft event or to-do. Nothing is saved here.

export interface TalkDraft { kind: 'event' | 'task' | 'person' | 'none'; line: string; event?: Block; events?: Block[]; task?: Task; fitIn?: boolean; person?: { name: string; month?: number; day?: number } }

const TYPE_RULES: [RegExp, TaskType][] = [
  [/^(buy|pick up|drop off|return|order|get)\b/i, 'errand'],
  [/\b(call|text|email|phone|reply|message)\b/i, 'call'],
  [/\b(dentist|doctor|dr\.?|pharmacy|meds|prescription|therapy|checkup|clinic|vet|workout|gym|yoga|run)\b/i, 'health'],
  [/\b(homework|study|class|exam|quiz|essay|project|school)\b/i, 'school'],
  [/\b(meeting|shift|work|report|deadline|client)\b/i, 'work'],
  [/\b(clean|laundry|dishes|fix|cook|vacuum|mow|trash)\b/i, 'home'],
  [/\b(party|dinner with|lunch with|hang ?out|birthday|date|game night|visit)\b/i, 'social'],
  [/\b(buy|pick up|drop off|return|groceries|store|haircut|bank|post office|gas|errand|order)\b/i, 'errand'],
];
export const guessType = (t: string): TaskType => TYPE_RULES.find(([re]) => re.test(t))?.[1] ?? 'errand';

const APPOINTMENT = /\b(dentist|doctor|appointment|appt|meeting|practice|class|game|recital|interview|haircut at|lesson|shift|party|dinner|lunch|church|service|concert|flight|workout|gym|yoga|run|rehearsal|training|session)\b/i;

export function talkToDraft(text: string, now: Ms, places: Place[] = []): TalkDraft {
  const weekly = recurring(text, now);
  if (weekly) return weekly;
  const cleaned = text.trim().replace(/^(gotta|got to|i need to|need to|i have to|have to|remind me to|i should|please)\s+/i, '').replace(/[.!]+$/, '');
  const l = ' ' + cleaned.toLowerCase() + ' ';
  const fitIn = /\b(fit (it |this )?in|sometime|some time|whenever|at some point)\b/.test(l);
  const thisWeek = /\b(this|the) week\b/.test(l);
  const stripped = cleaned.replace(/\b(fit (it |this )?in|sometime|some time|whenever|at some point|this week|the week)\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  const c = parseCapture(stripped, { now, places: places.map(p => ({ id: p.id, name: p.name })) });
  const place = c.place ? places.find(p => p.id === c.place!.id) : places.find(p => new RegExp(`\\b(at|to|from) (the )?${p.name.toLowerCase()}\\b`).test(l));
  const atName = !place ? cleaned.match(/\bat (the )?([A-Z][\w'&-]+(?: [A-Z][\w'&-]+)*)/)?.[2] : undefined;
  const actionFirst = /^(buy|get|plan|make|order|wrap|send|call|text|pick up|book|find)\b/i.test(cleaned);
  const rawTitle = actionFirst && ['birthday', 'food_pref', 'person_pref', 'command', 'note'].includes(c.kind) ? stripped : c.title;
  const title = cap(restoreCase(rawTitle.replace(/\s+(at|on|by)$/i, '').replace(/^(a|an|the)\s+/i, '').trim() || cleaned, cleaned));
  const type = guessType(cleaned);
  const day = c.day ?? (extractDate(l, now).day);

  if (!fitIn && c.start && (c.kind === 'event' || c.kind === 'meal' || c.kind === 'hobby' || c.kind === 'reminder' || c.kind === 'task')) {
    const isAppt = APPOINTMENT.test(cleaned) && !/^(buy|pick up|call|text|drop off)\b/i.test(cleaned);
    if (isAppt) {
      const event: Block = { id: uid('blk'), title, kind: 'event', start: c.start, end: c.start + (c.durationMin ?? 60) * MIN, fixed: false, source: 'talk', placeId: place?.id, location: place?.name ?? atName };
      return { kind: 'event', event, line: `${title}, ${fmtDay(c.start, now)} at ${fmtTime(c.start)}.` };
    }
    const explicit = /\b\d+(\.\d+)?\s*(m|min|mins|minutes|h|hr|hrs|hours)\b/i.test(cleaned);
    const task: Task = { id: uid('task'), title, type, at: c.start, date: startOfDay(c.start), durationMin: explicit ? c.durationMin ?? 30 : 30, placeId: place?.id, placeName: place?.name ?? atName, done: false, source: 'talk', createdAt: now };
    return { kind: 'task', task, line: `${title}, ${fmtDay(c.start, now)} at ${fmtTime(c.start)}.` };
  }
  if (c.kind === 'birthday' && !actionFirst) return { kind: 'person', person: { name: c.person ?? 'Someone', month: c.month, day: c.dayOfMonth }, line: c.month ? `${c.person}'s birthday, ${c.month}/${c.dayOfMonth}.` : `When is ${c.person}'s birthday?` };
  if (!actionFirst && (c.kind === 'command' || c.kind === 'food_pref' || c.kind === 'person_pref')) return { kind: 'none', line: '' };
  const by = thisWeek ? addDays(startOfDay(now), 7 - new Date(now).getDay() || 7) : day !== undefined ? addDays(day, 1) : undefined;
  const task: Task = { id: uid('task'), title, type, date: fitIn ? undefined : day, by: fitIn || thisWeek ? by ?? addDays(startOfDay(now), 7) : undefined, durationMin: c.durationMin ?? (type === 'call' ? 15 : 30), placeId: place?.id, placeName: place?.name ?? atName, done: false, source: 'talk', createdAt: now };
  const when = task.by && fitIn ? ' I can fit it in.' : day !== undefined ? ` ${cap(fmtDay(day, now))}, any time.` : ' No time set.';
  return { kind: 'task', task, fitIn: fitIn || thisWeek, line: `To-do: ${title}.${when}` };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** The parser lowercases; put back the casing the person used ("Jake", "CVS"). */
function restoreCase(title: string, original: string): string {
  const words = original.split(/\s+/);
  return title.split(/\s+/).map(w => words.find(o => o.toLowerCase().replace(/[^\w']/g, '') === w.toLowerCase()) ?? w).join(' ');
}
export const _talk = { at };

// ---------------------------------------------------------------------------
// Weekly schedules said out loud: "I work Monday to Thursday 8 to 4", "Practice every Tuesday at 6".
// ---------------------------------------------------------------------------
const DAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
const dayIdx = (w: string) => DAYS[w.toLowerCase().replace(/days?$|s$/, '').slice(0, w.toLowerCase().startsWith('thur') ? 5 : w.toLowerCase().startsWith('tues') ? 4 : 3)] ?? DAYS[w.toLowerCase().slice(0, 3)];
const DAY_RE = '(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*';

function weekdays(l: string): number[] | undefined {
  if (/\bweekdays\b|monday (?:to|through|thru|-) friday/.test(l) && !/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]* (?:to|through|thru|-) (?!friday)/.test(l.replace(/monday (?:to|through|thru|-) friday/, ''))) return [1, 2, 3, 4, 5];
  if (/\bweekends\b/.test(l)) return [0, 6];
  const range = l.match(new RegExp(`\\b${DAY_RE}\\s*(?:to|through|thru|-|–)\\s*${DAY_RE}`));
  if (range) {
    const a = dayIdx(range[1]), b = dayIdx(range[2]); const out: number[] = [];
    for (let d = a; ; d = (d + 1) % 7) { out.push(d); if (d === b || out.length > 7) break; }
    return out;
  }
  const all = [...l.matchAll(new RegExp(`\\b${DAY_RE}`, 'g'))].map(m => dayIdx(m[1]));
  return all.length ? [...new Set(all)].sort() : undefined;
}

function hourOf(h: number, mer?: string, after?: number): number {
  if (mer) return (h % 12) + (/p/i.test(mer) ? 12 : 0);
  if (after !== undefined) { let x = h; while (x <= after / 60) x += 12; return x > 24 ? h : x; }
  return h <= 6 ? h + 12 : h;
}

export function recurring(text: string, now: Ms): TalkDraft | undefined {
  const l = text.toLowerCase().replace(/[.!]/g, '');
  const isWeekly = /\bevery\b|\bweekdays\b|\bweekends\b|\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*days\b/.test(l) || new RegExp(`${DAY_RE}\\s*(?:to|through|thru|-|–)\\s*${DAY_RE}`).test(l) || (/^(i )?(work|have (class|school|practice))\b/.test(l) && !/\b(next|this|tomorrow|today|tonight)\b/.test(l));
  if (!isWeekly) return undefined;
  const days = weekdays(l); if (!days?.length) return undefined;
  const span = l.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?\s*(?:to|-|–|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?/);
  const single = l.match(/\bat (\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?/);
  let startMin: number, endMin: number;
  if (span) {
    startMin = hourOf(+span[1], span[3]) * 60 + (+(span[2] ?? 0));
    if (!span[3] && +span[1] >= 7 && +span[1] <= 11) startMin = +span[1] * 60 + (+(span[2] ?? 0)); // "8 to 4" → 8am
    endMin = hourOf(+span[4], span[6], startMin) * 60 + (+(span[5] ?? 0));
  } else if (single) {
    startMin = hourOf(+single[1], single[3]) * 60 + (+(single[2] ?? 0));
    endMin = startMin + (/practice|rehearsal|game/.test(l) ? 90 : 60);
  } else return undefined;
  if (endMin <= startMin) endMin = startMin + 60;
  const kind: Block['kind'] = /\b(work|shift)\b/.test(l) ? 'work' : /\b(class|school|lecture)\b/.test(l) ? 'class' : 'event';
  const title = kind === 'work' ? 'Work' : kind === 'class' && /\bschool\b/.test(l) ? 'School' : cap(restoreCase(
    l.replace(/^(i )?(have |go to |got )?/, '').replace(new RegExp(`\\s*(every|on|from)?\\s*${DAY_RE}.*$`), '').replace(/\s*(every|at|from)\s*$/, '').trim() || 'Weekly', text));
  const seriesId = uid('series'); const today = startOfDay(now); const events: Block[] = [];
  for (let i = 0; i < 7 * 16; i++) {
    const d = addDays(today, i);
    if (days.includes(new Date(d).getDay())) events.push({ id: uid('blk'), title, kind, start: at(d, startMin), end: at(d, endMin), fixed: false, source: 'talk', seriesId });
  }
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayText = days.length > 2 && days.every((d, i) => i === 0 || d === days[i - 1] + 1) ? `${names[days[0]]}–${names[days[days.length - 1]]}` : days.map(d => names[d]).join(', ');
  return { kind: 'event', events, line: `${title}, ${dayText} ${fmtTime(at(today, startMin))}–${fmtTime(at(today, endMin))}, every week.` };
}
