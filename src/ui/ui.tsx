import React, { useEffect, useState } from 'react';
import {
  GraduationCap, Briefcase, User, ShoppingBag, CalendarDays, BookOpen, ListChecks, School, Users,
  Utensils, ClipboardCheck, Backpack, Moon, Cake, Sun, type LucideIcon,
} from 'lucide-react';
import type { Block, TaskType } from '@engine/types';
import type { OutlookIcon } from '@engine/day';
import type { ConnectionId } from '../data/store';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Btn({ kind = 'quiet', className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'quiet' | 'ghost' | 'danger' }) {
  return <button {...p} className={cx('inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-40',
    kind === 'primary' && 'bg-green text-paper hover:opacity-90',
    kind === 'quiet' && 'border border-line bg-card text-ink hover:bg-linen',
    kind === 'ghost' && 'text-muted hover:text-ink',
    kind === 'danger' && 'text-clay hover:bg-clay-soft', className)} />;
}

export function Chip({ active, className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return <button {...p} className={cx('inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
    active ? 'border-green bg-green text-paper' : 'border-line bg-card text-ink hover:bg-linen', className)} />;
}

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...p} className={cx('rounded-xl border border-line bg-card p-4 shadow-[0_1px_2px_rgba(60,50,30,.05)]', className)} />;
}

export function Heading({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return <div className="mb-2 mt-6 flex items-baseline justify-between first:mt-0"><h2 className="text-lg font-semibold">{children}</h2>{right}</div>;
}

export function Empty({ icon: I, text, action }: { icon: LucideIcon; text: string; action?: React.ReactNode }) {
  return <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line px-6 py-8 text-center">
    <I size={22} strokeWidth={1.5} className="text-muted" /><p className="text-sm text-muted">{text}</p>{action}
  </div>;
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  if (!open) return null;
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 sm:items-center" onClick={onClose}>
    <div className="rise max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-line bg-card p-5 pb-8 shadow-lg sm:rounded-2xl safe-bottom" onClick={e => e.stopPropagation()} role="dialog" aria-label={title}>
      <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-line sm:hidden" />
      {title && <h3 className="mb-4 text-xl font-semibold">{title}</h3>}
      {children}
    </div>
  </div>;
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block py-1.5"><span className="mb-1 block text-xs font-medium text-muted">{label}</span>{children}</label>;
}
export const inputCls = 'w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-green';

export const TASK_ICON: Record<TaskType, LucideIcon> = { school: GraduationCap, work: Briefcase, personal: User, errand: ShoppingBag, event: CalendarDays };
export const CONN_ICON: Record<ConnectionId, LucideIcon> = { 'google-calendar': CalendarDays, classroom: GraduationCap, schoology: BookOpen, 'google-tasks': ListChecks, 'school-calendar': School, contacts: Users };
export const OUTLOOK_ICON: Record<OutlookIcon, LucideIcon> = { school: GraduationCap, event: CalendarDays, lunch: Utensils, due: ClipboardCheck, prep: Backpack, moon: Moon, cake: Cake, off: Sun };

export function blockStyle(b: Block): string {
  switch (b.kind) {
    case 'class': return 'bg-green-soft border-l-green text-ink';
    case 'study': return 'bg-clay-soft border-l-clay text-ink';
    case 'meal': return 'bg-brass-soft/70 border-l-brass text-muted';
    case 'sleep': return 'hatch bg-linen border-l-line text-muted';
    default: return 'bg-linen border-l-ink/60 text-ink';
  }
}
export const isOwn = (b: Block) => !b.derived && (b.source === 'manual' || b.source === 'chat');

export function useNow(ms = 30_000) {
  const [n, setN] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setN(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return n;
}
