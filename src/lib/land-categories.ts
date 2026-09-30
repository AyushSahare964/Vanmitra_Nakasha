/**
 * Parcel categories for the Land Explorer.
 *
 * MahaBhuNakasha's getPlotInfo carries no land-use field — only holder name, area,
 * pot-kharaba and khata — so every category here is INFERRED from the 7/12 holder text.
 * The UI says so; do not present these as official land-use records.
 */
import { classifyEnvCategory, isGovernmentOwner, tokenNorm } from "./marathi-search";

export type Category = "farm" | "residential" | "government" | "forest" | "water" | "other";

export const CATEGORIES: { key: Category; en: string; mr: string; color: string }[] = [
  { key: "farm", en: "Farm", mr: "शेती", color: "#65a30d" },
  { key: "residential", en: "Residential", mr: "निवासी", color: "#2563eb" },
  { key: "government", en: "Government", mr: "शासकीय", color: "#64748b" },
  { key: "forest", en: "Forest", mr: "वन", color: "#166534" },
  { key: "water", en: "Water", mr: "जलस्रोत", color: "#0284c7" },
  { key: "other", en: "Other", mr: "इतर", color: "#a8a29e" },
];

interface RecordLike {
  totalArea: string;
  potKharaba: string;
  ownerName: string;
}

/** Forest and water win over "government": both are government-held subsets. */
export function classifyParcel(plotno: string, records: RecordLike[] | undefined, fallbackOwner = ""): Category {
  const owners = records?.length ? records.map((r) => r.ownerName) : fallbackOwner ? [fallbackOwner] : [];
  if (owners.length === 0) return "other";

  for (const o of owners) {
    const env = classifyEnvCategory(o);
    if (env === "forest") return "forest";
    if (env === "waterbody") return "water";
  }

  const p = String(plotno).trim().toLowerCase();
  if (/\/p$/.test(p) || /\/a$/.test(p) || /bldg|plot|gat/.test(p) || owners.some((o) => /गावठाण/.test(o))) {
    return "residential";
  }
  const heavyKharaba = records?.some(
    (r) => (parseFloat(r.potKharaba) || 0) / Math.max(0.0001, parseFloat(r.totalArea) || 0) > 0.5
  );
  if (owners.some(isGovernmentOwner) || heavyKharaba) return "government";
  return "farm";
}

/** Groups spelling variants of one surname (राउत / राऊत) under one key. */
export const familyKey = (surname: string): string => tokenNorm(surname);
