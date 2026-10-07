/**
 * Which MRSAC water / forest features lie on a survey number. Everything is done in lon/lat so MRSAC's GeoJSON is
 * used as-is. Pure (no DOM), so it can be unit-tested.
 */
import { toLonLat } from "ol/proj.js";
import type Polygon from "ol/geom/Polygon.js";
import { RES_LAYERS, pointInGeometry, type GeoFeature } from "./mrsac";
import { describeResource } from "./resource-details";

export interface SurveyResource {
  group: "water" | "forest";
  layer: string;
  type: string;
  details: string;
  relation: string;
  /** Polygon resources only: area of the survey covered by the resource. */
  overlapHa: number | null;
  overlapPct: number | null;
  lon: number;
  lat: number;
}

type Pt = number[];
const SAMPLES = 40; // ponytail: 40x40 grid estimate of polygon overlap (±~2%); exact clipping if auditors need it

const lines = (g: GeoFeature["geometry"]): Pt[][] => {
  const c = g.coordinates;
  switch (g.type) {
    case "Point": return [[c]];
    case "MultiPoint": return c.map((p: Pt) => [p]);
    case "LineString": return [c];
    case "MultiLineString":
    case "Polygon": return c;
    case "MultiPolygon": return c.flat();
    default: return [];
  }
};
const cross = (a: Pt, b: Pt, c: Pt) => (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
const segX = (a: Pt, b: Pt, c: Pt, d: Pt) => cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;

export function resourcesInSurvey(geom: Polygon, parcelHa: number, resources: Record<string, GeoFeature[]>): SurveyResource[] {
  const ring = geom.getCoordinates()[0]!.map((c) => toLonLat(c));
  const parcel: GeoFeature["geometry"] = { type: "Polygon", coordinates: [ring] };
  const inParcel = (p: Pt) => pointInGeometry(p[0]!, p[1]!, parcel);
  const xs = ring.map((p) => p[0]!), ys = ring.map((p) => p[1]!);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let grid: Pt[] | null = null;
  const samples = () =>
    (grid ??= Array.from({ length: SAMPLES * SAMPLES }, (_, i) => [x0 + ((i % SAMPLES) + 0.5) * ((x1 - x0) / SAMPLES), y0 + (Math.floor(i / SAMPLES) + 0.5) * ((y1 - y0) / SAMPLES)]).filter(inParcel));
  const out: SurveyResource[] = [];

  for (const layer of RES_LAYERS) {
    for (const f of resources[layer.key] ?? []) {
      const g = f.geometry;
      const L = lines(g);
      const V = L.flat();
      if (!V.length || V.every((v) => v[0]! < x0) || V.every((v) => v[0]! > x1) || V.every((v) => v[1]! < y0) || V.every((v) => v[1]! > y1)) continue;
      const vIn = V.find(inParcel);
      const crosses = layer.kind !== "point" && L.some((l) => l.some((_, i) => i && ring.some((_, j) => j && segX(l[i - 1]!, l[i]!, ring[j - 1]!, ring[j]!))));
      let relation = "Inside";
      let overlapHa: number | null = null;
      let overlapPct: number | null = null;
      let at: Pt | undefined = vIn;
      if (layer.kind === "polygon") {
        const s = samples();
        const hit = s.filter((p) => pointInGeometry(p[0]!, p[1]!, g));
        if (!hit.length && !vIn && !crosses) continue;
        const frac = s.length ? hit.length / s.length : 0;
        overlapPct = Math.round(frac * 1000) / 10;
        overlapHa = Math.round(frac * parcelHa * 10000) / 10000;
        relation = frac >= 0.98 ? "Survey lies entirely within" : frac > 0 ? "Overlaps part of survey" : "Touches boundary";
        at = hit[0] ?? at;
      } else if (layer.kind === "line") {
        if (!vIn && !crosses) continue;
        relation = crosses && !vIn ? "Crosses survey" : "Runs through / ends in survey";
      } else if (!vIn) continue;
      at ??= ring[0]!;
      const d = describeResource(layer.key, f.properties ?? {}, [at[0]!, at[1]!]);
      out.push({
        group: layer.group as "water" | "forest",
        layer: layer.label,
        type: d?.title ?? layer.label,
        details: (d?.rows ?? []).filter((r) => r.label !== "Location" && r.label !== "Area").map((r) => `${r.label}: ${r.value}`).join("; "),
        relation,
        overlapHa,
        overlapPct,
        lon: at[0]!,
        lat: at[1]!,
      });
    }
  }
  return out;
}

/** Resources per survey number (only surveys with a calibrated outline); `only` limits it to one survey. */
export function surveyResourceMap(plots: { plotno: string; geom: Polygon | null; ha: number }[], resources: Record<string, GeoFeature[]>, only?: string) {
  const m: Record<string, SurveyResource[]> = {};
  for (const p of plots) if (p.geom && (!only || p.plotno === only)) m[p.plotno] = resourcesInSurvey(p.geom, p.ha, resources);
  return m;
}
