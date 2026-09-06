import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

// End-to-end checks against the running app; use the installed Chrome browser.
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
const probe = () => page.evaluate(() => window.__openavida);
const editorValue = () => page.locator('#genome-edit').inputValue(); // synchronous with the editor; the probe refreshes once per frame
const input = (selector, value) => page.locator(selector).evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
const clickWorld = async (x, y) => {
  const box = await page.locator('#gl').boundingBox();
  await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
};
const visible = async selector => assert.ok(await page.locator(selector).isVisible(), `${selector} should be visible`);
const active = async selector => assert.equal(await page.locator(selector).getAttribute('aria-pressed'), 'true', `${selector} should be active`);
mkdirSync('scratch/interface', { recursive: true });
try {
  await page.goto(process.argv[2] || 'http://127.0.0.1:5174');
  await page.waitForFunction(() => window.__openavida);
  await visible('#btn-pause');
  await visible('#empty-world');
  await active('#kit-phototroph');
  await active('#view-A');
  await page.locator('#btn-pause').click();
  await page.waitForTimeout(120); // a step batch may still be in flight in worker mode
  const tick = (await probe()).tick;
  await page.waitForTimeout(650);
  assert.equal((await probe()).tick, tick, 'Pause stops the clock');
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'scratch/interface/desktop-empty.png' });

  // Place using the real pointer, inspect, and edit a copy of its genome.
  await page.locator('#kit-phototroph strong').click();
  await clickWorld(.28, .35);
  assert.equal((await probe()).population, 1);
  assert.equal(await page.locator('#empty-world').isVisible(), false);
  await page.locator('#tool-inspect').click();
  await clickWorld(.28, .35);
  await visible('#panel-analysis');
  assert.ok((await probe()).selectedGenome.length > 10);
  await page.locator('.inspect-detail summary').first().click();
  const genomeBox = await page.locator('#gbrowser').boundingBox();
  assert.ok(genomeBox.width > 200, 'Genome browser sizes when expanded');
  await page.locator('#tab-organisms').click();
  await page.locator('#btn-from-inspect').click();
  const before = (await probe()).editorValue;
  assert.equal(before, (await probe()).selectedGenome, 'Copier la sélection loads the inspected genome');
  await page.locator('#gene-add-resist').click();
  await page.waitForFunction(seq => window.__openavida.editorValue.length > seq.length, before);
  const strength = Number(await page.locator('.gene-chip .mono').first().textContent());
  await page.locator('.gene-chip [data-act="plus"]').first().click();
  assert.equal(Number(await page.locator('.gene-chip .mono').first().textContent()), strength + 1);
  // Strength slider drives the codon count of the real ORF.
  await input('.gene-chip .strength-range >> nth=0', 9);
  await page.locator('.gene-chip .strength-range').first().dispatchEvent('change');
  assert.equal(Number(await page.locator('.gene-chip .mono').first().textContent()), 9);
  // Base-level editing in the strip: select, type, delete, undo.
  const stripBefore = await editorValue();
  await page.locator('#dna-strip .nt[data-i="4"]').click();
  assert.equal(await page.locator('#dna-strip .nt.sel').count(), 1, 'One base selected');
  const other = stripBefore[4] === 'T' ? 'G' : 'T';
  await page.keyboard.press(other);
  assert.equal((await editorValue())[4], other, 'Typing replaces the selected base');
  await page.keyboard.press('Backspace');
  assert.equal((await editorValue()).length, stripBefore.length - 1, 'Backspace deletes the selection');
  await page.locator('#dna-undo').click();
  await page.locator('#dna-undo').click();
  assert.equal(await editorValue(), stripBefore, 'Undo restores the previous sequence');
  await page.locator('#dna-redo').click();
  assert.equal((await editorValue())[4], other, 'Redo re-applies the edit');
  await page.locator('#dna-undo').click();
  // Codon palette inserts after the selection and shows per-codon deltas.
  await page.locator('#dna-palette-trait').selectOption('aggression');
  assert.ok((await page.locator('#dna-palette-codons .codon-chip').count()) >= 4);
  await page.locator('#dna-palette-codons .codon-chip').first().click();
  assert.equal((await editorValue()).length, stripBefore.length + 3, 'Codon inserted');
  assert.match(await page.locator('#dna-sel').textContent(), /Bases \d+–\d+/);
  await page.locator('#dna-undo').click();
  assert.equal(await editorValue(), stripBefore);
  // Minimap segment selects a gene range; phenotype diff shows a change vs the loaded genome.
  await page.locator('#dna-cassette .cas-seg').first().click();
  assert.ok((await page.locator('#dna-strip .nt.sel').count()) >= 6, 'Gene range selected from the minimap');
  assert.ok((await page.locator('#builder-pheno tr.up').count()) >= 1, 'Phenotype delta marks increased traits');
  await page.locator('#dna-advanced summary').click();
  const edited = await page.locator('#genome-edit').inputValue();
  assert.equal(edited, (await probe()).editorValue, 'Raw textarea mirrors the visual editor');
  await page.locator('#btn-apply').click();
  await page.waitForFunction(seq => window.__openavida.selectedGenome === seq, edited);
  assert.equal(await page.locator('#dna-revert').isDisabled(), true, 'Applying resets the reference');
  await page.locator('#tab-analysis').click();
  await visible('#btn-edit-selected');
  await page.locator('#tab-organisms').click();
  await page.locator('#btn-inject').click();
  assert.equal((await probe()).population, 25);

  // Espèces: define a named strain from the editor, inject it, recolor, switch grouping, rename.
  await page.locator('#kit-heterotroph strong').click();
  await page.locator('#tab-species').click();
  await visible('#strain-name');
  await input('#strain-name', 'Sondes');
  await page.locator('#btn-strain-define').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.group-name')].some(el => el.value === 'Sondes'));
  const unplaced = page.locator('.group-card').filter({ has: page.locator('.group-name[value="Sondes"]') });
  assert.match(await unplaced.locator('.group-state').textContent(), /non placée/);
  await unplaced.locator('[data-act="inject"]').click();
  await page.waitForFunction(() => {
    const input = [...document.querySelectorAll('.group-name')].find(el => el.value === 'Sondes');
    return Number(input?.closest('.group-card')?.querySelector('.group-count')?.textContent) > 0;
  });
  await page.locator('#opt-color-strain input').check();
  assert.equal(await page.locator('#opt-color-strain input').isChecked(), true);
  await page.locator('#species-strategies').click();
  await active('#species-strategies');
  await page.locator('#species-strains').click();
  await active('#species-strains');
  const nameInput = page.locator('.group-name[value="Sondes"]');
  await nameInput.fill('Sondes-2');
  await nameInput.press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('.group-name')].some(el => el.value === 'Sondes-2'));
  const popA = (await probe()).population;
  assert.ok(popA > 25, 'Injected strain increases population');

  // Painting a nutrient field updates real sampled values; shortcuts sync UI.
  await page.locator('#tab-environment').click();
  await active('#tool-paint');
  await page.locator('#brush-nutrientBlob').click();
  await active('#brush-nutrientBlob');
  await page.locator('#fm-1').click();
  await clickWorld(.4, .4);
  const box = await page.locator('#gl').boundingBox();
  await page.mouse.move(box.x + box.width * .4 + 1, box.y + box.height * .4);
  const readout = await page.locator('#cell-readout').textContent();
  assert.match(readout, /Nutr\. (?!0\.00)/);
  await page.locator('#gl').click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('3');
  await active('#fm-2');
  assert.match(await page.locator('#field-legend').textContent(), /Toxines/);
  await page.locator('#view-3d').click();
  await page.waitForFunction(() => window.__openavida.surface === '3d');
  await active('#view-3d');
  await page.locator('#tool-inspect').click();
  await active('#view-3d');
  await page.locator('#fm-4').click();
  await active('#fm-4');
  await page.locator('#view-2d').click();
  await active('#view-2d');

  // World switching clears selection. Split actions and metrics target B.
  await page.locator('#view-B').click();
  assert.equal((await probe()).population, 0);
  assert.equal((await probe()).selectedGenome, '');
  await page.locator('#view-split').click();
  await page.locator('#tool-place').click();
  await clickWorld(.72, .38);
  assert.equal((await probe()).world, 'B');
  assert.equal((await probe()).population, 1);
  assert.match(await page.locator('#chart-world').textContent(), /MONDE B/);
  await page.locator('#view-3d').click();
  await active('#view-B');
  await active('#view-3d');
  await page.locator('#view-split').click();
  await active('#view-2d');
  await page.locator('#view-A').click();
  assert.equal((await probe()).population, popA);

  // Snapshot / restore, exports, and invalid imports have visible outcomes.
  await page.locator('#tab-experiment').click();
  await page.locator('#btn-snap').click();
  const snapshotPopulation = (await probe()).population;
  await page.locator('#btn-bottle').click();
  assert.ok((await probe()).population < snapshotPopulation);
  await page.locator('#btn-restore').click();
  assert.equal((await probe()).population, snapshotPopulation);
  await page.locator('#btn-step-once').click();
  await page.waitForFunction(t => window.__openavida.tick === t + 1, tick, { timeout: 5000 }); // async in worker mode
  await page.waitForTimeout(600);
  assert.equal((await probe()).tick, tick + 1, 'Single-step remains paused');
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#btn-json').click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /openavida.*\.json/);
  await download.saveAs('scratch/interface/export.json');
  await page.locator('#btn-bottle').click();
  await page.locator('#import-file').setInputFiles('scratch/interface/export.json');
  await page.waitForFunction(n => window.__openavida.population === n, snapshotPopulation);
  await page.locator('#import-file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('invalid') });
  await page.waitForFunction(() => document.querySelector('#status-line').textContent.includes('Import impossible'));
  assert.equal((await probe()).population, snapshotPopulation);

  // Presets: save, load into the active world, remove until the list is empty.
  while (await page.locator('.preset-row [data-act="remove"]').count()) {
    await page.locator('.preset-row [data-act="remove"]').first().click();
    await page.waitForTimeout(80);
  }
  await input('#preset-name', 'Vérif');
  await page.locator('#btn-preset-save').click();
  await page.waitForSelector('.preset-row');
  await page.locator('.preset-row [data-act="load"]').first().click();
  await page.waitForFunction(n => window.__openavida.population === n, snapshotPopulation);
  await page.locator('.preset-row [data-act="remove"]').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.preset-row').length === 0);

  // Goal run: toxin template, 2 replicates, 60-step budget.
  await page.locator('#goal-example').evaluate(el => { el.value = 'toxin'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await input('#goal-reps', 2);
  await input('#goal-max', 60);
  await page.locator('#btn-goal-run').click();
  await page.waitForFunction(() => document.querySelectorAll('#goal-results tbody tr').length >= 2, null, { timeout: 45000 });
  assert.match(await page.locator('#goal-summary').textContent(), /Réussite/);
  await page.locator('#goal-results [data-open]').first().click();
  await page.waitForFunction(() => window.__openavida.world === 'B');
  // Sorting keeps every replicate and reorders by outcome and speed.
  await page.locator('#goal-sort').selectOption('fail-fast');
  assert.equal(await page.locator('#goal-results tbody tr').count(), 2, 'Sorted table keeps all replicates');
  await page.locator('#goal-sort').selectOption('hit-fast');
  // Replaying a replicate rebuilds its start state in B, paused, with the replicate's seed.
  const replaySeed = Number((await page.locator('#goal-results td.seed').first().textContent()).trim());
  await page.locator('#view-A').click();
  await page.locator('#tab-experiment').click();
  await page.locator('#goal-results [data-replay="0"]').click();
  await page.waitForFunction(() => window.__openavida.world === 'B');
  assert.equal(await page.locator('#replay-seed').inputValue(), String(replaySeed), 'Replay fills the seed field');
  assert.match(await page.locator('#run-state').textContent(), /En cours/, 'Replay starts playing B');
  const replayTick = (await probe()).tick;
  await page.waitForFunction(t => window.__openavida.tick > t, replayTick, { timeout: 10000 });
  await page.locator('#goal-results [data-replay="0"]').click(); // a second replay restarts from the start tick
  await page.waitForFunction(t => window.__openavida.tick <= t + 3, replayTick, { timeout: 5000 });
  await page.locator('#btn-pause').click();
  assert.equal((await probe()).seed, replaySeed, 'World B carries the replicate seed');
  await page.locator('#tab-experiment').click();
  const csvEvent = page.waitForEvent('download');
  await page.locator('#btn-goal-csv').click();
  const csv = await csvEvent;
  assert.match(csv.suggestedFilename(), /\.csv$/);
  // The last run survives a reload: table, sort and replay come back from IndexedDB.
  await page.reload();
  await page.waitForFunction(() => window.__openavida);
  await page.locator('#tab-experiment').click();
  await page.waitForFunction(() => document.querySelectorAll('#goal-results tbody tr').length >= 2, null, { timeout: 15000 });
  assert.match(await page.locator('#goal-table-note').textContent(), /restaurée/, 'Restored run is labelled');
  await page.locator('#goal-results [data-replay="0"]').click();
  await page.waitForFunction(() => window.__openavida.world === 'B');
  assert.equal((await probe()).seed, replaySeed, 'Replay works after a reload');
  await page.locator('#view-A').click();

  // Focus view and keyboard navigation, including the native help dialog.
  await page.locator('#btn-focus').click();
  assert.equal(await page.locator('.side').isVisible(), false);
  await page.keyboard.press('Escape');
  await visible('.side');
  await page.locator('#btn-help').click();
  await visible('#help-dialog');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#help-dialog').isVisible(), false);
  await page.locator('#tab-organisms').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#tab-environment').getAttribute('aria-selected'), 'true');
  await page.locator('#view-3d').click();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'scratch/interface/desktop-3d.png' });
  await page.locator('#view-2d').click();
  await page.locator('#fm-0').click();
  await page.locator('#tab-organisms').click();
  await page.locator('#kit-phototroph strong').click();
  await page.locator('#btn-inject').click(); // world A is empty again after the reload above
  await clickWorld(0.32, 0.22);
  await page.evaluate(() => window.__openavidaMutate?.(90));
  await page.locator('#tab-species').click();
  await page.waitForSelector('button[data-act="mutation"]', { timeout: 8000 });
  await page.locator('button[data-act="mutation"]').first().click();
  await visible('#panel-organisms');
  assert.ok(await page.locator('#dna-strip .nt-diff').count() >= 1, 'Voir la mutation outlines changed bases');
  await page.locator('#tool-inspect').click();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'scratch/interface/desktop-analysis.png' });

  for (const [width, height] of [[1440, 900], [1100, 768], [768, 1024], [390, 844], [360, 800]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(() => ({ body: document.documentElement.scrollWidth > innerWidth, bad: [...document.querySelectorAll('.world-toolbar button, .playback button, .side-tabs button')].filter(el => { const r = el.getBoundingClientRect(); return r.width && (r.left < 0 || r.right > innerWidth + 1); }).map(el => el.id) }));
    assert.equal(overflow.body, false, `${width}px page should not overflow`);
    assert.deepEqual(overflow.bad, [], `${width}px controls stay onscreen`);
    if (width === 390) {
      await page.locator('#tab-organisms').click();
      await page.locator('#dna-builder').evaluate(el => el.open = false);
      await page.locator('#dna-strip-section').evaluate(el => el.open = false);
      await page.locator('#dna-advanced').evaluate(el => el.open = false);
      await page.mouse.move(0, 0);
      await page.waitForTimeout(200);
  await page.screenshot({ path: 'scratch/interface/mobile.png', fullPage: true });
    }
  }
  assert.deepEqual(errors, [], 'No browser runtime errors');
  console.log('Interface verified: placement, inspection, visual DNA editing (genes, strip, palette, undo), painting, 2D/3D, A/B targeting, snapshots, imports/exports, species, presets, goal runs, keyboard, and 5 responsive sizes.');
} finally {
  await browser.close();
}
