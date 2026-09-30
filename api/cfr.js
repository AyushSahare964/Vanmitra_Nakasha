// Read-only proxy for ATREE's CFR GeoServer point lookup (their WMS GetFeatureInfo sends no CORS header).
// Allow-listed: only these three layers, only a tiny box around one point, only properties are returned.
import https from "node:https";

const LAYERS = new Set(["mh_villages_en", "mh_cfr_potential_villages", "mh_cfr_recognized_villages"]);

function send(res, status, body, cache) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    ...(cache ? { "Cache-Control": "public, max-age=3600, s-maxage=86400" } : {}),
  });
  res.end(JSON.stringify(body));
}

export default function handler(req, res) {
  try {
    const u = new URL("http://localhost" + (req.url || ""));
    const layer = u.searchParams.get("layer") || "";
    const lon = Number(u.searchParams.get("lon"));
    const lat = Number(u.searchParams.get("lat"));
    // Maharashtra-ish bounds; also rejects NaN.
    if (!LAYERS.has(layer) || !(lon > 70 && lon < 84) || !(lat > 14 && lat < 24)) {
      return send(res, 400, { error: "bad request" });
    }
    const d = 0.0002;
    const q = new URLSearchParams({
      service: "WMS", version: "1.1.1", request: "GetFeatureInfo",
      layers: `cfr:${layer}`, query_layers: `cfr:${layer}`, styles: "",
      bbox: `${lon - d},${lat - d},${lon + d},${lat + d}`,
      width: "101", height: "101", srs: "EPSG:4326", x: "50", y: "50",
      info_format: "application/json", feature_count: "1",
    });
    const up = https.get(
      { hostname: "cfr.atree.org", path: `/geoserver/cfr/wms?${q}`, headers: { Accept: "application/json" } },
      (pres) => {
        let raw = "";
        pres.on("data", (c) => (raw += c));
        pres.on("end", () => {
          try {
            const f = JSON.parse(raw).features?.[0];
            send(res, 200, { properties: f?.properties ?? null }, true);
          } catch {
            send(res, 502, { error: "bad upstream response" });
          }
        });
      }
    );
    up.setTimeout(8000, () => up.destroy());
    up.on("error", () => !res.headersSent && send(res, 502, { error: "upstream unreachable" }));
  } catch (e) {
    if (!res.headersSent) send(res, 500, { error: String(e?.message || e) });
  }
}
