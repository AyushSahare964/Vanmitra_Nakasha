// Vercel Serverless Function: MahaBhuNakasha WMS & GeoData Proxy
import https from "node:https";

// Reused TLS connections: the portal is far from the function, so a fresh handshake per tile is costly.
const agent = new https.Agent({ keepAlive: true, maxSockets: 16, keepAliveMsecs: 10000 });

let cachedCookie = "";
let lastCookieTime = 0;

async function getSessionCookie() {
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

export default async function handler(req, res) {
  // Fast return for CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    });
    res.end();
    return;
  }

  // Read request body if present
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);

  const cookie = await getSessionCookie();
  
  // Extract target path from query or URL
  let targetPath = (req.url || "").replace(/^\/api\/bhunaksha/, "").replace(/^\/bhunaksha/, "");
  if (!targetPath || targetPath.startsWith("?")) {
    const match = req.query?.path || "";
    targetPath = "/" + (Array.isArray(match) ? match.join("/") : match);
    const searchIdx = req.url.indexOf("?");
    if (searchIdx !== -1) {
      const q = new URLSearchParams(req.url.slice(searchIdx));
      q.delete("path");
      const qs = q.toString();
      if (qs) targetPath += (targetPath.includes("?") ? "&" : "?") + qs;
    }
  }

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

  const makeReq = (p, currentCookie, redirects = 0, tries = 0) => {
    if (redirects > 3) {
      res.status(502).json({ error: "Too many redirects from BhuNaksha" });
      return;
    }

    const headers = {
      ...req.headers,
      host: "mahabhunakasha.mahabhumi.gov.in",
      referer: "https://mahabhunakasha.mahabhumi.gov.in/27/index.html",
      origin: "https://mahabhunakasha.mahabhumi.gov.in",
      ...(currentCookie ? { cookie: currentCookie } : {}),
      "x-requested-with": "XMLHttpRequest",
      ...(body.length ? { "content-length": body.length } : {}),
    };
    delete headers.connection;

    const opts = {
      hostname: "mahabhunakasha.mahabhumi.gov.in",
      port: 443,
      path: p,
      method: req.method,
      headers,
      rejectUnauthorized: false,
      agent,
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
      const respHeaders = { ...pres.headers };
      delete respHeaders["content-security-policy"];
      delete respHeaders["x-frame-options"];
      delete respHeaders["transfer-encoding"];
      if (pres.statusCode === 200 && /WMS/.test(p) && /image\//.test(String(pres.headers["content-type"]))) { respHeaders["cache-control"] = "public, max-age=3600, s-maxage=86400"; delete respHeaders["pragma"]; delete respHeaders["expires"]; }
      respHeaders["access-control-allow-origin"] = "*";
      respHeaders["access-control-allow-methods"] = "GET, POST, OPTIONS";
      respHeaders["access-control-allow-headers"] = "*";
      res.writeHead(pres.statusCode || 200, respHeaders);
      pres.pipe(res);
    });

    pr.on("error", (e) => {
      if (res.destroyed || res.writableEnded) return; // client already left: no retry
      // The portal randomly resets ~1 in 4 calls; a resend almost always succeeds.
      if (!res.headersSent && tries < 2) return void setTimeout(() => makeReq(p, cachedCookie || currentCookie, redirects, tries + 1), 400);
      if (!res.headersSent) {
        res.status(502).json({ error: "BhuNaksha gateway error", message: e.message });
      }
    });

    // Fail fast instead of holding the connection while the portal hangs.
    // Browser gave up (navigated / panned / aborted): stop the portal call instead of letting it run to 90 s.
    // res (not req) 'close': req 'close' also fires on a normal finished request body.
    res.on("close", () => { if (!res.writableEnded) pr.destroy(); });
    pr.setTimeout(90000, () => pr.destroy(new Error("BhuNaksha did not answer within 90s")));
    if (body.length) pr.write(body);
    pr.end();
  };

  makeReq(finalPath, cookie);
}
