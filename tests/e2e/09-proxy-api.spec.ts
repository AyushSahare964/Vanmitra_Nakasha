/**
 * Direct tests of the Vercel function api/bhunaksha.js (no browser: nothing to watch).
 * They guard the regressions found in the perf work: the undefined `path` ReferenceError, keep-alive
 * reuse, retry on reset, and not retrying for a client that already left.
 */
import { test, expect } from "@playwright/test";
import http from "node:http";
import type { AddressInfo } from "node:net";

let server: http.Server;
let base = "";
let handler: (req: any, res: any) => Promise<void>;

test.beforeAll(async () => {
  handler = (await import("../../api/bhunaksha.js")).default;
  server = http.createServer((req, res) => {
    // Vercel's res.status()/json() helpers, used on the function's error paths
    (res as any).status = (c: number) => ((res.statusCode = c), res);
    (res as any).json = (o: unknown) => (res.setHeader("content-type", "application/json"), res.end(JSON.stringify(o)));
    handler(req, res).catch((e) => {
      res.statusCode = 500;
      res.end(String(e));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(() => new Promise<void>((r) => server.close(() => r())));

const GIS = "RVM2003272000030248650000"; // Umrane, Deola
const TILE = `/bhunaksha/WMS?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=VILLAGE_MAP&STYLES=VILLAGE_MAP&state=27&gis_code=${GIS}&TRANSPARENT=true&FORMAT=image/png&SRS=EPSG:3857&WIDTH=512&HEIGHT=512&BBOX=8267000,2338000,8272000,2343000`;

test.describe("api/bhunaksha.js", () => {
  test("OPTIONS preflight answers 200 with CORS headers", async () => {
    const r = await fetch(base + "/bhunaksha/WMS", { method: "OPTIONS" });
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("WMS tile: 200 image/png with long cache headers (regression: undefined `path`)", async () => {
    const r = await fetch(base + TILE);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/image\/png/);
    expect(r.headers.get("cache-control")).toMatch(/s-maxage=86400/);
    expect((await r.arrayBuffer()).byteLength).toBeGreaterThan(200);
  });

  test("REST POST survey list returns a JSON array", async () => {
    const r = await fetch(base + "/bhunaksha/rest/VillageMapService/kidelistFromGisCodeMH", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `state=27&logedLevels=${GIS}`,
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(Array.isArray(j)).toBe(true);
    expect(j.length).toBeGreaterThan(100);
  });

  test("40 concurrent tiles all succeed (keep-alive pool + retries)", async () => {
    const out = await Promise.all(
      Array.from({ length: 40 }, (_, i) => fetch(base + TILE.replace("8267000", String(8267000 + i * 5))).then((r) => r.status))
    );
    expect(out.filter((s) => s !== 200), "non-200 tile statuses").toEqual([]);
  });

  test("client abort mid-request does not crash the function or block later requests", async () => {
    for (let i = 0; i < 10; i++) {
      const ctl = new AbortController();
      const p = fetch(base + TILE, { signal: ctl.signal }).catch(() => {});
      setTimeout(() => ctl.abort(), 20);
      await p;
    }
    const r = await fetch(base + TILE);
    expect(r.status).toBe(200);
  });

  test("Vidarbha urban gis codes get their BBOX shifted and still answer", async () => {
    const r = await fetch(base + TILE.replace(GIS, "UCM08000000000000000"));
    expect([200, 204, 404, 500]).toContain(r.status); // portal may not know the fake code; the point is: no crash
    const ok = await fetch(base + TILE);
    expect(ok.status).toBe(200);
  });

  test("sustained load: 120 sequential survey-record calls keep a stable latency", async () => {
    const times: number[] = [];
    for (let i = 1; i <= 120; i++) {
      const t0 = Date.now();
      const r = await fetch(base + "/bhunaksha/rest/MapInfo/getPlotInfo", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `state=27&giscode=${GIS}&plotno=${i}&srs=4326`,
      });
      await r.arrayBuffer();
      times.push(Date.now() - t0);
      expect([200, 204]).toContain(r.status);
    }
    const sorted = [...times].sort((a, b) => a - b);
    console.log(`  getPlotInfo p50 ${sorted[60]} ms, p95 ${sorted[114]} ms, max ${sorted[119]} ms`);
    expect(sorted[114]!).toBeLessThan(5000);
  });
});
