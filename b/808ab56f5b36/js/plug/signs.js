// Plug-in "signs": the two roof signs of the original game (PARITY N01 / N05). A tall "SHOP" in chunky block letters stands
// on the shop roof and a red "HOSPITAL" on the roof of the block to its right (op/02, ow/street_1200, ow/street_1900).
// By day the letters are painted navy blue and brick red; from dusk to dawn they light up as neon, the SHOP letters cyan
// with a violet halo (c01 1:35:20), HOSPITAL red. At 05:30-05:50 both are unlit (op/02, op/02b). View only: no colliders,
// the letters stand on the roofs out of reach. ?noplug=signs removes them.
import * as THREE from '../../vendor/three.module.min.js';
import { mat, keepAlpha } from '../mats.js';

// Letter outlines on a 5 x 7 cell (x right, y up), stroke 1.7: one outer polygon and optional holes.
const GL = {
  S: { w: 5, o: [[0, 0], [4, 0], [5, 1], [5, 3.4], [4, 4.3], [1.7, 4.3], [1.7, 5.5], [5, 5.5], [5, 7], [1, 7], [0, 6], [0, 3.6], [1, 2.7], [3.3, 2.7], [3.3, 1.5], [0, 1.5]] },
  H: { w: 5, o: [[0, 0], [1.7, 0], [1.7, 2.7], [3.3, 2.7], [3.3, 0], [5, 0], [5, 7], [3.3, 7], [3.3, 4.3], [1.7, 4.3], [1.7, 7], [0, 7]] },
  O: { w: 5, o: [[1, 0], [4, 0], [5, 1], [5, 6], [4, 7], [1, 7], [0, 6], [0, 1]], h: [[1.7, 1.6], [3.3, 1.6], [3.3, 5.4], [1.7, 5.4]] },
  P: { w: 5, o: [[0, 0], [1.7, 0], [1.7, 2.6], [4, 2.6], [5, 3.6], [5, 6], [4, 7], [0, 7]], h: [[1.7, 4.0], [3.3, 4.0], [3.3, 5.6], [1.7, 5.6]] },
  I: { w: 1.7, o: [[0, 0], [1.7, 0], [1.7, 7], [0, 7]] },
  T: { w: 5, o: [[1.65, 0], [3.35, 0], [3.35, 5.4], [5, 5.4], [5, 7], [0, 7], [0, 5.4], [1.65, 5.4]] },
  A: { w: 5, o: [[0, 0], [1.7, 0], [1.7, 2.2], [3.3, 2.2], [3.3, 0], [5, 0], [5, 5.5], [3.8, 7], [1.2, 7], [0, 5.5]], h: [[1.7, 3.6], [3.3, 3.6], [3.3, 5.2], [2.9, 5.6], [2.1, 5.6], [1.7, 5.2]] },
  L: { w: 4.2, o: [[0, 0], [4.2, 0], [4.2, 1.6], [1.7, 1.6], [1.7, 7], [0, 7]] },
};
const GAP = 0.6;

function wordGeo(word, unit, depth) {
  const parts = [];
  let x = 0;
  for (const ch of word) {
    const g = GL[ch];
    const sh = new THREE.Shape(g.o.map(([a, b]) => new THREE.Vector2((a + x) * unit, b * unit)));
    if (g.h) sh.holes.push(new THREE.Path(g.h.map(([a, b]) => new THREE.Vector2((a + x) * unit, b * unit)).reverse()));
    const geo = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: unit * 0.12, bevelSize: unit * 0.1, bevelSegments: 1, curveSegments: 1 });
    parts.push(geo);
    x += g.w + GAP;
  }
  const width = (x - GAP) * unit;
  // merge by hand (no BufferGeometryUtils in vendor): all ExtrudeGeometry parts are non-indexed with the same attributes
  const n = parts.reduce((s, p) => s + p.attributes.position.count, 0);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const p of parts) {
    const g = p.index ? p.toNonIndexed() : p;
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count; p.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.translate(-width / 2, 0, -depth / 2);
  geo.computeBoundingSphere();
  return { geo, width };
}

function haloTex() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 2, 64, 64, 63);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.5)'); gr.addColorStop(0.75, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// lit 0..1 by the clock: off 05:00-18:20, fades in 18:20-19:00, fades out 04:20-05:00
export function neonLevel(hour) {
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  return Math.max(ss(18.33, 19.0, hour), 1 - ss(4.33, 5.0, hour));
}

export async function install(G) {
  const signs = [
    // SHOP: centred over the door, standing on the roof slab just behind the front parapet; letters 1.5 m tall
    { word: 'SHOP', unit: 0.21, depth: 0.32, pos: [0, 3.5, 4.55], day: 0x1d2850, neon: [0.03, 0.5, 2.6], halo: 0x7040ff, haloK: 1.4 },
    // HOSPITAL: on the roof of the block east of the shop (the original shows it to the right of SHOP from the street)
    { word: 'HOSPITAL', unit: 0.2, depth: 0.3, pos: [15.0, 3.45, 2.55], day: 0x4e1d1b, neon: [1.3, 0.1, 0.07], halo: 0xff2a18, haloK: 0.4 },
  ];
  const hal = haloTex();
  const out = [];
  for (const s of signs) {
    const { geo, width } = wordGeo(s.word, s.unit, s.depth);
    const m = mat({ surf: 'paintedMetal', rough: 0.55, metal: 0.1, color: s.day, emissive: 0x000000, emissiveIntensity: 1, sign: s.word });
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(s.pos[0], s.pos[1], s.pos[2]);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'sign_' + s.word.toLowerCase();
    G.scene.add(mesh);
    // soft additive halo behind the letters (bloom alone leaves the neon without its violet glow)
    const hm = new THREE.MeshBasicMaterial({ map: hal, color: s.halo, transparent: true, depthWrite: false, opacity: 0, fog: false });
    hm.userData.additive = true; keepAlpha(hm);
    const h = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.6, 7 * s.unit * 3.2), hm);
    h.position.set(s.pos[0], s.pos[1] + 3.5 * s.unit, s.pos[2] - s.depth * 0.5 - 0.05); h.renderOrder = 2; h.frustumCulled = true;
    G.scene.add(h);
    const mx = Math.max(...s.neon); out.push({ s, m, hm, mesh, h, tube: new THREE.Color(s.neon[0] / mx, s.neon[1] / mx, s.neon[2] / mx) });
  }
  const dayCol = new THREE.Color();
  G.updaters.push(['signs', () => {
    const hour = G.ctx.hour_view != null ? G.ctx.hour_view : G.g.hour();
    const k = neonLevel(hour);
    for (const o of out) {
      o.m.emissive.setRGB(o.s.neon[0] * k, o.s.neon[1] * k, o.s.neon[2] * k);
      // lit tubes wash the paint toward the tube colour
      dayCol.set(o.s.day); o.m.color.copy(dayCol).lerp(o.tube, 0.85 * k);
      o.hm.opacity = o.s.haloK * k; o.h.visible = k > 0.01;
    }
  }]);
  G.signsPlug = out;
  return out;
}
