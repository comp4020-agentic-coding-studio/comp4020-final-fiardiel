import { createServer } from "node:http";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { createHandler } from "./app.ts";
import { Hub } from "./live.ts";
import { ScanLimit, claudeReader } from "./receipt.ts";
import { Store } from "./store.ts";

// Fly sets PORT; the volume is mounted at /data (the Dockerfile sets DATA_DIR).
const requestedPort = Number(process.env.PORT);
const port = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort < 65536 ? requestedPort : 8080;
const dataDir = process.env.DATA_DIR ?? "data";

// A fresh file for PINs: the Crit 8 and 9 data in kitchen.db is left as it was.
const store = new Store(join(dataDir, "serumah.db"));
const hub = new Hub();

// Reading receipts costs money, so it is off unless both are set (as Fly secrets):
// ANTHROPIC_API_KEY, and RECEIPT_HOUSES, the house codes allowed, comma-separated.
// RECEIPT_DAILY is how many each house may read a day (10 if unset).
const receiptHouses = new Set((process.env.RECEIPT_HOUSES ?? "").split(",").map((c) => c.trim().toUpperCase()).filter((c) => c !== ""));
const perDay = Number(process.env.RECEIPT_DAILY ?? "10");
const receipts =
  process.env.ANTHROPIC_API_KEY && receiptHouses.size > 0
    ? {
        houses: receiptHouses,
        limit: new ScanLimit(Number.isInteger(perDay) && perDay > 0 ? perDay : 10),
        read: claudeReader(new Anthropic({ timeout: 60_000, maxRetries: 1 })),
      }
    : null;
console.log(receipts === null ? "reading receipts is off" : `reading receipts is on for ${receiptHouses.size} house(s)`);

const server = createServer({ connectionsCheckingInterval: 2000 }, createHandler(store, hub, receipts));
// A request that has not fully arrived after this long is dropped. This covers the
// time to receive the request, not the response, so long-lived responses are unaffected.
// Node checks for stalled requests every 2 seconds, so one is dropped after about 15 s.
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.listen(port, "0.0.0.0", () => {
  console.log(`listening on 0.0.0.0:${port}, data in ${dataDir}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    hub.closeAll();
    server.close(() => {
      store.close();
      // No process.exit: stdout to a pipe is written later, so exiting here
      // would drop the last log lines (the streams' disconnects).
      process.exitCode = 0;
    });
  });
}
