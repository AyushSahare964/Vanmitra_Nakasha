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

/** Sheet taluka spellings that differ from the MahaBhuNakasha portal list, so the panel finds them. */
const NASHIK_TALUKA = { बागलाण: "बागलन", त्र्यंबकेश्वर: "त्रिंबक" };

/** Splits "219, 202" / "24/2, 112,113" compartment cells into tokens. Not survey numbers: these are forest compartments. */
const parseCompartments = (raw) =>
  [...new Set(digits(raw).split(/[,;&\s]+|व/).map((t) => t.replace(/^[().]+|[().]+$/g, "")).filter((t) => /^\d{1,4}([/.]\d+)*$/.test(t)))];

/**
 * Nashik workbook: one sheet per taluka, columns found by header text (TBK has an extra date column, Peth says
 * "ग्रामपंचायत"). Rows carry forest compartment numbers + district-committee approved ha, no survey numbers.
 * Only "पात्र" (eligible) rows with area count as approvals; pending / rejected are returned for the report.
 */
function nashikRows(wb) {
  const out = [];
  const skipped = [];
  for (const name of wb.SheetNames) {
    const sheet = X.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
    const h = (sheet[0] || []).map((x) => String(x).trim());
    const col = (re) => h.findIndex((x) => re.test(x));
    const [iV, iT, iK, iA, iS, iD] = [col(/गांव|ग्रामपंचायत/), col(/तालुका/), col(/वनकक्ष/), col(/जिल्हा समितीने/), col(/जिल्हा समितीचा/), col(/समिति स्थापन/)];
    if (iV < 0 || iA < 0 || iS < 0) continue; // Summary / Sheet17 / MPR
    for (const r of sheet.slice(1)) {
      const v = clean(r[iV]);
      if (!v || typeof r[0] !== "number" || r[0] === 1 && r[1] === 2) continue;
      const ha = Math.round((Number(r[iA]) || 0) * 1e4) / 1e4;
      const status = clean(r[iS]);
      if (status !== "पात्र" || !ha) {
        skipped.push(`${name} / ${v}: ${status || "(no decision)"}, ${ha} ha`);
        continue;
      }
      out.push({ d: "नाशिक", t: NASHIK_TALUKA[clean(r[iT])] ?? clean(r[iT]), v, p: clean(r[5 + (iD >= 0 ? 1 : 0)]), s: [], k: parseCompartments(r[iK]), ac: Math.round(ha * 2.47105 * 1e4) / 1e4, ha, dt: "" });
    }
  }
  return { out, skipped };
}

const rows = [];
const oddReport = [];
const nashikSkipped = [];
for (const f of readdirSync("data/cfr").filter((n) => n.endsWith(".xlsx"))) {
  if (/^nashik/i.test(f)) {
    const { out, skipped } = nashikRows(X.readFile(`data/cfr/${f}`));
    rows.push(...out);
    nashikSkipped.push(...skipped);
    continue;
  }
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
writeFileSync("data/cfr/nashik-not-approved.txt", nashikSkipped.join("\n") + "\n");
const ha = rows.reduce((a, r) => a + r.ha, 0);
console.log(`${rows.length} approvals, ${rows.reduce((a, r) => a + r.s.length, 0)} survey nos, ${ha.toFixed(2)} ha, ${oddReport.length} rows with odd tokens`);
