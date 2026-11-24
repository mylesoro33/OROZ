import { describe, it, expect } from 'vitest';
import { planMilestones, leadDays, generateStarterKit, classifyAssignment, STARTER_LABEL } from '../projects';
import { T } from './fixtures';
import { DAY } from '../time';

describe('projects + milestones', () => {
  it('works backward from the due date in order', () => {
    const r = planMilestones({ id: 'p1', title: 'History essay', due: T(14, '08:00'), effortMin: 300 }, T(0, '10:00'));
    expect(r.milestones.map(m => m.kind)).toEqual(['research', 'outline', 'draft', 'revise', 'submit']);
    for (let i = 1; i < r.milestones.length; i++) expect(r.milestones[i].due).toBeGreaterThan(r.milestones[i - 1].due);
    expect(r.milestones.at(-1)!.due).toBe(T(14, '08:00'));
    expect(r.tasks.reduce((s, t) => s + t.durationMin, 0)).toBeGreaterThanOrEqual(295);
    expect(r.warnings).toHaveLength(0);
  });
  it('larger projects start earlier', () => {
    expect(leadDays(600)).toBeGreaterThan(leadDays(240));
    const small = planMilestones({ id: 'a', title: 'Worksheet', due: T(14, '08:00'), effortMin: 45 }, T(0, '10:00'));
    const big = planMilestones({ id: 'b', title: 'Research paper', due: T(14, '08:00'), effortMin: 600 }, T(0, '10:00'));
    expect(big.startBy).toBeLessThan(small.startBy);
  });
  it('compresses and warns when due sooner than milestones allow', () => {
    const r = planMilestones({ id: 'p', title: 'Lab report', due: T(1, '08:00'), effortMin: 240 }, T(0, '16:00'));
    expect(r.warnings.join(' ')).toMatch(/only 0.7 remain|Compressed/);
    expect(r.warnings.join(' ')).toMatch(/Merged milestones/);
    expect(r.milestones.map(m => m.kind)).toEqual(['draft', 'submit']);
    for (const m of r.milestones) { expect(m.due).toBeGreaterThan(T(0, '16:00')); expect(m.due).toBeLessThanOrEqual(T(1, '08:00')); }
  });
  it('starter kits are clearly marked as starters', () => {
    const kit = generateStarterKit({ title: 'Bio lab report: enzymes', course: 'Biology' }, T(0, '10:00'));
    const all = [...kit.breakdown, ...kit.outline, ...kit.questions, ...kit.sources, ...kit.scaffold];
    expect(all.length).toBeGreaterThan(5);
    expect(all.every(i => i.starter === true)).toBe(true);
    expect(STARTER_LABEL).toBe('Starter, edit and make it yours');
    expect(kit.scaffold[0].body).toMatch(/## Hypothesis/);
    expect(kit.sources.map(s => s.body).join()).toMatch(/scholar\.google\.com/);
    expect(classifyAssignment('Essay 2').type).toBe('essay');
    void DAY;
  });
});
