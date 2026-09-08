// Urban Land Record Management & Multi-Source Geospatial Harmonization Data

export interface MultiSourceFeed {
  id: string;
  name: string;
  type: "Vector WMS" | "Satellite Raster" | "Cadastral Sheet" | "Alphanumeric RoR" | "LiDAR Point Cloud";
  sourceAgency: string;
  crs: string;
  resolution: string;
  lastUpdated: string;
  status: "Active" | "Syncing" | "Calibrated";
  accuracy: string;
  recordsCount: number;
  badgeColor: string;
}

export interface UrbanParcelRecord {
  ctsNo: string;
  plotNo: string;
  ward: string;
  division: string;
  district: string;
  ownerName: string;
  propertyCardArea: number; // sq.m
  cadastralVectorArea: number; // sq.m
  satelliteFootprintArea: number; // sq.m
  harmonizedArea: number; // sq.m
  discrepancySqm: number;
  discrepancyPct: number;
  crsShiftMeters: number;
  conflictType: "Boundary Sliver" | "CRS Projection Drift" | "Encroachment on Road Reserve" | "Area Overlap" | "Harmonized";
  severity: "High" | "Medium" | "Low" | "Resolved";
  status: "Needs Officer Review" | "Auto-Harmonized" | "Golden Record Issued" | "Field Verification";
  confidenceScore: number;
  sourcesLinked: string[];
  lat: number;
  lng: number;
  recommendation: string;
}

export interface HarmonizationPipelineStep {
  step: number;
  title: string;
  description: string;
  engine: string;
  latency: string;
  status: "Completed" | "In-Progress" | "Pending";
  throughput: string;
}

export const MULTI_SOURCE_FEEDS: MultiSourceFeed[] = [
  {
    id: "feed-bhunaksha",
    name: "MahaBhuNakasha Cadastral Vectors",
    type: "Vector WMS",
    sourceAgency: "Directorate of Land Records, Pune",
    crs: "EPSG:4326 (WGS84)",
    resolution: "1:500 Cadastral Scale",
    lastUpdated: "Today, 04:30 AM",
    status: "Active",
    accuracy: "±0.12 m",
    recordsCount: 48926,
    badgeColor: "bg-blue-50 text-blue-700 border-blue-200",
  },
  {
    id: "feed-satellite",
    name: "High-Res Satellite Orthoimagery",
    type: "Satellite Raster",
    sourceAgency: "ISRO / CartoSat-3 & Google Earth Engine",
    crs: "EPSG:3857 (Web Mercator)",
    resolution: "0.25 m/pixel Ground Sample",
    lastUpdated: "Yesterday, 11:15 PM",
    status: "Calibrated",
    accuracy: "Sub-meter Orthorectified",
    recordsCount: 36,
    badgeColor: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  {
    id: "feed-ctso",
    name: "Urban City Survey (CTSO) Sheets",
    type: "Cadastral Sheet",
    sourceAgency: "Urban Land Governance Dept, Maharashtra",
    crs: "Local Datum / Cassini-Soldner",
    resolution: "1:250 Micro-CTS Scale",
    lastUpdated: "2 days ago",
    status: "Active",
    accuracy: "±0.05 m Local Boundary",
    recordsCount: 14820,
    badgeColor: "bg-amber-50 text-amber-700 border-amber-200",
  },
  {
    id: "feed-ror",
    name: "7/12 & Mahabhumi Property Cards",
    type: "Alphanumeric RoR",
    sourceAgency: "Revenue & Forest Dept, Govt. of Maharashtra",
    crs: "Tabular (Linked via CTS UID)",
    resolution: "Individual Khata / Parcel Index",
    lastUpdated: "Real-time Sync",
    status: "Active",
    accuracy: "100% Legal Ownership Link",
    recordsCount: 62450,
    badgeColor: "bg-purple-50 text-purple-700 border-purple-200",
  },
  {
    id: "feed-lidar",
    name: "Drone LiDAR & Building Elevation",
    type: "LiDAR Point Cloud",
    sourceAgency: "Survey of India (SVAMITVA Urban Pilot)",
    crs: "EPSG:32643 (UTM Zone 43N)",
    resolution: "120 pts/m² Density",
    lastUpdated: "Sep 2026 Batch",
    status: "Calibrated",
    accuracy: "±0.03 m Vertical & Horizontal",
    recordsCount: 8400,
    badgeColor: "bg-sky-50 text-sky-700 border-sky-200",
  },
];

export const PIPELINE_STEPS: HarmonizationPipelineStep[] = [
  {
    step: 1,
    title: "Multi-Source Geospatial Ingestion",
    description: "Automated ingestion & decompression of WMS cadastral vectors, GeoTIFF orthoimagery, and CTSO micro-polygons.",
    engine: "GeoSpatial ETL / GDAL 3.8",
    latency: "140 ms / batch",
    status: "Completed",
    throughput: "1,200 parcels/sec",
  },
  {
    step: 2,
    title: "Rigid CRS & Datum Transformation",
    description: "Auto-projection from legacy Cassini / EPSG:3857 to standard WGS84 EPSG:4326 with 7-parameter Helmert shift.",
    engine: "PROJ 9.3 Affine Rectifier",
    latency: "85 ms / batch",
    status: "Completed",
    throughput: "Zero coordinate drift",
  },
  {
    step: 3,
    title: "GeoAI Edge & Feature Matching",
    description: "Deep-learning boundary extraction from satellite and LiDAR, matching fence-lines and physical compound walls with vector parcel edges.",
    engine: "UNet Cadastral-Edge AI",
    latency: "280 ms / parcel",
    status: "Completed",
    throughput: "99.4% F1-Score Edge Match",
  },
  {
    step: 4,
    title: "Intelligent Conflict Arbitration",
    description: "Resolving sliver polygons, multi-cadastre overlaps, and road reserve buffers using topological consensus algorithm.",
    engine: "Topological Consensus Engine",
    latency: "95 ms / parcel",
    status: "Completed",
    throughput: "1,248 overlaps rectified",
  },
  {
    step: 5,
    title: "Golden Cadastral Record Synthesis",
    description: "Generating unified, tamper-proof Golden Urban Property Cards with digital signature, 7/12 sync, and GeoJSON export.",
    engine: "Golden Registry Synthesizer",
    latency: "60 ms / parcel",
    status: "In-Progress",
    throughput: "Ready for Officer Approval",
  },
];

export const URBAN_PARCEL_DATA: UrbanParcelRecord[] = [
  {
    ctsNo: "CTS-104/A",
    plotNo: "Plot 42-B",
    ward: "Ward 14 (Dharampeth)",
    division: "Nagpur Urban CTSO",
    district: "Nagpur",
    ownerName: "Dr. Arvind Rao Deshmukh & Shrikant Deshmukh",
    propertyCardArea: 482.5,
    cadastralVectorArea: 494.2,
    satelliteFootprintArea: 484.0,
    harmonizedArea: 483.2,
    discrepancySqm: 11.7,
    discrepancyPct: 2.4,
    crsShiftMeters: 0.18,
    conflictType: "Boundary Sliver",
    severity: "Medium",
    status: "Needs Officer Review",
    confidenceScore: 94.8,
    sourcesLinked: ["BhuNaksha", "CartoSat-3", "Nagpur CTSO Sheet 14", "7/12 Khata #812"],
    lat: 21.1458,
    lng: 79.0882,
    recommendation: "Accept AI-harmonized edge aligned with physical compound wall detected in 0.25m Orthoimagery.",
  },
  {
    ctsNo: "CTS-312",
    plotNo: "Plot 18",
    ward: "Ward 8 (Civil Lines)",
    division: "Nagpur Urban CTSO",
    district: "Nagpur",
    ownerName: "Vidarbha Urban Infrastructure Corp",
    propertyCardArea: 1250.0,
    cadastralVectorArea: 1248.8,
    satelliteFootprintArea: 1249.5,
    harmonizedArea: 1249.6,
    discrepancySqm: 0.8,
    discrepancyPct: 0.06,
    crsShiftMeters: 0.04,
    conflictType: "Harmonized",
    severity: "Resolved",
    status: "Golden Record Issued",
    confidenceScore: 99.6,
    sourcesLinked: ["BhuNaksha", "CartoSat-3", "SVAMITVA LiDAR", "CTSO Ward 8"],
    lat: 21.1539,
    lng: 79.0745,
    recommendation: "Golden Record approved with ±0.04m tolerance. Zero boundary conflict with municipal road reserve.",
  },
  {
    ctsNo: "CTS-89/3",
    plotNo: "Plot 7-C",
    ward: "Ward 22 (Shivajinagar)",
    division: "Pune Metropolitan CTSO",
    district: "Pune",
    ownerName: "Sunil Balkrishna Joshi & Sujata Joshi",
    propertyCardArea: 620.0,
    cadastralVectorArea: 648.5,
    satelliteFootprintArea: 622.0,
    harmonizedArea: 621.5,
    discrepancySqm: 28.5,
    discrepancyPct: 4.6,
    crsShiftMeters: 0.42,
    conflictType: "Encroachment on Road Reserve",
    severity: "High",
    status: "Needs Officer Review",
    confidenceScore: 88.2,
    sourcesLinked: ["BhuNaksha", "Pune PMC DP Sheet", "CartoSat-3", "Property Card #4409"],
    lat: 18.5314,
    lng: 73.8446,
    recommendation: "Cadastral vector encroaches 1.2m into proposed 18m DP road. Harmonize to registered building setback line.",
  },
  {
    ctsNo: "CTS-541",
    plotNo: "Plot 29",
    ward: "Ward 5 (Bandra West)",
    division: "Mumbai Suburban CTSO",
    district: "Mumbai Suburban",
    ownerName: "Mehta Commercial Holdings LLP",
    propertyCardArea: 890.0,
    cadastralVectorArea: 893.2,
    satelliteFootprintArea: 890.5,
    harmonizedArea: 890.3,
    discrepancySqm: 3.2,
    discrepancyPct: 0.36,
    crsShiftMeters: 0.09,
    conflictType: "Harmonized",
    severity: "Resolved",
    status: "Golden Record Issued",
    confidenceScore: 98.9,
    sourcesLinked: ["BhuNaksha", "BMC CTSO Record", "Google Hybrid", "SVAMITVA Drone"],
    lat: 19.0596,
    lng: 72.8295,
    recommendation: "100% matched with BMC development plan and CTS card. Ready for digital mutation update.",
  },
  {
    ctsNo: "CTS-78/2",
    plotNo: "Plot 12-A",
    ward: "Ward 11 (Panchavati)",
    division: "Nashik City CTSO",
    district: "Nashik",
    ownerName: "Ganesh Trimbak Kulkarni",
    propertyCardArea: 350.0,
    cadastralVectorArea: 366.4,
    satelliteFootprintArea: 352.0,
    harmonizedArea: 351.2,
    discrepancySqm: 16.4,
    discrepancyPct: 4.7,
    crsShiftMeters: 0.31,
    conflictType: "Area Overlap",
    severity: "Medium",
    status: "Needs Officer Review",
    confidenceScore: 91.5,
    sourcesLinked: ["BhuNaksha", "Nashik Municipal GIS", "7/12 Khata #190"],
    lat: 20.0110,
    lng: 73.7902,
    recommendation: "Overlap with adjacent CTS-78/1 by 0.65m on western edge. AI suggests centroid alignment based on LiDAR wall fence.",
  },
  {
    ctsNo: "CTS-205",
    plotNo: "Plot 51",
    ward: "Ward 18 (Kothrud)",
    division: "Pune Metropolitan CTSO",
    district: "Pune",
    ownerName: "Maharashtra State Housing Federation",
    propertyCardArea: 2150.0,
    cadastralVectorArea: 2153.0,
    satelliteFootprintArea: 2151.2,
    harmonizedArea: 2150.8,
    discrepancySqm: 3.0,
    discrepancyPct: 0.14,
    crsShiftMeters: 0.06,
    conflictType: "Harmonized",
    severity: "Resolved",
    status: "Golden Record Issued",
    confidenceScore: 99.1,
    sourcesLinked: ["BhuNaksha", "PMC Master Cadastre", "Drone Orthomosaic"],
    lat: 18.5074,
    lng: 73.8077,
    recommendation: "Clean boundary topology confirmed. Golden Record published to state cadastral repository.",
  },
];

export const URBAN_DIVISIONS = [
  { id: "all", name: "All Maharashtra Urban Divisions", district: "All", totalParcels: 14820, harmonizedPct: 98.4, pendingReviews: 55 },
  { id: "nagpur", name: "Nagpur Urban CTSO Division", district: "Nagpur", totalParcels: 3840, harmonizedPct: 98.4, pendingReviews: 14 },
  { id: "pune", name: "Pune Metropolitan CTSO", district: "Pune", totalParcels: 5620, harmonizedPct: 97.8, pendingReviews: 22 },
  { id: "mumbai", name: "Mumbai Suburban CTSO", district: "Mumbai Suburban", totalParcels: 3100, harmonizedPct: 99.2, pendingReviews: 8 },
  { id: "nashik", name: "Nashik City CTSO Division", district: "Nashik", totalParcels: 2260, harmonizedPct: 98.1, pendingReviews: 11 },
];

export function getUrbanParcelsByDivision(divisionId: string): UrbanParcelRecord[] {
  if (divisionId === "nagpur") return URBAN_PARCEL_DATA.filter((p) => p.district === "Nagpur");
  if (divisionId === "pune") return URBAN_PARCEL_DATA.filter((p) => p.district === "Pune");
  if (divisionId === "mumbai") return URBAN_PARCEL_DATA.filter((p) => p.district === "Mumbai Suburban");
  if (divisionId === "nashik") return URBAN_PARCEL_DATA.filter((p) => p.district === "Nashik");
  return URBAN_PARCEL_DATA;
}

export function simulateUrbanAIResponse(query: string, parcel: UrbanParcelRecord): string {
  const q = query.toLowerCase();
  if (q.includes("harmonize") || q.includes("resolve") || q.includes("align")) {
    return `GeoAI Harmonization for ${parcel.ctsNo}: Evaluated MahaBhuNakasha WMS against 0.25m orthoimagery. Recommended boundary consensus adopts coordinates [${parcel.lng.toFixed(5)}, ${parcel.lat.toFixed(5)}] with a corrected area of ${parcel.harmonizedArea} sq.m (variance reduced from ${parcel.discrepancyPct}% to 0.04%). Ready to publish Golden Record.`;
  }
  if (q.includes("conflict") || q.includes("discrepancy") || q.includes("issue")) {
    return `Spatial Conflict Report for ${parcel.ctsNo}: ${parcel.conflictType} detected (${parcel.discrepancySqm} sq.m variance, CRS drift ${parcel.crsShiftMeters}m). Severity: ${parcel.severity}. Recommendation: ${parcel.recommendation}`;
  }
  if (q.includes("owner") || q.includes("7/12") || q.includes("property card")) {
    return `Land Records Linkage: Registered title holder is "${parcel.ownerName}". Registered Property Card Area: ${parcel.propertyCardArea} sq.m. AI Physical Ground Footprint: ${parcel.satelliteFootprintArea} sq.m. Ownership status verified with Revenue Department database.`;
  }
  return `GeoAI Cadastral Assistant: Parcel ${parcel.ctsNo} (${parcel.ward}, ${parcel.division}) has a confidence score of ${parcel.confidenceScore}%. 4 spatial feeds integrated (BhuNaksha WMS, CartoSat Orthoimagery, CTSO Sheet, and Property Card RoR).`;
}
