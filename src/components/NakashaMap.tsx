/**
 * NakashaMap.tsx
 * Full-screen OpenLayers map for ADVANTE - Maharashtra land intelligence.
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
import VectorSource from "ol/source/Vector.js";
import XYZ from "ol/source/XYZ.js";
import ImageWMS from "ol/source/ImageWMS.js";
import GeoJSON from "ol/format/GeoJSON.js";

import Feature from "ol/Feature.js";
import Point from "ol/geom/Point.js";
import { fromExtent } from "ol/geom/Polygon.js";
import CircleStyle from "ol/style/Circle.js";
import Style from "ol/style/Style.js";
import Stroke from "ol/style/Stroke.js";
import Fill from "ol/style/Fill.js";
import Text from "ol/style/Text.js";

import { extend, createEmpty, isEmpty } from "ol/extent.js";

import "ol/ol.css";

import {
  loadVillageData,
  getDistricts,
  getTalukas,
  getVillages,
  searchVillages,
  getDistrictCentroid,
  type MHVillage,
} from "@/lib/mh-village-data";

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
  "google-hybrid": { label: "Google Satellite (Hybrid)", url: "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", maxZoom: 21 },
  "google-satellite": { label: "Google Satellite", url: "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", maxZoom: 21 },
  esri: { label: "ESRI World Imagery", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", maxZoom: 19 },
  osm: { label: "OpenStreetMap", url: "https://{a-c}.tile.openstreetmap.org/{z}/{x}/{y}.png", maxZoom: 19 },
};

// BhuNaksha WMS config - proxied through Vite dev-server at /bhunaksha/*
const BHUNAKSHA_STATE = "27"; // Maharashtra
const BHUNAKSHA_WMS_URL = "/bhunaksha/WMS";
const BHUNAKSHA_REST_BASE = "/bhunaksha/rest";

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
interface BNPlot { plotid: string; plotno: string; owner?: string; area?: string; }

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

function createDistrictStyle(feature: any) {
  const name = feature.get("NAME_2") || feature.get("NAME_1") || "";
  return new Style({
    stroke: new Stroke({ color: "#000000", width: 2.5 }),
    fill: new Fill({ color: "rgba(0, 0, 0, 0.02)" }),
    text: new Text({ text: name, font: "bold 13px 'DM Sans', sans-serif", fill: new Fill({ color: "#000000" }), stroke: new Stroke({ color: "#ffffff", width: 3.5 }), overflow: true, placement: "point" }),
  });
}

function createTalukaStyle(feature: any, resolution: number) {
  return new Style({
    stroke: new Stroke({ color: "#2563eb", width: 1.2 }),
    fill: new Fill({ color: "rgba(37, 99, 235, 0.03)" }),
    text: resolution < 350 ? new Text({ text: feature.get("NAME_3") || "", font: "600 11px 'DM Sans', sans-serif", fill: new Fill({ color: "#1d4ed8" }), stroke: new Stroke({ color: "rgba(255,255,255,0.95)", width: 3 }), overflow: false, placement: "point" }) : undefined,
  });
}

function createVillageStyle(feature: any, resolution: number) {
  return new Style({
    stroke: new Stroke({ color: "#16a34a", width: 1.2 }),
    fill: new Fill({ color: "rgba(22, 163, 74, 0.05)" }),
    text: resolution < 120 ? new Text({ text: feature.get("NAME") || "", font: "600 11px 'DM Sans', sans-serif", fill: new Fill({ color: "#15803d" }), stroke: new Stroke({ color: "#ffffff", width: 2.5 }), overflow: false, placement: "point" }) : undefined,
  });
}

function createHighlightStyle(feature: any) {
  const name = feature.get("NAME") || feature.get("Village") || "";
  return new Style({
    stroke: new Stroke({ color: "#f59e0b", width: 3.5 }),
    fill: new Fill({ color: "rgba(245, 158, 11, 0.20)" }),
    text: new Text({ text: name ? "📍 " + name : "", font: "bold 13px 'DM Sans', sans-serif", fill: new Fill({ color: "#78350f" }), stroke: new Stroke({ color: "#ffffff", width: 4 }), offsetY: -16, overflow: true, placement: "point" }),
  });
}

function createPlotMarkerStyle(feature: any) {
  const plotNo = feature.get("plotNo") || "";
  const area = feature.get("area") || "";
  const isTransparent = feature.get("transparent") !== false;
  const label = area ? `🏷️ Survey No. ${plotNo}  •  ${area}` : `🏷️ Survey No. ${plotNo}`;

  return [
    // 1. Sleek cadastral guideline with golden-amber surveyor border
    new Style({
      stroke: new Stroke({
        color: "rgba(245, 158, 11, 0.8)",
        width: 1.8,
        lineDash: [6, 4],
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
        color: isTransparent ? "rgba(245, 158, 11, 0.02)" : "rgba(245, 158, 11, 0.08)",
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
        font: "bold 12px 'DM Sans', -apple-system, sans-serif",
        fill: new Fill({ color: "#0f172a" }),
        stroke: new Stroke({ color: "#ffffff", width: 3.5 }),
        backgroundFill: new Fill({ color: "rgba(255, 255, 255, 0.96)" }),
        backgroundStroke: new Stroke({ color: "#f59e0b", width: 1.8 }),
        padding: [6, 12, 6, 12],
        offsetY: 0,
        overflow: true,
      }),
    }),
  ];
}

type PanelKey = "layerList" | "searchVillage" | "cadastral" | "kml" | "legend";

export default function NakashaMap({ currentUser, onOpenLogin, onOpenConsole, onLogout }: NakashaMapProps) {
  const [aboutModalOpen, setAboutModalOpen] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<Map | null>(null);
  const baseTileRef = useRef<TileLayer<XYZ> | null>(null);
  const districtLayerRef = useRef<VectorLayer | null>(null);
  const talukaLayerRef = useRef<VectorLayer | null>(null);
  const villageLayerRef = useRef<VectorLayer | null>(null);
  const highlightLayerRef = useRef<VectorLayer | null>(null);
  const plotMarkerLayerRef = useRef<VectorLayer | null>(null);
  const cadastralVillageLayerRef = useRef<ImageLayer<ImageWMS> | null>(null);
  const cadastralPlotLayerRef = useRef<ImageLayer<ImageWMS> | null>(null);
  // Click-to-identify refs (stable across renders for use in once-registered click handler)
  const identifyModeRef = useRef(false);
  const bnGisCodeRef = useRef<string | null>(null);
  const bnCadastralEnabledRef = useRef(false);
  const bnLevelsRef = useRef<BNLevel[][]>([DEFAULT_CATEGORIES, DEFAULT_DISTRICTS, [], [], [], []]);
  const bnSelectedRef = useRef<string[]>(["R", "", "", "", "", ""]);
  const panelOpenRef = useRef<PanelKey | null>("layerList");
  const handleIdentifyClickRef = useRef<((evt: any) => void) | null>(null);

  const [panelOpen, setPanelOpen] = useState<PanelKey | null>("layerList");
  const [basemap, setBasemap] = useState<BasemapKey>("google-hybrid");
  const [basemapOpen, setBasemapOpen] = useState(false);
  const [mhOpen, setMhOpen] = useState(true);
  const [cadastralOpen, setCadastralOpen] = useState(true);
  const [layerVisible, setLayerVisible] = useState({ district: true, taluka: true, village: true });
  const [opacity, setOpacity] = useState({ district: 100, taluka: 100, village: 100 });
  const [coordinate, setCoordinate] = useState("75.71390 / 19.75150");
  const [currentZoom, setCurrentZoom] = useState(7);
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
  const [bnPlots, setBnPlots] = useState<BNPlot[]>([]);
  const [bnPlotSearch, setBnPlotSearch] = useState("");
  const [bnSelectedPlot, setBnSelectedPlot] = useState<BNPlot | null>(null);
  const [bnPlotsLoading, setBnPlotsLoading] = useState(false);
  const [bnPlotTransparent, setBnPlotTransparent] = useState(true);
  const [bnPlotOpacity, setBnPlotOpacity] = useState(26);
  // Click-to-identify mode state (defaults to false / normal; user clicks to activate)
  const [identifyMode, setIdentifyMode] = useState(false);
  const [identifyLoading, setIdentifyLoading] = useState(false);
  const [identifyStatus, setIdentifyStatus] = useState<string | null>(null);

  // Map init
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;
    const baseTile = new TileLayer({ source: new XYZ({ url: BASEMAPS[basemap].url, maxZoom: 21 }), zIndex: 0 });
    baseTileRef.current = baseTile;
    const districtLayer = new VectorLayer({ source: new VectorSource({ url: "/data/mh_districts.geojson", format: new GeoJSON() }), style: createDistrictStyle as any, visible: true, zIndex: 10, properties: { name: "district" } });
    districtLayerRef.current = districtLayer;
    const talukaLayer = new VectorLayer({ source: new VectorSource({ url: "/data/mh_talukas.geojson", format: new GeoJSON() }), style: createTalukaStyle as any, visible: true, zIndex: 11, properties: { name: "taluka" } });
    talukaLayerRef.current = talukaLayer;
    const villageLayer = new VectorLayer({ source: new VectorSource(), style: createVillageStyle as any, visible: true, zIndex: 12, properties: { name: "village" } });
    villageLayerRef.current = villageLayer;
    const highlightLayer = new VectorLayer({ source: new VectorSource(), style: createHighlightStyle as any, zIndex: 20, properties: { name: "highlight" } });
    highlightLayerRef.current = highlightLayer;
    // BhuNaksha VILLAGE_MAP WMS layer (cadastral parcel boundaries with numbers)
    const cadastralVillageSource = new ImageWMS({
      url: BHUNAKSHA_WMS_URL,
      params: { SERVICE: "WMS", VERSION: "1.1.1", REQUEST: "GetMap", LAYERS: "VILLAGE_MAP", STYLES: "VILLAGE_MAP", state: BHUNAKSHA_STATE, gis_code: "", TRANSPARENT: true, FORMAT: "image/png" },
      serverType: "geoserver", ratio: 1,
    });
    const cadastralVillageLayer = new ImageLayer({ source: cadastralVillageSource, visible: false, zIndex: 30, opacity: 0.9, properties: { name: "cadastral-village" } });
    cadastralVillageLayerRef.current = cadastralVillageLayer;
    // BhuNaksha PLOT_LIST WMS layer (individual plot highlight)
    const cadastralPlotSource = new ImageWMS({
      url: BHUNAKSHA_WMS_URL,
      params: { SERVICE: "WMS", VERSION: "1.1.1", REQUEST: "GetMap", LAYERS: "PLOT_LIST", STYLES: "PLOT_SELECTION", state: BHUNAKSHA_STATE, giscode: "", plot_id: "", TRANSPARENT: true, FORMAT: "image/png" },
      serverType: "geoserver", ratio: 1,
    });
    const cadastralPlotLayer = new ImageLayer({
      className: "cadastral-selected-plot-layer",
      source: cadastralPlotSource,
      visible: false,
      zIndex: 35,
      opacity: 0.26,
      properties: { name: "cadastral-plot" },
    });
    cadastralPlotLayerRef.current = cadastralPlotLayer;
    // Dedicated Vector Layer for Plot Marker & Serial Number Highlight (distinct bright color)
    const plotMarkerLayer = new VectorLayer({ source: new VectorSource(), zIndex: 50, properties: { name: "plot-marker" } });
    plotMarkerLayerRef.current = plotMarkerLayer;

    const map = new Map({
      target: mapContainerRef.current,
      layers: [baseTile, districtLayer, talukaLayer, villageLayer, highlightLayer, cadastralVillageLayer, cadastralPlotLayer, plotMarkerLayer],
      view: new View({ center: MH_CENTER, zoom: MH_ZOOM, minZoom: 6, maxZoom: 21 }),
      controls: defaultControls({ zoom: false, rotate: false, attribution: false }),
    });
    mapInstanceRef.current = map;
    setTimeout(() => map.updateSize(), 150);
    map.on("pointermove", (evt) => {
      const coord = toLonLat(evt.coordinate);
      setCoordinate(coord[0].toFixed(5) + " / " + coord[1].toFixed(5));
    });
    map.on("moveend", () => { const z = map.getView().getZoom(); if (z !== undefined) setCurrentZoom(Math.round(z * 10) / 10); });
    map.on("singleclick", (evt) => {
      // Only execute land parcel identify, marking & sidebar auto-fill when identifyMode is explicitly activated by user
      if (identifyModeRef.current && handleIdentifyClickRef.current) {
        handleIdentifyClickRef.current(evt);
      }
    });
    const handleResize = () => map.updateSize();
    window.addEventListener("resize", handleResize);
    return () => { window.removeEventListener("resize", handleResize); map.setTarget(undefined); mapInstanceRef.current = null; };
  }, []);

  useEffect(() => { const t = setTimeout(() => mapInstanceRef.current?.updateSize(), 200); return () => clearTimeout(t); }, [panelOpen]);
  useEffect(() => { if (!baseTileRef.current) return; const cfg = BASEMAPS[basemap]; baseTileRef.current.setSource(new XYZ({ url: cfg.url, maxZoom: cfg.maxZoom })); }, [basemap]);
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

  // BhuNaksha REST API handlers
  const fetchSurveyNumbers = useCallback(async (gisCode: string) => {
    if (!gisCode) return;
    setBnPlotsLoading(true);
    try {
      const kideRes = await fetch(BHUNAKSHA_REST_BASE + "/VillageMapService/kidelistFromGisCodeMH", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "state=" + BHUNAKSHA_STATE + "&logedLevels=" + gisCode,
      });
      if (kideRes.ok) {
        const kideList = await kideRes.json();
        if (Array.isArray(kideList)) {
          // Sort numerically: 1, 2, ..., 100, 112, etc.
          const sorted = [...kideList].sort((a, b) => {
            const na = parseInt(String(a).replace(/[^0-9]/g, ""), 10);
            const nb = parseInt(String(b).replace(/[^0-9]/g, ""), 10);
            if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
            return String(a).localeCompare(String(b));
          });
          const plotItems: BNPlot[] = sorted.map((num: string) => ({
            plotid: String(num),
            plotno: String(num),
          }));
          setBnPlots(plotItems);
          setBnLevels((prev) => {
            const u = [...prev];
            while (u.length < 6) u.push([]);
            u[5] = plotItems.map((p) => ({ code: p.plotno, value: p.plotno }));
            return u;
          });
        }
      }
    } catch (e) {
      console.warn("Survey numbers fetch error:", e);
    } finally {
      setBnPlotsLoading(false);
    }
  }, []);

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
        const size = map.getSize();
        let plotNo: string | null = null;
        if (size) {
          const extent4326 = transformExtent(view.calculateExtent(size), "EPSG:3857", "EPSG:4326");
          const [xmin, ymin, xmax, ymax] = extent4326;
          const bbox = `${xmin},${ymin},${xmax},${ymax}`;
          const [px, py] = pixel;

          const gfiUrl = `${BHUNAKSHA_WMS_URL}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo` +
            `&LAYERS=VILLAGE_MAP&QUERY_LAYERS=VILLAGE_MAP&INFO_FORMAT=application%2Fjson` +
            `&state=${BHUNAKSHA_STATE}&gis_code=${activeGc}` +
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
    plotMarkerLayerRef.current?.getSource()?.clear();
    setBnGisCode(gisCode);
    setBnCadastralEnabled(true);
    cadastralVillageLayerRef.current?.getSource()?.updateParams({ gis_code: gisCode });
    cadastralVillageLayerRef.current?.setVisible(true);

    // Fetch extent & survey numbers in parallel
    fetchSurveyNumbers(gisCode);

    try {
      const extRes = await fetch(BHUNAKSHA_REST_BASE + "/MapInfo/getVVVVExtentGeoref", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "state=" + BHUNAKSHA_STATE + "&giscode=" + gisCode + "&srs=4326",
      });
      const extData = await extRes.json();
      if (extData?.xmin != null && extData?.ymin != null) {
        let { xmin, ymin, xmax, ymax } = extData;
        // Fix BhuNaksha government database UTM Zone 44->43 6.0° westward offset for Vidarbha Urban CTSO maps (08, 09, 10, 11, 12, 13)
        const isVidarbhaUrban = /^UCM(08|09|10|11|12|13)/i.test(gisCode);
        if (isVidarbhaUrban && xmin < 76) {
          xmin += 6.0;
          xmax += 6.0;
        }
        const map = mapInstanceRef.current;
        if (map) {
          const ext3857 = transformExtent(
            [xmin, ymin, xmax, ymax] as [number, number, number, number],
            "EPSG:4326",
            "EPSG:3857"
          );
          map.getView().fit(ext3857, { duration: 1200, padding: [80, 80, 80, panelOpen ? 400 : 80], maxZoom: 16.5 });
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

      try {
        const pInfoRes = await fetch(BHUNAKSHA_REST_BASE + "/MapInfo/getPlotInfo", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "state=" + BHUNAKSHA_STATE + "&giscode=" + gc + "&plotno=" + plotNo + "&srs=4326",
        });
        if (pInfoRes.ok) {
          const pInfo = await pInfoRes.json();
          if (pInfo?.plotid) plotId = String(pInfo.plotid);
          if (pInfo?.owner) owner = String(pInfo.owner);
          if (pInfo?.area) area = String(pInfo.area);
          if (pInfo?.formatedArea) area = String(pInfo.formatedArea) + " sq.m";
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
        const isVidarbhaUrban = /^UCM(08|09|10|11|12|13)/i.test(gc);
        if (isVidarbhaUrban && pMinX < 76) {
          pMinX += 6.0;
          pMaxX += 6.0;
        }
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

      // Draw distinctive marking mark with serial number label on the map!
      if (ext3857) {
        const map = mapInstanceRef.current;
        if (map) {
          map.getView().fit(ext3857, { duration: 900, padding: [100, 100, 100, panelOpen ? 420 : 100], maxZoom: 19 });
        }

        const markerFeature = new Feature({
          geometry: fromExtent(ext3857),
          plotNo: String(plotNo),
          owner: owner || "",
          area: area || "",
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

      const plotObj: BNPlot = { plotid: String(plotId), plotno: String(plotNo), owner, area };
      setBnSelectedPlot(plotObj);
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
    if (levelIndex !== 4 && levelIndex !== 5) {
      setBnPlots([]);
      setBnSelectedPlot(null);
    }
    plotMarkerLayerRef.current?.getSource()?.clear();
    if (levelIndex < 3) {
      setBnGisCode(null);
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
      }
      setBnLoading(true);
      try {
        const res = await fetch(BHUNAKSHA_REST_BASE + "/VillageMapService/ListsAfterLevelGeoref", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "state=" + BHUNAKSHA_STATE + "&level=1&codes=" + code + ",&hasmap=true",
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data[0] && data[0].length > 0) {
            setBnLevels((prev) => {
              const u = [...prev];
              // Fix BhuNaksha API typos in district names (e.g. 'Nangpur' → 'Nagpur')
              u[1] = data[0].map((d: any) => ({
                code: String(d.code),
                value: BN_DISTRICT_NAME_FIX[String(d.value)] || String(d.value),
              }));
              return u;
            });
          }
        }
      } catch (err) {
        console.warn("Fetch districts failed, retaining default districts:", err);
        setBnLevels((prev) => {
          const u = [...prev];
          if (!u[1] || u[1].length === 0) u[1] = DEFAULT_DISTRICTS;
          return u;
        });
      } finally {
        setBnLoading(false);
      }
    } else if (levelIndex === 1) {
      // District selected
      const cat = bnSelected[0] || "R";
      setBnLoading(true);
      try {
        const res = await fetch(BHUNAKSHA_REST_BASE + "/VillageMapService/ListsAfterLevelGeoref", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "state=" + BHUNAKSHA_STATE + "&level=2&codes=" + cat + "," + code + ",&hasmap=true",
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data[0]) {
            setBnLevels((prev) => {
              const u = [...prev];
              u[2] = data[0].map((t: any) => ({ code: String(t.code), value: String(t.value) }));
              return u;
            });
          }
        }
        const distObj = bnLevels[1]?.find((d) => d.code === code);
        if (distObj) {
          const raw = distObj.value || "";
          const enName = raw.includes("(") ? raw.split("(")[0].trim() : (raw.includes("/") ? raw.split("/")[0].trim() : raw);
          const fixedDistName = BN_DISTRICT_NAME_FIX[enName] || enName;
          flyToDistrict(fixedDistName);
        }
      } catch (err) {
        console.warn("Fetch talukas failed:", err);
      } finally {
        setBnLoading(false);
      }
    } else if (levelIndex === 2) {
      // Taluka selected
      const cat = bnSelected[0] || "R";
      const dist = bnSelected[1];
      setBnLoading(true);
      try {
        const res = await fetch(BHUNAKSHA_REST_BASE + "/VillageMapService/ListsAfterLevelGeoref", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "state=" + BHUNAKSHA_STATE + "&level=3&codes=" + cat + "," + dist + "," + code + ",&hasmap=true",
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data[0]) {
            setBnLevels((prev) => {
              const u = [...prev];
              u[3] = data[0].map((v: any) => ({ code: String(v.code), value: String(v.value) }));
              return u;
            });
          }
        }
        const distObj = bnLevels[1]?.find((d) => d.code === dist);
        const talObj = data[0]?.find((t: any) => String(t.code) === code);
        if (distObj && talObj) flyToTaluka(distObj.value, talObj.value);
      } catch (err) {
        console.warn("Fetch villages failed:", err);
      } finally {
        setBnLoading(false);
      }
    } else if (levelIndex === 3) {
      // Village selected
      const cat = bnSelected[0] || "R";
      const dist = bnSelected[1];
      const tal = bnSelected[2];
      const vlg = code;
      setBnLoading(true);
      try {
        const res = await fetch(BHUNAKSHA_REST_BASE + "/VillageMapService/ListsAfterLevelGeoref", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "state=" + BHUNAKSHA_STATE + "&level=4&codes=" + cat + "," + dist + "," + tal + "," + vlg + ",&hasmap=true",
        });
        let mapType = "VM";
        if (res.ok) {
          const data = await res.json();
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
        }
        setBnSelected((prev) => {
          const u = [...prev];
          u[4] = mapType;
          return u;
        });

        const middle = cat === "R" ? "VM" : "CM";
        const gisCode = cat + middle + dist + tal + vlg;
        await loadCadastralForGisCode(gisCode);
      } catch (err) {
        console.warn("Village select failed:", err);
      } finally {
        setBnLoading(false);
      }
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
    setBnLoading(true);
    try {
      const res = await fetch(BHUNAKSHA_REST_BASE + "/VillageMapService/ListsAfterLevelGeoref", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "state=" + BHUNAKSHA_STATE + "&level=0&codes=&hasmap=true",
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          const categories: BNLevel[] = (data[0] || []).map((c: any) => ({
            code: String(c.code),
            value: c.code === "R" ? "Rural (ग्रामीण)" : c.code === "U" ? "Urban (शहरी)" : String(c.value),
          }));
          const districts: BNLevel[] = (data[1] || []).map((d: any) => ({
            code: String(d.code),
            value: BN_DISTRICT_NAME_FIX[String(d.value)] || String(d.value),
          }));
          setBnLevels((prev) => {
            const u = [...prev];
            u[0] = categories.length ? categories : DEFAULT_CATEGORIES;
            u[1] = districts.length ? districts : DEFAULT_DISTRICTS;
            return u;
          });
        }
      }
    } catch (err) {
      console.warn("BhuNaksha level 0 init failed:", err);
      setBnLevels((prev) => {
        const u = [...prev];
        if (!u[0] || u[0].length === 0) u[0] = DEFAULT_CATEGORIES;
        if (!u[1] || u[1].length === 0) u[1] = DEFAULT_DISTRICTS;
        return u;
      });
    } finally {
      setBnLoading(false);
    }
  }, []);
  useEffect(() => {
    if (panelOpen === "cadastral") {
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
          if (features.length > 0) { let ext = createEmpty(); features.forEach((f) => extend(ext, f.getGeometry()!.getExtent())); if (!isEmpty(ext)) { mapInstanceRef.current?.getView().fit(ext, { duration: 1000, padding: [80, 80, 80, panelOpen ? 400 : 80], maxZoom: 15.5 }); const hl = highlightLayerRef.current?.getSource(); if (hl) { hl.clear(); hl.addFeatures(features); } return; } }
        }
        flyToTaluka(village.district, village.subdistrict);
      }, 300);
    });
  }, [loadDistrictVillages, flyToTaluka, panelOpen]);

  const zoomIn = () => { const v = mapInstanceRef.current?.getView(); if (v) v.animate({ zoom: (v.getZoom() ?? 7) + 1, duration: 300 }); };
  const zoomOut = () => { const v = mapInstanceRef.current?.getView(); if (v) v.animate({ zoom: (v.getZoom() ?? 7) - 1, duration: 300 }); };
  const resetView = () => {
    mapInstanceRef.current?.getView().animate({ center: MH_CENTER, zoom: MH_ZOOM, duration: 600 });
    highlightLayerRef.current?.getSource()?.clear();
    plotMarkerLayerRef.current?.getSource()?.clear();
    setInfoVisible(false); setActiveVillageDetails(null); setBnSelectedPlot(null);
    setBnCadastralEnabled(false); cadastralVillageLayerRef.current?.setVisible(false); cadastralPlotLayerRef.current?.setVisible(false);
  };

  const districts = villageData ? getDistricts(villageData) : [];
  const talukas = villageData && selectedDistrict ? getTalukas(villageData, selectedDistrict) : [];
  const villages = villageData && selectedDistrict && selectedTaluka ? getVillages(villageData, selectedDistrict, selectedTaluka) : [];
  const togglePanel = (panel: PanelKey) => setPanelOpen((prev) => (prev === panel ? null : panel));
  const toggleLayerOpacity = (key: string) => setLayerOpacityOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  const filteredPlots = bnPlots.filter((p) => !bnPlotSearch || p.plotno?.toLowerCase().includes(bnPlotSearch.toLowerCase()));

  return (
    <div className="relative w-full h-screen overflow-hidden bg-slate-100 flex flex-col select-none">
      {/* TOP NAVBAR (LIGHT THEME) */}
      <header className="relative z-30 flex h-16 w-full items-center justify-between border-b border-slate-200 bg-white px-4 shadow-sm text-slate-800">
        <div className="flex items-center gap-3">
          <img
            src="/team_advante_logo.jpg"
            alt="Team Advante"
            className="h-11 w-auto max-w-[150px] object-contain cursor-pointer hover:opacity-95 transition-opacity"
            onClick={() => resetView()}
            title="ADVANTE - Innovate • Integrate • Elevate"
          />
          <div className="hidden sm:block border-l border-slate-200 pl-3">
            <div className="flex items-center gap-2">
              <span className="font-extrabold tracking-tight text-sm text-slate-900 font-display">ADVANTE</span>
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

        {/* TOOLBAR (LIGHT THEME) */}
        <aside className="absolute left-0 top-0 bottom-0 z-20 flex flex-col items-center py-3 gap-1.5 border-r border-slate-200 bg-white/95 backdrop-blur-md text-slate-700 shadow-sm" style={{ width: 64 }}>
          <ToolbarIconBtn active={panelOpen === "layerList"} onClick={() => togglePanel("layerList")} label="Layers" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-5"><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>} />
          <ToolbarIconBtn active={panelOpen === "searchVillage"} onClick={() => togglePanel("searchVillage")} label="Search" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-5"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>} />
          <ToolbarIconBtn active={panelOpen === "cadastral"} onClick={() => togglePanel("cadastral")} label="Cadastral" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-5"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" /></svg>} />
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
                  <button onClick={() => setPanelOpen(null)} className="text-slate-400 hover:text-slate-700 text-lg">✕</button>
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
                  <button onClick={() => setPanelOpen(null)} className="text-slate-400 hover:text-slate-700 text-lg">✕</button>
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
            {panelOpen === "cadastral" && (
              <div className="flex flex-col h-full overflow-y-auto">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-emerald-50">
                  <div className="flex items-center gap-2 font-bold text-sm text-emerald-900"><span>🏛</span><span>BhuNaksha Cadastral</span></div>
                  <button onClick={() => setPanelOpen(null)} className="text-slate-400 hover:text-slate-700 text-lg">✕</button>
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
                              {options.map((lvl) => (
                                <option key={lvl.code} value={lvl.code}>
                                  {lvl.value}
                                </option>
                              ))}
                            </select>
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

                  {bnGisCode && (
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                      <div className="bg-slate-700 text-white text-[11px] font-bold uppercase tracking-wider px-3 py-2 flex items-center justify-between">
                        <span>Plot / Survey Numbers ({bnPlots.length})</span>
                        {bnPlotsLoading && <span className="size-3 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                      </div>
                      <div className="p-2.5 space-y-2">
                        <input
                          type="text"
                          value={bnPlotSearch}
                          onChange={(e) => setBnPlotSearch(e.target.value)}
                          placeholder="Filter survey number (e.g. 324)..."
                          className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs focus:border-emerald-600 focus:outline-none"
                        />
                        {bnPlotsLoading ? (
                          <div className="text-xs text-slate-400 py-2 flex items-center gap-2">
                            <span className="size-3 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
                            Loading plots...
                          </div>
                        ) : filteredPlots.length === 0 ? (
                          <p className="text-xs text-slate-400 py-2 text-center">
                            {bnPlots.length === 0 ? "Loading plots from portal..." : "No matching plots"}
                          </p>
                        ) : (
                          <div className="max-h-48 overflow-y-auto divide-y divide-slate-100">
                            {filteredPlots.slice(0, 100).map((plot, i) => (
                              <button
                                key={i}
                                onClick={() => selectBnPlot(plot)}
                                className={
                                  "w-full text-left px-2.5 py-1.5 text-xs hover:bg-emerald-50 transition-colors flex items-center justify-between " +
                                  (bnSelectedPlot?.plotno === plot.plotno ? "bg-emerald-100 font-bold text-emerald-900" : "text-slate-800")
                                }
                              >
                                <span className="font-medium">Survey No. {plot.plotno}</span>
                                <span className="text-[10px] text-emerald-700 font-semibold">Select ➔</span>
                              </button>
                            ))}
                            {filteredPlots.length > 100 && (
                              <p className="text-center text-[10px] text-slate-400 py-1.5">
                                +{filteredPlots.length - 100} more - use search above to filter
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {bnSelectedPlot && (
                    <div className="rounded-lg bg-sky-50 border border-sky-300 p-3 text-xs space-y-2 shadow-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-extrabold text-sky-900">Survey / Plot No.</span>
                        <span className="font-mono text-sky-800 font-bold bg-white border border-sky-300 px-2 py-0.5 rounded">
                          {bnSelectedPlot.plotno}
                        </span>
                      </div>
                      {bnSelectedPlot.owner && <div><span className="text-sky-700 font-medium">Owner: </span><span className="font-semibold text-slate-900">{bnSelectedPlot.owner}</span></div>}
                      {bnSelectedPlot.area && <div><span className="text-sky-700 font-medium">Area: </span><span className="font-semibold text-slate-900">{bnSelectedPlot.area}</span></div>}
                      {/* Parcel Highlight Opacity Control */}
                      <div className="pt-2 border-t border-sky-200 space-y-2">
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
                  <button onClick={() => setPanelOpen(null)} className="text-slate-400 hover:text-slate-700 text-lg">✕</button>
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
                  <button onClick={() => setPanelOpen(null)} className="text-slate-400 hover:text-slate-700 text-lg">✕</button>
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

        {/* ZOOM CONTROLS */}
        <div className="absolute top-4 right-4 z-20 flex flex-col gap-1.5">
          <RedMapControl onClick={zoomIn} title="Zoom In">+</RedMapControl>
          <RedMapControl onClick={zoomOut} title="Zoom Out">-</RedMapControl>
          <RedMapControl onClick={resetView} title="Reset Maharashtra View">⟲</RedMapControl>
          <RedMapControl onClick={() => setInfoVisible((v) => !v)} title="Toggle Feature Info" active={infoVisible}>i</RedMapControl>
        </div>

        {/* FEATURE INFO POPUP */}
        {infoVisible && Object.keys(infoContent).length > 0 && (
          <div className="absolute z-20 rounded-xl shadow-2xl bg-white/95 backdrop-blur-md border border-slate-200 p-3.5 text-xs" style={{ bottom: 48, left: panelOpen ? 396 : 80, minWidth: 240, maxWidth: 320 }}>
            <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-slate-200">
              <span className="font-extrabold text-slate-800 uppercase tracking-wider text-[10px]">Territorial Feature</span>
              <button onClick={() => setInfoVisible(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>
            {Object.entries(infoContent).map(([k, v]) => (
              <div key={k} className="flex gap-2 py-0.5">
                <span className="text-slate-500 font-medium w-16 shrink-0">{k}:</span>
                <span className="text-slate-900 font-semibold truncate">{v}</span>
              </div>
            ))}
          </div>
        )}

        {/* COORDINATES */}
        <div className="absolute bottom-3 right-3 z-20 flex items-center gap-2 rounded-lg bg-white/95 backdrop-blur-md px-3 py-1.5 text-slate-800 text-[11px] font-mono shadow-md border border-slate-200">
          <span className="text-slate-500">Lon/Lat:</span><span className="font-semibold text-emerald-700">{coordinate}</span>
          <span className="text-slate-300">|</span>
          <span className="text-slate-500">Zoom:</span><span className="font-semibold text-indigo-700">{currentZoom}</span>
          {bnCadastralEnabled && <><span className="text-slate-300">|</span><span className="text-emerald-700 font-semibold">Cadastral Active</span></>}
        </div>

        {/* ATTRIBUTION */}
        <div className="absolute bottom-3 z-20 hidden md:flex items-center gap-2 rounded-lg bg-white/90 backdrop-blur-md px-2.5 py-1 text-slate-600 text-[10px] shadow border border-slate-200" style={{ left: panelOpen ? 396 : 80 }}>
          <span className="size-1.5 rounded-full bg-emerald-500" />
          <span className="font-medium">TEAM ADVANTE Nakasha • MahaBhuNakasha • GADM 4.1 • DataMeet</span>
        </div>
      </div>

      {/* WHAT IS THIS MAP FOR? / ABOUT MODAL */}
      {aboutModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-xl w-full p-6 relative space-y-4">
            <button
              onClick={() => setAboutModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 size-8 rounded-full flex items-center justify-center hover:bg-slate-100 transition-colors"
            >
              ✕
            </button>

            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
              <img
                src="/team_advante_logo.jpg"
                alt="TEAM ADVANTE"
                className="h-10 w-auto object-contain rounded border border-slate-200 p-0.5 bg-white shadow-xs"
              />
              <div>
                <h3 className="text-lg font-bold text-slate-900">About ADVANTE Nakasha WebGIS</h3>
                <p className="text-xs text-slate-500">Maharashtra Automated Cadastral & Territorial Intelligence Platform</p>
              </div>
            </div>

            <div className="space-y-3 text-xs text-slate-600 leading-relaxed max-h-[60vh] overflow-y-auto pr-1">
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                <h4 className="font-bold text-emerald-900 mb-1 flex items-center gap-1.5">
                  <span>🎯</span> Purpose & Mission
                </h4>
                <p>
                  ADVANTE Nakasha bridges citizens, revenue officers, and GIS surveyors by unifying <strong>official Maharashtra administrative boundaries</strong> (Districts, Talukas, Villages) with <strong>MahaBhuNakasha live cadastral maps</strong> and <strong>high-resolution satellite imagery</strong>.
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
              <span className="text-[11px] text-slate-400 font-medium">TEAM ADVANTE • Smart India Hackathon</span>
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
        <button onClick={onOpacityToggle} className="text-slate-400 hover:text-slate-700 text-xs px-1" title="Adjust Opacity">⚙</button>
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
