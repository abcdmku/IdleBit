import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-electron",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "line",
  timeout: 45_000,
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
