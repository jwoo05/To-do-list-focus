# Focus Hub — Browser Extension

A floating, translucent companion popup for the Focus Hub planner.

The browser-toolbar icon is your "folded tab." Click it (or press
**⌘B** on macOS / **Ctrl+B** on Windows/Linux) from any page to
unfold a Notion-paper-colored panel with:

- A live greeting and today's date
- A focused **Quick Capture** input (Enter to save)
- A folded "Today" disclosure
- Three deep-link buttons: **Add task**, **Inbox**, **Shortcuts**
- An **Open full app** button that launches the main site in a new tab

The popup uses translucent surfaces (`backdrop-filter: blur(20px) saturate(140%)`)
so it floats over the underlying page like a frosted-glass card. Color
tokens mirror the main site's calm Notion-paper palette; dark mode auto-
adopts the OS preference.

---

## Install (developer mode — Chrome, Edge, Brave, Arc)

1. Open `chrome://extensions/`
2. Toggle **Developer mode** on (top-right)
3. Click **Load unpacked**
4. Select the `/extension` folder in this repo
5. Pin the **Focus Hub** icon to your toolbar (puzzle-piece menu → pin)

Now click the toolbar icon or press **⌘B** / **Ctrl+B** anywhere in
your browser to summon the popup.

---

## Install (Firefox)

Manifest V3 is supported in Firefox 109+. The same `manifest.json` works:

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select any file inside `/extension` (e.g. `manifest.json`)

To install permanently, the extension would need to be signed and
distributed via AMO.

---

## How quick-capture hands off to the main app

The popup buffers your capture in `chrome.storage.local` (so nothing is
lost if your network blips), then opens the main site at:

```
https://whattodo-sable.vercel.app/?capture=<your text>
```

The main app reads the `?capture=` URL parameter on load, pushes the
text into `S.brainDump`, shows a confirmation toast, and strips the
parameter from the URL bar so a refresh doesn't double-add.

Deep-links supported by the main app:

| URL parameter | Effect |
|---|---|
| `?capture=hello` | Adds `"hello"` to the brain-dump inbox |
| `?addtask=1`     | Opens the Add Task modal |
| `?inbox=1`       | Opens the Brain Dump panel |
| `?shortcuts=1`   | Opens the Shortcuts & Tips modal |

---

## File map

```
extension/
├── manifest.json     — MV3 manifest (Chrome/Edge/Brave/Arc + Firefox 109+)
├── popup.html        — Popup UI
├── popup.css         — Translucent Notion-paper styles
├── popup.js          — Quick-capture, deep-link routing, greeting
├── background.js     — Service worker (placeholder; future badge counts)
└── icons/            — 16/32/48/128 PNGs of the brand mark
```

---

## Roadmap

- **Today's tasks live in the popup** — pull from Firebase on open so the
  disclosure shows real tasks instead of a "Open the full app" hint
- **Badge count** — show unprocessed brain-dump items on the toolbar icon
- **Right-click menu** — "Capture page title and URL" from any web page
- **Keyboard-launchable mini focus timer** — start a 25-min pomo without
  leaving the page you're on
