# Oroz architecture

```
 UI (React views, command bar) ──► actions.ts ──► engine/* (pure, deterministic)
          ▲                            │
          └──── store (in-memory) ◄────┴──► Repository ──► Dexie/IndexedDB (today)
                                                         └► Supabase (later, same interface)
```

- **`engine/`** has no UI or storage imports. Every function takes `now` as an argument and never reads the clock, so the same inputs always produce the same output. That makes the engine deterministic and testable (`npm test`, run with `TZ=UTC`).
- **`src/data/repository.ts`** defines the `Repository` interface. `DexieRepository` (IndexedDB) is used today, and `MemoryRepository` is a fallback for private mode or tests. A `SupabaseRepository` can implement the same ten methods without touching the UI.
- **`src/data/store.ts`** keeps an in-memory snapshot (the data set is small), writes through to the repository, and records block snapshots for **undo/redo** (`engine/history.ts`).
- **`src/data/actions.ts`** orchestrates: it collects inputs, calls the engine and commits results.

## Scheduler (`planner.ts`)

`plan({ now, rangeStart, rangeEnd, blocks, tasks, routines, activities, settings, places, travel, habits, energy })` returns `{ blocks, added, removed, unplaced, warnings, debug }`.

**Hard constraints (never violated):** fixed and imported events, protected sleep, and any block marked `fixed`. Re-planning only replaces blocks the planner made itself (`source: 'planner'`, not fixed, not done). Anything you placed by hand is kept.

Steps, in order:

1. **Sleep** (`sleep.ts`): bedtime to wake time. A late event pushes bedtime to the event's end plus 15 minutes of wind-down. An early event pulls wake to 30 minutes before it. If that leaves less than the minimum sleep, Oroz sleeps in when the morning is free; otherwise it warns.
2. **Meals:** each slot is placed nearest the middle of its window. If the window is tight it falls back to a shorter meal, then moves up to ±90 minutes outside the window. If even that fails, it warns ("pack something portable"). Meals reflow around fixed events, so they never get squeezed out.
3. **Learned holds:** a confident nap habit gets its usual slot.
4. **Routines:** fixed ones go in as-is. Movable ones take the nearest free slot within their window. Optional ones are only placed if their preferred time is free.
5. **Gap snacks:** a stretch longer than `maxMealGapMin` (5h) with no food gets a 15-minute snack, placed just before the longest fixed block in that stretch (for example, practice). Meal windows that already passed today are assumed eaten.
6. **Urgent tasks** (due within 36h), then **weekly life targets**, then **everything else.** This order is how productivity is kept from crowding out life: hobbies are placed before non-urgent work.

**Task placement.** Long tasks are split into chunks: 60 minutes for focus work, 90 otherwise, never above the focus cap. Candidate start times sit on a 15-minute grid inside free intervals, with a buffer around neighbouring blocks (default 10 minutes; none around sleep or travel). A candidate is rejected if it:
- starts before wake + 45 minutes or ends after bedtime
- is after the due date
- is before `notBefore` (for staged project and occasion work)
- leaves too little travel time from where you'll be (`placeAt`) or back to your next placed block
- for non-urgent work, would drop the day below the protected free time

Each remaining candidate gets a score. The scoring weights are configurable in Settings → Debug:

| term | meaning |
|---|---|
| `deadline` | urgency × how soon the slot is |
| `priority` | (4 − priority)/3 × soonness |
| `soonness` | small push toward earlier slots |
| `energy` | focus work goes where the learned energy curve is high; light work is neutral |
| `location` | bonus when you're already there; penalty per hour of travel |
| `focusCap` | penalty when back-to-back focus work (classes count) exceeds 90 minutes without a break |
| `freeTime` | penalty when urgent work dips into protected free time |
| `windDown` | small penalty within an hour of bedtime |

The highest score wins, and ties go to the earliest slot. The top factors become the reason shown on the block: "Placed here because you're free after school, due Fri, your energy is usually high around 4pm". Travel legs become `travel` blocks.

**Edge cases covered by tests:** overlapping fixed events; a task longer than any free slot (reported with the longest gap); a day with no free time; a late event cutting into sleep; a project due sooner than its milestones allow (compressed or merged, with a warning); fixed events covering every meal window; a guest diet conflict in dining; past-due tasks; travel time; free-time protection; weekly targets; and determinism.

**Reflow** (`reflow.ts`):
- `previewMove`: during a drag, shows which blocks would be displaced and which fixed blocks you'd collide with.
- `autoReflow`: cascades flexible blocks forward around anchors; optional blocks drop off if they no longer fit.
- `pushRest` ("push 1h") and `replanFromNow` ("my day fell apart").

## Suggestions (`suggest.ts`)

Each candidate gets a score made of these parts:

| candidate | scored on |
|---|---|
| Tasks | fits in the time available (or makes a meaningful chunk), deadline urgency, priority, energy fit for focus work, location tag |
| Hobbies | time fit, staleness (days since last done), energizing vs draining for the current hour, learned habit window |
| Nap | energy dip, habit |
| Food | hours since you last ate, then the best fitting option from the meal planner |

Learned acceptance (−1…1) from accepts, skips and blocks adjusts every score. Items you said "don't suggest again" for are excluded. The top 3–5 are returned, each with a "why this?" line.

## Meal planner (`meals.ts`)

- **Placement and gap snacks:** see Scheduler steps 2 and 5.
- **`suggestFood`:** draws from a generic catalog of real dishes and pack-from-home items (never restaurants). Each option is tagged `cook` / `pack` / `takeout` / `dine-in` and shows whether it fits your window, counting travel home when cooking. Items are filtered by diet rules (vegetarian, vegan, no pork, halal, gluten-free…) and dislikes, then ranked by:
  - cuisine and favourite matches
  - ingredients already in your kitchen note
  - learned acceptance
  - a variety penalty for things you ate recently
- **Out-of-home options:** real places come only from the Places API. Without it, you get a single map-search link.
- **Meal ideas and groceries:** `mealIdeas` and `groceryTask` produce cook-at-home ideas and a scheduled grocery run for the missing ingredients.
- Everything stays health-neutral: no calorie targets unless you turn tracking on.

**Event dining** (`dining.ts`):
- **Group needs:** the union of everyone's diets and dislikes.
- **Restaurants:**
  - a place with authoritative diet data that can't serve a needed diet is **excluded**, with the reason
  - unknown diet data becomes a "check the menu" caveat
  - places are scored on cuisine matches (and who likes them), budget, travel time and rating
- **Timing:** `diningTimeline` picks the best free slot near the date (including guests' busy times when known) and works backward:
  - reserve lead time: +7 days for groups of 6 or more, +5 on busy dates such as weekends, Thanksgiving week and late December, +14 for Valentine's Day
  - leave-by time
  - a day-before confirmation reminder
- **Links:** restaurant page, Maps, OpenTable and Resy.

## Reminder engine (`reminders.ts`)

Pure functions; delivery is separate. That's what lets the engine move into a native wrapper unchanged.

- **`autoImportance`:** tests, reservations and appointments are aggressive; hobbies, naps and meals are passive; everything else is normal. Learned dismissals per category quiet things down one level.
- **`buildStages`:**
  - passive: a mention in that day's digest
  - normal: one notification at the lead time
  - aggressive: heads-up (the evening before, or 3 hours ahead), then lead (60 min), at-time (−10 min), and follow-ups every 15 minutes
- **Quiet hours:** stages that fall in quiet hours move out of them. Heads-ups move earlier; others move to the end of quiet hours. Importance levels listed in `quietExceptions` may fire inside quiet hours.
- **Firing and snooze:**
  - `dueNow` fires only the latest due stage, so there's no burst after time offline
  - `snooze` (10m / 1h / tomorrow) inserts a new stage
  - `learnReminderBias` uses a 21-day half-life
- **Delivery today:** the `App` loop checks `dueNow` every 15 seconds. It shows notifications through the service worker, which offers Snooze and Done actions, plus an in-app banner for aggressive reminders. Delivery is the only part that changes when this moves to Web Push or Capacitor LocalNotifications.

## Habit model (`habits.ts`)

**Logging.** Each event appends a `LogEntry`: completed, skipped, moved, accepted, rejected, snoozed, dismissed or blocked. Entries carry planned vs actual times, place and focus flag.

**`learnHabits`.** For each recurring key (`meal:dinner`, `hobby:nap`, `hobby:reading`, …) with at least 3 samples:
- **weighting:** every sample is weighted by exponential decay (21-day half-life)
- **time-bucket histogram:** 48 half-hour buckets, smoothed; the peak window gives the decay-weighted mean start time
- **weekday counts:** days above average are the habit's typical weekdays
- **duration and place:** decayed average duration and the most frequent place
- **confidence:** concentration × (1 − e^(−n/6))

Habits you **confirm** or **edit** are never overwritten. **Deleting** one also forgets its logs.

**Other learned signals:**
- `learnEnergy`: blends the cold-start energy curve with the decayed completion rate of focus work per hour. The more evidence, the more the data is trusted.
- `learnAcceptance`: decayed (accepts − rejects − 5×blocks) per suggestion key.
- `insights`: plain-language sentences with one-tap actions ("protect dinner", "suggest Saturday", "keep holding it").

All of this is explainable statistics; no ML. It's shown on **Me → What Oroz has learned**.

## Starter kits (`projects.ts`)

- `classifyAssignment` sorts assignments into lab, essay, research, presentation, problems, study or general, and estimates effort.
- `planMilestones` sets lead time to ⌈effort-hours × 1.4⌉ days (between 1 and 21), places the milestones proportionally and gives each a `notBefore` so work flows in order. Short timelines are compressed or merged, with a warning.
- `generateStarterKit` builds templates per assignment type. Sources are only your own materials plus search links, never invented citations.
- The optional LLM fills the same structure, with a prompt that forbids finished prose. Every item carries `starter: true` and is shown under "Starter, edit and make it yours".
