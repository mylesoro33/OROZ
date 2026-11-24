// Google read-only integrations via Google Identity Services (browser OAuth token flow).
// No backend needed. Scopes are requested only when the user taps "Connect".
import type { Block, Person } from '@engine/types';
import { hashId } from '@engine/time';

export const SCOPES = {
  calendar: 'https://www.googleapis.com/auth/calendar.readonly',
  contacts: 'https://www.googleapis.com/auth/contacts.readonly',
  classroomCourses: 'https://www.googleapis.com/auth/classroom.courses.readonly',
  classroomWork: 'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
};

let token: { value: string; exp: number; scopes: string } | null = null;

function loadGis(): Promise<void> {
  if ((window as any).google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => res(); s.onerror = () => rej(new Error('Could not load Google sign-in (offline?)'));
    document.head.appendChild(s);
  });
}

export function googleClientId(settingsId?: string): string | undefined {
  return settingsId || (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || undefined;
}

export async function getToken(clientId: string, scopes: string[]): Promise<string> {
  const want = scopes.join(' ');
  if (token && token.exp > Date.now() + 60_000 && scopes.every(s => token!.scopes.includes(s))) return token.value;
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: want, prompt: '',
      callback: (r: any) => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        token = { value: r.access_token, exp: Date.now() + (r.expires_in ?? 3600) * 1000, scopes: r.scope ?? want };
        resolve(r.access_token);
      },
      error_callback: (e: any) => reject(new Error(e?.message ?? 'Google sign-in was cancelled')),
    });
    client.requestAccessToken();
  });
}
export const hasGoogleToken = () => !!token && token.exp > Date.now();

async function gfetch<T>(url: string, tok: string): Promise<T> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok) throw new Error(`Google API ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

interface GEvent { id: string; summary?: string; start: { dateTime?: string; date?: string }; end: { dateTime?: string; date?: string }; location?: string; eventType?: string; status?: string }

export async function fetchCalendarBlocks(tok: string, from: number, to: number): Promise<{ blocks: Block[]; birthdays: { name: string; month: number; day: number }[] }> {
  const blocks: Block[] = []; const birthdays: { name: string; month: number; day: number }[] = [];
  let pageToken = '';
  do {
    const u = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    u.searchParams.set('timeMin', new Date(from).toISOString()); u.searchParams.set('timeMax', new Date(to).toISOString());
    u.searchParams.set('singleEvents', 'true'); u.searchParams.set('orderBy', 'startTime'); u.searchParams.set('maxResults', '250');
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const data = await gfetch<{ items: GEvent[]; nextPageToken?: string }>(u.toString(), tok);
    for (const e of data.items ?? []) {
      if (e.status === 'cancelled') continue;
      if (e.eventType === 'birthday' && e.start.date) {
        const [, m, d] = e.start.date.split('-').map(Number);
        birthdays.push({ name: (e.summary ?? '').replace(/'s birthday$/i, '').trim(), month: m, day: d });
        continue;
      }
      if (!e.start.dateTime || !e.end.dateTime) continue; // all-day → not a time block
      blocks.push({
        id: `google_${hashId(e.id)}`, externalId: e.id, title: e.summary ?? '(busy)', kind: /class|period|school/i.test(e.summary ?? '') ? 'class' : 'event',
        start: Date.parse(e.start.dateTime), end: Date.parse(e.end.dateTime), flexibility: 'fixed', source: 'google', notes: e.location,
      });
    }
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);
  return { blocks, birthdays };
}

export async function fetchContactBirthdays(tok: string): Promise<Partial<Person>[]> {
  const out: Partial<Person>[] = [];
  let pageToken = '';
  do {
    const u = new URL('https://people.googleapis.com/v1/people/me/connections');
    u.searchParams.set('personFields', 'names,birthdays,events'); u.searchParams.set('pageSize', '500');
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const data = await gfetch<{ connections?: any[]; nextPageToken?: string }>(u.toString(), tok);
    for (const c of data.connections ?? []) {
      const name = c.names?.[0]?.displayName; const b = c.birthdays?.find((x: any) => x.date)?.date;
      const anniv = c.events?.find((e: any) => e.type === 'anniversary')?.date;
      if (!name || (!b && !anniv)) continue;
      out.push({ name, birthday: b ? { month: b.month, day: b.day, year: b.year } : undefined, anniversary: anniv ? { month: anniv.month, day: anniv.day } : undefined, source: 'google-contacts' });
    }
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

export interface ClassroomAssignment { externalId: string; title: string; course: string; due: number; description?: string; link?: string }

export async function fetchClassroomAssignments(tok: string): Promise<ClassroomAssignment[]> {
  const courses = await gfetch<{ courses?: { id: string; name: string }[] }>('https://classroom.googleapis.com/v1/courses?studentId=me&courseStates=ACTIVE&pageSize=50', tok);
  const out: ClassroomAssignment[] = [];
  for (const c of courses.courses ?? []) {
    const work = await gfetch<{ courseWork?: any[] }>(`https://classroom.googleapis.com/v1/courses/${c.id}/courseWork?orderBy=dueDate%20desc&pageSize=30`, tok);
    for (const w of work.courseWork ?? []) {
      if (!w.dueDate) continue;
      const { year, month, day } = w.dueDate; const h = w.dueTime?.hours ?? 23, m = w.dueTime?.minutes ?? 59;
      const due = Date.UTC(year, month - 1, day, h, m);
      if (due < Date.now()) continue;
      out.push({ externalId: `classroom_${w.id}`, title: w.title, course: c.name, due, description: w.description, link: w.alternateLink });
    }
  }
  return out;
}
