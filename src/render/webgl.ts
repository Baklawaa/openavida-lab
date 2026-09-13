import { bodySize } from "../sim/body";
import type { World } from "../sim/world";
import { TRAIT_COLOR } from "../sim/mapping";
import { TERRAIN } from "../sim/types";
import { viewCrop } from "../ui/camera";

const VS_FIELD = `#version 300 es
precision highp float;
const vec2 POS[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
void main() { gl_Position = vec4(POS[gl_VertexID], 0.0, 1.0); }
`;

const FS_FIELD = `#version 300 es
precision highp float;
uniform sampler2D uFields;
uniform vec2 uRes;
uniform vec2 uWorld;
uniform float uTime;
uniform int uMode;
uniform int uSplit;
uniform sampler2D uFieldsB;
uniform sampler2D uPlate;
uniform sampler2D uPlateB;
uniform vec4 uCrop;
uniform vec4 uCropB;
out vec4 fragColor;

vec3 fieldColor(vec4 f) {
  vec3 bg = vec3(0.035, 0.065, 0.062);
  vec3 nut = vec3(0.05, 0.95, 0.78) * pow(max(f.r, 0.0), 0.65);
  vec3 tox = vec3(0.98, 0.12, 0.58) * pow(max(f.g, 0.0), 0.62);
  vec3 cold = vec3(0.12, 0.32, 0.95);
  vec3 hot = vec3(0.98, 0.32, 0.06);
  vec3 tmp = mix(cold, hot, clamp(f.b, 0.0, 1.0)) * (0.16 + 0.5 * f.b);
  vec3 lit = vec3(1.0, 0.9, 0.55) * pow(max(f.a, 0.0), 1.15) * 0.28;
  if (uMode == 1) return bg + nut * 0.8;
  if (uMode == 2) return bg + tox * 0.8;
  if (uMode == 3) return bg + tmp * 0.85;
  if (uMode == 4) return bg + lit * 1.4;
  return bg + nut * 0.42 + tox * 0.38 + tmp * 0.19 + lit * 0.25;
}

vec2 applyCrop(vec2 local, vec4 crop) {
  return vec2(mix(crop.x, crop.z, local.x), mix(crop.y, crop.w, local.y));
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 local;
  vec2 tuv;
  vec4 f;
  vec4 plate;
  if (uSplit == 1) {
    if (uv.x < 0.5) {
      local = vec2(uv.x * 2.0, 1.0 - uv.y);
      tuv = applyCrop(local, uCrop);
      f = texture(uFields, tuv);
      plate = texture(uPlate, tuv);
    } else {
      local = vec2((uv.x - 0.5) * 2.0, 1.0 - uv.y);
      tuv = applyCrop(local, uCropB);
      f = texture(uFieldsB, tuv);
      plate = texture(uPlateB, tuv);
    }
  } else {
    local = vec2(uv.x, 1.0 - uv.y);
    tuv = applyCrop(local, uCrop);
    f = texture(uFields, tuv);
    plate = texture(uPlate, tuv);
  }
  vec3 col = fieldColor(f);
  vec2 cell = fract(tuv * uWorld) - 0.5;
  // Opaque bright cells are organisms; terrain retains its square footprint.
  if (plate.a > 0.85 && max(plate.r, max(plate.g, plate.b)) > 0.25) {
    float body = 1.0 - smoothstep(0.28, 0.48, length(cell));
    col = mix(col, plate.rgb, body);
  } else if (plate.a > 0.02) {
    col = mix(col, plate.rgb, min(0.8, plate.a));
  }
  float edge = max(abs(cell.x), abs(cell.y));
  col *= 1.0 - smoothstep(0.46, 0.5, edge) * 0.08;
  float vig = smoothstep(1.15, 0.22, length(uv - 0.5));
  col *= 0.86 + 0.14 * vig;
  float g = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (g - 0.5) * 0.01;
  if (uSplit == 1) {
    float line = smoothstep(0.003, 0.0, abs(uv.x - 0.5));
    col = mix(col, vec3(0.25, 0.85, 0.75), line * 0.55);
  }
  fragColor = vec4(col, 1.0);
}
`;

const FS_HEAT = `#version 300 es
precision highp float;
uniform sampler2D uHeat;
uniform vec2 uRes;
uniform vec4 uCrop;
uniform vec3 uColor;
uniform float uAlpha;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 local = vec2(uv.x, 1.0 - uv.y);
  vec2 tuv = vec2(mix(uCrop.x, uCrop.z, local.x), mix(uCrop.y, uCrop.w, local.y));
  float h = texture(uHeat, tuv).r;
  fragColor = vec4(uColor, h * uAlpha);
}
`;

const VS_ORGANISM = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPosition;
layout(location=1) in vec3 aColor;
layout(location=2) in float aSelected;
layout(location=3) in float aSize;
uniform float uSize;
uniform float uDpr;
out vec3 vColor;
out float vSelected;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
  gl_PointSize = uSize * aSize + aSelected * 6.0 * uDpr;
  vColor = aColor;
  vSelected = aSelected;
}
`;

const FS_ORGANISM = `#version 300 es
precision highp float;
in vec3 vColor;
in float vSelected;
out vec4 fragColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float body = 1.0 - smoothstep(0.65, 1.0, d);
  if (vSelected > 0.5) {
    float ring = smoothstep(0.68, 0.77, d) * (1.0 - smoothstep(0.88, 1.0, d));
    body = 1.0 - smoothstep(0.35, 0.5, d);
    fragColor = vec4(mix(vColor, vec3(0.88, 1.0, 0.92), ring), max(body, ring));
  } else fragColor = vec4(vColor, body);
}
`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("shader alloc");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? "compile failed";
    gl.deleteShader(sh);
    throw new Error(log);
  }
  return sh;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error("program alloc");
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) ?? "link failed");
  }
  return p;
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

import { overlayByte } from "./overlay";

export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Display color from dominant metabolic trait, tinted by the hue locus. */
export function organismRgb(
  ph: { uptake: number; photo: number; resist: number; aggression: number; signal: number; hue: number },
  lineageId = 0,
): [number, number, number] {
  const guilds: Array<[keyof typeof TRAIT_COLOR, number]> = [
    ["aggression", ph.aggression],
    ["photo", ph.photo],
    ["uptake", ph.uptake],
    ["resist", ph.resist],
    ["signal", ph.signal / 7],
  ];
  let best = guilds[0]!;
  for (const g of guilds) if (g[1] > best[1]) best = g;
  const [br, bg, bb] = hexRgb(TRAIT_COLOR[best[0]]);
  const linHue = (lineageId * 0.14159265 + ph.hue * 0.17) % 1;
  const [lr, lg, lb] = hsl(linHue, 0.72, 0.56);
  return [br * 0.68 + lr * 0.32, bg * 0.68 + lg * 0.32, bb * 0.68 + lb * 0.32];
}

export type FieldMode = 0 | 1 | 2 | 3 | 4 | 5;
export type ViewMode = "A" | "B" | "split";

export class LabRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  private fieldProg: WebGLProgram;
  private heatProg: WebGLProgram;
  private organismProg: WebGLProgram;
  private heatTex: WebGLTexture;
  private heatBytes = new Uint8Array(1);
  private organismBuffer: WebGLBuffer;
  private organismVao: WebGLVertexArrayObject;
  private texA: WebGLTexture;
  private texB: WebGLTexture;
  private plateA: WebGLTexture;
  private plateB: WebGLTexture;
  private rgba: Uint8Array;
  private plate: Uint8Array;
  /** Reusable normalised buffer for the strain heat overlay. */
  private heatScratch = new Float32Array(0);

  fieldMode: FieldMode = 0;
  view: ViewMode = "A";
  selectedId = -1;
  /** Ring every organism of this lineage (−1 = none). */
  highlightLineage = -1;
  selectedWorld: "A" | "B" = "A";
  /** 1 = whole 128×128 plate. User-controlled; does not chase biomass. */
  zoom = 1;
  /** Color organisms by founding strain instead of guild + lineage. */
  colorByStrain = false;
  /** Normalised occupancy 0–1 for the selected strain, or null when off. */
  heatStrain: Float32Array | null = null;
  heatSize: [number, number] = [0, 0];
  heatColor: [number, number, number] = [0.2, 0.85, 0.7];
  /** Overlay opacity; the exudate layer raises it (see render/overlay.ts). */
  heatAlpha = 0.42;
  private cropA: [number, number, number, number] = [0, 0, 1, 1];
  private cropB: [number, number, number, number] = [0, 0, 1, 1];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL2 required");
    this.gl = gl;
    this.fieldProg = program(gl, VS_FIELD, FS_FIELD);
    this.heatProg = program(gl, VS_FIELD, FS_HEAT);
    this.organismProg = program(gl, VS_ORGANISM, FS_ORGANISM);
    this.heatTex = this.makeTex(true);
    this.organismBuffer = gl.createBuffer()!;
    this.organismVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.organismVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.organismBuffer);
    for (const [index, size, offset] of [[0, 2, 0], [1, 3, 8], [2, 1, 20], [3, 1, 24]]) {
      gl.enableVertexAttribArray(index!);
      gl.vertexAttribPointer(index!, size!, gl.FLOAT, false, 28, offset!);
    }
    gl.bindVertexArray(null);
    this.texA = this.makeTex(false);
    this.texB = this.makeTex(false);
    this.plateA = this.makeTex(true);
    this.plateB = this.makeTex(true);
    this.rgba = new Uint8Array(128 * 128 * 4);
    this.plate = new Uint8Array(128 * 128 * 4);
  }

  private makeTex(nearest: boolean): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    const filt = nearest ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /**
   * Buffer the app normalises a strain heat map into. Reused across frames so a
   * steady heat frame allocates nothing; the exudate overlay keeps its own.
   */
  heatBuffer(width: number, height: number): Float32Array {
    const n = width * height;
    if (this.heatScratch.length !== n) this.heatScratch = new Float32Array(n);
    return this.heatScratch;
  }

  resize(cssW: number, cssH: number): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(cssW * dpr));
    const h = Math.max(1, Math.floor(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.gl.viewport(0, 0, w, h);
  }

  private uploadFields(tex: WebGLTexture, world: World): void {
    const gl = this.gl;
    const n = world.w * world.h;
    if (this.rgba.length !== n * 4) this.rgba = new Uint8Array(n * 4);
    world.fields.packRGBA(this.rgba);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      world.w,
      world.h,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.rgba,
    );
  }

  private uploadPlate(tex: WebGLTexture, world: World): void {
    const gl = this.gl;
    const n = world.w * world.h;
    if (this.plate.length !== n * 4) this.plate = new Uint8Array(n * 4);
    const out = this.plate;
    out.fill(0);
    const terrain = world.terrain;
    for (let i = 0; i < n; i++) {
      const t = terrain[i]!;
      const o = i * 4;
      if (t === TERRAIN.barrier) {
        out[o] = 10;
        out[o + 1] = 12;
        out[o + 2] = 16;
        out[o + 3] = 255;
      } else if (t === TERRAIN.nutrientVent) {
        out[o] = 30;
        out[o + 1] = 200;
        out[o + 2] = 170;
        out[o + 3] = 70;
      } else if (t === TERRAIN.toxinVent) {
        out[o] = 210;
        out[o + 1] = 30;
        out[o + 2] = 120;
        out[o + 3] = 70;
      } else if (t === TERRAIN.thermalVent) {
        out[o] = 230;
        out[o + 1] = 80;
        out[o + 2] = 20;
        out[o + 3] = 70;
      } else if (t === TERRAIN.shade) {
        out[o] = 8;
        out[o + 1] = 10;
        out[o + 2] = 18;
        out[o + 3] = 110;
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, world.w, world.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, out);
  }

  draw(worldA: World, worldB: World, timeSec: number): void {
    const gl = this.gl;
    const split = this.view === "split";
    const primary = this.view === "B" ? worldB : worldA;
    if (this.view === "B" && !split) {
      this.uploadFields(this.texA, worldB);
      this.uploadPlate(this.plateA, worldB);
    } else {
      this.uploadFields(this.texA, worldA);
      this.uploadPlate(this.plateA, worldA);
    }
    if (split) {
      this.uploadFields(this.texB, worldB);
      this.uploadPlate(this.plateB, worldB);
    }

    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    gl.useProgram(this.fieldProg);
    gl.uniform2f(gl.getUniformLocation(this.fieldProg, "uRes"), this.canvas.width, this.canvas.height);
    gl.uniform2f(gl.getUniformLocation(this.fieldProg, "uWorld"), primary.w, primary.h);
    gl.uniform1f(gl.getUniformLocation(this.fieldProg, "uTime"), timeSec);
    // Layer 5 is the exudate overlay: the plate keeps the composite rendering
    // and the field is drawn as an R8 texture on top (see uploadHeat).
    gl.uniform1i(gl.getUniformLocation(this.fieldProg, "uMode"), this.fieldMode === 5 ? 0 : this.fieldMode);
    this.cropA = viewCrop(this.zoom);
    this.cropB = viewCrop(this.zoom);
    gl.uniform1i(gl.getUniformLocation(this.fieldProg, "uSplit"), split ? 1 : 0);
    gl.uniform4f(gl.getUniformLocation(this.fieldProg, "uCrop"), ...this.cropA);
    gl.uniform4f(gl.getUniformLocation(this.fieldProg, "uCropB"), ...this.cropB);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texA);
    gl.uniform1i(gl.getUniformLocation(this.fieldProg, "uFields"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texB);
    gl.uniform1i(gl.getUniformLocation(this.fieldProg, "uFieldsB"), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.plateA);
    gl.uniform1i(gl.getUniformLocation(this.fieldProg, "uPlate"), 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.plateB);
    gl.uniform1i(gl.getUniformLocation(this.fieldProg, "uPlateB"), 3);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.drawHeat(primary);
    this.drawOrganisms(split ? [worldA, worldB] : [primary]);
  }

  private drawHeat(world: World): void {
    const map = this.heatStrain;
    if (!map || this.heatSize[0] !== world.w || this.heatSize[1] !== world.h) return;
    const gl = this.gl;
    const n = world.w * world.h;
    if (this.heatBytes.length !== n) this.heatBytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) this.heatBytes[i] = overlayByte(map[i]!);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.heatTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, world.w, world.h, 0, gl.RED, gl.UNSIGNED_BYTE, this.heatBytes);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.heatProg);
    gl.uniform2f(gl.getUniformLocation(this.heatProg, "uRes"), this.canvas.width, this.canvas.height);
    gl.uniform4f(gl.getUniformLocation(this.heatProg, "uCrop"), ...this.cropA);
    gl.uniform3f(gl.getUniformLocation(this.heatProg, "uColor"), ...this.heatColor);
    gl.uniform1f(gl.getUniformLocation(this.heatProg, "uAlpha"), this.heatAlpha);
    gl.uniform1i(gl.getUniformLocation(this.heatProg, "uHeat"), 4);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
  }

  private drawOrganisms(worlds: World[]): void {
    const gl = this.gl;
    const data: number[] = [];
    const crop = this.cropA;
    for (let side = 0; side < worlds.length; side++) {
      const world = worlds[side]!;
      for (const org of world.organisms) {
        const u = ((org.x + .5) / world.w - crop[0]) / (crop[2] - crop[0]);
        const v = ((org.y + .5) / world.h - crop[1]) / (crop[3] - crop[1]);
        if (u < 0 || u > 1 || v < 0 || v > 1) continue;
        const strain = this.colorByStrain ? world.strains.get(org.strainId) : undefined;
        const color = strain ? hexRgb(strain.color) : organismRgb(org.ph, org.lineageId);
        const sizeFactor = Math.max(0.6, Math.min(2.2, 0.7 + 0.35 * bodySize(org)));
        const selected = (org.id === this.selectedId && (worlds.length === 1 || (side === 0 ? "A" : "B") === this.selectedWorld)) || (this.highlightLineage >= 0 && org.lineageId === this.highlightLineage);
        data.push((u + side) / worlds.length * 2 - 1, 1 - v * 2, ...color, selected ? 1 : 0, sizeFactor);
      }
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cell = Math.min(this.canvas.width / worlds.length / worlds[0]!.w, this.canvas.height / worlds[0]!.h) / this.zoom;
    gl.useProgram(this.organismProg);
    gl.bindVertexArray(this.organismVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.organismBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
    gl.uniform1f(gl.getUniformLocation(this.organismProg, "uSize"), Math.max(4 * dpr, Math.min(16 * dpr, cell * .9)));
    gl.uniform1f(gl.getUniformLocation(this.organismProg, "uDpr"), dpr);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, data.length / 7);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  canvasToGrid(clientX: number, clientY: number, world: World): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    let u = (clientX - rect.left) / rect.width;
    const v = (clientY - rect.top) / rect.height;
    if (u < 0 || v < 0 || u > 1 || v > 1) return null;
    const side = this.view === "split" ? (u < 0.5 ? "A" : "B") : this.view;
    if (this.view === "split") u = u < 0.5 ? u * 2 : (u - 0.5) * 2;
    const crop = side === "B" ? this.cropB : this.cropA;
    const tu = crop[0] + u * (crop[2] - crop[0]);
    const tv = crop[1] + v * (crop[3] - crop[1]);
    const x = Math.floor(tu * world.w);
    const y = Math.floor(tv * world.h);
    if (x < 0 || y < 0 || x >= world.w || y >= world.h) return null;
    return { x, y };
  }

  gridToCanvas(gx: number, gy: number, world: World): { x: number; y: number } {
    const crop = this.view === "B" ? this.cropB : this.cropA;
    const tu = (gx + 0.5) / world.w;
    const tv = (gy + 0.5) / world.h;
    const u = (tu - crop[0]) / Math.max(1e-6, crop[2] - crop[0]);
    const v = (tv - crop[1]) / Math.max(1e-6, crop[3] - crop[1]);
    const rect = this.canvas.getBoundingClientRect();
    const split = this.view === "split";
    const offset = split && this.selectedWorld === "B" ? 0.5 : 0;
    return { x: rect.left + (u / (split ? 2 : 1) + offset) * rect.width, y: rect.top + v * rect.height };
  }

  pickWorld(clientX: number): "A" | "B" {
    if (this.view !== "split") return this.view;
    const rect = this.canvas.getBoundingClientRect();
    const u = (clientX - rect.left) / rect.width;
    return u < 0.5 ? "A" : "B";
  }
}

export { TRAIT_COLOR, hsl };
