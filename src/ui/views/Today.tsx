import { useEffect, useRef, useState } from 'react';
import type { Block } from '@engine/types';
import { MIN, addDays, startOfDay, fmtDay, fmtTime, fmtDur, at, dayName } from '@engine/time';
import { useApp, store } from '../../data/store';
import * as A from '../../data/actions';
import { syncAll } from '../../integrations/sync';
import { DayColumn } from '../components/DayColumn';
import { BlockSheet } from '../components/BlockSheet';
import { Btn, Card, cx, useNow } from '../ui';
import { toast } from '../toast';

export function Today() {
  const blocks = useApp(s => s.blocks);
  const reminders = useApp(s => s.reminders);
  const [day, setDay] = useState(startOfDay(Date.now()));
  const [sel, setSel] = useState<Block | null>(null);
  const [lastMove, setLastMove] = useState<{ id: string; title: string; displaced: number } | null>(null);
  const now = useNow(30_000);
  const scroller = useRef<HTMLDivElement>(null);
  const pxPerMin = 1.15;
  const [pull, setPull] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const touchY = useRef<number | null>(null);

  useEffect(() => { // scroll to now (or 7am)
    const t = day === startOfDay(Date.now()) ? Math.max(0, (Date.now() - day) / MIN - 90) : 7 * 60;
    scroller.current?.scrollTo({ top: t * pxPerMin });
  }, [day]);

  const refresh = async () => {
    setSyncing(true);
    try { const msgs = await syncAll(false); toast(msgs.length ? msgs.join(' · ') : 'Up to date (no feeds connected — see Settings)'); }
    finally { setSyncing(false); }
  };

  const digest = reminders.filter(r => !r.done && r.importance === 'passive' && r.dueAt >= startOfDay(now) && r.dueAt < addDays(startOfDay(now), 1));
  const active = blocks.find(b => b.status === 'active' && b.end > now);
  const todayBlocks = blocks.filter(b => b.start < addDays(day, 1) && b.end > day && b.kind !== 'sleep');
  const free = freeMinutes(blocks, day, now);

  return <div className="flex h-full flex-col">
    <div className="flex items-center gap-2 px-3 pb-2">
      <Btn kind="ghost" className="px-2" onClick={() => setDay(addDays(day, -1))} aria-label="Previous day">‹</Btn>
      <button className="min-w-0 flex-1 text-left" onClick={() => setDay(startOfDay(Date.now()))}>
        <div className="text-lg font-bold capitalize">{fmtDay(day, Date.now())}</div>
        <div className="text-xs text-slate-500">{dayName(day, true)} · {todayBlocks.length} blocks · {fmtDur(free)} unscheduled</div>
      </button>
      <Btn kind="ghost" className="px-2" onClick={() => setDay(addDays(day, 1))} aria-label="Next day">›</Btn>
    </div>

    <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-3 pb-2">
      <Btn kind="primary" className="shrink-0 text-xs" onClick={() => { const r = A.runPlan(day === startOfDay(Date.now()) ? 'day' : 'week'); toast(`Planned: ${r.added.filter(b => b.taskId).length} work blocks${r.unplaced.length ? `, ${r.unplaced.length} didn't fit` : ''}`, { label: 'Undo', run: () => store().undo() }); }}>✨ Plan my day</Btn>
      <Btn className="shrink-0 text-xs" onClick={() => { const r = A.runPlan('week'); toast(`Week planned · ${r.warnings.length} heads-ups`, { label: 'Undo', run: () => store().undo() }); }}>Plan week</Btn>
      <Btn kind="danger" className="shrink-0 text-xs" onClick={() => { A.fellApart(); toast('Re-planned the rest of today from right now', { label: 'Undo', run: () => store().undo() }); }}>😵 My day fell apart</Btn>
      <Btn className="shrink-0 text-xs" disabled={!store().history.canUndo} onClick={() => store().undo()}>↶ Undo</Btn>
      <Btn className="shrink-0 text-xs" disabled={!store().history.canRedo} onClick={() => store().redo()}>↷ Redo</Btn>
      <Btn className="shrink-0 text-xs" onClick={refresh}>{syncing ? '…' : '⟳ Sync'}</Btn>
    </div>

    {active && <Card className="mx-3 mb-2 flex items-center justify-between border-indigo-300 bg-indigo-50 dark:bg-indigo-500/10">
      <div><div className="text-xs text-indigo-700 dark:text-indigo-300">Now doing</div><div className="font-semibold">{active.title}</div><div className="text-xs tabular-nums">{fmtDur(Math.max(0, (active.end - now) / MIN))} left</div></div>
      <Btn kind="primary" onClick={() => { A.completeBlock(active); toast('Done ✓'); }}>Done</Btn>
    </Card>}
    {digest.length > 0 && day === startOfDay(now) && <div className="mx-3 mb-2 rounded-xl bg-slate-100 px-3 py-2 text-xs dark:bg-white/5">📋 Today: {digest.map(d => `${d.title.replace(/^Due: /, '')} ${fmtTime(d.dueAt)}`).join(' · ')}</div>}
    {lastMove && <div className="pop mx-3 mb-2 flex items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs dark:bg-amber-500/10">
      <span>Moved <b>{lastMove.title}</b>{lastMove.displaced ? ` · bumps ${lastMove.displaced}` : ''}</span>
      <span className="flex gap-1">
        <Btn className="px-2 py-1 text-xs" kind="primary" onClick={() => { A.reflowAround(lastMove.id); setLastMove(null); toast('Reflowed the rest of the day', { label: 'Undo', run: () => store().undo() }); }}>Auto-reflow</Btn>
        <Btn className="px-2 py-1 text-xs" onClick={() => { store().undo(); setLastMove(null); }}>Undo</Btn>
      </span>
    </div>}

    <div ref={scroller} className="relative flex-1 overflow-y-auto px-2 pb-40"
      onTouchStart={e => { touchY.current = scroller.current!.scrollTop <= 0 ? e.touches[0].clientY : null; }}
      onTouchMove={e => { if (touchY.current !== null) setPull(Math.max(0, Math.min(90, e.touches[0].clientY - touchY.current))); }}
      onTouchEnd={() => { if (pull > 70) refresh(); setPull(0); touchY.current = null; }}>
      {pull > 0 && <div className="text-center text-xs text-slate-500" style={{ height: pull }}>{pull > 70 ? 'Release to sync' : 'Pull to sync'}</div>}
      <DayColumn day={day} blocks={blocks} pxPerMin={pxPerMin} now={now} onSelect={setSel}
        onMove={(b, s, e, displaced) => { A.moveBlock(b.id, s, e); setLastMove({ id: b.id, title: b.title, displaced }); }}
        onCreate={start => { const b = A.createBlock({ title: 'New block', start, end: start + 30 * MIN, kind: 'event', flexibility: 'movable' }); setSel(b); }} />
    </div>
    <Legend />
    <BlockSheet block={sel} onClose={() => setSel(null)} />
  </div>;
}

function freeMinutes(blocks: Block[], day: number, now: number) {
  const s = store().state.settings;
  const lo = Math.max(at(day, s.wake), day === startOfDay(now) ? now : 0), hi = at(day, s.bedtime);
  if (hi <= lo) return 0;
  const busy = blocks.filter(b => b.end > lo && b.start < hi && b.kind !== 'sleep' && b.status !== 'skipped').map(b => [Math.max(lo, b.start), Math.min(hi, b.end)] as const).sort((a, b) => a[0] - b[0]);
  let used = 0, cur = lo;
  for (const [a, b] of busy) { if (b <= cur) continue; used += b - Math.max(a, cur); cur = Math.max(cur, b); }
  return Math.round((hi - lo - used) / MIN);
}

function Legend() {
  const items: [string, string][] = [['bg-sky-600 fixed-stripes', 'school (fixed)'], ['bg-indigo-600', 'event'], ['bg-violet-500', 'task'], ['bg-amber-400', 'meal'], ['bg-emerald-500', 'life'], ['bg-slate-800', 'sleep']];
  return <div className="no-scrollbar pointer-events-none absolute right-2 top-[132px] hidden gap-2 text-[10px] text-slate-500 md:flex">
    {items.map(([c, l]) => <span key={l} className="flex items-center gap-1"><span className={cx('h-2.5 w-2.5 rounded', c)} />{l}</span>)}
  </div>;
}
