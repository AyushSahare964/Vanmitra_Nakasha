/** Field-surveyed shapes → KML 2.2 text (opens in Google Earth, QGIS, and round-trips through kml-import). */
export type Pt = [number, number]; // [lon, lat]
export type Kind = "Point" | "LineString" | "Polygon";
export type Shape = { id: number; name: string; kind: Kind; pts: Pt[]; at: string; measure: string };

const ESC: Record<string, string> = { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" };
const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ESC[c]!);
const line = (p: Pt[]) => p.map(([x, y]) => `${x.toFixed(7)},${y.toFixed(7)},0`).join(" ");

/** KML wants the outer ring counter-clockwise and explicitly closed. */
function ring(p: Pt[]): Pt[] {
  let a = 0;
  p.forEach(([x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]!; a += x * y2 - x2 * y; });
  const r = a < 0 ? [...p].reverse() : [...p];
  return [...r, r[0]!];
}

function geometry(s: Shape): string {
  if (s.kind === "Point") return `<Point><coordinates>${line(s.pts.slice(0, 1))}</coordinates></Point>`;
  if (s.kind === "LineString") return `<LineString><tessellate>1</tessellate><coordinates>${line(s.pts)}</coordinates></LineString>`;
  return `<Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>${line(ring(s.pts))}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
}

export function toKml(docName: string, shapes: Shape[]): string {
  const placemarks = shapes
    .map((s) => `  <Placemark>\n    <name>${esc(s.name)}</name>\n    <description>${esc(`${s.measure} · captured ${s.at} · VANMITRA field survey (GPS)`)}</description>\n    <styleUrl>#vm</styleUrl>\n    ${geometry(s)}\n  </Placemark>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>${esc(docName)}</name>
  <Style id="vm"><LineStyle><color>ff4aa316</color><width>3</width></LineStyle><PolyStyle><color>554aa316</color></PolyStyle></Style>
${placemarks}
</Document>
</kml>
`;
}
