# VANMITRA — Nakasha WebGIS
## Proposal for State-Wide Adoption: Community Forest Resource (CFR) Intelligence on the Cadastral Map

**Prepared for:** Tribal Development / Revenue / Forest Department officers, Government of Maharashtra
**Prepared by:** Team VANMITRA
**Status of this document:** describes what is **already working today** (Section 3–6), what is **honestly not yet done** (Section 9), and what we **request** to take it state-wide (Sections 10–12).

---

## 1. Executive summary

Community Forest Resource (CFR) rights under Section 3(1)(i) of the Forest Rights Act are decided and tracked on **three separate systems** that do not talk to each other:

1. **Revenue records** — survey numbers, 7/12 holders and cadastral maps on MahaBhuNakasha / MahaBhulekh.
2. **CFR approval lists** — spreadsheets kept at district level (survey numbers, area, purpose).
3. **Forest and water resource data** — forest compartments, wells, water-conservation structures (MRSAC) and village-level CFR layers (ATREE).

An officer who wants to answer the simple question *"Which survey numbers in this village are already CFR-recognized, and which land is still a candidate?"* today has to open all three, and match village and survey-number spellings by hand.

**VANMITRA puts all three on one map, at survey-number level.** Pick a district, taluka and village; the live cadastral parcels appear; CFR-recognized survey numbers are highlighted; forest, government and water-body parcels are flagged as claim candidates; and the village's wells, water structures and forest compartments are counted and drawn — in under a minute, from a browser, with no installation.

It is built and running, tested on real data for **Nagpur district (705 approvals, ~5,300 survey-number entries, ≈49,464 ha)**. The design is not Nagpur-specific: adding a district is dropping in its spreadsheet and re-running one script.

**What we ask:** an official data-sharing arrangement and a pilot in 3–5 districts (Section 10).

---

## 2. The problem in plain terms

| Today | Consequence |
|---|---|
| CFR approvals live in Excel sheets keyed by *village name and survey number text*. | No map view; nobody can see coverage or gaps. |
| Village names are spelled differently across departments (गांव/गाव, खुर्द/खु., रिठी/रि., "त.सा.क्र. 58"). | Manual matching, errors, and duplicate villages. |
| The cadastral map (MahaBhuNakasha) shows parcels but knows nothing about CFR. | An officer cannot tell if a parcel is already recognized. |
| Forest and water assets are on separate GIS portals. | Claim verification and post-recognition planning need several tools. |
| No quick way to ask "how much forest / government land in this village is still unclaimed?" | Candidate identification is slow and depends on individual local knowledge. |

---

## 3. What VANMITRA does — feature catalogue (all built and demonstrated)

### 3.1 Live cadastral map of Maharashtra
- Village-level parcel lines from **MahaBhuNakasha** drawn over satellite imagery, for the state's Rural / Urban categories, **36 districts → talukas → villages** (the app lists 305 talukas and 48,926 villages).
- Opacity presets (Faint / Balanced / Clear) so parcels can be read on top of imagery.
- **Cadastral alignment calibration**: the cadastral layer, the CFR outlines and the forest/water overlays share one calibration, so they stay on top of each other. (MahaBhuNakasha's map for some eastern-Maharashtra maps is stored with a known longitude offset; the system corrects for it.)
- Click any parcel → **Plot Info** window with survey number, total area (ha / sq.m / acres), pot-kharaba, owner name, khata number, plus the official **Map Report**.

### 3.2 Authentic 7/12 owner records
- For every parcel, owner records are fetched live from the government portal, not generated or estimated.
- Marathi and English owner search: by full name, first / middle / last name, or survey number; surname spelling variants (राउत / राऊत) are grouped as one family.
- Records are cached in the browser, so a village reopened later loads much faster.

### 3.3 CFR module — the core of this proposal
**a) Recognized survey numbers on the map**
- The approvals spreadsheet is converted to a village-keyed dataset. Survey numbers such as `289`, `100/1`, `59/ब` are parsed; Devanagari digits and separators are normalised.
- When a village is selected, its **recognized survey numbers are highlighted in violet** on the cadastral map with a label showing survey number and area.
- Matching rule is conservative and explainable: `100/1` matches `100/1` exactly; a parent number `100` covers its sub-numbers; `100/1` does **not** match `100/2`.
- The panel shows the reconciliation openly, e.g. *"2 of 178 parcels are recognized CFR land. 10 listed survey numbers were not found among this village's parcels."* Gaps in the data are surfaced, not hidden.

**b) Four-way land status per parcel** (colour-coded, filterable, sortable)

| Status | Meaning | Basis |
|---|---|---|
| **Recognized** | Survey number is in the CFR approvals list for that village | Official approvals list |
| **Forest candidate** | Not recognized; the 7/12 holder is the Forest Department, or the parcel lies inside an MRSAC forest compartment | Inferred |
| **Govt candidate** | Not recognized; holder is Government / Gairan / Gram Panchayat etc. | Inferred |
| **Other** | Private / other land | — |

The interface states plainly that candidate statuses are **inferred from the 7/12 holder and MRSAC data, not a legal eligibility finding.**

**c) Village CFR card**
Approvals count, survey numbers, approved area in hectares and acres, purposes of recognized land (grazing, timber & fuel, cattle / burial ground, other), and the percentage of the village's parcels that are recognized.

**d) Filters and sorting**
Filter by status, by purpose of recognized land; sort by survey number, status, approved area, parcel area, or owner name. Search by survey number instantly says whether it is Recognized, a candidate, or other.

**e) ATREE CFR layers (statewide context)**
- Village-level **CFR potential** and **CFR recognized** layers from ATREE (cfr.atree.org) can be switched on.
- For a selected village, the system identifies the matching ATREE village and draws **only that village's outline** (green dashed = potential, solid purple = recognized), and reports ATREE's own figures (e.g. *Rama, Nagpur: recognized area 115.6 ha, 2 titles*).
- Each village is matched to ATREE by sampling nine points inside the village and taking the polygon that wins the vote, with a stated confidence, because the two systems use unrelated village codes.

### 3.4 Water, wells and forest resources (MRSAC)
- Statewide map layers: water bodies, wells, water-conservation structures, rivers, streams; forest compartments, conservation reserves, wildlife compartments. Wells and structures draw when zoomed in.
- **Per-village summary**, computed live: e.g. *"Rama: 127 wells, 5 water-conservation structures, 1 water body; touches Reserved Forest."* with counts and hectares per type and toggles per type (irrigation well / community well / farm pond / cement nala bund …).
- Purpose: after a CFR title is granted, the same screen supports Gram Sabha planning for water and forest management.

### 3.5 Land Explorer (search, categories, highlight)
- One search box; category tiles with live counts — Farm, Residential, Government, Forest, Water, Other.
- "Show on map" highlights every parcel that matches the current filters (e.g. *all forest parcels in this village*).
- Category rules are documented and editable in one file; the interface labels them "inferred from the 7/12 holder".

### 3.6 Other tools in the platform
- **KML / KMZ upload** — overlay a boundary file on the parcels.
- **Reverse geocoding** — click the map to see the place name.
- **Officer login and dashboards** — territorial analytics and an urban harmonisation dashboard (district-level statistics, printable village cadastre audit dossier).
- Legend, layer list, full-screen map, works on a laptop browser; no installation.

---

## 4. A typical officer workflow (2–3 minutes)

1. Open the **CFR** tab → choose *Rural → Nagpur → Nagpur (Rural) → Rama*.
2. The village's cadastral parcels load. The panel reports *"2 approvals, 12 survey numbers, 115.6 ha."*
3. The two recognized survey numbers (61 and 203) are shown in violet with their areas; the ATREE village outline is drawn in purple.
4. Switch the status filter to **Forest candidate** → list of parcels held by the Forest Department or falling in a forest compartment; **Show on map** highlights them.
5. Read the water summary: 127 wells and 5 structures, useful for a post-recognition management plan.
6. Click any parcel → owner, khata, area, official Map Report.

Previously this needed the spreadsheet, the Bhulekh site, a GIS portal and manual spelling reconciliation.

---

## 5. Data foundation and quality (Nagpur pilot data)

| Item | Value |
|---|---|
| Records | 705 approvals (12 taluka labels; ≈669 villages) |
| Survey-number entries | 5,274; **5,257 (99.7 %) parse cleanly**; 17 odd entries are flagged for manual check, not guessed |
| Area integrity | Sum of the sheet equals its own footer (49,464.21 ha); acre and hectare columns agree on every row |
| Village linkage to the cadastral portal | First automatic pass: **574 villages matched uniquely**, 35 not found (spelling), 53 ambiguous (same name listed more than once — recognition deliberately **not** applied); later matching improvements are recorded in the build log at ≈95 % (to be re-verified with the department) |
| Data as of | Approvals up to **February 2018** (this is displayed in the panel so newer approvals are not implied to be absent) |

Every unmatched or ambiguous village is written to a **review report** for the department to resolve — the system never silently assigns a wrong village.

---

## 6. Architecture and performance (why it can scale)

- **Front end:** browser application (React / TanStack Start, OpenLayers map). No client software.
- **Thin server layer:** a small proxy relays requests to MahaBhuNakasha, ATREE and OpenStreetMap; it stores no personal data and applies session handling, retries and timeouts for the government portal.
- **CFR data:** a compact static file (~250 KB) generated by a build script from the department's spreadsheet; lookups are in memory.
- **Deployment:** serverless hosting (currently Vercel); can be moved to a State Data Centre / NIC cloud.
- **Measured behaviour (real tests, current network):**
  - Panel filters and sorting respond instantly (in-memory).
  - The government portal itself answers slowly — a district / taluka list call took 3–12 s and parcel tiles up to ~15 s in our tests — so results are cached (lists for a week, records in the browser) and repeat visits are much faster.
  - Recognized survey numbers appear as soon as the parcel list arrives; owner-based statuses fill in progressively.

---

## 7. Benefits by stakeholder

| Stakeholder | Benefit |
|---|---|
| **District Collector / DLC / SDLC** | One view of recognized vs. remaining forest and government land per village; faster verification of claims; visible data gaps. |
| **Tribal Development Dept.** | Coverage dashboard for CFR; targeting of villages with large candidate area but no recognition. |
| **Forest Dept.** | Parcels inside forest compartments cross-referenced to revenue survey numbers; less boundary dispute. |
| **Revenue / Land Records** | Reconciles approval lists with live cadastre; spelling and survey-number errors become a review list. |
| **Gram Sabha / community** | After recognition: wells, structures and forest area for their village on one screen, for management-plan discussions. |
| **Researchers / civil society** | Transparent, explainable matching with confidence and unmatched lists. |

---

## 8. Why our approach is defensible

- **Explainable matching.** Every recognized parcel traces back to a specific row of the approvals sheet; unmatched entries are listed.
- **No fabricated data.** Owner names, areas and geometry come from the government portals; candidates are labelled *inferred*.
- **Open standards.** WMS / GeoJSON, KML in, static JSON data; no proprietary lock-in.
- **Extensible.** New district = new spreadsheet + one script + a short review of unmatched villages.

---

## 9. Honest limitations (please read before deciding)

1. **Data coverage:** recognized data exists only for **Nagpur** (up to Feb 2018). Other districts show inferred candidates and ATREE village layers only, until sheets are supplied.
2. **Candidates are not legal eligibility.** "Forest" and "Govt" candidate labels come from the 7/12 holder text and MRSAC compartments; the portal has no land-use field. They are a screening aid for officers.
3. **Dependence on external portals.** MahaBhuNakasha responds slowly and occasionally drops connections; ATREE exposes no open vector service, so outlines are limited to a point-lookup approach. Our system retries and caches, but **an official API / data-sharing agreement would remove this fragility.**
4. **Village name matching is ~95 %, not 100 %.** A department review list is part of the process.
5. **Owner-record fetch is one request per parcel** (a village of ~200 parcels means ~200 calls), which is heavy on the portal; a bulk village-level endpoint from the department would eliminate this.
6. **Coordinate alignment** between datasets is calibrated empirically (few-metre offsets), not survey-grade.
7. **Not yet integrated** with FRA claim-processing workflows, Gram Sabha resolutions, or the tribal portal; it is a decision-support map, not a claims system.

---

## 10. What we request from the Government

| # | Request | Why |
|---|---|---|
| 1 | **Official data-sharing / MoU** with Mahabhumi (MahaBhuNakasha / Bhulekh) for a stable API, ideally a village-level bulk owner-record service. | Removes portal slowness and the per-parcel call load; legal clarity. |
| 2 | **CFR approval sheets for pilot districts** (same column layout as the Nagpur file), with latest approval dates. | Turns "candidate" screens into "recognized" screens for those districts. |
| 3 | **A nodal officer** in Tribal Development and one in Revenue for the village-name review lists. | Closes the ~5 % matching gap quickly. |
| 4 | **Access to authoritative forest-compartment and village-boundary layers** (Forest Dept / MRSAC) with permission to display. | Replaces inferred forest status with official geometry. |
| 5 | **Hosting on State Data Centre / NIC cloud** and security review (CERT-In empanelled audit). | Government-grade deployment. |
| 6 | **Pilot letter** naming 3–5 districts and the offices that will use it. | Real feedback from field users. |

---

## 11. Proposed roll-out plan

| Phase | Duration | Scope | Output |
|---|---|---|---|
| **0. Validate** | 2–4 weeks | Nagpur: department verifies 20–30 villages against files; resolve the 35 unmatched and 53 ambiguous villages. | Verified accuracy figure; corrected alias table. |
| **1. Pilot** | 2–3 months | 3–5 districts with CFR-rich talukas (e.g. Gadchiroli, Gondia, Chandrapur, Nashik/Palghar, Amravati) — load approvals sheets; train DLC / SDLC / Tribal Dev staff. | Usage feedback; list of required changes. |
| **2. Harden** | 2–3 months | Official API integration, State-Data-Centre hosting, security audit, role-based login, audit trail, backups, usage analytics. | Production-ready deployment. |
| **3. State-wide** | 3–6 months | Remaining CFR districts; Marathi-first interface pass; training material; helpdesk. | State-wide availability for all offices. |
| **4. Extend** | Later | Individual forest rights (IFR) layer; management-plan module; Gram Sabha mobile view; export of village CFR reports. | Full FRA decision-support suite. |

*(Durations are planning estimates for discussion, not commitments.)*

---

## 12. Suggested success measures (KPIs)

- Share of CFR approval survey numbers **successfully mapped** to live parcels (target ≥ 95 % per pilot district).
- Share of villages **auto-matched** without manual alias (target ≥ 95 %).
- **Time to answer** "is survey number X recognized?" (target: seconds instead of hours).
- Number of villages where **candidate area was identified** for follow-up by the Tribal Development Dept.
- Active officer users and villages viewed per month.
- Data-quality issues found and corrected in the source approvals lists.

---

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Portal downtime or rate-limits | Retries, caching, official API request (Section 10-1). |
| Misreading "candidate" as "eligible" | Explicit wording in the interface; documentation for officers; no legal language on the map. |
| Sensitive owner data | Records are shown as already published on the portal, fetched on demand and cached only in the officer's own browser; formal data-protection review to be done with hosting migration. |
| Wrong village linkage | Ambiguous villages are **not** auto-applied; review reports are generated. |
| Single-vendor hosting | Container-friendly build; can move to State Data Centre. |

---

## 14. Live demonstration script (10 minutes)

1. State overview: 36 districts, ATREE potential villages (statewide).
2. Nagpur → Nagpur (Rural) → **Rama**: recognized survey numbers 61 and 203, ATREE outline, 115.6 ha.
3. Status filter → Forest candidate → Show on map.
4. Village water summary: wells, structures, forest compartments touched.
5. Click a parcel → 7/12 owner, khata, Map Report.
6. Show the **data-quality panel**: "10 listed survey numbers not found in this village's parcels" — and the unmatched-village review report.

---

## 15. Contact and next step

We request a 30-minute meeting to demonstrate the working system on a district of the Department's choosing, and to agree the pilot districts and the data-sharing route in Section 10.

**Team VANMITRA — Nakasha WebGIS**

---

### Appendix A — Glossary
- **CFR:** Community Forest Resource rights, Forest Rights Act 2006, Sec. 3(1)(i).
- **7/12 (Satbara):** Maharashtra land record of ownership and cultivation.
- **Survey / Gat number:** Parcel identifier in revenue records.
- **MahaBhuNakasha:** State cadastral map portal of Mahabhumi.
- **MRSAC:** Maharashtra Remote Sensing Applications Centre (water and forest layers).
- **ATREE:** Ashoka Trust for Research in Ecology and the Environment — publishes CFR potential / recognized village layers.
- **WMS / GeoJSON / KML:** open geospatial formats.

### Appendix B — Sources and how figures were obtained
- CFR figures: department spreadsheet supplied to the team (Nagpur district, up to Feb 2018), processed by the project's build script; reconciliation reports are in `data/cfr/`.
- Village statistics: MahaBhuNakasha lists as shown in the application header.
- Village example (Rama): live run of the application, ATREE recognized area 115.6 ha with 2 titles, survey numbers 61 and 203 highlighted.
- Performance numbers: measured by the team in test runs on a mobile-data connection; they will differ on a government network and should be re-measured in the pilot.
