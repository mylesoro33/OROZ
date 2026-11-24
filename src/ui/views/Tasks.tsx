import { useState } from 'react';
import type { Task, Project, StarterItem, LocationTag } from '@engine/types';
import { fmtDay, fmtDur, fmtTime, uid, at, addDays, startOfDay } from '@engine/time';
import { STARTER_LABEL } from '@engine/projects';
import { useApp, store } from '../../data/store';
import * as A from '../../data/actions';
import { Btn, Card, Chip, Section, Sheet, Field, inputCls, cx } from '../ui';
import { toast } from '../toast';

export function Tasks() {
  const [tab, setTab] = useState<'todo' | 'projects'>('todo');
  return <div className="h-full overflow-y-auto px-3 pb-40">
    <div className="mb-3 flex gap-1.5">
      <Chip active={tab === 'todo'} onClick={() => setTab('todo')}>To-do</Chip>
      <Chip active={tab === 'projects'} onClick={() => setTab('projects')}>Projects & starter kits</Chip>
    </div>
    {tab === 'todo' ? <TodoList /> : <Projects />}
  </div>;
}

function TodoList() {
  const tasks = useApp(s => s.tasks);
  const blocks = useApp(s => s.blocks);
  const [edit, setEdit] = useState<Task | null>(null);
  const [showDone, setShowDone] = useState(false);
  const open = tasks.filter(t => !t.done).sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity) || a.priority - b.priority);
  const done = tasks.filter(t => t.done);
  const now = Date.now();
  const nextBlock = (t: Task) => blocks.filter(b => b.taskId === t.id && b.end > now && b.status !== 'done').sort((a, b) => a.start - b.start)[0];
  return <>
    <div className="mb-3 flex gap-2">
      <Btn kind="primary" className="flex-1" onClick={() => { const r = A.runPlan('day'); toast(`Planned today · ${r.unplaced.length} didn't fit`, { label: 'Undo', run: () => store().undo() }); }}>✨ Plan my day</Btn>
      <Btn className="flex-1" onClick={() => { const r = A.runPlan('week'); toast(`Planned the week · ${r.unplaced.length} didn't fit`, { label: 'Undo', run: () => store().undo() }); }}>Plan my week</Btn>
      <Btn onClick={() => setEdit({ id: uid('task'), title: '', durationMin: 30, priority: 2, createdAt: now })}>＋</Btn>
    </div>
    <div className="space-y-2">{open.map(t => {
      const nb = nextBlock(t);
      return <Card key={t.id} className="flex items-start gap-3 p-2.5">
        <button aria-label="Mark done" onClick={() => { store().upsert('tasks', [{ ...t, done: true }]); store().log({ action: 'completed', key: t.needsFocus ? 'task:focus' : 'task', focus: t.needsFocus }); toast('Done ✓', { label: 'Undo', run: () => store().upsert('tasks', [{ ...t, done: false }]) }); }}
          className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-slate-300 dark:border-white/30" />
        <button className="min-w-0 flex-1 text-left" onClick={() => setEdit(t)}>
          <div className="font-medium"><span className={cx('mr-1.5 inline-block h-2 w-2 rounded-full', t.priority === 1 ? 'bg-rose-500' : t.priority === 2 ? 'bg-amber-400' : 'bg-slate-300')} />{t.title}</div>
          <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-500">
            <span>⏱ {fmtDur(t.durationMin)}</span>
            {t.due && <span className={t.due < now ? 'text-rose-600' : ''}>📅 {fmtDay(t.due, now)} {fmtTime(t.due)}</span>}
            {t.location && t.location !== 'anywhere' && <span>📍 {t.location}</span>}
            {t.needsFocus && <span>🎯 focus</span>}
            {t.subtasks?.length ? <span>☑ {t.subtasks.filter(s => s.done).length}/{t.subtasks.length}</span> : null}
          </div>
          <div className="mt-0.5 text-xs text-indigo-600 dark:text-indigo-300">{nb ? `Scheduled ${fmtDay(nb.start, now)} ${fmtTime(nb.start)} — ${nb.reason ?? ''}` : 'Not scheduled yet'}</div>
        </button>
      </Card>;
    })}</div>
    {done.length > 0 && <button className="mt-4 text-xs text-slate-500 underline" onClick={() => setShowDone(!showDone)}>{showDone ? 'Hide' : 'Show'} {done.length} done</button>}
    {showDone && <div className="mt-2 space-y-1">{done.map(t => <div key={t.id} className="flex items-center justify-between text-sm text-slate-400 line-through"><span>{t.title}</span><button className="text-xs no-underline" onClick={() => store().upsert('tasks', [{ ...t, done: false }])}>restore</button></div>)}</div>}
    <TaskSheet task={edit} onClose={() => setEdit(null)} />
  </>;
}

function TaskSheet({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const [t, setT] = useState<Task | null>(task);
  const [sub, setSub] = useState('');
  if (task && (!t || t.id !== task.id)) setT(task);
  if (!task || !t) return null;
  const set = (p: Partial<Task>) => setT({ ...t, ...p });
  const save = () => { if (!t.title.trim()) return onClose(); store().upsert('tasks', [t]); A.placeTasks([t]); toast('Saved & scheduled'); onClose(); };
  const locs: LocationTag[] = ['anywhere', 'home', 'school', 'quiet', 'gym', 'outside'];
  const toLocal = (ms?: number) => (ms ? new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
  return <Sheet open onClose={onClose} title={task.title ? 'Edit task' : 'New task'}>
    <Field label="Title"><input className={inputCls} value={t.title} onChange={e => set({ title: e.target.value })} autoFocus /></Field>
    <Field label="Estimated duration"><div className="flex flex-wrap gap-1.5">{[10, 15, 30, 45, 60, 90, 120, 180].map(d => <Chip key={d} active={t.durationMin === d} onClick={() => set({ durationMin: d })}>{fmtDur(d)}</Chip>)}</div></Field>
    <Field label="Due"><input type="datetime-local" className={inputCls} value={toLocal(t.due)} onChange={e => set({ due: e.target.value ? new Date(e.target.value).getTime() : undefined })} /></Field>
    <div className="flex flex-wrap gap-1.5 py-1">{[at(addDays(startOfDay(Date.now()), 1), '08:00'), at(addDays(startOfDay(Date.now()), 2), '08:00'), at(addDays(startOfDay(Date.now()), 7), '08:00')].map((d, i) => <Chip key={d} onClick={() => set({ due: d })}>{['Tomorrow', 'In 2 days', 'Next week'][i]}</Chip>)}</div>
    <Field label="Priority"><div className="flex gap-1.5">{([1, 2, 3] as const).map(p => <Chip key={p} active={t.priority === p} onClick={() => set({ priority: p })}>{['', 'High', 'Medium', 'Low'][p]}</Chip>)}</div></Field>
    <Field label="Where can you do it?"><div className="flex flex-wrap gap-1.5">{locs.map(l => <Chip key={l} active={(t.location ?? 'anywhere') === l} onClick={() => set({ location: l })}>{l}</Chip>)}</div></Field>
    <div className="flex gap-1.5 py-1"><Chip active={!!t.needsFocus} onClick={() => set({ needsFocus: !t.needsFocus })}>🎯 Needs focus</Chip><Chip active={t.chunkable ?? t.durationMin > 60} onClick={() => set({ chunkable: !(t.chunkable ?? t.durationMin > 60) })}>✂ Can split</Chip></div>
    <Field label="Subtasks">
      {(t.subtasks ?? []).map(s => <label key={s.id} className="flex items-center gap-2 py-0.5 text-sm"><input type="checkbox" checked={s.done} onChange={() => set({ subtasks: t.subtasks!.map(x => (x.id === s.id ? { ...x, done: !x.done } : x)) })} />{s.title}</label>)}
      <input className={inputCls} placeholder="Add subtask + Enter" value={sub} onChange={e => setSub(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && sub.trim()) { set({ subtasks: [...(t.subtasks ?? []), { id: uid('st'), title: sub.trim(), done: false }] }); setSub(''); } }} />
    </Field>
    <div className="mt-3 flex gap-2"><Btn kind="primary" className="flex-1" onClick={save}>Save</Btn>{task.title && <Btn kind="danger" onClick={() => { store().remove('tasks', [t.id]); store().commitBlocks(store().state.blocks.filter(b => b.taskId !== t.id)); onClose(); }}>Delete</Btn>}</div>
  </Sheet>;
}

function Projects() {
  const projects = useApp(s => s.projects);
  const tasks = useApp(s => s.tasks);
  const [open, setOpen] = useState<string | null>(projects[0]?.id ?? null);
  const [adding, setAdding] = useState(false);
  const now = Date.now();
  return <>
    <Btn className="mb-3 w-full" onClick={() => setAdding(true)}>＋ Add an assignment manually</Btn>
    <p className="mb-3 text-xs text-slate-500">Assignments from Google Classroom, Canvas or Schoology feeds (Settings → Connections) show up here automatically.</p>
    <div className="space-y-3">{projects.sort((a, b) => a.due - b.due).map(p => <Card key={p.id}>
      <button className="w-full text-left" onClick={() => setOpen(open === p.id ? null : p.id)}>
        <div className="flex items-start justify-between gap-2"><div className="font-semibold">{p.title}</div><span className="shrink-0 text-xs text-slate-500">due {fmtDay(p.due, now)}</span></div>
        <div className="text-xs text-slate-500">{p.course ?? 'No course'} · ~{fmtDur(p.effortMin)} total · {p.source}</div>
      </button>
      {p.warnings?.map(w => <div key={w} className="mt-1.5 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">⚠ {w}</div>)}
      {open === p.id && <>
        <div className="mt-3 space-y-1">{p.milestones.map(m => { const t = tasks.find(x => x.id === m.taskId); return <div key={m.id} className="flex items-center gap-2 text-sm">
          <span className={cx('h-2 w-2 rounded-full', t?.done ? 'bg-emerald-500' : 'bg-fuchsia-500')} /><span className={cx('flex-1', t?.done && 'line-through opacity-60')}>{m.title.split(':')[0]}</span><span className="text-xs text-slate-500">{fmtDur(m.durationMin)} · by {fmtDay(m.due, now)}</span>
        </div>; })}</div>
        <StarterKitView p={p} />
      </>}
    </Card>)}</div>
    <AddProject open={adding} onClose={() => setAdding(false)} />
  </>;
}

function StarterKitView({ p }: { p: Project }) {
  const [editing, setEditing] = useState<string | null>(null);
  if (!p.starterKit) return <div className="mt-3 rounded-xl bg-slate-100 p-3 text-sm dark:bg-white/5">Preparing a starter kit in the background… <Btn className="ml-2 px-2 py-1 text-xs" onClick={() => A.ensureStarterKit(p.id)}>Make it now</Btn></div>;
  const kit = p.starterKit;
  const sections: [keyof typeof kit, string][] = [['breakdown', 'Task breakdown'], ['outline', 'Outline / skeleton'], ['questions', 'Questions to answer'], ['sources', 'Sources to look up'], ['scaffold', 'Rough-draft scaffold']];
  const update = (key: string, idx: number, body: string) => {
    const k = { ...kit, [key]: (kit[key as 'outline'] as StarterItem[]).map((x, i) => (i === idx ? { ...x, body } : x)) };
    store().upsert('projects', [{ ...p, starterKit: k }]);
  };
  return <div className="mt-3 rounded-2xl border border-dashed border-amber-400 bg-amber-50/60 p-3 dark:bg-amber-500/5">
    <div className="mb-2 flex items-center justify-between gap-2">
      <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-amber-950">🧰 {STARTER_LABEL}</span>
      <Btn kind="ghost" className="px-2 py-1 text-xs" onClick={() => { A.ensureStarterKit(p.id, true); toast('Regenerating…'); }}>↻</Btn>
    </div>
    <p className="mb-2 text-xs text-slate-600 dark:text-slate-400">A head start, not a finished product. Rewrite everything in your own words before you hand anything in. Generated {kit.generator === 'llm' ? 'with the optional AI helper' : 'offline from templates'}.</p>
    {sections.map(([key, label]) => (kit[key] as StarterItem[]).map((item, i) => <details key={`${key}${i}`} className="border-t border-amber-200/70 py-1.5 dark:border-white/10" open={key === 'breakdown'}>
      <summary className="cursor-pointer text-sm font-semibold">{label}{(kit[key] as StarterItem[]).length > 1 ? ` · ${item.label}` : ''} <span className="text-[10px] font-normal text-amber-700">starter</span></summary>
      {editing === `${key}${i}`
        ? <textarea className={cx(inputCls, 'mt-1 h-48 font-mono text-xs')} defaultValue={item.body} onBlur={e => { update(key, i, e.target.value); setEditing(null); }} autoFocus />
        : <pre onClick={() => setEditing(`${key}${i}`)} className="mt-1 whitespace-pre-wrap break-words font-sans text-sm text-slate-700 dark:text-slate-300">{linkify(item.body)}</pre>}
      <div className="mt-1 flex gap-2 text-xs"><button className="text-indigo-600" onClick={() => setEditing(`${key}${i}`)}>Edit</button><button className="text-indigo-600" onClick={() => { navigator.clipboard?.writeText(item.body); toast('Copied'); }}>Copy</button></div>
    </details>))}
  </div>;
}
function linkify(s: string) { return s.split(/(https?:\/\/\S+)/g).map((part, i) => (part.startsWith('http') ? <a key={i} href={part} target="_blank" rel="noreferrer" className="text-indigo-600 underline" onClick={e => e.stopPropagation()}>{new URL(part).hostname}</a> : part)); }

function AddProject({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState(''); const [course, setCourse] = useState(''); const [due, setDue] = useState(''); const [desc, setDesc] = useState('');
  return <Sheet open={open} onClose={onClose} title="New assignment">
    <Field label="Title"><input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Physics lab report" /></Field>
    <Field label="Course"><input className={inputCls} value={course} onChange={e => setCourse(e.target.value)} /></Field>
    <Field label="Due"><input type="datetime-local" className={inputCls} value={due} onChange={e => setDue(e.target.value)} /></Field>
    <Field label="Instructions (optional — helps the starter kit)"><textarea className={cx(inputCls, 'h-20')} value={desc} onChange={e => setDesc(e.target.value)} /></Field>
    <Btn kind="primary" className="mt-2 w-full" disabled={!title || !due} onClick={() => { A.createProject({ title, course: course || undefined, due: new Date(due).getTime(), description: desc || undefined, source: 'manual' }); toast('Project created — milestones scheduled, starter kit on the way'); onClose(); setTitle(''); setDue(''); setDesc(''); }}>Create with milestones</Btn>
  </Sheet>;
}
