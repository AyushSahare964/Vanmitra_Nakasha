// Vercel Serverless Function: Nominatim Reverse Geocoding Proxy
import https from "node:https";

export default function handler(req, res) {
  try {
    const u = new URL("http://localhost" + (req.url || ""));
    const lat = u.searchParams.get("lat");
    const lon = u.searchParams.get("lon");
    if (!lat || !lon) {
      res.status(400).json({ error: "Missing lat or lon parameter" });
      return;
    }

    const opts = {
      hostname: "nominatim.openstreetmap.org",
      port: 443,
      path: `/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=18&addressdetails=1`,
      method: "GET",
      headers: {
        "User-Agent": "ADVANTE-Nakasha-GIS/1.0 (Maharashtra Land Records Intelligence)",
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
        res.status(502).json({ error: "Reverse geocode error", message: err.message });
      }
    });

    nr.setTimeout(8000, () => {
      nr.destroy();
      if (!res.headersSent) {
        res.status(504).json({ error: "Reverse geocode timeout" });
      }
    });

    nr.end();
  } catch (e) {
    if (!res.headersSent) {
      res.status(500).json({ error: e?.message || "Internal error" });
    }
  }
}
