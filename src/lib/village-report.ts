/**
 * Village / survey-number PDF report.
 *
 * Maps are captured from the live OpenLayers map: every layer is hidden, an ESRI satellite layer (the one basemap
 * whose tiles allow canvas export) and a temporary vector layer of the calibrated parcel outlines are shown, the view
 * is fitted to each shot, and the canvases are composited to a JPEG. The user's layers and view are restored after.
 * The PDF is built with jsPDF; text that is not Latin-1 (Marathi owner names) is rasterised through a canvas because
 * jsPDF cannot shape Devanagari.
 */
import { jsPDF } from "jspdf";
import type OlMap from "ol/Map.js";
import TileLayer from "ol/layer/Tile.js";
import VectorLayer from "ol/layer/Vector.js";
import VectorSource from "ol/source/Vector.js";
import XYZ from "ol/source/XYZ.js";
import GeoJSON from "ol/format/GeoJSON.js";
import Feature from "ol/Feature.js";
import type Polygon from "ol/geom/Polygon.js";
import CircleStyle from "ol/style/Circle.js";
import Style from "ol/style/Style.js";
import Stroke from "ol/style/Stroke.js";
import Fill from "ol/style/Fill.js";
import Text from "ol/style/Text.js";
import { buffer, createEmpty, extend, type Extent } from "ol/extent.js";
import { CATEGORIES } from "./land-categories";
import { CFR_STATUSES } from "./cfr-data";
import { RES_LAYERS, type GeoFeature } from "./mrsac";
import type { SurveyResource } from "./survey-resources";

export interface ReportPlot {
  plotno: string;
  /** Calibrated outline, EPSG:3857. */
  geom: Polygon | null;
  category: string;
  status: string;
  ha: number;
  owners: string;
  khata: string;
  potKharaba: string;
  cfr?: { purpose: string; ha: number; ac: number; date: string };
  forest?: string;
  water?: boolean;
  lat: number;
  lon: number;
}

export interface ReportInput {
  map: OlMap;
  signal: AbortSignal;
  onProgress: (done: number, total: number, label: string) => void;
  /** Set for a single-survey report; otherwise the whole village is reported. */
  survey?: string;
  village: { name: string; taluka: string; district: string; gisCode: string };
  /** Village extent, EPSG:3857. */
  extent: Extent;
  plots: ReportPlot[];
  stats: [string, string][];
  insights: string[];
  approvals: { purpose: string; ha: number; ac: number; date: string; surveys: string }[];
  resources: Record<string, GeoFeature[]> | null;
  /** Resources lying on each survey number; adds a "resources on this land" page per detailed survey. */
  surveyRes?: Record<string, SurveyResource[]>;
}

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const W = 297;
const H = 210;
const M = 10;
const GREEN: [number, number, number] = [15, 61, 46];
const DEV = "Developed by Ayush Sahare · Sanskruti Ruyarkar";

interface Shot {
  url: string;
  w: number;
  h: number;
}

/* ------------------------------------------------------------------ map capture */

async function capture(map: OlMap, extent: Extent, maxZoom: number, signal: AbortSignal, maxW = 1200, quality = 0.7): Promise<Shot | null> {
  if (signal.aborted) throw new DOMException("aborted", "AbortError");
  const view = map.getView();
  const size = map.getSize()!;
  view.cancelAnimations();
  view.fit(extent, { size, padding: [30, 30, 30, 30], maxZoom, duration: 0 });
  await new Promise<void>((res) => {
    const t = setTimeout(res, 15000); // slow tile server: capture what has arrived
    map.once("rendercomplete", () => {
      clearTimeout(t);
      res();
    });
    map.render();
  });
  await new Promise((r) => setTimeout(r, 120));
  const k = Math.min(1, maxW / size[0]!); // smaller shots keep the PDF a sensible size
  const out = document.createElement("canvas");
  out.width = Math.round(size[0]! * k);
  out.height = Math.round(size[1]! * k);
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#e5e7eb";
  ctx.fillRect(0, 0, out.width, out.height);
  const pr = (window.devicePixelRatio || 1) / k;
  map.getViewport().querySelectorAll<HTMLCanvasElement>(".ol-layer canvas, canvas.ol-layer").forEach((c) => {
    if (!c.width) return;
    const parent = c.parentElement as HTMLElement;
    const op = parent?.style.opacity || c.style.opacity;
    ctx.globalAlpha = op === "" || op == null ? 1 : Number(op);
    const m = /^matrix\(([^)]*)\)$/.exec(c.style.transform)?.[1]?.split(",").map(Number);
    if (m) ctx.setTransform(m[0]! / pr, m[1]! / pr, m[2]! / pr, m[3]! / pr, m[4]! / pr, m[5]! / pr);
    else ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(c, 0, 0);
  });
  try {
    return { url: out.toDataURL("image/jpeg", quality), w: out.width, h: out.height };
  } catch {
    return null; // tainted canvas: imagery did not allow export
  }
}

const stroke = (color: string, width: number) => new Stroke({ color, width });
const tag = (text: string, big: boolean) =>
  new Text({
    text,
    font: `bold ${big ? 14 : 10}px sans-serif`,
    fill: new Fill({ color: "#ffffff" }),
    stroke: stroke("#000000", 3),
    overflow: big,
  });
const thin = (label: string) => [new Style({ stroke: stroke("rgba(255,255,255,.85)", 1.1), text: tag(label, false) })];
const tinted = (hex: string, label: string) => [new Style({ stroke: stroke("#ffffff", 1.4), fill: new Fill({ color: hex + "88" }), text: tag(label, false) })];
const highlight = (label: string) => [
  new Style({ stroke: stroke("#000000", 6) }),
  new Style({ stroke: stroke("#f59e0b", 3), fill: new Fill({ color: "rgba(250,204,21,.4)" }), text: tag(label, true) }),
];
const boundary = (label: string) => [new Style({ stroke: stroke("#000000", 7) }), new Style({ stroke: stroke("#22d3ee", 4), text: tag(label, true) })];

function resStyle(f: Feature) {
  const l = RES_LAYERS.find((x) => x.key === f.get("layerKey"))!;
  if (l.kind === "point") return new Style({ image: new CircleStyle({ radius: 5, fill: new Fill({ color: l.color }), stroke: stroke("#ffffff", 1.5) }) });
  if (l.kind === "line") return new Style({ stroke: stroke(l.color, 2) });
  return new Style({ stroke: stroke(l.color, 2), fill: new Fill({ color: l.color + "55" }) });
}

/* ------------------------------------------------------------------ pdf helpers */

const asDataUrl = (blob: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(blob);
  });

async function loadLogo(): Promise<string | null> {
  try {
    return await asDataUrl(await (await fetch("/team_vanmitra_logo.jpg")).blob());
  } catch {
    return null;
  }
}

const hexRgb = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const clean = (s: string) => /^[\x00-\xff]*$/.test(s);

class Pdf {
  doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  y = 0;
  page = 0;
  constructor(private logo: string | null) {}

  newPage() {
    if (this.page++) this.doc.addPage();
    const d = this.doc;
    d.setFillColor(...GREEN);
    d.rect(0, 0, W, 18, "F");
    if (this.logo) d.addImage(this.logo, "JPEG", M, 2.5, 13, 13, "vm-logo");
    d.setTextColor(255, 255, 255);
    d.setFont("helvetica", "bold").setFontSize(15).text("VANMITRA TEAM", M + 16, 9);
    d.setFont("helvetica", "normal").setFontSize(8.5).text("Community Forest Resource · Land Intelligence Report", M + 16, 14);
    d.setFontSize(9).text("CFR Village Land Report", W - M, 9, { align: "right" });
    d.setFontSize(8).text(new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }), W - M, 14, { align: "right" });
    d.setTextColor(120, 120, 120).setFontSize(7.5);
    d.text(`Page ${this.page}`, W - M, H - 5, { align: "right" });
    d.text("Source: MahaBhuNakasha, MRSAC, ATREE, CFR approvals list, ESRI World Imagery. Parcel overlays are calibrated approximations.", M, H - 8.5);
    // small developer watermark: faint diagonal mark plus a footer credit
    d.saveGraphicsState();
    d.setGState(new (d as any).GState({ opacity: 0.16 }));
    d.setTextColor(60, 60, 60).setFontSize(13);
    d.text(DEV, W / 2, H / 2 + 8, { align: "center", angle: 22 });
    d.restoreGraphicsState();
    d.setTextColor(150, 150, 150).setFontSize(7).text(DEV, M, H - 5);
    this.y = 26;
  }

  ensure(h: number) {
    if (this.y + h > H - 12) this.newPage();
  }

  /** Writes wrapped text; returns the height used (mm). Non-Latin-1 text is drawn as an image. */
  para(s: string, x: number, y: number, maxW: number, size = 9, bold = false, color: [number, number, number] = [30, 30, 30]) {
    const d = this.doc;
    if (clean(s)) {
      d.setFont("helvetica", bold ? "bold" : "normal").setFontSize(size).setTextColor(...color);
      const lines = d.splitTextToSize(s, maxW) as string[];
      d.text(lines, x, y + size * 0.3);
      return lines.length * size * 0.3528 * 1.25;
    }
    const S = 8; // canvas px per mm
    const mm = size * 0.3528;
    const c = document.createElement("canvas");
    const g = c.getContext("2d")!;
    g.font = `${bold ? "bold " : ""}${mm * S}px "Noto Sans Devanagari","Nirmala UI","Mangal","Segoe UI",sans-serif`;
    const lines: string[] = [];
    let cur = "";
    for (const word of s.split(/\s+/)) {
      const t = cur ? `${cur} ${word}` : word;
      if (g.measureText(t).width > maxW * S && cur) {
        lines.push(cur);
        cur = word;
      } else cur = t;
    }
    lines.push(cur);
    const lh = mm * 1.4;
    c.width = Math.ceil(maxW * S);
    c.height = Math.ceil(lines.length * lh * S);
    g.font = `${bold ? "bold " : ""}${mm * S}px "Noto Sans Devanagari","Nirmala UI","Mangal","Segoe UI",sans-serif`;
    g.fillStyle = `rgb(${color.join(",")})`;
    g.textBaseline = "top";
    lines.forEach((l, i) => g.fillText(l, 0, i * lh * S));
    d.addImage(c.toDataURL("image/png"), "PNG", x, y, c.width / S, c.height / S);
    return lines.length * lh;
  }

  heading(s: string) {
    this.ensure(12);
    this.y += this.para(s, M, this.y, W - 2 * M, 13, true, GREEN) + 2;
    this.doc.setDrawColor(...GREEN).line(M, this.y, W - M, this.y);
    this.y += 3;
  }

  /** Two-column key/value list. */
  kv(rows: [string, string][], x: number, w: number, labelW = 38) {
    for (const [k, v] of rows) {
      const hk = this.para(k, x, this.y, labelW - 2, 8.5, true, [90, 90, 90]);
      const hv = this.para(v || "—", x + labelW, this.y, w - labelW, 9);
      this.y += Math.max(hk, hv) + 1.6;
      this.ensure(8);
    }
  }

  table(head: string[], rows: string[][], widths: number[]) {
    const d = this.doc;
    const draw = (cells: string[], bold: boolean, fill?: [number, number, number]) => {
      const hs = cells.map((c, i) => this.measure(c, widths[i]! - 3, bold));
      const h = Math.max(...hs) + 2.4;
      this.ensure(h);
      if (fill) {
        d.setFillColor(...fill);
        d.rect(M, this.y, widths.reduce((a, b) => a + b, 0), h, "F");
      }
      let x = M;
      cells.forEach((c, i) => {
        this.para(c, x + 1.5, this.y + 1.2, widths[i]! - 3, 8.5, bold, bold && fill ? [255, 255, 255] : [30, 30, 30]);
        x += widths[i]!;
      });
      this.y += h;
      d.setDrawColor(220, 220, 220).line(M, this.y, M + widths.reduce((a, b) => a + b, 0), this.y);
    };
    draw(head, true, GREEN);
    rows.forEach((r, i) => draw(r, false, i % 2 ? [246, 248, 247] : undefined));
    this.y += 3;
  }

  /** Height `para` would use, without drawing. */
  measure(s: string, maxW: number, bold: boolean) {
    const size = 8.5;
    if (clean(s)) {
      this.doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(size);
      return (this.doc.splitTextToSize(s, maxW) as string[]).length * size * 0.3528 * 1.25;
    }
    const S = 8;
    const g = document.createElement("canvas").getContext("2d")!;
    g.font = `${bold ? "bold " : ""}${size * 0.3528 * S}px "Noto Sans Devanagari","Nirmala UI","Mangal",sans-serif`;
    let n = 1;
    let cur = "";
    for (const word of s.split(/\s+/)) {
      const t = cur ? `${cur} ${word}` : word;
      if (g.measureText(t).width > maxW * S && cur) {
        n++;
        cur = word;
      } else cur = t;
    }
    return n * size * 0.3528 * 1.4;
  }

  legend(items: { color: string; label: string }[], x = M) {
    this.ensure(8);
    let cx = x;
    for (const it of items) {
      this.doc.setFillColor(...hexRgb(it.color)).setDrawColor(120, 120, 120).rect(cx, this.y, 3.5, 3.5, "FD");
      this.doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(50, 50, 50);
      this.doc.text(it.label, cx + 5, this.y + 2.8);
      cx += 8 + this.doc.getTextWidth(it.label) + 4;
    }
    this.y += 6;
  }

  image(shot: Shot | null, x: number, y: number, bw: number, bh: number, caption: string) {
    const d = this.doc;
    d.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(40, 40, 40).text(caption, x, y + 3);
    const top = y + 5;
    const ch = bh - 5;
    if (!shot) {
      d.setDrawColor(180, 180, 180).setFillColor(240, 240, 240).rect(x, top, bw, ch, "FD");
      d.setFont("helvetica", "normal").setFontSize(9).setTextColor(130, 130, 130).text("Imagery unavailable for export", x + bw / 2, top + ch / 2, { align: "center" });
      return;
    }
    const k = Math.min(bw / shot.w, ch / shot.h);
    const w = shot.w * k;
    const h = shot.h * k;
    d.addImage(shot.url, "JPEG", x, top, w, h);
    d.setDrawColor(120, 120, 120).rect(x, top, w, h);
  }
}

/* ------------------------------------------------------------------ report */

const fmt = (n: number, d = 2) => n.toLocaleString("en-IN", { maximumFractionDigits: d });
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

export async function buildReport(inp: ReportInput): Promise<void> {
  const { map, signal, village, plots } = inp;
  const byNo: Record<string, ReportPlot> = {};
  plots.forEach((p) => (byNo[p.plotno] = p));
  const target = inp.survey ? byNo[inp.survey] : undefined;
  if (inp.survey && !target) throw new Error(`Survey no. ${inp.survey} was not found in this village.`);
  const withGeom = plots.filter((p) => p.geom);
  const recognized = plots.filter((p) => p.cfr && p.geom).sort((a, b) => natural(a.plotno, b.plotno));
  const detail = target ? [target] : recognized.slice(0, 60);

  const total = (target ? 0 : 7) + detail.length * 4 + 1;
  let done = 0;
  const tick = (label: string) => inp.onProgress(done++, total, label);

  // ---- map session: hide everything, show satellite + report overlays, restore afterwards
  const layers = map.getLayers().getArray().slice();
  const wasVisible = layers.map((l) => l.getVisible());
  const view = map.getView();
  const saved = { center: view.getCenter()!, zoom: view.getZoom()! };
  const sat = new TileLayer({ zIndex: 0, source: new XYZ({ url: ESRI, maxZoom: 19, crossOrigin: "anonymous", transition: 0 }) });
  const parcels = new VectorLayer({ zIndex: 60, source: new VectorSource() });
  const res = new VectorLayer({ zIndex: 61, source: new VectorSource(), style: resStyle as any, visible: false });
  const mode: { fn: (p: ReportPlot) => Style[] | null } = { fn: () => null };
  parcels.setStyle(((f: Feature) => {
    const p = byNo[f.get("plotno")];
    return p ? mode.fn(p) : null;
  }) as any);
  const fmtr = new GeoJSON();
  if (inp.resources) {
    for (const l of RES_LAYERS)
      for (const f of inp.resources[l.key] ?? []) {
        const feat = fmtr.readFeature(f, { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" }) as Feature;
        feat.set("layerKey", l.key);
        res.getSource()!.addFeature(feat);
      }
  }
  withGeom.forEach((p) => parcels.getSource()!.addFeature(new Feature({ geometry: p.geom!.clone(), plotno: p.plotno })));

  const shots: Shot[] = [];
  const snap = async (label: string, ext: Extent, maxZoom: number, m: (p: ReportPlot) => Style[] | null, showRes = false, maxW = 1200, q = 0.7) => {
    tick(label);
    mode.fn = m;
    parcels.changed();
    res.setVisible(showRes);
    const s = await capture(map, ext, maxZoom, signal, maxW, q);
    if (s) shots.push(s);
    return s;
  };

  const villageExt = createEmpty();
  extend(villageExt, inp.extent);
  withGeom.forEach((p) => extend(villageExt, p.geom!.getExtent()));

  const logo = await loadLogo();
  const pdf = new Pdf(logo);
  let overview: Partial<Record<"plain" | "cad" | "cfr" | "cfrB" | "status" | "cat" | "res", Shot | null>> = {};
  const closeups: Record<string, (Shot | null)[]> = {};
  const overviewOf: Record<string, Shot | null> = {};

  try {
    layers.forEach((l) => l.setVisible(false));
    map.addLayer(sat);
    map.addLayer(parcels);
    map.addLayer(res);

    // ---- village-wide maps
    const lab = (p: ReportPlot) => p.plotno;
    if (!target) {
      overview = {
        plain: await snap("Village satellite", villageExt, 17.5, () => null),
        cad: await snap("Parcel boundaries", villageExt, 17.5, (p) => thin(lab(p))),
        cfr: await snap("CFR recognized land (highlighted)", villageExt, 17.5, (p) => (p.cfr ? highlight(lab(p)) : thin(""))),
        cfrB: await snap("CFR recognized land (boundary only)", villageExt, 17.5, (p) => (p.cfr ? boundary(lab(p)) : null)),
        status: await snap("CFR status filter map", villageExt, 17.5, (p) => tinted(CFR_STATUSES.find((s) => s.key === p.status)?.color ?? "#a8a29e", "")),
        cat: await snap("Land category map", villageExt, 17.5, (p) => tinted(CATEGORIES.find((c) => c.key === p.category)?.color ?? "#a8a29e", "")),
        res: inp.resources ? await snap("Water & forest resources", villageExt, 17.5, () => thin(""), true) : null,
      };
    }
    // per-survey: village context + three close-ups
    for (const p of detail) {
      const g = p.geom;
      if (!g) {
        closeups[p.plotno] = [null, null, null];
        overviewOf[p.plotno] = null;
        done += 4;
        continue;
      }
      const e = g.getExtent();
      const pad = Math.max((e[2]! - e[0]!), (e[3]! - e[1]!), 80) * 0.7;
      const close = buffer(e, pad);
      const others = (q: ReportPlot) => (q.plotno === p.plotno ? null : thin(""));
      overviewOf[p.plotno] = await snap(`Survey ${p.plotno}: village map`, villageExt, 17.5, (q) => (q.plotno === p.plotno ? highlight(q.plotno) : q.cfr ? thin("") : null), false, 800, 0.6);
      closeups[p.plotno] = [
        await snap(`Survey ${p.plotno}: satellite`, close, 19, () => null, false, 900, 0.65),
        await snap(`Survey ${p.plotno}: highlighted`, close, 19, (q) => (q.plotno === p.plotno ? highlight(q.plotno) : others(q)), false, 900, 0.65),
        await snap(`Survey ${p.plotno}: boundary`, close, 19, (q) => (q.plotno === p.plotno ? boundary(q.plotno) : others(q)), false, 900, 0.65),
      ];
    }
  } finally {
    map.removeLayer(sat);
    map.removeLayer(parcels);
    map.removeLayer(res);
    layers.forEach((l, i) => l.setVisible(wasVisible[i]!));
    view.setCenter(saved.center);
    view.setZoom(saved.zoom);
  }

  // ---- compose the PDF
  tick("Writing PDF");
  const bodyW = W - 2 * M;
  pdf.newPage();
  pdf.para(target ? `Survey No. ${target.plotno} — Land Report` : "Village CFR & Land Report", M, pdf.y, bodyW, 20, true, GREEN);
  pdf.y += 11;
  pdf.para(`${village.name}  ·  Taluka ${village.taluka}  ·  District ${village.district}`, M, pdf.y, bodyW, 11);
  pdf.y += 9;

  if (!target) {
    pdf.heading("Village summary");
    pdf.kv(inp.stats, M, bodyW / 2 - 4, 55);
    if (inp.insights.length) {
      pdf.heading("Resources & insight");
      inp.insights.forEach((s) => (pdf.y += pdf.para("• " + s, M, pdf.y, bodyW, 9) + 1.5));
    }
    if (inp.approvals.length) {
      pdf.heading("CFR approvals recorded for this village");
      pdf.table(
        ["Purpose", "Area (ha)", "Area (acre)", "Approved on", "Survey nos."],
        inp.approvals.map((a) => [a.purpose, fmt(a.ha), fmt(a.ac), a.date, a.surveys]),
        [75, 25, 25, 28, bodyW - 153]
      );
    } else pdf.y += pdf.para("No recognized CFR survey numbers are listed for this village.", M, pdf.y, bodyW, 9.5, true, [150, 60, 20]);

    const mapPage = (title: string, shot: Shot | null, legend: { color: string; label: string }[], note?: string) => {
      pdf.newPage();
      pdf.heading(title);
      if (legend.length) pdf.legend(legend);
      if (note) pdf.y += pdf.para(note, M, pdf.y, bodyW, 8.5, false, [90, 90, 90]) + 1;
      pdf.image(shot, M, pdf.y, bodyW, H - 14 - pdf.y, "");
    };
    mapPage("1. Satellite view of the whole village", (overview.plain ?? null), [], "ESRI World Imagery, no overlay.");
    mapPage("2. Satellite with survey-number boundaries", (overview.cad ?? null), [{ color: "#ffffff", label: "Parcel boundary + survey number" }]);
    mapPage(
      `3. CFR recognized land — highlighted (${recognized.length} survey nos.)`,
      (overview.cfr ?? null),
      [
        { color: "#facc15", label: "CFR recognized survey no." },
        { color: "#ffffff", label: "Other parcels" },
      ]
    );
    mapPage("4. CFR recognized land — boundary only", (overview.cfrB ?? null), [{ color: "#22d3ee", label: "CFR recognized boundary (no fill)" }]);
    mapPage("5. CFR status filter map", (overview.status ?? null), CFR_STATUSES.map((s) => ({ color: s.color, label: s.en })), "Forest / Govt candidates are inferred from the 7/12 holder and MRSAC forest compartments — not legal eligibility.");
    mapPage("6. Land category filter map", (overview.cat ?? null), CATEGORIES.map((c) => ({ color: c.color, label: c.en })), "Categories are inferred from the 7/12 holder text; parcels whose record has not loaded show as Other.");
    if (overview.res !== undefined)
      mapPage(
        "7. Water & forest resources (MRSAC)",
        overview.res,
        RES_LAYERS.filter((l) => (inp.resources?.[l.key]?.length ?? 0) > 0).map((l) => ({ color: l.color, label: `${l.label} (${inp.resources![l.key]!.length})` })),
        inp.resources ? undefined : "MRSAC resources could not be loaded."
      );

    if (recognized.length) {
      pdf.newPage();
      pdf.heading("CFR recognized survey numbers");
      pdf.table(
        ["Survey no.", "Holder (7/12)", "Parcel area (ha)", "CFR purpose", "Approved on"],
        recognized.map((p) => [p.plotno, p.owners, fmt(p.ha, 4), p.cfr!.purpose, p.cfr!.date]),
        [24, 100, 30, 83, bodyW - 237]
      );
      if (plots.filter((p) => p.cfr).length > detail.length)
        pdf.para(`Detailed pages are shown for the first ${detail.length} survey numbers; download a single-survey report for the rest.`, M, pdf.y, bodyW, 8.5, false, [150, 60, 20]);
    }
  }

  for (const p of detail) {
    const c = closeups[p.plotno] ?? [null, null, null];
    pdf.newPage();
    pdf.heading(`Survey No. ${p.plotno}${p.cfr ? " — CFR recognized" : ""}`);
    const top = pdf.y;
    pdf.kv(
      [
        ["Holder (7/12)", p.owners],
        ["Khata no.", p.khata],
        ["Parcel area", `${fmt(p.ha, 4)} ha (${fmt(p.ha * 2.47105)} acre)`],
        ["Pot kharaba", p.potKharaba],
        ["Land category", CATEGORIES.find((x) => x.key === p.category)?.en ?? p.category],
        ["CFR status", CFR_STATUSES.find((x) => x.key === p.status)?.en ?? p.status],
        ...(p.cfr
          ? ([
              ["CFR purpose", p.cfr.purpose],
              ["Approved area", `${fmt(p.cfr.ha)} ha (${fmt(p.cfr.ac)} acre) — whole approval`],
              ["Approved on", p.cfr.date],
            ] as [string, string][])
          : []),
        ["Forest compartment", p.forest ?? "Not inside a mapped compartment"],
        ["Water body", p.water ? "Lies in a mapped water body" : "No overlap recorded"],
        ["Location", `${p.lat.toFixed(5)}° N, ${p.lon.toFixed(5)}° E`],
      ],
      M,
      88,
      30
    );
    pdf.doc.setTextColor(29, 111, 184).setFontSize(8.5).textWithLink("Open in Google Maps", M, pdf.y + 2, { url: `https://www.google.com/maps?q=${p.lat},${p.lon}` });
    pdf.image(overviewOf[p.plotno] ?? null, M + 94, top, bodyW - 94, H - 14 - top, "Whole village — this survey no. highlighted");
    pdf.newPage();
    pdf.heading(`Survey No. ${p.plotno} — land photos`);
    const lw = bodyW * 0.56;
    const rw = bodyW - lw - 4;
    const ch = H - 14 - pdf.y;
    pdf.image(c[1] ?? null, M, pdf.y, lw, ch, "Geofence highlighted");
    pdf.image(c[0] ?? null, M + lw + 4, pdf.y, rw, ch / 2, "Satellite, no overlay");
    pdf.image(c[2] ?? null, M + lw + 4, pdf.y + ch / 2, rw, ch / 2, "Boundary only (no fill)");
    const rs = inp.surveyRes?.[p.plotno];
    if (rs) {
      pdf.newPage();
      pdf.heading(`Survey No. ${p.plotno} — resources on this land`);
      if (rs.length)
        pdf.table(
          ["Group", "Resource", "Type / details", "Relation", "Overlap"],
          rs.map((r) => [r.group === "water" ? "Water" : "Forest", r.layer, [r.type, r.details].filter(Boolean).join(" — "), r.relation, r.overlapHa != null ? `${fmt(r.overlapHa, 3)} ha (${r.overlapPct}%)` : "—"]),
          [20, 50, bodyW - 160, 55, 35]
        );
      else pdf.para("No mapped water or forest resource lies on this survey number.", M, pdf.y, bodyW, 10, true, [150, 60, 20]);
    }
  }

  inp.onProgress(total, total, "Saving");
  const stem = (target ? `Survey_${target.plotno}_` : "Village_Report_") + village.name.replace(/[^\wऀ-ॿ]+/g, "_");
  pdf.doc.save(`VanMitra_${stem}.pdf`);
}
