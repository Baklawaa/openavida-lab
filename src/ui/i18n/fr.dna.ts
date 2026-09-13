/**
 * French copy for the DNA editor (src/ui/dnaEditor.ts): panel heading, toolbar,
 * gene builder, base strip, codon palette, landscape probe, phenotype note,
 * mutation controls and status messages.
 *
 * The copy already owned by TRAIT_LABEL, TRAIT_HINT and KIT_COPY stays in those
 * catalogs; this file holds only the strings the editor renders itself.
 */
export const DNA_FR = {
  /* heading ----------------------------------------------------------------- */
  "dna.heading.title": "Éditeur d’ADN",
  "dna.heading.meta": "0 BASES · 0 GÈNES",
  "dna.heading.subtitle": "Séquence ACGT décodée en direct : ORF (ATG … stop) → codons → deltas de traits → phénotype.",
  "dna.meta.both.one.one": "{n} BASE · {g} GÈNE",
  "dna.meta.both.one.many": "{n} BASE · {g} GÈNES",
  "dna.meta.both.many.one": "{n} BASES · {g} GÈNE",
  "dna.meta.both.many.many": "{n} BASES · {g} GÈNES",
  "dna.meta.dirty": "MODIFIÉ",

  /* toolbar ----------------------------------------------------------------- */
  "dna.toolbar.history.aria": "Historique de l’édition",
  "dna.toolbar.undo": "Annuler",
  "dna.toolbar.redo": "Rétablir",
  "dna.toolbar.revert": "Revenir",
  "dna.toolbar.copySelection": "Copier la sélection",
  "dna.toolbar.clear": "Vider",
  "dna.toolbar.map.aria": "Carte du génome",
  "dna.map.empty": "génome vide",
  "dna.map.open": "Gène non terminé (ignoré)",
  "dna.map.junk": "Hors gène",

  /* gene builder ------------------------------------------------------------ */
  "dna.builder.title": "Gènes",
  "dna.builder.tag": "VISUEL",
  "dna.builder.add": "AJOUTER UN GÈNE",
  "dna.builder.empty": "Aucun gène. Ajoutez-en un ci-dessous ou choisissez un kit.",
  "dna.builder.less": "Réduire la force",
  "dna.builder.more": "Augmenter la force",
  "dna.builder.moveUp": "Monter le gène",
  "dna.builder.moveDown": "Descendre le gène",
  "dna.builder.remove": "Retirer le gène",
  "dna.builder.strength.aria": "Force du gène {trait}",

  /* base strip and codon help ----------------------------------------------- */
  "dna.strip.title": "Séquence base par base",
  "dna.strip.aria": "Séquence ACGT. Flèches : déplacer la sélection ; A, C, G, T : remplacer ; Retour arrière : supprimer ; Maj : étendre.",
  "dna.strip.empty": "Séquence vide. Insérez un codon ci-dessous ou ajoutez un gène.",
  "dna.codon.start": "ATG · début du gène {gene} ({trait})",
  "dna.codon.stop": "{codon} · fin du gène {gene} ({trait})",
  "dna.codon.noEffect": "{codon} · sans effet",
  "dna.codon.open": "{codon} · gène non terminé : ignoré par l’organisme",
  "dna.codon.reg": "{codon} · région régulatrice : amplifie l’expression du gène {gene}",
  "dna.codon.junk": "{codon} · hors gène : sans effet",

  /* selection --------------------------------------------------------------- */
  "dna.sel.diff": "{n} bases modifiées par rapport au parent.",
  "dna.sel.diff.suffix": "{n} bases modifiées par rapport au parent",
  "dna.sel.hint": "Cliquez sur une base pour la sélectionner. Double-clic : le codon entier. Glissez ou Maj + clic : une plage.",
  "dna.sel.base.start": "Base {index} · ATG, début du gène {gene}",
  "dna.sel.base.stop": "Base {index} · {codon}, fin du gène {gene}",
  "dna.sel.base.open": "Base {index} · gène non terminé",
  "dna.sel.base.out": "Base {index} · hors gène",
  "dna.sel.replace.aria": "Remplacer par {base}",
  "dna.sel.replace.group.aria": "Remplacer la sélection par",
  "dna.sel.dup.title": "Dupliquer la sélection (⌘D)",
  "dna.sel.dup": "Dupliquer",
  "dna.sel.del.title": "Supprimer la sélection (⌫)",
  "dna.sel.del": "Supprimer",
  "dna.sel.none.title": "Désélectionner (Échap)",

  /* codon palette ----------------------------------------------------------- */
  "dna.palette.insert": "INSÉRER APRÈS LA SÉLECTION",
  "dna.palette.trait.aria": "Trait des codons proposés",
  "dna.palette.control": "Début / fin",
  "dna.palette.control.start": "début",
  "dna.palette.control.stop": "fin",

  /* fitness landscape ------------------------------------------------------- */
  "dna.landscape.title": "Paysage",
  "dna.landscape.best": "Meilleures substitutions",
  "dna.landscape.worst": "Pires substitutions",
  "dna.landscape.closed": "Ouvrez pour évaluer les substitutions d’un codon dans les gènes, à l’environnement local.",
  "dna.landscape.env": "{env} · fitness de référence {baseline}.",
  "dna.landscape.hit.title": "Remplacer {from} par {codon} à la base {position}",
  "dna.landscape.none.best": "Aucune substitution n’améliore la fitness.",
  "dna.landscape.none.worst": "Aucune substitution n’abaisse la fitness.",

  /* phenotype note ---------------------------------------------------------- */
  "dna.pheno.title": "PHÉNOTYPE",
  "dna.pheno.note": "comparé au génome chargé",
  "dna.pheno.parent": "comparé au génome parental",
  "dna.pheno.same": "identique au génome chargé",

  /* actions ----------------------------------------------------------------- */
  "dna.actions.apply": "Appliquer à la sélection",
  "dna.actions.place": "Placer dans le monde",
  "dna.actions.copy.aria": "Copier la séquence",

  /* mutations and founder --------------------------------------------------- */
  "dna.mutation.title": "Séquence brute et mutations",
  "dna.mutation.tag": "AVANCÉ",
  "dna.mutation.sequence": "Séquence ACGT",
  "dna.mutation.placeholder": "Séquence ACGT — ATG…TAA",
  "dna.mutation.point": "Mutation ponctuelle",
  "dna.mutation.indel": "Insertion / délétion",
  "dna.mutation.duplicate": "Duplication",
  "dna.founder.label": "Génome de départ",
  "dna.founder.load": "Charger",

  /* status messages --------------------------------------------------------- */
  "dna.status.undone": "Modification annulée.",
  "dna.status.redone": "Modification rétablie.",
  "dna.status.reverted": "Génome chargé rétabli.",
  "dna.status.cleared": "Génome vidé : phénotype basal.",
  "dna.status.noSelection": "Sélectionnez d’abord un organisme avec Inspecter.",
  "dna.status.copiedFromOrganism": "ADN de l’organisme {id} copié dans l’éditeur.",
  "dna.status.geneBoosted": "{trait} renforcé.",
  "dna.status.full": "Le génome est plein ({max} bases).",
  "dna.status.geneRemoved": "Gène {trait} retiré.",
  "dna.status.geneAdded": "Gène ajouté : {trait}.",
  "dna.status.selectionCopied": "Sélection copiée.",
  "dna.status.substituted": "Substitution {from} → {to} à la base {pos}.",
  "dna.status.codonInserted": "Codon {codon} inséré.",
  "dna.status.copied": "Séquence copiée ({n} bases).",
  "dna.status.copyFailed": "Copie impossible dans ce navigateur.",
  "dna.status.pointMutated": "Mutation ponctuelle : une base remplacée.",
  "dna.status.indelMutated": "Insertion ou délétion appliquée.",
  "dna.status.fragmentDuplicated": "Fragment dupliqué.",
  "dna.status.founderLoaded": "Génome de départ chargé : {kit}.",
  "dna.status.basesDeleted.one": "{n} base supprimée.",
  "dna.status.basesDeleted.many": "{n} bases supprimées.",
  "dna.status.selectionDuplicated": "Sélection dupliquée.",
} as const;
