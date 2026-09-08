# ADVANTE — Digital Cadastre & Citizen Plot Map for Bhumi Abhilekh

**Automated Integration and Intelligent Harmonization of Multi-source Geospatial Data for Urban Land Record Management**

Version 2.1 · Implementation Plan · 8 September 2026
Supersedes: `implementation_plan_nakasha` (v1.0, "Module C — Bhumi-Nakasha") — that document remains valid for the AI pipeline internals; this document replaces its product framing, data model and integration strategy.

**Changes in 2.1**
- Database is **MongoDB**, not PostGIS. §4.1 states what that buys and what must be built in the worker instead; §6 is a full document model with indexes and validators.
- §10 is rewritten around **reusing your existing layer-list viewer**, trimmed to District / Tehsil / Village boundaries plus the parcel layer. No CFR or forest layers.
- Tiling split in two: static PMTiles for boundaries, live MVT from Mongo for parcels (§10.4).
- Jurisdiction security moves from Postgres row-level security to a single repository layer plus role-scoped Mongo views (§12.1).
- Deployment, dependencies and Appendix A updated for Mongo (§21, Appendix A).

---

## 0. How to read this document

| Section | Answers |
|---|---|
| 1–3 | What problem exists today, what we are building, what we are *not* building |
| 4–7 | Architecture, data sources, database schema, identity keys |
| 8–11 | The AI/GIS pipeline that turns paper maps into verified digital plots |
| 12–14 | Officer workflow, field geofencing, citizen experience |
| 15–17 | Map rendering, frontend, backend API |
| 18–21 | Integration with Bhumi Abhilekh, security, compliance, operations |
| 22–27 | Testing, roadmap, metrics, risks, decisions still needed |

Terminology is Maharashtra-specific (Marathi terms in the glossary, Appendix C). Anything marked **[CONFIRM]** must be validated with the Directorate of Land Records (DSLR / Bhumi Abhilekh Vibhag) before it becomes a commitment.

---

## 1. The gap we are closing

Maharashtra already has three digital systems. None of them joins the record to the map for a citizen.

| System | What it gives today | What it does not give |
|---|---|---|
| **Mahabhulekh** (`bhulekh.mahabhumi.gov.in`) | 7/12 extract, 8A, urban Property Card as text/PDF | No geometry. A citizen sees "Survey No. 255, area 1.20 Ha" but not *where* it is |
| **Mahabhunaksha** (`mahabhunakasha.mahabhumi.gov.in`) | Village cadastral sheet rendered as vector plots, plot report PDF | Schematic — the sheet is not overlaid on real imagery, no basemap context, no ownership join, no ward-level urban depth in many CTSOs, no boundary confidence, no dispute/version state |
| **Field reality** | Original **Tippan** (measurement sheet), **Akarband** (area register), village map sheets, City Survey (CTS) sheets | Still paper or scanned raster in most Talathi / TILR / City Survey offices. Not georeferenced. Not machine-readable. Subdivisions (pot-hissa) drawn by hand |

Consequences a landowner feels:

1. They can read their record but cannot see their boundary against a satellite image, road, or neighbour.
2. Boundary disputes need a paid measurement (mojani) request to TILR/DILR with months of wait.
3. Sale, mutation and encroachment checks are done on text alone; the map never updates in step with the record.

**ADVANTE's job:** take the *official* record and the *official* cadastral sheet, harmonise them into one georeferenced, versioned, officer-signed plot geometry ("Golden Record"), and expose it in two places — an **officer console** where the mapping is assigned and verified, and a **public plot map** that can be embedded into the existing Bhumi Abhilekh pages.

> The system never invents a boundary. It proposes a geometry, an officer with statutory authority accepts or corrects it, and only the accepted geometry is published. Everything shown to the public is traceable to a signed decision by a named officer.

---

## 2. Product definition

### 2.1 Three surfaces, one database

```
                        ┌───────────────────────────────────┐
                        │     MongoDB Golden Record         │
                        │  (versioned, signed, auditable)   │
                        └───────────────────────────────────┘
                           ▲            ▲              │
             ingest+verify │            │ verify       │ read-only, masked
                           │            │              ▼
   ┌───────────────────────┴──┐  ┌──────┴────────┐  ┌──────────────────────┐
   │  A. OFFICER CONSOLE      │  │ B. FIELD APP  │  │ C. CITIZEN PLOT MAP  │
   │  (ADVANTE web, desktop)  │  │ (Flutter,     │  │ (public web +        │
   │  Talathi / TILR / DILR / │  │  offline,     │  │  embeddable widget   │
   │  City Survey Officer     │  │  GNSS walk)   │  │  inside Mahabhulekh) │
   └──────────────────────────┘  └───────────────┘  └──────────────────────┘
```

**A. Officer console** — the 10-page ADVANTE application already specified: upload cadastral sheet / drone ORI / GNSS points / record extract, run the harmonisation pipeline, review AI output on a split screen, resolve conflicts, sign and publish the Golden Record.

**B. Field app** — the surveyor walks the boundary with a GNSS/DGPS handset or phone, captures corner points and boundary marks (hadd khuna), and syncs offline. Reuses the VanMitra Flutter shell.

**C. Citizen plot map** — search by village + survey/gat number (or CTS number for urban), see the plot on satellite imagery with neighbours, area, ULPIN, last verified date and officer, download a signed Plot Report PDF, and raise an objection if the boundary is wrong.

### 2.2 The one-line pitch

> Mahabhulekh tells you *what* you own. Mahabhunaksha shows a *drawing*. ADVANTE shows you *where it is on the ground*, who verified it, and how confident that verification is.

---

## 3. Scope

### 3.1 In scope

- Rural cadastre: Survey Number / Gat Number / Pot-Hissa, joined to 7/12 and Akarband.
- Urban cadastre: City Survey (CTS) numbers and Property Cards under the City Survey Office (Nagar Bhumapan), plus municipal ward layers.
- Gaothan / abadi parcels surveyed under **SVAMITVA** (drone-based), where sanads exist.
- Georeferencing of scanned village maps, CTS sheets and Tippans.
- Officer verification workflow with digital signature and public objection window.
- Public map, plot report, objection intake.
- Marathi-first UI with English and Hindi.

### 3.2 Out of scope (v1)

- Any change to the legal Record of Rights. ADVANTE writes geometry and metadata; the textual RoR stays authoritative in Mahabhulekh/e-Ferfar.
- Automated mutation (e-Ferfar) processing.
- Registration/valuation (IGR, Ready Reckoner) — link out only.
- Litigation case management.
- Boundary decisions without an officer. There is no "auto-publish to the public without a human" path in a legal cadastre. *(This is the single most important change from v1.0 of the plan — see §11.3.)*

### 3.3 Legal position of the output

Three tiers, shown explicitly in the UI and printed on every PDF:

| Tier | Meaning | Who can create it |
|---|---|---|
| `INDICATIVE` | AI-derived geometry, not verified. Visible only inside the officer console. | Pipeline |
| `VERIFIED` | Checked against the record and accepted by the competent officer. Public. Advisory — not a substitute for a legal mojani. | Talathi + TILR/City Survey Officer |
| `SURVEYED` | Backed by a field measurement with GNSS/DGPS observations and boundary marks. | TILR / DILR surveyor + officer sign-off |

**[CONFIRM]** the exact wording of the disclaimer with the DSLR legal cell, and the statutory basis for publishing advisory geometry (Maharashtra Land Revenue Code 1966 provisions on Record of Rights and on boundaries and boundary marks, and the Record of Rights Rules). Do not quote section numbers in the product until legal confirms them.

---

## 4. Target architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS                                        │
│  ADVANTE Officer Console (React+TS+Tailwind+shadcn)                        │
│  Map viewer — your existing layer-list viewer, trimmed to 3 layers (§10)    │
│  Citizen Plot Map (same codebase, public route, no auth)                    │
│  Embed widget (advante-embed.js → iframe, for Mahabhulekh 7/12 page)        │
│  Field App (Flutter, offline, GNSS)                                         │
└───────────────┬────────────────────────────────────────────────────────────┘
                │ HTTPS / JSON, JWT (officers) · signed short-lived token (embed)
┌───────────────▼────────────────────────────────────────────────────────────┐
│                     API GATEWAY (Nginx / NIC ALB)                           │
│   rate limit · WAF · audit tap · TLS termination                            │
└───────────────┬───────────────────────────────────────────────────────────┘
        ┌───────┴─────────┬──────────────────┬──────────────────┐
        ▼                 ▼                  ▼                  ▼
┌───────────────┐ ┌────────────────┐ ┌────────────────┐ ┌────────────────┐
│ core-api      │ │ geo-worker     │ │ tile-service   │ │ integration-svc│
│ FastAPI +     │ │ Celery +       │ │ MVT from       │ │ adapters for   │
│ Motor (async  │ │ Shapely/GEOS,  │ │ Mongo +        │ │ Mahabhulekh,   │
│ Mongo driver) │ │ GDAL, pyproj   │ │ PMTiles for    │ │ SVAMITVA, LGD, │
│ CRUD, search, │ │ georef, seg,   │ │ admin layers,  │ │ DigiLocker     │
│ workflow, PDF │ │ topology,      │ │ Redis cache    │ │                │
│               │ │ overlap, score │ │                │ │                │
└───────┬───────┘ └────────┬───────┘ └───────┬────────┘ └───────┬────────┘
        │                  │                 │                  │
        └──────────┬───────┴─────────────────┴──────────────────┘
                   ▼
   ┌───────────────────────────────────────────────────────────────┐
   │  MongoDB 7 (replica set — transactions required)              │
   │  districts · subdistricts · villages · parcels · parcel_history│
   │  datasets · conflicts · tasks · officers · objections · audit  │
   │  2dsphere indexes on every geometry field                      │
   │                                                                │
   │  MinIO/S3: scans, ORI, COGs, PMTiles, signed PDFs              │
   │  Redis: Celery queue + tile cache                              │
   │  Atlas Search / OpenSearch: village & survey-number typeahead   │
   └───────────────────────────────────────────────────────────────┘
```

Deployment target is a state government environment (SDC / MeghRaj / NIC cloud) or an empanelled Indian cloud region. All geospatial processing stays inside India — required both by the National Geospatial Policy framework and by any data-sharing MoU. **[CONFIRM]**

### 4.1 MongoDB as the store — what you get and what you must build

MongoDB stores GeoJSON natively and indexes it with `2dsphere`, so everything the map *reads* works well: fetch by bounding box, find the parcel under a click, list parcels in a village, sort by distance. That covers the citizen map and most of the console.

What Mongo cannot do server-side is the *cadastral* part — the maths that decides whether two boundaries overlap and by how much. Mongo has `$geoIntersects` (a yes/no test) but no intersection geometry, no area calculation, no polygonisation, no validity repair. So the architecture splits the responsibility:

> **Mongo is the store. GEOS lives in the worker. Everything spatial is computed once at write time and persisted as a field or a document.**

| Need | PostGIS would do | In this architecture |
|---|---|---|
| Parcel area | `ST_Area(geography)` | `shapely` + `pyproj` in the worker → stored as `area_sqm` on the document |
| Overlap detection | `ST_Overlaps` | `$geoIntersects` narrows candidates → Shapely computes the actual intersection → stored as a `conflicts` document with the sliver geometry |
| Gap detection | `ST_Difference` against village boundary | Worker unions the village's parcels (Shapely `unary_union`) and differences the village polygon → gap documents |
| Build faces from linework | `ST_Polygonize` | `shapely.ops.polygonize` in the worker |
| Repair invalid geometry | `ST_MakeValid` | `shapely.make_valid` **before insert** — Mongo will reject a self-intersecting polygon when indexing it, and that error at insert time is a feature: never store an invalid boundary |
| Snap / topology edits | topology extension | Worker-side snapping service (`shapely.snap` + shared-edge index kept in a `edges` collection for the village being edited) |
| Vector tiles | `ST_AsMVT` | Tile service: `$geoIntersects` on the tile envelope → `mapbox_vector_tile` encode → Redis cache (§10.4) |
| Row-level security | RLS policies | Single repository layer that injects the jurisdiction filter, plus role-scoped read-only Mongo views (§12.1) |
| Multi-document consistency | transactions by default | Mongo multi-document transactions — **requires a replica set, so run one even in dev** |

Three practical rules that follow from this:

1. **Precompute anything you want to query.** `area_sqm`, `bbox`, `centroid`, `vertex_count`, `neighbour_ids`, `area_delta_pct`, `confidence.total` are all stored fields, not computed on read. This is normal Mongo modelling, and it happens to be the right pattern for a cadastre anyway, because those values need to be pinned to a specific signed version.
2. **Validation happens at the boundary of the database.** A parcel document cannot be written except through `geo_worker.persist_parcel()`, which validates geometry, computes derived fields, checks the village fabric, and writes the audit event in the same transaction.
3. **Run a nightly fabric check per village.** Because no database engine is enforcing topology for you, a scheduled job re-unions each active village and re-asserts: no overlaps > 5 m², no gaps > 25 m², every geometry valid, every `area_sqm` matches a fresh computation. Discrepancies open conflicts. This job is not optional — it is the safety net that PostGIS constraints would otherwise give you for free.

**Document size.** Mongo caps a document at 16 MB. A dense village boundary or a large forest parcel can carry tens of thousands of vertices. Store the working geometry with a vertex budget (simplify to 0.1 m tolerance, which is far below survey accuracy), keep pre-simplified copies for small zooms (`geom_z10`, `geom_z13`), and push anything still oversized to object storage with a reference. Add a validator that rejects documents above 8 MB so this never surprises you in production.

**When to revisit this decision.** If the system later needs live cross-village spatial analytics (statewide overlap sweeps, routing, raster-vector zonal stats), add PostGIS as a read-side analytical mirror rather than migrating. Mongo stays the operational store; a nightly ETL feeds PostGIS for analysis. That keeps today's decision cheap to live with.

---

## 5. Data sources and how we legally get them

| # | Source | Format | Owner | Acquisition route |
|---|---|---|---|---|
| 1 | Village cadastral map sheets, CTS sheets | Scanned TIFF/PDF, sometimes cloth-mounted originals | DSLR / TILR / City Survey Office | MoU + bulk scan handover; scan-on-site with A0 scanner during pilot |
| 2 | **Tippan** (measurement sheet) | Scanned raster, hand-drawn with offsets & bearings | Taluka Inspector of Land Records | MoU; per-survey-number request |
| 3 | **Akarband / Akarfod** (area & assessment register) | Scanned register or digitised table | TILR | MoU; OCR + manual verification |
| 4 | Existing Mahabhunaksha vector plots | Shapefile / GeoJSON / WMS | DSLR / NIC | **Official API or data dump under MoU. Do not scrape the public portal** — scraping is both a licence and a stability risk, and it disqualifies the project from departmental adoption |
| 5 | 7/12, 8A, Property Card | Structured record via Mahabhulekh backend | DSLR / NIC | Read API with ULPIN or survey-number key; fallback: officer uploads the PDF into the console |
| 6 | SVAMITVA drone ORI + gaothan parcels | GeoTIFF ORI, shapefile | Survey of India / Panchayat Raj Dept | Scheme data-sharing request |
| 7 | Satellite basemap | WMTS tiles | ISRO Bhuvan (preferred for govt), Esri World Imagery (demo) | Bhuvan API key; check attribution and terms |
| 8 | Administrative boundaries + codes | Village/LGD codes | LGD (Local Government Directory), Census 2011 codes | Public download |
| 9 | GNSS control | CORS network observations, DGPS points | Survey of India CORS, state CORS | Access request for the pilot |
| 10 | Village master for the pilot | `mh_cfr_potential_villages.xlsx` — 17,256 MH villages with 2011 village codes, district, subdistrict, gram panchayat, area | Already in hand | Load as the initial `village` gazetteer (Appendix A) |

**Demo/hackathon mode:** where 1–6 are not yet available, the system runs on (a) the supplied village master, (b) manually downloaded public sample sheets for one pilot village, and (c) synthetic plots generated inside the pilot village boundary. Every synthetic feature carries `is_demo = true` and is rendered with a hatched pattern so a demo is never mistaken for real cadastre.

---

## 6. Canonical data model (MongoDB)

All geometry is stored as **GeoJSON in WGS84 (EPSG:4326)** — the only CRS Mongo's `2dsphere` index understands. Every measurement (area, distance, RMSE) is computed in the district's UTM zone (`EPSG:32643` west, `EPSG:32644` east) inside the worker and stored as a number.

Naming: collections are plural and snake_case; `_id` is a UUID string for domain entities so IDs can be minted client-side and used in URLs.

### 6.1 Administrative collections

These three are the ones your existing viewer needs, and nothing more (§10).

```jsonc
// districts
{ "_id": "27-PUNE",
  "lgd_code": "521", "state_code": "27",
  "name": { "en": "Pune", "mr": "पुणे" },
  "utm_srid": 32643,
  "bbox": [73.20, 17.90, 75.10, 19.30],
  "centroid": { "type": "Point", "coordinates": [74.10, 18.60] },
  "geom": { "type": "MultiPolygon", "coordinates": [ /* … */ ] },
  "geom_z6": { "type": "MultiPolygon", "coordinates": [ /* simplified 500 m */ ] },
  "updated_at": ISODate("2026-09-01T00:00:00Z") }

// subdistricts   (tehsil / taluka — the layer your viewer shows by default)
{ "_id": "27-PUNE-JUNNAR",
  "lgd_code": "3944", "district_id": "27-PUNE",
  "name": { "en": "Junnar", "mr": "जुन्नर" },
  "bbox": [ … ], "centroid": { … },
  "geom": { … }, "geom_z9": { … },
  "village_count": 184 }

// villages
{ "_id": 538833,                        // Census 2011 code as the natural key
  "lgd_code": "556231",
  "census_code_2011": "538833",
  "district_id": "27-PUNE", "subdistrict_id": "27-PUNE-JUNNAR",
  "gram_panchayat": "Kotgul",
  "name": { "en": "Ozar", "mr": "ओझर" },
  "name_alt": ["Ojhar", "ओझर बुद्रुक"],   // transliteration variants for search
  "category": "rural",                   // rural | urban
  "village_type": "Revenue village",
  "cts_office": null,
  "recorded_area_ha": 530.0,
  "gis_area_ha": 522.607,
  "bbox": [ … ], "centroid": { … },
  "geom": { … }, "geom_z12": { … },
  "map_status": "vectorised",            // not_started|scanned|georeferenced|vectorised|verified
  "coverage": { "parcels_total": 412, "verified": 388, "surveyed": 24, "pct": 94.2 } }
```

Indexes:

```js
db.districts.createIndex({ geom: "2dsphere" });
db.subdistricts.createIndex({ geom: "2dsphere" });
db.subdistricts.createIndex({ district_id: 1 });
db.villages.createIndex({ geom: "2dsphere" });
db.villages.createIndex({ subdistrict_id: 1, "name.en": 1 });
db.villages.createIndex({ census_code_2011: 1 }, { unique: true });
db.villages.createIndex({ "name.en": "text", "name.mr": "text", name_alt: "text" });
```

### 6.2 Parcels — the cadastre

```jsonc
// parcels  (current versions only; superseded versions move to parcel_history)
{ "_id": "b1f0…-uuid",
  "ulpin": "MH27JU2559A31B",
  "village_id": 538833,
  "subdistrict_id": "27-PUNE-JUNNAR", "district_id": "27-PUNE",   // denormalised for tile queries
  "parcel_kind": "pot_hissa",          // survey|gat|pot_hissa|cts|gaothan_plot
  "survey_no": "255", "hissa_no": "1", "display_no": "255/1",
  "cts_no": null,
  "parent_parcel_id": "a9c2…",

  "geom": { "type": "MultiPolygon", "coordinates": [ /* … */ ] },
  "bbox": [73.8412, 19.2031, 73.8437, 19.2049],
  "centroid": { "type": "Point", "coordinates": [73.8425, 19.2040] },
  "vertex_count": 46,

  "area_sqm": 11904.2,
  "recorded_area_sqm": 12000.0,
  "area_delta_pct": -0.8,
  "land_use": "agricultural",

  "tier": "VERIFIED",                  // INDICATIVE|VERIFIED|SURVEYED
  "state": "PUBLISHED",                // workflow state, §12.2
  "confidence": { "total": 0.91, "boundary_quality": 0.94, "record_match": 0.96,
                  "gnss_alignment": 0.82, "area_consistency": 0.95,
                  "topology_health": 1.0, "datum_accuracy": 1.0,
                  "model_version": "advante-pipeline-2.1" },

  "neighbour_ids": ["c4d1…", "e7a3…"],  // maintained by the fabric job
  "neighbour_nos": ["254", "256", "255/2"],

  "sources": [                          // provenance, replaces the parcel_source table
    { "dataset_id": "…", "kind": "cadastral_sheet", "contribution": "boundary", "weight": 0.6 },
    { "dataset_id": "…", "kind": "gnss", "contribution": "control_point", "weight": 0.3 },
    { "dataset_id": "…", "kind": "revenue_record", "contribution": "attribute", "weight": 0.1 }
  ],

  "ror": {                              // record-of-rights snapshot; mirror, never authoritative
    "record_type": "7/12", "holder_name": "…", "account_no": "…",
    "fetched_from": "mahabhulekh_api", "fetched_at": ISODate("…"),
    "source_uri": "s3://…", "checksum": "sha256:…" },

  "version": 3,
  "valid_from": ISODate("2026-08-12T09:14:00Z"),
  "valid_to": null,
  "is_disputed": false,
  "is_demo": false,
  "signature": { "provider": "cdac_esign", "officer_id": "…", "signed_at": ISODate("…"),
                 "geometry_hash": "sha256:…", "value": "…" },
  "created_at": ISODate("…"), "updated_at": ISODate("…") }
```

```js
db.parcels.createIndex({ geom: "2dsphere" });
db.parcels.createIndex({ village_id: 1, survey_no: 1, hissa_no: 1 });
db.parcels.createIndex({ ulpin: 1 }, { unique: true, sparse: true });
db.parcels.createIndex({ village_id: 1, tier: 1, state: 1 });
db.parcels.createIndex({ subdistrict_id: 1, state: 1 });          // review queue by jurisdiction
db.parcels.createIndex({ "confidence.total": 1, state: 1 });
```

`parcel_history` holds superseded versions with the identical shape plus `superseded_by` and a non-null `valid_to`. Publishing a new version is one transaction: copy current → `parcel_history`, replace `parcels` document, insert `audit_events` entry.

**Why current and history are separate collections rather than one collection filtered by `valid_to: null`:** every map tile query and every citizen lookup hits only current parcels. Keeping history out of that collection keeps the working set small and the 2dsphere index tight — at 2.5 crore parcels with a decade of versions, that difference is the whole performance story.

### 6.3 Supporting collections

```jsonc
// datasets — uploaded sheets, ORI, GNSS, record extracts
{ "_id": "uuid", "village_id": 538833, "kind": "cadastral_sheet",
  "title": "Ozar village map sheet 4", "source_office": "TILR Junnar",
  "sheet_no": "4", "source_crs": "unknown", "survey_date": ISODate("1974-03-01"),
  "storage_uri": "s3://advante/raw/…", "checksum_sha256": "…",
  "quality": { "score": 0.78, "band": "medium", "dpi": 400, "blur": 0.31, "skew_deg": 1.4 },
  "georeference": { "method": "polynomial_1", "gcp_count": 6, "rmse_m": 1.82,
                    "residuals": [ … ], "warped_uri": "s3://…/cog.tif",
                    "datum_source": "unknown", "created_at": ISODate("…") },
  "status": "processed", "uploaded_by": "officer-uuid", "uploaded_at": ISODate("…") }

// conflicts — one document per detected problem, with the sliver geometry
{ "_id": "uuid", "kind": "boundary_overlap", "severity": "high",
  "village_id": 538833, "parcel_ids": ["b1f0…", "c4d1…"],
  "geom": { "type": "Polygon", "coordinates": [ … ] },      // the actual overlap
  "metric": { "overlap_sqm": 412.7, "overlap_pct_a": 3.1, "overlap_pct_b": 2.4 },
  "status": "open", "detected_at": ISODate("…"), "detected_by": "fabric_job",
  "resolution": null }

// tasks — the review queue
{ "_id": "uuid", "parcel_id": "b1f0…", "village_id": 538833,
  "subdistrict_id": "27-PUNE-JUNNAR",
  "state": "OFFICER_REVIEW", "assigned_role": "talathi", "assigned_to": "officer-uuid",
  "priority": 2, "due_at": ISODate("…"), "opened_at": ISODate("…"), "closed_at": null,
  "lock": { "by": "officer-uuid", "until": ISODate("…") } }   // prevents two officers editing one parcel

// officers
{ "_id": "uuid", "employee_code": "…", "name": "…", "designation": "Talathi",
  "office": "Ozar Saja", "role": "talathi",
  "jurisdiction": { "village_ids": [538833, 538839], "subdistrict_ids": [] },
  "esign_id": "…", "is_active": true }

// objections
{ "_id": "uuid", "ref": "OBJ-2026-004312", "parcel_id": "b1f0…",
  "raised_by_hash": "sha256:mobile+salt", "reason": "wrong_boundary",
  "description": "…", "sketch_geom": { … }, "evidence_uris": [ … ],
  "status": "submitted", "filed_at": ISODate("…"), "sla_due": ISODate("…") }

// audit_events — append only, hash chained
{ "_id": ObjectId(), "at": ISODate("…"), "actor": { "type": "officer", "id": "…" },
  "action": "parcel.publish", "entity": { "type": "parcel", "id": "b1f0…" },
  "before": { … }, "after": { … }, "ip": "…",
  "prev_hash": "…", "hash": "sha256(prev_hash + payload)" }
```

```js
db.conflicts.createIndex({ geom: "2dsphere" });
db.conflicts.createIndex({ village_id: 1, status: 1, severity: 1 });
db.tasks.createIndex({ subdistrict_id: 1, state: 1, priority: 1 });
db.tasks.createIndex({ assigned_to: 1, state: 1 });
db.audit_events.createIndex({ "entity.id": 1, at: -1 });
db.audit_events.createIndex({ at: -1 });
db.objections.createIndex({ ref: 1 }, { unique: true });
```

### 6.4 Write-path guarantees

Mongo will not enforce these for you, so enforce them in code and in schema validators:

```js
db.createCollection("parcels", { validator: { $jsonSchema: {
  bsonType: "object",
  required: ["village_id","parcel_kind","geom","area_sqm","tier","state","version"],
  properties: {
    tier:  { enum: ["INDICATIVE","VERIFIED","SURVEYED"] },
    state: { enum: ["INGESTED","PROCESSING","HARMONISED","CONFLICT_HOLD","FAST_TRACK_REVIEW",
                    "OFFICER_REVIEW","FIELD_VERIFICATION","APPROVED","OBJECTION_WINDOW",
                    "PUBLISHED","DISPUTED","SUPERSEDED"] },
    area_sqm: { bsonType: "double", minimum: 1 },
    version:  { bsonType: "int", minimum: 1 },
    vertex_count: { bsonType: "int", maximum: 200000 }
  }}}, validationLevel: "strict", validationAction: "error" });
```

Plus, in `geo_worker.persist_parcel()`, inside one transaction:

1. `make_valid` the geometry, reject if it becomes a non-polygon.
2. Recompute `area_sqm`, `bbox`, `centroid`, `vertex_count`, `area_delta_pct`.
3. Run the overlap check against neighbours; on a critical conflict, force `state = CONFLICT_HOLD` and abort the publish.
4. Move the previous version to `parcel_history`.
5. Write the parcel, the conflicts, and the audit event.
6. Enqueue tile invalidation for the affected village.

A parcel that reaches the database by any other path is a bug. Add an integration test that asserts the API has no direct write access to the `parcels` collection.

### 6.5 Versioning rule

Unchanged in spirit from a relational design: published parcels are never edited in place. Every accepted change increments `version`, archives the previous document, and appends to the hash-chained audit log. The public map reads only `parcels`; the history view reads `parcel_history` sorted by `version`.

---

## 7. Identity keys — ULPIN as the join

The join between ADVANTE geometry and Bhumi Abhilekh text must not be a fragile string like `"255/1, Ozar"`. Use **ULPIN (Unique Land Parcel Identification Number / Bhu-Aadhaar)**, the 14-character parcel identifier introduced under the Digital India Land Records Modernisation Programme, which is derived from the parcel's geo-coordinates and administrative codes. **[CONFIRM]** the exact generation algorithm and check-digit rule with DSLR — ULPIN must be *issued or validated by the department*, never minted independently by us.

Resolution order when matching an incoming record to a geometry:

1. `ulpin` exact match.
2. `(lgd_code, parcel_kind, survey_no, hissa_no)` exact match.
3. `(census_code_2011, survey_no, hissa_no)` — for older datasets keyed to Census 2011 codes (this is what the supplied village xlsx carries).
4. Fuzzy: normalised village name + Devanagari/Latin numeral-folded survey number, scored with RapidFuzz ≥ 0.90, **always routed to a human**. Never auto-accepted.

Normalisation rules that matter in practice, implemented in `app/matching/normalise.py`:

- Devanagari digits `०१२३४५६७८९` → ASCII.
- `२५५/१`, `255/1`, `255-1`, `255 hissa 1`, `२५५ पैकी १` → canonical `255/1`.
- Village name transliteration variants (`Ozar` / `Ojhar` / `ओझर`) resolved through an alias table seeded from the LGD + Census master.
- Area units: guntha (1 guntha = 101.17 m²), are (100 m²), hectare (10,000 m²), acre (4046.86 m²). Always store m², display in the unit the officer's office uses.

---

## 8. The harmonisation pipeline

Ten stages. Each stage is a Celery task, idempotent, writes its own artefact and its own audit event, and can be re-run alone. A `pipeline_run` row records the DAG state so the Processing Center page (ADVANTE Page 4) has real data to show.

```
 0. INTAKE ──▶ 1. QUALITY ──▶ 2. GEOREFERENCE ──▶ 3. LINEWORK ──▶ 4. TOPOLOGY
                                                                       │
 9. PUBLISH ◀── 8. SCORE ◀── 7. CONFLICT ◀── 6. RECORD MATCH ◀── 5. LABEL OCR
```

### Stage 0 — Intake
Accepts a file + declared metadata (village, sheet no, source office, declared CRS). Computes SHA-256, stores to object storage, detects format (`gdalinfo`, `pdfinfo`), rasterises PDF pages at 400 dpi (`pdftoppm`), and rejects anything under 200 dpi for a cadastral sheet with a clear message: *"This scan is 150 dpi. Boundary extraction needs 300 dpi or better. Rescan at 400 dpi."*

### Stage 1 — Quality assessment
Not a black-box CNN. A transparent rubric, because an officer has to trust it:

| Check | Method | Weight |
|---|---|---|
| Effective resolution | dpi + Laplacian variance (blur) | 0.25 |
| Contrast / binarisation quality | Otsu separability | 0.15 |
| Skew | Hough dominant-angle deviation | 0.15 |
| Damage / occlusion | connected-component analysis of white gaps, fold detection | 0.20 |
| Presence of sheet frame + scale bar + north arrow | template match | 0.25 |

Output `quality_score ∈ [0,1]` and a band. Below 0.55 the sheet is routed straight to "rescan requested" and never enters the pipeline. Libraries: OpenCV, scikit-image, `pdfplumber`.

### Stage 2 — Georeferencing
The single most important stage; everything downstream inherits its error.

**Control point strategy, in order of preference:**

1. **Sheet corner coordinates** — many village map sheets carry grid coordinates; OCR them and use as GCPs.
2. **GNSS/DGPS observations** on identifiable corners (boundary marks, road junctions, culverts), supplied as CSV `point_id,lat,lon,accuracy_m` or captured with the field app.
3. **SVAMITVA / drone ORI matching** — automatic tie-point extraction between the scanned sheet and the ORI using SIFT/AKAZE + RANSAC, when an ORI covers the sheet.
4. **Adjacent already-georeferenced sheets** — edge-matching against neighbours already in the fabric.
5. **Manual GCPs** placed by the officer in the console over satellite imagery. Always available as fallback; the UI is a two-pane click-to-pair tool.

**Transform selection:**

| GCPs | Transform | Note |
|---|---|---|
| 3 | Affine | rotation/scale/skew only, report as low confidence |
| 4–6 | 1st-order polynomial | default for clean sheets |
| 7–12 | 2nd-order polynomial | for sheets with mild distortion |
| ≥ 8, uneven distortion | Thin-plate spline | for cloth-mounted / stretched originals |

Run `gdal.Warp` with `-tps` or `-order N`, output a **Cloud-Optimised GeoTIFF** in the district's UTM SRID, then reproject to 4326 for tiling.

**Datum handling.** Legacy Indian sheets are on **Everest 1830** with a local origin; naive treatment causes shifts of *hundreds of metres*. Do not assume. Use `pyproj` with an explicit source CRS and, where available, the department's official Everest→WGS84 transformation parameters for that zone. **[CONFIRM]** with DSLR/Survey of India. If the source datum is unknown, mark `datum_accuracy = 0.4` and force human review — never silently apply a global 7-parameter guess.

**Acceptance gate:** report GCP RMSE in metres. Reject and re-do if RMSE > 3 m rural / > 1 m urban. Store residuals per GCP so the officer sees *which* point is bad.

### Stage 3 — Linework extraction (raster → vector)
Cadastral sheets are line drawings, not natural images. The pipeline is classical CV first, learned models second:

1. Binarise (adaptive threshold / Sauvola).
2. Remove text and numerals into a separate layer (connected components filtered by size/aspect) — this text goes to Stage 5.
3. Thin to a 1-px skeleton (Zhang–Suen).
4. Close gaps: morphological closing + endpoint-pairing within a tolerance derived from sheet scale (e.g. 2 m at 1:2000).
5. Vectorise skeleton to LineStrings (`potrace` or `cv2.findContours` + Douglas–Peucker, epsilon = 0.4 m ground).
6. Node the network and build faces with `shapely.ops.polygonize` (GEOS, in the worker).

**Learned model as a second opinion, not a replacement.** SAM (`vit_b`) is good at *regions* but is not trained on cadastral sheets and will happily merge two plots sharing a faint line. Run SAM in parallel and use it only to (a) propose splits the classical path missed and (b) flag disagreements for review. Where a fine-tuned model is worth training, train a **U-Net on binary line segmentation** with a few hundred annotated sheet tiles — that is a 2-week task with real payoff, unlike GNN subdivision. Track this as an R&D item, not a v1 dependency.

### Stage 4 — Topology construction
A cadastre must be a **gapless, non-overlapping planar partition** of the village. Enforce it in the database:

- `shapely.make_valid` on every face before it can be written; drop rings under `min_parcel_area` (default 25 m² urban / 100 m² rural) as artefacts.
- Snap vertices to a 5 cm grid; snap near-coincident vertices between neighbours (`shapely.snap`, tolerance 0.25 m urban / 0.5 m rural).
- Detect and close slivers: any face with `area < 5 m²` **and** `perimeter²/area > 60` is merged into its longest-shared-edge neighbour.
- Union all faces (`unary_union`) and difference against the village boundary; leftover polygons become `gap` conflict documents.
- Maintain a per-village **shared-edge index** in an `edges` collection (edge id, geometry, the two parcel ids that own it). Mongo has no topology engine, so this collection *is* your topology: an officer edit moves the edge, and both parcels are rewritten from it in one transaction. This is what stops the classic "officer moves a boundary and creates a 30 cm gap" bug, and it must exist before geometry editing ships (Phase 4).

### Stage 5 — Label OCR (survey numbers on the sheet)
The plot numbers written inside each face are the bridge to the record.

- Text layer from Stage 3 is cropped per connected component.
- OCR with Tesseract (`mar`, `hin`, `eng` traineddata) plus a digit-specialised pass; for handwritten sheets, TrOCR fine-tuned on Devanagari numerals.
- Assign each label to the face containing its centroid (`shapely.contains`); resolve ambiguity by nearest-centroid.
- Confidence per label; anything under 0.85 renders in the officer console as an editable red chip on the map.

### Stage 6 — Record matching (geometry ↔ 7/12 / Akarband / Property Card)
Given faces with candidate numbers, and the record set for the village:

1. **Direct key match** on the normalised survey/hissa number (§7).
2. **Area reconciliation** — compare the computed projected area against the recorded area. This is a strong signal: a face labelled `255` whose area is 1.19 Ha against a recorded 1.20 Ha is almost certainly right.
3. **Global assignment** — where labels are missing or duplicated, solve a **rectangular assignment problem** (Hungarian algorithm, `scipy.optimize.linear_sum_assignment`) over faces × records, with cost = w₁·(area deviation) + w₂·(label mismatch) + w₃·(adjacency violation from the Akarband's neighbour list where digitised). This recovers numbers for unlabelled faces and is far more robust than per-face guessing.
4. **Owner name matching** where an owner list exists: RapidFuzz `token_set_ratio` ≥ 0.85 over transliteration-normalised Marathi names.

Outputs `matched` / `partial` / `unmatched` per face with a score.

### Stage 7 — Conflict detection
Runs both within the sheet and against already-published neighbours:

| Conflict | Rule | Default severity |
|---|---|---|
| `boundary_overlap` | `$geoIntersects` candidates, then Shapely intersection area > 5 m² | high if > 2% of either parcel, else medium |
| `gap` | hole in the village fabric > 25 m² | medium |
| `area_mismatch` | `abs(area_delta_pct)` > 5% | medium; > 15% high |
| `survey_no_mismatch` | OCR label ≠ matched record key | high |
| `duplicate` | same `(village, survey_no, hissa_no)` on two current parcels | critical |
| `ownership_conflict` | two records claim the same parcel | critical |
| `crs_error` | georeference RMSE above gate, or centroid falls outside the village boundary | critical |

Every conflict stores the **sliver geometry**, so Page 6 can zoom straight to the disputed shape rather than to a whole plot.

### Stage 8 — Confidence scoring
Revised from v1.0 to include the two factors that best predict real error — area consistency and topology health:

```
confidence = 0.25 · boundary_quality      (Stage 1 rubric × linework agreement)
           + 0.25 · record_match          (Stage 6 score)
           + 0.20 · gnss_alignment        (1 − normalised GCP RMSE)
           + 0.15 · area_consistency      (1 − min(1, |area_delta_pct| / 15))
           + 0.10 · topology_health       (1 − conflicted_edge_length / perimeter)
           + 0.05 · datum_accuracy        (1.0 known & applied, 0.4 unknown)
```

Every component is stored, so the UI can show *why* a score is 0.71 instead of just showing 0.71. That transparency is what gets an officer to trust the number.

### Stage 9 — Publish
Only reachable from an officer's signed approval (§12). Writes the parcel version, generates the tile invalidation, regenerates the signed Plot Report PDF, and emits the audit event.

---

## 9. Pot-hissa (subdivision) engine

Splitting an undivided survey number into hissas is a genuine need — most disputes live here — but it is also where an AI system can do real harm. Rules:

**The engine proposes; it never publishes.** A subdivision proposal is always `INDICATIVE` and always requires a TILR measurement before it becomes `SURVEYED`.

**Algorithm — area-constrained partition, not a GNN.**

1. Inputs: parent polygon, list of target areas from the record (e.g. 3 holders with 0.40 / 0.40 / 0.40 Ha), and constraints: road/canal access, existing internal lines detected in Stage 3, and any Tippan offsets that have been digitised.
2. Seed with a **power diagram (weighted Voronoi)**: place one seed per share, then iterate Lloyd relaxation while adjusting weights until each cell's area is within `area_tolerance` (default 2%). This converges reliably and produces convex, surveyable shapes.
3. Post-process: snap cut lines to existing detected linework where within tolerance, keep every share touching an access edge if the parent touches a road, and enforce a minimum frontage.
4. If a Tippan for the parent exists, prefer reconstructing the *drawn* lines over generating new ones — the Tippan is the legal record of the measurement.

Report per share: achieved area, deviation, frontage, access status, and whether the cut line came from the Tippan (high trust) or was generated (low trust).

Keep the GNN idea as a research track. It adds a heavy dependency (`torch-geometric`) and a training-data problem, for a task a geometric solver already handles deterministically and explainably. Explainability matters more than novelty when the output is a boundary a family will argue about.

---

## 10. The map: reusing your existing viewer

You already have the viewer code from the reference application (satellite base, collapsible **Layer List**, **Search Village**, coordinate readout, scale bar, zoom/info controls). Keep it. Rebuilding that shell buys nothing. The work is: strip it down to three boundary layers, point it at your own endpoints, and add the parcel layer underneath.

### 10.1 What to keep, what to cut

| Component in the reference viewer | Decision |
|---|---|
| Layer List panel (accordion groups + checkboxes) | **Keep** — this is the pattern the whole map depends on |
| Base map switcher (satellite / street / blank) | **Keep** |
| Search Village panel | **Keep**, rewire to your `/villages` endpoint (§10.6) |
| Coordinate readout, scale bar, zoom, info, close controls | **Keep** |
| "View your KML" upload | Keep if cheap; officers do use it to bring in a surveyor's file. Otherwise defer to Phase 5 |
| State groups: Chhattisgarh, MP, Jharkhand, Odisha, West Bengal | **Delete** |
| Forest Compartments, Potential CFR Villages, Forest Outside Villages, Buffer into Reserve Forest, Possibly Unclaimed Forest, CFR Recognized Villages, Forest Villages MP | **Delete** — all of it |
| Yavatmal Cadastral Layer | **Delete**, but read it first: it is the closest thing in the existing code to what your parcel layer must do, so reuse its styling and click-handling logic |
| ATREE / funder branding, header, Hindi toggle wired to CFR content | Replace with ADVANTE branding and the mr/hi/en switch from §15 |

The layer tree collapses from six states × ten themes to this:

```
BASE MAPS
  ● Satellite            (default)
  ○ Street
  ○ Blank

BOUNDARIES
  ☐ District
  ☑ Tehsil               (default on, like the reference)
  ☐ Village

LAND PARCELS            (appears at zoom ≥ 14)
  ☑ Verified parcels
  ☐ Under review          [officers only]
  ☐ Conflicts             [officers only]
  ☐ Scanned sheet overlay [officers only]
```

That is the whole layer list. Resist adding more; every extra checkbox costs a citizen a decision they do not have the context to make.

### 10.2 Layer registry

One JSON file drives the tree, the legend, the styling and the permissions, so adding a layer later is config, not code. This is also the contract between the viewer and the backend — whichever mapping library your existing code uses, it reads this.

```jsonc
{
  "groups": [
    { "id": "base", "label": { "en": "Base maps", "mr": "आधार नकाशे" }, "exclusive": true,
      "layers": [
        { "id": "sat",   "type": "raster", "label": { "en": "Satellite", "mr": "उपग्रह" },
          "url": "{BHUVAN_WMTS}", "default": true, "attribution": "ISRO Bhuvan" },
        { "id": "osm",   "type": "raster", "label": { "en": "Street", "mr": "रस्ता" },
          "url": "https://tile.openstreetmap.org/{z}/{x}/{y}.png" },
        { "id": "blank", "type": "blank",  "label": { "en": "Blank", "mr": "रिकामा" } }
      ]},

    { "id": "boundaries", "label": { "en": "Boundaries", "mr": "हद्दी" },
      "layers": [
        { "id": "district", "type": "vector", "label": { "en": "District", "mr": "जिल्हा" },
          "source": "/api/v1/tiles/admin/{z}/{x}/{y}.pbf", "sourceLayer": "districts",
          "minzoom": 4, "maxzoom": 9, "default": false,
          "style": { "line": "#1B4B8F", "width": 2.0, "fillOpacity": 0 },
          "labels": { "field": "name", "minzoom": 6 } },

        { "id": "tehsil", "type": "vector", "label": { "en": "Tehsil", "mr": "तालुका" },
          "source": "/api/v1/tiles/admin/{z}/{x}/{y}.pbf", "sourceLayer": "subdistricts",
          "minzoom": 6, "maxzoom": 12, "default": true,
          "style": { "line": "#2563A8", "width": 1.4, "fillOpacity": 0 },
          "labels": { "field": "name", "minzoom": 8 } },

        { "id": "village", "type": "vector", "label": { "en": "Village", "mr": "गाव" },
          "source": "/api/v1/tiles/admin/{z}/{x}/{y}.pbf", "sourceLayer": "villages",
          "minzoom": 9, "maxzoom": 16, "default": false,
          "style": { "line": "#C1121F", "width": 1.0, "fillOpacity": 0 },
          "labels": { "field": "name", "minzoom": 11, "haloColor": "#FFFFFF", "haloWidth": 1.6 },
          "click": "selectVillage" }
      ]},

    { "id": "cadastre", "label": { "en": "Land parcels", "mr": "भूखंड" },
      "layers": [
        { "id": "parcels", "type": "vector", "label": { "en": "Verified parcels", "mr": "पडताळलेले भूखंड" },
          "source": "/api/v1/tiles/parcels/{z}/{x}/{y}.pbf", "sourceLayer": "parcels",
          "minzoom": 14, "default": true, "styleBy": "tier",
          "legend": [
            { "value": "SURVEYED", "color": "#1B7F4B", "label": { "en": "Field surveyed", "mr": "मोजणी झालेले" } },
            { "value": "VERIFIED", "color": "#2563A8", "label": { "en": "Officer verified", "mr": "अधिकारी पडताळणी" } }
          ],
          "labels": { "field": "display_no", "minzoom": 16 },
          "click": "selectParcel" },

        { "id": "parcels_review", "type": "vector", "role": "officer",
          "label": { "en": "Under review", "mr": "तपासणीत" },
          "source": "/api/v1/tiles/review/{z}/{x}/{y}.pbf", "sourceLayer": "parcels",
          "minzoom": 15, "style": { "fill": "#C77D0A", "pattern": "hatch" } },

        { "id": "conflicts", "type": "vector", "role": "officer",
          "label": { "en": "Conflicts", "mr": "विसंगती" },
          "source": "/api/v1/tiles/conflicts/{z}/{x}/{y}.pbf", "sourceLayer": "conflicts",
          "minzoom": 15, "style": { "fill": "#B3261E", "pattern": "cross" } },

        { "id": "sheet", "type": "raster", "role": "officer",
          "label": { "en": "Scanned sheet", "mr": "स्कॅन नकाशा" },
          "url": "/api/v1/cog/{dataset_id}/{z}/{x}/{y}.png",
          "minzoom": 14, "opacity": 0.6 }
      ]}
  ]
}
```

`role: "officer"` layers are filtered out of the registry the public endpoint returns — the citizen viewer never learns they exist.

### 10.3 Which mapping library

Your existing code determines the adapter, and this is the first thing to check before Phase 1:

| If the viewer uses | Do this |
|---|---|
| **Leaflet** | Add `Leaflet.VectorGrid` (or `maplibre-gl-leaflet`) for the `.pbf` layers; keep everything else. Cheapest path if the code is already Leaflet |
| **OpenLayers** | `ol/layer/VectorTile` + `ol/format/MVT` — native, no plugin |
| **ArcGIS JS API** | The layer list widget is worth keeping, but MVT support is awkward. Either serve `GeoJSONLayer` from `/api/v1/villages/{id}/boundary.geojson` for admin layers and MVT only for parcels, or port the panel UI to MapLibre |
| **MapLibre GL** already | Nothing to add; use the registry directly as style layers |

Recommendation: whatever it is now, **do not rewrite it in Phase 1**. Get your data into it with GeoJSON endpoints, ship the milestone, and move to vector tiles in Phase 3 when parcel counts make it necessary. A viewer that works on day 10 with 400 village polygons is worth more than a perfect tile pipeline on day 60.

### 10.4 Serving tiles from MongoDB

Two different problems, two different answers.

**Admin boundaries (district / tehsil / village) — static, pre-generated.** These change once a year. Do not query them per request. Export once and serve as files:

```bash
# scripts/build_admin_tiles.sh
python -m scripts.export_admin_geojson       # Mongo → districts.geojson, subdistricts.geojson, villages.geojson
tippecanoe -o admin.mbtiles \
  -L districts:districts.geojson \
  -L subdistricts:subdistricts.geojson \
  -L villages:villages.geojson \
  -Z4 -z16 --drop-densest-as-needed --simplification=4 \
  --generate-ids --force
pmtiles convert admin.mbtiles admin.pmtiles     # single file, range requests, CDN friendly
```

Serve `admin.pmtiles` from object storage behind a CDN, or from the API with HTTP range support. All of Maharashtra's 17,000+ village boundaries fit in roughly 40–80 MB depending on source precision, and the client only downloads the tiles it looks at. Rebuild it in CI whenever the boundary source changes.

**Parcels — live, from Mongo.** These change every time an officer signs something, so they are generated per request and cached:

```python
# tile_service/parcels.py
import mercantile
from mapbox_vector_tile import encode
from shapely.geometry import shape, box
from shapely.ops import transform

EXTENT = 4096

async def parcel_tile(z: int, x: int, y: int, db, roles: set[str]) -> bytes:
    if z < 14:                                   # never serve parcels at low zoom
        return b""
    bounds = mercantile.bounds(x, y, z)
    envelope = {
        "type": "Polygon",
        "coordinates": [[[bounds.west, bounds.south], [bounds.east, bounds.south],
                         [bounds.east, bounds.north], [bounds.west, bounds.north],
                         [bounds.west, bounds.south]]],
    }
    query = {
        "geom": {"$geoIntersects": {"$geometry": envelope}},
        "tier": {"$in": ["VERIFIED", "SURVEYED"]},
        "state": "PUBLISHED",
    }
    projection = {"geom": 1, "display_no": 1, "tier": 1, "ulpin": 1,
                  "area_sqm": 1, "is_disputed": 1, "confidence.total": 1}

    features = []
    async for doc in db.parcels.find(query, projection).limit(6000):
        geom = shape(doc["geom"]).intersection(box(*bounds))     # clip to the tile
        if geom.is_empty:
            continue
        features.append({
            "geometry": to_tile_coords(geom, bounds, EXTENT),    # lon/lat → 0..4096
            "properties": {
                "id": str(doc["_id"]), "no": doc.get("display_no"),
                "tier": doc["tier"], "ulpin": doc.get("ulpin"),
                "area": round(doc["area_sqm"]),
                "disputed": doc.get("is_disputed", False),
                "conf": doc.get("confidence", {}).get("total"),
            },
        })
    return encode({"name": "parcels", "features": features}, extents=EXTENT)
```

Wrap it with Redis:

- Key: `tile:parcels:{z}/{x}/{y}:{role_scope}`, TTL 24 h.
- Invalidation on publish: the worker computes the tile coordinates covering the parcel's bbox for z14–z18 (`mercantile.tiles(*bbox, zooms=range(14,19))`) and deletes those keys. A single parcel touches a few dozen tiles — cheap and precise. Do not flush the whole cache on every signature.
- `Cache-Control: public, max-age=3600` on published tiles, `no-store` on the officer-only endpoints.

**The 6000-feature cap matters.** A dense urban CTS tile at z14 can hold tens of thousands of parcels and produce a tile no browser will render. The cap plus the z14 floor is what keeps the map responsive; if a tile hits the cap, return the tile plus a header `X-Advante-Truncated: 1` and have the client show "zoom in to see all plots" rather than silently lying.

### 10.5 Zoom gating

| Zoom | What renders | Source |
|---|---|---|
| 4–6 | District outlines | PMTiles |
| 6–9 | Tehsil outlines (default), district faint | PMTiles |
| 9–13 | Village outlines + labels | PMTiles |
| 14–16 | Parcels appear, village fill drops away | Live MVT |
| 16–22 | Parcel numbers, GNSS points, sheet overlay | Live MVT + COG |

One rule behind the whole table: **never send a parcel below z14 and never send a district outline above z10.** That single decision is the difference between a map that opens in under a second and one that dies on a state-wide view of 2.5 crore parcels.

### 10.6 Rewiring "Search Village"

The reference viewer's search panel maps directly onto three endpoints:

```
GET /api/v1/districts                                   → [{id, name}]
GET /api/v1/subdistricts?district=27-PUNE               → [{id, name, village_count}]
GET /api/v1/villages?subdistrict=27-PUNE-JUNNAR&q=oz    → [{id, name, bbox, map_status, coverage}]
GET /api/v1/villages/{id}/boundary.geojson              → GeoJSON for a highlight outline
```

Backed by the text index from §6.1, so `q` matches Marathi, English and transliteration variants (`Ozar` / `Ojhar` / `ओझर`). Selecting a village flies to its `bbox` with 60 px padding, switches on the parcel layer, and updates the URL to `/map?v=538833` so the view is shareable. Selecting a plot appends `&p=255/1`. Those two URL parameters are what Mahabhulekh will deep-link to (§18), so freeze their names early.

### 10.7 Status colours

Colours must survive greyscale printing and must not depend on red/green discrimination. Fills at 35% opacity, 1.5 px strokes at full opacity, plus a pattern so colour is never the only signal:

| State | Fill | Stroke | Pattern |
|---|---|---|---|
| Field surveyed | `#1B7F4B` | `#0E5231` | solid |
| Officer verified | `#2563A8` | `#173F6E` | solid |
| Under review | `#C77D0A` | `#8A5606` | diagonal hatch |
| Conflict | `#B3261E` | `#7A1912` | cross hatch |
| Incomplete data | `#6E6E6E` | `#3F3F3F` | dotted stroke |
| Demo / synthetic | `#7A5CB5` | `#4C3A73` | wide hatch + "DEMO" watermark |

Boundary layers stay unfilled outlines — district `#1B4B8F` at 2 px, tehsil `#2563A8` at 1.4 px, village `#C1121F` at 1 px — so parcels underneath stay readable, and labels get a white halo as in the reference map.

---

## 11. Confidence, routing, and the human in the loop

### 11.1 Routing table (replaces v1.0 auto-publish)

| Confidence | v1.0 behaviour | **v2.0 behaviour** |
|---|---|---|
| ≥ 0.90 | auto-publish | **`FAST_TRACK_REVIEW`** — queued to the Talathi with a one-click accept; still requires a signature |
| 0.75–0.89 | human review | `OFFICER_REVIEW` — full split-screen review |
| < 0.75 | send to surveyor | `FIELD_VERIFICATION` — TILR measurement required |
| any, with critical conflict | — | `CONFLICT_HOLD` — cannot proceed until resolved |

The change is deliberate. A boundary published without a human is a legal liability, and a single wrong auto-publish would end the project's credibility inside the department. Fast-tracking keeps the throughput benefit (a batch of 300 high-confidence plots can be accepted in an afternoon) without removing accountability.

### 11.2 What the reviewer actually sees

The Review Queue split screen (ADVANTE Page 5) shows, left to right:

1. **Source** — the warped scanned sheet at full resolution, with the current plot outlined, plus the record extract (7/12 / Property Card) text.
2. **Map** — satellite + proposed geometry + neighbours + drone ORI toggle + a swipe slider between sheet and imagery.
3. **AI analysis** — the six confidence components as horizontal bars with plain-language reasons ("Area is 6.2% larger than the 7/12 figure", "Datum for this sheet is unknown — position may be off by up to 200 m"), the matched record, and detected conflicts.

Actions: **Accept**, **Accept with edit** (opens vertex editing with topology-aware snapping), **Send for field measurement**, **Reject with reason**, **Escalate to DILR**.

### 11.3 Edit tooling requirements

- Vertex drag with shared-edge propagation (topology mode) so neighbours stay coincident.
- Snap to: neighbour vertex, neighbour edge, GNSS point, detected linework.
- Undo/redo stack, plus "revert to AI proposal".
- Area readout updates live, with the recorded area shown next to it and the delta highlighted.
- Every edit is captured as a diff in `audit_event.before/after`.

---

## 12. Officer workflow and authority

### 12.1 Roles

| Role | Real designation | Can do |
|---|---|---|
| `talathi` | Talathi (village revenue officer) | Upload records, verify record match, accept fast-track, raise conflicts |
| `circle_officer` | Circle Officer / Mandal Adhikari | Supervise Talathi decisions in the circle |
| `tilr_surveyor` | Taluka Inspector of Land Records — surveyor | Field measurement, GNSS capture, geometry edit |
| `tilr` | Taluka Inspector of Land Records | Approve `SURVEYED` tier, resolve boundary conflicts |
| `city_survey_officer` | Nagar Bhumapan Adhikari (CTSO) | Same as TILR for urban CTS parcels |
| `dilr` | District Inspector of Land Records | District jurisdiction, escalations, subdivision approval |
| `tahsildar` | Tahsildar | Record-of-rights authority; notified, not an ADVANTE approver in v1 |
| `admin` | DSLR IT admin | Config, users, layer registry — no parcel approval rights |

MongoDB has no row-level security, so jurisdiction is enforced in two places instead — and the second one is what makes it trustworthy.

**1. A single repository function. No query bypasses it.**

```python
# app/repo/parcels.py — the ONLY module allowed to query the parcels collection
def jurisdiction_filter(officer) -> dict:
    if officer.role == "admin":
        return {"tier": {"$in": ["VERIFIED", "SURVEYED"]}}      # admins get published data only
    scope = [{"village_id": {"$in": officer.jurisdiction.village_ids}},
             {"subdistrict_id": {"$in": officer.jurisdiction.subdistrict_ids}}]
    return {"$or": [
        {"tier": {"$in": ["VERIFIED", "SURVEYED"]}},            # published is public anyway
        {"$or": scope},                                         # drafts only inside jurisdiction
    ]}

async def find(db, officer, query: dict, **kw):
    return db.parcels.find({"$and": [jurisdiction_filter(officer), query]}, **kw)
```

**2. Role-scoped database users and read-only views**, so a leaked or misused API credential still cannot see another taluka's drafts:

```js
db.createView("parcels_public", "parcels",
  [{ $match: { tier: { $in: ["VERIFIED","SURVEYED"] }, state: "PUBLISHED" } },
   { $project: { "ror.holder_name": 0, "ror.account_no": 0, signature: 0 } }]);

db.createRole({ role: "advante_public", privileges: [
  { resource: { db: "advante", collection: "parcels_public" }, actions: ["find"] }],
  roles: [] });
```

The citizen API connects as `advante_public` and physically cannot read the `parcels` collection. Add a CI test that greps the codebase for `db.parcels` outside `app/repo/` and fails the build — this is the check that keeps the rule true a year from now.

### 12.2 State machine

```
                     ┌──────────────┐
  dataset uploaded──▶│  INGESTED    │
                     └──────┬───────┘
                            ▼
                     ┌──────────────┐   quality < 0.55    ┌───────────────┐
                     │  PROCESSING  │────────────────────▶│ RESCAN_NEEDED │
                     └──────┬───────┘                     └───────────────┘
                            ▼
                     ┌──────────────┐  critical conflict  ┌───────────────┐
                     │  HARMONISED  │────────────────────▶│ CONFLICT_HOLD │
                     └──────┬───────┘                     └──────┬────────┘
             conf ≥ .90 ┌───┴────┐ conf .75–.89                  │ resolved
                        ▼        ▼                               ▼
             ┌──────────────┐  ┌──────────────┐          (back to HARMONISED)
             │ FAST_TRACK   │  │ OFFICER_     │
             │ _REVIEW      │  │ REVIEW       │◀── conf < .75 ──┐
             └──────┬───────┘  └──────┬───────┘                 │
                    │ accept          │ accept          ┌───────┴────────┐
                    │                 │ send to field──▶│ FIELD_         │
                    │                 │                 │ VERIFICATION   │
                    │                 │                 └───────┬────────┘
                    ▼                 ▼                         │ measured
             ┌───────────────────────────────────────────────────┘
             ▼
      ┌──────────────┐   15-day public notice   ┌──────────────┐
      │  APPROVED    │─────────────────────────▶│  OBJECTION_  │
      │  (e-signed)  │                          │  WINDOW      │
      └──────────────┘                          └──────┬───────┘
                                        no objection   │   objection filed
                                    ┌──────────────────┘        │
                                    ▼                           ▼
                            ┌──────────────┐            ┌──────────────┐
                            │  PUBLISHED   │◀── upheld ─│  DISPUTED    │
                            └──────┬───────┘            └──────────────┘
                                   │ mutation / correction
                                   ▼
                            ┌──────────────┐
                            │ SUPERSEDED   │ (version + 1 created)
                            └──────────────┘
```

The **objection window** is not decoration. Publishing a boundary that affects a neighbour without giving that neighbour notice is exactly how a digitisation programme generates litigation. Notice is delivered by: SMS to the mobile linked in the record, a notice on the village map page, and a printable list for the Gram Panchayat notice board. **[CONFIRM]** the statutory notice period with DSLR — 15 days is a placeholder.

### 12.3 Digital signature

Approval requires an **eSign/DSC** signature over a canonical JSON of the parcel version (geometry hash, area, ULPIN, officer identity, timestamp). Store the signature and the certificate chain in `audit_event`. The Plot Report PDF embeds a PAdES signature so a citizen or a court can verify it offline. Integrate with the department's existing eSign ASP/ESP arrangement rather than issuing our own certificates.

---

## 13. Geofencing and field verification

"Geofencing" in this project means three concrete capabilities:

**1. Boundary walk capture.** The surveyor opens the plot in the field app, walks the boundary, and captures corner points. Supports:
- Phone GNSS (3–8 m) — acceptable only for `INDICATIVE` sketching.
- External NTRIP/RTK receiver over Bluetooth (2–5 cm) — required for `SURVEYED` tier. Store HDOP, satellite count, fix type and correction age per point; reject points with fix type ≠ RTK-fixed when the tier demands it.
- Offline: everything queues in SQLite/Hive and syncs later; the pilot villages have poor connectivity.

**2. Boundary-mark register.** Each corner records the physical mark (hadd khuna) type, a photo with EXIF location, and its condition. This is what turns a digital polygon into something re-findable on the ground five years later.

**3. Proximity alerts.** Optional, opt-in, per parcel:
- Owner opens the app on site → "You are inside your plot 255/1" or "You are 12 m outside your boundary, to the north."
- Officer-side: a change-detection job (reuse VanMitra's Module B) flags new construction or clearing inside a published parcel and raises an advisory conflict.
- No continuous background tracking of citizens. Location is used only while the app is open, and never stored server-side for a citizen user.

**Accuracy honesty.** The app always shows the current position accuracy circle and refuses to say "you are on the boundary" when the accuracy circle is wider than the distance to it. A cadastre app that pretends to 10 cm accuracy on a 5 m phone fix will cause fights between neighbours.

---

## 14. Citizen experience

### 14.1 Entry points

1. **Direct**: `bhunaksha-advante.gov.in` (or a path under the existing portal) → village picker → plot.
2. **From Mahabhulekh**: a "View this plot on map" button on the 7/12 page, deep-linking with ULPIN (§18).
3. **QR on the printed 7/12 / Plot Report**, resolving to the same deep link.
4. **SMS/WhatsApp**: send a survey number to a short code, receive a link. (Phase 3.)

### 14.2 What a citizen sees without logging in

Public, because the cadastral map and the 7/12 are already public records in Maharashtra: plot geometry, survey/CTS number, ULPIN, area (recorded and computed), land use class, tier badge, last verified date, verifying office, and the neighbour plot numbers.

Gated behind DigiLocker / Aadhaar-OTP authentication, and rate-limited: holder names, khata numbers, encumbrance details, and bulk download.

**Never public in any mode:** Aadhaar numbers, mobile numbers, any personal identifier beyond what the department already publishes, and bulk parcel-plus-owner exports. Bulk access for a village or above is an officer-only, logged, watermarked export. This matters under the DPDP Act 2023 and it is also the difference between a public service and a data-harvesting surface for land brokers.

### 14.3 The plot page

```
┌────────────────────────────────────────────────────────────────┐
│  ओझर · Survey No. 255/1               [Verified by TILR Junnar]│
│  ULPIN MH27JU2559A31B                    Last checked 12 Aug 26│
├──────────────────────────┬─────────────────────────────────────┤
│                          │  Area on record   1.20 ha           │
│      [ satellite map     │  Area on map      1.19 ha  (−0.8%)  │
│        with the plot     │  Land use         Agricultural      │
│        outlined and      │  Neighbours       254, 256, 255/2   │
│        neighbours        │  Confidence       0.91  ▸ breakdown │
│        labelled ]        │                                     │
│                          │  [ Download plot report (signed) ]  │
│                          │  [ View 7/12 on Mahabhulekh ↗ ]     │
│                          │  [ Report a problem with this map ] │
└──────────────────────────┴─────────────────────────────────────┘
```

Copy is written for a farmer, in Marathi first. "Confidence 0.91" is shown as **"नकाशा नोंदीशी जुळतो"** ("the map agrees with the record") with the number secondary and the breakdown one tap away. Nobody outside the department should have to interpret a decimal to know whether to trust their own boundary.

### 14.4 Plot report PDF

Mirrors the familiar BhuNaksha plot report so it is instantly recognisable, plus what that report lacks: north arrow, scale bar, the plot with dimensioned edges, neighbour numbers, area table (recorded vs computed), ULPIN, tier and disclaimer, verifying officer and date, a QR code back to the live page, and a PAdES digital signature. Generated with WeasyPrint or ReportLab from a server-rendered map image (MapLibre headless via Playwright, or `mapnik`), in Marathi/English.

### 14.5 Raising an objection

Four taps: pick a reason, optionally drag the boundary to where the citizen believes it should be, attach a photo or document, submit with mobile OTP. Produces an `objection` row and a `workflow_task` for the jurisdictional officer, with an SLA clock. The citizen gets a reference number and SMS updates. Objections are visible to the officer with the citizen sketch overlaid on the official geometry.

---

## 15. Frontend implementation

### 15.1 Stack

React 18 + TypeScript + Vite · Tailwind + shadcn/ui · TanStack Query for server state · Zustand for map/UI state · `react-hook-form` + Zod · `i18next` with `mr` / `hi` / `en`.

**Mapping library:** whatever your existing viewer already uses (§10.3). Wrap it behind the `MapController` interface below so the rest of the app never imports the mapping library directly — that is what lets you move to MapLibre later, if parcel volume demands it, without touching a single page component.

### 15.2 Folder structure

```
src/
├── app/
│   ├── router.tsx                 # route tree, lazy pages, role guards
│   ├── providers.tsx              # query client, i18n, theme, auth
│   └── layout/{TopBar,Sidebar,Shell}.tsx
├── features/
│   ├── dashboard/                 # Page 1
│   ├── map-explorer/              # Page 2  ← the core
│   │   ├── MapCanvas.tsx          # MapLibre instance, single source of truth
│   │   ├── LayerList.tsx          # driven by layer-registry.json
│   │   ├── ParcelPanel.tsx
│   │   ├── SearchBox.tsx
│   │   ├── MeasureTools.tsx
│   │   ├── SwipeCompare.tsx       # sheet ⇄ imagery slider
│   │   └── hooks/{useMapStyle,useParcelSelect,useDeepLink}.ts
│   ├── datasets/                  # Page 3 + upload wizard
│   ├── processing/                # Page 4, SSE-driven pipeline view
│   ├── review/                    # Page 5, split screen + geometry editor
│   ├── conflicts/                 # Page 6
│   ├── golden-records/            # Page 7
│   ├── assistant/                 # Page 8
│   ├── reports/                   # Page 9
│   ├── settings/                  # Page 10
│   └── citizen/                   # public routes: /, /map, /plot/:ulpin, /objection
├── components/                    # shadcn wrappers, ConfidenceMeter, TierBadge,
│                                  # StatusPill, AreaDelta, EmptyState
├── lib/{api,geo,format,auth}.ts
├── config/layer-registry.json
└── locales/{mr,hi,en}.json
```

### 15.3 Map component contract

One MapLibre instance for the whole app, mounted at the shell level and portalled into whichever page needs it — remounting a GL map per route is the standard cause of 2-second page transitions.

```ts
type MapController = {
  flyToVillage(villageId: number, opts?: { padding?: number }): void;
  flyToParcel(parcelId: string): void;
  setLayerVisible(layerId: string, visible: boolean): void;
  setBasemap(id: 'bhuvan_sat' | 'osm' | 'blank'): void;
  setOverlayOpacity(layerId: string, value: number): void;
  highlight(parcelIds: string[]): void;      // used by the AI assistant
  enterEditMode(parcelId: string): EditSession;
  measure(mode: 'distance' | 'area'): void;
  exportViewport(format: 'png' | 'geojson' | 'kml'): Promise<Blob>;
};
```

`enterEditMode` returns a session that talks to the server for topology-aware snapping — the client never decides on its own that two vertices are the same point.

### 15.4 Design direction

The brief asks for a government/enterprise GIS feel. Concretely, and against the defaults:

- **Palette anchored to the map, not to the chrome.** Interface surfaces stay near-neutral (`#F7F8F7` panels, `#101413` text, `#DDE2DE` hairlines) so that the only saturated colour on screen belongs to parcel status. A dashboard with six coloured KPI cards *and* a coloured map is unreadable; KPI cards get numerals and one hairline rule each.
- **Type:** one family. Use a variable grotesque with real Devanagari coverage — **Mukta** or **Noto Sans Devanagari** paired with its Latin — set at 15/22 for body, tabular numerals for every area, coordinate and confidence figure. Marathi and English must not swap typeface mid-panel; that is the tell of a bolted-on translation.
- **Density is the feature.** Officers work on a 1366×768 laptop all day. Panels are 320 px, rows 36 px, no card padding above 16 px, no decorative illustrations. The Review Queue must show 14 rows without scrolling.
- **Motion:** exactly one — the selected parcel's outline draws itself in 300 ms. Nothing else moves unless the user moved it. Respect `prefers-reduced-motion`.
- **Print matters.** Every table and the plot report have a print stylesheet; offices print.
- Never rely on colour alone (§10.3) and keep focus rings visible — this is a government service and it must clear accessibility review.

### 15.5 Page-by-page mapping to the backend

| Page | Primary endpoints | Notes |
|---|---|---|
| 1 Dashboard | `GET /stats/overview`, `/stats/pipeline`, `/activity` | Scope by the officer's jurisdiction, not statewide |
| 2 Map Explorer | tile endpoints, `GET /parcels/{id}`, `/search` | Deep-linkable; public variant strips officer layers |
| 3 Datasets | `POST /datasets`, `GET /datasets`, presigned upload | 4-step wizard as specified |
| 4 Processing Center | `GET /runs/{id}` + **SSE** `/runs/{id}/events` | Real DAG state, not a simulated progress bar |
| 5 Review Queue | `GET /tasks`, `POST /parcels/{id}/decision` | Split screen, keyboard shortcuts A/E/F/R |
| 6 Conflicts | `GET /conflicts`, `POST /conflicts/{id}/resolve` | Zoom to sliver geometry |
| 7 Golden Records | `GET /parcels`, `/parcels/{id}/versions`, `/audit` | Source-fusion diagram from `parcel_source` |
| 8 AI Assistant | `POST /assistant/query` | §17.3 |
| 9 Reports | `POST /reports`, `GET /reports/{id}` | PDF/CSV/GeoJSON/Shapefile export, jurisdiction-scoped |
| 10 Settings | `/config/*`, `/officers`, `/layers` | Layer registry editable by admin |

---

## 16. Backend API

Base: `/api/v1`. Auth: officer JWT (15 min access, refresh via department SSO); public endpoints unauthenticated but rate-limited; embed endpoints accept a signed short-lived token issued to the host portal.

### 16.1 Endpoint table

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/layers` | public / officer | Layer registry (§10.2), officer-only layers filtered by role |
| GET | `/districts` · `/subdistricts?district=` | public | Boundary pickers for the viewer |
| GET | `/villages?subdistrict=&q=&page=` | public | Village picker with LGD/Census codes |
| GET | `/villages/{id}/boundary.geojson` | public | Village outline for highlight / non-MVT viewers |
| GET | `/tiles/admin/{z}/{x}/{y}.pbf` | public | District / tehsil / village tiles (or serve `admin.pmtiles` from the CDN) |
| GET | `/villages/{id}/summary` | public | Mapping status, counts, coverage % |
| GET | `/search?q=&village=&kind=` | public | Survey no / CTS / ULPIN / name typeahead |
| GET | `/parcels/{ulpin_or_id}` | public (masked) | Plot detail |
| GET | `/parcels/{id}/neighbours` | public | Adjacent parcel numbers |
| GET | `/parcels/{id}/versions` | public | Version history (no personal data) |
| GET | `/parcels/{id}/report.pdf` | public | Signed plot report |
| GET | `/tiles/parcels/{z}/{x}/{y}.pbf` | public | Published parcels MVT |
| GET | `/tiles/review/{z}/{x}/{y}.pbf` | officer | Draft + conflict MVT |
| POST | `/objections` | citizen (OTP) | File an objection |
| GET | `/objections/{ref}` | citizen | Track status |
| POST | `/datasets` | officer | Register dataset, returns presigned PUT |
| POST | `/datasets/{id}/process` | officer | Kick off the pipeline |
| GET | `/runs/{id}` · `/runs/{id}/events` | officer | Status + SSE stream |
| POST | `/georeference/{dataset_id}/gcps` | officer | Manual GCP set, re-warp |
| GET | `/tasks?state=&assigned=` | officer | Review queue |
| POST | `/parcels/{id}/decision` | officer | accept · accept_with_edit · field · reject · escalate |
| PATCH | `/parcels/{id}/geometry` | officer | Topology-aware edit |
| POST | `/parcels/{id}/sign` | officer | eSign + publish |
| GET | `/conflicts?severity=&village=` | officer | Conflict list |
| POST | `/conflicts/{id}/resolve` | officer | Resolution + note |
| POST | `/subdivision/propose` | officer | Pot-hissa proposal (§9) |
| POST | `/assistant/query` | officer/public | NL query (scoped) |
| POST | `/reports` | officer | Async report generation |
| GET | `/integration/resolve?ulpin=` | partner | For Mahabhulekh deep link (§18) |
| POST | `/integration/ror-sync` | partner | Record push from the department |

### 16.2 Key payloads

```jsonc
// GET /parcels/MH27JU2559A31B   (public view — no holder details)
{
  "ulpin": "MH27JU2559A31B",
  "village": { "id": 538833, "name_en": "Ozar", "name_mr": "ओझर",
               "taluka": "Junnar", "district": "Pune" },
  "parcel_kind": "pot_hissa",
  "survey_no": "255", "hissa_no": "1", "display": "255/1",
  "area": { "recorded_sqm": 12000, "computed_sqm": 11904, "delta_pct": -0.8,
            "display_recorded": "1.20 ha", "display_computed": "1.19 ha" },
  "land_use": "agricultural",
  "tier": "VERIFIED",
  "confidence": { "total": 0.91,
    "boundary_quality": 0.94, "record_match": 0.96, "gnss_alignment": 0.82,
    "area_consistency": 0.95, "topology_health": 1.0, "datum_accuracy": 1.0 },
  "verified": { "office": "TILR Junnar", "designation": "Taluka Inspector of Land Records",
                "at": "2026-08-12T09:14:00+05:30" },
  "version": 3,
  "is_disputed": false,
  "neighbours": ["254", "256", "255/2"],
  "geometry": { "type": "MultiPolygon", "coordinates": [ /* ... */ ] },
  "sources": [
    { "kind": "cadastral_sheet", "title": "Ozar village map sheet 4", "office": "TILR Junnar" },
    { "kind": "gnss", "title": "DGPS corners, 8 points, RMSE 0.42 m" },
    { "kind": "revenue_record", "title": "7/12 extract", "fetched_from": "mahabhulekh_api" }
  ],
  "disclaimer_mr": "हा नकाशा माहितीसाठी आहे. कायदेशीर हद्दीसाठी भूमी अभिलेख कार्यालयाकडून मोजणी करून घ्यावी.",
  "report_url": "/api/v1/parcels/MH27JU2559A31B/report.pdf"
}
```

```jsonc
// POST /parcels/{id}/decision
{
  "action": "accept_with_edit",
  "geometry": { "type": "MultiPolygon", "coordinates": [ /* edited */ ] },
  "edit_reason": "Northern edge snapped to the canal centreline per Tippan",
  "tier": "VERIFIED",
  "esign": { "provider": "cdac_esign", "transaction_id": "…", "signature": "…" }
}
// 200 → { "parcel_id": "...", "version": 4, "state": "OBJECTION_WINDOW",
//          "objection_closes_at": "2026-09-23T23:59:59+05:30" }
```

### 16.3 Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `SCAN_TOO_LOW_RES` | 422 | Below 200 dpi |
| `GEOREF_INSUFFICIENT_GCPS` | 422 | Fewer than 3 usable control points |
| `GEOREF_RMSE_EXCEEDED` | 422 | Residual above the tier gate |
| `DATUM_UNKNOWN` | 200 + warning | Proceeds but caps `datum_accuracy` |
| `TOPOLOGY_INVALID` | 409 | Edit would create an overlap or gap |
| `OUT_OF_JURISDICTION` | 403 | Officer acting outside their villages |
| `PARCEL_LOCKED` | 409 | Another officer holds the review lock |
| `RECORD_NOT_FOUND` | 404 | No RoR for the key |
| `OBJECTION_WINDOW_OPEN` | 409 | Cannot supersede while notice is running |
| `ESIGN_FAILED` | 502 | Signature service error — nothing published |

---

## 17. AI assistant and reports

### 17.1 Assistant, scoped and safe

Natural-language query over the officer's own jurisdiction, in Marathi / Hindi / English. Architecture: intent + slot extraction → **a whitelisted Mongo aggregation pipeline built from the extracted slots, with the officer's jurisdiction filter prepended** → results → natural-language summary + map highlight action.

The model never emits a query. It emits slots; your code builds the pipeline from a fixed grammar, and only `$match`, `$group`, `$sort`, `$limit` and `$project` stages are permitted (never `$where`, `$function`, `$lookup` or `$merge`):

```
intent      := list_parcels | count | compare_area | find_conflicts | explain_score | locate
filters     := village | taluka | survey_no | tier | confidence_range | conflict_kind
                | area_range | land_use | date_range | disputed
```

Example: *"किती parcels human review मध्ये आहेत?"* → `intent=count, filters={state: OFFICER_REVIEW, jurisdiction: implicit}` → "तुमच्या तालुक्यात ३४७ भूखंड अधिकारी तपासणीसाठी बाकी आहेत" + a "show on map" chip.

Model choice: use the LLM you already have wired (Gemini via Firebase, or an Indic-tuned open model hosted in-country if the department requires on-prem). IndicBERT is not needed for this — it is an encoder, not a generator, and would add 400 MB for worse results than a well-prompted general model with a fixed grammar. For a fully offline requirement, a small quantised model (Qwen2.5-3B-Instruct or similar) can drive the same grammar.

Every assistant answer carries a "how I got this" chip that reveals the structured filter that was applied. No answer is presented as fact if the underlying parcels are `INDICATIVE`.

### 17.2 Reports

| Report | Contents | Formats |
|---|---|---|
| Village mapping status | Coverage %, plots by tier, pending tasks, conflicts | PDF, CSV |
| Parcel verification | Per-parcel confidence, decisions, officer, dates | PDF, CSV |
| Conflict register | Open conflicts by severity, ageing | PDF, CSV |
| Dataset quality | Sheets, dpi, RMSE, rescan list | PDF, CSV |
| Field measurement work order | Plots needing measurement, grouped by route | PDF |
| Objection register | Objections, SLA breaches, outcomes | PDF, CSV |
| Data export | Parcels + attributes | GeoJSON, Shapefile, KML, GeoPackage |

Bulk exports are watermarked with the requesting officer's identity and logged; the watermark is embedded in the attributes as well as the PDF, so a leaked file is traceable.

---

## 18. Integrating with Bhumi Abhilekh

Four tiers, sequenced. Each is independently useful, so the project delivers value even if the later tiers stall in approvals — which they will, for a while.

### Tier 1 — Standalone pilot (no integration needed)
ADVANTE runs on its own domain with data supplied under an MoU for one taluka. Citizens reach it by link and QR. **Delivers in weeks, proves the concept, needs only a data-sharing MoU.**

### Tier 2 — Outbound deep link (ADVANTE → Mahabhulekh)
Every plot page carries a "View 7/12 on Mahabhulekh" link constructed from the village and survey number. No agreement needed beyond acceptable-use. Also: a QR on the plot report.

### Tier 3 — Inbound embed (Mahabhulekh → ADVANTE)
The department adds one button to the 7/12 / Property Card page. Two implementation options:

**3a. Deep link (simplest, recommended first).**
```
https://advante.mahabhumi.gov.in/plot?ulpin=MH27JU2559A31B
   &v=538833&sn=255&hn=1&sig=<hmac>&ts=<epoch>
```
`sig` is an HMAC over the query using a shared secret, valid 5 minutes — this stops third parties from constructing fake "official" links.

**3b. Embedded widget.** A single script the portal team drops in:
```html
<div id="advante-map" data-ulpin="MH27JU2559A31B" data-lang="mr" data-height="480"></div>
<script src="https://advante.mahabhumi.gov.in/embed/v1.js" defer></script>
```
The script injects a sandboxed iframe (`sandbox="allow-scripts allow-popups"`), posts height changes via `postMessage`, and never reads the host page. Requirements to get this approved: CSP-friendly, no third-party network calls, no cookies, sub-200 KB initial payload, WCAG 2.1 AA, and a static fallback image if JS is blocked.

### Tier 4 — Data-plane integration
Two contracts, both department-initiated:

**4a. RoR sync (department → ADVANTE).** Nightly or event-driven push of record changes so geometry attributes stay current:
```jsonc
POST /api/v1/integration/ror-sync
{ "batch_id": "2026-09-08-01", "source": "mahabhulekh",
  "records": [ { "ulpin": "…", "village_lgd": "…", "survey_no": "255", "hissa_no": "1",
                 "record_type": "7/12", "area_ha": 1.20, "tenure": "…",
                 "mutation_no": "1423", "effective_date": "2026-08-30",
                 "checksum": "sha256:…" } ] }
```
On a mutation that changes area or subdivision, ADVANTE opens a `workflow_task` automatically — the map stops drifting from the record, which is the core failure of every previous digitisation attempt.

**4b. Geometry service (ADVANTE → department).** A read API the department's own systems can call for geometry, area and ULPIN, so e-Ferfar, IGR valuation and municipal systems consume one canonical boundary.

### Integration governance checklist
- [ ] MoU with DSLR covering data sharing, IP, hosting location, retention, exit
- [ ] Third-party security audit / **CERT-In empanelled VAPT** before any public exposure **[CONFIRM]** current requirement
- [ ] STQC or department UAT sign-off
- [ ] Hosting on SDC/MeghRaj or empanelled cloud, Indian region
- [ ] Named data-protection contact; DPDP-aligned privacy notice in Marathi and English
- [ ] Accessibility conformance (GIGW guidelines for Indian government websites)
- [ ] Marathi as the default language, per state language policy
- [ ] Exit clause: full data + code handover to the department

---

## 19. Security, privacy and compliance

| Area | Control |
|---|---|
| Officer auth | Department SSO or Aadhaar-based eSign login, MFA, session 15 min, device binding for field app |
| Citizen auth | DigiLocker OAuth or mobile OTP; no password storage |
| Authorisation | RBAC + a single jurisdiction-filtering repository layer, plus role-scoped Mongo users and read-only views (§12.1); every write checked twice |
| Data at rest | Disk encryption; `pgcrypto` for holder identifiers; object storage SSE |
| Data in transit | TLS 1.3 only; HSTS; certificate pinning in the field app |
| Bulk protection | Rate limits per IP and per account; tile requests capped; export requires officer role + justification + watermark |
| Scraping defence | No public bulk endpoint; parcel API returns one parcel per call; anomaly detection on sequential ULPIN access |
| Audit | Hash-chained append-only ledger; nightly hash anchored to a WORM store |
| Personal data | DPDP 2023: purpose limitation, no owner data in the public tile layer, retention policy, subject-access route |
| Geospatial policy | Processing and storage inside India; accuracy-tier handling per the national geospatial framework **[CONFIRM]** |
| Model governance | Every AI output labelled, versioned, and reproducible; model version stored per parcel version; no AI-only publication |
| Secrets | Vault / SDC KMS; no keys in the repo; per-environment rotation |

**Threat worth naming explicitly:** the most valuable attack on this system is not defacement, it is *quiet geometry manipulation* — shifting a boundary by two metres in favour of one party. Defences: hash-chained audit, mandatory eSign per version, geometry diffs recorded, alerting on edits > 1 m displacement or > 2% area change, and a monthly reconciliation job that recomputes published geometry hashes against the ledger.

---

## 20. Non-functional requirements

| Requirement | Target |
|---|---|
| Map first paint | < 1.5 s on 4G, 1366×768 |
| Tile response (cached) | p95 < 120 ms |
| Tile response (cold, z16) | p95 < 600 ms |
| Plot detail API | p95 < 250 ms |
| Pipeline throughput | one village sheet (≈ 400 plots) end-to-end < 12 min on 4 vCPU |
| Concurrent citizens | 5,000 (state-wide launch: 50,000 with CDN in front of tiles) |
| Officer console | usable on 1366×768, works on 4 Mbps |
| Field app | fully offline for 7 days, sync < 60 s per village |
| Availability | 99.5% for citizen map, 99.0% for console |
| Languages | Marathi (default), Hindi, English — including all error messages and the PDF |
| Accessibility | WCAG 2.1 AA, GIGW compliant |
| Scale ceiling | 17,000+ villages, ~2.5 crore parcels; partition `parcel` by district with `pg_partman` |

---

## 21. Environments, deployment and cost

**Environments:** `dev` (Docker Compose) → `staging` (mirrors SDC, synthetic data only) → `pilot` (real data, one taluka) → `prod`.

```yaml
# docker-compose.yml (dev)
services:
  mongo:
    image: mongo:7
    command: ["--replSet", "rs0", "--bind_ip_all"]   # replica set REQUIRED for transactions
    volumes: [mongodata:/data/db]
    ports: ["27017:27017"]
  mongo-init:                                        # one-shot rs.initiate()
    image: mongo:7
    depends_on: [mongo]
    entrypoint: ["bash","-c","sleep 5 && mongosh --host mongo --eval 'rs.initiate()'"]
  redis:  { image: redis:7-alpine }
  minio:  { image: minio/minio, command: server /data --console-address ":9001" }
  api:    { build: ./backend, command: uvicorn app.main:app --host 0.0.0.0 --port 8000,
            depends_on: [mongo, redis, minio], env_file: .env }
  worker: { build: ./backend, command: celery -A app.worker worker -Q pipeline -c 4 }
  tiles:  { build: ./backend, command: uvicorn tile_service.main:app --port 8080 }
  titiler:{ image: ghcr.io/developmentseed/titiler:latest }   # COG raster overlays
  web:    { build: ./frontend, ports: ["5173:5173"] }
volumes: { mongodata: {} }
```

Run the replica set in every environment, including a developer laptop. Single-node Mongo has no transactions, and the publish path in §6.4 depends on them — discovering that in staging is a wasted week.

**System packages for the worker image:** `gdal-bin libgdal-dev libgeos-dev libproj-dev tesseract-ocr tesseract-ocr-mar tesseract-ocr-hin poppler-utils`. Pin GDAL and PROJ versions — a PROJ upgrade that changes transformation pipelines will silently move every boundary.

**Python dependencies:**

```
# core
fastapi uvicorn[standard] motor pymongo pydantic celery redis
# geo
shapely pyproj rasterio gdal rtree mercantile mapbox-vector-tile
# raster / documents
opencv-python-headless scikit-image pytesseract pdf2image pillow weasyprint
# matching & utils
scipy numpy rapidfuzz python-multipart boto3
```

SAM/torch only in an optional `ml` extra so the base image stays under 1.5 GB. Node is needed only for `tippecanoe`/`pmtiles` in the admin-tile build step, which runs in CI, not in the runtime image.

**Answers to the v1.0 open questions, updated:**

- *Q1 — SAM checkpoint size:* ship v1 without SAM. The classical linework path (§8, Stage 3) covers cadastral sheets; if SAM is added later, put it in a separate `advante-ml` image built with the checkpoint baked in.
- *Q2 — where do golden records live:* **MongoDB**, with GEOS in the worker (§4.1, §6). Not Firestore — the audit, versioning and transaction requirements need a store you control. Not PostGIS for now; add it later as a read-side analytical mirror if statewide spatial analytics become a requirement.
- *Q3 — NL assistant model:* existing LLM with a constrained query grammar, not IndicBERT (§17.1). With Mongo the grammar compiles to an aggregation pipeline rather than SQL, which is if anything safer — the allowed stages are a fixed whitelist.
- *Q4 — survey number source:* for the pilot, load the supplied village master as the gazetteer (Appendix A) and use the village's own Akarband / 7-12 extract for matching; the spreadsheet stands in only until the MoU delivers the real register.

**Indicative infrastructure (pilot, one taluka):** 4 vCPU / 16 GB for API + worker, a 3-node Mongo replica set (or Atlas M30) with 200 GB SSD, 2 vCPU tile service, 500 GB object storage, CDN in front of `admin.pmtiles` and published parcel tiles. Roughly ₹40,000–70,000 per month on commercial cloud — the replica set is the main difference from a single-instance database, and it is not optional. On a government deployment this is typically absorbed into an existing SDC allocation. GPU is only for the optional ML extra; rent by the hour for training, never keep one running.

**Mongo operations checklist:**

- [ ] Replica set with at least 3 voting members; majority write concern on the publish path
- [ ] `readConcern: "majority"` for anything an officer signs
- [ ] Daily `mongodump` plus point-in-time restore via oplog; restore tested quarterly, not assumed
- [ ] Index build monitoring — a `2dsphere` build on 2.5 crore parcels must be rolling, never on the primary in one shot
- [ ] Sharding plan when parcels exceed roughly 5 crore: shard key `{ district_id: 1, village_id: 1 }`, which keeps a village's parcels on one shard so tile queries stay single-shard
- [ ] Field-level encryption for `ror.holder_name` and `objections.raised_by_hash`
- [ ] Slow-query log at 100 ms, with a dashboard for tile-query latency by zoom

---

## 22. Testing and accuracy validation

### 22.1 Software tests
- Unit: normalisation (§7), area conversions, confidence maths, state-machine transitions (every illegal transition asserted), ULPIN validation.
- Spatial: golden-file tests on a fixture village — geometry validity, no overlaps, no gaps, area sums to the village area within 0.5%. Run the same assertions the nightly fabric job runs (§4.1), so a regression fails in CI rather than in a village.
- API contract tests generated from the OpenAPI spec; jurisdiction tests that assert an officer cannot read or write outside their villages.
- Frontend: Playwright flows — upload → process → review → sign → appears on the public map; deep-link restore; Marathi rendering; keyboard-only review.
- Load: k6 against tile endpoints at z14–z18 across a whole taluka.

### 22.2 Accuracy validation — the tests that decide whether this is real

Run on a **ground-truth set of at least 150 plots** across three villages (irregular rural, dense urban CTS, gaothan), measured independently with DGPS by the TILR.

| Metric | Definition | Target (VERIFIED) | Target (SURVEYED) |
|---|---|---|---|
| Georeference RMSE | GCP residual | ≤ 3 m rural, ≤ 1 m urban | ≤ 0.5 m |
| Corner positional error | mean distance, proposed vs surveyed corner | ≤ 5 m rural, ≤ 2 m urban | ≤ 0.3 m |
| Boundary IoU | vs ground truth polygon | ≥ 0.90 | ≥ 0.97 |
| Area deviation | vs recorded area | ≤ 5% | ≤ 2% |
| Survey-number assignment accuracy | correct label per face | ≥ 97% | 100% (verified) |
| Topology validity | overlaps/gaps per village | 0 | 0 |
| Conflict precision / recall | vs officer adjudication | ≥ 0.85 / ≥ 0.95 | — |

**Publish these numbers per village on the village page.** A cadastre product that hides its error budget will not survive contact with a land dispute; one that states "corners on this sheet are accurate to about 3 metres" is defensible and useful.

### 22.3 User validation
- 5 Talathis and 2 TILR surveyors doing real review sessions, measured on time-per-parcel and error rate; target under 90 seconds per fast-track parcel.
- 20 villagers on the citizen map, in Marathi, unassisted: can they find their own plot in under 2 minutes and say what the tier badge means?
- One Gram Sabha demonstration with the printed notice list.

---

## 23. Roadmap

### Phase 0 — Foundations (weeks 1–3)
- [ ] Repo, CI, Docker Compose with a Mongo replica set, collections + validators + indexes (§6), migration runner
- [ ] Load village master from the supplied xlsx (Appendix A); build the LGD/Census alias table
- [ ] Village boundary PMTiles for Maharashtra; basemap keys
- [ ] Auth skeleton, officer model, jurisdiction repository layer + role-scoped Mongo users
- [ ] ADVANTE app shell: sidebar, top bar, routing, i18n, design tokens

### Phase 1 — Map that works (weeks 3–6) · *demo-ready milestone*
- [ ] Existing viewer stripped to three boundary layers (§10.1) and wired to your endpoints; `admin.pmtiles` built with tippecanoe; live parcel MVT service with Redis cache
- [ ] Map Explorer: layer list from registry, basemap switch, village drill-down, search, parcel panel
- [ ] Citizen plot page + deep links + plot report PDF (unsigned)
- [ ] Seed one pilot village with synthetic-but-realistic parcels marked `is_demo`
- **Exit:** a stranger can find a plot in the pilot village from the landing page and download its report.

### Phase 2 — Ingestion and georeferencing (weeks 6–10)
- [ ] Dataset upload wizard + presigned storage + quality rubric
- [ ] Manual GCP tool (two-pane) and `gdal.Warp` service with RMSE reporting
- [ ] COG output + titiler overlay in the map with an opacity slider
- [ ] Processing Center with real SSE pipeline state
- **Exit:** an officer can upload a scanned village sheet and see it correctly overlaid on satellite imagery.

### Phase 3 — Vectorisation and matching (weeks 10–15)
- [ ] Linework extraction, topology build, sliver/gap handling
- [ ] Label OCR (Marathi numerals) with editable chips
- [ ] Akarband/7-12 ingestion + Hungarian assignment matcher
- [ ] Conflict detection and the Conflicts page
- [ ] Confidence scoring with the full breakdown UI
- **Exit:** one full village sheet becomes an attributed, topologically clean parcel layer.

### Phase 4 — Verification workflow (weeks 15–19)
- [ ] Review Queue split screen + geometry editor with topology snapping
- [ ] State machine, task assignment, jurisdiction enforcement
- [ ] eSign integration, signed PDF, audit ledger with hash chain
- [ ] Objection intake + notice generation + SLA tracking
- **Exit:** a parcel goes from scan to signed, published, publicly visible geometry with a complete audit trail.

### Phase 5 — Field and mobile (weeks 19–23)
- [ ] Flutter field app: offline plot download, GNSS/RTK capture, boundary walk, boundary-mark register, photo evidence
- [ ] Sync service and conflict resolution on sync
- [ ] `SURVEYED` tier promotion path
- **Exit:** a TILR surveyor completes a measurement entirely in the app and the result publishes.

### Phase 6 — Integration and hardening (weeks 23–28)
- [ ] Embed widget + HMAC deep links; RoR sync endpoint
- [ ] Reports suite, bulk export with watermarking
- [ ] Assistant with constrained grammar
- [ ] VAPT, accessibility audit, load test, DR drill
- [ ] Pilot with real data in one taluka; accuracy validation report (§22.2)

### Hackathon / demo cut (if the deadline is weeks, not months)
Phases 0, 1, and the *manual* half of Phase 2, plus a scripted walkthrough of Phase 4's review screen against pre-computed results. That gives a live map, a real georeferenced sheet overlay, a working review-and-sign flow, and honest labelling of what is simulated. Do not fake the pipeline with a progress bar and a timer — judges and department officers both ask.

---

## 24. Success metrics

| Horizon | Metric | Target |
|---|---|---|
| Pilot | Villages fully mapped | 10 |
| Pilot | Plots published at VERIFIED or better | 4,000 |
| Pilot | Median officer review time per parcel | < 90 s |
| Pilot | Corner positional error, median | ≤ 3 m |
| Pilot | Citizen plot lookups | 5,000 |
| Pilot | Objections filed / upheld | tracked; upheld rate < 5% indicates good geometry |
| Year 1 | Talukas live | 25 |
| Year 1 | Reduction in fresh mojani applications for "where is my boundary" queries | 20% **[measure with DSLR]** |
| Year 1 | Map–record divergence after mutation | < 2% of mutated parcels stale beyond 30 days |

---

## 25. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Data-sharing MoU delayed | High | Blocks everything real | Build Tier 1 pilot scope; keep the demo dataset path; start the MoU conversation in week 1, not month 4 |
| 2 | Legacy datum parameters unavailable | Medium | Hundreds of metres of error | Force manual GCP path; never auto-apply a guessed transform; cap confidence |
| 3 | Sheet quality worse than assumed (torn, faded, cloth-mounted) | High | Low extraction yield | Quality gate + rescan workflow; TPS transform; accept manual digitisation as a supported path — the tool must be good at *assisting* a human digitiser, not only at automating |
| 4 | Officers do not adopt it | Medium | Project dies quietly | Design for 90-second reviews, keyboard shortcuts, offline-tolerant; co-design with 5 Talathis from week 3; never add a step that has no counterpart in their existing job |
| 5 | A wrong published boundary triggers a dispute | Medium | Reputational, legal | Mandatory sign-off, objection window, tiering, published error budget, fast rollback to the previous version |
| 6 | Personal data exposure / broker scraping | Medium | DPDP violation | No owner data in tiles, per-parcel API only, rate limits, watermarked exports, anomaly detection |
| 6b | No database-enforced topology (Mongo) lets a bad geometry slip in | Medium | Silent boundary errors | All writes through `persist_parcel()`, schema validators, nightly per-village fabric job, CI test that no other module touches the collection |
| 7 | Tile performance collapses at state scale | Medium | Unusable map | Zoom gating, partitioning, CDN, pre-generated PMTiles for static layers, load test in Phase 6 |
| 8 | Scope creep into mutation/registration | High | Never ships | Written scope boundary (§3.2); integrate, don't absorb |
| 9 | AI output treated as legal truth by a user or a court | Low | Serious | Tier badges everywhere, disclaimer on every PDF and API response, `INDICATIVE` never public |
| 10 | Key-person dependency on GIS expertise | Medium | Delivery risk | Document the georeferencing SOP; train two officers per taluka as super-users |

---

## 26. Decisions still needed

1. **Pilot geography** — which taluka, and rural or urban CTS first? Urban CTS sheets are cleaner and denser (better demo, harder topology); rural sheets are more numerous and more socially valuable. *Recommendation: one taluka, one urban CTS ward plus three rural villages, so both paths are proven.*
2. **Department sponsor** — who inside DSLR owns this? Nothing beyond Tier 1 happens without a named owner.
3. **ULPIN** — can we obtain the official generation/validation service, or do we mirror ULPINs supplied by the department only?
4. **Datum parameters** — are official Everest→WGS84 transformation parameters available for the pilot districts?
5. **Objection period and legal effect** — what is the statutory notice period, and does an ADVANTE objection have any legal standing or is it purely a correction request?
6. **eSign provider** — which ASP/ESP does the department already use?
7. **Hosting** — SDC/MeghRaj allocation, or commercial cloud for the pilot with migration later?
8. **Relationship to VanMitra** — one product with two skins (FRA/CFR + revenue cadastre) or two products sharing a pipeline library? *Recommendation: extract the pipeline into a shared Python package (`bhunaksha-core`) and keep the two applications separate; their users, authorities and legal frames are different.*

---

## Appendix A — Loading the village master into MongoDB

```python
# scripts/load_villages.py
import pandas as pd
from pymongo import MongoClient, ASCENDING, TEXT, GEOSPHERE

db = MongoClient("mongodb://localhost:27017/?replicaSet=rs0").advante

df = pd.read_excel("mh_cfr_potential_villages__1_.xlsx",
                   sheet_name="MH_CFR_potential_village_list")

docs = []
for r in df.itertuples(index=False):
    docs.append({
        "_id": int(r._4),                                  # Village Code 2011
        "census_code_2011": str(int(r._4)),
        "district_name": r.District,                       # resolved to district_id after
        "subdistrict_name": r.Subdistrict,                 # the boundary layer is loaded
        "gram_panchayat": r._2,
        "name": {"en": r.Village, "mr": None},
        "name_alt": [],
        "category": "rural",
        "village_type": r._11,
        "recorded_area_ha": float(r._5),
        "gis_area_ha": float(r._6),
        "map_status": "not_started",
        "coverage": {"parcels_total": 0, "verified": 0, "surveyed": 0, "pct": 0.0},
    })

db.villages.insert_many(docs, ordered=False)               # 17,256 rows

db.villages.create_index([("geom", GEOSPHERE)])
db.villages.create_index([("subdistrict_id", ASCENDING), ("name.en", ASCENDING)])
db.villages.create_index([("census_code_2011", ASCENDING)], unique=True)
db.villages.create_index([("name.en", TEXT), ("name.mr", TEXT), ("name_alt", TEXT)])
```

Then, in a second pass, load the district / tehsil / village boundary shapefiles, attach `geom` and `bbox`, and join on `census_code_2011`:

```python
# scripts/attach_boundaries.py
import geopandas as gpd, json
gdf = gpd.read_file("mh_villages.shp").to_crs(4326)
gdf["geometry"] = gdf.geometry.simplify(0.000001)          # ~0.1 m, below survey accuracy
for row in gdf.itertuples():
    db.villages.update_one(
        {"census_code_2011": str(row.censuscode)},
        {"$set": {
            "geom": json.loads(gpd.GeoSeries([row.geometry]).to_json())["features"][0]["geometry"],
            "bbox": list(row.geometry.bounds),
            "centroid": {"type": "Point",
                         "coordinates": list(row.geometry.representative_point().coords)[0]},
        }})
```

Report every unmatched row rather than silently dropping it — expect 2–5% mismatch from village splits, mergers and renames since the 2011 census. Those rows are a reconciliation work item for the department, and they are exactly the villages where a citizen will later fail to find their plot.

Boundary sources to try, in order: the department's own layer under the MoU; the state remote sensing centre (MRSAC); the LGD boundary set. Whichever you use, record the source and vintage on each document — a village boundary with no provenance cannot be defended when it disagrees with a sheet.

Finally, build the admin tiles (§10.4) and confirm the three boundary layers render in the viewer before touching parcels. That is the Phase 1 exit criterion.

## Appendix B — Repository layout

```
advante/
├── backend/
│   ├── app/
│   │   ├── main.py                 # FastAPI app, routers
│   │   ├── api/{parcels,datasets,review,conflicts,public,integration,assistant}.py
│   │   ├── models/                 # Pydantic + Mongo document models
│   │   ├── schemas/                # Pydantic
│   │   ├── pipeline/
│   │   │   ├── intake.py  quality.py  georeference.py  linework.py
│   │   │   ├── topology.py  ocr.py  matching.py  conflicts.py
│   │   │   ├── scoring.py  subdivision.py  publish.py
│   │   │   └── dag.py              # stage registry + Celery orchestration
│   │   ├── workflow/{state_machine.py, permissions.py, esign.py}
│   │   ├── repo/                   # the ONLY module that touches collections (§12.1)
│   │   ├── matching/normalise.py
│   │   ├── reports/                # WeasyPrint templates (mr/en)
│   │   └── worker.py
│   ├── migrations/                 # index + validator migrations (mongodb-migrations)
│   └── tests/{unit,spatial,api,fixtures/ozar}
├── frontend/                       # §15.2
├── mobile/                         # Flutter field app
├── tile_service/{main.py, parcels.py, cache.py}
├── viewer/                         # your existing layer-list viewer, trimmed (§10)
├── scripts/{load_villages.py, attach_boundaries.py, build_admin_tiles.sh}
├── infra/{docker-compose.yml, k8s/, terraform/}
└── docs/{SOP_georeferencing.md, SOP_review.md, api.md, accuracy_report.md}
```

## Appendix C — Glossary

| Term | Meaning |
|---|---|
| 7/12 (सातबारा) | Rural record-of-rights extract: holder, area, crops, encumbrances |
| 8A | Holding statement across a village |
| Property Card (मिळकत पत्रिका) | Urban equivalent of the 7/12, issued by the City Survey Office |
| Akarband / Akarfod | Village register of survey numbers with areas and assessment |
| Tippan (टिपण) | Field measurement sheet showing offsets and dimensions for a survey number |
| Gat number | Consolidated survey number grouping used in much of Maharashtra |
| Pot-hissa (पोट हिस्सा) | Subdivision of a survey number |
| Hadd khuna (हद्द खुणा) | Physical boundary marks |
| Mojani (मोजणी) | Official measurement by the land records department |
| CTS number | City Survey number — urban parcel identifier |
| CTSO / Nagar Bhumapan | City Survey Office |
| TILR / DILR | Taluka / District Inspector of Land Records |
| Talathi | Village revenue officer, custodian of the 7/12 |
| e-Ferfar | Online mutation system |
| ULPIN / Bhu-Aadhaar | 14-character unique land parcel identifier |
| SVAMITVA | Central scheme drone-surveying inhabited village areas |
| ORI | Ortho-Rectified Image |
| Guntha | 101.17 m²; 40 guntha = 1 acre |

---

*ADVANTE v2.0 · Prepared 8 September 2026 · Items marked **[CONFIRM]** are assumptions pending departmental validation and must not be presented as commitments.*
