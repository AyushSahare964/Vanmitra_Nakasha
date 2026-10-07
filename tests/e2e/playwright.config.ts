import { defineConfig } from "@playwright/test";

// Functional / resilience / responsive / stress suite. Run: npm run e2e   (always headed; PERF_HEADLESS=1 to hide)
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 150_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "../../perf-results/e2e-report.json" }]],
  outputDir: "../../test-results/e2e",
  use: {
    baseURL: process.env.PERF_BASE_URL || "http://localhost:8080",
    viewport: { width: 1440, height: 900 },
    headless: process.env.PERF_HEADLESS === "1",
    actionTimeout: 10_000,
    screenshot: "only-on-failure",
    launchOptions: { args: ["--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--disable-background-timer-throttling", "--enable-precise-memory-info"] },
  },
  webServer: process.env.PERF_BASE_URL
    ? undefined
    : { command: "npm run dev", url: "http://localhost:8080", reuseExistingServer: true, timeout: 120_000 },
});
