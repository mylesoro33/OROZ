import { useEffect, useRef, useState } from 'react';
import { parseCapture, type Capture, type CaptureKind } from '@engine/parser';
import type { Suggestion } from '@engine/suggest';
import type { FoodOption } from '@engine/meals';
import type { PlanResult } from '@engine/planner';
import { fmtTime, fmtDay, fmtDur, startOfDay, addDays, at, MIN } from '@engine/time';
import { useApp, store } from '../../data/store';
import * as A from '../../data/actions';
import { Btn, Chip, Card, cx } from '../ui';
import { toast } from '../toast';

type Panel =
  | { type: 'capture'; c: Capture; refined?: boolean }
  | { type: 'suggest'; title: string; items: Suggestion[] }
  | { type: 'food'; minutes: number; items: FoodOption[] }
  | { type: 'plan'; title: string; r: PlanResult; from: number; to: number }
  | { type: 'slot'; title: string; start: number; minutes: number; kind: 'hobby'; activityId?: string };

const KINDS: CaptureKind[] = ['task', 'event', 'reminder', 'meal', 'hobby', 'birthday', 'note'];
const EXAMPLES = ['30 school', 'eat 30', 'nap', 'movie', 'tonight', 'push 1h', 'bio lab report 90m fri high', 'dinner with Jake saturday 7', "Mom's birthday march 3", 'I hate mushrooms', 'Jake likes fishing'];

export function CommandBar() {
  const [text, setText] = useState('');
  const [panel, setPanel] = useState<Panel | null>(null);
  const [listening, setListening] = useState(false);
  const places = useApp(s => s.places);
  const people = useApp(s => s.people);
  const settings = useApp(s => s.settings);
  const inputRef = useRef<HTMLInputElement>(null);
  const [hint, setHint] = useState(0);
  useEffect(() => { const t = setInterval(() => setHint(h => (h + 1) % EXAMPLES.length), 3500); return () => clearInterval(t); }, []);

  const run = (raw: string) => {
    const line = raw.trim(); if (!line) return;
    const c = parseCapture(line, { now: Date.now(), places: places.map(p => ({ id: p.id, name: p.name })), people: people.map(p => p.name) });
    if (c.kind === 'command' && c.command) return runCommand(c.command, line);
    setPanel({ type: 'capture', c });
    if (settings.flags.llm && settings.llmApiKey && c.defaulted.length >= 2) {
      import('../../integrations/llm').then(m => m.llmRefineCapture(line, new Date(), c, settings.llmApiKey!)).then(r => {
        if (r) setPanel(p => (p?.type === 'capture' && p.c.raw === line ? { type: 'capture', c: { ...p.c, ...r, defaulted: [] }, refined: true } : p));
      }).catch(() => {});
    }
  };

  const runCommand = (cmd: NonNullable<Capture['command']>, line: string) => {
    switch (cmd.type) {
      case 'free': {
        const items = A.getSuggestions(cmd.minutes, cmd.place);
        const pl = cmd.place ?? places.find(p => p.id === store().state.currentPlaceId)?.name ?? 'here';
        setPanel({ type: 'suggest', title: `${fmtDur(cmd.minutes)} at ${pl}`, items }); break;
      }
      case 'eat': {
        const until = nextFixedStart();
        const minutes = cmd.minutes ?? Math.max(15, Math.min(60, Math.round((until - Date.now()) / MIN) - 5));
        setPanel({ type: 'food', minutes, items: A.foodOptions(minutes) }); break;
      }
      case 'nap': {
        const b = A.napNow(cmd.minutes);
        if (b) { toast(`Nap held ${fmtDay(b.start, Date.now())} ${fmtTime(b.start)} · ${b.reason}`, { label: 'Undo', run: () => store().undo() }); setText(''); setPanel(null); }
        else toast('No free slot for a nap in the next 2 days');
        break;
      }
      case 'movie': {
        const s = A.movieSlot();
        if (s === undefined) toast('No 2-hour evening slot in the next few days');
        else setPanel({ type: 'slot', title: `Movie · ${fmtDay(s, Date.now())} ${fmtTime(s)}`, start: s, minutes: store().state.activities.find(a => a.category === 'movie')?.durationMin ?? 120, kind: 'hobby', activityId: store().state.activities.find(a => a.category === 'movie')?.id });
        break;
      }
      case 'quickplan': {
        const r = A.runPlan(cmd.when === 'tonight' ? 'day' : 'tomorrow');
        const day = cmd.when === 'tonight' ? startOfDay(Date.now()) : addDays(startOfDay(Date.now()), 1);
        const from = cmd.when === 'tonight' ? Math.max(Date.now(), at(day, '16:00')) : day;
        setPanel({ type: 'plan', title: cmd.when === 'tonight' ? 'Tonight' : 'Tomorrow', r, from, to: addDays(day, 1) }); break;
      }
      case 'push': {
        const r = A.pushBy(cmd.minutes);
        toast(`Pushed the rest of today ${fmtDur(cmd.minutes)}${r.dropped.length ? ` · ${r.dropped.length} item(s) no longer fit` : ''}`, { label: 'Undo', run: () => store().undo() });
        setText(''); setPanel(null); break;
      }
      case 'plan': {
        const r = A.runPlan(cmd.range);
        setPanel({ type: 'plan', title: cmd.range === 'week' ? 'Your week' : 'Your day', r, from: Date.now(), to: addDays(startOfDay(Date.now()), cmd.range === 'week' ? 7 : 1) }); break;
      }
      case 'fellApart': {
        const r = A.fellApart();
        setPanel({ type: 'plan', title: 'Re-planned from now', r, from: Date.now(), to: addDays(startOfDay(Date.now()), 1) }); break;
      }
    }
    void line;
  };

  const confirm = (c: Capture) => {
    const msg = A.applyCapture(c);
    toast(msg, { label: 'Undo', run: () => store().undo() });
    setText(''); setPanel(null);
  };

  const voice = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { toast('Voice input is not supported in this browser — try your keyboard\'s mic button.'); return; }
    const rec = new SR(); rec.lang = 'en-US'; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onresult = (e: any) => { const t = e.results[0][0].transcript; setText(t); run(t); };
    rec.onend = () => setListening(false); rec.onerror = () => setListening(false);
    setListening(true); rec.start();
  };

  return <div className="pointer-events-none fixed inset-x-0 bottom-[60px] z-40 px-3 pb-2 safe-bottom">
    <div className="pointer-events-auto mx-auto max-w-2xl">
      {panel && <div className="pop mb-2 max-h-[55vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur dark:border-white/10 dark:bg-[#15151f]/95">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{panelTitle(panel)}</span>
          <button className="px-2 text-slate-400" onClick={() => setPanel(null)} aria-label="Close">✕</button>
        </div>
        {panel.type === 'capture' && <ConfirmCard c={panel.c} refined={panel.refined} onChange={c => setPanel({ ...panel, c })} onConfirm={confirm} />}
        {panel.type === 'suggest' && <SuggestionList items={panel.items} onDone={() => { setPanel(null); setText(''); }} />}
        {panel.type === 'food' && <FoodList minutes={panel.minutes} items={panel.items} onDone={() => { setPanel(null); setText(''); }} />}
        {panel.type === 'plan' && <PlanSummary {...panel} />}
        {panel.type === 'slot' && <div className="flex items-center justify-between gap-2"><span className="text-sm">Next block long enough for a movie</span>
          <Btn kind="primary" onClick={() => { A.createBlock({ title: 'Movie', kind: 'hobby', start: panel.start, end: panel.start + panel.minutes * MIN, activityId: panel.activityId, flexibility: 'optional', reason: 'Next evening slot long enough for a movie' }); toast('Movie scheduled', { label: 'Undo', run: () => store().undo() }); setPanel(null); setText(''); }}>Schedule</Btn></div>}
      </div>}
      <form onSubmit={e => { e.preventDefault(); if (panel?.type === 'capture' && panel.c.raw === text.trim()) confirm(panel.c); else run(text); }}
        className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-white/10 dark:bg-[#1b1b27]">
        <input ref={inputRef} value={text} onChange={e => { setText(e.target.value); if (!e.target.value) setPanel(null); }}
          placeholder={`Try "${EXAMPLES[hint]}"`} aria-label="Quick capture or command"
          className="min-w-0 flex-1 bg-transparent px-2 py-2 text-[15px] outline-none placeholder:text-slate-400" enterKeyHint="go" autoComplete="off" />
        <button type="button" onClick={voice} aria-label="Voice input" className={cx('h-10 w-10 shrink-0 rounded-xl text-lg', listening ? 'animate-pulse bg-rose-500 text-white' : 'bg-slate-100 dark:bg-white/10')}>🎙</button>
        <button type="submit" aria-label="Go" className="h-10 shrink-0 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white">Go</button>
      </form>
    </div>
  </div>;
}

function nextFixedStart(): number {
  const t = Date.now();
  const next = store().state.blocks.filter(b => b.flexibility === 'fixed' && b.start > t && b.kind !== 'sleep').sort((a, b) => a.start - b.start)[0];
  return next?.start ?? t + 60 * MIN;
}

function panelTitle(p: Panel): string {
  switch (p.type) {
    case 'capture': return p.refined ? 'Got it ✨ (refined)' : 'Got it — tap to fix';
    case 'suggest': return p.title;
    case 'food': return `Food that fits ${fmtDur(p.minutes)}`;
    case 'plan': return p.title;
    case 'slot': return p.title;
  }
}

// ---------------------------------------------------------------------------
function ConfirmCard({ c, onChange, onConfirm, refined }: { c: Capture; onChange: (c: Capture) => void; onConfirm: (c: Capture) => void; refined?: boolean }) {
  const places = useApp(s => s.places);
  const now = Date.now();
  const d = (f: string) => c.defaulted.includes(f);
  const set = (patch: Partial<Capture>, field?: string) => {
    const n = { ...c, ...patch, defaulted: c.defaulted.filter(x => x !== field) };
    if (n.day !== undefined && n.timeMin !== undefined) n.start = at(n.day, n.timeMin);
    onChange(n);
  };
  const cycle = <T,>(list: T[], cur: T | undefined) => list[(list.indexOf(cur as T) + 1) % list.length];
  const showWhen = ['task', 'event', 'reminder', 'meal', 'hobby'].includes(c.kind);
  const dayOpts = [startOfDay(now), addDays(startOfDay(now), 1), addDays(startOfDay(now), 2), addDays(startOfDay(now), 3), addDays(startOfDay(now), 7)];
  return <div>
    <input value={c.title} onChange={e => onChange({ ...c, title: e.target.value })} className="mb-2 w-full rounded-lg bg-slate-100 px-2 py-1.5 text-base font-semibold outline-none dark:bg-white/5" aria-label="Title" />
    <div className="flex flex-wrap gap-1.5">
      {c.kind === 'food_pref' || c.kind === 'person_pref'
        ? <Chip active>{c.kind === 'food_pref' ? '🍽 food profile' : `👤 ${c.pref?.target}`} · {c.pref?.field} · {c.pref?.value}</Chip>
        : <Chip active onClick={() => set({ kind: cycle(KINDS, c.kind as CaptureKind) })}>{icon(c.kind)} {c.kind}</Chip>}
      {showWhen && <>
        <Chip dashed={d('date') || d('due')} onClick={() => set({ day: cycle(dayOpts, c.day ?? -1) }, c.kind === 'task' ? 'due' : 'date')}>📅 {c.day !== undefined ? fmtDay(c.day, now) : 'no due date'}</Chip>
        {c.kind !== 'task' || c.timeMin !== undefined ? <label className={cx('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs', d('time') || d('am/pm') ? 'border-dashed border-amber-500' : 'border-slate-300 dark:border-white/15')}>
          🕒 <input type="time" value={c.timeMin !== undefined ? `${String(Math.floor(c.timeMin / 60)).padStart(2, '0')}:${String(c.timeMin % 60).padStart(2, '0')}` : ''} onChange={e => { const [h, m] = e.target.value.split(':').map(Number); set({ timeMin: h * 60 + m, day: c.day ?? startOfDay(now) }, d('am/pm') ? 'am/pm' : 'time'); }} className="bg-transparent outline-none" />
        </label> : null}
        {c.kind !== 'reminder' && <Chip dashed={d('duration')} onClick={() => set({ durationMin: cycle([15, 30, 45, 60, 90, 120, 180], c.durationMin) }, 'duration')}>⏱ {fmtDur(c.durationMin ?? 30)}</Chip>}
        {c.kind === 'task' && <Chip dashed={d('priority')} onClick={() => set({ priority: cycle([1, 2, 3] as const, c.priority ?? 2) }, 'priority')}>{['', '🔴 high', '🟡 medium', '⚪ low'][c.priority ?? 2]}</Chip>}
        <Chip onClick={() => { const opts = [undefined, ...places]; const idx = opts.findIndex(p => p?.id === c.place?.id); const nx = opts[(idx + 1) % opts.length]; set({ place: nx ? { id: nx.id, name: nx.name } : undefined }); }}>📍 {c.place?.name ?? 'anywhere'}</Chip>
      </>}
      {c.person && c.kind !== 'person_pref' && <Chip>👤 {c.person}</Chip>}
      {(c.kind === 'birthday' || c.kind === 'anniversary') && <label className={cx('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs', d('date') ? 'border-dashed border-amber-500' : 'border-slate-300 dark:border-white/15')}>🎂
        <input type="date" value={c.month ? `${new Date(now).getFullYear()}-${String(c.month).padStart(2, '0')}-${String(c.dayOfMonth).padStart(2, '0')}` : ''} onChange={e => { const [, m, dd] = e.target.value.split('-').map(Number); set({ month: m, dayOfMonth: dd }, 'date'); }} className="bg-transparent outline-none" />
      </label>}
    </div>
    {c.defaulted.length > 0 && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">Dashed chips are my best guess — tap to change.</p>}
    {refined && <p className="mt-1 text-xs text-slate-500">Refined by the optional AI parser.</p>}
    <Btn kind="primary" className="mt-3 w-full" onClick={() => onConfirm(c)}>Add ✓</Btn>
  </div>;
}
const icon = (k: string) => ({ task: '✅', event: '📌', reminder: '⏰', meal: '🍽', hobby: '🎈', birthday: '🎂', anniversary: '💍', note: '📝' } as Record<string, string>)[k] ?? '•';

export function SuggestionList({ items, onDone }: { items: Suggestion[]; onDone: () => void }) {
  const [hidden, setHidden] = useState<string[]>([]);
  const list = items.filter(i => !hidden.includes(i.id));
  if (!list.length) return <p className="text-sm text-slate-500">Nothing fits right now — maybe just enjoy the free time. 🌿</p>;
  return <div className="space-y-2">{list.map((s, i) => <Card key={s.id} className="p-2.5">
    <div className="flex items-start justify-between gap-2">
      <div><div className="font-semibold">{i === 0 && '⭐ '}{s.title}</div><div className="text-xs text-slate-500 dark:text-slate-400">Why this? {s.why}</div></div>
      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs dark:bg-white/10">{fmtDur(s.minutes)}</span>
    </div>
    <div className="mt-2 flex flex-wrap gap-1.5">
      <Btn kind="primary" className="px-2.5 py-1.5 text-xs" onClick={() => { A.doNow(s); toast(`Started: ${s.title}`, { label: 'Undo', run: () => store().undo() }); onDone(); }}>▶ Do now</Btn>
      <Btn className="px-2.5 py-1.5 text-xs" onClick={() => { A.scheduleLater(s); toast('Scheduled for later'); onDone(); }}>Later</Btn>
      <Btn kind="ghost" className="px-2.5 py-1.5 text-xs" onClick={() => { A.skipSuggestion(s); setHidden(h => [...h, s.id]); }}>Skip</Btn>
      <Btn kind="ghost" className="px-2.5 py-1.5 text-xs" onClick={() => { A.neverSuggest(s); setHidden(h => [...h, s.id]); toast("Won't suggest that again (Settings → Learned to undo)"); }}>Not now · don't suggest</Btn>
      {s.link && <a href={s.link} target="_blank" rel="noreferrer" className="px-2 py-1.5 text-xs text-indigo-600 underline">Open map</a>}
    </div>
  </Card>)}</div>;
}

export function FoodList({ items, minutes, onDone }: { items: FoodOption[]; minutes: number; onDone: () => void }) {
  const tag = { 'dine-in': 'bg-sky-100 text-sky-800', takeout: 'bg-orange-100 text-orange-800', cook: 'bg-emerald-100 text-emerald-800', pack: 'bg-violet-100 text-violet-800' };
  if (!items.length) return <p className="text-sm text-slate-500">No options match your food profile and time — try a longer window.</p>;
  return <div className="space-y-2">{items.map(o => <Card key={o.id} className="p-2.5">
    <div className="flex items-start justify-between gap-2">
      <div><div className="font-semibold">{o.title}</div><div className="text-xs text-slate-500 dark:text-slate-400">{o.why}</div></div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold', tag[o.mode])}>{o.mode}</span>
        <span className={cx('text-[11px] font-medium', o.fits ? 'text-emerald-600' : 'text-rose-600')}>{o.fits ? `fits ${fmtDur(minutes)}` : `needs ${fmtDur(o.minutes)}`}</span>
      </div>
    </div>
    <div className="mt-2 flex gap-1.5">
      {!o.external && <Btn kind="primary" className="px-2.5 py-1.5 text-xs" onClick={() => { A.doNow({ id: `food:${o.id}`, title: o.title, minutes: o.minutes, kind: 'food' }); store().log({ action: 'accepted', key: `food:${o.id}` }); toast(`Enjoy: ${o.title}`); onDone(); }}>▶ Eat now</Btn>}
      {o.link && <a href={o.link} target="_blank" rel="noreferrer" onClick={() => store().log({ action: 'accepted', key: `food:${o.id}` })} className="rounded-xl bg-slate-200/70 px-2.5 py-1.5 text-xs font-medium dark:bg-white/10">Open map ↗</a>}
      <Btn kind="ghost" className="px-2.5 py-1.5 text-xs" onClick={() => store().log({ action: 'rejected', key: `food:${o.id}` })}>Not this</Btn>
    </div>
  </Card>)}</div>;
}

function PlanSummary({ r, from, to }: { r: PlanResult; from: number; to: number }) {
  const shown = r.blocks.filter(b => b.end > from && b.start < to && b.kind !== 'sleep').slice(0, 14);
  return <div className="space-y-1.5 text-sm">
    {r.warnings.slice(0, 4).map((w, i) => <div key={i} className="rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">⚠ {w}</div>)}
    {r.unplaced.slice(0, 4).map(u => <div key={u.title} className="rounded-lg bg-rose-50 px-2 py-1 text-xs text-rose-800 dark:bg-rose-500/10 dark:text-rose-300">Couldn't place {u.title}: {u.reason}</div>)}
    {shown.map(b => <div key={b.id} className="flex gap-2"><span className="w-24 shrink-0 text-xs tabular-nums text-slate-500">{fmtDay(b.start, Date.now()).slice(0, 3)} {fmtTime(b.start)}</span><span className="min-w-0"><span className="font-medium">{b.title}</span>{b.source === 'planner' && b.reason && <span className="block truncate text-xs text-slate-500">{b.reason}</span>}</span></div>)}
    {!shown.length && <p className="text-slate-500">Nothing scheduled — enjoy the open time.</p>}
    <Btn kind="ghost" className="mt-1 w-full text-xs" onClick={() => { store().undo(); toast('Plan undone'); }}>Undo this plan</Btn>
  </div>;
}
