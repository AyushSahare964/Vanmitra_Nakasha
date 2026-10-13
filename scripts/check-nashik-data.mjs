// Count check for the Nashik CFR build: run after build-cfr-data.mjs and build-comp-resolve.mjs.
// Fails if an approved row in the workbook is missing from the app data, a row lacks its gram sabha, or a resolved
// claim points at a polygon that is not in the output.   node scripts/check-nashik-data.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const X = createRequire(import.meta.url)("xlsx");

const wb = X.readFile("data/cfr/nashik.xlsx");
let eligible = 0, eligibleHa = 0;
for (const n of wb.SheetNames) {
  const rows = X.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "" });
  const h = (rows[0] || []).map((x) => String(x).trim());
  const iA = h.findIndex((x) => /जिल्हा समितीने/.test(x)), iS = h.findIndex((x) => /जिल्हा समितीचा/.test(x)), iN = h.findIndex((x) => /दावेदार/.test(x)), iV = h.findIndex((x) => /गांव|ग्रामपंचायत/.test(x));
  if (iA < 0 || iS < 0) continue;
  for (const r of rows.slice(1)) {
    if (typeof r[0] !== "number" || (r[0] === 1 && r[1] === 2)) continue;
    const ha = Number(r[iA]) || 0;
    if (String(r[iS]).trim() === "पात्र" && ha && (String(r[iV]).trim() || String(r[iN]).trim())) (eligible++, (eligibleHa += ha));
  }
}
const app = JSON.parse(readFileSync("src/data/cfr-approved.json", "utf8")).filter((r) => r.d === "नाशिक");
const appHa = app.reduce((a, r) => a + r.ha, 0);
assert.equal(app.length, eligible, `workbook has ${eligible} approved rows, app data has ${app.length}`);
assert.ok(Math.abs(appHa - eligibleHa) < 0.01, `ha differ: sheet ${eligibleHa} vs app ${appHa}`);
assert.ok(app.every((r) => r.gs), "every row needs its gram sabha name (gs)");

const comp = JSON.parse(readFileSync("public/data/cfr-comp/nashik.json", "utf8"));
let recs = 0;
for (const [k, list] of Object.entries(comp.claims))
  for (const r of list) {
    recs++;
    for (const id of r.ids ?? []) assert.ok(comp.polys[id], `claim ${k} comp ${r.n}: polygon ${id} missing`);
  }
const wanted = app.reduce((a, r) => a + new Set((r.k ?? []).map((x) => x.split(/[/.]/)[0].replace(/^0+(?=\d)/, ""))).size, 0);
assert.equal(recs, wanted, `resolver has ${recs} claim records, rows list ${wanted} compartments`);
console.log(`ok: ${eligible} approved rows (${eligibleHa.toFixed(1)} ha), ${recs} compartment claims resolved or listed`);
