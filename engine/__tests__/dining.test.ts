import { describe, it, expect } from 'vitest';
import { planDining, diningTimeline, reservationLeadDays, type Restaurant } from '../dining';
import { defaultFoodProfile } from '../defaults';
import { settings, T, fixed } from './fixtures';
import type { Person } from '../types';

const person = (over: Partial<Person>): Person => ({ id: 'p', name: 'Mom', relationship: 'mom', closeness: 1, interests: [], foodLikes: [], dietary: [], giftIdeas: [], pastGifts: [], notes: [], source: 'manual', ...over });
const R = (over: Partial<Restaurant>): Restaurant => ({ id: over.name!, name: 'X', cuisines: ['italian'], source: 'places-api', ...over });

describe('event dining', () => {
  it('excludes a restaurant that conflicts with a guest\'s dietary needs', () => {
    const mom = person({ dietary: ['vegetarian'], foodLikes: ['italian'] });
    const plan = planDining({ title: "Mom's birthday", guests: [mom], me: defaultFoodProfile(), partySize: 3, fromLabel: 'school', restaurants: [
      R({ name: 'Steakhouse', cuisines: ['steakhouse'], diets: [], dietInfoKnown: true, travelMin: 10 }),
      R({ name: 'Trattoria', cuisines: ['italian'], diets: ['vegetarian'], dietInfoKnown: true, pricePerPerson: 18, travelMin: 12 }),
      R({ name: 'Unknown Diner', cuisines: ['american'], travelMin: 8 }),
    ] });
    expect(plan.excluded.map(e => e.restaurant.name)).toEqual(['Steakhouse']);
    expect(plan.excluded[0].why[0]).toMatch(/vegetarian/);
    expect(plan.shortlist[0].restaurant.name).toBe('Trattoria');
    expect(plan.shortlist[0].reasons.join(', ')).toBe('Italian, Mom likes italian, has vegetarian options, under your budget, 12 minutes from school');
    const unknown = plan.shortlist.find(s => s.restaurant.name === 'Unknown Diner')!;
    expect(unknown.caveats[0]).toMatch(/check the menu/);
    expect(plan.shortlist[0].links.map(l => l.label)).toEqual(expect.arrayContaining(['Directions', 'OpenTable', 'Resy']));
  });
  it('without a places API: checklist + search links, no invented names', () => {
    const plan = planDining({ title: 'Group dinner', guests: [person({ dietary: ['gluten-free'] })], me: { ...defaultFoodProfile(), cuisines: ['thai'] }, partySize: 6, areaLabel: 'Downtown' });
    expect(plan.shortlist).toHaveLength(0);
    expect(plan.checklist.join('\n')).toMatch(/Party size: 6/);
    expect(plan.checklist.join('\n')).toMatch(/gluten-free/);
    expect(plan.searchLinks.map(l => l.label)).toEqual(['Google Maps search', 'OpenTable search', 'Resy (via search)']);
  });
  it('works backward: lead time grows with group size and busy dates', () => {
    expect(reservationLeadDays(T(1, '19:00'), 2)).toBe(2);            // Tuesday, 2 people
    expect(reservationLeadDays(T(5, '19:00'), 8)).toBe(14);           // Saturday, big group
    const tl = diningTimeline({ targetDay: T(3, '00:00'), now: T(0, '10:00'), blocks: [fixed('Practice', T(3, '17:00'), T(3, '19:00'))], settings: settings(), partySize: 4, travelMin: 15 })!;
    expect(tl.dinnerAt).toBe(T(3, '19:30'));
    expect(tl.confirmAt).toBe(T(2, '17:00'));
    expect(tl.leaveAt).toBe(T(3, '19:05'));
  });
});
