import { test, expect } from "@playwright/test";
import { combineWindows } from "../../src/lib/cadastral-calibration";
import type { RegisterResult } from "../../src/lib/cadastral-registration.worker";

/**
 * The accept/reject rule for an imagery fit, tested on synthetic correlation surfaces (no portal, no browser):
 * summed peak must stand out AND most windows must independently support it, else the seed estimate stays.
 */
const MAXS = 178;
const SIDE = 2 * MAXS + 1;
const MPP = 1.12;

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

/** A z-scored surface: unit noise plus an optional peak (height in sigmas) at pixel offset (px, py) from the centre. */
function surface(seed: number, peak?: { px: number; py: number; h: number }): RegisterResult {
  const r = rng(seed);
  const surf = new Float32Array(SIDE * SIDE);
  for (let i = 0; i < surf.length; i++) surf[i] = gauss(r);
  if (peak) {
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) surf[(MAXS + peak.py + dy) * SIDE + MAXS + peak.px + dx]! += peak.h * Math.exp(-(dx * dx + dy * dy) / 3);
  }
  return { id: seed, surf, side: SIDE, maxs: MAXS, mpp: MPP, psr: 0, east: 0, north: 0 };
}
const PRIOR = { x: -13, y: -85 };

test.describe("imagery-fit decision rule", () => {
  test("5 windows that all show the same peak: accepted at the right place", () => {
    const px = -10, py = 25; // east -11.2 m, north -28 m
    const out = combineWindows([1, 2, 3, 4, 5].map((i) => surface(i, { px, py, h: 5 })), PRIOR);
    expect(out).not.toBeNull();
    expect(out!.east).toBeCloseTo(px * MPP, 0);
    expect(out!.north).toBeCloseTo(-py * MPP, 0);
    expect(out!.agreeing).toBe(5);
  });

  test("pure noise is rejected", () => {
    expect(combineWindows([1, 2, 3, 4, 5].map((i) => surface(100 + i)), PRIOR)).toBeNull();
  });

  test("a peak in only 2 of 5 windows is rejected (a false lock from one strong window)", () => {
    const w = [surface(1, { px: 5, py: 5, h: 14 }), surface(2, { px: 5, py: 5, h: 14 }), surface(3), surface(4), surface(5)];
    expect(combineWindows(w, PRIOR)).toBeNull();
  });

  test("4 of 5 windows supporting a moderate peak is accepted", () => {
    const w = [1, 2, 3, 4].map((i) => surface(i, { px: -12, py: 30, h: 4.2 }));
    w.push(surface(5));
    const out = combineWindows(w, PRIOR);
    expect(out).not.toBeNull();
    expect(out!.agreeing).toBeGreaterThanOrEqual(4);
  });

  test("a distinct peak backed by 3 of 5 windows is accepted; an equally strong but look-alike peak is not", () => {
    // 3 windows share a strong peak and nothing else competes
    const w = [1, 2, 3].map((i) => surface(i, { px: -8, py: 20, h: 6 }));
    w.push(surface(4), surface(5));
    expect(combineWindows(w, PRIOR)).not.toBeNull();
    // the same support but a second peak almost as high elsewhere (periodic parcel grid): ambiguous -> rejected
    const amb = [1, 2, 3].map((i) => surface(10 + i, { px: -8, py: 20, h: 3.6 }));
    for (const r of amb) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) r.surf![(MAXS + 20 + 76 + dy) * SIDE + MAXS - 8 + dx]! += 3.4 * Math.exp(-(dx * dx + dy * dy) / 3);
    amb.push(surface(14), surface(15));
    expect(combineWindows(amb, PRIOR)).toBeNull();
  });

  test("windows disagreeing on where the peak is are rejected", () => {
    const w = [surface(1, { px: -40, py: 10, h: 5 }), surface(2, { px: 30, py: -60, h: 5 }), surface(3, { px: 80, py: 70, h: 5 }), surface(4, { px: -90, py: -20, h: 5 }), surface(5, { px: 10, py: 90, h: 5 })];
    expect(combineWindows(w, PRIOR)).toBeNull();
  });

  test("fewer than 3 usable windows (small village) falls back", () => {
    const ok = surface(1, { px: 0, py: 0, h: 9 });
    expect(combineWindows([ok, { id: 2, err: "too few parcel lines" }, { id: 3, err: "too few parcel lines" }], PRIOR)).toBeNull();
  });

  test("a peak farther than 130 m from the regional estimate is treated as a false lock", () => {
    // prior is (-13, -85) m; a peak at +150 m east, +60 m north is ~200 m away
    const px = Math.round(150 / MPP), py = -Math.round(60 / MPP);
    expect(combineWindows([1, 2, 3, 4, 5].map((i) => surface(i, { px, py, h: 6 })), PRIOR)).toBeNull();
  });

  test("a peak at the edge of the search area is not a real optimum", () => {
    expect(combineWindows([1, 2, 3, 4, 5].map((i) => surface(i, { px: MAXS - 2, py: 0, h: 8 })), { x: 0, y: 0 })).toBeNull();
  });
});
