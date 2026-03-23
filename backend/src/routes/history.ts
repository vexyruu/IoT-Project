import Elysia, { t } from "elysia";
import { queryHistory } from "../db";

export const historyRoute = new Elysia().get(
  "/api/history",
  ({ query, error }) => {
    const { icao24, from, to } = query;

    if (!icao24) return error(400, { ok: false, message: "icao24 is required" });

    const now = Math.floor(Date.now() / 1000);
    const fromTs = from ? Number(from) : now - 86_400; // default last 24h
    const toTs = to ? Number(to) : now;

    if (isNaN(fromTs) || isNaN(toTs))
      return error(400, { ok: false, message: "from and to must be Unix timestamps" });

    const rows = queryHistory(icao24, fromTs, toTs);
    return { ok: true, count: rows.length, data: rows };
  },
  {
    query: t.Object({
      icao24: t.Optional(t.String()),
      from: t.Optional(t.String()),
      to: t.Optional(t.String()),
    }),
  }
);
