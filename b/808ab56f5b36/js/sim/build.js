//! Xây dựng và các vật thể trong thế giới (cờ `build`, `defence`): trạm 3D (bàn chế tạo, máy nghiền, máy phát, bàn tin tức,
//! Job Board, còi, thùng rác, cửa kho, cửa phòng y tế, xích Hulk), nâng cấp vật thể, chế độ xây (dựng / gỡ đồ), sơn,
//! mở rộng quán bằng đội phá tường, đồ phòng thủ, Hulk Helper.
//! Luật theo `~/twt-bevy/docs/rules/crafting-building.md` mục 5.2, 6, 7, 8, 9 và `staff.md` mục 8, 9:
//! - Cố định một vật: 3 giây x hệ số kỹ năng. Sơn: 5 giây, không tốn vật liệu (xô sơn dùng lại được).
//! - Nâng cấp: nộp đủ vật liệu của bậc kế (`data::UPGRADES`).
//! - Đội phá tường: 1000 pin (phòng 1) / 5000 pin (phòng 2), tới 09:00 hôm sau, 5 thợ, tường sập sau 75 nhát.
//! - Tường chông: sát thương = máu tường x 3, tường mất đúng số máu còn lại của nạn nhân. Bẫy gấu: 10 sát thương rồi giữ chân,
//!   bẫy mất 1 máu mỗi giây; boss không bị giữ. Tháp súng: 10 sát thương / 0,1 s, tầm 20 m, 120 viên. Auto Minigun: 5 / 0,08 s,
//!   quét 12 m, 120 viên. Còi: kéo raid đang chờ về 09:30 ngày mai. Bóng xác: đẩy raid đang chờ lùi 30 ngày.
//! - Hulk Helper: 500 máu, vuốt 150, hồi 1 s, tầm 2 m; mỗi sáng hồi đầy máu.
//! `[ĐỀ XUẤT]` (tài liệu luật ghi UNKNOWN hoặc bản này không có vật lý): vật liệu nâng cấp lấy từ ba lô (bản gốc lấy đồ trong
//! bán kính 5 m); đồ treo tường / trần đặt theo chỗ đứng rồi vẽ ở độ cao treo; cửa phòng y tế và xích Hulk cần Chainsaw (bản
//! gốc có 5 cửa cần Chainsaw, không rõ cửa nào); thùng nổ / bom từ xa nổ 200 sát thương bán kính 5 m; máu tháp súng 300.
//
// Port of src/build.rs (transliteration, see three/PORT-CONTRACT.md).

import { Vec3, v3, Y, rot_y, trunc } from './vec.js';
import { hex } from './geom.js';
import * as geom from './geom.js';
import * as data from './data.js';
import * as game from './game.js';
import * as lay from './lay.js';
import * as items from './items.js';
import * as catalog from './catalog.js';
import * as world from './world.js';
import * as actors from './actors.js';
import * as combat from './combat.js';
import * as events from './events.js';
import * as skills from './skills.js';
import * as fx from './fx.js';
import * as models from './models.js';

export const ST_BENCH = 0;
export const ST_SHREDDER = 1;
export const ST_GENERATOR = 2;
export const ST_INTEL = 3;
export const ST_JOBS = 4;
export const ST_SIREN = 5;
export const ST_DUMPSTER = 6;
export const ST_WH_DOOR = 7;
export const ST_MED_DOOR = 8;
export const ST_HULK = 9;
export const ST_GIB = 10;
export const ST_MERCHANT = 11;
/** [par-counter D19 / D39] Syringe Station (loc:object_syringe_station) trong phòng y tế: giữ "Extract Blood" lấy máu (tốn
 *  Max HP tới hết ngày, loc:quest_extract_blood), "Grab" lấy ống máu = The Cure (loc:item_medicine_the_cure_desc "Your own
 *  extracted blood that can cure infected humans"). [ĐỀ XUẤT] chỗ đặt, 20 Max HP mỗi lần, Max HP tối thiểu 40. */
export const ST_SYRINGE = 12;
export const SYRINGE = v3(-9.1, 0.0, 4.35);
export const BLOOD_COST = 20.0;
export const THE_CURE = 29;

export const T_BENCH = 0;
export const T_SHREDDER = 1;
export const T_GEN = 2;
export const T_INTEL = 3;
export const T_BED = 4;
export const T_SIREN = 5;
export const TIER_NAMES = [['CraftingStationLvl2', 'CraftingStationLvl3'], ['Shredder'], ['Generator'], ['Radio', 'LongRangeRadio', 'SurveillanceHub'], ['Bedroll', 'SingleBed'], ['SirenUpgrade']];
export const TIER_TITLES = ['Crafting bench', 'Shredder', 'Generator', 'Intel station', 'Bed', 'Radio tower siren'];

export class Labourer {
  constructor(o = {}) {
    this.body = o.body === undefined ? null : o.body;
    this.seed = o.seed || 0;
    this.pos = o.pos ? o.pos.clone() : v3();
    this.yaw = o.yaw || 0;
    this.path = o.path || [];
    this.spot = o.spot ? o.spot.clone() : v3();
    this.timer = o.timer || 0;
    this.swing = o.swing || 0;
    this.phase = o.phase || 0;
    this.moving = !!o.moving;
    this.leaving = !!o.leaving;
    this.gone = !!o.gone;
  }
}

export class Helper {
  constructor() {
    this.freed = false;
    this.body = null;
    this.pos = v3();
    this.yaw = 0;
    this.hp = 0;
    this.goal = 0;
    this.pause = 0;
    this.cd = 0;
    this.swing = 0;
    this.phase = 0;
    this.moving = false;
    this.down = false;
    /// [par-panels] C33: tên người chơi đặt trong hộp "Name your new, uh 'helper'..." (mặc định tên cũ của bản này)
    this.name = 'Stompy';
  }
}

export class State {
  constructor() {
    this.wh_open = false;
    this.med_open = false;
    /** Số phòng mở rộng đã mở (0..2). */
    this.rooms = 0;
    this.wall_hits = 0;
    this.crew = [];
    /** Sơn theo phòng: [phòng x 2 + (0 tường, 1 sàn)] = chỉ số mẫu sơn + 1; 0 là màu gốc. */
    this.paint = [0, 0, 0, 0, 0, 0];
    this.tiers = [0, 0, 0, 0, 0, 0];
    this.gen_fixed = false;
    /** Phải dựng lại hình quán và danh sách vật cản. */
    this.dirty = false;
    this.cols = [];
    /** Chế độ xây: [món đang đặt, góc xoay] | null. */
    this.ghost = null;
    this.ghost_pos = v3();
    this.ghost_ok = false;
    /** Khoảng cách vật đang đặt trước mặt (m), lăn chuột đổi 1-4 m; vào chế độ xây thì về 2 m. */
    this.ghost_d = 2.0;
    /** Mặt đồ đạc đang đỡ bóng (id vật dựng) | 0 = sàn. */
    this.ghost_on = 0;
    /** Vật đã dựng đang được "Grab" dời chỗ: { item, hp, aux, pos, yaw, extra } | null (huỷ thì về chỗ cũ). */
    this.grab = null;
    /** Chuột trái còn giữ từ lúc cố định xong: chưa nhả thì không tính là bắn / vung. */
    this.lmb_block = false;
    /** Đang ở chế độ xây (ô 2 "Build", phím B) dù chưa có bóng. */
    this.mode = false;
    /** Đích chế độ xây đang nhắm (vật hiện vàng): kết quả edit_target | null. */
    this.edit = null;
    /** Giây đã giữ chuột sửa cửa ở chế độ xây. */
    this.repair_t = 0;
    /** Khoảng cách vật đang cầm tay trước mặt (m), lăn chuột 1-4 m. */
    this.hold_d = 2.0;
    /** [g.armed, g.cb.throw_item] lúc vào chế độ xây, ra thì cầm lại | null. */
    this.prev = null;
    this.ghost_ent = null;
    this.ghost_shown = 0;
    this.secure_t = 0;
    /** Việc sơn đang chạy: [phòng, là sàn, mẫu sơn, giây đã chạy] | null. */
    this.paint_job = null;
    /** Tháp súng đang ngồi (id vật dựng) | null. */
    this.mounted = null;
    this.mount_cd = 0;
    this.helper = new Helper();
    this.pick_t = 0;
    this.pick_id = 0;
    this.inited = false;
    /** [par-counter D19] ống máu chờ lấy ở Syringe Station. */
    this.syr = 0;
  }
}

export function max_hp() {
  return 500.0;
}

/** Dựng lại danh sách vật cản động (cửa còn đóng, tường chưa phá) và báo cho `lay` biết phòng nào đang mở. */
export function refresh(g) {
  const b = g.bld;
  const v = [];
  if (!b.wh_open) {
    v.push(lay.WH_DOOR_BOX);
  }
  if (!b.med_open) {
    v.push(lay.MED_DOOR_BOX);
  }
  if (b.rooms < 1) {
    v.push([5.0, -5.25, 5.25, 3.2]);
  }
  if (b.rooms < 2) {
    v.push(lay.WALL_SF3);
  }
  b.cols = v;
  lay.set_state(b.rooms, b.wh_open, b.med_open);
}

/** Việc một lần lúc vào ván: vật cản động, tờ công thức Bandage trong kho. */
export function init(g) {
  if (g.bld.inited) {
    return;
  }
  g.bld.inited = true;
  g.bld.dirty = true;
  g.bld.helper.pos = lay.HULK.clone();
  g.bld.helper.hp = max_hp();
  refresh(g);
}

// ---------- kích thước và va chạm của vật dựng ----------

/** [nửa dài theo trục x riêng, nửa sâu, có chặn đường đi không, độ cao vẽ: 0 sàn, 1 treo tường, 2 treo trần]. */
export function footprint(item) {
  const n = items.iname(item).toLowerCase();
  const has = (k) => n.includes(k);
  switch (item) {
    case game.SHELF_FLIMSY: return [2.15, 0.33, true, 0];
    case game.SHELF_DUAL: return [1.25, 0.35, true, 0];
    case game.SHELF_SECURE: case game.FRIDGE: case game.RACK: return [0.95, 0.33, true, 0];
    case game.TABLE_SECURE: return [1.25, 0.4, true, 0];
    case game.UNIT_SPECIAL: return [0.65, 0.33, true, 0];
    case game.SPIKE_WALL: return [1.1, 0.35, false, 0];
    case game.BARBED: return [2.3, 0.45, false, 0]; // dài 4,6 m như prefab gốc BarbedWireItemPrefab (integ: trả lại từ 2,4 m); sâu 0,9 m như khung BuildableBoundaryView gốc (0,93 m)
    case game.BEAR_TRAP: return [0.35, 0.35, false, 0];
    case game.TURRET: case game.AUTO_MINIGUN: return [0.45, 0.45, true, 0];
    case game.EXPLOSIVE_BARREL: return [0.33, 0.33, true, 0];
    case game.REMOTE_BOMB: case game.REMOTE_INC: return [0.2, 0.2, false, 0];
    case game.BALLOON: return [0.3, 0.3, false, 0];
  }
  if (has('rug')) return [has('long') ? 1.6 : 0.9, 0.6, false, 0];
  if (has('drape') || has('picture') || has('frame') || has('sign') || has('wall art') || has('clock') && !has('grandfather') || has('camera') || has('speaker') || has('bunting')) return [0.4, 0.1, false, 1];
  if (has('hanging') || has('chandelier') || has('ceiling') || has('linear light')) return [0.3, 0.3, false, 2];
  if (has('sofa') && !has('chair')) return [1.1, 0.45, true, 0];
  if (has('piano') || has('counter') || has('chiller')) return [0.85, 0.4, true, 0];
  if (has('table') || has('desk')) return [0.7, 0.4, true, 0];
  if (has('crate') || has('pallet') || has('barrel') || has('chair') || has('stool') || has('throne') || has('machine') || has('radiator') || has('tv') || has('television') || has('pc') || has('bin')) return [0.4, 0.4, true, 0];
  return [0.28, 0.28, false, 0];
}

/** Hộp phủ chân của vật dựng tại `pos`, xoay `yaw` (làm tròn về hộp theo trục). */
export function prop_box(item, pos, yaw) {
  const [hx, hz] = footprint(item);
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const ex = Math.abs(c) * hx + Math.abs(s) * hz;
  const ez = Math.abs(s) * hx + Math.abs(c) * hz;
  return [pos.x - ex, pos.z - ez, pos.x + ex, pos.z + ez];
}

/** [số cột, số tầng] nếu món là kệ bày hàng, không thì null. */
export function shelf_dims(item) {
  switch (item) {
    case game.SHELF_FLIMSY: return [7, 3];
    case game.SHELF_DUAL: return [4, 3];
    case game.SHELF_SECURE: case game.FRIDGE: return [3, 3];
    case game.RACK: return [3, 2];
    case game.TABLE_SECURE: return [4, 1];
    case game.UNIT_SPECIAL: return [2, 1];
    default: return null;
  }
}

export function defence_hp(item) {
  switch (item) {
    case game.SPIKE_WALL: case game.BEAR_TRAP: case game.BARBED: case game.TURRET: case game.AUTO_MINIGUN: return 300.0;
    case game.EXPLOSIVE_BARREL: case game.REMOTE_BOMB: case game.REMOTE_INC: return 1.0;
    default: return 0.0;
  }
}

/** Chỗ đặt hợp lệ: trong ranh giới, không đè vật cản / vật dựng khác; kệ bày hàng phải nằm trong quán hoặc phòng đã mở. */
export function valid(g, item, pos, yaw) {
  const bx = prop_box(item, pos, yaw);
  const r = 0.02;
  const hit = (b) => bx[0] < b[2] - r && bx[2] > b[0] + r && bx[1] < b[3] - r && bx[3] > b[1] + r;
  if (world.COLLIDERS.some(hit) || g.bld.cols.some(hit)) {
    return false;
  }
  if (g.door_blocks() && hit(lay.DOOR_BOX)) {
    return false;
  }
  if (pos.x < lay.BOUNDS[0] + 1.0 || pos.x > lay.BOUNDS[2] - 1.0 || pos.z < lay.BOUNDS[1] + 0.5 || pos.z > lay.BOUNDS[3] - 1.0) {
    return false;
  }
  for (const p of g.props) {
    if (!p.dead && p.kind.k === 'Placed') {
      const it = p.kind.a;
      const [, , solid, h] = footprint(it);
      if ((solid || footprint(item)[3] === h) && h === footprint(item)[3] && hit(prop_box(it, p.pos, p.yaw))) {
        return false;
      }
    }
  }
  if (shelf_dims(item) !== null && !game.Game.in_shop(pos)) {
    return false;
  }
  return true;
}

// ---------- đặt lên mặt đồ đạc, dời vật đã dựng (fin-build đợt 2, theo clip 10 1:53-2:10) ----------

/** Đồ trang trí nhỏ đặt được lên mặt bàn / kệ (gốc: Small Potted Plant đặt trên mặt kệ gỗ, clip 10 2:00-2:08). */
export function decor_small(item) {
  if (item === game.BARBED || shelf_dims(item) !== null || defence_hp(item) > 0.0) return false;
  const [hx, hz, solid, h] = footprint(item);
  return !solid && h === 0 && hx <= 0.3 && hz <= 0.3;
}

/** Vật dựng có mặt phẳng trên cùng đỡ được đồ trang trí nhỏ: kệ, bàn, bàn làm việc, quầy, thùng, pallet. */
export function surface_of(item) {
  if (shelf_dims(item) !== null) return true;
  const n = items.iname(item).toLowerCase();
  return ['table', 'desk', 'counter', 'crate', 'pallet', 'chiller'].some((k) => n.includes(k));
}

/** Độ cao mặt trên của vật dựng `p` (mét, tính cả p.pos.y). */
export function top_of(p) {
  return p.pos.y + models.top_h(p.kind.a);
}

/** Đặt `item` lên mặt vật dựng `sid` ở `pos` (pos.y = mặt): nằm gọn trong mặt, không đè đồ khác đang đứng trên mặt đó. */
export function valid_on(g, item, pos, yaw, sid) {
  const sp = g.prop(sid);
  if (sp === null || sp.dead || sp.kind.k !== 'Placed' || !decor_small(item)) return false;
  const bx = prop_box(item, pos, yaw), sb = prop_box(sp.kind.a, sp.pos, sp.yaw);
  const m = 0.01;
  if (bx[0] < sb[0] + m || bx[2] > sb[2] - m || bx[1] < sb[1] + m || bx[3] > sb[3] - m) return false;
  const r = 0.02;
  for (const p of g.props) {
    if (p.dead || p.kind.k !== 'Placed' || p.id === sid || Math.abs(p.pos.y - pos.y) > 0.05) continue;
    const b = prop_box(p.kind.a, p.pos, p.yaw);
    if (bx[0] < b[2] - r && bx[2] > b[0] + r && bx[1] < b[3] - r && bx[3] > b[1] + r) return false;
  }
  return true;
}

/** Đồ trang trí đang đứng trên mặt vật dựng `sid`. */
export function resting_on(g, sid) {
  const sp = g.prop(sid);
  if (sp === null || sp.kind.k !== 'Placed') return [];
  const top = top_of(sp), sb = prop_box(sp.kind.a, sp.pos, sp.yaw);
  return g.props.filter((p) => !p.dead && p.id !== sid && p.kind.k === 'Placed' && p.pos.y > 0.05 && Math.abs(p.pos.y - top) < 0.06 &&
    p.pos.x > sb[0] && p.pos.x < sb[2] && p.pos.z > sb[1] && p.pos.z < sb[3]);
}

/** Vật dựng "Grab" được: mọi vật dựng, kể cả kệ bày hàng (hàng trên kệ đi theo kệ, gốc clip 06 2:02-2:12) và dây thép gai. */
export function grabbable(g, id) {
  const p = g.prop(id);
  return p !== null && !p.dead && ((p.kind.k === 'Placed' && !hand_only(p.kind.a)) || p.kind.k === 'Wire');
}

/** Gỡ kệ của vật dựng `id` khỏi danh sách kệ (hình cũ thành mồ côi, khách đang nhắm ô thì bỏ), trả về kệ hoặc null. */
function detach_shelf(g, id) {
  const k = g.shelves.findIndex((s) => s.prop === id);
  if (k === -1) return null;
  const sh = g.shelves.splice(k, 1)[0];
  if (sh.ent !== null) {
    g.cb.orphans.push(sh.ent);
    sh.ent = null;
  }
  for (const c of g.customers) {
    c.slot = null;
  }
  g.bld.dirty = true;
  return sh;
}

/** Dựng lại kệ cho vật dựng `id` ở `pos` / `yaw`, chép hàng từ kệ cũ `old` (nếu có). */
function attach_shelf(g, item, id, pos, yaw, old) {
  const sd = shelf_dims(item);
  if (sd === null) return;
  const sh = new game.Shelf(pos.clone(), yaw, sd[0], sd[1], id);
  if (old) {
    sh.slots = old.slots.slice();
    sh.counts = old.counts.slice();
    sh.plank = old.plank;
  }
  g.shelves.push(sh);
  g.bld.dirty = true;
}

/** Grab: nhấc vật đã dựng lên thành bóng để dời chỗ (gốc: "Grab" trên vật đã đặt, rồi chế độ xây hiện bóng xanh, clip 10 2:03-2:05).
 *  Đồ đang đứng trên mặt nó về ba lô. Huỷ (Esc) thì vật về chỗ cũ. */
export function grab(g, id) {
  if (!grabbable(g, id)) return false;
  const p = g.prop(id);
  const wire = p.kind.k === 'Wire';
  const extra = wire ? [] : resting_on(g, id);
  for (const q of extra) {
    q.dead = true;
    g.inv[q.kind.a] += 1;
  }
  if (extra.length > 0) g.say(`${extra.length} item${extra.length === 1 ? '' : 's'} on top went to the backpack.`);
  p.dead = true;
  if (g.bld.mounted === id) g.bld.mounted = null;
  const item = wire ? game.BARBED : p.kind.a;
  g.bld.grab = { item, hp: wire ? p.kind.a : p.hp, aux: wire ? 0.0 : p.aux, pos: p.pos.clone(), yaw: p.yaw, shelf: wire ? null : detach_shelf(g, id), free: p.free === true };
  g.bld.ghost = [item, p.yaw];
  g.bld.ghost_d = 2.0;
  g.bld.secure_t = 0.0;
  g.bld.dirty = true;
  g.play('pick', 0.5);
  return true;
}

/** Đặt vật đang Grab về chỗ cũ (máu, đạn, hàng trên kệ như lúc nhấc). Trả về id vật dựng mới. */
export function restore_grab(g, gb) {
  if (gb.item === game.BARBED) {
    return g.add_prop({ k: 'Wire', a: gb.hp }, gb.pos.clone(), gb.yaw);
  }
  const id = g.add_prop({ k: 'Placed', a: gb.item }, gb.pos.clone(), gb.yaw);
  const p = g.prop(id);
  if (p !== null) {
    p.hp = gb.hp;
    p.aux = gb.aux;
    p.free = gb.free === true;
  }
  if (gb.free !== true) attach_shelf(g, gb.item, id, gb.pos, gb.yaw, gb.shelf);
  g.bld.dirty = true;
  return id;
}

/** Bẫy gấu như bản gốc (clip 08 13:15 "Grab / Item Details / Arm", 24:00 cầm "Drop / Item Details / Arm"): không qua chế độ
 *  xây; dùng từ ba lô thì thả xuống đất trước mặt (chưa giương, aux = -1), nhắm vào nó bấm [E] Arm thì giương (aux = 0).
 *  aux = 0 là đã giương nên save cũ (aux 0) vẫn là bẫy đã giương. */
export function drop_trap(g, pos, yaw) {
  const id = g.add_prop({ k: 'Placed', a: game.BEAR_TRAP, b: 'closed' }, pos, yaw);
  const p = g.prop(id);
  if (p !== null) {
    p.hp = defence_hp(game.BEAR_TRAP);
    p.aux = -1.0;
  }
  g.play('drop', 0.5);
  g.say('Bear Trap dropped. Aim at it and press [E] to arm it.');
  return id;
}
export function trap_unarmed(p) {
  return p !== null && p !== undefined && p.kind.k === 'Placed' && p.kind.a === game.BEAR_TRAP && p.aux < 0.0;
}
/** Giương bẫy: thay bằng vật dựng mới (hình mở hàm) cùng chỗ, máu giữ nguyên. */
export function arm_trap(g, id) {
  const p = g.prop(id);
  if (!trap_unarmed(p)) return false;
  p.dead = true;
  const nid = g.add_prop({ k: 'Placed', a: game.BEAR_TRAP }, p.pos.clone(), p.yaw);
  const q = g.prop(nid);
  if (q !== null) {
    q.hp = p.hp;
    q.aux = 0.0;
  }
  g.play('bang', 0.4);
  g.say('Bear Trap armed.');
  return true;
}

// ---------- fin-build đợt 4: cầm tay, chế độ xây riêng, vật hiện vàng khi nhắm (mã gốc 1.1.13, clip 08 24:00, clip 10 1:54) ----------
// Mã gốc (decomp Runtime/Player/BuildPlayerActionItem, prefab GameObject/*ItemPrefab): mọi vật dựng (107 prefab có Buildable)
// cũng là RigidbodyPlayerHoldable: tay không cầm lên ("Grab"), thả ("Drop"), nằm đó chưa cố định; ở chế độ xây (ô 2) nhắm vào
// thì vật hiện vàng (BuildModeEditableMaterial) với "Secure" (chưa cố định) / "Detach" (đã cố định), bấm thì thành bóng.
// Chế độ xây còn sửa cửa hỏng (FixDamagedDoorJob, "Repair") và mở bảng nâng cấp (UpgradeableObject, "Upgrade").
// Bẫy gấu, thùng nổ, bom từ xa, bom cháy không có Buildable: cầm tay, thả là dùng; ba món nổ cho "Orient" (Default + Vertical).
// Ba lô vẫn giữ (CHỦ Ý): dùng món từ ba lô = lấy vật ra cầm tay.

/** Vật cầm tay của gốc không qua chế độ xây (thả xuống là dùng). */
export function hand_only(item) {
  return item === game.BEAR_TRAP || item === game.EXPLOSIVE_BARREL || item === game.REMOTE_BOMB || item === game.REMOTE_INC;
}
/** "Orient" (phím O, Rewired action 34 = KeyCode 111) khi cầm tay: prefab gốc _allowedOrientations = -1 (đứng / nằm). */
export function orientable(item) {
  return item === game.EXPLOSIVE_BARREL || item === game.REMOTE_BOMB || item === game.REMOTE_INC;
}
/** Khoảng cầm tay [gần nhất, xa nhất] (m, dọc tia nhìn) theo prefab gốc: RigidbodyPlayerHoldable MinimumHoldDistance /
 *  MaximumHoldDistance (+ HoldDistanceOffset 0 ở mọi vật dựng). Mặc định 1-5; thùng nổ 2-5; kệ đôi, thùng gỗ vừa / đôi, pallet,
 *  tủ lạnh, bàn khoá, kệ đồ đặc biệt, giá súng, bàn trà, bàn sang, bàn học, quầy lạnh 3-5. */
export function hold_range(item) {
  if (item === game.EXPLOSIVE_BARREL) return [2.0, 5.0];
  if (item === game.SHELF_DUAL || item === game.FRIDGE || item === game.TABLE_SECURE || item === game.UNIT_SPECIAL || item === game.RACK) return [3.0, 5.0];
  const n = items.iname(item).toLowerCase();
  if (/double storage crate|medium storage crate|pallet|coffee table|elegant table|study desk|chilled counter|chiller/.test(n)) return [3.0, 5.0];
  return [1.0, 5.0];
}
/** Khoảng cầm lúc nhặt lên: gốc PlayerHoldControlSettings.DefaultHoldDistance 1 m x StartHoldDistanceMultiplier 1, kẹp vào hold_range. */
export function hold_start(item) {
  return Math.max(hold_range(item)[0], 1.0);
}
/** Nửa chiều cao (m) để tâm vật nằm trên tia nhìn khi cầm tay (gốc giữ tâm rigidbody ở điểm cầm). */
export function hold_half(item, orient) {
  if (item === game.EXPLOSIVE_BARREL) return orient ? 0.29 : 0.45;
  if (item === game.REMOTE_BOMB || item === game.REMOTE_INC) return orient ? 0.11 : 0.12;
  if (item === game.BEAR_TRAP) return 0.09; // fin-build đợt 6: bẫy cỡ gốc, hàm hơi dựng cao ~0,18 m
  if (item === game.SPIKE_WALL || item === game.BARBED) return 0.3;
  if (shelf_dims(item) !== null) return 0.6;
  return footprint(item)[2] ? 0.4 : 0.15;
}

/** Dùng từ ba lô thì cầm tay: mọi vật dựng và vật cầm tay ở trên. */
export function hand_item(item) {
  return hand_only(item) || items.buildable(item);
}
/** Vật dựng nằm đó chưa cố định (thả từ tay): không chạy (kệ không bày hàng, tháp súng không bắn), nhắm ở chế độ xây thì "Secure". */
export function loose(p) {
  return p !== null && p !== undefined && !p.dead && p.kind.k === 'Placed' && p.free === true;
}
/** Tay không "Grab" được: vật dựng chưa cố định và vật cầm tay của gốc (bẫy, thùng nổ, bom). */
export function hand_grabbable(g, id) {
  const p = g.prop(id);
  return p !== null && !p.dead && p.kind.k === 'Placed' && (p.free === true || hand_only(p.kind.a));
}

/** Lấy món `item` từ ba lô ra cầm tay. Trả về id vật (đang cầm) | null. */
export function take_out(g, item) {
  if (g.held !== null || g.inv[item] <= 0) return null;
  g.inv[item] -= 1;
  const yaw = Math.round(g.yaw / (Math.PI / 4)) * (Math.PI / 4);
  const kind = item === game.BEAR_TRAP ? { k: 'Placed', a: item, b: 'closed' } : { k: 'Placed', a: item };
  const id = g.add_prop(kind, g.player.clone(), yaw);
  const p = g.prop(id);
  p.hp = defence_hp(item);
  p.aux = item === game.BEAR_TRAP ? -1.0 : (item === game.TURRET || item === game.AUTO_MINIGUN) ? 120.0 : 0.0;
  p.free = !hand_only(item);
  p.orient = 0;
  g.held = id;
  g.armed = false;
  g.bld.hold_d = hold_start(item);
  g.play('pick', 0.5);
  return id;
}

/** Tay không "Grab" vật dưới đất lên tay. */
export function grab_hand(g, id) {
  if (g.held !== null || !hand_grabbable(g, id)) return false;
  const p = g.prop(id);
  if (g.bld.mounted === id) g.bld.mounted = null;
  for (const q of resting_on(g, id)) {
    q.dead = true;
    g.inv[q.kind.a] += 1;
  }
  g.held = id;
  g.armed = false;
  g.bld.hold_d = hold_start(p.kind.a); // gốc OnPickUp: HoldDistance = DefaultHoldDistance (1 m), kẹp trong khoảng của prefab
  g.play('pick', 0.5);
  return true;
}

/** Thả vật đang cầm ("Drop") ở `spot` (sàn hoặc mặt bàn). Vật dựng nằm đó chưa cố định; vật cầm tay của gốc dùng luôn. */
export function drop_held(g, spot) {
  const id = g.held;
  const p = id !== null ? g.prop(id) : null;
  if (p === null || p.kind.k !== 'Placed') return false;
  g.held = null;
  p.pos = spot.clone();
  p.dirty = true;
  g.play('drop', 0.5);
  if (p.kind.a === game.BEAR_TRAP && p.aux < 0.0) g.say('Bear Trap dropped. Aim at it and press [F] to arm it.');
  return true;
}

/** Đổi hướng vật đang cầm ("Orient"): đứng / nằm. */
export function orient_held(g) {
  const p = g.held !== null ? g.prop(g.held) : null;
  if (p === null || p.kind.k !== 'Placed' || !orientable(p.kind.a)) return false;
  p.orient = p.orient ? 0 : 1;
  p.dirty = true;
  g.play('click', 0.3);
  return true;
}

/** Đích của chế độ xây đang nhắm (vật hiện vàng): {k:'Prop', a:id} | {k:'Door'} | {k:'Station', a:st} | {k:'Bed'} | null. */
export function edit_target(g, t) {
  if (t === null || t === undefined) return null;
  switch (t.k) {
    case 'Prop': {
      const p = g.prop(t.a);
      if (p === null || p.dead) return null;
      if (p.kind.k === 'Wire') return { k: 'Prop', a: p.id };
      if (p.kind.k === 'Placed' && !hand_only(p.kind.a)) return { k: 'Prop', a: p.id };
      return null;
    }
    case 'Shelf': case 'Tag': {
      const sh = g.shelves[t.a];
      return sh !== undefined && sh.prop !== 0 ? { k: 'Prop', a: sh.prop } : null;
    }
    case 'Door': return g.door.hp < game.DOOR_HP ? { k: 'Door' } : null;
    case 'Station': {
      const tr = tier_of(t.a);
      return tr !== null && tier_req(tr, g.bld.tiers[tr]) !== null ? { k: 'Station', a: t.a } : null;
    }
    case 'Bed': return tier_req(T_BED, g.bld.tiers[T_BED]) !== null ? { k: 'Bed' } : null;
    default: return null;
  }
}

/** Dòng nhắc của chế độ xây khi nhắm `e` (edit_target). */
export function edit_prompt(g, e) {
  if (e === null) return '';
  switch (e.k) {
    case 'Prop': {
      const p = g.prop(e.a);
      const name = p.kind.k === 'Wire' ? 'Barbed Wire' : items.iname(p.kind.a);
      return `[LMB] ${loose(p) ? 'Secure' : 'Detach'}\n${name}`;
    }
    case 'Door': return `[hold LMB] Repair\nFront door (${g.door.hp.toFixed(0)}/${game.DOOR_HP.toFixed(0)})`;
    case 'Station': return `[LMB] ${e.a === ST_SHREDDER && g.bld.tiers[T_SHREDDER] === 0 ? 'Repair' : 'Upgrade'}\n${TIER_TITLES[tier_of(e.a)]}`;
    case 'Bed': return `[LMB] Upgrade\n${TIER_TITLES[T_BED]}`;
    default: return '';
  }
}

/** Bấm chuột trái ở chế độ xây trên `e` (cửa giữ chuột do player.js đếm). */
export function edit_click(g, e) {
  if (e === null) return false;
  switch (e.k) {
    case 'Prop': return grab(g, e.a);
    case 'Station': upgrade_key(g, e.a); return g.panel.k !== 'None';
    case 'Bed': bed_upgrade(g); return g.panel.k !== 'None';
    default: return false;
  }
}

/** Vật dựng / vật cầm tay đang cầm | null. */
export function held_placed(g) {
  const p = g.held !== null ? g.prop(g.held) : null;
  return p !== null && !p.dead && p.kind.k === 'Placed' ? p : null;
}

/** Huỷ chế độ xây: món mới về ba lô; vật đang Grab về chỗ cũ. */
export function cancel(g) {
  const gh = g.bld.ghost;
  g.bld.ghost = null;
  g.bld.secure_t = 0.0;
  if (gh === null) return;
  const gb = g.bld.grab;
  g.bld.grab = null;
  if (gb !== null && gb.item === gh[0]) {
    restore_grab(g, gb);
  } else {
    g.inv[gh[0]] += 1;
  }
}

/** Cố định vật đang đặt: sinh vật dựng (và kệ nếu là kệ). */
export function secure(g) {
  const gh = g.bld.ghost;
  g.bld.ghost = null;
  if (gh === null) return;
  const [item, yaw] = gh;
  const pos = g.bld.ghost_pos.clone();
  g.bld.secure_t = 0.0;
  const gb = g.bld.grab;
  if (item === game.BARBED) {
    g.add_prop({ k: 'Wire', a: gb !== null && gb.item === item ? gb.hp : 300.0 }, pos, yaw);
  } else {
    const id = g.add_prop({ k: 'Placed', a: item }, pos, yaw);
    const hp = defence_hp(item);
    const p = g.prop(id);
    if (p !== null) {
      p.hp = hp;
      p.aux = (item === game.TURRET || item === game.AUTO_MINIGUN) ? 120.0 : 0.0;
      // vật dời chỗ bằng Grab giữ máu và đạn
      if (gb !== null && gb.item === item) {
        p.hp = gb.hp;
        p.aux = gb.aux;
      }
    }
    g.bld.dirty = true;
    attach_shelf(g, item, id, pos, yaw, gb !== null && gb.item === item ? gb.shelf : null);
  }
  g.bld.grab = null;
  g.play('place', 0.8);
  g.say(`${items.iname(item)} secured.`);
}

/** Gỡ một vật dựng về ba lô (kèm hàng trên kệ, đạn trong tháp súng). */
export function pick_up(g, id) {
  const p = g.prop(id);
  if (p === null) return;
  if (p.kind.k !== 'Placed') return;
  const item = p.kind.a;
  const ammo = trunc(p.aux);
  for (const q of resting_on(g, id)) {
    q.dead = true;
    g.inv[q.kind.a] += 1;
  }
  p.dead = true;
  if ((item === game.TURRET || item === game.AUTO_MINIGUN) && ammo > 0) {
    g.inv[game.AMMO_556] += ammo;
  }
  const k = g.shelves.findIndex((s) => s.prop === id);
  if (k !== -1) {
    const sh = g.shelves.splice(k, 1)[0];
    // Món lẻ về lại ba lô thành thùng: đủ `case_units()` món lẻ cùng loại là một món (thùng bán dở thì làm tròn lên).
    for (let s = 0; s < sh.slots.length; s++) {
      const it = sh.slots[s];
      if (it !== null) g.inv[it] += Math.ceil(sh.units(s) / game.case_units());
    }
    g.bld.dirty = true;
    // Hình kệ cũ được xoá ở world::sync_world qua danh sách kệ mồ côi.
    if (sh.ent !== null) {
      g.cb.orphans.push(sh.ent);
    }
    for (const c of g.customers) {
      c.slot = null;
    }
  }
  if (g.bld.mounted === id) {
    g.bld.mounted = null;
  }
  g.inv[item] += 1;
  g.play('pick', 0.6);
  g.say(`Picked up ${items.iname(item)}.`);
}

// ---------- trạm ----------

/** [tên bậc, [[món, số lượng]...]] | null */
export function tier_req(station, tier) {
  const name = TIER_NAMES[station][tier];
  if (name === undefined) return null;
  const u = data.UPGRADES.find((u) => u[0] === name);
  return u === undefined ? null : [u[0], u[1]];
}

export function tier_of(station) {
  switch (station) {
    case ST_BENCH: return T_BENCH;
    case ST_SHREDDER: return T_SHREDDER;
    case ST_GENERATOR: return T_GEN;
    case ST_INTEL: return T_INTEL;
    case ST_SIREN: return T_SIREN;
    default: return null;
  }
}

/** Các hộp nhắm của trạm: [mã trạm, góc dưới, góc trên]. */
export function targets(g) {
  const v = v3;
  const b2 = (b, y0, y1) => [v(b[0], y0, b[1]), v(b[2], y1, b[3])];
  const out = [];
  const add = (id, bx) => out.push([id, bx[0], bx[1]]);
  add(ST_JOBS, [lay.JOB_BOARD_BOX[0], lay.JOB_BOARD_BOX[1]]);
  add(ST_INTEL, b2(lay.INTEL_BOX, 0.0, 1.9));
  if (g.on(game.FF_CORPSES)) {
    for (const d of lay.DUMPSTERS) {
      add(ST_DUMPSTER, [d.add(v(-1.0, 0.0, -0.6)), d.add(v(1.0, 1.4, 0.6))]);
    }
  }
  if (g.on(game.FF_DEFENCE)) {
    add(ST_SIREN, [lay.SIREN.add(v(-0.8, 0.0, -0.8)), lay.SIREN.add(v(0.8, 2.6, 0.8))]);
  }
  if (!g.bld.wh_open) {
    add(ST_WH_DOOR, b2(lay.WH_DOOR_BOX, 0.0, 2.2));
  } else {
    add(ST_BENCH, b2(lay.WORKBENCH_BOX, 0.0, 1.5));
    add(ST_SHREDDER, b2(lay.SHREDDER_BOX, 0.0, 2.0));
    add(ST_GENERATOR, b2(lay.GENERATOR_BOX, 0.0, 1.5));
  }
  if (!g.on(game.FF_BUILD)) {
    // không có gì
  } else if (!g.bld.med_open) {
    add(ST_MED_DOOR, b2(lay.MED_DOOR_BOX, 0.0, 2.2));
  } else if (!g.bld.helper.freed) {
    add(ST_HULK, [lay.HULK.add(v(-0.7, 0.0, -0.7)), lay.HULK.add(v(0.7, 2.6, 0.7))]);
  }
  if (g.on(game.FF_BUILD) && g.bld.med_open) add(ST_SYRINGE, [SYRINGE.add(v(-0.35, 0.0, -0.3)), SYRINGE.add(v(0.35, 1.5, 0.3))]);
  if (g.ev.gib_here) {
    add(ST_GIB, [lay.GIB.add(v(-1.6, 0.0, -1.2)), lay.GIB.add(v(1.6, 2.6, 1.2))]);
  }
  if (g.ev.merchant_here) {
    add(ST_MERCHANT, [lay.MERCHANT.add(v(-3.2, 0.0, -1.3)), lay.MERCHANT.add(v(3.2, 2.8, 1.3))]);
  }
  return out;
}

/** [par-counter D19] "Grab": lấy một ống máu ở Syringe Station vào ba lô (The Cure). */
export function syringe_grab(g) {
  if (g.bld.syr <= 0) { g.play('deny', 0.4); return; }
  g.bld.syr -= 1;
  g.bld.dirty = true;
  g.inv[THE_CURE] += 1;
  g.play('pick', 0.5);
  g.say('Picked up The Cure. Give it to an infected customer.');
}

export function has_tool(g, item) {
  return g.inv[item] > 0 || g.has_w(item);
}

export function upgrade_hint(g, station) {
  // fin-build đợt 4: nâng cấp qua chế độ xây như gốc (vật hiện vàng, "Upgrade"), không còn phím U
  return '';
}

/** Vật đang cầm là xác (PropKind::Corpse). */
function held_is_corpse(g) {
  if (g.held === null) return false;
  const p = g.props.find((p) => p.id === g.held);
  return p !== undefined && p.kind.k === 'Corpse';
}

export function prompt(g, st) {
  const b = g.bld;
  switch (st) {
    case ST_BENCH: return `[E] Crafting bench (level ${b.tiers[T_BENCH] + 1})${upgrade_hint(g, T_BENCH)}`;
    case ST_SHREDDER:
      if (b.tiers[T_SHREDDER] === 0) {
        return `Broken shredder - needs 96 Sawblade (${g.inv[game.SAWBLADE]} carried)   [B] Build mode to repair`;
      } else if (held_is_corpse(g)) {
        return '[E] Shred the corpse (meat and bone)';
      } else {
        return '[E] Shredder';
      }
    case ST_GENERATOR:
      if (b.tiers[T_GEN] === 0) {
        return `Empty generator - needs 4 Gas Can (${g.inv[game.GAS_CAN]} carried)   [B] Build mode to fuel`;
      } else if (!b.gen_fixed) {
        return has_tool(g, game.STUN_STICK) ? '[hold E] Jump-start the faulty generator with the Taser Stick' : 'Fuelled but faulty - requires a Taser Stick';
      } else {
        return 'Generator - running (Dr. Gib visits after 06:00 PM)';
      }
    case ST_INTEL: {
      const names = ['Notes board', 'Radio', 'Long-range radio', 'Surveillance hub'];
      return `[E] ${names[Math.min(b.tiers[T_INTEL], 3)]}${upgrade_hint(g, T_INTEL)}`;
    }
    case ST_JOBS: return '[E] Job Board';
    case ST_SIREN:
      return b.tiers[T_SIREN] === 0 ? 'Radio tower - no siren fitted   [B] Build mode to fix' : '[hold E] Sound the siren (calls the next raid for tomorrow 09:30)';
    case ST_DUMPSTER:
      return held_is_corpse(g) ? '[E] Dump the corpse' : 'Dumpster (drag corpses here)';
    case ST_WH_DOOR: return has_tool(g, game.CROWBAR) ? '[hold E] Pry open - Warehouse door' : 'Bolted door - requires a Crowbar';
    case ST_MED_DOOR: return has_tool(g, game.CHAINSAW) ? '[hold E] Cut open - Medical room door' : 'Chained door - requires a Chainsaw';
    case ST_HULK: return has_tool(g, game.CHAINSAW) ? '[hold E] Cut the chains - free the Hulk' : 'Chained Hulk - requires a Chainsaw';
    case ST_SYRINGE: {
      const can = g.hp_max - BLOOD_COST >= 40.0;
      const grab = b.syr > 0 ? `   [RMB] Grab` : '';
      return `Syringe Station (${b.syr} filled)   ${can ? '[hold E] Extract Blood' : 'Too weak to give more blood today'}${grab}`;
    }
    case ST_GIB: return `[E] Dr. Gib's wheel (${events.spin_cost(g)} Good Meat a spin)`;
    case ST_MERCHANT: return '[E] Exotic Merchant';
    default: return '';
  }
}

export function hold_time(g, st) {
  const b = g.bld;
  if (st === ST_WH_DOOR && has_tool(g, game.CROWBAR)) return 3.0;
  if ((st === ST_MED_DOOR || st === ST_HULK) && has_tool(g, game.CHAINSAW)) return 3.0;
  if (st === ST_GENERATOR && b.tiers[T_GEN] > 0 && !b.gen_fixed && has_tool(g, game.STUN_STICK)) return 3.0;
  if (st === ST_SIREN && b.tiers[T_SIREN] > 0) return 5.0;
  if (st === ST_SYRINGE && g.hp_max - BLOOD_COST >= 40.0) return 2.5;
  return 0.0;
}

export function finish_hold(g, st) {
  switch (st) {
    case ST_WH_DOOR: {
      g.bld.wh_open = true;
      g.bld.dirty = true;
      refresh(g);
      g.play('break', 0.8);
      g.say('Warehouse door pried open. Something moves inside...');
      g.toast = 'Backroom Privileges';
      g.toast_t = 3.5;
      // Luật gốc: mở cửa kho thì mỗi điểm sinh trong kho (3 điểm) ra một zombie nhắm vào người chơi.
      const spots = [[-1.5, -9.5], [6.0, -9.0], [10.5, -14.0]];
      for (let k = 0; k < spots.length; k++) {
        const [x, z] = spots[k];
        const i = actors.spawn_zombie(g, 'Base', v3(x, 0.0, z), false);
        g.zombies[i].chasing = true;
        g.zombies[i].stagger = 0.0; // phiên 8: luật gốc, ba con ra cùng lúc (bỏ độ trễ 2,5 / 5 s [ĐỀ XUẤT] cũ)
      }
      // [par-counter D37] gốc "Break the boxes in the warehouse to find a crafting recipe" (loc:quest_find_recipe): ba thùng
      // gỗ quanh chỗ cũ của tờ công thức, đập vỡ bằng vũ khí cận chiến; một thùng có tờ công thức Bandage, hai thùng kia
      // [ĐỀ XUẤT] một Metal Scraps / một Worn Cloth.
      const rs = lay.RECIPE_SPOT;
      g.add_prop({ k: 'WBox', a: [13] }, v3(rs.x, 0.0, rs.z), 0.3);
      g.add_prop({ k: 'WBox', a: [game.METAL_SCRAP] }, v3(rs.x + 0.9, 0.0, rs.z - 0.2), 1.1);
      g.add_prop({ k: 'WBox', a: [game.CLOTH] }, v3(rs.x - 0.85, 0.0, rs.z + 0.15), 2.0);
      break;
    }
    case ST_MED_DOOR:
      g.bld.med_open = true;
      g.bld.dirty = true;
      refresh(g);
      g.play('break', 0.8);
      g.say('The medical room is open. A chained Hulk stares at you.');
      break;
    case ST_SYRINGE:
      g.bld.syr += 1;
      g.bld.dirty = true;
      g.blood_cost = (g.blood_cost || 0) + BLOOD_COST;
      g.hp_max -= BLOOD_COST;
      g.hp = Math.min(g.hp, g.hp_max);
      g.play('pick', 0.6);
      g.say(`Blood extracted: -${BLOOD_COST.toFixed(0)} Max HP until you sleep. Grab the syringe [RMB]: The Cure heals an infected customer.`);
      break;
    case ST_HULK:
      g.bld.helper.freed = true;
      g.bld.helper.hp = helper_max(g);
      g.play('roar', 0.8);
      g.say(`${g.bld.helper.name} is free. The Hulk will guard the lot and fight zombies for you.`);
      g.panel = { k: 'Name', v: g.bld.helper.name }; // [par-panels] C33: đặt tên như bản gốc (sheet 5:00:40)
      break;
    case ST_GENERATOR:
      g.bld.gen_fixed = true;
      g.bld.dirty = true;
      g.play('quest', 0.7);
      g.say("The generator hums. Dr. Gib's wheel will visit behind the store after 06:00 PM.");
      break;
    case ST_SIREN:
      combat.siren(g);
      break;
    default:
      break;
  }
}

/** Bấm E trên một trạm. */
export function press(g, st) {
  switch (st) {
    case ST_BENCH:
      g.panel = { k: 'Craft' };
      g.craft_tab = 0;
      g.craft_sel = 0;
      g.play('click', 0.5);
      break;
    case ST_SHREDDER:
      if (g.bld.tiers[T_SHREDDER] === 0) {
        g.play('deny', 0.5);
        g.say('The shredder is broken. Repair it with 96 Sawblade in build mode [B].');
      } else if (!combat.dispose_held(g, true)) {
        g.panel = { k: 'Craft' };
        g.craft_tab = 1;
        g.craft_sel = 0;
      }
      break;
    case ST_INTEL:
      g.panel = { k: 'Radio' };
      g.play('radio', 0.5);
      break;
    case ST_JOBS:
      g.panel = { k: 'Jobs' };
      g.play('click', 0.5);
      break;
    case ST_DUMPSTER:
      if (!combat.dispose_held(g, false)) {
        g.say('Carry a corpse here to dump it. [E] on a corpse drags it.');
      }
      break;
    case ST_GIB:
      events.open(g, { k: 'Wheel' });
      break;
    case ST_MERCHANT:
      events.open(g, { k: 'Merchant' });
      break;
    default:
      break;
  }
}

/** Bấm U trên một trạm: mở bảng nâng cấp. */
export function upgrade_key(g, st) {
  const t = tier_of(st);
  if (t !== null) {
    if (tier_req(t, g.bld.tiers[t]) !== null) {
      events.open(g, { k: 'Upgrade', a: t });
    }
  }
}

/** Các dòng của bảng nâng cấp: [tên bậc, [[món, cần, đang có]...]] | null. */
export function upgrade_rows(g, t) {
  const tr = tier_req(t, g.bld.tiers[t]);
  if (tr === null) return null;
  const [name, req] = tr;
  return [`${TIER_TITLES[t]} -> ${name}`, req.map(([it, n]) => [it, n, g.inv[it] + g.weapons.filter((w) => w.item === it).length])];
}

export function upgrade_pay(g, t) {
  const ur = upgrade_rows(g, t);
  if (ur === null) return false;
  const [name, rows] = ur;
  if (rows.some(([, need, have]) => have < need)) {
    g.play('deny', 0.5);
    g.say('Missing materials for this upgrade.');
    return false;
  }
  for (const [it, need0] of rows) {
    let need = need0;
    const from_inv = Math.min(need, g.inv[it]);
    g.inv[it] -= from_inv;
    need -= from_inv;
    while (need > 0) {
      const k = g.weapons.findIndex((w) => w.item === it);
      if (k !== -1) {
        g.weapons.splice(k, 1);
        g.wsel = 0;
      }
      need -= 1;
    }
  }
  g.bld.tiers[t] = (g.bld.tiers[t] + 1) & 255;
  g.bld.dirty = true;
  g.play('quest', 0.7);
  g.say(`Upgraded: ${name}.`);
  return true;
}

/** Giờ thức dậy theo bậc giường: 07:00, túi ngủ 06:00, giường đơn 05:00. */
export function wake_hour(g) {
  return 7.0 - g.bld.tiers[T_BED];
}

export function bed_upgrade(g) {
  if (tier_req(T_BED, g.bld.tiers[T_BED]) !== null) {
    events.open(g, { k: 'Upgrade', a: T_BED });
  }
}

// ---------- sơn ----------

/** Phòng người chơi đang đứng: 0 quán, 1 SF2, 2 SF3; null nếu ngoài. */
export function room_of(p) {
  if (lay.inside(lay.SHOP, p)) {
    return 0;
  } else if (lay.rooms() >= 1 && lay.inside(lay.SF2, p)) {
    return 1;
  } else if (lay.rooms() >= 2 && lay.inside(lay.SF3, p)) {
    return 2;
  } else {
    return null;
  }
}

/** Mẫu sơn dùng được với xô sơn / vật liệu sàn `item`: bậc thấp 1/3 đầu danh sách, bậc vừa 2/3, bậc cao tất cả [ĐỀ XUẤT]. */
export function paints_for(item) {
  const floor = item === game.LOW_FLOOR || item === game.MID_FLOOR || item === game.HIGH_FLOOR;
  const all = [];
  for (let i = 0; i < data.PAINTS.length; i++) if (data.PAINTS[i][1] === floor) all.push(i);
  let k;
  switch (item) {
    case game.LOW_PAINT: case game.LOW_FLOOR: k = trunc(all.length / 3); break;
    case game.MID_PAINT: case game.MID_FLOOR: k = trunc(all.length * 2 / 3); break;
    default: k = all.length;
  }
  // Rust `all[..k.max(1)]` panics when `all` is empty; slice here just returns what exists.
  return all.slice(0, Math.max(k, 1));
}

export function start_paint(g, paint) {
  const room = room_of(g.player);
  if (room === null) {
    g.play('deny', 0.5);
    g.say('Stand inside the store to paint.');
    return;
  }
  const floor = data.PAINTS[paint][1];
  if (g.bld.paint[room * 2 + (floor ? 1 : 0)] === ((paint + 1) & 255)) {
    g.say('That is already applied here.');
    return;
  }
  g.bld.paint_job = [room, floor, paint & 255, 0.0];
  g.panel = { k: 'None' };
  g.play('click', 0.6);
}

/** Màu tường / sàn của một phòng theo mẫu sơn: [màu, hoa văn shader] | null. */
export function paint_col(g, room, floor) {
  const k = g.bld.paint[room * 2 + (floor ? 1 : 0)];
  if (k === 0) {
    return null;
  }
  const name = data.PAINTS[k - 1][0];
  const table = [['Blue', 0x3f6fa8], ['Navy', 0x26385c], ['Green', 0x4a7a4a], ['Red', 0x9a3a32], ['Purple', 0x6a4a8a], ['Yellow', 0xc8a83a], ['Teal', 0x3a8a86], ['Grey', 0x7a7d80], ['Fall', 0xa8662a], ['Pink', 0xc87a94], ['Marble', 0xd8d4cc], ['Redwood', 0x7a3a2a], ['Wood', 0x8a6a44], ['Arcade', 0x3a2a5a], ['Chequered', 0xb8b4a8], ['Clean', 0xcfd4d0], ['Grotty', 0x6a6a58], ['Dirty', 0x5a4a38]];
  const f = table.find(([n]) => name.includes(n));
  const col = f !== undefined ? f[1] : 0x8a8f78;
  let pat;
  if (name.includes('Stripe')) {
    pat = geom.STRIPES;
  } else if (name.includes('Carpet')) {
    pat = geom.CARDBOARD;
  } else if (name.includes('Tiles') || name.includes('Marble') || name.includes('Camo')) {
    pat = geom.CONCRETE;
  } else if (name.includes('Wood') || name.includes('wood')) {
    pat = geom.WOOD;
  } else if (name.includes('Scrappy')) {
    pat = geom.CORRUGATED;
  } else {
    pat = geom.PLASTER;
  }
  return [hex(col), pat];
}

// ---------- Hulk Helper ----------

export function helper_max(g) {
  const m = skills.mul(g, 'HelperMaxHealthMultiplier');
  return max_hp() * (m > 0.0 ? m : 1.0);
}

/** ZKind::boss() (combat.rs) inlined so this module does not depend on how that impl method is exported. */
function zkind_boss(k) {
  return k === 'Brute' || k === 'Birther' || k === 'Sweaty' || k === 'TwinBuff' || k === 'TwinHeal';
}

export function tick_helper(g, dt) {
  if (!g.bld.helper.freed || g.bld.helper.down) {
    return;
  }
  const h = g.bld.helper;
  g.bld.helper = new Helper();
  h.moving = false;
  h.cd -= dt;
  h.swing = Math.max(h.swing - dt, 0.0);
  let target = null;
  {
    let best = Infinity;
    for (let i = 0; i < g.zombies.length; i++) {
      const z = g.zombies[i];
      if (!z.dead && z.hp > 0.0 && z.pos.distance(h.pos) < 25.0) {
        const d = z.pos.distance(h.pos);
        if (target === null || d < best) {
          best = d;
          target = [i, z.pos.clone()];
        }
      }
    }
  }
  const go = (h, to, speed, g) => {
    const d = v3(to.x - h.pos.x, 0.0, to.z - h.pos.z);
    if (d.length() > 0.05) {
      h.pos = world.resolve(g, h.pos.add(d.normalize().mul(Math.min(speed * dt, d.length()))), 0.45);
      h.yaw = Math.atan2(-d.x, -d.z);
      h.moving = true;
      h.phase += dt * speed * 2.2;
    }
  };
  if (target !== null) {
    const [zi, zp] = target;
    if (zp.distance(h.pos) > 2.0) {
      go(h, zp, 4.0, g);
    } else if (h.cd <= 0.0) {
      h.cd = 1.0;
      h.swing = 0.45;
      const dmg = 150.0 * (skills.has(g, 'HelperDamageMultiplier') ? 1.25 : 1.0);
      g.zombies[zi].hp -= dmg;
      g.zombies[zi].stagger = 0.5;
      g.fxq.push([fx.FX_BLOOD, zp.add(Y.mul(1.2))]);
      g.play('crit', 0.6);
    }
  } else {
    h.pause -= dt;
    const to = lay.HELPER_POINTS[h.goal % lay.HELPER_POINTS.length];
    if (h.pos.distance(to) < 0.8) {
      if (h.pause <= 0.0) {
        h.pause = g.rng.range(1.0, 3.0);
        h.goal = Math.max(g.rng.int(0, lay.HELPER_POINTS.length - 1), 0);
      }
    } else if (h.pause <= 0.0) {
      // Ra khỏi phòng y tế qua cửa rồi mới đi tuần ngoài bãi.
      // [SỬA KHI CHUYỂN NGỮ] Trong bề dày tường (x -5,25..-5,0) Stompy không thuộc phòng y tế lẫn quán nên quay lại đích ngoài bãi,
      // rồi lại vào phòng: đứng giật tại ngưỡng cửa mãi (đo bằng tools/t-helper.mjs). Coi ngưỡng cửa là còn trong phòng y tế.
      const in_med_door = h.pos.x >= lay.MED_DOOR_BOX[0] - 0.05 && h.pos.x <= lay.MED_DOOR_BOX[2] + 0.05 && h.pos.z > lay.MED_DOOR_BOX[1] && h.pos.z < lay.MED_DOOR_BOX[3];
      const via = lay.inside(lay.MEDICAL_IN, h.pos) || in_med_door ? lay.MED_B.add(v3(1.2, 0.0, 0.0)) : game.Game.in_shop(h.pos) && h.pos.distance(lay.DOOR_IN) > 0.6 && h.pos.z < lay.DOOR_IN.z ? lay.DOOR_IN : game.Game.in_shop(h.pos) ? lay.DOOR_OUT : to;
      go(h, via, 2.2, g);
      // Tới cửa chính mà cửa đang đóng (đêm, quán đã đóng) thì tự đẩy cửa ra, không thì kẹt trong quán cả đêm.
      if (game.Game.in_shop(h.pos) && h.pos.distance(lay.DOOR_IN) < 1.6 && !g.door.open && g.door.hp > 0.0) {
        g.door.open = true;
        g.play('door', 0.5);
      }
    }
  }
  if (h.hp <= 0.0) {
    h.down = true;
    g.say(`${h.name} has been knocked out. He will be back on his feet tomorrow.`);
  }
  g.bld.helper = h;
}

// ---------- đội phá tường ----------

export function crew_arrive(g, room) {
  if (g.bld.rooms >= 2 || g.bld.crew.length !== 0) {
    return;
  }
  const side = room <= 1 ? 0 : 1;
  const base = lay.CREW_SPOTS[side];
  for (let k = 0; k < 5; k++) {
    const spot = base.add(v3(0.0, 0.0, -3.2 + k * 1.4));
    const path = [lay.GATES[0][1].clone(), lay.DOOR_OUT.clone(), lay.DOOR_IN.clone()];
    if (side === 1) {
      path.push(v3(9.0, 0.0, 1.0));
    }
    path.push(spot.clone());
    const seed = (g.rng.s ^ ((0xc4e7 + k * 977) >>> 0)) >>> 0;
    g.rng.next();
    g.bld.crew.push(new Labourer({ body: null, seed, pos: lay.GATES[0][0].add(v3(k * 0.9 - 1.8, 0.0, 1.0 + (k % 2))), yaw: 0.0, path, spot, timer: g.rng.range(0.5, 0.75), swing: 0.0, phase: 0.0, moving: false, leaving: false, gone: false }));
  }
  g.bld.wall_hits = 0;
  // Đội thợ tự mở cửa trước để vào (cửa còn lành).
  if (!g.door.open && g.door.hp > 0.0) {
    g.door.open = true;
  }
  g.play('radio', 0.6);
  g.say('The demolition crew has arrived. They will knock the wall down (75 hits).');
}

export function tick_crew(g, dt) {
  if (g.bld.crew.length === 0) {
    return;
  }
  const crew = g.bld.crew;
  g.bld.crew = [];
  let hits = 0;
  for (const l of crew) {
    l.moving = false;
    l.swing = Math.max(l.swing - dt, 0.0);
    if (l.path.length !== 0) {
      const sp = game.Game.in_shop(l.pos) ? 2.0 : 3.2;
      // Rust: walk(&mut l.pos, &mut l.yaw, &mut l.path, sp, dt) -> JS passes the owner of pos/yaw/path.
      l.moving = actors.walk(l, sp, dt);
      l.phase += dt * 8.0;
      if (l.path.length === 0 && l.leaving) {
        l.gone = true;
      }
      continue;
    }
    if (l.leaving) {
      continue;
    }
    l.yaw = -Math.PI / 2;
    l.timer -= dt;
    if (l.timer <= 0.0) {
      // Nhịp vung: hồi chiêu vũ khí (búa 0,75 s) + ngẫu nhiên 0,5..0,75 s.
      l.timer = 0.75 + g.rng.range(0.5, 0.75);
      l.swing = 0.45;
      hits += 1;
      g.play('bang', 0.5);
      g.fxq.push([fx.FX_DEBRIS, l.spot.add(v3(0.6, 1.3, 0.0))]);
    }
  }
  g.bld.wall_hits += hits;
  if (g.bld.wall_hits >= 75 && crew.some((l) => !l.leaving)) {
    g.bld.rooms += 1;
    g.bld.wall_hits = 0;
    g.bld.dirty = true;
    g.play('break', 1.0);
    g.say(`The wall is down! Store floor ${g.bld.rooms + 1} is now part of the shop.`);
    g.toast = 'Expanding the Business';
    g.toast_t = 3.5;
    for (const l of crew) {
      l.leaving = true;
      l.path = [lay.DOOR_IN.clone(), lay.DOOR_OUT.clone(), lay.GATES[0][1].clone(), lay.GATES[0][0].clone()];
    }
  }
  g.bld.crew = crew;
  if (g.bld.wall_hits === 0 && g.bld.dirty) {
    refresh(g);
  }
}

// ---------- đồ phòng thủ và vật dựng có hành vi ----------

export function tick_defences(g, dt) {
  const booms = [];
  const shots = [];
  const n = g.props.length;
  for (let k = 0; k < n; k++) {
    if (g.props[k].dead) {
      continue;
    }
    if (g.props[k].kind.k !== 'Placed' || g.props[k].free === true || g.props[k].id === g.held) continue; // chưa cố định / đang cầm: không chạy
    const item = g.props[k].kind.a;
    const pos = g.props[k].pos.clone(), yaw = g.props[k].yaw;
    switch (item) {
      case game.SPIKE_WALL:
        for (const z of g.zombies) {
          if (!(!z.dead && z.hp > 0.0)) continue;
          const local = rot_y(-yaw, z.pos.sub(pos));
          if (Math.abs(local.x) < 1.25 && Math.abs(local.z) < 0.6 && z.spike_cd <= 0.0) {
            const wall = g.props[k].hp;
            const dmg = wall * 3.0;
            z.hp -= dmg;
            z.stagger = 0.5;
            z.spike_cd = 0.6;
            g.props[k].hp -= Math.max(z.hp, 0.0);
            g.fxq.push([fx.FX_BLOOD, z.pos.add(Y.mul(0.9))]);
            g.sfx.push(['hit', 0.6]);
            if (g.props[k].hp <= 0.0) {
              g.props[k].dead = true;
              g.fxq.push([fx.FX_DEBRIS, pos.add(Y.mul(0.6))]);
              g.sfx.push(['break', 0.7]);
              break;
            }
          }
        }
        break;
      case game.BEAR_TRAP: {
        if (g.props[k].aux < 0.0) break; // chưa giương (fin-build: thả từ ba lô rồi Arm, gốc clip 08 13:15 / 24:00)
        let held = 0;
        for (const z of g.zombies) {
          if (!(!z.dead && z.hp > 0.0)) continue;
          if (z.pos.distance(pos) < 0.7) {
            if (!z.trapped) {
              z.trapped = true;
              z.hp -= 10.0;
              g.fxq.push([fx.FX_BLOOD, z.pos.add(Y.mul(0.3))]);
              g.sfx.push(['bang', 0.6]);
            }
            if (!zkind_boss(z.kind)) {
              z.root = 0.35;
              held += 1;
            }
          }
        }
        if (held > 0) {
          g.props[k].hp -= dt * held;
          if (g.props[k].hp <= 0.0) {
            g.props[k].dead = true;
          }
        }
        break;
      }
      case game.AUTO_MINIGUN:
        g.props[k].aux2 -= dt;
        if (g.props[k].aux >= 1.0 && g.props[k].aux2 <= 0.0) {
          let t = null, best = Infinity;
          for (const z of g.zombies) {
            if (!z.dead && z.hp > 0.0 && z.chasing && z.pos.distance(pos) < 12.0) {
              const d = z.pos.distance(pos);
              if (t === null || d < best) { best = d; t = z; }
            }
          }
          if (t !== null) {
            const z = t;
            z.hp -= 5.0;
            g.props[k].aux -= 1.0;
            g.props[k].aux2 = 0.08;
            shots.push([pos.add(Y.mul(1.0)), z.pos.add(Y.mul(1.1))]);
          } else {
            g.props[k].aux2 = 0.12;
          }
        }
        break;
      case game.EXPLOSIVE_BARREL: case game.REMOTE_BOMB: case game.REMOTE_INC:
        if (g.props[k].hp <= 0.0) {
          g.props[k].dead = true;
          booms.push([pos, item]);
        }
        break;
      default:
        break;
    }
  }
  if (shots.length !== 0) {
    g.cb.tracer_t -= dt;
    if (g.cb.tracer_t <= 0.0) {
      g.cb.tracer_t = 0.16;
      g.play('shot', 0.35);
    }
    for (const [a, b] of shots) {
      g.fxq.push([fx.FX_SPARK, b]);
      g.cb.tracers.push([a, b, 0.06]);
    }
  }
  for (const [pos, item] of booms) {
    combat.explode(g, pos.add(Y.mul(0.5)), 200.0, 5.0, item === game.REMOTE_INC);
  }
}

export function tick(g, dt) {
  init(g);
  tick_defences(g, dt);
  tick_crew(g, dt);
  tick_helper(g, dt);
  if (g.bld.paint_job !== null) {
    const [room, floor, paint, t0] = g.bld.paint_job;
    const need = 5.0 * build_speed(g);
    const t = t0 + dt;
    if (t >= need) {
      g.bld.paint_job = null;
      g.bld.paint[room * 2 + (floor ? 1 : 0)] = (paint + 1) & 255;
      g.bld.dirty = true;
      g.play('place', 0.6);
      g.say(`${floor ? 'Floor' : 'Walls'} painted: ${data.PAINTS[paint][0]}.`);
    } else {
      g.bld.paint_job = [room, floor, paint, t];
      g.prompt = `Painting... ${(t / need * 100.0).toFixed(0)}%`;
    }
  }
  if (g.bld.dirty) {
    refresh(g);
  }
}

export function build_speed(g) {
  const m = skills.mul(g, 'SecureBuildableSpeedMultiplier');
  return m > 0.0 ? m : 1.0;
}

/** Sáng ngày mới: Hulk hồi đầy máu và đứng dậy. */
export function new_day(g) {
  if (g.bld.helper.freed) {
    g.bld.helper.hp = helper_max(g);
    if (g.bld.helper.down) {
      g.bld.helper.down = false;
      g.bld.helper.pos = lay.HELPER_POINTS[5].clone();
    }
  }
  g.bld.crew.length = 0;
}

/** Cho bot. (Rust `export`; exported under that name below because `export` is a JS keyword.) */
function export_(g) {
  const b = g.bld;
  const placed = g.props.filter((p) => !p.dead).filter((p) => p.kind.k === 'Placed').map((p) => `[${p.id},"${items.iname(p.kind.a)}",${p.pos.x.toFixed(2)},${p.pos.z.toFixed(2)},${p.hp.toFixed(0)},${p.aux.toFixed(0)},${p.free === true ? 1 : 0},${p.id === g.held ? 1 : 0},${p.orient ? 1 : 0}]`);
  const crew = b.crew.filter((l) => !l.gone).map((l) => `[${l.pos.x.toFixed(1)},${l.pos.z.toFixed(1)}]`);
  return `{"wh":${b.wh_open},"med":${b.med_open},"rooms":${b.rooms},"hits":${b.wall_hits},"tiers":[${b.tiers.map((t) => String(t)).join(',')}],"gen":${b.gen_fixed},"paint":[${b.paint.map((t) => String(t)).join(',')}],"ghost":${b.ghost !== null ? `"${items.iname(b.ghost[0])}"` : 'null'},"ghostOk":${b.ghost_ok},"placed":[${placed.join(',')}],"crew":[${crew.join(',')}],"helper":[${b.helper.freed ? 1 : 0},${b.helper.pos.x.toFixed(1)},${b.helper.pos.z.toFixed(1)},${b.helper.hp.toFixed(0)},${b.helper.down ? 1 : 0}],"mounted":${b.mounted !== null},"shelves":${g.shelves.length},"mode":${b.mode === true},"edit":${JSON.stringify(b.edit || null)},"held":${held_placed(g) !== null ? `"${items.iname(held_placed(g).kind.a)}"` : 'null'},"holdD":${b.hold_d.toFixed(2)}}`;
}
export { export_ as export };

export function save(g) {
  const b = g.bld;
  const head = `${b.wh_open ? 1 : 0},${b.med_open ? 1 : 0},${b.rooms},${b.gen_fixed ? 1 : 0},${b.helper.freed ? 1 : 0},${b.wall_hits},${0},${0}|${b.tiers.map((t) => String(t)).join(',')}|${b.paint.map((t) => String(t)).join(',')}`;
  // Vật dựng: món, x, z, góc, máu, số phụ (x100 để giữ số nguyên); dây thép gai lưu như món BARBED.
  const placed = [];
  for (const p of g.props) {
    if (p.dead) continue;
    let rec;
    if (p.kind.k === 'Placed') rec = [p.kind.a, p.hp, p.aux, p];
    else if (p.kind.k === 'Wire') rec = [game.BARBED, p.kind.a, 0.0, p];
    else continue;
    const [it, hp, aux] = rec;
    const sh = g.shelves.find((s) => s.prop === p.id && s.prop !== 0);
    const slots = sh !== undefined ? sh.slots.map((x) => String(x !== null ? x : -1)).join('.') : '';
    const counts = sh !== undefined ? sh.counts.map((x) => String(x | 0)).join('.') : '';
    // fin-build đợt 2: trường 9 = độ cao (x100) cho đồ đặt trên mặt bàn / kệ; save cũ không có thì 0.
    // fin-build đợt 4: trường 10 = cờ (1 chưa cố định, 2 đứng dọc "Orient"); vật đang cầm lưu nằm dưới đất ở chỗ đứng
    const py = p.id === g.held ? 0.0 : p.pos.y;
    const fl = (p.free === true ? 1 : 0) | (p.orient ? 2 : 0);
    // trường 11 = cài đặt riêng của bảng Item Details (giá.bật.bán.Cleaner bỏ qua), chỉ khi vật đã từng tắt "Set for all"
    const ov = p.ovr ? `${trunc(p.ovr.price)}.${p.ovr.on ? 1 : 0}.${p.ovr.avail ? 1 : 0}.${p.ovr.noclean ? 1 : 0}` : '';
    placed.push(`${it},${trunc(p.pos.x * 100.0)},${trunc(p.pos.z * 100.0)},${trunc(p.yaw * 100.0)},${trunc(hp)},${trunc(aux)},${slots},${counts}${py > 0.005 || fl !== 0 || ov ? `,${trunc(py * 100.0)}` : ''}${fl !== 0 || ov ? `,${fl}` : ''}${ov ? `,${ov}` : ''}`);
  }
  // fin-build đợt 3: đang Grab lúc lưu thì vật được lưu ở chỗ cũ (máu, đạn, hàng trên kệ như lúc nhấc)
  const gb = b.ghost !== null ? b.grab : null;
  if (gb !== null && gb.item === b.ghost[0]) {
    const sh = gb.shelf;
    const slots = sh ? sh.slots.map((x) => String(x !== null ? x : -1)).join('.') : '';
    const counts = sh ? sh.counts.map((x) => String(x | 0)).join('.') : '';
    placed.push(`${gb.item},${trunc(gb.pos.x * 100.0)},${trunc(gb.pos.z * 100.0)},${trunc(gb.yaw * 100.0)},${trunc(gb.hp)},${trunc(gb.aux)},${slots},${counts}${gb.pos.y > 0.005 ? `,${trunc(gb.pos.y * 100.0)}` : ''}`);
  }
  return `${head}|${placed.join('/')}`;
}

/** Rust `str::parse::<i32>()`: Ok(n) -> n, Err -> null. */
function parse_i32(s) {
  if (!/^[+-]?[0-9]+$/.test(s)) return null;
  const n = Number(s);
  if (n > 2147483647 || n < -2147483648) return null;
  return n;
}

export function load(g, s) {
  const parts = s.split('|');
  const nums = (s) => s.split(',').map(parse_i32).filter((v) => v !== null);
  const h = nums(parts.length > 0 ? parts[0] : '');
  if (h.length >= 6) {
    g.bld.wh_open = h[0] !== 0;
    g.bld.med_open = h[1] !== 0;
    g.bld.rooms = Math.max(0, Math.min(2, h[2]));
    g.bld.gen_fixed = h[3] !== 0;
    g.bld.helper.freed = h[4] !== 0;
    g.bld.wall_hits = h[5];
  }
  nums(parts.length > 1 ? parts[1] : '').slice(0, 6).forEach((v, k) => { g.bld.tiers[k] = v & 255; });
  nums(parts.length > 2 ? parts[2] : '').slice(0, 6).forEach((v, k) => { g.bld.paint[k] = v & 255; });
  for (const rec of (parts.length > 3 ? parts[3] : '').split('/').filter((r) => r.length !== 0)) {
    const f = rec.split(',');
    if (f.length < 6) {
      continue;
    }
    const n = f.slice(0, 6).map(parse_i32).filter((v) => v !== null);
    if (n.length < 6 || n[0] < 0 || n[0] >= catalog.N_CAT) {
      continue;
    }
    const yy = f.length >= 9 ? parse_i32(f[8]) : null;
    const fl = f.length >= 10 ? parse_i32(f[9]) || 0 : 0;
    const item = n[0], pos = v3(n[1] / 100.0, yy !== null ? yy / 100.0 : 0.0, n[2] / 100.0), yaw = n[3] / 100.0;
    if (item === game.BARBED) {
      g.add_prop({ k: 'Wire', a: n[4] }, pos, yaw);
      continue;
    }
    const id = g.add_prop(item === game.BEAR_TRAP && n[5] < 0 ? { k: 'Placed', a: item, b: 'closed' } : { k: 'Placed', a: item }, pos, yaw);
    const p = g.prop(id);
    if (p !== null) {
      p.hp = n[4];
      p.aux = n[5];
      p.free = (fl & 1) !== 0;
      p.orient = (fl & 2) !== 0 ? 1 : 0;
      const ov = f.length >= 11 ? f[10].split('.').map(parse_i32) : [];
      if (ov.length === 4 && ov.every((x) => x !== null)) p.ovr = { price: Math.max(ov[0], 1), on: ov[1] !== 0, avail: ov[2] !== 0, noclean: ov[3] !== 0 };
      if (item === game.TV) p.kind.b = n[5] > 0; // TelevisionObject lưu _turnedOn
    }
    const sd = shelf_dims(item);
    if (sd !== null && (fl & 1) === 0) {
      const [cols, levels] = sd;
      const sh = new game.Shelf(pos.clone(), yaw, cols, levels, id);
      (f.length > 6 ? f[6] : '').split('.').forEach((vs, k) => {
        const v = parse_i32(vs);
        if (v !== null && k < sh.slots.length) {
          sh.slots[k] = v >= 0 && v < catalog.N_CAT ? v : null;
          sh.counts[k] = sh.slots[k] === null ? 0 : 1;
        }
      });
      // Bản lưu cũ không có trường số món lẻ: mỗi ô 1 món.
      (f.length > 7 ? f[7] : '').split('.').forEach((vs, k) => {
        const v = parse_i32(vs);
        if (v !== null && k < sh.slots.length && sh.slots[k] !== null) sh.counts[k] = Math.max(1, v);
      });
      g.shelves.push(sh);
    }
  }
  g.bld.helper.hp = helper_max(g);
  g.bld.helper.pos = g.bld.helper.freed ? lay.HELPER_POINTS[5].clone() : lay.HULK.clone();
  g.bld.inited = true;
  g.bld.dirty = true;
  refresh(g);
}

/* VIEW NOTES (build.rs)
 * build.rs itself builds NO meshes and runs no sync system: the stations, placed props, shelves, crew and Stompy are
 * drawn by world.rs / props / people code reading this state. What the view needs from here:
 * - g.bld.dirty: shop shell (walls/floors per room, opened warehouse / medical doors, demolished wall to SF2/SF3)
 *   must be rebuilt; refresh() runs every tick while dirty (the clearing of dirty happens in the world sync, not here).
 * - g.bld.rooms (0..2): 0 = wall box [5.0,-5.25,5.25,3.2] (x0,z0,x1,z1) still standing between shop and SF2;
 *   <2 = lay.WALL_SF3 standing. g.bld.wh_open / med_open: lay.WH_DOOR_BOX / lay.MED_DOOR_BOX doors closed while false.
 * - g.bld.paint[room*2 + (floor?1:0)] = paint index + 1 (0 = original). paint_col(g, room, floor) -> [[r,g,b], pattern]
 *   gives the colour and shader pattern code (geom STRIPES/CARDBOARD/CONCRETE/WOOD/CORRUGATED/PLASTER).
 * - g.bld.tiers[T_*]: station levels (bench 0..2, shredder 0 broken / 1 repaired, generator 0 empty / 1 fuelled,
 *   intel 0..3 notes board / radio / long-range radio / surveillance hub, bed 0..2, siren 0/1); gen_fixed = generator
 *   running. Station aim boxes come from targets(g) as [id, lo, hi] in metres.
 * - Build mode ghost: g.bld.ghost = [item, yaw] | null at g.bld.ghost_pos, tinted by g.bld.ghost_ok (valid / invalid);
 *   ghost_ent / ghost_shown are owned by the view (node and the item it currently shows). footprint(item) gives
 *   [half x, half z, solid, height class 0 floor / 1 wall-mounted / 2 ceiling-hung] for the ghost and placed props.
 * - Placed props are g.props with kind {k:'Placed', a:item}; hp = defence health, aux = turret/minigun ammo,
 *   aux2 = minigun fire cooldown. Barbed wire is {k:'Wire', a:hp}. Removed shelves push their node to g.cb.orphans.
 * - Minigun shots push g.cb.tracers [from, to, 0.06 s] (from = prop pos + 1.0 m up, to = zombie + 1.1 m up) and
 *   FX_SPARK at the hit; crew hits push FX_DEBRIS at spot + (0.6, 1.3, 0).
 * - Bodies of the crew and Stompy are spawned/posed in world.rs (not here): crew Labourer.body = people spawn with
 *   l.seed, living human, posed from (pos, yaw, moving, phase (+= 8/s while walking), swing (0.45 s hammer swing
 *   countdown), lean 0, holding hammer); despawned when l.gone. While working they face yaw = -PI/2.
 * - Stompy g.bld.helper (Helper): Hulk body (seed 0x57a9, kind 'Hulk') at lay.HULK; yaw = PI/2 while chained (not
 *   freed), else h.yaw; moving, phase (+= dt*speed*2.2), swing (0.45 s claw swipe countdown), lean -1.45 when down
 *   (knocked out, lying). hp out of helper_max(g).
 * PORT GAPS:
 * - actors::walk(&mut pos, &mut yaw, &mut path, sp, dt) is called as actors.walk(l, sp, dt) (owner object holding
 *   pos/yaw/path); the actors port must accept that shape.
 * - ZKind::boss() inlined as zkind_boss() (same five kinds as combat.rs) instead of calling the impl method.
 * - world.COLLIDERS assumed to be an array (Rust LazyLock<Vec<Box2>>).
 * - `{:.0}` / `{:.1}` / `{:.2}` use toFixed (half-up on the decimal value; Rust formats from the exact binary value,
 *   which can differ on exact .5 ties).
 * RUST ODDITIES (ported as is): paints_for() would panic in Rust if a PAINTS partition were empty (slice [..1]);
 * valid()'s placed-prop test `(solid || fh == h) && h == fh` reduces to `h == fh` (solid is irrelevant).
 */
