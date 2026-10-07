import type { Page } from "@playwright/test";

/** Per highlighted polygon: best-fit shift (metres, east/north) that lays it on the portal's parcel lines. */
export async function measure(page: Page) {
  return page.evaluate(async () => {
    const map = (window as any).__vmMap;
    const layers = map.getLayers().getArray();
    const marker = layers.find((l: any) => l.get("name") === "plot-marker");
    const cad = layers.find((l: any) => l.get("name") === "cadastral-village");
    const src = cad.getSource();
    const gis = src.getParams().gis_code as string;

    // calibration actually applied to WMS tiles = tile-grid extent minus requested bbox
    const grid = src.getTileGridForProjection(map.getView().getProjection());
    const z = Math.max(0, Math.min(grid.getMaxZoom(), Math.round(map.getView().getZoom())));
    const c = grid.getTileCoordForCoordAndZ(map.getView().getCenter(), z);
    const url = src.getTileUrlFunction()(c, 1, map.getView().getProjection())!;
    const bb = new URL(url, location.href).searchParams.get("BBOX")!.split(",").map(Number);
    const te = grid.getTileCoordExtent(c);
    const off = [te[0]! - bb[0]!, te[1]! - bb[1]!];

    const results: any[] = [];
    const feats = marker.getSource().getFeatures().filter((f: any) => /Polygon/.test(f.getGeometry()?.getType() || ""));
    for (const f of feats.slice(0, 8)) {
      const geom = f.getGeometry();
      const rings: number[][][] = geom.getType() === "Polygon" ? geom.getCoordinates() : geom.getCoordinates().flat();
      const ext = geom.getExtent();
      const pad = 25;
      const res = 0.4; // metres per pixel at the 3857 projection
      const bx0 = ext[0] - pad, by0 = ext[1] - pad, bx1 = ext[2] + pad, by1 = ext[3] + pad;
      const W = Math.min(2000, Math.ceil((bx1 - bx0) / res)), H = Math.min(2000, Math.ceil((by1 - by0) / res));
      const rx = (bx1 - bx0) / W, ry = (by1 - by0) / H;
      // ask the portal for its own rendering of that area; requested bbox = displayed bbox - calibration (as the app does)
      const q = new URLSearchParams({ SERVICE: "WMS", VERSION: "1.1.1", REQUEST: "GetMap", LAYERS: "VILLAGE_MAP", STYLES: "VILLAGE_MAP", state: "27", gis_code: gis, TRANSPARENT: "true", FORMAT: "image/png", SRS: "EPSG:3857", WIDTH: String(W), HEIGHT: String(H), BBOX: [bx0 - off[0]!, by0 - off[1]!, bx1 - off[0]!, by1 - off[1]!].map((n) => n.toFixed(3)).join(",") });
      const blob = await (await fetch("/bhunaksha/WMS?" + q)).blob();
      const bmp = await createImageBitmap(blob);
      const cv = document.createElement("canvas");
      cv.width = bmp.width;
      cv.height = bmp.height;
      const ctx = cv.getContext("2d")!;
      ctx.drawImage(bmp, 0, 0);
      const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
      const INF = 1e9;
      const dt = new Float32Array(W * H).fill(INF);
      let lines = 0;
      for (let i = 0; i < W * H; i++) {
        const a = px[i * 4 + 3]!;
        if (a > 100 && px[i * 4]! < 110 && px[i * 4 + 1]! < 110 && px[i * 4 + 2]! < 110) (dt[i] = 0), lines++;
      }
      // two-pass chamfer distance transform (pixels)
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        let v = dt[i]!;
        if (x > 0) v = Math.min(v, dt[i - 1]! + 1);
        if (y > 0) {
          v = Math.min(v, dt[i - W]! + 1);
          if (x > 0) v = Math.min(v, dt[i - W - 1]! + 1.41);
          if (x < W - 1) v = Math.min(v, dt[i - W + 1]! + 1.41);
        }
        dt[i] = v;
      }
      for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
        const i = y * W + x;
        let v = dt[i]!;
        if (x < W - 1) v = Math.min(v, dt[i + 1]! + 1);
        if (y < H - 1) {
          v = Math.min(v, dt[i + W]! + 1);
          if (x < W - 1) v = Math.min(v, dt[i + W + 1]! + 1.41);
          if (x > 0) v = Math.min(v, dt[i + W - 1]! + 1.41);
        }
        dt[i] = v;
      }
      // sample the polygon boundary every ~1 m
      const pts: number[][] = [];
      for (const ring of rings) for (let i = 1; i < ring.length; i++) {
        const [x0, y0] = ring[i - 1]!, [x1, y1] = ring[i]!;
        const n = Math.max(1, Math.round(Math.hypot(x1! - x0!, y1! - y0!)));
        for (let k = 0; k < n; k++) pts.push([x0! + ((x1! - x0!) * k) / n, y0! + ((y1! - y0!) * k) / n]);
      }
      const cost = (dx: number, dy: number) => {
        let s = 0;
        for (const [x, y] of pts) {
          const ix = Math.round((x! + dx - bx0) / rx), iy = Math.round((by1 - (y! + dy)) / ry);
          s += ix < 0 || iy < 0 || ix >= W || iy >= H ? 60 : Math.min(60, dt[iy * W + ix]!);
        }
        return s / pts.length;
      };
      const base = cost(0, 0) * res;
      let best = { dx: 0, dy: 0, c: cost(0, 0) };
      for (let dx = -30; dx <= 30; dx += 1) for (let dy = -30; dy <= 30; dy += 1) {
        const cc = cost(dx, dy);
        if (cc < best.c) best = { dx, dy, c: cc };
      }
      results.push({ plot: f.get("plotNo") ?? f.get("plotno") ?? "?", lineShare: lines / (W * H), meanEdgeToLineM: base, bestShiftEast: best.dx, bestShiftNorth: best.dy, meanAfterShiftM: best.c * res, pts: pts.length });
    }
    return { gis, calib: off, results };
  });
}

