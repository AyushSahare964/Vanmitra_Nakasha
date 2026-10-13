// Resolves every Nashik CFR claim (village + compartment number) to MRSAC forest polygons, offline.
// Needs data/mrsac/*.json (node scripts/fetch-mrsac-nashik.mjs) and src/data/cfr-approved.json (build-cfr-data.mjs).
// Writes public/data/cfr-comp/nashik.json: per claim the polygon(s) found, how (inside / outside / taluka-unique /
// ambiguous / notfound), the distance from the village boundary, and the nearest-village allocation of shared polygons.
// Run: node scripts/build-comp-resolve.mjs   (prints a summary; review lines go to data/cfr/nashik-resolve-review.txt)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const RADIUS_KM = 10; // measured from the village boundary
const SLIVER_KM = 1.5; // polygons of one number closer than this are one compartment (slivers + main body)
const TIE_KM = 1.0; // two candidate compartments this close in distance are "ambiguous", never guessed
const FAR_GAP_KM = 3; // a claimant this much farther than the nearest claimant of a shared polygon is flagged

// MRSAC taluka codes (district 516), found by voting the matched villages of each sheet.
const TALUKA_CODE = { नाशिक: "04152", दिंडोरी: "04149", पेठ: "04150", ईगतपुरी: "04153", त्रिंबक: "04151", सुरगाणा: "04142", चांदवड: "04148", कळवण: "04143", देवळा: "04144", मालेगांव: "04146", बागलन: "04145", नांदगाव: "04147" };

const load = (f) => JSON.parse(readFileSync(`data/mrsac/${f}`, "utf8"));
const villages = load("villages.json").map((f) => ({ ...f.attributes, rings: f.geometry.rings }));
const polys = [...load("forest.json"), ...load("wildlife.json")].map((f) => ({ ...f.attributes, rings: f.geometry.rings }));
const claims = JSON.parse(readFileSync("src/data/cfr-approved.json", "utf8")).filter((r) => r.d === "नाशिक");

/* ---------- geometry (local metres) ---------- */
const LAT0 = 20, KX = 111320 * Math.cos((LAT0 * Math.PI) / 180), KY = 110574;
const proj = (rings) => rings.map((r) => r.map(([x, y]) => [(x - 73) * KX, (y - LAT0) * KY]));
const bbox = (rings) => {
  let a = 1e12, b = 1e12, c = -1e12, d = -1e12;
  for (const r of rings) for (const [x, y] of r) (x < a && (a = x), y < b && (b = y), x > c && (c = x), y > d && (d = y));
  return [a, b, c, d];
};
const gap = (p, q) => Math.hypot(Math.max(0, p[0] - q[2], q[0] - p[2]), Math.max(0, p[1] - q[3], q[1] - p[3]));
const inRing = (x, y, r) => {
  let o = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i][1] > y !== r[j][1] > y && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) o = !o;
  return o;
};
const inside = (x, y, rings) => rings.filter((r) => inRing(x, y, r)).length % 2 === 1;
const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
const ptToRings = (x, y, rings) => {
  let m = Infinity;
  for (const r of rings) for (let i = 1; i < r.length; i++) m = Math.min(m, segDist(x, y, r[i - 1][0], r[i - 1][1], r[i][0], r[i][1]));
  return m;
};
/** Metres between two shapes: 0 when they touch or overlap (vertex-based; edges are simplified to ~10 m). */
function dist(a, b) {
  for (const r of a) for (const [x, y] of r) if (inside(x, y, b)) return 0;
  for (const r of b) for (const [x, y] of r) if (inside(x, y, a)) return 0;
  let m = Infinity;
  for (const r of a) for (const [x, y] of r) m = Math.min(m, ptToRings(x, y, b));
  for (const r of b) for (const [x, y] of r) m = Math.min(m, ptToRings(x, y, a));
  return m;
}

for (const v of villages) (v.m = proj(v.rings)), (v.bb = bbox(v.m));
for (const p of polys) {
  p.m = proj(p.rings);
  p.bb = bbox(p.m);
  p.base = (String(p.COMP_NO ?? "").trim().match(/^\d+/)?.[0] ?? "").replace(/^0+(?=\d)/, "");
  const big = p.m.reduce((a, r) => (r.length > a.length ? r : a), p.m[0]);
  p.c = [big.reduce((s, q) => s + q[0], 0) / big.length, big.reduce((s, q) => s + q[1], 0) / big.length];
  if (!inside(p.c[0], p.c[1], p.m)) p.c = p.m[0][0];
  // the village that holds it (taluka restriction + "lies in <village>" label)
  const hit = villages.find((v) => p.c[0] >= v.bb[0] && p.c[0] <= v.bb[2] && p.c[1] >= v.bb[1] && p.c[1] <= v.bb[3] && inside(p.c[0], p.c[1], v.m));
  p.vil = hit;
}
const isFdcm = (p) => /fdcm/i.test(p.COMP_TYPE);
const NON_FOREST = /^(revenue area|nursery|range office|head quarter banglo|irrigation area|reservior|gut number|survey number|non protected area|new|unsurveyed|\s*)$/i;
const usable = (p) => p.base && !isFdcm(p) && !NON_FOREST.test(String(p.COMP_TYPE).trim());

/* ---------- village-name matching (Marathi VLMNAME, per taluka) ---------- */
const norm = (s) =>
  String(s ?? "").normalize("NFC").replace(/\(.*?\)/g, "").replace(/^(ग्रामस्त|ग्रामस्थ|ग्रामपंचायत)\s*/, "").replace(/[\s.\-]/g, "")
    .replace(/[ूु]/g, "ु").replace(/[ीि]/g, "ि").replace(/[ंँ]/g, "").replace(/ळ/g, "ल").replace(/गांव|गाव/g, "गाव").replace(/(बु|खु|बुद्रुक|खुर्द)$/, "");
const lev = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
// Sheet and MRSAC transliterate differently (उदमाळ / उडमल): merge retroflex with dental, drop vowel signs, then compare.
const PHON = { ड: "द", ट: "त", ठ: "थ", ढ: "ध", ण: "न", ळ: "ल", ष: "श", ऱ: "र", ऩ: "न" };
const skel = (x) => x.replace(/[ािीुूृेैोौ्ंँ]/g, "").replace(/[डटठढणळषऱऩ]/g, (c) => PHON[c]);
function findVillage(name, th) {
  const key = norm(name);
  if (!key) return null;
  const pool = villages.filter((v) => v.THNCODE === th);
  const exact = pool.filter((v) => norm(v.VLMNAME) === key);
  if (exact.length === 1) return { v: exact[0], how: "name" };
  if (exact.length > 1) return { many: exact, how: "name" };
  // same consonant skeleton, unique in the taluka: spelling variants only. Two villages sharing a skeleton stay unmatched.
  const sk = skel(key);
  const same = pool.filter((v) => skel(norm(v.VLMNAME)) === sk);
  if (same.length === 1 && sk.length >= 3) return { v: same[0], how: "fuzzy" };
  if (same.length > 1) return { many: same, how: "fuzzy" };
  return null;
}

/* ---------- resolve ---------- */
const clusters = (list) => {
  const par = list.map((_, i) => i);
  const f = (i) => (par[i] === i ? i : (par[i] = f(par[i])));
  list.forEach((p, i) => list.forEach((q, j) => j > i && gap(p.bb, q.bb) <= SLIVER_KM * 1000 && (par[f(i)] = f(j))));
  const g = {};
  list.forEach((p, i) => (g[f(i)] ??= []).push(p));
  return Object.values(g);
};
const comps = (r) => [...new Set((r.k ?? []).map((k) => String(k).split(/[/.]/)[0].replace(/^0+(?=\d)/, "")))];
const review = [];
const out = {}; // key -> [{n, st, ...}]
const used = new Set();
const homeRB = {}; // village code -> Set of "range|beat" of polygons inside it (tie-break)

// same grouping as purposeGroups() in src/lib/cfr-data.ts, so the map can filter neighbouring claims by purpose too
const purposeOf = (p) => {
  const g = [];
  if (/चराई|कुरण/.test(p)) g.push("grazing");
  if (/लाकू|लाकड|झाड|इमारती|जळावू/.test(p)) g.push("timber");
  if (/गुरे|मुरदे|गाडण|उधड|उधळ|स्मशान|खातकुडा/.test(p)) g.push("cattle");
  return g.length ? g : ["other"];
};
const keyOf = (r) => `${r.t}|${r.cn ?? ""}|${r.v}`;
const items = [];
for (const r of claims) {
  const th = TALUKA_CODE[r.t];
  const fv = findVillage(r.v, th) ?? findVillage(r.gs, th);
  const v = fv?.v;
  for (const n of comps(r)) items.push({ r, th, v, many: fv?.many, how: fv?.how, n });
}
// pass 1: distance candidates; pass 2 uses the range/beat the village's unambiguous claims landed in
function candidates(it) {
  const all = polys.filter((p) => p.base === it.n && usable(p));
  if (it.v) {
    const near = all.filter((p) => gap(p.bb, it.v.bb) <= RADIUS_KM * 1000).map((p) => ({ p, d: dist(p.m, it.v.m) })).filter((x) => x.d <= RADIUS_KM * 1000);
    return { list: near, mode: "village" };
  }
  return { list: all.filter((p) => p.vil?.THNCODE === it.th).map((p) => ({ p, d: null })), mode: "taluka" };
}
const vfCache = new Map();
/** MRSAC forest-land polygons (any number, not FDCM / non-forest) that lie inside the village. */
function villageForest(v) {
  if (!vfCache.has(v.VINCODE)) vfCache.set(v.VINCODE, polys.filter((p) => usable(p) && gap(p.bb, v.bb) === 0 && dist(p.m, v.m) === 0));
  return vfCache.get(v.VINCODE);
}
function decide(it, home) {
  const { list, mode } = candidates(it);
  if (!list.length) {
    // Nothing usable carries this number. Draw what MRSAC does have, marked unconfirmed (`wk`), never as a located compartment:
    //  fdcm = a forest-corporation compartment with this number; vforest = the forest land inside the matched village.
    const fdAll = polys.filter((p) => p.base === it.n && isFdcm(p) && (it.v ? gap(p.bb, it.v.bb) <= RADIUS_KM * 1000 : p.vil?.THNCODE === it.th));
    if (fdAll.length) {
      const cls = clusters(fdAll).map((ps) => ({ ps, d: it.v ? Math.min(...ps.map((p) => dist(p.m, it.v.m))) : 0 })).sort((a, b) => a.d - b.d);
      if (cls.length === 1 || (it.v && cls[0].d < cls[1].d - TIE_KM * 1000)) return { st: "only-fdcm", weak: cls[0].ps, wk: "fdcm", d: it.v ? cls[0].d : null };
      return { st: "only-fdcm" };
    }
    const vf = it.v ? villageForest(it.v) : [];
    return vf.length ? { st: "notfound", weak: vf, wk: "vforest" } : { st: "notfound" };
  }
  // one cluster per compartment; slivers of the same number sit together
  const cl = clusters(list.map((x) => x.p)).map((ps) => {
    const ds = ps.map((p) => list.find((x) => x.p === p).d);
    return { ps, d: mode === "village" ? Math.min(...ds) : null, rb: new Set(ps.map((p) => `${p.RANGE}|${p.BEAT}`)) };
  });
  if (mode === "taluka") return cl.length === 1 ? { st: "taluka-unique", cl: cl[0] } : { st: "ambiguous", cands: cl.length, rbs: [...new Set(cl.flatMap((c) => [...c.rb]))].slice(0, 6), ...(cl.length <= 6 ? { weak: cl.flatMap((c) => c.ps), wk: "cands" } : {}) };
  cl.sort((a, b) => a.d - b.d);
  const inn = cl.filter((c) => c.d === 0);
  if (inn.length >= 1) return { st: "inside", cl: inn.length === 1 ? inn[0] : { ...inn[0], ps: inn.flatMap((c) => c.ps) } };
  const best = cl[0];
  const close = cl.filter((c) => c !== best && c.d - best.d <= TIE_KM * 1000);
  if (close.length) {
    // same range/beat as the village's own compartments breaks the tie; otherwise it stays ambiguous
    const h = home?.get(it.v.VINCODE);
    const pick = h ? [best, ...close].filter((c) => [...c.rb].some((x) => h.has(x))) : [];
    if (pick.length === 1) return { st: "outside", cl: pick[0], tie: "range/beat" };
    return { st: "ambiguous", cands: close.length + 1, rbs: [...new Set([best, ...close].flatMap((c) => [...c.rb]))].slice(0, 6), d: best.d, weak: [best, ...close].flatMap((c) => c.ps), wk: "cands" };
  }
  return { st: "outside", cl: best };
}

const res1 = items.map((it) => decide(it, null));
const home = new Map();
items.forEach((it, i) => {
  if (res1[i].st === "inside" && it.v) (home.get(it.v.VINCODE) ?? home.set(it.v.VINCODE, new Set()).get(it.v.VINCODE)), res1[i].cl.rb.forEach((x) => home.get(it.v.VINCODE).add(x));
});
items.forEach((it, i) => {
  const d = it.v && (res1[i].st === "ambiguous" || res1[i].st === "outside") ? decide(it, home) : res1[i];
  const k = keyOf(it.r);
  // g/t/v/cn identify the claim on its own, so the map can draw neighbouring gram sabhas from this file alone; h = its ha share of this compartment
  const rec = { n: it.n, st: d.st, g: it.r.gs, t: it.r.t, v: it.r.v, cn: it.r.cn, pg: purposeOf(it.r.p), h: Math.round((it.r.ha / Math.max(1, comps(it.r).length)) * 100) / 100 };
  if (!it.v) rec.vm = it.many ? "many" : "none"; // village not matched by name: located by compartment number within the taluka
  else rec.vc = it.v.VINCODE;
  if (it.how === "fuzzy") rec.fz = 1;
  if (d.cl) {
    rec.ids = d.cl.ps.map((p) => p.OBJECTID);
    rec.rb = [...d.cl.rb].slice(0, 2).join(" / ").replaceAll("|", " · ");
    rec.ha = Math.round(d.cl.ps.reduce((s, p) => s + p.ShpAreaHa, 0) * 10) / 10;
    if (d.cl.d != null) rec.km = Math.round(d.cl.d / 100) / 10;
    const lv = d.cl.ps.map((p) => p.vil).find(Boolean);
    if (lv) rec.nv = lv.VLMNAME; // the MRSAC village the compartment lies in
    d.cl.ps.forEach((p) => used.add(p.OBJECTID));
    if (d.tie) rec.tie = d.tie;
  } else if (d.weak) {
    rec.wk = d.wk;
    rec.ids = d.weak.map((p) => p.OBJECTID);
    rec.ha = Math.round(d.weak.reduce((s, p) => s + p.ShpAreaHa, 0) * 10) / 10;
    if (d.cands) (rec.cands = d.cands), (rec.rbs = d.rbs);
    if (d.d != null) rec.km = Math.round(d.d / 100) / 10;
    d.weak.forEach((p) => used.add(p.OBJECTID));
  } else if (d.cands) (rec.cands = d.cands), (rec.rbs = d.rbs);
  (out[k] ??= []).push(rec);
  if (!["inside", "outside", "taluka-unique"].includes(d.st) || it.how === "fuzzy" || !it.v)
    review.push(`${it.r.t} / ${it.r.gs || it.r.v} / comp ${it.n} (${it.r.ha} ha): ${d.st}${!it.v ? ` [village ${it.many ? "ambiguous" : "not matched"}]` : ""}${it.how === "fuzzy" ? " [fuzzy village name]" : ""}${d.cands ? ` candidates=${d.cands} (${d.rbs.join("; ")})` : ""}`);
});

/* ---------- nearest-village allocation of shared polygons ---------- */
const byPoly = {};
for (const r of claims) for (const rec of out[keyOf(r)] ?? []) if (rec.ids && !rec.wk) (byPoly[rec.ids.slice().sort().join(",")] ??= []).push({ r, rec });
let shared = 0, over = 0, far = 0;
for (const list of Object.values(byPoly)) {
  const share = list.map((x) => ({ ...x, ha: x.r.ha / Math.max(1, comps(x.r).length) }));
  const poly = list[0].rec.ha;
  if (new Set(list.map((x) => x.r.gs || x.r.v)).size < 2) {
    const tot = share.reduce((s, x) => s + x.ha, 0);
    if (tot > poly * 1.1 && poly) list.forEach((x) => (x.rec.over = Math.round((tot - poly) * 10) / 10));
    continue;
  }
  shared++;
  share.sort((a, b) => (a.rec.km ?? 99) - (b.rec.km ?? 99) || b.ha - a.ha);
  let left = poly;
  const near = share[0].rec.km ?? 0;
  const names = [...new Set(share.map((x) => x.r.gs || x.r.v))];
  for (const x of share) {
    const a = Math.max(0, Math.min(x.ha, left));
    left -= a;
    x.rec.al = Math.round(a * 10) / 10;
    x.rec.sh = names;
    if (a < x.ha - 0.05) (x.rec.over = Math.round((x.ha - a) * 10) / 10), over++;
    if ((x.rec.km ?? 0) - near >= FAR_GAP_KM) (x.rec.far = 1), far++;
  }
}

/* ---------- write ---------- */
const polyOut = {};
const r5 = (rings) => rings.map((r) => r.map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]));
for (const p of polys) if (used.has(p.OBJECTID)) polyOut[p.OBJECTID] = { n: p.COMP_NO, t: p.COMP_TYPE, r: p.RANGE, b: p.BEAT, a: Math.round(p.ShpAreaHa * 10) / 10, g: r5(p.rings) };
mkdirSync("public/data/cfr-comp", { recursive: true });
writeFileSync("public/data/cfr-comp/nashik.json", JSON.stringify({ built: new Date().toISOString().slice(0, 10), radiusKm: RADIUS_KM, claims: out, polys: polyOut }));
writeFileSync("data/cfr/nashik-resolve-review.txt", review.join("\n") + "\n");

const tally = {};
for (const recs of Object.values(out)) for (const r of recs) tally[r.st] = (tally[r.st] ?? 0) + 1;
console.log(JSON.stringify(tally), `| polygons used ${used.size} | shared polygons ${shared} | over-claimed ${over} | far claims ${far} | review lines ${review.length}`);
const vm = { name: 0, fuzzy: 0, none: 0 };
for (const it of items) it.v ? vm[it.how === "fuzzy" ? "fuzzy" : "name"]++ : vm.none++;
console.log("village match (per compartment):", JSON.stringify(vm));
if (process.argv.includes("--fuzzy")) for (const it of items) if (it.how === "fuzzy" && it.v) console.log(it.r.t, "|", it.r.v, "=>", it.v.VLMNAME);
if (process.argv.includes("--by-taluka")) {
  const t = {};
  for (const r of claims) for (const rec of out[keyOf(r)] ?? []) ((t[r.t] ??= {})[rec.st] = (t[r.t][rec.st] ?? 0) + 1);
  console.table(t);
}
