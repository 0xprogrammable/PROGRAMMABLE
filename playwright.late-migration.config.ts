import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser", testMatch: "late-migration.spec.ts", fullyParallel: false,
  workers: 1, retries: 0, reporter: "line", outputDir: "output/playwright/late-migration",
  use: { browserName: "chromium", channel: process.env.CI ? undefined : "chrome", headless: true, trace: "retain-on-failure" },
});
