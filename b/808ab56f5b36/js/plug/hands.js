// Plug-in "hands": the player's own first-person arms are the robot arms of the player robot in the entry cutscene
// (robotDef(0x51a7c0de, 'survivor'): olive / khaki paint, mitt hands, piston forearms), rebuilt crisp for close range:
// bevelled palm and back plate, three articulated mitt fingers (three segments each, hinge barrels, rubber pads), an
// opposed two-segment thumb, chipped paint, screws, a cuff and a piston forearm. The hands GRIP what the player holds:
// they sit at the very grip points the rules give the old human arms (sim/fp.js arm(): weapon grip + fore grip, box
// sides, bag neck, broom / vacuum handle, corpse wrist), fingers close around the handle. Guns are held in two hands and
// reloaded with both (the left hand rides the rules' magazine / pump mesh), long melee weapons get a second hand on the
// handle, the box sits between two flat palms. A light spring on the held thing (camera-centred, world-oriented frame)
// gives weight: it lags camera turns a little, overshoots and settles; the rules' own bob, sway, kick and swing arcs stay.
// View only: rules, timers and window.__twt are unchanged. ?hands=old (or ?noplug=hands) keeps the old human arms.
import * as THREE from '../../vendor/three.module.min.js';
import { noMask } from '../mats.js';
import { R, rbox, place, merge, sph, cyl, tor, bcyl, screw, setDetail, detail } from '../robots/robo-geo.js';
import { robotDef } from '../robots/robo-cast.js';
import * as fp from '../sim/fp.js';
import * as player from '../sim/player.js';
import * as carry from '../sim/carry.js';
import * as items from '../sim/items.js';
import * as guns from '../sim/guns.js';
import * as audio from '../sim/audio.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function play(name, vol) { try { audio.play(name, vol, null); } catch (e) { /* optional */ } }

// ------------------------------------------------------------------ material (palette regions, chipped paint, view fill)
// The view pass shares the world's lights; an olive arm in shade read as a dark blob, so the material adds its own soft
// key + fill from the upper left of the camera and a cool rim, scaled each frame by the scene's daylight (uFill).
function handMat(pal, wear) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2 });
  const chip = 0.8 - 0.08 * (wear === undefined ? 0.4 : wear); // rare small chips: worn, not camouflage
  const U = { uPal: { value: pal.slice(0, 11).map((h) => new THREE.Color(h)) }, uGlow: { value: 2.5 }, uChip: { value: chip }, uFill: { value: 0.3 }, uRim: { value: 0.25 } };
  m.userData.U = U;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aReg; varying float vReg; varying vec3 vOP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvReg = aReg; vOP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vReg; varying vec3 vOP; uniform vec3 uPal[11]; uniform float uGlow; uniform float uChip; uniform float uFill; uniform float uRim; float gChip; float gDirt; int gReg;
float hh(vec3 p){ p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float hn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(mix(hh(i),hh(i+vec3(1,0,0)),f.x),mix(hh(i+vec3(0,1,0)),hh(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hh(i+vec3(0,0,1)),hh(i+vec3(1,0,1)),f.x),mix(hh(i+vec3(0,1,1)),hh(i+vec3(1,1,1)),f.x),f.y),f.z); }
float hf(vec3 p){ return .5*hn(p) + .27*hn(p*2.03+7.1) + .14*hn(p*4.1+3.3) + .07*hn(p*8.3+1.7); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
gReg = int(vReg + .5); vec3 base = uPal[gReg]; gChip = 0.; gDirt = hf(vOP * 14. + 5.);
if (gReg == 0 || gReg == 1 || gReg == 8 || gReg == 10) {
  float n = hf(vOP * 120. + 3.) * .7 + hf(vOP * 30.) * .3; gChip = smoothstep(uChip, uChip + .02, n);
  float edge = smoothstep(uChip - .05, uChip, n) * (1. - gChip);
  base = mix(base * (1. + .25 * edge), vec3(.34, .35, .36), gChip);
}
base *= .82 + .3 * gDirt;
// soft contour: grazing faces a little darker so the hand's outline stays crisp against a bright yard or wall
{ float nv = clamp(dot(normalize(vNormal), vec3(0., 0., 1.)), 0., 1.); base *= 1. - .22 * pow(1. - nv, 3.); }
diffuseColor.rgb = base;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = gReg == 3 ? .22 : gReg == 2 ? .42 : gReg == 7 ? .85 : gReg == 5 ? .06 : mix(.55, .28, gChip) + .1 * gDirt;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor = gReg == 3 ? 1. : gReg == 2 ? .45 : gReg == 5 ? .4 : gReg == 7 ? 0. : mix(.06, .9, gChip);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (gReg == 6) totalEmissiveRadiance = uPal[6] * uGlow; else if (gReg == 5) totalEmissiveRadiance = uPal[6] * uGlow * .18;
{ vec3 kd = normalize(vec3(-.45, .75, .5)); float key = max(dot(normal, kd), 0.), wrap = .5 + .5 * dot(normal, vec3(0., .4, .9));
  float met = metalnessFactor; vec3 alb = diffuseColor.rgb * (1. - .6 * met) + vec3(.06) * met;
  totalEmissiveRadiance += alb * uFill * (.28 * wrap + .7 * key);
  float fr = pow(1. - clamp(dot(normal, vec3(0., 0., 1.)), 0., 1.), 3.);
  totalEmissiveRadiance += vec3(.55, .65, .75) * fr * uRim * uFill; }`);
  };
  noMask(m);
  m.customProgramCacheKey = () => 'robohand-v4';
  return m;
}

// ------------------------------------------------------------------ geometry
// Hand frame (origin = the handle's centre, the grip point): x = handle axis, y = forearm direction (elbow -> grip, made
// perpendicular to the handle), z = palm normal (from the palm toward the handle). The palm plate sits behind the handle
// (z < 0), fingers hinge on its top edge and curl about x over and around the handle, the thumb wraps from the side.
const PALM_Z = -0.044, KNUCK_Y = 0.03, KNUCK_Z = -0.036, WRIST_Y = -0.066;
const FINGER_X = [-0.03, 0, 0.03], SEG_L = [0.032, 0.026, 0.021], THUMB_L = [0.03, 0.025];
function geoKit() {
  const keep = detail(); setDetail(1.6);
  const A = R.A, B = R.B, K = R.DARK, C = R.CHROME, RB = R.RUBBER;
  const palm = [];
  // palm block: bevelled shell, khaki back plate with screws and a vent, a dark under-plate on the palm face
  palm.push(place(rbox(0.094, 0.082, 0.03, 0.011, A), [0, -0.016, PALM_Z]));
  palm.push(place(rbox(0.074, 0.056, 0.007, 0.004, B), [0, -0.018, PALM_Z - 0.017]));
  for (let k = 0; k < 3; k++) palm.push(place(rbox(0.04, 0.0035, 0.004, 0.0015, K), [0.008, -0.03 + k * 0.009, PALM_Z - 0.0215]));
  for (const [x, y] of [[-0.03, 0.002], [0.03, 0.002], [-0.03, -0.04], [0.03, -0.04]]) palm.push(screw([x, y, PALM_Z - 0.0205], 0.0042, [0, 0, -1]));
  palm.push(place(rbox(0.07, 0.05, 0.004, 0.002, RB), [0, -0.018, PALM_Z + 0.0155]));
  // knuckle barrel across the top edge (fingers hinge here): dark tube, chrome pin caps
  palm.push(place(cyl(0.0105, 0.0105, 0.094, K, 14), [0, KNUCK_Y, KNUCK_Z], [0, 0, Math.PI / 2]));
  for (const s of [-1, 1]) palm.push(place(cyl(0.007, 0.007, 0.006, C, 12), [s * 0.049, KNUCK_Y, KNUCK_Z], [0, 0, Math.PI / 2]));
  // thumb socket on both sides (one is used), wrist ball between chrome collars, armoured cuff with a khaki band
  palm.push(place(sph(0.024, K, 16, 12), [0, WRIST_Y, PALM_Z + 0.002]));
  palm.push(place(tor(0.025, 0.0042, C, 8, 22), [0, WRIST_Y - 0.008, PALM_Z + 0.002], [Math.PI / 2, 0, 0]));
  palm.push(place(rbox(0.064, 0.06, 0.056, 0.014, A), [0, WRIST_Y - 0.05, PALM_Z - 0.004]));
  palm.push(place(rbox(0.067, 0.014, 0.059, 0.005, B), [0, WRIST_Y - 0.034, PALM_Z - 0.004]));
  for (let k = 0; k < 4; k++) palm.push(place(rbox(0.04, 0.004, 0.005, 0.002, K), [0, WRIST_Y - 0.056 - k * 0.009, PALM_Z - 0.034]));
  for (const x of [-0.024, 0.024]) palm.push(screw([x, WRIST_Y - 0.072, PALM_Z - 0.0325], 0.004, [0, 0, -1]));
  const thumbSocket = place(sph(0.014, K, 12, 10), [0, 0, 0]);
  // finger segments (segment frame: along +y from its hinge, +z = the gripping side)
  const seg = SEG_L.map((L, i) => {
    const g = [place(rbox(0.024 - i * 0.002, L, 0.021 - i * 0.001, 0.0065, A), [0, L * 0.5 + 0.004, 0])];
    g.push(place(rbox(0.017 - i * 0.002, L * 0.66, 0.004, 0.0018, RB), [0, L * 0.5 + 0.004, 0.0105 - i * 0.0005]));
    if (i === 0) g.push(place(rbox(0.012, L * 0.7, 0.004, 0.0018, B), [0, L * 0.5 + 0.004, -0.0108]));
    if (i > 0) g.push(place(cyl(0.0078, 0.0078, 0.024 - i * 0.002, K, 12), [0, 0, 0], [0, 0, Math.PI / 2]));
    if (i === 2) g.push(place(rbox(0.016, 0.008, 0.016, 0.004, K), [0, L + 0.006, 0.002]));
    if (i < 2) g.push(screw([0, L * 0.55, -0.011], 0.0028, [0, 0, -1]));
    return merge(g);
  });
  const thumb = THUMB_L.map((L, i) => {
    const g = [place(rbox(0.023 - i * 0.002, L, 0.021, 0.0065, A), [0, L * 0.5 + 0.004, 0])];
    g.push(place(rbox(0.016, L * 0.62, 0.004, 0.0018, RB), [0, L * 0.5 + 0.004, 0.0105]));
    g.push(place(cyl(0.0085, 0.0085, 0.024, K, 12), [0, 0, 0], [0, 0, Math.PI / 2]));
    if (i === 1) g.push(place(rbox(0.015, 0.008, 0.016, 0.004, K), [0, L + 0.006, 0.002]));
    return merge(g);
  });
  // piston forearm, unit length along -y from the cuff (scaled to reach the elbow): khaki housing near the elbow, chrome
  // rod toward the wrist, a hose; the elbow ball sits at its end
  const fore = merge([
    place(bcyl(0.019, 1, 0.004, C, 14), [0, -1, 0]),
    place(bcyl(0.031, 0.62, 0.008, A, 16), [0, -0.62, 0]),
    place(bcyl(0.0325, 0.05, 0.004, B, 16), [0, -0.2, 0]),
    place(bcyl(0.034, 0.045, 0.006, K, 16), [0, -0.66, 0]),
    place(bcyl(0.033, 0.03, 0.006, K, 16), [0, -0.02, 0]),
  ]);
  const elbow = merge([sph(0.04, K, 16, 12), place(tor(0.036, 0.005, C, 8, 22), [0, 0, 0], [Math.PI / 2, 0, 0])]);
  setDetail(keep);
  return { palm: merge(palm), seg, thumb, thumbSocket, fore, elbow };
}

const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
// one arm gripping at `grip` (node frame); a0 = handle axis pointing to the "up" end (thumb side), elbow in node frame
function buildArm(kit, mat, grip, elbow, palm, a0, opts) {
  const root = new THREE.Group();
  const fwd = _y.copy(grip).sub(elbow);
  let ax = a0 ? a0.clone().normalize() : null;
  if (!ax || Math.abs(ax.dot(fwd.clone().normalize())) > 0.97) ax = fwd.clone().cross(palm).normalize();
  const y = fwd.clone().addScaledVector(ax, -ax.dot(fwd)).normalize();
  let x = ax.clone(), z = x.clone().cross(y);
  if (z.dot(palm) < 0) { x.negate(); z.negate(); }
  // handle radius (opts.r): the kit's palm face sits 0.0285 in front of the frame origin, so a thinner handle pulls the
  // whole hand toward it by dz and the fingers wrap that radius (solveWrap) instead of closing on air
  const hr = opts && opts.r ? opts.r : HANDLE_R, dz = HANDLE_R - hr;
  root.matrix.copy(_m.makeBasis(x, y, z).setPosition(grip.clone().addScaledVector(z, dz))); root.matrixAutoUpdate = false;
  const ts = a0 && x.dot(a0) < 0 ? -1 : 1; // thumb on the up end of the handle
  const mk = (geo) => { const o = new THREE.Mesh(geo, mat); o.layers.set(1); o.frustumCulled = false; o.castShadow = false; o.receiveShadow = true; return o; };
  root.add(mk(kit.palm));
  // fingers
  const fingers = FINGER_X.map((fx, i) => {
    const piv = new THREE.Group(); piv.position.set(fx, KNUCK_Y, KNUCK_Z); root.add(piv);
    let par = piv; const segs = [];
    for (let k = 0; k < 3; k++) {
      const s = new THREE.Group(); if (k > 0) s.position.set(0, SEG_L[k - 1] + 0.0075, 0);
      s.add(mk(kit.seg[k])); par.add(s); segs.push(s); par = s;
    }
    return { segs, top: fx * ts > 0.01, ph: i * 1.7 };
  });
  // thumb: base on the up side, pointing to the front (+z), curling about y across the front of the handle
  const tb = new THREE.Group();
  tb.matrixAutoUpdate = false;
  tb.matrix.copy(_m.makeBasis(_x.set(0, 1, 0), _y.set(0, 0, 1), _z.set(1, 0, 0)).setPosition(ts * 0.052, -0.014, PALM_Z + 0.004));
  root.add(tb); const sock = mk(kit.thumbSocket); tb.add(sock);
  const tseg = []; let tp = tb;
  for (let k = 0; k < 2; k++) {
    const s = new THREE.Group(); if (k > 0) s.position.set(0, THUMB_L[0] + 0.0075, 0);
    s.add(mk(kit.thumb[k])); tp.add(s); tseg.push(s); tp = s;
  }
  // forearm from the cuff to the elbow (elbow in hand frame)
  const inv = new THREE.Matrix4().copy(root.matrix).invert();
  const eL = elbow.clone().applyMatrix4(inv), cuff = V(0, WRIST_Y - 0.078, PALM_Z - 0.004);
  const d = eL.clone().sub(cuff), len = Math.max(0.05, d.length());
  const fa = mk(kit.fore); fa.position.copy(cuff); fa.quaternion.setFromUnitVectors(V(0, -1, 0), d.normalize()); fa.scale.set(1, len, 1); root.add(fa);
  const eb = mk(kit.elbow); eb.position.copy(eL); root.add(eb);
  root.userData = { fingers, tseg, ts, opts: opts || {}, shut: opts && opts.flat ? SHUT : solveWrap(hr, dz), r: hr };
  return root;
}
// Finger wrap: walk the three segments of a finger in the hand's y/z plane (the handle runs along x, its centre at
// z = -dz) and bend each joint until the segment's pad side touches the handle (radius r + pad), so a pistol grip, a
// rifle handguard, a pump and a bat handle each get their own closed pose. Same for all three fingers (they only differ
// in x). Returns joint angles for grip = 1.
const HANDLE_R = 0.0285, PAD = 0.0108;
function solveWrap(r, dz) {
  const R = r + PAD, cz = -dz, out = [];
  let py = KNUCK_Y, pz = KNUCK_Z, ang = 0;
  for (let k = 0; k < 3; k++) {
    if (k > 0) { const L0 = SEG_L[k - 1] + 0.0075; py += Math.cos(ang) * L0; pz += Math.sin(ang) * L0; }
    const L = SEG_L[k] + (k === 2 ? 0.01 : 0.004);
    let th = OPEN[k];
    // segment direction: +y turned by the summed joint angles about x, toward +z (the handle side)
    while (th < 1.95) {
      const a = ang + th; // angle from +y toward +z
      const sy = Math.cos(a), sz = Math.sin(a);
      let pen = false;
      for (let i = 1; i <= 6; i++) { const f = i / 6, yy = py + sy * L * f, zz = pz + sz * L * f; if (Math.hypot(yy, zz - cz) < R) { pen = true; break; } }
      if (pen) break;
      th += 0.02;
    }
    th = Math.max(OPEN[k], th - 0.02);
    out.push(th); ang += th;
  }
  return out;
}
// grip 0 = open, 1 = closed around a handle; trig = trigger finger pull (guns)
const OPEN = [0.18, 0.12, 0.1], SHUT = [1.18, 1.28, 0.98];
function poseArm(arm, grip, trig, t) {
  const u = arm.userData, flat = u.opts.flat;
  for (const f of u.fingers) {
    let gk = grip * (flat ? 0.28 : 1);
    if (f.top && u.opts.trigger) gk = Math.min(gk, 0.5 + 0.35 * trig);
    const w = Math.sin(t * 1.7 + f.ph) * 0.02;
    const sh = u.shut || SHUT;
    for (let k = 0; k < 3; k++) f.segs[k].rotation.x = OPEN[k] + (sh[k] - OPEN[k]) * gk + w;
  }
  const tg = grip * (flat ? 0.2 : 1), tk = u.opts.thumb || 1;
  u.tseg[0].rotation.x = -u.ts * (0.25 + 0.75 * tg * tk);
  u.tseg[1].rotation.x = -u.ts * (0.15 + 0.85 * tg * tk);
}

// ------------------------------------------------------------------ particles (vacuum dust stream, muzzle flash)
const PT_VS = `
attribute float aSeed;
uniform vec3 uP0, uP1, uP2; uniform float uTime, uPx, uSize, uEnd, uMode;
varying float vA;
vec3 bez(float t){ float u = 1. - t; return u*u*uP0 + 2.*u*t*uP1 + t*t*uP2; }
void main(){
  vec3 p; float s = uSize;
  if (uMode < .5) {
    float t = fract(aSeed * 7.31 + uTime * (.9 + aSeed * .8));
    vec3 j = vec3(sin(aSeed*91. + uTime*9.), cos(aSeed*53. + uTime*11.), sin(aSeed*37. - uTime*7.)) * .008 * sin(3.14159*t);
    p = bez(t) + j; vA = (t < uEnd ? 1. : 0.) * (.5 + .5*sin(aSeed*40. + uTime*30.));
  } else { p = uP2; vA = 1.; }
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_PointSize = uPx * s / max(-mv.z, .02);
  gl_Position = projectionMatrix * mv;
}`;
const PT_FS = `
uniform vec3 uCol; uniform float uI, uMode;
varying float vA;
void main(){
  vec2 q = gl_PointCoord * 2. - 1.; float d = dot(q, q); if (d > 1.) discard;
  float k = uMode < .5 ? exp(-d * 5.) * 2.2 : exp(-d * 3.2) * .55 + exp(-d * 30.) * .9;
  gl_FragColor = vec4(uCol * k * uI * vA, 0.);
}`;
function addMat(U) {
  return new THREE.ShaderMaterial({
    vertexShader: PT_VS, fragmentShader: PT_FS, uniforms: U, transparent: true, depthWrite: false, depthTest: true, toneMapped: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
}
function points(parent, n, U) {
  const ps = new Float32Array(n * 3), sd = new Float32Array(n);
  for (let i = 0; i < n; i++) sd[i] = (i * 0.6180339 + 0.37) % 1;
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(ps, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
  const o = new THREE.Points(g, addMat(U)); o.layers.set(1); o.frustumCulled = false; o.renderOrder = 21; o.visible = false; parent.add(o); return o;
}

// ------------------------------------------------------------------ springs
class PosSpring {
  constructor() { this.x = V(0, 0, 0); this.v = V(0, 0, 0); this.init = false; }
  step(target, dt, k, z, maxLag) {
    if (!this.init) { this.x.copy(target); this.v.set(0, 0, 0); this.init = true; return; }
    const c = 2 * Math.sqrt(k) * z, n = Math.max(1, Math.ceil(dt / 0.006)), h = dt / n;
    for (let i = 0; i < n; i++) {
      const ax = k * (target.x - this.x.x) - c * this.v.x, ay = k * (target.y - this.x.y) - c * this.v.y, az = k * (target.z - this.x.z) - c * this.v.z;
      this.v.x += ax * h; this.v.y += ay * h; this.v.z += az * h;
      this.x.addScaledVector(this.v, h);
    }
    const d = this.x.distanceTo(target);
    if (d > maxLag) { this.x.lerp(target, 1 - maxLag / d); }
  }
}
const _qe = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _qd = new THREE.Quaternion(), _w = new THREE.Vector3();
class RotSpring {
  constructor() { this.q = new THREE.Quaternion(); this.w = V(0, 0, 0); this.init = false; }
  step(target, dt, k, z, maxAng) {
    if (!this.init) { this.q.copy(target); this.w.set(0, 0, 0); this.init = true; return; }
    const c = 2 * Math.sqrt(k) * z, n = Math.max(1, Math.ceil(dt / 0.006)), h = dt / n;
    for (let i = 0; i < n; i++) {
      _qe.copy(target).multiply(_qi.copy(this.q).invert());
      if (_qe.w < 0) { _qe.x = -_qe.x; _qe.y = -_qe.y; _qe.z = -_qe.z; _qe.w = -_qe.w; }
      const s = Math.sqrt(Math.max(1e-12, 1 - _qe.w * _qe.w)), ang = 2 * Math.acos(clamp(_qe.w, -1, 1));
      _w.set(_qe.x / s * ang, _qe.y / s * ang, _qe.z / s * ang);
      if (s < 1e-5) _w.set(0, 0, 0);
      this.w.x += (k * _w.x - c * this.w.x) * h; this.w.y += (k * _w.y - c * this.w.y) * h; this.w.z += (k * _w.z - c * this.w.z) * h;
      const wl = this.w.length();
      if (wl > 1e-7) { _qd.setFromAxisAngle(_w.copy(this.w).divideScalar(wl), wl * h); this.q.premultiply(_qd).normalize(); }
    }
    const a = this.q.angleTo(target);
    if (a > maxAng) this.q.rotateTowards(target, a - maxAng);
  }
}

// ------------------------------------------------------------------ the plug-in
export function playerSpec() { return robotDef(0x51a7c0de, 'survivor').spec; }
const SHORT = ['knife', 'dagger', 'wrench', 'detonator', 'stick'];
// first-person grip per gun class (gun frame: +x barrel, +y up, -z the left hand's side): handle axis of the trigger
// hand (main) and the support hand (off), handle radii r0 / r1, and for the pistols a support hand that wraps the
// shooting hand low on the grip (offAt nudges the rules' fore point, offPalm turns the palm onto the grip)
const GUN_GRIP = {
  Pistol: { main: [0.18, 1, 0], r0: 0.015, off: [0.18, 1, 0], r1: 0.03, offAt: [0.004, 0.0, -0.012], offPalm: [0.15, 0.1, 1] },
  Revolver: { main: [0.22, 1, 0], r0: 0.015, off: [0.22, 1, 0], r1: 0.03, offAt: [0.004, 0.0, -0.012], offPalm: [0.15, 0.1, 1] },
  Nail: { main: [0.18, 1, 0], r0: 0.016, off: [1, 0, 0], r1: 0.024 },
  Smg: { main: [0.18, 1, 0], r0: 0.015, off: [1, 0, 0], r1: 0.02 },
  Rifle: { main: [0.2, 1, 0], r0: 0.015, off: [1, 0, 0], r1: 0.022 },
  Sniper: { main: [0.2, 1, 0], r0: 0.015, off: [1, 0, 0], r1: 0.022 },
  Shotgun: { main: [0.2, 1, 0], r0: 0.016, off: [1, 0, 0], r1: 0.0285 },
  Crossbow: { main: [0.2, 1, 0], r0: 0.016, off: [1, 0, 0], r1: 0.022 },
  // launcher: the left hand closes round the upright front grip plate from the left, elbow tucked low and back
  Launcher: { main: [0.18, 1, 0], r0: 0.016, off: [0, 1, 0], r1: 0.016, offPalm: [0.25, 0, 1], offElbow: [0.02, -0.3, -0.52] },
  Minigun: { main: [0.18, 1, 0], r0: 0.016, off: [1, 0, 0], r1: 0.02 },
  Flame: { main: [0.18, 1, 0], r0: 0.016, off: [1, 0, 0], r1: 0.024 },
  Saw: { main: [0.18, 1, 0], r0: 0.016, off: [1, 0, 0], r1: 0.024 },
};
export async function install(G) {
  if (G.params.hands === 'old') return false;
  const g = G.g, root = G.sg.viewRoot;
  fp.VM_OPTS.arms = false;
  if (G.ctx && G.ctx.feel) G.ctx.feel.vm_item = -12345; // rebuild the viewmodel meshes without the human arms
  const spec = playerSpec();
  // the cutscene robot's palette, A (olive) lifted a touch so the arm keeps its colour in the darker view pass
  const pal = spec.pal.slice();
  // first-person read (#21): the near-black hinge barrels and rubber pads turned each finger into black stripes at camera
  // distance; graphite joints and olive-grey pads keep the mitt reading as one olive hand with metal joints
  pal[R.DARK] = 0x4a4e48; pal[R.RUBBER] = 0x4a4f43;
  const mat = handMat(pal, spec.wear);
  const kit = geoKit();
  // vacuum suction: dust motes stream from the pile into the nozzle; vacuum canister glow; muzzle flash at the sprung gun
  const SU = { uP0: { value: V() }, uP1: { value: V() }, uP2: { value: V() }, uTime: { value: 0 }, uEnd: { value: 1 }, uCol: { value: new THREE.Color(0.55, 0.45, 0.33) }, uI: { value: 1.2 }, uPx: { value: 600 }, uSize: { value: 0.012 }, uMode: { value: 0 } };
  const suck = points(root, 22, SU);
  let humT = 0;
  const fillMat = noMask(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 5.0, 5.8) }));
  const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.0345, 0.0345, 1, 14).translate(0, 0.5, 0), fillMat);
  fill.layers.set(1); fill.frustumCulled = false; fill.visible = false; fill.matrixAutoUpdate = false; root.add(fill);
  const _fm = new THREE.Matrix4(), _fs = new THREE.Matrix4();
  const FLU = { uP0: { value: V() }, uP1: { value: V() }, uP2: { value: V() }, uTime: { value: 0 }, uEnd: { value: 1 }, uCol: { value: new THREE.Color(1.0, 0.72, 0.35) }, uI: { value: 0 }, uPx: { value: 600 }, uSize: { value: 0.12 }, uMode: { value: 1 } };
  const flash = points(root, 1, FLU); flash.renderOrder = 23;

  const S = G.hands = { key: null, kind: 'none', pos: new PosSpring(), rot: new RotSpring(), shots: 0, wasSwing: false, flashT: 0, trig: 0, rev: -1, arms: [], grip: 0, stats: { frames: 0, arms: 0 } };
  const camQ = new THREE.Quaternion(), camP = new THREE.Vector3(), invQ = new THREE.Quaternion();
  const tP = new THREE.Vector3(), tQ = new THREE.Quaternion(), oP = new THREE.Vector3(), oQ = new THREE.Quaternion();
  const M0 = new THREE.Matrix4(), M1 = new THREE.Matrix4(), Mt = new THREE.Matrix4(), Mi = new THREE.Matrix4(), Md = new THREE.Matrix4(), ONE = V(1, 1, 1);
  const tmp = V(), tmp2 = V();
  const vpx = new THREE.Vector2();

  const kindOf = () => {
    const n0 = player.ViewModels[0];
    if (!n0 || !n0.visible || g.mode !== 'Play') return ['none', null];
    const ck = carry.vm_key(g);
    if (ck !== null) {
      if (ck === carry.VM_BROOM) return ['broom', ck];
      if (ck === carry.VM_DRAG) return ['drag', ck];
      return [(ck - carry.VM_BASE) % 64 === 0 ? 'trash' : 'box', Math.floor((ck - carry.VM_BASE) / 64)];
    }
    const w = g.cur_w(), it = w !== null ? w.item : g.cb.throw_item;
    if (it === null || it === undefined) return ['none', null];
    if (items.gun(it) !== null) return ['gun', it];
    return [items.throwable(it) !== null ? 'throw' : 'melee', it];
  };
  const readNode = (n, P, Q) => { P.set(n.pos.x, n.pos.y, n.pos.z); Q.set(n.quat[0], n.quat[1], n.quat[2], n.quat[3]); };
  const writeNode = (n, P, Q) => { n.set_pos(new n.pos.constructor(P.x, P.y, P.z)); n.set_quat([Q.x, Q.y, Q.z, Q.w]); };
  const v3 = (p) => V(p.x, p.y, p.z);

  // (re)attach arms to the viewmodel nodes at the grips the rules recorded for the shown item
  const attach = (kind, id) => {
    for (const a of S.arms) a.parent && a.parent.remove(a);
    S.arms = [];
    const grips = (fp.VM_OPTS.grips || [[], []]).slice();
    const nodes = player.ViewModels;
    let spec = null;
    if (kind === 'gun') spec = guns.spec(id);
    if (kind === 'box' && nodes[0] && nodes[0].mesh3) {
      // the box sits between two flat palms near its near top corners (in view), not at the rules' far side grips
      const geo = nodes[0].mesh3.geometry; if (!geo.boundingBox) geo.computeBoundingBox();
      const bb = geo.boundingBox, hy = bb.max.y - 0.04, hz = bb.min.z * 0.4 + bb.max.z * 0.6;
      grips[0] = [{ grip: V(bb.max.x + 0.004, hy, hz), elbow: V(bb.max.x + 0.16, bb.min.y - 0.1, bb.max.z + 0.42), palm: V(-1, 0, 0), side: 1 }];
      grips[1] = [{ grip: V(bb.min.x - 0.004, hy, hz), elbow: V(bb.min.x - 0.16, bb.min.y - 0.1, bb.max.z + 0.42), palm: V(1, 0, 0), side: -1 }];
    }
    grips.forEach((list, part) => list.forEach((gp) => {
      const node = nodes[part]; if (!node) return;
      let a0 = null, opts = {}, gpos = v3(gp.grip), palm = v3(gp.palm), elb = v3(gp.elbow);
      if (kind === 'gun') {
        const G0 = GUN_GRIP[spec.class] || GUN_GRIP.Rifle;
        if (spec.class === 'Bow') { a0 = V(0, 1, 0); opts.r = gp.side > 0 ? 0.009 : 0.016; }
        else if (gp.side > 0) { a0 = G0.main.slice ? V(...G0.main) : V(0.18, 1, 0); opts.trigger = true; opts.r = G0.r0; }
        else {
          a0 = V(...G0.off); opts.r = G0.r1;
          if (G0.offAt) gpos.add(V(...G0.offAt));
          if (G0.offPalm) palm = V(...G0.offPalm);
          if (G0.offElbow) elb = V(...G0.offElbow);
        }
      } else if (kind === 'melee' || kind === 'throw' || kind === 'broom' || kind === 'trash') {
        a0 = V(0, 1, 0); opts.r = kind === 'throw' ? 0.022 : kind === 'trash' ? 0.02 : kind === 'broom' ? 0.016 : 0.014;
        // melee: a hard fist round the handle, thumb locked over the fingers, the palm turned a little toward the camera
        // so the curled fingers read from the player's eye
        if (kind === 'melee') { opts.thumb = 1.4; palm = V(-0.55, 0, -1); }
      }
      else if (kind === 'box') opts.flat = true;
      const arm = buildArm(kit, mat, gpos, elb, palm, a0, opts);
      node.obj.add(arm); S.arms.push(arm);
      // magazine guns: a second left hand on the magazine, shown while the rules pull the magazine away (reload), so the
      // hand that rides the magazine mesh is on the magazine, not floating where the handguard was
      const mg = kind === 'gun' && gp.side < 0 ? guns.mag_at(id) : null;
      if (mg && spec.reload === 'Mag') {
        const [at, len] = mg, mid = V(at.x, at.y - len * 0.5, at.z);
        const marm = buildArm(kit, mat, mid, v3(gp.elbow), V(0, 0.15, 1), V(0, 1, 0), { r: 0.014 });
        marm.visible = false; marm.userData.magHand = true; node.obj.add(marm); S.arms.push(marm);
        arm.userData.foreHand = true;
      }
    }));
    // long melee weapons: the left hand under the right one on the handle
    if (kind === 'melee') {
      const name = items.iname(id).toLowerCase();
      if (!SHORT.some((k) => name.includes(k)) && grips[0].length === 1 && nodes[0]) {
        const arm = buildArm(kit, mat, V(0, -0.172, 0), V(-0.5, -0.45, 0.3), V(1, 0, 0.3), V(0, 1, 0), {});
        nodes[0].obj.add(arm); S.arms.push(arm);
      }
    }
    S.stats.arms = S.arms.length;
  };

  G.updaters.push(['hands', (dt) => {
    const t = G.t;
    S.stats.frames++;
    const [kind, id] = kindOf();
    const key = kind === 'none' ? null : kind + ':' + id;
    const n0 = player.ViewModels[0], n1 = player.ViewModels[1];
    camQ.copy(G.camera.quaternion); camP.copy(G.camera.position); invQ.copy(camQ).invert();
    const v = g.fx2, feel = G.ctx.feel;
    const ads = v.ads || 0;
    // light the arm with the scene: day bright, night dim (sun intensity from the rules' light table + daylight lift)
    const sunI = G.lights && G.lights.sun ? G.lights.sun.intensity : 6;
    mat.userData.U.uFill.value = clamp(0.09 + sunI * 0.022 + (G.dayLift || 0) * 0.1, 0.09, 0.36);
    if (key !== S.key) {
      if (key !== null) { S.pos.init = false; S.rot.init = false; S.grip = 0; play('switch', 0.12); }
      S.key = key; S.kind = kind;
    }
    if (fp.VM_OPTS.rev !== S.rev || (S.arms[0] && !S.arms[0].parent)) { S.rev = fp.VM_OPTS.rev; attach(kind, id); }
    suck.visible = false; fill.visible = false;
    if (kind === 'none') { S.lastCam = null; FLU.uI.value = 0; flash.visible = false; return; }
    // ---- spring on the primary node (camera-local target from the rules)
    const prim = kind === 'trash' ? n1 : n0;
    readNode(prim, tP, tQ);
    let k = 380, zeta = 0.62, kr = 420, zr = 0.62, maxLag = 0.06;
    const swing = g.swing > 0 && (kind === 'melee' || kind === 'throw');
    let spec = null;
    if (kind === 'gun') { spec = guns.spec(id); k = 520 + 900 * ads; zeta = 0.7; kr = 560 + 1000 * ads; zr = 0.72; maxLag = 0.04; }
    else if (kind === 'melee' || kind === 'throw') { if (swing) { k = 1100; kr = 1200; zeta = 0.7; zr = 0.7; } }
    else if (kind === 'box') { k = 190; zeta = 0.45; kr = 220; zr = 0.5; maxLag = 0.08; }
    else if (kind === 'broom' || kind === 'drag') { k = 2000; zeta = 0.9; kr = 2000; zr = 0.9; maxLag = 0.02; }
    else if (kind === 'trash') { k = 260; zeta = 0.5; }
    // melee and throwables sit a little higher than the rules' pose so the gripping hand is in view
    if (kind === 'melee' || kind === 'throw') tP.add(tmp2.set(-0.03, 0.075, 0.02));
    const wP = tmp.copy(tP).applyQuaternion(camQ), wQ = oQ.copy(camQ).multiply(tQ);
    if (v.shots !== S.shots) {
      if (kind === 'gun' && v.shots > S.shots) {
        const kb = spec.kick[0] || 0.05;
        S.pos.v.add(V(0, 0.12, 0.5).multiplyScalar(0.5 + kb * 9).applyQuaternion(camQ));
        S.rot.w.add(V(1, 0, 0).applyQuaternion(camQ).multiplyScalar(1.5 + kb * 25));
        S.flashT = 0.06; S.trig = 1;
      }
      S.shots = v.shots;
    }
    if (swing && !S.wasSwing) { S.pos.v.add(V(-0.3, 0.12, -0.5).applyQuaternion(camQ)); S.rot.w.add(V(-2, 0.7, 1).applyQuaternion(camQ)); }
    S.wasSwing = swing;
    // a share of the camera's own motion as inertia (step bob, jump, landing)
    if (S.lastCam) { const d = tmp2.copy(camP).sub(S.lastCam); if (d.lengthSq() < 0.25) { S.pos.x.x -= d.x * 0.05; S.pos.x.z -= d.z * 0.05; S.pos.x.y -= d.y * 0.3; } }
    S.lastCam = (S.lastCam || V()).copy(camP);
    S.pos.step(wP, dt, k, zeta, maxLag);
    S.rot.step(wQ, dt, kr, zr, kind === 'gun' ? 0.12 : 0.3);
    oP.copy(S.pos.x).applyQuaternion(invQ);
    const lq = new THREE.Quaternion().copy(invQ).multiply(S.rot.q);
    // move the secondary node (magazine / pump + left hand, the bag) by the same rigid correction
    const sec = kind === 'trash' ? n0 : n1;
    readNode(prim, tmp2, tQ);
    Mt.compose(tmp2, tQ, ONE); M0.compose(oP, lq, ONE);
    Md.multiplyMatrices(M0, Mi.copy(Mt).invert());
    readNode(sec, tmp2, oQ); M1.compose(tmp2, oQ, ONE).premultiply(Md);
    writeNode(prim, oP, lq);
    const sp = V(), sq = new THREE.Quaternion(), ss = V(); M1.decompose(sp, sq, ss);
    if (sec.pos.y > -4) writeNode(sec, sp, sq);
    // ---- fingers: close as the item comes up, trigger finger pulls on a shot, the bag hand opens when it lets go
    const equip = v.equip === undefined ? 1 : v.equip;
    S.grip = Math.min(1, S.grip + dt / 0.18);
    let grip = S.grip * (kind === 'gun' || kind === 'melee' || kind === 'throw' ? clamp(equip * 1.6 - 0.2, 0, 1) : 1);
    if (kind === 'trash' && n1.pos.y < -4) grip = 0.1;
    S.trig = Math.max(0, S.trig - dt / 0.12);
    if (kind === 'gun' && S.arms.some((a) => a.userData.magHand)) {
      // magazine node displaced from the gun (rigid offset of n1 against n0) = the rules are reloading
      readNode(n0, tmp2, tQ); Mt.compose(tmp2, tQ, ONE); readNode(n1, tmp, oQ); M1.compose(tmp, oQ, ONE);
      Md.multiplyMatrices(Mi.copy(Mt).invert(), M1); const e = Md.elements;
      const off = Math.hypot(e[12], e[13], e[14]) + 0.05 * (Math.abs(e[1]) + Math.abs(e[9]) + Math.abs(e[4]));
      const onMag = off > 0.02;
      for (const a of S.arms) { if (a.userData.magHand) a.visible = onMag; else if (a.userData.foreHand) a.visible = !onMag; }
    }
    for (const a of S.arms) poseArm(a, grip, S.trig, t);
    // muzzle flash at the sprung gun
    const nodeM = M0.compose(oP, lq, ONE);
    G.renderer.getDrawingBufferSize(vpx);
    const px = vpx.y * G.viewCam.projectionMatrix.elements[5] * 0.5;
    if (kind === 'gun' && S.flashT > 0 && !['Bow', 'Crossbow', 'Saw', 'Nail'].includes(spec.class)) {
      FLU.uP2.value.copy(V(spec.muzzle.x + 0.03, spec.muzzle.y, spec.muzzle.z).applyMatrix4(nodeM));
      FLU.uI.value = 3.0 * (S.flashT / 0.06); FLU.uPx.value = px; FLU.uSize.value = spec.class === 'Shotgun' || spec.class === 'Sniper' ? 0.22 : 0.15; // gốc: sao chớp to (c01 5:44:59)
    } else FLU.uI.value = 0;
    flash.visible = FLU.uI.value > 0;
    S.flashT = Math.max(0, S.flashT - dt);
    // vacuum: while the rules sweep (prompt "Sweeping..."), dust streams into the nozzle and the motor hums
    const sweeping = kind === 'broom' && typeof g.prompt === 'string' && g.prompt.startsWith('Sweeping');
    if (sweeping && g.cy.sweep_at) {
      const pa = g.cy.sweep_at;
      SU.uP0.value.set(pa.x, pa.y + 0.05, pa.z).sub(camP).applyQuaternion(invQ);
      SU.uP2.value.copy(V(0, -1.2, 0.02).applyMatrix4(nodeM));
      SU.uP1.value.copy(SU.uP0.value).lerp(SU.uP2.value, 0.5).add(V(Math.sin(t * 7) * 0.08, 0.12, Math.cos(t * 5) * 0.05));
      SU.uTime.value = t * 1.6; SU.uPx.value = px;
      suck.visible = true;
      humT -= dt; if (humT <= 0) { humT = 0.45; play('whoosh', 0.12); }
    }
    if (kind === 'broom') {
      const f = clamp(((g.sweep_done || 0) + (sweeping ? 1 - (g.cy.sweep_dirt || 0) : 0)) / 9, 0.04, 1);
      _fs.makeTranslation(0, -0.075, 0.105).multiply(new THREE.Matrix4().makeScale(1, 0.15 * f, 1));
      fill.matrix.copy(_fm.copy(nodeM).multiply(_fs)); fill.visible = true;
      fillMat.color.setRGB(2.2 + (sweeping ? Math.sin(t * 20) * 0.6 : 0), 5.0, 5.8);
    }
  }]);
  return S;
}
