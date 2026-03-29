# Perak Aircraft Monitor (TFB2093)

IoT-style pipeline: **OpenSky → SQLite → REST API → SvelteKit dashboard** (aircraft over Perak, Malaysia).

---

## Prerequisites

| Tool | Purpose |
|------|---------|
| **[Bun](https://bun.sh)** ≥ 1.0 | Backend (API + collector) |
| **[Node.js](https://nodejs.org)** ≥ 18 | Frontend (npm / Vite / SvelteKit) |

Install Bun (Windows, PowerShell):

```powershell
npm install -g bun
```

---

## Project layout

```
IoT/
├── backend/          # Bun + Elysia: collector + /api/*
│   ├── src/
│   └── data/         # SQLite (created on first run; gitignored)
└── frontend/         # SvelteKit dashboard
```

---

## 1. Backend (local)

```powershell
cd backend
bun install
```

Optional: ensure the data directory exists (usually created automatically):

```powershell
mkdir data -ErrorAction SilentlyContinue
```

Start the server and collector (polls OpenSky every **60 seconds**, stores in `backend/data/flights.db`):

```powershell
bun run start
```

- **API:** [http://localhost:3000](http://localhost:3000)
- **Env (optional):**
  - `PORT` — default `3000`
  - `DB_PATH` — default `backend/data/flights.db` (useful on Fly.io with a volume)

Dev mode (auto-restart on file changes):

```powershell
bun run dev
```

### Quick API checks

- `GET http://localhost:3000/api/latest` — recent aircraft for the map  
- `GET http://localhost:3000/api/analytics` — charts data  
- `GET http://localhost:3000/api/history?icao24=<hex>&from=<unix>&to=<unix>` — track for one aircraft  

---

## 2. Frontend (local)

Open a **second** terminal:

```powershell
cd frontend
npm install
```

Configure the API URL the browser will call. For local backend:

```powershell
copy .env.example .env
```

Edit `frontend/.env` and set:

```env
PUBLIC_API_BASE=http://localhost:3000
```

Start the dashboard:

```powershell
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

---

## 3. Run both together

1. Terminal A: `cd backend` → `bun run start`  
2. Terminal B: `cd frontend` → `npm run dev`  
3. Browser: `http://localhost:5173`  

Wait up to **60 seconds** for the first OpenSky poll; the map and analytics fill as data arrives.

---

## 4. Production build (frontend only)

```powershell
cd frontend
npm run build
npm run preview
```

Set `PUBLIC_API_BASE` in `.env` to your deployed API (e.g. `https://your-app.fly.dev`) before `npm run build`.

---

## Troubleshooting

| Issue | What to try |
|-------|-------------|
| Map/charts empty | Confirm backend is running; wait for next 60s poll; check Perak may have few aircraft at times. |
| CORS / fetch errors | `PUBLIC_API_BASE` must match the URL where the API is reachable from the browser (include `http://` / `https://`, no trailing slash). |
| `bun` not found | Install Bun and reopen the terminal, or use full path to `bun.exe`. |

---

## Assignment note

Continuous **72+ hour** collection is intended on a host that stays up (e.g. **Fly.io** with a volume and `DB_PATH`). Local setup above is for development and demos.
