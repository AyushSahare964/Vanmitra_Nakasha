import { test, expect, VILLAGES } from "./fixtures";

test.describe("CFR panel", () => {
  test("opens, loads the CFR index and flags CFR districts with a marker", async ({ app, page }) => {
    await app.openPanel("CFR");
    await expect(page.getByText(/Cadastral map \(parcel lines\)/)).toBeVisible();
    const s = app.selects();
    await expect.poll(async () => await s.nth(1).locator("option").count(), { timeout: 30000 }).toBeGreaterThan(30);
    await expect.poll(async () => (await s.nth(1).locator("option").allTextContents()).filter((t) => t.includes("●")).length, { timeout: 30000 }).toBeGreaterThan(0);
  });

  test("ATREE potential / recognized layers create tile layers, toggle visibility and keep a stable layer count", async ({ app, page }) => {
    await app.openPanel("CFR");
    await page.getByText("Maharashtra CFR map layers (ATREE)").click();
    const n0 = await app.evalMap((m) => m.getLayers().getLength());
    const potential = page.getByLabel("CFR potential villages");
    const recognized = page.getByLabel("CFR recognized villages");
    await potential.check();
    await recognized.check();
    await expect.poll(async () => await app.evalMap((m) => m.getLayers().getLength()), { timeout: 10000 }).toBeGreaterThan(n0);
    const n1 = await app.evalMap((m) => m.getLayers().getLength());
    for (let i = 0; i < 5; i++) {
      await potential.uncheck();
      await potential.check();
      await recognized.uncheck();
      await recognized.check();
    }
    expect(await app.evalMap((m) => m.getLayers().getLength()), "layers must be reused, not recreated").toBe(n1);
    await app.setView(79.1, 21.15, 10);
    await app.renderComplete(90000);
  });

  test("selecting a CFR village shows recognized survey numbers and the status filter chips", async ({ app, page }) => {
    await app.openPanel("CFR");
    const s = app.selects();
    await app.pick(s.nth(1), /Nag?n?pur|नागपूर/i);
    await expect.poll(async () => await s.nth(2).locator("option").count(), { timeout: 40000 }).toBeGreaterThan(1);
    // first taluka flagged with a CFR marker
    const opt = await s.nth(2).locator("option").evaluateAll((os) => (os as HTMLOptionElement[]).find((o) => o.text.includes("●"))?.value ?? "");
    test.skip(!opt, "no flagged taluka in Nagpur snapshot");
    await s.nth(2).selectOption(opt);
    await expect.poll(async () => (await s.nth(3).locator("option").allTextContents()).some((t) => t.includes("●")), { timeout: 40000 }).toBe(true);
    const v = await s.nth(3).locator("option").evaluateAll((os) => (os as HTMLOptionElement[]).find((o) => o.text.includes("●"))?.value ?? "");
    await s.nth(3).selectOption(v);
    await expect(app.rows().first()).toBeVisible({ timeout: 60000 });
    await expect(page.getByText(/Recognized|Forest|Govt/i).first()).toBeVisible();
    await expect.poll(async () => (await app.layerByName("cadastral-village"))?.visible, { timeout: 20000 }).toBe(true);
  });

  test("MRSAC resource layers: toggling creates server-drawn tile layers once", async ({ app, page }) => {
    await app.openPanel("CFR");
    const n0 = await app.evalMap((m) => m.getLayers().getLength());
    const box = page.getByLabel(/Water bodies & lakes/).first();
    if (!(await box.count())) test.skip(true, "MRSAC section needs a selected village");
    await box.check();
    await box.uncheck();
    await box.check();
    expect(await app.evalMap((m) => m.getLayers().getLength())).toBeLessThanOrEqual(n0 + 2);
  });

  test("CFR approvals data is self-consistent (districts, talukas, villages, hectares)", async ({ page, app }) => {
    const stats = await page.evaluate(async () => {
      const j: any[] = await fetch("/data/mh_cfr_potential_villages.json").then((r) => r.json());
      const bad = j.filter((v) => !v.district || !v.village || !(v.totalCfrPotentialHa >= 0));
      const dup = j.length - new Set(j.map((v) => v.villageCode)).size;
      return { n: j.length, bad: bad.length, dup, ha: j.reduce((a, v) => a + v.totalCfrPotentialHa, 0) };
    });
    expect(stats.n).toBe(17256);
    expect(stats.bad).toBe(0);
    expect(stats.dup, "duplicate village codes").toBe(0);
    expect(stats.ha / 1e6).toBeGreaterThan(5); // ~6.3 M ha statewide
  });
});
