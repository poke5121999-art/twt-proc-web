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
import * as THREE from '../../vendor/three.module.min.js';
import { noMask } from '../mats.js';
import * as models from '../sim/models.js';
import * as world from '../sim/world.js';
import * as player from '../sim/player.js';
import * as lay from '../sim/lay.js';
import * as audio from '../sim/audio.js';
import { MB, hex, FLAT, m4_mul, m4_translate, m4_scale, m4_rot_y } from '../sim/geom.js';
import { Vec3 } from '../sim/vec.js';

const DENOMS = [1000, 100, 50, 10, 5, 1];
const SLOT = new Vec3(0.46, 1.115, -2.86);
const LAMP = new Vec3(0.53, 1.124, -2.9);
function play(name, vol, pos) { try { audio.play(name, vol, pos); } catch (e) { /* optional */ } }
function compartment(v) {
  const c = player.drawer_cell(v);
  return new Vec3((c.x0 + c.x1) * 0.5, c.y + 0.012, (c.z0 + c.z1) * 0.5);
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
  // value printed on each battery on the counter: canvas label on the side facing the seller, lit a little so it reads in the
  // dim shop (one texture per denomination, a small pool of quads)
  const labelTex = new Map();
  const tex = (v) => {
    if (labelTex.has(v)) return labelTex.get(v);
    const c = document.createElement('canvas'); c.width = 128; c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = '#f4f0e4'; x.fillRect(0, 0, 128, 64);
    x.fillStyle = '#16181b'; x.fillRect(0, 0, 128, 6); x.fillRect(0, 58, 128, 6);
    x.font = 'bold ' + (v >= 1000 ? 40 : 50) + 'px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#111';
    x.fillText(String(v), 64, 34);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    const m = noMask(new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(1.6, 1.6, 1.6) }));
    labelTex.set(v, m); return m;
  };
  const labelGeo = new THREE.PlaneGeometry(1, 1);
  const labels = [];
  const syncLabels = () => {
    const pay = g.pay;
    let n = 0;
    if (pay) pay.coins.forEach((c, i) => {
      if (c.done !== 0 || hidden.has(i)) return;
      // [par-counter D10] pin nằm ngang (world.battery_geo): nhãn số dán trên mặt hông phía người bán
      const L = models.battery_look(c.value), r = L.shape === 'box' ? L.w * 0.5 : L.r, h = L.shape === 'box' ? L.h : L.r * 2, p = player.coin_pos(i);
      let m = labels[n];
      if (!m) { m = new THREE.Mesh(labelGeo, tex(c.value)); m.rotation.y = Math.PI; m.castShadow = false; G.scene.add(m); labels[n] = m; }
      m.material = tex(c.value); m.visible = true;
      m.scale.set(L.len * 0.55, h * 0.62, 1);
      m.position.set(p.x - L.len * 0.08, p.y + h * 0.5, p.z - r * 1.03 - 0.003);
      n++;
    });
    for (let k = n; k < labels.length; k++) labels[k].visible = false;
  };
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

  // [par-counter D12] trả pin cho khách bán: cục đang cầm hiện trước mặt, cục đưa đi bay từ tay sang khách
  const handNode = sg.spawn(one(() => {}), 'solid', { pos: new Vec3(0, -5, 0), shadow: false, dynamic: true, visible: false });
  let handVal = 0, giveSent = 0, giveRef = null;
  G.updaters.push(['till', (dt) => {
    const gv = g.give;
    if (gv !== giveRef) { giveRef = gv; giveSent = gv ? gv.sent : 0; }
    const eye = new Vec3(g.player.x, g.player.y + 1.62, g.player.z);
    const cp = Math.cos(g.pitch), dir = new Vec3(-Math.sin(g.yaw) * cp, Math.sin(g.pitch), -Math.cos(g.yaw) * cp);
    const right = new Vec3(Math.cos(g.yaw), 0, -Math.sin(g.yaw));
    const handPos = eye.add(dir.mul(0.42)).add(right.mul(0.13)).add(new Vec3(0, -0.12, 0));
    const hv = gv ? gv.hand : 0;
    if (hv !== handVal) {
      handVal = hv;
      if (hv > 0) handNode.set_mesh(one((mb) => world.battery_geo(mb, new Vec3(0, 0, 0), hv, 0)));
      handNode.set_visible(hv > 0);
    }
    if (hv > 0) handNode.set_pos(handPos);
    if (gv && gv.sent !== giveSent) {
      giveSent = gv.sent;
      const c = gv.c, to = c && c.pos ? new Vec3(c.pos.x, 1.05, c.pos.z - 0.15) : new Vec3(lay.TILL.x, 1.1, lay.TILL.z + 0.6);
      flyers.push({ i: -1, value: 1, fake: false, t: 0, phase: 'give', a: handPos, b: to, node: coinNode(gv.last || 1, 0) });
    }
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
      } else if (f.phase === 'give') {
        const u = Math.min(f.t / 0.4, 1);
        f.node.set_pos(arc(f.a, f.b, u, 0.15));
        if (u >= 1) { f.node.despawn(); flyers.splice(k, 1); }
      } else if (f.phase === 'drawer') {
        const u = Math.min(f.t / 0.45, 1);
        f.node.set_pos(arc(f.a, f.b, u, 0.18));
        if (u >= 1) { f.node.despawn(); flyers.splice(k, 1); hidden.delete(f.i); play('tink', 0.3, f.b); drawerSig = ''; }
      }
    }
    syncLabels();
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
          // [par-counter D10] gốc: ngăn kéo luôn đầy pin xếp sát theo mệnh giá (op/04a lúc 0 pin vẫn đầy), không đếm theo số dư;
          // pin nằm ngang thành hàng, đầu cực quay về người bán, lệch nhẹ như bỏ tay vào (clip 09 3:53, clip 02 7:42). Cỡ pin
          // trong ngăn ~ cỡ pin trên quầy (gốc: ngăn xanh lá ~6 khối một hàng, 3 hàng)
          const c = player.drawer_cell(v), L = models.battery_look(v);
          const wid = L.shape === 'box' ? L.w : L.r * 2, sc = v >= 100 ? 0.8 : 1.12;
          const W = c.x1 - c.x0, D = c.z1 - c.z0;
          const cols = Math.max(1, Math.floor(W / (wid * sc * 1.08))), rows = Math.max(1, Math.floor(D / (L.len * sc * 1.04)));
          const dx = W / cols, dz = D / rows;
          for (let q = 0; q < cols * rows; q++) {
            const col = q % cols, row = Math.floor(q / cols);
            const jit = (((q * 37 + v) % 7) - 3) * 0.035;
            mb.push(m4_mul(m4_mul(m4_translate(new Vec3(c.x0 + (col + 0.5) * dx, c.y + 0.002, c.z0 + (row + 0.5) * dz)), m4_rot_y(Math.PI * 0.5 + jit)), m4_scale(new Vec3(sc, sc, sc))));
            world.battery_geo(mb, new Vec3(0, 0, 0), v, 0);
            mb.pop();
          }
        }
      }));
    }
  }]);
  return S;
}
