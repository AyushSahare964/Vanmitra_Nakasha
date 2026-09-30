// Converts every data/cfr/*.xlsx (same layout as the Nagpur sheet) into src/data/cfr-approved.json.
// Run: node scripts/build-cfr-data.mjs   — add a district by dropping its sheet into data/cfr/.
import { readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const X = createRequire(import.meta.url)("xlsx");

const DEV = "०१२३४५६७८९";
const digits = (s) => String(s).replace(/[०-९]/g, (c) => DEV.indexOf(c));
const clean = (s) => String(s).replace(/\s+/g, " ").trim();
const SURVEY_TOKEN = /^\d{1,5}(\/[\dA-Za-zअ-ह]+)?[अ-ह]?$/;

/** Splits "289 स.नं. 17,2,3" style cells into survey tokens; odd tokens are reported, not guessed. */
function parseSurvey(raw) {
  let s = digits(raw);
  let comp = "";
  const m = s.split(/स\.?\s*नं\.?/);
  if (m.length > 1) {
    comp = m[0].replace(/[^\d]/g, "");
    s = m.slice(1).join(",");
  }
  const ok = [];
  const odd = [];
  for (let t of s.split(/[,\s]+|\bव\b/)) {
    t = t.replace(/^[().;:]+|[().;:]+$/g, "");
    if (!t) continue;
    if (SURVEY_TOKEN.test(t) && !/^\d{6,}$/.test(t)) ok.push(t.toLowerCase());
    else odd.push(t);
  }
  return { ok: [...new Set(ok)], odd, comp };
}

const rows = [];
const oddReport = [];
for (const f of readdirSync("data/cfr").filter((n) => n.endsWith(".xlsx"))) {
  const wb = X.readFile(`data/cfr/${f}`);
  const sheet = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  for (const r of sheet) {
    if (typeof r[0] !== "number" || typeof r[1] !== "string" || !r[1].trim() || typeof r[7] !== "number") continue;
    const { ok, odd, comp } = parseSurvey(r[5]);
    const dt = clean(r[8]);
    rows.push({
      d: clean(r[1]),
      t: clean(r[3]),
      v: clean(r[2]),
      p: clean(r[4]),
      s: ok,
      ...(comp ? { c: comp } : {}),
      ...(odd.length ? { o: odd } : {}),
      ac: Math.round(r[6] * 1e4) / 1e4,
      ha: Math.round(r[7] * 1e4) / 1e4,
      dt,
    });
    if (odd.length) oddReport.push(`${clean(r[1])} / ${clean(r[3])} / ${clean(r[2])}: ${odd.join(" | ")}`);
  }
}
mkdirSync("src/data", { recursive: true });
writeFileSync("src/data/cfr-approved.json", JSON.stringify(rows));
writeFileSync("data/cfr/odd-survey-tokens.txt", oddReport.join("\n") + "\n");
const ha = rows.reduce((a, r) => a + r.ha, 0);
console.log(`${rows.length} approvals, ${rows.reduce((a, r) => a + r.s.length, 0)} survey nos, ${ha.toFixed(2)} ha, ${oddReport.length} rows with odd tokens`);
