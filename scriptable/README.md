# iPhone / iPad Today widget

A Scriptable widget that shows today's Focus Hub tasks on the home screen.
Reads from your Vercel `/api/today` endpoint, which proxies Firebase under a
shared API key.

```
Firebase RTDB  ──►  /api/today (Vercel)  ──►  Scriptable widget
                       firebase-admin           native iOS
                       MOONLIT_API_KEY          home-screen widget
```

---

## Setup (one-time, ~10 minutes)

### 1. Generate a Firebase service account

The API endpoint needs server-side read access. Service accounts let it
bypass Firebase Auth without exposing user tokens.

1. Open [Firebase Console](https://console.firebase.google.com/) → your
   project → ⚙ **Project settings** → **Service accounts** tab.
2. Click **Generate new private key** → confirm → it downloads a JSON file.
   **Treat this like a password.** Don't commit it.
3. Open the JSON in a text editor and copy the entire contents (one big object
   that starts with `{ "type": "service_account", … }`).

### 2. Find your Firebase UID

1. Firebase Console → **Authentication** → **Users** tab.
2. Find your account (your Gmail).
3. Copy the **User UID** column (long base64-ish string).

### 3. Pick an API key

This is a secret you invent. The widget and the server share it.

```sh
# A reasonable way to generate one on macOS:
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

Save the result — you'll paste it into Vercel and into the Scriptable script.

### 4. Set Vercel environment variables

1. Vercel dashboard → your project → **Settings → Environment Variables**.
2. Add four variables, all checked for **Production** (and Preview/Development
   if you want it to work in previews too):

   | Name | Value |
   |---|---|
   | `FIREBASE_SERVICE_ACCOUNT` | the entire JSON from step 1 (paste the whole `{…}`) |
   | `FIREBASE_DATABASE_URL` | `https://<your-project-id>-default-rtdb.firebaseio.com` (find this in Firebase Console → Realtime Database) |
   | `MOONLIT_API_KEY` | the secret from step 3 |
   | `MOONLIT_USER_UID` | the UID from step 2 |

3. Click **Save**, then **Deployments → ⋯ → Redeploy** on the latest deploy
   (env-var changes don't auto-trigger a rebuild).

### 5. Test the endpoint

Open in a browser, replacing `<KEY>`:

```
https://focuslists.vercel.app/api/today?key=<KEY>
```

You should see JSON like:

```json
{
  "date": "2026-05-19",
  "tasks": [
    { "id": "abc", "title": "PHYS HW 4", "priority": "MUST", "isHabit": false, "done": false }
  ],
  "updatedAt": 1747000000000
}
```

If you see `{"error": "Unauthorized"}` — the key doesn't match.
If you see a 500 with `FIREBASE_SERVICE_ACCOUNT is not valid JSON` — the env
var has the wrong shape (must be the full JSON, including outer braces).

### 6. Install Scriptable and the widget

1. App Store → install **Scriptable** (free).
2. Open Scriptable → tap **+** (top right) → name it "Focus Hub Today" → paste
   the contents of `today-widget.js`.
3. At the top of the script, set:
   ```js
   const API_URL = 'https://focuslists.vercel.app/api/today';
   const API_KEY = 'paste-your-MOONLIT_API_KEY-here';
   ```
4. Tap **Play ▶** at the bottom to preview. You should see your tasks.

### 7. Add to the home screen

1. Long-press your home screen → **+** (top left) → search **Scriptable**.
2. Pick a widget size (Medium is the sweet spot — shows ~6 tasks).
3. Place it. Long-press it → **Edit Widget**.
4. **Script:** Focus Hub Today.
5. **When Interacting:** Run Script (so tapping opens the web app).

iOS refreshes the widget every ~10 minutes; the script also hints
`refreshAfterDate` accordingly.

---

## Limits & gotchas

- **Single-user**: `MOONLIT_USER_UID` is hardcoded. To support multiple users
  you'd need per-user API keys; we can add that later.
- **Read-only**: tapping a task can't mark it complete yet. The widget opens
  the web app on tap as the next-best UX. Write support is a v2.
- **Firebase free tier**: the service-account read costs nothing meaningful.
- **Token expiry**: not an issue here — service accounts don't expire like ID
  tokens do.
- **Privacy**: anyone with `MOONLIT_API_KEY` can read this UID's tasks. Don't
  share the key. If it leaks, rotate it by changing the Vercel env var and
  re-deploying, then update the Scriptable script.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Widget shows "Focus Hub offline" | API URL or key wrong, or Vercel deploy isn't live. Open the URL in Safari to see the actual error. |
| `{"error":"Unauthorized"}` | `API_KEY` in Scriptable doesn't match `MOONLIT_API_KEY` in Vercel. |
| `{"error":"Missing uid …"}` | `MOONLIT_USER_UID` env var not set, or no UID in the URL. |
| `{"error":"FIREBASE_SERVICE_ACCOUNT …"}` | The env var isn't the full JSON. Make sure you pasted the whole object, including outer `{ }`. |
| Endpoint returns `{tasks: []}` even when you have tasks today | UID is wrong, or your tasks aren't due *today* (check `scheduledDates` / `scheduledDays`). |
