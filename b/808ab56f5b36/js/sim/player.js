// Port of src/player.rs (rules + viewmodel sync). See PORT-CONTRACT.md.
//! Người chơi góc nhìn thứ nhất: đi lại, va chạm, nhắm và tương tác, cầm hộp / kéo xác, các bảng nhập liệu, chế độ xây,
//! thanh toán bằng pin ngay trên mặt quầy (nhắm từng cục pin), ngồi tháp súng. Vũ khí ở `combat.rs`, ba lô ở `items.rs`.
import { Vec3, v3, k3, ZERO, Y, NEG_Z, clamp, trunc, q_euler, q_rot, q_mul, q_look, Q_ID } from './vec.js';
import * as scene from './scene.js';
import * as web from './web.js';
import * as audio from './audio.js';
import * as actors from './actors.js';
import * as build from './build.js';
import * as game from './game.js';
import * as geom from './geom.js';
import * as lay from './lay.js';
import * as world from './world.js';
import * as items from './items.js';
import * as skills from './skills.js';
import * as carry from './carry.js';
import * as combat from './combat.js';
import * as fp from './fp.js';
import * as fx from './fx.js';
import * as events from './events.js';
import * as cine from './cine.js';
import * as save from './save.js';
import * as staff from './staff.js';
import * as craft from './craft.js';
import * as map from './map.js';
import * as data from './data.js';
import * as catalog from './catalog.js';

export const EYE = 1.62;
export const REACH = 2.8;

/** Bevy `ViewModel(u8)` entities: ViewModels[0] = vũ khí + tay phải, ViewModels[1] = tay trái + băng đạn / ốp bơm.
 *  Nodes are children of the camera in Bevy (their transforms are camera-local). */
export const ViewModels = [];

export class Feel {
  constructor() {
    this.vel = new Vec3();
    this.bob = 0;
    this.step = 0;
    this.build_t = 0;
    this.title_t = 0;
    this.nolock = false;
    this.unlock_t = 0;
    /** Món đang hiện ở hình cầm tay (dựng lại mesh khi đổi vũ khí). */
    this.vm_item = null;
    /** Chạy chiến thuật: lần nhấn Shift trước (giây) và cờ đang chạy chiến thuật (nhấn Shift hai lần trong 0,3 s). */
    this.shift_t = 0;
    this.tac = false;
  }
}

// enum Target (data-carrying) -> {k, a?}
export const Target = {
  None: () => ({ k: 'None' }),
  Switch: () => ({ k: 'Switch' }),
  Bed: () => ({ k: 'Bed' }),
  Till: () => ({ k: 'Till' }),
  Skip: () => ({ k: 'Skip' }),
  Door: () => ({ k: 'Door' }),
  BedDoor: () => ({ k: 'BedDoor' }),
  Radio: () => ({ k: 'Radio' }),
  Shelf: (s, slot) => ({ k: 'Shelf', a: s, b: slot }),
  /** [phiên 7] Thẻ giá trên mép trước ô kệ (plug/pricetag.js vẽ): [E] đặt giá. */
  Tag: (s, slot) => ({ k: 'Tag', a: s, b: slot }),
  Prop: (id) => ({ k: 'Prop', a: id }),
  /** Trạm trong thế giới (mã ở build.rs). */
  Station: (st) => ({ k: 'Station', a: st }),
  /** Cục pin thứ i khách đặt trên quầy, và nút báo động. */
  Coin: (i) => ({ k: 'Coin', a: i }),
  Alarm: () => ({ k: 'Alarm' }),
  /** [par-counter D12] Ô ngăn kéo pin của một mệnh giá (chỉ nhắm được lúc trả pin cho khách bán). */
  Drawer: (v) => ({ k: 'Drawer', a: v }),
  Bell: () => ({ k: 'Bell' }),
};

/** [par-counter D10/D12] Ngăn kéo pin như gốc (op/04b, clip 02 7:42): bốn ngăn kéo to xếp 2x2 sát người bán, tầng trên
 *  pin 1 (xanh lá, trái) và 5 (xanh dương, phải), tầng dưới kéo ra xa hơn pin 10 (tím, trái) và 50 (vàng, phải).
 *  [ĐỀ XUẤT] 100 / 1000 (gốc chưa thấy) nằm ô hẹp cuối ngăn trên (100 cạnh 1, 1000 cạnh 5). Mỗi ô: { x0, x1, y, z0, z1 }
 *  (y = đáy khay, z0 = mép gần người bán). models.js counter vẽ khay, plug/till.js xếp pin trong ô. */
export const DRAWER_DENOMS = [1, 5, 10, 50, 100, 1000];
export const DRAWER_UP = { y: 0.62, z0: -3.36, z1: -3.04 };
export const DRAWER_LO = { y: 0.34, z0: -3.64, z1: -3.1 };
export const DRAWER_COLS = [[-0.68, -0.06], [0.0, 0.62]];
export function drawer_cell(v) {
  // người bán nhìn về +z nên x dương ở bên trái màn: cột x dương là ngăn 1 / 10 (trái như gốc), ô hẹp 100 / 1000 ở mép ngoài
  const left = v === 1 || v === 10 || v === 100, up = v === 1 || v === 5 || v === 100 || v === 1000;
  const [cx0, cx1] = DRAWER_COLS[left ? 1 : 0];
  const t = up ? DRAWER_UP : DRAWER_LO;
  const a = cx0 + 0.03, b = cx1 - 0.03, outer_hi = cx0 >= 0;
  let x0 = a, x1 = b;
  if (up) {
    const cut = outer_hi ? b - 0.15 : a + 0.15;
    if (v === 100 || v === 1000) [x0, x1] = outer_hi ? [cut + 0.012, b] : [a, cut - 0.012];
    else [x0, x1] = outer_hi ? [a, cut - 0.012] : [cut + 0.012, b];
  }
  return { x0, x1, y: t.y, z0: t.z0 + 0.03, z1: t.z1 - 0.01 };
}
export function drawer_box(v) {
  const c = drawer_cell(v);
  return [v3(c.x0, c.y, c.z0), v3(c.x1, c.y + 0.12, c.z1)];
}
/** [par-counter D13] Chỗ đứng và hướng nhìn khi vào chế độ đứng quầy (Serve): sau quầy, lùi một chút để thấy ngăn kéo. */
export const DESK_STAND = k3(0.06, 0.0, -4.0);
export const DESK_YAW = Math.PI;
export const DESK_PITCH = -0.78;
/** Vào chế độ đứng quầy: đứng yên sau quầy, cất vũ khí, camera nhìn xuống quầy (gốc: Serve ở Service Desk). */
export function enter_desk(g) {
  if (g.desk) return;
  g.desk = true;
  combat.select(g, 1);
  g.player = world.resolve(g, v3(DESK_STAND.x, g.player.y, DESK_STAND.z), 0.3);
  g.yaw = DESK_YAW;
  g.pitch = DESK_PITCH;
  g.play('click', 0.3);
}
export function leave_desk(g) {
  if (!g.desk) return;
  g.desk = false;
  if (g.give !== null) g.give.hand = 0;
}

function cam_of(ctx) {
  if (!ctx.cam) ctx.cam = { pos: v3(0, EYE, 15.5), quat: Q_ID.slice() };
  return ctx.cam;
}
/** Bevy Transform from fp.rs / carry.rs ({translation, rotation, scale}) -> scene node set_tr argument. */
function tr_of(t) {
  if (!t) return { pos: v3(), quat: Q_ID.slice(), scale: 1 };
  const pos = t.translation !== undefined ? t.translation : t.pos;
  const quat = t.rotation !== undefined ? t.rotation : t.quat;
  const out = { pos: pos ? pos : v3(), quat: quat ? quat : Q_ID.slice() };
  if (t.scale !== undefined) out.scale = t.scale;
  return out;
}
function cam_look_at(cam, target) {
  cam.quat = q_look(target.sub(cam.pos), Y);
}
const b = (x) => (x ? 1 : 0);

export function setup_player(g, ctx) {
  const cam = cam_of(ctx);
  cam.pos = v3(0.0, EYE, 15.5);
  cam.quat = Q_ID.slice();
  cam.fov = (68 * Math.PI) / 180;
  cam.near = 0.06;
  cam.far = 900.0;
  // Hình cầm tay gồm hai lưới (fp.rs): 0 = vũ khí + tay phải, 1 = tay trái + băng đạn / ốp bơm.
  const main = new geom.MB(), off = new geom.MB();
  fp.build_vm(game.HAMMER, main, off);
  for (const n of ViewModels) n.despawn();
  ViewModels.length = 0;
  [main, off].forEach((mb, k) => {
    if (mb.is_empty()) {
      mb.cube(v3(0.0, -5.0, 0.0), v3(0.01, 0.01, 0.01), [0.0, 0.0, 0.0], geom.FLAT);
    }
    const e = scene.spawn(mb.build(), 'solid', { pos: v3(0.3, -0.34, -0.55), visible: false, viewmodel: true, part: k });
    ViewModels[k] = e;
  });
}

export function ray_box(o, d, mn, mx) {
  const inv = v3(1.0 / (d.x + 1e-6), 1.0 / (d.y + 1e-6), 1.0 / (d.z + 1e-6));
  const t0 = mn.sub(o).mulv(inv);
  const t1 = mx.sub(o).mulv(inv);
  const lo = t0.min(t1);
  const hi = t0.max(t1);
  const tn = Math.max(Math.max(lo.x, lo.y), lo.z);
  const tf = Math.min(Math.min(hi.x, hi.y), hi.z);
  if (tf >= Math.max(tn, 0.0)) return Math.max(tn, 0.0);
  return null;
}

export function prop_box(p) {
  if (p.kind.k === 'Wire') {
    const bx = build.prop_box(game.BARBED, p.pos, p.yaw);
    return [v3(bx[0], 0.0, bx[1]), v3(bx[2], 0.8, bx[3])];
  }
  if (p.kind.k === 'Placed') {
    const item = p.kind.a;
    const bx = build.prop_box(item, p.pos, p.yaw);
    let y0, y1;
    switch (build.footprint(item)[3]) {
      case 1: y0 = 1.1; y1 = 2.0; break;
      case 2: y0 = 2.2; y1 = 2.9; break;
      // kệ đã cố định nhắm qua hộp kệ (g.shelves); kệ chưa cố định (fin-build đợt 4) chưa có ô kệ nên nhắm cả thân
      default: y0 = 0.0; y1 = build.shelf_dims(item) !== null ? (build.loose(p) ? 1.8 : 0.28) : 1.1;
    }
    // đồ đặt trên mặt bàn / kệ: hộp nhắm thấp lại (0,5 m) và nâng theo chỗ đứng
    if (p.pos.y > 0.005) {
      y0 = p.pos.y;
      y1 = p.pos.y + 0.5;
    }
    return [v3(bx[0], y0, bx[1]), v3(bx[2], y1, bx[3])];
  }
  let r, h;
  switch (p.kind.k) {
    case 'Trash': r = 0.26; h = 0.42; break;
    case 'Pile': r = 0.48; h = 0.25; break;
    case 'Item': r = /^(Plank|HardwoodPlank|HardwoodLog|MetalPipe|CopperPipe)ItemData$/.test(items.cat_key(p.kind.a)) ? 0.26 : 0.16; h = 0.3; break; // ván, khúc gỗ, ống dài ~0,5-0,6 m
    case 'Box': r = 0.32; h = 0.36; break;
    case 'BoxPile': r = 0.36; h = 0.5; break;
    case 'Notes': r = 0.2; h = 0.08; break; // sticks out past the desk front: the news desk box (0-1.9 m) would hide it
    case 'Hammer': r = 0.3; h = 0.2; break;
    case 'Crate': r = 0.42; h = 0.7; break;
    case 'WBox': r = 0.38; h = 0.6; break;
    case 'Reward': r = 0.5; h = 0.7; break;
    case 'Corpse': r = 0.7; h = 0.4; break;
    case 'Cache': {
      // Đợt 13: đồ cao (tủ, tủ lạnh) nhắm được cả thân.
      const sz = { 'Locker': [0.6, 1.8], 'Fridge': [0.45, 1.6], 'Cabinet': [0.4, 1.0], 'Tool chest': [0.45, 1.0], 'Supply crate': [0.55, 0.9], 'Safe': [0.35, 0.65] }[p.kind.a];
      r = sz ? sz[0] : 0.45; h = sz ? sz[1] : 0.8; break;
    }
    case 'Placed': r = 0.4; h = 1.0; break;
  }
  return [p.pos.add(v3(-r, 0.0, -r)), p.pos.add(v3(r, h, r))];
}

/** Chỗ cục pin thứ `i` nằm trên mặt quầy (các hàng 5 cục, bên trái ngăn tiền, chỗ người đứng sau quầy nhìn thấy không bị radio che). */
export function coin_pos(i) {
  return v3(-0.2 + (i % 5) * 0.13, 0.975, -2.35 - trunc(i / 5) * 0.13);
}
/** Nút báo động ở đầu trái quầy. */
export const ALARM = k3(-1.45, 0.99, -2.75);
/** [par-counter D13] Queue Bell (chuông gọi khách kế) ở đầu phải quầy (models.js counter vẽ). */
export const BELL = k3(1.55, 0.99, -2.6);

/** Chỗ bóng đứng: [Vec3, id mặt đỡ | 0]. Đồ trang trí nhỏ: mặt trên của bàn / kệ đã dựng mà tia nhắm chạm trong tầm với.
 *  Còn lại: điểm nhắm trên sàn, xa nhất `ghost_d` (nhìn ngang hay ngửa lên thì đúng `ghost_d` trước mặt), gần nhất 1 m. */
export function ghost_spot(g, item, eye, fwd, flat_f) {
  if (build.decor_small(item) && fwd.y < -0.02) {
    let best = null;
    for (const p of g.props) {
      if (p.dead || p.kind.k !== 'Placed' || p.id === g.held || !build.surface_of(p.kind.a) || (g.bld.grab !== null && p.pos === g.bld.grab.pos)) continue;
      const top = build.top_of(p);
      const t = (top - eye.y) / fwd.y;
      if (t <= 0.0 || t > REACH + 1.0 || (best !== null && t >= best[0])) continue;
      const q = eye.add(fwd.mul(t));
      const b = build.prop_box(p.kind.a, p.pos, p.yaw);
      if (q.x > b[0] && q.x < b[2] && q.z > b[1] && q.z < b[3]) best = [t, v3(q.x, top, q.z), p.id];
    }
    if (best !== null) return [best[1], best[2]];
  }
  let d = g.bld.ghost_d;
  if (fwd.y < -0.02) {
    const t = eye.y / -fwd.y;
    d = clamp(Math.min(d, t * Math.hypot(fwd.x, fwd.z)), 1.0, g.bld.ghost_d);
  }
  const pos = g.player.add(flat_f.mul(d));
  return [v3(pos.x, 0.0, pos.z), 0];
}

/** Thả vật đang cầm (hộp, rác, món lẻ, xác) xuống trước mặt 0,9 m ([X] / [G], hoặc khi vào chế độ xây). */
export function drop_held_any(g, flat_f) {
  const id = g.held;
  if (id === null) return;
  g.held = null;
  const spot = world.resolve(g, g.player.add(flat_f.mul(0.9)), 0.3);
  const yaw = g.yaw;
  // Xác: buông tay, ragdoll tự rơi yên tại chỗ (carry.rs).
  const rag = g.cy.rags.some((r) => r.id === id);
  const p = g.prop(id);
  if (p !== null && !rag) {
    p.pos = v3(spot.x, 0.0, spot.z);
    p.yaw = yaw;
  }
  g.play('drop', 0.5);
}

/** Ra khỏi chế độ xây (bóng đang cầm thì huỷ như Esc). */
export function leave_build(g) {
  if (g.bld.ghost !== null) build.cancel(g);
  g.bld.mode = false;
  g.bld.edit = null;
  g.bld.repair_t = 0.0;
  if (g.bld.prev && g.held === null) {
    const [armed, thr] = g.bld.prev;
    g.armed = armed && g.weapons.length > 0;
    g.cb.throw_item = thr !== null && g.inv[thr] > 0 ? thr : null;
  }
  g.bld.prev = null;
  g.play('click', 0.3);
}

export function find_target(g, o, d) {
  let best = [Target.None(), REACH, ZERO];
  const test = (t, mn, mx) => {
    const dist = ray_box(o, d, mn, mx);
    if (dist !== null) {
      if (dist < best[1]) {
        best = [t, dist, o.add(d.mul(dist))];
      }
    }
  };
  const v = v3;
  for (const [mn, mx] of lay.SWITCH_BOXES) {
    test(Target.Switch(), mn, mx);
  }
  test(Target.Bed(), lay.BED_BOX[0], lay.BED_BOX[1]);
  test(Target.Till(), lay.TILL_BOX[0], lay.TILL_BOX[1]);
  const sk = lay.SKIP_BOX;
  test(Target.Skip(), v(sk[0], 0.0, sk[1]), v(sk[2], 1.45, sk[3]));
  test(Target.Radio(), lay.RADIO_BOX[0], lay.RADIO_BOX[1]);
  const db = lay.DOOR_BOX;
  if (g.door_blocks()) {
    test(Target.Door(), v(db[0], 0.0, db[1]), v(db[2], 2.3, db[3]));
  } else {
    // Hai cánh đang mở vào trong, áp sát hai bên khung cửa.
    // Phiên 8 (nguyên nhân "công tắc 13:00 phải bấm E hai lần", đo bằng tools/switch50.cjs + nhật ký phím E): cánh phải mở
    // nằm sát ngay cạnh công tắc (x 0,98-1,2 so với công tắc x 1,5-1,96). Đứng gần cửa nhắm công tắc thì tia trúng cánh cửa
    // trước (hay mắt nằm hẳn trong hộp cánh, khoảng cách 0), E đầu đóng cửa, cửa đóng rồi E sau mới trúng công tắc.
    // Nay: tia trúng công tắc thì công tắc thắng cánh cửa đang mở; mắt nằm trong hộp cánh thì không tính cánh đó.
    const sw = best[0].k === 'Switch' ? best : null;
    const leaf = (mn, mx) => { const dd = ray_box(o, d, mn, mx); if (dd !== null && dd > 0.0 && dd < best[1] && sw === null) best = [Target.Door(), dd, o.add(d.mul(dd))]; };
    leaf(v(db[0] - 0.2, 0.0, db[1] - 0.95), v(db[0] + 0.02, 2.3, db[1] + 0.1));
    leaf(v(db[2] - 0.02, 0.0, db[1] - 0.95), v(db[2] + 0.2, 2.3, db[1] + 0.1));
  }
  // fin-build đợt 4: cửa đã vỡ (0 máu) vẫn nhắm được ở khung cửa để sửa qua chế độ xây (không đè công tắc)
  if (g.door.hp <= 0.0 && best[0].k !== 'Switch') {
    test(Target.Door(), v(db[0], 0.0, db[1]), v(db[2], 2.3, db[3]));
  }
  if (g.bed_door_hits < 3) {
    const bb = lay.BED_DOOR_BOX;
    test(Target.BedDoor(), v(bb[0], 0.0, bb[1]), v(bb[2], 2.2, bb[3]));
  }
  // Kệ: hộp theo trục phủ thân kệ (kệ cố định và kệ dựng thêm), từ tầng dưới cùng tới trên tầng trên cùng.
  g.shelves.forEach((sh, s) => {
    const hl = sh.cols * lay.SLOT_W * 0.5 + 0.05;
    const sn = Math.sin(sh.yaw), cs = Math.cos(sh.yaw);
    const ex = Math.abs(cs) * hl + Math.abs(sn) * 0.32, ez = Math.abs(sn) * hl + Math.abs(cs) * 0.32;
    const top = 0.5 + trunc(sh.slots.length / sh.cols) * 0.5;
    if (sh.plank) {
      // kệ ván: hộp từ dưới ván tới trên hàng hoá, sâu từ tường tới mép trước
      const ex2 = Math.abs(cs) * hl + Math.abs(sn) * 0.4, ez2 = Math.abs(sn) * hl + Math.abs(cs) * 0.4;
      test(Target.Shelf(s, 0), v(sh.pos.x - ex2, lay.PLANK_TOP - 0.25, sh.pos.z - ez2), v(sh.pos.x + ex2, lay.PLANK_TOP + 0.3, sh.pos.z + ez2));
      return;
    }
    test(Target.Shelf(s, 0), v(sh.pos.x - ex, 0.3, sh.pos.z - ez), v(sh.pos.x + ex, top, sh.pos.z + ez));
  });
  const hc = actors.head_customer(g);
  if (hc !== null) {
    const p = g.customers[hc].pos;
    test(Target.Till(), p.add(v(-0.3, 0.0, -0.3)), p.add(v(0.3, 1.8, 0.3)));
  }
  if (g.pay !== null) {
    const pay = g.pay;
    pay.coins.forEach((c, i) => {
      if (c.done === 0) {
        const p = coin_pos(i);
        test(Target.Coin(i), p.add(v(-0.055, -0.03, -0.055)), p.add(v(0.055, 0.07, 0.055)));
      }
    });
    test(Target.Alarm(), ALARM.add(v(-0.09, -0.04, -0.09)), ALARM.add(v(0.09, 0.09, 0.09)));
  }
  test(Target.Bell(), BELL.add(v(-0.08, 0.0, -0.08)), BELL.add(v(0.08, 0.08, 0.08)));
  if (g.give !== null) {
    for (const dv of DRAWER_DENOMS) {
      const [mn, mx] = drawer_box(dv);
      test(Target.Drawer(dv), mn, mx);
    }
  }
  for (const [st, mn, mx] of build.targets(g)) {
    test(Target.Station(st), mn, mx);
  }
  for (const p of g.props) {
    if (p.dead || g.held === p.id) {
      continue;
    }
    // dây thép gai chỉ nhắm được khi tay không (để Grab, fin-build đợt 3); cầm vũ khí thì vẫn bỏ qua như cũ
    if ((p.kind.k === 'Wire' && g.armed) || (p.kind.k === 'Cache' && p.kind.c === true)) continue;
    if (g.cb.projs.some((x) => x[0] === p.id)) {
      continue;
    }
    const [mn, mx] = prop_box(p);
    test(Target.Prop(p.id), mn, mx);
  }
  if (best[0].k === 'Shelf') {
    const s = best[0].a;
    const sh = g.shelves[s];
    let local = rot_neg_y(sh.yaw, best[2].sub(sh.pos));
    const levels = trunc(sh.slots.length / sh.cols);
    let lvl;
    if (sh.plank) {
      // ô = chỗ tia nhắm cắt mặt ván (hàng hoá đứng trên ván): cột theo x, hàng theo độ sâu
      const yb = lay.PLANK_TOP + 0.04;
      if (d.y < -1e-4 && o.y > yb) local = rot_neg_y(sh.yaw, o.add(d.mul((yb - o.y) / d.y)).sub(sh.pos));
      lvl = clamp(Math.round((lay.PLANK_ROWS[0] - local.z) / (lay.PLANK_ROWS[0] - lay.PLANK_ROWS[1])), 0, levels - 1);
    } else lvl = clamp(trunc(Math.floor((best[2].y - 0.45) / 0.5)), 0, levels - 1);
    const col = clamp(trunc(Math.floor(local.x / lay.SLOT_W + sh.cols * 0.5)), 0, sh.cols - 1);
    best[0] = Target.Shelf(s, lvl * sh.cols + col);
    // Thẻ giá trên mép trước các ô có hàng: nhắm trúng thẻ thì đích là thẻ (kể cả khi hộp kệ, nhô ra trước thẻ, bị trúng trước).
    const lo = rot_neg_y(sh.yaw, o.sub(sh.pos)), ld = rot_neg_y(sh.yaw, d);
    let bt = null, bd = Math.min(REACH, best[1] + 0.25);
    for (let k = 0; k < sh.slots.length; k++) {
      if (sh.slots[k] === null) continue;
      if (sh.plank && plank_tag_slot(sh, k % sh.cols) !== k) continue;
      const [mn, mx] = tag_box(sh, k);
      const dist = ray_box(lo, ld, mn, mx);
      if (dist !== null && dist < bd) { bd = dist; bt = k; }
    }
    if (bt !== null) best = [Target.Tag(s, bt), bd, o.add(d.mul(bd))];
  }
  // [phiên 8] thẻ nổi của món hàng sau khác loại món trước (đang hiện vì vừa nhắm ô đó): nhắm trúng thì đích là thẻ đó
  const ht = g.hover_tag;
  if (ht && g.shelves[ht[0]] && hover_tag_ok(g.shelves[ht[0]], ht[1])) {
    const sh = g.shelves[ht[0]];
    const [mn, mx] = hover_tag_box(sh, ht[1]);
    const dist = ray_box(rot_neg_y(sh.yaw, o.sub(sh.pos)), rot_neg_y(sh.yaw, d), mn, mx);
    if (dist !== null && dist < Math.min(REACH, best[1] + 0.3)) best = [Target.Tag(ht[0], ht[1]), dist, o.add(d.mul(dist))];
  }
  return [best[0], best[2]];
}
/** [phiên 8] Kệ ván chỉ có một hàng thẻ (món trước nhất mỗi cột). Ô hàng sau có món KHÁC loại món của thẻ cột thì có thẻ
 *  riêng, chỉ hiện khi nhắm ô đó: thẻ nổi ngay trên món (`hover_tag_box`), E trên thẻ hay E / Q trên ô đặt giá món đó. */
export function hover_tag_ok(sh, k) {
  if (!sh.plank || k === null || k === undefined || sh.slots[k] === null || sh.slots[k] === undefined) return false;
  const f = plank_tag_slot(sh, k % sh.cols);
  return f !== null && f !== k && sh.slots[f] !== sh.slots[k];
}
/** Độ cao thẻ nổi trên mặt ván (trên đầu món hàng). */
export const HOVER_TAG_DY = 0.36;
/** Hộp nhắm của thẻ nổi ô `k` (khung riêng của kệ). */
export function hover_tag_box(sh, k) {
  const col = k % sh.cols, lvl = trunc(k / sh.cols);
  const x = (col + 0.5 - sh.cols * 0.5) * lay.SLOT_W, y = lay.PLANK_TOP + HOVER_TAG_DY, z = lay.PLANK_ROWS[lvl];
  return [v3(x - 0.17, y - 0.048, z - 0.03), v3(x + 0.17, y + 0.048, z + 0.03)]; // thẻ nổi 0,34 x 0,096 m (phiên 8 đợt 3)
}
/** Thẻ nổi đang hiện sau khi nhắm `target`: nhắm ô hàng sau khác loại thì hiện; nhắm chính thẻ nổi thì giữ; khác thì tắt. */
export function hover_tag_for(g, target) {
  if (target.k === 'Shelf' && hover_tag_ok(g.shelves[target.a], target.b)) return [target.a, target.b];
  const ht = g.hover_tag;
  if (target.k === 'Tag' && ht && ht[0] === target.a && ht[1] === target.b && hover_tag_ok(g.shelves[ht[0]], ht[1])) return ht;
  return null;
}
/** Tâm thẻ giá của kệ ván (y): một hàng thẻ treo dưới mép trước tấm ván. */
export function tag_y() {
  return lay.PLANK_TAG_Y;
}
/** Kệ ván: mỗi cột một thẻ, của món đứng trước nhất trong cột (ô hàng trước nếu có hàng, không thì hàng sau đó); null khi cột trống. */
export function plank_tag_slot(sh, col) {
  const levels = trunc(sh.slots.length / sh.cols);
  for (let l = 0; l < levels; l++) if (sh.slots[l * sh.cols + col] !== null) return l * sh.cols + col;
  return null;
}
/** Hộp nhắm của thẻ giá ô `k` trong khung riêng của kệ (+z mặt trước; mép trước tầng l ở y 0,435..0,485 + 0,5 l, z 0,25). */
export function tag_box(sh, k) {
  const col = k % sh.cols, lvl = trunc(k / sh.cols);
  if (sh.plank) {
    // kệ ván: một thẻ mỗi cột treo dưới mép trước (hơi ngả ra sau cho dễ đọc từ chỗ đứng)
    const x = (col + 0.5 - sh.cols * 0.5) * lay.SLOT_W, y = tag_y();
    return [v3(x - 0.13, y - 0.04, lay.PLANK_FRONT - 0.02), v3(x + 0.13, y + 0.04, lay.PLANK_FRONT + 0.035)];
  }
  const x = (col + 0.5 - sh.cols * 0.5) * lay.SLOT_W, y = 0.41 + lvl * 0.5;
  return [v3(x - 0.14, y - 0.055, 0.2), v3(x + 0.14, y + 0.055, 0.3)];
}
/** Quat::from_rotation_y(-yaw) * v */
function rot_neg_y(yaw, p) {
  const a = -yaw, c = Math.cos(a), s = Math.sin(a);
  return v3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

function clone_kind(k) {
  const o = { k: k.k };
  for (const f of ['a', 'b', 'c']) if (f in k) o[f] = Array.isArray(k[f]) ? k[f].slice() : k[f];
  return o;
}
export function held_kind(g) {
  if (g.held === null) return null;
  const p = g.props.find((p) => p.id === g.held);
  return p === undefined ? null : clone_kind(p.kind);
}

/** Món trên cùng của hộp đem bày được (bỏ qua vật liệu không bán), không có thì món trên cùng. */
function box_top(a) {
  for (let i = a.length - 1; i >= 0; i--) if (items.sellable(a[i]) && !items.is_material(a[i])) return a[i];
  for (let i = a.length - 1; i >= 0; i--) if (items.sellable(a[i])) return a[i];
  return a.length > 0 ? a[a.length - 1] : null;
}
/** [phiên 7] Mang hộp / món trên tay vào quán (hoặc phòng ngủ): vật liệu không bày bán được cất vào kho (ba lô = kho của
 *  quán, dùng để chế tạo / dựng), hàng bán được ở lại trong hộp để xếp kệ. */
export function stow_materials(g) {
  if (g.held === null || game.loot_bag()) return;
  if (!(game.Game.in_shop(g.player) || game.Game.in_bedroom(g.player))) return;
  const p = g.prop(g.held);
  if (p === null) return;
  if (p.kind.k === 'Box') {
    const mats = p.kind.a.filter((it) => items.is_material(it) || !items.sellable(it));
    if (mats.length === 0) return;
    p.kind.a = p.kind.a.filter((it) => !(items.is_material(it) || !items.sellable(it)));
    p.dirty = true;
    items.give(g, mats);
    g.say(`Stored in the stockroom: ${loot_text(mats)}`);
    g.play('place', 0.4);
  } else if (p.kind.k === 'Item' && (items.is_material(p.kind.a) || !items.sellable(p.kind.a))) {
    const it = p.kind.a;
    p.dead = true;
    g.held = null;
    items.give(g, [it]);
    g.say(`Stored in the stockroom: 1x ${items.iname(it)}`);
    g.play('place', 0.4);
  }
}

/** [GỐC] Sức chứa hộp các-tông theo thể tích: thanh x/80 (Capacity 8 x 10) x hệ số nút kỹ năng; mỗi món chiếm
 *  `items.box_vol` (hộp thiếc 10, chai 15-20, ván 25, ống 30...). `?loot=bag` không dùng hộp nên không đổi gì. */
export function box_cap(g) {
  const m = skills.mul(g, 'ContainerCapacityMultiplier');
  return Math.round(items.BOX_UNITS * (m > 0.0 ? m : 1.0));
}
/** Món `it` còn vừa hộp chứa `a` không. */
export function box_fits(g, a, it) {
  return items.box_used(a) + items.box_vol(it) <= box_cap(g);
}
/** "Box full (75/80, needs 20)": hộp chạm trần thì chỉ còn "(80/80)". */
export function box_full_text(g, a, it) {
  const u = items.box_used(a), cap = box_cap(g);
  return u >= cap ? `Box full (${u}/${cap})` : `Box full (${u}/${cap}, needs ${items.box_vol(it)})`;
}
const DESK_PROMPT = 'Service Desk   [E] Serve';
export function prompt_for(g, t) {
  const hk = held_kind(g);
  switch (t.k) {
    case 'None': return '';
    case 'Switch': return g.open ? '[E] Close Store' : '[E] Open For Business'; // [par-counter A08] chữ gốc loc:gameplay_interaction_close_store / open_for_business
    case 'Bed': return '[E] Sleep';
    case 'Till': {
      // [par-counter B28] lượt trả pin: gốc chỉ có chữ giữa dưới ("Take the customer's offering..."), quầy không có lựa chọn
      if (g.pay !== null) return '';
      // [par-counter D12] trả pin cho khách bán: cầm pin rút từ ngăn kéo thì nhắm khách / quầy để đưa (gốc "Give")
      if (g.give !== null) return g.give.hand > 0 ? `[E] Give (${g.give.hand})` : '';
      // [par-counter C34/A01] gốc: nhắm quầy = thẻ "Service Desk" + lựa chọn "Serve"; khách sẵn sàng thì hộp
      // "Customer wants ..." với ACCEPT / DECLINE (hud.js vẽ hộp; chuỗi này để bot và ô lựa chọn đọc)
      const o = actors.offer_of(g);
      if (o !== null) return `${actors.offer_text(g, o)}   [LMB] Accept   [RMB] Decline`;
      const i = actors.head_customer(g);
      if (i !== null && g.customers[i].goal.k === 'Medical') return 'Counter';
      // [par-counter D13] đang đứng quầy: quầy không còn lựa chọn Serve (gốc chỉ "ESC Leave" ở góc dưới trái)
      return g.desk ? '' : DESK_PROMPT;
    }
    case 'Coin': {
      const i = t.a;
      const c = g.pay !== null && i < g.pay.coins.length ? g.pay.coins[i] : null;
      if (c === null) return '';
      if (!c.checked) {
        // [par-counter D11] động từ gốc: "Grab" cục pin trên quầy (qua máy soi), "Deposit" vào đúng ngăn (clip 09 3:52-3:54, clip 02 7:42)
        return `Batteries (${c.value})   [E] Grab   [RMB] Bin`;
      } else if (c.fake) {
        return `FAKE battery (${c.value})   [RMB] Bin it   then hit the alarm button`;
      } else {
        return `Batteries (${c.value})   [E] Deposit   [RMB] Bin`;
      }
    }
    case 'Bell': return 'Queue Bell   [E] Press';
    case 'Drawer': {
      const gv = g.give;
      if (gv === null) return '';
      if (t.a > gv.left) return `Batteries (${t.a})   Too much: ${gv.left} left to pay`;
      return `Batteries (${t.a})   [E] Grab`;
    }
    case 'Alarm': {
      const m = g.pay !== null ? [g.pay.alarm, g.pay.coins.some((c) => c.checked && c.fake)] : null;
      if (m !== null && m[0] === 1) return 'The customer pleads   [LMB] Forgive   [RMB] Refuse';
      if (m !== null && m[0] === 0 && m[1] === true) return '[E] Alarm button: confront the customer about the fake';
      return 'Alarm button (for fake batteries)';
    }
    case 'Skip': {
      const n = g.cy.bin.length;
      // [FTUE K1] gốc chỉ đếm việc dọn rác bằng "NN%" trên To Do; thùng không in số thứ hai (0/12 khác 0/6 làm người mới rối).
      // Chỉ báo khi thùng đã đầy.
      if (n >= carry.BIN_CAP) return 'Skip - full, emptied overnight';
      if (hk !== null && hk.k === 'Trash') return '[E] Throw trash in';
      return 'Skip - bring trash here';
    }
    case 'Door': {
      // fin-build đợt 4: sửa cửa qua chế độ xây như gốc (quest_fix_door "Repair the front door via Build Mode")
      if (g.door.hp <= 0.0) {
        return `Broken front door (0/250)`;
      } else if (g.door.hp < game.DOOR_HP) {
        return `[E] ${g.door.open ? 'Close' : 'Open'} door   (${g.door.hp.toFixed(0)}/250)`;
      } else if (g.door.open) {
        return '[E] Close door';
      } else {
        return '[E] Open door';
      }
    }
    case 'BedDoor': return g.has_hammer() ? 'Jammed door - hit it with the hammer [LMB]' : 'Jammed door - find a hammer';
    case 'Radio': return '[E] Radio';
    case 'Station': return build.prompt(g, t.a);
    case 'Tag': {
      const it = g.shelves[t.a].slots[t.b];
      if (it === null) return '';
      return `[E] Set price   ${items.iname(it)}: ${g.prices[it]} Batteries each (worth ${Math.max(items.ival(it), 1)})`;
    }
    case 'Shelf': {
      const s = t.a, slot = t.b;
      let out = '';
      const it0 = g.shelves[s].slots[slot];
      let src = null;
      if (hk !== null && hk.k === 'Box') src = box_top(hk.a);
      else if (hk !== null && hk.k === 'Item') src = hk.a;
      else if (hk === null && g.inv[g.stock_sel] > 0 && items.sellable(g.stock_sel)) src = g.stock_sel;
      if (it0 !== null) {
        const nu = g.shelves[s].units(slot);
        const cnt = game.stack_max() > 1 ? ` x${nu}/${game.stack_max()}` : '';
        // ô hàng sau khác loại: thẻ nổi riêng; không có gì để đặt thì E đặt giá luôn
        // phiên 8 đợt 4: việc chính đứng đầu (phím E), dòng 2 là thông tin món trên ô
        const hov = hover_tag_ok(g.shelves[s], slot);
        const info = `${items.iname(it0)}${cnt}: ${g.prices[it0]} Batteries each`;
        // [par-counter A01] lựa chọn theo dòng như gốc: "[phím] động từ" từng cụm, thông tin món thành thẻ tên
        // [par-counter A07] bỏ phím Q: giá đặt bằng E trên thẻ giá
        if (src === null && hov) out = `[E] Set price   ${info}   [RMB] Take`;
        else out = `${info}   [RMB] Take`;
      }
      if (src !== null) {
        out = `[E] Place ${items.iname(src)}` + (out.length !== 0 ? `   ${out}` : '');
      }
      if (out.length === 0) {
        out = 'Shelf (empty)';
      }
      if (g.shelves[s].prop !== 0) {
        out += '   [hold V] Pick up shelf';
      }
      out += '   [C] Configure'; // [par-panels] C40
      return out;
    }
    case 'Prop': {
      const p = g.props.find((p) => p.id === t.a);
      if (p === undefined) return '';
      const kd = p.kind;
      switch (kd.k) {
        case 'Trash': return '[E] Pick up trash';
        case 'Pile': return '[hold E] Sweep';
        case 'Item':
          // [par-counter A10] tờ công thức nằm trong thế giới: giữ "Learn" học ngay (gốc clip 01 5:20), chuột phải "Grab" cất ba lô
          if (hk === null && is_recipe(kd.a)) return `${items.iname(kd.a)}   [hold E] Learn   [RMB] Grab`;
          if (hk !== null && hk.k === 'Box' && (items.box_only(kd.a) || box_fits(g, hk.a, kd.a))) {
            if (!box_fits(g, hk.a, kd.a)) return `${items.iname(kd.a)} - ${box_full_text(g, hk.a, kd.a)}`;
            return `[E] Put ${items.iname(kd.a)} in box (+${items.box_vol(kd.a)}  ${items.box_used(hk.a)}/${box_cap(g)})`;
          }
          if (items.box_only(kd.a)) {
            if (hk !== null) return `${items.iname(kd.a)} - Need a box to carry more`;
            return `[E] Take ${items.iname(kd.a)} by hand`; // phiên 8 đợt 3: ngắn lại; "Need a box" hiện khi đã cầm một món
          }
          return `[E] Take ${items.iname(kd.a)}`;
        case 'Box':
          if (hk !== null && hk.k === 'Item') {
            if (!box_fits(g, kd.a, hk.a)) return `${items.iname(hk.a)} - ${box_full_text(g, kd.a, hk.a)}`;
            return `[E] Put ${items.iname(hk.a)} in this box (+${items.box_vol(hk.a)}  ${items.box_used(kd.a)}/${box_cap(g)})`;
          }
          return `[E] Pick up cardboard box (${items.box_used(kd.a)}/${box_cap(g)})`;
        case 'BoxPile': return '[E] Take an empty cardboard box';
        case 'Notes': return g.day >= 3 ? '[E] Review   Notes' : 'Notes';
        case 'Hammer': return '[E] Equip'; // [par-counter D08] gốc clip 01 1:35 "Equip", không thẻ tên
        // [par-counter D16] gốc clip 01 f_0880 (gói nằm đất: "Grab / Open"), c01 5:05 (đang cầm: "Drop / Open")
        case 'Crate': return hk !== null ? '[RMB] Open' : '[E] Grab   [RMB] Open'; // tay đang bận (hộp): chỉ mở tại chỗ
        case 'WBox': { // [par-counter D37]
          const cw = g.cur_w();
          return g.armed && cw && items.melee(cw.item) !== null ? 'Wooden Crate   [LMB] Break' : 'Wooden Crate   Break it with a melee weapon [2]';
        }
        case 'Reward': return '[hold E] Open supply drop';
        case 'Corpse':
          if (kd.b === false) return '[hold E] Search';
          return g.on(game.FF_CORPSES) ? '[E] Grab' : ''; // [par-counter D15] gốc clip 01 f_0880 "Grab"; đang kéo: "Drop"
        case 'Cache': return `[hold E] Search ${kd.a.toLowerCase()}`;
        case 'Wire': return g.armed ? '' : `Barbed Wire (${kd.a.toFixed(0)}/300)`;
        case 'Placed': {
          const item = kd.a;
          const name = items.iname(item);
          if (is_seat(item)) return g.sit === p.id ? `${name}` : `${name}   [E] Sit   [hold V] Pick up`; // [par-counter D35]
          // fin-build đợt 4 (gốc clip 08 13:15 / 24:00, mã gốc): tay không trên vật chưa cố định / vật cầm tay: "Grab" chuột trái,
          // "Item Details" chuột phải, bẫy chưa giương "Arm" [F]. Vật đã cố định chỉ dời / sửa / nâng cấp được ở chế độ xây [B].
          if (!g.armed && build.hand_grabbable(g, p.id)) {
            const arm = item === game.BEAR_TRAP && p.aux < 0.0 ? '   [F] Arm' : '';
            const st = item === game.BEAR_TRAP && p.aux < 0.0 ? ' (not armed)' : '';
            return `[LMB] Grab\n${name}${st}   [RMB] Item Details${arm}   [hold V] Pick up`;
          }
          switch (item) {
            case game.TURRET: return `[E] Man the turret (ammo ${p.aux.toFixed(0)})   [hold V] Pick up`;
            case game.AUTO_MINIGUN: return `Auto Minigun (ammo ${p.aux.toFixed(0)})   [E] Load 556 Ammo   [hold V] Pick up`;
            case game.TV: return `${name}   [E] Turn ${p.aux > 0 ? 'off' : 'on'}   [hold V] Pick up`;
            case game.BEAR_TRAP:
              if (p.aux < 0.0) return `${name} (not armed)   [F] Arm   [hold V] Pick up`;
              return `${name} (${p.hp.toFixed(0)}/300)   [hold V] Pick up`;
            case game.SPIKE_WALL: return `${name} (${p.hp.toFixed(0)}/300)   [hold V] Pick up`;
            default: return `${name}   [hold V] Pick up`;
          }
        }
      }
      return '';
    }
  }
  return '';
}

export function hold_time(g, t) {
  const loot = (() => {
    const m = skills.mul(g, 'LootingSpeedMultiplier');
    return m > 0.0 ? m : 1.0;
  })();
  if (t.k === 'Station') return build.hold_time(g, t.a);
  if (t.k === 'Prop') {
    const p = g.props.find((p) => p.id === t.a);
    const kd = p === undefined ? null : p.kind;
    if (kd !== null && kd.k === 'Reward') return 1.5;
    if (kd !== null && kd.k === 'Corpse' && kd.b === false) return 2.0 / loot;
    if (kd !== null && kd.k === 'Cache') return 7.5 / loot;
    if (kd !== null && kd.k === 'Item' && g.held === null && is_recipe(kd.a)) return 5.0; // [par-counter A10] như học từ ba lô
    return 0.0;
  }
  return 0.0;
}

/** Hành động giữ E đã đủ thời gian. */
/// Đồ lục được văng ra đất quanh chỗ lục (luật gốc, xem game.loot_bag): mỗi món một vật `Item` nằm trên đất, đặt theo vòng
/// quanh tâm (không rút số ngẫu nhiên để nhịp ngẫu nhiên của ván không đổi), đẩy ra khỏi tường / vật cản; phần nhìn
/// (plug/loot.js) cho từng món bay ra theo cung rồi mới hiện. Trả dòng "2x Beer, 1x Metal Scraps" như items.give.
export function drop_loot(g, src_id, at, got, name) {
  const ids = [];
  const cnt = new Map();
  for (const it of got) cnt.set(it, (cnt.get(it) || 0) + 1);
  // Một chồng lớn (đạn 30-60 viên) là MỘT mục loot ở bản gốc (LootEntry tách theo MaxStack, combat-raids.md L13.4); vật
  // `Item` ở đây chỉ chứa một món nên chồng trên 12 món vào thẳng ba lô [CHƯA RÕ GỐC: chưa thấy clip nhặt chồng đạn].
  const big = [...cnt].filter(([, c]) => c > 12).map(([it]) => it);
  for (const it of big) items.give(g, got.filter((x) => x === it));
  got = got.filter((x) => !big.includes(x));
  const n = got.length;
  got.forEach((it, k) => {
    // vòng quanh tâm, lệch về phía người chơi để món rơi trong tầm nhìn, cách thân xác robot ~1 m
    const a0 = Math.atan2(g.player.z - at.z, g.player.x - at.x);
    const a = a0 + (k % 2 ? 1.0 : -1.0) * (0.45 + 0.4 * Math.floor(k / 2));
    const r = 0.95 + 0.12 * (k % 3) + (n > 6 ? 0.1 * Math.floor(k / 6) : 0.0);
    let pos = v3(at.x + Math.cos(a) * r, 0.0, at.z + Math.sin(a) * r);
    pos = world.resolve(g, pos, 0.2);
    const did = g.add_prop(game.PropKind.Item(it), v3(pos.x, 0.0, pos.z), a);
    g.props[g.props.length - 1].loose = true; // lưu vào save (save.js `floor`)
    ids.push(did);
  });
  if (g.loot_events === undefined) g.loot_events = [];
  if (g.loot_events.length < 16) g.loot_events.push({ id: src_id, name: name || '', pos: at.clone(), items: got.slice(), drops: ids, bag: big.map((it) => [it, cnt.get(it)]) });
  return [...cnt].map(([it, c]) => `${c}x ${items.iname(it)}`).join(', ');
}

/** Mở gói / thùng thả dù: hàng / vật liệu bung ra đất quanh chỗ mở (nhặt bằng hộp), thứ khác vào ba lô. [par-counter D16]
 *  gói đang cầm thì mở ở chỗ đang trôi trước mặt (`at`). */
export function open_package(g, p, at) {
  const kd = clone_kind(p.kind);
  p.dead = true;
  if (g.held === p.id) g.held = null;
  const pos = at || p.pos;
  // [phiên 7] hàng / vật liệu trong thùng giao bung ra đất quanh thùng (nhặt bằng hộp), thứ khác vào ba lô
  const goods = kd.a.filter((it) => items.box_only(it)), rest = kd.a.filter((it) => !items.box_only(it));
  if (goods.length) drop_loot(g, p.id, pos, goods, kd.k === 'Crate' ? 'Package' : 'Supply drop');
  if (rest.length) items.give(g, rest);
  const s = loot_text(kd.a);
  g.complete('OpenPackage');
  g.play('loot', 0.7);
  g.say(`Received: ${s}`);
}

export function finish_hold(g, t) {
  switch (t.k) {
    case 'Door':
      g.door.hp = game.DOOR_HP;
      g.door.open = g.open;
      g.play('wood', 0.7);
      g.say('Front door repaired.');
      break;
    case 'Station':
      build.finish_hold(g, t.a);
      break;
    case 'Prop': {
      const p = g.prop(t.a);
      if (p === null) return;
      const kd = clone_kind(p.kind);
      switch (kd.k) {
        case 'Item': {
          // [par-counter A10] học xong tờ công thức đang nhắm: tờ dùng hết như học từ ba lô
          if (!is_recipe(kd.a)) break;
          g.inv[kd.a] += 1;
          if (craft.learn(g, kd.a)) { g.inv[kd.a] -= 1; p.dead = true; }
          else { g.inv[kd.a] -= 1; }
          break;
        }
        case 'Pile': {
          p.dead = true;
          const pile_pos = p.pos.clone();
          g.sweep_done += 1;
          g.xp(2, 0);
          g.play('sweep', 0.6);
          g.fxq.push([fx.FX_DUST, pile_pos.add(Y.mul(0.1))]);
          if (g.sweep_done >= 9) {
            g.complete('Sweep');
          }
          break;
        }
        case 'Crate':
        case 'Reward': open_package(g, p); break;
        case 'Corpse': {
          if (kd.b !== false) break;
          p.kind = { k: 'Corpse', a: kd.a, b: true };
          // Đồ trên xác zombie ban ngày (luật gốc): pin 80% x 0..10; rồi theo thứ tự xáo trộn Metal Scrap 0,33, Worn Cloth 0,4
          // (1-2), Beer 0,1 (1-2), Gunpowder 0,4, mỗi lần trúng làm giảm cơ hội các món sau; nút RareLoot thêm Knife, 9mm, Pistol.
          const n = g.rng.chance(0.8) ? g.rng.int(0, 10) : 0;
          g.batteries += n;
          g.stats.other += n;
          g.stats.loot += n;
          const table = [[game.METAL_SCRAP, 0.33, 1, 1], [game.CLOTH, 0.4, 1, 2], [game.BEER, 0.1, 1, 2], [game.GUNPOWDER, 0.4, 1, 1]];
          if (skills.has(g, 'RareLoot')) {
            table.push([game.KNIFE, 0.1, 1, 1], [game.AMMO_9MM, 0.1, 30, 60], [game.PISTOL, 0.02, 1, 1]);
          }
          const got = [];
          let pr = 1.0;
          while (table.length !== 0 && pr > 0.01) {
            const k = clamp(g.rng.int(0, table.length - 1), 0, table.length - 1);
            const [it, ch, mn, mx] = table.splice(k, 1)[0];
            if (g.rng.chance(pr * ch)) {
              const cnt = g.rng.int(mn, mx);
              for (let j = 0; j < cnt; j++) got.push(it);
              pr *= 1.0 - ch;
            }
          }
          const s = game.loot_bag() ? items.give(g, got) : drop_loot(g, p.id, p.pos, got);
          g.complete('LootZombie');
          g.xp(0, 5);
          g.play('loot', 0.7);
          g.say(s.length === 0 ? `Found ${n} batteries.` : `Found ${n} batteries, ${s}.`);
          break;
        }
        case 'Cache': {
          if (kd.c !== false) break;
          p.kind = { k: 'Cache', a: kd.a, b: [], c: true };
          p.dirty = true;
          // Phần nhìn (js/plug/loot.js): nắp mở, từng món bay ra theo cung rồi vào ba lô, mỗi món một dòng "vừa nhặt".
          if (g.loot_events === undefined) g.loot_events = [];
          let s;
          if (game.loot_bag()) {
            if (g.loot_events.length < 16) g.loot_events.push({ id: p.id, name: kd.a, pos: p.pos.clone(), items: kd.b.slice() });
            s = items.give(g, kd.b);
          } else {
            // món đã rơi ra trong lúc lục (spill_cache) + phần còn lại
            const all = (p.spilled || []).concat(kd.b);
            drop_loot(g, p.id, p.pos, kd.b.slice(), kd.a);
            s = loot_text(all);
          }
          g.caches_done += 1;
          if (g.caches_done >= 3) {
            g.complete('Caches');
          }
          g.xp(0, 5);
          g.play('loot', 0.7);
          g.say(`Found: ${s}`);
          break;
        }
        default: break;
      }
      break;
    }
    default: break;
  }
}

/** [ĐỀ XUẤT phiên 7, clip 03 3:20: món bật ra trong lúc "Searching..."] Đang giữ E trên chỗ lục: món rơi ra dần theo tiến độ,
 *  (n món thì mỗi 1/(n+1) thanh một món, món cuối rơi lúc xong). Nhả E giữa chừng: món đã rơi nằm lại, phần còn lại vẫn trong
 *  chỗ lục. Chỉ khi đồ văng ra đất (không `?loot=bag`). */
export function spill_cache(g, id, prog) {
  if (game.loot_bag()) return;
  const p = g.prop(id);
  if (p === null || p.kind.k !== 'Cache' || p.kind.c !== false || p.kind.b.length <= 1) return;
  const done = p.spilled ? p.spilled.length : 0, total = done + p.kind.b.length;
  const want = Math.min(total - 1, Math.floor(prog * (total + 1)));
  if (want <= done) return;
  const out = p.kind.b.splice(0, want - done);
  p.spilled = (p.spilled || []).concat(out);
  drop_loot(g, p.id, p.pos, out, p.kind.a);
  g.play('pick', 0.35);
}
function loot_text(list) {
  const cnt = new Map();
  for (const it of list) cnt.set(it, (cnt.get(it) || 0) + 1);
  return [...cnt].map(([it, c]) => `${c}x ${items.iname(it)}`).join(', ');
}

/** E trên một cục pin: soi, rồi cất vào ngăn kéo. */
export function coin_e(g, i) {
  const pay = g.pay;
  if (pay === null) return;
  g.pay = null;
  const c = i < pay.coins.length ? pay.coins[i] : null;
  if (c !== null) {
    if (!c.checked) {
      c.checked = true;
      if (c.fake) {
        g.seen_fake = true;
        g.play('deny', 0.7);
        g.say('FAKE battery! Bin it [RMB]. Hit the alarm button to confront the customer.');
      } else {
        g.play('click', 0.6);
        g.chk_t = 1.5; // [FTUE A7] gốc gameplay_serving_tutorial1: cầm pin lên thì "Check the battery has the correct charge."
      }
    } else if (c.fake) {
      g.play('deny', 0.6);
      g.say('The drawer refuses a fake battery. Bin it [RMB].');
    } else {
      c.done = 1;
      if (!g.dep_seen) g.dep_seen = new Set();
      g.dep_seen.add(c.value); // [FTUE A7] gốc DepositBattery1..1000Quest: mệnh giá đã từng cất vào ngăn
      pay.credited += c.value;
      g.batteries += c.value;
      g.play('pay', 0.5);
    }
  }
  g.pay = pay;
  g.pay_rev += 1;
}

export function alarm(g) {
  const pay = g.pay;
  if (pay === null) return;
  g.pay = null;
  if (pay.alarm === 0 && pay.coins.some((c) => c.checked && c.fake)) {
    g.play('siren', 0.5);
    if (g.day > 2 && g.rng.chance(0.1)) {
      // 10% (từ ngày 3) khách bỏ chạy: các cục còn lại coi như mất.
      pay.alarm = 2;
      for (const c of pay.coins) {
        if (c.done === 0) {
          c.done = 2;
        }
      }
      g.say('The cheat bolts for the door!');
    } else {
      pay.alarm = 1;
      g.say('The customer pleads for forgiveness.  [LMB] forgive   [RMB] refuse');
    }
  } else if (pay.alarm === 0) {
    g.say('Only hit the alarm after you have found a fake battery.');
  }
  g.pay = pay;
  g.pay_rev += 1;
}

export function press_e(g, t) {
  const hk = held_kind(g);
  switch (t.k) {
    case 'Tag': {
      const it = g.shelves[t.a].slots[t.b];
      if (it !== null) {
        g.panel = { k: 'Price', a: it };
        g.price_slot = [t.a, t.b];
        g.play('click', 0.4);
      }
      break;
    }
    case 'Switch': g.toggle_open(); break;
    case 'Bed':
      if (g.can_sleep()) {
        g.complete('Sleep');
        const wake = build.wake_hour(g);
        g.end_day(wake, 1.0);
        g.mode = 'Summary';
        g.play('sleep', 0.7);
      }
      break;
    case 'Till': if (g.give !== null) actors.give_hand(g); else actors.serve(g); break;
    case 'Drawer': actors.grab_drawer(g, t.a); break;
    case 'Bell': actors.ring_bell(g); break;
    case 'Coin': coin_e(g, t.a); break;
    case 'Alarm': alarm(g); break;
    case 'Station': build.press(g, t.a); break;
    case 'Skip':
      if (hk !== null && hk.k === 'Trash') {
        // Vung tay ném: túi bay theo cung vào thùng, điểm và nhiệm vụ tính lúc túi rơi vào (carry.rs).
        carry.start_toss(g, true);
      } else if (!combat.dispose_held(g, false)) {
        g.say('Bring trash or a corpse here.');
      }
      break;
    case 'Door':
      if (g.door.hp <= 0.0) {
        g.say('Use build mode to repair this object.'); // gốc quest_use_build_mode_repair (DamageableDoorInteractableProxy)
        return;
      }
      if (g.open && g.door.open) {
        g.say('Close the store first.');
        return;
      }
      g.door.open = !g.door.open;
      g.play('door', 0.6);
      break;
    case 'BedDoor': g.say(g.has_hammer() ? 'It is jammed. Hit it with the hammer (LMB).' : 'It is jammed. Find a hammer.'); break;
    case 'Radio':
      g.panel = { k: 'Radio' };
      g.play('radio', 0.5);
      break;
    case 'Shelf': {
      const s = t.a, slot = t.b;
      let src = null;
      if (hk !== null && hk.k === 'Box') src = box_top(hk.a);
      else if (hk !== null && hk.k === 'Item') src = hk.a;
      else if (hk === null && g.inv[g.stock_sel] > 0 && items.sellable(g.stock_sel)) src = g.stock_sel;
      const it = src;
      if (it === null && hover_tag_ok(g.shelves[s], slot)) {
        g.panel = { k: 'Price', a: g.shelves[s].slots[slot] };
        g.price_slot = [s, slot];
        g.play('click', 0.4);
        return;
      }
      if (it === null) {
        g.say('Nothing to place. Carry a box of goods or pick stock with [R].');
        return;
      }
      if (!items.sellable(it)) {
        g.say(`${items.iname(it)} cannot be sold to customers.`);
        return;
      }
      const n = game.case_units();
      const dest = g.shelves[s].place_slot(it, slot, n);
      if (dest === null) {
        g.say('This shelf is full.');
        return;
      }
      if (g.held !== null && hk !== null && hk.k === 'Item') {
        const p = g.prop(g.held);
        if (p !== null) p.dead = true;
        g.held = null;
      } else if (g.held !== null && hk !== null && hk.k === 'Box') {
        const p = g.prop(g.held);
        if (p !== null) {
          if (p.kind.k === 'Box') {
            const bi = p.kind.a.lastIndexOf(it);
            if (bi >= 0) p.kind.a.splice(bi, 1);
          }
          p.dirty = true;
        }
      } else {
        g.inv[it] -= 1;
        if (g.inv[it] === 0) {
          const list = g.sellable_in_inv();
          if (list.length > 0) {
            g.stock_sel = list[0];
          }
        }
      }
      g.shelves[s].put(dest, it, n);
      if (n > 1) g.say(`${items.iname(it)} x${g.shelves[s].units(dest)} on the shelf (one case = ${n})`);
      g.complete('Shelve');
      g.play('place', 0.5);
      break;
    }
    case 'Prop': {
      const id = t.a;
      const drag = g.on(game.FF_CORPSES);
      const p = g.prop(id);
      if (p === null) return;
      const kd = clone_kind(p.kind);
      if (build.loose(p) && build.shelf_dims(kd.a) !== null) {
        // gốc ShelfObject.Interact trên kệ chưa cố định: thông báo quest_use_build_mode
        g.say('Use build mode to move and place this item.');
      } else if (kd.k === 'Corpse' && kd.b === true && !drag) {
        // nothing
      } else if (kd.k === 'BoxPile') {
        if (g.held !== null) {
          g.say('Your hands are full. [X] to drop.');
          return;
        }
        const live = g.props.filter((q) => !q.dead && q.kind.k === 'Box').length;
        if (live >= game.BOX_PILE_MAX) {
          g.say(`There are already ${live} boxes around the store. Use one of those.`);
          g.play('deny', 0.4);
          return;
        }
        const bid = g.add_prop(game.PropKind.Box([]), p.pos.add(v3(0.0, 0.0, 0.55)), 0.3);
        g.held = bid;
        g.armed = false;
        g.cb.throw_item = null;
        g.play('pick', 0.6);
        g.complete('PickBox');
      } else if (kd.k === 'Box' && hk !== null && hk.k === 'Item') {
        if (!box_fits(g, kd.a, hk.a)) {
          g.say(`${box_full_text(g, kd.a, hk.a)}.`);
          g.play('deny', 0.4);
          return;
        }
        const ip = g.prop(g.held);
        if (ip !== null) ip.dead = true;
        g.held = null;
        p.kind.a.push(hk.a);
        p.dirty = true;
        g.play('pick', 0.5);
      } else if (kd.k === 'Trash' || kd.k === 'Box' || kd.k === 'Crate' || (kd.k === 'Corpse' && kd.b === true)) {
        const is_box = p.kind.k === 'Box';
        const p_kind = clone_kind(p.kind);
        if (g.held !== null) {
          g.say('Your hands are full. [X] to drop.');
          return;
        }
        g.held = id;
        g.armed = false;
        g.cb.throw_item = null;
        g.play('pick', 0.6);
        if (p_kind.k === 'Corpse') {
          carry.grab(g, id);
        }
        if (is_box) {
          g.complete('PickBox');
        }
      } else if (kd.k === 'Item') {
        const it = kd.a;
        const bx = g.held !== null ? g.prop(g.held) : null;
        // món không bắt buộc vào hộp (vũ khí, thuốc...) mà không vừa hộp thì vào ba lô như khi không cầm hộp
        if (bx !== null && bx.kind.k === 'Box' && (items.box_only(it) || box_fits(g, bx.kind.a, it))) {
          if (!box_fits(g, bx.kind.a, it)) {
            g.say(`${box_full_text(g, bx.kind.a, it)}. Stock a shelf, or [X] drop it and take another box.`);
            g.play('deny', 0.4);
            return;
          }
          p.dead = true;
          bx.kind.a.push(it);
          bx.dirty = true;
          g.complete('FillBox');
        } else if (items.box_only(it)) {
          if (g.held !== null) {
            g.say('Hands full. Need a box to carry more: take one from the cardboard box pile.');
            g.play('deny', 0.4);
            return;
          }
          // một món trên tay như hộp nhỏ: chặn vũ khí, [E] lên kệ / vào hộp, [X] thả
          g.held = id;
          g.armed = false;
          g.cb.throw_item = null;
          g.say(`Carrying ${items.iname(it)} by hand. Need a box to carry more. [E] a shelf to stock it, [X] drop.`);
        } else {
          p.dead = true;
          items.give(g, [it]);
          g.say(`Took ${items.iname(it)}.`);
        }
        g.play('pick', 0.5);
      } else if (kd.k === 'Notes') {
        if (g.day >= 3) { g.panel = { k: 'Notes', page: 0 }; g.notes_read = true; g.play('pick', 0.4); } // [par-panels] C23
      } else if (kd.k === 'Hammer') {
        p.dead = true;
        items.give(g, [game.HAMMER]);
        g.armed = g.held === null;
        g.complete('Hammer');
        g.play('pick', 0.7);
        g.say('Hammer equipped. [LMB] swing, [1] hands, [2] weapon.');
      } else if (kd.k === 'Placed' && kd.a === game.TURRET) {
        g.bld.mounted = id;
        g.armed = false;
        g.play('click', 0.6);
        g.say('Manning the turret: [LMB] fire, [R] load 556 Ammo, [E] leave.');
      } else if (kd.k === 'Placed' && kd.a === game.AUTO_MINIGUN) {
        const aux = trunc(p.aux);
        const n = Math.min(g.inv[game.AMMO_556], 9999 - aux);
        if (n > 0) {
          const q = g.prop(id);
          if (q !== null) {
            q.aux += n;
          }
          g.inv[game.AMMO_556] -= n;
          g.play('reload', 0.6);
          g.say(`Loaded ${n} rounds into the Auto Minigun.`);
        } else {
          g.say('No 556 Ammo to load.');
        }
      } else if (kd.k === 'Placed' && kd.a === game.TV) {
        // [PARITY M03] gốc TelevisionObject.Interact chỉ bật / tắt màn (_turnedOn), không có bản tin
        const q = g.prop(id);
        if (q !== null) {
          q.aux = q.aux > 0 ? 0 : 1;
          q.kind.b = q.aux > 0;
          q.dirty = true;
        }
        g.play('click', 0.5);
      } else if (kd.k === 'Placed' && is_seat(kd.a) && g.held === null) {
        // [par-counter D35] gốc "Sit" (loc:gameplay_interaction_sit): ngồi xuống ghế, đứng dậy khi đi
        g.sit = id;
        g.player = v3(p.pos.x, 0.0, p.pos.z);
        ctx_feel_stop(g);
        g.play('click', 0.3);
      }
      break;
    }
    case 'None': break;
  }
}

/** [par-counter A10] món là tờ công thức. */
export function is_recipe(item) {
  return !!(data.INFO[item] && data.INFO[item].usage && data.INFO[item].usage.k === 'Recipe');
}
/** [par-counter D35] vật dựng ngồi được: ghế, ghế đẩu, sofa (catalog). */
export function is_seat(item) {
  const k = catalog.CAT[item] ? catalog.CAT[item].key : '';
  return /Chair|Stool|Sofa/.test(k);
}
function ctx_feel_stop(g) { g.sit_t = 0; }

export function start_game(g, skip) {
  g.mode = 'Play';
  g.fade = 1.0;
  g.panel = { k: 'None' };
  if (skip) {
    g.skip_intro();
  } else {
    g.start_cine(cine.OPENING);
  }
  g.play('click', 0.6);
}
export function player_system(g, dt_raw, ctx) {
  const dt = Math.min(dt_raw, 0.05);
  const keys = ctx.keys, mouse = ctx.mouse, motion = ctx.motion, cursor = ctx.cursor, feel = ctx.feel, quality = ctx.quality;
  const cam = cam_of(ctx);
  const click = mouse.just_pressed('Left');
  const enter = keys.just_pressed('Enter') || keys.just_pressed('Space');
  // Nhật ký phím E (phiên 8: tìm nguyên nhân công tắc 13:00 bỏ lần bấm đầu). Bot đọc window.__twtEdbg.
  const eRec = keys.just_pressed('KeyE') ? { f: (globalThis.__twtEf = (globalThis.__twtEf || 0) + 1), mode: g.mode, cine: g.cine ? g.cine[0] : -1, panel: g.panel.k, at: 'start' } : null;
  if (eRec) { const L = (globalThis.__twtEdbg = globalThis.__twtEdbg || []); L.push(eRec); if (L.length > 40) L.shift(); }

  // Khoá chuột khi bấm vào game; Esc nhả.
  if (cursor.locked && !web.pointer_locked()) {
    feel.unlock_t += dt;
    if (feel.unlock_t > 0.6) {
      cursor.unlock();
    }
  } else {
    feel.unlock_t = 0.0;
  }
  if (click && !cursor.locked && !feel.nolock) {
    cursor.lock();
  }

  switch (g.mode) {
    case 'Title': {
      feel.title_t += dt;
      const a = feel.title_t * 0.05;
      cam.pos = lay.TITLE_CAM.add(v3(Math.sin(a) * 3.0, 0.0, Math.cos(a) * 1.5));
      cam_look_at(cam, lay.TITLE_LOOK);
      if (g.panel.k === 'Saves') {
        // Bảng chọn ô lưu.
        if (keys.just_pressed('KeyS') || keys.just_pressed('ArrowDown')) {
          g.slot = Math.min(g.slot + 1, save.SLOTS - 1);
        }
        if (keys.just_pressed('KeyW') || keys.just_pressed('ArrowUp')) {
          g.slot = Math.max(0, g.slot - 1);
        }
        const rewind = keys.just_pressed('KeyR');
        if (keys.just_pressed('Enter') || rewind) {
          const slot = g.slot;
          if (save.load(g, slot, rewind)) {
            g.mode = 'Play';
            g.panel = { k: 'None' };
            g.play('click', 0.6);
          } else {
            g.play('deny', 0.5);
          }
        } else if (keys.just_pressed('KeyX')) {
          save.delete(g.slot);
          g.play('trash', 0.5);
        } else if (keys.just_pressed('KeyN')) {
          save.delete(g.slot);
          start_game(g, false);
        } else if (keys.just_pressed('KeyV') || keys.just_pressed('Escape')) {
          g.panel = { k: 'None' };
        }
        return;
      }
      if (keys.just_pressed('KeyK')) {
        g.slot = save.free_slot(g.slot);
        start_game(g, true);
      } else if (keys.just_pressed('KeyC')) {
        const slot = save.last_slot();
        if (slot !== null && save.load(g, slot, false)) {
          g.mode = 'Play';
          g.play('click', 0.6);
        } else {
          g.say('No saved game found.');
          g.play('deny', 0.5);
        }
      } else if (g.on(game.FF_SAVES) && keys.just_pressed('KeyV')) {
        g.panel = { k: 'Saves' };
      } else if (enter || click) {
        g.slot = save.free_slot(g.slot);
        start_game(g, false);
      }
      return;
    }
    case 'Summary':
      if (enter || click) {
        g.mode = 'Play';
        g.play('wake', 0.6);
        g.fade = 1.0;
        if (!g.is_done('OpenPackage') && g.props.some((p) => p.kind.k === 'Crate' && !p.dead)) {
          g.start_cine(cine.DELIVERY);
        } else if ((g.ff & game.FF_ACTS) !== 0) {
          g.start_cine(cine.NEW_DAY);
        }
      }
      break;
    case 'Dead':
      if (enter || click) {
        g.wake_up();
        g.fade = 1.0;
        if ((g.ff & game.FF_ACTS) !== 0) {
          g.start_cine(cine.WAKE_UP);
        }
      }
      break;
    case 'Play': break;
  }

  // Cắt cảnh: máy quay chạy theo kịch bản, Enter / bấm chuột bỏ qua.
  if (g.cine !== null) {
    const kind = g.cine[0];
    const t = g.cine[1] + dt;
    for (const n of ViewModels) {
      n.set_visible(false);
    }
    const smp = cine.sample(kind, t, g.player);
    if (smp !== null && !((enter || click) && t > 0.4 && !cine.NO_SKIP.has(kind)) && g.mode === 'Play') {
      const [p, l] = smp;
      cam.pos = p.clone();
      cam_look_at(cam, l);
      g.cine = [kind, t];
      g.prompt = '';
      return;
    } else {
      g.cine = null;
      g.fade = 0.6;
      if (kind === cine.DEATH && g.hp <= 0.0) {
        g.mode = 'Dead';
        return;
      }
    }
  }

  if (keys.just_pressed('Escape')) {
    if (g.panel.k === 'Pause') {
      g.panel = { k: 'None' };
    } else if (g.panel.k === 'Settings' && g.panel.from === 'Pause') {
      g.panel = { k: 'Pause', sel: 1 };
    } else if (g.panel.k !== 'None') {
      g.panel = { k: 'None' };
    } else if (g.desk) {
      // [par-counter D13] "ESC Leave": rời chế độ đứng quầy
      leave_desk(g);
    } else if (g.bld.ghost !== null || g.bld.mode) {
      // chế độ xây (fin-build): Esc huỷ bóng / ra khỏi chế độ xây ở đoạn chế độ xây bên dưới
    } else if (g.mode === 'Play' && g.cine === null) {
      // [par-panels] bản gốc: Esc mở bảng "GAME PAUSED" (op/13-pause); thời gian đứng (main.js)
      g.panel = { k: 'Pause', sel: 0 };
      cursor.unlock();
    } else {
      cursor.unlock();
    }
  }
  if (!mouse.pressed('Left')) {
    g.bld.lmb_block = false;
  }
  if (g.desk && (g.mode !== 'Play' || g.hp <= 0.0 || g.player.distance(v3(DESK_STAND.x, g.player.y, DESK_STAND.z)) > 0.6)) leave_desk(g);
  if (g.give !== null && (g.give.c.gone || g.give.c.state === 'Leave')) g.give = null;

  // Nhìn: chuột hoặc phím mũi tên.
  const playing = g.mode === 'Play';
  if (playing && g.panel.k === 'None') {
    const sens = 0.0023 * g.sens;
    g.yaw -= motion.x * sens;
    g.pitch -= motion.y * sens * (g.invert ? -1.0 : 1.0);
    const kx = b(keys.pressed('ArrowLeft')) - b(keys.pressed('ArrowRight'));
    const ky = b(keys.pressed('ArrowUp')) - b(keys.pressed('ArrowDown'));
    g.yaw += kx * dt * 2.2;
    g.pitch += ky * dt * 1.6;
    g.pitch = clamp(g.pitch, -1.45, 1.45);
  }
  const rot = q_euler('YXZ', g.yaw, g.pitch, 0.0);
  const fwd = q_rot(rot, NEG_Z);
  const flat_f = v3(-Math.sin(g.yaw), 0.0, -Math.cos(g.yaw));
  const flat_r = v3(flat_f.z, 0.0, -flat_f.x).mul(-1.0);

  // Tháp súng đang ngồi: đứng yên sau tháp, mắt ở tầm nòng.
  let mounted = null;
  if (g.bld.mounted !== null) {
    const mp = g.props.find((p) => p.id === g.bld.mounted && !p.dead);
    mounted = mp === undefined ? null : mp.pos.clone();
  }
  if (g.bld.mounted !== null && mounted === null) {
    g.bld.mounted = null;
  }

  // Đi: 5 m/s, chạy x1,4 (x hệ số kỹ năng), nhảy. Đang dùng thuốc đi chậm còn một nửa, đang lấy đà ném còn 0,85.
  let wish = ZERO;
  // [par-counter D35] đang ngồi: không đi; bấm phím đi hay nhảy thì đứng dậy, bước ra trước ghế
  if (g.sit) {
    const sp = g.props.find((p) => p.id === g.sit && !p.dead);
    if (sp === undefined || !playing || ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].some((k) => keys.just_pressed(k))) {
      g.sit = null;
      g.player = world.resolve(g, g.player.add(flat_f.mul(0.6)), 0.3);
    } else {
      g.player = v3(sp.pos.x, 0.0, sp.pos.z);
      feel.vel = ZERO;
    }
  }
  if (playing && g.panel.k === 'None' && mounted === null && !g.desk && !g.sit) {
    const f = b(keys.pressed('KeyW')) - b(keys.pressed('KeyS'));
    const s = b(keys.pressed('KeyD')) - b(keys.pressed('KeyA'));
    wish = flat_f.mul(f).add(flat_r.mul(s)).normalize_or_zero();
    const sprint = keys.pressed('ShiftLeft') || keys.pressed('ShiftRight');
    const sm = skills.mul(g, 'SprintSpeedMultiplier');
    wish = wish.mul(sprint ? 7.0 * (sm > 0.0 ? sm : 1.0) : 5.0);
    if (carry.dragging(g)) {
      // Kéo xác: đi chậm [ĐỀ XUẤT].
      const l = wish.length();
      if (l > 3.0) wish = wish.mul(3.0 / l);
    }
    if (g.heal_job !== null) {
      wish = wish.mul(0.5);
    } else if (g.cb.charge > 0.0) {
      wish = wish.mul(0.85);
    }
    if (keys.just_pressed('Space') && g.player.y <= 0.001) {
      g.vel_y = 4.6;
    }
  }
  const accel = wish.length_squared() > 0.0 ? 34.0 : 26.0;
  const dv = wish.sub(feel.vel);
  const step = Math.min(accel * dt, dv.length());
  feel.vel = feel.vel.add(dv.normalize_or_zero().mul(step));
  const before = g.player.clone();
  let np = g.player.add(v3(feel.vel.x, 0.0, feel.vel.z).mul(dt));
  np = world.resolve(g, v3(np.x, 0.0, np.z), 0.3);
  g.vel_y -= 14.0 * dt;
  let y = g.player.y + g.vel_y * dt;
  if (y <= 0.0) {
    y = 0.0;
    g.vel_y = 0.0;
  }
  g.player = v3(np.x, y, np.z);
  const moved = v3(np.x - before.x, 0.0, np.z - before.z).length();
  if (y <= 0.001 && moved > 0.0005) {
    feel.bob += moved;
    feel.step += moved;
    if (feel.step > 1.7) {
      feel.step = 0.0;
      g.play(game.Game.in_shop(g.player) || game.Game.in_bedroom(g.player) ? 'stepw' : 'step', 0.35);
    }
  }
  if (game.Game.in_shop(g.player)) {
    // [FTUE A9] gốc TutorialCleanUpCutscenePlayTrigger: chỉ ngày 1, lần đầu vào quán, cảnh lướt rác 7 s
    if (g.day === 1 && !g.is_done('EnterShop') && !g.is_done('Trash')) g.start_cine(cine.CLEANUP);
    g.complete('EnterShop');
  }
  const bob = v3(Math.cos(feel.bob * 1.85) * 0.013, Math.abs(Math.sin(feel.bob * 3.7)) * 0.024, 0.0);
  const eye = mounted !== null ? mounted.add(Y.mul(1.5)).sub(flat_f.mul(0.35)) : g.player.add(Y.mul(EYE - 0.5 * g.fx2.crouch));
  // Hình vũ khí cầm tay: dựng lại hai lưới khi đổi món; tư thế, giật, nạp đạn, đung đưa do fp.rs tính bằng lò xo.
  g.swing = Math.max(g.swing - dt, 0.0);
  const cw = g.cur_w();
  // [par-counter D20] đang giữ cưa xích Hulk / cửa phòng y tế: Chainsaw hiện trong tay như gốc (c01 5:00), tia lửa ở chỗ cưa
  // [par-combat] đang chế tạo (bảng đóng): tay cầm búa gõ lên bàn như gốc (c01 4:03:00), chỉ để hiện
  const crafting = g.craft_job !== null && g.panel.k === 'None';
  const wcur = g.sawing ? game.CHAINSAW : crafting ? game.HAMMER : cw !== null ? cw.item : g.cb.throw_item !== null ? g.cb.throw_item : g.med_hand;
  const free = g.bld.ghost === null && mounted === null && playing;
  // Tay bận (xách rác, ôm hộp, kéo xác, cầm chổi): carry.rs vẽ; không thì vũ khí của fp.rs.
  carry.tick(g, playing ? dt : 0.0, eye, rot, flat_f, flat_r);
  const ckey = free ? carry.vm_key(g) : null;
  // Chế độ xây: tay cầm búa (bản gốc: ô 2 "Build", búa trong tay khi đặt, clip 10 1:57 / 3:16), không cầm món đang đặt.
  const building = (g.bld.ghost !== null || g.bld.mode) && mounted === null && playing;
  const cur = building ? game.HAMMER : ckey !== null ? ckey : wcur;
  const show = building || (free && (ckey !== null || (wcur !== null && g.held === null)));
  const sprinting = (keys.pressed('ShiftLeft') || keys.pressed('ShiftRight')) && v3(feel.vel.x, 0.0, feel.vel.z).length() > 5.5;
  const shift_now = keys.just_pressed('ShiftLeft') || keys.just_pressed('ShiftRight');
  feel.shift_t += dt;
  if (shift_now) {
    feel.tac = feel.shift_t < 0.3;
    feel.shift_t = 0.0;
  }
  if (!sprinting && feel.shift_t > 0.3) {
    feel.tac = false;
  }
  const gun_held = !building && ckey === null && wcur !== null && wcur < data.INFO.length && items.gun(wcur) !== null;
  let wall_d = 9.0;
  if (gun_held) {
    const h = fp.ray_world(g, eye, fwd, 1.2);
    wall_d = h !== null ? h[0] : 9.0;
  }
  const pose_in = {
    item: show && ckey === null ? cur : null,
    bob: feel.bob,
    sprinting,
    dt,
    ads: gun_held && playing && g.panel.k === 'None' && mouse.pressed('Right') && find_target(g, eye, fwd)[0].k !== 'Shelf',
    tac: feel.tac,
    crouch: (playing && g.panel.k === 'None' && keys.pressed('ControlLeft')) || !!g.sit,
    wall_d,
    inspect: gun_held && playing && g.panel.k === 'None' && keys.just_pressed('KeyT'),
    bash: gun_held && playing && g.panel.k === 'None' && keys.just_pressed('KeyZ'),
  };
  if (pose_in.bash) {
    g.play('swing', 0.45);
  }
  let [t_main, t_off, view, shake] = fp.pose(g, pose_in);
  if (typeof ctx.shake_scale === 'number' && ctx.shake_scale !== 1) shake = shake.mul(ctx.shake_scale); // [par-panels] Settings > Camera Shake
  if (ckey !== null) {
    [t_main, t_off] = carry.pose(g, ckey, eye, rot, feel.bob);
  } else {
    carry.clear_vm(g);
  }
  cam.pos = eye.add(q_rot(rot, bob.add(shake)));
  cam.quat = q_mul(rot, q_euler('XYZ', view.x, view.y, view.z + shake.x * 0.4));
  const rebuild = show && feel.vm_item !== cur;
  if (rebuild) {
    feel.vm_item = cur;
  }
  const main_mb = new geom.MB(), off_mb = new geom.MB();
  if (rebuild) {
    if (ckey !== null) carry.build_vm(g, ckey, main_mb, off_mb);
    else fp.build_vm(cur !== null ? cur : game.HAMMER, main_mb, off_mb);
    fp.VM_OPTS.grips = [main_mb.grips || [], off_mb.grips || []];
    fp.VM_OPTS.rev = (fp.VM_OPTS.rev || 0) + 1;
  }
  ViewModels.forEach((node, part) => {
    if (rebuild) {
      const mb = part === 0 ? main_mb : off_mb;
      if (mb.is_empty()) {
        mb.cube(v3(0.0, -5.0, 0.0), v3(0.01, 0.01, 0.01), [0.0, 0.0, 0.0], geom.FLAT);
      }
      node.set_mesh(mb.build());
    }
    node.set_visible(show);
    node.set_tr(tr_of(part === 0 ? t_main : t_off));
  });
  if (!playing) {
    return;
  }

  stow_materials(g);
  const [target, _hit] = find_target(g, eye, fwd);
  g.hover_tag = hover_tag_for(g, target);
  // Phần nhìn (plug/loot.js) sáng viền chỗ lục đang nhắm.
  g.look_id = target.k === 'Prop' ? target.a : 0;
  g.look_grab = 0; // vật Grab được đang nhắm (plug/outline.js vẽ viền trắng); đặt ở đoạn Grab bên dưới
  g.look_tag = target.k === 'Tag' ? [target.a, target.b] : null; // phần nhìn (plug/pricetag.js) sáng viền thẻ đang nhắm
  g.prompt = prompt_for(g, target);
  { const hk = held_kind(g); if (hk !== null && hk.k === 'Trash' && g.prompt === '' && g.cy.toss === null) g.prompt = '[LMB] Drop'; } // [par-counter D06]
  { const hk = held_kind(g); if (hk !== null && hk.k === 'Crate') g.prompt = '[LMB] Drop   [RMB] Open'; } // [par-counter D16] gốc c01 5:05
  { const hk = held_kind(g); if (hk !== null && hk.k === 'Corpse' && g.prompt === '') g.prompt = '[LMB] Drop'; } // [par-counter D15] gốc clip 08 f_3690
  // [par-counter C34] hộp đề nghị đang hiện: chuỗi lời nhắc là câu của hộp (bot và ô lựa chọn đọc), nhắm đâu cũng vậy
  const of0 = actors.offer_of(g);
  if (of0 !== null) g.prompt = `${actors.offer_text(g, of0)}   [LMB] Accept   [RMB] Decline`;
  // [par-counter A07] khách bị thương / ứng viên: lựa chọn chuột trái / phải như gốc (thay phím Y / N / H)
  g.alt_pick = null;
  if ((g.prompt.length === 0 || g.prompt === 'Counter' || g.prompt === DESK_PROMPT) && actors.medical_near(g) !== null) {
    const ci = actors.medical_near(g);
    g.prompt = ci !== null && g.customers[ci].inf ? 'Infected survivor   [LMB] Give The Cure   [RMB] Send away' : '[LMB] Give medicine   [RMB] Send away'; // [par-counter D33]
    g.alt_pick = 'med';
  }
  if (g.prompt.length === 0 || g.prompt === 'Counter' || g.prompt === DESK_PROMPT) {
    const i = staff.candidate_near(g);
    if (i !== null && (g.ff & game.FF_STAFF) !== 0) {
      g.prompt = `${g.staff[i].name} (free, wage ${g.staff[i].wage}/day)   [LMB] Hire   [RMB] Send away`;
      g.alt_pick = 'hire';
    }
  }
  // [FTUE A4] gốc (PARITY K01, c01 8:09:40): nhắm nhân viên đã thuê thì "Assign Job" mở bảng Select Job cho đúng người đó
  // (newbie bot: chevron "You're Hired!" trỏ vào Robin mà nhắm vào Robin không có lời nhắc nào)
  g.assign_pick = null;
  if (g.prompt.length === 0 && target.k === 'None' && g.held === null) {
    const hired = g.staff.filter((x) => x.hired && !x.gone);
    let best = null;
    for (let k = 0; k < hired.length; k++) {
      const to = v3(hired[k].pos.x - g.player.x, 0.0, hired[k].pos.z - g.player.z);
      const d = to.length();
      if (d < 2.6 && d > 0.05 && to.normalize_or_zero().dot(flat_f) > 0.8 && (best === null || d < best[1])) best = [k, d];
    }
    if (best !== null) {
      g.assign_pick = best[0];
      g.prompt = `${hired[best[0]].name}   [E] Assign Job`;
    }
  }
  items.tick_jobs(g, dt);

  // Bảng đang mở.
  switch (g.panel.k) {
    case 'Price': {
      const item = g.panel.a;
      const big = keys.pressed('ShiftLeft') || keys.pressed('ShiftRight');
      const st = big ? 10 : 1;
      let p = g.prices[item];
      if (keys.just_pressed('ArrowUp') || keys.just_pressed('Equal') || keys.just_pressed('NumpadAdd') || keys.just_pressed('KeyD')) {
        p += st;
      }
      if (keys.just_pressed('ArrowDown') || keys.just_pressed('Minus') || keys.just_pressed('NumpadSubtract') || keys.just_pressed('KeyA')) {
        p -= st;
      }
      if (keys.just_pressed('KeyR')) {
        p = Math.max(items.ival(item), 1);
      }
      // [par-panels] C22: [1] Available for purchase, [2] Ignore by Cleaner staff (cho cả loại món, như "Set for all")
      if (keys.just_pressed('Digit1')) { g.avail[item] = !(g.avail[item] !== false); g.play('click', 0.4); }
      if (keys.just_pressed('Digit2')) { g.noclean[item] = !(g.noclean[item] === true); g.play('click', 0.4); }
      p = clamp(p, 1, 99999);
      if (p !== g.prices[item]) {
        g.prices[item] = p;
        g.play('click', 0.4);
      }
      if (keys.just_pressed('Enter') || keys.just_pressed('KeyQ') || keys.just_pressed('KeyE')) {
        g.panel = { k: 'None' };
        g.complete('SetPrice');
      }
      return;
    }
    case 'Radio': {
      ['Digit1', 'Digit2'].forEach((key, k) => {
        if (keys.just_pressed(key)) {
          const cost = [2, 3][k];
          if (g.scav[k]) {
            g.say('That run is already under way.');
          } else if (g.batteries < cost) {
            g.say('Not enough batteries.');
            g.play('deny', 0.5);
          } else {
            g.batteries -= cost;
            g.stats.outgoings += cost;
            g.scav[k] = true;
            // Bảng đồ nhặt: Outer City Depots (đồ nghề), Exit Tunnel (đồ hộp).
            const pool = k === 0 ? [game.TAPE, game.PIPE, game.NAILS, game.WIRING, game.CLOTH, game.NAILS, game.WIRING] : [game.TIN, game.TIN, game.TIN, game.BEANS, game.FRUIT, game.BEER, game.CLOTH];
            const cnt = g.rng.int(3, 5);
            for (let j = 0; j < cnt; j++) {
              const it = g.rng.pick(pool);
              g.scav_pending.push(it);
            }
            g.play('pay', 0.5);
            g.say('Scavenge run sent. The crate arrives tomorrow morning.');
          }
        }
      });
      if (keys.just_pressed('KeyE') || keys.just_pressed('Enter')) {
        g.panel = { k: 'None' };
      }
      return;
    }
    case 'Todo':
      if (keys.just_pressed('KeyL') || keys.just_pressed('KeyE') || keys.just_pressed('Enter')) {
        g.panel = { k: 'None' };
      } else if (keys.just_pressed('F1')) {
        g.panel = { k: 'Help' };
      }
      return;
    case 'Help':
      if (keys.just_pressed('Tab') || keys.just_pressed('KeyL') || keys.just_pressed('Enter') || keys.just_pressed('F1')) {
        g.panel = { k: 'None' };
      }
      return;
    case 'Bag': {
      const n = items.bag_rows(g).length;
      if (keys.just_pressed('KeyS') || keys.just_pressed('ArrowDown')) {
        g.bag_sel = Math.min(g.bag_sel + 1, Math.max(0, n - 1));
      }
      if (keys.just_pressed('KeyW') || keys.just_pressed('ArrowUp')) {
        g.bag_sel = Math.max(0, g.bag_sel - 1);
      }
      g.bag_sel = Math.min(g.bag_sel, Math.max(0, n - 1));
      if (keys.just_pressed('Enter')) {
        items.bag_act(g);
      }
      if (keys.just_pressed('KeyX')) {
        // Thả một món ra sàn trước mặt.
        const rows = items.bag_rows(g);
        const row = g.bag_sel < rows.length ? rows[g.bag_sel] : null;
        if (row !== null && row.k === 'Item') {
          const i = row.a;
          g.inv[i] -= 1;
          const spot = world.resolve(g, g.player.add(flat_f.mul(0.9)), 0.2);
          g.add_prop({ k: 'Item', a: i }, v3(spot.x, 0.0, spot.z), g.yaw);
          g.props[g.props.length - 1].loose = true;
          g.play('drop', 0.5);
        }
      }
      if (keys.just_pressed('KeyL')) {
        g.panel = { k: 'Help' };
      } else if (keys.just_pressed('Tab') || keys.just_pressed('KeyE')) {
        g.panel = { k: 'None' };
      }
      return;
    }
    case 'Skills': {
      const n = skills.nodes_of(Math.min(g.sk.tab, 3)).length;
      if (keys.just_pressed('KeyS') || keys.just_pressed('ArrowDown')) {
        g.sk.sel = Math.min(g.sk.sel + 1, Math.max(0, n - 1));
      }
      if (keys.just_pressed('KeyW') || keys.just_pressed('ArrowUp')) {
        g.sk.sel = Math.max(0, g.sk.sel - 1);
      }
      if (keys.just_pressed('KeyD') || keys.just_pressed('ArrowRight')) {
        g.sk.tab = (g.sk.tab + 1) % 4;
        g.sk.sel = 0;
      }
      if (keys.just_pressed('KeyA') || keys.just_pressed('ArrowLeft')) {
        g.sk.tab = (g.sk.tab + 3) % 4;
        g.sk.sel = 0;
      }
      if (keys.just_pressed('Enter')) {
        const list = skills.nodes_of(Math.min(g.sk.tab, 3));
        const idx = Math.min(g.sk.sel, Math.max(0, list.length - 1));
        if (idx < list.length) {
          skills.unlock(g, list[idx]);
        }
      }
      if (keys.just_pressed('KeyK') || keys.just_pressed('KeyE')) {
        g.panel = { k: 'None' };
      }
      return;
    }
    case 'Trade':
      events.keys(g, keys);
      return;
    case 'Pay':
    case 'Saves':
      g.panel = { k: 'None' };
      return;
    case 'Details': {
      // Bảng Item Details (gốc op/05): nút Est. Value, -1, -10%, +1, +10% và 3 công tắc. Phím: A / D (hay mũi tên) -1 / +1,
      // giữ Shift thì -10% / +10%, R Est. Value, 1 / 2 / 3 công tắc; con trỏ nhả thì bấm thẳng nút (hud.js, items.det_act).
      const big = keys.pressed('ShiftLeft') || keys.pressed('ShiftRight');
      const it = g.panel.a, pid = g.panel.b || 0;
      if (keys.just_pressed('KeyA') || keys.just_pressed('ArrowLeft') || keys.just_pressed('Minus') || keys.just_pressed('NumpadSubtract')) items.det_act(g, it, pid, big ? 'm10' : 'm1');
      if (keys.just_pressed('KeyD') || keys.just_pressed('ArrowRight') || keys.just_pressed('Equal') || keys.just_pressed('NumpadAdd')) items.det_act(g, it, pid, big ? 'p10' : 'p1');
      if (keys.just_pressed('KeyR')) items.det_act(g, it, pid, 'est');
      if (keys.just_pressed('Digit1')) items.det_act(g, it, pid, 'avail');
      if (keys.just_pressed('Digit2')) items.det_act(g, it, pid, 'clean');
      if (keys.just_pressed('Digit3')) items.det_act(g, it, pid, 'all');
      if (keys.just_pressed('Escape') || keys.just_pressed('Enter') || keys.just_pressed('KeyE') || mouse.just_pressed('Right')) {
        g.panel = { k: 'None' };
      }
      return;
    }
    case 'Craft': {
      const n = g.craft_tab === 0 ? craft.recipes(g).length : craft.shreddable(g).length;
      if (keys.just_pressed('KeyS') || keys.just_pressed('ArrowDown')) {
        g.craft_sel = Math.min(g.craft_sel + 1, Math.max(0, n - 1));
        if (g.craft_tab === 0) craft.cat_skip(g, 1);
      }
      if (keys.just_pressed('KeyW') || keys.just_pressed('ArrowUp')) {
        g.craft_sel = Math.max(0, g.craft_sel - 1);
        if (g.craft_tab === 0) craft.cat_skip(g, -1);
      }
      if (keys.just_pressed('KeyD')) {
        g.craft_plan = Math.min(g.craft_plan + 1, 99);
      }
      if (keys.just_pressed('KeyA')) {
        g.craft_plan = Math.max(g.craft_plan - 1, 1);
      }
      if (keys.just_pressed('Tab')) {
        g.craft_tab = 1 - g.craft_tab;
        g.craft_sel = 0;
      }
      // [par-panels] tab loại của bảng chế tạo gốc (ALL, Ammo, ...): chỉ dời ô chọn tới món đầu của loại, danh sách giữ nguyên
      if (keys.just_pressed('ArrowRight') || keys.just_pressed('ArrowLeft')) {
        craft.cat_step(g, keys.just_pressed('ArrowRight') ? 1 : -1);
      }
      if (keys.just_pressed('Enter')) {
        craft.act(g);
      }
      if (keys.just_pressed('KeyX') && g.craft_job !== null) {
        g.craft_job = null;
        g.craft_queue = 0;
        g.say('Crafting cancelled. Nothing was used up.');
      }
      if (keys.just_pressed('KeyC') || keys.just_pressed('KeyE')) {
        g.panel = { k: 'None' };
      }
      return;
    }
    case 'Map': {
      const n = map.visible(g).length;
      if (keys.just_pressed('KeyS') || keys.just_pressed('ArrowDown')) {
        g.lm_sel = Math.min(g.lm_sel + 1, Math.max(0, n - 1));
      }
      if (keys.just_pressed('KeyW') || keys.just_pressed('ArrowUp')) {
        g.lm_sel = Math.max(0, g.lm_sel - 1);
      }
      if (keys.just_pressed('Enter')) {
        map.act(g);
      }
      if (keys.just_pressed('KeyM') || keys.just_pressed('KeyE')) {
        g.panel = { k: 'None' };
      }
      return;
    }
    case 'Jobs': {
      const n = g.staff.filter((s) => s.hired && !s.gone).length;
      if (keys.just_pressed('KeyS') || keys.just_pressed('ArrowDown')) {
        g.staff_sel = Math.min(g.staff_sel + 1, Math.max(0, n - 1));
      }
      if (keys.just_pressed('KeyW') || keys.just_pressed('ArrowUp')) {
        g.staff_sel = Math.max(0, g.staff_sel - 1);
      }
      for (const [k, job] of [['Digit1', staff.JOB_HOME], ['Digit2', staff.JOB_SERVICE], ['Digit3', staff.JOB_SECURITY], ['Digit4', staff.JOB_CLEANER]]) {
        if (keys.just_pressed(k)) {
          staff.assign(g, job);
        }
      }
      if (keys.just_pressed('KeyX')) {
        staff.fire(g);
      }
      if (keys.just_pressed('KeyG')) {
        staff.give_gun(g);
      }
      if (keys.just_pressed('Enter') && staff.selected(g) !== null) {
        g.panel = { k: 'Job', sel: -1 }; // [par-panels] C17: bảng Select Job riêng như bản gốc
      } else if (keys.just_pressed('KeyJ') || keys.just_pressed('Enter') || keys.just_pressed('KeyE')) {
        g.panel = { k: 'None' };
      }
      return;
    }
    case 'Notes': {
      // [par-panels] C23: A / D lật trang (3 trang như gốc), E / Enter / L đóng
      const pg = g.panel.page || 0;
      if (keys.just_pressed('KeyD') || keys.just_pressed('ArrowRight')) g.panel.page = Math.min(pg + 1, 2);
      if (keys.just_pressed('KeyA') || keys.just_pressed('ArrowLeft')) g.panel.page = Math.max(pg - 1, 0);
      if (keys.just_pressed('KeyE') || keys.just_pressed('Enter')) g.panel = { k: 'None' };
      return;
    }
    case 'Configure': {
      // [par-panels] C40: M đổi Storage Mode, W A S D chọn ô món, Space bật / tắt món, X Clear All, T Set To Content, Enter / E / C đóng
      const sh = g.shelves[g.panel.a];
      if (sh === undefined) { g.panel = { k: 'None' }; return; }
      const list = items.config_items();
      const cols = 6;
      let sel = g.panel.sel || 0;
      if (keys.just_pressed('KeyD') || keys.just_pressed('ArrowRight')) sel = Math.min(sel + 1, list.length - 1);
      if (keys.just_pressed('KeyA') || keys.just_pressed('ArrowLeft')) sel = Math.max(sel - 1, 0);
      if (keys.just_pressed('KeyS') || keys.just_pressed('ArrowDown')) sel = Math.min(sel + cols, list.length - 1);
      if (keys.just_pressed('KeyW') || keys.just_pressed('ArrowUp')) sel = Math.max(sel - cols, 0);
      g.panel.sel = sel;
      if (keys.just_pressed('KeyM')) { sh.dedicated = !sh.dedicated; g.play('click', 0.4); }
      if (keys.just_pressed('Space')) { items.config_toggle(sh, list[sel]); g.play('click', 0.3); }
      if (keys.just_pressed('KeyX')) { sh.allow = new Set(); g.play('click', 0.4); }
      if (keys.just_pressed('KeyT')) { sh.allow = new Set(sh.slots.filter((x) => x !== null && x !== undefined)); g.play('click', 0.4); }
      if (keys.just_pressed('Enter') || keys.just_pressed('KeyE') || keys.just_pressed('KeyC')) g.panel = { k: 'None' };
      return;
    }
    case 'Name': {
      // [par-panels] C33: Enter = OKAY (tên rỗng giữ tên cũ); Esc (xử lý chung) đóng, giữ tên cũ
      if (keys.just_pressed('Enter')) {
        const n = String(g.panel.v || '').trim().slice(0, 20);
        if (n !== '') g.bld.helper.name = n;
        g.panel = { k: 'None' };
        g.say(`${g.bld.helper.name} will guard the lot and fight zombies for you.`);
      }
      return;
    }
    case 'Hire': {
      // [par-panels] C18: H / Enter / Y = HIRE, N = REJECT, Esc = để sau (ứng viên vẫn chờ)
      const c = g.staff[g.panel.a];
      if (c === undefined || c.hired || c.gone) g.panel = { k: 'None' };
      else if (keys.just_pressed('KeyH') || keys.just_pressed('Enter') || keys.just_pressed('KeyY')) staff.hire_answer(g, true);
      else if (keys.just_pressed('KeyN')) staff.hire_answer(g, false);
      return;
    }
    case 'Job': {
      // [par-panels] C17: lưới 2 cột Show World / Security / Service / Cleaner / Send Home; Enter giao việc ô đang chọn
      const n = staff.JOB_TILE_JOBS.length;
      let sel = g.panel.sel ?? -1;
      if (keys.just_pressed('KeyS') || keys.just_pressed('ArrowDown')) sel = sel < 0 ? 0 : Math.min(sel + 2, n - 1);
      if (keys.just_pressed('KeyW') || keys.just_pressed('ArrowUp')) sel = sel < 0 ? 0 : Math.max(sel - 2, 0);
      if (keys.just_pressed('KeyD') || keys.just_pressed('ArrowRight')) sel = Math.min(sel + 1, n - 1);
      if (keys.just_pressed('KeyA') || keys.just_pressed('ArrowLeft')) sel = Math.max(sel - 1, 0);
      g.panel.sel = sel;
      for (const [k, t] of [['Digit1', 4], ['Digit2', 2], ['Digit3', 1], ['Digit4', 3]]) {
        if (keys.just_pressed(k)) { staff.assign_tile(g, t); return; }
      }
      if (keys.just_pressed('Enter') && sel >= 0) staff.assign_tile(g, sel);
      else if (keys.just_pressed('KeyE') || keys.just_pressed('KeyJ')) g.panel = { k: 'Jobs' };
      return;
    }
    case 'Pause': {
      // [par-panels] GAME PAUSED (C04): Play, Settings, Unstuck, Return To Menu, Quit
      const n = 5;
      const sel = g.panel.sel || 0;
      if (keys.just_pressed('KeyS') || keys.just_pressed('ArrowDown')) g.panel.sel = Math.min(sel + 1, n - 1);
      if (keys.just_pressed('KeyW') || keys.just_pressed('ArrowUp')) g.panel.sel = Math.max(sel - 1, 0);
      if (keys.just_pressed('Enter')) {
        switch (g.panel.sel || 0) {
          case 0: g.panel = { k: 'None' }; break;
          case 1: g.panel = { k: 'Settings', tab: 0, from: 'Pause' }; break;
          case 2: g.player = lay.WAKE.clone(); g.vel_y = 0.0; g.panel = { k: 'None' }; g.say('Unstuck: back in the bedroom.'); break;
          case 3: if (typeof location !== 'undefined') location.reload(); break;
          default: if (typeof location !== 'undefined') { if (history.length > 1) history.back(); else location.reload(); } break;
        }
        g.play('click', 0.5);
      }
      return;
    }
    case 'Settings': {
      // [par-panels] tab như bản gốc (A / D hoặc mũi tên), W / S chọn dòng, - / = đổi dòng đang chọn, R về mặc định tab này,
      // Backspace về mặc định tất cả. Giá trị, khoảng và tác dụng ở phần nhìn (three/js/settings.js, globalThis.__twtSettings);
      // chạy luật không có phần nhìn (node) thì chỉ còn phím cũ: G mức đồ hoạ, [ / ] độ nhạy, - / = âm lượng, I đảo Y.
      if (g.panel.cap) return; // [par-panels] C05: phím kế tiếp đang được bắt để đổi phím (opanels.js)
      const SV = globalThis.__twtSettings || null;
      const nt = SV ? SV.TABS.length : 6, kbt = SV ? SV.KB_TAB : 4;
      const tab0 = g.panel.tab || 0;
      if (keys.just_pressed('KeyA') || keys.just_pressed('ArrowLeft')) g.panel.tab = (tab0 + nt - 1) % nt;
      if (keys.just_pressed('KeyD') || keys.just_pressed('ArrowRight')) g.panel.tab = (tab0 + 1) % nt;
      if ((g.panel.tab || 0) !== tab0) { g.panel.row = SV ? SV.row0(g.panel.tab) : 0; g.panel.note = null; }
      const tab = g.panel.tab || 0;
      const n = tab === kbt ? (typeof globalThis.__twtKeyRows === 'number' ? globalThis.__twtKeyRows : 0) : SV ? SV.TAB_ROWS[tab].length : 0;
      const row = g.panel.row ?? (SV ? SV.row0(tab) : 0);
      if (keys.just_pressed('KeyS') || keys.just_pressed('ArrowDown')) g.panel.row = Math.min(row + 1, Math.max(n - 1, 0));
      if (keys.just_pressed('KeyW') || keys.just_pressed('ArrowUp')) g.panel.row = Math.max(row - 1, 0);
      // KEYBINDINGS: Enter bắt phím mới cho dòng đang chọn
      if (tab === kbt && keys.just_pressed('Enter') && n > 0) { g.panel.cap = true; g.panel.note = null; return; }
      if (keys.just_pressed('KeyR') || keys.just_pressed('Backspace')) {
        const all = keys.just_pressed('Backspace');
        if (SV) { if (all) SV.revert_everything(); else SV.revert(tab); }
        else if (typeof globalThis.__twtSettingsRevert === 'function') globalThis.__twtSettingsRevert();
        if (all || tab === 0 || !SV) { quality.tier = 2; quality.auto = true; }
        if (!SV) { g.sens = 1.0; g.volume = 0.8; audio.set_volume(g.volume); g.invert = false; }
        g.play('click', 0.5);
      }
      if (keys.just_pressed('KeyG')) {
        if (SV) SV.cycle_preset();
        else { quality.tier = (quality.tier + 1) % 3; quality.auto = false; }
      }
      if (keys.just_pressed('BracketLeft')) {
        g.sens = Math.max(g.sens - 0.1, 0.3);
      }
      if (keys.just_pressed('BracketRight')) {
        g.sens = Math.min(g.sens + 0.1, 3.0);
      }
      if (keys.just_pressed('KeyI')) {
        g.invert = !g.invert;
      }
      if (SV) SV.pull(g);
      if (keys.just_pressed('Minus') || keys.just_pressed('Equal')) {
        const d = keys.just_pressed('Minus') ? -1 : 1;
        if (SV && tab !== kbt && n > 0) SV.bump(SV.TAB_ROWS[tab][Math.min(g.panel.row ?? row, n - 1)], d);
        else if (!SV) { g.volume = clamp(g.volume + d * 0.1, 0.0, 1.0); audio.set_volume(g.volume); }
        g.play('click', 0.6);
      }
      if (keys.just_pressed('KeyP') || keys.just_pressed('Enter')) {
        g.panel = g.panel.from === 'Pause' ? { k: 'Pause', sel: 1 } : { k: 'None' };
      }
      web.save_settings(g, quality.tier);
      return;
    }
    case 'None': break;
  }

  // Ngồi tháp súng: chỉ bắn, nạp đạn và rời tháp.
  if (mounted !== null) {
    if (keys.just_pressed('KeyE')) {
      g.bld.mounted = null;
      g.play('click', 0.5);
    }
    const inp = { click, down: mouse.pressed('Left'), released: mouse.just_released('Left'), reload: keys.just_pressed('KeyR'), eye, dir: fwd, dt, bed_door: false };
    combat.player_weapons(g, inp);
    return;
  }

  // Chế độ xây (theo bản gốc, clip 10 1:53-2:10 và 3:16-3:19): bóng đi theo điểm nhắm trên sàn (xa nhất `ghost_d`, lăn chuột
  // "Forward/Back" 1-4 m, mặc định 2 m) hoặc đứng trên mặt bàn / kệ đang nhắm (đồ trang trí nhỏ); E / Q xoay 45 độ ("Rotate");
  // giữ chuột trái cố định ("Secure", thanh "Placing... NN%", búa gõ, tia lửa ở chân); Esc huỷ ("Cancel", X cũng huỷ).
  if (g.bld.ghost !== null) {
    const [item, yaw] = g.bld.ghost;
    const wh = ctx.wheel ? ctx.wheel() : 0;
    if (wh !== 0) {
      g.bld.ghost_d = clamp(g.bld.ghost_d - Math.sign(wh) * 0.25, 1.0, 4.0);
    }
    const [spot, on] = ghost_spot(g, item, eye, fwd, flat_f);
    g.bld.ghost_pos = spot;
    g.bld.ghost_on = on;
    g.bld.ghost_ok = on !== 0 ? build.valid_on(g, item, spot, yaw, on) : build.valid(g, item, spot, yaw);
    if (keys.just_pressed('KeyE') || keys.just_pressed('KeyQ')) {
      g.bld.ghost = [item, yaw + (keys.just_pressed('KeyQ') ? -1 : 1) * Math.PI / 4];
      g.play('click', 0.3);
    }
    if (keys.just_pressed('Escape') || keys.just_pressed('KeyX')) {
      build.cancel(g);
      g.swing = 0.0;
      g.play('drop', 0.4);
      return;
    }
    const need = 3.0 * build.build_speed(g);
    const name = items.iname(item);
    if (!g.bld.ghost_ok) {
      g.bld.secure_t = 0.0;
      // gốc (clip 06 1:45, c01 6:57:00): bóng đỏ mà nút "Secure" vẫn hiện; dòng nhỏ thứ hai nói vì sao không đặt được
      g.prompt = `[LMB] Secure\nCannot place ${name} here`;
    } else if (mouse.pressed('Left') && !g.bld.lmb_block) {
      g.bld.secure_t += dt;
      // búa gõ liên tục, tia lửa ở chân vật (gốc clip 10 3:17-3:18)
      if (g.swing <= 0.0) {
        g.cb.swing_len = 0.42;
        g.swing = 0.42;
        g.swing_hit = true; // chỉ là hình: combat không tính nhát này là đòn cận chiến
        g.play('wood', 0.3);
      }
      g.bld.spark_t = (g.bld.spark_t || 0.0) + dt;
      if (g.bld.spark_t >= 0.14) {
        g.bld.spark_t = 0.0;
        const a = g.bld.secure_t * 7.3;
        g.fxq.push([fx.FX_SPARK, spot.add(v3(Math.cos(a) * 0.25, 0.06, Math.sin(a) * 0.25))]);
      }
      g.prompt = `Placing... ${name}  ${(g.bld.secure_t / need * 100.0).toFixed(0)}%`;
      if (g.bld.secure_t >= need) {
        build.secure(g);
        g.swing = 0.0;
        g.bld.lmb_block = true;
      }
    } else {
      g.bld.secure_t = 0.0;
      g.prompt = '[LMB] Secure';
    }
    return;
  }

  if (keys.just_pressed('Tab')) {
    g.panel = { k: 'Bag' };
  }
  if (keys.just_pressed('KeyL')) {
    // [par-panels] L mở trang To Do List như bản gốc (op/15); bảng phím / mẹo cũ chuyển sang F1
    g.panel = { k: 'Todo' };
  }
  if (keys.just_pressed('F1')) {
    g.panel = { k: 'Help' };
  }
  if (keys.just_pressed('KeyP')) {
    g.panel = { k: 'Settings' };
  }
  if ((g.ff & game.FF_SKILLS) !== 0 && keys.just_pressed('KeyK')) {
    g.panel = { k: 'Skills' };
  }
  if ((g.ff & game.FF_MAP) !== 0 && keys.just_pressed('KeyM')) {
    g.panel = { k: 'Map' };
  }
  // [par-counter A07] bỏ phím H (thuê: chuột trái "Hire" trên ứng viên) và O (mở / đóng quán: công tắc cửa, như gốc)
  const hplaced = build.held_placed(g);
  if (keys.just_pressed('KeyO') && hplaced !== null && build.orientable(hplaced.kind.a)) {
    build.orient_held(g); // gốc: "Orient" phím O khi cầm thùng nổ / bom (đứng / nằm)
  }
  for (const [k, n] of [['Digit1', 1], ['Digit2', 2], ['Digit3', 3], ['Digit4', 4]]) {
    if (keys.just_pressed(k)) {
      if (g.bld.mode) leave_build(g);
      if (g.desk && n !== 1) leave_desk(g);
      combat.select(g, n);
    }
  }

  // Chế độ xây (fin-build đợt 4, mã gốc BuildPlayerActionItem + clip 10 1:54 / 2:00): phím B (gốc ô 2 "Build") vào / ra,
  // tay cầm búa. Nhắm vật dựng thì vật hiện vàng + "Detach" (đã cố định) / "Secure" (chưa cố định), bấm thì thành bóng;
  // cửa hỏng "Repair" (giữ chuột); trạm / giường còn bậc "Upgrade" (bảng nâng cấp). Esc / B ra.
  if (keys.just_pressed('KeyB') && target.k !== 'Coin') {
    if (g.bld.mode) {
      leave_build(g);
      return;
    }
    // gốc: đổi sang ô 2 thì vật đang cầm rơi xuống (hộp, rác, xác cũng thả như [X])
    if (hplaced !== null) build.drop_held(g, g.bld.drop_spot || v3(hplaced.pos.x, 0.0, hplaced.pos.z));
    else if (g.held !== null) drop_held_any(g, flat_f);
    g.bld.mode = true;
    g.bld.edit = null;
    g.bld.repair_t = 0.0;
    g.bld.prev = [g.armed, g.cb.throw_item]; // ra bằng B / Esc thì cầm lại món cũ (gốc: chọn lại ô cũ)
    g.armed = false;
    g.cb.throw_item = null;
    g.bld.lmb_block = mouse.pressed('Left');
    g.play('click', 0.4);
    return;
  }
  if (g.bld.mode) {
    if (keys.just_pressed('Escape')) {
      leave_build(g);
      return;
    }
    const e = build.edit_target(g, target);
    g.bld.edit = e;
    g.prompt = build.edit_prompt(g, e);
    if (e !== null && e.k === 'Door') {
      const need = 3.5 * build.build_speed(g);
      if (mouse.pressed('Left') && !g.bld.lmb_block) {
        g.bld.repair_t += dt;
        if (g.swing <= 0.0) {
          g.cb.swing_len = 0.42;
          g.swing = 0.42;
          g.swing_hit = true; // chỉ là hình
          g.play('wood', 0.3);
        }
        g.prompt = `Repairing... Front door  ${(g.bld.repair_t / need * 100.0).toFixed(0)}%`;
        if (g.bld.repair_t >= need) {
          g.bld.repair_t = 0.0;
          g.bld.lmb_block = true;
          finish_hold(g, Target.Door());
        }
      } else {
        g.bld.repair_t = 0.0;
      }
    } else {
      g.bld.repair_t = 0.0;
      if (click && !g.bld.lmb_block && e !== null && build.edit_click(g, e)) {
        g.bld.lmb_block = true;
      }
    }
    return;
  }

  // Vật dựng / vật cầm tay đang cầm (gốc: "Drop" chuột trái, "Forward/Back" lăn chuột, "Rotate" E / Q, "Orient" O,
  // "Item Details" chuột phải, bẫy gấu "Arm" F; clip 08 24:00, clip 01 0:40). Vật lơ lửng trước mặt, thả thì rơi xuống chỗ nhắm.
  if (hplaced !== null) {
    const item = hplaced.kind.a;
    const wh = ctx.wheel ? ctx.wheel() : 0;
    const [hlo, hhi] = build.hold_range(item);
    if (wh !== 0) g.bld.hold_d = clamp(g.bld.hold_d - Math.sign(wh) * 0.25, hlo, hhi);
    // Gốc (RigidbodyPlayerHoldable): tâm vật ở điểm cầm = mắt + hướng nhìn x HoldDistance (mặc định 1 m), thả thì rơi thẳng xuống.
    // Điểm cầm không xuống dưới sàn (tia nhìn chạm sàn trước thì cầm ở đó) và không xuyên tường (resolve).
    let hd = g.bld.hold_d;
    const half = build.hold_half(item, hplaced.orient);
    if (fwd.y < -0.02) hd = Math.min(hd, (eye.y - half) / -fwd.y);
    const hp = eye.add(fwd.mul(Math.max(0.6, hd)));
    let drop;
    const keep = g.bld.ghost_d;
    g.bld.ghost_d = Math.max(1.0, Math.hypot(hp.x - g.player.x, hp.z - g.player.z));
    const [spot, on] = ghost_spot(g, item, eye, fwd, flat_f);
    g.bld.ghost_d = keep;
    if (on) {
      drop = spot; // món trang trí nhỏ thả lên mặt bàn / kệ đang nhắm
    } else {
      const fl = world.resolve(g, v3(hp.x, 0.0, hp.z), 0.05);
      drop = v3(fl.x, 0.0, fl.z);
    }
    g.bld.drop_spot = drop;
    hplaced.pos = v3(drop.x, Math.max(drop.y, hp.y - half), drop.z);
    if (keys.just_pressed('KeyE') || keys.just_pressed('KeyQ')) {
      hplaced.yaw += (keys.just_pressed('KeyQ') ? -1 : 1) * Math.PI / 4;
      g.play('click', 0.3);
    }
    if (keys.just_pressed('KeyF') && build.trap_unarmed(hplaced)) {
      build.drop_held(g, drop);
      build.arm_trap(g, hplaced.id);
      return;
    }
    if (mouse.just_pressed('Right')) {
      g.panel = { k: 'Details', a: item, b: hplaced.id };
      g.play('click', 0.4);
      return;
    }
    if (click && !g.bld.lmb_block) {
      build.drop_held(g, drop);
      g.bld.lmb_block = true;
      return;
    }
    if (keys.just_pressed('KeyX') || keys.just_pressed('KeyG')) {
      build.drop_held(g, drop);
      return;
    }
    g.look_grab = hplaced.id; // gốc: vật đang cầm có viền trắng (clip 08 24:00)
    const arm = build.trap_unarmed(hplaced) ? '   [F] Arm' : '';
    const ori = build.orientable(item) ? '   [O] Orient' : '';
    g.prompt = `[LMB] Drop\n${items.iname(item)}   [RMB] Item Details${arm}${ori}`;
    return;
  }
  // [par-counter A06] gốc: bánh xe chuột "Cycle Slot" đổi sang món kế trong cùng nhóm ô đang cầm (cận chiến, súng, đồ ném)
  if (ctx.input && ctx.input.wheel !== 0 && g.held === null && !g.desk && g.bld.ghost === null) {
    const cw = g.cur_w();
    const grp = g.cb.throw_item !== null ? 4 : g.armed && cw !== null && cw !== undefined ? (items.wclass(cw.item) === 2 ? 3 : 2) : 0;
    if (grp !== 0) combat.select(g, grp);
  }
  const cw2 = g.cur_w();
  const gun_in_hand = cw2 !== null && items.gun(cw2.item) !== null;
  if (keys.just_pressed('KeyR') && !gun_in_hand && !(held_kind(g) !== null && held_kind(g).k === 'Trash')) {
    const list = g.sellable_in_inv();
    if (list.length !== 0) {
      const at = list.indexOf(g.stock_sel);
      const pos = at >= 0 ? (at + 1) % list.length : 0;
      g.stock_sel = list[pos];
      g.play('click', 0.3);
    }
  }
  if (keys.just_pressed('KeyF') && target.k === 'Prop' && build.trap_unarmed(g.prop(target.a))) {
    build.arm_trap(g, target.a); // gốc: bẫy gấu "Arm" phím F (clip 08 13:15)
  } else if (keys.just_pressed('KeyF') || keys.just_pressed('Digit6')) {
    // Gốc: ô 6 Consumable cầm món y tế trên tay; bấm lại thì đổi món ("Cycle Slot"); chuột trái mới dùng.
    items.equip_med(g);
  }
  if (keys.just_pressed('KeyX') && g.med_hand !== null && g.held === null) {
    // gốc "X Unequip"
    items.unequip_med(g);
  }
  // fin-build đợt 4: bỏ phím U; nâng cấp / sửa máy qua chế độ xây [B] như gốc (quest_upgrade_* "via Build Mode").
  if (keys.just_pressed('KeyC') && target.k === 'Shelf' && g.held === null) {
    g.panel = { k: 'Configure', a: target.a, sel: 0 }; // [par-panels] C40 bảng Configure của kệ
  }
  if ((keys.just_pressed('KeyX') || keys.just_pressed('KeyG')) && g.held !== null) {
    drop_held_any(g, flat_f);
  }
  // Phiên 9: bỏ phím B dựng nhanh dây thép gai (không có trong bản gốc). Dây thép gai chế ở bàn cấp 2 (Scrappy Wiring 2 +
  // Nails 2, công thức từ nút kỹ năng Barbed Wire hoặc tờ công thức) rồi dựng từ ba lô như mọi món dựng. B chỉ còn bỏ pin vào thùng.
  if (mouse.just_pressed('Right') && target.k === 'Station' && target.a === build.ST_SYRINGE) build.syringe_grab(g); // [par-counter D19] Grab
  if (mouse.just_pressed('Right') && target.k === 'Prop' && g.held === null) { // [par-counter A10] Grab tờ công thức vào ba lô
    const rp = g.prop(target.a);
    if (rp !== null && rp.kind.k === 'Item' && is_recipe(rp.kind.a)) {
      rp.dead = true;
      items.give(g, [rp.kind.a]);
      g.play('pick', 0.6);
      g.say(`Picked up ${items.iname(rp.kind.a)}. Learn it from the backpack [Tab] or hold [E] on a sheet.`);
    }
  }
  const on_crate = target.k === 'Prop' && g.props.some((p) => p.id === target.a && !p.dead && p.kind.k === 'Crate'); // [par-counter D16] chuột phải trên gói = Open, không Empty hộp
  // [par-counter D16] chuột phải "Open": gói đang cầm (mở ở chỗ đang trôi trước mặt) hoặc gói đang nhắm trên đất
  if (mouse.just_pressed('Right') && g.panel.k === 'None') {
    const hp = g.held !== null ? g.prop(g.held) : null;
    if (hp !== null && hp.kind.k === 'Crate') {
      const at = world.resolve(g, g.player.add(flat_f.mul(g.cy.bag_d + 0.3)), 0.4);
      open_package(g, hp, v3(at.x, 0.0, at.z));
    } else if ((g.held === null || (hp !== null && hp.kind.k === 'Box')) && target.k === 'Prop') {
      const cp = g.prop(target.a);
      if (cp !== null && cp.kind.k === 'Crate') open_package(g, cp);
    }
  }
  if (mouse.just_pressed('Right') && target.k === 'Coin') { // [par-counter A07] bỏ phím B: chuột phải "Bin"
    const i = target.a;
    const c = g.pay !== null && i < g.pay.coins.length ? g.pay.coins[i] : null;
    if (c !== null) {
      c.done = 2;
      g.pay_rev += 1;
      g.play('trash', 0.5);
    }
  }
  // Grab (gốc RigidbodyPlayerHoldable, clip 08 13:15, clip 10 1:59): tay không, chuột trái trên vật chưa cố định / vật cầm
  // tay thì cầm lên tay; vật đã cố định chỉ dời được ở chế độ xây ("Detach").
  const grab_id = target.k === 'Prop' ? target.a : 0;
  const can_grab = !g.armed && g.held === null && grab_id !== 0 && build.hand_grabbable(g, grab_id);
  g.look_grab = can_grab ? grab_id : 0;
  if (click && can_grab) {
    build.grab_hand(g, grab_id);
    g.bld.lmb_block = true;
    return;
  }
  if (mouse.just_pressed('Right') && can_grab) {
    g.panel = { k: 'Details', a: g.prop(grab_id).kind.a, b: grab_id };
    return;
  }
  // Giữ V: gỡ vật dựng đang nhắm về ba lô.
  let placed_id = null;
  if (target.k === 'Prop' && g.props.some((p) => p.id === target.a && p.kind.k === 'Placed')) placed_id = target.a;
  // Kệ do người chơi dựng: nhắm vào ô nào của kệ cũng gỡ được.
  else if ((target.k === 'Shelf' || target.k === 'Tag') && g.shelves[target.a].prop !== 0) placed_id = g.shelves[target.a].prop;
  if (placed_id !== null && keys.pressed('KeyV')) {
    const id = placed_id;
    if (g.bld.pick_id !== id) {
      g.bld.pick_id = id;
      g.bld.pick_t = 0.0;
    }
    g.bld.pick_t += dt;
    g.prompt = `Picking up...  ${(g.bld.pick_t * 100.0).toFixed(0)}%`;
    if (g.bld.pick_t >= 1.0) {
      g.bld.pick_t = 0.0;
      g.bld.pick_id = 0;
      build.pick_up(g, id);
    }
  } else {
    g.bld.pick_t = 0.0;
    g.bld.pick_id = 0;
  }
  // [par-counter A01] Gốc: lựa chọn chính của vật đang nhắm nằm ở chuột trái khi tay không ("Interact"), lựa chọn phụ ở
  // chuột phải. Tay không (không vũ khí, không đồ ném, không xách rác / xác, không ngồi tháp) thì chuột trái làm đúng việc
  // của phím E (bấm và giữ); E vẫn nhận như phím phụ. Hộp "Customer wants ..." đang hiện: chuột trái ACCEPT, chuột phải DECLINE.
  const hk0 = held_kind(g);
  const lmb_ok = (cursor.locked || feel.nolock) && !g.armed && g.cb.throw_item === null
    && (hk0 === null || hk0.k === 'Box' || hk0.k === 'Item');
  g.lmb_interact = lmb_ok;
  const offer = actors.offer_of(g);
  const pleading = g.pay !== null && g.pay.alarm === 1;
  const alt = pleading ? 'plea' : g.alt_pick;
  const lmb_e = lmb_ok && offer === null && alt === null;
  const e_down = keys.pressed('KeyE') || (lmb_e && mouse.pressed('Left'));
  // [par-counter C34] hộp "Customer wants ..." là bảng giao diện: E (phím phụ) cũng ACCEPT dù đang nhắm đâu
  const e_just = (keys.just_pressed('KeyE') && offer === null) || (lmb_e && click);
  if (offer !== null && keys.just_pressed('KeyE')) actors.answer_offer(g, true);
  if (g.assign_pick !== null && offer === null && keys.just_pressed('KeyE') && g.panel.k === 'None') {
    g.staff_sel = g.assign_pick;
    g.panel = { k: 'Job', sel: -1 };
    g.play('click', 0.5);
  }
  const e_up = keys.just_released('KeyE') || (lmb_e && mouse.just_released('Left'));
  if (offer !== null && lmb_ok && click) actors.answer_offer(g, true);
  else if (offer !== null && lmb_ok && mouse.just_pressed('Right')) actors.answer_offer(g, false);
  // [par-counter A03/D02] hộp các-tông: chuột phải "Empty" như gốc (op/14): đổ hết món trong hộp ra sàn trước mặt
  if (mouse.just_pressed('Right') && g.panel.k === 'None' && target.k !== 'Shelf' && target.k !== 'Tag' && target.k !== 'Coin' && !on_crate) {
    const bp = g.held === null ? undefined : g.props.find((p) => p.id === g.held);
    if (bp !== undefined && bp.kind.k === 'Box' && bp.kind.a.length > 0) {
      const got = bp.kind.a.splice(0, bp.kind.a.length);
      drop_loot(g, bp.id, g.player.add(flat_f.mul(1.0)), got, 'Box');
      g.play('drop', 0.5);
    }
  }
  if (mouse.just_pressed('Right')) {
    if (target.k === 'Shelf' || target.k === 'Tag') {
      const s = target.a, slot = target.b;
      const it = g.shelves[s].slots[slot];
      const n = game.case_units();
      if (it !== null) {
        // Lấy lại cả thùng (n món lẻ) về ba lô; thùng đã bán dở thì món lẻ còn lại ở yên trên kệ cho khách.
        if (g.shelves[s].units(slot) >= n) {
          for (let k = 0; k < n; k++) g.shelves[s].take(slot);
          items.give(g, [it]);
          g.play('pick', 0.5);
        } else {
          g.say(`Only ${g.shelves[s].units(slot)} loose ${items.iname(it)} left: an opened case stays on the shelf.`);
        }
      }
    }
  }
  // Khách bị bắt trả pin giả đang xin tha, khách bị thương, ứng viên: chuột trái / phải ([par-counter A07] thay Y / N / H).
  const pick_yes = alt !== null && lmb_ok && click, pick_no = alt !== null && mouse.just_pressed('Right');
  if (pick_yes && alt === 'hire') {
    const i = staff.candidate_near(g);
    if (i !== null) g.panel = { k: 'Hire', a: i }; // [par-panels] C18: chuột trái "Hire" mở hộp "Hire this person?" như bản gốc
  } else if (pick_yes) {
    if (pleading) {
      g.add_rep(0.5);
      g.forgiven_due = true;
      if (g.pay !== null) {
        g.pay.alarm = 2;
      }
      g.play('quest', 0.5);
      g.say('Forgiven. They promise to come back tomorrow and pay.');
    } else if (actors.medical_near(g) !== null) {
      actors.medical_answer(g, true);
    } else {
      actors.answer_offer(g, true);
    }
  }
  if (pick_no) {
    if (pleading) {
      if (g.pay !== null) {
        g.pay.alarm = 2;
      }
      g.play('deny', 0.6);
      g.say('You send the cheat away.');
    } else if (actors.medical_near(g) !== null) {
      actors.medical_answer(g, false);
    } else {
      const i = staff.candidate_near(g);
      if (i !== null) {
        staff.dismiss(g, i);
      } else {
        actors.answer_offer(g, false);
      }
    }
  }
  // Lượt thanh toán khép lại khi mọi cục pin đã vào ngăn kéo hoặc thùng rác.
  if (g.pay !== null && g.pay.alarm !== 1 && g.pay.coins.every((c) => c.done !== 0)) {
    actors.finish_payment(g);
    g.pay_rev += 1;
  }

  // Chuột trái khi đang xách rác: ném theo hướng nhìn (trúng skip thì tính, trượt thì nằm lại trên đất).
  // [par-counter D06] gốc: túi trôi trước mặt, chuột trái "Drop": nhắm skip thì túi rơi vào thùng, chỗ khác thì túi rơi
  // xuống đất ngay chỗ đang trôi. Bánh xe chuột Forward/Back đẩy túi xa / gần, R xoay.
  if (click && g.panel.k === 'None') {
    const hk = held_kind(g);
    if (hk !== null && hk.k === 'Corpse') {
      // [par-counter D15] đang kéo xác: chuột trái "Drop" (như X): buông tay, ragdoll tự rơi yên tại chỗ
      g.held = null;
      g.play('drop', 0.5);
    } else if (hk !== null && hk.k === 'Crate') {
      // [par-counter D16] gói đang cầm: chuột trái "Drop" rơi xuống ngay chỗ đang trôi
      const id = g.held;
      g.held = null;
      const spot = world.resolve(g, g.player.add(flat_f.mul(g.cy.bag_d + 0.3)), 0.4);
      const p = g.prop(id);
      if (p !== null) { p.pos = v3(spot.x, 0.0, spot.z); p.yaw = g.yaw + g.cy.bag_rot; p.dirty = true; }
      g.play('drop', 0.5);
    } else if (hk !== null && hk.k === 'Trash') {
      if (target.k === 'Skip') carry.start_toss(g, true);
      else if (g.cy.toss === null) {
        const id = g.held;
        g.held = null;
        const spot = world.resolve(g, g.player.add(flat_f.mul(g.cy.bag_d)), 0.3);
        const p = g.prop(id);
        if (p !== null) {
          p.pos = v3(spot.x, 0.0, spot.z);
          p.yaw = g.yaw + g.cy.bag_rot;
        }
        g.play('drop', 0.5);
      }
    }
  }
  {
    const hk = held_kind(g);
    if (hk !== null && (hk.k === 'Trash' || hk.k === 'Crate') && g.panel.k === 'None') {
      const wh = ctx.input ? ctx.input.wheel : 0;
      if (wh !== 0) g.cy.bag_d = clamp(g.cy.bag_d - wh * 0.12, carry.BAG_DMIN, carry.BAG_DMAX);
      if (keys.just_pressed('KeyR')) g.cy.bag_rot = (g.cy.bag_rot + Math.PI / 4) % (Math.PI * 2);
    } else if (g.held === null) {
      g.cy.bag_d = carry.BAG_D0;
      g.cy.bag_rot = 0;
    }
  }
  // Giữ E trên đống bẩn: cầm chổi quét, bẩn mờ dần; nhả ra thì phần đã quét vẫn giữ.
  if (target.k === 'Prop' && e_down && g.held === null) {
    const id = target.a;
    const pp = g.props.find((p) => p.id === id);
    if (pp !== undefined && pp.kind.k === 'Pile') {
      const done = carry.sweep(g, id, dt, flat_r);
      g.prompt = `Sweeping...  ${((1.0 - g.cy.sweep_dirt) * 100.0).toFixed(0)}%`;
      if (done) {
        finish_hold(g, target);
      }
    }
  }
  // E: bấm hoặc giữ.
  const need = hold_time(g, target);
  let tid;
  switch (target.k) {
    case 'Prop': tid = target.a; break;
    case 'Door': tid = 4000000001; break;
    case 'Station': tid = 4000000010 + target.a; break;
    default: tid = 0;
  }
  if (e_down && need > 0.0 && tid !== 0) {
    if (g.hold_id !== tid) {
      g.hold_id = tid;
      g.hold_t = 0.0;
    }
    g.hold_t += dt;
    if (target.k === 'Prop') spill_cache(g, target.a, g.hold_t / need);
    // [par-counter D20] cưa bằng Chainsaw: tia lửa vàng ở chỗ lưỡi cưa chạm (gốc c01 5:00), chainsaw trong tay (hình ở trên)
    g.sawing = target.k === 'Station' && (target.a === build.ST_HULK || target.a === build.ST_MED_DOOR);
    if (g.sawing) {
      g.saw_fx = (g.saw_fx || 0) - dt;
      if (g.saw_fx <= 0.0) {
        g.saw_fx = 0.06;
        const sp = eye.add(fwd.mul(0.75)).add(v3(Math.sin(g.yaw + 1.2) * 0.08, -0.12, Math.cos(g.yaw + 1.2) * 0.08));
        g.fxq.push([fx.FX_SPARK, sp]);
      }
    }
    if (g.hold_t >= need) {
      g.hold_t = 0.0;
      g.hold_id = 0;
      g.sawing = false;
      finish_hold(g, target);
    }
  } else {
    if (e_up && g.hold_id !== 0 && g.hold_t < 0.3 && target.k === 'Door') {
      press_e(g, target);
    }
    g.sawing = false;
    g.hold_t = 0.0;
    g.hold_id = 0;
  }
  if (eRec) { eRec.at = 'dispatch'; eRec.t = target.k; eRec.need = need; eRec.pr = g.prompt; }
  if (e_just && (need === 0.0 || (target.k === 'Door' && g.door.hp >= game.DOOR_HP))) {
    press_e(g, target);
    if (eRec) { eRec.fired = true; eRec.notice = g.notice; }
  }
  if (need > 0.0 && g.hold_t > 0.0) {
    g.prompt = `${g.prompt}  ${(g.hold_t / need * 100.0).toFixed(0)}%`;
  }

  // Món y tế trên tay: chuột trái bắt đầu dùng (gốc `Interact` Down), không đánh / bắn.
  const med = g.med_hand !== null;
  if (med && click && g.heal_job === null) items.use_heal(g, g.med_hand);
  // Vũ khí: cận chiến, súng, đồ ném.
  const inp = {
    click: click && !med && !g.bld.lmb_block,
    down: mouse.pressed('Left') && !med && !g.bld.lmb_block,
    released: mouse.just_released('Left') && !med,
    reload: keys.just_pressed('KeyR') && gun_in_hand,
    bash: keys.just_pressed('KeyZ') && gun_in_hand,
    eye,
    dir: fwd,
    dt,
    bed_door: target.k === 'BedDoor',
  };
  combat.player_weapons(g, inp);
}

/* VIEW NOTES (player.rs)
- Camera: setup_player writes ctx.cam = {pos:(0,1.62,15.5), quat:identity, fov:68deg in radians, near:0.06, far:900}.
  Bevy used Tonemapping::None and DebandDither::Disabled on this camera. player_system writes ctx.cam.pos (Vec3) and
  ctx.cam.quat ([x,y,z,w]) every frame:
  * Title: orbits lay.TITLE_CAM + (sin(a)*3, 0, cos(a)*1.5), a = title_t*0.05, looking at lay.TITLE_LOOK (q_look).
  * Cut scene: cine.sample(kind,t,player) -> position + look target; viewmodels hidden.
  * Play: pos = eye + rot*(bob+shake), quat = rot * euler XYZ(view.x, view.y, view.z + shake.x*0.4), rot = euler YXZ(yaw,pitch,0).
    eye = player + Y*(1.62 - 0.5*fx2.crouch), or turret pos + Y*1.5 - flat_fwd*0.35 when manning a turret.
    Head bob = (cos(bob*1.85)*0.013, |sin(bob*3.7)|*0.024, 0) in camera space; bob = metres walked on the ground.
- ViewModels[0] / ViewModels[1]: two first-person meshes spawned with {viewmodel:true}. In Bevy they are CHILDREN of the
  camera: their pos/quat/scale (written with set_tr each frame from fp.pose / carry.pose Transforms) are camera-local.
  Initial local pos (0.3,-0.34,-0.55), hidden. [0] = weapon + right arm, [1] = left arm + magazine / pump grip. Mesh is
  rebuilt (set_mesh) when the shown item changes (fp.build_vm for weapons, carry.build_vm for carried trash/box/corpse/
  broom); an empty part becomes a 1 cm black cube at (0,-5,0). Visible only while `show` (playing; in build mode always, holding the hammer (fp.build_vm(HAMMER), swinging while securing); not
  on a turret, and either carrying something or holding a weapon with empty hands). Material: 'solid'. They should draw
  on top of the world (Bevy drew them in the same pass with near 0.06; the view may use a separate viewmodel pass).
- Cursor: ctx.cursor.lock() on left click when unlocked and !feel.nolock; unlock() after 0.6 s of lost pointer lock or Esc
  with no panel open.
PORT GAPS: Bevy `cursor.visible` is folded into ctx.cursor.lock()/unlock(). Rust `{:.0}` formatting rounds ties to even,
  JS toFixed(0) rounds half up (contract says toFixed). fp.pose / carry.pose Transforms are read as
  {translation, rotation, scale} (falling back to {pos, quat, scale}).
*/
