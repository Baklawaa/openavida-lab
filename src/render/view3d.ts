/**
 * WebGL2 3D continuum view of the same World the 2D plate draws.
 * Height = nutrient + light; toxin tints magenta; organisms are lit columns.
 */
import type { World } from "../sim/world";
import { TERRAIN } from "../sim/types";
import { hexRgb, organismRgb } from "./webgl";

const VS_TERRAIN = `#version 300 es
precision highp float;
layout(location=0) in vec2 aUv;
uniform mat4 uMVP;
uniform mat4 uView;
uniform vec2 uWorld;
uniform sampler2D uFields;
uniform sampler2D uPlate;
uniform int uMode;
out vec3 vCol;
out vec3 vN;
out float vTox;
out vec3 vWorld;

vec3 fieldColor(vec4 f) {
  vec3 bg = vec3(0.04, 0.08, 0.12);
  vec3 nut = vec3(0.12, 0.95, 0.82) * pow(max(f.r, 0.0), 0.55);
  vec3 tox = vec3(0.98, 0.18, 0.58) * pow(max(f.g, 0.0), 0.55);
  vec3 cold = vec3(0.18, 0.38, 0.95);
  vec3 hot = vec3(0.98, 0.38, 0.08);
  vec3 tmp = mix(cold, hot, clamp(f.b, 0.0, 1.0)) * (0.22 + 0.55 * f.b);
  vec3 lit = vec3(1.0, 0.92, 0.58) * pow(max(f.a, 0.0), 0.9) * 0.55;
  if (uMode == 1) return bg + nut * 2.2;
  if (uMode == 2) return bg + tox * 2.2;
  if (uMode == 3) return bg + tmp * 2.2;
  if (uMode == 4) return bg + lit * 2.4;
  return bg + nut * 1.6 + tox * 1.3 + tmp + lit;
}

float heightAt(vec2 uv) {
  vec4 f = texture(uFields, uv);
  vec4 p = texture(uPlate, uv);
  float h = f.r * 0.85 + f.a * 0.35;
  h += f.g * 0.25;
  if (p.a > 0.8 && p.r < 0.08) h += 0.55;
  return h;
}

void main() {
  vec2 uv = aUv;
  vec4 f = texture(uFields, uv);
  float h = heightAt(uv);
  vec3 pos = vec3(uv.x * uWorld.x, h * 10.0, uv.y * uWorld.y);
  float eps = 1.0 / max(uWorld.x, uWorld.y);
  float hx = heightAt(uv + vec2(eps, 0.0)) * 10.0;
  float hz = heightAt(uv + vec2(0.0, eps)) * 10.0;
  vec3 n = normalize(vec3(-(hx - h * 10.0), 2.0 * eps * uWorld.x, -(hz - h * 10.0)));
  vN = n;
  vCol = fieldColor(f);
  vTox = f.g;
  vWorld = pos;
  gl_Position = uMVP * vec4(pos, 1.0);
}
`;

const FS_TERRAIN = `#version 300 es
precision highp float;
in vec3 vCol;
in vec3 vN;
in float vTox;
in vec3 vWorld;
uniform vec3 uLight;
uniform vec3 uCam;
out vec4 fragColor;
void main() {
  vec3 n = normalize(vN);
  vec3 l = normalize(uLight);
  float diff = max(0.0, dot(n, l));
  vec3 v = normalize(uCam - vWorld);
  vec3 h = normalize(l + v);
  float spec = pow(max(0.0, dot(n, h)), 24.0) * 0.18;
  vec3 col = vCol * (0.45 + 0.65 * diff) + vec3(spec);
  col += vec3(0.45, 0.05, 0.28) * vTox * 0.35;
  float fog = smoothstep(90.0, 220.0, length(uCam - vWorld));
  col = mix(col, vec3(0.01, 0.02, 0.04), fog * 0.55);
  fragColor = vec4(col, 1.0);
}
`;

const VS_ORG = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aIPos;
layout(location=2) in vec3 aICol;
layout(location=3) in float aISel;
uniform mat4 uMVP;
uniform vec3 uLight;
out vec3 vCol;
out vec3 vN;
out float vSel;
void main() {
  vec3 n = abs(aPos);
  vN = n.y > n.x && n.y > n.z ? vec3(0.0, sign(aPos.y), 0.0)
     : n.x > n.z ? vec3(sign(aPos.x), 0.0, 0.0)
     : vec3(0.0, 0.0, sign(aPos.z));
  float s = 0.42;
  vec3 p = vec3(aIPos.x, aIPos.y, aIPos.z) + aPos * vec3(s, aIPos.y * 0.9 + 0.35, s);
  vCol = aICol;
  vSel = aISel;
  gl_Position = uMVP * vec4(p, 1.0);
}
`;

const FS_ORG = `#version 300 es
precision highp float;
in vec3 vCol;
in vec3 vN;
in float vSel;
uniform vec3 uLight;
out vec4 fragColor;
void main() {
  vec3 n = normalize(vN);
  float diff = max(0.12, dot(n, normalize(uLight)));
  vec3 col = vCol * (0.35 + 0.65 * diff);
  if (vSel > 0.5) col = mix(col, vec3(0.9, 1.0, 0.95), 0.45);
  fragColor = vec4(col, 1.0);
}
`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? "compile";
    gl.deleteShader(sh);
    throw new Error(log);
  }
  return sh;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
  return p;
}

function mat4ident(): Float32Array {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function mat4mul(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + a[12 + r]! * b[c * 4 + 3]!;
    }
  }
  return o;
}

function perspective(fovy: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovy / 2);
  const o = new Float32Array(16);
  o[0] = f / aspect;
  o[5] = f;
  o[10] = (far + near) / (near - far);
  o[11] = -1;
  o[14] = (2 * far * near) / (near - far);
  return o;
}

function lookAt(eye: [number, number, number], center: [number, number, number], up: [number, number, number]): Float32Array {
  const zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
  let zl = Math.hypot(zx, zy, zz) || 1;
  const z0 = zx / zl, z1 = zy / zl, z2 = zz / zl;
  let x0 = up[1] * z2 - up[2] * z1;
  let x1 = up[2] * z0 - up[0] * z2;
  let x2 = up[0] * z1 - up[1] * z0;
  const xl = Math.hypot(x0, x1, x2) || 1;
  x0 /= xl; x1 /= xl; x2 /= xl;
  const y0 = z1 * x2 - z2 * x1;
  const y1 = z2 * x0 - z0 * x2;
  const y2 = z0 * x1 - z1 * x0;
  const o = mat4ident();
  o[0] = x0; o[1] = y0; o[2] = z0;
  o[4] = x1; o[5] = y1; o[6] = z1;
  o[8] = x2; o[9] = y2; o[10] = z2;
  o[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
  o[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
  o[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
  return o;
}

export class View3D {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  private terrainProg: WebGLProgram;
  private orgProg: WebGLProgram;
  private fieldTex: WebGLTexture;
  private plateTex: WebGLTexture;
  private terrainVao: WebGLVertexArrayObject;
  private terrainCount = 0;
  private cubeVao: WebGLVertexArrayObject;
  private instBuf: WebGLBuffer;
  private rgba = new Uint8Array(4);
  private plate = new Uint8Array(4);
  private gridN = 96;

  yaw = 0.62;
  pitch = 0.55;
  dist = 105;
  selectedId = -1;
  fieldMode = 0;
  /** Color organism columns by founding strain instead of guild + lineage. */
  colorByStrain = false;
  dragging = false;
  private lastX = 0;
  private lastY = 0;
  moved = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL2 required for 3D view");
    this.gl = gl;
    this.terrainProg = program(gl, VS_TERRAIN, FS_TERRAIN);
    this.orgProg = program(gl, VS_ORG, FS_ORG);
    this.fieldTex = this.makeTex();
    this.plateTex = this.makeTex();
    this.terrainVao = this.buildGrid(this.gridN);
    this.cubeVao = this.buildCube();
    this.instBuf = gl.createBuffer()!;
  }

  private makeTex(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private buildGrid(n: number): WebGLVertexArrayObject {
    const gl = this.gl;
    const verts: number[] = [];
    const idx: number[] = [];
    for (let y = 0; y <= n; y++) {
      for (let x = 0; x <= n; x++) verts.push(x / n, y / n);
    }
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * (n + 1) + x;
        idx.push(i, i + 1, i + n + 1, i + 1, i + n + 2, i + n + 1);
      }
    }
    this.terrainCount = idx.length;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return vao;
  }

  private buildCube(): WebGLVertexArrayObject {
    const gl = this.gl;
    const p = new Float32Array([
      -1, 0, -1, 1, 0, -1, 1, 1, -1, -1, 0, -1, 1, 1, -1, -1, 1, -1,
      -1, 0, 1, -1, 1, 1, 1, 1, 1, -1, 0, 1, 1, 1, 1, 1, 0, 1,
      -1, 0, -1, -1, 0, 1, 1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0, -1,
      -1, 1, -1, 1, 1, -1, 1, 1, 1, -1, 1, -1, 1, 1, 1, -1, 1, 1,
      -1, 0, -1, -1, 1, -1, -1, 1, 1, -1, 0, -1, -1, 1, 1, -1, 0, 1,
      1, 0, -1, 1, 0, 1, 1, 1, 1, 1, 0, -1, 1, 1, 1, 1, 1, -1,
    ]);
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, p, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
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

  private eye(world: World): [number, number, number] {
    const cx = world.w * 0.5;
    const cz = world.h * 0.5;
    const cy = 2;
    const cp = Math.cos(this.pitch);
    return [
      cx + Math.sin(this.yaw) * cp * this.dist,
      cy + Math.sin(this.pitch) * this.dist,
      cz + Math.cos(this.yaw) * cp * this.dist,
    ];
  }

  private mvp(world: World): { mvp: Float32Array; eye: [number, number, number] } {
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const proj = perspective((42 * Math.PI) / 180, aspect, 0.4, 600);
    const eye = this.eye(world);
    const view = lookAt(eye, [world.w * 0.5, 1.5, world.h * 0.5], [0, 1, 0]);
    return { mvp: mat4mul(proj, view), eye };
  }

  private upload(world: World): void {
    const gl = this.gl;
    const n = world.w * world.h;
    if (this.rgba.length !== n * 4) this.rgba = new Uint8Array(n * 4);
    if (this.plate.length !== n * 4) this.plate = new Uint8Array(n * 4);
    world.fields.packRGBA(this.rgba);
    const plate = this.plate;
    plate.fill(0);
    for (let i = 0; i < n; i++) {
      const t = world.terrain[i]!;
      const o = i * 4;
      if (t === TERRAIN.barrier) {
        plate[o] = 8; plate[o + 1] = 10; plate[o + 2] = 14; plate[o + 3] = 255;
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, world.w, world.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.rgba);
    gl.bindTexture(gl.TEXTURE_2D, this.plateTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, world.w, world.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, plate);
  }

  draw(world: World): void {
    const gl = this.gl;
    this.upload(world);
    const { mvp, eye } = this.mvp(world);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0.03, 0.05, 0.08, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const light: [number, number, number] = [0.45, 0.82, 0.35];

    gl.useProgram(this.terrainProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.terrainProg, "uMVP"), false, mvp);
    gl.uniform2f(gl.getUniformLocation(this.terrainProg, "uWorld"), world.w, world.h);
    gl.uniform1i(gl.getUniformLocation(this.terrainProg, "uMode"), this.fieldMode);
    gl.uniform3f(gl.getUniformLocation(this.terrainProg, "uLight"), light[0], light[1], light[2]);
    gl.uniform3f(gl.getUniformLocation(this.terrainProg, "uCam"), eye[0], eye[1], eye[2]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
    gl.uniform1i(gl.getUniformLocation(this.terrainProg, "uFields"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.plateTex);
    gl.uniform1i(gl.getUniformLocation(this.terrainProg, "uPlate"), 1);
    gl.bindVertexArray(this.terrainVao);
    gl.drawElements(gl.TRIANGLES, this.terrainCount, gl.UNSIGNED_INT, 0);

    const orgs = world.organisms;
    const inst = new Float32Array(orgs.length * 7);
    for (let i = 0; i < orgs.length; i++) {
      const o = orgs[i]!;
      const env = world.fields.sample(o.x, o.y);
      const h = (env.nutrient * 0.85 + env.light * 0.35) * 10 + 0.2;
      const strain = this.colorByStrain ? world.strains.get(o.strainId) : undefined;
      const [r, g, b] = strain ? hexRgb(strain.color) : organismRgb(o.ph, o.lineageId);
      const off = i * 7;
      inst[off] = o.x + 0.5;
      inst[off + 1] = h + o.ph.size * 0.55;
      inst[off + 2] = o.y + 0.5;
      inst[off + 3] = r;
      inst[off + 4] = g;
      inst[off + 5] = b;
      inst[off + 6] = o.id === this.selectedId ? 1 : 0;
    }
    gl.useProgram(this.orgProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.orgProg, "uMVP"), false, mvp);
    gl.uniform3f(gl.getUniformLocation(this.orgProg, "uLight"), light[0], light[1], light[2]);
    gl.bindVertexArray(this.cubeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, inst, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 28, 12);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 28, 24);
    gl.vertexAttribDivisor(3, 1);
    if (orgs.length) gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, orgs.length);
    gl.bindVertexArray(null);
  }

  orbit(dx: number, dy: number): void {
    this.yaw += dx * 0.008;
    this.pitch = Math.max(0.12, Math.min(1.35, this.pitch + dy * 0.008));
  }

  zoomBy(delta: number): void {
    this.dist = Math.max(28, Math.min(320, this.dist * (delta > 0 ? 1.08 : 0.92)));
  }

  /** Ray ∩ y=0 plane → grid cell of the same world. */
  pick(clientX: number, clientY: number, world: World): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const u = ((clientX - rect.left) / rect.width) * 2 - 1;
    const v = -(((clientY - rect.top) / rect.height) * 2 - 1);
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const fovy = (42 * Math.PI) / 180;
    const tan = Math.tan(fovy / 2);
    const eye = this.eye(world);
    const target: [number, number, number] = [world.w * 0.5, 1.5, world.h * 0.5];
    const zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
    const zl = Math.hypot(zx, zy, zz) || 1;
    const fz = [zx / zl, zy / zl, zz / zl];
    let rx = 0 * fz[2] - 1 * fz[1];
    let ry = 1 * fz[0] - 0 * fz[2];
    let rz = 0 * fz[1] - 0 * fz[0];
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    const ux = ry * fz[2] - rz * fz[1];
    const uy = rz * fz[0] - rx * fz[2];
    const uz = rx * fz[1] - ry * fz[0];
    const dx = rx * (u * tan * aspect) - ux * (v * tan) - fz[0];
    const dy = ry * (u * tan * aspect) - uy * (v * tan) - fz[1];
    const dz = rz * (u * tan * aspect) - uz * (v * tan) - fz[2];
    if (Math.abs(dy) < 1e-6) return null;
    const t = -eye[1] / dy;
    if (t < 0) return null;
    const gx = Math.floor(eye[0] + dx * t);
    const gy = Math.floor(eye[2] + dz * t);
    if (gx < 0 || gy < 0 || gx >= world.w || gy >= world.h) return null;
    return { x: gx, y: gy };
  }

  pointerDown(ev: PointerEvent): void {
    this.dragging = true;
    this.lastX = ev.clientX;
    this.lastY = ev.clientY;
    this.moved = 0;
  }

  pointerMove(ev: PointerEvent): void {
    if (!this.dragging) return;
    const dx = ev.clientX - this.lastX;
    const dy = ev.clientY - this.lastY;
    this.lastX = ev.clientX;
    this.lastY = ev.clientY;
    this.moved += Math.abs(dx) + Math.abs(dy);
    this.orbit(dx, dy);
  }

  pointerUp(): boolean {
    this.dragging = false;
    return this.moved < 5;
  }
}
