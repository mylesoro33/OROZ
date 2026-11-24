import type { Block } from '@engine/types';
import { icsToBlocks, icsToAssignments } from '@engine/ics';
import { addDays, startOfDay, hashId, DAY } from '@engine/time';
import { store } from '../data/store';
import * as A from '../data/actions';
import { fetchIcsText } from './ics';
import { getToken, fetchCalendarBlocks, fetchContactBirthdays, fetchClassroomAssignments, SCOPES, googleClientId, hasGoogleToken } from './google';

const WINDOW_DAYS = 28;

/** Replace imported blocks from one source (in the sync window) with a fresh copy. */
function replaceImported(prefix: string, fresh: Block[], from: number, to: number) {
  const s = store().state;
  const keep = s.blocks.filter(b => !(b.id.startsWith(prefix) && b.start >= from && b.start < to));
  store().commitBlocks([...keep, ...fresh]);
}

export async function syncIcsFeeds(): Promise<string[]> {
  const st = store().state; const msgs: string[] = [];
  const from = startOfDay(Date.now()) - DAY, to = addDays(from, WINDOW_DAYS);
  for (const feed of st.settings.icsUrls) {
    try {
      const text = await fetchIcsText(feed.url, st.settings.corsProxy);
      msgs.push(...importIcsText(text, feed.kind, feed.label, feed.url));
    } catch (e) { msgs.push(`${feed.label}: ${(e as Error).message}`); }
  }
  void from; void to;
  return msgs;
}

export function importIcsText(text: string, kind: 'calendar' | 'assignments', label: string, key = label): string[] {
  const from = startOfDay(Date.now()) - DAY, to = addDays(from, WINDOW_DAYS);
  const prefix = `ics${hashId(key)}_`;
  if (kind === 'calendar') {
    const blocks = icsToBlocks(text, from, to, 'ics').map(b => ({ ...b, id: prefix + b.id }));
    replaceImported(prefix, blocks, from, to);
    store().setKV('sync', { ...store().state.sync, [key]: Date.now() });
    return [`${label}: ${blocks.length} events imported as fixed blocks`];
  }
  const items = icsToAssignments(text, Date.now());
  for (const a of items) A.createProject({ title: a.title, course: a.course, due: a.due, description: a.description, source: 'school', externalId: `${prefix}${a.externalId}` });
  store().setKV('sync', { ...store().state.sync, [key]: Date.now() });
  return [`${label}: ${items.length} assignments → projects with milestones`];
}

export async function syncGoogle(interactive: boolean, parts: { calendar?: boolean; contacts?: boolean; classroom?: boolean } = { calendar: true }): Promise<string[]> {
  const st = store().state;
  const clientId = googleClientId(st.settings.googleClientId);
  if (!clientId) throw new Error('Add a Google OAuth Client ID in Settings first (see README).');
  if (!interactive && !hasGoogleToken()) return [];
  const scopes = [parts.calendar && SCOPES.calendar, parts.contacts && SCOPES.contacts, parts.classroom && SCOPES.classroomCourses, parts.classroom && SCOPES.classroomWork].filter(Boolean) as string[];
  const tok = await getToken(clientId, scopes);
  const msgs: string[] = [];
  if (parts.calendar) {
    const from = startOfDay(Date.now()) - DAY, to = addDays(from, WINDOW_DAYS);
    const { blocks, birthdays } = await fetchCalendarBlocks(tok, from, to);
    replaceImported('google_', blocks, from, to);
    for (const b of birthdays) { const p = A.findOrCreatePerson(b.name); store().upsert('people', [{ ...p, birthday: p.birthday ?? { month: b.month, day: b.day }, source: p.source === 'manual' && !p.birthday ? 'calendar' : p.source }]); }
    msgs.push(`Google Calendar: ${blocks.length} events, ${birthdays.length} birthdays`);
  }
  if (parts.contacts) {
    const people = await fetchContactBirthdays(tok);
    for (const c of people) { const p = A.findOrCreatePerson(c.name!); store().upsert('people', [{ ...p, birthday: p.birthday ?? c.birthday, anniversary: p.anniversary ?? c.anniversary, source: 'google-contacts' }]); }
    msgs.push(`Google Contacts: ${people.length} birthdays/anniversaries`);
  }
  if (parts.classroom) {
    const work = await fetchClassroomAssignments(tok);
    for (const w of work) A.createProject({ title: w.title, course: w.course, due: w.due, description: w.description, source: 'school', externalId: w.externalId });
    msgs.push(`Google Classroom: ${work.length} upcoming assignments`);
  }
  store().setKV('sync', { ...store().state.sync, google: Date.now() });
  A.syncOccasions();
  return msgs;
}

export async function syncAll(interactive = false): Promise<string[]> {
  const msgs = await syncIcsFeeds();
  if (store().state.settings.flags.googleSync) {
    try { msgs.push(...await syncGoogle(interactive, { calendar: true })); } catch (e) { msgs.push(`Google: ${(e as Error).message}`); }
  }
  A.syncReminders();
  return msgs;
}
