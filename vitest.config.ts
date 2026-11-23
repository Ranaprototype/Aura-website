import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve("client/src"),
      "@shared": path.resolve("shared"),
    },
  },
  esbuild: { jsx: "automatic" },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    // Phase 2 suites drive a disposable PostgreSQL instance and a local SMTP
    // sink, so a single case can legitimately take a few seconds.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
