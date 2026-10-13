import { test, expect } from "./fixtures";

/**
 * Nashik claims resolved offline to MRSAC polygons: the compartment polygon is the primary mark, it carries the
 * gram sabha name as written in the sheet, and neighbouring villages within the radius are drawn and named.
 */
test.describe("Nashik resolved compartments", () => {
  test("Udmal: gram sabha claim, MRSAC polygon with its name, neighbouring villages", async ({ app, page }) => {
    test.setTimeout(300000);
    await app.open();
    await app.openPanel("CFR");
    const s = app.selects();
    await app.pick(s.nth(1), /नाशिक|Nashik/i);
    await app.pick(s.nth(2), /सुरगाणा|Surgana/i);
    await app.pick(s.nth(3), /उदमाळ|उदमाल|Udmal/i);

    const claims = page.getByTestId("cfr-claims");
    await expect(claims).toBeVisible({ timeout: 120000 });
    await expect(claims).toContainText("ग्रामस्थ"); // gram sabha as written
    await expect(claims).toContainText("comp. 13");
    await expect(claims).toContainText(/inside the village|outside the village|located by compartment number/);

    // polygons carry the gram sabha name and compartment in their label
    await expect
      .poll(async () => (await app.evalMap((m) => {
        const l = m.getLayers().getArray().find((x: any) => x.get("name") === "cfr-compartments");
        return l.getSource().getFeatures().filter((f: any) => f.get("kind") === "res" && f.get("own") && /ग्रामस्थ.*comp\. 13/.test(f.get("text"))).length;
      })) as number, { timeout: 60000 })
      .toBeGreaterThan(0);

    // neighbouring villages within the radius are drawn with names
    await expect
      .poll(async () => (await app.evalMap((m) => {
        const l = m.getLayers().getArray().find((x: any) => x.get("name") === "cfr-near-villages");
        return l.getSource().getFeatures().filter((f: any) => (f.get("text") as string).length > 0).length;
      })) as number, { timeout: 90000 })
      .toBeGreaterThan(3);
    app.assertNoPageErrors();
  });
});
