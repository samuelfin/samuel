import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    // Each database test file starts its own in-process PostgreSQL and applies
    // every migration to it. That cost grows with each migration added, and
    // running one worker per core made the 60s setup allowance marginal: a file
    // would time out on a loaded machine while passing in 11 seconds alone.
    // Capping the workers trades a little wall time for a suite that does not
    // fail for reasons unrelated to the code.
    maxWorkers: 4,
  },
});
