// Port of src/audio.rs (Âm thanh tổng hợp bằng code). Every sound is generated sample by sample with the same f32 DSP
// as the Rust (every f32 operation is rounded with Math.fround), then played through WebAudio by `Engine`.
//! Âm thanh tổng hợp bằng code: mỗi tiếng là một hàm sinh mẫu (nhiễu có hạt giống, sóng sin/răng cưa, lọc, đường bao),
//! nạp vào AudioBuffer của WebAudio khi cần. Không có file âm thanh nào.
import { Rng } from './sim/vec.js';

const F = Math.fround;
export const SR = 22050.0;
const TAU = F(Math.PI * 2);
const PI = F(Math.PI);
const fsin = (x) => F(Math.sin(x));
const fexp = (x) => F(Math.exp(x));
const fract = (x) => x - Math.trunc(x);
/** Rust `(x as f32) as usize` for a non-negative f32. */
const us = (x) => Math.trunc(x);
/** Rng::next() -> f32 (Rust casts the f64 quotient to f32). */
const rnext = (r) => F(r.next());
/** Rng::range in f32. */
const rrange = (r, a, b) => { a = F(a); b = F(b); return F(a + F(F(b - a) * rnext(r))); };
/** Rng::int in f32. */
const rint = (r, a, b) => a + Math.trunc(Math.min(Math.floor(F((b - a + 1) * rnext(r))), b - a));

/** Every one-shot name synth() knows (others fall to the default blip). */
export const SOUNDS = ['step', 'stepw', 'bell', 'pay', 'pick', 'place', 'drop', 'switch', 'click', 'deny', 'quest', 'level',
  'win', 'hurt', 'death', 'swing', 'hit', 'crit', 'wood', 'bang', 'break', 'groan', 'claw', 'zdie', 'tink', 'thud', 'lid',
  'scrape', 'swish', 'whoosh', 'shot', 'reload', 'roar', 'flame', 'wheel', 'boom', 'siren', 'raiders', 'radio', 'sweep',
  'loot', 'trash', 'door', 'heal', 'wake', 'sleep'];
/** [par-panels] Interface sounds: the Settings "Interface" bus (menus, quest / level jingles, refusals). */
export const UI_SOUNDS = new Set(['click', 'deny', 'quest', 'level']);
/** Ambience loop layers, in the order of `ambience(levels[5])`. */
export const AMB_LAYERS = ['amb_wind', 'amb_room', 'amb_night', 'amb_raid', 'amb_rain'];

class Buf {
  constructor(secs) { this.d = new Float32Array(us(F(F(secs) * SR))); }
  /// Sóng sin quét tần số f0→f1 trong `dur` giây, bắt đầu ở `at`, tắt dần theo exp(-t*decay).
  tone(at, dur, f0, f1, amp, decay) {
    at = F(at); dur = F(dur); f0 = F(f0); f1 = F(f1); amp = F(amp); decay = F(decay);
    const d = this.d;
    const s = us(F(at * SR));
    const n = us(F(dur * SR));
    const p3 = F(0.3);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      if (s + i >= d.length) break;
      const t = F(i / n);
      const f = F(f0 + F(F(f1 - f0) * t));
      ph = F(ph + F(F(f / SR) * TAU));
      const env = F(F(fexp(F(-F(i / SR) * decay)) * F(Math.pow(F(1 - t), p3))) * Math.min(F(i / 40), 1));
      d[s + i] = d[s + i] + F(F(fsin(ph) * amp) * env);
    }
  }
  /// Răng cưa có rung (cho tiếng gầm, còi).
  saw(at, dur, f0, f1, amp, vib, lp) {
    at = F(at); dur = F(dur); f0 = F(f0); f1 = F(f1); amp = F(amp); vib = F(vib); lp = F(lp);
    const d = this.d;
    const s = us(F(at * SR));
    const n = us(F(dur * SR));
    let ph = 0, y = 0;
    const a = Math.min(F(F(lp / SR) * TAU), 1);
    for (let i = 0; i < n; i++) {
      if (s + i >= d.length) break;
      const t = F(i / n);
      const f = F(F(f0 + F(F(f1 - f0) * t)) * F(1 + F(vib * fsin(F(F(i / SR) * 37)))));
      ph = fract(F(ph + F(f / SR)));
      const raw = F(F(ph * 2) - 1);
      y = F(y + F(F(raw - y) * a));
      const env = F(Math.min(F(t * 8), 1) * Math.min(F(F(1 - t) * 5), 1));
      d[s + i] = d[s + i] + F(F(y * amp) * env);
    }
  }
  /// Nhiễu qua lọc thông thấp quét lp0→lp1 (Hz), có thể trừ phần trầm (hp).
  noise(r, at, dur, lp0, lp1, hp, amp, decay) {
    at = F(at); dur = F(dur); lp0 = F(lp0); lp1 = F(lp1); amp = F(amp); decay = F(decay);
    const d = this.d;
    const s = us(F(at * SR));
    const n = us(F(dur * SR));
    let y = 0;
    for (let i = 0; i < n; i++) {
      if (s + i >= d.length) break;
      const t = F(i / n);
      const a = Math.min(F(F(F(lp0 + F(F(lp1 - lp0) * t)) / SR) * TAU), 1);
      const w = F(F(rnext(r) * 2) - 1);
      y = F(y + F(F(w - y) * a));
      const v = hp ? F(w - y) : y;
      const env = F(F(fexp(F(-F(i / SR) * decay)) * Math.min(F(i / 30), 1)) * Math.min(F(F(1 - t) * 12), 1));
      d[s + i] = d[s + i] + F(F(v * amp) * env);
    }
  }
  /// Tiếng dội (slap-back của tường nhà / dãy xe): chép tín hiệu trễ `delay` giây, nhỏ đi `gain`, qua lọc thông thấp `lp`.
  echo(delay, gain, lp) {
    delay = F(delay); gain = F(gain); lp = F(lp);
    const d = this.d;
    const dl = us(F(delay * SR));
    const a = Math.min(F(F(lp / SR) * TAU), 1);
    const src = d.slice();
    let y = 0;
    for (let i = dl; i < d.length; i++) {
      y = F(y + F(F(src[i - dl] - y) * a));
      d[i] = d[i] + F(y * gain);
    }
  }
  /// Hạt lách tách (túi ni-lông, sỏi): `n` xung ngắn ngẫu nhiên trong khoảng, mỗi xung là nhiễu cao tần tắt rất nhanh.
  grains(r, at, dur, n, amp, lp) {
    at = F(at); dur = F(dur); amp = F(amp); lp = F(lp);
    const d = this.d;
    for (let k = 0; k < n; k++) {
      const s = us(F(F(at + F(rnext(r) * dur)) * SR));
      const len = F(F(F(0.002) + F(rnext(r) * F(0.006))) * SR);
      const g = F(amp * F(F(0.3) + F(F(0.7) * rnext(r))));
      const a = Math.min(F(F(lp / SR) * TAU), 1);
      let y = 0, prev = 0;
      const m = us(len);
      for (let i = 0; i < m; i++) {
        if (s + i >= d.length) break;
        const w = F(F(rnext(r) * 2) - 1);
        y = F(y + F(F(w - y) * a));
        const hp = F(y - prev);
        prev = y;
        d[s + i] = d[s + i] + F(F(F(hp * g) * fexp(F(F(-i / len) * 4))) * 3);
      }
    }
  }
  /// Nhiễu dải thông (hiệu của hai lọc thông thấp), đường bao tấn công `att` giây rồi tắt dần `decay`.
  band(r, at, dur, lo, hi, amp, att, decay) {
    at = F(at); dur = F(dur); lo = F(lo); hi = F(hi); amp = F(amp); att = F(att); decay = F(decay);
    const d = this.d;
    const s = us(F(at * SR));
    const n = us(F(dur * SR));
    const a1 = Math.min(F(F(hi / SR) * TAU), 1), a2 = Math.min(F(F(lo / SR) * TAU), 1);
    const attm = Math.max(att, F(1e-4));
    const tail = F(F(0.01) * SR);
    let y1 = 0, y2 = 0;
    for (let i = 0; i < n; i++) {
      if (s + i >= d.length) break;
      const w = F(F(rnext(r) * 2) - 1);
      y1 = F(y1 + F(F(w - y1) * a1));
      y2 = F(y2 + F(F(y1 - y2) * a2));
      const tt = F(i / SR);
      const env = F(F(Math.min(F(tt / attm), 1) * fexp(F(-Math.max(F(tt - att), 0) * decay))) * Math.min(F((n - i) / tail), 1));
      d[s + i] = d[s + i] + F(F(F(y1 - y2) * amp) * env);
    }
  }
  norm(peak) {
    peak = F(peak);
    const d = this.d;
    let m = 0;
    for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
    m = Math.max(m, F(1e-5));
    const q = F(peak / m);
    for (let i = 0; i < d.length; i++) d[i] = d[i] * q;
    return d;
  }
}

/// Mức đích (dBFS, RMS của 50 ms to nhất) theo nhóm tiếng. Đo bằng tools/sndcheck: trước khi cân, các tiếng lệch nhau tới 14 dB
/// (sweep -19,5; claw -7,2) và amb_raid vượt đỉnh (79 mẫu cắt).
export function target_db(name) {
  switch (name) {
    case 'click': case 'switch': case 'pick': case 'loot': case 'quest': case 'pay': case 'bell': case 'deny': case 'radio': case 'sleep': return -14.0;
    case 'step': case 'stepw': return -15.0;
    case 'sweep': case 'trash': case 'door': case 'wood': case 'swing': return -13.0;
    case 'boom': case 'siren': case 'roar': return -8.5;
    case 'shot': return -9.5;
    case 'reload': case 'wheel': return -14.0;
    case 'tink': return -20.0;
    case 'thud': case 'lid': case 'scrape': case 'swish': return -15.0;
    case 'whoosh': return -10.0;
    case 'amb_night': return -18.0;
    case 'amb_raid': return -14.0;
    case 'amb_rain': return -16.0;
    default: return -10.5;
  }
}

/** RMS of the loudest 50 ms window (hop w/2), the same measure synth() normalises with (f32 sum). */
export function loud_rms(d) {
  const w = Math.min(us(F(F(0.05) * SR)), Math.max(d.length, 1));
  let loud = F(1e-6);
  let i = 0;
  while (i + w <= d.length) {
    let sum = 0;
    for (let j = i; j < i + w; j++) sum = F(sum + F(d[j] * d[j]));
    loud = Math.max(loud, F(Math.sqrt(F(sum / w))));
    i += Math.max(Math.trunc(w / 2), 1);
  }
  return loud;
}

/// Sinh mẫu cho một tiếng theo tên rồi cân độ to về mức đích của nhóm; đỉnh không quá 0,95.
export function synth(name, v) {
  const d = synth_raw(name, v);
  const loud = loud_rms(d);
  let k = F(F(Math.pow(10, F(F(target_db(name)) / 20))) / loud);
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  peak = Math.max(peak, F(1e-6));
  k = Math.min(k, F(F(0.95) / peak));
  for (let i = 0; i < d.length; i++) d[i] = d[i] * k;
  return d;
}

/** Crossfaded 4 s loop normalised to peak 0.6 (the `out.iter().map(|x| x / m * 0.6)` tail). */
function norm06(out) {
  let m = 0;
  for (let i = 0; i < out.length; i++) m = Math.max(m, Math.abs(out[i]));
  m = Math.max(m, F(1e-5));
  const p6 = F(0.6);
  for (let i = 0; i < out.length; i++) out[i] = F(F(out[i] / m) * p6);
  return out;
}

export function synth_raw(name, v) {
  v = v >>> 0;
  const r = Rng.named(name);
  r.s = (r.s + Math.imul(v, 7919)) >>> 0;
  const k = F(1 + F(F(v - 1) * F(0.07)));
  const m = (a, b) => F(F(a) * F(b));
  switch (name) {
    case 'step': {
      // Bước ngoài trời (nhựa đường / bê tông có sạn): gót chạm (nhiễu trầm rất ngắn), mũi giày miết sạn (hạt lách tách),
      // không có âm sắc cao độ.
      const b = new Buf(0.2);
      b.band(r, 0.0, 0.05, 60.0, m(700.0, k), 1.0, 0.002, 70.0);
      b.grains(r, 0.012, 0.07, 14, 0.35, 6000.0);
      b.band(r, 0.02, 0.08, 1500.0, 5000.0, 0.18, 0.01, 40.0);
      return b.norm(0.7);
    }
    case 'stepw': {
      // Sàn gỗ trong nhà: tiếng gõ đục của ván (dải 150..1200 Hz), một chút cộng hưởng hộp sàn rất ngắn, bụi sạn nhẹ.
      const b = new Buf(0.2);
      b.band(r, 0.0, 0.07, m(150.0, k), 1200.0, 1.0, 0.002, 55.0);
      b.band(r, 0.004, 0.09, 90.0, 260.0, 0.5, 0.004, 38.0);
      b.grains(r, 0.01, 0.05, 5, 0.12, 4500.0);
      return b.norm(0.7);
    }
    case 'bell': {
      const b = new Buf(1.1);
      for (const [at, f] of [[0.0, 1320.0], [0.17, 1760.0]]) {
        b.tone(at, 0.9, f, f, 1.0, 5.0);
        b.tone(at, 0.6, m(f, 2.01), m(f, 2.01), 0.4, 8.0);
        b.tone(at, 0.4, m(f, 2.99), m(f, 2.99), 0.2, 12.0);
      }
      return b.norm(0.6);
    }
    case 'pay': {
      const b = new Buf(0.9);
      for (let i = 0; i < 4; i++) {
        const f = F(2600.0 + rrange(r, 0.0, 1800.0));
        b.tone(m(i, 0.055), 0.09, f, m(f, 0.98), 0.6, 40.0);
      }
      b.tone(0.24, 0.6, 1760.0, 1760.0, 1.0, 6.0);
      b.tone(0.24, 0.5, 2637.0, 2637.0, 0.6, 8.0);
      b.noise(r, 0.2, 0.06, 6000.0, 2000.0, true, 0.25, 50.0);
      return b.norm(0.7);
    }
    case 'pick': {
      const b = new Buf(0.12);
      b.tone(0.0, 0.06, m(420.0, k), m(700.0, k), 1.0, 30.0);
      b.noise(r, 0.0, 0.03, 4000.0, 1500.0, false, 0.4, 70.0);
      return b.norm(0.6);
    }
    case 'place': case 'drop': {
      const b = new Buf(0.2);
      const f = name === 'drop' ? 120.0 : 190.0;
      b.tone(0.0, 0.1, m(f, k), m(f, 0.5), 1.0, 28.0);
      b.noise(r, 0.0, 0.05, 1800.0, 500.0, false, 0.6, 50.0);
      return b.norm(0.7);
    }
    case 'switch': {
      const b = new Buf(0.2);
      b.noise(r, 0.0, 0.015, 8000.0, 4000.0, true, 1.0, 200.0);
      b.noise(r, 0.07, 0.02, 6000.0, 2000.0, true, 0.8, 150.0);
      b.tone(0.07, 0.05, 900.0, 700.0, 0.4, 60.0);
      return b.norm(0.7);
    }
    case 'click': {
      const b = new Buf(0.06);
      b.tone(0.0, 0.03, m(1500.0, k), 1200.0, 1.0, 90.0);
      return b.norm(0.5);
    }
    case 'deny': {
      const b = new Buf(0.25);
      b.saw(0.0, 0.09, 160.0, 150.0, 1.0, 0.0, 900.0);
      b.saw(0.12, 0.11, 130.0, 120.0, 1.0, 0.0, 900.0);
      return b.norm(0.5);
    }
    case 'quest': {
      const b = new Buf(0.9);
      [659.0, 880.0, 1318.0].forEach((f, i) => {
        b.tone(m(i, 0.09), 0.6, f, f, 1.0, 6.0);
        b.tone(m(i, 0.09), 0.4, m(f, 2.0), m(f, 2.0), 0.25, 10.0);
      });
      return b.norm(0.55);
    }
    case 'level': case 'win': {
      const b = new Buf(1.4);
      const notes = name === 'win' ? [523.0, 659.0, 784.0, 1046.0, 1318.0] : [523.0, 784.0, 1046.0, 1568.0];
      notes.forEach((f, i) => {
        b.tone(m(i, 0.12), 0.8, f, f, 1.0, 4.0);
        b.saw(m(i, 0.12), 0.3, m(f, 0.5), m(f, 0.5), 0.25, 0.0, 1800.0);
      });
      return b.norm(0.6);
    }
    case 'hurt': {
      const b = new Buf(0.35);
      b.noise(r, 0.0, 0.12, 1500.0, 300.0, false, 1.0, 20.0);
      b.saw(0.0, 0.3, m(150.0, k), 70.0, 0.7, 0.03, 700.0);
      return b.norm(0.8);
    }
    case 'death': {
      const b = new Buf(1.6);
      b.saw(0.0, 1.5, 200.0, 40.0, 1.0, 0.02, 500.0);
      b.tone(0.0, 1.5, 110.0, 30.0, 0.8, 1.5);
      b.noise(r, 0.0, 0.3, 900.0, 100.0, false, 0.6, 8.0);
      return b.norm(0.8);
    }
    case 'swing': {
      const b = new Buf(0.3);
      b.noise(r, 0.0, 0.26, 500.0, 3800.0, false, 1.0, 6.0);
      return b.norm(0.45);
    }
    case 'hit': case 'crit': {
      const b = new Buf(0.28);
      b.tone(0.0, 0.12, m(170.0, k), 55.0, 1.0, 22.0);
      b.noise(r, 0.0, 0.07, 3500.0, 500.0, false, 0.9, 40.0);
      if (name === 'crit') {
        b.noise(r, 0.0, 0.05, 9000.0, 4000.0, true, 0.7, 60.0);
        b.tone(0.0, 0.1, 620.0, 300.0, 0.4, 30.0);
      }
      return b.norm(0.85);
    }
    case 'wood': {
      const b = new Buf(0.25);
      b.tone(0.0, 0.1, m(260.0, k), 120.0, 1.0, 26.0);
      b.tone(0.0, 0.06, m(610.0, k), 480.0, 0.4, 45.0);
      b.noise(r, 0.0, 0.05, 4000.0, 900.0, false, 0.7, 50.0);
      return b.norm(0.8);
    }
    case 'bang': {
      const b = new Buf(0.45);
      b.tone(0.0, 0.25, m(105.0, k), 42.0, 1.0, 12.0);
      b.noise(r, 0.0, 0.12, 1500.0, 250.0, false, 0.9, 22.0);
      b.noise(r, 0.06, 0.25, 5000.0, 2500.0, true, 0.15, 14.0);
      return b.norm(0.9);
    }
    case 'break': {
      const b = new Buf(0.8);
      for (let i = 0; i < 7; i++) {
        const at = rrange(r, 0.0, 0.35);
        b.noise(r, at, 0.14, 5000.0, 600.0, i % 2 === 0, 0.7, 22.0);
        b.tone(at, 0.08, rrange(r, 200.0, 600.0), 120.0, 0.4, 35.0);
      }
      b.tone(0.0, 0.3, 90.0, 40.0, 1.0, 10.0);
      return b.norm(0.9);
    }
    case 'groan': {
      const b = new Buf(1.5);
      const f = m(78.0, k);
      b.saw(0.0, 1.35, f, m(f, 0.82), 1.0, 0.06, 520.0);
      b.saw(0.05, 1.2, m(f, 1.51), m(f, 1.2), 0.5, 0.09, 900.0);
      b.noise(r, 0.1, 1.1, 700.0, 350.0, false, 0.35, 1.5);
      return b.norm(0.7);
    }
    case 'claw': {
      const b = new Buf(0.4);
      b.noise(r, 0.0, 0.2, 2500.0, 6000.0, true, 0.8, 10.0);
      b.saw(0.0, 0.32, m(140.0, k), 90.0, 0.9, 0.12, 800.0);
      return b.norm(0.75);
    }
    case 'zdie': {
      const b = new Buf(1.0);
      b.saw(0.0, 0.7, m(120.0, k), 45.0, 1.0, 0.08, 600.0);
      b.tone(0.55, 0.2, 90.0, 40.0, 0.9, 14.0);
      b.noise(r, 0.55, 0.12, 1200.0, 300.0, false, 0.6, 25.0);
      return b.norm(0.75);
    }
    case 'tink': {
      // Vỏ đạn đồng chạm đất: hai tiếng kim loại cao, tắt nhanh.
      const b = new Buf(0.25);
      b.tone(0.0, 0.06, m(5200.0, k), 4700.0, 0.8, 60.0);
      b.tone(0.0, 0.05, 7900.0, 7400.0, 0.4, 70.0);
      b.tone(0.09, 0.05, m(4800.0, k), 4500.0, 0.45, 70.0);
      return b.norm(0.6);
    }
    case 'thud': {
      // Túi rác rơi vào đống rác trong thùng: tiếng bịch trầm + sột soạt ni-lông.
      const b = new Buf(0.35);
      b.noise(r, 0.0, 0.12, 900.0, 200.0, false, 1.0, 22.0);
      b.tone(0.0, 0.25, m(95.0, k), 60.0, 1.0, 14.0);
      b.noise(r, 0.02, 0.22, 5000.0, 2500.0, true, 0.25, 16.0);
      return b.norm(0.7);
    }
    case 'lid': {
      // Nắp và thành thùng sắt rung.
      const b = new Buf(0.6);
      b.tone(0.0, 0.5, m(412.0, k), 405.0, 0.7, 8.0);
      b.tone(0.0, 0.4, 655.0, 648.0, 0.5, 10.0);
      b.tone(0.0, 0.3, 1130.0, 1120.0, 0.3, 14.0);
      b.noise(r, 0.0, 0.04, 4000.0, 1500.0, false, 0.8, 60.0);
      return b.norm(0.6);
    }
    case 'scrape': {
      // Xác lê trên nền.
      const b = new Buf(0.45);
      b.noise(r, 0.0, 0.4, 500.0, 300.0, false, 0.8, 5.0);
      b.noise(r, 0.05, 0.3, 2500.0, 1200.0, true, 0.25, 7.0);
      return b.norm(0.55);
    }
    case 'swish': {
      // Vung tay ném.
      const b = new Buf(0.25);
      b.noise(r, 0.0, 0.22, 1200.0, 3500.0, true, 0.8, 10.0);
      return b.norm(0.5);
    }
    case 'whoosh': {
      // Tên lửa rời ống: tiếng phụt + rít.
      const b = new Buf(0.7);
      b.noise(r, 0.0, 0.6, 5000.0, 600.0, false, 1.0, 5.0);
      b.tone(0.0, 0.5, 180.0, 70.0, 0.6, 6.0);
      return b.norm(0.85);
    }
    case 'shot': {
      // Phát súng nhiều lớp: tiếng nổ chát đầu nòng (xung rộng dải, vài ms), thân tiếng (nhiễu 300..3000 Hz tắt nhanh),
      // cú đấm trầm (sub 45..90 Hz, xung chứ không phải tông), tiếng máy (khoá nòng lùi / tới), đuôi rền xa, và tiếng dội
      // từ tường nhà + dãy xe (slap-back 0,11 s và 0,23 s).
      const b = new Buf(0.9);
      b.band(r, 0.0, 0.012, 2500.0, 11000.0, 0.9, 0.0004, 380.0);
      b.band(r, 0.0, 0.25, m(300.0, k), 3200.0, 1.0, 0.002, 24.0);
      b.band(r, 0.0, 0.18, 30.0, 140.0, 1.0, 0.003, 22.0);
      b.grains(r, 0.035, 0.012, 3, 0.12, 9000.0);
      b.grains(r, 0.085, 0.015, 3, 0.09, 7000.0);
      b.band(r, 0.02, 0.6, 80.0, 900.0, 0.32, 0.03, 5.5);
      b.echo(0.11, 0.32, 2200.0);
      b.echo(0.23, 0.14, 1200.0);
      return b.norm(0.92);
    }
    case 'reload': {
      const b = new Buf(0.5);
      // Nạp đạn: lẫy nhả băng (click kim loại), băng trượt ra (cọ nhựa), băng mới vào ổ (cú chạm đục + click khoá).
      b.band(r, 0.0, 0.012, 2500.0, 9000.0, 0.8, 0.0005, 300.0);
      b.band(r, 0.02, 0.12, 900.0, 4000.0, 0.25, 0.03, 18.0);
      b.band(r, 0.3, 0.04, 120.0, 1500.0, 1.0, 0.001, 70.0);
      b.band(r, 0.315, 0.012, 3000.0, 10000.0, 0.7, 0.0005, 320.0);
      return b.norm(0.7);
    }
    case 'roar': {
      // Tiếng gầm: luồng hơi qua cổ họng (nhiễu dải trầm có nhịp rung 22..30 Hz của dây thanh), hai dải "khẩu hình"
      // 350..900 và 900..2200 Hz đổi độ to theo thời gian, hơi khàn cuối tiếng. Không có răng cưa / tông đơn.
      const b = new Buf(2.0);
      const n = us(F(F(1.9) * SR));
      const c12 = F(0.12), c045 = F(0.045), c42 = F(0.42), c55 = F(0.55), c45 = F(0.45), c19 = F(1.9), c5 = F(0.5);
      const c6 = F(0.6), c4 = F(0.4), c23 = F(2.3), c16 = F(1.6), c12b = F(1.2), c35 = F(0.35), k26 = F(26.0 * k);
      let y1 = 0, y2 = 0, y3 = 0;
      for (let i = 0; i < n; i++) {
        const tt = F(i / SR);
        const w = F(F(rnext(r) * 2) - 1);
        y1 = F(y1 + F(F(w - y1) * c12));
        y2 = F(y2 + F(F(y1 - y2) * c045));
        y3 = F(y3 + F(F(w - y3) * c42));
        const rasp = F(c55 + F(c45 * fsin(F(F(tt * F(k26 + F(6 * fsin(F(tt * 3))))) * TAU))));
        const env = F(Math.min(F(tt / c12), 1) * Math.min(Math.max(F(F(c19 - tt) / c5), 0), 1));
        const mouth = F(c6 + F(c4 * fsin(F(tt * c23))));
        const A = F(F(F(y1 - y2) * c16) * mouth);
        const B = F(y2 * c12b);
        const C = F(F(F(y3 - y1) * c35) * F(1 - mouth));
        b.d[i] = b.d[i] + F(F(F(F(A + B) + C) * rasp) * env);
      }
      return b.norm(0.85);
    }
    case 'flame': {
      const b = new Buf(0.5);
      b.noise(r, 0.0, 0.48, 1800.0, 900.0, false, 1.0, 1.5);
      b.noise(r, 0.0, 0.48, 6000.0, 4000.0, true, 0.3, 1.0);
      return b.norm(0.6);
    }
    case 'wheel': {
      const b = new Buf(0.12);
      b.tone(0.0, 0.03, m(1400.0, k), 900.0, 1.0, 60.0);
      b.noise(r, 0.0, 0.02, 7000.0, 4000.0, true, 0.5, 90.0);
      return b.norm(0.6);
    }
    case 'boom': {
      const b = new Buf(1.4);
      b.noise(r, 0.0, 1.3, 6000.0, 120.0, false, 1.0, 3.5);
      b.tone(0.0, 0.9, 70.0, 28.0, 1.0, 4.0);
      b.noise(r, 0.0, 0.05, 9000.0, 5000.0, true, 0.8, 60.0);
      return b.norm(0.95);
    }
    case 'siren': {
      const b = new Buf(3.2);
      for (let i = 0; i < 2; i++) {
        const t0 = m(i, 1.6), t1 = F(m(i, 1.6) + F(0.8));
        b.tone(t0, 0.8, 420.0, 880.0, 1.0, 0.0);
        b.tone(t1, 0.8, 880.0, 420.0, 1.0, 0.0);
        b.saw(t0, 0.8, 420.0, 880.0, 0.3, 0.0, 2500.0);
        b.saw(t1, 0.8, 880.0, 420.0, 0.3, 0.0, 2500.0);
      }
      return b.norm(0.6);
    }
    case 'raiders': {
      const b = new Buf(1.6);
      b.saw(0.0, 1.5, 98.0, 92.0, 1.0, 0.01, 700.0);
      b.saw(0.0, 1.5, 147.0, 138.0, 0.7, 0.01, 900.0);
      b.tone(0.0, 0.5, 55.0, 40.0, 1.0, 5.0);
      return b.norm(0.7);
    }
    case 'radio': {
      const b = new Buf(0.8);
      b.noise(r, 0.0, 0.7, 3000.0, 2500.0, true, 0.5, 1.0);
      b.tone(0.15, 0.1, 980.0, 980.0, 0.8, 2.0);
      b.tone(0.32, 0.1, 980.0, 980.0, 0.8, 2.0);
      b.tone(0.49, 0.16, 1310.0, 1310.0, 0.8, 2.0);
      return b.norm(0.5);
    }
    case 'sweep': {
      const b = new Buf(0.5);
      b.noise(r, 0.0, 0.2, 3000.0, 7000.0, true, 0.9, 6.0);
      b.noise(r, 0.24, 0.2, 7000.0, 3000.0, true, 0.7, 8.0);
      return b.norm(0.5);
    }
    case 'loot': {
      const b = new Buf(0.5);
      for (let i = 0; i < 6; i++) {
        b.noise(r, m(i, 0.06), 0.05, 5000.0, 2500.0, i % 2 === 0, 0.7, 30.0);
      }
      b.tone(0.36, 0.1, 700.0, 1000.0, 0.5, 20.0);
      return b.norm(0.55);
    }
    case 'trash': {
      // Túi rác ni-lông: sột soạt (nhiều hạt cao tần) + cú bịch đục khi rơi; bỏ hai tông ngân cũ.
      const b = new Buf(0.6);
      b.grains(r, 0.0, 0.35, 70, 0.5, 8000.0);
      b.band(r, 0.0, 0.3, 1500.0, 7000.0, 0.25, 0.05, 9.0);
      b.band(r, 0.32, 0.12, 60.0, 500.0, 1.0, 0.003, 30.0);
      return b.norm(0.7);
    }
    case 'door': {
      const b = new Buf(0.7);
      b.saw(0.0, 0.45, m(290.0, k), m(390.0, k), 0.6, 0.15, 1500.0);
      b.tone(0.48, 0.12, 140.0, 70.0, 1.0, 25.0);
      b.noise(r, 0.48, 0.05, 2000.0, 500.0, false, 0.6, 50.0);
      return b.norm(0.6);
    }
    case 'heal': {
      // Xé băng gạc rồi quấn: tiếng vải xé (hạt dày) + sột soạt.
      const b = new Buf(0.9);
      b.grains(r, 0.0, 0.25, 90, 0.6, 9000.0);
      b.band(r, 0.3, 0.5, 1200.0, 6000.0, 0.3, 0.08, 4.0);
      return b.norm(0.5);
    }
    case 'wake': case 'sleep': {
      // Thở ra / hít vào chậm (nhiễu dải 300..2500 Hz lên rồi xuống), chăn sột soạt.
      const b = new Buf(1.4);
      b.band(r, 0.0, 1.2, 300.0, 2500.0, 0.6, 0.45, 2.5);
      b.grains(r, 0.2, 0.8, 25, 0.12, 5000.0);
      return b.norm(0.45);
    }
    // Vòng lặp nền 4 giây: thành phần tuần hoàn theo số chu kỳ nguyên, nhiễu được trộn chéo hai đầu.
    case 'amb_wind': case 'amb_room': {
      const n = us(F(4.0 * SR));
      const d = new Float32Array(n + 4000);
      let y = 0;
      const lp = name === 'amb_wind' ? 420.0 : 150.0;
      const a = F(F(lp / SR) * TAU);
      const c65 = F(0.65), c35 = F(0.35), c02 = F(0.02);
      for (let i = 0; i < d.length; i++) {
        y = F(y + F(F(F(F(rnext(r) * 2) - 1) - y) * a));
        const gust = F(c65 + F(c35 * fsin(F(F(i / n) * TAU))));
        d[i] = F(y * gust);
      }
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const w = i < 4000 ? F(i / 4000) : 1.0;
        out[i] = F(F(d[i] * w) + (i < 4000 ? F(d[n + i] * F(1 - w)) : 0));
        if (name === 'amb_room') {
          out[i] = out[i] + F(fsin(F(F(F(i / SR) * 55) * TAU)) * c02);
        }
      }
      return norm06(out);
    }
    case 'amb_night': {
      const n = us(F(4.0 * SR));
      const out = new Float32Array(n);
      const len = us(F(F(0.045) * SR));
      const lenf = F(F(0.045) * SR);
      const c3 = F(0.3);
      for (const [c, f] of [[0.0, 4200.0], [F(1.3), 3800.0], [F(2.6), 4600.0]]) {
        for (let rep = 0; rep < 6; rep++) {
          const at = F(c + F(rep * F(0.085)));
          const s = us(F(at * SR));
          for (let i = 0; i < len; i++) {
            const idx = (s + i) % n;
            const e = fsin(F(F(i / lenf) * PI));
            out[idx] = out[idx] + F(F(fsin(F(F(F(i / SR) * f) * TAU)) * e) * c3);
          }
        }
      }
      return out;
    }
    case 'amb_raid': {
      const n = us(F(4.0 * SR));
      const out = new Float32Array(n);
      let y1 = 0, dph = 0;
      const c03 = F(0.03), c7 = F(0.7), c22 = F(2.2), c6 = F(0.6), c4 = F(0.4);
      for (let i = 0; i < n; i++) {
        const t = F(i / SR);
        const beat = fract(F(t * 2));
        // Trống trầm: pha cộng dồn (công thức cũ sin(t * f(t)) quét tần số lên tới vài kHz như tiếng tia laser).
        dph = F(dph + F(F(48 + F(34 * fexp(F(-beat * 18)))) / SR));
        dph = fract(dph);
        const drum = F(fsin(F(dph * TAU)) * fexp(F(-beat * 7)));
        // Nền raid: tiếng trống trầm + tiếng ầm ầm của đàn zombie (nhiễu trầm phập phồng), bỏ hai tông 55 / 58,5 Hz.
        y1 = F(y1 + F(F(F(F(rnext(r) * 2) - 1) - y1) * c03));
        const surge = F(c6 + F(c4 * fsin(F(F(t / 4) * TAU))));
        out[i] = F(F(drum * c7) + F(F(y1 * c22) * surge));
      }
      return out;
    }
    case 'amb_rain': {
      // Mưa: lớp rào rào rộng dải (nhiễu hồng gần đúng, lọc 300..6000 Hz) + hạt lộp độp nhỏ dày; không có giọt ngân cao độ.
      // Vòng lặp 4 giây trộn chéo hai đầu như gió.
      const n = us(F(4.0 * SR));
      const b = new Buf(4.3);
      b.band(r, 0.0, 4.2, 300.0, 6000.0, 1.0, 0.0, 0.0);
      b.band(r, 0.0, 4.2, 60.0, 400.0, 0.5, 0.0, 0.0);
      b.grains(r, 0.0, 4.2, 900, 0.18, 7000.0);
      const d = b.d;
      const x = us(F(F(0.2) * SR));
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        if (i < x) { const w = F(i / x); out[i] = F(F(d[i] * w) + F(d[n + i] * F(1 - w))); } else out[i] = d[i];
      }
      return norm06(out);
    }
    default: {
      const b = new Buf(0.1);
      b.tone(0.0, 0.05, 800.0, 600.0, 1.0, 40.0);
      return b.norm(0.4);
    }
  }
}

/** Offline stats for one sample array (node-safe). `rms_db` is the loudest-50 ms RMS that synth() normalises. */
export function stats(name, d) {
  let peak = 0, sq = 0, clipped = 0, nan = false;
  for (let i = 0; i < d.length; i++) {
    const x = d[i];
    if (!Number.isFinite(x)) { nan = true; continue; }
    const a = Math.abs(x);
    if (a > peak) peak = a;
    if (a >= 1) clipped++;
    sq += x * x;
  }
  const loud = loud_rms(d);
  return { name, peak, rms: Math.sqrt(sq / Math.max(d.length, 1)), rms_db: 20 * Math.log10(loud), target_db: target_db(name), clipped, nan, len: d.length };
}

/** Every sound and ambience layer synthesised offline (one-shots at variant 1, loops at variant 0 as the engine uses). */
export function selfTest() {
  const out = [];
  for (const n of SOUNDS) out.push(stats(n, synth(n, 1)));
  for (const n of AMB_LAYERS) out.push(stats(n, synth(n, 0)));
  return out;
}

/** Port of the wasm `imp` module: WebAudio playback. Install with `audio.install(new Engine())`. */
export class Engine {
  constructor() {
    this.a = null;          // Audio { ctx, master, bufs, loops, rng }
    this.off = false;       // OFF
    this.vol = 0.8;         // VOL
    this.listener = null;   // { pos: {x,y,z}, yaw } (three.js-only addition, for positional play)
    this.ext = null;        // attach(): { ctx, dest, dest3d } shared with another engine's mixer (three.js-only addition)
    // [par-panels] Settings buses (three.js-only addition): sfx scales the one-shots, amb the 5 ambience loops, ui the
    // interface sounds (UI_SOUNDS). With attach() the loops go to `destAmb` and the UI sounds to `destUi` when given.
    this.mix = { sfx: 1, amb: 1, ui: 1 };
    this._unlock = null;
    if (typeof window !== 'undefined' && window.addEventListener) {
      // AudioContext is created / resumed on the first user gesture (browsers block audio before one).
      this._unlock = () => { this.ensure(); if (this.a && this.a.ctx.state === 'running') this._detach(); };
      for (const ev of ['pointerdown', 'keydown', 'touchend', 'mousedown']) window.addEventListener(ev, this._unlock, { capture: true, passive: true });
    }
  }
  _detach() {
    if (!this._unlock) return;
    for (const ev of ['pointerdown', 'keydown', 'touchend', 'mousedown']) window.removeEventListener(ev, this._unlock, { capture: true });
    this._unlock = null;
  }
  disable() { this.off = true; }
  /** Play through another engine's AudioContext and mixer: one-shots and loops go into `dest`, positional one-shots
   *  through a PannerNode (listener = the shared context's listener) into `dest3d`. Drops any context made before. */
  attach(ctx, dest, dest3d, destAmb, destUi) {
    if (this.a && this.a.ctx !== ctx) { try { this.a.ctx.close(); } catch (e) { /* ignore */ } this.a = null; }
    this.ext = { ctx, dest, dest3d: dest3d || dest, destAmb: destAmb || null, destUi: destUi || null };
  }
  set_volume(v) {
    this.vol = v;
    this.levels();
  }
  /** [par-panels] Settings bus multipliers { sfx, amb, ui } (each node = vol x its multiplier). */
  set_mix(m) {
    for (const k of ['sfx', 'amb', 'ui']) if (typeof m[k] === 'number' && Number.isFinite(m[k])) this.mix[k] = Math.max(0, m[k]);
    this.levels();
  }
  levels() {
    const a = this.a;
    if (!a) return;
    a.master.gain.value = this.vol * this.mix.sfx;
    a.amb.gain.value = this.vol * this.mix.amb;
    a.ui.gain.value = this.vol * this.mix.ui;
  }
  /** Listener for positional `play(name, vol, pos)`: yaw as in Bevy (forward = rot_y(yaw, -Z)). */
  set_listener(pos, yaw) { this.listener = { pos: { x: pos.x, y: pos.y, z: pos.z }, yaw }; }
  buffer(name, v) {
    const a = this.a;
    const key = name + '|' + v;
    const hit = a.bufs.get(key);
    if (hit) return hit;
    const data = synth(name, v);
    let b;
    try { b = a.ctx.createBuffer(1, data.length, SR); b.copyToChannel(data, 0); } catch (e) { return null; }
    a.bufs.set(key, b);
    return b;
  }
  ensure() {
    if (this.off) return false;
    if (this.a === null) {
      const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
      if (!AC) return false;
      let ctx, master, amb, ui;
      if (this.ext) {
        ctx = this.ext.ctx;
        try { master = ctx.createGain(); amb = ctx.createGain(); ui = ctx.createGain(); } catch (e) { return false; }
        master.connect(this.ext.dest);
        amb.connect(this.ext.destAmb || this.ext.dest);
        ui.connect(this.ext.destUi || this.ext.dest);
      } else {
      try { ctx = new AC(); master = ctx.createGain(); amb = ctx.createGain(); ui = ctx.createGain(); } catch (e) { return false; }
      // Nén nhẹ (ngưỡng −3 dB, tỉ lệ 2) rồi ra loa.
      try {
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -3.0;
        comp.ratio.value = 2.0;
        for (const n of [master, amb, ui]) n.connect(comp);
        comp.connect(ctx.destination);
      } catch (e) {
        for (const n of [master, amb, ui]) n.connect(ctx.destination);
      }
      }
      this.a = { ctx, master, amb, ui, bufs: new Map(), loops: [], rng: new Rng(12345) };
      this.levels();
      for (const name of AMB_LAYERS) {
        const b = this.buffer(name, 0);
        if (b) {
          try {
            const src = ctx.createBufferSource(), gain = ctx.createGain();
            src.buffer = b;
            src.loop = true;
            gain.gain.value = 0.0;
            src.connect(gain);
            gain.connect(amb);
            src.start();
            this.a.loops.push([name, gain]);
          } catch (e) { /* Rust skips the layer when a node cannot be made */ }
        }
      }
    }
    if (this.a.ctx.state === 'suspended') { try { this.a.ctx.resume(); } catch (e) { /* ignore */ } }
    return true;
  }
  play(name, vol, pos = null) {
    if (!this.ensure()) return;
    const a = this.a;
    const v = rint(a.rng, 0, 2) >>> 0;
    const b = this.buffer(name, v);
    if (!b) return;
    let src, gain;
    try { src = a.ctx.createBufferSource(); gain = a.ctx.createGain(); } catch (e) { return; }
    src.buffer = b;
    src.playbackRate.value = rrange(a.rng, 0.96, 1.04);
    let g = vol, pan = null;
    if (pos && this.listener) {
      const L = this.listener;
      const dx = pos.x - L.pos.x, dy = pos.y - L.pos.y, dz = pos.z - L.pos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      g = vol / (1 + dist / 8);
      const h = Math.hypot(dx, dz);
      // right = rot_y(yaw, X) = (cos yaw, 0, -sin yaw)
      pan = h > 1e-3 ? Math.max(-1, Math.min(1, (dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw)) / h)) : 0;
    }
    gain.gain.value = g;
    src.connect(gain);
    if (pos && this.ext && a.ctx.createPanner) {
      // shared mixer: a real 3D voice (inverse distance, as Saltline's world pool) into the positional bus
      const p = a.ctx.createPanner();
      p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = pos.ref || 4; p.rolloffFactor = pos.roll != null ? pos.roll : 0.8; p.maxDistance = 400;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
      gain.gain.value = vol * a.master.gain.value;
      gain.connect(p); p.connect(this.ext.dest3d);
      src.onended = () => { try { src.disconnect(); gain.disconnect(); p.disconnect(); } catch (e) { /* ignore */ } };
    } else if (pan !== null && a.ctx.createStereoPanner) {
      const p = a.ctx.createStereoPanner();
      p.pan.value = pan;
      gain.connect(p);
      p.connect(a.master);
    } else {
      gain.connect(UI_SOUNDS.has(name) ? a.ui : a.master);
    }
    try { src.start(); } catch (e) { /* ignore */ }
  }
  ambience(levels) {
    const a = this.a;
    if (!a) return;
    a.loops.forEach(([, g], i) => { g.gain.value = levels[i]; });
  }
  selfTest() { return selfTest(); }
}

/* VIEW NOTES
- Install: `import * as audio from './sim/audio.js'; import { Engine } from './synth.js'; audio.install(new Engine());`
  Rules code then calls audio.play(name, vol[, pos]) / audio.ambience([wind, room, night, raid, rain]).
- Positional play is a three.js addition: call engine.set_listener(camPos, yaw) every frame; play(name, vol, {x,y,z})
  then attenuates by 1/(1+d/8) (3D distance in metres) and pans by the horizontal bearing. Without pos (or before a
  listener is set) playback is exactly the Rust: gain = vol, random variant 0..2, playback rate 0.96..1.04.
- Master gain = volume (default 0.8) -> DynamicsCompressor (threshold -3 dB, ratio 2) -> destination.
- Ambience: 5 looping 4 s buffers started at gain 0; ambience() sets the gains directly every frame (no smoothing in
  the Rust either; the caller web.rs computes the levels). ambience() before the first gesture is a no-op as in Rust.
PORT GAPS: f32 arithmetic is emulated with Math.fround after every operation; sin/exp/pow use double Math.* rounded to
  f32, so a rare last-bit difference against Rust's libm sinf/expf/powf is possible (not audible, not bit-exact proven).
*/
