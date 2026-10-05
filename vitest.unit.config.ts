import { defineConfig } from "vitest/config";

// The unit checks (rules, names, store, pages) run in-process and need no
// running app, so they can run while the app is still being built:
//   pnpm test:unit
// `pnpm check` runs them too, through vitest.config.ts, which includes all of spec/.
export default defineConfig({
  test: { include: ["spec/unit/**/*.test.ts"] },
});
