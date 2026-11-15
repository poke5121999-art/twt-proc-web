//! Cắt cảnh: máy quay chạy theo các đoạn (vị trí, điểm nhìn) có phụ đề; hai dải đen trên dưới; Enter / bấm chuột để bỏ qua.
//! Trong lúc cắt cảnh đồng hồ và nhân vật của ván chơi đứng yên (xem `clock_system`, `tick_actors`).
//! Mỗi đoạn có thể kèm diễn viên dựng bằng code (`Act`): người sống sót, người nhặt đồ, zombie; họ đi, đứng, nghe radio,
//! giơ tay, ôm thùng, gục xuống, ngồi dậy theo `pose`. Diễn viên chỉ sống trong lúc đoạn đó chạy (`cine_actors`).
// Port of src/cine.rs (see three/PORT-CONTRACT.md).
import { Vec3, v3, k3, Q_ID, q_x, q_y, q_z, q_mul } from './vec.js';
import * as scene from './scene.js';
import * as game from './game.js';
import * as lay from './lay.js';

export class Shot {
  constructor(o) {
    this.p = o.p;
    this.l = o.l;
    this.dur = o.dur;
    this.sub = o.sub;
    /// true: mọi toạ độ của đoạn (máy quay, diễn viên) tính từ chỗ người chơi đang đứng.
    this.at_player = o.at_player;
    this.acts = o.acts;
  }
}

/// Diễn viên của một đoạn: loại, đi từ `a` tới `b` trong suốt đoạn (đứng yên thì quay mặt về `b`), tư thế.
export class Act {
  constructor(who, a, b, pose) {
    this.who = who;
    this.a = a;
    this.b = b;
    this.pose = pose;
  }
}

export const SURVIVOR = 0;
export const SCAVENGER = 1;
export const ZOMBIE = 2;
export const TUMOUR = 3;
export const HULK = 4;

export const WALK = 0;
export const STAND = 1;
export const CHEER = 2;
export const COLLAPSE = 3;
export const CARRY = 4;
export const RISE = 5;
export const READY = 6;
export const LISTEN = 7;
export const ROAR = 8;
const ACT_NAMES = ['WALK', 'STAND', 'CHEER', 'COLLAPSE', 'CARRY', 'RISE', 'READY', 'LISTEN', 'ROAR'];
const WHO_NAMES = ['survivor', 'scavenger', 'zombie', 'tumour', 'hulk'];

function v(x, y, z) {
  return k3(x, y, z);
}
/// Điểm cách điểm neo `a` của bảng bố cục một đoạn (x, y, z).
function rel(a, x, y, z) {
  return k3(a.x + x, a.y + y, a.z + z);
}
function act(who, a, b, pose) {
  return Object.freeze(new Act(who, a, b, pose));
}
function shot(p0, p1, l0, l1, dur, sub, acts) {
  return Object.freeze(new Shot({ p: [p0, p1], l: [l0, l1], dur, sub, at_player: false, acts }));
}

export const OPENING = 0;
export const RAID_WARN = 1;
export const RAID_START = 2;
export const RAID_WON = 3;
export const DELIVERY = 4;
export const NEW_DAY = 5;
export const DEATH = 6;
export const WAKE_UP = 7;

/// Chân của điểm neo (y = 0).
function foot(a, x, z) {
  return k3(a.x + x, 0.0, a.z + z);
}

// The Rust tables are `const`s built from lay.rs anchors; lay.js may not be used at module top level (contract),
// so the tables are built once on first use.
let T = null;
function tables() {
  if (T !== null) return T;
  const { CINE_DELIVERY, CINE_RAID, CINE_SHOP, DOOR_OUT_STAND, RADIO, START, WAKE } = lay;
  const HORDE_A = [
    act(ZOMBIE, foot(CINE_RAID, 3.0, -2.0), foot(CINE_RAID, -5.0, -1.0), WALK),
    act(ZOMBIE, foot(CINE_RAID, 4.5, 0.5), foot(CINE_RAID, -3.5, 1.0), WALK),
    act(TUMOUR, foot(CINE_RAID, 2.0, 2.2), foot(CINE_RAID, -6.0, 2.5), WALK),
    act(ZOMBIE, foot(CINE_RAID, 6.0, -1.0), foot(CINE_RAID, -2.0, -0.2), WALK),
    act(ZOMBIE, foot(CINE_RAID, 7.5, 1.6), foot(CINE_RAID, -0.5, 1.8), WALK),
    act(ZOMBIE, foot(CINE_RAID, 5.2, 3.4), foot(CINE_RAID, -2.8, 3.6), WALK),
    act(TUMOUR, foot(CINE_RAID, 8.5, -2.6), foot(CINE_RAID, 0.5, -1.8), WALK),
  ];
  const HORDE_B = [
    act(HULK, foot(CINE_RAID, 1.5, 0.5), foot(CINE_RAID, -1.5, 0.8), ROAR),
    act(ZOMBIE, foot(CINE_RAID, 0.0, -2.4), foot(CINE_RAID, -7.0, -1.4), WALK),
    act(ZOMBIE, foot(CINE_RAID, -1.0, 2.6), foot(CINE_RAID, -8.0, 2.4), WALK),
    act(TUMOUR, foot(CINE_RAID, 3.5, -3.2), foot(CINE_RAID, -3.5, -2.6), WALK),
    act(ZOMBIE, foot(CINE_RAID, 4.0, 3.0), foot(CINE_RAID, -3.0, 3.2), WALK),
    act(ZOMBIE, foot(CINE_RAID, 6.0, 0.0), foot(CINE_RAID, -1.0, 0.0), WALK),
    act(ZOMBIE, foot(CINE_RAID, 7.0, -2.0), foot(CINE_RAID, 0.0, -2.2), WALK),
    act(ZOMBIE, foot(CINE_RAID, 8.0, 2.2), foot(CINE_RAID, 1.0, 2.0), WALK),
  ];

  const A_ARRIVE = [act(SURVIVOR, foot(START, 5.0, 7.0), foot(START, 0.0, 0.0), WALK)];
  const A_LOOK = [act(SURVIVOR, foot(START, 0.0, 0.0), foot(CINE_SHOP, 0.0, 0.0), STAND)];
  const A_RADIO = [act(SURVIVOR, foot(RADIO, 0.0, -1.0), foot(RADIO, 0.0, 0.0), LISTEN)];
  const A_HOLD = [act(SURVIVOR, foot(DOOR_OUT_STAND, 0.0, 1.4), foot(DOOR_OUT_STAND, 6.0, 4.0), READY)];
  const A_WON = [act(SURVIVOR, foot(DOOR_OUT_STAND, 0.0, 2.0), foot(DOOR_OUT_STAND, 2.0, 8.0), CHEER)];
  const A_DELIVERY = [act(SCAVENGER, foot(CINE_DELIVERY, -0.7, 0.5), foot(CINE_DELIVERY, -6.5, 3.5), WALK)];
  const A_DEATH = [act(SURVIVOR, v(0.0, 0.0, 0.0), v(0.0, 0.0, -1.0), COLLAPSE)];
  const A_WAKE = [act(SURVIVOR, foot(WAKE, 0.0, 0.0), foot(WAKE, 2.0, 0.6), RISE)];

  const S_OPENING = [
    shot(rel(CINE_SHOP, 18.0, 5.5, 18.0), rel(CINE_SHOP, 10.0, 3.0, 14.0), CINE_SHOP, CINE_SHOP, 4.5, 'Day 1. The city fell months ago.', A_ARRIVE),
    shot(
      rel(START, 1.6, 2.0, 3.0),
      rel(START, 0.9, 1.8, 1.9),
      rel(CINE_SHOP, 0.0, -0.3, -1.0),
      rel(CINE_SHOP, 0.0, -0.3, -1.0),
      4.5,
      'This looted store is yours now. Clean it up, stock the shelves and trade to survive.',
      A_LOOK,
    ),
    shot(rel(START, 0.0, 3.2, 4.0), rel(START, 0.0, 1.62, 0.0), rel(CINE_SHOP, 0.0, -0.2, -1.0), rel(CINE_SHOP, 0.0, -0.38, -1.0), 3.2, 'Batteries are the only currency left.', []),
  ];
  const S_RAID_WARN = [
    shot(rel(RADIO, 1.9, 0.5, 1.9), rel(RADIO, 1.3, 0.35, 1.4), rel(RADIO, 0.0, 0.2, -0.4), rel(RADIO, 0.0, 0.2, -0.4), 3.6, 'RADIO: ...a horde is moving in from the east...', A_RADIO),
    shot(rel(CINE_RAID, -16.0, 2.4, 6.0), rel(CINE_RAID, -12.0, 1.8, 4.5), CINE_RAID, CINE_RAID, 3.8, 'It will reach the shop at 09:30. Close up and get ready.', HORDE_A),
  ];
  const S_RAID_START = [
    shot(rel(CINE_RAID, -14.0, 1.3, 8.0), rel(CINE_RAID, -10.0, 0.6, 5.5), CINE_RAID, CINE_RAID, 3.8, 'RAID! The horde is here.', HORDE_B),
    shot(rel(CINE_SHOP, 9.0, 3.0, 13.0), rel(CINE_SHOP, 5.0, 1.4, 10.0), rel(CINE_SHOP, 0.0, -0.6, 1.0), rel(CINE_SHOP, 0.0, -0.6, 1.0), 2.6, 'Hold the door.', A_HOLD),
  ];
  const S_RAID_WON = [shot(rel(CINE_SHOP, 4.0, -0.4, 8.0), rel(CINE_SHOP, 2.5, 3.5, 14.0), rel(CINE_SHOP, 0.0, -0.6, 2.4), CINE_SHOP, 4.5, 'The horde is beaten. A supply drop is on its way.', A_WON)];
  const S_DELIVERY = [shot(rel(CINE_DELIVERY, 3.1, 0.9, 3.2), rel(CINE_DELIVERY, 1.7, 1.1, 2.2), CINE_DELIVERY, rel(CINE_DELIVERY, 0.8, 0.4, 0.8), 3.6, 'A scavenger left a package by the door.', A_DELIVERY)];
  const S_NEW_DAY = [shot(rel(CINE_SHOP, -14.0, 7.0, 16.0), rel(CINE_SHOP, -8.0, 4.5, 13.0), CINE_SHOP, CINE_SHOP, 3.4, 'A new day. Stock up and open the store.', [])];
  const S_DEATH = [
    Object.freeze(
      new Shot({
        // Nhìn từ trên xuống, sát người: ít khi bị tường che dù gục ở đâu.
        p: [v(0.9, 2.9, 1.3), v(0.6, 2.5, 0.9)],
        l: [v(0.0, 0.8, 0.0), v(0.0, 0.3, 0.5)],
        dur: 2.8,
        sub: 'Everything goes dark...',
        at_player: true,
        acts: A_DEATH,
      }),
    ),
  ];
  const S_WAKE = [shot(rel(WAKE, 1.9, 1.9, 1.7), rel(WAKE, 1.6, 1.6, 1.5), rel(WAKE, 0.0, 0.5, 0.0), rel(WAKE, 0.0, 1.0, 0.0), 3.0, 'You wake up in your bedroom, bruised and lighter of batteries.', A_WAKE)];
  T = { S_OPENING, S_RAID_WARN, S_RAID_START, S_RAID_WON, S_DELIVERY, S_NEW_DAY, S_DEATH, S_WAKE };
  return T;
}

export function shots(kind) {
  const t = tables();
  switch (kind) {
    case OPENING:
      return t.S_OPENING;
    case RAID_WARN:
      return t.S_RAID_WARN;
    case RAID_START:
      return t.S_RAID_START;
    case RAID_WON:
      return t.S_RAID_WON;
    case DELIVERY:
      return t.S_DELIVERY;
    case NEW_DAY:
      return t.S_NEW_DAY;
    case DEATH:
      return t.S_DEATH;
    default:
      return t.S_WAKE;
  }
}

/// Đoạn đang chạy ở giây `t`: (số thứ tự, đoạn, tiến độ 0..1).
export function find(kind, t) {
  let t0 = 0.0;
  const ss = shots(kind);
  for (let i = 0; i < ss.length; i++) {
    const s = ss[i];
    if (t < t0 + s.dur) {
      return [i, s, (t - t0) / s.dur];
    }
    t0 += s.dur;
  }
  return null;
}

/// Vị trí và điểm nhìn của máy quay ở giây `t`; `None` khi cắt cảnh đã hết. `player` là chỗ người chơi đứng.
export function sample(kind, t, player) {
  const f = find(kind, t);
  if (f === null) return null;
  const [, s, k] = f;
  const e = k * k * (3.0 - 2.0 * k);
  const o = s.at_player ? v3(player.x, 0.0, player.z) : v3();
  return [o.add(s.p[0].lerp(s.p[1], e)), o.add(s.l[0].lerp(s.l[1], e))];
}

export function sub(kind, t) {
  const f = find(kind, t);
  return f !== null ? f[1].sub : '';
}

export class CineState {
  constructor() {
    this.key = null; // [kind, shot index] | null
    this.bodies = []; // scene.people handles (Rust: Vec<Body>)
  }
}
/// Rust `Local<CineState>` of `cine_actors`.
export const CINE_STATE = new CineState();

function same_key(a, b) {
  if (a === null || b === null) return a === b;
  return a[0] === b[0] && a[1] === b[1];
}

/// Dựng, diễn và dọn diễn viên của đoạn cắt cảnh đang chạy (chỉ khi cờ `acts` bật).
export function cine_actors(g, dt, ctx) {
  const st = CINE_STATE;
  let cur = null;
  if (g.cine !== null && (g.ff & game.FF_ACTS) !== 0 && g.mode === 'Play') {
    const [kind, t] = g.cine;
    const f = find(kind, t);
    cur = f !== null ? [kind, f[0], f[1], f[2], t] : null;
  }
  const key = cur !== null ? [cur[0], cur[1]] : null;
  if (!same_key(key, st.key)) {
    for (const b of st.bodies) {
      b.despawn();
    }
    st.bodies = [];
    st.key = key;
    if (cur !== null) {
      const [kind, i, s] = cur;
      const o = s.at_player ? v3(g.player.x, 0.0, g.player.z) : v3();
      for (let n = 0; n < s.acts.length; n++) {
        const a = s.acts[n];
        let z = null;
        switch (a.who) {
          case ZOMBIE:
            z = 'Base';
            break;
          case TUMOUR:
            z = 'Tumour';
            break;
          case HULK:
            z = 'Hulk';
            break;
          default:
            z = null;
        }
        let seed;
        switch (a.who) {
          case SURVIVOR:
            seed = 0x51a7c0de;
            break;
          case SCAVENGER:
            seed = 0x0bad5eed;
            break;
          default:
            seed = Math.imul(0x9e3779b9, (kind * 31 + i * 7 + n + 1) >>> 0) >>> 0;
        }
        st.bodies.push(scene.people.spawn(seed, z, o.add(a.a), { cine: true, role: WHO_NAMES[a.who] }));
      }
    }
    return;
  }
  if (cur === null) return;
  const [, , s, k, t] = cur;
  const o = s.at_player ? v3(g.player.x, 0.0, g.player.z) : v3();
  const m = Math.min(s.acts.length, st.bodies.length);
  for (let n = 0; n < m; n++) {
    const a = s.acts[n];
    const b = st.bodies[n];
    const zombie = a.who >= ZOMBIE;
    const moving = a.pose === WALK || a.pose === CARRY || a.pose === ROAR;
    const pos = o.add(moving ? a.a.lerp(a.b, k) : a.a);
    const d = a.b.sub(a.a);
    const yaw = Math.atan2(-d.x, -d.z);
    const ph = t * (zombie ? 5.0 : 7.5) + n * 1.7;
    const sw = a.pose === WALK || a.pose === CARRY ? Math.sin(ph) * 0.55 : 0.0;
    let fall;
    switch (a.pose) {
      case COLLAPSE:
        fall = Math.min(k * 1.5, 1.0);
        break;
      case RISE:
        fall = Math.max(1.0 - k * 1.25, 0.0);
        break;
      default:
        fall = 0.0;
    }
    const root_pos = pos.add(v3(0, fall * 0.1 + (sw !== 0.0 ? Math.abs(Math.sin(ph * 2.0)) * 0.03 : 0.0), 0));
    const root_quat = q_mul(q_mul(q_y(yaw), q_x(-fall * fall * 1.45)), zombie ? q_z(Math.sin(ph * 0.5) * 0.06) : Q_ID.slice());
    // Góc quay quanh trục x của [thân, đầu, tay trái, tay phải, chân trái, chân phải].
    let rots;
    if (zombie) {
      const reach = a.pose === ROAR ? 2.7 + Math.sin(t * 14.0) * 0.15 : 1.35;
      const lean = a.pose === ROAR ? 0.25 : -0.38;
      rots = [lean, 0.2, reach - sw * 0.15, reach + sw * 0.15, -sw, sw];
    } else {
      switch (a.pose) {
        case CHEER:
          rots = [0.0, -0.15, 0.2, 2.9 + Math.sin(t * 9.0) * 0.25, 0.0, 0.0];
          break;
        case READY:
          rots = [0.08, 0.0, 0.25, 1.25 + Math.sin(t * 2.0) * 0.06, 0.25, -0.2];
          break;
        case LISTEN:
          rots = [0.22, 0.12, 0.0, 1.05, 0.0, 0.0];
          break;
        case CARRY:
          rots = [0.0, 0.0, 1.0, 1.0, sw, -sw];
          break;
        case COLLAPSE:
        case RISE:
          rots = [0.0, fall * 0.3, -fall * 0.9, -fall * 1.3, fall * 0.2, -fall * 0.15];
          break;
        default:
          rots = [0.0, 0.0, -sw, sw, sw, -sw];
      }
    }
    b.update({
      pos: root_pos,
      foot: pos,
      yaw,
      quat: root_quat,
      act: a.pose,
      act_name: ACT_NAMES[a.pose],
      who: a.who,
      zombie,
      moving,
      t,
      k,
      phase: ph,
      swing: sw,
      fall,
      rots,
      carry_box: a.pose === CARRY,
    });
  }
}

/* VIEW NOTES (cine.js)
Camera: player.js calls cine.sample(kind, t, g.player) -> [eye, look] (smoothstep e = k*k*(3-2k) per shot) and aims the
camera from eye at look; cine.sub(kind, t) is the subtitle text (HUD shows it between two black letterbox bars).
Cutscene list (kind -> shots, total secs): OPENING 0 (3 shots 4.5+4.5+3.2), RAID_WARN 1 (3.6+3.8), RAID_START 2
(3.8+2.6), RAID_WON 3 (4.5), DELIVERY 4 (3.6), NEW_DAY 5 (3.4), DEATH 6 (2.8, relative to the player's feet), WAKE_UP 7 (3.0).

Actors (only when g.ff has FF_ACTS and mode Play): for each shot, one scene.people person per Act is spawned when the
shot starts, despawned when the shot changes or the cutscene ends.
  spawn(seed, kind, pos, {cine:true, role}) kind: null for SURVIVOR/SCAVENGER, 'Base' ZOMBIE, 'Tumour' TUMOUR, 'Hulk' HULK.
  role: 'survivor' | 'scavenger' | 'zombie' | 'tumour' | 'hulk'. Seeds: survivor 0x51a7c0de, scavenger 0x0bad5eed, zombies
  0x9e3779b9 * (kind*31 + shot*7 + n + 1) (u32 wrap). Rust used actors::spawn_body (rigid 6-part body + optional carried box).
person.update(desc) each frame:
  pos     root position (feet + bounce + fall lift): foot + Y*(fall*0.1 + (swing!=0 ? |sin(2*phase)|*0.03 : 0))
  foot    feet position: moving (WALK, CARRY, ROAR) lerps a->b over the shot (k 0..1), others stay at a
  yaw     atan2(-d.x, -d.z), d = b - a (faces b; walking direction)
  quat    full root rotation = rotY(yaw) * rotX(-fall^2 * 1.45) * (zombie ? rotZ(sin(phase*0.5)*0.06) : identity)
  act     pose constant (number), act_name its name; who 0..4; zombie = who >= ZOMBIE; t = cutscene seconds; k = shot 0..1
  phase   t*(zombie?5:7.5) + n*1.7 ; swing = sin(phase)*0.55 for WALK/CARRY else 0
  fall    COLLAPSE: min(k*1.5, 1) ; RISE: max(1 - 1.25k, 0) ; else 0
  rots    rotation about the local X axis (radians) of [torso, head, left arm, right arm, left leg, right leg] (shoulder/hip pivots)
  carry_box  true only for CARRY: the carried crate (Body.extra) is shown in both hands, hidden otherwise.
Per act (Rust numbers, rots order torso, head, armL, armR, legL, legR):
  WALK     human [0, 0, -sw, sw, sw, -sw] (arms and legs swing opposite, amplitude 0.55 rad), bob |sin 2ph|*0.03 m, moves a->b.
  STAND    human all 0 (default arm), stands at a facing b.
  CHEER    [0, -0.15, 0.2, 2.9 + sin(9t)*0.25, 0, 0]: right arm raised overhead waving, head tilted back.
  COLLAPSE [0, 0.3f, -0.9f, -1.3f, 0.2f, -0.15f] with f = fall; the whole body tips backwards rotX(-f^2*1.45), lifted 0.1f.
  CARRY    [0, 0, 1.0, 1.0, sw, -sw]: both arms forward holding the box, legs walking, moves a->b.
  RISE     same formula as COLLAPSE with f going 1 -> 0 over the first 80 % of the shot (lying -> standing up).
  READY    [0.08, 0, 0.25, 1.25 + sin(2t)*0.06, 0.25, -0.2]: crouched guard stance, right arm forward (weapon ready).
  LISTEN   [0.22, 0.12, 0, 1.05, 0, 0]: leaning in, head down, right arm raised to the ear/radio.
  zombies (any act) [lean, 0.2, reach - sw*0.15, reach + sw*0.15, -sw, sw], reach 1.35 (arms forward), lean -0.38;
  ROAR     (zombie/hulk) reach 2.7 + sin(14t)*0.15 (arms up, shaking), lean 0.25 (chest out); moves a->b, no leg swing.
PORT GAPS: none in rules. The rigid 6-part Bevy body is replaced by scene.people; the descriptor carries every number
the Rust posed it with.
*/
