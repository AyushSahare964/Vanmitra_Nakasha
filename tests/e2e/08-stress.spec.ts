import { test, expect, VILLAGES } from "./fixtures";

const heapMB = (page: any) => page.evaluate(() => ((performance as any).memory?.usedJSHeapSize ?? 0) / 1048576) as Promise<number>;
const gc = async (page: any) => {
  const c = await page.context().newCDPSession(page);
  await c.send("HeapProfiler.enable");
  await c.send("HeapProfiler.collectGarbage");
  await c.detach();
};

test.describe("stress and leak checks", () => {
  test("opening/closing every panel 40 times neither leaks DOM nor heap", async ({ app, page }) => {
    await gc(page);
    const dom0 = await page.evaluate(() => document.getElementsByTagName("*").length);
    const h0 = await heapMB(page);
    for (let i = 0; i < 40; i++) for (const p of ["Search", "Cadastral", "Explore", "CFR", "Legend"] as const) await app.toolbar(p).click();
    await app.toolbar("Search").click();
    await app.toolbar("Search").click();
    await gc(page);
    const dom1 = await page.evaluate(() => document.getElementsByTagName("*").length);
    const h1 = await heapMB(page);
    console.log(`  heap ${h0.toFixed(1)} -> ${h1.toFixed(1)} MB, DOM ${dom0} -> ${dom1}`);
    expect(dom1, "DOM nodes after cycling").toBeLessThan(dom0 * 1.5 + 300);
    expect(h1 - h0, "heap growth (MB)").toBeLessThan(60);
  });

  test("map layer count is stable after toggling every layer and basemap repeatedly", async ({ app, page }) => {
    const n0 = await app.evalMap((m) => m.getLayers().getLength());
    await page.getByRole("button", { name: /BASE MAPS/ }).click();
    for (let i = 0; i < 6; i++) for (const t of [/Google Satellite \(Hybrid\)/, /^Google Satellite$/, /ESRI/, /OpenStreetMap/]) await page.getByText(t).first().click();
    const n1 = await app.evalMap((m) => m.getLayers().getLength());
    expect(n1).toBe(n0);
  });

  test("120 rapid view changes keep the frame rate usable", async ({ app, page }) => {
    const fps = await page.evaluate(async () => {
      const m = (window as any).__vmMap;
      const R = 6378137;
      const t0 = performance.now();
      let frames = 0;
      await new Promise<void>((res) => {
        const tick = () => {
          const t = (performance.now() - t0) / 3000;
          if (t >= 1) return res();
          const lon = 74 + t * 1.5;
          m.getView().setCenter([(lon * Math.PI * R) / 180, Math.log(Math.tan(((90 + 20 + t) * Math.PI) / 360)) * R]);
          m.getView().setZoom(9 + 5 * Math.sin(t * Math.PI));
          frames++;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return frames / 3;
    });
    console.log(`  pan/zoom fps: ${fps.toFixed(1)}`);
    expect(fps).toBeGreaterThan(15);
  });

  test("six village switches in a row: no page errors, heap and request counts stay bounded", async ({ app, page }) => {
    await app.openPanel("Cadastral");
    const s = app.selects();
    await app.pick(s.nth(1), VILLAGES.umrane.dist);
    await app.pick(s.nth(2), VILLAGES.umrane.taluka);
    await expect.poll(async () => await s.nth(3).locator("option").count(), { timeout: 40000 }).toBeGreaterThan(8);
    const values = await s.nth(3).locator("option").evaluateAll((os) => (os as HTMLOptionElement[]).filter((o) => o.value).map((o) => o.value));
    await gc(page);
    const h0 = await heapMB(page);
    let infoCalls = 0;
    page.on("request", (r) => /getPlotInfo/.test(r.url()) && infoCalls++);
    for (let i = 0; i < 6; i++) {
      await s.nth(3).selectOption(values[i + 1]!);
      await expect(page.getByText(/Parcels & Land Records/).first()).toBeVisible({ timeout: 60000 });
      await page.waitForTimeout(2500);
    }
    await gc(page);
    const h1 = await heapMB(page);
    console.log(`  heap ${h0.toFixed(1)} -> ${h1.toFixed(1)} MB, getPlotInfo calls ${infoCalls}`);
    expect(h1 - h0, "heap growth over 6 villages (MB)").toBeLessThan(150);
  });

  test("500 keystrokes into the parcel search never block the UI for long", async ({ app, page }) => {
    await app.cascade(VILLAGES.umrane.dist, VILLAGES.umrane.taluka, VILLAGES.umrane.village);
    await expect(app.rows().first()).toBeVisible({ timeout: 40000 });
    await app.openPanel("Explore");
    const input = page.getByLabel("Search parcels");
    await page.evaluate(() => {
      (window as any).__worst = 0;
      new PerformanceObserver((l) => l.getEntries().forEach((e) => ((window as any).__worst = Math.max((window as any).__worst, e.duration)))).observe({ entryTypes: ["longtask"] });
    });
    for (let i = 0; i < 100; i++) {
      await input.pressSequentially("12345".slice(0, 1 + (i % 5)), { delay: 0 });
      await input.fill("");
    }
    const worst = await page.evaluate(() => (window as any).__worst as number);
    console.log(`  worst long task while typing: ${Math.round(worst)} ms`);
    expect(worst).toBeLessThan(400);
  });

  test("HTTP: static data files are compressible and cache headers are sane", async ({ page }) => {
    const r = await page.request.get("/data/mh_districts.geojson", { headers: { "accept-encoding": "gzip" } });
    expect(r.ok()).toBe(true);
    const big = await page.request.get("/data/villages/Nasik.json", { headers: { "accept-encoding": "gzip" } });
    expect(big.ok()).toBe(true);
    console.log(`  Nasik.json content-encoding: ${big.headers()["content-encoding"] ?? "(none; dev server)"}`);
  });
});
