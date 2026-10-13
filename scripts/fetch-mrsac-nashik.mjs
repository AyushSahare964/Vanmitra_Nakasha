// Downloads the MRSAC layers the Nashik CFR resolver needs, once, so build-comp-resolve.mjs runs offline:
//   villages (district 516, Marathi + English names) and forest / wildlife compartments around the district.
// Run: node scripts/fetch-mrsac-nashik.mjs   — resumable: finished files in data/mrsac/ are skipped (delete to refresh).
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

const G = "https://gsc.mrsac.org.in/webadpgis1/rest/services";
const OUT = "data/mrsac";
mkdirSync(OUT, { recursive: true });
// District envelope + ~0.15 deg (about 15 km) so villages on the edge still see their 10 km neighbours.
const ENV = "73.15,19.15,75.35,21.15";

async function q(url, params) {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params), signal: AbortSignal.timeout(120000) });
      const j = await r.json();
      if (!j.error) return j;
      console.log("  server error:", j.error.message);
    } catch (e) {
      console.log("  retry:", e.message);
    }
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  throw new Error("MRSAC not responding: " + url);
}

async function paged(file, url, params, page = 500) {
  const path = `${OUT}/${file}`;
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  const all = [];
  for (let off = 0; ; off += page) {
    const j = await q(url, { ...params, resultOffset: String(off), resultRecordCount: String(page), orderByFields: "OBJECTID" });
    all.push(...(j.features ?? []));
    console.log(`${file}: ${all.length}`);
    if (!j.exceededTransferLimit && (j.features ?? []).length < page) break;
  }
  writeFileSync(path, JSON.stringify(all));
  return all;
}

const base = { f: "json", inSR: "4326", outSR: "4326", returnGeometry: "true", maxAllowableOffset: "0.0001" };
await paged("villages.json", `${G}/admin/village_boundary/MapServer/0/query`, { ...base, where: "DTNCODE='516'", outFields: "THNCODE,VINCODE,VIL_NAME,VLMNAME,GPNCODE" }, 300);
for (const [file, id] of [["forest.json", 5], ["wildlife.json", 12]])
  await paged(file, `${G}/gatishakti/mh_forest/MapServer/${id}/query`, { ...base, where: "1=1", geometry: ENV, geometryType: "esriGeometryEnvelope", spatialRel: "esriSpatialRelIntersects", outFields: "OBJECTID,COMP_NO,COMP_TYPE,CATEGORY,RANGE,BEAT,ShpAreaHa", maxAllowableOffset: "0.00005" }, 400);
console.log("done");
