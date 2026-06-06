# Focus Hub — Designing a Calm Productivity Engine for a Neurodivergent Power User

**Role:** Sole designer & engineer  ·  **Timeline:** 3 weeks, 52 commits  ·  **Stack:** Vanilla JS, Firebase, Vercel  ·  **Live:** whattodo-sable.vercel.app

---

## The brief I gave myself

*How might I build a planner that doesn't fight the way my brain actually works?* Most productivity tools optimize for the **storage of intent**. I needed one that optimized for **execution under cognitive load** — for the ADHD-pattern executive system that exists in millions of high-achieving builders, including me.

## What I shipped

A single-page productivity engine, written in three hand-rolled files (HTML / CSS / JS), zero front-end frameworks, with local-first persistence and debounced Firebase cloud sync. ~12,000 lines of code. 52 commits.

## Four design decisions worth highlighting

**1. Typography as the emotional channel.** Four full passes — body weight 400 → 500 → 380 → **420**. Headers 700 → 540. Globally disabled synthetic bold (`font-synthesis: none`) so the system stops faking weights the chosen font doesn't ship. Result: an interface that reads Notion-calm without losing legibility.

**2. Density is a user choice, not a designer choice.** Six surfaces are user-resizable: column widths, calendar split, all-day strip height, calendar zoom (pinch / Cmd+scroll), density preset, archive scope. The "right" density doesn't exist — only the right *control* does.

**3. Local-first persistence is a UX feature, not an engineering convenience.** I learned this the hard way after users reported tasks disappearing on refresh. Refactored `save()` to write localStorage synchronously every time, with cloud sync debounced 400ms and flushed on `beforeunload`. Same architectural pass coalesced rapid `render()` calls through `requestAnimationFrame`, fixing a long-standing completion lag.

**4. Cognitive scaffolds for neurodivergent users.** A five-feature system designed for ADHD/ENTJ-pattern brains: **First Step** (every task surfaces its 5-second move), **Quick Capture** (`Cmd+K` from anywhere — 3-word brain dump), **Dopamine Gate** (soft-locks planning tasks until N min of execute work today), **Domain Modes** (KTLO vs Active per life domain), **Time Anchor** (intrusive toast every 25 min during focus). Deliberately parked as a documented patch until the foundation was rock-solid.

## What I learned

- **Build for your hardest user, ship for everyone.** Every accommodation I designed for my own ADHD pattern made the experience better for the median user too: lighter typography, less visual noise, faster capture, more agency.
- **Friction belongs in the right places.** Adding it to the save button destroys an app; adding it to a dopamine gate before the planning surface saves a user from themselves. Knowing which is which is the entire job.
- **Density wars are won with handles, not sliders.** A drag handle says "this is your workspace." A number input says "the app decided."

## Selected technicals

- iCal import with full RRULE / EXDATE / RDATE / VTIMEZONE handling, multi-file import, per-calendar color palette
- Custom Google-Calendar-style week hour grid (~600 lines of pure DOM math; no library)
- Dynamic hour-pixel computation so the week fits in one viewport at any window size
- Auto-migrating schema — every new field gets safe defaults; never a destructive migration
- Pinch + Cmd-scroll calendar zoom with persisted level (0.5×–2.5×)

## Reflection

Great productivity software is fundamentally an empathy exercise: you are designing a prosthesis for the part of the user's brain that is overloaded in the moment. Every decision is a vote about whose cognitive load you respect. I was the user; I built it for the version of me that was sitting in a chair unable to put on running shoes. The fact that I'm now writing this case study from the other side of that experience is the metric I care about most.

---

*Full case study available on request. Live demo: whattodo-sable.vercel.app*
