import { test, expect, type App } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Which coordinate frame is each dataset in? Measured, not assumed (see PERFORMANCE_ANALYSIS_REPORT.md follow-up):
 *   - BhuNaksha parcels, MRSAC census village boundaries and ATREE village polygons share ONE frame (the "raw" frame).
 *     The app moves parcels (and ATREE) by the calibration so they land on the satellite imagery.
 *   - MRSAC water bodies, rivers, wells and structures are in the imagery frame: never shifted.
 *   - MRSAC forest compartments are published in yet another frame (offset ~70 m west and 0-120 m north of the census
 *     boundaries, varying by region). No constant shift fixes that, so they are drawn exactly where MRSAC draws them.
 * These tests pin the first two facts so a future change cannot silently break them.
 */
const VILLAGE = `https://gsc.mrsac.org.in/webadpgis1/rest/services/admin/village_boundary/MapServer/0/query`;

const CASES = [
  { name: "Amnergondi (Nagpur, Katol)", mode: "CFR" as const, d: /नागपूर/, t: /काटोल/, v: /अमनेरगोंदी/ },
  { name: "Umrane (Nashik, Deola)", mode: "Cadastral" as const, d: /नाशिक/, t: /देवळा/, v: /उमराणे/ },
];

async function rawFrame(page: Page, rings: number[][][]) {
  return page.evaluate(async (rings) => {
    const map = (window as any).__vmMap;
    const cad = map.getLayers().getArray().find((l: any) => l.get("name") === "cadastral-village");
    const src = cad.getSource();
    const gis = src.getParams().gis_code as string;
    const grid = src.getTileGridForProjection(map.getView().getProjection());
    const z = Math.round(map.getView().getZoom());
    const c = grid.getTileCoordForCoordAndZ(map.getView().getCenter(), z);
    const bb = new URL(src.getTileUrlFunction()(c, 1, map.getView().getProjection())!, location.href).searchParams.get("BBOX")!.split(",").map(Number);
    const te = grid.getTileCoordExtent(c);
    const applied = [te[0]! - bb[0]!, te[1]! - bb[1]!];

    const R = 6378137;
    const proj = ([lo, la]: number[]) => [(lo! * Math.PI * R) / 180, Math.log(Math.tan(((90 + la!) * Math.PI) / 360)) * R] as number[];
    const poly = rings.map((r) => r.map(proj));
    let x0 = 1e12, y0 = 1e12, x1 = -1e12, y1 = -1e12;
    for (const r of poly) for (const [x, y] of r) (x0 = Math.min(x0, x!)), (y0 = Math.min(y0, y!)), (x1 = Math.max(x1, x!)), (y1 = Math.max(y1, y!));
    const pad = 150;
    const bx0 = x0 - pad, by0 = y0 - pad, bx1 = x1 + pad, by1 = y1 + pad;
    const res = Math.max(0.75, Math.max(bx1 - bx0, by1 - by0) / 2000);
    const W = Math.ceil((bx1 - bx0) / res), H = Math.ceil((by1 - by0) / res);
    const q = new URLSearchParams({ SERVICE: "WMS", VERSION: "1.1.1", REQUEST: "GetMap", LAYERS: "VILLAGE_MAP", STYLES: "VILLAGE_MAP", state: "27", gis_code: gis, TRANSPARENT: "true", FORMAT: "image/png", SRS: "EPSG:3857", WIDTH: String(W), HEIGHT: String(H), BBOX: [bx0, by0, bx1, by1].map((n) => n.toFixed(3)).join(",") });
    const bmp = await createImageBitmap(await (await fetch("/bhunaksha/WMS?" + q)).blob());
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d")!;
    ctx.drawImage(bmp, 0, 0, W, H);
    const px = ctx.getImageData(0, 0, W, H).data;
    const dt = new Float32Array(W * H).fill(1e9);
    for (let i = 0; i < W * H; i++) if (px[i * 4 + 3]! > 100 && px[i * 4]! < 110 && px[i * 4 + 1]! < 110 && px[i * 4 + 2]! < 110) dt[i] = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; let v = dt[i]!;
      if (x > 0) v = Math.min(v, dt[i - 1]! + 1);
      if (y > 0) { v = Math.min(v, dt[i - W]! + 1); if (x > 0) v = Math.min(v, dt[i - W - 1]! + 1.41); if (x < W - 1) v = Math.min(v, dt[i - W + 1]! + 1.41); }
      dt[i] = v;
    }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x; let v = dt[i]!;
      if (x < W - 1) v = Math.min(v, dt[i + 1]! + 1);
      if (y < H - 1) { v = Math.min(v, dt[i + W]! + 1); if (x < W - 1) v = Math.min(v, dt[i + W + 1]! + 1.41); if (x > 0) v = Math.min(v, dt[i + W - 1]! + 1.41); }
      dt[i] = v;
    }
    const pts: number[][] = [];
    for (const r of poly) for (let i = 1; i < r.length; i++) {
      const [ax, ay] = r[i - 1]!, [cx, cy] = r[i]!;
      const k = Math.max(1, Math.round(Math.hypot(cx! - ax!, cy! - ay!) / 6));
      for (let j = 0; j < k; j++) pts.push([ax! + ((cx! - ax!) * j) / k, ay! + ((cy! - ay!) * j) / k]);
    }
    const cost = (dx: number, dy: number) => {
      let s = 0;
      for (const [x, y] of pts) {
        const ix = Math.round((x! + dx - bx0) / res), iy = Math.round((by1 - (y! + dy)) / res);
        s += ix < 0 || iy < 0 || ix >= W || iy >= H ? 80 : Math.min(80, dt[iy * W + ix]!);
      }
      return (s / pts.length) * res;
    };
    let best = { dx: 0, dy: 0, c: cost(0, 0) };
    const raw = best.c;
    for (let dx = -150; dx <= 150; dx += 6) for (let dy = -150; dy <= 150; dy += 6) { const cc = cost(dx, dy); if (cc < best.c) best = { dx, dy, c: cc }; }
    const c0 = { ...best };
    for (let dx = c0.dx - 6; dx <= c0.dx + 6; dx += 1) for (let dy = c0.dy - 6; dy <= c0.dy + 6; dy += 1) { const cc = cost(dx, dy); if (cc < best.c) best = { dx, dy, c: cc }; }
    return { gis, applied, costRaw: raw, bestShift: [best.dx, best.dy], costBest: best.c };
  }, rings);
}

test.describe("coordinate frames", () => {
  for (const c of CASES) {
    test(`${c.name}: the portal's raw parcel lines coincide with MRSAC's census village boundary (shared frame)`, async ({ app, page }) => {
      test.setTimeout(300000);
      await app.openPanel(c.mode);
      const s = app.selects();
      await app.pick(s.nth(1), c.d);
      await app.pick(s.nth(2), c.t);
      await app.pick(s.nth(3), c.v);
      await expect.poll(async () => (await app.layerByName("cadastral-village"))?.visible, { timeout: 60000 }).toBe(true);
      await expect.poll(() => app.zoom(), { timeout: 30000 }).toBeGreaterThan(12);
      await page.waitForTimeout(2500);
      const ctr = await app.evalMap((m) => {
        const x = m.getView().getCenter();
        return [(x[0] * 180) / 20037508.34, (Math.atan(Math.exp((x[1] * Math.PI) / 20037508.34)) * 360) / Math.PI - 90];
      });
      const vil = await (await page.request.post(VILLAGE, { timeout: 90000, form: { f: "json", where: "1=1", geometry: `${ctr[0]},${ctr[1]}`, geometryType: "esriGeometryPoint", inSR: "4326", outSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "VIL_NAME", returnGeometry: "true", maxAllowableOffset: "0.00002" } })).json();
      expect(vil.features?.length, "MRSAC village under the map centre").toBeGreaterThan(0);
      const r = await rawFrame(page, vil.features[0].geometry.rings);
      console.log(`  ${c.name} [${vil.features[0].attributes.VIL_NAME}]`);
      console.log(`  raw portal lines vs MRSAC boundary: mean ${r.costRaw.toFixed(1)} m, best-fit shift E${r.bestShift[0]} N${r.bestShift[1]} m`);
      console.log(`  calibration the app applies to parcels: E${r.applied[0]!.toFixed(0)} N${r.applied[1]!.toFixed(0)} m (moves them onto the imagery, away from the census frame)`);
      expect(r.costRaw, "raw parcel lines must sit on the census village boundary").toBeLessThan(3);
      expect(Math.hypot(r.bestShift[0]!, r.bestShift[1]!), "census boundary and parcels share one frame").toBeLessThan(6);
    });
  }

  test("MRSAC vector overlays are drawn above the cadastral fill so wells and structures stay visible", async ({ app, page }) => {
    await app.openPanel("CFR");
    const s = app.selects();
    await app.pick(s.nth(1), /नाशिक/);
    await app.pick(s.nth(2), /देवळा/);
    await app.pick(s.nth(3), /उमराणे/);
    await expect(page.getByText(/wells, .* water-conservation structures/)).toBeVisible({ timeout: 90000 });
    const z = await app.evalMap((m) => {
      const L = m.getLayers().getArray();
      return { mrsac: L.find((l: any) => l.get("name") === "mrsac-vector")?.getZIndex(), cad: L.find((l: any) => l.get("name") === "cadastral-village")?.getZIndex(), plot: L.find((l: any) => l.get("name") === "plot-marker")?.getZIndex() };
    });
    expect(z.mrsac).toBeGreaterThan(z.cad);
    expect(z.mrsac).toBeLessThan(z.plot);
  });
});
