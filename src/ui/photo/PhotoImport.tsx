import { useEffect, useMemo, useState } from 'react';
import { Camera, ImagePlus, X, Plus, Trash2, AlertCircle, Copy, Link2, ZoomIn, ZoomOut } from 'lucide-react';
import { rowsFromScan, questionsFor, defaultAnswers, markDuplicates, toBlocks, learnRoutine, setRotationLabels, describeDays, occurrences, type Scan, type Answers, type Row, type Routine } from '@engine/scan';
import { fmtTime, fmtDay, at, fromIsoDay, startOfDay, hm, parseHM, uid } from '@engine/time';
import { useApp, store } from '../../data/store';
import { readImages, readLink, tooSmall, shrink } from '../../ai/scanner';
import { useNav, go, pickPhotos, type PhotoJob } from '../nav';
import { Btn, Chip, Field, Sheet, inputCls, cx } from '../ui';
import { toast } from '../toast';

type Stage = 'pages' | 'reading' | 'unreadable' | 'questions' | 'review' | 'done';
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function PhotoImport() {
  const nav = useNav();
  if (!nav.photo) return null;
  return <Flow key={nav.photo.link ?? nav.photo.from} job={nav.photo} />;
}

function Flow({ job }: { job: PhotoJob }) {
  const hasKey = useApp(s => !!s.settings.apiKey);
  const blocks = useApp(s => s.blocks);
  const files = job.files ?? [];
  const urls = useMemo(() => files.map(f => URL.createObjectURL(f)), [files]);
  useEffect(() => () => urls.forEach(URL.revokeObjectURL), [urls]);
  const [stage, setStage] = useState<Stage>(job.link ? 'reading' : 'pages');
  const [status, setStatus] = useState('');
  const [scan, setScan] = useState<Scan | null>(null);
  const [answers, setAnswers] = useState<Answers | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [error, setError] = useState('');
  const [link, setLink] = useState('');
  const [small, setSmall] = useState(false);
  const [added, setAdded] = useState<{ count: number; seriesIds: string[]; routine?: Routine } | null>(null);
  const close = () => go({ photo: null });

  useEffect(() => { Promise.all(files.map(tooSmall)).then(r => setSmall(r.some(Boolean))).catch(() => {}); }, [files]);
  // Uploads (often several screenshots) start reading right away; camera shots let you add another page first.
  useEffect(() => { if (job.link) void read(); else if (job.from === 'upload' && files.length && stage === 'pages') void read(); }, []);

  async function read() {
    if (!hasKey && !job.link) { setError('Reading photos needs your Claude key (Settings → Preferences).'); return; }
    setStage('reading'); setError('');
    try {
      const s = job.link ? await readLink(job.link, setStatus) : await readImages(files, setStatus);
      setScan(s);
      if (s.readable === 'unreadable' || !s.items.length) { setStage('unreadable'); return; }
      setRotationLabels(s.rotation_labels);
      const a = defaultAnswers(s, Date.now());
      setAnswers(a);
      setRows(markDuplicates(rowsFromScan(s), a, blocks));
      setStage(questionsFor(s).some(q => q !== 'dates') ? 'questions' : 'review');
    } catch (e) {
      const m = String((e as Error).message ?? e);
      setError(m === 'NO_KEY' ? 'Reading web pages needs your Claude key (Settings → Preferences). Calendar links work without one.' : /401|auth/i.test(m) ? "That Claude key didn't work. Check Settings." : /fetch|network/i.test(m) ? "Can't reach the internet right now." : m.slice(0, 160));
      setStage(job.link ? 'unreadable' : 'pages');
    }
  }
  const updateAnswers = (patch: Partial<Answers>) => { const a = { ...answers!, ...patch }; setAnswers(a); setRows(r => markDuplicates(r.map(x => ({ ...x, include: x.duplicate ? true : x.include })), a, blocks)); };

  const confirm = () => {
    const newBlocks = toBlocks(rows, answers!);
    store().checkpoint();
    store().upsert('blocks', newBlocks);
    const seriesIds = [...new Set(newBlocks.map(b => b.seriesId!).filter(Boolean))];
    setAdded({ count: newBlocks.length, seriesIds, routine: learnRoutine(rows, answers!) });
    setStage('done');
  };

  return <div className="fixed inset-0 z-[55] flex flex-col bg-paper safe-top safe-bottom">
    <div className="flex items-center justify-between px-5 pb-2 pt-4">
      <h1 className="text-xl font-semibold">{stage === 'review' ? 'Looks right?' : stage === 'done' ? 'Added' : job.link ? 'Add from link' : 'Add from photo'}</h1>
      <button aria-label="Close" className="p-1.5 text-muted" onClick={close}><X size={20} /></button>
    </div>

    {stage === 'pages' && <div className="flex flex-1 flex-col overflow-y-auto px-5 pb-6">
      {files.length ? <>
        <div className="grid grid-cols-3 gap-2">{urls.map((u, i) => <img key={u} src={u} alt={`Page ${i + 1}`} className="aspect-[3/4] w-full rounded-lg border border-line object-cover" />)}
          <button onClick={() => pickPhotos(job.from === 'camera' ? 'camera' : 'upload')} className="flex aspect-[3/4] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-xs text-muted"><Plus size={18} />Add a page</button></div>
        {small && <p className="mt-3 text-sm text-clay">This photo is small. If it's hard to read, retake it closer.</p>}
        {error && <p className="mt-3 text-sm text-clay">{error}</p>}
        <div className="flex-1" />
        <Btn kind="primary" className="mt-6 w-full py-3 text-base" onClick={read}>Read schedule</Btn>
      </> : <Picker link={link} setLink={setLink} onLink={() => go({ photo: { link, from: 'link' } })} />}
    </div>}

    {stage === 'reading' && <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
      {urls[0] && <img src={urls[0]} alt="" className="max-h-56 rounded-lg border border-line opacity-80" />}
      <p className="serif text-lg">{status || 'Reading…'}</p>
      <p className="text-sm text-muted">Your photo is only used to read the schedule.</p>
    </div>}

    {stage === 'unreadable' && <div className="flex flex-1 flex-col px-5 pb-6">
      <div className="mt-6 flex gap-3 rounded-xl border border-line bg-card p-4"><AlertCircle size={20} className="mt-0.5 shrink-0 text-clay" />
        <div><p className="text-sm font-medium">{error || "I couldn't read this."}</p>
          {scan?.problems.length ? <ul className="mt-1 list-disc pl-4 text-sm text-muted">{scan.problems.map(p => <li key={p}>{p}</li>)}</ul> : null}
          {!job.link && <p className="mt-2 text-sm text-muted">Try again with the whole schedule in frame, flat, and in good light.</p>}</div></div>
      <div className="flex-1" />
      {!job.link ? <div className="grid gap-2"><Btn kind="primary" className="py-3" onClick={() => { go({ photo: null }); pickPhotos('camera'); }}><Camera size={18} />Retake</Btn><Btn onClick={() => { go({ photo: null }); pickPhotos('upload'); }}><ImagePlus size={18} />Choose another</Btn></div>
        : <Btn onClick={close}>Close</Btn>}
    </div>}

    {stage === 'questions' && scan && answers && <Questions scan={scan} a={answers} onChange={updateAnswers} onDone={() => setStage('review')} />}

    {stage === 'review' && scan && answers && <Review urls={urls} scan={scan} a={answers} rows={rows} setRows={setRows} onEdit={setEdit} onAnswers={updateAnswers} onConfirm={confirm} onRetake={() => { go({ photo: null }); pickPhotos('camera'); }} />}

    {stage === 'done' && added && <Done added={added} files={files} title={scan?.kind === 'work' ? 'Work schedule' : scan?.kind === 'classes' ? 'Class schedule' : 'Schedule'} onClose={close} />}

    {edit && answers && <RowSheet row={edit} a={answers} labels={scan?.rotation_labels ?? []} onClose={() => setEdit(null)}
      onSave={r => { setRows(rs => (rs.some(x => x.id === r.id) ? rs.map(x => (x.id === r.id ? r : x)) : [...rs, r])); setEdit(null); }}
      onRemove={id => { setRows(rs => rs.filter(x => x.id !== id)); setEdit(null); }} />}
  </div>;
}

function Picker({ link, setLink, onLink }: { link: string; setLink: (s: string) => void; onLink: () => void }) {
  return <div className="flex flex-1 flex-col justify-center gap-3">
    <p className="mb-2 text-sm text-muted">Class, shift, practice or bell schedules. Printed, handwritten, or a screenshot.</p>
    <Btn kind="primary" className="py-4 text-base" onClick={() => pickPhotos('camera')}><Camera size={20} />Take a photo</Btn>
    <Btn className="py-4 text-base" onClick={() => pickPhotos('upload')}><ImagePlus size={20} />Choose photos or screenshots</Btn>
    <form className="mt-4 flex gap-2" onSubmit={e => { e.preventDefault(); if (link.trim()) onLink(); }}>
      <input className={inputCls} value={link} onChange={e => setLink(e.target.value)} placeholder="Or paste a link" inputMode="url" aria-label="Schedule link" />
      <Btn type="submit" aria-label="Open link" disabled={!link.trim()}><Link2 size={16} /></Btn>
    </form>
  </div>;
}

function Questions({ scan, a, onChange, onDone }: { scan: Scan; a: Answers; onChange: (p: Partial<Answers>) => void; onDone: () => void }) {
  const q = questionsFor(scan);
  return <div className="flex flex-1 flex-col overflow-y-auto px-5 pb-6">
    <p className="mb-4 text-sm text-muted">A couple of quick questions.</p>
    {q.includes('pattern') && <Field label="Is this weekly, or does it rotate?"><div className="flex flex-wrap gap-1.5">
      {([['weekly', 'Same every week'], ['rotating', 'Rotates (A/B, Day 1/2)'], ['dated', 'Specific dates']] as const).map(([k, l]) => <Chip key={k} active={a.pattern === k} onClick={() => onChange({ pattern: k })} className="px-3 py-1.5 text-sm">{l}</Chip>)}</div></Field>}
    {q.includes('rotation') && a.pattern === 'rotating' && scan.rotation_labels.length > 0 && <Field label={`What day is ${fmtDay(fromIsoDay(a.start), Date.now())}?`}><div className="flex flex-wrap gap-1.5">
      {scan.rotation_labels.map(l => <Chip key={l} active={a.rotationToday === l} onClick={() => onChange({ rotationToday: l })} className="px-3 py-1.5 text-sm">{l} day</Chip>)}</div></Field>}
    {a.pattern !== 'dated' && <Field label="When does it start and end?"><div className="grid grid-cols-2 gap-2">
      <input type="date" className={inputCls} value={a.start} onChange={e => onChange({ start: e.target.value })} aria-label="Starts" />
      <input type="date" className={inputCls} value={a.end} onChange={e => onChange({ end: e.target.value })} aria-label="Ends" /></div></Field>}
    {q.includes('who') && <Field label={`Is this for you${scan.person ? `, or for ${scan.person}` : ''}?`}><div className="flex flex-wrap gap-1.5">
      <Chip active={a.who === 'me'} onClick={() => onChange({ who: 'me' })} className="px-3 py-1.5 text-sm">Me</Chip>
      <Chip active={a.who === 'other'} onClick={() => onChange({ who: 'other' })} className="px-3 py-1.5 text-sm">{scan.person ?? 'Someone else'}</Chip></div>
      {a.who === 'other' && <input className={cx(inputCls, 'mt-2')} value={a.otherName ?? ''} onChange={e => onChange({ otherName: e.target.value })} placeholder="Their name" />}</Field>}
    <div className="flex-1" />
    <Btn kind="primary" className="mt-6 w-full py-3 text-base" onClick={onDone}>Next</Btn>
  </div>;
}

function Review({ urls, scan, a, rows, setRows, onEdit, onAnswers, onConfirm, onRetake }: { urls: string[]; scan: Scan; a: Answers; rows: Row[]; setRows: (f: (r: Row[]) => Row[]) => void; onEdit: (r: Row) => void; onAnswers: (p: Partial<Answers>) => void; onConfirm: () => void; onRetake: () => void }) {
  const [zoom, setZoom] = useState(false);
  const [page, setPage] = useState(0);
  const [dates, setDates] = useState(false);
  const total = rows.filter(r => r.include).reduce((n, r) => n + occurrences(r, a).length, 0);
  const dups = rows.filter(r => r.duplicate).length;
  const when = (r: Row) => r.date ? fmtDay(fromIsoDay(r.date)) : r.rotation ? `${r.rotation} days` : describeDays(r.days) || 'No day';
  return <div className="flex min-h-0 flex-1 flex-col sm:flex-row sm:gap-4 sm:px-5">
    {urls.length > 0 && <div className="relative h-[34vh] shrink-0 overflow-auto border-y border-line bg-linen sm:h-auto sm:w-1/2 sm:rounded-xl sm:border">
      <img src={urls[page]} alt="Your schedule" className={cx('mx-auto', zoom ? 'max-w-none w-[220%]' : 'h-full w-full object-contain')} />
      <div className="sticky bottom-2 left-2 flex w-max gap-1 pl-2">
        <button aria-label={zoom ? 'Zoom out' : 'Zoom in'} onClick={() => setZoom(!zoom)} className="rounded-md bg-card/90 p-1.5 shadow-sm">{zoom ? <ZoomOut size={16} /> : <ZoomIn size={16} />}</button>
        {urls.length > 1 && urls.map((_, i) => <button key={i} onClick={() => setPage(i)} className={cx('rounded-md px-2 text-xs shadow-sm', i === page ? 'bg-ink text-paper' : 'bg-card/90')}>{i + 1}</button>)}
      </div>
    </div>}
    <div className="flex min-h-0 flex-1 flex-col px-5 sm:px-0">
      <button onClick={() => setDates(!dates)} className="mt-3 text-left text-sm text-muted">{a.pattern === 'dated' ? 'Specific dates' : `${fmtDay(fromIsoDay(a.start))} – ${fmtDay(fromIsoDay(a.end))}`}{a.who === 'other' && a.otherName ? ` · for ${a.otherName}` : ''} · <span className="text-green underline underline-offset-2">change</span></button>
      {dates && <div className="mt-2 grid grid-cols-2 gap-2"><input type="date" className={inputCls} value={a.start} onChange={e => onAnswers({ start: e.target.value })} aria-label="Starts" /><input type="date" className={inputCls} value={a.end} onChange={e => onAnswers({ end: e.target.value })} aria-label="Ends" /></div>}
      <ul className="mt-3 min-h-0 flex-1 divide-y divide-line overflow-y-auto rounded-xl border border-line bg-card">
        {rows.map(r => <li key={r.id} className={cx('flex items-start gap-3 px-3 py-2.5', r.flags.some(f => !/already on your calendar/i.test(f)) && 'border-l-[3px] border-l-brass', !r.include && 'opacity-50')}>
          <input type="checkbox" checked={r.include} aria-label={`Include ${r.title}`} onChange={() => setRows(rs => rs.map(x => (x.id === r.id ? { ...x, include: !x.include } : x)))} className="mt-1 h-4 w-4 accent-[var(--green)]" />
          <button className="min-w-0 flex-1 text-left" onClick={() => onEdit(r)}>
            <span className="block truncate text-sm font-medium">{r.title}</span>
            <span className="block text-xs text-muted">{when(r)} · {fmtTime(at(0, r.start))}–{fmtTime(at(0, r.end))}{r.location ? ` · ${r.location}` : ''}</span>
            {r.flags.map(f => { const dup = /already on your calendar/i.test(f); return <span key={f} className={cx('mt-0.5 flex items-center gap-1 text-xs', dup ? 'text-muted' : 'text-clay')}>{dup ? <Copy size={11} /> : <AlertCircle size={11} />}{f}</span>; })}
          </button>
        </li>)}
        <li><button onClick={() => onEdit({ id: uid('row'), title: '', kind: rows[0]?.kind ?? 'event', days: [], start: '09:00', end: '10:00', flags: [], include: true })} className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-green"><Plus size={15} />Add one that's missing</button></li>
      </ul>
      {(scan.missed.length > 0 || (scan.readable === 'partial' && scan.problems.length > 0)) && <div className="mt-2 rounded-lg bg-brass-soft/60 px-3 py-2 text-xs">
        Couldn't read: {[...scan.missed, ...scan.problems].join('; ')}. {urls.length > 0 && <button className="underline" onClick={onRetake}>Retake</button>}
      </div>}
      {dups > 0 && <p className="mt-2 text-xs text-muted">{dups} already on your calendar, skipped.</p>}
      <Btn kind="primary" className="my-3 w-full py-3 text-base" disabled={!total} onClick={onConfirm}>Confirm{total ? ` · ${total} event${total === 1 ? '' : 's'}` : ''}</Btn>
    </div>
  </div>;
}

function RowSheet({ row, a, labels, onClose, onSave, onRemove }: { row: Row; a: Answers; labels: string[]; onClose: () => void; onSave: (r: Row) => void; onRemove: (id: string) => void }) {
  const [x, setX] = useState(row);
  const isNew = !row.title;
  const valid = x.title.trim() && parseHM(x.end) > parseHM(x.start) && (x.date || x.rotation || x.days.length);
  return <Sheet open onClose={onClose} title={isNew ? 'Add one' : 'Fix this one'}>
    <Field label="Title"><input autoFocus={isNew} className={inputCls} value={x.title} onChange={e => setX({ ...x, title: e.target.value })} /></Field>
    {x.date ? <Field label="Date"><input type="date" className={inputCls} value={x.date} onChange={e => setX({ ...x, date: e.target.value })} /></Field>
      : a.pattern === 'rotating' && labels.length ? <Field label="Day"><div className="flex flex-wrap gap-1.5">{labels.map(l => <Chip key={l} active={x.rotation === l} onClick={() => setX({ ...x, rotation: l })}>{l}</Chip>)}</div></Field>
      : <Field label="Days"><div className="flex gap-1">{DAYS.map((d, i) => <Chip key={i} className="w-9 justify-center" active={x.days.includes(i)} onClick={() => setX({ ...x, days: x.days.includes(i) ? x.days.filter(y => y !== i) : [...x.days, i].sort() })}>{d}</Chip>)}</div></Field>}
    <div className="grid grid-cols-2 gap-2">
      <Field label="Start"><input type="time" className={inputCls} value={x.start} onChange={e => setX({ ...x, start: e.target.value })} /></Field>
      <Field label="End"><input type="time" className={inputCls} value={x.end} onChange={e => setX({ ...x, end: e.target.value })} /></Field>
    </div>
    <Field label="Place (optional)"><input className={inputCls} value={x.location ?? ''} onChange={e => setX({ ...x, location: e.target.value || undefined })} /></Field>
    <div className="mt-4 flex gap-2">
      <Btn kind="primary" className="flex-1" disabled={!valid} onClick={() => onSave({ ...x, title: x.title.trim(), include: true, flags: x.flags.filter(f => f.endsWith('already on your calendar') || f === 'Already on your calendar') })}>Save</Btn>
      {!isNew && <Btn kind="danger" aria-label="Remove" onClick={() => onRemove(x.id)}><Trash2 size={15} /></Btn>}
    </div>
  </Sheet>;
}

function Done({ added, files, title, onClose }: { added: { count: number; seriesIds: string[]; routine?: Routine }; files: File[]; title: string; onClose: () => void }) {
  const r = added.routine;
  const [saveHours, setSaveHours] = useState(true);
  const [saveLunch, setSaveLunch] = useState(!!r?.lunch);
  const [keep, setKeep] = useState(false);
  const [undone, setUndone] = useState(false);
  const finish = async () => {
    const s = store();
    if (r && !undone) {
      if (saveHours) { s.set('settings', { ...s.state.settings, workDays: r.days }); s.remember(`Usual ${r.label.toLowerCase()} hours: ${describeDays(r.days)}, ${fmtTime(at(0, r.from))}–${fmtTime(at(0, r.to))}`, 'routine'); }
      if (saveLunch && r.lunch) s.set('settings', { ...s.state.settings, meals: s.state.settings.meals.map(m => (m.type === 'lunch' ? { ...m, from: r.lunch!.from, to: r.lunch!.to } : m)) });
    }
    if (keep && files.length && !undone) {
      const dataUrl = 'data:image/jpeg;base64,' + await shrink(files[0]);
      s.upsert('photos', [{ id: uid('photo'), at: Date.now(), title, dataUrl, seriesIds: added.seriesIds }]);
    }
    onClose();
  };
  return <div className="flex flex-1 flex-col px-5 pb-6">
    <p className="serif mt-2 text-2xl">{undone ? 'Undone.' : `${added.count} events added.`}</p>
    {!undone && <button className="mt-1 self-start text-sm text-green underline underline-offset-2" onClick={() => { store().undo(); setUndone(true); toast('Undone'); }}>Undo</button>}
    {r && !undone && <div className="mt-6 rounded-xl border border-line bg-card p-4">
      <p className="mb-2 text-sm font-medium">Save to your Profile?</p>
      <label className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" checked={saveHours} onChange={e => setSaveHours(e.target.checked)} className="accent-[var(--green)]" />{r.label} {describeDays(r.days)}, {r.label === 'Work' ? 'usually ' : ''}{fmtTime(at(0, r.from))}–{fmtTime(at(0, r.to))}</label>
      {r.lunch && <label className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" checked={saveLunch} onChange={e => setSaveLunch(e.target.checked)} className="accent-[var(--green)]" />Lunch around {fmtTime(at(0, r.lunch.from))}–{fmtTime(at(0, r.lunch.to))}</label>}
    </div>}
    {files.length > 0 && !undone && <div className="mt-3 rounded-xl border border-line bg-card p-4">
      <p className="mb-2 text-sm font-medium">The photo</p>
      <div className="flex gap-1.5"><Chip active={!keep} onClick={() => setKeep(false)}>Delete it</Chip><Chip active={keep} onClick={() => setKeep(true)}>Keep a copy</Chip></div>
      <p className="mt-2 text-xs text-muted">{keep ? 'Saved on this device only. Remove it any time in Settings.' : 'Removed from OROZ when you tap Done.'}</p>
    </div>}
    <div className="flex-1" />
    <Btn kind="primary" className="mt-6 w-full py-3 text-base" onClick={finish}>Done</Btn>
  </div>;
}
export const _p = { startOfDay, hm };
