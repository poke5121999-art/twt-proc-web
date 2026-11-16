// Plug-in "loot": the eight loot spots of the rules layer ({k:'Cache'} props: duffle bag, trolley, toolbox, crate, bin,
// glovebox, medical bag, suitcase) drawn as real code-built containers, and the loot moment of the original game:
// while the player holds E the lid / zip / flap opens with the hold progress (closes again on release) and the container
// shakes with rummaging sounds; when the search completes (rules: player.js finish_hold pushes g.loot_events) every item
// pops out one at a time on a ballistic arc with spin, bounces on the ground around the container, lies there a moment,
// then flies to the player with a pickup sound and adds a line to the HUD loot feed (hud.js loot_feed). Searched
// containers stay open and visibly empty; a morning refill closes them again with new goods showing.
// View only: the rules already moved the items into the backpack when the event was pushed. ?noplug=loot gives the old
// boxes back (world.js prop_geo case 'Cache' draws nothing while globalThis.__twtLootView is set).
// Method as dress.js (Saltline props-level.md, Felix Rieseberg): chamfered parts at real sizes, one batch per surface
// with colour and wear in vertex colours. Item models are the rules' own (sim/models.js item) so a tin is the same tin
// on the shelf, in the trolley and in the air.
import * as THREE from '../../vendor/three.module.min.js';
import { mat, noMask, keepAlpha } from '../mats.js';
import { sharedMaterials } from '../sp/lib/prop.js';
import { createWearMaterial } from '../sp/lib/wear-material.js';
import * as SPM from '../sp/props/metal.js';
import * as SPD from '../sp/props/drums.js';
import * as SPF from '../sp/props/furniture.js';
import { VKit } from '../kit.js';
import { rng } from '../rng.js';
import * as world from '../sim/world.js';
import * as player from '../sim/player.js';
import * as audio from '../sim/audio.js';
import { Vec3 } from '../sim/vec.js';
import { MB, m4_chain, m4_translate, m4_rot_x, m4_rot_y, m4_rot_z, m4_scale, hex, FLAT } from '../sim/geom.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const PI = Math.PI;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- materials (same surface table as dress.js)
const SURF = {
  f: { surf: 'fabric', scale: 1.0 }, m: { surf: 'paintedMetal', scale: 0.8 }, s: { surf: 'steel', scale: 1.0 },
  w: { surf: 'wood', scale: 0.7 }, y: { surf: 'polymer', scale: 1.5 }, l: { surf: 'flat', scale: 0.9, rough: 1, metal: 0 },
};
const _c = new THREE.Color();
const resolved = new Map();
function resolve(key) {
  let r = resolved.get(key); if (r) return r;
  const [code, hx] = key.split('#');
  _c.setHex(parseInt(hx, 16));
  r = { bucket: SURF[code] ? code : 'l', color: [_c.r, _c.g, _c.b], uv: false, wear: true };
  resolved.set(key, r); return r;
}
const MAT = {};
function material(b) { return MAT[b] || (MAT[b] = mat(Object.assign({ vcol: true, rough: 1, metal: 1 }, SURF[b] || SURF.l))); }

// ---------------------------------------------------------------- geometry helpers
function deform(geo, fn) {
  const P = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i); fn(v); P.setXYZ(i, v.x, v.y, v.z); }
  geo.computeVertexNormals(); return geo;
}
function path(k, pts, r, key, seg = 5, n) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => V(p[0], p[1], p[2])));
  k.add(new THREE.TubeGeometry(curve, n || Math.max(6, pts.length * 4), r, seg, false), key);
}
// thin sheet (both sides visible) of w x d with nx x nz segments, shaped by fn(x, z) -> y
function sheet(k, w, d, t, nx, nz, key, fn) {
  const g = new THREE.BoxGeometry(w, t, d, nx, 1, nz);
  deform(g, (v) => { v.y += fn(v.x, v.z); });
  k.add(g, key);
}

// ---------------------------------------------------------------- the eight containers (local frame: origin on the
// ground at the centre, +x along the long side). Each: body(k), parts [{hinge, axis, rest, open, build(k), pose?}],
// goods slots [x, y, z, ry, rx, rz, scale], filler(mb, M) (bags/straw inside, hidden once searched), mouth, glint.
const DEFS = {
  'Duffle bag': () => {
    const L = 0.78, R = 0.17, base = 0.1275;
    const top = (x) => base + R - 0.04 * (1 - (x / (L / 2)) ** 2);
    const col = 'f#3e4729', dark = 'f#141610', web = 'f#23251c';
    return {
      yaw: 0.35, sound: 'cloth',
      body(k) {
        const g = new THREE.CapsuleGeometry(R, L - 2 * R, 6, 18); g.rotateZ(PI / 2);
        deform(g, (v) => {
          if (v.y < -0.12) v.y = -0.12 + (v.y + 0.12) * 0.15;
          v.z *= 1 + 0.14 * Math.max(0, -v.y / R);
          v.y -= 0.04 * (1 - (v.x / (L / 2)) ** 2) * Math.max(0, v.y / R);
          v.y += 0.004 * Math.sin(v.x * 41 + v.z * 13) * Math.max(0, v.y / R + 0.3);
          v.y += base;
        });
        k.add(g, col);
        // webbing bands round the bag and limp carry handles flopped over to one side
        for (const bx of [-0.21, 0.21]) {
          const pts = []; for (let i = 0; i <= 12; i++) { const a = -PI * 0.08 + PI * 1.16 * i / 12; const ry = R + 0.006; pts.push([bx, base + Math.sin(a) * ry * 0.98 - 0.04 * (1 - (bx / (L / 2)) ** 2) * Math.max(0, Math.sin(a)), Math.cos(a) * ry * (1 + 0.14 * Math.max(0, -Math.sin(a)))]); }
          path(k, pts, 0.007, web, 4, 24);
        }
        for (const s of [-1, 1]) path(k, [[-0.21, top(-0.21) + 0.002, -0.05 * s], [-0.12, top(-0.12) + 0.035, 0.05 + 0.03 * s], [0.0, top(0) + 0.03, 0.13 + 0.02 * s], [0.12, top(0.12) + 0.035, 0.05 + 0.03 * s], [0.21, top(0.21) + 0.002, -0.05 * s]], 0.009, web, 5, 28);
        k.box(0.1, 0.03, 0.035, 'f#3a3a2e', 0, top(0) + 0.045, 0.135, 0.008);
        // the opened mouth under the flap and the zip teeth along both lips
        for (let i = 0; i < 6; i++) { const x0 = -0.27 + i * 0.09, x = x0 + 0.045; k.push().at(x, top(x) - 0.008, -0.025); k.box(0.092, 0.012, 0.13, dark, 0, 0, 0, 0.004); k.pop(); }
        for (let i = 0; i < 6; i++) { const x = -0.27 + i * 0.09 + 0.045; k.box(0.09, 0.008, 0.012, 's#8a8a80', x, top(x) - 0.001, -0.095, 0.002); }
        k.box(0.03, 0.02, 0.02, 's#b0b0a8', 0.29, top(0.29) + 0.004, -0.095, 0.004);
      },
      parts: [{
        hinge: [0, top(0) - 0.005, 0.045], axis: 'x', rest: 0.35, open: 2.15,
        build(k) {
          // the zipped cover: a curved cloth flap from the hinge lip to the zip
          // bag-local z of a flap point = hinge z (0.045) + local z; the cloth follows the bag's top curve (y ~ -z^2 / 2R)
          for (let i = 0; i < 6; i++) {
            const x = -0.27 + i * 0.09 + 0.045, dy = top(x) - top(0);
            k.push().at(x, 0, -0.075);
            sheet(k, 0.094, 0.15, 0.012, 2, 4, 'f#46502e', (xx, z) => { const bz = 0.045 + z - 0.075; return dy + 0.011 - 2.94 * (bz * bz - 0.045 * 0.045) - 0.002 * Math.sin((x + xx) * 50); });
            k.pop();
          }
        },
      }],
      goods: [[-0.14, 0.165, -0.03, 0.4, 0.3, 0.1, 1], [0.0, 0.175, -0.025, -0.6, -0.25, 0, 1], [0.14, 0.16, -0.03, 1.1, 0.2, -0.25, 1], [-0.06, 0.1, 0.02, 0.2, 1.4, 0, 1], [0.07, 0.1, 0.02, 2.2, 1.5, 0, 1]],
      mouth: [0, 0.27, -0.03], glint: [0.02, 0.27, -0.03],
    };
  },

  'Trolley': () => {
    const yb = 0.42, yt = 0.92, xb0 = -0.38, xb1 = 0.4, xt0 = -0.44, xt1 = 0.48, zb = 0.235, zt = 0.27;
    const wire = 's#767d80', red = 'y#a8261c', blk = 'y#1b1b1b';
    const rimAt = (t, side) => { const y = yb + (yt - yb) * t; return [xb0 + (xt0 - xb0) * t, xb1 + (xt1 - xb1) * t, (zb + (zt - zb) * t) * side, y]; };
    return {
      yaw: -0.5, sound: 'metal',
      body(k) {
        // rims
        for (const t of [0, 0.38, 0.7, 1]) {
          const [x0, x1, , y] = rimAt(t, 1), z = zb + (zt - zb) * t, r = t === 1 ? 0.0075 : t === 0 ? 0.005 : 0.0035;
          k.tube(V(x0, y, -z), V(x1, y, -z), r, wire, 5); k.tube(V(x0, y, z), V(x1, y, z), r, wire, 5);
          k.tube(V(x0, y, -z), V(x0, y, z), r, wire, 5); k.tube(V(x1, y, -z), V(x1, y, z), r, wire, 5);
        }
        // side and end wires
        for (let i = 0; i <= 13; i++) {
          const u = i / 13;
          for (const s of [-1, 1]) k.tube(V(xb0 + (xb1 - xb0) * u, yb, zb * s), V(xt0 + (xt1 - xt0) * u, yt, zt * s), 0.0035, wire, 3);
        }
        for (let i = 1; i < 8; i++) {
          const u = -1 + 2 * i / 8;
          k.tube(V(xb1, yb, zb * u), V(xt1, yt, zt * u), 0.0035, wire, 3);
          k.tube(V(xb0, yb, zb * u), V(xt0, yt, zt * u), 0.0035, wire, 3);
        }
        // floor grid
        for (let i = 0; i <= 8; i++) { const z = -zb + 2 * zb * i / 8; k.tube(V(xb0, yb, z), V(xb1, yb, z), 0.0035, wire, 3); }
        for (let i = 1; i < 6; i++) { const x = xb0 + (xb1 - xb0) * i / 6; k.tube(V(x, yb - 0.004, -zb), V(x, yb - 0.004, zb), 0.004, wire, 3); }
        // chassis: base rails, legs, push handle uprights
        const yr = 0.13;
        for (const s of [-1, 1]) {
          k.tube(V(-0.47, yr, 0.215 * s), V(0.42, yr, 0.2 * s), 0.009, wire, 6);
          k.tube(V(xb1, yb, zb * s), V(0.42, yr, 0.2 * s), 0.008, wire, 6);
          k.tube(V(-0.47, yr, 0.215 * s), V(-0.555, 1.0, 0.255 * s), 0.009, wire, 6);
          k.tube(V(xb0, yb, zb * s), V(-0.43, yb - 0.02, 0.222 * s), 0.007, wire, 5);
        }
        k.tube(V(0.42, yr, -0.2), V(0.42, yr, 0.2), 0.009, wire, 6);
        k.tube(V(-0.47, yr, -0.215), V(-0.47, yr, 0.215), 0.009, wire, 6);
        for (let i = 1; i < 6; i++) { const x = -0.45 + 0.85 * i / 6; k.tube(V(x, yr + 0.012, -0.2), V(x, yr + 0.012, 0.2), 0.004, wire, 3); }
        // push handle with a red plastic grip, red end caps on the front rim corners
        k.cyl(0.018, 0.56, red, -0.555, 1.0, 0, 12, 'z');
        for (const s of [-1, 1]) { k.box(0.04, 0.03, 0.03, red, xt1, yt, zt * s, 0.008); }
        k.box(0.05, 0.1, 0.5, 'y#7a1c16', -0.535, 0.93, 0, 0.01);
        // castors: swivel fork + wheel, wheel bottom on the ground
        for (const [x, z] of [[-0.44, -0.205], [-0.44, 0.205], [0.4, -0.19], [0.4, 0.19]]) {
          k.box(0.045, 0.012, 0.045, 's#6a6e70', x, yr - 0.012, z, 0.003);
          for (const dz of [-0.022, 0.022]) k.box(0.036, 0.06, 0.006, 's#6a6e70', x + 0.012, 0.085, z + dz, 0.002);
          k.cyl(0.05, 0.03, blk, x + 0.012, 0.05, z, 14, 'z');
          k.cyl(0.02, 0.034, 's#8a8e90', x + 0.012, 0.05, z, 8, 'z');
        }
      },
      parts: [{
        // a scavenged tarp thrown over the goods; pulled forward off the basket while searching
        // it covers the front 2/3 of the basket (the back goods show), then folds over the front rim and hangs down
        hinge: [xt1, yt + 0.012, 0], axis: 'z', rest: 0, open: -4.5,
        build(k) {
          k.push().at(-0.31, 0, 0);
          sheet(k, 0.62, 0.62, 0.01, 10, 8, 'f#3b5268', (x, z) => {
            const u = (x + 0.31) / 0.62, w = (z + 0.31) / 0.62;
            let y = -0.045 * Math.sin(PI * u) * Math.sin(PI * w) + 0.006 * Math.sin(x * 23 + z * 17);
            if (Math.abs(z) > 0.27) y -= (Math.abs(z) - 0.27) * 1.6;
            return y;
          });
          k.pop();
        },
      }],
      goods: [[-0.25, yb + 0.002, -0.1, 0.3, 0, 0, 1], [-0.1, yb + 0.002, -0.12, 1.2, 0, 0, 1], [0.05, yb + 0.002, -0.09, 2.0, 0, 0, 1], [-0.2, yb + 0.002, 0.1, 0.5, 0, 0, 1], [0.0, yb + 0.002, 0.11, 2.6, 0, 0, 1], [0.2, yb + 0.002, 0.08, 1.4, 0, 0, 1], [0.22, yb + 0.002, -0.1, 0.1, 0, 0, 1], [-0.05, yb + 0.06, 0.0, 0.9, PI / 2, 0, 1]],
      mouth: [0.05, 0.95, 0], glint: [0.0, 0.6, 0.0],
    };
  },

  'Toolbox': () => {
    const W = 0.52, H = 0.2, D = 0.24, t = 0.012, red = 'm#a3271c', inn = 'm#2a1210', st = 'm#8e9294';
    return {
      yaw: 0.9, sound: 'metal',
      body(k) {
        k.box(W, t, D, red, 0, 0.012 + t / 2, 0, 0.004);
        for (const s of [-1, 1]) { k.box(W, H - 0.012, t, red, 0, 0.012 + (H - 0.012) / 2, (D / 2 - t / 2) * s, 0.004); k.box(t, H - 0.012, D - 2 * t, red, (W / 2 - t / 2) * s, 0.012 + (H - 0.012) / 2, 0, 0.004); }
        k.box(W - 2 * t, 0.004, D - 2 * t, inn, 0, 0.02 + t, 0, 0);
        for (const [x, z] of [[-0.22, -0.09], [-0.22, 0.09], [0.22, -0.09], [0.22, 0.09]]) k.box(0.04, 0.012, 0.04, 'y#151515', x, 0.006, z, 0.003);
        // rolled rim, latches, end handles
        for (const s of [-1, 1]) k.box(W + 0.006, 0.012, 0.016, red, 0, H - 0.006, (D / 2) * s, 0.004);
        for (const x of [-0.17, 0.17]) for (const s of [-1, 1]) { k.box(0.036, 0.05, 0.01, st, x, H - 0.03, (D / 2 + 0.006) * s, 0.003); k.box(0.02, 0.014, 0.014, st, x, H - 0.008, (D / 2 + 0.008) * s, 0.003); }
        for (const s of [-1, 1]) { path(k, [[s * (W / 2 + 0.002), H - 0.06, -0.05], [s * (W / 2 + 0.03), H - 0.07, -0.04], [s * (W / 2 + 0.03), H - 0.07, 0.04], [s * (W / 2 + 0.002), H - 0.06, 0.05]], 0.006, st, 5, 12); }
        k.box(0.16, 0.002, 0.07, 'l#d8d4c4', 0.1, H * 0.55, D / 2 + 0.001, 0);
      },
      parts: [1, -1].map((s) => ({
        // cantilever trays: each half of the top tips outward on its long edge, the tray floor shows inside
        hinge: [0, H, (D / 2) * s], axis: 'x', rest: 0.0, open: 2.25 * s,
        build(k) {
          const dz = -(D / 4) * s;
          k.box(W - 0.004, 0.012, D / 2 - 0.004, red, 0, 0.044, dz, 0.004);
          for (const ss of [-1, 1]) k.box(0.01, 0.038, D / 2 - 0.006, red, (W / 2 - 0.006) * ss, 0.021, dz, 0.003);
          k.box(W - 0.004, 0.038, 0.01, red, 0, 0.021, dz * 2 + 0.005 * s, 0.003);
          k.box(W - 0.02, 0.003, D / 2 - 0.02, inn, 0, 0.0365, dz, 0);
          for (let i = 1; i < 4; i++) k.box(0.006, 0.03, D / 2 - 0.02, red, -W / 2 + W * i / 4, 0.022, dz, 0.002);
          k.box(0.14, 0.018, 0.022, 'y#1b1b1b', 0, 0.059, dz * 0.4, 0.006);
        },
      })),
      goods: [[-0.14, 0.075, -0.04, 0.2, 0, PI / 2, 0.9], [0.0, 0.075, 0.05, 1.4, 0, PI / 2, 0.9], [0.13, 0.032, -0.03, 2.4, 0, 0, 0.9], [0.13, 0.032, 0.06, 0.4, 0, 0, 0.9]],
      mouth: [0, 0.24, 0], glint: [0, 0.2, 0],
    };
  },

  'Crate': () => {
    const W = 0.8, H = 0.54, D = 0.56, wood = 'w#7a5f3e', dark = 'w#2a2016', nail = 'm#2b2b2b';
    return {
      yaw: 0.15, sound: 'wood',
      body(k) {
        for (const s of [-1, 1]) k.box(W, 0.06, 0.08, 'w#5e4830', 0, 0.03, (D / 2 - 0.08) * s, 0.008);
        k.box(W, 0.02, D, wood, 0, 0.07, 0, 0.004);
        k.box(W - 0.06, 0.004, D - 0.06, dark, 0, 0.082, 0, 0);
        for (let i = 0; i < 3; i++) {
          const y = 0.08 + 0.02 + i * 0.155 + 0.07;
          for (const s of [-1, 1]) { k.box(W, 0.135, 0.018, i === 1 ? 'w#86694a' : wood, 0, y, (D / 2 - 0.009) * s, 0.005); k.box(0.018, 0.135, D - 0.036, i === 2 ? 'w#86694a' : wood, (W / 2 - 0.009) * s, y, 0, 0.005); }
        }
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.05, H - 0.08, 0.05, 'w#6a5236', (W / 2 - 0.025) * sx, 0.08 + (H - 0.08) / 2, (D / 2 - 0.025) * sz, 0.006);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0.17, 0.33, 0.48]) k.box(0.012, 0.012, 0.004, nail, (W / 2 - 0.04) * sx, y, (D / 2 + 0.001) * sz, 0.002);
        k.box(0.3, 0.12, 0.002, 'l#c8c0a8', -0.12, 0.33, D / 2 + 0.001, 0);
        k.box(0.18, 0.02, 0.002, 'l#3a3a36', -0.12, 0.35, D / 2 + 0.003, 0);
      },
      parts: [{
        // nailed lid: pried up at the front edge, then lifted off and stood against the back of the crate
        hinge: [0, H, D / 2], axis: 'x', rest: 0.08, open: 0,
        build(k) {
          for (let i = 0; i < 4; i++) k.box(W, 0.02, D / 4 - 0.006, i % 2 ? 'w#86694a' : wood, 0, 0.01, -D / 8 - i * D / 4, 0.004);
          for (const x of [-0.3, 0.3]) k.box(0.07, 0.022, D - 0.04, 'w#6a5236', x, 0.031, -D / 2, 0.005);
          for (const x of [-0.3, 0.3]) for (let i = 0; i < 4; i++) k.box(0.012, 0.004, 0.012, nail, x, 0.044, -D / 8 - i * D / 4, 0.001);
          k.box(0.3, 0.002, 0.16, 'l#b8b098', 0.1, 0.021, -D / 2, 0);
        },
        pose(o, t) {
          // t 0..0.45: pry the front edge up 0.5 rad; 0.45..1: lift it off (arcing out so it clears the crate) and stand it
          // on its back edge on the ground, leaning on the crate's back rim
          const a = ease(t / 0.45) * 0.5 + 0.08 * (1 - ease(t / 0.2)), b = ease((t - 0.45) / 0.55);
          o.rotation.set(a + (PI / 2 - 0.045 - 0.5) * b, 0, 0);
          o.position.set(0, H * (1 - b) + Math.sin(b * PI) * 0.15, D / 2 + 0.025 * b + Math.sin(b * PI) * 0.35);
        },
      }],
      goods: [[-0.2, 0.084, -0.1, 0.3, 0, 0, 1], [0.0, 0.084, -0.12, 1.1, 0, 0, 1], [0.2, 0.084, -0.08, 2.3, 0, 0, 1], [-0.18, 0.084, 0.12, 0.8, 0, 0, 1], [0.12, 0.084, 0.11, 1.9, 0, 0, 1]],
      filler(mb, M) {
        // straw packing
        const r = rng('straw');
        for (let i = 0; i < 46; i++) {
          mb.push(m4_chain(M, m4_translate(new Vec3(r.range(-0.36, 0.36), 0.09 + r.range(0, 0.03), r.range(-0.24, 0.24))), m4_rot_y(r.range(0, 6.3)), m4_rot_z(r.range(-0.3, 0.3))));
          mb.cube(new Vec3(0, 0, 0), new Vec3(r.range(0.12, 0.22), 0.004, 0.006), hex(r() < 0.5 ? 0xb89a52 : 0xa08442), FLAT);
          mb.pop();
        }
      },
      mouth: [0, 0.56, 0], glint: [0, 0.3, 0],
    };
  },

  'Bin': () => {
    const Wt = 0.6, Dt = 0.72, Wb = 0.52, Db = 0.62, H = 0.98, y0 = 0.05, g = 'y#2f4f33', gi = 'y#16231a';
    return {
      yaw: PI + 0.25, sound: 'plastic',
      body(k) {
        const h = H - y0, tx = Math.atan2((Wt - Wb) / 2, h), tz = Math.atan2((Dt - Db) / 2, h);
        for (const s of [-1, 1]) {
          k.push().at(0, y0 + h / 2, ((Dt + Db) / 4 - 0.01) * s, 0, tz * s); k.box((Wt + Wb) / 2, h, 0.02, g, 0, 0, 0, 0.006); k.pop();
          k.push().at(((Wt + Wb) / 4 - 0.01) * s, y0 + h / 2, 0, 0, 0, -tx * s); k.box(0.02, h, (Dt + Db) / 2 - 0.02, g, 0, 0, 0, 0.006); k.pop();
        }
        k.box(Wb, 0.02, Db, gi, 0, y0 + 0.01, 0, 0.004);
        // top rim, ribs, front lift lip, back wheels on an axle, handle bar at the back
        k.box(Wt + 0.03, 0.035, 0.03, g, 0, H - 0.017, -Dt / 2 - 0.005, 0.008);
        for (const s of [-1, 1]) k.box(0.03, 0.035, Dt + 0.02, g, (Wt / 2 + 0.005) * s, H - 0.017, 0, 0.008);
        for (const s of [-1, 1]) { k.push().at(0, y0 + h / 2, ((Dt + Db) / 4 - 0.01) * s, 0, tz * s); for (const y of [0.35, 0.6]) k.box((Wt + Wb) / 2 - 0.06, 0.03, 0.012, g, 0, y - y0 - h / 2, 0.014 * s, 0.004); k.pop(); }
        k.box(0.3, 0.05, 0.05, g, 0, 0.62, -(Dt + Db) / 4 - 0.03, 0.01);
        k.box(Wb - 0.06, 0.06, 0.1, g, 0, 0.03, -Db / 2 + 0.06, 0.01);
        k.cyl(0.012, Wb + 0.14, 's#5a5e60', 0, 0.1, Db / 2 + 0.03, 8, 'x');
        for (const s of [-1, 1]) { k.cyl(0.1, 0.05, 'y#141414', (Wb / 2 + 0.05) * s, 0.1, Db / 2 + 0.03, 18, 'x'); k.cyl(0.04, 0.055, 'y#3a3a3a', (Wb / 2 + 0.05) * s, 0.1, Db / 2 + 0.03, 10, 'x'); }
        for (const s of [-1, 1]) k.box(0.05, 0.18, 0.06, g, (Wt / 2 - 0.08) * s, H - 0.1, Dt / 2 + 0.02, 0.01);
        k.cyl(0.018, Wt - 0.08, g, 0, H - 0.04, Dt / 2 + 0.06, 10, 'x');
        k.box(0.12, 0.08, 0.002, 'l#d8d4c4', 0.12, 0.7, -(Dt + Db) / 4 - 0.012, 0);
      },
      parts: [{
        hinge: [0, H, Dt / 2 + 0.02], axis: 'x', rest: 0.12, open: 1.95,
        build(k) {
          k.box(Wt + 0.06, 0.03, Dt + 0.06, g, 0, 0.022, -(Dt + 0.06) / 2, 0.01);
          k.box(Wt + 0.06, 0.05, 0.025, g, 0, 0.0, -Dt - 0.05, 0.008);
          for (const s of [-1, 1]) k.box(0.02, 0.04, Dt + 0.04, g, (Wt / 2 + 0.03) * s, 0.0, -(Dt + 0.06) / 2, 0.006);
          k.box(0.2, 0.025, 0.05, g, 0, 0.045, -Dt - 0.02, 0.008);
          for (let i = 0; i < 3; i++) k.box(Wt - 0.1, 0.008, 0.02, g, 0, 0.04, -0.15 - i * 0.2, 0.003);
        },
      }],
      goods: [[-0.1, 0.72, -0.05, 0.4, 0.6, 0.2, 1], [0.1, 0.74, 0.04, 1.6, -0.4, 0.3, 1], [0.0, 0.75, -0.16, 2.6, 0.2, -0.6, 1], [0.14, 0.7, -0.14, 0.9, 1.3, 0, 1]],
      filler(mb, M) {
        // a split black bin bag the goods sit on
        mb.push(m4_chain(M, m4_translate(new Vec3(0, y0 + 0.02, 0)), m4_scale(new Vec3(1.15, 1, 1.4))));
        mb.lathe(new Vec3(0, 0, 0), [[0, 0], [0.18, 0.02], [0.22, 0.25], [0.21, 0.5], [0.17, 0.64], [0.06, 0.7], [0, 0.69]], 12, true, hex(0x18191b), FLAT);
        mb.pop();
      },
      mouth: [0, 1.0, -0.05], glint: [0, 0.88, -0.05],
    };
  },

  'Glovebox': () => {
    // a car glovebox makes no sense on the ground: an olive ammo tin with a clamp lid at that spot (rule name kept)
    const W = 0.31, H = 0.17, D = 0.16, ol = 'm#4d5536', inn = 'm#1e2216';
    return {
      yaw: -0.7, sound: 'metal',
      body(k) {
        k.box(W, 0.01, D, ol, 0, 0.005, 0, 0.003);
        for (const s of [-1, 1]) { k.box(W, H - 0.01, 0.01, ol, 0, 0.01 + (H - 0.01) / 2, (D / 2 - 0.005) * s, 0.003); k.box(0.01, H - 0.01, D - 0.02, ol, (W / 2 - 0.005) * s, 0.01 + (H - 0.01) / 2, 0, 0.003); }
        k.box(W - 0.02, 0.003, D - 0.02, inn, 0, 0.012, 0, 0);
        for (const s of [-1, 1]) for (const y of [0.05, 0.11]) k.box(W + 0.004, 0.012, 0.004, ol, 0, y, (D / 2 + 0.002) * s, 0.002);
        k.box(0.12, 0.018, 0.002, 'l#c8a830', -0.06, 0.08, -D / 2 - 0.003, 0);
        k.box(0.012, 0.07, 0.03, 'm#3a4028', W / 2 + 0.008, H - 0.04, 0, 0.003);
      },
      parts: [{
        hinge: [0, H, D / 2], axis: 'x', rest: 0.06, open: 1.95,
        build(k) {
          k.box(W + 0.01, 0.012, D + 0.008, ol, 0, 0.012, -D / 2, 0.003);
          k.box(W + 0.01, 0.025, 0.008, ol, 0, 0.0, -D - 0.002, 0.002);
          for (const s of [-1, 1]) k.box(0.008, 0.025, D, ol, (W / 2 + 0.003) * s, 0.0, -D / 2, 0.002);
          path(k, [[-0.07, 0.018, -D / 2], [-0.06, 0.05, -D / 2], [0.06, 0.05, -D / 2], [0.07, 0.018, -D / 2]], 0.006, 'm#2e3422', 5, 12);
        },
      }],
      goods: [[-0.07, 0.013, -0.02, 0.4, 0, 0, 0.85], [0.06, 0.013, 0.02, 1.7, 0, 0, 0.85]],
      mouth: [0, 0.2, 0], glint: [0, 0.16, 0],
    };
  },

  'Medical bag': () => {
    const W = 0.46, H = 0.25, D = 0.24, wh = 'f#d6d2c4', red = 'f#b82a22', inn = 'f#3a1a18';
    return {
      yaw: 1.2, sound: 'cloth',
      body(k) {
        k.box(W, 0.02, D, wh, 0, 0.01, 0, 0.006);
        for (const s of [-1, 1]) {
          k.push().at(0, 0.02 + (H - 0.02) / 2, (D / 2 - 0.01) * s, 0, -0.08 * s); k.box(W, H - 0.02, 0.022, wh, 0, 0, 0, 0.01); k.pop();
          k.box(0.022, H - 0.02, D - 0.04, wh, (W / 2 - 0.011) * s, 0.02 + (H - 0.02) / 2, 0, 0.008);
          // red cross on both long sides
          k.push().at(0, 0.13, (D / 2 + 0.003) * s, s > 0 ? 0 : PI, -0.08); k.box(0.12, 0.035, 0.004, red, 0, 0, 0, 0.001); k.box(0.035, 0.12, 0.004, red, 0, 0, 0, 0.001); k.pop();
        }
        k.box(W - 0.05, 0.004, D - 0.06, inn, 0, 0.022, 0, 0);
        // metal frame lips, corner guards, shoulder strap looping out on the ground
        for (const s of [-1, 1]) k.box(W - 0.02, 0.012, 0.012, 's#9a9a96', 0, H - 0.004, (D / 2 - 0.022) * s, 0.003);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.04, 0.03, 0.04, 'f#6a5040', (W / 2 - 0.02) * sx, 0.015, (D / 2 - 0.02) * sz, 0.006);
        path(k, [[-W / 2, 0.2, 0.0], [-W / 2 - 0.04, 0.12, -0.05], [-W / 2 - 0.08, 0.008, -0.16], [-0.1, 0.008, -0.28], [0.15, 0.008, -0.26], [W / 2 + 0.07, 0.008, -0.14], [W / 2 + 0.03, 0.11, -0.04], [W / 2, 0.2, 0.0]], 0.012, 'f#3a3f44', 5, 48);
        for (const s of [-1, 1]) path(k, [[-0.09, H, (D / 2 - 0.03) * s], [-0.05, H + 0.06, (D / 2 - 0.035) * s], [0.05, H + 0.06, (D / 2 - 0.035) * s], [0.09, H, (D / 2 - 0.03) * s]], 0.009, 'f#4a3428', 5, 14);
      },
      parts: [{
        hinge: [0, H, D / 2 - 0.02], axis: 'x', rest: 0.18, open: 2.1,
        build(k) {
          k.box(W - 0.01, 0.016, D - 0.03, wh, 0, 0.008, -(D - 0.03) / 2, 0.006);
          k.box(0.09, 0.004, 0.026, red, 0, 0.018, -(D - 0.03) / 2, 0.001);
          k.box(0.026, 0.004, 0.09, red, 0, 0.018, -(D - 0.03) / 2, 0.001);
          k.box(0.05, 0.02, 0.02, 's#b0b0a8', 0, 0.006, -(D - 0.03) + 0.004, 0.004);
        },
      }],
      goods: [[-0.12, 0.024, -0.03, 0.3, 0, 0, 1], [0.0, 0.024, 0.03, 1.7, 0, 0, 1], [0.12, 0.024, -0.02, 2.6, 0, 0, 1]],
      mouth: [0, 0.3, 0], glint: [0, 0.24, 0],
    };
  },

  'Suitcase': () => {
    const W = 0.72, D = 0.48, Hb = 0.1, Hl = 0.1, sh = 'y#2c3d58', lin = 'f#4a2a30';
    return {
      yaw: -0.25, sound: 'plastic',
      body(k) {
        k.box(W, 0.012, D, sh, 0, 0.006, 0, 0.006);
        for (const s of [-1, 1]) { k.box(W, Hb, 0.014, sh, 0, Hb / 2, (D / 2 - 0.007) * s, 0.006); k.box(0.014, Hb, D - 0.02, sh, (W / 2 - 0.007) * s, Hb / 2, 0, 0.006); }
        k.box(W - 0.03, 0.004, D - 0.03, lin, 0, 0.014, 0, 0);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.05, Hb + 0.004, 0.05, 'y#151515', (W / 2 - 0.02) * sx, Hb / 2, (D / 2 - 0.02) * sz, 0.01);
        k.box(0.16, 0.025, 0.03, 'y#151515', 0, Hb - 0.01, -D / 2 - 0.015, 0.008);
        for (const s of [-1, 1]) k.box(0.03, 0.03, 0.014, 's#9a9a96', 0.22 * s, Hb - 0.01, -D / 2 - 0.005, 0.004);
        k.box(0.08, 0.05, 0.003, 'l#c8b080', -0.2, 0.05, D / 2 + 0.001, 0);
      },
      parts: [{
        hinge: [0, Hb, D / 2], axis: 'x', rest: 0.24, open: PI,
        build(k) {
          k.box(W, 0.012, D, sh, 0, Hl - 0.006, -D / 2, 0.006);
          for (const s of [-1, 1]) { k.box(W, Hl, 0.014, sh, 0, Hl / 2, -D / 2 + (D / 2 - 0.007) * s, 0.006); k.box(0.014, Hl, D - 0.02, sh, (W / 2 - 0.007) * s, Hl / 2, -D / 2, 0.006); }
          for (let i = 0; i < 5; i++) k.box(W - 0.08, 0.008, 0.02, sh, 0, Hl + 0.004, -D / 2 - 0.16 + i * 0.08, 0.004);
          k.box(W - 0.03, 0.004, D - 0.03, lin, 0, Hl - 0.014, -D / 2, 0);
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.05, Hl, 0.05, 'y#151515', (W / 2 - 0.02) * sx, Hl / 2, -D / 2 + (D / 2 - 0.02) * sz, 0.01);
        },
      }],
      goods: [[-0.33, 0.016, -0.12, PI / 2, PI / 2, 0, 1], [-0.33, 0.016, 0.0, PI / 2, PI / 2, 0, 1], [-0.33, 0.016, 0.12, PI / 2, PI / 2, 0, 1], [-0.08, 0.016, -0.12, PI / 2, PI / 2, 0, 1], [-0.08, 0.016, 0.0, PI / 2, PI / 2, 0, 1], [-0.08, 0.016, 0.12, PI / 2, PI / 2, 0, 1], [0.115, 0.016, -0.06, PI / 2, PI / 2, 0, 1], [0.115, 0.016, 0.07, PI / 2, PI / 2, 0, 1]],
      filler(mb, M) {
        // a folded shirt and a towel under the bottles
        mb.push(M); mb.cube(new Vec3(0.12, 0.03, 0.0), new Vec3(0.26, 0.03, 0.36), hex(0x8a8f96), FLAT); mb.cube(new Vec3(-0.15, 0.025, 0.05), new Vec3(0.3, 0.02, 0.3), hex(0x9a3a2e), FLAT); mb.pop();
      },
      liftGoods: 0.04,
      mouth: [0, 0.2, 0], glint: [0, 0.1, 0],
    };
  },
};

// ---------------------------------------------------------------- Đợt 13: containers from the stylized props kit
// D:\stylized-props (code-only three.js r170 kit, copied to js/sp/, same three build as the game). Front faces +z, the
// prop's yaw from the rules (lay.LOOT_SPOTS) turns it away from the wall it leans on. `open`: the kit's own open
// parameters and the value they reach when the search completes (they follow the hold progress like the lids above).
// `tip`: a prop without a lid (backpack) rolls onto its back once searched. h / r: icon height and ground-ring radius.
// Colours muted toward the Saltline palette (the kit default is saturated toy colour).
const KIT = {
  'Locker': { fn: () => SPM.lockersTriple(4, { color: '#5d7378', wear: 0.85 }), open: { doors: 0.8 }, mouth: [0, 1.0, 0.3], glint: [0.25, 1.05, 0.29], h: 1.88, r: 0.78, sound: 'metal' },
  'Fridge': { fn: () => SPM.fridgeYellow(5, { color: '#cfc8b4', wear: 0.9 }), open: { door: 0.75 }, mouth: [0, 0.8, 0.4], glint: [0.12, 0.95, 0.42], h: 1.38, r: 0.6, sound: 'metal' },
  'Tool chest': { fn: () => SPM.toolChestRed(6, { color: '#9c3a30', wear: 0.85 }), open: { drawers: 1, doors: 1 }, mouth: [0, 0.5, 0.35], glint: [0.12, 0.6, 0.32], h: 0.7, r: 0.62, sound: 'metal' },
  'Cabinet': { fn: () => SPM.cabinetYellow(7, { color: '#8b8a5c', wear: 0.85 }), open: { door: 0.85 }, mouth: [0, 0.5, 0.3], glint: [0.06, 0.62, 0.28], h: 0.9, r: 0.48, sound: 'wood' },
  'Safe': { fn: () => SPM.safeSmall(8, { color: '#6f7d84', wear: 0.8 }), open: { door: 0.8 }, mouth: [0, 0.45, 0.3], glint: [0.1, 0.5, 0.26], h: 0.82, r: 0.5, sound: 'metal' },
  'Ammo case': { fn: () => SPM.caseRed(9, { color: '#5a6236', wear: 0.8 }), open: { lid: 0.85 }, mouth: [0, 0.15, 0], glint: [0, 0.13, 0], h: 0.13, r: 0.38, sound: 'plastic' },
  'Trash can': { fn: () => SPD.trashCan(10, { lid: 0, wear: 0.9 }), open: { lid: 1 }, mouth: [0, 0.85, 0], glint: [0.06, 0.86, 0], h: 0.86, r: 0.46, sound: 'metal' },
  'Backpack': { fn: () => SPF.backpackYellow(11, { color: '#8f7a46', wear: 0.95 }), tip: 0.17, mouth: [0, 0.5, 0.1], glint: [0, 0.62, 0.1], h: 0.82, r: 0.46, lift: -0.02, sound: 'cloth' },
  'Supply crate': { fn: () => SPF.tarpCrateGreen(12, { wear: 0.9 }), mouth: [0, 0.65, 0], glint: [0.12, 0.64, 0], h: 0.64, r: 0.82, sound: 'wood' },
};
// icon height / ring radius of the eight hand-built containers above
const DEF_H = { 'Trolley': 0.95, 'Bin': 0.85, 'Crate': 0.62, 'Suitcase': 0.5, 'Medical bag': 0.4, 'Toolbox': 0.4, 'Glovebox': 0.2, 'Duffle bag': 0.32 };
const DEF_R = { 'Trolley': 0.7, 'Crate': 0.62, 'Bin': 0.48 };

// The kit's wear material writes alpha 1; the game keeps an SSR reflectivity mask in alpha (mats.js), so plain materials
// must write 0 (same patch as mats.noMask, own program key so it never shares a program with another noMask shader).
let KM = null;
function kitMats() {
  if (KM) return KM;
  const sh = sharedMaterials(1);
  const mask = (m) => {
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (s, r) => { if (prev) prev(s, r); s.fragmentShader = s.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n gl_FragColor.a = 0.0;'); };
    const k0 = m.customProgramCacheKey ? m.customProgramCacheKey() : 'sp';
    m.customProgramCacheKey = () => k0 + '-nm';
    return m;
  };
  mask(sh.wear);
  // searched look: same shader, colour multiplier (vertex colours x 0.45)
  const dim = mask(createWearMaterial({ quality: 1, color: 0x737373 }));
  KM = { wear: sh.wear, dim };
  return KM;
}
const DIM = new Map();
function dimOf(m) {
  let d = DIM.get(m); if (d) return d;
  if (KM && m === KM.wear) d = KM.dim;
  else if (m && m.userData && m.userData.opts) d = mat(Object.assign({}, m.userData.opts, { color: 0x747474 }));
  else d = m;
  DIM.set(m, d); return d;
}
function setDim(v, on) {
  if (v.dimmed === on) return;
  v.dimmed = on;
  for (const m of v.meshes) {
    if (Array.isArray(m.material)) continue;
    if (!m.userData.mat0) m.userData.mat0 = m.material;
    m.material = on ? dimOf(m.userData.mat0) : m.userData.mat0;
  }
}

// ---------------------------------------------------------------- marker look (Đợt 13: "các vị trí có thể loot được cần
// thể hiện rõ ra"). Unsearched: a warm ring on the ground that breathes slowly, and above the container a round amber
// badge with an open-box glyph, kept at a near-constant size on screen, visible in line of sight up to ~70 m (depth
// tested, so never through walls). Looked at: the ring brightens, the badge hides (the "[hold E] Search ..." prompt takes
// over). Searched: no ring, no badge, no glint, lid / door left open, the container ~45% darker.
let BADGE = null;
function badgeTex() {
  if (BADGE) return BADGE;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(64, 64, 34, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,190,70,0.6)'); gr.addColorStop(1, 'rgba(255,190,70,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  x.beginPath(); x.arc(64, 64, 44, 0, Math.PI * 2); x.fillStyle = '#f4bb3a'; x.fill();
  x.lineWidth = 5; x.strokeStyle = '#1e1404'; x.stroke();
  x.beginPath(); x.arc(64, 64, 39, 0, Math.PI * 2); x.lineWidth = 2; x.strokeStyle = 'rgba(255,240,200,0.8)'; x.stroke();
  // open cardboard box: body and two flaps tipped outward, a slot of light inside
  x.fillStyle = '#1e1404';
  x.fillRect(42, 60, 44, 30);
  x.beginPath(); x.moveTo(42, 60); x.lineTo(28, 44); x.lineTo(54, 44); x.lineTo(64, 60); x.closePath(); x.fill();
  x.beginPath(); x.moveTo(86, 60); x.lineTo(100, 44); x.lineTo(74, 44); x.lineTo(64, 60); x.closePath(); x.fill();
  x.fillStyle = '#f4bb3a'; x.fillRect(57, 67, 14, 5);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  BADGE = t; return t;
}
const RING_GEO = (() => { const g = new THREE.RingGeometry(0.86, 1.0, 48, 1); g.rotateX(-PI / 2); return g; })();
const RING_COL = new THREE.Color(2.1, 1.35, 0.32);
function makeMarkers(G, v) {
  const rm = keepAlpha(new THREE.MeshBasicMaterial({ color: RING_COL, transparent: true, opacity: 0.5, depthWrite: false, fog: true }));
  rm.userData.additive = true; keepAlpha(rm);
  const ring = new THREE.Mesh(RING_GEO, rm); ring.name = 'loot-ring'; ring.renderOrder = 2; ring.castShadow = false; ring.receiveShadow = false;
  ring.scale.setScalar(v.r);
  const sm = keepAlpha(new THREE.SpriteMaterial({ map: badgeTex(), transparent: true, depthWrite: false, depthTest: true, color: new THREE.Color(1.5, 1.5, 1.5), fog: false }));
  const badge = new THREE.Sprite(sm); badge.name = 'loot-badge'; badge.renderOrder = 3;
  G.scene.add(ring); G.scene.add(badge);
  v.ring = ring; v.badge = badge;
}

// ---------------------------------------------------------------- loot plug-in state
const S = { views: new Map(), goodsNode: null, goodsSig: '', fly: [], glint: null, meshCache: new Map(), events: 0, collected: 0, maxFly: 0 };
const CAP_FLY = 48;
const yawOf = (p, v) => (v.d.yaw || 0) + (p.yaw || 0);

function buildView(G, p) {
  const name = p.kind.a;
  const root = new THREE.Group(); root.name = 'loot:' + name; root.userData.loot = name;
  const shake = new THREE.Group(); root.add(shake);
  const kd = KIT[name];
  const parts = [];
  let d, kit = null;
  const meshes = [];
  if (kd) {
    kitMats();
    kit = kd.fn();
    kit.position.y = kd.lift || 0;
    kit.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    shake.add(kit);
    d = { yaw: 0, sound: kd.sound, goods: [], mouth: kd.mouth, glint: kd.glint };
  } else {
    d = (DEFS[name] || DEFS['Crate'])();
    const kb = new VKit(resolve);
    d.body(kb);
    const body = kb.build(material, {}); body.name = 'loot-body:' + name; shake.add(body);
    for (const pd of d.parts || []) {
      const pivot = new THREE.Group(); pivot.position.set(pd.hinge[0], pd.hinge[1], pd.hinge[2]);
      const k = new VKit(resolve); k.ground = -pd.hinge[1];
      pd.build(k);
      const g = k.build(material, {}); g.name = 'loot-lid:' + name;
      pivot.add(g); shake.add(pivot);
      parts.push({ d: pd, pivot });
    }
  }
  root.traverse((o) => { if (o.isMesh) meshes.push(o); });
  G.scene.add(root);
  const v = { id: p.id, name, d, kd, root, shake, parts, kit, meshes, h: kd ? kd.h : (DEF_H[name] || 0.45), r: kd ? kd.r : (DEF_R[name] || 0.55),
    open: 0, shakeK: 0, seed: (p.id * 7919) % 97, rumble: 0, dimmed: false, kitT: -1 };
  makeMarkers(G, v);
  return v;
}
function poseParts(v, t) {
  if (v.kit) {
    if (Math.abs(t - v.kitT) < 1e-3) return;
    v.kitT = t;
    const set = v.kit.userData.set;
    for (const [k, val] of Object.entries(v.kd.open || {})) if (set) set(k, val * t);
    if (v.kd.tip) { v.kit.rotation.x = -PI / 2 * t; v.kit.position.y = (v.kd.lift || 0) + v.kd.tip * t; }
    return;
  }
  for (const p of v.parts) {
    const pd = p.d, o = p.pivot;
    if (pd.pose) { pd.pose(o, t); continue; }
    const a = pd.rest + (pd.open - pd.rest) * t;
    o.position.set(pd.hinge[0], pd.hinge[1], pd.hinge[2]);
    if (pd.axis === 'z') o.rotation.set(0, 0, a); else o.rotation.set(a, 0, 0);
  }
}

// world matrix (rules MB convention) of a container-local transform
function localM(prop, v, x, y, z) { return m4_chain(m4_translate(prop.pos), m4_rot_y(yawOf(prop, v)), m4_translate(new Vec3(x, y, z))); }
function rebuildGoods(G, caches) {
  const mb = new MB(); mb.bevel = 0.004;
  for (const p of caches) {
    if (p.kind.c !== false) continue;
    const v = S.views.get(p.id); if (!v) continue;
    const d = v.d, its = p.kind.b || [];
    if (d.filler) d.filler(mb, localM(p, v, 0, 0, 0));
    const lift = d.liftGoods || 0;
    for (let i = 0; i < its.length && i < d.goods.length; i++) {
      const [x, y, z, ry, rx, rz, s] = d.goods[i];
      mb.push(m4_chain(localM(p, v, x, y + lift, z), m4_rot_y(ry), m4_rot_x(rx), m4_rot_z(rz), m4_scale(s)));
      world.item_geo(mb, its[i], new Vec3(0, 0, 0), 1);
      mb.pop();
    }
  }
  if (mb.is_empty && mb.is_empty()) mb.cube(new Vec3(0, -5, 0), new Vec3(0.01, 0.01, 0.01), [0, 0, 0], FLAT);
  const mesh = mb.build();
  if (!S.goodsNode) S.goodsNode = G.sg.spawn(mesh, 'solid', { name: 'loot-goods' });
  else S.goodsNode.set_mesh(mesh);
}

function itemMesh(i) {
  let m = S.meshCache.get(i);
  if (!m) { const mb = new MB(); mb.bevel = 0.004; world.item_geo(mb, i, new Vec3(0, -0.06, 0), 1.15); m = mb.build(); S.meshCache.set(i, m); }
  return m;
}
function play(name, vol, pos) { try { audio.play(name, vol, pos); } catch (e) { /* sound is optional */ } }

function spawnBurst(G, ev, v, p) {
  const g = G.g;
  const yaw = v && p ? yawOf(p, v) : 0;
  const m = v ? v.d.mouth : [0, 0.5, 0];
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const base = new Vec3(ev.pos.x + m[0] * c + m[2] * s, ev.pos.y + m[1], ev.pos.z - m[0] * s + m[2] * c);
  // throw away from the container, biased toward the player so the items land in view
  const toP = Math.atan2(g.player.x - ev.pos.x, g.player.z - ev.pos.z);
  const r = rng('burst' + S.events);
  ev.items.forEach((it, k) => {
    if (S.fly.length >= CAP_FLY) { feed(G, it); return; }
    // alternate left / right of the line to the player so they land beside the container, in view
    const a = toP + (k % 2 ? 1 : -1) * r.range(0.7, 1.5), sp = r.range(0.8, 1.4);
    S.fly.push({
      it, node: null, delay: 0.25 + k * r.range(0.15, 0.25), t: 0, state: 'wait',
      p: base.clone(), v: new Vec3(Math.sin(a) * sp, r.range(2.6, 3.3), Math.cos(a) * sp),
      q: new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 6, r() * 6, r() * 6)), w: new THREE.Vector3(r.range(-9, 9), r.range(-6, 6), r.range(-9, 9)),
      ground: ev.pos.y, bounces: 0, rest: r.range(0.45, 0.7), center: ev.pos.clone(), cr: v ? Math.max(0.5, v.r * 0.8) : 0.5,
    });
  });
  S.maxFly = Math.max(S.maxFly, S.fly.length);
}
function feed(G, it) { S.collected++; try { if (G.hud && G.hud.loot_feed) G.hud.loot_feed(it, 1); } catch (e) { /* HUD optional */ } }

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _w = new THREE.Vector3();
function stepFly(G, dt) {
  const g = G.g, cam = G.camera.position;
  for (let i = S.fly.length - 1; i >= 0; i--) {
    const f = S.fly[i];
    f.t += dt;
    if (f.state === 'wait') {
      if (f.t < f.delay) continue;
      f.state = 'air'; f.t = 0;
      f.node = G.sg.spawn(itemMesh(f.it), 'solid', { pos: f.p.clone(), quat: [f.q.x, f.q.y, f.q.z, f.q.w], name: 'loot-fly', dynamic: true });
      play('swish', 0.35, f.p.clone());
    }
    if (f.state === 'air') {
      f.v.y -= 9.8 * dt;
      f.p.x += f.v.x * dt; f.p.y += f.v.y * dt; f.p.z += f.v.z * dt;
      // never into walls, never back into the container
      const dx = f.p.x - f.center.x, dz = f.p.z - f.center.z, dl = Math.hypot(dx, dz);
      if (f.p.y < f.ground + 2.0 && dl < f.cr) { f.p.x = f.center.x + dx / (dl || 1) * f.cr; f.p.z = f.center.z + dz / (dl || 1) * f.cr; }
      try { const r = world.resolve(g, f.p, 0.1); if (Math.abs(r.x - f.p.x) + Math.abs(r.z - f.p.z) > 1e-4) { f.v.x *= -0.4; f.v.z *= -0.4; f.p.x = r.x; f.p.z = r.z; } } catch (e) { /* keep flying */ }
      _w.copy(f.w).multiplyScalar(dt); _q.setFromEuler(_e.set(_w.x, _w.y, _w.z)); f.q.premultiply(_q);
      if (f.p.y <= f.ground + 0.06 && f.v.y < 0) {
        f.p.y = f.ground + 0.06;
        f.bounces++;
        play(f.bounces === 1 ? 'tink' : 'thud', f.bounces === 1 ? 0.45 : 0.25, f.p.clone());
        f.v.y = -f.v.y * 0.38; f.v.x *= 0.55; f.v.z *= 0.55; f.w.multiplyScalar(0.5);
        if (f.bounces >= 3 || Math.abs(f.v.y) < 0.55) {
          f.state = 'rest'; f.t = 0;
          // settle lying on its side
          const yaw = Math.atan2(f.v.x, f.v.z) + f.bounces;
          f.qr = new THREE.Quaternion().setFromEuler(new THREE.Euler(PI / 2, yaw, 0, 'YXZ'));
        }
      }
    } else if (f.state === 'rest') {
      f.q.slerp(f.qr, Math.min(1, dt * 12));
      if (f.t > f.rest) { f.state = 'home'; f.t = 0; }
    } else if (f.state === 'home') {
      const tx = cam.x, ty = cam.y - 0.45, tz = cam.z;
      const k = Math.min(1, dt * (3 + f.t * 14));
      f.p.x += (tx - f.p.x) * k; f.p.y += (ty - f.p.y) * k + Math.sin(Math.min(1, f.t * 3) * PI) * 0.6 * dt * 4; f.p.z += (tz - f.p.z) * k;
      const sc = Math.max(0.35, 1 - f.t * 1.2);
      f.node.set_scale(sc);
      if (Math.hypot(tx - f.p.x, ty - f.p.y, tz - f.p.z) < 0.45 || f.t > 2.5) {
        play('pick', 0.55, null);
        feed(G, f.it);
        f.node.despawn(); S.fly.splice(i, 1); continue;
      }
    }
    if (f.node) f.node.set_tr({ pos: f.p, quat: [f.q.x, f.q.y, f.q.z, f.q.w] });
  }
}

// ?markers=0 hides the ring and badge (the look of the previous build, for comparison shots)
const MARKERS = !/[?&]markers=0\b/.test(typeof location !== 'undefined' ? location.search : '');

export async function install(G) {
  const t0 = performance.now();
  globalThis.__twtLootView = true;
  const g = G.g;
  const caches = () => g.props.filter((p) => !p.dead && p.kind.k === 'Cache');
  for (const p of caches()) { if (!S.views.has(p.id)) S.views.set(p.id, buildView(G, p)); p.dirty = true; }
  // glints: one instanced star per container, twinkling while it still holds goods
  const gm = noMask(new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 7.5, 4.5) }));
  const glint = S.glint = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.018, 0), gm, Math.max(1, S.views.size + 8));
  glint.name = 'loot-glint'; glint.castShadow = false; glint.receiveShadow = false; glint.frustumCulled = false;
  G.scene.add(glint);
  const M = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), SC = new THREE.Vector3();
  const ZM = new THREE.Matrix4().makeScale(0, 0, 0);
  S.markerStats = [];

  G.updaters.push(['loot', (dt, t) => {
    const list = caches();
    // state signature: which containers hold what -> rebuild the goods mesh only when it changes
    let sig = '';
    for (const p of list) {
      if (!S.views.has(p.id)) S.views.set(p.id, buildView(G, p));
      sig += p.id + (p.kind.c ? '1' : '0' + (p.kind.b || []).join(',')) + ';';
    }
    if (sig !== S.goodsSig) { S.goodsSig = sig; rebuildGoods(G, list); }
    // loot events from the rules (finish_hold): drain every frame, up to 16 can arrive at once
    const evs = g.loot_events;
    if (evs && evs.length) {
      for (const ev of evs.splice(0)) {
        S.events++;
        const v = S.views.get(ev.id), p = list.find((q) => q.id === ev.id);
        if (v) { v.burstT = 0; v.rumble = 0; play(v.d.sound === 'cloth' ? 'swish' : 'lid', 0.6, ev.pos.clone ? ev.pos.clone() : null); }
        spawnBurst(G, ev, v, p);
      }
    }
    const cam = G.camera.position;
    const playing = g.mode === 'Play' && (g.cine === null || g.cine === undefined) && MARKERS;
    const stats = S.markerStats; stats.length = 0;
    let gi = 0;
    for (const p of list) {
      const v = S.views.get(p.id); if (!v) continue;
      const yaw = yawOf(p, v);
      v.root.position.set(p.pos.x, p.pos.y, p.pos.z); v.root.rotation.y = yaw;
      const searched = p.kind.c === true;
      let prog = 0;
      if (!searched && g.hold_id === p.id && g.hold_t > 0) {
        const need = player.hold_time(g, { k: 'Prop', a: p.id });
        prog = need > 0 ? clamp(g.hold_t / need, 0, 1) : 0;
      }
      const goal = searched ? 1 : prog * 0.92;
      const rate = searched ? 3.5 : prog > 0 ? 9 : 5;
      v.open += (goal - v.open) * Math.min(1, dt * rate);
      poseParts(v, ease(v.open) * 0.15 + v.open * 0.85);
      setDim(v, searched && v.open > 0.6);
      // rummage: shake and periodic cloth / metal sounds while held
      const rummaging = prog > 0 && !searched;
      v.shakeK += ((rummaging ? 1 : 0) - v.shakeK) * Math.min(1, dt * 10);
      const sk = v.shakeK * (v.d.sound === 'cloth' ? 0.02 : v.kit ? 0.006 : 0.012);
      v.shake.rotation.set(Math.sin(t * 37 + v.seed) * sk, Math.sin(t * 23 + v.seed) * sk * 0.6, Math.sin(t * 31 + v.seed * 2) * sk);
      v.shake.position.y = Math.max(0, Math.sin(t * 29 + v.seed)) * v.shakeK * 0.004;
      if (rummaging) {
        v.rumble -= dt;
        if (v.rumble <= 0) {
          v.rumble = 0.38 + ((t * 7.3 + v.seed) % 1) * 0.25;
          const snd = v.d.sound === 'cloth' ? 'trash' : v.d.sound === 'wood' ? 'wood' : 'scrape';
          play(snd, v.d.sound === 'wood' ? 0.25 : 0.35, p.pos.clone());
          if (v.d.sound !== 'cloth' && ((t * 3.1 + v.seed) % 1) < 0.4) play('tink', 0.2, p.pos.clone());
        }
      }
      // markers
      const dist = Math.hypot(cam.x - p.pos.x, cam.y - p.pos.y - v.h, cam.z - p.pos.z);
      const looked = g.look_id === p.id;
      const show = playing && !searched;
      const ringOn = show && dist < 32;
      v.ring.visible = ringOn;
      if (ringOn) {
        const br = 0.5 + 0.5 * Math.sin(t * 2.2 + v.seed);
        v.ring.position.set(p.pos.x, p.pos.y + 0.05, p.pos.z);
        v.ring.scale.setScalar(v.r * (looked ? 1.06 : 1 + br * 0.05));
        v.ring.material.opacity = looked || prog > 0 ? 0.95 : (0.32 + 0.22 * br) * clamp((32 - dist) / 6, 0, 1);
      }
      const badgeOn = show && !looked && prog === 0 && dist > 2.2 && dist < 70;
      v.badge.visible = badgeOn;
      if (badgeOn) {
        const s = clamp(dist * 0.042, 0.34, 2.2);
        v.badge.position.set(p.pos.x, p.pos.y + v.h + 0.22 + s * 0.5 + Math.sin(t * 1.6 + v.seed) * 0.04, p.pos.z);
        v.badge.scale.set(s, s, 1);
        v.badge.material.opacity = clamp((70 - dist) / 15, 0, 1) * clamp((dist - 2.2) / 1.2, 0, 1);
      }
      stats.push({ id: p.id, name: v.name, searched, dist: +dist.toFixed(1), ring: ringOn, badge: badgeOn, looked, dim: v.dimmed });
      // glint
      if (gi < glint.count) {
        if (!searched) {
          const ph = (t * 0.45 + v.seed * 0.137) % 1, tw = ph < 0.12 ? Math.sin(ph / 0.12 * PI) : 0;
          const gp = v.d.glint, c = Math.cos(yaw), s = Math.sin(yaw);
          P.set(p.pos.x + gp[0] * c + gp[2] * s, p.pos.y + gp[1], p.pos.z - gp[0] * s + gp[2] * c);
          Q.setFromEuler(_e.set(0, t * 2, PI / 4));
          SC.setScalar(0.2 + tw * 1.4);
          M.compose(P, Q, SC); glint.setMatrixAt(gi, M);
        } else glint.setMatrixAt(gi, ZM);
        gi++;
      }
    }
    for (; gi < glint.count; gi++) glint.setMatrixAt(gi, ZM);
    glint.instanceMatrix.needsUpdate = true;
    stepFly(G, dt);
  }]);
  // verification hooks for tools
  window.__loot = {
    S, views: () => [...S.views.values()].map((v) => ({ id: v.id, name: v.name, open: +v.open.toFixed(3), dim: v.dimmed })),
    fly: () => S.fly.map((f) => ({ it: f.it, state: f.state, y: +f.p.y.toFixed(2) })),
    markers: () => S.markerStats.slice(),
  };
  return { containers: S.views.size, ms: Math.round(performance.now() - t0) };
}
