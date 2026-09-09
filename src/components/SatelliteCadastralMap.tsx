import React, { useEffect, useRef, useState, useMemo } from "react";
import type * as LType from "leaflet";
import "leaflet/dist/leaflet.css";

// SSR guard: Leaflet accesses window at evaluation time
const L: typeof LType = typeof window !== "undefined" ? ((await import("leaflet")).default as any) : ({} as any);
import {
  Satellite, Layers, Plus, Minus, Navigation, PenTool, Check, Trash2,
  AlertTriangle, ShieldCheck, Eye, Sparkles, MapPin, Key, X, SlidersHorizontal,
  History, Clock, CheckCircle2
} from "lucide-react";
import {
  surveySummaries, claimants, getClaimantsBySurvey,
  type SurveySummary, type SurveyStatus
} from "@/lib/ozar-data";

// ── Geographic Center of Ozar Village, Palghar District, Maharashtra ─────────
// Centered on the Palghar / Jawhar forested CFR zone: ~19.9280° N, 73.2210° E
const OZAR_PALGHAR_CENTER: [number, number] = [19.9280, 73.2210];

// ── Ozar CFR Boundary Polygon (Palghar District) ─────────────────────────────
export const OZAR_CFR_BOUNDARY_PALGHAR: [number, number][] = [
  [19.9360, 73.2120],
  [19.9372, 73.2265],
  [19.9335, 73.2345],
  [19.9240, 73.2365],
  [19.9172, 73.2305],
  [19.9160, 73.2175],
  [19.9205, 73.2095],
  [19.9295, 73.2085],
];

// ── Conflict Halo Zones (circular red translucent alert perimeters) ─────────
export interface ConflictHalo {
  center: [number, number];
  radiusMeters: number;
  label: string;
}

const CONFLICT_HALOS: ConflictHalo[] = [
  { center: [19.9290, 73.2205], radiusMeters: 280, label: "Survey 324 Multi-Claimant Cluster" },
  { center: [19.9315, 73.2140], radiusMeters: 170, label: "Survey 316 Parcel Fragment" },
  { center: [19.9248, 73.2270], radiusMeters: 190, label: "Survey 324 South-East Overlap" },
  { center: [19.9205, 73.2135], radiusMeters: 160, label: "Survey 316 South Fragment" },
];

// ── Precision Polygonal Cadastral Parcels (matching reference image) ────────
export interface CadastralParcelPolygon {
  id: string;
  surveyNo: string;
  nameEnglish: string;
  nameMarathi: string;
  areaHa: number;
  status: SurveyStatus;
  useType: "homestead" | "farmland" | "forest";
  polygon: [number, number][];
  center: [number, number];
}

export const PRECISE_PARCELS: CadastralParcelPolygon[] = [
  // Top-left S-324 clusters
  {
    id: "p-324-1",
    surveyNo: "324",
    nameEnglish: "Devaje Ragho Deva",
    nameMarathi: "देवजे राघो देवा",
    areaHa: 0.40,
    status: "Conflict",
    useType: "farmland",
    polygon: [[19.9355, 73.2130], [19.9358, 73.2160], [19.9340, 73.2162], [19.9338, 73.2132]],
    center: [19.9348, 73.2145],
  },
  {
    id: "p-324-2",
    surveyNo: "324",
    nameEnglish: "Chunilal Bachu Phadavale",
    nameMarathi: "चुनिलाल बचू फडवळे",
    areaHa: 1.40,
    status: "Conflict",
    useType: "forest",
    polygon: [[19.9358, 73.2160], [19.9360, 73.2195], [19.9338, 73.2198], [19.9340, 73.2162]],
    center: [19.9350, 73.2178],
  },
  {
    id: "p-324-3",
    surveyNo: "324",
    nameEnglish: "Shankar Kakadaya Khanajhode",
    nameMarathi: "शंकर काकडया खानझोडे",
    areaHa: 0.45,
    status: "Conflict",
    useType: "farmland",
    polygon: [[19.9360, 73.2195], [19.9365, 73.2235], [19.9342, 73.2238], [19.9338, 73.2198]],
    center: [19.9352, 73.2215],
  },
  {
    id: "p-324-4",
    surveyNo: "324",
    nameEnglish: "Pavani Bonge",
    nameMarathi: "पवनी बोंगे",
    areaHa: 0.90,
    status: "Conflict",
    useType: "farmland",
    polygon: [[19.9365, 73.2235], [19.9368, 73.2270], [19.9345, 73.2272], [19.9342, 73.2238]],
    center: [19.9355, 73.2252],
  },
  {
    id: "p-324-5",
    surveyNo: "324",
    nameEnglish: "Nasu Gurav",
    nameMarathi: "नासू गुरव",
    areaHa: 1.15,
    status: "Verified",
    useType: "forest",
    polygon: [[19.9368, 73.2270], [19.9362, 73.2305], [19.9340, 73.2300], [19.9345, 73.2272]],
    center: [19.9354, 73.2288],
  },

  // S-316 clusters
  {
    id: "p-316-1",
    surveyNo: "316",
    nameEnglish: "Sitaram Devaji Diva",
    nameMarathi: "सिताराम देवजी दिवा",
    areaHa: 0.05,
    status: "Under review",
    useType: "homestead",
    polygon: [[19.9338, 73.2132], [19.9340, 73.2162], [19.9318, 73.2160], [19.9315, 73.2130]],
    center: [19.9328, 73.2146],
  },
  {
    id: "p-316-2",
    surveyNo: "316",
    nameEnglish: "Ramaji Lal Kadu",
    nameMarathi: "रामजी लाल कडू",
    areaHa: 0.05,
    status: "Under review",
    useType: "homestead",
    polygon: [[19.9315, 73.2130], [19.9318, 73.2160], [19.9295, 73.2158], [19.9292, 73.2128]],
    center: [19.9305, 73.2144],
  },
  {
    id: "p-316-3",
    surveyNo: "316",
    nameEnglish: "Shalu Deu Rade",
    nameMarathi: "शालु देऊ रडे",
    areaHa: 0.50,
    status: "Conflict",
    useType: "farmland",
    polygon: [[19.9292, 73.2128], [19.9295, 73.2158], [19.9270, 73.2155], [19.9268, 73.2125]],
    center: [19.9282, 73.2140],
  },

  // Central large S-324 multi-polygon cluster
  {
    id: "p-324-6",
    surveyNo: "324",
    nameEnglish: "Pandu Dharma Diva",
    nameMarathi: "पांडू धर्मा दिवा",
    areaHa: 2.00,
    status: "Conflict",
    useType: "forest",
    polygon: [[19.9338, 73.2198], [19.9342, 73.2238], [19.9315, 73.2240], [19.9312, 73.2200]],
    center: [19.9327, 73.2218],
  },
  {
    id: "p-324-7",
    surveyNo: "324",
    nameEnglish: "Chitaman Bhovar",
    nameMarathi: "चितामण भोवर",
    areaHa: 1.30,
    status: "Conflict",
    useType: "farmland",
    polygon: [[19.9342, 73.2238], [19.9345, 73.2272], [19.9320, 73.2275], [19.9315, 73.2240]],
    center: [19.9330, 73.2255],
  },
  {
    id: "p-324-8",
    surveyNo: "324",
    nameEnglish: "Lahanu Rupaji Kharapade",
    nameMarathi: "लहानू रुपजी खरपडे",
    areaHa: 2.70,
    status: "Conflict",
    useType: "forest",
    polygon: [[19.9312, 73.2200], [19.9315, 73.2240], [19.9288, 73.2242], [19.9285, 73.2202]],
    center: [19.9300, 73.2220],
  },
  {
    id: "p-324-9",
    surveyNo: "324",
    nameEnglish: "Kisan Garel",
    nameMarathi: "किसन गरेल",
    areaHa: 2.00,
    status: "Conflict",
    useType: "forest",
    polygon: [[19.9315, 73.2240], [19.9320, 73.2275], [19.9292, 73.2278], [19.9288, 73.2242]],
    center: [19.9304, 73.2258],
  },
  {
    id: "p-324-10",
    surveyNo: "324",
    nameEnglish: "Ramesh Ragho Diva",
    nameMarathi: "रमेश राघो दिवा",
    areaHa: 0.90,
    status: "Verified",
    useType: "farmland",
    polygon: [[19.9285, 73.2202], [19.9288, 73.2242], [19.9262, 73.2245], [19.9260, 73.2205]],
    center: [19.9274, 73.2224],
  },
  {
    id: "p-324-11",
    surveyNo: "324",
    nameEnglish: "Kashiram Ladakya Tembare",
    nameMarathi: "काशिराम लाडक्या टेंबरे",
    areaHa: 0.90,
    status: "Verified",
    useType: "farmland",
    polygon: [[19.9288, 73.2242], [19.9292, 73.2278], [19.9268, 73.2280], [19.9262, 73.2245]],
    center: [19.9278, 73.2260],
  },

  // Western parcels: S-234, S-327
  {
    id: "p-234-1",
    surveyNo: "234",
    nameEnglish: "Navaji Lakshya Kadu",
    nameMarathi: "नावजी लक्ष्या कडू",
    areaHa: 0.09,
    status: "Verified",
    useType: "homestead",
    polygon: [[19.9285, 73.2100], [19.9288, 73.2125], [19.9265, 73.2125], [19.9262, 73.2100]],
    center: [19.9275, 73.2112],
  },
  {
    id: "p-327-1",
    surveyNo: "327",
    nameEnglish: "Ashok Dhavalu Bhoye",
    nameMarathi: "अशोक धवळू भोये",
    areaHa: 0.60,
    status: "Verified",
    useType: "forest",
    polygon: [[19.9265, 73.2125], [19.9268, 73.2155], [19.9242, 73.2152], [19.9240, 73.2122]],
    center: [19.9254, 73.2138],
  },

  // Southern row: S-224, S-317, S-326, S-336
  {
    id: "p-224-1",
    surveyNo: "224",
    nameEnglish: "Deu Lakshya Phadavale",
    nameMarathi: "देऊ लक्ष्या फडवळे",
    areaHa: 0.80,
    status: "Under review",
    useType: "farmland",
    polygon: [[19.9240, 73.2152], [19.9242, 73.2185], [19.9215, 73.2182], [19.9212, 73.2150]],
    center: [19.9228, 73.2168],
  },
  {
    id: "p-317-1",
    surveyNo: "317",
    nameEnglish: "Dasama Nadage",
    nameMarathi: "दसमा नडगे",
    areaHa: 0.50,
    status: "Verified",
    useType: "farmland",
    polygon: [[19.9242, 73.2185], [19.9245, 73.2225], [19.9218, 73.2222], [19.9215, 73.2182]],
    center: [19.9230, 73.2204],
  },
  {
    id: "p-317-2",
    surveyNo: "317",
    nameEnglish: "Manji Gondaya Vagh",
    nameMarathi: "मंजी गोंदया वाघ",
    areaHa: 0.05,
    status: "Verified",
    useType: "homestead",
    polygon: [[19.9245, 73.2225], [19.9248, 73.2255], [19.9220, 73.2252], [19.9218, 73.2222]],
    center: [19.9232, 73.2238],
  },
  {
    id: "p-326-1",
    surveyNo: "326",
    nameEnglish: "Shevati Vangad",
    nameMarathi: "शेवती वांगड",
    areaHa: 1.40,
    status: "Verified",
    useType: "homestead",
    polygon: [[19.9212, 73.2120], [19.9215, 73.2150], [19.9185, 73.2148], [19.9182, 73.2118]],
    center: [19.9198, 73.2134],
  },
  {
    id: "p-336-1",
    surveyNo: "336",
    nameEnglish: "Raghu Digha",
    nameMarathi: "रघु दिघा",
    areaHa: 0.35,
    status: "Verified",
    useType: "farmland",
    polygon: [[19.9218, 73.2252], [19.9220, 73.2285], [19.9192, 73.2282], [19.9190, 73.2250]],
    center: [19.9205, 73.2268],
  },

  // Eastern parcels: S-463, S-328, S-314, S-14
  {
    id: "p-463-1",
    surveyNo: "463",
    nameEnglish: "Shevanti Bonge",
    nameMarathi: "शेवंती बोंगे",
    areaHa: 1.00,
    status: "Verified",
    useType: "forest",
    polygon: [[19.9320, 73.2300], [19.9325, 73.2340], [19.9295, 73.2335], [19.9290, 73.2295]],
    center: [19.9308, 73.2318],
  },
  {
    id: "p-328-1",
    surveyNo: "328",
    nameEnglish: "Kakad Vangad",
    nameMarathi: "काकड वांगड",
    areaHa: 1.10,
    status: "Verified",
    useType: "forest",
    polygon: [[19.9290, 73.2295], [19.9295, 73.2335], [19.9265, 73.2332], [19.9260, 73.2292]],
    center: [19.9278, 73.2314],
  },
  {
    id: "p-14-1",
    surveyNo: "14",
    nameEnglish: "Janya Navasha Digha",
    nameMarathi: "जान्या नवशा दिघा",
    areaHa: 0.80,
    status: "Under review",
    useType: "forest",
    polygon: [[19.9260, 73.2292], [19.9265, 73.2332], [19.9235, 73.2330], [19.9230, 73.2290]],
    center: [19.9248, 73.2310],
  },
  {
    id: "p-314-1",
    surveyNo: "314",
    nameEnglish: "Madhu Diva",
    nameMarathi: "मधु दिवा",
    areaHa: 0.07,
    status: "Verified",
    useType: "homestead",
    polygon: [[19.9220, 73.2285], [19.9225, 73.2325], [19.9195, 73.2322], [19.9192, 73.2282]],
    center: [19.9208, 73.2304],
  },

  // Lower southern S-324 fringe parcels
  {
    id: "p-324-12",
    surveyNo: "324",
    nameEnglish: "Sakharam Raghu Kadu",
    nameMarathi: "सखाराम रघू कडू",
    areaHa: 1.60,
    status: "Verified",
    useType: "forest",
    polygon: [[19.9260, 73.2205], [19.9262, 73.2245], [19.9235, 73.2248], [19.9232, 73.2208]],
    center: [19.9248, 73.2226],
  },
  {
    id: "p-324-13",
    surveyNo: "324",
    nameEnglish: "Shantaram Diva",
    nameMarathi: "शांताराम दिवा",
    areaHa: 2.00,
    status: "Conflict",
    useType: "forest",
    polygon: [[19.9262, 73.2245], [19.9268, 73.2280], [19.9240, 73.2282], [19.9235, 73.2248]],
    center: [19.9252, 73.2262],
  },
  {
    id: "p-324-14",
    surveyNo: "324",
    nameEnglish: "Bachchu Bhiva Phadavale",
    nameMarathi: "बच्चु भिवा फडवळे",
    areaHa: 1.30,
    status: "Verified",
    useType: "farmland",
    polygon: [[19.9232, 73.2208], [19.9235, 73.2248], [19.9208, 73.2250], [19.9205, 73.2210]],
    center: [19.9220, 73.2228],
  },
  {
    id: "p-324-15",
    surveyNo: "324",
    nameEnglish: "Santa Shankar Gurav",
    nameMarathi: "संता शंकर गुरव",
    areaHa: 1.00,
    status: "Verified",
    useType: "farmland",
    polygon: [[19.9205, 73.2210], [19.9208, 73.2250], [19.9180, 73.2252], [19.9178, 73.2212]],
    center: [19.9192, 73.2230],
  },
];

type TileSource = "google-hybrid" | "google-satellite" | "esri-satellite" | "carto-dark";

interface SatelliteCadastralMapProps {
  selectedSurvey: string;
  onSelectSurvey: (surveyNo: string) => void;
  layerState: { imagery: boolean; boundaries: boolean; conflicts: boolean; golden: boolean };
  onNotice: (msg: string) => void;
}

export function SatelliteCadastralMap({
  selectedSurvey,
  onSelectSurvey,
  layerState,
  onNotice,
}: SatelliteCadastralMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<LType.Map | null>(null);
  const layerGroupRef = useRef<LType.LayerGroup | null>(null);
  const tileLayerRef = useRef<LType.TileLayer | null>(null);
  const drawLayerRef = useRef<LType.FeatureGroup | null>(null);

  // States
  const [tileSource, setTileSource] = useState<TileSource>("esri-satellite");
  const [filterStatus, setFilterStatus] = useState<string>("All"); // All, Red, Amber, Stable
  const [filterLandUse, setFilterLandUse] = useState<string>("All"); // All, Homestead, Farmland
  const [isDrawingFence, setIsDrawingFence] = useState(false);
  const [fencePoints, setFencePoints] = useState<[number, number][]>([]);
  const [customFences, setCustomFences] = useState<{ id: string; name: string; areaSqm: number; coords: [number, number][] }[]>([]);
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [googleApiKey, setGoogleApiKey] = useState("");

  // Tile layers definition
  const tileUrls: Record<TileSource, { url: string; attribution: string; maxZoom: number }> = {
    "esri-satellite": {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, USDA, USGS",
      maxZoom: 19,
    },
    "google-hybrid": {
      url: "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
      attribution: "Map data ©2026 Google Satellite & Hybrid",
      maxZoom: 21,
    },
    "google-satellite": {
      url: "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
      attribution: "Imagery ©2026 Maxar, CNES/Airbus, Google",
      maxZoom: 21,
    },
    "carto-dark": {
      url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{y}/{x}{r}.png",
      attribution: "© OpenStreetMap contributors © CARTO",
      maxZoom: 20,
    },
  };

  // 1. Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: OZAR_PALGHAR_CENTER,
      zoom: 15.5,
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true, // Smooth hardware-accelerated canvas rendering
      updateWhenZooming: false,
      updateInterval: 100,
    });

    const initialTile = L.tileLayer(tileUrls[tileSource].url, {
      maxZoom: tileUrls[tileSource].maxZoom,
      subdomains: ["a", "b", "c", "d"],
      keepBuffer: 6,
      updateWhenIdle: true,
    }).addTo(map);

    tileLayerRef.current = initialTile;

    const drawGroup = L.featureGroup().addTo(map);
    drawLayerRef.current = drawGroup;

    const layerGroup = L.layerGroup().addTo(map);
    layerGroupRef.current = layerGroup;

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // 2. Handle Tile Source Change
  useEffect(() => {
    if (!mapInstanceRef.current || !tileLayerRef.current) return;
    mapInstanceRef.current.removeLayer(tileLayerRef.current);
    const newTile = L.tileLayer(tileUrls[tileSource].url, {
      maxZoom: tileUrls[tileSource].maxZoom,
      subdomains: ["a", "b", "c", "d"],
      keepBuffer: 6,
      updateWhenIdle: true,
    }).addTo(mapInstanceRef.current);
    tileLayerRef.current = newTile;
  }, [tileSource]);

  // 3. Render Geofence Parcels & Halos on Map
  useEffect(() => {
    if (!mapInstanceRef.current || !layerGroupRef.current) return;
    const group = layerGroupRef.current;
    group.clearLayers();

    if (!layerState.boundaries) return;

    // ── 3A. Draw Ozar CFR Boundary (Yellow Dashed Fencing) ───────────────
    L.polygon(OZAR_CFR_BOUNDARY_PALGHAR, {
      color: "#facc15",
      weight: 3.5,
      dashArray: "12, 7",
      fillColor: "#facc15",
      fillOpacity: 0.04,
    }).addTo(group);

    // Glowing boundary inner border
    L.polygon(OZAR_CFR_BOUNDARY_PALGHAR, {
      color: "rgba(250, 204, 21, 0.4)",
      weight: 8,
      fillColor: "transparent",
    }).addTo(group);

    // CFR Label Marker (matching screenshot exactly)
    const cfrLabelIcon = L.divIcon({
      className: "cfr-label-marker",
      html: `<div style="color: #facc15; font-weight: 800; font-size: 13px; letter-spacing: 0.5px; text-shadow: 0 1px 4px rgba(0,0,0,0.9), 0 0 12px rgba(250,204,21,0.5); white-space: nowrap; pointer-events: none;">Ozar CFR Boundary</div>`,
      iconSize: [160, 24],
      iconAnchor: [80, 12],
    });
    L.marker([19.9295, 73.2180], { icon: cfrLabelIcon, interactive: false }).addTo(group);

    // ── 3B. Render Soft Red Halos for Conflict Clusters ─────────────────
    if (layerState.conflicts) {
      CONFLICT_HALOS.forEach((halo) => {
        L.circle(halo.center, {
          radius: halo.radiusMeters,
          color: "rgba(239, 68, 68, 0.7)",
          weight: 1.5,
          dashArray: "6, 4",
          fillColor: "rgba(239, 68, 68, 0.15)",
          fillOpacity: 0.15,
        }).addTo(group);
      });
    }

    // ── 3C. Render Polygonal Cadastral Parcels ───────────────────────────
    PRECISE_PARCELS.forEach((parcel) => {
      // Filters
      if (filterStatus === "Red" && parcel.status !== "Conflict") return;
      if (filterStatus === "Amber" && parcel.status !== "Under review") return;
      if (filterStatus === "Stable" && parcel.status !== "Verified") return;

      if (filterLandUse === "Homestead" && parcel.useType !== "homestead") return;
      if (filterLandUse === "Farmland" && parcel.useType !== "farmland") return;

      const isSelected = selectedSurvey === parcel.surveyNo;
      const isConflict = parcel.status === "Conflict";
      const isReview = parcel.status === "Under review";

      const strokeColor = isConflict ? "#ef4444" : isReview ? "#f59e0b" : "#22c55e";
      const fillColor = isConflict ? "#ef4444" : isReview ? "#f59e0b" : "#22c55e";
      const fillOpacity = isSelected ? 0.45 : isConflict ? 0.30 : 0.22;

      // Parcel Polygon
      const polygon = L.polygon(parcel.polygon, {
        color: isSelected ? "#ffffff" : strokeColor,
        weight: isSelected ? 3.5 : isConflict ? 2.5 : 1.8,
        dashArray: isConflict && !isSelected ? "5, 3" : undefined,
        fillColor: fillColor,
        fillOpacity: fillOpacity,
      }).addTo(group);

      polygon.on("click", () => {
        onSelectSurvey(parcel.surveyNo);
        onNotice(`Survey No. ${parcel.surveyNo} (${parcel.nameEnglish}) selected`);
      });

      polygon.bindTooltip(
        `<div style="font-family: inherit; font-size: 11px; padding: 2px 4px;">
          <b style="color:${strokeColor}">S-${parcel.surveyNo}</b> · <b>${parcel.nameEnglish}</b><br/>
          <span style="color:#666">${parcel.nameMarathi} · ${parcel.areaHa.toFixed(2)} ha</span><br/>
          <span>Status: <b>${parcel.status}</b></span>
        </div>`,
        { sticky: true, opacity: 0.95 }
      );

      // Pill Label Marker (matching screenshot exactly)
      const dotColor = isConflict ? "#ef4444" : isReview ? "#f59e0b" : "#22c55e";
      const pillBorder = isConflict ? "#ef4444" : isReview ? "#f59e0b" : "#22c55e";
      const pillBg = isConflict
        ? "background: rgba(127, 29, 29, 0.9);"
        : isReview
        ? "background: rgba(120, 53, 15, 0.9);"
        : "background: rgba(20, 83, 45, 0.9);";

      const labelHtml = `
        <div style="cursor: pointer; display: inline-flex; align-items: center; gap: 4px; padding: 1.5px 6px; border-radius: 9999px; ${pillBg} border: 1.5px solid ${pillBorder}; color: #fff; font-weight: 700; font-size: 10px; box-shadow: 0 2px 6px rgba(0,0,0,0.6); ${isSelected ? "box-shadow: 0 0 0 2.5px #fff;" : ""}">
          <span style="display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: ${dotColor};"></span>
          <span>S-${parcel.surveyNo}</span>
        </div>
      `;

      const markerIcon = L.divIcon({
        className: "custom-parcel-marker",
        html: labelHtml,
        iconSize: [58, 20],
        iconAnchor: [29, 10],
      });

      const marker = L.marker(parcel.center, { icon: markerIcon }).addTo(group);
      marker.on("click", () => {
        onSelectSurvey(parcel.surveyNo);
        onNotice(`Survey No. ${parcel.surveyNo} selected`);
      });
    });

    // Custom Geofences
    customFences.forEach((cf) => {
      const poly = L.polygon(cf.coords, {
        color: "#38bdf8",
        weight: 2.5,
        dashArray: "4, 4",
        fillColor: "#38bdf8",
        fillOpacity: 0.25,
      }).addTo(group);

      poly.bindTooltip(`<b>${cf.name}</b><br/>Area: ${(cf.areaSqm / 10000).toFixed(2)} ha`, { sticky: true });
    });
  }, [selectedSurvey, layerState, tileSource, filterStatus, filterLandUse, customFences]);

  // 4. Drawing Mode Click Handler
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      if (!isDrawingFence) return;
      const newPt: [number, number] = [e.latlng.lat, e.latlng.lng];
      setFencePoints((prev) => {
        const next = [...prev, newPt];
        if (drawLayerRef.current) {
          drawLayerRef.current.clearLayers();
          if (next.length > 1) {
            L.polyline(next, { color: "#38bdf8", weight: 3, dashArray: "5, 5" }).addTo(drawLayerRef.current);
          }
          next.forEach((pt) => {
            L.circleMarker(pt, { radius: 5, color: "#38bdf8", fillColor: "#fff", fillOpacity: 1 }).addTo(drawLayerRef.current!);
          });
        }
        return next;
      });
    };

    map.on("click", handleMapClick);
    return () => {
      map.off("click", handleMapClick);
    };
  }, [isDrawingFence]);

  // Complete Geofence
  const completeCustomFence = () => {
    if (fencePoints.length < 3) {
      onNotice("Add at least 3 points to complete a geofence.");
      return;
    }
    const areaM2 = calculatePolygonArea(fencePoints);
    const newFence = {
      id: `fence-${Date.now()}`,
      name: `Custom Fence #${customFences.length + 1}`,
      areaSqm: Math.round(areaM2),
      coords: fencePoints,
    };
    setCustomFences((prev) => [...prev, newFence]);
    setFencePoints([]);
    setIsDrawingFence(false);
    if (drawLayerRef.current) drawLayerRef.current.clearLayers();
    onNotice(`Geofence saved! Area: ${(areaM2 / 10000).toFixed(2)} ha (${Math.round(areaM2).toLocaleString()} m²)`);
  };

  const cancelDrawing = () => {
    setFencePoints([]);
    setIsDrawingFence(false);
    if (drawLayerRef.current) drawLayerRef.current.clearLayers();
  };

  const recenterAll = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo(OZAR_PALGHAR_CENTER, 15.5, { duration: 1 });
    }
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-slate-950 font-sans select-none">
      {/* ━━━ TOP FLOATING PILL FILTER BARS (Exact match to reference screenshot) ━━━ */}
      <div className="absolute left-4 top-4 z-[999] flex flex-col gap-2 max-w-[calc(100%-120px)]">
        {/* Row 1: Status Pills + Satellite Layer Picker */}
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center rounded-lg border border-white/20 bg-black/70 p-1 backdrop-blur-md shadow-xl">
            <button
              onClick={() => setFilterStatus("All")}
              className={`rounded-md px-3 py-1 text-xs font-bold transition-all ${filterStatus === "All" ? "bg-slate-800 text-white shadow" : "text-slate-300 hover:text-white"}`}
            >
              All
            </button>
            <button
              onClick={() => setFilterStatus("Red")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-bold transition-all ${filterStatus === "Red" ? "bg-red-600 text-white shadow" : "text-red-400 hover:bg-white/10"}`}
            >
              <span className="size-2 rounded-full bg-red-500" /> Red
            </button>
            <button
              onClick={() => setFilterStatus("Amber")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-bold transition-all ${filterStatus === "Amber" ? "bg-amber-600 text-white shadow" : "text-amber-400 hover:bg-white/10"}`}
            >
              <span className="size-2 rounded-full bg-amber-500" /> Amber
            </button>
            <button
              onClick={() => setFilterStatus("Stable")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-bold transition-all ${filterStatus === "Stable" ? "bg-emerald-600 text-white shadow" : "text-emerald-400 hover:bg-white/10"}`}
            >
              <span className="size-2 rounded-full bg-emerald-500" /> Stable
            </button>
          </div>

          {/* Layer Selector Dropdown */}
          <div className="relative">
            <select
              value={tileSource}
              onChange={(e) => setTileSource(e.target.value as TileSource)}
              aria-label="Satellite Imagery Layer"
              className="cursor-pointer appearance-none rounded-lg border border-white/20 bg-black/70 py-1.5 pl-8 pr-7 text-xs font-bold text-white shadow-xl backdrop-blur-md outline-none hover:bg-black/90 focus:border-emerald-400"
            >
              <option value="esri-satellite">🛰️ Satellite (Esri Maxar)</option>
              <option value="google-hybrid">🛰️ Google Hybrid</option>
              <option value="google-satellite">🛰️ Google Satellite</option>
              <option value="carto-dark">🌙 Carto Dark</option>
            </select>
            <Satellite className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-cyan-400" />
          </div>
        </div>

        {/* Row 2: Land Use Pills */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center rounded-lg border border-white/20 bg-black/70 p-1 backdrop-blur-md shadow-xl">
            <button
              onClick={() => setFilterLandUse("All")}
              className={`rounded-md px-3 py-1 text-xs font-bold transition-all ${filterLandUse === "All" ? "border border-amber-400/60 bg-amber-500/20 text-amber-300" : "text-slate-300 hover:text-white"}`}
            >
              All Uses
            </button>
            <button
              onClick={() => setFilterLandUse("Homestead")}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-bold transition-all ${filterLandUse === "Homestead" ? "border border-amber-400/60 bg-amber-500/20 text-amber-300" : "text-slate-300 hover:text-white"}`}
            >
              🏡 Homestead
            </button>
            <button
              onClick={() => setFilterLandUse("Farmland")}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-bold transition-all ${filterLandUse === "Farmland" ? "border border-amber-400/60 bg-amber-500/20 text-amber-300" : "text-slate-300 hover:text-white"}`}
            >
              🌾 Farmland
            </button>
          </div>
        </div>
      </div>

      {/* ━━━ GEOFENCING DRAWING ACTIVE BAR ━━━ */}
      {isDrawingFence && (
        <div className="absolute top-24 left-4 z-[999] flex items-center gap-3 rounded-lg border border-sky-400 bg-black/85 px-3 py-2 text-xs text-sky-300 backdrop-blur shadow-2xl">
          <PenTool className="size-4 animate-bounce text-sky-400" />
          <span>Click map to add fence points ({fencePoints.length} added)</span>
          <button
            onClick={completeCustomFence}
            className="rounded bg-sky-500 px-2.5 py-1 text-xs font-bold text-black hover:bg-sky-400"
          >
            Enclose
          </button>
          <button
            onClick={cancelDrawing}
            className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
          >
            Cancel
          </button>
        </div>
      )}

      {/* ━━━ MAP CONTAINER ━━━ */}
      <div ref={mapContainerRef} className="h-full w-full flex-1 bg-slate-950" style={{ zIndex: 1 }} />

      {/* ━━━ RIGHT MAP CONTROLS (Exact stack from reference image) ━━━ */}
      <div className="absolute right-4 top-4 z-[999] flex flex-col gap-2">
        <div className="flex flex-col rounded-xl border border-white/20 bg-black/75 p-1 backdrop-blur-md shadow-2xl">
          <button
            onClick={() => mapInstanceRef.current?.zoomIn()}
            aria-label="Zoom In"
            className="grid size-10 place-items-center rounded-lg text-white hover:bg-white/20 active:scale-95"
            title="Zoom In"
          >
            <Plus className="size-5" />
          </button>
          <div className="h-px bg-white/20 my-0.5" />
          <button
            onClick={() => mapInstanceRef.current?.zoomOut()}
            aria-label="Zoom Out"
            className="grid size-10 place-items-center rounded-lg text-white hover:bg-white/20 active:scale-95"
            title="Zoom Out"
          >
            <Minus className="size-5" />
          </button>
        </div>

        <button
          onClick={recenterAll}
          aria-label="Recenter Ozar CFR"
          className="grid size-11 place-items-center rounded-xl border border-white/20 bg-black/75 text-white backdrop-blur-md shadow-2xl hover:bg-white/20 active:scale-95"
          title="Recenter Ozar CFR"
        >
          <Navigation className="size-5 text-emerald-400" />
        </button>

        <button
          onClick={() => onNotice("Time-lapse satellite comparison layer: 2023 vs 2026 (No deforestation detected)")}
          aria-label="Historical Satellite Compare"
          className="grid size-11 place-items-center rounded-xl border border-white/20 bg-black/75 text-white backdrop-blur-md shadow-2xl hover:bg-white/20 active:scale-95"
          title="Satellite History / Change Detection"
        >
          <Clock className="size-5 text-amber-300" />
        </button>

        <button
          onClick={() => {
            setIsDrawingFence(!isDrawingFence);
            if (!isDrawingFence) {
              onNotice("Click anywhere on the satellite imagery to draw a custom geofence.");
            } else {
              cancelDrawing();
            }
          }}
          aria-label="Draw Fence"
          className={`grid size-11 place-items-center rounded-xl border border-white/20 transition-all backdrop-blur-md shadow-2xl active:scale-95 ${isDrawingFence ? "bg-sky-500 text-black font-bold" : "bg-black/75 text-sky-400 hover:bg-white/20"}`}
          title="Draw Custom Geofence"
        >
          <PenTool className="size-5" />
        </button>
      </div>

      {/* ━━━ BOTTOM ATTRIBUTION STATUS BAR (Exact match to reference screenshot) ━━━ */}
      <div className="z-[999] flex items-center justify-between border-t border-white/10 bg-black/85 px-4 py-1.5 text-[11px] text-slate-300 backdrop-blur-md">
        <div>
          Boundary: <span className="font-semibold text-white">OSM/FALLBACK</span> · Tile Layer: <span className="text-emerald-400 font-semibold">{tileUrls[tileSource].attribution.split("—")[0]}</span> · Model: <span className="text-amber-300 font-semibold">demo-v1-synthetic</span>
        </div>
        <div className="text-slate-400 font-mono text-[10px]">
          Palghar Dist · 19.9280° N, 73.2210° E
        </div>
      </div>
    </div>
  );
}

function calculatePolygonArea(coords: [number, number][]): number {
  if (coords.length < 3) return 0;
  const R = 6378137;
  let area = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    const lat1 = (coords[i][0] * Math.PI) / 180;
    const lat2 = (coords[j][0] * Math.PI) / 180;
    const lon1 = (coords[i][1] * Math.PI) / 180;
    const lon2 = (coords[j][1] * Math.PI) / 180;
    area += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return (Math.abs(area) * R * R) / 2.0;
}
