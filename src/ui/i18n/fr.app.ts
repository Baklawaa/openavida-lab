/**
 * French copy for the application wiring (src/app.ts): status-line messages,
 * panel feeds, the inspect panel, the starter-kit readout, the schedule list
 * and the tool hints.
 *
 * Every string here used to be a literal in src/app.ts; the module now reads
 * them through tDynamic (see src/ui/i18n/runtime.ts).
 */
export const APP_FR = {
  /* focus and kits ----------------------------------------------------------- */
  "app.focus.restore": "Rétablir l’interface complète",
  "app.focus.enlarge": "Agrandir la visualisation",
  "app.kit.traits": "Lumière {light} · Nutrition {uptake} · Résist. {resist}",
  "app.view.hint3d": "Glisser : tourner · Molette : zoomer · Clic : outil actif",

  /* shared session ----------------------------------------------------------- */
  "app.mp.enable": "Activez la session partagée pour ouvrir un salon.",

  /* DNA editor --------------------------------------------------------------- */
  "app.dna.selectFirst": "Sélectionnez d’abord un organisme avec Inspecter, ou placez-en un avec ce génome.",
  "app.dna.applied": "Génome appliqué à la sélection : nouvelle lignée créée.",
  "app.dna.placeHint": "Cliquez dans le monde pour placer un organisme avec ce génome.",
  "app.dna.envCell": "Environnement de la cellule ({x}, {y})",
  "app.dna.envCenter": "Environnement du centre ({x}, {y})",

  /* recipe ------------------------------------------------------------------- */
  "app.recipe.loaded.one": "Recette chargée : {count} action.",
  "app.recipe.loaded.many": "Recette chargée : {count} actions.",

  /* species and strains ------------------------------------------------------ */
  "app.strain.genomeLoaded": "Génome de « {label} » chargé. Cliquez sur une cellule libre pour le placer.",
  "app.inject.count": "{n} organismes injectés dans le monde {world}.",
  "app.strain.colorStrain": "Couleur des organismes : souche fondatrice.",
  "app.strain.colorGuild": "Couleur des organismes : guilde et lignée.",
  "app.strain.heatOff": "Carte de présence masquée.",
  "app.strain.heatOn": "Carte de présence : souche {id}.",
  "app.mutation.missing": "Séquence de la mutation absente (instantané ancien).",
  "app.mutation.loaded": "Mutation au pas {tick} · {kind} · génome comparé au parent.",

  /* explorer ----------------------------------------------------------------- */
  "app.explorer.genomeCompared": "Génome de {label} chargé, comparé à la référence.",
  "app.explorer.genomeLoaded": "Génome de {label} chargé dans l’éditeur.",

  /* leaderboard -------------------------------------------------------------- */
  "app.leaderboard.empty": "<p class=\"muted\">Aucun organisme vivant.</p>",
  "app.leaderboard.head": "Fitness {fitness} · Énergie {energy}",
  "app.leaderboard.traits": "Lignée {lineage} · Lumière {light} · Nutrition {uptake}",
  "app.leaderboard.useDna": "Modifier cet ADN",

  /* events feed -------------------------------------------------------------- */
  "app.events.empty": "<p class=\"muted\">Aucun événement pour le moment.</p>",
  "app.events.tick": "Pas {tick}",

  /* death log ---------------------------------------------------------------- */
  "app.deaths.tally": "{label} : {count}",
  "app.deaths.none": "<span class=\"muted\">Aucun décès pour le moment</span>",
  "app.deaths.empty": "<p class=\"muted\">Aucun décès enregistré.</p>",
  "app.deaths.row": "Pas {tick} · N° {org} · Lignée {lineage} · Fitness {fitness}",

  /* tool hints --------------------------------------------------------------- */
  "app.hint.place": "Clic sur une cellule libre : place un organisme avec le génome de l’éditeur.",
  "app.hint.paint": "Clic ou glisser : applique le pinceau sélectionné.",
  "app.hint.inspect": "Clic sur un organisme : génome, phénotype, métabolisme.",

  /* inspect panel ------------------------------------------------------------ */
  "app.inspect.none": "AUCUN",
  "app.inspect.clickOrganism": "Cliquez sur un organisme dans le monde.",
  "app.inspect.number": "N° {id}",
  "app.inspect.energy": "Énergie<b>{value}</b>",
  "app.inspect.fitness": "Fitness<b>{value}</b>",
  "app.inspect.identity": "Lignée {lineage} · Position ({x}, {y}) · Parent {parent}",
  "app.inspect.founder": "fondateur",
  "app.inspect.body": "Corpulence {mass} % · Taille effective {size} (génome {genome}) · Âge {age}",
  "app.inspect.dead": "Cet organisme n’est plus vivant. Consultez le journal des décès ci-dessous.",
  "app.inspect.gone": "Cet organisme n’est plus vivant.",
  "app.inspect.selectFirst": "Sélectionnez d’abord un organisme.",

  /* charts and stage --------------------------------------------------------- */
  "app.chart.lineageTitle": "Lignée n° {id} · née au pas {born} · {count} vivants (max {peak})",
  "app.charts.show": "Afficher",
  "app.charts.hide": "Réduire",
  "app.charts.world": "MONDE {world} · HISTORIQUE",
  "app.stage.side": "{side} · {count} organismes{selected}",
  "app.stage.selected": " · sélectionné",
  "app.stage.world": "MONDE {world}",

  /* world editing ------------------------------------------------------------ */
  "app.place.done": "Organisme placé en ({x}, {y}).",
  "app.place.blocked": "Cette cellule est bloquée par un obstacle.",
  "app.readout.cell": "({x}, {y}) · Nutr. {nutrient} · Tox. {toxin} · Temp. {temperature} · Lum. {light} · Exs. {exudate}",

  /* playback ----------------------------------------------------------------- */
  "app.playback.resumeAria": "Reprendre la simulation",
  "app.playback.pauseAria": "Mettre en pause",
  "app.playback.followed": "Session suivie",
  "app.playback.paused": "En pause",
  "app.playback.running": "En cours",

  /* timeline ----------------------------------------------------------------- */
  "app.timeline.label": "pas {tick} (enregistré toutes les {every})",
  "app.timeline.kb": "{kb} ko",
  "app.timeline.mb": "{mb} Mo",
  "app.timeline.budget.one": "{count} instantané · {size} / {cap} Mo",
  "app.timeline.budget.many": "{count} instantanés · {size} / {cap} Mo",
  "app.timeline.none": "Aucun instantané à cet endroit.",
  "app.timeline.resumed": "Monde {world} repris au pas {tick}.",

  /* environment switches ----------------------------------------------------- */
  "app.terrain.on": "Relief aléatoire : sources, obstacles et ombre ajoutés.",
  "app.terrain.off": "Relief prédéfini retiré.",
  "app.disturb.on": "Perturbations aléatoires activées.",
  "app.disturb.off": "Perturbations aléatoires désactivées.",

  /* schedule ----------------------------------------------------------------- */
  "app.schedule.scale": "× {k} sur {field}",
  "app.schedule.params": "paramètres",
  "app.schedule.paint": "touche {brush} r={radius}",
  "app.schedule.inject": "injecter {count}",
  "app.schedule.place": "placer ({x},{y})",
  "app.schedule.strain": "souche {name}",
  "app.schedule.empty": "<p class=\"muted\">Aucune entrée.</p>",
  "app.schedule.step": "pas {tick}",
  "app.schedule.remove": "Retirer",
  "app.schedule.incomplete": "Programme incomplet.",
  "app.schedule.added": "Programme : {op} au pas {tick}.",

  /* field legend ------------------------------------------------------------- */
  "app.legend.all": "<i class=\"dot nutrient\"></i>Nutriments <i class=\"dot toxin\"></i>Toxines <i class=\"dot light\"></i>Lumière",
  "app.legend.nutrient": "Nutriments <span class=\"legend-scale nutrient-scale\"></span> faible → élevé",
  "app.legend.toxin": "Toxines <span class=\"legend-scale toxin-scale\"></span> faible → élevé",
  "app.legend.temperature": "Température <span class=\"legend-scale temperature-scale\"></span> froid → chaud",
  "app.legend.light": "Lumière <span class=\"legend-scale light-scale\"></span> faible → élevée",
  "app.legend.exudate": "Exsudat <span class=\"legend-scale\"></span> faible → élevé",

  /* world state -------------------------------------------------------------- */
  "app.snapshot.info": "Monde {world} · pas {tick} · {count} organismes",
  "app.snapshot.saved": "État mémorisé. Vous pouvez le restaurer depuis Expérience.",
  "app.snapshot.restored": "Monde restauré au pas {tick}.",
  "app.bottleneck.done": "Goulot d’étranglement : {n} organismes conservés.",
  "app.reseed.done": "Mondes A et B réinitialisés avec la graine {seed}.",

  /* sharing and export ------------------------------------------------------- */
  "app.share.copied": "Lien de configuration copié. Pour partager l’état actuel, exportez le monde.",
  "app.manifest.none": "Aucune course à décrire : lancez une expérience ciblée, puis exportez son manifeste.",
  "app.manifest.exported": "Manifeste exporté : {name} · {replicates} réplicats · {digest}.",
  "app.eventsExport.empty": "Journal d’événements vide : activez « Journal d’événements » puis laissez tourner la simulation.",
  "app.eventsExport.done": "{count} événements exportés.",
  "app.eventsLog.on": "Journal d’événements activé (borné, export JSONL).",
  "app.eventsLog.off": "Journal d’événements désactivé.",

  /* world files -------------------------------------------------------------- */
  "btn.oav": "Exporter en .oav",

  /* import ------------------------------------------------------------------- */
  "app.import.done": "Monde importé avec succès.",
  "app.import.failed": "Import impossible : choisissez un fichier JSON ou .oav exporté depuis OpenAvida.",

  /* editor and selection ----------------------------------------------------- */
  "app.dna.opened": "ADN de l’organisme {id} ouvert dans l’éditeur. Modifiez-le, puis appliquez-le ou placez un nouvel organisme.",
  "app.dna.loaded": "ADN de l’organisme {id} chargé dans l’éditeur.",
  "app.dna.loadedGeneric": "ADN chargé : modifiez-le ou placez un nouvel organisme.",
  "app.inject.added": "{n} organismes ajoutés au monde {world}.",

  /* runtime ------------------------------------------------------------------ */
  "app.error.runtime": "Erreur d’exécution : {message}",
} as const;
