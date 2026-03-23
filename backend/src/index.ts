import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { latestRoute } from "./routes/latest";
import { historyRoute } from "./routes/history";
import { analyticsRoute } from "./routes/analytics";
import { startCollector } from "./collector";

const PORT = Number(process.env.PORT) || 3000;

const app = new Elysia()
  .use(cors())
  .use(latestRoute)
  .use(historyRoute)
  .use(analyticsRoute)
  .get("/", () => ({
    service: "Perak Aircraft Monitor API",
    endpoints: ["/api/latest", "/api/history", "/api/analytics"],
  }))
  .listen(PORT);

console.log(`[server] Listening on http://localhost:${PORT}`);

// Start the data collection loop
startCollector();
