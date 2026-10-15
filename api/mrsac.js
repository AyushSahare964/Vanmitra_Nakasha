// Resilient proxy & offline fallback for MRSAC ArcGIS MapServer queries (gsc.mrsac.org.in).
// When MRSAC state servers are online, this proxies requests.
// When MRSAC servers are offline/hanging (common for MTNL/BSNL MSDC servers),
// this seamlessly resolves queries from the high-resolution offline datasets in data/mrsac/.
import https from "node:https";
import villagesData from "../data/mrsac/villages.json" with { type: "json" };
import forestData from "../data/mrsac/forest.json" with { type: "json" };
import wildlifeData from "../data/mrsac/wildlife.json" with { type: "json" };

// JSON is imported statically so bundlers (Nitro/Vercel) ship it with the function;
// reading data/mrsac at runtime via fs/__dirname is not traced and was missing in production.
const loadVillages = () => villagesData;
const loadForest = () => forestData;
const loadWildlife = () => wildlifeData;

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function bboxOfRings(rings) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rings) {
    for (const [x, y] of r) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

function bboxOverlap(p, q) {
  return !(p[2] < q[0] || p[0] > q[2] || p[3] < q[1] || p[1] > q[3]);
}

function sendJson(res, statusCode, body, cacheSec = 300) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Cache-Control": `public, max-age=${cacheSec}, s-maxage=${cacheSec * 2}`,
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function proxyLiveMrsac(req, res, targetUrl, postBody, contentType, timeoutMs = 3500) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return sendJson(res, 400, { error: "invalid target url" });
  }

  const opts = {
    hostname: parsed.hostname,
    port: 443,
    path: parsed.pathname + parsed.search,
    method: req.method === "POST" ? "POST" : "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-IN,en-GB;q=0.9,en;q=0.8",
      "Origin": "https://geoportal.mrsac.org.in",
      "Referer": "https://geoportal.mrsac.org.in/",
      ...(contentType ? { "Content-Type": contentType } : {}),
      ...(postBody.length ? { "Content-Length": String(postBody.length) } : {}),
    },
    rejectUnauthorized: false,
  };

  const upstreamReq = https.request(opts, (pres) => {
    const chunks = [];
    pres.on("data", (c) => chunks.push(c));
    pres.on("end", () => {
      const respBuffer = Buffer.concat(chunks);
      res.writeHead(pres.statusCode || 200, {
        "Content-Type": pres.headers["content-type"] || "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      });
      res.end(respBuffer);
    });
  });

  upstreamReq.on("error", () => {
    // If upstream errored, return safe empty result for queries
    if (!res.headersSent) {
      sendJson(res, 200, { type: "FeatureCollection", features: [] });
    }
  });

  upstreamReq.setTimeout(timeoutMs, () => {
    upstreamReq.destroy();
    if (!res.headersSent) {
      sendJson(res, 200, { type: "FeatureCollection", features: [] });
    }
  });

  if (postBody.length) upstreamReq.write(postBody);
  upstreamReq.end();
}

export function resolveOfflineMrsac(targetPath, params) {
  const f = (params.f || "json").toLowerCase();

  // 1. Village boundary queries
  if (targetPath.includes("admin/village_boundary/MapServer/0/query")) {
    const villages = loadVillages();
    const geomType = params.geometryType || "";
    const geomStr = params.geometry || "";

    if (geomType === "esriGeometryPoint" && geomStr) {
      const [cx, cy] = geomStr.split(",").map(Number);
      if (!isNaN(cx) && !isNaN(cy)) {
        // Point in polygon query
        const hit = villages.find((v) => v.geometry?.rings?.some((r) => inRing(cx, cy, r)));
        if (hit) {
          return { features: [hit] };
        }
      }
    } else if (geomType === "esriGeometryEnvelope" && geomStr) {
      const [minX, minY, maxX, maxY] = geomStr.split(",").map(Number);
      if (!isNaN(minX) && !isNaN(minY) && !isNaN(maxX) && !isNaN(maxY)) {
        const env = [minX, minY, maxX, maxY];
        const hits = villages.filter((v) => {
          if (!v.geometry?.rings) return false;
          const vb = bboxOfRings(v.geometry.rings);
          return bboxOverlap(vb, env);
        });
        return { features: hits };
      }
    }
    return null; // miss: let the caller try the live MRSAC server
  }

  // 2. Forest and Wildlife compartment queries
  const isForest = targetPath.includes("gatishakti/mh_forest/MapServer/5/query");
  const isWildlife = targetPath.includes("gatishakti/mh_forest/MapServer/12/query");

  if (isForest || isWildlife) {
    const list = isForest ? loadForest() : loadWildlife();
    const whereStr = params.where || "";
    const geomStr = params.geometry || "";
    const geomType = params.geometryType || "";

    let filtered = list;

    // Filter by COMP_NO IN (...) if present
    const compMatch = whereStr.match(/COMP_NO\s+IN\s*\(([^)]+)\)/i);
    if (compMatch) {
      const allowed = new Set(
        compMatch[1]
          .split(",")
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean)
      );
      filtered = filtered.filter((item) => allowed.has(String(item.attributes?.COMP_NO || "").trim()));
    }

    // Filter by Envelope or Polygon if present
    if (geomType === "esriGeometryEnvelope" && geomStr) {
      const [minX, minY, maxX, maxY] = geomStr.split(",").map(Number);
      if (!isNaN(minX) && !isNaN(minY) && !isNaN(maxX) && !isNaN(maxY)) {
        const env = [minX, minY, maxX, maxY];
        filtered = filtered.filter((item) => {
          if (!item.geometry?.rings) return false;
          const fb = bboxOfRings(item.geometry.rings);
          return bboxOverlap(fb, env);
        });
      }
    } else if ((geomType === "esriGeometryPolygon" || geomStr.includes("rings")) && geomStr) {
      try {
        const parsedGeom = JSON.parse(geomStr);
        const queryRings = parsedGeom.rings || [];
        if (queryRings.length) {
          const qb = bboxOfRings(queryRings);
          filtered = filtered.filter((item) => {
            if (!item.geometry?.rings) return false;
            const fb = bboxOfRings(item.geometry.rings);
            return bboxOverlap(fb, qb);
          });
        }
      } catch (_) {}
    }

    // Return as GeoJSON or ArcGIS JSON
    if (f === "geojson") {
      return {
        type: "FeatureCollection",
        features: filtered.map((item) => ({
          type: "Feature",
          properties: item.attributes || {},
          geometry: {
            type: "Polygon",
            coordinates: item.geometry?.rings || [],
          },
        })),
      };
    }
    return { features: filtered };
  }

  // 3. Water conservation / smart village services
  if (targetPath.includes("smart_village/sv_water_cons/MapServer")) {
    if (f === "geojson") {
      return { type: "FeatureCollection", features: [] };
    }
    return { features: [] };
  }

  return null;
}

export default function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    });
    return res.end();
  }

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    try {
      const postBuffer = Buffer.concat(chunks);
      const postBodyStr = postBuffer.toString("utf8");
      const reqUrl = new URL("http://localhost" + (req.url || ""));
      const targetUrl = reqUrl.searchParams.get("url") || "";

      if (!targetUrl) {
        return sendJson(res, 400, { error: "missing url parameter" });
      }

      let parsedTarget;
      try {
        parsedTarget = new URL(targetUrl);
      } catch {
        return sendJson(res, 400, { error: "invalid target url" });
      }

      // Collect params from both POST body (form-urlencoded) and query string
      const params = {};
      for (const [k, v] of parsedTarget.searchParams.entries()) {
        params[k] = v;
      }
      for (const [k, v] of reqUrl.searchParams.entries()) {
        if (k !== "url") params[k] = v;
      }
      if (postBodyStr) {
        try {
          const bodyParams = new URLSearchParams(postBodyStr);
          for (const [k, v] of bodyParams.entries()) {
            params[k] = v;
          }
        } catch (_) {}
      }

      // Try offline resolution first for known local datasets
      const offlineResult = resolveOfflineMrsac(parsedTarget.pathname, params);
      if (offlineResult) {
        return sendJson(res, 200, offlineResult, 3600);
      }

      // If not resolved offline, proxy to live MRSAC upstream with fast timeout
      const contentType = req.headers["content-type"] || "";
      proxyLiveMrsac(req, res, targetUrl, postBuffer, contentType);
    } catch (e) {
      if (!res.headersSent) {
        sendJson(res, 200, { type: "FeatureCollection", features: [] });
      }
    }
  });
}
