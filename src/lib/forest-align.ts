/**
 * MRSAC forest compartments are cut from the cadastral map, but not in exactly the frame the portal's cadastral is
 * drawn in. The shift that best lines them up is the one where forest-held parcels (7/12 holder = forest dept /
 * government) fall inside compartments and private parcels fall outside. Searched coarse-to-fine over a few metres.
 */
export interface AlignParcel {
  /** sample points in EPSG:3857 metres (raw cadastral frame) */
  pts: [number, number][];
  /** area weight (ha) */
  w: number;
  forestHeld: boolean;
}

export type InForest = (x: number, y: number) => boolean;

/** Weighted share of samples where "inside a compartment" agrees with "forest-held", for one shift. */
export function agreement(parcels: AlignParcel[], inForest: InForest, dx: number, dy: number): number {
  let ok = 0;
  let tot = 0;
  for (const p of parcels) {
    const per = p.w / p.pts.length;
    for (const [x, y] of p.pts) {
      tot += per;
      if (inForest(x + dx, y + dy) === p.forestHeld) ok += per;
    }
  }
  return tot ? ok / tot : 0;
}

export interface Shift {
  dx: number;
  dy: number;
  score: number;
  base: number;
  /** measured = this village's own best shift; prior = the regional offset */
  how?: "measured" | "prior";
}

/**
 * Nashik: MRSAC compartments sit +78 m E / -68 m S of the raw cadastral frame (median). Measured over 25 villages by
 * tests/e2e/21-calibration-sweep.spec.ts: the 13 villages that gave a clear measurement all fall within +/-30 m of this;
 * the earlier +/-200 m search also produced outliers (Dhaur -180/-225, Pohane 180/-110) from too little evidence.
 */
export const NASHIK_PRIOR = { dx: 78, dy: -68 };

/** Acceptance thresholds, set from that sweep. */
export const ALIGN = {
  minHeld: 8, // forest-held parcels needed before a village's own measurement is trusted
  window: 40, // m searched around the regional offset (the 13 measured villages spread +/-30 m)
  minGain: 0.02, // agreement a village's own shift must add over no shift (clear villages gained 0.03 - 0.34)
  flat: 0.01, // the regional offset is kept unless it is worse than no shift by more than this
  farGain: 0.05, // districts without a regional offset: gain needed to adopt a +/-200 m search result
};

export function bestShift(parcels: AlignParcel[], inForest: InForest, range = 200, coarse = 25, fine = 5, center?: { dx: number; dy: number }): { dx: number; dy: number; score: number; base: number } {
  const base = agreement(parcels, inForest, 0, 0);
  let best = center ? { dx: center.dx, dy: center.dy, score: agreement(parcels, inForest, center.dx, center.dy) } : { dx: 0, dy: 0, score: base };
  const scan = (cx: number, cy: number, r: number, step: number) => {
    for (let dx = cx - r; dx <= cx + r; dx += step)
      for (let dy = cy - r; dy <= cy + r; dy += step) {
        const s = agreement(parcels, inForest, dx, dy);
        // ties go to the smaller move (to the regional offset when there is one), so a flat score never drifts
        const dist = (x: number, y: number) => Math.hypot(x - (center?.dx ?? 0), y - (center?.dy ?? 0));
        if (s > best.score + 1e-9 || (Math.abs(s - best.score) < 1e-9 && dist(dx, dy) < dist(best.dx, best.dy))) best = { dx, dy, score: s };
      }
  };
  scan(center?.dx ?? 0, center?.dy ?? 0, range, coarse);
  scan(best.dx, best.dy, coarse, fine);
  return { ...best, base };
}

/**
 * The shift to draw MRSAC compartments with, or null for none. With a regional offset: search only a small window
 * around it, take the village's own result when it clearly beats no shift, else keep the regional offset unless it is
 * worse than no shift; too few forest-held parcels to measure also means the regional offset. Without one: the plain
 * +/-200 m search, adopted only on a clear gain.
 */
export function calibrate(parcels: AlignParcel[], inForest: InForest, prior?: { dx: number; dy: number }): { shift: Shift | null; held: number; measured: Shift | null } {
  const held = parcels.filter((q) => q.forestHeld).length;
  const decided = held >= ALIGN.minHeld && held < parcels.length;
  const fixed = (score: number, base: number): Shift => ({ ...prior!, score, base, how: "prior" });
  if (!decided) return { shift: prior ? fixed(0, 0) : null, held, measured: null };
  if (!prior) {
    const b = bestShift(parcels, inForest);
    return { shift: b.score - b.base >= ALIGN.farGain ? b : null, held, measured: b };
  }
  const w = bestShift(parcels, inForest, ALIGN.window, 10, 5, prior);
  if (w.score - w.base >= ALIGN.minGain) return { shift: { ...w, how: "measured" }, held, measured: w };
  const atPrior = agreement(parcels, inForest, prior.dx, prior.dy);
  return { shift: atPrior >= w.base - ALIGN.flat ? fixed(atPrior, w.base) : null, held, measured: w };
}
