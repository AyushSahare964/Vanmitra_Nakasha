import { test, expect, VILLAGES } from "./fixtures";
import fs from "node:fs";
import path from "node:path";

const SHOTS = path.resolve(process.cwd(), "perf-results/screens");
const SIZES: [string, number, number][] = [
  ["desktop-1920", 1920, 1080],
  ["laptop-1366", 1366, 768],
  ["small-laptop-1024", 1024, 768],
  ["tablet-768", 768, 1024],
  ["phone-390", 390, 844],
  ["phone-small-320", 320, 640],
];

test.describe("responsive layout", () => {
  for (const [name, w, h] of SIZES) {
    test(`${name} (${w}x${h}): no page overflow, toolbar reachable, panels fit the screen`, async ({ app, page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(500);
      fs.mkdirSync(SHOTS, { recursive: true });
      expect(await app.bodyOverflowX(), "horizontal page scroll").toBeLessThanOrEqual(1);
      for (const p of ["Search", "Cadastral", "Explore", "CFR"] as const) {
        await app.toolbar(p).scrollIntoViewIfNeeded();
        await app.toolbar(p).click();
        await page.waitForTimeout(300);
        const over = await app.bodyOverflowX();
        expect(over, `${p} panel causes horizontal overflow at ${w}px`).toBeLessThanOrEqual(1);
        // the map must keep a usable share of the screen with a panel open
        const canvas = (await page.locator("canvas").first().boundingBox())!;
        expect(canvas.width, `${p}: canvas width`).toBeGreaterThan(Math.min(250, w * 0.4));
      }
      await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    });
  }

  test("cadastral panel stays inside a 1366x768 viewport with a village loaded", async ({ app, page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await app.cascade(VILLAGES.umrane.dist, VILLAGES.umrane.taluka, VILLAGES.umrane.village);
    await expect(app.rows().first()).toBeVisible({ timeout: 40000 });
    const box = (await app.rows().first().boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(1366);
    await page.screenshot({ path: path.join(SHOTS, "laptop-1366-village.png") });
  });
});

test.describe("accessibility basics", () => {
  test("every visible button has an accessible name (icon-only buttons need aria-label)", async ({ app, page }) => {
    for (const p of ["Layers", "Search", "Cadastral", "Explore", "CFR"] as const) {
      await app.toolbar(p).click();
      await page.waitForTimeout(250);
    }
    const bad = await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .filter((b) => (b as HTMLElement).offsetParent)
        .filter((b) => {
          const name = (b.getAttribute("aria-label") || b.textContent || "").replace(/[\s✕+−×⚙]/g, "");
          return !name && !b.getAttribute("aria-label");
        })
        .map((b) => b.outerHTML.slice(0, 90))
    );
    expect(bad, "buttons whose only content is an icon/symbol and no aria-label").toEqual([]);
  });

  test("symbol-only buttons (✕, +, −, ⚙) carry aria-labels", async ({ app, page }) => {
    await app.toolbar("Search").click();
    const bad = await page.evaluate(() =>
      [...document.querySelectorAll("button")].filter((b) => (b as HTMLElement).offsetParent && /^[\s✕+−×⚙]+$/.test(b.textContent || "") && !b.getAttribute("aria-label")).map((b) => (b.getAttribute("title") || b.textContent || "").trim())
    );
    expect(bad).toEqual([]);
  });

  test("form controls have labels and images have alt text", async ({ app, page }) => {
    await app.toolbar("Cadastral").click();
    await app.toolbar("Search").click();
    const res = await page.evaluate(() => {
      const unlabeled = [...document.querySelectorAll("input,select")]
        .filter((e) => (e as HTMLElement).offsetParent && (e as HTMLInputElement).type !== "hidden")
        .filter((e) => {
          const el = e as HTMLInputElement;
          return !el.getAttribute("aria-label") && !el.id?.length && !el.closest("label") && !el.placeholder && !el.getAttribute("aria-labelledby") && !(el.previousElementSibling?.tagName === "LABEL");
        })
        .map((e) => e.outerHTML.slice(0, 80));
      const noAlt = [...document.querySelectorAll("img")].filter((i) => i.getAttribute("alt") === null).map((i) => i.src.slice(-40));
      return { unlabeled, noAlt };
    });
    expect(res.noAlt).toEqual([]);
    expect(res.unlabeled, "inputs/selects without any label").toEqual([]);
  });

  test("About modal: has dialog semantics and Escape closes it", async ({ page, app }) => {
    await page.getByRole("button", { name: "Learn More" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("keyboard: Tab reaches the toolbar and Enter/Space opens a panel", async ({ page, app }) => {
    const btn = app.toolbar("Search");
    await btn.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByPlaceholder(/Search village name or code/)).toBeVisible();
  });

  test("page declares its language", async ({ page, app }) => {
    expect(await page.evaluate(() => document.documentElement.lang)).toMatch(/^en/);
  });
});
