/** Field mapping: capture points / lines / polygons from the device GPS, then export them as KML. */
import { useCallback, useEffect, useRef, useState } from "react";
import type Map from "ol/Map.js";
import Feature from "ol/Feature.js";
import Point from "ol/geom/Point.js";
import LineString from "ol/geom/LineString.js";
import Polygon from "ol/geom/Polygon.js";
import VectorLayer from "ol/layer/Vector.js";
import VectorSource from "ol/source/Vector.js";
import Style from "ol/style/Style.js";
import Stroke from "ol/style/Stroke.js";
import Fill from "ol/style/Fill.js";
import Text from "ol/style/Text.js";
import CircleStyle from "ol/style/Circle.js";
import { fromLonLat } from "ol/proj.js";
import { getArea, getDistance, getLength } from "ol/sphere.js";
import { toKml, type Kind, type Pt, type Shape } from "@/lib/kml-export";

/* ---- shared GPS feed: the map's "my location" watcher publishes, the survey tool listens ---- */
export type Fix = { lon: number; lat: number; acc: number };
export const gps = {
  fix: null as Fix | null,
  subs: new Set<(f: Fix | null) => void>(),
  publish(f: Fix | null) { gps.fix = f; gps.subs.forEach((s) => s(f)); },
};
function useGpsFix() {
  const [f, setF] = useState(gps.fix);
  useEffect(() => { gps.subs.add(setF); setF(gps.fix); return () => void gps.subs.delete(setF); }, []);
  return f;
}

const MIN = { Point: 1, LineString: 2, Polygon: 3 } as const;
const LABEL = { Point: "Point", LineString: "Line", Polygon: "Polygon" } as const;
const KEY = "vm-field-survey-v1";
const AUTO_MIN_STEP_M = 3; // walk-record: add a vertex only after moving this far
const AUTO_MAX_ACC_M = 25; // …and only when the fix is at least this good

/** Centre on a map coordinate (EPSG:3857). On phones with a sheet open, centre in the strip of map above it. */
export function centerOn(map: Map, c: number[], zoom: number, sheetOpen: boolean) {
  const phone = window.innerWidth < 768;
  const hidden = phone && sheetOpen ? 0.58 * (window.innerHeight - 64 - 56) + 56 : 0; // matches the bottom-sheet height in NakashaMap
  map.getView().fit(new Point(c).getExtent(), { padding: [0, 0, hidden, 0], maxZoom: zoom, duration: 400 });
}

export function measure(kind: Kind, pts: Pt[]): string {
  if (kind === "Point") return pts[0] ? `${pts[0][1].toFixed(6)}°N, ${pts[0][0].toFixed(6)}°E` : "";
  if (kind === "LineString") return pts.length > 1 ? `${Math.round(getLength(new LineString(pts), { projection: "EPSG:4326" }))} m` : "";
  if (pts.length < 3) return "";
  const poly = new Polygon([[...pts, pts[0]!]]);
  const ha = getArea(poly, { projection: "EPSG:4326" }) / 10000;
  const perim = getLength(new LineString([...pts, pts[0]!]), { projection: "EPSG:4326" });
  return `${ha.toFixed(ha < 1 ? 3 : 2)} ha · perimeter ${Math.round(perim)} m`;
}

function load(): { shapes: Shape[]; kind: Kind; pts: Pt[] } {
  try { const j = JSON.parse(localStorage.getItem(KEY) ?? ""); return { shapes: j.shapes ?? [], kind: j.kind ?? "Polygon", pts: j.pts ?? [] }; }
  catch { return { shapes: [], kind: "Polygon", pts: [] }; }
}

const style = (f: import("ol/Feature.js").FeatureLike) => {
  const draft = f.get("draft");
  const c = draft ? "#dc2626" : "#16a34a";
  const isPt = f.getGeometry()?.getType() === "Point";
  return new Style({
    stroke: new Stroke({ color: c, width: 3, lineDash: draft ? [8, 6] : undefined }),
    fill: new Fill({ color: draft ? "rgba(220,38,38,0.15)" : "rgba(22,163,74,0.2)" }),
    image: new CircleStyle({ radius: f.get("vertex") ? 4 : 7, fill: new Fill({ color: f.get("vertex") ? "#fff" : c }), stroke: new Stroke({ color: f.get("vertex") ? c : "#fff", width: 2 }) }),
    text: !draft && isPt && f.get("name") ? new Text({ text: String(f.get("name")), offsetY: -16, font: "600 11px sans-serif", fill: new Fill({ color: "#111" }), stroke: new Stroke({ color: "#fff", width: 3 }) }) : undefined,
  });
};

function shapeFeatures(kind: Kind, pts: Pt[], extra: Record<string, unknown>): Feature[] {
  const p = pts.map((x) => fromLonLat(x));
  const geom = kind === "Point" ? (p[0] && new Point(p[0])) : kind === "Polygon" && p.length >= 3 ? new Polygon([[...p, p[0]!]]) : p.length >= 2 ? new LineString(p) : null;
  return geom ? [new Feature({ geometry: geom, ...extra })] : [];
}

export function useFieldSurvey(getMap: () => Map | null, sheetOpen: boolean) {
  const init = useRef(load()).current;
  const [kind, setKindState] = useState<Kind>(init.kind);
  const [pts, setPts] = useState<Pt[]>(init.pts);
  const [shapes, setShapes] = useState<Shape[]>(init.shapes);
  const [name, setName] = useState("");
  const [auto, setAuto] = useState(false);
  const layer = useRef<VectorLayer<VectorSource> | null>(null);
  const autoRef = useRef(false);
  autoRef.current = auto;

  useEffect(() => {
    const map = getMap();
    if (!map) return;
    const l = new VectorLayer({ source: new VectorSource(), zIndex: 58, style });
    map.addLayer(l);
    layer.current = l;
    return () => { map.removeLayer(l); layer.current = null; };
  }, [getMap]);

  // redraw: saved shapes (green) + the draft in progress (red, with vertex dots)
  useEffect(() => {
    const src = layer.current?.getSource();
    if (!src) return;
    src.clear();
    shapes.forEach((s) => src.addFeatures(shapeFeatures(s.kind, s.pts, { name: s.name })));
    src.addFeatures(shapeFeatures(kind, pts, { draft: true }));
    pts.forEach((p) => src.addFeature(new Feature({ geometry: new Point(fromLonLat(p)), draft: true, vertex: true })));
  }, [shapes, pts, kind]);

  // keep the newest vertex in view (the sheet hides the lower part of the map on phones)
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; } // do not hijack the view on page load
    const map = getMap(), last = pts[pts.length - 1];
    if (map && last) centerOn(map, fromLonLat(last), map.getView().getZoom() ?? 17, sheetOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pts.length]);

  // survive refreshes / dead batteries mid-survey
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ shapes, kind, pts })); } catch { /* storage blocked */ } }, [shapes, kind, pts]);

  // walk-record
  useEffect(() => {
    const sub = (f: Fix | null) => {
      if (!f) return setAuto(false); // GPS stopped
      if (!autoRef.current || f.acc > AUTO_MAX_ACC_M) return;
      setPts((p) => (p.length && getDistance(p[p.length - 1]!, [f.lon, f.lat]) < AUTO_MIN_STEP_M ? p : [...p, [f.lon, f.lat]]));
    };
    gps.subs.add(sub);
    return () => void gps.subs.delete(sub);
  }, []);
  // keep the screen awake while walk-recording — a sleeping phone stops GPS
  useEffect(() => {
    if (!auto) return;
    let lock: { release(): Promise<void> } | undefined;
    (navigator as any).wakeLock?.request("screen").then((l: typeof lock) => { lock = l; }).catch(() => {});
    return () => void lock?.release().catch(() => {});
  }, [auto]);

  const setKind = useCallback((k: Kind) => { setKindState(k); setAuto(false); if (k === "Point") setPts((p) => p.slice(-1)); }, []);
  const addHere = useCallback(() => { const f = gps.fix; if (f) setPts((p) => (kind === "Point" ? [[f.lon, f.lat]] : [...p, [f.lon, f.lat]])); }, [kind]);
  const undo = useCallback(() => setPts((p) => p.slice(0, -1)), []);
  const clear = useCallback(() => { setPts([]); setAuto(false); }, []);
  const save = useCallback(() => {
    if (pts.length < MIN[kind]) return;
    const n = shapes.filter((s) => s.kind === kind).length + 1;
    setShapes((s) => [...s, { id: Date.now(), name: name.trim() || `${LABEL[kind]} ${n}`, kind, pts, at: new Date().toISOString(), measure: measure(kind, pts) }]);
    setPts([]); setName(""); setAuto(false);
  }, [pts, kind, shapes, name]);
  const remove = useCallback((id: number) => setShapes((s) => s.filter((x) => x.id !== id)), []);
  const download = useCallback(() => {
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
    const url = URL.createObjectURL(new Blob([toKml(`VANMITRA field survey ${stamp}`, shapes)], { type: "application/vnd.google-earth.kml+xml" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `vanmitra-survey-${stamp}.kml` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [shapes]);

  return { kind, setKind, pts, shapes, name, setName, auto, setAuto, addHere, undo, clear, save, remove, download };
}

export function FieldSurveyPanel({ s, gpsOn, onToggleGps }: { s: ReturnType<typeof useFieldSurvey>; gpsOn: boolean; onToggleGps: () => void }) {
  const fix = useGpsFix();
  const canSave = s.pts.length >= MIN[s.kind];
  const btn = "rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40 hover:bg-slate-50";
  return (
    <div className="space-y-3 border-t border-slate-200 pt-3">
      <p className="font-bold text-slate-900 text-sm">Map in the field</p>
      <p>Stand at a spot, tap <b>Add my location</b>, move on and repeat — or let it record while you walk. Then save the shape and download a KML.</p>

      <div className="grid grid-cols-3 gap-1">
        {(["Point", "LineString", "Polygon"] as Kind[]).map((k) => (
          <button key={k} type="button" onClick={() => s.setKind(k)} className={`rounded-md py-2 text-xs font-semibold border ${s.kind === k ? "bg-slate-900 text-white border-slate-900" : "border-slate-300 text-slate-700"}`}>{LABEL[k]}</button>
        ))}
      </div>

      <div className="flex items-center justify-between rounded-md bg-slate-50 border border-slate-200 px-3 py-2">
        <span className={`font-semibold ${!gpsOn ? "text-slate-500" : !fix ? "text-amber-600" : fix.acc <= 10 ? "text-emerald-700" : fix.acc <= 25 ? "text-amber-600" : "text-red-600"}`}>
          {!gpsOn ? "GPS is off" : !fix ? "Waiting for GPS fix…" : `GPS accuracy ±${Math.round(fix.acc)} m`}
        </span>
        <button type="button" onClick={onToggleGps} className="text-[11px] font-semibold text-blue-700 hover:underline">{gpsOn ? "Turn off" : "Turn on GPS"}</button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={!fix} onClick={s.addHere} className="col-span-2 rounded-md bg-emerald-700 py-2.5 text-sm font-bold text-white disabled:opacity-40 hover:bg-emerald-800">＋ Add my location</button>
        {s.kind !== "Point" && (
          <button type="button" disabled={!fix} onClick={() => s.setAuto(!s.auto)} className={`col-span-2 rounded-md py-2 text-xs font-semibold border ${s.auto ? "bg-red-600 text-white border-red-600" : "border-slate-300 text-slate-700"} disabled:opacity-40`}>{s.auto ? "● Recording while you walk — tap to stop" : "Record while I walk"}</button>
        )}
        <button type="button" disabled={!s.pts.length} onClick={s.undo} className={btn}>Undo last</button>
        <button type="button" disabled={!s.pts.length} onClick={s.clear} className={btn}>Clear</button>
      </div>

      <p className="text-[11px] text-slate-500">{s.pts.length} point{s.pts.length === 1 ? "" : "s"}{canSave && s.kind !== "Point" ? ` · ${measure(s.kind, s.pts)}` : ""}{s.kind === "Polygon" && s.pts.length && s.pts.length < 3 ? " · need at least 3" : ""}{s.kind === "LineString" && s.pts.length === 1 ? " · need at least 2" : ""}</p>

      <div className="flex gap-2">
        <input value={s.name} onChange={(e) => s.setName(e.target.value)} placeholder={`Name (optional)`} className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-2 text-xs" />
        <button type="button" disabled={!canSave} onClick={s.save} className="rounded-md bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Save shape</button>
      </div>

      {s.shapes.map((x) => (
        <div key={x.id} className="flex items-center gap-2 rounded-md border border-slate-200 p-2">
          <span className="size-2.5 rounded-sm bg-emerald-600 shrink-0" />
          <div className="min-w-0 flex-1"><div className="truncate font-semibold text-slate-800">{x.name}</div><div className="truncate text-[10px] text-slate-500">{LABEL[x.kind]} · {x.measure}</div></div>
          <button type="button" onClick={() => s.remove(x.id)} className="text-slate-400 hover:text-red-600" aria-label={`Delete ${x.name}`}>✕</button>
        </div>
      ))}

      <button type="button" disabled={!s.shapes.length} onClick={s.download} className="w-full rounded-md bg-red-700 py-2.5 text-sm font-bold text-white disabled:opacity-40 hover:bg-red-800">⬇ Download KML{s.shapes.length ? ` (${s.shapes.length})` : ""}</button>
    </div>
  );
}
