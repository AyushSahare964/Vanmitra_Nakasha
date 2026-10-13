import fs from "node:fs";
import path from "node:path";
import { test, expect } from "./fixtures";

/**
 * One village per Nashik taluka (plus one filed under a portal village by alias): the dropdowns are marked, every
 * claim shows its gram sabha, the MRSAC polygons follow the data, and every filter (purpose chips, status chips)
 * marks exactly the right claims / parcels. Expectations come from the committed data, not from the page.
 */
const R = (f: string) => JSON.parse(fs.readFileSync(path.resolve(process.cwd(), f), "utf8"));
const rows: any[] = R("src/data/cfr-approved.json").filter((r: any) => r.d === "नाशिक");
const comp = R("public/data/cfr-comp/nashik.json");
const portal: { value: string; villages: { value: string }[] }[] = R("public/data/bn/R-20.json");
const PORTAL_TALUKA: Record<string, string> = { मालेगांव: "मालेगाव" };
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const recsOf = (r: any) => (comp.claims[`${r.t}|${r.cn ?? ""}|${r.v}`] ?? []) as any[];
const polyKey = (rec: any) => (rec.wk ? "w:" : "") + [...rec.ids].sort((a: number, b: number) => a - b).join(",");

/** The village with the most drawn claims among those the dropdown can find by their exact name (or alias). */
function pickVillage(taluka: string, aliased = false) {
  const pt = portal.find((t) => t.value === (PORTAL_TALUKA[taluka] ?? taluka));
  if (!pt) return null;
  const count = (n: string) => pt.villages.filter((v) => v.value === n).length;
  const by = new Map<string, any[]>();
  for (const r of rows.filter((x) => x.t === taluka && (aliased ? x.pv : true))) {
    const pv = r.pv ?? r.v;
    if (count(pv) === 1) by.set(pv, [...(by.get(pv) ?? []), r]);
  }
  const score = (rs: any[]) => rs.reduce((n, r) => n + recsOf(r).filter((c) => c.ids).length, 0);
  const best = [...by.entries()].filter(([, rs]) => score(rs) > 0).sort((a, b) => score(b[1]) - score(a[1]))[0];
  return best ? { portalTaluka: pt.value, village: best[0], vrows: best[1] } : null;
}

const cases = [...new Set(rows.map((r) => r.t))].map((t) => ({ name: `taluka ${t}`, t, aliased: false }));
cases.push({ name: "village filed under a portal village by alias", t: rows.find((r) => r.pv)!.t, aliased: true });

for (const c of cases) {
  test(`Nashik ${c.name}: marked dropdowns, gram sabha names, polygons and every filter`, async ({ app, page }) => {
    test.setTimeout(1500000);
    const pick = pickVillage(c.t, c.aliased);
    test.skip(!pick, `no drawn claim for ${c.t}`);
    const { portalTaluka, village, vrows } = pick!;
    const recs = vrows.flatMap((r: any) => recsOf(r).map((rec: any) => ({ r, rec })));
    const drawn = recs.filter((x: any) => x.rec.ids);

    await app.open();
    await app.openPanel("CFR");
    const s = app.selects();
    await app.pick(s.nth(1), /नाशिक|Nashik/i);
    await app.pick(s.nth(2), new RegExp("^" + esc(portalTaluka) + "\\s*●"));
    await app.pick(s.nth(3), new RegExp("^" + esc(village) + "\\s*●"));

    // every claim of the village is listed with its gram sabha as written in the sheet
    const claims = page.getByTestId("cfr-claims");
    await expect(claims).toBeVisible({ timeout: 120000 });
    const cards = claims.locator("> div.rounded");
    await expect(cards).toHaveCount(recs.length);
    const text = (await claims.innerText()).replace(/\s+/g, " ");
    for (const r of vrows) expect(text, `gram sabha ${r.gs}`).toContain(r.gs);
    if (c.aliased) expect(text).toContain("Listed as");

    // MRSAC polygons: one per distinct polygon set, each labelled with a gram sabha of this village
    const ownFeatures = () =>
      app.evalMap((m) => {
        const l = m.getLayers().getArray().find((x: any) => x.get("name") === "cfr-compartments");
        return l.getSource().getFeatures().filter((f: any) => f.get("kind") === "res" && f.get("own") && f.get("text")).map((f: any) => f.get("text") as string);
      }) as Promise<string[]>;
    const expected = (list: any[]) => new Set(list.filter((x) => x.rec.ids).map((x) => polyKey(x.rec))).size;
    await expect.poll(async () => (await ownFeatures()).length, { timeout: 60000 }).toBe(expected(recs));
    for (const t of await ownFeatures()) expect(vrows.some((r: any) => t.includes(r.gs)), t).toBe(true);

    // purpose chips: claims table and polygons follow each one
    for (const [label, key] of [["Grazing", "grazing"], ["Timber & fuel", "timber"], ["Cattle / burial ground", "cattle"], ["Other", "other"]] as const) {
      const chip = page.locator("button[aria-pressed]", { hasText: new RegExp(`^${esc(label)}$`) }).first();
      if (!(await chip.count())) continue;
      const want = recs.filter((x: any) => x.rec.pg?.includes(key));
      await chip.click();
      await expect(cards, `${label}: claim cards`).toHaveCount(want.length);
      await expect.poll(async () => (await ownFeatures()).length, { timeout: 30000, message: `${label}: polygons` }).toBe(expected(want));
      await chip.click();
      await expect(cards).toHaveCount(recs.length);
    }

    // parcels load progressively; use whatever the village has once the counts stop moving
    const tile = (mr: string, en: RegExp) => page.locator("button[aria-pressed]", { hasText: mr }).filter({ hasText: en }).first();
    const STATUS = [["मान्य", /Recognized/], ["वाद", /Conflict/], ["वन", /Forest candidate/], ["शासकीय", /Govt/], ["इतर", /Other/]] as const;
    const countOf = async (mr: string, en: RegExp) => Number(((await tile(mr, en).innerText().catch(() => "")) || "").match(/(\d+)\s*$/m)?.[1] ?? NaN);
    let last = "", stable = 0;
    for (let i = 0; i < 40 && stable < 3; i++) {
      const sig = (await Promise.all(STATUS.map(([mr, en]) => countOf(mr, en)))).join(",");
      stable = sig === last && !/^(0,)*0$/.test(sig) ? stable + 1 : 0;
      last = sig;
      await page.waitForTimeout(3000);
    }
    const total = last.split(",").reduce((a, b) => a + (Number(b) || 0), 0);
    if (total === 0) {
      test.info().annotations.push({ type: "note", description: "no parcels loaded for this village; parcel filters not checked" });
      app.assertNoPageErrors();
      return;
    }
    const polygonStatusOK = new Set(["मान्य", "वाद"]);
    for (const [mr, en] of STATUS) {
      const n = await countOf(mr, en);
      if (!(n > 0)) continue;
      const chip = tile(mr, en);
      await chip.click();
      await expect(page.getByText(new RegExp(`^${n} parcels`)).first(), `${mr}: parcel count`).toBeVisible({ timeout: 20000 });
      // polygons belong to the recognized / conflict chips only
      await expect.poll(async () => (await ownFeatures()).length, { timeout: 20000, message: `${mr}: polygons` }).toBe(polygonStatusOK.has(mr) ? expected(recs) : 0);
      // "Show on map" marks every filtered parcel (capped at 300): drawn + "without geometry" must add up, and the
      // markers on the map must be the drawn ones. A parcel the portal has no outline for is reported, never silently lost.
      await page.getByRole("button", { name: "Show on map" }).first().click();
      const banner = page.getByText(/\d+ Parcels? Highlighted/).first();
      const readBanner = async () => {
        const t = ((await banner.locator("xpath=ancestor::*[self::div][2]").innerText().catch(() => "")) || "").replace(/\s+/g, " ");
        return { drawn: Number(/(\d+) Parcels? Highlighted/.exec(t)?.[1] ?? NaN), missing: Number(/(\d+) without (?:map )?geometry/.exec(t)?.[1] ?? 0) };
      };
      await expect.poll(async () => { const b = await readBanner(); return b.drawn + b.missing; }, { timeout: 600000, intervals: [5000], message: `${mr}: drawn + missing = filtered parcels` }).toBe(Math.min(n, 300));
      const b = await readBanner();
      expect(await app.evalMap((m) => m.getLayers().getArray().find((x: any) => x.get("name") === "plot-marker").getSource().getFeatures().length), `${mr}: markers on the map`).toBe(b.drawn);
      if (b.missing) test.info().annotations.push({ type: "note", description: `${mr}: ${b.missing} of ${Math.min(n, 300)} parcels have no outline on the portal` });
      await chip.click();
    }
    app.assertNoPageErrors();
  });
}
