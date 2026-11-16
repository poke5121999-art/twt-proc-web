//! Khách và zombie: thân dựng từ hộp, luật xem kệ / chấm giá / xếp hàng của khách, zombie lang thang, raid.
// Port of src/actors.rs (see three/PORT-CONTRACT.md + ADDENDUM). Bodies come from scene.people (people.rs is not ported).

import { Vec3, v3, Y, Z, rot_y, clamp, trunc, q_x, q_y, q_z, q_mul } from './vec.js';
import * as scene from './scene.js';
import * as game from './game.js';
import * as lay from './lay.js';
import * as world from './world.js';
import * as items from './items.js';
import * as skills from './skills.js';
import * as events from './events.js';
import * as combat from './combat.js';
import * as staff from './staff.js';
import * as craft from './craft.js';
import * as build from './build.js';
import * as fxs from './fx.js';
import * as web from './web.js';

const PI = Math.PI;
const TAU = Math.PI * 2;

function kind_idx(k) {
  switch (k) {
    case 'Food': return 0;
    case 'Crafting': return 1;
    case 'Medical': return 2;
    case 'Weapon': return 3;
  }
  return 0;
}

// ZKind is a unit enum (a string here); its `impl` methods live in game.rs (`stats`) and combat.rs (`boss`, `label`).
// Local transliterations so this module does not depend on how those siblings expose methods on a string enum.
/** ZKind::stats -> [HP, sát thương, hồi chiêu, tốc độ đuổi] (game.rs). */
export function zk_stats(k) {
  switch (k) {
    case 'Base': case 'Tumour': return [100.0, 25.0, 2.0, 4.0];
    case 'Hulk': return [750.0, 150.0, 5.0, 4.0];
    case 'Brute': return [4000.0, 200.0, 1.0, 4.0];
    case 'Birther': return [2500.0, 150.0, 5.0, 3.0];
    case 'Baby': return [20.0, 25.0, 2.0, 3.0];
    case 'Sweaty': return [10000.0, 300.0, 8.5, 6.0];
    case 'TwinBuff': case 'TwinHeal': return [2000.0, 25.0, 2.0, 4.0];
  }
  return [100.0, 25.0, 2.0, 4.0];
}
/** ZKind::boss (combat.rs). */
export function zk_boss(k) {
  return k === 'Brute' || k === 'Birther' || k === 'Sweaty' || k === 'TwinBuff' || k === 'TwinHeal';
}
/** ZKind::label (combat.rs). */
export function zk_label(k) {
  switch (k) {
    case 'Brute': return 'BRUTE';
    case 'Birther': return 'BIRTHER';
    case 'Sweaty': return 'SWEATY ROTTER';
    case 'TwinBuff': case 'TwinHeal': return 'TWIN SISTERS';
  }
  return '';
}
/** ZKind::scale (combat.rs) — only used for VIEW NOTES / opts (body scale of bosses and Baby). */
export function zk_scale(k) {
  switch (k) {
    case 'Hulk': return 1.5;
    case 'Brute': return 2.0;
    case 'Birther': return 1.7;
    case 'Sweaty': return 2.2;
    case 'Baby': return 0.55;
    case 'TwinBuff': case 'TwinHeal': return 1.2;
  }
  return 1.0;
}

// ---------- thân nhân vật ----------

/**
 * Rust `spawn_body(commands, meshes, mats, seed, zombie, pos) -> Body`. Returns the people handle (kept where Rust kept
 * `Body`). zombie: null (living human) or a ZKind string. opts: `{basket: true}` for humans (the cardboard basket that
 * Rust hung on the torso, shown while carrying), `{shadow: true}` always (soft blob under the feet), `scale` for bosses.
 */
export function spawn_body(seed, zombie, pos) {
  const opts = { shadow: true, basket: zombie === null };
  if (zombie !== null && (zk_boss(zombie) || zombie === 'Baby')) opts.scale = zk_scale(zombie);
  return scene.people.spawn(seed >>> 0, zombie, pos.clone(), opts);
}

function yaw_to(d) {
  return Math.atan2(-d.x, -d.z);
}

function turn(cur, goal, max) {
  let d = (goal - cur) % TAU;
  if (d > PI) {
    d -= TAU;
  }
  if (d < -PI) {
    d += TAU;
  }
  return cur + clamp(d, -max, max);
}

// ---------- khách ----------

/** Sinh một khách; `advert` là món quảng cáo đã kéo khách tới (Mobile News Crew). */
export function spawn_customer(g, advert) {
  const c = new_customer(g);
  c.advert = advert;
  if (advert !== null) {
    c.goal = { k: 'Buy' };
  }
  g.customers.push(c);
}

function new_customer(g) {
  const n = lay.CUSTOMER_SPAWNS.length;
  const spawn = clamp(g.rng.int(0, n - 1), 0, n - 1);
  const food_mod = g.day === 1 && g.hour() < 15.0 ? 2.0 : 1.0;
  const desire = [g.rng.range(0.2, 2.05) * food_mod, g.rng.range(0.2, 2.05), g.rng.range(0.2, 2.05), g.rng.range(0.2, 2.05) * 2.0];
  const wallet = g.roll_wallet();
  let goal = { k: 'Buy' };
  // Khách bị thương: trọng số 0,025 từ ngày 2 (Mua 1,0; Bán 0,1). ?medic=1 ép khách kế tiếp.
  const medic = (g.ff & game.FF_MEDIC) !== 0 && (g.force_medic || (g.day >= 2 && g.rng.chance(0.025 / 1.125)));
  if (g.force_medic) {
    // Bot thử: phát một băng gạc đúng lúc khách bị thương xuất hiện (trước đó kệ đã xếp xong).
    g.inv[game.BANDAGE] += 1;
  }
  g.force_medic = false;
  // Mục tiêu: Mua 1,0; Bán 0,1 (chỉ khi người chơi có từ 10 pin, không có ở ngày 1).
  if (g.day >= 2 && g.batteries >= 10 && g.rng.chance(0.1 / 1.1)) {
    const item = g.rng.pick([game.BEANS, game.FRUIT, game.PIPE, game.BEER, game.TAPE, game.CROWBAR, game.METAL_SCRAP, game.PLANK, game.ROPE, game.NAILS]);
    const qty = g.rng.int(1, 3);
    const ask = trunc(Math.round(items.ival(item) * qty * g.rng.range(0.75, 1.25)));
    goal = { k: 'Sell', a: item, b: qty, c: Math.max(ask, 1) };
  }
  if (medic) {
    goal = { k: 'Medical' };
  }
  const seed = (g.rng.s ^ 0x9e3779b9) >>> 0;
  return Object.assign(new game.Customer(), {
    body: null,
    seed,
    pos: lay.CUSTOMER_SPAWNS[spawn].clone(),
    yaw: 0.0,
    state: 'Walk',
    goal,
    timer: 0.0,
    wallet,
    desire,
    desire_mul: g.rng.range(0.75, 1.1),
    basket: [],
    /// Đợt 13: số món lẻ khách này định mua (game.basket_want: 1-3; luật gốc 0,7 x 6).
    want: game.basket_want(g.rng),
    slot: null,
    path: game.customer_route(spawn).slice(1),
    wait: 0.0,
    at_head: 0.0,
    topped: false,
    phase: g.rng.range(0.0, 6.0),
    moving: false,
    spawn,
    to_queue: false,
    gone: false,
    desperate: g.day >= 3 && g.rng.chance(0.25),
    pay_t: 0.0,
    advert: null,
    hp: 100.0,
    seen: 0,
  });
}

function leave(c) {
  c.leave();
}

/** Chọn ô kệ bằng vòng quay có trọng số theo độ thèm loại hàng (gần hơn thì nặng hơn). */
function choose_tile(g, c) {
  if (c.desire_mul <= 0.0 || !g.open) {
    return finish_browse(g, c);
  }
  const opts = [];
  for (let sh = 0; sh < g.shelves.length; sh++) {
    for (let s = 0; s < g.shelves[sh].slots.length; s++) {
      const it = g.shelves[sh].slots[s];
      if (it !== null && it !== undefined) {
        let w = c.desire[kind_idx(items.kind_of(it))];
        if (c.desperate && w > 1.5) {
          w *= 5.0;
        }
        // Quảng cáo của Mobile News Crew: khách tới vì quảng cáo cân nhắc đúng món đó nặng hơn hẳn.
        if (c.advert === it) {
          w += 20.0;
        }
        const stand = g.shelves[sh].stand(s);
        const d = stand.distance(c.pos);
        w *= 3.0 / (d * 0.5 + 1.0);
        opts.push([[sh, s], w]);
      }
    }
  }
  if (opts.length === 0) {
    c.desire_mul -= 0.25;
    return finish_browse(g, c);
  }
  const sum = opts.reduce((a, o) => a + o[1], 0);
  let r = g.rng.next() * sum;
  let pick = opts[0][0];
  for (const [slot, w] of opts) {
    if (r < w) {
      pick = slot;
      break;
    }
    r -= w;
  }
  c.slot = [pick[0], pick[1]];
  const shelf = g.shelves[pick[0]];
  c.path = [shelf.stand(pick[1]).add(rot_y(shelf.yaw, v3(0.0, 0.0, g.rng.range(-0.15, 0.15))))];
  c.state = 'Walk';
}

function finish_browse(g, c) {
  if (c.basket.length === 0) {
    g.add_rep(-0.01);
    leave(c);
  } else {
    c.to_queue = true;
    c.state = 'Queue';
    c.wait = 0.0;
    c.at_head = 0.0;
  }
}

function evaluate(g, c) {
  if (c.slot === null) return choose_tile(g, c);
  const [sh, s] = c.slot;
  const shelf = sh < g.shelves.length ? g.shelves[sh] : null;
  const it0 = shelf !== null && s < shelf.slots.length ? shelf.slots[s] : null;
  const item = it0 === undefined ? null : it0;
  if (item === null) {
    c.desire_mul -= 0.25;
    return choose_tile(g, c);
  }
  const price = g.prices[item];
  const value = items.ival(item);
  const pending = c.basket.reduce((a, b) => a + b[1], 0);
  let score = game.Game.score(price, value, pending, c.wallet);
  // Nạp thêm ví một lần khi rất thèm món và giá chưa quá 2,25 lần.
  if (score <= 0.0 && !c.topped && c.desire[kind_idx(items.kind_of(item))] >= 1.2 && price <= 2.25 * value && g.rng.chance((g.rep + 100.0) / 200.0)) {
    c.topped = true;
    c.wallet = trunc(Math.ceil((pending + price) / 0.99)) + g.rng.int(1, 5);
    score = game.Game.score(price, value, pending, c.wallet);
  }
  const chance = score / (score + 0.7);
  c.desire_mul -= 0.1;
  if (g.rng.chance(chance)) {
    g.shelves[sh].take(s);
    c.basket.push([item, price]);
    g.add_rep_flat(0.0066);
    g.add_rep(value * 1.5 >= price ? 0.06 : -0.02);
    g.play('pick', 0.35);
    // Luật gốc: đủ 70% giỏ (sức chứa 6) thì ra quầy. Đợt 13: đủ `want` món (1-3) thì ra quầy.
    if (c.basket.length >= (c.want || game.BASKET_ORIG)) {
      return finish_browse(g, c);
    }
  }
  choose_tile(g, c);
}

/** Yaw written by the last `walk` call (Rust passes `&mut yaw`; JS cannot): read it right after the call. */
export const WALK = { yaw: 0 };

/**
 * Rust `walk(&mut pos, &mut yaw, &mut path, speed, dt) -> bool`. `pos` (a non-frozen Vec3) and `path` (array) are
 * mutated in place; the new yaw is left in `WALK.yaw`. Also accepts the object form `walk(owner, speed, dt)` where
 * owner has `pos`, `yaw`, `path` fields (all three are written back), for callers that port `walk(&mut l.pos, &mut l.yaw, ..)`.
 */
export function walk(pos, yaw, path, speed, dt) {
  if (!(pos instanceof Vec3) && pos !== null && typeof pos === 'object' && pos.pos !== undefined) {
    const o = pos;
    if (Object.isFrozen(o.pos)) o.pos = o.pos.clone();
    const r = walk(o.pos, o.yaw, o.path, yaw, path);
    o.yaw = WALK.yaw;
    return r;
  }
  WALK.yaw = yaw;
  if (path.length === 0) return false;
  const t = path[0];
  const d = t.sub(pos);
  const dist = d.length();
  if (dist < 0.12) {
    path.shift();
    return path.length !== 0;
  }
  const dir = d.div(dist);
  const step = Math.min(speed * dt, dist);
  pos.x += dir.x * step;
  pos.y += dir.y * step;
  pos.z += dir.z * step;
  WALK.yaw = turn(yaw, yaw_to(dir), dt * 8.0);
  return true;
}

function tick_customers(g, dt) {
  // Nhịp sinh khách (phút game), gieo lại mỗi phút game.
  if (g.open) {
    const m = trunc(g.minutes);
    if (m !== g.minute_mark) {
      g.minute_mark = m;
      g.spawn_interval = g.roll_interval();
    }
    g.since_spawn += dt * game.MIN_PER_SEC * g.speed;
    if (g.since_spawn >= g.spawn_interval && g.customers.length < 12) {
      g.since_spawn = 0.0;
      const c = new_customer(g);
      g.customers.push(c);
    }
  }
  const danger = g.zombies.some((z) => z.chasing && (game.Game.in_shop(z.pos) || z.pos.distance(lay.DOOR_OUT) < 14.0));
  const staffed = g.at_service();
  const cs = g.customers;
  g.customers = [];
  // Thứ tự hàng chờ: theo thời điểm vào hàng (giữ theo thứ tự trong danh sách).
  let qi = 0;
  for (const c of cs) {
    c.moving = false;
    // Đang đưa pin trả tiền: đứng yên một nhịp rồi mới quay đi.
    if (c.pay_t > 0.0) {
      c.pay_t -= dt;
      continue;
    }
    if (danger && c.state !== 'Leave') {
      g.add_rep(-0.02);
      const drained = c.basket.splice(0, c.basket.length);
      for (const [it] of drained) {
        for (let sh = 0; sh < g.shelves.length; sh++) {
          const s = g.shelves[sh].place_slot(it, null, 1);
          if (s !== null) {
            g.shelves[sh].put(s, it, 1);
            break;
          }
        }
      }
      leave(c);
    }
    switch (c.state) {
      case 'Walk': {
        // Trong quán đi 1,5 m/s (luật gốc, CONFIRMED). Ngoài bãi đi 3,0 m/s [ĐỀ XUẤT]: điểm sinh theo bản gốc cách cửa 46–92 m,
        // đi 1,5 m/s thì cả buổi chỉ một hai khách tới kịp quầy; tốc độ ngoài quán của bản gốc chưa đo được.
        const sp = game.Game.in_shop(c.pos) ? 1.5 : 3.0;
        if (Object.isFrozen(c.pos)) c.pos = c.pos.clone();
        c.moving = walk(c.pos, c.yaw, c.path, sp, dt);
        c.yaw = WALK.yaw;
        if (c.path.length === 0) {
          if (c.slot !== null) {
            c.state = 'Look';
            c.timer = g.rng.range(2.5, 4.0);
          } else {
            // Vừa qua cửa.
            g.play('bell', 0.4);
            if (!g.open) {
              leave(c);
            } else if (c.goal.k === 'Medical') {
              c.state = 'Follow';
              g.play('groan', 0.3);
              g.say('An injured survivor limps in, asking for medicine.');
            } else if (c.goal.k === 'Sell') {
              c.to_queue = true;
              c.state = 'Queue';
            } else {
              choose_tile(g, c);
            }
          }
        }
        break;
      }
      case 'Follow': {
        // Đi theo người chơi 1,5 m/s, dừng cách 1,7 m; quán đóng thì về.
        if (!g.open) {
          leave(c);
        } else {
          const d = v3(g.player.x - c.pos.x, 0.0, g.player.z - c.pos.z);
          if (d.length() > 1.7) {
            const want = c.pos.add(d.normalize().mul(1.5 * dt));
            c.pos = world.resolve(g, want, 0.3);
            c.moving = true;
          }
          if (d.length() > 0.1) {
            c.yaw = yaw_to(d);
          }
        }
        break;
      }
      case 'Look': {
        if (c.slot !== null) {
          const shelf = c.slot[0] < g.shelves.length ? g.shelves[c.slot[0]] : null;
          if (shelf !== null) {
            const f = shelf.face();
            c.yaw = turn(c.yaw, yaw_to(f), dt * 6.0);
          }
        }
        c.timer -= dt;
        if (c.timer <= 0.0) {
          evaluate(g, c);
        }
        break;
      }
      case 'Queue': {
        const spot = lay.QUEUE0.add(Z.mul(qi * lay.QUEUE_STEP));
        const head = qi === 0;
        qi += 1;
        const d = spot.sub(c.pos);
        if (d.length() > 0.1) {
          const dir = d.normalize();
          c.pos = c.pos.add(dir.mul(Math.min(1.5 * dt, d.length())));
          c.yaw = turn(c.yaw, yaw_to(dir), dt * 8.0);
          c.moving = true;
        } else {
          c.yaw = turn(c.yaw, 0.0, dt * 6.0);
          if (head) {
            c.at_head += dt;
          }
        }
        // Đang đếm pin của chính khách này thì khách không sốt ruột bỏ về.
        if (!(head && g.pay !== null)) {
          c.wait += dt * (staffed ? 0.5 : 1.0);
        }
        if (c.wait >= 30.0) {
          // Bỏ về: để lại hàng trong một hộp trên sàn, −0,1 Service.
          g.add_rep(-0.1);
          if (c.basket.length !== 0) {
            const its = c.basket.splice(0, c.basket.length).map((b) => b[0]);
            g.add_prop({ k: 'Box', a: its }, c.pos.add(v3(0.5, 0.0, 0.3)), 0.4);
          }
          g.say('A customer got tired of waiting and left.');
          leave(c);
        }
        break;
      }
      case 'Leave': {
        const sp = danger ? 3.4 : game.Game.in_shop(c.pos) ? 1.5 : 3.0;
        if (Object.isFrozen(c.pos)) c.pos = c.pos.clone();
        c.moving = walk(c.pos, c.yaw, c.path, sp, dt);
        c.yaw = WALK.yaw;
        if (c.path.length === 0) {
          c.gone = true;
        }
        break;
      }
    }
    if (c.moving) {
      c.phase += dt * 7.5;
    }
    // Thấy xác trong 3 m: -0,01 uy tín mỗi xác mỗi khách (luật gốc, xác khác loài).
    if (c.state !== 'Leave') {
      const n = Math.min(g.props.filter((p) => !p.dead && p.kind.k === 'Corpse' && p.pos.distance(c.pos) < 3.0).length, 20);
      if (n > c.seen) {
        g.add_rep(-0.01 * (n - c.seen));
        c.seen = n;
      }
    }
  }
  for (const c of g.customers) cs.push(c);
  g.customers = cs;
}

/** Khách đầu hàng (đã đứng yên ở quầy). */
export function head_customer(g) {
  const i = g.customers.findIndex((c) => c.state === 'Queue' && !c.gone);
  if (i < 0) return null;
  return g.customers[i].at_head > 0.0 ? i : null;
}

/** Khách bị thương đang đứng trong tầm 3 m. */
export function medical_near(g) {
  const i = g.customers.findIndex((c) => c.state === 'Follow' && !c.gone && c.pos.distance(g.player) < 3.0);
  return i < 0 ? null : i;
}

/** Cho thuốc (món thuốc rẻ nhất đang có) hoặc đuổi khách bị thương. Cho thì +2,5 thiện cảm và hôm sau có quà. */
export function medical_answer(g, give) {
  const i = medical_near(g);
  if (i === null) return;
  if (give) {
    const it = [game.BANDAGE, game.PILLS, game.ANTIBIOTICS, game.FIRSTAID].find((k) => g.inv[k] > 0);
    if (it === undefined) {
      g.play('deny', 0.5);
      g.say('You have no medicine to give.');
      return;
    }
    g.inv[it] -= 1;
    const m = skills.mul(g, 'CureCustomerReputationMultiplier');
    g.add_rep(2.5 * (m > 0.0 ? m : 1.0));
    g.med_gifts.push(it);
    g.play('quest', 0.5);
    g.say(`You gave ${items.iname(it)}. "Thank you... I will not forget this."`);
  } else {
    g.play('deny', 0.4);
    g.say('You send the injured survivor away.');
  }
  leave(g.customers[i]);
}

/** Người chơi bấm E ở quầy: bán cả giỏ theo giá đã chốt lúc khách nhặt. */
export function serve(g) {
  const i = head_customer(g);
  if (i === null) {
    g.say('No customer is waiting at the counter.');
    return;
  }
  if (!g.at_service()) {
    g.say('Stand behind the counter to serve.');
    return;
  }
  if (g.customers[i].goal.k === 'Sell') {
    return;
  }
  const need = g.customers[i].basket.length <= 1 ? 2.0 : 0.6;
  if (g.customers[i].at_head < need) {
    return;
  }
  const total = g.customers[i].basket.reduce((a, b) => a + b[1], 0);
  // Thanh toán bằng pin thật: khách đặt từng cục lên quầy, người chơi soi rồi cất (bảng Pay ở player.rs).
  if ((g.ff & game.FF_PAY) !== 0) {
    if (g.pay === null) {
      const [coins, underpaid] = g.gen_payment(total);
      g.pay = { coins, sel: 0, credited: 0, underpaid, alarm: 0 };
      g.pay_rev += 1;
      g.play('pick', 0.5);
      g.say('The customer lays the batteries on the counter. Check each one [E], then put it in the drawer [E].');
    }
    return;
  }
  finish_sale(g, i, total);
}

/** Nhân viên Service bán thay người chơi: khách đầu hàng đã sẵn sàng thì bán cả giỏ. Trả về true nếu đã bán. */
export function staff_serve(g) {
  const i = head_customer(g);
  if (i === null) return false;
  if (g.customers[i].goal.k !== 'Buy') {
    return false;
  }
  const need = g.customers[i].basket.length <= 1 ? 2.0 : 0.6;
  if (g.customers[i].at_head < need) {
    return false;
  }
  const total = g.customers[i].basket.reduce((a, b) => a + b[1], 0);
  finish_sale(g, i, total);
  return true;
}

/** Khép lượt thanh toán bằng pin thật: ghi doanh thu theo số pin đã vào ngăn kéo, khách rời quầy. */
export function finish_payment(g) {
  const pay = g.pay;
  if (pay === null) return;
  g.pay = null;
  g.batteries -= pay.credited;
  const i = head_customer(g);
  if (i !== null) {
    finish_sale(g, i, pay.credited);
  } else {
    g.batteries += pay.credited;
    g.stats.income += pay.credited;
  }
}

function finish_sale(g, i, total0) {
  // Đợt 13: sổ giỏ từng lần bán trong ngày (bot đọc `__twt.sales`): số món lẻ khách mua.
  if (g.sales === undefined) g.sales = [];
  if (g.sales.length < 64) g.sales.push(g.customers[i].basket.length);
  const first = g.customers[i].basket.length > 0 ? items.ival(g.customers[i].basket[0][0]) : 0;
  const sold = g.customers[i].basket.splice(0, g.customers[i].basket.length).map((b) => b[0]);
  for (const it of sold) {
    events.sold(g, it);
  }
  // Nút "SellingItemMultiplier": tiền bán x1,1 mỗi nút (cộng phần thêm, làm tròn).
  const sm = skills.mul(g, 'SellingItemMultiplier');
  const total = sm > 1.0 ? trunc(Math.sign(total0 * sm) * Math.round(Math.abs(total0 * sm))) : total0;
  g.batteries += total;
  g.stats.income += total;
  g.stats.served += 1;
  g.total_served += 1;
  const rm = skills.mul(g, 'SalesReputationIncrease');
  g.add_rep(0.01 * (rm > 0.0 ? rm : 1.0));
  if (skills.has(g, 'ServeCustomerBonus')) {
    g.sk.served += 1;
    if (g.sk.served % 10 === 0) {
      g.batteries += 100;
      g.stats.other += 100;
    }
  }
  g.xp(trunc(first / 2), 0);
  g.complete('ServeFirst');
  g.play('pay', 0.7);
  g.say(`Sold for ${total} batteries.`);
  g.customers[i].pay_t = 0.9;
  leave(g.customers[i]);
}

/** Trả lời khách muốn bán đồ (Y/N). */
export function answer_offer(g, accept) {
  const i = head_customer(g);
  if (i === null) return;
  const goal = g.customers[i].goal;
  if (goal.k !== 'Sell') return;
  const item = goal.a, qty = goal.b, ask = goal.c;
  if (accept) {
    if (g.batteries < ask) {
      g.say('Not enough batteries.');
      g.play('deny', 0.5);
      return;
    }
    g.batteries -= ask;
    g.stats.outgoings += ask;
    g.inv[item] += qty;
    g.add_rep(0.01);
    g.play('pay', 0.6);
    g.say(`Bought ${qty}x ${items.iname(item)} for ${ask} batteries.`);
  } else {
    g.play('click', 0.4);
  }
  leave(g.customers[i]);
}

// ---------- zombie ----------

export function spawn_zombie(g, kind, pos, raid) {
  const seed = (g.rng.s ^ 0x51ed270b) >>> 0;
  g.rng.next();
  const groan = g.rng.range(1.0, 6.0);
  g.zombies.push({
    body: null,
    seed,
    kind,
    pos: pos.clone(),
    yaw: 0.0,
    hp: zk_stats(kind)[0],
    cd: 1.0,
    wind: 0.0,
    raid,
    chasing: raid,
    wander_to: pos.clone(),
    pause: 0.0,
    detour: v3(),
    detour_t: 0.0,
    stagger: 0.0,
    phase: 0.0,
    moving: false,
    groan,
    wire_t: 0.0,
    slow: false,
    rude: false,
    dead: false,
    dying: 0.0,
    burn: 0.0,
    root: 0.0,
    trapped: false,
    spike_cd: 0.0,
    speed_mul: 1.0,
    special: 3.0,
    act: 0,
    act_t: 0.0,
    n_att: 0,
    aim: v3(),
    air: 0.0,
  });
  return g.zombies.length - 1;
}

/** Khoảng cách từ `p` tới đoạn thẳng a–b trên mặt phẳng XZ. */
function seg_dist(p3, a3, b3) {
  const p = p3.xz(), a = a3.xz(), b = b3.xz();
  const ab = b.sub(a);
  const t = clamp(p.sub(a).dot(ab) / Math.max(ab.dot(ab), 1e-6), 0.0, 1.0);
  return p.distance(a.add(ab.mul(t)));
}

/** Bước qua cổng bãi: chọn cổng ít vòng nhất; đang ở trong lối cổng thì đi tiếp sang đầu kia. */
function gate_step(from, to, inward) {
  let best = [Infinity, to];
  for (const [out, inn] of lay.GATES) {
    const [a, b] = inward ? [out, inn] : [inn, out];
    if (seg_dist(from, a, b) < 1.2 && from.xz().distance(b.xz()) < a.xz().distance(b.xz()) + 0.5) {
      return b;
    }
    const cost = from.distance(a) + b.distance(to);
    if (cost < best[0]) {
      best = [cost, a];
    }
  }
  return best[1];
}

/**
 * Điểm kế tiếp trên đường từ `from` tới `to`, đi qua cổng bãi, cửa trước và cửa phòng ngủ.
 * Vùng: 3 ngoài hàng rào, 0 trong bãi, 1 trong quán, 2 phòng ngủ.
 */
export function route(from, to) {
  const region = (p) => {
    if (game.Game.in_bedroom(p)) {
      return 2;
    } else if (game.Game.in_warehouse(p) && lay.wh_open()) {
      return 4;
    } else if (game.Game.in_medical(p) && lay.med_open()) {
      return 5;
    } else if (game.Game.in_shop(p)) {
      return 1;
    } else if (lay.inside(lay.LOT, p)) {
      return 0;
    } else {
      return 3;
    }
  };
  const a = region(from), b = region(to);
  if (a === b) {
    return to;
  }
  const near_bed_door = (p, r) => Math.abs(p.x - lay.BED_DOOR.x) < r && Math.abs(p.z - lay.BED_DOOR.z) < 0.5;
  // Kho và phòng y tế chỉ thông với quán qua một cửa.
  if (a === 4) {
    return Math.abs(from.x - lay.WH_B.x) < 0.6 && from.z > lay.WH_B.z - 0.4 ? lay.WH_A : lay.WH_B;
  }
  if (a === 5) {
    return Math.abs(from.z - lay.MED_B.z) < 0.5 && from.x > lay.MED_B.x - 0.4 ? lay.MED_A : lay.MED_B;
  }
  if (a === 1 && b === 4) {
    return Math.abs(from.x - lay.WH_A.x) < 0.5 && from.z < lay.WH_A.z + 0.4 ? lay.WH_B : lay.WH_A;
  }
  if (a === 1 && b === 5) {
    return Math.abs(from.z - lay.MED_A.z) < 0.5 && from.x < lay.MED_A.x + 0.4 ? lay.MED_B : lay.MED_A;
  }
  if (b === 4 || b === 5) {
    // Từ ngoài hoặc từ phòng ngủ: đi về phía quán trước.
    return route(from, lay.DOOR_IN.add(v3(0.0, 0.0, -1.0)));
  }
  switch (a) {
    case 3:
      return gate_step(from, to, true);
    case 0:
      if (b === 3) {
        return gate_step(from, to, false);
      } else if (Math.abs(from.x - lay.DOOR_OUT.x) < 0.75 && from.z < lay.DOOR_OUT.z + 0.5 && from.z > lay.DOOR_BOX[1] - 0.1) {
        return lay.DOOR_IN;
      } else {
        return lay.DOOR_OUT;
      }
    case 1:
      if (b === 0 || b === 3) {
        return Math.abs(from.x - lay.DOOR_IN.x) < 0.75 && from.z > lay.DOOR_IN.z - 0.3 ? lay.DOOR_OUT : lay.DOOR_IN;
      } else if (near_bed_door(from, 1.125)) {
        return lay.BED_B;
      } else {
        return lay.BED_A;
      }
    default:
      return near_bed_door(from, 1.175) ? lay.BED_A : lay.BED_B;
  }
}

export function detect_radius(hour) {
  if (!(hour >= 6.0 && hour < 20.0)) {
    return 50.0;
  } else if (hour < 14.4) {
    return 25.0 - ((hour - 6.0) / 8.4) * 8.5;
  } else {
    return 16.5 + ((hour - 14.4) / 5.6) * 33.5;
  }
}

export function roam_cap(day, hour) {
  // [ĐỀ XUẤT phiên 7] Ngày 2 là ngày đầu có zombie lang thang, người chơi mới chỉ có búa: đêm ngày 2 tối đa 3 con
  // (bản gốc 5). Phiên 4-6 bot flow chết ở đêm ngày 2 nhiều lần vì nhiều con lọt vào quán lúc chạng vạng.
  if (day === 2) return Math.min(roam_cap(3, hour), hour < 21.6 ? 2 : 3);
  if (day < 2 || hour < 9.6) {
    return 0;
  } else if (hour < 12.0) {
    return 1;
  } else if (hour < 18.0) {
    return 1 + trunc((hour - 12.0) / 6.0);
  } else if (hour < 21.6) {
    return 2 + trunc(((hour - 18.0) / 3.6) * 3.0);
  } else {
    return 5;
  }
}

function kill_zombie(g, z, fx) {
  z.dead = true;
  let k;
  switch (z.kind) {
    case 'Base': case 'Baby': case 'TwinBuff': k = 0; break;
    case 'Tumour': case 'TwinHeal': k = 1; break;
    default: k = 2;
  }
  // Xác quân raid không lục được gì (luật gốc: quân raid và boss không mang đồ); xác zombie ban ngày thì có.
  if (z.kind !== 'Baby') {
    // Zombie "Rude Customer" ngày 2 lao tới như quân raid nhưng xác vẫn lục được (quest Waste Not Want Not).
    g.add_prop({ k: 'Corpse', a: k, b: z.raid && !z.rude }, z.pos.clone(), z.yaw);
  }
  g.stats.kills += 1;
  // XP Survival = RoundToInt(máu tối đa x 0,125) (luật gốc tính theo sát thương người chơi gây ra).
  g.xp(0, clamp(trunc(Math.round(zk_stats(z.kind)[0] * 0.125)), 2, 500));
  if (zk_boss(z.kind)) {
    g.say(`${zk_label(z.kind)} is dead!`);
    g.play('win', 0.7);
  }
  g.fxq.push([fxs.FX_SMOKE, z.pos.add(Y.mul(1.0))]);
  if (z.rude) {
    g.complete('KillZombie');
  }
  if (z.kind === 'Tumour') {
    // Tumour nổ khi chết: 75 sát thương, giảm tuyến tính trong 5 m.
    g.play('boom', 0.9);
    g.fxq.push([fxs.FX_BOOM, z.pos.add(Y.mul(1.0))]);
    fx.flash_pos = z.pos.add(Y);
    fx.flash_col = v3(3.0, 1.2, 0.4);
    fx.flash = 1.5;
    const d = g.player.distance(z.pos);
    if (d < 5.0) {
      g.damage_player(75.0 * (1.0 - d / 5.0));
    }
  }
}

function tick_zombies(g, fx, dt) {
  const hour = g.hour();
  // Zombie lang thang ban ngày (từ ngày 2): mỗi giờ game thử sinh tối đa 2 con tới mức trần theo giờ.
  const hr = trunc(g.minutes / 60.0) + g.day * 24;
  if (g.mode === 'Play' && hr !== g.hour_mark && !g.raid.active) {
    g.hour_mark = hr;
    const cap = roam_cap(g.day, hour);
    const n = g.zombies.filter((z) => !z.raid).length;
    const cnt = Math.min(2, Math.max(0, cap - n));
    for (let q = 0; q < cnt; q++) {
      const far = lay.ZOMBIE_SPAWNS.filter((s) => s.distance(g.player) > 22.0);
      if (far.length !== 0) {
        const p = g.rng.pick(far);
        spawn_zombie(g, 'Base', p, false);
      }
    }
  }
  // "Rude Customer": ngày 2, 08:00, một zombie lao tới quán.
  if (g.day === 2 && hour >= 8.0 && !g.rude_spawned && g.mode === 'Play') {
    g.rude_spawned = true;
    const i = spawn_zombie(g, 'Base', lay.ZOMBIE_SPAWNS[2], true);
    g.zombies[i].rude = true;
    g.say('A zombie is attacking the shop!');
    g.play('groan', 0.9);
  }
  if (g.is_done('LootZombie') && !g.is_done('RepairDoor') && g.door.hp >= game.DOOR_HP) {
    g.complete('RepairDoor');
  }

  const radius = detect_radius(hour);
  const player = g.player.clone();
  const alive = g.mode === 'Play';
  const zs = g.zombies;
  g.zombies = [];
  const positions = zs.map((z) => z.pos.clone());
  for (let zi = 0; zi < zs.length; zi++) {
    const z = zs[zi];
    if (z.dead) {
      continue;
    }
    if (z.dying > 0.0) {
      z.dying += dt;
      if (z.dying >= 0.55) {
        kill_zombie(g, z, fx);
      }
      continue;
    }
    if (z.hp <= 0.0) {
      z.dying = 0.001;
      g.play('zdie', 0.6);
      continue;
    }
    z.moving = false;
    z.cd -= dt;
    z.stagger -= dt;
    z.groan -= dt;
    if (combat.zombie_special(g, z, dt, alive)) {
      continue;
    }
    if (z.hp <= 0.0) {
      continue;
    }
    const st = zk_stats(z.kind);
    const dmg = st[1], cooldown = st[2];
    const chase_speed = st[3] * z.speed_mul;
    // Đồng minh sát bên (nhân viên, Hulk Helper) bị cào thay người chơi khi người chơi ở xa hơn.
    if (z.chasing && z.cd <= 0.0 && z.wind <= 0.0 && z.stagger <= 0.0 && z.pos.distance(player) > 1.8) {
      let hit = false;
      if (g.bld.helper.freed && !g.bld.helper.down && g.bld.helper.pos.distance(z.pos) < 1.6) {
        g.bld.helper.hp -= dmg;
        hit = true;
      } else {
        const s = g.staff.find((s) => s.hired && !s.gone && !s.away && s.pos.distance(z.pos) < 1.4);
        if (s !== undefined) {
          s.hp -= dmg;
          hit = true;
        }
      }
      if (hit) {
        z.cd = cooldown + 0.3;
        g.play('claw', 0.5);
        g.fxq.push([fxs.FX_BLOOD, z.pos.add(Y.mul(1.2))]);
        continue;
      }
    }
    const dist = z.pos.distance(player);
    if (!z.chasing && alive && dist < radius) {
      z.chasing = true;
      g.play('groan', clamp(1.0 - dist / 50.0, 0.2, 0.8));
    }
    if (z.groan <= 0.0) {
      z.groan = g.rng.range(4.0, 9.0);
      if (dist < 30.0) {
        g.play('groan', clamp(1.0 - dist / 30.0, 0.1, 0.6));
      }
    }
    // Dây thép gai: 10 sát thương mỗi 0,25 s, chậm còn 0,25 lần; dây mất 2 HP mỗi nạn nhân mỗi nhịp.
    z.slow = false;
    z.wire_t -= dt;
    for (const p of g.props) {
      if (p.kind.k === 'Wire') {
        const local = rot_y(-p.yaw, z.pos.sub(p.pos));
        if (!p.dead && Math.abs(local.x) < 1.2 && Math.abs(local.z) < 0.7) {
          z.slow = z.kind !== 'Hulk';
          if (z.wire_t <= 0.0) {
            z.wire_t = 0.25;
            z.hp -= 10.0;
            g.fxq.push([fxs.FX_BLOOD, z.pos.add(Y.mul(0.7))]);
            p.kind.a -= 2.0;
            if (p.kind.a <= 0.0) {
              p.dead = true;
            }
          }
        }
      }
    }
    if (z.stagger > 0.0) {
      continue;
    }
    if (z.wind > 0.0) {
      // Đang vung: đòn rơi sau 0,5 s nếu người chơi còn trong tầm.
      z.wind -= dt;
      if (z.wind <= 0.0) {
        if (alive && z.pos.distance(player) < 1.7) {
          g.damage_player(dmg);
          g.vel_y = 2.0;
        }
        g.play('claw', 0.6);
      }
      continue;
    }
    let speed = z.chasing ? chase_speed : 1.3;
    if (z.kind === 'Hulk' && !z.chasing) {
      speed = 1.0;
    }
    if (z.slow) {
      speed *= 0.25;
    }
    const L = g.cb.lure;
    const lure = L !== null && L[0].distance(z.pos) < 20.0 && !zk_boss(z.kind) ? L[0] : null;
    let target;
    if (lure !== null) {
      target = lure.distance(z.pos) < 1.0 ? z.pos : route(z.pos, lure);
    } else if (z.chasing && alive) {
      target = route(z.pos, player);
    } else {
      z.chasing = z.raid && alive;
      z.pause -= dt;
      if (z.pos.distance(z.wander_to) < 0.5 && z.pause <= 0.0) {
        z.pause = g.rng.range(1.0, 3.0);
        const a = g.rng.range(0.0, TAU);
        const d = g.rng.range(5.0, 10.0);
        const w = z.pos.add(v3(Math.cos(a) * d, 0.0, Math.sin(a) * d));
        w.z = clamp(w.z, lay.WANDER[1], lay.WANDER[3]);
        w.x = clamp(w.x, lay.WANDER[0], lay.WANDER[2]);
        z.wander_to = w;
      }
      target = z.pause > 0.0 ? z.pos : z.wander_to;
    }
    // Cửa trước đóng: đứng đập cửa (25 mỗi đòn) cho tới khi vỡ.
    const wants_door = z.chasing && (target.eq(lay.DOOR_OUT) || target.eq(lay.DOOR_IN)) && !game.Game.in_shop(z.pos);
    if (wants_door && g.door_blocks() && z.pos.distance(lay.DOOR_OUT) < 1.4) {
      z.yaw = turn(z.yaw, yaw_to(v3(0.0, 0.0, -1.0)), dt * 6.0);
      if (z.cd <= 0.0) {
        z.cd = cooldown;
        g.door.hp -= 25.0;
        g.play('bang', 0.8);
        // phiên 8: người chơi trong quán biết có zombie ngoài cửa trước khi mở
        if (game.Game.in_shop(player) && g.notice_t <= 0.0 && !g.raid.active) g.say('Zombies are banging on the front door!');
        g.fxq.push([fxs.FX_DEBRIS, v3(clamp(z.pos.x, lay.DOOR_BOX[0] + 0.2, lay.DOOR_BOX[2] - 0.2), 1.2, lay.DOOR_BOX[3] + 0.05)]);
        if (g.door.hp <= 0.0) {
          g.door.hp = 0.0;
          g.door.open = true;
          g.play('break', 0.9);
          g.say('The front door has been broken down!');
        }
      }
      continue;
    }
    const to = target.sub(z.pos);
    const d = to.length();
    if (z.chasing && alive && dist < 1.25 && target.eq(player)) {
      z.yaw = turn(z.yaw, yaw_to(to), dt * 8.0);
      if (z.cd <= 0.0) {
        z.cd = cooldown + g.rng.range(0.2, 0.33);
        z.wind = 0.5;
      }
      continue;
    }
    if (d > 0.05) {
      let dir = to.div(d);
      if (z.detour_t > 0.0) {
        z.detour_t -= dt;
        dir = dir.mul(0.35).add(z.detour).normalize_or_zero();
      }
      // Tách khỏi zombie khác.
      let sep = v3();
      for (let k = 0; k < positions.length; k++) {
        if (k !== zi) {
          const o = z.pos.sub(positions[k]);
          const l = o.length();
          if (l < 0.7 && l > 0.001) {
            sep = sep.add(o.div(l).mul(0.7 - l));
          }
        }
      }
      const want = z.pos.add(dir.mul(Math.min(speed * dt, d))).add(sep.mul(dt * 4.0));
      const got = world.resolve(g, want, 0.32);
      const moved = got.sub(z.pos).length();
      if (moved < speed * dt * 0.35 && z.detour_t <= 0.0) {
        // Bị chặn: lách ngang một lúc.
        const side = g.rng.chance(0.5) ? 1.0 : -1.0;
        z.detour = v3(-dir.z, 0.0, dir.x).mul(side);
        z.detour_t = 0.9;
      }
      z.pos = got;
      z.yaw = turn(z.yaw, yaw_to(dir), dt * 7.0);
      z.moving = true;
      z.phase += dt * speed * 2.6;
    }
  }
  for (const z of g.zombies) zs.push(z);
  g.zombies = zs;
  // Cảnh báo khi zombie lọt vào quán (nhắc lại mỗi 12 giây khi còn con nào bên trong).
  g.zalert_t -= dt;
  if (g.zalert_t <= 0.0 && !g.raid.active && g.zombies.some((z) => !z.dead && game.Game.in_shop(z.pos))) {
    g.zalert_t = 12.0;
    g.play('groan', 0.9);
    g.say('A zombie is inside the store!  [2] weapon  [LMB] swing');
  }
}

// ---------- hệ thống ----------

/** Bevy system `tick_actors(game, fx, time)`. ctx.fx = the `Fx` resource (mat.js `Fx`: flash_pos, flash_col, flash...). */
export function tick_actors(g, dt0, ctx) {
  if (g.mode !== 'Play' || g.cine !== null) {
    return;
  }
  const fx = ctx.fx;
  const dt = Math.min(dt0, 0.05);
  if (g.zoo && g.zoo_kind !== '' && g.zoo_kind !== '1') {
    // Hàng trưng bày trước phông xám: `people` 24 khách, `zombies` 24 zombie, `turn` ba khách + ba zombie mỗi con bốn góc.
    if (g.customers.length === 0 && g.zombies.length === 0) {
      const zs = web.query('zseed');
      const seed0 = zs !== null && /^\+?\d+$/.test(zs) && Number(zs.replace('+', '')) <= 4294967295 ? Number(zs.replace('+', '')) : 0;
      const turn_ = g.zoo_kind === 'turn';
      for (let k = 0; k < 24; k++) {
        const row = trunc(k / 12), col = k % 12;
        const pos = v3(-4.125 + col * 0.75, 0.0, lay.ZOO_Z + 2.6 + row * 7.0);
        const [seed, yaw] = turn_ ? [(seed0 + trunc(col / 4)) >>> 0, PI + [0.0, 0.8, 1.5708, 3.1416][col % 4]] : [(seed0 + k) >>> 0, PI];
        const zombie = turn_ ? row === 1 : g.zoo_kind === 'zombies';
        if (zombie) {
          const i = spawn_zombie(g, 'Base', pos, false);
          g.zombies[i].yaw = yaw;
          g.zombies[i].seed = seed;
        } else {
          const c = new_customer(g);
          c.seed = seed;
          c.pos = pos;
          c.yaw = yaw;
          c.path = [];
          c.state = 'Queue';
          g.customers.push(c);
        }
      }
    }
    return;
  }
  if (g.zoo) {
    // Trưng bày: 2 khách, 3 loại zombie đứng yên trước quán.
    if (g.customers.length === 0) {
      [-3.2, -2.0].forEach((x, k) => {
        const c = new_customer(g);
        c.seed = (0x1234 + k * 7717) >>> 0;
        c.pos = v3(x, 0.0, lay.ZOO_Z);
        c.yaw = PI;
        c.path = [];
        c.state = 'Queue';
        if (k === 1) {
          c.basket.push([game.TIN, 3]);
        }
        g.customers.push(c);
      });
      [['Base', -0.6], ['Tumour', 0.8], ['Hulk', 2.6]].forEach(([kind, x], k) => {
        const i = spawn_zombie(g, kind, v3(x, 0.0, lay.ZOO_Z), false);
        g.zombies[i].yaw = PI;
        g.zombies[i].seed = (0x777 + k * 3331) >>> 0;
      });
    }
    return;
  }
  tick_customers(g, dt);
  combat.tick(g, dt);
  tick_zombies(g, fx, dt);
  combat.tick_raid(g, dt);
  staff.tick_staff(g, dt);
  craft.tick(g, dt);
  build.tick(g, dt);
  events.tick(g, dt);
  const fl = g.cb.flash;
  g.cb.flash = null;
  if (fl !== null) {
    fx.flash_pos = fl[0].clone();
    fx.flash_col = v3(3.0, 1.6, 0.6);
    fx.flash = fl[1];
  }
}

/** Per-part joint rotation Quat::from_rotation_z(sz) * Quat::from_rotation_x(rx) as [x,y,z,w]. */
function part_q(sz, rx) {
  return q_mul(q_z(sz), q_x(rx));
}

/** Pose descriptor for a living customer this frame (exactly the numbers the Rust pose code computed). */
export function customer_pose(c) {
  const sw = c.moving ? Math.sin(c.phase) * 0.55 : 0.0;
  const bob = c.moving ? Math.abs(Math.sin(c.phase * 2.0)) * 0.03 : 0.0;
  const carrying = c.basket.length !== 0 || (c.goal.k === 'Sell' && c.state !== 'Leave');
  const reach = c.state === 'Look' && c.timer < 0.55;
  // Trả tiền: tay phải đưa pin ra rồi rút về, người hơi cúi; nhặt hàng: với tay và cúi theo.
  const pay = clamp(c.pay_t / 0.9, 0.0, 1.0);
  const give = Math.sin(pay * PI);
  let arms = pay > 0.0 ? [0.15, 0.3 + give * 1.25] : reach ? [0.1, 1.45] : carrying ? [1.0, 1.0] : [-sw, sw];
  const hurt = c.goal.k === 'Medical';
  if (hurt) arms = [0.95, 0.15 - sw * 0.5];
  const lean = hurt ? 0.34 : pay > 0.0 ? give * 0.18 : reach ? 0.14 : 0.0;
  const rots = [lean, -lean * 0.5, arms[0], arms[1], sw, -sw];
  // Tay hơi dang khỏi hông (dáng tự nhiên, không dính sát thân).
  const splay = [0.0, 0.0, -0.07, 0.07, 0.0, 0.0];
  const parts = rots.map((r, i) => part_q(splay[i], r));
  const pos = c.pos.add(Y.mul(bob));
  return {
    zombie: false,
    pos,
    yaw: c.yaw,
    quat: q_y(c.yaw),
    seed: c.seed,
    state: c.state,
    goal: c.goal.k,
    moving: c.moving,
    phase: c.phase,
    timer: c.timer,
    pay_t: c.pay_t,
    pay,
    give,
    sw,
    bob,
    carrying,
    reach,
    hurt,
    lean,
    arms,
    rots,
    splay,
    parts,
    basket: carrying,
    basket_n: c.basket.length,
  };
}

/** Pose descriptor for a zombie this frame (exactly the numbers the Rust pose code computed). */
export function zombie_pose(z) {
  const sw = z.moving ? Math.sin(z.phase) * 0.6 : 0.0;
  const stag = z.stagger > 0.0 ? -0.5 : 0.0;
  const fall = clamp(z.dying / 0.55, 0.0, 1.0);
  // Sweaty Rotter đang nhảy: bay vút lên rồi rơi xuống ở 0,6 giây cuối.
  const air = z.air > 0.0 ? Math.min(Math.min((5.0 - z.air) * 30.0, 60.0), z.air * 100.0) : 0.0;
  const pos = z.pos.add(Y.mul(fall * 0.1 + air));
  const sway_amp = [0.06, 0.15, 0.1, 0.05][z.seed % 4];
  const sway = Math.sin(z.phase * 0.5) * sway_amp;
  const pitch = -fall * fall * 1.45;
  const quat = q_mul(q_mul(q_y(z.yaw), q_z(sway)), q_x(pitch));
  // Vung tay: giơ cao lúc lấy đà rồi bổ xuống.
  const reach = z.wind > 0.0 ? -2.6 + (0.5 - z.wind) * 3.2 : -1.35;
  // Dáng đi theo từng con: lết đều, khập khiễng (một chân bước ngắn), kéo lê một chân, chồm tới.
  const gait = z.kind === 'Base' || z.kind === 'Tumour' ? z.seed % 4 : 0;
  const mv = z.moving ? 1.0 : 0.0;
  let ll, lr, lean, drop;
  switch (gait) {
    case 1: [ll, lr, lean, drop] = [sw * 0.35, -sw * 1.15, 0.0, 0.0]; break;
    case 2: [ll, lr, lean, drop] = [sw, (0.42 + sw * 0.12) * mv, 0.07, 0.25]; break;
    case 3: [ll, lr, lean, drop] = [sw * 1.25, -sw * 1.25, 0.2, 0.0]; break;
    default: [ll, lr, lean, drop] = [sw, -sw, 0.0, 0.0];
  }
  // Dáng tay theo từng con (chủ dự án chê mọi zombie cùng một dáng): hai tay vươn, một tay vươn một tay buông, hai tay
  // buông lủng lẳng, giơ cao chụp tới, một tay giơ vuốt; tay dang ra hai bên mỗi con một khác. Lúc lấy đà đánh thì cả hai
  // tay cùng giơ như cũ.
  const style = z.wind > 0.0 || fall > 0.0 ? 0 : trunc(z.seed / 7) % 5;
  const limp = 0.08 + sw * 0.45;
  let al, ar;
  switch (style) {
    case 1: [al, ar] = [reach + sw * 0.15, limp]; break;
    case 2: [al, ar] = [limp, -limp * 0.8]; break;
    case 3: [al, ar] = [-1.85 + sw * 0.2, -1.6 - sw * 0.2]; break;
    case 4: [al, ar] = [-0.9 + sw * 0.1, -2.1 + sw * 0.15]; break;
    default: [al, ar] = [reach + sw * 0.15, reach - sw * 0.15];
  }
  const sp = 0.06 + (trunc(z.seed / 3) % 4) * 0.05;
  const rots = [0.38 + stag - fall * 0.3 + lean, -0.2 - fall * 0.5 - lean * 0.6, al - fall, ar + drop - fall * 1.6, ll, lr];
  const splay = [0.0, 0.0, -sp, sp, 0.0, 0.0];
  // Zombies apply the NEGATED angle: Quat::from_rotation_z(sz) * Quat::from_rotation_x(-rots[i]).
  const parts = rots.map((r, i) => part_q(splay[i], -r));
  return {
    zombie: true,
    kind: z.kind,
    seed: z.seed,
    pos,
    yaw: z.yaw,
    quat,
    sway,
    pitch,
    moving: z.moving,
    phase: z.phase,
    sw,
    stagger: z.stagger,
    stag,
    wind: z.wind,
    reach,
    dying: z.dying,
    fall,
    air: z.air,
    air_h: air,
    gait,
    style,
    lean,
    drop,
    rots,
    splay,
    parts,
    chasing: z.chasing,
    raid: z.raid,
    hp: z.hp,
    hp_max: zk_stats(z.kind)[0],
    slow: z.slow,
    burn: z.burn,
    root: z.root,
    trapped: z.trapped,
    act: z.act,
    act_t: z.act_t,
    special: z.special,
    n_att: z.n_att,
    aim: z.aim.clone(),
    boss: zk_boss(z.kind),
    scale: zk_scale(z.kind),
  };
}

/** Bevy system `sync_actors`: spawn bodies for new actors, despawn gone/dead ones, pose the rest. */
export function sync_actors(g, dt, ctx) {
  let k = 0;
  while (k < g.customers.length) {
    if (g.customers[k].gone) {
      const b = g.customers[k].body;
      g.customers[k].body = null;
      if (b !== null) {
        b.despawn();
      }
      g.customers.splice(k, 1);
      continue;
    }
    const c = g.customers[k];
    if (c.body === null) {
      c.body = spawn_body(c.seed, null, c.pos);
    } else {
      c.body.update(customer_pose(c));
    }
    k += 1;
  }
  k = 0;
  while (k < g.zombies.length) {
    if (g.zombies[k].dead) {
      const b = g.zombies[k].body;
      g.zombies[k].body = null;
      if (b !== null) {
        b.despawn();
      }
      g.zombies.splice(k, 1);
      continue;
    }
    const z = g.zombies[k];
    if (z.body === null) {
      z.body = spawn_body(z.seed, z.kind, z.pos);
    } else {
      z.body.update(zombie_pose(z));
    }
    k += 1;
  }
}

/* VIEW NOTES (actors.js) — what the Rust drew for customers and zombies, for the people-kit author.

CONVENTIONS
- Model space: body faces -Z, left is -X, Y up, metres. yaw = rotation about +Y; yaw_to(d) = atan2(-d.x, -d.z), so yaw 0
  faces -Z (the counter/queue faces yaw 0). Root rotation = Quat::from_rotation_y(yaw) (zombies add sway/pitch, below).
- Skeleton (people.rs, 10 joints; bind positions in the root frame, before root scale):
  0 torso (0,0.86,0) parent root; 1 head (0,1.48,0) parent torso; 2 left upper arm (-0.2,1.4,0) parent torso;
  3 right upper arm (0.2,1.4,0) parent torso; 4 left thigh (-0.1,0.87,0) parent root; 5 right thigh (0.1,0.87,0) parent root;
  6/7 forearms (∓0.215,1.12,0) parents 2/3; 8/9 shins (∓0.1,0.47,0) parents 4/5.
  Joints 0..5 are `Body.parts`: the pose code writes ONLY their local rotations = desc.parts[i]
  (= Quat::from_rotation_z(splay[i]) * Quat::from_rotation_x(angle_i), [x,y,z,w]).
  Rotation sign (glam right-handed): +X angle swings a hanging limb (pointing -Y) FORWARD (toward -Z) and tips an upright
  torso/head BACKWARD (+Z). Negative X on the torso = bend forward.
- Elbows/knees are not driven here: people.rs `secondary` bends them every frame from the parent's X angle ax
  (Euler XYZ of the upper arm / thigh local rotation), with w = clamp((ax - prev)/dt, -12, 12):
    knee goal  = clamp(0.08 + 0.2*max(w,0) + 0.5*max(ax,0), 0, 1.5), applied as rotation_x(-cur)
    elbow goal = clamp(0.3 + 0.55*clamp(ax,-0.2,1.6) - 0.25*max(ax-1.6,0), 0.12, 1.3), applied as rotation_x(+cur)
    cur += (goal - cur) * min(dt*14, 1). So every gait gets knee flex on the forward swing.
- Root scale (uniform): living humans and non-boss zombies = look.scale = height/1.78 (height rolled per archetype from
  the seed, ~1.58..1.94 m); Hulk look.scale 1.5. Bosses and Baby use ZKind::scale: Brute 2.0, Birther 1.7, Sweaty 2.2,
  Baby 0.55, TwinBuff/TwinHeal 1.2 (passed as opts.scale in spawn_body; zk_scale() exported).
- Mesh variants are cached by seed: humans seed%64, zombies seed%24, bosses seed%2.

SPAWN  scene.people.spawn(seed, kind, pos, opts)
- kind null = living customer; else ZKind string 'Base'|'Tumour'|'Hulk'|'Brute'|'Birther'|'Baby'|'Sweaty'|'TwinBuff'|'TwinHeal'.
- opts.shadow true: Rust added a soft round blend blob under every body: MB::blob(center (0,0.012,0), radius 0.5, alpha 0.34),
  child of the root (so it scales with the body).
- opts.basket true (humans only): an open cardboard box child of the TORSO joint at torso-local (0, 0.2, -0.36) (in front of
  the belly), hidden by default, shown when desc.basket is true: outer box 0.36 x 0.2 x 0.26 m (full extents) colour
  #b08a55 CARDBOARD pattern, bevel 0.01; dark inner top 0.32 x 0.01 x 0.22 at y +0.1 colour #5a4326 FLAT; two catalog item
  models poking out: TIN at (-0.08,0.04,0) and BEANS at (0.06,0.04,0.03), scale 1.
- opts.scale: present for bosses / Baby (see above).
- Look per kind (people.rs): humans = archetype clothing from seed. Zombies: grey-green sick skin, ragged faded clothes,
  wounds, one sleeve torn, jaw open, self-lit eyes, hunch 0.05..0.1, 22% missing left / 30% missing right forearm.
  Tumour: 7 glowing orange tumours #c8804a (emissive 0.35, r 0.04..0.085) on shoulders/back + one on the head.
  Hulk: bare-chested, shoulders x1.5, chest x1.35, upper arms x1.75, forearms x1.5, legs x1.25, head x0.85, neck x1.5,
  scale 1.5, never missing limbs. Brute: like Hulk but bigger (sh 1.65, chest 1.45, arm_up 2.0, arm 1.7, leg 1.3,
  head 0.8), skin #6a7460, three bone spikes on each shoulder (#cfc6a8) and a dark metal chest plate #4a4e52 at (0,1.27,-0.215).
  Birther: wide waist 1.25, hips 1.25, big belly 0.24, skin #9a8f7e, six pink glowing egg sacs #c88a8a on the belly.
  Sweaty: very fat (waist 1.6, belly 0.16), skin #a5a88c. Baby: big head x1.4, shorts, skin #b09a8a.
  TwinBuff: tall, broad (sh 1.2), female, long hair, dark red tank top #7a2e2a, cargo pants. TwinHeal: slim (sh 0.9),
  female, long hair, green scrubs #3f6a52, green glowing tumours #6fc88a (emissive 0.9).

UPDATE  person.update(desc) every frame (sync_actors), not on the spawn frame.
Common fields: pos (Vec3, root translation INCLUDING bob/air/fall offsets), yaw, quat (root rotation [x,y,z,w], already
includes sway/pitch for zombies), rots[6] (raw X angles per part, see sign per kind), splay[6] (Z angles per part),
parts[6] (final local quats for joints 0..5 — apply these to reproduce the Rust exactly), seed, moving, phase.

CUSTOMER desc (zombie:false)
- state 'Walk'|'Look'|'Queue'|'Leave'|'Follow'; goal 'Buy'|'Sell'|'Medical'; timer (Look countdown, s); pay_t (0.9 -> 0 s,
  payment hand-over; the customer stands still while it runs); basket_n.
- phase advances dt*7.5 rad/s while moving (walk 1.5 m/s indoors, 3.0 outdoors, 3.4 fleeing). sw = moving ? sin(phase)*0.55 : 0.
- bob = moving ? |sin(2*phase)|*0.03 m : 0 (root lifted by bob).
- carrying = basket non-empty OR (goal Sell and state != Leave) -> desc.basket (box visible).
- reach = state Look && timer < 0.55 (last 0.55 s of looking at a shelf: reach into it).
- pay = clamp(pay_t/0.9,0,1); give = sin(pay*PI) (0 -> 1 -> 0 over the 0.9 s).
- arms [left, right] X angles (+ = forward):
    pay>0: [0.15, 0.3 + give*1.25] (right hand pushes batteries out to ~1.55 rad and back)
    else reach: [0.1, 1.45] (right arm reaches into the shelf)
    else carrying: [1.0, 1.0] (both forearms forward holding the box)
    else: [-sw, sw] (arms counter-swing the legs, amplitude 0.55 rad)
    hurt (goal Medical) overrides: [0.95, 0.15 - sw*0.5] (left arm clutching the belly, right swinging weakly).
- lean (torso X) = hurt 0.34 | pay>0 give*0.18 | reach 0.14 | else 0. rots = [lean, -lean*0.5, arms0, arms1, sw, -sw].
  Legs: left thigh sw, right thigh -sw. Splay Z: left arm -0.07, right arm +0.07 (arms held slightly off the hips).
  NOTE: with the sign rule above, a POSITIVE torso X tips the customer BACKWARD although the Rust comment says "người hơi cúi"
  (bends forward) — reproduce parts[] as given (it is what the Rust showed) or see the report.
- yaw: turns toward the walking direction at max 8 rad/s, to the shelf face at 6 rad/s while looking, to 0 at 6 rad/s at the
  queue spot; Follow snaps to face the player.

ZOMBIE desc (zombie:true)
- kind, boss, scale, hp, hp_max, chasing, raid, slow (in barbed wire), burn (>0 s on fire: Rust spawned spark fx only),
  root (>0 rooted by a trap), trapped, act/act_t/special/n_att/aim (boss actions, see below), air (Sweaty jump timer s).
- phase advances dt*speed*2.6 while moving (speed 1.3 wander, 1.0 Hulk wander, chase speed 4 (Birther/Baby 3, Sweaty 6),
  x1.75 near TwinBuff, x0.25 in wire). sw = moving ? sin(phase)*0.6 : 0.
- Root: pos = z.pos + Y*(fall*0.1 + air_h). quat = rot_y(yaw) * rot_z(sway) * rot_x(pitch) with
  sway = sin(phase*0.5) * [0.06,0.15,0.1,0.05][seed%4] (side-to-side lurch; note phase only advances while moving),
  pitch = -fall^2 * 1.45 (falls face-down forward ~83 deg over the dying time).
- Dying: dying counts up from 0.001 to 0.55 s, then the zombie becomes a Corpse prop and the body is despawned.
  fall = clamp(dying/0.55, 0, 1).
- Stagger (z.stagger > 0, set by player hits in combat.rs): stag = -0.5 on the torso angle (torso straightens/leans back by
  0.5 rad relative to the hunch, i.e. recoils); the zombie does not move or attack while staggered.
- Attack wind-up: wind 0.5 -> 0 s; hit lands at 0 if the player is within 1.7 m. reach = wind>0 ? -2.6 + (0.5-wind)*3.2 : -1.35
  (applied negated: arm X = +2.6 (raised overhead) at wind start, down to +1.0 at the strike). During wind-up and dying
  style is forced to 0 (both arms use reach).
- Door bashing: stands at the front door facing yaw_to(0,0,-1)=0 (the Rust shows no special pose: idle, sw=0), bang every
  `cooldown` s; ally (staff/Hulk Helper) clawing also has no special pose.
- gait (Base/Tumour only, else 0) = seed%4 -> [ll, lr, lean, drop]:
    0 even shuffle: [sw, -sw, 0, 0]
    1 limp (short left step): [sw*0.35, -sw*1.15, 0, 0]
    2 drags right leg: [sw, (0.42 + sw*0.12)*moving, 0.07, 0.25]
    3 lunging: [sw*1.25, -sw*1.25, 0.2, 0]
- style = (wind>0 || fall>0) ? 0 : floor(seed/7)%5 ; limp = 0.08 + sw*0.45 -> [al, ar]:
    0 both arms reaching: [reach + sw*0.15, reach - sw*0.15]
    1 left reaches, right dangles: [reach + sw*0.15, limp]
    2 both dangle: [limp, -limp*0.8]
    3 both raised high grabbing: [-1.85 + sw*0.2, -1.6 - sw*0.2]
    4 one raised claw: [-0.9 + sw*0.1, -2.1 + sw*0.15]
- splay = 0.06 + (floor(seed/3)%4)*0.05 (left arm Z -splay, right +splay).
- rots = [0.38 + stag - fall*0.3 + lean,  -0.2 - fall*0.5 - lean*0.6,  al - fall,  ar + drop - fall*1.6,  ll,  lr]
  and the joint rotation uses -rots[i] (torso hunched forward 0.38 rad, head tilted back 0.2 to look ahead; dying flings the
  arms up/back and straightens the torso while the root pitches forward).
- Bosses (combat.rs drives the timers; the Rust pose code used none of these except air, so they are passed for the rebuild):
    Brute act 0 idle/chase, 1 ground slam (act_t 2.0 s wind, then 200 dmg blast r5 at its feet), 2 throw (act_t 2.33 s,
    then 120 dmg r4 at `aim`, debris fx there); faces the player during an act; after 5 acts it relocates for 4 s.
    Sweaty: air 5.0 -> 0 s jump: air_h = min((5-air)*30, 60, air*100) m (rises 30 m/s to a 60 m cap, drops in the last 0.6 s),
    lands at aim (locked 1 s before landing) with a 300 dmg blast r6; never claws, stands still within 3 m.
    Birther: special counts 20 s, then 6..8 babies spawn 0.5 m behind it (roar). Twins share a HP pool; aura radius 15 m.
- Raid / Rude zombies look the same as Base.

PORT GAPS
- Bevy entity handles (Body.root/parts/extra) replaced by the people handle; the pose is delivered as `desc` (incl. final
  part quats) instead of writing joint Transforms. Mesh code of spawn_body (blob + basket) is described above, not built here.
- ZKind impl methods (stats/boss/label/scale) are local copies (zk_*), see report.
*/
