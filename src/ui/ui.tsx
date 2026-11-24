import React, { useEffect, useState } from 'react';
import type { Block, Importance } from '@engine/types';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Btn({ kind = 'soft', className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'soft' | 'ghost' | 'danger' }) {
  return <button {...p} className={cx('inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition active:scale-[.97] disabled:opacity-40',
    kind === 'primary' && 'bg-indigo-600 text-white hover:bg-indigo-500',
    kind === 'soft' && 'bg-slate-200/70 text-slate-800 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-100 dark:hover:bg-white/15',
    kind === 'ghost' && 'text-slate-600 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-white/10',
    kind === 'danger' && 'bg-rose-600/10 text-rose-700 hover:bg-rose-600/20 dark:text-rose-300', className)} />;
}

export function Chip({ active, dashed, className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; dashed?: boolean }) {
  return <button {...p} className={cx('inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition active:scale-95',
    active ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-slate-700 dark:border-white/15 dark:bg-white/5 dark:text-slate-200',
    dashed && !active && 'border-dashed border-amber-500/80', className)} />;
}

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...p} className={cx('rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-white/[.04]', className)} />;
}

export function Section({ title, right, children, className }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={cx('mb-5', className)}>
    <div className="mb-2 flex items-center justify-between"><h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{title}</h2>{right}</div>
    {children}
  </section>;
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);
  if (!open) return null;
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
    <div className="pop max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-4 pb-8 shadow-xl dark:bg-[#15151f] sm:rounded-3xl safe-bottom" onClick={e => e.stopPropagation()}>
      <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300 dark:bg-white/20" />
      {title && <h3 className="mb-3 text-lg font-semibold">{title}</h3>}
      {children}
    </div>
  </div>;
}

export function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return <label className="flex items-start justify-between gap-3 py-2">
    <span><span className="text-sm font-medium">{label}</span>{hint && <span className="block text-xs text-slate-500 dark:text-slate-400">{hint}</span>}</span>
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className={cx('relative h-6 w-11 shrink-0 rounded-full transition', on ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-white/20')}>
      <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition', on ? 'left-5.5' : 'left-0.5')} />
    </button>
  </label>;
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block py-1.5"><span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>{children}</label>;
}
export const inputCls = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-white/15 dark:bg-white/5';

export function TagEditor({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [v, setV] = useState('');
  return <div className="flex flex-wrap items-center gap-1.5">
    {values.map(x => <Chip key={x} onClick={() => onChange(values.filter(y => y !== x))} title="Remove">{x} ✕</Chip>)}
    <input value={v} onChange={e => setV(e.target.value)} placeholder={placeholder ?? 'add…'} className="min-w-20 flex-1 bg-transparent px-1 py-1 text-sm outline-none"
      onKeyDown={e => { if (e.key === 'Enter' && v.trim()) { onChange([...new Set([...values, v.trim()])]); setV(''); } }} />
  </div>;
}

export const BLOCK_STYLE: Record<string, string> = {
  class: 'bg-sky-600 text-white', event: 'bg-indigo-600 text-white', reservation: 'bg-rose-600 text-white',
  task: 'bg-violet-500 text-white', milestone: 'bg-fuchsia-500 text-white', gift: 'bg-pink-500 text-white',
  meal: 'bg-amber-400 text-amber-950', sleep: 'bg-slate-800 text-slate-300 dark:bg-slate-900', hobby: 'bg-emerald-500 text-white',
  nap: 'bg-teal-500 text-white', routine: 'bg-cyan-600 text-white', travel: 'bg-slate-400 text-white dark:bg-slate-600', buffer: 'bg-slate-200',
};
export function blockStyle(b: Block) {
  const imported = b.flexibility === 'fixed' && (b.source === 'ics' || b.source === 'google' || b.source === 'school' || b.source === 'seed');
  return cx(BLOCK_STYLE[b.kind] ?? 'bg-slate-500 text-white', imported && 'fixed-stripes ring-1 ring-inset ring-black/20', b.status === 'done' && 'opacity-50', b.status === 'skipped' && 'opacity-30 line-through', b.flexibility === 'optional' && 'opacity-90 border border-dashed border-white/60');
}
export const isImported = (b: Block) => b.flexibility === 'fixed' && ['ics', 'google', 'school', 'seed'].includes(b.source);

export const IMPORTANCE: { key: Importance; label: string; hint: string }[] = [
  { key: 'passive', label: 'Passive', hint: 'badge / daily digest' },
  { key: 'normal', label: 'Normal', hint: 'one notification' },
  { key: 'aggressive', label: 'Aggressive', hint: 'escalates until done' },
];

export function useNow(ms = 30_000) {
  const [n, setN] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setN(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return n;
}
