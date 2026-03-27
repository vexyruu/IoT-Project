# Perak Aircraft Monitor — Project Report
### TFB2093 IoT Data Acquisition System

---

## 1. Introduction

This project is an IoT-style **Perak Aircraft Monitor**, a real-time flight tracking and analytics system that continuously ingests live aircraft positional data over the state of **Perak, Malaysia**, persists it locally, and presents it through an interactive web dashboard. The system follows a classic IoT data pipeline pattern: an edge data collector fetches raw sensor-equivalent telemetry from a public ADS-B network, a backend API aggregates and serves that data, and a browser-based frontend visualises it in human-readable form.

The system is named **TFB2093** and the full technology stack is:

| Layer | Technology |
|---|---|
| Runtime | Bun ≥ 1.0 |
| Web Framework | Elysia (TypeScript) |
| Database | SQLite via `bun:sqlite` |
| Frontend | SvelteKit + Vite |
| Map | Leaflet.js + OpenStreetMap |
| Charts | Chart.js |
| Data Source | OpenSky Network (ADS-B REST API) |
| Cloud Host | Fly.io (backend) + Static host (frontend) |

---

## 2. Problem Statement

### Why Continuous Monitoring of Flights is Needed

Air traffic over a region is not static — aircraft appear, transit, and disappear within minutes. A single point-in-time query to the OpenSky API gives only a snapshot: it tells you what is in the sky *right now*, but nothing about patterns, frequency, altitude behaviour, or which specific aircraft are frequent visitors to the region.

Continuous monitoring addresses this by building a longitudinal time-series record. With persistent data you can answer questions that a snapshot cannot:

- At what hours of the day is Perak airspace most congested?
- Is a particular aircraft climbing, descending, or in level cruise?
- Which ICAO24-identified aircraft transits the region most frequently?
- What is the full historical flight path of a specific aircraft over a multi-day window?

This is valuable for air traffic pattern analysis, academic research, and IoT system design demonstrations. The system polls the OpenSky Network API every **90 seconds**, capturing every state vector broadcast by aircraft within the bounding box `3.5°N–6.0°N, 99.5°E–102.0°E` (the geographic extent of Perak and its surrounding approaches).

### Why the Collection Duration Must Be 72 Hours (3 Days)

A 3-day (72-hour) continuous collection window is the minimum meaningful period for this use case for several reasons:

1. **Diurnal coverage**: A single 24-hour window captures one day-night cycle. 72 hours covers three complete cycles, allowing comparison of traffic patterns across different days of the week and distinguishing weekday from weekend behaviour.

2. **Statistical significance**: With a poll interval of 90 seconds, 72 hours produces:

   > 72 h × 3600 s/h ÷ 90 s = **2,880 poll cycles**

   At an average of ~10 aircraft per cycle over Perak, this yields approximately **28,800 records** — sufficient volume for meaningful aggregate analytics (hourly traffic charts, altitude transition ratios, top-aircraft rankings).

3. **Assignment specification**: The project documentation explicitly states: *"Continuous 72+ hour collection is intended on a host that stays up (e.g. Fly.io with a volume and `DB_PATH`)."* Local development is only for demos; production collection must be uninterrupted for the full 3-day window to satisfy the academic requirement.

4. **Capture rare events**: Low-frequency flights (cargo, executive, or positioning flights) may only appear once or twice per day. A 72-hour window maximises the probability of capturing such aircraft, making the Top Aircraft by Sightings chart meaningful.

---

## 3. System Design

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         INTERNET                                    │
│                                                                     │
│   ┌─────────────────────────────────┐                               │
│   │   OpenSky Network REST API      │                               │
│   │   opensky-network.org           │                               │
│   │   /api/states/all?bbox=Perak    │                               │
│   └────────────────┬────────────────┘                               │
│                    │ HTTPS GET (every 90s)                          │
│                    │ Optional: OAuth2 Bearer Token                  │
└────────────────────┼────────────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────────────┐
│                    BACKEND  (Fly.io — region: sin)                  │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │  collector.ts  (startCollector / setInterval 90 000 ms)     │   │
│   │                                                             │   │
│   │  • Fetches state vectors for bbox                           │   │
│   │  • Parses ICAO24, callsign, lat, lon, alt, vel, heading     │   │
│   │  • Calls insertFlights() in a DB transaction                │   │
│   └──────────────────────────┬──────────────────────────────────┘   │
│                              │                                      │
│   ┌──────────────────────────▼──────────────────────────────────┐   │
│   │  db.ts  (bun:sqlite → /data/flights.db)                     │   │
│   │                                                             │   │
│   │  Table: flights                                             │   │
│   │  Indexes: idx_ts, idx_icao_ts                               │   │
│   │  WAL mode, synchronous = NORMAL                             │   │
│   └──────────────────────────┬──────────────────────────────────┘   │
│                              │                                      │
│   ┌──────────────────────────▼──────────────────────────────────┐   │
│   │  index.ts  (Elysia + CORS — port 3000)                      │   │
│   │                                                             │   │
│   │  GET /api/latest     → queryLatest()   (last 5 min)         │   │
│   │  GET /api/history    → queryHistory()  (by icao24 + range)  │   │
│   │  GET /api/analytics  → queryAnalytics() (hourly aggregates) │   │
│   └──────────────────────────┬──────────────────────────────────┘   │
│                              │ JSON over HTTPS                      │
│               Fly.io volume: /data/flights.db persists across       │
│               restarts (DB_PATH env var)                            │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                   FRONTEND  (SvelteKit Static SPA)                  │
│                   Cloudflare Pages / Vercel / local                 │
│                                                                     │
│   ┌────────────────────────┐   ┌──────────────────────────────┐    │
│   │  Map.svelte            │   │  Charts.svelte               │    │
│   │                        │   │                              │    │
│   │  • Leaflet + OSM tiles │   │  • Bar: Aircraft/hour        │    │
│   │  • Live markers from   │   │  • Bar: Alt status           │    │
│   │    /api/latest (60s)   │   │  • Bar: Top ICAO24           │    │
│   │  • History polyline    │   │  • Line: Altitude trend      │    │
│   │    from /api/history   │   │    from /api/history         │    │
│   └────────────────────────┘   └──────────────────────────────┘    │
│                                                                     │
│   +page.svelte: date-range filter bar, stats pills, layout          │
└─────────────────────────────────────────────────────────────────────┘
```

### Components Used

| Component | File(s) | Role |
|---|---|---|
| **Data Collector** | `backend/src/collector.ts` | Polls OpenSky every 90 s, obtains OAuth2 token, parses ADS-B state vectors, writes to SQLite |
| **Database Layer** | `backend/src/db.ts` | Opens/initialises SQLite, exposes `insertFlights`, `queryLatest`, `queryHistory`, `queryAnalytics` |
| **API Server** | `backend/src/index.ts` | Elysia app: mounts CORS, three route plugins, starts collector |
| **Latest Route** | `backend/src/routes/latest.ts` | `GET /api/latest` — current live aircraft (last 5 min) |
| **History Route** | `backend/src/routes/history.ts` | `GET /api/history` — time-range track for a given ICAO24 |
| **Analytics Route** | `backend/src/routes/analytics.ts` | `GET /api/analytics` — hourly counts, altitude transitions, top aircraft |
| **Dashboard Page** | `frontend/src/routes/+page.svelte` | Main SPA layout: header, filter bar, stats, map + charts panels |
| **Map Component** | `frontend/src/lib/Map.svelte` | Leaflet map, bbox rectangle, live markers, history polyline |
| **Charts Component** | `frontend/src/lib/Charts.svelte` | Four Chart.js charts, loaded from analytics and history APIs |
| **DB Maintenance** | `backend/cleandb.ts` | Standalone script to wipe and VACUUM the database (production use) |

### Data Flow Description

1. **Collection**: On startup, `startCollector()` in `collector.ts` immediately calls `poll()` and then sets a `setInterval` for every 90,000 ms. Each `poll()` call:
   - Obtains a cached OAuth2 Bearer token from `auth.opensky-network.org` (refreshed 30 s before expiry), or falls back to anonymous if credentials are not set.
   - Issues an HTTPS GET to `opensky-network.org/api/states/all` with the Perak bounding box query parameters.
   - Parses the response array of state vectors, extracts fields at known index positions (ICAO24, callsign, longitude [5], latitude [6], barometric altitude [7], on_ground [8], velocity [9], true track [10]).
   - Filters out any record with a null latitude or longitude.
   - Wraps all valid records in a SQLite transaction via `insertFlights()`.

2. **Storage**: Every record is appended as a new row in the `flights` table. There is no deduplication — each poll cycle produces one row per visible aircraft, building a complete time-series.

3. **Serving**: The Elysia server exposes three JSON endpoints. Queries hit SQLite via prepared statements with index-backed `WHERE ts >= ?` and `WHERE icao24 = ?` clauses, keeping response times low even after 72 hours of data accumulation.

4. **Visualisation**: The SvelteKit frontend is a client-side-only SPA (`ssr = false`). On load it dynamically imports `Map.svelte` and `Charts.svelte`. The map refreshes `/api/latest` every 60 seconds independently of the backend poll cycle. Charts load `/api/analytics` on mount and re-query when the user changes the date-range filter. Clicking a map marker triggers `/api/history` for that ICAO24, drawing both a polyline track on the map and an altitude trend line chart.

---

## 4. Database Design

### Data Storage Strategy

The project uses **SQLite** accessed directly via Bun's built-in `bun:sqlite` module — no external database process, no network round-trip, no ORM overhead. SQLite was chosen because:

- The workload is **single-writer** (one collector process) with occasional read bursts from API queries — exactly where SQLite excels.
- The database file lives on a **Fly.io persistent volume** (`/data/flights.db`), surviving container restarts across the full 72-hour collection period.
- No schema migrations, no connection pooling, and no binary dependencies are needed — the entire database is a single file.

**WAL (Write-Ahead Logging)** mode is enabled so that read queries from the API do not block ongoing inserts from the collector, and vice versa. `synchronous = NORMAL` reduces fsync overhead while maintaining crash safety within a transaction.

### Schema

```sql
CREATE TABLE IF NOT EXISTS flights (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  icao24    TEXT    NOT NULL,       -- ICAO 24-bit address (hex), e.g. "750587"
  callsign  TEXT,                   -- Flight number / callsign, e.g. "MAS123"
  latitude  REAL    NOT NULL,       -- Decimal degrees, WGS-84
  longitude REAL    NOT NULL,       -- Decimal degrees, WGS-84
  altitude  REAL,                   -- Barometric altitude, metres (NULL if not reported)
  velocity  REAL,                   -- Ground speed, m/s (NULL if not reported)
  heading   REAL,                   -- True track, degrees 0–360
  on_ground INTEGER,                -- 1 = on ground, 0 = airborne
  ts        INTEGER NOT NULL        -- Unix timestamp (seconds) at collection time
);

CREATE INDEX IF NOT EXISTS idx_ts       ON flights(ts);
CREATE INDEX IF NOT EXISTS idx_icao_ts  ON flights(icao24, ts);
```

### How Flight Data is Stored

| Field | Source | Notes |
|---|---|---|
| `icao24` | OpenSky state vector [0] | Unique aircraft identifier, used as the primary grouping key |
| `callsign` | OpenSky state vector [1] | Trimmed; stored as `NULL` if empty |
| `latitude` | OpenSky state vector [6] | WGS-84 decimal degrees |
| `longitude` | OpenSky state vector [5] | WGS-84 decimal degrees |
| `altitude` | OpenSky state vector [7] | Barometric altitude in metres; `NULL` when not transponder-reported |
| `velocity` | OpenSky state vector [9] | Ground speed in m/s |
| `heading` | OpenSky state vector [10] | True track in degrees |
| `on_ground` | OpenSky state vector [8] | SQLite integer: 1 = on ground, 0 = airborne |
| `ts` | `Math.floor(Date.now() / 1000)` | Collector-side Unix timestamp in whole seconds |

Every poll appends rows — there is no UPDATE or upsert. This append-only strategy means:
- The full flight history of every aircraft is preserved at 90-second resolution.
- `queryLatest()` recovers the current snapshot by selecting the row with `MAX(ts)` per `icao24` within the last 5 minutes.
- `queryHistory()` simply filters by `icao24` and a time range, returning rows ordered by `ts ASC`.

### Storage Estimate for 72-Hour Collection

| Variable | Value |
|---|---|
| Poll interval | 90 seconds |
| Poll cycles in 72 h | 2,880 |
| Average aircraft per poll (Perak) | ~10 |
| Estimated total rows | ~28,800 |
| Approximate bytes per row | ~200 bytes |
| Estimated DB size | ~5–8 MB |

SQLite with WAL keeps this well within Fly.io's free volume allocation.

---

## 5. Data Visualization

### Tools and Libraries

| Library | Version | Purpose |
|---|---|---|
| **Leaflet.js** | `^1.9.4` | Interactive map with OSM tile layer, custom markers, polyline flight tracks |
| **Chart.js** | `^4.x` (`chart.js/auto`) | Canvas-based charts: bar, horizontal bar, line |
| **SvelteKit** | `^2.x` | Component framework, routing, client-only SPA (adapter-static) |
| **Vite** | `^6.x` | Dev server and production bundler |
| **OpenStreetMap** | (tile server) | Base map tiles rendered under Leaflet |

### Dashboard / Interface Design

The dashboard is a single-page application with a dark theme (slate colour palette). It is structured as:

```
┌──────────────────────────────────────────────────────────┐
│  HEADER: "Perak Aircraft Monitor"  |  [Visible Now: N]  │
│          "IoT Data Acquisition System — TFB2093"        │
│                                        [Last Poll: HH:MM]│
├──────────────────────────────────────────────────────────┤
│  FILTER BAR: [From datetime] [To datetime] [Apply]      │
│              [Selected: ICAO24  ✕ Clear]  (if selected) │
├───────────────────────────┬──────────────────────────────┤
│  MAP PANEL                │  ANALYTICS PANEL             │
│  "Live Map — Perak        │  "Analytics"                 │
│   Airspace"               │                              │
│  [Refreshes every 60s]    │  ┌────────┐  ┌────────┐     │
│                           │  │Aircraft│  │Alt     │     │
│  • OSM base map           │  │/Hour   │  │Status  │     │
│  • Blue bbox rectangle    │  │(bar)   │  │(bar)   │     │
│  • ✈ markers per aircraft │  └────────┘  └────────┘     │
│  • Orange polyline track  │  ┌────────┐  ┌────────┐     │
│    when aircraft selected │  │Top     │  │Altitude│     │
│                           │  │ICAO24  │  │Trend   │     │
│                           │  │(horiz) │  │(line)  │     │
│                           │  └────────┘  └────────┘     │
├───────────────────────────┴──────────────────────────────┤
│  FOOTER: bbox · Data: OpenSky Network · TFB2093          │
└──────────────────────────────────────────────────────────┘
```

The layout uses a CSS grid with two equal columns for the map and analytics panels, collapsing to a single column on screens narrower than 900 px. The charts panel itself uses a 2×2 grid layout (collapsing at 700 px), giving four chart cards.

### Sample Charts and Graphs

**Chart 1 — Aircraft Sightings per Hour (Bar chart)**
- X-axis: Hour label formatted as "Mar 7, 05:00"
- Y-axis: Count of unique ICAO24 addresses seen in that hour
- Colour: Blue (`rgba(59, 130, 246, 0.7)`)
- Purpose: Shows diurnal traffic patterns — reveals peak and quiet periods across the 72-hour window
- Data source: `GET /api/analytics` → `flightsPerHour`

**Chart 2 — Altitude Change Status (Bar chart)**
- X-axis: Status categories — Ascending / Level / Descending
- Y-axis: Number of consecutive-reading transitions in that status
- Colours: Green (Ascending), Yellow (Level), Red (Descending)
- Derived using SQLite `LAG()` window function comparing consecutive altitude readings per aircraft
- Purpose: Shows the overall distribution of flight phases (climb, cruise, descent) in the region
- Data source: `GET /api/analytics` → `altitudeStatus`

**Chart 3 — Top Aircraft by Sightings (Horizontal bar chart)**
- Y-axis: ICAO24 hex identifiers (top 10, monospace font)
- X-axis: Total record count collected for that aircraft
- Colour: Purple (`rgba(139, 92, 246, 0.7)`)
- Purpose: Identifies the most frequently observed aircraft over Perak — likely scheduled domestic routes
- Data source: `GET /api/analytics` → `topIcao`

**Chart 4 — Altitude Trend for Selected Aircraft (Line chart)**
- X-axis: Time (HH:MM, up to 10 tick marks)
- Y-axis: Barometric altitude in metres
- Colour: Orange (`rgba(249, 115, 22, 0.9)`) with fill
- Only rendered when the user clicks a map marker; shows the aircraft's altitude profile over the chosen time window
- Filters out on-ground points and null altitudes; shows an informational message if the aircraft was on the ground
- Data source: `GET /api/history?icao24=<hex>&from=<unix>&to=<unix>` → filtered by `altitude > 50 AND NOT on_ground`

---

## 6. Cost Considerations

### Budget Breakdown

The entire system is designed to run at **near-zero marginal cost** by leveraging free-tier cloud services and an open-access data source.

#### Data Source — OpenSky Network

- **Cost: Free**
- The OpenSky Network provides a public REST API for ADS-B data at no charge.
- Anonymous access is rate-limited. The system supports **OAuth2 client credentials** (registered free at opensky-network.org) to obtain a Bearer token, which grants higher request quotas.
- At one request every 90 seconds, the system makes **2,880 API calls over 72 hours** — well within free-tier limits.

#### Backend Compute — Fly.io

- **Cost: Free tier / ~$1.94–$5/month paid**

| Resource | Fly.io Free Tier | This Project's Usage |
|---|---|---|
| Shared CPU VM (`shared-cpu-1x`) | 3 free VMs | 1 VM (`iot-project`, region `sin`) |
| RAM | 256 MB shared | Sufficient for Bun + SQLite |
| Persistent Volume | 3 GB free | ~5–8 MB used after 72 h collection |
| Outbound bandwidth | 100 GB/month | Negligible (small JSON responses) |
| Inbound (OpenSky API calls) | Free | ~2,880 × ~5 KB = ~14 MB / 72 h |

The Fly.io configuration deploys the app in region `sin` (Singapore) — the closest region to Perak — minimising latency to both the OpenSky API and the end-user browser. The `flights_data` volume is mounted at `/data` and `DB_PATH=/data/flights.db` is injected as an environment variable, ensuring the SQLite database survives container restarts.

#### Frontend Hosting — Static SPA

- **Cost: Free**
- The SvelteKit frontend builds to a static bundle (`adapter-static` with `fallback: index.html`). It can be hosted for free on:
  - **Cloudflare Pages**
  - **Vercel** (free hobby tier)
  - **GitHub Pages**
- No server compute is required since the frontend is purely client-side JavaScript.

#### Cost Summary

| Item | Monthly Cost |
|---|---|
| OpenSky Network API | $0.00 |
| Fly.io VM (free tier) | $0.00 |
| Fly.io persistent volume (~150 MB) | $0.00 |
| Frontend static hosting | $0.00 |
| **Total (free tier)** | **$0.00** |
| Fly.io paid VM (if free tier exceeded) | ~$1.94 |
| **Total (worst case, paid tier)** | **~$2.00/month** |

There are no hardware costs — no Raspberry Pi, no microcontroller, no sensor — because ADS-B transponder data is collected from the OpenSky Network's globally distributed receiver network. The "IoT" characteristic is the continuous, automated, time-series nature of the data acquisition, not the physical layer.

---

## 7. Conclusion

### Summary of Findings

The Perak Aircraft Monitor (TFB2093) demonstrates a complete end-to-end IoT data pipeline implemented entirely in software. The key findings and design outcomes are:

1. **Feasibility of cloud-based IoT without physical hardware**: By treating the OpenSky Network as the "sensor layer", the project achieves real-time aircraft telemetry (latitude, longitude, altitude, velocity, heading) without purchasing or deploying any physical IoT devices. OAuth2 authentication ensures reliable, rate-limit-respecting access.

2. **SQLite is sufficient for a single-node time-series workload**: The append-only row-per-reading storage model, combined with WAL mode and composite indexing on `(icao24, ts)`, provides fast query response across tens of thousands of records with no configuration overhead. An estimated 28,800 rows over 72 hours occupies only 5–8 MB.

3. **A 90-second poll interval balances data resolution against API quota**: Each poll captures every aircraft currently transmitting over Perak. At this rate, the system builds a 72-hour track with sub-two-minute temporal resolution — fine enough to reconstruct flight paths and altitude profiles, while consuming only ~14 MB of inbound bandwidth over the full collection period.

4. **72-hour collection is the minimum for meaningful analytics**: Three days of data provides three diurnal cycles, statistical confidence for traffic pattern charts, and sufficient sightings of low-frequency flights to make the Top Aircraft ranking meaningful.

5. **The full stack is free to operate**: The combination of Fly.io free tier (VM + persistent volume), OpenSky Network's free API, and static SPA hosting results in zero ongoing monetary cost for the complete deployed system.

6. **SvelteKit + Leaflet + Chart.js is a lightweight but capable visualisation stack**: The four analytics charts (hourly traffic, altitude status, top aircraft, per-aircraft altitude trend) together with the interactive Leaflet map and flight track polyline provide a comprehensive situational awareness dashboard. The client-only SPA (`ssr = false`, `adapter-static`) architecture simplifies deployment to any static host with no server-side rendering infrastructure.

The project successfully achieves its objectives: continuous ingestion of live ADS-B telemetry, durable storage across a 72-hour window, and an interactive web interface that makes the collected data immediately queryable and visually interpretable.

---

*Report prepared for TFB2093 — IoT Data Acquisition System.*  
*Data source: OpenSky Network (opensky-network.org).*  
*Deployment: Fly.io, region: sin (Singapore).*
