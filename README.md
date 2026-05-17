# 🐐 Focus AI — Stay in the zone

Real-time focus accountability built on Claude vision. Screen + camera analysis, live focus score, AI coaching report, study rooms with leaderboards, weekly wagers, and a real video lapse of every session.

---

## Quick start (local)

```bash
npm run setup     # installs deps, generates Prisma client, pushes schema, copies .env
# edit .env to add your ANTHROPIC_API_KEY and a NEXTAUTH_SECRET
npm run dev       # Next.js on :3000 + socket server on :3001
```

Open <http://localhost:3000>, click **Get started**, and create an account at `/signup`. From there start a focus session at `/session`.

> If the UI ever looks unstyled / "text-only", run `npm run setup` again. That regenerates the Prisma client and clears Next.js's stale cache — the two most common culprits.

## Standalone planner data migration

The standalone planner files are `focus-app.html`, `focus-app.css`, `focus-logic.js`, `focus-auth.js`, and `firebase-config.js`. The planner now uses Firebase email/password auth and keeps timer runtime in local storage, so a refresh will restore an active timer.

To move an old local planner into a public account:

1. Open `focus-app.html` locally and go to **Settings → Backup Data → Export backup**.
2. In Firebase Console, enable **Authentication → Sign-in method → Email/Password**.
3. Copy your Firebase web app config into `firebase-config.js`.
4. Deploy the standalone planner files to Netlify/Firebase Hosting/GitHub Pages.
5. Open the deployed URL, create an account with email/password, then go to **Settings → Backup Data → Import backup** and select the exported JSON.
6. Future saves for that browser use `jay_hub_v3:user:<firebase uid>` instead of the shared `jay_hub_v3` key.

For true cross-device sync, store that exported JSON under the authenticated user id in Firestore or your Netlify/Firebase function, then load it into the same state shape before calling `save()`.

### What you need

| Variable | Required? | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | **Yes** | Powers live focus analysis + the end-of-session coaching report. |
| `NEXTAUTH_SECRET` | **Yes** | Encrypts the auth session cookie. `openssl rand -base64 32` works. |
| `DATABASE_URL` | Yes | Defaults to a local SQLite file. Swap for Postgres in production. |
| `GOOGLE_CLIENT_ID` / `GITHUB_CLIENT_ID` | Optional | Only needed if you want Google / GitHub OAuth. Email + password works without them. |

---

## Deployment

Focus AI is a standard Next.js app and deploys cleanly to Vercel, Render, Railway, Fly, or anywhere that runs Node 20.

### Vercel (recommended)

1. Push this folder to GitHub.
2. Import it in Vercel → set the **Root Directory** to `goat-app`.
3. Add env vars (see table above). For Postgres use Neon, Supabase, or Vercel Postgres.
4. Vercel automatically runs `vercel-build` (`prisma generate && prisma db push --accept-data-loss && next build`).
5. Add `NEXTAUTH_URL` = your Vercel URL.

The Socket.io leaderboard server (`server/index.js`) is a separate process — deploy it on Render / Fly / Railway as a Node service and set `NEXT_PUBLIC_SOCKET_URL` to its public URL. The web app works without it; only live room leaderboards need it.

### Self-hosted

```bash
npm install
npx prisma generate
npx prisma db push --accept-data-loss     # or `prisma migrate deploy` with migrations
npm run build
npm run start
# in another process:
npm run server
```

Put it behind a reverse proxy (Caddy / Nginx) with HTTPS — `getDisplayMedia` and `getUserMedia` only work on `https://` (or `localhost`).

---

## Architecture

### Focus session pipeline

1. User picks a goal at `/session`.
2. Browser asks for camera + screen share (either or both).
3. Every **4 seconds** a Web Worker triggers `runImmediateAnalysis()`:
   - Captures one JPEG from the screen and one from the camera.
   - POSTs them to `/api/analyze-frame`.
4. The route forwards the frames to **Claude Sonnet 4.5** (configurable) with a strict scoring rubric. The structured JSON response (`focusScore`, `isFocused`, `distractions`, `behaviors`, `summary`) updates Zustand state, the live ring score, and the action log.
5. If two consecutive frames are distracted, the runtime shows a soft check-in alert and offers to block the offending app.
6. Every **3 seconds** a paired snapshot (camera + screen, downsampled JPEGs) is added to the timelapse buffer.
7. On end, the browser builds a real `.webm` video lapse client-side via `MediaRecorder` (no upload, no storage cost). The session and AI report are persisted via `PATCH /api/session`.

### Files of interest

```
src/
├── app/
│   ├── login/, signup/                  # Email + password auth
│   ├── session/page.tsx                 # The focus session UI
│   ├── api/analyze-frame/route.ts       # Claude vision endpoint
│   ├── api/session/route.ts             # Start / end + coaching report
│   ├── api/auth/register/route.ts       # Account signup (PBKDF2 password)
│   └── api/auth/[...nextauth]/route.ts  # NextAuth handler (credentials + OAuth)
├── components/session/FocusRuntimeProvider.tsx  # The 4s analysis loop + alerts
├── lib/openai.ts                        # Claude prompts + robust JSON parsing
├── lib/auth.ts                          # NextAuth config + PBKDF2 helpers
├── lib/createTimelapse.ts               # Side-by-side webm lapse builder
└── store/sessionStore.ts                # Zustand session state
```

### Data model

Prisma schema in `prisma/schema.prisma`. Every focus session stores a row in `FocusSession`, every AI-analyzed frame in `FrameAnalysis`, and the end-of-session coaching report in `SessionReport`. **Raw screenshots and camera frames are never stored** — only the AI's structured analysis. Timelapse video is built and held in the browser.

---

## Tech stack

| Layer | Tool |
|---|---|
| Frontend | Next.js 14 (App Router), React, Tailwind CSS |
| State | Zustand |
| Real-time | Socket.io (rooms + leaderboards) |
| Auth | NextAuth credentials provider (PBKDF2) + optional Google / GitHub |
| Database | Prisma — SQLite for dev, Postgres for prod |
| AI | Claude Sonnet 4.5 (vision + reasoning) |
| Charts | Recharts |
| Video | Browser-native `MediaRecorder` + `<canvas>` |
