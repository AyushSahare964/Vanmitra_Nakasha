/**
 * Performance suite for the problems in PERFORMANCE_ANALYSIS_REPORT.md:
 * boot, village search, cadastral load, survey list + owner-record queue, filters/sort, zoom 14-20.
 * Every run appends its numbers to perf-results/history.json and prints the change vs the previous run,
 * so a fix can be checked "side by side" against the run before it.
 */
import { test, expect, type Page, type Locator } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(process.cwd(), "perf-results");
const LABEL = process.env.PERF_LABEL || "run";
const PORTAL_DELAY = Number(process.env.PERF_PORTAL_DELAY_MS || 0);
const RECORD_WAIT_MS = Number(process.env.PERF_RECORD_WAIT_S || 45) * 1000;

const metrics: Record<string, number | string> = {};
const rec = (k: string, v: number | string) => {
  metrics[k] = typeof v === "number" ? Math.round(v * 10) / 10 : v;
  console.log(`  ⏱ ${k}: ${metrics[k]}`);
};

// Budgets (ms unless noted). Soft: a miss is reported but the rest of the suite still runs.
const BUDGET = {
  boot_rendercomplete_ms: 8000,
  search_results_ms: 3000,
  village_boundary_ready_ms: 6000,
  survey_rows_visible_ms: 5000,
  cadastral_first_tile_ms: 4000,
  cadastral_rendercomplete_ms: 10000,
  wms_ttfb_p95_ms: 2000,
  filter_survey_ms: 350, // dev server (jsxDEV overhead); production React is faster
  filter_category_ms: 350,
  sort_ms: 350,
  max_long_task_ms: 250,
  portal_rest_max_inflight: 8,
  zoom_rendercomplete_ms: 8000,
};

// Budget misses are collected and asserted once in the last test: a failing test would otherwise skip the rest
// of the serial suite and kill the shared page.
const violations: string[] = [];
const budget = (name: keyof typeof BUDGET | string, value: number, limit: number, atMost = false) => {
  const bad = atMost ? value > limit : value >= limit;
  if (bad) violations.push(`${name}: ${Math.round(value)} (budget ${atMost ? "<=" : "<"} ${limit})`);
};

// ── request bookkeeping ────────────────────────────────────────────────────────
type Req = { url: string; start: number; end?: number; ttfb?: number; bytes?: number; failed?: boolean };
let reqs: Req[] = [];
let inflightRest = 0;
let maxInflightRest = 0;
let inflightInfo = 0;
let maxInflightInfo = 0;
const isInfo = (u: string) => u.includes("/MapInfo/getPlotInfo");
const isRest = (u: string) => u.includes("/bhunaksha/rest/");
const isWms = (u: string) => u.includes("/bhunaksha/WMS");

function watch(page: Page) {
  page.on("request", (r) => {
    const url = r.url();
    reqs.push({ url, start: Date.now() });
    if (isRest(url)) maxInflightRest = Math.max(maxInflightRest, ++inflightRest);
    if (isInfo(url)) maxInflightInfo = Math.max(maxInflightInfo, ++inflightInfo);
  });
  const done = async (r: any, failed: boolean) => {
    const url = r.url();
    const q = [...reqs].reverse().find((x) => x.url === url && x.end === undefined);
    if (q) {
      q.end = Date.now();
      q.failed = failed;
      if (!failed) {
        const t = r.timing();
        q.ttfb = t.responseStart > 0 ? t.responseStart - Math.max(0, t.requestStart) : undefined;
        try {
          q.bytes = (await r.sizes()).responseBodySize;
        } catch {
          // size unavailable for this response
        }
      }
    }
    if (isRest(url)) inflightRest = Math.max(0, inflightRest - 1);
    if (isInfo(url)) inflightInfo = Math.max(0, inflightInfo - 1);
  };
  page.on("requestfinished", (r) => void done(r, false));
  page.on("requestfailed", (r) => void done(r, true));
}

// ── page helpers ───────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]! : 0);

/** ms until OpenLayers reports every visible tile loaded and the frame drawn. */
async function renderComplete(page: Page, timeout = 60000): Promise<number> {
  const t0 = Date.now();
  await page.evaluate(
    (to) =>
      new Promise<void>((resolve, reject) => {
        const m = (window as any).__vmMap;
        if (!m) return reject(new Error("window.__vmMap missing: run against the dev server"));
        const timer = setTimeout(() => reject(new Error("rendercomplete timeout")), to);
        m.once("rendercomplete", () => {
          clearTimeout(timer);
          resolve();
        });
        m.render();
      }),
    timeout
  );
  return Date.now() - t0;
}

async function setView(page: Page, lon: number, lat: number, zoom: number) {
  await page.evaluate(
    ([lo, la, z]) => {
      const m = (window as any).__vmMap;
      const R = 6378137;
      const x = (lo! * Math.PI * R) / 180;
      const y = Math.log(Math.tan(((90 + la!) * Math.PI) / 360)) * R;
      m.getView().setCenter([x, y]);
      m.getView().setZoom(z);
    },
    [lon, lat, zoom] as const
  );
}

async function pickByText(select: Locator, re: RegExp, timeout = 60000) {
  await expect
    .poll(async () => (await select.locator("option").allTextContents()).some((t) => re.test(t)), { timeout, intervals: [200] })
    .toBe(true);
  const value = await select.evaluate(
    (el, src) => {
      const rx = new RegExp(src[0]!, src[1]);
      return [...(el as HTMLSelectElement).options].find((o) => rx.test(o.text))!.value;
    },
    [re.source, re.flags]
  );
  await select.selectOption(value);
}

/** Runs `action`, returns ms until `done` is true (polled every animation frame). */
async function timeIt(page: Page, action: () => Promise<unknown>, done: () => Promise<boolean>, timeout = 15000) {
  const t0 = Date.now();
  await action();
  while (!(await done())) {
    if (Date.now() - t0 > timeout) return timeout;
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
  }
  return Date.now() - t0;
}

const rows = (page: Page) => page.locator("li", { hasText: /^Survey / });
const rowText = async (page: Page) => ((await rows(page).count()) ? ((await rows(page).first().innerText()) || "").trim() : "");

// ── suite ──────────────────────────────────────────────────────────────────────
test.describe.serial("VANMITRA performance", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
    page = await ctx.newPage();
    await page.bringToFront();
    await page.addInitScript(() => {
      (window as any).__lt = [];
      (window as any).__info = { now: 0, max: 0, total: 0 };
      const of = window.fetch.bind(window);
      window.fetch = async (...a: Parameters<typeof fetch>) => {
        const u = String(a[0] instanceof Request ? a[0].url : a[0]);
        if (!u.includes("/MapInfo/getPlotInfo")) return of(...a);
        const c = (window as any).__info;
        c.max = Math.max(c.max, ++c.now);
        c.total++;
        try {
          const r = await of(...a);
          void r.clone().arrayBuffer().catch(() => {}).finally(() => c.now--);
          return r;
        } catch (e) {
          c.now--;
          throw e;
        }
      };
      try {
        new PerformanceObserver((l) => l.getEntries().forEach((e) => (window as any).__lt.push([e.startTime, e.duration]))).observe({ entryTypes: ["longtask"] });
      } catch {
        // longtask unsupported
      }
    });
    if (PORTAL_DELAY > 0) {
      await page.route("**/bhunaksha/**", async (route) => {
        await sleep(PORTAL_DELAY);
        await route.continue().catch(() => {});
      });
    }
    watch(page);
    page.on("pageerror", (e) => console.log("  ⚠ pageerror:", e.message.slice(0, 160)));
  });

  test.afterAll(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const hp = path.join(OUT, "history.json");
    const history: any[] = fs.existsSync(hp) ? JSON.parse(fs.readFileSync(hp, "utf8")) : [];
    const prev = history[history.length - 1];
    const entry = { label: LABEL, at: new Date().toISOString(), portalDelayMs: PORTAL_DELAY, metrics };
    history.push(entry);
    fs.writeFileSync(hp, JSON.stringify(history, null, 2));
    fs.writeFileSync(path.join(OUT, "latest.json"), JSON.stringify(entry, null, 2));

    const lines = Object.entries(metrics).map(([k, v]) => {
      const p = prev?.metrics?.[k];
      const d = typeof v === "number" && typeof p === "number" ? `${v - p >= 0 ? "+" : ""}${Math.round((v - p) * 10) / 10}` : "";
      return `${k.padEnd(34)} ${String(v).padStart(10)} ${String(p ?? "").padStart(10)} ${d.padStart(9)}`;
    });
    console.log(`\n== PERF SUMMARY [${LABEL}]  vs previous [${prev?.label ?? "none"}] ==`);
    console.log(`${"metric".padEnd(34)} ${"now".padStart(10)} ${"before".padStart(10)} ${"delta".padStart(9)}`);
    console.log(lines.join("\n"));
    await page.context().close();
  });

  test("1 boot: map ready", async () => {
    await page.bringToFront();
    const t0 = Date.now();
    await page.goto("/");
    await page.locator("canvas").first().waitFor({ timeout: 60000 });
    rec("boot_canvas_ms", Date.now() - t0);
    await renderComplete(page);
    rec("boot_rendercomplete_ms", Date.now() - t0);
    const boot = reqs.filter((r) => r.end);
    rec("boot_requests", boot.length);
    const kb = (f: (u: string) => boolean) => boot.filter((r) => f(r.url)).reduce((s, r) => s + (r.bytes || 0), 0) / 1024;
    rec("boot_data_kb", kb((u) => u.includes("/data/"))); // geojson etc. (real on prod)
    rec("boot_tiles_kb", kb((u) => /google\.com|arcgisonline|openstreetmap|bhunaksha/.test(u)));
    rec("boot_devjs_kb", kb((u) => /\.(tsx?|js|mjs|css)(\?|$)/.test(u) && !u.includes("/data/"))); // dev-server only: ignore for prod
    budget("boot_rendercomplete_ms", metrics.boot_rendercomplete_ms as number, BUDGET.boot_rendercomplete_ms);
  });

  test("2 village search: type, results, fly-to", async () => {
    await page.getByRole("button", { name: /^Search$/ }).first().click();
    const input = page.getByPlaceholder(/Search village name or code/);
    await input.waitFor();
    const t0 = Date.now();
    await input.fill("Mahalpatane");
    const hit = page.getByText(/Mahalpatane/i).first();
    await hit.waitFor({ timeout: 30000 });
    rec("search_results_ms", Date.now() - t0); // includes the one-time xlsx download + parse
    rec("search_max_long_task_ms", await page.evaluate(() => ((window as any).__lt as number[][]).reduce((m, x) => Math.max(m, x[1]!), 0)));

    const t1 = Date.now();
    const lt1 = await page.evaluate(() => ((window as any).__lt as number[][]).length);
    const districtFile = page.waitForResponse((r) => /\/data\/villages\/.+\.json/.test(r.url()), { timeout: 60000 }).catch(() => null);
    await hit.click();
    const resp = await districtFile;
    if (resp) {
      rec("district_geojson_kb", (await resp.body()).length / 1024);
      rec("district_geojson_ms", Date.now() - t1);
    }
    await expect
      .poll(() => page.evaluate(() => (window as any).__vmMap.getLayers().getArray().some((l: any) => l.get("name") === "village" && l.getSource().getFeatures().length > 0)), { timeout: 60000, intervals: [100] })
      .toBe(true);
    rec("village_boundary_ready_ms", Date.now() - t1);
    // the fly-to starts ~300 ms after the boundaries load, so wait for it to actually arrive at village scale
    await expect
      .poll(() => page.evaluate(() => { const v = (window as any).__vmMap.getView(); return v.getZoom() > 11 && !v.getAnimating(); }), { timeout: 20000, intervals: [100] })
      .toBe(true);
    rec("flyto_arrived_ms", Date.now() - t1);
    await renderComplete(page);
    rec("flyto_rendercomplete_ms", Date.now() - t1);
    const fl = await page.evaluate((from) => ((window as any).__lt as number[][]).slice(from), lt1);
    rec("flyto_blocking_ms", fl.reduce((s, x) => s + Math.max(0, x[1]! - 50), 0));
    rec("flyto_max_long_task_ms", fl.reduce((m, x) => Math.max(m, x[1]!), 0));
    budget("flyto_rendercomplete_ms", Date.now() - t1, 4000);
    rec("flyto_final_zoom", await page.evaluate(() => (window as any).__vmMap.getView().getZoom()));
    budget("search_results_ms", metrics.search_results_ms as number, BUDGET.search_results_ms);
    budget("village_boundary_ready_ms", metrics.village_boundary_ready_ms as number, BUDGET.village_boundary_ready_ms);
  });

  test("3 cadastral village: pick Umrane (Nashik > Deola), survey list + tiles", async () => {
    await page.getByRole("button", { name: /^Cadastral$/ }).first().click();
    const sel = page.locator("select");
    // order in the panel: category, district, taluka, village, map type, survey
    await pickByText(sel.nth(1), /Nas?h?ik|नाशिक/i);
    await pickByText(sel.nth(2), /Deola|देवळा/i);
    reqs = [];
    const t0 = Date.now();
    await pickByText(sel.nth(3), /Umrane|उमराणे/i);
    await rows(page).first().waitFor({ timeout: 90000 });
    rec("survey_rows_visible_ms", Date.now() - t0);
    // how long until the rows the user can see show real owner names (not "loading record…")
    const loadingVisible = () => page.evaluate(() => [...document.querySelectorAll("li")].filter((li) => /^Survey /.test(li.textContent || "")).slice(0, 5).filter((li) => /loading record/.test(li.textContent || "")).length);
    const tv = Date.now();
    while ((await loadingVisible()) > 0 && Date.now() - tv < 60000) await sleep(200);
    rec("visible_rows_loaded_ms", Date.now() - t0);
    budget("visible_rows_loaded_ms", Date.now() - t0, 10000);

    const kide = reqs.find((r) => r.url.includes("kidelistFromGisCodeMH") && r.end);
    if (kide) rec("kidelist_ms", kide.end! - kide.start);
    const wms = () => reqs.filter((r) => isWms(r.url) && r.end && !r.failed);
    await expect.poll(() => wms().length, { timeout: 60000, intervals: [100] }).toBeGreaterThan(0);
    rec("cadastral_first_tile_ms", wms().reduce((m, r) => Math.min(m, r.end!), Infinity) - t0);
    await renderComplete(page, 90000);
    rec("cadastral_rendercomplete_ms", Date.now() - t0);

    const tiles = wms();
    const ttfb = tiles.map((r) => r.ttfb ?? r.end! - r.start);
    rec("wms_tiles", tiles.length);
    rec("wms_failed", reqs.filter((r) => isWms(r.url) && r.failed).length);
    rec("wms_ttfb_p50_ms", pct(ttfb, 0.5));
    rec("wms_ttfb_p95_ms", pct(ttfb, 0.95));
    rec("wms_avg_kb", tiles.length ? tiles.reduce((s, r) => s + (r.bytes || 0), 0) / tiles.length / 1024 : 0);
    const w = reqs.find((r) => isWms(r.url))?.url.match(/WIDTH=(\d+)/i)?.[1];
    rec("wms_request_width_px", w ? Number(w) : 0); // 512 = not hi-dpi, 768 = hi-dpi at 1.5x
    budget("survey_rows_visible_ms", metrics.survey_rows_visible_ms as number, BUDGET.survey_rows_visible_ms);
    budget("cadastral_first_tile_ms", metrics.cadastral_first_tile_ms as number, BUDGET.cadastral_first_tile_ms);
    budget("cadastral_rendercomplete_ms", metrics.cadastral_rendercomplete_ms as number, BUDGET.cadastral_rendercomplete_ms);
    budget("wms_ttfb_p95_ms", metrics.wms_ttfb_p95_ms as number, BUDGET.wms_ttfb_p95_ms);
  });

  test("4 owner-record queue: progress, concurrency, main-thread blocking", async () => {
    const t0 = Date.now();
    const lt0 = await page.evaluate(() => ((window as any).__lt as number[][]).length);
    maxInflightRest = 0;
    await page.evaluate(() => Object.assign((window as any).__info, { max: (window as any).__info.now, total: 0 }));
    const prog = async () => {
      const m = (await page.locator("text=/Records \\d+ \\/ \\d+ loaded/").first().textContent({ timeout: 500 }).catch(() => null))?.match(/(\d+) \/ (\d+)/);
      return m ? [Number(m[1]), Number(m[2])] : null; // null = banner gone = everything loaded
    };
    let last: number[] | null = [0, 1];
    let doneAt = 0;
    const samples: string[] = [];
    while (Date.now() - t0 < RECORD_WAIT_MS) {
      last = await prog();
      if (!last) {
        doneAt = Date.now() - t0;
        break;
      }
      samples.push(`${Math.round((Date.now() - t0) / 1000)}s:${last[0]}/${last[1]}`);
      await sleep(1000);
    }
    rec("records_all_loaded_ms", doneAt || -1); // -1 = not finished inside PERF_RECORD_WAIT_S
    rec("records_loaded_at_cutoff", doneAt ? "all" : `${last?.[0]}/${last?.[1]}`);
    rec("portal_rest_max_inflight", maxInflightRest);
    const info = await page.evaluate(() => (window as any).__info as { max: number; total: number });
    maxInflightInfo = info.max;
    rec("plotinfo_max_inflight", info.max); // measured inside the page
    rec("plotinfo_calls", info.total);
    rec("plotinfo_failed", reqs.filter((r) => isInfo(r.url) && r.failed).length);
    const lts = await page.evaluate((from) => ((window as any).__lt as number[][]).slice(from), lt0);
    rec("blocking_total_ms", lts.reduce((s, x) => s + Math.max(0, x[1]! - 50), 0));
    rec("max_long_task_ms", lts.reduce((m, x) => Math.max(m, x[1]!), 0));
    console.log("  progress:", samples.filter((_, i) => i % 5 === 0).join("  "));
    budget("plotinfo_max_inflight", maxInflightInfo, BUDGET.portal_rest_max_inflight, true);
    budget("max_long_task_ms", metrics.max_long_task_ms as number, BUDGET.max_long_task_ms);
  });

  test("5 filters and sort (records may still be streaming)", async () => {
    await page.getByRole("button", { name: /^Explore$/ }).first().click();
    const search = page.getByLabel("Search parcels");
    await search.waitFor({ timeout: 30000 });
    await rows(page).first().waitFor();

    const first0 = await rowText(page);
    rec("filter_survey_ms", await timeIt(page, () => search.fill("10"), async () => /Survey 10\b/.test(await rowText(page))));
    rec("filter_clear_ms", await timeIt(page, () => search.fill(""), async () => (await rowText(page)) === first0));

    const tile = page.locator("button[aria-pressed]:not([disabled])").first();
    if (await tile.count()) {
      rec("filter_category_ms", await timeIt(page, () => tile.click(), async () => (await tile.getAttribute("aria-pressed")) === "true"));
      await tile.click();
    }

    for (const label of ["Area", "Owner", "Survey no."]) {
      const btn = page.getByRole("button", { name: new RegExp(`^${label.replace(".", "\\.")}`) }).first();
      if (!(await btn.count())) continue;
      const ms = await timeIt(page, () => btn.click(), async () => /[↑↓]/.test(await btn.innerText()));
      rec(`sort_${label.toLowerCase().replace(/\W+/g, "_")}_ms`, ms);
    }
    const sortMax = Math.max(0, ...Object.entries(metrics).filter(([k]) => k.startsWith("sort_")).map(([, v]) => Number(v)));
    budget("filter_survey_ms", metrics.filter_survey_ms as number, BUDGET.filter_survey_ms);
    budget("filter_category_ms", Number(metrics.filter_category_ms ?? 0), BUDGET.filter_category_ms);
    budget("sort_ms", sortMax, BUDGET.sort_ms);
  });

  test("6 zoom 14 to 20: render time, imagery limits, clarity inputs", async () => {
    const maxZ = await page.evaluate(() => (window as any).__vmMap.getView().getMaxZoom());
    rec("view_max_zoom", maxZ);
    budget("view_max_zoom", maxZ, 20, true);
    for (const z of [14, 16, 18, 19, 20]) {
      reqs = [];
      await setView(page, 74.343, 20.4178, z);
      const ms = await renderComplete(page, 90000);
      rec(`zoom_${z}_rendercomplete_ms`, ms);
      const esriPlaceholders = reqs.filter((r) => /arcgisonline/.test(r.url) && r.end && !r.failed && (r.bytes || 0) > 0 && (r.bytes || 0) < 3000).length;
      rec(`zoom_${z}_esri_placeholder_tiles`, esriPlaceholders); // ESRI's "no imagery" tile is ~2.5 KB
      budget(`zoom_${z}_rendercomplete_ms`, ms, BUDGET.zoom_rendercomplete_ms);
    }
  });

  test("7 budgets", async () => {
    console.log(violations.length ? ["", "  BUDGET MISSES:", ...violations.map((v) => "   - " + v)].join("\n") : "  all budgets met");
    rec("budget_misses", violations.length);
    expect(violations, "budget misses").toEqual([]);
  });
});
