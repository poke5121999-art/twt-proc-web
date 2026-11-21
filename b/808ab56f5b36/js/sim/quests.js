// To Do / quest engine as in The Walking Trade 1.1.13 (FTUE-AUDIT A2, decoded code in ~/handoff/ftue/work/orig-code.md).
//
// The original drives the To Do list with QuestWaveManagers: a wave walks its list of quests in order, skips the ones already
// complete, DISPLAYS the next one and waits for it. Four waves:
//   DayOne    (starts with the game)        EnterShop, Trash, Sweep, Hammer, JammedDoor, PickBox, FillBox, Shelve, OpenStore, ServeFirst
//   EndOfDay  (19:00 with the store open)   CloseStore, Sleep                 (no day gate: every evening until both are done)
//   Combat    (day-2 zombie attack)         KillZombie, LootZombie, AssignJob, RepairDoor, OpenPackage
//   Crafting  (warehouse opened, day >= 2)  OpenWarehouse, FindRecipe, LearnRecipe, CraftItem, LearnBandages, CraftItems,
//                                           LearnMediumCrates, UpgradeBench
// Other quests are displayed by their own trigger (first skill level-up, first hire, raid reveal, Notes pages, landmarks...).
// A quest completes on its game event whether or not it is displayed (silently when not displayed) and a displayed quest
// stays on the list until done. The HUD groups displayed quests by their group, one quest per group at a time (except
// City Clean-Up), groups ordered by the lowest priority they show, the first group highlighted.
//
// State on the Game: g.done[] (quest flags, Q_ORDER index), g.qshow (Set of displayed quest ids, saved as `qshow=`),
// g.qwave {Combat, Crafting, EndOfDay} (waves started, saved in `qshow=` too as negative codes).
import * as build from './build.js';
import * as map from './map.js';
import * as skills from './skills.js';
import { NODES } from './data.js';
import * as game from './game.js';
import * as lay from './lay.js';
import * as player from './player.js';

// id -> [group title, priority (original asset), text: string | (g) => string]
const pct = (n, of) => `${Math.min(100, Math.floor((Math.max(n, 0) / of) * 100))}%`;
export const QDEF = {
  EnterShop: ['Clearing Away the Past', 0, 'Enter the shop.'],
  Sweep: ['Clearing Away the Past', 1, (g) => `Sweep away the garbage piles. ${pct(g.sweep_done, 9)}`],
  Trash: ['Clearing Away the Past', 2, (g) => `Dispose of trash into the outside skip. ${pct(g.trash_done, 6)}`],
  Hammer: ['Breaking and Entering', 3, 'Find and equip the hammer in the store.'],
  JammedDoor: ['Breaking and Entering', 4, 'Open the jammed door.'],
  PickBox: ['Stocking Up', 5, 'Pick up the cardboard box container.'],
  FillBox: ['Stocking Up', 6, 'Put an item into the cardboard box.'],
  Shelve: ['Stocking Up', 7, 'Place an item on a shelf using the container.'],
  OpenStore: ['Open For Business', 9, 'Open the store for business by clicking the entrance switch.'],
  ServeFirst: ['Open For Business', 10, 'Serve your first customer.'],
  CloseStore: ['Live to Fight Another Day', 12, 'Close the store by clicking the entrance switch.'],
  Sleep: ['Live to Fight Another Day', 13, 'Rest for the night in your bed.'],
  KillZombie: ['Rude Customer', 14, 'Kill the attacking zombie!'],
  LootZombie: ['Waste Not Want Not', 15, 'Loot the slain zombie.'],
  RepairDoor: ['Patch It Up', 16, 'Repair the front door via Build Mode [B].'],
  AssignJob: ["You're Hired!", 17, 'Assign a job to the new staff member.'],
  OpenPackage: ['Special Delivery', 18, 'Open a package delivered by a scavenger worker.'],
  UnlockSkill: ['Branch Out', 19, 'Unlock any skill node in the Skills tree ([K]).'],
  CityGates: ['Into the City', 20, () => `Pay the city guard ${map.LANDMARKS[lm_of('CityGates')].cost} batteries to gain access to the city via the World Map ([M]).`],
  SendShop: ['Shopping Spree', 21, "Assign a staff member to purchase an item from Thom's Toolshed on the world map."],
  OpenWarehouse: ['Feeling Crafty', 22, 'Obtain a Crowbar to open the bolted door.'],
  FindRecipe: ['Feeling Crafty', 23, 'Break the boxes in the warehouse to find a crafting recipe.'],
  LearnRecipe: ['Feeling Crafty', 24, 'Learn a crafting recipe.'],
  CraftItem: ['Feeling Crafty', 25, 'Craft an item at the crafting station by placing required items on the table.'],
  DefeatHorde: ['Doing My Part', 26, 'Send staff to defeat the zombie horde, gaining further access to the city.'],
  UpgradeRadio: ['Advanced Warnings', 27, 'Take a Low-Frequency Radio to the table in the bedroom to upgrade it using Build mode ([B]).'],
  UpgradeBedroom: ['Home Sweet Home', 28, 'Upgrade any object in your bedroom using Build mode ([B]).'],
  ListenRadio: ['Advanced Warnings', 29, 'Listen to the radio when it beeps to learn about approaching zombie raids.'],
  LearnBandages: ['Feeling Crafty', 30, 'Learn to craft bandages via the Crafting skill tree ([K]).'],
  CraftItems: ['Feeling Crafty', 31, (g) => `Craft x10 items for Crafting XP. (${Math.min(g.crafted_n || 0, 10)}/10)`],
  LearnMediumCrates: ['Feeling Crafty', 32, 'Learn to craft Medium Crates via the Crafting skill tree ([K]).'],
  Caches: ['Finders Keepers', 33, (g) => `Find and search 3 loot caches over several days. (${Math.min(g.caches_done, 3)}/3)`],
  FixBridge: ['City Clean-Up', 34, 'Fix the Collapsed Bridge by obtaining the required resources.'],
  DefeatBrute: ['City Clean-Up', 35, 'Send staff to defeat the Brute Army, gaining deeper access to the city.'],
  UpgradeBench: ['Feeling Crafty', 36, 'Upgrade the Crafting Station via Build Mode [B].'],
  FixShredder: ['Reduce, Re-Use, Recycle', 37, 'Obtain enough Sawblades to fix the shredder.'],
  DefeatBirther: ['City Clean-Up', 38, 'Send staff to defeat the Broody Birthers, gaining deeper access to the city.'],
  FuelGenerator: ['Back Door Access', 39, 'Provide the generator with some gas via Build Mode [B].'],
  StartGenerator: ['Back Door Access', 40, 'Obtain a Taser Stick to kick start the generator.'],
  ShredBodies: ['Reduce, Re-Use, Recycle', 42, 'Throw corpses into the Shredder to receive Good Meat.'],
  PlayWheel: ['Meat Spin', 43, 'Give Dr. Gib Good Meat to play his wheel of fortune!'],
  DefeatTwins: ['City Clean-Up', 44, 'Send staff to defeat the Twin Terrors, gaining deeper access to the city.'],
  OpenHospital: ['What Was That Noise?', 45, 'Unlock the Heavy Door and investigate the old hospital.'],
  FreeHulk: ['What Was That Noise?', 48, "Free the 'cured' hulking zombie using the Chainsaw."],
  DefeatSweaty: ['City Clean-Up', 49, 'Send staff to defeat the Sweaty Rotter, gaining deeper access to the city.'],
  DefeatRaid: ['And Stay Out!', 50, 'Successfully defend a zombie raid against your store.'],
  LevelUpStaff: ['You Scratch My Back...', 51, "Level up a staff member's job rating by overpaying them double while they work on that job."],
  Demolition: ['Tear Down This Wall', 52, 'Expand the store by hiring the demolition crew.'],
};
/** Groups that show every displayed quest at once (original `_displayMultipleQuests`): only CityProgressQuestGroup. */
const MULTI = new Set(['City Clean-Up']);

export const WAVES = {
  DayOne: ['EnterShop', 'Trash', 'Sweep', 'Hammer', 'JammedDoor', 'PickBox', 'FillBox', 'Shelve', 'OpenStore', 'ServeFirst'],
  EndOfDay: ['CloseStore', 'Sleep'],
  Combat: ['KillZombie', 'LootZombie', 'AssignJob', 'RepairDoor', 'OpenPackage'],
  Crafting: ['OpenWarehouse', 'FindRecipe', 'LearnRecipe', 'CraftItem', 'LearnBandages', 'CraftItems', 'LearnMediumCrates', 'UpgradeBench'],
};
const WAVE_CODE = { Combat: -1, Crafting: -2, EndOfDay: -3 };

export function lm_of(key) {
  return map.LANDMARKS.findIndex((l) => l.key === key);
}
const NODE_AT = new Map();
function node_named(t, name) {
  const k = t + ':' + name;
  if (!NODE_AT.has(k)) NODE_AT.set(k, skills.nodes_of(t).find((i) => NODES[i].name === name) ?? -1);
  return NODE_AT.get(k);
}
const node_on = (g, t, name) => { const i = node_named(t, name); return i >= 0 && skills.on(g, i); };

/// Completion read from the game state, for quests that have no event call of their own (checked every tick, displayed or not).
const POLL = {
  AssignJob: (g) => g.staff.some((s) => s.hired && !s.gone && s.job !== 0),
  UnlockSkill: (g) => g.sk.on.some((b) => b),
  OpenWarehouse: (g) => g.bld.wh_open,
  LearnRecipe: (g) => g.learned.length > 0,
  CraftItem: (g) => (g.crafted_n || 0) > 0,
  CraftItems: (g) => (g.crafted_n || 0) >= 10,
  UpgradeBench: (g) => g.bld.tiers[build.T_BENCH] > 0,
  LearnBandages: (g) => node_on(g, 3, 'Bandage'),
  LearnMediumCrates: (g) => node_on(g, 3, 'Medium Storage Crate'),
  UpgradeBedroom: (g) => g.bld.tiers[build.T_BED] > 0 || g.bld.tiers[build.T_INTEL] > 0,
  UpgradeRadio: (g) => g.bld.tiers[build.T_INTEL] > 0,
  FixShredder: (g) => g.bld.tiers[build.T_SHREDDER] > 0,
  ShredBodies: (g) => g.inv[game.MEAT] > 0,
  CityGates: (g) => g.lm[lm_of('CityGates')] === 2,
  SendShop: (g) => g.staff.some((s) => s.hired && s.job === 7),
  DefeatHorde: (g) => g.lm[lm_of('ZombieHorde')] === 2,
  FixBridge: (g) => g.lm[lm_of('BrokenBridge')] === 2,
  DefeatBrute: (g) => g.lm[lm_of('BruteHorde')] === 2,
  DefeatBirther: (g) => g.lm[lm_of('BirtherZombieHorde')] === 2,
  DefeatTwins: (g) => g.lm[lm_of('TwinsBossZombieHorde')] === 2,
  DefeatSweaty: (g) => g.lm[lm_of('SweatyZombieHorde')] === 2,
  Demolition: (g) => g.bld.rooms > 0,
  FuelGenerator: (g) => g.bld.tiers[build.T_GEN] > 0,
  StartGenerator: (g) => g.bld.gen_fixed,
  OpenHospital: (g) => g.bld.med_open,
  FreeHulk: (g) => g.bld.helper.freed,
  PlayWheel: (g) => g.ev.spin_t > 0,
  LevelUpStaff: (g) => g.staff.some((s) => s.hired && !s.gone && s.lv0 !== undefined && s.levels.reduce((a, l) => a + l, 0) > s.lv0),
};

/// Display triggers of the quests outside the waves (original displayer components). Called every tick; a quest shows once.
const SHOW = {
  // UnlockAnySkillQuestController: any skill's first level-up
  UnlockSkill: (g) => g.sk.points.some((p) => p > 0) || g.sk.on.some((b) => b),
  // HireNewStaffQuestDisplayer: first staff hired
  LevelUpStaff: (g) => g.staff.some((s) => s.hired),
  // UpgradedObjectQuestDisplayer on the IntelStation: its first upgrade
  ListenRadio: (g) => g.bld.tiers[build.T_INTEL] > 0,
  // OpenBarrierLandmarkQuestDisplayer on the Zombie Horde landmark
  UpgradeRadio: (g) => g.lm[lm_of('ZombieHorde')] === 2,
  // DefeatRaidQuestDisplayer: RaidManager.RaidRevealed (the morning of the raid day, earlier through the radio)
  DefeatRaid: (g) => g.raid.active || (g.raid.next_day > 0 && g.day >= g.raid.next_day) || g.raid.announced === true,
  // LandmarkQuestDisplayer: the landmark becomes reachable on the world map
  // [SUY RA] clip 02 tờ 4: "Into the City" hiện sáng ngày 2 SAU "You're Hired!" (bảng Select Job rồi Patch It Up, Into the City,
  // Special Delivery); cạnh nối bản đồ của gốc chưa giải được. Bản đồ dùng để sai nhân viên, nên ta cho hiện khi đã giao việc
  // cho người đầu tiên (hoặc từ ngày 3 nếu ván không có cảnh ngày 2), không hiện lúc 07:00 ngày 2 khi chưa có ai (FTUE-AUDIT K8)
  CityGates: (g) => g.day >= 2 && (g.is_done('AssignJob') || g.day >= 3) && g.lm[lm_of('CityGates')] >= 1 && g.on(game.FF_MAP),
  SendShop: (g) => g.lm[lm_of('Toolshed')] >= 1,
  DefeatHorde: (g) => g.lm[lm_of('ZombieHorde')] >= 1,
  FixBridge: (g) => g.lm[lm_of('BrokenBridge')] >= 1,
  DefeatBrute: (g) => g.lm[lm_of('BruteHorde')] >= 1,
  DefeatBirther: (g) => g.lm[lm_of('BirtherZombieHorde')] >= 1,
  DefeatTwins: (g) => g.lm[lm_of('TwinsBossZombieHorde')] >= 1,
  DefeatSweaty: (g) => g.lm[lm_of('SweatyZombieHorde')] >= 1,
  Demolition: (g) => g.lm[lm_of('DemolitionCrew')] >= 1,
  // Hospital wave: Twin Terrors landmark unlocked
  OpenHospital: (g) => g.lm[lm_of('TwinsBossZombieHorde')] === 2,
  FreeHulk: (g) => g.bld.med_open,
  // display triggers not decoded in the original (FTUE-AUDIT §1 "not traced"): par-panels' conditions kept
  FixShredder: (g) => g.bld.wh_open && g.day >= 3,
  ShredBodies: (g) => g.bld.tiers[build.T_SHREDDER] > 0,
  FuelGenerator: (g) => g.bld.wh_open,
  StartGenerator: (g) => g.bld.tiers[build.T_GEN] > 0,
  PlayWheel: (g) => g.bld.gen_fixed && g.inv[game.MEAT] > 0,
};
/// Notes pages (bedroom, day >= 3): reading page k displays its quest (NotesPlayerStateView._FadeInPage -> Quest.Display).
export const NOTES_QUESTS = ['UpgradeBedroom', 'OpenWarehouse', 'Caches'];

/** Quest ids in display order that the HUD shows now, with group title: [[group, text, id, top], ...]. */
export function rows(g) {
  const shown = [];
  for (const q of g.qshow) if (QDEF[q] && !g.is_done(q)) shown.push(q);
  // one quest per group (the first displayed), City Clean-Up shows all; groups by lowest priority shown
  const groups = new Map();
  for (const q of shown) {
    const grp = QDEF[q][0];
    if (!groups.has(grp)) groups.set(grp, []);
    groups.get(grp).push(q);
  }
  const out = [];
  for (const [grp, qs] of groups) {
    const list = MULTI.has(grp) ? qs.slice().sort((a, b) => QDEF[a][1] - QDEF[b][1]) : [qs[0]];
    const prio = Math.min(...qs.map((q) => QDEF[q][1]));
    for (const q of list) out.push({ grp, q, prio, text: text_of(g, q) });
  }
  out.sort((a, b) => a.prio - b.prio || (a.grp < b.grp ? -1 : a.grp > b.grp ? 1 : 0));
  const topGrp = out.length ? out[0].grp : null;
  return out.map((r) => [r.grp, r.text, r.q, r.grp === topGrp]);
}
export function text_of(g, q) {
  const t = QDEF[q][2];
  return typeof t === 'function' ? t(g) : t;
}
export function display(g, q) {
  if (!QDEF[q] || g.is_done(q) || g.qshow.has(q)) return;
  g.qshow.add(q);
}
export function start_wave(g, w) {
  if (g.qwave[w]) return;
  g.qwave[w] = true;
}

/// Per tick: completion polls, wave advance, display triggers.
export function tick(g) {
  for (const q in POLL) {
    if (!g.is_done(q) && POLL[q](g)) g.complete(q);
  }
  // EndOfDayTutorialQuestManager: at 19:00 with the store open
  if (!g.qwave.EndOfDay && g.open && g.hour() >= 19.0) g.qwave.EndOfDay = true;
  // Crafting wave: starts when OpenWarehouse completes, from day 2
  if (!g.qwave.Crafting && g.is_done('OpenWarehouse') && g.day >= 2) g.qwave.Crafting = true;
  // gốc: tối muộn chưa ngủ thì nhắc "You feel exhausted. Use the bed to rest." (clip 04 f_1948, ngày 2 22:03; lúc bật chính xác
  // chưa giải được [SUY RA]: một lần mỗi tối từ 22:00)
  if (g.mode === 'Play' && g.hour() >= 22.0 && g.tired_day !== g.day && !g.raid.active) { g.tired_day = g.day; g.say('You feel exhausted. Use the bed to rest.'); }
  advance(g, 'DayOne');
  for (const w of ['EndOfDay', 'Combat', 'Crafting']) if (g.qwave[w]) advance(g, w);
  for (const q in SHOW) if (!g.is_done(q) && !g.qshow.has(q) && SHOW[q](g)) display(g, q);
  // Notes (bedroom, day >= 3): the page being read displays its quest; the paper glows while a page's quest is neither
  // displayed nor done (NotesObject._glowEffect)
  if (g.panel && g.panel.k === 'Notes') display(g, NOTES_QUESTS[Math.min(Math.max(g.panel.page || 0, 0), 2)]);
  g.notes_glow = g.day >= 3 && NOTES_QUESTS.some((q) => !g.is_done(q) && !g.qshow.has(q));
}
function advance(g, w) {
  const q = WAVES[w].find((x) => !g.is_done(x));
  if (q !== undefined) display(g, q);
}

/// Save field: displayed quest indexes (Q_ORDER) and started waves as negative codes.
export function save(g, q_index) {
  const out = [];
  for (const q of g.qshow) { const i = q_index(q); if (i >= 0) out.push(i); }
  for (const w in WAVE_CODE) if (g.qwave[w]) out.push(WAVE_CODE[w]);
  return out.join(',');
}
export function load(g, s, Q_ORDER) {
  g.qshow = new Set();
  g.qwave = { Combat: false, Crafting: false, EndOfDay: false };
  // bản lưu cũ (chưa có qshow=): sóng Combat coi như đã chạy nếu zombie ngày 2 đã bị hạ
  if (s === null || s === undefined || s === '') { g.qwave.Combat = g.is_done('KillZombie'); return false; }
  for (const t of s.split(',')) {
    const n = Number(t);
    if (!Number.isInteger(n)) continue;
    if (n >= 0 && n < Q_ORDER.length) g.qshow.add(Q_ORDER[n]);
    for (const w in WAVE_CODE) if (WAVE_CODE[w] === n) g.qwave[w] = true;
  }
  return true;
}

// ---------- [FTUE A3] chevrons: the original's WorldChevronPrefab on the object of each displayed quest ----------
// (FTUE-AUDIT O52: 14 chevrons found in GameScene: shop door outside, outside skip, hammer, cardboard box in the bedroom,
// shelf, open switch, bed, front door, the first staff member, the recipe crate, the crafting station, chain / hulk.)
// g.chevrons() -> [[x, y, z, quest id], ...] for the view (plug/chevron.js) and the newbie bot (__twt.chev).
function nearest(g, f) {
  let best = null, bd = 1e9;
  for (const p of g.props) {
    if (p.dead || g.held === p.id || !f(p)) continue;
    const d = p.pos.distance(g.player);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
const at = (v, dy) => [v.x, v.y + dy, v.z];
const CHEV = {
  EnterShop: () => at(lay.DOOR, 2.7),
  Trash: () => at(lay.SKIP, 2.4),
  Hammer: (g) => { const p = nearest(g, (q) => q.kind.k === 'Hammer'); return p ? at(p.pos, 0.9) : null; },
  PickBox: (g) => { const p = nearest(g, (q) => q.kind.k === 'Box'); return p ? at(p.pos, 1.1) : null; },
  FillBox: (g) => { const p = nearest(g, (q) => q.kind.k === 'Item'); return p ? at(p.pos, 0.9) : null; },
  Shelve: (g) => (g.shelves[0] ? at(g.shelves[0].slot_pos(10), 0.9) : null),
  OpenStore: () => at(lay.SWITCH, 0.75),
  CloseStore: () => at(lay.SWITCH, 0.75),
  Sleep: () => at(lay.BED, 1.2),
  RepairDoor: () => at(lay.DOOR, 2.7),
  AssignJob: (g) => { const s = g.staff.find((x) => x.tutorial && x.hired && !x.gone && x.job === 0); return s ? [s.pos.x, 2.35, s.pos.z] : null; },
  FindRecipe: (g) => { const p = nearest(g, (q) => q.kind.k === 'WBox' && (q.kind.a || []).includes(13)); return p ? at(p.pos, 1.2) : null; },
  CraftItem: () => at(lay.WORKBENCH, 1.9),
  OpenHospital: () => at(lay.HULK, 2.8),
  FreeHulk: () => at(lay.HULK, 2.8),
};
export function chevrons(g) {
  const out = [];
  if (g.mode !== 'Play' || g.cine !== null) return out;
  for (const r of rows(g)) {
    const f = CHEV[r[2]];
    const p = f ? f(g) : null;
    if (p) out.push([p[0], p[1], p[2], r[2]]);
  }
  // [FTUE A7] gốc UseCheckoutQuestController / CheckoutCurrencyGuide / SoundCheckoutAlarmQuestController: lần bán đầu mũi tên
  // trên cục pin kế, rồi tới đúng ngăn kéo; về sau mệnh giá chưa từng cất lại có mũi tên tới ngăn; pin giả: mũi tên nút báo động
  if (g.pay !== null) {
    const cs = g.pay.coins;
    const first = !g.is_done('ServeFirst');
    const fk = cs.find((c) => c.checked && c.fake && c.done === 0);
    const chk = g.chk_t > 0.0 ? cs.find((c) => c.checked && !c.fake && c.done === 0) : undefined;
    if (fk && g.pay.alarm === 0) {
      out.push([player.ALARM.x, player.ALARM.y + 0.35, player.ALARM.z, 'Alarm']);
    } else if (chk && first) {
      // gốc UseCheckoutQuestController: cầm pin lên thì mũi tên theo cục pin (lệch y 0,4) với dòng "Check the battery has the
      // correct charge."; mũi tên tới ngăn kéo chỉ hiện khi đã soi xong (Validated)
      const p = player.coin_pos(cs.indexOf(chk));
      out.push([p.x, p.y + 0.4, p.z, 'Check']);
    } else {
      const ck = cs.find((c) => c.checked && !c.fake && c.done === 0);
      if (ck && (first || !(g.dep_seen && g.dep_seen.has(ck.value)))) {
        // gốc: mũi tên tới đúng ngăn kéo (người chơi cầm pin bỏ vào ngăn). Bản này "[E] Deposit" nằm trên chính cục pin đã soi
        // (par-counter D11; ngăn kéo chỉ là mục tiêu khi thối tiền, find_target không đổi), nên mũi tên trỏ cục pin đó
        // (newbie bot: nhắm ngăn kéo theo mũi tên không có lời nhắc nào) [LỆCH, PARITY B-FTUE]
        const p = player.coin_pos(cs.indexOf(ck));
        out.push([p.x, p.y + 0.3, p.z, 'Depot']);
      } else if (first) {
        const i = cs.findIndex((c) => !c.checked && c.done === 0);
        if (i >= 0) { const p = player.coin_pos(i); out.push([p.x, p.y + 0.3, p.z, 'Battery']); }
      }
    }
  }
  // StoreManagerOpenStatusReminder: from day 2, store closed, 10:00-18:59, no raid today -> the switch chevron again
  const h = g.hour();
  if (g.day >= 2 && !g.open && h >= 10.0 && h < 19.0 && !g.raid.active && g.day !== g.raid.next_day && !out.some((c) => c[3] === 'OpenStore')) {
    const p = at(lay.SWITCH, 0.75);
    out.push([p[0], p[1], p[2], 'OpenReminder']);
  }
  return out;
}
