// Gives every Nashik approval a village the portal dropdown can find, so no gram sabha's land is left unmarked.
// A sheet village is unreachable when the MahaBhuNakasha list has no such name (hamlets / padas, spelling) or lists it twice.
// For those rows the MRSAC village the claim resolved to supplies the portal name (`pv`), and the evidence is kept (`pvh`).
// Run after build-cfr-data.mjs and build-comp-resolve.mjs:   bun scripts/build-village-alias.ts
import { readFileSync, writeFileSync } from "node:fs";
import { taluKey, villageKeys, rowsForVillage, duplicateKeys, type CfrIndex, type CfrRow } from "../src/lib/cfr-data";

const PATH = "src/data/cfr-approved.json";
const all = JSON.parse(readFileSync(PATH, "utf8")) as (CfrRow & { pv?: string; pvh?: string })[];
for (const r of all) (delete r.pv, delete r.pvh);
const rows = all.filter((r) => r.d === "नाशिक");

const snap = JSON.parse(readFileSync("public/data/bn/R-20.json", "utf8")) as { value: string; villages: { value: string }[] }[];
const comp = JSON.parse(readFileSync("public/data/cfr-comp/nashik.json", "utf8")) as { claims: Record<string, { n: string; st: string; vc?: string; nv?: string; km?: number; ids?: number[]; wk?: string }[]> };
const mv = new Map((JSON.parse(readFileSync("data/mrsac/villages.json", "utf8")) as any[]).map((f) => [String(f.attributes.VINCODE), String(f.attributes.VLMNAME)]));

const index = (rs: CfrRow[]): CfrIndex => {
  const byTaluka: CfrIndex["byTaluka"] = new Map();
  for (const r of rs) {
    const tk = taluKey(r.d, r.t);
    const m = byTaluka.get(tk) ?? new Map();
    byTaluka.set(tk, m);
    for (const k of villageKeys(r.v)) m.set(k, [...(m.get(k) ?? []), r]);
  }
  return { rows: rs, byTaluka, talukaNames: new Map() } as CfrIndex;
};
const idx = index(rows);

const report: string[] = [];
let fixed = 0, left = 0;
for (const t of snap) {
  const trows = rows.filter((r) => taluKey(r.d, r.t) === taluKey("नाशिक", t.value));
  if (!trows.length) continue;
  const dup = duplicateKeys(t.villages.map((v) => v.value));
  const reached = new Set<CfrRow>();
  for (const v of t.villages) for (const r of rowsForVillage(idx, "नाशिक", t.value, v.value, dup)) reached.add(r);
  // portal village a name points to (unique, not listed twice), tried with the same keys and one-letter tolerance the app uses
  const portalFor = (name: string) => {
    const probe = index([{ d: "नाशिक", t: t.value, v: name, p: "", s: [], ac: 0, ha: 0, dt: "", g: [], y: "" } as CfrRow]);
    const hits = t.villages.filter((v) => rowsForVillage(probe, "नाशिक", t.value, v.value, dup).length);
    return hits.length === 1 ? hits[0]!.value : null;
  };
  for (const r of trows.filter((x) => !reached.has(x))) {
    const key = `${r.t}|${r.cn ?? ""}|${r.v}`;
    const recs = comp.claims[key] ?? [];
    const cands: [string, string][] = [];
    for (const c of recs) if (c.vc && mv.get(c.vc)) cands.push([mv.get(c.vc)!, "MRSAC village match"]);
    for (const c of recs) if (c.nv && (c.st === "inside" || c.st === "outside" || c.st === "taluka-unique") && !c.wk) cands.push([c.nv, "village holding the compartment"]);
    const hit = cands.map(([n, how]) => [portalFor(n), how] as const).find(([pv]) => pv);
    const target = all.find((a) => a === r)!;
    if (hit && hit[0] && hit[0] !== r.v) (target.pv = hit[0]), (target.pvh = hit[1]), fixed++;
    else (left++, report.push(`${t.value} / ${r.gs || r.v} (${r.ha} ha): ${dup.has(villageKeys(r.v)[0]!) ? "portal lists this name twice" : "no portal village found"}`));
  }
}
writeFileSync(PATH, JSON.stringify(all));
writeFileSync("data/cfr/nashik-alias-review.txt", report.join("\n") + "\n");
console.log(`rows now reachable by an alias: ${fixed}; still unreachable: ${left} (data/cfr/nashik-alias-review.txt)`);
