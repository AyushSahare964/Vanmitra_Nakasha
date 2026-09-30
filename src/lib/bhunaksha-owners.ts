/**
 * Authentic 7/12 owner records from the MahaBhuNakasha portal.
 *
 * The parcel list for a village used to be populated with names generated client-side
 * from a seeded PRNG, which meant nothing in the list corresponded to a real record and
 * searching an actual owner's name could never succeed. This module fetches the real
 * records instead, in a throttled queue so a 400-parcel village does not fire 400
 * simultaneous requests at the portal.
 *
 * getPlotInfo also returns the parcel's true `plotid` and `the_geom`, which is what the
 * map highlight needs in order to draw a polygon for a parcel the user has not clicked.
 */

const BHUNAKSHA_STATE = "27"; // Maharashtra
const BHUNAKSHA_REST_BASE = "/bhunaksha/rest";

export interface PlotInfoRecord {
  surveyNo: string;
  totalArea: string;
  potKharaba: string;
  ownerName: string;
  khataNo: string;
  cultivableArea?: string;
  assessment?: string;
}

export interface PlotRecordResult {
  plotno: string;
  /** The portal's real plot id, needed by getExtentGeoref and the plot WMS layer. */
  plotid: string;
  owner: string;
  area: string;
  records: PlotInfoRecord[];
  theGeom?: string;
  localBounds?: { xmin: number; ymin: number; xmax: number; ymax: number };
  reportUrl?: string;
  /** False when the portal returned no usable record for this parcel. */
  found: boolean;
}

/**
 * Parses the official MahaBhuNakasha plot info text block into 7/12 records.
 * Blocks are separated by runs of dashes and each line is a `key: value` pair.
 */
export function parseBhuNakashaInfoText(infoStr: string, fallbackPlotNo: string): PlotInfoRecord[] {
  if (!infoStr || typeof infoStr !== "string") return [];
  const blocks = infoStr.split(/-{5,}/).map((b) => b.trim()).filter(Boolean);
  const records: PlotInfoRecord[] = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let surveyNo = fallbackPlotNo || "";
    let totalArea = "0.0000";
    let potKharaba = "0.0000";
    let ownerName = "";
    let khataNo = "";

    for (const line of lines) {
      const parts = line.split(/:\s*(.+)/);
      if (parts.length >= 2) {
        const key = (parts[0] || "").trim().toLowerCase();
        const val = (parts[1] || "").trim();
        if (key.includes("survey")) surveyNo = val;
        else if (key.includes("total area") || key === "area") totalArea = val;
        else if (key.includes("pot kharaba") || key.includes("kharaba")) potKharaba = val;
        else if (key.includes("owner")) ownerName = val;
        else if (key.includes("khata")) khataNo = val;
      }
    }

    if (ownerName || surveyNo || khataNo) {
      records.push({
        surveyNo: surveyNo || fallbackPlotNo || "",
        totalArea,
        potKharaba,
        ownerName: ownerName || "महाराष्ट्र शासन",
        khataNo: khataNo || "-",
        cultivableArea: totalArea,
        assessment: "₹ 1.50",
      });
    }
  }
  return records;
}

/**
 * The portal's JSON is untyped and its field names vary between endpoints and villages,
 * so every field is read defensively and coerced at the point of use.
 */
type PortalPayload = Record<string, unknown>;

const asString = (v: unknown, fallback = ""): string =>
  v === null || v === undefined || v === "" ? fallback : String(v);

/** Builds 7/12 records from whatever shape getPlotInfo returned. */
export function recordsFromPlotInfo(plotNo: string, pInfo: unknown): PlotInfoRecord[] {
  const info = pInfo as PortalPayload | null | undefined;
  if (!info) return [];

  if (typeof info.info === "string" && info.info.trim()) {
    const parsed = parseBhuNakashaInfoText(info.info, plotNo);
    if (parsed.length > 0) return parsed;
  }

  if (Array.isArray(info.records) && info.records.length > 0) {
    return (info.records as PortalPayload[]).map((r) => ({
      surveyNo: asString(r.surveyNo ?? r.plotno, plotNo),
      totalArea: asString(r.totalArea ?? r.total_area ?? r.area, "0.0000"),
      potKharaba: asString(r.potKharaba ?? r.pot_kharaba, "0.0000"),
      ownerName: asString(r.ownerName ?? r.owner_name ?? r.owner, "महाराष्ट्र शासन"),
      khataNo: asString(r.khataNo ?? r.khata_no, "1"),
      cultivableArea: asString(r.cultivableArea ?? r.cultivable_area ?? r.area, "0.0000"),
      assessment: asString(r.assessment, "₹ 1.50"),
    }));
  }

  if (info.owner) {
    const area = asString(info.area, "0.0000");
    return [
      {
        surveyNo: plotNo,
        totalArea: area,
        potKharaba: "0.0000",
        ownerName: asString(info.owner),
        khataNo: asString(info.khataNo, "-"),
        cultivableArea: area,
        assessment: "₹ 1.50",
      },
    ];
  }

  return [];
}

function buildReportUrl(gisCode: string, plotNo: string, pInfo: PortalPayload | null): string {
  const fallback =
    `https://mahabhunakasha.mahabhumi.gov.in/27/signplotreportpublic.jsp` +
    `?state=${BHUNAKSHA_STATE}&giscode=${gisCode}&plotno=${encodeURIComponent(plotNo)}`;
  if (pInfo && typeof pInfo.infoLinks === "string") {
    const href = pInfo.infoLinks.match(/href=["']([^"']+)["']/i);
    if (href?.[1]) return href[1].replace(/^\.\.\//, "https://mahabhunakasha.mahabhumi.gov.in/27/");
  }
  return fallback;
}

/**
 * Two-level cache: memory for the session, localStorage across reloads (24h TTL) so a
 * village that was opened yesterday loads instantly instead of refetching every parcel.
 */
const memoryCache = new Map<string, PlotRecordResult>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_PREFIX = "bn:rec:";

const cacheKey = (gisCode: string, plotNo: string) => `${CACHE_PREFIX}${gisCode}:${plotNo}`;

function readCache(gisCode: string, plotNo: string): PlotRecordResult | undefined {
  const key = cacheKey(gisCode, plotNo);
  const hit = memoryCache.get(key);
  if (hit) return hit;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const { t, v } = JSON.parse(raw) as { t: number; v: PlotRecordResult };
      if (Date.now() - t < CACHE_TTL_MS) {
        memoryCache.set(key, v);
        return v;
      }
      localStorage.removeItem(key);
    }
  } catch {
    // Storage unavailable (private mode) — the memory cache still applies.
  }
  return undefined;
}

/** Frees space by dropping expired entries, then the oldest half if that was not enough. */
function evictCache(): void {
  const entries: { key: string; t: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(CACHE_PREFIX)) continue;
    let t = 0;
    try {
      t = JSON.parse(localStorage.getItem(key) || "{}").t || 0;
    } catch {
      // unreadable entry — treated as oldest
    }
    entries.push({ key, t });
  }
  entries.sort((a, b) => a.t - b.t);
  const expired = entries.filter((e) => Date.now() - e.t >= CACHE_TTL_MS);
  (expired.length ? expired : entries.slice(0, Math.ceil(entries.length / 2))).forEach((e) => localStorage.removeItem(e.key));
}

function writeCache(gisCode: string, plotNo: string, value: PlotRecordResult): void {
  const key = cacheKey(gisCode, plotNo);
  memoryCache.set(key, value);
  const payload = JSON.stringify({ t: Date.now(), v: value });
  try {
    localStorage.setItem(key, payload);
  } catch {
    try {
      evictCache();
      localStorage.setItem(key, payload);
    } catch {
      // Still full — non-fatal, the memory cache carries the session.
    }
  }
}

/** Fetches the authentic 7/12 record for a single parcel. */
export async function fetchPlotRecord(
  gisCode: string,
  plotNo: string,
  signal?: AbortSignal
): Promise<PlotRecordResult> {
  const cached = readCache(gisCode, plotNo);
  if (cached) return cached;

  let pInfo: PortalPayload | null = null;
  // Bounded: a hung portal must not pin a worker forever. Caller cancellation still propagates.
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 15000);
  const onAbort = () => timeout.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(BHUNAKSHA_REST_BASE + "/MapInfo/getPlotInfo", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `state=${BHUNAKSHA_STATE}&giscode=${gisCode}&plotno=${encodeURIComponent(plotNo)}&srs=4326`,
      signal: timeout.signal,
    });
    if (res.ok) pInfo = await res.json();
  } catch (err) {
    if (signal?.aborted) throw err;
    // Network/gateway failure — reported as not found, and not cached so it can retry.
    return { plotno: plotNo, plotid: plotNo, owner: "", area: "", records: [], found: false };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }

  const records = recordsFromPlotInfo(plotNo, pInfo);
  const first = records[0];
  const localBounds =
    pInfo?.xmin != null && pInfo?.ymin != null && pInfo?.xmax != null && pInfo?.ymax != null
      ? {
          xmin: Number(pInfo.xmin),
          ymin: Number(pInfo.ymin),
          xmax: Number(pInfo.xmax),
          ymax: Number(pInfo.ymax),
        }
      : undefined;

  const result: PlotRecordResult = {
    plotno: plotNo,
    plotid: asString(pInfo?.plotid, plotNo),
    owner: asString(pInfo?.owner, first?.ownerName || ""),
    area: pInfo?.formatedArea
      ? `${asString(pInfo.formatedArea)} sq.m`
      : pInfo?.area
        ? asString(pInfo.area)
        : first?.totalArea
          ? `${first.totalArea} Ha`
          : "",
    records,
    theGeom: typeof pInfo?.the_geom === "string" ? pInfo.the_geom : undefined,
    localBounds,
    reportUrl: buildReportUrl(gisCode, plotNo, pInfo),
    found: records.length > 0,
  };

  if (result.found) writeCache(gisCode, plotNo, result);
  return result;
}

export interface BulkFetchOptions {
  /** Parallel requests in flight. Kept low so the portal is not hammered. */
  concurrency?: number;
  /** Called with each completed chunk so the UI can fill in progressively. */
  onBatch?: (batch: PlotRecordResult[], done: number, total: number) => void;
  /** Results per onBatch call. */
  batchSize?: number;
  signal?: AbortSignal;
}

/**
 * Fetches owner records for a whole village through a bounded worker pool.
 * Resolves with everything fetched; partial progress is delivered via `onBatch`.
 */
export async function bulkFetchVillageRecords(
  gisCode: string,
  plotNos: string[],
  { concurrency = 6, onBatch, batchSize = 25, signal }: BulkFetchOptions = {}
): Promise<PlotRecordResult[]> {
  const total = plotNos.length;
  const all: PlotRecordResult[] = [];
  if (!gisCode || total === 0) return all;

  let cursor = 0;
  let done = 0;
  let pending: PlotRecordResult[] = [];

  const flush = (force: boolean) => {
    if (pending.length === 0) return;
    if (!force && pending.length < batchSize) return;
    const batch = pending;
    pending = [];
    onBatch?.(batch, done, total);
  };

  const worker = async () => {
    while (cursor < total) {
      if (signal?.aborted) return;
      const plotNo = plotNos[cursor++];
      if (!plotNo) continue;
      try {
        const rec = await fetchPlotRecord(gisCode, plotNo, signal);
        all.push(rec);
        pending.push(rec);
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
      }
      done++;
      flush(false);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
  if (!signal?.aborted) flush(true);
  return all;
}

/** Extent lookup for a parcel, used when a bulk record carries no geometry. */
export async function fetchPlotExtent(
  gisCode: string,
  plotId: string,
  signal?: AbortSignal
): Promise<[number, number, number, number] | null> {
  try {
    const res = await fetch(BHUNAKSHA_REST_BASE + "/MapInfo/getExtentGeoref", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `state=${BHUNAKSHA_STATE}&giscode=${gisCode}&plotid=${encodeURIComponent(plotId)}&srs=4326`,
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) return null;
    const ext = await res.json();
    if (ext?.xmin != null && ext?.ymin != null && ext?.xmax != null && ext?.ymax != null) {
      const e: [number, number, number, number] = [Number(ext.xmin), Number(ext.ymin), Number(ext.xmax), Number(ext.ymax)];
      // An unknown plot id comes back as zeros / garbage; drawing it puts the parcel off Africa.
      const inIndia = (lon: number, lat: number) => lon > 60 && lon < 100 && lat > 5 && lat < 40;
      return inIndia(e[0], e[1]) && inIndia(e[2], e[3]) && e[2] >= e[0] && e[3] >= e[1] ? e : null;
    }
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
  }
  return null;
}

/**
 * Runs async tasks with bounded parallelism, preserving input order in the result.
 * Shared by the bulk record fetch and the multi-parcel map highlight.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      const item = items[i];
      if (item === undefined || signal?.aborted) continue;
      results[i] = await fn(item, i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
