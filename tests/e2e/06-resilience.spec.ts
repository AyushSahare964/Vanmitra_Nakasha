import { test, expect, VILLAGES } from "./fixtures";

/** The portal is slow, drops connections and sometimes answers garbage. The app must degrade visibly, never freeze or throw. */
const KIDE = /kidelistFromGisCodeMH/;
const INFO = /MapInfo\/getPlotInfo/;
const WMS = /\/bhunaksha\/WMS/;

test.describe("resilience: portal failures", () => {
  test("survey list 500 shows an error message (no endless spinner) and recovers on Retry", async ({ app, page }) => {
    let fail = true;
    await page.route(KIDE, (r) => (fail ? r.fulfill({ status: 500, body: "boom" }) : r.continue()));
    await app.cascade(VILLAGES.umrane.dist, VILLAGES.umrane.taluka, VILLAGES.umrane.village);
    await expect(page.getByText(/Could not load this village|not responding|HTTP 500|failed|no (survey no\.|map type|\w+) options/i).first()).toBeVisible({ timeout: 40000 });
    await expect(page.getByText("Loading parcels…")).toHaveCount(0);
    fail = false;
    await page.getByRole("button", { name: /Retry/ }).first().click();
    await expect(app.rows().first()).toBeVisible({ timeout: 40000 });
  });

  test("connection resets on every REST call: error is shown and the map stays usable", async ({ app, page }) => {
    await page.route(/\/bhunaksha\/rest\//, (r) => r.abort("connectionreset"));
    await app.cascade(VILLAGES.umrane.dist, VILLAGES.umrane.taluka, VILLAGES.umrane.village);
    await expect(page.getByText(/Could not|not responding|failed|no (survey no\.|map type|\w+) options/i).first()).toBeVisible({ timeout: 40000 });
    await app.setView(75, 19.5, 11);
    await app.renderComplete();
    expect(await app.zoom()).toBeCloseTo(11, 0);
  });

  test("malformed and empty survey-list responses do not crash the page", async ({ app, page }) => {
    let n = 0;
    await page.route(KIDE, (r) => (++n % 2 ? r.fulfill({ status: 200, contentType: "application/json", body: "{not json" }) : r.fulfill({ status: 200, contentType: "application/json", body: "[]" })));
    await app.cascade(VILLAGES.umrane.dist, VILLAGES.umrane.taluka, VILLAGES.umrane.village);
    await page.waitForTimeout(4000);
    await expect(page.locator("canvas").first()).toBeVisible();
  });

  test("25% of getPlotInfo calls fail: records still arrive, nothing throws", async ({ app, page }) => {
    let i = 0;
    await page.route(INFO, (r) => (++i % 4 === 0 ? r.abort("connectionreset") : r.continue()));
    await app.cascade(VILLAGES.umrane.dist, VILLAGES.umrane.taluka, VILLAGES.umrane.village);
    await expect(app.rows().first()).toBeVisible({ timeout: 40000 });
    await expect.poll(async () => (await app.recordsBanner())?.done ?? 0, { timeout: 60000 }).toBeGreaterThan(30);
  });

  test("getPlotInfo returning 204 / empty marks parcels 'no record' instead of spinning forever", async ({ app, page }) => {
    await page.route(INFO, (r) => r.fulfill({ status: 204, body: "" }));
    await app.cascade(VILLAGES.umrane.dist, VILLAGES.umrane.taluka, VILLAGES.umrane.village);
    await expect(app.rows().first()).toBeVisible({ timeout: 40000 });
    await expect(app.rows().first()).toContainText(/no record/i, { timeout: 40000 });
  });

  test("cadastral WMS tiles failing (502) keeps the map interactive", async ({ app, page }) => {
    await page.route(WMS, (r) => r.fulfill({ status: 502, body: "bad gateway" }));
    await app.cascade(VILLAGES.umrane.dist, VILLAGES.umrane.taluka, VILLAGES.umrane.village);
    await expect(app.rows().first()).toBeVisible({ timeout: 40000 });
    await app.setView(74.343, 20.4178, 17);
    await app.renderComplete(60000);
    await app.setView(74.35, 20.42, 18);
    await app.renderComplete(60000);
  });

  test("slow portal (3 s per call): list appears, panels stay responsive while loading", async ({ app, page }) => {
    await page.route(/\/bhunaksha\/rest\//, async (r) => {
      await new Promise((res) => setTimeout(res, 3000));
      await r.continue().catch(() => {});
    });
    await app.cascade(VILLAGES.umrane.dist, VILLAGES.umrane.taluka, VILLAGES.umrane.village);
    const t0 = Date.now();
    await app.openPanel("Legend");
    await app.openPanel("Layers");
    expect(Date.now() - t0, "toolbar must stay instant while the portal is slow").toBeLessThan(2500);
    await app.openPanel("Cadastral");
    await expect(page.getByText(/Parcels & Land Records/).first()).toBeVisible({ timeout: 60000 });
  });

  test("going offline after a village is loaded: local features (search, sort, panels) keep working", async ({ app, page, context }) => {
    await app.cascade(VILLAGES.umrane.dist, VILLAGES.umrane.taluka, VILLAGES.umrane.village);
    await expect(app.rows().first()).toBeVisible({ timeout: 40000 });
    await app.openPanel("Explore");
    await context.setOffline(true);
    await page.getByLabel("Search parcels").fill("10");
    await expect.poll(async () => (await app.rowNumbers(1))[0]).toBe("10");
    await page.getByRole("button", { name: /^Survey no\./ }).click();
    await app.openPanel("Legend");
    await context.setOffline(false);
  });

  test("unreachable third-party basemap does not break the cadastral overlay", async ({ app, page }) => {
    await page.route(/google\.com\/vt|arcgisonline/, (r) => r.abort("failed"));
    await app.cascade(VILLAGES.umrane.dist, VILLAGES.umrane.taluka, VILLAGES.umrane.village);
    await expect(app.rows().first()).toBeVisible({ timeout: 40000 });
    expect((await app.layerByName("cadastral-village"))?.visible).toBe(true);
  });
});

test.describe("races", () => {
  test("rapid A → B → C village switching ends on C with C's data only", async ({ app, page }) => {
    await app.openPanel("Cadastral");
    const s = app.selects();
    await app.pick(s.nth(1), VILLAGES.umrane.dist);
    await app.pick(s.nth(2), VILLAGES.umrane.taluka);
    await expect.poll(async () => await s.nth(3).locator("option").count(), { timeout: 40000 }).toBeGreaterThan(5);
    const values = await s.nth(3).locator("option").evaluateAll((os) => (os as HTMLOptionElement[]).filter((o) => o.value).map((o) => o.value));
    const [a, b, c] = [values[0]!, values[1]!, values[2]!];
    const gisOf = (v: string) => v.length;
    void gisOf;
    await s.nth(3).selectOption(a);
    await s.nth(3).selectOption(b);
    await s.nth(3).selectOption(c);
    await expect(app.rows().first()).toBeVisible({ timeout: 60000 });
    // settle: every in-flight response from A and B has had time to arrive
    await page.waitForTimeout(6000);
    const gis = await app.evalMap((m) => {
      const l = m.getLayers().getArray().find((x: any) => x.get("name") === "cadastral-village");
      return l.getSource().getParams().gis_code as string;
    });
    expect(gis, "cadastral layer must point at the last village").toContain(c);
    await expect(s.nth(3)).toHaveValue(c);
  });

  test("closing the panel / reset while records stream does not throw", async ({ app, page }) => {
    await app.cascade(VILLAGES.umrane.dist, VILLAGES.umrane.taluka, VILLAGES.umrane.village);
    await expect(app.rows().first()).toBeVisible({ timeout: 40000 });
    await page.locator('button[title="Reset Maharashtra View"]').click();
    await app.openPanel("Cadastral");
    await app.openPanel("Cadastral");
    await page.waitForTimeout(3000);
  });
});
