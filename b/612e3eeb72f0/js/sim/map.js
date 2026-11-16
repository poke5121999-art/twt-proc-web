// Port of src/map.rs (transliterated; see three/PORT-CONTRACT.md).
//! World Map (cờ `map`): 29 landmark của bản gốc, luật mở khoá, việc ngoài bản đồ của nhân viên, cửa hàng, rào chắn, dịch vụ.
//! Nguồn: `~/twt-bevy/docs/rules/world-events.md` mục 1..4 và `staff.md` mục 3.4; số liệu ở `data::LMD` (sinh từ danh mục luật).
//! - Lúc đầu tới được Outer City Depots, Exit Tunnel và City Gates. Mở một rào chắn thì các landmark nối với nó tới được.
//!   City Gates: 125 pin. Rào zombie: nhân viên đánh tới khi máu về 0. Rào tài nguyên: nộp đủ vật liệu từ ba lô.
//! - Giao việc tốn `ceil(hệ số kỹ năng x (lương + phí landmark))`.
//! - Scavenge: thời gian đi `RoundToInt(1,5 x hệ số kỹ năng x clamp(T - (cấp Scavenger x 10 - 10); 0,1 T; 1,5 T))` phút game; hết
//!   thời gian thì mỗi phút 5% tìm thấy đồ: MỘT dòng (món x số lượng) rút theo trọng số trong các dòng đủ điều kiện, số lượng
//!   `ceil(hệ số kỹ năng x Random(min, max))`; nhân viên mang hộp về điểm giao. Sang ngày mà chưa xong thì hộp tới qua đêm.
//! - Shop: chọn hàng vào giỏ rồi cử nhân viên (`lương + tổng giỏ`); đi `1,5 x T` phút rồi mang hộp về.
//! - Combat: đi T phút rồi đánh, việc kéo qua nhiều ngày. Mỗi phút game: `rS = clamp(sức đánh / độ nguy hiểm; 0,25; 5)`,
//!   bầy mất `rS x 0,1` máu, nhân viên mất `(0,5 / rS) x 1,25` máu. Bầy chết thì mở rào, có hộp thưởng và raid của bầy đó
//!   được xếp lịch sau 4 ngày.
//! `[ĐỀ XUẤT]`: sức đánh của nhân viên = cấp Security (bản gốc cộng sức mạnh vũ khí đang cầm, chưa có ô đồ cho nhân viên);
//! bảng bản đồ vẽ các điểm theo toạ độ gốc nhưng không vẽ đường nối và sương mù; món ưa thích của nhân viên chưa có.

import { clamp, trunc } from './vec.js';
import * as data from './data.js';
import * as game from './game.js';
import * as items from './items.js';
import * as staff from './staff.js';
import * as skills from './skills.js';
import * as craft from './craft.js';
import * as combat from './combat.js';
import * as events from './events.js';
import * as lay from './lay.js';

export const SCAV = 0;
export const SHOP = 1;
export const GATE = 2;
export const COMBAT = 3;
export const RESOURCE = 4;
export const MISSION = 5;
export const SERVICE = 6;

/// Landmark { name, key (khoá trong `data::LMD`), kind, cost, travel,
/// parent (rào chắn phải mở trước: -1 có sẵn từ đầu, -2 không có đường tới trong bản gốc), hp }
export function lm(name, key, kind, cost, travel, parent, hp) {
  return Object.freeze({ name, key, kind, cost, travel, parent, hp });
}

export const N_LM = 29;
export const LANDMARKS = Object.freeze([
  lm('Outer City Depots', 'OuterCityDepots', SCAV, 2, 150, -1, 0),
  lm('Exit Tunnel', 'ExitTunnel', SCAV, 3, 160, -1, 0),
  lm('City Gates', 'CityGates', GATE, 125, 0, -1, 0),
  lm('Toolshed', 'Toolshed', SHOP, 0, 180, 2, 0),
  lm('Hunting Store', 'HuntingStore', SCAV, 10, 205, 2, 0),
  lm('Zombie Horde', 'ZombieHorde', COMBAT, 25, 145, 2, 250),
  lm('Hospital', 'Hospital', SCAV, 30, 210, 5, 0),
  lm('Supermarket', 'Supermarket', SCAV, 25, 215, 5, 0),
  lm('Broken Bridge', 'BrokenBridge', RESOURCE, 0, 0, 5, 0),
  lm('Brute Horde', 'BruteHorde', COMBAT, 50, 230, 5, 400),
  lm('Demolition Crew', 'DemolitionCrew', SERVICE, 1000, 0, 8, 0),
  lm('Garage', 'Garage', SCAV, 75, 230, 8, 0),
  lm('Junkyard', 'Junkyard', SCAV, 40, 240, 8, 0),
  lm('Birther Horde', 'BirtherZombieHorde', COMBAT, 75, 260, 8, 500),
  lm('Florist', 'Florist', SHOP, 0, 235, 9, 0),
  lm('Jewellers', 'Jewellers', SCAV, 150, 240, 9, 0),
  lm('Arcade', 'Arcade', SCAV, 50, 245, 9, 0),
  lm('Twins Boss Horde', 'TwinsBossZombieHorde', COMBAT, 100, 250, 9, 500),
  lm('Drop Dead Docks', 'DropDeadDocks', MISSION, 0, 0, 17, 0),
  lm('Crashed Ship', 'CrashedShip', SCAV, 200, 300, 17, 0),
  lm('Church', 'Church', SHOP, 0, 300, 13, 0),
  lm('Mobile News Crew', 'MobileNewsCrew', SERVICE, 0, 0, 13, 0),
  lm('Sweaty Horde', 'SweatyZombieHorde', COMBAT, 200, 340, 13, 500),
  lm('Diner Barricade', 'DinerResource', RESOURCE, 0, 0, 13, 0),
  lm('Quarantine Zone', 'QuarantineZone', SCAV, 250, 350, 22, 0),
  lm('Trailer Park', 'TrailerPark', SCAV, 250, 210, 22, 0),
  lm('Diner', 'DinerShop', SHOP, 0, 360, 23, 0),
  lm('Nuclear Plant', 'NuclearPlant', SCAV, 50, 150, -2, 0),
  lm('Car Salesman', 'CarSalesman', SHOP, 0, 170, -2, 0),
]);

/// Số liệu gốc của landmark `i`.
export function lmd(i) {
  const d = data.LMD.find((d) => d.key === LANDMARKS[i].key);
  if (d === undefined) throw new Error('landmark data');
  return d;
}

/// Đổi chỉ số landmark trong danh mục gốc sang chỉ số ở bảng này.
export function from_ron(r) {
  const key = data.LMD[Math.min(r, data.LMD.length - 1)].key;
  const p = LANDMARKS.findIndex((l) => l.key === key);
  return p < 0 ? 0 : p;
}

/// Trạng thái landmark: 0 chưa tới được, 1 tới được, 2 rào chắn đã mở.
export function initial() {
  const s = new Array(N_LM).fill(0);
  LANDMARKS.forEach((l, i) => {
    if (l.parent === -1) {
      s[i] = 1;
    }
  });
  return s;
}

export function initial_hp() {
  const h = new Array(N_LM).fill(0.0);
  LANDMARKS.forEach((l, i) => {
    h[i] = l.hp;
  });
  return h;
}

/// Mở rào chắn `i`: các landmark nối với nó thành tới được.
export function unlock(g, i) {
  g.lm[i] = 2;
  const names = [];
  LANDMARKS.forEach((l, k) => {
    if (l.parent === i && g.lm[k] === 0) {
      g.lm[k] = 1;
      names.push(l.name);
    }
  });
  g.play('quest', 0.6);
  g.say(`${LANDMARKS[i].name} is open. New on the map: ${names.join(', ')}.`);
  // Hạ một bầy thì raid của bầy đó được xếp lịch (Brute, Birther, Twins, Sweaty).
  let def;
  switch (i) {
    case 9: def = 1; break;
    case 13: def = 0; break;
    case 17: def = 4; break;
    case 22: def = 3; break;
    default: def = null;
  }
  if (def !== null) {
    combat.queue_raid(g, def);
  }
}

/// Các landmark đang hiện trên bản đồ (tới được hoặc đã mở), theo thứ tự bảng.
export function visible(g) {
  const v = [];
  for (let i = 0; i < N_LM; i++) if (g.lm[i] > 0) v.push(i);
  return v;
}

export function free_staff(g) {
  const i = g.staff.findIndex((s) => s.hired && !s.gone && !s.away && s.job < staff.JOB_SCAVENGE);
  return i < 0 ? null : i;
}

export function need_staff(g) {
  const s = free_staff(g);
  if (s === null) {
    g.play('deny', 0.5);
    g.say(g.staff.some((s) => s.hired && !s.gone) ? 'All your staff are out or busy on the map.' : 'You need a hired staff member to send out. Candidates come by from day 3.');
  }
  return s;
}

/// Các dòng đồ nhặt đủ điều kiện ở landmark `i`: (món, ít nhất, nhiều nhất, trọng số).
export function loot_rows(g, i) {
  return lmd(i)
    .loot.filter((e) => e[3] > 0.0 && (e[4] < 0 || g.lm[from_ron(e[4])] === 2) && (e[5] < 0 || !craft.known(g, e[5])))
    .map((e) => [e[0], e[1], e[2], e[3]]);
}

/// Enter trên landmark đang chọn.
export function act(g) {
  const vis = visible(g);
  const k = Math.min(g.lm_sel, Math.max(0, vis.length - 1));
  if (k >= vis.length) return;
  const i = vis[k];
  const l = LANDMARKS[i];
  switch (l.kind) {
    case GATE: {
      if (g.lm[i] === 2) {
        g.say('The gates are already open.');
      } else if (g.batteries < l.cost) {
        g.play('deny', 0.5);
        g.say(`The gatekeepers want ${l.cost} batteries.`);
      } else {
        g.batteries -= l.cost;
        g.stats.outgoings += l.cost;
        unlock(g, i);
      }
      break;
    }
    case SCAV:
    case COMBAT: {
      if (l.kind === COMBAT && g.lm[i] === 2) {
        g.say('That horde is already beaten.');
        return;
      }
      const si = need_staff(g);
      if (si === null) return;
      const cost = staff.job_cost(g, g.staff[si].wage + l.cost);
      if (g.batteries < cost) {
        g.play('deny', 0.5);
        g.say(`Not enough batteries: this trip costs ${cost}.`);
        return;
      }
      g.batteries -= cost;
      g.stats.outgoings += cost;
      const job = l.kind === SCAV ? staff.JOB_SCAVENGE : staff.JOB_COMBAT;
      const lvl = g.staff[si].levels[0];
      const tm = skills.mul(g, 'WorldStaffJobTravelTimeMultiplier');
      const t = l.travel;
      // Rust f32::round (nửa ra xa 0); giá trị ở đây luôn dương.
      const trip = job === staff.JOB_SCAVENGE ? Math.round(1.5 * (tm > 0.0 ? tm : 1.0) * clamp(t - (lvl * 10.0 - 10.0), t * 0.1, t * 1.5)) : t;
      staff.send_out(g, si, job, i, trip, []);
      g.play('pay', 0.5);
      g.say(`${g.staff[si].name} heads out to ${l.name} (${cost} batteries, about ${trip.toFixed(0)} game minutes).`);
      break;
    }
    case RESOURCE: {
      if (g.lm[i] === 2) {
        g.say('That barricade is already cleared.');
        return;
      }
      const req = lmd(i).req;
      if (req.some(([it, n]) => g.inv[it] < n)) {
        g.play('deny', 0.5);
        g.say(`${l.name} needs: ${req.map(([it, n]) => `${n}x ${items.iname(it)} (${g.inv[it]} carried)`).join(', ')}.`);
        return;
      }
      for (const [it, n] of req) {
        g.inv[it] -= n;
      }
      unlock(g, i);
      break;
    }
    case SHOP: events.open(g, { k: 'Shop', a: i }); break;
    case MISSION: events.open(g, { k: 'Docks' }); break;
    default: events.open(g, i === 10 ? { k: 'Demolition' } : { k: 'News' });
  }
}

/// Cử nhân viên đi mua giỏ hàng đang chọn ở cửa hàng `lm`.
export function send_shopper(g, lm) {
  const si = need_staff(g);
  if (si === null) return;
  const total = g.ev.basket.reduce((a, b) => a + b[1] * b[2], 0);
  const cost = staff.job_cost(g, g.staff[si].wage + total);
  if (g.batteries < cost) {
    g.play('deny', 0.5);
    g.say(`Not enough batteries: basket + wage is ${cost}.`);
    return;
  }
  g.batteries -= cost;
  g.stats.outgoings += cost;
  const cargo = [];
  const basket = g.ev.basket;
  g.ev.basket = [];
  for (const [it, n] of basket) {
    for (let c = 0; c < n; c++) cargo.push(it);
    const s = g.ev.shops.find((s) => s[0] === lm && s[1] === it);
    if (s !== undefined) {
      s[3] -= n;
    }
  }
  g.ev.shops = g.ev.shops.filter((s) => s[3] > 0);
  const tm = skills.mul(g, 'WorldStaffJobTravelTimeMultiplier');
  const trip = Math.round(1.5 * (tm > 0.0 ? tm : 1.0) * LANDMARKS[lm].travel);
  staff.send_out(g, si, staff.JOB_SHOP, lm, trip, cargo);
  g.panel = { k: 'None' };
  g.play('pay', 0.5);
  g.say(`${g.staff[si].name} goes shopping at ${LANDMARKS[lm].name} (${cost} batteries, about ${trip.toFixed(0)} game minutes).`);
}

export function scavenge_pick(g, i, early) {
  const rows = loot_rows(g, i);
  if (rows.length === 0) {
    return [game.TIN, 1];
  }
  const total = rows.reduce((a, e) => a + e[3], 0);
  let r = g.rng.next() * total;
  let pick = rows[rows.length - 1];
  for (const e of rows) {
    if (r < e[3]) {
      pick = e;
      break;
    }
    r -= e[3];
  }
  let n = clamp(g.rng.int(pick[1], pick[2]), pick[1], pick[2]);
  if (early) {
    const m = skills.mul(g, 'ScavengeItemQuantityMultiplier');
    n = trunc(Math.ceil(n * (m > 0.0 ? m : 1.0)));
  }
  return [pick[0], n];
}

/// Một phút game của nhân viên `si` đang ở ngoài bản đồ. Trả về true khi chuyến đi đã xong (nhân viên về tới).
export function trip_minute(g, si) {
  const job = g.staff[si].job, i = g.staff[si].dest;
  const l = LANDMARKS[i];
  if (g.staff[si].trip >= 1.0) {
    g.staff[si].trip -= 1.0;
    return false;
  }
  switch (job) {
    case staff.JOB_SCAVENGE: {
      if (!g.rng.chance(0.05)) {
        return false;
      }
      const [item, n] = scavenge_pick(g, i, true);
      deliver(g, new Array(Math.max(0, n)).fill(item));
      g.say(`${g.staff[si].name} has delivered a package outside the store! (${n}x ${items.iname(item)} from ${l.name})`);
      return true;
    }
    case staff.JOB_SHOP: {
      const cargo = g.staff[si].cargo;
      g.staff[si].cargo = [];
      deliver(g, cargo);
      g.say(`${g.staff[si].name} is back from ${l.name} with your order. The package is outside the store.`);
      return true;
    }
    default: {
      const danger = Math.max(lmd(i).danger_value, 0.1);
      const cm = skills.mul(g, 'StaffCombatPowerMultiplier');
      const prof = Math.max(g.staff[si].levels[1], 1.0) * (cm > 0.0 ? cm : 1.0);
      const rs = clamp(prof / danger, 0.25, 5.0);
      g.lm_hp[i] = Math.max(g.lm_hp[i] - rs * 0.1, 0.0);
      g.staff[si].hp -= (0.5 / rs) * 1.25;
      if (g.lm_hp[i] <= 0.0) {
        const its = [];
        for (const [it, n] of lmd(i).rewards) for (let c = 0; c < n; c++) its.push(it);
        deliver(g, its);
        unlock(g, i);
        return true;
      }
      if (g.staff[si].hp <= 0.0) {
        const name = g.staff[si].name;
        g.staff[si].gone = true;
        g.play('death', 0.6);
        g.say(`${name} was killed fighting the ${l.name}.`);
      }
      return false;
    }
  }
}

/// Đặt một hộp đồ ở điểm giao trước cửa (gộp vào hộp đang nằm đó nếu có).
export function deliver(g, its) {
  if (its.length === 0) {
    return;
  }
  const spot = lay.DELIVERY;
  const f = g.props.find((p) => !p.dead && p.kind.k === 'Crate' && p.pos.distance(spot) < 0.3);
  const id = f === undefined ? null : f.id;
  const p = id === null ? null : g.prop(id);
  if (p !== null) {
    if (p.kind.k === 'Crate') {
      p.kind.a.push(...its);
    }
  } else {
    g.add_prop({ k: 'Crate', a: its }, spot.clone(), 0.2);
  }
  g.play('drop', 0.6);
}

/// Sang ngày: chuyến Scavenge / Shop chưa xong thì hoàn tất qua đêm (hộp ở điểm giao); chuyến Combat tiếp tục.
export function overnight(g, si) {
  const job = g.staff[si].job, i = g.staff[si].dest;
  switch (job) {
    case staff.JOB_SCAVENGE: {
      const [item, n] = scavenge_pick(g, i, false);
      for (let c = 0; c < n; c++) g.scav_pending.push(item);
      g.say(`Scavenged at ${LANDMARKS[i].name}: ${n}x ${items.iname(item)}. The box is at the delivery point.`);
      g.staff[si].job = staff.JOB_NONE;
      break;
    }
    case staff.JOB_SHOP: {
      const cargo = g.staff[si].cargo;
      g.staff[si].cargo = [];
      g.scav_pending.push(...cargo);
      g.staff[si].job = staff.JOB_NONE;
      break;
    }
    default:
      break;
  }
}

function trip_note(s) {
  return `${s.name}: ${staff.JOB_NAMES[s.job]} at ${LANDMARKS[s.dest].name}${s.trip >= 1.0 ? `, ${s.trip.toFixed(0)} min to go` : ''}`;
}

export function panel_text(g) {
  const vis = visible(g);
  const sel = Math.min(g.lm_sel, Math.max(0, vis.length - 1));
  let out = `WORLD MAP   (${vis.length} of ${N_LM} landmarks known)        batteries: ${g.batteries}\n\n`;
  const from = Math.min(Math.max(0, sel - 7), Math.max(0, vis.length - 15));
  for (let k = from; k < Math.min(vis.length, from + 15); k++) {
    const i = vis[k];
    const l = LANDMARKS[i];
    let info;
    switch (l.kind) {
      case SCAV: info = `Scavenge   ${l.cost} Batteries + wage   ${l.travel} min`; break;
      case GATE: info = g.lm[i] === 2 ? 'Gate   OPEN' : `Gate   pay ${l.cost} Batteries`; break;
      case COMBAT: info = g.lm[i] === 2 ? 'Horde   BEATEN' : `Horde   HP ${g.lm_hp[i].toFixed(0)}/${l.hp}   ${l.cost} Batteries + wage`; break;
      case RESOURCE: info = g.lm[i] === 2 ? 'Barricade   CLEARED' : 'Barricade   needs materials'; break;
      case SHOP: info = `Shop   ${l.travel} min`; break;
      case MISSION: info = 'Sales contracts'; break;
      default: info = i === 10 ? 'Service   store expansion' : 'Service   advertising';
    }
    out += `${k === sel ? '>' : ' '} ${l.name.padEnd(18)} ${info}\n`;
  }
  if (sel < vis.length) {
    const i = vis[sel];
    const l = LANDMARKS[i];
    out += '\n';
    switch (l.kind) {
      case SCAV: {
        const rows = loot_rows(g, i);
        const total = Math.max(rows.reduce((a, e) => a + e[3], 0), 0.001);
        out += 'Finds (one line per trip): ';
        out += rows.map((e) => `${items.iname(e[0])} ${e[1]}-${e[2]} (${(e[3] / total * 100.0).toFixed(0)}%)`).join(', ');
        break;
      }
      case COMBAT:
        out += `Danger ${lmd(i).danger_value.toFixed(2)}. Reward: ${lmd(i).rewards.map(([it, n]) => `${n}x ${items.iname(it)}`).join(', ')}.`;
        break;
      case RESOURCE:
        out += `Needs: ${lmd(i).req.map(([it, n]) => `${n}x ${items.iname(it)} (${g.inv[it]} carried)`).join(', ')}.`;
        break;
      default:
        break;
    }
    out += '\n';
  }
  for (const s of g.staff.filter((s) => s.hired && !s.gone && s.job >= staff.JOB_SCAVENGE)) {
    out += `\n${trip_note(s)}`;
  }
  out += '\n[W / S] select   [Enter] go / open   [M] close';
  return out;
}

/// World Map dạng lưới thẻ: mỗi landmark một nút hình thoi theo loại, khung chi tiết bên phải.
/// icons::Cards / Card / Icon / G (icons.rs không nằm trong danh sách port): Cards là object thường với đúng tên trường Rust,
/// Icon::Node(g) -> {k:'Node', a:'<G>'}, G là chuỗi tên biến thể.
export function cards(g) {
  const vis = visible(g);
  const sel = Math.min(g.lm_sel, Math.max(0, vis.length - 1));
  const glyph = (i) => {
    switch (LANDMARKS[i].kind) {
      case SCAV: return 'Crate';
      case GATE: return 'Gate';
      case COMBAT: return 'Skull';
      case RESOURCE: return 'Planks';
      case SHOP: return 'Shop';
      case MISSION: return 'Anchor';
      default: return i === 10 ? 'Hammer' : 'Megaphone';
    }
  };
  const cs = vis.map((i) => {
    const l = LANDMARKS[i];
    const done = g.lm[i] === 2;
    let sub, state;
    switch (l.kind) {
      case SCAV: [sub, state] = [`Scavenge  ${l.cost} B`, 0]; break;
      case GATE: [sub, state] = done ? ['OPEN', 2] : [`Toll  ${l.cost} B`, 3]; break;
      case COMBAT: [sub, state] = done ? ['BEATEN', 2] : [`Horde  ${g.lm_hp[i].toFixed(0)}/${l.hp}`, 3]; break;
      case RESOURCE: [sub, state] = done ? ['CLEARED', 2] : ['Barricade', 3]; break;
      case SHOP: [sub, state] = ['Shop', 0]; break;
      case MISSION: [sub, state] = ['Contracts', 0]; break;
      default: [sub, state] = ['Service', 0];
    }
    return { icon: { k: 'Node', a: glyph(i) }, name: l.name, sub, state };
  });
  const c = { head: '', tabs: [], cards: cs, sel, det_icon: null, det_title: '', det: '', foot: '' };
  c.head = `WORLD MAP      ${vis.length} of ${N_LM} landmarks known      Batteries ${g.batteries}`;
  if (sel < vis.length) {
    const i = vis[sel];
    const l = LANDMARKS[i];
    c.det_icon = { k: 'Node', a: glyph(i) };
    c.det_title = l.name.toUpperCase();
    switch (l.kind) {
      case SCAV: {
        const rows = loot_rows(g, i);
        const total = Math.max(rows.reduce((a, e) => a + e[3], 0), 0.001);
        c.det = `Scavenge: ${l.cost} Batteries + wage\nTravel: ${l.travel} min\n\nFinds (one line per trip):\n${rows.slice(0, 9).map((e) => `${items.iname(e[0])} ${e[1]}-${e[2]} (${(e[3] / total * 100.0).toFixed(0)}%)`).join('\n')}`;
        break;
      }
      case GATE: c.det = g.lm[i] === 2 ? 'Gate: OPEN' : `Gate: pay ${l.cost} Batteries to open the road.`; break;
      case COMBAT:
        c.det = g.lm[i] === 2 ? 'Horde: BEATEN' : `Horde HP ${g.lm_hp[i].toFixed(0)}/${l.hp}\n${l.cost} Batteries + wage\nTravel: ${l.travel} min\nDanger ${lmd(i).danger_value.toFixed(2)}\n\nReward:\n${lmd(i).rewards.map(([it, n]) => `${n}x ${items.iname(it)}`).join('\n')}`;
        break;
      case RESOURCE:
        c.det = g.lm[i] === 2 ? 'Barricade: CLEARED' : `Barricade needs:\n${lmd(i).req.map(([it, n]) => `${n}x ${items.iname(it)} (${g.inv[it]} carried)`).join('\n')}`;
        break;
      case SHOP: c.det = `Shop\nTravel: ${l.travel} min each way.\nSend a staff member with a basket.`; break;
      case MISSION: c.det = 'Sales contracts.'; break;
      default: c.det = i === 10 ? 'Service: store expansion.' : 'Service: advertising.';
    }
    for (const s of g.staff.filter((s) => s.hired && !s.gone && s.job >= staff.JOB_SCAVENGE)) {
      c.det += `\n\n${trip_note(s)}`;
    }
  }
  c.foot = '[W / S] previous / next    [Enter] go / open    [M] close';
  return c;
}

/// Vị trí chuẩn hoá (0..1) của landmark trên bản đồ vẽ.
export function map_xy(i) {
  const d = lmd(i);
  return [clamp((d.x + 250.0) / 280.0, 0.0, 1.0), clamp((d.z + 195.0) / 335.0, 0.0, 1.0)];
}

/* VIEW NOTES (map.js)
map.rs draws nothing in 3D. The World Map is a UI panel: `panel_text(g)` (plain text) or `cards(g)` (card grid:
  { head, tabs: [], cards: [{ icon: {k:'Node', a: G}, name, sub, state }], sel, det_icon, det_title, det, foot };
  state 0 normal, 1 dim, 2 good (green, done), 3 warning). G glyph names: Crate (scavenge), Gate, Skull (horde),
  Planks (barricade), Shop, Anchor (docks), Hammer (Demolition Crew), Megaphone (News Crew), drawn inside a diamond.
  `map_xy(i)` -> [u, v] in 0..1 places landmark i on a drawn map (from data LMD x/z). Selection: g.lm_sel over visible(g).
Crates from trips appear through game props (PropKind Crate at lay.DELIVERY, yaw 0.2), drawn by whoever draws props.
PORT GAPS: icons.rs is not in the port list, so Cards/Card/Icon are plain objects with the Rust field names
  (Icon::Node(G::Crate) -> {k:'Node', a:'Crate'}, Cards::default fields filled explicitly).
Rust `{:.0}` rounds ties to even, JS toFixed(0) rounds the decimal value half up: lm_hp / trip / percentage text may
  differ by 1 on exact .5 values (display only).
*/
