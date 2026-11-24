// Each connection produces a PendingImport. Nothing is saved until you tap Add.
import type { Block, Task } from '@engine/types';
import { icsToBlocks, icsToAssignments } from '@engine/ics';
import { addDays, startOfDay, uid, hashId, DAY } from '@engine/time';
import { store, type ConnectionId, type PendingImport } from '../data/store';
import { getToken, googleClientId, SCOPES, pullCalendar, pullContacts, pullClassroom, pullGoogleTasks } from './google';
import { fetchIcsText } from './ics';

export interface ConnectionInfo { id: ConnectionId; name: string; what: string; kind: 'google' | 'url' }
export const CONNECTIONS: ConnectionInfo[] = [
  { id: 'google-calendar', name: 'Google Calendar', what: 'Events and birthdays', kind: 'google' },
  { id: 'classroom', name: 'Google Classroom', what: 'Assignments', kind: 'google' },
  { id: 'schoology', name: 'Schoology', what: 'Assignments, via feed link', kind: 'url' },
  { id: 'google-tasks', name: 'Reminders', what: 'Google Tasks', kind: 'google' },
  { id: 'school-calendar', name: 'School calendar', what: 'Link or website search', kind: 'url' },
  { id: 'contacts', name: 'Contacts', what: 'Birthdays', kind: 'google' },
];

const WINDOW = 60; // days ahead to import

function clientId() {
  const id = googleClientId(store().state.settings.googleClientId);
  if (!id) throw new Error('Add your Google client ID in Settings → Preferences first (see README).');
  return id;
}

export async function pullConnection(id: ConnectionId, url?: string): Promise<PendingImport> {
  const from = startOfDay(Date.now()) - DAY, to = addDays(from, WINDOW);
  const base = { id: uid('imp'), status: 'pending' as const, connection: id };
  switch (id) {
    case 'google-calendar': {
      const r = await pullCalendar(await getToken(clientId(), SCOPES.calendar), from, to);
      store().set('attendees', r.attendees);
      return { ...base, source: 'google-calendar', title: `${r.blocks.length} events${r.birthdays.length ? `, ${r.birthdays.length} birthdays` : ''} from Google Calendar`, blocks: r.blocks, people: r.birthdays };
    }
    case 'classroom': {
      const tasks = await pullClassroom(await getToken(clientId(), SCOPES.classroom));
      return { ...base, source: 'classroom', title: `${tasks.length} assignments from Classroom`, tasks };
    }
    case 'google-tasks': {
      const tasks = await pullGoogleTasks(await getToken(clientId(), SCOPES.tasks));
      return { ...base, source: 'google-tasks', title: `${tasks.length} tasks from Google Tasks`, tasks };
    }
    case 'contacts': {
      const people = await pullContacts(await getToken(clientId(), SCOPES.contacts));
      return { ...base, source: 'contacts', title: `${people.length} birthdays from Contacts`, people };
    }
    case 'schoology': {
      if (!url) throw new Error('Paste your Schoology calendar feed link.');
      const text = await fetchIcsText(url);
      const tasks: Task[] = icsToAssignments(text, Date.now()).map(a => ({ id: `schoology_${hashId(a.externalId)}`, externalId: a.externalId, title: a.title, due: a.due, tag: a.course, type: 'school', done: false, source: 'schoology', createdAt: Date.now() }));
      return { ...base, source: 'schoology', title: `${tasks.length} assignments from Schoology`, tasks };
    }
    case 'school-calendar': {
      if (!url) throw new Error('Paste the iCal link, or ask OROZ to search your school website.');
      const blocks: Block[] = icsToBlocks(await fetchIcsText(url), from, to, 'school-calendar');
      return { ...base, source: 'school-calendar', title: `${blocks.length} dates from your school calendar`, blocks };
    }
  }
}

/** Save the approved items and mark the connection on. */
export function approveImport(p: PendingImport, keep?: Set<string>) {
  const s = store();
  const pick = <T extends { id: string }>(xs?: T[]) => (xs ?? []).filter(x => !keep || keep.has(x.id));
  s.checkpoint();
  s.upsert('blocks', pick(p.blocks));
  // never resurrect tasks you already finished
  const done = new Set(s.state.tasks.filter(t => t.done).map(t => t.id));
  s.upsert('tasks', pick(p.tasks).filter(t => !done.has(t.id)));
  const known = new Set(s.state.people.map(x => x.name.toLowerCase()));
  s.upsert('people', pick(p.people).filter(x => !known.has(x.name.toLowerCase())));
  if (p.lunch) s.set('lunchMenus', { ...s.state.lunchMenus, ...p.lunch });
  if (p.connection) s.set('connections', { ...s.state.connections, [p.connection]: { ...s.state.connections[p.connection], connected: true, at: Date.now() } });
  return { ...p, status: 'added' as const };
}

/** Turn a connection off and remove what it brought in. */
export function disconnect(id: ConnectionId) {
  const s = store();
  s.checkpoint();
  s.remove('blocks', s.state.blocks.filter(b => b.source === id).map(b => b.id));
  s.remove('tasks', s.state.tasks.filter(t => t.source === id && !t.done).map(t => t.id));
  s.remove('people', s.state.people.filter(p => p.source === id).map(p => p.id));
  const c = { ...s.state.connections }; delete c[id];
  s.set('connections', c);
}
