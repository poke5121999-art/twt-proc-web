// Plug-in "hands": the player's own first-person hands are robot hands of the cast in js/robots/ (rigid bevelled parts,
// visible joints, chipped paint, screws), and nothing the player holds is gripped any more. Every held thing (weapons,
// guns, throwables, boxes, trash bags, the broom) floats in front of the player, tethered by a glowing grab beam from an
// emitter in the robot palm: position and rotation follow the rules' hold pose through a spring-damper in WORLD space,
// so the object lags behind camera turns, bobs with walking, sways, overshoots and settles; jumps and landings jolt it.
// Melee swings fling it along the rules' arc (stiffer spring + an impulse, so the visual peak still precedes the rules'
// hit moment at 27 % of the swing), shots kick the spring and flash at the floating muzzle, reloads are the off hand's
// beam pulling the magazine / shells, a box is held by two beams, a thrown bag leaves the beam (the beam collapses).
// View only: the rules (sim/fp.js pose, sim/carry.js pose) still compute the hold pose and every timer; this file only
// moves the two viewmodel nodes after the rules placed them, and draws the hands and beams. Nothing in window.__twt
// changes. ?hands=old (or ?noplug=hands) keeps the old human arms.
import * as THREE from '../../vendor/three.module.min.js';
import { noMask } from '../mats.js';
import { R, rbox, place, merge, sph, cyl, tor, bcyl, screw, caps, coil } from '../robots/robo-geo.js';
import { hand as handPart, limbSeg, joint } from '../robots/robo-parts.js';
import { robotDef } from '../robots/robo-cast.js';
import * as fp from '../sim/fp.js';
import * as player from '../sim/player.js';
import * as carry from '../sim/carry.js';
import * as items from '../sim/items.js';
import * as guns from '../sim/guns.js';
import * as audio from '../sim/audio.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const BEAM = new THREE.Color(0.42, 0.92, 1.0);
const PAL = [0xe3b23c, 0x24366b, 0x2a2c33, 0xc6cad0, 0x0a0f13, 0x04060a, 0x6fe8ff, 0x1c1c1f, 0xece7db, 0xe3b23c, 0xf25c54];
function play(name, vol) { try { audio.play(name, vol, null); } catch (e) { /* optional */ } }

// ------------------------------------------------------------------ material (palette regions + chipped paint)
function handMat(pal, wear) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2 });
  const chip = 0.7 - 0.25 * (wear === undefined ? 0.4 : wear);
  const U = { uPal: { value: (pal || PAL).slice(0, 11).map((h) => new THREE.Color(h)) }, uGlow: { value: 2.5 }, uChip: { value: chip } };
  m.userData.U = U;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aReg; varying float vReg; varying vec3 vOP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvReg = aReg; vOP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vReg; varying vec3 vOP; uniform vec3 uPal[11]; uniform float uGlow; uniform float uChip; float gChip; float gDirt; int gReg;
float hh(vec3 p){ p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float hn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(mix(hh(i),hh(i+vec3(1,0,0)),f.x),mix(hh(i+vec3(0,1,0)),hh(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hh(i+vec3(0,0,1)),hh(i+vec3(1,0,1)),f.x),mix(hh(i+vec3(0,1,1)),hh(i+vec3(1,1,1)),f.x),f.y),f.z); }
float hf(vec3 p){ return .5*hn(p) + .27*hn(p*2.03+7.1) + .14*hn(p*4.1+3.3) + .07*hn(p*8.3+1.7); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
gReg = int(vReg + .5); vec3 base = uPal[gReg]; gChip = 0.; gDirt = hf(vOP * 14. + 5.);
if (gReg == 0 || gReg == 1 || gReg == 8 || gReg == 10) { float n = hf(vOP * 62.); gChip = smoothstep(uChip, uChip + .04, n); base = mix(base, vec3(.3, .31, .32), gChip); }
base *= .8 + .32 * gDirt;
diffuseColor.rgb = base;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = gReg == 3 ? .22 : gReg == 2 ? .48 : gReg == 7 ? .9 : gReg == 5 ? .06 : mix(.5, .32, gChip) + .12 * gDirt;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor = gReg == 3 ? 1. : gReg == 2 ? .75 : gReg == 5 ? .4 : gReg == 7 ? 0. : mix(.08, .9, gChip);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (gReg == 6) totalEmissiveRadiance = uPal[6] * uGlow; else if (gReg == 5) totalEmissiveRadiance = uPal[6] * uGlow * .18;`);
  };
  noMask(m);
  m.customProgramCacheKey = () => 'robohand-v2';
  return m;
}

// ------------------------------------------------------------------ hand geometry (origin = emitter, beam along +z)
function buildHand(side, mat) {
  const root = new THREE.Group();
  const parts = [];
  // forearm: bevelled shell, darker under-plate, a piston on the outer side, a coil cable, screws and a stripe
  parts.push(place(rbox(0.078, 0.072, 0.27, 0.017, R.A), [0, 0.004, -0.205]));
  parts.push(place(rbox(0.062, 0.02, 0.22, 0.008, R.DARK), [0, -0.034, -0.2]));
  parts.push(place(rbox(0.08, 0.014, 0.05, 0.006, R.B), [0, 0.035, -0.15]));
  parts.push(place(rbox(0.08, 0.014, 0.03, 0.006, R.B), [0, 0.035, -0.235]));
  for (let k = 0; k < 4; k++) parts.push(place(rbox(0.05, 0.006, 0.01, 0.002, R.DARK), [0, 0.0405, -0.285 + k * 0.016]));
  parts.push(place(bcyl(0.009, 0.15, 0.003, R.B, 10), [side * 0.045, -0.012, -0.29], [Math.PI / 2, 0, 0]));
  parts.push(place(bcyl(0.0055, 0.12, 0.002, R.CHROME, 8), [side * 0.045, -0.012, -0.17], [Math.PI / 2, 0, 0]));
  parts.push(place(coil(0.008, 0.0024, 9, R.RUBBER, 0.16), [-side * 0.03, -0.04, -0.28], [Math.PI / 2, 0, 0]));
  for (const [x, z] of [[-0.026, -0.1], [0.026, -0.1], [-0.026, -0.3], [0.026, -0.3]]) parts.push(screw([x, 0.041, z], 0.0055, [0, 1, 0]));
  parts.push(screw([side * 0.04, 0.012, -0.11], 0.005, [side, 0, 0]));
  // wrist: exposed ball joint between two chrome collars
  parts.push(place(sph(0.03, R.DARK, 16, 12), [0, 0, -0.062]));
  parts.push(place(tor(0.031, 0.005, R.CHROME, 8, 22), [0, 0, -0.072]));
  parts.push(place(tor(0.029, 0.004, R.CHROME, 8, 22), [0, 0, -0.05]));
  // palm block with the emitter: chrome ring, dark lens and a glowing core, slight cup facing +z
  parts.push(place(rbox(0.088, 0.082, 0.04, 0.014, R.A), [0, 0.002, -0.026]));
  parts.push(place(rbox(0.06, 0.012, 0.03, 0.005, R.B), [0, 0.046, -0.03]));
  parts.push(place(tor(0.026, 0.0065, R.CHROME, 8, 26), [0, 0, -0.004]));
  parts.push(place(cyl(0.023, 0.023, 0.008, R.LENS, 22), [0, 0, -0.006], [Math.PI / 2, 0, 0]));
  parts.push(place(sph(0.012, R.GLOW, 14, 10), [0, 0, -0.002]));
  for (const a of [0.6, 2.2, 3.8, 5.4]) parts.push(screw([Math.cos(a) * 0.036, Math.sin(a) * 0.033, -0.006], 0.004, [0, 0, 1]));
  root.add(mk(merge(parts), mat));
  // fingers: three prongs on the rim and an opposed thumb, two segments each, knuckle balls visible, curl animated
  const fingers = [];
  const spots = [[-0.03, 0.036, 0.0], [0.0, 0.042, 0.0], [0.03, 0.036, 0.0], [side * -0.04, -0.03, 0.0]];
  spots.forEach(([x, y], i) => {
    const thumb = i === 3;
    const knuckle = new THREE.Group();
    knuckle.position.set(x * (thumb ? 1 : 1), y, -0.012);
    // aim the finger outwards from the emitter centre so the prongs ring the beam
    const out = Math.atan2(y, x);
    knuckle.rotation.set(0, 0, out - Math.PI / 2);
    const seg1 = new THREE.Group(), seg2 = new THREE.Group();
    const L1 = thumb ? 0.034 : 0.04, L2 = thumb ? 0.026 : 0.032, W = thumb ? 0.018 : 0.016;
    seg1.add(mk(merge([place(sph(0.0105, R.DARK, 12, 8), [0, 0, 0]), place(rbox(W, L1, 0.017, 0.006, R.A), [0, L1 * 0.5 + 0.004, 0]), screw([0, L1 * 0.45, -0.009], 0.003, [0, 0, -1])]), mat));
    seg2.position.set(0, L1 + 0.006, 0);
    seg2.add(mk(merge([place(sph(0.0085, R.DARK, 10, 8), [0, 0, 0]), place(rbox(W * 0.9, L2, 0.015, 0.006, R.B), [0, L2 * 0.5 + 0.003, 0]), place(rbox(W * 0.7, 0.008, 0.012, 0.003, R.RUBBER), [0, L2 + 0.004, 0.002])]), mat));
    seg1.add(seg2); knuckle.add(seg1); root.add(knuckle);
    fingers.push({ seg1, seg2, thumb, ph: i * 1.7 });
  });
  root.userData.fingers = fingers;
  root.scale.setScalar(0.78);
  root.traverse((o) => { o.layers.set(1); o.frustumCulled = false; if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
  return root;
}
// The player's own robot (cine.js spawns the cutscene player as people.spawn(0x51a7c0de, null, .., {role:'survivor'}), whose
// look is robotDef(.., 'survivor'): olive / khaki paint, wear 0.6, 'mitt' hands, 'piston' limbs). The first-person arm is
// built from the very same parts (robo-parts hand / limbSeg / joint, buildProto's forearm = limbSeg(limb, limbR*0.9,
// armLen/2), elbow ball = joint(limbR*1.8, DARK), hand region A when swapAB) and drawn at FP_SCALE so it reads in view.
// Beam emitter: a small lens set into the mitt's palm edge (the only addition). Origin = emitter, beam along +z.
const FP_SCALE = 1.45;
export function playerSpec() { return robotDef(0x51a7c0de, 'survivor').spec; }
function buildRobotHand(spec, mat) {
  const root = new THREE.Group();
  const handReg = spec.swapAB ? R.A : (spec.seed % 3 === 0 ? R.WHITE : R.B);
  const r = spec.limbR, len = spec.armLen * 0.5, wristZ = -0.058;
  const parts = [];
  // mitt: fingers (-y in its own frame) point along the beam
  parts.push(place(handPart(spec.hand, handReg).clone(), [0, 0, wristZ], [-Math.PI / 2, 0, 0]));
  // forearm piston from the elbow (far back) to the wrist, elbow ball
  parts.push(place(limbSeg(spec.limb, r * 0.9, len).clone(), [0, 0, wristZ - len], [Math.PI / 2, 0, 0]));
  parts.push(place(joint(r * 1.8, R.DARK).clone(), [0, 0, wristZ - len]));
  // emitter lens in the mitt's front edge
  parts.push(place(tor(0.0085, 0.0022, R.CHROME, 6, 16), [0, 0, -0.003]));
  parts.push(place(sph(0.0065, R.GLOW, 10, 8), [0, 0, -0.002]));
  root.add(mk(merge(parts), mat));
  root.userData.fingers = [];
  root.scale.setScalar(FP_SCALE);
  root.traverse((o) => { o.layers.set(1); o.frustumCulled = false; if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
  return root;
}
function mk(geo, mat) { const m = new THREE.Mesh(geo, mat); m.layers.set(1); m.frustumCulled = false; return m; }
// finger pose: open = prongs splay forward around the beam; closed = curled fist (no beam)
function poseFingers(hand, open, t, twitch) {
  for (const f of hand.userData.fingers) {
    const w = Math.sin(t * 11 + f.ph) * 0.06 * twitch;
    const c1 = (f.thumb ? 1.1 : 1.2) + 0.85 * (1 - open) + w, c2 = 0.3 + 0.95 * (1 - open) + w * 0.5;
    // curl about local x: positive bends the finger toward +z (toward the held thing)
    f.seg1.rotation.x = c1; f.seg2.rotation.x = c2;
  }
}

// ------------------------------------------------------------------ beam (quadratic bezier ribbon + particles + glow)
const BEAM_VS = `
attribute float aT; attribute float aS;
uniform vec3 uP0, uP1, uP2; uniform float uW, uTime, uSeed;
varying float vT; varying float vS;
vec3 bez(float t){ float u = 1. - t; return u*u*uP0 + 2.*u*t*uP1 + t*t*uP2; }
void main(){
  float t = aT; vec3 p = bez(t);
  vec3 tg = normalize(bez(min(t + .01, 1.)) - bez(max(t - .01, 0.)) + vec3(1e-6));
  vec3 vd = normalize(p + vec3(1e-6));
  vec3 sd = normalize(cross(tg, vd) + vec3(1e-6)); vec3 up = normalize(cross(sd, tg) + vec3(1e-6));
  float env = sin(3.14159 * t);
  float j1 = sin(t*37. + uTime*31. + uSeed)*.5 + sin(t*71. - uTime*47.)*.3;
  float j2 = cos(t*29. - uTime*23. + uSeed)*.5 + sin(t*53. + uTime*41.)*.3;
  p += (sd*j1 + up*j2) * .0016 * env;
  float w = uW * (.8 + .2*sin(uTime*57. + t*21.)) * mix(.7, 1., env);
  p += sd * aS * w;
  vT = t; vS = aS;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.);
}`;
const BEAM_FS = `
uniform vec3 uCol; uniform float uI, uEnd, uStart, uTime;
varying float vT; varying float vS;
void main(){
  if (vT > uEnd || vT < uStart) discard;
  float core = exp(-vS*vS*28.), glow = exp(-vS*vS*3.5) * .42;
  float fl = .72 + .28 * sin(vT*80. - uTime*64.) * sin(uTime*17. + vT*5.);
  float pulse = .5 + .5 * smoothstep(.0, .06, fract(vT*3. - uTime*2.6)) * smoothstep(.2, .06, fract(vT*3. - uTime*2.6));
  float ends = smoothstep(uStart, uStart + .05, vT) * smoothstep(uEnd, uEnd - .03, vT);
  vec3 c = uCol * (glow + core * (1.3 + .6 * pulse)) + vec3(1.) * core * .9;
  gl_FragColor = vec4(c * uI * fl * ends, 0.);
}`;
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
function addMat(vs, fs, U) {
  return new THREE.ShaderMaterial({
    vertexShader: vs, fragmentShader: fs, uniforms: U, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, toneMapped: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
}
class Beam {
  constructor(parent, seed) {
    const N = 48, aT = [], aS = [], idx = [], pos = [];
    for (let i = 0; i <= N; i++) for (const s of [-1, 1]) { aT.push(i / N); aS.push(s); pos.push(0, 0, 0); }
    for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1)); g.setAttribute('aS', new THREE.Float32BufferAttribute(aS, 1)); g.setIndex(idx);
    this.U = { uP0: { value: V(0, 0, 0) }, uP1: { value: V(0, 0, 0) }, uP2: { value: V(0, 0, -1) }, uW: { value: 0.013 }, uTime: { value: 0 }, uSeed: { value: seed }, uCol: { value: BEAM.clone() }, uI: { value: 1 }, uEnd: { value: 1 }, uStart: { value: 0 } };
    this.mesh = new THREE.Mesh(g, addMat(BEAM_VS, BEAM_FS, this.U)); this.mesh.renderOrder = 20;
    const n = 22, ps = new Float32Array(n * 3), sd = new Float32Array(n);
    for (let i = 0; i < n; i++) sd[i] = (i * 0.6180339 + seed * 0.37) % 1;
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(ps, 3)); pg.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
    this.PU = { uP0: this.U.uP0, uP1: this.U.uP1, uP2: this.U.uP2, uTime: this.U.uTime, uEnd: this.U.uEnd, uCol: this.U.uCol, uI: this.U.uI, uPx: { value: 600 }, uSize: { value: 0.0042 }, uMode: { value: 0 } };
    this.pts = new THREE.Points(pg, addMat(PT_VS, PT_FS, this.PU)); this.pts.renderOrder = 21;
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)); gg.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(1), 1));
    this.GU = Object.assign({}, this.PU, { uSize: { value: 0.07 }, uMode: { value: 1 }, uI: { value: 1 } });
    this.glow = new THREE.Points(gg, addMat(PT_VS, PT_FS, this.GU)); this.glow.renderOrder = 19;
    for (const o of [this.mesh, this.pts, this.glow]) { o.layers.set(1); o.frustumCulled = false; parent.add(o); }
    this.on = 0; // 0..1 extension
    this.zap = 0;
    this.set(false);
  }
  set(v) { this.mesh.visible = this.pts.visible = this.glow.visible = v; }
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
const _aim = new THREE.Vector3(), _aim2 = new THREE.Vector3();
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
export async function install(G) {
  if (G.params.hands === 'old') return false;
  const g = G.g, sg = G.sg, root = sg.viewRoot;
  fp.VM_OPTS.arms = false;
  if (G.ctx && G.ctx.feel) G.ctx.feel.vm_item = -12345; // rebuild the viewmodel meshes without the human arms
  const spec = playerSpec();
  const mat = handMat(spec.pal, spec.wear);
  // one hand holds everything (owner: "a laser holds with one hand"); the left one stays out of view
  const RH = buildRobotHand(spec, mat), LH = new THREE.Group(); LH.visible = false;
  root.add(RH); root.add(LH);
  const beams = [new Beam(root, 0.3), new Beam(root, 2.1)];
  // vacuum suction: dust motes stream from the pile into the nozzle (particles of a third beam, ribbon hidden)
  const suck = new Beam(root, 4.4);
  suck.U.uCol.value.setRGB(0.55, 0.45, 0.33); suck.PU.uSize.value = 0.012; suck.mesh.visible = false;
  let humT = 0;
  // vacuum canister: a brighter glowing column inside the tank rises with the dust swept today (sweep_done / 9 piles)
  const fillMat = noMask(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 5.0, 5.8) }));
  const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.0345, 0.0345, 1, 14).translate(0, 0.5, 0), fillMat);
  fill.layers.set(1); fill.frustumCulled = false; fill.visible = false; fill.matrixAutoUpdate = false; root.add(fill);
  const _fm = new THREE.Matrix4(), _fs = new THREE.Matrix4();
  // a soft cyan light on the held object (fixed light count from boot on, so no shader recompiles later)
  const lamp = new THREE.PointLight(BEAM.getHex(), 0, 0.9, 2); lamp.layers.enableAll(); root.add(lamp);
  // sparks of the pick-up zap
  const NS = 28, sparkP = new Float32Array(NS * 3), sparkV = new Float32Array(NS * 3), sparkL = new Float32Array(NS), sparkS = new Float32Array(NS);
  for (let i = 0; i < NS; i++) sparkS[i] = (i * 0.618) % 1;
  const spg = new THREE.BufferGeometry(); spg.setAttribute('position', new THREE.BufferAttribute(sparkP, 3)); spg.setAttribute('aSeed', new THREE.BufferAttribute(sparkS, 1));
  const SPU = { uP0: { value: V() }, uP1: { value: V() }, uP2: { value: V() }, uTime: { value: 0 }, uEnd: { value: 1 }, uCol: { value: new THREE.Color(0.8, 1.0, 1.0) }, uI: { value: 1 }, uPx: { value: 600 }, uSize: { value: 0.006 }, uMode: { value: 2 } };
  const SPV = PT_VS.replace('} else { p = uP2; vA = 1.; }', '} else if (uMode < 1.5) { p = uP2; vA = 1.; } else { p = position; vA = 1.; }');
  const sparks = new THREE.Points(spg, addMat(SPV, PT_FS.replace('float k = uMode < .5 ?', 'float k = uMode < .5 || uMode > 1.5 ?'), SPU));
  sparks.layers.set(1); sparks.frustumCulled = false; sparks.renderOrder = 22; root.add(sparks);
  let nSpark = 0;
  function burst(at, n, speed) {
    for (let k = 0; k < n; k++) {
      const i = nSpark++ % NS, a = Math.random() * 6.283, b = Math.random() * 2 - 1, r = Math.sqrt(1 - b * b);
      sparkP.set([at.x, at.y, at.z], i * 3);
      sparkV.set([Math.cos(a) * r * speed, b * speed + 0.4, Math.sin(a) * r * speed], i * 3);
      sparkL[i] = 0.18 + Math.random() * 0.2;
    }
  }
  // muzzle flash at the floating gun
  const flg = new THREE.BufferGeometry(); flg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)); flg.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(1), 1));
  const FLU = { uP0: { value: V() }, uP1: { value: V() }, uP2: { value: V() }, uTime: { value: 0 }, uEnd: { value: 1 }, uCol: { value: new THREE.Color(1.0, 0.72, 0.35) }, uI: { value: 0 }, uPx: { value: 600 }, uSize: { value: 0.12 }, uMode: { value: 1 } };
  const flash = new THREE.Points(flg, addMat(PT_VS, PT_FS, FLU)); flash.layers.set(1); flash.frustumCulled = false; flash.renderOrder = 23; root.add(flash);

  const S = G.hands = {
    key: null, lastKey: null, kind: 'none', pos: new PosSpring(), rot: new RotSpring(), hr: new PosSpring(), hl: new PosSpring(),
    shots: 0, wasSwing: false, zap: 0, drop: 0, lastAnchor: [V(), V()], lastPalm: [V(), V()], lvis: 0, rvis: 0, flashT: 0, stats: { frames: 0 },
  };
  const camQ = new THREE.Quaternion(), camP = new THREE.Vector3(), invQ = new THREE.Quaternion();
  const tP = new THREE.Vector3(), tQ = new THREE.Quaternion(), oP = new THREE.Vector3(), oQ = new THREE.Quaternion();
  const M0 = new THREE.Matrix4(), M1 = new THREE.Matrix4(), Mt = new THREE.Matrix4(), Mi = new THREE.Matrix4(), Md = new THREE.Matrix4(), ONE = V(1, 1, 1);
  const tmp = V(), tmp2 = V(), lookM = new THREE.Matrix4(), UPV = V(0, 1, 0);
  const vpx = new THREE.Vector2();

  const kindOf = () => {
    const n0 = player.ViewModels[0];
    if (!n0 || !n0.visible || g.mode !== 'Play') return ['none', null];
    const ck = carry.vm_key(g);
    if (ck !== null) {
      if (ck === carry.VM_BROOM) return ['broom', ck];
      if (ck === carry.VM_DRAG) return ['drag', ck];
      // key by the held prop, not by the rules' mesh key (that one changes with the box contents)
      return [(ck - carry.VM_BASE) % 64 === 0 ? 'trash' : 'box', Math.floor((ck - carry.VM_BASE) / 64)];
    }
    const w = g.cur_w(), it = w !== null ? w.item : g.cb.throw_item;
    if (it === null || it === undefined) return ['none', null];
    if (items.gun(it) !== null) return ['gun', it];
    return [items.throwable(it) !== null ? 'throw' : 'melee', it];
  };
  const bboxOf = (node) => {
    const m = node && node.mesh3; if (!m) return null;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    return m.geometry.boundingBox;
  };
  // camera-local transform of a viewmodel node as the rules left it this frame
  const readNode = (n, P, Q) => { P.set(n.pos.x, n.pos.y, n.pos.z); Q.set(n.quat[0], n.quat[1], n.quat[2], n.quat[3]); };
  const writeNode = (n, P, Q) => { n.set_pos(new n.pos.constructor(P.x, P.y, P.z)); n.set_quat([Q.x, Q.y, Q.z, Q.w]); };
  const aimHand = (hand, at, palm, open, t, vis, roll) => {
    hand.visible = vis > 0.02;
    if (!hand.visible) return;
    hand.position.copy(palm);
    // never point the palm back at the camera (the forearm would fill the screen): keep a forward share in the aim,
    // the beam itself still bends to the real target
    const d = _aim.copy(at).sub(palm), L = d.length() || 1;
    if (d.z > -0.45 * L) d.z = -0.45 * L;
    d.y = clamp(d.y, -0.3 * L, 0.45 * L); // steep aims stand the forearm up in the middle of the view
    lookM.lookAt(_aim2.copy(palm).add(d), palm, UPV); hand.quaternion.setFromRotationMatrix(lookM);
    if (roll) hand.rotateZ(roll);
    poseFingers(hand, open, t, 1);
  };
  const setBeam = (b, palm, at, lag, t, dt, want) => {
    b.on = clamp(b.on + (want ? dt / 0.1 : -dt / 0.14), 0, 1);
    b.set(b.on > 0.001);
    if (!(b.on > 0.001)) return;
    b.U.uP0.value.copy(palm);
    b.U.uP2.value.copy(at);
    const mid = tmp.copy(palm).add(at).multiplyScalar(0.5), len = palm.distanceTo(at);
    mid.addScaledVector(lag, 0.9).add(tmp2.set(0, -0.025 * len, 0));
    b.U.uP1.value.copy(mid);
    b.U.uTime.value = t;
    b.U.uEnd.value = want ? b.on : 1;
    b.U.uStart.value = want ? 0 : 1 - b.on;
    const z = S.zap;
    b.U.uI.value = 1.0 + 2.5 * z;
    b.U.uW.value = 0.012 + 0.012 * z;
    b.GU.uI.value = (0.6 + 1.6 * z) * b.on;
    G.renderer.getDrawingBufferSize(vpx);
    const px = vpx.y * G.viewCam.projectionMatrix.elements[5] * 0.5;
    b.PU.uPx.value = px; b.GU.uPx.value = px;
  };

  G.updaters.push(['hands', (dt) => {
    const t = G.t;
    S.stats.frames++;
    const [kind, id] = kindOf();
    const key = kind === 'none' ? null : kind + ':' + id;
    const n0 = player.ViewModels[0], n1 = player.ViewModels[1];
    camQ.copy(G.camera.quaternion); camP.copy(G.camera.position); invQ.copy(camQ).invert();
    const v = g.fx2, feel = G.ctx.feel;
    const ads = v.ads || 0, equip = v.equip === undefined ? 1 : v.equip;
    // ---- pick-up / switch / drop
    if (key !== S.key) {
      if (key !== null) {
        S.zap = 1; S.pos.init = false; S.rot.init = false; S.hr.init = false; S.hl.init = false;
        S.fromPalm = true;
        play('switch', 0.22);
      } else S.drop = 1;
      S.key = key; S.kind = kind;
    }
    S.zap = Math.max(0, S.zap - dt / 0.35);
    if (kind === 'none') {
      // collapse: beams retract into the palms, hands sink away
      setBeam(beams[0], S.lastPalm[0], S.lastAnchor[0], tmp2.set(0, 0, 0), t, dt, false);
      setBeam(beams[1], S.lastPalm[1], S.lastAnchor[1], tmp2.set(0, 0, 0), t, dt, false);
      S.rvis = Math.max(0, S.rvis - dt / 0.25); S.lvis = Math.max(0, S.lvis - dt / 0.2);
      RH.position.y -= dt * 0.8; LH.position.y -= dt * 0.8;
      RH.visible = S.rvis > 0.02; LH.visible = S.lvis > 0.02;
      if (RH.visible) poseFingers(RH, 1 - S.rvis * 0.5, t, 0);
      lamp.intensity = 0; suck.pts.visible = false; fill.visible = false; tickFx(dt); return;
    }
    // ---- target of the primary object (camera-local) from the rules
    const prim = kind === 'trash' ? n1 : n0;
    readNode(prim, tP, tQ);
    let off = V(0, 0, 0), k = 160, zeta = 0.42, kr = 190, zr = 0.45, maxLag = 0.28;
    const swing = g.swing > 0 && (kind === 'melee' || kind === 'throw');
    let spec = null;
    if (kind === 'gun') { spec = guns.spec(id); off.set(0, 0.008, -0.1 * (1 - 0.75 * ads)); k = 240 + 500 * ads; zeta = 0.5 + 0.3 * ads; kr = 300 + 600 * ads; zr = 0.55 + 0.25 * ads; maxLag = 0.16; }
    else if (kind === 'melee' || kind === 'throw') { off.set(-0.03, 0.06, -0.12); if (swing) { k = 560; zeta = 0.42; kr = 620; zr = 0.4; } }
    else if (kind === 'box') { off.set(0, -0.12, -0.55); k = 75; zeta = 0.32; kr = 90; zr = 0.35; maxLag = 0.32; }
    else if (kind === 'broom') { k = 700; zeta = 0.8; kr = 700; zr = 0.8; maxLag = 0.1; }
    else if (kind === 'trash') { off.set(0, 0.05, -0.1); k = 120; zeta = 0.35; }
    // hover: the floating thing breathes on its own and bobs a little more than the camera while walking
    const bob = feel ? feel.bob : 0, moving = feel && feel.vel ? clamp(Math.hypot(feel.vel.x, feel.vel.z) / 5, 0, 1.4) : 0;
    const hov = (1 - 0.85 * ads) * (kind === 'broom' || kind === 'drag' ? 0 : 1);
    off.y += hov * (Math.sin(t * 2.3) * 0.006 + Math.sin(bob * 3.7 + 0.6) * 0.012 * moving);
    off.x += hov * Math.cos(bob * 1.85) * 0.008 * moving;
    if (kind === 'box') off.y -= 0.07 * Math.min(1, moving);
    tP.add(off);
    // world target
    // position spring lives in a camera-centred, world-oriented frame: turning makes it lag, walking does not drag it
    // behind; a share of the camera's own motion is fed in as inertia (bob, jump, landing jolt)
    const wP = tmp.copy(tP).applyQuaternion(camQ), wQ = oQ.copy(camQ).multiply(tQ);
    if (S.fromPalm) {
      // the object leaves the palm and zips into place on the spring
      S.fromPalm = false; S.pos.init = true; S.rot.init = true;
      const palm = V(0.2, -0.17, -0.3).applyQuaternion(camQ);
      S.pos.x.copy(palm); S.pos.v.set(0, 0, 0); S.rot.q.copy(wQ).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, -0.4, 0.3))); S.rot.w.set(0, 0, 0);
      if (kind === 'drag' || kind === 'broom') { S.pos.x.copy(wP); S.rot.q.copy(wQ); }
    }
    // impulses: shots kick, swings fling
    if (v.shots !== S.shots) {
      if (kind === 'gun' && v.shots > S.shots) {
        const kb = spec.kick[0] || 0.05;
        S.pos.v.add(V(0, 0.25, 1.0).multiplyScalar(0.5 + kb * 9).applyQuaternion(camQ));
        S.rot.w.add(V(1, 0, 0).applyQuaternion(camQ).multiplyScalar(3 + kb * 50));
        S.flashT = 0.06; S.zap = Math.max(S.zap, 0.35);
      }
      S.shots = v.shots;
    }
    if (swing && !S.wasSwing) {
      S.pos.v.add(V(-0.9, 0.35, -1.5).applyQuaternion(camQ));
      S.rot.w.add(V(-6, 2, 3).applyQuaternion(camQ));
      S.zap = Math.max(S.zap, 0.4);
    }
    S.wasSwing = swing;
    if (S.lastCam) { const d = tmp2.copy(camP).sub(S.lastCam); if (d.lengthSq() < 0.25) { S.pos.x.x -= d.x * 0.12; S.pos.x.z -= d.z * 0.12; S.pos.x.y -= d.y * 0.55; } }
    S.lastCam = (S.lastCam || V()).copy(camP);
    if (kind === 'gun' && g.cb.reload_t > 0) {
      const gd = items.gun(id)[1], pr = 1 - clamp(g.cb.reload_t / Math.max(gd.reload, 0.2), 0, 1);
      const u = clamp((pr - 0.1) / 0.32, 0, 1), spin = Math.PI * 2 * u * u * (3 - 2 * u);
      wQ.multiply(_qd.setFromAxisAngle(_aim.set(1, 0, 0), spin));
    }
    S.pos.step(wP, dt, k, zeta, maxLag);
    S.rot.step(wQ, dt, kr, zr, kind === 'gun' ? 0.35 : 0.8);
    // back to camera-local and onto the node
    oP.copy(S.pos.x).applyQuaternion(invQ);
    const lq = new THREE.Quaternion().copy(invQ).multiply(S.rot.q);
    if (kind !== 'drag') {
      // move the secondary node by the same rigid correction (magazine / pump of a gun, the second box mesh)
      const sec = kind === 'trash' ? n0 : n1;
      readNode(prim, tmp2, tQ); // un-offset rules target
      Mt.compose(tmp2, tQ, ONE); M0.compose(oP, lq, ONE);
      Md.multiplyMatrices(M0, Mi.copy(Mt).invert());
      readNode(sec, tmp2, oQ); M1.compose(tmp2, oQ, ONE).premultiply(Md);
      writeNode(prim, oP, lq);
      const sp = V(), sq = new THREE.Quaternion(), ss = V(); M1.decompose(sp, sq, ss);
      if (sec.pos.y > -4) writeNode(sec, sp, sq);
    }
    // ---- hands and beam anchors (camera-local)
    const sway = v.sway || { x: 0, y: 0 };
    const e = (1 - equip) * (1 - equip);
    const handBob = V(-sway.x * 0.05 + Math.cos(bob * 1.85) * 0.006, sway.y * 0.04 + Math.sin(bob * 3.7) * 0.007 + Math.sin(t * 1.3) * 0.003 - e * 0.18 + (v.land ? v.land.x * 0.05 : 0), 0);
    const nodeM = M0.compose(oP, lq, ONE);
    let rRest, lRest = null, rAt, lAt = null, lWant = false;
    if (kind === 'gun') {
      const pist = spec.class === 'Pistol' || spec.class === 'Revolver' || spec.class === 'Nail';
      rRest = pist ? V(0.2, -0.165, -0.3) : V(0.22, -0.175, -0.28);
      rAt = V(0, 0, 0).applyMatrix4(nodeM);
      const reloading = g.cb.reload_t > 0;
      lWant = false; // one hand: the same beam does the reload (below)
      if (lWant) {
        if (reloading || v.pump[0] > 0) {
          const bb = bboxOf(n1);
          lAt = bb && !bb.isEmpty() && n1.pos.y > -4 ? bb.getCenter(V()).applyMatrix4(M1.compose(V(n1.pos.x, n1.pos.y, n1.pos.z), new THREE.Quaternion(n1.quat[0], n1.quat[1], n1.quat[2], n1.quat[3]), ONE)) : V(spec.fore.x, spec.fore.y, spec.fore.z).applyMatrix4(nodeM);
          lRest = V(-0.14, -0.19, -0.36).lerp(lAt.clone().add(V(-0.06, -0.04, 0.0)), 0.2); lRest.z = Math.min(lRest.z, -0.32); lRest.y = Math.max(lRest.y, -0.2); lRest.x = Math.max(lRest.x, -0.2);
        } else {
          lAt = V(spec.fore.x, spec.fore.y, spec.fore.z).applyMatrix4(nodeM);
          lRest = V(-0.12, -0.18, -0.32);
        }
      }
      if (g.cb.reload_t > 0 || v.pump[0] > 0) {
        const bb = bboxOf(n1);
        if (bb && !bb.isEmpty() && n1.pos.y > -4) {
          const c0 = bb.getCenter(V());
          const magW = c0.clone().applyMatrix4(M1.compose(V(n1.pos.x, n1.pos.y, n1.pos.z), new THREE.Quaternion(n1.quat[0], n1.quat[1], n1.quat[2], n1.quat[3]), ONE));
          if (magW.distanceTo(c0.clone().applyMatrix4(nodeM)) > 0.035) rAt = magW;
        }
      }
      rRest.y -= 0.05 * ads; rRest.x += 0.03 * ads;
    } else if (kind === 'melee' || kind === 'throw') {
      rRest = V(0.2, -0.17, -0.3).add(V(0, g.cb.charge * 0.05, g.cb.charge * 0.06));
      rAt = V(0, kind === 'throw' ? -0.03 : -0.1, 0).applyMatrix4(nodeM);
    } else if (kind === 'box') {
      const bb = bboxOf(n0) || new THREE.Box3(V(-0.2, 0, -0.15), V(0.2, 0.3, 0.15));
      const c = bb.getCenter(V()), hw = (bb.max.x - bb.min.x) * 0.38;
      rAt = V(c.x, bb.max.y * 0.6 + c.y * 0.4, c.z).applyMatrix4(nodeM); void hw;
      rRest = V(0.2, -0.17, -0.3); lRest = null; lAt = null;
    } else if (kind === 'broom') {
      rAt = V(0, 0.0, 0.04).applyMatrix4(nodeM);
      rRest = V(0.2, -0.16, -0.3);
    } else if (kind === 'trash') {
      const bb = bboxOf(n1);
      const c = bb ? V((bb.min.x + bb.max.x) / 2, bb.max.y - 0.04, (bb.min.z + bb.max.z) / 2) : V(0, -0.2, 0);
      rAt = c.applyMatrix4(nodeM.compose(V(n1.pos.x, n1.pos.y, n1.pos.z), new THREE.Quaternion(n1.quat[0], n1.quat[1], n1.quat[2], n1.quat[3]), ONE));
      readNode(n0, tmp2, tQ);
      rRest = V(0.2, -0.17, -0.3);
      if (n1.pos.y < -4) rAt = null; // released: the beam lets go
    } else { // drag
      const h = g.cy.hand;
      rAt = h ? V(h.x, h.y, h.z).sub(camP).applyQuaternion(invQ) : V(0.2, -1.2, -0.6);
      rRest = V(0.2, -0.17, -0.3);
    }
    rRest.add(handBob);
    S.hr.step(rRest, dt, 420, 0.7, 0.2);
    S.rvis = Math.min(1, S.rvis + dt / 0.15);
    S.lvis = clamp(S.lvis + (lWant ? dt / 0.15 : -dt / 0.15), 0, 1);
    const rPalm = S.hr.x.clone().add(V(0, -(1 - S.rvis) * 0.3, 0));
    aimHand(RH, rAt || rPalm.clone().add(V(-0.05, 0.2, -1)), rPalm, rAt ? 1 : 0.2, t, S.rvis, 0.15);
    const emitter = (hand, palm) => palm.clone().add(V(0, 0, 0.006).applyQuaternion(hand.quaternion));
    if (rAt) { const ep = emitter(RH, rPalm); S.lastPalm[0].copy(ep); S.lastAnchor[0].copy(rAt); }
    const lag = V().copy(S.pos.x).sub(wP).applyQuaternion(invQ);
    setBeam(beams[0], S.lastPalm[0], S.lastAnchor[0], lag, t, dt, !!rAt);
    if (lRest) {
      lRest.add(handBob);
      S.hl.step(lRest, dt, 380, 0.7, 0.25);
      const lPalm = S.hl.x.clone().add(V(0, -(1 - S.lvis) * 0.35, 0));
      aimHand(LH, lAt, lPalm, 1, t + 0.7, S.lvis, -0.15);
      S.lastPalm[1].copy(emitter(LH, lPalm)); S.lastAnchor[1].copy(lAt);
    } else {
      S.hl.init = false;
      LH.visible = S.lvis > 0.02;
      if (LH.visible) LH.position.y -= dt * 1.2;
    }
    setBeam(beams[1], S.lastPalm[1], S.lastAnchor[1], lag, t, dt, lWant && !!lAt);
    if (S.zap > 0.97 && rAt) burst(rAt, 14, 0.9);
    // glow light on the object
    lamp.position.copy(rAt || rPalm); lamp.intensity = (0.25 + 0.9 * S.zap) * beams[0].on;
    // muzzle flash at the floating gun
    if (kind === 'gun' && S.flashT > 0 && !['Bow', 'Crossbow', 'Saw', 'Nail'].includes(spec.class)) {
      FLU.uP2.value.copy(V(spec.muzzle.x + 0.03, spec.muzzle.y, spec.muzzle.z).applyMatrix4(nodeM));
      FLU.uI.value = 3.0 * (S.flashT / 0.06); FLU.uPx.value = beams[0].PU.uPx.value; FLU.uSize.value = spec.class === 'Shotgun' || spec.class === 'Sniper' ? 0.16 : 0.11;
    } else FLU.uI.value = 0;
    S.flashT = Math.max(0, S.flashT - dt);
    // vacuum: while the rules sweep (prompt "Sweeping..."), dust streams into the nozzle and the motor hums
    const sweeping = kind === 'broom' && typeof g.prompt === 'string' && g.prompt.startsWith('Sweeping');
    if (sweeping && g.cy.sweep_at) {
      const pa = g.cy.sweep_at;
      suck.U.uP0.value.set(pa.x, pa.y + 0.05, pa.z).sub(camP).applyQuaternion(invQ);
      suck.U.uP2.value.copy(V(0, -1.2, 0.02).applyMatrix4(nodeM));
      suck.U.uP1.value.copy(suck.U.uP0.value).lerp(suck.U.uP2.value, 0.5).add(V(Math.sin(t * 7) * 0.08, 0.12, Math.cos(t * 5) * 0.05));
      suck.U.uTime.value = t * 1.6; suck.U.uEnd.value = 1; suck.U.uI.value = 1.2; suck.PU.uPx.value = beams[0].PU.uPx.value;
      suck.pts.visible = true;
      humT -= dt; if (humT <= 0) { humT = 0.45; play('whoosh', 0.12); }
    } else suck.pts.visible = false;
    if (kind === 'broom') {
      const f = clamp(((g.sweep_done || 0) + (sweeping ? 1 - (g.cy.sweep_dirt || 0) : 0)) / 9, 0.04, 1);
      _fs.makeTranslation(0, -0.075, 0.105).multiply(new THREE.Matrix4().makeScale(1, 0.15 * f, 1));
      fill.matrix.copy(_fm.copy(nodeM).multiply(_fs)); fill.visible = true;
      fillMat.color.setRGB(2.2 + (sweeping ? Math.sin(t * 20) * 0.6 : 0), 5.0, 5.8);
    } else fill.visible = false;
    flash.visible = FLU.uI.value > 0;
    tickFx(dt);
  }]);
  function tickFx(dt) {
    let any = false;
    for (let i = 0; i < NS; i++) {
      if (sparkL[i] <= 0) { sparkP[i * 3 + 1] = -50; continue; }
      any = true; sparkL[i] -= dt;
      sparkV[i * 3 + 1] -= 3.0 * dt;
      for (let a = 0; a < 3; a++) sparkP[i * 3 + a] += sparkV[i * 3 + a] * dt;
    }
    spg.attributes.position.needsUpdate = true;
    sparks.visible = any;
    SPU.uPx.value = beams[0].PU.uPx.value;
  }
  return S;
}
