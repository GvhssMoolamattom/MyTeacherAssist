# School Portal

A private school app with student/teacher/admin roles, school-wide shared
data, a Teacher's Corner, and a per-teacher AI assistant powered by Google
Gemini (called through the backend only — the API key never reaches the
browser).

## File structure (as requested: 4 + 1 + 2)

```
frontend/
  index.html      – app shell
  style.css       – mobile-first styling, dark/light theme
  app.js          – state, routing, API calls, event handling
  components.js   – render functions for every screen
backend/
  server.js       – Express API: auth, roles, shared data, Gemini proxy
  data/db.json    – auto-created on first run (the central "database")
config/
  package.json    – backend dependencies
  .env.example    – copy to backend/.env and fill in real values
```

## How shared data actually works

Nothing important is stored only in the browser. `localStorage` is used
for exactly two things: your login session token, and your device's
dark/light preference. Everything else — announcements, school info, user
accounts, each teacher's AI settings and chat history — lives in
`backend/data/db.json` on the server and is fetched fresh from the API.
When Teacher A edits something, it's written there; when Teacher B loads
the same screen, they get Teacher A's version.

Every write endpoint re-checks the caller's role from their signed login
token — the frontend's idea of "I'm a teacher" is never trusted on its
own.

## Setup

1. **Install dependencies** (needs internet access — this sandbox didn't have any, so this step hasn't been run for you yet):
   ```bash
   cd config
   npm install
   ```
   This installs into `config/node_modules`. If your host expects
   `node_modules` next to `server.js` instead, just run `npm install`
   from inside `backend/` after copying `config/package.json` there —
   either layout works since `server.js` only uses relative requires to
   its own folder for local files.

2. **Configure secrets**:
   ```bash
   cp config/.env.example backend/.env
   ```
   Then edit `backend/.env` and fill in:
   - `JWT_SECRET` — any long random string (a command to generate one is in the file's comments)
   - `GEMINI_API_KEY` — from https://aistudio.google.com/app/apikey
   - `ADMIN_USERNAME` / `ADMIN_PASSWORD` — the first admin login, auto-created on first run

3. **Run the backend**:
   ```bash
   node backend/server.js
   ```
   You should see `School app backend listening on http://localhost:3000`.

4. **Open the frontend**: open `frontend/index.html` in a browser. If your
   backend isn't on `localhost:3000`, edit the `window.API_BASE` line near
   the top of `frontend/index.html` to point at wherever you deploy it.

5. **Log in** with the admin username/password from your `.env`, then use
   the Admin panel to create real teacher and student accounts.

## Deploying via GitHub

GitHub hosts your code, but it doesn't run a live Node process — so the
frontend and backend deploy two different ways from the same repo.

### 1. Push the repo

```bash
git init
git add .
git commit -m "School portal"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

`.gitignore` already excludes `node_modules/`, your real `.env`, and the
local `backend/data/db.json` — none of those should ever be committed.

### 2. Backend → Render (or Railway/Fly.io)

GitHub Pages can only serve static files, so `backend/server.js` needs a
host that keeps a Node process running. The simplest path:

1. Create a free account at [render.com](https://render.com) (Railway
   and Fly.io work the same way).
2. **New → Web Service → connect your GitHub repo.**
3. Set:
   - **Root directory**: repo root
   - **Build command**: `npm install --prefix config`
   - **Start command**: `node backend/server.js`
4. Under **Environment**, add the variables from `config/.env.example`
   (`JWT_SECRET`, `GEMINI_API_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`) —
   never commit these, only paste them into the host's dashboard.
5. Add a **persistent disk** mounted so `backend/data/db.json` survives
   redeploys (Render calls this a "Disk" in the service settings) —
   otherwise your shared data resets every time you push. Point
   `DB_PATH` in `server.js` at the mounted path if it differs from the
   default.
6. Deploy. You'll get a URL like `https://your-school-app.onrender.com`.
7. Render/Railway auto-redeploy the backend on every push to `main` —
   no GitHub Actions workflow needed for this part.

### 3. Frontend → GitHub Pages

`.github/workflows/deploy-frontend.yml` is already set up: on every push
to `main` that touches `frontend/`, it publishes the `frontend/` folder
to GitHub Pages automatically. One-time setup:

1. In your repo: **Settings → Pages → Source → GitHub Actions.**
2. Before pushing, edit `frontend/index.html` and point `API_BASE` at
   your backend's real URL from step 2:
   ```js
   window.API_BASE = window.API_BASE || 'https://your-school-app.onrender.com';
   ```
3. Push to `main`. Check the **Actions** tab for the run; once it's
   green, your app is live at `https://<you>.github.io/<repo>/`.

From then on, the workflow is just: edit code → commit → push to
`main` → frontend redeploys via Actions, backend redeploys via
Render/Railway's own GitHub integration. Two independent deploys, one
`git push`.

**`backend/data/db.json` is the real database** — back it up, and make
sure your host doesn't wipe the filesystem between deploys (some
free-tier hosts do; if yours does, that's the one thing that will break
persistence, and you'd want to point `DB_PATH` at a persistent volume).

## What's built vs. what's marked as needing your input

Per the "no fake demo" requirement — everything is real, working logic:
authentication, role checks, shared editing, per-teacher AI config and
private conversation history, and the Gemini proxy call are all fully
implemented and enforced server-side. The two things that only work once
*you* supply them (nothing to build, just configure):
- A real `GEMINI_API_KEY`
- A real always-on host if you want it reachable outside one device

## Build order this matches

Everything in the spec's "First Build" checklist is here: home page,
login, student/teacher/admin roles, Teacher's Corner, per-teacher AI
assistant, Gemini connection through the backend, shared JSON "database",
shared editing, permission system, and a mobile-responsive UI with bottom
navigation and dark/light mode.
