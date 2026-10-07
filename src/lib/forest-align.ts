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

export function bestShift(parcels: AlignParcel[], inForest: InForest, range = 200, coarse = 25, fine = 5): { dx: number; dy: number; score: number; base: number } {
  const base = agreement(parcels, inForest, 0, 0);
  let best = { dx: 0, dy: 0, score: base };
  const scan = (cx: number, cy: number, r: number, step: number) => {
    for (let dx = cx - r; dx <= cx + r; dx += step)
      for (let dy = cy - r; dy <= cy + r; dy += step) {
        const s = agreement(parcels, inForest, dx, dy);
        // ties go to the smaller move, so a flat score never drifts
        if (s > best.score + 1e-9 || (Math.abs(s - best.score) < 1e-9 && Math.hypot(dx, dy) < Math.hypot(best.dx, best.dy))) best = { dx, dy, score: s };
      }
  };
  scan(0, 0, range, coarse);
  scan(best.dx, best.dy, coarse, fine);
  return { ...best, base };
}
