//! Chế tạo và máy nghiền (cờ `craft`). Luật theo `~/twt-bevy/docs/rules/crafting-building.md` mục 1, 2, 4, 5;
//! số liệu 229 món và 40 công thức lấy từ danh mục luật bản gốc (`src/catalog.rs`, sinh bằng tools/gen_catalog.py).
//! - Bàn chế tạo là vật thể trong nhà kho (`lay::WORKBENCH`), mở bằng E; máy nghiền ở cuối kho (`lay::SHREDDER`).
//! - Một công thức làm được khi có nguyên liệu, ĐÃ MỞ (nút kỹ năng Crafting hoặc đã học tờ công thức, 5 giây), và cấp bàn đủ.
//!   Bàn lên cấp 2 / 3 bằng nâng cấp (`build.rs`): PipeWrench + 2 thùng chứa; NailGun + Sawblade + 4 Hardwood Log + 4 Plank.
//! - Số lần làm được = min(floor(đang có / cần)); một việc mỗi lúc; hàng chờ nhiều lần (A / D chọn số lần); thời gian =
//!   `BaseCraftingTime x 0,75^(số nút tốc độ)` giây thật; nguyên liệu chỉ bị trừ lúc XONG; huỷ thì không mất gì.
//! - Xong: mỗi đơn vị nguyên liệu có `Resourcefulness` (0,33 khi có nút) cơ hội không bị trừ; `StartQuantity` món, gấp đôi với
//!   xác suất 0,25 khi có nút; XP chế tạo; cứ 5 lần liên tiếp cùng một món thì +250 XP khi có nút.
//! - Máy nghiền: phải sửa bằng 96 Sawblade; mỗi lần tháo một món ra danh sách `dismantle`, mỗi dòng gấp đôi với xác suất
//!   0,10 / 0,20 theo nút; nghiền xác ra Good Meat + Bone (`combat.rs`).
//! `[ĐỀ XUẤT]`: nguyên liệu lấy từ ba lô (bản gốc lấy đồ đặt trong hộp cạnh bàn); thành phẩm vào thẳng ba lô.

import { trunc, clamp } from './vec.js';
import * as catalog from './catalog.js';
import * as data from './data.js';
import * as game from './game.js';
import * as items from './items.js';
import * as skills from './skills.js';
import * as build from './build.js';

const f32 = Math.fround;
const sat1 = (n) => Math.max(0, n - 1);

export function have(g, ci) {
  return g.inv[ci];
}

export function add(g, ci, n) {
  if (n > 0) {
    items.give_n(g, ci, n);
  } else {
    g.inv[ci] = Math.max(g.inv[ci] + n, 0);
  }
}

export function name(ci) {
  return items.iname(ci);
}

/// Công thức của món `ci` đã mở chưa (nút kỹ năng hoặc tờ công thức đã học).
export function known(g, ci) {
  return g.learned.includes(ci) || skills.recipe_unlocked(g, ci);
}

/// Học tờ công thức `recipe_item` (món loại Recipe): mở công thức của món nó dạy.
export function learn(g, recipe_item) {
  const u = data.INFO[recipe_item].usage;
  if (u.k !== 'Recipe') return false;
  const teaches = u.a;
  if (known(g, teaches)) {
    g.say(`You already know how to make ${name(teaches)}.`);
    return false;
  }
  g.learned.push(teaches);
  g.play('quest', 0.6);
  g.say(`Recipe learned: ${name(teaches)}. Craft it at the bench in the warehouse.`);
  return true;
}

export function bench_level(g) {
  return g.bld.tiers[build.T_BENCH];
}

/// Mọi món có công thức, theo thứ tự danh mục (đã mở và đủ cấp bàn đứng trước).
export function recipes(g) {
  const CAT = catalog.CAT;
  const v = [];
  for (let i = 0; i < catalog.N_CAT; i++) {
    const c = CAT[i].craft;
    if (c !== null && c !== undefined && c.mats.length !== 0) v.push(i);
  }
  // sort_by_key(!usable): ổn định, món dùng được (false) đứng trước.
  const key = new Map(v.map((i) => [i, usable(g, i) ? 0 : 1]));
  v.sort((a, b) => key.get(a) - key.get(b));
  return v;
}

export function usable(g, ci) {
  const c = catalog.CAT[ci].craft;
  return c !== null && c !== undefined && c.mats.length !== 0 && c.bench <= bench_level(g) && known(g, ci);
}

/// [par-panels] Tab loại của bảng chế tạo gốc (op/06-craft): ALL, Ammo, Throwable, Defence, Gun, Medicine, Melee, Shop, Survival.
/// Mỗi tab = các `ty` của danh mục gốc (0 Ammo .. 13 Tool). Chọn tab chỉ dời `craft_sel` tới công thức đầu của loại đó
/// (danh sách `recipes` và phím W / S giữ nguyên thứ tự cũ).
export const CATS = [['ALL', null], ['Ammo', [0]], ['Throwable', [12]], ['Defence', [4]], ['Gun', [6]], ['Medicine', [7]], ['Melee', [8, 13]], ['Shop', [10, 1, 3]], ['Survival', [11, 2, 5, 9]]];
export function in_cat(g, ci) {
  const c = g.craft_cat || 0;
  return c === 0 || CATS[c][1].includes(catalog.CAT[ci].ty);
}
export function cat_step(g, d) {
  g.craft_tab = 0;
  g.craft_cat = ((g.craft_cat || 0) + d + CATS.length) % CATS.length;
  cat_first(g);
}
/// W / S trong một tab loại: bỏ qua công thức ngoài loại (tab ALL: không đổi gì).
export function cat_skip(g, d) {
  if ((g.craft_cat || 0) === 0) return;
  const list = recipes(g);
  let k = g.craft_sel;
  while (k >= 0 && k < list.length && !in_cat(g, list[k])) k += d;
  if (k >= 0 && k < list.length) g.craft_sel = k;
  else { k = g.craft_sel - d; while (k >= 0 && k < list.length && !in_cat(g, list[k])) k -= d; if (k >= 0 && k < list.length) g.craft_sel = k; }
}
export function cat_first(g) {
  if ((g.craft_cat || 0) === 0) return;
  const k = recipes(g).findIndex((ci) => in_cat(g, ci));
  if (k >= 0) g.craft_sel = k;
}

/// Món đang có mà tháo ra được.
export function shreddable(g) {
  const v = [];
  for (let i = 0; i < catalog.N_CAT; i++) {
    if (catalog.CAT[i].dis.length !== 0 && have(g, i) > 0) v.push(i);
  }
  return v;
}

export function count(g, ci) {
  const c = catalog.CAT[ci].craft;
  if (c === null || c === undefined) return 0;
  const xs = c.mats.filter((m) => m[1] > 0).map((m) => trunc(have(g, m[0]) / m[1]));
  const mn = xs.length > 0 ? Math.min(...xs) : 1;
  return Math.max(mn, 0);
}

export function secs(g, ci) {
  const m = skills.mul(g, 'CraftingSpeedMultiplier');
  const c = catalog.CAT[ci].craft;
  return f32((c !== null && c !== undefined ? c.secs : 1.0) * (m > 0.0 ? m : 1.0));
}

/// Enter trong bảng: bắt đầu chế tạo công thức đang chọn (kèm hàng chờ), hoặc tháo món đang chọn.
export function act(g) {
  if (g.craft_tab === 0) {
    const list = recipes(g);
    const idx = Math.min(g.craft_sel, sat1(list.length));
    if (idx >= list.length) return;
    const ci = list[idx];
    const c = catalog.CAT[ci].craft;
    if (g.craft_job !== null) {
      g.play('deny', 0.5);
      g.say('The bench is busy. [X] cancels the current job.');
    } else if (!known(g, ci)) {
      g.play('deny', 0.5);
      g.say(`${name(ci)} is locked: learn its recipe (a recipe sheet, or a Crafting skill node [K]).`);
    } else if (c.bench > bench_level(g)) {
      g.play('deny', 0.5);
      g.say(`${name(ci)} needs a level ${c.bench + 1} bench. Upgrade the bench in build mode [B].`);
    } else if (count(g, ci) < 1) {
      g.play('deny', 0.5);
      g.say(`Missing materials for ${name(ci)}.`);
    } else {
      g.craft_queue = clamp(g.craft_plan, 1, count(g, ci)) - 1;
      g.craft_job = [ci, 0.0];
      g.play('click', 0.6);
    }
  } else {
    if (g.bld.tiers[build.T_SHREDDER] === 0) {
      g.play('deny', 0.5);
      g.say('The shredder is broken. Repair it with 96 Sawblade.');
      return;
    }
    const list = shreddable(g);
    const idx = Math.min(g.craft_sel, sat1(list.length));
    if (idx >= list.length) return;
    const ci = list[idx];
    add(g, ci, -1);
    const extra = skills.sum(g, 'DismantleExtraItemChance');
    const got = [];
    for (const [it, n0] of catalog.CAT[ci].dis) {
      const n = n0 * (g.rng.next() < extra ? 2 : 1);
      add(g, it, n);
      got.push(`${n}x ${name(it)}`);
    }
    g.play('break', 0.5);
    g.say(`Shredded ${name(ci)} into ${got.join(', ')}.`);
  }
}

/// Tiến độ việc chế tạo theo giây thật; xong thì trừ nguyên liệu, giao hàng, chạy tiếp hàng chờ.
export function tick(g, dt) {
  if (g.craft_job === null) return;
  const [ci, t0] = g.craft_job;
  const c = catalog.CAT[ci].craft;
  const t = f32(t0 + dt);
  if (t < secs(g, ci)) {
    g.craft_job = [ci, t];
    return;
  }
  g.craft_job = null;
  if (count(g, ci) < 1) {
    g.craft_queue = 0;
    g.say(`Crafting ${name(ci)} failed: materials are gone.`);
    return;
  }
  const save = skills.sum(g, 'CraftingResourceSaveMultiplier');
  for (const [it, n] of c.mats) {
    let use_n = n;
    if (save > 0.0) {
      for (let k = 0; k < n; k++) {
        if (g.rng.next() <= save) {
          use_n -= 1;
        }
      }
    }
    add(g, it, -use_n);
  }
  const qty = c.qty * (g.rng.next() < skills.sum(g, 'CraftingDoubleChance') ? 2 : 1);
  add(g, ci, qty);
  g.crafted_n = (g.crafted_n || 0) + 1; // [FTUE A2] CraftItem / CraftItems x10 (gốc CraftingPlayerState.CraftedItem)
  g.add_xp(3, c.xp);
  if (skills.has(g, 'CraftSameItemBonus')) {
    g.sk.same_craft = g.sk.same_craft[0] === ci ? [ci, g.sk.same_craft[1] + 1] : [ci, 1];
    if (g.sk.same_craft[1] % 5 === 0) {
      g.add_xp(3, 250);
    }
  }
  g.play('quest', 0.5);
  g.say(`Crafted ${qty}x ${name(ci)}. (+${c.xp} crafting XP)`);
  if (g.craft_queue > 0 && count(g, ci) > 0) {
    g.craft_queue -= 1;
    g.craft_job = [ci, 0.0];
  } else {
    g.craft_queue = 0;
  }
}

/** icons::Cards::default() (icons.rs is not ported; Cards is a plain object with the Rust field names). */
function new_cards() {
  return { head: '', tabs: [], cards: [], sel: 0, det_icon: null, det_title: '', det: '', foot: '' };
}

/// Bàn chế tạo / máy nghiền dạng lưới thẻ: mỗi công thức một thẻ mang hình món làm ra, khung chi tiết liệt kê nguyên liệu.
export function cards(g) {
  const CAT = catalog.CAT;
  const c = new_cards();
  c.tabs = [['Hammer', 'Bench', g.craft_tab === 0], ['Gear', 'Shredder', g.craft_tab !== 0]];
  if (g.craft_tab === 0) {
    const list = recipes(g);
    c.sel = Math.min(g.craft_sel, sat1(list.length));
    const [lvl, x, need] = game.level_of(g.xpv[3]);
    c.head = `CRAFTING BENCH  (level ${bench_level(g) + 1})      Crafting level ${lvl + 1} (${x}/${need} XP)`;
    const ready = (ci) => CAT[ci].craft.mats.every((m) => have(g, m[0]) >= m[1]);
    c.cards = list.map((ci) => {
      const r = CAT[ci].craft;
      let sub, state;
      if (!known(g, ci)) {
        sub = 'LOCKED';
        state = 1;
      } else if (r.bench > bench_level(g)) {
        sub = 'BENCH+';
        state = 1;
      } else {
        sub = `${r.qty}x   ${secs(g, ci).toFixed(0)}s`;
        state = ready(ci) ? 2 : 0;
      }
      return { icon: { k: 'Item', a: ci }, name: name(ci), sub, state };
    });
    if (c.sel < list.length) {
      const ci = list[c.sel];
      const r = CAT[ci].craft;
      c.det_icon = { k: 'Item', a: ci };
      c.det_title = name(ci);
      const st = !known(g, ci) ? 'LOCKED: needs a recipe sheet or a Crafting skill node.\n\n' : r.bench > bench_level(g) ? 'BENCH+: needs a bench upgrade (build mode [B]).\n\n' : '';
      c.det = `${st}Makes ${r.qty}x in ${secs(g, ci).toFixed(0)}s\n\nNeeds:\n${r.mats.map((m) => `${name(m[0])}  ${have(g, m[0])}/${m[1]}`).join('\n')}`;
    }
    if (g.craft_job !== null) {
      const [ci, t] = g.craft_job;
      c.foot = `Crafting ${name(ci)}...  ${Math.min((t / secs(g, ci)) * 100.0, 100.0).toFixed(0)}%   queued ${g.craft_queue}   [X] cancel\n[Tab] shredder list    [E] close`;
    } else {
      c.foot = `[W / S] previous / next    [A / D] times: ${Math.max(g.craft_plan, 1)}    [Enter] craft    [Tab] shredder list    [E] close`;
    }
  } else {
    const list = shreddable(g);
    c.sel = Math.min(g.craft_sel, sat1(list.length));
    c.head = g.bld.tiers[build.T_SHREDDER] === 0 ? 'SHREDDER      BROKEN: repair it with 96 Sawblade (build mode [B], aim at the shredder)' : 'SHREDDER';
    c.cards = list.map((ci) => ({ icon: { k: 'Item', a: ci }, name: name(ci), sub: `x${have(g, ci)}`, state: 0 }));
    if (c.sel < list.length) {
      const ci = list[c.sel];
      c.det_icon = { k: 'Item', a: ci };
      c.det_title = name(ci);
      c.det = `Shreds into:\n${CAT[ci].dis.map((d) => `${d[1]}x ${name(d[0])}`).join('\n')}`;
    } else {
      c.det_title = 'Nothing you carry can be shredded';
    }
    c.foot = '[W / S] previous / next    [Enter] shred one    [Tab] bench list    [E] close';
  }
  return c;
}

export function panel_text(g) {
  const CAT = catalog.CAT;
  let out = '';
  if (g.craft_tab === 0) {
    const list = recipes(g);
    const sel = Math.min(g.craft_sel, sat1(list.length));
    const [lvl, x, need] = game.level_of(g.xpv[3]);
    out += `CRAFTING BENCH  (level ${bench_level(g) + 1})     Crafting level ${lvl + 1} (${x}/${need} XP)\n\n`;
    // Cửa sổ 12 dòng quanh dòng đang chọn.
    const from = Math.min(Math.max(0, sel - 5), Math.max(0, list.length - 12));
    for (let k = from; k < Math.min(list.length, from + 12); k++) {
      const ci = list[k];
      const c = CAT[ci].craft;
      const mats = c.mats.map((m) => `${name(m[0])} ${have(g, m[0])}/${m[1]}`).join(', ');
      const state = !known(g, ci) ? 'LOCKED ' : c.bench > bench_level(g) ? 'BENCH+ ' : '       ';
      out += `${k === sel ? '>' : ' '} ${state}${c.qty}x ${name(ci).padEnd(20)} ${secs(g, ci).toFixed(0).padStart(3)}s  ${mats}\n`;
    }
    if (g.craft_job !== null) {
      const [ci, t] = g.craft_job;
      out += `\nCrafting ${name(ci)}...  ${Math.min((t / secs(g, ci)) * 100.0, 100.0).toFixed(0)}%   queued ${g.craft_queue}   [X] cancel`;
    } else {
      out += `\n[W / S] select   [A / D] times: ${Math.max(g.craft_plan, 1)}   [Enter] craft`;
    }
    out += '\nLOCKED: needs a recipe sheet or a Crafting skill node.  BENCH+: needs a bench upgrade (build mode [B]).\n[Tab] shredder list   [E] close';
  } else {
    const list = shreddable(g);
    const sel = Math.min(g.craft_sel, sat1(list.length));
    out += 'SHREDDER\n\n';
    if (g.bld.tiers[build.T_SHREDDER] === 0) {
      out += 'BROKEN: repair it with 96 Sawblade (build mode [B], aim at the shredder).\n\n';
    }
    if (list.length === 0) {
      out += 'Nothing you carry can be shredded.\n';
    }
    const from = Math.min(Math.max(0, sel - 5), Math.max(0, list.length - 12));
    for (let k = from; k < Math.min(list.length, from + 12); k++) {
      const ci = list[k];
      const outs = CAT[ci].dis.map((d) => `${d[1]}x ${name(d[0])}`).join(', ');
      out += `${k === sel ? '>' : ' '} ${name(ci).padEnd(22)} x${String(have(g, ci)).padEnd(3)} ->  ${outs}\n`;
    }
    out += '\n[W / S] select   [Enter] shred one\n[Tab] bench list   [E] close';
  }
  return out;
}

/// Cho bot: danh sách tên của tab đang mở, dòng đang chọn, việc đang chạy, cấp bàn, các công thức đã mở.
function export_(g) {
  const list = g.craft_tab === 0 ? recipes(g) : shreddable(g);
  const names = list.map((i) => `"${name(i)}"`).join(',');
  const job = g.craft_job !== null ? `["${name(g.craft_job[0])}",${g.craft_job[1].toFixed(1)}]` : 'null';
  let usable_n = 0;
  for (let i = 0; i < catalog.N_CAT; i++) if (usable(g, i)) usable_n++;
  return `{"tab":${g.craft_tab},"sel":${g.craft_sel},"list":[${names}],"job":${job},"queue":${g.craft_queue},"plan":${g.craft_plan},"bench":${bench_level(g)},"usable":${usable_n},"learned":[${g.learned.map((i) => `"${name(i)}"`).join(',')}],"xp":${g.xpv[3]}}`;
}
// `export` is a reserved word in JS: exported under the Rust name through an alias (`craft.export(g)`).
export { export_ as export };

/* VIEW NOTES (craft.js)
 * No 3D drawing here. The bench (lay::WORKBENCH) and shredder (lay::SHREDDER) are world props drawn elsewhere.
 * Panel {k:'Craft'} (hud.rs) shows `cards(g)` (card grid) or `panel_text(g)` (monospace text).
 * Cards object (icons.rs not ported): { head, tabs: [['Hammer','Bench',on], ['Gear','Shredder',on]], cards:
 *   [{icon:{k:'Item',a:ci}, name, sub, state}], sel, det_icon, det_title, det, foot }. state: 0 normal, 1 dim (LOCKED /
 *   BENCH+), 2 good (materials ready). A running job is `g.craft_job = [ci, seconds]`; progress % = t / secs(g, ci).
 * Sounds: deny, click, break (shred), quest (craft done / recipe learned).
 * PORT GAPS: icons.rs Cards/Icon represented as plain objects; `export` exported via alias (implemented as export_).
 */
