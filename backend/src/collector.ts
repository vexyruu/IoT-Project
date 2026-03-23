import { insertFlights, type FlightRecord } from "./db";

// Perak, Malaysia bounding box
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

const POLL_INTERVAL_MS = 60_000; // 60 seconds — respects OpenSky rate limits

// OpenSky state vector field indices (anonymous API)
// [icao24, callsign, origin_country, time_position, last_contact,
//  longitude, latitude, baro_altitude, on_ground, velocity,
//  true_track, vertical_rate, sensors, geo_altitude, squawk,
//  spi, position_source]
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
    const res = await fetch(OPENSKY_URL, {
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "TFB2093-Perak-Monitor/1.0" },
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

      // Skip records with missing position
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
    // Log but never crash — next interval will retry
    console.error(`[collector] ${new Date().toISOString()} — fetch error:`, (err as Error).message);
  }
}

export function startCollector(): void {
  console.log(`[collector] Starting — polling every ${POLL_INTERVAL_MS / 1000}s`);
  // Run immediately on start, then on interval
  poll();
  setInterval(poll, POLL_INTERVAL_MS);
}
