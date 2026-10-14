import fs from "node:fs";
import path from "node:path";
import { test } from "./fixtures";

/**
 * Calibration sweep: for the two biggest drawn-claim villages of every Nashik taluka, records what the forest /
 * cadastral offset measurement found (best shift, agreement before / after, forest-held parcels). Not an assertion
 * suite: the output (test-results/calib-sweep.jsonl) is what the acceptance thresholds in forest-align.ts are set from.
 */
const R = (f: string) => JSON.parse(fs.readFileSync(path.resolve(process.cwd(), f), "utf8"));
const rows: any[] = R("src/data/cfr-approved.json").filter((r: any) => r.d === "नाशिक");
const comp = R("public/data/cfr-comp/nashik.json");
const portal: { value: string; villages: { value: string }[] }[] = R("public/data/bn/R-20.json");
const PORTAL_TALUKA: Record<string, string> = { मालेगांव: "मालेगाव" };
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const drawnCount = (r: any) => ((comp.claims[`${r.t}|${r.cn ?? ""}|${r.v}`] ?? []) as any[]).filter((c) => c.ids).length;

const picks: { portalTaluka: string; village: string }[] = [];
for (const t of new Set(rows.map((r) => r.t))) {
  const pt = portal.find((x) => x.value === (PORTAL_TALUKA[t] ?? t));
  if (!pt) continue;
  const by = new Map<string, number>();
  for (const r of rows.filter((x) => x.t === t)) {
    const pv = r.pv ?? r.v;
    if (pt.villages.filter((v) => v.value === pv).length === 1) by.set(pv, (by.get(pv) ?? 0) + drawnCount(r));
  }
  [...by.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 2).forEach(([v]) => picks.push({ portalTaluka: pt.value, village: v }));
}

const OUT = path.resolve(process.cwd(), "test-results/calib-sweep.jsonl");

test("calibration sweep", async ({ app, page }) => {
  test.setTimeout(3_600_000);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, "");
  for (const p of picks) {
    let rec: any = { taluka: p.portalTaluka, village: p.village };
    try {
      await app.open();
      await app.openPanel("CFR");
      const s = app.selects();
      await app.pick(s.nth(1), /नाशिक|Nashik/i);
      await app.pick(s.nth(2), new RegExp("^" + esc(p.portalTaluka) + "\\s*●"));
      await app.pick(s.nth(3), new RegExp("^" + esc(p.village) + "\\s*●"));
      let last = "";
      let stable = 0;
      let m: any = null;
      for (let i = 0; i < 50 && stable < 4; i++) {
        await page.waitForTimeout(4000);
        m = await page.evaluate(() => (window as any).__vmForestMeasure ?? null);
        const sig = JSON.stringify(m);
        stable = m && sig === last ? stable + 1 : 0;
        last = sig;
      }
      const adoptedShift = await page.evaluate(() => (window as any).__vmForestShift ?? null);
      rec = { ...rec, measure: m, adoptedShift };
    } catch (e) {
      rec.error = String((e as Error).message).slice(0, 160);
    }
    fs.appendFileSync(OUT, JSON.stringify(rec) + "\n");
    console.log("CALIB", JSON.stringify(rec));
  }
});
