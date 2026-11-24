import type { Block, Task, Settings, Person, Place } from '../types';
import { defaultSettings } from '../defaults';
import { at, addDays } from '../time';

// Monday 23 Nov 2026 (tests run with TZ=UTC)
export const MON = new Date(2026, 10, 23).getTime();
export const T = (day: number, hm: string) => at(addDays(MON, day), hm);
export const settings = (): Settings => defaultSettings();
let n = 0;
export const block = (title: string, start: number, end: number, over: Partial<Block> = {}): Block =>
  ({ id: `b${n++}`, title, kind: 'event', start, end, fixed: true, source: 'manual', ...over });
export const task = (title: string, over: Partial<Task> = {}): Task => ({ id: title, title, type: 'errand', durationMin: 30, done: false, source: 'manual', createdAt: MON, ...over });
export const person = (name: string, over: Partial<Person> = {}): Person => ({ id: name, name, source: 'manual', ...over });
export const place = (name: string, over: Partial<Place> = {}): Place => ({ id: name.toLowerCase(), name, kind: 'other', ...over });
