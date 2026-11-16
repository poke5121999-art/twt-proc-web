// Value-type vectors for the rules layer (a small glam look-alike). Every method returns a NEW vector.
// Shared constants are frozen: storing one into mutable state needs .clone() (writing to a frozen vector throws).
export class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  clone() { return new Vec3(this.x, this.y, this.z); }
  add(o) { return new Vec3(this.x + o.x, this.y + o.y, this.z + o.z); }
  sub(o) { return new Vec3(this.x - o.x, this.y - o.y, this.z - o.z); }
  mul(s) { return new Vec3(this.x * s, this.y * s, this.z * s); }
  div(s) { return new Vec3(this.x / s, this.y / s, this.z / s); }
  mulv(o) { return new Vec3(this.x * o.x, this.y * o.y, this.z * o.z); }
  neg() { return new Vec3(-this.x, -this.y, -this.z); }
  dot(o) { return this.x * o.x + this.y * o.y + this.z * o.z; }
  cross(o) { return new Vec3(this.y * o.z - this.z * o.y, this.z * o.x - this.x * o.z, this.x * o.y - this.y * o.x); }
  length() { return Math.hypot(this.x, this.y, this.z); }
  length_squared() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  distance(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); }
  distance_squared(o) { const a = this.x - o.x, b = this.y - o.y, c = this.z - o.z; return a * a + b * b + c * c; }
  normalize() { const l = this.length(); return new Vec3(this.x / l, this.y / l, this.z / l); }
  normalize_or_zero() { const l = this.length(); return l > 1e-12 && isFinite(l) ? new Vec3(this.x / l, this.y / l, this.z / l) : new Vec3(); }
  lerp(o, t) { return new Vec3(this.x + (o.x - this.x) * t, this.y + (o.y - this.y) * t, this.z + (o.z - this.z) * t); }
  with_x(x) { return new Vec3(x, this.y, this.z); }
  with_y(y) { return new Vec3(this.x, y, this.z); }
  with_z(z) { return new Vec3(this.x, this.y, z); }
  min(o) { return new Vec3(Math.min(this.x, o.x), Math.min(this.y, o.y), Math.min(this.z, o.z)); }
  max(o) { return new Vec3(Math.max(this.x, o.x), Math.max(this.y, o.y), Math.max(this.z, o.z)); }
  abs() { return new Vec3(Math.abs(this.x), Math.abs(this.y), Math.abs(this.z)); }
  xz() { return new Vec2(this.x, this.z); }
  eq(o) { return this.x === o.x && this.y === o.y && this.z === o.z; }
  arr() { return [this.x, this.y, this.z]; }
}
export class Vec2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  clone() { return new Vec2(this.x, this.y); }
  add(o) { return new Vec2(this.x + o.x, this.y + o.y); }
  sub(o) { return new Vec2(this.x - o.x, this.y - o.y); }
  mul(s) { return new Vec2(this.x * s, this.y * s); }
  dot(o) { return this.x * o.x + this.y * o.y; }
  length() { return Math.hypot(this.x, this.y); }
  distance(o) { return Math.hypot(this.x - o.x, this.y - o.y); }
  normalize_or_zero() { const l = this.length(); return l > 1e-12 ? new Vec2(this.x / l, this.y / l) : new Vec2(); }
  lerp(o, t) { return new Vec2(this.x + (o.x - this.x) * t, this.y + (o.y - this.y) * t); }
}
export const v3 = (x = 0, y = 0, z = 0) => new Vec3(x, y, z);
export const v2 = (x = 0, y = 0) => new Vec2(x, y);
/** A frozen constant vector (for tables such as lay.js). */
export const k3 = (x, y, z) => Object.freeze(new Vec3(x, y, z));
export const ZERO = k3(0, 0, 0), ONE = k3(1, 1, 1), X = k3(1, 0, 0), Y = k3(0, 1, 0), Z = k3(0, 0, 1), NEG_X = k3(-1, 0, 0), NEG_Y = k3(0, -1, 0), NEG_Z = k3(0, 0, -1);
/** Quat::from_rotation_y(yaw) * v */
export function rot_y(yaw, v) { const c = Math.cos(yaw), s = Math.sin(yaw); return new Vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }
/** Quat::from_rotation_x(a) * v */
export function rot_x(a, v) { const c = Math.cos(a), s = Math.sin(a); return new Vec3(v.x, c * v.y - s * v.z, s * v.y + c * v.z); }
/** Quat::from_euler(YXZ, yaw, pitch, 0) * v */
export function rot_yx(yaw, pitch, v) { return rot_y(yaw, rot_x(pitch, v)); }
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
/** Rust `as i32` on a float (truncate toward zero, saturating). */
export const trunc = (v) => (isFinite(v) ? Math.trunc(v) : 0);
/** Rust f32::rem_euclid */
export const rem_euclid = (a, b) => ((a % b) + b) % b;
/** Rust f32::signum (never 0) */
export const signum = (v) => (v < 0 || Object.is(v, -0) ? -1 : 1);

// Quaternions as arrays [x, y, z, w] (glam Quat look-alike, all functions return new arrays).
export const Q_ID = Object.freeze([0, 0, 0, 1]);
export const q_x = (a) => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
export const q_y = (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
export const q_z = (a) => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
/** a * b (apply b first, then a), like glam `a * b`. */
export function q_mul(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}
/** Quat::from_euler(EulerRot::YXZ, y, x, z) = q_y(y) * q_x(x) * q_z(z); XYZ = q_x * q_y * q_z; ZYX = q_z * q_y * q_x. */
export function q_euler(order, a, b, c) {
  const f = { X: q_x, Y: q_y, Z: q_z };
  return q_mul(q_mul(f[order[0]](a), f[order[1]](b)), f[order[2]](c));
}
/** quat * vec */
export function q_rot(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v.z - z * v.y), ty = 2 * (z * v.x - x * v.z), tz = 2 * (x * v.y - y * v.x);
  return new Vec3(v.x + w * tx + (y * tz - z * ty), v.y + w * ty + (z * tx - x * tz), v.z + w * tz + (x * ty - y * tx));
}
export function q_slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b; if (d < 0) { d = -d; bb = [-b[0], -b[1], -b[2], -b[3]]; }
  if (d > 0.9995) { const r = [0, 1, 2, 3].map((i) => a[i] + (bb[i] - a[i]) * t); const l = Math.hypot(...r); return r.map((v) => v / l); }
  const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return [0, 1, 2, 3].map((i) => a[i] * wa + bb[i] * wb);
}
/** Quat::to_euler(EulerRot::YXZ) -> [y, x, z] */
export function q_to_euler_yxz(q) {
  const [x, y, z, w] = q;
  const m11 = 1 - 2 * (y * y + z * z), m13 = 2 * (x * z + y * w);
  const m22 = 1 - 2 * (x * x + z * z), m23 = 2 * (y * z - x * w), m21 = 2 * (x * y + z * w);
  const m33 = 1 - 2 * (x * x + y * y), m31 = 2 * (x * z - y * w);
  const ex = Math.asin(-Math.max(-1, Math.min(1, m23)));
  if (Math.abs(m23) < 0.9999999) return [Math.atan2(m13, m33), ex, Math.atan2(m21, m22)];
  return [Math.atan2(-m31, m11), ex, 0];
}
/** Rotation of Transform::looking_to(dir, up): -Z points along dir. */
export function q_look(dir, up = Y) {
  const f = dir.normalize_or_zero(), b = f.neg(); let r = up.cross(b).normalize_or_zero();
  if (r.length_squared() === 0) r = new Vec3(1, 0, 0);
  const u = b.cross(r);
  const m00 = r.x, m01 = u.x, m02 = b.x, m10 = r.y, m11 = u.y, m12 = b.y, m20 = r.z, m21 = u.z, m22 = b.z;
  const tr = m00 + m11 + m22; let x, y, z, w;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = s / 4; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / s; x = s / 4; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / s; x = (m01 + m10) / s; y = s / 4; z = (m12 + m21) / s; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = s / 4; }
  return [x, y, z, w];
}

/** mulberry32, identical to geom.rs Rng (same seeds give the same sequence). */
export class Rng {
  constructor(seed = 0) { this.s = seed >>> 0; }
  static named(name) { let h = 0x811c9dc5; for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i) & 255; h = Math.imul(h, 0x01000193) >>> 0; } return new Rng(h); }
  clone() { return new Rng(this.s); }
  next() {
    this.s = (this.s + 0x6D2B79F5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ ((t + (Math.imul(t ^ (t >>> 7), t | 61) >>> 0)) >>> 0)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.trunc(Math.min(Math.floor((b - a + 1) * this.next()), b - a)); }
  chance(p) { return this.next() < p; }
  pick(xs) { return xs[Math.min(Math.trunc(this.next() * xs.length), xs.length - 1)]; }
}
