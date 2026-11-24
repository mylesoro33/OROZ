import type { Project, Milestone, MilestoneKind, Task, Ms, StarterKit, StarterItem } from './types';
import { DAY, HOUR, MIN, at, startOfDay, addDays, hashId, fmtDay } from './time';

// ---------------------------------------------------------------------------
// Effort estimate + backward milestone planning
// ---------------------------------------------------------------------------

const EFFORT: [RegExp, number, AssignmentType][] = [
  [/research paper|term paper|thesis/i, 600, 'research'],
  [/essay|paper|reflection|response/i, 300, 'essay'],
  [/lab report|lab write|lab/i, 240, 'lab'],
  [/presentation|slides|speech|poster/i, 240, 'presentation'],
  [/project/i, 480, 'project'],
  [/problem set|pset|homework|hw|exercises/i, 90, 'problems'],
  [/worksheet|quiz|discussion post|reading/i, 45, 'short'],
  [/test|exam|midterm|final/i, 240, 'study'],
];
export type AssignmentType = 'research' | 'essay' | 'lab' | 'presentation' | 'project' | 'problems' | 'short' | 'study' | 'general';

export function classifyAssignment(title: string, description = ''): { type: AssignmentType; effortMin: number } {
  const text = `${title} ${description}`;
  for (const [re, eff, type] of EFFORT) if (re.test(text)) return { type, effortMin: eff };
  return { type: 'general', effortMin: 120 };
}

const SPLIT: Record<MilestoneKind, number> = { research: 0.2, outline: 0.1, draft: 0.4, revise: 0.2, submit: 0.1 };
const AT: Record<MilestoneKind, number> = { research: 0.3, outline: 0.45, draft: 0.75, revise: 0.92, submit: 1 };
const NAME: Record<MilestoneKind, string> = { research: 'Research', outline: 'Outline', draft: 'Draft', revise: 'Revise', submit: 'Final check & submit' };

/** Lead time grows with effort: bigger projects start earlier. */
export function leadDays(effortMin: number): number {
  return Math.max(1, Math.min(21, Math.ceil((effortMin / 60) * 1.4)));
}

export interface MilestonePlan { milestones: Milestone[]; tasks: Task[]; warnings: string[]; startBy: Ms }

export function planMilestones(p: Pick<Project, 'id' | 'title' | 'due' | 'effortMin'> & { course?: string; priority?: 1 | 2 | 3 }, now: Ms): MilestonePlan {
  const warnings: string[] = [];
  const effort = p.effortMin;
  const kinds: MilestoneKind[] = effort <= 60 ? ['draft', 'submit'] : effort <= 120 ? ['outline', 'draft', 'submit'] : ['research', 'outline', 'draft', 'revise', 'submit'];
  const want = leadDays(effort) * DAY;
  const idealStart = p.due - want;
  let start = idealStart;
  const available = p.due - now;
  if (available <= 0) {
    warnings.push(`"${p.title}" is already past due.`);
  } else if (idealStart < now) {
    start = now;
    const needH = Math.round(want / DAY), haveH = Math.max(0, Math.round((available / DAY) * 10) / 10);
    warnings.push(`"${p.title}" is due ${fmtDay(p.due, now)} — milestones normally need ${needH} day${needH === 1 ? '' : 's'} but only ${haveH} remain. Compressed the plan; start today.`);
    if (available < effort * MIN * 1.5) warnings.push(`Even working nonstop, ${Math.round(effort / 60)}h of work barely fits. Consider asking for an extension.`);
  }
  // If very little time, merge into fewer milestones.
  let use = kinds;
  if (available > 0 && available < 18 * HOUR && kinds.length > 2) { use = ['draft', 'submit']; warnings.push(`Merged milestones for "${p.title}" — not enough time for separate research/outline/revise.`); }
  const totalShare = use.reduce((s, k) => s + SPLIT[k], 0);
  const span = Math.max(0, p.due - start);
  const milestones: Milestone[] = use.map((k, i) => {
    const frac = use.length === kinds.length ? AT[k] : (i + 1) / use.length;
    let due = start + span * frac;
    if (k !== 'submit') due = Math.max(now + 30 * MIN, Math.min(due, p.due - 30 * MIN));
    else due = p.due;
    return {
      id: `ms_${hashId(`${p.id}_${k}`)}`, kind: k, title: `${NAME[k]}: ${p.title}`,
      due, durationMin: Math.max(k === 'submit' ? 10 : 20, Math.round((effort * SPLIT[k]) / totalShare / 5) * 5),
    };
  });
  // Milestone due dates must be strictly increasing.
  for (let i = 1; i < milestones.length; i++) if (milestones[i].due <= milestones[i - 1].due) milestones[i - 1].due = milestones[i].due - 30 * MIN;
  const tasks: Task[] = milestones.map(m => ({
    id: `t_${m.id}`, title: m.title, durationMin: m.durationMin, due: m.due,
    priority: p.priority ?? (p.due - now < 3 * DAY ? 1 : 2), needsFocus: m.kind !== 'submit',
    chunkable: m.durationMin > 60, projectId: p.id, milestoneId: m.id, createdAt: now,
    importance: m.kind === 'submit' ? 'aggressive' : 'normal', location: 'anywhere',
  }));
  milestones.forEach(m => (m.taskId = `t_${m.id}`));
  // Each stage opens a day before the previous one is due, so work flows in order.
  for (let i = 1; i < tasks.length; i++) tasks[i].notBefore = Math.max(now, milestones[i - 1].due - DAY);
  return { milestones, tasks, warnings, startBy: Math.max(start, now) };
}

// ---------------------------------------------------------------------------
// Starter kits — a head start the student rewrites in their own words.
// Rule-based; the optional LLM may enrich it but uses the same shape.
// ---------------------------------------------------------------------------

export const STARTER_LABEL = 'Starter, edit and make it yours';
const s = (label: string, body: string): StarterItem => ({ label, body, starter: true });

function topicOf(title: string): string {
  return title.replace(/\b(lab report|research paper|essay|presentation|project|worksheet|homework|hw|problem set|due|assignment|report|paper)\b/gi, '').replace(/\s{2,}/g, ' ').replace(/^[\s:–-]+|[\s:–-]+$/g, '').trim() || title;
}
const scholar = (q: string) => `https://scholar.google.com/scholar?q=${encodeURIComponent(q)}`;
const search = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

export function generateStarterKit(p: Pick<Project, 'title' | 'description' | 'course'>, now: Ms): StarterKit {
  const { type } = classifyAssignment(p.title, p.description);
  const topic = topicOf(p.title);
  const course = p.course ? ` (${p.course})` : '';
  const breakdown: StarterItem[] = [];
  const outline: StarterItem[] = [];
  const questions: StarterItem[] = [];
  const sources: StarterItem[] = [
    s('Your own materials first', `Class notes, the textbook chapter on ${topic}, and any rubric or prompt your teacher posted${course}.`),
    s('Search links (verify everything)', `Google Scholar: ${scholar(topic)}\nGeneral search: ${search(topic + ' explained')}`),
    s('School library', 'Ask whether your library has a database login (e.g. through the school website) — it usually beats random web pages.'),
  ];
  const scaffold: StarterItem[] = [];

  switch (type) {
    case 'lab':
      breakdown.push(s('Steps', '1. Re-read the lab handout and rubric\n2. Organize your raw data into a table\n3. Make the graph(s)\n4. Write methods and results (facts only)\n5. Write discussion (what it means, sources of error)\n6. Intro + abstract last\n7. Proofread & submit'));
      outline.push(s('Lab report outline', 'Title · Purpose/Hypothesis · Materials & Methods · Results (table + graph) · Discussion · Error analysis · Conclusion'));
      questions.push(s('Questions to answer', `What was the hypothesis about ${topic}?\nWhat did you change, measure, and keep the same?\nDid the data support the hypothesis? How do you know?\nWhat are 2 sources of error and how would they change results?\nWhat would you do differently next time?`));
      scaffold.push(s('Draft scaffold', `# ${p.title}\n\n## Purpose\n[One sentence: what were you testing about ${topic}?]\n\n## Hypothesis\n[If ___, then ___, because ___.]\n\n## Methods\n[Numbered steps, past tense, in your words.]\n\n## Results\n[Insert your table/graph. Describe the trend in 2–3 sentences, no opinions yet.]\n\n## Discussion\n[What do the results mean? Connect to what you learned in class.]\n\n## Sources of error\n[At least two, and how each affected the data.]\n\n## Conclusion\n[Restate hypothesis → supported or not → one takeaway.]`));
      break;
    case 'essay': case 'research':
      breakdown.push(s('Steps', `1. Unpack the prompt — circle the task verbs\n2. Brainstorm 10 minutes, no editing\n3. Pick a position / thesis\n4. Find ${type === 'research' ? '4–6' : '2–3'} pieces of evidence\n5. Outline body paragraphs\n6. Draft fast, fix later\n7. Revise for argument, then for sentences\n8. Citations + proofread`));
      outline.push(s('Five-part outline', 'Intro (hook → context → thesis)\nBody 1: strongest point + evidence + explanation\nBody 2: second point + evidence + explanation\nBody 3: counterargument + response\nConclusion: so what? why it matters'));
      questions.push(s('Questions to answer', `What exactly is the prompt asking about ${topic}?\nWhat do YOU think, in one sentence?\nWhat's the best evidence for that? What would someone who disagrees say?\nWhy does this matter beyond the assignment?`));
      scaffold.push(s('Draft scaffold', `# ${p.title}\n\n[Hook — a question, fact or short scene about ${topic}]\n[Context — 2 sentences]\n**Thesis:** [Your claim + 2–3 reasons]\n\n## [Reason 1]\n[Topic sentence] [Evidence] [Explain how it proves your point]\n\n## [Reason 2]\n[Topic sentence] [Evidence] [Explain]\n\n## [Counterargument]\n[Some argue ___. However, ___.]\n\n## Conclusion\n[Restate thesis in new words] [Bigger picture]`));
      break;
    case 'presentation':
      breakdown.push(s('Steps', '1. Decide the one message\n2. Outline 5–8 slides\n3. Gather images/data\n4. Build slides (few words)\n5. Write speaker notes\n6. Rehearse twice with a timer'));
      outline.push(s('Slide outline', `1 Title · 2 Why ${topic} matters · 3–5 Key points · 6 Example/demo · 7 Takeaways · 8 Questions`));
      questions.push(s('Questions to answer', `What should the audience remember about ${topic}?\nWhat's one surprising fact or visual?\nHow long is it supposed to be?`));
      scaffold.push(s('Speaker-notes scaffold', '## Slide 1\n[Opening line]\n\n## Slide 2\n[Why care]\n\n## Slides 3–5\n[Point · example · transition]\n\n## Closing\n[Takeaway + thank you]'));
      break;
    case 'problems': case 'short': case 'study':
      breakdown.push(s('Steps', type === 'study'
        ? `1. List the topics covered\n2. Rate yourself 1–3 on each\n3. Practice weakest topics first\n4. Do a timed practice set\n5. Review mistakes the night before`
        : '1. Skim all problems, star the hard ones\n2. Do the easy ones first for momentum\n3. Look up examples for starred ones\n4. Check answers / units'));
      outline.push(s('Plan', type === 'study' ? 'Topics → self-rating → practice → review' : 'Easy pass → hard pass → check'));
      questions.push(s('Questions to answer', `Which parts of ${topic} feel shaky?\nWhere are the worked examples (notes, textbook)?\nWho can you ask if stuck?`));
      scaffold.push(s('Work log', '## Problem / topic\n[What I tried]\n[Where I got stuck]\n[What fixed it]'));
      break;
    default:
      breakdown.push(s('Steps', '1. Read the instructions + rubric\n2. List deliverables\n3. Make a rough version\n4. Improve it\n5. Final check & submit'));
      outline.push(s('Outline', 'Goal · Deliverables · Plan · Rough version · Polish'));
      questions.push(s('Questions to answer', `What does "done" look like for ${topic}?\nWhat's graded most heavily?\nWhat do you need to get or ask for?`));
      scaffold.push(s('Draft scaffold', `# ${p.title}\n\n## Goal\n[...]\n\n## Plan\n[...]\n\n## Notes\n[...]`));
  }
  return { generatedAt: now, generator: 'rules', breakdown, outline, questions, sources, scaffold };
}

/** When to generate the kit: before the first scheduled work session (or now). */
export function kitDueAt(firstSessionStart: Ms | undefined, now: Ms): Ms {
  return firstSessionStart ? Math.max(now, firstSessionStart - 12 * HOUR) : now;
}

/** Minimal LLM payload — never includes personal data. */
export function starterKitPrompt(p: Pick<Project, 'title' | 'description' | 'course'>): string {
  return `Assignment: ${p.title}\nCourse: ${p.course ?? 'unknown'}\nInstructions: ${(p.description ?? '').slice(0, 1500)}`;
}

export const _internal = { at, startOfDay, addDays };
