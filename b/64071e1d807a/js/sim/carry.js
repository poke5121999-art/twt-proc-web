//! Cầm và tương tác bằng tay: ném rác vào skip (rác bay theo cung, nằm lại trong thùng), kéo xác kiểu ragdoll,
//! chổi quét đống bẩn, tay ôm hộp. Luật (điểm, nhiệm vụ) giữ nguyên của `player.rs`; ở đây là hình, vật lý nhỏ và âm.
//! `[ĐỀ XUẤT]`: sức chứa skip 12 túi, đổ sạch lúc sang ngày (bản gốc không có luật đổ thùng); kéo xác đi chậm còn 60 %.
// Port of src/carry.rs (see three/PORT-CONTRACT.md).
import { Vec3, Vec2, v3, v2, k3, ZERO, Y, X, Z, trunc, clamp, signum, Rng, Q_ID, q_x, q_y, q_z, q_mul, q_euler, q_rot, q_to_euler_yxz } from './vec.js';
import { MB, hex, shade, FLAT, WOOD, CORRUGATED, METAL, m4_mul, m4_translate, m4_rot_x, m4_rot_y, m4_rot_z, m4_scale, m4_from_quat, m4_point } from './geom.js';
import * as scene from './scene.js';
import * as fp from './fp.js';
import * as lay from './lay.js';
import * as world from './world.js';
import * as fx from './fx.js';
import * as skills from './skills.js';
import * as combat from './combat.js';

export const BIN_CAP = 12;
export const VM_BROOM = 900001;
export const VM_DRAG = 900002;
export const VM_BASE = 1000000;
/// Giây quét một đống `[GỐC]` (1,25 giây khi đã có nâng cấp; 2,1 giây lúc đầu: dùng mức nhanh như bản trước).
export const SWEEP_SECS = 1.25;
const GRAV = 9.8;
const RELEASE = 0.26;
const TOSS_END = 0.56;
/// Tâm xoay của túi rác so với đáy.
const MID = 0.18;
/// Mặt lớp xà bần sẵn có trong skip (túi rác nằm trên đó, đứng ngoài nhìn vào thấy được).
export const BED = 0.55;
const PI = Math.PI;
const TAU = Math.PI * 2;

let REV = 1;
function bump() {
  const r = REV;
  REV = (REV + 1) >>> 0;
  return r;
}

// ---------- quaternion / matrix helpers (glam look-alikes not in vec.js) ----------

/// glam Vec3::normalize_or
function nor(v, fb) {
  const l = v.length();
  const rcp = 1 / l;
  return isFinite(rcp) && rcp > 0 ? v.mul(rcp) : fb.clone();
}
function q_norm(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
/// Quat::from_axis_angle (axis normalised)
function q_axis_angle(axis, a) {
  const s = Math.sin(a * 0.5);
  return [axis.x * s, axis.y * s, axis.z * s, Math.cos(a * 0.5)];
}
/// Quat::inverse of a unit quaternion
function q_inv(q) {
  return [-q[0], -q[1], -q[2], q[3]];
}
/// Quat::from_mat3 with columns x, y, z (glam algorithm).
function q_from_cols(x, y, z) {
  const m00 = x.x, m01 = y.x, m02 = z.x, m10 = x.y, m11 = y.y, m12 = z.y, m20 = x.z, m21 = y.z, m22 = z.z;
  if (m22 <= 0) {
    const dif10 = m11 - m00, omm22 = 1 - m22;
    if (dif10 <= 0) {
      const f = omm22 - dif10, inv = 0.5 / Math.sqrt(f);
      return [f * inv, (m10 + m01) * inv, (m20 + m02) * inv, (m21 - m12) * inv];
    }
    const f = omm22 + dif10, inv = 0.5 / Math.sqrt(f);
    return [(m10 + m01) * inv, f * inv, (m21 + m12) * inv, (m02 - m20) * inv];
  }
  const sum10 = m11 + m00, opm22 = 1 + m22;
  if (sum10 <= 0) {
    const f = opm22 - sum10, inv = 0.5 / Math.sqrt(f);
    return [(m20 + m02) * inv, (m21 + m12) * inv, f * inv, (m10 - m01) * inv];
  }
  const f = opm22 + sum10, inv = 0.5 / Math.sqrt(f);
  return [(m21 - m12) * inv, (m02 - m20) * inv, (m10 - m01) * inv, f * inv];
}
/// Quat::from_rotation_arc(from, to) (both unit).
function q_arc(from, to) {
  const eps = 1 - 2 * 1.1920929e-7;
  const d = from.dot(to);
  if (d > eps) return Q_ID.slice();
  if (d < -eps) {
    // any_orthonormal_vector (glam)
    const sign = from.z < 0 || Object.is(from.z, -0) ? -1 : 1;
    const a = -1 / (sign + from.z);
    const b = from.x * from.y * a;
    const o = v3(1 + sign * from.x * from.x * a, sign * b, -sign * from.x);
    return q_axis_angle(o, PI);
  }
  const c = from.cross(to);
  return q_norm([c.x, c.y, c.z, 1 + d]);
}
/// Mat3 (as {x_axis, y_axis, z_axis}) -> column-major Mat4 array.
function m4_from_mat3(r) {
  const x = r.x_axis, y = r.y_axis, z = r.z_axis;
  return [x.x, x.y, x.z, 0, y.x, y.y, y.z, 0, z.x, z.y, z.z, 0, 0, 0, 0, 1];
}
function mm(...ms) {
  let r = ms[0];
  for (let i = 1; i < ms.length; i++) r = m4_mul(r, ms[i]);
  return r;
}
function splat(s) {
  return v3(s, s, s);
}
/// Bevy Transform as a plain object {translation, rotation, scale} (same shape as fp.js pose()).
function tr(pos, quat) {
  return { translation: pos, rotation: quat, scale: v3(1, 1, 1) };
}

// ---------- types ----------

export class Fly {
  constructor(o = {}) {
    this.id = o.id ?? 0;
    this.pos = o.pos ?? v3();
    this.vel = o.vel ?? v3();
    this.rot = o.rot ?? Q_ID.slice();
    this.axis = o.axis ?? v3();
    this.spin = o.spin ?? 0;
    this.bounces = o.bounces ?? 0;
    /// Ném có nhắm vào skip (E hoặc chuột trên skip): cung bay đã tính để qua mép thùng.
    this.aimed = o.aimed ?? false;
  }
}

export class Bag {
  constructor(o = {}) {
    this.variant = o.variant ?? 0;
    this.id = o.id ?? 0;
    this.pos = o.pos ?? v3();
    this.rot = o.rot ?? Q_ID.slice();
    this.age = o.age ?? 0;
  }
}

export class Toss {
  constructor(o = {}) {
    this.t = o.t ?? 0;
    this.id = o.id ?? 0;
    this.aim = o.aim ?? null;
    this.released = o.released ?? false;
    this.key = o.key ?? 0;
  }
}

const NP = 15;
/// Hạt của ragdoll ở tư thế bind: chậu, ngực, đầu, vai T/P, khuỷu T/P, bàn tay T/P, hông T/P, gối T/P, bàn chân T/P.
const BIND = [
  k3(0.0, 0.86, 0.0),
  k3(0.0, 1.42, 0.0),
  k3(0.0, 1.66, 0.0),
  k3(-0.2, 1.4, 0.0),
  k3(0.2, 1.4, 0.0),
  k3(-0.215, 1.12, 0.0),
  k3(0.215, 1.12, 0.0),
  k3(-0.22, 0.82, 0.0),
  k3(0.22, 0.82, 0.0),
  k3(-0.1, 0.87, 0.0),
  k3(0.1, 0.87, 0.0),
  k3(-0.1, 0.47, 0.0),
  k3(0.1, 0.47, 0.0),
  k3(-0.1, 0.06, 0.0),
  k3(0.1, 0.06, 0.0),
];
/// Khớp da mà mỗi hạt đi theo ở tư thế nằm ban đầu.
const OWN = [0, 0, 1, 0, 0, 2, 3, 6, 7, 0, 0, 4, 5, 8, 9];
const RAD = [0.12, 0.12, 0.11, 0.07, 0.07, 0.05, 0.05, 0.045, 0.045, 0.1, 0.1, 0.06, 0.06, 0.05, 0.05];
/// Thanh nối cứng.
const BONES = [[0, 1], [1, 3], [1, 4], [3, 4], [0, 9], [0, 10], [9, 10], [3, 9], [4, 10], [3, 10], [4, 9], [1, 2], [3, 5], [5, 7], [4, 6], [6, 8], [9, 11], [11, 13], [10, 12], [12, 14]];
/// Khoảng cách tối thiểu (tỉ lệ so với lúc duỗi thẳng): cổ không gập, tay chân không gập đôi, hai chân không chập.
const MINS = [[2, 3, 0.85], [2, 4, 0.85], [3, 7, 0.45], [4, 8, 0.45], [9, 13, 0.5], [10, 14, 0.5], [11, 12, 0.7], [13, 14, 0.7]];
/// Hạt nắm được: hai bàn tay, hai bàn chân.
const GRIPS = [7, 8, 13, 14];

// people.rs is not ported (contract): the constants and the two pure functions grab() needs are copied here.
export const N_JOINTS = 10;
/// Vị trí bind của các khớp trong khung gốc của thân (mét, mặt quay về -z, bên trái là -x). (people::JOINT_POS)
export const JOINT_POS = [
  k3(0.0, 0.86, 0.0),
  k3(0.0, 1.48, 0.0),
  k3(-0.2, 1.4, 0.0),
  k3(0.2, 1.4, 0.0),
  k3(-0.1, 0.87, 0.0),
  k3(0.1, 0.87, 0.0),
  k3(-0.215, 1.12, 0.0),
  k3(0.215, 1.12, 0.0),
  k3(-0.1, 0.47, 0.0),
  k3(0.1, 0.47, 0.0),
];
/// Khớp cha (-1: gắn thẳng vào gốc). (people::PARENT)
const PARENT = [-1, 0, 0, 0, -1, -1, 2, 3, 4, 5];

/// people::corpse_pose: ma trận da của từng khớp ở tư thế nằm ngửa (trong khung của vật).
function corpse_pose(scale) {
  const lay_m = mm(m4_scale(splat(scale)), m4_translate(v3(0.0, 0.13, 0.75)), m4_rot_x(-1.5));
  // Góc từng khớp ở tư thế nằm: (xoay z, xoay x).
  const pose = [[0.0, 0.0], [0.5, 0.0], [-2.3, 0.0], [0.9, 0.0], [-0.25, 0.0], [0.35, 0.3], [0.0, 0.5], [0.0, 0.9], [0.0, -0.3], [0.0, -0.7]];
  const wm = new Array(N_JOINTS).fill(null);
  for (let k = 0; k < N_JOINTS; k++) {
    const p = PARENT[k];
    const [parent, local] = p < 0 ? [lay_m, JOINT_POS[k]] : [wm[p], JOINT_POS[k].sub(JOINT_POS[p])];
    wm[k] = mm(parent, m4_translate(local), m4_rot_z(pose[k][0]), m4_rot_x(pose[k][1]));
  }
  return wm.map((m, k) => m4_mul(m, m4_translate(JOINT_POS[k].neg())));
}

// Look::of (people.rs) inputs that decide the body scale: per archetype builds, ages, height range.
const ARCH_SCALE = [
  { builds: [0, 0, 1], ages: [0, 1, 1], height: [1.62, 1.86] },
  { builds: [1, 4, 4], ages: [0, 1], height: [1.72, 1.92] },
  { builds: [1, 0, 1], ages: [0, 1, 1], height: [1.58, 1.82] },
  { builds: [2, 3, 4], ages: [1, 1, 2], height: [1.7, 1.94] },
  { builds: [2, 1, 3], ages: [1, 2, 2], height: [1.6, 1.86] },
  { builds: [1, 0, 3], ages: [1, 1, 2], height: [1.58, 1.84] },
  { builds: [3, 3, 2], ages: [1, 2], height: [1.68, 1.9] },
  { builds: [4, 0, 4], ages: [0, 1], height: [1.66, 1.92] },
  { builds: [1, 2, 0], ages: [2, 2], height: [1.58, 1.8] },
  { builds: [0, 0, 1], ages: [0], height: [1.55, 1.7] },
  { builds: [2, 4, 1], ages: [0, 1, 1], height: [1.62, 1.88] },
  { builds: [1, 2, 1], ages: [1, 1, 2], height: [1.66, 1.9] },
];
const CORPSE_ZK = ['Base', 'Tumour', 'Hulk'];
/// people::corpse_skin minus the skin: (ZKind of the corpse, look.scale). Replays the Look::of rng up to the height.
export function corpse_scale(seed, kind) {
  const zi = Math.min(kind, 2);
  const zk = CORPSE_ZK[zi];
  if (zk === 'Hulk') return [zk, 1.5];
  const variant = (seed >>> 0) % 24;
  const lseed = (Math.imul(variant, 2654435761) + (zi + 1) * 977 + 17) >>> 0;
  const r = new Rng(lseed);
  const ai = variant % 12;
  const a = ARCH_SCALE[ai];
  const female = r.chance(ai === 1 || ai === 3 || ai === 6 ? 0.25 : ai === 2 || ai === 5 ? 0.6 : 0.45);
  const age = r.pick(a.ages);
  r.pick(a.builds);
  for (let i = 0; i < 4; i++) r.range(0.96, 1.04);
  const h = r.range(a.height[0], a.height[1]) - (female ? 0.06 : 0.0) - (age === 2 ? 0.02 : 0.0);
  return [zk, h / 1.78];
}

export class Rag {
  constructor(o = {}) {
    this.id = o.id ?? 0;
    this.p = o.p ?? new Array(NP).fill(null).map(() => v3());
    this.q = o.q ?? new Array(NP).fill(null).map(() => v3());
    /// Rust: kit::Skin (CPU-skinned mesh). JS: the `scene.people` handle that draws the ragdoll (see VIEW NOTES).
    this.skin = o.skin ?? null;
    this.scale = o.scale ?? 1;
    this.grip = o.grip ?? null;
    this.still = o.still ?? 0;
    this.free = o.free ?? 0;
    this.frozen = o.frozen ?? false;
    this.ghost = o.ghost ?? 0;
    this.speed = o.speed ?? 0;
    this.scrape = o.scrape ?? 0;
    this.smear = o.smear ?? 0;
  }

  /// Ma trận da của 10 khớp theo vị trí các hạt (toạ độ thế giới).
  joints() {
    const p = this.p;
    let tx = p[4].sub(p[3]).add(p[10].sub(p[9]));
    const torso = frame(p[1].sub(p[0]), tx, X);
    const tz = torso.z_axis;
    tx = torso.x_axis;
    const hx = p[10].sub(p[9]);
    const m = (r, at, k) => mm(m4_translate(at), m4_from_mat3(r), m4_scale(splat(this.scale)), m4_translate(JOINT_POS[k].neg()));
    return [
      m(torso, p[0], 0),
      m(frame(p[2].sub(p[1]), tx, tz), p[1].add(torso.y_axis.mul(0.06 * this.scale)), 1),
      m(frame(p[3].sub(p[5]), tx, tz), p[3], 2),
      m(frame(p[4].sub(p[6]), tx, tz), p[4], 3),
      m(frame(p[9].sub(p[11]), hx, tz), p[9], 4),
      m(frame(p[10].sub(p[12]), hx, tz), p[10], 5),
      m(frame(p[5].sub(p[7]), tx, tz), p[5], 6),
      m(frame(p[6].sub(p[8]), tx, tz), p[6], 7),
      m(frame(p[11].sub(p[13]), hx, tz), p[11], 8),
      m(frame(p[12].sub(p[14]), hx, tz), p[12], 9),
    ];
  }

  step(g, pin, dt) {
    const s = this.scale;
    const n = 2;
    const h = dt / n;
    const walls = this.ghost <= 0.0;
    let top = 0.0;
    for (let _i = 0; _i < n; _i++) {
      for (let k = 0; k < NP; k++) {
        const v = this.p[k].sub(this.q[k]).mul(0.985);
        this.q[k] = this.p[k];
        this.p[k] = this.p[k].add(v).add(v3(0.0, -GRAV * h * h, 0.0));
      }
      for (let it = 0; it < 7; it++) {
        if (pin !== null && this.grip !== null) {
          this.p[this.grip] = pin.clone();
        }
        for (const [a, b] of BONES) {
          const rest = BIND[a].distance(BIND[b]) * s;
          const d = this.p[b].sub(this.p[a]);
          const len = Math.max(d.length(), 1e-5);
          const c = d.mul((0.5 * (len - rest)) / len);
          this.p[a] = this.p[a].add(c);
          this.p[b] = this.p[b].sub(c);
        }
        for (const [a, b, f] of MINS) {
          const rest = BIND[a].distance(BIND[b]) * s * f;
          const d = this.p[b].sub(this.p[a]);
          const len = Math.max(d.length(), 1e-5);
          if (len < rest) {
            const c = d.mul((0.5 * (len - rest)) / len);
            this.p[a] = this.p[a].add(c);
            this.p[b] = this.p[b].sub(c);
          }
        }
        for (let k = 0; k < NP; k++) {
          const r = RAD[k] * s;
          // Người chơi: đẩy xác ra khỏi chân mình.
          if (pin !== null) {
            const d = v3(this.p[k].x - g.player.x, 0.0, this.p[k].z - g.player.z);
            const l = d.length();
            if (l < 0.3 + r && l > 1e-4 && k !== this.grip) {
              this.p[k] = this.p[k].add(d.div(l).mul(0.3 + r - l));
            }
          }
          if (walls && it % 2 === 0) {
            const w = world.resolve(g, this.p[k], r);
            this.p[k] = v3(w.x, this.p[k].y, w.z);
          }
          if (this.p[k].y < r) {
            this.p[k] = v3(this.p[k].x, r, this.p[k].z);
            // Ma sát với nền: bớt trượt ngang (một lần mỗi bước).
            if (it === 6) {
              const slide = this.p[k].sub(this.q[k]);
              this.q[k] = v3(this.p[k].x - slide.x * 0.55, this.q[k].y, this.p[k].z - slide.z * 0.55);
            }
          }
        }
      }
      if (pin !== null && this.grip !== null) {
        this.p[this.grip] = pin.clone();
      }
      for (let k = 0; k < NP; k++) {
        if (k !== this.grip || pin === null) {
          top = Math.max(top, this.p[k].distance(this.q[k]) / Math.max(h, 1e-4));
        }
      }
    }
    this.speed = top;
    this.ghost = Math.max(this.ghost - dt, 0.0);
    // Xác kẹt sau tường khi đang kéo: cho đi xuyên một lát thay vì giãn dài.
    if (pin !== null && this.grip !== null) {
      if (pin.distance(this.p[0]) > 2.3 * s) {
        this.ghost = 0.35;
      }
    }
  }
}

export class Carry {
  constructor() {
    this.toss = null;
    this.fly = [];
    this.bin = [];
    this.bin_rev = 0;
    this.lid = new fp.Spring();
    this.empty_t = 0;
    this.rags = [];
    /// Bàn tay đang nắm xác (toạ độ thế giới) của khung hình này.
    this.hand = v3();
    this.sweep_show = 0;
    this.sweep_phase = 0;
    this.sweep_at = v3();
    this.sweep_dirt = 0;
    this.strokes = 0;
    this.pend = v2();
    this.pend_v = v2();
    this.last_look = v2();
    this.vm_key = null;
    this.vm_t = 0;
    this.thrown = 0;
    this.landed = 0;
    this.missed = 0;
    this.seed = 0;
  }
  rnd() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return (this.seed >>> 8) / 16777216.0;
  }
  /// Sang ngày: xe rác đổ skip (hoạt cảnh ngắn chạy khi người chơi thức dậy).
  empty() {
    if (this.bin.length !== 0) {
      this.empty_t = 1.2;
    }
    for (const r of this.rags) {
      r.frozen = true;
    }
  }
}

/// kit::smooth
function smooth(a, b, x) {
  const t = clamp((x - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

function kind_of(g, id) {
  const p = g.props.find((p) => p.id === id && !p.dead);
  return p === undefined ? null : p.kind;
}

// ---------- đống bẩn ----------

/// Đống bẩn đã quét được `done` (0..1): mảnh vụn mất dần, vệt bẩn dưới nền mờ dần.
export function pile_geo(mb, id, done) {
  const r = new Rng(Math.imul(id, 2654435761) >>> 0);
  const left = clamp(1.0 - done, 0.0, 1.0);
  const old = mb.alpha;
  // Vệt bẩn: bụi xám nâu, vài chỗ ngả đỏ sẫm.
  for (let k = 0; k < 9; k++) {
    const c = v3(r.range(-0.36, 0.36), 0.004 + k * 0.0004, r.range(-0.36, 0.36));
    const rad = r.range(0.12, 0.26);
    const col = k % 4 === 3 ? 0x3a1512 : r.pick([0x3f392f, 0x4a4338, 0x353029]);
    mb.alpha = 0.85 * left;
    if (left > 0.02) {
      mb.lathe(c, [[rad * (0.55 + 0.45 * left), 0.0], [0.0, 0.0005]], 9, false, hex(col), FLAT);
    }
  }
  mb.alpha = old;
  const keep = trunc(Math.ceil(left * 7.0));
  for (let k = 0; k < 7; k++) {
    const s = v3(r.range(0.15, 0.4), r.range(0.03, 0.1), r.range(0.15, 0.4));
    const p = v3(r.range(-0.28, 0.28), s.y * 0.5, r.range(-0.28, 0.28));
    const col = r.pick([0x5c5548, 0x6d6a60, 0x4a4338, 0x7a705c, 0x3c3a36]);
    const yaw = r.range(0.0, 3.0);
    if (k < keep) {
      const f = k + 1 === keep ? clamp(left * 7.0 - k, 0.35, 1.0) : 1.0;
      mb.cube_yaw(v3(p.x, s.y * 0.5 * f, p.z), s.mul(f), yaw, hex(col), FLAT);
    }
  }
}

/// Giữ E trên đống bẩn: quét dần. Trả về true khi đống đã sạch.
export function sweep(g, id, dt, right) {
  const p = g.prop(id);
  if (p === null) return false;
  let before = trunc(p.aux * 8.0);
  p.aux = Math.min(p.aux + dt / SWEEP_SECS, 1.0);
  if (trunc(p.aux * 8.0) !== before) {
    p.dirty = true;
  }
  const pos = p.pos.clone(), aux = p.aux;
  const c = g.cy;
  if (c.sweep_show <= 0.0) {
    c.sweep_phase = 0.0;
  }
  c.sweep_show = 0.3;
  c.sweep_at = pos.clone();
  c.sweep_dirt = 1.0 - aux;
  before = trunc(c.sweep_phase / PI);
  c.sweep_phase += (dt * TAU) / 0.62;
  const after = trunc(c.sweep_phase / PI);
  if (after !== before) {
    c.strokes += 1;
    const side = after % 2 === 0 ? 1.0 : -1.0;
    g.fxq.push([fx.FX_DUST, pos.add(right.mul(0.3 * side)).add(Y.mul(0.08))]);
    if (after % 2 === 1) {
      g.play('sweep', 0.5);
    }
  }
  return aux >= 1.0;
}

// ---------- ném rác ----------

/// Bắt đầu ném túi rác đang cầm. `aim`: Some = nhắm vào skip (E trên skip), None = ném theo hướng nhìn (chuột trái).
export function start_toss(g, into_skip) {
  if (g.cy.toss !== null) {
    return true;
  }
  const id = g.held;
  if (id === null) return false;
  const kd = kind_of(g, id);
  if (!(kd !== null && kd.k === 'Trash')) {
    return false;
  }
  if (into_skip && g.cy.bin.length + g.cy.fly.length >= BIN_CAP) {
    g.play('deny', 0.5);
    g.say('The skip is full. It is emptied overnight.');
    return true;
  }
  let aim = null;
  if (into_skip) {
    const b = lay.SKIP_BOX;
    const rx = g.cy.rnd(), rz = g.cy.rnd();
    // Rơi vào khoảng trong thùng gần chỗ người ném nhất, lệch ngẫu nhiên.
    const x = clamp(g.player.x + (rx - 0.5) * 0.9, b[0] + 0.4, b[2] - 0.4);
    aim = v3(x, 0.45, b[1] + 0.4 + rz * (b[3] - b[1] - 0.8));
  }
  g.cy.toss = new Toss({ t: 0.0, id, aim, released: false, key: VM_BASE + id * 64 });
  g.play('swish', 0.5);
  return true;
}

/// Vận tốc đầu để rơi đúng `to`, đi qua mép thùng (cao 1,3 m) còn dư khoảng hở.
function lob(from, to) {
  const b = lay.SKIP_BOX;
  const d = to.sub(from);
  // Tham số s (0..1) lúc đường bay cắt mép ngoài của thùng.
  let s_in = 0.0;
  for (const [o, dd, lo, hi] of [[from.x, d.x, b[0], b[2]], [from.z, d.z, b[1], b[3]]]) {
    if (Math.abs(dd) > 1e-4) {
      const a = (lo - o) / dd, c = (hi - o) / dd;
      s_in = Math.max(s_in, Math.min(a, c));
    }
  }
  s_in = clamp(s_in, 0.0, 0.95);
  let t = 0.5;
  for (;;) {
    const vy = (d.y + 0.5 * GRAV * t * t) / t;
    const tc = s_in * t;
    const y = from.y + vy * tc - 0.5 * GRAV * tc * tc;
    if (y > 1.62 || t > 1.4) {
      return v3(d.x / t, vy, d.z / t);
    }
    t += 0.04;
  }
}

function banked(g) {
  g.trash_done += 1;
  const m = skills.mul(g, 'WasteExperienceIncrease');
  const xpv = 5.0 * (m > 0.0 ? m : 1.0);
  g.xp(trunc(Math.sign(xpv) * Math.round(Math.abs(xpv))), 0);
  combat.disposal_bonus(g);
  if (g.trash_done >= 6) {
    g.complete('Trash');
  }
}

function hand_base() {
  return v3(0.36, -0.15, -0.8);
}

function tick_trash(g, dt, eye, rot) {
  // Vung tay rồi thả.
  let release = null;
  const t0 = g.cy.toss;
  if (t0 !== null) {
    t0.t += dt;
    if (!t0.released && t0.t >= RELEASE) {
      t0.released = true;
      release = [t0.id, t0.aim];
    }
  }
  if (g.cy.toss !== null && g.cy.toss.t >= TOSS_END) {
    g.cy.toss = null;
  }
  if (release !== null) {
    const [id, aim] = release;
    if (g.held === id) {
      g.held = null;
      const from = eye.add(q_rot(rot, hand_base().add(v3(-0.12, 0.2, -0.32))));
      const vel = aim !== null ? lob(from, aim) : q_rot(rot, v3(0.0, 0.25, -1.0).normalize()).mul(7.5);
      const a = g.cy.rnd(), b = g.cy.rnd(), c = g.cy.rnd(), d = g.cy.rnd();
      const axis = q_rot(rot, v3(1.0, (a - 0.5) * 0.6, (b - 0.5) * 0.6)).normalize();
      g.cy.fly.push(new Fly({ id, pos: from, vel, rot: q_mul(rot, q_y(c * 6.0)), axis, spin: -(5.0 + d * 4.0), bounces: 0, aimed: aim !== null }));
      g.cy.thrown += 1;
    }
  }
  // Túi đang bay.
  const b = lay.SKIP_BOX;
  const inside = (p, m) => p.x > b[0] + m && p.x < b[2] - m && p.z > b[1] + m && p.z < b[3] - m;
  let flies = g.cy.fly;
  g.cy.fly = [];
  const held = g.held;
  flies = flies.filter((f) => held !== f.id && g.props.some((p) => p.id === f.id && !p.dead));
  let k = 0;
  while (k < flies.length) {
    const f = flies[k];
    let done = 0;
    const n = trunc(Math.max(Math.ceil(dt / 0.012), 1.0));
    const h = dt / n;
    for (let _i = 0; _i < n; _i++) {
      const prev = f.pos.clone();
      f.vel.y -= GRAV * h;
      f.pos = f.pos.add(f.vel.mul(h));
      f.rot = q_norm(q_mul(q_axis_angle(f.axis, f.spin * h), f.rot));
      const was_in = inside(prev, -0.16);
      const now_in = inside(f.pos, -0.16);
      if (now_in && !was_in && f.pos.y < 1.3 + 0.1 && !f.aimed) {
        // Đập vào thành thùng từ ngoài: nảy lại.
        const nx = prev.x <= b[0] - 0.16 || prev.x >= b[2] + 0.16 ? 1.0 : 0.0;
        f.vel = v3(nx > 0.5 ? -f.vel.x * 0.3 : f.vel.x * 0.5, f.vel.y * 0.5, nx > 0.5 ? f.vel.z * 0.5 : -f.vel.z * 0.3);
        f.pos = prev;
        f.spin *= 0.5;
        g.play('lid', 0.35);
        g.cy.lid.v += 1.2;
        continue;
      }
      if (inside(f.pos, 0.0) && f.pos.y < 1.3) {
        // Trong lòng thùng: thành giữ túi lại, chạm đống rác thì nằm yên.
        f.pos.x = clamp(f.pos.x, b[0] + 0.27, b[2] - 0.27);
        f.pos.z = clamp(f.pos.z, b[1] + 0.27, b[3] - 0.27);
        const near = g.cy.bin.filter((q) => Math.hypot(q.pos.x - f.pos.x, q.pos.z - f.pos.z) < 0.34).length;
        const rest = BED + MID + 0.21 * near;
        if (f.pos.y <= rest) {
          f.pos.y = rest;
          done = 1;
          break;
        }
        continue;
      }
      // Tường và vật cản: đẩy ra theo mặt phẳng ngang.
      // (Skip cũng là một vật cản trong `resolve`: phía trên và trong thùng do đoạn trên lo.)
      if (f.pos.y < 2.8 && !inside(f.pos, -0.2)) {
        const r = world.resolve(g, f.pos, 0.18);
        if (Math.abs(r.x - f.pos.x) + Math.abs(r.z - f.pos.z) > 1e-4) {
          const nrm = v3(r.x - f.pos.x, 0.0, r.z - f.pos.z).normalize_or_zero();
          const vn = f.vel.dot(nrm);
          if (vn < 0.0) {
            f.vel = f.vel.sub(nrm.mul(vn * 1.35));
            f.vel = f.vel.mul(0.6);
            f.spin *= 0.6;
          }
          f.pos.x = r.x;
          f.pos.z = r.z;
        }
      }
      if (f.pos.y <= MID) {
        f.pos.y = MID;
        f.bounces += 1;
        if (Math.abs(f.vel.y) < 1.6 || f.bounces >= 3) {
          done = 2;
          break;
        }
        f.vel = v3(f.vel.x * 0.45, -f.vel.y * 0.28, f.vel.z * 0.45);
        f.spin *= 0.4;
        g.play('drop', 0.4);
        g.fxq.push([fx.FX_DUST, v3(f.pos.x, 0.05, f.pos.z)]);
      }
    }
    const id = f.id, pos = f.pos.clone(), rot = f.rot.slice();
    switch (done) {
      case 1: {
        const kd = kind_of(g, id);
        const variant = kd !== null && kd.k === 'Trash' ? kd.a : 0;
        const p = g.prop(id);
        if (p !== null) {
          p.dead = true;
        }
        g.cy.bin.push(new Bag({ variant, id, pos, rot, age: 0.0 }));
        g.cy.bin_rev = bump();
        g.cy.landed += 1;
        g.cy.lid.v += 3.2;
        g.play('thud', 0.7);
        g.play('lid', 0.45);
        g.fxq.push([fx.FX_DUST, v3(pos.x, 1.2, pos.z)]);
        banked(g);
        flies.splice(k, 1);
        break;
      }
      case 2: {
        // Trượt ra ngoài: nằm lại trên đất như một vật nhặt lên được.
        const [yaw] = q_to_euler_yxz(rot);
        const p = g.prop(id);
        if (p !== null) {
          p.pos = v3(pos.x, 0.0, pos.z);
          p.yaw = yaw;
        }
        g.cy.missed += 1;
        g.play('drop', 0.5);
        g.fxq.push([fx.FX_DUST, v3(pos.x, 0.05, pos.z)]);
        flies.splice(k, 1);
        break;
      }
      default: {
        const p = g.prop(id);
        if (p !== null) {
          p.pos = v3(pos.x, 0.0, pos.z);
        }
        k += 1;
      }
    }
  }
  g.cy.fly = flies;
  // Túi trong thùng: nhún khi vừa rơi; đổ thùng lúc sang ngày.
  for (const q of g.cy.bin) {
    q.age += dt;
  }
  g.cy.lid.step(dt, 70.0, 5.0);
  if (g.cy.empty_t > 0.0) {
    g.cy.empty_t -= dt;
    g.cy.bin_rev = bump();
    if (g.cy.empty_t <= 0.0) {
      g.cy.bin.length = 0;
      g.cy.lid.v += 5.0;
      g.play('lid', 0.5);
      g.fxq.push([fx.FX_DUST, lay.SKIP.add(Y.mul(1.2))]);
    }
  } else if (g.cy.bin.some((q) => q.age < 0.6)) {
    g.cy.bin_rev = bump();
  }
}

/// Vị trí và góc của một túi đang bay (cho `world::sync_world`).
export function flying(c, id) {
  const f = c.fly.find((f) => f.id === id);
  return f === undefined ? null : [f.pos.sub(q_rot(f.rot, v3(0.0, MID, 0.0))), f.rot.slice()];
}

/// Nạp lại ván đã lưu: rác đã vứt trong ngày nằm sẵn trong thùng.
export function restore(g, n) {
  const b = lay.SKIP_BOX;
  g.cy.bin.length = 0;
  for (let k = 0; k < Math.min(n, BIN_CAP); k++) {
    const a = g.cy.rnd(), c = g.cy.rnd(), d = g.cy.rnd();
    const pos = v3(b[0] + 0.4 + a * (b[2] - b[0] - 0.8), BED + MID + (k >= 6 ? 0.21 : 0.0), b[1] + 0.4 + c * (b[3] - b[1] - 0.8));
    g.cy.bin.push(new Bag({ variant: k % 3, id: 7000 + k, pos, rot: q_euler('XYZ', d * 0.6 - 0.3, d * 6.0, a * 0.6 - 0.3), age: 9.0 }));
  }
  g.cy.bin_rev = bump();
}

/// Các node của `sync_bin` (Rust: component BinVis(0) = nắp, BinVis(1) = lưới túi) và Local<u32> `seen`.
export const BinVis = { lid: null, bags: null, seen: 0 };

/// Nắp skip (bản lề ở thành sau, nảy khi túi rơi vào) và lưới các túi đang nằm trong thùng.
export function sync_bin(g, dt, ctx) {
  const b = lay.SKIP_BOX;
  const c = g.cy;
  if (BinVis.lid === null) {
    const lid = new MB();
    lid.bevel = 0.01;
    const w = b[2] - b[0], d = (b[3] - b[1]) * 0.56;
    const green = hex(0x3f6b4f);
    lid.block(v3(-w / 2.0, 0.0, 0.0), v3(w, 0.035, d), shade(green, 0.82), CORRUGATED);
    for (const x of [-w / 2.0 + 0.2, 0.0, w / 2.0 - 0.2]) {
      lid.cube(v3(x, 0.045, d * 0.5), v3(0.06, 0.03, d * 0.9), shade(green, 0.6), METAL);
    }
    lid.cyl(v3(-w / 2.0, 0.0, 0.0), 0.03, 0.03, 0.01, 6, shade(green, 0.5), METAL);
    lid.cube(v3(0.0, 0.02, d - 0.03), v3(0.3, 0.03, 0.04), hex(0x2a2d30), METAL);
    const hinge = v3((b[0] + b[2]) * 0.5, 1.3, b[1] + 0.04);
    BinVis.lid = scene.spawn(lid.build(), 'solid', { pos: hinge });
    const mb = new MB();
    mb.cube(v3(0.0, -5.0, 0.0), splat(0.01), [0.0, 0.0, 0.0], FLAT);
    BinVis.bags = scene.spawn(mb.build(), 'solid', {});
    BinVis.seen = 0;
    return;
  }
  const rebuild = BinVis.seen !== c.bin_rev;
  BinVis.seen = c.bin_rev;
  // Mở ngả ra sau; cú rơi làm nắp gật về phía trước rồi nảy lại.
  BinVis.lid.set_quat(q_x(-1.82 + clamp(c.lid.x, -0.25, 0.9)));
  if (rebuild) {
    const mb = new MB();
    mb.bevel = 0.012;
    const e = c.empty_t > 0.0 ? clamp(c.empty_t / 1.2, 0.0, 1.0) : 1.0;
    for (const q of c.bin) {
      // Nhún: bẹp xuống rồi phồng lại.
      const sq = 1.0 - 0.28 * Math.exp(-q.age * 7.0) * Math.cos(q.age * 22.0);
      const m = mm(
        m4_translate(q.pos.sub(Y.mul((1.0 - e) * 0.5))),
        m4_scale(v3(Math.min(2.0 - sq, 1.15) * e, sq * e, Math.min(2.0 - sq, 1.15) * e)),
        m4_from_quat(q.rot),
        m4_translate(v3(0.0, -MID, 0.0)),
      );
      mb.push(m);
      world.prop_geo(mb, { k: 'Trash', a: q.variant }, q.id);
      mb.pop();
    }
    if (mb.is_empty()) {
      mb.cube(v3(0.0, -5.0, 0.0), splat(0.01), [0.0, 0.0, 0.0], FLAT);
    }
    BinVis.bags.set_mesh(mb.build());
  }
}

// ---------- kéo xác ----------

/// Mat3 as {x_axis, y_axis, z_axis}.
function frame(y, hint, alt) {
  y = nor(y, Y);
  let x = hint.sub(y.mul(hint.dot(y)));
  if (x.length_squared() < 1e-4) {
    x = alt.sub(y.mul(alt.dot(y)));
  }
  x = nor(x, X);
  return { x_axis: x, y_axis: y, z_axis: x.cross(y) };
}

function nearest_grip(pts, player) {
  // Iterator::min_by: first minimum wins on ties.
  let best = null;
  for (const a of GRIPS) {
    if (best === null || pts[a].distance(player) < pts[best].distance(player)) best = a;
  }
  return best;
}

/// Nhấc xác lên kéo: dựng ragdoll từ tư thế nằm hiện tại, nắm tay hoặc chân gần người chơi nhất.
export function grab(g, id) {
  const player = g.player;
  const r0 = g.cy.rags.find((r) => r.id === id);
  if (r0 !== undefined) {
    r0.frozen = false;
    r0.free = 0.0;
    r0.still = 0.0;
    r0.q = r0.p.map((v) => v.clone());
    r0.grip = nearest_grip(r0.p, player);
    return;
  }
  const p = g.props.find((p) => p.id === id && !p.dead);
  if (p === undefined) return;
  if (p.kind.k !== 'Corpse') return;
  const kind = p.kind.a;
  const seed = Math.imul(id, 977) >>> 0;
  const [zk, scale] = corpse_scale(seed, kind);
  const pose = corpse_pose(scale);
  const xf = m4_mul(m4_translate(p.pos), m4_rot_y(p.yaw));
  const pts = new Array(NP).fill(null);
  for (let k = 0; k < NP; k++) {
    const q = m4_point(m4_mul(xf, pose[OWN[k]]), BIND[k]);
    pts[k] = v3(q.x, Math.max(q.y, RAD[k] * scale), q.z);
  }
  const grip = nearest_grip(pts, player);
  const skin = scene.people.spawn(seed, zk, p.pos, { corpse: true, ragdoll: true, scale });
  g.cy.rags.push(new Rag({ id, p: pts, q: pts.map((v) => v.clone()), skin, scale, grip, still: 0.0, free: 0.0, frozen: false, ghost: 0.0, speed: 0.0, scrape: 0.0, smear: 0.0 }));
  const pp = g.prop(id);
  if (pp !== null) {
    pp.yaw = 0.0;
    pp.dirty = true;
  }
}

/// Đang kéo một xác (đi chậm lại).
export function dragging(g) {
  const id = g.held;
  return id !== null && g.cy.rags.some((r) => r.id === id);
}

function tick_rags(g, dt, flat_f, flat_r) {
  const held = g.held;
  const hand = g.player.add(flat_f.mul(0.52)).add(flat_r.mul(0.2)).add(Y.mul(0.74));
  g.cy.hand = hand;
  let rags = g.cy.rags;
  g.cy.rags = [];
  rags = rags.filter((r) => {
    const keep = g.props.some((p) => p.id === r.id && !p.dead);
    // JS only: the Rust Skin is freed with the Rag; the view's person handle must be despawned explicitly.
    if (!keep && r.skin !== null && r.skin.despawn) r.skin.despawn();
    return keep;
  });
  const sfx = [];
  for (const r of rags) {
    const pinned = held === r.id;
    if (r.frozen && !pinned) {
      continue;
    }
    r.frozen = false;
    const before = r.p[0].clone();
    r.step(g, pinned ? hand : null, Math.max(dt, 0.004));
    const moved = v3(r.p[0].x - before.x, 0.0, r.p[0].z - before.z).length();
    if (pinned) {
      r.free = 0.0;
      r.still = 0.0;
      r.scrape += moved;
      r.smear += moved;
      if (r.scrape > 0.9) {
        r.scrape = 0.0;
        sfx.push(['scrape', r.p[0].clone(), false]);
      }
      if (r.smear > 0.22) {
        r.smear = 0.0;
        sfx.push(['', r.p[0].clone(), true]);
      }
    } else {
      r.free += dt;
      r.still = r.speed < 0.05 ? r.still + dt : 0.0;
      if (r.still > 0.5 || r.free > 4.0) {
        r.frozen = true;
        r.q = r.p.map((v) => v.clone());
        r.speed = 0.0;
        sfx.push(['drop', r.p[0].clone(), false]);
      }
    }
  }
  for (const r of rags) {
    const p = g.prop(r.id);
    if (p !== null) {
      p.pos = v3(r.p[0].x, 0.0, r.p[0].z);
      p.yaw = 0.0;
    }
  }
  g.cy.rags = rags;
  for (const [name, at, smear] of sfx) {
    if (smear) {
      g.fx2.decals.push([v3(at.x, 0.0, at.z), 0.12, 14.0, 2]);
    } else {
      g.play(name, 0.45);
      if (name === 'drop') {
        g.fxq.push([fx.FX_DUST, v3(at.x, 0.08, at.z)]);
      }
    }
  }
}

/// Xác đang chuyển động (đang kéo hoặc đang rơi yên): lưới phải dựng lại mỗi khung hình.
export function live(c, id) {
  return c.rags.some((r) => r.id === id && !r.frozen);
}

function hidden_mesh() {
  const mb = new MB();
  mb.cube(v3(0.0, -5.0, 0.0), splat(0.01), [0.0, 0.0, 0.0], FLAT);
  return mb.build();
}

/// Lưới thay thế của vật: xác theo ragdoll, đống bẩn theo phần đã quét.
export function prop_mesh(c, p) {
  switch (p.kind.k) {
    case 'Pile': {
      const mb = new MB();
      mb.bevel = 0.012;
      pile_geo(mb, p.id, p.aux);
      if (mb.is_empty()) {
        mb.cube(v3(0.0, -5.0, 0.0), splat(0.01), [0.0, 0.0, 0.0], FLAT);
      }
      return mb.build();
    }
    case 'Corpse': {
      const r = c.rags.find((r) => r.id === p.id);
      if (r === undefined) return null;
      const back = m4_translate(p.pos.neg());
      const wj = r.joints();
      const j = wj.map((m) => m4_mul(back, m));
      // Rust: r.skin.posed(&j, &mut mb) -> CPU-skinned body mesh in the prop's frame. people/kit are not ported:
      // the person handle gets the joints instead, and the prop's own mesh becomes the hidden placeholder.
      if (r.skin !== null) {
        r.skin.update({ ragdoll: true, joints: wj, local: j, origin: p.pos.clone(), particles: r.p.map((v) => v.clone()), scale: r.scale, frozen: r.frozen, speed: r.speed, grip: r.grip });
      }
      return hidden_mesh();
    }
    default:
      return null;
  }
}

// ---------- mỗi khung hình ----------

export function tick(g, dt, eye, rot, flat_f, flat_r) {
  tick_trash(g, dt, eye, rot);
  tick_rags(g, dt, flat_f, flat_r);
  const look = v2(g.yaw, g.pitch);
  const c = g.cy;
  c.sweep_show = Math.max(c.sweep_show - dt, 0.0);
  // Con lắc của túi rác treo dưới nắm tay.
  const dl = look.sub(c.last_look);
  if (Math.abs(dl.x) > PI) {
    dl.x -= signum(dl.x) * TAU;
  }
  c.last_look = look;
  const n = trunc(Math.max(Math.ceil(dt / 0.008), 1.0));
  const h = dt / n;
  c.pend_v = c.pend_v.add(v2(clamp(dl.x, -0.15, 0.15), clamp(dl.y, -0.15, 0.15)).mul(14.0));
  for (let _i = 0; _i < n; _i++) {
    const a = c.pend.mul(-55.0).sub(c.pend_v.mul(4.5));
    c.pend_v = c.pend_v.add(a.mul(h));
    c.pend = c.pend.add(c.pend_v.mul(h));
  }
  c.pend = v2(clamp(c.pend.x, -0.7, 0.7), clamp(c.pend.y, -0.7, 0.7));
  c.vm_t = Math.min(c.vm_t + dt / 0.22, 1.0);
}

/// Tay đã rảnh (hình cầm tay về lại vũ khí): lần cầm sau lại nâng tay từ dưới lên.
export function clear_vm(g) {
  g.cy.vm_key = null;
}

// ---------- hình cầm tay ----------

/// Mã hình cầm tay khi tay đang bận việc của file này (None: để `fp.rs` vẽ vũ khí).
export function vm_key(g) {
  if (g.cy.toss !== null) {
    return g.cy.toss.key;
  }
  const id = g.held;
  if (id !== null) {
    const kd = kind_of(g, id);
    if (kd === null) return null;
    switch (kd.k) {
      case 'Trash':
        return VM_BASE + id * 64;
      case 'Box':
        return VM_BASE + id * 64 + 1 + Math.min(kd.a.length, 60);
      case 'Corpse':
        return VM_DRAG;
      default:
        return null;
    }
  }
  if (g.cy.sweep_show > 0.0) {
    return VM_BROOM;
  }
  return null;
}

/// Phép đặt vật rác vào khung nắm tay (gốc = lòng nắm tay, +y lên).
function hold_xf(variant) {
  switch (variant) {
    case 0:
      return m4_translate(v3(0.0, -0.36, 0.0));
    case 1:
      return mm(m4_translate(v3(0.0, -0.25, 0.0)), m4_rot_z(Math.PI / 2), m4_translate(v3(0.0, -0.07, 0.0)));
    default:
      return m4_translate(v3(0.0, -0.31, 0.0));
  }
}

export function build_vm(g, key, main, off) {
  const v = v3;
  main.bevel = 0.008;
  off.bevel = 0.008;
  if (key === VM_BROOM && !fp.VM_OPTS.arms) {
    // [ĐỀ XUẤT, chủ dự án 2026-11-16: "đổi chổi thành máy hút bụi sci-fi"] Chỉ đổi hình; luật quét, nhịp, đầu hút bám đống
    // bẩn y như chổi. Ống hút cứng dọc trục y, thân máy + bình chứa phát sáng ở trên, đầu hút bẹt có đèn ở dưới (y -1,2).
    const shell = hex(0xe3b23c), dark = hex(0x2a2c33), chrome = hex(0xc6cad0), glow = hex(0x6fe8ff);
    main.tube(v(0.0, -1.14, 0.0), v(0.0, 0.05, 0.0), 0.021, 0.019, 10, chrome, METAL);
    for (const y of [-0.9, -0.6, -0.3]) main.cyl(v(0.0, y, 0.0), 0.026, 0.026, 0.025, 10, dark, METAL);
    // thân máy: khối bo tròn quanh ống, bình chứa trong suốt phát sáng ở mặt trước, ốc vít, lỗ thoát khí
    main.bevel = 0.02;
    main.cube(v(0.0, 0.0, 0.035), v(0.13, 0.26, 0.11), shell, METAL);
    main.bevel = 0.006;
    main.cube(v(0.0, 0.0, 0.094), v(0.1, 0.2, 0.012), dark, METAL);
    for (let k = 0; k < 4; k++) main.cube(v(0.0, -0.085 + k * 0.012, -0.022), v(0.09, 0.005, 0.006), dark, METAL);
    main.emi = 1.6;
    main.cyl(v(0.0, -0.075, 0.105), 0.032, 0.032, 0.15, 12, glow, FLAT);
    main.emi = 0.0;
    main.cyl(v(0.0, -0.085, 0.105), 0.036, 0.036, 0.014, 12, chrome, METAL);
    main.cyl(v(0.0, 0.075, 0.105), 0.036, 0.036, 0.014, 12, chrome, METAL);
    for (const [x, y] of [[-0.05, 0.11], [0.05, 0.11], [-0.05, -0.11], [0.05, -0.11]]) main.cyl(v(x, y, 0.09), 0.006, 0.006, 0.006, 6, chrome, METAL);
    // rãnh cầm trên cùng
    main.bevel = 0.012;
    main.cube(v(0.0, 0.2, 0.0), v(0.05, 0.12, 0.05), dark, METAL);
    main.cube(v(0.0, 0.27, 0.0), v(0.12, 0.035, 0.05), shell, METAL);
    // đầu hút bẹt: vỏ vàng, mép cao su, dải đèn xanh phía trước, hai bánh xe, khớp xoay
    main.bevel = 0.015;
    main.cube(v(0.0, -1.205, 0.0), v(0.38, 0.06, 0.13), shell, METAL);
    main.bevel = 0.004;
    main.cube(v(0.0, -1.235, 0.0), v(0.39, 0.012, 0.14), hex(0x1c1c1f), FLAT);
    main.emi = 2.2;
    main.cube(v(0.0, -1.2, 0.068), v(0.3, 0.012, 0.006), glow, FLAT);
    main.emi = 0.0;
    for (const x of [-0.17, 0.17]) main.tube(v(x, -1.225, -0.05), v(x + Math.sign(x) * 0.02, -1.225, -0.05), 0.022, 0.022, 10, dark, METAL);
    main.cyl(v(0.0, -1.185, 0.0), 0.04, 0.032, 0.05, 10, dark, METAL);
    main.bevel = 0.008;
    return;
  }
  if (key === VM_BROOM) {
    // Chổi: cán gỗ dọc trục y, đầu chổi bẹt ở dưới, hai tay nắm cán.
    const wood = hex(0x8a6a42);
    main.tube(v(0.0, -1.2, 0.0), v(0.0, 0.3, 0.0), 0.017, 0.016, 8, wood, WOOD);
    main.cyl(v(0.0, 0.3, 0.0), 0.02, 0.014, 0.02, 8, shade(wood, 0.7), WOOD);
    main.cube(v(0.0, -1.2, 0.0), v(0.38, 0.05, 0.075), hex(0x5a3f28), WOOD);
    main.cyl(v(0.0, -1.2, 0.0), 0.026, 0.02, 0.07, 8, hex(0x3c3f42), METAL);
    const r = new Rng(77);
    for (let k = 0; k < 12; k++) {
      const x = -0.17 + k * 0.031;
      for (const z of [-0.022, 0.022]) {
        const splay = [x * 0.5, z * 1.4];
        // Rust evaluates the arguments left to right: range(-0.01,0.01), range(0,0.02), then range(0.75,1.05).
        const ox = r.range(-0.01, 0.01);
        const oy = r.range(0.0, 0.02);
        const k2 = r.range(0.75, 1.05);
        main.tube(v(x, -1.225, z), v(x + splay[0] + ox, -1.36 - oy, z + splay[1]), 0.014, 0.011, 4, shade(hex(0xc9a55a), k2), FLAT);
      }
    }
    fp.arm(main, v(0.0, 0.12, 0.0), v(0.26, 0.42, 0.34), v(0.0, -0.3, -1.0), 1.0);
    fp.arm(off, v(0.0, -0.3, 0.0), v(-0.3, 0.02, 0.36), v(0.0, -0.3, -1.0), -1.0);
    return;
  }
  if (key === VM_DRAG) {
    // Cánh tay phải vươn xuống nắm cổ tay / cổ chân xác (bàn tay ở gốc, khuỷu phía +y).
    fp.arm(main, v3(), v(0.0, 0.78, 0.0), v(0.0, 0.0, -1.0), 1.0);
    return;
  }
  const id = trunc((key - VM_BASE) / 64);
  const kd = kind_of(g, id);
  if (kd !== null && kd.k === 'Box') {
    world.prop_geo(main, { k: 'Box', a: kd.a.slice() }, id);
    fp.arm(main, v(0.3, 0.13, 0.03), v(0.44, -0.16, 0.52), v(-1.0, 0.0, 0.0), 1.0);
    fp.arm(off, v(-0.3, 0.13, 0.03), v(-0.44, -0.16, 0.52), v(1.0, 0.0, 0.0), -1.0);
  } else if (kd !== null && kd.k === 'Trash') {
    const vr = kd.a;
    fp.arm(main, v3(), v(0.13, -0.4, 0.36), v(-1.0, 0.0, -0.2), 1.0);
    off.push(hold_xf(vr));
    world.prop_geo(off, { k: 'Trash', a: vr }, id);
    off.pop();
  } else {
    // Túi đã rời tay (đang bay): chỉ còn cánh tay vung theo đà.
    fp.arm(main, v3(), v(0.13, -0.4, 0.36), v(-1.0, 0.0, -0.2), 1.0);
  }
}

/// Tư thế hai lưới cầm tay trong khung camera. Returns [main, off], each {translation, rotation, scale}.
export function pose(g, key, eye, rot, bob) {
  const c = g.cy;
  if (c.vm_key !== key) {
    // Đổi giữa "đang cầm túi" và "vừa ném túi" không hạ tay xuống.
    if (!(c.toss !== null && c.vm_key !== null)) {
      c.vm_t = 0.0;
    }
    c.vm_key = key;
  }
  let e = 1.0 - c.vm_t;
  e = e * e;
  const bobv = v3(Math.cos(bob * 1.85) * 0.008, Math.sin(bob * 3.7) * 0.01, 0.0);
  const hidden = tr(v3(0.0, -5.0, 0.0), Q_ID.slice());
  const inv = q_inv(rot);
  if (key === VM_BROOM) {
    const right = q_rot(rot, X);
    const flat_r = nor(v3(right.x, 0.0, right.z), X);
    const flat_f = v3(-flat_r.z, 0.0, flat_r.x);
    const ph = c.sweep_phase;
    const head_w = c.sweep_at.add(flat_r.mul(Math.sin(ph) * 0.27)).add(flat_f.mul(Math.cos(ph) * 0.07)).add(Y.mul(0.03 + 0.03 * Math.abs(Math.sin(ph * 2.0))));
    const anchor = v3(0.2, -0.46 - e * 0.5, -0.3);
    let head = q_rot(inv, head_w.sub(eye));
    const d = anchor.sub(head);
    const len = d.length();
    if (len > 1.5) {
      head = anchor.sub(d.div(len).mul(1.5));
    }
    const y = nor(anchor.sub(head), Y);
    const x = nor(X.sub(y.mul(y.x)), X);
    const t = tr(head.add(y.mul(1.37)), q_from_cols(x, y, x.cross(y)));
    return [t, tr(t.translation.clone(), t.rotation.slice())];
  }
  if (key === VM_DRAG) {
    const grip = q_rot(inv, c.hand.sub(eye));
    const shoulder = v3(0.26, -0.22, 0.05);
    const dir = nor(shoulder.sub(grip), Y);
    return [tr(grip, q_arc(Y, dir)), hidden];
  }
  const lift = v3(0.0, -e * 0.45, 0.0);
  if ((key - VM_BASE) % 64 !== 0) {
    // Hộp các-tông: ôm trước bụng, nghiêng về phía mắt để thấy đồ bên trong.
    const t = tr(v3(0.0, -0.5, -0.6).add(bobv).add(lift), q_x(0.55));
    return [t, tr(t.translation.clone(), t.rotation.slice())];
  }
  // Túi rác: xách một tay; ném: thu tay về sau rồi vung tới, thả ở RELEASE.
  let dp = v3(), dr = 0.0;
  let gone = false;
  const t = c.toss;
  if (t !== null) {
    const w = smooth(0.0, 0.12, t.t) * (1.0 - smooth(0.12, RELEASE, t.t));
    const f = smooth(0.12, RELEASE, t.t) * (1.0 - smooth(0.34, TOSS_END, t.t));
    dp = v3(0.05, -0.1, 0.2).mul(w).add(v3(-0.12, 0.22, -0.3).mul(f)).sub(Y.mul(0.5 * smooth(0.4, TOSS_END, t.t)));
    dr = -0.7 * w + 0.95 * f;
    gone = t.released;
  }
  const base = hand_base().add(bobv).add(lift).add(dp);
  const r = q_euler('XYZ', -0.15 + dr, 0.15, -0.1);
  const main = tr(base, r);
  const swing = q_euler('XYZ', c.pend.y * 0.8 - dr * 0.5, 0.0, c.pend.x * 1.2 + Math.sin(bob * 1.85) * 0.05);
  const off = gone ? hidden : tr(base.clone(), swing);
  return [main, off];
}

/// Cho bot: `{bin, cap, fly, toss, thrown, landed, missed, lid, rag:[trạng thái, tốc độ, đầu xyz, chậu xyz, bàn tay nắm xyz], sweep:[đang quét, phần bẩn còn lại, số nhát]}`.
/// Trạng thái ragdoll: 0 không có, 1 đang kéo, 2 đang rơi yên, 3 đã nằm yên.
export function export_(g) {
  const c = g.cy;
  let r = c.rags.find((r) => g.held === r.id);
  if (r === undefined) r = c.rags.length ? c.rags[c.rags.length - 1] : undefined;
  let rag;
  if (r !== undefined) {
    const st = g.held === r.id ? 1 : r.frozen ? 3 : 2;
    const v = (p) => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`;
    rag = `[${st},${r.speed.toFixed(3)},${v(r.p[2])},${v(r.p[0])},${v(r.p[r.grip !== null ? r.grip : 13])}]`;
  } else {
    rag = '[0]';
  }
  return `{"bin":${c.bin.length},"cap":${BIN_CAP},"fly":${c.fly.length},"toss":${c.toss !== null ? 1 : 0},"thrown":${c.thrown},"landed":${c.landed},"missed":${c.missed},"lid":${c.lid.x.toFixed(3)},"rag":${rag},"sweep":[${c.sweep_show > 0.0 ? 1 : 0},${c.sweep_dirt.toFixed(3)},${c.strokes}]}`;
}
export { export_ as export };

/* VIEW NOTES (carry.js) -- meshes are ported (MB), so these are short.
- Skip lid + bags: sync_bin(g, dt, ctx) spawns two 'solid' nodes in BinVis. Lid: hinge at ((SKIP_BOX x mid), 1.3,
  SKIP_BOX z0 + 0.04); rotation q_x(-1.82 + clamp(cy.lid.x, -0.25, 0.9)) (open, tipped back; bounces on lid spring).
  Bags: one mesh rebuilt when cy.bin_rev changes (every frame while a bag is < 0.6 s old or the skip is being emptied):
  each Bag at q.pos with squash sq = 1 - 0.28*exp(-7age)*cos(22age), shrinking/sinking 0.5 m during empty_t (1.2 s).
- Flying bags: world.js asks carry.flying(cy, id) -> [pos, quat] for the prop transform.
- Piles: prop_mesh(cy, p) for 'Pile' returns pile_geo(done = p.aux): 9 grey/brown stains fading with alpha 0.85*left
  and up to 7 rubble chunks vanishing as it is swept.
- Viewmodels: player.js: key = vm_key(g); build_vm(g, key, main, off) builds two MBs (viewmodel); pose(...) returns
  [main, off] transforms {translation, rotation, scale} in camera space (off hidden at y -5 when not used).
  VM_BROOM: broom ~1.5 m, head follows cy.sweep_at swinging +-0.27 m sideways (sweep_phase, 0.62 s per full stroke).
  VM_DRAG: right arm reaching from the shoulder (0.26,-0.22,0.05) down to cy.hand (world point of the grip).
  Box: carried in front of the belly at (0,-0.5,-0.6) tilted 0.55 rad. Trash: hand at (0.36,-0.15,-0.8); bag hangs on
  a pendulum (cy.pend x/y -> roll/pitch); toss swings back 0..0.12 s, forward to RELEASE 0.26 s, drops by 0.56 s.
  Raise-in: lift -0.45*(1-vm_t)^2 m, vm_t reaches 1 in 0.22 s.
- Ragdoll corpse (people/kit are not ported): grab() spawns scene.people.spawn(seed = id*977, 'Base'|'Tumour'|'Hulk',
  pos, {corpse:true, ragdoll:true, scale}) kept in Rag.skin. Whenever world.js rebuilds a live corpse via prop_mesh,
  the person gets update({ragdoll:true, joints, local, origin, particles, scale, frozen, speed, grip}):
    joints   10 column-major Mat4 (world) skin matrices, kit joint order [torso, head, armL, armR, legL, legR,
             forearmL, forearmR, shinL, shinR], each = T(joint pos) * R(frame) * S(scale) * T(-JOINT_POS[k]);
             i.e. exactly what Rust fed Skin::posed (bind -> world). local = same with the prop origin removed.
    particles 15 world points [pelvis, chest, head, shoulderL/R, elbowL/R, handL/R, hipL/R, kneeL/R, footL/R].
  prop_mesh then returns a hidden 0.01 m placeholder so the static corpse mesh is not drawn twice.
  When the corpse prop dies the handle is despawned (JS only; Rust dropped the Skin with the Rag).
PORT GAPS: Skin::posed (CPU skinning) is replaced by the people handle above. corpse_scale replays Look::of's rng in f64
  (Rust f32), so the body scale may differ in the 7th digit. f32 vs f64 arithmetic everywhere (contract).
RUST ODDITIES (ported as-is): none that change rules. lob() can return t up to ~1.44 (loop exits after t > 1.4).
*/
