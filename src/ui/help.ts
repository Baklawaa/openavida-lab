/**
 * Hover copy for lab controls. UI attach and Vitest both import this map —
 * do not duplicate strings in markup.
 */
export const CONTROL_HELP: Record<string, string> = {
  "speed-top": "Vitesse en pas de simulation par seconde. 0 met en pause ; 2 permet d’observer ; 60 accélère l’évolution.",
  "zoom-top": "Part du monde visible en 2D : 100 % montre tout le monde. Réduisez pour examiner la zone centrale. En 3D, utilisez la molette.",
  "btn-pause": "Mettre en pause ou reprendre. La touche Espace fait la même chose. Vous pouvez toujours inspecter le monde en pause.",
  "btn-step-once": "Avancer exactement d’un pas puis rester en pause. En A / B, avance les deux mondes.",
  "btn-slow": "Revenir à la vitesse d’observation : 2 pas par seconde.",
  "tool-inspect": "Cliquez sur un organisme pour examiner son énergie, ses traits et son ADN. Raccourci : I.",
  "tool-place": "Cliquez sur une cellule libre pour placer un organisme avec le génome de l’éditeur. Raccourci : O.",
  "tool-paint": "Cliquez ou glissez pour peindre le milieu. En 3D, peignez par clic. Raccourci : P.",
  "kit-phototroph": "Utilise la lumière comme source d’énergie. Sélectionne ce kit et active l’outil Placer.",
  "kit-heterotroph": "Se nourrit de nutriments. Ajoutez de la nourriture dans le milieu pour soutenir sa croissance.",
  "kit-resistant": "Résiste mieux aux dommages causés par les toxines.",
  "kit-predator": "Chasse les organismes voisins plus faibles et récupère leur énergie.",
  "kit-mutualist": "Partage son énergie avec les organismes du même canal de coopération.",
  "dna-builder": "Chaque carte est un gène lu dans la séquence. La force est son nombre de codons ; réordonnez, renforcez ou retirez les gènes sans perdre vos autres modifications.",
  "dna-strip-section": "La séquence base par base. Les rails colorés délimitent les gènes (ATG → TAA/TAG/TGA). Sélectionnez des bases pour les remplacer, les supprimer ou les dupliquer.",
  "dna-strip": "Cliquez sur une base pour la sélectionner, glissez pour une plage, double-cliquez pour un codon. Tapez A, C, G ou T pour remplacer ; Retour arrière supprime ; ⌘Z annule.",
  "dna-cassette": "Carte du génome : un segment par gène, en gris les bases hors gène. Cliquez pour sélectionner la région.",
  "dna-undo": "Annule la dernière modification de l’éditeur. Raccourci dans la séquence : ⌘Z.",
  "dna-redo": "Rétablit la modification annulée. Raccourci dans la séquence : ⌘⇧Z.",
  "dna-revert": "Revient au dernier génome chargé : kit, organisme copié ou génome de départ.",
  "dna-palette-trait": "Choisissez le trait dont vous voulez insérer un codon, ou les codons de début et de fin de gène.",
  "dna-palette-codons": "Chaque codon indique son acide aminé et son effet sur le trait. Cliquez pour l’insérer juste après la sélection.",
  "builder-pheno": "Phénotype décodé du génome en cours d’édition, comparé au génome chargé. Le repère clair marque la valeur de référence.",
  "btn-dna-place": "Active l’outil Placer : cliquez ensuite dans le monde pour y déposer un organisme avec ce génome.",
  "btn-dna-copy": "Copie la séquence ACGT dans le presse-papiers.",
  "btn-edit-selected": "Ouvre l’éditeur d’ADN avec le génome de cet organisme. Modifiez-le puis appliquez-le ou placez un nouvel organisme.",
  "dna-advanced": "Modifiez directement les bases ACGT ou appliquez une mutation aléatoire. La séquence reste synchronisée avec l’éditeur visuel.",
  "genome-edit": "Séquence ACGT éditable. Les segments ATG…TAA/TAG/TGA forment les gènes. Appliquez-la à la sélection ou ajoutez des organismes.",
  "btn-point": "Modifie une base de la séquence dans l’éditeur.",
  "btn-indel": "Insère ou supprime de 1 à 3 bases dans la séquence de l’éditeur.",
  "btn-dup": "Copie un fragment de la séquence et le réinsère dans le génome.",
  "btn-apply": "Remplace le génome de l’organisme sélectionné par celui de l’éditeur et crée une nouvelle lignée.",
  "founder": "Choisissez un génome de départ à charger dans l’éditeur.",
  "btn-load-founder": "Charge le génome de départ choisi dans l’éditeur.",
  "btn-inject": "Place jusqu’à 24 copies du génome de l’éditeur sur des cellules libres du monde actif.",
  "gene-add-uptake": "Ajoute un gène de nutrition, pour absorber les nutriments.",
  "gene-add-photo": "Ajoute un gène de photosynthèse, pour utiliser la lumière.",
  "gene-add-resist": "Ajoute un gène de résistance aux toxines.",
  "gene-add-tpref": "Ajoute un gène qui règle la température préférée.",
  "gene-add-motility": "Ajoute un gène qui modifie la capacité à se déplacer.",
  "gene-add-aggression": "Ajoute un gène de prédation pour chasser ses voisins.",
  "gene-add-signal": "Ajoute un gène de coopération et de signalisation.",
  "gene-add-hue": "Ajoute un gène de couleur. La couleur ne modifie pas la fitness.",
  "gene-add-fecundity": "Ajoute un gène qui modifie la reproduction.",
  "gene-add-size": "Ajoute un gène de taille, qui affecte aussi l’entretien énergétique.",
  "btn-from-inspect": "Copie le génome de l’organisme sélectionné dans l’éditeur. Il devient le génome de référence du phénotype.",
  "btn-clear-genes": "Vide la séquence. Le phénotype devient basal jusqu’à l’ajout d’un gène ou au choix d’un kit. Annulable.",
  "leaderboard": "Organismes vivants classés par fitness. Cliquez sur une ligne pour l’inspecter, ou sur Modifier cet ADN pour le réutiliser.",
  "death-log": "Décès récents et leurs causes. Cliquez sur une ligne pour charger le génome de l’organisme dans l’éditeur.",
  "death-tally": "Nombre de décès par cause dans le journal de ce monde.",
  "radius": "Rayon du pinceau, en cellules du monde.",
  "species-strains": "Regroupe les organismes par génome fondateur. Les descendants gardent l’étiquette de leur souche, même après mutation.",
  "species-strategies": "Regroupe les organismes par stratégie actuelle, déduite du phénotype : prédateur, mutualiste, phototrophe, hétérotrophe ou mixotrophe.",
  "opt-color-strain": "Colore chaque organisme de la vue 2D avec la couleur de sa souche, pour suivre les groupes sur la plaque.",
  "chart-groups": "Effectif vivant de chaque groupe au fil des pas. Une courbe qui monte pendant qu’une autre chute signale un remplacement.",
  "species-list": "Une carte par groupe : effectif, fitness, position moyenne, milieu local, phénotype moyen, dérive depuis le fondateur et mutations clés.",
  "strain-name": "Nom de la souche à créer à partir du génome courant de l’éditeur d’ADN.",
  "btn-strain-define": "Crée une souche nommée avec le génome de l’éditeur. Placez-la ou injectez-la depuis sa carte pour la comparer aux autres.",
  "btn-see-mutation": "Charge le génome mutant dans l’éditeur d’ADN, bases divergentes du parent encadrées. Le phénotype est comparé au parent.",
  "preset-name": "Nom du préréglage à enregistrer.",
  "btn-preset-save": "Enregistre l’état complet du monde actif dans ce navigateur : champs, terrain, organismes, souches et historique.",
  "preset-list": "Préréglages enregistrés localement. Charger remplace le monde actif ; Point de départ le sélectionne pour l’expérience ciblée.",
  "goal-source": "État à partir duquel chaque réplicat démarre : le monde actif tel quel, ou un préréglage enregistré.",
  "goal-example": "Objectifs prêts à l’emploi ; chaque champ reste modifiable après sélection.",
  "goal-metric": "Grandeur mesurée à chaque pas : population, occupation d’une zone du milieu, trait moyen ou maximal, effectif ou part d’une souche.",
  "goal-field-min": "Seuil du champ qui définit la zone : un organisme compte s’il se trouve sur une cellule où le champ atteint cette valeur.",
  "goal-target": "Valeur à atteindre. L’objectif est atteint au premier pas où la comparaison tient, pendant le nombre de pas indiqué.",
  "goal-sustain": "Nombre de pas consécutifs pendant lesquels la condition doit tenir avant de compter l’objectif comme atteint.",
  "goal-reps": "Nombre de simulations indépendantes lancées avec des graines successives. Elles s’exécutent en parallèle en arrière-plan.",
  "goal-max": "Budget de pas par réplicat. Au-delà, le réplicat compte comme non atteint.",
  "goal-seed": "Graine du premier réplicat ; les suivants utilisent graine + 1, + 2, …",
  "goal-mut": "Taux de mutation appliqué aux réplicats (le monde actif n’est pas modifié).",
  "goal-popmax": "Plafond de population des réplicats.",
  "goal-disturb": "Active les perturbations aléatoires dans les réplicats.",
  "btn-goal-run": "Lance les réplicats depuis l’état de départ. Le monde affiché continue indépendamment.",
  "btn-goal-stop": "Arrête les réplicats en cours ; les résultats déjà obtenus restent affichés.",
  "btn-goal-csv": "Télécharge les résultats des réplicats au format CSV : graine, pas d’atteinte, valeur finale, population.",
  "chart-goal": "Mesure de l’objectif au fil des pas pour chaque réplicat ; la ligne pointillée est la cible.",
  "goal-results": "Un résultat par réplicat. Ouvrir dans B charge son état final dans le monde B pour l’inspecter.",
  "sweep-var": "Paramètre balayé : taux de mutation, plafond de population, seuil de reproduction, ou facteur d’échelle d’un champ du snapshot de départ.",
  "sweep-from": "Borne inférieure de la grille linéaire (incluse).",
  "sweep-to": "Borne supérieure de la grille linéaire (incluse).",
  "sweep-steps": "Nombre de valeurs également espacées entre les bornes, au moins 2.",
  "sweep-reps": "Nombre de réplicats indépendants lancés à chaque valeur de la grille.",
  "btn-sweep-run": "Lance le balayage : pour chaque valeur, n réplicats avec des graines qui se suivent. L’objectif et le budget de pas sont ceux de l’expérience ciblée.",
  "btn-sweep-csv": "Télécharge le tableau du balayage : valeur, réussite, médiane, min–max, extinctions.",
  "chart-sweep": "Médiane des pas jusqu’à l’objectif en fonction de la variable, bande min–max.",
  "sweep-table": "Une ligne par valeur de la grille : réussite k/n, médiane et étendue des pas, extinctions.",
  "btn-charts": "Réduit ou affiche les séries temporelles pour donner plus de hauteur au monde. Le choix est mémorisé.",
  "view-A": "Affiche le monde A. Les indicateurs et les actions concernent ce monde.",
  "view-B": "Affiche le monde B, une expérience indépendante avec une autre graine.",
  "view-split": "Compare les mondes A et B côte à côte en 2D. Cliquez dans un monde pour en afficher les indicateurs et agir dessus.",
  "view-2d": "Vue du dessus : les couleurs du milieu indiquent les ressources, les points représentent les organismes.",
  "view-3d": "Vue en relief du même monde. Hauteur = nutriments et lumière. Glissez pour tourner, molette pour zoomer, cliquez pour utiliser l’outil.",
  "btn-step-a": "Met en pause et avance uniquement le monde A d’un pas.",
  "btn-step-b": "Met en pause et avance uniquement le monde B d’un pas.",
  "btn-step-both": "Met en pause et avance les mondes A et B d’un pas chacun.",
  "btn-snap": "Mémorise le monde actif, ses génomes et ses champs. Ce point de restauration reste dans cette session. Raccourci : S.",
  "btn-restore": "Restaure l’état mémorisé dans le monde actif.",
  "btn-bottle": "Ne conserve aléatoirement que 10 % des organismes du monde actif. Mémorisez un état avant pour pouvoir revenir en arrière.",
  "seed": "Graine de la nouvelle expérience. Une même graine avec les mêmes paramètres reproduit la même évolution.",
  "btn-reseed": "Remplace A et B par deux nouveaux mondes à partir de cette graine. B utilise une graine dérivée.",
  "btn-share": "Copie un lien de configuration : graine, paramètres et options. Pour conserver les organismes et l’état courant, exportez le monde en JSON.",
  "btn-json": "Télécharge un monde complet en JSON : organismes, champs, lignées et historique. Réimportable depuis Expérience.",
  "btn-csv": "Télécharge l’historique des indicateurs au format CSV.",
  "btn-phylo": "Télécharge les lignées, leurs parents, dates d’apparition et d’extinction au format CSV.",
  "btn-import": "Charge dans le monde actif un fichier JSON exporté depuis OpenAvida.",
  "fm-0": "Affiche les nutriments, les toxines, la température et la lumière ensemble. Raccourci : 1.",
  "fm-1": "Affiche les nutriments en vert. Raccourci : 2.",
  "fm-2": "Affiche les toxines en rose. Raccourci : 3.",
  "fm-3": "Affiche la température, du bleu froid à l’orange chaud. Raccourci : 4.",
  "fm-4": "Affiche la lumière en doré. Raccourci : 5.",
  "brush-nutrientBlob": "Dépose des nutriments. Cette réserve est ponctuelle, contrairement à une source.",
  "brush-toxinBlob": "Dépose une quantité de toxines dans le milieu.",
  "brush-heatBlob": "Augmente localement la température.",
  "brush-lightBlob": "Augmente localement la lumière disponible.",
  "brush-barrier": "Crée des obstacles aux organismes et à la diffusion des ressources.",
  "brush-erase": "Efface le terrain pour retrouver des cellules libres.",
  "brush-nutrientVent": "Crée une source qui fournit des nutriments à chaque pas.",
  "brush-toxinVent": "Crée une source permanente de toxines.",
  "brush-thermalVent": "Crée une source permanente de chaleur.",
  "brush-shade": "Ajoute de l’ombre qui réduit la lumière reçue.",
  "brush-wipeOrgs": "Retire les organismes sous le pinceau.",
  "opt-terrain": "Génère des sources, des obstacles et de l’ombre. Désactiver retire le terrain prédéfini.",
  "opt-disturb": "Active les perturbations aléatoires : toxines, sécheresses et mortalité.",
  "opt-view3d": "Affiche le même monde en trois dimensions. Le moteur de simulation reste identique.",
  "opt-brains": "Active les décisions perception → action des organismes avec la politique intégrée.",
  "opt-llm": "Active l’adaptateur LLM facultatif. Sans adaptateur configuré, la politique intégrée prend le relais.",
  "opt-mp": "Partage une session entre les onglets de ce navigateur. L’hôte contrôle le temps ; les observateurs ne peuvent pas peindre.",
  "inspect-pathways": "Molécules, enzymes et flux calculés à partir du génome et des ressources de l’organisme sélectionné.",
  "inspect-brain": "Historique perception → action de cet organisme lorsque les comportements sont activés.",
  "mp-room": "Nom du salon. Le même nom permet de rejoindre une session depuis un autre onglet du même navigateur.",
  "mp-role": "Hôte : contrôle du temps et modifications. Expérimentateur : modifications. Observateur : inspection.",
  "btn-mp-host": "Crée une session dont cet onglet contrôle la simulation.",
  "btn-mp-join": "Rejoint le salon choisi avec le rôle sélectionné.",
  "mp-peers": "Participants présents dans le salon et leurs rôles.",
};

export const LAB_CONTROL_IDS: readonly string[] = Object.keys(CONTROL_HELP);

export function attachControlHelp(root: ParentNode, tip: HTMLElement): number {
  let attached = 0;
  for (const id of LAB_CONTROL_IDS) {
    const node = root.querySelector("#" + id);
    if (!node) continue;
    const text = CONTROL_HELP[id]!;
    node.setAttribute("title", text);
    node.setAttribute("data-help", text);
    attached++;
  }
  const show = (ev: Event) => {
    const el = (ev.target as HTMLElement | null)?.closest?.("[data-help]") as HTMLElement | null;
    if (!el || (el instanceof HTMLDetailsElement && !(ev.target as HTMLElement).closest("summary"))) { tip.hidden = true; return; }
    const text = el.getAttribute("data-help") ?? "";
    if (!text) return;
    tip.textContent = text;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const x = Math.min(r.left, Math.max(8, window.innerWidth - 308));
    const y = r.bottom + 8;
    tip.style.left = `${x}px`;
    tip.style.top = `${Math.min(y, window.innerHeight - 80)}px`;
  };
  const hide = (ev: Event) => {
    const next = (ev as PointerEvent).relatedTarget as HTMLElement | null;
    if (next && next.closest && next.closest("[data-help]")) return;
    tip.hidden = true;
  };
  root.addEventListener("pointerover", show);
  root.addEventListener("focusin", show);
  root.addEventListener("pointerout", hide);
  root.addEventListener("focusout", () => { tip.hidden = true; });
  root.addEventListener("click", () => { tip.hidden = true; });
  return attached;
}
