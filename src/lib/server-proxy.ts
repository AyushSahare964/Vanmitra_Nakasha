import https from "node:https";
import { URL as NodeURL } from "node:url";
import type { IncomingMessage } from "node:http";
// @ts-ignore
import { resolveOfflineMrsac } from "../../api/mrsac.js";

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

const CFR_LAYERS = new Set(["mh_villages_en", "mh_cfr_potential_villages", "mh_cfr_recognized_villages"]);

async function handleCfr(url: URL): Promise<Response> {
  const layer = url.searchParams.get("layer") || "";
  const lon = Number(url.searchParams.get("lon"));
  const lat = Number(url.searchParams.get("lat"));

  if (!CFR_LAYERS.has(layer) || !(lon > 70 && lon < 84) || !(lat > 14 && lat < 24)) {
    return new Response(JSON.stringify({ error: "bad request" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  const d = 0.0002;
  const q = new URLSearchParams({
    service: "WMS",
    version: "1.1.1",
    request: "GetFeatureInfo",
    layers: `cfr:${layer}`,
    query_layers: `cfr:${layer}`,
    styles: "",
    bbox: `${lon - d},${lat - d},${lon + d},${lat + d}`,
    width: "101",
    height: "101",
    srs: "EPSG:4326",
    x: "50",
    y: "50",
    info_format: "application/json",
    feature_count: "1",
  });

  return new Promise((resolve) => {
    const up = https.get(
      {
        hostname: "cfr.atree.org",
        path: `/geoserver/cfr/wms?${q}`,
        headers: { Accept: "application/json" },
        rejectUnauthorized: false,
      },
      (pres) => {
        let raw = "";
        pres.on("data", (c) => (raw += c));
        pres.on("end", () => {
          try {
            const data = JSON.parse(raw);
            const f = data.features?.[0];
            resolve(
              new Response(JSON.stringify({ properties: f?.properties ?? null, ...(url.searchParams.get("geom") ? { geometry: f?.geometry ?? null } : {}) }), {
                status: 200,
                headers: {
                  "Content-Type": "application/json",
                  "Access-Control-Allow-Origin": "*",
                  "Cache-Control": "public, max-age=3600, s-maxage=86400",
                },
              })
            );
          } catch {
            resolve(
              new Response(JSON.stringify({ error: "bad upstream response" }), {
                status: 502,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
              })
            );
          }
        });
      }
    );
    up.setTimeout(8000, () => up.destroy());
    up.on("error", () => {
      resolve(
        new Response(JSON.stringify({ error: "upstream unreachable" }), {
          status: 502,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        })
      );
    });
  });
}

async function handleReverseGeocode(url: URL): Promise<Response> {
  const lat = url.searchParams.get("lat");
  const lon = url.searchParams.get("lon");
  if (!lat || !lon) {
    return new Response(JSON.stringify({ error: "lat and lon are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  return new Promise((resolve) => {
    const opts = {
      hostname: "nominatim.openstreetmap.org",
      port: 443,
      path: `/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=18&addressdetails=1`,
      method: "GET",
      headers: {
        "User-Agent": "VANMITRA-Nakasha-GIS/1.0 (Maharashtra Land Records Intelligence)",
        Accept: "application/json",
      },
    };
    const req = https.request(opts, (pres) => {
      const chunks: Buffer[] = [];
      pres.on("data", (c) => chunks.push(c));
      pres.on("end", () => {
        resolve(
          new Response(Buffer.concat(chunks), {
            status: pres.statusCode || 200,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          })
        );
      });
    });
    req.on("error", (err) => {
      resolve(
        new Response(JSON.stringify({ error: "Reverse geocode error", message: err.message }), {
          status: 502,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        })
      );
    });
    req.setTimeout(8000, () => {
      req.destroy();
      resolve(
        new Response(JSON.stringify({ error: "Reverse geocode timeout" }), {
          status: 504,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        })
      );
    });
    req.end();
  });
}

async function handleBhuNaksha(request: Request, url: URL): Promise<Response> {
  const cookie = await getSessionCookie();
  let targetPath = url.pathname.replace(/^\/api\/bhunaksha/, "").replace(/^\/bhunaksha/, "");
  if (!targetPath) targetPath = "/";
  if (url.search) targetPath += url.search;

  // Correct BhuNaksha's UTM Zone 44->43 offset for Eastern Maharashtra (Vidarbha) Urban CTSO maps
  let finalPath = targetPath;
  try {
    if (targetPath.includes("/WMS")) {
      const u = new URL("http://localhost" + targetPath);
      const gisCode = u.searchParams.get("gis_code") || u.searchParams.get("giscode") || "";
      const isVidarbhaUrban = /^UCM(08|09|10|11|12|13)/i.test(gisCode);
      const bboxStr = u.searchParams.get("BBOX");
      if (isVidarbhaUrban && bboxStr) {
        const [minX, minY, maxX, maxY] = bboxStr.split(",").map(Number);
        if (
          minX != null &&
          minY != null &&
          maxX != null &&
          maxY != null &&
          !isNaN(minX) &&
          !isNaN(minY) &&
          !isNaN(maxX) &&
          !isNaN(maxY)
        ) {
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

  const bodyBuffer = request.body ? Buffer.from(await request.arrayBuffer()) : Buffer.alloc(0);

  const contentType = request.headers.get("content-type");
  const accept = request.headers.get("accept");
  let sessionCookie = cookie;

  return new Promise((resolve) => {
    const doRequest = (pathStr: string, redirects = 0, tries = 0) => {
      if (redirects > 3) {
        resolve(
          new Response(JSON.stringify({ error: "Too many redirects from BhuNaksha" }), {
            status: 502,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          })
        );
        return;
      }

      const headers: Record<string, string> = {
        host: "mahabhunakasha.mahabhumi.gov.in",
        referer: "https://mahabhunakasha.mahabhumi.gov.in/27/index.html",
        origin: "https://mahabhunakasha.mahabhumi.gov.in",
        "x-requested-with": "XMLHttpRequest",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      };
      // The portal's REST endpoints 404 a form POST that arrives without its Content-Type.
      if (contentType) headers["content-type"] = contentType;
      if (accept) headers["accept"] = accept;
      if (sessionCookie) headers["cookie"] = sessionCookie;
      if (bodyBuffer.length > 0) headers["content-length"] = String(bodyBuffer.length);

      const opts = {
        hostname: "mahabhunakasha.mahabhumi.gov.in",
        port: 443,
        path: pathStr,
        method: request.method,
        headers,
        rejectUnauthorized: false,
      };

      const pr = https.request(opts, (pres: IncomingMessage) => {
        if (pres.headers["set-cookie"]) {
          const nc = pres.headers["set-cookie"].map((c) => c.split(";")[0]).join("; ");
          if (nc) {
            cachedCookie = nc;
            sessionCookie = nc;
            lastCookieTime = Date.now();
          }
        }
        if ((pres.statusCode === 301 || pres.statusCode === 302) && pres.headers.location) {
          const loc = pres.headers.location.startsWith("http")
            ? new URL(pres.headers.location).pathname + new URL(pres.headers.location).search
            : pres.headers.location;
          doRequest(loc, redirects + 1);
          return;
        }

        const respHeaders = new Headers();
        for (const [k, v] of Object.entries(pres.headers)) {
          if (!v) continue;
          const lk = k.toLowerCase();
          if (
            lk === "content-security-policy" ||
            lk === "x-frame-options" ||
            lk === "transfer-encoding" ||
            lk === "connection"
          )
            continue;
          if (Array.isArray(v)) {
            for (const item of v) respHeaders.append(lk, item);
          } else {
            respHeaders.set(lk, v);
          }
        }
        respHeaders.set("access-control-allow-origin", "*");
        respHeaders.set("access-control-allow-methods", "GET, POST, OPTIONS");
        respHeaders.set("access-control-allow-headers", "*");

        const chunks: Buffer[] = [];
        pres.on("data", (chunk) => chunks.push(chunk));
        pres.on("end", () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: pres.statusCode || 200,
              headers: respHeaders,
            })
          );
        });
      });

      pr.on("error", (e) => {
        // The portal randomly resets ~1 in 4 calls; a resend almost always succeeds.
        if (tries < 2) {
          setTimeout(() => doRequest(pathStr, redirects, tries + 1), 400);
          return;
        }
        resolve(
          new Response(JSON.stringify({ error: "BhuNaksha gateway error", message: e.message }), {
            status: 502,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          })
        );
      });

      pr.setTimeout(90000, () => {
        pr.destroy(new Error("BhuNaksha did not answer within 90s"));
      });

      if (bodyBuffer.length) pr.write(bodyBuffer);
      pr.end();
    };

    doRequest(finalPath);
  });
}

/** Proxy for MRSAC ArcGIS MapServer queries (gsc.mrsac.org.in).
 * The browser cannot call gsc.mrsac.org.in directly due to CORS; all spatial
 * queries are forwarded server-side via /api/mrsac?url=<encoded-arcgis-url>.
 */
async function handleMrsac(request: Request, url: URL): Promise<Response> {
  const targetUrl = url.searchParams.get("url");
  if (!targetUrl) {
    return new Response(JSON.stringify({ error: "missing url parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  let parsed: NodeURL;
  try {
    parsed = new NodeURL(targetUrl);
  } catch {
    return new Response(JSON.stringify({ error: "invalid url" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  // Only allow proxying to the known MRSAC host.
  if (parsed.hostname !== "gsc.mrsac.org.in") {
    return new Response(JSON.stringify({ error: "forbidden host" }), {
      status: 403,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  const bodyBuffer = request.body ? Buffer.from(await request.arrayBuffer()) : Buffer.alloc(0);
  const contentType = request.headers.get("content-type") ?? "";

  // 1. Try local/offline resolution for pre-cached datasets (villages, forest compartments)
  const params: Record<string, string> = {};
  for (const [k, v] of parsed.searchParams.entries()) {
    params[k] = v;
  }
  for (const [k, v] of url.searchParams.entries()) {
    if (k !== "url") params[k] = v;
  }
  if (bodyBuffer.length) {
    try {
      const bodyParams = new URLSearchParams(bodyBuffer.toString("utf8"));
      for (const [k, v] of bodyParams.entries()) {
        params[k] = v;
      }
    } catch (_) {}
  }

  try {
    const offline = resolveOfflineMrsac(parsed.pathname, params);
    if (offline) {
      return new Response(JSON.stringify(offline), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }
  } catch (err) {
    console.error("[server-proxy] Offline MRSAC resolution failed:", err);
  }

  const f = (params.f || "json").toLowerCase();

  return new Promise((resolve) => {
    const opts = {
      hostname: "gsc.mrsac.org.in",
      port: 443,
      path: parsed.pathname + parsed.search,
      method: request.method === "POST" ? "POST" : "GET",
      headers: {
        // Use a browser-like UA; MRSAC may throttle/block non-browser user agents.
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/plain, */*;q=0.01",
        "Accept-Language": "en-IN,en-GB;q=0.9,en;q=0.8",
        "Origin": "https://geoportal.mrsac.org.in",
        "Referer": "https://geoportal.mrsac.org.in/",
        ...(contentType ? { "Content-Type": contentType } : {}),
        ...(bodyBuffer.length ? { "Content-Length": String(bodyBuffer.length) } : {}),
      },
      rejectUnauthorized: false,
    };

    const req = https.request(opts, (pres) => {
      const chunks: Buffer[] = [];
      pres.on("data", (c) => chunks.push(c));
      pres.on("end", () => {
        resolve(
          new Response(Buffer.concat(chunks), {
            status: pres.statusCode || 200,
            headers: {
              "Content-Type": pres.headers["content-type"] ?? "application/json",
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
              "Access-Control-Allow-Headers": "*",
              "Cache-Control": "public, max-age=300, s-maxage=600",
            },
          })
        );
      });
    });

    req.on("error", () => {
      // If live upstream fails or times out, return empty feature collection with 200
      const emptyPayload = f === "geojson" ? { type: "FeatureCollection", features: [] } : { features: [] };
      resolve(
        new Response(JSON.stringify(emptyPayload), {
          status: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        })
      );
    });

    // 4 s fast failover for live queries so the app never hangs
    req.setTimeout(4000, () => {
      req.destroy();
      const emptyPayload = f === "geojson" ? { type: "FeatureCollection", features: [] } : { features: [] };
      resolve(
        new Response(JSON.stringify(emptyPayload), {
          status: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        })
      );
    });

    if (bodyBuffer.length) req.write(bodyBuffer);
    req.end();
  });
}

export async function handleServerProxy(request: Request): Promise<Response | null> {
  const url = new URL(request.url);

  if (
    request.method === "OPTIONS" &&
    (url.pathname.startsWith("/bhunaksha") ||
      url.pathname.startsWith("/api/bhunaksha") ||
      url.pathname.startsWith("/api/cfr") ||
      url.pathname.startsWith("/api/mrsac") ||
      url.pathname.startsWith("/api/reverse-geocode"))
  ) {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
    });
  }

  if (url.pathname.startsWith("/bhunaksha") || url.pathname.startsWith("/api/bhunaksha")) {
    return handleBhuNaksha(request, url);
  }

  if (url.pathname === "/api/cfr") {
    return handleCfr(url);
  }

  if (url.pathname === "/api/reverse-geocode") {
    return handleReverseGeocode(url);
  }

  if (url.pathname === "/api/mrsac") {
    return handleMrsac(request, url);
  }

  return null;
}
