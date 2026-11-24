# Roadmap

The MVP runs entirely on-device. Next steps, roughly in order:

## 1. Native wrapper with Capacitor (background location + reliable reminders)
- Wrap the existing PWA with Capacitor (iOS/Android), reusing the same `engine/` and UI.
- **Background location:** geofences for saved places (`@capacitor/geolocation` + a geofencing plugin) update "where am I" automatically. Processing stays on-device, with no location history.
- **Local notifications:** schedule `buildStages()` output with `@capacitor/local-notifications`, so reminders fire even when the app is closed. Snooze and Done become notification actions. The reminder engine is already pure, so only delivery changes.
- Make the Google OAuth flow native (`@codetrix-studio/capacitor-google-auth` or AppAuth).

## 2. More reliable push for the PWA
- A small push service (for example a Supabase Edge Function or Cloudflare Worker) stores VAPID subscriptions and upcoming reminder times, which are already computed by `reminders.ts`, and sends Web Push. `src/sw.ts` already handles `push` events.
- Send only the minimum: an opaque id, a time and the reminder text.

## 3. Cloud sync (Supabase)
- Implement `SupabaseRepository` against the existing `Repository` interface (`src/data/repository.ts`); the UI doesn't change.
- Row-level security per user and end-to-end encryption for people notes and behavior logs, with last-write-wins plus per-table `updatedAt` conflict handling.
- Sync stays opt-in; local-only remains the default.

## 4. LLM-powered natural-language commands
- Extend `llm.ts` from field refinement to full commands: "move gym to after dinner and skip reading tonight" becomes a typed list of actions (move / create / skip / plan) validated against the engine before applying, with a one-tap confirm card as today.
- Multi-turn clarifications as quick-edit chips, never blocking questions.
- Keep the offline rule parser as the fallback, and keep the "minimum data" guarantee.

## 5. One-tap reservation booking (official APIs only)
- Where a provider offers an official partner API (for example OpenTable Connect or the Resy partner API), offer **Book** behind explicit confirmation. Payment details are never stored. Otherwise keep the deep links.
- Auto-add the confirmation to the calendar, and read confirmation emails only with explicit permission.

## 6. Friends' availability
- Opt-in sharing of **free/busy only** (no titles) between friends using Oroz, or through a shared Google calendar free/busy query.
- `diningTimeline` and the "you haven't seen friends in 9 days" insight already accept guest busy intervals, so suggestions become "Saturday 2–5pm works for you and Jake".

## Smaller follow-ups
- Canvas/Schoology REST APIs (per-school developer keys) for richer assignment details and rubric text.
- Drag across days in Week view; multi-select; recurring-block editing.
- Per-place travel learning (actual vs planned travel time).
- Smarter weekly balancing (spread focus work, protect a weekend day).
- Accessibility pass (screen-reader labels on the timeline, reduced motion).
- Localization (date parsing in more languages).
