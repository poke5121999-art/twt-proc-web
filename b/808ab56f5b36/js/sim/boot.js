// Port of src/main.rs (everything before `App::new()`, plus clock_system and the system order).
//! The Walking Trade - bản thủ tục (Bevy): mọi hình và tiếng đều sinh bằng code, không có file asset.

import * as game_m from './game.js';
import * as web from './web.js';
import * as audio from './audio.js';
import * as skills from './skills.js';
import * as items from './items.js';
import { CAT } from './catalog.js';
import * as map from './map.js';
import * as quests from './quests.js';
import { clamp } from './vec.js';

export function clock_system(g, dt) {
  dt = Math.min(dt, 0.1);
  g.notice_t -= dt;
  g.hurt_flash = Math.max(g.hurt_flash - dt * 2.5, 0.0);
  g.toast_t -= dt;
  if (g.chk_t > 0.0) g.chk_t -= dt;
  g.fade = Math.max(g.fade - dt * 0.9, 0.0);
  if (g.mode !== 'Play' || g.cine !== null) {
    return;
  }
  // Ngày 1: đồng hồ đứng ở 14:00 cho tới khi mở quán lần đầu (gốc TimeManager.Update: day 1, chưa mở quán, hour > 13). Hết ngày:
  // đứng ở 23:59 tới khi ngủ.
  // [FTUE A6] gốc ShouldFreezeForRaid: raid hôm nay chưa xong thì đồng hồ đứng ở 19:00
  const hold = (g.day === 1 && !g.ever_opened && g.minutes >= 14.0 * 60.0) || (g.raid.active && g.minutes >= 19.0 * 60.0);
  if (!hold) {
    g.minutes += dt * game_m.MIN_PER_SEC * g.speed;
  }
  if (g.minutes >= 1439.0) {
    g.minutes = 1439.0;
  }
  g.since_hit += dt;
  quests.tick(g); // [FTUE A2] sóng việc, việc hiện theo sự kiện, việc xong theo trạng thái
  // Hồi máu theo thời gian chỉ có khi đã mở nút kỹ năng PlayerHealOverTime (máu / giây), sau 5 giây không bị đánh.
  const regen = skills.sum(g, 'PlayerHealOverTime');
  if (regen > 0.0 && g.since_hit > 5.0 && g.hp < g.hp_max) {
    g.hp = Math.min(g.hp + regen * dt, g.hp_max);
  }
}

// Rust `str::parse` is strict (no surrounding spaces, no trailing junk); these return null where Rust returns Err.
export function parse_f32(s) {
  if (s === null) return null;
  if (!/^[+-]?(inf|infinity|nan|\d+\.?\d*(e[+-]?\d+)?|\.\d+(e[+-]?\d+)?)$/i.test(s)) return null;
  const t = s.replace(/^\+/, '').toLowerCase();
  const neg = t.startsWith('-');
  const u = neg ? t.slice(1) : t;
  if (u === 'inf' || u === 'infinity') return neg ? -Infinity : Infinity;
  if (u === 'nan') return NaN;
  return Math.fround(parseFloat(t));
}
export function parse_i32(s) {
  if (s === null || !/^[+-]?\d+$/.test(s)) return null;
  const v = Number(s);
  return v >= -2147483648 && v <= 2147483647 ? v : null;
}
export function parse_usize(s) {
  if (s === null || !/^\+?\d+$/.test(s)) return null;
  const v = Number(s.replace(/^\+/, ''));
  return v <= 18446744073709551615 ? v : null;
}
export function parse_u8(s) {
  if (s === null || !/^\+?\d+$/.test(s)) return null;
  const v = Number(s.replace(/^\+/, ''));
  return v <= 255 ? v : null;
}

/** `?give=` / `?docks=` key -> item index: số, hoặc tên món bỏ dấu cách, chữ thường. */
function item_key(key) {
  const n = parse_usize(key);
  if (n !== null) return n;
  for (let i = 0; i < game_m.N_ITEMS; i++) {
    if (items.iname(i).replace(/ /g, '').toLowerCase() === key) return i;
  }
  // tên cũ trước khi đổi theo loc gốc (vd. StunStick -> "Taser Stick"): khớp đầu khoá danh mục
  const ki = CAT.findIndex((c) => c.key.toLowerCase().startsWith(key));
  if (ki >= 0) return ki;
  return null;
}

/** main() up to `App::new()`: the Game with every URL hook applied. Returns { game, feel_nolock }. */
export function make_game() {
  const game = new game_m.Game(web.seed());
  const ff = web.query('ff');
  if (ff !== null) {
    for (const name of ff.split(',')) {
      for (const [n, bit] of game_m.FF_NAMES) {
        if (name === n || name === 'all') {
          game.ff = (game.ff | bit) >>> 0;
        }
      }
      if (name === 'none') {
        game.ff = 0;
      }
    }
  }
  {
    const v = parse_f32(web.query('speed'));
    if (v !== null) game.speed = clamp(v, 0.1, 60.0);
  }
  {
    const v = parse_f32(web.query('raid'));
    if (v !== null) game.raid_scale = clamp(v, 0.05, 3.0);
  }
  if (web.query('noaudio') !== null) {
    audio.disable();
  }
  {
    const a = web.query('autostart');
    if (a === 'skip') {
      game.mode = 'Play';
      game.skip_intro();
    } else if (a !== null) {
      game.mode = 'Play';
    }
  }
  {
    const s = web.settings();
    if (s !== null) {
      const [, sens, volume, invert] = s;
      game.sens = sens;
      game.volume = volume;
      game.invert = invert;
      audio.set_volume(volume);
    }
  }
  // ?raidtest=1: vào thẳng sáng ngày 3 trước giờ raid (búa, vật liệu 2 cuộn thép gai, 2 băng gạc) để thử raid nhanh.
  if (web.query('raidtest') !== null) {
    game.mode = 'Play';
    game.skip_intro();
    game.day = 3;
    game.minutes = 9.0 * 60.0 + 24.0;
    game.raid.next_day = 3;
    game.ever_opened = true;
    game.inv[game_m.WIRING] += 4;
    game.inv[game_m.NAILS] += 4;
    game.inv[game_m.BANDAGE] += 2;
  }
  game.zoo = web.query('zoo') !== null;
  { const z = web.query('zoo'); game.zoo_kind = z === null ? '' : z; }
  // people::SIL (bóng đen) -> g.sil
  game.sil = web.query('sil') !== null;
  game.nocine = web.query('nocine') !== null;
  game.force_fake = web.query('fake') !== null;
  if (web.query('craftdbg') !== null) {
    // Bot thử chế tạo: xà beng mở kho + đủ nguyên liệu cho Bandage (Beer 1, Worn Cloth 2) và Taped Pipes (Copper Pipe 2, Tape 1).
    game.inv[game_m.CROWBAR] += 1;
    game.inv[game_m.BEER] += 1;
    game.inv[game_m.CLOTH] += 2;
    game.inv[game_m.PIPE] += 2;
    game.inv[game_m.TAPE] += 1;
  }
  if (web.query('mapdbg') !== null) {
    game.batteries += 400;
  }
  {
    const v = web.query('staffer');
    if (v !== null) {
      game.force_staffer = true;
      game.batteries += 100;
      const d = [];
      const bytes = new TextEncoder().encode(v);
      for (const b of bytes) {
        if (b >= 48 && b <= 57) d.push(clamp(b - 48, 1, 5));
      }
      if (d.length === 4) {
        game.force_levels = [d[0], d[1], d[2], d[3]];
      }
    }
  }
  // ?lmopen=5,9: coi các landmark này là đã mở / đã hạ (để bot thử rào tài nguyên, dịch vụ, raid của bầy).
  {
    const list = web.query('lmopen');
    if (list !== null) {
      for (const s of list.split(',')) {
        const i = parse_usize(s);
        if (i === null || !(i < map.N_LM)) continue;
        game.lm[i] = 1;
        game.lm_hp[i] = 0.0;
        map.unlock(game, i);
      }
      game.notice_t = 0.0;
    }
  }
  // ?give=<món>:<số>,...  ?bat=<pin>  ?sp=<điểm kỹ năng>  ?day=<ngày>: móc kiểm thử cho bot (không lưu vào ván thường).
  {
    const list = web.query('give');
    if (list !== null) {
      for (const part of list.split(',')) {
        const it = part.split(':');
        const key = (it[0] === undefined ? '' : it[0]).replace(/[_ ]/g, '').toLowerCase();
        const idx = item_key(key);
        const nv = it.length > 1 ? parse_i32(it[1]) : null;
        const n = nv === null ? 1 : nv;
        if (idx !== null) {
          if (idx < game_m.N_ITEMS) {
            items.give_n(game, idx, n);
          }
        }
      }
    }
  }
  {
    const v = parse_i32(web.query('bat'));
    if (v !== null) game.batteries += v;
  }
  {
    const v = parse_i32(web.query('sp'));
    if (v !== null) {
      for (let k = 0; k < 4; k++) {
        game.sk.points[k] += v;
      }
    }
  }
  {
    const v = parse_i32(web.query('day'));
    if (v !== null) {
      game.day = Math.max(v, 1);
      game.ever_opened = true;
    }
  }
  if (web.query('merchant') !== null) {
    game.ev.force_merchant = true;
  }
  {
    const v = parse_f32(web.query('rep'));
    if (v !== null) game.rep = clamp(v, -100.0, 100.0);
  }
  // ?docks=<món>: hợp đồng Drop Dead Docks đầu tiên trong danh sách là bán 3 món này (để bot bán cho xong được).
  {
    const v = web.query('docks');
    if (v !== null) {
      const key = v.replace(/[_ ]/g, '').toLowerCase();
      game.ev.force_offer = item_key(key);
    }
  }
  // ?raiddef=<0..5>: vào thẳng 09:24 của ngày raid với raid soạn sẵn thứ n (0 Birther, 1 Brute, 2 Initial, 3 Sweaty Rotter,
  // 4 Twins, 5 Hellraid sau khi đã thắng cả năm).
  {
    const d = parse_usize(web.query('raiddef'));
    if (d !== null) {
      game.mode = 'Play';
      game.skip_intro();
      game.day = Math.max(game.day, 3);
      game.minutes = 9.0 * 60.0 + 24.0;
      game.raid.index = Math.min(d, 5);
      game.raid.next_day = game.day;
      game.raid.announced = true;
      game.ever_opened = true;
      if (d >= 5) {
        game.cb.won = [true, true, true, true, true];
      }
    }
  }
  if (web.query('medic') !== null) {
    game.force_medic = true;
  }
  // [par-counter] ?seller=1: khách kế tiếp là khách bán (bot sell.cjs thử đường trả pin cho khách bán)
  if (web.query('seller') !== null) {
    game.force_seller = true;
  }
  {
    const k = parse_u8(web.query('cine'));
    if (k !== null) game.cine = [k, 0.0];
  }
  // ?min=<phút>: đặt giờ trong ngày (sau các móc ở trên), ví dụ 420 = 07:00.
  {
    const v = parse_f32(web.query('min'));
    if (v !== null) game.minutes = clamp(v, 0.0, 1439.0);
  }
  const feel_nolock = web.query('nolock') !== null;
  return { game, feel_nolock };
}

/** `.add_systems(Startup, (world::setup_world, player::setup_player, (icons::setup, hud::setup_hud).chain()))` */
export const STARTUP_ORDER = ['world::setup_world', 'player::setup_player', 'icons::setup', 'hud::setup_hud'];
/** `.add_systems(Update, (...).chain())` in order; `boot::clock_system` is main.rs's own clock_system (this file). */
export const SYSTEM_ORDER = [
  'player::player_system',
  'boot::clock_system',
  'actors::tick_actors',
  'world::sync_world',
  'world::sync_build_actors',
  'actors::sync_actors',
  'staff::sync_staff',
  'cine::cine_actors',
  'people::secondary',
  'carry::sync_bin',
  'fx::fx_system',
  'icons::bake',
  'hud::update_hud',
  'web::export_system',
];

/* VIEW NOTES (main.rs)
- Window: title "The Walking Trade - procedural", canvas "#twt-canvas", fit to parent, prevent default events,
  ClearColor black. Resources created by main: Game (make_game().game), player::Feel { nolock: feel_nolock, rest default },
  web::Export (default), fx::Parts (default), mat::MatPlugin (materials).
- people.rs / icons.rs / hud.rs are not in this port set: 'people::secondary', 'icons::setup', 'icons::bake',
  'hud::setup_hud', 'hud::update_hud' are listed for order only; the integrator maps them to the new kit / HUD.
- `?sil` (people::SIL, silhouette rendering of people) is stored on g.sil for the people kit.
PORT GAPS: none in rules. Rust parse::<f32>() results are rounded to f32 (Math.fround) as Rust would.
*/
