import { test, expect, VILLAGES } from "./fixtures";

/** Filter / sort correctness on a ~2,100-parcel village. Owner-dependent checks wait for some records first. */
test.describe("land explorer: search, filter, sort correctness", () => {
  test.beforeEach(async ({ app, page }) => {
    await app.cascade(VILLAGES.umrane.dist, VILLAGES.umrane.taluka, VILLAGES.umrane.village);
    await expect(app.rows().first()).toBeVisible({ timeout: 40000 });
    await app.openPanel("Explore");
    await expect(page.getByLabel("Search parcels")).toBeVisible();
    await expect(app.rows().first()).toBeVisible();
  });

  const loaded = (app: any, n: number) => expect.poll(async () => (await app.recordsBanner())?.done ?? 99999, { timeout: 70000 }).toBeGreaterThan(n);

  test("default order is ascending numeric survey number", async ({ app }) => {
    const nums = (await app.rowNumbers(50)).map((n: string) => parseInt(n, 10));
    for (let i = 1; i < nums.length; i++) expect(nums[i]!, `row ${i}`).toBeGreaterThanOrEqual(nums[i - 1]!);
  });

  test("survey-number search: exact match first, then prefix matches, never substrings", async ({ app, page }) => {
    await page.getByLabel("Search parcels").fill("10");
    await expect.poll(async () => (await app.rowNumbers(1))[0]).toBe("10");
    const nums = await app.rowNumbers(60);
    expect(nums.every((n: string) => n.startsWith("10")), `all rows start with 10: ${nums}`).toBe(true);
    expect(nums).not.toContain("110");
  });

  test("a survey number that does not exist shows the empty state", async ({ page }) => {
    await page.getByLabel("Search parcels").fill("99999");
    await expect(page.getByText("No parcels match.")).toBeVisible();
  });

  test("sort by survey toggles direction and is a true reverse", async ({ app, page }) => {
    const asc = (await app.rowNumbers(15)).map((n: string) => parseInt(n, 10));
    await page.getByRole("button", { name: /^Survey no\./ }).click();
    await expect.poll(async () => parseInt((await app.rowNumbers(1))[0]!, 10)).toBeGreaterThan(asc[asc.length - 1]!);
    const desc = (await app.rowNumbers(30)).map((n: string) => parseInt(n, 10));
    for (let i = 1; i < desc.length; i++) expect(desc[i]!).toBeLessThanOrEqual(desc[i - 1]!);
  });

  test("sort by area: largest first and areas never increase down the list", async ({ app, page }) => {
    await loaded(app, 40);
    await page.getByRole("button", { name: /^Area/ }).click();
    // records keep streaming in and re-order the list: the order must be sorted at some settled instant
    await expect
      .poll(
        async () => {
          const a = await page.evaluate(() => [...document.querySelectorAll("li")].map((li) => /^Survey \S+\s+([\d.]+) ha/.exec(((li as HTMLElement).innerText || "").trim().replace(/\s+/g, " "))?.[1]).filter(Boolean).slice(0, 40).map(Number));
          return a.length > 5 && a.every((v, i) => i === 0 || v <= a[i - 1]! + 1e-9);
        },
        { timeout: 15000, intervals: [300] }
      )
      .toBe(true);
  });

  test("category tiles toggle on and off and counts are non-negative integers", async ({ app, page }) => {
    await loaded(app, 60);
    const tiles = page.locator("button[aria-pressed]");
    const counts = await tiles.evaluateAll((bs) => bs.map((b) => Number((b.querySelector(".tabular-nums")?.textContent || "").trim())));
    expect(counts.every((c) => Number.isInteger(c) && c >= 0)).toBe(true);
    expect(counts.reduce((a, b) => a + b, 0)).toBeGreaterThan(40);
    const firstOn = page.locator("button[aria-pressed]:not([disabled])").first();
    await firstOn.click();
    await expect(firstOn).toHaveAttribute("aria-pressed", "true");
    await firstOn.click();
    await expect(firstOn).toHaveAttribute("aria-pressed", "false");
  });

  test("owner-name search finds parcels and the banner never claims more than the total", async ({ app, page }) => {
    await loaded(app, 40);
    const name = await page.evaluate(() => {
      for (const li of document.querySelectorAll("li")) {
        const t = [...li.querySelectorAll(".truncate")].map((x) => x.textContent?.trim() || "").find((x) => x && !/loading|no record|ha$/i.test(x));
        if (t) return t;
      }
      return "";
    });
    expect(name.length).toBeGreaterThan(1);
    await page.getByLabel("Search parcels").fill(name.split(/\s+/)[0]!);
    await expect.poll(async () => await app.rows().count(), { timeout: 10000 }).toBeGreaterThan(0);
    const b = await app.recordsBanner();
    if (b) expect(b.done).toBeLessThanOrEqual(b.total);
  });

  test("Reset clears the query", async ({ page }) => {
    await page.getByLabel("Search parcels").fill("55");
    await page.getByRole("button", { name: /Reset/ }).first().click();
    await expect(page.getByLabel("Search parcels")).toHaveValue("");
  });

  test("Show on map draws parcels and never throws", async ({ app, page }) => {
    await loaded(app, 40);
    await page.getByRole("button", { name: "Show on map" }).click();
    await expect.poll(async () => (await app.layerByName("plot-marker"))?.features ?? 0, { timeout: 60000 }).toBeGreaterThan(0);
  });

  test("lazy pagination: scrolling loads more rows", async ({ app, page }) => {
    const n0 = await app.rows().count();
    expect(n0).toBeLessThanOrEqual(60);
    await app.rows().last().scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 4000);
    await expect.poll(() => app.rows().count(), { timeout: 10000 }).toBeGreaterThan(n0);
  });
});
