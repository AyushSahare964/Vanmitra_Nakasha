/**
 * Registers a village's raw MahaBhuNakasha parcel lines to satellite imagery.
 *
 * Why: the portal's village maps are not offset by one constant. Measured per village the shift to the imagery varies
 * from roughly E-25..+12 m / N-85..0 m, so the 8-seed regional guess is often 30-60 m off. Here the parcel-line
 * raster and the imagery edge map are cross-correlated (FFT) and the correlation peak is the shift that lays the
 * parcels on the field boundaries / roads they follow.
 *
 * Runs in a worker (about 1 s of CPU per window). Imagery is ESRI World Imagery: its tiles send CORS headers, and it
 * agrees with the Google basemap to 2-4 m (measured), so the result holds for either basemap.
 */

export interface RegisterRequest {
  id: number;
  gis: string;
  lon: number;
  lat: number;
}
export interface RegisterResult {
  id: number;
  err?: string;
  /** Metres to move the portal data (east, north) so it lands on the imagery. */
  east?: number;
  north?: number;
  /** Peak-to-sidelobe ratio: how distinct the correlation peak is. */
  psr?: number;
  lines?: number;
  /** z-scored correlation over the +-MAXS search area (side x side, row = north-south), summed across windows by the caller. */
  surf?: Float32Array;
  side?: number;
  maxs?: number;
  mpp?: number;
}

const Z = 17;
const S = 256;
const N = 1024; // 4x4 tiles
const O = 20037508.34;
const MPP = (2 * O) / (S * 2 ** Z);

const tileOf = (lon: number, lat: number) => {
  const n = 2 ** Z;
  const latR = (lat * Math.PI) / 180;
  return [Math.floor(((lon + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n)] as const;
};

function blur(src: Float32Array, sigma: number): Float32Array {
  const r = Math.ceil(sigma * 3);
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) sum += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i]! /= sum;
  const tmp = new Float32Array(N * N);
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += src[y * N + Math.min(N - 1, Math.max(0, x + i))]! * k[i + r]!;
      tmp[y * N + x] = s;
    }
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += tmp[Math.min(N - 1, Math.max(0, y + i)) * N + x]! * k[i + r]!;
      out[y * N + x] = s;
    }
  return out;
}

function fft1(re: Float64Array, im: Float64Array, n: number, inv: boolean) {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inv ? -2 : 2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = i + k + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a]! += tr;
        im[a]! += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) (re[i]! /= n), (im[i]! /= n);
}

function fft2(re: Float64Array, im: Float64Array, inv: boolean) {
  const rr = new Float64Array(N);
  const ri = new Float64Array(N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) (rr[x] = re[y * N + x]!), (ri[x] = im[y * N + x]!);
    fft1(rr, ri, N, inv);
    for (let x = 0; x < N; x++) (re[y * N + x] = rr[x]!), (im[y * N + x] = ri[x]!);
  }
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) (rr[y] = re[y * N + x]!), (ri[y] = im[y * N + x]!);
    fft1(rr, ri, N, inv);
    for (let y = 0; y < N; y++) (re[y * N + x] = rr[y]!), (im[y * N + x] = ri[y]!);
  }
}

function prep(a: Float32Array) {
  let m = 0;
  for (let i = 0; i < N * N; i++) m += a[i]!;
  m /= N * N;
  const re = new Float64Array(N * N);
  const im = new Float64Array(N * N);
  for (let y = 0; y < N; y++) {
    const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * y) / (N - 1));
    for (let x = 0; x < N; x++) re[y * N + x] = (a[y * N + x]! - m) * (0.5 - 0.5 * Math.cos((2 * Math.PI * x) / (N - 1))) * wy;
  }
  return { re, im };
}

async function register(req: RegisterRequest): Promise<RegisterResult> {
  const [cx, cy] = tileOf(req.lon, req.lat);
  const per = N / S;
  const tx0 = cx - per / 2;
  const ty0 = cy - per / 2;
  const mx0 = -O + tx0 * S * MPP;
  const my1 = O - ty0 * S * MPP;

  // imagery mosaic
  const cv = new OffscreenCanvas(N, N);
  const ctx = cv.getContext("2d")!;
  await Promise.all(
    Array.from({ length: per * per }, async (_, k) => {
      const i = k % per;
      const j = Math.floor(k / per);
      const r = await fetch(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${ty0 + j}/${tx0 + i}`, { mode: "cors" });
      if (!r.ok) throw new Error(`imagery tile ${r.status}`);
      ctx.drawImage(await createImageBitmap(await r.blob()), i * S, j * S);
    })
  );
  const d = ctx.getImageData(0, 0, N, N).data;
  const gray = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) gray[i] = 0.3 * d[i * 4]! + 0.59 * d[i * 4 + 1]! + 0.11 * d[i * 4 + 2]!;
  const g1 = blur(gray, 1.2);
  const grad = new Float32Array(N * N);
  for (let y = 1; y < N - 1; y++)
    for (let x = 1; x < N - 1; x++) grad[y * N + x] = Math.hypot(g1[y * N + x + 1]! - g1[y * N + x - 1]!, g1[(y + 1) * N + x]! - g1[(y - 1) * N + x]!);
  const cap = Float32Array.from(grad).sort()[Math.floor(N * N * 0.99)]!;
  for (let i = 0; i < N * N; i++) if (grad[i]! > cap) grad[i] = cap;
  const E = blur(grad, 2);

  // the portal's own parcel lines for exactly this mosaic (no calibration)
  const q = new URLSearchParams({
    SERVICE: "WMS", VERSION: "1.1.1", REQUEST: "GetMap", LAYERS: "VILLAGE_MAP", STYLES: "VILLAGE_MAP", state: "27", gis_code: req.gis,
    TRANSPARENT: "true", FORMAT: "image/png", SRS: "EPSG:3857", WIDTH: String(N), HEIGHT: String(N),
    BBOX: [mx0, my1 - N * MPP, mx0 + N * MPP, my1].map((n) => n.toFixed(3)).join(","),
  });
  const wr = await fetch("/bhunaksha/WMS?" + q);
  if (!wr.ok) throw new Error(`WMS ${wr.status}`);
  const c2 = new OffscreenCanvas(N, N);
  const x2 = c2.getContext("2d")!;
  x2.drawImage(await createImageBitmap(await wr.blob()), 0, 0, N, N);
  const p = x2.getImageData(0, 0, N, N).data;
  const lines = new Float32Array(N * N);
  let nl = 0;
  for (let i = 0; i < N * N; i++) if (p[i * 4 + 3]! > 100 && p[i * 4]! < 110 && p[i * 4 + 1]! < 110 && p[i * 4 + 2]! < 110) (lines[i] = 1), nl++;
  if (nl < 1500) return { id: req.id, err: `too few parcel lines in this window (${nl})`, lines: nl };
  const P = blur(lines, 2);

  const A = prep(E);
  const B = prep(P);
  fft2(A.re, A.im, false);
  fft2(B.re, B.im, false);
  const cr = new Float64Array(N * N);
  const ci = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) {
    cr[i] = A.re[i]! * B.re[i]! + A.im[i]! * B.im[i]!;
    ci[i] = A.im[i]! * B.re[i]! - A.re[i]! * B.im[i]!;
  }
  fft2(cr, ci, true);

  const MAXS = Math.round(200 / MPP);
  const at = (dx: number, dy: number) => cr[((dy + N) % N) * N + ((dx + N) % N)]!;
  let bx = 0, by = 0, bv = -Infinity, sum = 0, sum2 = 0, cnt = 0;
  for (let dy = -MAXS; dy <= MAXS; dy++)
    for (let dx = -MAXS; dx <= MAXS; dx++) {
      const v = at(dx, dy);
      sum += v;
      sum2 += v * v;
      cnt++;
      if (v > bv) (bv = v), (bx = dx), (by = dy);
    }
  const mean = sum / cnt;
  const sd = Math.sqrt(sum2 / cnt - mean * mean);
  const side = 2 * MAXS + 1;
  const surf = new Float32Array(side * side);
  for (let dy = -MAXS; dy <= MAXS; dy++) for (let dx = -MAXS; dx <= MAXS; dx++) surf[(dy + MAXS) * side + (dx + MAXS)] = (at(dx, dy) - mean) / sd;
  return { id: req.id, east: bx * MPP, north: -by * MPP, psr: (bv - mean) / sd, lines: nl, surf, side, maxs: MAXS, mpp: MPP };
}

self.onmessage = async (e: MessageEvent<RegisterRequest>) => {
  try {
    const r = await register(e.data);
    (self as unknown as Worker).postMessage(r, r.surf ? [r.surf.buffer] : []);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: e.data.id, err: (err as Error)?.message || "registration failed" } satisfies RegisterResult);
  }
};
