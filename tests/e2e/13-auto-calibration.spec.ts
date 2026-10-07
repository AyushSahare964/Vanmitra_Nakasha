import { test, expect, type App } from "./fixtures";
import type { Page, BrowserContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { googleFitSummed } from "./helpers/register";
import { measure } from "./helpers/polygon-vs-lines";

/**
 * Cadastral parcels must sit on the satellite imagery. The app fits each village to ESRI imagery at runtime;
 * these tests verify the result against an INDEPENDENT measurement: Google imagery, fetched by the test runner and
 * registered with separate code. "residual" = what the parcels would still need to move to sit on the imagery.
 */
const SHOTS = path.resolve(process.cwd(), "perf-results/screens");
const KHANGAON = { dist: "09", taluka: "03", village: "270900030101320000", gis: "RVM0903270900030101320000" };
const gisOf = (d: string, t: string, v: string) => `RVM${d}${t}${v}`;

/** Calibration actually applied to the cadastral tiles: tile-grid extent minus requested BBOX. */
async function applied(app: App): Promise<[number, number]> {
  return app.evalMap((m) => {
    const src = m.getLayers().getArray().find((l: any) => l.get("name") === "cadastral-village").getSource();
    const proj = m.getView().getProjection();
    const grid = src.getTileGridForProjection(proj);
    const c = grid.getTileCoordForCoordAndZ(m.getView().getCenter(), Math.max(0, Math.min(grid.getMaxZoom(), Math.round(m.getView().getZoom()))));
    const bb = new URL(src.getTileUrlFunction()(c, 1, proj)!, location.href).searchParams.get("BBOX")!.split(",").map(Number);
    const te = grid.getTileCoordExtent(c);
    return [te[0] - bb[0]!, te[1] - bb[1]!] as [number, number];
  });
}

async function villageCentre(app: App): Promise<[number, number]> {
  return app.evalMap((m) => {
    const c = m.getView().getCenter();
    return [(c[0] * 180) / 20037508.34, (Math.atan(Math.exp((c[1] * Math.PI) / 20037508.34)) * 360) / Math.PI - 90] as [number, number];
  });
}

async function googleFit(page: Page, ctx: BrowserContext, gis: string, lon: number, lat: number) {
  return googleFitSummed(page, ctx, gis, lon, lat);
}

async function openVillage(app: App, d: string, t: string, v: string) {
  await app.openPanel("Cadastral");
  const s = app.selects();
  await expect.poll(async () => (await s.nth(1).locator(`option[value="${d}"]`).count()), { timeout: 30000 }).toBeGreaterThan(0);
  await s.nth(1).selectOption(d);
  await expect.poll(async () => (await s.nth(2).locator(`option[value="${t}"]`).count()), { timeout: 40000 }).toBeGreaterThan(0);
  await s.nth(2).selectOption(t);
  await expect.poll(async () => (await s.nth(3).locator(`option[value="${v}"]`).count()), { timeout: 40000 }).toBeGreaterThan(0);
  await s.nth(3).selectOption(v);
  await expect.poll(() => app.zoom(), { timeout: 40000 }).toBeGreaterThan(8);
}

const status = (page: Page) => page.getByTestId("calib-status");

test.describe("auto-calibration against satellite imagery", () => {
  test("Khangaon (Nagpur, Kalameshwar): parcels move onto the imagery, verified with Google tiles", async ({ app, page, context }) => {
    test.setTimeout(300000);
    await openVillage(app, KHANGAON.dist, KHANGAON.taluka, KHANGAON.village);
    await expect(status(page)).toContainText(/Aligned to satellite imagery/, { timeout: 120000 });
    const after = await applied(app);
    const [lon, lat] = await villageCentre(app);
    const g = await googleFit(page, context, KHANGAON.gis, lon, lat);
    expect(g.err, "Google registration needs parcel lines in the window").toBeUndefined();
    const seed = [-15, -86];
    console.log(`  Khangaon: seed estimate E${seed[0]} N${seed[1]} | applied now E${after[0].toFixed(1)} N${after[1].toFixed(1)} | independent Google fit E${g.east.toFixed(1)} N${g.north.toFixed(1)} (psr ${g.psr.toFixed(1)})`);
    const residual = Math.hypot(after[0] - g.east, after[1] - g.north);
    const seedResidual = Math.hypot(seed[0]! - g.east, seed[1]! - g.north);
    console.log(`  residual to imagery: before ${seedResidual.toFixed(1)} m -> after ${residual.toFixed(1)} m`);
    expect(residual, "parcels still off the imagery (m)").toBeLessThanOrEqual(6);
    expect(residual).toBeLessThan(seedResidual);
    fs.mkdirSync(SHOTS, { recursive: true });
    await app.setView(78.94023, 21.30784, 17.6);
    await app.renderComplete(90000);
    await page.screenshot({ path: path.join(SHOTS, "khangaon-aligned.png") });
  });

  test("the same view with imagery fitting unavailable shows the old regional estimate (visual before/after)", async ({ app, page }) => {
    test.setTimeout(300000);
    await page.route(/server\.arcgisonline\.com/, (r) => r.abort("failed"));
    await openVillage(app, KHANGAON.dist, KHANGAON.taluka, KHANGAON.village);
    await expect(status(page)).toContainText(/estimated from regional anchors/, { timeout: 120000 });
    await app.setView(78.94023, 21.30784, 17.6);
    await app.renderComplete(90000);
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, "khangaon-seed-estimate.png") });
  });

  // Strong cases: the independent summed Google fit and the ESRI fit agree and are far above the noise.
  const FITTABLE = [
    { n: "Amboli (Nagpur)", d: "09", t: "01", v: "270900010098460000" },
    { n: "Khapa (Nagpur)", d: "09", t: "08", v: "270900080107110000" },
    { n: "Dahigaon (Akola)", d: "05", t: "01", v: "270500010046570000" },
  ];
  // Borderline: right at the acceptance threshold. Either the fit is accepted and then must agree, or it safely falls back.
  const BORDERLINE = [
    { n: "Ubarkhed (Akola)", d: "05", t: "01", v: "270500010046620000" },
    { n: "Garkhede (Nashik)", d: "20", t: "15", v: "272000150264160000" },
  ];
  // ... and villages where the providers disagree by 20-160 m: a false lock here would move parcels the wrong way.
  const UNRELIABLE = [
    { n: "Kondhali (Nagpur)", d: "09", t: "02", v: "270900020100530000" },
    { n: "Kasbe Wani (Nashik)", d: "20", t: "08", v: "272000080255370000" },
    { n: "Jastgaon (Akola)", d: "05", t: "01", v: "270500010046440000" },
  ];
  for (const s of FITTABLE) {
    test(`${s.n}: the fitted calibration agrees with the independent Google measurement`, async ({ app, page, context }) => {
      test.setTimeout(300000);
      await openVillage(app, s.d, s.t, s.v);
      await expect(status(page)).toContainText(/Aligned to satellite imagery|estimated from regional anchors/, { timeout: 150000 });
      const text = (await status(page).innerText()).trim();
      const [lon, lat] = await villageCentre(app);
      const a = await applied(app);
      const g = await googleFit(page, context, gisOf(s.d, s.t, s.v), lon, lat);
      const res = g.err ? NaN : Math.hypot(a[0] - g.east, a[1] - g.north);
      const seedRes = g.err ? NaN : Math.hypot(-13 - g.east, -85 - g.north);
      console.log(`  ${s.n}: ${/Aligned/.test(text) ? "FITTED" : "SEED  "} applied E${a[0].toFixed(1)} N${a[1].toFixed(1)} | Google fit E${g.east?.toFixed(1)} N${g.north?.toFixed(1)} (psr ${g.psr?.toFixed(1)}) | residual ${res.toFixed(1)} m (regional estimate would be ${seedRes.toFixed(1)} m) | ${text.replace(/\s+/g, " ").slice(0, 90)}`);
      expect(text, "a village with a clear imagery fit must be fitted").toMatch(/Aligned to satellite imagery/);
      // 14 m: the independent windows are centred on the map view, a little away from the app's village-centre windows, so two
      // fits of the same village differ by ~10 m; the regional estimate being replaced is 30-95 m off.
      expect(res, "fitted calibration disagrees with the independent measurement (m)").toBeLessThanOrEqual(14);
    });
  }
  for (const s of BORDERLINE) {
    test(`${s.n}: borderline imagery -> accepted only if it agrees with the independent measurement`, async ({ app, page, context }) => {
      test.setTimeout(300000);
      await openVillage(app, s.d, s.t, s.v);
      await expect(status(page)).toContainText(/Aligned to satellite imagery|estimated from regional anchors/, { timeout: 150000 });
      const text = (await status(page).innerText()).trim();
      console.log(`  ${s.n}: ${text.slice(0, 100)}`);
      if (/Aligned/.test(text)) {
        const [lon, lat] = await villageCentre(app);
        const a = await applied(app);
        const g = await googleFit(page, context, gisOf(s.d, s.t, s.v), lon, lat);
        if (!g.err) expect(Math.hypot(a[0] - g.east, a[1] - g.north)).toBeLessThanOrEqual(8);
      }
    });
  }
  for (const s of UNRELIABLE) {
    test(`${s.n}: ambiguous imagery -> no false lock, the regional estimate stays`, async ({ app, page }) => {
      test.setTimeout(300000);
      await openVillage(app, s.d, s.t, s.v);
      await expect(status(page)).toContainText(/Aligned to satellite imagery|estimated from regional anchors/, { timeout: 150000 });
      const text = (await status(page).innerText()).trim();
      console.log(`  ${s.n}: ${text.slice(0, 100)}`);
      expect(text).toMatch(/estimated from regional anchors/);
    });
  }
  test("the fitted result is cached: a second visit applies it without fetching imagery", async ({ app, page }) => {
    test.setTimeout(300000);
    await openVillage(app, KHANGAON.dist, KHANGAON.taluka, KHANGAON.village);
    await expect(status(page)).toContainText(/Aligned to satellite imagery/, { timeout: 120000 });
    const first = await applied(app);
    await page.reload();
    await app.mapReady();
    let esri = 0;
    page.on("request", (r) => /server\.arcgisonline\.com/.test(r.url()) && !/\/basemap/.test(r.url()) && esri++);
    await page.getByRole("button", { name: /^Layers$/ }).first().click().catch(() => {});
    await openVillage(app, KHANGAON.dist, KHANGAON.taluka, KHANGAON.village);
    await expect(status(page)).toContainText(/Aligned to satellite imagery/, { timeout: 15000 });
    const second = await applied(app);
    expect(Math.hypot(first[0] - second[0], first[1] - second[1])).toBeLessThan(0.5);
    expect(esri, "imagery tiles requested again for a cached village").toBe(0);
  });

  test("a failing imagery provider falls back to the regional estimate; the map keeps working", async ({ app, page }) => {
    await page.route(/server\.arcgisonline\.com/, (r) => r.fulfill({ status: 500, body: "x" }));
    await openVillage(app, KHANGAON.dist, KHANGAON.taluka, KHANGAON.village);
    await expect(status(page)).toContainText(/estimated from regional anchors/, { timeout: 120000 });
    await expect(app.rows().first()).toBeVisible({ timeout: 60000 });
    expect((await app.layerByName("cadastral-village"))?.visible).toBe(true);
  });

  test("highlighted parcel polygons stay on the portal's parcel lines after the calibration changes mid-session", async ({ app, page }) => {
    test.setTimeout(300000);
    await app.openPanel("CFR");
    const s = app.selects();
    await expect.poll(async () => await s.nth(1).locator('option[value="09"]').count(), { timeout: 30000 }).toBeGreaterThan(0);
    await s.nth(1).selectOption("09");
    await expect.poll(async () => await s.nth(2).locator('option[value="03"]').count(), { timeout: 40000 }).toBeGreaterThan(0);
    await s.nth(2).selectOption("03");
    await expect.poll(async () => await s.nth(3).locator(`option[value="${KHANGAON.village}"]`).count(), { timeout: 40000 }).toBeGreaterThan(0);
    await s.nth(3).selectOption(KHANGAON.village);
    await expect(status(page)).toContainText(/Aligned to satellite imagery/, { timeout: 120000 }).catch(() => {});
    await expect.poll(async () => (await app.layerByName("plot-marker"))?.features ?? 0, { timeout: 120000 }).toBeGreaterThan(1);
    await page.waitForTimeout(2500);
    const r = await measure(page);
    for (const p of r.results) console.log(`  plot ${String(p.plot).padEnd(6)} mean edge->line ${p.meanEdgeToLineM.toFixed(1)} m | best-fit shift E${p.bestShiftEast} N${p.bestShiftNorth}`);
    const worst = Math.max(...r.results.map((p: any) => Math.hypot(p.bestShiftEast, p.bestShiftNorth)));
    expect(worst).toBeLessThanOrEqual(2);
  });
});
