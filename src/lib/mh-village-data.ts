/**
 * mh-village-data.ts
 * Parses mh_cfr_potential_villages.xlsx (17,256 MH villages) using SheetJS.
 * Provides district → taluka → village cascading lookups for the Search Village panel.
 */

import * as XLSX from "xlsx";

// ── Types ────────────────────────────────────────────────────────────────────

export interface MHVillage {
  district: string;
  subdistrict: string; // taluka
  gramPanchayat: string;
  village: string;
  villageCode: string; // Census 2011 code
  totalAreaHa: number;
  gisAreaHa: number;
  households: number;
  population: number;
  villageType: string;
  cfrType: string;
  forestInsideHa: number;
  potentialCfrHa: number;
  totalCfrPotentialHa: number;
}

// ── Module-level cache ────────────────────────────────────────────────────────

let _cache: MHVillage[] | null = null;
let _loading: Promise<MHVillage[]> | null = null;

// ── Main loader ───────────────────────────────────────────────────────────────

/**
 * Lazily fetches and parses the xlsx file from /data/mh_cfr_potential_villages.xlsx.
 * Results are cached in memory after the first call.
 */
export async function loadVillageData(): Promise<MHVillage[]> {
  if (_cache) return _cache;
  if (_loading) return _loading;

  _loading = (async () => {
    const resp = await fetch("/data/mh_cfr_potential_villages.xlsx");
    if (!resp.ok) throw new Error(`Failed to fetch village xlsx: ${resp.status}`);
    const arrayBuffer = await resp.arrayBuffer();
    const wb = XLSX.read(arrayBuffer, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0] ?? ""];
    if (!ws) throw new Error("Could not read xlsx sheet");
    // header:1 gives us arrays; default gives objects keyed by header row
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);

    const villages: MHVillage[] = rows.map((r) => ({
      district:             String(r["District"] ?? ""),
      subdistrict:          String(r["Subdistrict"] ?? ""),
      gramPanchayat:        String(r["Gram Panchayat"] ?? ""),
      village:              String(r["Village"] ?? ""),
      villageCode:          String(r["Village Code 2011"] ?? ""),
      totalAreaHa:          Number(r["Total Geographical Area (ha)"] ?? 0),
      gisAreaHa:            Number(r["Calculated GIS Area (ha)"] ?? 0),
      households:           Number(r["Total Households"] ?? 0),
      population:           Number(r["Total Population"] ?? 0),
      villageType:          String(r["Village Type"] ?? ""),
      cfrType:              String(r["CFR Type"] ?? ""),
      forestInsideHa:       Number(r["Forest inside revenue boundary (ha)"] ?? 0),
      potentialCfrHa:       Number(r["Potential CFR area in 2 Km buffer (ha)"] ?? 0),
      totalCfrPotentialHa:  Number(r["Total CFR potential (ha) (Forest inside revenue boundary + Forest in 2 km buffer)"] ?? 0),
    }));

    _cache = villages;
    return villages;
  })();

  return _loading;
}

// ── Cascade helpers ───────────────────────────────────────────────────────────

/** Returns sorted unique list of districts. */
export function getDistricts(data: MHVillage[]): string[] {
  const set = new Set(data.map((v) => v.district));
  return Array.from(set).sort();
}

/** Returns sorted unique talukas for a given district. */
export function getTalukas(data: MHVillage[], district: string): string[] {
  const set = new Set(
    data.filter((v) => v.district === district).map((v) => v.subdistrict)
  );
  return Array.from(set).sort();
}

/** Returns sorted villages for a given district + taluka. */
export function getVillages(
  data: MHVillage[],
  district: string,
  taluka: string
): MHVillage[] {
  return data
    .filter((v) => v.district === district && v.subdistrict === taluka)
    .sort((a, b) => a.village.localeCompare(b.village));
}

/** Fuzzy text search across district/taluka/village name. */
export function searchVillages(data: MHVillage[], query: string): MHVillage[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return data
    .filter(
      (v) =>
        v.village.toLowerCase().includes(q) ||
        v.subdistrict.toLowerCase().includes(q) ||
        v.district.toLowerCase().includes(q) ||
        v.villageCode.includes(q)
    )
    .slice(0, 50); // cap results
}

// ── Approximate district/taluka centroids for map fly-to ─────────────────────
// Source: approximate lon/lat centres of Maharashtra districts
// Used when a village is selected but we don't have an exact boundary to fit.

export const DISTRICT_CENTROIDS: Record<string, [number, number]> = {
  // [lon, lat]  (WGS84)
  "Ahmadnagar":   [74.7496, 19.0948],
  "Akola":        [77.0082, 20.7066],
  "Amravati":     [77.7523, 20.9320],
  "Aurangabad":   [75.3433, 19.8762],
  "Beed":         [75.7597, 18.9890],
  "Bhandara":     [79.6517, 21.1673],
  "Buldhana":     [76.1848, 20.5292],
  "Chandrapur":   [79.2961, 19.9615],
  "Dhule":        [74.7748, 20.9017],
  "Gadchiroli":   [80.0000, 20.0000],
  "Gondia":       [80.1955, 21.4622],
  "Hingoli":      [77.1497, 19.7162],
  "Jalgaon":      [75.5626, 21.0077],
  "Jalna":        [75.8804, 19.8347],
  "Kolhapur":     [74.2433, 16.6917],
  "Latur":        [76.5604, 18.4088],
  "Mumbai City":  [72.8777, 19.0760],
  "Mumbai Suburban": [72.8333, 19.1667],
  "Nagpur":       [79.0882, 21.1458],
  "Nanded":       [77.3210, 18.9518],
  "Nandurbar":    [74.2433, 21.3667],
  "Nashik":       [73.7898, 19.9975],
  "Osmanabad":    [76.0438, 18.1865],
  "Palghar":      [72.7651, 19.6967],
  "Parbhani":     [76.7748, 19.2704],
  "Pune":         [73.8567, 18.5204],
  "Raigad":       [73.1498, 18.5158],
  "Ratnagiri":    [73.3000, 17.0000],
  "Sangli":       [74.5815, 16.8541],
  "Satara":       [74.0001, 17.6805],
  "Sindhudurg":   [73.8500, 16.0000],
  "Solapur":      [75.9064, 17.6805],
  "Thane":        [72.9781, 19.2183],
  "Wardha":       [78.6022, 20.7453],
  "Washim":       [77.1312, 20.1108],
  "Yavatmal":     [78.1198, 20.3888],
  // Marathi names & aliases returned by BhuNaksha API
  "नागपूर":       [79.0882, 21.1458],
  "Nangpur":      [79.0882, 21.1458],
  "अहमदनगर":     [74.7496, 19.0948],
  "अकोला":        [77.0082, 20.7066],
  "अमरावती":     [77.7523, 20.9320],
  "औरंगाबाद":     [75.3433, 19.8762],
  "बीड":          [75.7597, 18.9890],
  "भंडारा":       [79.6517, 21.1673],
  "बुलढाणा":      [76.1848, 20.5292],
  "चंद्रपूर":      [79.2961, 19.9615],
  "धुळे":         [74.7748, 20.9017],
  "गडचिरोली":    [80.0000, 20.0000],
  "गोंदिया":      [80.1955, 21.4622],
  "हिंगोली":      [77.1497, 19.7162],
  "जळगाव":        [75.5626, 21.0077],
  "जालना":        [75.8804, 19.8347],
  "कोल्हापूर":     [74.2433, 16.6917],
  "लातूर":        [76.5604, 18.4088],
  "मुंबई":        [72.8777, 19.0760],
  "मुंबई शहर":    [72.8777, 19.0760],
  "मुंबई उपनगर":  [72.8333, 19.1667],
  "नांदेड":       [77.3210, 18.9518],
  "नंदुरबार":     [74.2433, 21.3667],
  "नाशिक":        [73.7898, 19.9975],
  "उस्मानाबाद":   [76.0438, 18.1865],
  "Usmanabad":    [76.0438, 18.1865],
  "पालघर":        [72.7651, 19.6967],
  "परभणी":        [76.7748, 19.2704],
  "पुणे":         [73.8567, 18.5204],
  "रायगड":        [73.1498, 18.5158],
  "रत्नागिरी":    [73.3000, 17.0000],
  "सांगली":       [74.5815, 16.8541],
  "सातारा":       [74.0001, 17.6805],
  "सिंधुदुर्ग":    [73.8500, 16.0000],
  "सोलापूर":      [75.9064, 17.6805],
  "ठाणे":         [72.9781, 19.2183],
  "वर्धा":        [78.6022, 20.7453],
  "वाशीम":        [77.1312, 20.1108],
  "यवतमाळ":       [78.1198, 20.3888],
};

/**
 * Returns the approximate [lon, lat] centroid for a district.
 * Falls back to Maharashtra state centre if not found.
 */
export function getDistrictCentroid(district: string): [number, number] {
  if (!district) return [75.7139, 19.7515];
  if (DISTRICT_CENTROIDS[district]) return DISTRICT_CENTROIDS[district];
  const lower = district.toLowerCase();
  for (const [key, val] of Object.entries(DISTRICT_CENTROIDS)) {
    if (key.toLowerCase() === lower) return val;
  }
  return [75.7139, 19.7515];
}
