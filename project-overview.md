# Focus Hub — Project Overview

**A calm, neurodivergent-friendly productivity engine.**

**Author:** Jay Woo  ·  **Live:** whattodo-sable.vercel.app  ·  **Stack:** Vanilla JS · Firebase · Vercel · Chrome MV3 · PWA

---

## 1. What it is

Focus Hub is a single-page productivity engine that unifies a task bank, a Google-Calendar-style calendar, a focus timer, and a set of executive-function "scaffolds" designed for ADHD-pattern brains — all in one calm, Notion-inspired interface. It runs as a website, installs to your home screen as a Progressive Web App, and ships with a Chrome extension that floats a translucent quick-capture panel over any page.

It is built for the kind of high-achieving student or builder who has more ambition than their working memory can hold at once — but it works just as well as a clean, classic todo list for anyone who turns the scaffolds off.

---

## 2. The problem it solves

Most productivity tools optimize for the **storage** of intent: a place to write things down. Focus Hub optimizes for **execution under cognitive load** — the moment-to-moment friction of actually starting, switching, and finishing tasks when your prefrontal cortex is overloaded.

The design brief, in one line:

> *How might I build a planner that doesn't fight the way my brain actually works?*

Every feature is a vote about whose cognitive load the app respects.

---

## 3. Core features

### Planning & scheduling
- **Task Bank** — a searchable, filterable, drag-to-schedule pool of everything you need to do, with urgency-colored edges, inline subtasks, and per-subtask scheduling.
- **Calendar** — Month / Week / Day views with a custom hour grid (no library), drag-and-drop scheduling, double-click quick-add, pinch / Cmd-scroll zoom, drag-resizable panels, and a fits-in-one-viewport layout.
- **iCal import** — absorbs Google Calendar exports with full recurring-event support (RRULE / EXDATE / RDATE / VTIMEZONE), multi-file import, and per-calendar color palettes.
- **Natural-language Quick Add** — type "MUST submit essay by Friday" and it parses priority, due date, and type automatically.
- **Focus blocks & timer** — reserve time, pick tasks, run a Pomodoro-style focus session.

### The five cognitive scaffolds *(all opt-out)*
| Scaffold | What it does | The problem it targets |
|---|---|---|
| **First Step** | Every task surfaces its 5-second move ("put left shoe on") | Transition paralysis |
| **Quick Capture** | `⌘K` from anywhere — 3-word brain dump | Working-memory wipe |
| **Dopamine Gate** | Soft-locks "plan" tasks until you log execute work | Productive procrastination |
| **Domain Modes** | KTLO vs Active per life domain | Capacity burnout |
| **Time Anchor** | Intrusive toast every 25 min during focus | Time blindness |

### Surfaces
- **Website** — the full app at whattodo-sable.vercel.app
- **Installable PWA** — adds to macOS Dock, Windows Start, iOS / Android home screen; opens in its own window
- **Chrome extension** — a translucent "folded-tab" popup that floats over any page for instant capture

---

## 4. Design principles

1. **Calm over loud.** Notion-palette pastels, typography never above weight 540, synthetic bold disabled globally. The first screen shows a greeting, the date, and today's tasks — nothing else demanding attention.
2. **Minimal by default, powerful on demand.** Advanced surfaces (stats, charts, scaffolds, NLP add) live behind collapsible disclosures. The Add Task modal shows only Title + 4 calm inputs; everything else is one click away under "More options."
3. **Density is a user choice.** Six surfaces are user-resizable: column widths, calendar split, all-day strip, calendar zoom, density preset, archive scope.
4. **Local-first persistence.** Every state change writes localStorage synchronously; cloud sync to Firebase is debounced in the background. The app never loses work because a network blipped.
5. **One file, one paradigm.** Zero front-end framework dependencies. The entire app is three hand-rolled files.

---

## 5. Architecture at a glance

```
┌─────────────────────────────────────────────────────────┐
│  Surfaces                                                │
│  ┌──────────┐   ┌──────────────┐   ┌─────────────────┐  │
│  │ Website  │   │ Installed    │   │ Chrome          │  │
│  │ (browser)│   │ PWA (app)    │   │ Extension popup │  │
│  └────┬─────┘   └──────┬───────┘   └────────┬────────┘  │
│       │                │                     │           │
│       │   ?capture= / ?addtask= deep-links   │           │
│       └────────────────┼─────────────────────┘           │
│                        ▼                                  │
│            ┌───────────────────────┐                      │
│            │  index.html           │                      │
│            │  focus-app.css        │  (hand-rolled UI)    │
│            │  focus-logic.js       │                      │
│            └───────────┬───────────┘                      │
│                        ▼                                  │
│      localStorage (source of truth) ──► Firebase RTDB    │
│                        ▲          (debounced cloud sync)  │
│              sw.js (offline shell cache)                  │
└─────────────────────────────────────────────────────────┘
```

- **Persistence:** localStorage is the source of truth; Firebase Realtime Database provides cross-device sync with a 400 ms debounce and a `beforeunload` flush.
- **Service worker:** caches the static shell for instant launches; never caches Firebase or user data.
- **Deep-links:** `?capture=`, `?addtask=`, `?inbox=`, `?shortcuts=` let the extension and PWA shortcuts drive the main app.

---

## 6. Technical highlights

- **52+ commits** across a focused build cycle.
- **~6,800 lines of JavaScript, ~4,500 of CSS, ~2,000 of HTML** — all hand-rolled.
- **Zero front-end framework.** Only runtime dependency is Compromise.js for natural-language parsing.
- **Custom calendar hour grid** (~600 lines of pure DOM math) with dynamic per-render pixel sizing so it fits any viewport in one view.
- **`requestAnimationFrame` render coalescing** so rapid completion clicks never thrash the UI.
- **Auto-migrating schema** — every new field gets a safe default for existing user data; never a destructive migration.
- **Full PWA** — manifest with maskable icons, service worker, and a per-platform install flow.
- **Chrome MV3 extension** — translucent liquid-glass popup with `backdrop-filter` blur, dark-mode aware, deep-linking back to the main app.

---

## 7. Engineering lessons

1. **Local-first is a feature, not a convenience.** I shipped a debounced cloud-sync layer only after being bitten by the exact bug local-first architectures exist to prevent (tasks "disappearing" on refresh when a signed-in user's Firebase write timed out silently).
2. **Typography is the emotional channel.** A four-pass weight iteration (400 → 500 → 380 → 420 body) changed user sentiment more than any single feature; disabling synthetic bold was the decision that made it feel like a real product.
3. **Density wars are won with handles, not sliders.** A drag handle says "this is your workspace"; a number input says "the app decided."
4. **Build for your hardest user, ship for everyone.** Every accommodation designed for an ADHD/ENTJ pattern — lighter type, less noise, faster capture, more agency — improves the experience for the median user too.
5. **Friction belongs in the right places.** Adding it to the save button destroys an app; adding it to a dopamine gate before the planning surface saves a user from themselves.

---

## 8. Roadmap

- **Habit Brain Map** — a force-directed visualization of habit interconnections with AI-proposed merges gated by goal-preservation checks.
- **Extension v2** — live Today's-tasks list in the popup (Firebase fetch), badge count of unprocessed captures, right-click "capture page title + URL."
- **Whisper-based audio transcription** for video ingestion (opt-in, dynamic import).
- **Habit streak heatmaps** colored by theme.

---

## 9. Try it

| Surface | How |
|---|---|
| **Website** | whattodo-sable.vercel.app |
| **Install as app** | Open the site → click the "Install" banner (Chrome/Edge) or Share → Add to Home Screen (iOS) / File → Add to Dock (macOS Safari) |
| **Chrome extension** | `chrome://extensions` → Developer mode → Load unpacked → select `/extension` → press ⌘B anywhere |

---

*Focus Hub is in active development and private beta. Source, full case study, and a live demo are available on request.*
