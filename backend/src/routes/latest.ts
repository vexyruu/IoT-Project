import Elysia from "elysia";
import { queryLatest } from "../db";

export const latestRoute = new Elysia().get("/api/latest", () => {
  const rows = queryLatest();
  return { ok: true, count: rows.length, data: rows };
});
