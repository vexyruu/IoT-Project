import { insertFlights, type FlightRecord } from "./db";

// Perak bounding box
const PERAK_BBOX = {
  lamin: 3.5,
  lomin: 99.5,
  lamax: 6.0,
  lomax: 102.0,
} as const;

const OPENSKY_URL =
  `https://opensky-network.org/api/states/all` +
  `?lamin=${PERAK_BBOX.lamin}&lomin=${PERAK_BBOX.lomin}` +
  `&lamax=${PERAK_BBOX.lamax}&lomax=${PERAK_BBOX.lomax}`;

const TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

const POLL_INTERVAL_MS = 90_000;

const CLIENT_ID = process.env.OPENSKY_CLIENT_ID?.trim();
const CLIENT_SECRET = process.env.OPENSKY_CLIENT_SECRET?.trim();

let cachedToken: string | null = null;
let tokenExpiresAt: number = 0; 
const TOKEN_REFRESH_MARGIN_MS = 30_000;

async function getToken(): Promise<string | null> {
  if (!CLIENT_ID || !CLIENT_SECRET) return null;


  if (cachedToken && Date.now() < tokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) {
    return cachedToken;
  }

  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.error(`[collector] Token fetch failed: HTTP ${res.status}`);
      return null;
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + data.expires_in * 1000;
    console.log(`[collector] OAuth2 token refreshed (expires in ${data.expires_in}s)`);
    return cachedToken;
  } catch (err) {
    console.error(`[collector] Token fetch error:`, (err as Error).message);
    return null;
  }
}

const IDX = {
  icao24: 0,
  callsign: 1,
  longitude: 5,
  latitude: 6,
  baro_altitude: 7,
  on_ground: 8,
  velocity: 9,
  true_track: 10,
} as const;

async function poll(): Promise<void> {
  const ts = Math.floor(Date.now() / 1000);
  try {
    const headers: Record<string, string> = {
      "User-Agent": "TFB2093-Perak-Monitor/1.0",
    };

    const token = await getToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(OPENSKY_URL, {
      signal: AbortSignal.timeout(15_000),
      headers,
    });

    if (!res.ok) {
      console.warn(`[collector] OpenSky returned HTTP ${res.status} — skipping cycle`);
      return;
    }

    const body = (await res.json()) as { states: unknown[][] | null };
    const states = body?.states;

    if (!Array.isArray(states) || states.length === 0) {
      console.log(`[collector] ${new Date().toISOString()} — no aircraft in region`);
      return;
    }

    const records: FlightRecord[] = [];

    for (const sv of states) {
      const lat = sv[IDX.latitude] as number | null;
      const lon = sv[IDX.longitude] as number | null;

      if (lat == null || lon == null) continue;

      const icao24 = (sv[IDX.icao24] as string)?.trim();
      if (!icao24) continue;

      const callsign = ((sv[IDX.callsign] as string) ?? "").trim() || null;
      const altitude = (sv[IDX.baro_altitude] as number | null) ?? null;
      const velocity = (sv[IDX.velocity] as number | null) ?? null;
      const heading = (sv[IDX.true_track] as number | null) ?? null;
      const on_ground = sv[IDX.on_ground] ? 1 : 0;

      records.push({ icao24, callsign, latitude: lat, longitude: lon, altitude, velocity, heading, on_ground, ts });
    }

    insertFlights(records);
    console.log(
      `[collector] ${new Date().toISOString()} — inserted ${records.length} records (${states.length} states received)`
    );
  } catch (err) {
    console.error(`[collector] ${new Date().toISOString()} — fetch error:`, (err as Error).message);
  }
}

export function startCollector(): void {
  const authMode = CLIENT_ID ? `OAuth2 client: ${CLIENT_ID}` : "anonymous";
  console.log(`[collector] Starting — polling every ${POLL_INTERVAL_MS / 1000}s (${authMode})`);
  poll();
  setInterval(poll, POLL_INTERVAL_MS);
}
