//! Chiến đấu đủ bộ (cờ `weapons`, `bosses`, `corpses`): mọi vũ khí cận chiến và súng trong danh mục, đạn, đồ ném, độ bền,
//! nổ / cháy, boss, hàng chờ raid + Hellraid, kéo và vứt / nghiền xác.
//! Luật theo `~/twt-bevy/docs/rules/combat-raids.md`:
//! - Cận chiến: sát thương, hồi chiêu, tầm, choáng, đẩy lùi theo `data::INFO`; mỗi nhát TRÚNG mất `deg` độ bền; hết độ bền thì
//!   vỡ (còn món cùng loại trong ba lô thì lấy món mới).
//! - Súng: mỗi lần bóp cò tốn 1 viên dù bắn mấy mảnh (shotgun 6 mảnh); độ tản `s = 10 - 10 x acc` độ, `acc` hồi về 0,8 với tốc
//!   độ 6/s và mỗi phát trừ 0,25 (kẹp 0,25..0,8); nạp đạn `reload / hệ số kỹ năng` giây, chuyển `min(băng - đang có, kho)` viên;
//!   mỗi PHÁT mất `deg` độ bền; băng rỗng thì bóp cò là nạp. Trúng đầu x2, thân x1,25.
//! - Đồ ném: giữ chuột tối đa 1 s, tốc độ ném `lerp(0,5; 1; nạp) x 14 x hệ số tầm`.
//! - Nổ: sát thương giảm tuyến tính `1 - d / bán kính`. Cháy: 5 s, mỗi 0,5 s một nhịp.
//! - Boss: Brute 4000 máu (cách <= 5 m thì đập đất 200 sát thương sau 2 s, xa hơn thì ném; 5 đòn rồi đổi chỗ); Birther 2500
//!   máu, 20 s đẻ 6..9 con (20 máu); Sweaty Rotter 10000 máu, nghỉ 7..10 s rồi nhảy 5 s, đáp nổ 300 và tự mất 1/9..1/10 máu;
//!   Twins chung 4000 máu, một chị tăng tốc zombie quanh 15 m x1,75, một chị hồi máu, mỗi chị 2 Hulking hộ vệ.
//! - Raid: raid đầu ngày 3; hạ một bầy trên bản đồ thì raid của bầy đó tới sau 4 ngày; thua thì raid đó quay lại sau 4 ngày;
//!   thắng đủ 5 raid thì Hellraid bắt đầu (lần đầu sau 3 ngày, thắng +5 ngày, thua +7 ngày). Thưởng theo `data::REWARDS`.
//! - Xác: nghiền ra Good Meat + Bone (zombie 10 + 2, Hulking 50 + 5); vứt thùng rác được XP Service 5.
//! `[ĐỀ XUẤT]` (tài liệu ghi UNKNOWN): sát thương và bán kính của lựu đạn (250 / 6 m), bom đinh (150 / 4 m), xe Brute ném
//! (120 / 4 m), lượng hồi máu của chị Twins (20 máu/giây), độ rơi sát thương theo quãng bay xấp xỉ bằng "đủ trong tầm, giảm
//! về 5% ở 3 lần tầm"; mọi đợt raid tới từ cổng đông (bản gốc chia hướng theo mặt nạ); súng bắn tia thẳng thay cho viên đạn bay.
//
// Port of src/combat.rs. Rust names kept, except two JS reserved words: `throw` -> `throw_`, `export` -> `export_`.
// `impl ZKind { boss, scale, label }` (methods on a unit enum, which is a string here) -> exported functions
// `boss(kind)`, `scale(kind)`, `label(kind)`.

import { Vec3, v3, X, Y, Z, rot_y, clamp, trunc, Rng } from './vec.js';
import { RAID_DEFS, REWARDS } from './data.js';
import { N_CAT as N_ITEMS } from './catalog.js';
import * as game from './game.js';
import * as items from './items.js';
import * as lay from './lay.js';
import * as skills from './skills.js';
import * as world from './world.js';
import * as fx from './fx.js';
import * as fp from './fp.js';
import * as web from './web.js';
import * as actors from './actors.js';
import * as cine from './cine.js';
import * as build from './build.js';
import * as player_mod from './player.js';

export class State {
  constructor() {
    /** Vec<Entity> (view-owned nodes; null-able). */
    this.orphans = [];
    /** Vec<(Vec3, Vec3, f32)> */
    this.tracers = [];
    this.tracer_t = 0;
    this.acc = 0;
    this.fire_cd = 0;
    this.reload_t = 0;
    this.swing_len = 0;
    /// Đập báng súng (Z): giây còn lại của cú đập, đã tính trúng chưa.
    this.bash_t = 0;
    this.bash_hit = false;
    /// Đồ ném đang chọn (phím 4) và mức nạp.
    this.throw_item = null;
    this.charge = 0;
    /// Đồ ném đang bay: (id vật, vận tốc, món).
    this.projs = [];
    /// Vùng cháy: (tâm, bán kính, giây còn lại).
    this.fires = [];
    this.lure = null;
    /// Chớp sáng cần phát (player_system lấy ra vì nó giữ tài nguyên Fx).
    this.flash = null;
    /// Hàng chờ raid sau raid đang hẹn: (chỉ số `RAID_DEFS`, ngày).
    this.queue = [];
    this.won = [false, false, false, false, false];
    this.hell_n = 0;
    /** Vec<Vec<(ZKind, i32)>> */
    this.waves = [];
    /** Vec<(ZKind, f32)> */
    this.pending = [];
    this.hp_mul = 0;
    this.twin_pool = 0;
    this.buff_at = null;
    this.heal_at = null;
    /** Option<(&str, f32, f32)> */
    this.boss = null;
    this.babies = [];
    this.flame_t = 0;
  }
}

export const HELL = 5;

// ---------- impl ZKind ----------

export function boss(k) {
  return k === 'Brute' || k === 'Birther' || k === 'Sweaty' || k === 'TwinBuff' || k === 'TwinHeal';
}
export function scale(k) {
  switch (k) {
    case 'Hulk': return 1.5;
    case 'Brute': return 2.0;
    case 'Birther': return 1.7;
    case 'Sweaty': return 2.2;
    case 'Baby': return 0.55;
    case 'TwinBuff': case 'TwinHeal': return 1.2;
    default: return 1.0;
  }
}
export function label(k) {
  switch (k) {
    case 'Brute': return 'BRUTE';
    case 'Birther': return 'BIRTHER';
    case 'Sweaty': return 'SWEATY ROTTER';
    case 'TwinBuff': case 'TwinHeal': return 'TWIN TERRORS'; // loc:raid_boss_twins
    default: return '';
  }
}

/// Aliases matching game.js's `ZKind.stats(kind)` / `zkind_stats(kind)` spelling for methods on the string enum.
export const zkind_boss = boss, zkind_scale = scale, zkind_label = label;
export const ZKind = Object.freeze({ boss, scale, label });

/** `ZKind::stats(self)` lives in game.rs (game.js); the porter's spelling of a method on a string enum is not fixed by the
 *  contract, so accept the likely forms. Returns [hp, dmg, cd, speed]. */
function zstats(k) {
  if (game.ZKind && typeof game.ZKind.stats === 'function') return game.ZKind.stats(k);
  if (typeof game.zkind_stats === 'function') return game.zkind_stats(k);
  return game.stats(k);
}

/** Rust f32::round (half away from zero). */
const rround = (v) => Math.sign(v) * Math.round(Math.abs(v));
const deg2rad = (d) => (d * Math.PI) / 180;
const is_explosive_placed = (kind) => kind.k === 'Placed' && (kind.a === game.EXPLOSIVE_BARREL || kind.a === game.REMOTE_BOMB || kind.a === game.REMOTE_INC);
const is_remote_placed = (kind) => kind.k === 'Placed' && (kind.a === game.REMOTE_BOMB || kind.a === game.REMOTE_INC);

// ---------- vũ khí của người chơi ----------

export class Input {
  constructor() {
    this.click = false;
    this.down = false;
    this.released = false;
    this.reload = false;
    this.eye = v3();
    this.dir = v3();
    this.dt = 0;
    this.bed_door = false;
  }
}

function dur_mul(g) {
  const m = skills.mul(g, 'WeaponDurabilityMultiplier');
  return m > 0.0 ? m : 1.0;
}

/// Trừ độ bền vũ khí đang cầm; vỡ thì bỏ, còn món cùng loại trong ba lô thì lấy món mới.
function wear(g, amount) {
  const k = g.wsel;
  const w = k < g.weapons.length ? g.weapons[k] : null;
  if (w === null || w === undefined) return;
  w.dur -= amount;
  if (w.dur > 0.0) {
    return;
  }
  const item = w.item;
  const clip = w.clip;
  g.weapons.splice(k, 1);
  const gg = items.gun(item);
  if (gg !== null) {
    const gd = gg[1];
    if (gd.ammo < N_ITEMS) {
      g.inv[gd.ammo] += clip;
    }
  }
  g.play('break', 0.6);
  if (g.inv[item] > 0) {
    g.inv[item] -= 1;
    items.equip(g, item);
    g.wsel = g.weapons.length - 1;
    g.say(`${items.iname(item)} broke. You draw a spare.`);
  } else {
    g.wsel = 0;
    g.armed = g.weapons.length !== 0;
    g.say(`${items.iname(item)} broke!`);
  }
}

/// Tia từ mắt trúng zombie nào trước: (chỉ số, quãng, trúng đầu).
function ray_zombie(g, o, d, max) {
  const dx = d.x, dz = d.z;
  const l2 = Math.max(dx * dx + dz * dz, 1e-6);
  let best = null;
  for (let i = 0; i < g.zombies.length; i++) {
    const z = g.zombies[i];
    if (z.dead || z.hp <= 0.0 || z.air > 0.0) {
      continue;
    }
    const s = scale(z.kind);
    const rx = z.pos.x - o.x, rz = z.pos.z - o.z;
    const t = (rx * dx + rz * dz) / l2;
    if (t < 0.0 || t > max) {
      continue;
    }
    const p = o.add(d.mul(t));
    const lat = Math.hypot(p.x - z.pos.x, p.z - z.pos.z);
    if (lat < 0.4 * s && p.y > -0.1 && p.y < 1.95 * s && (best === null || t < best[1])) {
      best = [i, t, p.y > 1.42 * s];
    }
  }
  return best;
}

export function hit_zombie(g, i, dmg, head, stun, knock, dir) {
  const z = g.zombies[i];
  const bs = boss(z.kind) || z.kind === 'Hulk';
  z.hp -= dmg * (head ? 2.0 : 1.25);
  z.stagger = bs ? stun * 0.4 : stun;
  z.wind = 0.0;
  z.chasing = true;
  const push = v3(dir.x, 0.0, dir.z).normalize_or_zero().mul(bs ? 0.1 : knock * 0.16);
  const np = z.pos.add(push);
  const at = z.pos.add(Y.mul((head ? 1.55 : 1.1) * scale(z.kind)));
  g.zombies[i].pos = world.resolve(g, np, 0.32).clone();
  g.fxq.push([fx.FX_BLOOD, at.clone()]);
  g.cb.flash = [at.clone(), 0.6];
  g.play(head ? 'crit' : 'hit', 0.8);
  // XP Survival theo sát thương gây ra (luật gốc: RoundToInt(sát thương x 0,125)), cộng lúc zombie chết ở actors.rs.
}

/// Độ cao hộp chặn đạn của vật dựng đặt trên sàn (m) [ĐỀ XUẤT: đo theo hình `models.placed`].
function built_h(item) {
  if (build.shelf_dims(item) !== null) return item === game.FRIDGE ? 2.0 : 1.9;
  switch (item) {
    case game.SPIKE_WALL: return 0.9;
    case game.TURRET: case game.AUTO_MINIGUN: return 1.25;
    case game.TABLE_SECURE: return 0.95;
    case game.EXPLOSIVE_BARREL: return 1.0;
  }
  return 1.0;
}

/// Vật dựng (Placed / dây thép gai) đầu tiên tia đạn chạm (hộp chân x độ cao) trong tầm `max`: [t, id] | null. Thảm, đồ treo
/// tường / trần, bẫy kẹp, bom điều khiển, bóng bay không chặn đạn; thùng nổ do `ray_explosive` lo.
export function ray_built(g, o, d, max) {
  let best = null;
  const inv = v3(1.0 / (d.x + 1e-6), 1.0 / (d.y + 1e-6), 1.0 / (d.z + 1e-6));
  for (const p of g.props) {
    if (p.dead) continue;
    let box, h;
    if (p.kind.k === 'Wire') {
      box = build.prop_box(game.BARBED, p.pos, p.yaw); h = 1.0;
    } else if (p.kind.k === 'Placed') {
      const it = p.kind.a;
      const [, , solid, high] = build.footprint(it);
      if (high !== 0 || is_explosive_placed(p.kind) || it === game.BEAR_TRAP || it === game.BALLOON) continue;
      if (!solid && it !== game.SPIKE_WALL) continue;
      if (g.bld.mounted === p.id) continue;
      box = build.prop_box(it, p.pos, p.yaw); h = built_h(it);
    } else continue;
    const mn = v3(box[0], 0.0, box[1]), mx = v3(box[2], h, box[3]);
    const t0 = mn.sub(o).mulv(inv), t1 = mx.sub(o).mulv(inv);
    const lo = t0.min(t1), hi = t0.max(t1);
    const tn = Math.max(Math.max(lo.x, lo.y), lo.z), tf = Math.min(Math.min(hi.x, hi.y), hi.z);
    if (tf >= Math.max(tn, 0.0) && tn > 0.05 && tn < (best !== null ? best[0] : max)) {
      best = [tn, p.id];
    }
  }
  return best;
}

/// Vật dựng nổ được nằm trên tia nhìn trong tầm `max`.
function ray_explosive(g, o, d, max) {
  const k = g.props.findIndex((p) => {
    if (p.dead || !is_explosive_placed(p.kind)) {
      return false;
    }
    const c = p.pos.add(Y.mul(0.5));
    const rel = c.sub(o);
    const t = rel.dot(d);
    return t > 0.0 && t < max && o.add(d.mul(t)).distance(c) < 0.55;
  });
  return k < 0 ? null : k;
}

/// Đập báng súng (Z, [ĐỀ XUẤT], không có trong luật gốc): như một đòn cận chiến nhẹ (sát thương thấp, đẩy lùi mạnh,
/// choáng), trúng ở khoảng 0,15 s của động tác 0,5 s (`fp.pose`: đỉnh cú thúc ở 0,19 s).
const bash_on = () => web.query('bash') === '1';
export const BASH = { dur: 0.5, hit_at: 0.15, w: { dmg: 15.0, cd: 0.5, range: 1.3, dur: 100.0, deg: 0.1, knock: 6.0, stun: 0.9, auto: false } };

function melee_hit(g, inp, item, bash) {
  const w = bash ? BASH.w : items.melee(item);
  if (w === null) return;
  if (item === game.DETONATOR) {
    let n = 0;
    for (const p of g.props) {
      if (!p.dead && is_remote_placed(p.kind)) {
        p.hp = 0.0;
        n += 1;
      }
    }
    g.say(n > 0 ? `Detonated ${n} charge(s).` : 'No remote charges placed.');
    g.play('click', 0.6);
    return;
  }
  const m = skills.mul(g, 'MeleeWeaponDamageMultiplier');
  const dmg = w.dmg * (m > 0.0 ? m : 1.0);
  const flat = v3(inp.dir.x, 0.0, inp.dir.z).normalize_or_zero();
  let best = null;
  for (let i = 0; i < g.zombies.length; i++) {
    const z = g.zombies[i];
    if (z.dead || z.hp <= 0.0 || z.air > 0.0) {
      continue;
    }
    const to = z.pos.sub(inp.eye);
    const f = v3(to.x, 0.0, to.z);
    const d = f.length();
    const reach = w.range + 0.45 + (scale(z.kind) - 1.0) * 0.8;
    if (d < reach && f.normalize_or_zero().dot(flat) > 0.72 && (best === null || d < best[1])) {
      best = [i, d];
    }
  }
  if (best !== null) {
    const [i, d] = best;
    const y_at = inp.eye.y + (inp.dir.y / Math.max(v3(inp.dir.x, 0.0, inp.dir.z).length(), 0.01)) * d;
    const head = y_at > 1.42 * scale(g.zombies[i].kind);
    hit_zombie(g, i, dmg, head, w.stun, w.knock, inp.dir);
    if (bash) g.play('wood', 0.7); // báng gỗ / nhựa đập vào vỏ thép: thêm tiếng cộc trên tiếng trúng
    wear(g, w.deg * dur_mul(g));
    return;
  }
  const k = ray_explosive(g, inp.eye, inp.dir, w.range + 0.5);
  if (k !== null) {
    g.props[k].hp = 0.0;
    wear(g, w.deg * dur_mul(g));
    return;
  }
  // [par-counter D37] thùng gỗ trong kho: một nhát cận chiến trong tầm là vỡ, đồ bên trong rơi ra đất
  const wb = g.props.find((p) => !p.dead && p.kind.k === 'WBox' && (() => {
    const f = v3(p.pos.x - inp.eye.x, 0.0, p.pos.z - inp.eye.z);
    const d = f.length();
    return d < w.range + 0.9 && f.normalize_or_zero().dot(flat) > 0.7;
  })());
  if (wb !== undefined) {
    wb.dead = true;
    g.complete('FindRecipe'); // [FTUE A2] gốc DestructableContainerDestroyedQuestController (thùng gỗ trong kho)
    g.play('break', 0.7);
    g.fxq.push([fx.FX_DEBRIS, wb.pos.add(Y.mul(0.35))]);
    actors_drop(g, wb);
    wear(g, w.deg * dur_mul(g));
    return;
  }
  if (bash) {
    return;
  }
  if (inp.bed_door && g.bed_door_hits < 3) {
    if (item !== game.HAMMER) {
      g.say('The jammed door needs the hammer.');
      return;
    }
    g.bed_door_hits += 1;
    g.fxq.push([fx.FX_DEBRIS, lay.up(lay.BED_DOOR, 1.2).add(X.mul(-0.175 * lay.BED_DOOR_SWING))]);
    g.play('wood', 0.9);
    if (g.bed_door_hits >= 3) {
      g.complete('JammedDoor');
      g.play('break', 0.7);
      g.say('The jammed door bursts open.');
    }
  }
}

function spread(g, dir) {
  const s = deg2rad(10.0 - 10.0 * clamp(g.cb.acc, 0.0, 1.0));
  const yaw = g.rng.range(-s, s);
  const pitch = g.rng.range(-s, s);
  const right = dir.cross(Y).normalize_or_zero();
  const up = right.cross(dir).normalize_or_zero();
  return dir.add(right.mul(Math.tan(yaw))).add(up.mul(Math.tan(pitch))).normalize_or_zero();
}

function start_reload(g) {
  const w = g.wsel < g.weapons.length ? g.weapons[g.wsel] : null;
  if (w === null || w === undefined) return;
  const gg = items.gun(w.item);
  if (gg === null) return;
  const gd = gg[1];
  if (gd.clip === 0 || w.clip >= gd.clip || g.cb.reload_t > 0.0) {
    return;
  }
  const bank = gd.ammo < N_ITEMS ? g.inv[gd.ammo] : 0;
  if (bank < 1) {
    g.play('deny', 0.4);
    g.say(`No ${gd.ammo < N_ITEMS ? items.iname(gd.ammo) : 'ammo'} left.`);
    return;
  }
  const m = skills.mul(g, 'ReloadSpeedMultiplier');
  g.cb.reload_t = Math.max(gd.reload / (m > 0.0 ? m : 1.0), 0.01);
  g.play('reload', 0.6);
}

function fire(g, inp, item) {
  const gg = items.gun(item);
  if (gg === null) return;
  const [w, gd] = gg;
  const pm = skills.mul(g, 'ProjectileWeaponDamageMultiplier');
  const dmg = w.dmg * (pm > 0.0 ? pm : 1.0);
  g.cb.fire_cd = Math.max(w.cd, 0.03);
  g.swing = 0.12;
  g.cb.swing_len = 0.12;
  if (gd.clip === 0) {
    // Súng phun lửa: không băng đạn, đốt mọi zombie trong nón 8 m.
    g.cb.flame_t -= inp.dt;
    if (g.cb.flame_t <= 0.0) {
      g.cb.flame_t = 0.4;
      g.play('flame', 0.5);
    }
    const flat = v3(inp.dir.x, 0.0, inp.dir.z).normalize_or_zero();
    for (const z of g.zombies) {
      if (!(!z.dead && z.hp > 0.0)) continue;
      const to = v3(z.pos.x - inp.eye.x, 0.0, z.pos.z - inp.eye.z);
      if (to.length() < 8.0 && to.normalize_or_zero().dot(flat) > 0.85) {
        z.hp -= dmg * w.cd;
        z.burn = 5.0;
        z.chasing = true;
      }
    }
    g.fxq.push([fx.FX_SPARK, inp.eye.add(inp.dir.mul(2.5))]);
    wear(g, w.deg * dur_mul(g) * 0.1);
    return;
  }
  if (g.wsel < g.weapons.length) {
    g.weapons[g.wsel].clip -= 1;
  }
  g.play('shot', 0.7);
  g.cb.flash = [inp.eye.add(inp.dir.mul(0.8)), 0.9];
  const max = w.range * 3.0;
  const explosive = gd.ammo === 78;
  const pierce = item === 172;
  // Điểm tới của từng viên, cho đầu đạn bay nhìn thấy được (`fp.rs`): (điểm, hiệu ứng khi tới, để lại lỗ trên đất).
  const ends = [];
  const np = Math.max(gd.pellets, 1);
  for (let pi = 0; pi < np; pi++) {
    const d = spread(g, inp.dir);
    if (explosive) {
      // Tên lửa bay thật và nổ khi chạm (trước đây nổ ngay ở điểm ngắm).
      fp.rocket(g, item, inp.eye, d, dmg);
      continue;
    }
    let left = pierce ? 24 : 1;
    let from = 0.0;
    let end = null;
    // Vật dựng chắn trước zombie thì đạn dừng ở vật dựng (vụn / tia lửa, không vết đạn: `fp.shot` đánh dấu `built`).
    const bh = ray_built(g, inp.eye, d, max);
    const wall_t = (() => { const rw = fp.ray_world(g, inp.eye, d, max); return rw !== null ? rw[0] : Infinity; })();
    const stop = bh !== null && bh[0] < wall_t ? bh[0] : Infinity;
    while (left > 0) {
      left -= 1;
      let hit = ray_zombie(g, inp.eye.add(d.mul(from)), d, max - from);
      if (hit !== null && from + hit[1] > stop) hit = null;
      if (hit === null && stop < Infinity && (end === null || pierce)) {
        end = [inp.eye.add(d.mul(stop)), built_fx(g, bh[1]), false, true];
        break;
      }
      if (hit === null) {
        const k = ray_explosive(g, inp.eye, d, max);
        if (k !== null) {
          g.props[k].hp = 0.0;
        }
        if (end === null || pierce) {
          const rw = fp.ray_world(g, inp.eye, d, max);
          if (rw !== null && rw[1] === 0) {
            end = [inp.eye.add(d.mul(rw[0])), fx.FX_DUST, true];
          } else if (rw !== null) {
            const p = inp.eye.add(d.mul(rw[0]));
            end = [p, game.Game.in_shop(p.sub(d.mul(0.3))) ? fx.FX_DEBRIS : fx.FX_SPARK, false];
          } else {
            end = [inp.eye.add(d.mul(Math.min(max, 70.0))), null, false];
          }
        }
        break;
      }
      const [i, t, head] = hit;
      const dist = from + t;
      end = [inp.eye.add(d.mul(dist)), null, false];
      const fall = dist <= w.range ? 1.0 : Math.max(1.0 - ((dist - w.range) / (w.range * 2.0)) * 0.95, 0.05);
      hit_zombie(g, i, dmg * fall, head, w.stun, w.knock * 0.5, d);
      from = dist + 0.9;
    }
    if (end !== null) {
      ends.push(end);
    }
  }
  if (!explosive) {
    fp.shot(g, item, inp.eye, inp.dir, ends);
  }
  g.cb.acc = clamp(g.cb.acc - 0.25, 0.25, 0.8);
  wear(g, w.deg * dur_mul(g));
}

/// Hiệu ứng khi đạn chạm vật dựng: tia lửa cho đồ kim loại / dây thép gai, vụn gỗ cho phần còn lại.
export function built_fx(g, id) {
  const p = g.prop(id);
  if (p === null) return fx.FX_DEBRIS;
  if (p.kind.k === 'Wire') return fx.FX_SPARK;
  const it = p.kind.a;
  return [game.SHELF_SECURE, game.TABLE_SECURE, game.UNIT_SPECIAL, game.FRIDGE, game.RACK, game.TURRET, game.AUTO_MINIGUN].includes(it) ? fx.FX_SPARK : fx.FX_DEBRIS;
}

/// Ném món đang chọn với mức nạp hiện tại. (Rust `throw`; renamed: reserved word in JS.)
function throw_(g, inp, item) {
  const mult = items.throwable(item);
  if (mult === null) return;
  if (g.inv[item] < 1) {
    g.cb.throw_item = null;
    return;
  }
  g.inv[item] -= 1;
  const speed = (0.5 + 0.5 * clamp(g.cb.charge / 1.0, 0.0, 1.0)) * 14.0 * Math.max(mult, 0.01);
  const id = g.add_prop({ k: 'Item', a: item }, inp.eye.add(inp.dir.mul(0.5)), g.yaw);
  g.cb.projs.push([id, inp.dir.mul(speed).add(Y.mul(2.0)), item]);
  g.cb.charge = 0.0;
  g.play('swing', 0.6);
  if (g.inv[item] < 1) {
    g.cb.throw_item = null;
  }
}

/// [par-counter D37] đồ trong thùng gỗ vỡ: mọi món rơi xuống đất quanh thùng (player.drop_loot), tờ công thức nằm đó để Learn.
function actors_drop(g, p) {
  const got = p.kind.a.slice();
  if (got.length && player_mod.drop_loot) player_mod.drop_loot(g, p.id, p.pos, got, 'Wooden Crate');
}

/// [par-counter A05] giữ chuột quá chừng này (giây) với vũ khí cận chiến thì bắt đầu lấy đà ném.
export const THROW_HOLD = 0.35;
/// Ném vũ khí cận chiến đang cầm: rời tay (bỏ khỏi ô), bay theo hướng nhìn; [ĐỀ XUẤT] sát thương ném = 1,5 x sát thương đánh,
/// tốc độ 9-16 m/s theo đà (gốc có chỉ số "Throw Damage" / "Throw Range" theo món, chưa giải được số).
function throw_melee(g, inp, m) {
  const k = g.wsel;
  if (!(k < g.weapons.length)) return;
  const w = g.weapons[k];
  const speed = 9.0 + 7.0 * clamp(g.cb.charge, 0.0, 1.0);
  g.weapons.splice(k, 1);
  g.wsel = 0;
  g.armed = false;
  g.cb.charge = 0.0;
  const id = g.add_prop({ k: 'Item', a: w.item }, inp.eye.add(inp.dir.mul(0.5)), g.yaw);
  g.props[g.props.length - 1].loose = true;
  g.cb.projs.push([id, inp.dir.mul(speed).add(Y.mul(1.5)), w.item, m.dmg * 1.5]);
  g.play('swing', 0.7);
}

/// Bắn tháp súng đang ngồi: 10 sát thương mỗi 0,1 s, tầm 20 m, tản 0,5 độ, 1 viên mỗi loạt.
function fire_turret(g, inp, id) {
  g.bld.mount_cd -= inp.dt;
  if (!inp.down || g.bld.mount_cd > 0.0) {
    return;
  }
  const k = g.props.findIndex((p) => p.id === id && !p.dead);
  if (k < 0) {
    g.bld.mounted = null;
    return;
  }
  if (g.props[k].aux < 1.0) {
    g.play('deny', 0.3);
    g.bld.mount_cd = 0.4;
    g.say('The turret is empty. [R] loads 556 Ammo.');
    return;
  }
  g.props[k].aux -= 1.0;
  g.bld.mount_cd = 0.1;
  g.play('shot', 0.5);
  const o = g.props[k].pos.add(Y.mul(1.25));
  g.cb.flash = [o.add(inp.dir), 0.8];
  const hit = ray_zombie(g, o, inp.dir, 20.0);
  if (hit !== null) {
    hit_zombie(g, hit[0], 10.0, hit[2], 0.5, 2.0, inp.dir);
  }
}

/// Xử lý chuột / phím vũ khí mỗi khung hình (gọi từ player_system khi không mở bảng nào).
export function player_weapons(g, inp) {
  g.cb.acc += (0.8 - g.cb.acc) * Math.min(inp.dt * 6.0, 1.0);
  g.cb.fire_cd -= inp.dt;
  if (g.bld.mounted !== null) {
    const id = g.bld.mounted;
    if (inp.reload) {
      const k = g.props.findIndex((p) => p.id === id);
      if (k < 0) return;
      const n = Math.min(g.inv[game.AMMO_556], 9999 - trunc(g.props[k].aux));
      if (n > 0) {
        g.inv[game.AMMO_556] -= n;
        g.props[k].aux += n;
        g.play('reload', 0.6);
        g.say(`Loaded ${n} rounds into the turret.`);
      } else {
        g.say('No 556 Ammo to load.');
      }
    }
    fire_turret(g, inp, id);
    return;
  }
  if (g.held !== null || g.bld.ghost !== null) {
    return;
  }
  // Đồ ném: giữ chuột để nạp, thả để ném.
  if (g.cb.throw_item !== null) {
    const item = g.cb.throw_item;
    if (inp.down) {
      g.cb.charge = Math.min(g.cb.charge + inp.dt, 1.0);
      g.prompt = `Throw ${items.iname(item)}  ${(g.cb.charge * 100.0).toFixed(0)}%`;
    } else if (inp.released && g.cb.charge > 0.0) {
      throw_(g, inp, item);
    }
    return;
  }
  if (!g.armed) {
    return;
  }
  if (!(g.wsel < g.weapons.length)) return;
  const w = { ...g.weapons[g.wsel] };
  const m = items.melee(w.item);
  if (m !== null) {
    // [par-counter A05] gốc "Attack/Throw": bấm là đánh, giữ chuột là lấy đà ném ("Charge Throw"), thả thì vũ khí bay đi,
    // trúng zombie gây sát thương rồi nằm lại trên đất để nhặt lại. Búa là đồ nghề, không ném.
    if (w.item !== game.HAMMER) {
      if (inp.down && !m.auto) {
        g.cb.mhold = (g.cb.mhold || 0) + inp.dt;
        g.cb.mhold_f = (g.cb.mhold_f || 0) + 1;
        // đủ 0,35 s giờ game và ít nhất 12 khung hình (lúc tua nhanh, một cú bấm 50 ms không thành lấy đà)
        if (g.cb.mhold > THROW_HOLD && g.cb.mhold_f >= 12 && g.swing <= 0.0) {
          g.cb.charge = Math.min(g.cb.charge + inp.dt, 1.0);
          g.prompt = `Charge Throw ${items.iname(w.item)}  ${(g.cb.charge * 100.0).toFixed(0)}%`;
        }
        if (g.cb.charge > 0.0) return;
      } else {
        const charged = g.cb.charge > 0.0;
        g.cb.mhold = 0;
        g.cb.mhold_f = 0;
        if (inp.released && charged) { throw_melee(g, inp, m); return; }
        g.cb.charge = 0.0;
      }
    }
    if ((inp.click || (m.auto && inp.down)) && g.swing <= 0.0) {
      g.swing = Math.max(m.cd, 0.12);
      g.cb.swing_len = g.swing;
      g.swing_hit = false;
      g.play('swing', 0.5);
    }
    if (g.swing > 0.0 && !g.swing_hit && g.cb.swing_len - g.swing >= Math.min(g.cb.swing_len * 0.27, 0.2)) {
      g.swing_hit = true;
      melee_hit(g, inp, w.item);
    }
    return;
  }
  const gg = items.gun(w.item);
  if (gg === null) return;
  const [gw, gd] = gg;
  // Đập báng (Z): không khi đang nạp đạn (khớp `fp.pose`); trong cú đập không bắn.
  // Phiên 8, theo luật gốc (chủ dự án: "giống bản gốc trước"): bản gốc không có đòn đập báng gây sát thương; Z chỉ còn là
  // dáng tay của fp.pose như trước. `?bash=1` bật lại đòn đập của fin-combat để thử.
  if (bash_on() && inp.bash && g.cb.bash_t <= 0.0 && g.cb.reload_t <= 0.0) {
    g.cb.bash_t = BASH.dur;
    g.cb.bash_hit = false;
  }
  if (g.cb.bash_t > 0.0) {
    g.cb.bash_t -= inp.dt;
    if (!g.cb.bash_hit && BASH.dur - g.cb.bash_t >= BASH.hit_at) {
      g.cb.bash_hit = true;
      melee_hit(g, inp, w.item, true);
    }
    return;
  }
  if (g.cb.reload_t > 0.0) {
    g.cb.reload_t -= inp.dt;
    g.prompt = 'Reloading...';
    if (g.cb.reload_t <= 0.0) {
      const bank = g.inv[gd.ammo];
      const moved = Math.max(Math.min(gd.clip - w.clip, bank), 0);
      g.inv[gd.ammo] -= moved;
      if (g.wsel < g.weapons.length) {
        g.weapons[g.wsel].clip += moved;
      }
    }
    return;
  }
  if (inp.reload) {
    start_reload(g);
    return;
  }
  const want = gw.auto ? inp.down : inp.click;
  if (want && g.cb.fire_cd <= 0.0) {
    if (gd.clip === 0 || w.clip >= 1) {
      fire(g, inp, w.item);
    } else {
      start_reload(g);
    }
  }
}

/// Phím 1..4: tay không, đổi vũ khí cận chiến, đổi súng, đổi đồ ném.
export function select(g, key) {
  if (g.held !== null && key !== 1) {
    g.say('Your hands are full. [X] to drop.');
    return;
  }
  g.cb.reload_t = 0.0;
  g.cb.charge = 0.0;
  items.unequip_med(g);
  switch (key) {
    case 1: {
      g.armed = false;
      g.cb.throw_item = null;
      break;
    }
    case 2:
    case 3: {
      const cls = key - 1;
      const list = [];
      for (let i = 0; i < g.weapons.length; i++) if (items.wclass(g.weapons[i].item) === cls) list.push(i);
      if (list.length === 0) {
        g.say(cls === 1 ? 'No melee weapon equipped. Equip one from the backpack [Tab].' : 'No gun equipped. Equip one from the backpack [Tab].');
        return;
      }
      const p = list.indexOf(g.wsel);
      const next = p >= 0 && g.armed ? list[(p + 1) % list.length] : list[0];
      g.wsel = next;
      g.armed = true;
      g.cb.throw_item = null;
      g.cb.acc = 0.5;
      g.play('pick', 0.4);
      break;
    }
    default: {
      const list = [];
      for (let i = 0; i < N_ITEMS; i++) if (items.throwable(i) !== null && g.inv[i] > 0) list.push(i);
      if (list.length === 0) {
        g.say('No throwables in the backpack.');
        return;
      }
      const p = g.cb.throw_item !== null ? list.indexOf(g.cb.throw_item) : -1;
      const next = p >= 0 ? list[(p + 1) % list.length] : list[0];
      g.cb.throw_item = next;
      g.armed = false;
      g.play('pick', 0.4);
    }
  }
}

/// Nhãn ô vũ khí trên HUD: tên, độ bền, đạn.
export function weapon_label(g) {
  if (g.bld.mounted !== null) {
    const id = g.bld.mounted;
    const pr = g.props.find((p) => p.id === id);
    const ammo = pr !== undefined ? trunc(pr.aux) : 0;
    return ['Mountable Turret', `ammo ${ammo}   [R] load   [E] leave`];
  }
  if (g.cb.throw_item !== null) {
    const t = g.cb.throw_item;
    return [items.iname(t), `x${g.inv[t]}   hold [LMB] to throw`];
  }
  if (g.med_hand !== null) {
    // gốc c01 5:45:05: tên món dưới thanh đồ, gợi ý trái dưới "Consume / Cycle Slot / Unequip"
    const t = g.med_hand;
    return [items.iname(t), `x${g.inv[t]}   [LMB] Consume   [F] Cycle Slot   [X] Unequip`];
  }
  const w = g.cur_w();
  if (w !== null && w !== undefined) {
    const gg = items.gun(w.item);
    const sub = gg !== null && gg[1].clip > 0
      ? `${w.clip} / ${g.inv[gg[1].ammo]}   durability ${w.dur.toFixed(0)}%`
      : `durability ${w.dur.toFixed(0)}%`;
    return [items.iname(w.item), sub];
  }
  return ['', ''];
}

// ---------- nổ, cháy, đồ ném đang bay ----------

/// Nổ tại `pos`: zombie và vật nổ khác trong bán kính nhận sát thương giảm tuyến tính. Đồ nổ của người chơi không làm
/// người chơi bị thương (luật gốc: phe Player `CanHurtSelf` = false).
export function explode(g, pos, dmg, radius, fire, yellow) {
  g.play('boom', 0.9);
  if (yellow) { fx.YELLOW_BOOMS.push(pos.clone()); if (fx.YELLOW_BOOMS.length > 8) fx.YELLOW_BOOMS.shift(); }
  g.fxq.push([fx.FX_BOOM, pos.clone()]);
  g.cb.flash = [pos.clone(), 1.5];
  fp.boom(g, pos, radius);
  for (const z of g.zombies) {
    if (!(!z.dead && z.hp > 0.0)) continue;
    const d = z.pos.distance(pos);
    if (d < radius) {
      z.hp -= dmg * (1.0 - d / radius);
      z.stagger = 1.0;
      z.chasing = true;
      if (fire) {
        z.burn = 5.0;
      }
    }
  }
  for (const p of g.props) {
    if (!(!p.dead && is_explosive_placed(p.kind))) continue;
    if (p.pos.distance(pos) < radius && p.pos.distance(pos) > 0.05) {
      p.hp = 0.0;
    }
  }
  if (fire) {
    g.cb.fires.push([pos.clone(), 3.0, 5.0]);
  }
}

/// Nổ của boss: chỉ đánh người chơi.
function boss_blast(g, pos, dmg, radius) {
  g.play('boom', 0.9);
  g.fxq.push([fx.FX_BOOM, pos.add(Y.mul(0.5))]);
  g.cb.flash = [pos.add(Y), 1.5];
  const d = g.player.distance(pos);
  if (d < radius) {
    g.damage_player(dmg * (1.0 - d / radius));
    g.vel_y = 3.0;
  }
}

export function tick(g, dt) {
  g.cb.tracers.length = 0;
  fp.tick(g, dt);
  // Đồ ném đang bay.
  const projs = g.cb.projs;
  g.cb.projs = [];
  const kept = [];
  for (const pr of projs) {
    const [id, vel, item, tdmg] = pr;
    vel.y -= 14.0 * dt;
    const k = g.props.findIndex((p) => p.id === id && !p.dead);
    if (k < 0) continue;
    const np = g.props[k].pos.add(vel.mul(dt));
    const hit_z = g.zombies.some((z) => !z.dead && z.hp > 0.0 && Math.hypot(z.pos.x - np.x, z.pos.z - np.z) < 0.5 && np.y < 1.9);
    if (np.y > 0.05 && !hit_z) {
      g.props[k].pos = np;
      g.props[k].yaw += dt * 9.0;
      kept.push(pr);
      continue;
    }
    const at = v3(np.x, 0.1, np.z);
    if (tdmg !== undefined) {
      // [par-counter A05] vũ khí cận chiến ném: trúng con gần nhất, rồi rơi xuống đất tại chỗ (nhặt lại được)
      const zi = g.zombies.findIndex((z) => !z.dead && z.hp > 0.0 && Math.hypot(z.pos.x - np.x, z.pos.z - np.z) < 0.5 && np.y < 1.9);
      if (zi >= 0) { hit_zombie(g, zi, tdmg, false, 0.5, 2.5, vel.normalize_or_zero()); g.play('hit', 0.6); }
      else g.play('drop', 0.6);
      const r = world.resolve(g, v3(np.x, 0.0, np.z), 0.2);
      g.props[k].pos = v3(r.x, 0.0, r.z);
      continue;
    }
    g.props[k].dead = true;
    switch (item) {
      case game.GRENADE: explode(g, at, 250.0, 6.0, false, true); break;
      case game.NAIL_BOMB: explode(g, at, 150.0, 4.0, false, true); break;
      case game.MOLOTOV: {
        g.play('break', 0.6);
        explode(g, at, 20.0, 3.0, true);
        break;
      }
      default: {
        // Xương: mồi nhử, zombie trong 20 m kéo tới chỗ rơi.
        g.cb.lure = [at, 8.0];
        g.play('drop', 0.6);
      }
    }
  }
  g.cb.projs = kept;
  const fires = g.cb.fires;
  g.cb.fires = [];
  const fkept = [];
  for (const f of fires) {
    const pos = f[0], r = f[1];
    f[2] -= dt;
    for (const z of g.zombies) {
      if (!z.dead && z.pos.distance(pos) < r) {
        z.burn = Math.max(z.burn, 1.0);
      }
    }
    if (g.rng.chance(dt * 6.0)) {
      const ox = g.rng.range(-r, r) * 0.6;
      const oz = g.rng.range(-r, r) * 0.6;
      g.fxq.push([fx.FX_SPARK, pos.add(v3(ox, 0.2, oz))]);
    }
    if (f[2] > 0.0) fkept.push(f);
  }
  g.cb.fires = fkept;
  if (g.cb.lure !== null) {
    const [p, t] = g.cb.lure;
    g.cb.lure = t - dt > 0.0 ? [p, t - dt] : null;
  }
  // Vị trí hai chị Twins (cho hào quang tăng tốc / hồi máu) và thanh máu boss.
  const zb = g.zombies.find((z) => !z.dead && z.kind === 'TwinBuff');
  g.cb.buff_at = zb !== undefined ? zb.pos.clone() : null;
  const zh = g.zombies.find((z) => !z.dead && z.kind === 'TwinHeal');
  g.cb.heal_at = zh !== undefined ? zh.pos.clone() : null;
  const zx = g.zombies.find((z) => !z.dead && boss(z.kind));
  g.cb.boss = zx === undefined ? null
    : (zx.kind === 'TwinBuff' || zx.kind === 'TwinHeal')
      ? [label(zx.kind), Math.max(g.cb.twin_pool, 0.0), 4000.0 * Math.max(g.cb.hp_mul, 1.0)]
      : [label(zx.kind), Math.max(zx.hp, 0.0), zstats(zx.kind)[0] * Math.max(g.cb.hp_mul, 1.0)];
  // Con của Birther.
  const babies = g.cb.babies;
  g.cb.babies = [];
  for (const p of babies) {
    const i = actors.spawn_zombie(g, 'Baby', p, false);
    g.zombies[i].chasing = true;
  }
}

/// Hành vi riêng của zombie (cháy, bị giữ chân, boss). Trả về true nếu khung này zombie không chạy AI thường.
export function zombie_special(g, z, dt, alive) {
  z.spike_cd -= dt;
  z.root -= dt;
  if (z.burn > 0.0) {
    z.burn -= dt;
    z.hp -= 25.0 * dt;
    if (g.rng.chance(dt * 4.0)) {
      g.fxq.push([fx.FX_SPARK, z.pos.add(Y.mul(1.0))]);
    }
  }
  const near = (p) => p !== null && p.distance(z.pos) < 15.0;
  z.speed_mul = near(g.cb.buff_at) && !boss(z.kind) ? 1.75 : 1.0;
  if (near(g.cb.heal_at) && z.hp > 0.0 && !boss(z.kind)) {
    z.hp = Math.min(z.hp + 20.0 * dt, zstats(z.kind)[0] * Math.max(g.cb.hp_mul, 1.0));
  }
  const dist = z.pos.distance(g.player);
  switch (z.kind) {
    case 'Birther': {
      z.special -= dt;
      if (z.special <= 0.0 && alive) {
        z.special = 20.0;
        const back = rot_y(z.yaw, Z).mul(0.5);
        const cnt = g.rng.int(6, 9);
        for (let q = 0; q < cnt; q++) {
          const ox = g.rng.range(-0.3, 0.3);
          const oz = g.rng.range(-0.3, 0.3);
          const p = z.pos.add(back).add(v3(ox, 0.0, oz));
          g.cb.babies.push(p);
        }
        g.play('roar', 0.7);
        g.say('The Birther spawns a brood!');
      }
      break;
    }
    case 'TwinBuff':
    case 'TwinHeal': {
      const max = zstats(z.kind)[0];
      if (z.hp < max) {
        g.cb.twin_pool -= max - z.hp;
        z.hp = max;
      }
      if (g.cb.twin_pool <= 0.0) {
        z.hp = 0.0;
      }
      // Gốc (clip 13 19:00-19:20): hai chị em đi tách nhau, quầng tím và quầng xanh không chồng lên nhau.
      // Con hồi máu giữ cách con tăng tốc ít nhất TWIN_GAP mét (chỉ đẩy ngang, không đổi máu / tốc độ).
      if (z.kind === 'TwinHeal' && alive && g.cb.buff_at !== null) {
        const ax = z.pos.x - g.cb.buff_at.x, az = z.pos.z - g.cb.buff_at.z, d = Math.hypot(ax, az);
        if (d < TWIN_GAP) {
          const push = Math.min(TWIN_GAP - d, 4.0 * dt) / Math.max(d, 1e-3);
          z.pos.x += (d < 1e-3 ? 1.0 : ax) * push;
          z.pos.z += (d < 1e-3 ? 0.0 : az) * push;
        }
      }
      break;
    }
    case 'Brute': {
      if (z.act === 0) {
        z.special -= dt;
        if (z.special <= 0.0 && alive && z.chasing) {
          if (z.n_att >= 5) {
            // Đủ 5 đòn: đổi chỗ (đuổi theo người chơi 4 giây).
            z.n_att = 0;
            z.special = 4.0;
          } else {
            z.act = dist <= 5.0 ? 1 : 2;
            z.act_t = z.act === 1 ? 2.0 : 2.33;
            z.aim = g.player.clone();
            z.wind = 0.0;
            g.play('roar', z.act === 1 ? 0.9 : 0.6);
          }
        }
        // Giữa các đòn Brute đứng tại chỗ (trừ lúc đổi chỗ).
        return z.n_att < 5 && z.special < 3.0 && dist < 30.0;
      }
      z.act_t -= dt;
      const d = v3(g.player.x - z.pos.x, 0.0, g.player.z - z.pos.z);
      if (d.length() > 0.1) {
        z.yaw = Math.atan2(-d.x, -d.z);
      }
      if (z.act_t <= 0.0) {
        if (z.act === 1) {
          boss_blast(g, z.pos, 200.0, 5.0);
        } else {
          boss_blast(g, z.aim, 120.0, 4.0);
          g.fxq.push([fx.FX_DEBRIS, z.aim.add(Y.mul(0.4))]);
        }
        const rest = z.act === 1 ? 2.0 : 1.5;
        z.act = 0;
        z.n_att += 1;
        z.special = 1.0 + g.rng.range(-0.25, 0.25) + rest;
      }
      return true;
    }
    case 'Sweaty': {
      if (z.air > 0.0) {
        z.air -= dt;
        // Điểm rơi bám theo người chơi tới 1 giây cuối rồi chốt: còn 1 giây để chạy khỏi vùng nổ 6 m.
        if (z.air > 1.0) {
          z.aim = g.player.clone();
        }
        if (z.air <= 0.0) {
          z.pos = world.resolve(g, v3(z.aim.x, 0.0, z.aim.z), 0.6).clone();
          boss_blast(g, z.pos, 300.0, 6.0);
          z.hp -= (zstats(z.kind)[0] * Math.max(g.cb.hp_mul, 1.0)) / g.rng.range(9.0, 10.0);
          z.special = g.rng.range(7.0, 10.0);
        }
        return true;
      }
      z.special -= dt;
      if (z.special <= 0.0 && alive && z.chasing) {
        z.air = 5.0;
        g.play('roar', 0.9);
        g.say('The Sweaty Rotter leaps into the air!');
        return true;
      }
      // Sweaty Rotter chỉ nhảy, không cào: tới gần thì đứng lại.
      if (dist < 3.0) {
        return true;
      }
      break;
    }
    default: break;
  }
  return z.root > 0.0;
}

// ---------- raid: hàng chờ, đợt, thưởng, Hellraid ----------

function zk(code) {
  switch (code) {
    case 1: return 'Birther';
    case 2: return 'Brute';
    case 3: return 'Hulk';
    case 4: return 'Sweaty';
    case 5: return 'Tumour';
    case 6: return 'TwinBuff';
    default: return 'Base';
  }
}

function curve(keys, t) {
  for (let i = 0; i + 1 < keys.length; i++) {
    const w0 = keys[i], w1 = keys[i + 1];
    if (t <= w1[0]) {
      return w0[1] + (w1[1] - w0[1]) * clamp((t - w0[0]) / (w1[0] - w0[0]), 0.0, 1.0);
    }
  }
  return keys[keys.length - 1][1];
}

/// Các đợt của một raid: 0..4 là raid soạn sẵn, `HELL` là Hellraid thứ `hell_n` sinh theo ngân sách.
export function waves_of(g, def) {
  if (def < RAID_DEFS.length) {
    g.cb.hp_mul = 1.0;
    return RAID_DEFS[def][2].map((w) => w.map(([k, n]) => [zk(k), n]));
  }
  const n = g.cb.hell_n;
  const t = clamp(n / 1000.0, 0.0, 1.0);
  const wave_count = rround(curve([[0.0, 3.0], [0.025, 5.014], [1.0, 10.0]], t));
  const budget = curve([[0.0, 30.0], [1.0, 1000.0]], t);
  g.cb.hp_mul = curve([[0.0, 1.0], [0.025, 1.0], [0.05, 1.5], [0.1, 2.0], [1.0, 5.0]], t);
  const r = new Rng(((0x4e11 ^ Math.imul(n >>> 0, 2654435761)) | 1) >>> 0);
  const out = [];
  for (let w = 0; w < wave_count; w++) {
    let left = budget * Math.pow(1.2, w);
    const cnt = [0, 0, 0];
    let total = 0;
    while (left >= 1.0 && total < 50) {
      const k = left >= 5.0 ? clamp(r.int(0, 2), 0, 2) : clamp(r.int(0, 1), 0, 1);
      cnt[k] += 1;
      total += 1;
      left -= k === 2 ? 5.0 : 1.0;
    }
    out.push([['Base', cnt[0]], ['Tumour', cnt[1]], ['Hulk', cnt[2]]]);
  }
  // Boss: 2 con từ Hellraid đầu (tối đa 4), dồn vào đợt cuối; Sweaty từ lần 5, Twins từ lần 6.
  const bosses = clamp(rround(curve([[0.0, 2.0], [0.015, 3.0], [0.1, 8.0]], t)), 1, 4);
  let pool = ['Brute', 'Birther'];
  if (n >= 4) {
    pool.push('Sweaty');
  }
  if (n >= 5) {
    pool.push('TwinBuff');
  }
  const last = out.length - 1;
  for (let b = 0; b < bosses; b++) {
    const k = r.pick(pool);
    if (k === 'TwinBuff') {
      pool = pool.filter((x) => x !== 'TwinBuff');
    }
    const w = b === 0 ? last : Math.max(0, last - (b % 2));
    out[w].push([k, 1]);
  }
  return out;
}

/// Xếp một raid soạn sẵn vào hàng chờ, tới sau 4 ngày (hạ một bầy trên bản đồ thì raid của bầy đó được xếp).
export function queue_raid(g, def) {
  if (!g.on(game.FF_BOSSES) || def >= RAID_DEFS.length || g.cb.won[def] || (g.raid.index === def && g.raid.next_day < 9000) || g.cb.queue.some((q) => q[0] === def)) {
    return;
  }
  const day = g.day + 4;
  if (g.raid.next_day >= 9000) {
    g.raid.index = def;
    g.raid.next_day = day;
    g.raid.announced = false;
  } else {
    g.cb.queue.push([def, day]);
  }
  g.say(`RADIO: the ${RAID_DEFS[def][0]} horde is on the move. Expect a raid around day ${day}.`);
}

function next_raid(g) {
  if (g.cb.queue.length !== 0) {
    const [def, day] = g.cb.queue.shift();
    g.raid.index = def;
    g.raid.next_day = Math.max(day, g.day + 1);
  } else if (g.on(game.FF_BOSSES) && g.cb.won.every((w) => w)) {
    g.raid.index = HELL;
    g.raid.next_day = g.day + (g.cb.hell_n === 0 ? 3 : 5);
  } else {
    g.raid.next_day = 9999;
  }
  g.raid.announced = false;
}

function reward(g) {
  const extra = trunc(skills.sum(g, 'AdditionalRaidRewards'));
  const out = [];
  if (g.raid.index >= RAID_DEFS.length) {
    // Hellraid: bảng thưởng riêng, số lượt = RoundToInt(2 + 8t), số lượng x hệ số 1..5.
    const POOL = [
      [game.PISTOL, 4, 5, 1.0], [game.AMMO_9MM, 300, 500, 1.0], [game.UZI, 3, 4, 1.0], [game.AK47, 2, 3, 0.95], [game.AMMO_556, 250, 400, 1.0], [124, 1, 1, 0.75], [187, 1, 2, 0.75], [58, 3, 4, 0.5], [168, 1, 1, 0.33],
      [78, 100, 200, 0.5], [game.EXPLOSIVE_BARREL, 1, 3, 0.5], [80, 1, 1, 0.25], [game.BAT, 10, 15, 1.0], [193, 5, 6, 1.0], [173, 2, 3, 0.5], [game.REMOTE_BOMB, 4, 5, 0.5], [game.REMOTE_INC, 2, 3, 0.5], [game.MOLOTOV, 5, 6, 0.5],
      [game.GRENADE, 3, 4, 0.5], [game.NAIL_BOMB, 8, 10, 0.5], [game.FIRSTAID, 2, 3, 1.0], [game.PILLS, 10, 12, 1.0], [game.BARBED, 1, 2, 0.33], [game.TURRET, 1, 1, 0.33], [game.AUTO_MINIGUN, 1, 1, 0.1], [1, 200, 300, 1.0], [3, 150, 200, 1.0],
    ];
    const t = clamp(g.cb.hell_n / 1000.0, 0.0, 1.0);
    const picks = Math.max(rround(2.0 + 8.0 * t), 1);
    const cand = POOL.map((c) => c.slice());
    const np = Math.min(picks, cand.length);
    for (let q = 0; q < np; q++) {
      let sum = 0;
      for (const c of cand) sum += c[3];
      let r = g.rng.next() * sum;
      let k = 0;
      for (let i = 0; i < cand.length; i++) {
        const c = cand[i];
        if (r < c[3]) {
          k = i;
          break;
        }
        r -= c[3];
      }
      const c = cand.splice(k, 1)[0];
      const n = Math.max(rround(g.rng.int(c[1], c[2]) * (1.0 + 4.0 * t)), 1) + extra;
      for (let j = 0; j < n; j++) out.push(c[0]);
    }
    return out;
  }
  const rw = REWARDS[Math.min(RAID_DEFS[g.raid.index][1], REWARDS.length - 1)];
  const budget = rw[1], entries = rw[2];
  const fl = Math.floor(budget);
  const picks = clamp(fl + (budget - fl > g.rng.next() ? 1 : 0), 1, entries.length);
  const cand = entries.map((c) => c.slice());
  for (let q = 0; q < picks; q++) {
    let sum = 0;
    for (const c of cand) sum += c[1];
    let r = g.rng.next() * sum;
    let k = 0;
    for (let i = 0; i < cand.length; i++) {
      const c = cand[i];
      if (r < c[1]) {
        k = i;
        break;
      }
      r -= c[1];
    }
    const c = cand.splice(k, 1)[0];
    const n = Math.max(g.rng.int(c[2], c[3]) + extra, 0);
    for (let j = 0; j < n; j++) out.push(c[0]);
  }
  return out;
}

export const TWIN_GAP = 9.0;

function spawn_raider(g, kind) {
  const b = lay.RAID_SPAWN;
  const px = g.rng.range(b[0], b[2]);
  const pz = g.rng.range(b[1], b[3]);
  const p = v3(px, 0.0, pz);
  let kinds = [kind];
  if (kind === 'TwinBuff') {
    g.cb.twin_pool = 4000.0 * Math.max(g.cb.hp_mul, 1.0);
    kinds = ['TwinBuff', 'TwinHeal', 'Hulk', 'Hulk', 'Hulk', 'Hulk'];
  }
  for (let k = 0; k < kinds.length; k++) {
    const kd = kinds[k];
    // TwinHeal ra cách TwinBuff TWIN_GAP mét theo x (gốc: hai quầng tách rõ)
    const i = actors.spawn_zombie(g, kd, p.add(kd === 'TwinHeal' ? v3(-TWIN_GAP, 0.0, 0.0) : v3(0.0, 0.0, k * 1.2)), true);
    if (!(kd === 'TwinBuff' || kd === 'TwinHeal')) {
      g.zombies[i].hp *= Math.max(g.cb.hp_mul, 1.0);
    }
    switch (kd) {
      case 'Birther': g.zombies[i].special = 20.0; break;
      case 'Sweaty': g.zombies[i].special = g.rng.range(7.0, 10.0); break;
      default: g.zombies[i].special = 1.0;
    }
    g.raid.total += 1;
  }
  if (boss(kind)) {
    g.play('roar', 0.9);
  }
}

export function tick_raid(g, dt) {
  if (g.mode !== 'Play') {
    return;
  }
  const today = g.day === g.raid.next_day;
  if (g.day > g.raid.next_day && !g.raid.active && g.raid.next_day < 9000) {
    // Ngày raid đã trôi qua (ngủ quên hoặc tải ván): tính là thua, raid quay lại sau 4 ngày.
    g.raid.next_day = g.day + 4;
  }
  if (today && !g.raid.announced && g.hour() >= 7.0 && g.hour() < 9.5) {
    g.raid.announced = true;
    // [FTUE A12] gốc RadioIntelObject: bàn Intel bậc 0 không có radio, không kêu; raid chỉ lộ ra trên thẻ Raid Rumour và To Do
    // "And Stay Out!" từ sáng ngày raid. Có radio (đã nâng bàn Intel) thì báo tin như trước.
    if (g.bld.tiers[build.T_INTEL] > 0) {
      g.play('radio', 0.8);
      g.say('RADIO: A horde is coming from the east. It will hit the shop at 09:30!');
      g.start_cine(cine.RAID_WARN);
    }
  }
  if (today && !g.raid.active && g.hour() >= 9.5 && g.raid.wave === 0) {
    g.raid.active = true;
    g.raid.announced = true;
    g.raid.wave = 0;
    g.raid.wave_t = 0.0;
    g.raid.total = 0;
    const def = g.raid.index;
    g.cb.waves = waves_of(g, def);
    g.cb.pending.length = 0;
    if (g.open) {
      g.toggle_open();
    }
    g.play('siren', 0.9);
    g.say(def === HELL ? `HELLRAID ${g.cb.hell_n + 1}! The horde is here.` : 'RAID! The horde is here.');
  }
  if (!g.raid.active) {
    if (!today) {
      g.raid.wave = 0;
    }
    return;
  }
  const step = dt * game.MIN_PER_SEC * Math.min(g.speed, 1.5);
  g.raid.wave_t += step;
  const n_waves = g.cb.waves.length;
  // Raid có `SpawnDelay` 1 phút (Sweaty, Twins): mỗi mục ra 2 con trong phút đầu rồi mỗi phút 1 con.
  const slow = g.raid.index === 3 || g.raid.index === 4;
  // Đợt sau chỉ tới khi quân raid của các đợt trước đã chết hết (gốc: c01 Day 37 thẻ RAID "Wave 1 / 3" từ 09:50 tới 11:01,
  // Day 25 lúc 13:21 mới "Wave 4 / 5"; "Next Wave: mm:ss" chỉ đếm giờ game tới 09:30 trước đợt đầu). Bản cũ cho đợt cách nhau
  // 1 phút game nên cả 48 con ra trong vài giây.
  while (g.raid.wave < n_waves && g.raid.wave_t >= g.raid.wave && g.cb.pending.length === 0 && (g.raid.wave === 0 || !g.zombies.some((z) => z.raid && !z.dead))) {
    const wave = g.cb.waves[g.raid.wave].map((e) => e.slice());
    for (const [kind, n0] of wave) {
      const n = n0 === 0 ? 0 : boss(kind) ? n0 : Math.max(rround(n0 * g.raid_scale), 1);
      for (let k = 0; k < n; k++) {
        if (slow && k >= 2 && !boss(kind)) {
          g.cb.pending.push([kind, (k - 1) * 0.25]);
        } else {
          spawn_raider(g, kind);
        }
      }
    }
    g.raid.wave += 1;
    if (g.raid.wave === 1) {
      g.start_cine(cine.RAID_START);
    }
    g.play('raiders', 0.8);
    g.say(`RAID  Wave ${g.raid.wave} / ${n_waves}`);
  }
  const due = [];
  g.cb.pending = g.cb.pending.filter((e) => {
    e[1] -= step;
    if (e[1] <= 0.0) {
      due.push(e[0]);
      return false;
    }
    return true;
  });
  for (const k of due) {
    spawn_raider(g, k);
  }
  if (g.raid.wave >= n_waves && g.cb.pending.length === 0 && !g.zombies.some((z) => z.raid && !z.dead)) {
    g.raid.active = false;
    const def = g.raid.index;
    const its = reward(g);
    if (def < 5) {
      g.cb.won[def] = true;
    } else {
      g.cb.hell_n += 1;
    }
    g.complete('DefeatRaid');
    g.start_cine(cine.RAID_WON);
    g.xp(0, 50);
    g.add_prop({ k: 'Reward', a: its }, lay.REWARD_DROP.clone(), 0.3);
    next_raid(g);
    g.play('win', 0.9);
    g.say('RAID DEFEATED! A supply drop has landed outside the shop.');
  }
}

/// Thua raid (gục): raid đang hẹn quay lại sau 4 ngày (Hellraid: 7 ngày).
export function raid_lost(g) {
  g.raid.next_day = g.day + (g.raid.index === HELL ? 7 : 4);
  g.raid.announced = false;
  g.cb.pending.length = 0;
}

/// Còi báo động: kéo raid đang chờ về 09:30 ngày mai (chỉ khi raid còn cách hơn 1 ngày).
export function siren(g) {
  if (g.raid.next_day < 9000 && g.raid.next_day > g.day + 1 && !g.raid.active) {
    g.raid.next_day = g.day + 1;
    g.raid.announced = false;
    g.play('siren', 0.9);
    g.say('The siren wails across the city. The raid will come TOMORROW at 09:30.');
  } else {
    g.play('deny', 0.5);
    g.say('No raid to call: none is pending, or it is already due within a day.');
  }
}

/// Thả bóng xác (ngoài trời): raid đang chờ lùi 30 ngày.
export function balloon(g) {
  if (game.Game.in_shop(g.player) || game.Game.in_bedroom(g.player) || lay.inside(lay.WAREHOUSE_IN, g.player)) {
    g.play('deny', 0.5);
    g.say('Release the carcass balloon outside.');
    return false;
  }
  if (g.raid.next_day >= 9000 || g.raid.active || g.raid.next_day <= g.day) {
    g.play('deny', 0.5);
    g.say('No pending raid to distract.');
    return false;
  }
  g.raid.next_day += 30;
  g.raid.announced = false;
  g.play('quest', 0.6);
  g.say(`The carcass balloon drifts away. The horde follows it: raid delayed to day ${g.raid.next_day}.`);
  return true;
}

// ---------- xác ----------

/// Vứt (thùng rác) hoặc nghiền (máy nghiền) xác đang kéo. Trả về false nếu tay không cầm xác.
export function dispose_held(g, shred) {
  if (g.held === null) return false;
  const id = g.held;
  const p = g.prop(id);
  if (p === null || p === undefined) return false;
  if (p.kind.k !== 'Corpse') return false;
  const kind = p.kind.a;
  p.dead = true;
  g.held = null;
  if (shred) {
    const [meat, bone] = kind === 2 ? [50, 5] : [10, 2];
    const double = (g) => (g.rng.next() < skills.sum(g, 'DismantleExtraItemChance') ? 2 : 1);
    const m = meat * double(g);
    const b = bone * double(g);
    g.inv[game.MEAT] += m;
    g.inv[game.BONE] += b;
    g.play('break', 0.6);
    g.say(`Shredded the corpse: ${m}x Good Meat, ${b}x Bone.`);
  } else {
    const m = skills.mul(g, 'WasteExperienceIncrease');
    g.add_xp(0, rround(5.0 * (m > 0.0 ? m : 1.0)));
    disposal_bonus(g);
    g.play('trash', 0.7);
    g.say('Corpse dumped.');
  }
  return true;
}

/// Nút "ObjectDisposalBonusExperience": mỗi 5 lần vứt được +50 XP Service.
export function disposal_bonus(g) {
  if (skills.has(g, 'ObjectDisposalBonusExperience')) {
    g.sk.disposals += 1;
    if (g.sk.disposals % 5 === 0) {
      g.add_xp(0, 50);
    }
  }
}

/** Rust `export` (renamed: reserved word in JS). */
export function export_(g) {
  const w = g.weapons.map((w) => `["${items.iname(w.item)}",${w.dur.toFixed(0)},${w.clip}]`);
  const throwS = g.cb.throw_item !== null ? `"${items.iname(g.cb.throw_item)}"` : 'null';
  const bossS = g.cb.boss !== null ? `["${g.cb.boss[0]}",${g.cb.boss[1].toFixed(0)},${g.cb.boss[2].toFixed(0)}]` : 'null';
  // Boss đang sống: [x, z, đòn đang ra (0 không, 1 dậm, 2 ném), giây còn lại của đòn, giây đang bay].
  const bossAct = g.zombies.filter((z) => !z.dead && boss(z.kind)).map((z) => `[${z.pos.x.toFixed(1)},${z.pos.z.toFixed(1)},${z.act},${Math.max(z.act_t, 0.0).toFixed(2)},${Math.max(z.air, 0.0).toFixed(2)}]`).join(',');
  return `{"weapons":[${w.join(',')}],"wsel":${g.wsel},"throw":${throwS},"reload":${Math.max(g.cb.reload_t, 0.0).toFixed(2)},"queue":[${g.cb.queue.map((q) => `[${q[0]},${q[1]}]`).join(',')}],"won":[${g.cb.won.map((x) => (x ? '1' : '0')).join(',')}],"hell":${g.cb.hell_n},"waves":${g.cb.waves.length},"pending":${g.cb.pending.length},"boss":${bossS},"bossAct":[${bossAct}],"index":${g.raid.index},"projs":${g.cb.projs.length},"fires":${g.cb.fires.length}}`;
}

export function save(g) {
  const w = g.weapons.map((w) => `${w.item}.${trunc(w.dur)}.${w.clip}`);
  return `${w.join(',')}|${g.cb.queue.map((q) => `${q[0]}.${q[1]}`).join(',')}|${g.cb.hell_n},${g.wsel}|${g.cb.won.map((x) => (x ? '1' : '0')).join(',')}`;
}

/** Rust `str::parse::<i32>().ok()`. */
function parse_i32(v) {
  if (!/^[+-]?\d+$/.test(v)) return null;
  const n = parseInt(v, 10);
  return n >= -2147483648 && n <= 2147483647 ? n : null;
}

export function load(g, s) {
  const parts = s.split('|');
  const trip = (r) => r.split('.').map(parse_i32).filter((v) => v !== null);
  g.weapons.length = 0;
  for (const r of (parts.length > 0 ? parts[0] : '').split(',')) {
    const t = trip(r);
    if (t.length === 3 && t[0] >= 0 && t[0] < N_ITEMS) {
      g.weapons.push({ item: t[0], dur: t[1], clip: t[2] });
    }
  }
  g.cb.queue = (parts.length > 1 ? parts[1] : '').split(',').map(trip).filter((t) => t.length === 2).map((t) => [t[0], t[1]]);
  const h = (parts.length > 2 ? parts[2] : '').split(',').map(parse_i32).filter((v) => v !== null);
  if (h.length >= 2) {
    g.cb.hell_n = h[0];
    // `h[1] as usize` wraps negatives to a huge value, so min() picks the last slot.
    const cap = Math.max(0, g.weapons.length - 1);
    g.wsel = h[1] < 0 ? cap : Math.min(h[1], cap);
  }
  const ws = (parts.length > 3 ? parts[3] : '').split(',').slice(0, 5);
  for (let k = 0; k < ws.length; k++) {
    g.cb.won[k] = ws[k] === '1';
  }
}

/* VIEW NOTES (combat.js)
 - combat.rs has no mesh code of its own. What it drives for the view:
   * g.cb.flash = [pos, intensity] (muzzle 0.9 at eye+dir*0.8, melee/bullet hit 0.6 at zombie head/body, turret 0.8, explosion
     1.5): player_system turns it into a short point-light flash (the Fx resource), then clears it.
   * g.fxq particles: FX_BLOOD at hit point (y 1.1 body / 1.55 head x zombie scale), FX_SPARK (flamethrower 2.5 m ahead,
     fire zones ~6/s, burning zombies ~4/s at y 1), FX_BOOM (explosions; boss blasts at +0.5 m), FX_DEBRIS (bed door hits,
     Brute car impact +0.4 m), FX_DUST (bullet into ground).
   * Thrown items are ordinary props PropKind Item(item) moved by tick(): pos integrates vel with gravity 14 m/s^2, yaw spins
     9 rad/s; they die on landing. Visible bullets / rockets come from fp.js (fp.shot / fp.rocket / fp.boom).
   * g.cb.fires: [centre, radius 3 m, seconds left of 5] burning ground zones (only sparks in Rust).
   * g.cb.boss = [label, hp, max] drives the boss health bar (HUD); g.cb.buff_at / heal_at are the Twin auras (15 m radius).
   * g.swing / g.cb.swing_len drive the weapon swing / recoil pose (guns set swing 0.12); g.cb.reload_t > 0 = reloading.
   * Zombie scale per kind: scale(kind) (Hulk 1.5, Brute 2.0, Birther 1.7, Sweaty 2.2, Baby 0.55, Twins 1.2, else 1).
   * Boss pose inputs on Zombie: act (0 idle, 1 ground slam wind-up 2.0 s, 2 car throw wind-up 2.33 s), act_t (seconds left),
     aim (throw target / Sweaty landing point), air (Sweaty seconds airborne, 5 s leap; body should be drawn in the air while
     air > 0 and the landing ring at aim), burn > 0 (on fire).
 PORT GAPS: `impl ZKind { boss, scale, label }` are exported as boss(k)/scale(k)/label(k); ZKind::stats is called through
   zstats() which accepts game.ZKind.stats(k), game.zkind_stats(k) or game.stats(k). Rust fns `throw` and `export` are named
   `throw_` and `export_`. Wpn (plain data) is an object literal {item, dur, clip}. Rust f32 arithmetic is f64 here.
*/
export { export_ as export };
