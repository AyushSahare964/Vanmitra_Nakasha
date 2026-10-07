/**
 * Turns a clicked MRSAC feature (well, water structure, water body, river, forest compartment...) into a readable
 * details card: friendly attribute names, units, and links out to the official portals. Pure, so it can be tested
 * without a browser.
 */
import { resLayerByKey, typeLabel } from "./mrsac";

export interface DetailRow {
  label: string;
  value: string;
}
export interface DetailLink {
  label: string;
  href: string;
}
export interface ResourceDetails {
  title: string;
  subtitle: string;
  color: string;
  rows: DetailRow[];
  links: DetailLink[];
}

const GEOPORTAL = "https://geoportal.mrsac.org.in/explore/";

const CONDITION: Record<string, string> = { "01": "Good", "02": "Fair", "03": "Poor", "04": "Dry", "05": "Damaged", "1": "Good", "2": "Fair", "3": "Poor" };

const clean = (v: unknown): string => {
  const s = String(v ?? "").trim();
  return s && s !== "null" && s !== "undefined" && s !== " " ? s : "";
};
const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const ha = (n: number) => `${n.toFixed(n < 1 ? 3 : 2)} ha`;

/** Google Maps / satellite links for a real-world position. */
export const locationLinks = (lon: number, lat: number): DetailLink[] => [
  { label: "Open location in Google Maps", href: `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}` },
  { label: "Satellite view", href: `https://www.google.com/maps/@${lat.toFixed(6)},${lon.toFixed(6)},19z/data=!3m1!1e3` },
];

/**
 * @param layerKey  key from RES_LAYERS
 * @param props     the feature's attribute table as MRSAC returned it
 * @param at        [lon, lat] of the clicked point / feature centre (real-world degrees)
 * @param geomAreaHa polygon area measured from the geometry, used when the service gives none
 */
export function describeResource(layerKey: string, props: Record<string, unknown>, at: [number, number], geomAreaHa?: number): ResourceDetails | null {
  const layer = resLayerByKey(layerKey);
  if (!layer) return null;
  const rows: DetailRow[] = [];
  const add = (label: string, value: unknown, unit = "") => {
    const v = clean(value);
    if (v) rows.push({ label, value: v + unit });
  };
  const kind = typeLabel(layer, props);
  const area = (n: number | null) => n && rows.push({ label: "Area", value: ha(n) });

  switch (layer.key) {
    case "well":
    case "structure":
      add("Type", kind);
      add("Constructed", props["ConstructionYear"]);
      add("Condition", CONDITION[clean(props["Condition"])] ?? props["Condition"]);
      break;
    case "waterbody": {
      add("Name", props["WB_NAME"]);
      add("Type", props["WB_TYPE"]);
      const m2 = num(props["Shape_Area"]);
      area(m2 ? m2 / 10000 : (geomAreaHa ?? null));
      break;
    }
    case "river":
      add("River", props["RIVNAME"]);
      area(geomAreaHa ?? null);
      break;
    case "drainage":
      add("Stream", props["River_Name"]);
      add("Stream order", props["Ordering"]);
      break;
    case "forest":
    case "wildlife":
      add("Compartment no.", props["COMP_NO"]);
      add("Compartment type", kind);
      add("Category", props["CATEGORY"]);
      add("Range", props["RANGE"]);
      add("Beat", props["BEAT"]);
      area(num(props["ShpAreaHa"]) ?? geomAreaHa ?? null);
      break;
    case "reserve":
      add("Name", props["Name"]);
      area(num(props["Area"]) ?? geomAreaHa ?? null);
      break;
  }
  rows.push({ label: "Location", value: `${at[1].toFixed(5)}° N, ${at[0].toFixed(5)}° E` });

  const title = layer.label + (layer.kind === "point" && kind && kind !== layer.label ? ` — ${kind}` : "");
  return {
    title,
    subtitle: layer.mr,
    color: layer.color,
    rows,
    links: [{ label: "MRSAC Geoportal (full layer details)", href: GEOPORTAL }, ...locationLinks(at[0], at[1])],
  };
}

/** Plain-text version for the Copy button. */
export const detailsAsText = (d: ResourceDetails): string =>
  [d.title, ...d.rows.map((r) => `${r.label}: ${r.value}`), ...d.links.map((l) => `${l.label}: ${l.href}`)].join("\n");
