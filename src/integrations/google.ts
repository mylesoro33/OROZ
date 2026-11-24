// Google read-only access via Google Identity Services (browser token flow, no backend).
// Each scope is requested only when you tap Connect for that service.
import type { Block, Person, Task } from '@engine/types';
import { hashId } from '@engine/time';

export const SCOPES = {
  calendar: 'https://www.googleapis.com/auth/calendar.readonly',
  contacts: 'https://www.googleapis.com/auth/contacts.readonly',
  classroom: 'https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  tasks: 'https://www.googleapis.com/auth/tasks.readonly',
};

let token: { value: string; exp: number; scopes: string } | null = null;

function loadGis(): Promise<void> {
  if ((window as any).google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => res(); s.onerror = () => rej(new Error("Couldn't reach Google. Are you offline?"));
    document.head.appendChild(s);
  });
}

export const googleClientId = (fromSettings?: string) => fromSettings || (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || undefined;

export async function getToken(clientId: string, scope: string): Promise<string> {
  if (token && token.exp > Date.now() + 60_000 && scope.split(' ').every(s => token!.scopes.includes(s))) return token.value;
  await loadGis();
  const want = [...new Set([...(token?.scopes.split(' ') ?? []), ...scope.split(' ')])].join(' ');
  return new Promise((resolve, reject) => {
    (window as any).google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: want, prompt: '',
      callback: (r: any) => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        token = { value: r.access_token, exp: Date.now() + (r.expires_in ?? 3600) * 1000, scopes: r.scope ?? want };
        resolve(r.access_token);
      },
      error_callback: (e: any) => reject(new Error(e?.message ?? 'Google sign-in was cancelled')),
    }).requestAccessToken();
  });
}

async function g<T>(url: string, tok: string): Promise<T> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok) throw new Error(`Google said ${r.status}. ${(await r.text()).slice(0, 120)}`);
  return r.json();
}

export interface CalendarPull { blocks: Block[]; birthdays: Person[]; attendees: Record<string, number> }

export async function pullCalendar(tok: string, from: number, to: number): Promise<CalendarPull> {
  const blocks: Block[] = [], birthdays: Person[] = []; const attendees: Record<string, number> = {};
  let page = '';
  do {
    const u = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    u.search = new URLSearchParams({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250', ...(page ? { pageToken: page } : {}) }).toString();
    const data = await g<{ items: any[]; nextPageToken?: string }>(u.toString(), tok);
    for (const e of data.items ?? []) {
      if (e.status === 'cancelled') continue;
      if (e.eventType === 'birthday' && e.start?.date) {
        const [, m, d] = e.start.date.split('-').map(Number);
        const name = (e.summary ?? '').replace(/'s birthday$/i, '').trim();
        if (name && !birthdays.some(b => b.name === name)) birthdays.push({ id: `gcal_bd_${hashId(name)}`, name, birthday: { month: m, day: d }, source: 'google-calendar' });
        continue;
      }
      for (const a of e.attendees ?? []) if (!a.self && (a.displayName || a.email)) { const n = a.displayName ?? a.email.split('@')[0]; attendees[n] = (attendees[n] ?? 0) + 1; }
      const allDay = !e.start?.dateTime;
      const start = allDay ? new Date(e.start.date + 'T00:00').getTime() : Date.parse(e.start.dateTime);
      const end = allDay ? new Date(e.end.date + 'T00:00').getTime() : Date.parse(e.end.dateTime);
      blocks.push({ id: `gcal_${hashId(e.id)}`, externalId: e.id, title: e.summary ?? 'Busy', kind: /class|period/i.test(e.summary ?? '') ? 'class' : 'event', start, end, fixed: true, source: 'google-calendar', location: e.location, allDay: allDay || undefined });
    }
    page = data.nextPageToken ?? '';
  } while (page);
  return { blocks, birthdays, attendees };
}

export async function pullContacts(tok: string): Promise<Person[]> {
  const out: Person[] = []; let page = '';
  do {
    const u = `https://people.googleapis.com/v1/people/me/connections?personFields=names,birthdays&pageSize=500${page ? `&pageToken=${page}` : ''}`;
    const data = await g<{ connections?: any[]; nextPageToken?: string }>(u, tok);
    for (const c of data.connections ?? []) {
      const name = c.names?.[0]?.displayName; const b = c.birthdays?.find((x: any) => x.date?.month)?.date;
      if (name && b) out.push({ id: `contact_${hashId(c.resourceName ?? name)}`, name, birthday: { month: b.month, day: b.day, year: b.year }, source: 'contacts' });
    }
    page = data.nextPageToken ?? '';
  } while (page);
  return out;
}

export async function pullClassroom(tok: string): Promise<Task[]> {
  const courses = await g<{ courses?: { id: string; name: string }[] }>('https://classroom.googleapis.com/v1/courses?studentId=me&courseStates=ACTIVE&pageSize=50', tok);
  const out: Task[] = [];
  for (const c of courses.courses ?? []) {
    const work = await g<{ courseWork?: any[] }>(`https://classroom.googleapis.com/v1/courses/${c.id}/courseWork?orderBy=dueDate%20desc&pageSize=30`, tok);
    for (const w of work.courseWork ?? []) {
      if (!w.dueDate) continue;
      const { year, month, day } = w.dueDate;
      const due = Date.UTC(year, month - 1, day, w.dueTime?.hours ?? 23, w.dueTime?.minutes ?? 59);
      if (due < Date.now() - 86_400_000) continue;
      out.push({ id: `classroom_${w.id}`, externalId: w.id, title: w.title, due, tag: c.name, type: 'school', done: false, source: 'classroom', createdAt: Date.now() });
    }
  }
  return out;
}

export async function pullGoogleTasks(tok: string): Promise<Task[]> {
  const lists = await g<{ items?: { id: string; title: string }[] }>('https://tasks.googleapis.com/tasks/v1/users/@me/lists', tok);
  const out: Task[] = [];
  for (const l of lists.items ?? []) {
    const data = await g<{ items?: any[] }>(`https://tasks.googleapis.com/tasks/v1/lists/${l.id}/tasks?showCompleted=false&maxResults=100`, tok);
    for (const t of data.items ?? []) if (t.title?.trim()) out.push({ id: `gtasks_${t.id}`, externalId: t.id, title: t.title, due: t.due ? Date.parse(t.due) + 17 * 3_600_000 : undefined, tag: l.title === 'My Tasks' ? undefined : l.title, type: 'personal', done: false, source: 'google-tasks', createdAt: Date.now() });
  }
  return out;
}
