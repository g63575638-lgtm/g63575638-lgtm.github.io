'use strict';
// ============================================================================
// Procedural spatial audio (Web Audio API, HRTF panning). No sample files:
// every sound — club whoosh, impacts per club type, ball flight, bounces,
// rolling, cup rattle, splash, birds, wind, ocean, stream — is synthesised.
// ============================================================================

class AudioSys {
  constructor() { this.ctx = null; this.enabled = false; this.vol = { master: 0.9, sfx: 1.0, amb: 0.7, ui: 0.7 }; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = ctx.createGain(); this.master.gain.value = this.vol.master;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = this.vol.sfx; this.sfx.connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = this.vol.amb; this.amb.connect(this.master);
    this.ui = ctx.createGain(); this.ui.gain.value = this.vol.ui; this.ui.connect(this.master);
    // noise buffers
    const len = ctx.sampleRate * 2;
    this.white = ctx.createBuffer(1, len, ctx.sampleRate); const wd = this.white.getChannelData(0);
    for (let i = 0; i < len; i++) wd[i] = Math.random() * 2 - 1;
    this.pink = ctx.createBuffer(1, len, ctx.sampleRate); const pd = this.pink.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898; pd[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926; }
    this.enabled = true;
    this._loops = [];
    this.setupLoops();
  }
  setVolumes(v) { Object.assign(this.vol, v); if (!this.ctx) return; const t = this.ctx.currentTime; this.master.gain.setTargetAtTime(this.vol.master, t, 0.05); this.sfx.gain.setTargetAtTime(this.vol.sfx, t, 0.05); this.amb.gain.setTargetAtTime(this.vol.amb, t, 0.05); this.ui.gain.setTargetAtTime(this.vol.ui, t, 0.05); }

  panner(pos, ref = 2, roll = 1.2) {
    const p = this.ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = roll; p.maxDistance = 10000;
    if (pos) this.setPos(p, pos); return p;
  }
  setPos(p, pos) {
    if (p.positionX) { const t = this.ctx.currentTime; p.positionX.setTargetAtTime(pos[0], t, 0.01); p.positionY.setTargetAtTime(pos[1], t, 0.01); p.positionZ.setTargetAtTime(pos[2], t, 0.01); }
    else p.setPosition(pos[0], pos[1], pos[2]);
  }
  listener(pos, fwd, up) {
    if (!this.ctx) return; const L = this.ctx.listener; const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(pos[0], t, 0.01); L.positionY.setTargetAtTime(pos[1], t, 0.01); L.positionZ.setTargetAtTime(pos[2], t, 0.01);
      L.forwardX.setTargetAtTime(fwd[0], t, 0.01); L.forwardY.setTargetAtTime(fwd[1], t, 0.01); L.forwardZ.setTargetAtTime(fwd[2], t, 0.01);
      L.upX.setTargetAtTime(up[0], t, 0.01); L.upY.setTargetAtTime(up[1], t, 0.01); L.upZ.setTargetAtTime(up[2], t, 0.01);
    } else { L.setPosition(pos[0], pos[1], pos[2]); L.setOrientation(fwd[0], fwd[1], fwd[2], up[0], up[1], up[2]); }
    this.listenerPos = pos;
  }

  noiseSrc(pink, loop = true) { const s = this.ctx.createBufferSource(); s.buffer = pink ? this.pink : this.white; s.loop = loop; s.loopStart = Math.random(); s.loopEnd = s.loopStart + 0.9; return s; }

  // ------------------------------------------------------------ continuous loops (swing whoosh, ball flight, roll)
  setupLoops() {
    const ctx = this.ctx;
    const mk = (pink, type, freq, q) => {
      const src = this.noiseSrc(pink); const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0; const pan = this.panner([0, 0, 0], 1.5, 1);
      src.connect(f); f.connect(g); g.connect(pan); pan.connect(this.sfx); src.start(); return { src, f, g, pan };
    };
    this.whoosh = mk(false, 'bandpass', 800, 1.4);
    this.flight = mk(false, 'bandpass', 1500, 3);
    this.roll = mk(true, 'lowpass', 500, 0.8);
  }
  updateWhoosh(speed, pos) {
    if (!this.enabled) return; const t = this.ctx.currentTime;
    const s = clamp((speed - 4) / 40, 0, 1);
    this.whoosh.g.gain.setTargetAtTime(s * s * 1.6, t, 0.02);
    this.whoosh.f.frequency.setTargetAtTime(300 + s * 1500, t, 0.02);
    this.whoosh.f.Q.setTargetAtTime(1.2 + s * 2, t, 0.05);
    this.setPos(this.whoosh.pan, pos);
  }
  updateFlight(speed, pos, rolling, rollSpeed, surf) {
    if (!this.enabled) return; const t = this.ctx.currentTime;
    const s = clamp(speed / 60, 0, 1);
    this.flight.g.gain.setTargetAtTime(rolling ? 0 : s * s * 0.5, t, 0.05);
    this.flight.f.frequency.setTargetAtTime(900 + s * 1800, t, 0.05);
    this.setPos(this.flight.pan, pos); this.setPos(this.roll.pan, pos);
    const rs = rolling ? clamp(rollSpeed / 4, 0, 1) : 0;
    const surfGain = surf === SURF.GREEN ? 0.35 : surf === SURF.FAIRWAY ? 0.6 : 0.9;
    this.roll.g.gain.setTargetAtTime(rs * surfGain * 0.9, t, 0.04);
    this.roll.f.frequency.setTargetAtTime(250 + rs * 900, t, 0.05);
  }
  silenceBall() { if (!this.enabled) return; const t = this.ctx.currentTime; this.flight.g.gain.setTargetAtTime(0, t, 0.05); this.roll.g.gain.setTargetAtTime(0, t, 0.05); }

  // ------------------------------------------------------------ one-shots
  env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  burst(dest, t, { type = 'bandpass', freq = 2000, q = 1, a = 0.001, d = 0.05, peak = 0.5, pink = false, sweep }) {
    const src = this.noiseSrc(pink, false); const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweep) { f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(sweep, t + a + d); }
    const g = this.ctx.createGain(); this.env(g, t, a, peak, d);
    src.connect(f); f.connect(g); g.connect(dest); src.start(t, Math.random() * 1.5); src.stop(t + a + d + 0.05);
  }
  tone(dest, t, { freq = 440, type = 'sine', a = 0.002, d = 0.1, peak = 0.3, sweep, detune = 0 }) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t); o.detune.value = detune;
    if (sweep) o.frequency.exponentialRampToValueAtTime(sweep, t + a + d);
    const g = this.ctx.createGain(); this.env(g, t, a, peak, d); o.connect(g); g.connect(dest); o.start(t); o.stop(t + a + d + 0.05);
  }
  at(pos, ref = 2, roll = 1) { const p = this.panner(pos, ref, roll); p.connect(this.sfx); setTimeout(() => { try { p.disconnect(); } catch (e) { } }, 4000); return p; }

  impact(type, intensity, pos) {
    if (!this.enabled) return; const t = this.ctx.currentTime; const dst = this.at(pos, 1.5); const k = clamp(intensity, 0.05, 1);
    if (type === 'wood') {
      this.burst(dst, t, { type: 'highpass', freq: 2500, d: 0.012, peak: 0.9 * k });
      for (const [f, d, p] of [[3150, 0.11, 0.25], [5200, 0.07, 0.14], [7600, 0.05, 0.08], [2100, 0.05, 0.1]]) this.tone(dst, t, { freq: f * (1 + (Math.random() - 0.5) * 0.02), d, peak: p * k });
      this.tone(dst, t, { freq: 170, d: 0.03, peak: 0.5 * k, sweep: 90 });
    } else if (type === 'putter') {
      this.tone(dst, t, { freq: 980, d: 0.045, peak: 0.35 * k + 0.05 }); this.tone(dst, t, { freq: 2100, d: 0.02, peak: 0.12 * k + 0.02 });
      this.burst(dst, t, { freq: 3000, q: 2, d: 0.008, peak: 0.25 * k + 0.05 });
    } else {
      this.burst(dst, t, { freq: 3800, q: 1.4, d: 0.018, peak: 0.95 * k });
      this.tone(dst, t, { freq: 1250, d: 0.05, peak: 0.2 * k }); this.tone(dst, t, { freq: 2650, d: 0.035, peak: 0.12 * k });
      this.tone(dst, t, { freq: 200, d: 0.03, peak: 0.45 * k, sweep: 100 });
    }
  }
  divot(pos, k) { if (!this.enabled) return; const t = this.ctx.currentTime; const d = this.at(pos); this.burst(d, t, { type: 'lowpass', freq: 1800, d: 0.12, peak: 0.5 * k, pink: true, sweep: 400 }); this.tone(d, t, { freq: 90, d: 0.06, peak: 0.4 * k }); }
  bounce(speed, surf, pos) {
    if (!this.enabled) return; const t = this.ctx.currentTime; const d = this.at(pos, 3); const k = clamp(speed / 20, 0.05, 1);
    if (surf === SURF.SAND || surf === SURF.BEACH) { this.burst(d, t, { type: 'highpass', freq: 1500, d: 0.22, peak: 0.4 * k, a: 0.01 }); return; }
    if (surf === SURF.ROCK || surf === SURF.PATH) { this.tone(d, t, { freq: 1700, d: 0.03, peak: 0.5 * k }); this.burst(d, t, { freq: 3200, q: 3, d: 0.02, peak: 0.5 * k }); return; }
    const soft = surf === SURF.GREEN ? 0.7 : surf === SURF.ROUGH || surf === SURF.DEEP ? 1.2 : 1;
    this.burst(d, t, { type: 'lowpass', freq: 900 / soft, d: 0.07 * soft, peak: 0.6 * k, pink: true });
    this.tone(d, t, { freq: 130, d: 0.05, peak: 0.45 * k, sweep: 70 });
    if (surf === SURF.ROUGH || surf === SURF.DEEP) this.burst(d, t, { freq: 4000, q: 0.8, d: 0.12, peak: 0.12 * k, a: 0.01 });
  }
  cup(kind, speed, pos) {
    if (!this.enabled) return; const t = this.ctx.currentTime; const d = this.at(pos, 1.5); const k = clamp(speed / 2, 0.15, 1);
    if (kind === 'rim') { this.tone(d, t, { freq: 620, d: 0.03, peak: 0.25 * k }); this.burst(d, t, { freq: 1500, q: 3, d: 0.02, peak: 0.25 * k }); }
    else if (kind === 'wall') { this.burst(d, t, { freq: 1900, q: 5, d: 0.03, peak: 0.45 * k }); this.tone(d, t, { freq: 720, d: 0.04, peak: 0.3 * k }); }
    else { // bottom: classic hollow "clunk" + rattle
      this.tone(d, t, { freq: 340, d: 0.09, peak: 0.6 * k, sweep: 260 }); this.burst(d, t, { freq: 1300, q: 4, d: 0.05, peak: 0.5 * k });
      for (let i = 1; i < 4; i++) { const tt = t + 0.09 * i * (1 - i * 0.12); this.burst(d, tt, { freq: 1700 + i * 200, q: 6, d: 0.02, peak: 0.25 * k / i }); }
    }
  }
  splash(pos) {
    if (!this.enabled) return; const t = this.ctx.currentTime; const d = this.at(pos, 6, 0.8);
    this.burst(d, t, { type: 'lowpass', freq: 5000, d: 0.5, peak: 0.8, a: 0.005, sweep: 350, pink: true });
    for (let i = 0; i < 6; i++) this.tone(d, t + 0.1 + Math.random() * 0.5, { freq: 500 + Math.random() * 700, d: 0.06, peak: 0.08, sweep: 1400 + Math.random() * 600 });
  }
  leaves(pos, k = 1) { if (!this.enabled) return; const t = this.ctx.currentTime; const d = this.at(pos, 4); this.burst(d, t, { freq: 3500, q: 0.7, d: 0.35, a: 0.02, peak: 0.35 * k }); this.burst(d, t + 0.08, { freq: 5200, q: 1, d: 0.25, a: 0.02, peak: 0.2 * k }); }
  knock(pos, k = 1) { if (!this.enabled) return; const t = this.ctx.currentTime; const d = this.at(pos, 4); this.tone(d, t, { freq: 420, d: 0.06, peak: 0.6 * k, sweep: 300 }); this.burst(d, t, { freq: 1200, q: 3, d: 0.03, peak: 0.4 * k }); }
  flagHit(pos) { if (!this.enabled) return; const t = this.ctx.currentTime; const d = this.at(pos, 2); this.tone(d, t, { freq: 1900, d: 0.25, peak: 0.25 }); this.tone(d, t, { freq: 2950, d: 0.18, peak: 0.12 }); }
  grab(pos) { if (!this.enabled) return; const t = this.ctx.currentTime; const d = this.at(pos, 1); this.burst(d, t, { freq: 900, q: 1, d: 0.04, peak: 0.25, pink: true }); this.tone(d, t, { freq: 220, d: 0.04, peak: 0.15 }); }
  drop(pos) { if (!this.enabled) return; const t = this.ctx.currentTime; const d = this.at(pos, 2); this.tone(d, t, { freq: 1200, d: 0.15, peak: 0.15 }); this.burst(d, t, { type: 'lowpass', freq: 800, d: 0.08, peak: 0.3, pink: true }); }
  teleport() { if (!this.enabled) return; const t = this.ctx.currentTime; this.burst(this.ui, t, { freq: 600, q: 2, d: 0.35, a: 0.05, peak: 0.18, sweep: 2400 }); }
  // ------------------------------------------------------------ UI
  uiHover() { if (!this.enabled) return; this.tone(this.ui, this.ctx.currentTime, { freq: 1800, d: 0.025, peak: 0.06 }); }
  uiClick() { if (!this.enabled) return; const t = this.ctx.currentTime; this.tone(this.ui, t, { freq: 880, d: 0.05, peak: 0.16 }); this.tone(this.ui, t + 0.04, { freq: 1320, d: 0.07, peak: 0.12 }); }
  uiBack() { if (!this.enabled) return; const t = this.ctx.currentTime; this.tone(this.ui, t, { freq: 1100, d: 0.05, peak: 0.12 }); this.tone(this.ui, t + 0.04, { freq: 740, d: 0.07, peak: 0.1 }); }
  uiOpen() { if (!this.enabled) return; const t = this.ctx.currentTime; this.burst(this.ui, t, { freq: 700, q: 1.2, d: 0.25, a: 0.06, peak: 0.12, sweep: 1800 }); }
  chime(level = 1) { // success arpeggio; bigger for better scores
    if (!this.enabled) return; const t = this.ctx.currentTime; const notes = level >= 2 ? [523, 659, 784, 1047, 1319] : level >= 1 ? [523, 659, 784, 1047] : [440, 523, 659];
    notes.forEach((f, i) => { this.tone(this.ui, t + i * 0.09, { freq: f, d: 0.6, peak: 0.13, a: 0.01 }); this.tone(this.ui, t + i * 0.09, { freq: f * 2, d: 0.3, peak: 0.03, a: 0.01 }); });
  }
  applause(k = 1) {
    if (!this.enabled) return; const t = this.ctx.currentTime;
    for (let i = 0; i < 90 * k; i++) { const tt = t + Math.random() * 2.2 * k; this.burst(this.ui, tt, { freq: 1500 + Math.random() * 2500, q: 1.5, d: 0.012, peak: 0.05 * (1 - (tt - t) / (2.5 * k)) + 0.005 }); }
  }
  penalty() { if (!this.enabled) return; const t = this.ctx.currentTime; this.tone(this.ui, t, { freq: 392, d: 0.18, peak: 0.12, type: 'triangle' }); this.tone(this.ui, t + 0.16, { freq: 311, d: 0.3, peak: 0.12, type: 'triangle' }); }

  // ------------------------------------------------------------ ambience
  startAmbience(cfg, course) {
    if (!this.enabled) return; this.stopAmbience();
    const ctx = this.ctx; const nodes = []; this.ambNodes = nodes; this.ambCfg = cfg; this.ambCourse = course;
    // wind bed (stereo pair of slowly modulated filtered noise)
    for (const side of [-1, 1]) {
      const src = this.noiseSrc(true); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
      const g = ctx.createGain(); g.gain.value = 0.25 * cfg.wind; const p = ctx.createStereoPanner(); p.pan.value = side * 0.6;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07 + Math.random() * 0.05; const lg = ctx.createGain(); lg.gain.value = 0.16 * cfg.wind; lfo.connect(lg); lg.connect(g.gain);
      const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.11; const lg2 = ctx.createGain(); lg2.gain.value = 160; lfo2.connect(lg2); lg2.connect(f.frequency);
      src.connect(f); f.connect(g); g.connect(p); p.connect(this.amb); src.start(); lfo.start(); lfo2.start(); nodes.push(src, lfo, lfo2);
    }
    // high leaf rustle in gusts
    { const src = this.noiseSrc(false); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3800; f.Q.value = 0.6; const g = ctx.createGain(); g.gain.value = 0.0;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05; const lg = ctx.createGain(); lg.gain.value = 0.035 * cfg.wind; lfo.connect(lg); lg.connect(g.gain);
      src.connect(f); f.connect(g); g.connect(this.amb); src.start(); lfo.start(); nodes.push(src, lfo); }
    // ocean surf (positional, toward the ocean)
    if (cfg.ocean) {
      for (const pos of [[-330, 0, 0], [-200, 0, 360], [-360, 0, -200]]) {
        const src = this.noiseSrc(true); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
        const g = ctx.createGain(); g.gain.value = 0.9; const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09 + Math.random() * 0.04; const lg = ctx.createGain(); lg.gain.value = 0.75; lfo.connect(lg); lg.connect(g.gain);
        const pan = this.panner(pos, 60, 0.6); src.connect(f); f.connect(g); g.connect(pan); pan.connect(this.amb); src.start(); lfo.start(); nodes.push(src, lfo);
      }
    }
    if (cfg.stream) {
      const src = this.noiseSrc(false); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 0.9;
      const g = ctx.createGain(); g.gain.value = 0.5 * cfg.stream; const lfo = ctx.createOscillator(); lfo.type = 'triangle'; lfo.frequency.value = 7; const lg = ctx.createGain(); lg.gain.value = 0.15; lfo.connect(lg); lg.connect(g.gain);
      const pan = this.panner([130, 0, 160], 15, 1); src.connect(f); f.connect(g); g.connect(pan); pan.connect(this.amb); src.start(); lfo.start(); nodes.push(src, lfo);
    }
    this._nextBird = 0; this._nextGull = 3; this._nextCricket = 1; this._nextBell = 5;
  }
  stopAmbience() { if (this.ambNodes) for (const n of this.ambNodes) { try { n.stop(); } catch (e) { } } this.ambNodes = null; }
  tickAmbience(dt, center) {
    if (!this.enabled || !this.ambCfg) return; const cfg = this.ambCfg; const ctx = this.ctx; const t = ctx.currentTime;
    this._nextBird -= dt; this._nextGull -= dt; this._nextCricket -= dt; this._nextBell -= dt;
    const around = (r0, r1, h) => { const a = Math.random() * TAU, r = r0 + Math.random() * (r1 - r0); return [center[0] + Math.cos(a) * r, center[1] + h, center[2] + Math.sin(a) * r]; };
    if (cfg.birds && this._nextBird < 0) {
      this._nextBird = (1.5 + Math.random() * 5) / cfg.birds;
      const d = this.at(around(15, 70, 6 + Math.random() * 10), 8, 1); const sp = Math.random();
      const base = 2200 + Math.random() * 2600; const n = 2 + (Math.random() * 6 | 0);
      for (let i = 0; i < n; i++) {
        const tt = t + i * (0.09 + sp * 0.12);
        if (sp < 0.33) this.tone(d, tt, { freq: base, sweep: base * 1.5, d: 0.06, peak: 0.07 });
        else if (sp < 0.66) { this.tone(d, tt, { freq: base * 1.2, sweep: base * 0.8, d: 0.08, peak: 0.06 }); }
        else { this.tone(d, tt, { freq: base, d: 0.04, peak: 0.05 }); this.tone(d, tt + 0.05, { freq: base * 1.26, d: 0.05, peak: 0.05 }); }
      }
    }
    if (cfg.gulls && this._nextGull < 0) {
      this._nextGull = 5 + Math.random() * 9; const d = this.at(around(30, 120, 25), 15, 1);
      for (let i = 0; i < 2 + (Math.random() * 3 | 0); i++) { const tt = t + i * 0.32; this.tone(d, tt, { freq: 1500, sweep: 900, d: 0.25, peak: 0.08, type: 'sawtooth', a: 0.03 }); }
    }
    if (cfg.insects && this._nextCricket < 0) {
      this._nextCricket = 2 + Math.random() * 4; const d = this.at(around(5, 25, 0.2), 3, 1); const f = 4300 + Math.random() * 600;
      for (let i = 0; i < 6; i++) this.tone(d, t + i * 0.055, { freq: f, d: 0.025, peak: 0.02 * cfg.insects });
    }
    if (cfg.cowbells && this._nextBell < 0) {
      this._nextBell = 6 + Math.random() * 10; const d = this.at(around(250, 400, 30), 40, 0.6);
      for (let i = 0; i < 3; i++) { const tt = t + i * (0.4 + Math.random() * 0.3); for (const [f, p] of [[620, 0.05], [1480, 0.03], [2350, 0.015]]) this.tone(d, tt, { freq: f, d: 0.6, peak: p * cfg.cowbells }); }
    }
  }
}
const AUDIO = new AudioSys();
