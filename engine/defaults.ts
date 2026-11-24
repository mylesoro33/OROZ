import type { Settings, Weights, MealSlot, FoodProfile } from './types';

export const DEFAULT_WEIGHTS: Weights = {
  deadline: 3,
  priority: 1.5,
  energy: 1.5,
  location: 1,
  soonness: 1,
  focusCap: 2,
  freeTime: 2,
  habit: 1.5,
  timeFit: 2,
  mealHunger: 2,
  hobbyStaleness: 1.2,
  learnedAcceptance: 1,
};

export const DEFAULT_MEALS: MealSlot[] = [
  { type: 'breakfast', window: ['06:30', '09:30'], durationMin: 20, minDurationMin: 10 },
  { type: 'lunch', window: ['11:00', '13:30'], durationMin: 30, minDurationMin: 15 },
  { type: 'dinner', window: ['17:30', '20:30'], durationMin: 45, minDurationMin: 20 },
];

/** Cold-start energy curve by hour (0..1). Learned values replace it over time. */
export const DEFAULT_ENERGY: number[] = [
  0.1, 0.1, 0.1, 0.1, 0.1, 0.15, 0.3, 0.45, 0.65, 0.8, 0.85, 0.8,
  0.65, 0.55, 0.5, 0.55, 0.65, 0.7, 0.65, 0.6, 0.55, 0.45, 0.3, 0.2,
];

export function defaultSettings(): Settings {
  return {
    bedtime: '23:00',
    wake: '07:00',
    minSleepMin: 480,
    quietHours: ['22:30', '07:00'],
    quietExceptions: ['aggressive'],
    bufferMin: 10,
    focusCapMin: 90,
    breakMin: 15,
    minFreeMinPerDay: 60,
    napLengthMin: 25,
    meals: DEFAULT_MEALS.map(m => ({ ...m, window: [...m.window] as [string, string] })),
    maxMealGapMin: 300,
    weights: { ...DEFAULT_WEIGHTS },
    energyByHour: [...DEFAULT_ENERGY],
    theme: 'system',
    flags: { llm: false, places: false, googleSync: false },
    icsUrls: [],
    currency: '$',
    onboarded: false,
  };
}

export function defaultFoodProfile(): FoodProfile {
  return { favorites: [], cuisines: [], dislikes: [], dietary: [], budget: [5, 20] };
}
