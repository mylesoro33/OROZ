import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, X, ChevronDown, Moon, Gift, MessageCircle, CalendarPlus, Link2, Cake } from 'lucide-react';
import type { Block } from '@engine/types';
import { deriveDay, dayOutlook } from '@engine/day';
import { nudges as getNudges, type Nudge } from '@engine/nudges';
import { upcomingBirthdays } from '@engine/occasions';
import { nightFor, sleepHours } from '@engine/sleep';
import { MIN, addDays, startOfDay, fmtDay, fmtTime, dayName, isoDay, at, parseHM, hm, uid, overlaps } from '@engine/time';
import { useApp, store } from '../../data/store';
import { CONNECTIONS } from '../../integrations/connect';
import { labelFor } from '../../chat/tools';
import { go, askOroz, useNav } from '../nav';
import { Btn, Card, Chip, Sheet, Field, inputCls, CONN_ICON, OUTLOOK_ICON, cx, isOwn, useNow } from '../ui';
import { DayColumn } from '../components/DayColumn';
import { SleepDial } from '../components/SleepDial';
import { toast } from '../toast';

export function Schedule() {
  const st = useApp(s => s);
  const nav = useNav();
  const now = useNow();
  const [mode, setMode] = useState<'day' | 'week'>('day');
  const [day, setDay] = useState(startOfDay(Date.now()));
  const [sel, setSel] = useState<Block | null>(null);
  const [add, setAdd] = useState<Partial<Block> & { repeat?: number[] } | null>(null);
  const [bedFor, setBedFor] = useState<number | null>(null);
  useEffect(() => { if (nav.scheduleDay) { setDay(nav.scheduleDay); setMode('day'); go({ scheduleDay: undefined }); } }, [nav.scheduleDay]);

  const connected = CONNECTIONS.some(c => st.connections[c.id]?.connected);
  const nudge = getNudges({ now, profile: st.profile, blocks: st.blocks, people: st.people, tasks: st.tasks, connected: Object.keys(st.connections).filter(k => st.connections[k as keyof typeof st.connections]?.connected), lunchMenus: st.lunchMenus, schoolDays: st.settings.schoolDays, dismissed: st.dismissed, hasKey: !!st.settings.apiKey, bedtimeSet: st.bedtimeSet })[0];
  const bday = upcomingBirthdays(st.people, now, 14).find(b => !st.dismissed.includes(`bd-${b.person.id}-${new Date(b.date).getFullYear()}`));
  const dismiss = (id: string) => store().set('dismissed', [...st.dismissed, id]);

  const runNudge = (n: Nudge) => {
    const a = n.action;
    if (a.type === 'add-class') setAdd({ kind: 'class', start: at(a.day, '08:00'), end: at(a.day, '08:50'), repeat: [new Date(a.day).getDay()] });
    else if (a.type === 'chat') askOroz(a.prompt);
    else if (a.type === 'people' || a.type === 'person') go({ tab: 'settings', settingsFocus: 'people' });
    else if (a.type === 'bedtime') go({ tab: 'settings', settingsFocus: 'sleep' });
    else if (a.type === 'setup') store().set('profile', { ...st.profile, setupDone: false });
    else go({ tab: 'settings', settingsFocus: 'connections' });
  };

  const step = mode === 'day' ? 1 : 7;
  return <div className="flex h-full flex-col">
    <div className="flex items-center gap-2 px-5 pb-3">
      <button onClick={() => setDay(startOfDay(Date.now()))} className="min-w-0 flex-1 text-left">
        <h1 className="truncate text-2xl font-semibold">{mode === 'day' ? (day === startOfDay(now) ? 'Today' : fmtDay(day, now).replace(/^./, c => c.toUpperCase())) : `${new Date(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(addDays(day, 6)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}</h1>
        {mode === 'day' && <p className="text-xs text-muted">{dayName(day, true)}, {new Date(day).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</p>}
      </button>
      <div className="flex rounded-lg border border-line bg-card p-0.5 text-xs" role="tablist">
        {(['day', 'week'] as const).map(m => <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cx('rounded-md px-3 py-1 capitalize', mode === m ? 'bg-green text-paper' : 'text-muted')}>{m}</button>)}
      </div>
      <button aria-label={mode === "day" ? "Previous day" : "Previous week"} className="p-1 text-muted" onClick={() => setDay(addDays(day, -step))}><ChevronLeft size={20} /></button>
      <button aria-label={mode === "day" ? "Next day" : "Next week"} className="p-1 text-muted" onClick={() => setDay(addDays(day, step))}><ChevronRight size={20} /></button>
    </div>

    <div className="flex-1 overflow-y-auto px-5 pb-28">
      {mode === 'day' && (!connected && !st.dismissed.includes('connect') ? <ConnectCard onDismiss={() => dismiss('connect')} /> : nudge && <Card className="rise mb-3 bg-linen/60">
        <p className="text-sm">{nudge.text}</p>
        <div className="mt-2.5 flex items-center gap-2"><Btn kind="primary" className="px-3 py-1.5 text-xs" onClick={() => runNudge(nudge)}>{nudge.cta}</Btn>
          <Btn kind="ghost" className="px-2 py-1.5 text-xs" onClick={() => dismiss(nudge.id)}>Not now</Btn></div>
      </Card>)}
      {mode === 'day' && bday && <BirthdayRow b={bday} now={now} onPlan={() => setAdd({ title: `Celebrate ${bday.person.name}`, kind: 'event', start: at(bday.date, '18:00'), end: at(bday.date, '19:30') })} onDismiss={() => dismiss(`bd-${bday.person.id}-${new Date(bday.date).getFullYear()}`)} />}

      {mode === 'day' ? <DayView day={day} now={now} onSelect={b => (b.kind === 'sleep' ? setBedFor(startOfDay(b.start - 12 * 3_600_000)) : setSel(b))} onCreate={s => setAdd({ kind: 'event', start: s, end: s + 60 * MIN })} onBedtime={() => setBedFor(day)} />
        : <WeekView start={day} now={now} onPick={d => { setDay(d); setMode('day'); }} />}
    </div>

    <button aria-label="Add to schedule" onClick={() => setAdd({ kind: 'event', start: at(day, Math.min(20 * 60, Math.max(8 * 60, Math.ceil((new Date(now).getHours() * 60 + 30) / 30) * 30))), end: 0 })}
      className="fixed bottom-[84px] right-5 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-green text-paper shadow-md"><Plus size={22} /></button>
    {add && <AddSheet init={add} onClose={() => setAdd(null)} />}
    {sel && <BlockSheet b={sel} onClose={() => setSel(null)} />}
    {bedFor !== null && <BedtimeSheet day={bedFor} onClose={() => setBedFor(null)} />}
  </div>;
}

function ConnectCard({ onDismiss }: { onDismiss: () => void }) {
  return <Card className="mb-3">
    <div className="flex items-start justify-between"><p className="serif text-lg font-semibold">Bring in your schedule</p><button aria-label="Later" className="p-1 text-muted" onClick={onDismiss}><X size={15} /></button></div>
    <p className="mt-0.5 text-sm text-muted">Connect your calendar and classes. You'll see everything before it's added.</p>
    <div className="mt-3 flex items-center gap-3">
      <div className="flex -space-x-1">{CONNECTIONS.slice(0, 4).map(c => { const I = CONN_ICON[c.id]; return <span key={c.id} className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-card text-green"><I size={15} strokeWidth={1.6} /></span>; })}</div>
      <Btn kind="primary" className="ml-auto" onClick={() => go({ tab: 'settings', settingsFocus: 'connections' })}><Link2 size={15} />Connect</Btn>
    </div>
  </Card>;
}

function BirthdayRow({ b, now, onPlan, onDismiss }: { b: ReturnType<typeof upcomingBirthdays>[number]; now: number; onPlan: () => void; onDismiss: () => void }) {
  const [open, setOpen] = useState(false);
  const done = (msg: string) => { toast(msg); onDismiss(); };
  return <div className="mb-3 rounded-xl border border-line bg-card px-4 py-2.5">
    <div className="flex items-center gap-2.5 text-sm">
      <Cake size={16} strokeWidth={1.6} className="shrink-0 text-clay" />
      <span className="flex-1"><b className="serif">{b.person.name}</b>'s birthday · {b.inDays === 0 ? 'today' : fmtDay(b.date, now)}{b.turning ? ` (${b.turning})` : ''}</span>
      <button className="text-xs text-green" onClick={() => setOpen(!open)}>{open ? 'Close' : 'Plan'}</button>
    </div>
    {open && <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
      <Chip onClick={() => askOroz(`Gift ideas for ${b.person.name}${b.person.relationship ? ` (my ${b.person.relationship})` : ''}? Keep it short.`)}><Gift size={13} />Gift idea</Chip>
      <Chip onClick={() => { store().checkpoint(); store().upsert('tasks', [{ id: uid('task'), title: `Wish ${b.person.name} happy birthday`, due: at(b.date, '09:00'), type: 'personal', done: false, source: 'manual', createdAt: now }]); done('Added to To-Do'); }}><MessageCircle size={13} />Reach out</Chip>
      <Chip onClick={onPlan}><CalendarPlus size={13} />Plan something</Chip>
      <Chip onClick={onDismiss}>Not now</Chip>
    </div>}
  </div>;
}

function DayView({ day, now, onSelect, onCreate, onBedtime }: { day: number; now: number; onSelect: (b: Block) => void; onCreate: (s: number) => void; onBedtime: () => void }) {
  const st = useApp(s => s);
  const v = useMemo(() => deriveDay(day, st.blocks, st.settings), [day, st.blocks, st.settings]);
  const lines = dayOutlook(v, st.tasks, st.people, st.lunchMenus, now);
  const allDay = v.blocks.filter(b => b.allDay);
  const [more, setMore] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const px = 1.1;
  useEffect(() => { const t = day === startOfDay(Date.now()) ? Math.max(6 * 60, (Date.now() - day) / MIN - 60) : 7 * 60; scroller.current?.scrollTo({ top: t * px }); }, [day]);
  const shown = more ? lines : lines.slice(0, 3);
  const hasOwnStuff = v.blocks.some(b => !b.derived);
  return <>
    <Card className="mb-3 py-3">
      <ul className="space-y-1.5">{shown.map((l, i) => { const I = OUTLOOK_ICON[l.icon]; return <li key={i} className="flex items-start gap-2.5 text-sm">
        <I size={16} strokeWidth={1.6} className={cx('mt-0.5 shrink-0', l.icon === 'moon' ? 'text-green' : l.icon === 'cake' ? 'text-clay' : 'text-muted')} />
        {l.icon === 'moon' ? <button className="text-left underline decoration-line underline-offset-4" onClick={onBedtime}>{l.text}</button> : <span>{l.text}</span>}
      </li>; })}</ul>
      {lines.length > 3 && <button className="mt-2 flex items-center gap-1 text-xs text-muted" onClick={() => setMore(!more)}>{more ? 'Less' : `${lines.length - 3} more`}<ChevronDown size={13} className={more ? 'rotate-180' : ''} /></button>}
    </Card>
    {allDay.length > 0 && <div className="mb-2 flex flex-wrap gap-1.5">{allDay.map(b => <button key={b.id} onClick={() => onSelect(b)} className={cx('rounded-md px-2 py-1 text-xs', b.kind === 'no-school' ? 'bg-brass-soft text-ink' : 'bg-linen')}>{b.title}</button>)}</div>}
    {!hasOwnStuff && <p className="mb-2 text-xs text-muted">Nothing planned yet. Tap + or hold the timeline to add something.</p>}
    <div ref={scroller} className="max-h-[62vh] overflow-y-auto rounded-xl border border-line bg-card/50 px-1 py-2">
      <DayColumn day={day} blocks={v.blocks} pxPerMin={px} now={now} onSelect={onSelect} onCreate={onCreate}
        onMove={(b, s, e) => { store().checkpoint(); store().upsert('blocks', [{ ...b, start: s, end: e }]); toast(`Moved ${b.title}`, { label: 'Undo', run: () => store().undo() }); }} />
    </div>
  </>;
}

function WeekView({ start, now, onPick }: { start: number; now: number; onPick: (d: number) => void }) {
  const st = useApp(s => s);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const px = 0.42;
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { scroller.current?.scrollTo({ top: 7 * 60 * px }); }, []);
  return <div className="rounded-xl border border-line bg-card/50">
    <div className="grid grid-cols-7 border-b border-line text-center">
      {days.map(d => { const bd = upcomingBirthdays(st.people, d, 0).some(b => b.date === d); return <button key={d} onClick={() => onPick(d)} className={cx('py-2 text-xs', d === startOfDay(now) && 'font-semibold text-green')}>
        {dayName(d)}<br /><span className="serif text-base">{new Date(d).getDate()}</span>{bd && <span className="mx-auto mt-0.5 block h-1 w-1 rounded-full bg-clay" />}
      </button>; })}
    </div>
    <div ref={scroller} className="max-h-[60vh] overflow-y-auto">
      <div className="grid grid-cols-7">{days.map(d => <div key={d} className="border-l border-line/60 first:border-l-0" onClick={() => onPick(d)}>
        <DayColumn compact day={d} blocks={deriveDay(d, st.blocks, st.settings).blocks} pxPerMin={px} now={now} onSelect={() => onPick(d)} />
      </div>)}</div>
    </div>
  </div>;
}

function AddSheet({ init, onClose }: { init: Partial<Block> & { repeat?: number[] }; onClose: () => void }) {
  const [title, setTitle] = useState(init.title ?? '');
  const [kind, setKind] = useState<Block['kind']>(init.kind ?? 'event');
  const [date, setDate] = useState(isoDay(init.start ?? Date.now()));
  const [start, setStart] = useState(hm(new Date(init.start ?? Date.now()).getHours() * 60 + new Date(init.start ?? Date.now()).getMinutes()));
  const [end, setEnd] = useState(init.end ? hm(new Date(init.end).getHours() * 60 + new Date(init.end).getMinutes()) : hm(parseHM(start) + 60));
  const [repeat, setRepeat] = useState<number[]>(init.repeat ?? []);
  const save = () => {
    const base = new Date(date + 'T00:00').getTime();
    const seriesId = repeat.length ? uid('series') : undefined;
    const days = repeat.length ? Array.from({ length: 16 }, (_, w) => repeat.map(wd => addDays(base, w * 7 + ((wd - new Date(base).getDay() + 7) % 7)))).flat() : [base];
    store().checkpoint();
    store().upsert('blocks', [...new Set(days)].map(d => ({ id: uid('blk'), title: title.trim(), kind, start: at(d, start), end: at(d, end), fixed: kind === 'class', source: 'manual', seriesId }) as Block));
    toast(repeat.length ? `Added ${title} weekly` : `Added ${title}`, { label: 'Undo', run: () => store().undo() });
    onClose();
  };
  return <Sheet open onClose={onClose} title={kind === 'class' ? 'Add a class' : 'Add to schedule'}>
    <Field label="Title"><input autoFocus className={inputCls} value={title} onChange={e => setTitle(e.target.value)} placeholder={kind === 'class' ? 'Biology' : 'Study, practice, plans…'} /></Field>
    <div className="flex gap-1.5 py-1">{(['class', 'event', 'study'] as const).map(k => <Chip key={k} active={kind === k} onClick={() => setKind(k)}>{k}</Chip>)}</div>
    <div className="grid grid-cols-3 gap-2">
      <Field label="Day"><input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} /></Field>
      <Field label="Start"><input type="time" className={inputCls} value={start} onChange={e => setStart(e.target.value)} /></Field>
      <Field label="End"><input type="time" className={inputCls} value={end} onChange={e => setEnd(e.target.value)} /></Field>
    </div>
    <Field label="Repeats weekly on"><div className="flex gap-1">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <Chip key={i} active={repeat.includes(i)} onClick={() => setRepeat(repeat.includes(i) ? repeat.filter(x => x !== i) : [...repeat, i])} className="w-8 justify-center">{d}</Chip>)}</div></Field>
    <Btn kind="primary" className="mt-3 w-full" disabled={!title.trim() || parseHM(end) <= parseHM(start)} onClick={save}>Add</Btn>
  </Sheet>;
}

function BlockSheet({ b, onClose }: { b: Block; onClose: () => void }) {
  const own = isOwn(b);
  const series = b.seriesId ? store().state.blocks.filter(x => x.seriesId === b.seriesId) : [];
  const del = (all: boolean) => { store().checkpoint(); store().remove('blocks', all ? series.map(x => x.id) : [b.id]); toast('Removed', { label: 'Undo', run: () => store().undo() }); onClose(); };
  return <Sheet open onClose={onClose} title={b.title}>
    <p className="text-sm text-muted">{b.allDay ? fmtDay(b.start, Date.now()) : `${fmtDay(b.start, Date.now())} · ${fmtTime(b.start)}–${fmtTime(b.end)}`}</p>
    <p className="mt-1 text-xs text-muted">{b.derived ? (b.reason ?? 'Kept clear for you') : `From ${labelFor(b.source)}${b.fixed && !own ? ' · fixed' : ''}`}{b.location ? ` · ${b.location}` : ''}</p>
    {b.notes && <p className="mt-3 text-sm">{b.notes}</p>}
    {own && <div className="mt-5 flex flex-col gap-2">
      <Btn kind="danger" onClick={() => del(false)}>Remove</Btn>
      {series.length > 1 && <Btn kind="danger" onClick={() => del(true)}>Remove every week</Btn>}
    </div>}
    {b.kind === 'meal' && <p className="mt-4 text-xs text-muted">Change meal windows in Settings → About me.</p>}
  </Sheet>;
}

function BedtimeSheet({ day, onClose }: { day: number; onClose: () => void }) {
  const st = useApp(s => s);
  const n = nightFor(day, st.settings.sleep, st.settings.schoolDays, st.blocks.filter(b => overlaps(b, { start: day, end: addDays(day, 2) })));
  const key = isoDay(day);
  const mins = (t: number) => new Date(t).getHours() * 60 + new Date(t).getMinutes();
  const setBed = (m: number) => store().set('settings', { ...st.settings, sleep: { ...st.settings.sleep, overrides: { ...st.settings.sleep.overrides, [key]: hm(m) } } });
  const reset = () => { const o = { ...st.settings.sleep.overrides }; delete o[key]; store().set('settings', { ...st.settings, sleep: { ...st.settings.sleep, overrides: o } }); };
  return <Sheet open onClose={onClose} title={`Bedtime ${fmtDay(day, Date.now())}`}>
    <p className="-mt-2 mb-3 text-sm text-muted">{n.schoolNight ? 'School night' : 'Weekend'} · usually {fmtTime(n.range[0])}–{fmtTime(n.range[1])}</p>
    <SleepDial bed={mins(n.bedtime)} wake={mins(n.wake)} onBed={setBed} range={0} />
    <p className="mt-4 flex items-center justify-center gap-2 text-sm"><Moon size={15} strokeWidth={1.6} className="text-green" />Homework wraps by {fmtTime(n.windDownBy)} · {sleepHours(n.bedtime, n.wake).toFixed(1)}h sleep</p>
    {n.warning && <p className="mt-2 text-center text-xs text-clay">{n.warning}</p>}
    <div className="mt-5 flex gap-2"><Btn kind="primary" className="flex-1" onClick={onClose}>Done</Btn>{n.overridden && <Btn onClick={reset}>Use usual</Btn>}</div>
  </Sheet>;
}
