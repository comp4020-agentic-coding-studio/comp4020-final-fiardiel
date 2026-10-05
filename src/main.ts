import { createServer } from "node:http";
import { join } from "node:path";
import { createHandler } from "./app.ts";
import { Store } from "./store.ts";

// Fly sets PORT; the volume is mounted at /data (the Dockerfile sets DATA_DIR).
const requestedPort = Number(process.env.PORT);
const port = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort < 65536 ? requestedPort : 8080;
const dataDir = process.env.DATA_DIR ?? "data";

const store = new Store(join(dataDir, "kitchen.db"));
const server = createServer(createHandler(store));
// A request that has not fully arrived after this long is dropped. This covers the
// time to receive the request, not the response, so long-lived responses are unaffected.
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.listen(port, "0.0.0.0", () => {
  console.log(`listening on 0.0.0.0:${port}, data in ${dataDir}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
}
