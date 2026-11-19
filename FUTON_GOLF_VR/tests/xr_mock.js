// Minimal WebXR emulator for headless testing of the VR code path.
// Provides navigator.xr, XRWebGLLayer, sessions, reference spaces, viewer/controller poses and gamepads.
(function () {
  const ident = () => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; };
  const persp = (fovy, aspect, n, f) => { const t = 1 / Math.tan(fovy / 2), m = new Float32Array(16); m[0] = t / aspect; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = 2 * f * n / (n - f); return m; };
  const mkButtons = () => Array.from({ length: 7 }, () => ({ pressed: false, touched: false, value: 0 }));
  const XR = window.__XR = {
    head: { pos: [0, 1.65, 0], yaw: 0, pitch: 0 },
    hands: {
      left: { pos: [-0.25, 1.0, -0.3], m: null, buttons: mkButtons(), axes: [0, 0, 0, 0], lin: null, ang: null },
      right: { pos: [0.25, 1.0, -0.3], m: null, buttons: mkButtons(), axes: [0, 0, 0, 0], lin: null, ang: null },
    },
    cb: null, time: 0, session: null, frames: 0,
  };
  function headMatrix() {
    const { pos, yaw, pitch } = XR.head; const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const f = [-sy * cp, sp, -cy * cp], r = [cy, 0, -sy], u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const m = ident(); m[0] = r[0]; m[1] = r[1]; m[2] = r[2]; m[4] = u[0]; m[5] = u[1]; m[6] = u[2]; m[8] = -f[0]; m[9] = -f[1]; m[10] = -f[2]; m[12] = pos[0]; m[13] = pos[1]; m[14] = pos[2]; return m;
  }
  function handMatrix(h) { if (h.m) { const m = new Float32Array(h.m); return m; } const m = ident(); m[12] = h.pos[0]; m[13] = h.pos[1]; m[14] = h.pos[2]; return m; }
  class XRSpace { constructor(kind, hand) { this.kind = kind; this.hand = hand; } }
  class XRWebGLLayer {
    constructor(session, gl, opts) { this.gl = gl; this.framebuffer = null; this.fixedFoveation = 0; this.framebufferWidth = gl.canvas.width; this.framebufferHeight = gl.canvas.height; }
    getViewport(view) { const w = this.gl.canvas.width, h = this.gl.canvas.height; return view.eye === 'left' ? { x: 0, y: 0, width: w / 2, height: h } : { x: w / 2, y: 0, width: w / 2, height: h }; }
  }
  window.XRWebGLLayer = XRWebGLLayer;
  class Session extends EventTarget {
    constructor() {
      super(); this.renderState = { baseLayer: null }; this.supportedFrameRates = new Float32Array([72, 80, 90, 120]);
      this.inputSources = ['left', 'right'].map(hd => ({ handedness: hd, targetRayMode: 'tracked-pointer', gripSpace: new XRSpace('grip', hd), targetRaySpace: new XRSpace('ray', hd), gamepad: { buttons: XR.hands[hd].buttons, axes: XR.hands[hd].axes, hapticActuators: [{ pulse: () => Promise.resolve(true) }], mapping: 'xr-standard' }, profiles: ['oculus-touch-v3'] }));
    }
    updateRenderState(s) { Object.assign(this.renderState, s); }
    async requestReferenceSpace(t) { return new XRSpace('ref'); }
    requestAnimationFrame(cb) { XR.cb = cb; return 1; }
    updateTargetFrameRate(r) { this.frameRate = r; return Promise.resolve(); }
    async end() { this.dispatchEvent(new Event('end')); }
  }
  const frame = {
    get session() { return XR.session; },
    getViewerPose() {
      const hm = headMatrix(); const views = ['left', 'right'].map((eye, i) => { const m = new Float32Array(hm); const ipd = 0.032 * (i ? 1 : -1); m[12] += hm[0] * ipd; m[13] += hm[1] * ipd; m[14] += hm[2] * ipd; return { eye, transform: { matrix: m }, projectionMatrix: persp(1.7, 0.9, 0.08, 9000) }; });
      return { transform: { matrix: hm }, views };
    },
    getPose(space) {
      if (space.kind === 'grip' || space.kind === 'ray') { const h = XR.hands[space.hand]; const r = { transform: { matrix: handMatrix(h) } }; if (h.lin) { r.linearVelocity = { x: h.lin[0], y: h.lin[1], z: h.lin[2] }; r.angularVelocity = { x: h.ang[0], y: h.ang[1], z: h.ang[2] }; } return r; }
      return { transform: { matrix: ident() } };
    },
  };
  Object.defineProperty(navigator, 'xr', { configurable: true, value: {
    isSessionSupported: async () => true,
    requestSession: async () => { XR.session = new Session(); return XR.session; },
    addEventListener() { },
  } });
  WebGL2RenderingContext.prototype.makeXRCompatible = function () { return Promise.resolve(); };
  // drive frames manually from the test: __xrTick(dtSeconds)
  window.__xrTick = (dt = 1 / 72) => { XR.time += dt * 1000; const cb = XR.cb; XR.cb = null; if (cb) cb(XR.time, frame); XR.frames++; };
  window.__setBtn = (hand, idx, v) => { const b = XR.hands[hand].buttons[idx]; b.value = v; b.pressed = v > 0.5; };
})();
