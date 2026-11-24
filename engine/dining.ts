import type { Person, FoodProfile, Ms, Block, Settings } from './types';
import { DAY, MIN, HOUR, at, addDays, weekday, startOfDay, fmtTime, fmtDay } from './time';
import { normalizeDiet } from './meals';
import { Timeline } from './timeline';

// Event dining: shortlist places that fit EVERYONE, and plan backward from the meal.
// Restaurants only ever come from a real data source (places API or the user).
// Without one we produce a checklist + search links — never invented names.

export interface Restaurant {
  id: string; name: string; cuisines: string[];
  pricePerPerson?: number;           // approx, user currency
  diets?: string[];                  // diets the place is known to accommodate ("vegetarian", "vegan", "gluten-free", "halal")
  dietInfoKnown?: boolean;           // true when `diets` is authoritative (e.g. from places API servesVegetarianFood)
  travelMin?: number;
  url?: string; mapsUrl?: string; rating?: number; reservable?: boolean;
  source: 'places-api' | 'manual';
}

export interface DiningRequest {
  title: string;
  date?: Ms;                      // occasion day (optional)
  guests: Person[];
  me: FoodProfile;
  partySize: number;
  budgetPerPerson?: number;
  fromLabel?: string;             // "school"
  areaLabel?: string;             // coarse area text for searches
  restaurants?: Restaurant[];
}

export interface ShortlistItem { restaurant: Restaurant; score: number; reasons: string[]; caveats: string[]; links: DeepLink[] }
export interface DeepLink { label: string; url: string }
export interface DiningPlan { shortlist: ShortlistItem[]; excluded: { restaurant: Restaurant; why: string[] }[]; checklist: string[]; searchLinks: DeepLink[]; groupDiets: string[]; groupLikes: string[] }

/** Which diets must the place accommodate? Union across me + guests. */
export function groupDiets(me: FoodProfile, guests: Person[]): string[] {
  return [...new Set([...me.dietary, ...guests.flatMap(g => g.dietary)].map(normalizeDiet))].sort();
}

const SATISFIES: Record<string, string[]> = {
  vegetarian: ['vegetarian', 'vegan'], vegan: ['vegan'], 'gluten-free': ['gluten-free'], halal: ['halal'], kosher: ['kosher'],
};
/** Diet needs that a place can fail. "no pork"-style needs can be met almost anywhere, so they become caveats instead. */
function dietCheck(r: Restaurant, diets: string[]): { conflicts: string[]; caveats: string[] } {
  const conflicts: string[] = [], caveats: string[] = [];
  const has = (r.diets ?? []).map(normalizeDiet);
  for (const d of diets) {
    const ok = SATISFIES[d];
    if (!ok) { caveats.push(`ask about ${d}`); continue; }
    if (ok.some(x => has.includes(x))) continue;
    if (r.dietInfoKnown) conflicts.push(`no ${d} options listed`);
    else caveats.push(`check the menu for ${d} options`);
  }
  return { conflicts, caveats };
}

export function planDining(req: DiningRequest): DiningPlan {
  const diets = groupDiets(req.me, req.guests);
  const likes = [...new Set([...req.me.cuisines, ...req.guests.flatMap(g => g.foodLikes)].map(s => s.toLowerCase()))];
  const dislikes = new Set([...req.me.dislikes, ...req.guests.flatMap(g => g.notes.filter(n => n.startsWith('dislikes ')).map(n => n.slice(9)))].map(s => s.toLowerCase()));
  const budget = req.budgetPerPerson ?? req.me.budget[1];
  const shortlist: ShortlistItem[] = [], excluded: DiningPlan['excluded'] = [];

  for (const r of req.restaurants ?? []) {
    const { conflicts, caveats } = dietCheck(r, diets);
    const cuisineDislike = r.cuisines.filter(c => dislikes.has(c.toLowerCase()));
    if (conflicts.length) { excluded.push({ restaurant: r, why: conflicts }); continue; }
    const reasons: string[] = [];
    let score = 0;
    const matched = r.cuisines.filter(c => likes.includes(c.toLowerCase()));
    reasons.push(cap(r.cuisines[0] ?? 'Restaurant'));
    if (matched.length) { score += 2 * matched.length; const who = whoLikes(matched[0], req); if (who) reasons.push(`${who} like${who.includes(' & ') || who === 'you' ? '' : 's'} ${matched[0]}`); }
    for (const d of diets) if (SATISFIES[d] && (r.diets ?? []).map(normalizeDiet).some(x => SATISFIES[d].includes(x))) reasons.push(`has ${d} options`);
    if (r.pricePerPerson !== undefined) {
      if (r.pricePerPerson <= budget) { score += 1.5; reasons.push('under your budget'); }
      else { score -= (r.pricePerPerson - budget) / Math.max(5, budget) * 2; caveats.push(`about ${r.pricePerPerson} per person — above budget`); }
    }
    if (r.travelMin !== undefined) { score += Math.max(-2, 1.5 - r.travelMin / 15); reasons.push(`${r.travelMin} minutes from ${req.fromLabel ?? 'you'}`); }
    if (r.rating) score += (r.rating - 4) * 1.5;
    if (cuisineDislike.length) { score -= 3; caveats.push(`someone dislikes ${cuisineDislike.join(', ')}`); }
    if (req.partySize >= 6 && r.reservable === false) { score -= 2; caveats.push("doesn't take reservations — risky for a big group"); }
    shortlist.push({ restaurant: r, score, reasons, caveats, links: restaurantLinks(r, req) });
  }
  shortlist.sort((a, b) => b.score - a.score || a.restaurant.name.localeCompare(b.restaurant.name));

  const cuisineQ = likes[0] ?? 'restaurant';
  const area = req.areaLabel ?? req.fromLabel ?? '';
  const q = `${cuisineQ} restaurant ${diets.filter(d => SATISFIES[d]).join(' ')} ${area}`.replace(/\s+/g, ' ').trim();
  const searchLinks: DeepLink[] = [
    { label: 'Google Maps search', url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` },
    { label: 'OpenTable search', url: `https://www.opentable.com/s?term=${encodeURIComponent(`${cuisineQ} ${area}`.trim())}&covers=${req.partySize}` },
    { label: 'Resy (via search)', url: `https://www.google.com/search?q=${encodeURIComponent(`resy ${cuisineQ} ${area}`.trim())}` },
  ];
  const checklist = [
    `Cuisine: ${likes.length ? likes.slice(0, 3).join(', ') : 'anything — ask the group'}`,
    `Area: ${area || 'near where everyone is'}`,
    `Budget: about ${budget} per person`,
    `Party size: ${req.partySize}`,
    ...(diets.length ? [`Must work for: ${diets.join(', ')}`] : []),
    ...(dislikes.size ? [`Avoid: ${[...dislikes].join(', ')}`] : []),
    'Check hours and reservation availability on the restaurant\'s own page',
  ];
  return { shortlist, excluded, checklist, searchLinks, groupDiets: diets, groupLikes: likes };
}

function whoLikes(c: string, req: DiningRequest): string {
  const names = req.guests.filter(g => g.foodLikes.some(f => f.toLowerCase() === c.toLowerCase())).map(g => g.name);
  if (req.me.cuisines.some(x => x.toLowerCase() === c.toLowerCase())) names.push('you');
  return names.length > 1 ? names.join(' & ') : names[0] ?? '';
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function restaurantLinks(r: Restaurant, req: Pick<DiningRequest, 'partySize'>, when?: Ms): DeepLink[] {
  const links: DeepLink[] = [];
  if (r.url) links.push({ label: 'Restaurant page', url: r.url });
  links.push({ label: 'Directions', url: r.mapsUrl ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.name)}` });
  const dt = when ? `&dateTime=${encodeURIComponent(new Date(when).toISOString().slice(0, 16))}` : '';
  links.push({ label: 'OpenTable', url: `https://www.opentable.com/s?term=${encodeURIComponent(r.name)}&covers=${req.partySize}${dt}` });
  links.push({ label: 'Resy', url: `https://www.google.com/search?q=${encodeURIComponent('resy ' + r.name)}` });
  return links;
}

// ---------------------------------------------------------------------------
// Timing: best slot from the schedule, then work backward.
// ---------------------------------------------------------------------------
export interface DiningTimeline { dinnerAt: Ms; reserveBy: Ms; leaveAt: Ms; confirmAt: Ms; leadDays: number; why: string; alternatives: Ms[] }

export function isBusyDate(t: Ms): boolean {
  const d = new Date(t); const m = d.getMonth() + 1, day = d.getDate();
  return (m === 2 && day === 14) || (m === 12 && day >= 20) || (m === 12 && day === 31) || isNearThanksgiving(d) || weekday(t) === 5 || weekday(t) === 6;
}

function isNearThanksgiving(d: Date): boolean {
  if (d.getMonth() !== 10) return false;
  const first = new Date(d.getFullYear(), 10, 1).getDay();
  const tg = 1 + ((4 - first + 7) % 7) + 21;
  return d.getDate() >= tg - 1 && d.getDate() <= tg + 2;
}

export function reservationLeadDays(dinnerAt: Ms, partySize: number): number {
  let d = 2;
  if (partySize >= 6) d += 7; else if (partySize >= 4) d += 2;
  if (isBusyDate(dinnerAt)) d += 5;
  const dt = new Date(dinnerAt);
  if (dt.getMonth() === 1 && dt.getDate() === 14) d += 14;
  return d;
}

export function diningTimeline(opts: { targetDay: Ms; now: Ms; blocks: Block[]; settings: Settings; partySize: number; travelMin?: number; durationMin?: number; guestBusy?: { start: Ms; end: Ms }[] }): DiningTimeline | undefined {
  const dur = (opts.durationMin ?? 90) * MIN;
  const tl = new Timeline([...opts.blocks, ...(opts.guestBusy ?? []).map((g, i) => ({ id: `guest${i}`, title: 'Guest busy', kind: 'event' as const, start: g.start, end: g.end, flexibility: 'fixed' as const, source: 'manual' as const }))]);
  const travel = (opts.travelMin ?? 15) * MIN;
  const candidates: Ms[] = [];
  // the day itself first, then nearby days (closest first, prefer before the date)
  for (const off of [0, -1, -2, 1, -3, 2, -4, 3, -5, -6]) {
    const d = addDays(startOfDay(opts.targetDay), off);
    if (d < startOfDay(opts.now)) continue;
    for (const t of ['18:30', '19:00', '18:00', '19:30', '17:30', '12:30']) {
      const s = at(d, t);
      if (s - travel < opts.now + HOUR) continue;
      if (tl.isFree(s - travel, s + dur + travel, 0)) candidates.push(s);
    }
  }
  if (!candidates.length) return undefined;
  const dinnerAt = candidates[0];
  const lead = reservationLeadDays(dinnerAt, opts.partySize);
  const reserveBy = Math.max(opts.now, at(addDays(dinnerAt, -lead), '17:00'));
  const late = at(addDays(dinnerAt, -lead), '17:00') < opts.now;
  const confirmAt = Math.max(opts.now, at(addDays(dinnerAt, -1), '17:00'));
  const why = [
    `free ${fmtDay(dinnerAt, opts.now)} at ${fmtTime(dinnerAt)}`,
    `${opts.partySize >= 6 ? 'big group' : `party of ${opts.partySize}`}${isBusyDate(dinnerAt) ? ' on a busy night' : ''} → reserve ${lead} days ahead${late ? ' (that\'s now — reserve today)' : ''}`,
  ].join('; ');
  return { dinnerAt, reserveBy, leaveAt: dinnerAt - travel - 10 * MIN, confirmAt, leadDays: lead, why, alternatives: candidates.slice(1, 4) };
}

export const _d = { DAY };
