import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Link2, Cake, Search, Pencil } from 'lucide-react';
import type { Person, Place, PlaceKind, Occupation, Profile as P } from '@engine/types';
import { upcomingBirthdays, frequentPeople } from '@engine/occasions';
import { parseHM, hm, uid } from '@engine/time';
import { useApp, store, type Draft } from '../../data/store';
import { useNav, go } from '../nav';
import { Btn, Card, Chip, Heading, Sheet, Field, inputCls, cx } from '../ui';
import { SleepDial } from '../components/SleepDial';
import { DraftReview } from '../components/DraftReview';
import { toast } from '../toast';

export const AGES = ['Under 18', '18–24', '25–34', '35–49', '50–64', '65+'];
export const OCCUPATIONS: { key: Occupation; label: string }[] = [
  { key: 'student', label: 'Student' }, { key: 'working', label: 'Working' }, { key: 'both', label: 'Both' },
  { key: 'home', label: 'Stay-at-home' }, { key: 'retired', label: 'Retired' }, { key: 'other', label: 'Other' },
];
export const PLACE_KINDS: { key: PlaceKind; label: string }[] = [
  { key: 'home', label: 'Home' }, { key: 'work', label: 'Work' }, { key: 'school', label: 'School' }, { key: 'gym', label: 'Gym' }, { key: 'church', label: 'Church' },
  { key: 'coffee', label: 'Coffee shop' }, { key: 'friend', label: "Friend's place" }, { key: 'relative', label: "Relative's house" }, { key: 'store', label: 'Store' }, { key: 'other', label: 'Other' },
];

export function Profile() {
  const nav = useNav();
  const refs = { about: useRef<HTMLDivElement>(null), places: useRef<HTMLDivElement>(null), sleep: useRef<HTMLDivElement>(null), people: useRef<HTMLDivElement>(null) };
  useEffect(() => { if (nav.profileFocus) { refs[nav.profileFocus].current?.scrollIntoView({ behavior: 'smooth' }); go({ profileFocus: undefined }); } }, [nav.profileFocus]);
  return <div className="h-full overflow-y-auto px-5 pb-28">
    <h1 className="mb-2 pr-10 text-2xl font-semibold">Profile</h1>
    <div ref={refs.about}><About /></div>
    <div ref={refs.places}><Places /></div>
    <div ref={refs.sleep}><FoodAndSleep /></div>
    <div ref={refs.people}><People /></div>
    <TellAbout />
  </div>;
}

function About() {
  const p = useApp(s => s.profile);
  const hasKey = useApp(s => !!s.settings.apiKey);
  const found = useApp(s => s.foundDates);
  const set = (patch: Partial<P>) => store().set('profile', { ...p, ...patch });
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState('');
  const look = async () => {
    setBusy('Looking up dates…'); setMsg('');
    try { const { findDates } = await import('../../ai/claude'); const r = await findDates(setBusy); setMsg(r.text); if (r.draft) setDraft(r.draft); }
    catch (e) { setMsg(String((e as Error).message).slice(0, 140)); } finally { setBusy(null); }
  };
  return <>
    <Heading>About me</Heading>
    <Card className="space-y-1">
      <Field label="Name"><input className={inputCls} value={p.name ?? ''} onChange={e => set({ name: e.target.value || undefined })} /></Field>
      <Field label="Age"><div className="flex flex-wrap gap-1.5">{AGES.map(a => <Chip key={a} active={p.ageRange === a} onClick={() => set({ ageRange: a })}>{a}</Chip>)}</div></Field>
      <Field label="What I do"><div className="flex flex-wrap gap-1.5">{OCCUPATIONS.map(o => <Chip key={o.key} active={p.occupation === o.key} onClick={() => set({ occupation: o.key })}>{o.label}</Chip>)}</div></Field>
      {p.occupation && !['home', 'retired'].includes(p.occupation) && <Field label={p.occupation === 'student' ? 'Grade or level' : 'Kind of work and usual hours'}><input className={inputCls} value={p.occupationDetail ?? ''} onChange={e => set({ occupationDetail: e.target.value || undefined })} placeholder={p.occupation === 'student' ? '11th grade' : 'Nurse, 7–3 weekdays'} /></Field>}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Hometown"><input className={inputCls} value={p.hometown ?? ''} onChange={e => set({ hometown: e.target.value || undefined })} /></Field>
        <Field label="Live now"><input className={inputCls} value={p.city ?? ''} onChange={e => set({ city: e.target.value || undefined })} placeholder="City, State" /></Field>
      </div>
    </Card>
    <Card className="mt-3">
      <div className="flex items-center gap-3"><div className="flex-1"><p className="text-sm font-medium">Important dates</p><p className="text-xs text-muted">Deadlines and renewals that fit your situation, with sources.{found ? ' Look again any time.' : ''}</p></div>
        <Btn disabled={!hasKey || !!busy} onClick={look}><Search size={15} />{busy ? '…' : 'Look up'}</Btn></div>
      {!hasKey && <p className="mt-2 text-xs text-muted">Needs a Claude key in Settings.</p>}
      {busy && <p className="mt-2 text-xs text-muted">{busy}</p>}
      {msg && !draft && <p className="mt-2 text-sm">{msg}</p>}
      {draft && <div className="mt-3"><p className="mb-2 text-sm">{msg}</p><DraftReview compact draft={draft} onDone={added => { setDraft(null); setMsg(''); if (added) toast('Added to your calendar'); }} /></div>}
    </Card>
  </>;
}

function Places() {
  const places = useApp(s => s.places);
  const [edit, setEdit] = useState<Place | null>(null);
  return <>
    <Heading right={<Btn kind="ghost" className="px-2" onClick={() => setEdit({ id: uid('place'), name: '', kind: 'other' })}><Plus size={16} />Add</Btn>}>My places</Heading>
    {places.length ? <Card className="divide-y divide-line p-0">{places.map(p => <button key={p.id} onClick={() => setEdit(p)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left">
      <span className="flex-1 text-sm">{p.name}</span><span className="text-xs text-muted">{PLACE_KINDS.find(k => k.key === p.kind)?.label}</span>
    </button>)}</Card> : <p className="text-sm text-muted">Add home, work, the gym. OROZ uses them to plan errands.</p>}
    {edit && <PlaceSheet p={edit} onClose={() => setEdit(null)} />}
  </>;
}

export function PlaceSheet({ p, onClose }: { p: Place; onClose: () => void }) {
  const [x, setX] = useState(p);
  const exists = store().state.places.some(q => q.id === p.id);
  return <Sheet open onClose={onClose} title={exists ? x.name : 'Add a place'}>
    <Field label="Name"><input autoFocus={!exists} className={inputCls} value={x.name} onChange={e => setX({ ...x, name: e.target.value })} placeholder="Planet Fitness, Grandma's" /></Field>
    <Field label="Kind"><div className="flex flex-wrap gap-1.5">{PLACE_KINDS.map(k => <Chip key={k.key} active={x.kind === k.key} onClick={() => setX({ ...x, kind: k.key, name: x.name || k.label })}>{k.label}</Chip>)}</div></Field>
    <Field label="Address or area (optional)"><input className={inputCls} value={x.address ?? ''} onChange={e => setX({ ...x, address: e.target.value || undefined })} /></Field>
    <div className="mt-4 flex gap-2"><Btn kind="primary" className="flex-1" disabled={!x.name.trim()} onClick={() => { store().upsert('places', [{ ...x, name: x.name.trim() }]); onClose(); }}>Save</Btn>
      {exists && <Btn kind="danger" aria-label="Delete" onClick={() => { store().remove('places', [x.id]); onClose(); }}><Trash2 size={15} /></Btn>}</div>
  </Sheet>;
}

function FoodAndSleep() {
  const s = useApp(x => x.settings);
  const occ = useApp(x => x.profile.occupation);
  const [which, setWhich] = useState<'weeknight' | 'weekend'>('weeknight');
  const cur = s.sleep[which];
  const setSleep = (patch: Partial<typeof cur>) => store().set('settings', { ...s, sleep: { ...s.sleep, [which]: { ...cur, ...patch } } });
  const night = occ === 'student' ? 'School nights' : occ === 'working' || occ === 'both' ? 'Work nights' : 'Weeknights';
  const setMeal = (i: number, k: 'from' | 'to', v: string) => store().set('settings', { ...s, meals: s.meals.map((m, j) => (j === i ? { ...m, [k]: v } : m)) });
  return <>
    <Heading>Food and bedtime</Heading>
    <Card>
      <div className="mb-3 flex justify-center gap-1.5"><Chip active={which === 'weeknight'} onClick={() => setWhich('weeknight')}>{night}</Chip><Chip active={which === 'weekend'} onClick={() => setWhich('weekend')}>Weekends</Chip></div>
      <SleepDial bed={parseHM(cur.bedtime)} wake={parseHM(cur.wake)} onBed={m => setSleep({ bedtime: hm(m) })} onWake={m => setSleep({ wake: hm(m) })} size={230} />
      <p className="mt-2 text-center text-xs text-muted">Change one night from the Schedule.</p>
      <div className="mt-4 border-t border-line pt-3">
        {s.meals.map((m, i) => <div key={m.type} className="flex items-center gap-2 py-1 text-sm">
          <span className="w-20 capitalize text-muted">{m.type}</span>
          <input type="time" aria-label={`${m.type} from`} className="rounded border border-line bg-paper px-1.5 py-0.5" value={m.from} onChange={e => setMeal(i, 'from', e.target.value)} />
          <span className="text-muted">–</span>
          <input type="time" aria-label={`${m.type} to`} className="rounded border border-line bg-paper px-1.5 py-0.5" value={m.to} onChange={e => setMeal(i, 'to', e.target.value)} />
        </div>)}
        <p className="mt-1 text-xs text-muted">Shown as soft bands on your Schedule. Drag them there too.</p>
      </div>
    </Card>
  </>;
}

function People() {
  const people = useApp(s => s.people);
  const attendees = useApp(s => s.attendees);
  const hasKey = useApp(s => !!s.settings.apiKey);
  const [edit, setEdit] = useState<Person | null>(null);
  const [link, setLink] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const up = new Map(upcomingBirthdays(people, Date.now(), 366).map(b => [b.person.id, b]));
  const sorted = [...people].sort((a, b) => Number(!!b.close) - Number(!!a.close) || (up.get(a.id)?.inDays ?? 999) - (up.get(b.id)?.inDays ?? 999));
  const suggested = frequentPeople(attendees, people);
  const readLink = async () => {
    setBusy('Reading…');
    try { const { readProfile } = await import('../../ai/claude'); const r = await readProfile(link, setBusy); if (r.draft) setDraft(r.draft); else toast(r.text); setLink(''); }
    catch (e) { toast(String((e as Error).message).slice(0, 100)); } finally { setBusy(null); }
  };
  return <>
    <Heading right={<Btn kind="ghost" className="px-2" onClick={() => setEdit({ id: uid('person'), name: '', source: 'manual' })}><Plus size={16} />Add</Btn>}>People</Heading>
    <Card>
      {people.length ? <ul className="divide-y divide-line">{sorted.map(p => { const u = up.get(p.id); return <li key={p.id}><button onClick={() => setEdit(p)} className="flex w-full items-center gap-3 py-2 text-left">
        <span className={cx('flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold', p.close ? 'bg-green text-paper' : 'bg-linen')}>{p.name.slice(0, 1).toUpperCase()}</span>
        <span className="min-w-0 flex-1"><span className="block text-sm">{p.name}</span><span className="block text-xs text-muted">{[p.relationship, p.birthday ? `${p.birthday.month}/${p.birthday.day}` : 'add birthday'].filter(Boolean).join(' · ')}</span></span>
        {u && u.inDays <= 30 && <span className="flex items-center gap-1 text-xs text-clay"><Cake size={13} strokeWidth={1.6} />{u.inDays === 0 ? 'today' : `${u.inDays}d`}</span>}
      </button></li>; })}</ul> : <p className="text-sm text-muted">Add the people you care about.</p>}
      {suggested.length > 0 && <div className="mt-3 border-t border-line pt-3"><p className="mb-1.5 text-xs text-muted">From your calendar, you see these people most:</p>
        <div className="flex flex-wrap gap-1.5">{suggested.map(s => <Chip key={s.name} onClick={() => setEdit({ id: uid('person'), name: s.name, source: 'google-calendar', close: true })}><Plus size={12} />{s.name}</Chip>)}</div></div>}
      <div className="mt-3 border-t border-line pt-3">
        <div className="flex gap-2"><input className={inputCls} value={link} onChange={e => setLink(e.target.value)} placeholder="Public profile link" />
          <Btn aria-label="Read link" disabled={!link || !hasKey || !!busy} onClick={readLink}><Link2 size={15} /></Btn></div>
        <p className="mt-1.5 text-xs text-muted">{busy ?? 'Only public pages you share. Birthdays also come from Contacts or Google Calendar (Settings).'}</p>
        {draft && <div className="mt-2"><DraftReview compact draft={draft} onDone={() => setDraft(null)} /></div>}
      </div>
    </Card>
    {edit && <PersonSheet p={edit} onClose={() => setEdit(null)} />}
  </>;
}

export function PersonSheet({ p, onClose }: { p: Person; onClose: () => void }) {
  const [x, setX] = useState(p);
  const exists = store().state.people.some(q => q.id === p.id);
  const date = x.birthday ? `${x.birthday.year ?? 2000}-${String(x.birthday.month).padStart(2, '0')}-${String(x.birthday.day).padStart(2, '0')}` : '';
  return <Sheet open onClose={onClose} title={exists ? x.name : 'Add a person'}>
    <Field label="Name"><input autoFocus={!exists} className={inputCls} value={x.name} onChange={e => setX({ ...x, name: e.target.value })} /></Field>
    <Field label="How you know them"><div className="flex flex-wrap gap-1.5">{['family', 'friend', 'partner', 'coworker', 'classmate', 'teammate', 'neighbor'].map(r => <Chip key={r} active={x.relationship === r} onClick={() => setX({ ...x, relationship: r })}>{r}</Chip>)}</div></Field>
    <Field label="Birthday"><input type="date" className={inputCls} value={date} onChange={e => { const [y, m, d] = e.target.value.split('-').map(Number); setX({ ...x, birthday: m ? { month: m, day: d, year: y !== 2000 ? y : undefined } : undefined }); }} /></Field>
    <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!x.close} onChange={e => setX({ ...x, close: e.target.checked })} />Close to me (plan celebrations)</label>
    <div className="mt-4 flex gap-2"><Btn kind="primary" className="flex-1" disabled={!x.name.trim()} onClick={() => { store().upsert('people', [{ ...x, name: x.name.trim() }]); onClose(); }}>Save</Btn>
      {exists && <Btn kind="danger" aria-label="Delete" onClick={() => { store().remove('people', [x.id]); onClose(); }}><Trash2 size={15} /></Btn>}</div>
  </Sheet>;
}

const PROMPTS = ['My mornings usually…', 'On weekends I like to…', 'This month I want to…', 'Never schedule anything during…', 'I get the most done…', 'Something that matters to me…'];

function TellAbout() {
  const memory = useApp(s => s.memory);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const save = () => { const t = text.trim(); if (!t) return; store().remember(t); setText(''); toast('OROZ will keep that in mind'); };
  return <>
    <Heading>Tell <span className="wordmark text-base">OROZ</span> about yourself</Heading>
    <Card>
      <p className="mb-2 text-sm text-muted">Routines, goals, habits, what matters. OROZ uses this to plan.</p>
      <div className="mb-2 flex flex-wrap gap-1.5">{PROMPTS.map(p => <Chip key={p} onClick={() => setText(p.replace('…', ' '))}>{p}</Chip>)}</div>
      <textarea className={cx(inputCls, 'h-20 resize-none')} value={text} onChange={e => setText(e.target.value)} placeholder="I go to the gym before work on weekdays." />
      <Btn kind="primary" className="mt-2 w-full" disabled={!text.trim()} onClick={save}>Save</Btn>
      {memory.length > 0 && <ul className="mt-4 divide-y divide-line border-t border-line">{[...memory].sort((a, b) => b.at - a.at).map(m => <li key={m.id} className="flex items-start gap-2 py-2 text-sm">
        {editing === m.id ? <input autoFocus className={inputCls} defaultValue={m.text} onBlur={e => { store().upsert('memory', [{ ...m, text: e.target.value }]); setEditing(null); }} />
          : <span className="flex-1">{m.text}</span>}
        <button aria-label="Edit" className="p-0.5 text-muted" onClick={() => setEditing(m.id)}><Pencil size={14} /></button>
        <button aria-label="Forget" className="p-0.5 text-muted hover:text-clay" onClick={() => store().remove('memory', [m.id])}><Trash2 size={14} /></button>
      </li>)}</ul>}
    </Card>
  </>;
}
