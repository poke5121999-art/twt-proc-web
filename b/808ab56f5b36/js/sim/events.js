//! Sự kiện và dịch vụ (cờ `events`, `docks`): Exotic Merchant, vòng quay của Dr. Gib, hợp đồng Drop Dead Docks, quảng cáo
//! Mobile News Crew, cửa hàng trên bản đồ, đặt đội phá tường, bảng nâng cấp / sơn. Mọi thứ dùng chung một bảng "Trade".
//! Luật theo `~/twt-bevy/docs/rules/world-events.md` mục 3, 5, 6, 7, 8, 9:
//! - Thương nhân: lần đầu ngày 4, xét mỗi giờ từ 08:00, ngày có raid thì dời sang hôm sau; tới rồi thì lần kế sau
//!   `clamp(4 - nút kỹ năng, 1, 4)` ngày; hôm sau rời đi. 26 mặt hàng (giá = ceil(giá trị x hệ số)), bỏ bớt `5 - nút` mặt hàng.
//! - Dr. Gib: tới sau 18:00 khi máy phát đã chạy, rời lúc sang ngày; một lượt quay tốn `RoundToInt(hệ số x 30)` Good Meat;
//!   16 ô, mỗi ô một món khác nhau; bậc hiếm: Limited 10%, Sparse 15%, Rare 25%, còn lại Uncommon; quay 8 giây.
//! - Drop Dead Docks: tối đa 4 lời mời; món đều trong 64 món có hợp đồng; số lượng `Random(min, max)` làm tròn bội 5 khi > 3;
//!   hạn 1..14 ngày; điểm = (a x 0,3 + 0,3 + b x 0,4) x độ khó, bậc thưởng = phần nguyên của điểm; chỉ một hợp đồng chạy;
//!   mỗi lần KHÁCH MUA món đó cộng tiến độ; hết hạn thì mất hợp đồng; đổi lời mời 250 x 2^n pin; gia hạn 1000 x 2,5^n pin.
//! - Mobile News Crew: tầm Low / Medium / High cần uy tín 10 / 50 / 75; giá = max(ceil(eff x giá trị x {2, 6, 15}), tầm x 25),
//!   eff = max(ngày - 2, 0) x 0,75 + min(ngày, 2); khách quảng cáo tới theo nhịp `nhịp khách / {0,5; 0,75; 1}`.
//! - Cửa hàng trên bản đồ: nhập hàng mỗi sáng; đơn giá = ceil(giá trị x hệ số món x hệ số kỹ năng); mua bằng cách cử nhân viên.
//! - Đội phá tường: 1000 pin (phòng đầu) / 5000 pin, tới 09:00 hôm sau, mỗi lúc một đội.
//! `[ĐỀ XUẤT]`: danh sách món thưởng từng bậc của Docks không có trong tài liệu số, bản này lấy đồ trang trí cùng bậc hiếm;
//! TV gốc (TelevisionObject) chỉ bật / tắt màn, không có bản tin: xem player.js.

import { v3, trunc, clamp } from './vec.js';
import * as catalog from './catalog.js';
import * as data from './data.js';
import * as game from './game.js';
import * as items from './items.js';
import * as lay from './lay.js';
import * as skills from './skills.js';
import * as map from './map.js';
import * as craft from './craft.js';
import * as build from './build.js';
import * as staff from './staff.js';
import * as actors from './actors.js';

const f32 = Math.fround;
/** Rust f32::round (half away from zero). */
const rround = (v) => Math.sign(v) * Math.round(Math.abs(v));
/** Rust `(reach as usize - 1).min(2)` on u8 (release build wraps 0 - 1 to usize::MAX, so 0 -> 2). */
const ri = (reach) => (reach < 1 ? 2 : Math.min(reach - 1, 2));
/** Rust `s.parse::<i32>().ok()` */
function parse_i32(s) {
  if (!/^[+-]?\d+$/.test(s)) return null;
  const v = Number(s);
  return v >= -2147483648 && v <= 2147483647 ? v : null;
}
const sat1 = (n) => Math.max(0, n - 1);

/** enum Trade: {k:'None'} | {k:'Merchant'} | {k:'Shop', a:lm} | {k:'Docks'} | {k:'Wheel'} | {k:'News'} | {k:'Upgrade', a:t} | {k:'Paint', a:item} | {k:'Demolition'} */
export const Trade = {
  None: () => ({ k: 'None' }),
  Merchant: () => ({ k: 'Merchant' }),
  /// Cửa hàng ở landmark (chỉ số trong `map::LANDMARKS`).
  Shop: (lm) => ({ k: 'Shop', a: lm }),
  Docks: () => ({ k: 'Docks' }),
  Wheel: () => ({ k: 'Wheel' }),
  News: () => ({ k: 'News' }),
  Upgrade: (t) => ({ k: 'Upgrade', a: t }),
  /// Chọn mẫu sơn cho xô sơn / vật liệu sàn (món).
  Paint: (item) => ({ k: 'Paint', a: item }),
  Demolition: () => ({ k: 'Demolition' }),
};
/** `{:?}` of a Trade. */
function trade_debug(t) {
  return t.a === undefined ? t.k : `${t.k}(${t.a})`;
}

export class Contract {
  constructor(item = 0, target = 0, have = 0, window = 0, expire = 0, reward = 0) {
    this.item = item;
    this.target = target;
    this.have = have;
    this.window = window;
    this.expire = expire;
    this.reward = reward;
  }
  clone() {
    return new Contract(this.item, this.target, this.have, this.window, this.expire, this.reward);
  }
}

export class State {
  constructor() {
    this.trade = { k: 'None' };
    this.sel = 0;
    this.days = 0;
    this.reach = 0;
    this.merchant_here = false;
    this.merchant_next = 0;
    /** [(item, price, stock)] */
    this.merchant_stock = [];
    this.gib_here = false;
    /** [(item, n)] */
    this.wheel = [];
    this.spin_t = 0;
    this.spin_to = 0;
    /** Contract[] */
    this.offers = [];
    /** Contract | null */
    this.active = null;
    this.rerolls = 0;
    this.extends = 0;
    /// Quảng cáo đang chạy: (món, tầm 1..3, số ngày còn lại).
    this.ad = null;
    this.ad_since = 0;
    /// Hàng tồn của các cửa hàng trên bản đồ: (landmark, món, đơn giá, số lượng), nhập lại mỗi ngày.
    this.shops = [];
    this.shop_day = 0;
    /// Giỏ đang chọn ở cửa hàng: (món, số lượng, đơn giá).
    this.basket = [];
    /** [day, room] | null */
    this.crew_due = null;
    this.hour = 0;
    this.day = 0;
    this.force_merchant = false;
    /// Móc kiểm thử `?docks=`: món của hợp đồng đầu tiên.
    this.force_offer = null;
  }
}

/// (món, hệ số giá x100, tồn ít nhất, nhiều nhất, xác suất x100, điều kiện: 0 không, 1 hạ Twins, 2 mở Junkyard, 3 hạ Birther, 4 hạ Brute).
// Item ids written as numbers (game.js constants must not be read at module top level); names in comments.
export const MERCHANT = [
  [52 /*CHAINSAW*/, 80, 1, 3, 100, 1], [198 /*STUN_STICK*/, 300, 1, 1, 20, 0], [187, 80, 1, 2, 75, 0], [6 /*AK47*/, 75, 2, 4, 100, 0], [168, 80, 1, 1, 100, 0], [92 /*GRENADE*/, 75, 12, 16, 100, 0], [79 /*FIRSTAID*/, 50, 4, 6, 75, 0],
  [78, 75, 8, 16, 100, 0], [5 /*AMMO_9MM*/, 50, 100, 250, 100, 0], [1, 50, 100, 250, 100, 0], [2 /*AMMO_556*/, 50, 100, 250, 100, 0], [3, 50, 100, 250, 100, 0], [9 /*AUTO_MINIGUN*/, 400, 1, 1, 20, 0],
  [73 /*EXPLOSIVE_BARREL*/, 100, 3, 3, 100, 0], [59 /*CROWBAR*/, 200, 1, 1, 100, 0], [211 /*UZI*/, 100, 1, 1, 100, 0], [184 /*SLEEPING_BAG*/, 200, 1, 1, 100, 0], [83 /*GAS_CAN*/, 200, 12, 24, 100, 2], [151, 200, 6, 12, 80, 3],
  [163 /*RELAY*/, 400, 2, 6, 80, 4], [145 /*PIPE_WRENCH*/, 50, 4, 5, 100, 4], [174 /*SAWBLADE*/, 160, 120, 240, 100, 2], [41, 50, 10, 10, 100, 0], [8, 50, 48, 64, 100, 0], [224 /*TV*/, 500, 1, 1, 80, 1], [51 /*CARNIVAL*/, 100, 1, 4, 100, 0],
];

export function open(g, t) {
  let need;
  switch (t.k) {
    case 'Docks': case 'News': need = game.FF_DOCKS; break;
    case 'Merchant': case 'Wheel': need = game.FF_EVENTS; break;
    case 'Paint': case 'Demolition': need = game.FF_BUILD; break;
    default: need = 0;
  }
  if (need !== 0 && !g.on(need)) {
    g.play('deny', 0.5);
    g.say('Not available yet.');
    return;
  }
  g.ev.trade = { ...t };
  g.ev.sel = 0;
  if (g.ev.days < 1) {
    g.ev.days = 3;
  }
  if (g.ev.reach < 1) {
    g.ev.reach = 1;
  }
  if (t.k === 'Docks') {
    fill_offers(g);
  }
  g.panel = { k: 'Trade' };
  g.play('click', 0.5);
}

// ---------- thương nhân ----------

export function merchant_arrive(g) {
  const lm = (i) => g.lm[i];
  let stock = [];
  for (const [item, pm, mn, mx, ch, req] of MERCHANT) {
    let ok;
    switch (req) {
      case 1: ok = lm(17) === 2; break;
      case 2: ok = lm(12) >= 1; break;
      case 3: ok = lm(13) === 2; break;
      case 4: ok = lm(9) === 2; break;
      default: ok = true;
    }
    if (ok && f32(g.rng.next() * 100.0) <= ch) {
      stock.push([item, trunc(Math.ceil(f32(f32(items.ival(item) * pm) / 100.0))), g.rng.int(mn, mx)]);
    }
  }
  // Bỏ bớt `5 - nút kỹ năng` mặt hàng ngẫu nhiên (ít nhất còn một).
  const k = Math.max(5 + trunc(skills.sum(g, 'ExoticMerchantItemOffering')), 0);
  const times = Math.min(k, sat1(stock.length));
  for (let r = 0; r < times; r++) {
    const i = clamp(g.rng.int(0, stock.length - 1), 0, stock.length - 1);
    // Xà beng là món mở kho nên luôn được giữ lại [ĐỀ XUẤT: bản gốc bỏ ngẫu nhiên, lượt chơi thật vẫn luôn thấy Crowbar].
    if (stock[i][0] !== game.CROWBAR) {
      stock.splice(i, 1);
    }
  }
  g.ev.merchant_stock = stock;
  g.ev.merchant_here = true;
  g.ev.merchant_next = g.day + clamp(4 - trunc(skills.sum(g, 'ExoticMerchantFrequency')), 1, 4);
  g.play('radio', 0.6);
  // chữ gốc loc:gameplay_notification_exotic_merchant (PARITY M01)
  g.say('The exotic merchant has arrived outside the car park for the day. Check out his rare wares when you get a chance.');
}

// ---------- Dr. Gib ----------

export function spin_cost(g) {
  const m = skills.mul(g, 'GamblerCostMultiplier');
  return trunc(rround(f32((m > 0.0 ? m : 1.0) * 30.0)));
}

export function gib_arrive(g) {
  const INFO = data.INFO;
  const rare = skills.has(g, 'GamblerRareItemChance');
  const pool = [];
  for (let i = 0; i < catalog.N_CAT; i++) {
    if (INFO[i].gamble[1] > 0 && INFO[i].gamble[2] > 0.0) pool.push(i);
  }
  const used = [];
  const wheel = [];
  for (let s = 0; s < 16; s++) {
    const v = g.rng.next();
    const rank = rare || v < 0.1 ? 4 : v < 0.25 ? 3 : v < 0.5 ? 2 : 1;
    let cand = pool.filter((i) => INFO[i].rarity === rank && !used.includes(i));
    if (cand.length === 0) {
      cand = pool.filter((i) => !used.includes(i));
    }
    if (cand.length === 0) {
      cand = pool.slice();
    }
    const it = g.rng.pick(cand);
    used.push(it);
    wheel.push([it, Math.max(g.rng.int(INFO[it].gamble[0], INFO[it].gamble[1]), 1)]);
  }
  g.ev.wheel = wheel;
  g.ev.gib_here = true;
  g.say("Dr. Gib's wheel truck has pulled up behind the store.");
}

export function spin(g) {
  if (g.ev.spin_t > 0.0) {
    return;
  }
  const cost = spin_cost(g);
  if (g.inv[game.MEAT] < cost) {
    g.play('deny', 0.5);
    g.say(`A spin costs ${cost} Good Meat. Shred corpses to get meat.`);
    return;
  }
  g.inv[game.MEAT] -= cost;
  g.ev.spin_t = 8.0;
  g.ev.spin_to = clamp(g.rng.int(0, 15), 0, 15);
  g.play('pay', 0.6);
}

// ---------- Drop Dead Docks ----------

export function reward_for(g, tier, skip) {
  const CAT = catalog.CAT, INFO = data.INFO;
  let cand = [];
  for (let i = 0; i < catalog.N_CAT; i++) {
    if (CAT[i].ty === 3 && CAT[i].value > 0 && INFO[i].rarity === tier && !skip.includes(i)) cand.push(i);
  }
  if (tier === 2) {
    cand.push(37);
  }
  if (tier === 4) {
    cand.push(39);
  }
  if (cand.length === 0) {
    for (let i = 0; i < catalog.N_CAT; i++) {
      if (CAT[i].ty === 3 && CAT[i].value > 0) cand.push(i);
    }
  }
  return g.rng.pick(cand);
}

export function fill_offers(g) {
  const INFO = data.INFO;
  if (g.ev.active !== null) {
    return;
  }
  const item0 = g.ev.force_offer;
  g.ev.force_offer = null;
  if (item0 !== null) {
    const reward = reward_for(g, 1, []);
    g.ev.offers.push(new Contract(item0, 3, 0, 3, 0, reward));
  }
  const pool = [];
  for (let i = 0; i < catalog.N_CAT; i++) {
    if (INFO[i].mission[0] > 0) pool.push(i);
  }
  let tries = 0;
  while (g.ev.offers.length < 4 && tries < 12) {
    tries += 1;
    const item = g.rng.pick(pool);
    const [diff, mn, mx] = INFO[item].mission;
    let n = g.rng.int(mn, mx);
    if (n > 3) {
      n = Math.max(trunc(rround(f32(n / 5.0))) * 5, 5);
    }
    const window = g.rng.int(1, 14);
    // Phép tính f32 như Rust (bậc thưởng lấy phần nguyên nên sai số f64 có thể đổi bậc).
    const a = mx > mn ? f32(f32(n - mn) / f32(mx - mn)) : 1.0;
    const b = f32(1.0 - f32(f32(window - 1) / 13.0));
    const score = f32(f32(f32(f32(clamp(a, 0.0, 1.0) * f32(0.3)) + f32(0.3)) + f32(b * f32(0.4))) * diff);
    const skip = g.ev.offers.map((o) => o.reward);
    const reward = reward_for(g, clamp(trunc(Math.floor(score)), 0, 4), skip);
    g.ev.offers.push(new Contract(item, n, 0, window, 0, reward));
  }
}

/// Khách vừa mua một món: cộng tiến độ hợp đồng đang chạy.
export function sold(g, item) {
  const c0 = g.ev.active;
  if (c0 === null) return;
  if (c0.item !== item) {
    return;
  }
  c0.have += 1;
  if (c0.have >= c0.target) {
    const c = g.ev.active;
    g.ev.active = null;
    g.add_prop({ k: 'Crate', a: [c.reward] }, lay.DELIVERY.add(v3(-1.4, 0.0, 0.5)), 0.6);
    g.ev.rerolls = 0;
    g.ev.extends = 0;
    fill_offers(g);
    g.play('quest', 0.7);
    // chữ gốc loc:gameplay_notification_mission_complete (PARITY M06): gốc hiện thành thẻ xanh có dấu tích trong cột thông
    // báo bên phải (plug/notes.js), không có toast giữa màn; không có plug-in thì về dòng chữ dưới.
    const msg = 'Contract complete, good job! A reward has been delivered outside the store.';
    if (Array.isArray(globalThis.__twtNotes)) globalThis.__twtNotes.push({ kind: 'ok', text: msg });
    else g.say(msg);
  }
}

// ---------- cửa hàng trên bản đồ ----------

export function restock(g) {
  g.ev.shop_day = g.day;
  g.ev.shops.length = 0;
  const sm = skills.mul(g, 'WorldShopStockMultiplier');
  const stock_mul = sm > 0.0 ? sm : 1.0;
  const pm = skills.mul(g, 'WorldShopPriceMultiplier');
  const price_mul = pm > 0.0 ? pm : 1.0;
  for (let i = 0; i < map.N_LM; i++) {
    const d = map.lmd(i);
    for (const [item0, mult, mn, mx, chance, need, notl, learned] of d.shop) {
      const item = item0;
      if (g.rng.next() > f32(chance)) {
        continue;
      }
      if (need >= 0 && g.lm[map.from_ron(need)] !== 2) {
        continue;
      }
      if (notl >= 0 && craft.known(g, notl)) {
        continue;
      }
      if (learned >= 0 && !craft.known(g, learned)) {
        continue;
      }
      const x = f32(g.rng.int(mn, mx) * stock_mul);
      const n = trunc(Math.floor(x)) + (g.rng.next() < f32(x - Math.trunc(x)) ? 1 : 0);
      if (n > 0) {
        g.ev.shops.push([i, item, trunc(Math.ceil(f32(f32(f32(items.ival(item)) * f32(mult)) * price_mul))), n]);
      }
    }
  }
}

export function shop_rows(g, lm) {
  return g.ev.shops.filter((s) => s[0] === lm).map((s) => [s[1], s[2], s[3]]);
}

// ---------- quảng cáo ----------

/// [PARITY M08] gốc AdvertisingManager.GetAdvertisableItems: mọi ItemData trong StageModel.ItemDataToObjectsLookup có >= 1
/// ItemObject và _canBeSold, xếp theo số ItemObject giảm dần. Ở đây: món trên kệ + món rời / trong hộp, thùng nằm trong quán,
/// kho, phòng (map.stored_props); không tính ba lô.
export function ad_items(g) {
  const cnt = [];
  const add = (it) => {
    if (it === null || it === undefined || !items.sellable(it)) return;
    const c = cnt.find((c) => c[0] === it);
    if (c !== undefined) c[1] += 1;
    else cnt.push([it, 1]);
  };
  for (const sh of g.shelves) for (const it of sh.slots) add(it);
  for (const p of map.stored_props(g)) {
    if (p.kind.k === 'Item') add(p.kind.a);
    else for (const it of p.kind.a) add(it);
  }
  cnt.sort((a, b) => b[1] - a[1]);
  return cnt;
}

export function ad_cost(item, reach, days) {
  const eff = Math.max(days - 2, 0) * 0.75 + Math.min(days, 2);
  const mult = [2.0, 6.0, 15.0][ri(reach)];
  return Math.max(trunc(Math.ceil(f32(f32(eff * items.ival(item)) * mult))), reach * 25);
}

// ---------- bảng Trade ----------

export function rows(g) {
  const t = g.ev.trade;
  switch (t.k) {
    case 'Merchant': return g.ev.merchant_stock.length;
    case 'Shop': return shop_rows(g, t.a).length;
    case 'Docks': return g.ev.active !== null ? 1 : g.ev.offers.length;
    case 'Wheel': return 1;
    case 'News': return ad_items(g).length;
    case 'Upgrade': case 'Demolition': return 1;
    case 'Paint': return build.paints_for(t.a).length;
    case 'None': return 0;
  }
  return 0;
}

/** icons::Cards::default() (icons.rs is not ported; Cards is a plain object with the Rust field names). */
function new_cards() {
  return { head: '', tabs: [], cards: [], sel: 0, det_icon: null, det_title: '', det: '', foot: '' };
}

function free_wage(g) {
  const s = g.staff.find((s) => s.hired && !s.gone && !s.away);
  return s !== undefined ? s.wage : null;
}

/// Thương nhân và cửa hàng trên bản đồ dạng lưới thẻ món (bản gốc: thẻ có hình, tên, tồn kho, giá; khung chi tiết bên phải).
export function cards(g) {
  const sel = Math.min(g.ev.sel, sat1(rows(g)));
  let title, list, foot;
  const t = g.ev.trade;
  switch (t.k) {
    case 'Merchant':
      title = 'EXOTIC MERCHANT';
      list = g.ev.merchant_stock.map(([it, p, n]) => [it, p, n]);
      foot = '[W / S] previous / next    [Enter] buy 1    [Shift+Enter] buy 10    [E] close\nPurchases drop in a package next to the truck.';
      break;
    case 'Shop': {
      const lm = t.a;
      const total = g.ev.basket.reduce((s, b) => s + b[1] * b[2], 0);
      const wage = free_wage(g);
      const cost = wage !== null ? `  + wage ${wage} = ${staff.job_cost(g, wage + total)} Batteries` : '   (needs a free staff member to fetch it)';
      title = map.LANDMARKS[lm].name.toUpperCase();
      list = shop_rows(g, lm).map(([it, p, n]) => [it, p, n]);
      foot = `Basket: ${total} Batteries${cost}      Trip: ${map.LANDMARKS[lm].travel} game minutes each way\n[W / S] previous / next    [Enter] add 1    [X] clear basket    [G] send staff    [E] close`;
      break;
    }
    case 'Docks': return docks_cards(g, sel);
    case 'News': return news_cards(g, sel);
    default:
      return null;
  }
  const inb = (it) => {
    const b = g.ev.basket.find((b) => b[0] === it);
    return b !== undefined ? b[1] : 0;
  };
  const cs = list.map(([it, price, n]) => ({
    icon: { k: 'Item', a: it },
    name: items.iname(it),
    sub: inb(it) > 0 ? `${price} B   basket ${inb(it)}` : `${price} B   stock ${n}`,
    state: inb(it) > 0 ? 2 : price > g.batteries ? 3 : 0,
  }));
  const c = new_cards();
  c.cards = cs;
  c.sel = sel;
  c.head = `${title}      Batteries ${g.batteries}`;
  const row = sel < list.length ? list[sel] : null;
  if (row !== null) {
    const [it, price, n] = row;
    c.det_icon = { k: 'Item', a: it };
    c.det_title = items.iname(it);
    const shop = t.k === 'Shop';
    c.det = `Est. value: ${items.ival(it)} Batteries\n${shop ? 'Price' : 'Merchant price'}: ${price} Batteries\nIn stock: ${n}\n${shop ? `In basket: ${inb(it)}\n` : ''}You carry: ${g.inv[it]}`;
  } else {
    c.det_title = 'Sold out today';
  }
  c.foot = foot;
  return c;
}

/// [phiên 8] Drop Dead Docks dạng thẻ (trước là bảng chữ đơn cách): mỗi lời mời một thẻ mang hình món phải bán, "x5 · 1 day";
/// khung chi tiết: món thưởng (hình to), số lượng, hạn, cách tính; hợp đồng đang chạy là một thẻ với tiến độ. Luật không đổi.
function docks_cards(g, sel) {
  const c = new_cards();
  const a = g.ev.active;
  c.head = `DROP DEAD DOCKS - SALES CONTRACTS      Batteries ${g.batteries}`;
  const days = (n) => `${n} day${n === 1 ? '' : 's'}`;
  if (a !== null) {
    const left = Math.max(a.expire - g.day, 0);
    c.cards = [{ icon: { k: 'Item', a: a.item }, name: `Sell ${a.target}x ${items.iname(a.item)}`, sub: `${a.have}/${a.target}   ${days(left)} left`, state: a.have >= a.target ? 2 : 0 }];
    c.sel = 0;
    c.det_icon = { k: 'Item', a: a.reward };
    c.det_title = `Reward: ${items.iname(a.reward)}`;
    c.det = `ACTIVE CONTRACT\nSell ${a.target}x ${items.iname(a.item)} to customers.\nProgress: ${a.have} / ${a.target}\nExpires in: ${days(left)}\n\nEvery customer purchase of ${items.iname(a.item)} counts. The reward is left at the delivery point.`;
    c.foot = `[X] extend 1 day (${extend_cost(g)} Batteries)    [E] close`;
    return c;
  }
  c.cards = g.ev.offers.map((o) => ({ icon: { k: 'Item', a: o.item }, name: `${o.target}x ${items.iname(o.item)}`, sub: `within ${days(o.window)}`, state: 0 }));
  c.sel = sel;
  const o = sel < g.ev.offers.length ? g.ev.offers[sel] : null;
  if (o !== null) {
    c.det_icon = { k: 'Item', a: o.reward };
    c.det_title = `Reward: ${items.iname(o.reward)}`;
    c.det = `Sell: ${o.target}x ${items.iname(o.item)}\nTime: ${days(o.window)}\nItem value: ${items.ival(o.item)} Batteries each\nYou carry: ${g.inv[o.item]}\n\nOnly one contract runs at a time. Every customer purchase of the item counts.`;
  } else {
    c.det_title = 'No offers today';
  }
  c.foot = `[W / S] select    [Enter] accept    [R] re-roll offers (${reroll_cost(g)} Batteries)    [E] close`;
  return c;
}

/// [PARITY M08] Mobile News Crew như gốc (clip 18 2:15-2:45, AdvertisingInfoState): "What are you promoting?" là lưới ô hình
/// món (SelectableItemIconView), tên món chọn ở góc phải, Campaign Length, Reach Short / Medium / Long, Start Promotion + giá.
/// Đang có chiến dịch thì gốc hiện chiến dịch đang chạy (ActiveAdvertView). Món chọn được: mọi món bán được đang ở trong quán (ad_items).
function news_cards(g, sel) {
  const c = new_cards();
  const list = ad_items(g);
  c.head = `MOBILE NEWS CREW      Batteries ${g.batteries}`;
  c.cards = list.map(([it, n]) => ({ icon: { k: 'Item', a: it }, name: items.iname(it), sub: `in store ${n}`, state: 0 }));
  c.icons = true; // gốc: lưới 5 cột ô vuông chỉ hình (clip 18 2:21)
  c.sel = sel;
  const run = g.ev.ad !== null ? `

You are currently promoting ${items.iname(g.ev.ad[0])} (${LMH[ri(g.ev.ad[1])]}), ${g.ev.ad[2]} Days left.` : '';
  const row = sel < list.length ? list[sel] : null;
  if (row !== null) {
    const it = row[0];
    c.det_icon = { k: 'Item', a: it };
    c.det_title = items.iname(it);
    c.det = `What are you promoting?  ${items.iname(it)}
Campaign Length: ${g.ev.days.toFixed(2)} Days
Reach: ${LMH.map((r, k) => (k === ri(g.ev.reach) ? `[${r}]` : r)).join('  ')}
Start Promotion: ${ad_cost(it, g.ev.reach, g.ev.days)} Batteries

Need to shift a lot of stock in a hurry? Spread the word about your stock and get more customers in your store fast.
Short needs reputation 10, Medium 50, Long 75 (you have ${g.rep.toFixed(0)}).${run}`;
  } else {
    c.det_title = 'Nothing to promote';
    c.det = `Nothing sellable in the store: only items in the store can be advertised.${run}`;
  }
  c.foot = '[W / S] select    [A / D] reach    [- / =] campaign length    [Enter] start promotion    [E] close';
  return c;
}

const LMH = ['Short', 'Medium', 'Long']; // gốc: nút Reach "Short / Medium / Long" (clip 18 2:30, PARITY M08)

export function panel_text(g) {
  const sel = Math.min(g.ev.sel, sat1(rows(g)));
  const mark = (k) => (k === sel ? '>' : ' ');
  let out = '';
  const t = g.ev.trade;
  switch (t.k) {
    case 'Merchant': {
      out += `EXOTIC MERCHANT        your batteries: ${g.batteries}\n\n`;
      const st = g.ev.merchant_stock;
      const from = Math.min(Math.max(0, sel - 6), Math.max(0, st.length - 13));
      for (let k = from; k < Math.min(st.length, from + 13); k++) {
        const [it, price, n] = st[k];
        out += `${mark(k)} ${items.iname(it).padEnd(22)} ${String(price).padStart(5)} Batteries   stock ${n}\n`;
      }
      out += '\n[W / S] select   [Enter] buy 1   [Shift+Enter] buy 10\nPurchases drop in a package next to the truck.   [E] close';
      break;
    }
    case 'Shop': {
      const lm = t.a;
      const list = shop_rows(g, lm);
      out += `${map.LANDMARKS[lm].name.toUpperCase()}        your batteries: ${g.batteries}\n\n`;
      if (list.length === 0) {
        out += 'Sold out today. The shop restocks every morning.\n';
      }
      const from = Math.min(Math.max(0, sel - 6), Math.max(0, list.length - 13));
      for (let k = from; k < Math.min(list.length, from + 13); k++) {
        const [it, price, n] = list[k];
        const b = g.ev.basket.find((b) => b[0] === it);
        const inb = b !== undefined ? b[1] : 0;
        out += `${mark(k)} ${items.iname(it).padEnd(26)} ${String(price).padStart(5)} Batteries   stock ${String(n).padEnd(4)} ${inb > 0 ? `basket ${inb}` : ''}\n`;
      }
      const total = g.ev.basket.reduce((s, b) => s + b[1] * b[2], 0);
      const wage = free_wage(g);
      out += `\nBasket: ${total} Batteries`;
      out += wage !== null ? `  + wage ${wage} = ${staff.job_cost(g, wage + total)} Batteries` : '   (needs a free staff member to fetch it)';
      out += `\nTrip: ${map.LANDMARKS[lm].travel} game minutes each way.\n[W / S] select   [Enter] add 1   [X] clear basket   [G] send staff   [E] close`;
      break;
    }
    case 'Docks': {
      out += 'DROP DEAD DOCKS  -  sales contracts\n\n';
      const c = g.ev.active;
      if (c !== null) {
        out += `ACTIVE: sell ${c.target}x ${items.iname(c.item)} to customers.\nProgress ${c.have}/${c.target}   expires in ${Math.max(c.expire - g.day, 0)} day(s)\nReward: ${items.iname(c.reward)}\n\n[X] extend 1 day (${extend_cost(g)} Batteries)   [E] close`;
      } else {
        g.ev.offers.forEach((c, k) => {
          out += `${mark(k)} Sell ${String(c.target).padStart(3)}x ${items.iname(c.item).padEnd(20)} within ${String(c.window).padStart(2)} days   reward: ${items.iname(c.reward)}\n`;
        });
        out += `\nOnly one contract runs at a time. Every customer purchase of the item counts.\n[W / S] select   [Enter] accept   [R] re-roll offers (${reroll_cost(g)} Batteries)   [E] close`;
      }
      break;
    }
    case 'Wheel': {
      out += `DR. GIB'S WHEEL      spin: ${spin_cost(g)} Good Meat   (you carry ${g.inv[game.MEAT]})\n\n`;
      const at = g.ev.spin_t > 0.0 ? trunc(f32(g.ev.spin_to + f32(f32(g.ev.spin_t * g.ev.spin_t) * 3.0))) % 16 : null;
      g.ev.wheel.forEach(([it, n], k) => {
        out += `${at === k ? '>' : ' '}${String(n).padStart(3)}x ${items.iname(it).padEnd(20)}${k % 2 === 1 ? '\n' : '  '}`;
      });
      out += g.ev.spin_t > 0.0 ? '\nThe wheel is spinning...' : '\n[Enter] spin   [E] close';
      break;
    }
    case 'News': {
      const list = ad_items(g);
      out += `MOBILE NEWS CREW  -  advertising        your batteries: ${g.batteries}   reputation ${g.rep.toFixed(0)}\n\n`;
      if (g.ev.ad !== null) {
        const [it, reach, days] = g.ev.ad;
        out += `Running: ${items.iname(it)} (${LMH[ri(reach)]}), ${days} day(s) left.\n\n`;
      }
      if (list.length === 0) {
        out += 'Nothing sellable in the store: only items in the store can be advertised.\n';
      }
      for (let k = 0; k < Math.min(list.length, 12); k++) {
        const [it, n] = list[k];
        out += `${mark(k)} ${items.iname(it).padEnd(22)} in store ${String(n).padEnd(3)} cost ${ad_cost(it, g.ev.reach, g.ev.days)} Batteries\n`;
      }
      out += `\nReach: ${LMH[ri(g.ev.reach)]}  [A / D]      Days: ${g.ev.days}  [- / =]\nShort needs reputation 10, Medium 50, Long 75.\n[W / S] select   [Enter] buy the campaign   [E] close`;
      break;
    }
    case 'Upgrade': {
      const r = build.upgrade_rows(g, t.a);
      if (r !== null) {
        const [name, rws] = r;
        out += `UPGRADE   ${name}\n\n`;
        for (const [it, need, have] of rws) {
          out += `  ${items.iname(it).padEnd(22)} ${Math.min(have, need)}/${need}\n`;
        }
        out += '\n[Enter] upgrade   [E] close';
      } else {
        out += 'Fully upgraded.\n\n[E] close';
      }
      break;
    }
    case 'Paint': {
      const item = t.a;
      const list = build.paints_for(item);
      out += `PAINT   ${items.iname(item)}\n\n`;
      const from = Math.min(Math.max(0, sel - 6), Math.max(0, list.length - 13));
      for (let k = from; k < Math.min(list.length, from + 13); k++) {
        out += `${mark(k)} ${data.PAINTS[list[k]][0]}\n`;
      }
      out += '\nPaints the room you stand in (5 seconds, the bucket is not used up).\n[W / S] select   [Enter] paint   [E] close';
      break;
    }
    case 'Demolition': {
      const [cost, room] = crew_offer(g);
      out += 'DEMOLITION CREW\n\n';
      if (g.ev.crew_due !== null) {
        out += `A crew is booked for day ${g.ev.crew_due[0]}, 09:00.\n`;
      } else if (room === 0) {
        out += 'Both extra store floors are already open.\n';
      } else {
        out += `Knock down the wall to store floor ${room + 1}: ${cost} Batteries.\nFive labourers arrive tomorrow at 09:00 and need 75 hits.\n\n[Enter] book`;
      }
      out += '\n[E] close';
      break;
    }
    case 'None':
      break;
  }
  return out;
}

export function reroll_cost(g) {
  return trunc(rround(f32(250.0 * Math.pow(2, g.ev.rerolls))));
}
export function extend_cost(g) {
  return trunc(rround(f32(1000.0 * f32(Math.pow(2.5, g.ev.extends)))));
}
/// (giá, phòng sẽ mở: 1 hoặc 2; 0 = hết phòng).
export function crew_offer(g) {
  switch (g.bld.rooms) {
    case 0: return [1000, 1];
    case 1: return [5000, 2];
    default: return [0, 0];
  }
}

export function pay(g, cost) {
  if (g.batteries < cost) {
    g.play('deny', 0.5);
    g.say(`Not enough batteries: that costs ${cost}.`);
    return false;
  }
  g.batteries -= cost;
  g.stats.outgoings += cost;
  g.play('pay', 0.6);
  return true;
}

/// Phím trong bảng Trade. `keys` = ctx.keys (ButtonInput<KeyCode> facade).
export function keys(g, keys) {
  const n = rows(g);
  if (keys.just_pressed('KeyS') || keys.just_pressed('ArrowDown')) {
    g.ev.sel = Math.min(g.ev.sel + 1, sat1(n));
  }
  if (keys.just_pressed('KeyW') || keys.just_pressed('ArrowUp')) {
    g.ev.sel = sat1(g.ev.sel);
  }
  const sel = Math.min(g.ev.sel, sat1(n));
  const enter = keys.just_pressed('Enter');
  const shift = keys.pressed('ShiftLeft') || keys.pressed('ShiftRight');
  const t = g.ev.trade;
  switch (t.k) {
    case 'Merchant': {
      if (enter && n > 0) {
        const [it, price, stock] = g.ev.merchant_stock[sel];
        const qty = shift ? Math.min(10, stock) : 1;
        if (pay(g, price * qty)) {
          g.ev.merchant_stock[sel][2] -= qty;
          if (g.ev.merchant_stock[sel][2] <= 0) {
            g.ev.merchant_stock.splice(sel, 1);
          }
          // Gộp vào thùng hàng đang nằm cạnh xe nếu có.
          const spot = lay.MERCHANT_STAND.add(v3(1.6, 0.0, 0.2));
          const found = g.props.find((p) => !p.dead && p.kind.k === 'Crate' && p.pos.distance(spot) < 0.5);
          const crate_id = found !== undefined ? found.id : null;
          const p = crate_id !== null ? g.prop(crate_id) : null;
          if (p !== null && p !== undefined) {
            if (p.kind.k === 'Crate') {
              for (let q = 0; q < qty; q++) p.kind.a.push(it);
            }
          } else {
            g.add_prop({ k: 'Crate', a: new Array(Math.max(0, qty)).fill(it) }, spot, 0.2);
          }
          g.say(`Bought ${qty}x ${items.iname(it)}. The package is next to the truck.`);
        }
      }
      break;
    }
    case 'Shop': {
      const lm = t.a;
      const list = shop_rows(g, lm);
      if (enter && n > 0) {
        const [it, price, stock] = list[sel];
        const b0 = g.ev.basket.find((b) => b[0] === it);
        const inb = b0 !== undefined ? b0[1] : 0;
        const add = Math.min(shift ? 10 : 1, stock - inb);
        if (add > 0) {
          const b = g.ev.basket.find((b) => b[0] === it);
          if (b !== undefined) b[1] += add;
          else g.ev.basket.push([it, add, price]);
          g.play('click', 0.4);
        }
      }
      if (keys.just_pressed('KeyX')) {
        g.ev.basket.length = 0;
      }
      if (keys.just_pressed('KeyG') && g.ev.basket.length !== 0) {
        map.send_shopper(g, lm);
      }
      break;
    }
    case 'Docks': {
      if (g.ev.active !== null) {
        if (keys.just_pressed('KeyX') && pay(g, extend_cost(g))) {
          g.ev.extends += 1;
          const c = g.ev.active;
          if (c !== null) {
            c.expire += 1;
            c.window += 1;
          }
        }
      } else {
        if (enter && n > 0) {
          const c = g.ev.offers.splice(sel, 1)[0];
          c.expire = g.day + c.window;
          g.say(`Contract accepted: sell ${c.target}x ${items.iname(c.item)} by day ${c.expire}.`);
          g.ev.active = c;
          g.play('quest', 0.5);
        }
        if (keys.just_pressed('KeyR') && pay(g, reroll_cost(g))) {
          g.ev.rerolls += 1;
          g.ev.offers.length = 0;
          fill_offers(g);
        }
      }
      break;
    }
    case 'Wheel': {
      if (enter) {
        spin(g);
      }
      break;
    }
    case 'News': {
      if (keys.just_pressed('KeyD')) {
        g.ev.reach = Math.min(g.ev.reach + 1, 3);
      }
      if (keys.just_pressed('KeyA')) {
        g.ev.reach = Math.max(g.ev.reach - 1, 1);
      }
      if (keys.just_pressed('Equal')) {
        g.ev.days = Math.min(g.ev.days + 1, 7);
      }
      if (keys.just_pressed('Minus')) {
        g.ev.days = Math.max(g.ev.days - 1, 1);
      }
      const list = ad_items(g);
      if (enter && n > 0) {
        const need = [10.0, 50.0, 75.0][ri(g.ev.reach)];
        if (g.ev.ad !== null) {
          g.play('deny', 0.5);
          g.say('A campaign is already running.');
        } else if (g.rep < need) {
          g.play('deny', 0.5);
          g.say(`That reach needs reputation ${need.toFixed(0)}.`);
        } else if (pay(g, ad_cost(list[sel][0], g.ev.reach, g.ev.days))) {
          g.ev.ad = [list[sel][0], g.ev.reach, g.ev.days];
          g.ev.ad_since = 0.0;
          g.say(`The news crew will advertise ${items.iname(list[sel][0])} for ${g.ev.days} day(s).`);
        }
      }
      break;
    }
    case 'Upgrade': {
      if (enter && build.upgrade_pay(g, t.a)) {
        g.panel = { k: 'None' };
      }
      break;
    }
    case 'Paint': {
      if (enter && n > 0) {
        const p = build.paints_for(t.a)[sel];
        build.start_paint(g, p);
      }
      break;
    }
    case 'Demolition': {
      const [cost, room] = crew_offer(g);
      if (enter && room > 0 && g.ev.crew_due === null && g.bld.crew.length === 0 && pay(g, cost)) {
        g.ev.crew_due = [g.day + 1, room];
        g.say('Demolition crew booked. They arrive tomorrow at 09:00.');
      }
      break;
    }
    case 'None':
      break;
  }
  if (keys.just_pressed('KeyE') || keys.just_pressed('Escape')) {
    g.panel = { k: 'None' };
    g.ev.basket.length = 0;
  }
}

// ---------- nhịp sự kiện ----------

export function tick(g, dt) {
  if (g.ev.merchant_next === 0) {
    g.ev.merchant_next = 4;
  }
  // Vòng quay đang quay: hết 8 giây thì trao thưởng của ô dừng.
  if (g.ev.spin_t > 0.0) {
    const before = trunc(f32(f32(g.ev.spin_t * g.ev.spin_t) * 3.0));
    g.ev.spin_t = f32(g.ev.spin_t - dt);
    const s = Math.max(g.ev.spin_t, 0.0);
    if (trunc(f32(f32(s * s) * 3.0)) !== before) {
      g.play('wheel', 0.4);
    }
    if (g.ev.spin_t <= 0.0) {
      g.ev.spin_t = 0.0;
      const w = g.ev.spin_to < g.ev.wheel.length ? g.ev.wheel[g.ev.spin_to] : null;
      if (w !== null) {
        const [it, n] = w;
        items.give_n(g, it, n);
        g.play('win', 0.7);
        g.say(`The wheel stops on ${n}x ${items.iname(it)}!`);
      }
    }
  }
  // Sang ngày.
  if (g.ev.day !== g.day) {
    g.ev.day = g.day;
    g.ev.hour = -1;
    g.ev.gib_here = false;
    if (g.ev.merchant_here) {
      g.ev.merchant_here = false;
    }
    const c = g.ev.active;
    if (c !== null) {
      if (g.day >= c.expire) {
        g.say(`The Drop Dead Docks contract for ${items.iname(c.item)} has expired.`);
        g.ev.active = null;
        fill_offers(g);
      }
    }
    if (g.ev.ad !== null) {
      const [it, reach, days] = g.ev.ad;
      g.ev.ad = days > 1 ? [it, reach, days - 1] : null;
    }
  }
  if (g.ev.shop_day !== g.day) {
    restock(g);
  }
  const hr = trunc(g.hour());
  if (hr !== g.ev.hour) {
    g.ev.hour = hr;
    if (g.on(game.FF_EVENTS) && !g.ev.merchant_here && (g.day >= g.ev.merchant_next || g.ev.force_merchant) && hr >= 8 && hr < 19) {
      if (g.raid.next_day === g.day && !g.ev.force_merchant) {
        g.ev.merchant_next = g.day + 1;
      } else {
        g.ev.force_merchant = false;
        merchant_arrive(g);
      }
    }
    if (g.on(game.FF_EVENTS) && g.bld.gen_fixed && !g.ev.gib_here && hr >= 18) {
      gib_arrive(g);
    }
    if (g.ev.crew_due !== null) {
      const [d, room] = g.ev.crew_due;
      if (g.day > d || (g.day === d && hr >= 9)) {
        g.ev.crew_due = null;
        build.crew_arrive(g, room);
      }
    }
  }
  // Khách quảng cáo.
  if (g.ev.ad !== null && g.open) {
    const [item, reach] = g.ev.ad;
    g.ev.ad_since += dt * game.MIN_PER_SEC * g.speed;
    const mult = [0.5, 0.75, 1.0][ri(reach)];
    if (g.ev.ad_since >= g.spawn_interval / mult && g.customers.length < 12) {
      g.ev.ad_since = 0.0;
      actors.spawn_customer(g, item);
    }
  }
}

export function export_(g) {
  const e = g.ev;
  const list = (v) => v.map(([it, p, n]) => `["${items.iname(it)}",${p},${n}]`).join(',');
  const con = (c) => `["${items.iname(c.item)}",${c.target},${c.have},${c.expire},"${items.iname(c.reward)}"]`;
  return (
    `{"trade":"${trade_debug(e.trade)}","sel":${e.sel},"merchant":${e.merchant_here},"merchantNext":${e.merchant_next},"stock":[${list(e.merchant_stock)}],"gib":${e.gib_here},` +
    `"wheel":[${e.wheel.map(([it, n]) => `["${items.iname(it)}",${n}]`).join(',')}],"spin":${e.spin_t.toFixed(1)},"offers":[${e.offers.map(con).join(',')}],` +
    `"active":${e.active !== null ? con(e.active) : 'null'},"ad":${e.ad !== null ? `["${items.iname(e.ad[0])}",${e.ad[1]},${e.ad[2]}]` : 'null'},` +
    `"shopRows":[${e.trade.k === 'Shop' ? list(shop_rows(g, e.trade.a)) : ''}],"basket":${e.basket.reduce((s, b) => s + b[1], 0)},` +
    `"crewDue":${e.crew_due !== null ? e.crew_due[0] : -1},"reach":${e.reach},"days":${e.days}}`
  );
}
// `export` is a reserved word in JS: the Rust `events::export` is exported under its Rust name via an alias.
export { export_ as export };

export function save(g) {
  const e = g.ev;
  const con = (c) => `${c.item}.${c.target}.${c.have}.${c.window}.${c.expire}.${c.reward}`;
  return `${e.merchant_next},${e.rerolls},${e.extends},${e.crew_due !== null ? e.crew_due[0] : -1},${e.crew_due !== null ? e.crew_due[1] : 0},${e.ad !== null ? e.ad[0] * 100 + e.ad[1] * 10 + e.ad[2] : -1}|${e.offers.map(con).join(',')}|${e.active !== null ? con(e.active) : ''}|${0}`;
}

export function load(g, s) {
  const parts = s.split('|');
  const h = (parts.length > 0 ? parts[0] : '').split(',').map(parse_i32).filter((v) => v !== null);
  if (h.length >= 6) {
    g.ev.merchant_next = h[0];
    g.ev.rerolls = h[1];
    g.ev.extends = h[2];
    g.ev.crew_due = h[3] >= 0 ? [h[3], h[4] & 255] : null;
    g.ev.ad = h[5] >= 0 ? [trunc(h[5] / 100), trunc(h[5] / 10) % 10, h[5] % 10] : null;
  }
  const N = catalog.N_CAT;
  const con = (r) => {
    const t = r.split('.').map(parse_i32).filter((v) => v !== null);
    if (t.length === 6 && t[0] >= 0 && t[0] < N && t[5] >= 0 && t[5] < N) return new Contract(t[0], t[1], t[2], t[3], t[4], t[5]);
    return null;
  };
  g.ev.offers = (parts.length > 1 ? parts[1] : '').split(',').map(con).filter((c) => c !== null);
  g.ev.active = parts.length > 2 ? con(parts[2]) : null;
  g.ev.day = g.day;
}

/* VIEW NOTES (events.js)
 * This module draws nothing in 3D itself. What reads its state:
 * - Trade panel (hud.rs): Panel {k:'Trade'} shows either `cards(g)` (Merchant / Shop: a card grid) or, when cards()
 *   returns null, the monospace text `panel_text(g)`. Cards object (icons.rs is not ported, plain object):
 *   { head: string, tabs: [[G glyph string, name, selected]], cards: [{icon:{k:'Item',a:item}, name, sub, state}],
 *   sel, det_icon: Icon|null, det_title, det, foot }. Card state: 0 normal, 1 dim (locked), 2 good (in basket), 3 warning
 *   (price above batteries). The detail pane on the right shows det_icon (item icon), det_title and det lines.
 * - world.rs: the merchant truck (by the street, at lay::MERCHANT_STAND) is visible while `g.ev.merchant_here`; Dr. Gib's
 *   wheel truck (behind the store) while `g.ev.gib_here`. While `g.ev.spin_t > 0` the wheel disc rotates to angle
 *   `(spin_to + spin_t^2 * 3) / 16 * TAU` (16 sectors, slows to a stop at sector spin_to after 8 s).
 * - Purchases appear as a Crate prop next to the truck (lay::MERCHANT_STAND + (1.6, 0, 0.2), yaw 0.2); a finished Docks
 *   contract drops a Crate at lay::DELIVERY + (-1.4, 0, 0.5), yaw 0.6 (props are drawn by the props sync).
 * - Sounds pushed to g.sfx: deny, click, radio, pay, wheel (each sector tick while spinning), win, quest.
 * - The TV in the store only turns on / off (player.js, original TelevisionObject).
 * PORT GAPS: icons.rs (Cards/Card/Icon/G) has no JS port; represented as the plain objects described above (Icon is
 *   {k:'Item',a}, G is a string). `export` is a JS reserved word: exported as `export` via alias (call `events.export(g)`),
 *   implemented as `export_`. Prices/scores use Math.fround to keep the Rust f32 rounding.
 */
