import { test, expect } from "./fixtures";

/**
 * Amboli (Trimbakeshwar): comp. 210 is shared with Dhumodi and lies mostly in neighbouring forest. Parcels inside the
 * Gram Sabha polygon must be marked recognized / conflict, a click on a parcel names its Gram Sabha, and a click on
 * empty polygon ground opens the Gram Sabha card.
 */
test.describe("Gram Sabha polygon: parcels and clicks", () => {
  test("Amboli: parcels inside comp. 210 are marked and clicks resolve parcel first, then Gram Sabha", async ({ app, page }) => {
    test.setTimeout(420000);
    await app.open();
    await app.openPanel("CFR");
    const s = app.selects();
    await app.pick(s.nth(1), /नाशिक|Nashik/i);
    await app.pick(s.nth(2), /त्रिंबक|Trimbak/i);
    await app.pick(s.nth(3), /अंबोली|आंबोली|Amboli/i);

    const summary = page.getByTestId("cfr-comp-summary");
    await expect(summary).toBeVisible({ timeout: 120000 });
    const read = async () => {
      const t = ((await summary.innerText().catch(() => "")) || "").replace(/\s+/g, " ");
      const m = /Mapped on parcels: ([\d,.]+) ha in (\d+)/.exec(t);
      const c = /Conflict: (\d+) private parcels? \(([\d,.]+) ha\)/.exec(t);
      return { t, parcels: Number(m?.[2] ?? 0) + Number(c?.[1] ?? 0) };
    };
    await expect.poll(async () => (await read()).parcels, { timeout: 240000, intervals: [3000] }).toBeGreaterThan(3);
    // the forest/cadastral calibration settles as records load and moves the polygons: click only once it has
    let last = "";
    for (let i = 0, stable = 0; i < 40 && stable < 4; i++) {
      await page.waitForTimeout(3000);
      const sig = JSON.stringify(await page.evaluate(() => (window as any).__vmForestShift ?? null)) + (await read()).parcels;
      stable = sig === last ? stable + 1 : 0;
      last = sig;
    }
    console.log("SUMMARY:", (await read()).t, "SHIFT:", last);

    // marked parcels: pick one the app drew and click its centre
    const pick = () =>
      app.evalMap((m) => {
        const l = m.getLayers().getArray().find((x: any) => x.get("name") === "plot-marker");
        const f = l.getSource().getFeatures().find((q: any) => q.get("plotNo") ?? q.get("plotno"));
        if (!f) return null;
        const px = m.getPixelFromCoordinate(f.getGeometry().getInteriorPoint().getCoordinates());
        return { plot: String(f.get("plotNo") ?? f.get("plotno")), px };
      });
    await expect.poll(pick, { timeout: 60000 }).not.toBeNull();

    // fit the view to the Gram Sabha polygon so parcels and polygon are on screen
    await app.evalMap((m) => {
      const l = m.getLayers().getArray().find((x: any) => x.get("name") === "cfr-compartments");
      const fs = l.getSource().getFeatures().filter((f: any) => f.get("own"));
      let e: number[] | null = null;
      for (const f of fs) {
        const x = f.getGeometry().getExtent();
        e = e ? [Math.min(e[0]!, x[0]), Math.min(e[1]!, x[1]), Math.max(e[2]!, x[2]), Math.max(e[3]!, x[3])] : x;
      }
      if (e) m.getView().fit(e, { padding: [60, 460, 60, 60], maxZoom: 17, duration: 0 });
    });
    await app.renderComplete().catch(() => {});

    const own = await app.evalMap((m) => {
      const l = m.getLayers().getArray().find((x: any) => x.get("name") === "cfr-compartments");
      return l.getSource().getFeatures().filter((f: any) => f.get("own")).map((f: any) => ({ text: f.get("text"), names: f.get("names"), n: f.get("compNo") }));
    });
    console.log("OWN POLYGONS:", JSON.stringify(own));

    // 1) parcel click names the Gram Sabha
    const p = (await pick())!;
    await page.locator(".ol-viewport").first().click({ position: { x: p.px[0], y: p.px[1] } });
    const card = page.getByTestId("parcel-card");
    await expect(card).toBeVisible({ timeout: 15000 });
    console.log("PARCEL CARD:", ((await card.innerText()) || "").replace(/\s+/g, " "));
    await expect(card).toContainText("Gram Sabha");
    await expect(card).toContainText(/Recognized|Conflict/);
    await page.screenshot({ path: "test-results/amboli-parcel-card.png" });
    await card.getByRole("button", { name: "Close" }).click();

    // 2) a click on polygon ground with no parcel opens the Gram Sabha card: try each polygon part on its own
    const vp = page.locator(".ol-viewport").first();
    const parts = await app.evalMap((m) => {
      const l = m.getLayers().getArray().find((x: any) => x.get("name") === "cfr-compartments");
      return l.getSource().getFeatures().filter((q: any) => q.get("own")).length;
    });
    let opened = false;
    for (let k = 0; k < parts && !opened; k++) {
      const spots = await app.evalMap((m, idx: number) => {
        const l = m.getLayers().getArray().find((x: any) => x.get("name") === "cfr-compartments");
        const f = l.getSource().getFeatures().filter((q: any) => q.get("own"))[idx];
        const g = f.getGeometry();
        m.getView().fit(g.getExtent(), { padding: [150, 460, 80, 60], maxZoom: 17, duration: 0 });
        m.renderSync();
        const e = g.getExtent();
        const out: number[][] = [];
        for (let i = 1; i < 20; i++)
          for (let j = 1; j < 20; j++) {
            const c = [e[0] + (i / 20) * (e[2] - e[0]), e[1] + (j / 20) * (e[3] - e[1])];
            const px = m.getPixelFromCoordinate(c);
            if (g.intersectsCoordinate(c) && px[0] > 400 && px[0] < 1380 && px[1] > 130 && px[1] < 780) out.push(px);
          }
        return out;
      }, k);
      console.log("PART", k, "SPOTS:", spots.length);
      const stride = Math.max(1, Math.floor(spots.length / 25));
      for (const [x, y] of spots.filter((_, i) => i % stride === 0)) {
        const box = (await vp.boundingBox())!;
        await page.mouse.click(box.x + x!, box.y + y!);
        await page.waitForTimeout(500);
        if (await page.getByTestId("resource-card").isVisible()) {
          opened = true;
          break;
        }
      }
    }
    expect(opened, "a click on empty Gram Sabha polygon ground should open the Gram Sabha card").toBe(true);
    const rc = page.getByTestId("resource-card");
    console.log("GS CARD:", ((await rc.innerText()) || "").replace(/\s+/g, " "));
    await expect(rc).toContainText("Gram Sabha");
    await expect(rc).toContainText(/Comp\. \d+/);
    await page.screenshot({ path: "test-results/amboli-gs-card.png" });
    app.assertNoPageErrors();
  });
});
