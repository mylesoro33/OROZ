import { useState } from 'react';
import { Check, ChevronDown, Trash2 } from 'lucide-react';
import type { Task, TaskType } from '@engine/types';
import { talkToDraft, guessType } from '@engine/talk';
import { addDays, startOfDay, fmtDay, fmtTime, isoDay, uid } from '@engine/time';
import { useApp, store } from '../../data/store';
import { Btn, Chip, Sheet, Field, inputCls, TASK_ICON, cx } from '../ui';
import { FitIn } from '../components/FitIn';
import { toast } from '../toast';

const TYPES: TaskType[] = ['errand', 'call', 'home', 'work', 'school', 'health', 'social'];

export function Todo() {
  const tasks = useApp(s => s.tasks);
  const places = useApp(s => s.places);
  const [text, setText] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [edit, setEdit] = useState<Task | null>(null);
  const [fit, setFit] = useState<string | null>(null);
  const now = Date.now(); const today = startOfDay(now);
  const weekEnd = addDays(today, 7 - new Date(today).getDay() || 7);
  const when = (t: Task) => t.at ?? t.date ?? (t.by ? t.by - 1 : undefined);
  const open = tasks.filter(t => !t.done).sort((a, b) => (when(a) ?? Infinity) - (when(b) ?? Infinity) || a.createdAt - b.createdAt);
  const groups: [string, Task[]][] = [
    ['Today', open.filter(t => (when(t) ?? Infinity) < addDays(today, 1))],
    ['This week', open.filter(t => { const w = when(t); return w !== undefined && w >= addDays(today, 1) && w < weekEnd; })],
    ['Whenever', open.filter(t => { const w = when(t); return w === undefined || w >= weekEnd; })],
  ];
  const done = tasks.filter(t => t.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  const add = () => {
    const d = talkToDraft(text, now, places);
    if (d.kind === 'task' && d.task) { store().upsert('tasks', [{ ...d.task, source: 'manual' }]); if (d.fitIn) setFit(d.task.id); }
    else store().upsert('tasks', [{ id: uid('task'), title: text.trim(), type: guessType(text), durationMin: 30, done: false, source: 'manual', createdAt: now }]);
    setText('');
  };
  const toggle = (t: Task) => { store().checkpoint(); store().upsert('tasks', [{ ...t, done: !t.done, doneAt: t.done ? undefined : Date.now() }]); if (!t.done) toast('Done', { label: 'Undo', run: () => store().undo() }); };

  return <div className="h-full overflow-y-auto px-5 pb-40">
    <h1 className="mb-4 pr-10 text-2xl font-semibold">To-Do</h1>
    <form onSubmit={e => { e.preventDefault(); if (text.trim()) add(); }} className="mb-5">
      <input value={text} onChange={e => setText(e.target.value)} className={inputCls} placeholder="Add something" aria-label="Add a to-do" enterKeyHint="done" />
    </form>
    {!open.length && !done.length && <p className="py-10 text-center text-sm text-muted">Nothing to do. Type above or tap Tell OROZ.</p>}
    {groups.map(([title, list]) => list.length > 0 && <section key={title} className="mb-5">
      <h2 className="mb-1 text-sm font-semibold text-muted">{title}</h2>
      <ul className="divide-y divide-line border-y border-line">{list.map(t => <Row key={t.id} t={t} onToggle={toggle} onEdit={setEdit} onFit={() => setFit(t.id)} />)}</ul>
    </section>)}
    {done.length > 0 && <>
      <button onClick={() => setShowDone(!showDone)} className="mt-2 flex items-center gap-1 text-sm text-muted">Done · {done.length}<ChevronDown size={14} className={showDone ? 'rotate-180' : ''} /></button>
      {showDone && <ul className="mt-2">{done.slice(0, 30).map(t => <Row key={t.id} t={t} onToggle={toggle} onEdit={setEdit} />)}</ul>}
    </>}
    {edit && <TaskSheet t={edit} onClose={() => setEdit(null)} />}
    {fit && <Sheet open onClose={() => setFit(null)} title="Fit it in"><FitIn taskId={fit} onDone={() => setFit(null)} /></Sheet>}
  </div>;
}

function Row({ t, onToggle, onEdit, onFit }: { t: Task; onToggle: (t: Task) => void; onEdit: (t: Task) => void; onFit?: () => void }) {
  const I = TASK_ICON[t.type]; const now = Date.now();
  const meta = [t.at ? (startOfDay(t.at) === startOfDay(now) ? fmtTime(t.at) : `${fmtDay(t.at, now)} ${fmtTime(t.at)}`) : t.date ? fmtDay(t.date, now) : '', t.placeName].filter(Boolean).join(' · ');
  return <li className="flex items-center gap-3 py-2.5">
    <button aria-label={t.done ? 'Not done' : 'Done'} onClick={() => onToggle(t)} className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border', t.done ? 'border-green bg-green text-paper' : 'border-muted/60')}>{t.done && <Check size={12} strokeWidth={3} />}</button>
    <button className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => onEdit(t)}>
      <I size={15} strokeWidth={1.6} className="shrink-0 text-muted" aria-label={t.type} />
      <span className={cx('min-w-0 flex-1 truncate text-sm', t.done && 'text-muted line-through')}>{t.title}</span>
      {meta && <span className="shrink-0 text-xs text-muted">{meta}</span>}
    </button>
    {!t.done && !t.at && onFit && <button onClick={onFit} className="shrink-0 rounded-md border border-line px-2 py-0.5 text-xs text-green">Fit in</button>}
  </li>;
}

function TaskSheet({ t, onClose }: { t: Task; onClose: () => void }) {
  const [x, setX] = useState(t);
  const places = useApp(s => s.places);
  return <Sheet open onClose={onClose} title="To-do">
    <Field label="What"><input className={inputCls} value={x.title} onChange={e => setX({ ...x, title: e.target.value })} /></Field>
    <div className="grid grid-cols-2 gap-2">
      <Field label="Date (optional)"><input type="date" className={inputCls} value={x.date ? isoDay(x.date) : ''} onChange={e => setX({ ...x, date: e.target.value ? new Date(e.target.value + 'T00:00').getTime() : undefined, at: undefined })} /></Field>
      <Field label="Place (optional)"><input className={inputCls} list="oroz-places" value={x.placeName ?? ''} onChange={e => { const p = places.find(q => q.name === e.target.value); setX({ ...x, placeName: e.target.value || undefined, placeId: p?.id }); }} /></Field>
    </div>
    <datalist id="oroz-places">{places.map(p => <option key={p.id} value={p.name} />)}</datalist>
    <Field label="Type"><div className="flex flex-wrap gap-1.5">{TYPES.map(k => { const I = TASK_ICON[k]; return <Chip key={k} active={x.type === k} onClick={() => setX({ ...x, type: k })}><I size={13} strokeWidth={1.75} />{k}</Chip>; })}</div></Field>
    <div className="mt-4 flex gap-2">
      <Btn kind="primary" className="flex-1" disabled={!x.title.trim()} onClick={() => { store().upsert('tasks', [x]); onClose(); }}>Save</Btn>
      <Btn kind="danger" aria-label="Delete" onClick={() => { store().checkpoint(); store().remove('tasks', [t.id]); toast('Deleted', { label: 'Undo', run: () => store().undo() }); onClose(); }}><Trash2 size={15} /></Btn>
    </div>
  </Sheet>;
}
