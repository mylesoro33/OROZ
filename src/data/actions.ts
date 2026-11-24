import type { Block, Task, Person, Reminder, Importance, Project, Activity, Habit } from '@engine/types';
import { plan, planDay, planWeek, type PlanResult } from '@engine/planner';
import { replanFromNow, pushRest, autoReflow } from '@engine/reflow';
import { suggest, type Suggestion } from '@engine/suggest';
import { type Capture, captureDue } from '@engine/parser';
import { buildReminder, autoImportance, learnReminderBias, reminderCategory } from '@engine/reminders';
import { learnHabits, learnEnergy, learnAcceptance } from '@engine/habits';
import { planMilestones, classifyAssignment, generateStarterKit } from '@engine/projects';
import { personOccasions, holidays, occasionStages, stagesToTasks, isInLeadWindow } from '@engine/occasions';
import { MIN, HOUR, DAY, at, addDays, startOfDay, uid, hashId, fmtTime, minutesOfDay } from '@engine/time';
import { Timeline, candidateStarts } from '@engine/timeline';
import { suggestFood } from '@engine/meals';
import { store } from './store';

const S = () => store().state;
const now = () => Date.now();

export function energy(): number[] { return learnEnergy(S().logs, now(), S().settings.energyByHour); }
export function acceptance() { return learnAcceptance(S().logs, now()); }

function planInputs() {
  const s = S();
  return {
    now: now(), blocks: s.blocks, tasks: s.tasks, routines: s.routines, activities: s.activities,
    settings: s.settings, places: s.places, travel: s.travel, habits: s.habits, energy: energy(), currentPlaceId: s.currentPlaceId,
  };
}

export function runPlan(range: 'day' | 'week' | 'tomorrow'): PlanResult {
  const i = planInputs();
  const r = range === 'week' ? planWeek(i) : range === 'tomorrow' ? planDay({ ...i, day: addDays(i.now, 1) }) : planDay(i);
  store().commitBlocks(r.blocks);
  syncReminders();
  return r;
}

export function fellApart(): PlanResult {
  const r = replanFromNow(planInputs());
  store().commitBlocks(r.blocks);
  syncReminders();
  return r;
}

export function pushBy(minutes: number) {
  const r = pushRest(S().blocks, now(), minutes, S().settings);
  store().commitBlocks(r.blocks);
  syncReminders();
  return r;
}

/** Place just these tasks without disturbing the rest of the plan. */
export function placeTasks(tasks: Task[], days = 7): PlanResult {
  const i = planInputs();
  const r = plan({ ...i, tasks, routines: [], activities: [], rangeStart: i.now, rangeEnd: addDays(startOfDay(i.now), days), replan: false });
  // only keep task/travel blocks from this pass (meals/sleep already exist or will be planned)
  const extra = r.added.filter(b => b.taskId || b.kind === 'travel');
  store().commitBlocks([...S().blocks, ...extra]);
  syncReminders();
  return { ...r, added: extra };
}

// ---------------------------------------------------------------------------
// Block edits (drag, resize, create)
// ---------------------------------------------------------------------------
export function moveBlock(id: string, start: number, end: number, reflow = false) {
  const s = S();
  const b = s.blocks.find(x => x.id === id); if (!b) return;
  const moved: Block = { ...b, start, end, source: b.source === 'planner' ? 'manual' : b.source, reason: 'You placed this' };
  let blocks = s.blocks.map(x => (x.id === id ? moved : x));
  if (reflow) blocks = autoReflow(blocks, Math.min(start, b.start, now()), at(addDays(start, 1), 4 * 60), s.settings, [id]).blocks;
  store().commitBlocks(blocks);
  store().log({ action: 'moved', key: logKey(b), plannedStart: b.start, plannedEnd: b.end, actualStart: start, actualEnd: end, focus: b.focus, placeId: b.placeId });
  syncReminders();
}
export function reflowAround(id: string) {
  const s = S(); const b = s.blocks.find(x => x.id === id); if (!b) return;
  store().commitBlocks(autoReflow(s.blocks, Math.max(now(), startOfDay(b.start)), at(addDays(b.start, 1), 4 * 60), s.settings, [id]).blocks);
  syncReminders();
}
export function createBlock(partial: Partial<Block> & { start: number; end: number; title: string }) {
  const b: Block = { id: uid('blk'), kind: 'event', flexibility: 'movable', source: 'manual', ...partial } as Block;
  b.importance ??= autoImportance({ title: b.title, kind: b.kind, now: now() });
  store().commitBlocks([...S().blocks, b]);
  syncReminders();
  return b;
}
export function updateBlock(id: string, patch: Partial<Block>) {
  store().commitBlocks(S().blocks.map(b => (b.id === id ? { ...b, ...patch } : b)));
  syncReminders();
}
export function deleteBlock(id: string) { store().commitBlocks(S().blocks.filter(b => b.id !== id)); syncReminders(); }

export function logKey(b: Block): string {
  if (b.kind === 'meal') return `meal:${b.mealType ?? 'meal'}`;
  if (b.kind === 'nap') return 'hobby:nap';
  if (b.kind === 'hobby' || b.activityId) {
    const a = S().activities.find(x => x.id === b.activityId);
    return `hobby:${a?.category ?? b.title.toLowerCase()}`;
  }
  if (b.taskId) return b.focus ? 'task:focus' : 'task';
  return b.kind;
}

export function completeBlock(b: Block) {
  const t = now();
  const actualEnd = Math.min(t, b.end) > b.start ? Math.min(t, b.end) : b.end;
  updateBlock(b.id, { status: 'done', end: b.status === 'active' ? Math.max(b.start + 5 * MIN, t) : b.end });
  store().log({ action: 'completed', key: logKey(b), plannedStart: b.start, plannedEnd: b.end, actualStart: b.start, actualEnd, focus: b.focus, placeId: b.placeId ?? S().currentPlaceId });
  const task = b.taskId ? S().tasks.find(x => x.id === b.taskId) : undefined;
  if (task) {
    const doneMin = S().blocks.filter(x => x.taskId === task.id && x.status === 'done').reduce((s, x) => s + (x.end - x.start) / MIN, 0);
    if (doneMin >= task.durationMin - 5) store().upsert('tasks', [{ ...task, done: true }]);
  }
  const rem = S().reminders.find(r => r.itemId === b.id);
  if (rem) store().upsert('reminders', [{ ...rem, done: true }]);
}
export function skipBlock(b: Block) {
  updateBlock(b.id, { status: 'skipped' });
  store().log({ action: 'skipped', key: logKey(b), plannedStart: b.start, plannedEnd: b.end, focus: b.focus, placeId: b.placeId });
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------
export function getSuggestions(minutes: number, placeName?: string): Suggestion[] {
  const s = S();
  const place = placeName ? s.places.find(p => p.name.toLowerCase() === placeName.toLowerCase() || p.tags.includes(placeName as any)) : undefined;
  return suggest({
    now: now(), minutes, placeId: place?.id ?? s.currentPlaceId, tasks: s.tasks, activities: s.activities, blocks: s.blocks,
    places: s.places, travel: s.travel, settings: s.settings, habits: s.habits, logs: s.logs, acceptance: acceptance(),
    blocked: s.blockedSuggestions, energy: energy(), food: s.food,
  });
}

export function foodOptions(minutes: number) {
  const s = S();
  return suggestFood({ minutes, placeId: s.currentPlaceId, places: s.places, travel: s.travel, profile: s.food, acceptance: acceptance(), homePlaceId: s.settings.homePlaceId, areaLabel: s.settings.searchArea });
}

export function doNow(sg: { id: string; title: string; minutes: number; taskId?: string; activityId?: string; kind: string }) {
  const t = now();
  const start = Math.floor(t / MIN) * MIN;
  const task = sg.taskId ? S().tasks.find(x => x.id === sg.taskId) : undefined;
  const b = createBlock({
    title: sg.title.replace(/^Eat: /, ''), start, end: start + sg.minutes * MIN, status: 'active', flexibility: 'fixed',
    kind: sg.kind === 'food' ? 'meal' : sg.kind === 'nap' ? 'nap' : sg.kind === 'hobby' ? 'hobby' : 'task',
    mealType: sg.kind === 'food' ? 'snack' : undefined, taskId: sg.taskId, activityId: sg.activityId, focus: task?.needsFocus,
    placeId: S().currentPlaceId, source: 'manual', reason: 'Started from a suggestion',
  });
  store().log({ action: 'accepted', key: `suggest:${sg.id}` });
  // nudge anything overlapping out of the way
  reflowAround(b.id);
  return b;
}

export function scheduleLater(sg: Suggestion) {
  store().log({ action: 'accepted', key: `suggest:${sg.id}` });
  if (sg.taskId) { const t = S().tasks.find(x => x.id === sg.taskId); if (t) return placeTasks([t]); }
  const slot = nextSlot(sg.minutes, now() + 30 * MIN);
  if (slot) createBlock({ title: sg.title.replace(/^Eat: /, ''), start: slot, end: slot + sg.minutes * MIN, kind: sg.kind === 'nap' ? 'nap' : sg.kind === 'food' ? 'meal' : 'hobby', activityId: sg.activityId, flexibility: 'optional', reason: `Next open ${sg.minutes}m slot` });
}
export function skipSuggestion(sg: Suggestion) { store().log({ action: 'rejected', key: `suggest:${sg.id}` }); }
export function neverSuggest(sg: Suggestion) {
  store().log({ action: 'blocked', key: `suggest:${sg.id}` });
  store().setKV('blockedSuggestions', [...new Set([...S().blockedSuggestions, sg.id])]);
}

/** Next free slot of `minutes` in waking hours from `from`, looking ahead `days`. */
export function nextSlot(minutes: number, from: number, opts: { days?: number; earliestMin?: number; latestMin?: number; canBump?: boolean } = {}): number | undefined {
  const s = S();
  // canBump: flexible planner work may be pushed aside (life stuff wins over productivity)
  const tl = new Timeline(s.blocks.filter(b => b.status !== 'skipped' && !(opts.canBump && b.source === 'planner' && b.flexibility !== 'fixed' && !!b.taskId)));
  for (let d = 0; d < (opts.days ?? 3); d++) {
    const day = addDays(startOfDay(from), d);
    const lo = Math.max(from, at(day, opts.earliestMin ?? (minutesOfDay(at(day, s.settings.wake)) + 30)));
    const hi = at(day, opts.latestMin ?? (minutesOfDay(at(day, s.settings.bedtime)) || 1439));
    const starts = candidateStarts(tl.free({ start: lo, end: hi }, s.settings.bufferMin), minutes);
    if (starts.length) return starts[0];
  }
  return undefined;
}

export function napNow(minutes?: number) {
  const s = S();
  const len = minutes ?? s.settings.napLengthMin;
  const habit = s.habits.find(h => h.key === 'hobby:nap');
  const t = now();
  const today = startOfDay(t);
  let start: number | undefined;
  if (habit) start = nextSlot(len, Math.max(t, at(today, habit.windowStart - 30)), { days: 2, earliestMin: habit.windowStart - 45, latestMin: habit.windowEnd + 60 });
  start ??= nextSlot(len, t, { days: 2, earliestMin: 13 * 60, latestMin: 18 * 60 });
  if (start === undefined) return undefined;
  return createBlock({ title: `Nap (${len}m)`, kind: 'nap', start, end: start + len * MIN, flexibility: 'optional', reason: habit ? `Your usual nap time (${Math.round(habit.confidence * 100)}% confident)` : 'Best early-afternoon gap' });
}

export function movieSlot() {
  const s = S();
  const movie = s.activities.find(a => a.category === 'movie');
  const len = movie?.durationMin ?? 120;
  return nextSlot(len, now(), { days: 4, canBump: true, earliestMin: 17 * 60, latestMin: Math.min(23 * 60 + 30, minutesOfDay(at(now(), s.settings.bedtime)) || 1439) });
}

// ---------------------------------------------------------------------------
// Quick capture → data
// ---------------------------------------------------------------------------
export function applyCapture(c: Capture): string {
  const s = store(); const st = S(); const t = now();
  switch (c.kind) {
    case 'task': {
      const task: Task = { id: uid('task'), title: c.title, durationMin: c.durationMin ?? 30, priority: c.priority ?? 2, due: captureDue(c), createdAt: t, chunkable: (c.durationMin ?? 30) > 60, needsFocus: /\b(study|essay|report|write|paper|project|lab|math|problem)\b/i.test(c.title), location: c.place ? (st.places.find(p => p.id === c.place!.id)?.tags[0] ?? 'anywhere') : 'anywhere' };
      task.importance = autoImportance({ title: task.title, kind: 'task', dueAt: task.due, priority: task.priority, now: t });
      s.upsert('tasks', [task]);
      const r = placeTasks([task]);
      return r.added.length ? `Added "${task.title}" and placed it ${fmtTime(r.added[0].start)}` : `Added "${task.title}" — ${r.unplaced[0]?.reason ?? 'not scheduled yet'}`;
    }
    case 'event': case 'meal': case 'hobby': {
      const start = c.start ?? (nextSlot(c.durationMin ?? 60, t) ?? t);
      const kind = c.kind === 'hobby' ? (c.activity === 'nap' ? 'nap' : 'hobby') : c.mealType ? 'meal' : 'event';
      const activity = c.activity ? st.activities.find(a => a.category === c.activity) : undefined;
      const b = createBlock({ title: c.title, start, end: start + (c.durationMin ?? 60) * MIN, kind, mealType: c.mealType, activityId: activity?.id, placeId: c.place?.id, flexibility: c.kind === 'event' ? 'fixed' : 'movable', source: 'capture', reason: 'From quick capture' });
      if (b.flexibility === 'fixed') reflowAround(b.id);
      return `Added ${b.title} ${fmtTime(b.start)}`;
    }
    case 'reminder': {
      const due = c.start ?? at(c.day ?? t, c.timeMin ?? 9 * 60);
      const imp = autoImportance({ title: c.title, now: t }, learnReminderBias(st.logs, t));
      const r = buildReminder({ id: uid('rem'), itemId: uid('r'), itemType: 'reminder', title: c.title, dueAt: due, importance: imp === 'passive' ? 'normal' : imp, now: t, settings: st.settings, leadMin: 0 });
      s.upsert('reminders', [r]);
      return `Reminder set: ${c.title}, ${fmtTime(due)}`;
    }
    case 'birthday': case 'anniversary': {
      const p = findOrCreatePerson(c.person ?? 'Someone');
      const field = c.kind === 'birthday' ? 'birthday' : 'anniversary';
      s.upsert('people', [{ ...p, [field]: c.month ? { month: c.month, day: c.dayOfMonth! } : p[field] }]);
      syncOccasions();
      return `Saved ${c.title}`;
    }
    case 'food_pref': {
      const f = { ...st.food };
      const field = c.pref!.field as 'dislikes' | 'cuisines' | 'favorites' | 'dietary';
      f[field] = [...new Set([...(f[field] as string[]), c.pref!.value])];
      s.setKV('food', f);
      return `Food profile: ${field} + ${c.pref!.value}`;
    }
    case 'person_pref': {
      const p = findOrCreatePerson(c.pref!.target);
      const field = c.pref!.field as 'interests' | 'foodLikes' | 'dietary' | 'notes';
      s.upsert('people', [{ ...p, [field]: [...new Set([...(p[field] as string[]), c.pref!.value])] }]);
      return `${p.name}: ${field} + ${c.pref!.value}`;
    }
    case 'note': default: {
      s.upsert('notes', [{ id: uid('note'), text: c.raw, at: t }]);
      return 'Saved as a note';
    }
  }
}

export function findOrCreatePerson(name: string): Person {
  const existing = S().people.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const rel = /^(mom|dad|grandma|grandpa|sister|brother|aunt|uncle)$/i.test(name) ? name.toLowerCase() : 'friend';
  const p: Person = { id: uid('person'), name, relationship: rel, closeness: rel === 'friend' ? 2 : 1, interests: [], foodLikes: [], dietary: [], giftIdeas: [], pastGifts: [], notes: [], source: 'manual' };
  store().upsert('people', [p]);
  return p;
}

// ---------------------------------------------------------------------------
// Reminders: rebuild for upcoming items, keep user overrides.
// ---------------------------------------------------------------------------
export function syncReminders() {
  const st = S(); const t = now();
  const bias = learnReminderBias(st.logs, t);
  const horizon = t + 3 * DAY;
  const existing = new Map(st.reminders.map(r => [r.id, r]));
  const next: Reminder[] = [];
  const keep = new Set<string>();
  const upsertFor = (itemId: string, itemType: Reminder['itemType'], title: string, dueAt: number, auto: Importance, leadMin = 30) => {
    const id = `rem_${hashId(itemType + itemId)}`;
    keep.add(id);
    const old = existing.get(id);
    const importance = old?.importanceSetBy === 'user' ? old.importance : auto;
    if (old && old.dueAt === dueAt && old.importance === importance && old.title === title) return;
    const r = buildReminder({ id, itemId, itemType, title, dueAt, importance, importanceSetBy: old?.importanceSetBy, now: t, settings: st.settings, leadMin });
    if (old) { r.done = old.done; r.firedStages = r.stages.map((s, i) => (s.at <= t ? i : -1)).filter(i => i >= 0); }
    next.push(r);
  };
  for (const b of st.blocks) {
    if (b.start < t - HOUR || b.start > horizon || b.status === 'done' || b.status === 'skipped') continue;
    if (['class', 'sleep', 'travel', 'buffer'].includes(b.kind)) continue;
    if (b.kind === 'meal' && b.mealType !== 'snack' && b.source === 'planner') continue; // meals are protected silently
    const auto = b.importance && b.source !== 'planner' ? b.importance : autoImportance({ title: b.title, kind: b.kind, now: t }, bias);
    upsertFor(b.id, 'block', b.title, b.start, auto, b.mealType === 'snack' ? 15 : 30);
  }
  for (const task of st.tasks) {
    if (task.done || !task.due || task.due < t || task.due > t + 7 * DAY) continue;
    upsertFor(task.id, 'task', `Due: ${task.title}`, task.due, task.importance ?? autoImportance({ title: task.title, kind: 'task', dueAt: task.due, priority: task.priority, now: t }, bias), 12 * 60);
  }
  const stale = st.reminders.filter(r => r.itemType !== 'reminder' && r.itemType !== 'occasion' && !keep.has(r.id) && !r.done).map(r => r.id);
  if (next.length) store().upsert('reminders', next);
  store().remove('reminders', stale);
}

export function setReminderImportance(r: Reminder, imp: Importance) {
  const st = S();
  store().upsert('reminders', [{ ...r, importance: imp, importanceSetBy: 'user', stages: buildReminder({ itemId: r.itemId, itemType: r.itemType, title: r.title, dueAt: r.dueAt, importance: imp, now: now(), settings: st.settings }).stages, firedStages: [] }]);
  store().log({ action: imp === 'passive' ? 'dismissed' : 'accepted', key: `reminder:${r.category ?? reminderCategory(r.title)}` });
}

// ---------------------------------------------------------------------------
// Projects, occasions, learning
// ---------------------------------------------------------------------------
export function createProject(a: { title: string; due: number; course?: string; description?: string; source: Project['source']; externalId?: string }): Project {
  const st = S(); const t = now();
  const existing = a.externalId ? st.projects.find(p => p.externalId === a.externalId) : undefined;
  const { effortMin } = classifyAssignment(a.title, a.description);
  const id = existing?.id ?? uid('proj');
  const mp = planMilestones({ id, title: a.title, due: a.due, effortMin, course: a.course }, t);
  const project: Project = { id, title: a.title, course: a.course, due: a.due, effortMin, source: a.source, externalId: a.externalId, description: a.description, milestones: mp.milestones, warnings: mp.warnings, starterKit: existing?.starterKit };
  if (existing && existing.due === a.due) return existing;
  store().upsert('projects', [project]);
  const oldTasks = st.tasks.filter(x => x.projectId === id && !x.done).map(x => x.id);
  store().remove('tasks', oldTasks);
  store().upsert('tasks', mp.tasks);
  placeTasks(mp.tasks, Math.min(21, Math.ceil((a.due - t) / DAY) + 1));
  // Starter kit: generate in the background so it's ready before the first session.
  scheduleIdle(() => ensureStarterKit(project.id));
  return project;
}

export async function ensureStarterKit(projectId: string, force = false) {
  const p = S().projects.find(x => x.id === projectId);
  if (!p || (p.starterKit && !force)) return;
  let kit = generateStarterKit(p, now());
  if (S().settings.flags.llm && S().settings.llmApiKey) {
    try { const { llmStarterKit } = await import('../integrations/llm'); kit = (await llmStarterKit(p, S().settings.llmApiKey!)) ?? kit; } catch (e) { console.warn('LLM starter kit failed, using rules', e); }
  }
  const fresh = S().projects.find(x => x.id === projectId);
  if (fresh) store().upsert('projects', [{ ...fresh, starterKit: kit }]);
}

export function scheduleIdle(fn: () => void) {
  const ric = (globalThis as any).requestIdleCallback as ((cb: () => void) => void) | undefined;
  if (ric) ric(fn); else setTimeout(fn, 200);
}

/** Create staged prep tasks (brainstorm → order → wrap → reserve) for occasions entering their lead window. */
/** Gift holidays prep automatically; others (Thanksgiving, Halloween…) are one tap away in People. */
const AUTO_PREP_HOLIDAYS = new Set(['Christmas', "Mother's Day", "Father's Day"]);
export function syncOccasions() {
  const st = S(); const t = now();
  const occ = [...personOccasions(st.people, t), ...holidays(t).filter(h => AUTO_PREP_HOLIDAYS.has(h.title))];
  const have = new Set(st.tasks.map(x => x.id));
  const add: Task[] = [];
  for (const o of occ) {
    const person = st.people.find(p => p.id === o.personId);
    if (!isInLeadWindow(o, person, t)) continue;
    for (const task of stagesToTasks(o, occasionStages(o, person, t), t)) if (!have.has(task.id)) add.push(task);
  }
  if (add.length) { store().upsert('tasks', add); placeTasks(add, 14); }
  return add;
}

export function refreshLearning() {
  const st = S();
  const habits = learnHabits(st.logs, now(), st.habits);
  store().upsert('habits', habits);
  const ids = new Set(habits.map(h => h.id));
  store().remove('habits', st.habits.filter(h => !ids.has(h.id)).map(h => h.id));
}
export function editHabit(h: Habit, patch: Partial<Habit>) { store().upsert('habits', [{ ...h, ...patch, status: patch.status ?? 'edited' }]); }
export function deleteHabit(h: Habit) {
  store().remove('habits', [h.id]);
  // forget its history so it isn't immediately re-learned
  store().remove('logs', S().logs.filter(l => l.key === h.key || (h.key === 'hobby:nap' && l.key === 'nap')).map(l => l.id));
}

export function protectMeal(key: string) {
  const st = S(); const h = st.habits.find(x => x.key === key); if (!h) return;
  const type = key.split(':')[1];
  const meals = st.settings.meals.map(m => (m.type === type ? { ...m, window: [hm(h.windowStart - 30), hm(h.windowEnd + 30)] as [string, string] } : m));
  store().setKV('settings', { ...st.settings, meals });
  editHabit(h, { status: 'confirmed' });
}
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function suggestFriendsSaturday() {
  const st = S(); const t = now();
  const sat = addDays(startOfDay(t), (6 - new Date(t).getDay() + 7) % 7 || 7);
  const a: Activity | undefined = st.activities.find(x => x.category === 'friends');
  const len = a?.durationMin ?? 120;
  const s = nextSlot(len, at(sat, 14 * 60), { days: 1, earliestMin: 14 * 60, latestMin: 22 * 60 });
  if (s !== undefined) createBlock({ title: a?.name ?? 'Hang out with friends', kind: 'hobby', activityId: a?.id, start: s, end: s + len * MIN, flexibility: 'optional', reason: "It's been a while since you saw friends" });
  return s;
}
