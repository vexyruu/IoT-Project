import { Database } from "bun:sqlite";
import { join } from "path";

const DEFAULT_DB_PATH = join(import.meta.dir, "..", "data", "flights.db");
const DB_PATH = process.env.DB_PATH?.trim() || DEFAULT_DB_PATH;

let _db: Database | null = null;

export function getDb(): Database {
  if (!_db) {
    _db = new Database(DB_PATH, { create: true });
    _db.exec("PRAGMA journal_mode = WAL;");
    _db.exec("PRAGMA synchronous = NORMAL;");
    initSchema(_db);
  }
  return _db;
}

function initSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS flights (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      icao24    TEXT    NOT NULL,
      callsign  TEXT,
      latitude  REAL    NOT NULL,
      longitude REAL    NOT NULL,
      altitude  REAL,
      velocity  REAL,
      heading   REAL,
      on_ground INTEGER,
      ts        INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ts
      ON flights(ts);

    CREATE INDEX IF NOT EXISTS idx_icao_ts
      ON flights(icao24, ts);
  `);
}

export interface FlightRecord {
  icao24: string;
  callsign: string | null;
  latitude: number;
  longitude: number;
  altitude: number | null;
  velocity: number | null;
  heading: number | null;
  on_ground: number | null;
  ts: number;
}

export function insertFlights(records: FlightRecord[]): void {
  if (records.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO flights
      (icao24, callsign, latitude, longitude, altitude, velocity, heading, on_ground, ts)
    VALUES
      ($icao24, $callsign, $latitude, $longitude, $altitude, $velocity, $heading, $on_ground, $ts)
  `);
  const insertMany = db.transaction((rows: FlightRecord[]) => {
    for (const r of rows) {
      stmt.run({
        $icao24: r.icao24,
        $callsign: r.callsign,
        $latitude: r.latitude,
        $longitude: r.longitude,
        $altitude: r.altitude,
        $velocity: r.velocity,
        $heading: r.heading,
        $on_ground: r.on_ground,
        $ts: r.ts,
      });
    }
  });
  insertMany(records);
}

// Returns the latest position per aircraft within the last 5 minutes
export function queryLatest(): unknown[] {
  const db = getDb();
  const since = Math.floor(Date.now() / 1000) - 300;
  return db
    .query(
      `
      SELECT f.icao24, f.callsign, f.latitude, f.longitude,
             f.altitude, f.velocity, f.heading, f.on_ground, f.ts
      FROM flights f
      INNER JOIN (
        SELECT icao24, MAX(ts) AS max_ts
        FROM flights
        WHERE ts >= ?
        GROUP BY icao24
      ) latest ON f.icao24 = latest.icao24 AND f.ts = latest.max_ts
      WHERE f.ts >= ?
      ORDER BY f.icao24
    `
    )
    .all(since, since);
}

// Returns ordered rows for a specific aircraft and time range
export function queryHistory(
  icao24: string,
  from: number,
  to: number
): unknown[] {
  const db = getDb();
  return db
    .query(
      `
      SELECT icao24, callsign, latitude, longitude,
             altitude, velocity, heading, on_ground, ts
      FROM flights
      WHERE icao24 = ? AND ts >= ? AND ts <= ?
      ORDER BY ts ASC
    `
    )
    .all(icao24, from, to);
}

// Returns analytics aggregates for a time window
export function queryAnalytics(
  from: number,
  to: number
): {
  flightsPerHour: { hour: string; count: number }[];
  altitudeStatus: { status: string; count: number }[];
  topIcao: { icao24: string; sightings: number }[];
} {
  const db = getDb();

  // Flights per hour
  const flightsPerHour = db
    .query(
      `
      SELECT strftime('%Y-%m-%d %H:00', ts, 'unixepoch') AS hour,
             COUNT(DISTINCT icao24) AS count
      FROM flights
      WHERE ts >= ? AND ts <= ?
      GROUP BY hour
      ORDER BY hour ASC
    `
    )
    .all(from, to) as { hour: string; count: number }[];

  // Altitude status: compare consecutive rows per aircraft using LAG window function
  const altitudeStatusRaw = db
    .query(
      `
      WITH ranked AS (
        SELECT icao24, altitude, ts,
               LAG(altitude) OVER (PARTITION BY icao24 ORDER BY ts) AS prev_alt
        FROM flights
        WHERE ts >= ? AND ts <= ? AND altitude IS NOT NULL
      )
      SELECT
        CASE
          WHEN altitude > prev_alt THEN 'Ascending'
          WHEN altitude < prev_alt THEN 'Descending'
          ELSE 'Level'
        END AS status,
        COUNT(*) AS count
      FROM ranked
      WHERE prev_alt IS NOT NULL
      GROUP BY status
    `
    )
    .all(from, to) as { status: string; count: number }[];

  // Top 10 ICAO24 by sightings
  const topIcao = db
    .query(
      `
      SELECT icao24, COUNT(*) AS sightings
      FROM flights
      WHERE ts >= ? AND ts <= ?
      GROUP BY icao24
      ORDER BY sightings DESC
      LIMIT 10
    `
    )
    .all(from, to) as { icao24: string; sightings: number }[];

  return {
    flightsPerHour,
    altitudeStatus: altitudeStatusRaw,
    topIcao,
  };
}
