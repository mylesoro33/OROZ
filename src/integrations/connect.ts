// Connections. "Connect" means signing in to Google or pasting one link — nothing else.
// Every pull returns a Draft; nothing is saved until it's approved.
import { icsToBlocks } from '@engine/ics';
import { normalizeLink } from '@engine/week';
import { addDays, startOfDay, DAY } from '@engine/time';
import type { Occupation } from '@engine/types';
import { store, emptyDraft, type ConnectionId, type Draft } from '../data/store';
import { getToken, googleClientId, SCOPES, pullCalendar, pullContacts, pullClassroom, pullGoogleTasks } from './google';
import { fetchIcsText } from './ics';

export type ConnKind = 'google' | 'link' | 'unavailable';
export interface ConnInfo { id: ConnectionId; name: string; kind: ConnKind; help: string; group: 'Calendars' | 'Reminders' | 'School' | 'Work' | 'Contacts' }

export const CONNECTIONS: ConnInfo[] = [
  { id: 'google-calendar', name: 'Google Calendar', kind: 'google', group: 'Calendars', help: 'Sign in with Google. Read-only.' },
  { id: 'apple-calendar', name: 'Apple Calendar', kind: 'link', group: 'Calendars', help: 'iPhone: Calendar → tap (i) next to a calendar → Public Calendar → Share Link. Paste it here.' },
  { id: 'outlook', name: 'Outlook / Microsoft', kind: 'link', group: 'Calendars', help: 'Outlook on the web: Settings → Calendar → Shared calendars → Publish a calendar → copy the ICS link.' },
  { id: 'google-tasks', name: 'Google Tasks', kind: 'google', group: 'Reminders', help: 'Sign in with Google. Read-only.' },
  { id: 'apple-reminders', name: 'Apple Reminders', kind: 'unavailable', group: 'Reminders', help: 'Apple doesn’t let web apps read Reminders. This comes with the iPhone app.' },
  { id: 'classroom', name: 'Google Classroom', kind: 'google', group: 'School', help: 'Sign in with your school Google account.' },
  { id: 'schoology', name: 'Schoology', kind: 'link', group: 'School', help: 'Schoology: Calendar → Export (iCal) → copy the link.' },
  { id: 'canvas', name: 'Canvas', kind: 'link', group: 'School', help: 'Canvas: Calendar → Calendar Feed (bottom right) → copy the link.' },
  { id: 'blackboard', name: 'Blackboard', kind: 'link', group: 'School', help: 'Blackboard: Calendar → settings → Share calendar → copy the link.' },
  { id: 'powerschool', name: 'PowerSchool', kind: 'link', group: 'School', help: 'PowerSchool: My Schedule → iCal / Subscribe → copy the link.' },
  { id: 'teams', name: 'Microsoft Teams', kind: 'link', group: 'Work', help: 'Teams meetings live in your Outlook calendar. Paste your Outlook ICS link (Outlook → Settings → Calendar → Shared calendars → Publish).' },
  { id: 'contacts', name: 'Contacts', kind: 'google', group: 'Contacts', help: 'Birthdays from Google Contacts. Read-only.' },
];

/** Groups that fit what the person does come first; the rest stay one tap away. */
export function relevantGroups(o?: Occupation): ConnInfo['group'][] {
  const g: ConnInfo['group'][] = ['Calendars', 'Reminders'];
  if (o === 'student' || o === 'both') g.push('School');
  if (o === 'working' || o === 'both') g.push('Work');
  g.push('Contacts');
  return g;
}

const SOURCE: Record<ConnectionId, Draft['events'][number]['source']> = {
  'google-calendar': 'google-calendar', 'apple-calendar': 'apple-calendar', outlook: 'outlook', teams: 'outlook', 'google-tasks': 'google-tasks', 'apple-reminders': 'manual',
  classroom: 'classroom', schoology: 'school-feed', canvas: 'school-feed', blackboard: 'school-feed', powerschool: 'school-feed', contacts: 'contacts',
};

function clientId() {
  const id = googleClientId(store().state.settings.googleClientId);
  if (!id) throw new Error('Google sign-in needs a one-time client ID in Settings → Preferences.');
  return id;
}

export async function pullConnection(c: ConnInfo, link?: string): Promise<Draft> {
  const from = startOfDay(Date.now()) - DAY, to = addDays(from, 120);
  switch (c.id) {
    case 'google-calendar': {
      const r = await pullCalendar(await getToken(clientId(), SCOPES.calendar), from, to);
      store().set('attendees', r.attendees);
      return { ...emptyDraft(`${r.blocks.length} events from Google Calendar`), events: r.blocks, people: r.birthdays, connection: c.id };
    }
    case 'google-tasks': { const t = await pullGoogleTasks(await getToken(clientId(), SCOPES.tasks)); return { ...emptyDraft(`${t.length} reminders from Google Tasks`), tasks: t, connection: c.id }; }
    case 'classroom': { const t = await pullClassroom(await getToken(clientId(), SCOPES.classroom)); return { ...emptyDraft(`${t.length} due dates from Classroom`), tasks: t, connection: c.id }; }
    case 'contacts': { const p = await pullContacts(await getToken(clientId(), SCOPES.contacts)); return { ...emptyDraft(`${p.length} birthdays from Contacts`), people: p, connection: c.id }; }
    default: {
      if (!link) throw new Error('Paste the link first.');
      const { url } = normalizeLink(link);
      const blocks = icsToBlocks(await fetchIcsText(url), from, to, SOURCE[c.id]).map(b => ({ ...b, id: `${c.id}_${b.id}` }));
      store().set('connections', { ...store().state.connections, [c.id]: { ...store().state.connections[c.id], connected: !!store().state.connections[c.id]?.connected, url: link } });
      return { ...emptyDraft(`${blocks.length} items from ${c.name}`), events: blocks, connection: c.id };
    }
  }
}

/** Turn a connection off and remove what it brought in. */
export function disconnect(c: ConnInfo) {
  const s = store(); const src = SOURCE[c.id];
  s.checkpoint();
  const mine = (id: string, source: string) => id.startsWith(`${c.id}_`) || (c.kind === 'google' && source === src);
  s.remove('blocks', s.state.blocks.filter(b => mine(b.id, b.source)).map(b => b.id));
  s.remove('tasks', s.state.tasks.filter(t => !t.done && mine(t.id, t.source)).map(t => t.id));
  if (c.id === 'contacts' || c.id === 'google-calendar') s.remove('people', s.state.people.filter(p => p.source === src).map(p => p.id));
  const next = { ...s.state.connections }; delete next[c.id];
  s.set('connections', next);
}
