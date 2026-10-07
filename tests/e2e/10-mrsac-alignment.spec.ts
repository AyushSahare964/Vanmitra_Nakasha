import { test, expect, VILLAGES } from "./fixtures";

/**
 * MRSAC overlays must sit exactly where MRSAC's own geoportal draws them. The parcel/cadastral calibration
 * shifts BhuNaksha data onto the imagery; MRSAC is already georeferenced, so it must never receive that shift.
 * Truth = the same query made straight against MRSAC (no app code in between).
 */
const GSC = "https://gsc.mrsac.org.in";
const WATER = `${GSC}/server/rest/services/smart_village/sv_water_cons/MapServer`;
const VILLAGE = `${GSC}/webadpgis1/rest/services/admin/village_boundary/MapServer/0/query`;

const metersPerDeg = (lat: number) => ({ x: 111320 * Math.cos((lat * Math.PI) / 180), y: 110574 });

async function openCfrVillage(app: any, page: any) {
  await app.openPanel("CFR");
  const s = app.selects();
  await app.pick(s.nth(1), VILLAGES.umrane.dist);
  await app.pick(s.nth(2), VILLAGES.umrane.taluka);
  await app.pick(s.nth(3), VILLAGES.umrane.village);
  await expect(page.getByText(/wells, .* water-conservation structures/)).toBeVisible({ timeout: 60000 });
}

/** Tick a layer in the "In this village" list so its features are drawn on the map. */
async function showVillageLayer(page: any, label: RegExp) {
  const cb = page.locator("text=In this village").locator("xpath=..").locator("label", { hasText: label }).locator("input").first();
  await cb.waitFor({ timeout: 20000 });
  await cb.check();
}

test.describe("MRSAC alignment with the real geoportal", () => {
  test("village features drawn by the app coincide with MRSAC's own coordinates (< 3 m)", async ({ app, page }) => {
    await openCfrVillage(app, page);
    await showVillageLayer(page, /Water bodies/);
    await expect.poll(async () => (await app.layerByName("mrsac-vector"))?.features ?? 0, { timeout: 30000 }).toBeGreaterThan(0);

    // what the app drew (EPSG:3857 -> lon/lat), per layer
    const drawn = await app.evalMap((m) => {
      const l = m.getLayers().getArray().find((x: any) => x.get("name") === "mrsac-vector");
      const out: Record<string, number[][]> = {};
      for (const f of l.getSource().getFeatures()) {
        const g = f.getGeometry();
        const flat = g.getFlatCoordinates ? g.getFlatCoordinates() : [];
        const k = f.get("layerKey");
        (out[k] ||= []).push(...Array.from({ length: Math.min(flat.length / g.getStride(), 400) }, (_, i) => [flat[i * g.getStride()], flat[i * g.getStride() + 1]]));
      }
      return out;
    });
    const toLonLat = (x: number, y: number) => [(x * 180) / 20037508.34, (Math.atan(Math.exp((y * Math.PI) / 20037508.34)) * 360) / Math.PI - 90];

    // ground truth straight from MRSAC for the village the app drew: query the polygon under the centroid of the
    // drawn features (the viewport centre can fall in a neighbouring village while the map is still fitting)
    const mine = (drawn["waterbody"] || []).map(([x, y]) => toLonLat(x!, y!));
    expect(mine.length).toBeGreaterThan(5);
    const lon0 = mine.reduce((a, p) => a + p[0]!, 0) / mine.length;
    const lat0 = mine.reduce((a, p) => a + p[1]!, 0) / mine.length;
    const vil = await (await page.request.post(VILLAGE, { form: { f: "json", where: "1=1", geometry: `${lon0},${lat0}`, geometryType: "esriGeometryPoint", inSR: "4326", outSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "VIL_NAME", returnGeometry: "true", maxAllowableOffset: "0.00005" } })).json();
    expect(vil.features?.length).toBeGreaterThan(0);
    const wb = await (await page.request.post(`${WATER}/8/query`, { form: { f: "geojson", where: "1=1", geometry: JSON.stringify({ rings: vil.features[0].geometry.rings, spatialReference: { wkid: 4326 } }), geometryType: "esriGeometryPolygon", inSR: "4326", outSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "WB_NAME", returnGeometry: "true", maxAllowableOffset: "0.00002" } })).json();
    const truth: number[][] = [];
    for (const f of wb.features) {
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) for (const ring of poly) truth.push(...ring);
    }
    expect(truth.length).toBeGreaterThan(5);

    // median nearest-vertex distance from every drawn vertex to MRSAC's vertices, in meters
    const k = metersPerDeg(lat0!);
    const dists = mine.map(([lo, la]) => Math.min(...truth.map(([tx, ty]) => Math.hypot((lo! - tx!) * k.x, (la! - ty!) * k.y))));
    dists.sort((a, b) => a - b);
    const median = dists[Math.floor(dists.length / 2)]!;
    // signed offset of the centroid shows the direction
    const cm = (a: number[][]) => [a.reduce((s, p) => s + p[0]!, 0) / a.length, a.reduce((s, p) => s + p[1]!, 0) / a.length];
    const [dx, dy] = [(cm(mine)[0]! - cm(truth)[0]!) * k.x, (cm(mine)[1]! - cm(truth)[1]!) * k.y];
    console.log(`  water-body overlay vs MRSAC: median vertex distance ${median.toFixed(1)} m, centroid offset east ${dx.toFixed(1)} m / north ${dy.toFixed(1)} m`);
    expect(median, "overlay is offset from MRSAC's real position").toBeLessThan(3);
  });

  test("server-drawn MRSAC tiles are requested for the true tile extent (no calibration shift)", async ({ app, page }) => {
    await openCfrVillage(app, page);
    const exports: string[] = [];
    page.on("request", (r) => /mrsac.*\/export\?/.test(r.url()) && exports.push(r.url()));
    const box = page.locator("text=Map layers — all Maharashtra").locator("xpath=following::label[contains(., 'Water bodies')][1]//input");
    await box.check();
    await app.setView(74.343, 20.4178, 14);
    await expect.poll(() => exports.length, { timeout: 30000 }).toBeGreaterThan(0);

    const worst = await app.evalMap(
      (m, urls: string[]) => {
        const layer = m.getLayers().getArray().find((x: any) => x.get("name") === "mrsac-tile-waterbody");
        const grid = layer.getSource().getTileGridForProjection(m.getView().getProjection());
        let worstShift = 0;
        for (const u of urls) {
          const q = new URL(u).searchParams;
          const [x0, y0, x1, y1] = q.get("bbox")!.split(",").map(Number) as [number, number, number, number];
          const res = (x1 - x0) / Number(q.get("size")!.split(",")[0]);
          const z = grid.getZForResolution(res);
          const c = grid.getTileCoordForCoordAndZ([(x0 + x1) / 2, (y0 + y1) / 2], z);
          const e = grid.getTileCoordExtent(c);
          worstShift = Math.max(worstShift, Math.abs(x0 - e[0]), Math.abs(y0 - e[1]));
        }
        return worstShift;
      },
      exports
    );
    console.log(`  worst MRSAC tile BBOX shift vs tile grid: ${worst.toFixed(2)} m`);
    expect(worst, "MRSAC tile requests carry a calibration shift").toBeLessThan(0.05);
  });

  test("changing the cadastral calibration does not move MRSAC overlays", async ({ app, page }) => {
    await openCfrVillage(app, page);
    await showVillageLayer(page, /Water bodies/);
    await expect.poll(async () => (await app.layerByName("mrsac-vector"))?.features ?? 0, { timeout: 30000 }).toBeGreaterThan(0);
    const firstXY = () =>
      app.evalMap((m) => {
        const l = m.getLayers().getArray().find((x: any) => x.get("name") === "mrsac-vector");
        return l.getSource().getFeatures()[0].getGeometry().getFlatCoordinates().slice(0, 2) as number[];
      });
    const a = await firstXY();
    // the calibration controls live in the Cadastral panel; jump through the app's own seeds by switching village
    await app.openPanel("Cadastral");
    await app.pick(app.selects().nth(3), /कनकापुर|Kankapur/);
    await app.openPanel("CFR");
    await app.pick(app.selects().nth(3), VILLAGES.umrane.village);
    await expect(page.getByText(/wells, .* water-conservation structures/)).toBeVisible({ timeout: 60000 });
    await expect.poll(async () => (await app.layerByName("mrsac-vector"))?.features ?? 0, { timeout: 30000 }).toBeGreaterThan(0);
    const b = await firstXY();
    expect(Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!)).toBeLessThan(0.5);
  });
});

test.describe("MRSAC reliability", () => {
  test("two transient MRSAC query errors are retried and the village panel still fills in", async ({ app, page }) => {
    let failed = 0;
    await page.route(/gsc\.mrsac\.org\.in.*\/query/, (r) => {
      if (failed < 2) {
        failed++;
        return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ error: { code: 400, message: "Error performing query operation", details: [] } }) });
      }
      return r.continue();
    });
    await openCfrVillage(app, page);
    expect(failed, "the injected errors were hit").toBe(2);
    await expect(page.getByText("Error performing query operation")).toHaveCount(0);
  });

  test("a persistent MRSAC failure shows a clear message with a Retry button (not a raw server string)", async ({ app, page }) => {
    await page.route(/gsc\.mrsac\.org\.in.*\/query/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ error: { code: 400, message: "Error performing query operation" } }) }));
    await app.openPanel("CFR");
    const s = app.selects();
    await app.pick(s.nth(1), VILLAGES.umrane.dist);
    await app.pick(s.nth(2), VILLAGES.umrane.taluka);
    await app.pick(s.nth(3), VILLAGES.umrane.village);
    await expect(page.getByText(/MRSAC.*(not respond|unavailable|try again)/i).first()).toBeVisible({ timeout: 60000 });
    await expect(page.getByRole("button", { name: /Retry/ }).first()).toBeVisible();
  });
});
