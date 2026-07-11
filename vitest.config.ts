import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    exclude: [
      ...configDefaults.exclude,
      "**/.claude/**",
      "**/dist-electron/**",
      "**/e2e/**",
      "**/e2e-electron/**",
      "**/playwright-report/**",
      "**/test-results/**",
    ],
    globals: true,
    // Balance calibration exercises the real public campaign runner and can
    // legitimately exceed Vitest's five-second per-test default.
    testTimeout: 10_000,
  },
});
