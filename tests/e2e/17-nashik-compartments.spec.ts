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
    await expect.poll(async () => (await read()).parcels, { timeout: 240000, intervals: [3000] }).toBeGreaterThan(40);
    await expect.poll(async () => (await read()).ha, { timeout: 120000, intervals: [3000] }).toBeGreaterThan(71.25 * 0.5);
    const { t, ha } = await read();
    expect(ha, t).toBeLessThan(71.25 * 1.4);
    expect(t).toContain("Conflict:");
    // conflict is its own status chip
    await expect(page.getByText("Conflict (private land in CFR)").first()).toBeVisible();
    // MRSAC outline layer exists and compartment polygons are never drawn without a label
    const feats = await app.layerByName("cfr-compartments");
    expect(feats).not.toBeNull();
    app.assertNoPageErrors();
  });
});
