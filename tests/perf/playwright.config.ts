import { defineConfig } from "@playwright/test";

// Perf suite: run `npm run perf`. Optional env:
//   PERF_LABEL=before-fix      tag this run in perf-results/history.json
//   PERF_PORTAL_DELAY_MS=1500  add latency to every /bhunaksha call (simulates the slow daytime portal / far region)
//   PERF_RECORD_WAIT_S=45      how long to watch the owner-record queue fill
//   PERF_BASE_URL=...          test another server (the window.__vmMap hook only exists on the dev server)
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 300_000,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PERF_BASE_URL || "http://localhost:8080",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1.5, // typical Windows laptop scaling; exercises the hidpi cadastral path
    trace: "off",
    headless: process.env.PERF_HEADLESS === "1", // headed by default so the run can be watched
    // A covered or unfocused headed window gets its rAF/timers throttled, which inflates every number.
    launchOptions: { args: ["--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--disable-background-timer-throttling"] },
  },
  webServer: process.env.PERF_BASE_URL
    ? undefined
    : { command: "npm run dev", url: "http://localhost:8080", reuseExistingServer: true, timeout: 120_000 },
});
