// Port of src/game.rs.
//! Trạng thái và luật chơi (không đụng tới render). Số liệu lấy từ luật bản gốc:
//! ngày 800 giây, nhịp khách theo uy tín và giờ, ví theo bậc, công thức chấm giá, raid ngày 3 lúc 09:30.

import { Vec3, v3, rot_y, q_y, Y, NEG_Z, Rng, trunc, clamp } from './vec.js';
import { N_CAT } from './catalog.js';
import { NODES } from './data.js';
import { query } from './web.js';
import * as lay from './lay.js';
import * as items from './items.js';
import * as skills from './skills.js';
import * as map from './map.js';
import * as fp from './fp.js';
import * as carry from './carry.js';
import * as build from './build.js';
import * as combat from './combat.js';
import * as events from './events.js';
import * as cine from './cine.js';
import * as actors from './actors.js';
import * as quests from './quests.js';

export { SHELF_Z0, SHELVES, SLOT_W } from './lay.js';
export { give, give_n, iname, ival, Wpn } from './items.js';
export { N_CAT as N_ITEMS } from './catalog.js';
const N_ITEMS = N_CAT;

export const DAY_SECS = 800.0;
/// Phút game trên một giây thật ở tốc độ 1.
export const MIN_PER_SEC = 1440.0 / DAY_SECS;


// Chỉ số trong danh mục (catalog.rs) của các món được gọi tên trong code.
export const TIN = 210;
export const BEANS = 204;
export const FRUIT = 205;
export const BEER = 23;
export const TUNA = 206;
export const TAPE = 201;
export const PIPE = 55;
export const CLOTH = 225;
export const NAILS = 140;
export const WIRING = 221;
export const BANDAGE = 14;
export const PILLS = 144;
export const FIRSTAID = 79;
export const BAT = 20;
export const HAMMER = 95;
export const CROWBAR = 59;
export const SAWBLADE = 174;
export const MEAT = 85;
export const BONE = 36;
export const WHISKY = 218;
export const WINE = 220;
export const POTATO = 149;
export const BREAD = 129;
export const ANTIBIOTICS = 107;
export const CARDBOARD_BOX = 50;
export const LOW_PAINT = 115;
export const MID_PAINT = 123;
export const HIGH_PAINT = 105;
export const LOW_FLOOR = 114;
export const MID_FLOOR = 122;
export const HIGH_FLOOR = 104;
export const SLEEPING_BAG = 184;
export const PLANK = 147;
export const ROPE = 170;
export const GAS_CAN = 83;
export const SPEAR = 223;
export const BARBED = 18;
export const SPIKE_WALL = 191;
export const BEAR_TRAP = 22;
export const TURRET = 130;
export const AUTO_MINIGUN = 9;
export const EXPLOSIVE_BARREL = 73;
export const REMOTE_BOMB = 164;
export const REMOTE_INC = 167;
export const BALLOON = 49;
export const GRENADE = 92;
export const MOLOTOV = 128;
export const NAIL_BOMB = 136;
export const TV = 224;
export const SHELF_FLIMSY = 81;
export const RECIPE_FLIMSY = 82;
export const BOX_PILE_MAX = 6;
export const SHELF_DUAL = 67;
export const SHELF_SECURE = 175;
export const TABLE_SECURE = 176;
export const UNIT_SPECIAL = 188;
export const RACK = 219;
export const FRIDGE = 162;
export const PISTOL = 146;
export const AMMO_9MM = 5;
export const AMMO_556 = 2;
export const KNIFE = 110;
export const METAL_SCRAP = 121;
export const GUNPOWDER = 94;
export const DETONATOR = 166;
export const STUN_STICK = 198;
export const CHAINSAW = 52;
export const PIPE_WRENCH = 145;
export const STORAGE_CRATE = 195;
export const MED_CRATE = 118;
export const NAIL_GUN = 137;
export const HARD_LOG = 99;
export const HARD_PLANK = 101;
export const LOW_RADIO = 113;
export const HEAVY_RADIO = 103;
export const MODEM = 126;
export const SPECIAL_PC = 189;
export const RELAY = 163;
export const SPEAKER = 214;
export const MATTRESS = 69;
export const CARNIVAL = 51;
export const AK47 = 6;
export const SHOTGUN = 178;
export const UZI = 211;

/// Hai kệ `FlimsyWoodenShelf`, mỗi kệ 21 ô (3 tầng × 7 cột), mỗi ô một món.
export const SHELF_SLOTS = 21;
export const SHELF_COLS = 7;

/// [ĐỀ XUẤT] Rời luật gốc theo yêu cầu chủ dự án (2026-11-15: "1 kệ nên có thể chất nhiều hàng"). Bản gốc: một món trong
/// ba lô / hộp = một món lẻ trên một ô kệ. Bản này: một món trong ba lô / hộp là một THÙNG, xếp lên kệ thành
/// `case_units()` món lẻ cùng loại; một ô kệ chồng tối đa `stack_max()` món lẻ (hai thùng). Khách lấy từng món lẻ, giá vẫn
/// tính theo món lẻ, luật mua bán không đổi. `?stack=1` về đúng luật gốc; `?stack=N` = N món lẻ một thùng.
/// Đợt 13 (chủ dự án: "1 khách mua ít thôi"): khách chỉ mua 1-3 món lẻ nên một thùng hạ từ 4 xuống 2 món lẻ (không thì 14
/// hộp thiếc ngày 1 = 56 món lẻ, đủ bán 4-5 ngày, lục đồ thành vô nghĩa); một ô vẫn chồng tối đa 8 món lẻ (4 thùng).
export const CASE_UNITS = 2;
export const STACK_CASES = 4;
let STACK_Q = undefined;
export function case_units() {
  if (STACK_Q === undefined) {
    const v = parseInt(query('stack') || '', 10);
    STACK_Q = Number.isFinite(v) && v >= 1 && v <= 12 ? v : CASE_UNITS;
  }
  return STACK_Q;
}
export function stack_max() {
  return case_units() === 1 ? 1 : case_units() * STACK_CASES;
}
/// Lục xác zombie / chỗ lục: luật gốc (clip 04 GameEdged Day 1 28:00-28:15: đang "Searching..." từng món văng ra khỏi xác
/// rơi xuống đất; clip 03 JMXP 3:20-3:35 chỗ lục "Tinned Beans x2, Beer" cũng văng ra; pin cộng thẳng vào số pin trên HUD,
/// clip 02 Zanzibar 21:20-22:00 44 -> 62). Món nằm trên đất nhặt từng món: cầm hộp các-tông thì vào hộp ("Carry", clip 04
/// 28:37-28:47, thanh 0/80 -> 30/80 -> 45/80), không cầm hộp thì vào ba lô như món rời có sẵn. `?loot=bag` = bản cũ (mọi
/// món vào thẳng ba lô).
/// `?shelves=2`: hai kệ ba tầng của bản trước phiên 7 (mặc định: một kệ ván bắt tường).
export function two_shelves() {
  return query('shelves') === '2';
}
export function loot_bag() {
  return query('loot') === 'bag';
}
/// `?stack=1` = luật gốc của mọi phần đã rời gốc (kệ chồng, giỏ khách, chỗ lục thêm, đầy lại chỗ lục).
export function orig_rules() {
  return case_units() === 1;
}

/// [ĐỀ XUẤT] Đợt 13, rời luật gốc có chủ ý (chủ dự án 2026-11-15: "1 khách mua ít thôi và có thể loot được nhiều vị trí
/// hơn"). Bản gốc: khách nhặt tới khi giỏ đủ 70% sức chứa 6 (= 5 món) hoặc hết hứng. Bản này: lúc sinh ra mỗi khách rút
/// một cỡ giỏ `want` theo `BASKET_W` (1 món 45%, 2 món 40%, 3 món 15%; trung bình 1,7), nhặt đủ thì ra quầy. Nhịp khách
/// tới không đổi (luật gốc: 6-7 khách trong 13:00-19:00 ngày 1). `?basket=N` ép mọi khách N món; `?stack=1` về gốc.
export const BASKET_W = [0.45, 0.40, 0.15];
export const BASKET_ORIG = 0.7 * 6.0;
export function basket_want(rng) {
  if (orig_rules()) return BASKET_ORIG;
  const q = parseInt(query('basket') || '', 10);
  if (Number.isFinite(q) && q >= 1 && q <= 6) return q;
  let x = rng.next();
  for (let i = 0; i < BASKET_W.length; i++) { x -= BASKET_W[i]; if (x < 0) return i + 1; }
  return BASKET_W.length;
}

/// Một kệ bày hàng: hai kệ cố định của ván mới, cộng các kệ người chơi dựng thêm (src/build.rs).
/// Khung riêng của kệ: gốc ở giữa chân kệ, trục x dọc thân kệ, +z là mặt trước (chỗ khách đứng).
export class Shelf {
  /** Shelf::new(pos, yaw, cols, levels, prop) */
  constructor(pos, yaw, cols, levels, prop) {
    this.pos = pos.clone();
    this.yaw = yaw;
    this.cols = cols;
    this.slots = new Array(cols * levels).fill(null);
    /// Số món lẻ trên từng ô (0 khi ô trống). Xem `case_units()`.
    this.counts = new Array(cols * levels).fill(0);
    this.dirty = true;
    this.ent = null;
    /// id của vật dựng (Prop) sinh ra kệ này; 0 = kệ cố định.
    this.prop = prop;
    /// Kệ ván bắt tường: tầng = hàng từ trước ra sau trên một tấm ván (lay.PLANK_*).
    this.plank = false;
    /// [par-panels] C40 bảng Configure: Storage Mode Dedicated = kho (khách không lấy hàng ở kệ này);
    /// `allow` = loại món nhận (null = mọi món). Bản gốc chỉ nhân viên dọn xếp theo `allow`; nhân viên dọn ở đây không xếp hàng.
    this.dedicated = false;
    this.allow = null;
  }
  static new(pos, yaw, cols, levels, prop) {
    return new Shelf(pos, yaw, cols, levels, prop);
  }
  /** Quat::from_rotation_y(yaw) as [x,y,z,w] */
  rot() {
    return q_y(this.yaw);
  }
  slot_pos(slot) {
    const col = slot % this.cols;
    const lvl = Math.trunc(slot / this.cols);
    if (this.plank) return this.pos.add(rot_y(this.yaw, v3((col + 0.5 - this.cols * 0.5) * lay.SLOT_W, lay.PLANK_TOP + 0.05, lay.PLANK_ROWS[Math.min(lvl, 2)])));
    return this.pos.add(rot_y(this.yaw, v3((col + 0.5 - this.cols * 0.5) * lay.SLOT_W, 0.5 + lvl * 0.5, 0.0)));
  }
  /// Chỗ khách (hoặc bot) đứng trước ô `slot`.
  stand(slot) {
    const p = this.slot_pos(slot).add(rot_y(this.yaw, v3(0.0, 0.0, 0.85)));
    return v3(p.x, 0.0, p.z);
  }
  /// Hướng nhìn từ chỗ đứng vào kệ.
  face() {
    return rot_y(this.yaw, NEG_Z);
  }
  /// Số món lẻ trên ô `s`.
  units(s) {
    return this.slots[s] === null || this.slots[s] === undefined ? 0 : Math.max(1, this.counts[s] | 0);
  }
  /// Tổng món lẻ trên kệ.
  total() {
    let n = 0;
    for (let s = 0; s < this.slots.length; s++) n += this.units(s);
    return n;
  }
  /// Ô `s` nhận thêm `n` món lẻ loại `it` được không.
  room(s, it, n) {
    const cur = this.slots[s];
    if (cur === null || cur === undefined) return n <= stack_max();
    return cur === it && this.units(s) + n <= stack_max();
  }
  /// Chọn ô để đặt `n` món lẻ loại `it`, ưu tiên ô `near`, rồi chồng cùng loại còn chỗ gần nhất, rồi ô trống gần nhất.
  place_slot(it, near, n) {
    if (near !== null && near < this.slots.length && this.room(near, it, n)) return near;
    const c = this.cols;
    let best = null;
    for (let s = 0; s < this.slots.length; s++) {
      if (this.slots[s] === it && this.room(s, it, n)) {
        const d = Math.abs((s % c) - ((near || 0) % c)) * 2 + Math.abs(Math.trunc(s / c) - Math.trunc((near || 0) / c));
        if (best === null || d < best[0]) best = [d, s];
      }
    }
    if (best !== null) return best[1];
    return this.free(near || 0);
  }
  /// Thêm `n` món lẻ loại `it` vào ô `s` (gọi sau `room`).
  put(s, it, n) {
    if (this.slots[s] === null || this.slots[s] === undefined) {
      this.slots[s] = it;
      this.counts[s] = n;
    } else {
      this.counts[s] = this.units(s) + n;
    }
    this.dirty = true;
  }
  /// Lấy một món lẻ khỏi ô `s`; trả loại món hoặc null.
  take(s) {
    const it = this.slots[s];
    if (it === null || it === undefined) return null;
    const left = this.units(s) - 1;
    if (left <= 0) {
      this.slots[s] = null;
      this.counts[s] = 0;
    } else {
      this.counts[s] = left;
    }
    this.dirty = true;
    return it;
  }
  /// Dọn sạch ô `s`; trả [loại, số món lẻ] hoặc null.
  clear(s) {
    const it = this.slots[s];
    if (it === null || it === undefined) return null;
    const n = this.units(s);
    this.slots[s] = null;
    this.counts[s] = 0;
    this.dirty = true;
    return [it, n];
  }
  free(near) {
    const c = this.cols;
    let best = null;
    for (let s = 0; s < this.slots.length; s++) {
      if (this.slots[s] === null) {
        const d = Math.abs((s % c) - (near % c)) * 2 + Math.abs(Math.trunc(s / c) - Math.trunc(near / c));
        if (best === null || d < best[0]) {
          best = [d, s];
        }
      }
    }
    return best === null ? null : best[1];
  }
}

export const Mode = Object.freeze({ Title: 'Title', Play: 'Play', Summary: 'Summary', Dead: 'Dead' });
export const MODE_ORDER = ['Title', 'Play', 'Summary', 'Dead'];

/// Panel (enum có dữ liệu): {k:'None'}, {k:'Price', a:i}, {k:'Radio'}, ... Mỗi lần gọi trả một object mới.
/// Bag = ba lô: danh sách món, dùng / trang bị / dựng / học công thức.
/// Trade = bảng mua bán và dịch vụ (thương nhân, cửa hàng trên bản đồ, hợp đồng bến cảng, vòng quay, quảng cáo, nâng cấp); loại ở `Game.trade`.
export const Panel = Object.freeze({
  None: () => ({ k: 'None' }),
  Price: (i) => ({ k: 'Price', a: i }),
  Radio: () => ({ k: 'Radio' }),
  Help: () => ({ k: 'Help' }),
  Settings: () => ({ k: 'Settings' }),
  Pay: () => ({ k: 'Pay' }),
  Jobs: () => ({ k: 'Jobs' }),
  Map: () => ({ k: 'Map' }),
  Craft: () => ({ k: 'Craft' }),
  Bag: () => ({ k: 'Bag' }),
  Skills: () => ({ k: 'Skills' }),
  Trade: () => ({ k: 'Trade' }),
  Saves: () => ({ k: 'Saves' }),
});
export const PANEL_ORDER = ['None', 'Price', 'Radio', 'Help', 'Settings', 'Pay', 'Jobs', 'Map', 'Craft', 'Bag', 'Skills', 'Trade', 'Saves'];

export const Q_ORDER = ['EnterShop', 'Trash', 'Sweep', 'Hammer', 'JammedDoor', 'PickBox', 'FillBox', 'Shelve', 'SetPrice', 'OpenStore', 'ServeFirst', 'CloseStore', 'Sleep', 'KillZombie', 'LootZombie', 'RepairDoor', 'OpenPackage', 'Caches', 'DefeatRaid',
  // [par-panels] nhiệm vụ phụ của To Do List gốc (cat:quests, PARITY Q): thêm ở cuối nên bản lưu cũ vẫn đọc đúng
  'AssignJob', 'UnlockSkill', 'OpenWarehouse', 'LearnRecipe', 'CraftItem', 'UpgradeBench', 'CityGates', 'SendShop', 'Demolition', 'ListenRadio', 'FixShredder', 'ShredBodies', 'FixBridge', 'DefeatHorde', 'DefeatBrute', 'DefeatBirther', 'DefeatTwins', 'DefeatSweaty', 'UpgradeRadio', 'UpgradeBedroom',
  // [par-panels đợt 2] thêm ở cuối, như trên
  'FuelGenerator', 'StartGenerator', 'OpenHospital', 'FreeHulk', 'LearnBandages', 'LearnMediumCrates', 'PlayWheel',
  // [FTUE A2] việc gốc còn thiếu: FindCraftingRecipeQuest, CraftItemsQuest (x10), LevelUpStaffQuest (thêm ở cuối như trên)
  'FindRecipe', 'CraftItems', 'LevelUpStaff'];
export const Q = Object.freeze(Object.fromEntries(Q_ORDER.map((n) => [n, n])));
/** `q as usize` */
export function q_index(q) {
  return Q_ORDER.indexOf(q);
}

export const Q_COUNT = 49;

/// Cờ tính năng: hệ mới nằm sau cờ cho tới khi bot của nó qua; bật thử bằng `?ff=tên1,tên2` (hoặc `all`).
export const FF_ACTS = 1;
/// Thanh toán bằng pin thật ở quầy: soi từng cục, bỏ vào ngăn kéo hoặc thùng rác, pin giả, nút báo động.
export const FF_PAY = 2;
/// Khách bị thương xin thuốc (Medical) và sổ nợ.
export const FF_MEDIC = 4;
/// Nhân viên và Job Board (src/staff.rs).
export const FF_STAFF = 8;
/// World Map: 29 landmark, mở khoá, Scavenge / Combat của nhân viên (src/map.rs).
export const FF_MAP = 16;
/// Chế tạo và máy nghiền (src/craft.rs).
export const FF_CRAFT = 32;
/// Chín hệ của khối B, mỗi hệ một cờ: xây / sơn / mở rộng, phòng thủ, vũ khí đủ bộ, boss + Hellraid, Docks + News Crew,
/// thương nhân + Dr. Gib + TV, cây kỹ năng, kéo / vứt / nghiền xác, nhiều ô lưu.
export const FF_BUILD = 64;
export const FF_DEFENCE = 128;
export const FF_WEAPONS = 256;
export const FF_BOSSES = 512;
export const FF_DOCKS = 1024;
export const FF_EVENTS = 2048;
export const FF_SKILLS = 4096;
export const FF_CORPSES = 8192;
export const FF_SAVES = 16384;
/// Các cờ bật sẵn cho mọi người chơi.
/// Mặc định bật cả 15 hệ (mỗi hệ đã có bot riêng qua: xem FEATURES.md); `?ff=none` tắt hết, `?ff=none,tên` chỉ bật hệ `tên`.
export const FF_DEFAULT = FF_ACTS | FF_PAY | FF_MEDIC | FF_STAFF | FF_MAP | FF_CRAFT | FF_BUILD | FF_DEFENCE | FF_WEAPONS | FF_BOSSES | FF_DOCKS | FF_EVENTS | FF_SKILLS | FF_CORPSES | FF_SAVES;
export const FF_NAMES = [
  ['acts', FF_ACTS],
  ['pay', FF_PAY],
  ['medic', FF_MEDIC],
  ['staff', FF_STAFF],
  ['map', FF_MAP],
  ['craft', FF_CRAFT],
  ['build', FF_BUILD],
  ['defence', FF_DEFENCE],
  ['weapons', FF_WEAPONS],
  ['bosses', FF_BOSSES],
  ['docks', FF_DOCKS],
  ['events', FF_EVENTS],
  ['skills', FF_SKILLS],
  ['corpses', FF_CORPSES],
  ['saves', FF_SAVES],
];

/// Tên nhiệm vụ như trong To Do List của bản gốc.
export function q_title(q) {
  switch (q) {
    case 'EnterShop': case 'Trash': case 'Sweep': return 'Clearing Away the Past';
    case 'Hammer': case 'JammedDoor': return 'Breaking and Entering';
    case 'PickBox': case 'FillBox': case 'Shelve': case 'SetPrice': return 'Stocking Up';
    case 'OpenStore': case 'ServeFirst': return 'Open For Business';
    case 'CloseStore': case 'Sleep': return 'Live to Fight Another Day';
    case 'KillZombie': return 'Rude Customer';
    case 'LootZombie': return 'Waste Not Want Not';
    case 'RepairDoor': return 'Patch It Up';
    case 'OpenPackage': return 'Special Delivery';
    case 'Caches': return 'Finders Keepers';
    case 'DefeatRaid': return 'And Stay Out!';
    default: if (quests.QDEF[q]) return quests.QDEF[q][0];
  }
  throw new Error('unknown quest ' + q);
}
// [FTUE A2] nhiệm vụ phụ (par-panels SIDE_Q) chuyển sang sim/quests.js: chữ, nhóm, priority và cách hiện theo bản gốc.
const CHAIN = ['EnterShop', 'Trash', 'Sweep', 'Hammer', 'JammedDoor', 'PickBox', 'FillBox', 'Shelve', 'OpenStore', 'ServeFirst'];

/// PropKind (enum có dữ liệu). Mỗi lần gọi trả object mới; các Vec được chép.
/// Placed = vật dựng đã cố định (kệ, đồ trang trí, phòng thủ...): chỉ số món trong danh mục. Máu ở `Prop.hp`.
export const PropKind = Object.freeze({
  Trash: (n) => ({ k: 'Trash', a: n }),
  Pile: () => ({ k: 'Pile' }),
  Item: (i) => ({ k: 'Item', a: i }),
  Box: (v) => ({ k: 'Box', a: v.slice() }),
  BoxPile: () => ({ k: 'BoxPile' }),
  Notes: () => ({ k: 'Notes' }),
  Hammer: () => ({ k: 'Hammer' }),
  Crate: (v) => ({ k: 'Crate', a: v.slice() }),
  Reward: (v) => ({ k: 'Reward', a: v.slice() }),
  Wire: (f) => ({ k: 'Wire', a: f }),
  Corpse: (kind, looted) => ({ k: 'Corpse', a: kind, b: looted }),
  Cache: (name, v, searched) => ({ k: 'Cache', a: name, b: v.slice(), c: searched }),
  Placed: (i) => ({ k: 'Placed', a: i }),
});
/** PropKind.clone() */
export function prop_kind_clone(k) {
  const o = { ...k };
  if (Array.isArray(o.a)) o.a = o.a.slice();
  if (Array.isArray(o.b)) o.b = o.b.slice();
  return o;
}

export class Prop {
  constructor(f = {}) {
    this.id = 0;
    this.kind = { k: 'Pile' };
    this.pos = v3();
    this.yaw = 0.0;
    this.ent = null;
    this.dirty = false;
    this.dead = false;
    /// Máu của vật dựng phòng thủ và hai số phụ theo loại (đạn tháp súng, hẹn giờ bẫy...).
    this.hp = 0.0;
    this.aux = 0.0;
    this.aux2 = 0.0;
    Object.assign(this, f);
  }
}

export const CState = Object.freeze({ Walk: 'Walk', Look: 'Look', Queue: 'Queue', Leave: 'Leave', Follow: 'Follow' });
/// Follow = khách bị thương đi theo người chơi chờ được cho thuốc.
export const CSTATE_ORDER = ['Walk', 'Look', 'Queue', 'Leave', 'Follow'];

/// Goal: {k:'Buy'} | {k:'Sell', a: món, b: số lượng, c: giá đòi} | {k:'Medical'} (bị thương, xin thuốc; không mua bán.
/// Được cho thuốc thì hôm sau gửi quà).
export const Goal = Object.freeze({
  Buy: () => ({ k: 'Buy' }),
  Sell: (i, n, p) => ({ k: 'Sell', a: i, b: n, c: p }),
  Medical: () => ({ k: 'Medical' }),
});

/// Body: các Entity của hình người. Ở bản three.js thân người do `scene.people.spawn` giữ; các trường để null.
export class Body {
  constructor(f = {}) {
    this.root = null;
    this.parts = [null, null, null, null, null, null];
    this.extra = null;
    Object.assign(this, f);
  }
}

export class Customer {
  /** Mọi trường như Rust; `f` ghi đè giá trị mặc định (ví dụ `new game.Customer({ seed, pos, ... })`). */
  constructor(f = {}) {
    this.body = null;
    this.seed = 0;
    this.pos = v3();
    this.yaw = 0.0;
    this.state = 'Walk';
    this.goal = { k: 'Buy' };
    this.timer = 0.0;
    this.wallet = 0;
    this.desire = new Array(14).fill(-1.0); // độ thèm theo 14 loại món (actors.ITEM_TYPES)
    this.desire_mul = 0.0;
    this.basket = [];
    this.slot = null;
    this.path = [];
    this.wait = 0.0;
    this.at_head = 0.0;
    this.topped = false;
    this.phase = 0.0;
    this.moving = false;
    /// Số thứ tự điểm sinh trong `lay::CUSTOMER_SPAWNS` (đi về lại đó khi rời quán).
    this.spawn = 0;
    this.to_queue = false;
    this.gone = false;
    this.desperate = false;
    /// Còn bao lâu nữa hết động tác đưa pin trả tiền ở quầy.
    this.pay_t = 0.0;
    /// Món được quảng cáo đã kéo khách này tới (Mobile News Crew).
    this.advert = null;
    this.hp = 0.0;
    /// Số xác khách này đã thấy (mỗi xác trừ uy tín một lần).
    this.seen = 0;
    Object.assign(this, f);
  }
  leave() {
    this.state = 'Leave';
    this.to_queue = false;
    const path = [];
    if (Game.in_shop(this.pos)) {
      path.push(lay.DOOR_IN.clone());
      path.push(lay.DOOR_OUT.clone());
    }
    const back = customer_route(this.spawn);
    back.pop();
    back.pop();
    back.reverse();
    path.push(...back);
    this.path = path;
  }
}

/// Đường đầy đủ của khách từ điểm sinh `i`: điểm sinh, các điểm mốc, cổng ngoài, cổng trong, ngoài cửa, trong cửa.
export function customer_route(i) {
  const p = [lay.CUSTOMER_SPAWNS[i].clone()];
  for (const q of lay.CUSTOMER_ROUTES[i]) p.push(q.clone());
  const [out, inn] = lay.GATES[lay.CUSTOMER_GATE[i]];
  p.push(out.clone(), inn.clone(), lay.DOOR_OUT.clone(), lay.DOOR_IN.clone());
  return p;
}

export const ZKIND_ORDER = ['Base', 'Tumour', 'Hulk', 'Brute', 'Birther', 'Baby', 'Sweaty', 'TwinBuff', 'TwinHeal'];
/// (HP, sát thương, hồi chiêu, tốc độ đuổi)
export function zkind_stats(k) {
  switch (k) {
    case 'Base': case 'Tumour': return [100.0, 25.0, 2.0, 4.0];
    case 'Hulk': return [750.0, 150.0, 5.0, 4.0];
    case 'Brute': return [4000.0, 200.0, 1.0, 4.0];
    case 'Birther': return [2500.0, 150.0, 5.0, 3.0];
    case 'Baby': return [20.0, 25.0, 2.0, 3.0];
    case 'Sweaty': return [10000.0, 300.0, 8.5, 6.0];
    case 'TwinBuff': case 'TwinHeal': return [2000.0, 25.0, 2.0, 4.0];
  }
  throw new Error('unknown zombie kind ' + k);
}
/// Boss: Brute (đập đất / ném xe), Birther (đẻ con), Sweaty Rotter (nhảy), hai chị em Twins (buff / hồi máu).
/// `ZKind::Hulk` -> 'Hulk'; `kind.stats()` -> `ZKind.stats(kind)` (hoặc `zkind_stats(kind)`).
export const ZKind = Object.freeze({ ...Object.fromEntries(ZKIND_ORDER.map((n) => [n, n])), stats: zkind_stats });

export class Zombie {
  /** Mọi trường như Rust; `f` ghi đè giá trị mặc định. */
  constructor(f = {}) {
    this.body = null;
    this.seed = 0;
    this.kind = 'Base';
    this.pos = v3();
    this.yaw = 0.0;
    this.hp = 0.0;
    this.cd = 0.0;
    this.wind = 0.0;
    this.raid = false;
    this.chasing = false;
    this.wander_to = v3();
    this.pause = 0.0;
    this.detour = v3();
    this.detour_t = 0.0;
    this.stagger = 0.0;
    this.phase = 0.0;
    this.moving = false;
    this.groan = 0.0;
    this.wire_t = 0.0;
    this.slow = false;
    this.rude = false;
    this.dead = false;
    /// > 0: đang đổ gục (giây đã trôi); hết 0,55 s thì thành xác.
    this.dying = 0.0;
    /// Trạng thái thêm (src/combat.rs, src/build.rs): đang cháy, bị bẫy giữ chân, đã dính bẫy, hồi tường chông, hệ số tốc độ,
    /// hẹn giờ đòn riêng của boss, đòn đang ra (0 không, 1 đập đất, 2 ném), giây còn lại của đòn, số đòn đã ra, điểm nhắm,
    /// giây còn trên không (Sweaty Rotter), tổng sát thương người chơi gây ra (để tính XP).
    this.burn = 0.0;
    this.root = 0.0;
    this.trapped = false;
    this.spike_cd = 0.0;
    this.speed_mul = 0.0;
    this.special = 0.0;
    this.act = 0;
    this.act_t = 0.0;
    this.n_att = 0;
    this.aim = v3();
    this.air = 0.0;
    Object.assign(this, f);
  }
}

export class Raid {
  constructor(f = {}) {
    this.next_day = 0;
    this.index = 0;
    this.announced = false;
    this.active = false;
    this.wave = 0;
    this.wave_t = 0.0;
    this.total = 0;
    Object.assign(this, f);
  }
}

export class DayStats {
  constructor() {
    this.served = 0;
    this.income = 0;
    this.outgoings = 0;
    this.other = 0;
    this.rep_gain = 0.0;
    /// Phần cộng không qua đường cong (Availability +0,0066 mỗi lần nhặt).
    this.rep_flat = 0.0;
    this.rep_loss = 0.0;
    this.kills = 0;
    this.rep_delta = 0.0;
    /// Phiên 8 (bot tuần đọc qua __twt.dstats): khách tới, khách bỏ chạy vì zombie gần quán.
    this.arrived = 0;
    this.fled = 0;
    /// [par-panels] Daily Summary như gốc: phần pin từ lục đồ (nằm trong `other`), lương nhân viên (nằm trong `outgoings`),
    /// uy tín theo mục Influences (giá trị thô; `rep_parts` = phần đã nhân hệ số cuối ngày).
    this.loot = 0;
    this.wages = 0;
    this.rep_by = {};
    this.rep_parts = {};
  }
  clone() {
    const c = Object.assign(new DayStats(), this);
    c.rep_by = Object.assign({}, this.rep_by);
    c.rep_parts = Object.assign({}, this.rep_parts);
    return c;
  }
}

export class Door {
  constructor(open = false, hp = 0.0, t = 0.0) {
    this.open = open;
    this.hp = hp;
    this.t = t;
  }
}

export const DOOR_HP = 250.0;
export const XP_STEPS = [49, 70, 90, 120, 175, 250, 350, 392, 442, 500];

const f32 = Math.fround;
/** f32::powi như compiler-rt __powisf2 (nhân bình phương, mỗi bước làm tròn f32). */
function powi_f32(a, b) {
  const recip = b < 0;
  let r = f32(1);
  a = f32(a);
  let n = b;
  for (;;) {
    if (n & 1) r = f32(r * a);
    n = Math.trunc(n / 2);
    if (n === 0) break;
    a = f32(a * a);
  }
  return recip ? f32(1 / r) : r;
}

export function level_of(xp) {
  let lvl = 0;
  for (;;) {
    // Sau cấp 10: 500,357 x 1,01^(cấp - 10) (luật gốc; hệ số tăng lấy của nhánh Management / Survival).
    const need = lvl < 10 ? XP_STEPS[lvl] : trunc(f32(f32(500.357) * powi_f32(1.01, lvl - 9)));
    if (xp < need) {
      return [lvl, xp, need];
    }
    xp -= need;
    lvl += 1;
  }
}

/// Một cục pin khách đặt lên quầy. Pin giả có mệnh giá in trên vỏ nhưng giá trị thật bằng 0.
export class Coin {
  constructor(f = {}) {
    this.value = 0;
    this.fake = false;
    this.checked = false;
    /// 0 còn trên quầy, 1 đã vào ngăn kéo, 2 đã vào thùng rác.
    this.done = 0;
    Object.assign(this, f);
  }
  clone() {
    return new Coin(this);
  }
}

/// Lượt thanh toán đang mở ở quầy.
export class Pay {
  constructor(f = {}) {
    this.coins = [];
    this.sel = 0;
    this.credited = 0;
    this.underpaid = 0;
    /// 0 chưa bấm báo động, 1 khách đang xin tha, 2 đã xử xong.
    this.alarm = 0;
    Object.assign(this, f);
  }
}

const near_min = (list, me, pred, lift) => {
  let best = null, bd = 0;
  for (const p of list) {
    if (!pred(p)) continue;
    const d = p.pos.distance(me);
    if (best === null || d < bd) { best = p; bd = d; }
  }
  return best === null ? null : best.pos.add(Y.mul(lift));
};
/** Rust f32::round (nửa ra xa số 0). */
const round_half_away = (v) => Math.sign(v) * Math.round(Math.abs(v));

/// Bảng đầy lại của chỗ lục đồ bản gốc (`static-lootables.json` -> refresh.possible): [tên món, ít nhất, nhiều nhất, trọng số].
export const LOOT_TABLE = [
  ['Unlabelled Tin', 4, 8, 1.0], ['Nail Plank', 1, 2, 0.8], ['Plank', 1, 4, 0.8], ['Nails', 1, 3, 0.8], ['Tinned Fruit', 2, 6, 0.75],
  ['Tinned Beans', 2, 6, 0.75], ['Painkillers', 1, 1, 0.5], ['Tape', 3, 4, 0.5], ['Crowbar', 1, 1, 0.5], ['Baseball Bat', 1, 1, 0.5],
  ['Beer', 2, 4, 0.5], ['9mm Ammo', 10, 20, 0.33], ['Shotgun Shells', 8, 16, 0.33], ['556 Ammo', 6, 14, 0.33],
];
const LOOT_FOOD = ['Unlabelled Tin', 'Tinned Fruit', 'Tinned Beans', 'Beer', 'Painkillers'];
let LOOT_IDS = null;
/// `lines` dòng khác nhau rút theo trọng số; `food_first`: dòng đầu chỉ rút trong nhóm hàng bán được.
export function loot_roll(rng, lines, food_first) {
  if (LOOT_IDS === null) {
    LOOT_IDS = LOOT_TABLE.map((r) => { for (let i = 0; i < N_ITEMS; i++) if (items.iname(i) === r[0]) return i; return -1; });
  }
  const out = [], used = new Set();
  for (let l = 0; l < lines; l++) {
    const rows = LOOT_TABLE.map((r, i) => i).filter((i) => LOOT_IDS[i] >= 0 && !used.has(i) && (!(food_first && l === 0) || LOOT_FOOD.includes(LOOT_TABLE[i][0])));
    if (rows.length === 0) break;
    let total = 0; for (const i of rows) total += LOOT_TABLE[i][3];
    let x = rng.next() * total, pick = rows[rows.length - 1];
    for (const i of rows) { x -= LOOT_TABLE[i][3]; if (x <= 0) { pick = i; break; } }
    used.add(pick);
    const n = rng.int(LOOT_TABLE[pick][1], LOOT_TABLE[pick][2]);
    for (let k = 0; k < n; k++) out.push(LOOT_IDS[pick]);
  }
  return out;
}

/// [ĐỀ XUẤT] Đợt 13: bảng đồ theo loại chỗ lục (mỗi món là một thùng = `case_units()` món lẻ khi lên kệ). Dòng đầu luôn rút
/// trong nhóm hàng bán được (đồ ăn / uống / thuốc), các dòng sau rút trong cả bảng nên phần còn lại là vật liệu, đạn, đồ
/// nghề. Lượng nhỏ (1-3) vì khách giờ chỉ mua 1-3 món lẻ: tổng hàng một ngày lục được phải xấp xỉ sức mua, không ngập kho.
/// [tên món, ít nhất, nhiều nhất, trọng số]
export const SPOT_TABLES = {
  bag: [['Unlabelled Tin', 1, 2, 1.0], ['Tinned Beans', 1, 2, 0.8], ['Tinned Fruit', 1, 1, 0.6], ['Beer', 1, 2, 0.6], ['Worn Cloth', 1, 2, 0.5], ['Tape', 1, 1, 0.3], ['Bandage', 1, 1, 0.25]],
  backpack: [['Tinned Beans', 1, 1, 0.8], ['Unlabelled Tin', 1, 2, 0.8], ['Beer', 1, 1, 0.5], ['Bandage', 1, 1, 0.5], ['Tinned Tuna', 1, 1, 0.25], ['9mm Ammo', 4, 8, 0.3], ['Worn Cloth', 1, 1, 0.4]],
  tools: [['Unlabelled Tin', 1, 1, 0.5], ['Beer', 1, 1, 0.4], ['Nails', 1, 3, 0.9], ['Tape', 1, 2, 0.7], ['Plank', 1, 2, 0.6], ['Metal Scraps', 1, 2, 0.6], ['Crowbar', 1, 1, 0.12]],
  locker: [['Beer', 1, 2, 0.8], ['Tinned Fruit', 1, 1, 0.6], ['Bandage', 1, 1, 0.5], ['Painkillers', 1, 1, 0.15], ['Worn Cloth', 1, 2, 0.5], ['9mm Ammo', 4, 8, 0.3], ['Tape', 1, 1, 0.3], ['Baseball Bat', 1, 1, 0.06]],
  fridge: [['Beer', 1, 3, 1.0], ['Tinned Fruit', 1, 2, 0.8], ['Good Meat', 1, 2, 0.6], ['Potato', 1, 2, 0.5], ['Wine', 1, 1, 0.1]],
  cabinet: [['Tinned Beans', 1, 2, 0.8], ['Unlabelled Tin', 1, 2, 0.8], ['Bandage', 1, 1, 0.5], ['Painkillers', 1, 1, 0.2], ['Tape', 1, 1, 0.4], ['Nails', 1, 2, 0.4]],
  bin: [['Unlabelled Tin', 1, 1, 0.8], ['Tinned Beans', 1, 1, 0.4], ['Beer', 1, 1, 0.4], ['Worn Cloth', 1, 2, 0.7], ['Metal Scraps', 1, 1, 0.5]],
  ammo: [['Unlabelled Tin', 1, 2, 0.6], ['Tinned Tuna', 1, 1, 0.4], ['Bandage', 1, 1, 0.4], ['9mm Ammo', 6, 12, 0.8], ['Shotgun Shells', 4, 8, 0.5]],
  medical: [['Bandage', 1, 2, 1.0], ['Painkillers', 1, 1, 0.35], ['Tinned Fruit', 1, 1, 0.4], ['Beer', 1, 1, 0.3]],
  safe: [['Tinned Tuna', 1, 2, 0.6], ['Wine', 1, 1, 0.4], ['Painkillers', 1, 1, 0.5], ['Whisky', 1, 1, 0.2], ['9mm Ammo', 6, 12, 0.5]],
  crate: [['Unlabelled Tin', 2, 3, 1.0], ['Tinned Beans', 1, 2, 0.7], ['Tinned Fruit', 1, 2, 0.6], ['Beer', 1, 2, 0.5], ['Plank', 1, 2, 0.6], ['Nails', 1, 3, 0.5]],
};
/// Số dòng lúc mở ván theo bảng: chỗ to 2 dòng, chỗ nhỏ 1 dòng (+ 40% thêm một dòng).
const SPOT_LINES = { locker: 2, fridge: 2, crate: 2, tools: 2, safe: 2, cabinet: 2 };
/// [ĐỀ XUẤT] Đầy lại mỗi sáng: chỗ đã lục có `SPOT_REFILL` cơ hội đầy lại (bản gốc 5%), 1 dòng (+ 40% dòng thứ hai). Chỗ
/// chưa lục giữ nguyên đồ. Nên lục là vòng lặp mỗi ngày: sáng ra đi một vòng, chỗ nào sáng đèn là có đồ.
export const SPOT_REFILL = 0.45;
const SPOT_IDS = new Map();
function spot_id(name) {
  if (!SPOT_IDS.has(name)) { let id = -1; for (let i = 0; i < N_ITEMS; i++) if (items.iname(i) === name) { id = i; break; } SPOT_IDS.set(name, id); }
  return SPOT_IDS.get(name);
}
export function spot_roll(rng, table, lines) {
  const T = SPOT_TABLES[table] || SPOT_TABLES.bag;
  const out = [], used = new Set();
  for (let l = 0; l < lines; l++) {
    const rows = T.map((r, i) => i).filter((i) => spot_id(T[i][0]) >= 0 && !used.has(i) && (l > 0 || LOOT_FOOD.concat(['Tinned Tuna', 'Good Meat', 'Potato', 'Wine', 'Whisky', 'Bandage']).includes(T[i][0])));
    if (rows.length === 0) break;
    let total = 0; for (const i of rows) total += T[i][3];
    let x = rng.next() * total, pick = rows[rows.length - 1];
    for (const i of rows) { x -= T[i][3]; if (x <= 0) { pick = i; break; } }
    used.add(pick);
    const n = rng.int(T[pick][1], T[pick][2]);
    for (let k = 0; k < n; k++) out.push(spot_id(T[pick][0]));
  }
  return out;
}
/// Loại bảng của 8 chỗ lục gốc khi chạy luật Đợt 13.
export const CACHE_TABLE = { 'Duffle bag': 'bag', 'Trolley': 'crate', 'Toolbox': 'tools', 'Crate': 'crate', 'Bin': 'bin', 'Glovebox': 'ammo', 'Medical bag': 'medical', 'Suitcase': 'bag' };
export function spot_table(name, pos) {
  if (!orig_rules()) for (const [n, p, , t] of lay.LOOT_SPOTS) if (n === name && Math.abs(p.x - pos.x) < 0.05 && Math.abs(p.z - pos.z) < 0.05) return t;
  return CACHE_TABLE[name] || 'bag';
}

export class Game {
  constructor(seed) {
    const prices = new Array(N_ITEMS).fill(0);
    for (let i = 0; i < prices.length; i++) {
      prices[i] = Math.max(items.ival(i), 1);
    }
    this.mode = 'Title';
    this.panel = { k: 'None' };
    this.day = 1;
    this.minutes = 5.5 * 60.0;
    this.speed = 1.0;
    this.raid_scale = 1.0;
    this.batteries = 0;
    this.rep = 0.0;
    this.open = false;
    this.ever_opened = false;
    this.opened_today = false;
    this.since_spawn = 0.0;
    this.spawn_interval = 90.0;
    this.minute_mark = 0;
    this.hour_mark = -1;
    this.prices = prices;
    // Bảng Item Details (gốc SetItemPricePlayerStateView): cờ chung theo loại món (ItemData._availableForPurchase mặc định bật,
    // ignore-by-cleaners tắt). Cờ riêng từng vật (bỏ "Set for all") nằm ở prop.ovr (items.det_*).
    this.avail = new Array(N_ITEMS).fill(true);
    this.noclean = new Array(N_ITEMS).fill(false);
    this.inv = new Array(N_ITEMS).fill(0);
    // [phiên 7] Một kệ ván bắt tường đông lúc mở ván (ảnh bản gốc ngày 2 của chủ dự án); kệ thêm thì chế tạo / dựng.
    // `?shelves=2` giữ hai kệ ba tầng cũ.
    this.shelves = two_shelves() ? [
      new Shelf(v3(lay.SHELVES[0][0], 0.0, lay.SHELF_Z0 + 3.5 * lay.SLOT_W), Math.PI / 2, SHELF_COLS, 3, 0),
      new Shelf(v3(lay.SHELVES[1][0], 0.0, lay.SHELF_Z0 + 3.5 * lay.SLOT_W), -Math.PI / 2, SHELF_COLS, 3, 0),
    ] : [new Shelf(v3(lay.SHELVES[1][0], 0.0, lay.SHELF_Z0 + 3.5 * lay.SLOT_W), -Math.PI / 2, SHELF_COLS, 3, 0)];
    if (this.shelves.length === 1) this.shelves[0].plank = true;
    this.hp = 100.0;
    this.hp_max = 100.0;
    this.since_hit = 99.0;
    this.hurt_flash = 0.0;
    this.held = null;
    /// Vũ khí đang trang bị (ô cận chiến và ô súng) và ô đang cầm.
    this.weapons = [];
    this.wsel = 0;
    this.armed = false;
    this.swing = 0.0;
    this.swing_hit = false;
    this.stock_sel = TIN;
    this.done = new Array(Q_COUNT).fill(false);
    /// [par-panels] nhiệm vụ phụ đã hiện trên To Do (chỉ những cái này báo QUEST COMPLETE khi xong)
    this.side_on = new Set();
    // [FTUE A2] To Do theo bản gốc (sim/quests.js): việc đang hiện, sóng việc đã chạy, số món đã chế (CraftItems x10)
    this.qshow = new Set();
    this.qwave = { Combat: false, Crafting: false, EndOfDay: false };
    this.crafted_n = 0;
    this.trash_done = 0;
    this.sweep_done = 0;
    this.caches_done = 0;
    this.stats = new DayStats();
    this.last_stats = new DayStats();
    /// XP của bốn kỹ năng: Service, Management, Survival, Crafting.
    this.xpv = [0, 0, 0, 0];
    this.door = new Door(false, DOOR_HP, 0.0);
    this.bed_door_hits = 0;
    this.props = [];
    this.next_id = 1;
    this.customers = [];
    this.zombies = [];
    this.raid = new Raid({ next_day: 3, index: 2 });
    this.notice = '';
    this.notice_t = 0.0;
    this.rng = new Rng(seed);
    this.player = lay.START.clone();
    this.yaw = 0.0;
    this.pitch = 0.0;
    this.vel_y = 0.0;
    this.hold_t = 0.0;
    this.hold_id = 0;
    this.scav = [false, false];
    this.scav_pending = [];
    this.rude_spawned = false;
    this.rude_pending = false; // [FTUE A4] cảnh zombie ngày 2 đang chạy: zombie thật và Robin xuất hiện khi cảnh hết
    this.sfx = [];
    /// Hiệu ứng hạt chờ sinh: (loại ở fx.rs, vị trí).
    this.fxq = [];
    /// Chế độ trưng bày (?zoo=1): nhân vật đứng yên để chụp cận cảnh.
    this.zoo = false;
    /// `?zoo=people|zombies|turn`: hàng 24 người / 24 zombie / một người bốn góc trước phông xám.
    this.zoo_kind = '';
    this.save_request = false;
    this.prompt = '';
    this.total_served = 0;
    this.offer_t = 0.0;
    /// Cắt cảnh đang chạy: (loại ở cine.rs, giây đã chạy) -> [kind, t] hoặc null.
    this.cine = null;
    this.nocine = false;
    /// Thẻ "QUEST COMPLETE".
    this.toast = '';
    this.toast_t = 0.0;
    this.chk_t = 0.0; // [FTUE A7] giây còn lại của dòng "Check the battery has the correct charge."
    /// Màn đen mờ dần sau khi thức dậy / hết cắt cảnh.
    this.fade = 0.0;
    this.sens = 1.0;
    this.invert = false;
    this.volume = 0.8;
    /// Hẹn giờ cảnh báo zombie lọt vào quán.
    this.zalert_t = 0.0;
    /// Cờ tính năng đang bật (FF_*).
    this.ff = FF_DEFAULT;
    this.pay = null;
    /// [par-counter D13] Chế độ đứng quầy của gốc (Serve ở Service Desk): đứng yên sau quầy, camera nhìn xuống quầy, "ESC Leave".
    this.desk = false;
    /// [par-counter D12] Lượt trả pin cho khách bán: { c (khách), item, qty, ask, left, hand (mệnh giá đang cầm | 0) } | null.
    this.give = null;
    /// Tăng mỗi lần lượt thanh toán đổi trạng thái (để dựng lại hình các cục pin trên quầy).
    this.pay_rev = 0;
    /// Đã từng gặp pin giả (nhiệm vụ "seen underpayment" của bản gốc).
    this.seen_fake = false;
    /// Khách được tha hôm qua sẽ quay lại trả nợ sáng nay.
    this.forgiven_due = false;
    /// ?fake=1: cục pin đầu của lượt thanh toán kế là pin giả (để bot thử).
    this.force_fake = false;
    /// Thuốc đã cho khách bị thương hôm nay; sáng mai mỗi món đổi thành một thùng quà trước cửa.
    this.med_gifts = [];
    /// ?medic=1: khách kế tiếp là khách bị thương (để bot thử).
    this.force_medic = false;
    this.force_seller = false;
    this.staff = [];
    this.staff_day = 1;
    this.staff_hour = -1;
    this.staff_min = 0;
    /// Phần nhìn thấy của phát bắn và lò xo của hình cầm tay (`fp.rs`).
    this.fx2 = new fp.Vis();
    /// Cầm và tương tác bằng tay (carry.rs).
    this.cy = new carry.Carry();
    /// Nhân viên đang chọn trên Job Board.
    this.staff_sel = 0;
    this.approaches_today = 0;
    /// ?staffer=1: giờ kế tiếp có ứng viên tới (để bot thử).
    this.force_staffer = false;
    /// Móc kiểm thử `?staffer=1223`: cấp bốn nghề của ứng viên kế tiếp (Scavenger, Security, Service, Cleaner).
    this.force_levels = null;
    /// Trạng thái 29 landmark (0 chưa tới được, 1 tới được, 2 rào chắn đã mở), máu rào zombie, dòng đang chọn trên bản đồ.
    this.lm = map.initial();
    this.lm_hp = map.initial_hp();
    this.lm_sel = 0;
    /// Việc chế tạo đang chạy: (món, giây đã chạy) -> [item, t] hoặc null.
    this.craft_job = null;
    /// Tab của bảng chế tạo (0 bàn, 1 máy nghiền) và dòng đang chọn.
    this.craft_tab = 0;
    this.craft_sel = 0;
    /// Dòng đang chọn trong ba lô.
    this.bag_sel = 0;
    /// Công thức đã học bằng tờ công thức (chỉ số món được dạy), hàng chờ chế tạo và số lần muốn làm.
    this.learned = [];
    this.craft_queue = 0;
    this.craft_plan = 1;
    /// Đang học một tờ công thức: (món công thức, giây đã trôi) -> [item, t] hoặc null.
    this.learn_job = null;
    /// Đang dùng thuốc: (món, giây đã trôi) -> [item, t] hoặc null.
    this.heal_job = null;
    /// Món y tế đang cầm trên tay (ô Consumable của gốc) hoặc null.
    this.med_hand = null;
    this.sk = new skills.State();
    this.bld = new build.State();
    this.cb = new combat.State();
    this.ev = new events.State();
    /// Ô lưu đang chơi (0..2).
    this.slot = 0;
    this.populate();
  }
  static new(seed) {
    return new Game(seed);
  }

  add_prop(kind, pos, yaw) {
    const id = this.next_id;
    this.next_id += 1;
    this.props.push(new Prop({ id, kind, pos: pos.clone(), yaw, ent: null, dirty: false, dead: false, hp: 0.0, aux: 0.0, aux2: 0.0 }));
    return id;
  }

  prop(id) {
    const p = this.props.find((p) => p.id === id && !p.dead);
    return p === undefined ? null : p;
  }

  /// Ván mới của bản gốc: rác, đống rác, búa, 14 hộp thiếc trong phòng ngủ, hộp các-tông, các chỗ lục đồ.
  populate() {
    lay.TRASH.forEach(([x, z], i) => {
      this.add_prop(PropKind.Trash(i % 3), v3(x, 0.0, z), i * 1.3);
    });
    lay.PILES.forEach(([x, z], i) => {
      this.add_prop(PropKind.Pile(), v3(x, 0.0, z), i * 0.9);
    });
    this.add_prop(PropKind.Hammer(), lay.HAMMER, 0.6);
    for (let i = 0; i < 14; i++) {
      const x = lay.TINS.x + (i % 5) * lay.TINS_STEP + this.rng.range(-0.08, 0.08);
      const z = lay.TINS.z + Math.trunc(i / 5) * 0.4 + this.rng.range(-0.08, 0.08);
      const yaw = this.rng.range(0.0, 6.0);
      this.add_prop(PropKind.Item(TIN), v3(x, 0.0, z), yaw);
    }
    this.add_prop(PropKind.Box([]), lay.CARD_BOX, 0.3);
    // [GỐC] `static-lootables.json` (bake từ scene gốc, linux2:~/twt-bevy-ref/baked): lúc mở ván chỉ có túi trong cốp xe
    // (4 Unlabelled Tin), xe đẩy (3 Tinned Beans + 2 Beer) và một túi 8 Beer; các chỗ khác trống và mỗi sáng có 5% đầy lại
    // theo bảng `loot_roll`. [ĐỀ XUẤT] (chủ dự án 2026-11-15: lục đồ "toàn material", hết hàng ngay ngày 1): năm chỗ còn lại
    // của bản này đầy sẵn theo ĐÚNG bảng đầy lại của bản gốc, dòng đầu luôn là hàng bán được (đồ hộp, bia, thuốc).
    const rep8 = (i, n) => Array.from({ length: n }, () => i);
    if (!orig_rules()) {
      // Đợt 13: ba chỗ đầy sẵn của bản gốc giữ đúng SỐ MÓN LẺ gốc (một thùng = 2 món lẻ): 2 thùng tin, 2 beans + 1 beer,
      // 4 thùng beer; năm chỗ còn lại và mọi chỗ thêm rút theo bảng của loại chỗ.
      const caches = [
        ['Duffle bag', lay.CACHE_DUFFLE, rep8(TIN, 2), 0.0],
        ['Trolley', lay.CACHE_TROLLEY, [BEANS, BEANS, BEER], 0.0],
        ['Toolbox', lay.CACHE_TOOLBOX, spot_roll(this.rng, 'tools', 2), 0.0],
        ['Crate', lay.CACHE_CRATE, spot_roll(this.rng, 'crate', 2), 0.0],
        ['Bin', lay.CACHE_BIN, spot_roll(this.rng, 'bin', 1), 0.0],
        ['Glovebox', lay.CACHE_GLOVEBOX, spot_roll(this.rng, 'ammo', 1), 0.0],
        ['Medical bag', lay.CACHE_MEDBAG, [BANDAGE].concat(spot_roll(this.rng, 'medical', 1)), 0.0],
        ['Suitcase', lay.CACHE_SUITCASE, rep8(BEER, 4), 0.0],
      ];
      for (const [name, p, , t] of lay.LOOT_SPOTS) {
        const lines = SPOT_LINES[t] || (this.rng.chance(0.4) ? 2 : 1);
        caches.push([name, p, spot_roll(this.rng, t, lines), lay.LOOT_SPOTS.find((r) => r[1] === p)[2]]);
      }
      for (const [name, p, its, yaw] of caches) {
        this.add_prop(PropKind.Cache(name, its, false), p, yaw);
      }
      this.add_prop(PropKind.BoxPile(), lay.BOX_PILE, 0.15); // xem cuối hàm
      this.add_prop(PropKind.Notes(), lay.NOTES, 0.2); // [par-panels] C23
      return;
    }
    const caches = [
      ['Duffle bag', lay.CACHE_DUFFLE, rep8(TIN, 4)],
      ['Trolley', lay.CACHE_TROLLEY, [BEANS, BEANS, BEANS, BEER, BEER]],
      ['Toolbox', lay.CACHE_TOOLBOX, loot_roll(this.rng, 2, true)],
      ['Crate', lay.CACHE_CRATE, loot_roll(this.rng, 2, true)],
      ['Bin', lay.CACHE_BIN, loot_roll(this.rng, 2, true)],
      ['Glovebox', lay.CACHE_GLOVEBOX, loot_roll(this.rng, 1, true)],
      ['Medical bag', lay.CACHE_MEDBAG, [BANDAGE, BANDAGE].concat(loot_roll(this.rng, 1, true))],
      ['Suitcase', lay.CACHE_SUITCASE, rep8(BEER, 8)],
    ];
    for (const [name, p, its] of caches) {
      this.add_prop(PropKind.Cache(name, its, false), p, 0.0);
    }
    // [ĐỀ XUẤT phiên 7] Đống hộp các-tông gấp dẹt trong quán cạnh cửa trước (clip 03 3:05: người chơi lấy hộp từ đống
    // "Cardboard Boxes"): [E] lấy một hộp rỗng, tối đa BOX_PILE_MAX hộp nằm quanh quán. Thêm sau cùng để id cũ không đổi.
    this.add_prop(PropKind.BoxPile(), lay.BOX_PILE, 0.15);
    this.add_prop(PropKind.Notes(), lay.NOTES, 0.2); // [par-panels] C23 tờ ghi chú (đọc được từ ngày 3 như gốc `NotesObject.UnlocksAtDay`)
  }

  /// "Skip Introduction": 09:00, đã dọn quán, có búa, hộp thiếc đã nằm trong ba lô.
  skip_intro() {
    this.minutes = 9.0 * 60.0;
    for (const p of this.props) {
      switch (p.kind.k) {
        case 'Trash': case 'Pile': case 'Hammer': case 'Item': p.dead = true; break;
        default: break;
      }
    }
    this.inv[TIN] = 14;
    if (!this.has_w(HAMMER)) {
      items.equip(this, HAMMER);
      this.armed = false;
    }
    this.bed_door_hits = 3;
    this.trash_done = 6;
    this.sweep_done = 9;
    for (const q of ['EnterShop', 'Trash', 'Sweep', 'Hammer', 'JammedDoor', 'PickBox', 'FillBox']) {
      this.done[q_index(q)] = true;
    }
    this.player = lay.SKIP_INTRO.clone();
    this.yaw = 0.0;
  }

  hour() {
    return this.minutes / 60.0;
  }

  clock_text() {
    const m = trunc(this.minutes);
    const h = Math.trunc(m / 60) % 24, mm = m % 60;
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `Day ${this.day}  ${String(h12).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  }

  say(s) {
    this.notice = String(s);
    this.notice_t = 4.5;
  }

  play(name, vol) {
    this.sfx.push([name, vol]);
  }

  is_done(q) {
    return this.done[q_index(q)];
  }

  complete(q) {
    const i = q_index(q);
    if (!this.done[i]) {
      this.done[i] = true;
      // gốc: việc xong khi chưa hiện thì xong lặng lẽ; việc đang hiện chạy hoạt ảnh xong (QUEST COMPLETE)
      if (this.qshow === undefined || this.qshow.has(q)) {
        this.play('quest', 0.6);
        this.toast = q_title(q);
        this.toast_t = 3.5;
      }
    }
  }

  /// Danh sách To Do đang hiện: [[nhóm, nội dung, mã việc, nhóm đầu], ...] (sim/quests.js: sóng việc và cách hiện như gốc,
  /// nhóm xếp theo priority, mỗi nhóm một dòng). Dòng "Keeping Shop" (free_play, [ĐỀ XUẤT] 2026-11-15) đứng cuối.
  todo() {
    quests.tick(this);
    const out = quests.rows(this);
    const fpl = this.free_play();
    if (fpl !== null) out.push(['Keeping Shop', fpl[2], 'KeepingShop', out.length === 0]);
    return out;
  }

  /// Sinh các cục pin khách trả cho `amount` pin (luật gốc `CheckoutCustomerCurrencyInstantiator.GeneratePayment`):
  /// mệnh giá 1000/100/50/10/5/1, tham lam từ lớn xuống; khi còn cần từ 4 cục trở lên thì 20% chọn mệnh giá ngẫu nhiên;
  /// mỗi cục có thể là giả (0,0125; ngày 1 chỉ sau 14:00 và sau lần bán đầu; ép một cục giả sau 17:00 nếu chưa từng gặp).
  /// Trả về [coins, underpaid].
  gen_payment(amount) {
    const DENOMS = [1000, 100, 50, 10, 5, 1];
    const coins = [];
    let remaining = amount, underpaid = 0, it = 0;
    const first_sale = this.is_done('ServeFirst');
    const hour = this.hour();
    let forced = this.force_fake;
    this.force_fake = false;
    while (remaining >= 1 && it < 512) {
      it += 1;
      const usable = DENOMS.filter((d) => d <= remaining);
      let greedy = 0;
      let r = remaining;
      for (const d of DENOMS) {
        greedy += Math.trunc(r / d);
        r %= d;
      }
      const value = greedy >= 4 && this.rng.chance(0.2) ? this.rng.pick(usable) : usable[0];
      // [FTUE A7] gốc CheckoutCustomerCurrencyInstantiator: ServeCustomer xong mà SoundCheckoutAlarm chưa xong thì khách kế trả thiếu
      if (underpaid === 0 && !this.seen_fake && first_sale) {
        forced = true;
      }
      const roll = this.rng.next() < 0.0125;
      const fake = this.day < 2 ? (first_sale && ((roll && hour > 14.0) || forced)) || (!first_sale && forced) : roll || forced;
      forced = false;
      if (fake) {
        underpaid += value;
      }
      coins.push(new Coin({ value, fake, checked: false, done: 0 }));
      remaining -= value;
    }
    return [coins, underpaid];
  }

  start_cine(kind) {
    if (this.nocine && kind !== 0) {
      return;
    }
    this.cine = [kind, 0.0];
  }

  /// Điểm cần tới của việc đang làm (cho mốc chỉ đường trên màn hình).
  objective() {
    const me = this.player;
    const near = (f) => near_min(this.props, me, (p) => !p.dead && this.held !== p.id && f(p.kind), 0.6);
    const zed = (raid) => near_min(this.zombies, me, (z) => !z.dead && (!raid || z.raid), 2.0);
    const sw = lay.SWITCH.clone();
    const bed = lay.up(lay.BED, 0.8);
    const door = lay.up(lay.DOOR, 1.4);
    const hp = this.held === null ? undefined : this.props.find((p) => p.id === this.held);
    const held = hp === undefined ? null : hp.kind;
    const h = this.hour();
    if (this.raid.active) {
      return zed(true);
    }
    if (this.rude_spawned && !this.is_done('KillZombie')) {
      return zed(false);
    }
    if (this.is_done('KillZombie') && !this.is_done('LootZombie')) {
      return near((k) => k.k === 'Corpse' && k.b === false);
    }
    if (this.is_done('LootZombie') && !this.is_done('RepairDoor')) {
      return door;
    }
    const q = CHAIN.find((q) => !this.is_done(q));
    if (q !== undefined) {
      switch (q) {
        case 'EnterShop': return door;
        case 'Trash':
          if (held !== null && held.k === 'Trash') {
            return lay.up(lay.SKIP, 1.5);
          } else {
            return near((k) => k.k === 'Trash');
          }
        case 'Sweep': return near((k) => k.k === 'Pile');
        case 'Hammer': return near((k) => k.k === 'Hammer');
        case 'JammedDoor': return lay.up(lay.BED_DOOR, 1.3);
        case 'PickBox': return near((k) => k.k === 'Box');
        case 'FillBox': return near((k) => k.k === 'Item');
        case 'Shelve': return this.shelves[0].slot_pos(10);
        case 'OpenStore': return sw;
        default: return lay.up(lay.TILL, 1.3);
      }
    }
    if (h >= 19.0) {
      return this.open ? sw : this.ever_opened ? bed : null;
    }
    if (this.day >= 2 && !this.is_done('OpenPackage')) {
      const p = near((k) => k.k === 'Crate');
      if (p !== null) {
        return p;
      }
    }
    if (!this.open && !this.opened_today) {
      return sw;
    }
    // [ĐỀ XUẤT] (chủ dự án 2026-11-15: "hết hàng, chả biết làm gì nữa"): hết chuỗi hướng dẫn thì mốc vàng vẫn chỉ việc kế tiếp.
    const fp = this.free_play();
    if (fp !== null) return fp[1];
    return null;
  }

  /// Việc nên làm lúc chơi tự do: [dòng gợi ý, điểm chỉ đường | null, dòng To Do] hoặc null.
  /// [ĐỀ XUẤT] theo lời chủ dự án 2026-11-15 và số đo của tools/day1loop.cjs (61-91 s không có chỉ dẫn nào lúc quán mở).
  free_play() {
    if (this.mode !== 'Play' || this.raid.active || CHAIN.some((q) => !this.is_done(q))) return null;
    // [FTUE K10] ngày raid, trước đợt đầu: chỉ "And Stay Out!" (gốc không có dòng "Keeping Shop"; hai chỉ dẫn ngược nhau làm rối)
    if (this.day === this.raid.next_day && this.minutes < 9.5 * 60.0) return null;
    if (this.day >= 2 && !this.is_done('OpenPackage') && this.props.some((p) => !p.dead && p.kind.k === 'Crate')) return null;
    const me = this.player, h = this.hour();
    if (h >= 19.0) return null;
    if (this.open && actors.head_customer(this) !== null && !this.desk) {
      return ['A customer is waiting: stand behind the counter and [E] serve them', lay.up(lay.TILL, 1.3), 'Serve the customer at the till.'];
    }
    let free = 0, filled = 0;
    // `filled` = món lẻ trên kệ (một ô chồng nhiều món, xem case_units); `free` = ô trống.
    for (const sh of this.shelves) for (let k = 0; k < sh.slots.length; k++) { if (sh.slots[k] === null) free += 1; else filled += sh.units(k); }
    const have = this.sellable_in_inv().length > 0;
    // Hàng đang nằm sẵn (hộp thiếc còn trên sàn phòng ngủ, món khách bỏ lại) gần hơn mọi chỗ lục đồ.
    const held = this.held;
    let item = null, idist = Infinity;
    for (const p of this.props) {
      if (p.dead || p.id === held || p.kind.k !== 'Item' || !items.sellable(p.kind.a)) continue;
      const d = p.pos.distance(me);
      if (d < idist) { idist = d; item = p; }
    }
    const hb = held !== null ? this.prop(held) : null;
    const goods = (it) => items.sellable(it) && !items.is_material(it);
    const boxGoods = hb !== null && ((hb.kind.k === 'Box' && hb.kind.a.some(goods)) || (hb.kind.k === 'Item' && goods(hb.kind.a)));
    if (boxGoods && free > 0) {
      return ['[E] on a shelf to restock from the box you carry (the price tag on the shelf lip: [E] set price)', this.shelves[0].slot_pos(10), 'Restock the shelves from your box.'];
    }
    if (filled === 0 && have) {
      return ['The shelves are empty: [E] on a shelf to restock from your backpack     [R] change item', this.shelves[0].slot_pos(10), 'Restock the shelves from your backpack.'];
    }
    if (filled <= 3 && item !== null && !have) {
      return ['Goods are still lying around: [E] pick them up (a cardboard box holds 80, a tin takes 10), then [E] on a shelf', item.pos.add(Y.mul(0.3)), 'Collect the goods left on the floor and shelve them.'];
    }
    // Chỗ lục đồ gần nhất theo đường đi: đứng trong nhà thì tính từ cửa chính; chỗ sau quán phải đi vòng.
    const inside = Game.in_shop(me) || Game.in_bedroom(me);
    const from = inside ? lay.DOOR_OUT : me;
    let best = null, bd = Infinity, left = 0;
    for (const p of this.props) {
      if (p.dead || p.kind.k !== 'Cache' || p.kind.c !== false) continue;
      left += 1;
      const behind = p.pos.z < lay.DOOR_OUT.z - 6.0 && from.z > lay.DOOR_OUT.z - 6.0 ? 14.0 : 0.0;
      const d = p.pos.distance(from) + behind + (inside ? me.distance(lay.DOOR_OUT) : 0.0);
      if (d < bd) { bd = d; best = p; }
    }
    // [phiên 7] hàng chỉ vào hộp: chưa cầm hộp thì việc đầu tiên là lấy hộp ở đống cạnh cửa
    const hp = this.held !== null ? this.prop(this.held) : null;
    const pile = this.props.find((p) => !p.dead && p.kind.k === 'BoxPile');
    const boxFirst = best !== null && pile !== undefined && !loot_bag() && !(hp !== null && hp.kind.k === 'Box');
    const BOX_TIP = ['Take an empty cardboard box from the pile by the front door first: goods and materials only fit in a box', pile ? pile.pos.add(Y.mul(0.5)) : null, 'Take a box, then search outside for goods.'];
    if (filled === 0) {
      if (boxFirst) return BOX_TIP;
      if (best !== null) {
        return ['Out of stock: search the bags, trolleys and crates outside for goods to sell ([hold E] on the marked one)', best.pos.add(Y.mul(0.6)), 'Out of stock. Search outside for goods to sell.'];
      }
      return ['Sold out for today: close the store at the switch and sleep. A delivery arrives tomorrow morning', this.open ? lay.SWITCH.clone() : null, 'Sold out. Close the store and sleep.'];
    }
    if (have && free > 0) {
      return [case_units() > 1 ? `[E] on a shelf to put out more goods: one case from your backpack = ${case_units()} on the shelf     [R] change item` : '[E] on an empty shelf slot to put out more goods from your backpack     [R] change item', null, 'Put the goods from your backpack on the shelves.'];
    }
    if (this.open) {
      if (best !== null && filled <= 6) {
        if (boxFirst) return BOX_TIP;
        return ['Stock is running low: search outside for more goods ([hold E] on the marked one), customers queue at the till meanwhile', best.pos.add(Y.mul(0.6)), `Stock is low. Search outside for goods (${left} places left).`];
      }
      return [best !== null ? 'Customers come in waves: wait behind the counter, or use the quiet time to search outside for more goods' : 'Customers come in waves: wait behind the counter and [E] serve them at the till',
        null, best !== null ? `Wait for customers. Quiet time: search outside for goods (${left} places left).` : 'Wait for customers behind the counter.'];
    }
    return null;
  }

  /// Dòng gợi ý phím theo việc đang làm.
  /// [par-counter A03] Gợi ý góc dưới trái như gốc: chỉ các động từ của việc đang làm, mỗi dòng "[phím] Động từ" (gốc op/03
  /// "Attack", op/04 "ESC Leave", op/14 "Empty / Drop", c01 1:22:40 "Fire / Reload / Cycle Slot / Unequip"). Lời dẫn việc
  /// nên làm nằm ở To Do (free_play()[2]) và mốc chỉ đường, không ở đây.
  hint() {
    if (this.desk) return '[Esc] Leave';
    if (this.sit) return '[W] Stand Up'; // [par-counter D35]
    const hp = this.held === null ? undefined : this.props.find((p) => p.id === this.held);
    const held = hp === undefined ? null : hp.kind;
    if (held !== null) {
      switch (held.k) {
        case 'Trash': return '[Wheel] Forward/Back     [R] Rotate'; // [par-counter D06] gốc clip 01 0:40
        case 'Crate': return '[Wheel] Forward/Back     [R] Rotate'; // [par-counter D16] gốc c01 5:05
        case 'Box': return '[RMB] Empty     [X] Drop';
        default: return '[X] Drop';
      }
    }
    if (this.cb.throw_item !== null) return '[hold LMB] Charge Throw     [Wheel] Cycle Slot     [1] Unequip';
    const w = this.cur_w();
    if (w === null) return '';
    if (items.gun(w.item) !== null) return '[LMB] Fire     [R] Reload     [Wheel] Cycle Slot     [1] Unequip';
    if (w.item === HAMMER) return '[LMB] Attack';
    return '[LMB] Attack/Throw     [hold LMB] Charge Throw     [Wheel] Cycle Slot     [1] Unequip'; // [par-counter A05]
  }

  /// Trong sàn bán hàng: quán, cộng các phòng mở rộng đã phá tường.
  static in_shop(p) {
    return lay.inside(lay.SHOP, p) || (lay.rooms() >= 1 && lay.inside(lay.SF2, p)) || (lay.rooms() >= 2 && lay.inside(lay.SF3, p));
  }
  static in_warehouse(p) {
    return lay.inside(lay.WAREHOUSE_IN, p);
  }
  static in_medical(p) {
    return lay.inside(lay.MEDICAL_IN, p);
  }
  static in_bedroom(p) {
    // Mép chung với quán (vách cửa phòng ngủ) tính là phòng ngủ.
    const b = lay.BEDROOM;
    return p.x > b[0] && p.x <= b[2] && p.z > b[1] && p.z < b[3];
  }
  /// Người chơi đứng sau quầy (chỗ phục vụ).
  at_service() {
    return lay.inside(lay.SERVICE, this.player);
  }
  /// Cờ tính năng `f` đang bật.
  on(f) {
    return (this.ff & f) !== 0;
  }
  door_blocks() {
    return !this.door.open && this.door.hp > 0.0;
  }

  add_rep_flat(raw, cat = 'Availability') {
    this.stats.rep_flat += raw;
    const b = this.stats.rep_by[cat] || (this.stats.rep_by[cat] = [0.0, 0.0, 0.0]);
    b[2] += raw;
  }

  /// `cat`: mục Influences của Daily Summary gốc (Availability, Pricing, Service, Heroism, Danger, Corpses); chỉ để hiện.
  add_rep(raw, cat = 'Service') {
    const b = this.stats.rep_by[cat] || (this.stats.rep_by[cat] = [0.0, 0.0, 0.0]);
    b[raw >= 0.0 ? 0 : 1] += raw >= 0.0 ? raw : -raw;
    if (raw >= 0.0) {
      this.stats.rep_gain += raw;
    } else {
      this.stats.rep_loss -= raw;
    }
  }

  xp(service, survival) {
    this.add_xp(0, service);
    this.add_xp(2, survival);
  }

  /// Cộng XP cho một kỹ năng (0 Service, 1 Management, 2 Survival, 3 Crafting); mỗi cấp lên được 1 điểm kỹ năng.
  add_xp(skill, amount) {
    if (amount < 1) {
      return;
    }
    if (skill === 2 && this.hp >= 0.9 * this.hp_max && skills.has(this, 'HealthBasedExperienceGainModifier')) {
      amount = trunc(Math.ceil(amount * 1.25));
    }
    const a = level_of(this.xpv[skill])[0];
    this.xpv[skill] += amount;
    // [par-counter B19 / B21] phần nhìn đọc: số nổi "+n XP", banner LEVEL UP
    if (this.xp_feed === undefined) this.xp_feed = [];
    if (this.xp_feed.length < 6) this.xp_feed.push(amount);
    const b = level_of(this.xpv[skill])[0];
    // chỉ để hiện (HUD): biểu tượng cây kỹ năng + "+N XP" giữa trên, "LEVEL UP" khi lên cấp (c01 5:44:53, clip 09 21:28)
    this.xp_pop = [skill, amount, b > a ? 1 : 0, ((this.xp_pop && this.xp_pop[3]) || 0) + 1];
    if (b > a) {
      this.sk.points[skill] += b - a;
      this.say(`${skills.NAMES[skill]} skill reached level ${b + 1}!  +${b - a} skill point  [K] skills`);
      this.play('level', 0.7);
      this.lvl_up = [skill, b + 1];
    }
  }

  has_w(item) {
    return this.weapons.some((w) => w.item === item);
  }
  has_hammer() {
    return this.has_w(HAMMER);
  }
  /// Vũ khí đang cầm (khi `armed`).
  cur_w() {
    if (this.armed) {
      const w = this.weapons[this.wsel];
      return w === undefined ? null : w;
    }
    return null;
  }

  /// Hệ số theo giờ của nhịp khách: mốc 0/6/12/14/18/21 giờ = 0/1/1.5/2/1/0, lấy theo giờ chẵn.
  static tod_mod(hour) {
    const knots = [[0.0, 0.0], [6.0, 1.0], [12.0, 1.5], [14.0, 2.0], [18.0, 1.0], [21.0, 0.0]];
    const h = hour;
    if (hour === 0) {
      return 0.0;
    }
    if (hour >= 21) {
      return 1.0;
    }
    for (let i = 0; i + 1 < knots.length; i++) {
      const w0 = knots[i], w1 = knots[i + 1];
      if (h >= w0[0] && h < w1[0]) {
        return w0[1] + (w1[1] - w0[1]) * (h - w0[0]) / (w1[0] - w0[0]);
      }
    }
    return 1.0;
  }

  roll_interval() {
    const m = Game.tod_mod(trunc(this.hour()));
    if (m <= 0.01) {
      return 1e9;
    }
    const base = (150.0 - ((this.rep + 100.0) / 200.0) * 115.0) / m;
    return base * this.rng.range(0.9, 1.1);
  }

  /// Ví của khách: rút theo bậc, trọng số bậc đổi theo uy tín.
  roll_wallet() {
    const t = clamp(this.rep / 100.0, 0.0, 1.0);
    const tiers = [[2, 15, 1.0, 0.0], [25, 50, 0.75, 0.075], [40, 150, 0.0, 5.0], [100, 500, 0.0, 4.0], [1000, 2500, 0.0, 2.5]];
    const w = tiers.map((x) => x[2] + (x[3] - x[2]) * t);
    const sum = w.reduce((a, b) => a + b, 0);
    let r = this.rng.next() * sum;
    for (let i = 0; i < tiers.length; i++) {
      const x = tiers[i];
      if (r < w[i] || i === tiers.length - 1) {
        return clamp(this.rng.int(x[0], x[1]), 5, 2500);
      }
      r -= w[i];
    }
    return 5;
  }

  /// Điểm của một món với một khách: (1 − 0,05×ratio) × P × A.
  /** [GỐC] Giá x Đủ tiền x (1 - 0,05 x tỉ lệ ví). `bonus` = hệ số giá của kệ: nới trần giá lên max(2,25; (bonus - 1) x 0,5 + 2,25). */
  static score(price, value, pending, wallet, bonus = 1.0) {
    const cap = 0.99 * wallet;
    if (wallet <= 0 || pending + price > cap || price <= 0 || value <= 0) {
      return 0.0;
    }
    const ratio = price / Math.max(value, 1);
    const max_markup = Math.max(2.25, (bonus - 1.0) * 0.5 + 2.25);
    if (ratio > max_markup) {
      return 0.0;
    }
    let p;
    if (ratio >= 1.15) {
      const x = clamp(1.0 - (ratio - 1.15) / (max_markup - 1.15), 0.0, 1.0);
      p = x * x;
    } else {
      const n = (1.15 - ratio) / 1.15;
      const x = (1.0 - Math.exp(-3.0 * n)) * 2.5 + 1.0;
      p = x * x;
    }
    const afford = clamp((pending + price) / Math.max(cap, 1.0), 0.0, 1.0);
    return (1.0 - 0.05 * afford) * p;
  }

  toggle_open() {
    if (this.open) {
      this.open = false;
      this.since_spawn = 0.0;
      this.say('The store is now CLOSED.');
      this.complete('CloseStore'); // gốc CloseStoreQuestController: OnStoreOpenChanged (đóng)
      this.play('switch', 0.6);
      for (const c of this.customers) {
        if (c.state !== 'Queue' && c.state !== 'Leave') {
          c.leave();
        }
      }
      return;
    }
    if (this.raid.active) {
      this.say('You cannot open during a raid.');
      return;
    }
    if (this.hour() >= 19.0) {
      this.say("It wouldn't be wise to open the store this late."); // gốc gameplay_too_late_to_open_warning
      return;
    }
    for (const q of ['EnterShop', 'Trash', 'Sweep', 'Hammer', 'JammedDoor', 'Shelve']) {
      if (!this.is_done(q)) {
        this.say('The store is not ready to be open yet.'); // gốc gameplay_tutorial_incomplete_warning
        this.play('deny', 0.5);
        return;
      }
    }
    this.open = true;
    this.opened_today = true;
    if (this.door.hp > 0.0) {
      this.door.open = true;
    }
    const iv = this.roll_interval();
    this.spawn_interval = iv;
    this.since_spawn = this.ever_opened ? 0.0 : iv - 10.0;
    this.ever_opened = true;
    this.complete('OpenStore');
    this.say('The store is now OPEN.');
    this.play('switch', 0.6);
    this.play('bell', 0.5);
  }

  can_sleep() {
    if (this.raid.active) {
      this.say('Not during a raid!');
      return false;
    }
    if (this.open) {
      this.say('You cannot sleep while the store is open for business.'); // gốc gameplay_cannot_sleep_store_open_warning
      return false;
    }
    // integ: không có luật "chỉ ngủ sau 19:00" (bản gốc không có; FTUE-AUDIT O20) - chủ dự án: luật gốc trước
    return true;
  }

  /// Kết thúc ngày: áp uy tín một lần, dọn khách và zombie, sang ngày mới lúc `wake` giờ.
  end_day(wake_hour, hp_frac) {
    this.complete('Sleep'); // gốc SleepQuestController: BedObject.Slept hoặc TimeManager.DayPassed
    const gain_k = this.rep <= 0.0 ? 2.0 : 2.0 - 1.9 * (this.rep / 100.0);
    let loss_k;
    if (this.rep >= 0.0) {
      loss_k = 2.0;
    } else if (this.rep >= -75.0) {
      loss_k = 2.0 + (this.rep / 75.0);
    } else {
      loss_k = 1.0 - 0.9 * ((-this.rep - 75.0) / 25.0);
    }
    const delta = this.stats.rep_gain * gain_k + this.stats.rep_flat - this.stats.rep_loss * loss_k;
    this.rep = clamp(this.rep + delta, -100.0, 100.0);
    this.stats.rep_delta = delta;
    for (const [k, b] of Object.entries(this.stats.rep_by)) this.stats.rep_parts[k] = b[0] * gain_k - b[1] * loss_k + b[2];
    this.last_stats = this.stats.clone();
    this.stats = new DayStats();
    for (const c of this.customers) {
      c.gone = true;
    }
    for (const z of this.zombies) {
      z.dead = true;
      z.hp = -1.0;
    }
    for (const p of this.props) {
      if (p.kind.k === 'Corpse') {
        p.dead = true;
      }
    }
    this.raid.active = false;
    this.open = false;
    this.opened_today = false;
    this.day += 1;
    this.cy.empty();
    this.minutes = wake_hour * 60.0;
    this.hp = this.hp_max * hp_frac;
    this.player = lay.WAKE.clone();
    this.yaw = lay.WAKE_YAW;
    this.pitch = 0.0;
    if (this.door.hp > 0.0) {
      this.door.open = false;
    }
    this.start_day();
    this.save_request = true;
  }

  start_day() {
    // [par-counter D39] ngủ dậy thì Max HP mất do lấy máu được trả lại
    if (this.blood_cost) { this.hp_max += this.blood_cost; this.blood_cost = 0; }
    // Quà của khách đã được cho thuốc hôm qua (luật gốc: sự kiện MedicalAssistanceGift ngày hôm sau, mỗi lựa chọn 50%).
    const gifts = this.med_gifts;
    this.med_gifts = [];
    for (const given of gifts) {
      const a = this.rng.chance(0.5);
      // Bảng quà gốc: Bandage -> Wine x2 / Beer x5; Painkillers -> Whisky x2 / Wine x5; Antibiotics -> Whisky x3 / Pistol; khác -> Whisky x2.
      let item, n;
      switch (given) {
        case BANDAGE: [item, n] = a ? [WINE, 2] : [BEER, 5]; break;
        case PILLS: [item, n] = a ? [WHISKY, 2] : [WINE, 5]; break;
        case ANTIBIOTICS: [item, n] = a ? [WHISKY, 3] : [PISTOL, 1]; break;
        default: [item, n] = [WHISKY, 2]; break;
      }
      n = n + Math.max(0, trunc(skills.sum(this, 'MedicalAssistanceGift')));
      this.add_prop(PropKind.Crate(new Array(n).fill(item)), lay.DELIVERY2.add(v3(1.1, 0.0, 0.4)), 0.4);
      this.say('A thank-you package from the survivor you treated is outside.');
    }
    // Khách được tha hôm qua quay lại trả nợ: thêm 5–25 pin và +0,1 thiện cảm.
    if (this.forgiven_due) {
      this.forgiven_due = false;
      const extra = this.rng.int(5, 25);
      this.batteries += extra;
      this.stats.other += extra;
      this.add_rep(0.1);
      this.say(`A forgiven customer came back and paid ${extra} batteries.`);
    }
    // Thùng của chuyến nhặt đồ hôm trước tới điểm giao trước cửa.
    if (this.scav_pending.length !== 0) {
      const its = this.scav_pending;
      this.scav_pending = [];
      this.add_prop(PropKind.Crate(its), lay.DELIVERY, 0.2);
    }
    if (this.day === 2) {
      // [ĐỀ XUẤT phiên 7] Bản gốc bắt đầu với 2 kệ và kệ thêm chỉ có bằng chế tạo: tờ công thức "Flimsy Wooden Shelf"
      // (2 Plank, 3 giây, bàn cấp 0) rơi từ một thùng gỗ ở tập 1 (clip 02 39:33), Dual Shelving Unit qua nút kỹ năng
      // Crafting. Bản này trước đây không có đường nào ra tờ công thức kệ mỏng: nay nó nằm trong thùng giao ngày 2.
      this.add_prop(PropKind.Crate([TIN, TIN, BEANS, FRUIT, CLOTH, NAILS, NAILS, WIRING, WIRING, RECIPE_FLIMSY, PLANK, PLANK]), lay.DELIVERY2, -0.3);
    }
    this.scav = [false, false];
    this.sales = [];
    // Chỗ lục đồ có 5% cơ hội đầy lại mỗi sáng.
    const refill = [];
    this.props.forEach((p, i) => {
      if (p.kind.k === 'Cache' && p.kind.c === true) {
        refill.push(i);
      }
    });
    for (const i of refill) {
      if (!orig_rules()) {
        // [ĐỀ XUẤT] Đợt 13: đầy lại SPOT_REFILL mỗi sáng theo bảng của loại chỗ.
        if (this.rng.chance(SPOT_REFILL)) {
          const p = this.props[i], k = p.kind;
          const its = spot_roll(this.rng, spot_table(k.a, p.pos), this.rng.chance(0.4) ? 2 : 1);
          p.kind = PropKind.Cache(k.a, its, false);
          p.dirty = true;
        }
        continue;
      }
      if (this.rng.chance(0.05)) {
        // [GỐC] đầy lại: 1-2 dòng theo trọng số của bảng `refresh.possible`.
        const its = loot_roll(this.rng, this.rng.int(1, 2), false);
        const k = this.props[i].kind;
        if (k.k === 'Cache') {
          this.props[i].kind = PropKind.Cache(k.a, its, false);
          this.props[i].dirty = true;
        }
      }
    }
    this.raid.announced = false;
    build.new_day(this);
  }

  damage_player(dmg) {
    if (this.mode !== 'Play') {
      return;
    }
    this.hp -= dmg;
    this.desk = false; // [par-counter D13] bị đánh thì rời chế độ đứng quầy ([ĐỀ XUẤT]: gốc chưa thấy)
    this.since_hit = 0.0;
    this.hurt_flash = 1.0;
    this.play('hurt', 0.8);
    if (this.hp <= 0.0) {
      this.hp = 0.0;
      // Có diễn viên: xem cảnh gục xuống trước, hết cảnh mới sang màn Dead (player_system).
      if ((this.ff & FF_ACTS) !== 0 && !this.nocine && this.cine === null) {
        this.cine = [cine.DEATH, 0.0];
      } else {
        this.mode = 'Dead';
      }
      this.panel = { k: 'None' };
      this.play('death', 0.8);
    }
  }

  /// Bấm "Wake Up" sau khi gục: mất 10–20% pin, tỉnh ở phòng ngủ 08:30 hôm sau với 50% máu; raid tính là thua.
  wake_up() {
    const lost = trunc(round_half_away(this.batteries * this.rng.range(0.1, 0.2)));
    this.batteries -= lost;
    this.stats.other -= lost;
    if (this.raid.active) {
      combat.raid_lost(this);
    }
    const id = this.held;
    this.held = null;
    if (id !== null) {
      const p = this.prop(id);
      if (p !== null) {
        p.pos = lay.WAKE_DROP.clone();
      }
    }
    this.end_day(8.5, 0.5);
    this.mode = 'Play';
    this.say(`You were beaten unconscious and lost ${lost} batteries.`);
  }

  shelf_free(shelf, near) {
    return this.shelves[shelf].free(near);
  }

  sellable_in_inv() {
    const out = [];
    for (let i = 0; i < N_ITEMS; i++) {
      if (this.inv[i] > 0 && items.sellable(i)) out.push(i);
    }
    return out;
  }
}

/* VIEW NOTES (game.rs)
game.rs draws nothing itself; it is the state the view reads. Fields that drive pictures elsewhere:
- Shelf: pos (foot centre, y=0), yaw (rad, frame: local +x along the shelf body, +z front where customers stand), cols,
  slots (item index or null; slot s -> col s%cols, level trunc(s/cols); slot centre = slot_pos(s): x offset
  (col+0.5-cols/2)*SLOT_W(0.6 m), height 0.5+level*0.5 m). `dirty` = rebuild shelf goods; `ent` = scene node or null.
  Two fixed shelves: x = SHELVES[0][0] / SHELVES[1][0], z = SHELF_Z0 + 3.5*SLOT_W, yaw +PI/2 / -PI/2, 7 cols x 3 levels.
- Prop: kind {k:'Trash'(a=variant 0..2) | 'Pile' | 'Item'(a=item) | 'Box'(a=items) | 'Hammer' | 'Crate'(a=items) |
  'Reward'(a=items) | 'Wire'(a=hp) | 'Corpse'(a=ZKind index, b=looted) | 'Cache'(a=name, b=items, c=searched) |
  'Placed'(a=item)}, pos, yaw, dead (hide/despawn), dirty (rebuild mesh), ent (scene node or null), hp/aux/aux2.
- Customer/Zombie: body = person handle from scene.people.spawn (or null); pose inputs live in actors.js.
- Pay: coins[{value, fake, checked, done 0 counter/1 drawer/2 bin}], sel; g.pay_rev bumps whenever it changes (rebuild coins).
- Screen overlays: hurt_flash (1 -> 0 at 2.5/s, red flash), fade (black, -0.9/s), notice/notice_t (4.5 s line),
  toast/toast_t ("QUEST COMPLETE" card 3.5 s), clock_text(), todo(), hint(), objective() (world marker point or null).
- Mode: 'Title' | 'Play' | 'Summary' | 'Dead'; panel {k:'None'|'Price'(a=item)|'Radio'|...}.
PORT GAPS: none. Rust `Quat` from Shelf.rot() is returned as [x,y,z,w] (q_y). Customer/Zombie/Prop/Coin/Pay/Raid
constructors take an optional field object (`new game.Zombie({seed, kind, pos, ...})`); unit enums are strings with
*_ORDER arrays (Q_ORDER via q_index(q) for `q as usize`); `ZKind::stats(k)` -> `game.ZKind.stats(k)` / `zkind_stats(k)`.
*/
