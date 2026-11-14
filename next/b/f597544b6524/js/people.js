// People view: every human and zombie of The Walking Trade (procedural), drawn with the Lanternfall character kit
// (Lanternfall by loktar00, github.com/loktar00/lanternfall @ ada0fd5; generated port in lib/lf/, never edited).
//
//   const people = createPeople(G)   G = { scene, camera, renderer, quality: { name } }
//   const p = people.spawn(seed, kind, pos, opts)   kind null = living human, else a ZKind string
//   p.update(desc)   every frame (desc documented in js/sim/actors.js, staff.js, cine.js, carry.js VIEW NOTES)
//   people.update(dt)   once per frame after all p.update calls: animation, LOD, culling
//   p.despawn()   p.mesh (THREE.Object3D)
//
// Rendering: one prototype per look (built once from js/people-defs.js), instances share its BufferGeometry.
// Lanternfall skins on the CPU; here the pose is solved on the CPU (28 bones, HumanAnim + leg IK) and the skinning runs
// on the GPU: the kit's surface material (lib/lf/kit.js makeSurfMat) is wrapped to read 28 bone matrices from a uniform
// array, a matching depth material casts the shadow, and the fragment writes alpha 0 (no SSR reflectivity, js/mats.js
// noMask contract). Lit by the scene's sun + PMREM environment like every MeshStandardMaterial.
//
// Sim conventions (actors.js VIEW NOTES): model faces -Z at yaw 0 (yaw_to(d) = atan2(-d.x, -d.z)); Lanternfall figures
// face +Z, so mesh.rotation.y = yaw + PI. Movement speed comes from the change of desc.pos (people are never moved here).
import * as THREE from '../vendor/three.module.min.js';
import { Figure, makeSurfMat } from '../lib/lf/kit.js';
import { HumanAnim, rotUV } from '../lib/lf/anim.js';
import { angDiff, clamp, lerp } from '../lib/lf/util.js';
import { humanDef, zombieDef, zombieInstanceStyle } from './people-defs.js';
import { keepAlpha } from './mats.js';

const NB = 28;
const SKIN_PARS = `
uniform vec4 uBone[${NB * 3}];
attribute float aBA; attribute float aBB; attribute float aW;
vec3 lfSkP(int i, vec3 p) { return vec3(dot(uBone[i].xyz, p) + uBone[i].w, dot(uBone[i + 1].xyz, p) + uBone[i + 1].w, dot(uBone[i + 2].xyz, p) + uBone[i + 2].w); }
vec3 lfSkN(int i, vec3 n) { return vec3(dot(uBone[i].xyz, n), dot(uBone[i + 1].xyz, n), dot(uBone[i + 2].xyz, n)); }
`;
const SKIN_N = `
{ int ia = int(aBA + 0.5) * 3, ib = int(aBB + 0.5) * 3; objectNormal = mix(lfSkN(ia, objectNormal), lfSkN(ib, objectNormal), aW); }
`;
const SKIN_P = `
{ int ia = int(aBA + 0.5) * 3, ib = int(aBB + 0.5) * 3; transformed = mix(lfSkP(ia, position), lfSkP(ib, position), aW); }
`;

function gpuSurfMat(boneU) {
  const m = makeSurfMat(), lf = m.onBeforeCompile;
  m.userData.u.uBone = boneU;
  m.onBeforeCompile = (sh, r) => {
    lf(sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + SKIN_PARS)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + SKIN_N)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SKIN_P);
    sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  gl_FragColor.a = 0.0;');
  };
  m.customProgramCacheKey = () => 'lfgpu1';
  return m;
}
function gpuDepthMat(boneU) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uBone = boneU;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + SKIN_PARS).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SKIN_P);
  };
  m.customProgramCacheKey = () => 'lfgpudepth1';
  return m;
}

// prototype: geometry shared by every instance of a look
function makeProto(def) {
  const fig = def.build();
  const d = fig.d, g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.N, 3));
  g.setAttribute('color', new THREE.BufferAttribute(d.C, 3));
  g.setAttribute('aUv', new THREE.BufferAttribute(d.UV, 2));
  g.setAttribute('aMat', new THREE.BufferAttribute(d.M, 4));
  g.setAttribute('aRest', new THREE.BufferAttribute(d.P, 3));
  g.setAttribute('aBA', new THREE.BufferAttribute(d.BA, 1));
  g.setAttribute('aBB', new THREE.BufferAttribute(d.BB, 1));
  g.setAttribute('aW', new THREE.BufferAttribute(d.W, 1));
  g.setIndex(new THREE.BufferAttribute(d.I, 1));
  const H = fig.height;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, H * 0.5, 0), H * 1.1 + 0.5);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-H, -0.2, -H), new THREE.Vector3(H, H * 1.4, H));
  fig.dispose();
  return { def, rig: fig.rig, d, P: fig.P, fx: fig.fx, height: H, geom: g, tris: d.I.length / 3, verts: fig.nv };
}

// an instance: duck-typed Lanternfall Figure (solve/bonePoint from Figure.prototype) whose skin() uploads bones
function makePuppet(proto) {
  const f = Object.create(Figure.prototype), nb = proto.rig.n;
  f.rig = proto.rig; f.d = proto.d; f.nv = proto.verts; f.nb = nb; f.P = proto.P; f.fx = proto.fx; f.height = proto.height;
  f.euler = new Float32Array(nb * 3); f.trans = new Float32Array(nb * 3); f.R = new Float32Array(nb * 9); f.Wp = new Float32Array(nb * 3); f.O = new Float32Array(nb * 3);
  f.absR = new Float32Array(nb * 9); for (let i = 0; i < nb; i++) f.absR[i * 9] = f.absR[i * 9 + 4] = f.absR[i * 9 + 8] = 1;
  f.free = null; f.hideB = new Uint8Array(nb);
  f.bones = new Float32Array(NB * 12); const boneU = { value: f.bones };
  f.mat = gpuSurfMat(boneU); f.u = f.mat.userData.u; f.u.uDisH.value = proto.height;
  f.mesh = new THREE.Mesh(proto.geom, f.mat); f.mesh.castShadow = true; f.mesh.receiveShadow = true;
  f.mesh.customDepthMaterial = gpuDepthMat(boneU);
  f.skin = skinGPU; f.dispose = () => { f.mat.dispose(); f.mesh.customDepthMaterial.dispose(); };
  f.solve(); f.skin();
  return f;
}
function skinGPU() {
  const R = this.R, O = this.O, B = this.bones, n = this.nb;
  for (let i = 0; i < n; i++) {
    const r = i * 9, o = i * 3, b = i * 12;
    B[b] = R[r]; B[b + 1] = R[r + 1]; B[b + 2] = R[r + 2]; B[b + 3] = O[o];
    B[b + 4] = R[r + 3]; B[b + 5] = R[r + 4]; B[b + 6] = R[r + 5]; B[b + 7] = O[o + 1];
    B[b + 8] = R[r + 6]; B[b + 9] = R[r + 7]; B[b + 10] = R[r + 8]; B[b + 11] = O[o + 2];
  }
}

const mix32 = (a) => { a = Math.imul(a ^ (a >>> 16), 0x45d9f3b); a = Math.imul(a ^ (a >>> 16), 0x45d9f3b); return (a ^ (a >>> 16)) >>> 0; };
const merge = (a, b) => { const r = Object.assign({}, a); for (const k in b) r[k] = b[k]; return r; };

// aura for the twin sisters: a soft additive column, alpha untouched (keepAlpha)
function auraMesh(col) {
  const g = new THREE.CylinderGeometry(0.55, 0.75, 2.1, 24, 1, true); g.translate(0, 1.05, 0);
  const m = new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Color(col[0], col[1], col[2]) }, uT: { value: 0 } },
    vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 uCol; uniform float uT; varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(abs(dot(vN, vV)), 2.5); float a = pow(1. - vUv.y, 2.2) * (0.6 + 0.4 * sin(uT * 3. + vUv.x * 37.7 + vUv.y * 9.)) * f * 0.55; gl_FragColor = vec4(uCol * a, a); }',
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  m.userData.additive = true; m.userData.premul = true; keepAlpha(m);
  const mesh = new THREE.Mesh(g, m); mesh.renderOrder = 6; mesh.castShadow = false; mesh.receiveShadow = false;
  return mesh;
}

const HURT_ARMS = { spine: [0.24, 0, 0.04], chest: [0.12, 0, 0], neck: [0.1, 0, 0], head: [0.12, 0, 0.05], lUp: [-0.55, 0, 0.06], lFore: [-1.65, 0.7, 0], lHand: [0.3, 0, 0] };
const BASKET_ARM = { lUp: [0.0, 0, 0.13], lFore: [-0.12, 0.2, 0], lHand: [0, 0, 0] };
const BAT_CARRY = { rUp: [0.04, 0, -0.12], rFore: [-0.5, 0, 0], rHand: [0.6, 0, 0] };
const HAMMER_CARRY = { rUp: [-0.3, 0, -0.22], rFore: [-2.05, 0, 0], rHand: [1.05, 0, 0] };
const CRATE_ARMS = { lUp: [-0.62, 0, 0.12], lFore: [-0.95, -0.35, 0], lHand: [0, 0, 0.2], rUp: [-0.62, 0, -0.12], rFore: [-0.95, 0.35, 0], rHand: [0, 0, -0.2], spine: [-0.06, 0, 0], chest: [-0.04, 0, 0] };

class Person {
  constructor(sys, seed, kind, pos, opts) {
    opts = opts || {};
    this.sys = sys; this.seed = seed >>> 0; this.kind = kind; this.opts = opts; this.zombie = kind !== null && kind !== undefined;
    let role = 'customer';
    if (opts.role === 'staff') role = opts.hired === false ? 'candidate' : 'staff';
    else if (opts.role === 'survivor' || opts.role === 'scavenger' || opts.role === 'merchant' || opts.role === 'crew' || opts.role === 'helper') role = opts.role;
    this.role = role;
    const def = this.def = this.zombie ? zombieDef(this.seed, kind) : humanDef(this.seed, role);
    const proto = this.proto = sys.proto(def);
    const f = this.fig = makePuppet(proto);
    for (const b of def.hidden) f.hideB[proto.rig.names[b]] = 1;
    // missing forearms (Rust: 22% left, 30% right; Base and Tumour only)
    if (this.zombie && (def.kind === 'Base' || def.kind === 'Tumour') && !opts.cine) { const h = mix32(this.seed * 3 + 11) % 100; if (h < 22) f.hideB[proto.rig.names.lFore] = 1; else if (h >= 60 && h < 90) f.hideB[proto.rig.names.rFore] = 1; }
    // style: shared base + per-person overrides (carry pose, arm swing, post hook)
    const base = this.zombie ? zombieInstanceStyle(this.seed, def.kind, !!def.big) : def.style;
    this.baseStyle = base; this.st = Object.create(base); this.st.post = (an, dt) => this.post(an, dt);
    this.carryCache = new Map();
    const an = this.an = new HumanAnim(f, this.st);
    { const hh = mix32(this.seed + 77); an.t = (hh % 1000) * 0.37; an.ph = ((hh >>> 10) % 628) / 100; }
    this.scale = (opts.scale !== undefined && this.zombie ? opts.scale * 1.78 / 1.81 : def.scale) * (this.zombie && def.kind === 'Base' ? 0.96 + (mix32(this.seed) % 9) * 0.01 : 1);
    const m = this.mesh = f.mesh; m.scale.setScalar(this.scale); m.position.set(pos.x, pos.y, pos.z); m.rotation.y = Math.PI;
    m.matrixAutoUpdate = true; m.frustumCulled = true;
    if (def.aura) { this.aura = auraMesh(def.aura); m.add(this.aura); }
    sys.scene.add(m);
    this.desc = null; this.px = pos.x; this.pz = pos.z; this.py = pos.y; this.spd = 0; this.yaw = 0; this.lead = 0; this.first = true;
    this.acc = 0; this.slot = sys.slotN++; this.fu = undefined; this.forced = null; this.rec = null;
    this.prevWind = 0; this.prevStag = 0; this.prevSwing = 0; this.prevAct = 0; this.prevSpecial = 0; this.flash = 0; this.t = 0; this.dead = false;
    this.ov = {};
    f.solve(); f.skin();
  }
  update(desc) { this.desc = desc; }
  despawn() { if (this.dead) return; this.dead = true; this.sys.remove(this); this.sys.scene.remove(this.mesh); this.fig.dispose(); if (this.aura) { this.aura.geometry.dispose(); this.aura.material.dispose(); } }

  carry(key, extra) { // cached merged carry pose
    let c = this.carryCache.get(key);
    if (!c) { c = extra ? merge(this.baseStyle.carry, extra) : this.baseStyle.carry; this.carryCache.set(key, c); }
    return c;
  }
  force(name, u) { const c = this.baseStyle.clips[name]; if (!c) return; this.an.act = c; this.fu = clamp(u, 0, 0.9999); this.forced = name; }
  release() { if (this.forced) { this.an.act = null; this.forced = null; } this.fu = undefined; }
  hide(bone, h) { this.fig.hideB[this.proto.rig.names[bone]] = h ? 1 : 0; }

  // place the mesh from desc and measure speed (every frame, cheap)
  place(dt) {
    const d = this.desc; if (!d) return;
    if (d.ragdoll) return;
    let p = d.foot || d.pos, y = p.y;
    if (!d.foot && !this.zombie && d.moving) y -= d.bob !== undefined ? d.bob : Math.abs(Math.sin((d.phase || 0) * 2)) * 0.03;
    if (this.zombie && d.fall) y -= d.fall * 0.1;
    const dx = p.x - this.px, dz = p.z - this.pz, dist = Math.hypot(dx, dz);
    let v = 0;
    if (this.first || dist > 3) { this.first = false; this.spd = 0; }
    else if (dt > 0) {
      const yaw = d.yaw || 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      v = dist / dt; if (dx * fx + dz * fz < -0.3 * dist) v = -v;
    }
    if (d.moving === false && Math.abs(v) < 0.25) v = 0;
    this.spd = lerp(this.spd, v, 1 - Math.exp(-dt * 10));
    if (Math.abs(this.spd) < 0.03) this.spd = 0;
    this.px = p.x; this.pz = p.z; this.py = y;
    const m = this.mesh; m.position.set(p.x, y, p.z);
    const yaw = d.yaw !== undefined ? d.yaw : this.yaw, rate = dt > 0 ? angDiff(this.yaw, yaw) / dt : 0;
    this.yaw = yaw; m.rotation.y = yaw + Math.PI;
    this.lead = lerp(this.lead, clamp(rate * 0.1, -0.6, 0.6), 1 - Math.exp(-dt * 8));
    if (d.visible !== undefined) m.visible = !!d.visible;
  }

  // drive the animator from desc (at the LOD rate)
  step(dt, ik) {
    const d = this.desc, an = this.an, f = this.fig;
    this.t += dt;
    if (d && d.ragdoll) { this.ragdoll(d); return; }
    const spd = this.spd / this.scale;
    an.lead = this.lead; an.ikOn = ik; an.xf = { x: this.mesh.position.x, z: this.mesh.position.z, f: this.mesh.rotation.y, s: this.scale };
    let combat = false;
    this.ov = {};
    if (d) combat = this.zombie ? this.driveZombie(d, dt) : this.driveHuman(d, dt);
    // timed recover of a forced clip (boss acts end on their hit frame)
    if (this.rec) { this.rec.u += this.rec.rate * dt; if (this.rec.u >= 1) { this.rec = null; this.release(); } else this.force(this.rec.name, this.rec.u); }
    if (this.flash > 0.002) { this.flash *= Math.exp(-dt * 9); f.u.uFlash.value.setRGB(0.3 * this.flash, 0.22 * this.flash, 0.16 * this.flash); } else f.u.uFlash.value.setRGB(0, 0, 0);
    if (this.def.glowPulse) f.u.uGlow.value = 0.75 + 0.35 * Math.sin(this.t * (this.ov.fastPulse ? 11 : 3.2) + (this.seed % 7));
    if (this.aura) this.aura.material.uniforms.uT.value = this.t;
    an.update(dt, spd, combat, this.fu);
  }

  driveHuman(d, dt) {
    const st = this.st, cine = this.opts.cine;
    let carry = 'base', combat = false;
    if (cine) {
      const act = d.act_name || '';
      this.hide('lanB', act !== 'CARRY');
      if (act === 'COLLAPSE' || act === 'RISE') { this.force('collapse', 0.07 + 0.77 * clamp(d.fall || 0, 0, 1)); }
      else this.release();
      if (act === 'CARRY') carry = 'crate';
      if (act === 'READY') combat = true;
      if (act === 'CHEER') this.ov.cheer = 1;
      if (act === 'LISTEN') this.ov.listen = 1;
      if (this.role === 'survivor') carry = carry === 'crate' ? 'crate' : 'bat';
    } else if (this.role === 'crew') {
      carry = 'hammer';
      const sw = d.swing || 0;
      if (sw > this.prevSwing + 0.05) this.an.play('hammer', 0.22, 0.4);
      this.prevSwing = sw;
    } else if (this.role === 'staff' || this.role === 'candidate') {
      const sec = d.job === 3 && this.role === 'staff';
      this.hide('wR', !sec);
      if (sec) carry = 'bat';
      const sw = d.swing || 0;
      if (sw > this.prevSwing + 0.05) { if (sec) this.an.play('swing', 0.1, 0.4); else this.an.play('pay', 0.25, 0.35); }
      this.prevSwing = sw;
      if (sec && !d.moving && Math.abs(this.spd) < 0.3) combat = true;
    } else {
      const pay = d.pay !== undefined ? d.pay : clamp((d.pay_t || 0) / 0.9, 0, 1);
      const reach = d.reach !== undefined ? d.reach : d.state === 'Look' && (d.timer || 0) < 0.55;
      const hurt = d.hurt || d.goal === 'Medical';
      const basket = !!(d.basket || d.carrying);
      this.hide('lan', !basket);
      if (pay > 0) this.force('pay', 0.07 + 0.93 * (1 - pay));
      else if (reach) this.force('reach', 0.07 + 0.93 * clamp(1 - (d.timer || 0) / 0.55, 0, 1));
      else this.release();
      if (d.state === 'Look' && !reach) this.ov.browse = 1;
      if (hurt) { this.ov.limp = 1; carry = basket ? 'hurtB' : 'hurt'; }
      else if (basket) carry = 'basket';
    }
    st.carry = carry === 'base' ? this.baseStyle.carry : carry === 'basket' ? this.carry('basket', BASKET_ARM) : carry === 'hurt' ? this.carry('hurt', HURT_ARMS) : carry === 'hurtB' ? this.carry('hurtB', merge(HURT_ARMS, { rUp: [0.0, 0, -0.13], rFore: [-0.12, 0, 0] })) : carry === 'bat' ? this.carry('bat', BAT_CARRY) : carry === 'hammer' ? this.carry('hammer', HAMMER_CARRY) : this.carry('crate', CRATE_ARMS);
    st.swingL = carry === 'basket' || carry === 'hurt' || carry === 'hurtB' || carry === 'crate' ? 0.12 : this.baseStyle.swingL;
    st.swingR = carry === 'crate' || carry === 'hammer' ? 0.05 : carry === 'bat' ? 0.4 : this.baseStyle.swingR;
    return combat;
  }

  driveZombie(d, dt) {
    const k = this.def.kind, st = this.st;
    const fall = d.fall !== undefined ? d.fall : clamp((d.dying || 0) / 0.55, 0, 1);
    const act = d.act || 0, actT = d.act_t || 0;
    if (this.opts.cine) {
      const an = d.act_name || '';
      if (an === 'COLLAPSE' || an === 'RISE') this.force('die', 0.07 + 0.77 * clamp(d.fall || 0, 0, 1));
      else if (an === 'ROAR') { this.force('roar', 0.07 + 0.77 * clamp((d.k || 0) * 3, 0, 1)); this.ov.shake = 1; }
      else this.release();
      return false;
    }
    if (this.role === 'helper') { // Stompy: friendly chained hulk; lean -1.45 = knocked out lying; swing = claw swipe countdown
      if (d.show !== undefined) this.mesh.visible = !!d.show;
      if ((d.lean || 0) < -0.5) { this.force('die', 0.84); return false; }
      if (this.forced) this.release();
      const sw = d.swing || 0; if (sw > this.prevSwing + 0.05) this.an.play('smash', 0.2, 0.5); this.prevSwing = sw;
      return false;
    }
    if ((d.dying || 0) > 0 || fall > 0) { this.rec = null; this.force('die', 0.07 + 0.77 * fall); return false; }
    // boss acts
    if (k === 'Brute' && (act === 1 || act === 2)) {
      const dur = act === 1 ? 2.0 : 2.33, name = act === 1 ? 'slam' : 'throw', hit = this.baseStyle.clips[name].hit;
      this.rec = null; this.force(name, hit * clamp(1 - actT / dur, 0, 1)); this.prevAct = act; this.ov.roarShake = act === 1 && actT < 0.5 ? 1 : 0;
    } else if (k === 'Brute' && this.prevAct) {
      const name = this.prevAct === 1 ? 'slam' : 'throw'; this.rec = { name, u: this.baseStyle.clips[name].hit, rate: (1 - this.baseStyle.clips[name].hit) / 1.0 }; this.prevAct = 0;
    } else if (k === 'Sweaty' && (d.air || 0) > 0) {
      this.force('jump', 0.02 + 0.97 * clamp((5 - d.air) / 5, 0, 1));
    } else if (!this.rec && this.forced) this.release();
    if (k === 'Birther') { const sp = d.special || 0; if (sp > this.prevSpecial + 5 && this.prevSpecial > 0) this.an.play('roar', 0.45, 1.3); this.prevSpecial = sp; }
    // claw / smash wind-up: wind 0.5 -> 0, hit at 0
    const w = d.wind || 0;
    if (w > 0 && this.prevWind <= 0 && !this.forced) this.an.play(this.def.big ? 'smash' : 'attack', Math.max(0.15, w), this.def.big ? 0.6 : 0.42);
    this.prevWind = w;
    // stagger on a hit
    const sg = d.stagger || 0;
    if (sg > 0 && this.prevStag <= 0) { this.an.stag = Math.min(1.15, (this.an.stag || 0) + (this.def.big ? 0.55 : 0.95)); this.an.stagDir = this.an.stagDir > 0 ? -1 : 1; this.flash = 1; }
    if (d.hp !== undefined && this.prevHp !== undefined && d.hp < this.prevHp - 0.5) this.flash = Math.max(this.flash, 0.7);
    this.prevHp = d.hp; this.prevStag = sg;
    if (k === 'Tumour' && d.hp !== undefined && d.hp_max) this.ov.fastPulse = d.hp < d.hp_max * 0.5 ? 1 : 0;
    this.ov.chase = d.chasing ? 1 : 0;
    st.swingL = this.baseStyle.swingL; st.swingR = this.baseStyle.swingR;
    return false;
  }

  // additive layers on top of HumanAnim's pose (runs inside HumanAnim.update, before the solve)
  post(an, dt) {
    const E = an.f.euler, Tr = an.f.trans, ix = an.ix, t = an.t, mw = an.moveW, o = this.ov, s = Math.sin(an.ph), c = Math.cos(an.ph);
    const busy = !!an.act;
    if (this.zombie) {
      if (this.forced === 'die') return;
      const gid = this.baseStyle.gaitId || 0, k = this.def.kind;
      if ((k === 'Base' || k === 'Tumour') && mw > 0.01 && !busy) {
        if (gid === 0) { E[ix.lShin] *= 0.75; E[ix.rShin] *= 0.75; E[ix.lFoot] *= 0.5; E[ix.rFoot] *= 0.5; }
        else if (gid === 1) { E[ix.lThigh] = lerp(E[ix.lThigh], E[ix.lThigh] * 0.4, mw); Tr[ix.hips + 1] -= 0.035 * Math.max(0, -s) * mw; E[ix.spine + 2] += 0.08 * s * mw; E[ix.head + 2] -= 0.06 * s * mw; }
        else if (gid === 2) { E[ix.rThigh] = lerp(E[ix.rThigh], 0.22, mw); E[ix.rShin] = lerp(E[ix.rShin], 0.3, mw); E[ix.rFoot] = lerp(E[ix.rFoot], 0.6, mw); E[ix.spine + 2] -= 0.1 * mw; E[ix.hips + 2] += 0.06 * mw; Tr[ix.hips + 1] -= 0.04 * mw; }
        else { E[ix.spine] += 0.18 * mw; E[ix.neck] -= 0.05 * mw; }
      }
      // arms: slow uneven reach, head twitches, harder lean when chasing
      if (!busy) {
        const ph = this.seed % 17;
        E[ix.lUp] += 0.07 * Math.sin(t * 1.9 + ph) * (1 - 0.5 * mw); E[ix.rUp] += 0.07 * Math.sin(t * 2.3 + ph * 1.3) * (1 - 0.5 * mw);
        E[ix.lFore] += 0.08 * Math.sin(t * 2.7 + ph); E[ix.rFore] += 0.08 * Math.sin(t * 3.1 + ph);
        const tw = Math.pow(Math.max(0, Math.sin(t * 0.9 + ph)), 18); E[ix.head + 1] += 0.35 * tw * Math.sin(t * 25); E[ix.head + 2] += 0.07 * Math.sin(t * 0.7 + ph);
        if (o.chase) { E[ix.spine] += 0.12 * mw; E[ix.chest] += 0.06 * mw; E[ix.head] -= 0.12 * mw; }
      }
      if (o.shake || o.roarShake) { E[ix.chest + 1] += 0.06 * Math.sin(t * 31); E[ix.head + 1] += 0.08 * Math.sin(t * 27); }
      return;
    }
    if (o.browse && !busy) { E[ix.head + 1] += 0.32 * Math.sin(t * 0.55 + this.seed) * (1 - mw); E[ix.head] += 0.05 * (1 - mw); E[ix.chest] += 0.04; E[ix.chest + 1] += 0.1 * Math.sin(t * 0.55 + this.seed); }
    if (o.limp && mw > 0.01) { E[ix.rShin] *= 0.35; E[ix.rFoot] *= 0.4; Tr[ix.hips + 1] -= 0.035 * Math.max(0, s) * mw; E[ix.spine + 2] -= 0.08 * s * mw; E[ix.lUp] *= 0.5; }
    if (o.cheer) { E[ix.rUp] = -2.85 + 0.22 * Math.sin(t * 9); E[ix.rUp + 1] = 0; E[ix.rUp + 2] = -0.35; E[ix.rFore] = -0.45; E[ix.rHand] = 0; E[ix.head] -= 0.15; }
    if (o.listen) { E[ix.rUp] = -0.35; E[ix.rUp + 2] = -0.75; E[ix.rFore] = -2.35; E[ix.rFore + 1] = -0.4; E[ix.head] += 0.12; E[ix.head + 2] -= 0.18; E[ix.spine] += 0.12; }
  }

  // carried corpse (carry.js): pose every bone from the 15 particles, world space
  ragdoll(d) {
    const P = d.particles; if (!P || P.length < 15) return;
    const f = this.fig, rig = f.rig, H = rig.head, n = rig.names, s = d.scale || this.scale, m = this.mesh;
    m.position.set(0, 0, 0); m.rotation.set(0, 0, 0); m.scale.setScalar(1);
    const v = (i) => [P[i].x, P[i].y, P[i].z], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }, cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const pel = v(0), che = v(1), hd = v(2);
    const U = nrm(sub(che, pel)); let S = nrm(sub(v(3), v(4))); const F = nrm(cr(S, U)); S = cr(U, F);
    const fr = this.free || (this.free = Array.from({ length: rig.n }, () => ({ R: new Array(9), p: [0, 0, 0] })));
    const setR = (i, x, y, z) => { const R = fr[i].R; R[0] = x[0] * s; R[3] = x[1] * s; R[6] = x[2] * s; R[1] = y[0] * s; R[4] = y[1] * s; R[7] = y[2] * s; R[2] = z[0] * s; R[5] = z[1] * s; R[8] = z[2] * s; };
    const place = (i, par) => { const R = fr[par].R, a = i * 3, b = par * 3, dx = H[a] - H[b], dy = H[a + 1] - H[b + 1], dz = H[a + 2] - H[b + 2]; const p = fr[par].p; fr[i].p[0] = p[0] + R[0] * dx + R[1] * dy + R[2] * dz; fr[i].p[1] = p[1] + R[3] * dx + R[4] * dy + R[5] * dz; fr[i].p[2] = p[2] + R[6] * dx + R[7] * dy + R[8] * dz; };
    const copyR = (i, j) => { for (let k = 0; k < 9; k++) fr[i].R[k] = fr[j].R[k]; };
    setR(n.hips, S, U, F); fr[n.hips].p = pel.slice();
    copyR(n.root, n.hips); { const R = fr[n.root].R, hy = H[n.hips * 3 + 1]; fr[n.root].p = [pel[0] - R[1] * hy, pel[1] - R[4] * hy, pel[2] - R[7] * hy]; }
    for (const b of ['spine', 'chest']) { copyR(n[b], n.hips); place(n[b], rig.parent[n[b]]); }
    const U2 = nrm(sub(hd, che)); const F2 = nrm(cr(S, U2)), S2 = cr(U2, F2);
    for (const b of ['neck', 'head']) { setR(n[b], S2, U2, F2); place(n[b], rig.parent[n[b]]); }
    const tmp = new Array(9);
    const limb = (b, par, from, to) => { // orientation of the parent, turned so the bone points from -> to
      const i = n[b], c = rig.parent[i] >= 0 ? rig.parent[i] : n[par], ch = n[b === 'lUp' ? 'lFore' : b === 'rUp' ? 'rFore' : b === 'lFore' ? 'lHand' : b === 'rFore' ? 'rHand' : b === 'lThigh' ? 'lShin' : b === 'rThigh' ? 'rShin' : b === 'lShin' ? 'lFoot' : 'rFoot'];
      const R = fr[c].R; let rx = H[ch * 3] - H[i * 3], ry = H[ch * 3 + 1] - H[i * 3 + 1], rz = H[ch * 3 + 2] - H[i * 3 + 2];
      const ux = R[0] * rx + R[1] * ry + R[2] * rz, uy = R[3] * rx + R[4] * ry + R[5] * rz, uz = R[6] * rx + R[7] * ry + R[8] * rz, ul = Math.hypot(ux, uy, uz) || 1;
      const t = nrm(sub(to, from));
      for (let k = 0; k < 9; k++) tmp[k] = R[k];
      rotUV(ux / ul, uy / ul, uz / ul, t[0], t[1], t[2], tmp, 0, fr[i].R);
      if (from) place(i, c);
    };
    limb('lUp', 'chest', v(3), v(5)); limb('lFore', 'lUp', v(5), v(7)); copyR(n.lHand, n.lFore); place(n.lHand, n.lFore);
    limb('rUp', 'chest', v(4), v(6)); limb('rFore', 'rUp', v(6), v(8)); copyR(n.rHand, n.rFore); place(n.rHand, n.rFore);
    limb('lThigh', 'hips', v(9), v(11)); limb('lShin', 'lThigh', v(11), v(13)); copyR(n.lFoot, n.lShin); place(n.lFoot, n.lShin);
    limb('rThigh', 'hips', v(10), v(12)); limb('rShin', 'rThigh', v(12), v(14)); copyR(n.rFoot, n.rShin); place(n.rFoot, n.rShin);
    for (let i = 0; i < rig.n; i++) { const nm = Object.keys(n).find((k) => n[k] === i); if (['root', 'hips', 'spine', 'chest', 'neck', 'head', 'lUp', 'lFore', 'lHand', 'rUp', 'rFore', 'rHand', 'lThigh', 'lShin', 'lFoot', 'rThigh', 'rShin', 'rFoot'].includes(nm)) continue; copyR(i, rig.parent[i]); place(i, rig.parent[i]); }
    f.free = fr; f.solve(); f.free = null; f.skin();
  }
}

export function createPeople(G) {
  const sys = {
    scene: G.scene, slotN: 0, protos: new Map(), list: [], frame: 0,
    proto(def) { let p = this.protos.get(def.key); if (!p) { p = makeProto(def); this.protos.set(def.key, p); } return p; },
    remove(p) { const i = this.list.indexOf(p); if (i >= 0) this.list.splice(i, 1); },
  };
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), sph = new THREE.Sphere(), camP = new THREE.Vector3();
  const stats = { ms: 0, animated: 0, ik: 0, culled: 0 };
  return {
    spawn(seed, kind, pos, opts) { const p = new Person(sys, seed, kind === undefined ? null : kind, pos, opts); sys.list.push(p); return p; },
    update(dt) {
      const t0 = performance.now();
      sys.frame++;
      const cam = G.camera; cam.updateMatrixWorld(); pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); frustum.setFromProjectionMatrix(pv); camP.setFromMatrixPosition(cam.matrixWorld);
      let animated = 0, ikN = 0, culled = 0;
      // nearest first so the per-frame budget goes to what is seen up close
      const L = sys.list;
      for (const p of L) { p.place(dt); p.dist = p.mesh.position.distanceTo(camP); }
      const order = L.slice().sort((a, b) => a.dist - b.dist);
      for (const p of order) {
        const s = p.scale; sph.center.set(p.mesh.position.x, p.mesh.position.y + 0.9 * s, p.mesh.position.z); sph.radius = 1.3 * s;
        const vis = p.mesh.visible && frustum.intersectsSphere(sph);
        let rate = 1;
        if (!vis) { rate = p.dist < 6 ? 2 : 8; culled++; }
        else if (p.dist > 45) rate = 4;
        else if (p.dist > 22 || animated > 40) rate = 2;
        p.acc += dt;
        if (p.desc && p.desc.ragdoll) { p.step(p.acc, false); p.acc = 0; continue; }
        if (rate === 1 || (sys.frame + p.slot) % rate === 0) {
          const ik = vis && !p.zombie && p.dist < 16 && !p.opts.cine;
          if (ik) ikN++;
          p.step(Math.min(p.acc, 0.25), ik); p.acc = 0; animated++;
        }
        p.mesh.castShadow = p.dist < 38 * Math.max(1, s * 0.8);
      }
      stats.ms = performance.now() - t0; stats.animated = animated; stats.ik = ikN; stats.culled = culled;
    },
    count() { return sys.list.length; },
    // static fallen corpse as a real figure (kind 0 Base, 1 Tumour, 2 Hulk); caller owns it: scene.add, then .userData.dispose()
    corpseFigure(seed, kind) {
      const zk = ['Base', 'Tumour', 'Hulk'][Math.min(2, Math.max(0, kind | 0))], def = zombieDef(seed >>> 0, zk), proto = sys.proto(def);
      const f = makePuppet(proto), st = zombieInstanceStyle(seed >>> 0, def.kind, !!def.big), an = new HumanAnim(f, st);
      an.t = (seed % 1000) * 0.37; an.act = st.clips.die; an.update(0, 0, false, 0.84);
      f.mesh.scale.setScalar(def.scale * (zk === 'Base' ? 0.96 + (mix32(seed >>> 0) % 9) * 0.01 : 1));
      f.mesh.userData.dispose = () => f.dispose();
      return f.mesh;
    },
    // models.js hook: the body is not baked into the prop mesh (use corpseFigure); returns the body scale for the blood pool
    corpse(mb, seed, kind) { return (kind | 0) >= 2 ? 1.5 : 1.0; },
    stats() { let tris = 0; for (const p of sys.list) tris += p.proto.tris; return Object.assign({ count: sys.list.length, protos: sys.protos.size, tris }, stats); },
    prewarm(list) { for (const [seed, kind, opts] of list) sys.proto(kind ? zombieDef(seed >>> 0, kind) : humanDef(seed >>> 0, (opts && opts.role) || 'customer')); },
    list: () => sys.list.slice(),
  };
}
