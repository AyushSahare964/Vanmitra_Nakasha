import { test, expect, VILLAGES } from "./fixtures";

test.describe("cadastral: village selection", () => {
  test("selecting a village loads extent, WMS layer, survey list and fits the view", async ({ app, page }) => {
    const wms: string[] = [];
    page.on("request", (r) => /\/bhunaksha\/WMS/.test(r.url()) && wms.push(r.url()));

    await app.cascade(VILLAGES.umrane.dist, VILLAGES.umrane.taluka, VILLAGES.umrane.village);
    await expect(app.rows().first()).toBeVisible({ timeout: 30000 });
    await expect.poll(() => app.zoom(), { timeout: 15000 }).toBeGreaterThan(13);
    expect(await app.zoom()).toBeLessThanOrEqual(18);

    const cad = await app.layerByName("cadastral-village");
    expect(cad?.visible).toBe(true);
    await expect.poll(() => wms.length, { timeout: 30000 }).toBeGreaterThan(2);
    expect(wms[0]).toMatch(/gis_code=RVM20/);
    expect(wms[0]).toMatch(/LAYERS=VILLAGE_MAP/);
  });

  test("survey list length equals the portal's list and numbers are unique", async ({ app, page }) => {
    const kide = page.waitForResponse((r) => r.url().includes("kidelistFromGisCodeMH"), { timeout: 60000 });
    await app.cascade(VILLAGES.umrane.dist, VILLAGES.umrane.taluka, VILLAGES.umrane.village);
    const list: string[] = await (await kide).json();
    expect(list.length).toBeGreaterThan(500);
    expect(new Set(list).size, "duplicate survey numbers from the portal").toBe(list.length);
    await expect(page.getByText(new RegExp(`Parcels & Land Records \\(${list.length}\\)`))).toBeVisible({ timeout: 30000 });
    const selectOptions = await app.selects().nth(5).locator("option").count();
    expect(selectOptions - 1).toBe(list.length);
  });

  test("picking a survey number opens Plot Info with owner data and draws the plot marker", async ({ app, page }) => {
    await app.cascade(VILLAGES.umrane.dist, VILLAGES.umrane.taluka, VILLAGES.umrane.village);
    await expect(app.rows().first()).toBeVisible({ timeout: 30000 });
    await app.pick(app.selects().nth(5), /^10$/);
    await expect(page.getByText("Plot Info").first()).toBeVisible({ timeout: 30000 });
    await expect.poll(async () => (await app.layerByName("plot-marker"))?.features, { timeout: 30000 }).toBeGreaterThan(0);
    await expect(page.getByText("Map Report").first()).toBeVisible();
  });

  test("clicking a result row selects the same survey", async ({ app, page }) => {
    await app.cascade(VILLAGES.umrane.dist, VILLAGES.umrane.taluka, VILLAGES.umrane.village);
    await expect(app.rows().first()).toBeVisible({ timeout: 30000 });
    const first = (await app.rowNumbers(1))[0]!;
    await app.rows().first().getByRole("button").first().click();
    await expect(page.getByText(new RegExp(`Survey No\\.? ?${first}\\b`)).first()).toBeVisible({ timeout: 30000 });
  });

  test("switching villages replaces the list (no stale rows, no mixed records)", async ({ app, page }) => {
    await app.cascade(VILLAGES.umrane.dist, VILLAGES.umrane.taluka, VILLAGES.umrane.village);
    await expect(app.rows().first()).toBeVisible({ timeout: 30000 });
    const header = page.getByText(/Parcels & Land Records \(\d+\)/).first();
    const countA = await header.innerText();
    await app.pick(app.selects().nth(3), /^(?!.*(Umrane|उमराणे)).+/);
    await expect.poll(async () => await header.innerText().catch(() => countA), { timeout: 40000 }).not.toBe(countA);
    const nums = await app.rowNumbers(30);
    expect(new Set(nums).size, "duplicate rows after switching").toBe(nums.length);
    await expect.poll(() => app.zoom(), { timeout: 15000 }).toBeGreaterThan(12);
  });

  test("second visit after a reload takes village lists and extent from cache, not the portal", async ({ app, page }) => {
    await app.cascade(VILLAGES.umrane.dist, VILLAGES.umrane.taluka, VILLAGES.umrane.village);
    await expect(app.rows().first()).toBeVisible({ timeout: 30000 });
    await page.reload();
    await app.mapReady();
    const calls: string[] = [];
    page.on("request", (r) => /kidelistFromGisCodeMH|getVVVVExtentGeoref|ListsAfterLevelGeoref/.test(r.url()) && calls.push(r.url()));
    await app.cascade(VILLAGES.umrane.dist, VILLAGES.umrane.taluka, VILLAGES.umrane.village);
    await expect(app.rows().first()).toBeVisible({ timeout: 30000 });
    expect(calls, "village lists/extent must come from localStorage").toEqual([]);
  });

  test("Vidarbha village (Nagpur) lands at the correct longitude, not 6° west", async ({ app }) => {
    const s = app.selects();
    await app.openPanel("Cadastral");
    await app.pick(s.nth(1), VILLAGES.nagpurRural.dist);
    await expect.poll(async () => await s.nth(2).locator("option").count(), { timeout: 40000 }).toBeGreaterThan(1);
    await s.nth(2).selectOption({ index: 1 });
    await expect.poll(async () => await s.nth(3).locator("option").count(), { timeout: 40000 }).toBeGreaterThan(1);
    await s.nth(3).selectOption({ index: 1 });
    await expect.poll(async () => (await app.layerByName("cadastral-village"))?.visible, { timeout: 40000 }).toBe(true);
    await expect.poll(() => app.zoom(), { timeout: 30000 }).toBeGreaterThan(12);
    const lon = await app.evalMap((m) => {
      const c = m.getView().getCenter();
      return (c[0] * 180) / (Math.PI * 6378137);
    });
    expect(lon, "Nagpur region must be ~78-80E (portal stores it 6 deg west)").toBeGreaterThan(77);
    expect(lon).toBeLessThan(81);
  });

  test("identify mode: clicking the map starts a parcel lookup", async ({ app, page }) => {
    await app.setView(74.343, 20.4178, 15);
    await app.openPanel("Cadastral");
    await page.getByRole("button", { name: /Click to Activate Identify Land/ }).click();
    await expect(page.getByText(/Identify Mode Active/).first()).toBeVisible();
    const box = (await page.locator("canvas").first().boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5);
    await expect(page.getByText(/Identifying land parcel|✅|⚠/).first()).toBeVisible({ timeout: 15000 });
  });
});

test.describe("cadastral: cascade integrity", () => {
  test("dependent selects are disabled until their parent is chosen", async ({ app }) => {
    await app.openPanel("Cadastral");
    const s = app.selects();
    await expect(s.nth(2)).toBeDisabled();
    await expect(s.nth(3)).toBeDisabled();
    await app.pick(s.nth(1), VILLAGES.umrane.dist);
    await expect(s.nth(2)).toBeEnabled();
    await expect(s.nth(3)).toBeDisabled();
  });

  test("every district in the snapshot produces a non-empty taluka list", async ({ app, page }) => {
    await app.openPanel("Cadastral");
    const s = app.selects();
    await expect.poll(async () => await s.nth(1).locator("option").count(), { timeout: 30000 }).toBeGreaterThan(30);
    const values = await s.nth(1).locator("option").evaluateAll((os) => (os as HTMLOptionElement[]).filter((o) => o.value).map((o) => [o.value, o.text]));
    const empty: string[] = [];
    for (const [v, t] of values.slice(0, 36)) {
      await s.nth(1).selectOption(v!);
      // the taluka list loads asynchronously from the snapshot file: wait for it instead of a fixed pause
      const filled = await expect.poll(async () => await s.nth(2).locator("option").count(), { timeout: 8000, intervals: [100] }).toBeGreaterThan(1).then(() => true, () => false);
      if (!filled) empty.push(t!);
    }
    expect(empty, "districts whose taluka list is empty").toEqual([]);
  });
});
