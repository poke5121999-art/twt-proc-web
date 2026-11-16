// Port of the export part of src/web.rs (`esc`, `kind_tag`, `Export`, `export_system`); the other web.rs helpers live in
// ./web.js. Xuất trạng thái ra `window.__twt` và bảng bố cục ra `window.__twtLay` (để bot Playwright đọc).
// The JSON text is built exactly like the Rust `format!` calls (same keys, order, number formats), 25 bots parse it.

import * as web from './web.js';
import * as audio from './audio.js';
import * as scene from './scene.js';
import * as game from './game.js';
import * as mat from './mat.js';
import * as actors from './actors.js';
import * as items from './items.js';
import * as catalog from './catalog.js';
import * as skills from './skills.js';
import * as build from './build.js';
import * as combat from './combat.js';
import * as events from './events.js';
import * as staff from './staff.js';
import * as craft from './craft.js';
import * as carry from './carry.js';
import * as save from './save.js';
import * as lay from './lay.js';

/** Rust `format!("{:.N}", v)` (exact decimal, ties to even, keeps "-" of negative zero). */
function rfix(x, n) {
  if (Number.isNaN(x)) return 'NaN';
  const neg = x < 0 || Object.is(x, -0);
  const a = Math.abs(x);
  if (a === Infinity) return neg ? '-inf' : 'inf';
  let s = a.toFixed(n);
  if (a < 1e21 && n <= 60) {
    const full = a.toFixed(n + 40);
    if (full.slice(full.length - 40) === '5' + '0'.repeat(39)) {
      let kept = full.slice(0, full.length - 40);
      if (kept.endsWith('.')) kept = kept.slice(0, -1);
      if ((kept.charCodeAt(kept.length - 1) - 48) % 2 === 0) s = kept;
    }
  }
  return (neg ? '-' : '') + s;
}

export function esc(s) {
  return s.split('\\').join('\\\\').split('"').join('\\"').split('\n').join('\\n');
}

export function kind_tag(k) {
  switch (k.k) {
    case 'Trash': return 'trash';
    case 'Pile': return 'pile';
    case 'Item': return 'item';
    case 'Box': return 'box';
    case 'Hammer': return 'hammer';
    case 'Crate': return 'crate';
    case 'Reward': return 'reward';
    case 'Wire': return 'wire';
    case 'Corpse': return k.b ? 'corpse_looted' : 'corpse';
    case 'Cache': return k.c ? 'cache_done' : 'cache';
    case 'Placed': return 'placed';
  }
  return '';
}

/** Rust `{:?}` of Panel (only Price carries data). */
function panel_debug(p) {
  return p.a !== undefined ? `${p.k}(${p.a})` : p.k;
}

export class Export {
  constructor() {
    this.t = 0;
    this.frames = 0;
    this.sfx = 0;
    this.last_sfx = '';
    /** stand-in for Bevy `time.elapsed_secs()` when ctx.elapsed is not given (sum of dt since start) */
    this.elapsed = 0;
  }
}

/** Mỗi 0,1 s ghi trạng thái dạng JSON ra `window.__twt`; phát các tiếng đã xếp hàng; lưu ván khi được yêu cầu.
 *  ctx: { export: Export, quality: {tier}, icons?: {baked, total()}, fps?: number, elapsed?: seconds since start } */
export function export_system(g, dt, ctx) {
  const ex = ctx.export;
  ex.elapsed += dt;
  ex.frames += 1;
  if (ex.frames === 3) {
    // Bảng bố cục cho bot (một lần, trước khi trang báo sẵn sàng).
    web.set_global('__twtLay', lay.json());
    web.stage('ready');
  }
  const night = mat.night_factor(g.hour());
  const inside = game.Game.in_shop(g.player) || game.Game.in_bedroom(g.player);
  const playing = g.mode !== 'Title';
  for (const [name, vol] of g.sfx.splice(0)) {
    ex.sfx += 1;
    ex.last_sfx = name;
    audio.play(name, vol);
  }
  const raid = g.raid.active ? 1.0 : 0.0;
  audio.ambience([
    (inside ? 0.05 : 0.22) * (1.0 - raid * 0.5),
    inside && playing ? 0.25 : 0.0,
    night * (inside ? 0.03 : 0.1),
    raid * 0.5,
    web.rain_level() * (inside ? 0.18 : 0.55),
  ]);
  if (g.save_request) {
    g.save_request = false;
    save.write(g);
  }
  ex.t += dt;
  if (ex.t < 0.1) {
    return;
  }
  const fps = ctx.fps !== undefined && ctx.fps !== null ? ctx.fps : 1.0 / Math.max(dt, 0.0001);
  ex.t = 0.0;
  // Móc kiểm thử: trang đặt window.__twtSpeed để đổi tốc độ ngày lúc đang chạy.
  const sp = web.number('__twtSpeed');
  if (sp !== null) {
    g.speed = Math.min(Math.max(Math.fround(sp), 0.1), 60.0);
  }
  const todo = g.todo().map((t) => `"${esc(t[1])}"`);
  const props = g.props.filter((p) => !p.dead).map((p) => `{"id":${p.id},"k":"${kind_tag(p.kind)}","x":${rfix(p.pos.x, 2)},"z":${rfix(p.pos.z, 2)}${p.kind.k === 'Cache' ? `,"n":"${esc(p.kind.a)}","c":${(p.kind.b || []).length}` : ''}${p.kind.k === 'Item' ? `,"it":${p.kind.a}` : ''}}`);
  const zs = g.zombies.filter((z) => !z.dead).map((z) => {
    let kd;
    switch (z.kind) {
      case 'Base': kd = 0; break;
      case 'Tumour': kd = 1; break;
      case 'Hulk': kd = 2; break;
      case 'Baby': kd = 4; break;
      default: kd = 3;
    }
    return `[${rfix(z.pos.x, 2)},${rfix(z.pos.z, 2)},${rfix(z.hp, 0)},${kd}]`;
  });
  const cs = g.customers.map((c) => `[${rfix(c.pos.x, 2)},${rfix(c.pos.z, 2)},${game.CSTATE_ORDER.indexOf(c.state)},${c.basket.length}]`);
  const hc = actors.head_customer(g);
  const head = hc !== null ? g.customers[hc].at_head : -1.0;
  let held = '';
  if (g.held !== null) {
    const hp = g.props.find((p) => p.id === g.held);
    if (hp !== undefined) held = kind_tag(hp.kind);
  }
  let shelf = 0;
  let shelf_slots = 0;
  for (const s of g.shelves) {
    shelf += s.total();
    shelf_slots += s.slots.filter((x) => x !== null).length;
  }
  const done = Array.from(g.done, (d) => (d ? '1' : '0'));
  // `inv`: 14 món của các bản trước theo thứ tự cũ (bot cũ đọc theo chỉ số); `bag`: mọi món đang có theo tên.
  const inv = catalog.BRIDGE.map((i) => String(g.inv[i]));
  const bag = items.owned(g).map((i) => `"${esc(items.iname(i))}":${g.inv[i]}`);
  const bag_rows = items.bag_rows(g).map((r) => (r.k === 'Equipped' ? `"*${esc(items.iname(g.weapons[r.a].item))}"` : `"${esc(items.iname(r.a))}"`)).join(',');
  // Danh sách ô lưu chỉ đọc ở màn tiêu đề (bảng Saved games): "ô hiện tại | bản đêm trước".
  let saves = '';
  if (g.mode === 'Title') {
    const out = [];
    for (let s = 0; s < save.SLOTS; s++) {
      const a = save.summary(s, false), b = save.summary(s, true);
      out.push(`"${a !== null ? a : ''}|${b !== null ? b : ''}"`);
    }
    saves = out.join(',');
  }
  const extra = `"bag":{${bag.join(',')}},"bagRows":[${bag_rows}],"sk":${skills.export(g)},"bld":${build.export(g)},"cb":${combat.export(g)},"ev":${events.export(g)},"slot":${g.slot},"bagSel":${g.bag_sel},"hpMax":${rfix(g.hp_max, 0)},"xp":[${g.xpv[0]},${g.xpv[1]},${g.xpv[2]},${g.xpv[3]}],"staffSel":${g.staff_sel},"stockSel":"${esc(items.iname(g.stock_sel))}","saves":[${saves}],"sales":[${(g.sales || []).join(',')}]`;
  const pay = g.pay !== null ? g.pay.coins.map((c) => `[${c.value},${c.checked ? 1 : 0},${c.checked && c.fake ? 1 : 0},${c.done}]`).join(',') : '';
  const pay_alarm = g.pay !== null ? g.pay.alarm : -1;
  const med = g.customers.filter((c) => c.goal.k === 'Medical' && !c.gone).length;
  const elapsed = ctx.elapsed !== undefined && ctx.elapsed !== null ? ctx.elapsed : ex.elapsed;
  let json = `{"mode":"${g.mode}","panel":"${panel_debug(g.panel)}","day":${g.day},"min":${rfix(g.minutes, 1)},"bat":${g.batteries},"rep":${rfix(g.rep, 3)},"open":${g.open},"hp":${rfix(g.hp, 1)},"pos":[${rfix(g.player.x, 3)},${rfix(g.player.y, 3)},${rfix(g.player.z, 3)}],"yaw":${rfix(g.yaw, 4)},"pitch":${rfix(g.pitch, 4)},"prompt":"${esc(g.prompt)}","notice":"${esc(g.notice_t > 0.0 ? g.notice : '')}","todo":[${todo.join(',')}],"props":[${props.join(',')}],"zs":[${zs.join(',')}],"cs":[${cs.join(',')}],"head":${rfix(head, 2)},"held":"${held}","armed":${g.armed},"shelf":${shelf},"shelfSlots":${shelf_slots},"stack":[${game.case_units()},${game.stack_max()}],"done":[${done.join(',')}],"inv":[${inv.join(',')}],"door":{"open":${g.door.open},"hp":${rfix(g.door.hp, 0)}},"raid":{"active":${g.raid.active},"wave":${g.raid.wave},"next":${g.raid.next_day}},"served":${g.total_served},"bedDoor":${g.bed_door_hits},"trash":${g.trash_done},"sweep":${g.sweep_done},"q":${ctx.quality.tier},"fps":${rfix(fps, 0)},"frames":${ex.frames},"sfx":${ex.sfx},"lastSfx":"${ex.last_sfx}","cine":${g.cine !== null ? g.cine[0] : -1},"ff":${g.ff},"pay":[${pay}],"payAlarm":${pay_alarm},"med":[${med},${actors.medical_near(g) !== null ? 1 : 0}],"gifts":${g.med_gifts.length},"staff":[${staff.export(g)}],"lm":[${Array.from(g.lm, (v) => String(v)).join(',')}],"lmhp":[${Array.from(g.lm_hp, (v) => rfix(v, 0)).join(',')}],"lmSel":${g.lm_sel},"craft":${craft.export(g)},${extra},"toast":"${g.toast_t > 0.0 ? g.toast : ''}","t":${rfix(elapsed, 1)}}`;
  // Số biểu tượng món đã vẽ / tổng số (bot chờ vẽ xong rồi mới chụp).
  const im = scene.impl();
  const zoo = g.zoo ? (im && im.people && typeof im.people.zoo_info === 'function' ? im.people.zoo_info() : '') : '';
  json = `${json.slice(0, json.length - 1)},"icons":[${ctx.icons ? ctx.icons.baked : 0},${ctx.icons ? ctx.icons.total() : 0}],"fp":${g.fx2.export()},"carry":${carry.export(g)}${zoo}}`;
  web.set_global('__twt', json);
}

/* VIEW NOTES
   Nothing is drawn here. export_system runs every frame AFTER the rules and sync systems (it is last in the Rust Update
   chain): it drains g.sfx into audio.play, sets the 5 ambience levels, writes the save when g.save_request is set, and
   every 0.1 s writes `window.__twt`. On the 3rd call it writes `window.__twtLay` and calls web.stage('ready').
   PORT GAPS: `crate::people::zoo_info()` (people.rs is not ported): with `?zoo` the text is taken from
   `scene.impl().people.zoo_info()` when the people kit provides it, else nothing is appended. Bevy
   `time.elapsed_secs()` comes from ctx.elapsed when given, else from the sum of dt seen by this system.
   Rust looks buggy (ported as is): "toast" and "lastSfx" are not passed through esc(), so a toast containing a quote
   or newline would make the JSON invalid.
*/
