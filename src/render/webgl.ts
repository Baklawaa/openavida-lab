import type { World } from "../sim/world";
import { TRAIT_COLOR } from "../sim/mapping";
import { TERRAIN } from "../sim/types";

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
out vec4 fragColor;

vec3 fieldColor(vec4 f) {
  vec3 bg = vec3(0.012, 0.02, 0.038);
  vec3 nut = vec3(0.05, 0.95, 0.78) * pow(max(f.r, 0.0), 0.65);
  vec3 tox = vec3(0.98, 0.12, 0.58) * pow(max(f.g, 0.0), 0.62);
  vec3 cold = vec3(0.12, 0.32, 0.95);
  vec3 hot = vec3(0.98, 0.32, 0.06);
  vec3 tmp = mix(cold, hot, clamp(f.b, 0.0, 1.0)) * (0.12 + 0.42 * f.b);
  vec3 lit = vec3(1.0, 0.9, 0.55) * pow(max(f.a, 0.0), 1.2) * 0.16;
  if (uMode == 1) return bg + nut * 1.7;
  if (uMode == 2) return bg + tox * 1.7;
  if (uMode == 3) return bg + tmp * 1.9;
  if (uMode == 4) return bg + lit * 2.2;
  return bg + nut * 1.05 + tox * 0.9 + tmp + lit;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 tuv;
  vec4 f;
  vec4 plate;
  if (uSplit == 1) {
    if (uv.x < 0.5) {
      tuv = vec2(uv.x * 2.0, 1.0 - uv.y);
      f = texture(uFields, tuv);
      plate = texture(uPlate, tuv);
    } else {
      tuv = vec2((uv.x - 0.5) * 2.0, 1.0 - uv.y);
      f = texture(uFieldsB, tuv);
      plate = texture(uPlateB, tuv);
    }
  } else {
    tuv = vec2(uv.x, 1.0 - uv.y);
    f = texture(uFields, tuv);
    plate = texture(uPlate, tuv);
  }
  vec3 col = fieldColor(f);
  if (plate.a > 0.02) {
    col = mix(col, plate.rgb, plate.a);
    vec2 c = fract(tuv * uWorld);
    float hair = (c.x < 0.07 || c.y < 0.07) ? 1.0 : 0.0;
    col *= 1.0 - hair * 0.22 * plate.a;
  }
  float vig = smoothstep(1.15, 0.22, length(uv - 0.5));
  col *= 0.82 + 0.18 * vig;
  float g = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (g - 0.5) * 0.012;
  if (uSplit == 1) {
    float line = smoothstep(0.003, 0.0, abs(uv.x - 0.5));
    col = mix(col, vec3(0.25, 0.85, 0.75), line * 0.55);
  }
  fragColor = vec4(col, 1.0);
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

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Display color from dominant metabolic trait, tinted by the hue locus. */
export function organismRgb(ph: { uptake: number; photo: number; resist: number; aggression: number; signal: number; hue: number }): [number, number, number] {
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
  const [hr, hg, hb] = hsl(ph.hue, 0.62, 0.58);
  return [br * 0.9 + hr * 0.1, bg * 0.9 + hg * 0.1, bb * 0.9 + hb * 0.1];
}

export type FieldMode = 0 | 1 | 2 | 3 | 4;
export type ViewMode = "A" | "B" | "split";

export class LabRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  private fieldProg: WebGLProgram;
  private texA: WebGLTexture;
  private texB: WebGLTexture;
  private plateA: WebGLTexture;
  private plateB: WebGLTexture;
  private rgba: Uint8Array;
  private plate: Uint8Array;

  fieldMode: FieldMode = 0;
  view: ViewMode = "A";
  selectedId = -1;

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
    for (const org of world.organisms) {
      const i = (org.y * world.w + org.x) * 4;
      const [r, g, b] = organismRgb(org.ph);
      const sel = org.id === this.selectedId;
      out[i] = sel ? 230 : Math.round(r * 255);
      out[i + 1] = sel ? 255 : Math.round(g * 255);
      out[i + 2] = sel ? 245 : Math.round(b * 255);
      out[i + 3] = 255;
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
    gl.useProgram(this.fieldProg);
    gl.uniform2f(gl.getUniformLocation(this.fieldProg, "uRes"), this.canvas.width, this.canvas.height);
    gl.uniform2f(gl.getUniformLocation(this.fieldProg, "uWorld"), primary.w, primary.h);
    gl.uniform1f(gl.getUniformLocation(this.fieldProg, "uTime"), timeSec);
    gl.uniform1i(gl.getUniformLocation(this.fieldProg, "uMode"), this.fieldMode);
    gl.uniform1i(gl.getUniformLocation(this.fieldProg, "uSplit"), split ? 1 : 0);
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
  }

  canvasToGrid(clientX: number, clientY: number, world: World): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    let u = (clientX - rect.left) / rect.width;
    const v = (clientY - rect.top) / rect.height;
    if (u < 0 || v < 0 || u > 1 || v > 1) return null;
    if (this.view === "split") {
      u = u < 0.5 ? u * 2 : (u - 0.5) * 2;
    }
    const x = Math.floor(u * world.w);
    const y = Math.floor(v * world.h);
    if (x < 0 || y < 0 || x >= world.w || y >= world.h) return null;
    return { x, y };
  }

  pickWorld(clientX: number): "A" | "B" {
    if (this.view !== "split") return this.view;
    const rect = this.canvas.getBoundingClientRect();
    const u = (clientX - rect.left) / rect.width;
    return u < 0.5 ? "A" : "B";
  }
}

export { TRAIT_COLOR, hsl };
