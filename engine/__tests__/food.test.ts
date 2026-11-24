import { describe, it, expect } from 'vitest';
import { suggestFood, dietConflicts, mealIdeas, groceryTask, FOOD_CATALOG } from '../meals';
import { places, travel, T } from './fixtures';
import { defaultFoodProfile } from '../defaults';

describe('food', () => {
  it('respects dislikes and dietary choices', () => {
    const profile = { ...defaultFoodProfile(), dislikes: ['mushrooms'], dietary: ['vegetarian'] };
    const opts = suggestFood({ minutes: 60, placeId: 'home', places, travel, profile, homePlaceId: 'home' });
    const ids = opts.map(o => o.id);
    expect(ids).not.toContain('mushroom-risotto');
    expect(ids).not.toContain('stirfry');
    expect(ids).not.toContain('pork-bowl');
    expect(opts.every(o => ['dine-in', 'takeout', 'cook', 'pack'].includes(o.mode))).toBe(true);
  });
  it('marks whether options fit the window, and never invents restaurants', () => {
    const profile = { ...defaultFoodProfile(), cuisines: ['thai'] };
    const opts = suggestFood({ minutes: 30, placeId: 'school', places, travel, profile, homePlaceId: 'home' });
    const ext = opts.filter(o => o.external);
    expect(ext).toHaveLength(1);
    expect(ext[0].title).toMatch(/^Search:/);
    expect(ext[0].link).toMatch(/google\.com\/maps\/search/);
    for (const o of opts) expect(o.fits).toBe(o.minutes <= 30);
  });
  it('uses real nearby places only when provided', () => {
    const profile = defaultFoodProfile();
    const opts = suggestFood({ minutes: 45, placeId: 'school', places, travel, profile, nearby: [{ name: 'Real Pho Spot', travelMin: 5, cuisine: 'vietnamese', source: 'places-api' }] });
    expect(opts.some(o => o.title === 'Real Pho Spot' && o.mode === 'dine-in')).toBe(true);
  });
  it('diet conflict reasons are explicit', () => {
    const pork = FOOD_CATALOG.find(f => f.id === 'pork-bowl')!;
    expect(dietConflicts(pork, ['no pork'])).toEqual(['no pork (pork)']);
  });
  it('meal ideas + grocery list task', () => {
    const profile = { ...defaultFoodProfile(), kitchenNote: 'rice, tofu, soy sauce', dietary: ['vegetarian'] };
    const ideas = mealIdeas(profile, 'dinner', 2);
    expect(ideas[0].id).toBe('tofu-stirfry');
    const g = groceryTask(ideas, profile.kitchenNote, T(0, '10:00'))!;
    expect(g.kind).toBe('grocery');
    expect(g.title).toMatch(/Groceries:/);
    expect(g.title).not.toMatch(/tofu/);
  });
});
