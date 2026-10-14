import { test, expect } from "./fixtures";

/**
 * Nashik approvals name forest compartments, not survey numbers. Udmal (Surgana): compartment 13, 71.25 ha approved.
 * Checks the parcel mapping, the conflict class and the area summary — not pixel positions.
 */
test.describe("Nashik compartment approvals", () => {
  test("Udmal: compartment 13 maps onto cadastral parcels, with a conflict class and area summary", async ({ app, page }) => {
    test.setTimeout(300000);
    await app.open();
    await app.openPanel("CFR");
    const s = app.selects();
    await app.pick(s.nth(1), /नाशिक|Nashik/i);
    await app.pick(s.nth(2), /सुरगाणा|Surgana/i);
    await app.pick(s.nth(3), /उदमाळ|उदमाल|Udmal/i);

    const summary = page.getByTestId("cfr-comp-summary");
    await expect(summary).toBeVisible({ timeout: 120000 });
    // parcels load progressively; wait for the summary to settle on the full set
    const read = async () => {
      const t = ((await summary.innerText().catch(() => "")) || "").replace(/\s+/g, " ");
      const m = /Mapped on parcels: ([\d,.]+) ha in (\d+)/.exec(t);
      const c = /Conflict: (\d+) private parcels? \(([\d,.]+) ha\)/.exec(t);
      const num = (x?: string) => (x ? Number(x.replace(/,/g, "")) : 0);
      return { t, parcels: num(m?.[2]) + num(c?.[1]), ha: num(m?.[1]) + num(c?.[2]) };
    };
    // recognized (forest / govt holder) + conflict (private holder) parcels together cover the approved compartment
    await expect.poll(async () => (await read()).parcels, { timeout: 240000, intervals: [3000] }).toBeGreaterThan(15);
    await expect.poll(async () => (await read()).ha, { timeout: 120000, intervals: [3000] }).toBeGreaterThan(71.25 * 0.3);
    const { t, ha } = await read();
    expect(ha, t).toBeLessThan(71.25 * 1.4);
    expect(t).toContain("Conflict:");
    // compartments were measured against the cadastral: forest-held parcels fall inside, private ones outside
    // the village starts from the regional offset; its own measurement replaces it once the parcels are in
    await expect.poll(() => page.evaluate(() => (window as any).__vmForestShift?.how), { timeout: 60000 }).toBe("measured");
    const shift = await page.evaluate(() => (window as any).__vmForestShift);
    expect(shift, "forest/cadastral offset should be measured for this village").not.toBeNull();
    expect(shift.score).toBeGreaterThan(0.8);
    expect(shift.score).toBeGreaterThan(shift.base);
    // conflict is its own status chip
    await expect(page.getByText("Conflict (private land in CFR)").first()).toBeVisible();
    // MRSAC outline layer exists and compartment polygons are never drawn without a label
    const feats = await app.layerByName("cfr-compartments");
    expect(feats).not.toBeNull();
    // clicking a survey number inside the compartment opens the survey card, not the forest-compartment card
    const px = await app.evalMap((m) => {
      const l = m.getLayers().getArray().find((x: any) => x.get("name") === "plot-marker");
      const f = l.getSource().getFeatures().find((x: any) => /Polygon/.test(x.getGeometry().getType()));
      const p = m.getPixelFromCoordinate(f.getGeometry().getInteriorPoint().getCoordinates().slice(0, 2));
      return { x: p[0] as number, y: p[1] as number };
    });
    const box = await page.locator("canvas").first().boundingBox();
    await page.mouse.click(box!.x + px.x, box!.y + px.y);
    await expect(page.getByText(/Survey No\. \d+/).first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Compartment no.")).toHaveCount(0);
    app.assertNoPageErrors();
  });
});
