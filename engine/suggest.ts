import type { Task, Activity, Block, Place, TravelTime, Settings, Habit, LogEntry, Ms, ID, FoodProfile } from './types';
import { MIN, HOUR, DAY, fmtDur, minutesOfDay, fmtDay, weekday } from './time';
import { canDoAt } from './location';
import { lastMealEnd, suggestFood, type NearbyPlace } from './meals';
import { lastDone } from './habits';

// "I have X minutes at Y, what should I do?" — ranked, explained suggestions.

export interface Suggestion {
  id: string;               // stable key used for learning ("task:<id>", "hobby:<id>", "food:<id>", "nap", "break")
  title: string;
  minutes: number;
  kind: 'task' | 'hobby' | 'food' | 'nap' | 'break';
  why: string;
  score: number;
  taskId?: ID; activityId?: ID;
  link?: string;
  parts?: Record<string, number>;
}

export interface SuggestInput {
  now: Ms;
  minutes: number;
  placeId?: ID;
  tasks: Task[];
  activities: Activity[];
  blocks: Block[];
  places: Place[];
  travel: TravelTime[];
  settings: Settings;
  habits?: Habit[];
  logs?: LogEntry[];
  acceptance?: Record<string, number>;
  blocked?: string[];       // "don't suggest this again"
  energy?: number[];
  food?: FoodProfile;
  nearby?: NearbyPlace[];
  limit?: number;
}

export function suggest(i: SuggestInput): Suggestion[] {
  const W = i.settings.weights;
  const energy = (i.energy ?? i.settings.energyByHour)[new Date(i.now).getHours()] ?? 0.5;
  const place = i.places.find(p => p.id === i.placeId);
  const acc = i.acceptance ?? {};
  const blocked = new Set(i.blocked ?? []);
  const logs = i.logs ?? [];
  const out: Suggestion[] = [];
  const add = (s: Suggestion) => { if (!blocked.has(s.id)) out.push(s); };
  const learned = (key: string) => W.learnedAcceptance * (acc[key] ?? 0);

  // --- Tasks -------------------------------------------------------------
  for (const t of i.tasks) {
    if (t.done) continue;
    if (!canDoAt(t.location, place)) continue;
    const scheduled = i.blocks.filter(b => b.taskId === t.id && b.status === 'done').reduce((s, b) => s + (b.end - b.start) / MIN, 0);
    const remaining = Math.max(0, t.durationMin - scheduled);
    if (remaining <= 0) continue;
    const doable = Math.min(remaining, i.minutes);
    if (doable < Math.min(15, remaining)) continue;
    const parts: Record<string, number> = {};
    // time fit: whole task fits ↔ meaningful chunk
    parts.timeFit = W.timeFit * (remaining <= i.minutes ? 1 - (i.minutes - remaining) / (i.minutes * 2) : (t.chunkable ?? t.durationMin > 60) ? 0.6 * (doable / remaining + 0.3) : -1);
    const hoursLeft = t.due !== undefined ? (t.due - i.now) / HOUR : Infinity;
    parts.deadline = W.deadline * (hoursLeft === Infinity ? 0.05 : hoursLeft < 0 ? 1.2 : Math.max(0, 1 - hoursLeft / (7 * 24)));
    parts.priority = W.priority * ((4 - t.priority) / 3) * 0.6;
    parts.energy = t.needsFocus ? W.energy * (energy - 0.5) * 1.5 : W.energy * 0.1;
    parts.location = t.location && t.location !== 'anywhere' ? W.location * 0.5 : 0;
    parts.learned = learned(`task:${t.id}`) + learned(t.needsFocus ? 'kind:focus' : 'kind:task');
    const score = sum(parts);
    const why = [
      remaining <= i.minutes ? `fits in ${fmtDur(i.minutes)}` : `${fmtDur(doable)} of ${fmtDur(remaining)} left`,
      t.due !== undefined ? (hoursLeft < 0 ? 'overdue' : `due ${fmtDay(t.due, i.now)}`) : '',
      t.needsFocus ? (energy >= 0.6 ? 'good focus hour for you' : 'needs focus — energy is lower now') : '',
      t.location && t.location !== 'anywhere' && place ? `can do it at ${place.name}` : '',
    ].filter(Boolean).join(' · ');
    add({ id: `task:${t.id}`, title: remaining <= i.minutes ? t.title : `Work on ${t.title}`, minutes: doable, kind: 'task', why, score, taskId: t.id, parts });
  }

  // --- Hobbies / recharge -----------------------------------------------
  for (const a of i.activities) {
    if (a.durationMin > i.minutes + 5) continue;
    if (!canDoAt(a.location, place) && !(a.placeId && a.placeId === i.placeId)) continue;
    if (a.category === 'nap') continue; // handled below
    const parts: Record<string, number> = {};
    parts.timeFit = W.timeFit * (1 - Math.abs(i.minutes - a.durationMin) / Math.max(i.minutes, a.durationMin)) * 0.8;
    const last = lastDone(logs, `hobby:${a.category}`, [], i.now) ?? lastDone(logs, `hobby:${a.id}`, [], i.now);
    const daysSince = last !== undefined ? (i.now - last) / DAY : 7;
    parts.staleness = W.hobbyStaleness * Math.min(1, daysSince / 7);
    parts.energy = a.energy === 'energizing' ? W.energy * (0.6 - energy) : a.energy === 'draining' ? W.energy * (energy - 0.6) : 0;
    const h = i.habits?.find(x => x.key === `hobby:${a.category}`);
    const m = minutesOfDay(i.now);
    parts.habit = h && m >= h.windowStart - 30 && m <= h.windowEnd && (h.weekdays.length === 0 || h.weekdays.includes(weekday(i.now))) ? W.habit * h.confidence : 0;
    parts.learned = learned(`hobby:${a.id}`);
    const why = [
      daysSince >= 3 ? `${Math.floor(daysSince)} days since you last did this` : '',
      parts.habit > 0 ? 'you usually do this around now' : '',
      a.energy === 'energizing' && energy < 0.5 ? 'a pick-me-up for a low-energy hour' : '',
      `${fmtDur(a.durationMin)}`,
    ].filter(Boolean).join(' · ');
    add({ id: `hobby:${a.id}`, title: a.name, minutes: a.durationMin, kind: 'hobby', why, score: sum(parts), activityId: a.id, parts });
  }

  // --- Nap ---------------------------------------------------------------
  const napLen = i.settings.napLengthMin;
  const hour = new Date(i.now).getHours();
  if (i.minutes >= napLen && (!place || place.tags.includes('home') || place.tags.includes('quiet')) && hour >= 12 && hour < 18) {
    const h = i.habits?.find(x => x.key === 'hobby:nap');
    const parts = { energy: W.energy * (0.6 - energy) * 1.5, habit: h && h.weekdays.includes(weekday(i.now)) ? W.habit * h.confidence : 0, learned: learned('nap') };
    add({ id: 'nap', title: `Nap (${napLen}m)`, minutes: napLen, kind: 'nap', why: [energy < 0.6 ? 'energy usually dips around now' : '', parts.habit ? 'you often nap today' : ''].filter(Boolean).join(' · ') || 'short recharge', score: sum(parts), parts });
  }

  // --- Food --------------------------------------------------------------
  const lastMeal = lastMealEnd(i.blocks, i.now);
  const hrsSinceMeal = lastMeal !== undefined ? (i.now - lastMeal) / HOUR : 4;
  if (hrsSinceMeal >= 3 && i.food) {
    const opts = suggestFood({ minutes: i.minutes, placeId: i.placeId, places: i.places, travel: i.travel, profile: i.food, acceptance: acc, nearby: i.nearby });
    const top = opts.find(o => o.fits);
    if (top) {
      const parts = { hunger: W.mealHunger * Math.min(1.5, (hrsSinceMeal - 2.5) / 2), timeFit: W.timeFit * 0.5, learned: learned(`food:${top.id}`) };
      add({ id: `food:${top.id}`, title: `Eat: ${top.title}`, minutes: top.minutes, kind: 'food', why: `${Math.floor(hrsSinceMeal)}h since you last ate · ${top.mode} · ${top.why}`, score: sum(parts), link: top.link, parts });
    }
  }

  // --- Always offer a real break when the window is short ----------------
  if (i.minutes <= 20) add({ id: 'break', title: 'Take a real break (walk, water, stretch)', minutes: Math.min(10, i.minutes), kind: 'break', why: 'short window — recharge instead of cramming', score: 0.8 + learned('break') });

  return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, i.limit ?? 5);
}

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
