// OROZ domain model. Pure data — no UI, no storage. Timestamps are epoch ms; durations are minutes.

export type ID = string;
export type Ms = number;

export type Source = 'manual' | 'chat' | 'google-calendar' | 'classroom' | 'schoology' | 'google-tasks' | 'school-calendar' | 'contacts' | 'web';
export type BlockKind = 'class' | 'event' | 'study' | 'meal' | 'sleep' | 'birthday' | 'no-school';
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface Block {
  id: ID;
  title: string;
  kind: BlockKind;
  start: Ms;
  end: Ms;
  fixed: boolean;            // imported / fixed events never move
  source: Source;
  seriesId?: ID;             // weekly repeats share a series
  externalId?: string;
  location?: string;
  notes?: string;
  mealType?: MealType;
  allDay?: boolean;
  derived?: boolean;         // sleep/meals computed on the fly, never stored
  reason?: string;
}

export type TaskType = 'school' | 'work' | 'personal' | 'errand' | 'event';
export interface Task {
  id: ID;
  title: string;
  due?: Ms;
  tag?: string;              // class / label
  type: TaskType;
  done: boolean;
  doneAt?: Ms;
  source: Source;
  externalId?: string;
  createdAt: Ms;
}

export interface Person {
  id: ID;
  name: string;
  relationship?: string;
  birthday?: { month: number; day: number; year?: number };
  source: Source;
  link?: string;             // public profile the user provided
  notes?: string[];
}

export interface MealSlot { type: MealType; window: [string, string]; durationMin: number; minDurationMin: number }

/** Sleep is a range, not a fixed time. Each night can be overridden. */
export interface SleepPrefs {
  schoolNight: { bedtime: string; flexMin: number; wake: string };  // flexMin: ± range around bedtime
  weekend: { bedtime: string; flexMin: number; wake: string };
  minSleepMin: number;
  windDownMin: number;       // homework should wrap this long before bed
  overrides: Record<string, string>; // 'YYYY-MM-DD' (night of) → bedtime 'HH:MM'
}

export interface Settings {
  sleep: SleepPrefs;
  meals: MealSlot[];
  schoolDays: number[];      // 1..5 by default
  theme: 'system' | 'light' | 'dark';
  apiKey?: string;
  googleClientId?: string;
}

export interface Profile { name?: string; school?: string; grade?: string; setupDone: boolean }

export interface Memory { id: ID; text: string; at: Ms }
