//! HUD bố cục theo bản gốc (port of src/hud.rs, dựng lại bằng DOM + CSS phủ trên canvas WebGL):
//! ô pin xanh + uy tín (trái trên), vạch máu mảnh (giữa trên), "Day N  giờ" + biểu tượng đồng hồ (phải trên), TO DO LIST
//! có biểu tượng vàng và phím [L] (trái), ô gợi ý có phím bên phải tâm ngắm, thanh ô đồ 1/2/R có nhãn (giữa dưới), nút
//! phím (phải dưới). Thêm: thẻ QUEST COMPLETE, mốc chỉ đường có khoảng cách, dòng gợi ý phím, dải đen + phụ đề lúc cắt
//! cảnh, bảng Settings, thanh máu boss. Biểu tượng lấy từ `icons.js` (glyph SVG và hình 3D của từng món).
//! Ba lô, chế tạo, thương nhân / cửa hàng là bảng lưới thẻ có khung chi tiết; cây kỹ năng vẽ thành đồ thị nút
//! (data.NODES.links); bản đồ thế giới vẽ thành sơ đồ nút + đường (map.map_xy, LANDMARKS.parent).
//!
//! API: setup_hud(g, ctx) dựng DOM một lần trong #hud; update_hud(g, dt, ctx) gọi mỗi khung hình, chỉ ghi vào nút DOM
//! nào đổi nội dung (giá trị cũ cất trên chính nút đó). update_hud cũng chạy icons.bake() (Rust: hệ thống icons::bake).
//! Không bắt phím: mọi chọn lựa đọc từ trạng thái game (g.bag_sel, g.sk.sel, g.lm_sel, g.craft_sel, g.ev.sel...).
//! Chuột (chỉ khi con trỏ không bị khoá): bấm một thẻ thì đặt đúng trường chọn mà phím W / S đặt.

import * as game from './sim/game.js';
import * as items from './sim/items.js';
import * as skills from './sim/skills.js';
import * as map from './sim/map.js';
import * as events from './sim/events.js';
import * as craft from './sim/craft.js';
import * as staff from './sim/staff.js';
import * as build from './sim/build.js';
import * as combat from './sim/combat.js';
import * as save from './sim/save.js';
import * as cinem from './sim/cine.js';
import * as player from './sim/player.js';
import * as actors from './sim/actors.js';
import * as data from './sim/data.js';
import * as lay from './sim/lay.js';
import * as models from './sim/models.js';
import { Y } from './sim/vec.js';
import * as icons from './icons.js';
import * as panels from './panels.js';
import { details_html, details_click } from './plug/details.js';
import * as opanels from './opanels.js'; // [par-panels] full-screen panels in the original's layout

/// Số thẻ trên một trang của bảng lưới: 5 cột x 4 hàng.
const CARD_COLS = 5;
const CARD_ROWS = 4;
const N_CARDS = CARD_COLS * CARD_ROWS;

export const CONTROLS = 'WASD move  |  Mouse or arrows look  |  Shift sprint  |  Space jump\nE use  (hold E to search, sweep, repair, pry)\nLMB use / attack / fire / hold to throw / grab a placed object with empty hands  |  RMB second choice (take from shelf, bin, decline)\nR reload or choose stock  |  X drop  |  Esc leave the counter / pause\n1 hands  |  2 melee  |  3 gun  |  4 throwable  |  F or 6 hold a medical item (LMB use)  |  B build mode\nTab backpack (equip, build, learn, paint)  |  K skills  |  M world map  |  C configure a shelf\nhold V pick up a placed object\nLMB hold to secure a build  |  Wheel move a build forward/back  |  E rotate a build (Q the other way)  |  Esc cancel a build\nL To Do List  |  F1 this help  |  P settings';
// title screen: a clean menu, one line of the basic keys; the full list stays in the in-game help (L)
const TITLE_KEYS = 'WASD move  |  E use  |  LMB attack  |  L all controls in game';
const CONTROL_LINES = new Set(CONTROLS.split('\n').concat([TITLE_KEYS]));

export const CREDITS = 'Rendering, weapon feel, effects and audio techniques ported from Saltline by Felix Rieseberg. Character kit ported from Lanternfall by loktar00 (github.com/loktar00/lanternfall). The Walking Trade is a game by its original developers; this is a fan-made code-only rebuild.';

const sat = (n) => Math.max(0, n);
const iname = (i) => items.iname(i);
// Độ hiếm (data.INFO.rarity 0..4 = catalog gốc 0, 4, 2, 3, 1) theo loc gốc item_rarity_*_name: Common (clip 10 1:57), Uncommon (clip 13 12:02 Barbed
// Wire, nền xanh lá), Sparse (clip 16 17:47 Secure Shelving, nền tím); bậc 2 Rare / bậc 4 Limited suy theo thứ tự enum (chữ cái).
// Tên bậc nâng cấp hiện cho người chơi và dòng "Improvements" (bản gốc có chữ riêng từng bậc; ở đây [ĐỀ XUẤT] theo việc bậc đó mở
// trong luật của bản này: build.js wake_hour, prompt trạm, công thức theo cấp bàn).
const UPG_NAME = { CraftingStationLvl2: 'Crafting Station Lvl 2', CraftingStationLvl3: 'Crafting Station Lvl 3', Shredder: 'Working Shredder', Generator: 'Working Generator', Radio: 'Radio', LongRangeRadio: 'Long Range Radio', SurveillanceHub: 'Surveillance Hub', Bedroll: 'Bedroll', SingleBed: 'Single Bed', SirenUpgrade: 'Raid Siren' };
const UPG_IMP = {
  CraftingStationLvl2: ['Craft level 2 recipes (Barbed Wire, turrets...)'],
  CraftingStationLvl3: ['Craft level 3 recipes'],
  Shredder: ['The shredder works: break items down into materials'],
  Generator: ["Power for the yard: Dr. Gib's wheel visits after 06:00 PM (jump-start it first)"],
  Radio: ['The notes board becomes a radio'],
  LongRangeRadio: ['The radio becomes a long-range radio'],
  SurveillanceHub: ['The radio becomes a surveillance hub'],
  Bedroll: ['Wake up at 06:00 AM instead of 07:00 AM'],
  SingleBed: ['Wake up at 05:00 AM'],
  SirenUpgrade: ['Sound the siren to call the next raid for tomorrow'],
};
const ival = (i) => items.ival(i);

/// Bảng nào vẽ bằng lưới thẻ (ba lô, kỹ năng, bản đồ, thương nhân, cửa hàng, bàn chế tạo, máy nghiền); còn lại là bảng chữ.
export function panel_cards(g) {
  if (g.mode !== 'Play') return null;
  switch (g.panel.k) {
    case 'Bag': return items.bag_cards(g);
    case 'Skills': return skills.cards(g);
    case 'Map': return map.cards(g);
    case 'Trade': return events.cards(g);
    case 'Craft': return craft.cards(g);
    default: return null;
  }
}

/** Rust `{:+.2}`. */
function plus2(v) {
  return (v > 0 || (v === 0 && !Object.is(v, -0)) ? '+' : '') + v.toFixed(2);
}

export function panel_text(g, tier) {
  switch (g.mode) {
    case 'Title':
      if (g.panel.k === 'Saves') return save.panel_text(g);
      return `[Enter / Click]  New game\n[K]  Skip introduction (09:00, shop already cleaned)\n[C]  Continue saved game\n[V]  Saved games (3 slots)\n\n${TITLE_KEYS}`;
    case 'Summary': {
      const s = g.last_stats;
      return `Daily Summary - Day ${g.day - 1}\n\nCustomers served:  ${s.served}\nIncome:  +${s.income} Batteries\nOutgoings:  -${s.outgoings} Batteries\nOther:  ${s.other} Batteries\nProfit:  ${s.income - s.outgoings + s.other} Batteries\n\nReputation:  ${g.rep.toFixed(1)}%   (daily change ${plus2(s.rep_delta)})\nZombies killed:  ${s.kills}\n\n[Enter]  Okay`;
    }
    case 'Dead':
      return 'You have been beat unconcious...\n\nYou will wake in your bedroom at 08:30 AM tomorrow,\nmissing 10-20% of your batteries.\n\n[Enter]  Wake Up';
    case 'Play': {
      const p = g.panel;
      switch (p.k) {
        case 'Price': {
          const i = p.a;
          return `SET PRICE\n\n${iname(i)}\nMarket value:  ${ival(i)} Batteries\n\n      <   ${g.prices[i]} Batteries   >\n\n[Up / Down] +-1   [Shift] +-10   [R] reset   [Enter] done\nCustomers will not buy above 2.25x value (${Math.trunc(Math.fround(ival(i) * 2.25))} Batteries).`;
        }
        case 'Details':
          // fin-build đợt 5: "Item Details" là bảng riêng theo khung gốc op/05 (plug/details.js), không còn bảng chữ
          return '';
        case 'Radio': {
          // Bậc bàn tin tức quyết định độ rõ của tin raid: 0-1 biết trong 3 ngày, 2 trong 5 ngày, 3 chính xác (luật gốc).
          const lvl = g.bld.tiers[build.T_INTEL];
          const left = g.raid.next_day - g.day;
          const name = g.raid.index < data.RAID_DEFS.length ? data.RAID_DEFS[g.raid.index][0] : 'Hellraid';
          let intel;
          if (g.raid.active) intel = 'The horde is at your door!';
          else if (g.raid.next_day >= 9000) intel = 'Raid intel: no horde is heading this way.';
          else if (left <= 1 || lvl >= 3) intel = `Raid intel: the ${name} horde comes from the EAST.\nExpected: Day ${g.raid.next_day} at 09:30 AM.`;
          else if (left <= (lvl >= 2 ? 5 : 3)) intel = `Raid intel: a horde is gathering. Expect it within ${lvl >= 2 ? 5 : 3} days.`;
          else intel = 'Raid intel: quiet for now. (A better radio hears further ahead.)';
          return `RADIO\n\n${intel}\n\nSCAVENGE RUNS  (crate arrives outside next morning)\n[1]  Outer City Depots - 2 Batteries (tools, parts)${g.scav[0] ? '   SENT' : ''}\n[2]  Exit Tunnel - 3 Batteries (tinned food, beer)${g.scav[1] ? '   SENT' : ''}\n\n[E]  close`;
        }
        case 'Jobs': return staff.panel_text(g);
        case 'Hire': { const c = g.staff[p.a]; return c ? `HIRE THIS PERSON?\n\n${c.name}   wage ${c.wage}/day\nScavenge ${c.levels[0]}  Security ${c.levels[1]}  Service ${c.levels[2]}  Cleaner ${c.levels[3]}\n\n[H] Hire   [N] Reject   [Esc] not now` : ''; }
        case 'Name': return `NAME YOUR NEW, UH, 'HELPER'...

${p.v || ''}

[Enter] Okay`;
        case 'Job': return `SELECT JOB\n\n${staff.JOB_TILE_JOBS.map((j, k) => `${k === p.sel ? '>' : ' '} ${['Show World', 'Security', 'Service', 'Cleaner', 'Send Home'][k]}`).join('\n')}\n\n[W A S D] select   [Enter] Assign   [E] back`;
        case 'Map': return map.panel_text(g);
        case 'Craft': return craft.panel_text(g);
        case 'Pay': case 'Saves': return '';
        case 'Bag': return items.bag_text(g);
        case 'Skills': return skills.panel_text(g);
        case 'Trade': return events.panel_text(g);
        case 'Settings':
          return `SETTINGS\n\n[G]      Graphics:  ${['Low', 'Medium', 'High'][Math.min(tier, 2)]}\n[ [ / ] ]  Mouse sensitivity:  ${g.sens.toFixed(1)}\n[- / =]  Volume:  ${(g.volume * 100.0).toFixed(0)}%\n[I]      Invert Y:  ${g.invert ? 'On' : 'Off'}\n\n[P]  close`;
        case 'Help': {
          const lv = (k) => {
            const [l, x, n] = game.level_of(g.xpv[k]);
            return `${skills.NAMES[k]} ${l + 1} (${x}/${n})`;
          };
          return `CONTROLS\n${CONTROLS}\n\nSKILLS\n${lv(0)}   ${lv(1)}\n${lv(2)}   ${lv(3)}\n\nTIPS\nStock the shelves, flip the entrance switch, then serve from behind the counter:\ncheck every battery, bin the fakes. Customers stop buying above 2.25x value.\nYou can sleep after 07:00 PM. The radio sends scavenge runs and warns about raids.\nA crowbar opens the warehouse (crafting bench, shredder, generator).\n\n[L]  close`;
        }
        case 'None': return '';
        default: return '';
      }
    }
    default: return '';
  }
}

/// Tách "[E] Open door" thành phím và nhãn.
export function split_prompt(s) {
  if (s.startsWith('[')) {
    const rest = s.slice(1);
    const end = rest.indexOf(']');
    if (end >= 0) return [rest.slice(0, end), rest.slice(end + 1).trimStart()];
  }
  return ['', s];
}

/** [par-counter A01] Gợi ý tương tác thành danh sách lựa chọn như gốc: các cụm cách nhau từ 3 dấu cách; cụm mở bằng
 *  "[phím] động từ" là một lựa chọn, cụm còn lại là chữ thông tin (tên vật, giá, trạng thái). Bỏ cụm "[Q] also ..." (phím
 *  phụ trùng việc của lựa chọn khác). Ví dụ "[E] Set price   Tuna: 20 Batteries each   [RMB] Take"
 *  -> { opts: [['E', 'Set price'], ['RMB', 'Take']], info: ['Tuna: 20 Batteries each'] }. */
export function prompt_options(s) {
  const opts = [], info = [];
  for (const seg0 of s.split(/ {3,}/)) {
    const seg = seg0.trim();
    if (seg === '') continue;
    const m = seg.match(/^\[([^\]]{1,14})\]\s*([\s\S]*)$/);
    if (m === null) { info.push(seg); continue; }
    if (/^also\b/.test(m[2])) continue;
    opts.push([m[1], m[2]]);
  }
  return { opts, info };
}

// ---------- định dạng chữ của bảng: giữ nguyên mọi chuỗi, chỉ đổi [phím] thành ô phím và chia dòng theo vai trò ----------

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);
const KEY_BRACKETS = '[ [ / ] ]';

/** Chữ một dòng: escape, [phím] -> <kbd>. */
function inline(s) {
  let t = esc(s).split(KEY_BRACKETS).join('\u0001');
  t = t.replace(/\[([^\[\]\u0001]{1,28})\]/g, (m, k) => `<kbd>${k}</kbd>`);
  return t.split('\u0001').join('<kbd>[ / ]</kbd>');
}
const n_keys = (s) => (s.split(KEY_BRACKETS).join('[k]').match(/\[[^\[\]]{1,28}\]/g) || []).length;

/** Dòng gợi ý phím: các cụm cách nhau từ 3 dấu cách thành từng chip. */
function hint_line(s) {
  return `<div class="tx-hint">${s.split(/\s{3,}/).filter((x) => x.length).map((x) => `<span>${inline(x)}</span>`).join('')}</div>`;
}

function ctrl_chip(seg) {
  const m = seg.match(/^(Mouse or arrows|hold [A-Z]|[A-Z0-9][A-Za-z0-9]*)\s+(.*)$/);
  if (m === null) return `<span class="tx-ck">${esc(seg)}</span>`;
  let k = m[1];
  if (k === 'Mouse or arrows') k = '<kbd>Mouse</kbd> or <kbd>arrows</kbd>';
  else if (k.startsWith('hold ')) k = `hold <kbd>${k.slice(5)}</kbd>`;
  else k = `<kbd>${esc(k)}</kbd>`;
  return `<span class="tx-ck">${k}<em>${esc(m[2])}</em></span>`;
}

/** "Nhãn:  giá trị" -> hai cột. */
function label_value(s) {
  const m = s.match(/^([^:\[]{1,40}):\s{2,}(.+)$/);
  if (m === null) return null;
  let v = m[2];
  let badge = '';
  const sent = v.match(/^(.*?)(\s{3}SENT)$/);
  if (sent !== null) { v = sent[1]; badge = '<i class="tx-badge">SENT</i>'; }
  const neg = /^-\d/.test(v.trim());
  const pos = /^\+\d/.test(v.trim());
  return `<span class="tx-lbl">${inline(m[1])}:</span><b class="tx-val${neg ? ' neg' : pos ? ' pos' : ''}">${inline(v)}</b>${badge}`;
}

/** Chữ của một bảng (như Text của Bevy) dựng thành HTML có vai trò từng dòng. */
export function render_text(s) {
  const lines = s.split('\n');
  const out = [];
  let list = null;
  const flush = () => {
    if (list !== null) {
      out.push(`<div class="tx-list">${list.join('')}</div>`);
      list = null;
    }
  };
  lines.forEach((ln, idx) => {
    if (ln.trim() === '') {
      flush();
      out.push('<div class="tx-gap"></div>');
      return;
    }
    const step = ln.match(/^\s*<\s+(.+?)\s+>\s*$/);
    if (step !== null) {
      flush();
      out.push(`<div class="tx-step"><span class="chev">&lt;</span><b>${esc(step[1])}</b><span class="chev">&gt;</span></div>`);
      return;
    }
    if (CONTROL_LINES.has(ln)) {
      flush();
      out.push(`<div class="tx-ctrl">${ln.split(/\s+\|\s+/).map(ctrl_chip).join('')}</div>`);
      return;
    }
    if (ln[0] === '>' || ln[0] === ' ') {
      // Dòng danh sách (cột căn bằng dấu cách như bản Rust): chữ đơn cách, dòng đang chọn có vạch vàng.
      if (list === null) list = [];
      list.push(`<div class="tx-row${ln[0] === '>' ? ' sel' : ''}">${inline(ln.slice(1))}</div>`);
      return;
    }
    flush();
    if (idx === 0 && ln[0] !== '[') {
      const parts = ln.split(/\s{3,}/);
      out.push(`<header class="tx-head"><h2>${inline(parts[0])}</h2>${parts.slice(1).map((x) => `<span class="chip">${inline(x)}</span>`).join('')}</header>`);
      return;
    }
    const keys = n_keys(ln);
    if (keys >= 2) {
      out.push(hint_line(ln));
      return;
    }
    if (ln[0] === '[') {
      const m = ln.startsWith(KEY_BRACKETS) ? [ln, KEY_BRACKETS, ln.slice(KEY_BRACKETS.length).trim()] : ln.match(/^(\[[^\]]+\])\s*(.*)$/);
      if (m !== null) {
        const lv = label_value(m[2]);
        let body;
        if (lv !== null) body = lv;
        else {
          const sent = m[2].match(/^(.*?)(\s{3}SENT)$/);
          body = sent !== null ? `<span>${inline(sent[1])}</span><i class="tx-badge">SENT</i>` : `<span>${inline(m[2])}</span>`;
        }
        out.push(`<div class="tx-key">${inline(m[1])}${body}</div>`);
        return;
      }
    }
    const lv = label_value(ln);
    if (lv !== null) {
      // Dòng Profit của Daily Summary: nổi hơn, tô màu theo dấu của số.
      if (ln.startsWith('Profit:')) {
        const v = parseInt(ln.slice(7), 10);
        out.push(`<div class="tx-stat em">${lv.replace('class="tx-val"', `class="tx-val${v < 0 ? ' neg' : v > 0 ? ' pos' : ''}"`)}</div>`);
      } else {
        out.push(`<div class="tx-stat">${lv}</div>`);
      }
      return;
    }
    const hd = ln.match(/^([A-Z][A-Z0-9 .'\-]{3,}?)(\s{2,}.*)?$/);
    if (hd !== null && /[A-Z]{3}/.test(hd[1])) {
      out.push(`<h3 class="tx-h">${esc(hd[1])}${hd[2] ? `<small>${inline(hd[2].trim())}</small>` : ''}</h3>`);
      return;
    }
    out.push(`<p>${inline(ln)}</p>`);
  });
  flush();
  return out.join('');
}

/** Dòng đầu của bảng lưới: tên bảng + các chip số liệu (tách theo từ 3 dấu cách). */
function render_head(s) {
  const parts = s.split(/\s{3,}/).filter((x) => x.length);
  if (parts.length === 0) return '';
  const chip = (x) => {
    const b = x.match(/^Batteries (-?\d+)$/);
    if (b !== null) return `<span class="chip bat">${icons.glyph_svg('Battery')}<b>${b[1]}</b><em>Batteries</em></span>`;
    return `<span class="chip">${inline(x)}</span>`;
  };
  return `<h2>${inline(parts[0])}</h2><div class="chips">${parts.slice(1).map(chip).join('')}</div>`;
}

function render_foot(s) {
  return s.split('\n').map((ln) => (n_keys(ln) >= 2 ? hint_line(ln) : `<p>${inline(ln)}</p>`)).join('');
}

function render_det(s) {
  if (!s) return '';
  return s.split('\n').map((ln, k) => {
    if (ln === '') return '<div class="tx-gap"></div>';
    if (k === 0 && /^[A-Z]{3,}/.test(ln)) {
      const st = ln.startsWith('UNLOCKED') || ln.startsWith('EQUIPPED') ? 'good' : ln.startsWith('LOCKED') ? 'dim' : 'act';
      return `<p class="det-st ${st}">${inline(ln)}</p>`;
    }
    const lv = label_value(ln.replace(/:\s(?=\S)/, ':  '));
    return lv !== null && ln.length < 48 ? `<div class="tx-stat sm">${lv}</div>` : `<p>${inline(ln)}</p>`;
  }).join('');
}

// ---------- ghi DOM có nhớ (chỉ ghi khi đổi) ----------

function T(el, s) {
  if (el._t !== s) {
    el._t = s;
    el.textContent = s;
  }
}
function Hh(el, s) {
  if (el._h !== s) {
    el._h = s;
    el.innerHTML = s;
  }
}
function on(el, v) {
  if (el._on !== v) {
    el._on = v;
    el.classList.toggle('on', v);
  }
}
function hide(el, v) {
  if (el._hd !== v) {
    el._hd = v;
    el.hidden = v;
  }
}
function cls(el, c, v) {
  const k = '_c' + c;
  if (el[k] !== v) {
    el[k] = v;
    el.classList.toggle(c, v);
  }
}
function sty(el, p, v) {
  const k = '_s' + p;
  if (el[k] !== v) {
    el[k] = v;
    el.style.setProperty(p, v);
  }
}
function ico(el, icon) {
  let key = '';
  if (icon !== null && icon !== undefined && icon.k !== 'None') {
    key = icon.k + ':' + icon.a;
    if (icon.k === 'Item') key += icons.item_icon(icon.a) === null ? ':0' : ':1';
  }
  if (el._ik !== key) {
    el._ik = key;
    el.innerHTML = key === '' ? '' : icons.icon_html(icon)[0];
  }
}

// ---------- dựng DOM ----------

const HS = { root: null, R: null, g: null, kind: '', graph_t: -1, graph: null, map_key: '', map_nodes: [], links_sig: '', routes_sig: '' };

const gl = (g) => icons.glyph_svg(g);
const G_SPLAT = () => typeof window !== 'undefined' && window.__G && !!window.__G.splat;

function template() {
  const todo = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<div class="hd-todo-r" data-r="tr${i}" hidden><span class="ic tick" aria-hidden="true"></span><div><b data-r="tt${i}"></b><span data-r="td${i}" hidden></span></div></div>`).join('');
  const slots = [0, 1, 2].map((k) => `<div class="hd-slot k${k}" data-r="slot${k}"><div class="hd-slot-in"><small>${['1', '2', 'R'][k]}</small><span class="ic" data-r="sic${k}"></span></div></div>`).join('');
  const keys = [['L', 'List', 'To Do'], ['M', 'Globe', 'Map'], ['K', 'Skills', 'Skills'], ['TAB', 'Backpack', 'Backpack'], ['P', 'Gear', 'Settings']]
    .map(([k, g, t]) => `<div class="hd-kn" title="${t}">${k === 'K' ? '<em class="hd-newup" data-r="newup">NEW UPGRADES!</em>' : ''}<span class="ic">${icons.glyph_svg(g, true)}</span><kbd>${k}</kbd></div>`).join('');
  const cards = Array.from({ length: N_CARDS }, (_, k) => `<button class="hd-card" type="button" tabindex="-1" data-r="c${k}" data-ci="${k}" hidden><span class="ic" data-r="ci${k}"></span><b data-r="cn${k}"></b><small data-r="cs${k}"></small></button>`).join('');
  const tabs = [0, 1, 2, 3].map((k) => `<div class="hd-tab" data-r="tab${k}" hidden><span class="ic" data-r="ti${k}"></span><span data-r="tt_${k}"></span></div>`).join('');
  return `
<div class="hd-hurt" data-r="hurt"></div>
<div class="hd-speech" data-r="speech" hidden></div>
<div class="hd-work" data-r="work" hidden><i data-r="workfill"></i><b data-r="worktxt"></b></div>
<div class="hd-crate" data-r="crate" hidden></div>
<div class="hd-shade" data-r="shade"></div>
<div class="hd-bar t" data-r="bar0"></div><div class="hd-bar b" data-r="bar1"></div>
<div class="hd-root hd-tl">
  <div class="hd-bat"><span class="ic">${gl('Battery')}</span><b data-r="bat">0</b></div>
  <div class="hd-rep plate"><span class="ic" data-r="repic"></span><b data-r="rep">0%</b></div>
</div>
<div class="hd-root hd-tc">
  <div class="hd-hptext" data-r="hptext">HP: 100 / 100</div>
  <div class="hd-hpbar" data-r="hpbar"><i data-r="hpfill"></i></div>
  <div class="hd-xp" data-r="xp"><div class="hd-lvl" data-r="xplvl">LEVEL UP</div><span class="ic" data-r="xpic"></span><b data-r="xpn"></b><small data-r="xpsub">View Skills for new upgrades!</small></div>
</div>
<div class="hd-root hd-bossl">
  <div class="hd-boss hx" data-r="boss">
    <div class="hd-boss-h"><b data-r="bossname"></b><span data-r="bossnum" hidden></span></div>
    <div class="hd-boss-bar"><i data-r="bossfill"></i></div>
  </div>
</div>
<div class="hd-root hd-tr">
  <div class="hd-clock plate"><b data-r="day">Day 1</b><b data-r="clock">05:30 AM</b><span class="ic">${gl('Clock')}</span></div>
  <div class="hd-open" data-r="open"><span data-r="opentext">CLOSED</span></div>
  <div class="hd-raid hx" data-r="raid"><span class="ic">${gl('Skull')}</span><div class="hd-raid-t"><b data-r="raid0"></b><span data-r="raid1"></span><span data-r="raid2"></span><span data-r="raid3" hidden></span></div></div>
  <div class="hd-warn" data-r="warn"><i>!</i><span data-r="warnt"></span></div>
</div>
<div class="hd-root hd-todo">
  <div class="hd-todo-h"><span class="ic">${gl('List')}</span><b>TO DO LIST</b><kbd>L</kbd></div>
  ${todo}
</div>
<div class="hd-xh hx" data-r="cross">
  <svg class="hd-ring" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="15" class="trk"/><circle cx="20" cy="20" r="15" class="val" data-r="ringv"/></svg>
  <i class="dot"></i>
</div>
<div class="hd-prompt hx" data-r="prompt"><div class="hd-ptag" data-r="ptag" hidden></div><div class="hd-popts" data-r="popts"></div><span class="pct" data-r="ppct" hidden></span><i class="bar" data-r="pbar" hidden><b data-r="pbarv"></b></i></div>
<div class="hd-offer hx" data-r="offer"><div class="of-tab">Customer</div><div class="of-panel"><p data-r="oft"></p><div class="of-row"><div class="of-side" data-r="ofa"></div><svg class="of-arw" viewBox="0 0 40 40" aria-hidden="true"><path d="M8 4 L34 20 L8 36 L8 29 L22 20 L8 11 Z" fill="none" stroke="#fff" stroke-width="3.2" stroke-linejoin="round"/></svg><div class="of-side" data-r="ofb"></div></div></div><div class="of-btns"><span class="ok"><span class="ic">${gl('MouseL')}</span>ACCEPT</span><span class="no"><span class="ic">${gl('MouseR')}</span>DECLINE</span></div></div>
<div class="hd-status hx" data-r="status"><b data-r="statt"></b><span class="sub" data-r="stats" hidden></span></div>
<div class="hd-root hd-feed" data-r="feed"><div class="hd-feed-h" data-r="feedh">${gl('Crate')}<b>FOUND</b></div></div>
<div class="hd-notice hx" data-r="notice"><span data-r="noticet"></span></div>
<div class="hd-root hd-hint" data-r="hint"></div>
<div class="hd-root hd-slots">
  <div class="hd-box" data-r="box" hidden>
    <div class="hd-box-h"><span class="ic">${gl('Cart')}</span><b data-r="boxt">0.0 / 8.0</b><small data-r="boxs"></small></div>
    <i class="hd-box-bar"><b class="v" data-r="boxv"></b><b class="add" data-r="boxa"></b><span class="ticks"></span></i>
  </div>
  <div class="hd-slot-row">${slots}</div>
  <div class="hd-slot-label" data-r="slabel">Interact</div>
  <div class="hd-slot-sub" data-r="ssub"></div>
</div>
<div class="hd-root hd-keys">${keys}</div>
<div class="hd-root hd-bkeys hx" data-r="bkeys"></div>
<div class="hd-blabel" data-r="blabel" hidden><span class="ic" data-r="blabelic"></span><div><b data-r="blabeln"></b><small data-r="blabelr"></small></div></div>
<div class="hd-idet" data-r="idet" hidden></div>
<div class="hd-upg hx" data-r="upg"><div class="hd-upg-h"><b data-r="upgt"></b><span class="x">✕</span></div><small>Next Upgrade:</small><b class="nx" data-r="upgn"></b><i class="sep"></i><small>Improvements:</small><div class="imp" data-r="upgi"></div><i class="sep"></i><small data-r="upgb">Bring the following nearby:</small><div class="req" data-r="upgr"></div><div class="btn" data-r="upgbtn"><kbd>Enter</kbd> Upgrade</div></div>
<div class="hd-place hx" data-r="place"><span data-r="placet"></span><i><b data-r="placev"></b></i></div>
<div class="hd-toast hx" data-r="toast"><small>${gl('Check')}QUEST COMPLETE</small><b data-r="toastt"></b></div>
<div class="hd-fx" data-r="fx"></div>
<div class="hd-lvl" data-r="lvl"><b>LEVEL UP</b><span class="lv-ic" data-r="lvic"></span><small data-r="lvt"></small></div>
<div class="hd-fake" data-r="fake"><p>Uh oh! This customer has given an uncharged battery! You can sound the alarm to confront them about it.</p><span class="ok"><kbd>Enter</kbd>Okay</span></div>
<div class="hd-black" data-r="black"></div><div class="hd-saving" data-r="saving"><span>SAVING...</span><i></i></div>
<div class="hd-marker" data-r="marker" hidden><div class="hd-mk-in"><i class="sq"></i><i class="arw" data-r="mkarw"></i><span data-r="mkt"></span></div></div>
<div class="hd-sub hx" data-r="sub"><p data-r="subt"></p></div>
<div class="hd-skip hx" data-r="skip">${inline('[Enter] Skip')}</div>
<div class="hd-title hx" data-r="title">
  <h1 class="tl-sr">THE WALKING TRADE</h1>
  <svg class="tl-logo" viewBox="0 0 640 230" aria-hidden="true">
    <defs>
      <linearGradient id="tlPaint" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe36a"/><stop offset=".55" stop-color="#f5d138"/><stop offset="1" stop-color="#b9921a"/></linearGradient>
      <linearGradient id="tlSteel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a6066"/><stop offset="1" stop-color="#23272b"/></linearGradient>
      <pattern id="tlHaz" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="22" height="22" fill="#1d1a10"/><rect width="11" height="22" fill="#f5d138"/></pattern>
      <filter id="tlChip"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -14 9.6"/><feComposite in="SourceGraphic" operator="in"/></filter>
    </defs>
    <g class="tl-bot" transform="translate(8 14)">
      <rect x="10" y="40" width="112" height="96" rx="16" fill="url(#tlSteel)" stroke="#0d0f11" stroke-width="5"/>
      <rect x="24" y="56" width="84" height="54" rx="8" fill="#0b1012" stroke="#3a4046" stroke-width="3"/>
      <path class="tl-eye" d="M36 92 q12 -16 24 0 z M72 92 q12 -16 24 0 z" fill="#ff5a3a"/>
      <rect x="40" y="118" width="52" height="7" rx="3" fill="#0d0f11"/>
      <rect x="61" y="12" width="8" height="30" fill="#3a4046"/><circle cx="65" cy="10" r="9" fill="#f5d138" stroke="#0d0f11" stroke-width="4"/>
      <circle cx="22" cy="50" r="4" fill="#8a9096"/><circle cx="110" cy="50" r="4" fill="#8a9096"/><circle cx="22" cy="126" r="4" fill="#8a9096"/><circle cx="110" cy="126" r="4" fill="#8a9096"/>
      <rect x="0" y="70" width="12" height="36" rx="4" fill="#3a4046"/><rect x="120" y="70" width="12" height="36" rx="4" fill="#3a4046"/>
    </g>
    <text x="156" y="62" class="tl-small">THE</text>
    <g filter="url(#tlChip)">
      <text x="150" y="128" class="tl-big" fill="url(#tlPaint)" stroke="#0d0f11" stroke-width="7" paint-order="stroke">WALKING</text>
      <text x="150" y="196" class="tl-big tl-trade" fill="#f5eed9" stroke="#0d0f11" stroke-width="7" paint-order="stroke">TRADE</text>
    </g>
    <rect x="154" y="208" width="318" height="13" rx="2" fill="url(#tlHaz)" stroke="#0d0f11" stroke-width="3"/>
  </svg>
  <p class="tl-tag">a robot-world rebuild &middot; every model, light and sound is generated by code</p>
</div>
<div class="hd-pbox" data-r="pbox">
  <div class="hd-panel" data-r="panel" hidden>
    <div class="hd-ptext" data-r="ptext"></div>
    <div class="hd-credits" data-r="credits" hidden><h4>CREDITS</h4><p>${esc(CREDITS)}</p></div>
  </div>
  <div class="hd-cards" data-r="cards" hidden>
    <header class="hd-chead" data-r="chead"></header>
    <nav class="hd-tabs" data-r="tabs" hidden>${tabs}</nav>
    <div class="hd-cbody">
      <div class="hd-gridwrap" data-r="gridwrap"><div class="hd-grid" data-r="grid">${cards}</div><div class="hd-empty" data-r="empty" hidden></div><div class="hd-below" data-r="below" hidden></div><div class="hd-scroll" data-r="scroll" hidden><i data-r="scrollt"></i></div></div>
      <div class="hd-graph" data-r="graph" hidden></div>
      <div class="hd-map" data-r="map" hidden></div>
      <div class="hd-sheet" data-r="sheet" hidden></div>
      <aside class="hd-det"><div class="ic det-ic" data-r="detic"></div><h3 data-r="dett"></h3><div class="hd-detb" data-r="det"></div></aside>
    </div>
    <footer class="hd-cfoot" data-r="cfoot"></footer>
  </div>
</div>`;
}

function ensure_css() {
  if (typeof document === 'undefined') return;
  for (const l of document.querySelectorAll('link[rel="stylesheet"]')) if ((l.getAttribute('href') || '').includes('hud.css')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('../css/hud.css', import.meta.url).href;
  document.head.appendChild(l);
}

/** Đặt trường chọn của bảng đang mở về thẻ `k` (như phím W / S), chỉ khi con trỏ không bị khoá. */
function pick_card(k) {
  const g = HS.g;
  if (g !== null && g.mode === 'Title' && g.panel.k === 'Saves') { g.slot = Math.min(k, 2); return; } // phiên 8 đợt 4: bấm thẻ ô lưu
  if (g === null || g.mode !== 'Play' || document.pointerLockElement) return;
  switch (g.panel.k) {
    case 'Bag': g.bag_sel = k; break;
    case 'Skills': g.sk.sel = k; break;
    case 'Map': g.lm_sel = k; break;
    case 'Craft': g.craft_sel = k; break;
    case 'Trade': g.ev.sel = k; break;
    case 'Jobs': g.staff_sel = k; break;
    default: break;
  }
}

// ---------- loot feed (left): one line per item kind picked up, "+4 Unlabelled Tin" with its icon, fades after ~4 s ----------
const FEED = new Map();
const FEED_LIFE = 4.0, FEED_MAX = 7;
/** Plug-in loot.js calls this for every item that reaches the player (presentation only; the rules already gave it). */
export function loot_feed(i, n = 1) { feed_row(i, n, false); }
/** [phiên 8] "FOUND" feed (box rule, like the original's left-side list): loot.js calls it the moment each item pops out of
 *  a cache / corpse onto the floor. Same column as the "+n" lines, yellow accent, header "FOUND", the box volume of the item
 *  on the right so the player sees what it will take in the box. Fades after FEED_LIFE like the other lines. */
export function found_feed(i, n = 1) { feed_row(i, n, true); }
function feed_row(i, n, found) {
  const R = HS.R;
  if (R === null || !R.feed) return;
  const key = found ? 'f' + i : i;
  let row = FEED.get(key);
  if (row === undefined) {
    const el = document.createElement('div');
    el.className = found ? 'hd-feed-r found' : 'hd-feed-r';
    el.innerHTML = found ? '<span class="ic"></span><span class="nm"></span><b></b><small class="vol"></small>' : '<span class="ic"></span><b></b><span class="nm"></span>';
    R.feed.appendChild(el);
    row = { el, n: 0, t: 0, ic: false, it: i, found };
    FEED.set(key, row);
    while (FEED.size > FEED_MAX) { const [k, old] = FEED.entries().next().value; old.el.remove(); FEED.delete(k); }
  }
  row.n += n;
  row.t = 0;
  row.el.querySelector('b').textContent = found ? (row.n > 1 ? `x${row.n}` : '') : `+${row.n}`;
  row.el.querySelector('.nm').textContent = iname(i);
  if (found) row.el.querySelector('.vol').textContent = items.box_only(i) ? `box ${items.box_vol(i)}` : 'to bag';
  row.el.classList.remove('out', 'bump');
  void row.el.offsetWidth;
  row.el.classList.add('bump');
  feed_icon(i, row);
}
function feed_icon(i, row) {
  if (row.ic) return;
  const [html, ready] = icons.icon_html({ k: 'Item', a: i });
  row.el.querySelector('.ic').innerHTML = html;
  row.ic = ready;
}
function feed_tick(dt) {
  let found = false;
  for (const [k, row] of FEED) {
    row.t += dt;
    if (!row.ic) feed_icon(row.it, row);
    if (row.t > FEED_LIFE) row.el.classList.add('out');
    else if (row.found) found = true;
    if (row.t > FEED_LIFE + 0.5) { row.el.remove(); FEED.delete(k); }
  }
  if (HS.R !== null && HS.R.feedh) cls(HS.R.feedh, 'on', found);
}

export function setup_hud(g, ctx) {
  const root = document.getElementById('hud');
  if (root === null) throw new Error('hud root not found (#hud)');
  ensure_css();
  root.classList.add('twt-hud');
  root.innerHTML = template();
  const R = {};
  for (const el of root.querySelectorAll('[data-r]')) R[el.dataset.r] = el;
  HS.root = root;
  HS.R = R;
  HS.g = g;
  R.cards.addEventListener('mousedown', (e) => e.preventDefault());
  R.cards.addEventListener('click', (e) => {
    const t = e.target.closest('[data-ci]');
    if (t !== null) pick_card(+t.dataset.ci);
  });
  // Item Details: nút giá / công tắc bấm được khi con trỏ nhả (như thẻ ở trên)
  R.idet.addEventListener('mousedown', (e) => e.preventDefault());
  R.idet.addEventListener('click', (e) => {
    const t = e.target.closest('[data-dact]');
    if (t !== null) details_click(HS.g, t.dataset.dact);
  });
  opanels.install(root, g, ctx);
  if (ctx) ctx.icons = icons.STATE;
  return HS;
}

// ---------- đồ thị cây kỹ năng ----------

// Hướng của 8 ô `links` (đo trên dữ liệu: 0/1, 2/3, 4/7, 5/6 là cặp ngược nhau): lên, xuống, trái, phải, trái-lên,
// phải-lên, trái-xuống, phải-xuống. Dựng lưới bằng loang từ nút đầu mỗi cụm; ô trùng thì dời sang ô trống gần nhất.
const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];
const LAYOUT = [null, null, null, null];

export function tree_layout(t) {
  if (LAYOUT[t] !== null) return LAYOUT[t];
  const N = data.NODES;
  const list = skills.nodes_of(t);
  const inl = new Set(list);
  const pos = new Map();
  const taken = new Set();
  const place = (i, x, y) => {
    let best = [x, y];
    if (taken.has(x + ',' + y)) {
      outer: for (let r = 1; r < 6; r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (!taken.has((x + dx) + ',' + (y + dy))) { best = [x + dx, y + dy]; break outer; }
        }
      }
    }
    pos.set(i, best);
    taken.add(best[0] + ',' + best[1]);
  };
  let ox = 0;
  for (const s of list) {
    if (pos.has(s)) continue;
    if (pos.size > 0) ox = Math.max(...[...pos.values()].map((p) => p[0])) + 2;
    place(s, ox, 0);
    const q = [s];
    while (q.length) {
      const a = q.shift();
      const [x, y] = pos.get(a);
      N[a].links.forEach((b, d) => {
        if (b < 0 || !inl.has(b) || pos.has(b)) return;
        place(b, x + DIRS[d][0], y + DIRS[d][1]);
        q.push(b);
      });
    }
  }
  const xs = [...pos.values()].map((p) => p[0]), ys = [...pos.values()].map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  const W = Math.max(...xs) - x0 + 1, H = Math.max(...ys) - y0 + 1;
  const at = list.map((i) => [pos.get(i)[0] - x0, pos.get(i)[1] - y0]);
  const links = [];
  list.forEach((i, ka) => {
    N[i].links.forEach((b) => {
      const kb = list.indexOf(b);
      if (kb > ka) links.push([ka, kb]);
    });
  });
  LAYOUT[t] = { list, at, W, H, links };
  return LAYOUT[t];
}

function build_graph(t) {
  const L = tree_layout(t);
  const el = HS.R.graph;
  const px = (x) => ((x + 0.5) / L.W * 100).toFixed(3);
  const py = (y) => ((y + 0.5) / L.H * 100).toFixed(3);
  const lines = L.links.map(([a, b], k) => `<line data-l="${k}" x1="${px(L.at[a][0])}" y1="${py(L.at[a][1])}" x2="${px(L.at[b][0])}" y2="${py(L.at[b][1])}"/>`).join('');
  const nodes = L.list.map((i, k) => {
    const nd = data.NODES[i];
    return `<button class="gn${nd.minor ? ' minor' : ''}${nd.starter ? ' starter' : ''}" type="button" tabindex="-1" data-ci="${k}" style="left:${px(L.at[k][0])}%;top:${py(L.at[k][1])}%" title="${esc(nd.name)}"><i class="dm"></i><span class="ic">${icons.glyph_svg(skills.node_glyph(t, i))}</span></button>`;
  }).join('');
  // Ô lưới vuông: cạnh ô theo chiều hẹp hơn của khung 40 x 30 em.
  const cell = Math.min(40 / L.W, 29 / L.H);
  el.innerHTML = `<div class="gwrap" style="width:${(cell * L.W).toFixed(2)}em;height:${(cell * L.H).toFixed(2)}em;--cell:${cell.toFixed(3)}em"><svg class="glinks" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>${nodes}<div class="glabel" data-r="glabel"></div></div><div class="glegend"><span><i class="l2"></i>Unlocked</span><span><i class="l0"></i>Can unlock</span><span><i class="l1"></i>Locked: unlock a neighbour first</span></div>`;
  HS.graph = {
    t,
    L,
    nodes: [...el.querySelectorAll('.gn')],
    lines: [...el.querySelectorAll('line')],
    label: el.querySelector('.glabel'),
  };
  HS.graph_t = t;
  HS.links_sig = '';
}

function update_graph(g, c) {
  const t = Math.min(g.sk.tab, 3);
  if (HS.graph_t !== t || HS.graph === null) build_graph(t);
  const G = HS.graph;
  let sig = '';
  for (let k = 0; k < G.nodes.length; k++) {
    const card = c.cards[k];
    const st = card ? card.state : 1;
    sig += st;
    const n = G.nodes[k];
    if (n._st !== st) {
      n._st = st;
      n.className = n.className.replace(/\bst\d\b/g, '').trim() + ' st' + st;
    }
    cls(n, 'sel', k === c.sel);
  }
  if (sig !== HS.links_sig) {
    HS.links_sig = sig;
    G.L.links.forEach(([a, b], k) => {
      const sa = sig[a], sb = sig[b];
      const v = sa === '2' && sb === '2' ? 'on' : sa === '2' || sb === '2' ? 'half' : 'off';
      G.lines[k].setAttribute('class', v);
    });
  }
  const sel = c.cards[c.sel];
  if (sel && G.nodes[c.sel]) {
    const n = G.nodes[c.sel];
    sty(G.label, 'left', n.style.left);
    sty(G.label, 'top', n.style.top);
    T(G.label, sel.name);
    cls(G.label, 'on', true);
  } else {
    cls(G.label, 'on', false);
  }
}

// ---------- sơ đồ bản đồ thế giới ----------

// Khung sơ đồ (em) - khớp .hd-map trong hud.css.
const MAP_W = 40.5;
const MAP_H = 30.2;

function build_map(g, vis) {
  const el = HS.R.map;
  // Toạ độ thật (map_xy) -> em trong khung, rồi đẩy các nút quá gần nhau ra (giữ hình dáng bản đồ, chỉ gỡ chồng).
  const P = vis.map((i) => {
    const [u, v] = map.map_xy(i);
    return [(4 + u * 92) / 100 * MAP_W, (6 + v * 86) / 100 * MAP_H];
  });
  // [phiên 8 đợt 3, ĐỀ XUẤT] mốc "YOUR SHOP": góc trái dưới, cạnh ba mốc gốc (parent -1: Outer City Depots, Exit Tunnel,
  // City Gates, quãng đi ngắn nhất 150-160 phút); điểm cố định, các mốc khác bị đẩy ra khỏi nó.
  const SH = [(4 + 0.07 * 92) / 100 * MAP_W, (6 + 0.8 * 86) / 100 * MAP_H];
  const MIN = 2.7;
  for (let it = 0; it < 60; it++) {
    let moved = false;
    for (let a = 0; a < P.length; a++) {
      for (let b = a + 1; b < P.length; b++) {
        let dx = P[b][0] - P[a][0], dy = P[b][1] - P[a][1];
        let d = Math.hypot(dx, dy);
        if (d >= MIN) continue;
        if (d < 1e-3) { dx = 1; dy = 0.3; d = Math.hypot(dx, dy); }
        const push = (MIN - d) * 0.5 / d;
        P[a][0] -= dx * push; P[a][1] -= dy * push;
        P[b][0] += dx * push; P[b][1] += dy * push;
        moved = true;
      }
      const dx = P[a][0] - SH[0], dy = P[a][1] - SH[1], d = Math.hypot(dx, dy);
      if (d < 3.2) { const k = (3.2 - d) / Math.max(d, 1e-3); P[a][0] += (d < 1e-3 ? 1 : dx) * k; P[a][1] += dy * k; moved = true; }
    }
    for (const q of P) {
      q[0] = Math.min(Math.max(q[0], 1.4), MAP_W - 1.4);
      q[1] = Math.min(Math.max(q[1], 1.4), MAP_H - 2.4);
    }
    if (!moved) break;
  }
  // Nhãn: thử dưới, trên, phải, trái; đụng nhãn / nút khác thì thử chỗ kế; hết chỗ thì ẩn (vẫn hiện khi được chọn).
  const boxes = P.map(([x, y]) => [x - 1.1, y - 1.1, x + 1.1, y + 1.1]);
  boxes.push([SH[0] - 1.3, SH[1] - 1.3, SH[0] + 1.3, SH[1] + 2.9]); // shop marker + its label below
  const hit = (r) => boxes.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
  const side = vis.map((i, k) => {
    const [x, y] = P[k];
    const name = map.LANDMARKS[i].name;
    const w = Math.max(name.length * 0.28, 3.4) + 0.3, h = 1.45;
    const tries = [['b', [x - w / 2, y + 1.15, x + w / 2, y + 1.15 + h]], ['t', [x - w / 2, y - 1.15 - h, x + w / 2, y - 1.15]],
      ['r', [x + 1.2, y - h / 2, x + 1.2 + w, y + h / 2]], ['l', [x - 1.2 - w, y - h / 2, x - 1.2, y + h / 2]]];
    for (const [sd, r] of tries) {
      if (r[0] < 0 || r[2] > MAP_W || r[1] < 0 || r[3] > MAP_H) continue;
      if (!hit(r)) { boxes.push(r); return sd; }
    }
    return 'h';
  });
  const pct = (k) => [(P[k][0] / MAP_W * 100).toFixed(2), (P[k][1] / MAP_H * 100).toFixed(2)];
  const routes = [];
  vis.forEach((i, k) => {
    const p = map.LANDMARKS[i].parent;
    const kp = p >= 0 ? vis.indexOf(p) : -1;
    if (kp >= 0) routes.push([k, kp, p]);
  });
  const lines = routes.map(([a, b], k) => `<line data-l="${k}" x1="${pct(a)[0]}" y1="${pct(a)[1]}" x2="${pct(b)[0]}" y2="${pct(b)[1]}"/>`).join('');
  const sp = [(SH[0] / MAP_W * 100).toFixed(2), (SH[1] / MAP_H * 100).toFixed(2)];
  const home = vis.map((i, k) => (map.LANDMARKS[i].parent === -1 ? `<line class="home" x1="${sp[0]}" y1="${sp[1]}" x2="${pct(k)[0]}" y2="${pct(k)[1]}"/>` : '')).join('');
  const shop = `<div class="mshop" style="left:${sp[0]}%;top:${sp[1]}%"><span class="ic">${gl('Shop')}</span><b>YOUR SHOP</b></div>`;
  const nodes = vis.map((i, k) => `<button class="mn lb-${side[k]}" type="button" tabindex="-1" data-ci="${k}" style="left:${pct(k)[0]}%;top:${pct(k)[1]}%"><span class="ic"></span><span class="lb"><b>${esc(map.LANDMARKS[i].name)}</b><small></small></span></button>`).join('');
  el.innerHTML = `<div class="mwrap"><i class="mgrid"></i><svg class="mroutes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${home}${lines}</svg>${shop}${nodes}<span class="mcomp">N</span><div class="mlocal" data-lm></div></div>`;
  HS.map_nodes = [...el.querySelectorAll('.mn')].map((n, k) => ({ n, base: 'mn lb-' + side[k], ic: n.querySelector('.ic'), sub: n.querySelector('small') }));
  HS.map_lines = [...el.querySelectorAll('line')];
  HS.map_routes = routes;
  HS.routes_sig = '';
  HS.lmap = el.querySelector('[data-lm]');
  HS.lmap_sig = '';
}

// Đợt 13: ô "quanh quán" góc dưới bản đồ thế giới: mọi chỗ lục (vàng = còn đồ, xám rỗng = đã lục), người chơi, bãi, quán,
// mặt đường. Toạ độ SVG = toạ độ thế giới (x đông, z ra đường ở dưới).
const LMAP = [-42, -22, 92, 81];
function local_map(g) {
  const caches = g.props.filter((p) => !p.dead && p.kind.k === 'Cache');
  const left = caches.filter((p) => p.kind.c === false).length;
  const r = (b, cl) => `<rect class="${cl}" x="${b[0]}" y="${b[1]}" width="${b[2] - b[0]}" height="${b[3] - b[1]}"/>`;
  const road = `<rect class="lroad" x="${LMAP[0]}" y="${lay.ROAD_Z0}" width="${LMAP[2]}" height="${lay.ROAD_Z1 - lay.ROAD_Z0}"/>`;
  const bld = [lay.SHOP, lay.BEDROOM, lay.MEDICAL, lay.EXPANSION, lay.WAREHOUSE].map((b) => r(b, 'lbld')).join('');
  const dots = caches.map((p) => p.kind.c === false
    ? `<circle class="lc" cx="${p.pos.x.toFixed(1)}" cy="${p.pos.z.toFixed(1)}" r="1.5"/>`
    : `<circle class="lc done" cx="${p.pos.x.toFixed(1)}" cy="${p.pos.z.toFixed(1)}" r="1.1"/>`).join('');
  const a = g.yaw, px = g.player.x, pz = g.player.z;
  const tri = [[0, -2.6], [1.6, 1.8], [-1.6, 1.8]].map(([x, z]) => {
    // hướng nhìn: yaw 0 nhìn -z (vào quán)
    const c = Math.cos(a), sn = Math.sin(a);
    return `${(px + x * c + z * sn).toFixed(1)},${(pz - x * sn + z * c).toFixed(1)}`;
  }).join(' ');
  return `<h4>Around the store <span>${left}/${caches.length} loot spots</span></h4><svg viewBox="${LMAP.join(' ')}" aria-hidden="true">${road}${r(lay.LOT, 'llot')}${bld}${dots}<polygon class="lme" points="${tri}"/></svg>`;
}

function update_map(g, c) {
  const vis = map.visible(g);
  const key = vis.join(',');
  if (key !== HS.map_key) {
    HS.map_key = key;
    build_map(g, vis);
  }
  for (let k = 0; k < HS.map_nodes.length; k++) {
    const m = HS.map_nodes[k];
    const card = c.cards[k];
    if (!card) continue;
    if (m.n._st !== card.state) {
      m.n._st = card.state;
      m.n.className = m.base + ' st' + card.state;
      m.n._csel = undefined;
    }
    cls(m.n, 'sel', k === c.sel);
    ico(m.ic, card.icon);
    T(m.sub, card.sub);
  }
  if (HS.lmap) {
    let ls = Math.round(g.player.x) + ',' + Math.round(g.player.z) + ',' + Math.round(g.yaw * 8);
    for (const p of g.props) if (p.kind.k === 'Cache' && !p.dead) ls += p.kind.c ? '1' : '0';
    if (ls !== HS.lmap_sig) { HS.lmap_sig = ls; HS.lmap.innerHTML = local_map(g); }
  }
  const sig = vis.map((i) => g.lm[i]).join('');
  if (sig !== HS.routes_sig) {
    HS.routes_sig = sig;
    HS.map_routes.forEach(([, , p], k) => HS.map_lines[k].setAttribute('class', g.lm[p] === 2 ? 'open' : 'shut'));
  }
}

// ---------- mốc chỉ đường ----------

/** Đổi điểm thế giới sang hệ máy quay (quat liên hợp xoay ngược), như cam.affine().inverse().transform_point3. */
/** Khoảng cách (px) từ tâm màn hình xuống dưới mép dưới thẻ giá đang nhắm, cộng một khe nhỏ; null nếu không chiếu được. */
function tag_bottom(g, ctx) {
  const [s, k] = g.look_tag;
  const sh = g.shelves[s];
  if (!sh || typeof window === 'undefined') return null;
  const col = k % sh.cols, lvl = Math.trunc(k / sh.cols);
  const lx = (col + 0.5 - sh.cols * 0.5) * lay.SLOT_W;
  const hov = g.hover_tag && g.hover_tag[0] === s && g.hover_tag[1] === k;
  const ly = sh.plank ? (hov ? lay.PLANK_TOP + player.HOVER_TAG_DY : lay.PLANK_TAG_Y) : 0.41 + lvl * 0.5;
  const lz = sh.plank ? (hov ? lay.PLANK_ROWS[lvl] : lay.PLANK_FRONT) : 0.25;
  const h = window.innerHeight;
  const fov = ctx && ctx.cam && typeof ctx.cam.fov === 'number' ? ctx.cam.fov : 68 * Math.PI / 180;
  const t = Math.tan(fov * 0.5);
  let best = null;
  const c = Math.cos(sh.yaw), sn = Math.sin(sh.yaw);
  // bốn góc dưới / trên của thẻ (cao ~0,09 m, ngả nhẹ): lấy điểm thấp nhất trên màn hình
  const hw = hov ? 0.18 : 0.14;
  for (const dx of [-hw, hw]) for (const dy of [-0.06, 0.06]) {
    const x = lx + dx;
    const l = to_cam(ctx, g, { x: sh.pos.x + c * x + sn * lz, y: sh.pos.y + ly + dy, z: sh.pos.z - sn * x + c * lz });
    if (l[2] > -0.05) return null;
    const ny = l[1] / (-l[2] * t);
    const py = (0.5 - ny * 0.5) * h - h * 0.5; // px dưới tâm
    if (best === null || py > best) best = py;
  }
  return Math.round(Math.min(Math.max(best + 10, 28), h * 0.35));
}
function to_cam(ctx, g, pos) {
  const cam = ctx && ctx.cam ? ctx.cam : null;
  let cx, cy, cz, q;
  if (cam !== null && cam.pos) {
    cx = cam.pos.x; cy = cam.pos.y; cz = cam.pos.z;
    q = cam.quat || [0, 0, 0, 1];
  } else {
    cx = g.player.x; cy = g.player.y + player.EYE; cz = g.player.z;
    const hy = g.yaw * 0.5, hp = g.pitch * 0.5;
    // q = q_y(yaw) * q_x(pitch)
    const sy = Math.sin(hy), cyw = Math.cos(hy), sp = Math.sin(hp), cp = Math.cos(hp);
    q = [cyw * sp, sy * cp, -sy * sp, cyw * cp];
  }
  const vx = pos.x - cx, vy = pos.y - cy, vz = pos.z - cz;
  // v' = conj(q) * v * q
  const x = -q[0], y = -q[1], z = -q[2], w = q[3];
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

/** [par-counter A02] Độ hiếm như gốc: tên + màu dải thẻ (xám, xanh lá, xanh dương, tím, vàng). */
export const RARITY = [['Common', '#9aa0a6'], ['Uncommon', '#58c04a'], ['Rare', '#3f8fe0'], ['Sparse', '#a05ce0'], ['Limited', '#e8b830']]; // original names (fin-build): Common / Uncommon / Rare / Sparse / Limited
const rar_of = (i) => Math.min(Math.max((data.INFO[i] && data.INFO[i].rarity) | 0, 0), 4);
/** Thẻ tên của vật đang nhắm (gốc c01 4:04 "Cardboard Box / Common x11", clip 01 0:40 "Trash Bag"); null nếu không có. */
export function name_tag(g) {
  const hp = g.held !== null ? g.props.find((p) => p.id === g.held) : undefined;
  if (hp !== undefined && hp.kind.k === 'Trash' && g.look_id === 0) return { name: 'Trash Bag', sub: '', rar: 0, icon: '', n: 0 };
  if (hp !== undefined && hp.kind.k === 'Crate') return { name: 'Package', sub: '', rar: 0, icon: gl('Crate'), n: 0 }; // [par-counter D16]
  if (hp !== undefined && hp.kind.k === 'Corpse' && g.look_id === 0) return { name: 'Corpse', sub: '', rar: 0, icon: '', n: 0 }; // [par-counter D15] clip 08 f_3690
  if (!g.look_id) return null;
  const p = g.props.find((q) => q.id === g.look_id && !q.dead);
  if (p === undefined) return null;
  const k = p.kind;
  const it = (i) => ({ name: iname(i), sub: RARITY[rar_of(i)][0], rar: rar_of(i), icon: icons.icon_html({ k: 'Item', a: i })[0], n: 0 });
  switch (k.k) {
    case 'Item': return it(k.a);
    case 'Hammer': return null; // [par-counter D08] gốc: búa phát sáng vàng (plug/marks.js), không thẻ tên
    case 'Box': return { name: 'Cardboard Box', sub: 'Common', rar: 0, icon: gl('Crate'), n: k.a.length };
    case 'BoxPile': return { name: 'Cardboard Box', sub: 'Common', rar: 0, icon: gl('Crate'), n: 0 };
    case 'Trash': return { name: 'Trash Bag', sub: '', rar: 0, icon: '', n: 0 };
    case 'Crate': return { name: 'Package', sub: '', rar: 0, icon: gl('Crate'), n: 0 };
    case 'Reward': return { name: 'Care Package', sub: '', rar: 2, icon: gl('Crate'), n: 0 };
    case 'WBox': return { name: 'Wooden Crate', sub: '', rar: 0, icon: gl('Crate'), n: 0 };
    case 'Corpse': return { name: 'Corpse', sub: '', rar: 0, icon: '', n: 0 };
    default: return null;
  }
}
/** Động từ ngắn như gốc khi tên đã ở thẻ: "Take Tuna by hand" -> "Carry", "Put Tuna in box (+10  0/80)" -> "Carry". */
export function short_verb(l, name) {
  if (/^Take .* by hand$/.test(l) || /^Put .* in (this )?box/.test(l)) return 'Carry';
  if (/^Pick up (trash|cardboard box)/.test(l) || /^Take an empty cardboard box/.test(l)) return 'Carry';
  if (l === 'Take ' + name || l === 'Equip hammer') return l.startsWith('Equip') ? 'Equip' : 'Take';
  return l;
}

/** [par-counter B19 / B21 / B17 / B24] Phản hồi của gốc: số nổi "+n" khi được pin / XP (c01 3:33 "+5", sheet 7:04 "+1000"),
 *  banner LEVEL UP (sheet 2:26), hộp đỏ pin giả (clip 01 13:10, hiện lần đầu gặp pin giả), "SAVING..." + vòng quay góc phải
 *  dưới sau khi ngủ (sheet 2:24). Chỉ là phần nhìn: số pin, XP, lưu là của luật. */
const SKILL_COL = ['#58c04a', '#3f8fe0', '#e0524a', '#27c8e8'];
function fx_tick(g, dt, ctx, playing) {
  const R = HS.R;
  if (HS.fx === undefined) HS.fx = { bat: g.batteries, items: [], lvl: null, fake: 0, fakeSeen: false, saving: 0 };
  const F = HS.fx;
  const spawn = (html, cls2) => {
    const el = document.createElement('div');
    el.className = 'hd-float ' + cls2;
    el.innerHTML = html;
    el.style.setProperty('--dx', `${(Math.random() * 2.4 - 1.2).toFixed(2)}em`);
    R.fx.appendChild(el);
    F.items.push({ el, t: 0 });
    while (F.items.length > 8) { const o = F.items.shift(); o.el.remove(); }
  };
  if (playing && g.batteries > F.bat) spawn(`+${g.batteries - F.bat}<span class="ic bat">${gl('Battery')}</span>`, 'bat');
  F.bat = g.batteries;
  // integ: "+N XP" và LEVEL UP do khối xp_pop của par-combat vẽ (gốc: vòng tròn màu cây + chữ xanh, băng đỏ LEVEL UP +
  // "View Skills for new upgrades!", FTUE-AUDIT O21); hai bản của par-counter bị bỏ để không hiện hai lần
  if (g.xp_feed && g.xp_feed.length) g.xp_feed = [];
  for (const it of F.items) it.t += dt;
  while (F.items.length && F.items[0].t > 1.4) F.items.shift().el.remove();
  // LEVEL UP
  if (g.lvl_up) g.lvl_up = null;
  const lv = null;
  on(R.lvl, lv !== null);
  if (lv !== null) {
    sty(R.lvl, '--sk', SKILL_COL[lv.sk] || '#f5d138');
    T(R.lvt, `${skills.NAMES[lv.sk]}  Level ${lv.lv}`);
    if (R.lvic._sk !== lv.sk) { R.lvic._sk = lv.sk; Hh(R.lvic, gl(['Shop', 'Staff', 'Heart', 'Hammer'][lv.sk] || 'Skills')); }
  }
  // pin giả: hộp đỏ giữa màn lần đầu
  const fake = !!(g.pay && g.pay.coins.some((c) => c.checked && c.fake));
  if (fake && !F.fakeSeen) { F.fakeSeen = true; F.fake = 8; }
  if (F.fake > 0) {
    F.fake -= dt;
    const k = ctx && ctx.keys;
    if (!g.pay || (k && (k.just_pressed('Enter') || k.just_pressed('NumpadEnter')))) F.fake = 0;
  }
  on(R.fake, playing && F.fake > 0);
  // [par-counter D32] thông báo cảnh báo của gốc (clip 08 f_3666): ô vàng có dấu "!" góc phải trên, dưới đồng hồ, 7 s
  if (g.warn_toast) { F.warn = 7.0; T(R.warnt, g.warn_toast); g.warn_toast = null; }
  F.warn = Math.max(0, (F.warn || 0) - dt);
  on(R.warn, playing && F.warn > 0);
  // SAVING...
  // [par-counter B24] gốc sheet 2:24:40: ngủ xong là màn đen, "SAVING..." + vòng quay góc phải dưới, rồi mới tới Daily Summary
  if (F.mode0 === 'Play' && g.mode === 'Summary') F.black = 1.8;
  F.mode0 = g.mode;
  if (g.save_flash) { F.saving = Math.max(F.saving, 1.8); g.save_flash = false; }
  F.black = Math.max(0, (F.black || 0) - dt);
  if (g.mode !== 'Summary') F.black = 0;
  F.saving = Math.max(0, F.saving - dt, F.black);
  on(R.black, F.black > 0);
  on(R.saving, F.saving > 0);
}

// ---------- cập nhật mỗi khung hình ----------

export function update_hud(g, dt, ctx) {
  icons.bake();
  const R = HS.R;
  if (R === null) return;
  HS.g = g;
  const root = HS.root;
  const tier = ctx && ctx.quality && typeof ctx.quality.tier === 'number' ? ctx.quality.tier : 2;
  const todo = g.todo();
  const orig = opanels.update(g, tier); // [par-panels] drawn by opanels.js: hide the card / text panel
  const cards = orig ? null : panels.panel(g, tier) || panel_cards(g);
  // bảng nâng cấp vẽ ở khung bên phải như bản gốc (upgrade_panel bên dưới), không dùng bảng chữ giữa màn
  const upg = g.mode === 'Play' && g.panel.k === 'Trade' && g.ev.trade.k === 'Upgrade' ? g.ev.trade.a : null;
  const panel = orig || cards !== null || upg !== null ? '' : panel_text(g, tier);
  const cine = g.cine;
  const playing = g.mode === 'Play' && cine === null;
  const free = playing && g.panel.k === 'None';
  const hp = g.held !== null ? g.props.find((p) => p.id === g.held) : undefined;
  const held = hp === undefined ? null : hp.kind;
  const [wname, wsub] = combat.weapon_label(g);
  const label = held !== null && held.k === 'Box' ? 'Cardboard Box'
    : held !== null && held.k === 'Trash' ? 'Trash'
    : held !== null && held.k === 'Corpse' ? 'Corpse'
    : g.bld.ghost !== null || g.bld.mode ? 'Build'
    : wname !== '' ? wname : 'Interact';
  let sub;
  if (held !== null && held.k === 'Box') sub = `${held.a.length} item${held.a.length === 1 ? '' : 's'}   [X] drop`;
  else if (held !== null && (held.k === 'Trash' || held.k === 'Corpse')) sub = '[X] drop';
  else if (wsub !== '') sub = wsub;
  else if (g.inv[g.stock_sel] > 0 && items.sellable(g.stock_sel)) sub = `Stock [R]: ${iname(g.stock_sel)} x${g.inv[g.stock_sel]}`;
  else sub = '';
  const holding_box = held !== null && held.k === 'Box';
  const raid_left = g.zombies.filter((z) => z.raid && !z.dead).length;
  const clock = g.clock_text();
  const cut = clock.indexOf('  ');
  const day_s = cut >= 0 ? clock.slice(0, cut) : '';
  const time_s = cut >= 0 ? clock.slice(cut + 2) : clock;

  // Lớp trạng thái của gốc (CSS ẩn / hiện các nhóm theo nó).
  const ptr = typeof document !== 'undefined' && !document.pointerLockElement;
  cls(root, 'is-play', playing);
  cls(root, 'is-free', free);
  cls(root, 'is-cine', cine !== null);
  cls(root, 'is-title', g.mode === 'Title');
  cls(root, 'hd-ptr', ptr);
  cls(root, 'q0', tier <= 0);

  // Trái trên: pin + uy tín.
  T(R.bat, String(g.batteries));
  T(R.rep, `${g.rep.toFixed(0)}%`);
  const face = g.rep < -30.0 ? 'Face0' : g.rep < -5.0 ? 'Face1' : g.rep < 25.0 ? 'Face2' : g.rep < 60.0 ? 'Face3' : 'Face4';
  ico(R.repic, { k: 'Glyph', a: face });

  // Giữa trên: máu.
  const hpk = g.hp / g.hp_max;
  T(R.hptext, `HP: ${Math.ceil(g.hp).toFixed(0)} / ${g.hp_max.toFixed(0)}`);
  sty(R.hpfill, 'transform', `scaleX(${Math.min(Math.max(hpk, 0), 1).toFixed(4)})`);
  cls(R.hpbar, 'low', hpk <= 0.33);
  cls(R.hptext, 'low', hpk <= 0.33);

  // Phải trên: ngày, giờ, OPEN/CLOSED, raid.
  T(R.day, day_s);
  T(R.clock, time_s);
  cls(R.open, 'is-open', g.open);
  T(R.opentext, g.open ? 'OPEN' : 'CLOSED');
  // [FTUE A6] gốc ActiveRaidDetailsView "Next Wave": ngày raid, raid đã lộ mà chưa tới 09:30 thì thẻ RAID đếm ngược giờ:phút game
  // còn lại tới đợt đầu (PARITY J01: c01 ngày 20 05:25 ghi "Next Wave: 04:05", ngày 37 08:38 ghi "00:52" = 09:30 trừ giờ hiện tại)
  const raid_soon = !g.raid.active && g.raid.next_day < 9000 && g.day === g.raid.next_day && g.minutes < 9.5 * 60.0;
  on(R.raid, g.raid.active || raid_soon);
  if (raid_soon) {
    T(R.raid0, 'RAID');
    T(R.raid1, `Wave 0 / ${Math.max(combat.waves_of(g, g.raid.index).length, 1)}`);
    const left = Math.max(Math.ceil(9.5 * 60.0 - g.minutes), 0);
    T(R.raid2, `Next Wave: ${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`);
    hide(R.raid3, true);
  }
  if (g.raid.active) {
    const n = Math.max(g.cb.waves.length, 1);
    T(R.raid0, g.raid.index >= 5 ? `HELLRAID ${g.cb.hell_n + 1}` : 'RAID');
    T(R.raid1, `Wave ${Math.min(Math.max(g.raid.wave, 1), n)} / ${n}`);
    T(R.raid2, `Zombies left: ${raid_left}`);
    const b = g.cb.boss;
    hide(R.raid3, b === null);
    if (b !== null) T(R.raid3, `${b[0]}  ${b[1].toFixed(0)} / ${b[2].toFixed(0)}`);
  }
  // Lời nhân viên nổi cạnh người nói (gốc clip 09 21:44: chữ trắng mờ, to, bên phải đầu nhân viên)
  {
    let sp = null;
    if (playing) for (const s of g.staff || []) {
      if (!(s.speech_t > 0.0) || !s.speech || !s.pos || s.away || s.gone) continue;
      const l = to_cam(ctx, g, { x: s.pos.x, y: s.pos.y + 1.7, z: s.pos.z });
      if (l[2] > -0.3 || -l[2] > 30.0) continue;
      const fov = ctx && ctx.cam && typeof ctx.cam.fov === 'number' ? ctx.cam.fov : 68 * Math.PI / 180;
      const t = Math.tan(fov * 0.5), h = window.innerHeight, w = window.innerWidth;
      const x = (0.5 + (l[0] / (-l[2] * t)) * (h / w) * 0.5) * w, y = (0.5 - (l[1] / (-l[2] * t)) * 0.5) * h;
      if (x < -200 || x > w + 200 || y < 0 || y > h) continue;
      sp = [s.speech, x, y, Math.min(s.speech_t / 0.5, 1.0)];
      break;
    }
    hide(R.speech, sp === null);
    if (sp !== null) {
      T(R.speech, sp[0]);
      sty(R.speech, 'transform', `translate(${(sp[1] + 24).toFixed(0)}px, ${(sp[2] - 30).toFixed(0)}px)`);
      sty(R.speech, 'opacity', (0.82 * sp[3]).toFixed(3));
    }
  }
  // Nhắm vào thùng thưởng sau raid: danh sách đồ bên trong ở trái giữa màn (gốc clip 12 39:18: mỗi món một hàng, biểu tượng + tên)
  {
    const pr = free && g.look_id ? g.props.find((p) => p.id === g.look_id) : undefined;
    const its = pr !== undefined && pr.kind && pr.kind.k === 'Reward' && Array.isArray(pr.kind.a) ? pr.kind.a : null;
    hide(R.crate, its === null || its.length === 0);
    if (its !== null && its.length > 0) {
      const key = its.join(',');
      if (HS.crate_key !== key || HS.crate_wait) {
        let wait = false;
        R.crate.innerHTML = its.slice(0, 8).map((i) => { const [h, ok] = icons.icon_html({ k: 'Item', a: i }); if (!ok) wait = true; const rr = data.INFO[i] ? data.INFO[i].rarity : 0; return `<div class="hd-crate-r rr${rr}"><span class="ic">${h}</span><b>${items.iname(i)}</b></div>`; }).join('');
        HS.crate_key = key; HS.crate_wait = wait;
      }
    } else HS.crate_key = null;
  }
  // Thanh vàng đang chế tạo giữa dưới màn (gốc c01 4:03:00 "Small Crate... 39%"), khi không mở bảng
  {
    const job = free && g.craft_job ? g.craft_job : null;
    hide(R.work, job === null);
    if (job !== null) {
      const f = Math.min(Math.max(job[1] / Math.max(craft.secs(g, job[0]), 1e-3), 0.0), 1.0);
      T(R.worktxt, `${craft.name(job[0])}... ${Math.floor(f * 100)}%`);
      sty(R.workfill, 'transform', `scaleX(${f.toFixed(3)})`);
    }
  }
  // "+N XP" giữa trên dưới thanh máu (gốc: vòng tròn màu cây kỹ năng + chữ xanh nhỏ), "LEVEL UP" đỏ khi lên cấp
  const xp = g.xp_pop;
  if (xp && xp[3] !== HS.xp_seq) {
    HS.xp_seq = xp[3]; HS.xp_t = xp[2] ? 3.0 : 1.6;
    R.xp.className = 'hd-xp t' + xp[0] + (xp[2] ? ' lv' : '');
    R.xpic.innerHTML = icons.glyph_svg(['Cart', 'People', 'Pistol', 'Hammer'][xp[0]] || 'Pistol');
    T(R.xpn, `+${xp[1]} XP`);
  }
  HS.xp_t = Math.max((HS.xp_t || 0) - dt, 0);
  sty(R.xp, 'opacity', Math.min(HS.xp_t / 0.4, 1).toFixed(3));
  const boss = g.raid.active ? g.cb.boss : null;
  on(R.boss, boss !== null);
  if (boss !== null) {
    T(R.bossname, boss[0] + ':'); // gốc: "SWEATY ROTTER:" chữ hồng nhỏ, góc trái dưới ô pin (c01 7:56:00)
    T(R.bossnum, `${boss[1].toFixed(0)} / ${boss[2].toFixed(0)}`);
    sty(R.bossfill, 'transform', `scaleX(${Math.min(Math.max(boss[1] / Math.max(boss[2], 1e-6), 0), 1).toFixed(4)})`);
  }

  // TO DO LIST.
  // [FTUE A5] gốc UnspentSkillIndicator: chữ vàng "NEW UPGRADES!" nhấp nháy cạnh biểu tượng Skills khi còn điểm và còn nút mở được
  on(R.newup, playing && skills.new_upgrades(g));
  // [FTUE A2] gốc QuestGroupViewController: nhóm xếp theo priority, nhóm đầu sáng (_topPriorityColor), nhóm khác mờ
  for (let i = 0; i < 8; i++) {
    const has = i < todo.length;
    hide(R['tr' + i], !has);
    hide(R['td' + i], !has);
    if (has) {
      T(R['tt' + i], todo[i][0]);
      T(R['td' + i], `- ${todo[i][1]}`);
      cls(R['tr' + i], 'dim', todo[i][3] === false);
    }
  }

  // Tâm ngắm, ô gợi ý (phím hoặc chuột), tiến độ giữ phím ("  NN%" cuối gợi ý).
  on(R.cross, free);
  const bmode = free && g.bld.ghost !== null;
  const placing = free && (g.bld.ghost !== null || g.bld.mode) && (g.prompt.startsWith('Placing...') || g.prompt.startsWith('Repairing...'));
  // fin-build đợt 4: vật đang cầm tay (gốc clip 08 24:00: góc trái dưới "Forward/Back", "Rotate")
  const hpl = free && g.bld.ghost === null && !g.bld.mode ? build.held_placed(g) : null;
  // [par-counter C34] hộp "Customer wants ..." thay ô lựa chọn khi đứng sau quầy và khách đã sẵn sàng
  const offer = free ? actors.offer_of(g) : null;
  on(R.offer, offer !== null);
  if (offer !== null) {
    const sig = actors.offer_text(g, offer);
    if (R.offer._sig !== sig) {
      R.offer._sig = sig;
      const its = offer.items.map(([it, n]) => `<em class="it">${n}x ${esc(iname(it))}</em>`).join(', ');
      const bat = `<em class="bt">${offer.bat}x Batteries</em>`;
      Hh(R.oft, offer.sell ? `Customer wants ${bat} for ${its}.` : `Customer wants ${its} for ${bat}.`);
      const side_items = offer.items.map(([it, n]) => `<div class="of-it"><span class="ic">${icons.icon_html({ k: 'Item', a: it })[0]}</span><b>${n}</b></div>`).join('');
      const side_bat = `<div class="of-it"><span class="ic bat">${gl('Battery')}</span><b>${offer.bat}</b></div>`;
      Hh(R.ofa, offer.sell ? side_bat : side_items);
      Hh(R.ofb, offer.sell ? side_items : side_bat);
    }
  }
  on(R.prompt, free && g.prompt !== '' && !placing && offer === null);
  // [phiên 8] nhắm thẻ giá (thẻ trước hay thẻ nổi): ô gợi ý xuống dưới thẻ, giữa màn hình, để thẻ không bị che nửa phải
  const tb = free && g.look_tag ? tag_bottom(g, ctx) : null;
  cls(R.prompt, 'below', tb !== null);
  sty(R.prompt, 'margin-top', tb !== null ? `${tb}px` : '');
  // [par-counter A01] gốc: danh sách lựa chọn, mỗi dòng một biểu tượng nút (chuột trái / phải hoặc phím) + động từ, ngay
  // bên phải tâm ngắm; phần chữ không gắn phím (tên vật, giá, trạng thái) thành thẻ tên phía trên danh sách
  const pm = g.prompt.match(/^(.*?)\s+(\d+)%$/);
  const prog = pm !== null && free ? Math.min(+pm[2], 100) / 100 : 0;
  const { opts, info } = prompt_options(pm !== null ? pm[1] : g.prompt);
  // while a hold runs, "Search duffle bag" reads "Searching duffle bag…" and a bar fills under the prompt
  if (pm !== null && prog > 0) for (const o of opts) if (o[1].startsWith('Search ')) o[1] = `Searching ${o[1].slice(7)}…`;
  if (pm !== null && prog > 0) for (const o of opts) if (o[1] === 'Learn') o[1] = `Learning... ${info[0] || ''}`; // [par-counter A10 / C26]
  const lmb = g.lmb_interact === true;
  const keyHtml = (k) => {
    const kk = k.replace(/^hold /, '');
    if (kk === 'RMB') return `<span class="ic">${gl('MouseR')}</span>`;
    if (kk === 'Wheel') return `<span class="ic">${gl('MouseM')}</span>`;
    if (kk === 'LMB' || kk === 'click' || (lmb && kk === 'E')) return `<span class="ic">${gl('MouseL')}</span>`;
    return `<kbd>${esc(kk)}</kbd>`;
  };
  let tagHtml = info.map((l) => l.split('\n').map((x, k) => (k === 0 ? inline(x) : `<span class="l2">${inline(x)}</span>`)).join('<br>')).join('<br>');
  // [par-counter A02] gốc: vật đang nhắm (hay túi rác đang cầm) có thẻ tên: biểu tượng, tên, dòng độ hiếm, dải màu độ hiếm
  // bên trái, số lượng bên phải; lựa chọn chỉ còn động từ ("Carry", "Drop")
  const nt = free ? name_tag(g) : null;
  cls(R.ptag, 'nt', nt !== null && opts.length > 0);
  sty(R.ptag, '--rar', nt !== null ? RARITY[nt.rar][1] : '');
  if (nt !== null && opts.length > 0) {
    tagHtml = `${nt.icon ? `<span class="nt-ic">${nt.icon}</span>` : ''}<span class="nt-tx"><b>${esc(nt.name)}</b>${nt.sub ? `<small>${esc(nt.sub)}</small>` : ''}</span>${nt.n ? `<em class="nt-n">x${nt.n}</em>` : ''}`;
    for (const o of opts) o[1] = short_verb(o[1], nt.name);
  }
  hide(R.ptag, tagHtml === '' || opts.length === 0);
  Hh(R.ptag, opts.length === 0 ? '' : tagHtml);
  Hh(R.popts, opts.length === 0
    ? `<div class="hd-popt txt"><span class="lbl">${tagHtml}</span></div>`
    : opts.map(([k, l]) => `<div class="hd-popt"><span class="key">${keyHtml(k)}</span><span class="lbl">${l.split('\n').map((x, i) => (i === 0 ? inline(x) : `<span class="l2">${inline(x)}</span>`)).join('<br>')}</span></div>`).join(''));
  hide(R.ppct, pm === null);
  if (pm !== null) T(R.ppct, `${pm[2]}%`);
  cls(R.cross, 'hold', prog > 0);
  sty(R.ringv, 'stroke-dashoffset', (94.25 * (1 - prog)).toFixed(2));
  hide(R.pbar, !(prog > 0));
  if (prog > 0) sty(R.pbarv, 'transform', `scaleX(${prog.toFixed(3)})`);
  feed_tick(dt);

  // Thông báo, dòng gợi ý phím.
  on(R.notice, playing && g.notice_t > 0.0);
  if (R.noticet._raw !== g.notice) {
    R.noticet._raw = g.notice;
    Hh(R.noticet, inline(g.notice));
  }
  let hint = '';
  // [par-counter A03/D13] gợi ý góc dưới trái theo việc đang làm; ở quầy chỉ "ESC Leave" như gốc (op/04, op/04b)
  if (free && !bmode) hint = g.hint();
  // [par-counter B28] chữ trắng giữa dưới khi đứng sau quầy, như gốc: "Awaiting next customer...", "Take the customer's
  // offering...", "Pick up the battery.", "Deposit the battery in the correct depot."
  let stat = '';
  if (free && g.pay !== null) {
    const cs = g.pay.coins;
    if (g.pay.alarm === 1) stat = '';
    // [FTUE A7] gốc gameplay_serving_sound_alarm (phím của bản này: E trên nút báo động)
    else if (g.pay.alarm === 0 && cs.some((c) => c.checked && c.fake && c.done === 0)) stat = 'Press [E] to sound the alarm!';
    else if (g.chk_t > 0.0 && cs.some((c) => c.done === 0 && c.checked && !c.fake)) stat = 'Check the battery has the correct charge.';
    else if (cs.some((c) => c.done === 0 && c.checked && !c.fake)) stat = 'Deposit the battery in the correct depot.';
    // gốc UseCheckoutQuestController: lần bán đầu (ServeCustomer chưa xong) khách đặt pin xuống là "Pick up the battery." ngay
    else if (cs.every((c) => !c.checked && c.done === 0) && g.is_done('ServeFirst')) stat = "Take the customer's offering...";
    else if (cs.some((c) => c.done === 0 && !c.checked)) stat = 'Pick up the battery.';
  } else if (free && g.give !== null) {
    // [par-counter B28/D12] khách bán: "Give the customer batteries..." + dòng "N (pin) left to pay" (clip 09 3:55)
    stat = 'Give the customer batteries...';
  } else if (free && offer === null && g.desk && g.open && actors.head_customer(g) === null) {
    stat = 'Awaiting next customer...';
  }
  on(R.status, stat !== '');
  cls(root, 'at-desk', free && (g.desk || offer !== null || g.pay !== null || stat !== '')); // gốc: lúc phục vụ ở quầy không có hàng ô
  T(R.statt, stat);
  const left = free && g.give !== null ? g.give.left : -1;
  if (R.stats._left !== left) {
    R.stats._left = left;
    hide(R.stats, left < 0);
    if (left >= 0) Hh(R.stats, `<em>${left}</em><span class="ic bat">${gl('Battery')}</span>left to pay`);
  }
  if (R.hint._raw !== hint || R.hint._lmb !== g.lmb_interact) {
    R.hint._raw = hint;
    R.hint._lmb = g.lmb_interact;
    // [par-counter A01] tay không thì E là chuột trái như lời nhắc
    const mk0 = (x) => (g.lmb_interact === true ? inline(x).replace(/<kbd>(hold )?E<\/kbd>/g, (m, h) => `${h ? 'hold ' : ''}<span class="ic">${gl('MouseL')}</span>`) : inline(x));
    // [par-counter A03] nút chuột thành biểu tượng chuột như gốc; "hold" bỏ chữ (gốc chỉ ghi động từ, vd. "Charge Throw")
    const mk = (x) => mk0(x).replace(/(hold )?<kbd>(LMB|RMB)<\/kbd>/g, (m, h, k) => `<span class="ic">${gl(k === 'LMB' ? 'MouseL' : 'MouseR')}</span>`).replace(/<kbd>Esc<\/kbd>/g, '<kbd class="esc">ESC</kbd>').replace(/<kbd>Wheel<\/kbd>/g, `<span class="ic">${gl('MouseM')}</span>`);
    Hh(R.hint, hint === '' ? '' : hint.split(/\s{4,}/).map((x) => `<span>${mk(x)}</span>`).join(''));
  }

  // Ô đồ: 1 tay, 2 vũ khí đang chọn, R hộp / món đang chọn để xếp kệ.
  const wi = Math.min(g.wsel, sat(g.weapons.length - 1));
  const slot_weapon = g.weapons.length > 0 && g.weapons[wi] !== undefined ? g.weapons[wi].item : null;
  for (let k = 0; k < 3; k++) {
    // chế độ xây: ô 2 sáng lên với cây búa (gốc: ô 2 "Build" sáng khi đặt đồ, clip 10 1:57 / 3:16)
    const building = g.bld.ghost !== null || g.bld.mode;
    const act = building ? k === 1 : k === 0 ? !g.armed && !holding_box : k === 1 ? g.armed && !holding_box : holding_box;
    cls(R['slot' + k], 'act', act);
    const vis = k === 0 ? true : k === 1 ? g.weapons.length > 0 || building : holding_box || g.inv[g.stock_sel] > 0;
    hide(R['sic' + k], !vis);
    const which = k === 0 ? { k: 'Glyph', a: 'Hand' }
      : k === 1 ? { k: 'Item', a: building ? game.HAMMER : slot_weapon !== null ? slot_weapon : game.HAMMER }
      : { k: 'Item', a: holding_box || g.inv[g.stock_sel] <= 0 ? icons.BOX_ICON : g.stock_sel };
    if (vis) ico(R['sic' + k], which);
    // [par-counter B09] gốc: nền ô theo độ hiếm của món trong ô (xanh dương, tím, vàng, xanh lá; c01 6:57, 7:53)
    const rr = vis && which.k === 'Item' && which.a !== icons.BOX_ICON ? rar_of(which.a) : -1;
    cls(R['slot' + k], 'rar', rr > 0);
    sty(R['slot' + k], '--rar', rr > 0 ? RARITY[rr][1] : '');
  }
  T(R.slabel, label);
  if (R.ssub._raw !== sub) {
    R.ssub._raw = sub;
    Hh(R.ssub, inline(sub));
  }
  // [phiên 8] Thanh thể tích hộp như bản gốc (x/80): phần đầy xanh (vàng khi >= 75 %, đỏ khi đầy), phần món đang nhắm hiện
  // trước bằng vạch sáng (xanh nhạt nếu vừa, đỏ nếu không vừa) để người chơi thấy món đó chiếm bao nhiêu.
  hide(R.box, !holding_box);
  cls(root, "box-held", holding_box); // [par-counter B27] gốc ẩn hàng ô khi cầm hộp, thanh hộp nằm giữa đáy màn
  if (holding_box) {
    const cap = player.box_cap(g), used = items.box_used(held.a);
    const lp = g.look_id ? g.props.find((p) => p.id === g.look_id && !p.dead) : undefined;
    const add = lp !== undefined && lp.kind.k === 'Item' && (items.box_only(lp.kind.a) || player.box_fits(g, held.a, lp.kind.a)) ? items.box_vol(lp.kind.a) : 0;
    const fits = used + add <= cap;
    const pct = (v) => `${(Math.min(Math.max(v / cap, 0), 1) * 100).toFixed(1)}%`;
    sty(R.box, '--seg', `${(1000 / cap).toFixed(3)}%`); // một vạch mỗi 10 = một hộp thiếc
    // [par-counter B27] gốc PC 1.1.13 (op/14): "0.0 / 8.0" một số lẻ; luật đếm thể tích x10 (tin = 10) nên chia 10
    T(R.boxt, `${(used / 10).toFixed(1)} / ${(cap / 10).toFixed(1)}`);
    T(R.boxs, '');
    sty(R.boxv, 'width', pct(used));
    sty(R.boxa, 'left', pct(used));
    sty(R.boxa, 'width', pct(fits ? add : cap - used));
    cls(R.box, 'warn', used / cap >= 0.75 && used < cap);
    cls(R.box, 'full', used >= cap);
    cls(R.box, 'nofit', add > 0 && !fits);
  }

  // QUEST COMPLETE.
  on(R.toast, playing && g.toast_t > 0.0);
  T(R.toastt, g.toast);
  fx_tick(g, dt, ctx, playing);

  // Item Details (chuột phải trên vật cầm tay / vật chưa cố định): bảng theo khung gốc op/05
  const det = g.mode === 'Play' && g.panel.k === 'Details' ? g.panel.a : null;
  if (det !== null) {
    const [html, k] = details_html(g, det, g.panel.b || 0);
    if (R.idet._k !== k) { R.idet._k = k; R.idet.innerHTML = html; }
    if (R.idet.hidden) R.idet.hidden = false;
  } else if (!R.idet.hidden) {
    R.idet.hidden = true; R.idet._k = '';
  }

  // Bảng nâng cấp như bản gốc (sheet 0:16:40 Basket Stand): tên trạm, "Next Upgrade", "Improvements", ô vật liệu n/m (đỏ khi
  // thiếu), nút Upgrade. Vật liệu lấy từ ba lô (chủ dự án giữ cách này, HANDOFF bảng soát luật), nên dòng ghi "from your backpack".
  on(R.upg, upg !== null);
  if (upg !== null) {
    const ur = build.upgrade_rows(g, upg);
    T(R.upgt, build.TIER_TITLES[upg]);
    if (ur === null) {
      T(R.upgn, 'Fully upgraded');
      Hh(R.upgi, '');
      Hh(R.upgr, '');
      hide(R.upgbtn, true);
    } else {
      const nm = build.tier_req(upg, g.bld.tiers[upg])[0];
      T(R.upgn, UPG_NAME[nm] || nm);
      Hh(R.upgi, (UPG_IMP[nm] || []).map((l) => `<span>• ${esc(l)}</span>`).join(''));
      T(R.upgb, 'Bring the following (from your backpack):');
      const k = ur[1].map(([it, need, have]) => `${it}:${need}:${have}`).join('|');
      if (R.upgr._k !== k) {
        R.upgr._k = k;
        Hh(R.upgr, ur[1].map(([it, need, have]) => `<div class="it${have >= need ? ' ok' : ''}"><span class="ic" data-ui="${it}"></span><span class="n">${esc(iname(it))}</span><span class="c">${Math.min(have, need)}/${need}</span></div>`).join(''));
        R.upgr.querySelectorAll('[data-ui]').forEach((el) => ico(el, { k: 'Item', a: +el.dataset.ui }));
      }
      hide(R.upgbtn, false);
      cls(R.upgbtn, 'off', ur[1].some(([, need, have]) => have < need));
    }
  }

  // Chế độ xây như bản gốc (clip 10 1:57, 3:16-3:18): danh sách phím góc trái dưới, nhãn tên + độ hiếm trên bóng,
  // thanh vàng "Placing... <món> NN%" giữa đáy màn hình.
  on(R.bkeys, bmode || placing || hpl !== null);
  if (bmode || placing || hpl !== null) {
    const k = placing ? 'leave' : hpl !== null ? (build.orientable(hpl.kind.a) ? 'hold-o' : 'hold') : 'keys';
    if (R.bkeys._k !== k) {
      R.bkeys._k = k;
      const row = (ic, label) => `<div class="r">${ic}<span>${label}</span></div>`;
      const ms = (gname) => `<span class="ic">${gl(gname)}</span>`;
      Hh(R.bkeys, placing ? row('<kbd>Esc</kbd>', 'Leave')
        : hpl !== null ? row(ms('MouseW') + ms('MouseW'), 'Forward/Back') + row('<kbd>E</kbd><kbd>Q</kbd>', 'Rotate') + (k === 'hold-o' ? row('<kbd>O</kbd>', 'Orient') : '')
        : row(ms('MouseL'), 'Secure') + row(ms('MouseW') + ms('MouseW'), 'Forward/Back') + row('<kbd>Esc</kbd>', 'Cancel') + row('<kbd>E</kbd><kbd>Q</kbd>', 'Rotate'));
    }
  }
  on(R.place, placing);
  cls(HS.root, 'is-placing', placing);
  if (placing) {
    const pm2 = g.prompt.match(/^(.*?)\s+(\d+)%$/);
    T(R.placet, pm2 !== null ? `${pm2[1]} ${pm2[2]}%` : g.prompt);
    sty(R.placev, 'transform', `scaleX(${(pm2 !== null ? Math.min(+pm2[2], 100) / 100 : 0).toFixed(3)})`);
  }
  let bl = null;
  // nhãn tên + độ hiếm: trên bóng, hoặc trên vật đang hiện vàng ở chế độ xây (gốc clip 10 1:54 "Weapon Rack" cạnh "Detach")
  const ep = free && g.bld.ghost === null && g.bld.mode && g.bld.edit !== null && g.bld.edit.k === 'Prop' ? g.prop(g.bld.edit.a) : null;
  // vật đang cầm tay cũng có thẻ tên trên đầu (gốc clip 15 7:16 "Tape / Common", clip 17 29:25 "Explosive Barrel")
  const lab = bmode ? [g.bld.ghost[0], g.bld.ghost_pos] : ep !== null && !ep.dead ? [ep.kind.k === 'Wire' ? game.BARBED : ep.kind.a, ep.pos]
    : hpl !== null ? [hpl.kind.a, hpl.pos] : null;
  if (lab !== null) {
    const item = lab[0];
    const w = window.innerWidth, h = window.innerHeight;
    const l = to_cam(ctx, g, lab[1].add(Y.mul((item === game.BARBED ? 0.55 : models.top_h(item)) + 0.35)));
    if (l[2] < -0.3) {
      const fov = ctx && ctx.cam && typeof ctx.cam.fov === 'number' ? ctx.cam.fov : 68 * Math.PI / 180;
      const t = Math.tan(fov * 0.5);
      const nx = l[0] / (-l[2] * t * (w / Math.max(h, 1.0))), ny = l[1] / (-l[2] * t);
      if (Math.abs(nx) < 0.95 && Math.abs(ny) < 0.9) bl = [Math.round((nx * 0.5 + 0.5) * w), Math.round((0.5 - ny * 0.5) * h)];
    }
    if (bl !== null) {
      ico(R.blabelic, { k: 'Item', a: item });
      T(R.blabeln, iname(item));
      const rr = Math.min(Math.max(data.INFO[item] ? data.INFO[item].rarity : 0, 0), 4);
      T(R.blabelr, RARITY[rr][0]);
      // nền thẻ theo độ hiếm (gốc clip 13 12:02 "Barbed Wire / Uncommon" nền xanh lá; màu như danh sách thùng thưởng của par-combat)
      if (R.blabel._rr !== rr) { R.blabel._rr = rr; R.blabel.className = `hd-blabel rr${rr}`; }
      sty(R.blabel, 'transform', `translate3d(${bl[0]}px,${bl[1]}px,0) translate(-50%,-100%)`);
    }
  }
  hide(R.blabel, bl === null);

  // Mốc chỉ đường: chiếu điểm đích lên màn hình, ghim vào mép khi ở ngoài khung hay sau lưng.
  let marker = null;
  if (free) {
    const pos = g.objective();
    if (pos !== null && pos !== undefined) {
      const dist = pos.distance(g.player.add(Y.mul(1.6)));
      if (dist > 2.2) {
        const w = window.innerWidth, h = window.innerHeight;
        const l = to_cam(ctx, g, pos);
        const fov = ctx && ctx.cam && typeof ctx.cam.fov === 'number' ? ctx.cam.fov : 68 * Math.PI / 180;
        const t = Math.tan(fov * 0.5);
        const depth = Math.max(Math.abs(-l[2]), 0.05);
        let nx = l[0] / (depth * t * (w / Math.max(h, 1.0)));
        let ny = l[1] / (depth * t);
        let pinned = false;
        if (l[2] > 0.0) {
          // Sau lưng: đẩy ra mép trái / phải.
          nx = l[0] >= 0.0 ? 2.0 : -2.0;
          ny = -0.2;
          pinned = true;
        }
        const m = Math.max(Math.abs(nx), Math.abs(ny));
        if (m > 0.86) {
          nx *= 0.86 / m;
          ny *= 0.86 / m;
          pinned = true;
        }
        marker = [Math.round((nx * 0.5 + 0.5) * w), Math.round((0.5 - ny * 0.5) * h), dist, pinned, Math.atan2(-ny, nx)];
      }
    }
  }
  hide(R.marker, marker === null);
  if (marker !== null) {
    sty(R.marker, 'transform', `translate3d(${marker[0]}px,${marker[1]}px,0)`);
    T(R.mkt, `${marker[2].toFixed(0)}m`);
    cls(R.marker, 'pin', marker[3]);
    // Mũi tên chỉ hướng đích khi mốc bị ghim vào mép (góc màn hình, 0 = sang phải, chiều kim đồng hồ).
    if (marker[3]) sty(R.mkarw, 'transform', `rotate(${(marker[4] * 180 / Math.PI).toFixed(0)}deg) translateX(1.15em) rotate(45deg)`);
  }

  // Cắt cảnh: hai dải đen, phụ đề, nhắc bỏ qua.
  const bk = cine !== null ? Math.min(cine[1] / 0.5, 1.0) : 0.0;
  sty(R.bar0, 'transform', `scaleY(${bk.toFixed(3)})`);
  sty(R.bar1, 'transform', `scaleY(${bk.toFixed(3)})`);
  const subt = cine !== null ? cinem.sub(cine[0], cine[1]) : '';
  on(R.sub, cine !== null && subt !== '');
  T(R.subt, subt);
  on(R.skip, cine !== null);

  // Tiêu đề, lớp phủ.
  on(R.title, g.mode === 'Title');
  const low = hpk <= 0.33 && playing ? 0.12 : 0.0;
  // [par-counter B29] bị đánh: vệt máu bắn tung toé (plug/splat.js) thay lớp đỏ đều; lớp này chỉ còn viền đỏ khi máu thấp
  const ha = Math.min(Math.max((G_SPLAT() ? 0.0 : g.hurt_flash * 0.38) + low, 0.0), 0.6);
  sty(R.hurt, 'opacity', (ha / 0.6).toFixed(3));
  const sa = g.mode === 'Title' ? 0.3 : g.mode === 'Summary' ? 0.8 : g.mode === 'Dead' ? 0.7 : 0.0;
  const shade = Math.max(sa, Math.min(Math.max(g.fade, 0.0), 1.0));
  sty(R.shade, 'background-color', `rgba(${g.mode === 'Dead' ? 64 : 0},0,0,${shade.toFixed(3)})`);

  // Bảng giữa màn hình.
  const show_box = (panel !== '' || cards !== null) && cine === null;
  cls(R.pbox, 'on', show_box);
  cls(R.pbox, 'at-title', g.mode === 'Title');
  const pk = g.mode === 'Play' ? g.panel.k : g.mode + (g.panel.k === 'Saves' ? '-Saves' : '');
  if (R.pbox._pk !== pk) {
    R.pbox._pk = pk;
    R.pbox.dataset.pk = pk;
  }
  hide(R.panel, panel === '');
  if (panel !== '') {
    if (R.ptext._raw !== panel) {
      R.ptext._raw = panel;
      R.ptext.innerHTML = render_text(panel);
    }
    hide(R.credits, !(g.mode === 'Title' || (g.mode === 'Play' && g.panel.k === 'Help')));
  }
  hide(R.cards, cards === null);
  if (cards !== null) update_cards(g, cards);
}

function update_cards(g, c) {
  const R = HS.R;
  const kind = c.sheet ? 'sheet' : g.mode !== 'Play' ? 'grid' : g.panel.k === 'Skills' ? 'graph' : g.panel.k === 'Map' ? 'map' : 'grid';
  if (HS.kind !== kind) {
    HS.kind = kind;
    R.cards.dataset.kind = kind;
  }
  hide(R.gridwrap, kind !== 'grid');
  hide(R.graph, kind !== 'graph');
  hide(R.map, kind !== 'map');
  hide(R.sheet, kind !== 'sheet');
  // phiên 8 đợt 3: bảng dạng tờ (Settings, Daily Summary, Set Price) không có khung chi tiết
  hide(R.cards.querySelector('.hd-det'), kind === 'sheet');
  if (kind === 'sheet') {
    const html = panels.sheet_html(c.sheet, (k) => `<kbd>${k}</kbd>`, (ic) => icons.icon_html(ic)[0]);
    if (R.sheet._raw !== html) { R.sheet._raw = html; R.sheet.innerHTML = html; }
  }
  if (R.chead._raw !== c.head) {
    R.chead._raw = c.head;
    R.chead.innerHTML = render_head(c.head);
  }
  if (R.cfoot._raw !== c.foot) {
    R.cfoot._raw = c.foot;
    R.cfoot.innerHTML = render_foot(c.foot);
  }
  hide(R.tabs, c.tabs.length === 0);
  for (let k = 0; k < 4; k++) {
    const t = c.tabs[k];
    hide(R['tab' + k], t === undefined);
    if (t !== undefined) {
      cls(R['tab' + k], 'act', t[2]);
      ico(R['ti' + k], { k: 'Glyph', a: t[0] });
      T(R['tt_' + k], t[1]);
    }
  }
  if (kind === 'grid') {
    // phiên 8 đợt 3: ít thẻ (<= 8: thương nhân, cửa hàng, hợp đồng, ba lô gần rỗng) thì xếp thành hàng ngang rộng hai cột
    cls(R.grid, 'few', c.cards.length <= 8 && !c.icons);
    // [PARITY M08] lưới chọn món kiểu gốc (SelectableItemIconView): 5 cột ô vuông chỉ có hình, tên món ở khung chi tiết
    cls(R.grid, 'icons', !!c.icons);
    // lưới rỗng: một ô chú thích giữa khung (c.empty, không có thì tiêu đề khung chi tiết)
    const empty = c.cards.length === 0 ? (c.empty || c.det_title || 'Nothing here') : '';
    hide(R.empty, empty === '');
    T(R.empty, empty);
    // phiên 8 đợt 4: khối phụ dưới lưới (Job Board: các việc giao được) để khung chi tiết ngắn lại
    const below = c.below || '';
    hide(R.below, below === '');
    if (R.below._raw !== below) { R.below._raw = below; R.below.innerHTML = render_det(below); }
    // Trang thẻ đang hiện: giữ hàng của thẻ đang chọn trong 4 hàng nhìn thấy.
    const rows = Math.ceil(c.cards.length / CARD_COLS);
    const from = Math.min(sat(Math.trunc(c.sel / CARD_COLS) - 1), sat(rows - CARD_ROWS)) * CARD_COLS;
    for (let k = 0; k < N_CARDS; k++) {
      const el = R['c' + k];
      const card = c.cards[from + k];
      hide(el, card === undefined);
      if (card === undefined) continue;
      const ci = String(from + k);
      if (el.dataset.ci !== ci) el.dataset.ci = ci;
      if (el._st !== card.state) {
        el._st = card.state;
        el.className = 'hd-card st' + card.state + (el._csel ? ' sel' : '');
      }
      const sel = from + k === c.sel;
      if (el._csel !== sel) {
        el._csel = sel;
        el.classList.toggle('sel', sel);
      }
      // integ: lưới M08 tô nền ô theo độ hiếm như ô của par-panels (C40 Configure: xanh lá / lam / tím / vàng)
      const rr = c.icons && card.icon && card.icon.k === 'Item' ? rar_of(card.icon.a) : 0;
      if (el.dataset.rr !== String(rr)) el.dataset.rr = String(rr);
      ico(R['ci' + k], card.icon);
      T(R['cn' + k], card.name);
      T(R['cs' + k], card.sub);
    }
    hide(R.scroll, rows <= CARD_ROWS);
    if (rows > CARD_ROWS) {
      sty(R.scrollt, 'height', `${(CARD_ROWS / rows * 100).toFixed(2)}%`);
      sty(R.scrollt, 'transform', `translateY(${(from / CARD_COLS / CARD_ROWS * 100).toFixed(2)}%)`);
    }
  } else if (kind === 'graph') {
    update_graph(g, c);
  } else if (kind === 'map') {
    update_map(g, c);
  }
  ico(R.detic, c.det_icon);
  T(R.dett, c.det_title);
  if (R.det._raw !== c.det) {
    R.det._raw = c.det;
    R.det.innerHTML = render_det(c.det);
  }
}

/* VIEW NOTES (hud.js)
Page contract: <div id="hud"></div> over the canvas; setup_hud injects css/hud.css (resolved from this module) when no
stylesheet with "hud.css" is linked. update_hud(g, dt, ctx) also runs icons.bake() once per frame (Rust icons::bake).
Layout follows hud.rs: battery pill + reputation face (top-left), "HP: a / b" + thin bar (top-centre, red at <= 33 %),
Day / clock / OPEN-CLOSED / RAID box (top-right), TO DO LIST (left), crosshair + prompt with key cap / mouse glyph,
notice + key hint lines, slots 1 / 2 / R with label and sub line (bottom-centre), key nodes L M K TAB P (bottom-right),
QUEST COMPLETE toast, objective marker pinned to the screen edge, cutscene bars (11 % each, eased in over 0.5 s) +
subtitle + "[Enter] Skip", title block, centre panel (text panels) or card panel (grid / skill graph / world map).
Additions over the Rust HUD (presentation only, same state): boss bar under the HP bar (name, hp / max), hold-progress
ring around the crosshair (parsed from the "  NN%" suffix player.js appends to the prompt), card-grid scrollbar,
edge arrow on a pinned marker, credits block in Help and on the title screen.
PORT GAPS: none in behaviour. Text panels are the exact Rust strings, laid out by line role (title, key rows, label /
value rows, monospace list rows with the '>' marker shown as a highlight, key-hint chips); '[k]' becomes a key cap.
*/
