//! Lưu ván nhiều ô (cờ `saves`): 3 ô trong localStorage (`twtproc.save.v2.<ô>`), mỗi ô giữ thêm bản lưu của đêm trước
//! (`.prev`) để tua lại một bước. Luật gốc (`progression-quests-save.md` mục 4): chỉ lưu lúc ngủ xong; không lưu vị trí,
//! máu, vật đang cầm, zombie và khách đang đi lại; bản gốc giữ vòng 10 bản để tua lại, bản này giữ 2 `[ĐỀ XUẤT]`.
//! Định dạng: mỗi dòng `tên=giá trị`; mỗi hệ thống tự ghi và tự đọc phần của mình (`skills`, `build`, `combat`, `events`, `staff`).
//! Bản lưu v1 (một ô, 14 món) của các bản trước không còn đọc được.
// Port of src/save.rs (see three/PORT-CONTRACT.md). The text format is byte-compatible with the Rust build, so saves
// written by the Bevy client under `twtproc.save.v2.<n>` load here and the other way round.

import { trunc, v3 } from './vec.js';
import { store_del, store_get, store_set } from './web.js';
import * as game from './game.js';
import * as items from './items.js';
import * as skills from './skills.js';
import * as build from './build.js';
import * as combat from './combat.js';
import * as events from './events.js';
import * as staff from './staff.js';
import * as carry from './carry.js';
import * as map from './map.js';
import * as lay from './lay.js';

export const SLOTS = 3;

const f32 = Math.fround;
/** Rust `str::parse::<i32>()`: optional sign, ASCII digits only, in range; else null. */
function parse_i32(s) {
  if (!/^[+-]?[0-9]+$/.test(s)) return null;
  const v = Number(s);
  return v >= -2147483648 && v <= 2147483647 ? v : null;
}
/** Rust `str::parse::<usize>()`: optional '+', ASCII digits only; else null. */
function parse_usize(s) {
  if (!/^\+?[0-9]+$/.test(s)) return null;
  const v = Number(s);
  return v <= 18446744073709551615 ? v : null;
}
/** Rust `i32 as usize` (a negative wraps to a huge number: larger than any index). */
const as_usize = (v) => (v < 0 ? 18446744073709551616 + v : v);
/** Rust float `as i32` (truncate, saturate, NaN -> 0). */
const f2i = (v) => (Number.isNaN(v) ? 0 : Math.max(-2147483648, Math.min(2147483647, trunc(v))));

function key(slot) {
  return `twtproc.save.v2.${slot}`;
}

function nums(v) {
  return v.map((x) => String(x)).join(',');
}

function parse(s) {
  const out = [];
  for (const v of s.split(',')) {
    const x = parse_i32(v);
    if (x !== null) out.push(x);
  }
  return out;
}

function sparse(v, skip) {
  const out = [];
  for (let i = 0; i < v.length; i++) if (!skip(i, v[i])) out.push(`${i}:${v[i]}`);
  return out.join(',');
}

export function save_string(g) {
  const core = [
    g.day,
    g.batteries,
    f2i(f32(f32(g.rep) * 1000.0)),
    g.ever_opened ? 1 : 0,
    g.raid.next_day,
    g.raid.index,
    f2i(g.door.hp),
    g.trash_done,
    g.sweep_done,
    g.caches_done,
    g.total_served,
    g.bed_door_hits,
    g.props.filter((p) => p.kind.k === 'Item' && p.kind.a === game.TIN && !p.dead && !p.loose).length,
    g.rude_spawned ? 1 : 0,
    g.xpv[0],
    g.xpv[1],
    g.xpv[2],
    g.xpv[3],
    g.seen_fake ? 1 : 0,
    g.forgiven_due ? 1 : 0,
    g.stock_sel,
  ];
  const fixed = g.shelves.filter((s) => s.prop === 0);
  const shelf = (s) => s.slots.map((x) => String(x !== null ? x : -1)).join(',');
  const shelfn = (s) => s.counts.map((x) => String(x | 0)).join(',');
  const done = g.done.map((d) => (d ? 1 : 0));
  const caches = [];
  for (const p of g.props) if (p.kind.k === 'Cache') caches.push(p.kind.c ? 1 : 0);
  const gifts = g.med_gifts.map((i) => i);
  const lm = Array.from(g.lm, (v) => v);
  const lmhp = Array.from(g.lm_hp, (v) => f2i(f32(f32(v) * 10.0)));
  const learned = g.learned.map((i) => i);
  return [
    `core=${nums(core)}`,
    `prices=${sparse(g.prices, (i, p) => p === Math.max(items.ival(i), 1))}`,
    `inv=${sparse(g.inv, (_, n) => n === 0)}`,
    // kệ cố định (prop 0): một kệ ván từ phiên 7 (hai kệ với ?shelves=2); kệ dựng thêm lưu trong `build`
    `shelf0=${fixed[0] ? shelf(fixed[0]) : ''}`,
    `shelf1=${fixed[1] ? shelf(fixed[1]) : ''}`,
    `shelfn0=${fixed[0] ? shelfn(fixed[0]) : ''}`,
    `shelfn1=${fixed[1] ? shelfn(fixed[1]) : ''}`,
    `done=${nums(done)}`,
    `caches=${nums(caches)}`,
    `gifts=${nums(gifts)}`,
    `lm=${nums(lm)}`,
    `lmhp=${nums(lmhp)}`,
    `learned=${nums(learned)}`,
    // [phiên 7] món rơi trên sàn (đồ lục văng ra, món thả từ ba lô): món:x*100:z*100
    `floor=${g.props.filter((p) => p.loose && !p.dead && p.kind.k === 'Item').map((p) => `${p.kind.a}:${Math.round(p.pos.x * 100)}:${Math.round(p.pos.z * 100)}`).join(',')}`,
    `skills=${skills.save(g)}`,
    `build=${build.save(g)}`,
    `combat=${combat.save(g)}`,
    `events=${events.save(g)}`,
    `staff=${staff.save(g)}`,
  ].join('\n');
}

/** Ghi ván vào ô đang chơi; bản lưu trước đó thành bản `.prev`. */
export function write(g) {
  const k = key(g.slot);
  const old = store_get(k);
  if (old !== null) {
    store_set(`${k}.prev`, old);
  }
  store_set(k, save_string(g));
  store_set('twtproc.save.v2.last', String(g.slot));
}

/** Rust `str::lines()`: split on '\n', drop one trailing '\r' per line, no final empty line. */
function lines(s) {
  if (s.length === 0) return [];
  const ls = s.split('\n');
  if (s.endsWith('\n')) ls.pop();
  return ls.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

function field(s, name) {
  for (const l of lines(s)) {
    if (l.startsWith(name)) {
      const r = l.slice(name.length);
      if (r.startsWith('=')) return r.slice(1);
    }
  }
  return '';
}

/** Tóm tắt một ô lưu: "Day 5   123 Batteries   reputation 12.3%". -> string or null */
export function summary(slot, prev) {
  const s = store_get(prev ? `${key(slot)}.prev` : key(slot));
  if (s === null) return null;
  const c = parse(field(s, 'core'));
  if (c.length < 18) {
    return null;
  }
  return `Day ${c[0]}   ${c[1]} Batteries   reputation ${items.rfix(f32(f32(c[2]) / 1000.0), 1)}%   skills ${game.level_of(c[14])[0] + 1}/${game.level_of(c[15])[0] + 1}/${game.level_of(c[16])[0] + 1}/${game.level_of(c[17])[0] + 1}`;
}

/** Ô vừa chơi gần nhất còn bản lưu. -> slot or null */
export function last_slot() {
  const v = store_get('twtproc.save.v2.last');
  let last = v !== null ? parse_usize(v) : null;
  if (last !== null && !(last < SLOTS && summary(last, false) !== null)) last = null;
  if (last !== null) return last;
  for (let s = 0; s < SLOTS; s++) if (summary(s, false) !== null) return s;
  return null;
}

/** Ô trống đầu tiên (cho ván mới); đầy cả thì dùng ô đang chọn. */
export function free_slot(sel) {
  for (let s = 0; s < SLOTS; s++) if (summary(s, false) === null) return s;
  return Math.min(sel, SLOTS - 1);
}

export function delete_(slot) {
  store_del(key(slot));
  store_del(`${key(slot)}.prev`);
}
export { delete_ as delete };

/** Nạp ô `slot` (bản đêm trước nếu `prev`). Trả về false nếu ô trống hoặc hỏng. */
export function load(g, slot, prev) {
  const s = store_get(prev ? `${key(slot)}.prev` : key(slot));
  if (s === null) {
    g.say('No saved game in that slot.');
    return false;
  }
  const c = parse(field(s, 'core'));
  if (c.length < 21) {
    return false;
  }
  const N_ITEMS = game.N_ITEMS;
  g.slot = slot;
  g.day = c[0];
  g.batteries = c[1];
  g.rep = f32(f32(c[2]) / 1000.0);
  g.ever_opened = c[3] !== 0;
  g.raid.next_day = c[4];
  g.raid.index = as_usize(c[5]);
  g.door.hp = c[6];
  g.door.open = g.door.hp <= 0.0;
  g.trash_done = c[7];
  g.sweep_done = c[8];
  g.caches_done = c[9];
  g.total_served = c[10];
  g.bed_door_hits = c[11];
  g.rude_spawned = c[13] !== 0;
  g.xpv = [c[14], c[15], c[16], c[17]];
  g.seen_fake = c[18] !== 0;
  g.forgiven_due = c[19] !== 0;
  g.stock_sel = Math.min(as_usize(c[20]), N_ITEMS - 1);
  g.minutes = 7.0 * 60.0;
  const pairs = (name) => {
    const out = [];
    for (const p of field(s, name).split(',')) {
      const k = p.indexOf(':');
      if (k < 0) continue;
      const a = parse_usize(p.slice(0, k)), b = parse_i32(p.slice(k + 1));
      if (a === null || b === null) continue;
      if (a < N_ITEMS) out.push([a, b]);
    }
    return out;
  };
  for (const [i, p] of pairs('prices')) {
    g.prices[i] = Math.max(p, 1);
  }
  g.inv = new Array(N_ITEMS).fill(0);
  for (const [i, n] of pairs('inv')) {
    g.inv[i] = n;
  }
  for (let sh = 0; sh < Math.min(2, g.shelves.filter((x) => x.prop === 0).length); sh++) {
    const vs = parse(field(s, sh === 0 ? 'shelf0' : 'shelf1')).slice(0, g.shelves[sh].slots.length);
    vs.forEach((v, k) => {
      g.shelves[sh].slots[k] = v >= 0 && v < N_ITEMS ? v : null;
      g.shelves[sh].counts[k] = g.shelves[sh].slots[k] === null ? 0 : 1;
    });
    // Bản lưu cũ không có `shelfnN`: mỗi ô 1 món lẻ.
    parse(field(s, sh === 0 ? 'shelfn0' : 'shelfn1')).slice(0, g.shelves[sh].slots.length).forEach((v, k) => {
      if (g.shelves[sh].slots[k] !== null) g.shelves[sh].counts[k] = Math.max(1, v);
    });
    g.shelves[sh].dirty = true;
  }
  parse(field(s, 'done')).slice(0, game.Q_COUNT).forEach((v, k) => {
    g.done[k] = v !== 0;
  });
  g.med_gifts = parse(field(s, 'gifts')).map(as_usize).filter((v) => v < N_ITEMS);
  parse(field(s, 'lm')).slice(0, map.N_LM).forEach((v, k) => {
    g.lm[k] = v & 255;
  });
  parse(field(s, 'lmhp')).slice(0, map.N_LM).forEach((v, k) => {
    g.lm_hp[k] = f32(f32(v) / 10.0);
  });
  g.learned = parse(field(s, 'learned')).map(as_usize).filter((v) => v < N_ITEMS);
  // Dọn các vật của màn mở đầu theo tiến độ đã lưu.
  const cache_state = parse(field(s, 'caches'));
  if (g.day <= 1) {
    carry.restore(g, Math.max(g.trash_done, 0));
  }
  let trash = g.trash_done, piles = g.sweep_done, tins = 14 - c[12], cache_i = 0;
  for (const p of g.props) {
    const kd = p.kind;
    if (kd.k === 'Trash' && trash > 0) {
      trash -= 1;
      p.dead = true;
    } else if (kd.k === 'Pile' && piles > 0) {
      piles -= 1;
      p.dead = true;
    } else if (kd.k === 'Item' && tins > 0 && !p.loose) {
      tins -= 1;
      p.dead = true;
    } else if (kd.k === 'Cache') {
      if ((cache_i < cache_state.length ? cache_state[cache_i] : 0) !== 0) {
        kd.c = true;
        kd.b.length = 0;
      }
      cache_i += 1;
    }
  }
  for (const e of field(s, 'floor').split(',')) {
    const [a, x, z] = e.split(':').map((v) => parse_i32(v));
    if (a === null || a === undefined || x === null || z === null || a < 0 || a >= N_ITEMS) continue;
    g.add_prop({ k: 'Item', a }, v3(x / 100, 0.0, z / 100), 0.0);
    g.props[g.props.length - 1].loose = true;
  }
  combat.load(g, field(s, 'combat'));
  if (g.has_w(game.HAMMER) || g.done[game.Q_ORDER.indexOf('Hammer')]) {
    for (const p of g.props) {
      if (p.kind.k === 'Hammer') {
        p.dead = true;
      }
    }
  }
  skills.load(g, field(s, 'skills'));
  build.load(g, field(s, 'build'));
  events.load(g, field(s, 'events'));
  staff.load(g, field(s, 'staff'));
  g.player = lay.WAKE.clone();
  g.yaw = lay.WAKE_YAW;
  g.armed = false;
  g.say(`Game loaded: day ${g.day}.`);
  return true;
}

/** Bảng chọn ô lưu ở màn tiêu đề. */
export function panel_text(g) {
  let out = 'SAVED GAMES\n\n';
  for (let s = 0; s < SLOTS; s++) {
    const sm = summary(s, false);
    out += `${s === g.slot ? '>' : ' '} Slot ${s + 1}:  ${sm !== null ? sm : '(empty)'}\n`;
    const p = summary(s, true);
    if (p !== null) {
      out += `            previous night:  ${p}\n`;
    }
  }
  out += '\n[W / S] select   [Enter] load   [R] rewind to the previous night\n[N] new game in this slot   [X] delete   [V] back';
  return out;
}

/* VIEW NOTES
   save.rs draws nothing. `panel_text(g)` is the text of the Saved games panel (Panel 'Saves'); `summary(slot, prev)`
   gives one slot line. Storage keys: `twtproc.save.v2.<0..2>`, `twtproc.save.v2.<n>.prev`, `twtproc.save.v2.last`.
   PORT GAPS: `delete` is a JS keyword as a function name, so the function is `delete_` and is also exported under the
   name `delete` (call it as `save.delete(slot)` through the namespace). The f32 casts of the Rust (`rep * 1000`,
   `lm_hp * 10`, `/ 1000`, `/ 10`) are done with Math.fround so the numbers round-trip exactly as in the Rust build.
*/
