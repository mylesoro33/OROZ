// Oroz domain model. Pure data types — no UI, no storage concerns.
// All timestamps are epoch milliseconds. All durations are minutes.

export type ID = string;
export type Ms = number;

export type Flexibility = 'fixed' | 'movable' | 'optional';
export type BlockKind =
  | 'class' | 'event' | 'task' | 'meal' | 'sleep' | 'hobby' | 'routine'
  | 'travel' | 'milestone' | 'gift' | 'reservation' | 'nap' | 'buffer';
export type BlockSource = 'google' | 'ics' | 'school' | 'manual' | 'planner' | 'capture' | 'seed';
export type Importance = 'passive' | 'normal' | 'aggressive';
export type LocationTag = 'anywhere' | 'home' | 'school' | 'quiet' | 'gym' | 'outside';
export type Energy = 'energizing' | 'neutral' | 'draining';
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface Block {
  id: ID;
  title: string;
  kind: BlockKind;
  start: Ms;
  end: Ms;
  flexibility: Flexibility;
  source: BlockSource;
  placeId?: ID;
  taskId?: ID;
  projectId?: ID;
  milestoneId?: ID;
  activityId?: ID;
  mealType?: MealType;
  reason?: string;          // "why here?"
  importance?: Importance;
  externalId?: string;      // calendar UID
  status?: 'planned' | 'active' | 'done' | 'skipped';
  focus?: boolean;
  notes?: string;
}

export interface Subtask { id: ID; title: string; done: boolean }

export interface Task {
  id: ID;
  title: string;
  durationMin: number;
  due?: Ms;
  priority: 1 | 2 | 3;      // 1 = high
  location?: LocationTag;
  needsFocus?: boolean;
  subtasks?: Subtask[];
  done?: boolean;
  projectId?: ID;
  milestoneId?: ID;
  chunkable?: boolean;      // default true for > 60 min
  importance?: Importance;
  createdAt: Ms;
  notes?: string;
  kind?: 'task' | 'grocery' | 'gift' | 'prep';
}

export type MilestoneKind = 'research' | 'outline' | 'draft' | 'revise' | 'submit';
export interface Milestone { id: ID; kind: MilestoneKind; title: string; due: Ms; durationMin: number; taskId?: ID }

export interface StarterItem { label: string; body: string; starter: true }
export interface StarterKit {
  generatedAt: Ms;
  generator: 'rules' | 'llm';
  breakdown: StarterItem[];
  outline: StarterItem[];
  questions: StarterItem[];
  sources: StarterItem[];
  scaffold: StarterItem[];
}

export interface Project {
  id: ID;
  title: string;
  course?: string;
  due: Ms;
  effortMin: number;         // total estimated effort
  source: BlockSource;
  externalId?: string;
  description?: string;
  milestones: Milestone[];
  starterKit?: StarterKit;
  warnings?: string[];
}

export interface Routine {
  id: ID;
  title: string;
  kind: 'routine' | 'hobby';
  days: number[];            // 0=Sun..6=Sat
  start: string;             // "HH:MM" preferred start
  durationMin: number;
  flexibility: Flexibility;
  windowMin?: number;        // how far it may move (+/-) when movable
  placeId?: ID;
}

export interface MealSlot { type: MealType; window: [string, string]; durationMin: number; minDurationMin: number }

export interface FoodProfile {
  favorites: string[];
  cuisines: string[];
  dislikes: string[];
  dietary: string[];          // "vegetarian", "no pork", "gluten-free", ...
  budget: [number, number];   // per meal, user currency
  kitchenNote?: string;
  tracking?: boolean;         // opt-in nutrition tracking (off by default)
}

export interface Activity {
  id: ID;
  name: string;
  durationMin: number;
  energy: Energy;
  location?: LocationTag;
  placeId?: ID;
  weeklyTarget?: number;     // times per week
  social?: boolean;
  category: 'movie' | 'reading' | 'nap' | 'gaming' | 'friends' | 'going-out' | 'gym' | 'family' | 'other';
}

export interface Place { id: ID; name: string; lat: number; lng: number; radiusM: number; tags: LocationTag[] }
export interface TravelTime { from: ID; to: ID; minutes: number }

export interface Person {
  id: ID;
  name: string;
  relationship: string;      // mom, friend, ...
  closeness: 1 | 2 | 3;      // 1 = closest
  birthday?: { month: number; day: number; year?: number };
  anniversary?: { month: number; day: number };
  interests: string[];
  foodLikes: string[];
  dietary: string[];
  giftIdeas: string[];
  pastGifts: { year: number; gift: string }[];
  budget?: number;
  notes: string[];
  source: 'manual' | 'google-contacts' | 'calendar';
}

export interface Occasion {
  id: ID;
  kind: 'birthday' | 'anniversary' | 'holiday' | 'gathering';
  title: string;
  date: Ms;
  personId?: ID;
  major?: boolean;
}

export interface ReminderStage { at: Ms; label: string; stage: 'heads-up' | 'lead' | 'at-time' | 'follow-up' | 'digest' }
export interface Reminder {
  id: ID;
  itemId: ID;
  itemType: 'block' | 'task' | 'occasion' | 'reminder';
  title: string;
  dueAt: Ms;
  importance: Importance;
  importanceSetBy: 'auto' | 'user';
  stages: ReminderStage[];
  firedStages: number[];
  snoozedUntil?: Ms;
  done?: boolean;
  category?: string;
}

export type LogAction = 'completed' | 'skipped' | 'moved' | 'accepted' | 'rejected' | 'snoozed' | 'dismissed' | 'blocked';
export interface LogEntry {
  id: ID;
  at: Ms;
  action: LogAction;
  key: string;               // activity key: "meal:dinner", "nap", "hobby:reading", "task:focus", "suggest:<id>", "reminder:<category>"
  plannedStart?: Ms;
  plannedEnd?: Ms;
  actualStart?: Ms;
  actualEnd?: Ms;
  placeId?: ID;
  focus?: boolean;
  meta?: Record<string, string | number | boolean>;
}

export interface Habit {
  id: ID;                    // = key
  key: string;
  label: string;
  weekdays: number[];        // typical days
  windowStart: number;       // minutes of day
  windowEnd: number;
  durationMin: number;
  placeId?: ID;
  confidence: number;        // 0..1
  samples: number;
  status: 'learned' | 'confirmed' | 'edited';
}

export interface Weights {
  deadline: number;
  priority: number;
  energy: number;
  location: number;
  soonness: number;
  focusCap: number;
  freeTime: number;
  habit: number;
  timeFit: number;
  mealHunger: number;
  hobbyStaleness: number;
  learnedAcceptance: number;
}

export interface Settings {
  bedtime: string;            // "23:00"
  wake: string;               // "07:00"
  minSleepMin: number;        // 480
  quietHours: [string, string];
  quietExceptions: Importance[]; // importance levels allowed during quiet hours
  bufferMin: number;          // 10
  focusCapMin: number;        // 90
  breakMin: number;           // 15
  minFreeMinPerDay: number;   // 60
  napLengthMin: number;       // 25
  meals: MealSlot[];
  maxMealGapMin: number;      // 300
  weights: Weights;
  energyByHour: number[];     // 24 values, 0..1 (cold start defaults; learned overrides)
  theme: 'system' | 'light' | 'dark';
  flags: { llm: boolean; places: boolean; googleSync: boolean };
  llmApiKey?: string;
  placesApiKey?: string;
  googleClientId?: string;
  icsUrls: { url: string; kind: 'calendar' | 'assignments'; label: string }[];
  corsProxy?: string;
  searchArea?: string;        // coarse area text used for place searches ("Downtown Austin")
  currency: string;
  onboarded: boolean;
  homePlaceId?: ID;
}

export interface Note { id: ID; text: string; at: Ms; tags?: string[] }
