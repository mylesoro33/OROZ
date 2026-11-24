import { useSyncExternalStore } from 'react';

export type Tab = 'schedule' | 'todo' | 'profile';
export interface PhotoJob { files?: File[]; link?: string; from: 'camera' | 'upload' | 'link' | 'menu' }
export interface Nav { photo?: PhotoJob | null; tab: Tab; settings: boolean; settingsFocus?: 'connections'; talk: boolean; talkMode?: 'voice' | 'type' | 'photo' | 'link'; profileFocus?: 'places' | 'people' | 'sleep' | 'about'; fitTaskId?: string }
let nav: Nav = { tab: 'schedule', settings: false, talk: false };
const subs = new Set<() => void>();
export function go(patch: Partial<Nav>) { nav = { ...nav, ...patch }; subs.forEach(s => s()); }
export const useNav = () => useSyncExternalStore(fn => { subs.add(fn); return () => { subs.delete(fn); }; }, () => nav);
export const openTalk = (mode: Nav['talkMode'] = 'voice') => go({ talk: true, talkMode: mode });

// Hidden file inputs live in App; buttons call these inside the tap so the camera opens right away.
const inputs: { camera?: HTMLInputElement; upload?: HTMLInputElement } = {};
let afterPick: (() => void) | undefined;
export const registerPicker = (kind: 'camera' | 'upload', el: HTMLInputElement | null) => { if (el) inputs[kind] = el; };
export function pickPhotos(kind: 'camera' | 'upload', then?: () => void) { afterPick = then; inputs[kind]?.click(); }
export function photosPicked(files: File[], kind: 'camera' | 'upload') {
  if (!files.length) return;
  afterPick?.(); afterPick = undefined;
  const cur = nav.photo;
  go({ talk: false, photo: cur && !cur.link ? { ...cur, files: [...(cur.files ?? []), ...files] } : { files, from: kind } });
}
export const openPhotoImport = (job: PhotoJob) => go({ talk: false, photo: job });
