/** Parse a user-supplied KML / KMZ / GeoJSON file into OpenLayers features in the map's projection (EPSG:3857). */
import { unzipSync, strFromU8 } from "fflate";
import KML from "ol/format/KML.js";
import GeoJSON from "ol/format/GeoJSON.js";
import type Feature from "ol/Feature.js";

const OPTS = { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" } as const;

export async function parseGeoFile(file: File): Promise<Feature[]> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  let features: Feature[];
  if (ext === "kmz") {
    const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const name = Object.keys(files).find((n) => n.toLowerCase() === "doc.kml") ?? Object.keys(files).find((n) => n.toLowerCase().endsWith(".kml"));
    if (!name) throw new Error("No .kml found inside the KMZ");
    features = new KML({ extractStyles: false }).readFeatures(strFromU8(files[name]!), OPTS);
  } else if (ext === "kml") {
    features = new KML({ extractStyles: false }).readFeatures(await file.text(), OPTS);
  } else if (ext === "geojson" || ext === "json") {
    features = new GeoJSON().readFeatures(await file.text(), OPTS) as Feature[];
  } else throw new Error("Unsupported file type — use .kml, .kmz or .geojson");
  features = features.filter((f) => f.getGeometry());
  if (!features.length) throw new Error("No map geometry found in this file");
  return features;
}
