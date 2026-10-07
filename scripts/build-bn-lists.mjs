// Snapshots MahaBhuNakasha's district -> taluka -> village lists into public/data/bn/*.json.
// The lists almost never change, but the live portal takes 8-15 s per call and drops connections,
// so the app reads these static files first and only falls back to the portal.
// Resumable: re-run to fetch only what is missing.   Usage: node scripts/build-bn-lists.mjs [R|U ...]
import https from "node:https";
import fs from "node:fs";

const HOST = "mahabhunakasha.mahabhumi.gov.in";
const OUT = new URL("../public/data/bn/", import.meta.url);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cookie = "";
function request(method, path, body, cookieIn) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: HOST,
        path,
        method,
        rejectUnauthorized: false,
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36",
          referer: `https://${HOST}/27/index.html`,
          "x-requested-with": "XMLHttpRequest",
          ...(cookieIn ? { cookie: cookieIn } : {}),
          ...(body ? { "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
      }
    );
    req.setTimeout(60000, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function refreshCookie() {
  let path = "/27/index.html";
  let jar = "";
  for (let i = 0; i < 4; i++) {
    const r = await request("GET", path, null, jar);
    const sc = (r.headers["set-cookie"] || []).map((c) => c.split(";")[0]).join("; ");
    if (sc) jar = sc;
    if (r.status >= 300 && r.status < 400 && r.headers.location) path = new URL(r.headers.location, `https://${HOST}`).pathname;
    else break;
  }
  cookie = jar;
}

async function list(level, codes) {
  let lastErr;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      if (!cookie) await refreshCookie();
      const r = await request("POST", "/rest/VillageMapService/ListsAfterLevelGeoref", `state=27&level=${level}&codes=${codes}&hasmap=true`, cookie);
      if (r.status === 200) {
        const rows = JSON.parse(r.text)?.[0];
        if (Array.isArray(rows)) return rows.map((x) => ({ code: String(x.code).trim(), value: String(x.value).trim(), hasData: x.extraParms?.hasData === true }));
      }
      lastErr = new Error(`HTTP ${r.status}`);
      if (r.status >= 300) cookie = "";
    } catch (e) {
      lastErr = e;
      cookie = "";
    }
    await sleep(1500 * (attempt + 1));
  }
  throw lastErr;
}

// Small worker pool: gentle on the portal.
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

const cats = process.argv.slice(2).length ? process.argv.slice(2) : ["R", "U"];
for (const cat of cats) {
  const distFile = new URL(`${cat}.json`, OUT);
  let districts;
  if (fs.existsSync(distFile)) districts = JSON.parse(fs.readFileSync(distFile, "utf8"));
  else {
    districts = await list(1, `${cat},`);
    fs.writeFileSync(distFile, JSON.stringify(districts));
  }
  console.log(`[${cat}] ${districts.length} districts`);
  await pool(districts, 3, async (d) => {
    const file = new URL(`${cat}-${d.code}.json`, OUT);
    if (fs.existsSync(file)) return;
    try {
      const talukas = await list(2, `${cat},${d.code},`);
      const out = [];
      await pool(talukas, 2, async (t) => {
        const villages = await list(3, `${cat},${d.code},${t.code},`);
        out.push({ ...t, villages });
      });
      out.sort((a, b) => a.code.localeCompare(b.code));
      fs.writeFileSync(file, JSON.stringify(out));
      console.log(`  ${cat}-${d.code} ${d.value}: ${out.length} talukas, ${out.reduce((s, t) => s + t.villages.length, 0)} villages`);
    } catch (e) {
      console.log(`  ${cat}-${d.code} ${d.value}: FAILED (${e.message}) - re-run to retry`);
    }
  });
}
console.log("done");
