// @ts-nocheck -- REGISTER runs inside the page (page.evaluate); intentionally self-contained.
/**
 * Independent imagery registration used by the tests: GOOGLE satellite tiles (the app fits against ESRI), fetched by
 * the test runner and cross-correlated (FFT) with the portal's raw parcel lines. Five windows are measured and their
 * correlation surfaces summed (a single window is too ambiguous: parcel grids repeat).
 */
export const REGISTER = async ({ gis, tx0, ty0, z, imgs, N, S }) => {
  const O = 20037508.34;
  const mpp = (2 * O) / (S * 2 ** z);
  const mx0 = -O + tx0 * S * mpp, my1 = O - ty0 * S * mpp;
  const cv = document.createElement("canvas");
  cv.width = cv.height = N;
  const cx = cv.getContext("2d");
  const per = N / S;
  for (let i = 0; i < imgs.length; i++) {
    if (!imgs[i]) continue;
    const bin = atob(imgs[i]);
    const u = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k);
    cx.drawImage(await createImageBitmap(new Blob([u])), (i % per) * S, Math.floor(i / per) * S);
  }
  const d = cx.getImageData(0, 0, N, N).data;
  const gray = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) gray[i] = 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2];

  const blur = (src, sigma) => {
    const r = Math.ceil(sigma * 3), k = new Float32Array(2 * r + 1);
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
    for (let i = 0; i < k.length; i++) k[i] /= sum;
    const tmp = new Float32Array(N * N), out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let s = 0; for (let i = -r; i <= r; i++) { const xx = Math.min(N - 1, Math.max(0, x + i)); s += src[y * N + xx] * k[i + r]; } tmp[y * N + x] = s; }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let s = 0; for (let i = -r; i <= r; i++) { const yy = Math.min(N - 1, Math.max(0, y + i)); s += tmp[yy * N + x] * k[i + r]; } out[y * N + x] = s; }
    return out;
  };
  // imagery edge map
  const g1 = blur(gray, 1.2);
  const grad = new Float32Array(N * N);
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) grad[y * N + x] = Math.hypot(g1[y * N + x + 1] - g1[y * N + x - 1], g1[(y + 1) * N + x] - g1[(y - 1) * N + x]);
  const sorted = Float32Array.from(grad).sort();
  const cap = sorted[Math.floor(N * N * 0.99)];
  for (let i = 0; i < N * N; i++) if (grad[i] > cap) grad[i] = cap;
  const E = blur(grad, 2);

  // raw portal parcel lines, pixel-aligned with the mosaic
  const q = new URLSearchParams({ SERVICE: "WMS", VERSION: "1.1.1", REQUEST: "GetMap", LAYERS: "VILLAGE_MAP", STYLES: "VILLAGE_MAP", state: "27", gis_code: gis, TRANSPARENT: "true", FORMAT: "image/png", SRS: "EPSG:3857", WIDTH: String(N), HEIGHT: String(N), BBOX: [mx0, my1 - N * mpp, mx0 + N * mpp, my1].map((n) => n.toFixed(3)).join(",") });
  const bm = await createImageBitmap(await (await fetch("/bhunaksha/WMS?" + q)).blob());
  const c2 = document.createElement("canvas");
  c2.width = c2.height = N;
  const x2 = c2.getContext("2d");
  x2.drawImage(bm, 0, 0, N, N);
  const p = x2.getImageData(0, 0, N, N).data;
  const lines = new Float32Array(N * N);
  let nl = 0;
  for (let i = 0; i < N * N; i++) if (p[i * 4 + 3] > 100 && p[i * 4] < 110 && p[i * 4 + 1] < 110 && p[i * 4 + 2] < 110) (lines[i] = 1), nl++;
  const P = blur(lines, 2);
  if (nl < 1500) return { err: "few parcel line pixels: " + nl };

  // FFT helpers
  const fft1 = (re, im, n, inv) => {
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = ((inv ? -2 : 2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const a = i + k, b = i + k + len / 2; const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr; re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } }
    }
    if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  };
  const fft2 = (re, im, inv) => {
    const rr = new Float64Array(N), ri = new Float64Array(N);
    for (let y = 0; y < N; y++) { for (let x = 0; x < N; x++) (rr[x] = re[y * N + x]), (ri[x] = im[y * N + x]); fft1(rr, ri, N, inv); for (let x = 0; x < N; x++) (re[y * N + x] = rr[x]), (im[y * N + x] = ri[x]); }
    for (let x = 0; x < N; x++) { for (let y = 0; y < N; y++) (rr[y] = re[y * N + x]), (ri[y] = im[y * N + x]); fft1(rr, ri, N, inv); for (let y = 0; y < N; y++) (re[y * N + x] = rr[y]), (im[y * N + x] = ri[y]); }
  };
  const prep = (a) => {
    let m = 0;
    for (let i = 0; i < N * N; i++) m += a[i];
    m /= N * N;
    const re = new Float64Array(N * N), im = new Float64Array(N * N);
    for (let y = 0; y < N; y++) { const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * y) / (N - 1)); for (let x = 0; x < N; x++) { const wx = 0.5 - 0.5 * Math.cos((2 * Math.PI * x) / (N - 1)); re[y * N + x] = (a[y * N + x] - m) * wx * wy; } }
    return { re, im };
  };
  const A = prep(E), B = prep(P);
  fft2(A.re, A.im, false);
  fft2(B.re, B.im, false);
  const cr = new Float64Array(N * N), ci = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) { cr[i] = A.re[i] * B.re[i] + A.im[i] * B.im[i]; ci[i] = A.im[i] * B.re[i] - A.re[i] * B.im[i]; } // FFT(E) * conj(FFT(P))
  fft2(cr, ci, true);
  // peak within +-MAXS pixels
  const MAXS = Math.round(220 / mpp);
  let bi = -1, bv = -1e30, sum = 0, sum2 = 0, cnt = 0;
  const at = (dx, dy) => cr[((dy + N) % N) * N + ((dx + N) % N)];
  for (let dy = -MAXS; dy <= MAXS; dy++) for (let dx = -MAXS; dx <= MAXS; dx++) { const v = at(dx, dy); sum += v; sum2 += v * v; cnt++; if (v > bv) (bv = v), (bi = [dx, dy]); }
  const mean = sum / cnt, sd = Math.sqrt(sum2 / cnt - mean * mean);
  // sub-pixel (parabolic)
  const [px, py] = bi;
  const sub = (a, b, c) => { const dn = a - 2 * b + c; return dn ? (0.5 * (a - c)) / dn : 0; };
  const sx = px + sub(at(px - 1, py), at(px, py), at(px + 1, py));
  const sy = py + sub(at(px, py - 1), at(px, py), at(px, py + 1));
  // second-best peak outside +-6 px (ambiguity check)
  let second = -1e30;
  for (let dy = -MAXS; dy <= MAXS; dy++) for (let dx = -MAXS; dx <= MAXS; dx++) { if (Math.abs(dx - px) < 7 && Math.abs(dy - py) < 7) continue; const v = at(dx, dy); if (v > second) second = v; }
  const peaks = [];
  const used = [];
  for (let k = 0; k < 6; k++) {
    let m = -1e30, mi = null;
    for (let dy = -MAXS; dy <= MAXS; dy++) for (let dx = -MAXS; dx <= MAXS; dx++) { if (used.some(([ux, uy]) => Math.abs(dx - ux) < 10 && Math.abs(dy - uy) < 10)) continue; const v = at(dx, dy); if (v > m) (m = v), (mi = [dx, dy]); }
    if (!mi) break;
    used.push(mi);
    peaks.push({ east: +(mi[0] * mpp).toFixed(1), north: +(-mi[1] * mpp).toFixed(1), score: +((m - mean) / sd).toFixed(1) });
  }
  const side = 2 * MAXS + 1;
  const surf = new Array(side * side);
  for (let dy = -MAXS; dy <= MAXS; dy++) for (let dx = -MAXS; dx <= MAXS; dx++) surf[(dy + MAXS) * side + (dx + MAXS)] = +((at(dx, dy) - mean) / sd).toFixed(2);
  return { east: sx * mpp, north: -sy * mpp, psr: (bv - mean) / sd, lines: nl, mpp, side, MAXS, surf };
};


const WINDOWS_M = [[0, 0], [500, 400], [-500, -400], [500, -400], [-500, 400]];

async function googleTiles(ctx, lon, lat, z = 17, N = 1024, S = 256) {
  const n = 2 ** z, latR = (lat * Math.PI) / 180;
  const cx = Math.floor(((lon + 180) / 360) * n), cy = Math.floor(((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n);
  const per = N / S, tx0 = cx - per / 2, ty0 = cy - per / 2;
  const imgs = [];
  for (let j = 0; j < per; j++) for (let i = 0; i < per; i++) {
    const r = await ctx.request.get(`https://mt1.google.com/vt/lyrs=s&x=${tx0 + i}&y=${ty0 + j}&z=${z}`, { timeout: 30000 });
    imgs.push(r.ok() ? (await r.body()).toString("base64") : null);
  }
  return { tx0, ty0, z, imgs, N, S };
}

/** Summed-surface fit against Google imagery: { east, north, psr, support, windows } or { err }. */
export async function googleFitSummed(page, ctx, gis, lon, lat) {
  const wins = [];
  for (const [de, dn] of WINDOWS_M) {
    const t = await googleTiles(ctx, lon + de / (111320 * Math.cos((lat * Math.PI) / 180)), lat + dn / 110574);
    const r = await page.evaluate(REGISTER, { gis, ...t });
    if (!r.err) wins.push(r);
  }
  if (wins.length < 3) return { err: "only " + wins.length + " windows with parcel lines" };
  const { side, MAXS: M, mpp } = wins[0];
  const sum = new Float64Array(side * side);
  for (const w of wins) for (let i = 0; i < sum.length; i++) sum[i] += w.surf[i];
  let b = -1e9, bi = 0, m = 0, m2 = 0;
  for (let i = 0; i < sum.length; i++) { m += sum[i]; m2 += sum[i] * sum[i]; if (sum[i] > b) (b = sum[i]), (bi = i); }
  m /= sum.length;
  const sd = Math.sqrt(m2 / sum.length - m * m);
  const px = bi % side, py = Math.floor(bi / side);
  const support = wins.filter((w) => { let t = -9; for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) t = Math.max(t, w.surf[(py + dy) * side + px + dx] ?? -9); return t >= 3; }).length;
  return { east: (px - M) * mpp, north: -(py - M) * mpp, psr: (b - m) / sd, support, windows: wins.length };
}
