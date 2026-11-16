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
  Prop: (id) => ({ k: 'Prop', a: id }),
  /** Trạm trong thế giới (mã ở build.rs). */
  Station: (st) => ({ k: 'Station', a: st }),
  /** Cục pin thứ i khách đặt trên quầy, và nút báo động. */
  Coin: (i) => ({ k: 'Coin', a: i }),
  Alarm: () => ({ k: 'Alarm' }),
};

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
  if (p.kind.k === 'Placed') {
    const item = p.kind.a;
    const bx = build.prop_box(item, p.pos, p.yaw);
    let y0, y1;
    switch (build.footprint(item)[3]) {
      case 1: y0 = 1.1; y1 = 2.0; break;
      case 2: y0 = 2.2; y1 = 2.9; break;
      default: y0 = 0.0; y1 = build.shelf_dims(item) !== null ? 0.28 : 1.1;
    }
    return [v3(bx[0], y0, bx[1]), v3(bx[2], y1, bx[3])];
  }
  let r, h;
  switch (p.kind.k) {
    case 'Trash': r = 0.26; h = 0.42; break;
    case 'Pile': r = 0.48; h = 0.25; break;
    case 'Item': r = 0.16; h = 0.3; break;
    case 'Box': r = 0.32; h = 0.36; break;
    case 'Hammer': r = 0.3; h = 0.2; break;
    case 'Crate': r = 0.42; h = 0.7; break;
    case 'Reward': r = 0.5; h = 0.7; break;
    case 'Wire': r = 0.1; h = 0.1; break;
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
    test(Target.Door(), v(db[0] - 0.2, 0.0, db[1] - 0.95), v(db[0] + 0.02, 2.3, db[1] + 0.1));
    test(Target.Door(), v(db[2] - 0.02, 0.0, db[1] - 0.95), v(db[2] + 0.2, 2.3, db[1] + 0.1));
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
  for (const [st, mn, mx] of build.targets(g)) {
    test(Target.Station(st), mn, mx);
  }
  for (const p of g.props) {
    if (p.dead || g.held === p.id) {
      continue;
    }
    if (p.kind.k === 'Wire' || (p.kind.k === 'Cache' && p.kind.c === true)) continue;
    if (g.cb.projs.some((x) => x[0] === p.id)) {
      continue;
    }
    const [mn, mx] = prop_box(p);
    test(Target.Prop(p.id), mn, mx);
  }
  if (best[0].k === 'Shelf') {
    const s = best[0].a;
    const sh = g.shelves[s];
    const local = rot_neg_y(sh.yaw, best[2].sub(sh.pos));
    const col = clamp(trunc(Math.floor(local.x / lay.SLOT_W + sh.cols * 0.5)), 0, sh.cols - 1);
    const levels = trunc(sh.slots.length / sh.cols);
    const lvl = clamp(trunc(Math.floor((best[2].y - 0.45) / 0.5)), 0, levels - 1);
    best[0] = Target.Shelf(s, lvl * sh.cols + col);
  }
  return [best[0], best[2]];
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

/** Sức chứa hộp các-tông: 8 món x hệ số nút kỹ năng. */
export function box_cap(g) {
  const m = skills.mul(g, 'ContainerCapacityMultiplier');
  return Math.round(8.0 * (m > 0.0 ? m : 1.0));
}
export function prompt_for(g, t) {
  const hk = held_kind(g);
  switch (t.k) {
    case 'None': return '';
    case 'Switch': return g.open ? '[E] Close store' : '[E] Open store';
    case 'Bed': return g.bld.tiers[build.T_BED] < 2 ? '[E] Sleep   [U] Upgrade' : '[E] Sleep';
    case 'Till': {
      if (g.pay !== null) {
        return 'Check each battery on the counter, then put it in the drawer';
      }
      const i = actors.head_customer(g);
      if (i !== null) {
        const goal = g.customers[i].goal;
        switch (goal.k) {
          case 'Sell': return `Wants to sell ${goal.b}x ${items.iname(goal.a)} for ${goal.c} Batteries   [Y] Accept   [N] Decline`;
          case 'Medical': return 'Counter';
          case 'Buy': {
            const total = g.customers[i].basket.reduce((s, x) => s + x[1], 0);
            return `[E] Serve customer (${g.customers[i].basket.length} items, ${total} Batteries)`;
          }
        }
        return 'Counter';
      } else {
        return 'Counter';
      }
    }
    case 'Coin': {
      const i = t.a;
      const c = g.pay !== null && i < g.pay.coins.length ? g.pay.coins[i] : null;
      if (c === null) return '';
      if (!c.checked) {
        return `[E] Check battery (${c.value})   [B] Bin`;
      } else if (c.fake) {
        return `FAKE battery (${c.value})   [B] Bin it   then hit the alarm button`;
      } else {
        return `[E] Put in drawer (${c.value}, good)   [B] Bin`;
      }
    }
    case 'Alarm': {
      const m = g.pay !== null ? [g.pay.alarm, g.pay.coins.some((c) => c.checked && c.fake)] : null;
      if (m !== null && m[0] === 1) return 'The customer pleads   [Y] Forgive   [N] Refuse';
      if (m !== null && m[0] === 0 && m[1] === true) return '[E] Alarm button: confront the customer about the fake';
      return 'Alarm button (for fake batteries)';
    }
    case 'Skip': {
      const n = g.cy.bin.length;
      if (hk !== null && hk.k === 'Trash') return `[E] Throw trash in (${n}/${carry.BIN_CAP})`;
      return `Skip (${n}/${carry.BIN_CAP}) - bring trash here`;
    }
    case 'Door': {
      if (g.door.hp <= 0.0) {
        return '[hold E] Repair door';
      } else if (g.door.hp < game.DOOR_HP) {
        return `[E] ${g.door.open ? 'Close' : 'Open'} door   [hold E] Repair (${g.door.hp.toFixed(0)}/250)`;
      } else if (g.door.open) {
        return '[E] Close door';
      } else {
        return '[E] Open door';
      }
    }
    case 'BedDoor': return g.has_hammer() ? 'Jammed door - hit it with the hammer [LMB]' : 'Jammed door - find a hammer';
    case 'Radio': return '[E] Radio';
    case 'Station': return build.prompt(g, t.a);
    case 'Shelf': {
      const s = t.a, slot = t.b;
      let out = '';
      const it0 = g.shelves[s].slots[slot];
      if (it0 !== null) {
        const nu = g.shelves[s].units(slot);
        const cnt = game.stack_max() > 1 ? ` x${nu}/${game.stack_max()}` : '';
        out = `${items.iname(it0)}${cnt} - ${g.prices[it0]} Batteries each   [Q] Set price   [RMB] Take`;
      }
      let src = null;
      if (hk !== null && hk.k === 'Box') src = hk.a.length > 0 ? hk.a[hk.a.length - 1] : null;
      else if (hk === null && g.inv[g.stock_sel] > 0 && items.sellable(g.stock_sel)) src = g.stock_sel;
      if (src !== null) {
        if (out.length !== 0) {
          out += '\n';
        }
        out += `[E] Place ${items.iname(src)}`;
      }
      if (out.length === 0) {
        out = 'Shelf (empty)';
      }
      if (g.shelves[s].prop !== 0) {
        out += '   [hold V] Pick up shelf';
      }
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
          if (hk !== null && hk.k === 'Box') return `[E] Put ${items.iname(kd.a)} in box`;
          return `[E] Take ${items.iname(kd.a)}`;
        case 'Box': return `[E] Pick up cardboard box (${kd.a.length}/${box_cap(g)})`;
        case 'Hammer': return '[E] Equip hammer';
        case 'Crate': return '[hold E] Open package';
        case 'Reward': return '[hold E] Open supply drop';
        case 'Corpse':
          if (kd.b === false) return '[hold E] Search';
          return g.on(game.FF_CORPSES) ? '[E] Drag corpse (to a dumpster or the shredder)' : '';
        case 'Cache': return `[hold E] Search ${kd.a.toLowerCase()}`;
        case 'Wire': return '';
        case 'Placed': {
          const item = kd.a;
          const name = items.iname(item);
          switch (item) {
            case game.TURRET: return `[E] Man the turret (ammo ${p.aux.toFixed(0)})   [hold V] Pick up`;
            case game.AUTO_MINIGUN: return `Auto Minigun (ammo ${p.aux.toFixed(0)})   [E] Load 556 Ammo   [hold V] Pick up`;
            case game.TV: return '[E] Watch TV   [hold V] Pick up';
            case game.SPIKE_WALL:
            case game.BEAR_TRAP: return `${name} (${p.hp.toFixed(0)}/300)   [hold V] Pick up`;
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
  if (t.k === 'Door' && g.door.hp < game.DOOR_HP) return 3.5;
  if (t.k === 'Station') return build.hold_time(g, t.a);
  if (t.k === 'Prop') {
    const p = g.props.find((p) => p.id === t.a);
    const kd = p === undefined ? null : p.kind;
    if (kd !== null && (kd.k === 'Crate' || kd.k === 'Reward')) return 1.5;
    if (kd !== null && kd.k === 'Corpse' && kd.b === false) return 2.0 / loot;
    if (kd !== null && kd.k === 'Cache') return 7.5 / loot;
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
    ids.push(g.add_prop(game.PropKind.Item(it), v3(pos.x, 0.0, pos.z), a));
  });
  if (g.loot_events === undefined) g.loot_events = [];
  if (g.loot_events.length < 16) g.loot_events.push({ id: src_id, name: name || '', pos: at.clone(), items: got.slice(), drops: ids });
  return [...cnt].map(([it, c]) => `${c}x ${items.iname(it)}`).join(', ');
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
        case 'Reward': {
          p.dead = true;
          const s = items.give(g, kd.a);
          g.complete('OpenPackage');
          g.play('loot', 0.7);
          g.say(`Received: ${s}`);
          break;
        }
        case 'Corpse': {
          if (kd.b !== false) break;
          p.kind = { k: 'Corpse', a: kd.a, b: true };
          // Đồ trên xác zombie ban ngày (luật gốc): pin 80% x 0..10; rồi theo thứ tự xáo trộn Metal Scrap 0,33, Worn Cloth 0,4
          // (1-2), Beer 0,1 (1-2), Gunpowder 0,4, mỗi lần trúng làm giảm cơ hội các món sau; nút RareLoot thêm Knife, 9mm, Pistol.
          const n = g.rng.chance(0.8) ? g.rng.int(0, 10) : 0;
          g.batteries += n;
          g.stats.other += n;
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
            s = drop_loot(g, p.id, p.pos, kd.b.slice(), kd.a);
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
        g.say('FAKE battery! Bin it [B]. Hit the alarm button to confront the customer.');
      } else {
        g.play('click', 0.6);
      }
    } else if (c.fake) {
      g.play('deny', 0.6);
      g.say('The drawer refuses a fake battery. Bin it [B].');
    } else {
      c.done = 1;
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
      g.say('The customer pleads for forgiveness.  [Y] forgive   [N] refuse');
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
    case 'Till': actors.serve(g); break;
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
      if (hk !== null && hk.k === 'Box') src = hk.a.length > 0 ? hk.a[hk.a.length - 1] : null;
      else if (hk === null && g.inv[g.stock_sel] > 0 && items.sellable(g.stock_sel)) src = g.stock_sel;
      const it = src;
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
      if (g.held !== null && hk !== null && hk.k === 'Box') {
        const p = g.prop(g.held);
        if (p !== null) {
          if (p.kind.k === 'Box') {
            p.kind.a.pop();
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
      const cap = box_cap(g);
      const drag = g.on(game.FF_CORPSES);
      const p = g.prop(id);
      if (p === null) return;
      const kd = clone_kind(p.kind);
      if (kd.k === 'Corpse' && kd.b === true && !drag) {
        // nothing
      } else if (kd.k === 'Trash' || kd.k === 'Box' || (kd.k === 'Corpse' && kd.b === true)) {
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
        p.dead = true;
        let boxed = false;
        if (g.held !== null) {
          const bx = g.prop(g.held);
          if (bx !== null) {
            if (bx.kind.k === 'Box') {
              if (bx.kind.a.length < cap) {
                bx.kind.a.push(it);
                bx.dirty = true;
                boxed = true;
              }
            }
          }
        }
        if (boxed) {
          g.complete('FillBox');
        } else {
          items.give(g, [it]);
          g.say(`Took ${items.iname(it)}.`);
        }
        g.play('pick', 0.5);
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
        const news = events.tv_news(g);
        g.play('radio', 0.5);
        g.say(news);
      }
      break;
    }
    case 'None': break;
  }
}

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
    if (smp !== null && !((enter || click) && t > 0.4) && g.mode === 'Play') {
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
    if (g.panel.k !== 'None') {
      g.panel = { k: 'None' };
    } else {
      cursor.unlock();
    }
  }

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
  if (playing && g.panel.k === 'None' && mounted === null) {
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
    g.complete('EnterShop');
  }
  const bob = v3(Math.cos(feel.bob * 1.85) * 0.013, Math.abs(Math.sin(feel.bob * 3.7)) * 0.024, 0.0);
  const eye = mounted !== null ? mounted.add(Y.mul(1.5)).sub(flat_f.mul(0.35)) : g.player.add(Y.mul(EYE - 0.5 * g.fx2.crouch));
  // Hình vũ khí cầm tay: dựng lại hai lưới khi đổi món; tư thế, giật, nạp đạn, đung đưa do fp.rs tính bằng lò xo.
  g.swing = Math.max(g.swing - dt, 0.0);
  const cw = g.cur_w();
  const wcur = cw !== null ? cw.item : g.cb.throw_item;
  const free = g.bld.ghost === null && mounted === null && playing;
  // Tay bận (xách rác, ôm hộp, kéo xác, cầm chổi): carry.rs vẽ; không thì vũ khí của fp.rs.
  carry.tick(g, playing ? dt : 0.0, eye, rot, flat_f, flat_r);
  const ckey = free ? carry.vm_key(g) : null;
  const cur = ckey !== null ? ckey : wcur;
  const show = free && (ckey !== null || (wcur !== null && g.held === null));
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
  const gun_held = ckey === null && wcur !== null && wcur < data.INFO.length && items.gun(wcur) !== null;
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
    crouch: playing && g.panel.k === 'None' && keys.pressed('ControlLeft'),
    wall_d,
    inspect: gun_held && playing && g.panel.k === 'None' && keys.just_pressed('KeyT'),
    bash: gun_held && playing && g.panel.k === 'None' && keys.just_pressed('KeyZ'),
  };
  if (pose_in.bash) {
    g.play('swing', 0.45);
  }
  let [t_main, t_off, view, shake] = fp.pose(g, pose_in);
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

  const [target, _hit] = find_target(g, eye, fwd);
  // Phần nhìn (plug/loot.js) sáng viền chỗ lục đang nhắm.
  g.look_id = target.k === 'Prop' ? target.a : 0;
  g.prompt = prompt_for(g, target);
  if ((g.prompt.length === 0 || g.prompt === 'Counter') && actors.medical_near(g) !== null) {
    g.prompt = '[Y] Give medicine   [N] Send away';
  }
  if (g.prompt.length === 0 || g.prompt === 'Counter') {
    const i = staff.candidate_near(g);
    if (i !== null) {
      g.prompt = `[H] Hire ${g.staff[i].name} (free, wage ${g.staff[i].wage}/day)   [N] Send away`;
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
    case 'Help':
      if (keys.just_pressed('Tab') || keys.just_pressed('KeyL') || keys.just_pressed('Enter')) {
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
    case 'Craft': {
      const n = g.craft_tab === 0 ? craft.recipes(g).length : craft.shreddable(g).length;
      if (keys.just_pressed('KeyS') || keys.just_pressed('ArrowDown')) {
        g.craft_sel = Math.min(g.craft_sel + 1, Math.max(0, n - 1));
      }
      if (keys.just_pressed('KeyW') || keys.just_pressed('ArrowUp')) {
        g.craft_sel = Math.max(0, g.craft_sel - 1);
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
      if (keys.just_pressed('KeyJ') || keys.just_pressed('Enter') || keys.just_pressed('KeyE')) {
        g.panel = { k: 'None' };
      }
      return;
    }
    case 'Settings': {
      if (keys.just_pressed('KeyG')) {
        quality.tier = (quality.tier + 1) % 3;
        quality.auto = false;
      }
      if (keys.just_pressed('BracketLeft')) {
        g.sens = Math.max(g.sens - 0.1, 0.3);
      }
      if (keys.just_pressed('BracketRight')) {
        g.sens = Math.min(g.sens + 0.1, 3.0);
      }
      if (keys.just_pressed('Minus') || keys.just_pressed('Equal')) {
        const d = keys.just_pressed('Minus') ? -0.1 : 0.1;
        g.volume = clamp(g.volume + d, 0.0, 1.0);
        audio.set_volume(g.volume);
        g.play('click', 0.6);
      }
      if (keys.just_pressed('KeyI')) {
        g.invert = !g.invert;
      }
      if (keys.just_pressed('KeyP') || keys.just_pressed('Enter')) {
        g.panel = { k: 'None' };
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

  // Chế độ xây: vật đang đặt đi theo trước mặt, R xoay 45 độ, giữ E cố định, X huỷ.
  if (g.bld.ghost !== null) {
    const [item, yaw] = g.bld.ghost;
    const pos = g.player.add(flat_f.mul(2.0));
    g.bld.ghost_pos = v3(pos.x, 0.0, pos.z);
    g.bld.ghost_ok = build.valid(g, item, g.bld.ghost_pos, yaw);
    if (keys.just_pressed('KeyR')) {
      g.bld.ghost = [item, yaw + Math.PI / 4];
      g.play('click', 0.3);
    }
    if (keys.just_pressed('KeyX')) {
      g.bld.ghost = null;
      g.inv[item] += 1;
      g.play('drop', 0.4);
      return;
    }
    const need = 3.0 * build.build_speed(g);
    if (!g.bld.ghost_ok) {
      g.bld.secure_t = 0.0;
      g.prompt = `Cannot place ${items.iname(item)} here   [R] rotate   [X] cancel`;
    } else if (keys.pressed('KeyE')) {
      g.bld.secure_t += dt;
      g.prompt = `Securing ${items.iname(item)}...  ${(g.bld.secure_t / need * 100.0).toFixed(0)}%`;
      if (g.bld.secure_t >= need) {
        build.secure(g);
      }
    } else {
      g.bld.secure_t = 0.0;
      g.prompt = `[hold E] Secure ${items.iname(item)}   [R] rotate   [X] cancel`;
    }
    return;
  }

  if (keys.just_pressed('Tab')) {
    g.panel = { k: 'Bag' };
  }
  if (keys.just_pressed('KeyL')) {
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
  if ((g.ff & game.FF_STAFF) !== 0 && keys.just_pressed('KeyH')) {
    const i = staff.candidate_near(g);
    if (i !== null) {
      staff.hire(g, i);
    }
  }
  if (keys.just_pressed('KeyO') && (game.Game.in_shop(g.player) || g.player.distance(lay.DOOR) < 4.0)) {
    g.toggle_open();
  }
  for (const [k, n] of [['Digit1', 1], ['Digit2', 2], ['Digit3', 3], ['Digit4', 4]]) {
    if (keys.just_pressed(k)) {
      combat.select(g, n);
    }
  }
  const cw2 = g.cur_w();
  const gun_in_hand = cw2 !== null && items.gun(cw2.item) !== null;
  if (keys.just_pressed('KeyR') && !gun_in_hand) {
    const list = g.sellable_in_inv();
    if (list.length !== 0) {
      const at = list.indexOf(g.stock_sel);
      const pos = at >= 0 ? (at + 1) % list.length : 0;
      g.stock_sel = list[pos];
      g.play('click', 0.3);
    }
  }
  if (keys.just_pressed('KeyF')) {
    // Dùng đồ hồi máu yếu nhất đang có.
    const it = [game.BANDAGE, game.PILLS, game.ANTIBIOTICS, game.FIRSTAID].find((i) => g.inv[i] > 0);
    if (it !== undefined) items.use_heal(g, it);
    else g.say('No healing items.');
  }
  if (keys.just_pressed('KeyU')) {
    switch (target.k) {
      case 'Station': build.upgrade_key(g, target.a); break;
      case 'Bed': build.bed_upgrade(g); break;
      default: break;
    }
  }
  if ((keys.just_pressed('KeyX') || keys.just_pressed('KeyG')) && g.held !== null) {
    const id = g.held;
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
  // Dựng nhanh dây thép gai: giữ B 2 giây, tốn 2 Wiring + 2 Nails [ĐỀ XUẤT] (bản gốc chế ở bàn cấp 2 rồi dựng).
  const on_coin = target.k === 'Coin';
  if (keys.pressed('KeyB') && !on_coin) {
    if (g.inv[game.WIRING] >= 2 && g.inv[game.NAILS] >= 2) {
      feel.build_t += dt;
      g.prompt = `Building barbed wire... ${(feel.build_t / 2.0 * 100.0).toFixed(0)}%`;
      if (feel.build_t >= 2.0) {
        feel.build_t = 0.0;
        g.inv[game.WIRING] -= 2;
        g.inv[game.NAILS] -= 2;
        const spot = g.player.add(flat_f.mul(1.6));
        g.add_prop({ k: 'Wire', a: 300.0 }, v3(spot.x, 0.0, spot.z), g.yaw);
        g.play('place', 0.8);
        g.say('Barbed wire placed.');
      }
    } else if (keys.just_pressed('KeyB')) {
      g.say('Barbed wire needs 2 Wiring and 2 Nails.');
    }
  } else {
    feel.build_t = 0.0;
  }
  if (keys.just_pressed('KeyB') && target.k === 'Coin') {
    const i = target.a;
    const c = g.pay !== null && i < g.pay.coins.length ? g.pay.coins[i] : null;
    if (c !== null) {
      c.done = 2;
      g.pay_rev += 1;
      g.play('trash', 0.5);
    }
  }
  // Giữ V: gỡ vật dựng đang nhắm về ba lô.
  let placed_id = null;
  if (target.k === 'Prop' && g.props.some((p) => p.id === target.a && p.kind.k === 'Placed')) placed_id = target.a;
  // Kệ do người chơi dựng: nhắm vào ô nào của kệ cũng gỡ được.
  else if (target.k === 'Shelf' && g.shelves[target.a].prop !== 0) placed_id = g.shelves[target.a].prop;
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
  if (keys.just_pressed('KeyQ')) {
    if (target.k === 'Shelf') {
      const it = g.shelves[target.a].slots[target.b];
      if (it !== null) {
        g.panel = { k: 'Price', a: it };
      } else if (g.inv[g.stock_sel] > 0) {
        g.panel = { k: 'Price', a: g.stock_sel };
      }
    }
  }
  if (mouse.just_pressed('Right')) {
    if (target.k === 'Shelf') {
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
  // Khách bị bắt trả pin giả đang xin tha: Y / N.
  const pleading = g.pay !== null && g.pay.alarm === 1;
  if (keys.just_pressed('KeyY')) {
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
  if (keys.just_pressed('KeyN')) {
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
  if (click && g.panel.k === 'None') {
    const hk = held_kind(g);
    if (hk !== null && hk.k === 'Trash') {
      carry.start_toss(g, target.k === 'Skip');
    }
  }
  // Giữ E trên đống bẩn: cầm chổi quét, bẩn mờ dần; nhả ra thì phần đã quét vẫn giữ.
  if (target.k === 'Prop' && keys.pressed('KeyE') && g.held === null) {
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
  if (keys.pressed('KeyE') && need > 0.0 && tid !== 0) {
    if (g.hold_id !== tid) {
      g.hold_id = tid;
      g.hold_t = 0.0;
    }
    g.hold_t += dt;
    if (g.hold_t >= need) {
      g.hold_t = 0.0;
      g.hold_id = 0;
      finish_hold(g, target);
    }
  } else {
    if (keys.just_released('KeyE') && g.hold_id !== 0 && g.hold_t < 0.3 && target.k === 'Door') {
      press_e(g, target);
    }
    g.hold_t = 0.0;
    g.hold_id = 0;
  }
  if (keys.just_pressed('KeyE') && (need === 0.0 || (target.k === 'Door' && g.door.hp >= game.DOOR_HP))) {
    press_e(g, target);
  }
  if (need > 0.0 && g.hold_t > 0.0) {
    g.prompt = `${g.prompt}  ${(g.hold_t / need * 100.0).toFixed(0)}%`;
  }

  // Vũ khí: cận chiến, súng, đồ ném.
  const inp = {
    click,
    down: mouse.pressed('Left'),
    released: mouse.just_released('Left'),
    reload: keys.just_pressed('KeyR') && gun_in_hand,
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
  broom); an empty part becomes a 1 cm black cube at (0,-5,0). Visible only while `show` (playing, no build ghost, not
  on a turret, and either carrying something or holding a weapon with empty hands). Material: 'solid'. They should draw
  on top of the world (Bevy drew them in the same pass with near 0.06; the view may use a separate viewmodel pass).
- Cursor: ctx.cursor.lock() on left click when unlocked and !feel.nolock; unlock() after 0.6 s of lost pointer lock or Esc
  with no panel open.
PORT GAPS: Bevy `cursor.visible` is folded into ctx.cursor.lock()/unlock(). Rust `{:.0}` formatting rounds ties to even,
  JS toFixed(0) rounds half up (contract says toFixed). fp.pose / carry.pose Transforms are read as
  {translation, rotation, scale} (falling back to {pos, quat, scale}).
*/
