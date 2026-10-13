/**
 * Nashik CFR claims resolved to MRSAC forest polygons (public/data/cfr-comp/nashik.json, built offline by
 * scripts/build-comp-resolve.mjs). The compartment polygon is the primary CFR mark; this file also carries the
 * nearest-village allocation of polygons that several gram sabhas claim.
 */
import type { CfrRow } from "./cfr-data";

export type CompStatus = "inside" | "outside" | "taluka-unique" | "ambiguous" | "only-fdcm" | "notfound";

export interface CompRec {
  n: string; // compartment number
  st: CompStatus;
  g?: string; // gram sabha as written in the sheet
  t: string;
  v: string;
  cn?: string;
  pg?: string[]; // purpose groups (grazing / timber / cattle / other)
  h: number; // this claim's ha share of the compartment
  vc?: string; // MRSAC village code (village matched by name)
  vm?: "none" | "many"; // village not matched: located by number within the taluka
  fz?: 1; // village name matched approximately
  ids?: number[]; // MRSAC polygon ids
  rb?: string; // range · beat
  ha?: number; // polygon area (ha)
  km?: number; // distance from the village boundary (0 = inside)
  nv?: string; // village the polygon lies in
  al?: number; // ha allocated to this claim when the polygon is shared (nearest first)
  sh?: string[]; // every gram sabha claiming the polygon
  over?: number; // ha claimed beyond what the polygon can hold
  far?: 1; // claimant much farther than the nearest claimant
  tie?: string;
  /** Unconfirmed outline (no located compartment): fdcm = FDCM polygon with this number, cands = the candidate compartments, vforest = forest land inside the village. */
  wk?: "fdcm" | "cands" | "vforest";
  cands?: number;
  rbs?: string[];
}

export interface CompPoly {
  n: string;
  t: string;
  r: string;
  b: string;
  a: number;
  g: [number, number][][];
}

export interface CompData {
  radiusKm: number;
  claims: Record<string, CompRec[]>;
  polys: Record<string, CompPoly>;
}

export const claimKey = (r: Pick<CfrRow, "t" | "cn" | "v" | "sv">) => `${r.t}|${r.cn ?? ""}|${r.sv ?? r.v}`;

let pending: Promise<CompData | null> | null = null;
/** Loaded once; null when the file is missing so the caller falls back to the live MRSAC search. */
export function loadCompData(): Promise<CompData | null> {
  pending ??= fetch("/data/cfr-comp/nashik.json")
    .then((r) => (r.ok ? (r.json() as Promise<CompData>) : null))
    .catch(() => null);
  return pending;
}

/** Statuses whose polygon is a located compartment (the others are outlined as unconfirmed, see `wk`). */
export const DRAWN: CompStatus[] = ["inside", "outside", "taluka-unique"];

export const WEAK_TEXT = {
  fdcm: "MRSAC has this number only as FDCM (forest corporation) land: outlined, unconfirmed",
  cands: "Several compartments carry this number: all candidates outlined, unconfirmed",
  vforest: "This number is not in MRSAC: the outline is the forest land inside the village, unconfirmed",
} as const;

export const STATUS_TEXT: Record<CompStatus, string> = {
  inside: "inside the village",
  outside: "outside the village",
  "taluka-unique": "located by compartment number (village not matched)",
  ambiguous: "several compartments share this number: not drawn",
  "only-fdcm": "only an FDCM compartment has this number: not drawn",
  notfound: "not in MRSAC",
};

/** The sheet types some vowel signs as two (े + ा for ो: "आंबेाली"); show the proper spelling. */
const fixName = (s: string) => s.replace(/ेा/g, "ो").replace(/ैा/g, "ौ");

const bboxOf = (rings: [number, number][][]) => {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const r of rings) for (const [x, y] of r) (x < a && (a = x), y < b && (b = y), x > c && (c = x), y > d && (d = y));
  return [a, b, c, d] as const;
};

/** Gap in km between two degree boxes near Nashik. */
export function boxGapKm(p: readonly number[], q: readonly number[]) {
  const kx = 111.32 * Math.cos((20 * Math.PI) / 180);
  return Math.hypot(Math.max(0, p[0]! - q[2]!, q[0]! - p[2]!) * kx, Math.max(0, p[1]! - q[3]!, q[1]! - p[3]!) * 110.574);
}

export interface DrawnComp {
  ids: number[];
  n: string;
  names: string[]; // gram sabhas on this polygon, the selected village's first
  ha: number; // approved ha across the claims drawn here
  own: boolean;
  outside: boolean;
  km?: number | undefined;
  nv?: string | undefined;
  rb?: string | undefined;
  shared: boolean;
  flags: string[]; // over-claimed / far claim / located by number
  weak?: CompRec["wk"]; // unconfirmed outline
}

/**
 * The polygons to draw for a village: its own claims plus every other gram sabha's polygon within `radiusKm`
 * of the village boundary. Each polygon appears once with all its claimants.
 */
export function compsAround(data: CompData, rows: CfrRow[], villageRings: [number, number][][], radiusKm: number, purposes?: Set<string>): DrawnComp[] {
  const vb = bboxOf(villageRings);
  const mine = new Set(rows.map(claimKey));
  const byPoly = new Map<string, DrawnComp>();
  for (const [key, recs] of Object.entries(data.claims))
    for (const rec of recs) {
      if (!rec.ids?.length || (!DRAWN.includes(rec.st) && !rec.wk)) continue;
      if (purposes?.size && !rec.pg?.some((g) => purposes.has(g))) continue;
      const own = mine.has(key);
      if (!own) {
        if (!villageRings.length) continue; // village outline not available: own claims only
        const near = rec.ids.some((id) => {
          const p = data.polys[id];
          return p && boxGapKm(bboxOf(p.g), vb) <= radiusKm;
        });
        if (!near) continue;
      }
      const pk = (rec.wk ? "w:" : "") + rec.ids.slice().sort((a, b) => a - b).join(",");
      const cur =
        byPoly.get(pk) ??
        ({ ids: rec.ids, n: rec.n, names: [], ha: 0, own: false, outside: false, km: rec.km, nv: rec.nv, rb: rec.rb, shared: false, flags: [], ...(rec.wk ? { weak: rec.wk } : {}) } as DrawnComp);
      const name = fixName(rec.g || rec.v);
      if (own) cur.names.unshift(name);
      else cur.names.push(name);
      cur.names = [...new Set(cur.names)];
      cur.ha += rec.wk ? rec.h : (rec.al ?? rec.h);
      cur.own ||= own;
      if (own) (cur.outside = cur.outside || rec.st === "outside"), (cur.km = rec.km);
      cur.shared = cur.names.length > 1;
      if (rec.over && !cur.flags.includes("over-claimed")) cur.flags.push("over-claimed");
      if (rec.far && own && !cur.flags.includes("far claim")) cur.flags.push("far claim");
      if (rec.st === "taluka-unique" && own && !cur.flags.includes("located by number")) cur.flags.push("located by number");
      byPoly.set(pk, cur);
    }
  return [...byPoly.values()];
}

/** Per-claim rows for the panel: status, distance, where it lies. */
export function claimsOf(data: CompData, rows: CfrRow[]) {
  return rows.flatMap((r) => (data.claims[claimKey(r)] ?? []).map((rec) => ({ row: r, rec })));
}

/**
 * ArcGIS rings to GeoJSON polygons: clockwise rings are outer boundaries, counter-clockwise rings are holes in the
 * outer ring that contains them (so a compartment with an enclave is drawn with the enclave cut out).
 */
export function ringsToPolygons(rings: [number, number][][]): [number, number][][][] {
  const area = (r: [number, number][]) => r.reduce((s, p, i) => s + (r[(i + 1) % r.length]![0] - p[0]) * (r[(i + 1) % r.length]![1] + p[1]), 0); // > 0 = clockwise
  const inRing = (x: number, y: number, r: [number, number][]) => {
    let o = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i]![1] > y !== r[j]![1] > y && x < ((r[j]![0] - r[i]![0]) * (y - r[i]![1])) / (r[j]![1] - r[i]![1]) + r[i]![0]) o = !o;
    return o;
  };
  const polys: [number, number][][][] = [];
  const holes: [number, number][][] = [];
  for (const r of rings) (area(r) > 0 ? polys.push([r]) : holes.push(r));
  for (const h of holes) {
    const host = polys.find((p) => inRing(h[0]![0], h[0]![1], p[0]!)) ?? null;
    if (host) host.push(h);
    // a hole with no outer ring (broken geometry) is dropped rather than drawn as land
  }
  return polys.length ? polys : rings.map((r) => [r]);
}
