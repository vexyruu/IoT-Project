import { Database } from "bun:sqlite";
const db = new Database("/data/flights.db");
db.run("DELETE FROM flights");
db.run("VACUUM");
const row = db.query("SELECT COUNT(*) as n FROM flights").get() as { n: number };
console.log("Rows remaining:", row.n);
db.close();
