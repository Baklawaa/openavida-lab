import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, "..");
const scratch = process.env.OPENAVIDA_SCRATCH || resolve(root, "scratch");
mkdirSync(scratch, { recursive: true });

const url = process.argv[2] || "http://127.0.0.1:4174/";
const shot1 = process.argv[3] || resolve(scratch, "lab-1.png");
const shot2 = process.argv[4] || resolve(scratch, "lab-2.png");

function log(...a) {
  console.log(...a);
}

async function probe(page, label) {
  const errors = [];
  const ignore = (s) => /favicon|fonts\.google|Failed to load resource: .*favicon/i.test(s);
  page.on("pageerror", (e) => {
    const t = String(e);
    if (!ignore(t)) errors.push(t);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const t = msg.text();
      if (!ignore(t)) errors.push(t);
    }
  });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  // 60 s, not 20: a GitHub-hosted runner boots the bundle and the worker an
  // order of magnitude slower than a laptop, and this probe only has to know
  // that the page came up. A fast machine returns immediately either way.
  await page.waitForSelector("#gl", { state: "attached", timeout: 60000 });
  await page.waitForFunction(() => window.__openavida && window.__openavida.population >= 0, null, {
    timeout: 60000,
  });
  if (/view3d=1/.test(url) || (await page.evaluate(() => window.__openavida?.surface === "3d"))) {
    await page.waitForSelector("#gl3d.on", { timeout: 20000 });
  }
  await page.waitForTimeout(400);
  const pop0 = await page.evaluate(() => window.__openavida?.population ?? -1);
  await page.locator("#btn-pause").click();
  await page.waitForTimeout(150);

  const hover = {};
  for (const id of ["btn-pause", "tool-place"]) {
    await page.locator("#" + id).hover();
    await page.waitForTimeout(80);
    hover[id] = await page.evaluate((cid) => {
      const el = document.getElementById(cid);
      const tip = document.getElementById("hover-tip");
      const catalog = window.__openavidaHelp?.[cid] ?? "";
      return {
        title: el?.getAttribute("title") ?? "",
        tip: tip?.textContent ?? "",
        tipVisible: tip ? !tip.hidden : false,
        catalog,
        titleMatches: (el?.getAttribute("title") ?? "") === catalog && catalog.length > 12,
      };
    }, id);
  }

  const before = await page.evaluate(() => {
    const g = document.getElementById("inspect-genome")?.textContent ?? "";
    const p = document.getElementById("inspect-phenotype")?.textContent ?? "";
    return { g, p, probe: window.__openavida };
  });

  const pixel = await page.evaluate(() => {
    const c3 = document.getElementById("gl3d");
    const c = c3 && c3.classList.contains("on") ? c3 : document.getElementById("gl");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return { error: "no webgl", filled: 0, bbox: 0 };
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let painted = 0;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const r = buf[i], g = buf[i + 1], b = buf[i + 2];
        if (r + g + b > 12) {
          painted++;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    const bbox = painted ? ((maxX - minX + 1) * (maxY - minY + 1)) / (w * h) : 0;
    return {
      w,
      h,
      canvasW: c.width,
      canvasH: c.height,
      painted,
      frac: painted / (w * h),
      bbox,
      renderer: gl.getParameter(gl.RENDERER),
    };
  });

  const placed = await page.evaluate(() => window.__openavidaPlaceAt?.(40, 48) === true);
  await page.waitForFunction(() => (window.__openavida?.population ?? 0) >= 1, null, { timeout: 8000 });

  const org = await page.evaluate(() => {
    const pick = window.__openavidaOrgPixel;
    const c3 = document.getElementById("gl3d");
    const c = c3 && c3.classList.contains("on") ? c3 : document.getElementById("gl");
    if (!pick || !c) return null;
    const box = c.getBoundingClientRect();
    let best = null;
    let bestD = 1e9;
    for (let i = 0; i < 240; i++) {
      const p = pick(i);
      if (!p) continue;
      if (p.x < box.left + 10 || p.y < box.top + 40 || p.x > box.right - 10 || p.y > box.bottom - 10) continue;
      const dx = p.x - (box.left + box.width * 0.5);
      const dy = p.y - (box.top + box.height * 0.5);
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  });
  if (org) {
    await page.mouse.click(org.x, org.y);
  } else {
    const vis = (await page.locator("#gl3d.on").count()) ? "#gl3d" : "#gl";
    const box = await page.locator(vis).boundingBox();
    if (box) await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  }
  await page.waitForFunction(
    () => (document.getElementById("inspect-genome")?.textContent?.trim().length ?? 0) > 8,
    null,
    { timeout: 8000 },
  );

  const editor = await page.evaluate(async () => {
    const ta = document.getElementById("genome-edit");
    if (!(ta instanceof HTMLTextAreaElement)) return { ok: false, reason: "no textarea" };
    const original = ta.value;
    const marker = "ACGTACGT";
    ta.value = original + marker;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    const afterRaf = ta.value;
    const point = document.getElementById("btn-point");
    point?.click();
    await new Promise((r) => setTimeout(r, 400));
    const afterPoint = ta.value;
    const load = document.getElementById("btn-load-founder");
    load?.click();
    await new Promise((r) => setTimeout(r, 400));
    const afterFounder = ta.value;
    const apply = document.getElementById("btn-apply");
    apply?.click();
    await new Promise((r) => setTimeout(r, 200));
    const inspect = document.getElementById("inspect-genome")?.textContent ?? "";
    return {
      ok: true,
      original,
      afterRaf,
      afterPoint,
      afterFounder,
      inspect,
      wipedByRaf: afterRaf !== original + marker,
      pointStuck: afterPoint !== original && afterPoint !== original + marker,
      founderStuck: afterFounder.length > 8 && afterFounder !== original,
    };
  });

  const after = await page.evaluate(() => {
    const g = document.getElementById("inspect-genome")?.textContent ?? "";
    const p = document.getElementById("inspect-phenotype")?.textContent ?? "";
    return { g, p, probe: window.__openavida };
  });

  return { label, errors, before, after, pixel, org, editor, hover, pop0, placed };
}

// Metal is macOS-only: forcing it on a Linux runner fails WebGL init, the app
// never publishes its probe and every wait here times out (that is exactly how
// the first two CI runs failed). Pick the backend the platform can actually do.
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  // Nothing on Linux: Chrome there has no GPU and picks its own software
  // fallback, which is exactly what the other ten gates rely on. Forcing any
  // --use-gl backend made the page fail to boot on the runner.
  args: process.platform === "darwin" ? ["--use-gl=angle", "--use-angle=metal"] : [],
});

const results = [];
try {
  const page1 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const r1 = await probe(page1, "launch-1");
  await page1.screenshot({ path: shot1, fullPage: true });
  results.push(r1);
  await page1.close();

  const page2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const r2 = await probe(page2, "launch-2");
  await page2.screenshot({ path: shot2, fullPage: true });
  results.push(r2);
  await page2.close();
} finally {
  await browser.close();
}

const summary = {
  url,
  shot1,
  shot2,
  results: results.map((r) => ({
    label: r.label,
    errors: r.errors,
    pixel: r.pixel,
    inspectBefore: { genomeLen: r.before.g.length, phenoLen: r.before.p.length },
    inspectAfter: { genomeLen: r.after.g.length, phenoLen: r.after.p.length, genome: r.after.g.slice(0, 80) },
    editor: r.editor,
    hover: r.hover,
    pop0: r.pop0,
    placed: r.placed,
    probe: r.after.probe,
  })),
};
writeFileSync(resolve(scratch, "launch.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

const ok = results.every((r) => {
  const three = r.after.probe?.surface === "3d";
  const pixels = three
    ? r.pixel.painted > 2000 && r.pixel.frac > 0.02
    : r.pixel.frac > 0.5 && r.pixel.bbox > 0.8;
  return (
    r.errors.length === 0 &&
    pixels &&
    r.pixel.w === r.pixel.canvasW &&
    r.after.g.length > 0 &&
    r.after.p.length > 0 &&
    r.editor?.ok === true &&
    r.editor.wipedByRaf === false &&
    r.editor.pointStuck === true &&
    r.hover?.["btn-pause"]?.titleMatches === true &&
    r.hover?.["tool-place"]?.titleMatches === true &&
    r.pop0 === 0 &&
    r.placed === true &&
    (!three || r.after.probe?.view3d === true)
  );
});
process.exit(ok ? 0 : 2);
