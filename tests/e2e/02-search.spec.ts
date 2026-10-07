import { test, expect } from "./fixtures";

test.describe("village search panel", () => {
  test.beforeEach(async ({ app }) => {
    await app.openPanel("Search");
  });

  test("finds a village by name, flies to it and highlights its boundary", async ({ app, page }) => {
    await page.getByPlaceholder(/Search village name or code/).fill("Mahalpatane");
    await page.getByText(/Mahalpatane/i).first().click();
    await expect.poll(() => app.zoom(), { timeout: 20000 }).toBeGreaterThan(12);
    await expect.poll(async () => (await app.layerByName("village"))?.features, { timeout: 20000 }).toBeGreaterThan(100);
  });

  test("results are case-insensitive and need at least 2 characters", async ({ app, page }) => {
    const input = page.getByPlaceholder(/Search village name or code/);
    await input.fill("m");
    await expect(page.getByText(/Mahalpatane/i)).toHaveCount(0);
    await input.fill("MAHALPAT");
    await expect(page.getByText(/Mahalpatane/i).first()).toBeVisible();
  });

  test("search by village code works", async ({ app, page }) => {
    const code = (await page.evaluate(() => fetch("/data/mh_cfr_potential_villages.json").then((r) => r.json()).then((j: any[]) => j.find((v) => v.village === "Mahalpatane")?.villageCode))) as string;
    expect(code).toBeTruthy();
    await page.getByPlaceholder(/Search village name or code/).fill(code);
    await expect(page.getByText(/Mahalpatane/i).first()).toBeVisible();
  });

  test("nonsense query shows no result and does not crash", async ({ app, page }) => {
    const input = page.getByPlaceholder(/Search village name or code/);
    await input.fill("zzzzqqqq");
    await page.waitForTimeout(500);
    await expect(input).toHaveValue("zzzzqqqq");
    await expect(page.locator("li, [role=option]").filter({ hasText: /zzzzqqqq/i })).toHaveCount(0);
    app.assertNoPageErrors();
  });

  test("hostile input is rendered as text, never executed", async ({ app, page }) => {
    let dialog = false;
    page.on("dialog", (d) => ((dialog = true), d.dismiss()));
    await page.getByPlaceholder(/Search village name or code/).fill('<img src=x onerror=alert(1)><script>alert(2)</script>');
    await page.waitForTimeout(600);
    expect(dialog).toBe(false);
    expect(await page.locator("img[src='x']").count()).toBe(0);
  });

  test("very long input and rapid typing stay responsive", async ({ app, page }) => {
    const input = page.getByPlaceholder(/Search village name or code/);
    await input.fill("a".repeat(5000));
    await input.fill("");
    for (const ch of "Dongargaon") await input.pressSequentially(ch, { delay: 5 });
    await expect(page.getByText(/Dongargaon/i).first()).toBeVisible();
  });

  test("district → taluka → village selects cascade and fly", async ({ app, page }) => {
    const s = app.selects();
    await app.pick(s.nth(0), /Nashik|Nasik/);
    await app.pick(s.nth(1), /Deola/);
    await expect.poll(() => app.zoom(), { timeout: 20000 }).toBeGreaterThan(8);
    await app.pick(s.nth(2), /Mahalpatane/);
    await expect.poll(() => app.zoom(), { timeout: 20000 }).toBeGreaterThan(12);
  });

  test("changing district clears taluka and village (no stale selection)", async ({ app, page }) => {
    const s = app.selects();
    await app.pick(s.nth(0), /Nashik|Nasik/);
    await app.pick(s.nth(1), /Deola/);
    await app.pick(s.nth(0), /Pune/);
    await expect(s.nth(1)).toHaveValue("");
    await expect(s.nth(2)).toHaveValue("");
  });

  test("searching villages in every district file loads its boundaries (43 files)", async ({ app, page }) => {
    const names = await page.evaluate(async () => {
      const j: any[] = await fetch("/data/mh_cfr_potential_villages.json").then((r) => r.json());
      return [...new Set(j.map((v) => v.district))];
    });
    expect(names.length).toBeGreaterThan(20);
    const bad: string[] = [];
    for (const d of names as string[]) {
      const f = d === "Nashik" ? "Nasik" : d;
      const r = await page.request.get(`/data/villages/${f}.json`);
      if (!r.ok()) bad.push(`${d} -> ${r.status()}`);
    }
    expect(bad, "districts in the village list with no boundary file").toEqual([]);
  });
});
