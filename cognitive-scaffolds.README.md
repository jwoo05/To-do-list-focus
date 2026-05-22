# Cognitive Scaffolds — Paused Feature Set

This patch contains 5 features designed to externalize executive function
for ADHD/ENTJ-pattern brains. It was developed but **paused** on
2026-05-22 so we could land bug fixes first. To replay the work later:

```bash
cd /Users/jwoo5/Documents/tdf
git apply cognitive-scaffolds.patch
```

## What's in the patch

| Feature | Maps to (Jay's problem) | Files touched |
|---|---|---|
| **First Step** — every task surfaces its 5-second move | Transition paralysis | logic + html |
| **Quick Capture** — Cmd+K from anywhere, 3-word brain dump | Working memory wipe | logic + css |
| **Dopamine Gate** — soft-lock `plan` tasks until N min of `execute` work today | Productive procrastination | logic + css |
| **Domain Modes** — KTLO vs Active per domain; KTLO tasks fade | Capacity burnout | logic + css + html |
| **Time Anchor** — intrusive toast every 25 min during focus | Time blindness | logic only |

## Schema additions (auto-migrating)

```js
// On each task
{ firstStep: '', taskKind: '', domain: '' }

// On root state
S.brainDump = [];           // [{id, text, createdAt, processed}]
S.domains   = {};           // { name: { mode, color, createdAt } }

// On settings
S.settings.scaffolds      = { firstStep, quickCapture, dopamineGate, domainModes, timeAnchor }
S.settings.dopamineGate   = { minExecuteMinutes: 15, enforce: 'soft' }
```

Each feature is opt-in via `S.settings.scaffolds.<name> = true/false`.

## Why paused

User feedback prioritized fixing existing bugs (subtasks in bank,
archive scoping, persistence reliability, calendar legibility, etc.)
before layering on new behavior. Re-apply this patch only after those
land — it depends on `save()` actually persisting, otherwise the new
fields silently drop.
