// Port of src/mat.rs: only the non-GPU logic (Fx, Quality, rain_target, night_factor, the light-by-hour table and
// update_env). The shaders (proc.wgsl, fx.wgsl) are described in three/docs/proc-shader-notes.md; update_env writes
// the same uniform VALUES into the exported plain object ENV (Rust ProcU field names) instead of a GPU buffer.
//! Một material duy nhất cho cả game (shader `proc.wgsl`), cùng hệ thống trời/đèn theo giờ.

import { Vec3, v3 } from './vec.js';
import * as web from './web.js';
import * as lay from './lay.js';
import * as world from './world.js';

/** Đèn động (chớp đòn đánh, nổ) do gameplay đặt; tự tắt dần. */
export class Fx {
  constructor() {
    this.flash_pos = v3(0, 0, 0);
    this.flash_col = v3(0, 0, 0);
    this.flash = 0.0;
    this.raid = 0.0;
    /** Mưa 0..1 và độ ướt mặt đất 0..1 (ướt khô chậm sau mưa). */
    this.rain = 0.0;
    this.wet = 0.0;
    /** Màu ánh sáng môi trường hiện tại (để tô hạt bụi, khói). */
    this.ambient = v3(0, 0, 0);
  }
}

/** Tên mức đồ hoạ theo giá trị `?q=` (0 thấp, 1 vừa, 2 cao) và MSAA mỗi mức (update_env). */
export const QUALITY_NAMES = ['low', 'med', 'high'];
export const QUALITY_MSAA = ['Off', 'Sample4', 'Sample4'];

function parse_f32(s) {
  // Rust str::parse::<f32>: cả chuỗi phải là số (không khoảng trắng, không đuôi rác).
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return parseFloat(s);
  if (/^[+-]?(inf|infinity)$/i.test(s)) return s[0] === '-' ? -Infinity : Infinity;
  if (/^[+-]?nan$/i.test(s)) return NaN;
  return null;
}

/** Mức đồ hoạ: 0 thấp, 1 vừa, 2 cao. Chọn bằng `?q=low|med|high`, hoặc trang tự dò GPU (window.__twtQ). */
export class Quality {
  constructor(tier = 2, auto = false, slow_t = 0.0, age = 0.0, force_rain = null) {
    this.tier = tier;
    this.auto = auto;
    this.slow_t = slow_t;
    this.age = age;
    this.force_rain = force_rain;
  }
  static detect() {
    const q = web.query('q');
    let named = null;
    if (q !== null) {
      switch (q) {
        case 'low': case '0': named = 0; break;
        case 'med': case 'medium': case '1': named = 1; break;
        case 'high': case '2': named = 2; break;
        default: named = null;
      }
    }
    const st = web.settings();
    const stored = st !== null ? st[0] : null;
    const num = web.number('__twtQ');
    // `v as u8` trên f64: cắt về số nguyên, bão hoà 0..255.
    const fromNum = num !== null ? Math.min(255, Math.max(0, Math.trunc(num))) : null;
    const tier = Math.min(named !== null ? named : stored !== null ? stored : fromNum !== null ? fromNum : 2, 2);
    const rq = web.query('rain');
    const fr = rq !== null ? parse_f32(rq) : null;
    return new Quality(tier, named === null && stored === null, 0.0, 0.0, fr);
  }
}

/** Có mưa không: tối các ngày chẵn (19:30 tới nửa đêm), không mưa lúc raid. */
export function rain_target(day, hour, raid) {
  return !raid && day % 2 === 0 && hour >= 19.5 ? 1.0 : 0.0;
}

/** Texture nhiễu của Saltline (`qM` trong improved-game.js): 256x256 RGBA, số ngẫu nhiên xorshift32 hạt giống 2654435769,
 * lặp, lọc tuyến tính, không mipmap, không gian màu tuyến tính. Trả về Uint8Array 256*256*4 (view tạo DataTexture:
 * RGBA8, RepeatWrapping, LinearFilter, không mipmap, NoColorSpace). */
export function noise_image() {
  let t = 2654435769 >>> 0;
  const next = () => {
    t = (t ^ (t << 13)) >>> 0;
    t = (t ^ (t >>> 17)) >>> 0;
    t = (t ^ (t << 5)) >>> 0;
    return Math.trunc((t / 4294967296.0) * 256.0);
  };
  const data = new Uint8Array(256 * 256 * 4);
  for (let o = 0; o < 256 * 256; o++) {
    data[o * 4] = next();
    data[o * 4 + 1] = next();
    data[o * 4 + 2] = next();
    data[o * 4 + 3] = 255;
  }
  return data;
}

/** Đổi sang shader đầy đủ ở khung hình thứ 12 (sau khi trang đã báo khung hình đầu ở khung thứ 3). `?shader=lite` giữ bản gọn,
 * `?shader=full` dùng bản đầy đủ ngay từ đầu (để đo). Ở đây chỉ bật/tắt cờ ENV.lite cho view. */
let UPGRADE_N = 0;
export function upgrade_shader() {
  UPGRADE_N += 1;
  if (UPGRADE_N === 12 && web.query('shader') !== 'lite') {
    ENV.lite = false;
  }
}

/** Bảng ánh sáng theo giờ (tuyến tính). Ban ngày lấy nguyên bộ đèn của Saltline (improved-game.js `Z0`, `T0`): mặt trời thấp
 * màu (1; 0,72; 0,42) cường độ 9 (ở đây 9/π = 2,865 vì shader không chia π), chân trời phía mặt trời (0,95; 0,55; 0,28), chân trời
 * phía đối diện (0,16; 0,22; 0,3) nằm ở ô `zenith`, sương (0,42; 0,47; 0,52) mật độ 0,0034; không có đèn ambient, chỉ có ánh
 * trời (`sky`, `gnd` = trung bình mái mây x environmentIntensity 2). Bình minh, hoàng hôn và đêm là phần twt-proc thêm. */
export const KEYS = Object.freeze([
  { h: 0.0, zenith: [0.012, 0.016, 0.03], horizon: [0.03, 0.03, 0.06], sun: [0.35, 0.45, 0.8], sun_k: 0.25, sky: [0.03, 0.035, 0.075], gnd: [0.015, 0.014, 0.026], fog: 0.0045, cloud: 1.0 },
  { h: 4.5, zenith: [0.012, 0.016, 0.03], horizon: [0.03, 0.03, 0.06], sun: [0.35, 0.45, 0.8], sun_k: 0.25, sky: [0.03, 0.035, 0.075], gnd: [0.015, 0.014, 0.026], fog: 0.0045, cloud: 1.0 },
  { h: 6.0, zenith: [0.1, 0.13, 0.2], horizon: [0.95, 0.5, 0.3], sun: [1.0, 0.6, 0.36], sun_k: 1.6, sky: [0.12, 0.15, 0.22], gnd: [0.06, 0.06, 0.065], fog: 0.005, cloud: 1.0 },
  { h: 8.0, zenith: [0.16, 0.22, 0.3], horizon: [0.95, 0.55, 0.28], sun: [1.0, 0.72, 0.42], sun_k: 2.865, sky: [0.2, 0.25, 0.33], gnd: [0.1, 0.1, 0.105], fog: 0.0034, cloud: 1.0 },
  { h: 12.5, zenith: [0.16, 0.22, 0.3], horizon: [0.95, 0.55, 0.28], sun: [1.0, 0.72, 0.42], sun_k: 2.865, sky: [0.2, 0.25, 0.33], gnd: [0.1, 0.1, 0.105], fog: 0.0034, cloud: 1.0 },
  { h: 16.0, zenith: [0.16, 0.22, 0.3], horizon: [0.95, 0.55, 0.28], sun: [1.0, 0.72, 0.42], sun_k: 2.865, sky: [0.2, 0.25, 0.33], gnd: [0.1, 0.1, 0.105], fog: 0.0034, cloud: 1.0 },
  { h: 18.5, zenith: [0.11, 0.13, 0.2], horizon: [1.0, 0.42, 0.16], sun: [1.0, 0.5, 0.22], sun_k: 1.8, sky: [0.13, 0.14, 0.2], gnd: [0.07, 0.06, 0.06], fog: 0.0045, cloud: 1.0 },
  { h: 20.0, zenith: [0.02, 0.024, 0.045], horizon: [0.06, 0.03, 0.085], sun: [0.35, 0.45, 0.8], sun_k: 0.25, sky: [0.035, 0.036, 0.085], gnd: [0.017, 0.015, 0.03], fog: 0.0045, cloud: 1.0 },
  { h: 24.0, zenith: [0.012, 0.016, 0.03], horizon: [0.03, 0.03, 0.06], sun: [0.35, 0.45, 0.8], sun_k: 0.25, sky: [0.03, 0.035, 0.075], gnd: [0.015, 0.014, 0.026], fog: 0.0045, cloud: 1.0 },
]);

export function l3(a, b, t) {
  return v3(a[0], a[1], a[2]).lerp(v3(b[0], b[1], b[2]), t);
}

export function night_factor(hour) {
  if (hour < 5.0 || hour >= 20.0) {
    return 1.0;
  } else if (hour < 6.5) {
    return 1.0 - (hour - 5.0) / 1.5;
  } else if (hour > 18.5) {
    return (hour - 18.5) / 1.5;
  } else {
    return 0.0;
  }
}

const vec4 = (x = 0, y = 0, z = 0, w = 0) => [x, y, z, w];
const ext = (v, w) => [v.x, v.y, v.z, w];

/** Giá trị uniform `ProcU` của khung hiện tại (cùng tên trường như Rust; mỗi vec4 là mảng [x, y, z, w]).
 *  Ý nghĩa từng ô w: cam.w = thời gian (s), sun_dir.w = cường độ mặt trời, sun_col.w = mưa, sky_col.w = night,
 *  gnd_col.w = 0.95, fog_col.w = mật độ sương, zenith.w = mây, horizon.w = raid, misc = (tier, wet, res.x, res.y),
 *  inside_min.w = 16 (số hộp bóng), inside_max.w = 8 (số đèn điểm), boxes_* = 16 hộp đổ bóng, caps = 16 cầu bóng
 *  nhân vật (xyz tâm, w bán kính), lpos = 8 đèn (xyz, w bán kính), lcol = màu đèn (đã nhân cường độ). */
export const ENV = {
  cam: vec4(), sun_dir: vec4(), sun_col: vec4(), sky_col: vec4(), gnd_col: vec4(), fog_col: vec4(), zenith: vec4(), horizon: vec4(),
  inside_min: vec4(), inside_max: vec4(), misc: vec4(),
  boxes_min: Array.from({ length: 16 }, () => vec4()),
  boxes_max: Array.from({ length: 16 }, () => vec4()),
  caps: Array.from({ length: 16 }, () => vec4()),
  lpos: Array.from({ length: 8 }, () => vec4()),
  lcol: Array.from({ length: 8 }, () => vec4()),
  /** Ngoài ProcU: các thứ update_env còn ghi vào thế giới Bevy. */
  msaa: 'Sample4', // Msaa của camera: 'Off' ở tier 0, 'Sample4' còn lại
  dome_pos: v3(0, 0, 0), // vòm trời (world::SkyDome) đi theo mắt trên mặt XZ
  tier: 2, // people::TIER (bộ dựng người chọn độ chi tiết theo đây)
  lite: web.query('shader') !== 'full', // ProcMaterial.lite (bản shader gọn cho vài khung đầu)
};

/**
 * update_env(g, dt, ctx)   (Bevy PostUpdate system)
 *   ctx.cam = { pos: Vec3 } camera translation; ctx.fx = Fx; ctx.quality = Quality; ctx.elapsed = time.elapsed_secs();
 *   ctx.res = { x, y } physical window size (optional, default 1280 x 720); ctx.dome = optional array of sky-dome nodes.
 */
export function update_env(g, dt, ctx) {
  const cam = ctx.cam;
  if (!cam || !cam.pos) return;
  const fx = ctx.fx, quality = ctx.quality;
  const elapsed = ctx.elapsed || 0;
  const eye = cam.pos;
  ENV.dome_pos = v3(eye.x, 0.0, eye.z);
  if (ctx.dome) {
    for (const t of ctx.dome) t.set_pos(v3(eye.x, 0.0, eye.z));
  }
  const hour = g.hour();
  let i = 0;
  while (i + 2 < KEYS.length && hour >= KEYS[i + 1].h) {
    i += 1;
  }
  const a = KEYS[i], b = KEYS[i + 1];
  const t = Math.min(Math.max((hour - a.h) / (b.h - a.h), 0.0), 1.0);
  let zenith = l3(a.zenith, b.zenith, t);
  let horizon = l3(a.horizon, b.horizon, t);
  let sun_col = l3(a.sun, b.sun, t);
  let sun_k = a.sun_k + (b.sun_k - a.sun_k) * t;
  let sky = l3(a.sky, b.sky, t);
  let gnd = l3(a.gnd, b.gnd, t);
  let fog_d = a.fog + (b.fog - a.fog) * t;
  const cloud = a.cloud + (b.cloud - a.cloud) * t;
  const night = night_factor(hour);

  // Mặt trời mọc 6:00 phía đông (+x), lặn 19:30 phía tây, vòng qua phía nam (+z, mặt tiền quán).
  const day_t = (hour - 6.0) / 13.5;
  let sun_dir;
  if (day_t >= 0.0 && day_t <= 1.0 && night < 0.999) {
    // Mặt trời luôn thấp (8 đến 20 độ) như Saltline (13 độ): bóng dài, nhìn ra đường là nhìn ngược sáng.
    const ang = day_t * Math.PI;
    const elev = ((8.0 + 12.0 * Math.sin(ang)) * Math.PI) / 180.0;
    const hx = Math.cos(ang), hz = 0.55;
    const hl = Math.sqrt(hx * hx + hz * hz);
    sun_dir = v3((hx / hl) * Math.cos(elev), Math.sin(elev), (hz / hl) * Math.cos(elev));
  } else {
    sun_dir = v3(-0.35, 0.75, 0.45).normalize();
  }

  // Raid: cả cảnh ngả đỏ (bản gốc nhuộm trời, đất và sương màu đỏ).
  const target = g.raid.active ? 1.0 : 0.0;
  fx.raid += (target - fx.raid) * Math.min(dt * 1.5, 1.0);
  const r = fx.raid;
  if (r > 0.001) {
    zenith = zenith.lerp(v3(0.16, 0.012, 0.018), r);
    horizon = horizon.lerp(v3(0.42, 0.035, 0.03), r);
    sun_col = sun_col.lerp(v3(1.0, 0.25, 0.18), r);
    sky = sky.lerp(v3(0.3, 0.07, 0.07), r);
    gnd = gnd.lerp(v3(0.12, 0.03, 0.03), r);
    sun_k *= 1.0 - 0.3 * r;
    fog_d = fog_d + (0.006 - fog_d) * r;
  }
  // Mưa và độ ướt: ướt nhanh khi mưa, khô chậm; luôn hơi ẩm cho mặt đường bóng.
  // Móc kiểm thử: ?rain=1 ép mưa (để chụp ảnh), ?rain=0 tắt mưa.
  const rt = quality.force_rain !== null ? quality.force_rain : rain_target(g.day, hour, g.raid.active);
  fx.rain += Math.min(Math.max(rt - fx.rain, -dt * 0.25), dt * 0.25);
  web.set_rain(fx.rain);
  // Mặt đất luôn ướt sau mưa như bến cảng của Saltline; mưa thì ướt hẳn.
  const wet_goal = 0.45 + 0.55 * fx.rain;
  const rate = wet_goal > fx.wet ? 0.08 : 0.004;
  fx.wet += Math.min(Math.max(wet_goal - fx.wet, -dt * rate), dt * rate);
  if (fx.rain > 0.01) {
    const k = fx.rain;
    zenith = zenith.lerp(horizon.mul(0.5), k * 0.6);
    sun_k *= 1.0 - 0.5 * k;
    fog_d *= 1.0 + 0.8 * k;
  }
  const fog = v3(0.42, 0.47, 0.52).lerp(v3(0.05, 0.06, 0.1), night).lerp(v3(0.3, 0.05, 0.05), fx.raid * 0.8);
  fx.ambient = sky.mul(0.7).add(sun_col.mul(sun_k * 0.25));
  // Tự hạ mức đồ hoạ khi dưới 28 khung/giây suốt 5 giây (bỏ 8 giây đầu).
  quality.age += dt;
  if (quality.auto && quality.tier > 0 && quality.age > 8.0) {
    if (dt > 1.0 / 28.0 && dt < 0.5) {
      quality.slow_t += dt;
    } else {
      quality.slow_t = Math.max(quality.slow_t - dt * 2.0, 0.0);
    }
    if (quality.slow_t > 5.0) {
      quality.tier -= 1;
      quality.slow_t = 0.0;
      quality.age = 0.0;
      console.info(`quality: dropped to tier ${quality.tier}`);
    }
  }
  ENV.msaa = quality.tier === 0 ? 'Off' : 'Sample4';
  const res = ctx.res ? v3(ctx.res.x, ctx.res.y, 0) : v3(1280.0, 720.0, 0);

  ENV.tier = quality.tier;
  // Hộp "trong nhà" theo chỗ mắt đang đứng: nhà kho, phần mở rộng, còn lại là quán + phòng ngủ + phòng y tế.
  const rooms = lay.rooms();
  const in_wh = lay.wh_open() && lay.inside(lay.WAREHOUSE_IN, eye);
  const ex_x1 = rooms >= 2 ? 24.82 : 14.82;
  const in_ex = rooms >= 1 && eye.x > 5.1 && eye.x < ex_x1 && eye.z > -5.07 && eye.z < 3.02;
  let in_min, in_max;
  if (in_wh) {
    in_min = v3(-5.07, -0.2, -19.02); in_max = v3(14.82, lay.WAREHOUSE_H + 0.05, -5.18);
  } else if (in_ex) {
    in_min = v3(5.1, -0.2, -5.07); in_max = v3(ex_x1, 3.25, 3.02);
  } else {
    in_min = lay.INSIDE_MIN; in_max = lay.INSIDE_MAX;
  }
  const u = ENV;
  u.cam = ext(eye, elapsed);
  u.sun_dir = ext(sun_dir, sun_k);
  u.sun_col = ext(sun_col, fx.rain);
  u.sky_col = ext(sky, night);
  u.gnd_col = ext(gnd, 0.95);
  u.fog_col = ext(fog, fog_d);
  u.zenith = ext(zenith, cloud);
  u.horizon = ext(horizon, fx.raid);
  u.misc = vec4(quality.tier, fx.wet, res.x, res.y);
  u.inside_min = ext(in_min, 16.0);
  u.inside_max = ext(in_max, 8.0);
  const sb = typeof world.SHADOW_BOXES === 'function' ? world.SHADOW_BOXES() : world.SHADOW_BOXES;
  const nb = Math.min(sb.length, 16);
  for (let k = 0; k < nb; k++) {
    const [mn, mx] = sb[k];
    u.boxes_min[k] = vec4(mn[0], mn[1], mn[2], 0.0);
    u.boxes_max[k] = vec4(mx[0], mx[1], mx[2], 0.0);
  }
  for (let k = nb; k < 16; k++) {
    u.boxes_min[k] = vec4(0.0, -100.0, 0.0, 0.0);
    u.boxes_max[k] = vec4(0.0, -99.0, 0.0, 0.0);
  }
  // Cầu đổ bóng của 16 nhân vật gần mắt nhất.
  const actors = g.customers.map((c) => c.pos).concat(g.zombies.map((z) => z.pos));
  // Rust sort_by là sắp xếp ổn định; Array.prototype.sort cũng ổn định (ES2019).
  actors.sort((p, q) => { const da = p.distance_squared(eye), db = q.distance_squared(eye); return da < db ? -1 : da > db ? 1 : 0; });
  for (let k = 0; k < 16; k++) {
    const p = k < actors.length ? actors[k] : null;
    u.caps[k] = p !== null ? ext(p.add(v3(0, 0.85, 0)), 0.5) : vec4(0.0, -500.0, 0.0, 0.1);
  }
  // Đèn: 3 đèn trần quán, đèn phòng ngủ, đèn cửa, 2 cột đèn trong bãi, 1 đèn động.
  const lamp = (i) => {
    const [x, z, tt] = lay.LAMPS[i];
    return v3(x, 5.6, z + tt * 0.3);
  };
  const cream = v3(1.0, 0.92, 0.72);
  const indoor = 0.55 + 0.75 * night;
  const outdoor = night * 1.6;
  const flick = 1.0 + 0.04 * Math.sin(elapsed * 13.0) * Math.sin(elapsed * 3.1);
  // Ba đèn trần đi theo phòng đang đứng (nhà kho, phần mở rộng, phòng y tế có đèn riêng; không thêm đèn vào shader):
  // (vị trí, bán kính, hệ số sáng). Nhà kho cao 6,9 m nên đèn mạnh và chiếu xa hơn.
  const in_med = lay.med_open() && lay.inside(lay.MEDICAL_IN, eye);
  let room_lamps;
  if (in_wh) {
    room_lamps = [[v3(0.0, 4.6, -9.0), 22.0, 2.2], [v3(7.5, 4.6, -12.5), 22.0, 2.2], [v3(12.0, 4.6, -15.5), 22.0, 2.2]];
  } else if (in_ex) {
    // Phòng mở rộng: hai đèn của phòng đang đứng + một đèn của phòng kia (hoặc của quán khi mới có một phòng). Phòng rộng
    // gần 10 x 8 m nên đèn sáng hơn và chiếu xa hơn đèn quán, không thì phòng sơn màu đậm tối om giữa ban ngày.
    if (eye.x > 14.85) {
      room_lamps = [[v3(17.4, 2.6, -1.0), 13.0, 1.9], [v3(22.2, 2.6, -1.0), 13.0, 1.9], [v3(9.94, 2.6, -1.0), 13.0, 1.9]];
    } else {
      room_lamps = [[v3(7.54, 2.6, -1.0), 13.0, 1.9], [v3(12.34, 2.6, -1.0), 13.0, 1.9], rooms >= 2 ? [v3(19.8, 2.6, -1.0), 13.0, 1.9] : [v3(2.4, 2.85, 0.6), 9.0, 1.0]];
    }
  } else if (in_med) {
    room_lamps = [[v3(-7.4, 2.9, 2.2), 9.0, 1.1], [v3(2.4, 2.85, 0.6), 9.0, 1.0], [v3(-2.4, 2.85, 0.6), 9.0, 1.0]];
  } else {
    // Đứng trong quán gần lỗ tường thông sang phòng mở rộng: đèn thứ ba chuyển sang phòng đó để nhìn sang không thấy hố đen.
    room_lamps = [[v3(-2.4, 2.85, 0.6), 9.0, 1.0], [v3(2.4, 2.85, 0.6), 9.0, 1.0], rooms >= 1 && eye.x > 1.5 ? [v3(9.94, 2.6, -1.0), 14.0, 1.9] : [v3(0.0, 2.6, -3.4), 6.5, 0.8]];
  }
  const lights = [
    [room_lamps[0][0], room_lamps[0][1], cream.mul(indoor * flick * room_lamps[0][2])],
    [room_lamps[1][0], room_lamps[1][1], cream.mul(indoor * room_lamps[1][2])],
    [room_lamps[2][0], room_lamps[2][1], cream.mul(indoor * room_lamps[2][2])],
    [lay.BED_LAMP, 6.5, v3(1.0, 0.8, 0.55).mul(indoor * 0.8)],
    [lay.DOOR.add(v3(0.0, 2.9, 0.975)), 10.0, v3(1.0, 0.75, 0.35).mul(outdoor + 0.15 * (1.0 - night))],
    [lamp(0), 17.0, v3(1.0, 0.85, 0.6).mul(outdoor)],
    [lamp(1), 17.0, v3(1.0, 0.85, 0.6).mul(outdoor * flick)],
    [fx.flash_pos, 7.0, fx.flash_col.mul(fx.flash)],
  ];
  lights.forEach(([p, rad, c], k) => {
    u.lpos[k] = ext(p, rad);
    u.lcol[k] = ext(c, 0.0);
  });
  fx.flash = Math.max(fx.flash - dt * 6.0, 0.0);
}

/* VIEW NOTES (mat.js)
 * No meshes here. Every frame (after gameplay, Bevy PostUpdate) call update_env(g, dt, ctx) then upgrade_shader(),
 * and feed ENV to the three.js materials: ENV.sun_dir.xyz is the direction TO the sun (w = intensity, not divided by
 * pi), sun_col.rgb its colour; hemisphere light sky_col (up) / gnd_col (down); fog colour fog_col.rgb with exponential
 * density fog_col.w; sky gradient zenith (anti-sun side / top) -> horizon (sun side); horizon.w = raid 0..1 red tint;
 * sun_col.w = rain 0..1, misc.y = wetness 0..1 (puddles / gloss), sky_col.w = night 0..1 (stars, lamp glows);
 * 8 point lights lpos (xyz, w = radius m) / lcol (rgb premultiplied by intensity); 16 shadow boxes and 16 actor
 * capsule spheres for the sun's box-ray shadow; inside_min/max = the "indoors" AABB around the eye (no sky / rain,
 * no sun inside). Fx.ambient tints particles (fx.js). Full shader maths: three/docs/proc-shader-notes.md.
 * Mats / ProcMaterial / FxMaterial / skin_bind and the ?cut= shader-source surgery are GPU-only and not ported.
 * noise_image() gives the 256x256 RGBA sky-noise texture data.
 * PORT GAPS: windows physical size comes from ctx.res; people::TIER is exposed as ENV.tier; Msaa as ENV.msaa.
 */
