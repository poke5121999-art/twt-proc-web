//! Thế giới dựng bằng code: quán, phòng ngủ, vỏ phòng y tế / phần mở rộng / nhà kho, bãi trong hàng rào dây,
//! đường phố, bệnh viện đối diện, xe hỏng, rào chắn raid. Mọi chỗ có tên lấy từ `crate::lay`; hạt giống chỉ đổi chi tiết.
//! Trục: +x đông, +z ra đường (mặt tiền quán), y lên.
// Port of src/world.rs (see three/PORT-CONTRACT.md + ADDENDUM).
import { Vec3, ZERO, Y, X, Z, clamp, trunc, q_y, q_x, q_z, q_mul, q_to_euler_yxz, Q_ID, rot_y } from './vec.js';
import {
  MB, Rng, hex, shade, set_lod, m4_mul, m4_translate, m4_rot_x, m4_rot_y, m4_rot_z, m4_scale,
  FLAT, WOOD, CONCRETE, ASPHALT, BRICK, CORRUGATED, GROUND, PLASTER, CARDBOARD, GLASS, STRIPES, METAL,
} from './geom.js';
import * as scene from './scene.js';
import * as lay from './lay.js';
import * as G from './game.js';
import * as dress from './dress.js';
import * as fp from './fp.js';
import * as build from './build.js';
import * as models from './models.js';
import * as player from './player.js';
import * as carry from './carry.js';

const PI = Math.PI;
const TAU = Math.PI * 2;
const FRAC_PI_2 = Math.PI / 2;
/** lay::STREET_DZ (đọc trong hàm, lay.js là module anh em). */
const DZ_ = () => lay.STREET_DZ;

/** Hộp phủ chân một chiếc xe hỏng (dài 4,2 m, rộng 1,8 m) xoay theo `yaw`. */
function car_box(p, yaw) {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const hx = Math.abs(c) * 2.1 + Math.abs(s) * 0.9;
  const hz = Math.abs(s) * 2.1 + Math.abs(c) * 0.9;
  return [p.x - hx, p.z - hz, p.x + hx, p.z + hz];
}

/** Mảng tính lười (LazyLock): lần đầu đọc bất kỳ thuộc tính nào (length, chỉ số, for..of, concat) mới dựng. */
function lazy_array(init) {
  const arr = [];
  let done = false;
  const fill = () => { if (!done) { done = true; for (const x of init()) arr.push(x); } };
  return new Proxy(arr, {
    get(t, k, r) { fill(); return Reflect.get(t, k, r); },
    has(t, k) { fill(); return Reflect.has(t, k); },
    ownKeys(t) { fill(); return Reflect.ownKeys(t); },
    getOwnPropertyDescriptor(t, k) { fill(); return Reflect.getOwnPropertyDescriptor(t, k); },
  });
}

/** Hộp đổ bóng mặt trời (shader tính bóng bằng tia-hộp, tối đa 16 hộp). Mỗi phần tử [[minx,miny,minz],[maxx,maxy,maxz]]. */
export const SHADOW_BOXES = lazy_array(() => {
  const DZ = DZ_();
  const sk = lay.SKIP_BOX, ex = lay.EXPANSION, wh = lay.WAREHOUSE;
  const v = [
    [[lay.BUILDING[0], 0.0, lay.BUILDING[1]], [lay.BUILDING[2], 3.5, lay.BUILDING[3]]],
    [[-5.3, 2.6, 5.25], [5.3, 2.75, 6.9]],
    [[ex[0], 0.0, ex[1]], [ex[2], 3.4, ex[3]]],
    [[wh[0], 0.0, wh[1]], [wh[2], lay.WAREHOUSE_H, wh[3]]],
    [[-16.0, 0.0, 26.0 + DZ], [10.0, 9.0, 38.0 + DZ]],
    [[18.0, 0.0, 26.0 + DZ], [30.0, 6.0, 36.0 + DZ]],
    [[-34.0, 0.0, 26.0 + DZ], [-22.0, 7.0, 36.0 + DZ]],
    [[sk[0], 0.0, sk[1]], [sk[2], 1.35, sk[3]]],
    [[-2.3, 3.5, 5.05], [2.3, 4.65, 5.17]],
    [[lay.LOT[0], 0.0, lay.LOT[1] - 0.06], [lay.LOT[2], 2.0, lay.LOT[1]]],
  ];
  for (const [p, yaw] of lay.CARS.slice(0, 4)) {
    const b = car_box(p, yaw);
    v.push([[b[0] + 0.1, 0.0, b[1] + 0.1], [b[2] - 0.1, 1.35, b[3] - 0.1]]);
  }
  const [x, segs] = lay.BARRIERS[0];
  for (const [z0, z1] of segs) {
    v.push([[x - 0.6, 0.0, z0], [x + 0.6, 2.4, z1]]);
  }
  return v;
});

/** Vật cản tĩnh trên mặt phẳng XZ: (minx, minz, maxx, maxz). Cửa còn đóng và tường chưa phá nằm ở `g.bld.cols`. */
export const COLLIDERS = lazy_array(() => {
  const DZ = DZ_();
  const wd = lay.WH_DOOR_BOX, md = lay.MED_DOOR_BOX, bd = lay.BED_DOOR_BOX;
  const e = lay.EXPANSION, w = lay.WAREHOUSE;
  const v = [
    // Tường sau quán + phòng ngủ, chừa ô cửa nhà kho.
    [lay.BUILDING[0], -5.25, wd[0], -5.0],
    [wd[2], -5.25, 5.25, -5.0],
    // Tường đông của quán: đoạn trước cố định (đoạn sau là tường phá được, xem build::refresh).
    [5.0, 2.95, 5.25, 5.25],
    // Tường trước, hai bên cửa chính.
    [-5.25, 5.0, lay.DOOR_BOX[0], 5.25],
    [lay.DOOR_BOX[2], 5.0, 5.25, 5.25],
    // Vách tây của quán: chừa ô cửa phòng ngủ và ô cửa phòng y tế.
    [-5.25, -5.0, -5.0, bd[1]],
    [-5.25, bd[3], -5.0, md[1]],
    [-5.25, md[3], -5.0, 5.25],
    // Tường tây (phòng ngủ + phòng y tế), vách phòng ngủ / phòng y tế, tường trước phòng y tế.
    [-9.75, -5.25, -9.5, 5.25],
    [-9.75, -1.0, -5.25, -0.875],
    [-9.75, 5.0, -5.25, 5.25],
    // Phần mở rộng: tường sau, tường trước, tường đông.
    [e[0], -5.25, e[2], -5.0],
    [e[0], 2.95, e[2], e[3]],
    [e[2] - 0.25, e[1], e[2], e[3]],
    // Nhà kho: tường tây, tường sau, tường đông.
    [w[0], w[1], w[0] + 0.25, w[3]],
    [w[0], w[1], w[2], w[1] + 0.25],
    [w[2] - 0.25, w[1], w[2], w[3]],
    lay.WORKBENCH_BOX.slice(),
    lay.SHREDDER_BOX.slice(),
    lay.GENERATOR_BOX.slice(),
    lay.INTEL_BOX.slice(),
    [lay.SIREN.x - 0.5, lay.SIREN.z - 0.5, lay.SIREN.x + 0.5, lay.SIREN.z + 0.5],
    lay.COUNTER_BOX.slice(),
    [-4.95, -1.65, -4.3, 2.65],
    [4.3, -1.65, 4.95, 2.65],
    [lay.BED_BOX[0].x, lay.BED_BOX[0].z, lay.BED_BOX[1].x, lay.BED_BOX[1].z],
    lay.BED_CRATES.slice(),
    lay.SKIP_BOX.slice(),
    [lay.CACHE_TROLLEY.x - 0.5, lay.CACHE_TROLLEY.z - 0.4, lay.CACHE_TROLLEY.x + 0.5, lay.CACHE_TROLLEY.z + 0.4],
    [lay.DELIVERY.x - 0.6, lay.DELIVERY.z - 0.5, lay.DELIVERY.x + 0.6, lay.DELIVERY.z + 0.5],
    [-5.3, 6.6, -5.1, 6.8],
    [5.1, 6.6, 5.3, 6.8],
    [-16.0, 26.0 + DZ, 10.0, 38.0 + DZ],
    [18.0, 26.0 + DZ, 30.0, 36.0 + DZ],
    [-34.0, 26.0 + DZ, -22.0, 36.0 + DZ],
  ];
  for (const d of lay.DUMPSTERS) {
    v.push([d.x - 0.95, d.z - 0.55, d.x + 0.95, d.z + 0.55]);
  }
  for (const [x, z] of lay.LAMPS) {
    v.push([x - 0.2, z - 0.2, x + 0.2, z + 0.2]);
  }
  for (const [p, yaw] of lay.CARS) {
    v.push(car_box(p, yaw));
  }
  for (const [x, segs] of lay.BARRIERS) {
    for (const [z0, z1] of segs) {
      v.push([x - 0.6, z0, x + 0.6, z1]);
    }
  }
  for (const f of lay.FENCE) v.push(f.slice());
  return v;
});

/** Đẩy p (Vec3, sửa tại chỗ) ra khỏi hộp b. */
function push_out(p, b, r) {
  const cx = clamp(p.x, b[0], b[2]);
  const cz = clamp(p.z, b[1], b[3]);
  const dx = p.x - cx, dz = p.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) {
    return;
  }
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    p.x = cx + (dx / d) * r;
    p.z = cz + (dz / d) * r;
  } else {
    // Tâm nằm trong hộp: đẩy ra mặt gần nhất.
    const l = p.x - b[0], rr = b[2] - p.x, t = p.z - b[1], bb = b[3] - p.z;
    const m = Math.min(l, rr, t, bb);
    if (m === l) {
      p.x = b[0] - r;
    } else if (m === rr) {
      p.x = b[2] + r;
    } else if (m === t) {
      p.z = b[1] - r;
    } else {
      p.z = b[3] + r;
    }
  }
}

/** Đẩy một hình tròn bán kính r ra khỏi mọi vật cản (tường, đồ đạc, cửa đang đóng, vật dựng chặn đường). */
export function resolve(g, p_in, r) {
  const p = p_in.clone();
  for (let it = 0; it < 2; it++) {
    for (const b of COLLIDERS) {
      push_out(p, b, r);
    }
    for (const b of g.bld.cols) {
      push_out(p, b, r);
    }
    if (g.door_blocks()) {
      push_out(p, lay.DOOR_BOX, r);
    }
    if (g.bed_door_hits < 3) {
      push_out(p, lay.BED_DOOR_BOX, r);
    }
    for (const q of g.props) {
      if (!q.dead && q.kind.k === 'Placed') {
        const it2 = q.kind.a;
        if (Math.abs(q.pos.x - p.x) < 3.0 && Math.abs(q.pos.z - p.z) < 3.0 && g.bld.mounted !== q.id && build.footprint(it2)[2]) {
          push_out(p, build.prop_box(it2, q.pos, q.yaw), r);
        }
      }
    }
  }
  p.x = clamp(p.x, lay.BOUNDS[0], lay.BOUNDS[2]);
  p.z = clamp(p.z, lay.BOUNDS[1], lay.BOUNDS[3]);
  return p;
}

// Marker components (Bevy) -> the nodes are kept in WorldEnts (see below). Kept as names for reference.
// SkyDome, DoorLeaf(f32), BedDoor, OpenSign(bool), PropVis.

/** Chữ khối 5×7 cho biển hiệu. */
function glyph(c) {
  switch (c) {
    case 'S': return [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110];
    case 'H': return [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001];
    case 'O': return [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110];
    case 'P': return [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000];
    case 'E': return [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111];
    case 'N': return [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001];
    case 'C': return [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110];
    case 'L': return [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111];
    case 'D': return [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110];
    case '+': return [0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000];
    default: return [0, 0, 0, 0, 0, 0, 0];
  }
}

/** Viết chữ bằng các khối nhỏ trên mặt phẳng XY, nhìn về +z. */
function text3d(mb, s, origin, px, col, emi) {
  const old = mb.emi;
  mb.emi = emi;
  const chars = Array.from(s);
  for (let i = 0; i < chars.length; i++) {
    const g = glyph(chars[i]);
    for (let r = 0; r < g.length; r++) {
      const row = g[r];
      for (let c = 0; c < 5; c++) {
        if ((row & (1 << (4 - c))) !== 0) {
          const p = origin.add(new Vec3((i * 6.0 + c) * px, (6 - r) * px, 0.0));
          mb.cube(p, new Vec3(px, px, px * 0.6), col, FLAT);
        }
      }
    }
  }
  mb.emi = old;
}

/** Tường dọc trục x: nửa trong (màu + hoạ tiết sơn) và nửa ngoài. `inn`/`out` = [col, pat]. */
function wall_x(mb, x0, x1, y0, y1, z_in, z_out, inn, out) {
  const mid = (z_in + z_out) * 0.5;
  mb.block(new Vec3(x0, y0, Math.min(z_in, mid)), new Vec3(x1 - x0, y1 - y0, Math.abs(z_in - mid)), inn[0], inn[1]);
  mb.block(new Vec3(x0, y0, Math.min(z_out, mid)), new Vec3(x1 - x0, y1 - y0, Math.abs(z_out - mid)), out[0], out[1]);
}

function wall_z(mb, z0, z1, y0, y1, x_in, x_out, inn, out) {
  const mid = (x_in + x_out) * 0.5;
  mb.block(new Vec3(Math.min(x_in, mid), y0, z0), new Vec3(Math.abs(x_in - mid), y1 - y0, z1 - z0), inn[0], inn[1]);
  mb.block(new Vec3(Math.min(x_out, mid), y0, z0), new Vec3(Math.abs(x_out - mid), y1 - y0, z1 - z0), out[0], out[1]);
}

/** Cửa đóng trên mặt tường trong: tấm ván và hai thanh đóng chéo. `facing_x`: cửa nằm trên tường dọc trục z. */
function shut_door(mb, c, facing_x, w) {
  const wood = hex(0x5d4a36);
  const [size, plank] = facing_x ? [new Vec3(0.05, 2.1, w), new Vec3(0.03, 0.14, w + 0.25)] : [new Vec3(w, 2.1, 0.05), new Vec3(w + 0.25, 0.14, 0.03)];
  mb.cube(c.add(Y.mul(1.05)), size, wood, WOOD);
  for (const [k, a] of [[0, 0.22], [1, -0.18]]) {
    const rot = facing_x ? m4_rot_x(a) : m4_rot_z(a);
    mb.push(m4_mul(m4_translate(c.add(Y.mul(0.7 + k * 0.75))), rot));
    mb.cube(ZERO, plank, shade(wood, 1.3), WOOD);
    mb.pop();
  }
}

/** Bàn chế tạo trong nhà kho: bậc 1 mặt bàn + ê-tô, bậc 2 thêm bảng treo đồ nghề, bậc 3 thêm đèn và máy khoan bàn. */
function workbench(mb, tier) {
  const b = lay.WORKBENCH_BOX;
  const wood = hex(0x7a5a3a);
  const steel = hex(0x8a9096);
  const x0 = b[0], z0 = b[1], w = b[2] - b[0], d = b[3] - b[1];
  mb.block(new Vec3(x0, 0.86, z0), new Vec3(w, 0.07, d), shade(wood, 1.1), WOOD);
  for (const [dx, dz] of [[0.04, 0.04], [w - 0.12, 0.04], [0.04, d - 0.12], [w - 0.12, d - 0.12]]) {
    mb.block(new Vec3(x0 + dx, 0.0, z0 + dz), new Vec3(0.08, 0.86, 0.08), shade(wood, 0.7), WOOD);
  }
  mb.block(new Vec3(x0 + 0.05, 0.3, z0 + 0.05), new Vec3(w - 0.1, 0.04, d - 0.1), shade(wood, 0.85), WOOD);
  mb.block(new Vec3(x0 + 0.15, 0.93, z0 + 0.2), new Vec3(0.22, 0.16, 0.14), hex(0x3d5a78), METAL);
  mb.block(new Vec3(x0 + 0.2, 1.09, z0 + 0.18), new Vec3(0.12, 0.05, 0.18), steel, METAL);
  mb.block(new Vec3(x0 + 0.7, 0.93, z0 + 0.3), new Vec3(0.4, 0.03, 0.06), steel, METAL);
  if (tier >= 1) {
    mb.block(new Vec3(x0, 1.2, b[3] - 0.04), new Vec3(w, 0.9, 0.03), hex(0x6a5236), WOOD);
    for (let k = 0; k < 5; k++) {
      mb.block(new Vec3(x0 + 0.15 + k * 0.33, 1.4 + (k % 2) * 0.2, b[3] - 0.07), new Vec3(0.05, 0.36, 0.03), k % 2 === 0 ? steel : hex(0xb0452a), METAL);
    }
  }
  if (tier >= 2) {
    mb.block(new Vec3(b[2] - 0.45, 0.93, z0 + 0.25), new Vec3(0.3, 0.06, 0.3), hex(0x2c4a3a), METAL);
    mb.cyl(new Vec3(b[2] - 0.3, 0.99, z0 + 0.4), 0.035, 0.035, 0.7, 6, steel, METAL);
    mb.block(new Vec3(b[2] - 0.42, 1.55, z0 + 0.3), new Vec3(0.24, 0.2, 0.3), hex(0x2c4a3a), METAL);
    mb.emi = 1.3;
    mb.cube(new Vec3(x0 + w * 0.5, 2.05, b[3] - 0.12), new Vec3(0.9, 0.05, 0.12), hex(0xfff0c0), FLAT);
    mb.emi = 0.0;
  }
}

/** Máy nghiền: phễu trên, thân máy, băng ra; chưa sửa thì nắp bung và không có đèn. */
function shredder(mb, fixed) {
  const b = lay.SHREDDER_BOX;
  const body = hex(0x6a4a2a);
  const steel = hex(0x8a9096);
  const cx = (b[0] + b[2]) * 0.5, cz = (b[1] + b[3]) * 0.5;
  mb.block(new Vec3(b[0], 0.0, b[1]), new Vec3(b[2] - b[0], 1.1, b[3] - b[1]), body, METAL);
  mb.lathe(new Vec3(cx, 1.1, cz), [[0.35, 0.0], [0.75, 0.75], [0.78, 0.78]], 4, false, shade(steel, 0.8), METAL);
  mb.block(new Vec3(b[0] + 0.2, 0.25, b[3]), new Vec3(0.9, 0.08, 0.5), hex(0x24272a), METAL);
  mb.block(new Vec3(b[2] - 0.5, 0.6, b[3]), new Vec3(0.35, 0.4, 0.06), hex(0x30353a), METAL);
  if (fixed) {
    mb.emi = 1.0;
    mb.cube(new Vec3(b[2] - 0.32, 0.9, b[3] + 0.07), new Vec3(0.08, 0.08, 0.03), hex(0x3ad06a), FLAT);
    mb.emi = 0.0;
    for (let k = 0; k < 5; k++) {
      mb.cyl(new Vec3(cx - 0.3 + k * 0.15, 1.12, cz), 0.14, 0.14, 0.02, 10, steel, METAL);
    }
  } else {
    mb.push(m4_mul(m4_translate(new Vec3(b[0] - 0.1, 0.55, cz)), m4_rot_z(0.5)));
    mb.cube(ZERO, new Vec3(0.05, 0.9, 0.9), shade(body, 0.8), METAL);
    mb.pop();
    mb.cube(new Vec3(b[2] - 0.32, 0.9, b[3] + 0.07), new Vec3(0.08, 0.08, 0.03), hex(0x5a1f1c), FLAT);
  }
}

/** Máy phát điện: khung, động cơ, bình xăng, ống xả; đã sửa thì đèn xanh. */
function generator(mb, fixed) {
  const b = lay.GENERATOR_BOX;
  const cx = (b[0] + b[2]) * 0.5, cz = (b[1] + b[3]) * 0.5;
  const frame = hex(0x30353a);
  for (const [dx, dz] of [[0.0, 0.0], [b[2] - b[0] - 0.06, 0.0], [0.0, b[3] - b[1] - 0.06], [b[2] - b[0] - 0.06, b[3] - b[1] - 0.06]]) {
    mb.block(new Vec3(b[0] + dx, 0.0, b[1] + dz), new Vec3(0.06, 1.1, 0.06), frame, METAL);
  }
  mb.block(new Vec3(b[0], 1.04, b[1]), new Vec3(b[2] - b[0], 0.06, b[3] - b[1]), frame, METAL);
  mb.block(new Vec3(b[0] + 0.15, 0.12, b[1] + 0.2), new Vec3(b[2] - b[0] - 0.3, 0.6, b[3] - b[1] - 0.4), hex(0xb08a2a), METAL);
  mb.block(new Vec3(b[0] + 0.2, 0.72, b[1] + 0.3), new Vec3(b[2] - b[0] - 0.4, 0.25, b[3] - b[1] - 0.7), hex(0xb0342a), METAL);
  mb.cyl(new Vec3(cx + 0.3, 0.72, cz + 0.5), 0.05, 0.05, 0.9, 6, hex(0x5a5f63), METAL);
  mb.emi = fixed ? 1.1 : 0.0;
  mb.cube(new Vec3(b[0] - 0.01, 0.6, cz), new Vec3(0.03, 0.08, 0.08), fixed ? hex(0x3ad06a) : hex(0x5a1f1c), FLAT);
  mb.emi = 0.0;
}

/** Bàn tin tức trong phòng ngủ: bậc 0 bàn + radio, bậc 1 thêm ăng-ten, bậc 2 radio tầm xa, bậc 3 dãy màn hình. */
function intel_station(mb, tier) {
  const b = lay.INTEL_BOX;
  const wood = hex(0x6a5236);
  mb.block(new Vec3(b[0], 0.72, b[1]), new Vec3(b[2] - b[0], 0.05, b[3] - b[1]), wood, WOOD);
  for (const x of [b[0] + 0.04, b[2] - 0.1]) {
    mb.block(new Vec3(x, 0.0, b[1] + 0.04), new Vec3(0.06, 0.72, b[3] - b[1] - 0.08), shade(wood, 0.7), WOOD);
  }
  mb.block(new Vec3(b[0] + 0.2, 0.77, b[1] + 0.1), new Vec3(0.45, 0.25, 0.25), hex(0x39424d), METAL);
  mb.emi = 0.9;
  mb.cube(new Vec3(b[0] + 0.32, 0.9, b[1] + 0.36), new Vec3(0.12, 0.05, 0.01), hex(0xe2b13c), FLAT);
  mb.emi = 0.0;
  if (tier >= 1) {
    mb.cyl(new Vec3(b[0] + 0.6, 1.02, b[1] + 0.2), 0.008, 0.008, 0.9, 4, hex(0x8a9096), METAL);
  }
  if (tier >= 2) {
    mb.block(new Vec3(b[0] + 0.8, 0.77, b[1] + 0.08), new Vec3(0.5, 0.4, 0.3), hex(0x2c3338), METAL);
    mb.cyl(new Vec3(b[0] + 1.05, 1.17, b[1] + 0.2), 0.012, 0.012, 1.4, 4, hex(0x8a9096), METAL);
  }
  if (tier >= 3) {
    mb.emi = 0.8;
    for (let k = 0; k < 3; k++) {
      mb.cube(new Vec3(b[0] + 0.3 + k * 0.5, 1.45, b[1] + 0.03), new Vec3(0.42, 0.3, 0.02), hex(0x4a8ac0), FLAT);
    }
    mb.emi = 0.0;
  }
}

function build_shop(mb, glass, g) {
  const paint_col = build.paint_col;
  const or = (o, d) => (o !== null && o !== undefined ? o : d);
  const bld = g.bld;
  const base_wall = [hex(0x8a8f78), PLASTER];
  const base_floor = [hex(0x556070), WOOD];
  const plaster = or(paint_col(g, 0, false), base_wall);
  const brick = [hex(0x8b5a45), BRICK];
  const trim = hex(0x3b3a36);
  const wood = hex(0x7a5a3a);
  const bx0 = lay.BUILDING[0], bx1 = lay.BUILDING[2];
  // Sàn quán (sơn được), sàn phòng ngủ + phòng y tế, trần và xà.
  const fl = or(paint_col(g, 0, true), base_floor);
  mb.block(new Vec3(-5.0, -0.1, -5.0), new Vec3(10.0, 0.1, 10.0), fl[0], fl[1]);
  mb.block(new Vec3(lay.BEDROOM[0], -0.1, -5.0), new Vec3(-5.0 - lay.BEDROOM[0], 0.1, 10.0), base_floor[0], base_floor[1]);
  mb.block(new Vec3(bx0, 3.2, -5.25), new Vec3(bx1 - bx0, 0.3, 10.5), hex(0x4b4a45), CONCRETE);
  for (let i = 0; i < 4; i++) {
    mb.block(new Vec3(-5.0, 2.98, -3.6 + i * 2.4), new Vec3(10.0, 0.22, 0.18), hex(0x4a3524), WOOD);
  }
  // Tường trước: cửa đôi x −1..1, hai cửa sổ.
  for (const [x0, x1] of [[-5.25, -4.0], [-2.0, -1.0], [1.0, 2.0], [4.0, 5.25]]) {
    wall_x(mb, x0, x1, 0.0, 3.2, 5.0, 5.25, plaster, brick);
  }
  for (const [x0, x1] of [[-4.0, -2.0], [2.0, 4.0]]) {
    wall_x(mb, x0, x1, 0.0, 1.0, 5.0, 5.25, plaster, brick);
    wall_x(mb, x0, x1, 2.2, 3.2, 5.0, 5.25, plaster, brick);
    glass.alpha = 0.28;
    glass.cube(new Vec3((x0 + x1) * 0.5, 1.6, 5.12), new Vec3(x1 - x0, 1.2, 0.03), hex(0x9fb8c4), GLASS);
    // Ván đóng chéo ngang cửa sổ.
    const r = Rng.named(x0 < 0.0 ? 'boardsL' : 'boardsR');
    for (let k = 0; k < 3; k++) {
      mb.push(m4_mul(m4_translate(new Vec3((x0 + x1) * 0.5, 1.2 + k * 0.4, 5.27)), m4_rot_z(r.range(-0.14, 0.14))));
      mb.cube(ZERO, new Vec3(2.3, 0.17, 0.04), shade(wood, r.range(0.7, 1.1)), WOOD);
      mb.pop();
    }
  }
  wall_x(mb, -1.0, 1.0, 2.3, 3.2, 5.0, 5.25, plaster, brick);
  // Khung cửa.
  for (const x of [-1.06, 1.0]) {
    mb.block(new Vec3(x, 0.0, 4.97), new Vec3(0.06, 2.3, 0.31), trim, FLAT);
  }
  mb.block(new Vec3(-1.06, 2.3, 4.97), new Vec3(2.12, 0.07, 0.31), trim, FLAT);
  // Tường sau (quán + phòng ngủ) chừa ô cửa nhà kho.
  const bed_wall = [hex(0x7f7a6a), PLASTER];
  const wd = lay.WH_DOOR_BOX;
  wall_x(mb, bx0, -5.0, 0.0, 3.2, -5.0, -5.25, bed_wall, brick);
  wall_x(mb, -5.0, wd[0], 0.0, 3.2, -5.0, -5.25, plaster, brick);
  wall_x(mb, wd[2], bx1, 0.0, 3.2, -5.0, -5.25, plaster, brick);
  wall_x(mb, wd[0], wd[2], 2.2, 3.2, -5.0, -5.25, plaster, brick);
  if (bld.wh_open) {
    mb.block(new Vec3(wd[0] - 0.05, 0.0, -6.3), new Vec3(0.05, 2.1, 1.05), hex(0x5d4a36), WOOD);
  } else {
    shut_door(mb, new Vec3((wd[0] + wd[2]) * 0.5, 0.0, -4.97), false, wd[2] - wd[0]);
    mb.block(new Vec3(wd[0], 0.0, -5.2), new Vec3(wd[2] - wd[0], 2.2, 0.1), hex(0x4a3a2c), WOOD);
  }
  // Tường đông của quán: phá đoạn sau khi phòng mở rộng 1 đã mở.
  if (bld.rooms < 1) {
    wall_z(mb, -5.25, 5.25, 0.0, 3.2, 5.0, 5.25, plaster, brick);
  } else {
    wall_z(mb, 2.95, 5.25, 0.0, 3.2, 5.0, 5.25, plaster, brick);
    wall_z(mb, -5.0, 2.95, 2.75, 3.2, 5.0, 5.25, plaster, plaster);
  }
  // Tường tây (phòng ngủ, và phòng y tế khi đã mở).
  wall_z(mb, -5.25, bld.med_open ? 5.25 : lay.BEDROOM[3], 0.0, 3.2, lay.BEDROOM[0], bx0, bed_wall, brick);
  // Vách quán / phòng ngủ / phòng y tế (x = -5) có ô cửa phòng ngủ và ô cửa phòng y tế.
  const dz0 = lay.BED_DOOR_BOX[1], dz1 = lay.BED_DOOR_BOX[3];
  const md = lay.MED_DOOR_BOX;
  wall_z(mb, -5.0, dz0, 0.0, 3.2, -5.0, -5.25, plaster, bed_wall);
  wall_z(mb, dz1, md[1], 0.0, 3.2, -5.0, -5.25, plaster, bed_wall);
  wall_z(mb, md[3], 5.0, 0.0, 3.2, -5.0, -5.25, plaster, bed_wall);
  wall_z(mb, dz0, dz1, 2.2, 3.2, -5.0, -5.25, plaster, bed_wall);
  wall_z(mb, md[1], md[3], 2.2, 3.2, -5.0, -5.25, plaster, bed_wall);
  if (bld.med_open) {
    mb.block(new Vec3(-6.2, 0.0, md[1] - 0.05), new Vec3(0.95, 2.1, 0.05), hex(0x5d4a36), WOOD);
  } else {
    shut_door(mb, new Vec3(-4.97, 0.0, (md[1] + md[3]) * 0.5), true, md[3] - md[1]);
    mb.block(new Vec3(-5.2, 0.0, md[1]), new Vec3(0.1, 2.2, md[3] - md[1]), hex(0x4a3a2c), WOOD);
  }
  // Phòng y tế phía tây trước: khoá thì là khối gạch đặc; mở rồi thì có tường, giường bệnh, tủ thuốc, cột xích Hulk.
  const m = lay.MEDICAL;
  if (bld.med_open) {
    const white = [hex(0xb9c2bc), PLASTER];
    wall_x(mb, -9.5, -5.25, 0.0, 3.2, -0.875, -1.0, white, bed_wall);
    wall_x(mb, m[0], m[2], 0.0, 3.2, 5.0, 5.25, white, brick);
    [0.6, 2.4].forEach((z, k) => {
      mb.block(new Vec3(-9.4, 0.0, z), new Vec3(1.9, 0.45, 0.9), hex(0x8a9096), METAL);
      mb.block(new Vec3(-9.35, 0.45, z + 0.05), new Vec3(1.8, 0.12, 0.8), k === 0 ? hex(0xd8d4c4) : hex(0xa8b4a8), FLAT);
    });
    mb.block(new Vec3(-6.3, 0.0, 4.55), new Vec3(0.9, 1.8, 0.4), hex(0xcfd4d0), METAL);
    mb.block(new Vec3(-6.05, 1.2, 4.53), new Vec3(0.4, 0.1, 0.02), hex(0xc0342c), FLAT);
    mb.block(new Vec3(-5.9, 1.05, 4.53), new Vec3(0.1, 0.4, 0.02), hex(0xc0342c), FLAT);
    mb.emi = 1.4;
    mb.cube(new Vec3(-7.4, 3.17, 2.2), new Vec3(0.5, 0.05, 0.2), hex(0xe8f4ff), FLAT);
    mb.emi = 0.0;
    if (!bld.helper.freed) {
      const h = lay.HULK;
      mb.cyl(new Vec3(h.x - 0.75, 0.0, h.z), 0.07, 0.07, 2.4, 8, hex(0x3a3d40), METAL);
      for (let k = 0; k < 6; k++) {
        mb.cube_yaw(new Vec3(h.x - 0.68 + k * 0.1, 1.25 - Math.abs(k - 2.5) * 0.04, h.z), new Vec3(0.09, 0.05, 0.03), k * 0.8, hex(0x8a9096), METAL);
      }
    }
  } else {
    mb.block(new Vec3(m[0], 0.0, m[1]), new Vec3(m[2] - m[0], 3.2, m[3] - m[1]), brick[0], BRICK);
  }
  mb.block(new Vec3(m[0] + 0.95, 0.9, m[3]), new Vec3(2.6, 1.3, 0.06), hex(0x8a6c48), WOOD);
  for (let k = 0; k < 3; k++) {
    mb.block(new Vec3(m[0] + 0.85, 1.0 + k * 0.42, m[3] + 0.06), new Vec3(2.8, 0.14, 0.04), shade(wood, 0.8 + k * 0.1), WOOD);
  }
  text3d(mb, '+', new Vec3((m[0] + m[2]) * 0.5 - 0.3, 2.35, m[3] + 0.04), 0.12, hex(0xc0342c), 0.6);
  // Phần mở rộng SF2 + SF3 phía đông: chưa mở là khối gạch đặc; mở phòng nào thì phòng đó có sàn, tường, đèn.
  const e = lay.EXPANSION;
  const ebrick = [shade(brick[0], 0.9), BRICK];
  let solid_from;
  switch (bld.rooms) {
    case 0: solid_from = e[0]; break;
    case 1: solid_from = lay.WALL_SF3[0]; break;
    default: solid_from = e[2];
  }
  if (solid_from < e[2]) {
    mb.block(new Vec3(solid_from, 0.0, e[1]), new Vec3(e[2] - solid_from, 3.2, e[3] - e[1]), ebrick[0], BRICK);
  }
  for (let room = 1; room <= Math.min(bld.rooms, 2); room++) {
    const rb = room === 1 ? lay.SF2 : lay.SF3;
    const wl = or(paint_col(g, room, false), base_wall);
    const rf = or(paint_col(g, room, true), base_floor);
    const x1 = room === 1 ? rb[2] : e[2] - 0.25;
    const x0 = Math.max(rb[0], e[0] - 0.25);
    mb.block(new Vec3(x0, -0.1, -5.0), new Vec3(x1 - x0, 0.1, 7.95), rf[0], rf[1]);
    const wx0 = Math.max(x0, e[0]);
    wall_x(mb, wx0, x1, 0.0, 3.2, -5.0, -5.25, wl, ebrick);
    wall_x(mb, wx0, x1, 0.0, 3.2, 2.95, e[3], wl, ebrick);
    if (room === 2) {
      wall_z(mb, e[1], e[3], 0.0, 3.2, e[2] - 0.25, e[2], wl, ebrick);
    }
    // Hai chụp đèn treo mỗi phòng (vị trí khớp với đèn điểm trong `mat.rs`), bóng đèn tự sáng, và một nẹp gỗ chạy quanh chân tường.
    const cx = (rb[0] + rb[2]) * 0.5;
    for (const lx of [cx - 2.4, cx + 2.4]) {
      mb.cyl(new Vec3(lx, 2.78, -1.0), 0.012, 0.012, 0.42, 4, hex(0x202020), FLAT);
      mb.cyl(new Vec3(lx, 2.66, -1.0), 0.34, 0.08, 0.16, 10, hex(0x2c4a3a), METAL);
      mb.emi = 2.2;
      mb.cyl(new Vec3(lx, 2.6, -1.0), 0.07, 0.09, 0.09, 8, hex(0xfff0c0), FLAT);
      mb.emi = 0.0;
    }
    const skirt = hex(0x5a4632);
    mb.block(new Vec3(wx0, 0.0, -5.0), new Vec3(x1 - wx0, 0.12, 0.03), skirt, WOOD);
    mb.block(new Vec3(wx0, 0.0, 2.92), new Vec3(x1 - wx0, 0.12, 0.03), skirt, WOOD);
  }
  mb.block(new Vec3(e[0], 3.2, e[1] - 0.1), new Vec3(e[2] - e[0] + 0.1, 0.25, e[3] - e[1] + 0.2), hex(0x4b4a45), CONCRETE);
  for (const x0 of [8.0, 14.5, 20.0]) {
    mb.block(new Vec3(x0, 0.9, e[3]), new Vec3(2.4, 1.3, 0.05), hex(0x1c2733), FLAT);
    const r = Rng.named('sfboards');
    for (let k = 0; k < 3; k++) {
      mb.push(m4_mul(m4_translate(new Vec3(x0 + 1.2, 1.15 + k * 0.4, e[3] + 0.06)), m4_rot_z(r.range(-0.15, 0.15))));
      mb.cube(ZERO, new Vec3(2.7, 0.16, 0.04), shade(wood, r.range(0.7, 1.05)), WOOD);
      mb.pop();
    }
  }
  // Nhà kho sau quán: chưa mở là khối tôn đặc; mở rồi thì rỗng, có bàn chế tạo, máy nghiền, máy phát, giá và pallet.
  const w = lay.WAREHOUSE;
  const tin = [hex(0x6d747a), CORRUGATED];
  const hh = lay.WAREHOUSE_H;
  if (bld.wh_open) {
    const inn = [hex(0x5a6066), CORRUGATED];
    mb.block(new Vec3(w[0], -0.1, w[1]), new Vec3(w[2] - w[0], 0.1, w[3] - w[1]), hex(0x6a6862), CONCRETE);
    wall_z(mb, w[1], w[3], 0.0, hh, w[0] + 0.25, w[0], inn, tin);
    wall_z(mb, w[1], w[3], 0.0, hh, w[2] - 0.25, w[2], inn, tin);
    wall_x(mb, w[0], w[2], 0.0, hh, w[1] + 0.25, w[1], inn, tin);
    mb.block(new Vec3(w[0], 3.5, w[3] - 0.06), new Vec3(w[2] - w[0], hh - 3.5, 0.06), inn[0], CORRUGATED);
    workbench(mb, bld.tiers[build.T_BENCH]);
    shredder(mb, bld.tiers[build.T_SHREDDER] >= 1);
    generator(mb, bld.gen_fixed);
    // Giá kho dọc tường tây, pallet và thùng.
    for (let k = 0; k < 3; k++) {
      const z = -17.5 + k * 3.6;
      for (const y of [0.5, 1.5, 2.5]) {
        mb.block(new Vec3(w[0] + 0.3, y, z), new Vec3(0.8, 0.05, 2.8), hex(0x8a6c48), WOOD);
      }
      for (const dz of [0.0, 2.74]) {
        mb.block(new Vec3(w[0] + 0.3, 0.0, z + dz), new Vec3(0.06, 3.0, 0.06), hex(0x3d5a78), METAL);
        mb.block(new Vec3(w[0] + 1.04, 0.0, z + dz), new Vec3(0.06, 3.0, 0.06), hex(0x3d5a78), METAL);
      }
      mb.block(new Vec3(w[0] + 0.4, 0.55, z + 0.3), new Vec3(0.6, 0.45, 0.7), hex(0xb08a55), CARDBOARD);
      mb.block(new Vec3(w[0] + 0.4, 1.55, z + 1.5), new Vec3(0.6, 0.4, 0.9), hex(0x9a7a4a), CARDBOARD);
    }
    const r = Rng.named('whpallets');
    for (const [x, z] of [[9.5, -8.0], [11.2, -8.3], [9.0, -13.5], [1.5, -17.6], [-2.5, -13.0]]) {
      mb.block(new Vec3(x, 0.0, z), new Vec3(1.2, 0.14, 1.0), hex(0x8a6c48), WOOD);
      const h = r.range(0.5, 1.2);
      mb.block(new Vec3(x + 0.1, 0.14, z + 0.1), new Vec3(1.0, h, 0.8), shade(hex(0xb08a55), r.range(0.75, 1.05)), CARDBOARD);
    }
    mb.emi = 1.5;
    for (const [x, z] of [[0.0, -9.0], [8.0, -12.0], [12.0, -16.0]]) {
      mb.cube(new Vec3(x, 5.6, z), new Vec3(1.2, 0.06, 0.25), hex(0xfff0c0), FLAT);
    }
    mb.emi = 0.0;
  } else {
    mb.block(new Vec3(w[0], 0.0, w[1]), new Vec3(w[2] - w[0], hh, w[3] - w[1]), tin[0], CORRUGATED);
  }
  mb.block(new Vec3(w[0] - 0.1, hh, w[1] - 0.1), new Vec3(w[2] - w[0] + 0.2, 0.2, w[3] - w[1] + 0.2), hex(0x4f5458), METAL);
  const gx = lay.o(9.4, 0.0).x;
  mb.block(new Vec3(gx - 2.0, 0.0, w[1] - 0.06), new Vec3(4.0, 4.2, 0.06), hex(0x8b8f88), CORRUGATED);
  mb.cyl(new Vec3(lay.o(12.3, 0.0).x, hh, lay.o(0.0, -12.1).z), 0.25, 0.25, 1.6, 8, hex(0x3a3d40), METAL);
  // Mái hiên sọc và cột.
  for (const x of [-5.2, 5.2]) {
    mb.cyl(new Vec3(x, 0.0, 6.7), 0.05, 0.05, 2.62, 6, trim, METAL);
  }
  // Biển SHOP trên mái.
  mb.block(new Vec3(-2.3, 3.5, 5.05), new Vec3(4.6, 1.15, 0.12), hex(0x2c3338), METAL);
  text3d(mb, 'SHOP', new Vec3(-1.62, 3.68, 5.2), 0.115, hex(0xf2c14e), 0.9);
  // Đèn cửa.
  mb.emi = 1.2;
  mb.cube(lay.DOOR.add(new Vec3(0.0, 2.55, 0.205)), new Vec3(0.3, 0.12, 0.14), hex(0xffc35a), FLAT);
  mb.emi = 0.0;
  // Job Board trên mặt ngoài tường đông (cạnh cửa sổ phải): bảng gỗ, giấy ghim.
  const jb = lay.JOB_BOARD_BOX;
  mb.block(new Vec3(5.25, jb[0].y, jb[0].z + 0.1), new Vec3(0.06, jb[1].y - jb[0].y, jb[1].z - jb[0].z - 0.2), hex(0x6a5236), WOOD);
  const jr = Rng.named('jobboard');
  for (let k = 0; k < 6; k++) {
    const y = 1.05 + trunc(k / 3) * 0.6 + jr.range(-0.05, 0.05), z = jb[0].z + 0.35 + (k % 3) * 0.42;
    mb.cube(new Vec3(5.32, y + 0.2, z), new Vec3(0.012, 0.36, 0.28), shade(hex(0xe2ded2), jr.range(0.8, 1.0)), CARDBOARD);
  }

  mb.bevel = 0.018;
  // Chi tiết trong quán: ống trần, chụp đèn, thảm cửa, áp phích, thùng dưới quầy, đồng hồ.
  mb.cyl(new Vec3(-4.6, 0.0, -4.6), 0.05, 0.05, 3.2, 6, hex(0x5a5f63), METAL);
  mb.block(new Vec3(-4.9, 2.75, -4.7), new Vec3(9.8, 0.09, 0.09), hex(0x5a5f63), METAL);
  mb.block(new Vec3(3.9, 2.75, -4.7), new Vec3(0.09, 0.09, 9.4), hex(0x4f5458), METAL);
  const lamps = [[-2.4, 0.6], [2.4, 0.6], [0.0, -3.4], [lay.BED_LAMP.x, lay.BED_LAMP.z]];
  for (const [x, z] of lamps) {
    mb.cyl(new Vec3(x, 2.9, z), 0.012, 0.012, 0.3, 4, hex(0x202020), FLAT);
    mb.cyl(new Vec3(x, 2.78, z), 0.3, 0.07, 0.14, 8, hex(0x2c4a3a), METAL);
  }
  mb.block(new Vec3(-0.9, 0.0, 3.5), new Vec3(1.8, 0.015, 1.1), hex(0x4a2f2a), CARDBOARD);
  const pr = Rng.named('posters');
  for (const [x, y, z, w2, h2, facing_x] of [[4.99, 1.9, -3.2, 0.7, 0.9, true], [-4.99, 2.45, 0.4, 0.6, 0.8, true], [-3.6, 2.1, -4.99, 0.9, 0.6, false], [2.9, 2.0, -4.99, 0.6, 0.85, false], [4.99, 2.1, 3.9, 0.7, 0.5, true]]) {
    const col = hex(pr.pick([0xb9a36a, 0x8c3b30, 0x4f6f7a, 0xc8c2ae, 0x6b7a4a]));
    if (x > 4.9 && z < 2.95 && bld.rooms >= 1) {
      continue;
    }
    const size = facing_x ? new Vec3(0.012, h2, w2) : new Vec3(w2, h2, 0.012);
    mb.cube(new Vec3(x, y, z), size, col, CARDBOARD);
    const band = facing_x ? new Vec3(0.014, h2 * 0.18, w2 * 0.8) : new Vec3(w2 * 0.8, h2 * 0.18, 0.014);
    mb.cube(new Vec3(x, y + h2 * 0.22, z), band, shade(col, 0.45), FLAT);
  }
  mb.block(new Vec3(-1.5, 0.0, -3.9), new Vec3(0.6, 0.45, 0.45), hex(0x8a6c48), WOOD);
  mb.block(new Vec3(0.2, 0.0, -3.95), new Vec3(0.5, 0.3, 0.4), hex(0xb08a55), CARDBOARD);
  mb.cyl(new Vec3(3.6, 0.0, -4.5), 0.28, 0.28, 0.85, 10, hex(0x3d5a78), CORRUGATED);
  mb.cyl(new Vec3(-4.3, 0.0, 4.7), 0.28, 0.28, 0.85, 10, hex(0x7a4a32), CORRUGATED);
  models.facade(mb);
  models.counter(mb);
  models.shelves(mb);
  // Nút báo động ở đầu trái quầy.
  const al = player.ALARM;
  mb.cube(al.sub(Y.mul(0.01)), new Vec3(0.14, 0.03, 0.14), hex(0x30353a), METAL);
  mb.emi = 0.7;
  mb.cyl(al, 0.04, 0.035, 0.03, 8, hex(0xd8342a), FLAT);
  mb.emi = 0.0;
  intel_station(mb, bld.tiers[build.T_INTEL]);
  // Công tắc mở quán cạnh cửa (trong) và đèn trần.
  const sw = lay.SWITCH;
  mb.block(sw.sub(new Vec3(0.17, 0.22, 0.0)), new Vec3(0.34, 0.44, 0.1), hex(0x30353a), METAL);
  mb.emi = 0.8;
  mb.block(sw.add(new Vec3(-0.05, 0.0, -0.03)), new Vec3(0.1, 0.1, 0.04), hex(0xe2b13c), FLAT);
  mb.emi = 1.6;
  for (const [x, z] of lamps) {
    mb.cube(new Vec3(x, 2.93, z), new Vec3(0.5, 0.06, 0.2), hex(0xfff0c0), FLAT);
  }
  mb.emi = 0.0;

  // Phòng ngủ (phía tây sau quán): giường theo bậc (nệm, túi ngủ, giường đơn), thùng gỗ, vách ván.
  const b0 = lay.BED_BOX[0];
  const bed = bld.tiers[build.T_BED];
  if (bed >= 2) {
    for (const [dx, dz] of [[0.0, 0.0], [1.82, 0.0], [0.0, 0.92], [1.82, 0.92]]) {
      mb.block(new Vec3(b0.x + dx, 0.0, b0.z + dz), new Vec3(0.08, 0.5, 0.08), hex(0x4a3524), WOOD);
    }
    mb.block(new Vec3(b0.x, 0.3, b0.z), new Vec3(0.08, 0.6, 1.0), hex(0x4a3524), WOOD);
  }
  mb.block(new Vec3(b0.x, 0.0, b0.z), new Vec3(1.9, 0.22, 1.0), hex(0x5a4632), WOOD);
  mb.block(new Vec3(b0.x + 0.05, 0.22, b0.z + 0.05), new Vec3(1.8, 0.16, 0.9), hex(0xa8a495), FLAT);
  mb.block(new Vec3(b0.x + 0.13, 0.38, b0.z + 0.15), new Vec3(0.42, 0.1, 0.7), hex(0xd8d4c4), FLAT);
  mb.block(new Vec3(b0.x + 0.7, 0.38, b0.z + 0.05), new Vec3(1.15, bed >= 1 ? 0.1 : 0.05, 0.9), bed >= 1 ? hex(0x8a4a32) : hex(0x4f6b5a), FLAT);
  const c = lay.BED_CRATES;
  mb.block(new Vec3(c[0], 0.0, c[1]), new Vec3(0.8, 0.8, 0.6), wood, WOOD);
  mb.block(new Vec3(c[0] + 0.15, 0.8, c[1] + 0.1), new Vec3(0.6, 0.55, 0.5), shade(wood, 0.8), WOOD);
  mb.block(new Vec3(c[0], 0.0, c[1] + 0.6), new Vec3(0.8, 0.5, 0.6), shade(wood, 1.1), WOOD);
  for (let k = 0; k < 7; k++) {
    mb.block(new Vec3(-5.92 - k * 0.58, 0.0, lay.BEDROOM[3] - 0.06), new Vec3(0.52, 2.3, 0.05), shade(wood, 0.75 + (k % 3) * 0.12), WOOD);
  }
}

/** Thùng rác lớn (chỗ vứt xác) và tháp radio có còi: vật tĩnh ngoài trời. */
function yard_stations(mb) {
  const green = hex(0x2f5a4a);
  for (const d of lay.DUMPSTERS) {
    mb.block(new Vec3(d.x - 0.95, 0.12, d.z - 0.55), new Vec3(1.9, 1.1, 1.1), green, CORRUGATED);
    mb.block(new Vec3(d.x - 1.0, 1.22, d.z - 0.6), new Vec3(2.0, 0.06, 0.7), shade(green, 0.7), METAL);
    mb.push(m4_mul(m4_translate(new Vec3(d.x, 1.3, d.z + 0.35)), m4_rot_x(-0.5)));
    mb.cube(ZERO, new Vec3(2.0, 0.05, 0.6), shade(green, 0.8), METAL);
    mb.pop();
    for (const dx of [-0.8, 0.8]) {
      mb.cyl(new Vec3(d.x + dx, 0.0, d.z + 0.4), 0.07, 0.07, 0.12, 6, hex(0x141516), FLAT);
      mb.cyl(new Vec3(d.x + dx, 0.0, d.z - 0.4), 0.07, 0.07, 0.12, 6, hex(0x141516), FLAT);
    }
  }
  const s = lay.SIREN;
  const steel = hex(0x6f747a);
  mb.block(new Vec3(s.x - 0.5, 0.0, s.z - 0.5), new Vec3(1.0, 0.25, 1.0), hex(0x8f9092), CONCRETE);
  for (const [dx, dz] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]]) {
    mb.tube(new Vec3(s.x + dx, 0.25, s.z + dz), new Vec3(s.x + dx * 0.25, 9.0, s.z + dz * 0.25), 0.035, 0.025, 5, steel, METAL);
  }
  for (let k = 1; k < 6; k++) {
    const y = k * 1.45;
    const h = 0.35 * (1.0 - y / 12.0);
    mb.cube(new Vec3(s.x, y, s.z), new Vec3(h * 2.0, 0.03, h * 2.0), steel, METAL);
  }
  mb.cyl(new Vec3(s.x, 9.0, s.z), 0.02, 0.01, 2.2, 5, steel, METAL);
  // [SUA] ban dinh thap giu cot thu loi, gia do coi, thanh ngang do hop dieu khien (truoc day ba thu nay lo lung).
  mb.cube(new Vec3(s.x, 9.0, s.z), new Vec3(0.26, 0.04, 0.26), steel, METAL);
  mb.cube(new Vec3(s.x, 6.2, s.z + 0.17), new Vec3(0.42, 0.05, 0.1), steel, METAL);
  mb.cube(new Vec3(s.x, 1.15, s.z + 0.335), new Vec3(0.74, 0.06, 0.09), steel, METAL);
  mb.push(m4_mul(m4_translate(new Vec3(s.x, 6.2, s.z + 0.2)), m4_rot_x(FRAC_PI_2)));
  mb.lathe(ZERO, [[0.06, 0.0], [0.1, 0.25], [0.32, 0.6]], 10, false, hex(0xb0342a), METAL);
  mb.pop();
  mb.block(new Vec3(s.x - 0.2, 0.9, s.z + 0.36), new Vec3(0.4, 0.5, 0.12), hex(0x30353a), METAL);
  mb.emi = 0.9;
  mb.cube(new Vec3(s.x, 1.25, s.z + 0.49), new Vec3(0.08, 0.08, 0.02), hex(0xd8342a), FLAT);
  mb.emi = 0.0;
}

function car(mb, pos, yaw, col, flipped) {
  models.truck(mb, pos, yaw, col, flipped);
}

function windows(mb, x0, x1, z, floors, name) {
  const r = Rng.named(name);
  const n = trunc((x1 - x0) / 2.6);
  for (let f = 0; f < floors; f++) {
    for (let k = 0; k < n; k++) {
      const x = x0 + 1.3 + k * 2.6;
      const lit = r.chance(0.12);
      mb.emi = lit ? 0.9 : 0.0;
      const col = lit ? hex(0xe8b96a) : hex(0x1c2733);
      mb.cube(new Vec3(x, 1.9 + f * 2.8, z), new Vec3(1.4, 1.5, 0.08), col, FLAT);
      mb.emi = 0.0;
      if (r.chance(0.3)) {
        mb.cube(new Vec3(x, 1.9 + f * 2.8, z - 0.05), new Vec3(1.5, 0.2, 0.05), hex(0x6b4f33), WOOD);
      }
    }
  }
}

function lamp_post(mb, x, z, toward) {
  const c = hex(0x3a3f42);
  mb.lathe(new Vec3(x, 0.0, z), [[0.0, 0.0], [0.2, 0.0], [0.2, 0.1], [0.12, 0.16], [0.1, 0.9], [0.075, 5.4], [0.085, 5.5], [0.07, 5.62], [0.0, 5.62]], 10, false, c, METAL);
  mb.block(new Vec3(x - 0.05, 5.55, Math.min(z, z + toward * 1.4)), new Vec3(0.1, 0.1, 1.4), c, METAL);
  mb.emi = 1.5;
  mb.cube(new Vec3(x, 5.5, z + toward * 1.25), new Vec3(0.3, 0.1, 0.5), hex(0xffe2a0), FLAT);
  mb.emi = 0.0;
}

function tree(mb, p, r) {
  models.tree(mb, p, r);
}

/** Hàng rào dây một đoạn thẳng: cột mỗi 2,5 m, 4 sợi dây võng, vài chỗ rách (dây đứt, cột nghiêng). */
function wire_fence(mb, a, b, r) {
  const post = hex(0x4a4f52);
  const wire = hex(0x8a8f94);
  const len = a.distance(b);
  const n = trunc(Math.max(Math.ceil(len / 2.5), 1.0));
  const dir = b.sub(a).div(len);
  let prev = null;
  for (let k = 0; k <= n; k++) {
    const p = a.add(dir.mul((len * k) / n));
    const lean = r.chance(0.15) ? r.range(-0.25, 0.25) : 0.0;
    mb.push(m4_mul(m4_mul(m4_translate(p), m4_rot_z(lean * dir.z)), m4_rot_x(-lean * dir.x)));
    mb.cyl(ZERO, 0.045, 0.04, 2.2, 6, post, METAL);
    mb.pop();
    if (prev !== null) {
      const q = prev[0];
      const broken = r.chance(0.18);
      for (const [h, sag] of [[0.35, 0.03], [0.9, 0.05], [1.45, 0.06], [2.0, 0.04]]) {
        if (broken && h > 0.8) {
          continue;
        }
        const mid = p.add(q).mul(0.5).add(Y.mul(h - sag));
        const d = p.sub(q);
        mb.push(m4_mul(m4_translate(mid), m4_rot_y(Math.atan2(-d.z, d.x))));
        mb.cube(ZERO, new Vec3(d.length(), 0.018, 0.018), wire, METAL);
        mb.pop();
      }
      // Lưới mắt cáo: hai dây chéo mỗi nhịp.
      if (!broken) {
        for (const [y0, y1] of [[0.35, 2.0], [2.0, 0.35]]) {
          const s = q.add(Y.mul(y0));
          const e = p.add(Y.mul(y1));
          mb.tube(s, e, 0.008, 0.008, 4, shade(wire, 0.8), METAL);
        }
      }
    }
    prev = [p, lean];
  }
}

/** Đồ đường phố: cột điện và dây, thùng phuy, lốp, đống gạch vụn, cọc tiêu, rào chắn bê tông, túi rác, trạm xe buýt. */
function street_dressing(mb) {
  const DZ = DZ_();
  const r = Rng.named('street');
  const wood = hex(0x4a3a2c);
  let prev = null;
  const pz = 12.6 + DZ;
  for (let k = 0; k < 8; k++) {
    const x = -84.0 + k * 24.0;
    const top = new Vec3(x, 7.6, pz);
    mb.cyl(new Vec3(x, 0.0, pz), 0.13, 0.09, 8.0, 6, wood, WOOD);
    mb.cube(new Vec3(x, 7.5, pz), new Vec3(0.1, 0.1, 1.8), wood, WOOD);
    mb.cube(new Vec3(x, 6.9, pz), new Vec3(0.1, 0.1, 1.2), wood, WOOD);
    if (prev !== null) {
      const p = prev;
      // Dây võng: 6 đoạn, hai dây.
      for (const dz of [-0.8, 0.8]) {
        for (let sgm = 0; sgm < 6; sgm++) {
          const t0 = sgm / 6.0;
          const t1 = (sgm + 1) / 6.0;
          const sag = (t) => 1.4 * 4.0 * t * (1.0 - t);
          const a = p.lerp(top, t0).sub(Y.mul(sag(t0))).add(Z.mul(dz));
          const b = p.lerp(top, t1).sub(Y.mul(sag(t1))).add(Z.mul(dz));
          const mid = a.add(b).mul(0.5);
          const d = b.sub(a);
          mb.push(m4_mul(m4_translate(mid), m4_rot_z(Math.atan(d.y / d.x))));
          mb.cube(ZERO, new Vec3(d.length(), 0.025, 0.025), hex(0x151515), FLAT);
          mb.pop();
        }
      }
    }
    prev = top;
  }
  // Thùng phuy: ba thùng trong bãi, bốn thùng bên đường.
  for (const [x, z, c] of [[10.6, 6.2, 0x7a3b2a], [11.3, 6.5, 0x3d5a78], [-10.6, 6.4, 0x55603a], [30.0, 13.4 + DZ, 0x7a3b2a], [-24.0, 22.6 + DZ, 0x3d5a78], [44.5, 13.6 + DZ, 0x55603a], [45.3, 13.2 + DZ, 0x7a3b2a]]) {
    mb.lathe(new Vec3(x, 0.0, z), [[0.0, 0.0], [0.28, 0.0], [0.29, 0.02], [0.29, 0.27], [0.3, 0.29], [0.29, 0.31], [0.29, 0.58], [0.3, 0.6], [0.29, 0.62], [0.29, 0.86], [0.28, 0.88], [0.26, 0.86], [0.0, 0.86]], 16, false, hex(c), METAL);
    mb.cyl(new Vec3(x, 0.28, z), 0.3, 0.3, 0.03, 10, hex(0x2a2a2a), METAL);
    mb.cyl(new Vec3(x, 0.6, z), 0.3, 0.3, 0.03, 10, hex(0x2a2a2a), METAL);
  }
  for (const [x, z, n] of [[12.4, 7.4, 3], [-12.6, 11.5, 2], [35.0, 22.4 + DZ, 4], [-33.0, 13.3 + DZ, 2]]) {
    for (let k = 0; k < n; k++) {
      mb.cyl(new Vec3(x + r.range(-0.05, 0.05), k * 0.2, z + r.range(-0.05, 0.05)), 0.33, 0.33, 0.2, 10, hex(0x141516), FLAT);
      mb.cyl(new Vec3(x, k * 0.2 + 0.19, z), 0.17, 0.17, 0.02, 8, hex(0x08090a), FLAT);
    }
  }
  for (const [x, z] of [[16.0, 15.0], [17.5, 16.2], [19.0, 17.6], [-9.0, 14.6], [-10.5, 15.8], [33.0, 14.8], [34.4, 16.0]]) {
    mb.cyl(new Vec3(x, 0.0, z), 0.16, 0.03, 0.55, 8, hex(0xd2571e), FLAT);
    mb.cyl(new Vec3(x, 0.2, z), 0.115, 0.085, 0.1, 8, hex(0xe8e4d8), FLAT);
    mb.cube(new Vec3(x, 0.015, z), new Vec3(0.36, 0.03, 0.36), hex(0xd2571e), FLAT);
  }
  for (const [x, z, yaw] of [[28.0, 15.2, 0.3], [29.0, 24.4, -0.2], [-25.0, 16.0, 1.3], [-27.0, 20.0, 1.5], [41.0, 17.5, 1.57]]) {
    mb.push_at(new Vec3(x, 0.0, z), yaw);
    mb.cube(new Vec3(0.0, 0.12, 0.0), new Vec3(2.2, 0.24, 0.6), hex(0x8f9092), CONCRETE);
    mb.cube(new Vec3(0.0, 0.5, 0.0), new Vec3(2.2, 0.55, 0.28), hex(0x8f9092), CONCRETE);
    mb.pop();
  }
  // Gạch vụn trong bãi, tránh lối vào cửa và quanh skip.
  const lot = lay.LOT;
  for (let it = 0; it < 9; it++) {
    const c = new Vec3(r.range(lot[0] + 1.0, lot[2] - 1.0), 0.0, r.range(6.5, lot[3] - 1.0));
    if ((Math.abs(c.x) < 4.0 && c.z < 14.0) || lay.inside([lay.SKIP_BOX[0] - 1.5, lay.SKIP_BOX[1] - 1.5, lay.SKIP_BOX[2] + 1.5, lay.SKIP_BOX[3] + 2.5], c)) {
      continue;
    }
    for (let j = 0; j < 9; j++) {
      const sz = new Vec3(r.range(0.12, 0.5), r.range(0.06, 0.28), r.range(0.12, 0.45));
      const p = c.add(new Vec3(r.range(-0.8, 0.8), sz.y * 0.5, r.range(-0.8, 0.8)));
      mb.cube_yaw(p, sz, r.range(0.0, 3.0), shade(hex(r.pick([0x7a6a5c, 0x6f4a3c, 0x8a8880, 0x5a564f])), r.range(0.6, 1.1)), r.chance(0.4) ? BRICK : CONCRETE);
    }
  }
  for (const [x, z] of [[-5.6, 9.2], [-5.4, 8.5], [-9.6, 9.8], [11.9, 5.9], [-15.4, 6.1], [-15.8, 6.8]]) {
    mb.cube_yaw(new Vec3(x, 0.2, z), new Vec3(0.5, 0.4, 0.45), r.range(0.0, 3.0), hex(0x16181a), FLAT);
    mb.cube(new Vec3(x, 0.43, z), new Vec3(0.14, 0.1, 0.14), hex(0x0e0f10), FLAT);
  }
  // Trạm xe buýt phía tây bên đường: mái tôn, ghế, bảng.
  const st = hex(0x4a5054);
  for (const x of [-29.5, -25.5]) {
    mb.cyl(new Vec3(x, 0.0, 12.75 + DZ), 0.05, 0.05, 2.5, 6, st, METAL);
  }
  mb.block(new Vec3(-29.8, 2.5, 12.2 + DZ), new Vec3(4.6, 0.08, 1.3), hex(0x5a646a), CORRUGATED);
  mb.block(new Vec3(-29.5, 0.0, 12.72 + DZ), new Vec3(4.0, 2.3, 0.05), hex(0x39454a), METAL);
  mb.block(new Vec3(-29.0, 0.42, 12.9 + DZ), new Vec3(3.0, 0.07, 0.4), hex(0x6a5236), WOOD);
  // [SUA] ghe co chan va tay do vao vach sau (truoc day mat ghe lo lung).
  for (const x of [-28.8, -27.53, -26.26]) {
    mb.block(new Vec3(x, 0.0, 12.95 + DZ), new Vec3(0.06, 0.42, 0.3), st, METAL);
    mb.block(new Vec3(x, 0.36, 12.74 + DZ), new Vec3(0.06, 0.06, 0.5), st, METAL);
  }
  // Trên mái quán: bồn nước, cục nóng, ống khói phòng ngủ; máng xối và hộp điện ở mặt tiền.
  mb.cyl(new Vec3(-3.2, 3.5, -2.5), 0.7, 0.7, 1.3, 12, hex(0x6e7478), CORRUGATED);
  mb.block(new Vec3(2.0, 3.5, -1.0), new Vec3(1.1, 0.7, 0.8), hex(0x7d8286), METAL);
  mb.cyl(new Vec3(lay.BED_LAMP.x - 0.2, 3.5, -3.5), 0.16, 0.16, 1.2, 8, hex(0x3a3d40), METAL);
  mb.cyl(new Vec3(-5.33, 0.0, 5.33), 0.05, 0.05, 3.2, 6, hex(0x4a4f52), METAL);
  mb.cyl(new Vec3(lay.MEDICAL[0] - 0.08, 0.0, 5.33), 0.05, 0.05, 3.2, 6, hex(0x4a4f52), METAL);
  mb.block(new Vec3(lay.MEDICAL[0] + 0.15, 0.3, 5.26), new Vec3(0.7, 0.9, 0.3), hex(0x70767a), METAL);
}

function build_exterior(mb) {
  const DZ = DZ_();
  const lot = lay.LOT;
  // Đất, sân bê tông quanh quán, bãi đỗ nhựa đường trong hàng rào, vỉa hè và đường lùi ra z 46..54.
  mb.floor_quad(new Vec3(0.0, -0.06, 0.0), 500.0, 500.0, hex(0x5a6142), GROUND);
  mb.block(new Vec3(lot[0], -0.1, 5.25), new Vec3(lot[2] - lot[0], 0.1, 7.75), hex(0x77787a), CONCRETE);
  mb.block(new Vec3(lot[0], -0.1, 13.0), new Vec3(lot[2] - lot[0], 0.1, lot[3] - 13.0), hex(0x4c4f52), ASPHALT);
  mb.block(new Vec3(lot[0], -0.1, lot[1]), new Vec3(lot[2] - lot[0], 0.08, 5.25 - lot[1]), hex(0x6a6862), CONCRETE);
  mb.block(new Vec3(-90.0, -0.1, 13.0 + DZ), new Vec3(180.0, 0.12, 1.0), hex(0x8a8b8a), CONCRETE);
  mb.block(new Vec3(-90.0, -0.1, 22.0 + DZ), new Vec3(180.0, 0.12, 4.0), hex(0x8a8b8a), CONCRETE);
  mb.block(new Vec3(-90.0, -0.12, lay.ROAD_Z0), new Vec3(180.0, 0.12, lay.ROAD_Z1 - lay.ROAD_Z0), hex(0x3a3d41), ASPHALT);
  const rc = (lay.ROAD_Z0 + lay.ROAD_Z1) * 0.5;
  let x = -88.0;
  while (x < 88.0) {
    mb.floor_quad(new Vec3(x, 0.004, rc), 2.2, 0.16, hex(0xb9a54c), FLAT);
    x += 5.0;
  }
  mb.floor_quad(new Vec3(0.0, 0.004, lay.ROAD_Z0 + 0.25), 176.0, 0.12, hex(0xa9a9a2), FLAT);
  mb.floor_quad(new Vec3(0.0, 0.004, lay.ROAD_Z1 - 0.25), 176.0, 0.12, hex(0xa9a9a2), FLAT);
  // Vạch ô đỗ trong bãi (gốc `Road_ParkingLines` z 19,8) và vạch dẫn từ cổng trước.
  for (let k = 0; k < 12; k++) {
    const x2 = -12.0 + k * 2.9;
    mb.floor_quad(new Vec3(x2, 0.004, lay.o(0.0, 19.8).z), 0.12, 4.6, hex(0xb5b5ad), FLAT);
  }
  // Vạch qua đường trước cổng bãi.
  const gx = lay.GATES[0][0].x;
  for (let k = 0; k < 6; k++) {
    mb.floor_quad(new Vec3(gx - 1.6 + k * 0.64, 0.005, rc), 0.36, 6.6, hex(0xa9a9a2), FLAT);
  }
  mb.bevel = 0.03;
  street_dressing(mb);
  dress.dressing(mb);
  for (const [lx, lz, t] of lay.LAMPS) {
    lamp_post(mb, lx, lz, t);
  }

  // Bệnh viện đối diện, hai dãy nhà hai bên (bên kia đường).
  mb.block(new Vec3(-16.0, 0.0, 26.0 + DZ), new Vec3(26.0, 9.0, 12.0), hex(0x9a9fa3), CONCRETE);
  windows(mb, -16.0, 10.0, 25.97 + DZ, 3, 'hospital');
  mb.block(new Vec3(-5.0, 0.0, 25.2 + DZ), new Vec3(4.0, 3.2, 0.8), hex(0x7d8286), CONCRETE);
  mb.push(m4_mul(m4_translate(new Vec3(-2.3, 6.9, 25.9 + DZ)), m4_rot_y(PI)));
  text3d(mb, '+', ZERO, 0.3, hex(0xd0342c), 1.0);
  mb.pop();
  mb.block(new Vec3(18.0, 0.0, 26.0 + DZ), new Vec3(12.0, 6.0, 10.0), hex(0x7c5142), BRICK);
  mb.block(new Vec3(18.0, 6.0, 26.0 + DZ), new Vec3(5.0, 2.2, 10.0), hex(0x7c5142), BRICK);
  windows(mb, 18.0, 30.0, 25.97 + DZ, 2, 'east');
  mb.block(new Vec3(-34.0, 0.0, 26.0 + DZ), new Vec3(12.0, 7.0, 10.0), hex(0x6f6a5c), PLASTER);
  windows(mb, -34.0, -22.0, 25.97 + DZ, 2, 'west');
  {
    const r = Rng.named('skyline');
    for (let k = 0; k < 14; k++) {
      const sx = -95.0 + k * 14.0 + r.range(-3.0, 3.0);
      const w = r.range(7.0, 12.0), h = r.range(5.0, 16.0);
      if (!(sx >= -36.0 && sx <= 31.0)) {
        mb.block(new Vec3(sx, 0.0, 27.0 + DZ + r.range(0.0, 4.0)), new Vec3(w, h, 9.0), shade(hex(0x6d6f72), r.range(0.7, 1.1)), CONCRETE);
      }
      mb.block(new Vec3(sx, 0.0, 46.0 + DZ + r.range(0.0, 10.0)), new Vec3(w, h + 6.0, 9.0), shade(hex(0x5d6064), r.range(0.7, 1.1)), CONCRETE);
      // Dãy nhà phía sau, sau hàng rào sau bãi.
      const zb = lot[1] - 12.0 + r.range(-4.0, 3.0);
      mb.block(new Vec3(sx, 0.0, zb), new Vec3(w, h * 0.7, 9.0), shade(hex(0x74685c), r.range(0.7, 1.1)), BRICK);
    }
  }

  // Xe hỏng (theo xe hỏng của bản gốc), skip, xe đẩy dưới chỗ lục "Trolley", pallet ở điểm giao hàng.
  for (const [p, yaw, col, flipped] of lay.CARS) {
    car(mb, p, yaw, col, flipped);
  }
  const green = hex(0x3f6b4f);
  const sk = lay.SKIP_BOX;
  const sw = sk[2] - sk[0], sd = sk[3] - sk[1];
  mb.block(new Vec3(sk[0], 0.0, sk[1]), new Vec3(sw, 0.1, sd), shade(green, 0.6), CORRUGATED);
  // Lớp xà bần cũ trong thùng: gạch vụn, ván gãy (rác ném vào nằm trên lớp này).
  {
    const bed = carry.BED;
    mb.block(new Vec3(sk[0] + 0.08, 0.1, sk[1] + 0.08), new Vec3(sw - 0.16, bed - 0.14, sd - 0.16), hex(0x4a443a), FLAT);
    const rr = new Rng(4711);
    for (let k = 0; k < 26; k++) {
      const s3 = new Vec3(rr.range(0.12, 0.42), rr.range(0.04, 0.12), rr.range(0.1, 0.3));
      const p = new Vec3(rr.range(sk[0] + 0.3, sk[2] - 0.3), bed - 0.05 + rr.range(-0.02, 0.03), rr.range(sk[1] + 0.25, sk[3] - 0.25));
      const col = rr.pick([0x6a6258, 0x7c5a48, 0x55504a, 0x8a7a5e, 0x5e4a36]);
      mb.cube_yaw(p, s3, rr.range(0.0, 3.0), hex(col), k % 3 === 0 ? WOOD : FLAT);
    }
  }
  mb.block(new Vec3(sk[0], 0.0, sk[1]), new Vec3(sw, 1.3, 0.08), green, CORRUGATED);
  mb.block(new Vec3(sk[0], 0.0, sk[3] - 0.08), new Vec3(sw, 1.3, 0.08), green, CORRUGATED);
  mb.block(new Vec3(sk[0], 0.0, sk[1]), new Vec3(0.08, 1.3, sd), green, CORRUGATED);
  mb.block(new Vec3(sk[2] - 0.08, 0.0, sk[1]), new Vec3(0.08, 1.3, sd), green, CORRUGATED);
  mb.block(new Vec3(sk[0] + 0.1, 0.1, sk[1] + 0.1), new Vec3(sw - 0.2, 0.5, sd - 0.2), hex(0x26282a), FLAT);
  const steel = hex(0x9aa0a6);
  const cx = lay.CACHE_TROLLEY.x - 0.5, cz = lay.CACHE_TROLLEY.z - 0.4;
  mb.block(new Vec3(cx, 0.35, cz), new Vec3(1.0, 0.04, 0.8), steel, METAL);
  for (const [dx, dz] of [[0.0, 0.0], [0.96, 0.0], [0.0, 0.76], [0.96, 0.76]]) {
    const tx = cx + dx, tz = cz + dz;
    mb.block(new Vec3(tx, 0.1, tz), new Vec3(0.04, 0.9, 0.04), steel, METAL);
    mb.cube(new Vec3(tx + 0.02, 0.06, tz + 0.02), new Vec3(0.1, 0.12, 0.1), hex(0x1c1c1c), FLAT);
  }
  for (const y of [0.6, 0.98]) {
    mb.block(new Vec3(cx, y, cz), new Vec3(1.0, 0.03, 0.03), steel, METAL);
    mb.block(new Vec3(cx, y, cz + 0.77), new Vec3(1.0, 0.03, 0.03), steel, METAL);
    mb.block(new Vec3(cx, y, cz), new Vec3(0.03, 0.03, 0.8), steel, METAL);
    mb.block(new Vec3(cx + 0.97, y, cz), new Vec3(0.03, 0.03, 0.8), steel, METAL);
  }
  const px = lay.DELIVERY.x - 0.6, pz = lay.DELIVERY.z - 0.5;
  for (let k = 0; k < 5; k++) {
    mb.block(new Vec3(px, 0.1, pz + k * 0.21), new Vec3(1.2, 0.03, 0.16), hex(0x8a6c48), WOOD);
  }
  mb.block(new Vec3(px, 0.0, pz + 0.05), new Vec3(1.2, 0.1, 0.1), hex(0x6a5236), WOOD);
  mb.block(new Vec3(px, 0.0, pz + 0.85), new Vec3(1.2, 0.1, 0.1), hex(0x6a5236), WOOD);

  // Hàng rào tôn sau bãi, hàng rào dây ba mặt còn lại (chừa cổng).
  {
    let fx0 = lot[0];
    const r = Rng.named('fence');
    while (fx0 < lot[2]) {
      mb.block(new Vec3(fx0, 0.0, lot[1] - 0.06), new Vec3(Math.min(1.96, lot[2] - fx0), r.range(1.8, 2.2), 0.06), shade(hex(0x6f7a80), r.range(0.75, 1.1)), CORRUGATED);
      mb.block(new Vec3(fx0 - 0.05, 0.0, lot[1] - 0.11), new Vec3(0.1, 2.3, 0.1), hex(0x3a3f42), METAL);
      fx0 += 2.0;
    }
  }
  {
    const r = Rng.named('wirefence');
    for (const f of lay.FENCE.slice(0, 6)) {
      let a, b;
      if (f[2] - f[0] > f[3] - f[1]) {
        const z = (f[1] + f[3]) * 0.5;
        a = new Vec3(f[0], 0.0, z); b = new Vec3(f[2], 0.0, z);
      } else {
        const fx = (f[0] + f[2]) * 0.5;
        a = new Vec3(fx, 0.0, f[1]); b = new Vec3(fx, 0.0, f[3]);
      }
      wire_fence(mb, a, b, r);
    }
  }
  // Rào chắn bê tông: rào đông chừa khe cho quân raid, chốt tây chặn đường; đèn đỏ ở hai mép khe, công-te-nơ phía sau.
  for (const [bx, segs, flip] of lay.BARRIERS) {
    for (const [z0, z1] of segs) {
      mb.block(new Vec3(bx - 0.6, 0.0, z0), new Vec3(1.2, 0.9, z1 - z0), hex(0x8f9092), CONCRETE);
      mb.block(new Vec3(bx - 0.05, 0.9, z0), new Vec3(0.1, 1.5, z1 - z0), hex(0x56606a), CORRUGATED);
    }
    mb.emi = 1.3;
    mb.cube(new Vec3(bx, 2.5, segs[0][1] - 0.1), new Vec3(0.18, 0.18, 0.18), hex(0xff3020), FLAT);
    mb.cube(new Vec3(bx, 2.5, segs[1][0] + 0.1), new Vec3(0.18, 0.18, 0.18), hex(0xff3020), FLAT);
    mb.emi = 0.0;
    mb.block(new Vec3(bx + flip * 3.0 - 1.4, 0.0, segs[1][1] - 3.5), new Vec3(2.8, 3.0, 9.0), hex(0x84783a), CORRUGATED);
  }
  // Cây sau hàng rào sau, cây hai bên xa, đồi xa, mảnh vụn trong bãi.
  const r = Rng.named('trees');
  for (let it = 0; it < 70; it++) {
    const p = new Vec3(r.range(-95.0, 95.0), 0.0, r.range(-60.0, lot[1] - 18.0));
    tree(mb, p, r);
  }
  for (let it = 0; it < 24; it++) {
    const side = r.chance(0.5) ? 1.0 : -1.0;
    const p = new Vec3(side * r.range(60.0, 95.0), 0.0, r.range(-12.0, 13.0 + DZ));
    tree(mb, p, r);
  }
  for (let k = 0; k < 18; k++) {
    const a = (k / 18.0) * TAU;
    const d = r.range(150.0, 200.0);
    mb.cyl(new Vec3(Math.cos(a) * d, -2.0, Math.sin(a) * d), r.range(40.0, 70.0), 2.0, r.range(18.0, 40.0), 7, hex(0x39453a), GROUND);
  }
  for (let it = 0; it < 50; it++) {
    const p = new Vec3(r.range(lot[0], lot[2]), 0.0, r.range(6.5, lot[3]));
    if (Math.abs(p.x) < 3.0 && p.z < 14.0) {
      continue;
    }
    const s = new Vec3(r.range(0.08, 0.4), r.range(0.03, 0.12), r.range(0.08, 0.4));
    mb.cube_yaw(p.add(Y.mul(s.y * 0.5)), s, r.range(0.0, 3.0), shade(hex(0x6b675f), r.range(0.5, 1.2)), FLAT);
  }
}

export function item_geo(mb, item, p, k) {
  models.item(mb, item, p, k);
}

function open_box(mb, w, h, d, col, pat) {
  const t = 0.025;
  mb.block(new Vec3(-w / 2.0, 0.0, -d / 2.0), new Vec3(w, t, d), shade(col, 0.8), pat);
  mb.block(new Vec3(-w / 2.0, 0.0, -d / 2.0), new Vec3(w, h, t), col, pat);
  mb.block(new Vec3(-w / 2.0, 0.0, d / 2.0 - t), new Vec3(w, h, t), col, pat);
  mb.block(new Vec3(-w / 2.0, 0.0, -d / 2.0), new Vec3(t, h, d), shade(col, 0.9), pat);
  mb.block(new Vec3(w / 2.0 - t, 0.0, -d / 2.0), new Vec3(t, h, d), shade(col, 0.9), pat);
}

export function prop_mesh(kind, id) {
  const mb = new MB();
  mb.bevel = 0.012;
  prop_geo(mb, kind, id);
  return mb.build();
}

/** Hình của một vật động trong khung của nó (dùng lại cho hình cầm tay và rác trong skip). */
export function prop_geo(mb, kind, id) {
  const r = new Rng(Math.imul(id, 2654435761) >>> 0);
  const card = hex(0xb08a55);
  switch (kind.k) {
    case 'Trash': {
      const v = kind.a;
      switch (v) {
        case 0: {
          // Túi rác đen buộc cổ, hơi méo theo từng túi.
          mb.push(m4_mul(m4_scale(new Vec3(r.range(0.92, 1.1), r.range(0.92, 1.06), r.range(0.9, 1.08))), m4_rot_y(r.range(0.0, 6.0))));
          const k = hex(0x1c1e21);
          mb.lathe(ZERO, [[0.0, 0.0], [0.11, 0.004], [0.185, 0.05], [0.205, 0.13], [0.19, 0.21], [0.13, 0.285], [0.055, 0.325], [0.034, 0.345], [0.05, 0.375], [0.075, 0.4], [0.0, 0.392]], 10, true, k, FLAT);
          for (let q = 0; q < 5; q++) {
            const a = q * 1.3 + r.range(0.0, 0.6);
            mb.ball(new Vec3(Math.cos(a) * 0.15, r.range(0.07, 0.2), Math.sin(a) * 0.15), new Vec3(0.07, 0.06, 0.07), 5, shade(k, 1.25), FLAT);
          }
          mb.cyl(new Vec3(0.0, 0.337, 0.0), 0.04, 0.04, 0.014, 8, hex(0xc9b458), FLAT);
          mb.pop();
          break;
        }
        case 1: {
          // Bó bìa các-tông ép dẹt buộc dây.
          for (let q = 0; q < 4; q++) {
            mb.cube_yaw(new Vec3(r.range(-0.02, 0.02), 0.02 + q * 0.033, r.range(-0.02, 0.02)), new Vec3(0.44 - q * 0.02, 0.03, 0.31), r.range(-0.08, 0.08), shade(hex(0xa08a62), 0.85 + 0.1 * q), CARDBOARD);
          }
          mb.cube(new Vec3(0.0, 0.07, 0.0), new Vec3(0.015, 0.15, 0.335), hex(0xd8d0b4), FLAT);
          mb.cube(new Vec3(0.0, 0.07, 0.0), new Vec3(0.47, 0.15, 0.015), hex(0xd8d0b4), FLAT);
          break;
        }
        default: {
          // Túi giấy rách lòi lon và hộp.
          mb.lathe(ZERO, [[0.0, 0.0], [0.13, 0.004], [0.15, 0.1], [0.14, 0.22], [0.155, 0.27], [0.12, 0.262], [0.0, 0.2]], 8, false, hex(0x8a7556), CARDBOARD);
          mb.cyl(new Vec3(0.04, 0.2, 0.02), 0.04, 0.04, 0.13, 8, hex(0x8f3a2e), METAL);
          mb.cube_yaw(new Vec3(-0.05, 0.25, -0.03), new Vec3(0.09, 0.14, 0.05), 0.5, hex(0x6f7f8a), CARDBOARD);
          mb.cyl(new Vec3(0.0, 0.29, 0.0), 0.03, 0.03, 0.05, 6, hex(0x3a3f44), FLAT);
        }
      }
      break;
    }
    case 'Pile': carry.pile_geo(mb, id, 0.0); break;
    case 'BoxPile': {
      // gấp dẹt, xếp chồng lệch nhau, một hộp dựng nghiêng trên cùng
      const r = new Rng(id * 7 + 3);
      for (let q = 0; q < 7; q++) {
        mb.cube_yaw(new Vec3(r.range(-0.03, 0.03), 0.012 + q * 0.024, r.range(-0.03, 0.03)), new Vec3(0.62, 0.022, 0.46), r.range(-0.12, 0.12), shade(card, 0.82 + 0.05 * (q % 3)), CARDBOARD);
      }
      mb.cube(new Vec3(0.0, 0.18, 0.0), new Vec3(0.012, 0.004, 0.47), hex(0xd8d0b4), FLAT);
      mb.push(m4_translate(new Vec3(0.02, 0.17, 0.0)));
      open_box(mb, 0.42, 0.22, 0.32, shade(card, 1.05), CARDBOARD);
      mb.pop();
      break;
    }
    case 'Item': item_geo(mb, kind.a, ZERO, 1.25); break;
    case 'Box': {
      const its = kind.a;
      open_box(mb, 0.52, 0.26, 0.38, card, CARDBOARD);
      mb.cube_yaw(new Vec3(-0.3, 0.2, 0.0), new Vec3(0.12, 0.02, 0.36), 0.0, shade(card, 1.1), CARDBOARD);
      its.forEach((it, k) => {
        const p = new Vec3(-0.18 + (k % 4) * 0.12, 0.03, -0.08 + trunc(k / 4) * 0.16);
        item_geo(mb, it, p, 0.95);
      });
      break;
    }
    case 'Hammer': {
      mb.push(m4_mul(m4_translate(Y.mul(0.03)), m4_rot_z(FRAC_PI_2)));
      hammer_geo(mb);
      mb.pop();
      break;
    }
    case 'Crate': {
      const w = hex(0x8a6c48);
      mb.cube(new Vec3(0.0, 0.3, 0.0), new Vec3(0.7, 0.6, 0.7), shade(w, 0.75), WOOD);
      for (let k = 0; k < 4; k++) {
        const o = -0.27 + k * 0.18;
        mb.cube(new Vec3(o, 0.3, 0.355), new Vec3(0.14, 0.62, 0.02), w, WOOD);
        mb.cube(new Vec3(o, 0.3, -0.355), new Vec3(0.14, 0.62, 0.02), w, WOOD);
        mb.cube(new Vec3(0.355, 0.3, o), new Vec3(0.02, 0.62, 0.14), w, WOOD);
        mb.cube(new Vec3(-0.355, 0.3, o), new Vec3(0.02, 0.62, 0.14), w, WOOD);
      }
      mb.cube(new Vec3(0.0, 0.61, 0.0), new Vec3(0.74, 0.03, 0.74), w, WOOD);
      mb.cube(new Vec3(0.0, 0.63, 0.0), new Vec3(0.3, 0.005, 0.2), hex(0xd8d2bc), FLAT);
      break;
    }
    case 'Reward': {
      const g = hex(0x4a5a3a);
      mb.cube(new Vec3(0.0, 0.3, 0.0), new Vec3(0.9, 0.6, 0.6), g, METAL);
      mb.cube(new Vec3(0.0, 0.3, 0.0), new Vec3(0.92, 0.08, 0.62), hex(0x2c3524), METAL);
      mb.emi = 0.8;
      mb.cube(new Vec3(0.0, 0.64, 0.0), new Vec3(0.12, 0.08, 0.12), hex(0xff8a20), FLAT);
      mb.emi = 0.0;
      break;
    }
    case 'Wire': {
      const st = hex(0x8a8f94);
      for (const x of [-0.9, 0.0, 0.9]) {
        mb.push(m4_mul(m4_translate(new Vec3(x, 0.45, 0.0)), m4_rot_x(0.6)));
        mb.cube(ZERO, new Vec3(0.06, 1.1, 0.06), hex(0x5a4632), WOOD);
        mb.pop();
        mb.push(m4_mul(m4_translate(new Vec3(x, 0.45, 0.0)), m4_rot_x(-0.6)));
        mb.cube(ZERO, new Vec3(0.06, 1.1, 0.06), hex(0x5a4632), WOOD);
        mb.pop();
      }
      for (const [y, z] of [[0.25, 0.25], [0.25, -0.25], [0.6, 0.0], [0.85, 0.28], [0.85, -0.28], [0.45, 0.12], [0.45, -0.12]]) {
        mb.cube(new Vec3(0.0, y, z), new Vec3(2.0, 0.015, 0.015), st, METAL);
        for (let k = 0; k < 10; k++) {
          mb.cube_yaw(new Vec3(-0.9 + k * 0.2, y, z), new Vec3(0.05, 0.05, 0.012), 0.8, st, METAL);
        }
      }
      break;
    }
    case 'Corpse': models.corpse(mb, Math.imul(id, 977) >>> 0, kind.a); break;
    case 'Placed': {
      mb.bevel = 0.0;
      models.placed(mb, kind.a);
      break;
    }
    case 'Cache': {
      // js/plug/loot.js draws the real containers (lid, goods, loot burst); these boxes stay as the ?noplug=loot fallback.
      if (globalThis.__twtLootView) break;
      const name = kind.a, searched = kind.c;
      const dim = searched ? 0.6 : 1.0;
      switch (name) {
        case 'Duffle bag':
          mb.cube(new Vec3(0.0, 0.16, 0.0), new Vec3(0.75, 0.3, 0.34), shade(hex(0x5c6b3c), dim), FLAT);
          mb.cube(new Vec3(0.0, 0.33, 0.0), new Vec3(0.5, 0.04, 0.06), hex(0x2a2f1c), FLAT);
          break;
        case 'Trolley':
          mb.cube(new Vec3(0.0, 0.52, 0.0), new Vec3(0.7, 0.28, 0.5), shade(hex(0xb08a55), dim), CARDBOARD);
          break;
        case 'Toolbox':
          mb.cube(new Vec3(0.0, 0.15, 0.0), new Vec3(0.6, 0.3, 0.3), shade(hex(0xb0342a), dim), METAL);
          mb.cube(new Vec3(0.0, 0.33, 0.0), new Vec3(0.3, 0.05, 0.05), hex(0x202020), METAL);
          break;
        case 'Bin':
          mb.cyl(ZERO, 0.3, 0.34, 0.8, 8, shade(hex(0x5f666c), dim), CORRUGATED);
          break;
        case 'Medical bag':
          mb.cube(new Vec3(0.0, 0.17, 0.0), new Vec3(0.55, 0.34, 0.3), shade(hex(0xe2ded2), dim), FLAT);
          mb.cube(new Vec3(0.0, 0.2, 0.152), new Vec3(0.2, 0.06, 0.01), hex(0xc0342c), FLAT);
          mb.cube(new Vec3(0.0, 0.2, 0.152), new Vec3(0.06, 0.2, 0.01), hex(0xc0342c), FLAT);
          break;
        case 'Suitcase':
          mb.cube(new Vec3(0.0, 0.25, 0.0), new Vec3(0.7, 0.5, 0.24), shade(hex(0x6e4a2c), dim), FLAT);
          mb.cube(new Vec3(0.0, 0.53, 0.0), new Vec3(0.2, 0.05, 0.04), hex(0x2a2a2a), FLAT);
          break;
        case 'Glovebox':
          mb.cube(new Vec3(0.0, 0.14, 0.0), new Vec3(0.5, 0.28, 0.36), shade(hex(0x39424d), dim), FLAT);
          break;
        default:
          mb.cube(new Vec3(0.0, 0.3, 0.0), new Vec3(0.8, 0.6, 0.6), shade(hex(0x8a6c48), dim), WOOD);
          mb.cube(new Vec3(0.0, 0.61, 0.0), new Vec3(0.84, 0.03, 0.64), shade(hex(0x6a5236), dim), WOOD);
      }
      break;
    }
  }
}

export function hammer_geo(mb) {
  models.weapon(mb, false, false);
}

export function bat_geo(mb) {
  models.weapon(mb, true, false);
}

/** One battery standing at `p` (base): casing in the colour / size of its denomination (models.BATTERY_LOOK), a light
 *  emissive strip so it reads in the dim shop, metal top terminal, and after testing a bright ring on top: green real,
 *  red fake (`tell` 0 untested, 1 real, 2 fake). Shared with plug/till.js (tester, drawers). */
export function battery_geo(mb, p, value, tell) {
  const L = models.battery_look(value);
  const r = L.r * 1.5, h = L.h * 1.2;
  const old = mb.emi;
  mb.cyl(p, r, r, h, 12, hex(L.col), METAL);
  mb.cyl(p, r * 1.02, r * 1.02, h * 0.12, 12, hex(0x1e2124), METAL);
  mb.emi = 0.7;
  mb.cyl(p.add(Y.mul(h * 0.55)), r * 1.03, r * 1.03, h * 0.1, 12, shade(hex(L.col), 1.35), FLAT);
  mb.emi = 0.0;
  mb.cyl(p.add(Y.mul(h)), r * 0.45, r * 0.45, 0.01, 8, hex(0xd0d4d8), METAL);
  if (value >= 1000) mb.cyl(p.add(Y.mul(h * 0.2)), r * 1.04, r * 1.04, h * 0.08, 12, hex(0x1e2124), METAL);
  if (tell !== 0) {
    mb.emi = 1.6;
    mb.cyl(p.add(Y.mul(h * 0.86)), r * 1.06, r * 1.06, h * 0.12, 12, tell === 2 ? hex(0xff3a2a) : hex(0x3aff6a), FLAT);
  }
  mb.emi = old;
}

/** Where unit `k` of slot `s` stands on shelf `sh` (world point handed to item_geo) and its scale. The view's flying-can
 *  animation (plug/stock.js) lands each can on exactly this spot. */
export function shelf_unit_pos(sh, s, k) {
  const p = sh.slot_pos(s).clone();
  p.y -= 0.05;
  if (G.stack_max() <= 1) return [p, 1.7];
  // [ĐỀ XUẤT] Ô chồng nhiều món lẻ (G.case_units): xếp thành hàng 4 món dọc kệ, hàng trước đầy trước rồi lùi vào trong;
  // mọi món đứng thẳng trên mặt ván (không chồng lơ lửng).
  const per = 4, rows = Math.max(1, Math.ceil(G.stack_max() / per));
  const dz = rows > 1 ? Math.min(0.2, 0.4 / (rows - 1)) : 0.0;
  const col = k % per, row = Math.trunc(k / per);
  const lx = (col - 1.5) * 0.14 + (row % 2) * 0.02;
  const lz = (rows - 1) * dz * 0.5 - row * dz;
  return [p.add(rot_y(sh.yaw, new Vec3(lx, 0.0, lz))), 1.25];
}

function shelf_mesh(sh) {
  const mb = new MB();
  // View only: units still flying onto the shelf (plug/stock.js) are not drawn until they land.
  const hide = globalThis.__twtShelfHide;
  for (let s = 0; s < sh.slots.length; s++) {
    const it = sh.slots[s];
    if (it !== null) {
      const n = Math.max(0, sh.units(s) - (hide ? hide(sh, s) : 0));
      for (let k = 0; k < n; k++) {
        const [p, sc] = shelf_unit_pos(sh, s, k);
        item_geo(mb, it, p, sc);
      }
    }
  }
  if (mb.is_empty()) {
    mb.cube(new Vec3(0.0, -5.0, 0.0), new Vec3(0.01, 0.01, 0.01), [0.0, 0.0, 0.0], FLAT);
  }
  return mb.build();
}

/** Các hình động do `sync_world` quản: vỏ quán (dựng lại khi mở phòng / sơn / nâng cấp), xe thương nhân, xe Dr. Gib,
 *  bánh xe quay, bóng vật đang đặt, pin trên quầy, hình tức thời (vệt đạn, lửa, mồi nhử).
 *  (Bevy Resource; các trường Entity giữ node của scene.js. `ext`, `dome` thêm vào để view tìm được node tĩnh.) */
export const WorldEnts = {
  shop: null,
  glass: null,
  trucks: [null, null],
  wheel: null,
  ghost: null,
  coins: null,
  dynv: null,
  sig: 0n,
  shown: [false, false],
  ghost_key: 0,
  pay_rev: 0,
  dyn_used: false,
  ext: null,
  dome: null,
  /** Đồng hồ thay `time.elapsed_secs()` khi ctx không có `elapsed`. */
  tm: 0,
};
/** Query<.., With<SkyDome>>: node vòm trời (mat.js dời nó theo camera). */
export const SkyDome = [];
/** Query<(&mut Transform, &DoorLeaf)>: { node, side } — side = DoorLeaf.0 (1 cánh phải bản lề x=+1, -1 cánh trái). */
export const DoorLeaf = [];
/** Query<.., With<BedDoor>>: node cửa phòng ngủ. */
export const BedDoor = [];
/** Query<(&mut Visibility, &OpenSign)>: { node, open } — open = OpenSign.0. */
export const OpenSign = [];

/** Chữ ký của mọi thứ làm đổi hình vỏ quán (u64 -> BigInt). */
function shop_sig(g) {
  const b = g.bld;
  const B = (v) => BigInt(v);
  let s = B(b.rooms) | (B(b.wh_open ? 1 : 0) << 2n) | (B(b.med_open ? 1 : 0) << 3n) | (B(b.gen_fixed ? 1 : 0) << 4n) | (B(b.helper.freed ? 1 : 0) << 5n);
  b.paint.forEach((p, k) => {
    s |= B(p) << B(8 + k * 6);
  });
  b.tiers.forEach((t, k) => {
    s |= (B(t) & 3n) << B(44 + k * 2);
  });
  return s;
}

function hidden_mesh() {
  const mb = new MB();
  mb.cube(new Vec3(0.0, -5.0, 0.0), new Vec3(0.01, 0.01, 0.01), [0.0, 0.0, 0.0], FLAT);
  return mb.build();
}

/** Startup. ctx.quality = { tier } (mat::Quality). */
export function setup_world(g, ctx = {}) {
  const game = g;
  set_lod(ctx.quality && ctx.quality.tier !== undefined ? ctx.quality.tier : 2);
  SkyDome.length = 0; DoorLeaf.length = 0; BedDoor.length = 0; OpenSign.length = 0;
  const shop = new MB();
  const glass = new MB();
  build_shop(shop, glass, game);
  const shop_e = scene.spawn(shop.build(), 'solid', { no_cull: true, name: 'shop' });
  const glass_e = scene.spawn(glass.build(), 'blend', { name: 'glass' });
  const ext = new MB();
  build_exterior(ext);
  yard_stations(ext);
  WorldEnts.ext = scene.spawn(ext.build(), 'solid', { no_cull: true, name: 'exterior' });
  const dome = new MB();
  dome.dome(420.0);
  WorldEnts.dome = scene.spawn(dome.build(), 'solid', { no_cull: true, name: 'sky_dome' });
  SkyDome.push(WorldEnts.dome);

  // Hai cánh cửa trước (bản lề ở x = ±1), mở vào trong.
  for (const side of [1.0, -1.0]) {
    const mb = new MB();
    const wood = hex(0x6a5038);
    mb.block(new Vec3(side > 0.0 ? 0.0 : -0.98, 0.02, -0.03), new Vec3(0.98, 2.26, 0.06), wood, WOOD);
    for (let k = 0; k < 3; k++) {
      mb.push(m4_mul(m4_translate(new Vec3(side * 0.49, 0.6 + k * 0.6, 0.05)), m4_rot_z(side * 0.1 * (k - 1.0))));
      mb.cube(ZERO, new Vec3(0.94, 0.14, 0.03), shade(wood, 1.25), WOOD);
      mb.pop();
    }
    for (const zz of [-0.07, 0.07]) {
      mb.sweep([new Vec3(side * 0.86, 0.95, zz * 0.45), new Vec3(side * 0.86, 0.97, zz), new Vec3(side * 0.86, 1.15, zz), new Vec3(side * 0.86, 1.17, zz * 0.45)], 0.012, 6, hex(0x9a9a9a), METAL);
    }
    for (const [hx, hy] of [[0.06, 0.3], [0.06, 1.9], [0.92, 0.3], [0.92, 1.9]]) {
      mb.tube(new Vec3(side * hx, hy, 0.03), new Vec3(side * hx, hy, 0.045), 0.012, 0.012, 6, hex(0x8a8f94), METAL);
    }
    const node = scene.spawn(mb.build(), 'solid', { pos: lay.DOOR.sub(X.mul(side)), name: 'door_leaf' });
    DoorLeaf.push({ node, side });
  }
  // Cửa phòng ngủ bị kẹt (đập búa để mở); ván đóng chéo nằm ở mặt phía quán, cửa mở vào phòng ngủ.
  {
    const mb = new MB();
    const wood = hex(0x5d4a36);
    const shop_side = -lay.BED_DOOR_SWING;
    mb.block(new Vec3(-0.03, 0.02, 0.0), new Vec3(0.06, 2.16, lay.BED_DOOR_BOX[3] - lay.BED_DOOR_BOX[1]), wood, WOOD);
    for (let k = 0; k < 2; k++) {
      mb.push(m4_mul(m4_translate(new Vec3(0.05 * shop_side, 0.8 + k * 0.7, 0.6)), m4_rot_x(0.12 - k * 0.25)));
      mb.cube(ZERO, new Vec3(0.03, 0.15, 1.5), shade(wood, 1.3), WOOD);
      mb.pop();
    }
    BedDoor.push(scene.spawn(mb.build(), 'solid', { pos: lay.BED_DOOR_HINGE, name: 'bed_door' }));
  }
  // Biển OPEN / CLOSED treo cạnh cửa ngoài.
  for (const open of [true, false]) {
    const mb = new MB();
    const mn = lay.SWITCH_BOXES[1][0];
    mb.block(new Vec3(mn.x, 1.45, mn.z + 0.01), new Vec3(1.0, 0.36, 0.04), open ? hex(0x1f5a32) : hex(0x6a1f1c), METAL);
    const s = open ? 'OPEN' : 'CLOSED';
    const px = open ? 0.036 : 0.026;
    text3d(mb, s, new Vec3(mn.x + 0.08, 1.52, mn.z + 0.05), px, hex(0xf4f0e0), 0.9);
    OpenSign.push({ node: scene.spawn(mb.build(), 'solid', { name: open ? 'sign_open' : 'sign_closed' }), open });
  }
  // Xe thương nhân (bên đường, có sạp hàng) và xe Dr. Gib (sau quán, có bánh xe quay): ẩn cho tới khi họ tới.
  let merchant;
  {
    const mb = new MB();
    const m = lay.MERCHANT;
    models.truck(mb, m, 0.0, 0x7a6a3a, false);
    mb.block(new Vec3(m.x - 1.6, 0.0, m.z - 2.0), new Vec3(3.2, 0.8, 0.7), hex(0x7a5a3a), WOOD);
    mb.block(new Vec3(m.x - 1.8, 2.3, m.z - 2.3), new Vec3(3.6, 0.06, 1.6), hex(0xb0452a), STRIPES);
    for (const dx of [-1.75, 1.75]) {
      mb.cyl(new Vec3(m.x + dx, 0.0, m.z - 2.2), 0.03, 0.03, 2.3, 5, hex(0x3a3f42), METAL);
    }
    const goods = [G.GRENADE, G.FIRSTAID, G.CROWBAR, G.AK47, G.GAS_CAN, G.UZI];
    for (let k = 0; k < 6; k++) {
      item_geo(mb, goods[k], new Vec3(m.x - 1.3 + k * 0.52, 0.8, m.z - 1.65), 1.6);
    }
    merchant = scene.spawn(mb.build(), 'solid', { visible: false, name: 'merchant_truck' });
  }
  let gib;
  const gp = lay.GIB;
  {
    const mb = new MB();
    models.truck(mb, gp, 0.0, 0xd8d4c4, false);
    mb.block(new Vec3(gp.x - 0.06, 0.0, gp.z + 1.2), new Vec3(0.12, 1.75, 0.12), hex(0x3a3f42), METAL);
    mb.block(new Vec3(gp.x - 1.5, 2.45, gp.z + 1.02), new Vec3(3.0, 0.4, 0.08), hex(0x2c3338), METAL);
    mb.emi = 0.9;
    for (let k = 0; k < 7; k++) {
      mb.cube(new Vec3(gp.x - 1.2 + k * 0.4, 2.65, gp.z + 1.12), new Vec3(0.07, 0.07, 0.07), hex(k % 2 === 0 ? 0xf2c14e : 0xd8342a), FLAT);
    }
    mb.cube(new Vec3(gp.x, 2.48, gp.z + 1.33), new Vec3(0.06, 0.16, 0.03), hex(0xf4f0e0), FLAT);
    mb.emi = 0.0;
    gib = scene.spawn(mb.build(), 'solid', { visible: false, name: 'gib_truck' });
  }
  let wheel;
  {
    const mb = new MB();
    for (let k = 0; k < 16; k++) {
      const cols = [0xd8342a, 0xf2c14e, 0x3a8a86, 0x6a4a8a];
      mb.push(m4_rot_z((k / 16.0) * TAU));
      mb.cube(new Vec3(0.0, 0.42, 0.0), new Vec3(0.2, 0.55, 0.04), hex(cols[k % 4]), FLAT);
      mb.cube(new Vec3(0.0, 0.2, 0.0), new Vec3(0.09, 0.3, 0.04), hex(cols[(k + 2) % 4]), FLAT);
      mb.pop();
    }
    mb.cube(ZERO, new Vec3(0.16, 0.16, 0.08), hex(0x30353a), METAL);
    wheel = scene.spawn(mb.build(), 'solid', { pos: gp.add(new Vec3(0.0, 1.65, 1.3)), visible: false, name: 'gib_wheel' });
  }
  const hid = (name) => scene.spawn(hidden_mesh(), 'solid', { no_cull: true, name });
  const ghost = hid('ghost'), coins = hid('coins'), dynv = hid('dynamic');
  Object.assign(WorldEnts, { shop: shop_e, glass: glass_e, trucks: [merchant, gib], wheel, ghost, coins, dynv, sig: shop_sig(game), shown: [false, false], ghost_key: 0, pay_rev: 0, dyn_used: false });
}

/** Đồng bộ hình của cửa, biển, kệ và các vật động với trạng thái game.
 *  ctx.cam = { pos: Vec3, ... } (camera hiện tại, có thể thiếu), ctx.elapsed = time.elapsed_secs() (có thể thiếu). */
export function sync_world(g, dt, ctx = {}) {
  const we = WorldEnts;
  we.tm += dt;
  const target = g.door.open || g.door.hp <= 0.0 ? 1.0 : 0.0;
  g.door.t += clamp(target - g.door.t, -dt * 2.5, dt * 2.5);
  const broken = g.door.hp <= 0.0;
  for (const { node, side } of DoorLeaf) {
    const ang = g.door.t * 1.75;
    node.set_quat(q_mul(q_y(side * ang), broken ? q_z(side * 0.12) : Q_ID));
  }
  for (const node of BedDoor) {
    const open = g.bed_door_hits >= 3 ? 1.0 : 0.0;
    const cur = q_to_euler_yxz(node.quat)[0];
    const goal = (open * 1.8 + Math.min(g.bed_door_hits, 2) * 0.04) * lay.BED_DOOR_SWING;
    node.set_quat(q_y(cur + clamp(goal - cur, -dt * 3.0, dt * 3.0)));
  }
  for (const { node, open } of OpenSign) {
    node.set_visible(open === g.open);
  }
  // Vỏ quán: dựng lại khi phòng / cửa / sơn / bậc nâng cấp đổi.
  if (g.bld.dirty) {
    build.refresh(g);
    g.bld.dirty = false;
  }
  const sig = shop_sig(g);
  if (sig !== we.sig) {
    we.sig = sig;
    const shop = new MB();
    const glass = new MB();
    build_shop(shop, glass, g);
    we.shop.set_mesh(shop.build());
    we.glass.set_mesh(glass.build());
  }
  // Kệ: mỗi kệ một hình hàng hoá; kệ đã gỡ thì xoá hình.
  for (const e of g.cb.orphans.splice(0)) {
    if (e !== null && e !== undefined) e.despawn();
  }
  for (const sh of g.shelves) {
    if (sh.dirty || sh.ent === null) {
      const mesh = shelf_mesh(sh);
      if (sh.ent !== null) {
        sh.ent.set_mesh(mesh);
      } else {
        sh.ent = scene.spawn(mesh, 'solid', { name: 'shelf_goods' });
      }
      sh.dirty = false;
    }
  }
  // Xe thương nhân, xe Dr. Gib và bánh xe quay.
  const want = [g.ev.merchant_here, g.ev.gib_here];
  for (let k = 0; k < 2; k++) {
    if (want[k] !== we.shown[k]) {
      we.shown[k] = want[k];
      we.trucks[k].set_visible(want[k]);
      if (k === 1) {
        we.wheel.set_visible(want[k]);
      }
    }
  }
  if (g.ev.gib_here && g.ev.spin_t > 0.0) {
    const a = ((g.ev.spin_to + g.ev.spin_t * g.ev.spin_t * 3.0) / 16.0) * TAU;
    we.wheel.set_tr({ pos: lay.GIB.add(new Vec3(0.0, 1.65, 1.3)), quat: q_z(a), scale: 1 });
  }
  // Bóng của vật đang đặt: hình thật của món + khung sàn xanh (đặt được) hoặc đỏ.
  const key = g.bld.ghost !== null ? 1 + g.bld.ghost[0] * 2 + (g.bld.ghost_ok ? 1 : 0) : 0;
  if (key !== we.ghost_key) {
    we.ghost_key = key;
    let mesh;
    if (g.bld.ghost !== null) {
      const item = g.bld.ghost[0];
      const mb = new MB();
      if (item === G.BARBED) {
        mb.cube(new Vec3(0.0, 0.45, 0.0), new Vec3(2.0, 0.9, 0.5), hex(0x8a8f94), METAL);
      } else {
        models.placed(mb, item);
      }
      const [hx, hz] = build.footprint(item);
      mb.emi = 1.2;
      const c = g.bld.ghost_ok ? hex(0x3ad06a) : hex(0xd8342a);
      for (const [x, z, sx, sz] of [[0.0, hz, hx * 2.0, 0.04], [0.0, -hz, hx * 2.0, 0.04], [hx, 0.0, 0.04, hz * 2.0], [-hx, 0.0, 0.04, hz * 2.0]]) {
        mb.cube(new Vec3(x, 0.03, z), new Vec3(sx, 0.03, sz), c, FLAT);
      }
      mb.cube(new Vec3(0.0, 0.05, hz + 0.15), new Vec3(0.12, 0.03, 0.2), c, FLAT);
      mb.emi = 0.0;
      mesh = mb.build();
    } else {
      mesh = hidden_mesh();
    }
    we.ghost.set_mesh(mesh);
  }
  if (g.bld.ghost !== null) {
    const yaw = g.bld.ghost[1];
    we.ghost.set_tr({ pos: g.bld.ghost_pos, quat: q_y(yaw), scale: 1 });
  }
  // Pin khách đặt trên quầy: chưa soi thì xám, soi rồi thì nắp xanh (thật) hoặc đỏ (giả).
  if (g.pay_rev !== we.pay_rev) {
    we.pay_rev = g.pay_rev;
    const mb = new MB();
    if (g.pay !== null) {
      g.pay.coins.forEach((c, i) => {
        if (c.done !== 0) {
          return;
        }
        if (globalThis.__twtCoinHide && globalThis.__twtCoinHide(i)) return;
        battery_geo(mb, player.coin_pos(i), c.value, c.checked ? (c.fake ? 2 : 1) : 0);
      });
    }
    if (mb.is_empty()) {
      mb.cube(new Vec3(0.0, -5.0, 0.0), new Vec3(0.01, 0.01, 0.01), [0.0, 0.0, 0.0], FLAT);
    }
    we.coins.set_mesh(mb.build());
  }
  // Hình tức thời: vệt đạn, vùng cháy, mồi nhử. Dựng lại mỗi khung hình khi có, bỏ khi hết.
  const studio = g.zoo && g.zoo_kind.length > 0;
  const any = studio || g.cb.tracers.length > 0 || g.cb.fires.length > 0 || g.cb.lure !== null || g.fx2.busy();
  if (any || we.dyn_used) {
    const mb = new MB();
    const tm = ctx.elapsed !== undefined ? ctx.elapsed : we.tm;
    mb.emi = 2.0;
    for (const [a, b] of g.cb.tracers) {
      mb.tube(a, b, 0.012, 0.008, 4, hex(0xffe08a), FLAT);
    }
    g.cb.fires.forEach(([c, r, left], k) => {
      const fade = clamp(left / 1.5, 0.2, 1.0);
      for (let j = 0; j < 9; j++) {
        const a = j * 2.4 + k;
        const d = r * (0.2 + 0.09 * j);
        const fl = 0.6 + 0.4 * Math.sin(tm * (7.0 + j) + a);
        const p = c.add(new Vec3(Math.cos(a) * d, 0.0, Math.sin(a) * d));
        mb.lathe(p, [[0.22 * fade, 0.0], [0.16 * fade, 0.25 * fl], [0.0, (0.6 + 0.5 * fl) * fade]], 5, false, hex(j % 2 === 0 ? 0xff8a20 : 0xffc040), FLAT);
      }
    });
    if (g.cb.lure !== null) {
      const p = g.cb.lure[0];
      const s = 0.12 + 0.04 * Math.sin(tm * 9.0);
      mb.ball(p.add(Y.mul(0.25)), new Vec3(s, s, s), 6, hex(0xff5040), FLAT);
    }
    mb.emi = 0.0;
    // Đầu đạn bay, vỏ đạn, tên lửa, vết trên đất, vòng sóng xung kích, chớp lửa đầu nòng.
    fp.draw(g.fx2, mb, tm);
    if (studio) {
      // Phông xám của hàng trưng bày (?zoo=people|zombies|turn).
      for (let row = 0; row < 2; row++) {
        const z = lay.ZOO_Z + 2.6 + row * 7.0;
        mb.block(new Vec3(-5.6, 0.0, z - 1.4), new Vec3(11.2, 3.0, 0.1), hex(0x8f8f8a), FLAT);
        mb.block(new Vec3(-5.6, 0.0, z - 1.4), new Vec3(11.2, 0.03, 3.4), hex(0x77776f), FLAT);
      }
    }
    we.dyn_used = !mb.is_empty();
    if (mb.is_empty()) {
      mb.cube(new Vec3(0.0, -5.0, 0.0), new Vec3(0.01, 0.01, 0.01), [0.0, 0.0, 0.0], FLAT);
    }
    we.dynv.set_mesh(mb.build());
  }
  // Vật động: sinh hình khi mới có, dựng lại khi đổi, xoá khi chết; vật đang cầm đi theo camera.
  const held = g.held;
  const cam_t = ctx.cam && ctx.cam.pos ? ctx.cam : null;
  let k = 0;
  while (k < g.props.length) {
    if (g.props[k].dead) {
      const e = g.props[k].ent;
      if (e !== null) {
        e.despawn();
      }
      g.props.splice(k, 1);
      continue;
    }
    const p = g.props[k];
    const tr = { pos: p.pos.clone(), quat: q_y(p.yaw), scale: 1 };
    if (held === p.id) {
      if (cam_t !== null) {
        if (p.kind.k !== 'Corpse') {
          // Rác và hộp đang cầm nằm trong hình cầm tay (carry.rs); xác kéo lê do ragdoll đặt.
          tr.pos = new Vec3(cam_t.pos.x, -50.0, cam_t.pos.z);
        }
      }
    }
    // View only (plug/loot.js): a dropped loot item still flying out of the corpse / container.
    const vf = globalThis.__twtPropFly;
    if (vf) {
      const o = vf(p.id);
      if (o) {
        tr.pos = o[0];
        tr.quat = o[1];
      }
    }
    const fl = carry.flying(g.cy, p.id);
    if (fl !== null) {
      tr.pos = fl[0].clone();
      tr.quat = fl[1].slice();
    }
    if (carry.live(g.cy, p.id)) {
      p.dirty = true;
    }
    if (p.ent === null) {
      const cm = carry.prop_mesh(g.cy, p);
      const mesh = cm !== null ? cm : prop_mesh(p.kind, p.id);
      p.ent = scene.spawn(mesh, 'solid', { pos: tr.pos, quat: tr.quat, scale: 1, name: 'prop', prop: p.kind.k });
      p.dirty = false;
    } else {
      const e = p.ent;
      if (p.dirty) {
        const cm = carry.prop_mesh(g.cy, p);
        e.set_mesh(cm !== null ? cm : prop_mesh(p.kind, p.id));
        p.dirty = false;
      }
      e.set_tr(tr);
    }
    k += 1;
  }
}

/** Dựng và đặt hình đội phá tường và Hulk Helper (thân zombie Hulk, đứng xích trong phòng y tế cho tới khi được thả). */
export function sync_build_actors(g, dt, ctx = {}) {
  const pose = (b, pos, yaw, moving, phase, swing, lean, show) => {
    // Rust posed a Bevy body here (see VIEW NOTES "people descriptor"); the derived numbers are passed along too.
    const sw = moving ? Math.sin(phase) * 0.55 : 0.0;
    const root_pos = pos.add(Y.mul(moving ? Math.abs(Math.sin(phase * 2.0)) * 0.03 : 0.0));
    const root_quat = q_mul(q_y(yaw), q_x(lean));
    const hit = clamp(swing / 0.45, 0.0, 1.0);
    const arm_r = hit > 0.0 ? 0.4 + Math.sin(hit * PI) * 1.6 : sw;
    const rots = [hit * 0.12, 0.0, -sw, arm_r, sw, -sw];
    b.update({ pos: pos.clone(), yaw, moving, phase, swing, lean, show, root_pos, root_quat, part_rots_x: rots, hide_extra: true });
  };
  let k = 0;
  while (k < g.bld.crew.length) {
    if (g.bld.crew[k].gone) {
      const b = g.bld.crew[k].body;
      g.bld.crew[k].body = null;
      if (b !== null) {
        b.despawn();
      }
      g.bld.crew.splice(k, 1);
      continue;
    }
    const l = g.bld.crew[k];
    if (l.body === null) {
      l.body = scene.people.spawn(l.seed, null, l.pos, { role: 'crew' });
    } else {
      pose(l.body, l.pos, l.yaw, l.moving, l.phase, l.swing, 0.0, true);
    }
    k += 1;
  }
  const show = g.bld.med_open || g.bld.helper.freed;
  const h = g.bld.helper;
  if (h.body === null) {
    if (show) {
      h.body = scene.people.spawn(0x57a9, 'Hulk', h.pos, { role: 'helper' });
    }
  } else {
    pose(h.body, h.pos, h.freed ? h.yaw : FRAC_PI_2, h.moving, h.phase, h.swing, h.down ? -1.45 : 0.0, show);
  }
}

/* VIEW NOTES (world.js)
Meshes are ported (MB -> build() {p,n,uv,c,i}); uv.x = pattern code, uv.y = emissive strength; vertex colour is LINEAR rgb
(hex() converts sRGB) with alpha in c.w. The Bevy shader drew a procedural world-space pattern per code:
  FLAT 0        plain colour: door frames/trim, signs + 5x7 block glyphs ("SHOP", "OPEN", "CLOSED", "+"), lamp bulbs and
                light strips (emissive), road/parking/crossing paint decals (floor_quad at y 0.004-0.005), mattress/bedding,
                tires, rubble in skip, posters' bands, ghost outline, coin bands, tracers/fires/lure, zoo backdrop.
  WOOD 1        floors of shop/SF rooms (default), beams, planks over windows, doors, crates, pallets, shelves, bed frame,
                power poles, job board, bench.
  CONCRETE 2    ceiling slab, yard slab, back lot, sidewalks, warehouse floor, hospital + skyline blocks, jersey barriers,
                siren plinth, raid barriers.
  ASPHALT 3     parking lot inside fence (z 13..LOT[3]) and the street (ROAD_Z0..ROAD_Z1).
  BRICK 4       shop outer walls (0x8b5a45), locked medical room block, locked SF2/SF3 block (shade 0.9), east building,
                back-row houses, some rubble.
  CORRUGATED 5  warehouse walls/locked block (0x6d747a, inside 0x5a6066), skip walls, dumpsters, back fence sheets, drums
                inside shop, roof water tank, bus-stop roof, barrier panels, containers.
  GROUND 6      the 500x500 m ground quad at y -0.06 (0x5a6142) and the 18 far hills (cones r 40-70 m).
  PLASTER 7     inner wall faces (paintable: build.paint_col(g, room, false) else 0x8a8f78), bedroom wall 0x7f7a6a, medical
                white 0xb9c2bc, west building.
  CARDBOARD 8   posters, door mat, boxes in warehouse/shop, job-board papers, trash bags (paper), open box prop.
  SKY 9         sky dome (r 420, 8 rings x 20 segs, from -0.15 rad to zenith, seen from inside, colour white).
  GLASS 10      two front windows (glass mesh, alpha 0.28, 0x9fb8c4) - drawn with the 'blend' material.
  STRIPES 13    merchant stall awning (0xb0452a, 3.6 x 1.6 m at y 2.3).
  METAL 14      machines, frames, pipes, lamp posts, fences/wire, siren tower, trolley, trucks parts, radio/intel desk kit.
  (UNLIT 12 is not used by world.js itself; fp.draw / fx may use it inside the dynamic mesh.)
Named nodes spawned by setup_world (scene.spawn opts.name), all with identity transform unless noted:
  'shop' (solid, no_cull) WorldEnts.shop  - whole shop shell + interior + warehouse/SF/medical rooms; REBUILT (set_mesh)
         whenever shop_sig(g) changes (rooms, wh_open, med_open, gen_fixed, helper.freed, paint[6], tiers[6]).
  'glass' (blend) WorldEnts.glass - front window panes, rebuilt with 'shop'.
  'exterior' (solid, no_cull) WorldEnts.ext - ground, lot, street, dressing (dress.dressing), lamps, hospital, buildings,
         skyline, cars (models.truck), skip, trolley, pallet, fences, barriers, trees (models.tree), hills, yard_stations.
  'sky_dome' (solid, no_cull) WorldEnts.dome, also SkyDome[0] (mat.js follows the camera with it).
  'door_leaf' x2 DoorLeaf[{node, side}] at lay.DOOR - X*side; rotation q_y(side * door.t*1.75) (* q_z(side*0.12) if door
         hp <= 0). door.t eases to 1 (open or broken) at 2.5/s.
  'bed_door' BedDoor[0] at lay.BED_DOOR_HINGE; yaw eases (3 rad/s) to (open*1.8 + min(hits,2)*0.04) * BED_DOOR_SWING.
  'sign_open' / 'sign_closed' OpenSign[{node, open}] - visible when open === g.open.
  'merchant_truck', 'gib_truck' WorldEnts.trucks[0/1] (hidden until g.ev.merchant_here / gib_here).
  'gib_wheel' WorldEnts.wheel at GIB + (0,1.65,1.3), 16 coloured spokes in XY plane; spins q_z((spin_to + spin_t^2*3)/16*TAU).
  'ghost' WorldEnts.ghost - placement preview (models.placed + green/red emissive floor frame), at bld.ghost_pos, q_y(yaw).
  'coins' WorldEnts.coins - batteries on the counter (player.coin_pos(i)), rebuilt when g.pay_rev changes.
  'dynamic' WorldEnts.dynv - per-frame mesh: tracers, fires (5-seg cones flickering), lure ball, fp.draw(fx2), zoo backdrop.
  'shelf_goods' per shelf -> sh.ent; 'prop' per Prop -> p.ent (opts.prop = kind tag). Prop node pos/quat from p.pos/p.yaw,
         or carry.flying(); held non-corpse props are parked at y -50 under the camera.
  opts.no_cull mirrors Bevy NoFrustumCulling. Hidden placeholder meshes are a 1 cm cube at y -5.
People descriptor (sync_build_actors -> person.update(d)): crew (kind null, opts {role:'crew'}) and the Hulk Helper (seed
  0x57a9, kind 'Hulk', opts {role:'helper'}). d = { pos, yaw, moving, phase (walk phase rad), swing (attack timer s, hit
  = clamp(swing/0.45,0,1)), lean (rad about X: 0, or -1.45 when the helper is down), show (visibility), root_pos (pos + Y *
  |sin(2*phase)|*0.03 when moving), root_quat (q_y(yaw)*q_x(lean)), part_rots_x [torso hit*0.12, head 0, leg L -sw,
  arm R (hit>0 ? 0.4+sin(hit*PI)*1.6 : sw), leg R sw, arm L -sw] with sw = moving ? sin(phase)*0.55 : 0, hide_extra:true }.
  Chained helper (not freed) faces yaw PI/2.
Time: sync_world uses ctx.elapsed (seconds) for fire/lure flicker and fp.draw; falls back to an internal dt sum.
PORT GAPS: COLLIDERS / SHADOW_BOXES are lazy Proxy arrays (LazyLock) so lay.js is not read at module top level.
  shop_sig is a BigInt (Rust u64). Rust's paint bits (u8 << 8+k*6) can overlap neighbours/tier bits (port kept as is).
*/
