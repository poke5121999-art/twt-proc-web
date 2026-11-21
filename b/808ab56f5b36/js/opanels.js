// [par-panels] Full-screen panels in the original's layout and style (PARITY.md section C): Crafting (C07), Skills (C09),
// World Map (C10 / C11), Employees (C16), Daily Summary (C21), Item Details (C22), Settings (C05), Game Paused (C04).
// Each panel keeps every function and key of the card panels it replaces (the same rules calls: craft.act, skills.unlock,
// map.act, staff.assign / fire / give_gun, g.prices); the mouse works too (buttons call the same functions).
// ?panels=cards shows the previous card panels (panels.js / hud.js), ?panels=text the old text panels.
// Presentation only, except the click handlers which call the rules functions the keys call.
import * as game from './sim/game.js';
import * as items from './sim/items.js';
import * as staff from './sim/staff.js';
import * as skills from './sim/skills.js';
import * as craft from './sim/craft.js';
import * as catalog from './sim/catalog.js';
import * as data from './sim/data.js';
import * as map from './sim/map.js';
import * as build from './sim/build.js';
import * as icons from './icons.js';
import { ITEM_TEXT, LM_DESC } from './itemtext.js';
import * as ST from './settings.js';

const OFF = typeof location !== 'undefined' && /[?&]panels=(text|cards)\b/.test(location.search);
const TYPES = ['Ammo', 'Appliance', 'Crafting', 'Decoration', 'Defence', 'Food', 'Gun', 'Medicine', 'Melee', 'Seeds', 'Shop', 'Survival', 'Throwable', 'Tool'];
const RAR = ['common', 'uncommon', 'rare', 'sparse', 'limited'];
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const GL = new Map();
/** Glyph SVG, cached per name (icons.glyph_svg gives each call a new gradient id, which would rebuild the panel every frame). */
function gl(n, node = false) {
  const k = n + (node ? '#n' : '');
  let s = GL.get(k);
  if (s === undefined) { s = icons.glyph_svg(n, node); GL.set(k, s); }
  return s;
}
const ii = (i) => icons.icon_html({ k: 'Item', a: i })[0];
const BAT = '<i class="op-bat" aria-hidden="true"><svg viewBox="0 0 28 14"><rect x="1" y="1" width="24" height="12" rx="6" fill="#fff"/><rect x="25" y="4.5" width="2.5" height="5" rx="1" fill="#fff"/><path d="M14.5 2.6 9.6 7.6h3.2l-1.4 3.8 5-5.2h-3.3z" fill="#111"/></svg></i>';
const stars = (n, max = 5) => `<span class="op-stars">${Array.from({ length: max }, (_, k) => `<i class="${k < n ? 'on' : ''}">★</i>`).join('')}</span>`;
const kbd = (k) => `<kbd>${esc(k)}</kbd>`;
const desc = (i) => (ITEM_TEXT[items.cat_key(i)] || [''])[0];
// integ: độ hiếm theo data.INFO (0..4 = Common, Uncommon, Rare, Sparse, Limited như fin-build); ITEM_TEXT giữ thứ tự thô của
// danh mục (1 = Limited, 4 = Uncommon) nên Barbed Wire từng hiện vàng thay vì xanh lá (gốc clip 13 12:02)
const rarity = (i) => { const r = data.INFO[i] ? data.INFO[i].rarity : 0; return r < 0 ? 0 : Math.min(r, 4); };
const sgn = (v, d = 0) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d);

/** Which panel this module draws now, or null. */
export function which(g) {
  if (OFF) return null;
  if (g.mode === 'Summary') return 'Summary';
  if (g.mode !== 'Play' || g.cine !== null) return null;
  switch (g.panel.k) {
    case 'Craft': case 'Skills': case 'Map': case 'Jobs': case 'Price': case 'Settings': case 'Pause': case 'Todo': case 'Hire': case 'Job': case 'Name': case 'Configure': case 'Notes': return g.panel.k;
    default: return null;
  }
}

/** HTML of the panel on screen (null = not drawn here). */
export function html(g, tier) {
  switch (which(g)) {
    case 'Summary': return summary(g);
    case 'Price': return price(g);
    case 'Jobs': return employees(g);
    case 'Hire': return hire(g);
    case 'Job': return jobsel(g);
    case 'Name': return naming(g);
    case 'Configure': return configure(g);
    case 'Notes': return notes(g);
    case 'Craft': return crafting(g);
    case 'Skills': return topbar(g, 'Skills') + skilltree(g);
    case 'Map': return topbar(g, 'Map') + worldmap(g);
    case 'Todo': return topbar(g, 'Todo') + todopage(g);
    case 'Settings': return settings(g, tier);
    case 'Pause': return pause(g);
    default: return null;
  }
}

// ---------------------------------------------------------------- Daily Summary (C21, op/10, clip 09 f_1232)
function summary(g) {
  const s = g.last_stats;
  const loot = s.loot || 0, wages = s.wages || 0;
  const other_in = s.other - loot;
  const inc = [['Looting', loot], ['Sales', s.income], ['Other', Math.max(other_in, 0)]].filter((r) => r[1] !== 0);
  const out = [['Other', s.outgoings - wages + Math.max(-other_in, 0)], ['Staff Wages', wages]].filter((r) => r[1] !== 0);
  const rev = inc.reduce((a, r) => a + r[1], 0), loss = out.reduce((a, r) => a + r[1], 0);
  const profit = s.income - s.outgoings + s.other;
  const parts = s.rep_parts || {};
  const inf = ['Availability', 'Pricing', 'Service', 'Heroism', 'Danger', 'Corpses'].filter((k) => Math.abs(parts[k] || 0) >= 0.005);
  const d = s.rep_delta;
  const rows = (list, sign) => list.map(([k, v]) => `<div class="r"><span>${k}</span><b>${sign}${v}</b></div>`).join('');
  const rep = Math.max(-100, Math.min(100, g.rep));
  const fill = rep >= 0 ? `left:50%;width:${(rep / 2).toFixed(2)}%` : `left:${(50 + rep / 2).toFixed(2)}%;width:${(-rep / 2).toFixed(2)}%`;
  return `<div class="op-sum">
  <h1>Daily Summary</h1><div class="day"><b>Day ${g.day - 1}</b></div>
  <section class="bx bat"><h2>Batteries ${BAT}</h2>
    <div class="band inc"><h3>Income</h3>${rows(inc, '+')}<div class="tot"><span>Total Revenue:</span><b><u>${rev > 0 ? '+' : ''}${rev}</u></b></div></div>
    <div class="band out"><h3>Outgoings</h3>${rows(out, '−')}<div class="tot"><span>Total Loss:</span><b><u>${loss > 0 ? '−' : ''}${loss}</u></b></div></div>
  </section>
  <section class="bx rep"><h2>Reputation <i class="thumb">${THUMB}</i></h2>
    <div class="band inf"><h3>Influences</h3>${inf.map((k) => `<div class="r"><span>${k}</span><b>${sgn(parts[k], 2)}</b></div>`).join('')}
    <div class="tot ${d < 0 ? 'neg' : ''}"><span>Daily Change:</span><b><u>${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d).toFixed(2).replace(/\.00$/, '')}%</u></b></div></div>
    <p>Higher reputation attracts more customers and increases the chance they'll be high-spending.</p>
  </section>
  <i class="rule"></i>
  <div class="sfoot">
    <div class="pf"><div class="r ${profit < 0 ? 'neg' : 'pos'}"><span>Profit:</span><b>${profit < 0 ? '−' : ''}${Math.abs(profit)}</b></div><div class="r bats"><span>Batteries:</span><b><u>${g.batteries}</u></b></div></div>
    <div class="rp"><i class="bar"><b style="${fill}"></b><s class="m0"></s><s class="m1"></s><s class="m2"></s></i><div class="r"><span>Reputation:</span><b><u>${g.rep.toFixed(2)}%</u></b></div></div>
    <button class="op-btn ok" data-a="sum-ok" type="button">Okay</button>
  </div>
  <div class="op-keys">${kbd('Enter')} Okay</div>
</div>`;
}
const THUMB = '<svg viewBox="0 0 24 24"><path fill="#fff" d="M2 10h4v11H2zM8 21V10l5-7c1.4 0 2.4 1.2 2 2.6L14 9h6.2c1.2 0 2 1.1 1.7 2.2l-2.3 8.2c-.3.9-1.1 1.6-2 1.6z"/></svg>';

// ---------------------------------------------------------------- Item Details / set price (C22, op/05)
function price(g) {
  const i = g.panel.a;
  const v = items.ival(i), p = g.prices[i];
  const cap = Math.trunc(Math.fround(v * 2.25));
  const r = rarity(i);
  return `<div class="op-dim"></div><div class="op-item">
  <header><h2>Item Details</h2><button class="x" data-a="close" type="button">✕</button></header>
  <div class="body">
    <h1 class="r${r}">${esc(items.iname(i))}</h1><div class="ty">${TYPES[items.ty_of(i)] || ''}</div>
    <div class="pic"><span class="img">${ii(i)}</span><p>${esc(desc(i))}</p></div>
    <i class="sep"></i>
    <div class="pr"><b>Current Price:</b><span>${BAT}<b class="${p > cap ? 'bad' : 'good'}">${p}</b></span></div>
    <div class="ev"><span>Est. Value:</span><span>${BAT}<b>${v}</b></span></div>
    <div class="btns"><button type="button" class="op-btn yel" data-a="pr-ev">Est. Value</button><button type="button" class="op-btn red" data-a="pr" data-v="-1">−1</button><button type="button" class="op-btn red" data-a="pr" data-v="-10%">−10%</button><button type="button" class="op-btn grn" data-a="pr" data-v="1">+1</button><button type="button" class="op-btn grn" data-a="pr" data-v="10%">+10%</button></div>
    ${p > cap ? `<div class="warn">Customers will not buy above ${cap} (2.25x value).</div>` : ''}
    <i class="sep"></i>
    <button type="button" class="tg" data-a="pr-flag" data-v="1"><span>·&nbsp; Available for purchase</span><i class="pill ${g.avail[i] !== false ? 'on' : ''}"></i></button>
    <button type="button" class="tg" data-a="pr-flag" data-v="2"><span>·&nbsp; Ignore by Cleaner staff</span><i class="pill ${g.noclean[i] === true ? 'on' : ''}"></i></button>
    <div class="tg"><span>·&nbsp; Set for all <em>${esc(items.iname(i))}</em></span><i class="pill on"></i></div>
    <button type="button" class="op-btn tick" data-a="close" aria-label="Done"><svg viewBox="0 0 24 24"><path d="M3 12.5 9 18.5 21 5.5" fill="none" stroke="#5ff05f" stroke-width="3.4" stroke-linecap="square"/></svg></button>
  </div>
  <div class="op-keys">${kbd('Up / Down')} ±1 &nbsp; ${kbd('Shift')} ±10 &nbsp; ${kbd('R')} Est. Value &nbsp; ${kbd('1')} for purchase &nbsp; ${kbd('2')} ignore by cleaners &nbsp; ${kbd('Enter')} done</div>
</div>`;
}

// ---------------------------------------------------------------- Employees (C16, op/08, c01 1:31:20)
const JOB_LINE = (s) => {
  if (s.job >= staff.JOB_SCAVENGE) {
    const l = map.LANDMARKS[s.dest];
    return [s.job === staff.JOB_COMBAT ? 'Skull' : s.job === staff.JOB_SHOP ? 'Shop' : 'Crate', `${staff.JOB_NAMES[s.job]} ${l ? l.name : ''}`];
  }
  return [['List', 'Shop', 'Cart', 'Shield', 'Wrench'][s.job] || 'List', s.job === staff.JOB_NONE ? 'Waiting for a job' : staff.JOB_NAMES[s.job]];
};
/** Combat Power on the original's scale: `StaffMobObject.CalculateCombatPower` = round(multiplier x (BaseCombatPower +
 *  sum of CombatProficiency of the carried weapons + strongest weapon x 0.01) x 100). The rules (map.js) keep it / 100 with
 *  the Security level as BaseCombatPower and the staff gun as the only weapon (staff carry no melee weapon here). */
export function power(g, s) {
  const cm = skills.mul(g, 'StaffCombatPowerMultiplier');
  const gp = s.gun ? staff.gun_proficiency(s.gun.item) * 1.01 : 0.0;
  return Math.round(Math.max(s.levels[1] + gp, 1.0) * (cm > 0 ? cm : 1) * 100);
}
const ROLE = [['Crate', 'Scavenge'], ['Shield', 'Security'], ['Cart', 'Service'], ['Wrench', 'Cleaner']];
/** The staff card of the original (op/08 right card, Hire and Select Job left card): diamond portrait, name, four job
 *  ratings in stars, wages, EQUIPMENT four slots, Combat Power. `hire`: candidate card (no Base Wage row). */
function staffcard(g, s, hire = false) {
  const skl = ROLE.map(([ic, n], k) => `<div class="sk"><span><i>${gl(ic)}</i>${n}</span>${stars(s ? s.levels[k] : 0)}</div>`).join('');
  const eq = [0, 1, 2, 3].map((k) => (k === 0 && s && s.hired ? `<button type="button" class="eq" data-a="gun" title="${s.gun ? 'Take back the gun' : 'Give the gun you hold'}">${s.gun ? ii(s.gun.item) : ''}</button>` : `<span class="eq">${k === 0 && s && s.gun ? ii(s.gun.item) : ''}</span>`)).join('');
  return `<div class="av">${gl('Staff', true)}</div><h3>${s ? esc(s.name) : ''}</h3>
    <div class="sks">${skl}</div><i class="sep"></i>
    <div class="kv"><span>Requested Base Wage:</span><b>${BAT}${s ? s.wage : '/'}</b></div>
    ${hire ? '<div class="gap"></div>' : `<div class="kv"><span>Base Wage:</span><b class="g">${BAT}${s ? s.wage : '/'}</b></div><i class="sep"></i>`}
    <h4>EQUIPMENT</h4><div class="eqs">${eq}</div>
    <div class="kv cp"><span>Combat Power:</span><b><i>${SWORDS}</i><em>${s ? power(g, s) : '/'}</em></b></div>`;
}
function employees(g) {
  const hired = g.staff.filter((s) => s.hired && !s.gone);
  const sel = Math.min(g.staff_sel, Math.max(0, hired.length - 1));
  const list = hired.map((s, k) => {
    const [ic, line] = JOB_LINE(s);
    const hp = Math.max(s.hp, 0);
    return `<button type="button" class="row ${k === sel ? 'sel' : ''}" data-a="emp" data-v="${k}"><span class="av">${gl('Staff', true)}</span>
      <span class="nm"><b>${esc(s.name)}</b><small class="${s.job === staff.JOB_NONE ? 'wait' : ''}"><i>${gl(ic)}</i>${esc(s.job === staff.JOB_NONE ? 'Awaiting job…' : line)}</small></span>
      <span class="hp"><b><i class="ht">${gl('Heart')}</i>${hp.toFixed(0)} / ${staff.STAFF_HP.toFixed(0)}</b><i class="bar"><b style="width:${(hp / staff.STAFF_HP * 100).toFixed(1)}%"></b></i></span></button>`;
  }).join('');
  const s = hired.length ? hired[sel] : null;
  // the original's Employees has no job buttons: a job is chosen on the Select Job panel (Enter / double click a row)
  return `<div class="op-dim"></div><div class="op-emp">
  <div class="lst"><header><h2>Employees</h2></header><div class="rows">${list || `<div class="none">No staff hired yet. Candidates walk in from day 3: look for the ${kbd('H')} Hire prompt.</div>`}</div>
    <footer><i class="pp">${gl('People')}</i><b>${hired.length} / ${staff.max_staff(g)}</b></footer></div>
  <aside class="card"><button class="x" data-a="close" type="button">✕</button>
    ${staffcard(g, s)}
    ${s ? `<div class="act"><button type="button" class="op-btn yel" data-a="job" data-v="${staff.JOB_HOME}">Cancel Job</button><button type="button" class="op-btn red" data-a="fire">Fire Staff</button></div>` : ''}
  </aside>
  <div class="op-keys">${kbd('W / S')} select &nbsp; ${kbd('Enter')} Select Job &nbsp; ${kbd('1')} Cancel Job &nbsp; ${kbd('X')} Fire Staff &nbsp; ${kbd('G')} give / take gun &nbsp; ${kbd('E')} close &nbsp;·&nbsp; Trips: World Map ${kbd('M')}</div>
</div>`;
}

// ---------------------------------------------------------------- Hire this person? (C18, clip 03 f_3784, sheet 4:10:00)
function hire(g) {
  const s = g.staff[g.panel.a] || null;
  return `<div class="op-hire"><aside class="card">${staffcard(g, s, true)}</aside>
  <div class="ask"><h2>Hire this person?</h2><div class="b"><button type="button" class="op-btn red" data-a="hire-no">REJECT</button><button type="button" class="op-btn grn" data-a="hire-yes">HIRE</button></div></div>
  <div class="op-keys">${kbd('H')} / ${kbd('Enter')} Hire &nbsp; ${kbd('N')} Reject &nbsp; ${kbd('Esc')} not now</div></div>`;
}

// ---------------------------------------------------------------- Name your new, uh 'helper'... (C33, clip 01 5:00:40)
function naming(g) {
  if (S.nameV0 === null) S.nameV0 = g.panel.v || '';
  return `<div class="op-name"><h2>Name your new, uh, 'helper'...</h2>
  <p>It seems like the infection in this guy was just a little too far gone... He can no longer talk, but, he seems non-aggressive.</p>
  <p>As a token of gratititude, he will roam your car park day and night handling threats. Due to him almost becoming a zombie, when knocked out, he will always regenerate over night.</p>
  <div class="b"><input class="nm" type="text" maxlength="20" spellcheck="false" value="${esc(S.nameV0)}" aria-label="Name"><button type="button" class="op-btn grn" data-a="name-ok">OKAY</button></div></div>
  <div class="op-keys">type a name &nbsp; ${kbd('Enter')} Okay</div>`;
}

// ---------------------------------------------------------------- the old owner's notes (C23, loc quest_notes_*)
// Three pages of `Bedroom/IntelStation/Notes` (decoded NotesObject: readable from day 3, each page starts a quest).
export const NOTE_PAGES = [
  ['Welcome to My Store!', ['I used to run this place with love, but I had to leave in a hurry - so excuse the mess!', 'If you’re reading this, you found something to pry the latch. Nice work.', 'Use that same energy in Build Mode via [U]. From there you can upgrade various objects in the bedroom with the right materials.', 'This room kept me alive. Make it better. Make it yours. Hopefully the rest of the pages are still intact for more tips.']],
  ['About the Warehouse', ['Crafting bench, tools, and all my good ideas are in the warehouse.', 'You’ll need a <b>Crowbar</b> for the door. Sadly I had to throw mine at a horde of zombies climbing through the bedroom window.', 'Proceed carefully: we blocked that door for a reason.']],
  ['Finders Keepers', ['Outside the store: keep an eye out for full duffle bags, junk piles, and abandoned trolleys. In a panic people leave so many sellable goods.', 'Its a chaotic world now. The outside restocks itself - new stashes seemingly show up overnight.', 'Grab fast, sort later. Great for when you are running low on stock!']],
];
function notes(g) {
  const pg = Math.min(g.panel.page || 0, NOTE_PAGES.length - 1);
  const [t, lines] = NOTE_PAGES[pg];
  const body = lines.map((l) => `<p>${esc(l).replace(/&lt;b&gt;(.*?)&lt;\/b&gt;/g, '<b>$1</b>')}</p>`).join('');
  return `<div class="op-dim"></div><div class="op-note"><div class="paper"><h2>${esc(t)}</h2>${body}<small>${pg + 1} / ${NOTE_PAGES.length}</small></div>
  <button type="button" class="pv ${pg === 0 ? 'off' : ''}" data-a="note-pg" data-v="${pg - 1}">‹</button><button type="button" class="nx ${pg === NOTE_PAGES.length - 1 ? 'off' : ''}" data-a="note-pg" data-v="${pg + 1}">›</button>
  <div class="op-keys">${kbd('A / D')} page &nbsp; ${kbd('E')} close</div></div>`;
}

// ---------------------------------------------------------------- shelf Configure (C40, clip 07 33:40)
const TY_IC = { Ammo: 'Ammo', Food: 'Hand', Gun: 'Pistol', Medicine: 'Med', Melee: 'Knife', Seeds: 'Planks', Crafting: 'Planks', Tool: 'Wrench', Throwable: 'Throw', Shop: 'Basket', Survival: 'Hand', Defence: 'Shield', Appliance: 'Gear', Decoration: 'Shop' };
function configure(g) {
  const sh = g.shelves[g.panel.a];
  if (sh === undefined) return '';
  const list = items.config_items();
  const sel = Math.min(g.panel.sel || 0, list.length - 1);
  const ok = (i) => sh.allow === null || sh.allow.has(i);
  const types = [...new Set(list.map((i) => items.ty_of(i)))];
  const trow = types.map((t) => { const all = list.filter((i) => items.ty_of(i) === t); const on = all.some(ok); return `<button type="button" class="ct ${on ? '' : 'no'}" data-a="cfg-ty" data-v="${t}" title="${TYPES[t]}">${ctab_svg(TY_IC[TYPES[t]] || 'List')}</button>`; }).join('');
  const cells = list.map((i, k) => `<button type="button" class="cc r${rarity(i)} ${ok(i) ? '' : 'no'} ${k === sel ? 'sel' : ''}" data-a="cfg-it" data-v="${k}" title="${esc(items.iname(i))}"><span class="img">${ii(i)}</span></button>`).join('');
  const name = sh.prop !== 0 ? 'Dual Shelving Unit' : 'Flimsy Wooden Shelf';
  return `<div class="op-dim"></div><div class="op-cfg"><header><h2>${name}</h2><button class="x" data-a="close" type="button">✕</button></header>
  <div class="sub">Shop floor</div>
  <div class="mode"><span>·&nbsp; Storage Mode</span><span class="car"><button type="button" data-a="cfg-mode">‹</button><b>${sh.dedicated ? 'Dedicated' : 'Shop floor'}</b><button type="button" data-a="cfg-mode">›</button></span></div>
  <p>Pick the items or types this storage is for. Cleaners only put those here.</p>
  <div class="types">${trow}</div><div class="grid">${cells}</div>
  <footer><button type="button" class="op-btn red" data-a="cfg-clear">Clear All</button><button type="button" class="op-btn yel" data-a="cfg-content">Set To Content</button><button type="button" class="op-btn tick" data-a="close" aria-label="Done"><svg viewBox="0 0 24 24"><path d="M3 12.5 9 18.5 21 5.5" fill="none" stroke="#5ff05f" stroke-width="3.4" stroke-linecap="square"/></svg></button></footer>
  <div class="op-keys">${kbd('M')} storage mode &nbsp; ${kbd('W A S D')} item &nbsp; ${kbd('Space')} toggle &nbsp; ${kbd('X')} Clear All &nbsp; ${kbd('T')} Set To Content &nbsp; ${kbd('Enter')} done</div></div>`;
}

// ---------------------------------------------------------------- Select Job / Job Details (C17, clip 01 f_22500, clip 07 f_1608)
/** Job tiles in the original's order (two columns): Show World, Security, Service, Cleaner, Send Home. */
export const JOB_TILES = [
  { n: 'Show World', ic: 'Globe', job: -1, jt: 0, d: 'Select a location to work at… Scavenge, shopping and combat trips are chosen on the World Map.' },
  { n: 'Security', ic: 'Shield', job: staff.JOB_SECURITY, jt: 3, d: 'Security workers will risk their lives protecting the store from threats including zombies, thieves and raiders.' },
  { n: 'Service', ic: 'Cart', job: staff.JOB_SERVICE, jt: 2, d: 'Service workers will take away the monotany of serving customers by doing it for you. Service workers must have an empty and accessible checkout to serve from.' },
  { n: 'Cleaner', ic: 'Wrench', job: staff.JOB_CLEANER, jt: 8, d: 'Cleaners will keep on top of the mounting dead bodies in the store, as well as organising fallen items onto shelves.' },
  { n: 'Send Home', ic: 'Shop', job: staff.JOB_HOME, jt: 0, d: "Sending workers home can be a cost-effective way to keep them safe during raid days. They'll still want their base pay rate." },
];
function jobsel(g) {
  const hired = g.staff.filter((s) => s.hired && !s.gone);
  const s = hired[Math.min(g.staff_sel, Math.max(0, hired.length - 1))] || null;
  const sel = g.panel.sel ?? -1;
  const cost = (t) => (t.job === staff.JOB_HOME ? 0 : t.job < 0 ? null : staff.job_cost(g, (s ? s.wage : 0) + staff.JOB_COST[t.job]));
  const tiles = JOB_TILES.map((t, k) => {
    const lock = t.jt !== 0 && !skills.job_unlocked(g, t.jt);
    const c = cost(t);
    return `<button type="button" class="jt ${k === sel ? 'sel' : ''} ${s && s.job === t.job ? 'cur' : ''} ${lock ? 'lock' : ''} ${t.job < 0 ? 'world' : ''}" data-a="jsel" data-v="${k}"><b><i>${gl(t.ic)}</i>${t.n}</b>${c === null ? '' : `<small>Base Cost: ${lock ? '<em>Locked</em>' : `${BAT}<em>${c}</em>`}</small>`}</button>`;
  }).join('');
  const t = sel >= 0 ? JOB_TILES[sel] : null;
  const det = t === null ? '<h3>No Job Selected</h3><p>Select a job from the list to see more information.</p><i class="sep"></i><div class="fill"></div><i class="sep"></i><div class="nj">No job selected.</div>'
    : `<h3>${t.n}</h3><p>${esc(t.d)}</p><i class="sep"></i><div class="fill"></div><i class="sep"></i>${t.job < 0 ? '<div class="nj">Opens the World Map.</div>' : t.jt !== 0 && !skills.job_unlocked(g, t.jt) ? '<div class="nj lk">Locked: unlock the job in the Management skill tree.</div>' : `<div class="nj">Base Cost: ${BAT}${cost(t)}</div>`}`;
  return `<div class="op-dim"></div><div class="op-job"><aside class="card">${staffcard(g, s)}</aside><i class="arw"></i>
  <section class="mid"><header><h2>Select Job</h2></header><div class="tiles">${tiles}</div><p class="hint">Select a job above to assign to this staff member.</p></section>
  <section class="rt"><header><h2>Job Details</h2><button class="x" data-a="jback" type="button">✕</button></header><div class="dt">${det}</div>
    <button type="button" class="op-btn yel assign ${t === null ? 'off' : ''}" data-a="jassign">Assign</button></section>
  <div class="op-keys">${kbd('W A S D')} select &nbsp; ${kbd('Enter')} Assign &nbsp; ${kbd('E')} back to Employees</div></div>`;
}
const CLOCK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#fff"/><path d="M12 6v6l4 2" stroke="#111" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>';
const SWORDS = '<svg viewBox="0 0 24 24"><path d="M4 3l9 9M20 3l-9 9M3 21l4-4M21 21l-4-4M6 15l3 3M18 15l-3 3" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>';

// ---------------------------------------------------------------- Crafting (C07, op/06)
// Category tabs of the original (ALL, Ammo, Throwable, Defence, Gun, Medicine, Melee, Shop, Survival) + our Shredder list.
const CTAB_IC = ['ALL', 'Ammo', 'Throw', 'Shield', 'Pistol', 'Med', 'Knife', 'Basket', 'Hand'];
const TAB_SVG = {
  ALL: '<svg viewBox="0 0 40 24"><path d="M11 12c0-4 4-6 7-3l4 6c3 3 7 1 7-3s-4-6-7-3l-4 6c-3 3-7 1-7-3z" fill="none" stroke="#f5d138" stroke-width="4"/></svg>',
  Ammo: '<svg viewBox="0 0 32 32"><g fill="#fff">' + [5, 12, 19].map((x) => `<path d="M${x} 11c0-4 2-7 3.5-7S${x + 7} 7 ${x + 7} 11v17h-7z"/>`).join('') + '</g></svg>',
  Throw: '<svg viewBox="0 0 32 32"><path d="M16 3l3 6h-2v20h-2V9h-2z" fill="#fff"/></svg>',
  Med: '<svg viewBox="0 0 32 32"><rect x="4" y="9" width="24" height="18" rx="2.5" fill="#fff"/><rect x="11" y="5" width="10" height="5" rx="1.5" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M14 12.5h4v3.5h3.5v4H18v3.5h-4V20h-3.5v-4H14z" fill="#1a3ea6"/></svg>',
  Basket: '<svg viewBox="0 0 32 32"><path d="M3 13h26l-3 14H6z" fill="#fff"/><path d="M9 13l5-8M23 13l-5-8" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><path d="M11 17v7M16 17v7M21 17v7" stroke="#1a3ea6" stroke-width="2"/></svg>',
  Knife: '<svg viewBox="0 0 32 32"><path d="M17 3c2 5 2 11 0 15h-2c-1-5-1-10 2-15zM14.5 19h5v2h-1.5v8h-2v-8h-1.5z" fill="#fff"/></svg>',
};
const ctab_svg = (n) => TAB_SVG[n] || gl(n);
function crafting(g) {
  const CAT = catalog.CAT;
  const shred = g.craft_tab !== 0;
  const cat = g.craft_cat || 0;
  const list = shred ? craft.shreddable(g) : craft.recipes(g);
  const vis = shred ? list.map((ci, k) => k) : list.map((ci, k) => (craft.in_cat(g, ci) ? k : -1)).filter((k) => k >= 0);
  const sel = Math.min(g.craft_sel, Math.max(0, list.length - 1));
  const tabs = craft.CATS.map(([n], k) => `<button type="button" class="tb ${!shred && cat === k ? 'on' : ''}" data-a="ctab" data-v="${k}" title="${n}">${ctab_svg(CTAB_IC[k])}${k === 0 ? '<small>ALL</small>' : ''}</button>`).join('') +
    `<button type="button" class="tb shr ${shred ? 'on' : ''}" data-a="cshred" title="Shredder">${gl('Gear')}<small>Shredder</small></button>`;
  const tiles = vis.map((k) => {
    const ci = list[k];
    if (shred) return `<button type="button" class="tl ${k === sel ? 'sel' : ''} r${rarity(ci)}" data-a="csel" data-v="${k}"><span class="img">${ii(ci)}</span><b>${esc(craft.name(ci))}</b><small>x${craft.have(g, ci)}</small></button>`;
    const known = craft.known(g, ci);
    const ok = known && craft.usable(g, ci);
    if (!known) return `<button type="button" class="tl lock ${k === sel ? 'sel' : ''}" data-a="csel" data-v="${k}"><span class="img sil">${ii(ci)}</span><b>???</b></button>`;
    return `<button type="button" class="tl ${ok ? '' : 'bench'} ${craft.count(g, ci) > 0 && ok ? 'ready' : ''} ${k === sel ? 'sel' : ''} r${rarity(ci)}" data-a="csel" data-v="${k}"><span class="img">${ii(ci)}</span><b>${esc(craft.name(ci))}</b>${stars(rarity(ci) + 1)}</button>`;
  }).join('');
  let det = '';
  if (sel < list.length && vis.includes(sel)) {
    const ci = list[sel];
    if (shred) {
      det = `<div class="hd"><span class="img">${ii(ci)}</span><div><h2 class="r${rarity(ci)}">${esc(craft.name(ci))}</h2><small>You carry ${craft.have(g, ci)}</small></div></div>
        ${g.bld.tiers[build.T_SHREDDER] === 0 ? '<p class="warn">BROKEN: repair it with 96 Sawblade (look at the shredder, [U]).</p>' : ''}
        <h4>Shreds into</h4><div class="mats">${CAT[ci].dis.map(([it, n]) => `<div class="m"><span class="img">${ii(it)}</span><b>${esc(craft.name(it))}</b><em>${n}</em></div>`).join('')}</div>
        <button type="button" class="op-btn grn big" data-a="craft">Shred one <kbd>Enter</kbd></button>`;
    } else if (!craft.known(g, ci)) {
      det = `<div class="hd"><span class="img sil">${ii(ci)}</span><div><h2>???</h2><small>Unknown recipe</small></div></div>
        <p>Learn this recipe from a recipe sheet found while looting, or from a Crafting skill node ${kbd('K')}.</p>
        <button type="button" class="op-btn off big" disabled>Craft Unavailable</button>`;
    } else {
      const r = CAT[ci].craft;
      const benchLow = r.bench > craft.bench_level(g);
      const n = craft.count(g, ci);
      const job = g.craft_job;
      const busy = job !== null;
      det = `<div class="hd"><span class="img">${ii(ci)}</span><div><h2 class="r${rarity(ci)}">${esc(craft.name(ci))}</h2>${stars(rarity(ci) + 1)}<small>${TYPES[items.ty_of(ci)] || ''}</small></div></div>
        <p class="ds">${esc(desc(ci))}</p>
        <div class="kv"><span>Makes</span><b>${r.qty}x in ${craft.secs(g, ci).toFixed(0)}s</b></div>
        <div class="kv"><span>Est. Value</span><b>${BAT}${items.ival(ci)}</b></div>
        <h4>Materials</h4><div class="mats">${r.mats.map(([it, need]) => { const have = craft.have(g, it); return `<div class="m ${have < need ? 'short' : ''}"><span class="img">${ii(it)}</span><b>${esc(craft.name(it))}</b><em>${have}/${need}</em></div>`; }).join('')}</div>
        ${benchLow ? `<p class="warn">Needs a level ${r.bench + 1} crafting bench (upgrade in Build mode).</p>` : ''}
        ${busy ? `<div class="prog"><span>Crafting ${esc(craft.name(job[0]))}... ${Math.min(job[1] / craft.secs(g, job[0]) * 100, 100).toFixed(0)}%${g.craft_queue ? ` (+${g.craft_queue} queued)` : ''}</span><i><b style="width:${Math.min(job[1] / craft.secs(g, job[0]) * 100, 100).toFixed(1)}%"></b></i><button type="button" class="op-btn red sm" data-a="ccancel">Cancel <kbd>X</kbd></button></div>` : ''}
        <div class="times"><button type="button" class="op-btn sm" data-a="ctimes" data-v="-1">−</button><b>x${Math.max(g.craft_plan, 1)}</b><button type="button" class="op-btn sm" data-a="ctimes" data-v="1">+</button><small>can make ${n}</small></div>
        ${!busy && n > 0 && !benchLow ? `<button type="button" class="op-btn grn big" data-a="craft">Craft <kbd>Enter</kbd></button>` : `<button type="button" class="op-btn off big" disabled>Craft Unavailable</button>`}`;
    }
  }
  return `<div class="op-craft">
  <header>${tabs}<button class="x" data-a="close" type="button">✕</button></header>
  <div class="body"><div class="grid">${tiles || '<div class="none">Nothing here.</div>'}</div><aside class="det">${det}</aside></div>
  <div class="op-keys">${kbd('W / S')} select &nbsp; ${kbd('← / →')} category &nbsp; ${kbd('A / D')} times &nbsp; ${kbd('Enter')} craft &nbsp; ${kbd('Tab')} shredder &nbsp; ${kbd('E')} close</div>
</div>`;
}

// ---------------------------------------------------------------- journal top bar (Skills / World Map: op/07, op/09)
function topbar(g, on) {
  const h = Math.trunc(g.minutes / 60), m = Math.trunc(g.minutes % 60);
  const clock = `${String(((h + 11) % 12) + 1).padStart(2, '0')}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  const tab = (k, n) => `<button type="button" class="tt ${on === k ? 'on' : ''}" data-a="jtab" data-v="${k}">${n}</button>`;
  return `<div class="op-top"><div class="l"><span class="bt">${BAT}<b>${g.batteries}</b></span><span class="rp"><i>${gl('Face' + (g.rep < -50 ? 0 : g.rep < 0 ? 1 : g.rep < 25 ? 2 : g.rep < 60 ? 3 : 4))}</i><b>${g.rep.toFixed(0)}%</b></span></div>
  <nav>${tab('Todo', 'To Do List')}${tab('Map', 'World Map')}${tab('Skills', 'Skills')}</nav>
  <div class="r"><b>Day ${g.day}</b><b>${clock}</b><button class="x" data-a="close" type="button">✕</button></div></div>`;
}

// ---------------------------------------------------------------- To Do List page (PARITY Q, op/15)
const TODO_IC = { 'Open For Business': 'Shop', 'Clearing Away the Past': 'Wrench', 'Breaking and Entering': 'Hammer', 'Stocking Up': 'Crate', 'Into the City': 'Gate',
  "You're Hired!": 'Staff', 'Feeling Crafty': 'Hammer', 'City Clean-Up': 'Skull', 'Doing My Part': 'Skull', 'Rude Customer': 'Skull', 'Waste Not Want Not': 'Hand', 'Advanced Warnings': 'Alert', 'Branch Out': 'Skills', 'Back Door Access': 'Gear', 'What Was That Noise?': 'Alert', 'Meat Spin': 'Gear', 'Home Sweet Home': 'Shop', 'Reduce, Re-Use, Recycle': 'Gear', 'Shopping Spree': 'Shop', 'Tear Down This Wall': 'Hammer' };
function todopage(g) {
  const rows = g.todo();
  const list = rows.map(([t, d], k) => `<div class="tq ${k === 0 ? 'cur' : ''}"><h3><i>${k === 0 ? CHECK : gl(TODO_IC[t] || 'List')}</i>${esc(t)}</h3><p>·&nbsp; ${esc(d)}</p></div>`).join('');
  const last = g.toast || '';
  return `<div class="op-todo"><div class="lst">${list || '<div class="tq"><p>Nothing to do right now.</p></div>'}</div>
  <aside class="det">${last ? `<h2><i>${CHECK}</i>${esc(last)}</h2><p>Completed</p><i class="sep"></i>` : ''}</aside>
  <div class="op-keys bl">${kbd('L')} close</div></div>`;
}
const CHECK = '<svg viewBox="0 0 24 24"><path d="M3 12.5 9 18.5 21 5.5" fill="none" stroke="#f5d138" stroke-width="3.6" stroke-linecap="square"/></svg>';

// ---------------------------------------------------------------- Skills (C09, op/07, clip 07 f_1534)
const TREE_CLS = ['svc', 'mgt', 'srv', 'crf'];
// The original's tree layout (decoded `SkillTreeView.SeedStarters` + `FloodFillGrid`, GameScene `_starterPositions`):
// starters sit on fixed grid cells, every other node is placed by a breadth-first walk over the 8 link directions
// (up, down, left, right, up-left, up-right, down-left, down-right; grid y grows downwards), the first placement wins.
// Cells are 192 px apart at 1080p and the view is centred on the starters.
const STARTERS = [
  [['SalesReputationIncrease', 0, -1], ['WasteExperienceIncrease', 0, 1]], // Service
  [['MaximumStaffCount', 0, 0]], // Management
  [['IncreasePlayerMaxHealth', -1, 0], ['LootingSpeedMultiplier', 1, 0]], // Survival
  [['UnlockCraftingRecipe', 0, 0]], // Crafting (Bandage)
];
const STEPS = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];
const OLAY = [null, null, null, null];
export function orig_layout(t) {
  if (OLAY[t] !== null) return OLAY[t];
  const N = data.NODES, list = skills.nodes_of(t), inl = new Set(list), pos = new Map(), q = [];
  for (const [fx, x, y] of STARTERS[t]) {
    const i = list.find((k) => N[k].starter && N[k].fx === fx);
    if (i !== undefined && !pos.has(i)) { pos.set(i, [x, y]); q.push(i); }
  }
  // nodes no walk reaches (none in the data) go to the right of the tree
  for (let k = 0; k < list.length || q.length; ) {
    while (q.length) {
      const a = q.shift(), [x, y] = pos.get(a);
      N[a].links.forEach((b, d) => { if (b >= 0 && inl.has(b) && !pos.has(b)) { pos.set(b, [x + STEPS[d][0], y + STEPS[d][1]]); q.push(b); } });
    }
    while (k < list.length && pos.has(list[k])) k++;
    if (k < list.length) { pos.set(list[k], [Math.max(0, ...[...pos.values()].map((p) => p[0])) + 2, 0]); q.push(list[k]); }
  }
  const at = list.map((i) => pos.get(i));
  const links = [];
  list.forEach((i, ka) => N[i].links.forEach((b) => { const kb = list.indexOf(b); if (kb > ka) links.push([ka, kb]); }));
  const st = STARTERS[t].map(([, x, y]) => [x, y]);
  OLAY[t] = { list, at, links, cx: st.reduce((a, p) => a + p[0], 0) / st.length, cy: st.reduce((a, p) => a + p[1], 0) / st.length };
  return OLAY[t];
}
const SK_CELL = 17.8; // 192 px at 1080p, in vh
const SK_VIEW = [null, null, null, null];
const TREE_ORDER = [0, 2, 1, 3]; // the original's circles: Service (blue), Survival (red), Management (purple), Crafting (yellow)
function skilltree(g) {
  const t = Math.min(g.sk.tab, 3);
  const L = orig_layout(t);
  const list = L.list;
  const sel = Math.min(g.sk.sel, Math.max(0, list.length - 1));
  const [lvl, x, need] = game.level_of(g.xpv[t]);
  const circles = TREE_ORDER.map((k) => `<button type="button" class="ci ${TREE_CLS[k]} ${k === t ? 'on' : ''}" data-a="sktab" data-v="${k}" title="${skills.NAMES[k]}"><span>${gl(skills.TAB_GLYPHS[k])}</span><b>${game.level_of(g.xpv[k])[0] + 1}</b></button>`).join('');
  // view centred on the starters like the original; follows the selected node when it would leave the tree area
  const vw = (typeof innerWidth === 'number' && innerHeight > 0 ? innerWidth / innerHeight * 100 : 177.8) - 44.7;
  let v = SK_VIEW[t] || [L.cx, L.cy];
  if (list.length) {
    const [sx, sy] = L.at[sel];
    if (Math.abs((sx - v[0]) * SK_CELL) > vw / 2 - 7 || (sy - v[1]) * SK_CELL < -33 || (sy - v[1]) * SK_CELL > 40) v = [sx, sy];
  }
  SK_VIEW[t] = v;
  const st = (i) => (skills.on(g, i) ? 'got' : skills.reachable(g, i) ? 'can' : 'no');
  const pos = (k) => [(L.at[k][0] - v[0]) * SK_CELL, (L.at[k][1] - v[1]) * SK_CELL];
  // bridges stop short of the nodes (_minorBridgeStartPadding 64 / _majorBridgeStartPadding 92 px)
  const pad = (k) => (data.NODES[list[k]].minor ? 5.9 : 8.5);
  const lines = L.links.map(([a, b]) => {
    const [x1, y1] = pos(a), [x2, y2] = pos(b), d = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / d, uy = (y2 - y1) / d;
    const pa = pad(a), pb = pad(b);
    if (pa + pb >= d) return '';
    return `<line x1="${(x1 + ux * pa).toFixed(2)}" y1="${(y1 + uy * pa).toFixed(2)}" x2="${(x2 - ux * pb).toFixed(2)}" y2="${(y2 - uy * pb).toFixed(2)}" class="${skills.on(g, list[a]) && skills.on(g, list[b]) ? 'on' : ''}"/>`;
  }).join('');
  const nodes = list.map((i, k) => {
    const nd = data.NODES[i];
    const [px, py] = pos(k);
    return `<button type="button" class="nd ${st(i)} ${nd.minor ? 'minor' : ''} ${k === sel ? 'sel' : ''}" data-a="sknode" data-v="${k}" style="left:${px.toFixed(2)}vh;top:${py.toFixed(2)}vh"><i class="dm"></i><span>${gl(skills.node_glyph(t, i))}</span></button>`;
  }).join('');
  let det = '';
  if (sel < list.length) {
    const i = list[sel];
    const s = st(i);
    const lines2 = skills.describe(i).split('\n').filter((l) => l.trim() !== '');
    det = `<h2><u>${esc(data.NODES[i].name.toUpperCase())}</u></h2><div class="state ${s}">${s === 'got' ? 'UNLOCKED' : s === 'can' ? 'AVAILABLE' : 'LOCKED'}</div>
      <div class="big ${s}"><i class="dm"></i><span>${gl(skills.node_glyph(t, i))}</span></div>
      <div class="ds">${lines2.map((l) => `<p>${esc(l)}</p>`).join('')}</div><i class="sep"></i>
      ${s === 'can' ? `<button type="button" class="op-btn grn big ${g.sk.points[t] > 0 ? '' : 'off'}" data-a="skunlock">${g.sk.points[t] > 0 ? 'Unlock' : 'No skill points'} <kbd>Enter</kbd></button>` : s === 'no' ? '<small class="shint">Unlock a neighbouring node first.</small>' : ''}`;
  }
  return `<div class="op-sk ${TREE_CLS[t]}">
  <div class="band"><div class="cis">${circles}</div><h1>${skills.NAMES[t].toUpperCase()}</h1><div class="lv"><b>Level ${lvl + 1}</b><small>${x} / ${need} XP</small></div></div>
  <div class="pts">UNSPENT POINTS: ${g.sk.points[t]}</div>
  <div class="tree"><div class="cv"><svg viewBox="0 0 1 1">${lines}</svg>${nodes}</div></div>
  <aside class="det">${det}</aside>
  <div class="op-keys bl">${kbd('A / D')} tree &nbsp; ${kbd('W / S')} node &nbsp; ${kbd('Enter')} unlock &nbsp; ${kbd('K')} close</div>
</div>`;
}

// ---------------------------------------------------------------- World Map (C10 / C11, op/09, clip 02 f_740, clip 08 f_220)
// The original is a 3D city seen from above at an angle. Here: the same idea drawn in code as an isometric SVG city
// (procedural blocks, roads, forest), landmark pins at their map positions, dark fog outside the known landmarks,
// red walls with a lock and the toll on closed gates. Map coordinates from map.map_xy (catalog x / z of the landmarks).
const ISO = { W: 1920, H: 1040 };
const iso = (u, v, h = 0) => [ISO.W * 0.5 + (u - v) * 860, 90 + (u + v) * 430 - h];
let CITY = null;
function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return (s >>> 8) / 16777216; }; }
function box(u0, v0, du, dv, h, c) {
  const a = iso(u0, v0), b = iso(u0 + du, v0), cc = iso(u0 + du, v0 + dv), d = iso(u0, v0 + dv);
  const up = (p) => `${p[0].toFixed(1)},${(p[1] - h).toFixed(1)}`;
  const pt = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  const sh = (k) => `rgb(${c.map((x) => Math.round(x * k)).join(',')})`;
  return `<polygon points="${pt(d)} ${pt(cc)} ${up(cc)} ${up(d)}" fill="${sh(0.62)}"/><polygon points="${pt(b)} ${pt(cc)} ${up(cc)} ${up(b)}" fill="${sh(0.8)}"/><polygon points="${up(a)} ${up(b)} ${up(cc)} ${up(d)}" fill="${sh(1)}"/>`;
}
function city() {
  if (CITY !== null) return CITY;
  const R = rng(1337);
  let s = '';
  const quad = (u0, v0, u1, v1, col) => { const p = [iso(u0, v0), iso(u1, v0), iso(u1, v1), iso(u0, v1)]; return `<polygon points="${p.map((q) => q.map((x) => x.toFixed(1)).join(',')).join(' ')}" fill="${col}"/>`; };
  s += quad(-0.6, -0.6, 1.6, 1.6, '#6f8a45'); // grass
  // hills (darker faceted green triangles at the far edge)
  for (let k = 0; k < 26; k++) { const u = -0.5 + R() * 2, v = -0.55 + R() * 0.35; const [x, y] = iso(u, v); const w = 60 + R() * 120; s += `<polygon points="${(x - w).toFixed(0)},${y.toFixed(0)} ${x.toFixed(0)},${(y - w * 0.6).toFixed(0)} ${(x + w).toFixed(0)},${y.toFixed(0)}" fill="${R() < 0.5 ? '#5f7d3c' : '#6b8a44'}"/>`; }
  // city ground: concrete
  s += quad(0.12, 0.02, 1.02, 0.98, '#77776f');
  // roads (grid)
  for (let k = 0; k <= 6; k++) { const u = 0.12 + k * 0.15; s += quad(u - 0.008, 0.02, u + 0.008, 0.98, '#3d3f42'); }
  for (let k = 0; k <= 6; k++) { const v = 0.02 + k * 0.16; s += quad(0.12, v - 0.008, 1.02, v + 0.008, '#3d3f42'); }
  // blocks: buildings sorted back to front
  const bl = [];
  for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) {
    const u0 = 0.12 + a * 0.15 + 0.016, v0 = 0.02 + b * 0.16 + 0.016;
    const n = 1 + Math.floor(R() * 3);
    for (let q = 0; q < n; q++) {
      const du = 0.035 + R() * 0.06, dv = 0.035 + R() * 0.07;
      const uu = u0 + R() * (0.118 - du), vv = v0 + R() * (0.128 - dv);
      const tall = 18 + R() * (a + b < 4 ? 70 : 150);
      const g0 = 0.35 + R() * 0.25;
      const tint = R() < 0.18 ? [150, 96, 70] : R() < 0.3 ? [92, 104, 116] : [Math.round(g0 * 255), Math.round(g0 * 250), Math.round(g0 * 240)];
      bl.push([uu + vv, box(uu, vv, du, dv, tall, tint)]);
    }
  }
  bl.sort((p, q) => p[0] - q[0]);
  s += bl.map((b) => b[1]).join('');
  // forest around the city (dark green cones), back to front
  const tr = [];
  for (let k = 0; k < 1500; k++) {
    const u = -0.55 + R() * 2.1, v = -0.5 + R() * 2.05;
    if (u > 0.08 && u < 1.06 && v > -0.02 && v < 1.02) continue;
    const [x, y] = iso(u, v);
    if (x < -40 || x > ISO.W + 40 || y < -40 || y > ISO.H + 60) continue;
    const h = 30 + R() * 34, w = h * 0.36;
    tr.push([u + v, `<polygon points="${(x - w).toFixed(0)},${y.toFixed(0)} ${x.toFixed(0)},${(y - h).toFixed(0)} ${(x + w).toFixed(0)},${y.toFixed(0)}" fill="${R() < 0.5 ? '#2f4a26' : '#3a5a2c'}"/>`]);
  }
  tr.sort((p, q) => p[0] - q[0]);
  s += tr.map((t) => t[1]).join('');
  CITY = s;
  return s;
}
const LM_GLYPH = (i) => {
  switch (map.LANDMARKS[i].kind) {
    case map.SCAV: return 'Crate';
    case map.GATE: return 'Gate';
    case map.COMBAT: return 'Skull';
    case map.RESOURCE: return 'Planks';
    case map.SHOP: return 'Shop';
    case map.MISSION: return 'Anchor';
    default: return i === 10 ? 'Hammer' : 'Megaphone';
  }
};
// landmark positions spread over the city box (map_xy is 0..1 over the catalog bounds)
const LMP = (i) => { const [u, v] = map.map_xy(i); return [0.1 + u * 0.92, 0.02 + v * 0.95]; };
const SHOP_UV = [0.06, 0.82];
function worldmap(g) {
  const vis = map.visible(g);
  const sel = Math.min(g.lm_sel, Math.max(0, vis.length - 1));
  // fog: light circles around the store and every landmark already reached (lm 2) or visible
  const holes = [[...iso(...SHOP_UV), 330]].concat(vis.map((i) => [...iso(...LMP(i)), g.lm[i] === 2 ? 300 : 210]));
  const mask = `<mask id="opfog"><rect x="0" y="0" width="${ISO.W}" height="${ISO.H}" fill="#fff"/>${holes.map(([x, y, r]) => `<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${r}" ry="${(r * 0.62).toFixed(0)}" fill="url(#opfogg)"/>`).join('')}</mask>`;
  const walls = vis.filter((i) => map.LANDMARKS[i].kind === map.GATE && g.lm[i] !== 2).map((i) => {
    const [u, v] = LMP(i);
    const a = iso(u - 0.05, v + 0.02), b = iso(u + 0.05, v - 0.02);
    return `<polygon class="wall" points="${a[0].toFixed(0)},${a[1].toFixed(0)} ${b[0].toFixed(0)},${b[1].toFixed(0)} ${b[0].toFixed(0)},${(b[1] - 70).toFixed(0)} ${a[0].toFixed(0)},${(a[1] - 70).toFixed(0)}"/>`;
  }).join('');
  const pins = vis.map((i, k) => {
    const l = map.LANDMARKS[i];
    const [x, y] = iso(...LMP(i));
    const closed = l.kind === map.GATE && g.lm[i] !== 2;
    const cls = `${k === sel ? 'sel' : ''} ${g.lm[i] === 2 ? 'done' : ''} ${closed ? 'gate' : ''} ${l.kind === map.COMBAT && g.lm[i] !== 2 ? 'horde' : ''}`;
    return `<button type="button" class="pin ${cls}" data-a="lm" data-v="${k}" style="left:${(x / ISO.W * 100).toFixed(2)}%;top:${(y / ISO.H * 100).toFixed(2)}%">${closed ? `<span class="toll">${BAT}${l.cost}</span><span class="lock">${gl('Lock')}</span>` : `<span class="pn">${gl(LM_GLYPH(i))}</span>`}<small>${esc(l.name)}</small></button>`;
  }).join('');
  const [sx, sy] = iso(...SHOP_UV);
  // [PARITY L03] gốc c01 4:06:40: vạch xanh từ quán tới chỗ nhân viên đang đi (một vạch mỗi điểm đến), vẽ trên lớp sương
  const dests = [...new Set(g.staff.filter((s) => s.hired && !s.gone && s.job >= staff.JOB_SCAVENGE && s.dest >= 0 && vis.includes(s.dest)).map((s) => s.dest))];
  const routes = dests.map((i) => { const [x, y] = iso(...LMP(i)); return `<line class="route" x1="${sx.toFixed(0)}" y1="${sy.toFixed(0)}" x2="${x.toFixed(0)}" y2="${y.toFixed(0)}"/>`; }).join('');
  const shop = `<div class="pin home" style="left:${(sx / ISO.W * 100).toFixed(2)}%;top:${(sy / ISO.H * 100).toFixed(2)}%"><span class="pn">${gl('Shop')}</span><small>Your Store</small></div>`;
  let card = '';
  if (sel < vis.length) { const [cx, cy] = iso(...LMP(vis[sel])); card = lmcard(g, vis[sel], cx / ISO.W * 100, cy / ISO.H * 100); }
  return `<div class="op-map"><div class="world"><svg viewBox="0 0 ${ISO.W} ${ISO.H}" preserveAspectRatio="xMidYMid slice"><defs><radialGradient id="opfogg"><stop offset="0.55" stop-color="#000"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>${mask}</defs>${city()}${walls}<rect class="fog" x="0" y="0" width="${ISO.W}" height="${ISO.H}" mask="url(#opfog)"/>${routes}</svg>${shop}${pins}</div>${card}
  <div class="op-keys bl">${kbd('W / S')} landmark &nbsp; ${kbd('Enter')} go / open &nbsp; ${kbd('M')} close</div></div>`;
}
function lmcard(g, i, px, py) {
  const l = map.LANDMARKS[i];
  const done = g.lm[i] === 2;
  let body = '', btn = '';
  const trips = g.staff.filter((s) => s.hired && !s.gone && s.job >= staff.JOB_SCAVENGE && s.dest === i);
  const staffRow = `<div class="kv"><span>Active Staff</span><b>${trips.length ? trips.map((s) => esc(s.name)).join(', ') : '—'}</b></div>`;
  switch (l.kind) {
    case map.SCAV: {
      const rows = map.loot_rows(g, i);
      body = `<h4>Potential Loot</h4><div class="loot">${rows.slice(0, 10).map((e) => `<span class="it" title="${esc(items.iname(e[0]))}">${ii(e[0])}</span>`).join('')}</div>${staffRow}<div class="kv"><span>Per Delivery</span><b>${BAT}${map.cost_shown(g, i)} + wage</b></div><div class="kv"><span>Travel Time</span><b>${map.hhmm(map.travel_shown(g, i))}</b></div>`; // par-world L03: numbers as the original shows them
      btn = 'Scavenge';
      break;
    }
    case map.GATE:
      body = done ? '<p>The gate is open.</p>' : `<p>Pay the city guard to open the road.</p><div class="kv"><span>Toll</span><b>${BAT}${l.cost}</b></div>`;
      btn = done ? '' : 'Pay';
      break;
    case map.COMBAT: {
      const d = map.lmd(i);
      body = done ? '<p>Beaten.</p>' : `<div class="hpb"><i><b style="width:${(g.lm_hp[i] / l.hp * 100).toFixed(1)}%"></b></i><span>${(g.lm_hp[i] / l.hp * 100).toFixed(0)}% HP</span></div><h4>Reward</h4><div class="loot">${d.rewards.map(([it, n]) => `<span class="it">${ii(it)}<em>${n}</em></span>`).join('')}</div>${staffRow}<div class="kv"><span>Cost</span><b>${BAT}${map.cost_shown(g, i)} + wage</b></div>`;
      btn = done ? '' : 'Join Fight';
      break;
    }
    case map.RESOURCE: {
      const d = map.lmd(i);
      body = done ? '<p>Cleared.</p>' : `<h4>Required</h4><div class="loot">${d.req.map(([it, n]) => `<span class="it ${g.inv[it] < n ? 'short' : ''}">${ii(it)}<em>${g.inv[it]}/${n}</em></span>`).join('')}</div>`;
      btn = done ? '' : 'Repair';
      break;
    }
    case map.SHOP: body = `${staffRow}<div class="kv"><span>Travel Time</span><b>${map.hhmm(map.travel_shown(g, i))}</b></div>`; btn = 'Open Shop'; break;
    case map.MISSION: body = '<p>Sales contracts.</p>'; btn = 'Open'; break;
    default: body = `<p>${i === 10 ? 'Store expansion.' : 'Advertising.'}</p>`; btn = 'Open';
  }
  // the original's popup beside the pin (c01 3:10:20): tag row (kind + travel time), black card with a yellow rim,
  // underlined name, description, Per Delivery; the rows and the button below are this build's trip details
  const left = Math.min(Math.max(px + 5.5, 1), 72), top = Math.min(Math.max(py - 20, 2), 52);
  const tt = l.travel > 0 ? `<span class="tm"><i>${CLOCK}</i>${map.hhmm(map.travel_shown(g, i))}</span>` : ''; // par-world: float32 travel x March Order like the original
  return `<aside class="lmc ${l.kind === map.COMBAT && !done ? 'red' : ''}" style="left:${left.toFixed(2)}%;top:${top.toFixed(2)}%"><div class="tag"><span class="kd"><i>${gl(LM_GLYPH(i))}</i>${['Scavenge', 'Shop', 'Gate', 'Zombie Horde', 'Barricade', 'Docks', 'Service'][l.kind] || ''}</span>${tt}</div>
  <div class="cd"><h2><u>${esc(l.name)}</u></h2><p class="ds">${esc(LM_DESC[l.key] || '')}</p>${body}${btn ? `<button type="button" class="op-btn ${l.kind === map.COMBAT ? 'red' : 'grn'} big" data-a="lmgo">${btn} <kbd>Enter</kbd></button>` : ''}</div></aside>`;
}

// ---------------------------------------------------------------- Settings (C05, c06 0:00)
// Tabs, rows, defaults, ranges and effects live in settings.js (the original's SettingsData of the decoded 1.1.13, rows in
// the original's order; rows the original has but this build has no system for are left out, see PARITY C05). Rows marked
// `extra` (owner's additions) sit under a "MORE OPTIONS" line after the original's rows of the tab.
//   KEYBINDINGS one row per action: Enter / click, then press the new key (input.js remap; swaps with the key that had it,
//   the swap is shown as a conflict line)
export const SET_TABS = ST.TABS;
export const BINDS = [['Move Forward', 'KeyW'], ['Move Left', 'KeyA'], ['Move Back', 'KeyS'], ['Move Right', 'KeyD'], ['Sprint', 'ShiftLeft'], ['Jump', 'Space'],
  // integ: keys of the merged build (par-counter dropped Q price / O store / H hire, fin-build dropped U for build mode B)
  ['Interact', 'KeyE'], ['Rotate Back', 'KeyQ'], ['Reload / Choose Stock', 'KeyR'], ['Drop', 'KeyX'], ['Orient', 'KeyO'], ['Heal', 'KeyF'], ['Backpack', 'Tab'],
  ['Skills', 'KeyK'], ['World Map', 'KeyM'], ['Build Mode', 'KeyB'], ['Pick Up Placed Object', 'KeyV'], ['To Do List', 'KeyL'], ['Configure Shelf', 'KeyC'], ['Inspect Weapon', 'KeyT'],
  ['Weapon Bash', 'KeyZ'], ['Settings', 'KeyP']];
const KEYS_FIXED = [['Look', 'Mouse'], ['Attack / Fire', 'Left Mouse'], ['Take From Shelf', 'Right Mouse'], ['Slots', '1 2 3 4'], ['Controls And Tips', 'F1'], ['Pause', 'Esc']];
const keyname = (c) => ({ ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Left Alt', Space: 'Space' }[c] || c.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, 'Arrow '));
const INP = () => (globalThis.__G && globalThis.__G.input) || null;
/** Physical key that gives the game code `code` now. */
function bound(code) {
  const I = INP();
  if (I === null) return code;
  for (const [p, c] of I.remap) if (c === code) return p;
  return code;
}
function save_keymap(I) { try { localStorage.setItem('twt-keymap', JSON.stringify(Object.fromEntries(I.remap))); } catch (e) { /* no storage: this session only */ } }
/** Bind game code `code` to physical key `phys`: swap with whatever `phys` gave before, so the map stays one-to-one.
 *  Returns a line about the action that had `phys` before and now gets the old key (the conflict), or null. */
export function bind(code, phys) {
  const I = INP();
  if (I === null || phys === 'Escape') return null;
  const cur = bound(code), other = I.remap.get(phys) || phys;
  const was = BINDS.find((b) => b[1] === other && b[1] !== code);
  I.remap.set(phys, code);
  I.remap.set(cur, other);
  for (const [p, c] of [...I.remap]) if (p === c) I.remap.delete(p);
  save_keymap(I);
  return was && cur !== phys ? `${keyname(phys)} was on ${was[0]}: ${was[0]} is now on ${keyname(cur)}` : null;
}
globalThis.__twtKeyRows = BINDS.length;
function settings(g, tier) {
  const t = Math.min(g.panel.tab || 0, ST.TABS.length - 1);
  const V = ST.S;
  const key = (k) => (k ? kbd(k) : '<span></span>');
  const ids = ST.TAB_ROWS[t];
  const sel = Math.min(g.panel.row ?? ST.row0(t), Math.max(ids.length - 1, 0));
  const row = (id, j) => {
    const r = ST.ROWS[id];
    const on = j === sel ? ' sel' : '';
    const hint = j === sel ? '- / =' : r.key || '';
    let ctl = '', val = '';
    if (r.kind === 'slider') {
      const f = ST.frac_of(id, V[id]);
      ctl = `<span class="sl" data-a="set-sl" data-v="${id}"><i style="width:${(f * 100).toFixed(1)}%"></i><b style="left:${(f * 100).toFixed(1)}%"></b></span>`;
      val = r.fmt(V[id]);
    } else if (r.kind === 'toggle') ctl = `<span class="tgw" data-a="set-tg" data-v="${id}"><em>${V[id] ? 'ON' : 'OFF'}</em><i class="pill ${V[id] ? 'on' : ''}"></i></span>`;
    else {
      const cur = id === 'display' ? (ST.is_fullscreen() ? 1 : 0) : id === 'lang' ? 0 : id === 'preset' ? ST.preset_of(V) : V[id];
      ctl = `<span class="sseg">${r.opts.map((n, k) => `<button type="button" class="${k === cur ? 'on' : ''}" data-a="set-sg" data-v="${id}:${k}">${n}</button>`).join('')}</span>`;
      if (id === 'preset' && cur < 0) val = 'Custom';
    }
    return `<div class="row${on}" data-a="set-row" data-v="${j}"><span class="lb">${r.label}</span>${ctl}<span class="vl">${val}</span>${key(hint)}</div>`;
  };
  let rows = '';
  if (t === ST.KB_TAB) {
    const r = Math.min(g.panel.row || 0, BINDS.length - 1);
    rows = `<div class="skeys">${BINDS.map(([a, c], k) => `<button type="button" class="row kb ${k === r ? 'sel' : ''} ${k === r && g.panel.cap ? 'cap' : ''}" data-a="set-key" data-v="${k}"><span class="lb">${a}</span><span class="vl">${k === r && g.panel.cap ? 'Press a key…' : esc(keyname(bound(c)))}</span></button>`).join('')}${KEYS_FIXED.map(([a, k]) => `<div class="row kb fx"><span class="lb">${a}</span><span class="vl">${esc(k)}</span></div>`).join('')}</div>${g.panel.note ? `<div class="snote">${esc(g.panel.note)}</div>` : ''}`;
  } else if (ids.length === 0) rows = '<div class="row"><span class="lb">Game speed, zombie spawns and raid frequency follow the rules of this build (no game presets).</span></div>';
  else {
    const xi = ids.findIndex((id) => ST.ROWS[id].extra);
    rows = ids.map((id, j) => (j === xi ? '<div class="sub">MORE OPTIONS</div>' : '') + row(id, j)).join('');
  }
  const dense = ids.length > 9 ? ' dense' : '';
  return `<div class="op-set${dense}"><h1>Settings</h1>
  <nav>${ST.TABS.map((n, k) => `<button type="button" class="${k === t ? 'on' : ''}" data-a="set-tab" data-v="${k}">${n}</button>`).join('')}</nav>
  <div class="rows">${rows}</div>
  <footer><button type="button" class="op-btn dk" data-a="set-rev">REVERT TO DEFAULT SETTINGS <kbd>Backspace</kbd></button><button type="button" class="op-btn dk" data-a="set-revtab">RESET ${ST.TABS[t]} <kbd>R</kbd></button><button type="button" class="op-btn dk" data-a="close">APPLY <kbd>Enter</kbd></button></footer>
  <div class="op-keys">${kbd('A / D')} tab &nbsp; ${kbd('W / S')} ${t === ST.KB_TAB ? 'action' : 'row'} &nbsp; ${t === ST.KB_TAB ? `${kbd('Enter')} rebind (${kbd('Esc')} cancel) &nbsp; ` : `${kbd('- / =')} change &nbsp; `}${kbd('P')} close</div></div>`;
}
/** Arm the one-shot key capture while the KEYBINDINGS row waits for a key (g.panel.cap, set by Enter in player.js or a click). */
function capture_tick(g) {
  const I = INP();
  if (I === null) return;
  const want = g.mode === 'Play' && g.panel.k === 'Settings' && g.panel.cap === true;
  if (want && I.capture === null) {
    const row = Math.min(g.panel.row || 0, BINDS.length - 1);
    I.capture = (code) => { let note = null; if (code !== 'Escape') note = bind(BINDS[row][1], code); if (g.panel.k === 'Settings') { g.panel.cap = false; g.panel.note = note; } };
  } else if (!want && I.capture !== null) I.capture = null;
}

// ---------------------------------------------------------------- Game Paused (C04, op/13)
export const PAUSE_ITEMS = ['Play', 'Settings', 'Unstuck', 'Return To Menu', 'Quit'];
function pause(g) {
  const sel = g.panel.sel || 0;
  return `<div class="op-pause"><h1>GAME PAUSED</h1><div class="menu">${PAUSE_ITEMS.map((n, k) => `<button type="button" class="${k === sel ? 'sel' : ''}" data-a="pause" data-v="${k}">${n}</button>`).join('')}</div>
  <div class="op-keys">${kbd('W / S')} select &nbsp; ${kbd('Enter')} choose &nbsp; ${kbd('Esc')} back to the game</div></div>`;
}

// ---------------------------------------------------------------- mouse (same rules calls as the keys in sim/player.js)
function click(g, a, v, ctx) {
  const n = Number(v);
  switch (a) {
    case 'close':
      if (g.panel.k === 'Price') g.complete('SetPrice');
      g.panel = g.panel.k === 'Settings' && g.panel.from === 'Pause' ? { k: 'Pause', sel: 1 } : { k: 'None' };
      return;
    case 'sum-ok': press(ctx, 'Enter'); return;
    case 'note-pg': if (n >= 0 && n < NOTE_PAGES.length) g.panel.page = n; return;
    case 'cfg-mode': { const sh = g.shelves[g.panel.a]; if (sh) sh.dedicated = !sh.dedicated; return; }
    case 'cfg-it': { const sh = g.shelves[g.panel.a]; g.panel.sel = n; if (sh) items.config_toggle(sh, items.config_items()[n]); return; }
    case 'cfg-ty': {
      const sh = g.shelves[g.panel.a];
      if (!sh) return;
      const all = items.config_items().filter((i) => items.ty_of(i) === n);
      const on = all.some((i) => sh.allow === null || sh.allow.has(i));
      if (sh.allow === null) sh.allow = new Set(items.config_items());
      for (const i of all) if (on) sh.allow.delete(i); else sh.allow.add(i);
      if (sh.allow.size === items.config_items().length) sh.allow = null;
      return;
    }
    case 'cfg-clear': press(ctx, 'KeyX'); return;
    case 'cfg-content': press(ctx, 'KeyT'); return;
    case 'pr-flag': { const i = g.panel.a; if (n === 1) g.avail[i] = !(g.avail[i] !== false); else g.noclean[i] = !(g.noclean[i] === true); g.play('click', 0.4); return; } // cờ chung theo loại món (g.avail / g.noclean, như bảng Item Details của fin-build)
    case 'pr-ev': g.prices[g.panel.a] = Math.max(items.ival(g.panel.a), 1); g.play('click', 0.4); return;
    case 'pr': {
      const i = g.panel.a, p = g.prices[i];
      const d = String(v).endsWith('%') ? Math.max(1, Math.round(p * Math.abs(parseFloat(v)) / 100)) * Math.sign(parseFloat(v)) : n;
      g.prices[i] = Math.min(Math.max(p + d, 1), 99999);
      g.play('click', 0.4);
      return;
    }
    case 'emp': if (g.staff_sel === n && performance.now() - S.lastEmp < 400) g.panel = { k: 'Job', sel: -1 }; g.staff_sel = n; S.lastEmp = performance.now(); return;
    case 'hire-yes': staff.hire_answer(g, true); return;
    case 'hire-no': staff.hire_answer(g, false); return;
    case 'jsel': g.panel.sel = n; return;
    case 'jassign': if ((g.panel.sel ?? -1) >= 0) staff.assign_tile(g, g.panel.sel); return;
    case 'jback': g.panel = { k: 'Jobs' }; return;
    case 'name-ok': { const f = S.el && S.el.querySelector('input.nm'); if (f) g.panel.v = f.value; typing(false); press(ctx, 'Enter'); return; }
    case 'job': staff.assign(g, n); return;
    case 'fire': staff.fire(g); return;
    case 'gun': staff.give_gun(g); return;
    case 'ctab': g.craft_tab = 0; g.craft_cat = n; craft.cat_first(g); return;
    case 'cshred': g.craft_tab = 1; g.craft_sel = 0; return;
    case 'csel': g.craft_sel = n; return;
    case 'craft': craft.act(g); return;
    case 'ccancel': if (g.craft_job !== null) { g.craft_job = null; g.craft_queue = 0; g.say('Crafting cancelled. Nothing was used up.'); } return;
    case 'ctimes': g.craft_plan = Math.min(Math.max(g.craft_plan + n, 1), 99); return;
    case 'jtab':
      if (v === 'Map' && g.on(game.FF_MAP)) g.panel = { k: 'Map' };
      else if (v === 'Skills' && g.on(game.FF_SKILLS)) g.panel = { k: 'Skills' };
      else if (v === 'Todo') g.panel = { k: 'Todo' };
      return;
    case 'sktab': g.sk.tab = n; g.sk.sel = 0; return;
    case 'sknode': g.sk.sel = n; return;
    case 'skunlock': { const list = skills.nodes_of(Math.min(g.sk.tab, 3)); const k = Math.min(g.sk.sel, list.length - 1); if (k >= 0) skills.unlock(g, list[k]); return; }
    case 'lm': g.lm_sel = n; return;
    case 'lmgo': map.act(g); return;
    case 'set-tab': g.panel.tab = n; g.panel.row = ST.row0(n); g.panel.note = null; return;
    case 'set-row': g.panel.row = n; return;
    case 'set-tg': ST.bump(v, 1); sync_game(g); return;
    case 'set-sg': { const [id, k] = String(v).split(':'); if (id === 'display') ST.fullscreen(+k === 1); else if (id !== 'lang') ST.set(id, +k); sync_game(g); S.raw = ''; return; }
    case 'set-key': g.panel.row = n; g.panel.cap = true; g.panel.note = null; return;
    case 'set-revtab': press(ctx, 'KeyR'); return;
    case 'set-rev': press(ctx, 'Backspace'); return;
    case 'pause': g.panel.sel = n; press(ctx, 'Enter'); return;
    default: break;
  }
}
/** Settings changed by the mouse: keep the rules-side copies (sensitivity, invert, volume) in step. */
function sync_game(g) { g.sens = ST.S.sens; g.invert = ST.S.invert; g.volume = ST.S.master; }
/** Slider click: value from the click position. */
function slide(g, a, frac, ctx, v) {
  frac = Math.min(Math.max(frac, 0), 1);
  if (a === 'set-sl' && v) { ST.set(v, ST.from_frac(v, frac)); sync_game(g); }
}
/** Feed a key into the same input queue the keyboard uses (the rules then act on it next frame, exactly like the key). */
function press(ctx, code) {
  if (!ctx || !ctx.keys || code.startsWith('__')) return;
  ctx.keys.press(code);
  setTimeout(() => ctx.keys.release(code), 30);
}
// ---------------------------------------------------------------- DOM
const S = { el: null, g: null, ctx: null, raw: '', on: false, unlocked: false, lastEmp: -1e9, nameV0: null };
/** Text field focus: the game input (input.js) ignores the keyboard while typing. */
function typing(on) { const I = globalThis.__G && globalThis.__G.input; if (I) I.typing = on; }
export function install(root, g, ctx) {
  if (typeof document === 'undefined') return;
  if (!document.querySelector('link[href*="opanels.css"]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = new URL('../css/opanels.css', import.meta.url).href;
    document.head.appendChild(l);
  }
  const el = document.createElement('div');
  el.className = 'op';
  el.hidden = true;
  root.appendChild(el);
  S.el = el; S.g = g; S.ctx = ctx || null;
  el.addEventListener('mousedown', (e) => {
    const sl = e.target.closest('.sl[data-a]');
    if (sl !== null) {
      const r = sl.getBoundingClientRect();
      slide(S.g, sl.dataset.a, (e.clientX - r.left) / Math.max(r.width, 1), S.ctx, sl.dataset.v);
      const rw = sl.closest('[data-a="set-row"]'); if (rw) S.g.panel.row = Number(rw.dataset.v);
      e.preventDefault();
      return;
    }
    if (e.target.closest('input')) return; // let the text field take focus
    const t = e.target.closest('[data-a]');
    if (t !== null && !t.disabled) { click(S.g, t.dataset.a, t.dataset.v, S.ctx); e.preventDefault(); }
  });
  // C33 name field: typing goes to the field, Enter / Esc hand the key back to the game input queue
  el.addEventListener('input', (e) => { if (e.target.matches('input.nm') && S.g && S.g.panel.k === 'Name') S.g.panel.v = e.target.value; });
  el.addEventListener('focusin', (e) => { if (e.target.matches('input')) typing(true); });
  el.addEventListener('focusout', (e) => { if (e.target.matches('input')) typing(false); });
  el.addEventListener('keydown', (e) => {
    if (!e.target.matches('input')) return;
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Escape') { e.preventDefault(); e.target.blur(); typing(false); press(S.ctx, e.code === 'Escape' ? 'Escape' : 'Enter'); }
  });
  // Esc while the mouse is locked: the browser takes the key and only drops the lock; open the pause menu then.
  document.addEventListener('pointerlockchange', () => {
    const gg = S.g;
    if (document.pointerLockElement || gg === null || S.unlocked) return;
    if (S.ctx && S.ctx.cursor && S.ctx.cursor.want && gg.mode === 'Play' && gg.cine === null && gg.panel.k === 'None') gg.panel = { k: 'Pause', sel: 0 };
  });
}
/** Draw the panel for this frame. Returns true when this module drew it (hud.js then hides its own panels). */
export function update(g, tier) {
  if (S.el === null) return false;
  S.g = g;
  capture_tick(g);
  const h = html(g, tier);
  const on = h !== null;
  if (on) {
    const k = which(g);
    if (S.el.dataset.p !== k) S.el.dataset.p = k;
    if (S.raw !== h) {
      S.raw = h; S.el.innerHTML = h;
      const f = S.el.querySelector('input.nm');
      if (f !== null) { f.focus(); f.select(); }
    }
    // the original shows the mouse cursor on its panels: free it while a panel is open, lock it again on close
    if (document.pointerLockElement) { S.unlocked = true; document.exitPointerLock(); }
  } else if (S.on && S.unlocked) {
    S.unlocked = false;
    if (S.ctx && S.ctx.cursor && g.mode === 'Play' && g.panel.k === 'None') S.ctx.cursor.lock();
  }
  if (S.on !== on) { S.on = on; S.el.hidden = !on; if (!on) { S.raw = ''; S.el.innerHTML = ''; } }
  if (!on || which(g) !== 'Name') { if (S.nameV0 !== null) { S.nameV0 = null; typing(false); } }
  return on;
}
