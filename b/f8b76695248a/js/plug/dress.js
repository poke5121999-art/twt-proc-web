// Plug-in "dress": set dressing and prop detail for the street, the blocks across the road, the car-park edge, the shop
// exterior, the shop ceiling and the far backdrop. View only: it adds no colliders (the rules layer owns collision) and
// places solid props only where the player cannot walk through them without it looking wrong (outside the fence, against
// walls, on roofs, overhead, beyond the play bounds) plus flat things anywhere. Method from Saltline (Felix Rieseberg,
// claude.ai artifact BGY1SztrAYcJQHSsnHHGmp), references/saltline/props-level.md: a hand-authored placement table,
// chamfered parts at real sizes, one batch per surface with colour and wear baked into vertex colours.
// ?plug=dress loads it, ?noplug=dress gives the picture without it.
import * as THREE from '../../vendor/three.module.min.js';
import { mat, noMask } from '../mats.js';
import { VKit, chamferBox, lathe, extrude, vnoise3 } from '../kit.js';
import * as P from '../props.js';
import { rng } from '../rng.js';
import * as lay from '../sim/lay.js';
import { Rng } from '../sim/vec.js';
import * as world from '../sim/world.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const PI = Math.PI;
const DZ = lay.STREET_DZ;
const ROAD0 = lay.ROAD_Z0, ROAD1 = lay.ROAD_Z1; // 46, 54
const FAR_WALK = ROAD1 + 4; // building line across the road (58)

// ---------------------------------------------------------------- materials (one per surface, colour in vertices)
const SURF = {
  c: { surf: 'concrete', scale: 0.38 }, e: { surf: 'concrete', scale: 0.38, dressKerb: 1 }, b: { surf: 'brick', scale: 0.5 }, p: { surf: 'plasterBlock', scale: 0.4 },
  r: { surf: 'corrugated', scale: 0.5 }, m: { surf: 'paintedMetal', scale: 0.8 }, s: { surf: 'steel', scale: 1.0 },
  u: { surf: 'rust', scale: 0.8 }, w: { surf: 'wood', scale: 0.7 }, f: { surf: 'fabric', scale: 1.0 }, y: { surf: 'polymer', scale: 0.6 },
  a: { surf: 'asphalt', scale: 0.3 }, l: { surf: 'flat', scale: 0.9, rough: 1, metal: 0 },
  k: { surf: 'flat', scale: 0.9, rough: 0.8, metal: 0, dressThin: 1 }, n: { surf: 'steel', scale: 1.0, dressThin: 1 },
  d: { surf: 'flat', scale: 0.9, rough: 1, metal: 0, macro: 0.05, dressDecal: 1 },
  g: { surf: 'flat', scale: 0.9, rough: 1, metal: 0, side: THREE.DoubleSide, wet: false, dressPlant: 1 },
  z: { surf: 'concrete', scale: 0.07, wet: false, macro: 0.12, grime: 0.05, dressFar: 1 },
  t: { surf: 'dirt', scale: 0.2, wet: false, macro: 0.2, dressFar: 1 },
};
// keys the older Ga Chim builders in props.js use
const ALIAS = {
  concrete: 'c#8f8c86', darkSteel: 'm#1e1c1b', steel: 's#9a9a96', steelBright: 's#b0b0aa', galv: 's#9aa0a4', grating: 's#6a6e70',
  wood: 'w#6a5236', woodLight: 'w#9a8058', rust: 'u#6a3a24', rubber: 'y#1a1a1a', tarp: 'f#2a4a66', boards: 'w#7a6040',
  paintGrey: 'm#53585b', paintYellow: 'm#b88f1c', paintBlue: 'm#1d456f', doorSteel: 'm#35444b',
  boxRed: 'r#6e2619', boxBlue: 'r#264660', boxGreen: 'r#35523a', boxGrey: 'r#63676a', boxOrange: 'r#9a5020', boxBrown: 'r#55392a',
  glassLit: 'win', emitSodium: 'lamp', emitWarm: 'lamp', emitRed: 'blink', insulator: 'm#5a3018',
};
const SPECIAL = new Set(['glass', 'win', 'winB', 'lamp', 'inlamp', 'blink', 'chain']);
const _col = new THREE.Color();
const resolved = new Map();
function resolve(key) {
  let r = resolved.get(key); if (r) return r;
  const k2 = ALIAS[key] || key;
  if (SPECIAL.has(k2)) r = { bucket: k2, color: [1, 1, 1], uv: k2 === 'chain', wear: false };
  else {
    const [code, hex] = k2.split('#');
    if (!SURF[code]) { console.warn('[dress] no surface for key ' + key); }
    _col.setHex(hex ? parseInt(hex, 16) : 0xffffff);
    r = { bucket: SURF[code] ? code : 'l', color: [_col.r, _col.g, _col.b], uv: false, wear: !'dgztkn'.includes(code) };
  }
  resolved.set(key, r); return r;
}

// the blocks across the road are seen from 10+ m: fold minor surfaces into painted metal / flat to keep ~8 buckets per chunk
const FOLD = { f: 'l', y: 'm', u: 'm', r: 'm', s: 'm', g: 'd', b: 'c', p: 'c', winB: 'win', k: 'l', n: 'm' };
const resolvedB = new Map();
function resolveBlocks(key) {
  let r = resolvedB.get(key); if (r) return r;
  const base = resolve(key);
  r = Object.assign({}, base, { bucket: FOLD[base.bucket] || base.bucket });
  resolvedB.set(key, r); return r;
}
const MAT = {};
const DYN = {};
function chainTex() {
  const N = 32, d = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    const a = Math.abs(((u + v) % 1) - 0.5), b = Math.abs((((u - v) % 1) + 1) % 1 - 0.5);
    const on = Math.min(Math.abs(a - 0.5), a) < 0.06 || Math.min(Math.abs(b - 0.5), b) < 0.06;
    const i = (y * N + x) * 4; d[i] = d[i + 1] = d[i + 2] = d[i + 3] = on ? 255 : 0;
  }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true;
  return t;
}
function material(bucket) {
  if (MAT[bucket]) return MAT[bucket];
  let m;
  switch (bucket) {
    case 'glass': m = noMask(new THREE.MeshStandardMaterial({ color: 0x07090b, roughness: 0.07, metalness: 0.55, envMapIntensity: 1.6 })); break;
    case 'win': m = noMask(new THREE.MeshStandardMaterial({ color: 0x0b0c0d, roughness: 0.14, metalness: 0.3, envMapIntensity: 1.2, emissive: new THREE.Color(1.0, 0.62, 0.3), emissiveIntensity: 0 })); DYN.win = m; break;
    case 'winB': m = noMask(new THREE.MeshStandardMaterial({ color: 0x0b0c0d, roughness: 0.14, metalness: 0.3, envMapIntensity: 1.2, emissive: new THREE.Color(0.55, 0.7, 1.0), emissiveIntensity: 0 })); DYN.winB = m; break;
    case 'lamp': m = noMask(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.29, 0.27) })); DYN.lamp = m; break;
    case 'inlamp': m = noMask(new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 4.2, 2.2) })); break;
    case 'blink': m = noMask(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.01, 0.01) })); DYN.blink = m; break;
    case 'chain': m = noMask(new THREE.MeshStandardMaterial({ color: 0x8a9094, metalness: 0.85, roughness: 0.45, alphaMap: chainTex(), alphaTest: 0.42, side: THREE.DoubleSide, envMapIntensity: 1.1 })); break;
    default: {
      m = mat(Object.assign({ vcol: true, rough: 1, metal: 1 }, SURF[bucket] || SURF.l));
      if (bucket === 'd') { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; }
    }
  }
  return (MAT[bucket] = m);
}
const NO_SHADOW = new Set(['e', 'k', 'n', 'd', 'g', 'chain', 'lamp', 'inlamp', 'blink', 'glass', 'win', 'winB', 'z', 't']);

// ---------------------------------------------------------------- keep-out zones (never block the rules' traffic)
function segDist(px, pz, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / l2)) : 0;
  return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
}
const PATHS = [], DISCS = [], RECTS = [];
function buildKeepOut() {
  const G = lay.GATES;
  lay.CUSTOMER_SPAWNS.forEach((s, i) => {
    const gate = G[lay.CUSTOMER_GATE[i]];
    const pts = [s, ...lay.CUSTOMER_ROUTES[i], gate[0], gate[1]];
    for (let j = 1; j < pts.length; j++) PATHS.push([pts[j - 1], pts[j], 1.8]);
    DISCS.push([s.x, s.z, 3]);
  });
  const gather = lay.ZOMBIE_GATHER;
  for (const z of lay.ZOMBIE_SPAWNS) {
    let best = G[0], bd = 1e9; for (const g of G) { const d = Math.hypot(g[0].x - z.x, g[0].z - z.z); if (d < bd) { bd = d; best = g; } }
    PATHS.push([z, best[0], 2.2], [best[0], best[1], 2.2], [best[1], gather, 2.2]); DISCS.push([z.x, z.z, 3]);
  }
  const rs = lay.RAID_SPAWN;
  RECTS.push([rs[0] - 2, rs[1] - 2, rs[2] + 2, rs[3] + 2]);
  PATHS.push([V((rs[0] + rs[2]) / 2, 0, (rs[1] + rs[3]) / 2), G[1][0], 3], [G[1][0], G[1][1], 2.5]);
  for (const g of G) PATHS.push([g[0], g[1], 2.6]);
  PATHS.push([V(8.6, 0, 47), G[0][0], 2.2]);
  for (const g of G) PATHS.push([g[1], lay.DOOR_OUT, 1.2]);
  DISCS.push([lay.DOOR.x, lay.DOOR.z, 3.0], [lay.DELIVERY.x, lay.DELIVERY.z, 1.4], [lay.DELIVERY_STAND.x, lay.DELIVERY_STAND.z, 1.0],
    [lay.GIB.x, lay.GIB.z, 4.5], [lay.GIB_STAND.x, lay.GIB_STAND.z, 1.5], [lay.MERCHANT_STAND.x, lay.MERCHANT_STAND.z, 1.5], [lay.JOB_BOARD_STAND.x, lay.JOB_BOARD_STAND.z, 1.5],
    [lay.SKIP_STAND.x, lay.SKIP_STAND.z, 1.5], [lay.SIREN.x, lay.SIREN.z, 1.2]);
  for (const c of [lay.CACHE_DUFFLE, lay.CACHE_TROLLEY, lay.CACHE_TOOLBOX, lay.CACHE_CRATE, lay.CACHE_BIN, lay.CACHE_GLOVEBOX, lay.CACHE_MEDBAG, lay.CACHE_SUITCASE]) DISCS.push([c.x, c.z, 1.3]);
  const m = lay.MERCHANT; RECTS.push([m.x - 5, m.z - 2.5, m.x + 5, m.z + 3]);
  const sk = lay.SKIP_BOX; RECTS.push([sk[0] - 1.5, sk[1] - 1.5, sk[2] + 1.5, sk[3] + 2.5]);
}
let refused = 0;
const refusedAt = [];
// solid footprint (radius rad) at x,z is allowed? kind 'wall' = hugging an existing collider (allowed inside the lot)
function ok(x, z, rad, kind) {
  for (const [a, b, w] of PATHS) if (segDist(x, z, a, b) < w + rad) return no(x, z);
  for (const [cx, cz, r] of DISCS) if (Math.hypot(x - cx, z - cz) < r + rad) return no(x, z);
  for (const b of RECTS) if (x > b[0] - rad && x < b[2] + rad && z > b[1] - rad && z < b[3] + rad) return no(x, z);
  const L = lay.LOT, inLot = x > L[0] && x < L[2] && z > L[1] && z < L[3];
  if (inLot && kind !== 'wall') return no(x, z);
  if (kind === 'wall') {
    let near = false;
    for (const c of world.COLLIDERS) { const dx = Math.max(c[0] - x, 0, x - c[2]), dz = Math.max(c[1] - z, 0, z - c[3]); if (Math.hypot(dx, dz) < 0.75) { near = true; break; } }
    if (!near) return no(x, z);
  }
  return true;
}
function no(x, z) { refused++; if (refusedAt.length < 40) refusedAt.push([+x.toFixed(1), +z.toFixed(1)]); return false; }

// ---------------------------------------------------------------- helpers
function quad(k, w, d, key, x, y, z, ry = 0) { const g = new THREE.PlaneGeometry(w, d); g.rotateX(-PI / 2); k.push().at(x, y, z, ry); k.add(g, key); k.pop(); }
function wallQuad(k, w, h, key, x, y, z, ry, rz = 0) { const g = new THREE.PlaneGeometry(w, h); k.push().at(x, y, z, ry, 0, rz); k.add(g, key); k.pop(); }
function place(k, fn, x, z, ry = 0, y = 0, tint = 1) { const tg = k.tag; if (k.tally) { const m = fn.toString().match(/P\.(\w+)/); k.tag = m ? m[1] : (fn.name || 'anon'); } k.push().at(x, y, z, ry); const t0 = k.tint; k.tint = tint; fn(k); k.tint = t0; k.pop(); k.tag = tg; }
function disc(k, r, key, x, y, z, seg = 12) { const g = new THREE.CircleGeometry(r, seg); g.rotateX(-PI / 2); k.push().at(x, y, z); k.add(g, key); k.pop(); }

function stain(k, r, x, y, z, rad, key) {
  for (let i = 0; i < 4; i++) disc(k, rad * r.range(0.35, 1), key || r.pick(['d#151413', 'd#1c1a18', 'd#23211e']), x + r.range(-rad, rad) * 0.6, y + i * 0.0004, z + r.range(-rad, rad) * 0.6, 10);
}
function crack(k, r, x, z, len, y, key) {
  let a = r() * PI * 2, px = x, pz = z;
  for (let i = 0; i < Math.round(len / 0.35); i++) {
    a += r.range(-0.6, 0.6); const nx = px + Math.cos(a) * 0.35, nz = pz + Math.sin(a) * 0.35;
    quad(k, 0.37, r.range(0.012, 0.03), key || 'd#141414', (px + nx) / 2, y, (pz + nz) / 2, -a);
    px = nx; pz = nz;
  }
}
function tuft(k, r, x, y, z, s = 1) {
  const n = 4 + Math.floor(r() * 4), col = r.pick(['g#4a5a2a', 'g#5a6a30', 'g#3e4e24', 'g#6a6a3a', 'g#5a5230']);
  for (let i = 0; i < n; i++) {
    const a = r() * PI * 2, h = (0.12 + r() * 0.3) * s, w = 0.025 + r() * 0.03, lean = r.range(0.1, 0.6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, Math.sin(lean) * h * 0.5, h, Math.cos(lean) * 0.02], 3));
    g.computeVertexNormals();
    k.push().at(x + r.range(-0.08, 0.08) * s, y, z + r.range(-0.08, 0.08) * s, a); k.add(g, col); k.pop();
  }
}
function paper(k, r, x, y, z) {
  const a = r() * PI * 2, c = r.pick(['d#c8c2b0', 'd#b8b29e', 'd#d8d4c4', 'd#a89e86']);
  quad(k, r.range(0.18, 0.34), r.range(0.22, 0.42), c, x, y + 0.002, z, a);
  if (r() < 0.4) { k.push().at(x + 0.08, y + 0.03, z, a + 0.4, 0, 0.5); k.add(new THREE.PlaneGeometry(0.16, 0.2).rotateX(-PI / 2), c); k.pop(); }
}
function leaves(k, r, x, y, z, n, spread) {
  for (let i = 0; i < n; i++) { const d = Math.sqrt(r()) * spread, a = r() * 6.283; quad(k, r.range(0.04, 0.09), r.range(0.05, 0.1), r.pick(['d#4a3a22', 'd#5a4626', 'd#3a3020', 'd#6a5a2e']), x + Math.cos(a) * d, y + 0.001 + r() * 0.002, z + Math.sin(a) * d, r() * 6.28); }
}
// procedural spray-paint marks (original glyphs, no text): strokes on a wall plane at local z
function graffiti(k, r, w, h, colors) {
  const col = r.pick(colors || ['d#b8302a', 'd#e2ded0', 'd#2a5aa8', 'd#c8a020', 'd#3a8a4a', 'd#c05a9a']);
  const line = r.pick(['d#101010', 'd#1a1a1a', 'd#e8e4d8']);
  const glyphs = 3 + Math.floor(r() * 3), gw = w / glyphs, th = h * 0.16;
  const stroke = (x0, y0, x1, y1, z, key, t) => { const L = Math.hypot(x1 - x0, y1 - y0); k.push().at((x0 + x1) / 2, (y0 + y1) / 2, z, 0, 0, Math.atan2(y1 - y0, x1 - x0)); k.add(new THREE.PlaneGeometry(L + t, t), key); k.pop(); };
  const segs = [];
  for (let gI = 0; gI < glyphs; gI++) {
    const cx = -w / 2 + (gI + 0.5) * gw, tilt = r.range(-0.15, 0.15), gh = h * r.range(0.7, 1.0);
    const pts = [[-0.35, -0.5], [-0.35, 0.5], [0.35, 0.5], [0.35, 0], [-0.35, 0], [0.35, -0.5]];
    const order = []; let p = Math.floor(r() * 6);
    for (let s2 = 0; s2 < 3 + Math.floor(r() * 2); s2++) { const q = (p + 1 + Math.floor(r() * 4)) % 6; order.push([p, q]); p = q; }
    for (const [a, b] of order) {
      const A = pts[a], B = pts[b];
      segs.push([cx + (A[0] + A[1] * tilt) * gw * 0.8, A[1] * gh, cx + (B[0] + B[1] * tilt) * gw * 0.8, B[1] * gh]);
    }
  }
  for (const sg of segs) stroke(sg[0], sg[1], sg[2], sg[3], 0.004, line, th * 1.6);
  for (const sg of segs) stroke(sg[0], sg[1], sg[2], sg[3], 0.0048, col, th);
  if (r() < 0.6) stroke(-w * 0.45, -h * 0.62, w * 0.4, -h * 0.58, 0.0048, line, h * 0.05);
  // drips
  for (let i = 0; i < 3; i++) { const x = r.range(-w / 2, w / 2), l = r.range(0.06, 0.2); stroke(x, -h * 0.5, x, -h * 0.5 - l, 0.0046, col, 0.012); }
}
function poster(k, r, w, h) {
  const c = r.pick(['l#c8b888', 'l#d8d2c0', 'l#8a3a2e', 'l#4f6f7a', 'l#b9a36a', 'l#e0dccc']);
  k.box(w, h, 0.004, c, 0, 0, 0.003, 0);
  k.box(w * 0.8, h * 0.16, 0.004, r.pick(['l#2a2a2a', 'l#7a1a14', 'l#1a3a5a']), 0, h * 0.28, 0.005, 0);
  for (let i = 0; i < 4; i++) k.box(w * r.range(0.4, 0.75), h * 0.03, 0.004, 'l#4a4a44', -w * 0.05, -h * 0.05 - i * h * 0.08, 0.005, 0);
  if (r() < 0.5) { k.push().at(w * 0.35, -h * 0.4, 0.007, 0, 0, 0.6); k.add(new THREE.PlaneGeometry(w * 0.4, h * 0.25), c); k.pop(); }
}
function sawhorse(k) {
  // A-frame legs meeting under the top beam; the striped boards are nailed to the front legs, leaning with them
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { k.push().at(sx * 0.9, 0.45, sz * 0.18, 0, -sz * 0.38); k.box(0.07, 0.95, 0.05, 'w#6a5236', 0, 0, 0, 0.01); k.pop(); }
  for (let i = 0; i < 2; i++) {
    const y = 0.5 + i * 0.26, z = 0.18 - (y - 0.45) * Math.tan(0.38) + 0.027 / Math.cos(0.38) + 0.015;
    for (let s = 0; s < 6; s++) { k.push().at(-0.85 + s * 0.34, y, z, 0, -0.38); k.box(0.34, 0.2, 0.03, s % 2 ? 'm#c0bcae' : 'm#b0301e', 0, 0, 0, 0.006); k.pop(); }
  }
  k.box(2.1, 0.06, 0.06, 'w#5a4630', 0, 0.9, 0, 0.01);
}
function roofUnit(k, r) {
  k.box(1.3, 0.9, 1.0, 'm#9a9c96', 0, 0.55, 0, 0.04);
  for (const sx of [-1, 1]) k.box(0.08, 0.1, 1.0, 's#6a6e70', sx * 0.55, 0.05, 0, 0.01);
  k.cyl(0.36, 0.04, 'l#1a1a1a', 0, 1.01, 0, 18);
  for (let i = -3; i <= 3; i++) k.box(0.7, 0.012, 0.012, 's#5a5e60', 0, 1.04, i * 0.1, 0);
  for (let i = 0; i < 6; i++) k.box(0.9, 0.012, 0.012, 'm#6a6c68', 0.66, 0.3 + i * 0.09, 0, 0);
  k.tube(V(-0.6, 0.3, 0.3), V(-1.4, 0.05, 0.3), 0.04, 'm#4a4e50', 6);
}
function ventStack(k, h) { k.cyl(0.12, h, 'm#5a5e60', 0, h / 2, 0, 10); k.add(new THREE.ConeGeometry(0.22, 0.18, 10).translate(0, h + 0.15, 0), 'm#5a5e60'); k.cyl(0.04, 0.12, 's#6a6e70', 0, h + 0.03, 0, 6); }

// ---------------------------------------------------------------- skyline replica (same rng draws as world.js)
function skyline() {
  const r = Rng.named('skyline'), lot = lay.LOT, out = { front: [], back: [], lotRow: [] };
  for (let k = 0; k < 14; k++) {
    const sx = -95 + k * 14 + r.range(-3, 3), w = r.range(7, 12), h = r.range(5, 16);
    if (!(sx >= -36 && sx <= 31)) { const z = 27 + DZ + r.range(0, 4); r.range(0.7, 1.1); out.front.push({ x0: sx, x1: sx + w, zf: z, h }); }
    const z2 = 46 + DZ + r.range(0, 10); r.range(0.7, 1.1); out.back.push({ x0: sx, x1: sx + w, zf: z2, h: h + 6 });
    const zb = lot[1] - 12 + r.range(-4, 3); r.range(0.7, 1.1); out.lotRow.push({ x0: sx, x1: sx + w, zb, zf: zb + 9, h: h * 0.7 });
  }
  return out;
}
// replica of world.js wire_fence posts / broken spans (Rng 'wirefence')
function fenceSpans() {
  const r = Rng.named('wirefence'), out = [];
  lay.FENCE.slice(0, 6).forEach((f, fi) => {
    let a, b;
    if (f[2] - f[0] > f[3] - f[1]) { const z = (f[1] + f[3]) * 0.5; a = V(f[0], 0, z); b = V(f[2], 0, z); }
    else { const x = (f[0] + f[2]) * 0.5; a = V(x, 0, f[1]); b = V(x, 0, f[3]); }
    const len = a.distanceTo(b), n = Math.trunc(Math.max(Math.ceil(len / 2.5), 1)), dir = b.clone().sub(a).divideScalar(len);
    const out2 = fi < 2 ? V(0, 0, 1) : fi < 4 ? V(1, 0, 0) : V(-1, 0, 0);
    let prev = null;
    for (let k = 0; k <= n; k++) {
      const p = a.clone().addScaledVector(dir, len * k / n);
      const lean = r.chance(0.15) ? r.range(-0.25, 0.25) : 0;
      let broken = false;
      if (prev) { broken = r.chance(0.18); out.push({ a: prev.p, b: p, la: prev.lean, lb: lean, broken, out: out2, first: k === 1, last: k === n }); }
      prev = { p, lean };
    }
  });
  return out;
}

// ================================================================= the dressing
function buildStreet(k, r, low) {
  const XS = -90, XE = 90;
  // ---- kerbs on both road edges, dropped at the crossing
  if (!low) for (const [zk, side] of [[ROAD0, -1], [ROAD1, 1]]) {
    for (let x = XS + 1.0; x < XE; x += 2.0) {
      const drop = Math.abs(x - 8.6) < 2.6;
      k.box(1.98, drop ? 0.05 : 0.13 + r.range(-0.005, 0.005), 0.2, r.pick(['e#9a978f', 'e#8e8b84', 'e#a29f97']), x, drop ? 0.0 : 0.035, zk + side * 0.02, 0.025);
    }
  }
  // ---- pavement slab joints, missing slabs, road decals
  if (!low) {
    for (let x = XS; x < XE; x += 1.0) { quad(k, 0.025, 3.7, 'd#3a3936', x + 0.5, 0.0215, (ROAD1 + FAR_WALK) / 2 + 0.05); quad(k, 0.025, 0.8, 'd#3a3936', x, 0.0215, ROAD0 - 0.5); }
    quad(k, XE - XS, 0.025, 'd#3a3936', 0, 0.0215, ROAD1 + 1.0); quad(k, XE - XS, 0.025, 'd#3a3936', 0, 0.0215, ROAD1 + 2.0); quad(k, XE - XS, 0.025, 'd#3a3936', 0, 0.0215, ROAD1 + 3.0);
    for (let i = 0; i < 28; i++) { const x = r.range(XS, XE); quad(k, 0.97, 0.97, r.pick(['d#5c5a54', 'd#6a675f', 'd#4c4a46']), Math.round(x), 0.0218, ROAD1 + 0.5 + Math.floor(r() * 4)); }
    // asphalt patches, cracks, oil stains, potholes
    for (let i = 0; i < 26; i++) { const x = r.range(XS, XE), z = r.range(ROAD0 + 0.5, ROAD1 - 0.5); quad(k, r.range(0.8, 3.5), r.range(0.6, 2.2), r.pick(['d#26282a', 'd#2e3033', 'd#34363a']), x, 0.0025, z, r.range(-0.2, 0.2)); }
    for (let i = 0; i < 40; i++) crack(k, r, r.range(XS, XE), r.range(ROAD0 + 0.3, ROAD1 - 0.3), r.range(1.2, 4.5), 0.003);
    for (let i = 0; i < 26; i++) crack(k, r, r.range(XS, XE), r.range(ROAD1 + 0.3, FAR_WALK - 0.3), r.range(0.6, 2.2), 0.0225, 'd#2a2926');
    for (let i = 0; i < 18; i++) stain(k, r, r.range(XS, XE), 0.0028, r.range(ROAD0 + 1, ROAD1 - 1), r.range(0.3, 0.9));
    for (let i = 0; i < 8; i++) { const x = r.range(XS, XE), z = r.range(ROAD0 + 0.8, ROAD1 - 0.8); disc(k, r.range(0.25, 0.5), 'd#0d0d0d', x, 0.0031, z, 9); disc(k, r.range(0.45, 0.7), 'd#3a3c3e', x, 0.0029, z, 9); }
    // stop lines either side of the crossing
    quad(k, 0.35, 3.8, 'd#b4b2a8', 8.6 - 3.0, 0.0045, ROAD0 + 2.0); quad(k, 0.35, 3.8, 'd#b4b2a8', 8.6 + 3.0, 0.0045, ROAD1 - 2.0);
    // manholes and kerb drains
    for (const [x, z] of [[-31, 48.3], [14.5, 50.6], [41, 51.4], [-62, 49.2], [66, 48.6], [-6, 56.2], [-44, 50.2]]) place(k, (kk) => P.manhole(kk, r), x, z, r() * 3, z > ROAD1 ? 0.022 : 0.0);
    for (let x = -80; x < 85; x += 21) { place(k, (kk) => P.drainGrate(kk), x + 3, ROAD0 + 0.3, 0); place(k, (kk) => P.drainGrate(kk), x - 6, ROAD1 - 0.3, 0); }
    // litter, leaves, weeds on both walks, the road edges and the grass strip before the fence
    for (let i = 0; i < 70; i++) paper(k, r, r.range(XS, XE), r() < 0.5 ? 0.022 : 0.0, r() < 0.5 ? r.range(ROAD1, FAR_WALK - 0.2) : r.range(ROAD0 - 1, ROAD1));
    for (let i = 0; i < 40; i++) { const side = r() < 0.5; leaves(k, r, r.range(XS, XE), side ? 0.0 : 0.0, side ? ROAD0 + 0.25 : ROAD1 - 0.25, 8, 0.5); }
    for (let i = 0; i < 26; i++) leaves(k, r, r.range(XS, XE), 0.022, FAR_WALK - 0.3, 10, 0.6);
    for (let i = 0; i < 110; i++) { const zz = r.pick([ROAD0 - 0.08, ROAD1 + 0.13, FAR_WALK - 0.05, ROAD0 - 1.0]); tuft(k, r, r.range(XS, XE), zz > ROAD1 ? 0.02 : 0.0, zz, r.range(0.7, 1.3)); }
    for (let i = 0; i < 30; i++) tuft(k, r, Math.floor(r.range(XS, XE)) + 0.5, 0.021, r.range(ROAD1 + 0.3, FAR_WALK - 0.3), 0.6);
  }
  // ---- street lamps: far side against the building line, two on the near walk
  for (const x of [-76, -58, -28, -6, 14, 26, 58, 76]) if (ok(x, FAR_WALK - 0.6, 0.3)) place(k, (kk) => P.streetLamp(kk, { reach: 1.9, dead: x === -58 }), x, FAR_WALK - 0.55, PI);
  for (const x of [-24, 32]) if (ok(x, ROAD0 - 0.45, 0.3)) place(k, (kk) => P.streetLamp(kk, { reach: 1.6 }), x, ROAD0 - 0.45, 0);
  // ---- cables from the near utility poles across the road to the facades, insulators on the cross-arms
  const pz = 12.6 + DZ;
  const anchors = [[-36, -29.5, 6.0], [-12, -11.0, 7.8], [12, 8.6, 7.6], [12, 19.5, 5.2], [36, 28.8, 5.1], [-60, -58, 0], [60, 61, 0], [-84, -82, 0], [84, 80, 0]];
  for (const [px, tx, ty0] of anchors) {
    let ty = ty0, tz = FAR_WALK - 0.05;
    if (!ty0) { const b = SKY.front.find((q) => tx > q.x0 + 0.5 && tx < q.x1 - 0.5); if (!b) continue; ty = Math.min(b.h - 0.8, 7.5); tz = b.zf - 0.05; }
    for (const dz of [0.8, -0.8]) {
      const a = V(px, 7.62, pz + dz), b = V(tx + dz * 0.4, ty - (dz > 0 ? 0 : 0.35), tz);
      P.catenary(k, a, b, 0.9 + Math.abs(dz) * 0.3, 0.012, 'k#141414', 12);
    }
    k.push().at(tx, ty, tz, PI); P.utilityBracket(k); k.pop();
  }
  for (let x = -84; x <= 84; x += 24) for (const dz of [-0.8, 0.8]) { k.cyl(0.035, 0.12, 'm#6a3a1a', x, 7.62, pz + dz, 8); k.cyl(0.05, 0.03, 'm#6a3a1a', x, 7.66, pz + dz, 8); }
  // transformer can + junction box on two poles
  for (const x of [-12, 36]) { k.cyl(0.32, 0.9, 'm#6a706a', x, 6.1, pz + 0.38, 14); k.box(0.12, 0.6, 0.12, 'm#4a4e4a', x, 6.1, pz + 0.12, 0.01); k.tube(V(x, 6.6, pz + 0.38), V(x, 7.55, pz + 0.8), 0.012, 'l#141414', 4); }
  // ---- signs
  for (const [x, z, ry, kind] of [[4.0, ROAD0 - 0.5, 0, 'octa'], [13.8, ROAD0 - 0.5, 0, 'tri'], [-47, ROAD0 - 0.5, 0, 'rect'], [-42, FAR_WALK - 0.4, PI, 'noentry'], [36.5, FAR_WALK - 0.4, PI, 'yellow'], [-14.8, FAR_WALK - 0.35, PI, 'round'], [52, ROAD0 - 0.5, 0, 'noentry']]) {
    if (ok(x, z, 0.2)) place(k, (kk) => P.signPost(kk, { kind, tilt: r.range(-0.06, 0.06) }), x, z, ry + r.range(-0.15, 0.15));
  }
  // ---- bus shelter on the far walk, bin beside it
  place(k, (kk) => P.busShelter(kk, { broken: true, adColor: '9a6a3a' }), -48, FAR_WALK - 0.95, PI);
  place(k, (kk) => P.wheelieBin(kk, { color: '2a3a2a' }), -45.0, FAR_WALK - 0.45, PI + 0.2);
  // ---- abandoned traffic beyond the road blocks (outside the zombies' wander box)
  const cars = [[-62.5, 49.0, PI / 2 + 0.35, '6a7a6a', 0.6], [-66.8, 52.4, -PI / 2 - 0.12, '8a3a2a', 0.8], [-71, 47.6, PI / 2 + 0.05, '3a3a3a', 1, true], [-52.6, 52.9, -PI / 2, '5a6a7a', 0.4],
    [62.8, 48.0, PI / 2 + 0.25, 'a89a70', 0.5], [64.2, 52.5, -PI / 2 + 0.15, '2f4a5a', 0.9], [79.5, 48.4, PI / 2, '7a7a72', 0.3], [86, 52.6, -PI / 2 - 0.4, '4a2a2a', 1, true]];
  for (const [x, z, ry, color, wreck, burnt] of cars) place(k, (kk) => P.car(kk, { color, wreck, burnt, seed: 'car' + x }), x, z, ry);
  place(k, (kk) => P.bus(kk, { seed: 'busE', wreck: true, color: 'c0b89a', stripe: '2f5a7a' }), 71.5, 51.6, -PI / 2 + 0.08);
  place(k, (kk) => P.bus(kk, { seed: 'busW', broken: true, wreck: true, color: 'a8a490', stripe: '8a2a22' }), -78.5, 50.2, PI / 2 + 0.42);
  // ---- barricades and sandbags at both road ends
  for (const [x, z, ry] of [[-58.5, 48.2, PI / 2], [-58.8, 51.0, PI / 2 + 0.2], [-59.2, 53.6, PI / 2 - 0.1]]) place(k, sawhorse, x, z, ry);
  place(k, (kk) => P.sandbagWall(kk, 6, 4, r), 59.2, 47.5, PI / 2);
  place(k, (kk) => P.sandbagWall(kk, 5, 3, r), 59.4, 51.6, PI / 2 + 0.1);
  for (const [x, z, s] of [[-64, 46.5, 1.4], [66.5, 54.6, 1.2], [-53.4, 57.2, 1.0], [52.5, 57.3, 1.1], [12.6, 57.3, 0.9], [-36, 57.3, 0.8], [-83, 53, 1.6], [90, 47.5, 1.5]]) {
    if (low) break;
    if (ok(x, z, s * 0.6)) place(k, (kk) => P.rubblePile(kk, r, s), x, z);
  }
  if (!low) {
    for (const [x, z, n] of [[-51.6, 57.4, 4], [36.8, 57.5, 3], [15.4, 57.5, 5], [-63, 54.6, 3], [62.4, 45.6, 4]]) if (ok(x, z, 0.4)) place(k, (kk) => P.tyreStack(kk, n, r), x, z);
    for (const [x, z, ry, tip] of [[16.6, 57.2, 0.4, true], [-37.4, 57.3, 2.6, false], [55, 46.0, 1.2, true]]) if (ok(x, z, 0.5)) place(k, (kk) => P.trolley(kk, { tipped: tip }), x, z, ry);
    for (const [x, z, c] of [[3.6, FAR_WALK - 0.45, '2a4a7a'], [4.4, FAR_WALK - 0.45, '2d4a33'], [19.0, FAR_WALK - 0.45, '3a3a3a'], [-23.4, FAR_WALK - 0.45, '6a2a1e'], [20.4, 40.55, '2a4a7a']]) if (ok(x, z, 0.4)) place(k, (kk) => P.wheelieBin(kk, { color: c }), x, z, (z > 50 ? PI : 0) + r.range(-0.15, 0.15));
  }
}

// facade of one building across the road (faces -z at zf) or behind the lot (faces +z): bands, cornice, windows, roof clutter
function facade(k, r, b, o, low) {
  const face = o.face || -1, zf = b.zf, ry = face < 0 ? PI : 0, w = b.x1 - b.x0, xc = (b.x0 + b.x1) / 2;
  const at = (x, y, dz = 0) => k.push().at(x, y, zf + face * dz, ry);
  const band = o.band || 'c#8a8780';
  k.tag = 'bands';
  // plinth, floor bands, cornice and parapet coping
  at(xc, 0.3, 0.03); k.box(w + 0.02, 0.6, 0.06, o.plinth || 'c#6a6762', 0, 0, 0, 0.01); k.pop();
  const fh = o.fh || 2.8, floors = o.floors ?? Math.max(1, Math.floor((b.h - 0.8) / fh));
  for (let f = 1; f < floors; f++) { at(xc, o.y0b ? o.y0b + f * fh : 0.55 + f * fh, 0.06); k.box(w + 0.1, 0.16, 0.12, band, 0, 0, 0, 0.02); k.pop(); }
  at(xc, b.h - 0.25, 0.15); k.box(w + 0.4, 0.22, 0.3, band, 0, 0, 0, 0.03); k.box(w + 0.3, 0.12, 0.18, band, 0, -0.17, -0.06, 0.02); k.pop();
  k.push().at(xc, b.h + 0.06, zf - face * 0.1 + face * 0.0, ry); k.box(w + 0.1, 0.12, 0.42, 'c#7e7b74', 0, 0, 0, 0.02); k.pop();
  for (const x of [b.x0 + 0.2, b.x1 - 0.2]) { at(x, b.h / 2, 0.05); k.box(0.4, b.h - 0.3, 0.1, band, 0, 0, 0, 0.02); k.pop(); }
  if (low) return;
  // windows
  const cols = o.xs || []; if (!o.xs) for (let x = b.x0 + 1.4; x <= b.x1 - 1.4 + 0.01; x += 2.6) cols.push(x);
  if (!o.noWindows) for (let f = (o.shop ? 1 : 0); f < floors; f++) for (const x of cols) {
    if (o.skip && o.skip(x, f)) continue;
    const y = (o.wy0 ?? 1.9) + f * fh;
    const roll = r();
    const kind = roll < 0.18 ? 'boarded' : roll < 0.3 ? 'broken' : roll < 0.45 ? 'lit' : roll < 0.6 ? 'curtain' : 'glass';
    k.tag = 'window'; at(x, y, o.wdz ?? 0.035); P.windowUnit(k, o.ww || 1.5, o.wh || 1.6, kind, r, { frame: o.frame }); k.pop();
    if (kind === 'lit' || (kind === 'curtain' && r() < 0.5)) { at(x, y, (o.wdz ?? 0.035) - 0.026); k.box((o.ww || 1.5) - 0.1, (o.wh || 1.6) - 0.1, 0.004, r() < 0.7 ? 'win' : 'winB', 0, 0, 0, 0.001); k.pop(); }
    if (r() < 0.12 && f > 0) { k.tag = 'ac'; at(x + 0.3, y - 1.05, 0.24); P.acUnit(k, {}); k.pop(); }
  }
  // ground floor shopfront: shutters, sign board, awning
  if (o.shop) {
    k.tag = 'shopfront';
    const sw = Math.min(w - 2, 5.2), sx = o.shopX ?? xc;
    at(sx, 0, 0.04); P.rollerShutter(k, sw, 2.7, o.open ?? r.range(0, 0.6), { color: r.pick(['7a7e80', '6a6e64', '8a7a6a']) }); k.pop();
    at(sx, 3.25, 0.06); k.box(sw + 0.6, 0.7, 0.08, 'm#' + r.pick(['2a4a3a', '6a2a22', '2a3a5a', '8a7a5a']), 0, 0, 0, 0.02); k.box(sw * 0.7, 0.3, 0.02, 'm#c8c2a8', -0.2, 0, 0.05, 0.005); k.pop();
    if (o.awning) { at(sx, 3.0, 0.0); P.awning(k, sw + 0.4, 1.3, { seed: 'aw' + b.x0, torn: o.torn || 0.15, c1: o.awning[0], c2: o.awning[1] }); k.pop(); }
    at(sx + sw / 2 + 0.6, 2.6, 0.0); P.wallLamp(k); k.pop();
  }
  k.tag = 'street-level';
  // downpipe, posters and spray marks at street level
  at(b.x1 - 0.5, 0, 0.08); P.downpipe(k, b.h - 0.2); k.pop();
  for (let i = 0; i < (o.marks ?? 2); i++) { at(r.range(b.x0 + 1.5, b.x1 - 1.5), r.range(0.62, 0.78), 0.0); graffiti(k, r, r.range(1.2, 2.4), r.range(0.4, 0.55)); k.pop(); }
  for (let i = 0; i < (o.posters ?? 2) && cols.length > 1; i++) { const c = Math.floor(r() * (cols.length - 1)); at((cols[c] + cols[c + 1]) / 2 + r.range(-0.1, 0.1), r.range(1.4, 1.7), 0.0); poster(k, r, 0.5, 0.7); k.pop(); }
  // weeds and litter along the base (far walk side only)
  if (face < 0) for (let i = 0; i < Math.round(w / 1.5); i++) tuft(k, r, r.range(b.x0 + 0.3, b.x1 - 0.3), b.zf > FAR_WALK + 0.2 ? -0.05 : 0.022, zf - 0.08, r.range(0.6, 1.1));
  k.tag = 'roof';
  // roof clutter
  const rr = o.roof ?? 2;
  for (let i = 0; i < rr; i++) {
    const x = r.range(b.x0 + 1.5, b.x1 - 1.5), dz = r.range(2, 6), choice = r();
    k.push().at(x, b.h, zf - face * dz, ry + r.range(-0.2, 0.2));
    if (choice < 0.35) roofUnit(k, r); else if (choice < 0.6) P.waterTank(k, { r: r.range(0.6, 1.0), h: r.range(1.2, 1.8) }); else if (choice < 0.8) P.antenna(k, { h: r.range(2.5, 4.5), dish: r() < 0.5 }); else ventStack(k, r.range(0.8, 1.6));
    k.pop();
  }
}

function buildBlocks(k, r, low) {
  // the three named buildings across the road (world.js build_exterior)
  const hosp = { x0: -16, x1: 10, zf: FAR_WALK, h: 9 };
  facade(k, r, hosp, { floors: 3, xs: [-14.7, -12.1, -9.5, -6.9, -4.3, -1.7, 0.9, 3.5, 6.1, 8.7], wdz: 0.135, band: 'c#a2a6a8', plinth: 'c#7a7e80', roof: 6, marks: 2, posters: 1,
    skip: (x, f) => f === 0 && x > -5.2 && x < -0.8 }, low);
  // hospital porch: glazed doors, red-cross lightbox, canopy edge
  if (!low) {
    k.push().at(-3.0, 0, FAR_WALK - 0.8, PI);
    for (const sx of [-0.6, 0.6]) { k.box(1.15, 2.3, 0.03, 'glass', sx, 1.15, 0.02, 0.004); k.box(0.06, 2.35, 0.06, 'm#5a5e60', sx + 0.56, 1.17, 0.04, 0.006); k.box(0.04, 0.4, 0.05, 's#a0a4a6', sx - sx * 0.8, 1.1, 0.07, 0.005); }
    k.box(0.06, 2.35, 0.06, 'm#5a5e60', -1.16, 1.17, 0.04, 0.006); k.box(2.6, 0.08, 0.08, 'm#5a5e60', 0, 2.36, 0.04, 0.01);
    k.box(4.2, 0.25, 1.0, 'c#a8acae', -0.0, 3.25, 0.3, 0.03);
    k.box(1.2, 1.2, 0.22, 'l#d8d8d0', 1.3, 4.0, 0.2, 0.03); k.box(0.8, 0.24, 0.02, 'l#b8261c', 1.3, 4.0, 0.32, 0.004); k.box(0.24, 0.8, 0.02, 'l#b8261c', 1.3, 4.0, 0.325, 0.004);
    k.pop();
    k.tag = 'fire'; k.push().at(7.4, 0, FAR_WALK - 0.03, PI); P.fireEscape(k, 2, 4.4, { y0: 3.55, fh: 2.8 }); k.pop();
    k.tag = 'bb'; k.push().at(-9.5, 9.0, FAR_WALK + 3.5, PI); P.billboard(k, { w: 7, h: 3.2, post: 2.2, seed: 'hospBB' }); k.pop();
  }
  const east = { x0: 18, x1: 30, zf: FAR_WALK, h: 6 };
  facade(k, r, east, { floors: 2, xs: [19.3, 21.9, 24.5, 27.1], wdz: 0.135, band: 'c#7a6a5e', plinth: 'c#5a4e46', shop: true, shopX: 23.2, awning: ['2a4a3a', 'b8b098'], open: 0.35, roof: 3,
    skip: (x, f) => false }, low);
  k.push().at(20.5, 8.2 - 0.25, FAR_WALK - 0.15, PI); k.box(5.4, 0.22, 0.3, 'c#7a6a5e', 0, 0, 0, 0.03); k.pop();
  k.box(5.1, 0.12, 0.42, 'c#7e7b74', 20.5, 8.26, FAR_WALK + 0.1, 0.02);
  if (!low) { k.push().at(27.1, 0, FAR_WALK - 0.03, PI); P.fireEscape(k, 1, 2.4, { y0: 3.6 }); k.pop(); }
  const west = { x0: -34, x1: -22, zf: FAR_WALK, h: 7 };
  facade(k, r, west, { floors: 2, xs: [-32.7, -30.1, -27.5, -24.9], wdz: 0.135, band: 'c#7e7a6c', plinth: 'c#5e5a50', shop: true, shopX: -28.5, awning: ['7a2a22', 'c0b8a0'], torn: 0.35, open: 0.0, roof: 2, marks: 3 }, low);
  if (!low) { k.push().at(-29, 7.0, FAR_WALK + 4, PI); P.billboard(k, { w: 8, h: 3.4, post: 2.8, seed: 'westBB' }); k.pop(); }
  // skyline front row along the street, back row, row behind the lot
  for (const b of SKY.front) facade(k, r, b, { shop: b.h > 6 && r() < 0.6, awning: r() < 0.5 ? ['3a4a6a', 'b0a890'] : null, torn: 0.3, roof: 1 }, low);
  k.tag = 'back';
  for (const b of SKY.back) {
    if (low) { facade(k, r, b, { floors: 0, roof: 0, marks: 0, posters: 0 }, true); continue; }
    const floors = Math.floor((b.h - 1) / 3);
    for (let f = 0; f < floors; f++) for (let x = b.x0 + 1.3; x < b.x1 - 1.0; x += 2.4) {
      const lit = r() < 0.2;
      k.box(1.3, 1.5, 0.05, lit ? (r() < 0.7 ? 'win' : 'winB') : r() < 0.15 ? 'w#5a4630' : 'glass', x, 1.8 + f * 3, b.zf - 0.03, 0);
      k.box(1.45, 0.08, 0.14, 'c#7a7874', x, 1.0 + f * 3, b.zf - 0.06, 0);
    }
    k.box(b.x1 - b.x0 + 0.3, 0.25, 0.3, 'c#6e6c68', (b.x0 + b.x1) / 2, b.h - 0.15, b.zf - 0.1, 0.02);
    if (r() < 0.4) { k.push().at(r.range(b.x0 + 2, b.x1 - 2), b.h, b.zf + 4); r() < 0.5 ? P.waterTank(k, { r: 1.1, h: 2 }) : ventStack(k, 1.4); k.pop(); }
  }
  for (const b of SKY.lotRow) {
    facade(k, r, b, { face: 1, fh: 2.8, roof: b.x0 > -40 && b.x1 < 45 ? 1 : 0, marks: b.x0 > -40 && b.x1 < 45 ? 1 : 0, posters: 0, band: 'c#7a6a5c', plinth: 'c#5a4e44', noWindows: true }, low);
    if (low) continue;
    const floors = Math.max(1, Math.floor((b.h - 0.8) / 2.8));
    for (let f = 0; f < floors; f++) for (let x = b.x0 + 1.4; x <= b.x1 - 1.4; x += 2.6) {
      const roll = r(), y = 1.9 + f * 2.8;
      k.box(1.4, 1.5, 0.05, roll < 0.15 ? 'win' : roll < 0.35 ? 'w#5a4630' : 'glass', x, y, b.zf + 0.02, 0);
      k.box(1.55, 0.08, 0.14, 'c#8a8278', x, y - 0.8, b.zf + 0.06, 0); k.box(1.6, 0.12, 0.06, 'c#8a8278', x, y + 0.81, b.zf + 0.03, 0);
      if (roll >= 0.15 && roll < 0.35) for (let i = 0; i < 3; i++) k.box(1.6, 0.17, 0.025, 'w#6a5236', x, y - 0.5 + i * 0.5, b.zf + 0.06, 0);
    }
  }
}

function buildLot(k, r, low) {
  // ---- chain-link on the rules' fence lines (same posts as world.js, skipping its broken / leaning spans)
  const spans = fenceSpans();
  for (const s of spans) {
    const d = s.b.clone().sub(s.a), len = d.length(), dir = d.clone().divideScalar(len), n = V(dir.z, 0, -dir.x);
    const top = s.broken ? 0.95 : 2.08, nx = 8, ny = 4, pos = [], uv = [], idx = [];
    const leaning = s.la !== 0 || s.lb !== 0;
    if (!leaning || s.broken) {
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
        const t = i / nx, y0 = 0.08 + (top - 0.08) * j / ny;
        const tear = s.broken && j === ny ? -r.range(0, 0.35) : 0;
        const bulge = Math.sin(t * PI) * Math.sin(j / ny * PI) * 0.05 + (vnoise3(s.a.x + t * len, y0 * 2, s.a.z) - 0.5) * 0.04;
        const p = s.a.clone().addScaledVector(dir, t * len).addScaledVector(n, bulge); p.y = y0 + tear;
        pos.push(p.x, p.y, p.z); uv.push(t * len / 0.065, p.y / 0.065);
      }
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i; idx.push(a, a + 1, a + nx + 2, a, a + nx + 2, a + nx + 1); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      k.add(g, 'chain');
    }
    if (!s.broken && !leaning) {
      k.tube(V(s.a.x, 2.12, s.a.z), V(s.b.x, 2.12, s.b.z), 0.022, 's#8a9094', 6);
      k.tube(V(s.a.x, 0.1, s.a.z), V(s.b.x, 0.1, s.b.z), 0.006, 'n#7a8084', 3);
      // barbed wire on outward arms
      for (let w = 1; w <= 3; w++) {
        const off = s.out.clone().multiplyScalar(w * 0.11), y = 2.2 + w * 0.11;
        const a = V(s.a.x + off.x, y, s.a.z + off.z), b = V(s.b.x + off.x, y, s.b.z + off.z);
        k.tube(a, b, 0.004, 'n#6a6e70', 3);
        if (!low) for (let t = 0.12; t < len; t += 0.6) {
          const p = a.clone().addScaledVector(dir, t);
          k.push().at(p.x, p.y, p.z, Math.atan2(dir.x, dir.z) + 0.7, 0.6); k.add(new THREE.BoxGeometry(0.006, 0.006, 0.07), 'n#5a5e60'); k.pop();
        }
      }
    }
    for (const [p, lean] of [[s.a, s.la], [s.b, s.lb]]) if (lean === 0) {
      k.tube(V(p.x, 2.15, p.z), V(p.x + s.out.x * 0.38, 2.52, p.z + s.out.z * 0.38), 0.018, 's#7a8084', 5);
      k.cyl(0.055, 0.06, 's#6a6e70', p.x, 2.2, p.z, 8);
      k.cyl(0.11, 0.12, 'c#8a8780', p.x, 0.04, p.z, 10);
    }
    // weeds and leaves along the fence foot (both sides)
    if (!low) for (let t = 0.3; t < len; t += r.range(0.6, 1.6)) { const p = s.a.clone().addScaledVector(dir, t); tuft(k, r, p.x + n.x * r.range(-0.15, 0.15), 0.0, p.z + n.z * r.range(-0.15, 0.15), r.range(0.8, 1.5)); if (r() < 0.3) leaves(k, r, p.x, 0.0, p.z, 6, 0.4); }
  }
  // gate posts and open gate leaves folded against the fence outside each gap
  const gates = [[V(4.6, 0, 40), V(-1, 0, 0), V(0, 0, 1)], [V(12.6, 0, 40), V(1, 0, 0), V(0, 0, 1)], [V(31.1, 0, 3.3), V(0, 0, -1), V(1, 0, 0)], [V(31.1, 0, 18), V(0, 0, 1), V(1, 0, 0)], [V(-23.4, 0, 6), V(0, 0, -1), V(-1, 0, 0)], [V(-23.4, 0, 19), V(0, 0, 1), V(-1, 0, 0)]];
  for (const [p, along, out] of gates) {
    k.box(0.14, 2.5, 0.14, 'm#4a5054', p.x, 1.25, p.z, 0.015); k.box(0.2, 0.06, 0.2, 'm#4a5054', p.x, 2.52, p.z, 0.01);
    k.box(0.5, 0.2, 0.5, 'c#8a8780', p.x, 0.06, p.z, 0.03);
    const base = p.clone().addScaledVector(out, 0.22), L = 2.8;
    const e = base.clone().addScaledVector(along, L);
    for (const y of [0.15, 1.95]) k.tube(V(base.x, y, base.z), V(e.x, y, e.z), 0.025, 'm#4a5054', 6);
    for (const q of [base, e]) k.tube(V(q.x, 0.12, q.z), V(q.x, 1.98, q.z), 0.025, 'm#4a5054', 6);
    k.tube(V(base.x, 0.15, base.z), V(e.x, 1.95, e.z), 0.018, 'm#4a5054', 5);
    const g = new THREE.PlaneGeometry(L, 1.8); const uvs = g.attributes.uv; for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * L / 0.065, uvs.getY(i) * 1.8 / 0.065);
    k.push().at((base.x + e.x) / 2, 1.05, (base.z + e.z) / 2, Math.atan2(along.x, along.z) - PI / 2); k.add(g, 'chain'); k.pop();
  }
  // back corrugated fence: barbed strands on short posts
  for (let x = lay.LOT[0]; x < lay.LOT[2]; x += 2) { k.tube(V(x - 0.0, 2.25, lay.LOT[1] - 0.06), V(x, 2.6, lay.LOT[1] - 0.3), 0.012, 's#6a6e70', 4); }
  for (let w = 1; w <= 2; w++) k.tube(V(lay.LOT[0], 2.25 + w * 0.15, lay.LOT[1] - 0.06 - w * 0.12), V(lay.LOT[2], 2.25 + w * 0.15, lay.LOT[1] - 0.06 - w * 0.12), 0.004, 'n#6a6e70', 3);

  // ---- floodlight masts at the four corners, outside the fence, aimed at the lot
  for (const [x, z] of [[-25.0, -21.8], [33.0, -21.8], [-25.3, 41.4], [33.0, 41.2]]) {
    if (!ok(x, z, 1.0)) continue;
    const ry = Math.atan2(4 - x, 10 - z);
    place(k, (kk) => P.floodMast(kk, { h: 12, heads: 3 }, { lamps: [], decals: [] }), x, z, ry);
  }
  if (low) return;
  // ---- west outside the fence (z < 3: south of the zombie path from the west spawn)
  place(k, (kk) => P.cabin(kk, 'boxGrey'), -25.6, -15.2, PI, 0);
  place(k, (kk) => { P.acUnit(kk, {}); }, -26.95, -14.0, -PI / 2, 1.9);
  place(k, (kk) => P.wallLamp(kk), -26.88, -16.6, -PI / 2, 2.3);
  place(k, (kk) => P.generator(kk), -25.6, -9.6, PI / 2);
  place(k, (kk) => P.container(kk, 6.06, 'boxBlue', 0, 0, 0, 0, { decals: [] }, 'cw1'), -28.4, -3.0, 0.02);
  place(k, (kk) => P.container(kk, 6.06, 'boxRed', 0, 0, 0, 0, { decals: [] }, 'cw2'), -28.45, -3.2, -0.03, 2.59);
  place(k, (kk) => P.container(kk, 12.19, 'boxGreen', 0, 0, 0, 0, { decals: [] }, 'cw3'), -31.6, -11.0, 0.05);
  for (const [x, z, sacks] of [[-24.9, 0.9, false], [-26.3, 1.2, true], [-24.8, -5.5, false]]) if (ok(x, z, 0.7)) place(k, (kk) => P.palletLoad(kk, r, { sacks }), x, z, r.range(-0.2, 0.2));
  for (const [x, z, c] of [[-24.6, -1.6, 'm#2c5a44'], [-24.65, -2.3, 'm#7d2219'], [-25.3, -1.9, 'm#1f3f66'], [-24.7, -19.4, 'm#5a6068']]) place(k, (kk) => P.barrel(kk, c), x, z, r() * 6);
  place(k, (kk) => P.cableDrum(kk), -27.8, -17.6, PI / 2);
  place(k, (kk) => P.tyreStack(kk, 5, r), -24.5, -7.6); place(k, (kk) => P.tyreStack(kk, 3, r), -24.6, -8.4);
  place(k, (kk) => P.skipRusty(kk, r), -30.6, -18.4, 0.08);
  // west strip z 21..39 hugging the fence (east of the customer path from the north-west spawn)
  for (const z of [24.6, 27.7, 30.8]) if (ok(-24.1, z, 0.4)) place(k, (kk) => P.jersey(kk), -24.1, z, r.range(-0.03, 0.03));
  if (ok(-24.4, 22.0, 0.5)) place(k, (kk) => P.sandbagWall(kk, 4, 3, r), -24.35, 21.8, PI / 2);
  if (ok(-24.4, 34.0, 0.4)) place(k, (kk) => P.tyreStack(kk, 4, r), -24.4, 34.0);
  if (ok(-24.7, 36.8, 0.6)) { place(k, (kk) => P.crate(kk, r), -24.6, 36.6, 0.1); place(k, (kk) => P.crate(kk, r, 0.8, 0.6, 0.7), -24.6, 36.6, -0.2, 0.8); }
  // ---- east outside the fence (z < 2.5, x > 31.1) and the strip z 19..39
  place(k, (kk) => P.container(kk, 12.19, 'boxGreen', 0, 0, 0, 0, { decals: [] }, 'ce1'), 36.2, -12.5, 0.02);
  place(k, (kk) => P.container(kk, 6.06, 'boxOrange', 0, 0, 0, 0, { decals: [] }, 'ce2'), 36.25, -14.6, -0.03, 2.59);
  place(k, (kk) => P.container(kk, 6.06, 'boxGrey', 0, 0, 0, 0, { decals: [] }, 'ce3'), 39.6, -3.2, 0.12);
  place(k, (kk) => P.skipRusty(kk, r), 33.6, -2.2, PI / 2 + 0.05);
  for (const [x, z, sacks] of [[32.4, 0.6, false], [32.5, -5.6, true], [33.9, -6.0, false]]) if (ok(x, z, 0.7)) place(k, (kk) => P.palletLoad(kk, r, { sacks }), x, z, r.range(-0.2, 0.2));
  for (const [x, z, c] of [[32.0, -17.4, 'm#7d2219'], [32.6, -17.9, 'm#b98a1c'], [32.1, -18.5, 'm#2c5a44']]) place(k, (kk) => P.barrel(kk, c), x, z, r() * 6);
  place(k, (kk) => P.crate(kk, r), 33.0, -19.6, 0.05);
  place(k, (kk) => P.generator(kk), 33.2, -9.0, PI / 2);
  for (const z of [22.2, 25.3, 28.4]) if (ok(32.0, z, 0.4)) place(k, (kk) => P.jersey(kk), 32.0, z, r.range(-0.03, 0.03));
  if (ok(32.3, 38.0, 0.5)) place(k, (kk) => P.sandbagWall(kk, 4, 3, r), 32.2, 38.2, PI / 2);
  for (const [x, z, n] of [[32.4, 20.0, 3], [33.2, 20.3, 5]]) if (ok(x, z, 0.4)) place(k, (kk) => P.tyreStack(kk, n, r), x, z);
  for (const [z, c] of [[35.6, '2d4a33'], [36.4, '3a3a3a']]) if (ok(31.75, z, 0.35)) place(k, (kk) => P.wheelieBin(kk, { color: c }), 31.75, z, PI / 2);
  // ---- behind the back fence (outside the play bounds): stacks, a lean-to, rubble where the houses leave room
  for (const b of SKY.lotRow) {
    const gap = lay.LOT[1] - 0.2 - b.zf;
    if (gap < 1.6 || b.x1 < -40 || b.x0 > 45) continue;
    for (let x = b.x0 + 1; x < b.x1 - 1; x += r.range(1.8, 3.4)) {
      const z = b.zf + Math.min(gap / 2, 1.2), c = r();
      if (c < 0.25) place(k, (kk) => P.palletLoad(kk, r, {}), x, z, r.range(-0.3, 0.3));
      else if (c < 0.45) place(k, (kk) => P.barrel(kk, r.pick(['m#2c5a44', 'm#7d2219', 'm#1f3f66'])), x, z);
      else if (c < 0.6) place(k, (kk) => P.rubblePile(kk, r, 0.8), x, z);
      else if (c < 0.72) place(k, (kk) => P.wheelieBin(kk, { color: r.pick(['2d4a33', '3a3a3a', '2a4a7a']) }), x, b.zf + 0.4, 0);
      else if (c < 0.85) place(k, (kk) => P.tyreStack(kk, 2 + Math.floor(r() * 4), r), x, z);
    }
  }
  // ---- flat things inside the lot: oil stains, wheel stops, drains, litter, leaves, weeds at the slab edge
  const pz0 = lay.o(0, 19.8).z;
  for (let i = 0; i < 11; i++) {
    const x = -12 + 1.45 + i * 2.9;
    if (Math.abs(x - 8.6) < 2.5) continue;
    k.box(1.6, 0.1, 0.14, 'c#9a978e', x, 0.05, pz0 - 2.05, 0.02);
    if (r() < 0.6) stain(k, r, x + r.range(-0.4, 0.4), 0.0026, pz0 + r.range(-0.5, 1.2), r.range(0.3, 0.6));
  }
  for (const [x, z] of [[-6, 31.5], [18, 30], [24, 16]]) place(k, (kk) => P.drainGrate(kk), x, z, 0);
  place(k, (kk) => P.manhole(kk, r), -15, 27.5, 0.4);
  for (let i = 0; i < 40; i++) { const x = r.range(lay.LOT[0] + 0.5, lay.LOT[2] - 0.5), z = r.range(13.5, lay.LOT[3] - 0.5); if (Math.hypot(x, z - 5) < 3) continue; paper(k, r, x, 0.0, z); }
  for (let i = 0; i < 18; i++) crack(k, r, r.range(lay.LOT[0] + 1, lay.LOT[2] - 1), r.range(13.5, lay.LOT[3] - 1), r.range(1, 3.5), 0.0026);
  for (let i = 0; i < 30; i++) leaves(k, r, r.range(lay.LOT[0], lay.LOT[2]), 0.0, r.pick([lay.LOT[3] - 0.4, 13.1]), 7, 0.6);
  for (let i = 0; i < 50; i++) tuft(k, r, r.range(lay.LOT[0] + 0.2, lay.LOT[2] - 0.2), 0.0, 13.0 + r.range(-0.08, 0.08), r.range(0.6, 1.1));
}

function buildShop(k, r, low) {
  if (low) return;
  const fz = 5.25, ez = lay.EXPANSION[3]; // shop front wall face, expansion front face (3.2)
  // downpipes and gutters
  for (const [x, z, h, ry] of [[5.12, fz + 0.08, 3.25, 0], [14.9, ez + 0.08, 3.4, 0], [24.75, ez + 0.08, 3.4, 0], [15.08, -6.0, 6.9, PI / 2], [15.08, -18.6, 6.9, PI / 2]]) place(k, (kk) => P.downpipe(kk, h), x, z, ry);
  k.tube(V(5.25, 3.45, ez + 0.1), V(25.0, 3.45, ez + 0.1), 0.06, 'm#4a4f52', 8);
  k.tube(V(15.12, 6.95, -19.2), V(15.12, 6.95, -5.25), 0.07, 'm#4a4f52', 8);
  // AC units, wall lamps (the front windows carry striped awnings from sim/models.js window_awnings, no shutter boxes)
  place(k, (kk) => P.acUnit(kk, {}), -9.93, 1.0, -PI / 2, 1.9);
  place(k, (kk) => P.acUnit(kk, { color: '9a9c96' }), 12.2, ez + 0.18, 0, 2.2);
  place(k, (kk) => P.acUnit(kk, {}), 15.2, -9.5, PI / 2, 2.6);
  for (const [x, y, z, ry] of [[-4.6, 2.3, fz, 0], [4.6, 2.3, fz, 0], [-7.5, 2.45, fz, 0], [10.2, 2.6, ez, 0], [20.2, 2.6, ez, 0], [15.0, 3.6, -12.5, PI / 2], [-9.75, 2.4, -2.5, -PI / 2]]) place(k, (kk) => P.wallLamp(kk), x, z, ry, y);
  // posters and spray marks on the medical front, expansion front and side walls
  const marks = [[-8.6, 1.5, fz, 0, 2.0, 0.8], [-6.6, 1.2, fz, 0, 1.2, 0.6], [9.5, 1.3, ez, 0, 2.6, 0.9], [17.8, 1.6, ez, 0, 2.2, 0.8], [22.2, 1.1, ez, 0, 1.8, 0.7], [-9.75, 1.4, -0.6, -PI / 2, 2.2, 0.8], [15.0, 1.4, -15, PI / 2, 3.0, 1.0], [25.0, 1.5, -1.0, PI / 2, 2.2, 0.8]];
  for (const [x, y, z, ry, w, h] of marks) { k.push().at(x, y, z, ry); graffiti(k, r, w, h); k.pop(); }
  for (const [x, y, z, ry] of [[-7.8, 1.75, fz, 0], [-6.0, 1.9, fz, 0], [-9.2, 1.6, fz, 0], [4.55, 1.6, fz, 0], [8.4, 1.7, ez, 0], [13.6, 1.8, ez, 0], [21.0, 1.75, ez, 0], [-9.75, 1.7, 2.2, -PI / 2]]) { k.push().at(x, y, z, ry); poster(k, r, r.range(0.45, 0.6), r.range(0.6, 0.8)); k.pop(); }
  // sign lamps over the SHOP sign and wall brackets of the awning struts
  for (const x of [-1.5, 0, 1.5]) { k.push().at(x, 4.74, 5.13, 0); k.tube(V(0, 0, 0), V(0, 0.22, 0.25), 0.014, 'm#2a2c2e', 5); k.box(0.22, 0.08, 0.14, 'm#2a2c2e', 0, 0.22, 0.32, 0.015); k.box(0.18, 0.012, 0.1, 'lamp', 0, 0.175, 0.32, 0.003); k.pop(); }
  for (const x of [-5.2, -1.7, 1.7, 5.2]) k.box(0.12, 0.18, 0.02, 'm#3a3e40', x, 3.12, fz + 0.012, 0.004);
  // roof: antenna with a dish, vent stacks, hatch, cable runs, junction box; expansion roof units; warehouse roof fans
  place(k, (kk) => P.antenna(kk, { h: 3.6, dish: true }), -7.4, -3.4, 0.3, 3.5);
  for (const [x, z, h] of [[-1.0, -4.3, 0.9], [3.6, 2.8, 0.6], [-8.6, 1.4, 1.1]]) place(k, (kk) => ventStack(kk, h), x, z, 0, 3.5);
  k.box(0.9, 0.25, 0.9, 'm#5a5e60', 0.6, 3.62, -3.6, 0.03); k.box(0.95, 0.04, 0.95, 'm#4a4e50', 0.6, 3.76, -3.6, 0.01);
  k.tube(V(-3.2, 3.54, -1.6), V(2.0, 3.54, -0.6), 0.02, 'l#151515', 4); k.tube(V(-7.4, 3.54, -3.2), V(-3.2, 3.54, -1.9), 0.015, 'l#151515', 4);
  k.box(0.4, 0.5, 0.2, 'm#6a706a', -5.0, 3.75, -4.9, 0.02);
  for (const [x, z] of [[9, -1.5], [18.5, -2.5]]) place(k, (kk) => roofUnit(kk, r), x, z, r() * 0.3, 3.45);
  for (const [x, z] of [[11, 0.8], [21, 0.6]]) { k.box(1.4, 0.3, 1.0, 'm#5a5e60', x, 3.6, z, 0.03); k.box(1.3, 0.04, 0.9, 'glass', x, 3.76, z, 0.005); }
  for (const [x, z] of [[2, -12], [9, -9], [9, -16]]) { k.cyl(0.4, 0.5, 'm#7a7c78', x, 7.15, z, 16); k.add(new THREE.ConeGeometry(0.5, 0.3, 16).translate(x, 7.55, z), 'm#6a6c68'); }
  // crates, gas bottles, pallets and barrels against the walls (inside the existing wall colliders' reach)
  if (ok(-8.75, fz + 0.17, 0.05, 'wall')) place(k, (kk) => P.gasBottles(kk, 3, r), -8.75, fz + 0.17, 0);
  if (ok(-6.9, fz + 0.32, 0.05, 'wall')) { place(k, (kk) => P.crate(kk, r, 0.9, 0.7, 0.55), -6.9, fz + 0.3, 0.03); place(k, (kk) => P.crate(kk, r, 0.6, 0.45, 0.45), -6.85, fz + 0.3, -0.1, 0.7); }
  for (const sx of [-1, 1]) if (ok(sx * 4.3, fz + 0.2, 0.05, 'wall')) place(k, (kk) => P.sandbagWall(kk, 3, 3, r), sx * 4.3, fz + 0.2, 0);
  if (ok(17.4, ez + 0.32, 0.05, 'wall')) { place(k, (kk) => P.crate(kk, r, 1.0, 0.8, 0.6), 17.4, ez + 0.32, 0.02); place(k, (kk) => P.crate(kk, r, 0.7, 0.55, 0.5), 17.3, ez + 0.3, -0.15, 0.8); place(k, (kk) => P.crate(kk, r, 0.8, 0.7, 0.6), 18.5, ez + 0.32, 0.06); }
  if (ok(13.3, ez + 0.17, 0.05, 'wall')) place(k, (kk) => P.gasBottles(kk, 4, r), 13.3, ez + 0.17, 0);
  if (ok(22.6, ez + 0.35, 0.05, 'wall')) { place(k, (kk) => P.barrel(kk, 'm#3d5a78'), 22.4, ez + 0.36); place(k, (kk) => P.barrel(kk, 'm#7a3b2a'), 23.05, ez + 0.36, 1.2); }
  if (ok(10.6, ez + 0.12, 0.05, 'wall')) for (let i = 0; i < 3; i++) { k.push().at(10.6 + i * 0.12, 0, ez + 0.2 + i * 0.05, 0, -0.18); P.pallet(k, 1); k.pop(); }
  if (ok(15.45, -16.0, 0.05, 'wall')) { place(k, (kk) => P.crate(kk, r), 15.5, -16.0, PI / 2 + 0.05); place(k, (kk) => P.crate(kk, r, 0.7, 0.6, 0.6), 15.5, -16.0, PI / 2 - 0.1, 0.8); }
  if (ok(15.4, -7.6, 0.05, 'wall')) { place(k, (kk) => P.barrel(kk, 'm#55603a'), 15.4, -7.6); place(k, (kk) => P.barrel(kk, 'm#2c5a44'), 15.45, -8.25, 2); }
  // weeds and leaves at wall feet
  for (let i = 0; i < 26; i++) { const x = r.range(-9.6, 24.8); tuft(k, r, x, 0.0, x < 5.25 ? fz + 0.06 : ez + 0.06, r.range(0.6, 1.0)); }
  leaves(k, r, -7.5, 0.0, fz + 0.3, 14, 0.6); leaves(k, r, 19, 0.0, ez + 0.3, 14, 0.8);
}

function buildInterior(k, r) {
  const Y = 3.2; // ceiling underside; nothing below 2.4
  // cable tray along x between beams 3 and 4, hangers to the slab
  const tz = 2.45, ty = 3.06;
  k.box(9.8, 0.015, 0.3, 's#8a8e90', 0, ty, tz, 0.004);
  for (const s of [-1, 1]) k.box(9.8, 0.06, 0.012, 's#8a8e90', 0, ty + 0.03, tz + s * 0.15, 0.003);
  for (let x = -4.6; x <= 4.6; x += 1.15) { k.tube(V(x, ty, tz - 0.17), V(x, Y, tz - 0.17), 0.006, 's#5a5e60', 3); k.tube(V(x, ty, tz + 0.17), V(x, Y, tz + 0.17), 0.006, 's#5a5e60', 3); k.box(0.04, 0.02, 0.36, 's#5a5e60', x, ty - 0.01, tz, 0.003); }
  for (const [dz, c, rr] of [[-0.08, 'l#1a1a1a', 0.014], [0.0, 'l#4a4a48', 0.012], [0.07, 'l#7a2a1e', 0.01]]) k.tube(V(-4.9, ty + 0.02, tz + dz), V(4.9, ty + 0.02, tz + dz), rr, c, 5);
  // supply duct along z under the beams, with flanges, hangers and two diffusers
  const dx = -1.4, dy = 2.84;
  k.box(0.5, 0.28, 8.85, 'm#8e9290', dx, dy, 0.425, 0.01);
  for (let z = -3.9; z <= 4.8; z += 1.2) { k.box(0.56, 0.33, 0.04, 's#7a7e7c', dx, dy, z, 0.005); k.box(0.62, 0.02, 0.04, 's#5a5e60', dx, 2.97, z, 0.003); k.tube(V(dx - 0.29, 2.97, z), V(dx - 0.29, 2.98, z), 0.006, 's#5a5e60', 3); }
  for (const z of [-0.2, 3.0]) { k.box(0.44, 0.03, 0.44, 's#c0c0bc', dx, dy - 0.155, z, 0.005); for (let i = -2; i <= 2; i++) k.box(0.4, 0.012, 0.012, 'l#2a2a2a', dx, dy - 0.172, z + i * 0.08, 0.002); }
  k.box(0.54, 0.3, 0.03, 's#7a7e7c', dx, dy, -4.0, 0.005); k.cyl(0.13, 0.26, 's#9a9e9c', dx, 3.08, -3.82, 12);
  // red sprinkler main under the beams with heads, conduits along beam sides, junction boxes
  k.tube(V(1.2, 2.92, -4.9), V(1.2, 2.92, 4.9), 0.03, 'm#8a1e16', 8);
  for (let z = -3.6; z <= 4.2; z += 2.4) { k.tube(V(1.2, 2.92, z + 1.2), V(1.2, 2.84, z + 1.2), 0.008, 's#b0a060', 4); k.cyl(0.03, 0.02, 's#b0a060', 1.2, 2.83, z + 1.2, 8); }
  for (let i = 0; i < 4; i++) {
    const z = -3.6 + i * 2.4 + 0.24;
    k.tube(V(-4.9, 3.1, z), V(4.9, 3.1, z), 0.012, 'l#d8d4c8', 4);
    k.box(0.14, 0.14, 0.07, 'm#7a7e78', -3.2 + i * 1.7, 3.08, z + 0.05, 0.01);
  }
  // pendant lamps over both shelf runs: cord, enamel shade, bulb
  for (const [x, z] of [[-3.7, -0.4], [3.7, -0.4], [-3.7, 2.0], [3.7, 2.0]]) {
    k.tube(V(x, Y, z), V(x, 2.66, z), 0.005, 'l#151515', 3);
    k.add(new THREE.ConeGeometry(0.2, 0.14, 16, 1, true).translate(x, 2.6, z), 'm#2c4a3a');
    k.cyl(0.035, 0.03, 'm#2c4a3a', x, 2.68, z, 8);
    k.cyl(0.012, 0.1, 'm#2c4a3a', x, 2.62, z, 8); // lamp holder from the shade cap down to the bulb
    k.add(new THREE.SphereGeometry(0.045, 8, 6).translate(x, 2.55, z), 'inlamp');
  }
  // ventilation grille high on the back wall
  k.box(0.03, 0.35, 0.6, 's#8a8e90', -4.98, 2.62, -4.2, 0.005); for (let i = 0; i < 6; i++) k.box(0.02, 0.02, 0.54, 'l#2a2a2a', -4.96, 2.5 + i * 0.05, -4.2, 0.002);
}

function buildFar(k, r) {
  const haze = (x, z) => 1 - 0.5 * Math.min(1, Math.max(0, (Math.hypot(x, z - 20) - 90) / 140));
  const tones = ['z#5a5e64', 'z#64686c', 'z#4e5258', 'z#6a6660', 'z#56524c'];
  const block = (x, z, w, d, h) => {
    const t0 = k.tint; k.tint = haze(x, z) * r.range(0.8, 1.1);
    const c = r.pick(tones);
    k.box(w, h, d, c, x, h / 2, z, 0.2);
    if (r() < 0.45) k.box(w * r.range(0.4, 0.7), h * r.range(0.15, 0.35), d * 0.6, c, x + r.range(-w * 0.15, w * 0.15), h + h * 0.1, z, 0.15);
    if (r() < 0.5) { k.box(1.6, 2.2, 1.6, c, x + r.range(-w / 3, w / 3), h + 1.1, z + r.range(-d / 3, d / 3), 0.1); }
    if (r() < 0.35) k.tube(V(x, h, z), V(x, h + r.range(6, 14), z), 0.12, c, 4);
    // a few windows that light up at night (facing the play area)
    const fx = x, fz = z + (z > 20 ? -d / 2 - 0.05 : d / 2 + 0.05);
    for (let i = 0; i < Math.floor(h / 4); i++) if (r() < 0.35) k.box(r.range(1.5, 4), 1.2, 0.1, r() < 0.7 ? 'win' : 'winB', fx + r.range(-w / 2 + 1.5, w / 2 - 1.5), 2 + i * 3.2, fz, 0.02);
    k.tint = t0;
  };
  // skyline ring: north beyond the back row, south beyond the tree line, both flanks
  for (let x = -230; x < 230; x += r.range(14, 30)) block(x, r.range(118, 160), r.range(12, 26), r.range(12, 22), r.range(12, 46));
  for (let x = -220; x < 220; x += r.range(16, 34)) block(x, -r.range(110, 150), r.range(14, 30), r.range(12, 22), r.range(8, 30));
  for (let z = -90; z < 110; z += r.range(16, 30)) { block(-r.range(125, 160), z, r.range(12, 22), r.range(14, 26), r.range(10, 34)); block(r.range(125, 160), z, r.range(12, 22), r.range(14, 26), r.range(10, 34)); }
  // tree line beyond the back trees and on the flanks
  const tree = (x, z, h) => { const t0 = k.tint; k.tint = haze(x, z) * r.range(0.75, 1.1); k.cyl(0.25, h * 0.4, 't#3b2f25', x, h * 0.2, z, 5); k.add(lathe([[0, 0], [h * 0.28, h * 0.12], [h * 0.22, h * 0.45], [0, h * 0.75]], 7).translate(x, h * 0.25, z), r.pick(['t#2f4a33', 't#34502f', 't#2a402c', 't#3e5232'])); k.tint = t0; };
  for (let i = 0; i < 90; i++) tree(r.range(-160, 160), -r.range(64, 92), r.range(8, 15));
  for (let i = 0; i < 40; i++) { const s = r() < 0.5 ? -1 : 1; tree(s * r.range(96, 118), r.range(-60, 110), r.range(8, 14)); }
  // power line pylons with sagging conductors, a water tower, a radio mast with red beacons
  const py = [];
  for (let x = -250; x <= 250; x += 72) { const z = -100 + Math.sin(x * 0.01) * 6, H = 40; k.push().at(x, 0, z, 0.08); P.pylon(k, H, 'z#5a5e62'); k.pop(); py.push([x, z, H]); }
  for (let i = 1; i < py.length; i++) for (const [dy, l] of [[0.62, 0.22], [0.78, 0.17], [0.9, 0.12]]) for (const s of [-1, 1]) {
    const a = py[i - 1], b = py[i];
    P.catenary(k, V(a[0] + s * a[2] * l, a[2] * dy - a[2] * 0.04, a[1]), V(b[0] + s * b[2] * l, b[2] * dy - b[2] * 0.04, b[1]), 4.5, 0.05, 'z#3a3c3e', 10);
  }
  k.push().at(-96, 0, -46); P.waterTower(k, 'z#6a6e70'); k.pop();
  k.push().at(118, 0, 132); P.radioMast(k, 72, 'z#7a4a40'); k.pop();
  for (const y of [72.4, 48, 24]) k.add(new THREE.OctahedronGeometry(0.6).translate(118, y, 132), 'blink');
  k.add(new THREE.OctahedronGeometry(0.5).translate(-96, 30.6, -46), 'blink'); // on the tank's top cap (30.2)
}

let SKY = null;
export async function install(G) {
  const t0 = performance.now();
  SKY = skyline();
  buildKeepOut();
  const low = G.quality && G.quality.name === 'low';
  const root = new THREE.Group(); root.name = 'dress';
  const stats = { tris: 0, meshes: 0, refused: 0 };
  const kits = [['street', buildStreet, true], ['blocks', buildBlocks, true], ['lot', buildLot, false], ['shop', buildShop, false], ['interior', buildInterior, false], ['far', buildFar, true]];
  for (const [name, fn, lowOk] of kits) {
    if (low && !lowOk) continue;
    const k = new VKit(resolve);
    k.cell = name === 'blocks' ? 64 : 0; k.tag = name; if (G.params.dressstats) k.tally = {};
    if (name === 'blocks') k.resolve = resolveBlocks;
    try { fn(k, rng('dress:' + name), low); } catch (e) { console.error('[dress] ' + name + ' failed: ' + (e && e.stack || e)); continue; }
    const g = k.build(material, { noShadow: NO_SHADOW, allNoShadow: name === 'far' || name === 'interior' || name === 'blocks' });
    g.name = 'dress:' + name;
    if (name === 'far') g.traverse((o) => { if (o.isMesh) o.receiveShadow = false; });
    root.add(g); stats.tris += k.tris; stats.meshes += g.children.length; stats[name] = { tris: Math.round(k.tris), meshes: g.children.length }; if (k.tally) stats[name].ktris = Object.fromEntries(Object.entries(k.tally).map(([a, b]) => [a, Math.round(b / 1000)]));
  }
  G.scene.add(root);
  stats.refused = refused; stats.refusedAt = refusedAt; stats.ms = Math.round(performance.now() - t0); stats.tris = Math.round(stats.tris);
  console.info('[dress] ' + JSON.stringify(stats));
  // night: street lamps, lit windows, beacons
  const sky = G.sky && G.sky.uniforms;
  const lampDay = new THREE.Color(0.3, 0.29, 0.27), lampNight = new THREE.Color(9, 5.2, 2.0);
  G.updaters.push(['dress', (dt, t) => {
    const n = sky ? sky.uNight.value : 0;
    const k = Math.min(1, Math.max(0, n * 1.3));
    if (DYN.lamp) DYN.lamp.color.copy(lampDay).lerp(lampNight, k);
    if (DYN.win) DYN.win.emissiveIntensity = k * 1.6;
    if (DYN.winB) DYN.winB.emissiveIntensity = k * 0.9;
    if (DYN.blink) { const on = (t % 1.6) < 0.22; DYN.blink.color.setRGB(on ? 14 : 0.25, on ? 0.5 : 0.01, on ? 0.15 : 0.01); }
  }]);
  return stats;
}
