export type SurveyStatus = "Verified" | "Under review" | "Conflict" | "Field verification";

export type SurveySummary = {
  surveyNumber: string;
  claimCount: number;
  status: SurveyStatus;
  confidence: number;
  areaLabel: string;
  issue?: string;
};

// The attached CSV was not included in this workspace. These are the verified
// aggregates from the supplied build brief; claimant-level rows are intentionally
// not fabricated until the source register is attached.
export const ozarDataset = {
  village: "Ozar Village",
  taluka: "Niphad Taluka",
  district: "Nashik District, Maharashtra",
  totalClaims: 147,
  uniqueSurveys: 12,
  sourceName: "Ozar Village Forest Rights Register",
  sourceType: "CSV attribute register",
  sourceNote: "Attribute data is from the supplied Ozar brief; boundary geometry is illustrative pending official survey shapefiles.",
};

export const surveySummaries: SurveySummary[] = [
  { surveyNumber: "324", claimCount: 116, status: "Conflict", confidence: 61, areaLabel: "High-density cluster", issue: "Multiple claimant conflict" },
  { surveyNumber: "14–463", claimCount: 31, status: "Under review", confidence: 84, areaLabel: "11 survey numbers", issue: "Attribute harmonization" },
];

export const processingSteps = [
  { label: "Dataset quality analysis", state: "Completed", detail: "147 source rows recognized" },
  { label: "Coordinate harmonization", state: "Completed", detail: "Illustrative Ozar reference frame" },
  { label: "Parcel boundary detection", state: "Processing", detail: "12 survey geometries queued" },
  { label: "Spatial matching", state: "Pending", detail: "Waiting for official shapefile" },
  { label: "Conflict detection", state: "Completed", detail: "Survey No. 324 cluster flagged" },
  { label: "Confidence scoring", state: "Processing", detail: "Weighted AI review in progress" },
  { label: "Golden record creation", state: "Pending", detail: "Requires officer approval" },
];

export const recentActivity = [
  { time: "09:41", label: "147 claim records ingested", detail: "Ozar Village register" },
  { time: "09:38", label: "Conflict cluster detected", detail: "Survey No. 324 · 116 linked claims" },
  { time: "09:32", label: "AI harmonization completed", detail: "11 lower-density survey groups" },
  { time: "09:18", label: "Boundary layer prepared", detail: "Illustrative geometry generated" },
];