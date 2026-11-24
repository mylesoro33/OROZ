import { useEffect, useState } from 'react';
import type { Block, Importance } from '@engine/types';
import { fmtTime, fmtDay, fmtDur, MIN } from '@engine/time';
import { useApp, store } from '../../data/store';
import * as A from '../../data/actions';
import { Btn, Chip, Sheet, IMPORTANCE, isImported, inputCls, Field } from '../ui';
import { toast } from '../toast';

export function BlockSheet({ block, onClose }: { block: Block | null; onClose: () => void }) {
  const live = useApp(s => (block ? s.blocks.find(b => b.id === block.id) : undefined));
  const reminder = useApp(s => (block ? s.reminders.find(r => r.itemId === block.id) : undefined));
  const project = useApp(s => (live?.projectId ? s.projects.find(p => p.id === live.projectId) : undefined));
  const [title, setTitle] = useState('');
  useEffect(() => setTitle(live?.title ?? ''), [live?.id]);
  if (!block || !live) return null;
  const b = live;
  const locked = isImported(b) || b.kind === 'sleep';
  const setImp = (imp: Importance) => {
    A.updateBlock(b.id, { importance: imp });
    if (reminder) A.setReminderImportance(reminder, imp);
    toast(`Reminder style: ${imp}`);
  };
  const durOpts = [15, 25, 30, 45, 60, 90, 120];
  return <Sheet open onClose={onClose} title={undefined}>
    {locked ? <h3 className="mb-1 text-lg font-semibold">🔒 {b.title}</h3>
      : <input value={title} onChange={e => setTitle(e.target.value)} onBlur={() => title && title !== b.title && A.updateBlock(b.id, { title })} className="mb-1 w-full bg-transparent text-lg font-semibold outline-none" />}
    <p className="text-sm text-slate-500">{fmtDay(b.start, Date.now())} · {fmtTime(b.start)}–{fmtTime(b.end)} ({fmtDur((b.end - b.start) / MIN)}) · {b.kind}{b.flexibility !== 'movable' ? ` · ${b.flexibility}` : ''}</p>
    {b.reason && <p className="mt-2 rounded-xl bg-indigo-50 px-3 py-2 text-sm text-indigo-900 dark:bg-indigo-500/10 dark:text-indigo-200"><b>Why here?</b> {b.reason}</p>}
    {locked && b.kind !== 'sleep' && <p className="mt-2 text-xs text-slate-500">Imported from your calendar ({b.source}). Imported events are fixed and can't be moved here.</p>}
    {b.kind === 'sleep' && <p className="mt-2 text-xs text-slate-500">Protected sleep. Change bedtime / wake in Settings — or override for tonight below.</p>}
    {b.notes && <p className="mt-2 text-sm">📍 {b.notes}</p>}

    {b.kind !== 'sleep' && <>
      <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Reminder style</div>
      <div className="mt-1 flex gap-1.5">{IMPORTANCE.map(i => <Chip key={i.key} active={(reminder?.importance ?? b.importance ?? 'normal') === i.key} onClick={() => setImp(i.key)} title={i.hint}>{i.label}</Chip>)}</div>
    </>}

    {!locked && <>
      <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Length</div>
      <div className="mt-1 flex flex-wrap gap-1.5">{durOpts.map(d => <Chip key={d} active={Math.round((b.end - b.start) / MIN) === d} onClick={() => A.moveBlock(b.id, b.start, b.start + d * MIN)}>{fmtDur(d)}</Chip>)}</div>
      <Field label="Start"><input type="datetime-local" className={inputCls} value={toLocal(b.start)} onChange={e => { const s = new Date(e.target.value).getTime(); if (s) A.moveBlock(b.id, s, s + (b.end - b.start)); }} /></Field>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {(['fixed', 'movable', 'optional'] as const).map(f => <Chip key={f} active={b.flexibility === f} onClick={() => A.updateBlock(b.id, { flexibility: f, source: b.source === 'planner' ? 'manual' : b.source })}>{f}</Chip>)}
      </div>
    </>}

    {project?.starterKit && <p className="mt-3 text-sm">🧰 A starter kit for <b>{project.title}</b> is ready in Tasks → Projects.</p>}

    <div className="mt-5 grid grid-cols-2 gap-2">
      {b.status !== 'done' && b.kind !== 'sleep' && <Btn kind="primary" onClick={() => { A.completeBlock(b); toast('Nice — logged as done'); onClose(); }}>✓ Done</Btn>}
      {b.status !== 'active' && b.status !== 'done' && !locked && <Btn onClick={() => { const n = Date.now(); A.moveBlock(b.id, n, n + (b.end - b.start)); A.updateBlock(b.id, { status: 'active' }); onClose(); }}>▶ Start now</Btn>}
      {b.status !== 'skipped' && b.kind !== 'sleep' && <Btn onClick={() => { A.skipBlock(b); toast('Skipped — noted for learning'); onClose(); }}>Skip</Btn>}
      {!locked && <Btn onClick={() => { A.reflowAround(b.id); toast('Reflowed the rest of the day', { label: 'Undo', run: () => store().undo() }); }}>Auto-reflow day</Btn>}
      {b.kind === 'sleep' && <Btn onClick={() => { A.updateBlock(b.id, { flexibility: 'movable', source: 'manual', reason: 'Sleep override for tonight' }); toast('Sleep unlocked for tonight — drag it'); onClose(); }}>Override tonight</Btn>}
      {!isImported(b) && <Btn kind="danger" onClick={() => { A.deleteBlock(b.id); toast('Deleted', { label: 'Undo', run: () => store().undo() }); onClose(); }}>Delete</Btn>}
    </div>
  </Sheet>;
}

const toLocal = (t: number) => { const d = new Date(t - new Date(t).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
