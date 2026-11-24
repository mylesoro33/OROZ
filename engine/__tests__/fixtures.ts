import type { Block, Task, Place, TravelTime, Settings } from '../types';
import { defaultSettings } from '../defaults';
import { at, addDays } from '../time';

// Monday 23 Nov 2026 (tests run with TZ=UTC)
export const MON = new Date(2026, 10, 23).getTime();
export const T = (day: number, hm: string) => at(addDays(MON, day), hm);

export function settings(over: Partial<Settings> = {}): Settings { return { ...defaultSettings(), ...over }; }

export const places: Place[] = [
  { id: 'home', name: 'Home', lat: 40.0, lng: -75.0, radiusM: 120, tags: ['home', 'quiet'] },
  { id: 'school', name: 'School', lat: 40.02, lng: -75.0, radiusM: 250, tags: ['school'] },
  { id: 'gym', name: 'Gym', lat: 40.01, lng: -75.02, radiusM: 100, tags: ['gym'] },
];
export const travel: TravelTime[] = [
  { from: 'home', to: 'school', minutes: 15 },
  { from: 'home', to: 'gym', minutes: 10 },
  { from: 'school', to: 'gym', minutes: 12 },
];

let n = 0;
export function fixed(title: string, start: number, end: number, extra: Partial<Block> = {}): Block {
  return { id: `f${n++}_${title}`, title, kind: 'class', start, end, flexibility: 'fixed', source: 'ics', ...extra };
}

/** A normal school day: 8:00–11:30, lunch gap, 12:15–15:00, at school. */
export function schoolDay(day: number): Block[] {
  return [
    fixed('Classes AM', T(day, '08:00'), T(day, '11:30'), { placeId: 'school' }),
    fixed('Classes PM', T(day, '12:15'), T(day, '15:00'), { placeId: 'school' }),
  ];
}

export function task(id: string, over: Partial<Task> = {}): Task {
  return { id, title: id, durationMin: 60, priority: 2, createdAt: MON, ...over };
}
