import { useEffect, useRef, useState, type ReactNode } from "react";
import { CATEGORIES } from "@/lib/land-categories";
import type { NamePart } from "@/lib/marathi-search";

export type SortKey = string;

/** One filter tile; the Land Explorer passes land categories, the CFR panel passes CFR statuses. */
export interface Tile {
  key: string;
  en: string;
  mr: string;
  color: string;
}

export interface ExplorerRow {
  plotno: string;
  category: string;
  areaHa: number;
  /** Optional extra line, e.g. "Grazing · 12.4 ha approved". */
  sub?: string;
  /** First owner as printed on the 7/12, empty until the record arrives. */
  owner: string;
  extraOwners: number;
  pending: boolean;
  /** Parcels held by this row's first owner (>1 enables "highlight owner"). */
  ownerHoldings: number;
  familyKey: string;
  familySize: number;
}

export interface ExplorerFamily {
  key: string;
  label: string;
  count: number;
}

interface Props {
  compact?: boolean;
  query: string;
  onQuery: (q: string) => void;
  namePart: NamePart;
  onNamePart: (p: NamePart) => void;
  categories: Set<string>;
  onToggleCategory: (c: string) => void;
  categoryCounts: Record<string, number>;
  tiles?: Tile[];
  tileNote?: string;
  sortOptions?: { key: SortKey; label: string }[];
  /** Extra controls rendered between the tiles and the sort row. */
  slot?: ReactNode;
  sortKey: SortKey;
  sortDesc: boolean;
  onSort: (k: SortKey) => void;
  rows: ExplorerRow[];
  totalMatches: number;
  totalHa: number;
  totalParcels: number;
  loadedParcels: number;
  families: ExplorerFamily[];
  selectedFamily: string | null;
  onFamily: (key: string | null) => void;
  selectedPlotno?: string | undefined;
  onSelect: (plotno: string) => void;
  onHighlightOwner: (plotno: string) => void;
  onHighlightFamily: (plotno: string) => void;
  onShowOnMap: () => void;
  onReset: () => void;
  onOpenExplorer?: () => void;
}

const PAGE = 50;
const DEFAULT_SORTS = [
  { key: "survey", label: "Survey no." },
  { key: "name", label: "Owner" },
  { key: "area", label: "Area" },
];

export function LandExplorer(p: Props) {
  const [limit, setLimit] = useState(PAGE);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [allFamilies, setAllFamilies] = useState(false);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const tiles: Tile[] = p.tiles ?? CATEGORIES;
  const colorOf = (c: string) => tiles.find((x) => x.key === c)?.color ?? "#a8a29e";

  // A new result set starts from the top again.
  useEffect(() => setLimit(PAGE), [p.query, p.namePart, p.categories, p.selectedFamily, p.sortKey, p.sortDesc, p.totalMatches]);

  // Load the next page when the bottom of the list scrolls into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || p.compact) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && setLimit((n) => n + PAGE), { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, [p.compact, p.rows.length]);

  const shown = p.compact ? p.rows.slice(0, 5) : p.rows.slice(0, limit);
  const incomplete = p.loadedParcels < p.totalParcels;
  const filtered = p.query.trim() !== "" || p.categories.size > 0 || p.selectedFamily !== null;
  const families = allFamilies ? p.families.slice(0, 60) : p.families.slice(0, 5);
  const sortBtn = (k: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => p.onSort(k)}
      className={`flex-1 py-1 text-[11px] font-semibold rounded ${p.sortKey === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
    >
      {label}
      {p.sortKey === k && <span className="ml-0.5">{p.sortDesc ? "↓" : "↑"}</span>}
    </button>
  );

  return (
    <div className="flex flex-col gap-2.5 min-h-0 text-slate-800">
      {/* Search */}
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <input
            type="search"
            value={p.query}
            onChange={(e) => p.onQuery(e.target.value)}
            placeholder="Name, surname or survey no."
            aria-label="Search parcels"
            className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm placeholder-slate-400 focus:border-slate-700 focus:outline-none"
          />
        </div>
        <select
          value={p.namePart}
          onChange={(e) => p.onNamePart(e.target.value as NamePart)}
          aria-label="Match in"
          title="Which part of the name to match"
          className="rounded-md border border-slate-300 bg-white px-1.5 text-[11px] text-slate-700"
        >
          <option value="full">Any name</option>
          <option value="first">First name</option>
          <option value="middle">Middle name</option>
          <option value="last">Surname</option>
        </select>
      </div>

      {/* Categories */}
      <div>
        <div className="grid grid-cols-3 gap-1">
          {tiles.map((c) => {
            const on = p.categories.has(c.key);
            const n = p.categoryCounts[c.key] ?? 0;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => p.onToggleCategory(c.key)}
                disabled={n === 0 && !on}
                aria-pressed={on}
                className={`text-left rounded-md border px-2 py-1 transition-colors disabled:opacity-40 ${
                  on ? "border-slate-800 bg-slate-50" : "border-slate-200 hover:border-slate-400"
                }`}
              >
                <div className="flex items-center gap-1.5 text-[11px] font-semibold leading-tight">
                  <span className="size-2 rounded-full shrink-0" style={{ background: c.color }} />
                  <span className="truncate">{c.en}</span>
                  <span className="ml-auto tabular-nums text-slate-500">{n}</span>
                </div>
                <div className="text-[10px] text-slate-500 leading-tight pl-3.5">{c.mr}</div>
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-[10px] text-slate-400">{p.tileNote ?? "Categories are inferred from the 7/12 holder name."}</p>
      </div>

      {p.slot}

      {/* Sort */}
      {!p.compact && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500 shrink-0">Sort</span>
          <div className="flex flex-1 gap-0.5 rounded-md bg-slate-100 p-0.5">
            {(p.sortOptions ?? DEFAULT_SORTS).map((o) => sortBtn(o.key, o.label))}
          </div>
        </div>
      )}

      {/* Families */}
      {!p.compact && p.families.length > 0 && (
        <div>
          <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
            <span>Families (आडनाव)</span>
            {p.families.length > 5 && (
              <button type="button" onClick={() => setAllFamilies((v) => !v)} className="font-semibold text-slate-700 hover:underline">
                {allFamilies ? "Show fewer" : `All ${p.families.length}`}
              </button>
            )}
          </div>
          <div className={`flex flex-wrap gap-1 ${allFamilies ? "max-h-28 overflow-y-auto" : ""}`}>
            {families.map((f) => {
              const on = p.selectedFamily === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => p.onFamily(on ? null : f.key)}
                  className={`rounded border px-1.5 py-0.5 text-[11px] ${
                    on ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 text-slate-700 hover:border-slate-400"
                  }`}
                >
                  {f.label} <span className={on ? "text-slate-300" : "text-slate-400"}>{f.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="flex items-center gap-2 border-t border-slate-200 pt-2">
        <div className="min-w-0 flex-1 text-xs">
          <span className="font-semibold tabular-nums">{p.totalMatches}</span> parcels
          {p.totalHa > 0 && <span className="text-slate-500"> · {p.totalHa.toFixed(2)} ha ({(p.totalHa * 2.47105).toFixed(1)} ac)</span>}
        </div>
        {filtered && (
          <button type="button" onClick={p.onReset} className="text-[11px] text-slate-500 hover:underline">
            Reset
          </button>
        )}
        <button
          type="button"
          onClick={p.onShowOnMap}
          disabled={p.totalMatches === 0}
          className="rounded bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
        >
          Show on map
        </button>
      </div>

      {incomplete && (
        <div>
          <div className="text-[11px] text-amber-700">
            Records {p.loadedParcels} / {p.totalParcels} loaded — results may be incomplete
          </div>
          <div className="mt-1 h-0.5 rounded bg-slate-200 overflow-hidden">
            <div className="h-full bg-slate-600 transition-[width]" style={{ width: `${(p.loadedParcels / Math.max(1, p.totalParcels)) * 100}%` }} />
          </div>
        </div>
      )}

      {/* Results */}
      {shown.length === 0 ? (
        <div className="py-6 text-center text-xs text-slate-400">No parcels match.</div>
      ) : (
        <ul className={`divide-y divide-slate-100 rounded border border-slate-200 ${p.compact ? "" : "overflow-y-auto"}`} style={p.compact ? undefined : { maxHeight: "none" }}>
          {shown.map((r) => {
            const sel = r.plotno === p.selectedPlotno;
            const canMenu = r.ownerHoldings > 1 || r.familySize > 1;
            return (
              <li key={r.plotno} className={sel ? "bg-slate-100" : "hover:bg-slate-50"} style={{ contentVisibility: "auto", containIntrinsicSize: "0 40px" }}>
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <span className="size-2 rounded-full shrink-0" style={{ background: colorOf(r.category) }} title={r.category} />
                  <button type="button" onClick={() => p.onSelect(r.plotno)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-baseline gap-2 text-xs">
                      <span className="font-semibold">Survey {r.plotno}</span>
                      {r.areaHa > 0 && <span className="text-slate-500 tabular-nums">{r.areaHa.toFixed(2)} ha</span>}
                    </div>
                    {r.sub && <div className="truncate text-[11px] font-medium text-slate-700">{r.sub}</div>}
                    <div className="truncate text-[11px] text-slate-600">
                      {r.pending ? <span className="italic text-slate-400">loading record…</span> : r.owner || <span className="italic text-slate-400">no record</span>}
                      {r.extraOwners > 0 && <span className="text-slate-400"> +{r.extraOwners}</span>}
                    </div>
                  </button>
                  {canMenu && (
                    <button
                      type="button"
                      aria-label="More actions"
                      onClick={() => setMenuFor(menuFor === r.plotno ? null : r.plotno)}
                      className="rounded px-1.5 text-slate-500 hover:bg-slate-200"
                    >
                      ⋯
                    </button>
                  )}
                </div>
                {menuFor === r.plotno && (
                  <div className="flex gap-2 px-6 pb-1.5 text-[11px]">
                    {r.ownerHoldings > 1 && (
                      <button type="button" className="font-semibold text-slate-700 hover:underline" onClick={() => { p.onHighlightOwner(r.plotno); setMenuFor(null); }}>
                        Owner’s {r.ownerHoldings} parcels
                      </button>
                    )}
                    {r.familySize > 1 && (
                      <button type="button" className="font-semibold text-slate-700 hover:underline" onClick={() => { p.onHighlightFamily(r.plotno); setMenuFor(null); }}>
                        Family’s {r.familySize} parcels
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
          {!p.compact && shown.length < p.rows.length && <div ref={sentinel} className="py-2 text-center text-[11px] text-slate-400">Showing {shown.length} of {p.rows.length}…</div>}
        </ul>
      )}

      {p.compact && p.onOpenExplorer && p.totalMatches > shown.length && (
        <button type="button" onClick={p.onOpenExplorer} className="text-xs font-semibold text-slate-700 hover:underline text-left">
          Open all {p.totalMatches} in Explore →
        </button>
      )}
    </div>
  );
}
