# Oroz

A personal scheduling PWA built around one question: **"I have X minutes at Y. What should I do?"**

Oroz combines school, to-dos, sleep, meals, hobbies, friends, birthdays and projects into one plan. It gives a short reason for every placement and learns your habits over time. All of it runs on your phone and works offline. No account is needed, and no paid services are required.

![stack](https://img.shields.io/badge/stack-React%20·%20TypeScript%20·%20Vite%20·%20Tailwind%20·%20Dexie-4f46e5)

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine unit tests (vitest)
npm run build      # typecheck + production build (with service worker)
npm run preview    # serve the production build on http://localhost:4173
```

The first launch loads **demo data**: a school week, practice, a chem test, two school projects with starter kits, people with birthdays, food preferences and four weeks of behavior history. You can try everything without any setup. A one-minute onboarding quiz personalizes it, and you can skip it. To start clean, go to **Me → Settings → Delete everything**.

### Try these in the command bar

| Type or say | What happens |
|---|---|
| `30 school` / `free 30` / `45 gym` | 3–5 ranked suggestions that fit the time and place, each with a "why this?" line |
| `eat 30` / `hungry` | Food options tagged cook / pack / takeout / dine-in, each marked as fitting your window or not |
| `nap` | Holds a nap at your best slot, using your learned nap time |
| `movie` | Finds the next evening long enough for a movie |
| `tonight` / `tomorrow` | A quick plan for that period |
| `push 1h` | Shifts the rest of today back an hour, around fixed events |
| `plan my day` / `plan my week` / `my day fell apart` | Plans or re-plans |
| `bio lab report 90m fri high` | Task: 90 min, due Friday at 8am, high priority, placed automatically |
| `dinner with Jake saturday 7` | Event at 7pm Saturday, with Jake |
| `Mom's birthday march 3` | Birthday added to Mom's profile, and prep starts at the right lead time |
| `remind me to call grandma sunday` | Reminder (time defaults to 9am, shown as an editable chip) |
| `I hate mushrooms` / `love Thai` / `Jake likes fishing` | Updates your food profile or Jake's profile |

Anything ambiguous gets a sensible default shown as a **dashed chip** that you tap to change. Oroz never shows a form and never asks a blocking question.

---

## Install on your phone

Oroz is a Progressive Web App. Install requires HTTPS, so deploy the `dist/` folder to any static host first (Netlify, Vercel, Cloudflare Pages or GitHub Pages; `npm run build` produces it).

- **iPhone / iPad (Safari):** open the site, tap **Share**, then **Add to Home Screen**, then open Oroz from the home screen. Notifications only work in the installed app on iOS 16.4 and later.
- **Android (Chrome):** open the site and tap **Install app** in the menu (or the install banner).
- **Desktop Chrome/Edge:** use the install icon in the address bar.

After the first load, everything works offline. The service worker precaches the app, and your data lives in IndexedDB.

---

## Google sign-in (Calendar, Contacts birthdays, Classroom)

Oroz uses **read-only** scopes through Google Identity Services in the browser. There is no backend, and tokens stay in memory.

1. Go to [Google Cloud Console](https://console.cloud.google.com/), create a project, then open **APIs & Services → Library** and enable:
   - Google Calendar API
   - People API (for contact birthdays)
   - Google Classroom API (optional)
2. **OAuth consent screen:** choose External, add yourself as a test user, and add these scopes:
   - `.../auth/calendar.readonly`
   - `.../auth/contacts.readonly`
   - `.../auth/classroom.courses.readonly`
   - `.../auth/classroom.coursework.me.readonly`
3. **Credentials → Create credentials → OAuth client ID → Web application.** Add **Authorized JavaScript origins** for every place you run Oroz, such as `http://localhost:5173` and `https://your-oroz.example`.
4. Give Oroz the client ID, either way:
   - `.env.local`: `VITE_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com`
   - or paste it in **Me → Settings → Connections**
5. Tap **Calendar**, **Contacts birthdays** or **Classroom**. Google asks for permission at that moment, and only for that scope.

Imported calendar events become **fixed blocks** (striped, with a lock icon) that the planner never moves. "Auto re-sync" refreshes every 30 minutes while the app is open, and pull-to-refresh on Today syncs on demand. Birthday events in your calendar and birthdays from your contacts are added to People.

> A school Google Workspace account may block third-party apps. If so, use the school's ICS feed instead.

## School platforms

| Platform | How to connect | What you get |
|---|---|---|
| **Google Classroom** | Settings → Connections → Classroom (OAuth, read-only) | Assignments, due dates, course names → projects |
| **Canvas** | Canvas → Calendar → **Calendar Feed** (bottom right) → copy the URL → Settings → add feed, kind **assignments** | Assignment due dates ("Essay 2 [ENG 101]" → title + course) |
| **Schoology** | Calendar → **Export** / iCal feed → add as **assignments** | Due dates |
| **School bell schedule / events** | The school's public `.ics` link → add feed, kind **calendar** | Fixed class blocks |

Each assignment becomes a **project** with milestones (research → outline → draft → revise → submit) placed backward from the due date. Bigger projects start earlier. A **starter kit** is generated in the background so it's ready before your first work session. It includes a task breakdown, an outline, questions to answer, places to look for sources, and a draft scaffold made of headings and prompts. Every item is labeled **"Starter, edit and make it yours"**. It's a head start, not something to hand in.

**CORS note:** many school servers don't let browsers read their feeds directly. If adding a feed fails, download the `.ics` file and use **Import file**, or set a CORS proxy you trust in Settings (`https://proxy.example/?url={url}`).

Canvas and Schoology REST APIs need per-school developer keys and a server for OAuth, so the MVP uses their official calendar feeds. See [ROADMAP.md](ROADMAP.md).

## Optional add-ons (off by default)

Both are behind feature flags and have rule-based fallbacks. Oroz is fully functional without them.

### AI helper (natural-language parsing + richer starter kits)
- Settings → Optional add-ons → turn on **AI helper**, then paste an Anthropic API key (stored only on this device).
- It uses Claude (`claude-opus-5-5`, low effort, structured JSON output). It only runs when the offline parser had to guess two or more fields, and when generating starter kits.
- **What's sent:** the single line you typed, or an assignment's title, course and instructions. Calendar, location, contacts, people or history data are never sent.

### Restaurant search (Google Places API)
1. In Google Cloud, enable **Places API (New)** and create an API key. Restrict it to your site's HTTP referrers and to Places API (New).
2. Settings → turn on **Real restaurant search**, then paste the key and set a **search area** (for example "Midtown").
- **What's sent:** only a text query like `thai restaurant vegetarian Midtown`. Your coordinates are never sent.
- **Without it:** Oroz gives Google Maps, OpenTable and Resy search links plus a checklist (cuisine, area, budget, party size, diets). It **never invents restaurant names, hours or availability.** You can type the place you picked, and it goes on your calendar with confirm and leave-by reminders.

Oroz never books or pays. It prepares the links and the timing, and adds the reservation only after you confirm.

## Notifications and their limits

- Permission is requested only when you tap **Allow** (Settings → Reminders).
- Reminders fire while Oroz is open or its service worker is alive. Aggressive reminders also show a persistent red banner in the app until you mark them done or snooze them (10 min / 1 hr / tomorrow).
- **iPhone:** only works after Add to Home Screen (iOS 16.4+), and iOS may pause background work.
- Reliable push when the app is closed needs a push server or the native wrapper. See the roadmap.

## Privacy

- Everything lives in IndexedDB on your device: calendar, school data, location, contacts, food preferences, people notes and behavior logs.
- Location is checked only when you tap **Detect**. The coordinates are compared to your saved places and then discarded, and no history is kept.
- **Export all data** (JSON), **Import**, and **Delete everything** are in Settings → Privacy & data.
- Information about other people is only what you typed or imported from your own contacts, and it stays local.

## Project layout

```
engine/            Pure TypeScript domain logic (no React, no storage), fully unit-tested
  planner.ts       Scheduler: hard/soft constraints, scoring, explanations
  meals.ts         Meal placement, gap snacks, food suggestions, meal ideas, groceries
  sleep.ts         Protected sleep around late/early events
  suggest.ts       "X minutes at Y" ranking
  parser.ts        Offline natural-language capture + commands
  reminders.ts     Importance, escalation stages, quiet hours, snooze, learning
  habits.ts        Habit model, energy curve, acceptance weights, insights
  projects.ts      Effort estimate, backward milestones, starter kits
  occasions.ts     Birthdays/holidays, lead times, prep stages, gift ideas
  dining.ts        Group-fit shortlist, diet conflicts, reservation timeline, deep links
  reflow.ts        Drag preview, auto-reflow, push, "my day fell apart"
  ics.ts           iCalendar parser (RRULE expansion) for calendars + assignment feeds
  __tests__/       vitest suites
src/data/          Repository (Dexie / in-memory), store, actions, demo seed
src/integrations/  Google, ICS fetch, Places, Claude (optional), notifications, geolocation
src/ui/            React views (Today, Week, Tasks, Life, People, Me) + command bar
src/sw.ts          Service worker: offline precache, notification actions, push hook
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the engine works and [ROADMAP.md](ROADMAP.md) for next steps.
