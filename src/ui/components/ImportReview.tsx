import { useState } from 'react';
import { Check } from 'lucide-react';
import { fmtDay, fmtTime } from '@engine/time';
import type { PendingImport } from '../../data/store';
import { approveImport } from '../../integrations/connect';
import { Btn, cx } from '../ui';

/** Show what would be imported; nothing is saved until "Add". */
export function ImportReview({ p, onDone, compact }: { p: PendingImport; onDone: (p: PendingImport) => void; compact?: boolean }) {
  const rows: { id: string; label: string; meta: string }[] = [
    ...(p.blocks ?? []).map(b => ({ id: b.id, label: b.title, meta: `${fmtDay(b.start)}${b.allDay ? '' : ` ${fmtTime(b.start)}`}` })),
    ...(p.tasks ?? []).map(t => ({ id: t.id, label: t.title, meta: [t.tag, t.due ? `due ${fmtDay(t.due)}` : ''].filter(Boolean).join(' · ') })),
    ...(p.people ?? []).map(x => ({ id: x.id, label: x.name, meta: x.birthday ? `birthday ${x.birthday.month}/${x.birthday.day}` : 'no birthday found' })),
    ...Object.entries(p.lunch ?? {}).map(([d, items]) => ({ id: d, label: items.join(', '), meta: fmtDay(new Date(d + 'T12:00').getTime()) })),
  ];
  const [keep, setKeep] = useState(() => new Set(rows.map(r => r.id)));
  if (p.status !== 'pending') return <p className="text-xs text-muted">{p.status === 'added' ? `Added · ${p.title}` : 'Not added'}</p>;
  if (!rows.length) return <p className="text-sm text-muted">Nothing new found.</p>;
  const toggle = (id: string) => { const n = new Set(keep); n.has(id) ? n.delete(id) : n.add(id); setKeep(n); };
  const add = () => {
    const lunchKeep = p.lunch ? Object.fromEntries(Object.entries(p.lunch).filter(([d]) => keep.has(d))) : undefined;
    onDone(approveImport({ ...p, lunch: lunchKeep }, keep));
  };
  return <div>
    <p className="mb-2 text-sm font-medium">{p.title}</p>
    <ul className={cx('divide-y divide-line overflow-y-auto rounded-lg border border-line', compact ? 'max-h-52' : 'max-h-80')}>
      {rows.map(r => <li key={r.id}><button onClick={() => toggle(r.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left">
        <span className={cx('flex h-4 w-4 shrink-0 items-center justify-center rounded border', keep.has(r.id) ? 'border-green bg-green text-paper' : 'border-line')}>{keep.has(r.id) && <Check size={12} strokeWidth={3} />}</span>
        <span className="min-w-0 flex-1"><span className="block truncate text-sm">{r.label}</span><span className="block truncate text-xs text-muted">{r.meta}</span></span>
      </button></li>)}
    </ul>
    <div className="mt-3 flex gap-2">
      <Btn kind="primary" className="flex-1" disabled={!keep.size} onClick={add}>Add {keep.size}</Btn>
      <Btn kind="ghost" onClick={() => onDone({ ...p, status: 'dismissed' })}>Not now</Btn>
    </div>
  </div>;
}
