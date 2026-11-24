import { useSyncExternalStore } from 'react';

export type Tab = 'schedule' | 'todo' | 'oroz' | 'settings';
interface Nav { tab: Tab; chatDraft?: string; settingsFocus?: 'connections' | 'people' | 'sleep'; scheduleDay?: number }
let nav: Nav = { tab: (safeGet('oroz.tab') as Tab) || 'schedule' };
const subs = new Set<() => void>();
export function go(patch: Partial<Nav>) { nav = { ...nav, ...patch }; try { localStorage.setItem('oroz.tab', nav.tab); } catch { /* private mode */ } subs.forEach(s => s()); }
export const useNav = () => useSyncExternalStore(fn => { subs.add(fn); return () => { subs.delete(fn); }; }, () => nav);
/** Open the OROZ tab with a message ready to send. */
export const askOroz = (prompt: string) => go({ tab: 'oroz', chatDraft: prompt });
function safeGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
