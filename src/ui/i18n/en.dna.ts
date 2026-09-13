/**
 * English copy for the DNA editor (see dna.fr.ts for the same keys).
 */
export const DNA_EN = {
  /* heading ----------------------------------------------------------------- */
  "dna.heading.title": "DNA editor",
  "dna.heading.meta": "0 BASES · 0 GENES",
  "dna.heading.subtitle": "ACGT sequence decoded live: ORF (ATG … stop) → codons → trait deltas → phenotype.",
  "dna.meta.both.one.one": "{n} BASE · {g} GENE",
  "dna.meta.both.one.many": "{n} BASE · {g} GENES",
  "dna.meta.both.many.one": "{n} BASES · {g} GENE",
  "dna.meta.both.many.many": "{n} BASES · {g} GENES",
  "dna.meta.dirty": "MODIFIED",

  /* toolbar ----------------------------------------------------------------- */
  "dna.toolbar.history.aria": "Editing history",
  "dna.toolbar.undo": "Undo",
  "dna.toolbar.redo": "Redo",
  "dna.toolbar.revert": "Revert",
  "dna.toolbar.copySelection": "Copy selection",
  "dna.toolbar.clear": "Clear",
  "dna.toolbar.map.aria": "Genome map",
  "dna.map.empty": "empty genome",
  "dna.map.open": "Unfinished gene (ignored)",
  "dna.map.junk": "Outside a gene",

  /* gene builder ------------------------------------------------------------ */
  "dna.builder.title": "Genes",
  "dna.builder.tag": "VISUAL",
  "dna.builder.add": "ADD A GENE",
  "dna.builder.empty": "No gene. Add one below or pick a kit.",
  "dna.builder.less": "Decrease strength",
  "dna.builder.more": "Increase strength",
  "dna.builder.moveUp": "Move the gene up",
  "dna.builder.moveDown": "Move the gene down",
  "dna.builder.remove": "Remove the gene",
  "dna.builder.strength.aria": "Strength of the {trait} gene",

  /* base strip and codon help ----------------------------------------------- */
  "dna.strip.title": "Base-by-base sequence",
  "dna.strip.aria": "ACGT sequence. Arrow keys: move the selection; A, C, G, T: replace; Backspace: delete; Shift: extend.",
  "dna.strip.empty": "Empty sequence. Insert a codon below or add a gene.",
  "dna.codon.start": "ATG · start of gene {gene} ({trait})",
  "dna.codon.stop": "{codon} · end of gene {gene} ({trait})",
  "dna.codon.noEffect": "{codon} · no effect",
  "dna.codon.open": "{codon} · unfinished gene: ignored by the organism",
  "dna.codon.reg": "{codon} · regulatory region: amplifies the expression of gene {gene}",
  "dna.codon.junk": "{codon} · outside a gene: no effect",

  /* selection --------------------------------------------------------------- */
  "dna.sel.diff": "{n} bases changed relative to the parent.",
  "dna.sel.diff.suffix": "{n} bases changed relative to the parent",
  "dna.sel.hint": "Click a base to select it. Double-click: the whole codon. Drag or Shift + click: a range.",
  "dna.sel.base.start": "Base {index} · ATG, start of gene {gene}",
  "dna.sel.base.stop": "Base {index} · {codon}, end of gene {gene}",
  "dna.sel.base.open": "Base {index} · unfinished gene",
  "dna.sel.base.out": "Base {index} · outside a gene",
  "dna.sel.replace.aria": "Replace with {base}",
  "dna.sel.replace.group.aria": "Replace the selection with",
  "dna.sel.dup.title": "Duplicate the selection (⌘D)",
  "dna.sel.dup": "Duplicate",
  "dna.sel.del.title": "Delete the selection (⌫)",
  "dna.sel.del": "Delete",
  "dna.sel.none.title": "Deselect (Esc)",

  /* codon palette ----------------------------------------------------------- */
  "dna.palette.insert": "INSERT AFTER THE SELECTION",
  "dna.palette.trait.aria": "Trait of the suggested codons",
  "dna.palette.control": "Start / stop",
  "dna.palette.control.start": "start",
  "dna.palette.control.stop": "stop",

  /* fitness landscape ------------------------------------------------------- */
  "dna.landscape.title": "Landscape",
  "dna.landscape.best": "Best substitutions",
  "dna.landscape.worst": "Worst substitutions",
  "dna.landscape.closed": "Open to evaluate codon substitutions in the genes, against the local environment.",
  "dna.landscape.env": "{env} · baseline fitness {baseline}.",
  "dna.landscape.hit.title": "Replace {from} with {codon} at base {position}",
  "dna.landscape.none.best": "No substitution improves fitness.",
  "dna.landscape.none.worst": "No substitution lowers fitness.",

  /* phenotype note ---------------------------------------------------------- */
  "dna.pheno.title": "PHENOTYPE",
  "dna.pheno.note": "compared with the loaded genome",
  "dna.pheno.parent": "compared with the parent genome",
  "dna.pheno.same": "identical to the loaded genome",

  /* actions ----------------------------------------------------------------- */
  "dna.actions.apply": "Apply to the selection",
  "dna.actions.place": "Place in the world",
  "dna.actions.copy.aria": "Copy the sequence",

  /* mutations and founder --------------------------------------------------- */
  "dna.mutation.title": "Raw sequence and mutations",
  "dna.mutation.tag": "ADVANCED",
  "dna.mutation.sequence": "ACGT sequence",
  "dna.mutation.placeholder": "ACGT sequence — ATG…TAA",
  "dna.mutation.point": "Point mutation",
  "dna.mutation.indel": "Insertion / deletion",
  "dna.mutation.duplicate": "Duplicate",
  "dna.founder.label": "Founder genome",
  "dna.founder.load": "Load",

  /* status messages --------------------------------------------------------- */
  "dna.status.undone": "Change undone.",
  "dna.status.redone": "Change redone.",
  "dna.status.reverted": "Loaded genome restored.",
  "dna.status.cleared": "Genome cleared: basal phenotype.",
  "dna.status.noSelection": "Select an organism with Inspect first.",
  "dna.status.copiedFromOrganism": "DNA of organism {id} copied into the editor.",
  "dna.status.geneBoosted": "{trait} strengthened.",
  "dna.status.full": "The genome is full ({max} bases).",
  "dna.status.geneRemoved": "{trait} gene removed.",
  "dna.status.geneAdded": "Gene added: {trait}.",
  "dna.status.selectionCopied": "Selection copied.",
  "dna.status.substituted": "Substitution {from} → {to} at base {pos}.",
  "dna.status.codonInserted": "Codon {codon} inserted.",
  "dna.status.copied": "Sequence copied ({n} bases).",
  "dna.status.copyFailed": "Copy impossible in this browser.",
  "dna.status.pointMutated": "Point mutation: one base replaced.",
  "dna.status.indelMutated": "Insertion or deletion applied.",
  "dna.status.fragmentDuplicated": "Fragment duplicated.",
  "dna.status.founderLoaded": "Founder genome loaded: {kit}.",
  "dna.status.basesDeleted.one": "{n} base deleted.",
  "dna.status.basesDeleted.many": "{n} bases deleted.",
  "dna.status.selectionDuplicated": "Selection duplicated.",
} as const;
