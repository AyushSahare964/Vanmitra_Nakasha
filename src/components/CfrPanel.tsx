import { useMemo, useState, type ReactNode } from "react";
import type { AtreeVillage } from "@/lib/cfr-atree";
import {
  PURPOSE_GROUPS,
  CFR_STATUSES,
  fuzzyGet,
  talukaKey,
  villageKeys,
  villagesOfTaluka,
  type CfrIndex,
  type CfrRow,
  type PurposeGroup,
} from "@/lib/cfr-data";

interface Option {
  code: string;
  value: string;
}

export interface CfrAtreeState {
  potential: boolean;
  recognized: boolean;
  opacity: number;
  /** With a village selected, draw only that village instead of all of Maharashtra. */
  villageOnly: boolean;
}

interface Props {
  index: CfrIndex | null;
  region: ReactNode;
  district: string;
  taluka: string;
  villageSelected: boolean;
  portalTalukas: Option[];
  portalVillages: Option[];
  onPickTaluka: (code: string) => void;
  onPickVillage: (code: string) => void;
  villageRows: CfrRow[];
  totalParcels: number;
  matchedSurveys: number;
  unmatched: string[];
  explorer: ReactNode;
  purposes: Set<PurposeGroup>;
  onPurpose: (g: PurposeGroup) => void;
  cadastral: { enabled: boolean; opacity: number };
  onCadastral: (patch: Partial<{ enabled: boolean; opacity: number }>) => void;
  resources: ReactNode;
  error: string | null;
  onRetry: () => void;
  atree: CfrAtreeState;
  atreeVillage: AtreeVillage | null;
  atreeLoading: boolean;
  onAtree: (patch: Partial<CfrAtreeState>) => void;
  onClose: () => void;
}

const fmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 1 });
const uniq = <T,>(a: T[]) => [...new Set(a)];

interface VillageAgg {
  name: string;
  rows: CfrRow[];
  ha: number;
  surveys: number;
  date: number; // latest approval, yyyymmdd
  years: string[];
}

function aggregate(rows: CfrRow[]): VillageAgg[] {
  const m = new Map<string, CfrRow[]>();
  rows.forEach((r) => m.set(r.v, [...(m.get(r.v) ?? []), r]));
  return [...m.entries()].map(([name, rs]) => ({
    name,
    rows: rs,
    ha: rs.reduce((a, r) => a + r.ha, 0),
    surveys: rs.reduce((a, r) => a + r.s.length, 0),
    date: Math.max(...rs.map((r) => Number(r.dt.split(".").reverse().join("").padEnd(8, "0")) || 0)),
    years: uniq(rs.map((r) => r.y)),
  }));
}

function Chips<T extends string>({
  items,
  on,
  toggle,
}: {
  items: { key: T; label: string }[];
  on: Set<T>;
  toggle: (k: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((i) => (
        <button
          key={i.key}
          type="button"
          aria-pressed={on.has(i.key)}
          onClick={() => toggle(i.key)}
          className={`rounded border px-1.5 py-0.5 text-[11px] ${
            on.has(i.key) ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 text-slate-700 hover:border-slate-400"
          }`}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

export function CfrPanel(p: Props) {
  const [sort, setSort] = useState<{ key: "name" | "ha" | "surveys" | "date"; desc: boolean }>({ key: "ha", desc: true });
  const [years, setYears] = useState<Set<string>>(() => new Set());
  const [limit, setLimit] = useState(50);
  const [showUnmatched, setShowUnmatched] = useState(false);

  const haveDistrict = !!p.index && p.index.rows.some((r) => r.d.trim() !== "" && p.district && villageKeys(r.d)[0] === villageKeys(p.district)[0]);

  // Villages of the chosen taluka, or a taluka summary when only the district is chosen.
  const list = useMemo(() => {
    if (!p.index || !haveDistrict) return [];
    let rows: CfrRow[];
    if (p.taluka) rows = uniq([...villagesOfTaluka(p.index, p.district, p.taluka).values()].flat());
    else rows = p.index.rows.filter((r) => villageKeys(r.d)[0] === villageKeys(p.district)[0]);
    if (p.purposes.size) rows = rows.filter((r) => r.g.some((g) => p.purposes.has(g)));
    if (years.size) rows = rows.filter((r) => years.has(r.y));
    const groups = p.taluka ? aggregate(rows) : aggregate(rows.map((r) => ({ ...r, v: r.t.trim() })));
    const d = sort.desc ? -1 : 1;
    return groups.sort((a, b) => {
      const c =
        sort.key === "name" ? a.name.localeCompare(b.name, "mr") : sort.key === "ha" ? a.ha - b.ha : sort.key === "surveys" ? a.surveys - b.surveys : a.date - b.date;
      return (c || a.name.localeCompare(b.name, "mr")) * d;
    });
  }, [p.index, p.district, p.taluka, p.purposes, years, sort, haveDistrict]);

  const allYears = useMemo(
    () => (p.index ? uniq(p.index.rows.map((r) => r.y)).filter(Boolean).sort() : []),
    [p.index]
  );

  const portalCode = useMemo(() => {
    const src = p.taluka ? p.portalVillages : p.portalTalukas;
    const m = new Map<string, string>();
    for (const o of src) {
      if (p.taluka) villageKeys(o.value).forEach((k) => m.set(k, o.code));
      else m.set(talukaKey(o.value), o.code);
    }
    return (name: string) => (p.taluka ? villageKeys(name).map((k) => fuzzyGet(m, k)).find(Boolean) : m.get(talukaKey(name)));
  }, [p.taluka, p.portalVillages, p.portalTalukas]);

  const toggleYear = (y: string) =>
    setYears((prev) => {
      const n = new Set(prev);
      if (!n.delete(y)) n.add(y);
      return n;
    });
  const sortBtn = (key: typeof sort.key, label: string) => (
    <button
      type="button"
      onClick={() => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "name" }))}
      className={`flex-1 rounded py-1 text-[11px] font-semibold ${sort.key === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
    >
      {label}
      {sort.key === key && <span className="ml-0.5">{sort.desc ? "↓" : "↑"}</span>}
    </button>
  );

  // Village card
  const card = useMemo(() => {
    const rs = p.villageRows;
    return {
      ha: rs.reduce((a, r) => a + r.ha, 0),
      ac: rs.reduce((a, r) => a + r.ac, 0),
      surveys: rs.reduce((a, r) => a + r.s.length, 0),
      groups: uniq(rs.flatMap((r) => r.g)),
      dates: uniq(rs.map((r) => r.dt)).filter(Boolean),
      odd: rs.flatMap((r) => r.o ?? []),
    };
  }, [p.villageRows]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="text-sm font-bold text-slate-900">CFR — Community Forest Resources</div>
        <button onClick={p.onClose} className="text-lg text-slate-400 hover:text-slate-700" aria-label="Close">✕</button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {/* Cadastral parcel lines under the CFR colours */}
        <div className="rounded border border-slate-200 px-2.5 py-2 text-xs">
          <label className="flex items-center justify-between gap-2 font-semibold text-slate-700">
            <span>Cadastral map (parcel lines)</span>
            <input type="checkbox" checked={p.cadastral.enabled} onChange={(e) => p.onCadastral({ enabled: e.target.checked })} />
          </label>
          {p.cadastral.enabled && (
            <div className="mt-1.5 space-y-1.5">
              <label className="flex items-center gap-2 text-slate-600">
                Opacity
                <input type="range" min={20} max={100} value={p.cadastral.opacity} onChange={(e) => p.onCadastral({ opacity: Number(e.target.value) })} className="flex-1" />
                <span className="w-8 text-right tabular-nums">{p.cadastral.opacity}%</span>
              </label>
              <div className="flex gap-1">
                {[
                  { l: "Faint", v: 30 },
                  { l: "Balanced", v: 60 },
                  { l: "Clear", v: 85 },
                ].map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => p.onCadastral({ opacity: o.v })}
                    className={`flex-1 rounded border py-0.5 text-[11px] ${p.cadastral.opacity === o.v ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 text-slate-700"}`}
                  >
                    {o.l}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* State-wide ATREE layers */}
        <details className="rounded border border-slate-200 px-2.5 py-1.5">
          <summary className="cursor-pointer text-xs font-semibold text-slate-700">Maharashtra CFR map layers (ATREE)</summary>
          <div className="mt-2 space-y-1.5 text-xs">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={p.atree.potential} onChange={(e) => p.onAtree({ potential: e.target.checked })} />
              CFR potential villages
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={p.atree.recognized} onChange={(e) => p.onAtree({ recognized: e.target.checked })} />
              CFR recognized villages
            </label>
            {p.villageSelected && (
              <label className="flex items-start gap-2 rounded bg-slate-50 p-1.5 text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={p.atree.villageOnly}
                  disabled={!p.atreeVillage}
                  onChange={(e) => p.onAtree({ villageOnly: e.target.checked })}
                />
                <span>
                  Show only the selected village
                  <span className="block text-[10px] text-slate-500">
                    {p.atreeLoading
                      ? "Matching ATREE village…"
                      : p.atreeVillage
                        ? `ATREE village: ${p.atreeVillage.name} (${p.atreeVillage.code})${p.atreeVillage.confidence < 0.6 ? " — low match confidence" : ""}`
                        : "Could not match this village in ATREE; showing all villages."}
                  </span>
                </span>
              </label>
            )}
            <label className="flex items-center gap-2 text-slate-600">
              Opacity
              <input type="range" min={20} max={100} value={p.atree.opacity} onChange={(e) => p.onAtree({ opacity: Number(e.target.value) })} className="flex-1" />
              <span className="w-8 text-right tabular-nums">{p.atree.opacity}%</span>
            </label>
            <p className="text-[10px] text-slate-400">Source: ATREE CFR WebGIS (cfr.atree.org). Village-level layers; drawn by ATREE.</p>
          </div>
        </details>

        {p.region}

        {/* Colour key */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600">
          {CFR_STATUSES.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
              {s.en}
            </span>
          ))}
        </div>

        {p.resources}

        {p.error && (
          <div className="rounded border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-800">
            {p.error}{" "}
            <button type="button" onClick={p.onRetry} className="font-semibold underline">
              Retry
            </button>
          </div>
        )}

        {!p.index ? (
          <div className="py-6 text-center text-xs text-slate-400">Loading CFR records…</div>
        ) : p.villageSelected ? (
          <>
            {p.atreeVillage && (p.atreeVillage.potential || p.atreeVillage.recognized) && (
              <div className="rounded border border-orange-200 bg-orange-50/60 p-2.5 text-xs text-slate-700">
                <div className="font-semibold text-orange-900">ATREE — {p.atreeVillage.name}</div>
                {p.atreeVillage.potential && (
                  <div>
                    CFR potential {fmt(Number(p.atreeVillage.potential["totcfr_ha"]) || 0)} ha · forest {fmt(Number(p.atreeVillage.potential["forest_ha"]) || 0)} ha
                    {p.atreeVillage.potential["cfr_type"] ? ` · ${String(p.atreeVillage.potential["cfr_type"])}` : ""}
                  </div>
                )}
                {p.atreeVillage.recognized && (
                  <div>
                    ATREE recognized area {fmt(Number(p.atreeVillage.recognized["cr_cfrarea"]) || 0)} ha
                    {p.atreeVillage.recognized["cfr_title"] ? ` · ${String(p.atreeVillage.recognized["cfr_title"])} title(s)` : ""}
                  </div>
                )}
              </div>
            )}
            {p.villageRows.length > 0 ? (
              <div className="rounded border border-violet-200 bg-violet-50/60 p-2.5 text-xs">
                <div className="font-semibold text-violet-900">CFR recognized in this village</div>
                <div className="mt-0.5 text-slate-700">
                  {p.villageRows.length} approval{p.villageRows.length > 1 ? "s" : ""} · {card.surveys} survey nos. · {fmt(card.ha)} ha ({fmt(card.ac)} ac)
                </div>
                <div className="text-slate-600">{card.groups.map((g) => PURPOSE_GROUPS.find((x) => x.key === g)!.label).join(", ")}</div>
                {card.dates.length > 0 && <div className="text-slate-500">Approved {card.dates.join(", ")}</div>}
                <div className="mt-1 text-slate-600">
                  {p.matchedSurveys} of {p.totalParcels} parcels are recognized CFR land.
                </div>
                {(p.unmatched.length > 0 || card.odd.length > 0) && (
                  <button type="button" className="mt-1 text-left text-[11px] text-slate-600 underline" onClick={() => setShowUnmatched((v) => !v)}>
                    {p.unmatched.length + card.odd.length} listed survey no(s). not found among this village’s parcels
                    {showUnmatched ? " — hide" : " — show"}
                  </button>
                )}
                {showUnmatched && (
                  <div className="mt-0.5 break-words text-[11px] text-slate-500">
                    {[...p.unmatched, ...card.odd].join(", ")}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600">
                {haveDistrict
                  ? "No recognized CFR survey numbers listed for this village. Green and mustard parcels below are candidates only."
                  : "Recognized survey data is not loaded for this district. Parcels show as candidates (inferred from the 7/12 holder) only."}
              </div>
            )}
            {p.villageRows.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] text-slate-500">Purpose of recognized land</div>
                <Chips items={PURPOSE_GROUPS.map((g) => ({ key: g.key, label: g.label }))} on={p.purposes} toggle={p.onPurpose} />
              </div>
            )}
            {p.explorer}
          </>
        ) : haveDistrict ? (
          <>
            <div className="space-y-2">
              <div className="text-[11px] text-slate-500">
                {p.taluka ? "Villages with recognized CFR" : "Talukas with recognized CFR"} — pick one to see its survey numbers.
              </div>
              <Chips items={PURPOSE_GROUPS.map((g) => ({ key: g.key, label: g.label }))} on={p.purposes} toggle={p.onPurpose} />
              <Chips items={allYears.map((y) => ({ key: y, label: y }))} on={years} toggle={toggleYear} />
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-[11px] text-slate-500">Sort</span>
                <div className="flex flex-1 gap-0.5 rounded-md bg-slate-100 p-0.5">
                  {sortBtn("name", "Name")}
                  {sortBtn("ha", "Approved ha")}
                  {sortBtn("surveys", "Survey nos.")}
                  {sortBtn("date", "Date")}
                </div>
              </div>
              <div className="text-xs">
                <span className="font-semibold tabular-nums">{list.length}</span> {p.taluka ? "villages" : "talukas"} ·{" "}
                <span className="tabular-nums">{fmt(list.reduce((a, g) => a + g.ha, 0))}</span> ha
              </div>
            </div>
            <ul className="divide-y divide-slate-100 rounded border border-slate-200">
              {list.slice(0, limit).map((g) => {
                const code = portalCode(g.name);
                return (
                  <li key={g.name}>
                    <button
                      type="button"
                      disabled={!code}
                      onClick={() => code && (p.taluka ? p.onPickVillage(code) : p.onPickTaluka(code))}
                      className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-slate-50 disabled:opacity-50"
                      title={code ? "" : "Not found in the MahaBhuNakasha list"}
                    >
                      <span className="size-2 shrink-0 rounded-full" style={{ background: "#7c3aed" }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold">{g.name}</span>
                        <span className="block truncate text-[11px] text-slate-500">
                          {g.rows.length} approval{g.rows.length > 1 ? "s" : ""} · {g.surveys} survey nos.
                        </span>
                      </span>
                      <span className="text-xs tabular-nums text-slate-600">{fmt(g.ha)} ha</span>
                    </button>
                  </li>
                );
              })}
              {list.length > limit && (
                <li className="py-1.5 text-center">
                  <button type="button" className="text-[11px] font-semibold text-slate-700 hover:underline" onClick={() => setLimit((n) => n + 50)}>
                    Show 50 more ({limit} of {list.length})
                  </button>
                </li>
              )}
              {list.length === 0 && <li className="py-6 text-center text-xs text-slate-400">Nothing matches these filters.</li>}
            </ul>
          </>
        ) : (
          <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            Recognized survey numbers are loaded for{" "}
            <b>{uniq(p.index.rows.map((r) => r.d)).join(", ")}</b>. Pick that district to browse them, or pick any village to see
            forest and government parcels that are candidates for a CFR claim.
          </div>
        )}
      </div>
    </div>
  );
}
