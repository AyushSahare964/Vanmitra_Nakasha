/** Excel export: every water / forest resource lying on each survey number of a village (or on one survey). */
import * as XLSX from "xlsx";
import { RES_LAYERS } from "./mrsac";
import type { SurveyResource } from "./survey-resources";
import type { ReportPlot } from "./village-report";

export interface ExcelInput {
  village: { name: string; taluka: string; district: string; gisCode: string };
  survey?: string;
  plots: ReportPlot[];
  resources: Record<string, SurveyResource[]>;
  approvals: { purpose: string; ha: number; ac: number; date: string; surveys: string }[];
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
const map = (lat: number, lon: number) => ({ v: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, l: { Target: `https://www.google.com/maps?q=${lat},${lon}` } });

function sheet(rows: unknown[][], widths: number[]) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = widths.map((wch) => ({ wch }));
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  return ws;
}

export function buildExcel(inp: ExcelInput): void {
  const { village, plots, resources } = inp;
  const scope = plots.filter((p) => resources[p.plotno]).sort((a, b) => natural(a.plotno, b.plotno));
  const head = [village.name, village.taluka, village.district];

  const detail: unknown[][] = [["Village (Gram Sabha)", "Taluka", "District", "Survey No.", "Holder (7/12)", "Khata no.", "Survey area (ha)", "CFR recognised", "CFR purpose", "Group", "Resource", "Type", "Details", "Relation to survey", "Overlap (ha)", "Overlap (% of survey)", "Location"]];
  const summary: unknown[][] = [["Survey No.", "Holder (7/12)", "Khata no.", "Survey area (ha)", "CFR recognised", "Total resources", ...RES_LAYERS.map((l) => l.label), "Forest compartment (MRSAC)", "Water body"]];
  for (const p of scope) {
    const rs = resources[p.plotno]!;
    const common = [p.plotno, p.owners, p.khata, +p.ha.toFixed(4), p.cfr ? "Yes" : "No"];
    summary.push([...common, rs.length, ...RES_LAYERS.map((l) => rs.filter((r) => r.layer === l.label).length), p.forest ?? "—", p.water ? "Yes" : "—"]);
    if (!rs.length) detail.push([...head, ...common.slice(0, 3), common[3], common[4], p.cfr?.purpose ?? "", "—", "No mapped resource on this survey", "", "", "", "", "", map(p.lat, p.lon)]);
    for (const r of rs)
      detail.push([...head, p.plotno, p.owners, p.khata, +p.ha.toFixed(4), p.cfr ? "Yes" : "No", p.cfr?.purpose ?? "", r.group === "water" ? "Water" : "Forest", r.layer, r.type, r.details, r.relation, r.overlapHa ?? "", r.overlapPct ?? "", map(r.lat, r.lon)]);
  }
  const noGeom = plots.filter((p) => !p.geom && (!inp.survey || p.plotno === inp.survey)).length;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(detail, [20, 14, 14, 11, 32, 10, 12, 10, 28, 8, 24, 28, 44, 26, 11, 12, 22]), "Resources by survey");
  XLSX.utils.book_append_sheet(wb, sheet(summary, [11, 32, 10, 12, 10, 10, ...RES_LAYERS.map(() => 14), 30, 10]), "Survey summary");
  if (inp.approvals.length)
    XLSX.utils.book_append_sheet(wb, sheet([["Purpose", "Area (ha)", "Area (acre)", "Approved on", "Survey nos."], ...inp.approvals.map((a) => [a.purpose, a.ha, a.ac, a.date, a.surveys])], [40, 10, 10, 14, 60]), "CFR approvals");
  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      [
        ["VANMITRA TEAM — Resources on survey numbers"],
        [`${village.name} · Taluka ${village.taluka} · District ${village.district}`],
        [inp.survey ? `Survey No. ${inp.survey}` : `${scope.length} survey numbers analysed`],
        [noGeom ? `${noGeom} survey number(s) skipped: no map outline loaded.` : "All survey numbers had a map outline."],
        ["Sources: MahaBhuNakasha (parcels), MRSAC (water & forest), CFR approvals list (Feb 2018)."],
        ["Parcel outlines are calibrated approximations; overlap is a ~2% grid estimate. Screening aid, not a legal finding."],
        ["Developed by Ayush Sahare · Sanskruti Ruyarkar"],
      ],
      [110]
    ),
    "About"
  );
  XLSX.writeFile(wb, `VanMitra_Resources_${inp.survey ? `Survey_${inp.survey}_` : ""}${village.name.replace(/[^\wऀ-ॿ]+/g, "_")}.xlsx`);
}
