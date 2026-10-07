import { test as base, expect, type Page, type Locator } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

export { expect };

/** Console noise that is not an app bug (third-party tiles, fonts, missing favicon). */
const IGNORED_ERR = /favicon|fonts\.g|google\.com\/vt|arcgisonline|openstreetmap|cfr\.atree|mrsac|Failed to load resource|net::ERR|ERR_(FAILED|ABORTED|INTERNET)|status of (4|5)\d\d/i;

export type Panel = "Layers" | "Search" | "Cadastral" | "Explore" | "CFR" | "KML" | "Legend";

/** Villages are read from the committed portal snapshot so tests never hard-code Marathi spellings twice. */
const BN = path.resolve(process.cwd(), "public/data/bn");
type Snap = { code: string; value: string; hasData: boolean; villages: { code: string; value: string; hasData: boolean }[] };
export function snapshotDistrict(distCode: string): Snap[] {
  return JSON.parse(fs.readFileSync(path.join(BN, `R-${distCode}.json`), "utf8"));
}
export const VILLAGES = {
  umrane: { dist: /Nas?h?ik|नाशिक/i, taluka: /Deola|देवळा/i, village: /Umrane|उमराणे/i }, // ~2,100 parcels
  nagpurRural: { dist: /Nag?n?pur|नागपूर/i }, // Vidarbha: portal stores 6° west, app shifts it back
};

export class App {
  errors: string[] = [];
  consoleErrors: string[] = [];
  constructor(public page: Page) {
    page.on("pageerror", (e) => this.errors.push(`pageerror: ${e.message.slice(0, 200)}`));
    page.on("console", (m) => {
      if (m.type() === "error" && !IGNORED_ERR.test(m.text())) this.consoleErrors.push(m.text().slice(0, 200));
    });
  }

  async open(url = "/") {
    await this.page.goto(url);
    await this.page.locator("canvas").first().waitFor({ timeout: 60000 });
    await this.page.bringToFront();
    await this.mapReady();
  }

  /** window.__vmMap exists on the dev server only. */
  async mapReady() {
    await this.page.waitForFunction(() => !!(window as any).__vmMap, undefined, { timeout: 30000 });
  }
  evalMap<T, A = undefined>(fn: (map: any, arg: A) => T, arg?: A): Promise<T> {
    return this.page.evaluate(({ f, a }) => new Function("map", "arg", `return (${f})(map, arg)`)((window as any).__vmMap, a), { f: fn.toString(), a: arg }) as Promise<T>;
  }
  zoom = () => this.evalMap((m) => m.getView().getZoom() as number);
  async setView(lon: number, lat: number, zoom: number) {
    await this.evalMap(
      (m, [lo, la, z]: number[]) => {
        const R = 6378137;
        m.getView().setCenter([(lo! * Math.PI * R) / 180, Math.log(Math.tan(((90 + la!) * Math.PI) / 360)) * R]);
        m.getView().setZoom(z!);
      },
      [lon, lat, zoom]
    );
  }
  async renderComplete(timeout = 60000) {
    await this.page.evaluate(
      (to) =>
        new Promise<void>((res, rej) => {
          const m = (window as any).__vmMap;
          const t = setTimeout(() => rej(new Error("rendercomplete timeout")), to);
          m.once("rendercomplete", () => (clearTimeout(t), res()));
          m.render();
        }),
      timeout
    );
  }
  layerByName = (name: string) =>
    this.evalMap((m, n: string) => {
      const l = m.getLayers().getArray().find((x: any) => x.get("name") === n);
      return l ? { visible: l.getVisible(), opacity: l.getOpacity(), features: l.getSource()?.getFeatures?.().length ?? null } : null;
    }, name);

  toolbar(name: Panel): Locator {
    return this.page.getByRole("button", { name: new RegExp(`^${name}$`) }).first();
  }
  async openPanel(name: Panel) {
    await this.toolbar(name).click();
  }

  /** Waits until an <option> matching `re` exists, then selects it. Returns the option text. */
  async pick(select: Locator, re: RegExp, timeout = 60000): Promise<string> {
    await expect.poll(async () => (await select.locator("option").allTextContents()).some((t) => re.test(t)), { timeout, intervals: [200] }).toBe(true);
    const v = await select.evaluate((el, src) => {
      const o = [...(el as HTMLSelectElement).options].find((x) => new RegExp(src[0]!, src[1]).test(x.text))!;
      return [o.value, o.text];
    }, [re.source, re.flags]);
    await select.selectOption(v[0]!);
    return v[1]!;
  }
  selects = () => this.page.locator("select");
  /** Cadastral panel cascade: category, district, taluka, village. */
  async cascade(d: RegExp, t: RegExp, v: RegExp) {
    await this.openPanel("Cadastral");
    const s = this.selects();
    await this.pick(s.nth(1), d);
    await this.pick(s.nth(2), t);
    return this.pick(s.nth(3), v);
  }
  rows = () => this.page.locator("li", { hasText: /^Survey / });
  async rowNumbers(max = 60): Promise<string[]> {
    return this.page.evaluate(
      (n) => [...document.querySelectorAll("li")].map((li) => /^Survey (\S+)/.exec((li.querySelector("span.font-semibold")?.textContent || "").trim())?.[1]).filter(Boolean).slice(0, n) as string[],
      max
    );
  }
  async recordsBanner(): Promise<{ done: number; total: number } | null> {
    const t = await this.page.locator("text=/Records \\d+ \\/ \\d+ loaded/").first().textContent({ timeout: 800 }).catch(() => null);
    const m = t?.match(/(\d+) \/ (\d+)/);
    return m ? { done: +m[1]!, total: +m[2]! } : null;
  }
  async bodyOverflowX() {
    return this.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  }
  assertNoPageErrors() {
    expect(this.errors, "uncaught page errors").toEqual([]);
  }
}

export const test = base.extend<{ app: App }>({
  app: async ({ page }, use, info) => {
    const app = new App(page);
    await app.open();
    await use(app);
    if (app.consoleErrors.length) info.annotations.push({ type: "console-errors", description: [...new Set(app.consoleErrors)].slice(0, 5).join(" | ") });
    app.assertNoPageErrors();
  },
});
