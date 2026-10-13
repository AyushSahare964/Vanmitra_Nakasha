/**
 * Village / survey-number PDF report generator for VanMitra Nakasha.
 *
 * Maps are captured from the live OpenLayers map: layers are isolated, an ESRI satellite layer
 * and calibrated vector layers are fitted to each view, tiles are waited on until completely loaded,
 * and frames are cropped to the exact target aspect ratio to prevent bleeding, clipping, or distortion.
 *
 * The PDF is built with jsPDF in landscape A4. Devanagari text (Marathi owner names, village names)
 * is rasterised through a high-resolution canvas with matching font metrics and baseline alignment.
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
import { buffer, createEmpty, extend, isEmpty, type Extent } from "ol/extent.js";
import { CATEGORIES } from "./land-categories";
import { CFR_STATUSES } from "./cfr-data";
import { RES_LAYERS, type GeoFeature } from "./mrsac";
import type { SurveyResource } from "./survey-resources";

export interface ReportPlot {
  plotno: string;
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

export interface ReportComp {
  n: string;
  names: string[];
  ha: number;
  geoms: Polygon[];
  own?: boolean;
  outside?: boolean;
  weak?: boolean;
  label: string;
}

export interface ReportInput {
  map: OlMap;
  signal: AbortSignal;
  onProgress: (done: number, total: number, label: string) => void;
  survey?: string;
  village: { name: string; taluka: string; district: string; gisCode: string };
  extent: Extent;
  plots: ReportPlot[];
  cfrComps?: ReportComp[];
  stats: [string, string][];
  insights: string[];
  approvals: { purpose: string; ha: number; ac: number; date: string; surveys: string }[];
  resources: Record<string, GeoFeature[]> | null;
  surveyRes?: Record<string, SurveyResource[]>;
}

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const W = 297;
const H = 210;
const M = 10;
const bodyW = W - 2 * M;
const GREEN: [number, number, number] = [15, 61, 46];
const POWERED_BY = "Powered by TrebTech";
const DEV = "Powered by TrebTech \u00b7 VanMitra Nakasha";

interface Shot {
  dataUrl: string;
  w: number;
  h: number;
}

/* ------------------------------------------------------------------ helpers */

function parseColor(h: string): [number, number, number] {
  if (!h) return [100, 100, 100];
  const s = h.trim();
  if (s.startsWith("#")) {
    const raw = s.slice(1);
    if (raw.length === 3) {
      return [
        parseInt(raw[0] + raw[0], 16) || 0,
        parseInt(raw[1] + raw[1], 16) || 0,
        parseInt(raw[2] + raw[2], 16) || 0,
      ];
    }
    if (raw.length >= 6) {
      return [
        parseInt(raw.slice(0, 2), 16) || 0,
        parseInt(raw.slice(2, 4), 16) || 0,
        parseInt(raw.slice(4, 6), 16) || 0,
      ];
    }
  }
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(s);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return [100, 100, 100];
}

const isLatin = (s: string) => /^[\x00-\xff]*$/.test(s);
const fmt = (n: number, d = 2) => n.toLocaleString("en-IN", { maximumFractionDigits: d });
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/* ------------------------------------------------------------------ map capture */

/**
 * Captures the current map view at the specified extent and aspect ratio.
 * Tracks XYZ tile loading to ensure satellite tiles have completely settled before snapshotting.
 * Crops the output canvas to the exact target aspect ratio centered on the feature, completely
 * preventing image bleed or clipping in the PDF document.
 */
async function capture(
  map: OlMap,
  extent: Extent,
  maxZoom: number,
  signal: AbortSignal,
  targetAspect: number,
  maxW = 1600,
  quality = 0.90,
  satSource?: XYZ,
  inFlightTracker?: { inFlight: number }
): Promise<Shot | null> {
  if (signal.aborted) throw new DOMException("aborted", "AbortError");
  if (!extent || isNaN(extent[0]) || isNaN(extent[1]) || isNaN(extent[2]) || isNaN(extent[3]) || isEmpty(extent)) {
    console.warn("Invalid extent passed to capture:", extent);
    return null;
  }
  const view = map.getView();
  const savedSize = map.getSize();
  view.cancelAnimations();

  // Dynamically set map render viewport to exact target aspect ratio
  const fitW = Math.min(1600, maxW);
  const fitH = Math.max(400, Math.round(fitW / targetAspect));
  map.setSize([fitW, fitH]);

  // Fit extent with safe padding so all boundary lines and parcels are 100% visible
  view.fit(extent, {
    size: [fitW, fitH],
    padding: [24, 24, 24, 24],
    maxZoom,
    duration: 0,
  });

  // Settle tiles: wait until in-flight ESRI tiles reach 0, then wait for rendercomplete
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const maxWait = setTimeout(finish, 4500);
    const check = () => {
      if (signal.aborted || settled) {
        finish();
        return;
      }
      if (!inFlightTracker || inFlightTracker.inFlight <= 0) {
        map.once("rendercomplete", () => {
          setTimeout(finish, 120);
        });
        map.render();
      } else {
        setTimeout(check, 100);
      }
    };
    setTimeout(check, 120);
  });

  const out = document.createElement("canvas");
  out.width = fitW;
  out.height = fitH;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#1e293b"; // dark slate base for imagery
  ctx.fillRect(0, 0, fitW, fitH);

  // Composite OpenLayers layer canvases directly at native 1:1 render dimensions
  const canvases = map.getViewport().querySelectorAll<HTMLCanvasElement>(".ol-layer canvas, canvas.ol-layer");
  canvases.forEach((c) => {
    if (!c.width || !c.height) return;
    const parent = c.parentElement as HTMLElement;
    const op = parent?.style.opacity || c.style.opacity;
    ctx.globalAlpha = op === "" || op == null ? 1 : Number(op);

    const transform = c.style.transform;
    const m = /^matrix\(([^)]*)\)$/.exec(transform)?.[1]?.split(",").map(Number);
    if (m && m.length === 6) {
      ctx.setTransform(m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!);
    } else {
      const cssW = parseFloat(c.style.width) || fitW;
      const cssH = parseFloat(c.style.height) || fitH;
      const sx = cssW / c.width;
      const sy = cssH / c.height;
      ctx.setTransform(sx, 0, 0, sy, 0, 0);
    }
    ctx.drawImage(c, 0, 0);
  });
  ctx.globalAlpha = 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Restore client map size
  if (savedSize) map.setSize(savedSize);

  try {
    return { dataUrl: out.toDataURL("image/jpeg", quality), w: fitW, h: fitH };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ styling */

const stroke = (color: string, width: number) => new Stroke({ color, width });
const tag = (text: string, big: boolean) =>
  new Text({
    text,
    font: `bold ${big ? 15 : 11}px sans-serif`,
    fill: new Fill({ color: "#ffffff" }),
    stroke: stroke("#000000", 3.5),
    overflow: big,
  });

const thin = (label: string) => [new Style({ stroke: stroke("rgba(255,255,255,.9)", 1.2), text: tag(label, false) })];
const tinted = (hex: string, label: string) => [
  new Style({ stroke: stroke("#ffffff", 1.5), fill: new Fill({ color: hex + "88" }), text: tag(label, false) }),
];
const highlight = (label: string) => [
  new Style({ stroke: stroke("#000000", 6) }),
  new Style({ stroke: stroke("#f59e0b", 3.2), fill: new Fill({ color: "rgba(250,204,21,.45)" }), text: tag(label, true) }),
];
const boundary = (label: string) => [
  new Style({ stroke: stroke("#000000", 7) }),
  new Style({
    stroke: stroke("#22d3ee", 4),
    fill: new Fill({ color: "rgba(0, 0, 0, 0)" }),
    text: tag(label, true),
  }),
];

function resStyle(f: Feature) {
  const l = RES_LAYERS.find((x) => x.key === f.get("layerKey"))!;
  if (!l) return null;
  if (l.kind === "point")
    return new Style({ image: new CircleStyle({ radius: 6.5, fill: new Fill({ color: l.color }), stroke: stroke("#ffffff", 1.5) }) });
  if (l.kind === "line") return new Style({ stroke: stroke(l.color, 2.5) });
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

function getImageFormat(dataUrl: string): "PNG" | "JPEG" {
  if (dataUrl.includes("/9j/") || dataUrl.startsWith("data:image/jpeg")) return "JPEG";
  if (dataUrl.includes("iVBORw0KGgo") || dataUrl.startsWith("data:image/png")) return "PNG";
  return "JPEG";
}

async function loadLogo(): Promise<string | null> {
  const paths = ["/vanmitra_icon.png", "/team_vanmitra_logo.jpg", "/team_vanmitra_logo.png"];
  if (typeof window !== "undefined") {
    for (const path of paths) {
      try {
        const res = await fetch(path);
        if (!res.ok) continue;
        return await asDataUrl(await res.blob());
      } catch {
        /* continue */
      }
    }
  } else {
    try {
      const fs = await import("node:fs");
      const pathMod = await import("node:path");
      for (const p of paths) {
        const localP = pathMod.resolve(process.cwd(), "public" + p);
        if (fs.existsSync(localP)) {
          const buf = fs.readFileSync(localP);
          const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
          return `data:image/${isJpg ? "jpeg" : "png"};base64,${buf.toString("base64")}`;
        }
      }
    } catch {
      /* continue */
    }
  }
  return null;
}

async function ensureDevanagariFont(): Promise<void> {
  try {
    await document.fonts.load('14px "Noto Sans Devanagari","Nirmala UI","Mangal"', "\u0917\u094d\u0930\u093e\u092e");
  } catch {
    /* best-effort */
  }
}

/* -------------------------------- Pdf class -------------------------------- */

class Pdf {
  doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  y = 0;
  page = 0;
  private measureCanvas = document.createElement("canvas");
  private measureCtx = this.measureCanvas.getContext("2d")!;

  constructor(private logo: string | null) {}

  /** Word-wraps rasterised (Devanagari) text with the measure canvas; explicit newline starts a new line. */
  private wrap(s: string, maxW: number, S: number): string[] {
    const lines: string[] = [];
    for (const para of s.split("\n")) {
      let cur = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const t = cur ? `${cur} ${word}` : word;
        if (this.measureCtx.measureText(t).width > maxW * S && cur) {
          lines.push(cur);
          cur = word;
        } else {
          cur = t;
        }
      }
      lines.push(cur);
    }
    return lines;
  }

  newPage() {
    if (this.page++) this.doc.addPage();
    const d = this.doc;
    d.setFillColor(...GREEN);
    d.rect(0, 0, W, 19, "F");

    if (this.logo) {
      try {
        const fmt = getImageFormat(this.logo);
        d.addImage(this.logo, fmt, M, 3, 13, 13, "vm-logo", "FAST");
      } catch (err) {
        console.warn("Logo addImage error:", err);
      }
    }

    d.setTextColor(255, 255, 255);
    d.setFont("helvetica", "bold").setFontSize(14).text("VANMITRA NAKASHA", M + 16, 8.5);
    d.setFont("helvetica", "normal").setFontSize(8).text("Community Forest Resource \u00b7 Land Intelligence Platform", M + 16, 13.5);

    d.setFontSize(8.5).text("CFR Land Intelligence Report", W - M, 7.5, { align: "right" });
    d.setFontSize(7).setTextColor(200, 235, 225).text(POWERED_BY, W - M, 11.5, { align: "right" });
    d.setFontSize(6.5).setTextColor(175, 215, 205).text(
      new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
      W - M,
      15.5,
      { align: "right" }
    );

    // Footer
    d.setTextColor(130, 130, 130).setFontSize(7).text(
      "Source: MahaBhuNakasha Cadastral, MRSAC Geoportal, ATREE CFR Atlas, ESRI World Imagery.",
      M,
      H - 5.5
    );
    d.setTextColor(90, 100, 110).setFontSize(7.5).text(
      `${POWERED_BY}  \u00b7  Developed by Ayush Sahare \u00b7 Sanskruti Ruyarkar`,
      W - M,
      H - 5.5,
      { align: "right" }
    );

    // Center subtle watermark
    d.saveGraphicsState();
    d.setGState(new (d as any).GState({ opacity: 0.08 }));
    d.setTextColor(40, 40, 40).setFontSize(13);
    d.text(POWERED_BY, W / 2, H / 2 + 8, { align: "center", angle: 20 });
    d.restoreGraphicsState();

    this.y = 26;
  }

  ensure(h: number) {
    if (this.y + h > H - 12) this.newPage();
  }

  para(
    s: string,
    x: number,
    y: number,
    maxW: number,
    size = 9,
    bold = false,
    color: [number, number, number] = [30, 30, 30]
  ): number {
    const d = this.doc;
    if (isLatin(s)) {
      d.setFont("helvetica", bold ? "bold" : "normal").setFontSize(size).setTextColor(...color);
      const lines = d.splitTextToSize(s, maxW) as string[];
      d.text(lines, x, y, { baseline: "top" });
      return lines.length * size * 0.3528 * 1.35;
    }

    const S = 8;
    const mm = size * 0.3528;
    const fontStr = `${bold ? "bold " : ""}${mm * S}px "Noto Sans Devanagari","Nirmala UI","Mangal","Segoe UI",sans-serif`;
    this.measureCtx.font = fontStr;

    const lines = this.wrap(s, maxW, S);

    const lh = mm * 1.4;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(maxW * S));
    c.height = Math.max(1, Math.ceil(lines.length * lh * S));
    const g = c.getContext("2d")!;
    g.font = fontStr;
    g.fillStyle = `rgb(${color.join(",")})`;
    g.textBaseline = "top";
    lines.forEach((ln, i) => g.fillText(ln, 0, i * lh * S));
    try {
      d.addImage(c.toDataURL("image/png"), "PNG", x, y, c.width / S, c.height / S);
    } catch (e) {
      console.warn("Devanagari text canvas addImage failed:", e);
    }
    return lines.length * lh;
  }

  heading(s: string) {
    this.ensure(14);
    this.y += this.para(s, M, this.y, bodyW, 12, true, GREEN) + 1.5;
    this.doc.setDrawColor(...GREEN).setLineWidth(0.4).line(M, this.y, W - M, this.y);
    this.y += 3.5;
  }

  measure(s: string, maxW: number, bold: boolean, size = 8.5): number {
    if (isLatin(s)) {
      this.doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(size);
      return (this.doc.splitTextToSize(s, maxW) as string[]).length * size * 0.3528 * 1.35;
    }
    const S = 8;
    this.measureCtx.font = `${bold ? "bold " : ""}${size * 0.3528 * S}px "Noto Sans Devanagari","Nirmala UI","Mangal",sans-serif`;
    const n = this.wrap(s, maxW, S).length;
    return n * size * 0.3528 * 1.4;
  }

  /**
   * Draws a formatted table. If rows exceed page height, creates a new page
   * and automatically redraws the table header so multi-page schedules remain clear.
   */
  table(head: string[], rows: string[][], widths: number[]) {
    const d = this.doc;
    const totalW = widths.reduce((a, b) => a + b, 0);

    const drawRow = (cells: string[], bold: boolean, fill?: [number, number, number]) => {
      const hs = cells.map((c, i) => this.measure(c, widths[i]! - 3, bold, 8.5));
      const h = Math.max(...hs) + 3.2;
      if (this.y + h > H - 12) {
        this.newPage();
        // Redraw table header on top of the new page
        drawRow(head, true, GREEN);
      }
      if (fill) {
        d.setFillColor(...fill);
        d.rect(M, this.y, totalW, h, "F");
      }
      let x = M;
      cells.forEach((c, i) => {
        this.para(
          c,
          x + 1.5,
          this.y + 1.6,
          widths[i]! - 3,
          8.5,
          bold,
          bold && fill ? [255, 255, 255] : [30, 30, 30]
        );
        x += widths[i]!;
      });
      this.y += h;
      d.setDrawColor(215, 220, 225).setLineWidth(0.25).line(M, this.y, M + totalW, this.y);
    };

    drawRow(head, true, GREEN);
    if (!rows.length) {
      drawRow(["No records recorded for this category."], false, [250, 250, 250]);
    } else {
      rows.forEach((r, i) => drawRow(r, false, i % 2 ? [247, 250, 248] : undefined));
    }
    this.y += 3.5;
  }

  /**
   * Compact styled card with key-value pairs.
   */
  kvCard(
    title: string,
    rows: [string, string][],
    x: number,
    y: number,
    w: number,
    labelW = 54
  ): number {
    const d = this.doc;
    // Card header bar
    d.setFillColor(...GREEN);
    d.rect(x, y, w, 6.5, "F");
    d.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(255, 255, 255);
    d.text(title, x + 3, y + 4.5);

    let curY = y + 8.5;
    for (let i = 0; i < rows.length; i++) {
      const [k, v] = rows[i]!;
      const hk = this.measure(k, labelW - 2, true, 8);
      const hv = this.measure(v || "\u2014", w - labelW - 4, false, 8);
      const rowH = Math.max(hk, hv) + 1.6;

      if (i % 2 === 0) {
        d.setFillColor(247, 249, 251);
        d.rect(x, curY - 0.8, w, rowH, "F");
      }

      this.para(k, x + 3, curY, labelW - 2, 8, true, [70, 80, 95]);
      this.para(v || "\u2014", x + labelW + 1, curY, w - labelW - 4, 8, false, [20, 25, 30]);
      curY += rowH;
    }

    const cardH = curY - y + 1;
    d.setDrawColor(200, 210, 220).setLineWidth(0.3).rect(x, y, w, cardH, "S");
    return cardH;
  }

  /**
   * Formatted map legend that wraps across lines properly without overlapping text.
   */
  legend(items: { color: string; label: string }[], x = M) {
    this.ensure(11);
    let cx = x;
    let curY = this.y;
    for (const it of items) {
      const sw = 3.8;
      const textW = this.doc.getTextWidth(it.label);
      if (cx + sw + 2 + textW > W - M && cx > x) {
        cx = x;
        curY += 5.5;
        this.ensure(8);
      }
      this.doc.setFillColor(...parseColor(it.color)).setDrawColor(80, 80, 80).setLineWidth(0.3).rect(cx, curY, sw, sw, "FD");
      this.doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(50, 50, 50);
      this.doc.text(it.label, cx + sw + 1.8, curY + 3);
      cx += sw + 2 + textW + 5.5;
    }
    this.y = curY + 6.5;
  }

  /**
   * Places a captured map plate into the exact bounding box [x, y, x + bw, y + bh].
   * Because the captured shot was already cropped to the exact target aspect ratio,
   * it fits [x, imgY, bw, imgH] with 0 bleed, 0 margin clipping, and a crisp GIS border.
   */
  image(shot: Shot | null, x: number, y: number, bw: number, bh: number, caption: string): number {
    const d = this.doc;
    const capH = caption ? 5.2 : 0;
    const imgY = y + capH;
    const imgH = bh - capH;

    if (caption) {
      d.setFont("helvetica", "bold").setFontSize(8).setTextColor(50, 60, 70);
      d.text(caption, x, y + 3.8);
    }

    if (!shot) {
      d.setFillColor(241, 245, 249).setDrawColor(203, 213, 225).setLineWidth(0.35).rect(x, imgY, bw, imgH, "FD");
      d.setFont("helvetica", "italic").setFontSize(8.5).setTextColor(130, 140, 150);
      d.text("Imagery unavailable for export", x + bw / 2, imgY + imgH / 2, { align: "center" });
      return y + bh;
    }

    try {
      d.addImage(shot.dataUrl, "JPEG", x, imgY, bw, imgH, undefined, "FAST");
    } catch (err) {
      console.warn("jsPDF addImage failed:", err);
      d.setFillColor(241, 245, 249).setDrawColor(203, 213, 225).setLineWidth(0.35).rect(x, imgY, bw, imgH, "FD");
      d.setFont("helvetica", "italic").setFontSize(8.5).setTextColor(130, 140, 150);
      d.text("Imagery render error", x + bw / 2, imgY + imgH / 2, { align: "center" });
    }
    // Crisp cartographic border
    d.setDrawColor(71, 85, 105).setLineWidth(0.35).rect(x, imgY, bw, imgH, "S");
    return y + bh;
  }

  /**
   * Renders a clean cartographic metadata strip directly below a map plate.
   * Explicitly displays the visible land area (in ha and acres) and the Gram Sabha jurisdiction.
   */
  mapMetaStrip(
    x: number,
    y: number,
    w: number,
    h = 7.0,
    areaText: string,
    gramSabhaText: string
  ) {
    const d = this.doc;
    // Sleek container with soft green/slate tint
    d.setFillColor(243, 248, 245);
    d.setDrawColor(180, 210, 195);
    d.setLineWidth(0.35);
    d.rect(x, y, w, h, "FD");

    // Left accent bar in dark forest green
    d.setFillColor(...GREEN);
    d.rect(x, y, 2.4, h, "F");

    const padX = x + 4.5;
    if (w > 170) {
      // Wide layout (e.g. bodyW = 277 mm or right column = 177 mm)
      d.setFont("helvetica", "bold").setFontSize(7.5).setTextColor(15, 61, 46);
      d.text("Visible Land Area:", padX, y + 4.4);
      const aLabelW = d.getTextWidth("Visible Land Area: ");
      d.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(30, 41, 59);
      d.text(areaText, padX + aLabelW, y + 4.4);

      const rightX = x + w * 0.48;
      d.setFont("helvetica", "bold").setFontSize(7.5).setTextColor(15, 61, 46);
      d.text("Gram Sabha Jurisdiction:", rightX, y + 4.4);
      const gsLabelW = d.getTextWidth("Gram Sabha Jurisdiction: ");
      this.para(
        gramSabhaText,
        rightX + gsLabelW,
        y + 1.4,
        w - (w * 0.48) - gsLabelW - 3,
        7.5,
        false,
        [30, 41, 59]
      );
    } else {
      // Compact layout for side-by-side photo plates (e.g. plateW = ~135 mm)
      d.setFont("helvetica", "bold").setFontSize(6.8).setTextColor(15, 61, 46);
      d.text("Visible Land Area:", padX, y + 2.8);
      const aLabelW = d.getTextWidth("Visible Land Area: ");
      d.setFont("helvetica", "normal").setFontSize(6.8).setTextColor(30, 41, 59);
      d.text(areaText, padX + aLabelW, y + 2.8);

      d.setFont("helvetica", "bold").setFontSize(6.8).setTextColor(15, 61, 46);
      d.text("Gram Sabha:", padX, y + 5.4);
      const gsLabelW = d.getTextWidth("Gram Sabha: ");
      this.para(
        gramSabhaText,
        padX + gsLabelW,
        y + 3.8,
        w - (padX - x) - gsLabelW - 2,
        6.8,
        false,
        [30, 41, 59]
      );
    }
  }

  /** Updates the footer on all pages with dynamic "Page X of Y" */
  finalize() {
    const total = this.doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      this.doc.setPage(i);
      this.doc.setTextColor(110, 110, 110).setFontSize(7.5);
      this.doc.text(`Page ${i} of ${total}`, W / 2, H - 5.5, { align: "center" });
    }
  }
}

/* ------------------------------------------------------------------ report */

export async function buildReport(inp: ReportInput): Promise<void> {
  const { map, signal, village, plots } = inp;
  const byNo: Record<string, ReportPlot> = {};
  plots.forEach((p) => (byNo[p.plotno] = p));
  const target = inp.survey ? byNo[inp.survey] : undefined;
  if (inp.survey && !target) throw new Error(`Survey no. ${inp.survey} was not found in this village.`);

  const withGeom = plots.filter((p) => p.geom);
  const recognized = plots.filter((p) => p.cfr && p.geom).sort((a, b) => natural(a.plotno, b.plotno));
  const detail = target ? [target] : recognized.slice(0, 60);

  const total = (target ? 0 : 8) + detail.length * 3 + 1;
  let done = 0;
  const tick = (label: string) => inp.onProgress(done++, total, label);

  await ensureDevanagariFont();

  const layers = map.getLayers().getArray().slice();
  const wasVisible = layers.map((l) => l.getVisible());
  const view = map.getView();
  const saved = { center: view.getCenter()!, zoom: view.getZoom()!, size: map.getSize() };

  // Setup isolated export layers
  const satSource = new XYZ({ url: ESRI, maxZoom: 18, crossOrigin: "anonymous", transition: 0 });
  const inFlightTracker = { inFlight: 0 };
  satSource.on("tileloadstart", () => {
    inFlightTracker.inFlight++;
  });
  satSource.on("tileloadend", () => {
    inFlightTracker.inFlight = Math.max(0, inFlightTracker.inFlight - 1);
  });
  satSource.on("tileloaderror", () => {
    inFlightTracker.inFlight = Math.max(0, inFlightTracker.inFlight - 1);
  });

  const sat = new TileLayer({ zIndex: 0, source: satSource });
  const compSource = new VectorSource();
  const compLayer = new VectorLayer({ zIndex: 45, source: compSource });
  const compMode: { fn: (f: Feature) => Style[] | null } = { fn: () => null };
  compLayer.setStyle(((f: Feature) => compMode.fn(f)) as any);

  // Filter CFR compartments strictly to this village's own recognized compartments
  // to avoid drawing dozens of external Gram Sabha compartments and overflowing labels
  const ownComps = (inp.cfrComps || []).filter((c) => c.own !== false && !c.outside);
  const totalHa = plots.reduce((t, p) => t + (p.ha || 0), 0);
  const recognizedHa = recognized.reduce((t, p) => t + (p.ha || 0), 0);
  // Approved CFR area comes from the approvals register; compartment / recognized-parcel areas are only fallbacks.
  const approvedHa = inp.approvals.reduce((t, a) => t + (a.ha || 0), 0);
  const compAreaHa = approvedHa || ownComps.reduce((t, c) => t + c.ha, 0) || recognizedHa;
  const compLabel = ownComps.map((c) => `Comp. ${c.n}`).join(", ") || "Not mapped";
  const gsNames = [...new Set(ownComps.flatMap((c) => c.names).filter(Boolean))].join(" + ") || `ग्रामस्थ ${village.name}`;
  const fullGsJurisdiction = `${gsNames} (Taluka: ${village.taluka})`;
  const conflicts = plots.filter((p) => p.status === "conflict");
  const conflictHa = conflicts.reduce((t, p) => t + p.ha, 0);
  const stat = (key: string) => inp.stats.find(([k]) => k.includes(key))?.[1];
  const ac = (ha: number) => ha * 2.47105;
  const haAc = (ha: number) => `${fmt(ha)} ha  (${fmt(ac(ha))} acres)`;
  // Forest range / beat as published in the MRSAC compartment layer, per CFR compartment number.
  const rangeBeat = (n: string): string => {
    const f = (inp.resources?.["forest"] ?? []).find((x) => String(x.properties["COMP_NO"] ?? "").trim() === n);
    const r = f?.properties["RANGE"], b = f?.properties["BEAT"];
    return [r && `Range ${r}`, b && `Beat ${b}`].filter(Boolean).join(" · ") || "Not published";
  };

  if (ownComps.length) {
    for (const c of ownComps) {
      for (const g of c.geoms) {
        const feat = new Feature({ geometry: g.clone() });
        feat.setProperties({ n: c.n, label: `Comp. ${c.n}`, ha: c.ha, own: true });
        compSource.addFeature(feat);
      }
    }
  }

  const parcels = new VectorLayer({ zIndex: 60, source: new VectorSource() });
  const res = new VectorLayer({ zIndex: 61, source: new VectorSource(), style: resStyle as any, visible: false });
  const mode: { fn: (p: ReportPlot) => Style[] | null } = { fn: () => null };
  parcels.setStyle(((f: Feature) => {
    const p = byNo[f.get("plotno")];
    return p ? mode.fn(p) : null;
  }) as any);

  const fmtr = new GeoJSON();
  if (inp.resources) {
    for (const l of RES_LAYERS) {
      for (const f of inp.resources[l.key] ?? []) {
        const feat = fmtr.readFeature(f, {
          dataProjection: "EPSG:4326",
          featureProjection: "EPSG:3857",
        }) as Feature;
        feat.set("layerKey", l.key);
        res.getSource()!.addFeature(feat);
      }
    }
  }
  withGeom.forEach((p) =>
    parcels.getSource()!.addFeature(new Feature({ geometry: p.geom!.clone(), plotno: p.plotno }))
  );

  const snap = async (
    label: string,
    ext: Extent,
    maxZoom: number,
    targetAspect: number,
    m: (p: ReportPlot) => Style[] | null,
    cm: (f: Feature) => Style[] | null = () => null,
    showRes = false,
    maxW = 1600,
    q = 0.90
  ): Promise<Shot | null> => {
    tick(label);
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    try {
      mode.fn = m;
      compMode.fn = cm;
      parcels.getSource()?.changed();
      compSource.changed();
      parcels.changed();
      compLayer.changed();
      res.setVisible(showRes);
      try {
        map.renderSync();
      } catch {
        /* best-effort sync render */
      }
      return await capture(map, ext, maxZoom, signal, targetAspect, maxW, q, satSource, inFlightTracker);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw err;
      console.warn(`Snapshot capture failed for "${label}":`, err);
      return null;
    }
  };

  const villageExt = createEmpty();
  extend(villageExt, inp.extent);
  withGeom.forEach((p) => extend(villageExt, p.geom!.getExtent()));
  if (ownComps.length) {
    for (const c of ownComps) {
      for (const g of c.geoms) extend(villageExt, g.getExtent());
    }
  }

  // Pure whole village cadastral map extent (encompassing all cadastral parcels of the village)
  // so the survey context map fits the whole village map cleanly without miles of empty background
  const wholeVillageCadastralExt = createEmpty();
  withGeom.forEach((p) => extend(wholeVillageCadastralExt, p.geom!.getExtent()));
  const cvSpanX = wholeVillageCadastralExt[2]! - wholeVillageCadastralExt[0]!;
  const cvSpanY = wholeVillageCadastralExt[3]! - wholeVillageCadastralExt[1]!;
  const cvPad = Math.max(cvSpanX, cvSpanY) * 0.05;
  const wholeVillageMapExt = buffer(wholeVillageCadastralExt, Math.max(cvPad, 50));

  const logo = await loadLogo();
  const pdf = new Pdf(logo);
  let overview: Partial<Record<"plain" | "cad" | "cfr" | "cfrZoom" | "cfrB" | "status" | "cat" | "res", Shot | null>> = {};
  const closeups: Record<string, (Shot | null)[]> = {};
  const overviewOf: Record<string, Shot | null> = {};

  try {
    layers.forEach((l) => l.setVisible(false));
    map.addLayer(sat);
    map.addLayer(compLayer);
    map.addLayer(parcels);
    map.addLayer(res);

    const lab = (p: ReportPlot) => p.plotno;

    // Overview map aspect ratio: page width (277 mm) / map height (~155 mm) = ~1.78
    const overviewAspect = bodyW / 155;

    if (!target) {
      const cfrExt = createEmpty();
      if (inp.cfrComps?.length) {
        for (const c of inp.cfrComps) for (const g of c.geoms) extend(cfrExt, g.getExtent());
      }
      recognized.forEach((p) => extend(cfrExt, p.geom!.getExtent()));
      let cfrZoomExt: Extent | null = null;
      if (!isEmpty(cfrExt)) {
        const cw = cfrExt[2]! - cfrExt[0]!;
        const ch = cfrExt[3]! - cfrExt[1]!;
        const pad = Math.max(cw, ch, 250) * 0.18;
        cfrZoomExt = buffer(cfrExt, pad);
      }

      overview = {
        plain: await snap("Village satellite overview", villageExt, 17.5, overviewAspect, () => null),
        cad: await snap(
          "Cadastral survey boundaries",
          villageExt,
          17.5,
          overviewAspect,
          (p) => thin(lab(p)),
          () => [new Style({ stroke: stroke("rgba(168, 85, 247, 0.75)", 1.5) })]
        ),
        cfr: await snap(
          "CFR recognized land (highlighted)",
          villageExt,
          17.5,
          overviewAspect,
          (p) => (p.cfr ? highlight(lab(p)) : thin("")),
          (f) => [
            new Style({
              stroke: stroke("#9333ea", 3.2),
              fill: new Fill({ color: "rgba(147, 51, 234, 0.22)" }),
              text: new Text({
                text: `CFR Comp. ${f.get("n")}`,
                font: "bold 13px sans-serif",
                fill: new Fill({ color: "#ffffff" }),
                stroke: stroke("#581c87", 4),
                overflow: true,
              }),
            }),
          ]
        ),
        cfrZoom: cfrZoomExt
          ? await snap(
              "CFR geofenced area (high-zoom parcel view)",
              cfrZoomExt,
              17.5,
              overviewAspect,
              (p) => {
                if (p.cfr) {
                  return [
                    new Style({
                      stroke: stroke("#dc2626", 2.2),
                      fill: new Fill({ color: "rgba(225, 29, 72, 0.35)" }),
                      text: new Text({
                        text: lab(p),
                        font: "bold 13px sans-serif",
                        fill: new Fill({ color: "#1e293b" }),
                        stroke: stroke("#ffffff", 3),
                        overflow: true,
                      }),
                    }),
                  ];
                }
                return [
                  new Style({
                    stroke: stroke("#94a3b8", 1.2),
                    fill: new Fill({ color: "rgba(254, 240, 138, 0.28)" }),
                    text: new Text({
                      text: lab(p),
                      font: "11px sans-serif",
                      fill: new Fill({ color: "#475569" }),
                      stroke: stroke("#ffffff", 2.5),
                      overflow: true,
                    }),
                  }),
                ];
              },
              (f) => [
                new Style({
                  stroke: stroke("#e11d48", 3.5),
                  fill: new Fill({ color: "rgba(225, 29, 72, 0.15)" }),
                  text: new Text({
                    text: `CFR Comp. ${f.get("n")}`,
                    font: "bold 14px sans-serif",
                    fill: new Fill({ color: "#ffffff" }),
                    stroke: stroke("#881337", 4),
                    overflow: true,
                  }),
                }),
              ]
            )
          : null,
        cfrB: await snap(
          "CFR recognized land (boundary only)",
          villageExt,
          17.5,
          overviewAspect,
          (p) => (p.cfr ? boundary(lab(p)) : null),
          (f) => [
            new Style({
              stroke: stroke("#a855f7", 3),
              text: new Text({
                text: `Comp. ${f.get("n")}`,
                font: "bold 12px sans-serif",
                fill: new Fill({ color: "#a855f7" }),
                stroke: stroke("#000000", 3),
                overflow: true,
              }),
            }),
          ]
        ),
        status: await snap(
          "CFR status classification",
          villageExt,
          17.5,
          overviewAspect,
          (p) => tinted(CFR_STATUSES.find((s) => s.key === p.status)?.color ?? "#a8a29e", ""),
          () => [new Style({ stroke: stroke("rgba(147, 51, 234, 0.8)", 2) })]
        ),
        cat: await snap(
          "Land category classification",
          villageExt,
          17.5,
          overviewAspect,
          (p) => tinted(CATEGORIES.find((c) => c.key === p.category)?.color ?? "#a8a29e", ""),
          () => [new Style({ stroke: stroke("rgba(147, 51, 234, 0.8)", 2) })]
        ),
        res: inp.resources
          ? await snap(
              "Water & forest resources (MRSAC)",
              villageExt,
              17.5,
              overviewAspect,
              () => thin(""),
              () => [new Style({ stroke: stroke("rgba(147, 51, 234, 0.6)", 1.5) })],
              true
            )
          : null,
      };
    }

    // Detail survey aspects:
    // Page 1 context map aspect: (bodyW - 100) / 160 = 177 / 160 = ~1.10
    const detailContextAspect = (bodyW - 100) / 160;
    // Page 2 two photo plates aspect: ((bodyW - 6) / 2) / 160 = 135.5 / 160 = ~0.85
    const detailPlateAspect = ((bodyW - 6) / 2) / 160;

    for (const p of detail) {
      const g = p.geom;
      if (!g) {
        closeups[p.plotno] = [null, null];
        overviewOf[p.plotno] = null;
        done += 3;
        continue;
      }
      const e = g.getExtent();
      const pw = e[2]! - e[0]!;
      const ph = e[3]! - e[1]!;

      // Proper area-fit zoom frame: frame tightly to the survey parcel with 18-22% margin
      // so the parcel fills ~70-75% of the photo plate with razor-sharp ground detail
      const pad = Math.max(Math.min(Math.max(pw, ph) * 0.20, 60), 25);
      const close: Extent = [e[0]! - pad, e[1]! - pad, e[2]! + pad, e[3]! + pad];
      const others = (q: ReportPlot) => (q.plotno === p.plotno ? null : thin(""));

      overviewOf[p.plotno] = await snap(
        `Survey ${p.plotno}: village context map`,
        wholeVillageMapExt,
        17.5,
        detailContextAspect,
        (q) => (q.plotno === p.plotno ? highlight(q.plotno) : q.cfr ? thin("") : null),
        () => [new Style({ stroke: stroke("#9333ea", 2.5), fill: new Fill({ color: "rgba(147, 51, 234, 0.2)" }) })],
        false,
        1400,
        0.88
      );
      closeups[p.plotno] = [
        await snap(
          `Survey ${p.plotno}: geofence highlighted`,
          close,
          19.5,
          detailPlateAspect,
          (q) => (q.plotno === p.plotno ? highlight(q.plotno) : others(q)),
          () => null,
          false,
          1500,
          0.90
        ),
        await snap(
          `Survey ${p.plotno}: boundary geometry`,
          close,
          19.5,
          detailPlateAspect,
          (q) => (q.plotno === p.plotno ? boundary(q.plotno) : others(q)),
          () => null,
          false,
          1500,
          0.90
        ),
      ];
    }
  } finally {
    map.removeLayer(sat);
    map.removeLayer(compLayer);
    map.removeLayer(parcels);
    map.removeLayer(res);
    layers.forEach((l, i) => l.setVisible(wasVisible[i]!));
    if (saved.size) map.setSize(saved.size);
    view.setCenter(saved.center);
    view.setZoom(saved.zoom);
  }

  tick("Writing PDF");
  pdf.newPage();

  /* ------------------------------------------------ Page 1: Executive Dashboard */

  // Header Title
  pdf.para(
    target ? `Survey No. ${target.plotno} \u2014 Land Intelligence Report` : "Village CFR & Land Intelligence Report",
    M,
    pdf.y,
    bodyW,
    18,
    true,
    GREEN
  );
  pdf.y += 10;

  pdf.para(
    `Village: ${village.name}   \u00b7   Taluka: ${village.taluka}   \u00b7   District: ${village.district}   \u00b7   GIS Code: ${village.gisCode || "N/A"}`,
    M,
    pdf.y,
    bodyW * 0.72,
    9.5,
    false,
    [70, 80, 95]
  );
  pdf.doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(22, 101, 52);
  pdf.doc.text(POWERED_BY, W - M, pdf.y + 3.8, { align: "right" });
  pdf.y += 6.5;
  pdf.doc.setDrawColor(200, 215, 210).setLineWidth(0.35).line(M, pdf.y, W - M, pdf.y);
  pdf.y += 5;

  if (!target) {
    // Two Balanced Side-by-Side Cards
    const cardTop = pdf.y;
    const cardW = Math.floor((bodyW - 6) / 2); // ~135.5 mm each

    const loadedRecords = plots.filter((p) => p.owners && p.owners !== "-").length;
    const pct = plots.length ? Math.round((loadedRecords / plots.length) * 100) : 0;

    // Land category statistics with hectares and acres
    const catRow = (key: string, label: string): [string, string] => {
      const ps = plots.filter((p) => p.category === key);
      const ha = ps.reduce((t, p) => t + p.ha, 0);
      return [label, `${ps.length} parcels · ${haAc(ha)}`];
    };

    const leftRows: [string, string][] = [
      ["Total survey numbers (parcels)", `${plots.length} cadastral plots`],
      ["Parcels with 7/12 records loaded", `${loadedRecords} of ${plots.length} (${pct}%)`],
      ["Total recorded cadastral area", haAc(totalHa)],
      catRow("farm", "Farm / agricultural land"),
      catRow("forest", "Forest land (holder is Forest Dept.)"),
      catRow("government", "Government land"),
      catRow("residential", "Residential / Gaothan plots"),
      catRow("water", "Water bodies & drainage"),
      catRow("other", "Other / unclassified"),
    ];

    const atreePotHa = parseFloat(stat("ATREE CFR potential") ?? "");
    const atreeRecHa = parseFloat(stat("ATREE recognized") ?? "");
    const purposes = [...new Set(inp.approvals.map((a) => a.purpose).filter(Boolean))].join("; ");

    const rightRows: [string, string][] = [
      ["CFR approvals on record", String(inp.approvals.length)],
      ["Rights granted", purposes || "Not recorded"],
      ["CFR forest compartment(s)", compLabel],
      ["Beneficiary Gram Sabha", gsNames],
      ["Approved CFR area", compAreaHa ? haAc(compAreaHa) : "Not recorded"],
      ["Recognized survey parcels", `${recognized.length} survey numbers`],
      ["Conflict parcels (private 7/12 inside CFR)", conflicts.length ? `${conflicts.length} parcels · ${haAc(conflictHa)}` : "None detected"],
      ["ATREE CFR potential estimate", isNaN(atreePotHa) ? "Not in ATREE list" : haAc(atreePotHa)],
      ["ATREE recognized area", isNaN(atreeRecHa) ? "Not in ATREE list" : haAc(atreeRecHa)],
    ];

    const cardH1 = pdf.kvCard("Village Cadastral Land Profile", leftRows, M, cardTop, cardW, 64);
    const cardH2 = pdf.kvCard("Community Forest Resource (CFR) Summary", rightRows, M + cardW + 6, cardTop, cardW, 64);

    pdf.y = cardTop + Math.max(cardH1, cardH2) + 5;

    // Official CFR Approvals Table
    pdf.heading("CFR Approvals Register");
    pdf.table(
      ["CFR Purpose / Rights Granted", "Area (ha)", "Area (acres)", "Approval Date", "Survey nos. / Compartment"],
      inp.approvals.map((a) => [
        a.purpose || "Not recorded",
        fmt(a.ha),
        fmt(a.ac || ac(a.ha)),
        a.date || "—",
        a.surveys || "—",
      ]),
      [92, 28, 28, 28, bodyW - 176]
    );

    /* ------------------------------------------------ Pages 2-8: Map Overviews */

    const mapPage = (
      title: string,
      shot: Shot | null,
      legendItems: { color: string; label: string }[],
      note?: string,
      meta?: { areaText: string; gramSabhaText?: string }
    ) => {
      pdf.newPage();
      pdf.heading(title);
      if (note) {
        pdf.y += pdf.para(note, M, pdf.y, bodyW, 8.5, false, [90, 100, 110]) + 1.5;
      }
      if (legendItems.length) pdf.legend(legendItems);
      const bannerH = 7.0;
      const mapH = H - 12 - bannerH - 2 - pdf.y;
      pdf.image(shot, M, pdf.y, bodyW, mapH, "");
      const metaY = pdf.y + mapH + 1.5;
      const area = meta?.areaText || `Total Cadastral Area: ${fmt(totalHa)} ha (${fmt(totalHa * 2.47105)} acres)`;
      const gs = meta?.gramSabhaText || fullGsJurisdiction;
      pdf.mapMetaStrip(M, metaY, bodyW, bannerH, area, gs);
    };

    mapPage(
      "1. High-Resolution Satellite View (Unaltered)",
      overview.plain ?? null,
      [],
      "ESRI World Imagery base with no overlays. True-color terrain and vegetative canopy.",
      { areaText: `Total Cadastral Extent: ${fmt(totalHa)} ha (${fmt(totalHa * 2.47105)} acres)` }
    );
    mapPage(
      "2. Cadastral Cadre with Survey Number Boundaries",
      overview.cad ?? null,
      [
        ...(ownComps.length ? [{ color: "#a855f7", label: `CFR Compartment boundary (${ownComps.map(c => `comp. ${c.n}`).join(", ")})` }] : []),
        { color: "#ffffff", label: "Parcel boundary + survey number" },
      ],
      "MahaBhuNakasha cadastral parcel boundaries harmonized over true-color satellite imagery.",
      { areaText: `Total Cadastral Land: ${fmt(totalHa)} ha (${fmt(totalHa * 2.47105)} acres) · ${plots.length} Parcels` }
    );

    const compLegend = ownComps.length > 0
      ? [{ color: "#9333ea", label: `CFR Forest Compartment (${ownComps.map(c => `comp. ${c.n} · ${fmt(c.ha)} ha`).join(", ")})` }]
      : [];

    const cfrTitleDesc = recognized.length
      ? `${recognized.length} parcels in CFR area`
      : ownComps.length
      ? `Compartment ${ownComps.map(c => c.n).join(", ")} · ${fmt(ownComps.reduce((t, c) => t + c.ha, 0))} ha`
      : "0 parcels";

    mapPage(
      `3. CFR Recognized Land \u2014 Village Cadastral Map (${cfrTitleDesc})`,
      overview.cfr ?? null,
      [
        ...compLegend,
        { color: "#facc15", label: "CFR recognized parcel" },
        { color: "#ffffff", label: "Other cadastral parcels" },
      ],
      `Village ${village.name} cadastral parcel boundaries harmonized with recognized Community Forest Resource (CFR) land.`,
      { areaText: `Recognized CFR Area: ${fmt(compAreaHa)} ha (${fmt(compAreaHa * 2.47105)} acres) · Cadastral Total: ${fmt(totalHa)} ha` }
    );

    if (overview.cfrZoom) {
      const enclosedCount = recognized.length;
      mapPage(
        `4. High-Zoom CFR Geofenced Area & Enclosed Cadastral Parcels (${enclosedCount} parcels)`,
        overview.cfrZoom,
        [
          { color: "#e11d48", label: "CFR Compartment Geofence Boundary" },
          { color: "#ef4444", label: "Enclosed CFR Cadastral Parcels (Highlighted)" },
          { color: "#fef08a", label: "Surrounding Buffer Cadastral Parcels" },
        ],
        "High-magnification georeferenced cadastral snapshot centered on the approved CFR boundary. Highlights the geofenced compartment perimeter and the enclosed survey parcels.",
        { areaText: `Geofenced CFR Compartment: ${fmt(compAreaHa)} ha (${fmt(compAreaHa * 2.47105)} acres) · ${recognized.length} Enclosed Parcels` }
      );
    }

    mapPage(
      "5. CFR Recognized Land \u2014 Boundary Geometry Only",
      overview.cfrB ?? null,
      [
        ...(ownComps.length ? [{ color: "#a855f7", label: `CFR compartment boundary (${ownComps.map(c => `comp. ${c.n}`).join(", ")})` }] : []),
        { color: "#22d3ee", label: "CFR recognized parcel boundary (cyan outline)" },
      ],
      "Unfilled cadastral and compartment boundaries of recognized CFR land for ground verification and field inspection.",
      { areaText: `CFR Demarcation Perimeter: ${fmt(compAreaHa)} ha (${fmt(compAreaHa * 2.47105)} acres)` }
    );
    mapPage(
      "6. CFR Status Classification Map",
      overview.status ?? null,
      [
        ...(ownComps.length ? [{ color: "#a855f7", label: "CFR compartment reference boundary" }] : []),
        ...CFR_STATUSES.map((s) => ({ color: s.color, label: s.en })),
      ],
      "Classification of parcels by CFR status (Recognized, Conflict with private 7/12 land, Forest candidate, Govt candidate, Other).",
      { areaText: `Total Cadastral Area Classified: ${fmt(totalHa)} ha (${fmt(totalHa * 2.47105)} acres)` }
    );
    mapPage(
      "7. Land Category Classification Map",
      overview.cat ?? null,
      [
        ...(ownComps.length ? [{ color: "#a855f7", label: "CFR compartment reference boundary" }] : []),
        ...CATEGORIES.map((c) => ({ color: c.color, label: c.en })),
      ],
      "Inferred cadastral categories harmonized from land title records and Maharashtra Forest Department databases.",
      { areaText: `Total Cadastral Area Categorized: ${fmt(totalHa)} ha (${fmt(totalHa * 2.47105)} acres)` }
    );
    if (overview.res !== undefined) {
      mapPage(
        "8. Natural Water & Forest Resources (MRSAC)",
        overview.res,
        RES_LAYERS.filter((l) => (inp.resources?.[l.key]?.length ?? 0) > 0).map((l) => ({
          color: l.color,
          label: `${l.label} (${inp.resources![l.key]!.length})`,
        })),
        inp.resources
          ? "Spatial features from Maharashtra Remote Sensing Application Centre (MRSAC) geodatabase."
          : "MRSAC spatial resource service was unavailable during report generation.",
        { areaText: `Village Cadastral Area: ${fmt(totalHa)} ha (${fmt(totalHa * 2.47105)} acres)` }
      );
    }

    /* ------------------------------------------------ Compartment schedule + resources */

    if (ownComps.length || recognized.length) {
      pdf.newPage();
      pdf.heading("CFR Compartment & Gram Sabha Verification Schedule");
      pdf.y += pdf.para(
        "Forest compartments recognized for this village, the Gram Sabha holding the rights, and how many cadastral survey numbers were found inside each compartment.",
        M, pdf.y, bodyW, 8.5, false, [90, 100, 110]
      ) + 2.5;

      pdf.table(
        ["Forest Comp.", "Beneficiary Gram Sabha", "Forest Range / Beat", "Compartment Area", "Parcels Inside", "Conflict Parcels"],
        ownComps.map((c) => {
          const inside = plots.filter((p) => p.forest?.includes(`Compartment ${c.n} `) || p.forest?.startsWith(`${c.n} `));
          const bad = inside.filter((p) => p.status === "conflict");
          return [
            `Comp. ${c.n}`,
            c.names.join(" + ") || "—",
            rangeBeat(c.n),
            `${fmt(c.ha)} ha
(${fmt(ac(c.ha))} acres)`,
            String(inside.length),
            bad.length ? `${bad.length} (${fmt(bad.reduce((t, p) => t + p.ha, 0))} ha)` : "None",
          ];
        }),
        [28, 60, 56, 40, 40, bodyW - 224]
      );

      const resRows = RES_LAYERS.filter((l) => (inp.resources?.[l.key]?.length ?? 0) > 0);
      pdf.heading("Mapped Water & Forest Resources in the Village (MRSAC)");
      pdf.table(
        ["Group", "Resource layer", "Features mapped"],
        resRows.map((l) => [l.group === "water" ? "Water" : "Forest", l.label, String(inp.resources![l.key]!.length)]),
        [40, 120, bodyW - 160]
      );
    }

    /* ------------------------------------------------ CFR Recognized Schedule */

    if (recognized.length) {
      pdf.newPage();
      pdf.heading("CFR Recognized Survey Numbers Schedule");
      pdf.table(
        ["Survey no.", "Holder (7/12)", "Area (ha)", "Area (acres)", "CFR purpose", "Status", "Approved on"],
        recognized.map((p) => [
          p.plotno,
          p.owners,
          fmt(p.ha, 4),
          fmt(ac(p.ha), 2),
          p.cfr!.purpose,
          CFR_STATUSES.find((x) => x.key === p.status)?.en ?? p.status,
          p.cfr!.date || "—",
        ]),
        [20, 78, 22, 22, 60, 40, bodyW - 242]
      );
      if (plots.filter((p) => p.cfr).length > detail.length) {
        pdf.para(
          `Detailed survey dossiers are presented for the first ${detail.length} survey numbers; single-survey reports can be downloaded individually for the remainder.`,
          M,
          pdf.y,
          bodyW,
          8.5,
          false,
          [150, 60, 20]
        );
      }
    } else if (ownComps.length) {
      pdf.newPage();
      pdf.heading("CFR Recognized Land Schedule");
      pdf.para(
        `CFR recognition is established at the Forest Compartment level for this village. Compartment ${ownComps.map((c) => c.n).join(", ")} (${haAc(ownComps.reduce((t, c) => t + c.ha, 0))}) is recognized for ${[...new Set(ownComps.flatMap((c) => c.names))].join(", ")} under the Forest Rights Act. No cadastral survey numbers were matched inside it.`,
        M,
        pdf.y,
        bodyW,
        9.5,
        false,
        [40, 50, 60]
      );
    }
  }

  /* ------------------------------------------------ Survey Detail Dossiers */

  for (const p of detail) {
    const c = closeups[p.plotno] ?? [null, null];

    // Page 1: Metadata card left + Village overview map right
    pdf.newPage();
    pdf.heading(`Survey No. ${p.plotno}${p.cfr ? " \u2014 CFR Recognized Parcel" : ""}`);
    const detailTop = pdf.y;
    const kvW = 96;

    const kvRows: [string, string][] = [
      ["Holder (7/12)", p.owners],
      ["Khata no.", p.khata],
      ["Parcel area", `${fmt(p.ha, 4)} ha  (${fmt(p.ha * 2.47105)} acres)`],
      ["Pot kharaba", p.potKharaba],
      ["Land category", CATEGORIES.find((x) => x.key === p.category)?.en ?? p.category],
      ["CFR status", CFR_STATUSES.find((x) => x.key === p.status)?.en ?? p.status],
      ...(p.cfr
        ? ([
            ["CFR purpose", p.cfr.purpose],
            ["Approved area", `${fmt(p.cfr.ha)} ha (${fmt(p.cfr.ac)} acres) \u2014 whole approval`],
            ["Approved on", p.cfr.date],
          ] as [string, string][])
        : []),
      ["Forest compartment", p.forest ?? "Not inside a mapped compartment"],
      ["Water body", p.water ? "Lies in a mapped water body" : "No overlap recorded"],
      ["Location", `${p.lat.toFixed(5)}\u00b0 N, ${p.lon.toFixed(5)}\u00b0 E`],
    ];

    const cardH = pdf.kvCard("Parcel Harmonization Profile", kvRows, M, detailTop, kvW, 36);

    const linkY = detailTop + cardH + 4;
    pdf.doc.setTextColor(29, 111, 184).setFontSize(8.5).textWithLink("Open in Google Maps", M + 3, linkY, {
      url: `https://www.google.com/maps?q=${p.lat},${p.lon}`,
    });

    // Right column: Village context map plate
    const rightMapW = bodyW - kvW - 5;
    const bannerH = 7.0;
    const rightMapH = H - 12 - bannerH - 2 - detailTop;
    pdf.image(
      overviewOf[p.plotno] ?? null,
      M + kvW + 5,
      detailTop,
      rightMapW,
      rightMapH,
      "Village Cadastral Context \u2014 Survey Highlighted"
    );
    const metaY = detailTop + rightMapH + 1.5;
    const parcelAreaStr = `Survey ${p.plotno}: ${fmt(p.ha, 4)} ha (${fmt(p.ha * 2.47105, 2)} ac) \u00b7 Context: ${fmt(totalHa, 1)} ha`;
    pdf.mapMetaStrip(M + kvW + 5, metaY, rightMapW, bannerH, parcelAreaStr, gsNames);

    // Page 2: Two High-Resolution Satellite Photo Plates (Unwanted 3rd image part removed)
    pdf.newPage();
    pdf.heading(`Survey No. ${p.plotno} \u2014 High-Resolution Satellite Photo Plates`);
    const imgTop = pdf.y;
    const plateW = Math.floor((bodyW - 6) / 2);
    const plateH = H - 12 - bannerH - 2 - imgTop;

    pdf.image(
      c[0] ?? null,
      M,
      imgTop,
      plateW,
      plateH,
      "1. Georeferenced Survey Boundary & Surrounding Parcels"
    );
    pdf.image(
      c[1] ?? null,
      M + plateW + 6,
      imgTop,
      plateW,
      plateH,
      "2. Cadastral Boundary Geometry on Satellite Imagery"
    );

    const plateMetaY = imgTop + plateH + 1.5;
    const surveyAreaText = `Survey ${p.plotno}: ${fmt(p.ha, 4)} ha (${fmt(p.ha * 2.47105, 2)} ac / ${(p.ha * 40).toFixed(2)} Guntha)`;
    pdf.mapMetaStrip(M, plateMetaY, plateW, bannerH, surveyAreaText, gsNames);
    pdf.mapMetaStrip(M + plateW + 6, plateMetaY, plateW, bannerH, surveyAreaText, gsNames);
    pdf.y = plateMetaY + bannerH + 1.5;

    // Page 3 (optional): Resources Table
    const rs = inp.surveyRes?.[p.plotno];
    if (rs) {
      pdf.newPage();
      pdf.heading(`Survey No. ${p.plotno} \u2014 Natural Resources on this Parcel`);
      if (rs.length) {
        pdf.table(
          ["Group", "Resource", "Type / details", "Relation", "Overlap"],
          rs.map((r) => [
            r.group === "water" ? "Water" : "Forest",
            r.layer,
            [r.type, r.details].filter(Boolean).join(" \u2014 "),
            r.relation,
            r.overlapHa != null ? `${fmt(r.overlapHa, 3)} ha (${r.overlapPct}%)` : "\u2014",
          ]),
          [24, 52, bodyW - 168, 55, 37]
        );
      } else {
        pdf.para(
          "No mapped water or forest resource intersects directly with this survey number in the MRSAC registry.",
          M,
          pdf.y,
          bodyW,
          9.5,
          true,
          [150, 60, 20]
        );
      }
    }
  }

  inp.onProgress(total, total, "Saving");
  pdf.finalize();

  const stem =
    (target ? `Survey_${target.plotno}_` : "Village_Report_") +
    village.name.replace(/[^\w\u0900-\u097f]+/g, "_");
  pdf.doc.save(`VanMitra_${stem}.pdf`);
}
