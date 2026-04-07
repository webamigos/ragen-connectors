import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov", "html"],
      reportsDirectory: "./coverage",
      include: [
        "packages/*/src/**/*.ts",
        "services/*/src/**/*.ts",
      ],
      exclude: [
        "**/__tests__/**",
        "**/dist/**",
        "**/index.ts",
        "**/instrument.ts",
        "**/otel-logger.ts",
      ],
    },
  },
});
