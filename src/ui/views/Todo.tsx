import { useState } from 'react';
import { Check, ChevronDown, ListTodo, Trash2 } from 'lucide-react';
import type { Task, TaskType } from '@engine/types';
import { parseCapture, captureDue } from '@engine/parser';
import { addDays, startOfDay, fmtDay, fmtTime, isoDay, uid } from '@engine/time';
import { useApp, store } from '../../data/store';
import { labelFor } from '../../chat/tools';
import { go } from '../nav';
import { Btn, Chip, Sheet, Field, inputCls, TASK_ICON, Empty, cx } from '../ui';
import { toast } from '../toast';

const TYPES: TaskType[] = ['school', 'work', 'personal', 'errand', 'event'];
const guessType = (t: string): TaskType => /study|test|quiz|essay|lab|homework|hw|read|report|project|worksheet/i.test(t) ? 'school' : /buy|pick up|return|groceries|store/i.test(t) ? 'errand' : /shift|work/i.test(t) ? 'work' : 'personal';

export function Todo() {
  const tasks = useApp(s => s.tasks);
  const [text, setText] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [edit, setEdit] = useState<Task | null>(null);
  const now = Date.now(); const end = addDays(startOfDay(now), 1);
  const open = tasks.filter(t => !t.done).sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity) || a.createdAt - b.createdAt);
  const today = open.filter(t => t.due !== undefined && t.due < end);
  const upcoming = open.filter(t => t.due === undefined || t.due >= end);
  const done = tasks.filter(t => t.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));

  const add = () => {
    const raw = text.trim(); if (!raw) return;
    const tag = raw.match(/#([\w-]+)/)?.[1];
    const c = parseCapture(raw.replace(/#[\w-]+/, '').trim(), { now });
    const title = c.kind === 'task' || c.kind === 'reminder' ? c.title : raw.replace(/#[\w-]+/, '').trim();
    store().upsert('tasks', [{ id: uid('task'), title, due: c.day !== undefined ? captureDue(c) : undefined, tag, type: guessType(title), done: false, source: 'manual', createdAt: now }]);
    setText('');
  };
  const toggle = (t: Task) => {
    store().checkpoint();
    store().upsert('tasks', [{ ...t, done: !t.done, doneAt: t.done ? undefined : Date.now() }]);
    if (!t.done) toast('Done', { label: 'Undo', run: () => store().undo() });
  };

  return <div className="h-full overflow-y-auto px-5 pb-28">
    <h1 className="mb-4 text-2xl font-semibold">To-Do</h1>
    <form onSubmit={e => { e.preventDefault(); add(); }} className="mb-5">
      <input value={text} onChange={e => setText(e.target.value)} className={inputCls} placeholder="Add a task — try “bio lab fri #biology”" aria-label="Add a task" enterKeyHint="done" />
    </form>
    {!open.length && !done.length ? <Empty icon={ListTodo} text="Nothing to do yet. Type above, ask OROZ, or bring in assignments." action={<Btn onClick={() => go({ tab: 'settings', settingsFocus: 'connections' })}>Import from Classroom or Schoology</Btn>} /> : <>
      <Group title="Today" tasks={today} onToggle={toggle} onEdit={setEdit} empty="Nothing due today." />
      <Group title="Upcoming" tasks={upcoming} onToggle={toggle} onEdit={setEdit} />
      {done.length > 0 && <>
        <button onClick={() => setShowDone(!showDone)} className="mt-6 flex items-center gap-1 text-sm text-muted">Done · {done.length}<ChevronDown size={14} className={showDone ? 'rotate-180' : ''} /></button>
        {showDone && <ul className="mt-2">{done.slice(0, 30).map(t => <Row key={t.id} t={t} onToggle={toggle} onEdit={setEdit} />)}</ul>}
      </>}
    </>}
    {edit && <TaskSheet t={edit} onClose={() => setEdit(null)} />}
  </div>;
}

function Group({ title, tasks, onToggle, onEdit, empty }: { title: string; tasks: Task[]; onToggle: (t: Task) => void; onEdit: (t: Task) => void; empty?: string }) {
  if (!tasks.length && !empty) return null;
  return <section className="mb-5">
    <h2 className="mb-1 text-sm font-semibold text-muted">{title}</h2>
    {tasks.length ? <ul className="divide-y divide-line border-y border-line">{tasks.map(t => <Row key={t.id} t={t} onToggle={onToggle} onEdit={onEdit} />)}</ul> : <p className="py-2 text-sm text-muted">{empty}</p>}
  </section>;
}

function Row({ t, onToggle, onEdit }: { t: Task; onToggle: (t: Task) => void; onEdit: (t: Task) => void }) {
  const I = TASK_ICON[t.type]; const now = Date.now();
  const meta = [t.due !== undefined ? (startOfDay(t.due) === startOfDay(now) ? fmtTime(t.due) : fmtDay(t.due, now)) : '', t.tag].filter(Boolean).join(' · ');
  const overdue = !t.done && t.due !== undefined && t.due < now;
  return <li className="flex items-center gap-3 py-2.5">
    <button aria-label={t.done ? 'Mark not done' : 'Mark done'} onClick={() => onToggle(t)} className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border', t.done ? 'border-green bg-green text-paper' : 'border-muted/60')}>{t.done && <Check size={12} strokeWidth={3} />}</button>
    <button className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => onEdit(t)}>
      <I size={15} strokeWidth={1.6} className="shrink-0 text-muted" aria-label={t.type} />
      <span className={cx('min-w-0 flex-1 truncate text-sm', t.done && 'text-muted line-through')}>{t.title}</span>
      {meta && <span className={cx('shrink-0 text-xs', overdue ? 'text-clay' : 'text-muted')}>{meta}</span>}
    </button>
  </li>;
}

function TaskSheet({ t, onClose }: { t: Task; onClose: () => void }) {
  const [x, setX] = useState(t);
  return <Sheet open onClose={onClose} title="Task">
    <Field label="Task"><input className={inputCls} value={x.title} onChange={e => setX({ ...x, title: e.target.value })} /></Field>
    <div className="grid grid-cols-2 gap-2">
      <Field label="Due"><input type="date" className={inputCls} value={x.due ? isoDay(x.due) : ''} onChange={e => setX({ ...x, due: e.target.value ? new Date(e.target.value + 'T' + (x.type === 'school' ? '08:00' : '23:59')).getTime() : undefined })} /></Field>
      <Field label="Class / tag"><input className={inputCls} value={x.tag ?? ''} onChange={e => setX({ ...x, tag: e.target.value || undefined })} /></Field>
    </div>
    <Field label="Type"><div className="flex flex-wrap gap-1.5">{TYPES.map(k => { const I = TASK_ICON[k]; return <Chip key={k} active={x.type === k} onClick={() => setX({ ...x, type: k })}><I size={13} strokeWidth={1.75} />{k}</Chip>; })}</div></Field>
    {t.source !== 'manual' && <p className="mt-1 text-xs text-muted">From {labelFor(t.source)}</p>}
    <div className="mt-4 flex gap-2">
      <Btn kind="primary" className="flex-1" disabled={!x.title.trim()} onClick={() => { store().upsert('tasks', [x]); onClose(); }}>Save</Btn>
      <Btn kind="danger" aria-label="Delete" onClick={() => { store().checkpoint(); store().remove('tasks', [t.id]); toast('Deleted', { label: 'Undo', run: () => store().undo() }); onClose(); }}><Trash2 size={15} /></Btn>
    </div>
  </Sheet>;
}
