// Port of src/staff.rs (transliterated; see three/PORT-CONTRACT.md).
//! Nhân viên và Job Board (cờ `staff`). Luật theo `~/twt-bevy/docs/rules/staff.md`:
//! - Ứng viên: mỗi giờ game, từ ngày 3, khi chưa đủ người (1 + nút kỹ năng, tối đa 9) và chưa quá 2 (+3 với nút) lượt/ngày,
//!   xác suất `max(0,05; (uy tín chuẩn hoá + 1) x 0,33)`; chọn đều 1 trong 6 mẫu; cấp bốn nghề và lương theo mẫu.
//!   Ứng viên đi theo người chơi, bỏ đi sau 3 giờ hoặc từ 19:00; hết ngày thì mất.
//! - Thuê không tốn pin. Giao việc mới tốn `ceil(hệ số kỹ năng x (lương + phí việc))`: Service 20, Security 40, Cleaner 25,
//!   Home 0; đổi sang đúng loại việc đang làm thì không tốn. Sang ngày mọi việc trong quán kết thúc, phải giao lại; việc
//!   Combat ngoài bản đồ kéo qua ngày. Service, Security, Cleaner phải mở bằng nút kỹ năng Management (UnlockJobType).
//! - Service: đứng sau quầy, khách sẵn sàng thì cân nhắc 1,5 s + xử lý 1,5 s rồi bán, +1 XP nghề mỗi lần.
//! - Security: đứng gác sau cửa, đánh zombie trong tầm; +0,5 XP mỗi giờ, `max(0,5; sát thương x 0,0125)` XP mỗi đòn.
//! - Cleaner: dọn xác khi cấp nghề >= 3 (vứt), >= 4 và máy nghiền đã sửa thì nghiền lấy thịt; +0,1 XP mỗi lần.
//! - XP nghề cộng dồn; lên cấp 2 / 3 / 4 / 5 ở 100 / 250 / 500 / 1000 XP. Máu 200, sáng ra hồi đầy; zombie đánh được nhân viên,
//!   hết máu thì chết và mất khỏi danh sách.
//! `[ĐỀ XUẤT]` và chưa có: sát thương bảo vệ 25 mỗi giây x hệ số (bản gốc dùng vũ khí đang cầm); tinh thần (lương / rượu),
//! mặc cả của Service cấp 2, chỉnh lương, nhắc lại việc hôm qua, ô đồ của nhân viên.
//! Súng cho nhân viên: trên Job Board phím [G] trao khẩu súng đang cầm cho nhân viên đang chọn (một khẩu mỗi người), bấm lại
//! thì lấy về. Luật gốc (`D:/walking-trade-ref/il2csharp-out/Runtime/Runtime`):
//! - `StaffMobObject.TryEquip...`: từ chối súng có `CanMobsEquip` = 0 (Makeshift Bow) và súng có độ hiếm >= `WeaponRarityCap`
//!   (mặc định 3, nút kỹ năng "Weapon Rarity Unlock" +3): ngày đầu nhân viên chỉ cầm được súng hiếm 0-2.
//! - `MobWeaponHandler.StartVirtualReload / TickReload`: nạp "ảo", hết `ReloadTime` thì băng đầy `ClipSize`, không trừ đạn trong
//!   kho người chơi. Không có độ bền trong `MobWeaponHandler` / `MobInventory` (giữ `BaseWeaponData`, không giữ món có độ bền),
//!   nên súng nhân viên không mòn.
//! - `StaffMobObject.CalculateCombatPower`: sức đánh = hệ số x (BaseCombatPower + tổng `CombatProficiency` vũ khí + vũ khí mạnh
//!   nhất x 0,01) x 100; `CombatBarrierOverworldLandmark` dùng max(1, sức đánh / 100) cho chuyến Combat (`map.trip_minute`).
//! - Chết: `OnDied` dựng ragdoll mang `MobInventory.GetLootEntries()` (súng lục được từ xác); ở đây súng rơi ra đất cạnh chỗ chết.
//!   Bản gốc không có việc nhân viên tự nhặt vũ khí trên sàn (chỉ PickUpAmmo cho tháp súng), nên ở đây cũng không.
//! `[ĐỀ XUẤT]` (gốc chạy theo `MobWeaponHandler` + AI tầm nhìn riêng): đứng trong tầm bắn (tối đa 14 m), giương ~0,25 s, bắn theo
//! nhịp súng (chậm nhất 0,3 s / phát), trúng 55 % + 8 % mỗi cấp Security.

import { Vec3, v3, Y, trunc, clamp } from './vec.js';
import * as actors from './actors.js';
import * as game from './game.js';
import * as lay from './lay.js';
import * as world from './world.js';
import * as skills from './skills.js';
import * as data from './data.js';
import * as map from './map.js';
import * as build from './build.js';
import * as fx from './fx.js';
import * as scene from './scene.js';
import * as items from './items.js';
import * as guns from './guns.js';
import * as combat from './combat.js';
import * as fp from './fp.js';

export const JOB_NONE = 0;
export const JOB_HOME = 1;
export const JOB_SERVICE = 2;
export const JOB_SECURITY = 3;
export const JOB_CLEANER = 4;
/// Việc ngoài bản đồ (src/map.rs): nhân viên đi vắng tới sáng hôm sau.
export const JOB_SCAVENGE = 5;
export const JOB_COMBAT = 6;
export const JOB_SHOP = 7;
export const JOB_NAMES = ['Waiting for a job', 'Home', 'Service', 'Security', 'Cleaner', 'Scavenging', 'Fighting a horde', 'Shopping'];
export const JOB_COST = [0, 0, 20, 40, 25, 0, 0, 0];
export const STAFF_HP = 200.0;
const LEVEL_XP = [100.0, 250.0, 500.0, 1000.0];

export function max_staff(g) {
  return 1 + trunc(skills.sum(g, 'MaximumStaffCount'));
}

/// Tiền giao việc: `ceil(hệ số kỹ năng x gốc)`.
export function job_cost(g, base) {
  const m = skills.mul(g, 'StaffCostMultiplier');
  return trunc(Math.ceil(base * (m > 0.0 ? m : 1.0)));
}

/// Loại việc (mã của bản gốc) phải mở bằng nút kỹ năng: Service 2, Security 3, Cleaner 8.
export function job_type(job) {
  switch (job) {
    case JOB_SERVICE: return 2;
    case JOB_SECURITY: return 3;
    case JOB_CLEANER: return 8;
    default: return 0;
  }
}

/// Cộng XP cho một nghề (0 Scavenger, 1 Security, 2 Service, 3 Cleaner); đủ mốc thì lên cấp (tối đa 5).
export function role_xp(s, role, xp) {
  s.rxp[role] += xp;
  s.xp += xp;
  let up = false;
  while (s.levels[role] < 5 && s.rxp[role] >= LEVEL_XP[s.levels[role] - 1]) {
    s.levels[role] += 1;
    up = true;
  }
  return up;
}
export const NAMES = ['Ava', 'Ben', 'Cleo', 'Dan', 'Eli', 'Fay', 'Gus', 'Hana'];
/// (lương mỗi cấp, cộng thêm, lương tối thiểu, cấp tối đa mỗi nghề, tổng cấp nhỏ nhất, lớn nhất)
export const TEMPLATES = [[2, 2, 5, 2, 5, 6], [2, 0, 5, 2, 5, 6], [2, 0, 5, 3, 6, 8], [1, 0, 5, 2, 5, 6], [2, 0, 5, 3, 6, 8], [3, 0, 15, 3, 7, 10]];

export class Staff {
  constructor(o = {}) {
    this.body = o.body !== undefined ? o.body : null;
    this.seed = o.seed || 0;
    this.name = o.name || '';
    /// Cấp nghề: Scavenger, Security, Service, FloorWorker (1..5).
    this.levels = o.levels || [1, 1, 1, 1];
    this.wage = o.wage || 0;
    this.hired = !!o.hired;
    this.job = o.job || 0;
    this.pos = o.pos ? o.pos.clone() : new Vec3();
    this.yaw = o.yaw || 0;
    this.path = o.path || [];
    this.moving = !!o.moving;
    this.phase = o.phase || 0;
    this.timer = o.timer || 0;
    this.hours = o.hours || 0;
    this.xp = o.xp || 0;
    /// Đang ở ngoài (việc Home) hoặc đã bỏ đi.
    this.away = !!o.away;
    this.gone = !!o.gone;
    this.swing = o.swing || 0;
    /// Landmark đang tới (việc Scavenge / Combat / Shop), số phút game còn phải đi, hàng mang về.
    this.dest = o.dest || 0;
    this.trip = o.trip || 0;
    this.cargo = o.cargo || [];
    this.hp = o.hp !== undefined ? o.hp : 0;
    /// XP cộng dồn theo nghề.
    this.rxp = o.rxp || [0, 0, 0, 0];
    this.name_i = o.name_i || 0;
    /// Súng nhân viên đang mang: { item, clip, dur } | null; độ giương súng 0..1, số phát đã bắn (cho phần nhìn), giây nạp còn lại.
    this.gun = o.gun || null;
    this.aim = 0;
    this.shots = 0;
    this.reload = 0;
  }
}

/// `CombatProficiency` (= `CombatPower`) của súng trong các `*WeaponData.asset` gốc; `CanMobsEquip` = 0 ghi là null.
export const GUN_PROFICIENCY = {
  'AK-47': 6, 'Turret Minigun': 7, 'Bone Revolver': 4, 'Makeshift Bow': null, 'Crossbow': 3.2, 'Flamethrower': 8, 'Minigun': 7,
  'Modded NailGun': 4.2, 'Sidearm Pistol': 3, 'Missile Launcher': 10, 'Saw Launcher': 10, 'Pump-Action Shotgun': 5.5,
  'Sniper Rifle': 8, 'Uzi': 3.4,
};
export function gun_proficiency(item) {
  const v = GUN_PROFICIENCY[items.iname(item)];
  return v === undefined || v === null ? 0.0 : v;
}
/// Trần độ hiếm vũ khí của nhân viên (gốc `WeaponRarityCap` 3 + nút kỹ năng StaffWeaponRarityCap).
export function rarity_cap(g) {
  return 3 + trunc(skills.sum(g, 'StaffWeaponRarityCap'));
}
/// Lý do nhân viên không cầm được súng `item`, null nếu được.
export function staff_gun_refusal(g, item) {
  if (items.gun(item) === null) return 'not a gun';
  if (GUN_PROFICIENCY[items.iname(item)] === null) return 'cannot use';
  if (data.INFO[item].rarity >= rarity_cap(g)) return 'too rare';
  return null;
}
export function staff_gun_ok(item, g) {
  return g === undefined ? items.gun(item) !== null && GUN_PROFICIENCY[items.iname(item)] !== null : staff_gun_refusal(g, item) === null;
}

/// Kiểu cầm cho phần nhìn: 'pistol' (súng ngắn, súng lục) hay 'rifle' (súng dài).
export function gun_pose(item) {
  const c = guns.class(item);
  return c === 'Pistol' || c === 'Revolver' || c === 'Nail' ? 'pistol' : 'rifle';
}

/// [G] trên Job Board: trao súng đang cầm cho nhân viên đang chọn, hoặc lấy lại súng của người đó.
export function give_gun(g) {
  const i = selected(g);
  if (i === null) {
    g.say('You have no staff.');
    return;
  }
  const s = g.staff[i];
  if (s.gun !== null) {
    g.weapons.push({ item: s.gun.item, dur: s.gun.dur, clip: s.gun.clip });
    g.say(`You take the ${items.iname(s.gun.item)} back from ${s.name}.`);
    s.gun = null;
    s.reload = 0;
    g.play('click', 0.5);
    return;
  }
  const w = g.wsel < g.weapons.length ? g.weapons[g.wsel] : null;
  if (w === null || items.gun(w.item) === null) {
    g.play('deny', 0.4);
    g.say('Hold a gun [3] to hand it over.');
    return;
  }
  const why = staff_gun_refusal(g, w.item);
  if (why !== null) {
    g.play('deny', 0.4);
    g.say(why === 'too rare' ? `The ${items.iname(w.item)} is too rare for staff (unlock Weapon Rarity in the skills).` : `${s.name} cannot use the ${items.iname(w.item)}.`);
    return;
  }
  s.gun = { item: w.item, clip: w.clip, dur: w.dur };
  g.weapons.splice(g.wsel, 1);
  g.wsel = 0;
  g.armed = false;
  g.cb.reload_t = 0.0;
  g.play('reload', 0.5);
  g.say(`${s.name} now carries the ${items.iname(s.gun.item)}.${s.job === JOB_SECURITY ? '' : ' Give them the Security job to guard the door.'}`);
}

/// Đầu nòng súng của nhân viên (khớp dáng giương súng của robot, xấp xỉ).
export function muzzle(s) {
  const f = v3(-Math.sin(s.yaw), 0.0, -Math.cos(s.yaw));
  const r = v3(-f.z, 0.0, f.x);
  const pistol = s.gun !== null && gun_pose(s.gun.item) === 'pistol';
  return s.pos.add(Y.mul(pistol ? 1.3 : 1.36)).add(f.mul(pistol ? 0.62 : 0.8)).add(r.mul(-0.04));
}

/// Một phát của bảo vệ có súng vào zombie `zi` (đứng ở `zp`).
function staff_shoot(g, s, zi, zp, dmg_mul) {
  const [gw, gd] = items.gun(s.gun.item);
  const f = v3(-Math.sin(s.yaw), 0.0, -Math.cos(s.yaw));
  const r = v3(-f.z, 0.0, f.x);
  const m = muzzle(s);
  const z = g.zombies[zi];
  const at = zp.add(Y.mul(1.1 * combat.scale(z.kind)));
  s.gun.clip = Math.max(s.gun.clip - 1, 0);
  s.shots += 1;
  const dmul = (1.0 + 0.1 * (s.levels[1] - 1.0)) * dmg_mul;
  if (gd.clip === 0) {
    // súng phun lửa: đốt zombie đang nhắm (như người chơi: sát thương x nhịp, cháy 5 s)
    if (s.shots % 3 === 1) g.play('flame', 0.4);
    z.hp -= gw.dmg * Math.max(gw.cd, 0.3) * dmul;
    z.burn = 5.0;
    z.chasing = true;
    g.fxq.push([fx.FX_SPARK, m.add(at.sub(m).normalize_or_zero().mul(1.5))]);
    return;
  }
  if (gd.ammo === 78) {
    // tên lửa bay thật (fp.rocket), nổ khi chạm
    g.play('shot', 0.5);
    fp.rocket(g, s.gun.item, m, at.sub(m).normalize_or_zero(), gw.dmg * dmul);
    return;
  }
  const hit = g.rng.chance(clamp(0.55 + 0.08 * (s.levels[1] - 1.0), 0.0, 0.95));
  g.play('shot', 0.45);
  const np = Math.max(gd.pellets, 1);
  let end;
  // vật dựng chắn giữa nòng và zombie: đạn dừng ở đó (combat.ray_built), như đạn người chơi
  const aim = at.sub(m), alen = aim.length();
  const bh = combat.ray_built(g, m, aim.normalize_or_zero(), alen);
  if (bh !== null) {
    end = [m.add(aim.normalize_or_zero().mul(bh[0])), combat.built_fx(g, bh[1]), false];
    const t = fp.Tracer(m, end[0].clone(), 0.0, Math.max(bh[0], 0.5) / 300.0, 0, end[1], false);
    t.built = true;
    g.fx2.tracers.push(t);
    return;
  }
  if (hit) {
    const dmg = gw.dmg * np * dmul;
    combat.hit_zombie(g, zi, dmg, false, gw.stun, gw.knock * 0.5, at.sub(m));
    role_xp(s, 1, Math.max(dmg * 0.0125, 0.5));
    end = [at, null, false];
  } else {
    // Trượt: lệch quanh mục tiêu, viên đạn bay tới tường / đất phía sau.
    const d = at.add(r.mul(g.rng.range(-0.7, 0.7))).add(Y.mul(g.rng.range(-0.5, 0.4))).sub(m).normalize_or_zero();
    const rw = fp.ray_world(g, m, d, 40.0);
    end = rw !== null ? [m.add(d.mul(rw[0])), rw[1] === 0 ? fx.FX_DUST : fx.FX_SPARK, rw[1] === 0] : [m.add(d.mul(40.0)), null, false];
  }
  const dist = Math.max(end[0].distance(m), 0.5);
  g.fx2.tracers.push(fp.Tracer(m, end[0].clone(), 0.0, dist / 300.0, 0, end[1], end[2]));
}

export function post(job) {
  switch (job) {
    case JOB_SERVICE: return lay.TILL_STAND.add(v3(-0.95, 0.0, 0.0));
    case JOB_SECURITY: return lay.DOOR_IN.add(v3(1.7, 0.0, -0.9));
    default: return lay.DOOR_IN.add(v3(-1.9, 0.0, -1.1));
  }
}

/// Đường đi tới chỗ làm: vòng qua đầu quầy khi vào hoặc ra khu sau quầy.
export function route(from, job) {
  const side = lay.COUNTER_SIDE_X;
  const a = v3(side, 0.0, lay.COUNTER_FRONT_Z);
  const b = v3(side, 0.0, lay.COUNTER_BACK_Z - 0.3);
  const behind_now = from.z < lay.COUNTER_SPLIT_Z;
  const behind_then = job === JOB_SERVICE;
  const p = [];
  if (behind_now !== behind_then) {
    if (behind_then) {
      p.push(a, b);
    } else {
      p.push(b, a);
    }
  }
  if (job === JOB_HOME || job >= JOB_SCAVENGE) {
    p.push(lay.DOOR_IN.clone(), lay.DOOR_OUT.clone(), lay.DOOR_OUT.add(v3(0.0, 0.0, 9.0)));
  } else {
    p.push(post(job));
  }
  return p;
}

export function new_candidate(g) {
  const t = TEMPLATES[clamp(g.rng.int(0, 5), 0, 5)];
  let levels = [1, 1, 1, 1];
  let extra = g.rng.int(t[4], t[5]) - 4;
  let guard = 0;
  while (extra > 0 && guard < 200) {
    guard += 1;
    const i = clamp(g.rng.int(0, 3), 0, 3);
    if (levels[i] < t[3]) {
      levels[i] += 1;
      extra -= 1;
    } else if (levels.every((l) => l >= t[3])) {
      break;
    }
  }
  // g.force_levels.take()
  const fl = g.force_levels;
  g.force_levels = null;
  if (fl !== null && fl !== undefined) {
    levels = fl.slice();
  }
  const total = levels.reduce((a, l) => a + l, 0);
  const base = t[0] * total + t[1];
  const wv = base * (1.0 + g.rng.range(-0.1, 0.1));
  const wage = Math.max(trunc(Math.sign(wv) * Math.round(Math.abs(wv))), t[2]);
  const spawn = lay.GATES[0][1];
  const name_i = clamp(g.rng.int(0, 7), 0, 7);
  const rxp = [0, 1, 2, 3].map((k) => (levels[k] >= 2 ? LEVEL_XP[levels[k] - 2] : 0.0));
  return new Staff({
    body: null,
    seed: (g.rng.s ^ 0x5747aff0) >>> 0,
    name: NAMES[name_i],
    levels,
    wage,
    hired: false,
    job: JOB_NONE,
    pos: spawn.clone(),
    yaw: 0.0,
    path: [lay.DOOR_OUT.clone(), lay.DOOR_IN.clone()],
    moving: false,
    phase: 0.0,
    timer: 0.0,
    hours: 0,
    xp: 0.0,
    away: false,
    gone: false,
    swing: 0.0,
    dest: 0,
    trip: 0.0,
    cargo: [],
    hp: STAFF_HP,
    rxp,
    name_i,
  });
}

/// Ứng viên (chưa thuê) đang đứng trong tầm 3 m.
export function candidate_near(g) {
  const i = g.staff.findIndex((s) => !s.hired && !s.gone && s.pos.distance(g.player) < 3.0);
  return i < 0 ? null : i;
}

export function hire(g, i) {
  if (g.staff.filter((s) => s.hired && !s.gone).length >= max_staff(g)) {
    g.play('deny', 0.5);
    g.say('You cannot manage more staff yet.');
    return;
  }
  g.staff[i].hired = true;
  g.staff[i].path = [post(JOB_NONE)];
  const total = g.staff[i].levels.reduce((a, l) => a + l, 0);
  // Luật gốc: thuê người được XP Management = tổng cấp x 3.
  g.add_xp(1, total * 3);
  g.play('quest', 0.5);
  g.say(`${g.staff[i].name} hired. Open the Job Board [J] to assign work.`);
}

export function dismiss(g, i) {
  g.staff[i].path = [lay.DOOR_IN.clone(), lay.DOOR_OUT.clone(), lay.DOOR_OUT.add(v3(0.0, 0.0, 9.0))];
  g.staff[i].job = JOB_HOME;
  g.staff[i].timer = -1.0;
  g.play('deny', 0.4);
  g.say(`You send ${g.staff[i].name} away.`);
}

/// Chỉ số (trong `g.staff`) của nhân viên đã thuê đang chọn trên Job Board.
export function selected(g) {
  const hired = [];
  for (let i = 0; i < g.staff.length; i++) if (g.staff[i].hired && !g.staff[i].gone) hired.push(i);
  const k = Math.min(g.staff_sel, Math.max(0, hired.length - 1));
  return k < hired.length ? hired[k] : null;
}

/// Giao việc cho nhân viên đang chọn; trả `ceil(hệ số x (lương + phí việc))` trừ khi đổi sang đúng loại việc đang làm.
export function assign(g, job) {
  const i = selected(g);
  if (i === null) {
    g.say('You have no staff. Candidates come by from day 3.');
    return;
  }
  if (g.staff[i].job === job) {
    return;
  }
  if (g.staff[i].job >= JOB_SCAVENGE) {
    g.play('deny', 0.5);
    g.say(`${g.staff[i].name} is out on the map.`);
    return;
  }
  const jt = job_type(job);
  if (jt !== 0 && !skills.job_unlocked(g, jt)) {
    g.play('deny', 0.5);
    g.say(`${JOB_NAMES[job]} jobs are locked. Unlock the job in the Management skill tree [K].`);
    return;
  }
  const cost = JOB_COST[job] === 0 ? 0 : job_cost(g, g.staff[i].wage + JOB_COST[job]);
  if (cost > g.batteries) {
    g.play('deny', 0.5);
    g.say(`Not enough batteries: ${g.staff[i].name} needs ${cost} for this job.`);
    return;
  }
  g.batteries -= cost;
  g.stats.outgoings += cost;
  const from = g.staff[i].pos;
  const s = g.staff[i];
  s.job = job;
  s.away = false;
  s.timer = 0.0;
  s.path = route(from, job);
  g.play('pay', 0.5);
  g.say(`${g.staff[i].name}: ${JOB_NAMES[job]} (${cost} batteries).`);
}

/// Cho nhân viên `i` đi việc ngoài bản đồ tới landmark `lm`, đi `trip` phút game, mang theo danh sách hàng phải mua.
export function send_out(g, i, job, lm, trip, cargo) {
  const from = g.staff[i].pos;
  const s = g.staff[i];
  s.job = job;
  s.dest = lm;
  s.trip = trip;
  s.cargo = cargo;
  s.timer = 0.0;
  s.path = route(from, job);
}

export function panel_text(g) {
  let out = `JOB BOARD        staff ${g.staff.filter((s) => s.hired && !s.gone).length}/${max_staff(g)}\n\n`;
  const hired = g.staff.filter((s) => s.hired && !s.gone);
  if (hired.length === 0) {
    out += 'No staff yet. From day 3 candidates walk in and follow you:\nlook for the [H] Hire prompt.\n';
  }
  const sel = Math.min(g.staff_sel, Math.max(0, hired.length - 1));
  const stars = (n) => '*'.repeat(n);
  hired.forEach((s, k) => {
    out += `${k === sel ? '>' : ' '} ${s.name.padEnd(5)} wage ${String(s.wage).padStart(2)}  HP ${Math.max(s.hp, 0.0).toFixed(0).padStart(3)}  Scavenger ${stars(s.levels[0]).padEnd(5)} Security ${stars(s.levels[1]).padEnd(5)} Service ${stars(s.levels[2]).padEnd(5)} Cleaner ${stars(s.levels[3]).padEnd(5)}  ${s.job >= JOB_SCAVENGE ? `${JOB_NAMES[s.job]} at ${map.LANDMARKS[s.dest].name}` : JOB_NAMES[s.job]}${s.gun !== null ? `  [${items.iname(s.gun.item)}]` : ''}\n`;
  });
  if (sel < hired.length) {
    const s = hired[sel];
    const lock = (jt) => (skills.job_unlocked(g, jt) ? '' : '  LOCKED (Management skill)');
    out += `\n[1] Home (free)\n[2] Service: serves customers at the till (${job_cost(g, s.wage + JOB_COST[2])} Batteries)${lock(2)}\n[3] Security: guards the door (${job_cost(g, s.wage + JOB_COST[3])} Batteries)${lock(3)}\n[4] Cleaner: disposes of corpses, needs Cleaner *** (${job_cost(g, s.wage + JOB_COST[4])} Batteries)${lock(8)}\n[X] Dismiss ${s.name}\n[G] ${s.gun !== null ? `Take back the ${items.iname(s.gun.item)}` : 'Hand over the gun you hold (Security shoots with it)'}\n`;
  }
  out += '\nScavenge, shop and combat trips are assigned on the World Map [M].\nJobs end every morning and must be assigned (and paid) again.\n[W / S] select staff   [E]  close';
  return out;
}

/// Sa thải nhân viên đang chọn.
export function fire(g) {
  const i = selected(g);
  if (i !== null) {
    if (g.staff[i].job < JOB_SCAVENGE) {
      dismiss(g, i);
      g.staff[i].hired = false;
    }
  }
}

// actors::walk / turn / yaw_to (pub(crate) in actors.rs; Rust passes &mut pos, &mut yaw, &mut path which JS cannot):
// local copy with the same maths, mutating the staff record. See PORT GAPS.
function yaw_to(d) {
  return Math.atan2(-d.x, -d.z);
}
function turn(cur, goal, max) {
  let d = (goal - cur) % (Math.PI * 2);
  if (d > Math.PI) {
    d -= Math.PI * 2;
  }
  if (d < -Math.PI) {
    d += Math.PI * 2;
  }
  return cur + clamp(d, -max, max);
}
function walk(s, speed, dt) {
  if (s.path.length === 0) return false;
  const t = s.path[0];
  const d = t.sub(s.pos);
  const dist = d.length();
  if (dist < 0.12) {
    s.path.shift();
    return s.path.length !== 0;
  }
  const dir = d.div(dist);
  s.pos = s.pos.add(dir.mul(Math.min(speed * dt, dist)));
  s.yaw = turn(s.yaw, yaw_to(dir), dt * 8.0);
  return true;
}

export function tick_staff(g, dt) {
  if ((g.ff & game.FF_STAFF) === 0) {
    return;
  }
  const hr = trunc(g.hour());
  // Sang ngày: việc kết thúc, ứng viên chưa thuê biến mất, nhân viên đứng chờ việc.
  if (g.staff_day !== g.day) {
    g.staff_day = g.day;
    g.approaches_today = 0;
    // Sang ngày: chuyến Scavenge / Shop chưa xong thì hoàn tất qua đêm; chuyến Combat đi tiếp; việc trong quán kết thúc.
    for (let i = 0; i < g.staff.length; i++) {
      if (g.staff[i].hired && !g.staff[i].gone && (g.staff[i].job === JOB_SCAVENGE || g.staff[i].job === JOB_SHOP)) {
        map.overnight(g, i);
      }
    }
    for (const s of g.staff) {
      if (!s.hired) {
        s.gone = true;
      } else if (s.job !== JOB_COMBAT) {
        s.job = JOB_NONE;
        s.away = false;
        s.pos = post(JOB_NONE);
        s.path.length = 0;
        s.hp = STAFF_HP;
      }
    }
  }
  if (hr !== g.staff_hour) {
    g.staff_hour = hr;
    // Ứng viên tới xin việc.
    const hired = g.staff.filter((s) => s.hired && !s.gone).length;
    const waiting = g.staff.some((s) => !s.hired && !s.gone);
    if ((g.day > 2 || g.force_staffer) && hired < max_staff(g) && !waiting && g.approaches_today < 2 + trunc(skills.sum(g, 'MaximumDailyStaffApproaches')) && hr >= 6 && hr < 19) {
      const p = ((g.rep + 100.0) / 200.0 + 1.0) * 0.33;
      if (g.force_staffer || g.rng.chance(Math.max(p, 0.05))) {
        g.force_staffer = false;
        g.approaches_today += 1;
        const c = new_candidate(g);
        g.say(`${c.name} is looking for work and walks up to the shop.`);
        g.staff.push(c);
      }
    }
    for (const s of g.staff) {
      if (!s.hired && !s.gone && s.timer >= 0.0) {
        s.hours += 1;
        if (hr >= 19 || s.hours >= 3) {
          s.path = [lay.DOOR_IN.clone(), lay.DOOR_OUT.clone(), lay.DOOR_OUT.add(v3(0.0, 0.0, 9.0))];
          s.job = JOB_HOME;
          s.timer = -1.0;
        }
      }
      if (s.hired && s.job === JOB_SECURITY) {
        role_xp(s, 1, 0.5);
      }
    }
  }
  // Mỗi phút game: nhân viên ngoài bản đồ đi tiếp chuyến của mình; xong thì về lại quán.
  const m = trunc(g.minutes);
  if (m !== g.staff_min) {
    const steps = clamp(m - g.staff_min, 1, 30);
    g.staff_min = m;
    for (let i = 0; i < g.staff.length; i++) {
      if (!(g.staff[i].hired && !g.staff[i].gone && g.staff[i].away && g.staff[i].job >= JOB_SCAVENGE)) {
        continue;
      }
      for (let k = 0; k < steps; k++) {
        if (g.staff[i].gone) {
          break;
        }
        if (map.trip_minute(g, i)) {
          const s = g.staff[i];
          const role = s.job === JOB_COMBAT ? 1 : 0;
          role_xp(s, role, 10.0);
          s.job = JOB_NONE;
          s.away = false;
          s.pos = lay.GATES[0][1].clone();
          s.path = [lay.DOOR_OUT.clone(), lay.DOOR_IN.clone(), post(JOB_NONE)];
          break;
        }
      }
    }
  }
  const sec_dmg = (() => { const m = skills.mul(g, 'SecurityStaffDamageMultiplier'); return m > 0.0 ? m : 1.0; })();
  const sec_see = (() => { const m = skills.mul(g, 'SecurityStaffDetectionMultiplier'); return m > 0.0 ? m : 1.0; })();
  const clean_speed = (() => { const m = skills.mul(g, 'CleanerStaffSpeedMultiplier'); return m > 0.0 ? m : 1.0; })();
  const can_shred = g.bld.tiers[build.T_SHREDDER] > 0;
  const player = g.player;
  // std::mem::take(&mut g.staff): trong vòng lặp g.staff rỗng (giữ nguyên như Rust).
  const staff = g.staff;
  g.staff = [];
  for (const s of staff) {
    if (s.gone || s.away) {
      continue;
    }
    if (s.hp <= 0.0 && s.hired) {
      s.gone = true;
      if (s.gun !== null) {
        g.add_prop(game.PropKind.Item(s.gun.item), v3(s.pos.x, 0.0, s.pos.z), s.yaw);
        g.props[g.props.length - 1].loose = true;
        s.gun = null;
      }
      g.play('death', 0.6);
      g.say(`${s.name} has been killed by the zombies.`);
      continue;
    }
    s.moving = false;
    s.swing = Math.max(s.swing - dt, 0.0);
    if (s.job !== JOB_SECURITY) {
      s.aim = 0.0;
    }
    if (s.path.length !== 0) {
      const sp = game.Game.in_shop(s.pos) ? 1.8 : 3.0;
      s.moving = walk(s, sp, dt);
      s.phase += dt * 8.0;
      if (s.path.length === 0 && (s.job === JOB_HOME || s.job >= JOB_SCAVENGE)) {
        if (s.hired) {
          s.away = true;
        } else {
          s.gone = true;
        }
      }
      continue;
    }
    if (!s.hired) {
      // Ứng viên đi theo người chơi.
      const d = v3(player.x - s.pos.x, 0.0, player.z - s.pos.z);
      if (d.length() > 1.9) {
        s.pos = world.resolve(g, s.pos.add(d.normalize().mul(1.5 * dt)), 0.3);
        s.moving = true;
        s.phase += dt * 8.0;
      }
      if (d.length() > 0.1) {
        s.yaw = Math.atan2(-d.x, -d.z);
      }
      continue;
    }
    switch (s.job) {
      case JOB_SERVICE: {
        s.yaw = 0.0;
        if (g.pay === null && actors.head_customer(g) !== null) {
          s.timer += dt;
          if (s.timer >= 3.0 && actors.staff_serve(g)) {
            s.timer = 0.0;
            role_xp(s, 2, 1.0);
            s.swing = 0.6;
          }
        } else {
          s.timer = 0.0;
        }
        break;
      }
      case JOB_SECURITY: {
        const reach = (9.0 + s.levels[1]) * sec_see;
        const home = post(JOB_SECURITY);
        let target = null;
        let best = Infinity;
        g.zombies.forEach((z, i) => {
          if (!z.dead && z.hp > 0.0 && z.pos.distance(home) < reach) {
            const dd = z.pos.distance(s.pos);
            if (target === null || dd < best) {
              best = dd;
              target = [i, z.pos.clone()];
            }
          }
        });
        const gg = s.gun !== null ? items.gun(s.gun.item) : null;
        if (gg !== null) {
          // Nạp đạn chạy cả khi không có mục tiêu (nạp lúc rảnh như người chơi).
          const [gw, gd] = gg;
          if (s.reload > 0.0) {
            s.reload -= dt;
            if (s.reload <= 0.0) {
              s.reload = 0.0;
              s.gun.clip = gd.clip;
            }
          } else if (gd.clip > 0 && (s.gun.clip <= 0 || (target === null && s.gun.clip < gd.clip))) {
            s.reload = gd.reload;
            g.play('reload', 0.35);
          }
          if (target !== null) {
            const [zi, zp] = target;
            const d = v3(zp.x - s.pos.x, 0.0, zp.z - s.pos.z);
            s.yaw = Math.atan2(-d.x, -d.z);
            const range = Math.min(gw.range, 14.0);
            const m = s.pos.add(Y.mul(1.35));
            const dd = zp.add(Y.mul(1.1)).sub(m);
            const rw = fp.ray_world(g, m, dd.normalize_or_zero(), dd.length());
            const blocked = rw !== null && rw[1] !== 0;
            if (d.length() > range || blocked) {
              s.aim = Math.max(s.aim - dt * 4.0, 0.0);
              s.pos = world.resolve(g, s.pos.add(d.normalize().mul(3.0 * dt)), 0.3);
              s.moving = true;
              s.phase += dt * 9.0;
            } else {
              s.aim = Math.min(s.aim + dt * 4.0, 1.0);
              s.timer += dt;
              if (s.reload <= 0.0 && (s.gun.clip > 0 || gd.clip === 0) && s.aim >= 0.95 && s.timer >= Math.max(gw.cd, 0.3) && (gd.clip > 0 || d.length() < 8.0)) {
                s.timer = 0.0;
                staff_shoot(g, s, zi, zp, sec_dmg);
              }
            }
          } else {
            s.aim = Math.max(s.aim - dt * 2.0, 0.0);
            if (s.pos.distance(home) > 0.4) {
              s.path = [home];
            } else {
              s.yaw = Math.PI;
            }
          }
          break;
        }
        if (target !== null) {
          const [zi, zp] = target;
          const d = v3(zp.x - s.pos.x, 0.0, zp.z - s.pos.z);
          s.yaw = Math.atan2(-d.x, -d.z);
          if (d.length() > 1.5) {
            s.pos = world.resolve(g, s.pos.add(d.normalize().mul(3.0 * dt)), 0.3);
            s.moving = true;
            s.phase += dt * 9.0;
          } else {
            s.timer += dt;
            if (s.timer >= 1.0) {
              s.timer = 0.0;
              s.swing = 0.45;
              const dmg = 25.0 * (1.0 + 0.1 * (s.levels[1] - 1.0)) * sec_dmg;
              g.zombies[zi].hp -= dmg;
              g.zombies[zi].stagger = 0.5;
              g.fxq.push([fx.FX_BLOOD, zp.add(Y.mul(1.2))]);
              g.play('hit', 0.5);
              role_xp(s, 1, Math.max(dmg * 0.0125, 0.5));
            }
          }
        } else if (s.pos.distance(home) > 0.4) {
          s.path = [home];
        } else {
          s.yaw = Math.PI;
        }
        break;
      }
      case JOB_CLEANER: {
        if (s.levels[3] >= 3) {
          let corpse = null;
          let best = Infinity;
          for (const p of g.props) {
            if (!p.dead && p.kind.k === 'Corpse') {
              const dd = p.pos.distance(s.pos);
              if (corpse === null || dd < best) {
                best = dd;
                corpse = [p.id, p.pos.clone()];
              }
            }
          }
          if (corpse !== null) {
            const [id, cp] = corpse;
            const d = v3(cp.x - s.pos.x, 0.0, cp.z - s.pos.z);
            if (d.length() > 1.2) {
              // Phiên 9: đi theo đường qua cửa (actors.route) thay vì đường thẳng: xác ở ngoài, lao công trong quán thì đường thẳng
              // dính tường quán và kẹt mãi (bot staff 1 / 3 lượt hết giờ chờ dọn xác). Bản gốc đi bằng NavMesh.
              const wp = actors.route(s.pos, cp);
              const dw = v3(wp.x - s.pos.x, 0.0, wp.z - s.pos.z);
              const dir = dw.length() > 0.05 ? dw.normalize() : d.normalize();
              const np = s.pos.add(dir.mul(Math.min(2.5 * clean_speed * dt, Math.max(dw.length(), 0.01))));
              // Đang qua cửa (điểm kế tiếp khác xác): đi như mọi nhân viên theo đường (walk, không va chạm) để cửa trước đóng
              // không chặn; cùng vùng với xác thì vẫn tránh vật cản.
              const in_door = Math.abs(np.x - lay.DOOR_OUT.x) < 0.9 && np.z > lay.DOOR_IN.z - 0.5 && np.z < lay.DOOR_OUT.z + 0.3;
              s.pos = wp === cp && !in_door ? world.resolve(g, np, 0.3) : np;
              s.yaw = Math.atan2(-d.x, -d.z);
              s.moving = true;
              s.phase += dt * 8.0;
            } else {
              s.timer += dt;
              if (s.timer >= 2.5) {
                s.timer = 0.0;
                const pk = g.prop(id);
                const hulk = pk !== null && pk.kind.k === 'Corpse' && pk.kind.a === 2;
                {
                  const p = g.prop(id);
                  if (p !== null) {
                    p.dead = true;
                  }
                }
                // Cấp nghề >= 4 và máy nghiền đã sửa: nghiền lấy thịt và xương; không thì vứt.
                if (s.levels[3] >= 4 && can_shred) {
                  g.inv[game.MEAT] += hulk ? 50 : 10;
                  g.inv[game.BONE] += hulk ? 5 : 2;
                }
                g.play('trash', 0.5);
                role_xp(s, 3, 0.1);
              }
            }
          }
        }
        break;
      }
      default: {
        const d = v3(player.x - s.pos.x, 0.0, player.z - s.pos.z);
        if (d.length() > 0.1) {
          s.yaw = Math.atan2(-d.x, -d.z);
        }
      }
    }
  }
  staff.push(...g.staff);
  g.staff = staff;
}

/// Dựng và đặt hình nhân viên / ứng viên.
export function sync_staff(g, dt, ctx) {
  let k = 0;
  while (k < g.staff.length) {
    if (g.staff[k].gone) {
      const b = g.staff[k].body;
      g.staff[k].body = null;
      if (b !== null) {
        b.despawn();
      }
      g.staff.splice(k, 1);
      continue;
    }
    const s = g.staff[k];
    // Súng là một phần của hình robot, nên đổi kiểu súng (không / ngắn / dài) thì dựng lại thân.
    const gk = s.gun !== null && s.hired ? gun_pose(s.gun.item) : null;
    if (s.body !== null && s.body_gun !== gk) {
      s.body.despawn();
      s.body = null;
    }
    if (s.body === null) {
      s.body = scene.people.spawn(s.seed, null, s.pos, { role: 'staff', hired: s.hired, gun: gk });
      s.body_gun = gk;
    } else {
      const sw = s.moving ? Math.sin(s.phase) * 0.55 : 0.0;
      const bob = s.moving ? Math.abs(Math.sin(s.phase * 2.0)) * 0.03 : 0.0;
      const hit = clamp(s.swing / 0.45, 0.0, 1.0);
      const arm_r = hit > 0.0 ? 0.4 + Math.sin(hit * Math.PI) * 1.6 : sw;
      // Thứ tự khớp như Body.parts của Rust: [thân, đầu, chân trái, tay phải, tay trái(?), chân phải] -> góc quay quanh X.
      const rots = [hit * 0.12, 0.0, -sw, arm_r, sw, -sw];
      s.body.update({
        pos: s.pos.add(Y.mul(bob)),
        yaw: s.yaw,
        visible: !s.away,
        moving: s.moving,
        phase: s.phase,
        swing: s.swing,
        hit,
        arm_r,
        rots,
        job: s.job,
        hired: s.hired,
        hide_extra: true,
        gun: gk,
        aim: s.aim,
        shots: s.shots,
        reload: s.reload > 0.0 && s.gun !== null ? clamp(1.0 - s.reload / items.gun(s.gun.item)[1].reload, 0.0, 1.0) : 0.0,
      });
    }
    k += 1;
  }
}

/// Trạng thái cho bot: [x, z, đã thuê, việc, lương, đang ở ngoài, XP].
export function export_(g) {
  return g.staff
    .filter((s) => !s.gone)
    .map((s) => `[${s.pos.x.toFixed(2)},${s.pos.z.toFixed(2)},${s.hired ? 1 : 0},${s.job},${s.wage},${s.away ? 1 : 0},${s.xp.toFixed(1)},${s.hp.toFixed(0)},${s.dest},${s.trip.toFixed(0)},[${s.levels[0]},${s.levels[1]},${s.levels[2]},${s.levels[3]}],${s.gun !== null ? s.gun.item : -1},${s.gun !== null ? s.gun.clip : 0}]`)
    .join(',');
}
// `export` is a reserved word in JS: exported under the Rust name through an alias.
export { export_ as export };

export function save(g) {
  return g.staff
    .filter((s) => s.hired && !s.gone)
    .map((s) => `${s.name_i}.${s.levels[0]}.${s.levels[1]}.${s.levels[2]}.${s.levels[3]}.${s.wage}.${s.job === JOB_COMBAT ? 1 : 0}.${s.dest}.${trunc(s.trip)}.${trunc(s.hp)}.${trunc(s.rxp[0])}.${trunc(s.rxp[1])}.${trunc(s.rxp[2])}.${trunc(s.rxp[3])}.${s.seed}.${trunc(s.xp)}.${s.gun !== null ? s.gun.item : -1}.${s.gun !== null ? s.gun.clip : 0}.${s.gun !== null ? trunc(s.gun.dur) : 0}`)
    .join(',');
}

// Rust `str::parse::<i64>()`: optional sign then ASCII digits only; anything else is dropped by filter_map.
function parse_i64(v) {
  return /^[+-]?[0-9]+$/.test(v) ? Number(v) : null;
}
// Rust `i64 as usize` then `.min(cap)`: negatives wrap to huge numbers, so they clamp to cap.
function usize_min(v, cap) {
  return v < 0 ? cap : Math.min(v, cap);
}

export function load(g, s) {
  g.staff.length = 0;
  for (const rec of s.split(',').filter((r) => r.length !== 0)) {
    const n = rec.split('.').map(parse_i64).filter((v) => v !== null);
    if (n.length < 16) {
      continue;
    }
    const combat = n[6] !== 0;
    g.staff.push(new Staff({
      body: null,
      seed: n[14] >>> 0,
      name: NAMES[usize_min(n[0], 7)],
      levels: [n[1] & 255, n[2] & 255, n[3] & 255, n[4] & 255],
      wage: n[5] | 0,
      hired: true,
      job: combat ? JOB_COMBAT : JOB_NONE,
      pos: post(JOB_NONE),
      yaw: 0.0,
      path: [],
      moving: false,
      phase: 0.0,
      timer: 0.0,
      hours: 0,
      xp: n[15],
      away: combat,
      gone: false,
      swing: 0.0,
      dest: usize_min(n[7], map.N_LM - 1),
      trip: n[8],
      cargo: [],
      hp: combat ? n[9] : STAFF_HP,
      rxp: [n[10], n[11], n[12], n[13]],
      name_i: usize_min(n[0], 7),
      gun: n.length >= 19 && n[16] >= 0 && staff_gun_ok(n[16]) ? { item: n[16], clip: Math.max(n[17], 0), dur: n[18] } : null,
    }));
  }
  g.staff_day = g.day;
}

/* VIEW NOTES (staff.js)
Staff and candidates are living humans built by the people kit:
  spawn: scene.people.spawn(s.seed, null, s.pos, { role: 'staff', hired })  (once, the first sync after the record appears;
  no update is sent on the spawn frame, as in Rust). Despawned (person.despawn()) and removed from g.staff when s.gone.
  Rust spawned via actors::spawn_body(seed, None, pos) = the same body as a customer of that seed; the body's `extra`
  part (held prop / accessory) was always hidden for staff -> desc.hide_extra = true.
person.update(desc) every frame:
  pos     Vec3  feet position incl. walk bob: s.pos + Y * (moving ? |sin(phase*2)|*0.03 : 0)  (metres)
  yaw     rad   facing; model forward is -Z rotated by yaw (yaw = atan2(-dx,-dz) toward the target)
  visible bool  false while s.away (Home job, or out on the World Map)
  moving  bool  walking this frame; phase (rad) advances 8/s walking, 9/s when a guard runs at a zombie
  swing   s     attack/serve timer: 0.45 after a guard's hit, 0.6 after a Service sale, decays 1/s
  hit     0..1  clamp(swing/0.45): guard strike amount
  arm_r   rad   right-arm X rotation: hit>0 ? 0.4 + sin(hit*PI)*1.6 : sw   (sw = moving ? sin(phase)*0.55 : 0)
  rots    [6]   exact X-rotations Rust put on Body.parts in order: [torso hit*0.12, head 0, leg -sw, right arm arm_r,
                other arm sw, other leg -sw]  (part order of people.rs spawn_body)
  job, hired    for optional dress/labels (JOB_NAMES index; candidates hired=false follow the player)
PORT GAPS: actors::walk takes &mut pos/&mut yaw/&mut path in Rust, which JS cannot express; staff.js carries a private
  copy of walk/turn/yaw_to (identical maths) instead of calling actors.walk. `pub fn export` is exported as `export`
  through an alias (`export_` internally) because `export` is a reserved word.
Rust oddities ported as is: the Cleaner computes `hulk` from g.prop(id) which ignores dead props (fine); rounding of the
  wage uses Rust half-away-from-zero.
*/
