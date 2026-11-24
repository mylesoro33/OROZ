import type { Occasion, Person, Task, Ms } from './types';
import { DAY, at, startOfDay, addDays, hashId, fmtDay } from './time';

export function nextOccurrence(month: number, day: number, now: Ms): Ms {
  const y = new Date(now).getFullYear();
  let t = new Date(y, month - 1, day).getTime();
  if (t < startOfDay(now)) t = new Date(y + 1, month - 1, day).getTime();
  return t;
}

function nthWeekday(year: number, month: number, wd: number, n: number): Ms {
  const first = new Date(year, month, 1);
  const offset = (wd - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (n - 1) * 7).getTime();
}

export function holidays(now: Ms): Occasion[] {
  const out: Occasion[] = [];
  const y = new Date(now).getFullYear();
  for (const year of [y, y + 1]) {
    const list: [string, Ms, boolean][] = [
      ['Christmas', new Date(year, 11, 25).getTime(), true],
      ["Valentine's Day", new Date(year, 1, 14).getTime(), false],
      ["Mother's Day", nthWeekday(year, 4, 0, 2), true],
      ["Father's Day", nthWeekday(year, 5, 0, 3), true],
      ['Thanksgiving', nthWeekday(year, 10, 4, 4), true],
      ['Halloween', new Date(year, 9, 31).getTime(), false],
      ["New Year's Eve", new Date(year, 11, 31).getTime(), false],
    ];
    for (const [title, date, major] of list) if (date >= startOfDay(now)) out.push({ id: `hol_${hashId(title + year)}`, kind: 'holiday', title, date, major });
  }
  return out.sort((a, b) => a.date - b.date);
}

export function personOccasions(people: Person[], now: Ms): Occasion[] {
  const out: Occasion[] = [];
  for (const p of people) {
    if (p.birthday) out.push({ id: `bd_${p.id}`, kind: 'birthday', title: `${p.name}'s birthday`, date: nextOccurrence(p.birthday.month, p.birthday.day, now), personId: p.id });
    if (p.anniversary) out.push({ id: `an_${p.id}`, kind: 'anniversary', title: `${p.name} anniversary`, date: nextOccurrence(p.anniversary.month, p.anniversary.day, now), personId: p.id });
  }
  return out.sort((a, b) => a.date - b.date);
}

/** Lead time scales with the occasion and how close you are. */
export function leadDaysFor(o: Occasion, person?: Person): number {
  if (o.kind === 'holiday') return o.title === 'Christmas' ? 56 : o.major ? 21 : 10;
  if (o.kind === 'gathering') return 14;
  const c = person?.closeness ?? 2;
  if (o.kind === 'anniversary') return 21;
  return c === 1 ? 28 : c === 2 ? 21 : 7;
}

export type StageKey = 'brainstorm' | 'decide' | 'order' | 'wrap' | 'reserve' | 'card' | 'celebrate' | 'shopping' | 'travel' | 'outfit' | 'food';
export interface OccasionStage { key: StageKey; title: string; due: Ms; durationMin: number }

const GIFT_HOLIDAYS = new Set(['Christmas', "Valentine's Day", "Mother's Day", "Father's Day"]);

export function occasionStages(o: Occasion, person: Person | undefined, now: Ms, opts: { shippingDays?: number; dining?: boolean } = {}): OccasionStage[] {
  const lead = leadDaysFor(o, person);
  const date = o.date;
  if (date < startOfDay(now)) return [];
  const ship = opts.shippingDays ?? 5;
  const name = person?.name ?? o.title;
  const close = (person?.closeness ?? 2) <= 2;
  // Started late? Squeeze the stages proportionally into the days that are left.
  const remaining = Math.max(0, (date - startOfDay(now)) / DAY);
  const scale = remaining < lead ? remaining / lead : 1;
  const canShip = remaining >= ship + 2;
  const st: OccasionStage[] = [];
  const add = (key: StageKey, title: string, daysBefore: number, durationMin: number) =>
    st.push({ key, title, due: at(addDays(date, -Math.max(Math.floor(daysBefore * scale), Math.min(daysBefore, 1, Math.floor(remaining)))), '19:00'), durationMin });
  const gifts = o.kind !== 'holiday' || GIFT_HOLIDAYS.has(o.title);
  if (o.kind === 'holiday' || o.kind === 'gathering') {
    if (gifts) {
      add('brainstorm', `${o.title}: brainstorm gifts & plans`, lead, 20);
      add('decide', `${o.title}: decide gift list & budget`, Math.round(lead * 0.7), 20);
      add('order', canShip ? `${o.title}: order gifts (shipping ~${ship} days)` : `${o.title}: buy gifts locally (too late to ship)`, canShip ? ship + 3 : 2, 30);
      add('card', `${o.title}: cards`, 7, 30);
      add('wrap', `${o.title}: wrap gifts`, 2, 30);
    } else add('brainstorm', `${o.title}: make a plan (who, where, what to bring)`, lead, 20);
    add('shopping', `${o.title}: shopping`, 5, 60);
    if (o.major) add('travel', `${o.title}: confirm travel plans`, 10, 20);
    add('outfit', `${o.title}: outfit ready`, 2, 15);
    add('food', `${o.title}: food or reservation sorted`, o.major ? 10 : 4, 20);
  } else {
    add('brainstorm', `Brainstorm gift ideas for ${name}`, lead, 15);
    add('decide', `Decide ${name}'s gift`, Math.max(ship + 4, Math.round(lead * 0.5)), 15);
    add('order', canShip ? `Order ${name}'s gift (leave ~${ship} days shipping)` : `Buy ${name}'s gift locally (too late to ship)`, canShip ? ship + 2 : 1, 20);
    if (close) add('card', `Card for ${name}`, 3, 15);
    add('wrap', `Wrap ${name}'s gift`, 1, 15);
    if (opts.dining ?? close) add('reserve', `Reserve a dinner for ${name}`, close ? 10 : 5, 15);
  }
  st.push({ key: 'celebrate', title: o.kind === 'birthday' ? `${name}'s birthday — celebrate!` : o.title, due: at(date, '09:00'), durationMin: 0 });
  // Anything still in the past gets pulled up to "soon" (keeps its order) rather than dropped.
  const soon = remaining > 2 ? at(addDays(now, 1), '19:00') : now + 2 * 3_600_000;
  return st.map((x, i) => (x.key !== 'celebrate' && x.due < soon ? { ...x, due: soon + i * 60_000 } : x)).sort((a, b) => a.due - b.due);
}

export function stagesToTasks(o: Occasion, stages: OccasionStage[], now: Ms): Task[] {
  return stages.filter(s => s.durationMin > 0).map((s, i, arr) => ({
    notBefore: i === 0 ? undefined : Math.max(now, arr[i - 1].due - DAY),
    id: `oc_${hashId(`${o.id}_${s.key}_${new Date(o.date).getFullYear()}`)}`,
    title: s.title, durationMin: s.durationMin, due: s.due, priority: s.key === 'order' || s.key === 'reserve' ? 2 : 3,
    createdAt: now, kind: s.key === 'shopping' ? 'prep' : 'gift',
    importance: s.key === 'order' || s.key === 'reserve' ? 'aggressive' : 'normal',
    location: s.key === 'shopping' ? 'outside' : 'anywhere',
  } satisfies Task));
}

/** Is it time to start reminding? */
export function isInLeadWindow(o: Occasion, person: Person | undefined, now: Ms): boolean {
  return o.date - now <= leadDaysFor(o, person) * DAY && o.date >= startOfDay(now);
}

// ---------------------------------------------------------------------------
// Gift ideas — generic categories from interests; never specific invented products.
// ---------------------------------------------------------------------------
const GIFT_MAP: Record<string, [string, number][]> = {
  fishing: [['Tackle box organizer or lure set', 25], ['A fishing day trip together', 40], ['Fishing hat / polarized sunglasses', 30]],
  reading: [['A book by an author they love', 18], ['Bookstore gift card', 25], ['Book light', 15]],
  books: [['A book by an author they love', 18], ['Bookstore gift card', 25]],
  gaming: [['Game store gift card', 25], ['Controller grips or stand', 15], ['A co-op game you can play together', 30]],
  music: [['Concert tickets (check dates)', 60], ['Vinyl/record of a favorite album', 30], ['Good earbuds', 50]],
  cooking: [['Cookbook for a cuisine they like', 25], ['Nice spice set', 20], ['Cook a meal for them', 15]],
  baking: [['Baking set or silicone mats', 20], ['Bake something together', 10]],
  art: [['Sketchbook + good pens', 20], ['Art class voucher', 45]],
  drawing: [['Sketchbook + good pens', 20]],
  sports: [['Tickets to a local game', 40], ['Team gear', 35]],
  soccer: [['Team scarf or jersey', 35], ['Training ball', 25]],
  basketball: [['Tickets to a local game', 40], ['New ball', 30]],
  hiking: [['Trail day trip together', 20], ['Water bottle or day pack', 30]],
  outdoors: [['Picnic day together', 20], ['Camping lantern', 25]],
  plants: [['A low-maintenance plant + pot', 25]],
  gardening: [['Gardening gloves & seeds', 18]],
  coffee: [['Local coffee beans + mug', 22]],
  tea: [['Tea sampler', 20]],
  fashion: [['Gift card to their favorite store', 30]],
  makeup: [['Gift card to a beauty store', 25]],
  tech: [['Phone stand / charger', 20], ['Smart plug or gadget', 25]],
  movies: [['Movie night kit (snacks + tickets)', 30]],
  photography: [['Photo book of your pictures together', 30]],
  travel: [['Packing cubes', 20], ['Travel journal', 15]],
  yoga: [['Yoga mat or class pass', 30]],
  dogs: [['Treats & a toy for their dog', 20]],
  cats: [['Cat toy set', 15]],
};

export interface GiftIdea { idea: string; approx: number; why: string; searchUrl: string; withinBudget: boolean }

export function giftIdeas(p: Person, fallbackBudget = 30, limit = 6): GiftIdea[] {
  const budget = p.budget ?? fallbackBudget;
  const past = new Set(p.pastGifts.map(g => g.gift.toLowerCase()));
  const out: GiftIdea[] = [];
  for (const idea of p.giftIdeas) out.push({ idea, approx: budget, why: 'From your saved ideas', searchUrl: gsearch(idea), withinBudget: true });
  for (const raw of p.interests) {
    const k = raw.toLowerCase().trim();
    const list = GIFT_MAP[k] ?? GIFT_MAP[k.replace(/s$/, '')] ?? [[`Something ${k}-related`, Math.min(25, budget)] as [string, number]];
    for (const [idea, approx] of list) out.push({ idea, approx, why: `They like ${raw}`, searchUrl: gsearch(`${idea} gift`), withinBudget: approx <= budget });
  }
  for (const f of p.foodLikes) out.push({ idea: `Treat them to ${f} food`, approx: Math.min(budget, 30), why: `They love ${f}`, searchUrl: gsearch(`${f} restaurant`), withinBudget: true });
  if (p.closeness === 1) out.push({ idea: 'A handwritten letter + a memory photo', approx: 5, why: 'Close people love personal gifts', searchUrl: gsearch('photo print near me'), withinBudget: true });
  const seen = new Set<string>();
  return out
    .filter(g => !past.has(g.idea.toLowerCase()) && !seen.has(g.idea) && (seen.add(g.idea), true))
    .sort((a, b) => Number(b.withinBudget) - Number(a.withinBudget) || (a.why === 'From your saved ideas' ? -1 : 0))
    .slice(0, limit);
}
const gsearch = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

export function occasionSummary(o: Occasion, now: Ms): string { return `${o.title} · ${fmtDay(o.date, now)}`; }
