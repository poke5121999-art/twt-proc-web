// Biểu tượng của HUD và các bảng, không dùng file ảnh nào (port of src/icons.rs for the three.js client).
//
// - Biểu tượng món (`{k:'Item', a:i}`): hình 3D thủ tục của chính món đó (models.weapon_item / placed / item, guns.model)
//   vẽ bằng bộ rasteriser tam giác chạy trên CPU (port 1:1 của `raster()` trong icons.rs): máy quay trực giao góc 3/4 cố
//   định, đèn chính + đèn viền, bóng mềm dưới chân, viền tối quanh hình, nền trong suốt. Ô ở đây là 128 px (Rust: 64 px),
//   siêu lấy mẫu 2 x 2. Vẽ dần mỗi khung hình vài món (món đang cần lên màn hình được vẽ trước, như `bake`), cất thành
//   data URL PNG.
// - Glyph hệ thống (G): bộ glyph SDF của icons.rs vẽ lại thành SVG nét sắc (cùng toạ độ trên khung 64, cùng màu, cùng
//   chuyển sắc nhẹ từ trên xuống). Bản `Node` nằm trong ô hình thoi tối (nút kỹ năng, nút bản đồ, phím tắt góc phải dưới).
// - `Card` / `Cards`: object thường với đúng tên trường Rust (sim/items.js, skills.js, map.js, craft.js, events.js
//   dựng chúng trực tiếp; các hàm ở đây chỉ là factory cho ai cần).
//
// Icon (enum có dữ liệu): {k:'None'} | {k:'Item', a:i} | {k:'Glyph', a:G} | {k:'Node', a:G}; G là chuỗi tên biến thể.

import { N_CAT } from './sim/catalog.js';
import * as geom from './sim/geom.js';
import * as items from './sim/items.js';
import * as models from './sim/models.js';
import * as guns from './sim/guns.js';
import { v3 } from './sim/vec.js';

/** Cạnh một ô biểu tượng món (px). Rust: 64; ở đây gấp đôi cho màn hình dày điểm ảnh. */
export const CELL = 128;
const SS = 2;
const NPX = CELL * SS;
/** Ô ngay sau danh mục: hộp các-tông (ô đồ thứ ba của HUD). */
export const BOX_ICON = N_CAT;
export const N_ICONS = BOX_ICON + 1;

export const G_ORDER = [
  'Battery', 'Face0', 'Face1', 'Face2', 'Face3', 'Face4', 'Clock', 'List', 'Check', 'Alert', 'Skull', 'Gear', 'Backpack', 'Globe',
  'Skills', 'Staff', 'MouseL', 'MouseR', 'Hand', 'Lock', 'Cart', 'Pistol', 'People', 'Hammer', 'Shield', 'Heart', 'Crate', 'Shop',
  'Gate', 'Planks', 'Megaphone', 'Anchor', 'Wrench', 'Truck', 'MouseM',
];
export const G = Object.freeze(Object.fromEntries(G_ORDER.map((n) => [n, n])));

export const Icon = Object.freeze({
  None: () => ({ k: 'None' }),
  Item: (i) => ({ k: 'Item', a: i }),
  Glyph: (g) => ({ k: 'Glyph', a: g }),
  Node: (g) => ({ k: 'Node', a: g }),
});

/** Một thẻ trong bảng dạng lưới. `state`: 0 thường, 1 mờ (khoá / chưa tới được), 2 tốt (đã có / đã xong), 3 cảnh báo. */
export function Card(icon, name, sub, state) {
  return { icon, name, sub, state };
}
/** Nội dung một bảng lưới thẻ (Cards::default()). tabs: [[G, tên, đang chọn]]. */
export function Cards() {
  return { head: '', tabs: [], cards: [], sel: 0, det_icon: null, det_title: '', det: '', foot: '' };
}

// ---------- trạng thái vẽ dần (Rust: resource Icons) ----------

export class Icons {
  constructor() {
    this.urls = new Array(N_ICONS).fill(null);
    this.done = new Array(N_ICONS).fill(false);
    this.want_q = [];
    this.next = 0;
    this.frame = 0;
    /** Số món đã vẽ (cho bot kiểm). */
    this.baked = 0;
    /** Mili giây đã tiêu cho việc vẽ (đo). */
    this.ms = 0;
  }
  total() {
    return N_ICONS;
  }
}
export const STATE = new Icons();

export function setup() {
  return STATE;
}

/** Báo một món sắp lên màn hình: nó được vẽ trước các món còn lại. */
export function want(i) {
  const st = STATE;
  if (i >= 0 && i < N_ICONS && !st.done[i] && !st.want_q.includes(i)) st.want_q.push(i);
}

/** Data URL của biểu tượng món `i`, hoặc null khi chưa vẽ xong (khi đó món được xếp lên đầu hàng chờ). */
export function item_icon(i) {
  const st = STATE;
  const k = Math.min(Math.max(i | 0, 0), N_ICONS - 1);
  const u = st.urls[k];
  if (u === null) want(k);
  return u;
}

export function stats() {
  return [STATE.baked, N_ICONS];
}

let CANVAS = null;
function to_url(px) {
  if (typeof document === 'undefined') return '';
  if (CANVAS === null) {
    CANVAS = document.createElement('canvas');
    CANVAS.width = CELL;
    CANVAS.height = CELL;
  }
  const c2 = CANVAS.getContext('2d');
  c2.putImageData(new ImageData(px, CELL, CELL), 0, 0);
  return CANVAS.toDataURL('image/png');
}

function bake_one(i) {
  const st = STATE;
  st.done[i] = true;
  st.baked += 1;
  let px;
  try {
    px = raster(item_mesh(i));
  } catch (e) {
    px = new Uint8ClampedArray(CELL * CELL * 4);
  }
  st.urls[i] = to_url(px);
}

/**
 * Vẽ dần biểu tượng món (Rust `bake`): để yên 12 khung hình đầu; mỗi lần gọi tối đa 3 món (món được `want` trước,
 * lấy từ cuối hàng chờ như Rust), trong ngân sách 7 ms (món đầu luôn được vẽ); khi không có món cần gấp thì vẽ nền
 * một món mỗi 4 khung hình.
 */
export function bake() {
  const st = STATE;
  st.frame += 1;
  if (st.frame < 12 || st.baked >= N_ICONS) return;
  const now = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
  const t0 = now();
  const urgent = st.want_q.length > 0;
  // Vẽ nền (chưa ai cần) chỉ một món mỗi 4 khung hình: một món tốn ~5-10 ms trên CPU.
  if (!urgent && st.frame % 4 !== 0) return;
  const budget = urgent ? 7.0 : 0.0;
  for (let n = 0; n < 3; n++) {
    if (n > 0 && now() - t0 > budget) break;
    let i;
    if (st.want_q.length > 0) {
      i = st.want_q.pop();
    } else {
      while (st.next < N_ICONS && st.done[st.next]) st.next += 1;
      if (st.next >= N_ICONS) break;
      i = st.next;
    }
    if (st.done[i]) continue;
    bake_one(i);
  }
  st.ms += now() - t0;
}

// ---------- biểu tượng món: rasteriser tam giác ----------

export function item_mesh(i) {
  const { MB, hex, CARDBOARD, FLAT } = geom;
  const mb = new MB();
  if (i >= BOX_ICON) {
    // Hộp các-tông: thân, hai cánh nắp, băng dính.
    mb.bevel = 0.01;
    mb.cube(v3(0.0, 0.14, 0.0), v3(0.44, 0.28, 0.34), hex(0xb98a55), CARDBOARD);
    mb.bevel = 0.0;
    mb.cube(v3(0.0, 0.283, 0.0), v3(0.445, 0.012, 0.345), hex(0xcda06a), CARDBOARD);
    mb.cube(v3(0.0, 0.29, 0.0), v3(0.45, 0.006, 0.07), hex(0xe9dcb4), FLAT);
    mb.cube(v3(0.0, 0.2, 0.172), v3(0.07, 0.17, 0.004), hex(0xe9dcb4), FLAT);
    return mb;
  }
  if (items.gun(i) !== null) {
    guns.model(mb, i);
    guns.off_part(mb, i);
  } else if (items.wclass(i) !== 0 || items.throwable(i) !== null) {
    models.weapon_item(mb, i, false);
  } else if (items.buildable(i)) {
    models.placed(mb, i);
  }
  if (mb.is_empty()) {
    models.item(mb, i, v3(0, 0, 0), 1.0);
  }
  return mb;
}

// Mat3 hàng-trước (row-major), như glam: from_rotation_x/y/z, nhân A*B áp B trước.
const m3_x = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const m3_y = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const m3_z = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const M3_ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];
function m3_mul(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}

function srgb(v) {
  v = Math.min(Math.max(v, 0.0), 1.0);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1.0 / 2.4) - 0.055;
}

// Bảng tra tuyến tính -> sRGB 8 bit (4096 mức), thay cho powf mỗi điểm ảnh.
const SRGB_LUT = new Uint8Array(4096);
for (let k = 0; k < 4096; k++) SRGB_LUT[k] = Math.floor(srgb(k / 4095) * 255.0 + 0.5);

/** Vẽ một mesh thành ô CELL x CELL RGBA (sRGB, alpha thẳng). */
export function raster(mb) {
  const { METAL, GLASS, UNLIT } = geom;
  const [p, n, uv, c, idx] = mb.raw();
  const out = new Uint8ClampedArray(CELL * CELL * 4);
  if (idx.length === 0) return out;
  // Hộp bao để chọn tư thế: vật dài theo z thì xoay cho nằm ngang màn hình, vật cao gầy (gậy, chai dài) thì ngả chéo.
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const q of p) {
    for (let k = 0; k < 3; k++) {
      if (q[k] < lo[k]) lo[k] = q[k];
      if (q[k] > hi[k]) hi[k] = q[k];
    }
  }
  const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const mid = [(lo[0] + hi[0]) * 0.5, (lo[1] + hi[1]) * 0.5, (lo[2] + hi[2]) * 0.5];
  let pre = M3_ID;
  if (ext[2] > ext[0] * 1.2) pre = m3_y(Math.PI / 2);
  if (ext[1] > 2.2 * Math.max(ext[0], ext[2])) pre = m3_mul(m3_z(-0.8), pre);
  let view = m3_mul(m3_x(0.45), m3_mul(m3_y(-0.62), pre));
  const nv = p.length;
  const vp = new Float32Array(nv * 3);
  const project = (m) => {
    let ax = 1e9, ay = 1e9, bx = -1e9, by = -1e9;
    for (let k = 0; k < nv; k++) {
      const x = p[k][0] - mid[0], y = p[k][1] - mid[1], z = p[k][2] - mid[2];
      const X = m[0] * x + m[1] * y + m[2] * z, Y = m[3] * x + m[4] * y + m[5] * z, Z = m[6] * x + m[7] * y + m[8] * z;
      vp[k * 3] = X; vp[k * 3 + 1] = Y; vp[k * 3 + 2] = Z;
      if (X < ax) ax = X; if (Y < ay) ay = Y; if (X > bx) bx = X; if (Y > by) by = Y;
    }
    return [ax, ay, bx, by];
  };
  let [ax, ay, bx, by] = project(view);
  // Vật dài nằm ngang (súng, ống, xà beng): xoay chéo trong mặt phẳng màn hình để lấp ô vuông, không thì chỉ là một vạch mảnh.
  if (bx - ax > 2.0 * (by - ay)) {
    view = m3_mul(m3_z(0.6), view);
    [ax, ay, bx, by] = project(view);
  }
  const vn = new Float32Array(nv * 3);
  for (let k = 0; k < nv; k++) {
    const q = n[k];
    const X = view[0] * q[0] + view[1] * q[1] + view[2] * q[2], Y = view[3] * q[0] + view[4] * q[1] + view[5] * q[2], Z = view[6] * q[0] + view[7] * q[1] + view[8] * q[2];
    const l = Math.hypot(X, Y, Z);
    if (l > 0) { vn[k * 3] = X / l; vn[k * 3 + 1] = Y / l; vn[k * 3 + 2] = Z / l; }
  }
  const sx0 = Math.max(bx - ax, 1e-4), sy0 = Math.max(by - ay, 1e-4);
  const K = 0.9 * NPX / Math.max(sx0, sy0);
  const cx = (ax + bx) * 0.5, cy = (ay + by) * 0.5;
  const kl = Math.hypot(-0.45, 0.75, 0.55);
  const key = [-0.45 / kl, 0.75 / kl, 0.55 / kl];
  const hl = Math.hypot(key[0], key[1], key[2] + 1);
  const half = [key[0] / hl, key[1] / hl, (key[2] + 1) / hl];
  const zb = new Float32Array(NPX * NPX).fill(-3.4e38);
  const col = new Float32Array(NPX * NPX * 3);
  const cov = new Uint8Array(NPX * NPX);
  const sx = new Float32Array(nv), sy = new Float32Array(nv);
  for (let k = 0; k < nv; k++) {
    sx[k] = (vp[k * 3] - cx) * K + NPX * 0.5;
    sy[k] = NPX * 0.48 - (vp[k * 3 + 1] - cy) * K;
  }
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
    const x0s = sx[i0], y0s = sy[i0], x1s = sx[i1], y1s = sy[i1], x2s = sx[i2], y2s = sy[i2];
    const area = (x1s - x0s) * (y2s - y0s) - (y1s - y0s) * (x2s - x0s);
    if (Math.abs(area) < 1e-5) continue;
    const x0 = Math.max(Math.floor(Math.min(x0s, x1s, x2s)), 0);
    const x1 = Math.min(Math.ceil(Math.max(x0s, x1s, x2s)), NPX - 1);
    const y0 = Math.max(Math.floor(Math.min(y0s, y1s, y2s)), 0);
    const y1 = Math.min(Math.ceil(Math.max(y0s, y1s, y2s)), NPX - 1);
    if (x1 < 0 || y1 < 0 || x0 > NPX - 1 || y0 > NPX - 1) continue;
    const pat = uv[i0][0], emi = uv[i0][1];
    const ca = c[i0], cb = c[i1], cc = c[i2];
    // Toạ độ trọng tâm là hàm tuyến tính của tâm điểm ảnh: w = (c + qx * ax + qy * ay) / area, cộng dồn theo x.
    const inv = 1.0 / area;
    const a0x = (y1s - y2s) * inv, a0y = (x2s - x1s) * inv, c0 = (x1s * y2s - y1s * x2s) * inv;
    const a1x = (y2s - y0s) * inv, a1y = (x0s - x2s) * inv, c1 = (x2s * y0s - y2s * x0s) * inv;
    const z0 = vp[i0 * 3 + 2], z1 = vp[i1 * 3 + 2], z2 = vp[i2 * 3 + 2];
    for (let y = y0; y <= y1; y++) {
      const qy = y + 0.5;
      let w0 = c0 + (x0 + 0.5) * a0x + qy * a0y;
      let w1 = c1 + (x0 + 0.5) * a1x + qy * a1y;
      for (let x = x0; x <= x1; x++, w0 += a0x, w1 += a1x) {
        const w2 = 1.0 - w0 - w1;
        if (w0 < 0.0 || w1 < 0.0 || w2 < 0.0) continue;
        const z = z0 * w0 + z1 * w1 + z2 * w2;
        const o = y * NPX + x;
        if (z <= zb[o]) continue;
        zb[o] = z;
        cov[o] = 1;
        let nx = vn[i0 * 3] * w0 + vn[i1 * 3] * w1 + vn[i2 * 3] * w2;
        let ny = vn[i0 * 3 + 1] * w0 + vn[i1 * 3 + 1] * w1 + vn[i2 * 3 + 1] * w2;
        let nz = vn[i0 * 3 + 2] * w0 + vn[i1 * 3 + 2] * w1 + vn[i2 * 3 + 2] * w2;
        const nl = Math.hypot(nx, ny, nz);
        if (nl > 0) { nx /= nl; ny /= nl; nz /= nl; } else { nx = 0; ny = 0; nz = 0; }
        if (nz < 0.0) { nx = -nx; ny = -ny; nz = -nz; }
        const br = ca[0] * w0 + cb[0] * w1 + cc[0] * w2;
        const bg = ca[1] * w0 + cb[1] * w1 + cc[1] * w2;
        const bb = ca[2] * w0 + cb[2] * w1 + cc[2] * w2;
        let r, gg, b;
        if (pat === UNLIT) {
          r = br; gg = bg; b = bb;
        } else {
          const diff = Math.max(nx * key[0] + ny * key[1] + nz * key[2], 0.0);
          const amb = 0.4 + 0.14 * ny;
          // Đèn viền: sáng lạnh ở mép quay về phía trên / phải.
          const om = 1.0 - nz;
          const rim = om * om * Math.sqrt(om) * Math.max(nx * 0.7 + ny * 0.5 + 0.2, 0.0) * 0.5;
          const spec = pat === METAL || pat === GLASS ? Math.pow(Math.max(nx * half[0] + ny * half[1] + nz * half[2], 0.0), 28.0) * (pat === GLASS ? 0.8 : 0.55) : 0.0;
          const L = (amb + 0.9 * diff) * 1.25;
          r = br * L + 0.75 * rim + spec + br * emi * 1.5;
          gg = bg * L + 0.86 * rim + spec + bg * emi * 1.5;
          b = bb * L + 1.0 * rim + spec + bb * emi * 1.5;
        }
        col[o * 3] = r; col[o * 3 + 1] = gg; col[o * 3 + 2] = b;
      }
    }
  }
  // Thu nhỏ SS x SS, rồi ghép: bóng mềm dưới chân, viền tối quanh hình, hình.
  const rgb = new Float32Array(CELL * CELL * 3);
  const al = new Float32Array(CELL * CELL);
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      let r = 0, gg = 0, b = 0, cnt = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const o = (y * SS + dy) * NPX + x * SS + dx;
          if (cov[o]) { r += col[o * 3]; gg += col[o * 3 + 1]; b += col[o * 3 + 2]; cnt += 1; }
        }
      }
      if (cnt > 0) {
        const o = y * CELL + x;
        rgb[o * 3] = r / cnt; rgb[o * 3 + 1] = gg / cnt; rgb[o * 3 + 2] = b / cnt;
        al[o] = cnt / (SS * SS);
      }
    }
  }
  // Ô gấp đôi Rust: viền dày gấp đôi (bán kính 2 px), bóng elip đổi theo tỉ lệ ô.
  const sc = CELL / 64;
  const R = Math.round(sc);
  const nb = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    if (dx === 0 && dy === 0) continue;
    nb.push([dx, dy, dx * dx + dy * dy <= R * R ? 1.0 : 0.6]);
  }
  const nbn = nb.length, nbx = new Int8Array(nb.map((q) => q[0])), nby = new Int8Array(nb.map((q) => q[1])), nbw = new Float32Array(nb.map((q) => q[2]));
  const ink = [0.012, 0.014, 0.018];
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const o = y * CELL + x;
      const a = al[o];
      // Viền: alpha lớn nhất của hàng xóm trong bán kính ~1,5 px (x tỉ lệ ô).
      let edge = 0.0;
      if (a < 1.0) for (let q = 0; q < nbn; q++) {
        const xx = x + nbx[q], yy = y + nby[q];
        if (xx >= 0 && yy >= 0 && xx < CELL && yy < CELL) {
          const e = al[yy * CELL + xx] * nbw[q];
          if (e > edge) edge = e;
        }
      }
      edge *= 0.85;
      // Bóng: elip mềm dưới chân.
      const ex = (x + 0.5 - 32.0 * sc) / (21.0 * sc), ey = (y + 0.5 - 55.5 * sc) / (5.5 * sc);
      let sh = Math.min(Math.max(1.0 - (ex * ex + ey * ey), 0.0), 1.0);
      sh = sh * sh * 0.42;
      // Xếp lớp: bóng < viền < hình (màu viền và bóng gần đen).
      const under = edge + sh * (1.0 - edge);
      const oa = a + under * (1.0 - a);
      if (oa <= 0.0) continue;
      const d = o * 4;
      for (let k = 0; k < 3; k++) {
        const m = (rgb[o * 3 + k] * a + ink[k] * under * (1.0 - a)) / oa;
        out[d + k] = SRGB_LUT[Math.min(Math.max(Math.round(m * 4095), 0), 4095)];
      }
      out[d + 3] = Math.floor(Math.min(Math.max(oa, 0), 1) * 255.0 + 0.5);
    }
  }
  return out;
}

// ---------- glyph: SVG (vẽ lại bộ SDF của icons.rs trên khung 64) ----------

const WHITE = '#f4f3ee';
const TONE = '#aab1b8';
const INK = '#15181b';
const YEL = '#f5d138';
const S = 4.5;

const f2 = (v) => +v.toFixed(2);
/** Hộp bo góc theo tâm + nửa cạnh, như `rbox` của Rust. */
const rb = (cx, cy, hx, hy, r, fill, extra = '') => `<rect x="${f2(cx - hx)}" y="${f2(cy - hy)}" width="${f2(hx * 2)}" height="${f2(hy * 2)}" rx="${r}" fill="${fill}"${extra}/>`;
const ci = (cx, cy, r, fill, extra = '') => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"${extra}/>`;
const sg = (a, b, w, col, cap = 'round') => `<path d="M${a[0]} ${a[1]}L${b[0]} ${b[1]}" stroke="${col}" stroke-width="${w}" stroke-linecap="${cap}" fill="none"/>`;
const pl = (pts, w, col) => `<path d="M${pts.map((q) => q.join(' ')).join('L')}" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
/** Đa giác lồi nở ra `grow` (góc tròn), như `poly(p, v) - grow`. */
const pg = (pts, fill, grow = 0) => `<path d="M${pts.map((q) => q.join(' ')).join('L')}Z" fill="${fill}"${grow > 0 ? ` stroke="${fill}" stroke-width="${grow * 2}" stroke-linejoin="round"` : ''}/>`;
/** Đường bao một hộp bo góc (cho fill-rule evenodd). */
function rrd(x, y, w, h, r) {
  return `M${f2(x + r)} ${f2(y)}H${f2(x + w - r)}A${r} ${r} 0 0 1 ${f2(x + w)} ${f2(y + r)}V${f2(y + h - r)}A${r} ${r} 0 0 1 ${f2(x + w - r)} ${f2(y + h)}H${f2(x + r)}A${r} ${r} 0 0 1 ${f2(x)} ${f2(y + h - r)}V${f2(y + r)}A${r} ${r} 0 0 1 ${f2(x + r)} ${f2(y)}Z`;
}
const cd = (cx, cy, r) => `M${f2(cx - r)} ${cy}a${r} ${r} 0 1 0 ${f2(r * 2)} 0a${r} ${r} 0 1 0 ${f2(-r * 2)} 0Z`;

function person(col, cx, k) {
  const r = 12 * k, top = 32 + 4 * k, bot = 32 + 25 * k, l = cx - 17 * k, rr = cx + 17 * k;
  return ci(cx, f2(32 - 12 * k), f2(10 * k), col) +
    `<path d="M${f2(l)} ${f2(bot)}V${f2(top + r)}A${f2(r)} ${f2(r)} 0 0 1 ${f2(l + r)} ${f2(top)}H${f2(rr - r)}A${f2(r)} ${f2(r)} 0 0 1 ${f2(rr)} ${f2(top + r)}V${f2(bot)}Z" fill="${col}"/>`;
}

/** Thân glyph (không có thẻ svg). `F(c)` trả về fill có chuyển sắc của màu c. */
function draw(g, F) {
  const W = F(WHITE), T = F(TONE), Yl = F(YEL);
  switch (g) {
    case 'Battery':
      return `<path fill-rule="evenodd" fill="${W}" d="${rrd(6, 19, 44, 26, 5)}${rrd(10.5, 23.5, 35, 17, 2.5)}"/>` + rb(53, 32, 3.5, 6, 2, W) + rb(22, 32, 9.5, 6, 1.5, W);
    case 'Face0': case 'Face1': case 'Face2': case 'Face3': case 'Face4': {
      const l = +g[4];
      const colr = ['#e0483a', '#ef8a2e', '#f5d138', '#f5d138', '#79d64e'][l];
      let s = ci(32, 32, 27, F(colr)) + ci(23, 20, 6.5, '#fff', ' fill-opacity=".28"') + ci(23, 27, 3.8, INK) + ci(41, 27, 3.8, INK);
      const frown = `<path d="M22.78 46A11 11 0 0 1 41.22 46" stroke="${INK}" stroke-width="3.8" fill="none"/>`;
      if (l === 0) s += frown + sg([16, 17], [27, 22], 3.6, INK) + sg([48, 17], [37, 22], 3.6, INK);
      else if (l === 1) s += frown;
      else if (l === 2) s += sg([22, 43], [42, 43], 3.8, INK);
      else if (l === 3) s += `<path d="M21.61 39A12 12 0 0 0 42.39 39" stroke="${INK}" stroke-width="3.8" fill="none"/>`;
      else s += `<path d="M19.09 37.5H44.91A13 13 0 0 1 19.09 37.5Z" fill="${INK}"/>`;
      return s;
    }
    case 'Clock':
      return ci(32, 32, 25, W) + sg([32, 32], [32, 15], 4.2, INK) + sg([32, 32], [43, 38], 4.2, INK);
    case 'List': {
      let s = `<rect x="12" y="12" width="40" height="40" rx="4" fill="${Yl}" transform="rotate(45 32 32)"/>`;
      for (let k = 0; k < 3; k++) {
        const y = 24 + k * 8;
        s += ci(22.5, y, 2.3, INK) + sg([28, y], [42, y], 3.6, INK);
      }
      return s;
    }
    case 'Check':
      return pl([[13, 34], [26, 47], [51, 17]], 7.5, Yl);
    case 'Alert':
      return pg([[32, 12], [54, 50], [10, 50]], Yl, 4) + sg([32, 25], [32, 38], 5, INK) + ci(32, 46, 2.9, INK);
    case 'Skull':
      return ci(32, 27, 18.5, W) + rb(32, 46, 10.5, 8, 3, W) + ci(24, 28, 5.4, INK) + ci(40, 28, 5.4, INK) +
        pg([[32, 33.5], [35.5, 40], [28.5, 40]], INK) + [27.5, 32, 36.5].map((x) => sg([x, 47], [x, 55], 1.8, INK)).join('');
    case 'Gear': {
      let s = `<path fill-rule="evenodd" fill="${W}" d="${cd(32, 32, 17)}${cd(32, 32, 7.5)}"/>`;
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4, sn = Math.sin(a), cs = Math.cos(a);
        s += sg([f2(32 + cs * 15), f2(32 + sn * 15)], [f2(32 + cs * 23), f2(32 + sn * 23)], 4.5, W);
      }
      return s;
    }
    case 'Backpack':
      return `<path d="M25.07 18A7 7 0 0 1 38.93 18" stroke="${W}" stroke-width="${S}" fill="none"/>` + rb(32, 37, 18, 20, 9, W) + rb(32, 45, 11, 7.5, 3, T) + sg([17, 29], [47, 29], 3, T);
    case 'Globe':
      return `<circle cx="32" cy="32" r="23" fill="none" stroke="${W}" stroke-width="${S}"/>` +
        `<ellipse cx="32" cy="32" rx="10.35" ry="23" fill="none" stroke="${W}" stroke-width="4"/>` +
        sg([10, 32], [54, 32], S * 0.9, W) + sg([15, 20.5], [49, 20.5], S * 0.8, W) + sg([15, 43.5], [49, 43.5], S * 0.8, W);
    case 'Skills': {
      const pts = [[12, 44], [26, 24], [40, 40], [52, 20]];
      return pl(pts, S, T) + pts.map((q) => ci(q[0], q[1], 6.5, W)).join('');
    }
    case 'Staff':
      return person(W, 32, 1);
    case 'People':
      return person(T, 21, 0.78) + person(W, 40, 0.92);
    case 'MouseM': // [par-counter A06 / D06] bánh xe chuột (Cycle Slot, Forward/Back)
      return `<rect x="17" y="9" width="30" height="46" rx="15" fill="none" stroke="${W}" stroke-width="3.6"/>` +
        sg([18, 30], [46, 30], 3, W) + `<rect x="28.5" y="13" width="7" height="13" rx="3.5" fill="${W}"/>`;
    case 'MouseL': case 'MouseR': {
      const btn = g === 'MouseL' ? 'M32 30H17V24A15 15 0 0 1 32 9Z' : 'M32 30H47V24A15 15 0 0 0 32 9Z';
      return `<rect x="17" y="9" width="30" height="46" rx="15" fill="none" stroke="${W}" stroke-width="3.6"/>` +
        sg([32, 10], [32, 30], 3, W) + sg([18, 30], [46, 30], 3, W) + `<path d="${btn}" fill="${W}"/>`;
    }
    case 'MouseW':
      return `<rect x="17" y="9" width="30" height="46" rx="15" fill="none" stroke="${W}" stroke-width="3.6"/>` +
        sg([18, 30], [46, 30], 3, W) + rb(32, 20, 3.4, 7, 1.7, W);
    case 'Hand':
      return rb(34.5, 43, 13, 13, 6, W) + sg([22, 47], [12.5, 36], 6.6, W) +
        [[24.5, 21], [31.2, 13.5], [37.9, 14.5], [44.6, 21]].map(([x, top]) => sg([x, 40], [x, top], 5.8, W)).join('');
    case 'Lock':
      return `<path d="M22.5 32V26A9.5 9.5 0 0 1 41.5 26V32" stroke="${T}" stroke-width="${S}" stroke-linecap="round" fill="none"/>` +
        rb(32, 42, 15.5, 12, 4, W) + ci(32, 40, 3.2, INK) + sg([32, 40], [32, 47], 2.6, INK);
    case 'Cart':
      return pl([[8, 14], [17, 14], [23, 41]], S, T) + pg([[19, 21], [55, 21], [50, 41], [23, 41]], W, 1.5) +
        ci(27, 51, 4.6, W) + ci(46, 51, 4.6, W) + [30, 38, 46].map((x) => sg([x, 25], [x - 1, 37], 2.2, T)).join('');
    case 'Pistol':
      return sg([17, 30], [13, 47], 9, T) + rb(31, 23, 22, 7, 3, W) +
        `<path d="M23.39 31A5.5 5.5 0 1 0 32.61 31" stroke="${T}" stroke-width="3" fill="none"/>` + sg([14, 20.5], [50, 20.5], 2, T);
    case 'Hammer': {
      const dx = 22, dy = -26, l = Math.hypot(dx, dy), px = -dy / l, py = dx / l;
      return sg([18, 51], [40, 25], 6, T) + sg([f2(41 - px * 12), f2(23 - py * 12)], [f2(41 + px * 12), f2(23 + py * 12)], 6, W);
    }
    case 'Shield':
      return rb(32, 24, 18, 15, 5, W) + pg([[14, 30], [50, 30], [32, 56]], W, 1) +
        `<path d="M32 9H45A5 5 0 0 1 50 14V34A5 5 0 0 1 45 39L32.9 56.2L32 56.6Z" fill="${T}"/>`;
    case 'Heart':
      return ci(23, 25, 10.5, F('#e8544c')) + ci(41, 25, 10.5, F('#e8544c')) + pg([[13.6, 31], [50.4, 31], [32, 52]], F('#e8544c'), 0.6) +
        ci(20, 21, 3.6, '#fff', ' fill-opacity=".3"');
    case 'Crate':
      return rb(32, 34, 21, 18, 3.5, W) + sg([11, 27], [53, 27], 3.4, T) + sg([32, 16], [32, 52], 3.4, T);
    case 'Shop':
      return rb(32, 41, 20, 14, 2.5, W) + rb(32, 46, 6, 9, 1.5, T) + rb(32, 19, 25, 8, 3.5, W) + [17, 27, 37, 47].map((x) => rb(x, 19, 2.4, 8, 0.5, T)).join('');
    case 'Gate':
      return rb(13, 37, 4, 18, 2, T) + rb(51, 37, 4, 18, 2, T) + rb(32, 26, 24, 6, 3, W) +
        [20, 32, 44].map((x) => pg([[x - 4, 32], [x + 2, 32], [x + 6, 20], [x, 20]], F('#e0483a'))).join('');
    case 'Planks':
      return `<rect x="26" y="11" width="12" height="42" rx="1.5" fill="${T}" transform="matrix(1 0 -0.9 1 28.8 0)"/>` +
        `<rect x="26" y="11" width="12" height="42" rx="1.5" fill="${W}" transform="matrix(1 0 0.9 1 -28.8 0)"/>`;
    case 'Megaphone':
      return rb(21, 47, 3.6, 8, 2, T) + pg([[12, 26], [45, 12], [45, 52], [12, 38]], W, 1.5) + rb(50, 32, 3.2, 21, 3, T);
    case 'Anchor':
      return `<circle cx="32" cy="14" r="5.5" fill="none" stroke="${W}" stroke-width="${S * 0.9}"/>` + sg([32, 20], [32, 53], S, W) + sg([22, 27], [42, 27], S, W) +
        `<path d="M15.75 41A17 17 0 0 0 48.25 41" stroke="${W}" stroke-width="${S}" fill="none"/>`;
    case 'Wrench':
      // Lỗ khoét đầu cờ lê: hình tròn trừ đi rãnh (tính sẵn đường bao bằng evenodd trên phần giao).
      return sg([20, 46], [39, 24], 7.5, W) +
        `<path fill="${W}" d="M52.3 14.12A10.5 10.5 0 1 1 47.17 9.36L42.4 14.66A3.5 3.5 0 0 0 47.6 19.34Z"/>` +
        ci(19, 47, 2.6, T);
    case 'Truck':
      return rb(25, 30, 19, 13, 3, W) + pg([[45, 24], [53, 24], [59, 33], [59, 43], [45, 43]], T, 1) +
        ci(19, 46, 6.5, INK) + ci(48, 46, 6.5, INK) + ci(19, 46, 4.2, W) + ci(48, 46, 4.2, W);
    default:
      return '';
  }
}

let GID = 0;
const GCACHE = new Map();

/**
 * Chuỗi SVG của glyph `g` (tên trong G_ORDER). `node`: bản trong ô hình thoi tối. Mỗi lần gọi có id chuyển sắc riêng
 * (để nhiều bản cùng nằm trên trang mà không đụng id). Kích cỡ đặt bằng CSS (svg co theo khung chứa).
 */
export function glyph_svg(g, node = false) {
  const key = g + (node ? '#n' : '');
  let tpl = GCACHE.get(key);
  if (tpl === undefined) {
    const used = new Map();
    const F = (c) => {
      if (!used.has(c)) used.set(c, used.size);
      return `url(#g§_${used.get(c)})`;
    };
    let body = draw(g, F);
    if (node) {
      body = `<rect x="10.5" y="10.5" width="43" height="43" rx="4.5" fill="#6e757d" transform="rotate(45 32 32)"/>` +
        `<rect x="12.5" y="12.5" width="39" height="39" rx="3.5" fill="#1c1f23" transform="rotate(45 32 32)"/>` +
        `<g transform="translate(32 32) scale(.55) translate(-32 -32)">${body}</g>`;
    }
    // Chuyển sắc nhẹ từ trên (x1,06) xuống dưới (x0,90), như Canvas::fill.
    let defs = '';
    for (const [c, k] of used) {
      const v = parseInt(c.slice(1), 16);
      const ch = (s) => `rgb(${[16, 8, 0].map((b) => Math.min(255, Math.round(((v >> b) & 255) * s))).join(',')})`;
      defs += `<linearGradient id="g§_${k}" x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${ch(1.06)}"/><stop offset="1" stop-color="${ch(0.9)}"/></linearGradient>`;
    }
    tpl = `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`;
    GCACHE.set(key, tpl);
  }
  GID += 1;
  return tpl.split('§').join(String(GID));
}

/** HTML của một Icon bất kỳ (item chưa vẽ xong -> ô chờ). Trả [html, ready]. */
export function icon_html(icon) {
  if (icon === null || icon === undefined) return ['', true];
  switch (icon.k) {
    case 'Item': {
      const u = item_icon(icon.a);
      if (u === null) return ['<i class="ic-wait"></i>', false];
      return [`<img src="${u}" alt="" draggable="false">`, true];
    }
    case 'Glyph':
      return [glyph_svg(icon.a, false), true];
    case 'Node':
      return [glyph_svg(icon.a, true), true];
    default:
      return ['', true];
  }
}

/* VIEW NOTES (icons.js)
- Glyphs: `glyph_svg(g, node)` returns an inline SVG on a 64-unit canvas (same coordinates as icons.rs `draw`); size it
  with CSS. `node = true` puts the glyph (scaled 0.55) in the dark diamond (#6e757d rim, #1c1f23 face).
- Item icons: `item_icon(i)` -> PNG data URL (CELL = 128 px, transparent, dark outline + soft shadow) or null while not
  baked; asking for it queues it first. `bake()` must run once per frame (hud.update_hud calls it). `stats()` ->
  [baked, total] for bots (Rust exposed this as window.__twt.icons).
PORT GAPS: SDF anti-aliasing replaced by the browser's SVG rasteriser; the wrench jaw cut and the clipped person body
  are pre-computed outlines (visually identical within ~0.5 unit). Item icons render at 128 px instead of 64 px; the
  outline neighbourhood and the floor-shadow ellipse are scaled with the cell.
*/
