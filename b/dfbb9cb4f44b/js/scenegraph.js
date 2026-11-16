// Scene facade implementation: turns the rules layer's MB meshes ({p,n,uv,c,i}, uv.x = pattern code, uv.y = emissive)
// into three.js meshes. Each pattern code gets its own baked PBR material (triplanar, wetness: Saltline's material
// model via mats.js), vertex colours tint it. Blend meshes (particles, glows, glass) use one HDR unlit material.
import * as THREE from '../vendor/three.module.min.js';
import { mat, U, noMask, keepAlpha } from './mats.js';

// pattern code (geom.js) -> material options
const PAT = {
  0: { surf: 'flat', scale: 0.9, rough: 1, metal: 0, macro: 0.08, grime: 0.12 },
  1: { surf: 'wood', scale: 0.55, macro: 0.2 },
  2: { surf: 'concrete', scale: 0.32, macro: 0.3, puddles: false },
  3: { surf: 'asphalt', scale: 0.3, macro: 0.3 },
  4: { surf: 'brick', scale: 0.5, macro: 0.25 },
  5: { surf: 'corrugated', scale: 0.5, macro: 0.2 },
  6: { surf: 'dirt', scale: 0.3, macro: 0.35 },
  7: { surf: 'plasterBlock', scale: 0.4, macro: 0.18 },
  8: { surf: 'cardboard', scale: 1.2, macro: 0.1, grime: 0.1 },
  11: { surf: 'flat', scale: 0.9, rough: 1, metal: 0, macro: 0.05, grime: 0.05 },
  13: { surf: 'paintedMetal', scale: 0.8, macro: 0.15 },
  14: { surf: 'steel', scale: 0.9, macro: 0.15 },
};
const SKY = 9, GLASS = 10, UNLIT = 12;
// Plug-in hooks (js/plug/env.js): with both null the picture is exactly the default one.
//   pat: { code: material options } used instead of PAT; filter(node, pat, a, b, c, mesh) -> true drops that triangle.
export const HOOKS = { pat: null, filter: null };
// Material pass of the world-look plug-in: each pattern gets a set sized in metres (scale = 1 / tile), Saltline relief
// (bake.js SURF_ENV k), Saltline's wet response per surface (darken, roughMul, vertWet, bead), dry indoors.
const KC = [0.05, 0.62, 0.65, 0.7], CA = [0.42, 0.38, 0.5, 0];
export const PAT_ENV = {
  0: { surf: 'flat2', scale: 0.9, rough: 1, metal: 0, macro: 0.06, grime: 0.12, dryIn: true },
  1: { surf: 'planks', tint: 2, pshade: 0.55, scale: 0.833, macro: 0.08, grime: 0.15, wetP: [0.4, 0.5, 0.6, 0], dryIn: true },
  2: { surf: 'concrete2', scale: 0.333, macro: 0.14, grime: 0.3, wetP: CA, dryIn: true },
  3: { surf: 'asphalt2', scale: 0.5, macro: 0.14, grime: 0.3, wetP: [0.45, 0.3, 0.5, 0], dryIn: true },
  4: { surf: 'brick2', tint: 1, pshade: 1, scale: 1.111, macro: 0.12, grime: 0.25, wetP: CA, dryIn: true },
  5: { surf: 'corrugated2', tint: 1, pshade: 1, scale: 0.658, macro: 0.12, grime: 0.2, wetP: KC, dryIn: true },
  6: { surf: 'dirt2', scale: 0.3, macro: 0.3, grime: 0.2, wetP: [0.5, 0.5, 0.5, 0], dryIn: true },
  7: { surf: 'block2', tint: 1, pshade: 0.7, scale: 0.625, macro: 0.1, grime: 0.22, wetP: [0.35, 0.6, 0.4, 0], dryIn: true },
  8: { surf: 'cardboard2', scale: 1.0, macro: 0.08, grime: 0.1, wetP: [0.4, 0.75, 0.6, 0], dryIn: true },
  11: { surf: 'flat2', scale: 0.9, rough: 1, metal: 0, macro: 0.05, grime: 0.05, dryIn: true },
  13: { surf: 'awning', tint: 1, pshade: 1, scale: 0.625, macro: 0.08, grime: 0.15, wetP: [0.3, 0.7, 0.6, 0], dryIn: true },
  14: { surf: 'paintChip', tint: 1, pshade: 1, scale: 1.0, macro: 0.1, grime: 0.18, wetP: KC, dryIn: true },
};

let unlitMat = null, glassMat = null, blendMat = null, blendGlass = null;
function unlit() {
  if (unlitMat) return unlitMat;
  // UNLIT in the old shader = colour as is (fogged) ; uv.y > 0 = glowing. Here: HDR emissive so bloom picks it up.
  const m = new THREE.ShaderMaterial({
    vertexShader: 'attribute float emi; varying vec4 vC; varying float vE; void main(){ vC = color; vE = emi; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform float uGlow, uAmb; varying vec4 vC; varying float vE; void main(){ vec3 c = vC.rgb * mix(uAmb, uGlow, step(0.001, vE)) * (1.0 + vE); gl_FragColor = vec4(c, 0.0); }',
    uniforms: { uGlow: U.uGlow, uAmb: U.uAmbK }, vertexColors: true,
  });
  return (unlitMat = m);
}
function blend() {
  if (blendMat) return blendMat;
  const m = new THREE.ShaderMaterial({
    vertexShader: 'attribute float emi; attribute float pat; varying vec4 vC; varying float vE; varying float vP; varying vec3 vN; varying vec3 vV; void main(){ vC = color; vE = emi; vP = pat; vec4 w = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix) * normal); vV = w.xyz - cameraPosition; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float uGlow, uAmb; uniform vec3 uSkyC; varying vec4 vC; varying float vE; varying float vP; varying vec3 vN; varying vec3 vV;
      void main(){
        if (vP > 11.5) { vec3 c = vC.rgb * mix(uAmb, 1.0 + 0.5 * vE, step(0.001, vE)); float a = vC.a * mix(1.0, 0.45, step(0.001, vE)); gl_FragColor = vec4(c * a, a); return; }
        vec3 n = normalize(vN), rd = normalize(vV);
        float fres = 0.06 + 0.9 * pow(1.0 - abs(dot(n, rd)), 5.0);
        vec3 col = vC.rgb * uAmb * 0.6 + uSkyC * fres + vC.rgb * vE * uGlow;
        float a = clamp(vC.a + fres * 0.5, 0.0, 1.0);
        gl_FragColor = vec4(col * a, a);
      }`,
    uniforms: { uGlow: U.uGlow, uAmb: U.uAmbK, uSkyC: U.uSkyC }, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  m.userData.premul = true; keepAlpha(m);
  return (blendMat = m);
}

function solidMat(pat) {
  const o = (HOOKS.pat && HOOKS.pat[pat]) || PAT[pat] || PAT[0];
  return mat(Object.assign({ vcol: true, emi: true, rough: 1, metal: 1 }, o));
}

// Split an MB mesh by pattern code into geometry groups; returns { geo, mats }.
function buildSolid(mesh, node) {
  const filter = HOOKS.filter;
  const nv = mesh.p.length / 3, idx = mesh.i, uv = mesh.uv;
  const byPat = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (a === b || b === c || a === c) continue;
    const p = Math.round(uv[a * 2]);
    if (p === SKY) continue;
    if (filter && filter(node, p, a, b, c, mesh)) continue;
    let arr = byPat.get(p); if (!arr) { arr = []; byPat.set(p, arr); }
    arr.push(a, b, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(mesh.p, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(mesh.n, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(mesh.c, 4));
  const emi = new Float32Array(nv); for (let i = 0; i < nv; i++) emi[i] = uv[i * 2 + 1];
  geo.setAttribute('emi', new THREE.BufferAttribute(emi, 1));
  let total = 0; for (const a of byPat.values()) total += a.length;
  const out = nv > 65535 ? new Uint32Array(total) : new Uint16Array(total);
  const mats = []; let o = 0;
  for (const [p, arr] of byPat) {
    out.set(arr, o); geo.addGroup(o, arr.length, mats.length); o += arr.length;
    mats.push(p === UNLIT ? unlit() : p === GLASS ? glass() : solidMat(p));
  }
  geo.setIndex(new THREE.BufferAttribute(out, 1));
  geo.computeBoundingSphere();
  return { geo, mats, empty: total === 0 };
}
function glass() {
  if (glassMat) return glassMat;
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.32, vertexColors: true, envMapIntensity: 1.2, depthWrite: false });
  noMask(m, '0.0');
  return (glassMat = m);
}
function buildBlend(mesh) {
  const nv = mesh.p.length / 3;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(mesh.p, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(mesh.n, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(mesh.c, 4));
  const emi = new Float32Array(nv), pat = new Float32Array(nv);
  for (let i = 0; i < nv; i++) { pat[i] = mesh.uv[i * 2]; emi[i] = mesh.uv[i * 2 + 1]; }
  geo.setAttribute('emi', new THREE.BufferAttribute(emi, 1));
  geo.setAttribute('pat', new THREE.BufferAttribute(pat, 1));
  geo.setIndex(new THREE.BufferAttribute(mesh.i, 1));
  return geo;
}

class Node {
  constructor(sg, mesh, matName, tr, parent) {
    this.sg = sg; this.matName = matName || 'solid'; this.opts = tr || {};
    this.obj = new THREE.Group(); this.mesh3 = null;
    this.pos = tr && tr.pos ? tr.pos.clone() : sg.V0();
    this.quat = tr && tr.quat ? tr.quat.slice() : [0, 0, 0, 1];
    this.scale = tr && tr.scale !== undefined ? tr.scale : 1;
    this.visible = !(tr && tr.visible === false);
    this.viewmodel = !!(tr && tr.viewmodel) || !!(parent && parent.viewmodel);
    this.dead = false; this.name = (tr && tr.name) || null; this.obj.name = this.name || ''; sg.nodes.add(this);
    (parent ? parent.obj : this.viewmodel ? sg.viewRoot : sg.root).add(this.obj);
    this.apply(); this.set_mesh(mesh);
  }
  apply() {
    const o = this.obj; o.position.set(this.pos.x, this.pos.y, this.pos.z); o.quaternion.set(this.quat[0], this.quat[1], this.quat[2], this.quat[3]);
    const s = this.scale; if (typeof s === 'number') o.scale.setScalar(s); else o.scale.set(s.x, s.y, s.z);
    o.visible = this.visible;
  }
  set_pos(p) { this.pos = p.clone(); this.obj.position.set(p.x, p.y, p.z); }
  set_quat(q) { this.quat = q.slice(); this.obj.quaternion.set(q[0], q[1], q[2], q[3]); }
  set_yaw(a) { this.set_quat([0, Math.sin(a / 2), 0, Math.cos(a / 2)]); }
  set_scale(s) { this.scale = s; if (typeof s === 'number') this.obj.scale.setScalar(s); else this.obj.scale.set(s.x, s.y, s.z); }
  set_visible(v) { this.visible = !!v; this.obj.visible = this.visible; }
  set_tr(t) { if (t.pos) this.set_pos(t.pos); if (t.quat) this.set_quat(t.quat); if (t.scale !== undefined) this.set_scale(t.scale); }
  set_mesh(mesh) {
    this.mesh = mesh;
    if (!mesh || !mesh.p || mesh.p.length === 0) { if (this.mesh3) this.mesh3.visible = false; return; }
    if (this.matName === 'blend') {
      // dynamic meshes keep their size (build_fixed): update in place
      const m3 = this.mesh3;
      if (m3 && m3.geometry.attributes.position.array.length === mesh.p.length && m3.geometry.index.array.length === mesh.i.length) {
        const g = m3.geometry, nv = mesh.p.length / 3;
        g.attributes.position.array.set(mesh.p); g.attributes.position.needsUpdate = true;
        g.attributes.normal.array.set(mesh.n); g.attributes.normal.needsUpdate = true;
        g.attributes.color.array.set(mesh.c); g.attributes.color.needsUpdate = true;
        const e = g.attributes.emi.array, pa = g.attributes.pat.array;
        for (let i = 0; i < nv; i++) { pa[i] = mesh.uv[i * 2]; e[i] = mesh.uv[i * 2 + 1]; }
        g.attributes.emi.needsUpdate = true; g.attributes.pat.needsUpdate = true;
        g.index.array.set(mesh.i); g.index.needsUpdate = true;
        m3.visible = true; return;
      }
      this.drop();
      const geo = buildBlend(mesh);
      const o = new THREE.Mesh(geo, blend()); o.frustumCulled = false; o.renderOrder = 10;
      this.attach(o); return;
    }
    this.drop();
    const { geo, mats, empty } = buildSolid(mesh, this);
    if (empty) { geo.dispose(); return; }
    const o = new THREE.Mesh(geo, mats);
    o.castShadow = !this.viewmodel && this.opts.shadow !== false; o.receiveShadow = true;
    if (this.opts.dynamic || this.opts.no_cull) o.frustumCulled = false;
    this.attach(o);
  }
  attach(o) {
    this.mesh3 = o; this.obj.add(o);
    if (this.viewmodel) { o.layers.set(1); o.frustumCulled = false; }
    this.sg.meshes++;
  }
  drop() { if (this.mesh3) { this.obj.remove(this.mesh3); this.mesh3.geometry.dispose(); this.mesh3 = null; this.sg.meshes--; } }
  child(mesh, matName, tr) { return new Node(this.sg, mesh, matName, tr, this); }
  despawn() { if (this.dead) return; this.dead = true; this.sg.nodes.delete(this); this.obj.traverse((o) => { if (o.isMesh && o.geometry && !o.userData.keepGeo) o.geometry.dispose(); }); if (this.obj.parent) this.obj.parent.remove(this.obj); }
}

export class SceneGraph {
  constructor(G, Vec3) {
    this.G = G; this.V0 = () => new Vec3(); this.meshes = 0; this.nodes = new Set();
    this.root = new THREE.Group(); this.root.name = 'twt-root'; G.scene.add(this.root);
    this.viewRoot = new THREE.Group(); this.viewRoot.name = 'twt-view'; G.scene.add(this.viewRoot);
    this.people = null; // installed by people.js
  }
  spawn(mesh, matName, tr) { return new Node(this, mesh, matName, tr, null); }
  // rebuild every solid mesh (after HOOKS changed)
  rebuildAll() { for (const n of this.nodes) if (!n.dead && n.matName !== 'blend' && n.mesh && n.mesh3) n.set_mesh(n.mesh); }
  byName(name) { const out = []; for (const n of this.nodes) if (n.name === name) out.push(n); return out; }
  // the view root follows the camera (Bevy: viewmodels are children of the camera entity)
  syncView(cam) { this.viewRoot.position.copy(cam.position); this.viewRoot.quaternion.copy(cam.quaternion); this.viewRoot.updateMatrixWorld(true); }
}
