# OROZ

A calendar-first life planner for anyone: students, workers, parents, retirees. It starts empty and builds up as you tell it about your week.

**Live:** https://mylesoro33.github.io/OROZ/. To install it, use Safari → Share → Add to Home Screen on iPhone, or Chrome → Install app on Android.

## How it works
- **Schedule** (home screen): a day/week timeline with a short summary at the top. Meals and sleep appear as soft bands you can drag. Errand hints show up by place, and the weather is one line.
- **To-Do:** grouped as Today, This week and Whenever. Items without a time get a **Fit in** button that suggests open slots.
- **Profile:** about you, your places, food and bedtime (a draggable dial with a weeknight and weekend default, and any night can differ), people, things you've told OROZ, and important dates.
- **Settings** (the gear): connections, your Claude key, theme, and data export or deletion.
- **Tell OROZ** (the big button): say or type things like "Pick up Jake at 4:30 Thursday" or "I work Monday to Thursday 8 to 4", snap a photo of a schedule, or paste a link. You always see a draft before anything is added.

## Add from photo
The fastest way to fill the calendar. Tap **Camera** or **Upload** on the Schedule card, the camera next to Tell OROZ, or **Add from photo** in the Tell OROZ sheet. It's also offered during setup.
- Several pages or screenshots at once: class, shift, practice, bell or rotating (A/B, Day 1/2) schedules, printed or handwritten.
- OROZ reads them and asks only what it needs: weekly or rotating, start and end dates, and whether it's for you or someone else.
- **Looks right?** shows your photo beside the draft. Repeating items are grouped, unsure items are marked, and days already on your calendar are skipped. Tap any row to fix it, or add one that was missed.
- Nothing is added until you tap **Confirm**, and you get Undo right after.
- OROZ then offers to save your usual hours and lunch to your Profile, and asks whether to delete the photo (the default) or keep a copy on this device.
- Links work the same way. Reading photos needs your Claude key; photos are sent only to be read.

## Run it
```bash
npm install
npm run dev      # http://localhost:5173
npm test         # engine tests
npm run build
```

## What needs what
| Feature | Needs |
|---|---|
| Typing or speaking events, to-dos and weekly hours; Fit in; Schedule; Profile | Nothing. Works offline. |
| Calendar links (.ics, Google public calendars, Outlook or Apple published links, Schoology, Canvas, Blackboard, PowerSchool feeds) | Nothing. Some sites block apps from reading links directly. |
| Google Calendar, Classroom, Tasks, Contacts | A Google OAuth client ID (Settings → Preferences). Enable those four APIs in Google Cloud and add your site as an authorized JavaScript origin. |
| Understanding anything you say, reading photos and web pages, looking up important dates | Your Claude API key (Settings → Preferences). Turn on web search for the key in the Claude Console. |
| Weather | Nothing (Open-Meteo, looked up by your city name). |

**Not possible in a web app:** Apple Reminders. It's listed in Connections as needing the iPhone app.

## Privacy
- Everything is stored on your device.
- Claude only receives what you tell OROZ, and the calendar details it looks up to answer you.
- Important dates come with a source link and are only added after you approve them.
- Export or delete everything from Settings.
