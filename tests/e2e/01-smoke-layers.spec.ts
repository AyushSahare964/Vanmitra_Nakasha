import { test, expect, type Panel } from "./fixtures";

test.describe("smoke: app shell and toolbar", () => {
  test("loads with header, map canvas and no uncaught errors", async ({ app, page }) => {
    await expect(page).toHaveTitle(/VANMITRA/);
    await expect(page.getByText("VANMITRA").first()).toBeVisible();
    await expect(page.locator("canvas").first()).toBeVisible();
    const box = await page.locator("canvas").first().boundingBox();
    expect(box!.width).toBeGreaterThan(600);
    expect(box!.height).toBeGreaterThan(400);
    expect(await app.zoom()).toBeCloseTo(7.2, 1);
  });

  for (const p of ["Layers", "Search", "Cadastral", "Explore", "CFR", "KML", "Legend"] as Panel[]) {
    test(`toolbar "${p}" opens its panel and a second click closes it`, async ({ app, page }) => {
      const btn = app.toolbar(p);
      // Layers is open by default on first load
      if (p === "Layers") await btn.click();
      await btn.click();
      await expect(page.locator("canvas").first()).toBeVisible();
      const before = await page.locator("body").innerText();
      await btn.click();
      await page.waitForTimeout(300);
      expect(await page.locator("body").innerText()).not.toBe(before);
    });
  }

  test("zoom in / zoom out / reset buttons drive the map", async ({ app, page }) => {
    const z0 = await app.zoom();
    await page.locator('button[title="Zoom In"]').click();
    await expect.poll(() => app.zoom(), { timeout: 5000 }).toBeCloseTo(z0 + 1, 0);
    await page.locator('button[title="Zoom Out"]').click();
    await page.locator('button[title="Zoom Out"]').click();
    await expect.poll(() => app.zoom(), { timeout: 5000 }).toBeLessThan(z0);
    await page.locator('button[title="Reset Maharashtra View"]').click();
    await expect.poll(() => app.zoom(), { timeout: 5000 }).toBeCloseTo(7.2, 0);
  });

  test("coordinate readout follows the mouse", async ({ app, page }) => {
    const box = (await page.locator("canvas").first().boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20);
    await expect(page.getByText(/\d{2}\.\d{4,5} \/ \d{2}\.\d{4,5}/).first()).toBeVisible();
  });

  test("Learn More / info toggle / officer login modal open and close", async ({ app, page }) => {
    await page.getByRole("button", { name: "Learn More" }).click();
    await expect(page.getByText(/Dynamic Cadastral WMS|About/i).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText(/Dynamic Cadastral WMS/i)).toHaveCount(0);
    await page.getByRole("button", { name: /Officer Login/ }).click();
    await expect(page.getByText(/Officer/i).nth(2)).toBeVisible();
  });
});

test.describe("layers: basemaps, administrative layers, opacity", () => {
  test("default view shows district + taluka vector layers", async ({ app }) => {
    await expect.poll(async () => (await app.layerByName("district"))?.features, { timeout: 20000 }).toBeGreaterThan(30);
    expect((await app.layerByName("district"))!.visible).toBe(true);
    // the taluka source is lazy: it loads only once the layer is visible (resolution < 750, i.e. zoom > ~7.5)
    await app.setView(76, 19.5, 9);
    await expect.poll(async () => (await app.layerByName("taluka"))?.features, { timeout: 20000 }).toBeGreaterThan(200);
  });

  test("each base map requests its own tile host", async ({ app, page }) => {
    // The Layers panel is open by default on first load; open the BASE MAPS accordion.
    const expected: [RegExp, RegExp][] = [
      [/Google Satellite \(Hybrid\)/, /google\.com\/vt\/lyrs=y/],
      [/^Google Satellite$/, /google\.com\/vt\/lyrs=s/],
      [/ESRI/, /arcgisonline\.com/],
      [/OpenStreetMap/, /tile\.openstreetmap\.org/],
    ];
    await page.getByRole("button", { name: /BASE MAPS/ }).click();
    for (const [label, host] of expected) {
      const hit = page.waitForRequest((r) => host.test(r.url()), { timeout: 20000 });
      await page.getByText(label).first().click();
      await app.setView(75 + Math.random() * 0.3, 19 + Math.random() * 0.3, 11); // new tiles, never cached
      await hit;
    }
    await app.renderComplete();
  });

  test("administrative layer checkboxes toggle visibility", async ({ app, page }) => {
    const boxes = page.locator("input[type=checkbox]");
    await expect.poll(() => boxes.count()).toBeGreaterThanOrEqual(3);
    const names = ["district", "taluka", "village"];
    for (let i = 0; i < 3; i++) {
      await boxes.nth(i).uncheck();
      expect((await app.layerByName(names[i]!))!.visible, `${names[i]} hidden`).toBe(false);
      await boxes.nth(i).check();
      expect((await app.layerByName(names[i]!))!.visible, `${names[i]} shown`).toBe(true);
    }
  });

  test("opacity sliders change layer opacity", async ({ app, page }) => {
    await page.locator('button[title="Adjust Opacity"]').first().click();
    const slider = page.locator("input[type=range]").first();
    await slider.fill("40");
    await expect.poll(async () => (await app.layerByName("district"))!.opacity).toBeCloseTo(0.4, 1);
  });

  test("zooming across the whole range 6 → 20 stays error-free and respects the max zoom", async ({ app }) => {
    expect(await app.evalMap((m) => m.getView().getMaxZoom())).toBeLessThanOrEqual(20);
    for (const z of [6, 9, 12, 15, 18, 20, 25]) {
      await app.setView(74.343, 20.4178, z);
      await app.renderComplete(90000);
    }
    expect(await app.zoom()).toBeLessThanOrEqual(20);
  });

  test("taluka layer hides at state zoom and returns at district zoom (maxResolution rule)", async ({ app }) => {
    const visibleAt = (z: number) =>
      app.evalMap((m, zz: number) => {
        m.getView().setZoom(zz);
        const l = m.getLayers().getArray().find((x: any) => x.get("name") === "taluka");
        return l.isVisible(m.getView());
      }, z);
    expect(await visibleAt(12)).toBe(true);
    expect(await visibleAt(6.5)).toBe(false);
  });
});
