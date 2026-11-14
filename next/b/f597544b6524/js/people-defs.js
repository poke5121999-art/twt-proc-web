// Character definitions for The Walking Trade (procedural): every living human and every zombie, composed from the
// Lanternfall character kit (Lanternfall by loktar00, github.com/loktar00/lanternfall @ ada0fd5, ported into lib/lf/).
// Original designs: ordinary worn-down townsfolk, hired staff, survivors and the infected. Nothing here copies the
// look of the original game's characters.
//
// A def is { key, build() -> Figure, style, scale, female, kind, hidden: [bone names hidden by default] }.
// Built once per key (people.js keeps prototypes) and instanced; per-instance toggles use Figure.hideB on spare bones:
//   'lan'  (abs, swings like a pendulum from the left hand)   shopping basket          (customers)
//   'lanB' (abs, on the back bone, pivot moved to the belly)  carried crate            (cine CARRY)
//   'wR'   (right weapon bone)                                bat / pipe               (staff on Security)
//   'arw'  (spare)                                             not used
//   'lFore' / 'rFore'                                          missing forearm (zombies, by seed)
import {
  C, mixC, PI, TAU, lerp, clamp, smooth, jb, chainY, HW, COL, stance, mkClip, rdy, DOWN_POSE,
  T_SKIN, T_CLOTH, T_QUILT, T_LEATHER, T_PLATE, T_FUR, T_WOOD, T_PEAT, T_GLOW, T_BONE, T_MAIL,
  variety, start, finish, frontZ, patch, capShell, inHand, rbox, style,
} from '../lib/theme-kit.js';

const gau = (v) => Math.exp(-v * v);
const both = (fn) => { fn(1); fn(-1); };
const H = HW;

/* ------------------------------------------------------------------ palettes (linear, from sRGB hex) */
const SKINS = [0xc09a80, 0xb08a70, 0xa47c62, 0x9a7056, 0x8a6248, 0x6e4c38, 0x5a3e2e].map(C);
const HAIRS = [0x2a2018, 0x1a1512, 0x4a3420, 0x6a4a2a, 0x8a7050, 0x6a665e, 0x3a2a20, 0x5a2a18, 0x9a9488].map(C);
const TOPS = [0x3d4a5a, 0x5a3a32, 0x4a5a3c, 0x6a6458, 0x2a2c30, 0x7a6a4a, 0x3a5a5a, 0x5c5450, 0x8a8478, 0x6a3a2a, 0x4a4060, 0x7a7a70].map(C);
const JACKETS = [0x3a3226, 0x2a2e34, 0x4a4a3a, 0x5a4a38, 0x23272c, 0x6a5a40, 0x4a2a24, 0x3a4048].map(C);
const PANTS = [0x2e3a4c, 0x3a4658, 0x25303e, 0x3a3a34, 0x5a5444, 0x2a2a2c, 0x55555a, 0x4a3e30].map(C);
const SHOES = [0x2a2622, 0x3a2a1e, 0x1c1c1e, 0x6a6660, 0x4a3a2a, 0x8a8a84].map(C);
const ACCENT = [0x8a2a22, 0x2a5a8a, 0xb08a2a, 0x3a6a3a, 0x6a3a6a, 0x9a5a2a].map(C);

/* ------------------------------------------------------------------ torso profile (Lanternfall TP table, src/20-human.js:23)
   copied as data so every torso layer can carry the same female shaping (bust, waist, hips, narrower shoulders). */
const TP = [[0.90, 0.168, 0.105, 0.115, 2.3], [0.98, 0.172, 0.11, 0.12, 2.3], [1.045, 0.152, 0.103, 0.102, 2.2], [1.1, 0.153, 0.105, 0.1, 2.2], [1.17, 0.162, 0.112, 0.1, 2.2], [1.27, 0.182, 0.125, 0.11, 2.3], [1.37, 0.198, 0.122, 0.112, 2.4], [1.44, 0.19, 0.105, 0.105, 2.5], [1.49, 0.11, 0.075, 0.085, 2.2], [1.525, 0.062, 0.06, 0.066, 2.0]];
function samp(y) {
  if (y <= TP[0][0]) return TP[0]; const n = TP.length; if (y >= TP[n - 1][0]) return TP[n - 1];
  for (let i = 0; i < n - 1; i++) { const a = TP[i], b = TP[i + 1]; if (y <= b[0]) { const t = (y - a[0]) / (b[0] - a[0]); return a.map((v, k) => lerp(v, b[k], t)); } }
  return TP[n - 1];
}
function span(y0, y1) { const out = [samp(y0).slice()]; out[0][0] = y0; for (const r of TP) if (r[0] > y0 + 0.012 && r[0] < y1 - 0.012) out.push(r); const l = samp(y1).slice(); l[0] = y1; out.push(l); return out; }
const BL = (y) => smooth(1.04, 1.1, y) * smooth(1.3, 1.13, y);
// o: grow, k, kz, y0, y1, fem (0..1), bust, belly, blouse, arc, thick, wr/wra/wry, seg, bone, cap1
function torso(g, o) {
  const f = o.fem || 0, k = o.k || 1, kz = o.kz || 1, gr = o.grow || 0, bl = o.blouse || 0, be = o.belly || 0, bu = (o.bust === undefined ? 0.03 : o.bust) * f;
  const rows = span(o.y0 || 0.9, o.y1 || 1.525), rings = [];
  for (const r of rows) {
    const y = r[0];
    const sh = 1 - f * 0.1 * smooth(1.3, 1.42, y);                    // narrower shoulders
    const wa = 1 - f * 0.1 * gau(((y - 1.08) / 0.07));    // waist
    const hi = 1 + f * 0.08 * gau(((y - 0.95) / 0.07));    // hips
    const bust = bu * gau(((y - 1.3) / 0.055));
    const belly = be * smooth(0.28, 0, Math.abs(y - 1.1));
    rings.push({ y, rx: r[1] * k * sh * wa * hi + gr + bl * BL(y), rz: r[2] * kz * wa + gr + bust + belly + 1.2 * bl * BL(y), rb: r[3] * kz * hi + gr + bl * BL(y) + f * 0.012 * gau(((y - 0.95) / 0.06)), sq: r[4] });
  }
  g.bone(o.bone || H.TW);
  g.loft(rings, { seg: o.seg || 18, sub: 3, arc: o.arc, thick: o.thick, wr: o.wr, wra: o.wra, wry: o.wry, cap1: o.cap1 });
}
// outer half-depth of the torso layer at height y (front), for placing pockets and badges without a vertex search
function torsoFront(y, o) { const r = samp(y), f = o.fem || 0; return r[2] * (o.kz || 1) + (o.grow || 0) + (o.bust === undefined ? 0.03 : o.bust) * f * gau(((y - 1.3) / 0.055)) + (o.belly || 0) * smooth(0.28, 0, Math.abs(y - 1.1)); }

/* ------------------------------------------------------------------ head and face
   The kit head (src/20-human.js:121-139) is a restrained sculpt meant to sit under helmets and hoods. Customers face the
   shopkeeper across a counter, so this head adds real eyes (white, iris, upper lid), eyebrows, ears, lips and nostrils,
   a female jaw, and zombie variants (sunken sockets, glowing pupils, dropped jaw with teeth). */
function head(g, o) {
  const sk = o.skin, fem = !!o.female, jk = fem ? 0.9 : (o.jaw || 1), zb = !!o.zombie, hairC = o.hair || COL.hair, sc = o.headK || 1;
  if (sc !== 1) { g.tr(0, 1.56, 0.0); g.tr(0, 0, 0, 0, 0, 0, sc); g.tr(0, -1.56, 0); }
  g.bone(jb('head', 'neck', 1.56, 0.02)); g.mat(sk, 0.62, 0, T_SKIN, 0.25);
  g.lathe([[0.05 * (fem ? 0.86 : 1) * (o.neckK || 1), 1.47], [0.048 * (fem ? 0.84 : 1) * (o.neckK || 1), 1.53], [0.052, 1.585]], 10);
  g.bone('head');
  const cheek = zb ? 0.9 : 1, jaw = zb ? (o.jawDrop || 0.012) : 0;
  g.loft([
    { y: 1.548 - jaw, rx: 0.038 * jk, rz: 0.058, rb: 0.04, z: 0.012 + jaw * 0.3 },
    { y: 1.575 - jaw * 0.6, rx: 0.057 * jk, rz: 0.082, rb: 0.066, z: 0.008 },
    { y: 1.62, rx: 0.07 * (fem ? 0.95 : 1) * cheek, rz: 0.093, rb: 0.084, z: 0.004 },
    { y: 1.675, rx: 0.076, rz: 0.097, rb: 0.094 }, { y: 1.72, rx: 0.078, rz: 0.1, rb: 0.1 }, { y: 1.765, rx: 0.071, rz: 0.09, rb: 0.096 },
    { y: 1.795, rx: 0.046, rz: 0.06, rb: 0.066 }, { y: 1.806, rx: 0.012, rz: 0.016, rb: 0.016 }], { seg: 18, sub: 3, cap0: true, cap1: true });
  // nose
  const nk = (fem ? 0.78 : 0.9) * (o.noseK || 1);
  g.loft([{ y: 1.65, rx: 0.017 * nk, rz: 0.025, rb: 0.01, z: 0.092 }, { y: 1.668, rx: 0.014 * nk, rz: 0.025 * (zb ? 0.8 : 1), rb: 0.01, z: 0.092 }, { y: 1.7, rx: 0.01 * nk, rz: 0.016, rb: 0.01, z: 0.09 }, { y: 1.722, rx: 0.011, rz: 0.012, rb: 0.01, z: 0.09 }], { seg: 8, sub: 2, cap0: true });
  // brow ridge, cheekbones
  g.tr(0, 1.722, 0.086); g.sphere(0.062, fem ? 0.01 : 0.012, fem ? 0.019 : 0.022, 12, 5); g.pop();
  // ears
  for (const s of [-1, 1]) {
    g.mat(sk, 0.62, 0, T_SKIN, 0.25); g.tr(s * 0.076, 1.682, -0.008, 0.12, s * 0.3, 0); g.sphere(0.012, 0.029, 0.02, 8, 6); g.pop();
    g.mat(mixC(sk, [0.05, 0.02, 0.015], 0.45), 0.6, 0, T_SKIN, 0.2); g.tr(s * 0.084, 1.682, -0.004, 0.12, s * 0.3, 0); g.sphere(0.006, 0.019, 0.012, 6, 4); g.pop();
  }
  const dark = mixC(sk, [0.02, 0.012, 0.01], 0.55);
  // eye sockets: a darker shade under the brow, eyeball (white), iris, upper lid
  for (const s of [-1, 1]) {
    const x = s * 0.031;
    g.mat(zb ? mixC(sk, [0.03, 0.01, 0.01], 0.75) : dark, 0.55, 0, T_SKIN, 0.1); g.tr(x, 1.699, 0.084); g.sphere(zb ? 0.02 : 0.018, zb ? 0.014 : 0.011, 0.008, 10, 6); g.pop();
    if (zb) { // clouded eye with a pale glowing pupil
      g.mat(C(0x8a8a70), 0.3, 0, T_SKIN, 0); g.tr(x, 1.698, 0.086); g.sphere(0.0098, 0.0098, 0.0092, 10, 7); g.pop();
      g.mat(o.eyeGlow || C(0xe8f0b0), 0.3, 0, T_GLOW, o.glowK || 1.6); g.tr(x, 1.698, 0.0948); g.sphere(0.0042, 0.0042, 0.0016, 8, 4); g.pop();
    } else {
      g.mat(C(0x9e968a), 0.25, 0, T_SKIN, 0); g.tr(x, 1.699, 0.0878); g.sphere(0.0108, 0.0102, 0.0095, 10, 7); g.pop();
      g.mat(o.eye || C(0x2a1a10), 0.2, 0, T_SKIN, 0); g.tr(x, 1.6985, 0.0968); g.sphere(0.0058, 0.0062, 0.0022, 10, 5); g.pop();
      g.mat(C(0x050404), 0.1, 0, T_SKIN, 0); g.tr(x, 1.6985, 0.0986); g.sphere(0.0024, 0.0026, 0.0008, 6, 3); g.pop();
      g.mat(sk, 0.6, 0, T_SKIN, 0.2); g.tr(x, 1.7042, 0.0878, -0.15, 0, 0); g.sphere(0.0124, 0.0066, 0.0108, 10, 5); g.pop();   // upper lid
      if (fem) { g.mat(C(0x120c0a), 0.6, 0, T_FUR, 0.1); g.tr(x + s * 0.004, 1.7065, 0.096, -0.1, 0, -s * 0.12); g.sphere(0.0118, 0.0018, 0.0035, 8, 3); g.pop(); }
      g.mat(mixC(sk, [0.03, 0.015, 0.01], 0.25), 0.6, 0, T_SKIN, 0.2); g.tr(x, 1.6905, 0.0868); g.sphere(0.0118, 0.0048, 0.0086, 8, 4); g.pop(); // lower lid / bag
    }
    // eyebrows
    g.mat(zb ? mixC(hairC, sk, 0.5) : hairC, 0.95, 0, T_FUR, 0.1);
    const by = fem ? 1.727 : 1.723, bz = (t) => 0.086 + (fem ? 0.019 : 0.022) * Math.sqrt(Math.max(0, 1 - ((0.016 + t * 0.034) / 0.062) ** 2)) + 0.002;
    g.tube([[s * 0.014, by - 0.001, bz(0)], [s * 0.031, by + (fem ? 0.004 : 0.002), bz(0.5)], [s * 0.05, by - (fem ? 0.002 : 0.001), bz(1)]], (t) => (fem ? 0.0026 : 0.0036) * (1 - 0.45 * t), { seg: 5, sub: 2, flatten: 0.5 });
  }
  // nostrils
  g.mat(dark, 0.6, 0, T_SKIN, 0); for (const s of [-1, 1]) { g.tr(s * 0.0085 * nk, 1.647, 0.111); g.sphere(0.0042, 0.0028, 0.004, 6, 3); g.pop(); }
  // mouth
  if (zb) {
    g.mat(C(0x1a0806), 0.9, 0, T_SKIN, 0); g.tr(0, 1.594 - jaw * 0.5, 0.088); g.sphere(0.024, 0.016 + jaw * 0.5, 0.012, 10, 6); g.pop();
    g.mat(C(0x8a8064), 0.5, 0, T_BONE, 0.3);
    for (let k = 0; k < 6; k++) { const x = -0.0125 + k * 0.005; g.tr(x, 1.607, 0.094 - Math.abs(x) * 0.25); g.sphere(0.0026, 0.004, 0.0022, 4, 3); g.pop(); g.tr(x, 1.581 - jaw, 0.093 - Math.abs(x) * 0.25); g.sphere(0.0024, 0.0036, 0.002, 4, 3); g.pop(); }
    g.mat(mixC(sk, [0.12, 0.03, 0.03], 0.5), 0.7, 0, T_SKIN, 0.2); g.tr(0, 1.612, 0.09); g.sphere(0.022, 0.0035, 0.008, 8, 4); g.pop();
  } else {
    const lip = mixC(sk, [0.32, 0.1, 0.09], fem ? 0.38 : 0.22);
    g.mat(lip, 0.5, 0, T_SKIN, 0.1);
    g.tr(0, 1.6168, 0.0905); g.sphere(fem ? 0.019 : 0.021, 0.0042, 0.0082, 10, 5); g.pop();
    g.tr(0, 1.6072, 0.0895); g.sphere(fem ? 0.017 : 0.018, fem ? 0.0058 : 0.0048, 0.0084, 10, 5); g.pop();
    g.mat(C(0x1a0e0c), 0.6, 0, T_SKIN, 0); g.tr(0, 1.6122, 0.0948); g.sphere(0.0195, 0.0013, 0.0052, 8, 3); g.pop();
  }
  // beard / stubble
  if (o.beard) {
    const b = o.beard; g.mat(o.stubble ? mixC(sk, hairC, 0.55) : hairC, 0.95, 0, o.stubble ? T_SKIN : T_FUR, 0.2);
    const gr = o.stubble ? -0.004 : 0;
    g.loft([{ y: 1.555 - b * 0.06, rx: 0.02, rz: 0.03 + gr, rb: 0.0, z: 0.05 }, { y: 1.565 - b * 0.03, rx: 0.052 + gr, rz: 0.062 + gr, rb: 0.01, z: 0.036 }, { y: 1.6, rx: 0.073 + gr, rz: 0.098 + gr, rb: 0.03, z: 0.004 }, { y: 1.64, rx: 0.077 + gr, rz: 0.098 + gr, rb: 0.03, z: 0.002 }, { y: 1.665, rx: 0.078 + gr, rz: 0.084, rb: 0.03 }], { seg: 14, sub: 3, arc: [-0.25, PI + 0.25], cap0: true });
    if (!o.stubble) { g.tr(0, 1.628, 0.096); g.sphere(0.03, 0.009, 0.012, 8, 4); g.pop(); }
  }
  if (sc !== 1) { g.pop(); g.pop(); g.pop(); }
}

// hair styles (all T_FUR, built on the head bone; long hair hangs on a head-neck-chest chain)
const HAIR_W = chainY([['head', 9], ['neck', 1.555], ['chest', 1.47]], 0.03);
function hairCap(g, col, o = {}) {
  const t = o.thin || 0, hl = o.line || 1.758, gr = o.grow || 0, wr = o.wr || 0.02;
  g.bone('head'); g.mat(col, 0.92, 0, T_FUR, 0.2);
  if (!o.noTop) // dome above the hairline; its front edge sits just outside the forehead
    g.loft([{ y: hl - 0.006, rx: 0.081 + gr - t, rz: 0.098 + gr * 0.5 - t, rb: 0.106 + gr - t }, { y: 1.772, rx: 0.077 + gr - t, rz: 0.096 + gr * 0.7 - t, rb: 0.102 + gr - t }, { y: 1.792, rx: 0.062 + gr - t, rz: 0.08 + gr - t, rb: 0.088 + gr - t },
      { y: 1.81 + gr * 0.5, rx: 0.036 + gr * 0.5, rz: 0.04 + gr * 0.5, rb: 0.046 + gr * 0.5 }, { y: 1.818 + gr * 0.6, rx: 0.004, rz: 0.004, rb: 0.004 }], { seg: 18, sub: 3, cap1: true, wr, wra: 6, wry: 40 });
  // sides and back below the hairline: follows the skull and thins to nothing at the temples, so it melts into the skin
  const SK = [[1.62, 0.07, 0.093, 0.084], [1.675, 0.076, 0.097, 0.094], [1.72, 0.078, 0.1, 0.1], [1.765, 0.071, 0.09, 0.096]];
  const sk = (y) => { let i = 0; while (i < SK.length - 2 && y > SK[i + 1][0]) i++; const A = SK[i], B = SK[i + 1], u = clamp((y - A[0]) / (B[0] - A[0]), 0, 1); return [lerp(A[1], B[1], u), lerp(A[2], B[2], u), lerp(A[3], B[3], u)]; };
  const a0 = PI / 2 + 0.95, a1 = PI / 2 - 0.95 + TAU, th = 0.007 + gr - t * 0.5;
  g.surf(22, 6, (u, v) => {
    const y = lerp(o.low || 1.635, hl + 0.004, v), a = lerp(a0, a1, u), e = Math.min(u, 1 - u) * (a1 - a0), tp = smooth(0.0, 0.55, e) * smooth(o.low || 1.635, (o.low || 1.635) + 0.03, y) + 0.12;
    const r = sk(y), off = th * tp + 0.0015 + 0.002 * Math.sin(a * 23 + y * 300) * tp, sn = Math.sin(a);
    return [Math.cos(a) * (r[0] + off), y, sn * ((sn >= 0 ? r[1] : r[2]) + off)];
  }, {});
}
function hair(g, style, col, fem) {
  switch (style) {
    case 'bald': g.bone('head'); g.mat(col, 0.92, 0, T_FUR, 0.2); g.loft([{ y: 1.62, rx: 0.079, rz: 0.0, rb: 0.096, z: -0.01 }, { y: 1.7, rx: 0.084, rz: 0.0, rb: 0.104 }, { y: 1.73, rx: 0.08, rz: 0.0, rb: 0.1 }], { seg: 14, sub: 2, arc: [PI - 0.3, TAU + 0.3], wr: 0.05 }); break;
    case 'buzz': hairCap(g, col, { thin: 0.004, line: 1.762 }); break;
    case 'sides': hairCap(g, col, { thin: 0.002, noTop: true }); break;
    case 'short': hairCap(g, col, {}); break;
    case 'messy': hairCap(g, col, { grow: 0.01, wr: 0.09 }); break;
    case 'curly': hairCap(g, col, { grow: 0.02, wr: 0.12 }); break;
    case 'long': case 'ponytail': case 'bun': {
      hairCap(g, col, { grow: 0.006, line: 1.765, noTop: !!fem && fem === 'tight' });
      g.mat(col, 0.92, 0, T_FUR, 0.2);
      if (style === 'long') {
        g.bone(HAIR_W);
        g.surf(12, 7, (u, v) => { const a = lerp(-PI / 2 - 1.55, -PI / 2 + 1.55, u), y = lerp(1.76, fem ? 1.36 : 1.44, v), r = lerp(0.105, 0.125, v) + 0.01 * Math.sin(a * 9 + v * 4); return [Math.cos(a) * r * (1.02 - 0.15 * v), y, Math.sin(a) * r * 0.95 - 0.012 - 0.04 * v * v]; }, { thick: 0.014 });
        for (const s of [-1, 1]) g.surf(3, 5, (u, v) => [s * (0.083 + 0.01 * v), lerp(1.72, 1.5, v), lerp(0.02, -0.06, u) - 0.01 * v], { thick: 0.012, flip: s < 0 });
      } else if (style === 'ponytail') {
        g.bone('head'); g.tr(0, 1.715, -0.105); g.sphere(0.028, 0.024, 0.024, 8, 5); g.pop();
        g.bone(HAIR_W); g.tube([[0, 1.715, -0.12], [0, 1.66, -0.15], [0, 1.57, -0.155], [0, 1.48, -0.14]], (t) => 0.026 * (1 - 0.55 * t), { seg: 8, sub: 3 });
      } else { g.bone('head'); g.tr(0, 1.785, -0.07); g.sphere(0.045, 0.04, 0.042, 10, 7); g.pop(); }
      break;
    }
  }
}

/* ------------------------------------------------------------------ headwear */
function beanie(g, col, roll) {
  g.bone('head'); g.mat(col, 0.95, 0, T_QUILT, 0.3);
  capShell(g, { c: 1.69, rx: 0.097, ry: 0.145, rz: 0.117, rb: 0.12, yFront: 1.748, yBack: 1.665, thick: 0.007 });
  g.mat(roll || col, 0.95, 0, T_QUILT, 0.3);
  g.loft([{ y: 1.738, rx: 0.094, rz: 0.11, rb: 0.112 }, { y: 1.744, rx: 0.101, rz: 0.117, rb: 0.119 }, { y: 1.764, rx: 0.1, rz: 0.114, rb: 0.119 }, { y: 1.771, rx: 0.092, rz: 0.104, rb: 0.112 }], { seg: 24, sub: 2 });
}
function cap(g, col, brimCol, back) {
  g.bone('head'); g.mat(col, 0.9, 0, T_CLOTH, 0.3);
  g.tr(0, 0, 0, 0, back ? PI : 0, 0);
  capShell(g, { c: 1.69, rx: 0.096, ry: 0.142, rz: 0.116, rb: 0.118, yFront: 1.758, yBack: 1.7, thick: 0.006 });
  g.mat(brimCol || col, 0.85, 0, T_CLOTH, 0.3);
  g.surf(10, 3, (u, v) => { const x = (u - 0.5) * 0.17, zz = 0.094 + v * 0.085 * Math.cos((u - 0.5) * 1.6), y = 1.757 - v * v * 0.016 - Math.abs(u - 0.5) * 0.01; return [x * (1 - 0.25 * v), y, zz]; }, { thick: 0.005 });
  g.pop();
}
function bandana(g, col) { g.bone('head'); g.mat(col, 0.95, 0, T_CLOTH, 0.3); capShell(g, { c: 1.69, rx: 0.095, ry: 0.14, rz: 0.115, rb: 0.117, yFront: 1.752, yBack: 1.67, thick: 0.004 }); g.tube([[0, 1.69, -0.105], [0.01, 1.65, -0.12], [0.02, 1.6, -0.11]], 0.012, { seg: 5, sub: 2, flatten: 0.4 }); }
function glasses(g, col) {
  g.bone('head'); g.mat(col || C(0x141414), 0.4, 0.3, T_PLATE, 0.1);
  for (const s of [-1, 1]) {
    const pts = []; for (let i = 0; i <= 12; i++) { const a = i / 12 * TAU; pts.push([s * 0.031 + Math.cos(a) * 0.017, 1.699 + Math.sin(a) * 0.012, 0.104]); }
    g.tube(pts, 0.0018, { seg: 4, sub: 1, cap: false });
    g.tube([[s * 0.048, 1.703, 0.1], [s * 0.078, 1.704, 0.05], [s * 0.083, 1.69, -0.01]], 0.0016, { seg: 4, sub: 2 });
  }
  g.tube([[-0.014, 1.701, 0.106], [0, 1.705, 0.11], [0.014, 1.701, 0.106]], 0.0017, { seg: 4, sub: 2 });
}
function faceMask(g, col) { // cloth / surgical mask over nose and mouth
  g.bone('head'); g.mat(col, 0.95, 0, T_CLOTH, 0.3);
  g.loft([{ y: 1.565, rx: 0.05, rz: 0.075, rb: 0.04, z: 0.03 }, { y: 1.6, rx: 0.08, rz: 0.106, rb: 0.06, z: 0.006 }, { y: 1.645, rx: 0.082, rz: 0.13, rb: 0.07 }, { y: 1.68, rx: 0.082, rz: 0.128, rb: 0.08 }], { seg: 16, sub: 2, arc: [-0.2, PI + 0.2], thick: 0.004 });
  for (const s of [-1, 1]) g.tube([[s * 0.082, 1.665, 0.03], [s * 0.088, 1.69, -0.01]], 0.0016, { seg: 4, sub: 1 });
}

/* ------------------------------------------------------------------ garments */
// trousers: leg lofts + a pelvis piece; o: col, k, y0 (bottom), cargo, fem
function pants(g, P, o) {
  const col = o.col;
  both((s) => {
    g.mat(col, 0.95, 0, T_CLOTH, 1.5); H.leg(g, P, s, { y0: o.y0 || 0.14, y1: 0.99, k: o.k || 1.05, wr: o.wr || 0.05, wra: 3, wry: 26 });
    if (o.cargo) { g.bone(s > 0 ? 'lThigh' : 'rThigh'); g.mat(mixC(col, [0, 0, 0], 0.15), 0.95, 0, T_CLOTH, 1.2); g.tr(s * (P.hp + 0.072 * (o.k || 1)), 0.68, 0.0, 0, s * 1.4, 0); patch(g, 0, 0, 0, 0.1, 0.12, { bow: 0.012, flap: true, thick: 0.006 }); g.pop(); }
    if (o.cuff) { g.bone(s > 0 ? 'lShin' : 'rShin'); g.mat(col, 0.95, 0, T_CLOTH, 1.8); g.tr(s * (P.hp + 0.005), (o.y0 || 0.14) + 0.02, 0); g.lathe([[0.052 * (o.k || 1), -0.02], [0.056 * (o.k || 1), 0.0], [0.052 * (o.k || 1), 0.02]], 10, { thick: 0.004 }); g.pop(); }
  });
  g.mat(col, 0.95, 0, T_CLOTH, 1.3); torso(g, { y0: 0.9, y1: 1.08, grow: 0.004, k: o.k ? o.k * 0.98 : 1.02, fem: o.fem });
}
function shoes(g, P, o) {
  both((s) => {
    g.mat(o.col, o.sneaker ? 0.75 : 0.7, 0, T_LEATHER, o.sneaker ? 1.1 : 1.8); H.boot(g, P, s, { top: o.top || 0.13 });
    if (o.sneaker) { // white rubber rim over the kit's dark sole
      g.bone(s > 0 ? 'lFoot' : 'rFoot'); g.mat(o.rim || C(0x9a968c), 0.7, 0, T_LEATHER, 1.0);
      g.tr(s * (P.hp + 0.005), 0.03, 0.06, PI / 2, 0, 0); g.loft([{ y: -0.095, rx: 0.03, rz: 0.012, rb: 0.012, sq: 2.4 }, { y: -0.04, rx: 0.048, rz: 0.012, rb: 0.012, sq: 2.6 }, { y: 0.1, rx: 0.054, rz: 0.012, rb: 0.012, sq: 2.6 }, { y: 0.17, rx: 0.03, rz: 0.012, rb: 0.012, sq: 2.2 }], { seg: 12, sub: 2, cap0: true, cap1: true }); g.pop();
    }
  });
}
function sleeves(g, P, o) {
  both((s) => {
    g.mat(o.col, 0.95, 0, o.type || T_CLOTH, 0.7); H.arm(g, P, s, { grow: o.grow || 0.012, k: o.k || 1.05, wr: o.wr || 0.05, y0: o.y0 || 0.91, cap1: true });
    if (o.cuff) { g.bone(s > 0 ? 'lFore' : 'rFore'); g.mat(o.cuffCol || o.col, 0.95, 0, T_QUILT, 0.6); g.tr(s * (P.sh + 0.03), (o.y0 || 0.91) + 0.02, 0); g.lathe([[0.04, -0.022], [0.045, 0], [0.042, 0.022]], 10, { thick: 0.004 }); g.pop(); }
  });
}
function bareArms(g, P, skin, o = {}) { both((s) => { g.mat(skin, 0.6, 0, T_SKIN, 0.5); H.arm(g, P, s, { k: o.k || 1, y0: 0.905, y1: o.y1 || 1.5, cap1: o.y1 ? false : true }); }); }
function hands(g, P, col) { both((s) => { g.mat(col, 0.6, 0, T_SKIN, 0.4); H.fist(g, P, s); }); }
function collar(g, col, o = {}) { // folded shirt / jacket collar round the neck
  g.bone(chainY([['neck', 9], ['chest', 1.5]], 0.03)); g.mat(col, 0.9, 0, o.type || T_CLOTH, 0.4);
  const gap = o.gap === undefined ? 0.5 : o.gap;
  g.surf(16, 3, (u, v) => { const a = lerp(PI / 2 + gap, PI / 2 - gap + TAU, u), r = lerp(0.075, 0.105 + (o.wide || 0), v), y = lerp(1.505, 1.465 - (o.drop || 0) * Math.max(0, Math.sin(a)), v) + 0.035 * (1 - v) * Math.max(0, -Math.sin(a)) * 0.5; return [Math.cos(a) * r, y, Math.sin(a) * r * 1.05 + 0.005]; }, { thick: 0.004 });
}
function hoodDown(g, col) { // hood bunched behind the neck
  g.bone(chainY([['neck', 9], ['chest', 1.5]], 0.04)); g.mat(col, 0.95, 0, T_CLOTH, 0.5);
  g.surf(12, 5, (u, v) => { const a = lerp(-PI / 2 - 1.75, -PI / 2 + 1.75, u), r = 0.085 + 0.045 * Math.sin(v * PI) + 0.008 * Math.sin(a * 7), y = lerp(1.505, 1.36, v) + 0.03 * Math.sin(v * PI) * Math.cos(a + PI / 2); return [Math.cos(a) * r * 1.15, y, Math.sin(a) * (r + 0.03 * Math.sin(v * PI)) - 0.04 * v]; }, { thick: 0.012 });
}
function backpack(g, col, strapCol, big) {
  g.bone('back'); g.mat(col, 0.9, 0, T_QUILT, 0.9); const k = big ? 1.25 : 1;
  g.tr(0, 1.04, -0.19);
  g.loft([{ y: 0, rx: 0.13 * k, rz: 0.05, rb: 0.07 * k, sq: 3.4 }, { y: 0.18, rx: 0.145 * k, rz: 0.05, rb: 0.1 * k, sq: 3.4 }, { y: 0.36 * k, rx: 0.13 * k, rz: 0.05, rb: 0.085 * k, sq: 3.2 }, { y: 0.4 * k, rx: 0.08 * k, rz: 0.04, rb: 0.05, sq: 3 }], { seg: 12, sub: 3, cap0: true, cap1: true, wr: 0.05, wra: 2, wry: 12 });
  g.mat(mixC(col, [0, 0, 0], 0.2), 0.9, 0, T_QUILT, 1.0); g.tr(0, 0.07, -0.08 * k); g.loft([{ y: 0, rx: 0.09 * k, rz: 0.03, rb: 0.035, sq: 3.5 }, { y: 0.16, rx: 0.09 * k, rz: 0.03, rb: 0.035, sq: 3.5 }], { seg: 10, sub: 1, cap0: true, cap1: true }); g.pop();
  if (big) { g.mat(C(0x3a3a34), 0.95, 0, T_CLOTH, 0.8); g.tr(0, 0.52, -0.02, 0, 0, PI / 2); g.lathe([[0.0, -0.18], [0.06, -0.175], [0.065, 0], [0.06, 0.175], [0.0, 0.18]], 10); g.pop(); }
  g.pop();
  g.bone('chest'); g.mat(strapCol, 0.8, 0, T_LEATHER, 0.5);
  for (const sx of [-1, 1]) g.tube([[sx * 0.1, 1.42, -0.14], [sx * 0.115, 1.5, -0.02], [sx * 0.12, 1.45, 0.11], [sx * 0.13, 1.28, 0.135], [sx * 0.15, 1.12, 0.06], [sx * 0.13, 1.08, -0.15]], 0.013, { seg: 5, sub: 3, cap: false, flatten: 0.4 });
}
function messenger(g, col) { H.satchel(g, 0.17, 1.0, -0.02, 2.0, 0.95, col); H.strap(g, { side: -1, grow: 0.045, w: 0.02, col: mixC(col, [0, 0, 0], 0.3) }); }

/* ------------------------------------------------------------------ carried props */
// wire shopping basket hanging from the left hand on the abs 'lan' bone (pivot at the grip): hidden unless carrying
function basket(g, P) {
  const x = P.sh + 0.03, y = 0.835, w = 0.17, d = 0.12, top = -0.17, bot = -0.38;
  g.bone('lan'); g.mat(C(0x9a2a1e), 0.55, 0, T_PLATE, 0.6);
  g.tr(x, y, 0.0);
  // handle (rises to the grip)
  g.tube([[-0.02, top, -d], [-0.01, -0.06, -0.06], [0, 0.0, 0], [-0.01, -0.06, 0.06], [-0.02, top, d]], 0.008, { seg: 6, sub: 3 });
  // tub: thin shell walls, open top, plastic red
  g.tr(0, (top + bot) / 2, 0, 0, PI / 2, 0);
  g.loft([{ y: (bot - top) / 2, rx: w * 0.9, rz: d * 0.85, sq: 5 }, { y: (top - bot) / 2, rx: w, rz: d, sq: 5 }], { seg: 16, sub: 1, cap0: true, thick: 0.006 });
  g.mat(C(0x6a1a14), 0.6, 0, T_PLATE, 0.6); for (let k = 0; k < 3; k++) { const yy = lerp((bot - top) / 2, (top - bot) / 2, (k + 1) / 4); g.loft([{ y: yy - 0.006, rx: lerp(w * 0.9, w, (k + 1) / 4) + 0.003, rz: lerp(d * 0.85, d, (k + 1) / 4) + 0.003, sq: 5 }, { y: yy + 0.006, rx: lerp(w * 0.9, w, (k + 1) / 4) + 0.003, rz: lerp(d * 0.85, d, (k + 1) / 4) + 0.003, sq: 5 }], { seg: 16, sub: 1 }); }
  // goods poking out: a tin, a box, a bottle
  g.mat(C(0x8a8a86), 0.4, 0.8, T_PLATE, 0.3); g.tr(0.05, (top - bot) / 2 - 0.05, 0.03); g.lathe([[0.034, 0], [0.034, 0.1]], 10, { cap0: true, cap1: true }); g.pop();
  g.mat(C(0x5a7a3a), 0.8, 0, T_CLOTH, 0.3); g.tr(-0.06, (top - bot) / 2 - 0.07, -0.02, 0, 0.3, 0.1); g.box(0.09, 0.15, 0.06, 8); g.pop();
  g.mat(C(0x3a6a8a), 0.3, 0, T_PLATE, 0.2); g.tr(0.0, (top - bot) / 2 - 0.06, -0.06, 0.15, 0, -0.2); g.lathe([[0.025, 0], [0.026, 0.1], [0.012, 0.14], [0.011, 0.17]], 8, { cap0: true, cap1: true }); g.pop();
  g.pop(); g.pop();
}
// crate held in front of the belly (cine CARRY) on the abs 'lanB' bone (rig built with lanB pivot at the crate)
const CRATE_AT = [0, 1.06, 0.33];
function crate(g) {
  g.bone('lanB'); g.mat(C(0x7a6040), 0.85, 0, T_WOOD, 0.6);
  g.tr(CRATE_AT[0], CRATE_AT[1] - 0.12, CRATE_AT[2]); g.box(0.46, 0.24, 0.3, 12);
  g.mat(C(0x5a4630), 0.85, 0, T_WOOD, 0.6); for (const yy of [0.04, 0.2]) { g.tr(0, yy, 0); g.box(0.475, 0.035, 0.315, 12); g.pop(); }
  g.pop();
}
// bat or pipe in the right hand (staff on Security)
function bat(g, P, pipe) {
  inHand(g, P, -1, () => {
    if (pipe) { g.mat(C(0x5a5650), 0.45, 0.85, T_PLATE, 1.2); g.lathe([[0.016, -0.1], [0.016, 0.62]], 10, { cap0: true, cap1: true }); g.mat(C(0x2a2a28), 0.8, 0, T_LEATHER, 0.4); g.lathe([[0.019, -0.09], [0.019, 0.08]], 10); g.mat(C(0x4a4640), 0.5, 0.85, T_PLATE, 1.2); g.tr(0, 0.62, 0); g.lathe([[0.024, -0.02], [0.024, 0.03]], 8, { cap1: true }); g.pop(); }
    else { g.mat(C(0x7a5a38), 0.75, 0, T_WOOD, 0.8); g.lathe([[0.017, -0.1], [0.016, 0.08], [0.024, 0.32], [0.033, 0.56], [0.031, 0.62], [0.0, 0.63]], 12, { cap0: true }); g.mat(C(0x1e1e20), 0.8, 0, T_LEATHER, 0.3); g.lathe([[0.019, -0.09], [0.019, 0.07]], 10); }
  });
}

/* ------------------------------------------------------------------ styles: poses and clips (LF signs: -x on upper arm / thigh swings it forward) */
const MALE_CARRY = stance({ lUp: [0.06, 0, 0.1], rUp: [0.05, 0, -0.1] });
const FEMALE_CARRY = stance({ hips: [0.02, 0.08, 0.07], lUp: [0.05, 0, 0.075], rUp: [0.04, 0, -0.075], lFore: [-0.45, 0.25, 0], rFore: [-0.42, -0.25, 0], lThigh: [-0.12, 0.25, 0.02], rThigh: [0.05, -0.18, -0.02] });
const BASKET_ARM = { lUp: [0.0, 0, 0.13], lFore: [-0.12, 0.2, 0], lHand: [0, 0, 0] };
const HURT_ARMS = { spine: [0.24, 0, 0.04], chest: [0.12, 0, 0], neck: [0.1, 0, 0], head: [0.12, 0, 0.05], lUp: [-0.55, 0, 0.06], lFore: [-1.65, 0.7, 0], lHand: [0.3, 0, 0] };
const BAT_CARRY = { rUp: [0.04, 0, -0.12], rFore: [-0.5, 0, 0], rHand: [0.6, 0, 0] };
const BAT_READY = rdy({ hips: [0.04, -0.4, 0], chest: [0.04, -0.1, 0], head: [0, 0.4, 0], rUp: [-0.35, 0.3, -0.5], rFore: [-1.9, 0, 0], rHand: [-0.2, 0, 0], lUp: [-0.5, 0, 0.25], lFore: [-1.1, 0, 0] });
const over = (pose, o) => { const r = Object.assign({}, pose); for (const k in o) r[k] = o[k]; return r; };

function humanClips(carry) {
  return {
    reach: mkClip(0.5, [
      { t: 0.22, e: 'out', b: { chest: [0.06, -0.15, 0], rUp: [-0.95, 0.1, -0.12], rFore: [-1.0, 0, 0], head: [0.06, 0, 0] } },
      { t: 0.5, b: { spine: [0.1, 0, 0], chest: [0.1, -0.22, 0], rUp: [-1.55, 0.1, -0.02], rFore: [-0.22, 0, 0], rHand: [0.15, 0, 0], head: [0.1, -0.08, 0] } },
      { t: 0.62, b: { spine: [0.1, 0, 0], chest: [0.1, -0.22, 0], rUp: [-1.5, 0.1, -0.02], rFore: [-0.3, 0, 0], rHand: [0.45, 0, 0], head: [0.1, -0.08, 0] } },
      { t: 0.86, b: { spine: [0.03, 0, 0], chest: [0.04, -0.1, 0], rUp: [-0.45, 0, -0.06], rFore: [-1.45, -0.3, 0], rHand: [0.1, 0, 0], head: [0.18, 0.05, 0] } }], carry),
    pay: mkClip(0.5, [
      { t: 0.25, e: 'out', b: { rUp: [-0.55, 0, -0.1], rFore: [-1.3, 0, 0], head: [0.08, 0, 0] } },
      { t: 0.5, b: { spine: [0.1, 0, 0], chest: [0.08, -0.12, 0], rUp: [-0.82, 0.1, -0.06], rFore: [-0.8, 0, 0], rHand: [-0.25, 0, 0], head: [0.16, 0, 0] } },
      { t: 0.64, b: { spine: [0.1, 0, 0], chest: [0.08, -0.12, 0], rUp: [-0.8, 0.1, -0.06], rFore: [-0.84, 0, 0], rHand: [0.1, 0, 0], head: [0.14, 0, 0] } },
      { t: 0.86, b: { rUp: [-0.3, 0, -0.1], rFore: [-0.95, 0, 0], head: [0.04, 0, 0] } }], carry),
    swing: mkClip(0.42, [
      { t: 0.28, e: 'out', b: { hips: [0.04, -0.5, 0], chest: [-0.05, -0.45, 0], rUp: [-2.1, 0.2, -0.85], rFore: [-1.4, 0, 0], rHand: [0.2, 0, 0], lUp: [-0.6, 0, 0.35], lFore: [-1.0, 0, 0], head: [0, 0.4, 0] }, root: [0, -0.02, -0.04] },
      { t: 0.42, e: 'snap', b: { hips: [0.06, 0.15, 0], chest: [0.25, 0.55, 0], rUp: [-1.25, 0, 0.45], rFore: [-0.2, 0, 0], rHand: [0.7, 0, 0], lUp: [-0.2, 0, 0.3], lFore: [-0.8, 0, 0], lThigh: [-0.6, 0.1, 0.05], lShin: [0.55, 0, 0], head: [0.15, 0.1, 0] }, root: [0, -0.06, 0.24] },
      { t: 0.62, b: { hips: [0.06, 0.3, 0], chest: [0.3, 0.7, 0], rUp: [-0.8, 0, 0.6], rFore: [-0.3, 0, 0], head: [0.1, 0.1, 0] }, root: [0, -0.05, 0.22] }], carry),
    hammer: mkClip(0.5, [
      { t: 0.34, e: 'out', b: { spine: [-0.15, 0, 0], chest: [-0.2, -0.15, 0], head: [-0.1, 0, 0], rUp: [-2.9, 0.2, -0.25], rFore: [-1.2, 0, 0], rHand: [0.3, 0, 0], lUp: [-2.7, -0.3, 0.25], lFore: [-1.4, 0, 0] }, root: [0, 0.02, -0.05] },
      { t: 0.5, e: 'in', b: { spine: [0.55, 0, 0], chest: [0.35, 0, 0], head: [0.25, 0, 0], rUp: [-1.25, 0, -0.05], rFore: [-0.2, 0, 0], rHand: [0.8, 0, 0], lUp: [-1.15, 0, 0.1], lFore: [-0.5, 0, 0], lThigh: [-0.55, 0.1, 0.05], lShin: [0.5, 0, 0] }, root: [0, -0.1, 0.12] },
      { t: 0.75, b: { spine: [0.45, 0, 0], chest: [0.3, 0, 0], rUp: [-1.1, 0, 0], rFore: [-0.3, 0, 0], lUp: [-1.0, 0, 0.1], lFore: [-0.6, 0, 0] }, root: [0, -0.08, 0.1] }], carry),
    // collapse backwards (cine COLLAPSE / RISE, driven by fall 0..1)
    collapse: mkClip(0.5, [
      { t: 0.3, e: 'out', b: { spine: [0.35, 0, 0.1], chest: [0.2, 0, 0], head: [0.3, 0, 0], lThigh: [-0.7, 0, 0.1], lShin: [1.1, 0, 0], rThigh: [-0.5, 0, -0.1], rShin: [1.2, 0, 0], lUp: [-0.6, 0, 0.2], lFore: [-1.4, 0, 0], rUp: [-0.5, 0, -0.2], rFore: [-1.2, 0, 0] }, root: [0, -0.38, 0] },
      { t: 0.84, e: 'in', b: { root: [-1.45, 0, 0], spine: [-0.1, 0, 0.1], chest: [-0.05, 0, 0], head: [-0.15, 0.6, 0], lThigh: [-0.3, 0.1, 0.15], lShin: [0.4, 0, 0], rThigh: [-0.15, -0.1, -0.15], rShin: [0.15, 0, 0], lUp: [0.3, 0, 0.9], lFore: [-0.4, 0, 0], rUp: [0.2, 0, -1.1], rFore: [-0.2, 0, 0], lFoot: [0.5, 0, 0], rFoot: [0.4, 0, 0] }, root: [0, 0.0, -0.12] }], carry),
  };
}
function humanStyle(fem) {
  const carry = fem ? FEMALE_CARRY : MALE_CARRY;
  return style({ carry, ready: BAT_READY, readyRoot: -0.03, clips: humanClips(carry), swingL: 0.85, swingR: 0.85, gait: fem ? { bounce: 0.9, sway: 1.5, lean: 0.9, lift: 1.0 } : { bounce: 1.0, sway: 1.1, lean: 1.1, lift: 1.0 } });
}

/* ------------------------------------------------------------------ human looks */
const TOP_TYPES = ['tee', 'hoodie', 'jacket', 'coat', 'sweater', 'vest', 'shirt', 'tank'];
function pickLook(seed, o = {}) {
  const V = variety(seed * 7 + 3), fem = o.female !== undefined ? o.female : V.chance(0.46);
  const L = { V, fem, seed };
  L.skin = V.pick(SKINS); L.hairCol = V.r() < 0.12 ? HAIRS[5] : V.pick(HAIRS);
  L.hair = fem ? V.pick(['long', 'ponytail', 'bun', 'short', 'long', 'curly']) : V.pick(['short', 'buzz', 'messy', 'bald', 'short', 'curly']);
  L.beard = !fem && V.chance(0.45) ? (V.chance(0.5) ? 0.25 + V.r() * 0.5 : 0.3) : 0; L.stubble = L.beard && L.beard < 0.32;
  L.top = o.top || V.pick(TOP_TYPES); if (fem && L.top === 'tank' && V.chance(0.5)) L.top = 'tee';
  L.topCol = V.tint(V.pick(TOPS), 0.1); L.jacketCol = V.tint(V.pick(JACKETS), 0.1);
  L.pants = fem && V.chance(0.22) ? 'skirt' : V.pick(['jeans', 'jeans', 'cargo', 'work', 'sweat']);
  L.pantsCol = L.pants === 'jeans' ? V.tint(V.pick(PANTS.slice(0, 3)), 0.08) : L.pants === 'sweat' ? V.tint(C(0x55555a), 0.1) : V.tint(V.pick(PANTS), 0.08);
  L.shoe = V.chance(0.55) ? 'sneaker' : 'boot'; L.shoeCol = V.pick(SHOES);
  L.headwear = o.headwear || V.pick(['none', 'none', 'cap', 'beanie', 'none', 'hood', 'bandana', 'none']);
  if (L.headwear === 'hood' && L.top !== 'hoodie') L.headwear = 'none';
  L.scarf = V.chance(0.25); L.scarfCol = V.tint(V.pick(ACCENT), 0.1);
  L.glasses = V.chance(0.18); L.mask = V.chance(0.1);
  L.bag = V.pick(['none', 'backpack', 'none', 'messenger', 'none', 'backpack']);
  L.bagCol = V.tint(V.pick([C(0x3a3a34), C(0x2a3a4a), C(0x4a3a2a), C(0x5a2a22), C(0x2a2a2a)]), 0.1);
  L.k = 0.98 + V.rnd(0.06); L.heavy = !fem && V.chance(0.2);
  L.height = fem ? 0.93 + V.rnd(0.035) : 0.975 + V.rnd(0.04);
  L.eye = V.pick([C(0x2a1a10), C(0x3a2a18), C(0x1a2a3a), C(0x2a3a20)]);
  return L;
}

// body + clothes for a living human; extra: (g, P, L) for role gear
function buildHuman(L, extra) {
  const fem = L.fem, V = L.V;
  const P = { sh: fem ? 0.182 : 0.2 + V.rnd(0.01) + (L.heavy ? 0.01 : 0), hp: fem ? 0.098 : 0.096, lanB: CRATE_AT };
  const { rig, g } = start(P);
  const tk = (L.heavy ? 1.08 : 1) * L.k, belly = L.heavy ? 0.045 : 0, F = fem ? 1 : 0;
  const tor = (o) => torso(g, Object.assign({ fem: F, k: tk, kz: L.heavy ? 1.08 : 1, belly }, o));
  // legs and feet
  const shoeTop = L.shoe === 'sneaker' ? 0.12 : 0.28;
  if (L.pants === 'skirt') {
    both((s) => { g.mat(mixC(L.skin, [0.05, 0.05, 0.06], 0.6), 0.6, 0, T_SKIN, 0.4); H.leg(g, P, s, { y0: shoeTop - 0.03, y1: 0.99, k: 0.96 }); });
    shoes(g, P, { col: L.shoeCol, top: shoeTop, sneaker: L.shoe === 'sneaker' });
    g.mat(L.pantsCol, 0.95, 0, T_CLOTH, 1.0); tor({ y0: 0.92, y1: 1.08, grow: 0.006 });
    H.skirt(g, { y0: 1.06, y1: 0.52, grow: 0.012, flare: 0.07, seg: 26, thick: 0.005, wave: 0.03, folds: 8 });
  } else {
    pants(g, P, { col: L.pantsCol, y0: shoeTop - 0.02, k: (fem ? 1.0 : 1.05) * (L.heavy ? 1.08 : 1), cargo: L.pants === 'cargo' || L.pants === 'work', cuff: L.pants === 'jeans' && L.shoe === 'sneaker', fem: F });
    shoes(g, P, { col: L.shoeCol, top: shoeTop, sneaker: L.shoe === 'sneaker' });
  }
  // upper body
  const top = L.top, tc = L.topCol, jc = L.jacketCol;
  const shirtOver = { y0: 0.98, y1: 1.5, grow: 0.012, wr: 0.035 };
  let sleeveCol = tc, outerGrow = 0.012, collarCol = null, hood = false;
  switch (top) {
    case 'tank':
      g.mat(L.skin, 0.6, 0, T_SKIN, 0.5); tor({ y0: 1.3, y1: 1.525, grow: 0.0 });
      g.mat(tc, 0.95, 0, T_CLOTH, 0.7); tor({ y0: 0.98, y1: 1.47, grow: 0.01, wr: 0.03 });
      bareArms(g, P, L.skin, { k: fem ? 0.88 : 1.02 }); sleeveCol = null; break;
    case 'tee':
      g.mat(tc, 0.95, 0, T_CLOTH, 0.7); tor(shirtOver);
      bareArms(g, P, L.skin, { k: fem ? 0.88 : 1, y1: 1.24 });
      both((s) => { g.mat(tc, 0.95, 0, T_CLOTH, 0.6); H.arm(g, P, s, { y0: 1.2, grow: 0.012, k: fem ? 0.95 : 1.06, wr: 0.06, cap1: true }); });
      collar(g, mixC(tc, [0, 0, 0], 0.12), { gap: 0.0, wide: -0.012 }); sleeveCol = null; break;
    case 'shirt':
      g.mat(tc, 0.92, 0, T_CLOTH, 0.7); tor(shirtOver); sleeves(g, P, { col: tc, cuff: true, k: fem ? 0.92 : 1.04 });
      collar(g, tc, { gap: 0.32, drop: 0.02 });
      g.bone(H.TW); g.mat(C(0xb0a890), 0.4, 0, T_BONE, 0.2); for (let k = 0; k < 4; k++) { const y = 1.42 - k * 0.1, z = torsoFront(y, { fem: F, kz: L.heavy ? 1.08 : 1, belly, grow: 0.012 }); g.tr(0, y, z + 0.002); g.sphere(0.006, 0.006, 0.003, 6, 3); g.pop(); }
      sleeveCol = null; break;
    case 'sweater':
      g.mat(tc, 0.97, 0, T_QUILT, 0.7); tor({ y0: 0.94, y1: 1.5, grow: 0.016, blouse: 0.008, wr: 0.03 }); sleeves(g, P, { col: tc, type: T_QUILT, grow: 0.016, cuff: true, k: fem ? 0.95 : 1.08 });
      collar(g, tc, { gap: 0.0, wide: -0.016, type: T_QUILT }); sleeveCol = null; break;
    case 'hoodie':
      g.mat(tc, 0.97, 0, T_CLOTH, 0.8); tor({ y0: 0.9, y1: 1.5, grow: 0.02, blouse: 0.012, wr: 0.04 }); sleeves(g, P, { col: tc, grow: 0.02, cuff: true, k: fem ? 0.98 : 1.1, wr: 0.07 });
      { const z = torsoFront(1.06, { fem: F, kz: L.heavy ? 1.08 : 1, belly, grow: 0.02 }) + 0.004; g.bone(H.TW); g.mat(mixC(tc, [0, 0, 0], 0.1), 0.97, 0, T_CLOTH, 0.8); g.tr(0, 1.065, z); patch(g, 0, 0, 0, 0.2, 0.12, { bow: 0.01, thick: 0.005 }); g.pop(); }
      g.bone(H.TW); g.mat(C(0x9a968a), 0.8, 0, T_CLOTH, 0.4); for (const s of [-1, 1]) { const z = torsoFront(1.38, { fem: F, grow: 0.024 }); g.tube([[s * 0.04, 1.44, z - 0.01], [s * 0.042, 1.34, z + 0.004], [s * 0.044, 1.24, z + 0.006]], 0.0035, { seg: 4, sub: 2 }); }
      hood = true; sleeveCol = null; break;
    case 'jacket': case 'coat': case 'vest': {
      const inner = V.tint(V.pick(TOPS), 0.1);
      g.mat(inner, 0.95, 0, T_CLOTH, 0.7); tor(shirtOver);
      if (top === 'vest') { // puffer vest over a long-sleeve top
        sleeves(g, P, { col: inner, cuff: true, k: fem ? 0.94 : 1.04 });
        g.mat(jc, 0.85, 0, T_QUILT, 0.8); tor({ y0: 0.97, y1: 1.47, grow: 0.042, arc: [PI / 2 + 0.06, PI / 2 - 0.06 + TAU], thick: 0.008, wr: 0.02 });
        collar(g, jc, { gap: 0.18, wide: 0.02, type: T_QUILT });
      } else {
        g.mat(jc, 0.8, 0, top === 'coat' ? T_CLOTH : T_LEATHER, 0.9); tor({ y0: 0.95, y1: 1.5, grow: 0.03, arc: [PI / 2 + 0.2, PI / 2 - 0.2 + TAU], thick: 0.006, wr: 0.04, wra: 4, wry: 16 });
        if (top === 'coat') H.skirt(g, { y0: 1.02, y1: 0.48 + V.r() * 0.12, grow: 0.034, flare: 0.09, arc: [PI / 2 + 0.26, PI / 2 - 0.26 + TAU], seg: 26, thick: 0.006, wave: 0.045, folds: 7 });
        else H.skirt(g, { y0: 1.02, y1: 0.9, grow: 0.034, flare: 0.02, arc: [PI / 2 + 0.22, PI / 2 - 0.22 + TAU], seg: 22, thick: 0.006 });
        sleeves(g, P, { col: jc, grow: 0.026, k: fem ? 1.0 : 1.12, wr: 0.08, cuff: true, cuffCol: mixC(jc, [0, 0, 0], 0.2), type: top === 'coat' ? T_CLOTH : T_LEATHER });
        collar(g, jc, { gap: 0.36, wide: 0.03, drop: 0.03, type: top === 'coat' ? T_CLOTH : T_LEATHER });
        // zip / button line and pockets on the open fronts
        g.bone(H.TW); g.mat(mixC(jc, [0, 0, 0], 0.25), 0.8, 0, T_LEATHER, 0.6);
        for (const s of [-1, 1]) { const a = PI / 2 + s * 0.62, y = 1.08, rz = torsoFront(y, { fem: F, kz: L.heavy ? 1.08 : 1, belly, grow: 0.036 }); g.tr(Math.cos(a) * 0.16 * tk, y, Math.sin(a) * rz * 0.98, 0, Math.atan2(Math.cos(a), Math.sin(a)) * 0.9, 0); patch(g, 0, 0, 0, 0.09, 0.1, { bow: 0.006, flap: true, thick: 0.005 }); g.pop(); }
      }
      sleeveCol = null; break;
    }
  }
  if (fem && top !== 'tank') { /* bust carried by the torso profile */ }
  hands(g, P, L.skin);
  // belt (visible under short tops / open jackets)
  if (L.pants !== 'skirt' && (top === 'tee' || top === 'tank' || top === 'shirt' || top === 'jacket' || top === 'coat')) H.belt(g, { grow: 0.012, w: 0.02, col: C(0x24201c) });
  // head
  head(g, { skin: L.skin, female: fem, hair: L.hairCol, beard: L.beard, stubble: L.stubble, eye: L.eye });
  const hw = L.headwear;
  const tight = hw === 'cap' || hw === 'bandana';
  const longH = L.hair === 'long' || L.hair === 'ponytail' || L.hair === 'bun';
  if (hw === 'none') hair(g, L.hair, L.hairCol, fem);
  else if (hw !== 'hood' && L.hair !== 'bald') hair(g, longH ? (L.hair === 'bun' ? 'ponytail' : L.hair) : 'sides', L.hairCol, longH ? 'tight' : fem);
  if (hood) { if (hw === 'hood') H.hood(g, P, { col: tc, open: 0.78, peak: 0.02 }); else hoodDown(g, tc); }
  if (hw === 'cap') cap(g, V.tint(V.pick(TOPS.concat(ACCENT)), 0.1), null, V.chance(0.2));
  if (hw === 'beanie') beanie(g, V.tint(V.pick(TOPS.concat(ACCENT)), 0.1));
  if (hw === 'bandana') bandana(g, L.scarfCol);
  if (L.glasses) glasses(g);
  if (L.mask) faceMask(g, V.pick([C(0x7a8a90), C(0x2a2a2a), C(0x6a7a6a)]));
  if (L.scarf && !hood) H.cowl(g, P, { col: L.scarfCol, r: 0.032, y: 1.49, wide: top === 'jacket' || top === 'coat' || top === 'vest' ? 0.022 : 0.0 });
  if (L.bag === 'backpack') backpack(g, L.bagCol, C(0x2a2622), false);
  else if (L.bag === 'messenger') messenger(g, L.bagCol);
  if (extra) extra(g, P, L);
  return finish(g, rig, P, { hand: ['wR', -(P.sh + 0.03), 0.835, 0.0], head: ['head', 0, 1.7, 0.1] });
}

/* ------------------------------------------------------------------ role gear */
const STAFF_APRON = C(0x2c4a38), STAFF_BAND = C(0xb84a1e);
function staffGear(L) {
  return (g, P, L2) => {
    const F = L.fem ? 1 : 0, tk = (L.heavy ? 1.08 : 1) * L.k, kz = L.heavy ? 1.08 : 1, belly = L.heavy ? 0.045 : 0;
    const out = L.top === 'jacket' || L.top === 'coat' || L.top === 'vest' ? 0.05 : L.top === 'hoodie' || L.top === 'sweater' ? 0.032 : 0.024;
    // bib apron: front panel chest to knee, neck strap, waist ties, name badge
    g.mat(STAFF_APRON, 0.9, 0, T_CLOTH, 0.9);
    torso(g, { fem: F, k: tk, kz, belly, grow: out, y0: 1.0, y1: 1.42, arc: [PI / 2 - 0.95, PI / 2 + 0.95], thick: 0.004, seg: 10 });
    H.skirt(g, { y0: 1.03, y1: 0.58, grow: out + 0.006, flare: 0.03, arc: [PI / 2 - 0.92, PI / 2 + 0.92], seg: 12, thick: 0.004, wave: 0.02, folds: 5 });
    g.bone(chainY([['neck', 9], ['chest', 1.5]], 0.03)); g.mat(mixC(STAFF_APRON, [0, 0, 0], 0.3), 0.9, 0, T_CLOTH, 0.5);
    for (const s of [-1, 1]) g.tube([[s * 0.1, 1.42, torsoFront(1.42, { fem: F, grow: out })], [s * 0.065, 1.5, 0.05], [0, 1.53, -0.06], [-s * 0.065, 1.5, 0.05]], 0.006, { seg: 4, sub: 3, cap: false, flatten: 0.4 });
    g.bone('hips'); { const r = samp(1.05); g.loft([{ y: 1.035, rx: r[1] * tk + out + 0.002, rz: r[2] * kz + out + belly * 0.9 + 0.002, rb: r[3] * kz + out + 0.002 }, { y: 1.06, rx: r[1] * tk + out + 0.002, rz: r[2] * kz + out + belly * 0.9 + 0.002, rb: r[3] * kz + out + 0.002 }], { seg: 18, sub: 1, thick: 0.003 }); }
    g.bone(H.TW); g.mat(C(0xd0c8b0), 0.6, 0, T_PLATE, 0.2); { const y = 1.36, z = torsoFront(y, { fem: F, kz, belly, grow: out }) + 0.004; g.tr(-0.07, y, z); patch(g, 0, 0, 0, 0.06, 0.035, { bow: 0.002 }); g.pop(); }
    // armband on the left upper arm
    g.bone('lUp'); g.mat(STAFF_BAND, 0.85, 0, T_CLOTH, 0.4); g.tr(P.sh + 0.008, 1.3, 0); g.lathe([[0.066, -0.025], [0.07, 0], [0.066, 0.025]], 12, { thick: 0.004 }); g.pop();
    bat(g, P, L.V.chance(0.5));
  };
}
function merchantGear(g, P, L) {
  backpack(g, C(0x4a3a26), C(0x2a1e14), true);
  g.bone('hips'); for (const [x, z] of [[-0.17, 0.05], [0.18, 0.0], [0.05, -0.16]]) H.pouch(g, x, 1.0, z, 0.85, C(0x4a3424));
  H.hat(g, { col: C(0x3a3226) });
}
function crewGear(g, P, L) {
  // hi-vis vest, hard hat, sledgehammer (demolition labourer)
  const F = L.fem ? 1 : 0, tk = (L.heavy ? 1.08 : 1) * L.k, kz = L.heavy ? 1.08 : 1, belly = L.heavy ? 0.045 : 0;
  const out = L.top === 'jacket' || L.top === 'coat' || L.top === 'vest' ? 0.05 : L.top === 'hoodie' || L.top === 'sweater' ? 0.032 : 0.024;
  g.mat(C(0xd8701a), 0.8, 0, T_CLOTH, 0.9); torso(g, { fem: F, k: tk, kz, belly, grow: out, y0: 1.0, y1: 1.47, arc: [PI / 2 + 0.12, PI / 2 - 0.12 + TAU], thick: 0.005, seg: 18 });
  g.mat(C(0xc8c8b0), 0.4, 0, T_PLATE, 0.4); for (const yy of [1.12, 1.3]) torso(g, { fem: F, k: tk, kz, belly, grow: out + 0.003, y0: yy, y1: yy + 0.03, arc: [PI / 2 + 0.12, PI / 2 - 0.12 + TAU], thick: 0.002, seg: 18 });
  g.bone('head'); g.mat(C(0xd8b020), 0.45, 0, T_PLATE, 0.5); capShell(g, { c: 1.70, rx: 0.1, ry: 0.15, rz: 0.118, rb: 0.124, yFront: 1.752, yBack: 1.7, thick: 0.007, flare: 0.022 });
  inHand(g, P, -1, () => { g.mat(C(0x6a4a2c), 0.8, 0, T_WOOD, 0.6); g.lathe([[0.017, -0.15], [0.019, 0.72]], 10, { cap0: true }); g.mat(C(0x3a3a3c), 0.5, 0.85, T_PLATE, 1.0); g.tr(0, 0.74, 0, 0, 0, PI / 2); g.box(0.07, 0.2, 0.07, 6); g.pop(); });
}
function survivorGear(g, P, L) { backpack(g, C(0x3a3e30), C(0x24221e), false); bat(g, P, false); }
function scavengerGear(g, P, L) {
  backpack(g, C(0x4a4436), C(0x24221e), true);
  inHand(g, P, -1, () => { g.mat(C(0x6a2a1e), 0.45, 0.8, T_PLATE, 1.2); g.tube([[0, -0.08, 0], [0, 0.5, 0], [0, 0.56, 0.03], [0, 0.57, 0.08]], 0.011, { seg: 6, sub: 2 }); });
}

/* ------------------------------------------------------------------ zombies */
const ZSKINS = [0x6a7a62, 0x5e6e58, 0x7a8068, 0x6e745c, 0x5a6458, 0x84866e].map(C);
function blood(g, x, y, z, sx, sy, rot, base) { // irregular stain: two overlapping flat ellipsoids, blood mixed into the cloth colour
  const col = base ? mixC(base, [0.16, 0.012, 0.01], 0.62) : C(0x4a1410);
  g.mat(col, 0.5, 0, T_PEAT, 0.5); g.tr(x, y, z, 0, Math.atan2(x, Math.max(0.01, z)), rot || 0);
  g.sphere(sx * 0.7, sy * 0.7, 0.004, 8, 5); g.tr(sx * 0.35, -sy * 0.3, 0.0005, 0, 0, 0.7); g.sphere(sx * 0.45, sy * 0.55, 0.0035, 8, 5); g.pop(); g.pop(); }
// torn version of a civilian look, infected skin, wounds; o: bloat, tumours, ribs
function buildZombie(seed, o = {}) {
  const L = pickLook(seed, { female: o.female });
  const V = L.V, fem = L.fem, Z = variety(seed * 13 + 1);
  const skin = Z.tint(Z.pick(ZSKINS), 0.07), rot = mixC(skin, [0.1, 0.02, 0.02], 0.55);
  const P = { sh: fem ? 0.184 : 0.198 + Z.rnd(0.008) + (o.bloat ? 0.02 : 0), hp: fem ? 0.098 : 0.096 + (o.bloat ? 0.01 : 0) };
  const { rig, g } = start(P);
  const F = fem ? 1 : 0, tk = o.bloat ? 1.2 : (L.heavy ? 1.06 : 0.97), kz = o.bloat ? 1.28 : 0.98, belly = o.bloat ? 0.1 : 0;
  const tor = (oo) => torso(g, Object.assign({ fem: F, k: tk, kz, belly }, oo));
  const fade = (c) => mixC(c, [0.16, 0.15, 0.12], 0.38);
  // legs: torn trousers, one shin bare
  const torn = Z.chance(0.5) ? 1 : -1;
  both((s) => {
    g.mat(skin, 0.7, 0, T_SKIN, 1.1); H.leg(g, P, s, { y0: 0.1, y1: 0.6, k: 0.94, wr: 0.04 });
    g.mat(fade(L.pantsCol), 0.97, 0, T_CLOTH, 2.2); H.leg(g, P, s, { y0: s === torn ? 0.44 : 0.14, y1: 0.99, k: (fem ? 1.0 : 1.05) * (o.bloat ? 1.15 : 1), wr: 0.1, wra: 5, wry: 18 });
    if (Z.chance(0.6)) { g.mat(skin, 0.7, 0, T_SKIN, 1.0); H.boot(g, P, s, { top: 0.1 }); }
    else { g.mat(fade(L.shoeCol), 0.8, 0, T_LEATHER, 2.4); H.boot(g, P, s, { top: L.shoe === 'sneaker' ? 0.12 : 0.26 }); }
  });
  g.mat(fade(L.pantsCol), 0.97, 0, T_CLOTH, 1.8); tor({ y0: 0.9, y1: 1.08, grow: 0.004 });
  // skin torso, ribs and a wound
  g.mat(skin, 0.68, 0, T_SKIN, 0.8); tor({ y0: 0.98, y1: 1.525, grow: 0.0 });
  if (o.ribs !== false && Z.chance(0.6)) {
    g.bone('chest'); g.mat(C(0x9a9078), 0.8, 0, T_BONE, 0.8);
    for (let k = 0; k < 4; k++) { const y = 1.35 - k * 0.05, z = torsoFront(y, { fem: F, kz, belly }) - 0.006; g.tube([[0.03, y + 0.008, z + 0.004], [0.085, y, z - 0.008], [0.13, y - 0.02, z - 0.045]], 0.0065, { seg: 5, sub: 2 }); }
    g.mat(rot, 0.6, 0, T_PEAT, 0.6); g.tr(0.085, 1.27, torsoFront(1.27, { fem: F, kz, belly }) - 0.012); g.sphere(0.06, 0.1, 0.012, 8, 6); g.pop();
  }
  // torn top: three ragged arcs that leave gaps
  const topCol = fade(L.top === 'jacket' || L.top === 'coat' || L.top === 'vest' ? L.jacketCol : L.topCol);
  g.mat(topCol, 0.97, 0, L.top === 'sweater' ? T_QUILT : T_CLOTH, 1.6);
  const gapA = Z.rnd(0.4);
  for (const [a0, a1, y1] of [[PI / 2 + 0.45 + gapA, PI + 0.95, 1.5], [PI + 1.15, TAU + 0.15, 1.49], [-0.05, 0.3 + gapA * 0.5, 1.46]]) tor({ grow: 0.014, y0: 0.98 + Z.r() * 0.06, y1, arc: [a0, a1], thick: 0.004, wr: 0.1, wra: 6, wry: 22 });
  H.skirt(g, { y0: 1.02, y1: 0.84 - (L.top === 'coat' ? 0.3 : 0), grow: 0.022 + belly * 0.7, flare: 0.04, arc: [PI / 2 + 0.7, TAU + 0.2], seg: 16, thick: 0.004, wave: 0.13, folds: 13 });
  // blood soaked into the cloth
  g.bone(H.TW); for (let k = 0; k < 3; k++) { const x = Z.rnd(0.12), y = 1.05 + Z.r() * 0.35, z = torsoFront(y, { fem: F, kz, belly, grow: 0.019 }) * Math.cos(x * 3); blood(g, x, y, z, 0.025 + Z.r() * 0.03, 0.035 + Z.r() * 0.05, Z.rnd(1), topCol); }
  // arms: one sleeve torn off, bloody hands, long nails, stump caps for a missing forearm
  both((s) => {
    g.mat(skin, 0.7, 0, T_SKIN, 0.8); H.arm(g, P, s, { k: (fem ? 0.86 : 0.92) * (o.bloat ? 1.18 : 1), wr: 0.05 });
    const sl = s === torn ? 1.28 : 0.96 + Z.r() * 0.15;
    g.mat(topCol, 0.97, 0, T_CLOTH, 1.0); H.arm(g, P, s, { y0: sl, y1: 1.5, grow: 0.012, k: 1.02 * (o.bloat ? 1.15 : 1), cap1: false, wr: 0.14, wra: 5 });
    g.mat(skin, 0.7, 0, T_SKIN, 0.8); H.fist(g, P, s);
    g.bone(s > 0 ? 'lHand' : 'rHand'); g.mat(C(0x2a1a14), 0.6, 0, T_BONE, 0.6); for (let k = 0; k < 4; k++) g.tube([[s * (P.sh + 0.03) - s * 0.027 + s * k * 0.018, 0.8, 0.055], [s * (P.sh + 0.03) - s * 0.027 + s * k * 0.018, 0.776, 0.078]], (t) => 0.0042 * (1 - t), { seg: 4, sub: 1 });
    g.bone(s > 0 ? 'lUp' : 'rUp'); g.mat(C(0x3a0a08), 0.5, 0, T_PEAT, 0.5); g.tr(s * (P.sh + 0.02), 1.15, 0); g.sphere(0.043, 0.03, 0.043, 8, 5); g.pop();
    g.mat(C(0xb0a888), 0.6, 0, T_BONE, 0.4); g.tr(s * (P.sh + 0.02), 1.13, 0); g.sphere(0.014, 0.025, 0.014, 6, 4); g.pop();
  });
  H.belt(g, { grow: 0.026 + belly * 0.8, w: 0.018, col: C(0x2a2018) });
  // head
  const eyeGlow = Z.pick([C(0xe0e8b0), C(0xf0f0e0), C(0xd8c890)]);
  head(g, { skin, female: fem, hair: L.hairCol, zombie: true, jawDrop: 0.008 + Z.r() * 0.012, eyeGlow, glowK: 1.8 });
  // patchy hair (bald patches)
  if (L.hair !== 'bald') {
    g.bone('head'); g.mat(fade(L.hairCol), 0.95, 0, T_FUR, 0.3);
    g.loft([{ y: 1.64, rx: 0.08, rz: 0.03, rb: 0.096, z: -0.006 }, { y: 1.72, rx: 0.085, rz: 0.07, rb: 0.105 }, { y: 1.77, rx: 0.079, rz: 0.088, rb: 0.1 }, { y: 1.8, rx: 0.05, rz: 0.058, rb: 0.07 }], { seg: 14, sub: 2, arc: [PI * 0.75 + Z.rnd(0.4), TAU + 0.3 + Z.rnd(0.4)], wr: 0.22, wra: 6, wry: 30 });
    if (fem && (L.hair === 'long' || L.hair === 'ponytail')) { g.bone(HAIR_W); g.surf(10, 6, (u, v) => { const a = lerp(-PI / 2 - 1.3, -PI / 2 + 1.1, u), y = lerp(1.74, 1.4, v), r = lerp(0.105, 0.12, v) + 0.014 * Math.sin(a * 11 + v * 5); return [Math.cos(a) * r, y - 0.05 * v * Math.sin(u * 7), Math.sin(a) * r * 0.95 - 0.015 - 0.04 * v * v]; }, { thick: 0.01 }); }
  }
  // face wounds
  g.bone('head'); g.mat(C(0x2a0806), 0.45, 0, T_PEAT, 0.4); g.tr(Z.rnd(0.03), 1.66 + Z.r() * 0.08, 0.075, 0, Z.rnd(0.6), 0); g.sphere(0.022, 0.012, 0.024, 8, 4); g.pop();
  g.mat(C(0x4a1410), 0.4, 0, T_PEAT, 0.3); g.tr(0.006, 1.575, 0.084); g.sphere(0.012, 0.022, 0.008, 8, 4); g.pop(); // blood running from the mouth
  if (o.extra) o.extra(g, P, { skin, rot, Z, fem });
  return finish(g, rig, P, { hand: ['rHand', -(P.sh + 0.03), 0.8, 0.08], head: ['head', 0, 1.7, 0.1] });
}

// glowing growths: tumour sacs (orange) / egg sacs (pink) / healer growths (green); glow value pulses through uGlow
function sacs(g, list, col, glow) {
  for (const [bone, x, y, z, r] of list) {
    g.bone(bone); g.mat(mixC(col, [0.1, 0.06, 0.05], 0.5), 0.55, 0, T_SKIN, 0.3); g.tr(x, y, z); g.sphere(r * 1.12, r * 1.04, r * 1.12, 10, 7); g.pop();
    g.mat(col, 0.3, 0, T_GLOW, glow); g.tr(x * 1.02, y + r * 0.1, z * 1.02 + Math.sign(z || 1) * r * 0.25); g.sphere(r * 0.85, r * 0.8, r * 0.9, 10, 6); g.pop();
    g.mat(C(0x3a1a12), 0.6, 0, T_PEAT, 0.3); for (let k = 0; k < 3; k++) { const a = k * 2.1; g.tube([[x, y, z], [x + Math.cos(a) * r * 1.6, y + Math.sin(a) * r * 1.4, z * 0.98]], 0.004, { seg: 4, sub: 1 }); }
  }
}
function tumourExtra(g, P, e) {
  const s = P.sh;
  sacs(g, [['chest', s * 0.65, 1.47, -0.02, 0.07], ['chest', -s * 0.5, 1.45, -0.06, 0.055], ['chest', 0.05, 1.32, -0.15, 0.085], ['chest', -0.08, 1.22, -0.14, 0.06], ['spine', 0.1, 1.12, -0.13, 0.05],
    ['lUp', s + 0.05, 1.33, 0.02, 0.045], ['spine', -0.12, 1.1, 0.12, 0.05], ['head', 0.05, 1.79, -0.05, 0.045]], C(0xe8904a), 2.4);
}

// big brute body (Hulk, Brute): bare chest, huge arms, small head, torn trousers
function buildBig(seed, o) {
  const Z = variety(seed * 31 + 5), skin = o.skin || Z.tint(Z.pick([C(0x6a7660), C(0x5e6a58), C(0x727a62)]), 0.05);
  const P = { sh: 0.29, hp: 0.125 };
  const { rig, g } = start(P);
  const KL = o.KL || 1.5, KA = o.KA || 1.75, KT = o.KT || 1.4;
  both((s) => {
    g.mat(skin, 0.66, 0, T_SKIN, 1.0); H.leg(g, P, s, { y0: 0.1, y1: 0.6, k: KL * 0.95, wr: 0.04 });
    g.mat(o.pants || C(0x2e3236), 0.97, 0, T_CLOTH, 2.2); H.leg(g, P, s, { y0: 0.34 + (s > 0 ? 0.12 : 0), y1: 0.99, k: KL * 1.03, wr: 0.11, wra: 5, wry: 16 });
    g.mat(skin, 0.66, 0, T_SKIN, 1.0); H.boot(g, P, s, { top: 0.1 });
  });
  g.mat(o.pants || C(0x2e3236), 0.97, 0, T_CLOTH, 1.8); torso(g, { y0: 0.9, y1: 1.08, grow: 0.004, k: KT * 1.02, kz: KT });
  g.mat(skin, 0.66, 0, T_SKIN, 0.9); torso(g, { y0: 0.98, y1: 1.525, k: KT, kz: KT * 1.06, belly: o.belly || 0.04, wr: 0.025 });
  // pecs, traps hump, abdominal ridges
  g.bone('chest'); for (const s of [-1, 1]) { g.tr(s * 0.105, 1.33, torsoFront(1.33, { kz: KT * 1.06 }) - 0.03); g.tr(0, 0, 0, 0, 0, s * 0.25); g.sphere(0.125, 0.07, 0.034, 10, 6); g.pop(); g.pop(); }
  g.bone(chainY([['neck', 9], ['chest', 1.5]], 0.05)); g.loft([{ y: 1.4, rx: 0.24, rz: 0.12, rb: 0.17 }, { y: 1.5, rx: 0.2, rz: 0.1, rb: 0.17 }, { y: 1.58, rx: 0.11, rz: 0.08, rb: 0.12 }, { y: 1.61, rx: 0.06, rz: 0.06, rb: 0.07 }], { seg: 16, sub: 2, cap1: true });
  g.bone(H.TW); g.mat(mixC(skin, [0.03, 0.03, 0.02], 0.35), 0.7, 0, T_SKIN, 0.8); for (let k = 0; k < 3; k++) { const y = 1.2 - k * 0.06; for (const s of [-1, 1]) { g.tr(s * 0.045, y, torsoFront(y, { kz: KT * 1.06, belly: o.belly || 0.04 }) - 0.012); g.sphere(0.04, 0.025, 0.02, 6, 4); g.pop(); } }
  // scars and wounds
  for (let k = 0; k < 4; k++) { const x = Z.rnd(0.2), y = 1.05 + Z.r() * 0.4; g.bone(H.TW); blood(g, x, y, torsoFront(y, { kz: KT * 1.06 }) * Math.cos(x * 2.5) - 0.002, 0.03 + Z.r() * 0.03, 0.05 + Z.r() * 0.05, Z.rnd(1)); }
  g.mat(C(0x24201c), 0.8, 0, T_LEATHER, 1.2); H.belt(g, { grow: 0.08, w: 0.034, col: C(0x24201c) });
  both((s) => {
    g.mat(skin, 0.66, 0, T_SKIN, 0.8); H.arm(g, P, s, { k: KA, wr: 0.03 });
    g.tr(s * (P.sh + 0.03), 0.84, 0); g.tr(0, 0, 0, 0, 0, 0, 1.5); g.tr(-s * (P.sh + 0.03), -0.84, 0); H.fist(g, P, s); g.pop(); g.pop(); g.pop();
    g.bone(s > 0 ? 'lHand' : 'rHand'); g.mat(C(0x2a1a14), 0.6, 0, T_BONE, 0.6); for (let k = 0; k < 4; k++) g.tube([[s * (P.sh + 0.03) - s * 0.04 + s * k * 0.027, 0.77, 0.08], [s * (P.sh + 0.03) - s * 0.04 + s * k * 0.027, 0.74, 0.11]], (t) => 0.006 * (1 - t), { seg: 4, sub: 1 });
    g.bone(s > 0 ? 'lFore' : 'rFore'); g.mat(C(0x3a3430), 0.9, 0, T_CLOTH, 1.0); g.tr(s * (P.sh + 0.025), 0.97, 0); g.lathe([[0.084, -0.05], [0.09, 0.0], [0.086, 0.05]], 12, { thick: 0.006, wr: 0.1 }); g.pop();
  });
  if (o.extra) o.extra(g, P, { skin, Z });
  // small head pushed forward, heavy brow, open jaw
  g.tr(0, 1.56, 0.06); g.tr(0, 0, 0, 0.12, 0, 0, o.headK || 1.0); g.tr(0, -1.585, 0);
  head(g, { skin, zombie: true, hair: C(0x1a1a18), jawDrop: 0.022, eyeGlow: o.eyeGlow || C(0xf0e090), glowK: 2.2, neckK: 1.6 });
  g.bone('head'); g.mat(skin, 0.66, 0, T_SKIN, 0.3); g.loft([{ y: 1.714, rx: 0.074, rz: 0.098, rb: 0.03 }, { y: 1.726, rx: 0.078, rz: 0.106, rb: 0.03 }, { y: 1.738, rx: 0.072, rz: 0.097, rb: 0.03 }], { seg: 12, sub: 1, arc: [0.25, PI - 0.25], thick: 0.006 });
  g.pop(); g.pop(); g.pop();
  return finish(g, rig, P, { hand: ['rHand', -(P.sh + 0.03), 0.8, 0.1], head: ['head', 0, 1.7, 0.1] });
}

/* ------------------------------------------------------------------ zombie styles */
// arm styles (Rust actors.js style 0..4) as carry poses on a hunched body
const ZHUNCH = { hips: [0.08, 0.08, 0.05], spine: [0.24, 0.04, 0.05], chest: [0.12, -0.06, 0.04], neck: [0.22, 0.08, 0.05], head: [-0.22, 0.2, 0.08],
  lThigh: [-0.12, 0.22, 0.08], lShin: [0.24, 0, 0], lFoot: [-0.1, 0, 0], rThigh: [-0.03, -0.28, -0.05], rShin: [0.2, 0, 0], rFoot: [-0.06, 0, 0.1] };
const ZARMS = [
  { lUp: [-1.32, 0.1, 0.14], lFore: [-0.28, 0, 0], lHand: [0.4, 0, 0], rUp: [-1.25, -0.1, -0.14], rFore: [-0.32, 0, 0], rHand: [0.4, 0, 0] },
  { lUp: [-1.3, 0.1, 0.16], lFore: [-0.3, 0, 0], lHand: [0.45, 0, 0], rUp: [0.12, 0, -0.1], rFore: [-0.12, 0, 0], rHand: [0.2, 0, 0] },
  { lUp: [0.14, 0, 0.1], lFore: [-0.1, 0, 0], lHand: [0.25, 0, 0], rUp: [0.1, 0, -0.12], rFore: [-0.18, 0, 0], rHand: [0.25, 0, 0] },
  { lUp: [-2.25, 0.2, 0.35], lFore: [-0.55, 0, 0], lHand: [0.6, 0, 0], rUp: [-2.0, -0.2, -0.35], rFore: [-0.6, 0, 0], rHand: [0.6, 0, 0] },
  { lUp: [-0.9, 0, 0.2], lFore: [-0.65, 0, 0], lHand: [0.5, 0, 0], rUp: [-2.35, 0, -0.3], rFore: [-0.75, 0, 0], rHand: [0.7, 0, 0] },
];
function zombieCarry(armStyle, splay, hunch) {
  const p = Object.assign({}, ZHUNCH, ZARMS[armStyle]);
  p.lUp = [p.lUp[0], p.lUp[1], p.lUp[2] + splay]; p.rUp = [p.rUp[0], p.rUp[1], p.rUp[2] - splay];
  if (hunch) { p.spine = [p.spine[0] + hunch, p.spine[1], p.spine[2]]; p.neck = [p.neck[0] + hunch * 0.5, p.neck[1], p.neck[2]]; p.head = [p.head[0] - hunch, p.head[1], p.head[2]]; }
  return p;
}
function zombieClips(carry, big) {
  const k = big ? 1.15 : 1;
  return {
    attack: mkClip(0.5, [
      { t: 0.36, e: 'out', b: { spine: [0.05, 0, 0], chest: [-0.22, -0.15, 0], neck: [0.0, 0, 0], head: [-0.35, 0, 0], lUp: [-2.6, 0, 0.42], rUp: [-2.6, 0, -0.42], lFore: [-0.9, 0, 0], rFore: [-0.9, 0, 0], lHand: [0.5, 0, 0], rHand: [0.5, 0, 0] }, root: [0, 0.02, -0.08] },
      { t: 0.5, e: 'in', b: { spine: [0.32, 0, 0], chest: [0.18, 0.15, 0], neck: [0.05, 0, 0], head: [-0.2, 0, 0], lUp: [-1.05, 0, 0.12], rUp: [-1.0, 0, -0.12], lFore: [-0.25, 0, 0], rFore: [-0.25, 0, 0], lHand: [0.7, 0, 0], rHand: [0.7, 0, 0], lThigh: [-0.65, 0.1, 0.08], lShin: [0.65, 0, 0], rThigh: [0.1, -0.2, -0.05] }, root: [0, -0.09 * k, 0.32 * k] },
      { t: 0.78, b: { spine: [0.28, 0, 0], chest: [0.14, 0, 0], head: [-0.15, 0, 0] }, root: [0, -0.06, 0.26 * k] }], carry),
    smash: mkClip(0.55, [
      { t: 0.36, e: 'out', b: { spine: [-0.15, 0, 0], chest: [-0.28, -0.1, 0], head: [-0.35, 0, 0], rUp: [-2.95, 0, -0.25], rFore: [-0.6, 0, 0], lUp: [-2.95, 0, 0.25], lFore: [-0.6, 0, 0] }, root: [0, 0.05, -0.1] },
      { t: 0.55, e: 'in', b: { spine: [0.45, 0, 0], chest: [0.3, 0, 0], head: [-0.15, 0, 0], rUp: [-1.0, 0, 0.05], rFore: [-0.15, 0, 0], lUp: [-1.0, 0, -0.05], lFore: [-0.15, 0, 0], lShin: [0.8, 0, 0], rShin: [0.7, 0, 0], lThigh: [-0.8, 0.15, 0.1], rThigh: [-0.35, -0.15, -0.1] }, root: [0, -0.2, 0.25] },
      { t: 0.82, b: {}, root: [0, -0.18, 0.22] }], carry),
    // Brute ground slam (driven by act_t over 2.0 s; hit at the end)
    slam: mkClip(0.86, [
      { t: 0.22, e: 'out', b: { spine: [0.35, 0, 0], chest: [0.2, 0, 0], head: [-0.4, 0, 0], lUp: [-0.4, 0, 0.8], rUp: [-0.4, 0, -0.8], lFore: [-1.2, 0, 0], rFore: [-1.2, 0, 0], lShin: [0.5, 0, 0], rShin: [0.5, 0, 0], lThigh: [-0.5, 0.2, 0.15], rThigh: [-0.5, -0.2, -0.15] }, root: [0, -0.12, 0] },
      { t: 0.66, e: 'io', b: { spine: [-0.25, 0, 0], chest: [-0.35, 0, 0], head: [-0.45, 0, 0], lUp: [-3.0, 0, 0.3], rUp: [-3.0, 0, -0.3], lFore: [-0.5, 0, 0], rFore: [-0.5, 0, 0], lShin: [0.1, 0, 0], rShin: [0.1, 0, 0] }, root: [0, 0.08, -0.08] },
      { t: 0.86, e: 'in', b: { spine: [0.8, 0, 0], chest: [0.5, 0, 0], head: [0.3, 0, 0], lUp: [-0.9, 0, 0.1], rUp: [-0.9, 0, -0.1], lFore: [-0.05, 0, 0], rFore: [-0.05, 0, 0], lShin: [1.1, 0, 0], rShin: [1.0, 0, 0], lThigh: [-1.0, 0.2, 0.12], rThigh: [-0.7, -0.2, -0.12] }, root: [0, -0.32, 0.12] },
      { t: 0.95, b: { spine: [0.75, 0, 0], chest: [0.45, 0, 0] }, root: [0, -0.3, 0.12] }], carry),
    // Brute throw (act_t over 2.33 s): squat and rip up a chunk, lift it overhead, hurl it at the end
    throw: mkClip(0.86, [
      { t: 0.25, e: 'io', b: { spine: [0.7, 0, 0], chest: [0.4, 0, 0], head: [0.1, 0, 0], lUp: [-1.1, 0, 0.2], rUp: [-1.1, 0, -0.2], lFore: [-0.3, 0, 0], rFore: [-0.3, 0, 0], lShin: [1.0, 0, 0], rShin: [1.0, 0, 0], lThigh: [-1.0, 0.2, 0.15], rThigh: [-1.0, -0.2, -0.15] }, root: [0, -0.3, 0] },
      { t: 0.6, e: 'io', b: { spine: [-0.3, 0, 0], chest: [-0.35, -0.3, 0], head: [-0.3, 0.2, 0], lUp: [-2.8, 0, 0.35], rUp: [-2.9, 0, -0.35], lFore: [-1.2, 0, 0], rFore: [-1.2, 0, 0], rThigh: [0.3, -0.2, -0.1] }, root: [0, 0.03, -0.12] },
      { t: 0.86, e: 'snap', b: { spine: [0.55, 0, 0], chest: [0.45, 0.4, 0], head: [0.2, 0, 0], lUp: [-1.3, 0, 0.2], rUp: [-1.2, 0, -0.1], lFore: [-0.1, 0, 0], rFore: [-0.1, 0, 0], lThigh: [-0.7, 0.1, 0.1], lShin: [0.6, 0, 0] }, root: [0, -0.1, 0.3] },
      { t: 0.95, b: { spine: [0.45, 0, 0], chest: [0.35, 0.3, 0] }, root: [0, -0.08, 0.28] }], carry),
    roar: mkClip(0.4, [
      { t: 0.2, e: 'out', b: { spine: [0.4, 0, 0], chest: [0.2, 0, 0], head: [0.3, 0, 0], lUp: [-0.3, 0, 0.3], rUp: [-0.3, 0, -0.3], lFore: [-1.4, 0, 0], rFore: [-1.4, 0, 0] }, root: [0, -0.08, 0] },
      { t: 0.4, e: 'out', b: { spine: [-0.25, 0, 0], chest: [-0.35, 0, 0], neck: [-0.1, 0, 0], head: [-0.45, 0, 0], lUp: [-0.6, 0, 1.25], rUp: [-0.6, 0, -1.25], lFore: [-0.8, 0, 0], rFore: [-0.8, 0, 0], lHand: [0.6, 0, 0], rHand: [0.6, 0, 0], lThigh: [-0.4, 0.3, 0.2], rThigh: [0.15, -0.3, -0.2], lShin: [0.4, 0, 0] }, root: [0, -0.06, 0.03] },
      { t: 0.8, b: { spine: [-0.25, 0, 0], chest: [-0.38, 0, 0], neck: [-0.1, 0, 0], head: [-0.5, 0, 0], lUp: [-0.6, 0, 1.3], rUp: [-0.6, 0, -1.3], lFore: [-0.75, 0, 0], rFore: [-0.75, 0, 0], lThigh: [-0.4, 0.3, 0.2], rThigh: [0.15, -0.3, -0.2], lShin: [0.4, 0, 0] }, root: [0, -0.06, 0.03] }], carry),
    // Sweaty jump, driven by air 5 -> 0 s: crouch, launch, tuck in the air, land in a crouch
    jump: mkClip(0.5, [
      { t: 0.08, e: 'out', b: { spine: [0.5, 0, 0], chest: [0.3, 0, 0], lUp: [0.4, 0, 0.3], rUp: [0.4, 0, -0.3], lShin: [1.2, 0, 0], rShin: [1.2, 0, 0], lThigh: [-1.1, 0.2, 0.1], rThigh: [-1.1, -0.2, -0.1], lFoot: [-0.4, 0, 0], rFoot: [-0.4, 0, 0] }, root: [0, -0.35, 0] },
      { t: 0.16, e: 'snap', b: { spine: [-0.1, 0, 0], chest: [-0.15, 0, 0], head: [-0.3, 0, 0], lUp: [-2.9, 0, 0.4], rUp: [-2.9, 0, -0.4], lFore: [-0.3, 0, 0], rFore: [-0.3, 0, 0], lShin: [0.2, 0, 0], rShin: [0.2, 0, 0], lThigh: [0.1, 0, 0], rThigh: [0.1, 0, 0], lFoot: [0.6, 0, 0], rFoot: [0.6, 0, 0] }, root: [0, 0.05, 0] },
      { t: 0.5, b: { spine: [0.4, 0, 0], chest: [0.25, 0, 0], head: [0.1, 0, 0], lUp: [-1.6, 0, 1.0], rUp: [-1.6, 0, -1.0], lFore: [-0.6, 0, 0], rFore: [-0.6, 0, 0], lShin: [1.5, 0, 0], rShin: [1.4, 0, 0], lThigh: [-1.3, 0.2, 0.2], rThigh: [-1.2, -0.2, -0.2] } },
      { t: 0.86, b: { spine: [0.1, 0, 0], chest: [0.0, 0, 0], head: [0.3, 0, 0], lUp: [-0.8, 0, 1.0], rUp: [-0.8, 0, -1.0], lFore: [-0.3, 0, 0], rFore: [-0.3, 0, 0], lShin: [0.3, 0, 0], rShin: [0.3, 0, 0], lThigh: [-0.3, 0.2, 0.2], rThigh: [-0.3, -0.2, -0.2] } },
      { t: 0.94, e: 'in', b: { spine: [0.6, 0, 0], chest: [0.3, 0, 0], head: [-0.1, 0, 0], lUp: [-0.8, 0, 0.6], rUp: [-0.8, 0, -0.6], lShin: [1.2, 0, 0], rShin: [1.2, 0, 0], lThigh: [-1.1, 0.25, 0.15], rThigh: [-1.1, -0.25, -0.15], lFoot: [-0.3, 0, 0], rFoot: [-0.3, 0, 0] }, root: [0, -0.36, 0] }], carry),
    // death: knees buckle, then the body pitches face-down (driven by fall 0..1 over the 0.55 s dying time)
    die: mkClip(0.5, [
      { t: 0.3, e: 'out', b: { spine: [0.5, 0, 0.15], chest: [0.3, 0.2, 0], head: [-0.4, 0.3, 0], lUp: [-2.4, 0, 0.6], rUp: [-1.9, 0, -0.9], lFore: [-0.4, 0, 0], rFore: [-0.6, 0, 0], lThigh: [-0.7, 0.1, 0.1], lShin: [1.0, 0, 0], rThigh: [-0.45, -0.1, -0.1], rShin: [1.15, 0, 0] }, root: [0, -0.32, 0] },
      { t: 0.84, e: 'in', b: { root: [1.42, 0, 0], hips: [0, 0.15, 0.1], spine: [0.05, 0, 0.12], chest: [0.0, 0.25, 0], neck: [0.0, 0, 0], head: [-0.25, 1.1, 0.1], lUp: [-2.7, 0.3, 0.55], rUp: [-0.4, 0, -0.75], lFore: [-0.5, 0, 0], rFore: [-0.9, 0.5, 0], lHand: [0.2, 0, 0], rHand: [0.3, 0, 0], lThigh: [0.0, 0.15, 0.18], lShin: [0.35, 0, 0], rThigh: [-0.35, -0.2, -0.05], rShin: [0.9, 0, 0], lFoot: [0.9, 0, 0], rFoot: [0.7, 0, 0] }, root: [0, 0.0, 0.0] }], carry),
  };
}
function zombieStyle(carry, gait, big) {
  return style({ carry, ready: carry, readyRoot: 0, clips: zombieClips(carry, big), swingL: 0.3, swingR: 0.35, gait, downPose: DOWN_POSE });
}

/* ------------------------------------------------------------------ catalogue */
export const HUMAN_LOOKS = 16, ZOMBIE_LOOKS = 10;
const mix32 = (a) => { a = Math.imul(a ^ (a >>> 16), 0x45d9f3b); a = Math.imul(a ^ (a >>> 16), 0x45d9f3b); return (a ^ (a >>> 16)) >>> 0; };

// human def for (look, role); role: 'customer' | 'staff' | 'candidate' | 'survivor' | 'scavenger' | 'merchant'
export function humanDef(seed, role) {
  role = role || 'customer';
  let look = seed % HUMAN_LOOKS, L, extra = null, key;
  if (role === 'survivor') { L = pickLook(0x51a7, { female: false, top: 'jacket', headwear: 'cap' }); L.bag = 'none'; L.scarf = true; extra = survivorGear; key = 'h:survivor'; }
  else if (role === 'scavenger') { L = pickLook(0x0bad, { female: true, top: 'hoodie', headwear: 'hood' }); L.bag = 'none'; L.mask = true; L.glasses = false; extra = scavengerGear; key = 'h:scavenger'; }
  else if (role === 'crew') { L = pickLook(2000 + (seed % 5) * 131, { female: false, headwear: 'none' }); L.bag = 'none'; L.mask = false; L.scarf = false; L.glasses = false; L.headwear = 'none'; if (L.hair === 'long') L.hair = 'short'; extra = crewGear; key = 'h:crew:' + (seed % 5); }
  else if (role === 'merchant') { L = pickLook(0x7e11, { female: false, top: 'coat', headwear: 'none' }); L.bag = 'none'; L.beard = 0.8; L.stubble = false; extra = merchantGear; key = 'h:merchant'; }
  else {
    L = pickLook(1000 + look * 7919);
    if (role === 'staff') { L.bag = 'none'; L.mask = false; if (L.headwear === 'hood') L.headwear = 'none'; extra = staffGear(L); key = 'h:staff:' + look; }
    else key = 'h:' + look;
  }
  const fem = L.fem;
  const build = () => { const f = buildHuman(L, (g, P, L2) => { if (role === 'customer' || role === 'candidate') basket(g, P); crate(g); if (extra) extra(g, P, L2); }); return f; };
  const hidden = ['lanB'].concat(role === 'customer' || role === 'candidate' ? ['lan'] : []).concat(role === 'staff' ? ['wR'] : []);
  return { key, build, style: humanStyle(fem), female: fem, scale: L.height, kind: 'human', role, hidden, look };
}

// zombie def; kind: Base Tumour Hulk Brute Birther Baby Sweaty TwinBuff TwinHeal
export function zombieDef(seed, kind) {
  const h = mix32(seed + 0x9e37), K = 1.78 / 1.81;
  switch (kind) {
    case 'Tumour': { const v = h % 3; return { key: 'z:tumour:' + v, kind, build: () => buildZombie(5003 + v * 7717, { bloat: true, extra: tumourExtra, ribs: false }), glowPulse: [C(0xe8904a), 2.4], style: null, scale: 1.0, hidden: [] }; }
    case 'Hulk': { const v = h % 2; return { key: 'z:hulk:' + v, kind, big: true, build: () => buildBig(7000 + v * 31, {}), scale: 1.5 * K, hidden: [] }; }
    case 'Brute': return { key: 'z:brute', kind, big: true, build: () => buildBig(9100, { skin: C(0x6a7460), KA: 2.0, KT: 1.5, KL: 1.55, headK: 0.92, eyeGlow: C(0xff9040), extra: bruteExtra }), scale: 2.0 * K, hidden: [] };
    case 'Birther': return { key: 'z:birther', kind, build: () => buildZombie(9200, { female: true, bloat: true, extra: birtherExtra, ribs: false }), scale: 1.7 * K, hidden: [], belly: true };
    case 'Baby': { const v = h % 2; return { key: 'z:baby:' + v, kind, build: () => buildBaby(9300 + v), scale: 0.55 * K, hidden: [] }; }
    case 'Sweaty': return { key: 'z:sweaty', kind, build: () => buildSweaty(9400), scale: 2.2 * K, hidden: [] };
    case 'TwinBuff': return { key: 'z:twinbuff', kind, build: () => buildTwin(9500, false), scale: 1.2 * K, hidden: [], aura: C(0xff3a2a) };
    case 'TwinHeal': return { key: 'z:twinheal', kind, build: () => buildTwin(9600, true), scale: 1.2 * K, hidden: [], aura: C(0x4aff8a), glowPulse: [C(0x6fc88a), 2.2] };
    default: { const v = h % ZOMBIE_LOOKS; return { key: 'z:base:' + v, kind: 'Base', build: () => buildZombie(3001 + v * 4993), scale: 1.0, hidden: [] }; }
  }
}
function bruteExtra(g, P, e) {
  // bone spikes on each shoulder, scrap-metal chest plate with rivets, chain round the waist
  for (const s of [-1, 1]) { g.bone(s > 0 ? 'lUp' : 'rUp'); g.mat(C(0xcfc6a8), 0.6, 0, T_BONE, 0.6); for (let k = 0; k < 3; k++) g.tube([[s * (P.sh + 0.07), 1.5 - k * 0.04, -0.05 + k * 0.05], [s * (P.sh + 0.14), 1.66 - k * 0.05, -0.08 + k * 0.05]], (t) => 0.022 * (1 - t * 0.9), { seg: 6, sub: 1 }); }
  g.bone('chest'); g.mat(C(0x4a4e52), 0.5, 0.85, T_PLATE, 1.6);
  const z = torsoFront(1.28, { kz: 1.5 * 1.06 }) + 0.02;
  g.tr(0, 1.27, z - 0.03); g.surf(8, 6, (u, v) => [(u - 0.5) * 0.34, (v - 0.5) * 0.26, 0.04 * Math.sin(u * PI) + 0.01 * Math.sin(v * PI)], { thick: 0.008 });
  g.mat(C(0x6a6660), 0.4, 0.9, T_PLATE, 1.0); for (const [x, y] of [[-0.15, -0.11], [0.15, -0.11], [-0.15, 0.11], [0.15, 0.11]]) { g.tr(x, y, 0.012); g.sphere(0.01, 0.01, 0.008, 5, 3); g.pop(); } g.pop();
  g.bone('hips'); g.mat(C(0x5a5650), 0.45, 0.9, T_MAIL, 1.2); { const r = samp(1.0); const pts = []; for (let i = 0; i <= 24; i++) { const a = i / 24 * TAU; pts.push([Math.cos(a) * (r[1] * 1.55 + 0.1), 0.99 + 0.03 * Math.sin(a * 3), Math.sin(a) * ((Math.sin(a) > 0 ? r[2] : r[3]) * 1.55 + 0.1)]); } g.tube(pts, 0.014, { seg: 6, sub: 1, cap: false }); }
}
function birtherExtra(g, P, e) {
  // grotesquely swollen belly with pink glowing egg sacs
  g.bone('spine'); g.mat(mixC(e.skin, [0.5, 0.35, 0.3], 0.25), 0.55, 0, T_SKIN, 0.6);
  g.tr(0, 1.1, 0.1); g.sphere(0.2, 0.22, 0.2, 16, 12); g.pop();
  sacs(g, [['spine', 0.08, 1.18, 0.27, 0.05], ['spine', -0.1, 1.12, 0.27, 0.045], ['spine', 0.02, 1.02, 0.28, 0.055], ['spine', 0.14, 1.06, 0.22, 0.04], ['spine', -0.15, 1.24, 0.2, 0.04], ['spine', -0.03, 1.27, 0.24, 0.035]], C(0xe89a9a), 2.0);
}
function buildBaby(seed) {
  const Z = variety(seed), skin = Z.tint(C(0xb09a8a), 0.04);
  const P = { sh: 0.17, hp: 0.088 };
  const { rig, g } = start(P);
  both((s) => { g.mat(skin, 0.6, 0, T_SKIN, 1.0); H.leg(g, P, s, { y0: 0.1, y1: 0.99, k: 1.08 }); H.boot(g, P, s, { top: 0.1 }); });
  g.mat(C(0x7a7a9a), 0.95, 0, T_CLOTH, 1.6); both((s) => H.leg(g, P, s, { y0: 0.76, y1: 0.99, grow: 0.01, k: 1.12, wr: 0.08 }));
  torso(g, { y0: 0.9, y1: 1.08, grow: 0.012, k: 0.95 });
  g.mat(skin, 0.6, 0, T_SKIN, 0.8); torso(g, { y0: 1.0, y1: 1.525, k: 0.88, kz: 1.05, belly: 0.05 });
  both((s) => { g.mat(skin, 0.6, 0, T_SKIN, 0.8); H.arm(g, P, s, { k: 1.0 }); H.fist(g, P, s); g.bone(s > 0 ? 'lHand' : 'rHand'); g.mat(C(0x2a1a14), 0.6, 0, T_BONE, 0.5); for (let k = 0; k < 3; k++) g.tube([[s * (P.sh + 0.03) - s * 0.02 + s * k * 0.02, 0.8, 0.055], [s * (P.sh + 0.03) - s * 0.02 + s * k * 0.02, 0.775, 0.08]], (t) => 0.004 * (1 - t), { seg: 4, sub: 1 }); });
  g.bone(H.TW); blood(g, 0.05, 1.2, torsoFront(1.2, { kz: 1.05, belly: 0.05 }), 0.05, 0.08, 0.3);
  head(g, { skin, zombie: true, hair: C(0x3a2a20), headK: 1.45, jawDrop: 0.016, eyeGlow: C(0xfff0c0), glowK: 2.0 });
  g.tr(0, 1.56, 0); g.tr(0, 0, 0, 0, 0, 0, 1.45); g.tr(0, -1.56, 0); g.bone('head'); g.mat(C(0x3a2a20), 0.95, 0, T_FUR, 0.3); g.loft([{ y: 1.7, rx: 0.08, rz: 0.06, rb: 0.104 }, { y: 1.77, rx: 0.074, rz: 0.08, rb: 0.096 }, { y: 1.805, rx: 0.04, rz: 0.04, rb: 0.05 }], { seg: 12, sub: 2, arc: [PI * 0.9, TAU + 0.2], wr: 0.25, wra: 7, wry: 30 }); g.pop(); g.pop(); g.pop();
  return finish(g, rig, P, { head: ['head', 0, 1.7, 0.1] });
}
function buildSweaty(seed) {
  const Z = variety(seed), skin = C(0xa5a88c);
  const P = { sh: 0.23, hp: 0.12 };
  const { rig, g } = start(P);
  both((s) => { g.mat(skin, 0.38, 0, T_SKIN, 1.0); H.leg(g, P, s, { y0: 0.1, y1: 0.99, k: 1.55, wr: 0.05 }); H.boot(g, P, s, { top: 0.1 }); });
  g.mat(C(0x4a4a52), 0.95, 0, T_CLOTH, 2.0); both((s) => H.leg(g, P, s, { y0: 0.62, y1: 0.99, grow: 0.012, k: 1.6, wr: 0.08 }));
  torso(g, { y0: 0.9, y1: 1.08, grow: 0.012, k: 1.62, kz: 1.6 });
  g.mat(skin, 0.36, 0.0, T_SKIN, 0.8); torso(g, { y0: 0.98, y1: 1.525, k: 1.6, kz: 1.55, belly: 0.16, wr: 0.04 });
  // sagging folds, stained undershirt scrap, sweat sheen comes from low roughness
  g.bone('spine'); g.mat(mixC(skin, [0.05, 0.05, 0.03], 0.25), 0.4, 0, T_SKIN, 0.8); g.tr(0, 1.0, torsoFront(1.0, { kz: 1.55, belly: 0.16 }) - 0.05); g.sphere(0.24, 0.05, 0.08, 14, 6); g.pop();
  g.mat(C(0x8a8670), 0.95, 0, T_CLOTH, 1.6); torso(g, { y0: 1.18, y1: 1.48, grow: 0.012, k: 1.6, kz: 1.55, belly: 0.16, arc: [PI / 2 + 0.4, PI / 2 - 0.4 + TAU], thick: 0.004, wr: 0.12, wra: 6, wry: 20 });
  g.bone(H.TW); for (let k = 0; k < 3; k++) { const x = Z.rnd(0.2), y = 1.1 + Z.r() * 0.3; blood(g, x, y, torsoFront(y, { kz: 1.55, belly: 0.16 }) * Math.cos(x * 2) + 0.003, 0.04, 0.06, Z.rnd(1)); }
  both((s) => { g.mat(skin, 0.38, 0, T_SKIN, 0.8); H.arm(g, P, s, { k: 1.6, wr: 0.04 }); H.fist(g, P, s); });
  g.tr(0, 1.54, 0.05); g.tr(0, 0, 0, 0.05, 0, 0, 1.05); g.tr(0, -1.585, 0);
  head(g, { skin, zombie: true, hair: C(0x2a2a24), jawDrop: 0.02, neckK: 1.9, eyeGlow: C(0xf0f0c0), glowK: 2.0 });
  g.bone('head'); g.mat(skin, 0.4, 0, T_SKIN, 0.3); g.tr(0, 1.555, 0.04); g.sphere(0.075, 0.035, 0.07, 10, 6); g.pop(); // double chin
  g.pop(); g.pop(); g.pop();
  return finish(g, rig, P, { head: ['head', 0, 1.7, 0.1] });
}
function buildTwin(seed, heal) {
  const skin = heal ? C(0x7a8a74) : C(0x8a7a6a);
  const P = { sh: heal ? 0.17 : 0.205, hp: 0.098 };
  const { rig, g } = start(P);
  const F = 1, tk = heal ? 0.9 : 1.08;
  const pantsC = heal ? C(0x3f6a52) : C(0x4a4838), topC = heal ? C(0x3f6a52) : C(0x7a2e2a);
  both((s) => { g.mat(pantsC, 0.95, 0, T_CLOTH, 1.6); H.leg(g, P, s, { y0: 0.24, y1: 0.99, k: heal ? 0.98 : 1.1, wr: 0.06 }); g.mat(C(0x2a2622), 0.8, 0, T_LEATHER, 2.0); H.boot(g, P, s, { top: 0.28 }); if (!heal) { g.bone(s > 0 ? 'lThigh' : 'rThigh'); g.mat(mixC(pantsC, [0, 0, 0], 0.2), 0.95, 0, T_CLOTH, 1.2); g.tr(s * (P.hp + 0.075), 0.66, 0.0, 0, s * 1.4, 0); patch(g, 0, 0, 0, 0.1, 0.12, { bow: 0.012, flap: true, thick: 0.006 }); g.pop(); } });
  g.mat(pantsC, 0.95, 0, T_CLOTH, 1.4); torso(g, { y0: 0.9, y1: 1.08, grow: 0.004, fem: F, k: tk });
  if (heal) { // scrubs: v-neck top with short sleeves
    g.mat(topC, 0.95, 0, T_CLOTH, 1.2); torso(g, { y0: 0.96, y1: 1.5, grow: 0.014, fem: F, k: tk, wr: 0.05 });
    g.mat(skin, 0.6, 0, T_SKIN, 0.6); bareArms(g, P, skin, { k: 0.86, y1: 1.25 }); both((s) => { g.mat(topC, 0.95, 0, T_CLOTH, 0.8); H.arm(g, P, s, { y0: 1.2, grow: 0.012, k: 0.95, cap1: true, wr: 0.08 }); });
    g.bone(H.TW); g.mat(C(0x2a3a30), 0.9, 0, T_CLOTH, 0.5); { const z = torsoFront(1.15, { fem: F, grow: 0.014 }) + 0.003; g.tr(-0.07, 1.36, torsoFront(1.36, { fem: F, grow: 0.014 }) + 0.003); patch(g, 0, 0, 0, 0.07, 0.07, { bow: 0.004 }); g.pop(); }
  } else { // tank top over strong shoulders
    g.mat(skin, 0.6, 0, T_SKIN, 0.6); torso(g, { y0: 1.3, y1: 1.525, fem: F, k: tk });
    g.mat(topC, 0.95, 0, T_CLOTH, 1.0); torso(g, { y0: 0.98, y1: 1.46, grow: 0.01, fem: F, k: tk, wr: 0.04 });
    bareArms(g, P, skin, { k: 1.1 });
  }
  hands(g, P, skin);
  H.belt(g, { grow: 0.012, w: 0.02, col: C(0x24201c) });
  g.bone(H.TW); blood(g, 0.06, 1.15, torsoFront(1.15, { fem: F, grow: 0.014, k: tk }), 0.04, 0.07, 0.4);
  head(g, { skin, female: true, zombie: true, hair: heal ? C(0x2a2018) : C(0x1a1512), jawDrop: 0.006, eyeGlow: heal ? C(0x8affb0) : C(0xff6a50), glowK: 2.6 });
  hair(g, 'long', heal ? C(0x2a2018) : C(0x1a1512), true);
  if (heal) sacs(g, [['chest', 0.1, 1.44, -0.08, 0.04], ['chest', -0.06, 1.3, -0.13, 0.05], ['lUp', P.sh + 0.05, 1.3, 0.0, 0.035], ['spine', 0.08, 1.12, 0.1, 0.035], ['head', -0.06, 1.77, -0.05, 0.03]], C(0x6fc88a), 2.2);
  else { // red veins glowing on arms
    both((s) => { g.bone(jb(s > 0 ? 'lUp' : 'rUp', s > 0 ? 'lFore' : 'rFore', 1.14, 0.05)); g.mat(C(0xff3a2a), 0.4, 0, T_GLOW, 1.2); g.tube([[s * (P.sh + 0.06), 1.36, 0.02], [s * (P.sh + 0.07), 1.22, 0.035], [s * (P.sh + 0.06), 1.08, 0.04], [s * (P.sh + 0.05), 0.95, 0.03]], 0.003, { seg: 4, sub: 3 }); });
  }
  return finish(g, rig, P, { head: ['head', 0, 1.7, 0.1] });
}

// per-instance zombie style from the seed (Rust actors.js zombie_pose: gait = seed%4, arms = floor(seed/7)%5, splay = floor(seed/3)%4)
const ZGAIT = [{ bounce: 1.5, sway: 2.2, lean: 0.5, lift: 0.5 }, { bounce: 1.7, sway: 2.6, lean: 0.4, lift: 0.6 }, { bounce: 1.4, sway: 2.0, lean: 0.6, lift: 0.4 }, { bounce: 1.3, sway: 1.6, lean: 1.4, lift: 0.9 }];
const _styleCache = new Map();
export function zombieInstanceStyle(seed, kind, big) {
  let gait = 0, arms = 0, sp = 0.06, hunch = 0;
  if (kind === 'Base' || kind === 'Tumour') { gait = seed % 4; arms = Math.trunc(seed / 7) % 5; sp = 0.06 + (Math.trunc(seed / 3) % 4) * 0.05; hunch = (mix32(seed) % 5) * 0.04; }
  else if (kind === 'Baby') { arms = 0; hunch = 0.35; }
  else if (big || kind === 'Sweaty') { arms = 2; sp = big ? 0.3 : 0.45; hunch = 0.08; }
  else if (kind === 'Birther') { arms = 2; sp = 0.25; hunch = -0.1; }
  else { arms = kind === 'TwinBuff' ? 4 : 1; sp = 0.12; }
  const key = kind + ':' + gait + ':' + arms + ':' + sp.toFixed(2) + ':' + hunch.toFixed(2) + (big ? 'B' : '');
  let st = _styleCache.get(key);
  if (!st) {
    let carry = zombieCarry(arms, sp, hunch);
    if (big) carry = Object.assign({}, carry, { lUp: [0.0, 0, 0.42], rUp: [-0.1, 0, -0.42], lFore: [-0.45, 0, 0], rFore: [-0.55, 0, 0], spine: [0.22, 0, 0], chest: [0.18, 0, 0], neck: [0.05, 0, 0], head: [-0.3, 0, 0], lThigh: [-0.2, 0.3, 0.14], rThigh: [0.0, -0.3, -0.14], lShin: [0.25, 0, 0], rShin: [0.15, 0, 0] });
    if (kind === 'Sweaty') carry = Object.assign({}, carry, { lUp: [0.0, 0, 0.55], rUp: [0.0, 0, -0.55], lFore: [-0.3, 0, 0], rFore: [-0.3, 0, 0], spine: [0.0, 0, 0], chest: [-0.05, 0, 0], neck: [0.1, 0, 0], head: [-0.1, 0, 0], lThigh: [-0.1, 0.35, 0.2], rThigh: [-0.1, -0.35, -0.2] });
    if (kind === 'Birther') carry = Object.assign({}, carry, { lUp: [-0.5, 0, 0.35], lFore: [-1.2, 0.6, 0], rUp: [-0.35, 0, -0.35], rFore: [-1.3, -0.6, 0], spine: [-0.12, 0, 0], chest: [0.15, 0, 0], head: [0.0, 0.1, 0.05] });
    const g = big ? { bounce: 1.4, sway: 2.0, lean: 0.6, lift: 0.8 } : kind === 'Sweaty' ? { bounce: 1.8, sway: 2.8, lean: 0.4, lift: 0.6 } : kind === 'Baby' ? { bounce: 1.8, sway: 1.4, lean: 1.4, lift: 1.4 } : kind.startsWith('Twin') ? { bounce: 1.0, sway: 1.4, lean: 1.0, lift: 1.0 } : ZGAIT[gait];
    st = zombieStyle(carry, g, big);
    st.gaitId = gait; st.armId = arms;
    if (arms === 2) { st.swingL = 0.9; st.swingR = 0.9; }
    _styleCache.set(key, st);
  }
  return st;
}
export { CRATE_AT };
