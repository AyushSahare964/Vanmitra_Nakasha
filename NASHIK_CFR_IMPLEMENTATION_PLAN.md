# Nashik CFR: compartment mapping, conflict filter, outside-village land

Written for: the VanMitra project team. Status as of 2026-10-08.

## What the data is
- `CFR Nashik 2026.xlsx` has **compartment numbers (वनकक्ष क्र.) and approved ha per village**, no survey numbers, no dates. 831 approvals, ~59,447 ha across 12 talukas (Sinnar and Yeola are almost all rejected).
- Compartment numbers repeat across the state (and inside a village as slivers), so a number alone is not a location. The map has to resolve it using **village + range + beat** from MRSAC.
- MRSAC forest compartments are cut from the cadastral map in its **raw** frame. Our cadastral view is shifted onto the imagery per village.

## Done
1. **Offset fix (pushed with this plan).** Udmal's MRSAC village box equals the portal's raw extent to ~1 m, while the calibrated cadastral is shifted (-12 m E, -84 m N). Forest, reserve and wildlife polygons now get the same calibration shift as the cadastral. The parcel-in-compartment test uses the raw frame. Result for Udmal: green compartment edges now follow the village edge; 88 parcels sit in forest compartments (was 83).
2. Approved compartments mark the cadastral parcels inside them as CFR recognized (Udmal: 70 parcels, 66.5 ha of 71.25 ha approved).

## Plan

### Phase 1: Compartment to survey-number mapping (accuracy)
- Store the mapping once per village instead of recomputing in the browser: build step `scripts/build-compartment-map.mjs` -> `public/data/cfr-comp/<district>.json` with `{village, compNo, range, beat, surveys[], overlapPct per survey, confidence}`.
- Match rule per parcel: share of parcel area inside the compartment (raw frame). >= 60% **inside**, 10-60% **partial**, < 10% ignore. Replaces today's 25% grid sample.
- Resolve duplicate compartment numbers: pick the polygon inside the village; if several, prefer the same range/beat as the neighbouring approved compartments of that taluka; flag the rest as ambiguous.
- Compare mapped ha with the sheet's approved ha. Flag a village when they differ by more than 25% (Udmal would pass; use the flags to review).

### Phase 2: Conflict filter (villager land vs CFR land)
A **conflict** is a parcel that lies inside an approved CFR compartment but has a private 7/12 holder (not forest dept / government).
- New status `conflict` next to recognized / forest / govt / other. Decide by: owner is a private person AND overlap with an approved compartment >= 10%.
- Classes: **full** (>= 60% inside), **partial** (10-60%). Show overlap % and owner on the plot card.
- Own colour (red/orange hatch), own chip and count in the CFR panel, own column in the village report and Excel export, and a separate list ("parcels to resolve") for the gram sabha.
- Needs a field decision: how should the overlapped area be counted in "recognized" totals? Recommended: count only forest-dept / government parcels as recognized, and report conflict area separately so totals are not overstated.

### Phase 3: Government land
No change. The existing govt candidate logic stays; it only needs a regression check that conflict parcels never fall into the govt bucket.

### Phase 4: Gram sabha CFR land outside the village boundary
- Many Nashik claims use compartments of a neighbouring village. Order of resolution, **village polygon first, then outside**:
  1. compartments intersecting the village polygon (done today);
  2. if an approved compartment number is not found, query MRSAC forest within a buffer (start 5 km) of the village, filter by COMP_NO, prefer the same range/beat/taluka, nearest first;
  3. if still not found or still ambiguous, show it as "not located" in the panel and never guess.
- Draw outside compartments as the dashed outline (no parcels exist there), labelled "outside village", with the sheet ha. They carry the same calibration shift as the rest.
- Report them separately: "CFR land outside village: N compartments, X ha".

### Phase 5: Verification
- Playwright check per taluka sample (3 villages each): compartment edge vs village edge offset < 10 m after calibration; no duplicate labels; mapped ha vs sheet ha within tolerance.
- Unit check on the match rule (inside / partial / ignore) and conflict classification with fixed fixtures.
- Review sheet: villages flagged for ha mismatch, ambiguous numbers, outside-village hits, unmatched village names (about 38% of village names did not match the portal list exactly before fuzzy matching).

## Open questions
1. Overlap thresholds (60% / 10%): confirm, or give the forest dept's rule.
2. Should conflict parcels count toward CFR recognized area, or only be reported?
3. Buffer for outside-village search: 5 km start; is the neighbouring-village rule enough, or can claims cross talukas?

## Implementation status (2026-10-08)
Decisions used for the open questions: thresholds 60% / 10%; conflict area reported separately (not counted as recognized); outside-village search 5 km, any taluka.

| Phase | Status |
|---|---|
| 1 Mapping | Done in the browser, not precomputed: every parcel is sampled on a 10x10 grid and gets a % overlap per compartment (`>= 10%` counts, `>= 60%` = inside). The build-time `public/data/cfr-comp/` file was dropped: it would need BhuNaksha parcel geometry for ~830 villages, and that portal is slow and fails about a quarter of calls. The panel shows mapped ha against approved ha instead of a build-time flag. |
| 2 Conflict | Done. New `conflict` status (red) when a private-holder parcel overlaps an approved compartment. Own chip, colour, plot-card text, panel line, and it flows into the PDF/Excel status map. Area is listed separately. |
| 3 Govt | Unchanged. Forest / government holders inside a compartment stay "recognized". |
| 4 Outside village | Done. Missing compartment numbers are searched in MRSAC within 5 km (nearest, plus slivers within 1.5 km of it), drawn dashed with "(outside village)". Numbers MRSAC cannot answer show as "could not be located". |
| 5 Verification | `tests/e2e/17-nashik-compartments.spec.ts` (Udmal: parcel count, area band vs 71.25 ha, conflict chip, no page errors). |

Known limits: Amlon (Peth) approves compartment 18, which MRSAC does not return within the village or 5 km (its nearby compartments are type FDCM); it is shown as not located, not guessed. The conflict class is a candidate list: MRSAC compartment edges are coarse, so a settlement inside a reserved-forest polygon (Udmal: 68 parcels, 44.8 ha) needs field review.
