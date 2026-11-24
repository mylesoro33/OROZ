import type { Settings, MealSlot } from './types';

export const DEFAULT_MEALS: MealSlot[] = [
  { type: 'breakfast', window: ['06:30', '08:30'], durationMin: 20, minDurationMin: 10 },
  { type: 'lunch', window: ['11:00', '13:30'], durationMin: 30, minDurationMin: 15 },
  { type: 'dinner', window: ['17:30', '20:30'], durationMin: 40, minDurationMin: 20 },
];

export function defaultSettings(): Settings {
  return {
    sleep: {
      schoolNight: { bedtime: '22:45', flexMin: 30, wake: '06:45' },
      weekend: { bedtime: '23:30', flexMin: 45, wake: '08:30' },
      minSleepMin: 480, windDownMin: 60, overrides: {},
    },
    meals: DEFAULT_MEALS.map(m => ({ ...m, window: [...m.window] as [string, string] })),
    schoolDays: [1, 2, 3, 4, 5],
    theme: 'system',
  };
}
