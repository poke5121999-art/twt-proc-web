// Port of src/models.rs.
//! Mô hình dựng bằng code từ nhiều chi tiết nhỏ (lathe, ống, viên nang, đùn, hộp vát cạnh), gộp thành một mesh:
//! xe bán tải, mặt tiền quán, quầy, kệ, cây, người và zombie low-poly, vũ khí cầm tay.

import { v3, v2, ZERO, Y, Z, signum } from './vec.js';
import {
  hex, shade, m4_mul, m4_translate, m4_rot_x, m4_rot_y, m4_rot_z, m4_scale,
  FLAT, WOOD, CONCRETE, CORRUGATED, GROUND, PLASTER, CARDBOARD, GLASS, STRIPES, METAL,
} from './geom.js';
import * as game from './game.js';
import * as lay from './lay.js';
import * as items from './items.js';
import * as build from './build.js';
import * as guns from './guns.js';
import * as scene from './scene.js';

function v(x, y, z) {
  return v3(x, y, z);
}

const TAU = Math.PI * 2;

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
  // Khung biển SHOP, hai thanh chống, bu lông.
  for (const [c, s] of [[v(0.0, 4.68, 5.11), v(4.76, 0.07, 0.2)], [v(0.0, 3.47, 5.11), v(4.76, 0.07, 0.2)], [v(-2.36, 4.07, 5.11), v(0.07, 1.26, 0.2)], [v(2.36, 4.07, 5.11), v(0.07, 1.26, 0.2)]]) {
    mb.cube(c, s, hex(0x1c2024), METAL);
  }
  for (const x of [-1.9, 1.9]) {
    mb.tube(v(x, 4.4, 5.05), v(x, 3.5, 4.2), 0.03, 0.03, 6, steel, METAL);
  }
  for (const [x, y] of [[-2.2, 4.55], [2.2, 4.55], [-2.2, 3.6], [2.2, 3.6], [0.0, 4.6], [0.0, 3.55]]) {
    mb.tube(v(x, y, 5.17), v(x, y, 5.2), 0.03, 0.03, 6, hex(0x8a8f94), METAL);
  }
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
  // Ngăn kéo phía người bán: ba ngăn kéo pin kéo mở sẵn (mỗi ngăn hai ô theo mệnh giá, viền màu của mệnh giá, xem
  // BATTERY_LOOK) + hai ngăn gỗ. Pin thật soi xong rơi vào đúng ô (plug/till.js vẽ pin trong ô).
  [[1, 5], [10, 50], [100, 1000]].forEach((pair, k) => {
    const x = -0.62 + k * 0.44;
    mb.block(v(x, 0.5, -3.03), v(0.4, 0.26, 0.04), shade(body, 0.9), WOOD);
    // khay kéo ra phía người bán: đáy, hai thành bên, mặt trước có tay nắm, vách chia giữa
    const tc = hex(0x3a3f44);
    mb.block(v(x + 0.03, 0.66, -3.3), v(0.34, 0.012, 0.27), tc, METAL);
    for (const sx of [x + 0.03, x + 0.358]) mb.block(v(sx, 0.66, -3.3), v(0.012, 0.075, 0.27), shade(tc, 1.1), METAL);
    mb.block(v(x + 0.03, 0.66, -3.312), v(0.34, 0.09, 0.016), shade(body, 0.85), WOOD);
    mb.tube(v(x + 0.13, 0.7, -3.325), v(x + 0.27, 0.7, -3.325), 0.01, 0.01, 6, hex(0xa0a4a8), METAL);
    mb.block(v(x + 0.194, 0.66, -3.3), v(0.012, 0.06, 0.27), shade(tc, 1.2), METAL);
    pair.forEach((val, j) => {
      mb.emi = 0.5;
      mb.block(v(x + 0.045 + j * 0.165, 0.672, -3.296), v(0.14, 0.004, 0.02), hex(BATTERY_LOOK[val].col), FLAT);
      mb.emi = 0.0;
    });
  });
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
  const wood = hex(0xa8865e), iron = hex(0x3a3d40);
  const L = 7 * SLOT_W, zc = SHELF_Z0 + L * 0.5;
  const list = fixed && fixed.length ? fixed : [];
  for (const sh of list) {
    const face = Math.round(Math.sin(sh.yaw)) || 1; // +z riêng của kệ trên trục x thế giới (rot_y)
    const x = sh.pos.x;
    const xw = x - face * 0.447; // mặt tường (tường trong ở x ±5)
    const levels = sh.plank ? 1 : 3;
    const xf = x + face * (sh.plank ? lay.PLANK_FRONT : 0.25);
    const d = Math.abs(xf - xw), half = d * 0.5;
    for (let l = 0; l < levels; l++) {
      const y = sh.plank ? lay.PLANK_TOP - 0.02 : 0.43 + l * 0.5;
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
      if (sh.plank) {
        // thanh nẹp treo thẻ giá: dải gỗ mỏng sát dưới mép trước, ba thẻ chồng mỗi cột (plug/pricetag.js)
        mb.cube(v(xf - face * 0.01, y - 0.13, zc), v(0.012, 0.22, L), shade(wood, 0.7), WOOD);
      }
    }
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

/** Món hàng: hộp thiếc có gờ và nhãn, chai có vai và nắp, cuộn băng, ống, vải gấp, hộp có sọc. */
export function item(mb, item, p, k) {
  const [shape, col, col2] = items.look(item);
  const c = hex(col), c2 = hex(col2);
  mb.push(m4_mul(m4_translate(p), m4_scale(v3(k, k, k))));
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
    mb.lathe(ZERO, [[0.0, -0.2], [0.03, -0.196], [0.03, -0.18], [0.018, -0.16], [0.017, 0.05], [0.03, 0.3], [0.037, 0.48], [0.035, 0.55], [0.0, 0.565]], 12, true, hex(0xa9804a), WOOD);
    for (let k = 0; k < 6; k++) {
      const y = -0.15 + k * 0.035;
      mb.lathe(ZERO, [[0.0195, y], [0.0195, y + 0.028]], 10, false, hex(k % 2 === 0 ? 0x2a2a2a : 0x3a3632), FLAT);
    }
    mb.lathe(ZERO, [[0.0375, 0.4], [0.0375, 0.43]], 12, false, hex(0x8a1c18), FLAT);
  } else {
    mb.lathe(ZERO, [[0.0, -0.2], [0.021, -0.196], [0.022, -0.06], [0.016, 0.0], [0.015, 0.21], [0.0, 0.215]], 10, true, hex(0x8a6a3e), WOOD);
    for (let k = 0; k < 4; k++) {
      const y = -0.185 + k * 0.032;
      mb.lathe(ZERO, [[0.0235, y], [0.0235, y + 0.024]], 10, false, hex(0x26221e), FLAT);
    }
    const old = mb.bevel;
    mb.bevel = 0.008;
    mb.cube(v(0.0, 0.245, 0.005), v(0.046, 0.06, 0.1), hex(0x70757a), METAL);
    mb.bevel = old;
    mb.tube(v(0.0, 0.245, -0.045), v(0.0, 0.245, -0.085), 0.027, 0.031, 10, hex(0x8a9096), METAL);
    mb.lathe(ZERO, [[0.02, 0.2], [0.024, 0.205], [0.02, 0.215]], 8, false, hex(0x55595d), METAL);
    for (const sx of [-1.0, 1.0]) {
      mb.push(m4_mul(m4_translate(v(sx * 0.013, 0.25, 0.085)), m4_rot_x(-0.5)));
      mb.cube(ZERO, v(0.014, 0.03, 0.08), hex(0x70757a), METAL);
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
      mb.lathe(ZERO, [[0.0, -0.08], [0.04, -0.08], [0.042, 0.05], [0.018, 0.1], [0.018, 0.15], [0.0, 0.15]], 8, true, hex(0x5a3414), GLASS);
      mb.cube(v(0.0, 0.18, 0.0), v(0.02, 0.07, 0.02), hex(0xd8c27a), CARDBOARD);
    } else if (has('bone')) {
      mb.capsule(v(0.0, -0.1, 0.0), v(0.0, 0.14, 0.0), 0.02, 0.02, 6, hex(0xe6e2d6), FLAT);
      mb.ball(v(0.0, 0.15, 0.0), v(0.035, 0.03, 0.03), 6, hex(0xe6e2d6), FLAT);
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
  const short = has('knife') || has('dagger') || has('wrench') || has('detonator') || has('stick');
  const top = short ? 0.22 : has('spear') ? 0.85 : 0.5;
  const metal_shaft = has('pipe') || has('rebar') || has('wrench') || has('crowbar');
  mb.lathe(ZERO, [[0.0, -0.2], [0.02, -0.196], [0.02, -0.05], [0.016, top * 0.6], [0.014, top], [0.0, top + 0.005]], 8, true, hex(col2), metal_shaft ? METAL : WOOD);
  if (has('chainsaw')) {
    mb.cube(v(0.0, top * 0.2, 0.0), v(0.09, 0.2, 0.12), hex(0xb0452a), METAL);
    mb.cube(v(0.0, top + 0.1, 0.0), v(0.02, 0.5, 0.07), steel, METAL);
  } else if (has('axe')) {
    mb.cube(v(0.0, top - 0.06, 0.07), v(0.03, 0.14, 0.16), steel, METAL);
  } else if (has('knife') || has('dagger') || has('blade') || has('spear')) {
    mb.cube(v(0.0, top + 0.07, 0.0), v(0.012, 0.2, 0.05), has('bone') ? hex(0xe6e2d6) : steel, METAL);
  } else if (has('spik') || has('nail')) {
    for (let k = 0; k < 6; k++) {
      const a = k * 1.05;
      mb.cube(v(Math.cos(a) * 0.035, top - 0.04 - k * 0.035, Math.sin(a) * 0.035), v(0.012, 0.012, 0.05), steel, METAL);
    }
  } else if (has('saw')) {
    mb.cyl(v(0.0, top - 0.02, 0.0), 0.11, 0.11, 0.012, 12, steel, METAL);
  } else if (has('crowbar')) {
    mb.cube(v(0.0, top, 0.03), v(0.018, 0.03, 0.08), hex(col), METAL);
  } else if (has('stun')) {
    mb.emi = 0.9;
    mb.cube(v(0.0, top + 0.02, 0.0), v(0.03, 0.05, 0.03), hex(0x6ad0ff), FLAT);
    mb.emi = 0.0;
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
export function placed(mb, item) {
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
    mb.cube(v(0.0, 0.12, 0.0), v(2.2, 0.16, 0.5), wood, WOOD);
    for (let k = 0; k < 7; k++) {
      const x = -0.9 + k * 0.3;
      for (const [dz, lean] of [[0.12, 0.55], [-0.12, -0.55]]) {
        mb.push(m4_mul(m4_translate(v(x, 0.2, dz)), m4_rot_x(lean)));
        mb.lathe(ZERO, [[0.03, 0.0], [0.025, 0.7], [0.0, 0.95]], 6, false, shade(wood, 1.2), WOOD);
        mb.pop();
      }
    }
  } else if (item === game.BEAR_TRAP) {
    mb.cyl(v(0.0, 0.0, 0.0), 0.3, 0.3, 0.03, 12, dark, METAL);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10.0) * TAU;
      mb.lathe(v(Math.cos(a) * 0.27, 0.03, Math.sin(a) * 0.27), [[0.02, 0.0], [0.0, 0.12]], 4, false, steel, METAL);
    }
    mb.cube(v(0.0, 0.04, 0.0), v(0.14, 0.02, 0.14), hex(0x8a3a2a), METAL);
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
    mb.cube(v(0.0, 0.35, 0.0), v(0.7, 0.7, 0.4), wood, WOOD);
    mb.cube(v(0.0, 1.0, 0.0), v(0.8, 0.55, 0.12), dark, METAL);
    mb.emi = 0.7;
    mb.cube(v(0.0, 1.0, 0.065), v(0.7, 0.45, 0.01), hex(0x6a9ac8), FLAT);
    mb.emi = 0.0;
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

/// Cách nhìn của từng mệnh giá pin (1/5/10/50/100/1000, GeneratePayment): màu vỏ, bán kính, chiều cao. Pin nhỏ là pin
/// tiểu bạc, lớn dần tới khối pin vàng to; màu khác hẳn nhau để đọc được trên quầy, trong ngăn kéo và trong máy soi.
export const BATTERY_LOOK = {
  1: { col: 0xb8bec6, r: 0.016, h: 0.06 },
  5: { col: 0x3a6fe0, r: 0.019, h: 0.07 },
  10: { col: 0xf0d020, r: 0.022, h: 0.08 },
  50: { col: 0xf07a20, r: 0.026, h: 0.09 },
  100: { col: 0x9a4fd0, r: 0.03, h: 0.1 },
  1000: { col: 0xf2c94a, r: 0.04, h: 0.11 },
};
export function battery_look(value) {
  return BATTERY_LOOK[value] || BATTERY_LOOK[value >= 1000 ? 1000 : value >= 100 ? 100 : value >= 50 ? 50 : value >= 10 ? 10 : value >= 5 ? 5 : 1];
}
