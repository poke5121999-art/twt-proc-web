//! Cây kỹ năng (cờ `skills`): 4 cây, 139 nút của bản gốc (`data::NODES`, sinh từ danh mục luật).
//! Luật (`~/twt-bevy/docs/rules/progression-quests-save.md` mục 1, 2): mỗi cấp kỹ năng lên được 1 điểm; mở một nút tốn 1 điểm;
//! nút mở được khi là nút khởi đầu hoặc có ít nhất một trong 8 nút kề đã mở. Giá trị: cộng dồn (`sum`) hoặc nhân dồn (`mul`).
//! Bảng [K]: A / D đổi cây, W / S chọn nút, Enter mở.
//! `[ĐỀ XUẤT]`: bảng là danh sách chữ (bản gốc vẽ lưới nút); nút "orphan" không có đường tới nên không mở được, như bản gốc.

import * as data from './data.js';
import * as game from './game.js';
import * as items from './items.js';

const f32 = Math.fround;
const sat1 = (n) => Math.max(0, n - 1);

export const NAMES = ['Service', 'Management', 'Survival', 'Crafting'];

export class State {
  constructor() {
    this.points = [0, 0, 0, 0];
    this.on = [];
    this.tab = 0;
    this.sel = 0;
    /// Bộ đếm của các nút thưởng: số lần vứt rác, số khách đã phục vụ, (món vừa chế, số lần liên tiếp).
    this.disposals = 0;
    this.served = 0;
    this.same_craft = [0, 0];
    this.open_minutes = 0;
  }
}

export function on(g, i) {
  return i < g.sk.on.length ? g.sk.on[i] : false;
}

export function has(g, fx) {
  return data.NODES.some((n, i) => n.fx === fx && on(g, i));
}

/// Tổng giá trị các nút đã mở của một hiệu ứng (hiệu ứng cộng dồn).
export function sum(g, fx) {
  let s = 0;
  data.NODES.forEach((n, i) => {
    if (n.fx === fx && on(g, i)) s = f32(s + f32(n.val));
  });
  return s;
}

/// Tích giá trị các nút đã mở của một hiệu ứng (hiệu ứng nhân dồn); chưa mở nút nào thì bằng 1.
export function mul(g, fx) {
  let p = 1;
  data.NODES.forEach((n, i) => {
    if (n.fx === fx && on(g, i)) p = f32(p * f32(n.val));
  });
  return p;
}

/// Nút mở khoá một loại việc của nhân viên (2 Service, 3 Security, 8 Cleaner) đã mở chưa.
export function job_unlocked(g, job_type) {
  // Cây kỹ năng chưa bật (cờ `skills`) thì mọi việc đều giao được.
  return !g.on(game.FF_SKILLS) || data.NODES.some((n, i) => n.fx === 'UnlockJobType' && n.arg === job_type && on(g, i));
}

/// Công thức của món `item` đã mở bằng nút kỹ năng chưa.
export function recipe_unlocked(g, item) {
  return data.NODES.some((n, i) => n.fx === 'UnlockCraftingRecipe' && n.arg === item && on(g, i));
}

export function nodes_of(skill) {
  const v = [];
  for (let i = 0; i < data.NODES.length; i++) if (data.NODES[i].skill === skill) v.push(i);
  return v;
}

export function can_unlock(g, i) {
  const n = data.NODES[i];
  return !on(g, i) && g.sk.points[n.skill] > 0 && (n.starter || n.links.some((l) => l >= 0 && on(g, l)));
}

/// [FTUE A5] gốc UnspentSkillIndicator / Skill.ShouldShowUnspentIndicator: còn điểm và còn nút mở được ở cây đó.
export function new_upgrades(g) {
  return [0, 1, 2, 3].some((t) => g.sk.points[t] > 0 && nodes_of(t).some((i) => can_unlock(g, i)));
}

export function reachable(g, i) {
  const n = data.NODES[i];
  return n.starter || n.links.some((l) => l >= 0 && on(g, l));
}

export function unlock(g, i) {
  const NODES = data.NODES;
  if (!can_unlock(g, i)) {
    g.play('deny', 0.5);
    const n = NODES[i];
    g.say(on(g, i) ? 'Already unlocked.' : g.sk.points[n.skill] < 1 ? `No ${NAMES[n.skill]} skill points. Level up to earn one.` : 'Locked: unlock a neighbouring node first.');
    return false;
  }
  while (g.sk.on.length < NODES.length) {
    g.sk.on.push(false);
  }
  const n = NODES[i];
  g.sk.on[i] = true;
  g.sk.points[n.skill] -= 1;
  apply(g, i);
  g.play('level', 0.7);
  g.say(`Unlocked: ${n.name} (${describe(i)}).`);
  return true;
}

/// Tác dụng tức thời khi mở nút (các hiệu ứng khác được đọc lúc dùng qua `sum` / `mul` / `has`).
export function apply(g, i) {
  const n = data.NODES[i];
  if (n.fx === 'IncreasePlayerMaxHealth') {
    g.hp_max += n.val;
    g.hp += n.val;
  }
}

/// Dựng lại các số suy ra từ nút đã mở (sau khi tải ván).
export function reapply(g) {
  g.hp_max = 100.0 + sum(g, 'IncreasePlayerMaxHealth') - (g.blood_cost || 0); // [par-counter D39] máu đã lấy hôm nay
  g.hp = g.hp_max;
}

/** Rust `{:+.0}` */
function plus0(v) {
  const s = v.toFixed(0);
  return s.startsWith('-') ? s : '+' + s;
}

export function describe(i) {
  const n = data.NODES[i];
  const pct = (v) => `${plus0(f32(f32(v - 1.0) * 100.0))}%`;
  switch (n.fx) {
    case 'UnlockCraftingRecipe': return `recipe: ${items.iname(n.arg)}`;
    case 'UnlockJobType': return `staff job: ${n.arg === 2 ? 'Service' : n.arg === 3 ? 'Security' : 'Cleaner'}`;
    case 'MaximumStaffCount': return '+1 staff';
    case 'IncreasePlayerMaxHealth': return `+${n.val.toFixed(0)} max health`;
    case 'MeleeWeaponMaxSlots': case 'ProjectileWeaponMaxSlots': case 'ThrowableMaxSlots': case 'ConsumableMaxSlots':
      return `+${n.val.toFixed(0)} ${n.fx.replaceAll('MaxSlots', ' slots')}`;
    case 'PlayerHealOverTime': return `regenerate ${n.val} HP/s after 5 s`;
    case 'CraftingResourceSaveMultiplier': return `${f32(n.val * 100.0).toFixed(0)}% chance to save each material`;
    case 'CraftingDoubleChance': return `${f32(n.val * 100.0).toFixed(0)}% chance of double output`;
    case 'DismantleExtraItemChance': return `+${f32(n.val * 100.0).toFixed(0)}% double shredder output`;
    case 'MedicalAssistanceGift': case 'AdditionalRaidRewards': case 'MaximumDailyStaffApproaches': case 'StaffWeaponRarityCap':
      return `${spaced(n.fx)} +${n.val.toFixed(0)}`;
    case 'ExoticMerchantFrequency': return 'merchant comes 1 day sooner';
    case 'ExoticMerchantItemOffering': return 'merchant offers 1 more item';
    case 'StoreOpenTimeBonusExperience': return '+10 Service XP per hour the store was open';
    case 'ObjectDisposalBonusExperience': return '+50 XP every 5 disposals';
    case 'ServeCustomerBonus': return '+100 batteries every 10 customers served';
    case 'SaveCustomerBonus': return '+100 batteries every 5 customers saved';
    case 'CraftSameItemBonus': return '+250 XP every 5th craft of the same item';
    case 'HealthBasedExperienceGainModifier': return '+25% Survival XP above 90% health';
    case 'StaffImmuneToInfection': case 'RareLoot': return spaced(n.fx);
    default: return `${spaced(n.fx).replaceAll(' Multiplier', '')} ${pct(n.val)}`;
  }
}

export function spaced(s) {
  let out = '';
  Array.from(s).forEach((c, k) => {
    if (/\p{Uppercase}/u.test(c) && k > 0) {
      out += ' ';
    }
    out += c;
  });
  return out;
}

export function panel_text(g) {
  const NODES = data.NODES;
  const t = Math.min(g.sk.tab, 3);
  const list = nodes_of(t);
  const sel = Math.min(g.sk.sel, sat1(list.length));
  const [lvl, x, need] = game.level_of(g.xpv[t]);
  const tabs = [0, 1, 2, 3].map((k) => (k === t ? `[${NAMES[k].toUpperCase()}]` : NAMES[k])).join('   ');
  let out = `SKILLS    ${tabs}\n${NAMES[t]} level ${lvl + 1}  (${x}/${need} XP)   skill points: ${g.sk.points[t]}   unlocked ${list.filter((i) => on(g, i)).length}/${list.length}\n\n`;
  const from = Math.min(Math.max(0, sel - 6), Math.max(0, list.length - 14));
  for (let k = from; k < Math.min(list.length, from + 14); k++) {
    const i = list[k];
    const mark = on(g, i) ? '[x]' : reachable(g, i) ? '[ ]' : ' . ';
    out += `${k === sel ? '>' : ' '} ${mark} ${NODES[i].name.padEnd(26)} ${describe(i)}\n`;
  }
  out += '\n[x] unlocked   [ ] available   .  needs a neighbour\n[A / D] tree   [W / S] select   [Enter] unlock (1 point)   [K] close';
  return out;
}

/// Glyph của một nút theo hiệu ứng của nó (cây nào thì mặc định glyph của cây đó). Returns an icons::G variant name.
export function node_glyph(t, i) {
  const fx = data.NODES[i].fx;
  const has = (k) => fx.includes(k);
  if (has('Health') || has('Heal')) {
    return 'Heart';
  } else if (has('Reputation')) {
    return 'Face3';
  } else if (has('Recipe') || has('Craft')) {
    return 'Hammer';
  } else if (has('Staff') || has('Worker') || has('Job')) {
    return 'Staff';
  } else if (has('Damage') || has('Reload') || has('Weapon') || has('Slot') || has('Ammo')) {
    return 'Pistol';
  } else if (has('Raid') || has('Zombie')) {
    return 'Skull';
  } else if (has('Loot') || has('Scaveng') || has('Search')) {
    return 'Crate';
  } else if (has('Price') || has('Batter') || has('Sale') || has('Tip')) {
    return 'Battery';
  } else if (has('Merchant') || has('Wheel')) {
    return 'Truck';
  } else if (has('Dispos') || has('Shred')) {
    return 'Wrench';
  } else {
    return TAB_GLYPHS[t];
  }
}

export const TAB_GLYPHS = ['Cart', 'People', 'Pistol', 'Hammer'];

/** icons::Cards::default() (icons.rs is not ported; Cards is a plain object with the Rust field names). */
function new_cards() {
  return { head: '', tabs: [], cards: [], sel: 0, det_icon: null, det_title: '', det: '', foot: '' };
}

/// Bảng kỹ năng dạng lưới nút hình thoi (bản gốc vẽ cây nút hình thoi, khung chi tiết bên phải).
export function cards(g) {
  const NODES = data.NODES;
  const t = Math.min(g.sk.tab, 3);
  const list = nodes_of(t);
  const sel = Math.min(g.sk.sel, sat1(list.length));
  const [lvl, x, need] = game.level_of(g.xpv[t]);
  const cs = list.map((i) => {
    const [sub, state] = on(g, i) ? ['UNLOCKED', 2] : reachable(g, i) ? ['AVAILABLE', 0] : ['LOCKED', 1];
    return { icon: { k: 'Node', a: node_glyph(t, i) }, name: NODES[i].name, sub, state };
  });
  const c = new_cards();
  c.cards = cs;
  c.sel = sel;
  c.head = `SKILLS      ${NAMES[t].toUpperCase()} level ${lvl + 1}  (${x}/${need} XP)      Unspent points: ${g.sk.points[t]}      unlocked ${list.filter((i) => on(g, i)).length}/${list.length}`;
  c.tabs = [0, 1, 2, 3].map((k) => [TAB_GLYPHS[k], `${NAMES[k]} ${game.level_of(g.xpv[k])[0] + 1}`, k === t]);
  if (sel < list.length) {
    const i = list[sel];
    c.det_icon = { k: 'Node', a: node_glyph(t, i) };
    c.det_title = NODES[i].name.toUpperCase();
    const st = on(g, i) ? 'UNLOCKED' : reachable(g, i) ? (g.sk.points[t] > 0 ? 'AVAILABLE  -  [Enter] Unlock' : 'AVAILABLE  -  no points') : 'LOCKED  -  needs a neighbouring node';
    c.det = `${st}\n\n${describe(i)}`;
  }
  c.foot = '[A / D] tree    [W / S] previous / next    [Enter] unlock (1 point)    [K] close';
  return c;
}

/// Cho bot: điểm, số nút đã mở mỗi cây, cây và dòng đang chọn, tên nút đang chọn.
function export_(g) {
  const NODES = data.NODES;
  const list = nodes_of(Math.min(g.sk.tab, 3));
  const sel = Math.min(g.sk.sel, sat1(list.length));
  const cnt = [0, 1, 2, 3].map((t) => String(nodes_of(t).filter((i) => on(g, i)).length));
  const avail = [];
  list.forEach((i, k) => {
    if (reachable(g, i) && !on(g, i)) avail.push(String(k));
  });
  const p = g.sk.points;
  const lv = [0, 1, 2, 3].map((k) => game.level_of(g.xpv[k])[0]);
  return (
    `{"pts":[${p[0]},${p[1]},${p[2]},${p[3]}],"on":[${cnt.join(',')}],"tab":${g.sk.tab},"sel":${sel},` +
    `"name":"${sel < list.length ? NODES[list[sel]].name : ''}","fx":"${sel < list.length ? NODES[list[sel]].fx : ''}","avail":[${avail.join(',')}],` +
    `"lv":[${lv[0]},${lv[1]},${lv[2]},${lv[3]}],"nodes":[${list.map((i) => `"${NODES[i].name}"`).join(',')}],"got":[${list.map((i) => (on(g, i) ? '1' : '0')).join(',')}]}`
  );
}
// `export` is a reserved word in JS: exported under the Rust name through an alias (`skills.export(g)`).
export { export_ as export };

export function save(g) {
  const on_ = [];
  g.sk.on.forEach((b, i) => {
    if (b) on_.push(String(i));
  });
  const p = g.sk.points;
  return `${p[0]},${p[1]},${p[2]},${p[3]},${g.sk.disposals},${g.sk.served},${g.sk.same_craft[0]},${g.sk.same_craft[1]}|${on_.join(',')}`;
}

/** Rust `s.parse::<i32>().ok()` */
function parse_i32(s) {
  if (!/^[+-]?\d+$/.test(s)) return null;
  const v = Number(s);
  return v >= -2147483648 && v <= 2147483647 ? v : null;
}
/** Rust `s.parse::<usize>().ok()` */
function parse_usize(s) {
  if (!/^\+?\d+$/.test(s)) return null;
  const v = Number(s);
  return Number.isSafeInteger(v) ? v : null;
}

export function load(g, s) {
  const NODES = data.NODES;
  const parts = s.split('|');
  const h = parts[0].split(',').map(parse_i32).filter((v) => v !== null);
  if (h.length >= 8) {
    g.sk.points = [h[0], h[1], h[2], h[3]];
    g.sk.disposals = h[4];
    g.sk.served = h[5];
    g.sk.same_craft = [h[6], h[7]];
  }
  g.sk.on = new Array(NODES.length).fill(false);
  for (const i of (parts.length > 1 ? parts[1] : '').split(',').map(parse_usize).filter((v) => v !== null)) {
    if (i < NODES.length) {
      g.sk.on[i] = true;
    }
  }
  reapply(g);
}

/* VIEW NOTES (skills.js)
 * No 3D drawing. Panel {k:'Skills'} (hud.rs) shows `cards(g)` (diamond-node grid) or `panel_text(g)`.
 * Cards object (icons.rs not ported): { head, tabs: [[G, 'Service 3', selected] x4] with TAB_GLYPHS
 *   ['Cart','People','Pistol','Hammer'], cards: [{icon:{k:'Node', a:G}, name, sub:'UNLOCKED'|'AVAILABLE'|'LOCKED',
 *   state: 2|0|1}], sel, det_icon, det_title, det, foot }. Icon 'Node' = the glyph inside a dark diamond tile.
 *   G glyph per node comes from node_glyph() (string variant names of icons::G).
 * Sounds: deny, level.
 * PORT GAPS: icons.rs represented as plain objects/strings; `export` exported via alias (implemented as export_).
 *   sum/mul accumulate with Math.fround to match Rust f32. Rust oddity: load() stores `h[6] as usize`; a negative saved
 *   value would wrap to a huge usize in Rust (and then fail to re-parse as i32 on the next load), JS keeps it negative.
 */
