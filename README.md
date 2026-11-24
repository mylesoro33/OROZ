# OROZ

A calm personal planner for students. It starts empty and builds up with you: your classes, to-dos, sleep and the people you care about.

Four tabs:
- **Schedule:** day and week timeline, with a short outlook for each day
- **To-Do:** today, upcoming and done
- **OROZ:** chat with the assistant
- **Settings:** connections, About me, preferences

It's a mobile-first PWA (TypeScript, React, Vite, Tailwind, Dexie). Your data stays on your device.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # engine tests
npm run build    # production build with offline service worker
```

**Live:** https://mylesoro33.github.io/OROZ/. Install it on iPhone with Safari → Share → Add to Home Screen, or on Android with Chrome → Install app.

## First launch

OROZ asks five quick questions, and you can skip any of them:
1. your name
2. your school and grade
3. your usual school-night bedtime, set on a sleep dial
4. whether to connect accounts
5. who you want to celebrate

After that, it asks one small thing at a time when something is missing ("I don't have your Tuesday schedule yet").

## Chat (OROZ tab)

- **Without a key:** chat answers schedule, task, bedtime and birthday questions offline.
- **With your own Claude API key** (Settings → Preferences): you can talk naturally, and OROZ can search the web and read public pages, for example your school's calendar or this week's lunch menu.
  - Each answer shows the sources it used.
  - Anything found online is shown for your approval before it's saved.
  - Web search must be enabled for your key in the Claude Console.
- **What's sent:** your messages and the specific schedule details the assistant looks up to answer. Nothing else.

## Connections (Settings → Connections)

All connections are read-only and optional, and you review every item before it's added. Turning a connection off removes what it brought in.

| Service | How |
|---|---|
| Google Calendar, Classroom, Contacts, Tasks ("Reminders") | Google sign-in. Needs a Google OAuth client ID (below). |
| Schoology | Paste your calendar feed link (Calendar → Export), or import the .ics file |
| School calendar | Paste an iCal link, import a file, or ask OROZ to search the school's website |

**Google client ID setup:**
1. In Google Cloud Console, enable these APIs: Calendar, People, Classroom and Tasks.
2. Set up the OAuth consent screen (External) and add yourself as a test user.
3. Create an OAuth client ID of type "Web application". Add your site, e.g. `https://mylesoro33.github.io` and `http://localhost:5173`, as authorized JavaScript origins.
4. Paste the client ID in Settings → Preferences, or put it in `.env.local` as `VITE_GOOGLE_CLIENT_ID=`.

**Limits of a web app:**
- Apple Reminders and iPhone Contacts can't be read; they need a native app.
- Text messages can't be read. "Who you see most" comes from your calendar events.
- Some school sites block apps from reading their calendar links. Import the downloaded file instead.

## Privacy

- Everything is stored in your browser on this device.
- Export or delete it all from Settings.
- Only public pages you point to, or accounts you sign in to, are ever read.
