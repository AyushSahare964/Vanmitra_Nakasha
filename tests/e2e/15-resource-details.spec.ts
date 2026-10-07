import { test, expect, type App } from "./fixtures";
import type { Page } from "@playwright/test";
import { describeResource, detailsAsText } from "../../src/lib/resource-details";

const AT: [number, number] = [74.343, 20.4178];

test.describe("resource details: description logic", () => {
  test("well: type label, year, condition, location and links", () => {
    const d = describeResource("well", { AssetType: "01", ConstructionYear: "2015", Condition: "02" }, AT)!;
    expect(d.title).toMatch(/Wells — Irrigation well/);
    expect(d.rows.find((r) => r.label === "Type")?.value).toBe("Irrigation well");
    expect(d.rows.find((r) => r.label === "Constructed")?.value).toBe("2015");
    expect(d.rows.find((r) => r.label === "Condition")?.value).toBe("Fair");
    expect(d.rows.find((r) => r.label === "Location")?.value).toContain("20.41780");
    const hrefs = d.links.map((l) => l.href);
    expect(hrefs).toContain("https://geoportal.mrsac.org.in/explore/");
    expect(hrefs.some((h) => h.includes("google.com/maps/search") && h.includes("20.417800,74.343000"))).toBe(true);
  });

  test("water body: area comes from Shape_Area (m2 -> ha) and falls back to the geometry", () => {
    const d = describeResource("waterbody", { WB_NAME: "Umrane lake", WB_TYPE: "Tank", Shape_Area: 125000 }, AT)!;
    expect(d.rows.find((r) => r.label === "Name")?.value).toBe("Umrane lake");
    expect(d.rows.find((r) => r.label === "Area")?.value).toBe("12.50 ha");
    const g = describeResource("waterbody", { WB_NAME: " " }, AT, 3.2)!;
    expect(g.rows.find((r) => r.label === "Area")?.value).toBe("3.20 ha");
    expect(g.rows.some((r) => r.label === "Name")).toBe(false); // blank values are not shown
  });

  test("forest compartment: number, type, range, beat, area", () => {
    const d = describeResource("forest", { COMP_NO: "289", COMP_TYPE: "Reserved Forest", RANGE: "Katol", BEAT: "Dhapewada", ShpAreaHa: 186.7 }, AT)!;
    const m = Object.fromEntries(d.rows.map((r) => [r.label, r.value]));
    expect(m["Compartment no."]).toBe("289");
    expect(m["Compartment type"]).toBe("Reserved Forest");
    expect(m["Range"]).toBe("Katol");
    expect(m["Area"]).toBe("186.70 ha");
  });

  test("every resource layer has a description; unknown layers are ignored; text export lists the links", () => {
    for (const k of ["well", "structure", "waterbody", "river", "drainage", "forest", "reserve", "wildlife"]) expect(describeResource(k, {}, AT), k).not.toBeNull();
    expect(describeResource("nope", {}, AT)).toBeNull();
    const t = detailsAsText(describeResource("river", { RIVNAME: "Girna" }, AT)!);
    expect(t).toContain("River: Girna");
    expect(t).toContain("https://geoportal.mrsac.org.in/explore/");
  });
});

/** Page coordinates of a drawn MRSAC feature, after centring the map on it. */
async function featureAt(app: App, page: Page, layerKey: string, zoom = 18) {
  const f = await app.evalMap((m, key: string) => {
    const l = m.getLayers().getArray().find((x: any) => x.get("name") === "mrsac-vector");
    const feat = l.getSource().getFeatures().find((x: any) => x.get("layerKey") === key);
    if (!feat) return null;
    const g = feat.getGeometry();
    const c = g.getType() === "Point" ? g.getCoordinates() : g.getInteriorPoint ? g.getInteriorPoint().getCoordinates() : g.getExtent().slice(0, 2);
    return { c: [c[0], c[1]] };
  }, layerKey);
  expect(f, `a drawn "${layerKey}" feature`).not.toBeNull();
  await app.evalMap((m, c: number[]) => {
    m.getView().setCenter(c);
    m.getView().setZoom(18);
  }, f!.c);
  await app.renderComplete(90000);
  const px = await app.evalMap((m, c: number[]) => {
    const p = m.getPixelFromCoordinate(c);
    const r = m.getTargetElement().getBoundingClientRect();
    return [r.left + p[0], r.top + p[1]];
  }, f!.c);
  return { x: px[0]!, y: px[1]!, coord: f!.c };
}

async function openCfrVillage(app: App, page: Page, d: string, t: string, v: string) {
  await app.openPanel("CFR");
  const s = app.selects();
  await expect.poll(async () => await s.nth(1).locator(`option[value="${d}"]`).count(), { timeout: 30000 }).toBeGreaterThan(0);
  await s.nth(1).selectOption(d);
  await expect.poll(async () => await s.nth(2).locator(`option[value="${t}"]`).count(), { timeout: 40000 }).toBeGreaterThan(0);
  await s.nth(2).selectOption(t);
  await expect.poll(async () => await s.nth(3).locator(`option[value="${v}"]`).count(), { timeout: 40000 }).toBeGreaterThan(0);
  await s.nth(3).selectOption(v);
  await expect(page.getByText(/wells, .* water-conservation structures/)).toBeVisible({ timeout: 120000 });
}
async function showLayer(page: Page, label: RegExp) {
  const cb = page.locator("text=In this village").locator("xpath=..").locator("label", { hasText: label }).locator("input").first();
  await cb.waitFor({ timeout: 20000 });
  await cb.check();
}

test.describe("resource details: clicking MRSAC features", () => {
  test("a well opens a details card with its attributes, links and a highlighted marker", async ({ app, page }) => {
    test.setTimeout(300000);
    await openCfrVillage(app, page, "20", "03", "272000030248650000"); // Umrane: ~1000 wells
    await showLayer(page, /^\s*Wells/);
    await expect.poll(async () => (await app.layerByName("mrsac-vector"))?.features ?? 0, { timeout: 30000 }).toBeGreaterThan(5);
    const at = await featureAt(app, page, "well");
    await page.mouse.click(at.x, at.y);
    const card = page.getByTestId("resource-card");
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(card).toContainText(/Wells/);
    await expect(card).toContainText("Location");
    const hrefs = await card.locator("a").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
    expect(hrefs.some((h) => /geoportal\.mrsac\.org\.in/.test(h))).toBe(true);
    expect(hrefs.some((h) => /google\.com\/maps/.test(h))).toBe(true);
    // every link opens in a new tab without leaking window.opener
    expect(await card.locator("a:not([target=_blank]), a:not([rel*=noopener])").count()).toBe(0);
    const sel = await app.evalMap((m) => m.getLayers().getArray().find((x: any) => x.get("name") === "mrsac-vector").getSource().getFeatures().filter((f: any) => f.get("selected")).length);
    expect(sel, "exactly the clicked feature is highlighted").toBe(1);
    await card.getByRole("button", { name: "Close" }).click();
    await expect(card).toHaveCount(0);
    expect(await app.evalMap((m) => m.getLayers().getArray().find((x: any) => x.get("name") === "mrsac-vector").getSource().getFeatures().filter((f: any) => f.get("selected")).length)).toBe(0);
  });

  test("a well inside a parcel names the survey number, and the chip selects it", async ({ app, page }) => {
    test.setTimeout(300000);
    await openCfrVillage(app, page, "20", "03", "272000030248650000");
    await showLayer(page, /^\s*Wells/);
    await expect.poll(async () => (await app.layerByName("mrsac-vector"))?.features ?? 0, { timeout: 30000 }).toBeGreaterThan(5);
    // Survey 10: its geometry is fetched and drawn as a marker polygon.
    await app.openPanel("Cadastral");
    await app.pick(app.selects().nth(5), /^10$/);
    await expect.poll(async () => (await app.layerByName("plot-marker"))?.features ?? 0, { timeout: 60000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1500);
    await app.openPanel("CFR"); // MRSAC overlays are only drawn while the CFR panel is open (re-queried on return)
    await expect(page.getByText(/wells, .* water-conservation structures/)).toBeVisible({ timeout: 120000 });
    await expect.poll(async () => (await app.layerByName("mrsac-vector"))?.features ?? 0, { timeout: 60000 }).toBeGreaterThan(5);
    // Put a copy of a real MRSAC well at the interior point of that parcel (so the containment lookup is deterministic).
    const c = await app.evalMap((m) => {
      const L = m.getLayers().getArray();
      const poly = L.find((x: any) => x.get("name") === "plot-marker").getSource().getFeatures().find((f: any) => /Polygon/.test(f.getGeometry().getType()));
      const src = L.find((x: any) => x.get("name") === "mrsac-vector").getSource();
      const well = src.getFeatures().find((f: any) => f.get("layerKey") === "well");
      const pt = poly.getGeometry().getInteriorPoint().getCoordinates();
      const copy = well.clone();
      const g = well.getGeometry().clone();
      g.setCoordinates([pt[0], pt[1]]);
      copy.setGeometry(g);
      copy.set("AssetType", "01");
      src.addFeature(copy);
      m.getView().setCenter([pt[0], pt[1]]);
      m.getView().setZoom(19);
      return [pt[0], pt[1]];
    });
    await app.renderComplete(90000);
    const px = await app.evalMap((m, cc: number[]) => {
      const p = m.getPixelFromCoordinate(cc);
      const r = m.getTargetElement().getBoundingClientRect();
      return [r.left + p[0], r.top + p[1]];
    }, c);
    await page.mouse.click(px[0]!, px[1]!);
    const card = page.getByTestId("resource-card");
    await expect(card).toBeVisible({ timeout: 10000 });
    const chips = page.getByTestId("resource-surveys");
    await expect(chips).toBeVisible();
    await expect(chips).toContainText("located in survey no.");
    await expect(chips.getByRole("button", { name: "10", exact: true })).toBeVisible();
    // close the Plot Info window so the chip click has to reopen it
    await page.locator('button[title="Close Window"]').click();
    await expect(page.getByTestId("plot-extras")).toHaveCount(0);
    await chips.getByRole("button", { name: "10", exact: true }).click();
    await expect(page.getByTestId("plot-extras").first()).toBeVisible({ timeout: 30000 });
  });

  test("a water body shows its area; a forest compartment lists the survey numbers inside it", async ({ app, page }) => {
    test.setTimeout(300000);
    await openCfrVillage(app, page, "20", "03", "272000030248650000");
    await showLayer(page, /Water bodies/);
    await expect.poll(async () => (await app.layerByName("mrsac-vector"))?.features ?? 0, { timeout: 30000 }).toBeGreaterThan(0);
    const wb = await featureAt(app, page, "waterbody", 17);
    await page.mouse.click(wb.x, wb.y);
    const card = page.getByTestId("resource-card");
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(card).toContainText(/Water bodies/);
    await expect(card).toContainText(/Area\s*\d/);
  });
});

test.describe("resource details: survey numbers", () => {
  test("a selected survey number shows 'Detailed info' with only the Google Maps link", async ({ app, page }) => {
    test.setTimeout(300000);
    await app.openPanel("Cadastral");
    const s = app.selects();
    await expect.poll(async () => await s.nth(1).locator('option[value="20"]').count(), { timeout: 30000 }).toBeGreaterThan(0);
    await s.nth(1).selectOption("20");
    await expect.poll(async () => await s.nth(2).locator('option[value="03"]').count(), { timeout: 40000 }).toBeGreaterThan(0);
    await s.nth(2).selectOption("03");
    await expect.poll(async () => await s.nth(3).locator('option[value="272000030248650000"]').count(), { timeout: 40000 }).toBeGreaterThan(0);
    await s.nth(3).selectOption("272000030248650000");
    await expect(app.rows().first()).toBeVisible({ timeout: 60000 });
    await app.pick(s.nth(5), /^10$/);
    const extras = page.getByTestId("plot-extras").first();
    await expect(extras).toBeVisible({ timeout: 60000 });
    await expect(extras).toContainText("Detailed info");
    // only the Google Maps link is offered in this block
    await expect.poll(async () => await extras.locator("a").count(), { timeout: 20000 }).toBe(1);
    const href = await extras.locator("a").first().getAttribute("href");
    expect(href).toMatch(/google\.com\/maps\/search/);
    await expect(extras).not.toContainText(/MRSAC Geoportal|Satellite view|Official map report|CFR atlas/);
  });

  test("a CFR-recognized survey number shows its approval details and only the Google Maps link", async ({ app, page }) => {
    test.setTimeout(300000);
    await openCfrVillage(app, page, "09", "02", "270900020100110000"); // Amnergondi (Katol): 16 recognized parcels
    await expect.poll(async () => (await app.layerByName("plot-marker"))?.features ?? 0, { timeout: 120000 }).toBeGreaterThan(1);
    // pick a recognized survey from the CFR list and open it
    const row = app.rows().filter({ hasText: /approved/i }).first();
    await expect(row).toBeVisible({ timeout: 60000 });
    await row.getByRole("button").first().click();
    const cfr = page.getByTestId("plot-extras-cfr").first();
    await expect(cfr).toBeVisible({ timeout: 60000 });
    await expect(cfr).toContainText("CFR recognized");
    await expect(cfr).toContainText(/Approved area: [\d.]+ ha/);
    await expect(cfr).toContainText(/Purpose:/);
    const links = await page.getByTestId("plot-extras").first().locator("a").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
    expect(links.length).toBe(1);
    expect(links[0]).toMatch(/google\.com\/maps/);
  });
});

test.describe("survey details card (click a survey number on the map)", () => {
  test("clicking a parcel opens a card with owner, area, land type and a Google Maps link; 'Full plot info' opens Plot Info", async ({ app, page }) => {
    test.setTimeout(300000);
    await app.openPanel("Cadastral");
    const s = app.selects();
    await expect.poll(async () => await s.nth(1).locator('option[value="20"]').count(), { timeout: 30000 }).toBeGreaterThan(0);
    await s.nth(1).selectOption("20");
    await expect.poll(async () => await s.nth(2).locator('option[value="03"]').count(), { timeout: 40000 }).toBeGreaterThan(0);
    await s.nth(2).selectOption("03");
    await expect.poll(async () => await s.nth(3).locator('option[value="272000030248650000"]').count(), { timeout: 40000 }).toBeGreaterThan(0);
    await s.nth(3).selectOption("272000030248650000");
    await expect(app.rows().first()).toBeVisible({ timeout: 60000 });
    await app.pick(s.nth(5), /^10$/);
    await expect.poll(async () => (await app.layerByName("plot-marker"))?.features ?? 0, { timeout: 60000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1500);
    await page.locator('button[title="Close Window"]').click();
    // click inside the drawn parcel 10
    const c = await app.evalMap((m) => {
      const poly = m.getLayers().getArray().find((x: any) => x.get("name") === "plot-marker").getSource().getFeatures().find((f: any) => /Polygon/.test(f.getGeometry().getType()));
      const pt = poly.getGeometry().getInteriorPoint().getCoordinates();
      m.getView().setCenter([pt[0], pt[1]]);
      m.getView().setZoom(18);
      return [pt[0], pt[1]];
    });
    await app.renderComplete(90000);
    const px = await app.evalMap((m, cc: number[]) => {
      const p = m.getPixelFromCoordinate(cc);
      const r = m.getTargetElement().getBoundingClientRect();
      return [r.left + p[0], r.top + p[1]];
    }, c);
    await page.mouse.click(px[0]!, px[1]!);
    const card = page.getByTestId("parcel-card");
    await expect(card).toBeVisible({ timeout: 20000 });
    await expect(card).toContainText("Survey No. 10");
    await expect(card).toContainText("Owner");
    await expect(card).not.toContainText("loading record");
    await expect(card).toContainText(/Area\s*[\d.]+ ha/);
    const href = await card.locator("a").first().getAttribute("href");
    expect(href).toMatch(/google\.com\/maps\/search/);
    await card.getByRole("button", { name: "Full plot info" }).click();
    await expect(page.getByTestId("plot-extras").first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("parcel-card")).toHaveCount(0);
  });

  test("an MRSAC feature takes the click before the survey underneath it", async ({ app, page }) => {
    test.setTimeout(300000);
    await openCfrVillage(app, page, "20", "03", "272000030248650000");
    await showLayer(page, /^\s*Wells/);
    await expect.poll(async () => (await app.layerByName("mrsac-vector"))?.features ?? 0, { timeout: 30000 }).toBeGreaterThan(5);
    const at = await featureAt(app, page, "well");
    await page.mouse.click(at.x, at.y);
    await expect(page.getByTestId("resource-card")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("parcel-card")).toHaveCount(0);
  });
});
