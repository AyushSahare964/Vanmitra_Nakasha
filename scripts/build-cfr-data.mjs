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

/**
 * Splits a "वनकक्ष क्र. / गट नं." cell into compartment tokens. The column also holds gat numbers, so ambiguous cells are
 * flagged (`am`) for the map to settle against MRSAC, and anything not parseable goes to `odd` instead of being dropped:
 *  "33 ते 77" -> range (<= 40 wide), "49.50 पैकी" / "88 पार्ट" -> part of that compartment (`pt`),
 *  "341/342" -> both numbers (a part of 2+ digits is its own compartment), "954/2" -> base 954, "61193" -> suspect (lost commas).
 */
function parseCompartments(raw) {
  const s = digits(raw ?? "").replace(/\s*ते\s*/g, "~");
  const k = [];
  const odd = [];
  let pt = false;
  let am = false;
  for (let t of s.split(/[,;&\s]+|व/)) {
    t = t.replace(/^(\d{1,4})\(\d+\)$/, "$1").replace(/^[().]+|[().]+$/g, "");
    if (!t) continue;
    if (/^(पैकी|पार्ट|भाग|ब|अ|क)$/.test(t)) { pt ||= !/^(ब|अ|क)$/.test(t); continue; }
    let m;
    if ((m = t.match(/^(\d{1,4})~(\d{1,4})$/)) && +m[2] > +m[1] && +m[2] - +m[1] <= 40) {
      for (let n = +m[1]; n <= +m[2]; n++) k.push(String(n));
      am = true;
    } else if (/^\d{1,4}([/.]\d+)+$/.test(t)) {
      // "954/2" is a sub-number of 954; "123/138/107" lists several compartments (a part of 2+ digits is its own number)
      const [first, ...rest] = t.split(/[/.]/);
      const more = rest.filter((x) => x.length >= 2 && x.length <= 4);
      k.push(first, ...more);
      if (more.length) am = true;
    } else if (/^\d{1,4}$/.test(t)) k.push(t);
    else odd.push(t);
  }
  return { k: [...new Set(k)], odd, pt, am };
}

/**
 * Nashik workbook: one sheet per taluka, columns found by header text (TBK has an extra date column, Peth says
 * "ग्रामपंचायत"). Rows carry forest compartment numbers + district-committee approved ha, no survey numbers.
 * Only "पात्र" (eligible) rows with area count as approvals; pending / rejected are returned for the report.
 */
function nashikRows(wb) {
  const out = [];
  const skipped = [];
  const review = [];
  for (const name of wb.SheetNames) {
    const sheet = X.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
    const h = (sheet[0] || []).map((x) => String(x).trim());
    const col = (re) => h.findIndex((x) => re.test(x));
    const [iV, iT, iK, iA, iS, iD] = [col(/गांव|ग्रामपंचायत/), col(/तालुका/), col(/वनकक्ष/), col(/जिल्हा समितीने/), col(/जिल्हा समितीचा/), col(/समिति स्थापन/)];
    const [iN, iF, iM, iP, iQ, iR] = [col(/दावेदार/), col(/सामुहिक हक्काचे/), col(/CFRMC स्थापन/), col(/अध्यक्ष/), col(/सचिव/), col(/खजिनदार/)];
    if (iV < 0 || iA < 0 || iS < 0) continue; // Summary / Sheet17 / MPR
    for (const r of sheet.slice(1)) {
      if (typeof r[0] !== "number" || (r[0] === 1 && r[1] === 2)) continue;
      const gs = clean(r[iN]);
      // A blank village cell used to drop the approval; fall back to the claimant ("ग्रामस्थ X" -> X).
      const v = clean(r[iV]) || gs.replace(/^(ग्रामस्त|ग्रामस्थ|ग्रामपंचायत)\s*/, "");
      const ha = Math.round((Number(r[iA]) || 0) * 1e4) / 1e4;
      const status = clean(r[iS]);
      if (!v || status !== "पात्र" || !ha) {
        if (v || status) skipped.push(`${name} / ${v || gs}: ${status || "(no decision)"}, ${ha} ha`);
        continue;
      }
      const c = parseCompartments(r[iK]);
      const ob = [["अध्यक्ष", iP], ["सचिव", iQ], ["खजिनदार", iR]].map(([l, i]) => (i >= 0 && clean(r[i]) ? `${l}: ${clean(r[i])}` : "")).filter(Boolean).join("; ");
      const row = {
        d: "नाशिक", t: NASHIK_TALUKA[clean(r[iT])] ?? clean(r[iT]), v, p: clean(r[iF]), s: [], k: c.k,
        ac: Math.round(ha * 2.47105 * 1e4) / 1e4, ha, dt: "",
        ...(gs ? { gs } : {}), ...(r[1] != null && r[1] !== "" ? { cn: clean(r[1]) } : {}),
        ...(iM >= 0 && clean(r[iM]) ? { cm: clean(r[iM]) } : {}), ...(ob ? { ob } : {}),
        ...(c.pt ? { pt: 1 } : {}), ...(c.am ? { am: 1 } : {}), ...(c.odd.length ? { o: c.odd } : {}),
      };
      if (!c.k.length) review.push(`${name} / ${gs || v}: NO COMPARTMENT (raw "${clean(r[iK])}"), ${ha} ha`);
      for (const o of c.odd) review.push(`${name} / ${gs || v}: UNPARSED "${o}" (raw "${clean(r[iK])}")`);
      if (c.am) review.push(`${name} / ${gs || v}: AMBIGUOUS compartment or gat "${clean(r[iK])}"`);
      out.push(row);
    }
  }
  return { out, skipped, review };
}

const rows = [];
const oddReport = [];
const nashikSkipped = [];
const nashikReview = [];
for (const f of readdirSync("data/cfr").filter((n) => n.endsWith(".xlsx"))) {
  if (/^nashik/i.test(f)) {
    const { out, skipped, review } = nashikRows(X.readFile(`data/cfr/${f}`));
    rows.push(...out);
    nashikSkipped.push(...skipped);
    nashikReview.push(...review);
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
writeFileSync("data/cfr/nashik-review.txt", nashikReview.join("\n") + "\n");
const ha = rows.reduce((a, r) => a + r.ha, 0);
console.log(`${rows.length} approvals, ${rows.reduce((a, r) => a + r.s.length, 0)} survey nos, ${ha.toFixed(2)} ha, ${oddReport.length} rows with odd tokens`);
