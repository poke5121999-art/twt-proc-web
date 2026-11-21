// Port of src/fx.rs.
//! Hạt và quầng sáng: bụi tro lơ lửng, mưa, máu, tia lửa, mảnh vụn, khói, nổ, quầng đèn.
//! Tất cả là sprite quay về camera, gộp vào một mesh dựng lại mỗi khung hình (material trong suốt, không chiếu sáng).

import { v3, ZERO, ONE, X, Y, Rng, clamp, q_rot } from './vec.js';
import { MB, UNLIT } from './geom.js';
import * as lay from './lay.js';
import * as mat from './mat.js';
import * as scene from './scene.js';

/** Cỡ cố định của mesh hạt (xem `MB::build_fixed`). */
export const MAX_V = 8192;
export const MAX_I = 36864;

export const FX_BLOOD = 0;
export const FX_SPARK = 1;
export const FX_DEBRIS = 2;
export const FX_DUST = 3;
export const FX_SMOKE = 4;
export const FX_BOOM = 5;
/** Khói súng (cụm nhỏ tan nhanh ở đầu nòng) và đuôi khói tên lửa (xám sáng, tan chậm). */
export const FX_PUFF = 6;
export const FX_TRAIL = 7;
/** Chỗ nổ của lựu đạn / bom đinh (chỉ để hiện, plug/fxaudio.js): gốc clip 19 21:12-21:14 là cụm khói đa giác vàng trắng, không khói xám xanh. */
export const YELLOW_BOOMS = [];

/** struct Part: mỗi hạt có pos/vel riêng (clone), vì cập nhật ghi từng thành phần tại chỗ. */
function part(base, over) {
  const p = Object.assign({}, base, over);
  p.pos = p.pos.clone();
  p.vel = p.vel.clone();
  return p;
}

export class Parts {
  constructor() {
    this.list = [];
    this.rng = new Rng(0x5eed1234);
    /** Rust giữ Handle<Mesh>; ở đây là node scene của mesh hạt (null tới khung đầu). */
    this.mesh = null;
    this.ambient = 0;
  }

  burst(kind, at, amb) {
    const r = this.rng;
    const dir = (r, up) => v3(r.range(-1.0, 1.0), r.range(-0.2, 1.0) + up, r.range(-1.0, 1.0)).normalize_or_zero();
    const add = (list, p) => {
      if (list.length < 900) {
        list.push(p);
      }
    };
    const base = { pos: at, vel: ZERO, life: 1.0, max: 1.0, size: 0.03, col: ONE, a: 1.0, grav: 9.0, drag: 0.5, emi: 0.0, streak: false, lit: true, grow: 0.0 };
    switch (kind) {
      case FX_BLOOD:
        for (let i = 0; i < 12; i++) {
          const l = r.range(0.35, 0.7);
          const v = dir(r, 0.3).mul(r.range(1.0, 3.2));
          add(this.list, part(base, { vel: v, life: l, max: l, size: r.range(0.025, 0.06), col: v3(0.32, 0.015, 0.012) }));
        }
        break;
      case FX_SPARK:
        for (let i = 0; i < 10; i++) {
          const l = r.range(0.2, 0.45);
          const v = dir(r, 0.4).mul(r.range(2.0, 5.5));
          add(this.list, part(base, { vel: v, life: l, max: l, size: 0.02, col: v3(1.0, 0.62, 0.2), emi: 1.0, streak: true, lit: false }));
        }
        break;
      case FX_DEBRIS:
        for (let i = 0; i < 14; i++) {
          const l = r.range(0.7, 1.4);
          const v = dir(r, 0.5).mul(r.range(1.0, 4.0));
          const c = r.range(0.5, 1.0);
          add(this.list, part(base, { vel: v, life: l, max: l, size: r.range(0.02, 0.05), col: v3(0.3, 0.2, 0.12).mul(c) }));
        }
        for (let i = 0; i < 4; i++) {
          const l = r.range(0.8, 1.4);
          add(this.list, part(base, { vel: dir(r, 0.2).mul(0.5), life: l, max: l, size: r.range(0.15, 0.3), col: amb.mul(0.8).add(v3(0.1, 0.1, 0.1)), a: 0.3, grav: -0.2, drag: 2.0, grow: 0.3 }));
        }
        break;
      case FX_DUST:
        for (let i = 0; i < 9; i++) {
          const l = r.range(0.8, 1.5);
          add(this.list, part(base, { vel: dir(r, 0.1).mul(r.range(0.3, 0.9)), life: l, max: l, size: r.range(0.12, 0.28), col: v3(0.5, 0.46, 0.4), a: 0.28, grav: -0.15, drag: 2.5, grow: 0.25 }));
        }
        break;
      case FX_SMOKE:
        for (let i = 0; i < 10; i++) {
          const l = r.range(1.2, 2.2);
          add(this.list, part(base, { vel: dir(r, 0.6).mul(r.range(0.3, 0.9)), life: l, max: l, size: r.range(0.22, 0.45), col: v3(0.1, 0.1, 0.09), a: 0.4, grav: -0.5, drag: 1.5, grow: 0.35 }));
        }
        for (let i = 0; i < 8; i++) {
          const l = r.range(0.4, 0.8);
          add(this.list, part(base, { vel: dir(r, 0.5).mul(r.range(1.0, 2.5)), life: l, max: l, size: r.range(0.03, 0.06), col: v3(0.3, 0.02, 0.015) }));
        }
        break;
      case FX_PUFF:
        for (let i = 0; i < 3; i++) {
          const l = r.range(0.35, 0.7);
          add(this.list, part(base, { vel: dir(r, 0.2).mul(r.range(0.2, 0.7)), life: l, max: l, size: r.range(0.05, 0.11), col: v3(0.62, 0.62, 0.6), a: 0.22, grav: -0.6, drag: 3.0, grow: 0.5 }));
        }
        break;
      case FX_TRAIL:
        for (let i = 0; i < 2; i++) {
          const l = r.range(0.9, 1.6);
          add(this.list, part(base, { vel: dir(r, 0.3).mul(r.range(0.1, 0.5)), life: l, max: l, size: r.range(0.14, 0.24), col: v3(0.72, 0.72, 0.7), a: 0.42, grav: -0.25, drag: 2.0, grow: 0.45 }));
        }
        break;
      default:
        for (let i = 0; i < 34; i++) {
          const l = r.range(0.3, 0.8);
          add(this.list, part(base, { vel: dir(r, 0.3).mul(r.range(3.0, 9.0)), life: l, max: l, size: 0.03, col: v3(1.0, 0.55, 0.15), emi: 1.0, streak: true, lit: false }));
        }
        for (let i = 0; i < 8; i++) {
          const l = r.range(0.25, 0.5);
          add(this.list, part(base, { vel: dir(r, 0.2).mul(1.5), life: l, max: l, size: r.range(0.5, 0.9), col: v3(1.0, 0.5, 0.12), a: 0.7, emi: 1.0, grav: -1.0, drag: 3.0, lit: false, grow: 1.5 }));
        }
        for (let i = 0; i < 14; i++) {
          const l = r.range(1.5, 2.8);
          add(this.list, part(base, { vel: dir(r, 0.6).mul(r.range(0.5, 2.0)), life: l, max: l, size: r.range(0.4, 0.8), col: v3(0.07, 0.065, 0.06), a: 0.5, grav: -0.6, drag: 1.2, grow: 0.5 }));
        }
        break;
    }
  }
}

/** Quầng đèn tĩnh: (vị trí, màu, bán kính, chỉ ban đêm). */
export function glows() {
  const g = [];
  for (const [x, z, t] of lay.LAMPS) {
    g.push([[x, 5.5, z + t * 1.25], [1.0, 0.82, 0.5], 1.6, true]);
  }
  g.push([[lay.DOOR.x, 2.55, lay.DOOR.z + 0.3], [1.0, 0.7, 0.3], 0.9, false]);
  for (const [x, segs] of lay.BARRIERS) {
    g.push([[x, 2.5, segs[0][1] - 0.1], [1.0, 0.12, 0.08], 0.7, false]);
    g.push([[x, 2.5, segs[1][0] + 0.1], [1.0, 0.12, 0.08], 0.7, false]);
  }
  g.push([[lay.DOOR.x, 4.05, lay.DOOR.z + 0.175], [1.0, 0.75, 0.25], 2.4, true]);
  g.push([[lay.TILL.x, 1.25, lay.TILL.z], [0.2, 1.0, 0.45], 0.5, false]);
  return g;
}

export function inside_building(p) {
  return lay.inside(lay.BUILDING, p) && p.y < 3.5;
}

/**
 * fx_system(g, dt, ctx)
 *   ctx.cam     = { pos: Vec3, quat: [x,y,z,w] }  camera GlobalTransform (Rust: Query<&GlobalTransform, With<Camera3d>>)
 *   ctx.fx      = mat.Fx resource, ctx.quality = mat.Quality resource
 *   ctx.parts   = Parts resource (this module)
 *   ctx.elapsed = time.elapsed_secs()
 */
export function fx_system(g, dt_in, ctx) {
  const cam = ctx.cam;
  if (!cam || !cam.pos) return;
  const fx = ctx.fx, quality = ctx.quality, parts = ctx.parts;
  const elapsed = ctx.elapsed || 0;
  const dt = Math.min(dt_in, 0.05);
  const eye = cam.pos;
  const q = cam.quat || [0, 0, 0, 1];
  const right = q_rot(q, X);
  const up = q_rot(q, Y);
  const tier = quality.tier;
  const amb = fx.ambient.min(v3(1.2, 1.2, 1.2));
  const events = g.fxq.splice(0, g.fxq.length);
  for (const [k, at] of events) {
    parts.burst(k, at, amb);
  }
  // Tro bụi lơ lửng quanh người chơi.
  const want = [36, 110, 200][tier];
  while (parts.ambient < want) {
    const r = parts.rng;
    const p = eye.add(v3(r.range(-11.0, 11.0), r.range(-1.5, 4.5), r.range(-11.0, 11.0)));
    const l = r.range(5.0, 10.0);
    const v = v3(r.range(0.1, 0.5), r.range(-0.12, 0.08), r.range(-0.2, 0.2));
    const s = r.range(0.012, 0.03);
    const a = r.range(0.25, 0.6);
    parts.list.push({ pos: v3(p.x, Math.max(p.y, 0.1), p.z), vel: v, life: l, max: l, size: s, col: v3(0.85, 0.82, 0.75), a, grav: 0.0, drag: 0.0, emi: 0.0, streak: false, lit: true, grow: -1.0 });
    parts.ambient += 1;
  }
  // Mưa theo Saltline (`Gw`, e-fx-rain): vệt rơi trong hộp 26 x 15 x 26 m quanh mắt, vận tốc (-2,6; -9,4; 1,1) m/s nhân
  // 0,82..1,18 mỗi giọt, dài 0,03 x |v|, mảnh 5..9 mm, mờ khi sát mắt (dưới 2,6 m); hạt bắn tung toé trên mặt đất (vành + 2
  // giọt văng, 0,26..0,40 s); dòng nước nhỏ giọt từ mép mái hiên quán. Mức thấp vẫn có mưa (mật độ 0,5 như Saltline).
  if (fx.rain > 0.03) {
    const k = fx.rain;
    const n = Math.trunc(k * [4.0, 8.0, 12.0][tier]);
    for (let i = 0; i < n; i++) {
      const r = parts.rng;
      const p = eye.add(v3(r.range(-13.0, 13.0), r.range(1.0, 9.0), r.range(-13.0, 13.0)));
      if (inside_building(p.sub(Y.mul(4.0))) && p.y < 4.0) {
        continue;
      }
      const dz = p.sub(eye);
      if (dz.x * dz.x + dz.z * dz.z < 2.6 * 2.6 && r.range(0.0, 1.0) < 0.7) {
        continue;
      }
      const sp = r.range(0.82, 1.18);
      const l = r.range(0.7, 1.0);
      const a = r.range(0.14, 0.3);
      parts.list.push({ pos: p, vel: v3(-2.6, -9.4, 1.1).mul(sp), life: l, max: l, size: r.range(0.005, 0.009), col: v3(0.72, 0.8, 0.9), a, grav: 0.0, drag: 0.0, emi: 0.0, streak: true, lit: true, grow: -2.0 });
    }
    // Hạt bắn trên mặt đất ngoài trời trong 8 m.
    const ns = Math.trunc(k * [1.0, 3.0, 5.0][tier]);
    for (let i = 0; i < ns; i++) {
      const r = parts.rng;
      const p = v3(eye.x + r.range(-8.0, 8.0), 0.03, eye.z + r.range(-8.0, 8.0));
      if (inside_building(p.add(Y))) {
        continue;
      }
      const l = r.range(0.26, 0.4);
      parts.list.push({ pos: p.clone(), vel: v3(0, 0, 0), life: l * 0.5, max: l * 0.5, size: r.range(0.02, 0.04), col: v3(0.8, 0.86, 0.95), a: 0.35, grav: 0.0, drag: 0.0, emi: 0.0, streak: false, lit: true, grow: 0.12 });
      for (let j = 0; j < 2; j++) {
        const v = v3(r.range(-0.6, 0.6), r.range(0.8, 1.6), r.range(-0.6, 0.6));
        parts.list.push({ pos: p.clone(), vel: v, life: l, max: l, size: 0.006, col: v3(0.8, 0.86, 0.95), a: 0.4, grav: 9.0, drag: 0.0, emi: 0.0, streak: true, lit: true, grow: -2.0 });
      }
    }
    // Mép mái hiên quán: những dòng nhỏ giọt rơi tự do 3 m.
    const nd = Math.trunc(k * [1.0, 2.0, 3.0][tier]);
    const x0 = lay.INSIDE_MIN.x + 0.3, x1 = lay.INSIDE_MAX.x - 0.3;
    for (let i = 0; i < nd; i++) {
      const r = parts.rng;
      // Giọt rơi ở một trong 24 điểm cố định dọc mép (nước chảy theo rãnh tôn), không rải đều.
      const slot = Math.floor(r.range(0.0, 24.0));
      const x = x0 + ((x1 - x0) * (slot + 0.5)) / 24.0;
      const p = v3(x, 3.15, lay.INSIDE_MAX.z + 0.55);
      if (p.distance_squared(eye) > 400.0) {
        continue;
      }
      const l = 0.8;
      parts.list.push({ pos: p, vel: v3(0.0, -1.0, 0.0), life: l, max: l, size: 0.006, col: v3(0.75, 0.82, 0.92), a: 0.45, grav: 9.8, drag: 0.0, emi: 0.0, streak: true, lit: true, grow: -2.0 });
    }
  }
  // Cập nhật.
  let ambient = 0;
  parts.list = parts.list.filter((p) => {
    p.life -= dt;
    p.vel.y -= p.grav * dt;
    p.vel = p.vel.mul(1.0 - Math.min(p.drag * dt, 0.9));
    p.pos = p.pos.add(p.vel.mul(dt));
    if (p.grow > 0.0) {
      p.size += p.grow * dt;
    }
    if (p.grow === -2.0 && (p.pos.y < 0.03 || inside_building(p.pos))) {
      return false;
    }
    if (p.pos.y < 0.02 && p.grav > 0.0) {
      p.pos.y = 0.02;
      p.vel = v3(0, 0, 0);
    }
    const keep = p.life > 0.0 && (p.grow !== -1.0 || p.pos.distance_squared(eye) < 200.0);
    if (keep && p.grow === -1.0) {
      ambient += 1;
    }
    return keep;
  });
  parts.ambient = ambient;

  const mb = new MB();
  mb.tri([v3(0.0, -50.0, 0.0), v3(0.01, -50.0, 0.0), v3(0.0, -50.0, 0.01)], [0.0, 0.0, 0.0], UNLIT);
  for (const p of parts.list) {
    if (mb.vert_count() > MAX_V - 400) {
      break;
    }
    const t = clamp(p.life / p.max, 0.0, 1.0);
    const fade = p.grow === -1.0 ? Math.min(t * 4.0, 1.0) * Math.min((1.0 - t) * 4.0, 1.0) : Math.sqrt(t);
    const c = p.lit ? p.col.mulv(amb) : p.col;
    if (p.streak) {
      const d = p.vel.normalize_or_zero().mul(clamp(p.vel.length() * 0.035, 0.05, 0.6));
      mb.streak(p.pos, d, right.mul(p.size), c.arr(), p.a * fade, p.emi);
    } else {
      mb.sprite(p.pos, right.mul(p.size), up.mul(p.size), c.arr(), p.a * fade, p.emi, 4);
    }
  }
  // Quầng đèn: thay cho bloom, sáng hơn về đêm.
  const night = mat.night_factor(g.hour());
  for (const [pos, col, rad, night_only] of glows()) {
    const k = night_only ? night : 0.35 + 0.65 * night;
    if (k > 0.02) {
      const p = v3(pos[0], pos[1], pos[2]);
      const pulse = 1.0 + 0.05 * Math.sin(elapsed * 9.0 + p.x);
      mb.sprite(p, right.mul(rad * pulse), up.mul(rad * pulse), col, 0.3 * k, 1.0, 10);
      mb.sprite(p, right.mul(rad * 0.3), up.mul(rad * 0.3), [1.0, 0.95, 0.85], 0.6 * k, 1.0, 8);
    }
  }
  if (tier >= 1) {
    for (const z of g.zombies.filter((z) => !z.dead && z.pos.distance_squared(eye) < 900.0)) {
      const s = z.kind === 'Hulk' ? 1.5 : 1.0;
      const f = v3(-Math.sin(z.yaw), 0.0, -Math.cos(z.yaw));
      const p = z.pos.add(Y.mul(1.64 * s)).add(f.mul(0.12 * s));
      mb.sprite(p, right.mul(0.15 * s), up.mul(0.08 * s), [1.0, 0.8, 0.1], 0.22, 1.0, 8);
    }
  }
  const mesh = mb.build_fixed(MAX_V, MAX_I);
  if (parts.mesh !== null) {
    parts.mesh.set_mesh(mesh);
  } else {
    // Rust: Transform::default(), NoFrustumCulling, mats.blend.
    const node = scene.spawn(null, 'blend', {});
    node.set_mesh(mesh);
    parts.mesh = node;
  }
}

/* VIEW NOTES (fx.js)
 * One dynamic mesh node (blend material = fx.wgsl: unlit, additive-ish alpha blend, vertex colour rgba, uv.y = emissive),
 * identity transform, NO frustum culling (vertices are world-space and the bounding box changes every frame). It is
 * rebuilt every frame with build_fixed(8192 verts, 36864 indices); padding vertices sit at y = -50 with alpha 0.
 * Sprites are camera-facing fans (centre alpha a, rim alpha 0, radius 1.4 x size, seg 4/8/10); streaks are 4-vertex
 * quads from pos back along the velocity (length |v| x 0.035 clamped 0.05..0.6, width = size), head alpha a, tail 0.
 * Particle colours of `lit` parts are multiplied by Fx.ambient (clamped to 1.2), unlit ones (sparks, fire) are raw.
 * Static glows (instead of bloom): street lamps (lay.LAMPS, y 5.5, r 1.6, night only), door lamp (r 0.9) and the
 * sign glow above the door (r 2.4, night only), barrier red lights (r 0.7), till green screen (r 0.5); strength
 * night_factor or 0.35 + 0.65 * night; radius pulses 5 % at 9 rad/s. Zombie eye glow (tier >= 1, within 30 m): yellow
 * sprite at 1.64 m (x1.5 for Hulk) 0.12 m in front of the face.
 * Particles are cleared of Rust Handle/Entity; Parts.mesh holds the scene node.
 * PORT GAPS: none (camera right/up come from ctx.cam.quat; time.elapsed_secs() from ctx.elapsed).
 */
