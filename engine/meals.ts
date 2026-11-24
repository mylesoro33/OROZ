import type { Block, Settings, Ms, MealSlot, FoodProfile, MealType, ID, Place, TravelTime, Task } from './types';
import { Timeline, candidateStarts } from './timeline';
import { at, parseHM, MIN, HOUR, fmtTime, hashId, startOfDay, addDays, fmtDur } from './time';
import { travelMinutes } from './location';

// ---------------------------------------------------------------------------
// Meal placement: meals are protected blocks that reflow around fixed events.
// ---------------------------------------------------------------------------

export interface MealPlacement { blocks: Block[]; warnings: string[] }

const MEAL_LABEL: Record<MealType, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };

export function placeMealsForDay(day: Ms, settings: Settings, tl: Timeline, now: Ms, wakeAt?: Ms): MealPlacement {
  const blocks: Block[] = [], warnings: string[] = [];
  const d0 = startOfDay(day);
  for (const slot of settings.meals) {
    const existing = tl.blocks.find(b => b.mealType === slot.type && b.status !== 'skipped' && startOfDay(b.start) === d0);
    if (existing) continue;
    const ws = at(d0, slot.window[0]), we = at(d0, slot.window[1]);
    if (we <= now) continue; // window already passed
    const placed = placeMeal(slot, d0, ws, we, tl, Math.max(now, wakeAt ?? 0));
    if (placed) { tl.add(placed); blocks.push(placed); }
    else warnings.push(`No room for ${slot.type} on ${new Date(d0).toDateString()} — fixed events cover the whole window. Pack something portable.`);
  }
  return { blocks, warnings };
}

function placeMeal(slot: MealSlot, d0: Ms, ws: Ms, we: Ms, tl: Timeline, earliest: Ms): Block | undefined {
  const center = ws + (we - ws) / 2;
  const tryPlace = (from: Ms, to: Ms, dur: number): Ms | undefined => {
    const free = tl.free({ start: Math.max(from, earliest), end: to }, 0);
    const starts = candidateStarts(free, dur, 5);
    if (!starts.length) return undefined;
    // closest to window center; earlier wins ties (deterministic)
    return starts.reduce((best, s) => {
      const ds = Math.abs(s + (dur * MIN) / 2 - center), db = Math.abs(best + (dur * MIN) / 2 - center);
      return ds < db ? s : best;
    });
  };
  let dur = slot.durationMin;
  let reason = `Protected ${slot.type} in your usual window`;
  let start = tryPlace(ws, we, dur);
  if (start === undefined) { dur = slot.minDurationMin; start = tryPlace(ws, we, dur); reason = `Short ${slot.type} — the window is tight today`; }
  if (start === undefined) {
    // reflow outside the window: up to 90 min either side
    start = tryPlace(ws - 90 * MIN, we + 90 * MIN, dur);
    if (start !== undefined) reason = `Moved ${slot.type} to ${fmtTime(start)} — fixed events cover the usual window`;
  }
  if (start === undefined) return undefined;
  return {
    id: `meal_${slot.type}_${hashId(String(d0))}`,
    title: MEAL_LABEL[slot.type],
    kind: 'meal', mealType: slot.type,
    start, end: start + dur * MIN,
    flexibility: 'movable', source: 'planner', reason, importance: 'passive',
  };
}

/**
 * Find long stretches with no food between wake / meals / bed and insert a snack
 * at a sensible time (just before a long fixed block if there is one).
 */
export function detectMealGaps(day: Ms, settings: Settings, tl: Timeline, wake: Ms, bed: Ms, now: Ms): Block[] {
  const d0 = startOfDay(day);
  const meals = tl.blocks.filter(b => b.mealType && b.status !== 'skipped' && b.start >= wake && b.start < bed).map(m => ({ t: m.start, end: m.end }));
  // Meal windows that already passed today (with no block) are assumed eaten.
  for (const slot of settings.meals) {
    const ws = at(d0, slot.window[0]), we = at(d0, slot.window[1]);
    if (we <= now && !meals.some(m => m.t >= ws - HOUR && m.t <= we + HOUR)) { const mid = ws + (we - ws) / 2; meals.push({ t: mid, end: mid + slot.durationMin * MIN }); }
  }
  meals.sort((a, b) => a.t - b.t);
  const points: { t: Ms; end: Ms }[] = [{ t: wake, end: wake }, ...meals, { t: bed, end: bed }];
  const out: Block[] = [];
  const maxGap = settings.maxMealGapMin * MIN;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i].end, b = points[i + 1].t;
    if (b - a <= maxGap) continue;
    if (i === points.length - 2 && b === bed && b - a <= maxGap + 2 * 3_600_000) continue; // a late evening without food is fine
    if (b < now) continue;
    // Prefer just before the longest fixed block inside the gap (e.g. practice).
    const inside = tl.blocks.filter(x => x.flexibility === 'fixed' && x.kind !== 'sleep' && x.start > Math.max(a, now + 30 * MIN) && x.start < b)
      .sort((x, y) => (y.end - y.start) - (x.end - x.start) || x.start - y.start);
    const anchor = inside[0];
    const target = anchor && anchor.end - anchor.start >= 60 * MIN ? anchor.start - 20 * MIN : a + maxGap * 0.6;
    const free = tl.free({ start: Math.max(a + 60 * MIN, now), end: b - 60 * MIN }, 0);
    const starts = candidateStarts(free, 15, 5);
    if (!starts.length) continue;
    const s = starts.reduce((best, x) => (Math.abs(x - target) < Math.abs(best - target) ? x : best));
    const snack: Block = {
      id: `snack_${hashId(`${d0}_${a}`)}`,
      title: anchor ? `Snack before ${anchor.title}` : 'Snack',
      kind: 'meal', mealType: 'snack', start: s, end: s + 15 * MIN,
      flexibility: 'optional', source: 'planner', importance: 'normal',
      reason: `${fmtDur((b - a) / MIN)} with no meal (${fmtTime(a)}–${fmtTime(b)})${anchor ? `, and ${anchor.title} runs ${fmtTime(anchor.start)}–${fmtTime(anchor.end)}` : ''}`,
    };
    tl.add(snack); out.push(snack);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Food profile helpers and suggestions (rule-based, health-neutral).
// ---------------------------------------------------------------------------

export interface FoodItem {
  id: string; name: string; minutes: number; mode: 'cook' | 'pack';
  cuisine: string; contains: string[]; ingredients: string[]; meal: MealType[];
}

/** Generic, real-world dishes (not restaurants). Balanced and varied by design. */
export const FOOD_CATALOG: FoodItem[] = [
  { id: 'quesadilla', name: 'Veggie quesadilla', minutes: 15, mode: 'cook', cuisine: 'mexican', contains: ['dairy', 'gluten'], ingredients: ['tortillas', 'cheese', 'beans', 'peppers'], meal: ['lunch', 'dinner'] },
  { id: 'stirfry', name: 'Chicken & veggie stir-fry with rice', minutes: 25, mode: 'cook', cuisine: 'chinese', contains: ['meat', 'soy'], ingredients: ['chicken', 'rice', 'frozen veggies', 'soy sauce'], meal: ['dinner'] },
  { id: 'tofu-stirfry', name: 'Tofu stir-fry with rice', minutes: 25, mode: 'cook', cuisine: 'chinese', contains: ['soy'], ingredients: ['tofu', 'rice', 'frozen veggies', 'soy sauce'], meal: ['dinner'] },
  { id: 'pasta', name: 'Pasta with tomato sauce & spinach', minutes: 20, mode: 'cook', cuisine: 'italian', contains: ['gluten'], ingredients: ['pasta', 'tomato sauce', 'spinach'], meal: ['lunch', 'dinner'] },
  { id: 'eggs-toast', name: 'Scrambled eggs on toast + fruit', minutes: 10, mode: 'cook', cuisine: 'american', contains: ['egg', 'gluten'], ingredients: ['eggs', 'bread', 'fruit'], meal: ['breakfast', 'lunch'] },
  { id: 'oats', name: 'Oatmeal with banana & peanut butter', minutes: 7, mode: 'cook', cuisine: 'american', contains: ['nuts'], ingredients: ['oats', 'banana', 'peanut butter'], meal: ['breakfast'] },
  { id: 'curry', name: 'Chickpea curry with rice', minutes: 30, mode: 'cook', cuisine: 'indian', contains: [], ingredients: ['chickpeas', 'coconut milk', 'curry paste', 'rice'], meal: ['dinner'] },
  { id: 'thai-noodles', name: 'Peanut noodles with veggies', minutes: 20, mode: 'cook', cuisine: 'thai', contains: ['nuts', 'gluten', 'soy'], ingredients: ['noodles', 'peanut butter', 'soy sauce', 'veggies'], meal: ['lunch', 'dinner'] },
  { id: 'mushroom-risotto', name: 'Mushroom risotto', minutes: 40, mode: 'cook', cuisine: 'italian', contains: ['dairy', 'mushrooms'], ingredients: ['rice', 'mushrooms', 'parmesan', 'stock'], meal: ['dinner'] },
  { id: 'tacos', name: 'Fish tacos with slaw', minutes: 25, mode: 'cook', cuisine: 'mexican', contains: ['fish', 'gluten'], ingredients: ['fish', 'tortillas', 'cabbage', 'lime'], meal: ['dinner'] },
  { id: 'pork-bowl', name: 'Pork & rice bowl', minutes: 25, mode: 'cook', cuisine: 'korean', contains: ['pork', 'meat', 'soy'], ingredients: ['pork', 'rice', 'kimchi'], meal: ['dinner'] },
  { id: 'salad-wrap', name: 'Hummus & veggie wrap', minutes: 8, mode: 'pack', cuisine: 'mediterranean', contains: ['gluten'], ingredients: ['tortillas', 'hummus', 'cucumber', 'carrots'], meal: ['lunch', 'snack'] },
  { id: 'pbj', name: 'PB&J + apple', minutes: 5, mode: 'pack', cuisine: 'american', contains: ['nuts', 'gluten'], ingredients: ['bread', 'peanut butter', 'jam', 'apple'], meal: ['lunch', 'snack'] },
  { id: 'yogurt', name: 'Yogurt, granola & berries', minutes: 3, mode: 'pack', cuisine: 'american', contains: ['dairy'], ingredients: ['yogurt', 'granola', 'berries'], meal: ['breakfast', 'snack'] },
  { id: 'trailmix', name: 'Trail mix + banana', minutes: 1, mode: 'pack', cuisine: 'american', contains: ['nuts'], ingredients: ['trail mix', 'banana'], meal: ['snack'] },
  { id: 'cheese-crackers', name: 'Cheese, crackers & grapes', minutes: 3, mode: 'pack', cuisine: 'american', contains: ['dairy', 'gluten'], ingredients: ['cheese', 'crackers', 'grapes'], meal: ['snack'] },
  { id: 'rice-cakes', name: 'Rice cakes, hummus & carrots', minutes: 3, mode: 'pack', cuisine: 'mediterranean', contains: [], ingredients: ['rice cakes', 'hummus', 'carrots'], meal: ['snack'] },
];

const DIET_EXCLUDES: Record<string, string[]> = {
  vegetarian: ['meat', 'pork', 'fish'],
  vegan: ['meat', 'pork', 'fish', 'dairy', 'egg'],
  pescatarian: ['meat', 'pork'],
  'no pork': ['pork'],
  halal: ['pork'],
  kosher: ['pork'],
  'gluten-free': ['gluten'],
  'dairy-free': ['dairy'],
  'nut-free': ['nuts'],
  'no nuts': ['nuts'],
  'no fish': ['fish'],
  'egg-free': ['egg'],
  'soy-free': ['soy'],
};
export function normalizeDiet(d: string): string { return d.trim().toLowerCase().replace(/_/g, ' ').replace(/^no-/, 'no '); }

/** Returns the reasons an item conflicts with dietary needs / dislikes (empty = OK). */
export function dietConflicts(item: { name: string; contains: string[]; ingredients?: string[] }, dietary: string[], dislikes: string[] = []): string[] {
  const out: string[] = [];
  for (const raw of dietary) {
    const d = normalizeDiet(raw);
    const ex = DIET_EXCLUDES[d] ?? (d.startsWith('no ') ? [d.slice(3)] : []);
    const hit = ex.filter(e => item.contains.includes(e));
    if (hit.length) out.push(`${d} (${hit.join(', ')})`);
  }
  const text = [item.name, ...item.contains, ...(item.ingredients ?? [])].join(' ').toLowerCase();
  for (const dis of dislikes) {
    const k = dis.toLowerCase().replace(/s$/, '');
    if (k && text.includes(k)) out.push(`dislikes ${dis}`);
  }
  return out;
}

export type FoodMode = 'dine-in' | 'takeout' | 'cook' | 'pack';
export interface FoodOption { id: string; title: string; mode: FoodMode; minutes: number; fits: boolean; why: string; link?: string; score: number; external?: boolean }

export interface NearbyPlace { name: string; cuisine?: string; travelMin: number; priceLevel?: number; url?: string; mapsUrl?: string; servesVegetarian?: boolean; source: 'places-api' }

export interface FoodContext {
  minutes: number;
  placeId?: ID;
  places: Place[];
  travel: TravelTime[];
  profile: FoodProfile;
  acceptance?: Record<string, number>; // learned: option id / cuisine → -1..1
  recent?: string[];                    // recently eaten option ids (variety)
  nearby?: NearbyPlace[];               // only when the places API is enabled
  homePlaceId?: ID;
  areaLabel?: string;
}

export function mapsSearchUrl(q: string): string { return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`; }

export function suggestFood(ctx: FoodContext): FoodOption[] {
  const { profile, minutes } = ctx;
  const place = ctx.places.find(p => p.id === ctx.placeId);
  const atHome = !!place && (place.id === ctx.homePlaceId || place.tags.includes('home'));
  const homeId = ctx.homePlaceId ?? ctx.places.find(p => p.tags.includes('home'))?.id;
  const toHome = atHome ? 0 : travelMinutes(ctx.placeId, homeId, ctx.travel, ctx.places);
  const kitchen = (profile.kitchenNote ?? '').toLowerCase();
  const opts: FoodOption[] = [];
  const acc = ctx.acceptance ?? {};

  for (const item of FOOD_CATALOG) {
    if (dietConflicts(item, profile.dietary, profile.dislikes).length) continue;
    let total = item.minutes + 5;
    let mode: FoodMode = item.mode;
    if (item.mode === 'cook') { if (!atHome && toHome * 2 + item.minutes > minutes) continue; total = item.minutes + 10 + toHome; }
    if (item.mode === 'pack' && !atHome) continue; // can only pack from home
    const fits = total <= minutes;
    const have = item.ingredients.filter(i => kitchen.includes(i.split(' ')[0])).length;
    let score = (fits ? 2 : -2) + have * 0.6;
    if (profile.cuisines.some(c => c.toLowerCase() === item.cuisine)) score += 1;
    if (profile.favorites.some(f => item.name.toLowerCase().includes(f.toLowerCase()))) score += 1.5;
    score += (acc[item.id] ?? 0) * 1.5 + (acc[`cuisine:${item.cuisine}`] ?? 0);
    if (ctx.recent?.includes(item.id)) score -= 1.5; // keep it varied
    const why = [
      `${item.minutes}m to make${toHome ? ` + ${toHome}m home` : ''}`,
      have ? `you have ${have}/${item.ingredients.length} ingredients` : '',
      profile.cuisines.includes(item.cuisine) ? `you like ${item.cuisine}` : '',
    ].filter(Boolean).join(' · ');
    opts.push({ id: item.id, title: item.name, mode, minutes: total, fits, why, score });
  }

  // Out-of-home options. Real places only come from the places API — never invented.
  if (ctx.nearby?.length) {
    for (const n of ctx.nearby) {
      if (profile.dietary.some(d => normalizeDiet(d) === 'vegetarian' || normalizeDiet(d) === 'vegan') && n.servesVegetarian === false) continue;
      const eat = minutes >= n.travelMin * 2 + 30 ? 'dine-in' : 'takeout';
      const total = n.travelMin * 2 + (eat === 'dine-in' ? 30 : 10);
      const fits = total <= minutes;
      let score = (fits ? 2 : -2) + (n.cuisine && profile.cuisines.includes(n.cuisine) ? 1 : 0) + (acc[`place:${n.name}`] ?? 0) * 1.5;
      if (n.priceLevel !== undefined && n.priceLevel * 10 > profile.budget[1]) score -= 1;
      opts.push({ id: `nearby:${n.name}`, title: n.name, mode: eat, minutes: total, fits, external: true, why: `${n.travelMin}m away${n.cuisine ? ` · ${n.cuisine}` : ''}`, link: n.mapsUrl ?? n.url, score });
    }
  } else if (!atHome || minutes >= 45) {
    const cuisine = profile.cuisines[0] ?? 'quick food';
    const area = place?.name ?? ctx.areaLabel ?? 'me';
    const diet = profile.dietary.length ? ` ${profile.dietary.join(' ')}` : '';
    opts.push({
      id: `search:${cuisine}`, title: `Search: quick ${cuisine}${diet} near ${area}`, mode: 'takeout',
      minutes: Math.min(minutes, 25), fits: minutes >= 20, external: true,
      why: 'No places API configured — opens a map search instead of guessing names',
      link: mapsSearchUrl(`${cuisine}${diet} takeout near ${area === 'me' ? '' : area}`.trim()), score: minutes >= 20 ? 1.2 : -1,
    });
  }
  return opts.sort((a, b) => b.score - a.score || a.minutes - b.minutes || a.id.localeCompare(b.id)).slice(0, 6);
}

/** Meal ideas for a cook-at-home block. */
export function mealIdeas(profile: FoodProfile, meal: MealType, n = 3, recent: string[] = []): FoodItem[] {
  const kitchen = (profile.kitchenNote ?? '').toLowerCase();
  return FOOD_CATALOG
    .filter(i => i.mode === 'cook' && i.meal.includes(meal) && !dietConflicts(i, profile.dietary, profile.dislikes).length)
    .map(i => ({ i, s: i.ingredients.filter(x => kitchen.includes(x.split(' ')[0])).length + (profile.cuisines.includes(i.cuisine) ? 1 : 0) - (recent.includes(i.id) ? 2 : 0) }))
    .sort((a, b) => b.s - a.s || a.i.id.localeCompare(b.i.id))
    .slice(0, n).map(x => x.i);
}

/** Grocery list = ingredients for chosen ideas not mentioned in the kitchen note. Returns a schedulable task. */
export function groceryTask(ideas: FoodItem[], kitchenNote: string | undefined, now: Ms, dueInDays = 2): Task | undefined {
  const k = (kitchenNote ?? '').toLowerCase();
  const need = [...new Set(ideas.flatMap(i => i.ingredients))].filter(x => !k.includes(x.split(' ')[0])).sort();
  if (!need.length) return undefined;
  return {
    id: `grocery_${hashId(need.join(','))}`,
    title: `Groceries: ${need.join(', ')}`,
    durationMin: 30, priority: 2, location: 'outside', createdAt: now,
    due: at(addDays(now, dueInDays), '18:00'), kind: 'grocery',
    subtasks: need.map((n, i) => ({ id: `g${i}`, title: n, done: false })),
  };
}

export function lastMealEnd(blocks: Block[], now: Ms): Ms | undefined {
  const past = blocks.filter(b => b.kind === 'meal' && b.end <= now && b.status !== 'skipped').sort((a, b) => b.end - a.end);
  return past[0]?.end;
}

export const _test = { parseHM };
