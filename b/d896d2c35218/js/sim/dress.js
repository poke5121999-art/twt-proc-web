// Port of src/dress.rs.
//! Bộ đồ bày cảnh theo bộ dựng của Saltline (`Yi` bảng kích thước, `Hk` thùng phuy, `Ok` pallet, `eP` bao cát, `Pk`
//! container; improved-game.js, xem docs/saltline-map.md mục f). Kích thước và cách dựng chép theo Saltline
//! (thùng phuy 0,6 x 0,9 m có gân, pallet 1,2 x 0,144 x 1,0 m ván mòn theo hạt giống, rào jersey 3 x 0,81 x 0,6 m, bao cát
//! xếp lớp, container 20 ft 6,06 x 2,59 x 2,44 m tôn sóng có then cửa); viết lại bằng bộ dựng MB của twt-proc.
//! Chỉ để nhìn: đặt ngoài rào bãi và dọc mép, không thêm vật cản (bot và người chơi đi lại như cũ).

import { v3, v2, ZERO, Rng } from './vec.js';
import { hex, m4_mul, m4_translate, m4_rot_y, m4_rot_z, METAL, WOOD, CONCRETE, STRIPES, CARDBOARD, CORRUGATED } from './geom.js';

export const PAL_RED = 0x7d2219;
export const PAL_BLUE = 0x1f3f66;
export const PAL_GREEN = 0x2c5a44;
export const PAL_ORANGE = 0xb3521a;

/** Thùng phuy 200 lít: thân tiện có hai gân lăn và mép nắp, nắp có hai lỗ nút. */
export function barrel(mb, p, col, lying, yaw) {
  mb.push_at(p, yaw);
  if (lying) {
    mb.push(m4_mul(m4_mul(m4_translate(v3(0.0, 0.3, 0.0)), m4_rot_z(Math.PI / 2)), m4_translate(v3(0.0, -0.45, 0.0))));
  }
  const r = 0.29;
  const prof = [[0.0, 0.0], [r - 0.012, 0.0], [r, 0.012], [r + 0.006, 0.02], [r, 0.03], [r, 0.28], [r + 0.012, 0.3], [r, 0.32], [r, 0.58], [r + 0.012, 0.6], [r, 0.62], [r, 0.87], [r + 0.006, 0.88], [r - 0.004, 0.9], [r - 0.02, 0.9], [r - 0.02, 0.885], [0.0, 0.885]];
  mb.lathe(ZERO, prof, 16, true, hex(col), METAL);
  mb.cyl(v3(0.12, 0.885, 0.05), 0.026, 0.026, 0.012, 8, hex(0x2a2c2e), METAL);
  mb.cyl(v3(-0.15, 0.885, -0.02), 0.016, 0.016, 0.01, 8, hex(0x2a2c2e), METAL);
  if (lying) {
    mb.pop();
  }
  mb.pop();
}

/** Pallet gỗ 1,2 x 0,144 x 1,0 m: 5 ván mặt, 3 thanh ngang, 9 khối chân, 3 ván đáy; mỗi ván lệch tông và mòn theo hạt giống. */
export function pallet(mb, p, yaw, r) {
  mb.push_at(p, yaw);
  // Rust `[f32;3].map(..)` gọi closure cho từng thành phần: 3 lần r.range theo thứ tự r, g, b.
  const tone = (r) => hex(0x8a6e4a).map((c) => c * r.range(0.7, 1.05));
  for (let i = 0; i < 5; i++) {
    const z = -0.45 + i * 0.225;
    // Thứ tự gọi rng như Rust: tham số vị trí (r.range) trước, rồi tone(r).
    const x = r.range(-0.01, 0.01);
    mb.cube(v3(x, 0.133, z), v3(1.2, 0.022, 0.1), tone(r), WOOD);
  }
  // [SUA] xa ngang chay vuong goc voi van mat (truoc day song song nen van mat va xa ho nhau 1 cm, hai van giua khong co gi do).
  for (const z of [-0.45, 0.0, 0.45]) {
    mb.cube(v3(z * (0.55 / 0.45), 0.111, 0.0), v3(0.1, 0.022, 1.0), tone(r), WOOD);
    for (const x of [-0.55, 0.0, 0.55]) {
      mb.cube(v3(x, 0.061, z), v3(0.1, 0.078, 0.1), tone(r), WOOD);
    }
  }
  for (const x of [-0.55, 0.0, 0.55]) {
    mb.cube(v3(x, 0.011, 0.0), v3(0.1, 0.022, 1.0), tone(r), WOOD);
  }
  mb.pop();
}

/** Rào bê tông jersey 3 x 0,81 x 0,6 m: tiết diện chân loe, vai gãy, đỉnh hẹp; có rãnh nâng ở chân. */
export function jersey(mb, p, yaw, stripe) {
  mb.push_at(p, yaw);
  mb.push(m4_rot_y(Math.PI / 2));
  const prof = [v2(-0.3, 0.0), v2(0.3, 0.0), v2(0.3, 0.075), v2(0.2, 0.33), v2(0.08, 0.81), v2(-0.08, 0.81), v2(-0.2, 0.33), v2(-0.3, 0.075)];
  mb.extrude(prof, -1.5, -0.95, hex(0x9a968c), CONCRETE);
  mb.extrude(prof, 0.95, 1.5, hex(0x9a968c), CONCRETE);
  mb.extrude(prof, -0.95, 0.95, hex(0x9a968c), CONCRETE);
  if (stripe) {
    for (let k = 0; k < 3; k++) {
      const z = -0.9 + k * 0.9;
      mb.extrude([v2(-0.215, 0.36), v2(0.215, 0.36), v2(0.185, 0.48), v2(-0.185, 0.48)], z - 0.2, z + 0.2, hex(0xb98a1c), STRIPES);
    }
  }
  mb.pop();
  mb.pop();
}

/** Bao cát: túi phồng (bóng dẹt) xếp so le, mỗi lớp lệch nửa bao. */
export function sandbags(mb, p, yaw, len, rows, r) {
  mb.push_at(p, yaw);
  for (let row = 0; row < rows; row++) {
    const off = row % 2 === 0 ? 0.0 : 0.25;
    const n = Math.max(0, len - (row % 2));
    for (let i = 0; i < n; i++) {
      const x = -len * 0.25 + i * 0.5 + off + 0.25;
      const c = hex(0x8a7d5c).map((v) => v * r.range(0.8, 1.05));
      const px = x + r.range(-0.02, 0.02);
      const py = 0.07 + row * 0.13;
      const pz = r.range(-0.02, 0.02);
      mb.ball(v3(px, py, pz), v3(0.27, 0.085, 0.19), 10, c, CARDBOARD);
    }
  }
  mb.pop();
}

/** Container 20 ft (6,06 x 2,59 x 2,44 m): vách tôn sóng (hoa văn CORRUGATED), khung góc, cửa hai cánh với 4 then dọc. */
export function container(mb, p, yaw, col, r) {
  mb.push_at(p, yaw);
  const l = 6.06, h = 2.59, w = 2.44;
  const c = hex(col).map((v) => v * r.range(0.85, 1.05));
  mb.cube(v3(0.0, h * 0.5, 0.0), v3(l - 0.16, h - 0.16, w - 0.04), c, CORRUGATED);
  const frame = c.map((v) => v * 0.7);
  for (const x of [-l * 0.5 + 0.08, l * 0.5 - 0.08]) {
    for (const z of [-w * 0.5 + 0.08, w * 0.5 - 0.08]) {
      mb.cube(v3(x, h * 0.5, z), v3(0.16, h, 0.16), frame, METAL);
    }
    mb.cube(v3(x, h - 0.08, 0.0), v3(0.16, 0.16, w), frame, METAL);
    mb.cube(v3(x, 0.08, 0.0), v3(0.16, 0.16, w), frame, METAL);
  }
  for (const z of [-w * 0.5 + 0.08, w * 0.5 - 0.08]) {
    mb.cube(v3(0.0, h - 0.08, z), v3(l, 0.16, 0.16), frame, METAL);
    mb.cube(v3(0.0, 0.08, z), v3(l, 0.16, 0.16), frame, METAL);
  }
  const xd = l * 0.5 + 0.005;
  // [SUA] canh cua phang voi khung dau (truoc day then cua dung cach vach ton 9 cm, khong cham gi).
  mb.cube(v3(l * 0.5 - 0.03, h * 0.5, 0.0), v3(0.06, h - 0.3, w - 0.3), c, CORRUGATED);
  for (let k = 0; k < 4; k++) {
    const z = -0.85 + k * 0.567;
    mb.cyl(v3(xd + 0.01, 0.2, z), 0.022, 0.022, h - 0.4, 6, hex(0x5a5c5e), METAL);
    mb.cube(v3(xd + 0.015, 1.1, z + 0.06), v3(0.04, 0.12, 0.1), hex(0x3a3c3e), METAL);
  }
  mb.cube(v3(xd, h * 0.5, 0.0), v3(0.02, h - 0.3, 0.03), frame, METAL);
  mb.pop();
}

/** Đặt bộ đồ bày dọc mép bãi: ngoài rào tây và đông, sau bãi đỗ, cạnh skip. Toạ độ thế giới của twt-proc. */
export function dressing(mb) {
  const r = Rng.named('dress');
  // Ngoài rào tây: hai container chồng + một container lệch, thùng phuy, pallet.
  container(mb, v3(-31.0, 0.0, 20.0), 1.57, PAL_RED, r);
  container(mb, v3(-31.0, 2.59, 20.4), 1.6, PAL_BLUE, r);
  container(mb, v3(-34.2, 0.0, 27.5), 1.4, PAL_GREEN, r);
  container(mb, v3(37.0, 0.0, 24.0), 1.57, PAL_ORANGE, r);
  container(mb, v3(37.4, 0.0, 15.0), 1.52, PAL_BLUE, r);
  const spots = [[-27.0, 13.0], [-27.6, 13.7], [-26.6, 14.3], [-28.2, 31.5], [33.4, 30.5], [34.0, 31.2], [-27.5, 26.0]];
  spots.forEach(([x, z], i) => {
    const col = [0x2c5a44, 0x1f3f66, 0x7d2219, 0x5a6068, 0xb98a1c][i % 5];
    barrel(mb, v3(x, 0.0, z), col, i === 6, r.range(0.0, 6.28));
  });
  for (const [x, z, n] of [[-27.0, 8.0, 3], [33.0, 9.0, 2], [-28.5, 34.0, 4]]) {
    const yaw = r.range(-0.3, 0.3);
    for (let k = 0; k < n; k++) {
      const px = x + r.range(-0.04, 0.04);
      const y = yaw + r.range(-0.05, 0.05);
      pallet(mb, v3(px, k * 0.144, z), y, r);
    }
  }
  // Rào jersey và bao cát chặn hai đầu đường phía tây / đông.
  for (let k = 0; k < 4; k++) {
    jersey(mb, v3(-44.0 + k * 3.05, 0.0, 44.0), 0.0, k % 2 === 0);
    jersey(mb, v3(46.0 + k * 3.05, 0.0, 44.0), 0.0, k % 2 === 1);
  }
  sandbags(mb, v3(-30.0, 0.0, 38.5), 0.0, 8, 4, r);
  sandbags(mb, v3(36.0, 0.0, 38.5), 0.0, 6, 3, r);
}

/* VIEW NOTES (dress.js)
 * Mesh code is ported: world.js calls dress.dressing(mb) while building the static world mesh (solid material).
 * Contents, world coordinates (metres): 5 shipping containers 6.06 x 2.59 x 2.44 (red 0x7d2219, blue 0x1f3f66, green
 * 0x2c5a44, orange 0xb3521a; tint x0.85..1.05 per channel, frame x0.7) west (x -31..-34) and east (x 37) of the lot,
 * 7 oil drums r 0.29 h 0.9 (one lying), 3 pallet stacks (3, 2, 4 high, 0.144 each), 8 jersey barriers 3 x 0.81 x 0.6
 * (concrete 0x9a968c, alternate ones with three amber 0xb98a1c stripes) across both road ends at z 44, two sandbag
 * walls (8 x 4 and 6 x 3 bags, 0x8a7d5c) at z 38.5. Static, no state drives it, no collision.
 * Rust argument evaluation order of the rng draws is kept (positions before tone colours), so the layout matches.
 * PORT GAPS: none.
 */
