import type { Settings } from './types';

export function defaultSettings(): Settings {
  return {
    sleep: { weeknight: { bedtime: '22:45', wake: '06:45' }, weekend: { bedtime: '23:30', wake: '08:30' }, overrides: {} },
    meals: [
      { type: 'breakfast', from: '07:00', to: '08:00' },
      { type: 'lunch', from: '12:00', to: '13:00' },
      { type: 'dinner', from: '18:00', to: '19:30' },
    ],
    workDays: [1, 2, 3, 4, 5],
    theme: 'system',
  };
}
