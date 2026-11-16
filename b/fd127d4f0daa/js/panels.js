// [phiên 8 đợt 3] The last text panels as card / sheet panels in the batch-2 style: Job Board, Radio, Settings, Daily Summary,
// Set Price. Presentation only: every value and every key comes from the same rules state and the same key handlers as the
// old text panels (hud.js panel_text, staff.panel_text); the text panels stay as the fallback (?panels=text).
// Return shape = the cards struct of sim/*.cards (head, tabs, cards, sel, det_icon, det_title, det, foot) plus an optional
// `sheet` ({ hero: {icon, title, sub}, big: {value, unit, note, lo, hi, mark}, rows: [{key, label, value, bar, st, seg}], note })
// that hud.js draws instead of the card grid.
import * as game from './sim/game.js';
import * as items from './sim/items.js';
import * as staff from './sim/staff.js';
import * as skills from './sim/skills.js';
import * as build from './sim/build.js';
import * as data from './sim/data.js';
import * as map from './sim/map.js';
import * as save from './sim/save.js';

const TEXT = typeof location !== 'undefined' && /[?&]panels=text\b/.test(location.search);
const blank = () => ({ head: '', tabs: [], cards: [], sel: -1, det_icon: null, det_title: '', det: '', foot: '', sheet: null });
const stars = (n) => (n > 0 ? '★'.repeat(n) : '-');

/** Card / sheet struct for the panel on screen, or null when this module does not draw it. */
export function panel(g, tier) {
  if (TEXT) return null;
  if (g.mode === 'Summary') return summary(g);
  if (g.mode === 'Title' && g.panel.k === 'Saves') return saves(g);
  if (g.mode !== 'Play') return null;
  switch (g.panel.k) {
    case 'Help': return help(g);
    case 'Jobs': return jobs(g);
    case 'Radio': return radio(g);
    case 'Settings': return settings(g, tier);
    case 'Price': return price(g);
    default: return null;
  }
}

// ---------- Job Board (staff.panel_text) ----------
function jobs(g) {
  const c = blank();
  const hired = g.staff.filter((s) => s.hired && !s.gone);
  c.head = `JOB BOARD      staff ${hired.length}/${staff.max_staff(g)}      Batteries ${g.batteries}`;
  const sel = Math.min(g.staff_sel, Math.max(0, hired.length - 1));
  const jobOf = (s) => (s.job >= staff.JOB_SCAVENGE ? `${staff.JOB_NAMES[s.job]}: ${map.LANDMARKS[s.dest].name}` : staff.JOB_NAMES[s.job]);
  c.cards = hired.map((s) => ({ icon: { k: 'Glyph', a: 'Staff' }, name: s.name, sub: `${jobOf(s)}\nwage ${s.wage}${s.gun ? '  + gun' : ''}`, state: s.hp <= 0 ? 3 : s.job === 0 ? 0 : 2 }));
  c.sel = hired.length ? sel : -1;
  if (hired.length === 0) {
    c.det_icon = { k: 'Glyph', a: 'People' };
    c.det_title = 'No staff yet';
    c.empty = 'No staff hired yet. Candidates walk in from day 3.';
    c.det = 'From day 3 candidates walk in and follow you: look for the [H] Hire prompt.\n\nScavenge, shop and combat trips are assigned on the World Map [M].\nJobs end every morning and must be assigned (and paid) again.';
  } else {
    const s = hired[sel];
    const lock = (jt) => (skills.job_unlocked(g, jt) ? '' : '  (locked)');
    const anyLock = [2, 3, 8].some((jt) => !skills.job_unlocked(g, jt));
    c.det_icon = { k: 'Glyph', a: 'Staff' };
    c.det_title = s.name;
    c.det = `Job: ${jobOf(s)}\nWage: ${s.wage} Batteries a day\nHP: ${Math.max(s.hp, 0).toFixed(0)}\nScavenger: ${stars(s.levels[0])}\nSecurity: ${stars(s.levels[1])}\nService: ${stars(s.levels[2])}\nCleaner: ${stars(s.levels[3])}`;
    // phiên 8 đợt 4: các việc giao được nằm dưới lưới (c.below), khung chi tiết chỉ còn chỉ số nên bảng không cao vống
    c.below = `ASSIGN A JOB TO ${s.name.toUpperCase()}\n` +
      `[1] Home: free\n[2] Service at the till: ${staff.job_cost(g, s.wage + staff.JOB_COST[2])} Batteries${lock(2)}\n[3] Security at the door: ${staff.job_cost(g, s.wage + staff.JOB_COST[3])} Batteries${lock(3)}\n[4] Cleaner (needs Cleaner ★★★): ${staff.job_cost(g, s.wage + staff.JOB_COST[4])} Batteries${lock(8)}\n[X] Dismiss ${s.name}
[G] ${s.gun ? `Take back the ${items.iname(s.gun.item)}` : 'Hand over the gun you hold (Security shoots with it)'}` +
      (anyLock ? '\n\nLocked jobs open with Management skills [K].' : '');
  }
  c.foot = 'Trips (scavenge, shop, combat) are assigned on the World Map [M]. Jobs end every morning.\n[W / S] select staff    [1-4] assign job    [G] give / take gun    [X] dismiss    [E] close';
  return c;
}

// ---------- Radio (hud.js panel_text 'Radio') ----------
function radio(g) {
  const c = blank();
  const lvl = g.bld.tiers[build.T_INTEL];
  const left = g.raid.next_day - g.day;
  const name = g.raid.index < data.RAID_DEFS.length ? data.RAID_DEFS[g.raid.index][0] : 'Hellraid';
  let intel, st;
  if (g.raid.active) { intel = 'The horde is at your door!'; st = 'NOW'; }
  else if (g.raid.next_day >= 9000) { intel = 'No horde is heading this way.'; st = 'QUIET'; }
  else if (left <= 1 || lvl >= 3) { intel = `The ${name} horde comes from the EAST.\nExpected: Day ${g.raid.next_day} at 09:30 AM.`; st = 'INCOMING'; }
  else if (left <= (lvl >= 2 ? 5 : 3)) { intel = `A horde is gathering. Expect it within ${lvl >= 2 ? 5 : 3} days.`; st = 'GATHERING'; }
  else { intel = 'Quiet for now. (A better radio hears further ahead.)'; st = 'QUIET'; }
  c.head = `RADIO      Batteries ${g.batteries}`;
  const runs = [['Outer City Depots', 2, 'tools, parts', 'Truck'], ['Exit Tunnel', 3, 'tinned food, beer', 'Crate']];
  c.cards = runs.map(([n, cost, what, ic], k) => ({ icon: { k: 'Glyph', a: ic }, name: `[${k + 1}] ${n}`, sub: g.scav[k] ? 'SENT' : `${cost} Batteries\n${what}`, state: g.scav[k] ? 2 : g.batteries < cost ? 3 : 0 }));
  c.sel = -1;
  c.det_icon = { k: 'Glyph', a: g.raid.active || st === 'INCOMING' ? 'Skull' : 'Alert' };
  c.det_title = 'RAID INTEL';
  c.det = `${st}\n${intel}\n\nRadio level: ${lvl + 1}\nA better radio (build menu) hears raids further ahead.`;
  c.foot = 'SCAVENGE RUNS: the crate arrives outside next morning.\n[1] send to Outer City Depots    [2] send to Exit Tunnel    [E] close';
  return c;
}

// ---------- Settings (hud.js panel_text 'Settings') ----------
function settings(g, tier) {
  const c = blank();
  c.head = 'SETTINGS';
  const t = Math.min(tier, 2);
  c.sheet = {
    rows: [
      { key: 'G', label: 'Graphics', value: ['Low', 'Medium', 'High'][t], seg: [3, t] },
      { key: '[ / ]', label: 'Mouse sensitivity', value: g.sens.toFixed(1), bar: Math.min(g.sens / 3, 1) },
      { key: '- / =', label: 'Volume', value: `${(g.volume * 100).toFixed(0)}%`, bar: g.volume },
      { key: 'I', label: 'Invert Y', value: g.invert ? 'On' : 'Off', st: g.invert ? 'good' : 'dim' },
    ],
  };
  c.foot = '[P] close';
  return c;
}

// ---------- Daily Summary (hud.js panel_text 'Summary', strings of the original) ----------
function summary(g) {
  const c = blank();
  const s = g.last_stats;
  const profit = s.income - s.outgoings + s.other;
  const d = s.rep_delta;
  c.head = `DAILY SUMMARY - DAY ${g.day - 1}`;
  c.sheet = {
    hero: { icon: { k: 'Glyph', a: 'Shop' }, title: `Day ${g.day - 1}`, sub: `${s.served} customer${s.served === 1 ? '' : 's'} served` },
    rows: [
      { label: 'Customers served', value: String(s.served) },
      { label: 'Income', value: `+${s.income} Batteries`, st: 'good' },
      { label: 'Outgoings', value: `-${s.outgoings} Batteries`, st: s.outgoings > 0 ? 'bad' : '' },
      { label: 'Other', value: `${s.other} Batteries` },
      { label: 'Profit', value: `${profit} Batteries`, st: profit >= 0 ? 'good big' : 'bad big' },
      { label: 'Reputation', value: `${g.rep.toFixed(1)}%   (daily change ${d > 0 || (d === 0 && !Object.is(d, -0)) ? '+' : ''}${d.toFixed(2)})`, bar: Math.min(Math.max(g.rep / 100, 0), 1), st: d >= 0 ? '' : 'bad' },
      { label: 'Zombies killed', value: String(s.kills) },
    ],
  };
  c.foot = '[Enter] Okay';
  return c;
}

// ---------- Set Price (hud.js panel_text 'Price') ----------
function price(g) {
  const c = blank();
  const i = g.panel.a;
  const v = items.ival(i), p = g.prices[i];
  const cap = Math.trunc(Math.fround(v * 2.25));
  c.head = `SET PRICE      Batteries ${g.batteries}`;
  const r = p / Math.max(v, 1);
  c.sheet = {
    hero: { icon: { k: 'Item', a: i }, title: items.iname(i), sub: `Market value: ${v} Batteries` },
    big: { value: String(p), unit: 'Batteries each', note: p > cap ? `Too high: customers will not buy above ${cap}` : `${r.toFixed(2)}x market value`, st: p > cap ? 'bad' : r <= 1.0001 ? 'good' : '', lo: 0, hi: 2.5, mark: Math.min(r / 2.5, 1), cap: 2.25 / 2.5 },
    note: `Customers will not buy above 2.25x value (${cap} Batteries).`,
  };
  c.foot = '[Up / Down] +-1    [Shift] +-10    [R] reset to value    [Enter] done';
  return c;
}

// ---------- Help (hud.js panel_text 'Help': CONTROLS, skill levels, tips) ----------
const HELP_KEYS = [
  ['WASD', 'Move'], ['Mouse', 'Look (or arrow keys)'], ['Shift', 'Sprint'], ['Space', 'Jump'],
  ['E', 'Use'], ['hold E', 'Search, sweep, repair, pry, secure'], ['LMB', 'Attack / fire / hold to throw'], ['RMB', 'Take from shelf'],
  ['Q', 'Set price'], ['R', 'Reload, rotate a build, choose stock'], ['X', 'Drop'], ['O', 'Open / close store'],
  ['1', 'Hands'], ['2', 'Melee'], ['3', 'Gun'], ['4', 'Throwable'], ['F', 'Heal'], ['B', 'Quick barbed wire'],
  ['Tab', 'Backpack (equip, build, learn, paint)'], ['K', 'Skills'], ['M', 'World map'], ['U', 'Upgrade (bench, bed, shredder...)'],
  ['hold V', 'Pick up a placed object'], ['L', 'This help'], ['P', 'Settings'],
];
function help(g) {
  const c = blank();
  c.head = 'CONTROLS AND TIPS';
  const lv = (k) => game.level_of(g.xpv[k]);
  c.sheet = {
    cols: 3,
    rows: HELP_KEYS.map(([key, label]) => ({ key, label, value: '' })),
    after: [
      { title: 'SKILLS', rows: [0, 1, 2, 3].map((k) => { const [l, x, n] = lv(k); return { label: `${skills.NAMES[k]} ${l + 1}`, value: `${x}/${n} XP`, bar: n > 0 ? x / n : 1 }; }) },
      { title: 'TIPS', lines: ['Stock the shelves, flip the entrance switch, then serve from behind the counter.', 'Check every battery, bin the fakes. Customers stop buying above 2.25x value.', 'You can sleep after 07:00 PM. The radio sends scavenge runs and warns about raids.', 'A crowbar opens the warehouse (crafting bench, shredder, generator).'] },
    ],
  };
  c.foot = '[L] close';
  return c;
}

// ---------- Saved games (save.panel_text, title screen [V]) ----------
function saves(g) {
  const c = blank();
  c.head = 'SAVED GAMES';
  const sum = [];
  for (let s = 0; s < 3; s++) sum.push([save_summary(s, false), save_summary(s, true)]);
  c.cards = sum.map(([cur, prev], s) => ({ icon: { k: 'Glyph', a: cur ? 'Shop' : 'List' }, name: `Slot ${s + 1}`, sub: cur ? cur.split('   ').slice(0, 2).join('\n') : '(empty)', state: cur ? 0 : 1 }));
  c.sel = Math.min(g.slot, 2);
  const [cur, prev] = sum[c.sel];
  c.det_icon = { k: 'Glyph', a: cur ? 'Shop' : 'List' };
  c.det_title = `Slot ${c.sel + 1}`;
  const rows = (s) => s.split('   ').map((part) => { const m = part.match(/^(Day|reputation|skills)\s+(.*)$/); if (m) return `${m[1][0].toUpperCase() + m[1].slice(1)}: ${m[2]}`; const b = part.match(/^(\d+) Batteries$/); return b ? `Batteries: ${b[1]}` : part; }).join('\n');
  c.det = cur ? `${rows(cur)}${prev ? `\n\nPREVIOUS NIGHT ([R] rewind)\n${rows(prev)}` : ''}` : 'Empty slot.\n[N] starts a new game here.';
  c.foot = '[W / S] select    [Enter] load    [R] rewind to the previous night    [N] new game in this slot    [X] delete    [V] back';
  return c;
}
function save_summary(slot, prev) { return save.summary(slot, prev); }

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/** HTML of a sheet (hud.js passes its key-cap renderer `kc` and icon renderer `icon`). */
export function sheet_html(sh, kc, icon) {
  let h = '';
  if (sh.hero) h += `<div class="sh-hero"><span class="ic">${icon(sh.hero.icon)}</span><div><h3>${esc(sh.hero.title)}</h3><small>${esc(sh.hero.sub || '')}</small></div></div>`;
  if (sh.big) {
    const b = sh.big;
    h += `<div class="sh-big ${b.st || ''}"><div class="sh-num"><span class="arr">◀</span><b>${esc(b.value)}</b><span class="arr">▶</span><em>${esc(b.unit)}</em></div>` +
      `<i class="sh-scale"><b class="${b.st || ''}" style="width:${(b.mark * 100).toFixed(1)}%"></b><s style="left:${(b.cap * 100).toFixed(1)}%"></s><u style="left:${(1 / 2.5 * 100).toFixed(1)}%"></u></i>` +
      `<div class="sh-scale-lb"><span>0</span><span style="left:${(1 / 2.5 * 100).toFixed(1)}%">1x value</span><span style="left:${(b.cap * 100).toFixed(1)}%">2.25x max</span></div><p>${esc(b.note)}</p></div>`;
  }
  const rowsHtml = (list) => list.map((r) => {
    let val = r.value === '' ? '' : `<b>${esc(r.value)}</b>`;
    if (r.seg) val = `<span class="sh-seg">${Array.from({ length: r.seg[0] }, (_, k) => `<i class="${k <= r.seg[1] ? 'on' : ''}"></i>`).join('')}</span>` + val;
    else if (r.bar !== undefined) val = `<i class="sh-bar"><b style="width:${(Math.min(Math.max(r.bar, 0), 1) * 100).toFixed(1)}%"></b></i>` + val;
    return `<div class="sh-row ${r.st || ''}">${r.key ? kc(r.key) : ''}<span class="lb">${esc(r.label)}</span>${val}</div>`;
  }).join('');
  if (sh.rows && sh.cols) h += `<div class="sh-rows c${sh.cols}">${rowsHtml(sh.rows)}</div>`;
  else if (sh.rows) {
    h += '<div class="sh-rows">';
    for (const r of sh.rows) {
      let val = `<b>${esc(r.value)}</b>`;
      if (r.seg) val = `<span class="sh-seg">${Array.from({ length: r.seg[0] }, (_, k) => `<i class="${k <= r.seg[1] ? 'on' : ''}"></i>`).join('')}</span>` + val;
      else if (r.bar !== undefined) val = `<i class="sh-bar"><b style="width:${(Math.min(Math.max(r.bar, 0), 1) * 100).toFixed(1)}%"></b></i>` + val;
      h += `<div class="sh-row ${r.st || ''}">${r.key ? kc(r.key) : ''}<span class="lb">${esc(r.label)}</span>${val}</div>`;
    }
    h += '</div>';
  }
  for (const a of sh.after || []) {
    h += `<div class="sh-sec"><h4>${esc(a.title)}</h4>${a.rows ? `<div class="sh-rows c2">${rowsHtml(a.rows)}</div>` : ''}${(a.lines || []).map((l) => `<p>${esc(l)}</p>`).join('')}</div>`;
  }
  if (sh.note) h += `<p class="sh-note">${esc(sh.note)}</p>`;
  return h;
}

/* VIEW NOTES
   Keys and effects are unchanged (sim/player.js handles Price / Settings / Radio / Jobs keys; Summary closes on Enter).
   game.js `scav` (2 radio runs), `last_stats`, `prices`, `sens`, `volume`, `invert`; staff.js JOB_NAMES / JOB_COST /
   job_cost / max_staff / JOB_SCAVENGE. ?panels=text shows the old text panels.
*/
