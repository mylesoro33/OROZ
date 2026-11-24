import { useSyncExternalStore } from 'react';

export type Tab = 'schedule' | 'todo' | 'profile';
export interface Nav { tab: Tab; settings: boolean; settingsFocus?: 'connections'; talk: boolean; talkMode?: 'voice' | 'type' | 'photo' | 'link'; profileFocus?: 'places' | 'people' | 'sleep' | 'about'; fitTaskId?: string }
let nav: Nav = { tab: 'schedule', settings: false, talk: false };
const subs = new Set<() => void>();
export function go(patch: Partial<Nav>) { nav = { ...nav, ...patch }; subs.forEach(s => s()); }
export const useNav = () => useSyncExternalStore(fn => { subs.add(fn); return () => { subs.delete(fn); }; }, () => nav);
export const openTalk = (mode: Nav['talkMode'] = 'voice') => go({ talk: true, talkMode: mode });
