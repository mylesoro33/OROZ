import type { Block, Task, Routine, Activity, Place, Person, LogEntry } from '@engine/types';
import { MIN, DAY, at, addDays, startOfDay, hashId } from '@engine/time';
import { defaultSettings } from '@engine/defaults';
import type { Store, TravelRow } from './store';
import * as A from './actions';

// Demo data so the app is useful on first open. Everything is relative to "now"
// and clearly fake (sample names, generic places). Clear it from Settings.

export async function seedDemo(store: Store) {
  const now = Date.now();
  const today = startOfDay(now);
  const mon = addDays(today, -((new Date(today).getDay() + 6) % 7)); // this week's Monday

  const places: Place[] = [
    { id: 'home', name: 'Home', lat: 40.7411, lng: -73.9897, radiusM: 120, tags: ['home', 'quiet'] },
    { id: 'school', name: 'School', lat: 40.7505, lng: -73.9934, radiusM: 300, tags: ['school', 'quiet'] },
    { id: 'gym', name: 'Gym', lat: 40.7448, lng: -73.9820, radiusM: 100, tags: ['gym'] },
    { id: 'jake', name: "Jake's house", lat: 40.7380, lng: -73.9990, radiusM: 80, tags: [] },
    { id: 'cafe', name: 'Coffee shop', lat: 40.7470, lng: -73.9880, radiusM: 60, tags: ['quiet'] },
  ];
  const travel: TravelRow[] = [
    ['home', 'school', 15], ['home', 'gym', 10], ['school', 'gym', 12], ['home', 'jake', 12], ['school', 'cafe', 8], ['home', 'cafe', 10],
  ].map(([from, to, minutes]) => ({ id: `${from}_${to}`, from: from as string, to: to as string, minutes: minutes as number }));

  // School: two fixed blocks per weekday for 3 weeks, plus practice and a test.
  const blocks: Block[] = [];
  for (let d = 0; d < 21; d++) {
    const day = addDays(mon, d); const wd = new Date(day).getDay();
    if (wd === 0 || wd === 6) continue;
    blocks.push({ id: `seed_am_${d}`, title: 'Classes (P1–P4)', kind: 'class', start: at(day, '08:00'), end: at(day, '11:30'), flexibility: 'fixed', source: 'seed', placeId: 'school' });
    blocks.push({ id: `seed_pm_${d}`, title: 'Classes (P5–P7)', kind: 'class', start: at(day, '12:15'), end: at(day, '15:00'), flexibility: 'fixed', source: 'seed', placeId: 'school' });
    if (wd === 1 || wd === 3) blocks.push({ id: `seed_prac_${d}`, title: 'Soccer practice', kind: 'event', start: at(day, '16:00'), end: at(day, '18:15'), flexibility: 'fixed', source: 'seed', placeId: 'school', importance: 'normal' });
  }
  const thu = addDays(mon, 3) < today ? addDays(mon, 10) : addDays(mon, 3);
  blocks.push({ id: 'seed_chem', title: 'Chem test', kind: 'event', start: at(thu, '09:00'), end: at(thu, '09:50'), flexibility: 'fixed', source: 'seed', placeId: 'school', importance: 'aggressive' });
  const sat = addDays(today, (6 - new Date(today).getDay() + 7) % 7 || 7);
  blocks.push({ id: 'seed_jake_dinner', title: 'Dinner with Jake', kind: 'event', mealType: 'dinner', start: at(sat, '19:00'), end: at(sat, '20:30'), flexibility: 'fixed', source: 'seed', importance: 'aggressive' });

  const tasks: Task[] = [
    { id: 'seed_math', title: 'Math worksheet 4.3', durationMin: 35, due: at(addDays(today, 1), '08:00'), priority: 1, needsFocus: true, createdAt: now - DAY, location: 'anywhere' },
    { id: 'seed_chemstudy', title: 'Study for chem test', durationMin: 150, due: at(thu, '08:30'), priority: 1, needsFocus: true, chunkable: true, createdAt: now - 2 * DAY, importance: 'aggressive' },
    { id: 'seed_spanish', title: 'Spanish vocab flashcards', durationMin: 20, due: at(addDays(today, 2), '08:00'), priority: 2, createdAt: now - DAY },
    { id: 'seed_poster', title: 'Buy poster board', durationMin: 25, priority: 3, location: 'outside', createdAt: now - DAY },
    { id: 'seed_room', title: 'Clean room', durationMin: 30, priority: 3, location: 'home', createdAt: now - 3 * DAY, subtasks: [{ id: 's1', title: 'Laundry', done: false }, { id: 's2', title: 'Desk', done: true }] },
    { id: 'seed_email', title: 'Email coach about Saturday', durationMin: 10, priority: 2, createdAt: now },
  ];

  const routines: Routine[] = [
    { id: 'rt_commute', title: 'Walk to school', kind: 'routine', days: [1, 2, 3, 4, 5], start: '07:40', durationMin: 15, flexibility: 'fixed' },
    { id: 'rt_gym', title: 'Gym', kind: 'routine', days: [2, 6], start: '17:00', durationMin: 60, flexibility: 'movable', windowMin: 120, placeId: 'gym' },
  ];

  const activities: Activity[] = [
    { id: 'act_read', name: 'Read for fun', durationMin: 30, energy: 'neutral', weeklyTarget: 3, category: 'reading', location: 'anywhere' },
    { id: 'act_movie', name: 'Movie', durationMin: 120, energy: 'neutral', weeklyTarget: 1, category: 'movie', location: 'home' },
    { id: 'act_friends', name: 'Hang out with friends', durationMin: 120, energy: 'energizing', weeklyTarget: 1, category: 'friends', social: true },
    { id: 'act_gaming', name: 'Gaming', durationMin: 60, energy: 'neutral', weeklyTarget: 2, category: 'gaming', location: 'home' },
    { id: 'act_nap', name: 'Nap', durationMin: 25, energy: 'energizing', category: 'nap', location: 'home' },
    { id: 'act_walk', name: 'Walk outside', durationMin: 20, energy: 'energizing', category: 'other', location: 'anywhere' },
    { id: 'act_family', name: 'Family time', durationMin: 60, energy: 'neutral', category: 'family', location: 'home' },
  ];

  const people: Person[] = [
    { id: 'p_mom', name: 'Mom', relationship: 'mom', closeness: 1, birthday: md(addDays(today, 20)), interests: ['gardening', 'coffee', 'reading'], foodLikes: ['italian', 'thai'], dietary: ['vegetarian'], giftIdeas: ['Herb garden kit'], pastGifts: [{ year: new Date(now).getFullYear() - 1, gift: 'Book light' }], budget: 35, notes: [], source: 'manual' },
    { id: 'p_jake', name: 'Jake', relationship: 'friend', closeness: 1, birthday: md(addDays(today, 54)), interests: ['fishing', 'gaming'], foodLikes: ['mexican', 'burgers'], dietary: [], giftIdeas: [], pastGifts: [], budget: 25, notes: [], source: 'manual' },
    { id: 'p_grandma', name: 'Grandma', relationship: 'grandma', closeness: 2, birthday: { month: 3, day: 3 }, interests: ['baking', 'plants'], foodLikes: ['italian'], dietary: ['no pork'], giftIdeas: [], pastGifts: [], budget: 30, notes: ['likes phone calls on Sundays'], source: 'manual' },
    { id: 'p_priya', name: 'Priya', relationship: 'friend', closeness: 2, birthday: md(addDays(today, 9)), interests: ['music', 'art'], foodLikes: ['thai', 'indian'], dietary: ['vegetarian'], giftIdeas: [], pastGifts: [], budget: 20, notes: [], source: 'manual' },
  ];

  // Behavior history (4 weeks) so the habit model has something to say.
  const logs: LogEntry[] = [];
  const L = (e: Omit<LogEntry, 'id'>) => logs.push({ id: `seedlog_${hashId(JSON.stringify(e))}_${logs.length}`, ...e });
  for (let d = -28; d < 0; d++) {
    const day = addDays(today, d); const wd = new Date(day).getDay();
    const weekday = wd >= 1 && wd <= 5;
    const lunch = at(day, weekday ? '11:35' : '12:40');
    L({ at: lunch, action: 'completed', key: 'meal:lunch', actualStart: lunch, actualEnd: lunch + 25 * MIN, placeId: weekday ? 'school' : 'home' });
    const dinner = at(day, '18:30') + ((d * 7) % 3) * 5 * MIN;
    L({ at: dinner, action: 'completed', key: 'meal:dinner', actualStart: dinner, actualEnd: dinner + 40 * MIN, placeId: 'home' });
    if (wd === 2 || wd === 4) { const n = at(day, '15:30'); L({ at: n, action: 'completed', key: 'hobby:nap', actualStart: n, actualEnd: n + 25 * MIN, placeId: 'home' }); }
    if (wd === 0 || wd === 3) { const r = at(day, '21:00'); L({ at: r, action: 'completed', key: 'hobby:reading', actualStart: r, actualEnd: r + 30 * MIN, placeId: 'home' }); }
    if (weekday) {
      const good = at(day, wd % 2 ? '19:45' : '16:15');
      L({ at: good, action: 'completed', key: 'task:focus', focus: true, plannedStart: good, actualStart: good, actualEnd: good + 45 * MIN });
      const late = at(day, '22:00');
      if (d % 2 === 0) L({ at: late, action: 'skipped', key: 'task:focus', focus: true, plannedStart: late });
    }
  }
  const friends = at(addDays(today, -9), '16:00');
  L({ at: friends, action: 'completed', key: 'hobby:friends', actualStart: friends, actualEnd: friends + 150 * MIN, placeId: 'jake' });
  for (let i = 0; i < 4; i++) L({ at: now - (i + 1) * 2 * DAY, action: 'dismissed', key: 'reminder:hobby' });
  L({ at: now - DAY, action: 'accepted', key: 'suggest:hobby:act_walk' });
  L({ at: now - 3 * DAY, action: 'rejected', key: 'suggest:hobby:act_gaming' });

  const s = defaultSettings();
  s.homePlaceId = 'home';
  s.searchArea = 'Midtown';
  store.upsert('places', places);
  store.upsert('travel', travel);
  store.upsert('blocks', blocks);
  store.upsert('tasks', tasks);
  store.upsert('routines', routines);
  store.upsert('activities', activities);
  store.upsert('people', people);
  store.upsert('logs', logs);
  store.setKV('settings', s);
  store.setKV('food', { favorites: ['tacos', 'pasta'], cuisines: ['thai', 'mexican'], dislikes: ['mushrooms'], dietary: [], budget: [5, 20], kitchenNote: 'rice, eggs, pasta, tortillas, cheese, frozen veggies' });
  store.setKV('currentPlaceId', now - today > 8 * 3_600_000 && now - today < 15 * 3_600_000 && new Date(now).getDay() % 6 ? 'school' : 'home');
  store.setKV('placeSource', 'manual');

  // Two school projects with milestones + starter kits
  A.createProject({ title: 'Bio lab report: enzyme activity', course: 'Biology', due: at(addDays(today, 6), '08:00'), source: 'seed', externalId: 'seed_bio' });
  A.createProject({ title: 'History essay: causes of WWI', course: 'World History', due: at(addDays(today, 13), '08:00'), source: 'seed', externalId: 'seed_hist', description: 'Argumentative essay, 1200–1500 words, at least 3 sources.' });
  A.refreshLearning();
  A.syncOccasions();
  A.runPlan('week');
  store.history = new (store.history.constructor as any)(80); // nothing to undo after seeding
  await store.repo.setKV('seeded', true);
}

function md(t: number) { const d = new Date(t); return { month: d.getMonth() + 1, day: d.getDate() }; }
