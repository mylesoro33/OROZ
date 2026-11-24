// Turn the model's structured output into OROZ items. Nothing here saves anything.
import type { Block, Task, Person, Source, TaskType } from '@engine/types';
import { at, addDays, fromIsoDay, hashId, uid } from '@engine/time';
import { guessType } from '@engine/talk';
import { emptyDraft, type Draft } from '../data/store';

export interface RawItems {
  events?: { title: string; date: string; start?: string; end?: string; all_day?: boolean; location?: string; kind?: 'event' | 'class' | 'work'; repeat_weekdays?: number[]; until_date?: string }[];
  tasks?: { title: string; type?: TaskType; date?: string; time?: string; duration_min?: number; place?: string; flexible?: boolean; by_date?: string }[];
  people?: { name: string; relationship?: string; birthday_month?: number; birthday_day?: number; birthday_year?: number }[];
  dates?: { title: string; date: string; end_date?: string; source_url: string }[];
}

export const ITEMS_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    events: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'date'], properties: {
      title: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD (first occurrence)' }, start: { type: 'string', description: 'HH:MM 24h' }, end: { type: 'string' },
      all_day: { type: 'boolean' }, location: { type: 'string' }, kind: { type: 'string', enum: ['event', 'class', 'work'] },
      repeat_weekdays: { type: 'array', items: { type: 'integer' }, description: '0=Sun..6=Sat for weekly schedules' }, until_date: { type: 'string' } } } },
    tasks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title'], properties: {
      title: { type: 'string' }, type: { type: 'string', enum: ['errand', 'call', 'home', 'work', 'school', 'health', 'social'] }, date: { type: 'string' }, time: { type: 'string' },
      duration_min: { type: 'integer' }, place: { type: 'string' }, flexible: { type: 'boolean', description: 'true when the person said fit it in / sometime' }, by_date: { type: 'string' } } } },
    people: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name'], properties: {
      name: { type: 'string' }, relationship: { type: 'string' }, birthday_month: { type: 'integer' }, birthday_day: { type: 'integer' }, birthday_year: { type: 'integer' } } } },
    dates: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'date', 'source_url'], properties: {
      title: { type: 'string' }, date: { type: 'string' }, end_date: { type: 'string' }, source_url: { type: 'string' } } } },
  },
};

export function toDraft(raw: RawItems, title: string, source: Source, extra: Partial<Draft> = {}): Draft {
  const now = Date.now();
  const events: Block[] = [];
  for (const e of raw.events ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) continue;
    const first = fromIsoDay(e.date);
    const until = e.until_date ? fromIsoDay(e.until_date) : addDays(first, 7 * 16);
    const seriesId = e.repeat_weekdays?.length ? uid('series') : undefined;
    const days = seriesId ? daysBetween(first, until, e.repeat_weekdays!) : [first];
    for (const d of days) {
      const allDay = e.all_day || !e.start;
      const start = allDay ? d : at(d, e.start!), end = allDay ? addDays(d, 1) : e.end ? at(d, e.end) : start + 3_600_000;
      events.push({ id: `${source}_${hashId(`${e.title}${start}`)}`, title: e.title, kind: e.kind ?? 'event', start, end, allDay: allDay || undefined, fixed: source !== 'talk', source, seriesId, location: e.location });
    }
  }
  const tasks: Task[] = (raw.tasks ?? []).map(t => {
    const day = t.date ? fromIsoDay(t.date) : undefined;
    return { id: uid('task'), title: t.title, type: t.type ?? guessType(t.title), date: t.flexible ? undefined : day, at: day !== undefined && t.time ? at(day, t.time) : undefined, durationMin: t.duration_min ?? 30, placeName: t.place, by: t.by_date ? addDays(fromIsoDay(t.by_date), 1) : t.flexible ? addDays(now, 7) : undefined, done: false, source, createdAt: now };
  });
  const people: Person[] = (raw.people ?? []).map(p => ({ id: uid('person'), name: p.name, relationship: p.relationship, birthday: p.birthday_month ? { month: p.birthday_month, day: p.birthday_day ?? 1, year: p.birthday_year } : undefined, source }));
  const today = new Date(now).setHours(0, 0, 0, 0);
  const dates: Block[] = (raw.dates ?? []).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && fromIsoDay(d.end_date ?? d.date) >= today).map(d => ({ id: `date_${hashId(d.title + d.date)}`, title: d.title, kind: 'date', start: fromIsoDay(d.date), end: addDays(fromIsoDay(d.end_date ?? d.date), 1), allDay: true, fixed: true, source: 'web', sourceUrl: d.source_url }));
  return { ...emptyDraft(title), events, tasks, people, dates, ...extra };
}

function daysBetween(first: number, until: number, weekdays: number[]): number[] {
  const out: number[] = [];
  for (let d = first; d <= until; d = addDays(d, 1)) if (weekdays.includes(new Date(d).getDay())) out.push(d);
  return out;
}
