import { RES_LAYERS, type ResLayer } from "@/lib/mrsac";

export interface ResCount {
  count: number;
  /** Sum of polygon areas in hectares, when the layer reports one. */
  areaHa?: number;
  types: { label: string; count: number }[];
}

interface Props {
  tileOn: Record<string, boolean>;
  onTile: (key: string, on: boolean) => void;
  opacity: number;
  onOpacity: (v: number) => void;
  villageSelected: boolean;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  onRetry?: () => void;
  villageName: string | null;
  counts: Record<string, ResCount>;
  visible: Set<string>;
  onVisible: (key: string) => void;
  hiddenTypes: Set<string>;
  onType: (layerKey: string, label: string) => void;
  insight: string[];
}

const GROUPS: { key: "water" | "forest"; title: string }[] = [
  { key: "water", title: "Water" },
  { key: "forest", title: "Forest" },
];

const dot = (c: string) => <span className="size-2.5 shrink-0 rounded-sm" style={{ background: c }} />;

export function ResourcesSection(p: Props) {
  const layers = (g: string) => RES_LAYERS.filter((l: ResLayer) => l.group === g);

  return (
    <details className="rounded border border-slate-200 px-2.5 py-1.5" open>
      <summary className="cursor-pointer text-xs font-semibold text-slate-700">Water, wells &amp; forest (MRSAC)</summary>
      <div className="mt-2 space-y-3 text-xs">
        {p.villageSelected && (
          <div className="rounded border border-sky-200 bg-sky-50/60 p-2">
            <div className="font-semibold text-sky-900">In this village{p.villageName ? ` — ${p.villageName}` : ""}</div>
            {p.status === "loading" && <div className="mt-1 text-slate-500">Loading resources…</div>}
            {p.status === "error" && (
              <div className="mt-1 flex items-start justify-between gap-2 text-red-700">
                <span>{p.error}</span>
                {p.onRetry && (
                  <button type="button" onClick={p.onRetry} className="shrink-0 font-semibold underline">
                    Retry
                  </button>
                )}
              </div>
            )}
            {p.status === "ready" && (
              <>
                {p.insight.length > 0 && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-700">
                    {p.insight.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-2 space-y-1.5">
                  {RES_LAYERS.map((l) => {
                    const c = p.counts[l.key];
                    if (!c || c.count === 0) return null;
                    return (
                      <div key={l.key}>
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={p.visible.has(l.key)} onChange={() => p.onVisible(l.key)} />
                          {dot(l.color)}
                          <span className="flex-1 truncate">{l.label}</span>
                          <span className="tabular-nums text-slate-600">
                            {c.count}
                            {c.areaHa ? ` · ${c.areaHa.toFixed(1)} ha` : ""}
                          </span>
                        </label>
                        {l.typeField && c.types.length > 1 && p.visible.has(l.key) && (
                          <div className="mt-1 flex flex-wrap gap-1 pl-6">
                            {c.types.map((t) => {
                              const off = p.hiddenTypes.has(`${l.key}|${t.label}`);
                              return (
                                <button
                                  key={t.label}
                                  type="button"
                                  aria-pressed={!off}
                                  onClick={() => p.onType(l.key, t.label)}
                                  className={`rounded border px-1.5 py-0.5 text-[11px] ${off ? "border-slate-200 text-slate-400 line-through" : "border-slate-300 bg-white text-slate-700"}`}
                                >
                                  {t.label} <span className="text-slate-400">{t.count}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        <div>
          <div className="mb-1 font-semibold text-slate-600">Map layers — all Maharashtra</div>
          {GROUPS.map((g) => (
            <div key={g.key} className="mb-1.5">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">{g.title}</div>
              {layers(g.key).map((l) => (
                <label key={l.key} className="flex items-center gap-2 py-0.5">
                  <input type="checkbox" checked={!!p.tileOn[l.key]} onChange={(e) => p.onTile(l.key, e.target.checked)} />
                  {dot(l.color)}
                  <span className="flex-1">{l.label}</span>
                  {l.zoomNote && <span className="text-[10px] text-slate-400">zoom in</span>}
                </label>
              ))}
            </div>
          ))}
          <label className="flex items-center gap-2 text-slate-600">
            Opacity
            <input type="range" min={20} max={100} value={p.opacity} onChange={(e) => p.onOpacity(Number(e.target.value))} className="flex-1" />
            <span className="w-8 text-right tabular-nums">{p.opacity}%</span>
          </label>
          <p className="mt-1 text-[10px] text-slate-400">Source: MRSAC Geoportal (geoportal.mrsac.org.in). Wells and structures draw only when zoomed in.</p>
        </div>
      </div>
    </details>
  );
}
