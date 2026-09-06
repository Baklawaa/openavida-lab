/** Presentation only: simulation state and event handlers live in app.ts. */
export function icon(name: string): string {
  const paths: Record<string, string> = {
    life: '<circle cx="12" cy="12" r="8"/><circle cx="9" cy="10" r="2"/><path d="m15 8 1 1m-2 7 1-1M7 15h1"/>',
    leaf: '<path d="M20 4C8 2 2 9 6 16s16 0 14-12Z"/><path d="m4 20 11-11M9 15v-4m0 4h4"/>',
    inspect: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5m-14-10h7m-3.5-3.5v7"/>',
    paint: '<path d="m14 3 7 7-10 10H4v-7Z M10 7l7 7M4 20h16"/>',
    chart: '<path d="M4 3v17h17M8 15l4-5 4 2 5-7"/>',
    settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    play: '<path d="m8 4 12 8-12 8Z"/>',
    step: '<path d="m5 5 10 7-10 7ZM19 5v14"/>',
    save: '<path d="M5 3h12l4 4v14H3V3h2Zm2 0v6h10V3M7 21v-8h10v8"/>',
    share: '<path d="M12 16V3m-5 5 5-5 5 5M5 13v7h14v-7"/>',
    expand: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 4 3c-1 .5-1 1-1 2m0 3h.01"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
    shield: '<path d="m12 3 8 3v5c0 6-8 10-8 10S4 17 4 11V6Z M8 12l3 3 5-6"/>',
    hunt: '<path d="m13 2-8 12h7l-1 8 8-12h-7Z"/>',
    mutual: '<circle cx="8" cy="12" r="5"/><circle cx="16" cy="12" r="5"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a5 5 0 0 1 0 10h-3"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a5 5 0 0 0 0 10h3"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    dna: '<path d="M7 3c0 5 10 7 10 12M17 3c0 5-10 7-10 12M7 21c0-3 2-4 5-5M17 21c0-3-2-4-5-5M8 7h8M8 17h8"/>',
    edit: '<path d="M4 20h4l11-11-4-4L4 16v4Z"/><path d="m13 7 4 4"/>',
    warn: '<path d="M12 3 2 21h20L12 3Z"/><path d="M12 10v5m0 3h.01"/>',
    revert: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
    groups: '<circle cx="7" cy="8" r="3"/><circle cx="17" cy="8" r="3"/><circle cx="12" cy="16" r="3"/><path d="M9.5 9.5 11 13m3.5-3.5L13 13"/>',
  };
  return `<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.life}</svg>`;
}

export const KIT_COPY: Record<string, { label: string; short: string; description: string; icon: string }> = {
  phototroph: { label: "Phototrophe", short: "photo ×6 · size ×2 · resist ×1", description: "Gain d’énergie proportionnel au champ lumineux local. Dépend de la lumière, pas des nutriments.", icon: "sun" },
  heterotroph: { label: "Hétérotrophe", short: "uptake ×6 · motility ×3 · fecundity ×2", description: "Prélève le nutriment local. Sans apport de nutriments, la population s’effondre.", icon: "leaf" },
  resistant: { label: "Résistant", short: "resist ×5 · uptake ×3 · tpref ×2", description: "Ignore une fraction des dommages des toxines. Témoin utile face aux sources toxiques.", icon: "shield" },
  predator: { label: "Prédateur", short: "aggression ×5 · motility ×3 · uptake ×2", description: "Prélève l’énergie des voisins plus faibles. Requiert une population établie.", icon: "hunt" },
  mutualist: { label: "Mutualiste", short: "signal ×2 · uptake ×3 · photo ×2", description: "Partage de l’énergie entre voisins sur le même canal de signal.", icon: "mutual" },
};

export function createLabLayout(root: HTMLElement) {
  root.innerHTML = `
    <header class="top">
      <a class="brand" href="#" aria-label="OpenAvida Lab">${icon("life")}<span>OpenAvida<span class="brand-lab">LAB</span></span></a>
      <span class="header-divider"></span><span class="header-subtitle">Évolution artificielle · génome explicite · plaque 128 × 128</span>
      <div class="spacer"></div>
      <button id="btn-help" class="icon-button" aria-label="Guide et raccourcis">${icon("help")}</button>
      <button id="btn-share" class="quiet">${icon("share")}<span>Partager</span></button>
      <button id="btn-json">${icon("save")}<span>Exporter le monde</span></button>
    </header>
    <main class="workspace" aria-label="Simulation">
      <section class="metrics" aria-label="Indicateurs du monde actif">
        <div class="metric"><span>Population</span><b id="m-pop">0</b><small>organismes</small></div>
        <div class="metric"><span>Lignées</span><b id="m-lin">0</b><small>vivantes</small></div>
        <div class="metric violet"><span>Diversité</span><b id="m-h">0.000</b><small>Shannon H′</small></div>
        <div class="metric amber"><span>Fitness</span><b id="m-fit">0.000</b><small>moyenne</small></div>
      </section>
      <section class="world-panel" aria-label="Monde simulé">
        <div class="world-toolbar">
          <div class="segmented world-switch" aria-label="Choisir le monde">
            <button id="view-A" data-view="A" class="view active" aria-pressed="true">Monde A</button>
            <button id="view-B" data-view="B" class="view" aria-pressed="false">Monde B</button>
            <button id="view-split" data-view="split" class="view" aria-pressed="false">A / B</button>
          </div>
          <span id="world-size" class="tiny world-size">128 × 128</span>
          <div class="segmented field-toolbar" role="group" aria-label="Couche affichée">
            <button id="fm-0" data-fm="0" class="fm active" aria-pressed="true">Ensemble</button>
            <button id="fm-1" data-fm="1" class="fm" aria-pressed="false"><i class="dot nutrient"></i><span>Nutriments</span></button>
            <button id="fm-2" data-fm="2" class="fm" aria-pressed="false"><i class="dot toxin"></i><span>Toxines</span></button>
            <button id="fm-3" data-fm="3" class="fm" aria-pressed="false"><i class="dot temperature"></i><span>Température</span></button>
            <button id="fm-4" data-fm="4" class="fm" aria-pressed="false"><i class="dot light"></i><span>Lumière</span></button>
          </div>
          <div class="spacer"></div>
          <span id="run-state" class="run-state"><i></i> En cours</span>
          <div class="segmented"><button id="view-2d" class="active" aria-pressed="true">2D</button><button id="view-3d" aria-pressed="false">3D</button></div>
          <button id="btn-focus" class="icon-button" aria-label="Agrandir la visualisation" aria-pressed="false">${icon("expand")}</button>
        </div>
        <div class="stage">
          <div class="viz"><canvas id="gl" aria-label="Monde en deux dimensions : cliquez pour utiliser l’outil sélectionné"></canvas><canvas id="gl3d" aria-label="Monde en trois dimensions : glissez pour tourner, molette pour zoomer"></canvas><div id="mp-cursors"></div></div>
          <div class="stage-label" id="stage-label">MONDE A</div><div class="stage-label stage-label-b" id="stage-label-b" hidden>MONDE B</div>
          <div class="empty-world" id="empty-world"><span class="empty-icon">${icon("life")}</span><div><h2>Monde vide</h2><p>Kit sélectionné + clic sur une cellule libre, ou injection aléatoire.</p></div><button id="btn-start" class="primary">${icon("plus")}Injecter 24 organismes</button></div>
          <div class="viz-hud" role="group" aria-label="Outils du monde">
            <button id="tool-inspect" aria-pressed="false">${icon("inspect")}<span>Inspecter</span><kbd>I</kbd></button>
            <button id="tool-place" class="active" aria-pressed="true">${icon("plus")}<span>Placer</span><kbd>O</kbd></button>
            <button id="tool-paint" aria-pressed="false">${icon("paint")}<span>Peindre</span><kbd>P</kbd></button>
          </div>
          <span id="field-legend" class="field-legend"><i class="dot nutrient"></i>Nutriments <i class="dot toxin"></i>Toxines <i class="dot light"></i>Lumière</span>
          <div id="cell-readout" class="cell-readout" hidden></div>
        </div>
        <div class="playback">
          <button id="btn-pause" class="primary">${icon("pause")}<span>Pause</span></button>
          <button id="btn-step-once" class="icon-button" aria-label="Avancer d’un pas">${icon("step")}</button>
          <span class="tick-counter">PAS <b id="m-tick">0</b></span>
          <span id="view-hint" class="view-hint">Clic sur une cellule libre : place un organisme.</span>
          <div class="speed-ctl"><label for="speed-top">Vitesse</label><input id="speed-top" type="range" min="0" max="60" step="1" value="2"><b id="spd-lab-top">2 /s</b><button id="btn-slow" class="quiet">×1</button></div>
          <div class="zoom-ctl"><label for="zoom-top">Vue</label><input id="zoom-top" type="range" min="30" max="100" step="1" value="100"><b id="zoom-lab-top">100%</b></div>
        </div>
      </section>
      <section class="charts-section" aria-label="Évolution dans le temps">
        <div class="section-heading"><h2>Séries temporelles</h2><span id="chart-world" class="tiny">MONDE A · HISTORIQUE</span><button id="btn-charts" class="quiet" aria-expanded="true">Réduire</button></div>
        <div class="charts">
          <article class="chart-card"><div class="chart-heading"><h3>Fitness</h3><span><i class="dot nutrient"></i>Moy. <i class="dot light"></i>Max.</span></div><canvas id="chart-fit" role="img" aria-label="Évolution de la fitness moyenne et maximale"></canvas></article>
          <article class="chart-card"><div class="chart-heading"><h3>Diversité</h3><span><i class="dot diversity"></i>Shannon H′</span></div><canvas id="chart-shan" role="img" aria-label="Évolution de l’indice de diversité de Shannon"></canvas></article>
          <article class="chart-card"><div class="chart-heading"><h3>Arbre des lignées</h3><span>Ascendance</span></div><canvas id="chart-phy" role="img" aria-label="Arbre des lignées au fil du temps"></canvas></article>
        </div>
      </section>
    </main>
    <aside class="side" aria-label="Outils du laboratoire">
      <div class="side-tabs" role="tablist" aria-label="Espaces de travail">
        <button id="tab-organisms" data-panel="organisms" role="tab" aria-controls="panel-organisms" aria-selected="true" class="active">${icon("life")}Organismes</button>
        <button id="tab-environment" data-panel="environment" role="tab" aria-controls="panel-environment" aria-selected="false" tabindex="-1">${icon("paint")}Milieu</button>
        <button id="tab-analysis" data-panel="analysis" role="tab" aria-controls="panel-analysis" aria-selected="false" tabindex="-1">${icon("chart")}Analyse</button>
        <button id="tab-species" data-panel="species" role="tab" aria-controls="panel-species" aria-selected="false" tabindex="-1">${icon("groups")}Espèces</button>
        <button id="tab-experiment" data-panel="experiment" role="tab" aria-controls="panel-experiment" aria-selected="false" tabindex="-1">${icon("settings")}Expérience</button>
      </div>
      <div class="side-scroll">
        <div id="panel-organisms" role="tabpanel" aria-labelledby="tab-organisms">
          <section class="block"><div class="section-heading"><h2>Kits de départ</h2><span class="tag">5 GÉNOMES</span></div><p class="muted" id="place-hint">Sélectionnez un kit, puis cliquez dans le monde.</p><div id="dna-kits" class="kit-grid"></div>
            <div class="kit-description"><span class="eyebrow">KIT SÉLECTIONNÉ</span><p id="kit-blurb"></p><div id="kit-traits" class="kit-focus"></div></div>
            <button id="btn-inject" class="primary full">${icon("plus")}Injecter 24 organismes</button>
          </section>
          <section class="block dna-editor" id="dna-editor" aria-label="Éditeur d’ADN"></section>
        </div>
        <div id="panel-environment" role="tabpanel" aria-labelledby="tab-environment" hidden>
          <section class="block"><div class="section-heading"><h2>Champs et terrain</h2><span class="tag">PINCEAU</span></div><p class="muted">Cliquez ou glissez dans le monde. En 3D, un clic par touche.</p><div class="brush-grid" id="brushes"></div><div class="range-label"><label for="radius">Rayon du pinceau</label><span><b id="rad-lab">3</b> cellules</span></div><input id="radius" type="range" min="0" max="12" value="3"></section>
          <section class="block"><h2>Dynamique du milieu</h2><label class="toggle-row" id="opt-terrain"><span>Relief aléatoire<small>Sources, obstacles et zones d’ombre</small></span><input type="checkbox"></label><label class="toggle-row" id="opt-disturb"><span>Événements aléatoires<small>Perturbations au cours de l’expérience</small></span><input type="checkbox"></label></section>
          <section class="block info-note">${icon("sun")}<p>Diffusion à 4 voisins à chaque pas, bloquée par les obstacles. Une source émet en continu ; une touche de pinceau est ponctuelle.</p></section>
        </div>
        <div id="panel-analysis" role="tabpanel" aria-labelledby="tab-analysis" hidden>
          <section class="block"><div class="section-heading"><h2>Organisme sélectionné</h2><span class="tag" id="selection-tag">AUCUN</span></div><div id="inspect-meta" class="muted">Outil Inspecter, puis clic sur un organisme.</div><div id="inspect-phenotype"></div><div class="row inspect-actions" id="inspect-actions" hidden><button id="btn-edit-selected">${icon("dna")}<span>Modifier cet ADN</span></button></div><details class="inspect-detail"><summary>Génome et gènes</summary><div id="inspect-genome"></div><div id="browser-wrap"><canvas id="gbrowser"></canvas></div><div id="inspect-genes"></div></details><details class="inspect-detail"><summary>Métabolisme et comportement</summary><div id="inspect-pathways"></div><div id="inspect-brain"></div></details></section>
          <section class="block"><h2>Classement par fitness</h2><div id="leaderboard" class="feed"></div></section>
          <section class="block"><h2>Journal des décès</h2><div id="death-tally" class="death-tally"></div><div id="death-log" class="feed"></div></section>
          <section class="block"><details><summary>Table codon → trait</summary><p class="muted">ORF = ATG … TAA/TAG/TGA, lecture dans tous les cadres. phénotype[trait] = squash(basal + Σ deltas). La couleur n’entre pas dans la fitness.</p><div class="mapping-legend" id="legend"></div></details></section>
        </div>
        <div id="panel-species" role="tabpanel" aria-labelledby="tab-species" hidden></div>
        <div id="panel-experiment" role="tabpanel" aria-labelledby="tab-experiment" hidden>
          <div id="panel-goals"></div>
          <section class="block"><h2>Points de restauration</h2><p class="muted">État complet du monde actif : organismes, champs, lignées, historique.</p><div class="row"><button id="btn-snap">${icon("save")}Mémoriser</button><button id="btn-restore" disabled>Restaurer</button></div><p id="snapshot-info" class="micro">Aucun état mémorisé dans cette session.</p></section>
          <section class="block"><h2>Mondes A et B</h2><p class="muted">Mêmes paramètres, graines différentes. Sélecteur A / B au-dessus du monde.</p><div class="row"><button id="btn-step-a">+1 pas A</button><button id="btn-step-b">+1 pas B</button><button id="btn-step-both">+1 pas A et B</button></div></section>
          <section class="block"><h2>Nouvelle expérience</h2><label class="tiny" for="seed">Graine aléatoire</label><div class="row"><input id="seed" type="number"><button id="btn-reseed">Réinitialiser A et B</button></div><p class="micro">Remplace A et B par deux mondes vides.</p><button id="btn-bottle" class="danger">Goulot d’étranglement : garder 10 %</button></section>
          <section class="block"><h2>Données de l’expérience</h2><div class="row"><button id="btn-csv">Métriques CSV</button><button id="btn-phylo">Lignées CSV</button><button id="btn-import">Importer un monde JSON</button></div><input id="import-file" type="file" accept="application/json,.json" hidden></section>
          <section class="block"><details><summary>Fonctions expérimentales</summary><label class="toggle-row" id="opt-view3d"><span>Visualisation 3D</span><input type="checkbox"></label><label class="toggle-row" id="opt-brains"><span>Comportements<small>Politique de décision intégrée</small></span><input type="checkbox"></label><label class="toggle-row" id="opt-llm"><span>Adaptateur LLM<small>Politique intégrée si aucun adaptateur</small></span><input type="checkbox"></label><label class="toggle-row" id="opt-mp"><span>Session partagée<small>Entre les onglets de ce navigateur</small></span><input type="checkbox"></label><div id="mp-panel" class="stack"><label for="mp-room">Salon</label><input id="mp-room" type="text" value="lab"><label for="mp-role">Rôle</label><select id="mp-role"><option value="host">Hôte</option><option value="experimenter">Expérimentateur</option><option value="spectator">Observateur</option></select><div class="row"><button id="btn-mp-host">Créer un salon</button><button id="btn-mp-join">Rejoindre</button></div><div id="mp-peers" class="muted"></div></div></details></section>
          <section class="block diagnostics"><span>Fixation <b id="m-fix">—</b></span><span>Extinctions <b id="m-ex">0</b></span><span>Calcul / pas <b id="m-ms">—</b></span></section>
        </div>
      </div>
    </aside>
    <footer class="status-bar"><span id="status-line" role="status" aria-live="polite">Prêt.</span><span id="m-seed" class="mono"></span><span class="keyboard-hint"><kbd>Espace</kbd> pause / lecture</span></footer>
    <dialog id="help-dialog"><form method="dialog"><button class="close-dialog" aria-label="Fermer le guide">×</button></form><span class="eyebrow">GUIDE</span><h2>Protocole de base</h2><ol><li><b>Population.</b> Kit ou génome édité, placé cellule par cellule ou injecté (24 organismes).</li><li><b>Milieu.</b> Champs de nutriments, toxines, température et lumière ; sources, obstacles, ombre.</li><li><b>Mesures.</b> Inspection d’un organisme (génome, phénotype, métabolisme), fitness, diversité de Shannon, lignées.</li></ol><div class="shortcut-grid"><span><kbd>Espace</kbd> Pause / lecture</span><span><kbd>I</kbd> Inspecter</span><span><kbd>O</kbd> Placer</span><span><kbd>P</kbd> Peindre</span><span><kbd>1–5</kbd> Couches du milieu</span><span><kbd>S</kbd> Mémoriser</span></div><p class="muted">3D : glisser pour tourner, molette pour zoomer. A / B affiche deux mondes en 2D ; les indicateurs suivent le dernier monde cliqué.</p></dialog>
  `;
  const get = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  root.querySelectorAll<HTMLButtonElement>("button:not([type])").forEach(b => b.type = b.closest("form") ? "submit" : "button");
  return {
    header: get<HTMLElement>(".top"), viz: get<HTMLDivElement>(".viz"), stage: get<HTMLDivElement>(".stage"),
    canvas: get<HTMLCanvasElement>("#gl"), canvas3d: get<HTMLCanvasElement>("#gl3d"),
    hud: get<HTMLDivElement>(".viz-hud"), cursors: get<HTMLDivElement>("#mp-cursors"), side: get<HTMLElement>(".side"),
    charts: get<HTMLDivElement>(".charts"), cFit: get<HTMLCanvasElement>("#chart-fit"), cShan: get<HTMLCanvasElement>("#chart-shan"), cPhy: get<HTMLCanvasElement>("#chart-phy"),
  };
}
