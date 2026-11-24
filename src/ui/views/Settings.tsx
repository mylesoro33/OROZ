import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Plus, Search, Upload, Trash2, Download, UserPlus, Link as LinkIcon, Cake } from 'lucide-react';
import type { Person } from '@engine/types';
import { parseHM, hm, uid, fmtDay } from '@engine/time';
import { upcomingBirthdays, frequentPeople } from '@engine/occasions';
import { icsToBlocks, icsToAssignments } from '@engine/ics';
import { useApp, store, type ConnectionId, type PendingImport } from '../../data/store';
import { CONNECTIONS, pullConnection, disconnect, type ConnectionInfo } from '../../integrations/connect';
import { googleClientId } from '../../integrations/google';
import { askOroz, useNav, go } from '../nav';
import { Btn, Card, Chip, Heading, Sheet, Field, inputCls, CONN_ICON, Empty, cx } from '../ui';
import { ImportReview } from '../components/ImportReview';
import { SleepDial } from '../components/SleepDial';
import { toast } from '../toast';

export function Settings() {
  const nav = useNav();
  const people = useRef<HTMLDivElement>(null); const sleep = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = nav.settingsFocus === 'people' ? people.current : nav.settingsFocus === 'sleep' ? sleep.current : null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (nav.settingsFocus) go({ settingsFocus: undefined });
  }, [nav.settingsFocus]);
  return <div className="h-full overflow-y-auto px-5 pb-28">
    <h1 className="mb-4 text-2xl font-semibold">Settings</h1>
    <Connections />
    <Heading>About me</Heading>
    <ProfileCard />
    <div ref={sleep}><SleepCard /></div>
    <MealsCard />
    <div ref={people}><PeopleCard /></div>
    <MemoryCard />
    <Heading>Preferences</Heading>
    <Preferences />
  </div>;
}

// ---------------------------------------------------------------------------
function Connections() {
  const conns = useApp(s => s.connections);
  const [open, setOpen] = useState<ConnectionInfo | null>(null);
  return <>
    <Heading>Connections</Heading>
    <Card className="divide-y divide-line p-0">
      {CONNECTIONS.map(c => { const I = CONN_ICON[c.id]; const on = conns[c.id]?.connected; return <button key={c.id} onClick={() => setOpen(c)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className={cx('flex h-9 w-9 items-center justify-center rounded-lg border', on ? 'border-green/40 bg-green-soft text-green' : 'border-line text-muted')}><I size={18} strokeWidth={1.6} /></span>
        <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{c.name}</span><span className="block truncate text-xs text-muted">{c.what}</span></span>
        <span className={cx('text-xs', on ? 'text-green' : 'text-muted')}>{on ? 'Connected' : 'Connect'}</span>
        <ChevronRight size={16} className="text-muted" />
      </button>; })}
    </Card>
    <p className="mt-2 text-xs text-muted">Read-only. You review everything before it's saved, and can turn any of these off.</p>
    {open && <ConnectionSheet c={open} onClose={() => setOpen(null)} />}
  </>;
}

export function ConnectionSheet({ c, onClose }: { c: ConnectionInfo; onClose: () => void }) {
  const conn = useApp(s => s.connections[c.id]);
  const clientId = useApp(s => googleClientId(s.settings.googleClientId));
  const hasKey = useApp(s => !!s.settings.apiKey);
  const school = useApp(s => s.profile.school);
  const [url, setUrl] = useState(conn?.url ?? '');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [err, setErr] = useState('');
  const pull = async () => {
    setBusy(true); setErr('');
    try {
      if (c.kind === 'url') store().set('connections', { ...store().state.connections, [c.id]: { ...conn, connected: !!conn?.connected, url } });
      setPending(await pullConnection(c.id, url || undefined));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const fromFile = async (f: File) => {
    const text = await f.text(); const now = Date.now();
    const p: PendingImport = c.id === 'schoology'
      ? { id: uid('imp'), status: 'pending', source: 'schoology', connection: 'schoology', title: `Assignments from ${f.name}`, tasks: icsToAssignments(text, now).map(a => ({ id: `schoology_${a.externalId}`, title: a.title, due: a.due, tag: a.course, type: 'school', done: false, source: 'schoology', createdAt: now })) }
      : { id: uid('imp'), status: 'pending', source: 'school-calendar', connection: 'school-calendar', title: `Dates from ${f.name}`, blocks: icsToBlocks(text, now - 86_400_000, now + 365 * 86_400_000, 'school-calendar') };
    setPending(p);
  };
  const I = CONN_ICON[c.id];
  return <Sheet open onClose={onClose} title={c.name}>
    {pending ? <ImportReview p={pending} onDone={p => { setPending(null); if (p.status === 'added') { toast(`Added from ${c.name}`); onClose(); } }} /> : <>
      <div className="mb-4 flex items-center gap-3 text-sm text-muted"><I size={20} strokeWidth={1.6} className="text-green" />{conn?.connected ? `Connected${conn.at ? ` · last synced ${fmtDay(conn.at, Date.now())}` : ''}` : 'Not connected'}</div>
      {c.kind === 'google' && !clientId && <p className="mb-3 rounded-lg bg-brass-soft px-3 py-2 text-xs">Google needs a one-time client ID. Add it in Preferences (steps in the README).</p>}
      {c.kind === 'url' && <>
        <Field label={c.id === 'schoology' ? 'Schoology calendar feed link (Calendar → Export)' : 'School calendar iCal link'}><input className={inputCls} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://… or webcal://…" /></Field>
        <label className="mb-2 flex cursor-pointer items-center gap-2 text-xs text-muted"><Upload size={14} />Or import a downloaded .ics file<input type="file" accept=".ics,text/calendar" className="hidden" onChange={e => e.target.files?.[0] && fromFile(e.target.files[0])} /></label>
      </>}
      {err && <p className="mb-3 text-sm text-clay">{err}</p>}
      <div className="flex flex-col gap-2">
        <Btn kind="primary" disabled={busy || (c.kind === 'google' && !clientId) || (c.kind === 'url' && !url)} onClick={pull}>{busy ? 'Checking…' : conn?.connected ? 'Sync now' : 'Connect'}</Btn>
        {c.id === 'school-calendar' && <Btn disabled={!hasKey} onClick={() => { onClose(); askOroz(`Search ${school ?? 'my school'}'s website for this year's academic calendar: no-school days, early dismissals, exam weeks and events. Show them to me before adding.`); }}><Search size={15} />{hasKey ? 'Search the school website' : 'Website search needs a Claude key'}</Btn>}
        {conn?.connected && <Btn kind="danger" onClick={() => { disconnect(c.id); toast(`${c.name} turned off`); onClose(); }}>Turn off and remove imported items</Btn>}
      </div>
      {c.id === 'google-tasks' && <p className="mt-3 text-xs text-muted">Apple Reminders can't be read by a web app. It'll come with the iPhone app.</p>}
    </>}
  </Sheet>;
}

// ---------------------------------------------------------------------------
function ProfileCard() {
  const p = useApp(s => s.profile);
  const set = (patch: Partial<typeof p>) => store().set('profile', { ...p, ...patch });
  return <Card className="grid grid-cols-2 gap-x-3">
    <Field label="Name"><input className={inputCls} value={p.name ?? ''} onChange={e => set({ name: e.target.value || undefined })} /></Field>
    <Field label="Grade"><input className={inputCls} value={p.grade ?? ''} onChange={e => set({ grade: e.target.value || undefined })} /></Field>
    <div className="col-span-2"><Field label="School"><input className={inputCls} value={p.school ?? ''} onChange={e => set({ school: e.target.value || undefined })} /></Field></div>
  </Card>;
}

function SleepCard() {
  const settings = useApp(s => s.settings);
  const [which, setWhich] = useState<'schoolNight' | 'weekend'>('schoolNight');
  const cur = settings.sleep[which];
  const set = (patch: Partial<typeof cur>) => { store().set('settings', { ...settings, sleep: { ...settings.sleep, [which]: { ...cur, ...patch } } }); store().set('bedtimeSet', true); };
  return <Card className="mt-3">
    <div className="mb-3 flex items-center justify-between"><h3 className="text-base font-semibold">Sleep</h3>
      <div className="flex gap-1.5"><Chip active={which === 'schoolNight'} onClick={() => setWhich('schoolNight')}>School nights</Chip><Chip active={which === 'weekend'} onClick={() => setWhich('weekend')}>Weekends</Chip></div></div>
    <SleepDial bed={parseHM(cur.bedtime)} wake={parseHM(cur.wake)} range={cur.flexMin} onBed={m => set({ bedtime: hm(m) })} onWake={m => set({ wake: hm(m) })} size={230} />
    <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted">Usual range ±
      {[15, 30, 45, 60].map(f => <Chip key={f} active={cur.flexMin === f} onClick={() => set({ flexMin: f })}>{f}m</Chip>)}</div>
    <p className="mt-3 text-center text-xs text-muted">Change any single night from Schedule. Homework wraps {settings.sleep.windDownMin} min before bed.</p>
  </Card>;
}

function MealsCard() {
  const settings = useApp(s => s.settings);
  const save = (i: number, w: [string, string]) => store().set('settings', { ...settings, meals: settings.meals.map((m, j) => (j === i ? { ...m, window: w } : m)) });
  return <Card className="mt-3">
    <h3 className="mb-2 text-base font-semibold">Meals</h3>
    {settings.meals.map((m, i) => <div key={m.type} className="flex items-center gap-2 py-1 text-sm">
      <span className="w-20 capitalize text-muted">{m.type}</span>
      <input type="time" className="rounded border border-line bg-paper px-1.5 py-0.5" value={m.window[0]} onChange={e => save(i, [e.target.value, m.window[1]])} />
      <span className="text-muted">–</span>
      <input type="time" className="rounded border border-line bg-paper px-1.5 py-0.5" value={m.window[1]} onChange={e => save(i, [m.window[0], e.target.value])} />
    </div>)}
    <p className="mt-1 text-xs text-muted">Meals are kept clear on your Schedule. Long gaps get a snack.</p>
  </Card>;
}

function PeopleCard() {
  const people = useApp(s => s.people);
  const attendees = useApp(s => s.attendees);
  const contacts = CONNECTIONS.find(c => c.id === 'contacts')!;
  const [edit, setEdit] = useState<Person | null>(null);
  const [conn, setConn] = useState<ConnectionInfo | null>(null);
  const [link, setLink] = useState('');
  const suggested = frequentPeople(attendees, people);
  const upcoming = new Map(upcomingBirthdays(people, Date.now(), 365).map(b => [b.person.id, b]));
  const sorted = [...people].sort((a, b) => (upcoming.get(a.id)?.inDays ?? 999) - (upcoming.get(b.id)?.inDays ?? 999) || a.name.localeCompare(b.name));
  return <Card className="mt-3">
    <div className="mb-2 flex items-center justify-between"><h3 className="text-base font-semibold">People</h3><Btn kind="ghost" className="px-2" onClick={() => setEdit({ id: uid('person'), name: '', source: 'manual' })}><Plus size={16} />Add</Btn></div>
    {people.length ? <ul className="divide-y divide-line">{sorted.map(p => { const u = upcoming.get(p.id); return <li key={p.id}><button className="flex w-full items-center gap-3 py-2 text-left" onClick={() => setEdit(p)}>
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-linen text-xs font-semibold">{p.name.slice(0, 1).toUpperCase()}</span>
      <span className="min-w-0 flex-1"><span className="block text-sm">{p.name}</span><span className="block text-xs text-muted">{[p.relationship, p.birthday ? `${p.birthday.month}/${p.birthday.day}` : 'add birthday'].filter(Boolean).join(' · ')}</span></span>
      {u && u.inDays <= 30 && <span className="flex items-center gap-1 text-xs text-clay"><Cake size={13} strokeWidth={1.75} />{u.inDays === 0 ? 'today' : `${u.inDays}d`}</span>}
    </button></li>; })}</ul> : <Empty icon={UserPlus} text="Add the people you want to celebrate." />}
    {suggested.length > 0 && <div className="mt-3 border-t border-line pt-3"><p className="mb-1.5 text-xs text-muted">You share the most events with:</p>
      <div className="flex flex-wrap gap-1.5">{suggested.map(s => <Chip key={s.name} onClick={() => setEdit({ id: uid('person'), name: s.name, source: 'google-calendar' })}><Plus size={12} />{s.name} · {s.count}</Chip>)}</div></div>}
    <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
      <Btn onClick={() => setConn(contacts)}>Import birthdays from Contacts</Btn>
      <div className="flex gap-2"><input className={inputCls} value={link} onChange={e => setLink(e.target.value)} placeholder="Public profile link or handle" />
        <Btn disabled={!link} onClick={() => { askOroz(`Read this public page and find the person's name and birthday. Show me before saving: ${link}`); setLink(''); }}><LinkIcon size={15} /></Btn></div>
      <p className="text-xs text-muted">Only public pages you link, or accounts you connect. Nothing is saved until you approve it.</p>
    </div>
    {edit && <PersonSheet p={edit} onClose={() => setEdit(null)} />}
    {conn && <ConnectionSheet c={conn} onClose={() => setConn(null)} />}
  </Card>;
}

function PersonSheet({ p, onClose }: { p: Person; onClose: () => void }) {
  const [x, setX] = useState(p);
  const date = x.birthday ? `${x.birthday.year ?? 2000}-${String(x.birthday.month).padStart(2, '0')}-${String(x.birthday.day).padStart(2, '0')}` : '';
  const exists = store().state.people.some(q => q.id === p.id);
  return <Sheet open onClose={onClose} title={exists ? x.name : 'Add a person'}>
    <Field label="Name"><input autoFocus={!exists} className={inputCls} value={x.name} onChange={e => setX({ ...x, name: e.target.value })} /></Field>
    <Field label="Relationship"><div className="flex flex-wrap gap-1.5">{['friend', 'family', 'teammate', 'classmate', 'other'].map(r => <Chip key={r} active={x.relationship === r} onClick={() => setX({ ...x, relationship: r })}>{r}</Chip>)}</div></Field>
    <Field label="Birthday"><input type="date" className={inputCls} value={date} onChange={e => { const [y, m, d] = e.target.value.split('-').map(Number); setX({ ...x, birthday: m ? { month: m, day: d, year: y !== 2000 ? y : undefined } : undefined }); }} /></Field>
    <div className="mt-4 flex gap-2">
      <Btn kind="primary" className="flex-1" disabled={!x.name.trim()} onClick={() => { store().upsert('people', [{ ...x, name: x.name.trim() }]); onClose(); }}>Save</Btn>
      {exists && <Btn kind="danger" onClick={() => { store().remove('people', [x.id]); onClose(); }}><Trash2 size={15} /></Btn>}
    </div>
  </Sheet>;
}

function MemoryCard() {
  const memory = useApp(s => s.memory);
  if (!memory.length) return null;
  return <Card className="mt-3">
    <h3 className="mb-2 text-base font-semibold">What OROZ remembers</h3>
    <ul className="divide-y divide-line">{memory.sort((a, b) => b.at - a.at).map(m => <li key={m.id} className="flex items-start gap-2 py-2 text-sm">
      <span className="flex-1">{m.text}</span><button aria-label="Forget" className="text-muted hover:text-clay" onClick={() => store().remove('memory', [m.id])}><Trash2 size={14} /></button>
    </li>)}</ul>
  </Card>;
}

function Preferences() {
  const s = useApp(x => x.settings);
  const set = (p: Partial<typeof s>) => store().set('settings', { ...s, ...p });
  return <Card className="space-y-2">
    <Field label="Theme"><div className="flex gap-1.5">{(['system', 'light', 'dark'] as const).map(t => <Chip key={t} active={s.theme === t} onClick={() => set({ theme: t })}>{t}</Chip>)}</div></Field>
    <Field label="Claude API key (chat + web search)"><input type="password" className={inputCls} value={s.apiKey ?? ''} placeholder="sk-ant-…" onChange={e => set({ apiKey: e.target.value.trim() || undefined })} /></Field>
    <p className="text-xs text-muted">Stored on this device. Chat sends your messages and the details it looks up to answer them. Web search must be enabled for your key in the Claude Console.</p>
    <Field label="Google client ID"><input className={inputCls} value={s.googleClientId ?? ''} placeholder={import.meta.env.VITE_GOOGLE_CLIENT_ID ? 'set in .env' : 'xxxx.apps.googleusercontent.com'} onChange={e => set({ googleClientId: e.target.value.trim() || undefined })} /></Field>
    <div className="flex gap-2 pt-2">
      <Btn onClick={async () => { const blob = new Blob([await store().exportJSON()], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'oroz-data.json'; a.click(); }}><Download size={15} />Export data</Btn>
      <Btn kind="danger" onClick={() => { if (confirm('Delete everything OROZ has saved on this device?')) store().wipe(); }}><Trash2 size={15} />Delete all</Btn>
    </div>
  </Card>;
}
export type { ConnectionId };
