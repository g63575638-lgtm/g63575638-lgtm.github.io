'use strict';
// ============================================================================
// Minimal WebGL2 engine layer: programs, meshes, instancing, textures, FBOs
// ============================================================================

const ATTR = { pos: 0, nrm: 1, col: 2, ext: 3, i0: 4, i1: 5, i2: 6 };

class GLX {
  constructor(gl) {
    this.gl = gl;
    this.programs = {};
    this.stats = { draws: 0, tris: 0 };
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
  }

  compile(name, vs, fs, defines = '') {
    const gl = this.gl;
    const pre = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2DShadow;\n' + defines + '\n';
    const mk = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, pre + src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        const lines = (pre + src).split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n');
        console.error('Shader error in ' + name + ':\n' + log + '\n' + lines);
        throw new Error('Shader compile failed: ' + name + ' ' + log);
      }
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    for (const k in ATTR) gl.bindAttribLocation(p, ATTR[k], 'a_' + k);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link failed ' + name + ': ' + gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name); }
    const prog = { p, u, name, texUnits: {} };
    // assign sampler units deterministically
    let unit = 0;
    gl.useProgram(p);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      if (info.type === gl.SAMPLER_2D || info.type === gl.SAMPLER_2D_SHADOW || info.type === gl.SAMPLER_2D_ARRAY) {
        prog.texUnits[info.name] = unit; gl.uniform1i(u[info.name], unit); unit++;
      }
    }
    this.programs[name] = prog;
    return prog;
  }

  use(prog) { if (this._cur !== prog) { this.gl.useProgram(prog.p); this._cur = prog; } return prog; }

  tex(prog, name, texture) {
    const unit = prog.texUnits[name]; if (unit === undefined) return;
    const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture);
  }

  // ------------------------------------------------------------- meshes
  // geo: {pos:Float32Array, nrm:Float32Array, col:Uint8Array (rgba), ext?:Float32Array (2 per vert), idx:Uint16/32Array}
  mesh(geo) {
    const gl = this.gl; const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const bufs = {};
    const buf = (data, loc, size, type, normalized) => {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, type, normalized, 0, 0); bufs[loc] = b; return b;
    };
    buf(geo.pos, ATTR.pos, 3, gl.FLOAT, false);
    if (geo.nrm) buf(geo.nrm, ATTR.nrm, 3, gl.FLOAT, false); else gl.vertexAttrib3f(ATTR.nrm, 0, 1, 0);
    if (geo.col) buf(geo.col, ATTR.col, 4, gl.UNSIGNED_BYTE, true); else gl.vertexAttrib4f(ATTR.col, 1, 1, 1, 1);
    if (geo.ext) buf(geo.ext, ATTR.ext, 2, gl.FLOAT, false); else gl.vertexAttrib2f(ATTR.ext, 0, 0);
    let count = geo.pos.length / 3, itype = 0, ib = null;
    if (geo.idx) {
      ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.idx, gl.STATIC_DRAW);
      count = geo.idx.length; itype = geo.idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    }
    gl.bindVertexArray(null);
    // bounds
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (let i = 0; i < geo.pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], geo.pos[i + k]); mx[k] = Math.max(mx[k], geo.pos[i + k]); }
    const center = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
    const radius = Math.hypot(mx[0] - center[0], mx[1] - center[1], mx[2] - center[2]);
    return { vao, count, itype, center, radius, mode: geo.mode || gl.TRIANGLES, instBuf: null, instCount: 0, bufs, ib, geo };
  }

  // a mesh (built from geo) that draws using another mesh's per-instance buffer (e.g. shadow proxies)
  shareInstances(geo, src) {
    const gl = this.gl; const m = this.mesh(geo); gl.bindVertexArray(m.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, src.instBuf);
    gl.enableVertexAttribArray(ATTR.i0); gl.vertexAttribPointer(ATTR.i0, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(ATTR.i0, 1);
    gl.enableVertexAttribArray(ATTR.i1); gl.vertexAttribPointer(ATTR.i1, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(ATTR.i1, 1);
    gl.bindVertexArray(null);
    m.instBuf = src.instBuf; Object.defineProperty(m, 'instCount', { get: () => src.instCount, set: () => { } });
    return m;
  }

  // attach per-instance attributes (i0,i1: vec4 each => 8 floats / instance)
  instancing(mesh, maxInstances) {
    const gl = this.gl; gl.bindVertexArray(mesh.vao);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, maxInstances * 32, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(ATTR.i0); gl.vertexAttribPointer(ATTR.i0, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(ATTR.i0, 1);
    gl.enableVertexAttribArray(ATTR.i1); gl.vertexAttribPointer(ATTR.i1, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(ATTR.i1, 1);
    gl.bindVertexArray(null);
    mesh.instBuf = b; mesh.instMax = maxInstances; mesh.instCount = 0;
    return mesh;
  }
  setInstances(mesh, data, count) {
    const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, mesh.instBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * 8); mesh.instCount = count;
  }

  draw(mesh) {
    const gl = this.gl; gl.bindVertexArray(mesh.vao);
    if (mesh.instBuf) {
      if (!mesh.instCount) return;
      if (mesh.itype) gl.drawElementsInstanced(mesh.mode, mesh.count, mesh.itype, 0, mesh.instCount);
      else gl.drawArraysInstanced(mesh.mode, 0, mesh.count, mesh.instCount);
      this.stats.tris += mesh.count / 3 * mesh.instCount;
    } else {
      if (mesh.itype) gl.drawElements(mesh.mode, mesh.count, mesh.itype, 0); else gl.drawArrays(mesh.mode, 0, mesh.count);
      this.stats.tris += mesh.count / 3;
    }
    this.stats.draws++;
  }
  drawRange(mesh, idxStart, idxCount) { // used for terrain LOD index ranges (UNSIGNED_INT)
    const gl = this.gl; gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, idxCount, mesh.itype, idxStart * (mesh.itype === gl.UNSIGNED_INT ? 4 : 2));
    this.stats.draws++; this.stats.tris += idxCount / 3;
  }

  // ------------------------------------------------------------- textures
  texture(w, h, opts = {}) {
    const gl = this.gl; const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    const ifmt = opts.internal || gl.RGBA8, fmt = opts.format || gl.RGBA, type = opts.type || gl.UNSIGNED_BYTE;
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, opts.data || null);
    const filt = opts.nearest ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opts.mip ? gl.LINEAR_MIPMAP_LINEAR : filt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
    const wrap = opts.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, opts.wrapS !== undefined ? opts.wrapS : wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    if (opts.mip) gl.generateMipmap(gl.TEXTURE_2D);
    t.w = w; t.h = h; return t;
  }
  canvasTexture(canvas, existing, mip = true) {
    const gl = this.gl; const t = existing || gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
    t.w = canvas.width; t.h = canvas.height; return t;
  }
  depthTarget(w, h) {
    const gl = this.gl; const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, t, 0);
    gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex: t, fb, w, h };
  }
  colorTarget(w, h) {
    const gl = this.gl; const t = this.texture(w, h, {});
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex: t, fb, w, h };
  }
}

// ---------------------------------------------------------------- frustum culling
class Frustum {
  constructor() { this.p = new Float32Array(24); }
  fromMatrix(m) {
    const p = this.p;
    const set = (i, a, b, c, d) => { const l = Math.hypot(a, b, c); p[i] = a / l; p[i + 1] = b / l; p[i + 2] = c / l; p[i + 3] = d / l; };
    set(0, m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]);
    set(4, m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);
    set(8, m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]);
    set(12, m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);
    set(16, m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]);
    set(20, m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]);
    return this;
  }
  sphere(x, y, z, r) {
    const p = this.p;
    for (let i = 0; i < 24; i += 4) if (p[i] * x + p[i + 1] * y + p[i + 2] * z + p[i + 3] < -r) return false;
    return true;
  }
}

// ---------------------------------------------------------------- geometry builder
class GeoBuilder {
  constructor() { this.p = []; this.n = []; this.c = []; this.e = []; this.i = []; }
  get vcount() { return this.p.length / 3; }
  vert(x, y, z, nx, ny, nz, r, g, b, a = 1, e0 = 0, e1 = 0) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz);
    this.c.push(clamp(r * 255, 0, 255) | 0, clamp(g * 255, 0, 255) | 0, clamp(b * 255, 0, 255) | 0, clamp(a * 255, 0, 255) | 0);
    this.e.push(e0, e1); return this.vcount - 1;
  }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  // merge another builder with a transform function (pos,nrm)->(pos,nrm)
  append(o, xf) {
    const base = this.vcount; const tp = [0, 0, 0], tn = [0, 0, 0];
    for (let k = 0; k < o.p.length / 3; k++) {
      tp[0] = o.p[k * 3]; tp[1] = o.p[k * 3 + 1]; tp[2] = o.p[k * 3 + 2]; tn[0] = o.n[k * 3]; tn[1] = o.n[k * 3 + 1]; tn[2] = o.n[k * 3 + 2];
      if (xf) xf(tp, tn);
      this.p.push(tp[0], tp[1], tp[2]); this.n.push(tn[0], tn[1], tn[2]);
      this.c.push(o.c[k * 4], o.c[k * 4 + 1], o.c[k * 4 + 2], o.c[k * 4 + 3]); this.e.push(o.e[k * 2], o.e[k * 2 + 1]);
    }
    for (const ix of o.i) this.i.push(ix + base);
  }
  build() {
    const big = this.vcount > 65535;
    return { pos: new Float32Array(this.p), nrm: new Float32Array(this.n), col: new Uint8Array(this.c), ext: new Float32Array(this.e), idx: big ? new Uint32Array(this.i) : new Uint16Array(this.i) };
  }
  // recompute smooth normals from triangles
  computeNormals() {
    const n = new Float32Array(this.p.length); const p = this.p;
    for (let t = 0; t < this.i.length; t += 3) {
      const a = this.i[t] * 3, b = this.i[t + 1] * 3, c = this.i[t + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz; }
    }
    for (let k = 0; k < n.length; k += 3) { const l = Math.hypot(n[k], n[k + 1], n[k + 2]) || 1; this.n[k] = n[k] / l; this.n[k + 1] = n[k + 1] / l; this.n[k + 2] = n[k + 2] / l; }
    return this;
  }
}
