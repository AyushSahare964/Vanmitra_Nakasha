# VANMITRA / NakashaMap: Performance Analysis Report

Date: 2026-10-04 · Scope: village search, zoom 14–20 clarity, cadastral loading, survey-number list, sort and filters

## 1. Summary

The mapping is correct. The slowness comes from five structural causes, not from one bug.

| # | Cause | Symptom it explains | Severity |
|---|-------|--------------------|----------|
| A | One portal request per survey number to fill owner/area/geometry (`getPlotInfo`), 6 at a time | Survey list, sort and filters are slow, partial or wrong while loading | **Critical** |
| B | Every request, including every cadastral tile, goes through a serverless proxy with no keep-alive, no region pin, and a cookie fetch on cold start | Cadastral map slow to load in some villages | **High** |
| C | The basemap is asked for zoom levels with no real imagery, and the cadastral WMS is not resolution-matched | Blurry at 14–20 | **High** |
| D | Village search loads 2 MB of xlsx (parsed on the main thread) and a 7–8 MB district GeoJSON | Slow search → fly-to | **Medium** |
| E | Each 25-record batch triggers a full recompute of the whole parcel index, owner stats, point-in-polygon and sorted list, plus a render of a 5,100-line component | UI stalls while the list "fills in" | **High** |

There is also one **release-blocking bug** in the uncommitted `api/bhunaksha.js` (section 3.0).

## 2. What was measured and what was inferred

I measured these from this machine, at night, against the live portal, Google and ESRI:

| Call | Result |
|------|--------|
| `kidelistFromGisCodeMH` (survey list), 16 villages | 0.10–0.23 s |
| `getPlotInfo`, one parcel | 0.19–0.33 s; response 1–21 KB |
| 24 `getPlotInfo` calls, 6 parallel | 1.8 s total |
| Cadastral WMS tile 512 px (village scale to plot scale) | 0.20–0.95 s; 4–30 KB |
| Google tile | 0.14–0.66 s |
| ESRI tile at z19, z20 and z21 | 2,521 bytes each (the "map data not yet available" placeholder) |
| Google tile at z14 → z21 | 19 KB → 7.6 KB (detail falls off, so it is over-scaled imagery) |

Caveat: the portal was fast tonight. The code comments in this repo record 8–16 s per portal call during the day, and your symptoms match that. So the numbers above are a best case. Anything about browser rendering cost (section 3.5) comes from reading the code, not from a profiler run. Before and after each fix, record a Chrome DevTools Performance trace on a large village.

## 3. Findings

### 3.0 Release blocker: `path` is undefined in `api/bhunaksha.js`

[api/bhunaksha.js:144](api/bhunaksha.js#L144) calls `/WMS/.test(path)`, but the only variable in scope is `p` (the function parameter) and there is no `path` binding anywhere in the file.
- Every successful (200) portal response throws a `ReferenceError` inside the response callback. That would break the proxy for all calls once deployed.
- The committed version (`HEAD`) does not have this line. It was added in the uncommitted edit.
- Fix: change `path` to `p`. One character. Do this before the next deploy.

### 3.1 Survey list, sort and filters (cause A and E)

**How it works today**
1. `kidelistFromGisCodeMH` returns only survey numbers, so the list appears quickly. Sort by survey number and the survey-number search work immediately.
2. Owner name, area, category, geometry and CFR status come only from `getPlotInfo`, called once per parcel ([bhunaksha-owners.ts:231](src/lib/bhunaksha-owners.ts#L231), pool of 6 in [NakashaMap.tsx:1736](src/components/NakashaMap.tsx#L1736)).
3. Every owner/category/CFR/area filter and sort depends on those records.

**Cost.** Umrane (Deola, Nashik) has 339 parcels. At the daytime 10–16 s per call, 339 × 12 s ÷ 6 ≈ **11 minutes** before the data is complete. The largest district village list has 2,112 villages, and big villages have thousands of parcels. The filter chips and counts are wrong during that time because pending parcels have no record (they fall into "other"). That is why filters feel slow and unreliable.

**Why the UI also stalls (cause E).** Each batch of 25 records calls `setBnPlots`, and everything downstream re-runs on the full array:
- `mrsacParcels` ([line 3338](src/components/NakashaMap.tsx#L3338)): point-in-polygon of every parcel against every forest and water polygon, every batch.
- `plotSearchIndex` ([line 3369](src/components/NakashaMap.tsx#L3369)): owner-name parsing and classification for every parcel.
- `villageOwnerStats` ([line 3408](src/components/NakashaMap.tsx#L3408)): family grouping with `f.plots.includes(...)`, which is O(n²) per family.
- `filteredPlots` ([line 3461](src/components/NakashaMap.tsx#L3461)): full filter and sort.
- A render of `NakashaMap`, a 5,117-line component with roughly 60 `useState` hooks.

For 2,000 parcels that is about 80 full recomputes. 

**Extra load amplification.**
- In CFR mode a second fetch pool (6 more) runs alongside the village-wide one, so up to 12 concurrent portal calls ([line 3696](src/components/NakashaMap.tsx#L3696)).
- Retries stack: client 2 attempts × proxy 3 attempts = up to 6 portal hits per parcel, against a portal documented to drop about 1 in 4 connections.
- Client aborts do not reach the proxy. After the browser gives up at 30 s, the proxy keeps its 90 s portal request alive (no `req.on("close")` handling), so abandoned work keeps loading the portal.
- Per-record `localStorage` writes are synchronous. When quota fills, `evictCache` scans and JSON-parses every key on each failed write ([bhunaksha-owners.ts:177](src/lib/bhunaksha-owners.ts#L177)). With about 5 MB of quota and records of 1–20 KB, only a handful of villages fit before this thrashing starts.
- `loadCadastralForGisCode` starts `fetchSurveyNumbers` before the extent returns, then starts it again if the portal reports a different gis code ([line 2279](src/components/NakashaMap.tsx#L2279)). This is a duplicate fetch of the survey list and records.

### 3.2 Cadastral map slow in certain villages (cause B)

- **Serverless proxy per tile.** On Vercel every WMS tile is one function invocation. The proxy opens a new TLS connection to the portal each time (no keep-alive agent) and awaits `getSessionCookie()` before each request. On a cold instance that is an extra call of up to 8 s ([api/bhunaksha.js:7](api/bhunaksha.js#L7)).
- **Region.** `vercel.json` sets no region or function duration. Vercel functions default to a US region (iad1). The portal is in India, so each tile pays an intercontinental round trip plus a fresh TLS handshake. This matches "fast on my laptop, slow deployed". It is the most likely reason you see 10 s+ calls. I could not verify it on your deployment, so confirm in the Vercel function logs.
- **Gating delay.** Cadastral tiles wait for the basemap to be idle: at least 200 ms and up to 6 s, with one 100 ms polling timer chain per tile ([line 137–153](src/components/NakashaMap.tsx#L137)). When Google is slow (a mirror took much longer in a past session) the cadastral waits for the full 6 s even though it is the thing the user came to see.
- **Cacheability.** WMS responses are cached for 1 h (`s-maxage` 24 h on Vercel), which is good. But the calibration offset changes the `BBOX`, so every calibration tweak is a full cache miss.
- **Village variance.** Villages with dense parcels produce larger PNGs (30 KB at village scale versus 4 KB at plot scale in my test), and on a slow link that is the difference you notice between villages.

### 3.3 Blurry at zoom 14–20 (cause C)

1. **No imagery beyond about z18–19 in rural areas.** ESRI returns the same 2,521-byte placeholder for z19, z20 and z21. Google keeps returning tiles but their size drops from 19 KB to 7.6 KB, which means they are stretched lower-zoom imagery.
2. **The view allows zoom 21; sources stop at 20 or lower** ([line 1487](src/components/NakashaMap.tsx#L1487), [line 1653](src/components/NakashaMap.tsx#L1653)). The `maxZoom` values in `BASEMAPS` are not used consistently.
3. **Cadastral tiles are 512 px with `hidpi: false`** ([line 1538](src/components/NakashaMap.tsx#L1538)). On a laptop with 125–150 % display scaling the parcel lines are rendered at 1× and then upscaled, so thin boundaries and survey numbers look soft.
4. **Fractional zoom** (`smoothResolutionConstraint: true`) means tiles are almost always resampled between integer levels, which softens raster WMS lines further.
5. **`transition: 0` with gated loading** shows blank tiles until each arrives, so it also looks like "not loaded yet" rather than "blurry".

### 3.4 Village search (cause D)

- Opening the search panel downloads and parses `mh_cfr_potential_villages.xlsx` (2 MB, SheetJS) on the main thread ([mh-village-data.ts:39](src/lib/mh-village-data.ts#L39)). The xlsx library also adds to the page bundle. The build scripts already convert other data to JSON, so this can be done at build time.
- Picking a village then fetches the **whole district** boundary file (for example Amravati: 4,094 polygons, 177k vertices, 7.9 MB raw, 1.86 MB gzipped), parses it, builds OpenLayers features, and clears and re-adds them to the layer, then waits an extra `setTimeout(300)` before fitting ([line 2829](src/components/NakashaMap.tsx#L2829), [line 2899](src/components/NakashaMap.tsx#L2899)). This is done to find a single village outline.
- `public/data/villages/` is 169 MB in total, and `Nashik.json` and `Nasik.json` are identical 7 MB copies.
- The view is fitted with `maxZoom` 15.5 / 16.5, so the user lands at a zoom where the cadastral and satellite are still soft, then has to zoom in manually.

### 3.5 Smaller items

- Three `new Map<string, Style>()` style caches ([line 951](src/components/NakashaMap.tsx#L951) and similar) use OpenLayers' `Map` class, not the built-in one (the file imports `ol/Map`). It works by accident through `BaseObject.get/set`, but constructs three full OpenLayers maps at module load. Use `globalThis.Map`.
- ATREE and MRSAC overlay tiles come from third-party servers and are gated behind both base and cadastral tiles, so with a slow basemap they appear late. That is intended, but it adds to the "everything is slow" feel when CFR layers are on.
- The portal certificate is expired (my Node test failed on it) and the proxy sets `rejectUnauthorized: false`. This is a security trade-off to document, not a speed issue.

## 4. Recommended fixes, in order

| Priority | Fix | Addresses | Effort |
|----------|-----|-----------|--------|
| 0 | Replace `path` with `p` in `api/bhunaksha.js:144` | Release blocker | 1 min |
| 1 | Add `"functions": {"api/bhunaksha.js": {"maxDuration": 60}}` and `"regions": ["bom1"]` to `vercel.json`; use `new https.Agent({ keepAlive: true })`; destroy the upstream request on `req.on("close")` | B, load amplification | 30 min |
| 2 | Show the survey list instantly from the survey-number list and **fetch records only for the visible rows** (about 30–50) plus on demand; make owner/category/CFR filters say "N of M loaded" instead of silently miscounting | A | Medium |
| 3 | Stop fetching the second copy in CFR mode; use one shared queue with dedupe; cap total concurrency at 6; one client retry only | A, load amplification | Small |
| 4 | Append batches without recomputing everything: compute index entries only for the new records, run `mrsacParcels` once after the fetch settles, and throttle updates to about 1 per second | E | Medium |
| 5 | Replace per-record `localStorage` with IndexedDB (one transaction per batch); remove the evict-on-every-failure scan | A, E | Small |
| 6 | Cap the view zoom at the real imagery limit (z19 for ESRI; test Google per area) and let OpenLayers over-zoom the cadastral overlay only; set `hidpi: true` for the cadastral source when zoom ≥ 16 and `devicePixelRatio > 1` | C | Small |
| 7 | Do not gate cadastral on the basemap; gate only the third-party overlays. Replace per-tile polling with one shared idle event | B | Small |
| 8 | Pre-build the village search list as JSON at build time (drop xlsx from the client) and split district boundary files per taluka, or generate a per-village outline index so only that one polygon is fetched | D | Medium |
| 9 | Raise the fit `maxZoom` to 17–18 after a village is chosen, so the user lands where the cadastral is legible | C, D | 1 line |
| 10 | Use `globalThis.Map` for the three style caches; delete the duplicate `Nasik.json` | Minor | 5 min |

Expected effect: priorities 1–3 remove most of the daytime waiting (cadastral tiles and list). Priorities 4–5 remove the UI stalls. Priority 6 and 9 address the blur. Priority 8 addresses search.

## 5. How to confirm each fix

- Chrome DevTools → Network: filter `bhunaksha`; check time-to-first-byte per tile (target under 1 s) and the number of requests in flight.
- Vercel → Functions logs: check region, cold-start duration and any timeouts.
- Chrome DevTools → Performance, on a 1,000+ parcel village: look for long tasks while the list fills (target: none over 50 ms).
- Application → Local Storage: confirm the size stays flat after the IndexedDB change.
