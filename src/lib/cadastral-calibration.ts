/**
 * Per-village cadastral calibration measured against satellite imagery (see cadastral-registration.worker.ts).
 *
 * The result is only trusted when independent windows of the same village agree; otherwise the caller keeps the
 * regional seed estimate. Results are cached per village because the portal's maps do not change.
 */
import type { RegisterRequest, RegisterResult } from "./cadastral-registration.worker";

export interface AutoCalibration {
  /** Metres to move the portal's parcels so they land on the imagery. */
  east: number;
  north: number;
  /** Windows that produced a usable correlation / windows that independently support the chosen peak. */
  windows: number;
  agreeing: number;
  psr: number;
  at: number;
}

const KEY = (gis: string) => `bn:calib:v2:${gis}`;
const TTL_MS = 90 * 24 * 3600 * 1000;
const MIN_PSR = 5.5; // the SUMMED correlation peak must stand this far (in sigmas) above the search area
const STRONG_PSR = 8; // ... or this far with at least 3 supporting windows
const DISTINCT_PSR = 6.5; // ... or this far when the peak is also clearly the best of all (ratio below) with 3 supporting windows
const DISTINCT_RATIO = 1.3; // best peak vs the best peak elsewhere (a periodic parcel grid makes look-alike peaks; wrong locks sat at ~1.1-1.2)
const SUPPORT_Z = 3; // a window "supports" the peak when its own surface has at least this z-score there (+-4 px)
const MIN_WINDOWS = 3;
const MAX_FROM_PRIOR_M = 130; // the seed estimate is never wrong by more than this; anything farther is a false lock
// Window centres in metres from the village centre. Measured on 8 villages: summing the windows' correlation surfaces and
// requiring most windows to support the peak made Google- and ESRI-based fits agree within 4.3 m wherever it accepted,
// and rejected the three villages where the providers disagreed by 20-160 m.
const WINDOWS_M: [number, number][] = [[0, 0], [500, 400], [-500, -400], [500, -400], [-500, 400]];

export function readCachedCalibration(gis: string): AutoCalibration | null {
  try {
    const raw = localStorage.getItem(KEY(gis));
    if (!raw) return null;
    const v = JSON.parse(raw) as AutoCalibration;
    return Date.now() - v.at < TTL_MS ? v : null;
  } catch {
    return null;
  }
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: RegisterResult) => void>();
function ask(req: Omit<RegisterRequest, "id">): Promise<RegisterResult> {
  if (!worker) {
    worker = new Worker(new URL("./cadastral-registration.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<RegisterResult>) => {
      pending.get(e.data.id)?.(e.data);
      pending.delete(e.data.id);
    };
  }
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker!.postMessage({ ...req, id });
  });
}

/** Pure decision step, exported for tests: sum the windows' surfaces, find the peak, test how many windows back it. */
export function combineWindows(results: RegisterResult[], prior: { x: number; y: number }): AutoCalibration | null {
  const ok = results.filter((r) => !r.err && r.surf && r.side && r.maxs !== undefined && r.mpp);
  if (ok.length < MIN_WINDOWS) {
    console.debug("[calibration] too few usable windows", results.map((r) => r.err ?? "ok"));
    return null;
  }
  const side = ok[0]!.side!;
  const M = ok[0]!.maxs!;
  const mpp = ok[0]!.mpp!;
  const sum = new Float64Array(side * side);
  for (const r of ok) for (let i = 0; i < sum.length; i++) sum[i]! += r.surf![i]!;
  let best = -Infinity;
  let bi = 0;
  let m = 0;
  let m2 = 0;
  for (let i = 0; i < sum.length; i++) {
    m += sum[i]!;
    m2 += sum[i]! * sum[i]!;
    if (sum[i]! > best) (best = sum[i]!), (bi = i);
  }
  m /= sum.length;
  const sd = Math.sqrt(m2 / sum.length - m * m);
  const psr = (best - m) / sd;
  const px = bi % side;
  const py = Math.floor(bi / side);
  const sub = (a: number, b: number, c: number) => {
    const dn = a - 2 * b + c;
    return dn ? (0.5 * (a - c)) / dn : 0;
  };
  const at = (x: number, y: number) => sum[y * side + x]!;
  const edge = px < 1 || py < 1 || px >= side - 1 || py >= side - 1;
  if (edge) return null; // the peak is at the search limit: not a real optimum
  const sx = px + sub(at(px - 1, py), at(px, py), at(px + 1, py)) - M;
  const sy = py + sub(at(px, py - 1), at(px, py), at(px, py + 1)) - M;
  let support = 0;
  for (const r of ok) {
    let top = -Infinity;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) top = Math.max(top, r.surf![(py + dy) * side + px + dx] ?? -Infinity);
    if (top >= SUPPORT_Z) support++;
  }
  // best peak elsewhere (outside +-10 px of the chosen one)
  let second = -Infinity;
  for (let i = 0; i < sum.length; i++) {
    const x = i % side;
    const y = Math.floor(i / side);
    if (Math.abs(x - px) < 10 && Math.abs(y - py) < 10) continue;
    if (sum[i]! > second) second = sum[i]!;
  }
  const ratio = (best - m) / (second - m);
  const need = ok.length === MIN_WINDOWS ? MIN_WINDOWS : Math.ceil(0.8 * ok.length);
  console.debug("[calibration]", { windows: ok.length, psr: +psr.toFixed(1), ratio: +ratio.toFixed(2), support, need, east: +(sx * mpp).toFixed(1), north: +(-sy * mpp).toFixed(1) });
  if (!((psr >= MIN_PSR && support >= need) || (psr >= STRONG_PSR && support >= MIN_WINDOWS) || (psr >= DISTINCT_PSR && ratio >= DISTINCT_RATIO && support >= MIN_WINDOWS))) return null;
  const east = sx * mpp;
  const north = -sy * mpp;
  if (Math.hypot(east - prior.x, north - prior.y) > MAX_FROM_PRIOR_M) return null;
  return { east: Math.round(east * 10) / 10, north: Math.round(north * 10) / 10, windows: ok.length, agreeing: support, psr: Math.round(psr * 10) / 10, at: Date.now() };
}

/**
 * `extent` is the village's [minLon, minLat, maxLon, maxLat] (real degrees). Three windows are measured: the centre
 * and two offsets, so a mis-lock in one is caught by the others.
 */
export async function calibrateVillage(
  gis: string,
  extent: [number, number, number, number],
  prior: { x: number; y: number },
  signal?: AbortSignal
): Promise<AutoCalibration | null> {
  const cached = readCachedCalibration(gis);
  if (cached) return cached;
  const [x0, y0, x1, y1] = extent;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const mE = 111320 * Math.cos((cy * Math.PI) / 180);
  const results: RegisterResult[] = [];
  for (let i = 0; i < WINDOWS_M.length; i++) {
    if (signal?.aborted) return null;
    const [de, dn] = WINDOWS_M[i]!;
    results.push(await ask({ gis, lon: cx + de / mE, lat: cy + dn / 110574 }));
    // two windows with no parcels (small village) or no hint of a peak: stop early, the seed estimate stays
    if (i === 2) {
      const good = results.filter((r) => !r.err).length;
      if (good < MIN_WINDOWS) {
        console.debug("[calibration] stopped after 3 windows", results.map((r) => r.err ?? "ok"));
        return null;
      }
    }
  }
  if (signal?.aborted) return null;
  const out = combineWindows(results, prior);
  if (out) {
    try {
      localStorage.setItem(KEY(gis), JSON.stringify(out));
    } catch {
      // storage full: the result still applies for this session
    }
  }
  return out;
}
