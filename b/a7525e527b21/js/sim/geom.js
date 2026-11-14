//! Dựng mesh bằng code: hộp, trụ, nón, quad, gộp thành một mesh có màu đỉnh.
//! UV0.x = mã hoa văn (shader tự vẽ vân theo toạ độ thế giới), UV0.y = độ tự phát sáng.
// Port of src/geom.rs. `build()` returns a plain mesh { p, n, uv, c, i } of typed arrays (see PORT-CONTRACT ADDENDUM).
import { Vec3, Vec2, Y, ZERO, Rng } from './vec.js';

export { Rng };

export const FLAT = 0.0;
export const WOOD = 1.0;
export const CONCRETE = 2.0;
export const ASPHALT = 3.0;
export const BRICK = 4.0;
export const CORRUGATED = 5.0;
export const GROUND = 6.0;
export const PLASTER = 7.0;
export const CARDBOARD = 8.0;
export const SKY = 9.0;
export const GLASS = 10.0;
export const UNLIT = 12.0;
export const STRIPES = 13.0;
export const METAL = 14.0;

const TAU = Math.PI * 2;
const FRAC_PI_2 = Math.PI / 2;

/** Màu sRGB 0xRRGGBB sang tuyến tính. */
export function hex(c) {
  const f = (v) => {
    const s = (v & 255) / 255.0;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return [f(c >>> 16), f(c >>> 8), f(c)];
}

export function shade(c, k) {
  return [c[0] * k, c[1] * k, c[2] * k];
}

// ---------------------------------------------------------------------------------------------------------------
// Mat4 helpers (glam look-alike): column-major arrays of 16, element (row r, col c) at [c * 4 + r].
export function m4_id() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
export const M4_ID = Object.freeze(m4_id());
/** a * b (glam `a * b`: apply b first). */
export function m4_mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}
/** Product of any number of matrices, left to right (m4_chain(a, b, c) = a * b * c). */
export function m4_chain(...ms) { let o = ms[0]; for (let k = 1; k < ms.length; k++) o = m4_mul(o, ms[k]); return o; }
export function m4_translate(v) { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v.x, v.y, v.z, 1]; }
export function m4_rot_x(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; }
export function m4_rot_y(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; }
export function m4_rot_z(a) { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
/** Mat4::from_scale(v); a number gives a uniform scale (Vec3::splat). */
export function m4_scale(v) { if (typeof v === 'number') v = new Vec3(v, v, v); return [v.x, 0, 0, 0, 0, v.y, 0, 0, 0, 0, v.z, 0, 0, 0, 0, 1]; }
/** Mat4::from_quat(q), q = [x, y, z, w]. */
export function m4_from_quat(q) {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  return [1 - (yy + zz), xy + wz, xz - wy, 0, xy - wz, 1 - (xx + zz), yz + wx, 0, xz + wy, yz - wx, 1 - (xx + yy), 0, 0, 0, 0, 1];
}
/** Mat4::from_scale_rotation_translation (T * R * S). `scale` is a Vec3 or a number. */
export function m4_trs(pos, quat, scale) {
  const m = m4_from_quat(quat || [0, 0, 0, 1]);
  const s = scale === undefined || scale === null ? new Vec3(1, 1, 1) : typeof scale === 'number' ? new Vec3(scale, scale, scale) : scale;
  for (let r = 0; r < 3; r++) { m[r] *= s.x; m[4 + r] *= s.y; m[8 + r] *= s.z; }
  if (pos) { m[12] = pos.x; m[13] = pos.y; m[14] = pos.z; }
  return m;
}
/** Mat4::from_rotation_translation(quat, pos). */
export function m4_rot_trans(quat, pos) { return m4_trs(pos, quat, 1); }
/** Mat4::from_cols(x.extend(0), y.extend(0), z.extend(0), w.extend(1)) for Vec3 columns (w is the translation). */
export function m4_from_cols(x, y, z, w) { return [x.x, x.y, x.z, 0, y.x, y.y, y.z, 0, z.x, z.y, z.z, 0, w.x, w.y, w.z, 1]; }
/** Mat4::transform_point3 (affine: w ignored, translation added). */
export function m4_point(m, v) {
  return new Vec3(m[0] * v.x + m[4] * v.y + m[8] * v.z + m[12], m[1] * v.x + m[5] * v.y + m[9] * v.z + m[13], m[2] * v.x + m[6] * v.y + m[10] * v.z + m[14]);
}
/** Mat4::transform_vector3 (no translation). */
export function m4_dir(m, v) {
  return new Vec3(m[0] * v.x + m[4] * v.y + m[8] * v.z, m[1] * v.x + m[5] * v.y + m[9] * v.z, m[2] * v.x + m[6] * v.y + m[10] * v.z);
}
/** Mat4::determinant (full 4x4). */
export function m4_det(m) {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  return b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
}
/** Quat::from_rotation_arc(from, to) (both unit vectors), glam algorithm. */
export function q_rotation_arc(from, to) {
  const dot = from.dot(to);
  if (dot > 1.0 - 1e-6) return [0, 0, 0, 1];
  if (dot < -1.0 + 1e-6) {
    // from_axis_angle(from.any_orthonormal_vector(), PI)
    const sign = from.z < 0 || Object.is(from.z, -0) ? -1 : 1;
    const a = -1.0 / (sign + from.z);
    const b = from.x * from.y * a;
    const ax = new Vec3(b, sign + from.y * from.y * a, -from.y);
    return [ax.x, ax.y, ax.z, Math.cos(Math.PI / 2)];
  }
  const c = from.cross(to);
  const q = [c.x, c.y, c.z, 1.0 + dot];
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
/** Vec3::normalize_or(fallback) */
export function normalize_or(v, fb) {
  const l = v.length();
  const rcp = 1 / l;
  return isFinite(rcp) && rcp > 0 ? v.mul(rcp) : fb;
}

// ---------------------------------------------------------------------------------------------------------------

/** Mức chi tiết hình học theo mức đồ hoạ (0 thấp, 1 vừa, 2 cao): giảm số cạnh của trụ/lathe ở mức thấp. */
export let LOD = 2;
/** LOD.store(n) */
export function set_lod(n) { LOD = n; }

const vtoa = (v) => [v.x, v.y, v.z];
const atov = (a) => new Vec3(a[0], a[1], a[2]);

export class MB {
  constructor() {
    this.p = [];
    this.n = [];
    this.uv = [];
    this.c = [];
    this.i = [];
    this.m = m4_id();
    this.stack = [];
    this.emi = 0.0;
    this.alpha = 1.0;
    /** Bề rộng vát cạnh (m) cho `cube`; 0 là hộp vuông. */
    this.bevel = 0.0;
  }
  push(t) {
    this.stack.push(this.m);
    this.m = m4_mul(this.m, t);
  }
  push_at(pos, yaw) {
    this.push(m4_mul(m4_translate(pos), m4_rot_y(yaw)));
  }
  pop() {
    const m = this.stack.pop();
    this.m = m === undefined ? m4_id() : m;
  }
  /** Mảng thô (vị trí, pháp tuyến, uv = [hoa văn, tự sáng], màu, chỉ số) cho bộ vẽ biểu tượng. */
  raw() {
    return [this.p, this.n, this.uv, this.c, this.i];
  }

  /** Thêm một lưới có sẵn (đã có pháp tuyến, uv, màu), qua phép biến đổi hiện tại. */
  push_raw(p, n, uv, c, i) {
    const base = this.p.length;
    const flip = m4_det(this.m) < 0.0;
    for (let k = 0; k < p.length; k++) {
      this.p.push(vtoa(m4_point(this.m, atov(p[k]))));
      this.n.push(vtoa(m4_dir(this.m, atov(n[k])).normalize_or_zero()));
      this.uv.push(uv[k].slice());
      this.c.push(c[k].slice());
    }
    for (let t = 0; t + 3 <= i.length; t += 3) {
      if (flip) {
        this.i.push(base + i[t], base + i[t + 2], base + i[t + 1]);
      } else {
        this.i.push(base + i[t], base + i[t + 1], base + i[t + 2]);
      }
    }
  }

  is_empty() {
    return this.i.length === 0;
  }

  /** Bốn đỉnh ngược chiều kim đồng hồ nhìn từ mặt trước; pháp tuyến tính từ đỉnh. */
  quad(v, col, pat) {
    const w = v.map((p) => m4_point(this.m, p));
    const n = w[1].sub(w[0]).cross(w[2].sub(w[0])).normalize_or_zero();
    const base = this.p.length;
    for (const p of w) {
      this.p.push(vtoa(p));
      this.n.push(vtoa(n));
      this.uv.push([pat, this.emi]);
      this.c.push([col[0], col[1], col[2], this.alpha]);
    }
    this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  tri(v, col, pat) {
    const w = v.map((p) => m4_point(this.m, p));
    const n = w[1].sub(w[0]).cross(w[2].sub(w[0])).normalize_or_zero();
    const base = this.p.length;
    for (const p of w) {
      this.p.push(vtoa(p));
      this.n.push(vtoa(n));
      this.uv.push([pat, this.emi]);
      this.c.push([col[0], col[1], col[2], this.alpha]);
    }
    this.i.push(base, base + 1, base + 2);
  }

  quad_out(v, center, col, pat) {
    const n = v[1].sub(v[0]).cross(v[2].sub(v[0]));
    if (n.dot(v[0].add(v[2]).mul(0.5).sub(center)) < 0.0) {
      this.quad([v[3], v[2], v[1], v[0]], col, pat);
    } else {
      this.quad(v, col, pat);
    }
  }

  /** Hộp vát cạnh: 6 mặt thụt vào, 12 dải cạnh, 8 góc. Dải cạnh sáng hơn một chút (cạnh mòn bắt sáng). */
  bcube(c, s, col, pat, b) {
    const h = [s.x * 0.5, s.y * 0.5, s.z * 0.5];
    const pt = (sg, ax) => {
      const v = [0.0, 0.0, 0.0];
      for (let j = 0; j < 3; j++) {
        v[j] = sg[j] * (j === ax ? h[j] : h[j] - b);
      }
      return c.add(atov(v));
    };
    const edge = shade(col, 1.22);
    for (let ax = 0; ax < 3; ax++) {
      const a1 = (ax + 1) % 3, a2 = (ax + 2) % 3;
      for (const sgn of [-1.0, 1.0]) {
        const mk = (u, w) => {
          const sg = [0.0, 0.0, 0.0];
          sg[ax] = sgn;
          sg[a1] = u;
          sg[a2] = w;
          return pt(sg, ax);
        };
        const v = [mk(-1.0, -1.0), mk(1.0, -1.0), mk(1.0, 1.0), mk(-1.0, 1.0)];
        this.quad_out(v, c, col, pat);
      }
      for (const s1 of [-1.0, 1.0]) {
        for (const s2 of [-1.0, 1.0]) {
          const mk = (t, face) => {
            const sg = [0.0, 0.0, 0.0];
            sg[ax] = t;
            sg[a1] = s1;
            sg[a2] = s2;
            return pt(sg, face);
          };
          const v = [mk(-1.0, a1), mk(1.0, a1), mk(1.0, a2), mk(-1.0, a2)];
          this.quad_out(v, c, edge, pat);
        }
      }
    }
    for (const sx of [-1.0, 1.0]) {
      for (const sy of [-1.0, 1.0]) {
        for (const sz of [-1.0, 1.0]) {
          const sg = [sx, sy, sz];
          const a = pt(sg, 0), bb = pt(sg, 1), cc = pt(sg, 2);
          if (bb.sub(a).cross(cc.sub(a)).dot(a.sub(c)) < 0.0) {
            this.tri([a, cc, bb], edge, pat);
          } else {
            this.tri([a, bb, cc], edge, pat);
          }
        }
      }
    }
  }

  /** Sprite mờ dần ra mép: quạt `seg` cánh quanh tâm, cho hạt và quầng sáng. */
  sprite(c, right, up, col, a, emi, seg) {
    const base = this.p.length;
    this.p.push(vtoa(c));
    this.n.push([0.0, 1.0, 0.0]);
    this.uv.push([UNLIT, emi]);
    this.c.push([col[0], col[1], col[2], a]);
    for (let k = 0; k < seg; k++) {
      const ang = ((k + 0.5) / seg) * TAU;
      const p = c.add(right.mul(Math.cos(ang) * 1.4)).add(up.mul(Math.sin(ang) * 1.4));
      this.p.push(vtoa(p));
      this.n.push([0.0, 1.0, 0.0]);
      this.uv.push([UNLIT, emi]);
      this.c.push([col[0], col[1], col[2], 0.0]);
    }
    for (let k = 0; k < seg; k++) {
      this.i.push(base, base + 1 + k, base + 1 + ((k + 1) % seg));
      this.i.push(base, base + 1 + ((k + 1) % seg), base + 1 + k);
    }
  }

  /** Vệt mảnh (mưa, tia lửa): từ `c` kéo ngược theo `d`, đuôi mờ. */
  streak(c, d, side, col, a, emi) {
    const base = this.p.length;
    for (const [p, al] of [[c.sub(side), a], [c.add(side), a], [c.sub(d).add(side), 0.0], [c.sub(d).sub(side), 0.0]]) {
      this.p.push(vtoa(p));
      this.n.push([0.0, 1.0, 0.0]);
      this.uv.push([UNLIT, emi]);
      this.c.push([col[0], col[1], col[2], al]);
    }
    this.i.push(base, base + 1, base + 2, base, base + 2, base + 3, base, base + 2, base + 1, base, base + 3, base + 2);
  }

  /** Hộp theo tâm và kích thước. */
  cube(c, s, col, pat) {
    if (this.bevel > 0.0 && Math.min(s.x, s.y, s.z) > this.bevel * 3.0) {
      const b = this.bevel;
      return this.bcube(c, s, col, pat, b);
    }
    const h = s.mul(0.5);
    const x = h.x, y = h.y, z = h.z;
    const v = (a, b, d) => c.add(new Vec3(a, b, d));
    this.quad([v(x, -y, -z), v(x, y, -z), v(x, y, z), v(x, -y, z)], col, pat);
    this.quad([v(-x, -y, z), v(-x, y, z), v(-x, y, -z), v(-x, -y, -z)], col, pat);
    this.quad([v(-x, y, -z), v(-x, y, z), v(x, y, z), v(x, y, -z)], col, pat);
    this.quad([v(-x, -y, z), v(-x, -y, -z), v(x, -y, -z), v(x, -y, z)], col, pat);
    this.quad([v(-x, -y, z), v(x, -y, z), v(x, y, z), v(-x, y, z)], col, pat);
    this.quad([v(x, -y, -z), v(-x, -y, -z), v(-x, y, -z), v(x, y, -z)], col, pat);
  }

  /** Hộp theo góc nhỏ nhất và kích thước. */
  block(min, s, col, pat) {
    this.cube(min.add(s.mul(0.5)), s, col, pat);
  }

  /** Hộp xoay quanh trục Y tại tâm. */
  cube_yaw(c, s, yaw, col, pat) {
    this.push_at(c, yaw);
    this.cube(ZERO, s, col, pat);
    this.pop();
  }

  /** Trụ/nón cụt đứng: đáy tại `base`, bán kính dưới r0, trên r1. */
  cyl(base, r0, r1, h, seg, col, pat) {
    const top = base.add(Y.mul(h));
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * TAU;
      const a1 = ((k + 1) / seg) * TAU;
      const d0 = new Vec3(Math.cos(a0), 0.0, Math.sin(a0));
      const d1 = new Vec3(Math.cos(a1), 0.0, Math.sin(a1));
      // Mặt bên (nhìn từ ngoài: ngược chiều kim đồng hồ).
      this.quad([base.add(d1.mul(r0)), base.add(d0.mul(r0)), top.add(d0.mul(r1)), top.add(d1.mul(r1))], col, pat);
      if (r1 > 0.001) {
        this.tri([top, top.add(d1.mul(r1)), top.add(d0.mul(r1))], col, pat);
      }
      if (r0 > 0.001) {
        this.tri([base, base.add(d0.mul(r0)), base.add(d1.mul(r0))], col, pat);
      }
    }
  }

  /** Quad nằm ngang nhìn lên (decal sàn), tâm c, kích thước sx × sz. */
  floor_quad(c, sx, sz, col, pat) {
    const x = sx * 0.5, z = sz * 0.5;
    this.quad([c.add(new Vec3(-x, 0.0, -z)), c.add(new Vec3(-x, 0.0, z)), c.add(new Vec3(x, 0.0, z)), c.add(new Vec3(x, 0.0, -z))], col, pat);
  }

  /** Đĩa mờ dần ra mép (bóng đổ giả dưới chân nhân vật). */
  blob(c, r, a) {
    const seg = 12;
    const base = this.p.length;
    const cw = m4_point(this.m, c);
    this.p.push(vtoa(cw));
    this.n.push([0.0, 1.0, 0.0]);
    this.uv.push([UNLIT, 0.0]);
    this.c.push([0.0, 0.0, 0.0, a]);
    for (let k = 0; k < seg; k++) {
      const ang = (k / seg) * TAU;
      const p = m4_point(this.m, c.add(new Vec3(Math.cos(ang) * r, 0.0, Math.sin(ang) * r)));
      this.p.push(vtoa(p));
      this.n.push([0.0, 1.0, 0.0]);
      this.uv.push([UNLIT, 0.0]);
      this.c.push([0.0, 0.0, 0.0, 0.0]);
    }
    for (let k = 0; k < seg; k++) {
      const a1 = base + 1 + k;
      const a2 = base + 1 + ((k + 1) % seg);
      this.i.push(base, a2, a1);
    }
  }

  /** Vòm trời: nửa cầu nhìn từ trong. */
  dome(r) {
    const rings = 8, seg = 20;
    for (let j = 0; j < rings; j++) {
      const t0 = -0.15 + (j / rings) * (FRAC_PI_2 + 0.15);
      const t1 = -0.15 + ((j + 1) / rings) * (FRAC_PI_2 + 0.15);
      for (let k = 0; k < seg; k++) {
        const a0 = (k / seg) * TAU;
        const a1 = ((k + 1) / seg) * TAU;
        const p = (t, a) => new Vec3(Math.cos(t) * Math.cos(a), Math.sin(t), Math.cos(t) * Math.sin(a)).mul(r);
        // Nhìn từ trong ra nên đảo chiều.
        this.quad([p(t0, a0), p(t0, a1), p(t1, a1), p(t1, a0)], [1.0, 1.0, 1.0], SKY);
      }
    }
  }

  /** Ghép một mesh khác vào, qua phép biến đổi `m` (trong hệ hiện tại). */
  append(o, m) {
    const t = m4_mul(this.m, m);
    const base = this.p.length;
    for (let k = 0; k < o.p.length; k++) {
      this.p.push(vtoa(m4_point(t, atov(o.p[k]))));
      this.n.push(vtoa(m4_dir(t, atov(o.n[k])).normalize_or_zero()));
      this.uv.push(o.uv[k].slice());
      this.c.push(o.c[k].slice());
    }
    for (const i of o.i) this.i.push(i + base);
  }

  vert_count() {
    return this.p.length;
  }

  /** Mesh có số đỉnh và số chỉ mục cố định (đệm bằng tam giác suy biến), để mesh dựng lại mỗi khung hình
   *  luôn cùng cỡ và bộ cấp phát buffer dùng lại đúng chỗ cũ. */
  build_fixed(nv, ni) {
    const resize = (arr, len, fill) => {
      if (arr.length > len) arr.length = len;
      while (arr.length < len) arr.push(fill.slice());
    };
    resize(this.p, nv, [0.0, -50.0, 0.0]);
    resize(this.n, nv, [0.0, 1.0, 0.0]);
    resize(this.uv, nv, [UNLIT, 0.0]);
    resize(this.c, nv, [0.0, 0.0, 0.0, 0.0]);
    this.i = this.i.filter((i) => i < nv);
    const whole = Math.trunc(this.i.length / 3) * 3;
    this.i.length = Math.min(whole, ni);
    while (this.i.length < ni) this.i.push(0);
    return this.build();
  }

  /** Plain mesh { p: Float32Array(3n), n: Float32Array(3n), uv: Float32Array(2n), c: Float32Array(4n), i: Uint32Array }. */
  build() {
    const nv = this.p.length;
    const p = new Float32Array(nv * 3), n = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), c = new Float32Array(nv * 4);
    for (let k = 0; k < nv; k++) {
      const a = this.p[k], b = this.n[k], u = this.uv[k], q = this.c[k];
      p[k * 3] = a[0]; p[k * 3 + 1] = a[1]; p[k * 3 + 2] = a[2];
      n[k * 3] = b[0]; n[k * 3 + 1] = b[1]; n[k * 3 + 2] = b[2];
      uv[k * 2] = u[0]; uv[k * 2 + 1] = u[1];
      c[k * 4] = q[0]; c[k * 4 + 1] = q[1]; c[k * 4 + 2] = q[2]; c[k * 4 + 3] = q[3];
    }
    return { p, n, uv, c, i: Uint32Array.from(this.i) };
  }

  // ---- Bộ dựng prop: lathe, ống, viên nang, cầu, quét theo đường, đùn đa giác. Pháp tuyến mượt quanh trục. ----

  seg(n) {
    switch (LOD) {
      case 0: return Math.max(Math.trunc(n / 2), 6);
      case 1: return Math.max(Math.trunc((n * 3) / 4), 8);
      default: return n;
    }
  }

  vert(p, n, col, pat) {
    const w = m4_point(this.m, p);
    const nn = m4_dir(this.m, n).normalize_or_zero();
    this.p.push(vtoa(w));
    this.n.push(vtoa(nn));
    this.uv.push([pat, this.emi]);
    this.c.push([col[0], col[1], col[2], this.alpha]);
    return this.p.length - 1;
  }

  /** Tiện tròn quanh trục Y cục bộ tại `base`: `prof` là các điểm [bán kính, cao] từ dưới lên.
   *  `smooth` làm mượt pháp tuyến giữa các đai (thân người, lốp); tắt để giữ gờ sắc (thùng, vành). */
  lathe(base, prof, seg_in, smooth, col, pat) {
    const seg = this.seg(seg_in);
    const nb = prof.length - 1;
    const band = [];
    for (let j = 0; j < nb; j++) {
      const dr = prof[j + 1][0] - prof[j][0], dy = prof[j + 1][1] - prof[j][1];
      const l = Math.max(Math.sqrt(dr * dr + dy * dy), 1e-6);
      band.push([dy / l, -dr / l]);
    }
    const avg = (a, b) => {
      const x = a[0] + b[0], y = a[1] + b[1];
      const l = Math.max(Math.sqrt(x * x + y * y), 1e-6);
      return [x / l, y / l];
    };
    for (let j = 0; j < nb; j++) {
      const [r0, y0] = prof[j];
      const [r1, y1] = prof[j + 1];
      const n0 = smooth && j > 0 ? avg(band[j - 1], band[j]) : band[j];
      const n1 = smooth && j + 1 < nb ? avg(band[j], band[j + 1]) : band[j];
      for (let k = 0; k < seg; k++) {
        const a0 = (k / seg) * TAU;
        const a1 = ((k + 1) / seg) * TAU;
        const d0 = new Vec3(Math.cos(a0), 0.0, Math.sin(a0));
        const d1 = new Vec3(Math.cos(a1), 0.0, Math.sin(a1));
        const v10 = this.vert(base.add(d1.mul(r0)).add(Y.mul(y0)), d1.mul(n0[0]).add(Y.mul(n0[1])), col, pat);
        const v00 = this.vert(base.add(d0.mul(r0)).add(Y.mul(y0)), d0.mul(n0[0]).add(Y.mul(n0[1])), col, pat);
        const v01 = this.vert(base.add(d0.mul(r1)).add(Y.mul(y1)), d0.mul(n1[0]).add(Y.mul(n1[1])), col, pat);
        const v11 = this.vert(base.add(d1.mul(r1)).add(Y.mul(y1)), d1.mul(n1[0]).add(Y.mul(n1[1])), col, pat);
        if (r0 > 0.0005) {
          this.i.push(v10, v00, v01);
        }
        if (r1 > 0.0005) {
          this.i.push(v10, v01, v11);
        }
      }
    }
  }

  /** Đặt hệ toạ độ cục bộ: gốc tại `a`, trục Y hướng về `b`. */
  push_axis(a, b) {
    const d = normalize_or(b.sub(a), Y);
    this.push(m4_rot_trans(q_rotation_arc(Y, d), a));
  }

  /** Ống / nón cụt giữa hai điểm, có nắp. */
  tube(a, b, r0, r1, seg, col, pat) {
    const h = b.sub(a).length();
    this.push_axis(a, b);
    this.lathe(ZERO, [[0.0, 0.0], [r0, 0.0], [r1, h], [0.0, h]], seg, false, col, pat);
    this.pop();
  }

  /** Viên nang thuôn (chi người): hai đầu bo tròn. */
  capsule(a, b, r0, r1, seg, col, pat) {
    const h = b.sub(a).length();
    this.push_axis(a, b);
    const prof = [
      [0.0, -r0],
      [r0 * 0.7, -r0 * 0.7],
      [r0, 0.0],
      [r1, h],
      [r1 * 0.7, h + r1 * 0.7],
      [0.0, h + r1],
    ];
    this.lathe(ZERO, prof, seg, true, col, pat);
    this.pop();
  }

  /** Khối cầu dẹt (ellipsoid) bán kính `r` theo từng trục. */
  ball(c, r, seg, col, pat) {
    this.push(m4_mul(m4_translate(c), m4_scale(r)));
    const prof = [];
    for (let k = 0; k <= 6; k++) {
      const t = -FRAC_PI_2 + (k / 6.0) * Math.PI;
      prof.push([Math.max(Math.cos(t), 0.0), Math.sin(t)]);
    }
    this.lathe(ZERO, prof, seg, true, col, pat);
    this.pop();
  }

  /** Quét ống theo đường gấp khúc (dây điện, ống nước, tay vịn). */
  sweep(path, r, seg, col, pat) {
    for (let k = 0; k + 1 < path.length; k++) {
      this.tube(path[k], path[k + 1], r, r, seg, col, pat);
    }
  }

  /** Đùn một đa giác lồi (trong mặt phẳng XY cục bộ) từ z0 tới z1, có hai nắp. */
  extrude(poly, z0, z1, col, pat) {
    const n = poly.length;
    let c2 = new Vec2(0, 0);
    for (const p of poly) {
      c2 = c2.add(new Vec2(p.x / n, p.y / n));
    }
    const center = new Vec3(c2.x, c2.y, (z0 + z1) * 0.5);
    for (let k = 0; k < n; k++) {
      const a = poly[k], b = poly[(k + 1) % n];
      this.quad_out([new Vec3(a.x, a.y, z0), new Vec3(b.x, b.y, z0), new Vec3(b.x, b.y, z1), new Vec3(a.x, a.y, z1)], center, col, pat);
    }
    for (const z of [z0, z1]) {
      for (let k = 1; k < n - 1; k++) {
        const v = [new Vec3(poly[0].x, poly[0].y, z), new Vec3(poly[k].x, poly[k].y, z), new Vec3(poly[k + 1].x, poly[k + 1].y, z)];
        if (v[1].sub(v[0]).cross(v[2].sub(v[0])).z * (z - center.z) < 0.0) {
          this.tri([v[0], v[2], v[1]], col, pat);
        } else {
          this.tri(v, col, pat);
        }
      }
    }
  }
}

