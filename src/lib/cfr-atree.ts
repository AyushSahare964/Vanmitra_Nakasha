/**
 * Identifies which ATREE village polygon a MahaBhuNakasha village is.
 *
 * The two systems use unrelated village codes and spell names differently, so instead of
 * matching names we sample a 3×3 grid of points inside the village's extent, ask ATREE's
 * all-villages layer which polygon contains each point (through /api/cfr), and take the
 * polygon that wins the vote. That is effectively "largest overlap", and it tolerates the
 * few-metre misregistration between the two datasets.
 */

export interface AtreeVillage {
  /** Census village code (ATREE `vlgcd2011` / "Village Code"). */
  code: string;
  name: string;
  tehsil: string;
  /** Agreement of the sample points, 0–1. Low means the extent straddles villages. */
  confidence: number;
  potential?: Record<string, unknown>;
  recognized?: Record<string, unknown>;
}

type Props = Record<string, unknown> | null;

async function lookup(layer: string, lon: number, lat: number, signal?: AbortSignal): Promise<Props> {
  try {
    const res = await fetch(`/api/cfr?layer=${layer}&lon=${lon}&lat=${lat}`, signal ? { signal } : {});
    if (!res.ok) return null;
    return ((await res.json()) as { properties: Props }).properties;
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    return null;
  }
}

/** `extent` is [minLon, minLat, maxLon, maxLat] in real (already Vidarbha-corrected) degrees. */
export async function identifyAtreeVillage(
  extent: [number, number, number, number],
  signal?: AbortSignal
): Promise<AtreeVillage | null> {
  const [x0, y0, x1, y1] = extent;
  const pts: [number, number][] = [];
  for (const fx of [0.25, 0.5, 0.75]) for (const fy of [0.25, 0.5, 0.75]) pts.push([x0 + (x1 - x0) * fx, y0 + (y1 - y0) * fy]);

  const hits = await Promise.all(pts.map(([lon, lat]) => lookup("mh_villages_en", lon, lat, signal)));
  const votes = new Map<string, { n: number; props: Record<string, unknown>; at: [number, number] }>();
  hits.forEach((p, i) => {
    const code = p && String(p["Village Code"] ?? "");
    if (!p || !code) return;
    const v = votes.get(code) ?? { n: 0, props: p, at: pts[i]! };
    v.n += 1;
    votes.set(code, v);
  });
  const top = [...votes.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  if (!top || top[1].n < 2) return null;

  const [code, { n, props, at }] = top;
  const [potential, recognized] = await Promise.all([
    lookup("mh_cfr_potential_villages", at[0], at[1], signal),
    lookup("mh_cfr_recognized_villages", at[0], at[1], signal),
  ]);
  return {
    code,
    name: String(props["Village"] ?? ""),
    tehsil: String(props["Tehsil"] ?? ""),
    confidence: n / pts.length,
    ...(potential ? { potential } : {}),
    ...(recognized ? { recognized } : {}),
  };
}
