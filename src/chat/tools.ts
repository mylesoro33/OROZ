// Tools OROZ's chat can use. Reads are free; changes are undoable; anything from
// the web or an account becomes a PendingImport that the user approves first.
import type { Block, Task, Person } from '@engine/types';
import { deriveDay } from '@engine/day';
import { upcomingBirthdays } from '@engine/occasions';
import { nightFor, sleepHours } from '@engine/sleep';
import { at, addDays, fmtTime, fromIsoDay, isoDay, uid, hashId, MIN, startOfDay, dayName } from '@engine/time';
import { store, type PendingImport } from '../data/store';

const D = { type: 'string', description: 'Local date YYYY-MM-DD' };
const HM = { type: 'string', description: 'Local time HH:MM (24h)' };
const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false });

export const TOOL_DEFS = [
  { name: 'get_schedule', description: "Read the user's schedule (classes, events, meals, sleep) for one or more days.", input_schema: obj({ start_date: D, days: { type: 'integer', description: '1-14' } }, ['start_date']) },
  { name: 'get_tasks', description: 'Read open to-do items (and recently done ones).', input_schema: obj({}, []) },
  { name: 'get_people', description: 'Read saved people and upcoming birthdays.', input_schema: obj({}, []) },
  { name: 'add_event', description: 'Add an event or study block. Use repeat_weekdays (0=Sun..6=Sat) with weeks for a weekly class schedule.', input_schema: obj({ title: { type: 'string' }, date: D, start: HM, end: HM, kind: { type: 'string', enum: ['class', 'event', 'study'] }, location: { type: 'string' }, repeat_weekdays: { type: 'array', items: { type: 'integer' } }, weeks: { type: 'integer' } }, ['title', 'date', 'start', 'end', 'kind']) },
  { name: 'move_event', description: 'Move or resize an existing event by id (from get_schedule). Imported events cannot be moved.', input_schema: obj({ id: { type: 'string' }, date: D, start: HM, end: HM }, ['id', 'date', 'start', 'end']) },
  { name: 'delete_event', description: 'Delete an event the user created, by id.', input_schema: obj({ id: { type: 'string' } }, ['id']) },
  { name: 'add_task', description: 'Add a to-do.', input_schema: obj({ title: { type: 'string' }, due_date: D, due_time: HM, tag: { type: 'string', description: 'class or label' }, type: { type: 'string', enum: ['school', 'work', 'personal', 'errand', 'event'] } }, ['title', 'type']) },
  { name: 'complete_task', description: 'Mark a to-do done, by id.', input_schema: obj({ id: { type: 'string' } }, ['id']) },
  { name: 'set_bedtime', description: "Set bedtime for one night (the evening's date). Use for 'move bedtime later tonight'.", input_schema: obj({ night_of: D, bedtime: HM }, ['night_of', 'bedtime']) },
  { name: 'save_person', description: 'Add or update a person the user told you about.', input_schema: obj({ name: { type: 'string' }, relationship: { type: 'string' }, birthday_month: { type: 'integer' }, birthday_day: { type: 'integer' }, note: { type: 'string' } }, ['name']) },
  { name: 'remember', description: 'Save a lasting fact about the user (routine, preference, person detail) so they never repeat it.', input_schema: obj({ fact: { type: 'string' } }, ['fact']) },
  { name: 'propose_events', description: 'Show dates found on the web (school calendar, events) to the user for approval. Nothing is saved until they tap Add.', input_schema: obj({ summary: { type: 'string' }, source_url: { type: 'string' }, events: { type: 'array', items: obj({ title: { type: 'string' }, date: D, end_date: D, start: HM, end: HM, kind: { type: 'string', enum: ['no-school', 'event', 'class'] } }, ['title', 'date', 'kind']) } }, ['summary', 'events']) },
  { name: 'propose_lunch_menu', description: 'Show a school lunch menu (per day) for approval before saving it to the days.', input_schema: obj({ source_url: { type: 'string' }, days: { type: 'array', items: obj({ date: D, items: { type: 'array', items: { type: 'string' } } }, ['date', 'items']) } }, ['days']) },
  { name: 'propose_people', description: 'Show people/birthdays found on a public page the user linked, for approval.', input_schema: obj({ source_url: { type: 'string' }, people: { type: 'array', items: obj({ name: { type: 'string' }, birthday_month: { type: 'integer' }, birthday_day: { type: 'integer' } }, ['name']) } }, ['people']) },
];

export const TOOL_SOURCE: Record<string, string> = { get_schedule: 'Schedule', get_tasks: 'To-Do', get_people: 'People', set_bedtime: 'Sleep', remember: 'Memory' };

export interface ToolCtx { changed: boolean; pending?: PendingImport; sources: Set<string> }

const S = () => store().state;
const ts = (date: string, hm?: string) => (hm ? at(fromIsoDay(date), hm) : fromIsoDay(date));

function describe(b: Block): string {
  const time = b.allDay ? 'all day' : `${fmtTime(b.start)}–${fmtTime(b.end)}`;
  return `${time} ${b.title}${b.kind !== 'event' ? ` [${b.kind}]` : ''}${b.derived ? '' : ` (id ${b.id}${b.fixed ? ', fixed' : ''})`}${b.location ? ` @ ${b.location}` : ''}`;
}

export function runTool(name: string, input: any, ctx: ToolCtx): string {
  const s = store(); const st = S(); const now = Date.now();
  switch (name) {
    case 'get_schedule': {
      const days = Math.min(14, Math.max(1, input.days ?? 1));
      const out: string[] = [];
      for (let i = 0; i < days; i++) {
        const d = addDays(fromIsoDay(input.start_date), i);
        const v = deriveDay(d, st.blocks, st.settings);
        const due = st.tasks.filter(t => !t.done && t.due !== undefined && startOfDay(t.due) === d);
        out.push(`${dayName(d, true)} ${isoDay(d)}:\n` + (v.blocks.filter(b => b.kind !== 'sleep').map(b => '  ' + describe(b)).join('\n') || '  (nothing)') +
          `\n  bedtime ~${fmtTime(v.tonight.bedtime)} (${v.tonight.overridden ? 'set for tonight' : v.tonight.schoolNight ? 'school night' : 'weekend'}), wake ${fmtTime(v.tonight.wake)}, homework should wrap by ${fmtTime(v.tonight.windDownBy)}` +
          (st.lunchMenus[isoDay(d)] ? `\n  lunch: ${st.lunchMenus[isoDay(d)].join(', ')}` : '') + (due.length ? `\n  due: ${due.map(t => t.title).join(', ')}` : ''));
        for (const b of v.blocks) if (b.source !== 'manual' && b.source !== 'chat') ctx.sources.add(labelFor(b.source));
      }
      return out.join('\n');
    }
    case 'get_tasks': {
      const open = st.tasks.filter(t => !t.done);
      for (const t of open) if (t.source !== 'manual' && t.source !== 'chat') ctx.sources.add(labelFor(t.source));
      return open.map(t => `${t.id}: ${t.title}${t.due ? ` (due ${isoDay(t.due)} ${fmtTime(t.due)})` : ''}${t.tag ? ` #${t.tag}` : ''} [${t.type}]`).join('\n') || 'No open tasks.';
    }
    case 'get_people': {
      const up = upcomingBirthdays(st.people, now, 60);
      return [`People: ${st.people.map(p => `${p.name}${p.relationship ? ` (${p.relationship})` : ''}${p.birthday ? ` bday ${p.birthday.month}/${p.birthday.day}` : ''}`).join('; ') || 'none yet'}`,
        `Upcoming birthdays (60 days): ${up.map(b => `${b.person.name} ${isoDay(b.date)} in ${b.inDays}d`).join('; ') || 'none'}`].join('\n');
    }
    case 'add_event': {
      s.checkpoint(); ctx.changed = true;
      const base = fromIsoDay(input.date); const seriesId = input.repeat_weekdays?.length ? uid('series') : undefined;
      const days: number[] = [];
      if (seriesId) for (let w = 0; w < (input.weeks ?? 16); w++) for (const wd of input.repeat_weekdays) { const d = addDays(base, w * 7 + ((wd - new Date(base).getDay() + 7) % 7)); if (!days.includes(d)) days.push(d); }
      else days.push(base);
      const blocks: Block[] = days.map(d => ({ id: uid('blk'), title: input.title, kind: input.kind, start: at(d, input.start), end: at(d, input.end), fixed: input.kind === 'class', source: 'chat', seriesId, location: input.location }));
      s.upsert('blocks', blocks);
      return `Added ${blocks.length} block(s).`;
    }
    case 'move_event': {
      const b = st.blocks.find(x => x.id === input.id);
      if (!b) return 'No such event.';
      if (b.source !== 'manual' && b.source !== 'chat') return `That event comes from ${labelFor(b.source)} and can't be moved here.`;
      s.checkpoint(); ctx.changed = true;
      s.upsert('blocks', [{ ...b, start: ts(input.date, input.start), end: ts(input.date, input.end) }]);
      return 'Moved.';
    }
    case 'delete_event': {
      const b = st.blocks.find(x => x.id === input.id);
      if (!b || (b.source !== 'manual' && b.source !== 'chat')) return 'Only events you added can be deleted here.';
      s.checkpoint(); ctx.changed = true; s.remove('blocks', [b.id]); return 'Deleted.';
    }
    case 'add_task': {
      s.checkpoint(); ctx.changed = true;
      const t: Task = { id: uid('task'), title: input.title, due: input.due_date ? ts(input.due_date, input.due_time ?? (input.type === 'school' ? '08:00' : '23:59')) : undefined, tag: input.tag, type: input.type ?? 'personal', done: false, source: 'chat', createdAt: now };
      s.upsert('tasks', [t]); return `Added task ${t.id}.`;
    }
    case 'complete_task': {
      const t = st.tasks.find(x => x.id === input.id); if (!t) return 'No such task.';
      s.checkpoint(); ctx.changed = true; s.upsert('tasks', [{ ...t, done: true, doneAt: now }]); return 'Done.';
    }
    case 'set_bedtime': {
      ctx.changed = true;
      const sleep = { ...st.settings.sleep, overrides: { ...st.settings.sleep.overrides, [input.night_of]: input.bedtime } };
      s.set('settings', { ...st.settings, sleep });
      const n = nightFor(fromIsoDay(input.night_of), sleep, st.settings.schoolDays, st.blocks);
      return `Bedtime ${fmtTime(n.bedtime)}, wake ${fmtTime(n.wake)} → ${sleepHours(n.bedtime, n.wake).toFixed(1)}h of sleep.`;
    }
    case 'save_person': {
      ctx.changed = true;
      const existing = st.people.find(p => p.name.toLowerCase() === String(input.name).toLowerCase());
      const p: Person = { id: existing?.id ?? uid('person'), source: existing?.source ?? 'chat', ...existing, name: input.name,
        relationship: input.relationship ?? existing?.relationship,
        birthday: input.birthday_month ? { month: input.birthday_month, day: input.birthday_day } : existing?.birthday,
        notes: input.note ? [...(existing?.notes ?? []), input.note] : existing?.notes };
      s.upsert('people', [p]); return `Saved ${p.name}.`;
    }
    case 'remember': { s.remember(input.fact); return 'Remembered.'; }
    case 'propose_events': {
      const blocks: Block[] = (input.events ?? []).map((e: any) => {
        const allDay = !e.start;
        const start = allDay ? fromIsoDay(e.date) : ts(e.date, e.start);
        const end = allDay ? addDays(fromIsoDay(e.end_date ?? e.date), 1) : ts(e.date, e.end ?? e.start) + (e.end ? 0 : 60 * MIN);
        return { id: `web_${hashId(`${e.title}${e.date}`)}`, title: e.title, kind: e.kind, start, end, allDay: allDay || undefined, fixed: true, source: 'school-calendar', notes: input.source_url } as Block;
      });
      ctx.pending = { id: uid('imp'), title: input.summary, source: 'school-calendar', connection: 'school-calendar', blocks, status: 'pending' };
      if (input.source_url) ctx.sources.add(host(input.source_url));
      return `Shown ${blocks.length} items to the user for approval. Not saved yet — tell them to review and tap Add.`;
    }
    case 'propose_lunch_menu': {
      const lunch: Record<string, string[]> = {};
      for (const d of input.days ?? []) lunch[d.date] = d.items;
      ctx.pending = { id: uid('imp'), title: `Lunch menu for ${Object.keys(lunch).length} days`, source: 'web', lunch, status: 'pending' };
      if (input.source_url) ctx.sources.add(host(input.source_url));
      return 'Shown to the user for approval.';
    }
    case 'propose_people': {
      const people: Person[] = (input.people ?? []).map((p: any) => ({ id: `web_${hashId(p.name)}`, name: p.name, birthday: p.birthday_month ? { month: p.birthday_month, day: p.birthday_day } : undefined, source: 'web', link: input.source_url }));
      ctx.pending = { id: uid('imp'), title: `${people.length} from ${input.source_url ? host(input.source_url) : 'the web'}`, source: 'web', people, status: 'pending' };
      if (input.source_url) ctx.sources.add(host(input.source_url));
      return 'Shown to the user for approval.';
    }
  }
  return `Unknown tool ${name}`;
}

export const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
export function labelFor(src: Block['source']): string {
  return ({ 'google-calendar': 'Google Calendar', classroom: 'Classroom', schoology: 'Schoology', 'google-tasks': 'Google Tasks', 'school-calendar': 'School calendar', contacts: 'Contacts', web: 'Web', manual: 'Schedule', chat: 'Schedule' } as Record<string, string>)[src] ?? src;
}
