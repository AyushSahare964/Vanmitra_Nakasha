// Converts public/data/mh_cfr_potential_villages.xlsx into public/data/mh_cfr_potential_villages.json so the
// browser downloads ~1 MB of JSON instead of parsing a 2 MB workbook on the main thread (a ~1 s freeze).
// Run: node scripts/build-village-list.mjs   — rerun whenever the xlsx changes.
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const X = createRequire(import.meta.url)("xlsx");

const wb = X.readFile("public/data/mh_cfr_potential_villages.xlsx");
const rows = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
const out = rows.map((r) => ({
  district: String(r["District"] ?? ""),
  subdistrict: String(r["Subdistrict"] ?? ""),
  gramPanchayat: String(r["Gram Panchayat"] ?? ""),
  // one source row (code 525102) has no village name; fall back to its gram panchayat so it can still be found
  village: String(r["Village"] ?? "").trim() || (r["Gram Panchayat"] ? `${r["Gram Panchayat"]} (name missing in source)` : `Village ${r["Village Code 2011"]}`),
  villageCode: String(r["Village Code 2011"] ?? ""),
  totalAreaHa: Number(r["Total Geographical Area (ha)"] ?? 0),
  gisAreaHa: Number(r["Calculated GIS Area (ha)"] ?? 0),
  households: Number(r["Total Households"] ?? 0),
  population: Number(r["Total Population"] ?? 0),
  villageType: String(r["Village Type"] ?? ""),
  cfrType: String(r["CFR Type"] ?? ""),
  forestInsideHa: Number(r["Forest inside revenue boundary (ha)"] ?? 0),
  potentialCfrHa: Number(r["Potential CFR area in 2 Km buffer (ha)"] ?? 0),
  totalCfrPotentialHa: Number(r["Total CFR potential (ha) (Forest inside revenue boundary + Forest in 2 km buffer)"] ?? 0),
}));
writeFileSync("public/data/mh_cfr_potential_villages.json", JSON.stringify(out));
console.log(`${out.length} villages -> public/data/mh_cfr_potential_villages.json`);
