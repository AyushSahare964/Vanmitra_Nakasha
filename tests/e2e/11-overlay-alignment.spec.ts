import { test, expect, type App } from "./fixtures";
import type { Page } from "@playwright/test";
import { measure } from "./helpers/polygon-vs-lines";

/**
 * Overlay-to-overlay alignment, measured in metres.
 *   1. Highlighted parcel polygons (drawn from getPlotInfo geometry) vs the portal's OWN rendered parcel lines
 *      for the same area: both must sit on the same boundaries.
 *   2. The cadastral WMS tiles and the single-plot WMS layer must carry the same calibration shift.
 *   3. MRSAC overlays vs MRSAC truth live in 10-mrsac-alignment.spec.ts.
 * The measurement runs in the page: it fetches the portal's tile for the polygon's bbox, builds a distance
 * transform of the dark line pixels and searches the (dx, dy) shift that best lays the polygon edges on them.
 */
const NAGPUR = { dist: /नागपूर/, taluka: /काटोल/, village: /अमनेरगोंदी/ };

async function openRecognizedVillage(app: App, page: Page, v = NAGPUR) {
  await app.openPanel("CFR");
  const s = app.selects();
  await app.pick(s.nth(1), v.dist);
  await app.pick(s.nth(2), v.taluka);
  await app.pick(s.nth(3), v.village);
  // recognized parcels are painted automatically once their geometry arrives
  await expect.poll(async () => (await app.layerByName("plot-marker"))?.features ?? 0, { timeout: 120000 }).toBeGreaterThan(2);
  await page.waitForTimeout(1500);
}

test.describe("overlay alignment (metres)", () => {
  test("highlighted CFR parcel polygons lie on the portal's own parcel lines", async ({ app, page }) => {
    test.setTimeout(240000);
    await openRecognizedVillage(app, page);
    const r = await measure(page);
    console.log(`  gis ${r.gis}  WMS calibration applied: east ${r.calib[0]} m, north ${r.calib[1]} m`);
    for (const p of r.results) console.log(`  plot ${String(p.plot).padEnd(8)} mean edge->line ${p.meanEdgeToLineM.toFixed(1)} m | best-fit shift E ${p.bestShiftEast} N ${p.bestShiftNorth} m -> ${p.meanAfterShiftM.toFixed(1)} m`);
    expect(r.results.length).toBeGreaterThan(0);
    const worst = Math.max(...r.results.map((p: any) => Math.hypot(p.bestShiftEast, p.bestShiftNorth)));
    const mean = r.results.reduce((a: number, p: any) => a + p.meanEdgeToLineM, 0) / r.results.length;
    expect(mean, "mean distance from polygon edges to the portal's parcel lines (m)").toBeLessThan(1.5);
    expect(worst, "best-fit shift needed to lay a polygon on the portal's lines (m)").toBeLessThanOrEqual(2);
  });

  test("the same check on a Nashik village (different region, different calibration)", async ({ app, page }) => {
    test.setTimeout(240000);
    await app.openPanel("Cadastral");
    const s = app.selects();
    await app.pick(s.nth(1), /नाशिक/);
    await app.pick(s.nth(2), /देवळा/);
    await app.pick(s.nth(3), /उमराणे/);
    await expect(app.rows().first()).toBeVisible({ timeout: 60000 });
    await expect.poll(async () => (await app.recordsBanner())?.done ?? 99999, { timeout: 90000 }).toBeGreaterThan(30);
    await app.openPanel("Explore");
    await page.getByRole("button", { name: "Show on map" }).click();
    await expect.poll(async () => (await app.layerByName("plot-marker"))?.features ?? 0, { timeout: 90000 }).toBeGreaterThan(3);
    const r = await measure(page);
    for (const p of r.results) console.log(`  plot ${String(p.plot).padEnd(8)} mean ${p.meanEdgeToLineM.toFixed(1)} m | best-fit E ${p.bestShiftEast} N ${p.bestShiftNorth} m`);
    const worst = Math.max(...r.results.map((p: any) => Math.hypot(p.bestShiftEast, p.bestShiftNorth)));
    expect(worst).toBeLessThanOrEqual(2);
  });
});
