import { useSyncExternalStore } from 'react';

export interface Toast { id: number; text: string; action?: { label: string; run: () => void } }
let toasts: Toast[] = [];
const subs = new Set<() => void>();
let n = 0;
const emit = () => subs.forEach(s => s());

export function toast(text: string, action?: Toast['action'], ms = 3500) {
  const t = { id: ++n, text, action };
  toasts = [t]; emit();
  setTimeout(() => { toasts = toasts.filter(x => x.id !== t.id); emit(); }, ms);
}
export const clearToasts = () => { toasts = []; emit(); };
export const dismissToast = (id: number) => { toasts = toasts.filter(x => x.id !== id); emit(); };
export const useToasts = () => useSyncExternalStore(fn => { subs.add(fn); return () => subs.delete(fn); }, () => toasts);
