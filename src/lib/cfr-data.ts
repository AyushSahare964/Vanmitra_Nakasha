/**
 * Recognized-CFR data (from data/cfr/*.xlsx, built by scripts/build-cfr-data.mjs) and the
 * rules that turn it into a per-parcel CFR status.
 *
 * Recognition comes only from the spreadsheet. "forest" / "govt" are CANDIDATES inferred
 * from the 7/12 holder name — not legal eligibility — and the UI labels them that way.
 */
import { tokenize, tokenNorm } from "./marathi-search";
import type { Category } from "./land-categories";

export interface CfrRow {
  d: string; // district
  t: string; // taluka
  v: string; // village
  p: string; // purpose
  s: string[]; // clean survey numbers
  c?: string; // compartment prefix ("289 स.नं. 17,2…")
  o?: string[]; // tokens that could not be parsed
  ac: number;
  ha: number;
  dt: string; // approval date dd.mm.yyyy
  /** derived at load */
  g: PurposeGroup[];
  y: string;
}

export type PurposeGroup = "grazing" | "timber" | "cattle" | "other";
export const PURPOSE_GROUPS: { key: PurposeGroup; label: string; mr: string }[] = [
  { key: "grazing", label: "Grazing", mr: "चराई" },
  { key: "timber", label: "Timber & fuel", mr: "लाकूड" },
  { key: "cattle", label: "Cattle / burial ground", mr: "गुरे/दफन" },
  { key: "other", label: "Other", mr: "इतर" },
];

function purposeGroups(p: string): PurposeGroup[] {
  const g: PurposeGroup[] = [];
  if (/चराई|कुरण/.test(p)) g.push("grazing");
  if (/लाकू|लाकड|झाड|इमारती|जळावू/.test(p)) g.push("timber");
  if (/गुरे|मुरदे|गाडण|उधड|उधळ|स्मशान|खातकुडा/.test(p)) g.push("cattle");
  return g.length ? g : ["other"];
}

export type CfrStatus = "recognized" | "forest" | "govt" | "other";

export const CFR_STATUSES: { key: CfrStatus; en: string; mr: string; color: string }[] = [
  { key: "recognized", en: "Recognized", mr: "मान्य", color: "#7c3aed" },
  { key: "forest", en: "Forest candidate", mr: "वन", color: "#15803d" },
  { key: "govt", en: "Govt candidate", mr: "शासकीय", color: "#ca8a04" },
  { key: "other", en: "Other", mr: "इतर", color: "#a8a29e" },
];

/** Candidates come from the 7/12 category; only non-recognized parcels can be candidates. */
export function cfrStatusOf(recognized: boolean, category: Category, inForestCompartment = false): CfrStatus {
  if (recognized) return "recognized";
  if (category === "forest" || inForestCompartment) return "forest";
  if (category === "government") return "govt";
  return "other";
}

/* ---------- name keys: portal and spreadsheet spell the same place differently ---------- */

// Latin text is dropped: the portal may print "नाव / Name", the sheet is Marathi only.
/** Collapses spellings the portal and the sheet disagree on (गांव/गाव, ळ/ल, ण/न, ी/ि, ू/ु …). */
const canon = (s: string) =>
  s
    .replace(/[A-Za-z]+/g, " ")
    // Portal suffixes: "त.सा.क्र. 58 अ" (talathi saja no.), "(44)", "(68अ)".
    .replace(/त\.?\s*सा\.?\s*क्र\.?\s*[0-9०-९]*(?:\s*[अ-ह](?![ा-ौ]))?/g, " ")
    .replace(/\(\s*[0-9०-९]+\s*[अ-ह]?\s*\)/g, " ")
    .replace(/[0-9०-९]+/g, " ")
    // Qualifiers written in full in one source and abbreviated in the other.
    .replace(/रिठी|रि\./g, " रि ")
    .replace(/खुर्द|खु\./g, " खु ")
    .replace(/बुद्रुक|बु\./g, " बु ")
    .replace(/[ंँ़्]/g, "")
    .replace(/[ीई]/g, (c) => (c === "ी" ? "ि" : "इ"))
    .replace(/[ूऊ]/g, (c) => (c === "ू" ? "ु" : "उ"))
    .replace(/[ळ]/g, "ल")
    .replace(/[ण]/g, "न")
    .replace(/[शष]/g, "स");

const words = (s: string) => tokenize(canon(s)).map(tokenNorm).filter(Boolean).join(" ");

export const districtKey = words;
/** Taluka names repeat across districts, so the index is keyed district|taluka. */
export const taluKey = (district: string, taluka: string) => `${words(district)}|${talukaKey(taluka)}`;

/** "नागपूर (ग्रामीण)" and "नागपूर ग्रामिण " both become "nagpur". */
export const talukaKey = (s: string) => words(s.replace(/\([^)]*\)/g, " ").replace(/ग्रामि?ण|ग्रामीण/g, " "));

/** [full, base]: base drops bracketed qualifiers, so "टेकाडी (कान्हा)" also answers to "टेकाडी". */
export const villageKeys = (s: string): string[] => {
  const full = words(s);
  const base = words(s.replace(/\([^)]*\)/g, " "));
  return base && base !== full ? [full, base] : [full];
};

/** Edit distance ≤ 1 (substitution, insertion or deletion). */
function withinOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/**
 * Exact key first; otherwise a single near-miss (one letter off — केसलापार / केसलापूर).
 * Ambiguous near-misses return undefined rather than guessing.
 */
export function fuzzyGet<T>(m: Map<string, T>, key: string): T | undefined {
  if (m.has(key)) return m.get(key);
  const compact = key.replace(/ /g, "");
  if (compact.length < 5) return undefined;
  let hit: T | undefined;
  let n = 0;
  for (const [k, v] of m) {
    if (withinOne(k.replace(/ /g, ""), compact) && (++n, (hit = v), n > 1)) return undefined;
  }
  return n === 1 ? hit : undefined;
}

/* ---------- index ---------- */

export interface CfrIndex {
  rows: CfrRow[];
  /** taluKey(district, taluka) -> villageKey -> rows */
  byTaluka: Map<string, Map<string, CfrRow[]>>;
  /** Names as printed in the sheet, for the "not found in portal" report. */
  talukaNames: Map<string, string>;
}

let loading: Promise<CfrIndex> | null = null;

/** Lazy: the ~40 KB gz JSON is only pulled when the CFR panel is first opened. */
export function loadCfrData(): Promise<CfrIndex> {
  loading ||= import("@/data/cfr-approved.json").then((m) => {
    const rows = (m.default as unknown as Omit<CfrRow, "g" | "y">[]).map(
      (r) => ({ ...r, g: purposeGroups(r.p), y: r.dt.slice(-4) }) as CfrRow
    );
    const byTaluka: CfrIndex["byTaluka"] = new Map();
    const talukaNames: CfrIndex["talukaNames"] = new Map();
    for (const r of rows) {
      const tk = taluKey(r.d, r.t);
      talukaNames.set(tk, r.t.replace(/\s*ग्रामिण\s*/, " ").trim());
      const vill = byTaluka.get(tk) ?? new Map<string, CfrRow[]>();
      byTaluka.set(tk, vill);
      for (const k of villageKeys(r.v)) vill.set(k, [...(vill.get(k) ?? []), r]);
    }
    return { rows, byTaluka, talukaNames };
  });
  return loading;
}

export const hasDistrict = (idx: CfrIndex, district: string) =>
  idx.rows.some((r) => words(r.d) === words(district));

export function villagesOfTaluka(idx: CfrIndex, district: string, taluka: string): Map<string, CfrRow[]> {
  return idx.byTaluka.get(taluKey(district, taluka)) ?? new Map();
}

/** Base keys shared by two or more portal villages of one taluka (e.g. two "सावंगी"). */
export function duplicateKeys(portalNames: string[]): Set<string> {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const n of portalNames) {
    for (const k of villageKeys(n)) (seen.has(k) ? dup : seen).add(k);
  }
  return dup;
}

/**
 * Rows for a portal village. A name the portal lists twice cannot be told apart from the
 * sheet, so it returns nothing rather than marking the wrong village's parcels as CFR.
 */
export function rowsForVillage(
  idx: CfrIndex,
  district: string,
  taluka: string,
  village: string,
  dup?: Set<string>
): CfrRow[] {
  const vill = idx.byTaluka.get(taluKey(district, taluka));
  if (!vill) return [];
  for (const k of villageKeys(village)) {
    const hit = fuzzyGet(vill, k);
    if (hit) return dup?.has(k) ? [] : [...new Set(hit)];
  }
  return [];
}

/* ---------- survey matching ---------- */

export interface RecognizedLookup {
  exact: Map<string, CfrRow>;
  /** Survey nos. listed without a sub-number; they cover every "n/x" child. */
  parent: Map<string, CfrRow>;
}

export function buildRecognizedLookup(rows: CfrRow[]): RecognizedLookup {
  const exact = new Map<string, CfrRow>();
  const parent = new Map<string, CfrRow>();
  for (const r of rows) {
    for (const s of r.s) {
      exact.set(s, r);
      if (!s.includes("/")) parent.set(s, r);
    }
  }
  return { exact, parent };
}

/** `100` covers `100/1`, `100/2`; `100/1` covers only `100/1`. */
export function matchRecognized(lk: RecognizedLookup, plotno: string): CfrRow | undefined {
  const p = String(plotno).trim().toLowerCase();
  return lk.exact.get(p) ?? (p.includes("/") ? lk.parent.get(p.split("/")[0]!) : undefined);
}

/** Survey numbers in the sheet that no parcel of the village matched (data-quality signal). */
export function unmatchedSurveys(rows: CfrRow[], plotnos: string[]): string[] {
  const have = new Set(plotnos.map((p) => String(p).trim().toLowerCase()));
  const parents = new Set([...have].map((p) => p.split("/")[0]!));
  const out: string[] = [];
  for (const r of rows)
    for (const s of r.s) if (!have.has(s) && !(!s.includes("/") && parents.has(s))) out.push(s);
  return [...new Set(out)];
}
