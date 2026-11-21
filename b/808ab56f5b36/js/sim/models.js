// Port of src/models.rs.
//! Mô hình dựng bằng code từ nhiều chi tiết nhỏ (lathe, ống, viên nang, đùn, hộp vát cạnh), gộp thành một mesh:
//! xe bán tải, mặt tiền quán, quầy, kệ, cây, người và zombie low-poly, vũ khí cầm tay.

import { v3, v2, ZERO, Y, Z, signum } from './vec.js';
import {
  MB, hex, shade, m4_mul, m4_translate, m4_rot_x, m4_rot_y, m4_rot_z, m4_scale,
  FLAT, WOOD, CONCRETE, CORRUGATED, GROUND, PLASTER, CARDBOARD, GLASS, STRIPES, METAL,
} from './geom.js';
import * as game from './game.js';
import * as lay from './lay.js';
import * as items from './items.js';
import * as build from './build.js';
import * as guns from './guns.js';
import * as scene from './scene.js';
import * as player from './player.js';

function v(x, y, z) {
  return v3(x, y, z);
}

const TAU = Math.PI * 2;

// Bẫy gấu theo cỡ prefab gốc BearTrapItemPrefab (AABB 1,37 x 0,13 x 0,85 m): hai hàm bán nguyệt bán kính 0,42 m bản lề ở hai
// đầu trục x, hai lá lò xo chìa ra tới +-0,68 m với khoen ở đầu, tấm đạp đỏ giữa. fin-build đợt 6: thay bẫy tròn 0,6 m (nhỏ hơn
// gốc, JEEYS ep25 36:08 bẫy cầm tay chiếm gần nửa màn ở 1 m).
const TRAP_R = 0.42;
function trap_frame(mb, steel, dark) {
  mb.cube(v(0.0, 0.012, 0.0), v(0.84, 0.024, 0.06), dark, METAL); // thanh đáy nối hai bản lề
  mb.cube(v(0.0, 0.012, 0.0), v(0.06, 0.024, 0.34), dark, METAL);
  mb.cyl(v(0.0, 0.02, 0.0), 0.12, 0.12, 0.02, 12, dark, METAL);
  mb.cube(v(0.0, 0.045, 0.0), v(0.16, 0.012, 0.16), hex(0x8a3a2a), METAL); // tấm đạp
  for (const sx of [-1, 1]) {
    // lá lò xo: từ bản lề chìa ra ngoài, hơi cong lên, khoen tròn ôm bản lề ở đầu
    mb.cube(v(sx * 0.55, 0.035, 0.0), v(0.26, 0.022, 0.075), steel, METAL);
    mb.cube(v(sx * 0.39, 0.02, 0.0), v(0.08, 0.04, 0.09), dark, METAL);
    const loop = [];
    for (let k = 0; k <= 12; k++) { const t = (k / 12) * TAU; loop.push(v(sx * (0.62 + Math.cos(t) * 0.05), 0.06 + Math.sin(t) * 0.05, 0.0)); }
    mb.sweep(loop, 0.012, 4, steel, METAL);
  }
}
/** Một hàm bán nguyệt quanh trục x, `up` = góc dựng (0 nằm phẳng về phía `side` z, pi/2 đứng thẳng); răng hướng vào trong. */
function trap_jaw(mb, side, up, ry, steel) {
  const path = [], teeth = [];
  for (let k = 0; k <= 16; k++) {
    const t = (k / 16) * Math.PI;
    const x = -Math.cos(t) * TRAP_R, r = Math.sin(t) * (ry !== null ? ry : TRAP_R);
    path.push(v(x, 0.02 + Math.sin(up) * r, side * Math.cos(up) * r));
    if (k > 0 && k < 16) teeth.push([x, r]);
  }
  mb.sweep(path, 0.016, 5, steel, METAL);
  for (const [x, r] of teeth) {
    // răng tam giác nhỏ trên mép hàm, chĩa lên khi hàm nằm, chĩa vào giữa khi hàm dựng
    const rr = r - 0.03;
    mb.push(m4_mul(m4_translate(v(x, 0.02 + Math.sin(up) * rr, side * Math.cos(up) * rr)), m4_rot_x(-side * up)));
    mb.lathe(ZERO, [[0.014, 0.0], [0.0, 0.055]], 4, false, steel, METAL);
    mb.pop();
  }
}
/** Bẫy gấu chưa giương (thả từ ba lô, gốc clip 08 13:15, JEEYS ep25 36:08): khung vẫn rộng và thấp như prefab gốc (viền trắng
 * của bẫy cầm tay là hình dẹt), hai hàm hơi dựng (0,45 rad) để phân biệt với bẫy đã giương nằm phẳng. */
export function bear_trap_closed(mb) {
  const steel = hex(0x8a9096), dark = hex(0x24272a);
  trap_frame(mb, steel, dark);
  for (const side of [-1, 1]) trap_jaw(mb, side, 0.45, null, steel);
}
/** Bẫy gấu đã giương: hai hàm mở nằm phẳng thành vòng 0,84 m, răng chĩa lên. */
export function bear_trap_open(mb) {
  const steel = hex(0x8a9096), dark = hex(0x24272a);
  trap_frame(mb, steel, dark);
  for (const side of [-1, 1]) trap_jaw(mb, side, 0.0, null, steel);
}

const TOP_H = new Map();
/** Độ cao mặt trên cùng của vật dựng `item` (đỉnh cao nhất của hình models.placed), để đặt đồ trang trí lên mặt. Có cache. */
export function top_h(item) {
  let h = TOP_H.get(item);
  if (h === undefined) {
    const mb = new MB();
    placed(mb, item);
    h = 0.0;
    for (const q of mb.p) h = Math.max(h, q[1]);
    TOP_H.set(item, h);
  }
  return h;
}

/** Dây thép gai dựng (món BARBED, vật dựng 'Wire'): cuộn concertina thấp nằm sát đất, các vòng dẹt nghiêng đổ về một phía
 * như lò xo bị kéo giãn rồi đổ nằm, vài cọc ngắn giữ dây, gai nhỏ dọc dây. Theo bản gốc (clip 13 12:02-12:07: cuộn thấp dưới
 * gối, vòng bầu dục nghiêng; prefab BarbedWireItemPrefab cao ~0,6 m trên sàn, sâu ~0,4 m). fin-build đợt 6: thay cuộn đứng cao
 * 0,8 m giữa cọc chữ T. Dài 2,3 m theo footprint của bản này (gốc 4,6 m). Dùng chung cho bóng đặt và vật đã dựng. */
export function barbed(mb) {
  const steel = hex(0x6e7378), post = hex(0x3a3d40);
  // dài 4,6 m như prefab gốc (integ): 7 cặp cọc, 20 vòng
  for (const x of [-2.15, -1.43, -0.72, 0.0, 0.72, 1.43, 2.15]) {
    mb.cube(v(x, 0.1, 0.17), v(0.04, 0.2, 0.04), post, METAL);
    mb.cube(v(x, 0.1, -0.17), v(0.04, 0.2, 0.04), post, METAL);
  }
  const RY = 0.24, RZ = 0.21, CY = 0.27, X0 = -2.2, X1 = 2.2, TURNS = 20, N = 16, LEAN = 0.85;
  const pitch = (X1 - X0) / TURNS;
  const path = [];
  for (let k = 0; k <= TURNS * N; k++) {
    const t = (k / N) * TAU;
    // vòng bầu dục nghiêng: đỉnh vòng đổ về +x (LEAN x nửa cao), đáy lùi về -x, nên cuộn nằm thấp như lò xo đổ
    const c = Math.cos(t);
    const x = X0 + (t / TAU) * pitch + c * RY * LEAN;
    path.push(v(Math.min(Math.max(x, X0 - 0.15), X1 + 0.15), CY + c * RY * (1.0 - 0.1 * Math.sin(t)), Math.sin(t) * RZ));
  }
  mb.sweep(path, 0.011, 4, steel, METAL);
  for (let k = 0; k < path.length; k += 3) {
    mb.cube_yaw(path[k], v(0.06, 0.012, 0.012), 0.7 + (k % 2) * 1.4, steel, METAL);
  }
  // dây căng dưới đáy giữ cuộn
  mb.tube(v(X0 - 0.04, 0.03, 0.0), v(X1 + 0.04, 0.03, 0.0), 0.008, 0.008, 4, steel, METAL);
}

/** Xe bán tải hỏng: thân đùn theo biên dạng, cabin bo, vòm bánh, lốp + vành + moay-ơ + bu lông, cản, lưới tản nhiệt,
 * đèn, gương, tay nắm, khe cửa, ống xả, thùng sau có thành. */
export function truck(mb, pos, yaw, col, flipped) {
  const m = m4_mul(m4_translate(pos), m4_rot_y(yaw));
  if (flipped) {
    mb.push(m4_mul(m4_mul(m, m4_translate(Y.mul(1.72))), m4_rot_z(Math.PI)));
  } else {
    mb.push(m);
  }
  const old = mb.bevel;
  mb.bevel = 0.02;
  const c = hex(col);
  const dark = hex(0x18191b);
  const steel = hex(0x8a8f94);
  const p2 = (x, y) => v2(x, y);
  // Thân dưới và nắp ca-pô dốc.
  mb.extrude([p2(-2.18, 0.5), p2(2.1, 0.5), p2(2.2, 0.66), p2(2.16, 0.92), p2(1.0, 1.04), p2(-2.18, 1.04)], -0.88, 0.88, c, METAL);
  // Cabin bo góc.
  mb.extrude([p2(-0.52, 1.03), p2(0.98, 1.03), p2(0.78, 1.36), p2(0.52, 1.6), p2(0.2, 1.68), p2(-0.36, 1.68), p2(-0.52, 1.6)], -0.82, 0.82, shade(c, 0.94), METAL);
  // Kính bên (rộng hơn cabin 1 cm), kính trước và sau.
  const glass = hex(0x10161b);
  mb.extrude([p2(-0.44, 1.12), p2(0.8, 1.12), p2(0.66, 1.34), p2(0.46, 1.52), p2(0.18, 1.6), p2(-0.3, 1.6), p2(-0.44, 1.54)], -0.83, 0.83, glass, GLASS);
  mb.push(m4_mul(m4_translate(v(0.77, 1.33, 0.0)), m4_rot_z(-0.93)));
  mb.cube(ZERO, v(0.02, 0.56, 1.46), glass, GLASS);
  mb.pop();
  mb.cube(v(-0.53, 1.36, 0.0), v(0.02, 0.4, 1.4), glass, GLASS);
  mb.cube(v(0.12, 1.34, 0.835), v(0.03, 0.5, 0.012), shade(c, 0.6), METAL);
  mb.cube(v(0.12, 1.34, -0.835), v(0.03, 0.5, 0.012), shade(c, 0.6), METAL);
  // Thùng sau: lòng thùng tối, thành, nắp hậu.
  mb.cube(v(-1.36, 1.045, 0.0), v(1.6, 0.01, 1.56), shade(c, 0.35), CORRUGATED);
  for (const z of [-0.84, 0.84]) {
    mb.cube(v(-1.36, 1.16, z), v(1.66, 0.24, 0.07), c, METAL);
    mb.cube(v(-1.36, 1.29, z), v(1.7, 0.03, 0.1), shade(c, 0.7), METAL);
  }
  mb.cube(v(-2.16, 1.16, 0.0), v(0.06, 0.24, 1.7), c, METAL);
  mb.cube(v(-0.56, 1.16, 0.0), v(0.06, 0.24, 1.7), c, METAL);
  // Khe cửa, tay nắm, gương, bậc lên xuống.
  for (const z of [-0.885, 0.885]) {
    mb.cube(v(-0.5, 0.85, z), v(0.015, 0.6, 0.008), dark, FLAT);
    mb.cube(v(0.6, 0.8, z), v(0.015, 0.5, 0.008), dark, FLAT);
    mb.cube(v(0.05, 0.56, z), v(1.1, 0.012, 0.008), dark, FLAT);
    mb.cube(v(-0.32, 0.96, z * 1.008), v(0.14, 0.03, 0.02), steel, METAL);
    mb.tube(v(0.74, 1.14, z * 0.95), v(0.82, 1.2, z * 1.14), 0.012, 0.012, 6, dark, FLAT);
    mb.cube(v(0.83, 1.22, z * 1.17), v(0.03, 0.13, 0.17), dark, FLAT);
    mb.cube(v(0.05, 0.44, z * 1.02), v(1.3, 0.03, 0.12), dark, METAL);
  }
  // Bánh xe: vòm, lốp tiện tròn có gai, vành, moay-ơ, 5 bu lông.
  for (const [x, z] of [[-1.36, 0.9], [1.36, 0.9], [-1.36, -0.9], [1.36, -0.9]]) {
    const s = signum(z);
    mb.tube(v(x, 0.4, z - s * 0.36), v(x, 0.4, z - s * 0.045), 0.47, 0.47, 20, hex(0x0a0a0b), FLAT);
    // Viền vòm bánh nổi trên thân xe.
    mb.push_axis(v(x, 0.4, z - s * 0.03), v(x, 0.4, z - s * 0.005));
    mb.lathe(ZERO, [[0.47, 0.0], [0.53, 0.0], [0.53, 0.025], [0.47, 0.025]], 20, false, shade(c, 0.7), METAL);
    mb.pop();
    mb.push_axis(v(x, 0.38, z - s * 0.3), v(x, 0.38, z));
    mb.lathe(ZERO, [[0.22, 0.0], [0.35, 0.015], [0.385, 0.06], [0.385, 0.24], [0.35, 0.285], [0.22, 0.3]], 24, true, hex(0x101112), FLAT);
    for (let k = 0; k < 3; k++) {
      const y = 0.08 + k * 0.07;
      mb.lathe(ZERO, [[0.385, y], [0.392, y + 0.01], [0.392, y + 0.03], [0.385, y + 0.04]], 24, false, hex(0x0a0b0c), FLAT);
    }
    mb.lathe(ZERO, [[0.225, 0.2], [0.225, 0.3], [0.2, 0.27], [0.09, 0.26], [0.07, 0.2], [0.0, 0.2]], 20, false, steel, METAL);
    mb.lathe(ZERO, [[0.06, 0.2], [0.05, 0.31], [0.0, 0.31]], 10, false, hex(0x55595d), METAL);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5.0) * TAU;
      mb.tube(v(Math.cos(a) * 0.12, 0.25, Math.sin(a) * 0.12), v(Math.cos(a) * 0.12, 0.285, Math.sin(a) * 0.12), 0.014, 0.014, 6, hex(0x2c2e30), METAL);
    }
    mb.pop();
  }
  // Cản, lưới tản nhiệt, đèn, biển số, ống xả, ăng-ten.
  mb.cube(v(2.22, 0.46, 0.0), v(0.14, 0.17, 1.86), hex(0x3a3d40), METAL);
  mb.cube(v(-2.22, 0.5, 0.0), v(0.12, 0.15, 1.86), hex(0x3a3d40), METAL);
  mb.cube(v(2.19, 0.76, 0.0), v(0.03, 0.26, 1.0), dark, FLAT);
  for (let k = 0; k < 5; k++) {
    mb.cube(v(2.2, 0.66 + k * 0.05, 0.0), v(0.03, 0.015, 0.98), steel, METAL);
  }
  for (const z of [-0.66, 0.66]) {
    mb.emi = 0.25;
    mb.tube(v(2.16, 0.78, z), v(2.21, 0.78, z), 0.1, 0.09, 12, hex(0xd9d4b8), FLAT);
    mb.emi = 0.12;
    mb.cube(v(-2.2, 0.86, z), v(0.03, 0.18, 0.2), hex(0x8a1c18), FLAT);
    mb.emi = 0.0;
    mb.tube(v(2.15, 0.78, z), v(2.2, 0.78, z), 0.115, 0.115, 12, steel, METAL);
  }
  mb.cube(v(-2.29, 0.5, 0.0), v(0.01, 0.11, 0.34), hex(0xc9c4a8), FLAT);
  mb.tube(v(-1.2, 0.3, 0.6), v(-2.3, 0.3, 0.6), 0.035, 0.035, 8, hex(0x3b3026), METAL);
  mb.tube(v(0.3, 1.68, 0.6), v(0.25, 2.3, 0.62), 0.006, 0.004, 4, dark, FLAT);
  mb.cube(v(-1.3, 1.2, 0.2), v(0.6, 0.32, 0.5), hex(0x8a6c48), WOOD);
  mb.bevel = old;
  mb.pop();
}

/** Hai mái hiên sọc nhỏ trên hai cửa sổ mặt tiền (bản gốc: bạt sọc xanh / kem, diềm vỏ sò, audit-ref m01 / m08). Bạt 9 sọc
 * võng giữa hai tay đỡ, sọc phai và bẩn dần ra mép trước, một vỏ sò rách mất, một vỏ sò lệch; má bên tam giác; khung ống
 * sắt bắt vào tường bằng bát. Đáy diềm ~1,9 m, chỉ là hình (không collider), nên không chặn đường hay cửa. */
function window_awnings(mb, trim, steel) {
  const teal = hex(0x2d5866), cream = hex(0xcdc4a3);
  const W = 2.36, D = 0.72, yTop = 2.56, drop = 0.44, zw = 5.252;
  const hash = (a) => { const s = Math.sin(a * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  [[-4.0, -2.0], [2.0, 4.0]].forEach(([wx0, wx1], wi) => {
    const cx = (wx0 + wx1) * 0.5, x0 = cx - W * 0.5;
    const NU = 9, NT = 4;
    // Mặt bạt: sọc võng nhiều ở giữa nhịp, mép trước võng nhẹ giữa hai tay đỡ.
    const P = (u, t) => {
      const span = Math.sin(Math.PI * u);
      const y = yTop - drop * t - 0.07 * 4.0 * t * (1.0 - t) * (0.55 + 0.45 * span) - 0.035 * t * span;
      return v(x0 + W * u, y, zw + D * t);
    };
    const torn = Math.floor(hash(wi * 7 + 1) * NU), skew = (torn + 3 + wi) % NU;
    for (let i = 0; i < NU; i++) {
      const base = i % 2 === 0 ? teal : cream;
      const fade = 0.88 + 0.16 * hash(wi * 31 + i);
      for (let j = 0; j < NT; j++) {
        const u0 = i / NU, u1 = (i + 1) / NU, t0 = j / NT, t1 = (j + 1) / NT;
        // Bụi và rêu bám dần ra mép trước (nước mưa chảy xuống).
        const c = shade(base, fade * (1.0 - 0.16 * t1));
        const a = P(u0, t0), b = P(u0, t1), cc = P(u1, t1), d = P(u1, t0);
        mb.quad([a, b, cc, d], c, FLAT);
        const dn = v(0.0, -0.012, 0.0);
        mb.quad([a.add(dn), d.add(dn), cc.add(dn), b.add(dn)], shade(base, 0.45 * fade), FLAT);
      }
      // Diềm vỏ sò dưới mép trước: dải 10 cm + nửa đĩa; một vỏ sò rách mất, một vỏ sò xoắn lệch.
      const ua = i / NU, ub = (i + 1) / NU;
      const pa = P(ua, 1.0), pb = P(ub, 1.0);
      const w = pb.x - pa.x, mid = pa.add(pb).mul(0.5);
      const col = shade(base, fade * 0.82);
      const back = shade(base, 0.5 * fade);
      const tilt = i === skew ? 0.05 : 0.0;
      const hang = i === torn ? 0.045 : 0.1;
      const z = pa.z + 0.004;
      const tl = v(pa.x, pa.y, z), tr = v(pb.x, pb.y, z);
      const bl = v(pa.x, pa.y - hang, z + tilt), br = v(pb.x, pb.y - hang, z + tilt);
      mb.quad([bl, br, tr, tl], col, FLAT);
      mb.quad([tl, tr, br, bl], back, FLAT);
      if (i !== torn) {
        const ctr = v(mid.x, (bl.y + br.y) * 0.5, z + tilt);
        const n = 6, r = w * 0.5;
        for (let k = 0; k < n; k++) {
          const a0 = Math.PI + (k / n) * Math.PI, a1 = Math.PI + ((k + 1) / n) * Math.PI;
          const q0 = v(ctr.x + Math.cos(a0) * r, ctr.y + Math.sin(a0) * r * 0.62, z + tilt);
          const q1 = v(ctr.x + Math.cos(a1) * r, ctr.y + Math.sin(a1) * r * 0.62, z + tilt);
          mb.tri([ctr, q0, q1], col, FLAT);
          mb.tri([ctr, q1, q0], back, FLAT);
        }
      }
    }
    // Má bên tam giác (kem, viền xanh).
    for (const u of [0.0, 1.0]) {
      const a = P(u, 0.0), b = P(u, 1.0);
      const lo = v(b.x, b.y - 0.1, b.z), wl = v(a.x, a.y - 0.12, a.z);
      const sx = u === 0.0 ? -0.004 : 0.004;
      const off = v(sx, 0.0, 0.0);
      const outer = [wl.add(off), lo.add(off), b.add(off), a.add(off)], inner = [a.sub(off), b.sub(off), lo.sub(off), wl.sub(off)];
      if (u === 0.0) { mb.quad(outer, shade(cream, 0.86), FLAT); mb.quad(inner, shade(cream, 0.5), FLAT); }
      else { mb.quad([outer[3], outer[2], outer[1], outer[0]], shade(cream, 0.86), FLAT); mb.quad([inner[3], inner[2], inner[1], inner[0]], shade(cream, 0.5), FLAT); }
    }
    // Khung: thanh trên tường, thanh trước dưới mép bạt, hai tay đỡ chéo, bát bắt tường.
    const rust = hex(0x6a4a34);
    mb.tube(v(x0 - 0.03, yTop - 0.02, zw + 0.02), v(x0 + W + 0.03, yTop - 0.02, zw + 0.02), 0.018, 0.018, 6, steel, METAL);
    const f0 = P(0.0, 1.0), f1 = P(1.0, 1.0);
    const fb = (u) => { const p = P(u, 1.0); return v(p.x, p.y - 0.018, p.z - 0.01); };
    for (let k = 0; k < 4; k++) mb.tube(fb(k / 4), fb((k + 1) / 4), 0.016, 0.016, 6, k === 1 ? rust : steel, METAL);
    for (const p of [f0, f1]) {
      const w0 = v(p.x, yTop - 0.5, zw + 0.01);
      mb.tube(w0, v(p.x, p.y - 0.02, p.z - 0.01), 0.014, 0.014, 6, steel, METAL);
      mb.cube(v(p.x, yTop - 0.5, zw + 0.012), v(0.07, 0.1, 0.024), trim, METAL);
      mb.cube(v(p.x, yTop - 0.02, zw + 0.012), v(0.07, 0.08, 0.024), trim, METAL);
    }
    // Bậu cửa sổ bê tông ngoài tường, mẻ một góc.
    mb.block(v(wx0 - 0.1, 0.9, 5.25), v(wx1 - wx0 + 0.2 - (wi === 0 ? 0.0 : 0.12), 0.06, 0.11), hex(0x8f8b82), CONCRETE);
  });
}

/** Chi tiết mặt tiền: khung cửa sổ, đầu đinh trên ván, mái hiên võng có diềm và thanh chống, khung biển, máng xối,
 * cục nóng có quạt, dây điện kéo từ cột. */
export function facade(mb) {
  const trim = hex(0x34322e);
  const steel = hex(0x6a7074);
  for (const [x0, x1] of [[-4.0, -2.0], [2.0, 4.0]]) {
    for (const z of [4.985, 5.265]) {
      mb.cube(v((x0 + x1) * 0.5, 0.97, z), v(x1 - x0 + 0.16, 0.07, 0.06), trim, WOOD);
      mb.cube(v((x0 + x1) * 0.5, 2.23, z), v(x1 - x0 + 0.16, 0.07, 0.06), trim, WOOD);
      mb.cube(v(x0 - 0.04, 1.6, z), v(0.07, 1.33, 0.06), trim, WOOD);
      mb.cube(v(x1 + 0.04, 1.6, z), v(0.07, 1.33, 0.06), trim, WOOD);
    }
    mb.cube(v((x0 + x1) * 0.5, 1.6, 5.125), v(0.04, 1.2, 0.05), trim, WOOD);
    for (let k = 0; k < 3; k++) {
      for (const sx of [-1.0, 1.0]) {
        const p = v((x0 + x1) * 0.5 + sx * 1.02, 1.2 + k * 0.4, 5.29);
        mb.tube(p, p.add(Z.mul(0.012)), 0.014, 0.014, 6, hex(0x9a9a96), METAL);
      }
    }
  }
  window_awnings(mb, trim, steel);
  // Mái hiên: 6 dải bạt võng giữa tường và thanh trước, diềm răng cưa, thanh chống chéo.
  const z0 = 5.25, z1 = 6.9;
  const sag = (t) => 2.72 - 0.1 * t - 0.09 * 4.0 * t * (1.0 - t);
  for (let k = 0; k < 6; k++) {
    const t0 = k / 6.0, t1 = (k + 1) / 6.0;
    const za = z0 + (z1 - z0) * t0, zb = z0 + (z1 - z0) * t1;
    mb.quad([v(-5.3, sag(t0), za), v(-5.3, sag(t1), zb), v(5.3, sag(t1), zb), v(5.3, sag(t0), za)], hex(0x9a2f2a), STRIPES);
    mb.quad([v(-5.3, sag(t0) - 0.01, za), v(5.3, sag(t0) - 0.01, za), v(5.3, sag(t1) - 0.01, zb), v(-5.3, sag(t1) - 0.01, zb)], hex(0x5a1c19), STRIPES);
  }
  for (let k = 0; k < 26; k++) {
    const x = -5.2 + k * 0.416;
    const c = k % 2 === 0 ? hex(0x9a2f2a) : hex(0xbdb7a0);
    mb.tri([v(x - 0.2, 2.62, 6.9), v(x, 2.42, 6.9), v(x + 0.2, 2.62, 6.9)], c, FLAT);
    mb.tri([v(x + 0.2, 2.62, 6.9), v(x, 2.42, 6.9), v(x - 0.2, 2.62, 6.9)], shade(c, 0.6), FLAT);
  }
  mb.tube(v(-5.3, 2.62, 6.9), v(5.3, 2.62, 6.9), 0.025, 0.025, 8, steel, METAL);
  for (const x of [-5.2, -1.7, 1.7, 5.2]) {
    mb.tube(v(x, 3.15, 5.27), v(x, 2.64, 6.88), 0.018, 0.018, 6, steel, METAL);
  }
  // (Khung biển SHOP cũ đã bỏ: bản gốc là chữ khối đứng trên mái, plug/signs.js.)
  // Máng xối dọc mép mái và cục nóng có quạt.
  mb.tube(v(-5.3, 3.22, 5.31), v(9.8, 3.22, 5.31), 0.06, 0.06, 8, hex(0x4a4f52), METAL);
  // [SUA] quat nam tren cuc nong o goc tay mat tien (x = MEDICAL[0] + 0,5 = -9,25; truoc day x = +9,25 nen quat treo giua khong).
  mb.push_axis(v(-9.25, 0.75, 5.57), v(-9.25, 0.75, 5.6));
  mb.lathe(ZERO, [[0.32, 0.0], [0.32, 0.03], [0.0, 0.03]], 16, false, hex(0x2a2d30), METAL);
  mb.pop();
  for (let k = 0; k < 4; k++) {
    mb.cube(v(-9.25, 0.48 + k * 0.18, 5.59), v(0.62, 0.015, 0.02), hex(0x8a8f94), METAL);
  }
  // Dây điện từ cột bên kia đường vào góc mái.
  // [SUA] dau day noi vao cot dien ben duong (cot o z = 12,6 + STREET_DZ) va dau cot goc mai; truoc day ca hai dau deu ho.
  const a = v(-12.0, 7.5, 12.6 + lay.STREET_DZ), b = v(-5.33, 3.24, 5.33);
  const path = [];
  for (let k = 0; k <= 8; k++) {
    const t = k / 8.0;
    path.push(a.lerp(b, t).sub(Y.mul(1.1 * 4.0 * t * (1.0 - t))));
  }
  mb.sweep(path, 0.012, 4, hex(0x111111), FLAT);
}

/** Quầy: thân có ô ván, đế, mặt đá chìa ra, ba ngăn kéo có tay nắm phía người bán, máy tính tiền, khay sạc pin,
 * nút báo động, radio. */
export function counter(mb) {
  const body = hex(0x4d525a);
  const old = mb.bevel;
  mb.bevel = 0.015;
  mb.block(v(-1.7, 0.08, -3.0), v(3.4, 0.84, 0.8), body, WOOD);
  mb.block(v(-1.66, 0.0, -2.96), v(3.32, 0.08, 0.72), hex(0x1f2124), FLAT);
  mb.block(v(-1.8, 0.92, -3.07), v(3.6, 0.07, 0.94), hex(0x8e9297), CONCRETE);
  mb.block(v(-1.78, 0.895, -3.05), v(3.56, 0.03, 0.9), hex(0x5a5d61), METAL);
  for (let k = 0; k < 4; k++) {
    const x = -1.6 + k * 0.82;
    mb.block(v(x, 0.16, -2.215), v(0.74, 0.66, 0.02), shade(body, 0.8), WOOD);
    for (const [dx, w] of [[0.0, 0.04], [0.7, 0.04]]) {
      mb.block(v(x + dx, 0.16, -2.2), v(w, 0.66, 0.02), shade(body, 1.15), WOOD);
    }
    mb.block(v(x, 0.78, -2.2), v(0.74, 0.04, 0.02), shade(body, 1.15), WOOD);
    mb.block(v(x, 0.16, -2.2), v(0.74, 0.04, 0.02), shade(body, 1.15), WOOD);
  }
  // [par-counter D10] Ngăn kéo phía người bán như gốc (op/04b, clip 02 7:42): bốn ngăn kéo gỗ to 2x2 kéo mở sẵn, tầng dưới
  // kéo ra xa hơn tầng trên để thấy cả hai; ô theo mệnh giá (player.drawer_cell), viền đầu ô màu đầu cực của mệnh giá.
  // Pin thật soi xong rơi vào đúng ô (plug/till.js vẽ pin trong ô).
  {
    const wood = hex(0x8a6a44), inner = hex(0x5e4630);
    for (const [cx0, cx1] of player.DRAWER_COLS) {
      mb.block(v(cx0, 0.3, -3.03), v(cx1 - cx0, 0.5, 0.04), shade(body, 0.75), WOOD); // ô tủ khoét vào thân quầy
      for (const t of [player.DRAWER_UP, player.DRAWER_LO]) {
        const w = cx1 - cx0, d = t.z1 - t.z0, hh = 0.12;
        mb.block(v(cx0, t.y - 0.015, t.z0), v(w, 0.015, d), inner, WOOD); // đáy
        for (const sx of [cx0, cx1 - 0.022]) mb.block(v(sx, t.y - 0.015, t.z0), v(0.022, hh, d), wood, WOOD); // hai thành
        mb.block(v(cx0, t.y - 0.015, t.z1 - 0.02), v(w, hh, 0.02), shade(wood, 0.85), WOOD); // thành trong
        mb.block(v(cx0 - 0.01, t.y - 0.03, t.z0 - 0.025), v(w + 0.02, hh + 0.03, 0.025), shade(wood, 1.08), WOOD); // mặt trước
        mb.tube(v(cx0 + w * 0.38, t.y + 0.04, t.z0 - 0.04), v(cx0 + w * 0.62, t.y + 0.04, t.z0 - 0.04), 0.01, 0.01, 6, hex(0xa0a4a8), METAL);
      }
    }
    for (const val of player.DRAWER_DENOMS) {
      const c = player.drawer_cell(val);
      if (val === 100 || val === 1000) mb.block(v(c.x0 >= 0 ? c.x0 - 0.016 : c.x1 + 0.004, c.y - 0.015, c.z0), v(0.012, 0.09, c.z1 - c.z0), hex(0x6e5236), WOOD); // vách ô hẹp
      mb.emi = 0.5;
      mb.block(v(c.x0, c.y + 0.0, c.z0 - 0.004), v(c.x1 - c.x0, 0.006, 0.012), hex(BATTERY_LOOK[val].cap), FLAT);
      mb.emi = 0.0;
    }
  }
  for (const x of [-1.5, 0.9]) {
    mb.block(v(x, 0.2, -3.03), v(0.6, 0.56, 0.04), shade(body, 0.9), WOOD);
    mb.tube(v(x + 0.2, 0.5, -3.06), v(x + 0.4, 0.5, -3.06), 0.012, 0.012, 6, hex(0xa0a4a8), METAL);
  }
  // Máy tính tiền: thân dày đặt trên quầy, ngăn tiền phía người bán, bàn phím nghiêng về phía người bán, hộp sau, màn
  // hình trên cổ đứng rộng (mặt sau có màn nhỏ cho khách), máy in hoá đơn có giấy thò ra. Sơn xanh xám đã mòn cạnh.
  {
    const old_bev = mb.bevel;
    mb.bevel = 0.012;
    const till = hex(0x3d4943), dark = hex(0x24292d);
    mb.block(v(0.6, 0.99, -2.9), v(0.6, 0.11, 0.46), till, METAL);
    mb.block(v(0.58, 0.99, -2.92), v(0.64, 0.02, 0.5), dark, METAL); // đế cao su
    mb.bevel = 0.006;
    mb.block(v(0.63, 1.005, -2.925), v(0.54, 0.075, 0.03), shade(till, 1.25), METAL); // mặt ngăn tiền
    mb.tube(v(0.8, 1.04, -2.94), v(1.0, 1.04, -2.94), 0.009, 0.009, 6, hex(0xa0a4a8), METAL);
    mb.cyl(v(0.7, 1.035, -2.945), 0.008, 0.008, 0.01, 8, hex(0xc9a84a), METAL);
    // hộp sau phía khách
    mb.bevel = 0.012;
    mb.block(v(0.62, 1.1, -2.64), v(0.56, 0.1, 0.24), till, METAL);
    // bàn phím nghiêng
    mb.push(m4_mul(m4_translate(v(0.8, 1.135, -2.77)), m4_rot_x(-0.38)));
    mb.cube(ZERO, v(0.34, 0.035, 0.24), dark, METAL);
    mb.bevel = 0.004;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const col = j === 3 && i === 3 ? 0x3aa04a : (i === 3 ? 0xd2a33a : (i + j) % 5 === 0 ? 0xc23a30 : 0xd8d2c0);
        mb.cube(v(-0.12 + i * 0.075, 0.024, -0.09 + j * 0.058), v(0.058, 0.022, 0.044), hex(col), FLAT);
      }
    }
    mb.pop();
    // máy in hoá đơn bên phải, giấy trắng cong ra
    mb.bevel = 0.008;
    mb.block(v(1.03, 1.1, -2.88), v(0.15, 0.085, 0.2), dark, METAL);
    mb.block(v(1.05, 1.183, -2.8), v(0.11, 0.004, 0.012), hex(0x0c0d0e), FLAT);
    mb.bevel = 0.0;
    mb.block(v(1.06, 1.185, -2.796), v(0.09, 0.07, 0.003), hex(0xeeeae0), FLAT);
    mb.push(m4_mul(m4_translate(v(1.105, 1.255, -2.796)), m4_rot_x(0.5)));
    mb.block(v(-0.045, 0.0, -0.0015), v(0.09, 0.04, 0.003), hex(0xeeeae0), FLAT);
    mb.pop();
    // màn hình trên cổ đứng
    mb.bevel = 0.01;
    mb.cyl(v(0.9, 1.2, -2.52), 0.07, 0.06, 0.02, 12, dark, METAL);
    mb.tube(v(0.9, 1.21, -2.52), v(0.9, 1.33, -2.52), 0.028, 0.024, 10, hex(0x55595d), METAL);
    mb.push(m4_mul(m4_translate(v(0.9, 1.4, -2.52)), m4_rot_x(0.22)));
    mb.cube(ZERO, v(0.32, 0.16, 0.06), till, METAL);
    mb.bevel = 0.0;
    mb.cube(v(0.0, 0.0, -0.031), v(0.28, 0.12, 0.004), hex(0x101414), FLAT);
    mb.emi = 0.45;
    mb.cube(v(0.0, 0.0, -0.034), v(0.25, 0.095, 0.004), hex(0x38d66b), FLAT);
    mb.cube(v(0.0, -0.01, 0.032), v(0.14, 0.05, 0.004), hex(0xe0a030), FLAT);
    mb.emi = 0.0;
    mb.pop();
    // máy soi pin vàng bên trái máy tính tiền: thân, khe cắm trên nóc, đèn (plug/till.js thắp xanh / đỏ)
    mb.bevel = 0.012;
    mb.block(v(0.36, 0.99, -2.94), v(0.2, 0.11, 0.16), hex(0xe0b030), METAL);
    mb.block(v(0.38, 1.095, -2.92), v(0.16, 0.02, 0.12), hex(0x2a2c30), METAL);
    mb.bevel = 0.0;
    mb.block(v(0.42, 1.112, -2.875), v(0.08, 0.004, 0.03), hex(0x050505), FLAT);
    mb.cyl(v(0.53, 1.112, -2.9), 0.014, 0.012, 0.012, 10, hex(0x5a5a5a), METAL);
    mb.bevel = old_bev;
  }
  // Nút báo động.
  mb.lathe(v(-1.35, 0.99, -2.55), [[0.0, 0.0], [0.1, 0.0], [0.1, 0.03], [0.07, 0.04], [0.0, 0.04]], 12, false, hex(0xc9b22a), METAL);
  mb.emi = 0.5;
  mb.lathe(v(-1.35, 1.03, -2.55), [[0.0, 0.0], [0.055, 0.0], [0.05, 0.035], [0.0, 0.045]], 12, true, hex(0xd0302a), FLAT);
  mb.emi = 0.0;
  // [par-counter D13] Queue Bell (loc:object_next_customer_bell): chuông bấm gọi khách kế, đầu phải quầy (player.BELL).
  mb.lathe(v(1.55, 0.99, -2.6), [[0.0, 0.0], [0.06, 0.0], [0.06, 0.012], [0.0, 0.012]], 14, false, hex(0x2a2c2e), METAL);
  mb.lathe(v(1.55, 1.002, -2.6), [[0.0, 0.0], [0.05, 0.0], [0.045, 0.02], [0.03, 0.038], [0.0, 0.045]], 14, false, hex(0xd8dce0), METAL);
  mb.cyl(v(1.55, 1.045, -2.6), 0.005, 0.005, 0.014, 6, hex(0x9aa0a6), METAL);
  mb.cyl(v(1.55, 1.059, -2.6), 0.012, 0.012, 0.006, 10, hex(0xb8bcc0), METAL);
  // Radio: vỏ gỗ, loa, núm, ăng-ten, quai.
  mb.block(v(-0.84, 0.99, -2.86), v(0.44, 0.26, 0.2), hex(0x5d4a36), WOOD);
  mb.push_axis(v(-0.72, 1.12, -2.665), v(-0.72, 1.12, -2.655));
  mb.lathe(ZERO, [[0.0, 0.0], [0.085, 0.0], [0.09, 0.008], [0.07, 0.012], [0.0, 0.012]], 14, false, hex(0x1c1c1c), FLAT);
  mb.pop();
  for (const x of [-0.56, -0.48]) {
    mb.tube(v(x, 1.18, -2.665), v(x, 1.18, -2.645), 0.02, 0.018, 8, hex(0xb0a890), METAL);
  }
  mb.cube(v(-0.52, 1.08, -2.658), v(0.14, 0.05, 0.006), hex(0xd8c88a), FLAT);
  mb.tube(v(-0.45, 1.25, -2.76), v(-0.3, 1.72, -2.7), 0.006, 0.004, 4, hex(0xb0b0b0), METAL);
  mb.sweep([v(-0.8, 1.25, -2.76), v(-0.78, 1.33, -2.76), v(-0.48, 1.33, -2.76), v(-0.46, 1.25, -2.76)], 0.01, 6, hex(0x2a2a2a), FLAT);
  mb.bevel = old;
}

/** Kệ cố định "Flimsy Wooden Shelf" bắt vào tường như bản gốc (ảnh ngày 2 của chủ dự án, clip 01 680 s, clip 04 28:30):
 *  một tấm ván gỗ sáng ngang ngực (mặt ván y lay.PLANK_TOP), 7 ô ngang x 3 ô sâu trên cùng tấm ván, ke sắt chữ L bắt vít vào
 *  tường, thanh nẹp treo thẻ giá dưới mép trước. `?shelves=2`: hai kệ ván ba tầng của bản trước (cũng bắt tường). */
export function shelves(mb, fixed) {
  const SHELF_Z0 = lay.SHELF_Z0, SLOT_W = lay.SLOT_W;
  const wood = hex(0xa8865e), iron = hex(0x3a3d40), pale = hex(0xc9a87c);
  const L = 7 * SLOT_W, zc = SHELF_Z0 + L * 0.5;
  const list = fixed && fixed.length ? fixed : [];
  for (const sh of list) {
    const face = Math.round(Math.sin(sh.yaw)) || 1; // +z riêng của kệ trên trục x thế giới (rot_y)
    const x = sh.pos.x;
    const xw = x - face * 0.447; // mặt tường (tường trong ở x ±5)
    const levels = sh.plank ? 1 : 3;
    const xf = x + face * (sh.plank ? lay.PLANK_FRONT : 0.25);
    const d = Math.abs(xf - xw), half = d * 0.5;
    if (sh.plank) { plank(mb, sh, face, xw, xf, zc, L, pale, iron); continue; }
    for (let l = 0; l < levels; l++) {
      const y = 0.43 + l * 0.5;
      // ván: hai tấm ghép dọc, màu lệch nhau, cạnh sẫm; nẹp mép trước
      for (let b = 0; b < 2; b++) {
        const bx = xw + face * (half * 0.5 + b * half);
        mb.cube(v(bx, y, zc), v(half - 0.004, 0.04, L + 0.1), shade(wood, 0.9 + 0.12 * ((b + l) % 2)), WOOD);
      }
      mb.cube(v(xf - face * 0.006, y + 0.03, zc), v(0.016, 0.05, L + 0.1), shade(wood, 0.78), WOOD);
      // ke sắt chữ L: cánh đứng trên tường, cánh ngang dưới ván, thanh chéo, hai vít
      for (const k of [0.35, 2.1, 3.85]) {
        const z = SHELF_Z0 + k;
        const arm = sh.plank ? 0.34 : 0.26;
        mb.cube(v(xw + face * 0.008, y - arm * 0.5, z), v(0.016, arm, 0.035), iron, METAL);
        mb.cube(v(xw + face * (d * 0.36), y - 0.028, z), v(d * 0.7, 0.016, 0.035), iron, METAL);
        mb.push(m4_mul(m4_translate(v(xw + face * (d * 0.22), y - arm * 0.5, z)), m4_rot_z(face * 0.95)));
        mb.cube(ZERO, v(arm * 1.15, 0.012, 0.025), iron, METAL);
        mb.pop();
        for (const dy of [-0.06, -arm + 0.06]) mb.cyl(v(xw + face * 0.018, y + dy, z), 0.008, 0.008, 0.008, 6, hex(0x8a8f94), METAL);
      }
    }
  }
}

/** Kệ ván mỏng như gốc (ảnh chủ dự án images/24.png): một tấm ván gỗ sáng dày lay.PLANK_T, vát nhẹ, ke chữ L mảnh; không nẹp,
 *  không thanh treo, thẻ giá một hàng dưới mép trước (plug/pricetag.js). */
function plank(mb, sh, face, xw, xf, zc, L, pale, iron) {
  const T = lay.PLANK_T, y = lay.PLANK_TOP - T * 0.5, d = Math.abs(xf - xw);
  const old = mb.bevel; mb.bevel = 0.004;
  mb.cube(v((xw + xf) * 0.5, y, zc), v(d - 0.004, T, L + 0.1), pale, WOOD);
  mb.bevel = old;
  // vân ván: hai đường rãnh mảnh dọc mặt trên, sẫm hơn chút
  for (const t of [0.34, 0.68]) mb.cube(v(xw + face * d * t, lay.PLANK_TOP + 0.0004, zc), v(0.004, 0.001, L + 0.08), shade(pale, 0.82), WOOD);
  // ke sắt chữ L mảnh: cánh đứng trên tường, cánh ngang sát dưới ván, thanh chéo, hai vít
  const arm = 0.2;
  for (const k of [0.35, 2.1, 3.85]) {
    const z = lay.SHELF_Z0 + k, yb = y - T * 0.5 - 0.004;
    mb.cube(v(xw + face * 0.005, yb - arm * 0.5, z), v(0.01, arm, 0.024), iron, METAL);
    mb.cube(v(xw + face * (d * 0.36), yb, z), v(d * 0.7, 0.008, 0.024), iron, METAL);
    mb.push(m4_mul(m4_translate(v(xw + face * 0.099, yb - 0.082, z)), m4_rot_z(face * 0.709)));
    mb.cube(ZERO, v(0.24, 0.007, 0.016), iron, METAL);
    mb.pop();
    for (const dy of [-0.04, -arm + 0.04]) mb.cyl(v(xw + face * 0.011, yb + dy, z), 0.006, 0.006, 0.005, 6, hex(0x8a8f94), METAL);
  }
}

/** Cây: thân thuôn, cành, tán nhiều lớp lệch tâm; cây chết chỉ còn cành. */
export function tree(mb, p, r) {
  const h = r.range(4.5, 8.5);
  const bark = hex(0x3b2f25);
  mb.lathe(p, [[0.3, 0.0], [0.2, 0.3], [0.16, h * 0.35], [0.09, h * 0.7], [0.03, h * 0.95]], 8, true, bark, WOOD);
  if (r.chance(0.3)) {
    for (let i = 0; i < 5; i++) {
      const y = h * r.range(0.35, 0.8);
      const a = r.range(0.0, 6.28);
      const l = r.range(0.8, 1.8);
      mb.tube(p.add(Y.mul(y)), p.add(v(Math.cos(a) * l, y + l * 0.6, Math.sin(a) * l)), 0.05, 0.015, 5, bark, WOOD);
    }
    return;
  }
  const g = shade(hex(0x2f4a33), r.range(0.65, 1.15));
  for (let k = 0; k < 5; k++) {
    const t = k / 5.0;
    const y = h * (0.28 + t * 0.6);
    const rad = h * (0.3 - t * 0.2) * r.range(0.85, 1.15);
    const ox = r.range(-0.2, 0.2);
    const oz = r.range(-0.2, 0.2);
    const off = v(ox, 0.0, oz);
    mb.lathe(p.add(off).add(Y.mul(y)), [[rad * 0.25, -rad * 0.1], [rad, 0.0], [rad * 0.55, h * 0.1], [0.0, h * 0.24]], 9, false, shade(g, 0.85 + t * 0.4), GROUND);
  }
}

/** [phiên 8] Vật liệu chế tạo có dáng nhận ra được (trước đây ván / ống / đinh / sắt vụn là hộp có sọc hay que dựng đứng):
 *  ván = tấm gỗ dài có vân và hai đinh, ván cứng sẫm hơn, khúc gỗ nằm có vòng tuổi, ống nằm ngang có khớp nối, đinh = bó đinh
 *  buộc dây, sắt vụn = hai mảnh tôn cong gỉ + bu lông, dây điện = cuộn dây có đầu thò. Nằm ngang theo trục x của món. */
function material_item(mb, item) {
  const key = items.cat_key(item);
  const v = v3;
  switch (key) {
    case 'PlankItemData': case 'HardwoodPlankItemData': {
      const hard = key === 'HardwoodPlankItemData';
      const wc = hex(hard ? 0x7a4e2c : 0xc9a87c), gc = hex(hard ? 0x5a361c : 0xa47f52);
      const b = mb.bevel; mb.bevel = 0.004;
      mb.cube(v(0.0, 0.0125, 0.0), v(0.62, 0.025, 0.11), wc, WOOD);
      mb.bevel = b;
      for (const z of [-0.03, 0.012, 0.038]) mb.cube(v(0.02, 0.0252, z), v(0.5, 0.0012, 0.004), gc, FLAT);
      mb.cube(v(0.3, 0.013, 0.0), v(0.022, 0.0262, 0.112), gc, WOOD); // đầu cưa sẫm
      for (const x of [-0.24, 0.24]) mb.lathe(v(x, 0.025, 0.0), [[0.007, 0.0], [0.007, 0.002], [0.0, 0.003]], 6, false, hex(0x55595d), METAL);
      return true;
    }
    case 'HardwoodLogItemData':
      mb.tube(v(-0.26, 0.07, 0.0), v(0.26, 0.07, 0.0), 0.068, 0.062, 10, hex(0x5e4026), WOOD);
      for (const sx of [-1, 1]) mb.tube(v(sx * 0.262, 0.07, 0.0), v(sx * 0.266, 0.07, 0.0), 0.058, 0.02, 10, hex(0xc8a070), WOOD);
      return true;
    case 'MetalPipeItemData': case 'CopperPipeItemData': {
      const cu = key === 'CopperPipeItemData';
      const pc = hex(cu ? 0xb86a32 : 0x8a9096), jc = hex(cu ? 0x8a4a20 : 0x5a5f66);
      mb.tube(v(-0.24, 0.024, 0.0), v(0.24, 0.024, 0.0), 0.022, 0.022, 10, pc, METAL);
      mb.tube(v(0.2, 0.024, 0.0), v(0.25, 0.024, 0.0), 0.029, 0.029, 10, jc, METAL); // khớp nối
      mb.tube(v(-0.25, 0.024, 0.0), v(-0.235, 0.024, 0.0), 0.027, 0.027, 10, jc, METAL);
      return true;
    }
    case 'NailsItemData':
      for (let i = 0; i < 7; i++) {
        const z = -0.024 + (i % 4) * 0.016, y = 0.008 + Math.floor(i / 4) * 0.014;
        mb.tube(v(-0.06, y, z), v(0.06, y, z), 0.0035, 0.0035, 5, hex(0x9aa0a6), METAL);
        mb.tube(v(-0.064, y, z), v(-0.06, y, z), 0.009, 0.009, 6, hex(0x7a8086), METAL);
      }
      mb.tube(v(-0.008, 0.012, 0.0), v(0.008, 0.012, 0.0), 0.036, 0.036, 10, hex(0xb9a36a), FLAT); // dây buộc
      return true;
    case 'MetalScrapItemData': {
      mb.push(m4_mul(m4_translate(v(0.0, 0.02, 0.0)), m4_rot_z(0.18)));
      mb.cube(ZERO, v(0.2, 0.006, 0.13), hex(0x7a6250), METAL);
      mb.pop();
      mb.push(m4_mul(m4_translate(v(0.05, 0.045, 0.02)), m4_mul(m4_rot_y(0.7), m4_rot_x(-0.35))));
      mb.cube(ZERO, v(0.14, 0.006, 0.09), hex(0x8a8f94), METAL);
      mb.pop();
      mb.tube(v(-0.06, 0.012, -0.05), v(-0.06, 0.05, -0.05), 0.008, 0.008, 6, hex(0x55595d), METAL);
      mb.tube(v(-0.06, 0.05, -0.05), v(-0.06, 0.058, -0.05), 0.015, 0.015, 6, hex(0x55595d), METAL);
      return true;
    }
    case 'WiringItemData':
      for (let i = 0; i < 4; i++) mb.lathe(v(0.0, 0.006 + i * 0.011, 0.0), [[0.05 - i * 0.002, 0.0], [0.056 - i * 0.002, 0.005], [0.05 - i * 0.002, 0.01]], 12, false, hex(i % 2 ? 0xc2452d : 0xa83a26), FLAT);
      mb.tube(v(0.05, 0.04, 0.0), v(0.12, 0.012, 0.03), 0.005, 0.005, 5, hex(0xc2452d), FLAT);
      mb.tube(v(0.12, 0.012, 0.03), v(0.135, 0.008, 0.032), 0.0025, 0.0025, 4, hex(0xd9a441), METAL); // lõi đồng
      return true;
    default: return false;
  }
}

/** Món hàng: hộp thiếc có gờ và nhãn, chai có vai và nắp, cuộn băng, ống, vải gấp, hộp có sọc. */
// Cúp đầu boss (gốc: đầu boss rơi ra, clip 12 39:30, clip 14 7:58): dàn robot nên là đầu robot của boss đó gắn trên đế gỗ,
// mắt phát sáng màu riêng. Trả về true nếu `item` là cúp.
const TROPHY = {
  BruteBossHeadItemData: [0x5a6250, 0xff7a20], BirtherBossHeadItemData: [0xd8d6cc, 0x9aff40], SweatyRotterBossHeadItemData: [0xc9c2a8, 0xff4a2a],
  BuffTwinBossHeadItemData: [0xc85a8a, 0xff3a2a], HealerTwinBossHeadItemData: [0x3a9a96, 0x40ffb0],
};
function trophy(mb, item) {
  const t = TROPHY[items.key ? items.key(item) : ''];
  if (!t) return false;
  const [body, eye] = t;
  mb.cube(v3(0.0, 0.025, 0.0), v3(0.26, 0.05, 0.2), hex(0x5a3a22), WOOD);
  mb.cube(v3(0.0, 0.07, 0.0), v3(0.07, 0.04, 0.07), hex(0x3a3634), METAL);
  mb.cube(v3(0.0, 0.17, 0.0), v3(0.2, 0.16, 0.18), hex(body), METAL);
  mb.cube(v3(0.0, 0.17, 0.092), v3(0.15, 0.06, 0.01), hex(0x1c1c1c), FLAT);
  mb.emi = 1.2;
  for (const x of [-0.04, 0.04]) mb.cube(v3(x, 0.17, 0.098), v3(0.025, 0.025, 0.006), hex(eye), FLAT);
  mb.emi = 0.0;
  mb.cube(v3(0.0, 0.255, 0.0), v3(0.12, 0.012, 0.12), hex(0x2c2c2c), METAL);
  mb.cube(v3(0.06, 0.1, 0.05), v3(0.03, 0.03, 0.03), hex(0x8a1c18), FLAT);
  return true;
}

export function item(mb, item, p, k) {
  const [shape, col, col2] = items.look(item);
  const c = hex(col), c2 = hex(col2);
  mb.push(m4_mul(m4_translate(p), m4_scale(v3(k, k, k))));
  // phiên 8 đợt 3: vật liệu nhỏ lại 18 % (ván trên sàn ~0,64 m thay 0,78 m); hộp nhắm món dài giữ 0,26 m nên vẫn dễ nhắm
  mb.push(m4_scale(v3(0.82, 0.82, 0.82)));
  const mat = material_item(mb, item);
  mb.pop();
  if (mat) { mb.pop(); return; }
  if (trophy(mb, item)) { mb.pop(); return; }
  switch (shape) {
    case 0:
      mb.lathe(ZERO, [[0.0, 0.0], [0.056, 0.0], [0.058, 0.006], [0.054, 0.012], [0.054, 0.118], [0.058, 0.124], [0.056, 0.13], [0.045, 0.126], [0.0, 0.126]], 12, false, hex(0xa8acb0), METAL);
      mb.lathe(ZERO, [[0.0555, 0.02], [0.0555, 0.11]], 12, false, c, FLAT);
      mb.lathe(ZERO, [[0.0562, 0.05], [0.0562, 0.08]], 12, false, c2, FLAT);
      break;
    case 1:
      mb.lathe(ZERO, [[0.0, 0.0], [0.04, 0.0], [0.042, 0.01], [0.042, 0.14], [0.03, 0.17], [0.017, 0.19], [0.017, 0.235], [0.0, 0.235]], 10, true, c, GLASS);
      mb.lathe(ZERO, [[0.043, 0.04], [0.043, 0.11]], 10, false, c2, FLAT);
      // [SUA] ruot chai (nuoc ben trong): kinh trong 32 % dat tren nen xam gan nhu vo hinh, chai chi con thay nhan va nap.
      mb.lathe(ZERO, [[0.0, 0.004], [0.037, 0.004], [0.039, 0.012], [0.039, 0.138], [0.027, 0.168], [0.0, 0.168]], 10, false, c.map((x) => x * 0.45), FLAT);
      mb.lathe(ZERO, [[0.02, 0.222], [0.02, 0.242], [0.0, 0.242]], 8, false, hex(0xb9a44a), METAL);
      break;
    case 6:
      // Súng: thân, nòng, báng, băng đạn.
      mb.cube(v(0.0, 0.07, 0.0), v(0.24, 0.05, 0.035), c, METAL);
      mb.cube(v(0.16, 0.075, 0.0), v(0.12, 0.022, 0.022), hex(0x1c1f22), METAL);
      mb.cube(v(-0.1, 0.035, 0.0), v(0.05, 0.08, 0.03), c2, WOOD);
      mb.cube(v(0.0, 0.03, 0.0), v(0.035, 0.06, 0.025), hex(0x1c1f22), METAL);
      break;
    case 7:
      // Đồ trang trí: đế, thân màu, chóp.
      mb.cube(v(0.0, 0.012, 0.0), v(0.13, 0.024, 0.13), hex(0x3a3632), FLAT);
      mb.lathe(ZERO, [[0.03, 0.024], [0.055, 0.06], [0.05, 0.14], [0.02, 0.18], [0.0, 0.19]], 8, false, c, FLAT);
      mb.lathe(ZERO, [[0.052, 0.085], [0.052, 0.105]], 8, false, c2, FLAT);
      break;
    case 8:
      // Kiện hàng / đồ dựng đóng gói: thùng gỗ nhỏ có đai.
      mb.cube(v(0.0, 0.07, 0.0), v(0.17, 0.14, 0.13), c, WOOD);
      mb.cube(v(0.0, 0.07, 0.0), v(0.174, 0.03, 0.134), c2, METAL);
      break;
    case 9:
      // Hộp đạn: hộp thấp, vài đầu đạn ló ra.
      mb.cube(v(0.0, 0.03, 0.0), v(0.13, 0.06, 0.08), hex(0x4f5a3a), CARDBOARD);
      for (let i = 0; i < 4; i++) {
        mb.lathe(v(-0.045 + i * 0.03, 0.06, 0.0), [[0.009, 0.0], [0.009, 0.02], [0.0, 0.034]], 6, false, c, METAL);
      }
      break;
    case 2:
      mb.lathe(ZERO, [[0.035, 0.0], [0.075, 0.0], [0.078, 0.025], [0.075, 0.05], [0.035, 0.05], [0.035, 0.0]], 14, false, c, FLAT);
      mb.lathe(ZERO, [[0.036, 0.004], [0.0, 0.004]], 10, false, c2, FLAT);
      break;
    case 3:
      mb.lathe(ZERO, [[0.0, 0.0], [0.024, 0.0], [0.02, 0.1], [0.03, 0.3], [0.033, 0.4], [0.0, 0.41]], 8, true, c, WOOD);
      mb.lathe(ZERO, [[0.026, 0.01], [0.023, 0.09]], 8, false, c2, FLAT);
      break;
    case 4: {
      const b = mb.bevel;
      mb.bevel = 0.012;
      mb.cube(v(0.0, 0.03, 0.0), v(0.17, 0.06, 0.14), c, CARDBOARD);
      mb.cube(v(0.005, 0.085, 0.0), v(0.15, 0.05, 0.125), c2, CARDBOARD);
      mb.bevel = b;
      break;
    }
    default: {
      const b = mb.bevel;
      mb.bevel = 0.008;
      mb.cube(v(0.0, 0.045, 0.0), v(0.13, 0.09, 0.09), c, CARDBOARD);
      mb.bevel = b;
      mb.cube(v(0.0, 0.045, 0.0), v(0.134, 0.03, 0.093), c2, FLAT);
      mb.cube(v(0.0, 0.092, 0.0), v(0.04, 0.006, 0.092), c2, FLAT);
      break;
    }
  }
  mb.pop();
}

/** Búa hoặc gậy bóng chày; `hand` thêm bàn tay và cẳng tay (hình cầm tay góc nhìn thứ nhất). */
export function weapon(mb, bat, hand) {
  if (bat) {
    mb.lathe(ZERO, [[0.0, -0.2], [0.03, -0.196], [0.03, -0.18], [0.018, -0.16], [0.017, 0.05], [0.03, 0.3], [0.037, 0.48], [0.035, 0.55], [0.0, 0.565]], 12, true, hex(0xb8996a), WOOD); // gốc clip 19 23:47: gỗ nâu nhạt
    for (let k = 0; k < 6; k++) {
      const y = -0.15 + k * 0.035;
      mb.lathe(ZERO, [[0.0195, y], [0.0195, y + 0.028]], 10, false, hex(k % 2 === 0 ? 0x2a2a2a : 0x3a3632), FLAT);
    }
    mb.lathe(ZERO, [[0.0375, 0.4], [0.0375, 0.43]], 12, false, hex(0x8a1c18), FLAT);
  } else {
    // Búa gốc (op/03, clip 05): búa thép liền khối xám tối, cán thép, chuôi bọc cao su đỏ; mặt đập khối vuông quay phải,
    // móc nhổ đinh thuôn cong xuống quay trái (trong tay góc nhìn thứ nhất).
    mb.lathe(ZERO, [[0.0, -0.2], [0.021, -0.196], [0.022, -0.06], [0.017, 0.0], [0.016, 0.21], [0.0, 0.215]], 8, true, hex(0x4a4d50), METAL);
    mb.lathe(ZERO, [[0.0235, -0.192], [0.025, -0.17], [0.025, -0.07], [0.0235, -0.05]], 8, false, hex(0x8c2a24), FLAT);
    const old = mb.bevel;
    mb.bevel = 0.008;
    mb.cube(v(0.0, 0.245, -0.005), v(0.05, 0.066, 0.1), hex(0x45484b), METAL);
    mb.bevel = old;
    mb.cube(v(0.0, 0.245, 0.068), v(0.058, 0.064, 0.05), hex(0x505357), METAL);
    mb.lathe(ZERO, [[0.02, 0.2], [0.024, 0.205], [0.02, 0.215]], 8, false, hex(0x3a3d40), METAL);
    for (const sx of [-1.0, 1.0]) {
      mb.push(m4_mul(m4_translate(v(sx * 0.012, 0.24, -0.09)), m4_rot_x(-0.55)));
      mb.cube(ZERO, v(0.016, 0.034, 0.09), hex(0x45484b), METAL);
      mb.pop();
    }
  }
  if (hand) {
    const skin = hex(0xc68a5e);
    mb.ball(v(0.0, -0.11, 0.0), v(0.042, 0.05, 0.046), 10, skin, FLAT);
    for (let k = 0; k < 4; k++) {
      mb.capsule(v(-0.03, -0.145 + k * 0.024, -0.03), v(0.03, -0.145 + k * 0.024, -0.036), 0.012, 0.012, 6, skin, FLAT);
    }
    mb.capsule(v(0.0, -0.08, 0.03), v(0.0, -0.05, -0.025), 0.013, 0.011, 6, skin, FLAT);
    mb.capsule(v(0.01, -0.15, 0.04), v(0.1, -0.4, 0.32), 0.042, 0.055, 10, hex(0x4a4f44), FLAT);
    mb.lathe(v(0.012, -0.16, 0.045), [[0.048, 0.0], [0.05, 0.02]], 10, false, hex(0x34382f), FLAT);
  }
}

/** Xác zombie nằm: lưới thân có xương của `people.rs` áp tư thế nằm, thêm vũng máu.
 * people.rs không được port (contract): thân nằm do bộ dựng người của view đắp vào nếu nó có
 * `scene.impl().people.corpse(mb, seed, kind) -> scale`; không có thì chỉ còn vũng máu với scale mặc định. */
export function corpse(mb, seed, kind) {
  const im = scene.impl();
  const s = im && im.people && typeof im.people.corpse === 'function' ? im.people.corpse(mb, seed, kind) : (Math.min(kind, 2) === 2 ? 1.5 : 1.0);
  mb.lathe(v(0.0, 0.004, 0.0), [[0.75 * s, 0.0], [0.0, 0.0]], 12, false, hex(0x3a0d0d), FLAT);
}

/** Hình cầm tay / hình trên sàn của một món vũ khí bất kỳ trong danh mục: búa và gậy bóng chày dùng model riêng, vũ khí cận
 * chiến khác là cán + đầu theo loại (lưỡi, gai, cờ lê...), súng là thân + nòng + báng + băng đạn theo cỡ, đồ ném là chai / quả. */
/**
 * Món y tế cầm trên tay (ô Consumable). Màu theo vật thật trong clip 21 (38:40-54:30, ánh sáng thường): First Aid Kit là hộp
 * xanh ô-liu nhạt có quai xách trên nóc, chữ thập trắng; Painkillers lọ thuốc kê đơn cam, nắp trắng to có gờ, nhãn trắng;
 * Bandage cuộn băng trắng có đai xanh nõn chuối giữa thân. Dáng cầm: c01 5:45:05 (Painkillers), 5:45:08 (First Aid Kit).
 * Homemade Antibiotics không có cảnh gốc: lọ nâu nắp trắng `[ĐỀ XUẤT]`. Gốc chân +y.
 */
export function med_item(mb, item) {
  const white = hex(0xeeeae2);
  if (item === game.FIRSTAID) {
    const olive = hex(0xa3a866), dark = hex(0x6f7444);
    mb.cube(v(0.0, 0.0, 0.0), v(0.17, 0.2, 0.09), olive, FLAT);
    mb.cube(v(0.0, -0.005, 0.0465), v(0.05, 0.13, 0.004), white, FLAT);
    mb.cube(v(0.0, -0.005, 0.0465), v(0.13, 0.045, 0.004), white, FLAT);
    mb.cube(v(0.0, 0.101, 0.0), v(0.16, 0.006, 0.08), shade(olive, 1.08), FLAT);
    mb.cube(v(-0.045, 0.12, 0.0), v(0.014, 0.04, 0.018), dark, FLAT);
    mb.cube(v(0.045, 0.12, 0.0), v(0.014, 0.04, 0.018), dark, FLAT);
    mb.cube(v(0.0, 0.142, 0.0), v(0.104, 0.014, 0.02), dark, FLAT);
    // cạnh hẹp (gốc c01 5:45:08): nhãn trắng có đai tối ngang
    for (const sx of [-1, 1]) {
      mb.cube(v(0.0866 * sx, -0.01, 0.0), v(0.004, 0.15, 0.07), white, FLAT);
      mb.cube(v(0.0886 * sx, -0.02, 0.0), v(0.004, 0.022, 0.072), hex(0x3a3a3c), FLAT);
    }
  } else if (item === game.PILLS) {
    mb.lathe(ZERO, [[0.0, -0.06], [0.036, -0.06], [0.037, 0.04], [0.032, 0.05], [0.0, 0.05]], 12, true, hex(0xd8681e), FLAT);
    mb.lathe(ZERO, [[0.0379, -0.035], [0.0379, 0.02], [0.0, 0.02]], 12, true, white, FLAT);
    mb.lathe(v(0.0, 0.045, 0.0), [[0.0, 0.0], [0.043, 0.0], [0.045, 0.006], [0.045, 0.026], [0.04, 0.032], [0.0, 0.032]], 12, true, white, FLAT);
  } else if (item === game.ANTIBIOTICS) {
    mb.lathe(ZERO, [[0.0, -0.05], [0.03, -0.05], [0.03, 0.03], [0.018, 0.045], [0.0, 0.045]], 10, true, hex(0x6a4a2a), GLASS);
    mb.lathe(v(0.0, 0.043, 0.0), [[0.0, 0.0], [0.02, 0.0], [0.02, 0.02], [0.0, 0.02]], 10, true, white, FLAT);
    mb.cube(v(0.0, -0.01, 0.026), v(0.04, 0.035, 0.01), white, FLAT);
  } else {
    mb.lathe(ZERO, [[0.0, -0.045], [0.04, -0.045], [0.04, 0.045], [0.0, 0.045]], 12, true, white, CARDBOARD);
    mb.lathe(ZERO, [[0.0415, -0.018], [0.0415, 0.018]], 12, false, hex(0x8be04a), FLAT);
  }
}

export function weapon_item(mb, item, hand) {
  if (item === game.HAMMER) {
    return weapon(mb, false, hand);
  }
  if (item === game.BAT) {
    return weapon(mb, true, hand);
  }
  const [, col, col2] = items.look(item);
  const name = items.iname(item).toLowerCase();
  const has = (k) => name.includes(k);
  const steel = hex(0x8a9096);
  const dark = hex(0x24272a);
  if (items.gun(item) !== null) {
    // Súng: model đủ bộ phận ở guns.rs (trục +x là nòng).
    guns.model(mb, item);
    guns.off_part(mb, item);
    return;
  }
  if (items.throwable(item) !== null) {
    if (has('molotov')) {
      // Gốc clip 19 21:19 (1279 s): chai thuỷ tinh tối cao cỡ chai rượu, vai xuôi, cổ dài, nút giẻ ngắn
      mb.lathe(ZERO, [[0.0, -0.12], [0.05, -0.12], [0.055, -0.1], [0.055, 0.07], [0.04, 0.12], [0.022, 0.15], [0.02, 0.24], [0.0, 0.24]], 8, true, hex(0x3a403a), METAL);
      mb.cube(v(0.0, 0.26, 0.0), v(0.026, 0.05, 0.026), hex(0x8a7a5a), CARDBOARD);
    } else if (has('bone')) {
      // gốc "Large Bone" (clip 20 31:00-33:20, clip 12 37:21): xương đùi to dài màu kem, mỗi đầu hai núm tròn
      const bc = hex(0xe9dcb0);
      mb.capsule(v(0.0, -0.17, 0.0), v(0.0, 0.17, 0.0), 0.028, 0.028, 6, bc, FLAT);
      for (const y of [-0.2, 0.2]) {
        mb.ball(v(-0.026, y, 0.0), v(0.034, 0.034, 0.03), 6, bc, FLAT);
        mb.ball(v(0.026, y + 0.01 * Math.sign(y), 0.0), v(0.032, 0.032, 0.03), 6, bc, FLAT);
      }
    } else {
      mb.ball(v(0.0, 0.0, 0.0), v(0.055, 0.07, 0.055), 8, hex(has('nail') ? 0x6f747a : 0x4a5a3a), METAL);
      mb.cube(v(0.0, 0.08, 0.0), v(0.03, 0.03, 0.03), steel, METAL);
    }
    if (hand) {
      mb.ball(v(0.0, -0.06, 0.0), v(0.045, 0.05, 0.045), 8, hex(0xc68a5e), FLAT);
      mb.capsule(v(0.01, -0.1, 0.04), v(0.1, -0.4, 0.32), 0.042, 0.055, 8, hex(0x4a4f44), FLAT);
    }
    return;
  }
  // Cận chiến: cán dọc trục y, đầu theo loại.
  // Taser Stick gốc (clip 22 6:09:30, tên loc item_meleeweapon_stun_stick_name): gậy dài từ mép dưới phải lên gần mép trên, chuôi đen,
  // thân là chuỗi khối trắng xen vòng đồng xoắn nhẹ, đầu đen
  const taser = has('taser') || has('stun');
  // Sawblade Club gốc (clip 22 5:48:30-5:52): cán thép dẹt xám tối dài như gậy, đầu là lưỡi cưa tròn tối răng cưa
  const saw = has('sawblade');
  const short = !taser && (has('knife') || has('dagger') || has('wrench') || has('detonator') || has('stick'));
  const top = taser ? 0.62 : short ? 0.22 : has('spear') ? 0.85 : 0.5;
  const metal_shaft = has('pipe') || has('rebar') || has('wrench') || has('crowbar');
  // Xà beng gốc (c01 0:22:40): thân sơn đỏ, quấn băng trắng gần chuôi, đầu móc cong lớn (không phải que thẳng đầu xanh)
  const crow = has('crowbar');
  // Gậy chông gốc (c01 3:11:00): chày gỗ to dần lên đầu, đinh đen cắm tua tủa (không phải ống xám mảnh)
  const club = has('spiky bat');
  // Ống quấn băng gốc (clip 09 23:28): ống thép xám to, quấn băng sáng từng khúc. Vaccinator gốc (c01 8:10:00): chày to,
  // ống tiêm trắng cắm tua tủa quanh đầu.
  const taped = has('taped'), vacc = has('vaccin');
  if (taped) {
    // gốc là cụm ống nước xám xanh tối: thân ống, khớp chữ T, cút cong lên, vô lăng van đỏ
    const pc = hex(0x56604f), pj = hex(0x454d40);
    mb.lathe(ZERO, [[0.0, -0.2], [0.03, -0.196], [0.03, top], [0.0, top + 0.004]], 10, true, pc, METAL);
    mb.cyl(v(0.0, top - 0.02, 0.0), 0.042, 0.042, 0.06, 10, pj, METAL);
    mb.tube(v(0.0, top - 0.02, 0.0), v(0.0, top - 0.02, -0.12), 0.03, 0.03, 10, pc, METAL);
    mb.cyl(v(0.0, top - 0.02, -0.12), 0.04, 0.04, 0.05, 10, pj, METAL);
    mb.tube(v(0.0, top - 0.02, -0.12), v(0.0, top + 0.1, -0.12), 0.03, 0.03, 10, pc, METAL);
    mb.cyl(v(0.0, top + 0.1, -0.12), 0.045, 0.045, 0.03, 10, pj, METAL);
    mb.tube(v(0.0, 0.02, 0.0), v(0.07, 0.02, 0.0), 0.012, 0.012, 6, pj, METAL);
    mb.tube(v(0.07, -0.03, 0.0), v(0.07, 0.07, 0.0), 0.008, 0.008, 6, hex(0x9a2420), FLAT);
    mb.tube(v(0.07, 0.02, -0.05), v(0.07, 0.02, 0.05), 0.008, 0.008, 6, hex(0x9a2420), FLAT);
    for (const y of [-0.17, -0.1]) mb.cyl(v(0.0, y, 0.0), 0.034, 0.034, 0.035, 10, hex(0x8f8c7c), FLAT);
  } else if (vacc) {
    mb.lathe(ZERO, [[0.0, -0.2], [0.026, -0.196], [0.026, -0.05], [0.045, top * 0.5], [0.06, top], [0.0, top + 0.012]], 6, true, hex(0x6a6a52), WOOD);
  } else if (club) mb.lathe(ZERO, [[0.0, -0.2], [0.022, -0.196], [0.022, -0.05], [0.034, top * 0.5], [0.05, top], [0.0, top + 0.012]], 8, true, hex(0xc9a46a), WOOD);
  else if (saw) mb.cube(v(0.0, (top - 0.2) / 2, 0.0), v(0.022, top + 0.2, 0.05), hex(0x4a4e52), METAL);
  else if (taser) {
    mb.lathe(ZERO, [[0.0, -0.2], [0.022, -0.196], [0.022, 0.06], [0.0, 0.065]], 8, true, hex(0x26282a), METAL);
    mb.lathe(ZERO, [[0.0, 0.06], [0.012, 0.06], [0.012, top], [0.0, top + 0.004]], 8, true, hex(0x3a3c3e), METAL);
    for (let k = 0; k < 9; k++) {
      const y = 0.1 + k * (top - 0.14) / 8, ox = 0.009 * Math.cos(k * 1.9), oz = 0.009 * Math.sin(k * 1.9);
      mb.cube(v(ox, y, oz), v(0.034, 0.03, 0.034), hex(0xeeeae2), FLAT);
      mb.cyl(v(-ox, y + 0.03, -oz), 0.03, 0.03, 0.012, 8, hex(0xc08a58), METAL);
    }
  }
  else if (crow) mb.lathe(ZERO, [[0.0, -0.2], [0.03, -0.196], [0.03, -0.05], [0.027, top * 0.6], [0.026, top], [0.0, top + 0.005]], 8, true, hex(0xa8232b), METAL); // xà beng gốc to bản
  else mb.lathe(ZERO, [[0.0, -0.2], [0.02, -0.196], [0.02, -0.05], [0.016, top * 0.6], [0.014, top], [0.0, top + 0.005]], 8, true, hex(col2), metal_shaft ? METAL : WOOD);
  if (has('chainsaw')) {
    mb.cube(v(0.0, top * 0.2, 0.0), v(0.09, 0.2, 0.12), hex(0xb0452a), METAL);
    mb.cube(v(0.0, top + 0.1, 0.0), v(0.02, 0.5, 0.07), steel, METAL);
  } else if (has('axe')) {
    // rìu cứu hoả gốc (biểu tượng ô đồ, clip 12 35:25): đầu rìu đỏ to, lưỡi thép, gáy nhọn phía sau
    mb.cube(v(0.0, top - 0.06, -0.06), v(0.036, 0.16, 0.14), hex(0x9a2a22), METAL);
    mb.cube(v(0.0, top - 0.06, -0.15), v(0.03, 0.2, 0.05), steel, METAL);
    mb.cube(v(0.0, top - 0.06, 0.05), v(0.03, 0.05, 0.09), hex(0x9a2a22), METAL); // lưỡi quay trái trên màn như gốc
  } else if (saw) {
    const sc = hex(0x2e3134);
    mb.tube(v(-0.006, top + 0.05, 0.0), v(0.006, top + 0.05, 0.0), 0.095, 0.095, 16, sc, METAL);
    for (let k = 0; k < 16; k++) {
      const a = k * Math.PI / 8;
      mb.cube(v(0.0, top + 0.05 + 0.1 * Math.sin(a), 0.1 * Math.cos(a)), v(0.01, 0.022, 0.022), sc, METAL);
    }
    mb.tube(v(-0.015, top + 0.05, 0.0), v(0.015, top + 0.05, 0.0), 0.024, 0.024, 8, hex(0x6a6e72), METAL);
  } else if (has('knife') || has('dagger') || has('blade') || has('spear')) {
    mb.cube(v(0.0, top + 0.07, 0.0), v(0.012, 0.2, 0.05), has('bone') ? hex(0xe6e2d6) : has('knife') ? hex(0x464a4e) : steel, METAL); // dao gốc (clip 21 1:56): lưỡi xám tối
  } else if (taped) {
    // ống quấn băng: không có đầu riêng
  } else if (vacc) {
    for (let k = 0; k < 10; k++) {
      const a = k * 2.4, y = top * 0.4 + (k / 9) * top * 0.55, r = 0.045 + 0.02 * (y / top);
      const dx = Math.cos(a), dz = Math.sin(a);
      // ống tiêm gốc (c01 8:10:00): thân trắng xám dài, pít-tông đỏ thẫm ở trong, kim thép dài thò ra
      mb.tube(v(dx * r * 0.5, y, dz * r * 0.5), v(dx * (r + 0.1), y, dz * (r + 0.1)), 0.02, 0.02, 6, hex(0xc9cbc8), FLAT);
      mb.tube(v(dx * r * 0.4, y, dz * r * 0.4), v(dx * (r - 0.005), y, dz * (r - 0.005)), 0.022, 0.022, 6, hex(0x7a1f22), FLAT);
      mb.tube(v(dx * (r + 0.1), y, dz * (r + 0.1)), v(dx * (r + 0.19), y, dz * (r + 0.19)), 0.004, 0.002, 4, hex(0xb8bcc0), METAL);
    }
  } else if (club) {
    for (let k = 0; k < 14; k++) {
      const a = k * 2.4, y = top * 0.35 + (k / 13) * top * 0.6, r = 0.03 + 0.02 * (y / top);
      mb.cube(v(Math.cos(a) * r, y, Math.sin(a) * r), v(0.01, 0.01, 0.07), hex(0x2a2c30), METAL);
    }
  } else if (has('spik') || has('nail')) {
    for (let k = 0; k < 6; k++) {
      const a = k * 1.05;
      mb.cube(v(Math.cos(a) * 0.035, top - 0.04 - k * 0.035, Math.sin(a) * 0.035), v(0.012, 0.012, 0.05), steel, METAL);
    }
  } else if (has('saw')) {
    mb.cyl(v(0.0, top - 0.02, 0.0), 0.11, 0.11, 0.012, 12, steel, METAL);
  } else if (crow) {
    for (let k = 0; k <= 6; k++) {
      const a = k * 0.5;
      mb.cube(v(0.0, top + 0.1 * Math.sin(a), -0.1 + 0.1 * Math.cos(a)), v(0.046, 0.05, 0.05), hex(0xa8232b), METAL);
    }
    mb.cube(v(0.0, top - 0.005, -0.2), v(0.03, 0.04, 0.04), hex(0x8a8f94), METAL);
    for (const y of [-0.16, -0.12, 0.02]) mb.cube(v(0.0, y, 0.0), v(0.044, 0.024, 0.044), hex(0xe8e4dc), FLAT);
  } else if (taser) {
    mb.cube(v(0.0, top + 0.02, 0.0), v(0.03, 0.05, 0.03), hex(0x1c1d1e), METAL);
  } else if (has('detonator')) {
    mb.cube(v(0.0, top, 0.0), v(0.06, 0.09, 0.04), dark, METAL);
    mb.emi = 0.9;
    mb.cube(v(0.0, top + 0.05, 0.0), v(0.025, 0.02, 0.025), hex(0xd8342a), FLAT);
    mb.emi = 0.0;
  } else {
    mb.cube(v(0.0, top - 0.03, 0.0), v(0.05, 0.1, 0.05), hex(col), METAL);
  }
  if (hand) {
    const skin = hex(0xc68a5e);
    mb.ball(v(0.0, -0.11, 0.0), v(0.042, 0.05, 0.046), 10, skin, FLAT);
    mb.capsule(v(0.01, -0.15, 0.04), v(0.1, -0.4, 0.32), 0.042, 0.055, 10, hex(0x4a4f44), FLAT);
  }
}

/** Khung kệ `cols` cột x `levels` tầng trong khung riêng của kệ (gốc giữa chân kệ, +z là mặt trước). */
export function shelf_unit(mb, cols, levels, col, metal) {
  const pat = metal ? METAL : WOOD;
  const c = hex(col);
  const hl = cols * lay.SLOT_W * 0.5;
  const top = 0.43 + levels * 0.5;
  for (const x of [-hl, hl]) {
    for (const z of [0.25, -0.27]) {
      mb.cube(v(x, top * 0.5 + 0.02, z), v(0.045, top + 0.04, 0.045), shade(c, 0.8), pat);
    }
  }
  for (let l = 0; l <= levels; l++) {
    const y = 0.43 + l * 0.5;
    mb.cube(v(0.0, y, -0.01), v(hl * 2.0 + 0.06, 0.03, 0.52), shade(c, 0.92 + 0.08 * (l % 2)), pat);
    mb.cube(v(0.0, y + 0.03, 0.24), v(hl * 2.0, 0.05, 0.02), shade(c, 1.1), pat);
  }
  mb.cube(v(0.0, top * 0.5, -0.28), v(hl * 2.0, top, 0.02), shade(c, 0.6), pat);
}

/** Hình của một vật dựng đã cố định (khung riêng: gốc ở chân vật, +z là mặt trước). Hình sinh theo loại và tên món. */
export function placed(mb, item, on = false) {
  const [, col, col2] = items.look(item);
  const c = hex(col), c2 = hex(col2);
  const name = items.iname(item).toLowerCase();
  const has = (k) => name.includes(k);
  const [hx, hz, , high] = build.footprint(item);
  const steel = hex(0x8a9096);
  const dark = hex(0x24272a);
  const wood = hex(0x7a5a3a);
  const dims = build.shelf_dims(item);
  if (dims !== null) {
    const [cols, levels] = dims;
    const metal = item === game.SHELF_SECURE || item === game.TABLE_SECURE || item === game.UNIT_SPECIAL || item === game.FRIDGE || item === game.RACK;
    shelf_unit(mb, cols, levels, metal ? 0x5a6066 : 0x7a5a3a, metal);
    if (item === game.FRIDGE) {
      mb.cube(v(0.0, 1.0, -0.2), v(hx * 2.0, 2.0, 0.2), hex(0xcfd4d0), METAL);
    }
    return;
  }
  if (item === game.SPIKE_WALL) {
    // sleeper on the ground (it floated 4 cm), stakes set 1 cm into its top
    mb.cube(v(0.0, 0.08, 0.0), v(2.2, 0.16, 0.5), wood, WOOD);
    for (let k = 0; k < 7; k++) {
      const x = -0.9 + k * 0.3;
      for (const [dz, lean] of [[0.12, 0.55], [-0.12, -0.55]]) {
        mb.push(m4_mul(m4_translate(v(x, 0.15, dz)), m4_rot_x(lean)));
        mb.lathe(ZERO, [[0.03, 0.0], [0.025, 0.7], [0.0, 0.95]], 6, false, shade(wood, 1.2), WOOD);
        mb.pop();
      }
    }
  } else if (item === game.BEAR_TRAP) {
    bear_trap_open(mb);
  } else if (item === game.TURRET || item === game.AUTO_MINIGUN) {
    mb.cyl(v(0.0, 0.0, 0.0), 0.36, 0.3, 0.1, 10, dark, METAL);
    for (const a of [0.0, 2.1, 4.2]) {
      mb.capsule(v(Math.cos(a) * 0.34, 0.05, Math.sin(a) * 0.34), v(0.0, 0.9, 0.0), 0.03, 0.03, 6, steel, METAL);
    }
    mb.cube(v(0.0, 1.05, 0.0), v(0.3, 0.26, 0.5), hex(item === game.TURRET ? 0x4a5a3a : 0x5a5f66), METAL);
    const off = item === game.TURRET ? 0.07 : 0.05;
    for (const dx of [-off, off]) {
      mb.tube(v(dx, 1.08, 0.2), v(dx, 1.08, 0.95), 0.03, 0.026, 8, dark, METAL);
    }
    mb.cube(v(0.22, 1.0, -0.05), v(0.14, 0.2, 0.3), hex(0x6a6a3a), METAL);
    if (item === game.AUTO_MINIGUN) {
      mb.emi = 0.9;
      mb.cube(v(0.0, 1.21, -0.15), v(0.05, 0.05, 0.05), hex(0xd8342a), FLAT);
      mb.emi = 0.0;
    }
  } else if (item === game.EXPLOSIVE_BARREL) {
    mb.cyl(v(0.0, 0.0, 0.0), 0.3, 0.3, 0.9, 10, hex(0xb0342a), CORRUGATED);
    mb.lathe(ZERO, [[0.305, 0.35], [0.305, 0.55]], 10, false, hex(0xe8c23a), FLAT);
  } else if (item === game.REMOTE_BOMB || item === game.REMOTE_INC) {
    mb.cube(v(0.0, 0.08, 0.0), v(0.3, 0.16, 0.22), item === game.REMOTE_BOMB ? hex(0x4a5a3a) : hex(0x8a4a2a), METAL);
    mb.cyl(v(0.1, 0.16, 0.0), 0.006, 0.006, 0.25, 4, dark, METAL);
    mb.emi = 1.0;
    mb.cube(v(-0.08, 0.17, 0.0), v(0.04, 0.03, 0.04), hex(0xd8342a), FLAT);
    mb.emi = 0.0;
  } else if (item === game.TV) {
    // [PARITY M03] gốc c01 7:36:55: "Working Television" là TV hộp CRT xám đen to (~0,7 m), màn tối lồi, không có kệ gỗ.
    const shell = hex(0x3c3f42);
    mb.cube(v(0.0, 0.27, -0.04), v(0.72, 0.54, 0.5), shell, METAL); // thân hộp
    mb.cube(v(0.0, 0.25, -0.38), v(0.5, 0.4, 0.2), shade(shell, 0.85), METAL); // đuôi bóng hình thu nhỏ phía sau
    mb.cube(v(0.0, 0.29, 0.225), v(0.6, 0.44, 0.03), hex(0x6a6e72), FLAT); // viền màn
    // gốc TelevisionObject: [E] bật / tắt (_turnedOnViewGameObject là màn sáng); tắt thì màn tối
    mb.emi = on ? 0.6 : 0.0;
    mb.cube(v(-0.04, 0.3, 0.245), v(0.46, 0.36, 0.012), on ? hex(0x7fa8bc) : hex(0x1c2428), FLAT);
    mb.emi = 0.0;
    for (let k = 0; k < 2; k++) mb.cyl(v(0.25, 0.36 - k * 0.1, 0.24), 0.025, 0.025, 0.02, 8, hex(0xb0b4b8), FLAT); // núm
    for (const x of [-0.3, 0.3]) mb.cube(v(x, 0.01, 0.0), v(0.08, 0.02, 0.4), dark, METAL); // chân đế
  } else if (high === 1) {
    // Đồ treo tường: khung / rèm / biển ở tầm mắt.
    const drape = has('drape');
    mb.cube(v(0.0, drape ? 1.4 : 1.6, 0.0), v(hx * 2.0, drape ? 1.6 : 0.6, 0.04), c, drape ? CARDBOARD : WOOD);
    mb.cube(v(0.0, 1.6, 0.025), v(hx * 1.5, 0.35, 0.01), c2, FLAT);
  } else if (high === 2) {
    mb.cyl(v(0.0, 2.75, 0.0), 0.012, 0.012, 0.4, 4, dark, FLAT);
    mb.lathe(v(0.0, 2.5, 0.0), [[0.06, 0.25], [0.3, 0.0], [0.26, -0.03]], 10, false, c, METAL);
    mb.emi = 1.4;
    mb.ball(v(0.0, 2.52, 0.0), v(0.07, 0.07, 0.07), 6, hex(0xfff0c0), FLAT);
    mb.emi = 0.0;
  } else if (has('rug')) {
    mb.cube(v(0.0, 0.01, 0.0), v(hx * 2.0, 0.02, hz * 2.0), c, CARDBOARD);
    mb.cube(v(0.0, 0.022, 0.0), v(hx * 1.6, 0.004, hz * 1.5), c2, CARDBOARD);
  } else if (has('sofa')) {
    mb.cube(v(0.0, 0.25, 0.05), v(hx * 2.0, 0.3, 0.7), c, CARDBOARD);
    mb.cube(v(0.0, 0.6, -0.3), v(hx * 2.0, 0.6, 0.2), shade(c, 0.85), CARDBOARD);
    for (const x of [-hx + 0.1, hx - 0.1]) {
      mb.cube(v(x, 0.45, 0.05), v(0.2, 0.3, 0.7), shade(c, 0.9), CARDBOARD);
    }
  } else if (has('chair') || has('stool') || has('throne')) {
    for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) {
      mb.cube(v(x, 0.22, z), v(0.04, 0.44, 0.04), c2, WOOD);
    }
    mb.cube(v(0.0, 0.46, 0.0), v(0.5, 0.05, 0.5), c, WOOD);
    if (!has('stool')) {
      const th = has('throne');
      mb.cube(v(0.0, th ? 1.0 : 0.78, -0.23), v(0.5, th ? 1.1 : 0.6, 0.05), c, WOOD);
    }
  } else if (has('plant') || has('palm') || has('bonsai') || has('flower') || has('flamingo')) {
    const h = has('tall') || has('palm') || has('bonsai') ? 1.2 : 0.45;
    mb.lathe(ZERO, [[0.1, 0.0], [0.15, 0.22], [0.13, 0.24], [0.0, 0.24]], 8, false, c2, PLASTER);
    mb.cyl(v(0.0, 0.2, 0.0), 0.02, 0.015, h * 0.6, 5, hex(0x4a3524), WOOD);
    for (let k = 0; k < 6; k++) {
      const a = k * 1.05;
      mb.ball(v(Math.cos(a) * 0.12, 0.2 + h * (0.6 + 0.07 * k), Math.sin(a) * 0.12), v(0.16, 0.1, 0.16), 6, hex(has('flamingo') ? 0xd87a94 : 0x4a7a3a), GROUND);
    }
  } else if (has('lamp') || has('light')) {
    mb.cyl(v(0.0, 0.0, 0.0), 0.14, 0.12, 0.04, 8, dark, METAL);
    mb.cyl(v(0.0, 0.04, 0.0), 0.015, 0.015, 1.4, 5, steel, METAL);
    mb.emi = 1.2;
    mb.lathe(v(0.0, 1.4, 0.0), [[0.1, 0.25], [0.2, 0.0]], 8, false, hex(0xfff0c0), FLAT);
    mb.emi = 0.0;
  } else if (has('barrel')) {
    mb.cyl(v(0.0, 0.0, 0.0), 0.3, 0.3, 0.9, 10, c, has('wooden') ? WOOD : CORRUGATED);
  } else if (has('crate') || has('pallet')) {
    const h = has('pallet') ? 0.14 : has('double') ? 0.9 : 0.5;
    mb.cube(v(0.0, h * 0.5, 0.0), v(0.76, h, 0.76), wood, WOOD);
    mb.cube(v(0.0, h * 0.5, 0.0), v(0.78, 0.06, 0.78), shade(wood, 0.7), WOOD);
  } else if (has('table') || has('desk') || has('counter') || has('piano') || has('chiller')) {
    mb.cube(v(0.0, 0.74, 0.0), v(hx * 2.0, 0.06, hz * 2.0), c, WOOD);
    for (const [x, z] of [[-hx + 0.06, -hz + 0.06], [hx - 0.06, -hz + 0.06], [-hx + 0.06, hz - 0.06], [hx - 0.06, hz - 0.06]]) {
      mb.cube(v(x, 0.36, z), v(0.06, 0.72, 0.06), shade(c, 0.7), WOOD);
    }
    if (has('piano') || has('chiller') || has('counter')) {
      mb.cube(v(0.0, 0.5, -hz * 0.3), v(hx * 2.0, 1.0, hz * 1.2), shade(c, 0.8), WOOD);
    }
  } else if (has('skull') || has('head')) {
    mb.cube(v(0.0, 0.3, 0.0), v(0.08, 0.6, 0.08), wood, WOOD);
    mb.ball(v(0.0, 0.72, 0.0), v(0.14, 0.16, 0.16), 8, has('head') ? hex(0x6a7a4a) : hex(0xe6e2d6), FLAT);
    mb.cube(v(-0.05, 0.74, 0.14), v(0.04, 0.04, 0.02), dark, FLAT);
    mb.cube(v(0.05, 0.74, 0.14), v(0.04, 0.04, 0.02), dark, FLAT);
  } else if (items.ival(item) >= 10000) {
    // Thú bông: thân, đầu, hai tai.
    mb.ball(v(0.0, 0.2, 0.0), v(0.2, 0.22, 0.18), 8, c, CARDBOARD);
    mb.ball(v(0.0, 0.5, 0.0), v(0.15, 0.15, 0.15), 8, c, CARDBOARD);
    for (const x of [-0.11, 0.11]) {
      mb.ball(v(x, 0.64, 0.0), v(0.05, 0.06, 0.03), 6, c2, CARDBOARD);
    }
  } else {
    // Mặc định: bệ + khối màu + dải.
    mb.cube(v(0.0, 0.05, 0.0), v(hx * 1.6, 0.1, hz * 1.6), dark, METAL);
    mb.cube(v(0.0, 0.45, 0.0), v(hx * 1.2, 0.7, hz * 1.2), c, PLASTER);
    mb.cube(v(0.0, 0.5, 0.0), v(hx * 1.22, 0.1, hz * 1.22), c2, FLAT);
  }
}

/* VIEW NOTES (models.js)
 * Mesh code is ported 1:1 (MB calls in the same order with the same numbers); callers append these into their MB and
 * spawn the result: world.js (facade/counter/shelves/truck/tree/item/corpse/placed into the static world and prop
 * meshes), actors.js (box of TIN + BEANS), fp.js (weapon_item as the first-person held model, {viewmodel:true}),
 * icons (weapon_item / placed / item rendered as item icons). All are solid-material, pattern ids in uv.x.
 * Frames: weapon / weapon_item melee and throwables have the handle along +y (grip at y ~ -0.11 where the hand ball is),
 * guns have the barrel along +x (guns.model). placed(): origin at the foot, +z is the front. item(): origin at the
 * base, scaled by k.
 * corpse(): Rust posed the shared skinned body lying on its back (people::corpse_pose: scale s, translate (0,0.13,0.75),
 * rot_x(-1.5), joint angles (z,x) = (0,0),(0.5,0),(-2.3,0),(0.9,0),(-0.25,0),(0.35,0.3),(0,0.5),(0,0.9),(0,-0.3),(0,-0.7))
 * baked into the prop mesh, then added a blood pool disc radius 0.75*s at y 0.004, colour 0x3a0d0d. s = Look scale
 * (Hulk 1.5, others height/1.78 from the seed).
 * PORT GAPS: corpse body — people.rs is not ported; the JS calls `scene.impl().people.corpse(mb, seed, kind)` (expected
 * to append the lying body to mb and return its scale) when the people kit provides it; otherwise only the blood pool
 * is drawn with s = 1.5 for kind 2 (Hulk) and 1.0 otherwise (Rust used the seeded height/1.78 for kinds 0 and 1).
 */

/// [par-counter D10] Cách nhìn của từng mệnh giá pin (1/5/10/50/100/1000, GeneratePayment), theo pin của gốc nằm ngang:
/// 1 khối xanh lá đầu xanh nhạt (clip 09 3:52 "1"), 5 khối xanh đậm đầu xanh dương (clip 02 7:42 "5"), 10 thỏi tím đầu trắng,
/// 50 thỏi vàng (op/04b, clip 01 f_0362, clip 09 3:53: ngăn tím và ngăn vàng). [ĐỀ XUẤT] 100 khối đen đầu vàng (thấy trên
/// quầy clip 09 3:53, chưa đọc được số), 1000 thỏi vàng to đầu đen: gốc chưa thấy. shape 'box' (len, w, h) / 'cyl' (len, r);
/// r, h = cỡ bao để dán nhãn số.
export const BATTERY_LOOK = {
  1: { shape: 'box', col: 0x2f5a2c, cap: 0x86d65a, len: 0.11, w: 0.06, h: 0.05, r: 0.03, h2: 0.05 },
  5: { shape: 'box', col: 0x2c3268, cap: 0x4aa6e8, len: 0.12, w: 0.064, h: 0.054, r: 0.032, h2: 0.054 },
  10: { shape: 'cyl', col: 0x5e3fa0, cap: 0xd8dade, len: 0.12, r: 0.026 },
  50: { shape: 'cyl', col: 0xd9a63a, cap: 0xf2d77a, len: 0.12, r: 0.028 },
  100: { shape: 'box', col: 0x252729, cap: 0xe7c43c, len: 0.12, w: 0.07, h: 0.058, r: 0.035, h2: 0.058 },
  1000: { shape: 'cyl', col: 0xe8b830, cap: 0x2a2c2e, len: 0.14, r: 0.034 },
};
export function battery_look(value) {
  return BATTERY_LOOK[value] || BATTERY_LOOK[value >= 1000 ? 1000 : value >= 100 ? 100 : value >= 50 ? 50 : value >= 10 ? 10 : value >= 5 ? 5 : 1];
}
