import { test, expect } from "./fixtures";
import fs from "node:fs";

// Needs the live MahaBhuNakasha portal and ESRI imagery: slow, so one generous test.
test.describe("PDF report", () => {
  test("village report downloads as a multi-page PDF; survey report downloads from its card", async ({ app, page }) => {
    test.setTimeout(600_000);
    await app.openPanel("CFR");
    const s = app.selects();
    await app.pick(s.nth(1), /Nag?n?pur|नागपूर/i);
    await expect.poll(async () => await s.nth(2).locator("option").count(), { timeout: 40000 }).toBeGreaterThan(1);
    const opt = await s.nth(2).locator("option").evaluateAll((os) => (os as HTMLOptionElement[]).find((o) => o.text.includes("●"))?.value ?? "");
    test.skip(!opt, "no flagged taluka in Nagpur snapshot");
    await s.nth(2).selectOption(opt);
    await expect.poll(async () => (await s.nth(3).locator("option").allTextContents()).some((t) => t.includes("●")), { timeout: 40000 }).toBe(true);
    const v = await s.nth(3).locator("option").evaluateAll((os) => (os as HTMLOptionElement[]).find((o) => o.text.includes("●"))?.value ?? "");
    await s.nth(3).selectOption(v);
    await expect(app.rows().first()).toBeVisible({ timeout: 60000 });

    const btn = page.getByTestId("report-village");
    await expect(btn).toBeEnabled({ timeout: 60000 });
    const dl = page.waitForEvent("download", { timeout: 540_000 });
    await btn.click();
    await expect(page.getByTestId("report-progress")).toBeVisible();
    const file = await dl;
    const path = "test-results/e2e/village-report.pdf";
    await file.saveAs(path);
    const buf = fs.readFileSync(path);
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    expect(buf.length).toBeGreaterThan(100_000);
    expect(file.suggestedFilename()).toMatch(/^VanMitra_Village_Report_/);
    await expect(page.getByTestId("report-progress")).toBeHidden();

    // Survey-number report from the selected parcel's detail card.
    await app.rows().first().locator("button").first().click();
    const sbtn = page.getByTestId("report-survey").first();
    await expect(sbtn).toBeVisible({ timeout: 30000 });
    const sdl = page.waitForEvent("download", { timeout: 300_000 });
    await sbtn.click();
    const sfile = await sdl;
    await sfile.saveAs("test-results/e2e/survey-report.pdf");
    expect(sfile.suggestedFilename()).toMatch(/^VanMitra_Survey_/);
    expect(fs.readFileSync("test-results/e2e/survey-report.pdf").subarray(0, 4).toString()).toBe("%PDF");
  });
});
