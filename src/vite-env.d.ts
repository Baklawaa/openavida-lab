/// <reference types="vite/client" />

interface OpenAvidaProbe {
  tick: number;
  population: number;
  selectedGenome: string;
  selectedPhenotype: string;
  editorValue: string;
  canvasWidth: number;
  canvasHeight: number;
  drawingBufferWidth: number;
  drawingBufferHeight: number;
  lastStepMs: number;
  seed: number;
  world: "A" | "B";
  deathCount: number;
  lastDeathCause: string;
  topFit: number;
  builderGenes: number;
  surface: "2d" | "3d";
  view3d: boolean;
  brains: boolean;
  llmBrains: boolean;
  multiplayer: boolean;
  pathways: string;
  brainTraces: number;
  roomPeers: number;
}

interface Window {
  __openavida?: OpenAvidaProbe;
  __openavidaSelectAt?: (x: number, y: number) => boolean;
  __openavidaOrgPixel?: (index?: number) => { x: number; y: number; id: number } | null;
  __openavidaPlaceAt?: (x: number, y: number) => boolean;
  __openavidaHelp?: Record<string, string>;
}
