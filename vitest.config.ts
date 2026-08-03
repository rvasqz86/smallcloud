import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    // Many integration files drive docker concurrently; parallel files cause
    // container start/poll timeouts under load. Serial keeps the suite honest.
    fileParallelism: false,
  },
});
