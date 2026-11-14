//! Món hàng: mọi món là một chỉ số trong danh mục 229 món của bản gốc (`catalog.rs`), số liệu dùng ở `data.rs`.
//! File này gom tên, giá trị, nhóm thèm của khách, hình dáng thủ tục, việc nhận món, và vũ khí đang trang bị (độ bền, băng đạn).
//! `[ĐỀ XUẤT]`: khách chỉ có 4 nhóm thèm (đồ ăn, vật liệu, thuốc, vũ khí) nên 14 loại món của bản gốc được gộp về 4 nhóm đó;
//! hình dáng món sinh theo loại + băm tên vì repo không có model.
// Port of src/items.rs (see three/PORT-CONTRACT.md).

import { trunc } from './vec.js';
import { CAT, N_CAT } from './catalog.js';
import { INFO } from './data.js';
import * as game from './game.js';
import * as skills from './skills.js';
import * as events from './events.js';
import * as combat from './combat.js';
import * as craft from './craft.js';

/** Rust `format!("{:.N}", v)`: exact decimal value, ties to even, "-" kept on negative zero, inf/NaN spelled as Rust. */
export function rfix(v, n) {
  if (Number.isNaN(v)) return 'NaN';
  const neg = v < 0 || Object.is(v, -0);
  const a = Math.abs(v);
  if (a === Infinity) return neg ? '-inf' : 'inf';
  let s = a.toFixed(n);
  if (a < 1e21 && n <= 60) {
    const full = a.toFixed(n + 40);
    const tail = full.slice(full.length - 40);
    if (tail === '5' + '0'.repeat(39)) {
      let kept = full.slice(0, full.length - 40);
      if (kept.endsWith('.')) kept = kept.slice(0, -1);
      const last = kept.charCodeAt(kept.length - 1) - 48;
      if (last % 2 === 0) s = kept; // tie: keep the even digit (toFixed rounded it up)
    }
  }
  return (neg ? '-' : '') + s;
}
/** Rust f32::round (half away from zero). */
const rround = (v) => Math.sign(v) * Math.round(Math.abs(v));
const pad_l = (s, w) => String(s).padStart(w, ' ');
const pad_r = (s, w) => String(s).padEnd(w, ' ');
/** Rust float `as usize` (saturating: negatives and NaN become 0). */
const f2us = (v) => Math.max(0, trunc(v));

export function iname(i) {
  const n = CAT[i].name;
  // Danh mục gốc có hai món cùng tên "Minigun": khẩu cầm tay và khẩu tháo từ tháp Auto Minigun. Đặt tên riêng cho khẩu sau.
  if (CAT[i].key === 'AutoMinigunWeaponData') {
    return 'Turret Minigun';
  }
  const first = Array.from(n)[0];
  if (!n.includes('_') && first !== undefined && /\p{Uppercase}/u.test(first)) {
    return n;
  }
  return n.split('_').join(' ').split(' ').filter((w) => w.length > 0).map((w) => {
    const cs = Array.from(w);
    return cs[0].toUpperCase() + cs.slice(1).join('');
  }).join(' ');
}

export function ival(i) {
  return CAT[i].value;
}

export function kind_of(i) {
  switch (CAT[i].ty) {
    case 5: case 9: return 'Food';
    case 7: return 'Medical';
    case 0: case 4: case 6: case 8: case 12: return 'Weapon';
    default: return 'Crafting';
  }
}

export function heal_of(i) {
  const u = INFO[i].usage;
  return u.k === 'Heal' ? u.a : 0.0;
}

/** Món bày lên kệ bán được cho khách. */
export function sellable(i) {
  return INFO[i].sell && CAT[i].value > 0;
}

/** Món dựng được trong chế độ xây (trang trí, phòng thủ, kệ và thùng chứa, thiết bị). */
export function buildable(i) {
  switch (CAT[i].ty) {
    case 3: case 4: case 1: return true;
    case 10: return ![game.CARDBOARD_BOX, game.LOW_PAINT, game.MID_PAINT, game.HIGH_PAINT, game.LOW_FLOOR, game.MID_FLOOR, game.HIGH_FLOOR].includes(i);
    case 11: return i === game.SLEEPING_BAG;
    default: return false;
  }
}

/** -> W object or null */
export function melee(i) {
  const u = INFO[i].usage;
  return u.k === 'Melee' ? u.a : null;
}

/** -> [W, G] or null */
export function gun(i) {
  const u = INFO[i].usage;
  return u.k === 'Gun' ? [u.a, u.b] : null;
}

/** -> range multiplier or null */
export function throwable(i) {
  const u = INFO[i].usage;
  return u.k === 'Throw' ? u.a : null;
}

/** 1 cận chiến, 2 súng, 0 không phải vũ khí cầm tay. */
export function wclass(i) {
  const u = INFO[i].usage;
  if (u.k === 'Melee' && ![108, 109, 228].includes(i)) return 1;
  if (u.k === 'Gun' && ![10, 131].includes(i)) return 2;
  return 0;
}

const UTF8 = new TextEncoder();
export function hash(s) {
  let h = 2166136261;
  for (const b of UTF8.encode(s)) {
    h = Math.imul((h ^ b) >>> 0, 16777619) >>> 0;
  }
  return h;
}

/** Hình dáng thủ tục của món: (kiểu, màu chính, màu phụ). Kiểu 0 hộp thiếc, 1 chai, 2 cuộn, 3 gậy, 4 vải gấp, 5 hộp có sọc,
 *  6 súng, 7 đồ trang trí (khối có đế), 8 thùng, 9 đạn. -> [shape, c, c2] */
export function look(i) {
  const OLD = [
    [game.TIN, 0, 0xb8322a, 0xd9a441],
    [game.BEANS, 0, 0x2f7d74, 0xe8dcc0],
    [game.FRUIT, 0, 0xe0862a, 0xf2e2a0],
    [game.BEER, 1, 0x5a3414, 0xd8c27a],
    [game.TUNA, 2, 0x2c5fa8, 0xdfe6ee],
    [game.TAPE, 2, 0x9a9a92, 0x55554f],
    [game.PIPE, 3, 0xb86a32, 0x7a4420],
    [game.CLOTH, 4, 0xa89a7c, 0x7d7058],
    [game.NAILS, 5, 0x6f747a, 0x3c4046],
    [game.WIRING, 2, 0xc2452d, 0x2b2b2b],
    [game.BANDAGE, 5, 0xe6e2d6, 0xc23a30],
    [game.PILLS, 1, 0xe8e8e8, 0x3a78c2],
    [game.FIRSTAID, 5, 0xc0392b, 0xf0f0f0],
    [game.BAT, 3, 0xa9804a, 0x6d4e2a],
  ];
  const o = OLD.find((o) => o[0] === i);
  if (o !== undefined) {
    return [o[1], o[2], o[3]];
  }
  const h = hash(CAT[i].key);
  const PAL = [0x8a5a3c, 0x4f6f7a, 0x6b7a4a, 0x9a4034, 0xb9a36a, 0x5a5f66, 0x3d5a78, 0x7a4a6a, 0xc8c2ae, 0x2f7d74, 0xa86a2a, 0x54606a];
  let c = PAL[h % 12];
  let c2 = PAL[(h >>> 8) % 12];
  const recipe = INFO[i].usage.k === 'Recipe';
  let shape;
  switch (CAT[i].ty) {
    case 5: shape = [game.WHISKY, game.WINE].includes(i) ? 1 : [game.MEAT, game.POTATO, game.BREAD].includes(i) ? 4 : 0; break;
    case 7: shape = i === game.ANTIBIOTICS ? 1 : 5; break;
    case 6: shape = 6; break;
    case 8: case 13: shape = 3; break;
    case 0: shape = 9; break;
    case 12: shape = 1; break;
    case 3: case 1: shape = 7; break;
    case 4: case 10: case 11: shape = 8; break;
    case 2: shape = recipe ? 4 : [5, 2, 3, 5][h % 4]; break;
    default: shape = 5;
  }
  switch (CAT[i].ty) {
    case 7: [c, c2] = [0xe6e2d6, 0xc23a30]; break;
    case 6: [c, c2] = [0x33383d, 0x6d4e2a]; break;
    case 0: [c, c2] = [0xb9a44a, 0x70757a]; break;
    default: if (recipe) [c, c2] = [0xe8dcc0, 0x3a78c2];
  }
  return [shape, c, c2];
}

/** Một vũ khí đang trang bị: độ bền còn lại và số đạn trong băng. */
export class Wpn {
  constructor(item = 0, dur = 0, clip = 0) { this.item = item; this.dur = dur; this.clip = clip; }
  clone() { return new Wpn(this.item, this.dur, this.clip); }
}

/** Số ô vũ khí theo loại: cận chiến 2, súng 1 (luật gốc), cộng nút kỹ năng. */
export function slots(g, cls) {
  if (cls === 1) return 2 + f2us(skills.sum(g, 'MeleeWeaponMaxSlots'));
  return 1 + f2us(skills.sum(g, 'ProjectileWeaponMaxSlots'));
}

/** Trang bị một món vũ khí lấy từ ba lô (hoặc món vừa nhận) nếu còn ô trống. Trả về true nếu đã trang bị. */
export function equip(g, item) {
  const cls = wclass(item);
  if (cls === 0) {
    return false;
  }
  const used = g.weapons.filter((w) => wclass(w.item) === cls).length;
  if (used >= slots(g, cls)) {
    return false;
  }
  const m = melee(item), gn = gun(item);
  const dur = m !== null ? m.dur : gn !== null ? gn[0].dur : 100.0;
  g.weapons.push(new Wpn(item, dur, 0));
  if (g.weapons.length === 1) {
    g.wsel = 0;
    g.armed = g.held === null;
  }
  return true;
}

/** Nhận `n` món: vũ khí tự vào ô trống, còn lại vào ba lô. */
export function give_n(g, item, n) {
  while (n > 0 && wclass(item) !== 0 && equip(g, item)) {
    n -= 1;
  }
  g.inv[item] += n;
  if (g.inv[g.stock_sel] === 0 || !sellable(g.stock_sel)) {
    const s = g.sellable_in_inv();
    if (s.length > 0) {
      g.stock_sel = s[0];
    }
  }
}

/** Nhận một danh sách món; trả về chuỗi tả "2x Nails, 1x Tape". */
export function give(g, items) {
  const cnt = [];
  for (const it of items) {
    const c = cnt.find((c) => c[0] === it);
    if (c !== undefined) c[1] += 1;
    else cnt.push([it, 1]);
  }
  for (const [it, n] of cnt) {
    give_n(g, it, n);
  }
  return cnt.map(([it, n]) => `${n}x ${iname(it)}`).join(', ');
}

/** Bớt `n` món khỏi ba lô nếu đủ. */
export function take(g, item, n) {
  if (g.inv[item] < n) {
    return false;
  }
  g.inv[item] -= n;
  return true;
}

/** Các món đang có trong ba lô (chỉ số danh mục), theo thứ tự danh mục. */
export function owned(g) {
  const out = [];
  for (let i = 0; i < N_CAT; i++) if (g.inv[i] > 0) out.push(i);
  return out;
}

// ---------- ba lô ----------

/** Một dòng của bảng ba lô: vũ khí đang trang bị (chỉ số trong `g.weapons`) hoặc món trong ba lô.
 *  Row::Equipped(w) -> {k:'Equipped', a:w}; Row::Item(i) -> {k:'Item', a:i} */
export function bag_rows(g) {
  const out = [];
  for (let w = 0; w < g.weapons.length; w++) out.push({ k: 'Equipped', a: w });
  for (const i of owned(g)) out.push({ k: 'Item', a: i });
  return out;
}

const PAINT_ITEMS = () => [game.LOW_PAINT, game.MID_PAINT, game.HIGH_PAINT, game.LOW_FLOOR, game.MID_FLOOR, game.HIGH_FLOOR];

/** Việc Enter sẽ làm với một món trong ba lô. */
export function verb(g, i) {
  if (wclass(i) !== 0) {
    return 'equip';
  } else if (INFO[i].usage.k === 'Recipe') {
    return 'learn (5 s)';
  } else if (INFO[i].usage.k === 'Heal') {
    return 'use';
  } else if (PAINT_ITEMS().includes(i)) {
    return 'paint';
  } else if (i === game.BALLOON) {
    return 'release';
  } else if (buildable(i)) {
    return 'build';
  } else if (throwable(i) !== null) {
    return 'ready to throw';
  } else if (sellable(i)) {
    return g.stock_sel === i ? 'selected for shelves' : 'select for shelves';
  } else {
    return '';
  }
}

export function bag_text(g) {
  const rows = bag_rows(g);
  const sel = Math.min(g.bag_sel, Math.max(0, rows.length - 1));
  let out = `BACKPACK        batteries: ${g.batteries}     melee slots ${g.weapons.filter((w) => wclass(w.item) === 1).length}/${slots(g, 1)}   gun slots ${g.weapons.filter((w) => wclass(w.item) === 2).length}/${slots(g, 2)}\n\n`;
  if (rows.length === 0) {
    out += '(empty)\n';
  }
  const from = Math.min(Math.max(0, sel - 7), Math.max(0, rows.length - 15));
  for (let k = from; k < Math.min(rows.length, from + 15); k++) {
    const r = rows[k];
    const mark = k === sel ? '>' : ' ';
    switch (r.k) {
      case 'Equipped': {
        const w = r.a;
        const wp = g.weapons[w];
        const gn = gun(wp.item);
        const ammo = gn !== null && gn[1].clip > 0 ? `  clip ${wp.clip}/${gn[1].clip}` : '';
        out += `${mark} [EQUIPPED] ${pad_r(iname(wp.item), 20)} durability ${pad_l(rfix(wp.dur, 0), 3)}%${ammo}${g.armed && g.wsel === w ? '  (in hand)' : ''}\n`;
        break;
      }
      case 'Item': {
        const i = r.a;
        out += `${mark} ${pad_l(g.inv[i], 4)}x ${pad_r(iname(i), 26)} ${pad_l(ival(i), 5)} Batteries   ${verb(g, i)}\n`;
        break;
      }
    }
  }
  out += '\n[W / S] select   [Enter] use / equip / build   [X] drop one   [L] controls   [Tab] close';
  if (g.forgiven_due || g.med_gifts.length > 0) {
    out += '\n\nOWED TO YOU (arrives tomorrow morning)';
    if (g.forgiven_due) {
      out += '\n- Forgiven customer: 5-25 Batteries';
    }
    for (const it of g.med_gifts) {
      out += `\n- Treated survivor (${iname(it)}): a thank-you package`;
    }
  }
  return out;
}

/** Ba lô dạng lưới thẻ: mỗi món một thẻ có hình của chính nó.
 *  Returns an icons::Cards object: { head, tabs, cards: [{icon, name, sub, state}], sel, det_icon, det_title, det, foot };
 *  Icon::Item(i) -> {k:'Item', a:i}. */
export function bag_cards(g) {
  const rows = bag_rows(g);
  const sel = Math.min(g.bag_sel, Math.max(0, rows.length - 1));
  const cards = rows.map((r) => {
    switch (r.k) {
      case 'Equipped': {
        const wp = g.weapons[r.a];
        return { icon: { k: 'Item', a: wp.item }, name: iname(wp.item), sub: `EQUIPPED  ${rfix(wp.dur, 0)}%`, state: 2 };
      }
      case 'Item': {
        const i = r.a;
        return { icon: { k: 'Item', a: i }, name: iname(i), sub: `x${g.inv[i]}`, state: g.stock_sel === i && sellable(i) ? 2 : 0 };
      }
    }
    return null;
  });
  const c = { head: '', tabs: [], cards, sel, det_icon: null, det_title: '', det: '', foot: '' };
  c.head = `BACKPACK      Batteries ${g.batteries}      melee slots ${g.weapons.filter((w) => wclass(w.item) === 1).length}/${slots(g, 1)}    gun slots ${g.weapons.filter((w) => wclass(w.item) === 2).length}/${slots(g, 2)}`;
  let act = 'use / equip / build';
  const row = sel < rows.length ? rows[sel] : null;
  if (row !== null && row.k === 'Equipped') {
    const w = row.a;
    const wp = g.weapons[w];
    c.det_icon = { k: 'Item', a: wp.item };
    c.det_title = iname(wp.item);
    const gn = gun(wp.item);
    const ammo = gn !== null && gn[1].clip > 0 ? `\nClip ${wp.clip}/${gn[1].clip}` : '';
    c.det = `EQUIPPED${g.armed && g.wsel === w ? ' (in hand)' : ''}\nDurability ${rfix(wp.dur, 0)}%${ammo}\nEst. value ${ival(wp.item)} Batteries`;
    act = 'unequip';
  } else if (row !== null && row.k === 'Item') {
    const i = row.a;
    c.det_icon = { k: 'Item', a: i };
    c.det_title = iname(i);
    const v = verb(g, i);
    c.det = `Carried: ${g.inv[i]}\nEst. value ${ival(i)} Batteries${v.length === 0 ? '' : `\n\n[Enter] ${v}`}`;
    if (v.length > 0) {
      act = v;
    }
  } else {
    c.det_title = '(empty)';
  }
  c.foot = `[W / S] previous / next    [Enter] ${act}    [X] drop one    [L] controls    [Tab] close`;
  if (g.forgiven_due || g.med_gifts.length > 0) {
    c.foot += '\nOWED TO YOU (arrives tomorrow morning):';
    if (g.forgiven_due) {
      c.foot += '  forgiven customer 5-25 Batteries;';
    }
    for (const it of g.med_gifts) {
      c.foot += `  treated survivor (${iname(it)}): thank-you package;`;
    }
  }
  return c;
}

/** Enter trên dòng đang chọn của ba lô. */
export function bag_act(g) {
  const rows = bag_rows(g);
  const idx = Math.min(g.bag_sel, Math.max(0, rows.length - 1));
  if (idx >= rows.length) return;
  const row = rows[idx];
  switch (row.k) {
    case 'Equipped': {
      // Tháo vũ khí về ba lô; đạn trong băng trả về kho.
      const wp = g.weapons.splice(row.a, 1)[0];
      const gn = gun(wp.item);
      if (gn !== null) {
        const gd = gn[1];
        if (gd.ammo < N_CAT) {
          g.inv[gd.ammo] += wp.clip;
        }
      }
      // Vũ khí đã mòn tháo ra vẫn là một món nguyên (bản này không lưu độ bền của món trong ba lô) [ĐỀ XUẤT].
      g.inv[wp.item] += 1;
      g.wsel = 0;
      g.armed = false;
      g.play('pick', 0.5);
      break;
    }
    case 'Item': {
      const i = row.a;
      const locked = (g) => {
        g.play('deny', 0.5);
        g.say('Not available yet.');
      };
      const paint = PAINT_ITEMS().includes(i);
      const defence = [game.SPIKE_WALL, game.BEAR_TRAP, game.TURRET, game.AUTO_MINIGUN, game.EXPLOSIVE_BARREL, game.REMOTE_BOMB, game.REMOTE_INC, game.BALLOON].includes(i);
      if ((wclass(i) !== 0 || throwable(i) !== null) && !g.on(game.FF_WEAPONS) && !(i === game.HAMMER || i === game.BAT)) {
        locked(g);
      } else if (defence && !g.on(game.FF_DEFENCE)) {
        locked(g);
      } else if (!defence && i !== game.BARBED && (buildable(i) || paint) && !g.on(game.FF_BUILD)) {
        locked(g);
      } else if (wclass(i) !== 0) {
        if (equip(g, i)) {
          g.inv[i] -= 1;
          g.wsel = g.weapons.length - 1;
          g.armed = g.held === null;
          g.cb.throw_item = null;
          g.play('pick', 0.6);
          g.say(`${iname(i)} equipped.`);
        } else {
          g.play('deny', 0.5);
          g.say('No free weapon slot. Unequip a weapon first (Enter on an EQUIPPED row).');
        }
      } else if (INFO[i].usage.k === 'Recipe') {
        g.learn_job = [i, 0.0];
        g.panel = { k: 'None' };
      } else if (INFO[i].usage.k === 'Heal') {
        use_heal(g, i);
        g.panel = { k: 'None' };
      } else if (paint) {
        events.open(g, { k: 'Paint', a: i });
      } else if (i === game.BALLOON) {
        if (combat.balloon(g)) {
          g.inv[i] -= 1;
        }
        g.panel = { k: 'None' };
      } else if (buildable(i)) {
        if (g.held !== null) {
          g.say('Your hands are full. [X] to drop.');
          return;
        }
        g.inv[i] -= 1;
        g.bld.ghost = [i, rround(g.yaw / (Math.PI / 4)) * (Math.PI / 4)];
        g.bld.secure_t = 0.0;
        g.panel = { k: 'None' };
        g.play('click', 0.5);
      } else if (throwable(i) !== null) {
        g.cb.throw_item = i;
        g.armed = false;
        g.panel = { k: 'None' };
      } else if (sellable(i)) {
        g.stock_sel = i;
        g.play('click', 0.4);
      }
      break;
    }
  }
}

/** Bắt đầu dùng một món thuốc (luật gốc: 1,5 giây, First Aid Kit 1 giây; chỉ khi chưa đầy máu). */
export function use_heal(g, item) {
  g.fx2.heal = 0.7;
  if (g.hp >= g.hp_max) {
    g.say('You are not hurt.');
  } else if (g.inv[item] < 1) {
    g.say('No healing items.');
  } else if (g.heal_job === null) {
    g.heal_job = [item, 0.0];
  }
}

/** Tiến độ dùng thuốc và học công thức (giây thật). */
export function tick_jobs(g, dt) {
  if (g.heal_job !== null) {
    const [item, t0] = g.heal_job;
    const u = INFO[item].usage;
    if (u.k !== 'Heal') {
      g.heal_job = null;
      return;
    }
    const amount = u.a, secs = u.b;
    const t = t0 + dt;
    if (t >= secs) {
      g.heal_job = null;
      if (g.inv[item] > 0) {
        g.inv[item] -= 1;
        const m = skills.mul(g, 'HealingConsumableMultiplier');
        g.hp = Math.min(g.hp + amount * (m > 0.0 ? m : 1.0), g.hp_max);
        g.play('heal', 0.6);
        g.say(`Used ${iname(item)}.`);
      }
    } else {
      g.heal_job = [item, t];
      g.prompt = `Using ${iname(item)}... ${rfix(t / secs * 100.0, 0)}%`;
    }
  }
  if (g.learn_job !== null) {
    const [item, t0] = g.learn_job;
    const t = t0 + dt;
    if (t >= 5.0) {
      g.learn_job = null;
      if (g.inv[item] > 0 && craft.learn(g, item)) {
        g.inv[item] -= 1;
      }
    } else {
      g.learn_job = [item, t];
      g.prompt = `Studying ${iname(item)}... ${rfix(t / 5.0 * 100.0, 0)}%`;
    }
  }
}

/* VIEW NOTES
   items.rs draws nothing itself. `look(i)` -> [shape, colour, colour2] is the recipe the item-model / icon code uses:
   shape 0 tin can, 1 bottle, 2 roll, 3 stick/bat, 4 folded cloth (also recipe sheets), 5 striped box, 6 gun,
   7 decoration block on a base, 8 crate, 9 ammo; colours are 0xRRGGBB ints. `bag_cards(g)` returns the icons::Cards
   object the HUD grid shows (Icon::Item(i) = {k:'Item', a:i}; card.state 0 normal, 2 good/selected).
   `bag_text(g)` is the plain-text backpack panel. Weapons in hand are `g.weapons[g.wsel]` (Wpn {item, dur, clip}).
   PORT GAPS: none (icons.rs is not ported by anyone, so Cards / Card / Icon are built as plain objects with the Rust
   field names, Default = '' / [] / 0 / null).
*/
