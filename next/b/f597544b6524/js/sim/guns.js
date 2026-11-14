// Port of src/guns.rs.
//! Model súng dựng bằng code, mỗi khẩu có đủ bộ phận thật (hộp khoá nòng, nòng, băng đạn, báng, thước ngắm, ốp tay, ống
//! ngắm...) theo đúng cỡ (mét). Trục súng là +x riêng (đầu nòng ở `Spec::muzzle`), +y lên, +z sang phải người cầm; gốc toạ
//! độ ở chỗ tay cò. `spec` cho biết lớp súng, chỗ đặt hai tay, cửa hất vỏ đạn, độ giật và kiểu nạp để `fp.rs` dựng tay và
//! diễn hoạt cảnh; `model` dựng thân súng, `off_part` dựng phần đi theo tay trái (băng đạn rời, ốp bơm của shotgun).

import { Vec2, v3, Y, ZERO } from './vec.js';
import * as geom from './geom.js';
import { hex } from './geom.js';
import * as items from './items.js';

/** enum Class (unit variants -> strings). */
export const CLASS_ORDER = ['Pistol', 'Revolver', 'Smg', 'Shotgun', 'Rifle', 'Sniper', 'Minigun', 'Launcher', 'Bow', 'Crossbow', 'Flame', 'Saw', 'Nail'];
/** Kiểu nạp đạn (quyết định hoạt cảnh): thay băng, bơm, kéo khoá nòng, nhét từng viên / quả, kéo dây. */
export const RELOAD_ORDER = ['Mag', 'Pump', 'Bolt', 'Single', 'Draw'];

/**
 * struct Spec:
 *   class: Class string; muzzle: Vec3;
 *   grip / fore: Vec3 — tay cò (phải) và tay đỡ (trái) nắm ở đâu;
 *   eject: Vec3 | null — cửa hất vỏ (null: không văng vỏ);
 *   kick: [lùi (m), ngóc nòng (rad), lệch ngang (rad), nghiêng (rad)]; view: góc nhìn ngóc (rad);
 *   reload: Reload string; hold: Vec3 — chỗ đặt súng trong khung nhìn (so với mắt): phải, lên, trước;
 *   speed: vận tốc đầu đạn nhìn thấy (m/s).
 */

// `class` is a reserved word for declarations; exported under the Rust name (`guns.class(item)`).
function class_(item) {
  const name = items.iname(item).toLowerCase();
  const has = (k) => name.includes(k);
  const wg = items.gun(item);
  if (wg === null) return 'Pistol';
  const [w, gd] = wg;
  if (has('revolver')) {
    return 'Revolver';
  } else if (has('crossbow')) {
    return 'Crossbow';
  } else if (has('bow')) {
    return 'Bow';
  } else if (has('flame')) {
    return 'Flame';
  } else if (has('minigun')) {
    return 'Minigun';
  } else if (has('nail')) {
    return 'Nail';
  } else if (has('saw')) {
    return 'Saw';
  } else if (has('missile') || has('launcher') || gd.ammo === 78) {
    return 'Launcher';
  } else if (has('shotgun') || gd.pellets > 1) {
    return 'Shotgun';
  } else if (has('sniper') || w.range >= 30.0) {
    return 'Sniper';
  } else if (has('uzi') || (gd.clip >= 20 && w.range <= 10.0)) {
    return 'Smg';
  } else if (gd.clip >= 20) {
    return 'Rifle';
  } else {
    return 'Pistol';
  }
}
export { class_ as class };

export function spec(item) {
  const c = class_(item);
  const s = (muzzle, fore, eject, kick, view, reload, hold, speed) => ({ class: c, muzzle: v3(muzzle, 0.045, 0.0), grip: v3(-0.012, -0.045, 0.0), fore, eject, kick, view, reload, hold, speed });
  switch (c) {
    case 'Pistol': return s(0.19, v(-0.004, -0.085, -0.012), v(0.06, 0.06, 0.02), [0.05, 0.16, 0.02, 0.05], 0.022, 'Mag', v(0.17, -0.17, -0.5), 190.0);
    case 'Revolver': return s(0.23, v(-0.004, -0.09, -0.012), null, [0.07, 0.3, 0.03, 0.08], 0.045, 'Single', v(0.17, -0.17, -0.5), 190.0);
    case 'Smg': return s(0.3, v(0.14, -0.02, -0.01), v(0.07, 0.055, 0.025), [0.025, 0.05, 0.02, 0.03], 0.01, 'Mag', v(0.17, -0.18, -0.46), 190.0);
    case 'Shotgun': return s(0.74, v(0.36, -0.012, -0.004), v(0.1, 0.045, 0.03), [0.11, 0.3, 0.03, 0.06], 0.06, 'Pump', v(0.16, -0.19, -0.36), 150.0);
    case 'Rifle': return s(0.66, v(0.3, -0.008, -0.004), v(0.08, 0.05, 0.03), [0.035, 0.07, 0.025, 0.035], 0.014, 'Mag', v(0.16, -0.19, -0.38), 220.0);
    case 'Sniper': return s(0.86, v(0.36, -0.01, -0.004), v(0.06, 0.05, 0.03), [0.12, 0.26, 0.02, 0.05], 0.075, 'Bolt', v(0.15, -0.19, -0.34), 320.0);
    case 'Minigun': return s(0.72, v(0.22, 0.13, -0.004), v(0.1, -0.02, 0.07), [0.012, 0.012, 0.012, 0.02], 0.004, 'Mag', v(0.2, -0.3, -0.38), 220.0);
    case 'Launcher': return s(0.62, v(0.3, -0.03, -0.004), null, [0.1, 0.12, 0.02, 0.09], 0.05, 'Single', v(0.24, -0.1, -0.2), 38.0);
    case 'Bow': return s(0.12, v(0.14, 0.0, 0.0), null, [0.02, 0.03, 0.01, 0.02], 0.006, 'Draw', v(0.1, -0.12, -0.5), 60.0);
    case 'Crossbow': return s(0.52, v(0.26, -0.012, -0.004), null, [0.04, 0.08, 0.01, 0.03], 0.016, 'Draw', v(0.16, -0.19, -0.4), 70.0);
    case 'Flame': return s(0.62, v(0.3, -0.02, -0.004), null, [0.004, 0.004, 0.006, 0.01], 0.0, 'Mag', v(0.18, -0.24, -0.38), 20.0);
    case 'Saw': return s(0.5, v(0.26, -0.02, -0.004), null, [0.09, 0.14, 0.02, 0.06], 0.03, 'Single', v(0.17, -0.2, -0.4), 45.0);
    case 'Nail': return s(0.24, v(0.02, -0.095, -0.012), null, [0.03, 0.07, 0.01, 0.03], 0.01, 'Mag', v(0.17, -0.17, -0.48), 120.0);
  }
}

const STEEL = 0x8a9096;
const DARK = 0x24272a;
const GUN = 0x33383d;
const WOODC = 0x6d4e2a;
const POLY = 0x2a2c2a;

function v(x, y, z) {
  return v3(x, y, z);
}

/** Tấm biên dạng trong mặt phẳng xy, dày `w` theo z (báng, tay cầm, hộp khoá nòng vát). */
function plate(mb, pts, w, col, pat) {
  const poly = pts.map((p) => new Vec2(p[0], p[1]));
  mb.extrude(poly, -w * 0.5, w * 0.5, hex(col), pat);
}

function bx(mb, c, s, col, pat) {
  mb.cube(c, s, hex(col), pat);
}

function tube(mb, x0, x1, y, z, r, col) {
  mb.tube(v(x0, y, z), v(x1, y, z), r, r, 10, hex(col), geom.METAL);
}

function trigger(mb, x) {
  // Vành cò + cò.
  mb.sweep([v(x - 0.03, 0.005, 0.0), v(x - 0.032, -0.022, 0.0), v(x - 0.01, -0.034, 0.0), v(x + 0.02, -0.03, 0.0), v(x + 0.032, 0.005, 0.0)], 0.0035, 5, hex(DARK), geom.METAL);
  mb.sweep([v(x, 0.004, 0.0), v(x - 0.004, -0.012, 0.0), v(x + 0.003, -0.024, 0.0)], 0.003, 4, hex(STEEL), geom.METAL);
}

function pistol_grip(mb, x, col, pat, w) {
  plate(mb, [[x - 0.022, 0.012], [x + 0.02, 0.012], [x + 0.004, -0.1], [x - 0.04, -0.094]], w, col, pat);
}

function sights(mb, rear, front, y) {
  bx(mb, v(front, y + 0.01, 0.0), v(0.006, 0.02, 0.004), DARK, geom.METAL);
  for (const sz of [-1.0, 1.0]) {
    bx(mb, v(rear, y + 0.008, sz * 0.006), v(0.008, 0.016, 0.004), DARK, geom.METAL);
  }
}

function stock(mb, x, col, pat, w) {
  // Báng: cổ báng từ sau hộp khoá nòng, đế báng có đệm.
  plate(mb, [[x, 0.03], [x - 0.1, 0.022], [x - 0.3, 0.012], [x - 0.3, -0.105], [x - 0.27, -0.11], [x - 0.1, -0.03], [x, -0.012]], w, col, pat);
  bx(mb, v(x - 0.305, -0.046, 0.0), v(0.014, 0.125, w + 0.004), DARK, geom.FLAT);
}

/** Băng đạn rời: hộp cong / thẳng treo dưới thân (gốc ở miệng băng). */
export function magazine(mb, at, len, curve, w, col) {
  const n = 4;
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    mb.push(geom.m4_mul(geom.m4_translate(at.add(v(curve * t * t * len, -t * len, 0.0))), geom.m4_rot_z(-curve * t * 1.6)));
    mb.bevel = 0.003;
    mb.cube(ZERO, v(0.038, (len / n) * 1.12, w), hex(col), geom.METAL);
    mb.bevel = 0.0025;
    mb.pop();
  }
}

/** Chỗ gắn băng đạn (null: súng không có băng rời). Returns [at, len, curve, w, col]. */
export function mag_at(item) {
  switch (class_(item)) {
    case 'Pistol': return [v(-0.016, -0.02, 0.0), 0.095, -0.1, 0.02, DARK];
    case 'Smg': return [v(-0.014, -0.03, 0.0), 0.19, -0.08, 0.022, DARK];
    case 'Rifle': return [v(0.085, -0.03, 0.0), 0.17, 0.55, 0.024, 0x3a3d40];
    case 'Sniper': return [v(0.07, -0.028, 0.0), 0.06, 0.0, 0.026, DARK];
    case 'Nail': return [v(0.06, -0.03, 0.0), 0.13, 0.5, 0.03, 0xc2a23a];
    default: return null;
  }
}

/** Phần đi theo tay trái: băng đạn rời hoặc ốp bơm của shotgun. */
export function off_part(mb, item) {
  const m = mag_at(item);
  if (m !== null) {
    const [at, len, curve, w, col] = m;
    magazine(mb, at, len, curve, w, col);
  }
  if (class_(item) === 'Shotgun') {
    // Ốp bơm bằng gỗ có khía.
    mb.tube(v(0.28, -0.012, 0.0), v(0.45, -0.012, 0.0), 0.027, 0.027, 10, hex(WOODC), geom.WOOD);
    for (let k = 0; k < 6; k++) {
      const x = 0.295 + k * 0.027;
      mb.tube(v(x, -0.012, 0.0), v(x + 0.008, -0.012, 0.0), 0.0285, 0.0285, 10, hex(0x4a3418), geom.WOOD);
    }
  }
}

/** Thân súng (không gồm phần `off_part`). */
export function model(mb, item) {
  const { METAL, FLAT, WOOD, GLASS } = geom;
  const [, col, col2] = items.look(item);
  void col;
  const cl = class_(item);
  const wood = (cl === 'Rifle' || cl === 'Shotgun' || cl === 'Sniper' || cl === 'Revolver' || cl === 'Crossbow' || cl === 'Bow') ? WOODC : POLY;
  const wp = wood === WOODC ? WOOD : FLAT;
  const old = mb.bevel;
  // Mọi khối của súng đều vát cạnh (cạnh vát sáng hơn = mòn cạnh); từng phần đặt bề rộng riêng.
  mb.bevel = 0.0025;
  switch (cl) {
    case 'Pistol': {
      mb.bevel = 0.004;
      bx(mb, v(0.085, 0.045, 0.0), v(0.2, 0.032, 0.026), GUN, METAL); // khối trượt
      mb.bevel = 0.002;
      bx(mb, v(0.07, 0.02, 0.0), v(0.15, 0.02, 0.024), DARK, METAL); // khung
      bx(mb, v(0.08, 0.057, 0.0135), v(0.045, 0.012, 0.002), 0x101214, FLAT); // cửa hất vỏ
      for (let k = 0; k < 5; k++) {
        bx(mb, v(-0.006 + k * 0.007, 0.045, 0.0), v(0.003, 0.03, 0.0275), DARK, METAL); // khía khối trượt
      }
      tube(mb, 0.17, 0.192, 0.047, 0.0, 0.007, STEEL);
      pistol_grip(mb, -0.004, POLY, FLAT, 0.025);
      trigger(mb, 0.04);
      sights(mb, -0.005, 0.17, 0.06);
      bx(mb, v(-0.022, 0.05, 0.0), v(0.014, 0.014, 0.01), DARK, METAL); // búa
      break;
    }
    case 'Revolver': {
      tube(mb, 0.07, 0.23, 0.047, 0.0, 0.0085, 0xd8d2c0);
      bx(mb, v(0.15, 0.033, 0.0), v(0.14, 0.012, 0.012), 0xcfc8b0, FLAT); // gân dưới nòng
      mb.tube(v(0.02, 0.04, 0.0), v(0.07, 0.04, 0.0), 0.024, 0.024, 12, hex(0xe6e2d6), FLAT); // ổ xoay bằng xương
      for (let k = 0; k < 6; k++) {
        const a = k * 1.047;
        mb.tube(v(0.0195, 0.04 + Math.sin(a) * 0.015, Math.cos(a) * 0.015), v(0.0705, 0.04 + Math.sin(a) * 0.015, Math.cos(a) * 0.015), 0.0055, 0.0055, 6, hex(0x3a3028), METAL);
      }
      mb.bevel = 0.003;
      bx(mb, v(0.03, 0.036, 0.0), v(0.11, 0.058, 0.016), 0xbdb49a, FLAT); // khung
      mb.bevel = 0.0025;
      plate(mb, [[-0.02, 0.02], [0.012, 0.02], [0.0, -0.05], [-0.03, -0.1], [-0.062, -0.09], [-0.04, -0.04]], 0.026, wood, wp);
      trigger(mb, 0.03);
      bx(mb, v(-0.028, 0.07, 0.0), v(0.02, 0.014, 0.008), DARK, METAL);
      sights(mb, -0.012, 0.22, 0.058);
      break;
    }
    case 'Smg': {
      mb.bevel = 0.004;
      bx(mb, v(0.07, 0.04, 0.0), v(0.24, 0.05, 0.034), GUN, METAL);
      mb.bevel = 0.0025;
      tube(mb, 0.19, 0.3, 0.045, 0.0, 0.009, STEEL);
      tube(mb, 0.19, 0.215, 0.045, 0.0, 0.016, DARK);
      bx(mb, v(0.07, 0.068, 0.0), v(0.03, 0.012, 0.014), DARK, METAL); // tay kéo khoá nòng
      pistol_grip(mb, -0.004, POLY, FLAT, 0.03);
      trigger(mb, 0.04);
      sights(mb, -0.03, 0.17, 0.066);
      // Báng gập bằng thép.
      mb.sweep([v(-0.05, 0.05, 0.012), v(-0.2, 0.05, 0.012), v(-0.22, 0.0, 0.0), v(-0.2, -0.04, -0.012), v(-0.2, 0.05, -0.012), v(-0.05, 0.05, -0.012)], 0.004, 5, hex(STEEL), METAL);
      break;
    }
    case 'Shotgun': {
      tube(mb, 0.1, 0.74, 0.045, 0.0, 0.0125, DARK); // nòng
      tube(mb, 0.1, 0.56, 0.014, 0.0, 0.0115, GUN); // ống đạn
      bx(mb, v(0.56, 0.03, 0.0), v(0.014, 0.05, 0.012), DARK, METAL); // đai nòng
      mb.bevel = 0.005;
      bx(mb, v(0.04, 0.03, 0.0), v(0.2, 0.06, 0.036), GUN, METAL); // hộp khoá nòng
      mb.bevel = 0.0025;
      bx(mb, v(0.07, 0.036, 0.0185), v(0.07, 0.02, 0.002), 0x101214, FLAT);
      trigger(mb, 0.02);
      plate(mb, [[-0.06, 0.05], [-0.06, 0.0], [-0.11, -0.03], [-0.14, -0.012], [-0.13, 0.04]], 0.032, wood, wp); // cổ báng
      stock(mb, -0.1, wood, wp, 0.034);
      bx(mb, v(0.735, 0.062, 0.0), v(0.006, 0.008, 0.006), 0xd8c27a, METAL); // đầu ruồi
      break;
    }
    case 'Rifle': {
      mb.bevel = 0.004;
      bx(mb, v(0.07, 0.035, 0.0), v(0.26, 0.055, 0.034), GUN, METAL); // hộp khoá nòng
      mb.bevel = 0.0025;
      bx(mb, v(0.07, 0.066, 0.0), v(0.24, 0.012, 0.03), DARK, METAL); // nắp hộp
      bx(mb, v(0.09, 0.045, 0.018), v(0.06, 0.014, 0.004), 0x101214, FLAT); // cửa hất vỏ
      bx(mb, v(0.13, 0.05, 0.022), v(0.012, 0.008, 0.016), STEEL, METAL); // tay kéo
      tube(mb, 0.2, 0.66, 0.045, 0.0, 0.0085, DARK); // nòng
      tube(mb, 0.2, 0.48, 0.068, 0.0, 0.0065, GUN); // ống trích khí
      bx(mb, v(0.48, 0.057, 0.0), v(0.02, 0.04, 0.016), DARK, METAL); // khối trích khí
      mb.tube(v(0.2, 0.04, 0.0), v(0.4, 0.04, 0.0), 0.024, 0.021, 10, hex(wood), wp); // ốp lót tay
      mb.tube(v(0.21, 0.07, 0.0), v(0.39, 0.07, 0.0), 0.014, 0.013, 8, hex(wood), wp);
      bx(mb, v(0.6, 0.07, 0.0), v(0.012, 0.05, 0.01), DARK, METAL); // đầu ruồi
      for (const sz of [-1.0, 1.0]) {
        bx(mb, v(0.6, 0.085, sz * 0.009), v(0.012, 0.03, 0.003), DARK, METAL);
      }
      tube(mb, 0.63, 0.67, 0.045, 0.0, 0.011, DARK); // loa che lửa
      bx(mb, v(0.17, 0.082, 0.0), v(0.05, 0.016, 0.014), DARK, METAL); // thước ngắm
      pistol_grip(mb, -0.004, wood, wp, 0.028);
      trigger(mb, 0.04);
      stock(mb, -0.06, wood, wp, 0.03);
      break;
    }
    case 'Sniper': {
      mb.bevel = 0.004;
      bx(mb, v(0.07, 0.035, 0.0), v(0.26, 0.046, 0.034), GUN, METAL);
      mb.bevel = 0.0025;
      tube(mb, 0.2, 0.86, 0.045, 0.0, 0.0095, DARK);
      tube(mb, 0.8, 0.87, 0.045, 0.0, 0.014, DARK); // hãm nảy
      // Thân gỗ liền báng có má tì.
      plate(mb, [[0.42, 0.03], [0.42, 0.005], [0.1, -0.012], [-0.02, -0.02], [-0.06, -0.1], [-0.1, -0.1], [-0.09, -0.03], [-0.36, -0.1], [-0.36, 0.03], [-0.2, 0.05], [-0.06, 0.03], [-0.04, 0.012]], 0.036, wood, wp);
      bx(mb, v(-0.365, -0.035, 0.0), v(0.014, 0.14, 0.04), DARK, FLAT);
      bx(mb, v(-0.2, 0.06, 0.0), v(0.14, 0.02, 0.03), 0x1c1c1c, FLAT); // má tì
      // Khoá nòng: tay gạt có núm.
      tube(mb, -0.03, 0.03, 0.05, 0.0, 0.01, STEEL);
      mb.tube(v(0.0, 0.05, 0.0), v(0.0, 0.03, 0.045), 0.005, 0.005, 6, hex(STEEL), METAL);
      mb.ball(v(0.0, 0.028, 0.05), v(0.011, 0.011, 0.011), 6, hex(DARK), METAL);
      // Ống ngắm: thân, hai loa, núm chỉnh, hai vòng kẹp.
      tube(mb, 0.0, 0.26, 0.1, 0.0, 0.015, 0x15171a);
      mb.tube(v(0.26, 0.1, 0.0), v(0.33, 0.1, 0.0), 0.016, 0.026, 12, hex(0x15171a), METAL);
      mb.tube(v(-0.05, 0.1, 0.0), v(0.0, 0.1, 0.0), 0.021, 0.016, 12, hex(0x15171a), METAL);
      mb.tube(v(0.329, 0.1, 0.0), v(0.331, 0.1, 0.0), 0.023, 0.023, 12, hex(0x3a6a8a), GLASS);
      mb.tube(v(0.12, 0.1, 0.0), v(0.12, 0.128, 0.0), 0.009, 0.009, 8, hex(DARK), METAL);
      mb.tube(v(0.12, 0.1, 0.0), v(0.12, 0.1, 0.03), 0.009, 0.009, 8, hex(DARK), METAL);
      for (const x of [0.05, 0.2]) {
        bx(mb, v(x, 0.075, 0.0), v(0.016, 0.05, 0.036), DARK, METAL);
      }
      trigger(mb, 0.03);
      // Chân chống gập dưới nòng.
      for (const sz of [-1.0, 1.0]) {
        mb.tube(v(0.4, 0.0, sz * 0.012), v(0.62, -0.004, sz * 0.016), 0.005, 0.005, 6, hex(DARK), METAL);
      }
      break;
    }
    case 'Minigun': {
      // Sáu nòng quanh trục, hai đĩa kẹp, hộp mô tơ, hộp đạn, quai xách, tay cầm sau.
      for (let k = 0; k < 6; k++) {
        const a = k * 1.047;
        tube(mb, 0.2, 0.72, 0.045 + Math.sin(a) * 0.03, Math.cos(a) * 0.03, 0.0095, DARK);
      }
      for (const x of [0.3, 0.52, 0.7]) {
        mb.tube(v(x, 0.045, 0.0), v(x + 0.014, 0.045, 0.0), 0.046, 0.046, 12, hex(GUN), METAL);
      }
      mb.tube(v(-0.02, 0.045, 0.0), v(0.2, 0.045, 0.0), 0.062, 0.058, 12, hex(GUN), METAL);
      mb.bevel = 0.006;
      bx(mb, v(0.08, -0.05, 0.075), v(0.16, 0.13, 0.07), 0x4f5a3a, METAL); // hộp đạn
      mb.bevel = 0.0025;
      mb.sweep([v(0.1, 0.0, 0.05), v(0.11, 0.03, 0.04), v(0.1, 0.05, 0.02)], 0.012, 6, hex(0xb9a44a), METAL); // dây đạn
      mb.sweep([v(0.06, 0.1, 0.0), v(0.08, 0.15, 0.0), v(0.3, 0.15, 0.0), v(0.32, 0.09, 0.0)], 0.009, 6, hex(DARK), METAL); // quai xách
      pistol_grip(mb, -0.02, POLY, FLAT, 0.032);
      trigger(mb, 0.02);
      break;
    }
    case 'Launcher': {
      // Ống phóng: thân, loa trước và sau, đầu đạn ló ra, tay cầm, đệm vai, khối ngắm.
      tube(mb, -0.34, 0.5, 0.06, 0.0, 0.05, 0x4a5a3a);
      mb.tube(v(0.5, 0.06, 0.0), v(0.56, 0.06, 0.0), 0.05, 0.062, 12, hex(0x3a4a2e), METAL);
      mb.tube(v(-0.34, 0.06, 0.0), v(-0.46, 0.06, 0.0), 0.05, 0.075, 12, hex(0x3a4a2e), METAL);
      mb.tube(v(0.5, 0.06, 0.0), v(0.6, 0.06, 0.0), 0.04, 0.03, 10, hex(0x8a8f86), METAL);
      mb.tube(v(0.6, 0.06, 0.0), v(0.66, 0.06, 0.0), 0.03, 0.004, 10, hex(0xb0342a), METAL);
      for (const x of [-0.2, 0.1, 0.38]) {
        mb.tube(v(x, 0.06, 0.0), v(x + 0.02, 0.06, 0.0), 0.054, 0.054, 12, hex(DARK), METAL);
      }
      pistol_grip(mb, -0.004, POLY, FLAT, 0.03);
      trigger(mb, 0.04);
      plate(mb, [[0.26, 0.012], [0.3, 0.012], [0.29, -0.08], [0.26, -0.08]], 0.028, POLY, FLAT); // tay cầm trước
      bx(mb, v(-0.2, 0.0, 0.0), v(0.12, 0.03, 0.06), 0x1c1c1c, FLAT); // đệm vai
      bx(mb, v(0.12, 0.13, -0.03), v(0.07, 0.05, 0.03), DARK, METAL); // khối ngắm
      break;
    }
    case 'Bow': {
      // Thân cung gỗ quấn băng dính, hai cánh cong, dây, mũi tên đặt sẵn. Cung dựng đứng trước tay trái.
      mb.sweep([v(0.1, -0.5, 0.0), v(0.17, -0.32, 0.0), v(0.14, -0.1, 0.0), v(0.13, 0.0, 0.0), v(0.14, 0.1, 0.0), v(0.17, 0.32, 0.0), v(0.1, 0.5, 0.0)], 0.013, 6, hex(WOODC), WOOD);
      mb.tube(v(0.135, -0.07, 0.0), v(0.135, 0.07, 0.0), 0.017, 0.017, 8, hex(0x2a2a2a), FLAT);
      mb.sweep([v(0.1, -0.5, 0.0), v(-0.02, 0.0, 0.0), v(0.1, 0.5, 0.0)], 0.0025, 4, hex(0xd8d2c0), FLAT);
      arrow(mb, v(-0.02, 0.0, 0.0), 0.62);
      break;
    }
    case 'Crossbow': {
      plate(mb, [[0.44, 0.03], [0.44, 0.0], [0.06, -0.012], [-0.02, -0.02], [-0.06, -0.1], [-0.1, -0.1], [-0.09, -0.03], [-0.3, -0.09], [-0.3, 0.03], [-0.06, 0.035]], 0.034, wood, wp);
      mb.sweep([v(0.36, 0.035, -0.3), v(0.44, 0.035, -0.14), v(0.46, 0.035, 0.0), v(0.44, 0.035, 0.14), v(0.36, 0.035, 0.3)], 0.011, 6, hex(DARK), METAL); // cánh nỏ
      mb.sweep([v(0.36, 0.035, -0.3), v(0.1, 0.04, 0.0), v(0.36, 0.035, 0.3)], 0.0025, 4, hex(0xd8d2c0), FLAT); // dây đã lên
      bx(mb, v(0.25, 0.036, 0.0), v(0.36, 0.008, 0.012), DARK, METAL); // rãnh tên
      arrow(mb, v(0.1, 0.045, 0.0), 0.42);
      trigger(mb, 0.03);
      sights(mb, 0.02, 0.4, 0.045);
      bx(mb, v(0.47, 0.0, 0.0), v(0.012, 0.09, 0.05), DARK, METAL); // bàn đạp lên dây
      break;
    }
    case 'Flame': {
      // Vòi phun: ống dài, lá chắn nhiệt đục lỗ, mồi lửa; hai bình dưới thân nối ống mềm.
      tube(mb, 0.0, 0.6, 0.045, 0.0, 0.012, DARK);
      mb.tube(v(0.3, 0.045, 0.0), v(0.56, 0.045, 0.0), 0.022, 0.022, 10, hex(0x6a6e72), METAL);
      mb.tube(v(0.6, 0.045, 0.0), v(0.64, 0.045, 0.0), 0.012, 0.02, 8, hex(DARK), METAL);
      mb.emi = 2.0;
      mb.ball(v(0.65, 0.03, 0.0), v(0.01, 0.01, 0.01), 6, hex(0x6ac8ff), FLAT);
      mb.emi = 0.0;
      for (const sz of [-1.0, 1.0]) {
        mb.tube(v(-0.02, -0.06, sz * 0.045), v(0.26, -0.06, sz * 0.045), 0.04, 0.04, 10, hex(sz < 0.0 ? 0xb0342a : 0x8a8f86), METAL);
        mb.ball(v(0.26, -0.06, sz * 0.045), v(0.02, 0.04, 0.04), 8, hex(DARK), METAL);
      }
      mb.sweep([v(0.24, -0.03, 0.04), v(0.3, 0.0, 0.03), v(0.28, 0.04, 0.0)], 0.008, 6, hex(0x1c1c1c), FLAT);
      pistol_grip(mb, -0.004, POLY, FLAT, 0.03);
      trigger(mb, 0.04);
      plate(mb, [[0.26, 0.03], [0.3, 0.03], [0.29, -0.012], [0.26, -0.012]], 0.03, POLY, FLAT);
      break;
    }
    case 'Saw': {
      mb.bevel = 0.008;
      bx(mb, v(0.14, 0.035, 0.0), v(0.4, 0.085, 0.06), 0xb0452a, METAL);
      mb.bevel = 0.0025;
      bx(mb, v(0.2, 0.035, 0.0), v(0.5, 0.012, 0.2), DARK, METAL); // khe phóng lưỡi
      saw_disc(mb, v(0.4, 0.045, 0.0), 0.1);
      pistol_grip(mb, -0.004, POLY, FLAT, 0.03);
      trigger(mb, 0.04);
      mb.sweep([v(0.18, 0.08, 0.0), v(0.2, 0.13, 0.0), v(0.32, 0.13, 0.0), v(0.34, 0.08, 0.0)], 0.01, 6, hex(DARK), METAL);
      stock(mb, -0.04, POLY, FLAT, 0.03);
      break;
    }
    case 'Nail': {
      mb.bevel = 0.006;
      bx(mb, v(0.07, 0.06, 0.0), v(0.2, 0.075, 0.05), 0xc2a23a, METAL);
      mb.bevel = 0.0025;
      tube(mb, 0.17, 0.24, 0.045, 0.0, 0.012, STEEL);
      mb.tube(v(-0.04, 0.07, 0.0), v(0.0, 0.07, 0.0), 0.03, 0.034, 10, hex(DARK), METAL); // nắp pít-tông
      pistol_grip(mb, -0.004, 0x1c1c1c, FLAT, 0.032);
      trigger(mb, 0.04);
      mb.sweep([v(-0.03, -0.1, 0.0), v(-0.06, -0.14, 0.0), v(-0.1, -0.2, 0.0)], 0.007, 5, hex(0x2a2a2a), FLAT); // dây hơi
      break;
    }
  }
  mb.bevel = old;
  void col2;
}

/** Mũi tên: thân, đầu thép, ba cánh lông; `at` là đuôi, bay theo +x. */
export function arrow(mb, at, len) {
  const { METAL, FLAT, WOOD } = geom;
  mb.tube(at, at.add(v(len, 0.0, 0.0)), 0.004, 0.004, 5, hex(0xb9a36a), WOOD);
  mb.tube(at.add(v(len, 0.0, 0.0)), at.add(v(len + 0.05, 0.0, 0.0)), 0.009, 0.001, 5, hex(STEEL), METAL);
  for (let k = 0; k < 3; k++) {
    const a = k * 2.094;
    const o = v(0.0, Math.sin(a) * 0.012, Math.cos(a) * 0.012);
    mb.quad([at.add(v(0.01, 0.0, 0.0)), at.add(v(0.08, 0.0, 0.0)), at.add(v(0.07, 0.0, 0.0)).add(o.mul(1.4)), at.add(v(0.0, 0.0, 0.0)).add(o.mul(1.4))], hex(0xb23a2e), FLAT);
    mb.quad([at.add(v(0.0, 0.0, 0.0)).add(o.mul(1.4)), at.add(v(0.07, 0.0, 0.0)).add(o.mul(1.4)), at.add(v(0.08, 0.0, 0.0)), at.add(v(0.01, 0.0, 0.0))], hex(0xb23a2e), FLAT);
  }
}

/** Lưỡi cưa đĩa có răng, nằm ngang (trục y). */
export function saw_disc(mb, c, r) {
  const { METAL } = geom;
  mb.cyl(c.sub(Y.mul(0.003)), r * 0.86, r * 0.86, 0.006, 16, hex(0xb8bcc0), METAL);
  for (let k = 0; k < 16; k++) {
    const a = k * 0.3927;
    const s = Math.sin(a), co = Math.cos(a);
    const s2 = Math.sin(a + 0.2), c2 = Math.cos(a + 0.2);
    mb.tri([c.add(v(co * r * 0.84, 0.0, s * r * 0.84)), c.add(v(c2 * r * 0.84, 0.0, s2 * r * 0.84)), c.add(v(c2 * r * 1.06, 0.0, s2 * r * 1.06))], hex(0xd8dce0), METAL);
    mb.tri([c.add(v(c2 * r * 1.06, 0.0, s2 * r * 1.06)), c.add(v(c2 * r * 0.84, 0.0, s2 * r * 0.84)), c.add(v(co * r * 0.84, 0.0, s * r * 0.84))], hex(0xd8dce0), METAL);
  }
  mb.cyl(c.sub(Y.mul(0.006)), r * 0.2, r * 0.2, 0.012, 8, hex(DARK), METAL);
}

/* VIEW NOTES (guns.js)
 - Mesh code is ported 1:1 against geom.js MB: `model(mb, item)` builds the gun body, `off_part(mb, item)` the part that
   follows the left hand (detachable magazine from `mag_at`, or the ribbed wooden pump of the Shotgun). Gun frame: +x is the
   barrel (muzzle at spec.muzzle = (muzzle, 0.045, 0)), +y up, +z to the holder's right; origin at the trigger hand
   (spec.grip = (-0.012, -0.045, 0)). Sizes are metres; all blocks bevelled 0.0025 m unless set otherwise.
 - Palette: STEEL 0x8a9096, DARK 0x24272a, GUN 0x33383d, wood 0x6d4e2a (Rifle/Shotgun/Sniper/Revolver/Crossbow/Bow, pattern
   WOOD) else polymer 0x2a2c2a (FLAT). Flame pilot light is emissive 2.0 blue 0x6ac8ff; sniper lens 0x3a6a8a GLASS.
 - Used elsewhere: icons (icons.rs), dropped weapons (models.rs weapon_item), first-person viewmodel (fp.build_vm);
   `arrow` (shaft 0xb9a36a, steel head, three red 0xb23a2e fletchings, tail at `at`, flies +x) and `saw_disc` (16-tooth disc,
   radius r, flat on the y axis) are reused by fp.draw for flying arrows and saw blades.
 - spec(): class, hand points, eject port, kick [back m, pitch rad, yaw rad, roll rad], view kick rad, reload style
   (Mag/Pump/Bolt/Single/Draw), hold offset from the eye (right, up, forward(-z)), visible bullet speed m/s.
 PORT GAPS: none in this file. Rust `class` is exported as `class` via `export { class_ as class }` (reserved word).
   `items.look(item)` is expected to return [u8, col, col2]; `items.gun(item)` [w, gd] | null.
*/
