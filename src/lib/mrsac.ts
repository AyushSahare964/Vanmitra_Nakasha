/**
 * MRSAC (Maharashtra Remote Sensing Application Centre) geoportal layers: water bodies, wells,
 * rivers, forest compartments…  https://geoportal.mrsac.org.in/explore/
 *
 * These are public ArcGIS MapServers. State-wide display uses their `export` image endpoint
 * (drawn server-side, so panning stays cheap); a single village's features are fetched with a
 * spatial query against that village's polygon, so the counts and the list are for the village
 * only. The LULC service is deliberately absent: its export/query calls hang.
 */

const GSC = "https://gsc.mrsac.org.in";
const WATER = `${GSC}/server/rest/services/smart_village/sv_water_cons/MapServer`;
const FOREST = `${GSC}/webadpgis1/rest/services/gatishakti/mh_forest/MapServer`;
const VILLAGE_LAYER = `${GSC}/webadpgis1/rest/services/admin/village_boundary/MapServer/0`;

export type ResGroup = "water" | "forest";
export type ResKind = "point" | "line" | "polygon";

export interface ResLayer {
  key: string;
  group: ResGroup;
  label: string;
  mr: string;
  service: string;
  id: number;
  color: string;
  kind: ResKind;
  /** Field whose value classifies a feature (its label comes from `types` when coded). */
  typeField?: string;
  types?: Record<string, string>;
  outFields: string;
  /** Layer only draws when zoomed in (server-side scale limit). */
  zoomNote?: string;
  defaultOn: boolean;
}

const WELL_TYPES: Record<string, string> = {
  "01": "Irrigation well", "02": "Community well", "03": "Observation well (GSDA)", "04": "Intake well",
  "05": "Jack well", "06": "Stepwell", "07": "Other well", "08": "Observation cum community well",
};

const STRUCTURE_TYPES: Record<string, string> = {
  "01": "Gully plug / loose boulder", "02": "Gabion structure", "03": "Check dam", "04": "Vanrai bandhara",
  "05": "Earthen nalla bund", "06": "Cement nalla bund", "07": "Farm pond", "08": "Forest pond", "09": "Village tank",
  "10": "Percolation tank", "11": "Storage bandhara", "12": "Recharge shaft", "13": "Underground bandhara",
  "14": "Kolhapur type bandhara", "15": "De-silting of lake/pond", "16": "Bridge cum bandhara", "17": "Barrage",
  "18": "Khar bandhara", "19": "Bodi", "20": "Aquaculture tank", "21": "Other structure", "22": "Storage pond",
  "23": "Trench cum recharge shaft",
};

export const RES_LAYERS: ResLayer[] = [
  { key: "waterbody", group: "water", label: "Water bodies & lakes", mr: "जलाशय / तलाव", service: WATER, id: 8, color: "#0284c7", kind: "polygon", outFields: "WB_NAME,WB_TYPE,Shape_Area", defaultOn: true },
  { key: "well", group: "water", label: "Wells", mr: "विहिरी", service: WATER, id: 1, color: "#0e7490", kind: "point", typeField: "AssetType", types: WELL_TYPES, outFields: "AssetType,ConstructionYear,Condition", zoomNote: "Draws when zoomed in", defaultOn: true },
  { key: "structure", group: "water", label: "Water conservation structures", mr: "जलसंधारण", service: WATER, id: 0, color: "#6366f1", kind: "point", typeField: "AssetType", types: STRUCTURE_TYPES, outFields: "AssetType,ConstructionYear,Condition", zoomNote: "Draws when zoomed in", defaultOn: true },
  { key: "river", group: "water", label: "Rivers", mr: "नद्या", service: WATER, id: 6, color: "#38bdf8", kind: "polygon", outFields: "RIVNAME", defaultOn: true },
  { key: "drainage", group: "water", label: "Streams & drainage", mr: "नाले", service: WATER, id: 7, color: "#7dd3fc", kind: "line", outFields: "River_Name,Ordering", defaultOn: false },
  { key: "forest", group: "forest", label: "Forest compartments", mr: "वन कक्ष", service: FOREST, id: 5, color: "#166534", kind: "polygon", typeField: "COMP_TYPE", outFields: "COMP_NO,COMP_TYPE,CATEGORY,RANGE,BEAT,ShpAreaHa", defaultOn: true },
  { key: "reserve", group: "forest", label: "Conservation reserve", mr: "संवर्धन राखीव", service: FOREST, id: 6, color: "#4d7c0f", kind: "polygon", outFields: "Name,Area", defaultOn: true },
  { key: "wildlife", group: "forest", label: "Wildlife compartments", mr: "वन्यजीव", service: FOREST, id: 12, color: "#a16207", kind: "polygon", typeField: "COMP_TYPE", outFields: "COMP_NO,COMP_TYPE,CATEGORY,RANGE,BEAT,ShpAreaHa", defaultOn: true },
];

export const resLayerByKey = (k: string) => RES_LAYERS.find((l) => l.key === k);

/** Human label for a feature's type (coded layers map through `types`). */
export function typeLabel(layer: ResLayer, props: Record<string, unknown>): string {
  if (!layer.typeField) return layer.label;
  const raw = String(props[layer.typeField] ?? "").trim();
  if (!raw) return "Unspecified";
  return layer.types?.[raw] ?? raw;
}

/** Forest-compartment types that are not forest land at all (offices, nurseries, survey-number markers…). */
const NON_FOREST_COMP = /^(revenue area|nursery|range office|head quarter banglo|irrigation area|reservior|gut number|survey number|non protected area|new|unsurveyed|\s*)$/i;
export const isForestLandType = (t: string) => !NON_FOREST_COMP.test(t.trim());

/* ---------------- village polygon + spatial queries ---------------- */

export type Ring = [number, number][];

export interface MrsacVillage {
  name: string;
  /** Census code — the same one ATREE uses as `vlgcd2011`. */
  code: string;
  rings: Ring[];
}

export interface GeoFeature {
  type: "Feature";
  geometry: { type: string; coordinates: any };
  properties: Record<string, any>;
}

/** The ArcGIS servers answer "Error performing query operation" and hang under load; both are transient. */
export const MRSAC_UNAVAILABLE = "MRSAC (the water / forest data service) is not responding right now. Please try again.";
const MAX_CALLS = 4; // MRSAC rejects bursts: 8 layer queries at once used to trigger the transient errors
let active = 0;
const queue: (() => void)[] = [];
const slot = () => new Promise<void>((go) => (active < MAX_CALLS ? (active++, go()) : queue.push(() => go())));
const release = () => {
  const n = queue.shift();
  if (n) n();
  else active--;
};

async function arcgisOnce(url: string, params: Record<string, string>, signal?: AbortSignal): Promise<any> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30000);
  const onAbort = () => ctl.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    // POST keeps large polygon filters out of the URL; form-encoded avoids a CORS preflight.
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`MRSAC returned HTTP ${res.status}`);
    const data = await res.json();
    if (data?.error) throw new Error(data.error.message || "MRSAC query failed");
    return data;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function arcgis(url: string, params: Record<string, string>, signal?: AbortSignal): Promise<any> {
  await slot();
  try {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        return await arcgisOnce(url, params, signal);
      } catch (e) {
        if (signal?.aborted) throw e;
        last = e;
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }
    throw new Error(`${MRSAC_UNAVAILABLE}${last instanceof Error && /HTTP|timeout|abort/i.test(last.message) ? "" : ""}`);
  } finally {
    release();
  }
}

const bboxOf = (rings: Ring[]): [number, number, number, number] => {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    if (x < a) a = x;
    if (y < b) b = y;
    if (x > c) c = x;
    if (y > d) d = y;
  }
  return [a, b, c, d];
};

const overlap = (p: [number, number, number, number], q: [number, number, number, number]) => {
  const w = Math.min(p[2], q[2]) - Math.max(p[0], q[0]);
  const h = Math.min(p[3], q[3]) - Math.max(p[1], q[1]);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  const union = (p[2] - p[0]) * (p[3] - p[1]) + (q[2] - q[0]) * (q[3] - q[1]) - inter;
  return inter / union;
};

/**
 * The MRSAC village polygon that best matches a village extent (real degrees). Village
 * polygons partition the state, so the best bbox overlap is the village itself.
 */
export async function findVillage(extent: [number, number, number, number], signal?: AbortSignal): Promise<MrsacVillage | null> {
  const base = { f: "json", where: "1=1", inSR: "4326", outSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "VIL_NAME,VINCODE", returnGeometry: "true", maxAllowableOffset: "0.00005" };
  const pick = (data: any) => {
    let best: { v: MrsacVillage; score: number } | null = null;
    for (const f of data.features ?? []) {
      const rings = (f.geometry?.rings ?? []) as Ring[];
      if (!rings.length) continue;
      const score = overlap(bboxOf(rings), extent);
      if (!best || score > best.score) best = { v: { name: String(f.attributes.VIL_NAME ?? ""), code: String(f.attributes.VINCODE ?? ""), rings }, score };
    }
    return best && best.score > 0.3 ? best.v : null;
  };
  // Village polygons partition the state, so the polygon under the extent's centre is normally the village:
  // one feature instead of every village overlapping the extent (that query took 16 s on a cold server).
  const cx = (extent[0] + extent[2]) / 2;
  const cy = (extent[1] + extent[3]) / 2;
  const hit = pick(await arcgis(`${VILLAGE_LAYER}/query`, { ...base, geometry: `${cx},${cy}`, geometryType: "esriGeometryPoint" }, signal));
  if (hit) return hit;
  return pick(await arcgis(`${VILLAGE_LAYER}/query`, { ...base, geometry: extent.join(","), geometryType: "esriGeometryEnvelope" }, signal));
}

/** All features of one layer that touch the village polygon, as GeoJSON (degrees). */
export async function fetchResource(layer: ResLayer, village: MrsacVillage, signal?: AbortSignal): Promise<GeoFeature[]> {
  const data = await arcgis(
    `${layer.service}/${layer.id}/query`,
    {
      f: "geojson", where: "1=1", geometry: JSON.stringify({ rings: village.rings, spatialReference: { wkid: 4326 } }),
      geometryType: "esriGeometryPolygon", inSR: "4326", outSR: "4326", spatialRel: "esriSpatialRelIntersects",
      outFields: layer.outFields, returnGeometry: "true", ...(layer.kind === "point" ? {} : { maxAllowableOffset: "0.00002" }),
    },
    signal
  );
  return (data.features ?? []) as GeoFeature[];
}

/**
 * Forest / wildlife compartments with the given numbers within `km` of the village (numbers repeat across the
 * state, so the caller keeps only the nearest). Used for approvals whose compartment lies outside the village.
 */
export async function fetchCompartmentsNear(village: MrsacVillage, nums: string[], km: number, signal?: AbortSignal): Promise<GeoFeature[]> {
  const pts = village.rings.flat();
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const dy = km / 110.574, dx = km / (111.32 * Math.cos((((Math.min(...ys) + Math.max(...ys)) / 2) * Math.PI) / 180));
  const env = [Math.min(...xs) - dx, Math.min(...ys) - dy, Math.max(...xs) + dx, Math.max(...ys) + dy].join(",");
  const where = `COMP_NO IN (${nums.filter((n) => /^\d+$/.test(n)).map((n) => `'${n}'`).join(",")})`;
  const out: GeoFeature[] = [];
  for (const id of [5, 12]) {
    const data = await arcgis(
      `${FOREST}/${id}/query`,
      { f: "geojson", where, geometry: env, geometryType: "esriGeometryEnvelope", inSR: "4326", outSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "COMP_NO,COMP_TYPE,RANGE,BEAT,ShpAreaHa", returnGeometry: "true", maxAllowableOffset: "0.00002" },
      signal
    );
    out.push(...((data.features ?? []) as GeoFeature[]));
  }
  return out;
}

/* ---------------- point-in-polygon (parcel ↔ forest / water cross-reference) ---------------- */

export function inRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!, yi = ring[i]![1]!;
    const xj = ring[j]![0]!, yj = ring[j]![1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Even-odd across every ring, so holes work. Accepts a GeoJSON Polygon or MultiPolygon. */
export function pointInGeometry(x: number, y: number, geom: GeoFeature["geometry"]): boolean {
  const polys: number[][][][] = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
  return polys.some((rings) => rings.filter((r) => inRing(x, y, r)).length % 2 === 1);
}
