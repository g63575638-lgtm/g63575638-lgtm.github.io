'use strict';
// ============================================================================
// Premium minimal VR interface: canvas-rendered panels in world space,
// laser pointers, animated hover/press states, page transitions, brand logo.
// ============================================================================

const FONT = '"Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif';
const COL = {
  glass: 'rgba(12,16,20,0.80)', glass2: 'rgba(255,255,255,0.06)', line: 'rgba(255,255,255,0.10)', text: '#F4F6F5', dim: 'rgba(244,246,245,0.62)', faint: 'rgba(244,246,245,0.35)',
  accent: '#FF6A3D', accent2: '#FFB547', green: '#7ED69A', red: '#FF5E5E', blue: '#64B5FF', gold: '#FFD166',
};

// ---------------------------------------------------------------- drawing helpers
const UIDraw = {
  rr(ctx, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); },
  text(ctx, s, x, y, size, opts = {}) {
    ctx.font = `${opts.weight || 500} ${size}px ${FONT}`; ctx.fillStyle = opts.color || COL.text; ctx.textAlign = opts.align || 'left'; ctx.textBaseline = opts.base || 'middle';
    if (opts.spacing !== undefined && 'letterSpacing' in ctx) ctx.letterSpacing = opts.spacing + 'px'; else if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    if (opts.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = opts.shadow; }
    if (opts.maxW) { let t = s; while (ctx.measureText(t).width > opts.maxW && t.length > 3) t = t.slice(0, -2) + '…'; s = t; }
    ctx.fillText(s, x, y); ctx.shadowBlur = 0;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  },
  wrap(ctx, s, x, y, maxW, size, lh, opts = {}) {
    ctx.font = `${opts.weight || 400} ${size}px ${FONT}`; const lines = [];
    for (const para of String(s).split('\n')) {
      if (!para) { lines.push(''); continue; }
      let line = ''; for (const w of para.split(' ')) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
      lines.push(line);
    }
    lines.forEach((l, i) => UIDraw.text(ctx, l, x, y + i * lh, size, Object.assign({ base: 'top' }, opts)));
    return lines.length * lh;
  },
  glassPanel(ctx, x, y, w, h, r = 36) {
    ctx.save();
    UIDraw.rr(ctx, x, y, w, h, r); ctx.fillStyle = COL.glass; ctx.fill();
    const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, 'rgba(255,255,255,0.07)'); g.addColorStop(0.4, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = COL.line; ctx.stroke();
    ctx.restore();
  },
  accentGrad(ctx, x0, y0, x1, y1) { const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, COL.accent); g.addColorStop(1, COL.accent2); return g; },
};

// ---------------------------------------------------------------- FUTON GROUP logo
function drawFutonMark(ctx, cx, cy, s, t = 1) {
  // rounded tile with gradient + three stacked "cushion" bars forming an F
  const a = smoothstep(0, 0.35, t);
  ctx.save(); ctx.globalAlpha *= a;
  ctx.translate(cx, cy); const sc = 0.85 + 0.15 * easeOutBack(clamp(t / 0.45, 0, 1)); ctx.scale(sc, sc);
  const r = s * 0.24; UIDraw.rr(ctx, -s / 2, -s / 2, s, s, r);
  const g = ctx.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2); g.addColorStop(0, '#FF4F3A'); g.addColorStop(0.55, '#FF7A3D'); g.addColorStop(1, '#FFB84A');
  ctx.fillStyle = g; ctx.shadowColor = 'rgba(255,100,50,0.45)'; ctx.shadowBlur = s * 0.18; ctx.fill(); ctx.shadowBlur = 0;
  // inner highlight
  const hg = ctx.createLinearGradient(0, -s / 2, 0, 0); hg.addColorStop(0, 'rgba(255,255,255,0.28)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
  UIDraw.rr(ctx, -s / 2 + 3, -s / 2 + 3, s - 6, s / 2, r * 0.9); ctx.fillStyle = hg; ctx.fill();
  const bars = [[0.62, -0.2], [0.44, 0.02], [0.2, 0.24]];
  bars.forEach(([w, y], i) => {
    const bt = clamp((t - 0.25 - i * 0.12) / 0.3, 0, 1); const e = easeOutCubic(bt);
    const bw = s * w * e, bh = s * 0.15, x = -s * 0.31, yy = s * y - bh / 2;
    ctx.globalAlpha = a * e; UIDraw.rr(ctx, x, yy, Math.max(bw, bh * 0.2), bh, bh / 2); ctx.fillStyle = '#FFFFFF'; ctx.fill();
  });
  ctx.restore();
}
function drawFutonLogo(ctx, cx, cy, size, t = 1, opts = {}) {
  // mark + wordmark (horizontal)
  const s = size; const mx = cx - s * 1.55;
  drawFutonMark(ctx, mx, cy, s, t);
  const wt = clamp((t - 0.45) / 0.45, 0, 1); const e = easeOutCubic(wt);
  ctx.save(); ctx.globalAlpha *= e;
  UIDraw.text(ctx, 'FUTON', mx + s * 0.72 + (1 - e) * 30, cy - s * 0.12, s * 0.62, { weight: 800, spacing: s * 0.05 + (1 - e) * s * 0.2, color: opts.color || '#FFFFFF' });
  UIDraw.text(ctx, 'GROUP', mx + s * 0.76 + (1 - e) * 30, cy + s * 0.34, s * 0.22, { weight: 400, spacing: s * 0.24 + (1 - e) * s * 0.3, color: opts.sub || 'rgba(255,255,255,0.75)' });
  ctx.restore();
}
function drawGameTitle(ctx, cx, cy, size, t = 1) {
  const e = easeOutCubic(clamp(t, 0, 1));
  ctx.save(); ctx.globalAlpha *= e;
  ctx.font = `800 ${size}px ${FONT}`; if ('letterSpacing' in ctx) ctx.letterSpacing = size * 0.06 + 'px';
  const w1 = ctx.measureText('FUTON GOLF').width; if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  const pillW = size * 1.25, gap = size * 0.25, total = w1 + gap + pillW; const x0 = cx - total / 2;
  UIDraw.text(ctx, 'FUTON GOLF', x0, cy, size, { weight: 800, spacing: size * 0.06, shadow: 18 });
  UIDraw.rr(ctx, x0 + w1 + gap, cy - size * 0.42, pillW, size * 0.84, size * 0.22); ctx.fillStyle = UIDraw.accentGrad(ctx, x0 + w1, 0, x0 + total, 0); ctx.fill();
  UIDraw.text(ctx, 'VR', x0 + w1 + gap + pillW / 2, cy + size * 0.02, size * 0.6, { weight: 800, align: 'center', spacing: size * 0.04 });
  // golf ball dot over the "O" of GOLF as a subtle flourish
  ctx.restore();
}
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeOutBack(t) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

// stylised landscape art for map cards
function drawCourseArt(ctx, mapId, x, y, w, h, time) {
  ctx.save(); UIDraw.rr(ctx, x, y, w, h, 22); ctx.clip();
  const T0 = TIMES[time || ({ valley: 'noon', coast: 'sunset', mountain: 'morning' })[mapId]];
  const css = c => `rgb(${clamp(c[0] * 255, 0, 255) | 0},${clamp(c[1] * 255, 0, 255) | 0},${clamp(c[2] * 255, 0, 255) | 0})`;
  const sky = ctx.createLinearGradient(0, y, 0, y + h * 0.7); sky.addColorStop(0, css(T0.zenith.map(v => v * 1.3))); sky.addColorStop(1, css(T0.horizon));
  ctx.fillStyle = sky; ctx.fillRect(x, y, w, h);
  const sunY = y + h * (mapId === 'coast' ? 0.55 : mapId === 'mountain' ? 0.25 : 0.18), sunX = x + w * (mapId === 'coast' ? 0.3 : 0.75);
  const sg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, h * 0.5); sg.addColorStop(0, 'rgba(255,240,200,0.95)'); sg.addColorStop(0.08, 'rgba(255,220,160,0.7)'); sg.addColorStop(1, 'rgba(255,200,150,0)');
  ctx.fillStyle = sg; ctx.fillRect(x, y, w, h);
  const rng = mulberry32(mapId.length * 77);
  const ridge = (baseY, amp, freq, col, seed, snow) => {
    ctx.beginPath(); ctx.moveTo(x, y + h);
    for (let i = 0; i <= 64; i++) { const px = x + w * i / 64; const py = baseY - amp * (0.5 + 0.5 * ridged(i / 64 * freq + seed, seed * 0.3, 4)); ctx.lineTo(px, py); }
    ctx.lineTo(x + w, y + h); ctx.closePath(); ctx.fillStyle = col; ctx.fill();
    if (snow) { ctx.save(); ctx.clip(); ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillRect(x, baseY - amp * 1.1, w, amp * 0.42); ctx.restore(); }
  };
  if (mapId === 'valley') {
    ridge(y + h * 0.58, h * 0.32, 3, 'rgb(120,140,165)', 3, true);
    ridge(y + h * 0.7, h * 0.14, 2, 'rgb(70,120,70)', 7);
    ridge(y + h * 0.82, h * 0.1, 1.5, 'rgb(76,140,60)', 11);
    ctx.fillStyle = 'rgba(120,170,210,0.85)'; ctx.beginPath(); ctx.ellipse(x + w * 0.3, y + h * 0.86, w * 0.18, h * 0.035, 0, 0, TAU); ctx.fill();
  } else if (mapId === 'coast') {
    const sea = ctx.createLinearGradient(0, y + h * 0.58, 0, y + h); sea.addColorStop(0, 'rgb(230,140,110)'); sea.addColorStop(1, 'rgb(40,80,120)');
    ctx.fillStyle = sea; ctx.fillRect(x, y + h * 0.58, w, h); ctx.fillStyle = 'rgba(255,220,160,0.6)'; ctx.fillRect(sunX - w * 0.08, y + h * 0.6, w * 0.16, 3); ctx.fillRect(sunX - w * 0.05, y + h * 0.66, w * 0.1, 2);
    ctx.beginPath(); ctx.moveTo(x + w * 0.45, y + h); ctx.lineTo(x + w * 0.52, y + h * 0.66); ctx.lineTo(x + w * 0.62, y + h * 0.62); ctx.lineTo(x + w, y + h * 0.6); ctx.lineTo(x + w, y + h); ctx.fillStyle = 'rgb(90,110,50)'; ctx.fill();
    ctx.fillStyle = 'rgb(150,100,70)'; ctx.fillRect(x + w * 0.47, y + h * 0.7, w * 0.06, h * 0.3);
    // palm
    ctx.strokeStyle = 'rgb(40,35,30)'; ctx.lineWidth = w * 0.012; ctx.beginPath(); ctx.moveTo(x + w * 0.82, y + h); ctx.quadraticCurveTo(x + w * 0.8, y + h * 0.6, x + w * 0.86, y + h * 0.42); ctx.stroke();
    for (let k = 0; k < 7; k++) { const a = -PI * 0.1 - k * 0.42; ctx.beginPath(); ctx.moveTo(x + w * 0.86, y + h * 0.42); ctx.quadraticCurveTo(x + w * 0.86 + Math.cos(a) * w * 0.08, y + h * 0.42 + Math.sin(a) * h * 0.12 - h * 0.05, x + w * 0.86 + Math.cos(a) * w * 0.14, y + h * 0.42 + Math.sin(a) * h * 0.2 + h * 0.04); ctx.lineWidth = w * 0.008; ctx.stroke(); }
  } else {
    ridge(y + h * 0.62, h * 0.5, 2.5, 'rgb(110,125,150)', 5, true);
    ridge(y + h * 0.74, h * 0.2, 2, 'rgb(50,80,60)', 9);
    for (let k = 0; k < 18; k++) { const px = x + w * (k / 18 + rng() * 0.04), base = y + h * (0.8 + rng() * 0.12), th = h * (0.1 + rng() * 0.08); ctx.beginPath(); ctx.moveTo(px, base - th); ctx.lineTo(px + th * 0.3, base); ctx.lineTo(px - th * 0.3, base); ctx.fillStyle = 'rgb(25,55,38)'; ctx.fill(); }
    ctx.fillStyle = 'rgba(110,160,190,0.9)'; ctx.beginPath(); ctx.ellipse(x + w * 0.55, y + h * 0.9, w * 0.2, h * 0.03, 0, 0, TAU); ctx.fill();
  }
  // fairway + flag
  ctx.fillStyle = 'rgba(120,200,90,0.9)'; ctx.beginPath(); ctx.ellipse(x + w * 0.68, y + h * 0.93, w * 0.26, h * 0.06, -0.05, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x + w * 0.72, y + h * 0.93); ctx.lineTo(x + w * 0.72, y + h * 0.78); ctx.stroke();
  ctx.fillStyle = COL.accent; ctx.beginPath(); ctx.moveTo(x + w * 0.72, y + h * 0.78); ctx.lineTo(x + w * 0.77, y + h * 0.8); ctx.lineTo(x + w * 0.72, y + h * 0.82); ctx.fill();
  const vg = ctx.createLinearGradient(0, y + h * 0.55, 0, y + h); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)'); ctx.fillStyle = vg; ctx.fillRect(x, y, w, h);
  ctx.restore();
}

// ---------------------------------------------------------------- Panel
class Panel {
  constructor(ui, name, pxW, pxH, mW, opts = {}) {
    this.ui = ui; this.name = name; this.pxW = pxW; this.pxH = pxH; this.mW = mW; this.mH = mW * pxH / pxW;
    this.canvas = document.createElement('canvas'); this.canvas.width = pxW; this.canvas.height = pxH; this.ctx = this.canvas.getContext('2d');
    this.tex = null; this.mesh = ui.glx.mesh(GEO.quad(this.mW, this.mH).build());
    this.matrix = M4.new(); this.opacity = 0; this.targetOpacity = 0; this.visible = false;
    this.regions = []; this.hover = {}; this.hoverId = null; this.press = {}; this.dirty = true; this.anim = 0; this.t = 0;
    this.draw = null; this.interactive = opts.interactive !== false; this.mip = opts.mip !== false; this.scale = 1; this.always = !!opts.always;
  }
  show(drawFn) { if (drawFn) { this.draw = drawFn; this.t = 0; } this.targetOpacity = 1; this.visible = true; this.dirty = true; }
  hide() { this.targetOpacity = 0; }
  setPage(drawFn) { this.draw = drawFn; this.t = 0; this.pageT = 0; this.hover = {}; this.dirty = true; }
  region(id, x, y, w, h, onClick, opts = {}) { this.regions.push({ id, x, y, w, h, onClick, opts }); return this.hover[id] || 0; }
  update(dt) {
    this.opacity += (this.targetOpacity - this.opacity) * Math.min(1, dt * 9);
    if (this.targetOpacity === 0 && this.opacity < 0.01) { this.visible = false; this.opacity = 0; }
    this.t += dt; this.pageT = (this.pageT || 0) + dt;
    let animating = this.pageT < 0.6 || this.always;
    for (const r of this.regions) {
      const h = this.hover[r.id] || 0; const target = this.hoverId === r.id ? 1 : 0;
      const nh = h + (target - h) * Math.min(1, dt * 14); if (Math.abs(nh - h) > 0.002) animating = true; this.hover[r.id] = Math.abs(nh - target) < 0.002 ? target : nh;
      const p = this.press[r.id] || 0; if (p > 0) { this.press[r.id] = Math.max(0, p - dt * 4); animating = true; }
    }
    if (this.visible && (this.dirty || animating)) this.redraw();
  }
  redraw() {
    const ctx = this.ctx; ctx.clearRect(0, 0, this.pxW, this.pxH); this.regions = [];
    if (this.draw) this.draw(ctx, this);
    this.tex = this.ui.glx.canvasTexture(this.canvas, this.tex, this.mip); this.dirty = false;
  }
  // ray hit test -> region id
  hitTest(o, d) {
    if (!this.visible || this.opacity < 0.3 || !this.interactive) return null;
    const m = this.matrix; const n = [m[8], m[9], m[10]]; const c = [m[12], m[13], m[14]];
    const den = V3.dot(d, n); if (Math.abs(den) < 1e-5) return null;
    const t = V3.dot(V3.sub([0, 0, 0], c, o), n) / den; if (t < 0) return null;
    const p = V3.madd([0, 0, 0], o, d, t); const rel = V3.sub([0, 0, 0], p, c);
    const sx = Math.hypot(m[0], m[1], m[2]), sy = Math.hypot(m[4], m[5], m[6]);
    const lx = V3.dot(rel, [m[0] / sx, m[1] / sx, m[2] / sx]) / sx, ly = V3.dot(rel, [m[4] / sy, m[5] / sy, m[6] / sy]) / sy;
    if (Math.abs(lx) > this.mW / 2 || Math.abs(ly) > this.mH / 2) return null;
    const px = (lx / this.mW + 0.5) * this.pxW, py = (0.5 - ly / this.mH) * this.pxH;
    let id = null, reg = null;
    for (const r of this.regions) if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) { id = r.id; reg = r; }
    return { t, point: p, id, reg, px, py };
  }
  placeFacing(pos, target, scale = 1) {
    const z = V3.norm([0, 0, 0], V3.sub([0, 0, 0], target, pos)); const x = V3.norm([0, 0, 0], V3.cross([0, 0, 0], [0, 1, 0], z)); const y = V3.cross([0, 0, 0], z, x);
    M4.fromBasis(this.matrix, pos, x, y, z, scale); this.scale = scale;
  }
}

// ---------------------------------------------------------------- widgets drawn inside pages
const W = {
  button(ctx, P, id, x, y, w, h, label, onClick, opts = {}) {
    const hv = P.region(id, x, y, w, h, onClick, opts); const pr = P.press[id] || 0;
    const grow = hv * 6 - pr * 4;
    ctx.save();
    UIDraw.rr(ctx, x - grow / 2, y - grow / 2, w + grow, h + grow, opts.r || h / 2);
    if (opts.primary) { ctx.fillStyle = UIDraw.accentGrad(ctx, x, y, x + w, y + h); ctx.globalAlpha = 0.88 + hv * 0.12; ctx.fill(); ctx.globalAlpha = 1; if (hv) { ctx.shadowColor = 'rgba(255,120,60,0.6)'; ctx.shadowBlur = 30 * hv; ctx.fill(); ctx.shadowBlur = 0; } }
    else { ctx.fillStyle = `rgba(255,255,255,${0.06 + hv * 0.12 + (opts.active ? 0.1 : 0)})`; ctx.fill(); ctx.strokeStyle = opts.active ? COL.accent : `rgba(255,255,255,${0.1 + hv * 0.25})`; ctx.lineWidth = 2; ctx.stroke(); }
    if (opts.icon) { opts.icon(ctx, x + h * 0.55, y + h / 2, h * 0.36, hv); }
    const tx = opts.align === 'left' ? x + (opts.icon ? h * 1.05 : 28) : x + w / 2;
    UIDraw.text(ctx, label, tx + (opts.align === 'left' ? hv * 6 : 0), y + h / 2 + 1, opts.size || h * 0.36, { weight: opts.weight || 650, align: opts.align || 'center', spacing: opts.spacing !== undefined ? opts.spacing : 1.5, maxW: w - 40 });
    if (opts.align === 'left' && hv > 0.01) { ctx.globalAlpha = hv; UIDraw.rr(ctx, x + 10, y + h * 0.3, 5, h * 0.4, 3); ctx.fillStyle = COL.accent; ctx.fill(); ctx.globalAlpha = 1; }
    ctx.restore();
    return hv;
  },
  selector(ctx, P, id, x, y, w, h, label, value, onPrev, onNext) {
    const hv = Math.max(P.hover[id + '_l'] || 0, P.hover[id + '_r'] || 0);
    UIDraw.rr(ctx, x, y, w, h, 16); ctx.fillStyle = `rgba(255,255,255,${0.04 + hv * 0.05})`; ctx.fill();
    UIDraw.text(ctx, label, x + 26, y + h / 2, h * 0.34, { color: COL.dim, weight: 500 });
    const vw = 330, vx = x + w - vw - 20;
    const l = P.region(id + '_l', vx, y, 70, h, onPrev), r = P.region(id + '_r', x + w - 90, y, 90, h, onNext);
    const arrow = (cx, dir, hh) => { ctx.save(); ctx.globalAlpha = 0.5 + hh * 0.5; ctx.fillStyle = hh > 0.5 ? COL.accent : COL.text; ctx.beginPath(); ctx.moveTo(cx + dir * 8, y + h / 2); ctx.lineTo(cx - dir * 6, y + h / 2 - 10); ctx.lineTo(cx - dir * 6, y + h / 2 + 10); ctx.fill(); ctx.restore(); };
    arrow(vx + 24, -1, l); arrow(x + w - 44, 1, r);
    UIDraw.text(ctx, value, vx + vw / 2 - 10, y + h / 2, h * 0.36, { align: 'center', weight: 650, maxW: vw - 110 });
  },
  toggle(ctx, P, id, x, y, w, h, label, on, onClick) {
    const hv = P.region(id, x, y, w, h, onClick);
    UIDraw.rr(ctx, x, y, w, h, 16); ctx.fillStyle = `rgba(255,255,255,${0.04 + hv * 0.05})`; ctx.fill();
    UIDraw.text(ctx, label, x + 26, y + h / 2, h * 0.34, { color: COL.dim, weight: 500 });
    const sw = 74, sh = 38, sx = x + w - sw - 26, sy = y + (h - sh) / 2; const k = on ? 1 : 0;
    UIDraw.rr(ctx, sx, sy, sw, sh, sh / 2); ctx.fillStyle = on ? UIDraw.accentGrad(ctx, sx, 0, sx + sw, 0) : 'rgba(255,255,255,0.16)'; ctx.fill();
    ctx.beginPath(); ctx.arc(sx + sh / 2 + k * (sw - sh), sy + sh / 2, sh / 2 - 5, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill();
  },
  slider(ctx, P, id, x, y, w, h, label, val, onSet, fmt) {
    const hv = P.region(id, x, y, w, h, (hit) => { const t = clamp((hit.px - (x + w - 420)) / 300, 0, 1); onSet(Math.round(t * 20) / 20); }, { drag: true });
    UIDraw.rr(ctx, x, y, w, h, 16); ctx.fillStyle = `rgba(255,255,255,${0.04 + hv * 0.05})`; ctx.fill();
    UIDraw.text(ctx, label, x + 26, y + h / 2, h * 0.34, { color: COL.dim, weight: 500 });
    const bx = x + w - 420, bw = 300, by = y + h / 2;
    UIDraw.rr(ctx, bx, by - 4, bw, 8, 4); ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fill();
    UIDraw.rr(ctx, bx, by - 4, bw * val, 8, 4); ctx.fillStyle = UIDraw.accentGrad(ctx, bx, 0, bx + bw, 0); ctx.fill();
    ctx.beginPath(); ctx.arc(bx + bw * val, by, 13 + hv * 3, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill();
    UIDraw.text(ctx, fmt ? fmt(val) : Math.round(val * 100) + '%', x + w - 26, by, h * 0.3, { align: 'right', color: COL.dim });
  },
  tabs(ctx, P, id, x, y, w, h, items, active, onSel) {
    items.forEach((it, i) => {
      const yy = y + i * (h + 10); const hv = P.region(id + i, x, yy, w, h, () => onSel(i)); const act = i === active;
      UIDraw.rr(ctx, x, yy, w, h, 16); ctx.fillStyle = act ? 'rgba(255,106,61,0.18)' : `rgba(255,255,255,${0.03 + hv * 0.07})`; ctx.fill();
      if (act) { UIDraw.rr(ctx, x, yy + h * 0.25, 5, h * 0.5, 3); ctx.fillStyle = COL.accent; ctx.fill(); }
      UIDraw.text(ctx, it, x + 26, yy + h / 2, h * 0.34, { weight: act ? 700 : 500, color: act ? COL.text : COL.dim, maxW: w - 40 });
    });
  },
};

// ---------------------------------------------------------------- UI manager: panels + pointers
class UIManager {
  constructor(glx) {
    this.glx = glx; this.panels = []; this.pointers = { left: null, right: null }; this.lastHover = {};
    this.beam = glx.mesh(this.beamGeo().build());
    this.dot = glx.mesh(GEO.quad(0.02, 0.02).build());
  }
  beamGeo() { const gb = new GeoBuilder(); for (let i = 0; i <= 1; i++) { } GEO.tube(gb, [0, 0, 0], [0, 0, -1], 0.0018, 0.0006, 6, (t) => [1, 0.62, 0.42], {}); for (let i = 0; i < gb.vcount; i++) gb.c[i * 4 + 3] = Math.round(255 * (1 - gb.p[i * 3 + 2] * -0.85)); return gb; }
  add(panel) { this.panels.push(panel); return panel; }
  update(dt) { for (const p of this.panels) p.update(dt); }
  // pointer test from a hand ray; returns hit
  point(hand, origin, dir, triggerDown, triggerPressed) {
    let best = null, bp = null;
    for (const p of this.panels) { const h = p.hitTest(origin, dir); if (h && (!best || h.t < best.t)) { best = h; bp = p; } }
    for (const p of this.panels) if (p !== bp && p.hoverOwner === hand) { p.hoverId = null; p.hoverOwner = null; }
    if (bp) {
      if (bp.hoverId !== best.id && best.id) { AUDIO.uiHover(); this.onHaptic && this.onHaptic(hand, 0.12, 12); }
      bp.hoverId = best.id; bp.hoverOwner = hand;
      if (best.reg && ((triggerPressed) || (triggerDown && best.reg.opts.drag))) {
        if (triggerPressed) { bp.press[best.id] = 1; AUDIO.uiClick(); this.onHaptic && this.onHaptic(hand, 0.3, 20); }
        best.reg.onClick && best.reg.onClick(best); bp.dirty = true;
      }
    }
    this.pointers[hand] = best ? { origin, dir, t: best.t, point: best.point } : null;
    return best;
  }
  clearPointer(hand) { this.pointers[hand] = null; for (const p of this.panels) if (p.hoverOwner === hand) { p.hoverId = null; p.hoverOwner = null; } }
  anyVisible() { return this.panels.some(p => p.visible && p.interactive && p.targetOpacity > 0); }
}
