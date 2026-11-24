import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X, ExternalLink, Cloud, MapPin } from 'lucide-react';
import type { Block } from '@engine/types';
import { itemsFor, bandsFor, daySummary, errandHints, nudges, weatherNote, type Nudge, type Band } from '@engine/week';
import { nightFor } from '@engine/sleep';
import { MIN, addDays, startOfDay, fmtDay, fmtTime, dayName, isoDay, hm, parseHM } from '@engine/time';
import { useApp, store } from '../../data/store';
import { go, openTalk } from '../nav';
import { Btn, Card, Sheet, cx, isOwn, useNow } from '../ui';
import { DayColumn } from '../components/DayColumn';
import { SleepDial } from '../components/SleepDial';
import { toast } from '../toast';

export function Schedule() {
  const st = useApp(s => s);
  const now = useNow();
  const [mode, setMode] = useState<'day' | 'week'>('day');
  const [day, setDay] = useState(startOfDay(Date.now()));
  const [sel, setSel] = useState<Block | null>(null);
  const [bedFor, setBedFor] = useState<number | null>(null);
  const step = mode === 'day' ? 1 : 7;
  const connected = Object.values(st.connections).some(c => c?.connected);
  const nudge = nudges({ now, profile: st.profile, blocks: st.blocks, people: st.people, places: st.places, dismissed: st.dismissed, hasKey: !!st.settings.apiKey, connected, workDays: st.settings.workDays, foundDates: st.foundDates })[0];

  const runNudge = (n: Nudge) => {
    const a = n.action;
    if (a.type === 'connect') go({ settings: true, settingsFocus: 'connections' });
    else if (a.type === 'hours') openTalk('voice');
    else if (a.type === 'dates') go({ tab: 'profile', profileFocus: 'about' });
    else if (a.type === 'places') go({ tab: 'profile', profileFocus: 'places' });
    else if (a.type === 'people') go({ tab: 'profile', profileFocus: 'people' });
    else if (a.type === 'sleep') go({ tab: 'profile', profileFocus: 'sleep' });
    else go({ tab: 'profile', profileFocus: 'about' });
  };

  return <div className="flex h-full flex-col">
    <div className="flex items-center gap-1 pb-3 pl-5 pr-14">
      <button onClick={() => setDay(startOfDay(Date.now()))} className="min-w-0 flex-1 text-left">
        <h1 className="truncate text-2xl font-semibold">{mode === 'day' ? (day === startOfDay(now) ? 'Today' : cap(fmtDay(day, now))) : `${short(day)} – ${short(addDays(day, 6))}`}</h1>
        {mode === 'day' && <p className="text-xs text-muted">{dayName(day, true)}, {new Date(day).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</p>}
      </button>
      <button aria-label={`Previous ${mode}`} className="p-1.5 text-muted" onClick={() => setDay(addDays(day, -step))}><ChevronLeft size={20} /></button>
      <button aria-label={`Next ${mode}`} className="p-1.5 text-muted" onClick={() => setDay(addDays(day, step))}><ChevronRight size={20} /></button>
    </div>
    <div className="mx-5 mb-3 grid grid-cols-2 rounded-lg border border-line bg-card p-0.5 text-sm" role="tablist">
      {(['day', 'week'] as const).map(m => <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cx('rounded-md py-1.5 capitalize transition-colors', mode === m ? 'bg-green text-paper' : 'text-muted')}>{m}</button>)}
    </div>

    <div className="flex-1 overflow-y-auto px-5 pb-40">
      {mode === 'day' ? <>
        <SummaryCard day={day} now={now} />
        {nudge && <div className="rise mb-3 flex items-center gap-3 rounded-xl border border-line bg-linen/50 px-4 py-2.5">
          <p className="flex-1 text-sm">{nudge.text}</p>
          <button className="shrink-0 text-sm font-medium text-green" onClick={() => runNudge(nudge)}>{nudge.cta}</button>
          <button aria-label="Dismiss" className="shrink-0 p-0.5 text-muted" onClick={() => store().dismiss(nudge.id)}><X size={15} /></button>
        </div>}
        <ErrandHints day={day} />
        <DayView day={day} now={now} onSelect={setSel} onBed={() => setBedFor(day)} />
      </> : <WeekView start={day} now={now} onPick={d => { setDay(d); setMode('day'); }} />}
    </div>
    {sel && <ItemSheet b={sel} onClose={() => setSel(null)} />}
    {bedFor !== null && <BedtimeSheet day={bedFor} onClose={() => setBedFor(null)} />}
  </div>;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const short = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function SummaryCard({ day, now }: { day: number; now: number }) {
  const st = useApp(s => s);
  const w = st.weather?.days.find(d => d.date === isoDay(day));
  const s = daySummary(day, st.blocks, st.tasks, st.people, st.settings, now, w ? weatherNote(w, st.weather!.unit) : undefined);
  return <Card className="mb-3 py-3">
    <p className="serif text-[17px]">{s.on}</p>
    <p className="mt-0.5 text-sm text-muted">{s.open}{s.coming ? <> · <span className="text-clay">{s.coming}</span></> : null}</p>
    {s.weather && <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted"><Cloud size={13} strokeWidth={1.6} />{s.weather}</p>}
  </Card>;
}

function ErrandHints({ day }: { day: number }) {
  const st = useApp(s => s);
  const hint = errandHints(day, st.blocks, st.tasks, st.places).find(h => !st.dismissed.includes(`errand-${h.taskId}-${isoDay(day)}`));
  if (!hint) return null;
  const t = st.tasks.find(x => x.id === hint.taskId)!;
  return <div className="mb-3 flex items-center gap-3 rounded-xl border border-line bg-card px-4 py-2.5">
    <MapPin size={16} strokeWidth={1.6} className="shrink-0 text-clay" />
    <p className="flex-1 text-sm">{hint.text}</p>
    <button className="shrink-0 text-sm font-medium text-green" onClick={() => { store().checkpoint(); store().upsert('tasks', [{ ...t, at: hint.start + 5 * MIN, date: startOfDay(hint.start) }]); toast(`Added at ${fmtTime(hint.start + 5 * MIN)}`, { label: 'Undo', run: () => store().undo() }); }}>Add</button>
    <button aria-label="Dismiss" className="p-0.5 text-muted" onClick={() => store().dismiss(`errand-${hint.taskId}-${isoDay(day)}`)}><X size={15} /></button>
  </div>;
}

function DayView({ day, now, onSelect, onBed }: { day: number; now: number; onSelect: (b: Block) => void; onBed: () => void }) {
  const st = useApp(s => s);
  const items = useMemo(() => itemsFor(day, st.blocks, st.tasks), [day, st.blocks, st.tasks]);
  const bands = useMemo(() => bandsFor(day, st.settings), [day, st.settings]);
  const allDay = items.filter(b => b.allDay);
  const scroller = useRef<HTMLDivElement>(null);
  const px = 1.1;
  useEffect(() => { const t = day === startOfDay(Date.now()) ? Math.max(6 * 60, (Date.now() - day) / MIN - 60) : 7 * 60; scroller.current?.scrollTo({ top: t * px }); }, [day]);
  const moveBand = (kind: Band['kind'], start: number) => {
    const s = store().state.settings;
    const meals = s.meals.map(m => { if (m.type !== kind) return m; const len = parseHM(m.to) - parseHM(m.from); const from = new Date(start).getHours() * 60 + new Date(start).getMinutes(); return { ...m, from: hm(from), to: hm(from + len) }; });
    store().set('settings', { ...s, meals });
    toast(`${cap(kind)} usually ${fmtTime(start)} now`);
  };
  return <>
    {allDay.length > 0 && <div className="mb-2 space-y-1.5">{allDay.map(b => <div key={b.id} className={cx('flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm', b.kind === 'date' ? 'border border-dashed border-brass/60 text-ink' : 'bg-linen')}>
      <button className="min-w-0 flex-1 truncate text-left" onClick={() => onSelect(b)}>{b.title}</button>
      {b.sourceUrl && <a href={b.sourceUrl} target="_blank" rel="noreferrer" aria-label="Source" className="text-muted"><ExternalLink size={13} /></a>}
      {b.kind === 'date' && <button aria-label="Dismiss" className="text-muted" onClick={() => { store().checkpoint(); store().remove('blocks', [b.id]); }}><X size={14} /></button>}
    </div>)}</div>}
    <div ref={scroller} className="max-h-[64vh] overflow-y-auto rounded-xl border border-line bg-card/40 px-1 py-2">
      <DayColumn day={day} items={items} bands={bands} pxPerMin={px} now={now} onSelect={onSelect}
        onCreate={() => openTalk('type')}
        onMove={(b, s, e) => { store().checkpoint(); if (b.taskId) { const t = store().state.tasks.find(x => x.id === b.taskId)!; store().upsert('tasks', [{ ...t, at: s, durationMin: Math.round((e - s) / MIN) }]); } else store().upsert('blocks', [{ ...b, start: s, end: e }]); toast(`Moved ${b.title}`, { label: 'Undo', run: () => store().undo() }); }}
        onBandMove={moveBand} onBandTap={k => (k === 'sleep' ? onBed() : toast(`Drag to change when you usually eat ${k}`))} />
    </div>
    {!items.length && <p className="mt-3 text-center text-sm text-muted">Nothing yet. Tap Tell OROZ to add something.</p>}
  </>;
}

function WeekView({ start, now, onPick }: { start: number; now: number; onPick: (d: number) => void }) {
  const st = useApp(s => s);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const px = 0.42; const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { scroller.current?.scrollTo({ top: 7 * 60 * px }); }, []);
  return <div className="rounded-xl border border-line bg-card/40">
    <div className="grid grid-cols-7 border-b border-line text-center">{days.map(d => <button key={d} onClick={() => onPick(d)} className={cx('py-2 text-xs', d === startOfDay(now) && 'font-semibold text-green')}>
      {dayName(d)}<br /><span className="serif text-base">{new Date(d).getDate()}</span>
      {itemsFor(d, st.blocks, st.tasks).some(b => b.kind === 'date') && <span className="mx-auto mt-0.5 block h-1 w-1 rounded-full bg-brass" />}
    </button>)}</div>
    <div ref={scroller} className="max-h-[62vh] overflow-y-auto"><div className="grid grid-cols-7">{days.map(d => <div key={d} className="border-l border-line/50 first:border-l-0" onClick={() => onPick(d)}>
      <DayColumn compact day={d} items={itemsFor(d, st.blocks, st.tasks)} bands={bandsFor(d, st.settings)} pxPerMin={px} now={now} onSelect={() => onPick(d)} />
    </div>)}</div></div>
  </div>;
}

function ItemSheet({ b, onClose }: { b: Block; onClose: () => void }) {
  const task = b.taskId ? store().state.tasks.find(t => t.id === b.taskId) : undefined;
  const series = b.seriesId ? store().state.blocks.filter(x => x.seriesId === b.seriesId) : [];
  const del = (ids: string[]) => { store().checkpoint(); store().remove('blocks', ids); toast('Removed', { label: 'Undo', run: () => store().undo() }); onClose(); };
  const src = { 'google-calendar': 'Google Calendar', 'apple-calendar': 'Apple Calendar', outlook: 'Outlook', classroom: 'Classroom', 'school-feed': 'school calendar', link: 'a link', photo: 'a photo', web: 'the web' } as Record<string, string>;
  return <Sheet open onClose={onClose} title={b.title}>
    <p className="text-sm text-muted">{b.allDay ? cap(fmtDay(b.start, Date.now())) : `${cap(fmtDay(b.start, Date.now()))} · ${fmtTime(b.start)}–${fmtTime(b.end)}`}{b.location ? ` · ${b.location}` : ''}</p>
    {src[b.source] && <p className="mt-1 text-xs text-muted">From {src[b.source]}{b.sourceUrl && <> · <a className="underline" href={b.sourceUrl} target="_blank" rel="noreferrer">source</a></>}</p>}
    <div className="mt-5 flex flex-col gap-2">
      {task && <Btn kind="primary" onClick={() => { store().checkpoint(); store().upsert('tasks', [{ ...task, done: true, doneAt: Date.now() }]); toast('Done', { label: 'Undo', run: () => store().undo() }); onClose(); }}>Mark done</Btn>}
      {task && <Btn onClick={() => { store().checkpoint(); store().upsert('tasks', [{ ...task, at: undefined }]); onClose(); }}>Take off the calendar</Btn>}
      {!task && (isOwn(b) || b.kind === 'date' || b.source === 'photo' || b.source === 'link') && <Btn kind="danger" onClick={() => del([b.id])}>Remove</Btn>}
      {!task && series.length > 1 && <Btn kind="danger" onClick={() => del(series.map(x => x.id))}>Remove every week</Btn>}
    </div>
  </Sheet>;
}

function BedtimeSheet({ day, onClose }: { day: number; onClose: () => void }) {
  const st = useApp(s => s);
  const n = nightFor(day, st.settings.sleep, st.settings.workDays);
  const key = isoDay(day);
  const mins = (t: number) => new Date(t).getHours() * 60 + new Date(t).getMinutes();
  const set = (m: number) => store().set('settings', { ...st.settings, sleep: { ...st.settings.sleep, overrides: { ...st.settings.sleep.overrides, [key]: hm(m) } } });
  const reset = () => { const o = { ...st.settings.sleep.overrides }; delete o[key]; store().set('settings', { ...st.settings, sleep: { ...st.settings.sleep, overrides: o } }); };
  return <Sheet open onClose={onClose} title={`Bedtime, ${fmtDay(day, Date.now())}`}>
    <p className="-mt-2 mb-3 text-sm text-muted">{n.overridden ? 'Just for this night' : n.weeknight ? 'Your weeknight default' : 'Your weekend default'}</p>
    <SleepDial bed={mins(n.bedtime)} wake={mins(n.wake)} onBed={set} />
    <div className="mt-5 flex gap-2"><Btn kind="primary" className="flex-1" onClick={onClose}>Done</Btn>{n.overridden && <Btn onClick={reset}>Use default</Btn>}</div>
  </Sheet>;
}
