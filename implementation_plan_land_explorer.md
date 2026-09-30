# Land Explorer — plan to replace the Smart search / sort panel

Status: **plan only, nothing implemented.** Supersedes the search-UI parts of `implementation_plan.md` (that file describes what is already built).

## 1. What is wrong today (from reading the code)

| Problem you see | Cause in code |
|---|---|
| "Hard to understand" | 4 search-mode tabs + a name-part dropdown (Full/First/Middle/Last) + a 6-option sort dropdown + surname chips + land-type chips + highlight banner, all stacked in a 320px panel (`NakashaMap.tsx` ~3614–3820). "Smart" already covers what the other three tabs do. |
| Only ~3 results visible | The list is capped at `max-h-56` and sits below all those controls. |
| "Slow" | One `getPlotInfo` request per parcel (348 requests), 6 at a time (`loadVillageOwnerRecords`, `bulkFetchVillageRecords`). Search only sees parcels whose record has arrived, and the UI does not say so. Cache is `sessionStorage`, so a reload refetches everything. |
| Duplicate / noisy family chips | Chips key on the exact Devanagari string: `राउत 20`, `राऊत 14`, `राऊत`… are the same family split in three. Spelling variants are not merged. |
| "Looks like AI" | Emoji on every control, pill badges everywhere, three different badge colours per row, repeated "Family" + "Select ➔" buttons on every row. |
| Forest / water hard to find | Already classified (`classifyEnvCategory`, `villageEnvStats`) but only reachable through two hidden entries in the Map Type dropdown. |

Already built and reusable as-is: `plotSearchIndex`, `villageOwnerStats`, `villageEnvStats`, `matchOwner`/`tokenize`, `highlightPlotsGroup`, `classifyLandType`.

## 2. Target design

A single **Land Explorer** that lives in two places, from one component and one shared state:
1. **New left-toolbar item "Explore"** (between Cadastral and KML) → full-height panel, room for ~12 rows.
2. **Cadastral panel** keeps a compact version (search + category tiles + top 5 results + "Open in Explorer"). Both read the same filters, so changing one changes the other.

### Layout (top to bottom)
1. **One search box.** No mode tabs. Auto-detect: digits/`255/1` → survey number; text (Marathi or English) → any name part. Placeholder: "Name, surname or survey no." A small "Match in ▾" menu (Any / First / Middle / Last name) replaces the two old selectors.
2. **Category tiles with live counts**, multi-select, one tap: Farm · Residential · Government · Forest · Water · Other. This is where forest land and water bodies become first-class, per village.
3. **Sort**: one segmented control — Survey · Name · Area (tap Area again to flip ↑/↓). Replaces the 6-option dropdown.
4. **Summary bar**: "23 parcels · 41.2 ha (101.8 ac)" + `Show on map` + `Export CSV`. This is the "highlight all" action, driven by whatever the filters currently select.
5. **Families** — collapsed row of top 5, "All families (n)" opens a searchable list. Chips merged by phonetic key.
6. **Results**: dense single-line rows — `Survey 26 · 1.49 ha · इंदुबाई वि. गंगाराम…` with a small category dot. Row click = select and zoom; one overflow menu for "highlight this owner / this family". Loads 50 at a time on scroll (no "Show 100 more" button).
7. Honest status line while records load: "Records 212 / 348 — results may be incomplete", replacing the silent partial list.

Style: no emoji on controls, one accent colour, category colours only for the tiles/dots/map, real labels over icons. Marathi labels shown alongside English (Farm / शेती, Forest / वन, Water / जलस्रोत).

### Category rules (be explicit about the limit)
The portal's `getPlotInfo` gives only owner text, area, pot-kharaba and khata — **no land-use field**. So categories are inferred:
- **Forest**: holder text matches वन विभाग / वनविभाग / जंगल / कुरण (existing regex).
- **Water**: तलाव / नदी / नाला / ओढा / बंधारा / धरण / कालवा / पाणथळ / पाटबंधारे.
- **Government (other)**: शासन / ग्रामपंचायत / गायरान / गावठाण / रेल्वे … (existing `isGovernmentOwner`).
- **Residential**: existing suffix rule and gaothan text.
- **Farm**: everything with a private owner and cultivable area. **Other**: the remainder.
Tiles carry a tooltip "Inferred from 7/12 holder name" so nobody mistakes it for an official land-use record. Adding synonyms later is a one-line regex change.

## 3. Speed work

1. **Persistent cache**: move parcel-record cache from `sessionStorage` to IndexedDB (records + geometry), keyed by gisCode with a 24h TTL. Second visit to a village is instant.
2. **Fetch order**: fetch in survey-number order but start with parcels the user is looking at / searching; raise concurrency 6 → 10 with back-off on 429/5xx. (Portal load is the unknown — start at 8, verify.)
3. **Spike (1 hour, before building)**: probe the MahaBhuNakasha REST for a village-level bulk owner call. If one exists this removes 348 requests entirely; if not, we stay with the queue.
4. **Render cost**: `startTransition` on filter changes, `content-visibility:auto` rows + 50-row windowing; index is already memoised.
5. **Family merge**: key chips on `normalizePhonetics(devanagariToEnglish(surname))` so राउत/राऊत merge; display the most frequent spelling.

## 4. Map behaviour
- `Show on map` reuses `highlightPlotsGroup` with a new type `filter`, coloured by category (forest green, water blue, farm amber, government slate).
- Selecting Forest or Water tile + `Show on map` = "all forest / water parcels of this village" (what you asked for). The existing Map Type entries call the same code path.
- Highlight cap: above ~150 parcels, fall back to bounding-box + WMS layer filter rather than drawing hundreds of polygons (avoids the request storm in `highlightPlotsGroup`).

## 5. File / code changes
- **New** `src/components/LandExplorer.tsx` — presentational; props = filters, results, stats, callbacks. ~300 lines.
- **New** `src/lib/land-categories.ts` — category taxonomy + `classifyParcel()` (moves `classifyLandType`/`classifyEnvCategory` logic behind one function, keeps old exports as wrappers).
- **New** `src/lib/record-cache.ts` — IndexedDB cache used by `bhunaksha-owners.ts`.
- **Edit** `NakashaMap.tsx`: add `"explore"` to `PanelKey`, toolbar button, render `<LandExplorer/>` in both places; delete the old search block (~200 lines); replace 6 `useState`s (mode, namePart, sort, surname, owner, landType) with one filter object.
- **Edit** `marathi-search.ts`: category regexes, phonetic family key.
- Not touching: map layers, calibration, report modal.

## 6. Delivery order (each step shippable, branch stays working for Lovable sync)
1. Categories + phonetic family merge (lib only) + unit check of the regexes against real owner strings from Khedi/Ozar.
2. `LandExplorer` component in the Cadastral panel, replacing the old block.
3. Toolbar "Explore" panel using the same component.
4. Persistent cache + concurrency change + status line.
5. Map colouring by category, export CSV.

## 7. Verification
- `npm run build` clean.
- Manual on the village in your screenshot (348 parcels): "Sahare" finds the same parcels as today; राउत/राऊत merge into one family; Forest/Water tiles show counts and highlight; reload → second load is near-instant.
- Check on a village with real forest/tank parcels (verify counts against MahaBhuNakasha).

## 8. Risks
- Forest/water are **inferred**; villages whose 7/12 holder text is generic ("महाराष्ट्र शासन") will not be tagged. Acceptable for v1, flagged in the UI.
- Portal rate limits could cap the speed gain from higher concurrency.
- `NakashaMap.tsx` is 4.6k lines; extraction must not disturb the map refs. Component stays presentational to keep that safe.

## 9. Decisions needed
1. Panel name in toolbar: "Explore" (recommended) or "Land Records"?
2. Keep Marathi/English bilingual labels everywhere (recommended)?
3. Should CSV export be in v1, or skip it (YAGNI)?
