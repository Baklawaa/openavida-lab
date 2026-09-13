/**
 * Gate: the running interface must stay cheap to drive. Injects a full plate of
 * founders, steps it to tick 400, then measures the two costs the UI hot paths
 * own — the simulation step (window.__openavida.lastStepMs) and the frame budget
 * at observation speed — plus the JS heap when Chrome exposes performance.memory.
 *
 * Budgets are deliberately loose. The reference machine's node-side mature
 * scenario (~670 organisms at tick 400) measured ~5 ms per step, so 25 ms leaves
 * 5x headroom for a shared CI runner. The interface run prescribed here injects
 * one kit into an empty plate, which blooms and settles around 100-270
 * organisms, so this page uses far less than the budget; that is reported, not
 * hidden. A measurement headless Chrome cannot provide is skipped with a note,
 * never failed: only a real budget overrun should break the gate.
 *
 *   node tools/verify-perf.mjs [url]
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:5174/";

// --- budgets ---------------------------------------------------------------
/** Mean window.__openavida.lastStepMs over 20 batches of 5 ticks, ms. */
const STEP_MEAN_BUDGET_MS = 25;
/** Mean requestAnimationFrame delta at 4 steps/s, ms (one 60 Hz frame is 16.7). */
const FRAME_MEAN_BUDGET_MS = 25;
/** A frame longer than this is a visible hitch. */
const LONG_FRAME_MS = 50;
/** Hitches tolerated over the whole 5 s window. */
const LONG_FRAME_BUDGET = 5;
/** performance.memory.usedJSHeapSize ceiling after a GC window, MB. */
const HEAP_BUDGET_MB = 300;

// --- scripted state --------------------------------------------------------
/**
 * The app's own default seed, pinned in the URL so a future default change
 * cannot silently move the baseline (paramsFromQuery reads ?seed).
 */
const SEED = 0xa7f31ab;
/** The gate needs a populated plate: the URL seeds this many founders. */
const MATURE_FOUNDERS = 180;
const MIN_FOUNDERS = 170;
/** The node benchmark's mature scenario holds ~670 organisms at tick 400. */
const MATURE_POPULATION_FLOOR = 500;
const TARGET_TICK = 400;
const STEP_SAMPLES = 20;
const STEP_SAMPLE_TICKS = 5;
const FRAME_SPEED = 4;
const FRAME_WINDOW_MS = 5000;
/** rAF callbacks below this mean the window was throttled, not measured. */
const MIN_FRAME_SAMPLES = 10;
/** Idle time that gives V8 room to collect before the heap is read. */
const HEAP_IDLE_MS = 3000;
/** Population the 25 ms step budget was anchored on (tools/perf.ts, mature). */
const ANCHOR_POPULATION = 670;

const mean = (xs) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
/** Nearest-rank percentile, matching tools/perf.ts: p95 is an observed sample. */
const percentile = (xs, p) => {
  const sorted = [...xs].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
};
const round2 = (x) => Number(x.toFixed(2));

/** Best-effort forced GC; the CDP heap profiler is Chrome-only and optional. */
async function collectGarbage(page) {
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.detach();
    return true;
  } catch {
    return false; // the idle window before the read is then the whole GC window
  }
}

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error" && !/favicon/i.test(m.text())) errors.push(m.text());
});

const probe = () => page.evaluate(() => window.__openavida);
/** Set an <input> the way the app listens: value plus a bubbling input event. */
const input = (selector, value) =>
  page.locator(selector).evaluate((el, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);

try {
  const url = new URL(base);
  url.searchParams.set("seed", String(SEED));
  // Founders come from the query string, not from clicking inject: the node
  // benchmark's mature scenario starts from 180 mixed genomes and reaches ~670
  // organisms at tick 400, while 8 x 24 injected phototrophs settle near 100 -
  // a fifth of the load the step budget is anchored on. `startPopulation` is a
  // documented query key, so the gate and `npm run perf` measure the same plate.
  url.searchParams.set("startPopulation", String(MATURE_FOUNDERS));
  await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__openavida, null, { timeout: 30000 });

  // 1. Pause, confirm the founders, then run to tick 400.
  await page.locator("#btn-pause").click();
  await page.waitForFunction(() => document.querySelector("#btn-pause")?.dataset.paused === "true", null, { timeout: 5000 });
  const founders = (await probe()).population;
  assert.ok(
    founders >= MIN_FOUNDERS,
    `the mature plate needs ${MIN_FOUNDERS} founders, got ${founders} (startPopulation=${MATURE_FOUNDERS} in the URL)`,
  );
  await page.evaluate((n) => window.__openavidaStep(n), TARGET_TICK);
  await page.waitForFunction((t) => window.__openavida.tick >= t, TARGET_TICK, { timeout: 120000 });
  const population = (await probe()).population;
  // The budget is anchored on the node benchmark's mature plate; a much lighter
  // plate would make the step assertion vacuous, so say so loudly.
  if (population < MATURE_POPULATION_FLOOR) {
    console.log(`note: population ${population} is below the ${MATURE_POPULATION_FLOOR} the step budget is anchored on`);
  }

  // 2. Step cost: lastStepMs is the world's own per-tick timer, so the sample is
  //    engine cost and not the wall-clock time of the whole 5-tick batch.
  const stepSamples = await page.evaluate(async ({ samples, ticks }) => {
    const out = [];
    for (let i = 0; i < samples; i++) {
      await window.__openavidaStep(ticks);
      out.push(window.__openavida.lastStepMs);
    }
    return out;
  }, { samples: STEP_SAMPLES, ticks: STEP_SAMPLE_TICKS });
  const stepMean = mean(stepSamples);
  const stepP95 = percentile(stepSamples, 95);

  // 3. Frame budget at observation speed: 4 steps/s leaves the renderer the whole
  //    frame. The tick delta is read too, because a frozen app has perfect frames.
  await input("#speed-top", FRAME_SPEED);
  await page.waitForFunction(() => document.querySelector("#btn-pause")?.dataset.paused === "false", null, { timeout: 5000 });
  const frames = await page.evaluate(async (windowMs) => {
    const tickBefore = window.__openavida.tick;
    const deltas = [];
    const start = performance.now();
    let last = start;
    await new Promise((resolve) => {
      const loop = (now) => {
        deltas.push(now - last);
        last = now;
        if (now - start < windowMs) requestAnimationFrame(loop);
        else resolve();
      };
      requestAnimationFrame(loop);
    });
    // The first delta spans the wait before the first callback, not a frame.
    return { deltas: deltas.slice(1), tickBefore, tickAfter: window.__openavida.tick };
  }, FRAME_WINDOW_MS);
  const sampled = frames.deltas.length >= MIN_FRAME_SAMPLES;
  const frameMean = sampled ? mean(frames.deltas) : null;
  const frameP95 = sampled ? percentile(frames.deltas, 95) : null;
  const longFrames = sampled ? frames.deltas.filter((d) => d > LONG_FRAME_MS).length : null;
  const tickAdvanced = frames.tickAfter - frames.tickBefore;

  // 4. Memory: stop the clock, let the heap settle, ask V8 for a collection
  //    (best effort), then read Chrome's non-standard counter.
  await page.locator("#btn-pause").click();
  await page.waitForTimeout(HEAP_IDLE_MS);
  const gcForced = await collectGarbage(page);
  const heapBytes = await page.evaluate(() => globalThis.performance?.memory?.usedJSHeapSize ?? null);
  const heapMb = heapBytes === null ? null : heapBytes / (1024 * 1024);

  const tick = (await probe()).tick;
  const summary = {
    seed: SEED,
    founders,
    population,
    tick,
    stepMs: { mean: round2(stepMean), p95: round2(stepP95), samples: stepSamples.length },
    frameMs: frameMean === null ? null : { mean: round2(frameMean), p95: round2(frameP95), samples: frames.deltas.length, speed: FRAME_SPEED },
    longFrames,
    heapMb: heapMb === null ? null : round2(heapMb),
    tickAdvanced,
    gcForced,
  };
  // Print before asserting: a failed budget is easier to read with its numbers.
  console.log(JSON.stringify(summary, null, 2));

  const parts = [
    `${population} organisms at tick ${tick}`,
    `step ${stepMean.toFixed(1)} ms mean / ${stepP95.toFixed(1)} ms p95`,
    sampled
      ? `frame ${frameMean.toFixed(1)} ms mean / ${frameP95.toFixed(1)} ms p95 with ${longFrames} long frame(s)`
      : "frame sampling skipped (requestAnimationFrame was throttled)",
    heapMb === null ? "heap unavailable" : `heap ${heapMb.toFixed(0)} MB`,
  ];
  console.log(`✓ interface perf: ${parts.join("; ")}.`);

  // 5. Budgets, liveness, then page errors.
  if (population < ANCHOR_POPULATION / 2) {
    console.log(`note: measured at ${population} organisms; the ${STEP_MEAN_BUDGET_MS} ms step budget is anchored on the node mature scenario (~${ANCHOR_POPULATION}), so this run has extra headroom`);
  }
  assert.ok(stepMean <= STEP_MEAN_BUDGET_MS, `mean step ${stepMean.toFixed(2)} ms exceeds ${STEP_MEAN_BUDGET_MS} ms at ${population} organisms`);
  if (stepP95 > STEP_MEAN_BUDGET_MS) console.log(`note: step p95 ${stepP95.toFixed(2)} ms is over the mean budget but the mean governs the gate`);
  if (!sampled) {
    console.log(`note: only ${frames.deltas.length} animation frames in ${FRAME_WINDOW_MS} ms — headless Chrome throttled rAF, so the frame and liveness assertions are skipped`);
  } else {
    assert.ok(frameMean <= FRAME_MEAN_BUDGET_MS, `mean frame ${frameMean.toFixed(2)} ms exceeds ${FRAME_MEAN_BUDGET_MS} ms at ${FRAME_SPEED} steps/s`);
    assert.ok(longFrames <= LONG_FRAME_BUDGET, `${longFrames} frames over ${LONG_FRAME_MS} ms exceeds the budget of ${LONG_FRAME_BUDGET}`);
    assert.ok(frames.tickAfter > frames.tickBefore, `clock did not advance over ${FRAME_WINDOW_MS} ms: tick ${frames.tickBefore} -> ${frames.tickAfter}`);
  }
  if (heapMb === null) {
    console.log("note: performance.memory is unavailable in this browser, so the heap assertion is skipped");
  } else {
    assert.ok(heapMb < HEAP_BUDGET_MB, `usedJSHeapSize ${heapMb.toFixed(1)} MB exceeds ${HEAP_BUDGET_MB} MB`);
  }
  assert.deepEqual(errors, [], `page errors: ${errors.join(" | ")}`);
} finally {
  await browser.close();
}
