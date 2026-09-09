// Project Vite configuration for TanStack Start and MahaBhuNakasha WebGIS engine
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import https from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";

// Session cookie cache for MahaBhuNakasha portal
let cachedCookie = "";
let lastCookieTime = 0;

async function getSessionCookie(): Promise<string> {
  const now = Date.now();
  if (cachedCookie && now - lastCookieTime < 15 * 60 * 1000) return cachedCookie;
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "mahabhunakasha.mahabhumi.gov.in",
        port: 443,
        path: "/27/index.html",
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        rejectUnauthorized: false,
      },
      (res) => {
        const setCookies = res.headers["set-cookie"] || [];
        const cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
        if (cookie) {
          cachedCookie = cookie;
          lastCookieTime = Date.now();
        }
        resolve(cachedCookie);
      }
    );
    req.on("error", () => resolve(cachedCookie));
    req.setTimeout(8000, () => req.destroy());
    req.end();
  });
}

function handleBhuNaksha(req: IncomingMessage, res: ServerResponse) {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const body = Buffer.concat(chunks);
    const cookie = await getSessionCookie();
    const targetPath = (req.url || "").replace(/^\/bhunaksha/, "");

    // Correct BhuNaksha's UTM Zone 44->43 offset for Eastern Maharashtra (Vidarbha) Urban CTSO maps.
    // Districts 08, 09, 10, 11, 12, 13 were stored by NIC with a 6.0° westward shift.
    // When OpenLayers queries at real-world longitude (~79°), we shift BBOX back to BhuNaksha's (~73°) coordinate system.
    let finalPath = targetPath;
    try {
      if (targetPath.startsWith("/WMS")) {
        const u = new URL("http://localhost" + targetPath);
        const gisCode = u.searchParams.get("gis_code") || u.searchParams.get("giscode") || "";
        const isVidarbhaUrban = /^UCM(08|09|10|11|12|13)/i.test(gisCode);
        const bboxStr = u.searchParams.get("BBOX");
        if (isVidarbhaUrban && bboxStr) {
          const [minX, minY, maxX, maxY] = bboxStr.split(",").map(Number);
          if (minX != null && minY != null && maxX != null && maxY != null && !isNaN(minX) && !isNaN(minY) && !isNaN(maxX) && !isNaN(maxY)) {
            const srs = (u.searchParams.get("SRS") || u.searchParams.get("CRS") || "").toUpperCase();
            if (srs.includes("3857")) {
              const shiftMeters = 6.0 * (20037508.34 / 180);
              u.searchParams.set("BBOX", [minX - shiftMeters, minY, maxX - shiftMeters, maxY].join(","));
              finalPath = u.pathname + u.search;
            } else if (srs.includes("4326")) {
              u.searchParams.set("BBOX", [minX - 6.0, minY, maxX - 6.0, maxY].join(","));
              finalPath = u.pathname + u.search;
            }
          }
        }
      }
    } catch (_) {}

    const makeReq = (path: string, currentCookie: string, redirects = 0) => {
      if (redirects > 3) {
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Too many redirects from BhuNaksha" }));
        }
        return;
      }
      const opts: https.RequestOptions = {
        hostname: "mahabhunakasha.mahabhumi.gov.in",
        port: 443,
        path,
        method: req.method,
        headers: {
          ...req.headers,
          host: "mahabhunakasha.mahabhumi.gov.in",
          referer: "https://mahabhunakasha.mahabhumi.gov.in/27/index.html",
          origin: "https://mahabhunakasha.mahabhumi.gov.in",
          ...(currentCookie ? { cookie: currentCookie } : {}),
          "x-requested-with": "XMLHttpRequest",
          ...(body.length ? { "content-length": body.length } : {}),
        },
        rejectUnauthorized: false,
      };
      const pr = https.request(opts, (pres) => {
        if (pres.headers["set-cookie"]) {
          const nc = pres.headers["set-cookie"].map((c) => c.split(";")[0]).join("; ");
          if (nc) {
            cachedCookie = nc;
            lastCookieTime = Date.now();
          }
        }
        if ((pres.statusCode === 301 || pres.statusCode === 302) && pres.headers.location) {
          const loc = pres.headers.location.startsWith("http")
            ? new URL(pres.headers.location).pathname + new URL(pres.headers.location).search
            : pres.headers.location;
          makeReq(loc, cachedCookie || currentCookie, redirects + 1);
          return;
        }
        res.writeHead(pres.statusCode || 200, pres.headers);
        pres.pipe(res);
      });
      pr.on("error", (e) => {
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "BhuNaksha gateway error", message: e.message }));
        }
      });
      if (body.length) pr.write(body);
      pr.end();
    };

    makeReq(finalPath, cookie);
  });
}

function handleReverseGeocode(req: IncomingMessage, res: ServerResponse) {
  try {
    const u = new URL("http://localhost" + (req.url || ""));
    const lat = u.searchParams.get("lat");
    const lon = u.searchParams.get("lon");
    if (!lat || !lon) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing lat or lon parameter" }));
      return;
    }
    const opts: https.RequestOptions = {
      hostname: "nominatim.openstreetmap.org",
      port: 443,
      path: `/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=18&addressdetails=1`,
      method: "GET",
      headers: {
        "User-Agent": "VANMITRA-Nakasha-GIS/1.0 (Maharashtra Land Records Intelligence)",
        "Accept": "application/json",
      },
      rejectUnauthorized: false,
    };
    const nr = https.request(opts, (pres) => {
      res.writeHead(pres.statusCode || 200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      pres.pipe(res);
    });
    nr.on("error", (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify({ error: "Reverse geocode error", message: err.message }));
      }
    });
    nr.setTimeout(8000, () => {
      nr.destroy();
      if (!res.headersSent) {
        res.writeHead(504, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify({ error: "Reverse geocode timeout" }));
      }
    });
    nr.end();
  } catch (e: any) {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ error: e?.message || "Internal error" }));
    }
  }
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    server: { entry: "server" },
  },
  vite: {
    server: {
      watch: {
        ignored: ["**/docs/**", "**/resources/**", "**/scratch/**"],
      },
    },
    plugins: [
      {
        name: "bhunaksha-session-proxy",
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url && req.url.startsWith("/bhunaksha")) {
              handleBhuNaksha(req, res);
            } else if (req.url && req.url.startsWith("/api/reverse-geocode")) {
              handleReverseGeocode(req, res);
            } else {
              next();
            }
          });
        },
      },
    ],
  },
});
