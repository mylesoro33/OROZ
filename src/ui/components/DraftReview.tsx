import { useState } from 'react';
import { Check, ExternalLink } from 'lucide-react';
import { fmtDay, fmtTime, hm, at, startOfDay } from '@engine/time';
import { store, type Draft } from '../../data/store';
import { Btn, cx, inputCls } from '../ui';

interface Row { id: string; label: string; meta: string; time?: number; allDay?: boolean; url?: string; table: 'events' | 'tasks' | 'people' | 'dates' }

/** Show exactly what was found. Fix anything, uncheck anything, then Add. */
export function DraftReview({ draft, onDone, compact }: { draft: Draft; onDone: (added: boolean, d: Draft) => void; compact?: boolean }) {
  const [d, setD] = useState(draft);
  const rows: Row[] = [
    ...d.events.map(e => ({ id: e.id, table: 'events' as const, label: e.title, time: e.start, allDay: e.allDay, meta: e.allDay ? fmtDay(e.start) : `${fmtDay(e.start)} ${fmtTime(e.start)}–${fmtTime(e.end)}${e.location ? ` · ${e.location}` : ''}` })),
    ...d.tasks.map(t => ({ id: t.id, table: 'tasks' as const, label: t.title, time: t.at, meta: ['To-do', t.at ? `${fmtDay(t.at)} ${fmtTime(t.at)}` : t.date ? fmtDay(t.date) : t.by ? 'fit in this week' : 'any time', t.placeName].filter(Boolean).join(' · ') })),
    ...d.people.map(p => ({ id: p.id, table: 'people' as const, label: p.name, meta: p.birthday ? `Birthday ${p.birthday.month}/${p.birthday.day}` : 'No birthday found' })),
    ...d.dates.map(x => ({ id: x.id, table: 'dates' as const, label: x.title, meta: fmtDay(x.start), url: x.sourceUrl, allDay: true })),
  ];
  const [keep, setKeep] = useState(() => new Set(rows.map(r => r.id)));
  const [editing, setEditing] = useState<string | null>(null);
  const toggle = (id: string) => { const n = new Set(keep); n.has(id) ? n.delete(id) : n.add(id); setKeep(n); };
  const rename = (r: Row, title: string) => setD(x => ({ ...x, [r.table]: (x[r.table] as any[]).map(i => (i.id === r.id ? (r.table === 'people' ? { ...i, name: title } : { ...i, title }) : i)) }));
  const retime = (r: Row, v: string) => {
    if (!v || r.time === undefined) return;
    const [h, m] = v.split(':').map(Number); const t = at(startOfDay(r.time), h * 60 + m);
    setD(x => ({ ...x, events: x.events.map(e => (e.id === r.id ? { ...e, start: t, end: t + (e.end - e.start) } : e)), tasks: x.tasks.map(k => (k.id === r.id ? { ...k, at: t } : k)) }));
  };
  if (!rows.length) return <p className="text-sm text-muted">Nothing found.</p>;
  return <div>
    {!compact && <p className="mb-2 text-sm font-medium">{d.title}</p>}
    <ul className={cx('divide-y divide-line overflow-y-auto rounded-lg border border-line bg-card', rows.length > 4 && (compact ? 'max-h-60' : 'max-h-96'))}>
      {rows.map(r => <li key={r.id} className="flex items-start gap-3 px-3 py-2">
        <button aria-label={keep.has(r.id) ? 'Skip this' : 'Include this'} onClick={() => toggle(r.id)} className={cx('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border', keep.has(r.id) ? 'border-green bg-green text-paper' : 'border-line')}>{keep.has(r.id) && <Check size={12} strokeWidth={3} />}</button>
        {editing === r.id ? <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <input autoFocus className={inputCls} defaultValue={r.label} onBlur={e => rename(r, e.target.value)} />
          {r.time !== undefined && !r.allDay && <input type="time" className={inputCls} defaultValue={hm(new Date(r.time).getHours() * 60 + new Date(r.time).getMinutes())} onChange={e => retime(r, e.target.value)} />}
          <button className="self-start text-xs text-green" onClick={() => setEditing(null)}>Done</button>
        </div> : <button className="min-w-0 flex-1 text-left" onClick={() => setEditing(r.id)}>
          <span className="block truncate text-sm">{r.label}</span><span className="block truncate text-xs text-muted">{r.meta}</span>
        </button>}
        {r.url && <a href={r.url} target="_blank" rel="noreferrer" aria-label="Source" className="mt-0.5 text-muted"><ExternalLink size={14} /></a>}
      </li>)}
    </ul>
    <p className="mt-1.5 text-[11px] text-muted">Tap an item to fix it.</p>
    <div className="mt-2 flex gap-2">
      <Btn kind="primary" className="flex-1" disabled={!keep.size} onClick={() => { store().approve(d, keep); onDone(true, d); }}>Add{rows.length > 1 ? ` ${keep.size}` : ''}</Btn>
      <Btn kind="ghost" onClick={() => onDone(false, d)}>Cancel</Btn>
    </div>
  </div>;
}
