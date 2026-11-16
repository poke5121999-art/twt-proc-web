// Plug-in "till": the counter moment of the original (browse-checkout-haggle.md §2.3 / "Coin handling coroutine per coin":
// each battery tweens to the verifier, CheckBattery, then to its denomination depot or the bin), drawn over the rules'
// own key-driven flow (player.js: aim + E checks a battery, E again files it, B bins a fake, alarm button):
// - checking a battery: it flies from the counter into the yellow tester (models.js counter), the lamp lights green with
//   a beep for a real one, red with a buzz for a fake, then the battery hops back to its spot with its green / red ring;
// - filing a real battery: it flies into the open drawer compartment of its denomination; the drawers visibly hold the
//   shop's batteries (greedy split of g.batteries over 1000/100/50/10/5/1, capped per compartment);
// - a fake found: the alarm button glows and pulses until pressed, the paying robot's face screen shows fear, then
//   pleading while it begs (Y/N), anger if it bolts.
// View only: coins, drawer revenue, alarm outcome and the bots' pay[] export are the rules'. ?noplug=till turns it off.
import * as world from '../sim/world.js';
import * as player from '../sim/player.js';
import * as lay from '../sim/lay.js';
import * as audio from '../sim/audio.js';
import { MB, hex, FLAT, m4_mul, m4_translate, m4_scale } from '../sim/geom.js';
import { Vec3 } from '../sim/vec.js';

const DENOMS = [1000, 100, 50, 10, 5, 1];
const SLOT = new Vec3(0.46, 1.115, -2.86);
const LAMP = new Vec3(0.53, 1.124, -2.9);
function play(name, vol, pos) { try { audio.play(name, vol, pos); } catch (e) { /* optional */ } }
function compartment(v) {
  const k = v <= 5 ? 0 : v <= 50 ? 1 : 2, j = v === 1 || v === 10 || v === 100 ? 0 : 1;
  return new Vec3(-0.62 + k * 0.44 + 0.045 + j * 0.165 + 0.07, 0.672, -3.165);
}
function arc(a, b, u, h) { const e = u * u * (3 - 2 * u); const p = a.lerp(b, e); return new Vec3(p.x, p.y + h * Math.sin(Math.PI * u), p.z); }

export async function install(G) {
  const g = G.g, sg = G.sg;
  const hidden = new Set();
  globalThis.__twtCoinHide = (i) => hidden.has(i);
  const S = G.till = { checks: 0, filed: 0, lamp: 0, lampCol: 0, anims: [] };
  let lastPay = null, seen = [];
  const one = (fn) => { const mb = new MB(); fn(mb); if (mb.is_empty()) mb.cube(new Vec3(0, -5, 0), new Vec3(0.01, 0.01, 0.01), [0, 0, 0], FLAT); return mb.build(); };
  const lampNode = sg.spawn(one(() => {}), 'solid', { pos: LAMP.clone(), shadow: false });
  const alarmNode = sg.spawn(one((mb) => { mb.emi = 3.0; mb.lathe(new Vec3(0, 0, 0), [[0.075, 0.0], [0.065, 0.012], [0.0, 0.016]], 16, false, hex(0xff3020), FLAT); mb.emi = 0; }), 'solid', { pos: new Vec3(player.ALARM.x + 0.1, player.ALARM.y + 0.05, player.ALARM.z + 0.2), shadow: false, visible: false });
  const drawerNode = sg.spawn(one(() => {}), 'solid', { pos: new Vec3(0, 0, 0), shadow: false });
  let drawerSig = '';
  const flyers = [];
  const coinNode = (value, tell) => sg.spawn(one((mb) => world.battery_geo(mb, new Vec3(0, 0, 0), value, tell)), 'solid', { pos: new Vec3(0, -5, 0), shadow: false, dynamic: true });
  const bump = () => { g.pay_rev += 1; };
  const customer = () => {
    let best = null, bd = 2.8;
    for (const c of g.customers || []) { if (!c.pos || !c.body) continue; const d = Math.hypot(c.pos.x - lay.TILL.x, c.pos.z - (lay.TILL.z + 1.0)); if (d < bd) { bd = d; best = c; } }
    return best;
  };
  let emoCust = null;
  const emote = (e) => { const c = customer(); if (emoCust && emoCust !== c && emoCust.body && emoCust.body.setEmote) emoCust.body.setEmote('auto'); emoCust = c; if (c && c.body && c.body.setEmote) c.body.setEmote(e); };

  G.updaters.push(['till', (dt) => {
    const pay = g.pay;
    if (pay !== lastPay) { seen = pay ? pay.coins.map((c) => ({ checked: c.checked, done: c.done })) : []; lastPay = pay; }
    if (pay) {
      pay.coins.forEach((c, i) => {
        const s = seen[i] || (seen[i] = { checked: c.checked, done: c.done });
        if (c.checked && !s.checked) {
          // to the tester and back
          S.checks++;
          const home = player.coin_pos(i);
          flyers.push({ i, value: c.value, fake: c.fake, t: 0, phase: 'in', a: home, b: SLOT, node: coinNode(c.value, 0), home });
          hidden.add(i); bump();
        }
        if (c.done !== s.done) {
          if (c.done === 1) {
            S.filed++;
            const f = flyers.find((x) => x.i === i);
            const from = f ? f.node.pos.clone() : player.coin_pos(i);
            if (f) { f.node.despawn(); flyers.splice(flyers.indexOf(f), 1); }
            flyers.push({ i, value: c.value, fake: false, t: 0, phase: 'drawer', a: from, b: compartment(c.value), node: coinNode(c.value, 1) });
            hidden.add(i); bump();
          }
        }
        s.checked = c.checked; s.done = c.done;
      });
    }
    // flights
    for (let k = flyers.length - 1; k >= 0; k--) {
      const f = flyers[k];
      f.t += dt;
      if (f.phase === 'in') {
        const u = Math.min(f.t / 0.32, 1);
        f.node.set_pos(arc(f.a, f.b, u, 0.12));
        if (u >= 1) { f.phase = 'test'; f.t = 0; S.lamp = 0.7; S.lampCol = f.fake ? 2 : 1; play(f.fake ? 'deny' : 'click', f.fake ? 0.55 : 0.45, f.b); if (f.fake) play('siren', 0.08, f.b); }
      } else if (f.phase === 'test') {
        f.node.set_pos(new Vec3(f.b.x, f.b.y - 0.03 * Math.min(f.t / 0.1, 1), f.b.z));
        if (f.t > 0.55) { f.phase = 'out'; f.t = 0; f.node.despawn(); f.node = coinNode(f.value, f.fake ? 2 : 1); f.a = f.b; f.b = f.home; }
      } else if (f.phase === 'out') {
        const u = Math.min(f.t / 0.3, 1);
        f.node.set_pos(arc(f.a, f.b, u, 0.1));
        if (u >= 1) { f.node.despawn(); flyers.splice(k, 1); hidden.delete(f.i); bump(); }
      } else if (f.phase === 'drawer') {
        const u = Math.min(f.t / 0.45, 1);
        f.node.set_pos(arc(f.a, f.b, u, 0.18));
        if (u >= 1) { f.node.despawn(); flyers.splice(k, 1); hidden.delete(f.i); play('tink', 0.3, f.b); drawerSig = ''; }
      }
    }
    // tester lamp
    S.lamp = Math.max(0, S.lamp - dt);
    const lit = S.lamp > 0 ? S.lampCol : 0;
    if (lampNode.__lit !== lit) {
      lampNode.__lit = lit;
      lampNode.set_mesh(one((mb) => { mb.emi = lit ? 4.0 : 0.2; mb.cyl(new Vec3(0, 0, 0), 0.013, 0.011, 0.016, 10, hex(lit === 2 ? 0xff2a1a : lit === 1 ? 0x30ff60 : 0x404040), FLAT); mb.emi = 0; }));
    }
    // alarm button invites a press while a found fake waits
    const wantAlarm = !!(pay && pay.alarm === 0 && pay.coins.some((c) => c.checked && c.fake));
    alarmNode.set_visible(wantAlarm);
    if (wantAlarm) alarmNode.set_scale(1 + 0.25 * Math.abs(Math.sin(G.t * 6)));
    // the paying robot's face
    if (pay && pay.coins.some((c) => c.checked && c.fake)) emote(pay.alarm === 1 ? 'sad' : pay.alarm === 2 ? 'angry' : 'scared');
    else if (emoCust) { if (emoCust.body && emoCust.body.setEmote) emoCust.body.setEmote('auto'); emoCust = null; }
    // drawers: the shop's batteries by denomination, minus the ones still flying in
    let total = Math.max(0, g.batteries | 0);
    for (const f of flyers) if (f.phase === 'drawer') total -= f.value;
    total = Math.max(0, total);
    const sig = String(total);
    if (sig !== drawerSig) {
      drawerSig = sig;
      let left = total;
      drawerNode.set_mesh(one((mb) => {
        for (const v of DENOMS) {
          const n = Math.floor(left / v); left -= n * v;
          const c = compartment(v), show = Math.min(n, 12);
          for (let q = 0; q < show; q++) {
            const col = q % 3, row = Math.floor(q / 3);
            mb.push(m4_mul(m4_translate(new Vec3(c.x - 0.04 + col * 0.04, c.y + 0.012, c.z - 0.1 + row * 0.05)), m4_scale(new Vec3(0.5, 0.5, 0.5))));
            world.battery_geo(mb, new Vec3(0, 0, 0), v, 0);
            mb.pop();
          }
        }
      }));
    }
  }]);
  return S;
}
