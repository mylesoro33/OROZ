import type { Block, Task, TaskType, Place, Ms } from './types';
import { parseCapture, extractDate } from './parser';
import { at, addDays, startOfDay, MIN, uid, fmtTime, fmtDay } from './time';

// Offline "Tell OROZ": one natural line → a draft event or to-do. Nothing is saved here.

export interface TalkDraft { kind: 'event' | 'task' | 'person' | 'none'; line: string; event?: Block; task?: Task; fitIn?: boolean; person?: { name: string; month?: number; day?: number } }

const TYPE_RULES: [RegExp, TaskType][] = [
  [/^(buy|pick up|drop off|return|order|get)\b/i, 'errand'],
  [/\b(call|text|email|phone|reply|message)\b/i, 'call'],
  [/\b(dentist|doctor|dr\.?|pharmacy|meds|prescription|therapy|checkup|clinic|vet)\b/i, 'health'],
  [/\b(homework|study|class|exam|quiz|essay|project|school)\b/i, 'school'],
  [/\b(meeting|shift|work|report|deadline|client)\b/i, 'work'],
  [/\b(clean|laundry|dishes|fix|cook|vacuum|mow|trash)\b/i, 'home'],
  [/\b(party|dinner with|lunch with|hang ?out|birthday|date|game night|visit)\b/i, 'social'],
  [/\b(buy|pick up|drop off|return|groceries|store|haircut|bank|post office|gas|errand|order)\b/i, 'errand'],
];
export const guessType = (t: string): TaskType => TYPE_RULES.find(([re]) => re.test(t))?.[1] ?? 'errand';

const APPOINTMENT = /\b(dentist|doctor|appointment|appt|meeting|practice|class|game|recital|interview|haircut at|lesson|shift|party|dinner|lunch|church|service|concert|flight)\b/i;

export function talkToDraft(text: string, now: Ms, places: Place[] = []): TalkDraft {
  const cleaned = text.trim().replace(/^(gotta|got to|i need to|need to|i have to|have to|remind me to|i should|please)\s+/i, '').replace(/[.!]+$/, '');
  const l = ' ' + cleaned.toLowerCase() + ' ';
  const fitIn = /\b(fit (it |this )?in|sometime|some time|whenever|at some point)\b/.test(l);
  const thisWeek = /\b(this|the) week\b/.test(l);
  const stripped = cleaned.replace(/\b(fit (it |this )?in|sometime|some time|whenever|at some point|this week|the week)\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  const c = parseCapture(stripped, { now, places: places.map(p => ({ id: p.id, name: p.name })) });
  const place = c.place ? places.find(p => p.id === c.place!.id) : places.find(p => new RegExp(`\\b(at|to|from) (the )?${p.name.toLowerCase()}\\b`).test(l));
  const atName = !place ? cleaned.match(/\bat (the )?([A-Z][\w'&-]+(?: [A-Z][\w'&-]+)*)/)?.[2] : undefined;
  const title = cap(restoreCase(c.title.replace(/\s+(at|on|by)$/i, '').trim() || cleaned, cleaned));
  const type = guessType(cleaned);
  const day = c.day ?? (extractDate(l, now).day);

  if (!fitIn && c.start && (c.kind === 'event' || c.kind === 'meal' || c.kind === 'hobby' || c.kind === 'reminder' || c.kind === 'task')) {
    const isAppt = APPOINTMENT.test(cleaned) && !/^(buy|pick up|call|text|drop off)\b/i.test(cleaned);
    if (isAppt) {
      const event: Block = { id: uid('blk'), title, kind: 'event', start: c.start, end: c.start + (c.durationMin ?? 60) * MIN, fixed: false, source: 'talk', placeId: place?.id, location: place?.name ?? atName };
      return { kind: 'event', event, line: `${title}, ${fmtDay(c.start, now)} at ${fmtTime(c.start)}.` };
    }
    const task: Task = { id: uid('task'), title, type, at: c.start, date: startOfDay(c.start), durationMin: c.durationMin ?? 30, placeId: place?.id, placeName: place?.name ?? atName, done: false, source: 'talk', createdAt: now };
    return { kind: 'task', task, line: `${title}, ${fmtDay(c.start, now)} at ${fmtTime(c.start)}.` };
  }
  const actionFirst = /^(buy|get|plan|make|order|wrap|send|call|text|pick up|book|find)\b/i.test(cleaned);
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
