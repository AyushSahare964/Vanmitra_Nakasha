# ADVANTE — Ozar Village Specification & Prompt

---

Build a complete, modern, responsive, professional web application called **ADVANTE**.

**Full name:** Automated Integration and Intelligent Harmonization of Multi-source Geospatial Data for Urban Land Record Management, customized as a pilot deployment for **Ozar Village**.

This is an AI-powered Web GIS platform for government land administration, GIS surveyors, and land record officers. It integrates and harmonizes multi-source land claim data — starting with a real dataset of Individual Forest Rights (FRA-style) claim records for Ozar village — into a unified, verified "Golden Land Record" per survey number.

---

## 1. REAL DATA — USE THIS, NOT GENERIC MOCK DATA

I'm attaching `Ozar_Village_Dataset_final_f.csv`. This is the actual source dataset and should drive every screen instead of invented numbers. Its structure:

| Column | Meaning | Notes |
|---|---|---|
| `Sr_No` | Row/serial number | Unique per row |
| `District_Case_No` | Government case/claim number | Ranges ~751–24015 |
| `Original_Claimant_Name_Raw` | Raw OCR/scanned text of claimant name | Garbled legacy scan — display as "source text (unverified OCR)" |
| `Claimant_Name_Marathi` | Claimant name in Marathi (Devanagari) | Primary display language |
| `Claimant_Name_English` | Claimant name transliterated to English | Secondary display language |
| `Village_Name` | Always "Ozar" | Single-village dataset — no village selector needed, just show "Ozar Village" as fixed context |
| `Survey_No` | Cadastral survey number | Only **12 unique values** (14–463) |
| `Area_sqm` | Claimed area in square meters | Range ~100–27,000 sqm |
| `Caste_Category` | Category | All rows are "S.T" in this dataset |

**Critical real-world pattern to design around:** Survey No. **324 has 116 separate claimant records** on it (out of 147 total rows), while the other 11 survey numbers mostly have 1 claimant each. This is not noise — this is the single most important real signal in the dataset. Use it as the flagship example of **Boundary Overlap / Multiple Claimant Conflict**: Survey No. 324 should appear in the app as a large, high-priority conflict cluster requiring review, while the single-claimant survey numbers appear as clean, low-friction records that can move toward "Verified" quickly.

**Geometry note:** the CSV has no coordinates or polygons. Since Ozar's real parcel boundaries aren't in this file, generate deterministic mock GeoJSON polygons — one cluster of adjoining polygons per unique `Survey_No`, seeded so it's stable across reloads (same survey number always renders the same shape). Center the whole village layout near a plausible Nashik-district coordinate (Ozar, Niphad taluka, Nashik district, Maharashtra) and note in a small UI label that boundary geometry is illustrative pending official survey shapefiles, while all attribute data (names, case numbers, area, category) is real.

**Do not invent additional villages, districts, or claimants.** Every claimant, case number, and survey number shown anywhere in the app should trace back to a row in this CSV. Where the app needs derived/simulated fields not present in the source (confidence score, data source tags, processing status, conflict severity, verification status, GNSS alignment, datum accuracy) — clearly generate those as the AI-harmonization layer's *output*, not as if they came from the source file.

---

## 2. DOMAIN FRAMING

Treat this as an **Individual Forest/Land Rights claim harmonization** use case, not generic property cadastre:

- "Parcel" = a physical piece of land tied to a `Survey_No`.
- "Claimant" = a person named in `Claimant_Name_Marathi` / `Claimant_Name_English`, tied to a `District_Case_No`.
- A single Survey_No parcel can have **many claimants** — this is the core conflict type the app must handle well (not a bug in the data, a real land-administration problem: overlapping/duplicate claims on shared survey numbers).
- Category (`S.T`) should be shown factually as part of the claim record (it's a legally relevant field in Indian land-rights administration) without editorializing — treat it the same as any other structured metadata column, shown plainly in tables and detail panels.
- Always show claimant names bilingually: Marathi first (primary, as it's the authoritative source), English transliteration as secondary/subtitle text.

---

## 3. PRODUCT REQUIREMENT

This should **not** look like a generic dashboard template. It should look like a professional:

- Government technology platform
- Enterprise GIS application
- AI-powered geospatial intelligence system
- Smart-city / rural land administration platform

Modern, clean, map-focused, data-driven. Premium enterprise SaaS design: clean typography, spacious layout, professional cards, subtle shadows, minimal gradients, responsive layout, modern icons, interactive charts, GIS-style controls, sophisticated visual hierarchy.

Avoid: excessive gradients, gaming-style UI, overly colorful design, generic startup landing-page look, large decorative illustrations.

---

## 4. TECHNOLOGY

- React + TypeScript
- Tailwind CSS
- shadcn/ui components
- Reusable components, scalable folder structure
- Leaflet-ready map architecture (mock GeoJSON layer, structured so a real tile/basemap provider can be swapped in later)
- Parse the attached CSV at build/load time into a typed dataset (e.g. `ozarClaims.ts`) that every page reads from — single source of truth, not separately hardcoded per page

Build a functional prototype: working navigation, buttons, modals, forms, tables, filters, search, interactive map layers, parcel selection, status changes, and review workflows — not a static site.

---

## 5. BRANDING

**Name:** ADVANTE
**Tagline:** Intelligent Geospatial Harmonization for Urban Land Records
**Pilot context label (show subtly in the top nav or dashboard header):** "Pilot Deployment — Ozar Village, Niphad Taluka, Nashik District"

**Description:** ADVANTE is an AI-powered platform that automatically integrates and harmonizes multi-source geospatial datasets and land claim records. It detects parcel boundaries, aligns coordinate systems, compares claimant records across sources, identifies conflicts (like overlapping claims on a shared survey number), calculates confidence scores, and produces verified Golden Land Records.

---

## 6. APPLICATION SHELL

**Top navigation bar:** ADVANTE logo, global search (search by claimant name, District_Case_No, or Survey_No), "Ozar Village" project selector (fixed/disabled for this pilot, styled as if more villages could be added later), notifications, help, user profile menu.

**Left sidebar** (collapsible): Dashboard, Map Explorer, Datasets, Processing Center, Review Queue, Conflicts, Golden Records, Reports, AI Assistant, Settings. Use professional line icons.

---

## 7. PAGE 1 — DASHBOARD

Header: "Good Morning, Officer" / subtitle: "Monitor and manage the Ozar Village land record harmonization pilot."

**KPI cards (compute from the real CSV, not fixed numbers):**
1. Total Claim Records — 147
2. Unique Survey Numbers (Parcels) — 12
3. Harmonized / Verified Records
4. Pending Review
5. Active Conflicts (flag Survey No. 324 as the driver)
6. Verified Golden Records

Each card: main number, trend arrow, small icon, % change (simulated week-over-week for the demo).

**Charts:**
- **Harmonization Status** — Verified / Under Review / Conflicted / Field Verification, computed from simulated status assigned per record
- **Confidence Score Distribution** — Above 90% / 75–90% / Below 75%, simulated per record but weighted so single-claimant survey numbers skew high-confidence and Survey No. 324's cluster skews low-confidence (realistic — more claimants sharing a survey number = harder to auto-harmonize)
- **Claims by Survey Number** — bar chart, Survey No. 324 should visibly dwarf the rest (116 vs. mostly 1)
- **Recent Processing Activity timeline** — e.g. "147 claim records ingested from Ozar Village register", "AI processing completed for 11 single-claimant survey numbers", "Conflict cluster detected: Survey No. 324 (116 overlapping claims)", "Officer reviewed 3 records", "Golden Record created for Survey No. 14"

---

## 8. PAGE 2 — MAP EXPLORER

Full-screen GIS layout: Left panel (layer management) / Center (interactive map) / Right panel (parcel & claimant info).

**Layers:** Satellite Imagery (mock basemap), Cadastral Boundaries (the 12 survey-number polygons), Golden Records, Claim Density Heatmap, Conflict Zones (highlight Survey No. 324).

**Parcel status colors:** Verified / Needs Review / Conflict / New Harmonized Record / Incomplete Data.

**Click a parcel →** side panel shows: Survey Number, all claimant names on it (Marathi + English) with District_Case_No each, total claimed area vs. sum of individual `Area_sqm` entries, confidence score, source, verification status, conflict status. Buttons: View Details, Compare Claimants, Send for Review, Create Golden Record. For Survey No. 324 specifically, this panel should be built to gracefully handle a long list (116 claimants) — use a scrollable/searchable sub-list, not a flat dump.

---

## 9. PAGE 3 — DATASET MANAGEMENT

Table listing all 147 rows from the CSV: Claimant (Marathi/English), District_Case_No, Survey_No, Area_sqm, Category, Status, Actions. Search by name/case/survey number. Filters by survey number, status, area range.

**Upload wizard** (4 steps) for adding future datasets on top of this base register: Select Source Type (Cadastral Map, Drone Imagery, GNSS Data, GeoJSON, Shapefile, Revenue Record) → Drag-and-drop upload with progress → Metadata (Village = Ozar prefilled, Ward, Taluka, Survey Date, Coordinate System) → Review & Start AI Processing.

---

## 10. PAGE 4 — PROCESSING CENTER

Visual pipeline: Dataset Quality Analysis → Coordinate Harmonization → Georeferencing → Parcel Boundary Detection → Spatial Matching → Record Fusion → Conflict Detection → Confidence Scoring → Golden Record Creation. Each stage: Pending / Processing / Completed / Failed, with a detail panel. Seed a sample run using the Survey No. 324 cluster as the demo case moving through the pipeline.

---

## 11. PAGE 5 — REVIEW QUEUE

Table: Survey Number, Claimant(s), Confidence, Conflict Type, Sources, Priority, Status. Survey No. 324 should appear as the top-priority, highest-conflict-count entry.

Open a review → split screen: Left (raw claimant record incl. the raw OCR name field, shown as "unverified source text"), Center (map with parcel geometry + all overlapping claim markers), Right (AI analysis: Boundary Match Score, Record Match Score, GNSS Alignment, Datum Accuracy, Final Confidence, AI Recommendation). Actions: Approve, Reject, Request Correction, Send for Field Verification.

---

## 12. PAGE 6 — CONFLICT DETECTION

Conflict types: Boundary Overlap, Duplicate Claimant on Survey Number, Area Mismatch, Survey Number Mismatch, Coordinate System Error. Severity: Low/Medium/High/Critical. Survey No. 324 (116 claimants) = Critical, flagship example. Map view highlighting conflict zones.

---

## 13. PAGE 7 — GOLDEN LAND RECORDS

Table: Golden Record ID, Survey Number, Claimant(s), Area, Confidence, Version, Status. Detail view: Overview, Spatial Information, Source Claim Records, AI Analysis, Version History, Audit Trail. Source fusion diagram: Cadastral Claim Register → GNSS (simulated) → Revenue Record (simulated) → Golden Land Record.

---

## 14. PAGE 8 — AI ASSISTANT

"Ask ADVANTE AI" — chat interface, Marathi/English/Hindi support. Wire simulated responses to real data, e.g.:
- "Show all claimants on Survey No. 324" → lists all 116, paginated
- "Show parcels with confidence below 75%"
- "सर्व्हे नंबर ३२४ ची माहिती दाखवा" (Survey No. 324 info)
- "किती claims Ozar village मध्ये आहेत?" → "147"
- "Show overlapping claims in this area"

Each answer: natural language summary, relevant records, confidence, map-highlight action, suggested follow-ups.

---

## 15. PAGE 9 — REPORTS

Cards: Claim Verification Report, Conflict Report (Ozar, Survey No. 324 focus), Dataset Quality Report, Harmonization Report, Confidence Analysis, Golden Record Report. Buttons: Generate, Download PDF, Export CSV, Export GeoJSON.

---

## 16. PAGE 10 — SETTINGS

Profile, Organization, User Management, Roles & Permissions, Coordinate System Settings, AI Model Settings, Notification Settings, API Settings.

---

## 17. CONFIDENCE SCORING COMPONENT

Reusable component. Weights: Boundary Quality 30% / Record Match Score 35% / GNSS Alignment 25% / Datum Accuracy 10%. Circular indicator + horizontal bars + score breakdown. Apply so single-claimant survey numbers trend high, the 324 cluster trends low/mixed.

**Decision routing (visually prominent):**
- ≥90% → AUTO HARMONIZED
- 75–89% → HUMAN REVIEW REQUIRED
- <75% → FIELD VERIFICATION REQUIRED

---

## 18. FUNCTIONAL REQUIREMENTS

Make these work with real frontend state built from the CSV: upload datasets, filter/search by claimant/case/survey number, toggle map layers, select parcels, view claimant details, compare records, change review status, approve/reject, create Golden Records, filter conflicts, query the AI Assistant, navigate all pages, show processing progress, reflect status changes live.

---

## 19. BUILD ORDER

Start with the authenticated app shell: sidebar, top nav, routing, CSV data layer, Dashboard, Map Explorer, Dataset Management. Then build the remaining modules using the same shared Ozar dataset and reusable components.
