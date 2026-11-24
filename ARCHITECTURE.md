# OROZ architecture

```
UI (React: Schedule · To-Do · OROZ · Settings)
  ├─ store (in-memory + undo) ─► Repository ─► IndexedDB (Dexie)   ← swap for Supabase later
  ├─ chat/agent.ts  ─► Claude Messages API (web_search, web_fetch + local tools)
  ├─ chat/local.ts  ─► offline intents (no key needed)
  └─ integrations/  ─► Google (Calendar, Classroom, Tasks, Contacts), iCal feeds
engine/ (pure TypeScript, unit-tested, no UI or storage)
```

## Engine
- **`sleep.ts`**: bedtime is a range, not a fixed time.
  - Each night gets its bedtime from a per-night override, or else the school-night or weekend default (a school night is any night before a school day).
  - Late fixed events push bedtime back; early ones pull wake earlier.
  - The night also sets `windDownBy`, which drives "Wrap homework by 9:45".
- **`day.ts`**: `deriveDay` builds a day from your stored blocks plus sleep and meals, which are calculated fresh rather than saved. `dayOutlook` turns it into a few lines: classes, events, lunch, what's due, birthdays, prep for tomorrow, and bedtime.
- **`meals.ts`**: places each meal near the middle of its window, moving it around fixed events. A long gap with no food gets a snack before the longest fixed block in that gap.
- **`nudges.ts`**: the "one small question at a time" list, which you can dismiss. It covers your name, bedtime, missing school-day schedules, people, birthdays, the school calendar and the lunch menu.
- **`occasions.ts`**: upcoming birthdays, and people you share the most calendar events with.
- **`parser.ts`**: reads due dates and times from quick-add text.
- **`ics.ts`**: iCal parsing with repeating events; no-school days are imported as all-day items.
- **`reflow.ts`**: the drag preview, and pushing your own blocks aside when one moves.

## Approval flow
- Every outside source (a connection, or something the chat found on the web) produces a `PendingImport`. `ImportReview` shows it with checkboxes, and only `approveImport` saves anything.
- Changes made inside the chat are checkpointed and can be undone with one tap.

## Chat
- `agent.ts` runs the Claude tool loop: `claude-opus-5-5`, low effort, server-side fallbacks, and prompt caching on the instructions.
- **Server tools:** `web_search` and `web_fetch`.
- **Local tools** (in `chat/tools.ts`):
  - read your schedule, tasks and people
  - add, move or delete events (with weekly repeats); add or complete tasks
  - set tonight's bedtime; save a person; remember a fact
  - `propose_*` for things that need your approval
- The source label under each reply ("Used: Schedule · lincolnhigh.org") comes from the tools called and the search results.
- Saved memory facts and your profile go into the system context, so you don't repeat yourself.
