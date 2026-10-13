# Nashik CFR: MRSAC-first mapping, 10 km outside-village land, nearest-village allocation, gram sabha names

Written for: the VanMitra project team. Revision 2 (decisions confirmed, workbook audited). Plan only, no code yet. Follows `NASHIK_CFR_IMPLEMENTATION_PLAN.md` (phases 1-5 done).

## Decisions confirmed
1. **Shared compartments**: allocate by proximity (rule in Phase C), using MRSAC geometry only. Nothing is invented; anything the data cannot settle is listed for review.
2. **10 km** is measured from the **village boundary**, not its centre.
3. **Gram sabha name** is shown **as written** in the sheet (e.g. "ग्रामस्त ओझरखेड").
4. **Parcel marking** stays as a **lighter secondary layer**; the MRSAC compartment polygon is the main mark.

## What the workbook audit found (12 taluka sheets + Summary, Sheet17, MPR)
Why some talukas and rows do not mark or show info properly:

| Finding | Where | Effect today | Fix |
|---|---|---|---|
| **Claimant is not the village.** The "village" column is the gram panchayat in Peth, and in Peth 81 of 142 claimant names differ from it (e.g. claimant जामले under village बाडगी, कहांडोळपाडा under हातरूंडी). Other talukas differ in 3-47 rows each. | Peth worst, then TBK 47, Kalvan 25 | Map looks the claim up under the wrong place; the gram sabha name is lost | Keep both: `gs` = claimant (display), `v` = village/GP (lookup). Try the claimant name as a second lookup key |
| **Eligible approvals with no compartment number** | Chandwad 6 (उसवाड, भडाणे, वराडी, मेसनखेडे, निमोण, कुंदलगाव), Peth 2 (जामले, कहांडोळपाडा) | Counted in totals, nothing drawn, no message | List as "compartment not recorded": show ha and gram sabha in the panel, never place by guess |
| **Column mixes forest compartment and gat/survey numbers** (header: वनकक्ष क्र. / गट नं.) | Malegaon (954/2, 201/1, 341/302, 122/1,395/1), Baglan (201/171), Deola (341/342), Kalvan (287/289) | `/` is read as a sub-compartment, so 954/2 becomes compartment 954 (wrong place) | Classify each token: first test as MRSAC COMP_NO near the village; if absent test as a survey/gat number in the village cadastral; otherwise "unparsed". Record which one matched |
| **Unparsed or damaged tokens** | `61193`, `36156`, `96136`, `40796` (commas lost, Dindori/TBK/Baglan/Surgana), `33 ते 77` (range), `49.50 पैकी`, `88 पार्ट`, `100 पार्ट`, `25(44)`, `158,159,80 ब`, `523 / 524`, `7./1` | Dropped silently | Expand ranges; "पैकी / पार्ट" = part of that compartment (flag partial); suspect digit runs go to a review list with the raw cell |
| **Approvals dropped for a blank village cell** | Surgana: 108 eligible, 105 built; 4 rows have no village | Hectares missing from totals | Fall back to the claimant name when the village cell is empty |
| **Taluka spelling differs from the portal** | त्र्यंबकेश्वर / त्रिंबक, बागलाण / बागलन, ईगतपुरी, दिडोरी / दिंडोरी, मालेगांव / मालेगाव (Summary uses other spellings than the sheets) | Needs a per-taluka alias or the panel finds nothing | One alias table, tested against the portal taluka list |
| **Pending / rejected / blank decision** | Sinnar 22 and Yeola 3 all अपात्र; TBK 50 blank decision (summary rows, no area); 68 non-approved lines in total | Correct: nothing to mark | Show them as "not approved" in the taluka list so the user sees why Sinnar/Yeola/Niphad are empty (Niphad has no sheet; Summary shows 0) |
| **Ha is per approval, not per compartment** | All | Split evenly over its compartments | Keep, label "estimated split"; replace with polygon area where a single polygon is unambiguous |
| **Village-name matching** | Earlier measurement: about 38% of names did not match the portal list exactly | Village not found, no map | Normalise spelling (ू/ु, ी/ि, ं, ".", "बु./खु."), add an alias file, report what is still unmatched |
| **Compartment numbers repeat** | 220 of 752 (taluka, compartment) pairs are claimed by more than one village | Overlap between neighbouring villages | Phase C |
| Cases with extra info worth showing | Form of right (3(1)(ग),(ख)…), CFRMC formed (Yes/blank), president/secretary/treasurer, bank | Not shown | Carry `fr`, `cfrmc`, office-bearers into the panel and village card |

## Target behaviour
1. **MRSAC compartment polygon is the primary mark** (filled, coloured per gram sabha). Parcels are a lighter secondary layer.
2. **10 km from the village boundary**: the village's own compartments plus the compartments of neighbouring gram sabhas, including those outside the village.
3. **Village names** on the selected village and every neighbouring village in range (MRSAC village layer), with click-through info.
4. **No stacked or overlapping claims**: each MRSAC polygon is drawn once, with the claimant(s) named; leftovers go to a conflict list.
5. **Gram sabha name on every CFR mark and panel row.**

## Phases

### Phase A: Repair the data build
- `scripts/build-cfr-data.mjs` (Nashik part): keep `gs` (claimant as written), `cn` (case no.), `fr` (form of right), `cfrmc`, office-bearers; fall back to the claimant when the village cell is blank; do not drop rows silently.
- Replace `parseCompartments` with a token classifier (compartment / gat / range / part / suspect) and an alias table for taluka and village spellings.
- Output a review file `data/cfr/nashik-review.txt` with: no compartment, suspect tokens, gat-vs-compartment ambiguity, unmatched villages, dropped rows. Expected counts to confirm against the sheet: 831 built vs Summary 828.

### Phase B: Resolve each claim to MRSAC polygons (build time, then cached)
- New `scripts/build-comp-resolve.mjs` -> `public/data/cfr-comp/<taluka>.json`; per claim `{village, gs, compNo, polygonIds[], range, beat, type, distKm, status}`.
- Source: MRSAC forest layers 5 and 12 and the village layer already used in `mrsac.ts`, queried with the village polygon and a **10 km buffer from its boundary**.
- Candidate score (all from MRSAC): (1) polygon inside the village, then distance from the village **boundary**; (2) same range/beat as the village's other approved compartments; (3) compartment type must be a CFR-eligible forest type (FDCM is excluded and said so, as with Amlon 18); (4) polygon area against the claim (a 2 ha polygon cannot hold 60 ha).
- Result `status`: `inside`, `outside` (with distance and the neighbouring village name it lies in), `ambiguous`, `notfound`. Ties are never broken by guess.
- Cache the output so the map no longer calls MRSAC per click.

### Phase C: Nearest-village allocation for shared polygons
- For each MRSAC polygon claimed by more than one gram sabha, order claimants by distance from their village boundary to the polygon (inside the village = 0; ties by same range/beat).
- Allocate the polygon's MRSAC area (`ShpAreaHa`) to claimants in that order up to each claim's ha; the rest is `over-claimed`.
- Draw the polygon once. If shared: hatched, label lists every gram sabha and ha. If one claimant: solid, one gram sabha.
- A claimant farther than the nearest village by more than a set gap (default 3 km) is flagged "far claim, verify".
- Per village `conflicts[]` = over-claimed and far claims. Two different names in the UI: **Overlapping claim** vs the existing **Private land in CFR**.
- Optional cross-check only: Bhuvan / FSI forest cover or OSM boundaries for visual comparison. MRSAC stays the authority; I will check these sources are reachable before relying on them.

### Phase D: Map and panel
- Layers: compartment polygons (primary), 10 km neighbouring village outlines with name labels, parcels (lighter, selected village only). Outside-village compartments get a dashed edge and "lies in <village>, X km".
- Labels: `Gram Sabha <as written> • comp. <no> • <ha> ha`.
- Village card: village, taluka, gram sabha(s), comp. nos., approved ha, mapped ha, form of right, CFRMC status, office-bearers, status chip.
- Radius slider 2-10 km (default 10). Panel table with one row per claim and a conflicts / review tab; Excel export includes the same.

### Phase E: Verification
- Fixture tests for the resolver: found inside; found only outside; two claimants on one polygon; tie; missing; gat number vs compartment; range and "पार्ट".
- Playwright, one village per taluka (12, including Chandwad and Malegaon for the odd formats and Peth for claimant vs GP): edge alignment, one label per polygon, gram sabha present on every mark, no page errors.
- Count check: built approvals and ha per taluka equal the sheet; every dropped or unplaced row appears in the review file.

## Known limits
- MRSAC compartment edges are coarse; a settlement inside a reserved-forest polygon still needs field review.
- Chandwad's 6 and Peth's 2 approvals without compartment numbers cannot be located without the numbers from the forest department.
- The proximity rule is a documented heuristic, not a legal boundary decision; the over-claimed and far-claim lists are the output for the forest department to confirm.

## Implementation status (2026-10-12)
| Phase | Status |
|---|---|
| A Data | Done. Gram sabha (`gs`), case no., CFRMC, office-bearers kept; blank-village rows recovered (Surgana +3, 834 rows, 59,767 ha vs 831 / 59,447 before); range, part, slash and gat-vs-compartment parsing; `data/cfr/nashik-review.txt` lists every unparsed or ambiguous cell. Not done: claimant name as a second lookup key for Peth hamlets. |
| B Resolver | Done as an offline build: `scripts/fetch-mrsac-nashik.mjs` (villages + compartments from MRSAC) then `scripts/build-comp-resolve.mjs` -> `public/data/cfr-comp/nashik.json`. 1,204 compartment claims: inside 366, outside 95 (within 10 km of the village boundary), located by number within the taluka 188, ambiguous 23, only-FDCM 81, not in MRSAC 451. |
| C Allocation | Done: 146 shared polygons allocated nearest-village first, 13 over-claimed, 25 far claims. |
| D Map / panel | Done: polygon layer with gram sabha labels, neighbouring villages within the radius named, claims table and 2-10 km slider in the CFR panel. Parcels stay as the secondary layer. |
| E Verification | `tests/e2e/18-nashik-resolved.spec.ts` (Udmal), `scripts/check-nashik-data.mjs` (counts). One Playwright village per taluka is still to do. |

MRSAC coverage gap: most "not in MRSAC" claims are in Peth (257 of 451) and Malegaon (40). Peth has only about 134 compartment polygons for 150 claims, and Malegaon's numbers look like gat numbers, so these need the forest department's numbers or another source rather than a better match.

### Update 2026-10-12 (drawing pass)
- **Drawn now: 920 of 1,204 claims (76%)**, up from 649 (54%). 649 are located compartments (inside 366, outside 95, located by number 188). 271 more are drawn as **unconfirmed dotted amber outlines**, never as located compartments: 81 where MRSAC has the number only as FDCM land, 23 ambiguous (all candidates outlined), 167 where the number is not in MRSAC and the outline is the forest land inside the matched village. Each is labelled "outline unconfirmed" and the panel says why.
- **Still not drawn: 284**, where the number is not in MRSAC and the village name does not match, mostly Peth. No other MRSAC service carries compartment polygons (checked the forest / wildlife services: they hold asset points, not compartments), so these need the forest department's data.
- Drawing fixes: one label per compartment (was repeated on every part), enclaves cut out as holes, parcel highlights at 50% and their serial badges shown only when zoomed in, and a "Show on map" button per claim that fits the view to an outside-village compartment.
