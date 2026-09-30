# CFR section — implementation plan (v2, with your Excel data)

Status: **plan only.** Supersedes v1. Inputs: your file `TOTAL CFR APPROVED CASES - Copy.xlsx` + ATREE (https://cfr.atree.org/potential/cfr.php).

## 1. What your Excel contains (analysed)

| Fact | Value |
|---|---|
| Scope | **Nagpur district only** (705 approvals, 12 taluka labels, ~669 villages) — data "up to Feb 2018", Sec. 3(1) community claims |
| Columns used | district, village, taluka, purpose, **survey / gat / compartment nos.**, approved area (acres + ha), district-level approval date |
| Survey numbers | **5,274 survey tokens**; 5,257 (99.7 %) are clean (`289`, `100/1`, `9/1`); 17 odd ones (`15-16`, `425/`, `59/ब`, `कंपा. क्र.`, `109110`) |
| Integrity | Sum of ha = 49,464.21 = the sheet's own footer total; acres ≈ ha × 2.471 on every row → area data is trustworthy |
| Quirks | `नागपूर ग्रामिण` appears with/without trailing space; 3 rows use the form `289 स.नं. 17,2,3…` (leading number = compartment); 35 villages have several rows; dates only for ~10 batches |
| Not in file | Other districts, owner/gram-sabha names, geometry |

You said "few districts" — only Nagpur is in this file. The design below makes adding a district a drop-in (§5), so nothing is Nagpur-specific.

## 2. What we can honestly claim per parcel (three evidence levels)

Every survey number in a village gets exactly one **CFR status**, shown in its own colour and labelled with how sure we are:

| Status | Colour | Rule | Confidence |
|---|---|---|---|
| **CFR Recognized** | `#7c3aed` violet | Survey no. is in the Excel for that village (exact match, or parent no. covering sub-numbers, see §4) | Official (your data) |
| **Potential — Forest land** | `#15803d` green | Not recognized, and 7/12 holder is Forest Dept (वनविभाग/कुरण/जंगल) | Inferred from 7/12 |
| **Potential — Govt land** | `#ca8a04` mustard | Not recognized, holder is Govt/Gairan/Gram-panchayat (शासन, गायरान, पंचायत…) | Inferred from 7/12 |
| **In ATREE potential village** | `#f97316` orange outline on the village | Village is in ATREE `mh_cfr_potential_villages` (adds context: potential ha) | ATREE data |
| Other private land | grey | everything else | — |

So a user opens a village and immediately sees: **violet = already recognized, green/mustard = still-claimable candidates**. That answers "is this survey number under CFR land, or not done yet". The UI states plainly that green/mustard are *candidates from land-record ownership*, not legal eligibility.

Where we have **no Excel** (all districts but Nagpur): status falls back to "Potential (inferred)" / "Other" plus the ATREE village-level layers; recognized parcels can't be shown and the panel says "Recognized survey list not loaded for this district".

## 3. Panel design — left-bar "CFR"

1. **Mode**: `Parcels` (default) · `Recognized villages` · `Map layers (ATREE)`.
2. **Region**: District → Taluka → Village. District list shows a small "data" badge for districts that have recognized data. Village list highlights villages that have recognized survey numbers (with count).
3. **Status tiles** (multi-select, counts, colours from §2): Recognized · Forest potential · Govt potential · Other. Same interaction as Explore, so users already know it.
4. **Search**: survey number (`255`, `100/1`) — instantly tells "Recognized ✔ / Candidate / Other", with purpose, approved area, approval date.
5. **Sort** (segmented + one menu): Survey no. · Status · Area (parcel) · Approved CFR area · Approval date · Village name (village mode). Tap again to reverse.
6. **Filters** (chips, all optional): Status · Taluka · Purpose group (grazing / timber & fuel / burial-cattle ground / other) · Approval year · Area range.
7. **Village card**: taluka, purposes, approved area (ha/acre), batches & dates, count of recognized survey nos., % of village parcels recognized, ATREE potential/forest ha.
8. **Recognized-villages table** (mode 2): all 669 villages, sortable by approved ha, no. of survey nos., taluka, date; click → zoom + open in Parcels mode.
9. **Map**: violet/green/mustard polygons, village outline, rose halo on the selected survey; ATREE tiles (potential / recognized villages) toggle in mode 3. Legend + opacity + Clear.

Reuse, not rebuild: the Parcels list *is* the existing `LandExplorer` with a status dimension (tiles, search, sort, "Show on map", paging). This is what keeps it fast and small.

## 4. Matching your data to MahaBhuNakasha parcels

1. **Village link**: Excel (taluka, village in Marathi) → BhuNaksha village code. Done **offline once** by a script using our existing `tokenNorm` phonetic matcher; output is a static table `cfr-village-map.json`. Exact/phonetic matches auto-accepted; anything ambiguous goes to a short **review list** (`unmatched-villages.md`) for you to confirm — no silent wrong villages. Expected ~90 %+ auto (names like `ठाणा पा.`, `सुरजपूर रि.` will need review).
2. **Survey parsing** (in the build script): convert Devanagari digits, split on `, / space / व`, strip `स.नं.`/`कंपा. क्र.`, keep `100/1` and `59/ब` as-is, flag the 17 odd tokens as "needs check" instead of guessing (`109110` → flagged, `15-16` → range candidate).
3. **Parcel match rule** at runtime:
   - `100/1` in Excel matches BhuNaksha `100/1` exactly;
   - `100` in Excel matches `100`, `100/1`, `100/2`… (parent covers children);
   - `100/1` in Excel does **not** match `100/2`.
   - Each recognized parcel carries which Excel row (batch, purpose, area, date) it came from.
4. **Shown counts**: "X of Y listed survey numbers found in this village's parcels" — so any survey number in the Excel that doesn't exist in the live cadastre is visible as a data-quality item, not dropped silently.

## 5. Data pipeline (fast + extendable)

- `scripts/build-cfr-data.mjs`: reads any `*.xlsx` in `data/cfr/` (same column layout), normalizes, links villages, writes `src/data/cfr-approved.json` (village-keyed; ~250 KB, ~40 KB gzipped). To add another district: drop its sheet, run the script, review the unmatched list.
- Loaded with a **dynamic import** the first time the CFR panel opens; then a `Map<villageCode, CfrVillage>` gives O(1) lookups.
- Nothing is fetched for the Recognized status: it is computed from the plot list the app already has (survey numbers arrive before the slow 7/12 owner records), so **violet parcels appear immediately**. Green/mustard appear as owner records stream in (same progress line as Explore).
- Records cache is the 24 h localStorage cache already added.

## 6. ATREE layers (context, still valuable)

- Map layers: WMS tiles for potential / recognized villages with `CQL_FILTER` by district/village (verified working); no vector download.
- District/tehsil/village lists and village polygon: ATREE JSON endpoints (CORS open). Only used in mode 3 and for the "ATREE potential ha" number on the village card.
- Attribute values need a small allow-listed proxy `api/cfr.js` (+ dev proxy in `vite.config.ts`), because ATREE's WFS is locked and GetFeatureInfo has no CORS. Cached (`s-maxage=86400`).
- Custom colouring of ATREE tiles depends on the SLD spike; if refused, ATREE tiles keep their default style and our colours apply to our own drawn polygons (which is where the survey-level colouring lives anyway).

## 7. Speed budget

| Action | Target |
|---|---|
| Open CFR panel | < 150 ms (lazy JSON ≈ 40 KB gz) |
| Pick village → recognized parcels coloured | < 500 ms after plot list arrives |
| Change filter / sort / status tile | < 50 ms (in-memory, `useMemo` + `startTransition`) |
| Recognized-villages table (669 rows) | instant, windowed list, 50 rows/page |
| Repeat visit to a village | instant (records cache) |

## 8. Code changes

- **New** `scripts/build-cfr-data.mjs`, `src/data/cfr-approved.json` (+ `cfr-village-map.json`).
- **New** `src/lib/cfr-data.ts` — types, lazy loader, `cfrStatusFor(parcel)`, survey-match rule, purpose grouping.
- **New** `src/components/CfrPanel.tsx` — mode switch, region selectors, village card, filters; embeds `LandExplorer`.
- **Edit** `LandExplorer.tsx` — make the tile group configurable (categories *or* CFR statuses), add "Approved area / date" sort keys via a `sortOptions` prop, optional extra row line (purpose · approved ha).
- **Edit** `land-categories.ts` — expose `isForestHolder` / `isGovtHolder` used by the CFR status.
- **Edit** `NakashaMap.tsx` — `PanelKey += "cfr"`, toolbar button, `cfrStatus` on `PlotIndexEntry`, `highlightPlotsGroup` per-plot colour for CFR statuses, ATREE tile group ref.
- **New (mode 3 only)** `api/cfr.js`, vite/vercel proxy routes.

## 9. Delivery order

1. Build script + parsing + village linking → **you review unmatched villages and the 17 odd tokens**.
2. `cfr-data.ts` + panel shell + region selectors (Nagpur data) + village card.
3. Parcel statuses + colours + LandExplorer extensions (tiles, sort, filters).
4. Recognized-villages table.
5. ATREE layers/proxy (mode 3) and village-level potential figures.
6. Speed pass, build check, spot-check 5 known villages against your Excel.

## 10. Decisions needed

1. **Green/mustard "candidate" statuses** — OK to label them as "Potential (inferred from 7/12 holder)"? (Recommended; wording will say it is not legal eligibility.)
2. **Recognized only from your Excel** for now (Nagpur); other districts show inferred potential only until you send more sheets. OK?
3. **Ambiguous villages**: I produce a review list and you confirm — or should unmatched ones simply be skipped (recommended: review, it's likely only a few dozen)?
4. Is the Feb-2018 cut-off a problem? I will show "Recognized as of Feb 2018" in the panel so newer approvals are not implied to be missing.
