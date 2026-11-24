// OROZ domain model. Pure data — no UI, no storage. Timestamps are epoch ms; durations are minutes.

export type ID = string;
export type Ms = number;

export type Source = 'manual' | 'talk' | 'photo' | 'link' | 'web' | 'google-calendar' | 'apple-calendar' | 'outlook' | 'classroom' | 'school-feed' | 'google-tasks' | 'contacts';
export type BlockKind = 'event' | 'class' | 'work' | 'todo' | 'date';

export interface Block {
  id: ID;
  title: string;
  kind: BlockKind;
  start: Ms;
  end: Ms;
  allDay?: boolean;
  fixed: boolean;            // imported events never move
  source: Source;
  seriesId?: ID;
  externalId?: string;
  location?: string;
  placeId?: ID;
  sourceUrl?: string;        // where an important date came from
  taskId?: ID;               // a to-do placed on the calendar
}

export type TaskType = 'errand' | 'call' | 'home' | 'work' | 'school' | 'health' | 'social';
export interface Task {
  id: ID;
  title: string;
  type: TaskType;
  date?: Ms;                 // optional day (start of day) or due
  at?: Ms;                   // a set time → shows on the calendar
  durationMin: number;
  placeId?: ID;
  placeName?: string;
  by?: Ms;                   // "sometime this week" → fit in before this
  done: boolean;
  doneAt?: Ms;
  source: Source;
  externalId?: string;
  createdAt: Ms;
}

export type PlaceKind = 'home' | 'work' | 'school' | 'gym' | 'church' | 'coffee' | 'friend' | 'relative' | 'store' | 'other';
export interface Place { id: ID; name: string; kind: PlaceKind; address?: string }

export interface Person {
  id: ID;
  name: string;
  relationship?: string;
  birthday?: { month: number; day: number; year?: number };
  source: Source;
  link?: string;
  close?: boolean;
}

export type Occupation = 'student' | 'working' | 'both' | 'home' | 'retired' | 'other';
export interface Profile {
  name?: string;
  ageRange?: string;
  occupation?: Occupation;
  occupationDetail?: string; // grade/level, or kind of work + hours
  hometown?: string;
  city?: string;
  setupDone: boolean;
}

export interface MealWindow { type: 'breakfast' | 'lunch' | 'dinner'; from: string; to: string }

/** Sleep is soft: a default per kind of night, and any night can differ. */
export interface SleepPrefs {
  weeknight: { bedtime: string; wake: string };
  weekend: { bedtime: string; wake: string };
  overrides: Record<string, string>; // 'YYYY-MM-DD' (night of) → bedtime 'HH:MM'
}

export interface Settings {
  sleep: SleepPrefs;
  meals: MealWindow[];
  workDays: number[];        // nights before these are "weeknights"
  theme: 'system' | 'light' | 'dark';
  apiKey?: string;
  googleClientId?: string;
}

export interface Memory { id: ID; text: string; at: Ms; topic?: string }
