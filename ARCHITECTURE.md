# OROZ architecture

```
UI: Schedule · To-Do · Profile · Settings (gear) · Talk sheet (big button)
 ├─ store (in-memory, undo) ─► Repository ─► IndexedDB      (swap in a cloud backend later)
 ├─ ai/router.ts   what you say / a link / a photo → Reply { text, draft }
 │    ├─ offline: engine/talk.ts + iCal parsing
 │    └─ ai/claude.ts  (your key): tool loop with get_week, get_todos, suggest_slots, draft_items, web_search, web_fetch
 └─ integrations/  Google (Calendar, Classroom, Tasks, Contacts), calendar links, weather
engine/  pure TypeScript + tests
```

**Drafts, not writes.** Every outside input (speech, a photo, a link, a connection, a web lookup) becomes a `Draft`. `DraftReview` shows each item; you can edit, uncheck or add it, and only `store.approve()` saves anything.

## Engine
- **`talk.ts`**: turns one line into an event, a to-do (timed or flexible) or a person.
  - `recurring()` handles weekly hours like "I work Monday to Thursday 8 to 4".
  - It keeps your capitalization and guesses the to-do type.
- **`week.ts`**:
  - `bandsFor`: meals and sleep as soft bands that are never busy time.
  - `itemsFor`: events plus timed to-dos.
  - `openTime`: free time between waking and bed.
  - `suggestSlots`: Fit in, one suggestion per day. It prefers hours that suit the to-do type, keeps meals clear when it can, and favors being next to an event at the same place.
  - `errandHints`, `daySummary`, `weatherNote`.
  - `normalizeLink`: turns webcal and Google public-calendar links into readable iCal feeds.
  - `nudges`: one small question at a time, matched to what you do.
  - `dateTopics`: which kinds of important dates fit you.
- **`sleep.ts`**: weeknight and weekend defaults, plus per-night overrides.
- **`ics.ts`**: iCal parsing with repeating events.
