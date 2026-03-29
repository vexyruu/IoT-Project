import Elysia, { t } from "elysia";
import { queryAnalytics } from "../db";

export const analyticsRoute = new Elysia().get(
  "/api/analytics",
  ({ query, error }) => {
    const now = Math.floor(Date.now() / 1000);
    const fromTs = query.from ? Number(query.from) : now - 86_400; // default last 24h
    const toTs = query.to ? Number(query.to) : now;

    if (isNaN(fromTs) || isNaN(toTs))
      return error(400, { ok: false, message: "from and to must be Unix timestamps" });

    const result = queryAnalytics(fromTs, toTs);
    return { ok: true, ...result };
  },
  {
    query: t.Object({
      from: t.Optional(t.String()),
      to: t.Optional(t.String()),
    }),
  }
);
