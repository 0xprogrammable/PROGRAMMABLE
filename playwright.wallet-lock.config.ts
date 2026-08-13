import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "wallet-request-lock.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    browserName: "chromium",
    channel: process.env.CI ? undefined : "chrome",
    headless: true,
    trace: "retain-on-failure",
  },
});
