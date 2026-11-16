// Port of src/fp.rs.
//! Góc nhìn thứ nhất và cảm giác bắn: hai cánh tay thật (tay áo, cổ tay, lòng bàn tay, bốn ngón nắm, ngón cái) cầm đúng
//! từng lớp vũ khí; hoạt cảnh bằng lò xo (giật súng lùi / ngóc / lệch / nghiêng, góc nhìn ngóc rồi hồi), đung đưa theo
//! chuột, nhún theo bước, hạ súng khi chạy nhanh, nhún khi tiếp đất, rút vũ khí, nạp đạn theo kiểu súng (tháo / lắp băng,
//! bơm, kéo khoá nòng, nhét đạn, kéo dây), vung cận chiến ba kiểu, vung tay ném, cúi xuống băng bó.
//! Phần nhìn thấy của phát bắn: chớp lửa đầu nòng, khói, đầu đạn bay thật (vệt sáng đi từ nòng tới đích rồi mới bung tia
//! lửa / bụi / dăm gỗ / máu), mũi tên và lưỡi cưa bay, vỏ đạn văng có vật lý (nảy, kêu leng keng, mờ dần), tên lửa bay có
//! đuôi khói rồi nổ: chớp, vòng sóng xung kích, mảnh văng, vết cháy, rung màn hình.
//! Sát thương vẫn tính ngay lúc bóp cò (luật gốc); riêng tên lửa nổ khi chạm.

import { Vec3, Vec2, v3, v2, X, Y, Z, ZERO, ONE, NEG_Y, NEG_Z, clamp, signum, Q_ID, q_x, q_y, q_mul, q_euler, q_rot } from './vec.js';
import * as geom from './geom.js';
import { hex, shade } from './geom.js';
import * as guns from './guns.js';
import * as items from './items.js';
import * as models from './models.js';
import * as world from './world.js';
import * as combat from './combat.js';
import * as player from './player.js';
import * as fx from './fx.js';

const PI = Math.PI;
const TAU = Math.PI * 2;

/** glam `normalize_or`. */
function normalize_or(a, fb) {
  const r = 1.0 / a.length();
  return isFinite(r) && r > 0 ? a.mul(r) : fb.clone();
}

function swap_remove(arr, k) {
  const x = arr[k];
  const last = arr.pop();
  if (k < arr.length) arr[k] = last;
  return x;
}

export class Spring {
  constructor() {
    this.x = 0;
    this.v = 0;
  }
  step(dt, k, c) {
    // Chia nhỏ bước cho ổn định khi khung hình dài.
    const n = Math.max(Math.ceil(dt / 0.008), 1.0) | 0;
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (-k * this.x - c * this.v) * h;
      this.x += this.v * h;
    }
  }
}

/** a, b: Vec3; t, dur; kind: 0 đầu đạn, 1 mũi tên, 2 lưỡi cưa, 3 đinh; fx: hiệu ứng bung ra khi tới đích (u8 | null); decal. */
export function Tracer(a, b, t, dur, kind, fx_, decal) {
  return { a, b, t, dur, kind, fx: fx_, decal };
}

/** p, v: Vec3; ang, spin, life; shell, bounced. */
export function Casing(p, v, ang, spin, life, shell, bounced) {
  return { p, v, ang, spin, life, shell, bounced };
}

/** p, v: Vec3; dmg, life, smoke. */
export function Rocket(p, v, dmg, life, smoke) {
  return { p, v, dmg, life, smoke };
}

export class Vis {
  constructor() {
    this.tracers = [];
    this.casings = [];
    this.rockets = [];
    /** Vết trên mặt đất: [tâm, bán kính, giây còn lại, 0 lỗ đạn / 1 vết cháy]. */
    this.decals = [];
    /** Vòng sóng xung kích: [tâm, bán kính lớn nhất, tuổi]. */
    this.rings = [];
    /** Chớp lửa đầu nòng: [vị trí, hướng, giây còn lại, cỡ] | null. */
    this.muzzle = null;
    this.shake = 0;
    this.kick = [new Spring(), new Spring(), new Spring(), new Spring()];
    this.view = new Spring();
    this.view_yaw = new Spring();
    this.land = new Spring();
    this.equip = 0;
    this.item = null;
    /** Hoạt cảnh sau phát bắn của súng bơm / khoá nòng (giây còn lại, tổng). */
    this.pump = [0, 0];
    this.swing_var = 0;
    this.was_swing = false;
    this.sway = v2();
    this.last_look = v2();
    this.sprint = 0;
    /** Trọng số các tư thế cầm (0..1, hoà mượt): ngắm, chạy chiến thuật, sát tường, ngồi, trên không; hẹn giờ xem súng / báng. */
    this.ads = 0;
    this.tac = 0;
    this.wall = 0;
    this.crouch = 0;
    this.air = 0;
    this.inspect = 0;
    this.bash = 0;
    this.heal = 0;
    this.last_vy = 0;
    this.clock = 0;
    this.seed = 0;
    /** Đếm cho bot: số phát đã bắn, vỏ đã văng, tên lửa đã nổ. */
    this.shots = 0;
    this.ejected = 0;
    this.blasts = 0;
  }
  rnd() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return (this.seed >>> 8) / 16777216.0;
  }
  busy() {
    return this.tracers.length > 0 || this.casings.length > 0 || this.rockets.length > 0 || this.decals.length > 0 || this.rings.length > 0 || this.muzzle !== null;
  }
  /** Cho bot: [phát bắn, vỏ đạn đã văng, vỏ đang nằm / bay, đầu đạn đang bay, tên lửa đang bay, vụ nổ, giật hiện tại, góc nhìn ngóc]. */
  export() {
    return `[${this.shots},${this.ejected},${this.casings.length},${this.tracers.length},${this.rockets.length},${this.blasts},${this.kick[0].x.toFixed(4)},${this.view.x.toFixed(4)}]`;
  }
}

function basis(dir) {
  const right = normalize_or(dir.cross(Y), X);
  return [right, normalize_or(right.cross(dir), Y)];
}

/** Đầu nòng trong thế giới của khẩu đang cầm. */
export function muzzle_pos(item, eye, dir) {
  const s = guns.spec(item);
  const [right, up] = basis(dir);
  return eye.add(right.mul(s.hold.x)).add(up.mul(s.hold.y + s.muzzle.y)).add(dir.mul(-s.hold.z + s.muzzle.x));
}

/** Một phát bắn của người chơi: `ends` là điểm tới của từng viên (và hiệu ứng khi tới): mảng [Vec3, fx | null, decal]. */
export function shot(g, item, eye, dir, ends) {
  const s = guns.spec(item);
  const [right, up] = basis(dir);
  const m = muzzle_pos(item, eye, dir);
  const v = g.fx2;
  v.shots += 1;
  const [kb, kp, ky, kr] = s.kick;
  const r1 = v.rnd() - 0.5;
  const r2 = v.rnd() - 0.5;
  v.kick[0].v += kb * 26.0;
  v.kick[1].v += kp * 24.0;
  v.kick[2].v += ky * 40.0 * r1;
  v.kick[3].v += kr * 40.0 * r2;
  v.view.v += s.view * 22.0;
  v.view_yaw.v += s.view * 14.0 * r1;
  let kind;
  switch (s.class) {
    case 'Bow': case 'Crossbow': kind = 1; break;
    case 'Saw': kind = 2; break;
    case 'Nail': kind = 3; break;
    default: kind = 0;
  }
  if (!(s.class === 'Bow' || s.class === 'Crossbow' || s.class === 'Saw' || s.class === 'Nail')) {
    v.muzzle = [m, dir, 0.055, (s.class === 'Shotgun' || s.class === 'Sniper' || s.class === 'Revolver') ? 1.5 : 1.0];
  }
  for (const [b, fx_, decal] of ends) {
    const dist = Math.max(b.distance(m), 0.5);
    v.tracers.push(Tracer(m, b.clone(), 0.0, dist / s.speed, kind, fx_, decal));
  }
  if (v.tracers.length > 96) {
    const n = v.tracers.length - 96;
    v.tracers.splice(0, n);
  }
  const e = s.eject;
  if (e !== null) {
    // Súng bơm / khoá nòng hất vỏ lúc lên đạn (sau phát bắn), súng khác hất ngay.
    const delay = s.class === 'Shotgun' || s.class === 'Sniper';
    if (delay) {
      v.pump = s.class === 'Shotgun' ? [0.5, 0.5] : [0.8, 0.8];
    } else {
      const p = eye.add(right.mul(s.hold.x + e.z)).add(up.mul(s.hold.y + e.y)).add(dir.mul(-s.hold.z + e.x));
      const a = v.rnd(), b = v.rnd(), c = v.rnd();
      v.casings.push(Casing(p, right.mul(1.6 + a * 1.4).add(up.mul(1.6 + b * 1.2)).add(dir.mul((c - 0.5) * 1.2)), a * 6.0, 14.0 + b * 20.0, 4.0, false, false));
      v.ejected += 1;
    }
  }
  if (v.casings.length > 64) {
    const n = v.casings.length - 64;
    v.casings.splice(0, n);
  }
  g.fxq.push([fx.FX_PUFF, m.add(dir.mul(0.12))]);
}

/** Phóng tên lửa: đầu đạn bay thật, nổ khi chạm. */
export function rocket(g, item, eye, dir, dmg) {
  const m = muzzle_pos(item, eye, dir);
  const s = guns.spec(item);
  const v = g.fx2;
  v.shots += 1;
  v.kick[0].v += s.kick[0] * 26.0;
  v.kick[1].v += s.kick[1] * 24.0;
  v.view.v += s.view * 22.0;
  v.shake = Math.max(v.shake, 0.35);
  v.muzzle = [m, dir, 0.08, 1.8];
  v.rockets.push(Rocket(m.clone(), dir.mul(s.speed).add(Y.mul(1.2)), dmg, 6.0, 0.0));
  // Luồng khói phụt ra sau ống phóng.
  g.fxq.push([fx.FX_TRAIL, m.sub(dir.mul(1.1))]);
  g.fxq.push([fx.FX_DUST, m.sub(dir.mul(1.4))]);
  g.play('whoosh', 0.8);
}

/** Phần nhìn thấy của một vụ nổ: vòng sóng xung kích, mảnh văng, vết cháy trên đất, rung màn hình theo khoảng cách. */
export function boom(g, pos, radius) {
  const d = g.player.distance(pos);
  const v = g.fx2;
  v.blasts += 1;
  v.rings.push([v3(pos.x, 0.03, pos.z), radius, 0.0]);
  v.decals.push([v3(pos.x, 0.0, pos.z), radius * 0.42, 40.0, 1]);
  v.shake = Math.max(v.shake, clamp(1.0 - d / 30.0, 0.0, 1.0) * 1.0);
  for (let k = 0; k < 5; k++) {
    const a = k * 1.257;
    g.fxq.push([fx.FX_DEBRIS, pos.add(v3(Math.cos(a) * 0.6, 0.3, Math.sin(a) * 0.6))]);
  }
  g.fxq.push([fx.FX_DUST, pos.add(Y.mul(0.2))]);
  g.fxq.push([fx.FX_TRAIL, pos.add(Y.mul(0.8))]);
}

/** Tia từ o theo d gặp mặt đất hoặc tường (vật cản XZ coi như cao 3,2 m): [khoảng cách, loại (0 đất, 1 tường)] | null. */
export function ray_world(g, o, d, max) {
  let best = null;
  if (d.y < -1e-4) {
    const t = o.y / -d.y;
    if (t < max) {
      best = [t, 0];
    }
  }
  const inv = v3(1.0 / (d.x + 1e-6), 1.0 / (d.y + 1e-6), 1.0 / (d.z + 1e-6));
  for (const b of [...world.COLLIDERS, ...g.bld.cols]) {
    const mn = v3(b[0], 0.0, b[1]), mx = v3(b[2], 3.2, b[3]);
    const t0 = mn.sub(o).mulv(inv), t1 = mx.sub(o).mulv(inv);
    const lo = t0.min(t1), hi = t0.max(t1);
    const tn = Math.max(Math.max(lo.x, lo.y), lo.z), tf = Math.min(Math.min(hi.x, hi.y), hi.z);
    if (tf >= Math.max(tn, 0.0) && tn > 0.05 && tn < (best !== null ? best[0] : max)) {
      best = [tn, 1];
    }
  }
  return best;
}

/** ZKind::scale (lives in combat.rs `impl ZKind`); uses combat's port when it exposes one, else the same table. */
function zkind_scale(kind) {
  const Z_ = combat.ZKind;
  if (Z_ && typeof Z_.scale === 'function') return Z_.scale(kind);
  if (typeof combat.zkind_scale === 'function') return combat.zkind_scale(kind);
  switch (kind) {
    case 'Hulk': return 1.5;
    case 'Brute': return 2.0;
    case 'Birther': return 1.7;
    case 'Sweaty': return 2.2;
    case 'Baby': return 0.55;
    case 'TwinBuff': case 'TwinHeal': return 1.2;
    default: return 1.0;
  }
}

/** Mỗi khung hình: đầu đạn bay, vỏ đạn rơi nảy, tên lửa bay và nổ, vết mờ dần, lò xo hồi. */
export function tick(g, dt) {
  // std::mem::take(&mut g.fx2)
  let v = g.fx2;
  g.fx2 = new Vis();
  // Đầu đạn.
  let k = 0;
  while (k < v.tracers.length) {
    v.tracers[k].t += dt;
    if (v.tracers[k].t >= v.tracers[k].dur) {
      const t = swap_remove(v.tracers, k);
      if (t.fx !== null) {
        g.fxq.push([t.fx, t.b.clone()]);
      }
      if (t.decal) {
        v.decals.push([v3(t.b.x, 0.0, t.b.z), 0.035, 25.0, 0]);
      }
    } else {
      k += 1;
    }
  }
  // Vỏ đạn bơm / khoá nòng văng ra giữa hoạt cảnh lên đạn.
  if (v.pump[0] > 0.0) {
    const before = v.pump[0] / v.pump[1];
    v.pump[0] = Math.max(v.pump[0] - dt, 0.0);
    const after = v.pump[0] / v.pump[1];
    if (before > 0.55 && after <= 0.55) {
      const w = g.cur_w();
      const item = w !== null && items.gun(w.item) !== null ? w.item : null;
      if (item !== null) {
        const s = guns.spec(item);
        const e = s.eject;
        if (e !== null) {
          const dir = v3(-Math.sin(g.yaw) * Math.cos(g.pitch), Math.sin(g.pitch), -Math.cos(g.yaw) * Math.cos(g.pitch));
          const [right, up] = basis(dir);
          const eye = g.player.add(Y.mul(player.EYE));
          const p = eye.add(right.mul(s.hold.x + e.z)).add(up.mul(s.hold.y + e.y)).add(dir.mul(-s.hold.z + e.x));
          const a = v.rnd(), b = v.rnd();
          v.casings.push(Casing(p, right.mul(1.8 + a).add(up.mul(1.4 + b)), a * 6.0, 12.0 + b * 14.0, 4.0, s.class === 'Shotgun', false));
          v.ejected += 1;
          g.play('reload', 0.35);
        }
      }
    }
  }
  let tink = false;
  for (const c of v.casings) {
    c.life -= dt;
    c.v.y -= 9.8 * dt;
    c.p = c.p.add(c.v.mul(dt));
    c.ang += c.spin * dt;
    if (c.p.y < 0.012) {
      c.p.y = 0.012;
      if (c.v.y < -0.6) {
        c.v = v3(c.v.x * 0.55, -c.v.y * 0.38, c.v.z * 0.55);
        c.spin *= 0.6;
        if (!c.bounced) {
          c.bounced = true;
          tink = true;
        }
      } else {
        c.v = v3();
        c.spin = 0.0;
      }
    }
  }
  v.casings = v.casings.filter((c) => c.life > 0.0);
  if (tink) {
    g.play('tink', 0.3);
  }
  // Tên lửa.
  k = 0;
  while (k < v.rockets.length) {
    const p0 = v.rockets[k].p, vel = v.rockets[k].v;
    const step = vel.length() * dt;
    const d = normalize_or(vel, NEG_Z);
    const hit_z = g.zombies.filter((z) => !z.dead && z.hp > 0.0).some((z) => {
      const c = z.pos.add(Y.mul(1.0));
      const t = clamp(c.sub(p0).dot(d), 0.0, step);
      return p0.add(d.mul(t)).distance(c) < 0.75 * Math.max(zkind_scale(z.kind), 1.0);
    });
    const wall = ray_world(g, p0, d, step + 0.05);
    v.rockets[k].life -= dt;
    if (hit_z || wall !== null || v.rockets[k].life <= 0.0) {
      const at = p0.add(d.mul(wall !== null ? wall[0] : step * 0.5));
      const r = swap_remove(v.rockets, k);
      g.fx2 = v;
      combat.explode(g, at, 100.0 + r.dmg, 5.0, false);
      v = g.fx2;
      g.fx2 = new Vis();
      continue;
    }
    const r = v.rockets[k];
    r.v.y -= 3.2 * dt;
    r.p = r.p.add(r.v.mul(dt));
    r.smoke -= dt;
    if (r.smoke <= 0.0) {
      r.smoke = 0.035;
      g.fxq.push([fx.FX_TRAIL, r.p.sub(d.mul(0.35))]);
    }
    k += 1;
  }
  for (const d of v.decals) {
    d[2] -= dt;
  }
  v.decals = v.decals.filter((d) => d[2] > 0.0);
  if (v.decals.length > 48) {
    const n = v.decals.length - 48;
    v.decals.splice(0, n);
  }
  for (const r of v.rings) {
    r[2] += dt;
  }
  v.rings = v.rings.filter((r) => r[2] < 0.4);
  if (v.muzzle !== null) {
    const m = v.muzzle;
    m[2] -= dt;
    if (m[2] <= 0.0) {
      v.muzzle = null;
    }
  }
  v.shake = Math.max(v.shake - dt * 2.2, 0.0);
  v.heal = Math.max(v.heal - dt, 0.0);
  for (const s of v.kick) {
    s.step(dt, 190.0, 21.0);
  }
  v.view.step(dt, 120.0, 17.0);
  v.view_yaw.step(dt, 120.0, 17.0);
  v.land.step(dt, 160.0, 15.0);
  g.fx2 = v;
}

/** glam Quat::from_rotation_arc(from, to) (both unit). */
function quat_arc(from, to) {
  const d = from.dot(to);
  if (d < -1.0 + 1e-6) {
    // Ngược chiều: quay PI quanh một trục vuông góc.
    let ax = from.cross(X);
    if (ax.length_squared() < 1e-6) ax = from.cross(Y);
    ax = ax.normalize();
    return [ax.x, ax.y, ax.z, 0];
  }
  const c = from.cross(to);
  const q = [c.x, c.y, c.z, 1.0 + d];
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return q.map((x) => x / l);
}

/** Vẽ phần tức thời vào lưới động của thế giới. */
export function draw(v, mb, tm) {
  const { FLAT, METAL } = geom;
  const old = mb.emi;
  for (const t of v.tracers) {
    const f = clamp(t.t / t.dur, 0.0, 1.0);
    const d = normalize_or(t.b.sub(t.a), NEG_Z);
    const len = t.a.distance(t.b);
    const head = t.a.add(d.mul(len * f));
    switch (t.kind) {
      case 1: {
        // Mũi tên: xoay khung +x về hướng bay.
        mb.emi = 0.0;
        mb.push(geom.m4_mul(geom.m4_translate(head), geom.m4_from_quat(quat_arc(X, d))));
        guns.arrow(mb, v3(-0.6, 0.0, 0.0), 0.56);
        mb.pop();
        break;
      }
      case 2: {
        mb.emi = 0.0;
        mb.push(geom.m4_mul(geom.m4_translate(head), geom.m4_rot_y(tm * 40.0)));
        guns.saw_disc(mb, v3(), 0.1);
        mb.pop();
        break;
      }
      default: {
        // Vệt sáng ngắn bay theo đầu đạn.
        mb.emi = 2.4;
        const tail = head.sub(d.mul(Math.min(len * f, t.kind === 3 ? 0.25 : 1.6)));
        mb.tube(tail, head, 0.004, 0.011, 4, hex(0xffe08a), FLAT);
      }
    }
  }
  mb.emi = 0.0;
  for (const c of v.casings) {
    const k = clamp(c.life / 0.6, 0.0, 1.0);
    const ax = normalize_or(v3(Math.cos(c.ang), Math.sin(c.ang * 0.7) * 0.4, Math.sin(c.ang)), X);
    if (c.shell) {
      mb.tube(c.p.sub(ax.mul(0.028 * k)), c.p.add(ax.mul(0.028 * k)), 0.0105 * k, 0.0105 * k, 6, hex(0xb0342a), FLAT);
      mb.tube(c.p.sub(ax.mul(0.03 * k)), c.p.sub(ax.mul(0.018 * k)), 0.0112 * k, 0.0112 * k, 6, hex(0xc9a84a), METAL);
    } else {
      mb.tube(c.p.sub(ax.mul(0.014 * k)), c.p.add(ax.mul(0.014 * k)), 0.0055 * k, 0.005 * k, 5, hex(0xc9a84a), METAL);
    }
  }
  for (const r of v.rockets) {
    const d = normalize_or(r.v, NEG_Z);
    mb.tube(r.p.sub(d.mul(0.3)), r.p.add(d.mul(0.1)), 0.04, 0.035, 8, hex(0x8a8f86), METAL);
    mb.tube(r.p.add(d.mul(0.1)), r.p.add(d.mul(0.22)), 0.035, 0.004, 8, hex(0xb0342a), METAL);
    mb.emi = 3.0;
    const fl = 0.25 + 0.1 * Math.sin(tm * 60.0);
    mb.tube(r.p.sub(d.mul(0.3 + fl)), r.p.sub(d.mul(0.3)), 0.004, 0.035, 6, hex(0xffb040), FLAT);
    mb.emi = 0.0;
  }
  for (const [c, r, life, kind] of v.decals) {
    const a = clamp(life / 6.0, 0.0, 1.0);
    const [col, y] = kind === 1 ? [hex(0x0c0b0a), 0.006] : kind === 2 ? [hex(0x3a0d0d), 0.005] : [hex(0x101010), 0.008];
    const prev = mb.alpha;
    mb.alpha = a;
    mb.lathe(v3(c.x, y, c.z), [[r * (0.4 + 0.6 * a), 0.0], [0.0, 0.001]], kind >= 1 ? 12 : 6, false, col, FLAT);
    mb.alpha = prev;
  }
  for (const [c, rmax, age] of v.rings) {
    const f = age / 0.4;
    const r = rmax * (0.15 + 0.85 * Math.sqrt(f));
    mb.emi = 2.2 * (1.0 - f);
    mb.lathe(c, [[r, 0.0], [r * 0.9, 0.05 * (1.0 - f)], [r * 0.8, 0.0]], 20, false, hex(0xffd9a0), FLAT);
  }
  if (v.muzzle !== null) {
    const [p, d, t, size] = v.muzzle;
    // Chớp lửa: nón lửa phía trước + ba cánh hình sao.
    const f = clamp(t / 0.055, 0.0, 1.0);
    mb.emi = 4.0;
    const s = size * (0.6 + 0.4 * f);
    mb.tube(p, p.add(d.mul(0.22 * s)), 0.03 * s, 0.002, 6, hex(0xffc860), FLAT);
    const [right, up] = basis(d);
    for (let k = 0; k < 3; k++) {
      const a = k * 2.094 + tm * 31.0;
      const o = right.mul(Math.cos(a)).add(up.mul(Math.sin(a))).mul(0.09 * s);
      mb.tube(p.add(d.mul(0.02)), p.add(d.mul(0.06)).add(o), 0.014 * s, 0.001, 4, hex(0xffe9a8), FLAT);
    }
  }
  mb.emi = old;
}

// ---------- kit.rs subset (kit is not ported; the static loft + hand used by `arm` is transliterated here) ----------

/** kit::Sect */
function Sect(c, rx, rf, rb, sq) {
  return { c, rx, rf, rb, sq };
}

/** Determinant of a column-major 4x4 (glam Mat4::determinant). */
function m4_det(m) {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  return b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
}

/** Mat4::from_cols(x, y, z, w) with xyz vectors (w-components 0) and origin (1). */
function m4_cols(x, y, z, o) {
  return [x.x, x.y, x.z, 0, y.x, y.y, y.z, 0, z.x, z.y, z.z, 0, o.x, o.y, o.z, 1];
}

/** kit::Skin, static part only (bone binds are not needed: the arm is poured into MB with `into_mb`). */
class Skin {
  constructor() {
    this.p = [];
    this.n = [];
    this.c = [];
    this.uv = [];
    this.i = [];
    this.col = [0, 0, 0];
    this.pat = 0;
    this.emi = 0;
    this.m = geom.m4_id();
  }
  set(col, pat) {
    this.col = col;
    this.pat = pat;
  }
  vert(local) {
    const q = geom.m4_point(this.m, local);
    this.p.push(q);
    this.n.push(v3());
    this.c.push([this.col[0], this.col[1], this.col[2], 1.0]);
    this.uv.push([this.pat, this.emi]);
    return this.p.length - 1;
  }
  tri(a, b, c) {
    const n = this.p[b].sub(this.p[a]).cross(this.p[c].sub(this.p[a]));
    for (const k of [a, b, c]) {
      this.n[k] = this.n[k].add(n);
    }
    this.i.push(a, b, c);
  }
  loft(rings, seg, cap0, cap1) {
    const start = this.p.length;
    if (rings.length < 2) {
      return start;
    }
    const up = rings[rings.length - 1].c.y >= rings[0].c.y;
    const flip = m4_det(this.m) < 0.0;
    const point = (r, k) => {
      const a = (k / seg) * TAU;
      const s = Math.sin(a), c = Math.cos(a);
      const e = 2.0 / r.sq;
      const x = r.rx * signum(c) * Math.pow(Math.abs(c), e);
      const d = signum(s) * Math.pow(Math.abs(s), e);
      // s > 0 là nửa trước (-z).
      const z = s > 0.0 ? -r.rf * d : -r.rb * d;
      return r.c.add(v3(x, 0.0, z));
    };
    const base = [];
    for (const r of rings) {
      const b = this.p.length;
      for (let k = 0; k < seg; k++) {
        this.vert(point(r, k));
      }
      base.push(b);
    }
    const out = up !== flip;
    for (let wi = 0; wi + 1 < base.length; wi++) {
      const w0 = base[wi], w1 = base[wi + 1];
      for (let k = 0; k < seg; k++) {
        const k1 = (k + 1) % seg;
        const a = w0 + k, b = w0 + k1, c = w1 + k1, d = w1 + k;
        if (out) {
          this.tri(a, b, c);
          this.tri(a, c, d);
        } else {
          this.tri(a, c, b);
          this.tri(a, d, c);
        }
      }
    }
    for (const [on, ri, first] of [[cap0, 0, true], [cap1, rings.length - 1, false]]) {
      if (!on) {
        continue;
      }
      const r = rings[ri];
      const c = this.vert(r.c);
      const b = base[ri];
      for (let k = 0; k < seg; k++) {
        const k1 = (k + 1) % seg;
        if ((first === up) !== flip) {
          this.tri(c, b + k1, b + k);
        } else {
          this.tri(c, b + k, b + k1);
        }
      }
    }
    return start;
  }
  slab(c, s, sq) {
    const h = s.mul(0.5);
    const r = (y, k) => Sect(v3(c.x, y, c.z), h.x * k, h.z * k, h.z * k, sq);
    const e = Math.min(h.y, Math.min(h.x, h.z)) * 0.35;
    return this.loft([r(c.y - h.y, 0.9), r(c.y - h.y + e, 1.0), r(c.y + h.y - e, 1.0), r(c.y + h.y, 0.9)], 12, true, true);
  }
  paint(from, f) {
    for (let k = from; k < this.p.length; k++) {
      const c = f(this.p[k], [this.c[k][0], this.c[k][1], this.c[k][2]]);
      this.c[k] = [c[0], c[1], c[2], this.c[k][3]];
    }
  }
  normals() {
    return this.n.map((n) => normalize_or(n, Y).arr());
  }
  into_mb(mb) {
    mb.push_raw(this.p.map((p) => p.arr()), this.normals(), this.uv, this.c, this.i);
  }
}

/** kit::hand (static): lòng bàn tay loft, bốn ngón ba đốt thuôn dần, ngón cái đối diện, móng tay (khi `nails`). */
function kit_hand(sk, base, side, curl, grip, k, seg, nails) {
  const { m4_mul, m4_translate, m4_rot_x, m4_rot_z, m4_scale } = geom;
  const old = sk.m;
  const col = sk.col, pat = sk.pat;
  const hinge = m4_mul(m4_mul(old, base), m4_scale(v3(k, k, k)));
  sk.m = hinge;
  const s = (y, t, w, z) => Sect(v3(0.0, y, z), t, w, w, 2.6);
  sk.loft([s(0.014, 0.017, 0.024, 0.0), s(-0.018, 0.0185, 0.035, -0.002), s(-0.058, 0.0175, 0.043, -0.003), s(-0.09, 0.0135, 0.0415, -0.003)], seg + 2, false, true);
  const fz = [-0.031, -0.0105, 0.0105, 0.0295];
  const fl = [0.072, 0.082, 0.076, 0.058];
  const fr = [0.0094, 0.0098, 0.0092, 0.008];
  const q = (y, r) => Sect(v3(0.0, y, 0.0), r * 0.9, r, r, 2.2);
  for (let f = 0; f < 4; f++) {
    let m = m4_mul(hinge, m4_translate(v3(0.0, -0.087 + (f === 3 ? 0.007 : f === 0 ? 0.003 : 0.0), fz[f])));
    let rad = fr[f];
    const parts = [0.45, 0.31, 0.24];
    for (let j = 0; j < 3; j++) {
      const len = fl[f] * parts[j];
      m = m4_mul(m, m4_rot_z(-side * curl[j] * (1.0 + 0.07 * f)));
      sk.m = m;
      const r1 = rad * 0.89;
      sk.loft([q(0.004, rad * 0.97), q(-len * 0.5, rad), q(-len, r1), q(-len - r1 * 0.6, r1 * 0.5)], seg, true, true);
      if (nails && j === 2) {
        sk.set(shade(col, 1.25), pat);
        sk.slab(v3(side * r1 * 0.72, -len * 0.62, 0.0), v3(0.004, len * 0.6, r1 * 1.35), 2.4);
        sk.set(col, pat);
      }
      m = m4_mul(m, m4_translate(v3(0.0, -len, 0.0)));
      rad = r1;
    }
  }
  // Ngón cái: gốc ở mép trước lòng bàn tay, chĩa ra trước; khi nắm thì vòng sang phía lòng bàn tay.
  let m = m4_mul(m4_mul(m4_mul(hinge, m4_translate(v3(-side * 0.006, -0.026, -0.034))), m4_rot_x(0.8 - 0.3 * grip)), m4_rot_z(-side * (0.2 + 0.8 * grip)));
  const th = [[0.038, 0.0118], [0.031, 0.0106]];
  for (let j = 0; j < 2; j++) {
    const [len, rad] = th[j];
    if (j === 1) {
      m = m4_mul(m, m4_rot_z(-side * (0.2 + 0.6 * grip)));
    }
    sk.m = m;
    sk.loft([q(0.006, rad), q(-len * 0.5, rad), q(-len, rad * 0.9), q(-len - rad * 0.55, rad * 0.5)], seg, true, true);
    if (nails && j === 1) {
      sk.set(shade(col, 1.25), pat);
      sk.slab(v3(side * rad * 0.7, -len * 0.62, 0.0), v3(0.004, len * 0.55, rad * 1.3), 2.4);
      sk.set(col, pat);
    }
    m = m4_mul(m, m4_translate(v3(0.0, -len, 0.0)));
  }
  sk.m = old;
}

// ---------- tay góc nhìn thứ nhất ----------

const SLEEVE = 0x4a4f44;
const SKIN = 0xc68a5e;

/** Một cánh tay từ khuỷu tới bàn tay đang nắm quanh điểm `grip`; `palm` là hướng lòng bàn tay; `side` 1 tay phải, -1 tay trái. */
/** View switch (plug/hands.js clears `arms` so the first-person meshes carry only the held item; `?hands=old` keeps them). */
export const VM_OPTS = { arms: true };

export function arm(mb, grip, elbow, palm, side) {
  if (!VM_OPTS.arms) return;
  const { FLAT } = geom;
  const y = normalize_or(grip.sub(elbow), Y);
  const z = normalize_or(palm.sub(y.mul(palm.dot(y))), Z);
  const x = y.cross(z);
  // Nắm tay nằm ở (0, L + 0,08, 0,035) trong khung tay.
  const len = grip.sub(elbow).length() - 0.08;
  const origin = grip.sub(y.mul(len + 0.08)).sub(z.mul(0.035));
  const sk = new Skin();
  sk.m = m4_cols(x, y, z, origin);
  const r = (yy, rad) => Sect(v3(0.0, yy, 0.0), rad, rad * 0.92, rad * 0.92, 2.0);
  // Tay áo có nếp ở khuỷu và gấu tay.
  sk.set(hex(SLEEVE), FLAT);
  const s0 = sk.loft([r(-0.06, 0.06), r(0.0, 0.058), r(len * 0.45, 0.05), r(len - 0.05, 0.041), r(len - 0.03, 0.044), r(len - 0.012, 0.043)], 10, true, false);
  sk.paint(s0, (p, c) => shade(c, 0.86 + 0.28 * (Math.sin(p.x * 37.0) * Math.cos(p.y * 53.0) * 0.5 + 0.5)));
  sk.set(shade(hex(SLEEVE), 0.7), FLAT);
  sk.loft([r(len - 0.034, 0.0455), r(len - 0.02, 0.046), r(len - 0.01, 0.0445)], 10, false, true);
  // Cổ tay, lòng bàn tay, bốn ngón nắm (hai đốt), ngón cái.
  sk.set(hex(SKIN), FLAT);
  sk.loft([r(len - 0.03, 0.03), r(len + 0.01, 0.032), r(len + 0.03, 0.036)], 8, false, false);
  // Bàn tay nắm quanh cán: ngón gập ba đốt, ngón cái vòng sang đối diện (kit::hand).
  const m = m4_cols(Z.mul(-side), NEG_Y, X.mul(-side), v3(0.0, len - 0.012, 0.0));
  kit_hand(sk, m, side, [1.15, 1.35, 0.9], 1.0, 1.1, 6, true);
  sk.into_mb(mb);
}

/** Dựng hai lưới của hình cầm tay: `main` (vũ khí + tay phải) và `off` (tay trái + băng đạn / ốp bơm).
 *  Khung của súng: +x là nòng; khung của vũ khí cận chiến và đồ ném: cán dọc +y (như `models::weapon_item`). */
export function build_vm(item, main, off) {
  const v = v3;
  if (items.gun(item) !== null) {
    const s = guns.spec(item);
    guns.model(main, item);
    guns.off_part(off, item);
    let re, le, lp;
    switch (s.class) {
      case 'Pistol': case 'Revolver': case 'Nail': [re, le, lp] = [v(-0.3, -0.16, 0.2), v(-0.2, -0.26, -0.3), v(0.3, 0.2, 1.0)]; break;
      case 'Launcher': [re, le, lp] = [v(-0.3, -0.26, 0.12), v(0.02, -0.4, -0.2), v(0.0, 1.0, 0.2)]; break;
      case 'Bow': [re, le, lp] = [v(-0.3, -0.2, 0.2), v(-0.25, -0.3, -0.2), v(-1.0, 0.0, 0.0)]; break;
      case 'Minigun': [re, le, lp] = [v(-0.3, -0.12, 0.2), v(-0.1, -0.1, -0.36), v(0.0, -1.0, 0.2)]; break;
      default: [re, le, lp] = [v(-0.32, -0.2, 0.17), v(0.0, -0.34, -0.32), v(0.0, 1.0, 0.25)];
    }
    if (s.class === 'Bow') {
      // Cung: tay trái cầm thân cung, tay phải kéo dây.
      arm(off, v(0.135, 0.0, 0.0), le, lp, -1.0);
      arm(main, v(-0.02, 0.0, 0.0), re, v(0.0, 0.0, -1.0), 1.0);
    } else {
      arm(main, s.grip, re, v(0.0, 0.2, -1.0), 1.0);
      arm(off, s.fore, le, lp, -1.0);
    }
    return;
  }
  models.weapon_item(main, item, false);
  // Tay phải nắm cán (cán dọc +y, khuỷu ở sau dưới bên phải).
  const grip = items.throwable(item) !== null ? v(0.0, -0.03, 0.0) : v(0.0, -0.1, 0.0);
  arm(main, grip, v(0.12, -0.42, 0.34), v(-1.0, 0.0, -0.2), 1.0);
}

function bell(p) {
  return Math.sin(clamp(p, 0.0, 1.0) * PI);
}

/** Thứ `player.rs` đưa vào mỗi khung hình. */
export class PoseIn {
  constructor(o = {}) {
    this.item = o.item !== undefined ? o.item : null;
    this.bob = o.bob || 0;
    this.sprinting = !!o.sprinting;
    this.dt = o.dt || 0;
    /** Chuột phải giữ (ngắm), chạy chiến thuật (nhấn Shift hai lần), ngồi (Ctrl), khoảng trống trước mặt (m), bắt đầu xem
     *  súng (T), bắt đầu đập báng (Z). */
    this.ads = !!o.ads;
    this.tac = !!o.tac;
    this.crouch = !!o.crouch;
    this.wall_d = o.wall_d || 0;
    this.inspect = !!o.inspect;
    this.bash = !!o.bash;
  }
}

/** Transform::default() */
function transform() {
  return { translation: v3(), rotation: Q_ID.slice(), scale: ONE.clone() };
}

/** Tư thế hai lưới cầm tay (trong khung camera) + góc nhìn cộng thêm (ngóc, lệch, nghiêng) + độ lệch rung của camera.
 *  Returns [main, off, view, shake]; main/off = { translation: Vec3, rotation: [x,y,z,w], scale: Vec3 }. */
export function pose(g, i) {
  const dt = i.dt;
  const reload_t = g.cb.reload_t;
  const swing = g.swing, swing_len = Math.max(g.cb.swing_len, 0.1), charge = g.cb.charge, vel_y = g.vel_y;
  const look = v2(g.yaw, g.pitch);
  const v = g.fx2;
  if (v.item !== i.item) {
    v.item = i.item;
    v.equip = 0.0;
    v.pump = [0.0, 1.0];
  }
  v.equip = Math.min(v.equip + dt / 0.32, 1.0);
  // Đung đưa theo chuột: súng trễ lại sau góc nhìn.
  const dl = look.sub(v.last_look);
  if (dl.x > PI) {
    dl.x -= TAU;
  } else if (dl.x < -PI) {
    dl.x += TAU;
  }
  v.last_look = look;
  const c2 = (a, lo, hi) => v2(clamp(a.x, lo, hi), clamp(a.y, lo, hi));
  v.sway = v.sway.add(c2(c2(dl, -0.2, 0.2).mul(1.6).sub(v.sway.mul(9.0 * dt)), -1.0, 1.0));
  v.sway = c2(v.sway, -0.25, 0.25);
  const ease = (key, on, rate) => {
    v[key] += ((on ? 1.0 : 0.0) - v[key]) * Math.min(dt * rate, 1.0);
  };
  const busy = reload_t > 0.0 || swing > 0.0;
  ease('sprint', i.sprinting && !i.tac, 9.0);
  ease('tac', i.sprinting && i.tac, 8.0);
  ease('ads', i.ads && !i.sprinting && !busy && v.bash <= 0.0, 16.0);
  ease('crouch', i.crouch, 10.0);
  ease('air', Math.abs(vel_y) > 0.3, 8.0);
  const wall_t = smoothstep(0.95, 0.35, i.wall_d) * (1.0 - v.ads);
  v.wall += (wall_t - v.wall) * Math.min(dt * 12.0, 1.0);
  if (i.inspect && v.inspect <= 0.0 && !busy) {
    v.inspect = 2.6;
  }
  if (i.bash && v.bash <= 0.0 && reload_t <= 0.0) {
    v.bash = 0.5;
  }
  if (i.ads || i.sprinting || busy) {
    v.inspect = 0.0;
  }
  v.inspect = Math.max(v.inspect - dt, 0.0);
  v.bash = Math.max(v.bash - dt, 0.0);
  // Tiếp đất: nhún xuống.
  if (v.last_vy < -2.5 && Math.abs(vel_y) < 0.01) {
    v.land.v -= Math.min(-v.last_vy * 0.22, 1.6);
  }
  v.last_vy = vel_y;
  if (swing > 0.0 && !v.was_swing) {
    v.swing_var = (v.swing_var + 1) % 3;
  }
  v.was_swing = swing > 0.0;

  let e = 1.0 - v.equip;
  e = e * e;
  v.clock += dt;
  const breathe = v.clock;
  const idle = v3(Math.sin(breathe * 0.9) * 0.0025, Math.sin(breathe * 1.3) * 0.004, 0.0);
  // Nhún theo bước: ngắm còn 15%, ngồi 60%, chạy chiến thuật mạnh hơn (CoD: súng nảy theo nhịp chạy).
  const steady = (1.0 - 0.85 * v.ads) * (1.0 - 0.4 * v.crouch) * (1.0 + 0.8 * v.tac);
  const bobv = v3(Math.cos(i.bob * 1.85) * 0.007, Math.sin(i.bob * 3.7) * 0.008, 0.0).mul(steady);
  const sway = v.sway.mul(1.0 - 0.7 * v.ads);
  // Chạy thường: súng ôm sát ngực, kéo về phía thân và chúc nòng xuống chéo qua người, KHÔNG đưa ra ngoài sườn.
  // Chạy chiến thuật: súng dựng lên trước ngực, nòng chỉ lên trời. Sát tường: rụt súng về, nòng ngóc lên.
  // Ngồi: hạ thấp và nghiêng nhẹ vào trong. Trên không: súng trễ xuống.
  const common = idle.add(bobv)
    .add(v3(-sway.x * 0.06, sway.y * 0.05 + v.land.x * 0.09 - e * 0.36 - bell(v.heal / 0.7) * 0.3, 0.0))
    .add(v3(-0.06, 0.0, 0.08).mul(v.sprint))
    .add(v3(-0.03, -0.01, 0.11).mul(v.tac))
    .add(v3(-0.025, -0.02, 0.15).mul(v.wall))
    .add(v3(-0.012, 0.015, 0.02).mul(v.crouch))
    .add(v3(0.0, -0.025, 0.0).mul(v.air));
  const common_rot = q_euler(
    'XYZ',
    -e * 0.9 - v.sprint * 0.25 + v.tac * 0.95 + v.wall * 0.75 - v.air * 0.08 + sway.y * 0.25 - bell(v.heal / 0.7) * 0.6,
    sway.x * 0.35 + v.sprint * 0.45 + v.tac * 0.2 + v.wall * 0.2,
    v.sprint * 0.35 + v.tac * 0.6 - v.crouch * 0.07 - sway.x * 0.3,
  );
  const view = v3(v.view.x, v.view_yaw.x, 0.0);
  const sh = v.shake;
  const a = v.rnd() - 0.5, b = v.rnd() - 0.5, c = v.rnd() - 0.5;
  const shake = v3(a, b, c).mul(sh * 0.07);
  let main = transform();
  let off = transform();
  if (i.item === null) return [main, off, view, shake];
  const item = i.item;
  const wg = items.gun(item);
  if (wg !== null) {
    const gd = wg[1];
    const s = guns.spec(item);
    const aim = q_y(PI / 2);
    const kick = v3(0.0, v.kick[1].x * 0.06, v.kick[0].x);
    const kick_rot = q_euler('XYZ', v.kick[1].x, v.kick[2].x, v.kick[3].x);
    // Nạp đạn: p đi từ 0 tới 1.
    const total = Math.max(gd.reload, 0.2);
    const p = reload_t > 0.0 ? 1.0 - clamp(reload_t / total, 0.0, 1.0) : 0.0;
    const on = reload_t > 0.0;
    let r_pos = v3(), r_rot = Q_ID.slice(), o_pos = v3(), o_rot = Q_ID.slice();
    if (on) {
      const out = bell(clamp((p - 0.12) / 0.62, 0.0, 1.0));
      switch (s.reload) {
        case 'Mag': {
          // Súng nghiêng phải để lộ ổ băng; tay trái: rời ốp lót tay tới băng (0..0,15), rút băng xuống ra ngoài
          // (0,15..0,35), thả xuống thắt lưng lấy băng mới (0,35..0,55), đưa lên miệng ổ (0,55..0,8), đẩy vào và
          // vỗ đáy băng (0,8..0,9), về lại ốp lót tay.
          const tilt = smoothstep(0.0, 0.15, p) * (1.0 - smoothstep(0.85, 1.0, p));
          r_pos = v3(-0.02 * tilt, -0.025 * tilt, 0.03 * tilt);
          r_rot = q_euler('XYZ', 0.22 * tilt, -0.15 * tilt, -0.55 * tilt);
          const keys = [
            [0.0, ZERO],
            [0.15, v3(-0.01, -0.03, 0.02)],
            [0.35, v3(-0.07, -0.3, 0.1)],
            [0.55, v3(-0.09, -0.38, 0.14)],
            [0.8, v3(-0.01, -0.06, 0.02)],
            [0.88, v3(0.0, 0.012, 0.0)],
            [1.0, ZERO],
          ];
          let k = 0;
          while (k + 2 < keys.length && p > keys[k + 1][0]) {
            k += 1;
          }
          const f = smoothstep(keys[k][0], keys[k + 1][0], p);
          o_pos = keys[k][1].lerp(keys[k + 1][1], f);
          o_rot = q_euler('XYZ', -0.6 * out, 0.0, 0.3 * out);
          break;
        }
        case 'Pump': {
          // Nhét từng viên vào bụng súng rồi bơm.
          r_rot = q_euler('XYZ', 0.25 * bell(p), 0.0, 0.5 * bell(p));
          const load = Math.max(Math.sin(p * 4.0 * TAU), 0.0) * (1.0 - smoothstep(0.8, 0.9, p));
          o_pos = v3(0.0, -0.05 * load, 0.16 * (1.0 - smoothstep(0.8, 0.9, p)) + 0.09 * bell((p - 0.86) / 0.14));
          break;
        }
        case 'Bolt': {
          r_rot = q_euler('XYZ', 0.12 * bell(p), 0.0, -0.35 * bell(p));
          o_pos = v3(-0.05 * out, -0.3 * out, 0.04 * out);
          break;
        }
        case 'Single': {
          r_pos = v3(0.0, -0.06 * bell(p), 0.0);
          r_rot = q_euler('XYZ', -0.75 * bell(p), 0.0, 0.3 * bell(p));
          o_pos = v3(0.0, -0.26 * out, 0.1 * out);
          break;
        }
        case 'Draw': {
          r_pos = v3(0.0, 0.0, 0.1 * bell(p));
          o_rot = q_x(0.2 * bell(p));
          break;
        }
      }
    }
    // Lên đạn sau phát bắn: bơm kéo về rồi đẩy lên; khoá nòng: nghiêng súng, tay kéo.
    if (v.pump[0] > 0.0 && !on) {
      const q = bell(1.0 - v.pump[0] / v.pump[1]);
      if (s.class === 'Shotgun') {
        o_pos = o_pos.add(v3(0.0, 0.0, 0.09 * q));
        r_rot = q_mul(r_rot, q_x(0.06 * q));
      } else {
        r_rot = q_mul(r_rot, q_euler('XYZ', 0.1 * q, 0.0, -0.3 * q));
        r_pos = r_pos.add(v3(0.0, 0.0, 0.03 * q));
      }
    }
    // Ngắm: điểm ngắm (cao hơn chuôi ~7,5 cm, súng ngắn 6 cm) về giữa khung nhìn, súng lại gần mắt.
    const sight = (s.class === 'Pistol' || s.class === 'Revolver' || s.class === 'Nail') ? 0.066 : 0.086;
    const ads_pos = v3(-s.hold.x, -s.hold.y - sight, 0.05).mul(v.ads);
    // Xem súng: xoay mặt trái ra (nghiêng + đưa lại gần), rồi lật mặt phải, ngóc nòng; đập báng: đẩy tới, xoay ngang.
    const ip = 1.0 - v.inspect / 2.6;
    let x_pos = v3(), x_rot = Q_ID.slice();
    if (v.inspect > 0.0) {
      const a2 = bell(ip / 0.5) * smoothstep(0.0, 0.08, ip);
      const b2 = bell((ip - 0.45) / 0.55);
      x_pos = v3(-0.05 * (a2 + b2), 0.03 * a2 + 0.02 * b2, 0.07 * (a2 + b2));
      x_rot = q_euler('XYZ', 0.1 * a2 + 0.3 * b2, 0.3 * a2 - 0.2 * b2, 0.6 * a2 - 0.5 * b2);
    }
    if (v.bash > 0.0) {
      const bp = 1.0 - v.bash / 0.5;
      const thrust = bell((bp - 0.15) / 0.45);
      const wind = bell(bp / 0.2) * (1.0 - smoothstep(0.1, 0.2, bp));
      x_pos = x_pos.add(v3(-0.12 * thrust, 0.04 * thrust, -0.2 * thrust + 0.06 * wind));
      x_rot = q_mul(x_rot, q_euler('XYZ', 0.15 * thrust, -0.6 * thrust + 0.2 * wind, 0.8 * thrust));
    }
    const base = s.hold.add(common).add(kick.mul(1.0 - 0.4 * v.ads)).add(ads_pos).add(x_pos);
    const rot = q_mul(q_mul(q_mul(common_rot, x_rot), kick_rot), r_rot);
    main = { translation: base.add(r_pos), rotation: q_mul(rot, aim), scale: ONE.clone() };
    off = { translation: base.add(r_pos).add(q_rot(rot, o_pos)), rotation: q_mul(q_mul(rot, o_rot), aim), scale: ONE.clone() };
    return [main, off, view, shake];
  }
  // Cận chiến và đồ ném: ba kiểu vung (bổ dọc, quạt ngang, chém chéo), nạp lực ném.
  const k = swing > 0.0 ? Math.min((swing_len - swing) / (swing_len * 0.4), 1.0) : 0.0;
  const arc = swing > 0.0 ? Math.sin(k * PI) : 0.0;
  let dp, dr;
  switch (v.swing_var) {
    case 0: [dp, dr] = [v3(-arc * 0.14, 0.0, -arc * 0.15), q_euler('XYZ', -arc * 1.35, 0.0, arc * 0.5)]; break;
    case 1: [dp, dr] = [v3(-arc * 0.3, -arc * 0.04, -arc * 0.12), q_euler('XYZ', -arc * 0.5, arc * 0.9, arc * 1.3)]; break;
    default: [dp, dr] = [v3(-arc * 0.22, arc * 0.05, -arc * 0.16), q_euler('XYZ', -arc * 1.1, arc * 0.4, arc * 0.95)];
  }
  main = {
    translation: v3(0.33, -0.25 + charge * 0.1, -0.56 + charge * 0.12).add(common).add(dp),
    rotation: q_mul(q_mul(common_rot, q_euler('XYZ', -0.25 + charge * 0.6, 0.2, -0.15)), dr),
    scale: ONE.clone(),
  };
  off.translation = v3(0.0, -5.0, 0.0);
  return [main, off, view, shake];
}

function smoothstep(a, b, x) {
  // crate::kit::smooth (kit is not ported).
  const t = clamp((x - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
export { smoothstep };

/* VIEW NOTES (fp.js)
 Ported with meshes: `draw(g.fx2, mb, tm)` pours the transient shot visuals into world.rs's dynamic mesh each frame
 (world.js calls it); `build_vm(item, mainMB, offMB)` builds the two viewmodel meshes (player.rs spawns them with
 {viewmodel:true}, rebuilds only when the held item changes); `pose(g, PoseIn)` returns [main, off, view, shake] where
 main/off are camera-space transforms {translation, rotation:[x,y,z,w], scale}, view = extra camera euler XYZ
 (x = view-kick pitch spring, y = view-kick yaw spring, z = 0) and shake = camera offset (m). player.rs applies:
 cam.pos = eye + rot*(bob + shake); cam.rot = rot * euler XYZ(view.x, view.y, view.z + shake.x*0.4).

 Transient visuals (g.fx2 = Vis):
 - tracers: kind 0 bullet / 3 nail -> emissive 2.4 tube 0xffe08a radius 0.004 (tail) -> 0.011 (head), length min(travelled,
   1.6 m; nail 0.25 m); head = a + (b-a)*t/dur. kind 1 arrow (guns.arrow, tail at -0.6, len 0.56, +x rotated onto the flight
   direction); kind 2 saw disc r 0.1 spinning about y at tm*40 rad/s. On arrival fx id is pushed to g.fxq and a bullet-hole
   decal (r 0.035, 25 s) is laid.
 - casings: brass 0xc9a84a tube 2.8 cm long r 0.0055; shotgun shells red 0xb0342a 5.6 cm r 0.0105 with brass base. Axis
   (cos ang, 0.4 sin(0.7 ang), sin ang); scale k = clamp(life/0.6) shrinks them in the last 0.6 s of their 4 s life.
   Gravity 9.8, floor y 0.012, bounce (x,z *0.55, y *-0.38) when falling faster than 0.6 m/s, first bounce plays "tink".
 - rockets: grey body 0x8a8f86 (0.4 m, r 0.04), red nose 0xb0342a, emissive 3.0 flame 0xffb040 of length 0.25+0.1 sin(60 tm)
   behind; gravity 3.2 m/s^2; smoke FX_TRAIL every 0.035 s; explode on zombie (0.75*max(scale,1) m around pos+1 m), wall/
   ground (ray_world) or after 6 s -> combat.explode(g, at, 100 + dmg, 5, false).
 - decals [c, r, life, kind]: lathe disc, alpha = clamp(life/6), radius r*(0.4+0.6a); kind 0 bullet hole 0x101010 y 0.008
   (6 seg), 1 scorch 0x0c0b0a y 0.006, 2 blood 0x3a0d0d y 0.005 (12 seg). Max 48.
 - rings [c, rmax, age]: shock ring, lives 0.4 s, radius rmax*(0.15+0.85 sqrt(f)), height 0.05*(1-f), emissive 2.2*(1-f),
   colour 0xffd9a0.
 - muzzle [p, dir, t, size]: emissive 4.0 cone 0xffc860 length 0.22 s (r 0.03 s), plus 3 star petals 0xffe9a8 rotating at
   31 rad/s, s = size*(0.6+0.4*t/0.055); size 1.0, 1.5 for Shotgun/Sniper/Revolver, 1.8 rocket (0.08 s).
 - shake: decays 2.2/s; rocket launch 0.35; blast max(1 - d/30) clamped.
 Springs (k, c): kick[0..3] (back, pitch, yaw, roll) 190/21; view and view_yaw 120/17; land 160/15. Impulses on a shot:
 kick0 += kb*26, kick1 += kp*24, kick2 += ky*40*r1, kick3 += kr*40*r2, view += view*22, view_yaw += view*14*r1.

 Arms (`arm`): sleeve 0x4a4f44 (lofted, radius 0.06 at the elbow -> 0.041 near the cuff, mottled 0.86..1.14), darker cuff
 (shade 0.7), skin 0xc68a5e wrist + kit hand (curl 1.15/1.35/0.9 rad, full grip, scale 1.1, nails). The fist sits at the
 `grip` point; the forearm points from `elbow` to `grip`, palm facing `palm`.
 Gun elbows (re right / le left, lp left palm): pistol/revolver/nail re(-0.3,-0.16,0.2) le(-0.2,-0.26,-0.3) lp(0.3,0.2,1);
 launcher re(-0.3,-0.26,0.12) le(0.02,-0.4,-0.2) lp(0,1,0.2); bow (left hand on the riser at (0.135,0,0), right hand on the
 string at (-0.02,0,0)) re(-0.3,-0.2,0.2) le(-0.25,-0.3,-0.2) lp(-1,0,0); minigun re(-0.3,-0.12,0.2) le(-0.1,-0.1,-0.36)
 lp(0,-1,0.2); long guns re(-0.32,-0.2,0.17) le(0,-0.34,-0.32) lp(0,1,0.25). Right palm (0,0.2,-1). Melee/throwables:
 models.weapon_item + right arm gripping (0,-0.1,0) (throwable (0,-0.03,0)), elbow (0.12,-0.42,0.34), palm (-1,0,-0.2).

 HOLD POSES (pose(); all eases are x += (target-x)*min(dt*rate,1); camera space metres, +x right, +y up, -z forward;
 rotations are euler XYZ in rad; gun meshes are turned by aim = rot_y(PI/2) so gun +x points to camera -z):
 - hip: translation = spec.hold (e.g. pistol (0.17,-0.17,-0.5), rifle (0.16,-0.19,-0.38)) + idle breathing
   (sin(0.9t)*0.0025, sin(1.3t)*0.004) + step bob (cos(1.85 bob)*0.007, sin(3.7 bob)*0.008)*steady, steady =
   (1-0.85 ads)(1-0.4 crouch)(1+0.8 tac); mouse sway (lag, |sway|<=0.25) moves (-0.06 sx, 0.05 sy) and rotates (0.25 sy,
   0.35 sx, -0.3 sx); equip (0.32 s, e=(1-equip)^2) lowers y by 0.36e and pitches -0.9e; landing spring land.x*0.09
   (impulse -min(0.22*|vy|,1.6) when landing faster than 2.5 m/s); heal bandage bell(heal/0.7): y -0.3, pitch -0.6.
 - ADS (rate 16; blocked while sprinting, reloading, swinging or bashing): + (-hold.x, -hold.y - sight, 0.05)*ads with
   sight 0.066 (pistol/revolver/nail) or 0.086, bob x0.15, sway x0.3, kick translation x0.6. Disables wall pose.
 - sprint (rate 9): +(-0.06, 0, 0.08), rot (-0.25, 0.45, 0.35).
 - tactical sprint (rate 8): +(-0.03,-0.01,0.11), rot (0.95, 0.2, 0.6) (barrel to the sky).
 - wall (rate 12, target smoothstep(0.95,0.35,wall_d)*(1-ads)): +(-0.025,-0.02,0.15), rot (0.75, 0.2, 0).
 - crouch (rate 10): +(-0.012,0.015,0.02), roll -0.07.
 - air (rate 8, |vel_y|>0.3): +(0,-0.025,0), pitch -0.08.
 - recoil: translation (0, kick1*0.06, kick0), rot (kick1, kick2, kick3).
 - reload, p = 1 - reload_t/max(gd.reload,0.2), out = bell((p-0.12)/0.62):
   Mag: gun tilt = ss(0,0.15,p)*(1-ss(0.85,1,p)): pos (-0.02,-0.025,0.03)*tilt, rot (0.22,-0.15,-0.55)*tilt; left hand keys
     p 0 (0,0,0) | 0.15 (-0.01,-0.03,0.02) | 0.35 (-0.07,-0.3,0.1) | 0.55 (-0.09,-0.38,0.14) | 0.8 (-0.01,-0.06,0.02) |
     0.88 (0,0.012,0) | 1.0 (0,0,0) smoothstep between keys (6 beats: reach, pull mag out, drop to belt, bring up, seat+slap,
     return); left rot (-0.6 out, 0, 0.3 out). The magazine mesh is in the off mesh so it travels with the left hand.
   Pump: gun rot (0.25 bell, 0, 0.5 bell); left hand loads 4 shells: y -0.05*max(sin(p*4*TAU),0), z 0.16 until p 0.8..0.9,
     then pump z +0.09 bell((p-0.86)/0.14).
   Bolt: gun rot (0.12 bell, 0, -0.35 bell); left hand (-0.05,-0.3,0.04)*out.
   Single: gun y -0.06 bell, rot (-0.75 bell, 0, 0.3 bell); left hand (0,-0.26,0.1)*out.
   Draw: gun z +0.1 bell; left rot x 0.2 bell.
 - after-shot cycling (pump timer 0.5 s shotgun / 0.8 s sniper, q = bell(1 - left/total); casing ejected at 55%):
   shotgun left hand z +0.09q, gun pitch 0.06q; bolt gun rot (0.1q, 0, -0.3q), z +0.03q.
 - inspect (T, 2.6 s, cancelled by ADS/sprint/busy): ip = 1 - inspect/2.6, a = bell(ip/0.5)*ss(0,0.08,ip),
   b = bell((ip-0.45)/0.55): pos (-0.05(a+b), 0.03a+0.02b, 0.07(a+b)), rot (0.1a+0.3b, 0.3a-0.2b, 0.6a-0.5b).
 - butt strike (Z, 0.5 s): bp = 1 - bash/0.5, thrust = bell((bp-0.15)/0.45), wind = bell(bp/0.2)*(1-ss(0.1,0.2,bp)):
   pos (-0.12t, 0.04t, -0.2t + 0.06w), rot (0.15t, -0.6t + 0.2w, 0.8t).
 - composition: base = hold + common + kick*(1-0.4 ads) + ads_pos + x_pos; rot = common_rot*x_rot*kick_rot*r_rot;
   main = (base + r_pos, rot*aim); off = (base + r_pos + rot*o_pos, rot*o_rot*aim).
 - melee: (0.33, -0.25 + 0.1 charge, -0.56 + 0.12 charge) + common + dp, rot common_rot * (-0.25 + 0.6 charge, 0.2, -0.15)
   * dr; swing arc = sin(PI * min((len - swing)/(0.4 len), 1)), three variants cycling per swing: 0 overhead
   dp(-0.14a,0,-0.15a) dr(-1.35a,0,0.5a); 1 sweep dp(-0.3a,-0.04a,-0.12a) dr(-0.5a,0.9a,1.3a); 2 diagonal
   dp(-0.22a,0.05a,-0.16a) dr(-1.1a,0.4a,0.95a). Off mesh hidden at (0,-5,0).

 PORT GAPS: kit.rs is not ported, so the static subset used by `arm` (Skin.loft/slab/paint/into_mb and kit::hand) is
   transliterated privately in this file without bone binds (unused by into_mb). Skin.into_mb calls
   `mb.push_raw(p[[x,y,z]], n[[x,y,z]], uv[[a,b]], c[[r,g,b,a]], i[])` with the Rust array shapes. ZKind::scale is taken
   from combat.ZKind.scale / combat.zkind_scale when the combat port exposes it, else from the same table copied from
   combat.rs. world.COLLIDERS is read as an array of [x0,z0,x1,z1]. Rust Quat::from_rotation_arc is reimplemented
   (quat_arc). `g.play(name, vol)` is assumed on the JS Game (game.rs Game::play).
*/
