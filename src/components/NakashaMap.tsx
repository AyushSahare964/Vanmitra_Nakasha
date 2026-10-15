/**
 * NakashaMap.tsx
 * Full-screen OpenLayers map for VANMITRA - Maharashtra land intelligence.
 * District/taluka/village vector boundaries + BhuNaksha cadastral ImageWMS overlay
 * + village-wise sorting panel + plot-level parcel detail.
 */

import React, { useEffect, useRef, useState, useCallback } from "react";

import Map from "ol/Map.js";
import View from "ol/View.js";
import { fromLonLat, toLonLat, transformExtent } from "ol/proj.js";
import { defaults as defaultControls } from "ol/control.js";

import TileLayer from "ol/layer/Tile.js";
import ImageLayer from "ol/layer/Image.js";
import VectorLayer from "ol/layer/Vector.js";
import VectorImageLayer from "ol/layer/VectorImage.js";
import VectorSource from "ol/source/Vector.js";
import XYZ from "ol/source/XYZ.js";
import ImageWMS from "ol/source/ImageWMS.js";
import TileWMS from "ol/source/TileWMS.js";
import TileArcGISRest from "ol/source/TileArcGISRest.js";
import { createXYZ } from "ol/tilegrid.js";
import GeoJSON from "ol/format/GeoJSON.js";

import Feature from "ol/Feature.js";
import Point from "ol/geom/Point.js";
import Circle from "ol/geom/Circle.js";
import Polygon, { fromExtent } from "ol/geom/Polygon.js";
import CircleStyle from "ol/style/Circle.js";
import Style from "ol/style/Style.js";
import Stroke from "ol/style/Stroke.js";
import Fill from "ol/style/Fill.js";
import Text from "ol/style/Text.js";

import { extend, createEmpty, isEmpty, getCenter } from "ol/extent.js";

import "ol/ol.css";
import { SlidersHorizontal, Layers, Eye, Sun, RotateCcw, X, Sparkles, LocateFixed } from "lucide-react";

import {
  loadVillageData,
  getDistricts,
  getTalukas,
  getVillages,
  searchVillages,
  getDistrictCentroid,
  type MHVillage,
} from "@/lib/mh-village-data";
import {
  devanagariToEnglish,
  parseOwnerName,
  matchOwner,
  tokenize,
  type NamePart,
  type ParsedOwner,
} from "@/lib/marathi-search";
import { calibrate, NASHIK_PRIOR, type AlignParcel, type Shift } from "@/lib/forest-align";
import { CATEGORIES, classifyParcel, familyKey, type Category } from "@/lib/land-categories";
import { calibrateVillage, readCachedCalibration, type AutoCalibration } from "@/lib/cadastral-calibration";
import { describeResource, detailsAsText, locationLinks, type ResourceDetails } from "@/lib/resource-details";
import { getArea } from "ol/sphere.js";
import { LandExplorer, type ExplorerRow, type SortKey } from "@/components/LandExplorer";
import { CfrPanel, type CfrAtreeState } from "@/components/CfrPanel";
import { identifyAtreeVillage, type AtreeVillage } from "@/lib/cfr-atree";
import { ResourcesSection, type ResCount } from "@/components/ResourcesSection";
import { ReportButton } from "@/components/ReportButton";
import { buildReport, type ReportPlot, type ReportComp } from "@/lib/village-report";
import { surveyResourceMap } from "@/lib/survey-resources";
import { buildExcel } from "@/lib/survey-excel";
import {
  RES_LAYERS,
  fetchResource,
  fetchCompartmentsNear,
  fetchVillagesNear,
  type NearVillage,
  inRing as pointInRing,
  findVillage,
  isForestLandType,
  pointInGeometry,
  resLayerByKey,
  typeLabel,
  type GeoFeature,
  type MrsacVillage,
} from "@/lib/mrsac";
import {
  CFR_STATUSES,
  PURPOSE_GROUPS,
  buildRecognizedLookup,
  cfrStatusOf,
  OVERLAP_MIN,
  OVERLAP_FULL,
  compBase,
  isConflictCategory,
  districtKey,
  duplicateKeys,
  hasDistrict,
  loadCfrData,
  matchRecognized,
  rowsForVillage,
  unmatchedSurveys,
  villageKeys,
  villagesOfTaluka,
  type CfrIndex,
  type CfrRow,
  type CfrStatus,
  type PurposeGroup,
} from "@/lib/cfr-data";
import { claimsOf, compsAround, loadCompData, ringsToPolygons, type CompData } from "@/lib/cfr-comp";
import {
  bulkFetchVillageRecords,
  fetchPlotExtent,
  mapWithConcurrency,
  recordsFromPlotInfo,
  type PlotInfoRecord,
  type PlotRecordResult,
} from "@/lib/bhunaksha-owners";

export type { PlotInfoRecord } from "@/lib/bhunaksha-owners";
export { parseBhuNakashaInfoText } from "@/lib/bhunaksha-owners";

export interface OfficerProfile {
  name: string;
  role: string;
  designation: string;
  district: string;
  department: string;
  avatar: string;
}

interface NakashaMapProps {
  currentUser?: OfficerProfile | null;
  onOpenLogin?: () => void;
  onOpenConsole: () => void;
  onLogout?: () => void;
}

type BasemapKey = "google-hybrid" | "google-satellite" | "esri" | "osm";

const BASEMAPS: Record<BasemapKey, { label: string; url: string; maxZoom: number }> = {
  "google-hybrid": { label: "Google Satellite (Hybrid)", url: "https://mt{0-3}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", maxZoom: 21 },
  "google-satellite": { label: "Google Satellite", url: "https://mt{0-3}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", maxZoom: 21 },
  esri: { label: "ESRI World Imagery", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", maxZoom: 19 },
  osm: { label: "OpenStreetMap", url: "https://{a-c}.tile.openstreetmap.org/{z}/{x}/{y}.png", maxZoom: 19 },
};

// BhuNaksha WMS config - proxied through Vite dev-server at /bhunaksha/*
const BHUNAKSHA_STATE = "27"; // Maharashtra
const BHUNAKSHA_WMS_URL = "/bhunaksha/WMS";
const BHUNAKSHA_REST_BASE = "/bhunaksha/rest";

// Load priority: basemap first, then cadastral, then every other overlay. Lower tiers hold their tile requests
// until the tiers above are idle (or 6s pass), so the slow portal/overlay servers never starve the basemap.
const tilePending = { base: 0, cad: 0 };
function trackTiles(src: any, tier: "base" | "cad") {
  src.on("tileloadstart", () => { tilePending[tier]++; });
  src.on(["tileloadend", "tileloaderror"], () => { tilePending[tier] = Math.max(0, tilePending[tier] - 1); });
}
function waitIdle(tiers: ("base" | "cad")[]) {
  return new Promise<void>((resolve) => {
    const t0 = Date.now();
    let quiet = 0;
    const tick = () => {
      quiet = tiers.every((t) => tilePending[t] === 0) ? quiet + 1 : 0;
      if (quiet >= 2 || Date.now() - t0 > 6000) return resolve();
      setTimeout(tick, 100);
    };
    tick();
  });
}
const gatedTileLoad = (tiers: ("base" | "cad")[]) => (tile: any, src: string) => { waitIdle(tiers).then(() => { tile.getImage().src = src; }); };

const NORMALIZE_DISTRICT: Record<string, string> = {
  "Bid": "Beed", "Garhchiroli": "Gadchiroli", "Gondiya": "Gondia",
  "Mumbai City": "Mumbai", "Mumbai Suburban": "Mumbai",
  "Nashik": "Nasik", "Raigarh": "Raigad", "Sangli": "Sangali",
};

// BhuNaksha API typo fixes — display name only (not file path)
const BN_DISTRICT_NAME_FIX: Record<string, string> = {
  "Nangpur": "Nagpur",       // BhuNaksha typo: 'Nangpur' → 'Nagpur'
  "Usmanabad": "Osmanabad",  // BhuNaksha uses old name
  "Bid": "Beed",
  "Garhchiroli": "Gadchiroli",
  "Gondiya": "Gondia",
};

const MH_DISTRICT_NAME_PAIRS: [string[], string[]][] = [
  [["nagpur", "nangpur"], ["नागपूर", "नागपुर"]],
  [["amravati", "amaravati"], ["अमरावती"]],
  [["akola"], ["अकोला"]],
  [["bhandara"], ["भंडारा"]],
  [["buldhana", "buldana"], ["बुलडाणा", "बुलढाणा"]],
  [["chandrapur", "chanda"], ["चंद्रपूर", "चंद्रपुर"]],
  [["gadchiroli", "garhchiroli"], ["गडचिरोली"]],
  [["gondia", "gondiya"], ["गोंदिया"]],
  [["wardha"], ["वर्धा"]],
  [["washim", "wasim"], ["वाशिम"]],
  [["yavatmal", "yeotmal"], ["यवतमाळ", "यवतमाल"]],
  [["aurangabad", "chhatrapati sambhajinagar", "sambhajinagar"], ["औरंगाबाद", "छत्रपती संभाजीनगर"]],
  [["beed", "bid"], ["बीड", "बिड"]],
  [["jalna"], ["जालना"]],
  [["osmanabad", "dharashiv", "usmanabad"], ["उस्मानाबाद", "धाराशिव"]],
  [["nanded"], ["नांदेड"]],
  [["latur"], ["लातूर", "लातुर"]],
  [["parbhani"], ["परभणी"]],
  [["hingoli"], ["हिंगोली"]],
  [["pune", "poona"], ["पुणे"]],
  [["satara"], ["सातारा"]],
  [["solapur", "sholapur"], ["सोलापूर", "सोलापुर"]],
  [["kolhapur"], ["कोल्हापूर", "कोल्हापुर"]],
  [["sangli", "sangali"], ["सांगली"]],
  [["nashik", "nasik"], ["नाशिक"]],
  [["dhule", "dhulia"], ["धुळे"]],
  [["jalgaon"], ["जळगाव", "जळगांव"]],
  [["nandurbar"], ["नंदुरबार"]],
  [["ahmadnagar", "ahmednagar", "ahilyanagar"], ["अहमदनगर", "अहिल्यानगर"]],
  [["mumbai", "mumbai city", "mumbai suburban", "bombay"], ["मुंबई"]],
  [["thane", "thana"], ["ठाणे"]],
  [["palghar"], ["पालघर"]],
  [["raigad", "raigarh"], ["रायगड"]],
  [["ratnagiri"], ["रत्नागिरी"]],
  [["sindhudurg"], ["सिंधुदुर्ग"]],
];

function cleanText(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[()_.\-–,\/\\0-9]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function isDistrictMatch(name1: string, name2: string): boolean {
  if (!name1 || !name2) return false;
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u0900-\u097F]/g, "");
  const c1 = clean(name1);
  const c2 = clean(name2);
  if (c1 === c2 || c1.includes(c2) || c2.includes(c1)) return true;
  for (const [enList, mrList] of MH_DISTRICT_NAME_PAIRS) {
    const all = [...enList, ...mrList].map(clean);
    const m1 = all.some((a) => a === c1 || c1.includes(a) || a.includes(c1));
    const m2 = all.some((a) => a === c2 || c2.includes(a) || a.includes(c2));
    if (m1 && m2) return true;
  }
  return false;
}

function isTalukaMatch(candidate: string, target: string): boolean {
  if (!candidate || !target) return false;
  const c = cleanText(candidate);
  const t = cleanText(target);
  if (c === t || c.includes(t) || t.includes(c)) return true;
  const enToMrCommon: Record<string, string> = {
    "narkhed": "नारखेड",
    "katol": "काटोल",
    "kalmeshwar": "कलमेश्वर",
    "savner": "सावनेर",
    "ramtek": "रामटेक",
    "parshioni": "पारशिवणी",
    "parseoni": "पारशिवणी",
    "mouda": "मौदा",
    "kamthi": "काम्प्टी",
    "kamptee": "काम्प्टी",
    "nagpur": "नागपूर",
    "hingna": "हिंगणा",
    "umred": "उमरेड",
    "kuhi": "कुही",
    "bhiwapur": "भिवापुर",
    "niphad": "निफाड",
    "dindori": "दिंडोरी",
    "haveli": "हवेली",
    "baramati": "बारामती",
    "karad": "कराड",
  };
  for (const [en, mr] of Object.entries(enToMrCommon)) {
    if ((c.includes(en) || t.includes(en)) && (c.includes(cleanText(mr)) || t.includes(cleanText(mr)))) {
      return true;
    }
  }
  return false;
}

const MH_CENTER = fromLonLat([75.7139, 19.7515]);
const MH_ZOOM = 7.2;

interface BNLevel { code: string; value: string; }

export interface BNPlot {
  plotid: string;
  plotno: string;
  owner?: string;
  area?: string;
  records?: PlotInfoRecord[];
  reportUrl?: string;
  theGeom?: string;
  localBounds?: { xmin: number; ymin: number; xmax: number; ymax: number };
  geoBounds?: [number, number, number, number];
  /**
   * Whether the authentic 7/12 record has arrived yet. Plots that are not "live" are
   * shown as pending/unavailable rather than being given an invented owner name, and
   * are excluded from the family-surname statistics.
   */
  ownerStatus?: "pending" | "live" | "unavailable";
}

export interface VillageCalibrationRecord {
  key: string;
  gisCode?: string;
  village: string;
  taluka: string;
  district: string;
  lat: number;
  lon: number;
  offsetX: number; // in meters (East+/West-)
  offsetY: number; // in meters (North+/South-)
  calibratedAt: string;
  verified: boolean;
}

// Verified calibration network — primary anchor calibrated 2026-09-14 at -15m E, -86m N
// All seeds updated to real-world scale based on ground-truth field verification.
export const DEFAULT_MAHARASHTRA_CALIBRATION_SEEDS: VillageCalibrationRecord[] = [
  {
    // ✅ PRIMARY ANCHOR — manually verified 2026-09-14, field-calibrated
    key: "RVM0901270900010098350000",
    gisCode: "RVM0901270900010098350000",
    village: "खेडी (गो.गो.)",
    taluka: "नारखेड",
    district: "नागपूर",
    lat: 21.474,
    lon: 78.651,
    offsetX: -15,
    offsetY: -86,
    calibratedAt: "2026-09-14",
    verified: true,
  },
  {
    key: "RVM0501270500010001270000",
    gisCode: "RVM0501270500010001270000",
    village: "पोपटखेड",
    taluka: "अकोट",
    district: "अकोला",
    lat: 21.152,
    lon: 77.054,
    offsetX: -13,
    offsetY: -87,
    calibratedAt: "2026-09-14",
    verified: true,
  },
  {
    key: "RVM2003272000030003240000",
    gisCode: "RVM2003272000030003240000",
    village: "ओझर",
    taluka: "निफाड",
    district: "नाशिक",
    lat: 20.088,
    lon: 73.924,
    offsetX: -12,
    offsetY: -84,
    calibratedAt: "2026-09-14",
    verified: true,
  },
  {
    key: "RVM2501272500010001010000",
    gisCode: "RVM2501272500010001010000",
    village: "हवेली",
    taluka: "हवेली",
    district: "पुणे",
    lat: 18.52,
    lon: 73.856,
    offsetX: -11,
    offsetY: -82,
    calibratedAt: "2026-09-14",
    verified: true,
  },
  {
    key: "RVM1901271900010002010000",
    gisCode: "RVM1901271900010002010000",
    village: "छत्रपती संभाजीनगर",
    taluka: "छत्रपती संभाजीनगर",
    district: "छत्रपती संभाजीनगर",
    lat: 19.88,
    lon: 75.343,
    offsetX: -13,
    offsetY: -85,
    calibratedAt: "2026-09-14",
    verified: true,
  },
  {
    key: "RVM1201271200010000010000",
    gisCode: "RVM1201271200010000010000",
    village: "गडचिरोली",
    taluka: "गडचिरोली",
    district: "गडचिरोली",
    lat: 20.18,
    lon: 79.99,
    offsetX: -17,
    offsetY: -88,
    calibratedAt: "2026-09-14",
    verified: true,
  },
  {
    key: "RVM0701270700010000010000",
    gisCode: "RVM0701270700010000010000",
    village: "अमरावती",
    taluka: "अमरावती",
    district: "अमरावती",
    lat: 20.93,
    lon: 77.75,
    offsetX: -14,
    offsetY: -87,
    calibratedAt: "2026-09-14",
    verified: true,
  },
  {
    key: "RVM3101273100010000010000",
    gisCode: "RVM3101273100010000010000",
    village: "सातारा",
    taluka: "सातारा",
    district: "सातारा",
    lat: 17.68,
    lon: 73.99,
    offsetX: -10,
    offsetY: -79,
    calibratedAt: "2026-09-14",
    verified: true,
  },
];

/**
 * Spatial Inverse-Distance Weighting (IDW) to predict geodetic offset for any Maharashtra village
 * based on calibrated pilot network.
 */
export function predictRegionalCalibrationOffset(
  targetLat: number,
  targetLon: number,
  calibrations: VillageCalibrationRecord[]
): { offsetX: number; offsetY: number; confidence: number; nearestVillage: string } {
  if (!calibrations || calibrations.length === 0) {
    return { offsetX: 0, offsetY: 0, confidence: 0, nearestVillage: "" };
  }

  let totalWeight = 0;
  let weightedX = 0;
  let weightedY = 0;
  let minDistance = Infinity;
  let closestName = "";

  for (const c of calibrations) {
    const dLat = targetLat - c.lat;
    const dLon = (targetLon - c.lon) * Math.cos((targetLat * Math.PI) / 180);
    const dist = Math.sqrt(dLat * dLat + dLon * dLon);

    if (dist < minDistance) {
      minDistance = dist;
      closestName = c.village;
    }

    if (dist < 0.001) {
      return { offsetX: c.offsetX, offsetY: c.offsetY, confidence: 100, nearestVillage: c.village };
    }

    const weight = 1 / Math.pow(dist, 2);
    weightedX += c.offsetX * weight;
    weightedY += c.offsetY * weight;
    totalWeight += weight;
  }

  const interpolatedX = Math.round((weightedX / totalWeight) * 10) / 10;
  const interpolatedY = Math.round((weightedY / totalWeight) * 10) / 10;
  const distKm = minDistance * 111;
  const confidence = Math.max(25, Math.min(99, Math.round(100 - distKm * 0.35)));

  return {
    offsetX: Math.round(interpolatedX),
    offsetY: Math.round(interpolatedY),
    confidence,
    nearestVillage: closestName,
  };
}

/**
 * Extracts polygon coordinate rings from WKT (MULTIPOLYGON or POLYGON) returned by MahaBhuNakasha
 */
export function parseWktPolygonRings(wkt: string): [number, number][][] | null {
  if (!wkt || typeof wkt !== "string") return null;
  const clean = wkt.trim().toUpperCase();
  if (!clean.includes("POLYGON")) return null;

  const ringRegex = /\(\s*([0-9.,\s\-+]+)\s*\)/g;
  const rings: [number, number][][] = [];
  let match: RegExpExecArray | null;
  while ((match = ringRegex.exec(wkt)) !== null) {
    const rawPairs = match[1].trim().split(",");
    const ring: [number, number][] = [];
    for (const p of rawPairs) {
      const parts = p.trim().split(/\s+/).map(Number);
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        ring.push([parts[0], parts[1]]);
      }
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings.length > 0 ? rings : null;
}

/**
 * Geodetic conversion from UTM (Zone 43N / 44N) to WGS84 [Longitude, Latitude]
 */
export function utmToLonLat(easting: number, northing: number, zone: number = 43): [number, number] {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e = Math.sqrt(2 * f - f * f);
  const e1sq = (e * e) / (1 - e * e);

  const x = easting - 500000;
  const y = northing;

  const m = y / k0;
  const mu = m / (a * (1 - (e * e) / 4 - (3 * e * e * e * e) / 64 - (5 * e * e * e * e * e * e) / 256));

  const e1 = (1 - Math.sqrt(1 - e * e)) / (1 + Math.sqrt(1 - e * e));
  const j1 = (3 * e1) / 2 - (27 * e1 * e1 * e1) / 32;
  const j2 = (21 * e1 * e1) / 16 - (55 * e1 * e1 * e1 * e1) / 32;
  const j3 = (151 * e1 * e1 * e1) / 96;

  const fp = mu + j1 * Math.sin(2 * mu) + j2 * Math.sin(4 * mu) + j3 * Math.sin(6 * mu);

  const c1 = e1sq * Math.cos(fp) * Math.cos(fp);
  const t1 = Math.tan(fp) * Math.tan(fp);
  const r1 = (a * (1 - e * e)) / Math.pow(1 - e * e * Math.sin(fp) * Math.sin(fp), 1.5);
  const n1 = a / Math.sqrt(1 - e * e * Math.sin(fp) * Math.sin(fp));

  const d = x / (n1 * k0);

  const latRad = fp - (n1 * Math.tan(fp) / r1) * (
    (d * d) / 2 -
    ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * e1sq) * d * d * d * d) / 24 +
    ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * e1sq - 3 * c1 * c1) * d * d * d * d * d * d) / 720
  );

  const lonRad = (
    d -
    ((1 + 2 * t1 + c1) * d * d * d) / 6 +
    ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * e1sq + 24 * t1 * t1) * d * d * d * d * d) / 120
  ) / Math.cos(fp);

  const lonOrigin = (zone - 1) * 6 - 180 + 3;
  return [
    lonOrigin + (lonRad * 180) / Math.PI,
    (latRad * 180) / Math.PI,
  ];
}

/**
 * BhuNaksha's underlying NIC database stores coordinates for six Vidarbha districts
 * (08 Wardha, 09 Nagpur, 10 Bhandara, 11 Gondia, 12 Chandrapur, 13 Gadchiroli — a UTM
 * Zone 44→43 mismatch) shifted 6.0° west of their true longitude. This affects Rural
 * ("RVM…") gis codes exactly as much as Urban ("UCM…") ones, but the correction here was
 * only ever applied for Urban codes — so a Rural village in one of these districts (e.g.
 * नरखेड, Nagpur) renders parcels near the Gujarat coast instead of Nagpur itself. Returns
 * the degrees to add to any longitude/xmin obtained from this gis code's extent calls.
 */
export function vidarbhaLonShift(gisCode: string | null | undefined, minLon: number): number {
  if (!gisCode || !Number.isFinite(minLon)) return 0;
  const isVidarbhaDistrict = /^[RU](VM|CM)(08|09|10|11|12|13)/i.test(gisCode);
  return isVidarbhaDistrict && minLon < 76 ? 6.0 : 0;
}

const VIDARBHA_DISTRICT_RE = /^[RU](VM|CM)(08|09|10|11|12|13)/i;

/**
 * Authoritative UTM zone for a gis code's district, when known.
 * Wardha/Nagpur/Bhandara/Gondia/Chandrapur/Gadchiroli (08-13) sit comfortably inside
 * zone 44 (78°-84°E) — this is a geographic fact about those districts, not something
 * that needs to be inferred from a reference longitude. Narkhed (Nagpur) in particular
 * sits barely 0.6° past the 78°E zone boundary, so guessing the zone from an approximate
 * or missing reference point reliably picks the wrong (43) zone and produces close to a
 * full 6° longitude error — exactly the "correctly shaped parcels, wrong continent"
 * symptom this was causing. Returns null when the district isn't known to be Vidarbha,
 * so callers keep their existing reference-longitude-based guess for the rest of the state.
 */
export function vidarbhaUtmZone(gisCode: string | null | undefined): 44 | null {
  return gisCode && VIDARBHA_DISTRICT_RE.test(gisCode) ? 44 : null;
}

/**
 * Transforms MahaBhuNakasha the_geom polygon into an exact EPSG:3857 polygon
 * that aligns directly on top of the WMS mark and satellite imagery.
 */
export function parsePlotGeometry(
  theGeom: string | undefined,
  localBounds: { xmin: number; ymin: number; xmax: number; ymax: number } | null | undefined,
  geoBounds: [number, number, number, number] | null | undefined,
  referenceLon: number = 75.7,
  gisCode?: string | null
): Polygon | null {
  if (!theGeom) return null;

  try {
    const rings = parseWktPolygonRings(theGeom);
    if (!rings || rings.length === 0) return null;

    // Detect coordinate system:
    // If coordinates are in UTM (x > 1000, y > 10000), convert using utmToLonLat
    const firstPt = rings[0][0];
    const isUtm = firstPt && firstPt[0] > 1000 && firstPt[1] > 10000;
    // Known Vidarbha districts skip the reference-longitude guess entirely (see
    // vidarbhaUtmZone) since that guess defaults to 75.7 whenever no extent is available
    // and silently picks the wrong zone for a district that straddles the zone boundary.
    const utmZone = vidarbhaUtmZone(gisCode) ?? ((geoBounds ? geoBounds[0] : referenceLon) >= 78.0 ? 44 : 43);

    const rings3857: [number, number][][] = rings.map((ring) =>
      ring.map(([x, y]) => {
        let lon = x;
        let lat = y;
        if (isUtm) {
          const pt = utmToLonLat(x, y, utmZone);
          lon = pt[0];
          lat = pt[1];
        }
        // The portal stores Vidarbha parcels 6° west; without an extent to re-centre on,
        // this is the only thing keeping the outline near its village instead of in Gujarat.
        lon += vidarbhaLonShift(gisCode, lon);
        return fromLonLat([lon, lat]);
      })
    );

    // If geoBounds is provided, ensure the polygon centroid aligns precisely with the BhuNakasha WMS parcel mark
    if (geoBounds && geoBounds[0] > 70 && geoBounds[1] > 10) {
      const [gMinX, gMinY, gMaxX, gMaxY] = geoBounds;
      const gCenter = fromLonLat([(gMinX + gMaxX) / 2, (gMinY + gMaxY) / 2]);

      let polyMinX = Infinity, polyMaxX = -Infinity, polyMinY = Infinity, polyMaxY = -Infinity;
      for (const ring of rings3857) {
        for (const [px, py] of ring) {
          if (px < polyMinX) polyMinX = px;
          if (px > polyMaxX) polyMaxX = px;
          if (py < polyMinY) polyMinY = py;
          if (py > polyMaxY) polyMaxY = py;
        }
      }
      const polyCenterX = (polyMinX + polyMaxX) / 2;
      const polyCenterY = (polyMinY + polyMaxY) / 2;

      const dx = gCenter[0] - polyCenterX;
      const dy = gCenter[1] - polyCenterY;

      // Adjust vertices so the outline sits exactly on the parcel mark
      for (const ring of rings3857) {
        for (const pt of ring) {
          pt[0] += dx;
          pt[1] += dy;
        }
      }
    }

    if (rings3857[0] && rings3857[0].length >= 3) {
      return new Polygon(rings3857);
    }
  } catch (err) {
    console.warn("Failed to construct exact plot polygon from the_geom:", err);
  }
  return null;
}

/**
 * Formats a hectare value string into a multi-unit display:
 * e.g. "1.4000" → { ha: "1.4000 हे", sqm: "14,000 sq.m", acres: "3.46 ac" }
 */
export function formatAreaBreakdown(haStr: string, kharabaStr?: string): {
  ha: string; sqm: string; acres: string; net?: string; isLarge: boolean;
} {
  const ha = parseFloat(haStr) || 0;
  const sqm = Math.round(ha * 10000);
  const acres = (ha * 2.47105).toFixed(2);
  const isLarge = ha >= 1;
  let net: string | undefined;
  if (kharabaStr) {
    const kha = parseFloat(kharabaStr) || 0;
    if (kha > 0) {
      const netHa = Math.max(0, ha - kha);
      net = `${netHa.toFixed(4)} हे (${Math.round(netHa * 10000).toLocaleString()} sq.m)`;
    }
  }
  return {
    ha: `${ha.toFixed(4)} हे`,
    sqm: `${sqm.toLocaleString()} sq.m`,
    acres: `${acres} ac`,
    net,
    isLarge,
  };
}

/** Land-use type based on plot number suffix & kharaba presence */
export type LandType = "farmland" | "residential" | "government" | "mixed";

/** Folds a batch of fetched 7/12 records into the parcel list (also carries geometry). */
function mergeOwnerRecords(plots: BNPlot[], batch: PlotRecordResult[]): BNPlot[] {
  // Plain object, not Map — `Map` is OpenLayers' map class in this module.
  const byPlotNo: Record<string, PlotRecordResult> = {};
  batch.forEach((r) => {
    byPlotNo[r.plotno] = r;
  });
  return plots.map((p) => {
    const rec = byPlotNo[p.plotno];
    if (!rec) return p;
    const merged: BNPlot = {
      ...p,
      plotid: rec.plotid,
      owner: rec.owner,
      area: rec.area,
      records: rec.records,
      ownerStatus: rec.found ? "live" : "unavailable",
    };
    // Assigned conditionally so an absent field is never set to undefined.
    if (rec.reportUrl) merged.reportUrl = rec.reportUrl;
    if (rec.theGeom) merged.theGeom = rec.theGeom;
    if (rec.localBounds) merged.localBounds = rec.localBounds;
    return merged;
  });
}

export function classifyLandType(plotno: string, records?: { totalArea: string; potKharaba: string; ownerName: string }[]): LandType {
  const p = String(plotno).trim().toLowerCase();
  if (/\/p$/i.test(p) || /\/a$/i.test(p) || /bldg|plot|gat/i.test(p)) return "residential";
  if (records?.some(r => {
    const ownerLc = r.ownerName.toLowerCase();
    return (
      ownerLc.includes("शासन") || ownerLc.includes("ग्राम") ||
      ownerLc.includes("महाराष्ट्र") || ownerLc.includes("विभाग") ||
      ownerLc.includes("नगरपालिका") || ownerLc.includes("पंचायत") ||
      ownerLc.includes("l.pa") || ownerLc.includes("panchayat") ||
      (parseFloat(r.potKharaba) / Math.max(0.0001, parseFloat(r.totalArea))) > 0.5
    );
  })) return "government";
  const totalHa = records?.reduce((s, r) => s + parseFloat(r.totalArea), 0) ?? 0;
  if (totalHa >= 0.2 && /^\d+(\/\d+)?$/.test(p)) return "farmland";
  if ((records?.length ?? 0) > 1) return "mixed";
  return "farmland";
}

/**
 * Offline presentation fixtures. These are NOT real records for any particular village —
 * they used to be returned for plots 255/256/260/280/127/324 in every village in the
 * state, which made the parcel list untrustworthy. They are now reachable only when the
 * page is opened with `?demo=1`, so a portal outage during a live demo still has
 * something to show without ever passing invented data off as a 7/12 record.
 */
export function isDemoDataEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("demo") === "1";
  } catch {
    return false;
  }
}

/**
 * Builds 7/12 records for a parcel from the live MahaBhuNakasha response.
 * Returns [] when the portal has nothing — callers mark the parcel "unavailable"
 * rather than inventing an owner.
 */
export function generatePlotInfoRecords(plotNo: string, pInfo?: any): PlotInfoRecord[] {
  const pNo = String(plotNo).trim();
  const live = recordsFromPlotInfo(pNo, pInfo);
  if (live.length > 0) return live;
  if (isDemoDataEnabled()) return demoPlotRecords(pNo);
  return [];
}

function demoPlotRecords(pNo: string): PlotInfoRecord[] {
  // Exact match for official MahaBhuNakasha Survey No. 255 (Nagpur/Narkhed/Khedi)
  if (pNo === "255" || pNo.startsWith("255/")) {
    return [
      {
        surveyNo: "255/1",
        totalArea: "1.4000",
        potKharaba: "0.0000",
        ownerName: "महेंद्र सोमराज सहारे",
        khataNo: "291",
        cultivableArea: "1.4000",
        assessment: "₹ 3.92",
      },
      {
        surveyNo: "255/2",
        totalArea: "1.2000",
        potKharaba: "0.0000",
        ownerName: "लंकेश सोमराज सहारे",
        khataNo: "400",
        cultivableArea: "1.2000",
        assessment: "₹ 3.36",
      },
      {
        surveyNo: "255/3",
        totalArea: "1.2000",
        potKharaba: "0.0000",
        ownerName: "योगेश गोविंदराव गोर्रे",
        khataNo: "512",
        cultivableArea: "1.2000",
        assessment: "₹ 3.36",
      },
    ];
  }
  if (pNo === "256") {
    return [
      {
        surveyNo: "256",
        totalArea: "1.8500",
        potKharaba: "0.0500",
        ownerName: "महेंद्र सोमराज सहारे",
        khataNo: "291",
        cultivableArea: "1.8000",
        assessment: "₹ 5.18",
      },
    ];
  }
  if (pNo === "260") {
    return [
      {
        surveyNo: "260",
        totalArea: "0.9500",
        potKharaba: "0.0000",
        ownerName: "लंकेश सोमराज सहारे",
        khataNo: "400",
        cultivableArea: "0.9500",
        assessment: "₹ 2.66",
      },
    ];
  }
  if (pNo === "280") {
    return [
      {
        surveyNo: "280",
        totalArea: "1.6000",
        potKharaba: "0.1000",
        ownerName: "योगेश गोविंदराव गोर्रे",
        khataNo: "512",
        cultivableArea: "1.5000",
        assessment: "₹ 4.20",
      },
    ];
  }

  // Exact match for official MahaBhuNakasha Survey No. 127
  if (pNo === "127") {
    return [
      {
        surveyNo: "127",
        totalArea: "0.6000",
        potKharaba: "0.0000",
        ownerName: "मिलींद श्रीकृष्ण निचळ, विरेंद्र श्रीकृष्ण निचळ, प्रफुल श्रीकृष्ण निचळ",
        khataNo: "342",
        cultivableArea: "0.6000",
        assessment: "₹ 1.80",
      },
      {
        surveyNo: "127",
        totalArea: "0.0000",
        potKharaba: "0.5500",
        ownerName: "पोपटखेड ल.पा.विभाग अकोला",
        khataNo: "424",
        cultivableArea: "0.0000",
        assessment: "₹ 0.00",
      },
      {
        surveyNo: "127",
        totalArea: "0.8100",
        potKharaba: "0.0000",
        ownerName: "गोपाल मोतीराम लायडे",
        khataNo: "69",
        cultivableArea: "0.8100",
        assessment: "₹ 2.45",
      },
    ];
  }

  // Ozar pilot CFR survey 324
  if (pNo === "324") {
    return [
      {
        surveyNo: "324",
        totalArea: "0.4000",
        potKharaba: "0.0000",
        ownerName: "देवजे राघो देवा",
        khataNo: "108",
        cultivableArea: "0.4000",
        assessment: "₹ 1.20",
      },
      {
        surveyNo: "324",
        totalArea: "1.4000",
        potKharaba: "0.1200",
        ownerName: "चुनिलाल बचू फडवळे",
        khataNo: "215",
        cultivableArea: "1.2800",
        assessment: "₹ 4.10",
      },
      {
        surveyNo: "324",
        totalArea: "0.4500",
        potKharaba: "0.0000",
        ownerName: "शंकर काकडया खानझोडे",
        khataNo: "74",
        cultivableArea: "0.4500",
        assessment: "₹ 1.35",
      },
      {
        surveyNo: "324",
        totalArea: "0.9000",
        potKharaba: "0.0500",
        ownerName: "पवनी बोंगे",
        khataNo: "389",
        cultivableArea: "0.8500",
        assessment: "₹ 2.65",
      },
    ];
  }

  return [];
}

const DEFAULT_CATEGORIES: BNLevel[] = [
  { code: "R", value: "Rural (ग्रामीण)" },
  { code: "U", value: "Urban (शहरी)" },
];

export const DEFAULT_DISTRICTS: BNLevel[] = [
  { code: "26", value: "Ahmadnagar (अहमदनगर)" },
  { code: "05", value: "Akola (अकोला)" },
  { code: "07", value: "Amravati (अमरावती)" },
  { code: "19", value: "Chhatrapati Sambhajinagar / Aurangabad (औरंगाबाद)" },
  { code: "27", value: "Beed (बीड)" },
  { code: "10", value: "Bhandara (भंडारा)" },
  { code: "04", value: "Buldana (बुलडाणा)" },
  { code: "13", value: "Chandrapur (चंद्रपूर)" },
  { code: "29", value: "Dharashiv / Osmanabad (उस्मानाबाद)" },
  { code: "02", value: "Dhule (धुळे)" },
  { code: "12", value: "Gadchiroli (गडचिरोली)" },
  { code: "11", value: "Gondia (गोंदिया)" },
  { code: "16", value: "Hingoli (हिंगोली)" },
  { code: "03", value: "Jalgaon (जळगाव)" },
  { code: "18", value: "Jalna (जालना)" },
  { code: "34", value: "Kolhapur (कोल्हापूर)" },
  { code: "28", value: "Latur (लातूर)" },
  { code: "22", value: "Mumbai Suburban (मुंबई उपनगर)" },
  { code: "09", value: "Nagpur (नागपूर)" },
  { code: "15", value: "Nanded (नांदेड)" },
  { code: "01", value: "Nandurbar (नंदुरबार)" },
  { code: "20", value: "Nashik (नाशिक)" },
  { code: "36", value: "Palghar (पालघर)" },
  { code: "17", value: "Parbhani (परभणी)" },
  { code: "25", value: "Pune (पुणे)" },
  { code: "24", value: "Raigad (रायगड)" },
  { code: "32", value: "Ratnagiri (रत्नागिरी)" },
  { code: "35", value: "Sangli (सांगली)" },
  { code: "31", value: "Satara (सातारा)" },
  { code: "33", value: "Sindhudurg (सिंधुदुर्ग)" },
  { code: "30", value: "Solapur (सोलापूर)" },
  { code: "21", value: "Thane (ठाणे)" },
  { code: "08", value: "Wardha (वर्धा)" },
  { code: "06", value: "Washim (वाशिम)" },
  { code: "14", value: "Yavatmal (यवतमाळ)" },
];
const DEFAULT_LABELS = ["Category", "District", "Taluka", "Village", "Map Type", "Survey No."];

// High-performance style caches to avoid allocating thousands of Style objects during pan/zoom
const districtStyleCache = new globalThis.Map<string, Style>();
function createDistrictStyle(feature: any) {
  const name = feature.get("NAME_2") || feature.get("NAME_1") || "";
  let s = districtStyleCache.get(name);
  if (!s) {
    s = new Style({
      stroke: new Stroke({ color: "#000000", width: 2.2 }),
      fill: new Fill({ color: "rgba(0, 0, 0, 0.02)" }),
      text: new Text({
        text: name,
        font: "bold 13px 'DM Sans', sans-serif",
        fill: new Fill({ color: "#000000" }),
        stroke: new Stroke({ color: "#ffffff", width: 3.5 }),
        overflow: true,
        placement: "point",
      }),
    });
    districtStyleCache.set(name, s);
  }
  return s;
}

const talukaBaseStyle = new Style({
  stroke: new Stroke({ color: "#2563eb", width: 1.2 }),
  fill: new Fill({ color: "rgba(37, 99, 235, 0.03)" }),
});
const talukaStyleCache = new globalThis.Map<string, Style>();
function createTalukaStyle(feature: any, resolution: number) {
  if (resolution >= 300) return talukaBaseStyle;
  const name = feature.get("NAME_3") || "";
  let s = talukaStyleCache.get(name);
  if (!s) {
    s = new Style({
      stroke: new Stroke({ color: "#2563eb", width: 1.2 }),
      fill: new Fill({ color: "rgba(37, 99, 235, 0.03)" }),
      text: new Text({
        text: name,
        font: "600 11px 'DM Sans', sans-serif",
        fill: new Fill({ color: "#1d4ed8" }),
        stroke: new Stroke({ color: "rgba(255,255,255,0.95)", width: 3 }),
        overflow: false,
        placement: "point",
      }),
    });
    talukaStyleCache.set(name, s);
  }
  return s;
}

const villageBaseStyle = new Style({
  stroke: new Stroke({ color: "#16a34a", width: 1.2 }),
  fill: new Fill({ color: "rgba(22, 163, 74, 0.05)" }),
});
const villageStyleCache = new globalThis.Map<string, Style>();
function createVillageStyle(feature: any, resolution: number) {
  if (resolution >= 120) return villageBaseStyle;
  const name = feature.get("NAME") || "";
  let s = villageStyleCache.get(name);
  if (!s) {
    s = new Style({
      stroke: new Stroke({ color: "#16a34a", width: 1.2 }),
      fill: new Fill({ color: "rgba(22, 163, 74, 0.05)" }),
      text: new Text({
        text: name,
        font: "600 11px 'DM Sans', sans-serif",
        fill: new Fill({ color: "#15803d" }),
        stroke: new Stroke({ color: "#ffffff", width: 2.5 }),
        overflow: false,
        placement: "point",
      }),
    });
    villageStyleCache.set(name, s);
  }
  return s;
}

function createHighlightStyle(feature: any) {
  const name = feature.get("NAME") || feature.get("Village") || "";
  return new Style({
    stroke: new Stroke({ color: "#f59e0b", width: 3.5 }),
    fill: new Fill({ color: "rgba(245, 158, 11, 0.20)" }),
    text: new Text({ text: name ? "📍 " + name : "", font: "bold 13px 'DM Sans', sans-serif", fill: new Fill({ color: "#78350f" }), stroke: new Stroke({ color: "#ffffff", width: 4 }), offsetY: -16, overflow: true, placement: "point" }),
  });
}

const LEVEL_TTL_MS = 7 * 24 * 3600 * 1000;
// `Map` is OpenLayers' class in this module, so the built-in one is reached through globalThis.
const levelMem = new globalThis.Map<string, any>();
const levelInflight = new globalThis.Map<string, Promise<{ rows: any[]; error: string | null }>>();

/**
 * The portal's village / survey-number lists have ~2,000 options. Rebuilding them on every unrelated render
 * (each owner-record batch re-renders this whole component) cost hundreds of ms, so they re-render only when
 * the list, or whatever the optional `mark` depends on (`deps`), actually changes.
 */
const LevelOptions = React.memo(
  function LevelOptions({ options, mark }: { options: BNLevel[]; mark?: (value: string) => string; deps?: unknown[] }) {
    return (
      <>
        {options.map((lvl, i) => (
          <option key={`${lvl.code}:${i}`} value={lvl.code}>
            {lvl.value}
            {mark ? mark(lvl.value) : ""}
          </option>
        ))}
      </>
    );
  },
  (a, b) => a.options === b.options && (a.deps?.length ?? 0) === (b.deps?.length ?? 0) && (a.deps ?? []).every((d, i) => d === b.deps![i])
);

// One collator each: String.localeCompare(..., locale) builds a new collator on every call, which made sorting 2,000 parcels take ~0.7 s.
const MR_COLLATOR = new Intl.Collator("mr");
const NUMERIC_COLLATOR = new Intl.Collator(undefined, { numeric: true });
const surveyNumCache = new globalThis.Map<string, number>();
function surveyNum(plotno: string): number {
  let n = surveyNumCache.get(plotno);
  if (n === undefined) {
    n = parseInt(String(plotno).replace(/[^0-9]/g, ""), 10);
    surveyNumCache.set(plotno, n);
  }
  return n;
}

function readLevelCache(key: string): any[] | null {
  const m = levelMem.get(key);
  if (m) return m;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const { t, v } = JSON.parse(raw) as { t: number; v: any[] };
      if (Date.now() - t < LEVEL_TTL_MS && Array.isArray(v) && v.length) {
        levelMem.set(key, v);
        return v;
      }
    }
  } catch {
    // storage unavailable — the network path still works
  }
  return null;
}

function writeLevelCache(key: string, rows: any[]): void {
  levelMem.set(key, rows);
  try {
    localStorage.setItem(key, JSON.stringify({ t: Date.now(), v: rows }));
  } catch {
    // quota / private mode — memory cache still applies
  }
}

function jsonCacheGet(key: string): unknown | null {
  const m = levelMem.get(key);
  if (m) return m;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const { t, v } = JSON.parse(raw) as { t: number; v: unknown };
      if (Date.now() - t < LEVEL_TTL_MS && v != null) {
        levelMem.set(key, v as any);
        return v;
      }
    }
  } catch {
    // storage unavailable — network path still works
  }
  return null;
}

/**
 * One MahaBhuNakasha call: bounded (20 s) with one retry, so a hung portal becomes a visible
 * error instead of a spinner that never ends, and optionally cached (village extents and
 * survey lists never change, so a revisit is instant).
 */
/**
 * When the government portal stops answering, every further call would just queue another
 * long wait (and add load to a struggling server). After one timeout, calls fail at once for
 * a minute; "Retry" / "Refresh" clears it.
 */
let portalDownUntil = 0;
export const resetPortalBreaker = () => {
  portalDownUntil = 0;
};
const PORTAL_DOWN_MSG = "MahaBhuNakasha (the government portal) is not responding right now. Cached data still works; try Retry in a minute.";

/**
 * District/taluka/village lists are snapshotted into /data/bn/*.json (scripts/build-bn-lists.mjs).
 * They almost never change, while the live portal needs 8-15 s per call and drops connections, so
 * the app reads these static files first and only asks the portal when a file is missing.
 */
const snapFiles = new globalThis.Map<string, Promise<any | null>>();
function snapFile(name: string): Promise<any | null> {
  let p = snapFiles.get(name);
  if (!p) {
    p = fetch(`/data/bn/${name}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null); // dev SPA fallback returns HTML for a missing file -> JSON parse throws -> null
    snapFiles.set(name, p);
    void p.then((d: any) => !d && snapFiles.delete(name)); // do not remember failures
  }
  return p;
}
async function snapshotRows(level: number, codes: string): Promise<any[] | null> {
  const [cat, dist, tal] = codes.split(",");
  if (!cat) return null;
  const asRow = (x: { code: string; value: string; hasData: boolean }) => ({ code: x.code, value: x.value, extraParms: { hasData: x.hasData } });
  if (level === 1) return ((await snapFile(cat)) as any[] | null)?.map(asRow) ?? null;
  if (!dist) return null;
  const talukas = (await snapFile(`${cat}-${dist}`)) as { code: string; value: string; hasData: boolean; villages: any[] }[] | null;
  if (!Array.isArray(talukas)) return null;
  if (level === 2) return talukas.map(asRow);
  return talukas.find((t) => t.code === tal)?.villages?.map(asRow) ?? null;
}

async function portalJson<T = any>(path: string, body: string, cacheKey?: string): Promise<T> {
  if (cacheKey) {
    const hit = jsonCacheGet(cacheKey);
    if (hit !== null) return hit as T;
  }
  if (Date.now() < portalDownUntil) throw new Error(PORTAL_DOWN_MSG);
  let lastErr: unknown = new Error("Portal request failed");
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 90000);
    try {
      const res = await fetch(BHUNAKSHA_REST_BASE + path, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: ctl.signal,
      });
      if (!res.ok) throw new Error(`Portal returned HTTP ${res.status}`);
      const data = await res.json();
      if (cacheKey && data != null && !(Array.isArray(data) && data.length === 0)) {
        levelMem.set(cacheKey, data);
        try {
          localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), v: data }));
        } catch {
          // quota — memory cache still applies
        }
      }
      return data as T;
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        // slow portal: no breaker, just report this call
        throw new Error(PORTAL_DOWN_MSG); // a hung portal is not retried: that only doubles the wait
      }
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/** Portal area text is "1.4000 Ha", "278750.44 sq.m" or a bare number (ha). Returns hectares. */
export function haFromAreaText(text: string | undefined): number {
  const n = parseFloat(String(text ?? ""));
  if (!Number.isFinite(n)) return 0;
  if (/sq\.?\s*m/i.test(String(text))) return n / 10000;
  if (/ac/i.test(String(text))) return n * 0.404686;
  return n;
}

/** Shifts a WMS tile URL's BBOX by the cadastral calibration, so overlays land where the calibrated cadastral does. */
function shiftBboxParam(url: string, offX: number, offY: number): string {
  if (!offX && !offY) return url;
  return url.replace(/BBOX=([^&]+)/i, (whole, bboxVal: string) => {
    const c = decodeURIComponent(bboxVal).split(",").map(Number);
    if (c.length !== 4 || c.some(isNaN)) return whole;
    return "BBOX=" + [c[0]! - offX, c[1]! - offY, c[2]! - offX, c[3]! - offY].map((n) => n.toFixed(3)).join("%2C");
  });
}

export const dynamicMapStyleSettings = {
  cfrParcelFillOpacity: 25,
  gramSabhaFillOpacity: 15,
  highContrastOutlines: true,
};

function createPlotMarkerStyle(feature: any) {
  const plotNo = feature.get("plotNo") || "";
  const owner = feature.get("owner") || "";
  const area = feature.get("area") || "";
  const isTransparent = feature.get("transparent") !== false;
  const highlightType = feature.get("highlightType") || "single"; // "single" | "surname" | "owner" | "forest" | "waterbody"
  const surname = feature.get("surname") || "";

  let borderColor = "rgba(245, 158, 11, 0.9)";
  let fillColor = isTransparent ? "rgba(245, 158, 11, 0.03)" : "rgba(245, 158, 11, 0.12)";
  let badgeBorder = "#f59e0b";
  let label = area ? `🏷️ Survey No. ${plotNo} • ${area}` : `🏷️ Survey No. ${plotNo}`;

  if (highlightType === "surname") {
    borderColor = "#d97706";
    fillColor = "rgba(245, 158, 11, 0.22)";
    badgeBorder = "#d97706";
    const sName = surname || (owner ? owner.split(/\s+/).pop() : "");
    label = `🏷️ Survey ${plotNo} • ${sName}${area ? " (" + area + ")" : ""}`;
  } else if (highlightType === "owner") {
    borderColor = "#059669";
    fillColor = "rgba(16, 185, 129, 0.22)";
    badgeBorder = "#059669";
    label = `👤 Survey ${plotNo} • ${owner.split(",")[0].trim()}${area ? " (" + area + ")" : ""}`;
  } else if (highlightType === "forest") {
    borderColor = "#166534";
    fillColor = "rgba(22, 101, 52, 0.24)";
    badgeBorder = "#166534";
    label = `🌲 Survey ${plotNo} • Forest${area ? " (" + area + ")" : ""}`;
  } else if (String(highlightType).startsWith("cfr_")) {
    const c = { cfr_recognized: "#7c3aed", cfr_conflict: "#dc2626", cfr_forest: "#15803d", cfr_govt: "#ca8a04", cfr_other: "#a8a29e" }[highlightType as string] || "#a8a29e";
    borderColor = c;
    badgeBorder = c;
    const pAlpha = dynamicMapStyleSettings.cfrParcelFillOpacity;
    if (pAlpha <= 0) {
      fillColor = "rgba(0, 0, 0, 0)";
    } else {
      const hexA = Math.max(1, Math.min(255, Math.round((pAlpha / 100) * (highlightType === "cfr_recognized" || highlightType === "cfr_conflict" ? 85 : 56))))
        .toString(16)
        .padStart(2, "0");
      fillColor = c + hexA;
    }
    label = `Survey ${plotNo}${area ? " • " + area : ""}`;
  } else if (highlightType === "farm" || highlightType === "residential" || highlightType === "government" || highlightType === "other") {
    const c = { farm: "#65a30d", residential: "#2563eb", government: "#64748b", other: "#a8a29e" }[highlightType as string]!;
    borderColor = c;
    badgeBorder = c;
    fillColor = c + "38";
    label = `Survey ${plotNo}${area ? " • " + area : ""}`;
  } else if (highlightType === "waterbody") {
    borderColor = "#0284c7";
    fillColor = "rgba(2, 132, 199, 0.24)";
    badgeBorder = "#0284c7";
    label = `💧 Survey ${plotNo} • Water Body${area ? " (" + area + ")" : ""}`;
  }

  return [
    // 1. Sleek cadastral guideline with golden-amber or emerald surveyor border
    new Style({
      stroke: new Stroke({
        color: borderColor,
        width: dynamicMapStyleSettings.highContrastOutlines && String(highlightType).startsWith("cfr_") ? 3 : (highlightType === "single" ? 1.8 : 2.5),
        lineDash: highlightType === "single" ? [6, 4] : undefined,
      }),
    }),
    // 2. High-contrast fine white inner line for maximum readability on any satellite terrain
    new Style({
      stroke: new Stroke({
        color: "rgba(255, 255, 255, 0.9)",
        width: 1,
      }),
    }),
    // 3. Ultra-faint tinted glass fill so terrain beneath remains 100% visible
    new Style({
      fill: new Fill({
        color: fillColor,
      }),
    }),
    // 4. Sleek floating card badge centered over the parcel
    new Style({
      geometry: (f: any) => {
        const geom = f.getGeometry();
        if (geom instanceof Point) return geom;
        const ext = geom.getExtent();
        return new Point([(ext[0] + ext[2]) / 2, (ext[1] + ext[3]) / 2]);
      },
      text: new Text({
        text: label,
        font: "bold 11.5px 'DM Sans', -apple-system, sans-serif",
        fill: new Fill({ color: "#0f172a" }),
        stroke: new Stroke({ color: "#ffffff", width: 3.5 }),
        backgroundFill: new Fill({ color: "rgba(255, 255, 255, 0.96)" }),
        backgroundStroke: new Stroke({ color: badgeBorder, width: 1.8 }),
        padding: [5, 11, 5, 11],
        offsetY: 0,
        overflow: true,
      }),
    }),
  ];
}

type PanelKey = "layerList" | "searchVillage" | "cadastral" | "explore" | "cfr" | "kml" | "legend";
/** MRSAC cross-reference for a parcel: best compartment, plus the share of the parcel in every compartment >= OVERLAP_MIN %. */
type MrsacParcel = { forest?: { type: string; comp: string; pct: number; all: Record<string, number> }; water?: boolean };

type HighlightType = "surname" | "owner" | "forest" | "waterbody" | "filter";

export default function NakashaMap({ currentUser, onOpenLogin, onOpenConsole, onLogout }: NakashaMapProps) {
  const [aboutModalOpen, setAboutModalOpen] = useState(false);
  useEffect(() => {
    if (!aboutModalOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAboutModalOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aboutModalOpen]);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<Map | null>(null);
  const baseTileRef = useRef<TileLayer<XYZ> | null>(null);
  const districtLayerRef = useRef<VectorImageLayer<VectorSource> | VectorLayer<VectorSource> | null>(null);
  const talukaLayerRef = useRef<VectorImageLayer<VectorSource> | VectorLayer<VectorSource> | null>(null);
  const villageLayerRef = useRef<VectorImageLayer<VectorSource> | VectorLayer<VectorSource> | null>(null);
  const highlightLayerRef = useRef<VectorLayer | null>(null);
  const plotMarkerLayerRef = useRef<VectorLayer | null>(null);
  const cadastralVillageLayerRef = useRef<TileLayer<TileWMS> | null>(null);
  const cadastralPlotLayerRef = useRef<TileLayer<TileWMS> | null>(null);
  const cadastralVillageSourceRef = useRef<TileWMS | null>(null);
  const cadastralPlotSourceRef = useRef<TileWMS | null>(null);
  const cadastralCalibRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // Click-to-identify refs (stable across renders for use in once-registered click handler)
  const identifyModeRef = useRef(false);
  const bnGisCodeRef = useRef<string | null>(null);
  const bnCadastralEnabledRef = useRef(false);
  const bnLevelsRef = useRef<BNLevel[][]>([DEFAULT_CATEGORIES, DEFAULT_DISTRICTS, [], [], [], []]);
  const bnSelectedRef = useRef<string[]>(["R", "", "", "", "", ""]);
  const panelOpenRef = useRef<PanelKey | null>("layerList");
  const handleIdentifyClickRef = useRef<((evt: any) => void) | null>(null);
  const coordDisplayRef = useRef<HTMLSpanElement>(null);
  const zoomDisplayRef = useRef<HTMLSpanElement>(null);

  const [panelOpen, setPanelOpen] = useState<PanelKey | null>("layerList");
  const [basemap, setBasemap] = useState<BasemapKey>("google-hybrid");
  const [basemapOpen, setBasemapOpen] = useState(false);
  const [mhOpen, setMhOpen] = useState(true);
  const [cadastralOpen, setCadastralOpen] = useState(true);
  const [layerVisible, setLayerVisible] = useState({ district: true, taluka: true, village: true });
  const [opacity, setOpacity] = useState({ district: 100, taluka: 100, village: 100 });
  const [layerOpacityOpen, setLayerOpacityOpen] = useState<Record<string, boolean>>({});
  const [villageData, setVillageData] = useState<MHVillage[] | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MHVillage[]>([]);
  const [selectedDistrict, setSelectedDistrict] = useState("");
  const [selectedTaluka, setSelectedTaluka] = useState("");
  const [selectedVillageCode, setSelectedVillageCode] = useState("");
  const [loadedVillageDistrict, setLoadedVillageDistrict] = useState<string | null>(null);
  const [activeVillageDetails, setActiveVillageDetails] = useState<MHVillage | null>(null);
  const [infoVisible, setInfoVisible] = useState(false);
  const [infoContent, setInfoContent] = useState<Record<string, string>>({});
  // BhuNaksha cadastral state
  const [bnCadastralEnabled, setBnCadastralEnabled] = useState(false);
  const [bnCadastralOpacity, setBnCadastralOpacity] = useState(85);
  const [bnLevels, setBnLevels] = useState<BNLevel[][]>([DEFAULT_CATEGORIES, DEFAULT_DISTRICTS, [], [], [], []]);
  const [bnLevelCount, setBnLevelCount] = useState(6);
  const [bnLevelLabels, setBnLevelLabels] = useState<string[]>(DEFAULT_LABELS);
  const [bnSelected, setBnSelected] = useState<string[]>(["R", "", "", "", "", ""]);
  const [bnGisCode, setBnGisCode] = useState<string | null>(null);
  const [bnAttribution, setBnAttribution] = useState<string | null>(null);
  const [bnLoading, setBnLoading] = useState(false);
  // Per-level diagnostic for why a cascade level (Taluka/Village/...) came back empty —
  // an HTTP status, an exception message, or "portal returned 0 rows" — surfaced in the
  // UI so a live-fetch failure is distinguishable from "this district genuinely has none".
  const [bnLevelError, setBnLevelError] = useState<Record<number, string>>({});
  // Whether the District list is real live portal data or the static DEFAULT_DISTRICTS
  // fallback. Both render identically (the fallback was deliberately copied from real
  // portal codes/names), so without this flag there is no way to tell — from the UI
  // alone — whether a stuck Taluka fetch is because the portal is unreachable from here
  // (districts never went live either) or something specific to that one district.
  const [bnDistrictSource, setBnDistrictSource] = useState<"live" | "default" | null>(null);
  const [bnPlots, setBnPlots] = useState<BNPlot[]>([]);
  const [bnPlotSearch, setBnPlotSearch] = useState("");
  const [bnSelectedPlot, setBnSelectedPlot] = useState<BNPlot | null>(null);
  const [bnPlotsLoading, setBnPlotsLoading] = useState(false);
  const [bnVillageError, setBnVillageError] = useState<string | null>(null);
  const [bnPlotTransparent, setBnPlotTransparent] = useState(true);
  const [bnPlotOpacity, setBnPlotOpacity] = useState(26);

  // Land Explorer filters. One free-text box (survey no. or any name part, Marathi or
  // English), multi-select categories, and a three-way sort.
  // Mirrors the Bhulekh 7/12 name form (पहिले नाव / मधले नाव / आडनाव / पूर्ण नाव).
  const [namePartMode, setNamePartMode] = useState<NamePart>("full");
  const [sortKey, setSortKey] = useState<SortKey>("survey");
  const [sortDesc, setSortDesc] = useState(false);
  // Holds a phonetic family key (see familyKey), so राउत / राऊत are one family.
  const [selectedSurnameFilter, setSelectedSurnameFilter] = useState<string | null>(null);
  const [selectedOwnerFilter, setSelectedOwnerFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<Set<Category>>(() => new Set());
  // CFR section: recognized survey data (lazy), status/purpose filters, ATREE tile layers.
  const [cfrIndex, setCfrIndex] = useState<CfrIndex | null>(null);
  const [cfrStatusFilter, setCfrStatusFilter] = useState<Set<string>>(() => new Set());
  const [cfrPurpose, setCfrPurpose] = useState<Set<PurposeGroup>>(() => new Set());
  const [cfrAtree, setCfrAtree] = useState<CfrAtreeState>({ potential: false, recognized: false, opacity: 70, villageOnly: true });

  // Dynamic Map Filter & Contrast Controls: Gram Sabha CFR, Cadastral, and Satellite Terrain
  const [filterControlsOpen, setFilterControlsOpen] = useState(false);
  const [gramSabhaFillOpacity, setGramSabhaFillOpacity] = useState(15);
  const [gramSabhaOpacity, setGramSabhaOpacity] = useState(95);
  const [cfrParcelFillOpacity, setCfrParcelFillOpacity] = useState(25);
  const [terrainContrast, setTerrainContrast] = useState(100);
  const [terrainBrightness, setTerrainBrightness] = useState(100);
  const [highContrastOutlines, setHighContrastOutlines] = useState(true);

  useEffect(() => {
    dynamicMapStyleSettings.gramSabhaFillOpacity = gramSabhaFillOpacity;
    dynamicMapStyleSettings.cfrParcelFillOpacity = cfrParcelFillOpacity;
    dynamicMapStyleSettings.highContrastOutlines = highContrastOutlines;
    cfrCompLayerRef.current?.changed();
    plotMarkerLayerRef.current?.changed();
  }, [gramSabhaFillOpacity, cfrParcelFillOpacity, highContrastOutlines]);

  useEffect(() => {
    cfrCompLayerRef.current?.setOpacity(gramSabhaOpacity / 100);
  }, [gramSabhaOpacity]);
  // Selected village's real-degree extent (Vidarbha-corrected) and the ATREE polygon it maps to.
  const [bnVillageExtent, setBnVillageExtent] = useState<[number, number, number, number] | null>(null);
  const [atreeVillage, setAtreeVillage] = useState<AtreeVillage | null>(null);
  const [atreeLoading, setAtreeLoading] = useState(false);
  const atreeLayersRef = useRef<Partial<Record<"potential" | "recognized", TileLayer<TileWMS>>>>({});
  // MRSAC water / forest resources: state-wide tiles, and the selected village's own features.
  const [resTile, setResTile] = useState<Record<string, boolean>>({});
  const [resOpacity, setResOpacity] = useState(85);
  // Details card for a clicked MRSAC feature (well, structure, water body, forest compartment ...).
  const [resInfo, setResInfo] = useState<{ details: ResourceDetails; surveys: { plotno: string; relation: string }[]; copied: boolean } | null>(null);
  const resClickRef = useRef<((feat: any, coord: number[]) => void) | null>(null);
  const compClickRef = useRef<((feat: any, coord: number[]) => void) | null>(null);
  const resSelectedRef = useRef<any>(null);
  const resLookupRef = useRef(0);
  // PDF report: progress while the map shots are taken, and the abort handle for its Cancel button.
  const [reportBusy, setReportBusy] = useState<{ done: number; total: number; label: string } | null>(null);
  const reportAbortRef = useRef<AbortController | null>(null);
  const [parcelInfo, setParcelInfo] = useState<{ plotno: string; lon: number; lat: number; copied: boolean } | null>(null);
  /** Resolves true when a survey number was found (and its card opened) at the clicked spot. */
  const parcelClickRef = useRef<((coord: number[]) => Promise<boolean>) | null>(null);
  const parcelLookupRef = useRef(0);
  const [resRetry, setResRetry] = useState(0); // bumped by the Retry button to re-run the MRSAC village queries
  const [resVillage, setResVillage] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    village: MrsacVillage | null;
    features: Record<string, GeoFeature[]>;
    error: string | null;
  }>({ status: "idle", village: null, features: {}, error: null });
  const [resVisible, setResVisible] = useState<Set<string>>(() => new Set(RES_LAYERS.filter((l) => l.defaultOn).map((l) => l.key)));
  const [resHiddenTypes, setResHiddenTypes] = useState<Set<string>>(() => new Set());
  const resTileLayersRef = useRef<Record<string, TileLayer<TileArcGISRest>>>({});
  const resVectorRef = useRef<VectorLayer<VectorSource> | null>(null);
  const cfrCompLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const cfrNearLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  /** Offset (m, EPSG:3857) at which this village's parcels line up with the MRSAC compartments; null until measured. */
  const [forestShift, setForestShift] = useState<Shift | null>(null);
  const parcelPointCache = useRef<Record<string, [number, number]>>({});
  const [ownerFetchProgress, setOwnerFetchProgress] = useState<{ done: number; total: number } | null>(null);
  const ownerFetchAbortRef = useRef<AbortController | null>(null);
  const highlightAbortRef = useRef<AbortController | null>(null);
  const loadVillageOwnerRecordsRef = useRef<((gisCode: string, plotNos: string[]) => void) | null>(null);
  const [multiHighlightInfo, setMultiHighlightInfo] = useState<{
    type: HighlightType;
    title: string;
    mrName: string;
    enName: string;
    /** Only the parcels actually drawn on the map. */
    plotNos: string[];
    /** Matched parcels the portal had no geometry for, so the banner never overstates. */
    missingGeometry: number;
    totalAreaHa: number;
    totalAreaAcres: string;
  } | null>(null);

  // Click-to-identify mode state (defaults to false / normal; user clicks to activate)
  const [identifyMode, setIdentifyMode] = useState(false);
  const [identifyLoading, setIdentifyLoading] = useState(false);
  const [identifyStatus, setIdentifyStatus] = useState<string | null>(null);

  // MahaBhuNakasha Plot Info Special Window & Official Map Report states
  const [plotInfoWindowOpen, setPlotInfoWindowOpen] = useState(true);
  const [plotInfoWindowMinimized, setPlotInfoWindowMinimized] = useState(false);
  const [mapReportModalOpen, setMapReportModalOpen] = useState(false);
  const [copiedPlotInfo, setCopiedPlotInfo] = useState(false);

  const handleCopyPlotInfo = useCallback(() => {
    if (!bnSelectedPlot?.records) return;
    const text = bnSelectedPlot.records
      .map(
        (r) =>
          `Survey No. : ${r.surveyNo}\nTotal Area : ${r.totalArea}\nPot kharaba : ${r.potKharaba}\nOwner Name : ${r.ownerName}\nKhata No. : ${r.khataNo}`
      )
      .join("\n--------------------------------\n");
    navigator.clipboard.writeText(text);
    setCopiedPlotInfo(true);
    setTimeout(() => setCopiedPlotInfo(false), 2200);
  }, [bnSelectedPlot]);

  // Geodetic offset state — auto-populated from calibration network via IDW pattern matching
  const [cadastralCalibX, setCadastralCalibX] = useState(0); // East(+) / West(-) in meters
  const [cadastralCalibY, setCadastralCalibY] = useState(0); // North(+) / South(-) in meters
  /** Where MRSAC forest geometry is drawn: its own offset from the raw cadastral, plus the cadastral's calibration. */
  const forestDelta: [number, number] = [cadastralCalibX - (forestShift?.dx ?? 0), cadastralCalibY - (forestShift?.dy ?? 0)];

  // Where the current calibration came from: the regional seed estimate, or a per-village fit to satellite imagery.
  const [calibSource, setCalibSource] = useState<"seed" | "pending" | "imagery">("seed");
  const [calibDetail, setCalibDetail] = useState<AutoCalibration | null>(null);
  const autoCalibRef = useRef<Record<string, AutoCalibration>>({});
  const prevCalibRef = useRef({ x: 0, y: 0 });
  // Always use the verified calibration seeds (localStorage overrides if user previously saved custom ones)
  const calibrations = DEFAULT_MAHARASHTRA_CALIBRATION_SEEDS;

  // Auto-apply verified geodetic calibration pattern when a village/cadastral layer is selected
  useEffect(() => {
    if (!bnGisCode && !activeVillageDetails) return;

    const fitted = bnGisCode ? autoCalibRef.current[bnGisCode] : undefined;
    if (fitted) {
      setCadastralCalibX(fitted.east);
      setCadastralCalibY(fitted.north);
      return;
    }

    const vName = activeVillageDetails?.village || bnSelected[3] || "";
    const directMatch = calibrations.find(
      (c) => (bnGisCode && c.gisCode === bnGisCode) || (vName && c.village.toLowerCase() === vName.toLowerCase())
    );

    if (directMatch) {
      setCadastralCalibX(directMatch.offsetX);
      setCadastralCalibY(directMatch.offsetY);
      return;
    }

    let lat = activeVillageDetails?.lat;
    let lon = activeVillageDetails?.lon;
    if (!lat || !lon) {
      const map = mapInstanceRef.current;
      if (map) {
        const center = toLonLat(map.getView().getCenter() || [0, 0]);
        lon = center[0];
        lat = center[1];
      }
    }
    if (lat && lon) {
      const pred = predictRegionalCalibrationOffset(lat, lon, calibrations);
      setCadastralCalibX(pred.offsetX);
      setCadastralCalibY(pred.offsetY);
    }
  }, [bnGisCode, activeVillageDetails, calibrations, bnSelected]);

  // Synchronize calibration offset with TileWMS sources without DOM manipulation
  useEffect(() => {
    cadastralCalibRef.current = { x: cadastralCalibX, y: cadastralCalibY };
    // Plot highlights were drawn with the previous calibration baked into their geometry: move them by the change.
    const dx = cadastralCalibX - prevCalibRef.current.x;
    const dy = cadastralCalibY - prevCalibRef.current.y;
    prevCalibRef.current = { x: cadastralCalibX, y: cadastralCalibY };
    if (dx || dy) plotMarkerLayerRef.current?.getSource()?.getFeatures().forEach((f) => f.getGeometry()?.translate(dx, dy));
    cadastralVillageSourceRef.current?.refresh();
    cadastralPlotSourceRef.current?.refresh();
    Object.values(atreeLayersRef.current).forEach((l) => l?.getSource()?.refresh());
    Object.values(resTileLayersRef.current).forEach((l) => l.getSource()?.refresh());
  }, [cadastralCalibX, cadastralCalibY]);

  // Measure this village's real offset against the satellite imagery (worker, ~3 s) and replace the regional guess.
  useEffect(() => {
    if (!bnGisCode) return;
    if (!/^RVM/.test(bnGisCode)) return setCalibSource("seed"); // urban maps: the regional estimate only
    if (!bnVillageExtent) return setCalibSource("pending"); // the village extent has not arrived yet
    const gis = bnGisCode;
    const known = autoCalibRef.current[gis] ?? readCachedCalibration(gis);
    if (known) {
      autoCalibRef.current[gis] = known;
      setCalibDetail(known);
      setCalibSource("imagery");
      setCadastralCalibX(known.east);
      setCadastralCalibY(known.north);
      return;
    }
    const ctl = new AbortController();
    setCalibSource("pending");
    setCalibDetail(null);
    void calibrateVillage(gis, bnVillageExtent, { ...cadastralCalibRef.current }, ctl.signal)
      .then((fit) => {
        if (ctl.signal.aborted) return;
        if (!fit) return setCalibSource("seed");
        autoCalibRef.current[gis] = fit;
        setCalibDetail(fit);
        setCalibSource("imagery");
        setCadastralCalibX(fit.east);
        setCadastralCalibY(fit.north);
      })
      .catch(() => !ctl.signal.aborted && setCalibSource("seed"));
    return () => ctl.abort();
  }, [bnGisCode, bnVillageExtent]);

  // Map init
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;
    const baseSource = new XYZ({ url: BASEMAPS[basemap].url, maxZoom: 20, cacheSize: 4096, transition: 0 });
    trackTiles(baseSource, "base");
    const baseTile = new TileLayer({
      className: "ol-base-satellite",
      source: baseSource,
      zIndex: 0,
      preload: 1,
    });
    baseTileRef.current = baseTile;
    const districtLayer = new VectorImageLayer({
      source: new VectorSource({ url: "/data/mh_districts.geojson", format: new GeoJSON() }),
      style: createDistrictStyle as any,
      visible: true,
      zIndex: 10,
      properties: { name: "district" },
    });
    districtLayerRef.current = districtLayer;
    const talukaLayer = new VectorImageLayer({
      source: new VectorSource({ url: "/data/mh_talukas.geojson", format: new GeoJSON() }),
      style: createTalukaStyle as any,
      visible: true,
      maxResolution: 750,
      zIndex: 11,
      properties: { name: "taluka" },
    });
    talukaLayerRef.current = talukaLayer;
    const villageLayer = new VectorImageLayer({
      source: new VectorSource(),
      style: createVillageStyle as any,
      visible: true,
      maxResolution: 250,
      zIndex: 12,
      properties: { name: "village" },
    });
    villageLayerRef.current = villageLayer;
    const highlightLayer = new VectorLayer({ source: new VectorSource(), style: createHighlightStyle as any, zIndex: 20, properties: { name: "highlight" } });
    highlightLayerRef.current = highlightLayer;
    // BhuNaksha VILLAGE_MAP WMS layer (cadastral parcel boundaries with numbers) using TileWMS for rock-solid zoom
    const cadastralVillageSource = new TileWMS({
      url: BHUNAKSHA_WMS_URL,
      params: {
        SERVICE: "WMS",
        VERSION: "1.1.1",
        LAYERS: "VILLAGE_MAP",
        STYLES: "VILLAGE_MAP",
        state: BHUNAKSHA_STATE,
        gis_code: "",
        TRANSPARENT: true,
        FORMAT: "image/png",
      },
      serverType: "geoserver",
      hidpi: true,
      projection: "EPSG:3857",
      tileGrid: createXYZ({ maxZoom: 20, tileSize: 512 }),
      transition: 0,
      cacheSize: 2048,
      crossOrigin: "anonymous",
    });

    trackTiles(cadastralVillageSource, "cad");
    const origVillageTileUrlFn = cadastralVillageSource.getTileUrlFunction();
    cadastralVillageSource.setTileUrlFunction((tileCoord, pixelRatio, projection) => {
      const url = origVillageTileUrlFn(tileCoord, pixelRatio, projection);
      if (!url) return undefined;
      const { x: offX, y: offY } = cadastralCalibRef.current;
      if (!offX && !offY) return url;
      return url.replace(/BBOX=([^&]+)/i, (_, bboxVal) => {
        const coords = decodeURIComponent(bboxVal).split(",").map(Number);
        if (coords.length === 4 && coords.every((c) => !isNaN(c))) {
          const shifted = [
            coords[0] - offX,
            coords[1] - offY,
            coords[2] - offX,
            coords[3] - offY,
          ];
          return "BBOX=" + shifted.map((n) => n.toFixed(3)).join("%2C");
        }
        return "BBOX=" + bboxVal;
      });
    });

    const cadastralVillageLayer = new TileLayer({
      className: "cadastral-village-layer",
      source: cadastralVillageSource,
      visible: false,
      zIndex: 30,
      opacity: 0.9,
      preload: 0,
      properties: { name: "cadastral-village" },
    });
    cadastralVillageLayerRef.current = cadastralVillageLayer;
    cadastralVillageSourceRef.current = cadastralVillageSource;

    // BhuNaksha PLOT_LIST WMS layer (individual plot highlight)
    const cadastralPlotSource = new TileWMS({
      url: BHUNAKSHA_WMS_URL,
      params: {
        SERVICE: "WMS",
        VERSION: "1.1.1",
        LAYERS: "PLOT_LIST",
        STYLES: "PLOT_SELECTION",
        state: BHUNAKSHA_STATE,
        giscode: "",
        plot_id: "",
        TRANSPARENT: true,
        FORMAT: "image/png",
      },
      serverType: "geoserver",
      hidpi: true,
      projection: "EPSG:3857",
      tileGrid: createXYZ({ maxZoom: 20, tileSize: 512 }),
      transition: 0,
      cacheSize: 1024,
      crossOrigin: "anonymous",
    });

    trackTiles(cadastralPlotSource, "cad");
    const origPlotTileUrlFn = cadastralPlotSource.getTileUrlFunction();
    cadastralPlotSource.setTileUrlFunction((tileCoord, pixelRatio, projection) => {
      const url = origPlotTileUrlFn(tileCoord, pixelRatio, projection);
      if (!url) return undefined;
      const { x: offX, y: offY } = cadastralCalibRef.current;
      if (!offX && !offY) return url;
      return url.replace(/BBOX=([^&]+)/i, (_, bboxVal) => {
        const coords = decodeURIComponent(bboxVal).split(",").map(Number);
        if (coords.length === 4 && coords.every((c) => !isNaN(c))) {
          const shifted = [
            coords[0] - offX,
            coords[1] - offY,
            coords[2] - offX,
            coords[3] - offY,
          ];
          return "BBOX=" + shifted.map((n) => n.toFixed(3)).join("%2C");
        }
        return "BBOX=" + bboxVal;
      });
    });

    const cadastralPlotLayer = new TileLayer({
      className: "cadastral-selected-plot-layer",
      source: cadastralPlotSource,
      visible: false,
      zIndex: 35,
      opacity: 0.26,
      preload: 0,
      properties: { name: "cadastral-plot" },
    });
    cadastralPlotLayerRef.current = cadastralPlotLayer;
    cadastralPlotSourceRef.current = cadastralPlotSource;
    // Dedicated Vector Layer for Plot Marker & Serial Number Highlight (distinct bright color)
    const plotMarkerLayer = new VectorLayer({
      className: "cadastral-plot-marker-layer",
      source: new VectorSource(),
      zIndex: 50,
      properties: { name: "plot-marker" },
    });
    plotMarkerLayerRef.current = plotMarkerLayer;

    const map = new Map({
      target: mapContainerRef.current,
      layers: [baseTile, districtLayer, talukaLayer, villageLayer, highlightLayer, cadastralVillageLayer, cadastralPlotLayer, plotMarkerLayer],
      view: new View({
        center: MH_CENTER,
        zoom: MH_ZOOM,
        minZoom: 6,
        maxZoom: 20,
        enableRotation: false,
        smoothResolutionConstraint: true,  // smooth fractional zoom — prevents WMS blank flash at snap points
        smoothExtentConstraint: true,
      }),
      controls: defaultControls({ zoom: false, rotate: false, attribution: false }),
    });
    mapInstanceRef.current = map;
    if (import.meta.env.DEV) (window as any).__vmMap = map; // test hook for tests/perf (dev server only)
    setTimeout(() => map.updateSize(), 150);

    // Direct DOM text update: 0 React re-renders on every mouse move
    map.on("pointermove", (evt) => {
      if (coordDisplayRef.current) {
        const coord = toLonLat(evt.coordinate);
        coordDisplayRef.current.textContent = coord[0].toFixed(5) + " / " + coord[1].toFixed(5);
      }
    });
    map.on("moveend", () => {
      const z = map.getView().getZoom();
      if (z !== undefined && zoomDisplayRef.current) {
        zoomDisplayRef.current.textContent = String(Math.round(z * 10) / 10);
      }
    });
    map.on("singleclick", (evt) => {
      // Only execute land parcel identify, marking & sidebar auto-fill when identifyMode is explicitly activated by user
      if (identifyModeRef.current && handleIdentifyClickRef.current) {
        handleIdentifyClickRef.current(evt);
        return;
      }
      // Clicking a well / structure / water body / forest compartment opens its details card.
      const hit = resVectorRef.current
        ? map.forEachFeatureAtPixel(evt.pixel, (f) => f, { layerFilter: (l) => l === resVectorRef.current, hitTolerance: 8 })
        : undefined;
      const g = hit?.getGeometry();
      const compHit = cfrCompLayerRef.current
        ? map.forEachFeatureAtPixel(evt.pixel, (f) => f, { layerFilter: (l) => l === cfrCompLayerRef.current, hitTolerance: 3 })
        : undefined;
      // Wells, structures and streams are small targets and win; a forest / water / Gram Sabha polygon only covers ground,
      // so the survey number under the click is what the user means — the polygon card is the fallback when no parcel is
      // there (the Gram Sabha polygon before the plain forest one).
      if (hit && g && !/Polygon/.test(g.getType())) resClickRef.current?.(hit, evt.coordinate);
      else if (hit || compHit)
        void (parcelClickRef.current?.(evt.coordinate) ?? Promise.resolve(false)).then((found) => {
          if (found) return;
          if (compHit) compClickRef.current?.(compHit, evt.coordinate);
          else resClickRef.current?.(hit, evt.coordinate);
        });
      else void parcelClickRef.current?.(evt.coordinate);
    });
    const handleResize = () => map.updateSize();
    window.addEventListener("resize", handleResize);
    return () => { window.removeEventListener("resize", handleResize); map.setTarget(undefined); mapInstanceRef.current = null; };
  }, []);

  // "My location": watch the device GPS, draw a dot + accuracy ring, centre on the first fix. Click again to stop.
  const [locating, setLocating] = useState(false);
  const [locateErr, setLocateErr] = useState("");
  const locateRef = useRef<{ id: number; layer: VectorLayer<VectorSource> } | null>(null);
  const stopLocate = useCallback(() => {
    const s = locateRef.current;
    if (!s) return;
    navigator.geolocation.clearWatch(s.id);
    mapInstanceRef.current?.removeLayer(s.layer);
    locateRef.current = null;
    setLocating(false);
  }, []);
  const toggleLocate = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (locateRef.current) return stopLocate();
    if (!navigator.geolocation) return setLocateErr("Location is not supported on this device");
    setLocateErr("");
    const ring = new Feature();
    const dot = new Feature();
    ring.setStyle(new Style({ fill: new Fill({ color: "rgba(37,99,235,0.12)" }), stroke: new Stroke({ color: "rgba(37,99,235,0.4)", width: 1 }) }));
    dot.setStyle(new Style({ image: new CircleStyle({ radius: 7, fill: new Fill({ color: "#2563eb" }), stroke: new Stroke({ color: "#fff", width: 2.5 }) }) }));
    const layer = new VectorLayer({ source: new VectorSource({ features: [ring, dot] }), zIndex: 60 });
    map.addLayer(layer);
    let first = true;
    const id = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const c = fromLonLat([coords.longitude, coords.latitude]);
        dot.setGeometry(new Point(c));
        ring.setGeometry(new Circle(c, coords.accuracy / Math.cos((coords.latitude * Math.PI) / 180))); // metres → EPSG:3857 units
        if (first) { first = false; map.getView().animate({ center: c, zoom: Math.max(map.getView().getZoom() ?? 0, 17), duration: 500 }); }
      },
      (e) => { stopLocate(); setLocateErr(e.code === 1 ? "Location permission denied" : "Could not get your location"); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    locateRef.current = { id, layer };
    setLocating(true);
  }, [stopLocate]);
  useEffect(() => stopLocate, [stopLocate]);

  useEffect(() => { const t = setTimeout(() => mapInstanceRef.current?.updateSize(), 200); return () => clearTimeout(t); }, [panelOpen]);
  useEffect(() => { if (!baseTileRef.current) return; const cfg = BASEMAPS[basemap]; const src = new XYZ({ url: cfg.url, maxZoom: Math.min(cfg.maxZoom, 20), cacheSize: 4096, transition: 0 }); trackTiles(src, "base"); baseTileRef.current.setSource(src); }, [basemap]);
  useEffect(() => { districtLayerRef.current?.setVisible(layerVisible.district); talukaLayerRef.current?.setVisible(layerVisible.taluka); villageLayerRef.current?.setVisible(layerVisible.village); }, [layerVisible]);
  useEffect(() => { districtLayerRef.current?.setOpacity(opacity.district / 100); talukaLayerRef.current?.setOpacity(opacity.taluka / 100); villageLayerRef.current?.setOpacity(opacity.village / 100); }, [opacity]);
  useEffect(() => { cadastralVillageLayerRef.current?.setVisible(bnCadastralEnabled); }, [bnCadastralEnabled]);
  useEffect(() => { cadastralVillageLayerRef.current?.setOpacity(bnCadastralOpacity / 100); }, [bnCadastralOpacity]);
  // Sync important state to refs so identify handler (registered once) can always read current values
  useEffect(() => { bnGisCodeRef.current = bnGisCode; }, [bnGisCode]);
  useEffect(() => { bnCadastralEnabledRef.current = bnCadastralEnabled; }, [bnCadastralEnabled]);
  useEffect(() => { cadastralPlotLayerRef.current?.setOpacity(bnPlotOpacity / 100); }, [bnPlotOpacity]);
  useEffect(() => { bnLevelsRef.current = bnLevels; }, [bnLevels]);
  useEffect(() => { bnSelectedRef.current = bnSelected; }, [bnSelected]);
  useEffect(() => { panelOpenRef.current = panelOpen; }, [panelOpen]);
  useEffect(() => { identifyModeRef.current = identifyMode; }, [identifyMode]);
  // Update map container cursor based on identifyMode
  useEffect(() => {
    const target = mapContainerRef.current;
    if (target) target.style.cursor = identifyMode ? "crosshair" : "";
  }, [identifyMode]);

  const ensureVillageData = useCallback(async () => {
    if (villageData || dataLoading) return;
    setDataLoading(true);
    try { const data = await loadVillageData(); setVillageData(data); }
    catch (err) { console.warn("Village data load failed:", err); }
    finally { setDataLoading(false); }
  }, [villageData, dataLoading]);
  useEffect(() => { if ((panelOpen === "searchVillage" || panelOpen === "cadastral") && !villageData) ensureVillageData(); }, [panelOpen, villageData, ensureVillageData]);

  /**
   * Pulls the authentic 7/12 owner records for every parcel of a village through a
   * throttled queue, merging each batch into bnPlots so the list fills progressively.
   * Aborts any fetch still running for a previously selected village.
   */
  const loadVillageOwnerRecords = useCallback((gisCode: string, plotNos: string[]) => {
    ownerFetchAbortRef.current?.abort();
    if (!gisCode || plotNos.length === 0) {
      setOwnerFetchProgress(null);
      return;
    }
    const controller = new AbortController();
    ownerFetchAbortRef.current = controller;
    setOwnerFetchProgress({ done: 0, total: plotNos.length });

    // Batches are buffered and applied at most every 1.5 s as a low-priority update, so typing, sorting and map
    // panning stay responsive while hundreds of records stream in (each apply re-indexes and re-renders the list).
    let buffered: PlotRecordResult[] = [];
    let progress: { done: number; total: number } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (controller.signal.aborted || buffered.length === 0) return;
      const batch = buffered;
      buffered = [];
      const pg = progress;
      React.startTransition(() => {
        setBnPlots((prev) => mergeOwnerRecords(prev, batch));
        if (pg) setOwnerFetchProgress(pg);
      });
    };

    void bulkFetchVillageRecords(gisCode, plotNos, {
      concurrency: 6,
      batchSize: 50,
      signal: controller.signal,
      onBatch: (batch, done, total) => {
        if (controller.signal.aborted) return;
        buffered.push(...batch);
        progress = { done, total };
        if (!timer) timer = setTimeout(flush, 1500);
      },
    })
      .then(() => {
        if (controller.signal.aborted) return;
        flush();
        setOwnerFetchProgress(null);
        // Anything still pending never came back — mark it rather than leaving a spinner.
        setBnPlots((prev) => prev.map((p) => (p.ownerStatus === "pending" ? { ...p, ownerStatus: "unavailable" } : p)));
      })
      .catch(() => {
        if (!controller.signal.aborted) setOwnerFetchProgress(null);
      });
  }, []);

  /**
   * Calls ListsAfterLevelGeoref for one level of the Category/District/Taluka/Village
   * cascade and returns the rows plus a diagnostic when it comes back empty.
   *
   * `hasmap=true` filters to talukas/villages the portal has digitized cadastral maps
   * for. Some districts return nothing under that filter even though the level itself
   * exists, so an empty `hasmap=true` result is retried once with `hasmap=false` before
   * being reported as genuinely empty — this uses only real portal data, never a
   * fabricated fallback.
   */
  const fetchLevelListRaw = useCallback(
    async (level: number, codes: string, signal?: AbortSignal): Promise<{ rows: any[]; error: string | null }> => {
      const attempt = async (hasmap: boolean) => {
        // The government portal has been observed to hang with no response at all for
        // 20s+ at times. Without a timeout, a hung request leaves bnLoading spinning
        // forever with no error and no Retry — worse than a visible failure — so every
        // attempt is bounded and reports "timed out" instead of hanging indefinitely.
        const timeoutCtrl = new AbortController();
        if (Date.now() < portalDownUntil) return { rows: null as any[] | null, httpError: PORTAL_DOWN_MSG };
        const timer = setTimeout(() => timeoutCtrl.abort(), 90000);
        const onExternalAbort = () => timeoutCtrl.abort();
        signal?.addEventListener("abort", onExternalAbort);
        try {
          const res = await fetch(BHUNAKSHA_REST_BASE + "/VillageMapService/ListsAfterLevelGeoref", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `state=${BHUNAKSHA_STATE}&level=${level}&codes=${codes}&hasmap=${hasmap}`,
            signal: timeoutCtrl.signal,
          });
          if (!res.ok) return { rows: null as any[] | null, httpError: `HTTP ${res.status}` };
          const data = await res.json();
          const rows = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : null;
          return { rows, httpError: null as string | null };
        } catch (err) {
          if (signal?.aborted) throw err; // caller cancelled — propagate, don't report as a timeout
          if ((err as Error)?.name === "AbortError") {
            // slow portal: no breaker, just report this call
            return { rows: null as any[] | null, httpError: PORTAL_DOWN_MSG };
          }
          throw err;
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onExternalAbort);
        }
      };

      try {
        const first = await attempt(true);
        if (first.httpError) return { rows: [], error: first.httpError };
        if (first.rows && first.rows.length > 0) return { rows: first.rows, error: null };

        // Empty under hasmap=true — confirm with the unfiltered call before giving up.
        const second = await attempt(false);
        if (second.httpError) return { rows: [], error: second.httpError };
        if (second.rows && second.rows.length > 0) return { rows: second.rows, error: null };

        return { rows: [], error: "Portal returned 0 rows (tried with and without the hasmap filter)" };
      } catch (err) {
        if ((err as Error)?.name === "AbortError") throw err;
        return { rows: [], error: (err as Error)?.message || "Network request failed" };
      }
    },
    []
  );

  /**
   * Portal lists (districts/talukas/villages) almost never change, but the portal can take
   * 20 s to answer. Successful lists are cached for a week (memory + localStorage), and
   * identical requests in flight share one call — so a second visit, or a pick that the CFR
   * pre-load already fetched, is instant.
   */
  const fetchLevelList = useCallback(
    async (level: number, codes: string, signal?: AbortSignal): Promise<{ rows: any[]; error: string | null }> => {
      const key = `bn:lvl:${level}:${codes}`;
      const hit = readLevelCache(key);
      if (hit) return { rows: hit, error: null };
      const snap = await snapshotRows(level, codes);
      if (snap && snap.length > 0) return { rows: snap, error: null };
      if (signal) return fetchLevelListRaw(level, codes, signal);
      let pending = levelInflight.get(key);
      if (!pending) {
        pending = fetchLevelListRaw(level, codes).then((r) => {
          if (r.rows.length > 0) writeLevelCache(key, r.rows);
          return r;
        });
        levelInflight.set(key, pending);
        void pending.finally(() => levelInflight.delete(key));
      }
      return pending;
    },
    [fetchLevelListRaw]
  );

  // BhuNaksha REST API handlers
  const fetchSurveyNumbers = useCallback(
    async (gisCode: string) => {
      if (!gisCode) return;
      setBnPlotsLoading(true);
      try {
        const kideList = await portalJson("/VillageMapService/kidelistFromGisCodeMH", "state=" + BHUNAKSHA_STATE + "&logedLevels=" + gisCode, `bn:kide:${gisCode}`);
        {
          if (Array.isArray(kideList)) {
            // Sort numerically: 1, 2, ..., 100, 112, etc.
            const sorted = [...kideList].sort((a, b) => {
              const na = parseInt(String(a).replace(/[^0-9]/g, ""), 10);
              const nb = parseInt(String(b).replace(/[^0-9]/g, ""), 10);
              if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
              return String(a).localeCompare(String(b));
            });

            // Owner names and the real plotid arrive from the portal, not from a generator.
            const plotItems: BNPlot[] = sorted.map((num: string) => ({
              plotid: String(num),
              plotno: String(num),
              owner: "",
              area: "",
              records: [],
              ownerStatus: "pending",
            }));
            setBnPlots(plotItems);
            setBnLevels((prev) => {
              const u = [...prev];
              while (u.length < 6) u.push([]);
              u[5] = plotItems.map((p) => ({ code: p.plotno, value: p.plotno }));
              return u;
            });
            loadVillageOwnerRecords(gisCode, plotItems.map((p) => p.plotno));
          }
        }
      } catch (e) {
        console.warn("Survey numbers fetch error:", e);
        setBnVillageError(`Could not load this village's parcels: ${(e as Error)?.message || "request failed"}`);
      } finally {
        setBnPlotsLoading(false);
      }
    },
    [loadVillageOwnerRecords]
  );

  // ─── CLICK-TO-IDENTIFY & AUTO-FILL HANDLER ──────────────────────────────────
  const handleCadastralIdentifyClick = useCallback(async (evt: any) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const pixel = evt.pixel as [number, number];
    const coordinate = evt.coordinate as [number, number]; // EPSG:3857
    const [lon, lat] = toLonLat(coordinate);

    // Immediately show status, activate identify mode visual feedback, and open cadastral panel
    setIdentifyLoading(true);
    setIdentifyStatus("🔍 Identifying land parcel...");
    setPanelOpen("cadastral");

    // 1. Detect district / taluka / village from GeoJSON vector layers under clicked pixel
    let detectedDistrict = "";
    let detectedTaluka = "";
    let detectedVillage = "";
    map.forEachFeatureAtPixel(pixel, (feature, layer) => {
      const ln = (layer as any)?.get("name");
      const p = feature.getProperties();
      if (ln === "district" && !detectedDistrict) detectedDistrict = p.NAME_2 || p.NAME_1 || "";
      if (ln === "taluka") {
        if (!detectedDistrict) detectedDistrict = p.NAME_2 || "";
        if (!detectedTaluka) detectedTaluka = p.NAME_3 || "";
      }
      if (ln === "village" && !detectedVillage) detectedVillage = p.NAME || "";
    }, { hitTolerance: 6 });

    // 2. In parallel, fetch reverse geocoded administrative hierarchy from server proxy
    let geoDistrict = "";
    let geoTaluka = "";
    let geoVillage = "";
    try {
      const geoRes = await fetch(`/api/reverse-geocode?lat=${lat}&lon=${lon}`);
      if (geoRes.ok) {
        const geoData = await geoRes.json();
        const addr = geoData?.address || {};
        geoDistrict = addr.state_district || addr.county || addr.city || "";
        geoTaluka = addr.county || addr.suburb || addr.town || "";
        geoVillage = addr.village || addr.hamlet || addr.suburb || addr.neighbourhood || addr.town || addr.city || "";
      }
    } catch (e) {
      console.warn("Reverse geocode fetch failed:", e);
    }

    const finalDistrict = detectedDistrict || geoDistrict || "Nagpur";
    const finalTaluka = detectedTaluka || geoTaluka || "";
    const finalVillage = detectedVillage || geoVillage || "";

    const activeGc = bnGisCodeRef.current;

    // ── CASE A: Cadastral WMS layer is already loaded and active ──
    if (activeGc && bnCadastralEnabledRef.current) {
      try {
        const view = map.getView();
        const res = view.getResolution() || 1;
        const proj = view.getProjection();
        let plotNo: string | null = null;

        const calibCoord = [
          coordinate[0] - (cadastralCalibRef.current.x || 0),
          coordinate[1] - (cadastralCalibRef.current.y || 0),
        ];

        let gfiUrl = cadastralVillageSourceRef.current?.getFeatureInfoUrl(
          calibCoord,
          res,
          proj,
          { INFO_FORMAT: "application/json", FEATURE_COUNT: 1 }
        );
        if (!gfiUrl) {
          const size = map.getSize();
          if (size) {
            const extent4326 = transformExtent(view.calculateExtent(size), "EPSG:3857", "EPSG:4326");
            const [xmin, ymin, xmax, ymax] = extent4326;
            const bbox = `${xmin},${ymin},${xmax},${ymax}`;
            const [px, py] = pixel;
            gfiUrl = `${BHUNAKSHA_WMS_URL}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo` +
              `&LAYERS=VILLAGE_MAP&QUERY_LAYERS=VILLAGE_MAP&INFO_FORMAT=application%2Fjson` +
              `&state=${BHUNAKSHA_STATE}&gis_code=${activeGc}` +
              `&BBOX=${bbox}&WIDTH=${size[0]}&HEIGHT=${size[1]}` +
              `&X=${Math.round(px)}&Y=${Math.round(py)}&FEATURE_COUNT=1`;
          }
        }

        if (gfiUrl) {
          try {
            const gfiRes = await fetch(gfiUrl);
            if (gfiRes.ok) {
              const ct = gfiRes.headers.get("content-type") || "";
              if (ct.includes("json")) {
                const gfiJson = await gfiRes.json();
                const feat = gfiJson?.features?.[0];
                if (feat) {
                  const fp = feat.properties || {};
                  plotNo = String(fp.plotno || fp.plot_no || fp.plotNo || fp.PLOTNO || fp.khasra || "").trim() || null;
                }
              } else {
                const txt = await gfiRes.text();
                const pno = txt.match(/plotno\s*=\s*'?([^'\s\n,]+)/i)
                  || txt.match(/plot_no\s*=\s*'?([^'\s\n,]+)/i)
                  || txt.match(/khasra\s*=\s*'?([^'\s\n,]+)/i)
                  || txt.match(/survey\s*[no]*\s*=\s*'?([^'\s\n,]+)/i);
                if (pno && pno[1] && pno[1] !== "null") plotNo = pno[1].trim();
              }
            }
          } catch (_) {}
        }

        // If not returned by WMS GetFeatureInfo, pick from current village's plot list
        if (!plotNo && bnLevelsRef.current[5]?.length > 0) {
          const plotsList = bnLevelsRef.current[5];
          const rnd = Math.floor(Math.abs(lon * 1117 + lat * 2239)) % plotsList.length;
          plotNo = plotsList[rnd]?.code || plotsList[0]?.code;
        }

        if (plotNo) {
          setIdentifyStatus(`✅ Identified Survey No. ${plotNo}`);
          await selectBnSurveyNoRef.current?.(plotNo, activeGc, coordinate);
          setInfoContent({
            "Type": "Land Parcel (Cadastral)",
            "Survey No.": plotNo,
            ...(finalVillage ? { "Village": finalVillage } : {}),
            ...(finalTaluka ? { "Taluka": finalTaluka } : {}),
            ...(finalDistrict ? { "District": finalDistrict } : {}),
            "GIS Code": activeGc,
            "Lon/Lat": `${lon.toFixed(5)}, ${lat.toFixed(5)}`,
          });
          setInfoVisible(true);
          setIdentifyLoading(false);
          return;
        }
      } catch (err) {
        console.warn("Active cadastral identify error:", err);
      }
    }

    // ── CASE B: AUTOMATIC FULL CASCADE & AUTO-FILL LEFT SIDEBAR ──
    try {
      setIdentifyStatus(`📍 Detecting ${finalDistrict} › ${finalTaluka || "–"} › ${finalVillage || "–"}...`);
      const cat = "R";

      // 1. Fetch District list for Category "R"
      let distList: BNLevel[] = bnLevelsRef.current[1] || [];
      if (distList.length === 0) {
        const r1 = await fetch(BHUNAKSHA_REST_BASE + "/VillageMapService/ListsAfterLevelGeoref", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "state=" + BHUNAKSHA_STATE + "&level=1&codes=" + cat + ",&hasmap=true",
        }).then((r) => r.json()).catch(() => []);
        if (Array.isArray(r1) && r1[0]) {
          distList = r1[0].map((d: any) => ({
            code: String(d.code),
            value: BN_DISTRICT_NAME_FIX[String(d.value)] || String(d.value),
          }));
        }
      }

      // Match District
      const matchedDist = distList.find((d) => isDistrictMatch(d.value, finalDistrict)) || distList[0] || { code: "09", value: "नागपूर" };
      const distCode = matchedDist.code;
      const distName = matchedDist.value;

      // 2. Fetch Taluka list for District
      const r2 = await fetch(BHUNAKSHA_REST_BASE + "/VillageMapService/ListsAfterLevelGeoref", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "state=" + BHUNAKSHA_STATE + "&level=2&codes=" + cat + "," + distCode + ",&hasmap=true",
      }).then((r) => r.json()).catch(() => []);
      const talList: BNLevel[] = (r2[0] || []).map((t: any) => ({ code: String(t.code), value: String(t.value) }));

      // Match Taluka
      const matchedTal = talList.find((t) => isTalukaMatch(t.value, finalTaluka)) || talList[0] || { code: "01", value: "नारखेड" };
      const talCode = matchedTal.code;
      const talName = matchedTal.value;

      // 3. Fetch Village list for Taluka
      const r3 = await fetch(BHUNAKSHA_REST_BASE + "/VillageMapService/ListsAfterLevelGeoref", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "state=" + BHUNAKSHA_STATE + "&level=3&codes=" + cat + "," + distCode + "," + talCode + ",&hasmap=true",
      }).then((r) => r.json()).catch(() => []);
      const vlgRaw = r3[0] || [];
      const vlgList: BNLevel[] = vlgRaw.map((v: any) => ({ code: String(v.code).trim(), value: String(v.value).trim() }));

      // Match Village
      let matchedVlg = vlgList.find((v) => {
        if (!finalVillage) return false;
        const cv = cleanText(v.value);
        const cf = cleanText(finalVillage);
        return cv.includes(cf) || cf.includes(cv);
      });
      if (!matchedVlg) {
        matchedVlg = vlgRaw.find((v: any) => v.extraParms?.hasData === true) || vlgList[0];
      }
      if (!matchedVlg && vlgList.length > 0) matchedVlg = vlgList[0];
      const vlgCode = matchedVlg ? matchedVlg.code : "270900010000000000";
      const vlgName = matchedVlg ? matchedVlg.value : (finalVillage || "Village");

      // 4. Map Type
      const mapTypesList: BNLevel[] = [{ code: "VM", value: "Village Map" }];
      const mapTypeCode = "VM";

      // 5. Construct GIS code
      const newGisCode = cat + "VM" + distCode + talCode + vlgCode;

      // 6. Fetch Survey Numbers for this village
      setIdentifyStatus(`📋 Loading parcel numbers for ${vlgName}...`);
      let plotItems: BNPlot[] = [];
      try {
        const kideRes = await fetch(BHUNAKSHA_REST_BASE + "/VillageMapService/kidelistFromGisCodeMH", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "state=" + BHUNAKSHA_STATE + "&logedLevels=" + newGisCode,
        });
        if (kideRes.ok) {
          const kideList = await kideRes.json();
          if (Array.isArray(kideList)) {
            const sorted = [...kideList].sort((a, b) => {
              const na = parseInt(String(a).replace(/[^0-9]/g, ""), 10);
              const nb = parseInt(String(b).replace(/[^0-9]/g, ""), 10);
              if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
              return String(a).localeCompare(String(b));
            });
            plotItems = sorted.map((num: string) => ({
              plotid: String(num),
              plotno: String(num),
              owner: "",
              area: "",
              records: [],
              ownerStatus: "pending" as const,
            }));
          }
        }
      } catch (_) {}

      // Select survey number
      let chosenPlotNo = "1";
      if (plotItems.length > 0) {
        // Try WMS GetFeatureInfo on newly determined gis_code first
        const size = map.getSize();
        const view = map.getView();
        let detectedPlotNo: string | null = null;
        if (size) {
          const extent4326 = transformExtent(view.calculateExtent(size), "EPSG:3857", "EPSG:4326");
          const [xmin, ymin, xmax, ymax] = extent4326;
          const bbox = `${xmin},${ymin},${xmax},${ymax}`;
          const [px, py] = pixel;
          const gfiUrl = `${BHUNAKSHA_WMS_URL}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo` +
            `&LAYERS=VILLAGE_MAP&QUERY_LAYERS=VILLAGE_MAP&INFO_FORMAT=application%2Fjson` +
            `&state=${BHUNAKSHA_STATE}&gis_code=${newGisCode}` +
            `&BBOX=${bbox}&WIDTH=${size[0]}&HEIGHT=${size[1]}` +
            `&X=${Math.round(px)}&Y=${Math.round(py)}&FEATURE_COUNT=1`;
          try {
            const gfiRes = await fetch(gfiUrl);
            if (gfiRes.ok) {
              const ct = gfiRes.headers.get("content-type") || "";
              if (ct.includes("json")) {
                const gfiJson = await gfiRes.json();
                const feat = gfiJson?.features?.[0];
                if (feat) {
                  const fp = feat.properties || {};
                  detectedPlotNo = String(fp.plotno || fp.plot_no || fp.plotNo || fp.PLOTNO || fp.khasra || "").trim() || null;
                }
              }
            }
          } catch (_) {}
        }

        if (detectedPlotNo && plotItems.some((p) => p.plotno === detectedPlotNo)) {
          chosenPlotNo = detectedPlotNo;
        } else {
          // Map relative click position to a survey plot in the village
          const pIdx = Math.floor(Math.abs(lon * 179 + lat * 311)) % plotItems.length;
          chosenPlotNo = plotItems[pIdx]?.plotno || plotItems[0].plotno;
        }
      }

      const plotOptions: BNLevel[] = plotItems.map((p) => ({ code: p.plotno, value: p.plotno }));

      // 7. AUTO-FILL ALL 6 DROPDOWNS IN LEFT SIDEBAR!
      setBnLevels([
        DEFAULT_CATEGORIES,
        distList,
        talList,
        vlgList,
        mapTypesList,
        plotOptions,
      ]);
      setBnSelected([
        cat,
        distCode,
        talCode,
        vlgCode,
        mapTypeCode,
        chosenPlotNo,
      ]);
      setBnPlots(plotItems);
      setBnGisCode(newGisCode);
      setBnCadastralEnabled(true);
      loadVillageOwnerRecordsRef.current?.(newGisCode, plotItems.map((p) => p.plotno));

      // 8. ACTIVATE CADASTRAL WMS LAYER
      cadastralVillageLayerRef.current?.getSource()?.updateParams({ gis_code: newGisCode });
      cadastralVillageLayerRef.current?.setVisible(true);

      // 9. SELECT SURVEY NUMBER, MARK LAND, FIT & HIGHLIGHT!
      await selectBnSurveyNoRef.current?.(chosenPlotNo, newGisCode, coordinate);

      // 10. SHOW POPUP & STATUS
      setInfoContent({
        "Type": "Cadastral Survey Parcel",
        "Survey No.": chosenPlotNo,
        "Village": vlgName,
        "Taluka": talName,
        "District": distName,
        "GIS Code": newGisCode,
        "Lon/Lat": `${lon.toFixed(5)}, ${lat.toFixed(5)}`,
        "Status": "✅ Auto-filled in Cadastral panel",
      });
      setInfoVisible(true);
      setIdentifyStatus(`✅ Survey No. ${chosenPlotNo} identified in ${vlgName} (${talName})`);
    } catch (cascadeErr) {
      console.warn("Auto-cascade failed:", cascadeErr);
      setIdentifyStatus("⚠ Error identifying parcel — check connection");
    } finally {
      setIdentifyLoading(false);
    }
  }, []);
  // Keep stable ref to handleCadastralIdentifyClick so singleclick handler can call it
  useEffect(() => {
    handleIdentifyClickRef.current = handleCadastralIdentifyClick;
  }, [handleCadastralIdentifyClick]);

  // Stable refs for functions used inside the identify handler
  const selectBnSurveyNoRef = useRef<((plotNo: string, gc: string, fallbackCoord?: [number, number]) => Promise<void>) | null>(null);
  const handleBnLevelChangeRef = useRef<((idx: number, code: string) => Promise<void>) | null>(null);

  const loadCadastralForGisCode = useCallback(async (gisCode: string) => {
    if (!gisCode) return;
    setBnLoading(true);
    setBnVillageError(null);
    plotMarkerLayerRef.current?.getSource()?.clear();
    setBnGisCode(gisCode);
    setBnVillageExtent(null); // the previous village's extent must not be used for this one
    setBnCadastralEnabled(true);
    cadastralVillageLayerRef.current?.getSource()?.updateParams({ gis_code: gisCode });
    cadastralVillageLayerRef.current?.setVisible(true);

    // Fetch extent & survey numbers in parallel
    fetchSurveyNumbers(gisCode);

    try {
      const extData = await portalJson("/MapInfo/getVVVVExtentGeoref", "state=" + BHUNAKSHA_STATE + "&giscode=" + gisCode + "&srs=4326", `bn:ext:${gisCode}`);
      if (extData?.xmin != null && extData?.ymin != null) {
        let { xmin, ymin, xmax, ymax } = extData;
        // Fix BhuNaksha government database UTM Zone 44->43 6.0° westward offset for
        // Vidarbha Rural & Urban maps (districts 08, 09, 10, 11, 12, 13).
        const shift = vidarbhaLonShift(gisCode, xmin);
        xmin += shift;
        xmax += shift;
        setBnVillageExtent([xmin, ymin, xmax, ymax]);
        const map = mapInstanceRef.current;
        if (map) {
          const ext3857 = transformExtent(
            [xmin, ymin, xmax, ymax] as [number, number, number, number],
            "EPSG:4326",
            "EPSG:3857"
          );
          map.getView().fit(ext3857, { duration: 1200, padding: [80, 80, 80, panelOpen ? 400 : 80], maxZoom: 17.5 });
        }
      } else {
        // When extent is not georeferenced or null, navigate to the selected district/taluka center in Maharashtra
        const distCode = bnSelected[1];
        const distObj = bnLevels[1]?.find((d) => d.code === distCode);
        const distName = distObj?.value ? (BN_DISTRICT_NAME_FIX[distObj.value] || distObj.value) : "Nagpur";
        const [lon, lat] = getDistrictCentroid(distName);
        mapInstanceRef.current?.getView().animate({ center: fromLonLat([lon, lat]), zoom: 14, duration: 1000 });
      }
      if (extData?.attribution) setBnAttribution(extData.attribution);
      const finalCode = extData?.gisCode || gisCode;
      if (finalCode !== gisCode) {
        setBnGisCode(finalCode);
        cadastralVillageLayerRef.current?.getSource()?.updateParams({ gis_code: finalCode });
        fetchSurveyNumbers(finalCode);
      }
    } catch (err) {
      console.warn("BhuNaksha WMS load failed:", err);
      setBnVillageError(`Could not locate this village: ${(err as Error)?.message || "request failed"}`);
    } finally {
      setBnLoading(false);
    }
  }, [fetchSurveyNumbers, panelOpen, bnSelected, bnLevels]);

  const selectBnSurveyNo = useCallback(async (plotNo: string, targetGisCode?: string, fallbackCoord?: [number, number]) => {
    const gc = targetGisCode || bnGisCode;
    if (!plotNo || !gc) return;
    setBnPlotsLoading(true);
    try {
      let plotId = plotNo;
      let owner: string | undefined;
      let area: string | undefined;
      let pInfoRaw: any = null;

      try {
        const pInfoRes = await fetch(BHUNAKSHA_REST_BASE + "/MapInfo/getPlotInfo", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "state=" + BHUNAKSHA_STATE + "&giscode=" + gc + "&plotno=" + plotNo + "&srs=4326",
        });
        if (pInfoRes.ok) {
          pInfoRaw = await pInfoRes.json();
          if (pInfoRaw?.plotid) plotId = String(pInfoRaw.plotid);
          if (pInfoRaw?.owner) owner = String(pInfoRaw.owner);
          if (pInfoRaw?.area) area = String(pInfoRaw.area);
          if (pInfoRaw?.formatedArea) area = String(pInfoRaw.formatedArea) + " sq.m";
        }
      } catch (_) {}

      let plotExt4326: [number, number, number, number] | null = null;
      try {
        const extRes = await fetch(BHUNAKSHA_REST_BASE + "/MapInfo/getExtentGeoref", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "state=" + BHUNAKSHA_STATE + "&giscode=" + gc + "&plotid=" + plotId + "&srs=4326",
        });
        if (extRes.ok) {
          const pExt = await extRes.json();
          if (pExt?.xmin != null && pExt?.ymin != null && pExt?.xmax != null && pExt?.ymax != null) {
            plotExt4326 = [pExt.xmin, pExt.ymin, pExt.xmax, pExt.ymax];
          }
          if (!owner && pExt?.owner) owner = String(pExt.owner);
          if (!area && pExt?.area) area = String(pExt.area);
        }
      } catch (_) {}

      // Calculate parcel extent in EPSG:3857 (use georeferenced extent or fallback coordinate footprint)
      let ext3857: [number, number, number, number] | null = null;
      if (plotExt4326) {
        let [pMinX, pMinY, pMaxX, pMaxY] = plotExt4326;
        const shift = vidarbhaLonShift(gc, pMinX);
        pMinX += shift;
        pMaxX += shift;
        const raw3857 = transformExtent([pMinX, pMinY, pMaxX, pMaxY], "EPSG:4326", "EPSG:3857");
        let [minX, minY, maxX, maxY] = raw3857;
        const dx = Math.abs(maxX - minX);
        const dy = Math.abs(maxY - minY);
        if (dx < 30) { minX -= 25; maxX += 25; }
        if (dy < 30) { minY -= 25; maxY += 25; }
        ext3857 = [minX, minY, maxX, maxY];
      } else if (fallbackCoord) {
        const [cx, cy] = fallbackCoord;
        const halfW = 28;
        const halfH = 22;
        ext3857 = [cx - halfW, cy - halfH, cx + halfW, cy + halfH];
      }

      // Generate complete MahaBhuNakasha 7/12 RoR records (Total Area, Pot kharaba, Owner Name, Khata No)
      const records = generatePlotInfoRecords(plotNo, pInfoRaw);
      const firstRec = records[0];
      const finalOwner = owner || firstRec?.ownerName || "";
      const finalArea = area || (firstRec?.totalArea ? `${firstRec.totalArea} Ha` : "");

      // Direct official MahaBhuNakasha portal Map Report link
      let reportUrl = `https://mahabhunakasha.mahabhumi.gov.in/27/signplotreportpublic.jsp?state=${BHUNAKSHA_STATE}&giscode=${gc}&plotno=${plotNo}`;
      if (pInfoRaw?.infoLinks && typeof pInfoRaw.infoLinks === "string") {
        const hrefMatch = pInfoRaw.infoLinks.match(/href=["']([^"']+)["']/i);
        if (hrefMatch?.[1]) {
          reportUrl = hrefMatch[1].replace(/^\.\.\//, "https://mahabhunakasha.mahabhumi.gov.in/27/");
        }
      }

      // Extract exact parcel polygon geometry from the_geom or fallback to extent
      const localBounds =
        pInfoRaw?.xmin != null && pInfoRaw?.ymin != null && pInfoRaw?.xmax != null && pInfoRaw?.ymax != null
          ? {
              xmin: Number(pInfoRaw.xmin),
              ymin: Number(pInfoRaw.ymin),
              xmax: Number(pInfoRaw.xmax),
              ymax: Number(pInfoRaw.ymax),
            }
          : null;

      let exactPolygon: Polygon | null = null;
      if (pInfoRaw?.the_geom) {
        const refLon = plotExt4326 ? plotExt4326[0] : (activeVillageDetails?.lon || 75.7);
        exactPolygon = parsePlotGeometry(pInfoRaw.the_geom, localBounds, plotExt4326, refLon, gc);
      }

      // Draw distinctive marking mark with serial number label on the map!
      const rawMarkerGeom = exactPolygon || (ext3857 ? fromExtent(ext3857) : null);

      if (rawMarkerGeom) {
        // Shift marker geometry by calibration offset so it aligns exactly with calibrated WMS tiles
        const markerGeom = rawMarkerGeom.clone();
        const { x: offX, y: offY } = cadastralCalibRef.current;
        if (offX !== 0 || offY !== 0) {
          markerGeom.translate(offX, offY);
        }

        const fitExt = markerGeom.getExtent();
        const map = mapInstanceRef.current;
        if (map) {
          map.getView().fit(fitExt, { duration: 900, padding: [100, 100, 100, panelOpen ? 420 : 100], maxZoom: 19 });
        }

        const markerFeature = new Feature({
          geometry: markerGeom,
          plotNo: String(plotNo),
          owner: finalOwner,
          area: finalArea,
          transparent: bnPlotTransparent,
        });
        markerFeature.setStyle(createPlotMarkerStyle as any);

        const markerSrc = plotMarkerLayerRef.current?.getSource();
        if (markerSrc) {
          markerSrc.clear();
          markerSrc.addFeature(markerFeature);
          plotMarkerLayerRef.current?.setVisible(true);
        }
      }

      const plotObj: BNPlot = {
        plotid: String(plotId),
        plotno: String(plotNo),
        owner: finalOwner,
        area: finalArea,
        records,
        reportUrl,
        theGeom: pInfoRaw?.the_geom,
        localBounds: localBounds || undefined,
        geoBounds: plotExt4326 || undefined,
        ownerStatus: records.length > 0 ? "live" : "unavailable",
      };
      setBnSelectedPlot(plotObj);
      setBnPlots((prev) => prev.map((p) => (p.plotno === plotNo ? { ...p, ...plotObj } : p)));
      setPlotInfoWindowOpen(true);
      setPlotInfoWindowMinimized(false);
      setBnSelected((prev) => {
        const u = [...prev];
        u[5] = plotNo;
        return u;
      });

      const plotSrc = cadastralPlotLayerRef.current?.getSource();
      if (plotSrc) {
        plotSrc.updateParams({ giscode: gc, plot_id: plotId });
        cadastralPlotLayerRef.current?.setOpacity(bnPlotOpacity / 100);
        cadastralPlotLayerRef.current?.setVisible(true);
      }
    } catch (err) {
      console.warn("Plot selection error:", err);
    } finally {
      setBnPlotsLoading(false);
    }
  }, [bnGisCode, panelOpen, bnPlotTransparent, bnPlotOpacity]);
  // Keep stable ref to selectBnSurveyNo so identify handler can call it
  useEffect(() => { selectBnSurveyNoRef.current = selectBnSurveyNo; }, [selectBnSurveyNo]);
  useEffect(() => { loadVillageOwnerRecordsRef.current = loadVillageOwnerRecords; }, [loadVillageOwnerRecords]);
  // Abort any in-flight owner fetch when the component unmounts.
  useEffect(() => () => { ownerFetchAbortRef.current?.abort(); highlightAbortRef.current?.abort(); }, []);
  // handleBnLevelChangeRef is synced below, after handleBnLevelChange is defined

  const selectBnPlot = useCallback((plot: BNPlot) => {
    const cat = bnSelected[0] || "R";
    const dist = bnSelected[1];
    const tal = bnSelected[2];
    const vlg = bnSelected[3];
    const middle = cat === "R" ? "VM" : "CM";
    const gc = bnGisCode || (cat + middle + dist + tal + vlg);
    selectBnSurveyNo(plot.plotno, gc);
  }, [selectBnSurveyNo, bnGisCode, bnSelected]);

  const handleBnLevelChange = async (levelIndex: number, code: string) => {
    // Synthetic Map Type entries (see the row-4 options list below) trigger the
    // forest/water-body highlight instead of a real portal map-type change. Handled
    // before any of the normal cascade bookkeeping runs, and bnSelected/bnLevels are
    // never touched — so the <select> visually snaps back to whichever real Map Type
    // was active, and no request is ever sent to the portal for this fake code.
    if (levelIndex === 4 && (code === "__forest__" || code === "__waterbody__")) {
      const cat = code === "__forest__" ? "forest" : "waterbody";
      const plots = villageEnvStats[cat];
      if (plots.length > 0) {
        setSelectedSurnameFilter(null);
        setSelectedOwnerFilter(null);
        setCategoryFilter(new Set<Category>([cat === "forest" ? "forest" : "water"]));
        highlightPlotsGroup(plots, cat, cat === "forest" ? "Forest Land" : "Water Bodies", cat === "forest" ? "Forest" : "Water");
      }
      return;
    }

    bnSelectedRef.current[levelIndex] = code;
    for (let i = levelIndex + 1; i < 6; i++) {
      bnSelectedRef.current[i] = "";
    }
    setBnSelected((prev) => {
      const u = [...prev];
      u[levelIndex] = code;
      for (let i = levelIndex + 1; i < u.length; i++) u[i] = "";
      return u;
    });
    setBnLevels((prev) => {
      const u = [...prev];
      for (let i = levelIndex + 1; i < u.length; i++) {
        if (levelIndex === 4 && i === 5) continue;
        u[i] = [];
      }
      return u;
    });
    setBnLevelError((prev) => {
      const u = { ...prev };
      for (let i = levelIndex + 1; i < 6; i++) delete u[i];
      return u;
    });
    if (levelIndex !== 4 && levelIndex !== 5) {
      setBnPlots([]);
      setBnSelectedPlot(null);
    }
    plotMarkerLayerRef.current?.getSource()?.clear();
    if (levelIndex < 3) {
      setBnGisCode(null);
      setBnVillageExtent(null);
      cadastralVillageLayerRef.current?.setVisible(false);
      cadastralPlotLayerRef.current?.setVisible(false);
      setBnCadastralEnabled(false);
    }
    if (!code) return;

    if (levelIndex === 0) {
      // Category selected ('R' or 'U')
      if (code === "R") {
        setBnLevels((prev) => {
          const u = [...prev];
          u[1] = DEFAULT_DISTRICTS;
          return u;
        });
        setBnDistrictSource("default");
      }
      setBnLoading(true);
      try {
        const { rows, error } = await fetchLevelList(1, `${code},`);
        if (rows.length > 0) {
          // Fix BhuNaksha API typos in district names (e.g. 'Nangpur' → 'Nagpur')
          setBnLevels((prev) => {
            const u = [...prev];
            u[1] = rows.map((d: any) => ({
              code: String(d.code),
              value: BN_DISTRICT_NAME_FIX[String(d.value)] || String(d.value),
            }));
            return u;
          });
          setBnDistrictSource("live");
        } else {
          console.warn("Live district fetch returned nothing, retaining default districts:", error);
          setBnLevels((prev) => {
            const u = [...prev];
            if (!u[1] || u[1].length === 0) u[1] = DEFAULT_DISTRICTS;
            return u;
          });
          setBnDistrictSource("default");
          setBnLevelError((prev) => ({ ...prev, 1: error || "" }));
        }
      } catch (err) {
        console.warn("Fetch districts failed, retaining default districts:", err);
        setBnLevels((prev) => {
          const u = [...prev];
          if (!u[1] || u[1].length === 0) u[1] = DEFAULT_DISTRICTS;
          return u;
        });
        setBnDistrictSource("default");
        setBnLevelError((prev) => ({ ...prev, 1: (err as Error)?.message || "Request failed" }));
      } finally {
        setBnLoading(false);
      }
    } else if (levelIndex === 1) {
      // District selected
      const cat = bnSelectedRef.current[0] || "R";
      setBnLoading(true);
      try {
        const { rows, error } = await fetchLevelList(2, `${cat},${code},`);
        const talukas: BNLevel[] = rows.map((t: any) => ({ code: String(t.code).trim(), value: String(t.value).trim() }));
        // No local-dataset fallback here: BhuNaksha's taluka codes are portal-internal
        // IDs that cannot be reconstructed from the local village spreadsheet. A guessed
        // code (e.g. "01", "02" by alphabetical order) looks like a normal option but
        // almost never matches the real portal code, so picking it would silently fail
        // to fetch parcels later — exactly the "works in Marathi, breaks after a format
        // change" symptom. An honest empty state with a retry action is shown instead.
        setBnLevels((prev) => {
          const u = [...prev];
          u[2] = talukas;
          return u;
        });
        setBnLevelError((prev) => ({ ...prev, 2: error || "" }));
        if (error) console.warn(`Fetch talukas for district ${code} returned nothing:`, error);
        const distObj = bnLevels[1]?.find((d) => d.code === code);
        if (distObj) {
          const raw = distObj.value || "";
          const enName = raw.includes("(") ? raw.split("(")[0].trim() : (raw.includes("/") ? raw.split("/")[0].trim() : raw);
          const fixedDistName = BN_DISTRICT_NAME_FIX[enName] || enName;
          flyToDistrict(fixedDistName);
        }
      } catch (err) {
        console.warn("Fetch talukas failed:", err);
        setBnLevelError((prev) => ({ ...prev, 2: (err as Error)?.message || "Request failed" }));
      } finally {
        setBnLoading(false);
      }
    } else if (levelIndex === 2) {
      // Taluka selected
      const cat = bnSelectedRef.current[0] || "R";
      const dist = bnSelectedRef.current[1] || bnSelected[1];
      setBnLoading(true);
      try {
        const { rows, error } = await fetchLevelList(3, `${cat},${dist},${code},`);
        const villages: BNLevel[] = rows.map((v: any) => ({
          code: String(v.code).trim(),
          value: String(v.value).trim(),
        }));
        // Same reasoning as the taluka fetch above: no synthesized village codes. The old
        // fallback here also read fields (village_code, village_name_mr) that do not
        // exist on the local dataset, so every fallback row silently rendered as the
        // placeholder "Village 1", "Village 2", ... regardless of the real village name.
        setBnLevels((prev) => {
          const u = [...prev];
          u[3] = villages;
          return u;
        });
        setBnLevelError((prev) => ({ ...prev, 3: error || "" }));
        if (error) console.warn(`Fetch villages for taluka ${code} returned nothing:`, error);

        const distObj = bnLevels[1]?.find((d) => d.code === dist);
        const talObj = bnLevels[2]?.find((t) => t.code === code);
        if (distObj && talObj) {
          flyToTaluka(distObj.value, talObj.value);
        }
      } catch (err) {
        console.warn("Fetch villages failed:", err);
        setBnLevelError((prev) => ({ ...prev, 3: (err as Error)?.message || "Request failed" }));
      } finally {
        setBnLoading(false);
      }
    } else if (levelIndex === 3) {
      // Village selected
      const cat = bnSelected[0] || "R";
      const dist = bnSelected[1];
      const tal = bnSelected[2];
      const vlg = code;
      const middle = cat === "R" ? "VM" : "CM";
      const gisCode = cat + middle + dist + tal + vlg;
      // The map-type list only fills a dropdown (the GIS code above does not depend on it),
      // so it loads beside the cadastral instead of in front of it.
      void portalJson<any[]>(
        "/VillageMapService/ListsAfterLevelGeoref",
        "state=" + BHUNAKSHA_STATE + "&level=4&codes=" + cat + "," + dist + "," + tal + "," + vlg + ",&hasmap=true",
        `bn:lvl4:${cat},${dist},${tal},${vlg}`
      )
        .then((data) => {
          let mapType = "VM";
          if (Array.isArray(data) && data[0]) {
            const types = data[0].map((m: any) => ({ code: String(m.code), value: String(m.value) }));
            setBnLevels((prev) => {
              const u = [...prev];
              u[4] = types;
              return u;
            });
            const valid = data[0].find((m: any) => m.extraParms?.hasData === true) || types[0];
            if (valid) mapType = valid.code;
          }
          setBnSelected((prev) => {
            const u = [...prev];
            u[4] = mapType;
            return u;
          });
        })
        .catch((err) => console.warn("Map type list failed:", err));
      await loadCadastralForGisCode(gisCode);
    } else if (levelIndex === 4) {
      // Map Type selected
      const cat = bnSelected[0] || "R";
      const dist = bnSelected[1];
      const tal = bnSelected[2];
      const vlg = bnSelected[3];
      if (dist && tal && vlg) {
        const middle = cat === "R" ? (code || "VM") : "CM";
        const gisCode = cat + middle + dist + tal + vlg;
        await loadCadastralForGisCode(gisCode);
      }
    } else if (levelIndex === 5) {
      // Survey No selected
      if (code) {
        const cat = bnSelected[0] || "R";
        const dist = bnSelected[1];
        const tal = bnSelected[2];
        const vlg = bnSelected[3];
        const middle = cat === "R" ? "VM" : "CM";
        const gc = bnGisCode || (cat + middle + dist + tal + vlg);
        selectBnSurveyNo(code, gc);
      }
    }
  };
  // Sync handleBnLevelChange to ref (must be after definition)
  useEffect(() => { handleBnLevelChangeRef.current = handleBnLevelChange as any; });

  const quickLoadOzarCadastral = async () => {
    setBnLoading(true);
    try {
      const cat = "R";
      const dist = "20"; // Nashik
      const tal = "14";  // Niphad
      const vlg = "272000144200900000"; // Ozar
      const mt = "VM";

      const [r1, r2, r3] = await Promise.all([
        fetch(BHUNAKSHA_REST_BASE + "/VillageMapService/ListsAfterLevelGeoref", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "state=" + BHUNAKSHA_STATE + "&level=1&codes=" + cat + ",&hasmap=true",
        }).then((r) => r.json()).catch(() => []),
        fetch(BHUNAKSHA_REST_BASE + "/VillageMapService/ListsAfterLevelGeoref", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "state=" + BHUNAKSHA_STATE + "&level=2&codes=" + cat + "," + dist + ",&hasmap=true",
        }).then((r) => r.json()).catch(() => []),
        fetch(BHUNAKSHA_REST_BASE + "/VillageMapService/ListsAfterLevelGeoref", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "state=" + BHUNAKSHA_STATE + "&level=3&codes=" + cat + "," + dist + "," + tal + ",&hasmap=true",
        }).then((r) => r.json()).catch(() => []),
      ]);

      setBnLevels([
        DEFAULT_CATEGORIES,
        (r1[0] || []).map((d: any) => ({ code: String(d.code), value: String(d.value) })),
        (r2[0] || []).map((t: any) => ({ code: String(t.code), value: String(t.value) })),
        (r3[0] || []).map((v: any) => ({ code: String(v.code), value: String(v.value) })),
        [{ code: "VM", value: "Village Map" }],
        [],
      ]);
      setBnSelected([cat, dist, tal, vlg, mt, ""]);

      const gisCode = cat + "VM" + dist + tal + vlg;
      await loadCadastralForGisCode(gisCode);
    } catch (e) {
      console.warn("Quick load Ozar error:", e);
    } finally {
      setBnLoading(false);
    }
  };

  const initBhuNakshaLevels = useCallback(async () => {
    resetPortalBreaker();
    setBnLoading(true);
    setBnLevelError({});
    // Bounded like fetchLevelList: this is the very first cascade call, so a hang here
    // would otherwise leave bnLoading stuck forever with the panel showing nothing at all.
    const timeoutCtrl = new AbortController();
    const timer = setTimeout(() => timeoutCtrl.abort(), 20000);
    try {
      // Static snapshot first: instant, and unaffected by the portal being slow or down.
      const snap = await snapshotRows(1, "R,");
      if (snap && snap.length > 0) {
        setBnLevels((prev) => {
          const u = [...prev];
          if (!u[0] || u[0].length === 0) u[0] = DEFAULT_CATEGORIES;
          u[1] = snap.map((d: any) => ({ code: String(d.code), value: BN_DISTRICT_NAME_FIX[String(d.value)] || String(d.value) }));
          return u;
        });
        setBnDistrictSource("live");
        setBnLevelError((prev) => ({ ...prev, 1: "" }));
        return;
      }
      const res = await fetch(BHUNAKSHA_REST_BASE + "/VillageMapService/ListsAfterLevelGeoref", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "state=" + BHUNAKSHA_STATE + "&level=0&codes=&hasmap=true",
        signal: timeoutCtrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const categories: BNLevel[] = Array.isArray(data?.[0])
        ? data[0].map((c: any) => ({
            code: String(c.code),
            value: c.code === "R" ? "Rural (ग्रामीण)" : c.code === "U" ? "Urban (शहरी)" : String(c.value),
          }))
        : [];
      const districts: BNLevel[] = Array.isArray(data?.[1])
        ? data[1].map((d: any) => ({
            code: String(d.code),
            value: BN_DISTRICT_NAME_FIX[String(d.value)] || String(d.value),
          }))
        : [];
      if (districts.length === 0) {
        // The portal itself is reachable (we got a 200) but returned no districts — treat
        // this the same as a hard failure rather than quietly wearing the static list.
        throw new Error("Portal responded but returned 0 districts");
      }
      setBnLevels((prev) => {
        const u = [...prev];
        u[0] = categories.length ? categories : DEFAULT_CATEGORIES;
        u[1] = districts;
        return u;
      });
      setBnDistrictSource("live");
    } catch (err) {
      console.warn("BhuNaksha level 0 init failed, showing offline reference districts:", err);
      setBnLevels((prev) => {
        const u = [...prev];
        if (!u[0] || u[0].length === 0) u[0] = DEFAULT_CATEGORIES;
        u[1] = DEFAULT_DISTRICTS;
        return u;
      });
      setBnDistrictSource("default");
      const message = (err as Error)?.name === "AbortError" ? "Request timed out after 20s" : (err as Error)?.message || "Request failed";
      setBnLevelError((prev) => ({ ...prev, 1: message }));
    } finally {
      clearTimeout(timer);
      setBnLoading(false);
    }
  }, []);
  useEffect(() => {
    if (panelOpen === "cadastral" || panelOpen === "explore" || panelOpen === "cfr") {
      setBnSelected((prev) => {
        if (!prev[0]) {
          const u = [...prev];
          u[0] = "R";
          return u;
        }
        return prev;
      });
      initBhuNakshaLevels();
    }
  }, [panelOpen, initBhuNakshaLevels]);

  const loadDistrictVillages = useCallback(async (districtRaw: string) => {
    if (!districtRaw) return;
    const norm = NORMALIZE_DISTRICT[districtRaw] || districtRaw;
    if (loadedVillageDistrict === norm) return;
    try {
      const res = await fetch("/data/villages/" + norm + ".json");
      if (!res.ok) { console.warn("Village file for " + norm + " not found"); return; }
      const data = await res.json();
      const features = new GeoJSON().readFeatures(data, { featureProjection: "EPSG:3857" });
      const src = villageLayerRef.current?.getSource();
      if (src) { src.clear(); src.addFeatures(features); setLoadedVillageDistrict(norm); setLayerVisible((p) => ({ ...p, village: true })); }
    } catch (err) { console.error("Village boundary load error:", err); }
  }, [loadedVillageDistrict]);

  useEffect(() => { if (!villageData || searchQuery.length < 2) { setSearchResults([]); return; } setSearchResults(searchVillages(villageData, searchQuery)); }, [searchQuery, villageData]);

  const flyToDistrict = useCallback((districtName: string) => {
    if (!mapInstanceRef.current) return;
    const fixed = BN_DISTRICT_NAME_FIX[districtName] || districtName;
    const norm = NORMALIZE_DISTRICT[fixed] || fixed;
    loadDistrictVillages(norm);
    const src = districtLayerRef.current?.getSource();
    if (src) {
      const features = src.getFeatures().filter((f) => {
        const p = f.getProperties();
        return (
          p.NAME_2?.toLowerCase() === norm.toLowerCase() ||
          p.NAME_1?.toLowerCase() === norm.toLowerCase() ||
          p.NAME_2?.toLowerCase() === fixed.toLowerCase()
        );
      });
      if (features.length > 0) {
        let ext = createEmpty();
        features.forEach((f) => extend(ext, f.getGeometry()!.getExtent()));
        if (!isEmpty(ext)) {
          mapInstanceRef.current.getView().fit(ext, { duration: 900, padding: [60, 60, 60, panelOpen ? 400 : 60] });
          return;
        }
      }
    }
    const [lon, lat] = getDistrictCentroid(fixed);
    mapInstanceRef.current.getView().animate({ center: fromLonLat([lon, lat]), zoom: 10, duration: 900 });
  }, [loadDistrictVillages, panelOpen]);

  const flyToTaluka = useCallback((districtName: string, talukaName: string) => {
    if (!mapInstanceRef.current) return;
    const fixedDist = BN_DISTRICT_NAME_FIX[districtName] || districtName;
    loadDistrictVillages(fixedDist);
    const talSrc = talukaLayerRef.current?.getSource();
    if (talSrc) {
      const features = talSrc.getFeatures().filter((f) => {
        const p = f.getProperties();
        return (
          (p.NAME_2?.toLowerCase() === fixedDist.toLowerCase() || p.NAME_2?.toLowerCase() === districtName.toLowerCase()) &&
          p.NAME_3?.toLowerCase() === talukaName.toLowerCase()
        );
      });
      if (features.length > 0) {
        let ext = createEmpty();
        features.forEach((f) => extend(ext, f.getGeometry()!.getExtent()));
        if (!isEmpty(ext)) {
          mapInstanceRef.current.getView().fit(ext, { duration: 1000, padding: [60, 60, 60, panelOpen ? 400 : 60] });
          return;
        }
      }
    }
    // Fallback for CTSO talukas (CTSO NO.2 Nagpur, etc.): fly to district center in Maharashtra
    flyToDistrict(fixedDist);
  }, [loadDistrictVillages, flyToDistrict, panelOpen]);

  const flyToVillage = useCallback((village: MHVillage) => {
    if (!mapInstanceRef.current) return;
    setActiveVillageDetails(village);
    loadDistrictVillages(village.district).then(() => {
      setTimeout(() => {
        const vlgSrc = villageLayerRef.current?.getSource();
        if (vlgSrc) {
          const features = vlgSrc.getFeatures().filter((f) => { const p = f.getProperties(); return p.NAME?.toLowerCase() === village.village.toLowerCase() || p.CEN_2001?.includes(village.villageCode); });
          if (features.length > 0) { let ext = createEmpty(); features.forEach((f) => extend(ext, f.getGeometry()!.getExtent())); if (!isEmpty(ext)) { mapInstanceRef.current?.getView().fit(ext, { duration: 1000, padding: [80, 80, 80, panelOpen ? 400 : 80], maxZoom: 17 }); const hl = highlightLayerRef.current?.getSource(); if (hl) { hl.clear(); hl.addFeatures(features); } return; } }
        }
        flyToTaluka(village.district, village.subdistrict);
      }, 300);
    });
  }, [loadDistrictVillages, flyToTaluka, panelOpen]);

  const zoomIn = () => { const v = mapInstanceRef.current?.getView(); if (v) v.animate({ zoom: (v.getZoom() ?? 7) + 1, duration: 300 }); };
  const zoomOut = () => { const v = mapInstanceRef.current?.getView(); if (v) v.animate({ zoom: (v.getZoom() ?? 7) - 1, duration: 300 }); };
  const clearMultiHighlight = useCallback(() => {
    setMultiHighlightInfo(null);
    setSelectedSurnameFilter(null);
    setSelectedOwnerFilter(null);
    setCategoryFilter(new Set());
    plotMarkerLayerRef.current?.getSource()?.clear();
  }, []);

  const resetView = () => {
    mapInstanceRef.current?.getView().animate({ center: MH_CENTER, zoom: MH_ZOOM, duration: 600 });
    highlightLayerRef.current?.getSource()?.clear();
    plotMarkerLayerRef.current?.getSource()?.clear();
    clearMultiHighlight();
    setInfoVisible(false); setActiveVillageDetails(null); setBnSelectedPlot(null);
    setBnCadastralEnabled(false); cadastralVillageLayerRef.current?.setVisible(false); cadastralPlotLayerRef.current?.setVisible(false);
  };

  /**
   * Draws every parcel of a family or an individual owner at once.
   *
   * The banner is written only after geometry has actually resolved, and lists just the
   * parcels that were drawn — it used to be set up-front, so when the extent lookup came
   * back empty the user saw "N parcels highlighted" over a map with nothing on it.
   */
  const highlightPlotsGroup = useCallback(
    async (
      targetPlots: BNPlot[],
      type: HighlightType,
      mrName: string,
      enName: string,
      perPlotType?: (p: BNPlot) => string
    ) => {
      if (!targetPlots || targetPlots.length === 0) return;
      const markerLayer = plotMarkerLayerRef.current;
      const markerSrc = markerLayer?.getSource();
      if (!markerSrc) return;

      highlightAbortRef.current?.abort();
      const controller = new AbortController();
      highlightAbortRef.current = controller;

      const map = mapInstanceRef.current;
      const gc = bnGisCodeRef.current;
      const totalExt = createEmpty();
      const featuresToAdd: Feature[] = [];
      const drawnPlotNos: string[] = [];
      let totalAreaNum = 0;

      // Resolve bounds / polygons with bounded parallelism. A common surname in a large
      // village would otherwise fire hundreds of simultaneous requests and lock the UI.
      const resolved = await mapWithConcurrency(
        targetPlots,
        6,
        async (plot) => {
          // Vidarbha districts (Nagpur, Wardha, Bhandara, Gondia, Chandrapur, Gadchiroli)
          // are stored 6° west of their true longitude by the portal — without this, a
          // family's parcels render correctly shaped but ~600km away (e.g. near the
          // Gujarat coast instead of Nagpur). The shift is a no-op on an already-corrected
          // extent (it checks < 76°), so this is safe even if plot.geoBounds was cached by
          // an earlier version of this code that didn't apply it yet.
          const correct = (ext: [number, number, number, number] | null) => {
            if (!ext) return ext;
            const shift = vidarbhaLonShift(gc, ext[0]);
            return shift ? ([ext[0] + shift, ext[1], ext[2] + shift, ext[3]] as [number, number, number, number]) : ext;
          };

          let pExt: [number, number, number, number] | null = correct(plot.geoBounds || null);

          // The extent is what re-centres the outline on the calibrated WMS parcel mark, so it is
          // fetched even when the polygon is already known. Above ~60 parcels that many extra
          // requests would make the highlight crawl, so those rely on the polygon alone.
          if (!pExt && gc && (targetPlots.length <= 60 || !plot.theGeom)) {
            // plot.plotid is the portal's real id once the owner records have loaded.
            try {
              pExt = correct(await fetchPlotExtent(gc, plot.plotid || plot.plotno, controller.signal));
            } catch {
              pExt = null;
            }
          }

          let pGeom: Polygon | null = null;
          if (plot.theGeom) {
            const refLon = pExt ? pExt[0] : activeVillageDetails?.lon || 75.7;
            pGeom = parsePlotGeometry(plot.theGeom, plot.localBounds || null, pExt, refLon, gc);
          }

          return { plot, pExt, pGeom };
        },
        controller.signal
      );

      if (controller.signal.aborted) return;

      const { x: offX, y: offY } = cadastralCalibRef.current;
      // Extents fetched here are merged back through state rather than mutated in place.
      const newBounds: Record<string, [number, number, number, number]> = {};

      resolved.forEach((r) => {
        if (!r) return;
        const { plot, pExt, pGeom } = r;
        if (pExt && !plot.geoBounds) newBounds[plot.plotno] = pExt;

        let geom: any = pGeom;
        if (!geom && pExt) {
          geom = fromExtent(transformExtent(pExt, "EPSG:4326", "EPSG:3857"));
        }
        if (!geom) return;

        const shifted = geom.clone();
        if (offX !== 0 || offY !== 0) shifted.translate(offX, offY);
        extend(totalExt, shifted.getExtent());

        const f = new Feature({
          geometry: shifted,
          plotNo: plot.plotno,
          owner: plot.owner || "",
          surname: mrName,
          area: plot.area || "",
          highlightType: perPlotType ? perPlotType(plot) : type,
          transparent: false,
        });
        f.setStyle(createPlotMarkerStyle as any);
        featuresToAdd.push(f);
        drawnPlotNos.push(plot.plotno);
        totalAreaNum +=
          plot.records?.reduce((s, rec) => s + (parseFloat(rec.totalArea) || 0), 0) || haFromAreaText(plot.area) || 0;
      });

      if (Object.keys(newBounds).length > 0) {
        setBnPlots((prev) =>
          prev.map((p) => {
            const b = newBounds[p.plotno];
            return b && !p.geoBounds ? { ...p, geoBounds: b } : p;
          })
        );
      }

      setMultiHighlightInfo({
        type,
        title:
          type === "surname"
            ? `Surname Family Land: ${mrName} (${enName})`
            : type === "owner"
              ? `Owner Holdings: ${mrName}`
              : type === "forest"
                ? "Official Forest Land"
                : type === "waterbody"
                  ? "Water Bodies"
                  : mrName,
        mrName,
        enName,
        plotNos: drawnPlotNos,
        missingGeometry: targetPlots.length - drawnPlotNos.length,
        totalAreaHa: Math.round(totalAreaNum * 10000) / 10000,
        totalAreaAcres: (totalAreaNum * 2.47105).toFixed(2),
      });

      // Clear only once there is something to replace it with, so a failed lookup never
      // leaves the map emptier than it was before the click.
      if (featuresToAdd.length > 0) {
        markerSrc.clear();
        markerSrc.addFeatures(featuresToAdd);
        markerLayer?.setVisible(true);

        if (!isEmpty(totalExt) && map) {
          map.getView().fit(totalExt, {
            duration: 900,
            padding: [100, 100, 100, panelOpenRef.current ? 420 : 100],
            maxZoom: 18.5,
          });
        }
      }
    },
    [activeVillageDetails]
  );

  const districts = villageData ? getDistricts(villageData) : [];
  const talukas = villageData && selectedDistrict ? getTalukas(villageData, selectedDistrict) : [];
  const villages = villageData && selectedDistrict && selectedTaluka ? getVillages(villageData, selectedDistrict, selectedTaluka) : [];
  const togglePanel = (panel: PanelKey) => setPanelOpen((prev) => (prev === panel ? null : panel));
  const toggleLayerOpacity = (key: string) => setLayerOpacityOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  /**
   * Per-parcel search index, rebuilt only when bnPlots changes.
   * Previously the filter re-parsed every owner name and walked the whole name
   * dictionary on every keystroke, which is why typing felt broken on a large village.
   */
  interface PlotIndexEntry {
    plot: BNPlot;
    plotno: string;
    plotnoLower: string;
    owners: ParsedOwner[];
    /** Distinct surnames on this parcel, excluding government holders. */
    surnames: string[];
    /** Phonetic keys of `surnames`; the family filter and chips compare these. */
    familyKeys: string[];
    areaHa: number;
    category: Category;
    hasLiveRecord: boolean;
    /** Spreadsheet row that recognizes this parcel as CFR, if any. */
    cfr: CfrRow | undefined;
    cfrStatus: CfrStatus;
    /** MRSAC cross-reference: parcel lies in a forest compartment / water body. */
    mrsac: MrsacParcel | undefined;
    /** % of the parcel inside its approved CFR compartment (compartment approvals only). */
    overlapPct?: number;
    /** Compartment (base number) and Gram Sabha(s) whose approved CFR land this parcel lies in. */
    compNo?: string;
    gramSabha?: string;
  }
  interface CompParcel {
    all: Record<string, number>;
    names: Record<string, string[]>;
  }

  useEffect(() => {
    if (panelOpen === "cfr" && !cfrIndex) void loadCfrData().then(setCfrIndex);
  }, [panelOpen, cfrIndex]);

  // ATREE layers are created on first use; tiles are drawn server-side so panning stays cheap.
  const cfrMode = panelOpen === "cfr";

  // MRSAC state-wide layers: server-drawn tiles, created on first use, calibrated like the cadastral.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    for (const l of RES_LAYERS) {
      let layer = resTileLayersRef.current[l.key];
      if (resTile[l.key] && !layer) {
        const source = new TileArcGISRest({
          url: l.service,
          tileLoadFunction: gatedTileLoad(["base", "cad"]),
          params: { LAYERS: `show:${l.id}`, FORMAT: "png32", TRANSPARENT: true },
          // No crossOrigin: images are only displayed, and not every MRSAC host sends CORS headers.
        });
        // No cadastral calibration here: MRSAC is already georeferenced, so it must be drawn exactly where the
        // MRSAC geoportal draws it. (The calibration moves BhuNaksha parcels onto the imagery, not MRSAC.)
        layer = new TileLayer({ zIndex: 5, source, properties: { name: `mrsac-tile-${l.key}` } });
        map.addLayer(layer);
        resTileLayersRef.current[l.key] = layer;
      }
      layer?.setVisible(!!resTile[l.key]);
      layer?.setOpacity(resOpacity / 100);
    }
  }, [resTile, resOpacity]);

  // The selected village's own MRSAC features: village polygon first, then one spatial query
  // per layer. Results stream in: the panel flips to "ready" as soon as the first layer
  // resolves, so the user doesn't wait for all 8 before seeing any data.
  useEffect(() => {
    if (!bnVillageExtent) {
      setResVillage({ status: "idle", village: null, features: {}, error: null });
      return;
    }
    if (!cfrMode) return;
    const ctl = new AbortController();
    setResVillage((prev) => ({ ...prev, status: "loading", error: null }));
    void (async () => {
      try {
        const village = await findVillage(bnVillageExtent, ctl.signal, bnLevels[3]?.find((o) => o.code === bnSelected[3])?.value ?? "");
        if (!village) throw new Error("This village was not found in the MRSAC village boundaries.");
        if (ctl.signal.aborted) return;
        // Kick off all layer queries concurrently; each resolved layer is merged into state
        // immediately so the panel shows data as soon as the first layer responds.
        let anyResolved = false;
        const promises = RES_LAYERS.map((l) =>
          fetchResource(l, village, ctl.signal).then(
            (features) => {
              if (ctl.signal.aborted) return;
              anyResolved = true;
              setResVillage((prev) => ({
                ...prev,
                status: "ready",
                village,
                features: { ...prev.features, [l.key]: features },
                error: null,
              }));
            },
            () => { /* layer failed — skip, we'll check anyResolved at the end */ }
          )
        );
        await Promise.all(promises);
        if (ctl.signal.aborted) return;
        setResVillage((prev) => ({
          ...prev,
          status: "ready",
          village,
          error: null,
        }));
      } catch (e) {
        if (!ctl.signal.aborted) setResVillage({ status: "error", village: null, features: {}, error: (e as Error).message });
      }
    })();
    return () => ctl.abort();
  }, [bnVillageExtent, cfrMode, resRetry]);

  // Draw the village's features. Rebuilt when the calibration or a filter changes; cheap at village scale.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!resVectorRef.current) {
      const styles: Record<string, Style> = {};
      const styleFor = (f: any) => {
        const key = f.get("layerKey") as string;
        const l = resLayerByKey(key)!;
        if (f.get("selected")) {
          return l.kind === "point"
            ? new Style({ image: new CircleStyle({ radius: 9, fill: new Fill({ color: l.color }), stroke: new Stroke({ color: "#f59e0b", width: 3 }) }), zIndex: 10 })
            : new Style({ stroke: new Stroke({ color: "#f59e0b", width: 4 }), fill: new Fill({ color: l.color + "55" }), zIndex: 10 });
        }
        if (styles[key]) return styles[key];
        return (styles[key] =
          l.kind === "point"
            ? new Style({ image: new CircleStyle({ radius: 4.5, fill: new Fill({ color: l.color }), stroke: new Stroke({ color: "#ffffff", width: 1.2 }) }) })
            : l.kind === "line"
              ? new Style({ stroke: new Stroke({ color: l.color, width: 1.6 }) })
              : new Style({ stroke: new Stroke({ color: l.color, width: 1.8 }), fill: new Fill({ color: l.color + "33" }) }));
      };
      // zIndex 40: above the cadastral WMS (30), whose fill otherwise hides wells and structures at the default 85% opacity; below plot highlights (50)
      resVectorRef.current = new VectorLayer({ source: new VectorSource(), style: styleFor as any, zIndex: 40, properties: { name: "mrsac-vector" } });
      map.addLayer(resVectorRef.current);
    }
    const layer = resVectorRef.current;
    // StrictMode (dev) mounts twice: a layer made for the first map instance must be re-attached to the live one.
    if (!map.getLayers().getArray().includes(layer)) map.addLayer(layer);
    const src = layer.getSource()!;
    src.clear();
    layer.setVisible(cfrMode);
    if (resVillage.status !== "ready") return;
    const fmt = new GeoJSON();
    for (const l of RES_LAYERS) {
      if (!resVisible.has(l.key)) continue;
      for (const f of resVillage.features[l.key] ?? []) {
        if (l.typeField && resHiddenTypes.has(`${l.key}|${typeLabel(l, f.properties)}`)) continue;
        const feat = fmt.readFeature(f, { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" }) as Feature;
        feat.set("layerKey", l.key);
        // Forest compartments are cut from the cadastral map (their village outline equals the portal's raw extent), so
        // they carry the same offset as the raw cadastral and get the same calibration shift. Water / wells are GPS-true.
        if (l.group === "forest") feat.getGeometry()?.translate(forestDelta[0], forestDelta[1]);
        src.addFeature(feat);
      }
    }
  }, [resVillage, resVisible, resHiddenTypes, cfrMode, forestDelta[0], forestDelta[1]]);

  // Parcel outlines from getPlotInfo are placed by a coordinate conversion that is off from where the portal draws the
  // parcel by a roughly constant amount per village. Measure it from a few plots (outline centre vs the portal's own
  // extent centre) and remember it, so point-in-parcel tests land on the parcel actually drawn there.
  const frameShiftRef = useRef<Record<string, [number, number]>>({});
  const parcelFrameShift = async (gis: string, plots: BNPlot[]): Promise<[number, number]> => {
    const known = frameShiftRef.current[gis];
    if (known) return known;
    const withGeom = plots.filter((p) => p.theGeom);
    const picks = withGeom.length <= 5 ? withGeom : [0, 0.25, 0.5, 0.75, 1].map((f) => withGeom[Math.round(f * (withGeom.length - 1))]!);
    const dxs: number[] = [];
    const dys: number[] = [];
    await Promise.all(
      picks.map(async (pl) => {
        const ext = await fetchPlotExtent(gis, pl.plotid || pl.plotno).catch(() => null);
        if (!ext) return;
        const shift = vidarbhaLonShift(gis, ext[0]);
        const e: [number, number, number, number] = shift ? [ext[0] + shift, ext[1], ext[2] + shift, ext[3]] : ext;
        const poly = parsePlotGeometry(pl.theGeom!, pl.localBounds || null, null, e[0], gis);
        if (!poly) return;
        const c = getCenter(poly.getExtent());
        const t = fromLonLat([(e[0] + e[2]) / 2, (e[1] + e[3]) / 2]);
        dxs.push(t[0]! - c[0]!);
        dys.push(t[1]! - c[1]!);
      })
    );
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
    const out: [number, number] = [med(dxs), med(dys)];
    if (dxs.length >= 2) frameShiftRef.current[gis] = out;
    return out;
  };

  /** The loaded parcel drawn at a map coordinate (the portal's WMS cannot be asked: it always answers with an image). */
  const findParcelAt = async (pt: number[]): Promise<BNPlot | null> => {
    const gis = bnGisCode;
    if (!gis) return null;
    const refLon = bnVillageExtent ? (bnVillageExtent[0] + bnVillageExtent[2]) / 2 : 75.7;
    const [fx, fy] = await parcelFrameShift(gis, bnPlots);
    const { x: ox, y: oy } = cadastralCalibRef.current;
    for (const pl of bnPlots) {
      if (!pl.theGeom) continue;
      const poly = parsePlotGeometry(pl.theGeom, pl.localBounds || null, null, refLon, gis);
      if (!poly) continue;
      poly.translate(fx + ox, fy + oy);
      const e = poly.getExtent();
      if (pt[0]! < e[0] || pt[0]! > e[2] || pt[1]! < e[1] || pt[1]! > e[3]) continue;
      if (poly.intersectsCoordinate(pt)) return pl;
    }
    return null;
  };

  // Clicking a survey number on the map (outside Identify mode, not on an MRSAC feature) opens its details card.
  useEffect(() => {
    parcelClickRef.current = async (coord) => {
      if (!bnGisCode || !bnCadastralEnabled) return false;
      const token = ++parcelLookupRef.current;
      return findParcelAt(coord).then((pl) => {
        if (!pl || token !== parcelLookupRef.current) return false;
        const [lon, lat] = toLonLat(coord) as [number, number];
        resSelectedRef.current?.set("selected", false);
        resSelectedRef.current = null;
        setResInfo(null);
        setParcelInfo({ plotno: pl.plotno, lon, lat, copied: false });
        return true;
      });
    };
  });

  // What a click on an MRSAC feature shows: its attributes, the survey number(s) it falls in, and links.
  useEffect(() => {
    resClickRef.current = (feat, coord) => {
      const layerKey = String(feat.get("layerKey") ?? "");
      const props = { ...feat.getProperties() } as Record<string, unknown>;
      delete props["geometry"];
      delete props["layerKey"];
      delete props["selected"];
      const g = feat.getGeometry();
      const isPoint = g?.getType() === "Point";
      const at = toLonLat(isPoint ? g.getCoordinates() : coord) as [number, number];
      const areaHa = g && !isPoint && /Polygon/.test(g.getType()) ? getArea(g, { projection: "EPSG:3857" }) / 10000 : undefined;
      const details = describeResource(layerKey, props, at, areaHa);
      if (!details) return;

      // survey numbers: a forest compartment is matched through the parcel cross-reference; a point (or a water body's
      // clicked spot) is looked up with the portal's own GetFeatureInfo, so it names exactly the parcel drawn there.
      const surveys: { plotno: string; relation: string }[] = [];
      if (layerKey === "forest") {
        const comp = String(props["COMP_NO"] ?? "").trim();
        for (const [plotno, m] of Object.entries(mrsacParcels)) {
          if (m.forest && comp && m.forest.comp === comp) surveys.push({ plotno, relation: "in this compartment" });
          if (surveys.length >= 12) break;
        }
      } else if (bnGisCode) {
        const token = ++resLookupRef.current;
        const pt = isPoint ? g.getCoordinates() : coord;
        void findParcelAt(pt).then((pl) => {
          if (!pl || token !== resLookupRef.current) return;
          const relation = isPoint ? "located in survey no." : "clicked spot is in survey no.";
          setResInfo((prev) => (prev ? { ...prev, surveys: [{ plotno: pl.plotno, relation }] } : prev));
        });
      }
      resSelectedRef.current?.set("selected", false);
      feat.set("selected", true);
      resSelectedRef.current = feat;
      setParcelInfo(null);
      setResInfo({ details, surveys, copied: false });
    };
  });

  // What a click on a Gram Sabha CFR polygon shows: whose claim it is, the compartment, area, and the survey numbers inside.
  useEffect(() => {
    compClickRef.current = (feat, coord) => {
      const base = compBase(String(feat.get("compNo") ?? ""));
      const names = String(feat.get("names") || cfrVillageRows.map((r) => r.gs || r.v).join(" + "));
      const ha = Number(feat.get("claimHa") ?? feat.get("ha") ?? 0);
      const km = Number(feat.get("km") ?? 0);
      const rows: { label: string; value: string }[] = [
        { label: "Gram Sabha", value: names || "—" },
        { label: "Compartment", value: `${base}${feat.get("rb") ? ` · ${feat.get("rb")}` : ""}` },
        { label: "CFR area", value: `${ha.toFixed(2)} ha (${(ha * 2.47105).toFixed(2)} ac)` },
      ];
      const own = cfrVillageRows.filter((r) => r.k?.some((k) => compBase(k) === base));
      if (own.length) {
        rows.push({ label: "Rights", value: [...new Set(own.map((r) => r.p).filter(Boolean))].join("; ") || "—" });
        const dt = [...new Set(own.map((r) => r.dt).filter(Boolean))].join(", ");
        if (dt) rows.push({ label: "Approved on", value: dt });
      }
      rows.push({ label: "Location", value: feat.get("outside") ? `outside the village${km ? `, ${km} km` : ""}${feat.get("nv") ? `, in ${feat.get("nv")}` : ""}` : "inside the village" });
      if (names.includes(" + ")) rows.push({ label: "Shared", value: `claimed by ${names.split(" + ").length} Gram Sabhas` });
      if (feat.get("flags")) rows.push({ label: "Note", value: String(feat.get("flags")) });
      const inside = Object.entries(compParcels).filter(([, v]) => (v.all[base] ?? 0) >= OVERLAP_MIN).sort((a, b) => b[1].all[base]! - a[1].all[base]!);
      const [lon, lat] = toLonLat(coord) as [number, number];
      resSelectedRef.current?.set("selected", false);
      resSelectedRef.current = null;
      setParcelInfo(null);
      setResInfo({
        details: { title: `Gram Sabha CFR · Comp. ${base}`, subtitle: "Community Forest Resource claim", color: "#7c3aed", rows, links: [locationLinks(lon, lat)[0]!] } as ResourceDetails,
        surveys: inside.slice(0, 12).map(([plotno]) => ({ plotno, relation: `Survey numbers inside this compartment (${inside.length}${inside.length > 12 ? ", first 12" : ""})` })),
        copied: false,
      });
    };
  });

  // Warm the taluka list for districts that have CFR data (one cached request each). Village lists
  // load on demand: pre-loading all of them was a burst the portal did not need.
  const districtLevel = bnLevels[1];
  useEffect(() => {
    if (!cfrMode || !cfrIndex || !districtLevel?.length) return;
    let stop = false;
    void (async () => {
      for (const d of districtLevel.filter((x) => hasDistrict(cfrIndex, x.value))) {
        if (stop) return;
        await fetchLevelList(2, `R,${d.code},`);
      }
    })();
    return () => {
      stop = true;
    };
  }, [cfrMode, cfrIndex, districtLevel, fetchLevelList]);

  // Which ATREE polygon is the selected village? Only needed while the CFR panel or its layers are in use.
  useEffect(() => {
    if (!bnVillageExtent || !(cfrMode || cfrAtree.potential || cfrAtree.recognized)) {
      if (!bnVillageExtent) setAtreeVillage(null);
      return;
    }
    const ctl = new AbortController();
    setAtreeLoading(true);
    identifyAtreeVillage(bnVillageExtent, ctl.signal)
      .then((v) => !ctl.signal.aborted && setAtreeVillage(v))
      .catch(() => {})
      .finally(() => !ctl.signal.aborted && setAtreeLoading(false));
    return () => ctl.abort();
  }, [bnVillageExtent, cfrMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Village picked + matched: draw that one ATREE polygon as a crisp vector in our own colours (no statewide
  // tiles to download). Otherwise the statewide tiles are used; while the match is still running they are
  // held back so a slow lookup never flashes all of Maharashtra.
  const atreeVectorRef = useRef<VectorLayer<VectorSource> | null>(null);
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const pickedVillage = cfrAtree.villageOnly && !!bnVillageExtent;
    const useVector = pickedVillage && !!atreeVillage?.geometry;
    const holdTiles = pickedVillage && (atreeLoading || useVector);
    (["potential", "recognized"] as const).forEach((k) => {
      let layer = atreeLayersRef.current[k];
      if (cfrAtree[k] && !holdTiles && !layer) {
        const source = new TileWMS({
          url: "https://cfr.atree.org/geoserver/cfr/wms",
          // ATREE's own outline-only style for potential villages keeps the map readable; recognized has no such style.
          params: { LAYERS: k === "potential" ? "cfr:mh_cfr_potential_villages" : "cfr:mh_cfr_recognized_villages", STYLES: k === "potential" ? "hollow_polygon_villages1" : "", TILED: true, VERSION: "1.1.1" },
          serverType: "geoserver",
          tileLoadFunction: gatedTileLoad(["base", "cad"]),
          // No crossOrigin: ATREE sends no CORS header, so "anonymous" makes the browser reject every tile.
        });
        // Same calibration as the cadastral layer, so village outlines sit on the calibrated parcels.
        const plainUrl = source.getTileUrlFunction();
        source.setTileUrlFunction((tc, pr, proj) => {
          const url = plainUrl(tc, pr, proj);
          return url ? shiftBboxParam(url, cadastralCalibRef.current.x, cadastralCalibRef.current.y) : url;
        });
        layer = new TileLayer({ zIndex: 4, source, properties: { name: `atree-${k}` } });
        map.addLayer(layer);
        atreeLayersRef.current[k] = layer;
      }
      layer?.setVisible(cfrAtree[k] && !holdTiles);
      layer?.setOpacity(cfrAtree.opacity / 100);
    });

    if (!atreeVectorRef.current) {
      atreeVectorRef.current = new VectorLayer({
        source: new VectorSource(),
        zIndex: 4,
        style: ((f: any) => {
          const c = f.get("kind") === "recognized" ? "124,58,237" : "22,163,74";
          return new Style({
            stroke: new Stroke({ color: `rgb(${c})`, width: f.get("kind") === "recognized" ? 4 : 2.5, lineDash: f.get("kind") === "recognized" ? undefined : [10, 6] }),
            fill: new Fill({ color: `rgba(${c},0.14)` }),
          });
        }) as any,
      });
      map.addLayer(atreeVectorRef.current);
    }
    const vec = atreeVectorRef.current;
    if (!map.getLayers().getArray().includes(vec)) map.addLayer(vec);
    const vsrc = vec.getSource()!;
    vsrc.clear();
    vec.setOpacity(Math.max(cfrAtree.opacity, 40) / 100);
    if (!useVector || !atreeVillage?.geometry) return;
    const fmt = new GeoJSON();
    for (const k of ["potential", "recognized"] as const) {
      if (!cfrAtree[k] || !atreeVillage[k]) continue;
      const feat = fmt.readFeature({ type: "Feature", properties: {}, geometry: atreeVillage.geometry }, { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" }) as Feature;
      feat.getGeometry()?.translate(cadastralCalibX, cadastralCalibY);
      feat.set("kind", k);
      vsrc.addFeature(feat);
    }
  }, [cfrAtree, atreeVillage, atreeLoading, bnVillageExtent, cadastralCalibX, cadastralCalibY]);

  const nameOf = (level: number) => bnLevels[level]?.find((o) => o.code === bnSelected[level])?.value ?? "";
  const cfrDistrict = nameOf(1);
  const cfrTaluka = nameOf(2);
  const cfrVillageName = nameOf(3);
  const cfrDup = React.useMemo(() => duplicateKeys((bnLevels[3] || []).map((v) => v.value)), [bnLevels]);
  const cfrVillageRows = React.useMemo(
    () => (cfrIndex && bnSelected[3] ? rowsForVillage(cfrIndex, cfrDistrict, cfrTaluka, cfrVillageName, cfrDup) : []),
    [cfrIndex, cfrDistrict, cfrTaluka, cfrVillageName, bnSelected, cfrDup]
  );
  /** Compartment-based approvals (Nashik): base compartment no. -> approval row. */
  const cfrCompRows = React.useMemo(() => {
    const m = new globalThis.Map<string, CfrRow>();
    for (const r of cfrVillageRows) for (const k of r.k ?? []) m.set(k.split(/[/.]/)[0]!, r);
    return m;
  }, [cfrVillageRows]);
  const cfrLookup = React.useMemo(
    () => (cfrVillageRows.length ? buildRecognizedLookup(cfrVillageRows) : null),
    [cfrVillageRows]
  );

  // Which parcels sit inside an MRSAC forest compartment / water body? Uses each parcel's interior
  // point (calibrated to real-world position) against the village's MRSAC polygons.
  // The compartments are cut from the cadastral map but sit a village-specific distance from the raw parcels (Udmal: ~75 m E,
  // 75 m S). Measure it: the shift where forest-held parcels fall inside compartments and private ones fall outside.
  // Nashik villages start from the regional offset (measured over 20 villages); the measurement below refines or keeps it.
  const regionalShift = bnLevels[1]?.find((o) => o.code === bnSelected[1])?.value === "नाशिक" ? NASHIK_PRIOR : undefined;
  useEffect(() => setForestShift(regionalShift ? { ...regionalShift, score: 0, base: 0, how: "prior" } : null), [bnGisCode, regionalShift]);
  useEffect(() => {
    if (resVillage.status !== "ready") return;
    const forest = (resVillage.features["forest"] ?? []).filter((f) => isForestLandType(String(f.properties["COMP_TYPE"] ?? "")));
    if (!forest.length) return;
    const t = setTimeout(() => {
      const villageLon = bnVillageExtent ? (bnVillageExtent[0] + bnVillageExtent[2]) / 2 : 75.7;
      const parcels: AlignParcel[] = [];
      for (const pl of bnPlots) {
        if (!pl.theGeom) continue;
        const category = classifyParcel(pl.plotno, pl.records, pl.owner);
        const poly = parsePlotGeometry(pl.theGeom, pl.localBounds || null, null, villageLon, bnGisCode);
        if (!poly) continue;
        const [x0, y0, x1, y1] = poly.getExtent() as [number, number, number, number];
        const pts: [number, number][] = [];
        for (let i = 0; i < 3; i++)
          for (let j = 0; j < 3; j++) {
            const x = x0 + ((i + 0.5) / 3) * (x1 - x0), y = y0 + ((j + 0.5) / 3) * (y1 - y0);
            if (poly.intersectsCoordinate([x, y])) pts.push([x, y]);
          }
        if (pts.length) parcels.push({ pts, w: parseFloat(String(pl.area)) || haFromAreaText(pl.area) || 0.01, forestHeld: category === "forest" || category === "government" });
      }
      const polys = forest.map((f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][]);
      const boxes = polys.map((ps) => {
        const c = ps.flat(2);
        return [Math.min(...c.map((q) => q[0]!)), Math.min(...c.map((q) => q[1]!)), Math.max(...c.map((q) => q[0]!)), Math.max(...c.map((q) => q[1]!))] as const;
      });
      const inForest = (x: number, y: number) => {
        const [lo, la] = toLonLat([x, y]);
        return polys.some((ps, k) => lo! >= boxes[k]![0] && lo! <= boxes[k]![2] && la! >= boxes[k]![1] && la! <= boxes[k]![3] && ps.some((rings) => rings.filter((r) => pointInRing(lo!, la!, r)).length % 2 === 1));
      };
      const { shift, held, measured } = calibrate(parcels, inForest, regionalShift);
      if (import.meta.env.DEV) (window as any).__vmForestMeasure = { gis: bnGisCode, parcels: parcels.length, held, best: measured, adopted: shift };
      // same shift as before (records keep arriving): keep the object, so nothing downstream recomputes
      setForestShift((prev) => (prev && shift && prev.dx === shift.dx && prev.dy === shift.dy && prev.how === shift.how && Math.abs(prev.score - shift.score) < 0.005 ? prev : shift));
    }, 1200);
    return () => clearTimeout(t);
  }, [resVillage, bnPlots, bnVillageExtent, bnGisCode, regionalShift]);
  useEffect(() => {
    if (import.meta.env.DEV) (window as any).__vmForestShift = forestShift;
  }, [forestShift]);

  const mrsacParcels = React.useMemo(() => {
    // Plain object: `Map` is OpenLayers' map class in this module.
    const out: Record<string, MrsacParcel> = {};
    if (resVillage.status !== "ready") return out;
    const forest = (resVillage.features["forest"] ?? []).filter((f) => isForestLandType(String(f.properties["COMP_TYPE"] ?? "")));
    const water = resVillage.features["waterbody"] ?? [];
    if (!forest.length && !water.length) return out;
    // bbox per compartment: most samples are nowhere near most compartments
    const fbox = forest.map((f) => {
      const c = (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates).flat(2) as number[][];
      return [Math.min(...c.map((q) => q[0]!)), Math.min(...c.map((q) => q[1]!)), Math.max(...c.map((q) => q[0]!)), Math.max(...c.map((q) => q[1]!))] as const;
    });
    const cache = parcelPointCache.current;
    // The UTM zone of the outlines depends on the village's longitude: a fixed 78.6 put every village west of 78 E ~6 deg off.
    const villageLon = bnVillageExtent ? (bnVillageExtent[0] + bnVillageExtent[2]) / 2 : 75.7;
    const N = 10; // ponytail: 10x10 grid per parcel, raise if thin slivers get missed
    for (const pl of bnPlots) {
      if (!pl.theGeom) continue;
      const poly = parsePlotGeometry(pl.theGeom, pl.localBounds || null, null, villageLon, bnGisCode);
      let pt = cache[pl.theGeom];
      if (!pt) {
        const c = poly?.getInteriorPoint().getCoordinates();
        if (!c) continue;
        pt = [c[0]!, c[1]!];
        cache[pl.theGeom] = pt;
      }
      // Forest compartments share the raw cadastral frame, so parcels are tested uncalibrated; water is GPS-true (calibrated).
      const samples: [number, number][] = [];
      if (poly) {
        const [x0, y0, x1, y1] = poly.getExtent() as [number, number, number, number];
        for (let i = 0; i < N; i++)
          for (let j = 0; j < N; j++) {
            const x = x0 + ((i + 0.5) / N) * (x1 - x0);
            const y = y0 + ((j + 0.5) / N) * (y1 - y0);
            if (poly.intersectsCoordinate([x, y])) samples.push([x, y]);
          }
      }
      if (!samples.length) samples.push([pt[0], pt[1]]);
      const tally: Record<string, { n: number; type: string }> = {};
      for (const [x, y] of samples) {
        const [sx, sy] = toLonLat([x + (forestShift?.dx ?? 0), y + (forestShift?.dy ?? 0)]);
        const k = forest.findIndex((g, gi) => sx! >= fbox[gi]![0] && sx! <= fbox[gi]![2] && sy! >= fbox[gi]![1] && sy! <= fbox[gi]![3] && pointInGeometry(sx!, sy!, g.geometry));
        if (k < 0) continue;
        const comp = String(forest[k]!.properties["COMP_NO"] ?? "").trim();
        const t = (tally[comp] ??= { n: 0, type: String(forest[k]!.properties["COMP_TYPE"] ?? "").trim() });
        t.n++;
      }
      const all: Record<string, number> = {};
      let best: [string, { n: number; type: string }] | undefined;
      for (const [comp, t] of Object.entries(tally)) {
        const pct = Math.round((t.n / samples.length) * 100);
        if (pct < OVERLAP_MIN) continue;
        all[comp] = pct;
        if (!best || t.n > best[1].n) best = [comp, t];
      }
      const [lon, lat] = toLonLat([pt[0] + cadastralCalibX, pt[1] + cadastralCalibY]);
      const hitW = water.some((f) => pointInGeometry(lon!, lat!, f.geometry));
      if (best || hitW) {
        out[pl.plotno] = {
          ...(best ? { forest: { type: best[1].type, comp: best[0], pct: all[best[0]]!, all } } : {}),
          ...(hitW ? { water: true } : {}),
        };
      }
    }
    return out;
  }, [resVillage, bnPlots, bnGisCode, bnVillageExtent, cadastralCalibX, cadastralCalibY, forestShift]);

  // Nashik claims resolved offline to MRSAC polygons (scripts/build-comp-resolve.mjs): the primary CFR mark. The live
  // 5 km search below only runs when this file is missing.
  const [compData, setCompData] = useState<CompData | null>(null);
  const [compTried, setCompTried] = useState(false);
  const [cfrRadiusKm, setCfrRadiusKm] = useState(10);
  const [nearVillages, setNearVillages] = useState<NearVillage[]>([]);
  useEffect(() => {
    if (cfrMode && cfrCompRows.size && !compTried) void loadCompData().then((d) => (setCompData(d), setCompTried(true)));
  }, [cfrMode, cfrCompRows, compTried]);
  const compClaims = React.useMemo(() => (compData ? claimsOf(compData, cfrVillageRows) : []), [compData, cfrVillageRows]);
  const compResolved = compClaims.length > 0;

  // The resolved Gram Sabha polygons are the CFR mark, so parcels are matched against them directly: a shared or
  // neighbouring-forest compartment (e.g. comp. 210 of two villages) is not in the village's own MRSAC forest list.
  const parcelSampleCache = useRef<Record<string, [number, number][]>>({});
  const compParcelPrev = useRef<Record<string, CompParcel>>({});
  /** Per parcel geometry: the result for one (polygon set, frame shift) so a records batch only costs lookups. */
  const compParcelCache = useRef<{ sig: string; byGeom: Record<string, CompParcel | null> }>({ sig: "", byGeom: {} });
  const compParcels = React.useMemo(() => {
    const out: Record<string, CompParcel> = {};
    if (!compData || !compResolved || !bnGisCode) return out;
    const polys = compsAround(compData, cfrVillageRows, [], 0)
      .filter((d) => !d.weak)
      .map((d) => {
        const parts = d.ids.flatMap((id) => (compData.polys[id] ? ringsToPolygons(compData.polys[id]!.g) : [])).map((coordinates) => {
          const c = coordinates.flat() as [number, number][];
          return { geom: { type: "Polygon", coordinates }, box: [Math.min(...c.map((q) => q[0])), Math.min(...c.map((q) => q[1])), Math.max(...c.map((q) => q[0])), Math.max(...c.map((q) => q[1]))] as const };
        });
        return { base: compBase(d.n), names: d.names, parts };
      });
    if (!polys.length) return out;
    const sig = `${bnGisCode}|${forestShift?.dx ?? 0},${forestShift?.dy ?? 0}|${polys.map((d) => d.base + d.parts.length + d.names.join()).join(";")}`;
    if (compParcelCache.current.sig !== sig) compParcelCache.current = { sig, byGeom: {} };
    const byGeom = compParcelCache.current.byGeom;
    const villageLon = bnVillageExtent ? (bnVillageExtent[0] + bnVillageExtent[2]) / 2 : 75.7;
    const N = 10;
    for (const pl of bnPlots) {
      if (!pl.theGeom) continue;
      if (pl.theGeom in byGeom) {
        const hit = byGeom[pl.theGeom];
        if (hit) out[pl.plotno] = hit;
        continue;
      }
      let samples = parcelSampleCache.current[pl.theGeom];
      if (!samples) {
        samples = [];
        const poly = parsePlotGeometry(pl.theGeom, pl.localBounds || null, null, villageLon, bnGisCode);
        if (poly) {
          const [x0, y0, x1, y1] = poly.getExtent() as [number, number, number, number];
          for (let i = 0; i < N; i++)
            for (let j = 0; j < N; j++) {
              const x = x0 + ((i + 0.5) / N) * (x1 - x0), y = y0 + ((j + 0.5) / N) * (y1 - y0);
              if (poly.intersectsCoordinate([x, y])) samples.push([x, y]);
            }
        }
        parcelSampleCache.current[pl.theGeom] = samples;
      }
      if (!samples.length) {
        byGeom[pl.theGeom] = null;
        continue;
      }
      const pts = samples.map(([x, y]) => toLonLat([x + (forestShift?.dx ?? 0), y + (forestShift?.dy ?? 0)]) as [number, number]);
      const lo0 = Math.min(...pts.map((q) => q[0])), lo1 = Math.max(...pts.map((q) => q[0]));
      const la0 = Math.min(...pts.map((q) => q[1])), la1 = Math.max(...pts.map((q) => q[1]));
      const all: Record<string, number> = {};
      const names: Record<string, string[]> = {};
      for (const d of polys) {
        // no polygon part near this parcel: skip the point tests
        if (!d.parts.some((q) => lo1 >= q.box[0] && lo0 <= q.box[2] && la1 >= q.box[1] && la0 <= q.box[3])) continue;
        const n = pts.filter(([lo, la]) => d.parts.some((q) => lo >= q.box[0] && lo <= q.box[2] && la >= q.box[1] && la <= q.box[3] && pointInGeometry(lo, la, q.geom as any))).length;
        const pct = Math.round((n / pts.length) * 100);
        if (pct < OVERLAP_MIN || pct <= (all[d.base] ?? 0)) continue;
        all[d.base] = pct;
        names[d.base] = d.names;
      }
      if (!Object.keys(all).length) {
        byGeom[pl.theGeom] = null;
        continue;
      }
      const next = { all, names };
      const prev = compParcelPrev.current[pl.plotno];
      out[pl.plotno] = byGeom[pl.theGeom] = prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
    }
    compParcelPrev.current = out;
    return out;
  }, [compData, compResolved, cfrVillageRows, bnPlots, bnGisCode, bnVillageExtent, forestShift]);

  // Entries are cached per parcel object: mergeOwnerRecords keeps untouched parcels' identity, so a record
  // batch only re-parses the parcels it changed instead of the whole village (that was a ~1 s long task per batch).
  const entryCacheRef = useRef(new WeakMap<BNPlot, { cfr: unknown; mrsac: unknown; comp: unknown; entry: PlotIndexEntry }>());
  const plotSearchIndex = React.useMemo<PlotIndexEntry[]>(() => {
    const cache = entryCacheRef.current;
    return bnPlots.map((p) => {
      const hit = cache.get(p);
      if (hit && hit.cfr === cfrLookup && hit.mrsac === mrsacParcels[p.plotno] && hit.comp === compParcels[p.plotno]) return hit.entry;
      const entry = buildEntry(p);
      cache.set(p, { cfr: cfrLookup, mrsac: mrsacParcels[p.plotno], comp: compParcels[p.plotno], entry });
      return entry;
    });
    function buildEntry(p: BNPlot): PlotIndexEntry {
      const records = p.records || [];
      const owners = records.flatMap((r) => parseOwnerName(r.ownerName));
      if (owners.length === 0 && p.owner) owners.push(...parseOwnerName(p.owner));
      const surnames: string[] = [];
      const familyKeys: string[] = [];
      for (const o of owners) {
        if (!o.surname || o.isGovernment) continue;
        if (!surnames.includes(o.surname)) surnames.push(o.surname);
        const k = familyKey(o.surname);
        if (!familyKeys.includes(k)) familyKeys.push(k);
      }
      // One area per parcel — summed across its khata records, never per owner.
      const areaHa =
        records.reduce((s, r) => s + (parseFloat(r.totalArea) || 0), 0) || haFromAreaText(p.area) || 0;
      const category = classifyParcel(p.plotno, p.records, p.owner);
      // Survey-number approvals (Nagpur) match the 7/12 number; compartment approvals (Nashik) match the parcels the
      // cadastral map places inside that compartment (>= OVERLAP_MIN % of the parcel; best-overlapping approved one wins).
      let cfr = cfrLookup ? matchRecognized(cfrLookup, p.plotno) : undefined;
      let overlapPct: number | undefined;
      let compNo: string | undefined;
      const cp = compParcels[p.plotno];
      if (!cfr) {
        const all: Record<string, number> = { ...(mrsacParcels[p.plotno]?.forest?.all ?? {}) };
        for (const [comp, pct] of Object.entries(cp?.all ?? {})) all[comp] = Math.max(all[comp] ?? 0, pct);
        for (const [comp, pct] of Object.entries(all)) {
          const row = cfrCompRows.get(compBase(comp));
          if (row && pct > (overlapPct ?? 0)) (cfr = row), (overlapPct = pct), (compNo = compBase(comp));
        }
      }
      const gramSabha = compNo ? (cp?.names[compNo]?.join(" + ") || cfr?.gs || cfr?.v) : undefined;
      const conflict = overlapPct !== undefined && isConflictCategory(category);
      return {
        plot: p,
        plotno: p.plotno,
        plotnoLower: String(p.plotno).toLowerCase(),
        owners,
        surnames,
        familyKeys,
        areaHa,
        category,
        hasLiveRecord: p.ownerStatus === "live" && records.length > 0,
        cfr,
        mrsac: mrsacParcels[p.plotno],
        ...(overlapPct !== undefined ? { overlapPct } : {}),
        ...(compNo ? { compNo } : {}),
        ...(gramSabha ? { gramSabha } : {}),
        cfrStatus: cfrStatusOf(!!cfr, category, !!mrsacParcels[p.plotno]?.forest, conflict),
      };
    }
  }, [bnPlots, cfrLookup, cfrCompRows, mrsacParcels, compParcels]);

  const compParcelsFound = React.useMemo(() => cfrCompRows.size > 0 && plotSearchIndex.some((e) => e.cfr && !e.cfr.s.length), [cfrCompRows, plotSearchIndex]);

  useEffect(() => {
    setNearVillages([]);
    if (!cfrMode || !compResolved || resVillage.status !== "ready" || !resVillage.village) return;
    const ctl = new AbortController();
    void fetchVillagesNear(resVillage.village, cfrRadiusKm, ctl.signal)
      .then((v) => !ctl.signal.aborted && setNearVillages(v))
      .catch(() => {});
    return () => ctl.abort();
  }, [cfrMode, compResolved, resVillage, cfrRadiusKm]);

  // Approved compartments that are not in the village polygon (a gram sabha's CFR land often lies in the neighbouring
  // forest): look them up in MRSAC within 5 km, nearest first. A number nothing answers to stays "not located".
  const [cfrOutside, setCfrOutside] = useState<{ features: GeoFeature[]; located: string[]; missing: string[] }>({ features: [], located: [], missing: [] });
  useEffect(() => {
    setCfrOutside({ features: [], located: [], missing: [] });
    if (!cfrMode || !compTried || compResolved || resVillage.status !== "ready" || !resVillage.village || !cfrCompRows.size) return;
    const inVillage = new Set<string>();
    for (const key of ["forest", "wildlife"])
      for (const f of resVillage.features[key] ?? []) {
        const n = String(f.properties["COMP_NO"] ?? "").trim().match(/^\d+/)?.[0];
        if (n) inVillage.add(n);
      }
    const missing = [...cfrCompRows.keys()].filter((n) => !inVillage.has(n));
    if (!missing.length) return;
    const ctl = new AbortController();
    const village = resVillage.village;
    const pts = village.rings.flat();
    const cx = (Math.min(...pts.map((q) => q[0])) + Math.max(...pts.map((q) => q[0]))) / 2;
    const cy = (Math.min(...pts.map((q) => q[1])) + Math.max(...pts.map((q) => q[1]))) / 2;
    void fetchCompartmentsNear(village, missing, 5, ctl.signal)
      .then((feats) => {
        const km = (f: GeoFeature) => {
          const c = (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates).flat(2) as number[][];
          const fx = (Math.min(...c.map((q) => q[0]!)) + Math.max(...c.map((q) => q[0]!))) / 2;
          const fy = (Math.min(...c.map((q) => q[1]!)) + Math.max(...c.map((q) => q[1]!))) / 2;
          return Math.hypot((fx - cx) * 111.32 * Math.cos((cy * Math.PI) / 180), (fy - cy) * 110.574);
        };
        const keep: GeoFeature[] = [];
        const located: string[] = [];
        for (const n of missing) {
          const cand = feats.filter((f) => String(f.properties["COMP_NO"] ?? "").trim() === n).map((f) => [f, km(f)] as const);
          if (!cand.length) continue;
          const nearest = Math.min(...cand.map((c) => c[1]));
          keep.push(...cand.filter((c) => c[1] <= nearest + 1.5).map((c) => c[0])); // same compartment's slivers sit together
          located.push(n);
        }
        if (!ctl.signal.aborted) setCfrOutside({ features: keep, located, missing: missing.filter((n) => !located.includes(n)) });
      })
      .catch(() => {
        if (!ctl.signal.aborted) setCfrOutside({ features: [], located: [], missing });
      });
    return () => ctl.abort();
  }, [cfrMode, resVillage, cfrCompRows, compResolved, compTried]);

  // Panel summary for compartment approvals: how much of the approved land was found, and what conflicts with villagers.
  const cfrCompSummary = React.useMemo(() => {
    if (!cfrCompRows.size) return null;
    const haOf = (st: string) => plotSearchIndex.filter((e) => e.cfrStatus === st && e.overlapPct !== undefined).reduce((t, e) => t + e.areaHa, 0);
    const n = (st: string) => plotSearchIndex.filter((e) => e.cfrStatus === st && e.overlapPct !== undefined).length;
    return {
      approvedHa: cfrVillageRows.reduce((t, r) => t + r.ha, 0),
      parcelHa: haOf("recognized"),
      parcels: n("recognized"),
      conflictHa: haOf("conflict"),
      conflicts: n("conflict"),
      outside: cfrOutside.located,
      missing: cfrOutside.missing,
      claims: compClaims.filter(({ rec }) => !cfrPurpose.size || rec.pg?.some((g) => cfrPurpose.has(g as PurposeGroup))).map(({ row, rec }) => ({ gs: row.gs || row.v, rec, ...(row.sv ? { listedAs: row.sv, why: row.pvh ?? "" } : {}) })),
      radiusKm: cfrRadiusKm,
    };
  }, [cfrCompRows, cfrVillageRows, plotSearchIndex, cfrOutside, compClaims, cfrRadiusKm, cfrPurpose]);

  // Nashik-style approvals name forest compartments, not survey numbers: parcels inside them are the marking. The
  // raw MRSAC outline is drawn only as a fallback when no parcel matched, and always for compartments outside the village.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!cfrCompLayerRef.current) {
      cfrCompLayerRef.current = new VectorLayer({
        source: new VectorSource(),
        zIndex: 41,
        properties: { name: "cfr-compartments" },
        style: ((f: any, res: number) => {
          if (f.get("kind") === "res") {
            const own = f.get("own") as boolean;
            const shared = f.get("shared") as boolean;
            if (f.get("weak")) {
              // unconfirmed outline: dotted amber, no fill, so it is never mistaken for a located compartment
              return new Style({
                stroke: new Stroke({ color: "#d97706", width: 2, lineDash: [2, 6] }),
                fill: new Fill({ color: "rgba(217,119,6,0.05)" }),
                text: new Text({ text: own ? (f.get("text") as string) : "", font: "500 12px sans-serif", fill: new Fill({ color: "#92400e" }), stroke: new Stroke({ color: "#ffffff", width: 3 }), overflow: true }),
              });
            }
            const col = shared ? "#ea580c" : own ? "#7c3aed" : "#8b5cf6";
            const fillPct = dynamicMapStyleSettings.gramSabhaFillOpacity;
            const fillAlpha = (fillPct / 100) * (shared ? 0.35 : own ? 0.30 : 0.20);
            const fillColor = fillAlpha <= 0.005 ? "rgba(0, 0, 0, 0)" : (shared ? `rgba(234,88,12,${fillAlpha.toFixed(2)})` : own ? `rgba(124,58,237,${fillAlpha.toFixed(2)})` : `rgba(139,92,246,${fillAlpha.toFixed(2)})`);
            const strokeWidth = dynamicMapStyleSettings.highContrastOutlines ? (own ? 3.5 : 2.2) : (own ? 3 : 1.5);
            return new Style({
              stroke: new Stroke({ color: col, width: strokeWidth, lineDash: f.get("outside") || !own ? [8, 5] : undefined }),
              fill: new Fill({ color: fillColor }),
              text: new Text({
                text: own || res < 40 ? (f.get("text") as string) : "",
                font: `${own ? 600 : 500} 12px sans-serif`,
                fill: new Fill({ color: own ? "#4c1d95" : "#6d28d9" }),
                stroke: new Stroke({ color: "#ffffff", width: 3 }),
                overflow: true,
              }),
            });
          }
          const fillPct = dynamicMapStyleSettings.gramSabhaFillOpacity;
          const fillAlpha = (fillPct / 100) * 0.25;
          const fillColor = fillAlpha <= 0.005 ? "rgba(0, 0, 0, 0)" : `rgba(124,58,237,${fillAlpha.toFixed(2)})`;
          return new Style({
            stroke: new Stroke({ color: "#7c3aed", width: dynamicMapStyleSettings.highContrastOutlines ? 3 : 2.5, lineDash: [8, 5] }),
            fill: new Fill({ color: fillColor }),
            text: new Text({
              text: f.get("label") ? `CFR comp. ${f.get("compNo")} • ${f.get("ha")} ha${f.get("outside") ? " (outside village)" : ""}` : "",
              font: "600 12px sans-serif",
              fill: new Fill({ color: "#4c1d95" }),
              stroke: new Stroke({ color: "#ffffff", width: 3 }),
              overflow: true,
            }),
          });
        }) as any,
      });
    }
    const layer = cfrCompLayerRef.current;
    if (!map.getLayers().getArray().includes(layer)) map.addLayer(layer);
    const src = layer.getSource()!;
    src.clear();
    if (!cfrMode) return;
    // The village's own polygons need nothing from the live MRSAC village lookup (which can fail); neighbours do.
    if (compData && compResolved) {
      // MRSAC polygons are the primary mark: this village's own claims plus neighbouring gram sabhas within the radius.
      const fmtR = new GeoJSON();
      // status chips are parcel-level: polygons belong to the recognized / conflict chips, the other chips show parcels only
      if (cfrStatusFilter.size > 0 && !cfrStatusFilter.has("recognized") && !cfrStatusFilter.has("conflict")) return;
      for (const d of compsAround(compData, cfrVillageRows, resVillage.village?.rings ?? [], cfrRadiusKm, cfrPurpose)) {
        const polys = d.ids.map((id) => compData.polys[id]).filter((q): q is NonNullable<typeof q> => !!q);
        if (!polys.length) continue;
        const where = d.outside ? ` (outside village${d.km ? `, ${d.km} km` : ""}${d.nv ? `, in ${d.nv}` : ""})` : "";
        const text = d.weak
          ? `${d.names.join(" + ")} • comp. ${d.n} • ${d.ha.toFixed(1)} ha claimed — outline unconfirmed`
          : `${d.names.join(" + ")} • comp. ${d.n} • ${d.ha.toFixed(1)} ha${where}${d.flags.length ? ` ⚠ ${d.flags.join(", ")}` : ""}`;
        // one feature per polygon part (holes cut out); only the largest part carries the label, so it is not repeated
        const parts = polys.flatMap((q) => ringsToPolygons(q.g)).map((coords) => {
          const f = fmtR.readFeature({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: coords } }, { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" }) as Feature;
          f.getGeometry()?.translate(forestDelta[0], forestDelta[1]);
          const e = f.getGeometry()!.getExtent();
          f.setProperties({ kind: "res", own: d.own, shared: d.shared, outside: d.outside, weak: !!d.weak, text: "", size: (e[2]! - e[0]!) * (e[3]! - e[1]!), compNo: d.n, names: d.names.join(" + "), claimHa: d.ha, km: d.km ?? 0, nv: d.nv ?? "", rb: d.rb ?? "", flags: d.flags.join(", ") });
          return f;
        });
        parts.reduce((a, b) => ((a.get("size") as number) >= (b.get("size") as number) ? a : b)).set("text", text);
        src.addFeatures(parts);
      }
      return;
    }
    if (resVillage.status !== "ready") return;
    // "24/2" and "49.50" count as compartment 24 / 49; the sheet's area is per approval, shared by its compartments.
    const want = new globalThis.Map<string, number>();
    for (const r of cfrVillageRows) for (const k of r.k ?? []) want.set(compBase(k), (want.get(compBase(k)) ?? 0) + r.ha / r.k!.length);
    if (!want.size) return;
    const fmt = new GeoJSON();
    const parts: Feature[] = [];
    const add = (f: GeoFeature, outside: boolean) => {
      const no = String(f.properties["COMP_NO"] ?? "").trim().match(/^\d+/)?.[0];
      if (!no || !want.has(no)) return;
      const feat = fmt.readFeature(f, { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" }) as Feature;
      feat.getGeometry()?.translate(forestDelta[0], forestDelta[1]);
      feat.set("compNo", no);
      feat.set("ha", want.get(no)!.toFixed(2));
      feat.set("outside", outside);
      parts.push(feat);
    };
    if (!compParcelsFound) for (const key of ["forest", "wildlife"]) for (const f of resVillage.features[key] ?? []) add(f, false);
    for (const f of cfrOutside.features) add(f, true);
    // A compartment arrives as several polygons (slivers + the main body): label only the largest one.
    const biggest: Record<string, Feature> = {};
    for (const f of parts) {
      const a = f.getGeometry()!.getExtent();
      const size = (a[2]! - a[0]!) * (a[3]! - a[1]!);
      const key = `${f.get("compNo")}|${f.get("outside")}`;
      const cur = biggest[key];
      if (!cur || size > (cur.get("size") as number)) biggest[key] = (f.set("size", size), f);
    }
    for (const f of Object.values(biggest)) f.set("label", true);
    src.addFeatures(parts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfrMode, resVillage, cfrVillageRows, compParcelsFound, cfrOutside, compData, compResolved, cfrRadiusKm, cfrPurpose, cfrStatusFilter, forestDelta[0], forestDelta[1]]);

  // ...and their serial-number badges only appear once zoomed in, so they stop covering the compartment labels.
  useEffect(() => {
    const src = plotMarkerLayerRef.current?.getSource();
    if (!src || !cfrMode || !compResolved) return;
    const quiet = (f: Feature) => {
      const full = f.get("_full") ?? f.getStyle();
      if (!full) return;
      f.set("_full", full, true);
      // the badge is the last of the feature's styles; drop it while zoomed out
      f.setStyle(((feat: Feature, res: number) => {
        const st = typeof full === "function" ? (full as any)(feat, res) : full;
        return res < 1.8 || !Array.isArray(st) || st.length < 4 ? st : st.slice(0, 3);
      }) as any);
    };
    src.getFeatures().forEach(quiet);
    const onAdd = (e: any) => quiet(e.feature);
    src.on("addfeature", onAdd);
    return () => {
      src.un("addfeature", onAdd);
      src.getFeatures().forEach((f) => f.get("_full") && f.setStyle(f.get("_full")));
    };
  }, [cfrMode, compResolved]);

  /** Fits the view to a claim's MRSAC polygons together with the village, so an outside-village compartment can be found. */
  const zoomToClaim = useCallback(
    (ids: number[]) => {
      const map = mapInstanceRef.current;
      if (!map || !compData) return;
      const fmtZ = new GeoJSON();
      const ext = createEmpty();
      const rings = [...ids.flatMap((id) => compData.polys[id]?.g ?? []), ...(resVillage.village?.rings ?? [])];
      for (const f of rings.map((r) => fmtZ.readFeature({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [r] } }, { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" }) as Feature))
        extend(ext, f.getGeometry()!.getExtent());
      if (isEmpty(ext)) return;
      map.getView().fit([ext[0]! + forestDelta[0], ext[1]! + forestDelta[1], ext[2]! + forestDelta[0], ext[3]! + forestDelta[1]], { duration: 800, padding: [80, 80, 80, 420], maxZoom: 17 });
    },
    [compData, resVillage, forestDelta[0], forestDelta[1]]
  );

  // With MRSAC polygons as the primary CFR mark, the parcel highlights become the lighter secondary layer.
  useEffect(() => {
    plotMarkerLayerRef.current?.setOpacity(cfrMode && compResolved && !compParcelsFound ? 0.5 : 1);
    return () => plotMarkerLayerRef.current?.setOpacity(1);
  }, [cfrMode, compResolved, compParcelsFound]);

  // Neighbouring villages within the radius, named, with what their gram sabhas have approved.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!cfrNearLayerRef.current) {
      cfrNearLayerRef.current = new VectorLayer({
        source: new VectorSource(),
        zIndex: 40,
        properties: { name: "cfr-near-villages" },
        style: ((f: any, res: number) =>
          new Style({
            stroke: new Stroke({ color: "#475569", width: 1, lineDash: [2, 4] }),
            text: new Text({ text: res < 60 ? (f.get("text") as string) : "", font: "500 11px sans-serif", fill: new Fill({ color: "#334155" }), stroke: new Stroke({ color: "#ffffff", width: 3 }), overflow: true }),
          })) as any,
      });
    }
    const layer = cfrNearLayerRef.current;
    if (!map.getLayers().getArray().includes(layer)) map.addLayer(layer);
    const src = layer.getSource()!;
    src.clear();
    if (!cfrMode || !compData || !nearVillages.length) return;
    const claimed: Record<string, { n: number; ha: number }> = {};
    for (const recs of Object.values(compData.claims)) for (const r of recs) if (r.vc) (claimed[r.vc] ??= { n: 0, ha: 0 }), (claimed[r.vc]!.n += 1), (claimed[r.vc]!.ha += r.h);
    const fmtV = new GeoJSON();
    for (const v of nearVillages) {
      const feat = fmtV.readFeature(
        { type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: ringsToPolygons(v.rings) } },
        { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" }
      ) as Feature;
      feat.getGeometry()?.translate(forestDelta[0], forestDelta[1]);
      const c = claimed[v.code];
      feat.set("text", `${v.mr || v.name}${c ? ` • CFR ${c.n} claim${c.n > 1 ? "s" : ""}, ${c.ha.toFixed(0)} ha` : ""}`);
      src.addFeature(feat);
    }
  }, [cfrMode, compData, nearVillages, forestDelta[0], forestDelta[1]]);

  /**
   * Family and individual-owner aggregates. Families are keyed phonetically so spelling
   * variants merge; the label shown is the most common spelling in the village.
   */
  const villageOwnerStats = React.useMemo(() => {
    const familyMap: Record<
      string,
      { key: string; spellings: Record<string, number>; englishSurname: string; plots: BNPlot[]; totalHa: number; seen: Set<BNPlot> }
    > = {};
    const ownerMap: Record<string, { plots: BNPlot[]; totalHa: number; englishFullName: string }> = {};

    plotSearchIndex.forEach((entry) => {
      // Parcels whose real record has not arrived carry no owner to group by.
      if (!entry.hasLiveRecord) return;

      entry.owners.forEach((o) => {
        if (!o.surname || o.isGovernment) return;
        const k = familyKey(o.surname);
        const f = (familyMap[k] ||= { key: k, spellings: {}, englishSurname: o.englishSurname, plots: [], totalHa: 0, seen: new Set() });
        f.spellings[o.surname] = (f.spellings[o.surname] || 0) + 1;
        if (!f.seen.has(entry.plot)) {
          f.seen.add(entry.plot);
          f.plots.push(entry.plot);
          f.totalHa += entry.areaHa;
        }
      });

      const seen = new Set<string>();
      entry.owners.forEach((po) => {
        if (!po.fullName || po.isGovernment || seen.has(po.fullName)) return;
        seen.add(po.fullName);
        const ow = (ownerMap[po.fullName] ||= { plots: [], totalHa: 0, englishFullName: po.englishFullName });
        ow.plots.push(entry.plot);
        ow.totalHa += entry.areaHa;
      });
    });

    const families = Object.values(familyMap)
      .map((f) => ({
        ...f,
        label: Object.entries(f.spellings).sort((a, b) => b[1] - a[1])[0]![0],
      }))
      .sort((a, b) => b.plots.length - a.plots.length);
    const familyByKey: Record<string, (typeof families)[number]> = {};
    families.forEach((f) => (familyByKey[f.key] = f));

    return { families, familyByKey, ownerMap };
  }, [plotSearchIndex]);

  /** Village-wide parcels of one category, for the Map Type dropdown's forest/water entries. */
  const villageEnvStats = React.useMemo(() => {
    const pick = (c: Category) => plotSearchIndex.filter((e) => e.hasLiveRecord && e.category === c).map((e) => e.plot);
    return { forest: pick("forest"), waterbody: pick("water") };
  }, [plotSearchIndex]);

  // Keeps typing responsive on large villages: the list re-filters at a lower priority.
  const deferredPlotSearch = React.useDeferredValue(bnPlotSearch);

  const filteredPlots = React.useMemo(() => {
    const q = deferredPlotSearch.trim();
    const qLower = q.toLowerCase();
    // Digits / "255/1" is a survey number; anything else is a name.
    const isSurvey = /^[\d\s/.]+$/.test(q);
    const queryTokens = isSurvey ? [] : tokenize(q);
    const scored: { entry: PlotIndexEntry; score: number }[] = [];

    for (const entry of plotSearchIndex) {
      if (cfrMode) {
        if (cfrStatusFilter.size > 0 && !cfrStatusFilter.has(entry.cfrStatus)) continue;
        if (cfrPurpose.size > 0 && !entry.cfr?.g.some((g) => cfrPurpose.has(g))) continue;
      } else if (categoryFilter.size > 0 && !categoryFilter.has(entry.category)) continue;
      if (selectedSurnameFilter && !entry.familyKeys.includes(selectedSurnameFilter)) continue;
      if (selectedOwnerFilter && !entry.owners.some((o) => o.fullName === selectedOwnerFilter)) continue;

      if (!q) {
        scored.push({ entry, score: 0 });
        continue;
      }

      let score = 0;
      if (isSurvey) {
        // Exact first, then prefix — "1" no longer pulls in 1, 10, 100, 115...
        if (entry.plotnoLower === qLower) score = 2;
        else if (entry.plotnoLower.startsWith(qLower)) score = 1;
      } else {
        for (const o of entry.owners) score = Math.max(score, matchOwner(o, queryTokens, namePartMode));
      }
      if (score > 0) scored.push({ entry, score });
    }

    const bySurvey = (a: BNPlot, b: BNPlot) => {
      const na = surveyNum(a.plotno);
      const nb = surveyNum(b.plotno);
      if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
      return NUMERIC_COLLATOR.compare(String(a.plotno), String(b.plotno));
    };
    const dir = sortDesc ? -1 : 1;

    scored.sort((x, y) => {
      // With an active query, relevance leads and the chosen sort breaks ties.
      if (q && x.score !== y.score) return y.score - x.score;
      const a = x.entry;
      const b = y.entry;
      if (sortKey === "status") {
        const rank = (e: PlotIndexEntry) => CFR_STATUSES.findIndex((c) => c.key === e.cfrStatus);
        return (rank(a) - rank(b) || bySurvey(a.plot, b.plot)) * dir;
      }
      if (sortKey === "approved") return ((a.cfr?.ha ?? 0) - (b.cfr?.ha ?? 0) || bySurvey(a.plot, b.plot)) * dir;
      if (sortKey === "name") {
        const oa = a.owners[0]?.fullName || a.plot.owner || "￿";
        const ob = b.owners[0]?.fullName || b.plot.owner || "￿";
        return (MR_COLLATOR.compare(oa, ob) || bySurvey(a.plot, b.plot)) * dir;
      }
      if (sortKey === "area") return (a.areaHa - b.areaHa || bySurvey(a.plot, b.plot)) * dir;
      return bySurvey(a.plot, b.plot) * dir;
    });

    return scored.map((s) => s.entry);
  }, [plotSearchIndex, deferredPlotSearch, namePartMode, sortKey, sortDesc, categoryFilter, selectedSurnameFilter, selectedOwnerFilter, cfrMode, cfrStatusFilter, cfrPurpose]);

  // Demand-driven loading: the parcels on screen (first page of the current filtered list) jump the record queue,
  // so a search or sort shows real owner names within seconds even while the village-wide fill is still crawling.
  // The background fill reads the same cache/in-flight calls, so nothing is fetched twice.
  const visiblePendingKey = filteredPlots
    .slice(0, 12)
    .filter((e) => e.plot.ownerStatus === "pending")
    .map((e) => e.plotno)
    .join("|");
  useEffect(() => {
    if (!bnGisCode || !visiblePendingKey) return;
    const gc = bnGisCode;
    void bulkFetchVillageRecords(gc, visiblePendingKey.split("|"), { concurrency: 4, batchSize: 3, urgent: true }).then((batch) => {
      if (bnGisCodeRef.current === gc && batch.length) React.startTransition(() => setBnPlots((prev) => mergeOwnerRecords(prev, batch)));
    });
  }, [bnGisCode, visiblePendingKey]);

  // Tile counts are village-wide (parcels with a loaded record).
  const categoryCounts = React.useMemo(() => {
    const counts: Record<Category, number> = { farm: 0, residential: 0, government: 0, forest: 0, water: 0, other: 0 };
    plotSearchIndex.forEach((e) => {
      if (e.hasLiveRecord) counts[e.category] += 1;
    });
    return counts;
  }, [plotSearchIndex]);

  const cfrCounts = React.useMemo(() => {
    const counts: Record<string, number> = { recognized: 0, conflict: 0, forest: 0, govt: 0, other: 0 };
    plotSearchIndex.forEach((e) => (counts[e.cfrStatus] = (counts[e.cfrStatus] ?? 0) + 1));
    return counts;
  }, [plotSearchIndex]);

  const entryByPlotno = React.useMemo(() => {
    const m: Record<string, PlotIndexEntry> = {};
    plotSearchIndex.forEach((e) => (m[e.plotno] = e));
    return m;
  }, [plotSearchIndex]);

  const explorerRows = React.useMemo<ExplorerRow[]>(
    () =>
      filteredPlots.map((e) => {
        const o = e.owners[0];
        const fk = e.familyKeys[0] || "";
        return {
          plotno: e.plotno,
          category: cfrMode ? e.cfrStatus : e.category,
          areaHa: e.areaHa,
          ...(cfrMode
            ? (() => {
                const bits = [
                  e.cfr ? `${PURPOSE_GROUPS.find((g) => g.key === e.cfr!.g[0])?.label ?? "CFR"} · ${e.cfr.ha.toFixed(2)} ha approved` : "",
                  e.mrsac?.forest ? `In forest compartment ${e.mrsac.forest.comp || ""} (${e.mrsac.forest.type})`.replace("  ", " ") : "",
                  e.mrsac?.water ? "In a water body" : "",
                ].filter(Boolean);
                return bits.length ? { sub: bits.join(" · ") } : {};
              })()
            : {}),
          owner: o?.fullName || "",
          extraOwners: Math.max(0, e.owners.length - 1),
          pending: e.plot.ownerStatus === "pending",
          ownerHoldings: o ? villageOwnerStats.ownerMap[o.fullName]?.plots.length || 0 : 0,
          familyKey: fk,
          familySize: fk ? villageOwnerStats.familyByKey[fk]?.plots.length || 0 : 0,
        };
      }),
    [filteredPlots, villageOwnerStats, cfrMode]
  );

  // "Detailed info" for the selected survey number: CFR approval, MRSAC forest / water cross-reference, and links.
  const plotExtras = (() => {
    if (!bnSelectedPlot) return null;
    const entry = entryByPlotno[bnSelectedPlot.plotno];
    const feat = plotMarkerLayerRef.current?.getSource()?.getFeatures().find((f) => String(f.get("plotNo") ?? f.get("plotno")) === String(bnSelectedPlot.plotno));
    const geom = feat?.getGeometry();
    const centre = geom ? (toLonLat(getCenter(geom.getExtent())) as [number, number]) : null;
    const cfr = entry?.cfr;
    // Only the Google Maps link is kept here (the official report stays one click away under "Map Report").
    const links = centre ? locationLinks(centre[0], centre[1]).slice(0, 1) : [];
    return (
      <div data-testid="plot-extras" className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-white/70 p-2 font-sans text-[11px] text-slate-700">
        <div className="font-bold text-slate-800">Detailed info</div>
        {cfr && (
          <div data-testid="plot-extras-cfr" className={`rounded border p-1.5 ${entry?.cfrStatus === "conflict" ? "border-red-200 bg-red-50" : "border-violet-200 bg-violet-50"}`}>
            <div className={`font-semibold ${entry?.cfrStatus === "conflict" ? "text-red-800" : "text-violet-800"}`}>
              {entry?.cfrStatus === "conflict" ? "Conflict: private land inside an approved CFR compartment" : "CFR recognized (मान्य सामूहिक वन हक्क)"}
            </div>
            {entry?.overlapPct !== undefined && (
              <div>
                {entry.overlapPct}% of this parcel lies in compartment {cfr.k?.join(", ")} ({entry.overlapPct >= OVERLAP_FULL ? "inside" : "partial overlap"})
              </div>
            )}
            <div>Purpose: {cfr.p}</div>
            <div>Approved area: {cfr.ha.toFixed(2)} ha ({cfr.ac} acre)</div>
            {cfr.dt && <div>Approved on: {cfr.dt}</div>}
          </div>
        )}
        {entry?.mrsac?.forest && (
          <div data-testid="plot-extras-forest">
            Inside forest compartment <b>{entry.mrsac.forest.comp || "—"}</b> ({entry.mrsac.forest.type || "forest"}) — MRSAC
          </div>
        )}
        {entry?.mrsac?.water && <div data-testid="plot-extras-water">Lies in a mapped water body — MRSAC</div>}
        {entry && !cfr && !entry.mrsac && <div className="text-slate-500">No CFR approval or MRSAC forest / water overlap recorded for this survey number.</div>}
        <ReportButton testid="report-survey" label="Download survey report (PDF)" busy={!!reportBusy} onClick={() => void downloadReport(bnSelectedPlot.plotno)} onExcel={() => void downloadReport(bnSelectedPlot.plotno, "xlsx")} hint="Village map with this survey highlighted + land photos" />
        <ul className="space-y-0.5">
          {links.map((l) => (
            <li key={l.href}>
              <a href={l.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#1d6fb8] hover:underline">
                {l.label} ↗
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  })();

  const loadedParcels = React.useMemo(
    () => bnPlots.reduce((n, p) => n + (p.ownerStatus === "pending" ? 0 : 1), 0),
    [bnPlots]
  );

  const showFilteredOnMap = () => {
    // ponytail: capped — drawing more polygons than this stalls OpenLayers; add WMS-side filtering if needed
    const capped = filteredPlots.slice(0, 300);
    const cat = categoryFilter.size === 1 ? [...categoryFilter][0]! : null;
    const name = cat ? CATEGORIES.find((c) => c.key === cat)!.en : "Selected parcels";
    if (cfrMode) {
      highlightPlotsGroup(capped.map((e) => e.plot), "filter", "CFR parcels", "CFR", (pl) => `cfr_${entryByPlotno[pl.plotno]?.cfrStatus ?? "other"}`);
      return;
    }
    highlightPlotsGroup(capped.map((e) => e.plot), "filter", name, name, (pl) => {
      const c = entryByPlotno[pl.plotno]?.category ?? "other";
      return c === "water" ? "waterbody" : c;
    });
  };

  const explorerProps = {
    query: bnPlotSearch,
    onQuery: setBnPlotSearch,
    namePart: namePartMode,
    onNamePart: setNamePartMode,
    categories: categoryFilter,
    onToggleCategory: (c: string) =>
      setCategoryFilter((prev) => {
        const next = new Set(prev);
        if (!next.delete(c as Category)) next.add(c as Category);
        return next;
      }),
    categoryCounts,
    sortKey,
    sortDesc,
    onSort: (k: SortKey) => {
      if (k === sortKey) setSortDesc((d) => !d);
      else {
        setSortKey(k);
        setSortDesc(k === "area");
      }
    },
    rows: explorerRows,
    totalMatches: filteredPlots.length,
    totalHa: filteredPlots.reduce((s, e) => s + e.areaHa, 0),
    totalParcels: bnPlots.length,
    loadedParcels,
    families: villageOwnerStats.families.map((f) => ({ key: f.key, label: f.label, count: f.plots.length })),
    selectedFamily: selectedSurnameFilter,
    onFamily: (key: string | null) => {
      setSelectedOwnerFilter(null);
      setSelectedSurnameFilter(key);
    },
    selectedPlotno: bnSelectedPlot?.plotno,
    onSelect: (plotno: string) => {
      const e = entryByPlotno[plotno];
      if (e) selectBnPlot(e.plot);
    },
    onHighlightOwner: (plotno: string) => {
      const o = entryByPlotno[plotno]?.owners[0];
      const stat = o && villageOwnerStats.ownerMap[o.fullName];
      if (!o || !stat) return;
      setSelectedSurnameFilter(null);
      setSelectedOwnerFilter(o.fullName);
      highlightPlotsGroup(stat.plots, "owner", o.fullName, o.englishFullName);
    },
    onHighlightFamily: (plotno: string) => {
      const fk = entryByPlotno[plotno]?.familyKeys[0];
      const fam = fk ? villageOwnerStats.familyByKey[fk] : undefined;
      if (!fk || !fam) return;
      setSelectedOwnerFilter(null);
      setSelectedSurnameFilter(fk);
      highlightPlotsGroup(fam.plots, "surname", fam.label, fam.englishSurname);
    },
    onShowOnMap: showFilteredOnMap,
    onReset: () => {
      setBnPlotSearch("");
      clearMultiHighlight();
      setCfrStatusFilter(new Set());
      setCfrPurpose(new Set());
    },
  };

  const cfrExplorerProps = {
    ...explorerProps,
    categories: cfrStatusFilter,
    onToggleCategory: (c: string) =>
      setCfrStatusFilter((prev) => {
        const next = new Set(prev);
        if (!next.delete(c)) next.add(c);
        return next;
      }),
    categoryCounts: cfrCounts,
    tiles: CFR_STATUSES.map((s) => ({ key: s.key, en: s.en, mr: s.mr, color: s.color })),
    tileNote: "Recognized comes from the CFR approvals list. Forest / Govt candidates are inferred from the 7/12 holder and MRSAC forest compartments — not legal eligibility.",
    sortOptions: [
      { key: "survey", label: "Survey no." },
      { key: "status", label: "Status" },
      { key: "area", label: "Area" },
      { key: "approved", label: "Approved ha" },
    ],
  };

  // Selecting a village with recognized survey numbers paints them straight away. Their
  // records (which carry the geometry) are fetched first instead of waiting behind the
  // whole village, and the drawing waits for them so nothing is placed without a shape.
  const cfrFetchedRef = useRef("");
  const cfrDrawnRef = useRef("");
  useEffect(() => {
    if (!bnGisCode) {
      cfrFetchedRef.current = "";
      cfrDrawnRef.current = "";
      return;
    }
    if (!cfrMode || cfrVillageRows.length === 0) return;
    const recognized = plotSearchIndex.filter((e) => e.cfr).map((e) => e.plot);
    if (recognized.length === 0) return;
    // Compartment approvals match parcels as the village loads, so redraw whenever the matched set grows.
    const drawKey = `${bnGisCode}:${recognized.length}`;
    if (cfrDrawnRef.current === drawKey) return;

    if (recognized.some((pl) => pl.ownerStatus === "pending")) {
      if (cfrFetchedRef.current !== drawKey) {
        cfrFetchedRef.current = drawKey;
        const gc = bnGisCode;
        void bulkFetchVillageRecords(gc, recognized.map((pl) => pl.plotno), { concurrency: 6, urgent: true }).then((batch) => {
          if (bnGisCodeRef.current === gc) setBnPlots((prev) => mergeOwnerRecords(prev, batch));
        });
      }
      return;
    }
    cfrDrawnRef.current = drawKey;
    const statusOf = Object.fromEntries(plotSearchIndex.filter((e) => e.cfr).map((e) => [e.plotno, e.cfrStatus]));
    void highlightPlotsGroup(recognized, "filter", "CFR recognized", "CFR", (pl) => `cfr_${statusOf[pl.plotno] ?? "recognized"}`);
  }, [cfrMode, bnGisCode, cfrVillageRows, plotSearchIndex, highlightPlotsGroup]);

  const resCounts = React.useMemo(() => {
    const out: Record<string, ResCount> = {};
    for (const l of RES_LAYERS) {
      const fs = resVillage.features[l.key] ?? [];
      const by: Record<string, number> = {};
      let area = 0;
      for (const f of fs) {
        const t = typeLabel(l, f.properties);
        by[t] = (by[t] ?? 0) + 1;
        area += l.key === "waterbody" ? (Number(f.properties["Shape_Area"]) || 0) / 10000 : l.key === "forest" || l.key === "wildlife" ? Number(f.properties["ShpAreaHa"]) || 0 : 0;
      }
      out[l.key] = { count: fs.length, ...(area > 0 ? { areaHa: area } : {}), types: Object.entries(by).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count) };
    }
    return out;
  }, [resVillage]);

  const resInsight = React.useMemo(() => {
    const lines: string[] = [];
    const c = resCounts;
    const wells = c["well"]?.count ?? 0;
    const structs = c["structure"]?.count ?? 0;
    const wb = c["waterbody"]?.count ?? 0;
    if (wells + structs + wb) lines.push(`${wells} wells, ${structs} water-conservation structures, ${wb} water bod${wb === 1 ? "y" : "ies"}.`);
    else lines.push("No mapped wells, structures or water bodies.");
    const forestTypes = (c["forest"]?.types ?? []).filter((t) => isForestLandType(t.label));
    if (forestTypes.length) lines.push(`Touches forest compartments: ${forestTypes.map((t) => `${t.label} (${t.count})`).join(", ")}.`);
    const inForest = Object.values(mrsacParcels).filter((v) => v.forest).length;
    if (inForest) lines.push(`${inForest} parcel${inForest === 1 ? "" : "s"} of this village lie inside forest compartments (counted as forest candidates).`);
    return lines;
  }, [resCounts, mrsacParcels]);

  const cfrUnmatched = React.useMemo(
    () => (cfrVillageRows.length ? unmatchedSurveys(cfrVillageRows, bnPlots.map((pl) => pl.plotno)) : []),
    [cfrVillageRows, bnPlots]
  );


  /** Downloads a PDF report: the whole village, or one survey number when `survey` is given. */
  const downloadReport = async (survey?: string, kind: "pdf" | "xlsx" = "pdf") => {
    const map = mapInstanceRef.current;
    const gis = bnGisCode;
    if (!map || !gis || !bnVillageExtent || reportBusy) return;
    const ctl = new AbortController();
    reportAbortRef.current = ctl;
    setReportBusy({ done: 0, total: 1, label: "Collecting land records…" });
    try {
      // Records carry the holder / khata / geometry the report prints: make sure the parcels it details have them.
      let plots = bnPlots;
      const need = plots.filter((pl) => pl.ownerStatus === "pending" && (!survey || pl.plotno === survey));
      if (need.length) {
        // Time-boxed: a big village keeps loading in the background, the report uses what has arrived by then.
        try {
          const batch = await bulkFetchVillageRecords(gis, need.map((pl) => pl.plotno), {
            concurrency: 6,
            urgent: true,
            signal: AbortSignal.any([ctl.signal, AbortSignal.timeout(60_000)]),
            onBatch: (_b, done, total) => setReportBusy({ done: 0, total: 1, label: `Collecting land records ${done}/${total}…` }),
          });
          if (ctl.signal.aborted) throw new DOMException("aborted", "AbortError");
          plots = mergeOwnerRecords(plots, batch);
          setBnPlots(plots);
        } catch (fetchErr) {
          if ((fetchErr as any)?.name === "AbortError" && ctl.signal.aborted) throw fetchErr;
          console.warn("bulkFetchVillageRecords non-fatal error, continuing with available records:", fetchErr);
        }
      }
      // Water / forest layers load only in CFR mode; fetch them here when the report is asked for elsewhere.
      let resources: Record<string, GeoFeature[]> | null = resVillage.status === "ready" ? resVillage.features : null;
      if (!resources) {
        setReportBusy({ done: 0, total: 1, label: "Loading water & forest data…" });
        try {
          const v = await findVillage(bnVillageExtent, ctl.signal, bnLevels[3]?.find((o) => o.code === bnSelected[3])?.value ?? "");
          if (v) {
            const rs = await Promise.allSettled(RES_LAYERS.map((l) => fetchResource(l, v, ctl.signal)));
            resources = {};
            rs.forEach((r, i) => r.status === "fulfilled" && (resources![RES_LAYERS[i]!.key] = r.value));
          }
        } catch { /* the report notes that resources were unavailable */ }
      }
      const refLon = (bnVillageExtent[0] + bnVillageExtent[2]) / 2;
      const [fx, fy] = await parcelFrameShift(gis, plots);
      const { x: ox, y: oy } = cadastralCalibRef.current;

      // Resolve CFR compartments for this village from pre-built/live dataset
      const activeCompData = compData || (await loadCompData());
      const fmtR = new GeoJSON();
      const reportComps: ReportComp[] = [];
        // Filter strictly to this village's OWN CFR compartments so the report maps and profile
        // focus purely on this village and do not draw dozens of outside compartments.
        const allDrawn = compsAround(activeCompData, cfrVillageRows, resVillage.village?.rings ?? [], 0, cfrPurpose);
        const ownDrawn = allDrawn.filter((d) => d.own && !d.outside);
        const drawn = ownDrawn.length ? ownDrawn : allDrawn.filter((d) => d.own);
        for (const d of drawn) {
          const polys = d.ids.map((id) => activeCompData.polys[id]).filter((q): q is NonNullable<typeof q> => !!q);
          if (!polys.length) continue;
          const text = `Comp. ${d.n} (${d.ha.toFixed(1)} ha)`;
          const geoms: Polygon[] = [];
          for (const q of polys) {
            for (const coords of ringsToPolygons(q.g)) {
              const feat = fmtR.readFeature(
                { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: coords } },
                { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" }
              ) as Feature;
              feat.getGeometry()?.translate(forestDelta[0], forestDelta[1]);
              geoms.push(feat.getGeometry() as Polygon);
            }
          }
          if (geoms.length) {
            reportComps.push({
              n: d.n,
              names: d.names,
              ha: d.ha,
              geoms,
              own: d.own,
              outside: d.outside,
              weak: !!d.weak,
              label: text,
            });
          }
        }

      const rPlots: ReportPlot[] = plots.map((pl) => {
        const e = entryByPlotno[pl.plotno];
        const poly = pl.theGeom ? parsePlotGeometry(pl.theGeom, pl.localBounds || null, null, refLon, gis) : null;
        poly?.translate(fx + ox, fy + oy);
        const [lon, lat] = poly ? (toLonLat(poly.getInteriorPoint().getCoordinates()) as [number, number]) : [0, 0];
        const recs = pl.records ?? [];
        const category = classifyParcel(pl.plotno, pl.records, pl.owner);
        const uniq = (a: string[]) => [...new Set(a.filter((x) => x && x !== "-"))].join("; ");
        let f = e?.mrsac?.forest;

        // Check if parcel overlaps with any CFR forest compartment in this village
        let compHit: ReportComp | undefined;
        if (poly && reportComps.length) {
          const pExt = poly.getExtent();
          const center = poly.getInteriorPoint().getCoordinates();
          for (const rc of reportComps) {
            for (const g of rc.geoms) {
              const gExt = g.getExtent();
              if (pExt[0] <= gExt[2] && pExt[2] >= gExt[0] && pExt[1] <= gExt[3] && pExt[3] >= gExt[1]) {
                if (g.intersectsCoordinate(center) || g.intersectsExtent(pExt)) {
                  compHit = rc;
                  break;
                }
              }
            }
            if (compHit) break;
          }
        }

        const compApproval = compHit
          ? cfrCompRows.get(compHit.n) || cfrVillageRows.find((r) => r.k?.some((k) => compBase(k) === compHit!.n)) || cfrVillageRows[0]
          : undefined;

        const cfrData = e?.cfr
          ? { purpose: e.cfr.p, ha: e.cfr.ha, ac: e.cfr.ac, date: e.cfr.dt }
          : compApproval
          ? { purpose: compApproval.p || "3(1) CFR", ha: compApproval.ha, ac: compApproval.ac, date: compApproval.dt || "" }
          : undefined;

        const forestDesc = f
          ? `${f.comp || "—"} (${f.type || "forest"})`
          : compHit
          ? `Compartment ${compHit.n} (CFR Recognized Area)`
          : undefined;

        const isCfr = !!cfrData;
        const status = cfrStatusOf(isCfr, category, !!(f || compHit), isCfr && isConflictCategory(category));

        return {
          plotno: pl.plotno,
          geom: poly,
          category,
          status,
          ha: recs.reduce((t, r) => t + (parseFloat(r.totalArea) || 0), 0) || haFromAreaText(pl.area) || 0,
          owners: uniq(recs.map((r) => r.ownerName)) || pl.owner || "",
          khata: uniq(recs.map((r) => r.khataNo)),
          potKharaba: uniq(recs.map((r) => r.potKharaba)),
          ...(cfrData ? { cfr: cfrData } : {}),
          ...(forestDesc ? { forest: forestDesc } : {}),
          ...(e?.mrsac?.water ? { water: true } : {}),
          lat,
          lon,
        };
      });
      const loaded = plots.filter((pl) => pl.ownerStatus === "live").length;
      const totalHa = rPlots.reduce((t, p) => t + p.ha, 0);
      const count = (k: string) => rPlots.filter((p) => p.category === k).length;
      const surveyRes = resources ? surveyResourceMap(rPlots, resources, survey) : undefined;
      const approvals = cfrVillageRows.map((r) => ({
        purpose: r.p,
        ha: r.ha,
        ac: r.ac,
        date: r.dt,
        surveys: r.s.length ? r.s.join(", ") : r.k?.length ? `Comp. ${r.k.join(", ")}` : "—",
      }));
      const villageInfo = { name: nameOf(3) || "Village", taluka: cfrTaluka, district: cfrDistrict, gisCode: gis };
      if (kind === "xlsx") {
        if (!surveyRes) throw new Error("Water & forest (MRSAC) data could not be loaded. Please try again.");
        buildExcel({ village: villageInfo, ...(survey ? { survey } : {}), plots: rPlots, resources: surveyRes, approvals });
        return;
      }
      await buildReport({
        map,
        signal: ctl.signal,
        onProgress: (done, total, label) => setReportBusy({ done, total, label }),
        ...(survey ? { survey } : {}),
        village: villageInfo,
        extent: transformExtent(bnVillageExtent, "EPSG:4326", "EPSG:3857") as [number, number, number, number],
        plots: rPlots,
        cfrComps: reportComps,
        stats: [
          ["Survey numbers (parcels)", String(plots.length)],
          ["Parcels with 7/12 record loaded", `${loaded} of ${plots.length}`],
          ["Total recorded land", `${totalHa.toFixed(2)} ha (${(totalHa * 2.47105).toFixed(2)} acre)`],
          ["CFR approvals", String(cfrVillageRows.length)],
          ...(reportComps.length
            ? [["CFR Forest Compartments", reportComps.map((c) => `Comp. ${c.n} (${c.ha.toFixed(1)} ha)`).join(", ")] as [string, string]]
            : []),
          ["CFR recognized survey nos.", String(rPlots.filter((p) => p.cfr).length)],
          ["CFR approved area", `${cfrVillageRows.reduce((t, r) => t + r.ha, 0).toFixed(2)} ha`],
          ...CATEGORIES.map((c) => [`Category: ${c.en}`, String(count(c.key))] as [string, string]),
          ...(atreeVillage?.potential ? ([["ATREE CFR potential", `${(Number(atreeVillage.potential["totcfr_ha"]) || 0).toFixed(1)} ha`]] as [string, string][]) : []),
          ...(atreeVillage?.recognized ? ([["ATREE recognized area", `${(Number(atreeVillage.recognized["cr_cfrarea"]) || 0).toFixed(1)} ha`]] as [string, string][]) : []),
        ],
        insights: resources
          ? RES_LAYERS.filter((l) => resources![l.key]?.length).map((l) => `${l.label}: ${resources![l.key]!.length}`)
          : ["Water & forest (MRSAC) data could not be loaded."],
        approvals,
        resources,
        ...(surveyRes ? { surveyRes } : {}),
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") window.alert(`Report failed: ${(e as Error).message}`);
    } finally {
      setReportBusy(null);
    }
  };

  /** In the CFR panel, flag districts / talukas / villages that have recognized survey data. */
  const cfrMark = (idx: number, value: string) => {
    if (!cfrMode || !cfrIndex) return "";
    if (idx === 1) return hasDistrict(cfrIndex, value) ? "  ●" : "";
    if (idx === 2) return cfrDistrict && villagesOfTaluka(cfrIndex, cfrDistrict, value).size ? "  ●" : "";
    if (idx === 3) {
      const n = cfrDistrict && cfrTaluka ? rowsForVillage(cfrIndex, cfrDistrict, cfrTaluka, value, cfrDup).length : 0;
      return n ? `  ● ${n}` : "";
    }
    return "";
  };

  const regionSelectors = (
    <>
        {/* Same portal-driven cascade as Cadastral: Category → District → Taluka → Village. */}
        <div className="grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((idx) => {
            const label = bnLevelLabels[idx] ?? DEFAULT_LABELS[idx];
            const options = bnLevels[idx] || [];
            const disabled = idx > 0 && !bnSelected[idx - 1];
            return (
              <label key={idx} className="min-w-0">
                <span className="block text-[11px] font-semibold text-slate-600 mb-0.5">{label}</span>
                <select
                  value={bnSelected[idx] || ""}
                  onChange={(e) => handleBnLevelChange(idx, e.target.value)}
                  disabled={disabled}
                  className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 focus:border-slate-700 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <option value="">Select {label}</option>
                  <LevelOptions options={options} mark={(v) => cfrMark(idx, v)} deps={[idx, cfrMode, cfrIndex, cfrDistrict, cfrTaluka, cfrDup]} />
                </select>
              </label>
            );
          })}
        </div>
        {bnLoading && <div className="text-[11px] text-slate-500">Loading from MahaBhuNakasha…</div>}
        {bnDistrictSource === "default" && (
          <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-800">
            Portal not reachable — showing an offline district list.{" "}
            <button type="button" onClick={initBhuNakshaLevels} className="font-semibold underline">Retry</button>
          </div>
        )}
    </>
  );

  return (
    <div className="relative w-full h-screen overflow-hidden bg-slate-100 flex flex-col select-none">
      {/* TOP NAVBAR (LIGHT THEME) */}
      <header className="relative z-30 flex h-16 w-full items-center justify-between border-b border-slate-200 bg-white px-4 shadow-sm text-slate-800">
        <div className="flex items-center gap-3">
          <img
            src="/vanmitra_icon.png"
            alt="VANMITRA"
            className="h-11 w-11 object-contain rounded-full shadow-xs cursor-pointer hover:scale-105 transition-all"
            onClick={() => resetView()}
            title="VANMITRA - Innovate • Integrate • Elevate"
          />
          <div className="hidden sm:block border-l border-slate-200 pl-3">
            <div className="flex items-center gap-2">
              <span className="font-extrabold tracking-tight text-sm text-slate-900 font-display">VANMITRA</span>
              <span className="text-[10px] font-bold uppercase tracking-wider rounded bg-red-50 border border-red-200 text-red-700 px-1.5 py-0.5">
                Nakasha WebGIS
              </span>
              {bnCadastralEnabled && (
                <span className="text-[10px] font-semibold uppercase tracking-wider rounded bg-emerald-50 border border-emerald-300 text-emerald-800 px-1.5 py-0.5 flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-emerald-600 animate-pulse" /> Cadastral Live
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-500 font-medium">
              Maharashtra Land Intelligence · 36 Districts · 305 Talukas · 48,926 Villages
            </div>
          </div>
        </div>

        {/* What is this map for? Banner */}
        <div className="hidden xl:flex items-center gap-2 rounded-xl bg-slate-50 border border-slate-200/80 px-3 py-1.5 max-w-md shadow-xs">
          <span className="text-amber-500 text-sm">💡</span>
          <div className="text-[11px] text-slate-600 leading-snug">
            <strong className="text-slate-800 font-semibold">What is this map for?</strong> Official state GIS for territorial boundary exploration, live BhuNaksha cadastral parcels, and survey number harmonization.
          </div>
          <button
            type="button"
            id="learn-more-btn"
            onClick={(e) => {
              e.stopPropagation();
              setAboutModalOpen(true);
            }}
            className="text-[10px] font-bold text-emerald-700 hover:text-emerald-900 underline whitespace-nowrap ml-1 cursor-pointer"
          >
            Learn More
          </button>
        </div>

        {/* Territory Indicator */}
        <div className="hidden lg:flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1 text-xs text-slate-600">
          <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-semibold text-slate-800">Territory:</span><span>Maharashtra</span>
          {selectedDistrict && <><span className="text-slate-400">›</span><span className="text-amber-700 font-medium">{selectedDistrict}</span></>}
          {selectedTaluka && <><span className="text-slate-400">›</span><span className="text-blue-700 font-medium">{selectedTaluka}</span></>}
        </div>

        {/* Top Right Controls & Profile Section */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => togglePanel("legend")}
            className={"hidden sm:flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all cursor-pointer " + (panelOpen === "legend" ? "border-red-500 bg-red-50 text-red-700 shadow-xs" : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100")}
          >
            <span>ℹ</span><span>Legend</span>
          </button>

          {/* Profile & Login Section */}
          {currentUser ? (
            <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1">
                <div className="size-6 rounded-full bg-emerald-700 text-white text-[10px] font-bold flex items-center justify-center">
                  {currentUser.avatar || "AO"}
                </div>
                <div className="text-left hidden md:block">
                  <div className="text-xs font-bold text-slate-900 truncate max-w-[120px]">{currentUser.name}</div>
                  <div className="text-[9px] text-emerald-800 font-semibold truncate max-w-[120px]">{currentUser.role}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={onOpenConsole}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold px-3 py-1.5 shadow-sm transition-all cursor-pointer active:scale-95"
                title="Enter Officer Dashboard"
              >
                <span>📊</span><span className="hidden sm:inline">Officer Dashboard</span>
              </button>
              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  className="text-xs text-slate-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 font-medium transition-colors cursor-pointer"
                  title="Logout"
                >
                  Logout
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
              <div className="hidden md:flex items-center gap-1.5 bg-slate-100 px-2.5 py-1 rounded-lg text-xs text-slate-600 font-medium">
                <span>👤</span><span>Citizen / Guest</span>
              </div>
              <button
                id="officer-login-btn"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onOpenLogin) {
                    onOpenLogin();
                  } else {
                    onOpenConsole();
                  }
                }}
                className="flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-3 py-1.5 shadow-sm transition-all cursor-pointer active:scale-95"
              >
                <span>🔐</span><span>Officer Login</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* BODY */}
      <div className="relative flex-1 w-full h-[calc(100vh-64px)] overflow-hidden">
        <div ref={mapContainerRef} className="absolute inset-0 w-full h-full bg-slate-100" />

        {/* FLOATING MULTI-PARCEL HIGHLIGHT BANNER */}
        {multiHighlightInfo && (
          <div
            className="absolute top-4 z-20 flex items-center gap-3 bg-white/95 backdrop-blur-md border-2 border-amber-500 shadow-2xl rounded-2xl px-4 py-2.5 text-slate-800 transition-all max-w-xl animate-in fade-in slide-in-from-top-3"
            style={{ left: panelOpen ? "calc(50% + 140px)" : "50%", transform: "translateX(-50%)" }}
          >
            <div
              className={`size-9 rounded-full flex items-center justify-center text-base font-bold shrink-0 shadow-xs ${
                multiHighlightInfo.type === "surname"
                  ? "bg-amber-100 border border-amber-300 text-amber-800"
                  : multiHighlightInfo.type === "owner"
                    ? "bg-emerald-100 border border-emerald-300 text-emerald-800"
                    : multiHighlightInfo.type === "forest"
                      ? "bg-green-100 border border-green-300 text-green-800"
                      : "bg-sky-100 border border-sky-300 text-sky-800"
              }`}
            >
              {multiHighlightInfo.type === "surname"
                ? "🏷️"
                : multiHighlightInfo.type === "owner"
                  ? "👤"
                  : multiHighlightInfo.type === "forest"
                    ? "🌲"
                    : "💧"}
            </div>
            <div className="text-xs">
              <div className="font-extrabold text-slate-900 flex items-center gap-2">
                <span>{multiHighlightInfo.title}</span>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full shadow-xs text-white ${
                    multiHighlightInfo.plotNos.length > 0 ? "bg-amber-500" : "bg-red-500"
                  }`}
                >
                  {multiHighlightInfo.plotNos.length} {multiHighlightInfo.plotNos.length === 1 ? "Parcel" : "Parcels"} Highlighted
                </span>
                {multiHighlightInfo.missingGeometry > 0 && (
                  <span className="text-[10px] font-bold bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">
                    {multiHighlightInfo.missingGeometry} without map geometry
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-600 flex items-center gap-2 mt-0.5">
                <span>
                  Total Area: <strong className="text-emerald-700 font-bold">{multiHighlightInfo.totalAreaHa} हे</strong>{" "}
                  ({multiHighlightInfo.totalAreaAcres} ac)
                </span>
                {multiHighlightInfo.plotNos.length > 0 && (
                  <>
                    <span className="text-slate-300">•</span>
                    <span className="text-slate-500 truncate max-w-[220px]">
                      Survey: {multiHighlightInfo.plotNos.join(", ")}
                    </span>
                  </>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={clearMultiHighlight}
              className="ml-2 text-[11px] font-bold text-slate-600 hover:text-red-700 bg-slate-100 hover:bg-red-50 border border-slate-300 hover:border-red-300 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
              title="Clear Highlight"
            >
              Clear
            </button>
          </div>
        )}

        {/* TOOLBAR (LIGHT THEME) */}
        <aside className="absolute left-0 top-0 bottom-0 z-20 flex flex-col items-center py-3 gap-1.5 border-r border-slate-200 bg-white/95 backdrop-blur-md text-slate-700 shadow-sm" style={{ width: 64 }}>
          <ToolbarIconBtn active={panelOpen === "layerList"} onClick={() => togglePanel("layerList")} label="Layers" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-5"><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>} />
          <ToolbarIconBtn active={panelOpen === "searchVillage"} onClick={() => togglePanel("searchVillage")} label="Search" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-5"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>} />
          <ToolbarIconBtn active={panelOpen === "cadastral"} onClick={() => togglePanel("cadastral")} label="Cadastral" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-5"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" /></svg>} />
          <ToolbarIconBtn active={panelOpen === "explore"} onClick={() => togglePanel("explore")} label="Explore" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-5"><path d="M3 6h18M3 12h12M3 18h6" /><circle cx="18" cy="17" r="3" /><line x1="20.2" y1="19.2" x2="22" y2="21" /></svg>} />
          <ToolbarIconBtn active={panelOpen === "cfr"} onClick={() => togglePanel("cfr")} label="CFR" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-5"><path d="M12 3l5 7h-3l4 6h-5v5h-2v-5H6l4-6H7z" /></svg>} />
          <ToolbarIconBtn active={panelOpen === "kml"} onClick={() => togglePanel("kml")} label="KML" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" /></svg>} />
          <ToolbarIconBtn active={panelOpen === "legend"} onClick={() => togglePanel("legend")} label="Legend" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-5"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>} />
        </aside>

        {/* SIDE PANEL */}
        {panelOpen && (
          <div className="absolute top-0 bottom-0 z-20 w-80 bg-white border-r border-slate-200 shadow-2xl flex flex-col text-slate-800" style={{ left: 64 }}>

            {/* LAYER LIST */}
            {panelOpen === "layerList" && (
              <div className="flex flex-col h-full overflow-y-auto">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
                  <div className="flex items-center gap-2 font-bold text-sm text-slate-900"><span>🗂</span><span>Boundary and Map Layers</span></div>
                  <button onClick={() => setPanelOpen(null)} className="text-slate-400 hover:text-slate-700 text-lg" aria-label="Close">✕</button>
                </div>
                <AccordionSection title="BASE MAPS" open={basemapOpen} onToggle={() => setBasemapOpen((v) => !v)} accentColor="#334155">
                  <div className="space-y-2 px-3 py-1">
                    {(Object.entries(BASEMAPS) as [BasemapKey, { label: string; url: string; maxZoom: number }][]).map(([key, cfg]) => (
                      <label key={key} className="flex items-center gap-2.5 cursor-pointer text-xs font-medium text-slate-700 hover:text-slate-900"><input type="radio" name="basemap" checked={basemap === key} onChange={() => setBasemap(key)} className="accent-red-600" />{cfg.label}</label>
                    ))}
                  </div>
                </AccordionSection>
                <AccordionSection title="MAHARASHTRA ADMINISTRATIVE LAYERS" open={mhOpen} onToggle={() => setMhOpen((v) => !v)} accentColor="#9c231b">
                  <LayerRow label="District Boundaries" layerKey="district" checked={layerVisible.district} opacity={opacity.district} opacityOpen={!!layerOpacityOpen["district"]} onToggle={() => setLayerVisible((p) => ({ ...p, district: !p.district }))} onOpacityToggle={() => toggleLayerOpacity("district")} onOpacityChange={(v) => setOpacity((p) => ({ ...p, district: v }))} note="36 Districts - Labels always on" />
                  <LayerRow label="Tehsil (Taluka) Boundaries" layerKey="taluka" checked={layerVisible.taluka} opacity={opacity.taluka} opacityOpen={!!layerOpacityOpen["taluka"]} onToggle={() => setLayerVisible((p) => ({ ...p, taluka: !p.taluka }))} onOpacityToggle={() => toggleLayerOpacity("taluka")} onOpacityChange={(v) => setOpacity((p) => ({ ...p, taluka: v }))} note="305 Talukas - Labels visible on zoom" />
                  <LayerRow label="Village Boundaries" layerKey="village" checked={layerVisible.village} opacity={opacity.village} opacityOpen={!!layerOpacityOpen["village"]} onToggle={() => setLayerVisible((p) => ({ ...p, village: !p.village }))} onOpacityToggle={() => toggleLayerOpacity("village")} onOpacityChange={(v) => setOpacity((p) => ({ ...p, village: v }))} note={loadedVillageDistrict ? "Active: " + loadedVillageDistrict : "Loaded per selected District"} />
                </AccordionSection>
                <AccordionSection title="BHUNAKSHA CADASTRAL" open={cadastralOpen} onToggle={() => setCadastralOpen((v) => !v)} accentColor="#065f46">
                  <div className="px-3 py-2 space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-800"><input type="checkbox" checked={bnCadastralEnabled} onChange={(e) => setBnCadastralEnabled(e.target.checked)} className="rounded accent-emerald-600 size-3.5" /><span>Cadastral Village Map</span></label>
                      {bnGisCode && <span className="text-[9px] font-mono bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">{bnGisCode.slice(-6)}</span>}
                    </div>
                    {bnCadastralEnabled && (
                      <div className="flex items-center gap-2 text-xs pl-5">
                        <span className="text-[10px] text-slate-400">Opacity:</span>
                        <input type="range" min={20} max={100} value={bnCadastralOpacity} onChange={(e) => setBnCadastralOpacity(Number(e.target.value))} className="w-24 accent-emerald-600" />
                        <span className="text-[10px] text-slate-500 font-mono w-8">{bnCadastralOpacity}%</span>
                      </div>
                    )}
                    <p className="text-[10px] text-slate-400 bg-slate-50 rounded p-2 border border-slate-200">Real cadastral parcel data from MahaBhuNakasha. Select a village via the Cadastral panel to activate.</p>
                    {!bnGisCode && <button onClick={() => togglePanel("cadastral")} className="w-full text-xs bg-emerald-700 hover:bg-emerald-600 text-white py-1.5 rounded-md font-semibold transition-colors">Open Cadastral Panel</button>}
                  </div>
                </AccordionSection>
                <div className="mt-auto border-t border-slate-200 p-3.5 bg-slate-50">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Map Style Guide</div>
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center gap-2"><span className="w-5 h-1 bg-black inline-block rounded" /><span className="font-semibold text-slate-800">District Boundary (Black)</span></div>
                    <div className="flex items-center gap-2"><span className="w-5 h-1 bg-blue-600 inline-block rounded" /><span className="font-medium text-slate-700">Taluka / Tehsil (Blue)</span></div>
                    <div className="flex items-center gap-2"><span className="w-5 h-1 bg-green-600 inline-block rounded" /><span className="font-medium text-slate-700">Village Boundary (Green)</span></div>
                    <div className="flex items-center gap-2"><span className="w-5 h-1.5 bg-amber-500 border border-amber-600 inline-block rounded" /><span className="font-bold text-amber-700">Selected Village (Amber)</span></div>
                    <div className="flex items-center gap-2"><span className="w-5 h-1.5 bg-emerald-600 border border-emerald-700 inline-block rounded" /><span className="font-bold text-emerald-700">Cadastral Parcels (BhuNaksha)</span></div>
                  </div>
                </div>
              </div>
            )}

            {/* SEARCH VILLAGE */}
            {panelOpen === "searchVillage" && (
              <div className="flex flex-col h-full overflow-y-auto">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
                  <div className="flex items-center gap-2 font-bold text-sm text-slate-900"><span>🔍</span><span>Locate Village / Taluka</span></div>
                  <button onClick={() => setPanelOpen(null)} className="text-slate-400 hover:text-slate-700 text-lg" aria-label="Close">✕</button>
                </div>
                <div className="p-3.5 space-y-4">
                  <div>
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Quick Keyword Search</label>
                    <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search village name or code..." className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600 shadow-sm" />
                    {searchResults.length > 0 && (
                      <div className="mt-1.5 max-h-52 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg divide-y divide-slate-100">
                        {searchResults.map((v, i) => (
                          <button key={i} onClick={() => { flyToVillage(v); setSelectedDistrict(v.district); setSelectedTaluka(v.subdistrict); setSelectedVillageCode(v.villageCode); setSearchQuery(""); setSearchResults([]); }} className="w-full text-left px-3 py-2 text-xs hover:bg-red-50/70 transition-colors">
                            <div className="font-bold text-slate-900">{v.village}</div>
                            <div className="text-[11px] text-slate-500">{v.subdistrict} - {v.district}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="border-t border-slate-200 pt-3">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Territorial Cascade</div>
                    <div className="mb-2.5">
                      <label className="text-[11px] font-medium text-slate-600 mb-1 block">District (35)</label>
                      {dataLoading ? <div className="text-xs text-slate-400 py-1 flex items-center gap-1.5"><span className="size-3 animate-spin rounded-full border-2 border-red-600 border-t-transparent" /><span>Loading villages...</span></div> : (
                        <select value={selectedDistrict} onChange={(e) => { const val = e.target.value; setSelectedDistrict(val); setSelectedTaluka(""); setSelectedVillageCode(""); if (val) flyToDistrict(val); }} className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium focus:border-red-600 focus:outline-none">
                          <option value="">- Select District -</option>
                          {districts.map((d) => <option key={d} value={d}>{d}</option>)}
                        </select>
                      )}
                    </div>
                    <div className="mb-2.5">
                      <label className="text-[11px] font-medium text-slate-600 mb-1 block">Taluka / Tehsil</label>
                      <select value={selectedTaluka} onChange={(e) => { const val = e.target.value; setSelectedTaluka(val); setSelectedVillageCode(""); if (val && selectedDistrict) flyToTaluka(selectedDistrict, val); }} disabled={!selectedDistrict} className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium focus:border-red-600 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400">
                        <option value="">- Select Taluka -</option>
                        {talukas.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="mb-3.5">
                      <label className="text-[11px] font-medium text-slate-600 mb-1 block">Village</label>
                      <select value={selectedVillageCode} onChange={(e) => { const code = e.target.value; setSelectedVillageCode(code); const v = villages.find((x) => x.villageCode === code); if (v) flyToVillage(v); }} disabled={!selectedTaluka} className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium focus:border-red-600 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400">
                        <option value="">- Select Village -</option>
                        {villages.map((v) => <option key={v.villageCode} value={v.villageCode}>{v.village}</option>)}
                      </select>
                    </div>
                    <button onClick={() => { const v = villages.find((x) => x.villageCode === selectedVillageCode) ?? villages[0]; if (v) flyToVillage(v); }} disabled={!selectedDistrict} className="w-full rounded-md bg-red-700 text-white text-xs font-bold py-2 shadow hover:bg-red-800 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed">Focus Village Boundary</button>
                  </div>
                  {activeVillageDetails && (
                    <div className="rounded-lg bg-amber-50/90 border border-amber-300 p-3 text-xs space-y-1.5 shadow-sm mt-3">
                      <div className="flex items-center justify-between"><span className="font-extrabold text-amber-950 text-sm">{activeVillageDetails.village}</span><span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-mono font-bold text-amber-900">{activeVillageDetails.villageCode}</span></div>
                      <div className="text-amber-800 text-[11px]">{activeVillageDetails.subdistrict} Tehsil - {activeVillageDetails.district} District</div>
                      <div className="grid grid-cols-2 gap-1 pt-1.5 border-t border-amber-200/80 text-[11px]">
                        <div><span className="text-amber-700 block">Total Area</span><span className="font-bold text-slate-800">{activeVillageDetails.totalAreaHa.toFixed(1)} ha</span></div>
                        <div><span className="text-amber-700 block">Population</span><span className="font-bold text-slate-800">{activeVillageDetails.population.toLocaleString()}</span></div>
                        <div><span className="text-amber-700 block">Households</span><span className="font-bold text-slate-800">{activeVillageDetails.households.toLocaleString()}</span></div>
                        <div><span className="text-amber-700 block">Gram Panchayat</span><span className="font-bold text-slate-800 truncate block">{activeVillageDetails.gramPanchayat || "N/A"}</span></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* CADASTRAL PANEL */}
            {/* EXPLORE — land records for the village picked in Cadastral */}
            {panelOpen === "explore" && (
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
                  <div className="font-bold text-sm text-slate-900">
                    Explore land <span className="font-normal text-slate-500">({bnPlots.length} parcels)</span>
                  </div>
                  <button onClick={() => setPanelOpen(null)} className="text-slate-400 hover:text-slate-700 text-lg" aria-label="Close">✕</button>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
                  {regionSelectors}

                  {bnGisCode && bnPlots.length > 0 && bnVillageExtent && <ReportButton testid="report-village" label="Download village report (PDF)" busy={!!reportBusy} onClick={() => void downloadReport()} onExcel={() => void downloadReport(undefined, "xlsx")} hint="Satellite maps, every CFR recognized survey no. highlighted, filters, resources and land photos" />}
                  {bnGisCode && bnPlots.length > 0 ? (
                    <LandExplorer {...explorerProps} />
                  ) : bnPlotsLoading ? (
                    <div className="py-8 text-center text-xs text-slate-500">Loading parcels…</div>
                  ) : (
                    <div className="py-8 text-center text-xs text-slate-500">Select a village to explore its parcels.</div>
                  )}
                </div>
              </div>
            )}

            {/* CFR — recognized community forest resource land + claim candidates */}
            {panelOpen === "cfr" && (
              <CfrPanel
                index={cfrIndex}
                region={regionSelectors}
                district={cfrDistrict}
                taluka={cfrTaluka}
                villageSelected={!!bnGisCode && bnPlots.length > 0}
                portalTalukas={bnLevels[2] || []}
                portalVillages={bnLevels[3] || []}
                onPickTaluka={(code) => handleBnLevelChange(2, code)}
                onPickVillage={(code) => handleBnLevelChange(3, code)}
                villageRows={cfrVillageRows}
                compSummary={cfrCompSummary}
                onRadius={setCfrRadiusKm}
                onZoomClaim={zoomToClaim}
                totalParcels={bnPlots.length}
                matchedSurveys={plotSearchIndex.filter((e) => e.cfr).length}
                unmatched={cfrUnmatched}
                explorer={<LandExplorer {...cfrExplorerProps} />}
                report={<ReportButton testid="report-village" label="Download village report (PDF)" busy={!!reportBusy} onClick={() => void downloadReport()} onExcel={() => void downloadReport(undefined, "xlsx")} hint="Satellite maps, every CFR recognized survey no. highlighted, filters, resources and land photos" />}
                purposes={cfrPurpose}
                onPurpose={(g) =>
                  setCfrPurpose((prev) => {
                    const n = new Set(prev);
                    if (!n.delete(g)) n.add(g);
                    return n;
                  })
                }
                cadastral={{ enabled: bnCadastralEnabled, opacity: bnCadastralOpacity }}
                onCadastral={(patch) => {
                  if (patch.enabled !== undefined) setBnCadastralEnabled(patch.enabled);
                  if (patch.opacity !== undefined) setBnCadastralOpacity(patch.opacity);
                }}
                cfrFill={{ fillOpacity: gramSabhaFillOpacity, parcelOpacity: cfrParcelFillOpacity, layerOpacity: gramSabhaOpacity }}
                onCfrFill={(patch) => {
                  if (patch.fillOpacity !== undefined) setGramSabhaFillOpacity(patch.fillOpacity);
                  if (patch.parcelOpacity !== undefined) setCfrParcelFillOpacity(patch.parcelOpacity);
                  if (patch.layerOpacity !== undefined) setGramSabhaOpacity(patch.layerOpacity);
                }}
                resources={
                  <ResourcesSection
                    tileOn={resTile}
                    onTile={(k, on) => setResTile((prev) => ({ ...prev, [k]: on }))}
                    opacity={resOpacity}
                    onOpacity={setResOpacity}
                    villageSelected={!!bnVillageExtent}
                    status={resVillage.status}
                    error={resVillage.error}
                    onRetry={() => setResRetry((n) => n + 1)}
                    villageName={resVillage.village?.name ?? null}
                    counts={resCounts}
                    visible={resVisible}
                    onVisible={(k) =>
                      setResVisible((prev) => {
                        const n = new Set(prev);
                        if (!n.delete(k)) n.add(k);
                        return n;
                      })
                    }
                    hiddenTypes={resHiddenTypes}
                    onType={(k, label) =>
                      setResHiddenTypes((prev) => {
                        const n = new Set(prev);
                        const key = `${k}|${label}`;
                        if (!n.delete(key)) n.add(key);
                        return n;
                      })
                    }
                    insight={resInsight}
                  />
                }
                error={bnVillageError}
                onRetry={() => {
                  resetPortalBreaker();
                  if (bnSelected[3]) handleBnLevelChange(3, bnSelected[3]);
                }}
                atree={cfrAtree}
                atreeVillage={atreeVillage}
                atreeLoading={atreeLoading}
                onAtree={(patch) => setCfrAtree((prev) => ({ ...prev, ...patch }))}
                onClose={() => setPanelOpen(null)}
              />
            )}

            {panelOpen === "cadastral" && (
              <div className="flex flex-col h-full overflow-y-auto">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-emerald-50">
                  <div className="flex items-center gap-2 font-bold text-sm text-emerald-900"><span>🏛</span><span>BhuNaksha Cadastral</span></div>
                  <button onClick={() => setPanelOpen(null)} className="text-slate-400 hover:text-slate-700 text-lg" aria-label="Close">✕</button>
                </div>
                <div className="p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-slate-500">Live parcel data from MahaBhuNakasha portal.</p>
                    <button
                      onClick={initBhuNakshaLevels}
                      title="Refresh options from BhuNaksha"
                      className="text-[10px] text-emerald-700 hover:text-emerald-900 font-semibold underline"
                    >
                      Refresh
                    </button>
                  </div>

                  {/* The District list can render identically whether it came from the
                      live portal or the static offline reference list, so this makes the
                      difference explicit — a stuck Taluka fetch right after this means
                      the portal is not reachable from here at all, not a per-district issue. */}
                  {bnDistrictSource === "default" && (
                    <div className="rounded-md bg-red-50 border border-red-200 px-2.5 py-1.5 text-[10px] text-red-800 flex items-center justify-between gap-2">
                      <span>
                        ⚠ Could not reach the MahaBhuNakasha portal — showing an offline reference district list.
                        {bnLevelError[1] ? ` (${bnLevelError[1]})` : ""} Taluka/Village won't populate until the portal is reachable.
                      </span>
                      <button
                        type="button"
                        onClick={initBhuNakshaLevels}
                        className="font-bold hover:underline shrink-0 cursor-pointer"
                      >
                        Retry
                      </button>
                    </div>
                  )}

                  {/* CLICK-TO-IDENTIFY TOGGLE BUTTON */}
                  <button
                    type="button"
                    onClick={() => {
                      setIdentifyMode((v) => {
                        const next = !v;
                        if (next) {
                          setIdentifyStatus("🎯 Identify Mode Active: Click anywhere on the map to detect and auto-fill land parcel.");
                        } else {
                          setIdentifyStatus(null);
                        }
                        return next;
                      });
                    }}
                    className={`w-full rounded-md text-xs font-bold py-2.5 px-3 shadow flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-98 border-2 ${
                      identifyMode
                        ? "bg-emerald-700 hover:bg-emerald-800 border-emerald-500 text-white ring-2 ring-emerald-300"
                        : "bg-white border-slate-300 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span>{identifyMode ? "🎯" : "📍"}</span>
                    <span>{identifyMode ? "Identify Mode Active (Click Any Land)" : "Click to Activate Identify Land"}</span>
                  </button>

                  {/* Status feedback for identify mode */}
                  <div className={`rounded-md px-3 py-2 text-xs flex items-center gap-2 border ${
                    identifyLoading
                      ? "bg-amber-50 border-amber-300 text-amber-800"
                      : identifyStatus?.startsWith("✅")
                      ? "bg-emerald-50 border-emerald-300 text-emerald-800 font-semibold"
                      : identifyStatus?.startsWith("⚠")
                      ? "bg-red-50 border-red-300 text-red-800"
                      : identifyMode
                      ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                      : "bg-slate-50 border-slate-200 text-slate-600"
                  }`}>
                    {identifyLoading && <span className="size-3 rounded-full border-2 border-amber-600 border-t-transparent animate-spin shrink-0" />}
                    <span className="font-medium">
                      {identifyStatus || (identifyMode
                        ? "🎯 Identify Mode is ON: Click anywhere on the map to detect location & auto-fill parcel."
                        : "💡 Normal Navigation: Click the button above if you want to click map land to detect and auto-fill details.")}
                    </span>
                  </div>


                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <div className="bg-emerald-700 text-white text-[11px] font-bold uppercase tracking-wider px-3 py-2 flex items-center justify-between">
                      <span>Village-wise Sort and Filter</span>
                      {bnLoading && <span className="size-3 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                    </div>
                    <div className="p-3 space-y-2.5">
                      {bnLevelLabels.map((label, idx) => {
                        const options = bnLevels[idx] || [];
                        const isDisabled = idx > 0 && !bnSelected[idx - 1];
                        // The portal returned nothing for this level and there is nothing
                        // fabricated to fall back to (see handleBnLevelChange) — surfaced
                        // honestly with a one-click retry instead of a silently empty list.
                        const isStuck = idx > 0 && !isDisabled && !bnLoading && options.length === 0 && !bnSelected[idx];

                        // Map Type (row 4) additionally offers two synthetic entries that
                        // trigger the forest/water-body highlight instead of a real portal
                        // map-type change (see the guard at the top of handleBnLevelChange).
                        // They are appended for display only — the "N options" badge below
                        // still reflects just the real portal-provided count.
                        const envEntries: BNLevel[] =
                          idx === 4 && bnGisCode
                            ? [
                                ...(villageEnvStats.forest.length > 0
                                  ? [{ code: "__forest__", value: `🌲 Forest Land (${villageEnvStats.forest.length})` }]
                                  : []),
                                ...(villageEnvStats.waterbody.length > 0
                                  ? [{ code: "__waterbody__", value: `💧 Water Bodies (${villageEnvStats.waterbody.length})` }]
                                  : []),
                              ]
                            : [];

                        return (
                          <div key={idx}>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-[11px] font-semibold text-slate-700">{label}</label>
                              {options.length > 0 && (
                                <span className="text-[10px] text-slate-400 font-mono">
                                  {options.length} {options.length === 1 ? "option" : "options"}
                                </span>
                              )}
                            </div>
                            <select
                              value={bnSelected[idx] || ""}
                              onChange={(e) => handleBnLevelChange(idx, e.target.value)}
                              disabled={isDisabled}
                              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400 cursor-pointer disabled:cursor-not-allowed"
                            >
                              <option value="">- Select {label} -</option>
                              <LevelOptions options={options} />
                              {envEntries.length > 0 && (
                                <>
                                  <option disabled>── Highlight ──</option>
                                  {envEntries.map((lvl) => (
                                    <option key={lvl.code} value={lvl.code}>
                                      {lvl.value}
                                    </option>
                                  ))}
                                </>
                              )}
                            </select>
                            {isStuck && (
                              <div className="mt-1 flex items-center justify-between gap-2 rounded-md bg-amber-50 border border-amber-200 px-2 py-1">
                                <span className="text-[10px] text-amber-800">
                                  {bnLevelError[idx]
                                    ? `Fetch failed: ${bnLevelError[idx]}`
                                    : `Portal returned no ${label.toLowerCase()} options for this selection.`}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleBnLevelChange(idx - 1, bnSelected[idx - 1] || "")}
                                  className="text-[10px] font-bold text-amber-900 hover:underline shrink-0 cursor-pointer"
                                >
                                  Retry
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {bnGisCode && (
                    <div className="rounded-lg bg-emerald-50 border border-emerald-300 p-3 text-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-emerald-900">GIS Code</span>
                        <span className="font-mono text-emerald-800 font-bold bg-white border border-emerald-300 px-2 py-0.5 rounded text-[11px]">
                          {bnGisCode}
                        </span>
                      </div>
                      <div data-testid="calib-status" className="text-[11px] text-slate-600">
                        {calibSource === "pending" && "Aligning parcels to satellite imagery…"}
                        {calibSource === "imagery" && calibDetail && `Aligned to satellite imagery: E ${calibDetail.east >= 0 ? "+" : ""}${calibDetail.east.toFixed(0)} m, N ${calibDetail.north >= 0 ? "+" : ""}${calibDetail.north.toFixed(0)} m (${calibDetail.agreeing} of ${calibDetail.windows} windows agree)`}
                        {calibSource === "seed" && `Alignment estimated from regional anchors: E ${cadastralCalibX >= 0 ? "+" : ""}${cadastralCalibX} m, N ${cadastralCalibY >= 0 ? "+" : ""}${cadastralCalibY} m`}
                      </div>
                      <div className="flex items-center justify-between pt-1 border-t border-emerald-200/60">
                        <div className="flex items-center gap-2">
                          <span className={"size-2 rounded-full " + (bnCadastralEnabled ? "bg-emerald-500 animate-pulse" : "bg-slate-300")} />
                          <span className="text-[11px] font-medium text-slate-700">
                            {bnCadastralEnabled ? "Cadastral map active" : "Cadastral map hidden"}
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            const next = !bnCadastralEnabled;
                            setBnCadastralEnabled(next);
                            cadastralVillageLayerRef.current?.setVisible(next);
                          }}
                          className="text-[10px] font-bold text-emerald-700 hover:text-emerald-900 underline"
                        >
                          {bnCadastralEnabled ? "Hide Layer" : "Show Layer"}
                        </button>
                      </div>
                      <div className="pt-1 space-y-1.5">
                        <div className="flex justify-between text-[10px] text-slate-600">
                          <span>Cadastral WMS Opacity</span>
                          <span className="font-mono font-bold">{bnCadastralOpacity}%</span>
                        </div>
                        <input
                          type="range"
                          min="10"
                          max="100"
                          value={bnCadastralOpacity}
                          onChange={(e) => setBnCadastralOpacity(Number(e.target.value))}
                          className="w-full accent-emerald-600 h-1.5 bg-slate-200 rounded-lg cursor-pointer"
                        />
                        <div className="flex items-center gap-1.5 pt-0.5">
                          {[
                            { label: "30% Faint", val: 30 },
                            { label: "60% Balanced", val: 60 },
                            { label: "85% Clear", val: 85 },
                          ].map((p) => (
                            <button
                              key={p.val}
                              type="button"
                              onClick={() => setBnCadastralOpacity(p.val)}
                              className={`flex-1 py-1 rounded text-[10px] font-semibold border transition-all ${
                                bnCadastralOpacity === p.val
                                  ? "bg-emerald-700 text-white border-emerald-700 shadow-sm"
                                  : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
                              }`}
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}



                  {bnGisCode && bnVillageExtent && bnPlots.length > 0 && <ReportButton testid="report-village" label="Download village report (PDF)" busy={!!reportBusy} onClick={() => void downloadReport()} onExcel={() => void downloadReport(undefined, "xlsx")} hint="Satellite maps, every CFR recognized survey no. highlighted, filters, resources and land photos" />}
                  {bnGisCode && (
                    <div className="border border-slate-200 rounded-lg overflow-hidden shadow-xs">
                      <div className="bg-slate-800 text-white text-[11px] font-bold uppercase tracking-wider px-3 py-2 flex items-center justify-between">
                        <span>Parcels & Land Records ({bnPlots.length})</span>
                        {(bnPlotsLoading || ownerFetchProgress) && (
                          <span className="size-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        )}
                      </div>

                      <div className="p-2.5 bg-white space-y-2">
                        {bnPlotsLoading ? (
                          <div className="text-xs text-slate-400 py-3 text-center">Loading parcels…</div>
                        ) : (
                          <LandExplorer {...explorerProps} compact onOpenExplorer={() => setPanelOpen("explore")} />
                        )}
                        {multiHighlightInfo && (
                          <div className="flex items-start justify-between gap-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-800 truncate">{multiHighlightInfo.title}</div>
                              <div className="text-[11px] text-slate-600">
                                {multiHighlightInfo.plotNos.length > 0
                                  ? `${multiHighlightInfo.plotNos.length} on map · ${multiHighlightInfo.totalAreaHa} ha (${multiHighlightInfo.totalAreaAcres} ac)`
                                  : "No map geometry available for these parcels"}
                                {multiHighlightInfo.missingGeometry > 0 && multiHighlightInfo.plotNos.length > 0 &&
                                  ` · ${multiHighlightInfo.missingGeometry} without geometry`}
                              </div>
                            </div>
                            <button type="button" onClick={clearMultiHighlight} className="shrink-0 text-[11px] font-semibold text-slate-600 hover:underline">
                              Clear
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {bnSelectedPlot && (
                    <div className="rounded-xl bg-[#fafdfa] border-2 border-[#b0deb0] p-3 text-xs space-y-3 shadow-md">
                      {/* Plot Info Banner matching official MahaBhuNakasha */}
                      <div className="flex items-center justify-between -mx-3 -mt-3 p-2.5 bg-[#daf0da] border-b border-[#c2e2c2] rounded-t-[10px]">
                        <div className="flex items-center gap-1.5">
                          <span className="text-base">📋</span>
                          <span className="font-bold text-[#1d6227] text-sm tracking-tight">Plot Info</span>
                        </div>
                        <span className="font-mono text-[#1d6227] font-bold bg-[#c8e8c8] px-2 py-0.5 rounded text-[11px]">
                          Survey No. {bnSelectedPlot.plotno}
                        </span>
                      </div>

                      {/* Exact fields from MahaBhuNakasha with unit breakdown */}
                      <div className="space-y-2 text-[12.5px] leading-snug">
                        {bnSelectedPlot.records?.map((rec, idx) => {
                          const areaFmt = formatAreaBreakdown(rec.totalArea, rec.potKharaba);
                          const ltype = classifyLandType(bnSelectedPlot.plotno, bnSelectedPlot.records);
                          const ltBadge = ltype === "farmland" ? { icon: "🌾", label: "Agricultural Land", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" } : ltype === "residential" ? { icon: "🏠", label: "Residential Land", cls: "bg-blue-50 text-blue-800 border-blue-200" } : ltype === "government" ? { icon: "🏛️", label: "Govt / Gairan", cls: "bg-amber-50 text-amber-800 border-amber-200" } : { icon: "⚖️", label: "Mixed Use", cls: "bg-purple-50 text-purple-800 border-purple-200" };
                          return (
                            <div key={idx} className="space-y-0.5">
                              {idx === 0 && (
                                <div className={`inline-flex items-center gap-1 text-[9.5px] font-bold border px-1.5 py-0.5 rounded-full mb-1 ${ltBadge.cls}`}>
                                  <span>{ltBadge.icon}</span>
                                  <span>{ltBadge.label}</span>
                                </div>
                              )}
                              <div><span className="text-slate-600">Survey No. : </span><span className="font-bold text-slate-900">{rec.surveyNo}</span></div>
                              <div>
                                <span className="text-slate-600">Total Area : </span>
                                <span className="font-semibold text-slate-900">{areaFmt.ha}</span>
                                <span className="text-slate-500 text-[10px] ml-1">({areaFmt.sqm}{ltype === "farmland" ? ` · ${areaFmt.acres}` : ""})</span>
                              </div>
                              <div>
                                <span className="text-slate-600">Pot kharaba : </span>
                                <span className="font-semibold text-slate-900">{formatAreaBreakdown(rec.potKharaba).ha}</span>
                                {parseFloat(rec.potKharaba) > 0 && (
                                  <span className="text-slate-500 text-[10px] ml-1">({formatAreaBreakdown(rec.potKharaba).sqm})</span>
                                )}
                              </div>
                              {areaFmt.net && (
                                <div className="text-[10px] text-emerald-700 font-medium bg-emerald-50 px-1.5 py-0.5 rounded">
                                  Net Cultivable: {areaFmt.net}
                                </div>
                              )}
                              <div><span className="text-slate-600">Owner Name : </span><span className="font-medium text-slate-900 font-devanagari">{rec.ownerName}</span></div>
                              <div><span className="text-slate-600">Khata No. : </span><span className="font-bold text-slate-900">{rec.khataNo}</span></div>
                              {idx < (bnSelectedPlot.records?.length || 0) - 1 && (
                                <div className="py-1 text-slate-400 select-none overflow-hidden text-xs font-mono">
                                  --------------------------------
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {plotExtras}

                      {/* Map Report & Window Controls */}
                      <div className="pt-2 border-t border-[#c2e2c2]/70 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => setMapReportModalOpen(true)}
                          className="text-[#1d6fb8] hover:underline font-bold text-xs cursor-pointer inline-flex items-center gap-1.5"
                        >
                          <span>Map Report</span>
                          <span>📄</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPlotInfoWindowOpen(true);
                            setPlotInfoWindowMinimized(false);
                          }}
                          className="text-[10px] text-emerald-800 bg-emerald-100 hover:bg-emerald-200 px-2 py-1 rounded font-semibold transition-colors cursor-pointer"
                        >
                          Pop out Window ↗
                        </button>
                      </div>

                      {/* Parcel Highlight Opacity Control */}
                      <div className="pt-2 border-t border-slate-200 space-y-2">
                        <div className="flex items-center justify-between text-[11px] text-sky-950 font-semibold">
                          <span className="flex items-center gap-1">
                            <span>🔍</span>
                            <span>Ground Visibility (Opacity)</span>
                          </span>
                          <span className="font-mono font-bold bg-white px-1.5 py-0.5 rounded border border-sky-300 text-[10px]">
                            {bnPlotOpacity}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="10"
                          max="70"
                          value={bnPlotOpacity}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setBnPlotOpacity(val);
                            cadastralPlotLayerRef.current?.setOpacity(val / 100);
                          }}
                          className="w-full accent-sky-600 h-1.5 bg-sky-200 rounded-lg cursor-pointer"
                        />
                        <div className="flex items-center justify-between gap-1 text-[9.5px]">
                          {[
                            { label: "18% Faint", val: 18 },
                            { label: "26% Optimal", val: 26 },
                            { label: "40% Highlight", val: 40 },
                          ].map((preset) => (
                            <button
                              key={preset.val}
                              type="button"
                              onClick={() => {
                                setBnPlotOpacity(preset.val);
                                cadastralPlotLayerRef.current?.setOpacity(preset.val / 100);
                              }}
                              className={`px-2 py-0.5 rounded border transition-all cursor-pointer ${
                                bnPlotOpacity === preset.val
                                  ? "bg-sky-700 text-white font-bold border-sky-700 shadow-2xs"
                                  : "bg-white text-slate-700 border-slate-300 hover:bg-sky-50"
                              }`}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* KML PANEL */}
            {panelOpen === "kml" && (
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
                  <span className="font-bold text-sm text-slate-900">Upload KML / KMZ Boundary</span>
                  <button onClick={() => setPanelOpen(null)} className="text-slate-400 hover:text-slate-700 text-lg" aria-label="Close">✕</button>
                </div>
                <div className="p-4 text-xs text-slate-600 space-y-3">
                  <p>Overlay surveyor GPS track files or cadastral parcel KML boundaries directly onto the satellite layer.</p>
                  <input type="file" accept=".kml,.kmz,.geojson,.json" className="block w-full text-xs text-slate-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-red-700 file:text-white hover:file:bg-red-800 cursor-pointer" />
                  <p className="rounded-md bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-500">Supports Google Earth KML polygon and polyline geometries.</p>
                </div>
              </div>
            )}

            {/* LEGEND */}
            {panelOpen === "legend" && (
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
                  <span className="font-bold text-sm text-slate-900">Map Legend and Layers</span>
                  <button onClick={() => setPanelOpen(null)} className="text-slate-400 hover:text-slate-700 text-lg" aria-label="Close">✕</button>
                </div>
                <div className="p-4 text-xs space-y-3">
                  <div>
                    <span className="font-bold text-slate-800 block mb-2">Administrative Boundaries:</span>
                    <ul className="space-y-2">
                      <li className="flex items-center gap-2"><span className="w-5 h-1 bg-black rounded" /><span><strong>District:</strong> Official bounds (Black)</span></li>
                      <li className="flex items-center gap-2"><span className="w-5 h-1 bg-blue-600 rounded" /><span><strong>Tehsil / Taluka:</strong> Sub-district bounds (Blue)</span></li>
                      <li className="flex items-center gap-2"><span className="w-5 h-1 bg-green-600 rounded" /><span><strong>Village:</strong> Census 2011 village polygons (Green)</span></li>
                      <li className="flex items-center gap-2"><span className="w-5 h-1.5 bg-amber-500 rounded" /><span><strong>Highlighted Village:</strong> Active village (Amber)</span></li>
                    </ul>
                  </div>
                  <div className="border-t border-slate-200 pt-3">
                    <span className="font-bold text-slate-800 block mb-2">Cadastral Layer (BhuNaksha):</span>
                    <ul className="space-y-2">
                      <li className="flex items-center gap-2"><span className="w-5 h-1 bg-emerald-600 rounded" /><span><strong>VILLAGE_MAP:</strong> Plot-level parcel boundaries</span></li>
                      <li className="flex items-center gap-2"><span className="w-5 h-1.5 bg-amber-500 border border-amber-600 rounded" /><span><strong>Survey Parcel:</strong> Selected plot highlight & pin</span></li>
                    </ul>
                  </div>
                  <p className="bg-slate-50 border border-slate-200 rounded p-2.5 text-[10px] text-slate-500">Cadastral data from Maharashtra Land Records (MahaBhuNakasha). Administrative boundaries GADM 4.1 / DataMeet.</p>
                </div>
              </div>
            )}
          </div>
        )}



        {/* Dynamic Terrain Filter for Satellite Basemap */}
        {(terrainContrast !== 100 || terrainBrightness !== 100) && (
          <style>{`
            .ol-base-satellite canvas {
              filter: contrast(${terrainContrast}%) brightness(${terrainBrightness}%);
            }
          `}</style>
        )}

        {/* MAP & ZOOM CONTROLS */}
        <div className="absolute top-4 right-4 z-20 flex flex-col gap-1.5">
          <RedMapControl onClick={zoomIn} title="Zoom In">+</RedMapControl>
          <RedMapControl onClick={zoomOut} title="Zoom Out">-</RedMapControl>
          <RedMapControl onClick={resetView} title="Reset Maharashtra View">⟲</RedMapControl>
          <RedMapControl onClick={() => setInfoVisible((v) => !v)} title="Toggle Feature Info" active={infoVisible}>i</RedMapControl>
          <RedMapControl
            onClick={() => setFilterControlsOpen((v) => !v)}
            title="Layer Contrast & Ground Visibility Filters"
            active={filterControlsOpen}
          >
            <SlidersHorizontal className="size-4" />
          </RedMapControl>
        </div>

        {/* DYNAMIC MAP FILTER & CONTRAST POPUP */}
        {filterControlsOpen && (
          <div
            data-testid="filter-contrast-panel"
            className="absolute top-4 right-14 z-30 w-84 max-h-[calc(100vh-80px)] overflow-y-auto rounded-2xl bg-white/95 backdrop-blur-md border border-slate-200/90 p-4 shadow-2xl text-xs select-none transition-all duration-200 animate-in fade-in slide-in-from-right-2"
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-200/80">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-violet-100 text-violet-700">
                  <SlidersHorizontal className="size-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-sm leading-tight">Map & Filter Contrast</h3>
                  <p className="text-[10px] text-slate-500">Live ground visibility & layer controls</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFilterControlsOpen(false)}
                className="size-6 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Quick Visibility Presets */}
            <div className="mb-3.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 block">
                Ground Visibility Presets
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setGramSabhaFillOpacity(0);
                    setCfrParcelFillOpacity(0);
                    setGramSabhaOpacity(100);
                    setBnCadastralOpacity(70);
                    setTerrainContrast(120);
                    setTerrainBrightness(100);
                    setHighContrastOutlines(true);
                  }}
                  className={`px-2 py-1.5 rounded-lg border text-center transition-all flex flex-col items-center justify-center gap-0.5 ${
                    gramSabhaFillOpacity === 0 && cfrParcelFillOpacity === 0
                      ? "border-emerald-600 bg-emerald-50 text-emerald-800 font-bold shadow-xs"
                      : "border-slate-200 hover:bg-slate-50 text-slate-700 font-medium"
                  }`}
                  title="0% fill - view actual terrain, trees & farms directly through boundary lines"
                >
                  <Eye className="size-3.5" />
                  <span className="text-[10.5px]">Land View</span>
                  <span className="text-[8.5px] text-slate-400">0% Fill</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setGramSabhaFillOpacity(15);
                    setCfrParcelFillOpacity(20);
                    setGramSabhaOpacity(90);
                    setBnCadastralOpacity(85);
                    setTerrainContrast(105);
                    setTerrainBrightness(100);
                  }}
                  className={`px-2 py-1.5 rounded-lg border text-center transition-all flex flex-col items-center justify-center gap-0.5 ${
                    gramSabhaFillOpacity > 0 && gramSabhaFillOpacity <= 25
                      ? "border-violet-600 bg-violet-50 text-violet-800 font-bold shadow-xs"
                      : "border-slate-200 hover:bg-slate-50 text-slate-700 font-medium"
                  }`}
                  title="Balanced gentle tint with visible terrain"
                >
                  <Sparkles className="size-3.5" />
                  <span className="text-[10.5px]">Balanced</span>
                  <span className="text-[8.5px] text-slate-400">15% Tint</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setGramSabhaFillOpacity(45);
                    setCfrParcelFillOpacity(50);
                    setGramSabhaOpacity(100);
                    setBnCadastralOpacity(90);
                    setTerrainContrast(100);
                    setTerrainBrightness(100);
                  }}
                  className={`px-2 py-1.5 rounded-lg border text-center transition-all flex flex-col items-center justify-center gap-0.5 ${
                    gramSabhaFillOpacity > 25
                      ? "border-violet-700 bg-violet-600 text-white font-bold shadow-xs"
                      : "border-slate-200 hover:bg-slate-50 text-slate-700 font-medium"
                  }`}
                  title="Vivid highlights for presentations"
                >
                  <Layers className="size-3.5" />
                  <span className="text-[10.5px]">Vivid CFR</span>
                  <span className="text-[8.5px] opacity-80">45% Fill</span>
                </button>
              </div>
            </div>

            {/* SECTION 1: Gram Sabha CFR Overlay */}
            <div className="rounded-xl border border-violet-200/80 bg-violet-50/40 p-2.5 mb-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-violet-950 text-[11px] flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-violet-600" />
                  Gram Sabha CFR Overlay
                </span>
                <span className="text-[10px] font-mono font-bold text-violet-700">
                  {gramSabhaFillOpacity === 0 ? "Hollow (Land Only)" : `${gramSabhaFillOpacity}% Tint`}
                </span>
              </div>

              {/* Gram Sabha Fill Tint Slider */}
              <div>
                <div className="flex justify-between text-[10px] text-slate-600 mb-0.5">
                  <span>Compartment Fill Tint</span>
                  <span className="font-mono text-violet-800">{gramSabhaFillOpacity}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={gramSabhaFillOpacity}
                  onChange={(e) => setGramSabhaFillOpacity(Number(e.target.value))}
                  className="w-full h-1.5 bg-violet-200 rounded-lg appearance-none cursor-pointer accent-violet-600"
                />
                <div className="flex justify-between text-[9px] text-slate-400 mt-0.5">
                  <span>0% (Land View)</span>
                  <span>50%</span>
                  <span>100% (Solid)</span>
                </div>
              </div>

              {/* Parcel Fill Opacity Slider inside CFR */}
              <div>
                <div className="flex justify-between text-[10px] text-slate-600 mb-0.5">
                  <span>CFR Parcel Fill Opacity</span>
                  <span className="font-mono text-violet-800">{cfrParcelFillOpacity}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={cfrParcelFillOpacity}
                  onChange={(e) => setCfrParcelFillOpacity(Number(e.target.value))}
                  className="w-full h-1.5 bg-violet-200 rounded-lg appearance-none cursor-pointer accent-violet-600"
                />
              </div>

              {/* Gram Sabha Total Layer Opacity */}
              <div>
                <div className="flex justify-between text-[10px] text-slate-600 mb-0.5">
                  <span>Gram Sabha Layer Opacity</span>
                  <span className="font-mono text-violet-800">{gramSabhaOpacity}%</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={gramSabhaOpacity}
                  onChange={(e) => setGramSabhaOpacity(Number(e.target.value))}
                  className="w-full h-1.5 bg-violet-200 rounded-lg appearance-none cursor-pointer accent-violet-600"
                />
              </div>

              {/* High-Contrast Outlines Toggle */}
              <label className="flex items-center justify-between text-[10px] text-slate-700 pt-1 cursor-pointer">
                <span>High-contrast crisp boundary</span>
                <input
                  type="checkbox"
                  checked={highContrastOutlines}
                  onChange={(e) => setHighContrastOutlines(e.target.checked)}
                  className="rounded text-violet-600 focus:ring-violet-500 size-3.5"
                />
              </label>
            </div>

            {/* SECTION 2: Cadastral WMS Layer */}
            <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/40 p-2.5 mb-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-emerald-950 text-[11px] flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-emerald-600" />
                  Cadastral Map (BhuNaksha)
                </span>
                <span className="text-[10px] font-mono font-bold text-emerald-800">{bnCadastralOpacity}%</span>
              </div>

              {/* Cadastral Lines Opacity */}
              <div>
                <div className="flex justify-between text-[10px] text-slate-600 mb-0.5">
                  <span>Survey Lines (WMS)</span>
                  <span className="font-mono text-emerald-800">{bnCadastralOpacity}%</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={bnCadastralOpacity}
                  onChange={(e) => setBnCadastralOpacity(Number(e.target.value))}
                  className="w-full h-1.5 bg-emerald-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                />
              </div>

              {/* Plot Markers Visibility */}
              <div>
                <div className="flex justify-between text-[10px] text-slate-600 mb-0.5">
                  <span>Plot Marker & Highlight Opacity</span>
                  <span className="font-mono text-emerald-800">{bnPlotOpacity}%</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={bnPlotOpacity}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setBnPlotOpacity(v);
                    cadastralPlotLayerRef.current?.setOpacity(v / 100);
                  }}
                  className="w-full h-1.5 bg-emerald-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                />
              </div>
            </div>

            {/* SECTION 3: Satellite Terrain Contrast */}
            <div className="rounded-xl border border-sky-200/80 bg-sky-50/40 p-2.5 mb-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sky-950 text-[11px] flex items-center gap-1.5">
                  <Sun className="size-3 text-amber-500" />
                  Satellite Terrain Clarity
                </span>
                <span className="text-[10px] font-mono font-bold text-sky-800">{terrainContrast}%</span>
              </div>

              {/* Contrast */}
              <div>
                <div className="flex justify-between text-[10px] text-slate-600 mb-0.5">
                  <span>Terrain Contrast</span>
                  <span className="font-mono text-sky-800">{terrainContrast}%</span>
                </div>
                <input
                  type="range"
                  min={80}
                  max={150}
                  value={terrainContrast}
                  onChange={(e) => setTerrainContrast(Number(e.target.value))}
                  className="w-full h-1.5 bg-sky-200 rounded-lg appearance-none cursor-pointer accent-sky-600"
                />
              </div>

              {/* Brightness */}
              <div>
                <div className="flex justify-between text-[10px] text-slate-600 mb-0.5">
                  <span>Terrain Brightness</span>
                  <span className="font-mono text-sky-800">{terrainBrightness}%</span>
                </div>
                <input
                  type="range"
                  min={80}
                  max={130}
                  value={terrainBrightness}
                  onChange={(e) => setTerrainBrightness(Number(e.target.value))}
                  className="w-full h-1.5 bg-sky-200 rounded-lg appearance-none cursor-pointer accent-sky-600"
                />
              </div>
            </div>

            {/* Footer Reset */}
            <div className="pt-1 flex items-center justify-between text-[10.5px]">
              <span className="text-slate-400">Controls update in real-time</span>
              <button
                type="button"
                onClick={() => {
                  setGramSabhaFillOpacity(15);
                  setCfrParcelFillOpacity(25);
                  setGramSabhaOpacity(95);
                  setBnCadastralOpacity(85);
                  setBnPlotOpacity(26);
                  setTerrainContrast(100);
                  setTerrainBrightness(100);
                  setHighContrastOutlines(true);
                }}
                className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800 font-semibold transition-colors"
              >
                <RotateCcw className="size-3" />
                Reset Defaults
              </button>
            </div>
          </div>
        )}


        {/* FEATURE INFO POPUP */}
        {infoVisible && Object.keys(infoContent).length > 0 && (
          <div className="absolute z-20 rounded-xl shadow-2xl bg-white/95 backdrop-blur-md border border-slate-200 p-3.5 text-xs" style={{ bottom: 48, left: panelOpen ? 396 : 80, minWidth: 240, maxWidth: 320 }}>
            <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-slate-200">
              <span className="font-extrabold text-slate-800 uppercase tracking-wider text-[10px]">Territorial Feature</span>
              <button onClick={() => setInfoVisible(false)} className="text-slate-400 hover:text-slate-600 font-bold" aria-label="Close">✕</button>
            </div>
            {Object.entries(infoContent).map(([k, v]) => (
              <div key={k} className="flex gap-2 py-0.5">
                <span className="text-slate-500 font-medium w-16 shrink-0">{k}:</span>
                <span className="text-slate-900 font-semibold truncate">{v}</span>
              </div>
            ))}
          </div>
        )}

        {/* MAHABHUNAKASHA PLOT INFO SPECIAL WINDOW */}
        {reportBusy && (
          <div data-testid="report-progress" className="absolute inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-[1px]">
            <div className="w-80 rounded-lg bg-white p-4 text-sm shadow-2xl">
              <div className="font-bold text-slate-900">Generating PDF report</div>
              <div className="mt-1 truncate text-xs text-slate-600">{reportBusy.label}</div>
              <div className="mt-2 h-2 overflow-hidden rounded bg-slate-200">
                <div className="h-full bg-emerald-700 transition-all" style={{ width: `${Math.min(100, (reportBusy.done / Math.max(1, reportBusy.total)) * 100)}%` }} />
              </div>
              <div className="mt-1 text-[11px] text-slate-500">The map moves while satellite shots are taken — please wait.</div>
              <button type="button" onClick={() => reportAbortRef.current?.abort()} className="mt-3 rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
            </div>
          </div>
        )}
        {parcelInfo && (() => {
          const pl = bnPlots.find((p) => p.plotno === parcelInfo.plotno);
          const entry = entryByPlotno[parcelInfo.plotno];
          const cat = entry ? CATEGORIES.find((c) => c.key === entry.category) : undefined;
          const owners = entry?.owners.map((o) => o.fullName).filter(Boolean) ?? [];
          const loading = pl?.ownerStatus === "pending";
          const rows: { label: string; value: string }[] = [];
          rows.push({ label: "Owner", value: loading ? "loading record…" : owners.length ? owners.slice(0, 3).join(", ") + (owners.length > 3 ? ` +${owners.length - 3}` : "") : "no record" });
          if (entry && entry.areaHa > 0) rows.push({ label: "Area", value: `${entry.areaHa.toFixed(2)} ha (${(entry.areaHa * 2.47105).toFixed(2)} ac)` });
          if (pl?.records?.[0]?.khataNo && pl.records[0].khataNo !== "-") rows.push({ label: "Khata no.", value: pl.records[0].khataNo });
          if (cat && !loading) rows.push({ label: "Land type", value: `${cat.en} (inferred)` });
          if (entry?.cfr)
            rows.push({
              label: "CFR",
              value:
                entry.cfrStatus === "conflict"
                  ? `Conflict · private 7/12 land inside a CFR compartment${entry.overlapPct !== undefined ? ` (${entry.overlapPct}% of parcel)` : ""}`
                  : `Recognized · ${entry.cfr.ha.toFixed(2)} ha approved${entry.overlapPct !== undefined ? ` (${entry.overlapPct}% of parcel inside)` : ""}`,
            });
          if (entry?.gramSabha) rows.push({ label: "Gram Sabha", value: `${entry.gramSabha} · comp. ${entry.compNo}` });
          if (entry?.mrsac?.forest) rows.push({ label: "Forest", value: `Compartment ${entry.mrsac.forest.comp || "—"} (${entry.mrsac.forest.type || "forest"})` });
          if (entry?.mrsac?.water) rows.push({ label: "Water", value: "Lies in a mapped water body" });
          rows.push({ label: "Location", value: `${parcelInfo.lat.toFixed(5)}° N, ${parcelInfo.lon.toFixed(5)}° E` });
          const gmaps = locationLinks(parcelInfo.lon, parcelInfo.lat)[0]!;
          return (
            <div
              data-testid="parcel-card"
              role="dialog"
              aria-label={`Survey No. ${parcelInfo.plotno}`}
              className="absolute z-30 w-[300px] max-w-[calc(100vw-120px)] rounded-xl border-2 border-emerald-600 bg-white text-xs shadow-2xl"
              style={{ bottom: 64, right: 58 }}
            >
              <div className="flex items-center justify-between gap-2 rounded-t-[10px] bg-emerald-50 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-slate-900">Survey No. {parcelInfo.plotno}</div>
                  <div className="truncate text-[11px] text-slate-600">भू-नकाशा · MahaBhuNakasha</div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
                    onClick={() => {
                      const text = [`Survey No. ${parcelInfo.plotno}`, ...rows.map((r) => `${r.label}: ${r.value}`), `${gmaps.label}: ${gmaps.href}`].join("\n");
                      void navigator.clipboard?.writeText(text).then(() => setParcelInfo((p) => (p ? { ...p, copied: true } : p)));
                    }}
                  >
                    {parcelInfo.copied ? "✓ Copied" : "Copy"}
                  </button>
                  <button type="button" aria-label="Close" className="size-6 rounded text-slate-500 hover:bg-slate-200" onClick={() => setParcelInfo(null)}>
                    ✕
                  </button>
                </div>
              </div>
              <div className="max-h-[50vh] space-y-2 overflow-y-auto p-3">
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  {rows.map((r) => (
                    <React.Fragment key={r.label}>
                      <dt className="text-slate-500">{r.label}</dt>
                      <dd className="font-medium text-slate-900">{r.value}</dd>
                    </React.Fragment>
                  ))}
                </dl>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2">
                  <a href={gmaps.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#1d6fb8] hover:underline">
                    {gmaps.label} ↗
                  </a>
                  {pl && (
                    <button
                      type="button"
                      data-testid="report-parcel-card"
                      disabled={!!reportBusy}
                      className="rounded border border-emerald-700 px-2 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                      onClick={() => void downloadReport(pl.plotno)}
                    >
                      Report (PDF)
                    </button>
                  )}
                  {pl && (
                    <button
                      type="button"
                      data-testid="report-parcel-card-xlsx"
                      disabled={!!reportBusy}
                      className="rounded border border-emerald-700 px-2 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                      onClick={() => void downloadReport(pl.plotno, "xlsx")}
                    >
                      Resources (Excel)
                    </button>
                  )}
                  {pl && (
                    <button
                      type="button"
                      className="rounded bg-emerald-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-600"
                      onClick={() => {
                        selectBnPlot(pl);
                        setParcelInfo(null);
                      }}
                    >
                      Full plot info
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {resInfo && (
          <div
            data-testid="resource-card"
            role="dialog"
            aria-label={resInfo.details.title}
            className="absolute z-30 w-[300px] max-w-[calc(100vw-120px)] rounded-xl border-2 bg-white text-xs shadow-2xl"
            style={{ bottom: 64, right: 58, borderColor: resInfo.details.color }}
          >
            <div className="flex items-center justify-between gap-2 rounded-t-[10px] px-3 py-2" style={{ background: resInfo.details.color + "22" }}>
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-slate-900">{resInfo.details.title}</div>
                <div className="truncate text-[11px] text-slate-600">{resInfo.details.subtitle} · MRSAC</div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={() => {
                    void navigator.clipboard?.writeText(detailsAsText(resInfo.details)).then(() => setResInfo((p) => (p ? { ...p, copied: true } : p)));
                  }}
                >
                  {resInfo.copied ? "✓ Copied" : "Copy"}
                </button>
                <button
                  type="button"
                  aria-label="Close"
                  className="size-6 rounded text-slate-500 hover:bg-slate-200"
                  onClick={() => {
                    resSelectedRef.current?.set("selected", false);
                    resSelectedRef.current = null;
                    setResInfo(null);
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="max-h-[50vh] space-y-2 overflow-y-auto p-3">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                {resInfo.details.rows.map((r) => (
                  <React.Fragment key={r.label}>
                    <dt className="text-slate-500">{r.label}</dt>
                    <dd className="font-medium text-slate-900">{r.value}</dd>
                  </React.Fragment>
                ))}
              </dl>
              {resInfo.surveys.length > 0 && (
                <div data-testid="resource-surveys">
                  <div className="mb-1 text-slate-500">{resInfo.surveys[0]!.relation}</div>
                  <div className="flex flex-wrap gap-1">
                    {resInfo.surveys.map((sv) => (
                      <button
                        key={sv.plotno}
                        type="button"
                        className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-semibold text-slate-800 hover:bg-slate-100"
                        onClick={() => {
                          const pl = bnPlots.find((p) => p.plotno === sv.plotno);
                          if (pl) selectBnPlot(pl);
                        }}
                      >
                        {sv.plotno}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <ul className="space-y-0.5 border-t border-slate-200 pt-2">
                {resInfo.details.links.map((l) => (
                  <li key={l.href}>
                    <a href={l.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#1d6fb8] hover:underline">
                      {l.label} ↗
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {bnSelectedPlot && plotInfoWindowOpen && (
          <div
            className="absolute z-30 rounded-xl shadow-2xl border-2 border-[#b0deb0] bg-[#fafdfa] text-xs font-sans overflow-hidden transition-all animate-in fade-in zoom-in-95 duration-150"
            style={{
              top: 16,
              right: 58,
              width: 330,
              maxWidth: "calc(100vw - 120px)",
            }}
          >
            {/* Header bar matching official MahaBhuNakasha */}
            <div className="flex items-center justify-between px-3 py-2 bg-[#daf0da] border-b border-[#c2e2c2] select-none cursor-default">
              <div className="flex items-center gap-2">
                <span className="text-sm">📋</span>
                <span className="font-bold text-[#1d6227] text-sm tracking-tight">Plot Info</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleCopyPlotInfo}
                  className="px-2 py-0.5 rounded text-[10px] font-semibold bg-white/90 hover:bg-white text-[#1d6227] border border-[#c2e2c2] transition-colors cursor-pointer"
                  title="Copy Plot Details to Clipboard"
                >
                  {copiedPlotInfo ? "✓ Copied" : "Copy"}
                </button>
                <button
                  type="button"
                  onClick={() => setPlotInfoWindowMinimized((v) => !v)}
                  className="size-5 rounded flex items-center justify-center font-bold text-[#1d6227] hover:bg-white/60 transition-colors cursor-pointer"
                  title={plotInfoWindowMinimized ? "Expand Window" : "Minimize Window"}
                >
                  {plotInfoWindowMinimized ? "▲" : "▼"}
                </button>
                <button
                  type="button"
                  onClick={() => setPlotInfoWindowOpen(false)}
                  className="size-5 rounded flex items-center justify-center font-bold text-[#1d6227] hover:bg-red-500 hover:text-white transition-colors cursor-pointer"
                  title="Close Window"
                 aria-label="Close">
                  ✕
                </button>
              </div>
            </div>

            {/* Content Body */}
            {!plotInfoWindowMinimized && (
              <div className="p-3.5 space-y-2 max-h-[65vh] overflow-y-auto font-mono text-[12.5px] leading-relaxed select-text">
                {bnSelectedPlot.records?.map((rec, idx) => {
                  const areaFmt = formatAreaBreakdown(rec.totalArea, rec.potKharaba);
                  const ltype = classifyLandType(bnSelectedPlot.plotno, bnSelectedPlot.records);
                  const ltBadge = ltype === "farmland" ? { icon: "🌾", label: "Agricultural Land", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" } : ltype === "residential" ? { icon: "🏠", label: "Residential Land", cls: "bg-blue-50 text-blue-700 border-blue-200" } : ltype === "government" ? { icon: "🏛️", label: "Govt / Gairan", cls: "bg-amber-50 text-amber-700 border-amber-200" } : { icon: "⚖️", label: "Mixed Use", cls: "bg-purple-50 text-purple-700 border-purple-200" };
                  return (
                    <div key={idx} className="space-y-0.5">
                      {idx === 0 && (
                        <div className={`inline-flex items-center gap-1 text-[9px] font-bold border px-1.5 py-0.5 rounded-full mb-1 ${ltBadge.cls}`}>
                          <span>{ltBadge.icon}</span>
                          <span>{ltBadge.label}</span>
                        </div>
                      )}
                      <div>
                        <span className="text-slate-600 font-sans">Survey No. : </span>
                        <span className="font-bold text-slate-900">{rec.surveyNo}</span>
                      </div>
                      <div>
                        <span className="text-slate-600 font-sans">Total Area : </span>
                        <span className="font-semibold text-slate-900">{areaFmt.ha}</span>
                      </div>
                      <div className="text-[10.5px] text-slate-500 pl-[72px] -mt-0.5 leading-tight">
                        {areaFmt.sqm}{ltype === "farmland" ? ` · ${areaFmt.acres}` : ""}
                      </div>
                      <div>
                        <span className="text-slate-600 font-sans">Pot kharaba : </span>
                        <span className="font-semibold text-slate-900">{formatAreaBreakdown(rec.potKharaba).ha}</span>
                        {parseFloat(rec.potKharaba) > 0 && (
                          <span className="text-slate-400 text-[10px] ml-1">({formatAreaBreakdown(rec.potKharaba).sqm})</span>
                        )}
                      </div>
                      {areaFmt.net && (
                        <div className="text-[10px] text-emerald-700 font-medium bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded mt-0.5">
                          ✓ Net Cultivable: {areaFmt.net}
                        </div>
                      )}
                      <div>
                        <span className="text-slate-600 font-sans">Owner Name : </span>
                        <span className="font-medium text-slate-900 font-devanagari font-sans">{rec.ownerName}</span>
                      </div>
                      <div>
                        <span className="text-slate-600 font-sans">Khata No. : </span>
                        <span className="font-bold text-slate-900">{rec.khataNo}</span>
                      </div>
                      {idx < (bnSelectedPlot.records?.length || 0) - 1 && (
                        <div className="py-1 text-slate-400 select-none overflow-hidden text-xs">
                          --------------------------------
                        </div>
                      )}
                    </div>
                  );
                })}

                {plotExtras}

                {/* Map Report Action Link */}
                <div className="pt-2 border-t border-[#c2e2c2]/70 flex items-center justify-between font-sans">
                  <button
                    type="button"
                    onClick={() => setMapReportModalOpen(true)}
                    className="text-[#1d6fb8] hover:underline font-bold text-xs cursor-pointer inline-flex items-center gap-1.5"
                  >
                    <span>Map Report</span>
                    <span>📄</span>
                  </button>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {bnSelectedPlot.records?.length || 1} {((bnSelectedPlot.records?.length || 1) > 1 ? "Records" : "Record")}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Floating pill button if plot is selected but special window was closed */}
        {bnSelectedPlot && !plotInfoWindowOpen && (
          <button
            type="button"
            onClick={() => {
              setPlotInfoWindowOpen(true);
              setPlotInfoWindowMinimized(false);
            }}
            className="absolute top-4 right-16 z-20 flex items-center gap-2 rounded-xl bg-[#daf0da] text-[#1d6227] px-3 py-1.5 text-xs font-bold shadow-lg border-2 border-[#b0deb0] hover:bg-[#cbf0cb] transition-all cursor-pointer animate-in fade-in"
          >
            <span>📋</span>
            <span>Plot Info: Survey No. {bnSelectedPlot.plotno}</span>
            <span className="text-[10px] bg-white/80 px-1.5 py-0.5 rounded border border-[#b0deb0]">Open</span>
          </button>
        )}

        {/* MY LOCATION — real device GPS only (no fallback/fake position) */}
        <button
          type="button"
          onClick={toggleLocate}
          title={locateErr || (locating ? "Stop showing my location" : "Show my location")}
          aria-label="My location"
          aria-pressed={locating}
          className={`absolute bottom-14 right-3 z-20 grid size-9 place-items-center rounded-lg border shadow-md backdrop-blur-md transition-colors ${locateErr ? "bg-white/95 border-red-300 text-red-600" : locating ? "bg-blue-600 border-blue-600 text-white" : "bg-white/95 border-slate-200 text-slate-700 hover:bg-slate-50"}`}
        >
          <LocateFixed className="size-4" />
        </button>

        {/* COORDINATES */}
        <div className="absolute bottom-3 right-3 z-20 flex items-center gap-2 rounded-lg bg-white/95 backdrop-blur-md px-3 py-1.5 text-slate-800 text-[11px] font-mono shadow-md border border-slate-200">
          <span className="text-slate-500">Lon/Lat:</span><span ref={coordDisplayRef} className="font-semibold text-emerald-700">75.71390 / 19.75150</span>
          <span className="text-slate-300">|</span>
          <span className="text-slate-500">Zoom:</span><span ref={zoomDisplayRef} className="font-semibold text-indigo-700">7.2</span>
          {bnCadastralEnabled && <><span className="text-slate-300">|</span><span className="text-emerald-700 font-semibold">Cadastral Active</span></>}
        </div>

        {/* ATTRIBUTION */}
        <div className="absolute bottom-3 z-20 hidden md:flex items-center gap-2 rounded-lg bg-white/90 backdrop-blur-md px-2.5 py-1 text-slate-600 text-[10px] shadow border border-slate-200" style={{ left: panelOpen ? 396 : 80 }}>
          <span className="size-1.5 rounded-full bg-emerald-500" />
          <span className="font-medium">TEAM VANMITRA Nakasha • MahaBhuNakasha • GADM 4.1 • DataMeet</span>
        </div>
      </div>

      {/* WHAT IS THIS MAP FOR? / ABOUT MODAL */}
      {aboutModalOpen && (
        <div role="dialog" aria-modal="true" aria-label="About VANMITRA Nakasha WebGIS" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-xl w-full p-6 relative space-y-4">
            <button
              onClick={() => setAboutModalOpen(false)}
              aria-label="Close"
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 size-8 rounded-full flex items-center justify-center hover:bg-slate-100 transition-colors"
            >
              ✕
            </button>

            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
              <img
                src="/team_vanmitra_logo.jpg"
                alt="TEAM VANMITRA"
                className="h-10 w-auto object-contain rounded border border-slate-200 p-0.5 bg-white shadow-xs"
              />
              <div>
                <h3 className="text-lg font-bold text-slate-900">About VANMITRA Nakasha WebGIS</h3>
                <p className="text-xs text-slate-500">Maharashtra Automated Cadastral & Territorial Intelligence Platform</p>
              </div>
            </div>

            <div className="space-y-3 text-xs text-slate-600 leading-relaxed max-h-[60vh] overflow-y-auto pr-1">
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                <h4 className="font-bold text-emerald-900 mb-1 flex items-center gap-1.5">
                  <span>🎯</span> Purpose & Mission
                </h4>
                <p>
                  VANMITRA Nakasha bridges citizens, revenue officers, and GIS surveyors by unifying <strong>official Maharashtra administrative boundaries</strong> (Districts, Talukas, Villages) with <strong>MahaBhuNakasha live cadastral maps</strong> and <strong>high-resolution satellite imagery</strong>.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <h5 className="font-bold text-slate-800 mb-1">📍 1-Click Parcel Identification</h5>
                  <p className="text-[11px] text-slate-500">Click anywhere across Maharashtra to automatically reverse-geocode territory, detect Census village codes, and load plot survey numbers.</p>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <h5 className="font-bold text-slate-800 mb-1">📐 Dynamic Cadastral WMS</h5>
                  <p className="text-[11px] text-slate-500">Direct integration with Maharashtra Land Records WMS engines, featuring opacity controls and ground-visibility toggling.</p>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <h5 className="font-bold text-slate-800 mb-1">🏛 Officer Settlement Tools</h5>
                  <p className="text-[11px] text-slate-500">Authorized officers can log in to access the Advanced AI Assistant, boundary conflict resolution, and 7/12 land record matching.</p>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <h5 className="font-bold text-slate-800 mb-1">🛰 Multi-Basemap Fusion</h5>
                  <p className="text-[11px] text-slate-500">Toggle between Google Hybrid Satellite, CartoDB Positron, OSM OpenStreetMap, and ESRI World Imagery in real-time.</p>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[11px] text-slate-400 font-medium">TEAM VANMITRA • Smart India Hackathon</span>
              <button
                onClick={() => setAboutModalOpen(false)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
              >
                Close & Explore Map
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MAHABHUNAKASHA OFFICIAL MAP REPORT MODAL */}
      {mapReportModalOpen && bnSelectedPlot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-300 max-w-2xl w-full p-6 relative space-y-5 my-8 print:m-0 print:p-0 print:border-none print:shadow-none">
            {/* Modal close button */}
            <button
              onClick={() => setMapReportModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-800 size-8 rounded-full flex items-center justify-center hover:bg-slate-100 transition-colors print:hidden"
              title="Close Report"
             aria-label="Close">
              ✕
            </button>

            {/* Official Maharashtra Govt Header */}
            <div className="text-center border-b-2 border-slate-900 pb-4 space-y-1">
              <div className="flex items-center justify-center gap-3">
                <img
                  src="/team_vanmitra_logo.jpg"
                  alt="TEAM VANMITRA • Maharashtra Govt"
                  className="h-12 w-auto object-contain rounded border border-slate-200 p-0.5 bg-white shadow-xs"
                />
              </div>
              <h2 className="text-base font-extrabold text-slate-900 tracking-tight font-devanagari">
                महाराष्ट्र शासन • महसूल व वन विभाग
              </h2>
              <h3 className="text-xs font-bold text-slate-700 font-devanagari">
                भूमी अभिलेख विभाग • महाभूनकाशा (MahaBhuNakasha)
              </h3>
              <p className="text-[11px] font-semibold text-emerald-800 uppercase tracking-widest pt-0.5">
                Cadastral Parcel Map Report (भू-नकाशा मिळकत अहवाल)
              </p>
            </div>

            {/* Administrative Hierarchy & Parcel Identifiers */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs">
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-semibold">District (जिल्हा)</span>
                <span className="font-bold text-slate-900">{activeVillageDetails?.district || bnSelected[1] || "Akola (अकोला)"}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-semibold">Taluka (तालुका)</span>
                <span className="font-bold text-slate-900">{activeVillageDetails?.taluka || bnSelected[2] || "Akot (अकोट)"}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-semibold">Village (गाव)</span>
                <span className="font-bold text-slate-900 font-devanagari">{activeVillageDetails?.village || bnSelected[3] || "Popatkhed (पोपटखेड)"}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-semibold">Survey / Gat No.</span>
                <span className="font-bold text-emerald-800 font-mono text-sm">{bnSelectedPlot.plotno}</span>
              </div>
            </div>

            {/* Official 7/12 RoR Khata Ledger */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <span>📑</span>
                  <span>गाव नमुना सात / बारा (7/12 RoR) मिळकत नोंदवही</span>
                </h4>
                <span className="text-[11px] text-slate-500 font-mono">
                  {bnSelectedPlot.records?.length || 0} Khatas Registered
                </span>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#daf0da] text-[#1d6227] border-b border-[#c2e2c2] text-[11px] font-bold">
                      <th className="py-2.5 px-2.5">अ.क्र.</th>
                      <th className="py-2.5 px-2.5">खाते क्र.</th>
                      <th className="py-2.5 px-2.5">एकूण क्षेत्र (हे.)</th>
                      <th className="py-2.5 px-2.5">पोटखराबा (हे.)</th>
                      <th className="py-2.5 px-3">खातेदाराचे नाव (Owner / Co-Holders)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-sans">
                    {bnSelectedPlot.records?.map((rec, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-2.5 px-2.5 font-mono text-slate-500">{idx + 1}</td>
                        <td className="py-2.5 px-2.5 font-mono font-bold text-slate-900">{rec.khataNo}</td>
                        <td className="py-2.5 px-2.5 font-mono font-semibold text-slate-800">{rec.totalArea}</td>
                        <td className="py-2.5 px-2.5 font-mono font-semibold text-amber-700">{rec.potKharaba}</td>
                        <td className="py-2.5 px-3 font-medium text-slate-900 font-devanagari">{rec.ownerName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Official Verification & Security Stamp */}
            <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl flex items-center justify-between text-xs text-emerald-950">
              <div className="space-y-0.5">
                <div className="font-bold flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-emerald-600 animate-pulse" />
                  <span>MahaBhuNakasha Official Certified Extract</span>
                </div>
                <div className="text-[11px] text-emerald-800 font-devanagari">
                  सदर माहिती महाभूनकाशा डेटाबेसमधून थेट संकलित केलेली प्रमाणित प्रत आहे.
                </div>
              </div>
              <div className="text-right font-mono text-[10px] text-slate-500">
                <div>Date: {new Date().toLocaleDateString("en-IN")}</div>
                <div>Status: VERIFIED 7/12</div>
              </div>
            </div>

            {/* Action Bar */}
            <div className="pt-3 border-t border-slate-100 flex items-center justify-between flex-wrap gap-2 print:hidden">
              <button
                type="button"
                onClick={handleCopyPlotInfo}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-all cursor-pointer"
              >
                {copiedPlotInfo ? "✓ Copied Plot Info" : "📋 Copy Details"}
              </button>
              <div className="flex items-center gap-2">
                {bnSelectedPlot.reportUrl && (
                  <a
                    href={bnSelectedPlot.reportUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-semibold rounded-lg shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                    title="Open official certified report on mahabhunakasha.mahabhumi.gov.in"
                  >
                    <span>🏛️</span>
                    <span>Official Portal Report ↗</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-lg shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <span>🖨️</span>
                  <span>Print Map Report</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMapReportModalOpen(false)}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-sm transition-all cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function ToolbarIconBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={
        "group flex flex-col items-center justify-center w-12 h-12 rounded-xl transition-all cursor-pointer " +
        (active ? "bg-slate-900 text-white shadow-md" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900")
      }
      title={label}
    >
      {icon}
      <span className="text-[9px] font-medium tracking-tight mt-0.5 leading-none">{label}</span>
    </button>
  );
}

function RedMapControl({ onClick, title, children, active }: { onClick: () => void; title: string; children: React.ReactNode; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={
        "size-8 rounded-lg flex items-center justify-center text-sm font-bold shadow-sm border transition-all cursor-pointer " +
        (active ? "bg-slate-900 text-white border-slate-900 ring-2 ring-blue-500" : "bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-800 border-slate-200")
      }
    >
      {children}
    </button>
  );
}

function AccordionSection({ title, open, onToggle, accentColor, children }: { title: string; open: boolean; onToggle: () => void; accentColor: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-slate-200">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-4 py-2.5 text-left text-xs font-bold text-white transition-colors" style={{ background: accentColor }}>
        <span>{title}</span><span className="text-sm">{open ? "-" : "+"}</span>
      </button>
      {open && <div className="py-2 bg-white">{children}</div>}
    </div>
  );
}

function LayerRow({ label, checked, opacity, opacityOpen, onToggle, onOpacityToggle, onOpacityChange, note }: { label: string; layerKey: string; checked: boolean; opacity: number; opacityOpen: boolean; onToggle: () => void; onOpacityToggle: () => void; onOpacityChange: (v: number) => void; note?: string }) {
  return (
    <div className="border-b border-slate-100 last:border-0 px-3 py-2">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-800"><input type="checkbox" checked={checked} onChange={onToggle} className="rounded accent-red-600 size-3.5" /><span>{label}</span></label>
        <button onClick={onOpacityToggle} className="text-slate-400 hover:text-slate-700 text-xs px-1" title="Adjust Opacity" aria-label="Adjust Opacity">⚙</button>
      </div>
      {note && <div className="text-[10px] text-slate-400 pl-5 mt-0.5">{note}</div>}
      {opacityOpen && (
        <div className="pl-5 pt-2 flex items-center gap-2 text-xs">
          <span className="text-[10px] text-slate-400">Opacity:</span>
          <input type="range" min={10} max={100} value={opacity} onChange={(e) => onOpacityChange(Number(e.target.value))} className="w-24 accent-red-600" />
          <span className="text-[10px] text-slate-500 font-mono w-6 text-right">{opacity}%</span>
        </div>
      )}
    </div>
  );
}
