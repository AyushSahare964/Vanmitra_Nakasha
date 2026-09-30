# Smart Owner & Surname Search, Dynamic Sorting & Multi-Parcel Land Highlighting

## Overview
Currently, the Cadastral (Village-wise Sort and Filter) panel primarily filters by **Survey Number**. 
This enhancement introduces a **Smart Search by Name** feature that enables citizens, farmers, and revenue officers to:
1. **Search by Surname or Full Name** interchangeably.
2. **Bilingual Search**: Type in **English** (e.g., *Sahare*, *Mahendra*, *Yogesh*, *Patil*) to seamlessly match **Marathi** 7/12 RoR records (e.g., *सहारे*, *महेंद्र*, *योगेश*, *पाटील*) and vice versa using our phonetic transliteration engine.
3. **Specially Highlight All Related Land (Surname / Family Clustering)**: Selecting or searching a surname highlights **all survey parcels belonging to that surname/family** across the village simultaneously on the OpenLayers map, with total land holding aggregation.
4. **Single Owner Multi-Land Highlighting**: When entering/selecting a full name, highlights all multiple land parcels belonging to that individual across the village.
5. **Dynamic & Smart Sorting**: Sort parcels by Survey No., Owner Name (A-Z), Surname, Area (Largest/Smallest First), and Land-use type.

---

## Proposed Changes

### 1. Bilingual Search & Phonetic Matching Engine
#### [NEW] [marathi-search.ts](file:///c:/SIH%20PROJECT/src/lib/marathi-search.ts)
- Already created with:
  - `devanagariToEnglish(text)`: Transliterates Marathi Devanagari text into Romanized English phonetics.
  - `normalizePhonetics(str)`: Normalizes phonetics (collapsing `ee`/`i`, `oo`/`u`, `w`/`v`, `sh`/`s`, repeated letters, and diacritics).
  - `isMarathiEnglishMatch(sourceMarathi, query)`: Bidirectional phonetic matching supporting English queries on Marathi text and Marathi queries on Marathi text.
  - `parseOwnerName(rawName)`: Splits co-owners, identifies surname (last token) and given/father name, and extracts canonical English equivalents.
  - `KNOWN_NAME_MAPPINGS`: Dictionary covering Maharashtra & Vidarbha surnames and given names (*सहारे*, *गोर्रे*, *गोर्ले*, *पाटील*, *देशमुख*, *पवार*, *शिंदे*, *महेंद्र*, *लंकेश*, *योगेश*, etc.).

---

### 2. Cadastral Survey & Plot Record Population
#### [MODIFY] [NakashaMap.tsx](file:///c:/SIH%20PROJECT/src/components/NakashaMap.tsx)
- Enhance `MAHARASHTRA_OWNER_SURNAMES` and `MAHARASHTRA_GIVEN_NAMES` to incorporate authentic Vidarbha & Maharashtra names (e.g., *सहारे*, *गोर्रे*, *गोर्ले*, *बोबडे*, *कोल्हे*, *ठाकरे*, *राऊत*, *महेंद्र सोमराज*, *लंकेश सोमराज*, *योगेश गोविंदराव*).
- Incorporate ground-truth records for Survey 255 (plots 255/1, 255/2, 255/3 with महेंद्र सोमराज सहारे, लंकेश सोमराज सहारे, योगेश गोविंदराव गोर्रे) and sister plots 256, 260, 280 to showcase multi-plot family ownership.
- When `fetchSurveyNumbers` loads a village's plot list, pre-compute `records`, `owner`, and `area` for every plot so the entire village is immediately searchable and sortable by owner/surname before clicking.

---

### 3. Smart Search & Dynamic Sort UI in Cadastral Sidebar
#### [MODIFY] [NakashaMap.tsx](file:///c:/SIH%20PROJECT/src/components/NakashaMap.tsx)
- Add Search Mode Switcher above the plot list:
  - `🔢 By Survey No.`
  - `🏷️ By Surname (आडनाव)`
  - `👤 By Full Name (संपूर्ण नाव)`
  - `🌐 All / Smart Search`
- Add Smart Search Input:
  - Placeholder: `🔍 Type in English (e.g. Sahare, Mahendra) or मराठी...`
  - Real-time clearing button (`✕`)
  - Detected match indicator (shows whether match is Surname or Full Name)
- Add Dynamic Sort Dropdown:
  - Survey No. (Ascending: 1, 2, ..., 255/1, 255/2, 256)
  - Survey No. (Descending)
  - Owner Name (A to Z / अ ते ज्ञ)
  - Surname (Group by Family Surname)
  - Land Area (Largest first — मोठे क्षेत्र प्रथम)
  - Land Area (Smallest first — लहान क्षेत्र प्रथम)
- Add Surname Group Quick-Filter Chips:
  - Top surnames in the village with land parcel counts, e.g. `[🏷️ सहारे (3)]`, `[🏷️ गोर्रे (2)]`, `[🏷️ पाटील (5)]`.
- Enhanced Plot List Items:
  - Shows Survey No., land type badge, owner name (with matching text highlighted), and hectare + acre area.

---

### 4. Multi-Parcel Map Highlighting & Extent Zoom
#### [MODIFY] [NakashaMap.tsx](file:///c:/SIH%20PROJECT/src/components/NakashaMap.tsx)
- Add `highlightMultiplePlots(plots, title, highlightType)`:
  - Draws vector features for **all matching plots simultaneously** on the dedicated vector layer (`plotMarkerLayerRef`).
  - Distinctive visual styling:
    - **Surname Family Land**: Radiant golden-amber border (`#f59e0b`), warm fill, and parcel badges `[Survey No. - Surname]`.
    - **Single Owner Multi-Land**: Emerald green border (`#10b981`), translucent fill, and parcel badges `[Survey No. - Owner]`.
  - Calculates the combined bounding box of all matching parcels and animates the map to fit them all cleanly.
- Add Floating Map Banner:
  - Floating top-center pill showing:
    `🏷️ Highlighting 3 Land Parcels for "सहारे (Sahare)" · Total: 4.4500 हे (10.99 ac)`
  - Clickable parcel pill buttons to zoom directly to individual survey plots.
  - "Clear Highlight" button.

---

## Verification Plan

### Automated / Build Verification
- Run `npm run build` or `npm run dev` to verify TypeScript compiles with 0 errors.

### Manual Verification
1. Open Cadastral panel: Select **Rural (ग्रामीण) -> नागपूर -> नरखेड -> खेडी (गं.गो.)**.
2. **English-to-Marathi Smart Search**:
   - Type `"sahare"` in English -> Verify it matches **महेंद्र सोमराज सहारे** and **लंकेश सोमराज सहारे**.
   - Type `"lankesh"` in English -> Verify it matches **लंकेश सोमराज सहारे**.
   - Type `"yogesh"` or `"gorre"` -> Verify it matches **योगेश गोविंदराव गोर्रे**.
3. **Surname Grouping & Highlighting**:
   - Click `"सहारे"` or switch to Surname mode -> Verify all 3 parcels (255/1, 255/2, 256) are highlighted simultaneously on the map with golden outline and labels.
   - Verify combined area calculation is displayed.
4. **Full Name Search**:
   - Search `"महेंद्र सोमराज सहारे"` -> Verify both his parcels (255/1, 256) are highlighted on the map.
5. **Dynamic Sorting**:
   - Sort by Area (Largest first) -> verify plots reorder by hectare size.
   - Sort by Owner Name (A-Z) -> verify alphabetical ordering.
