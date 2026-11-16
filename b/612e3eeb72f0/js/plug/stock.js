// Plug-in "stock": shelving reads one can at a time. The rules (player.js case 'Shelf') still put a whole case
// (case_units() units, Dot 12/13) on the shelf in one press; here every new unit is hidden on the shelf
// (globalThis.__twtShelfHide, read by world.js shelf_mesh) and flies there on its own from the held box (or from in
// front of the player when stocking from the backpack): short arc, a little spin, staggered ~0.16 s, lands on its exact
// spot (world.shelf_unit_pos) with a tiny settle and a soft tick, and only then appears in the shelf mesh. Taking a case
// back into the box (right click) plays it in reverse. Customers taking a unit are not animated (their hands do it).
// View only: counts, prices and everything the bots read are untouched. ?noplug=stock shows the units instantly.
import * as world from '../sim/world.js';
import * as audio from '../sim/audio.js';
import { MB } from '../sim/geom.js';
import { Vec3 } from '../sim/vec.js';

const FLY = 0.42, GAP = 0.16, SETTLE = 0.12;
function play(name, vol, pos) { try { audio.play(name, vol, pos); } catch (e) { /* optional */ } }

export async function install(G) {
  const g = G.g, sg = G.sg;
  const snap = new Map(); // shelf -> counts array (what the view last saw)
  const pend = new Map(); // shelf -> per-slot units not yet landed
  const flights = [];
  let lastBox = -1, lastBoxN = -1;
  globalThis.__twtShelfHide = (sh, s) => { const p = pend.get(sh); return p ? p[s] || 0 : 0; };
  const S = G.stock = { flights, launched: 0, landed: 0, back: 0 };

  const source = () => {
    const H = G.hands;
    const c = G.camera.position;
    if (H && H.kind === 'box' && H.pos && H.pos.init) return new Vec3(c.x + H.pos.x.x, c.y + H.pos.x.y + 0.12, c.z + H.pos.x.z);
    const f = G.camera.getWorldDirection(new G.THREE.Vector3());
    return new Vec3(c.x + f.x * 0.45, c.y - 0.3, c.z + f.z * 0.45);
  };
  const spawnCan = (it, at, sc) => {
    const mb = new MB();
    world.item_geo(mb, it, new Vec3(0, 0, 0), sc);
    if (mb.is_empty()) return null;
    return sg.spawn(mb.build(), 'solid', { pos: at.clone(), shadow: false, dynamic: true });
  };
  const heldBox = () => { const p = g.held !== null ? g.prop(g.held) : null; return p && p.kind.k === 'Box' ? p : null; };

  G.updaters.push(['stock', (dt) => {
    const box = heldBox();
    const boxN = box ? box.kind.a.length : -1, boxId = box ? box.id : -1;
    const tookIntoBox = box && boxId === lastBox && boxN > lastBoxN;
    for (const sh of g.shelves) {
      let prev = snap.get(sh);
      const cur = sh.slots.map((_, s) => sh.units(s));
      if (!prev || prev.length !== cur.length) { snap.set(sh, cur); pend.set(sh, new Array(cur.length).fill(0)); continue; }
      const pp = pend.get(sh);
      for (let s = 0; s < cur.length; s++) {
        const d = cur[s] - prev[s];
        if (d > 0 && g.mode === 'Play' && sh.pos.distance(g.player) < 4.5) {
          const src = source();
          for (let k = 0; k < d; k++) {
            const [dst, sc] = world.shelf_unit_pos(sh, s, prev[s] + k);
            flights.push({ sh, s, it: sh.slots[s], a: src.clone(), b: dst, sc, t: -k * GAP, node: null, dir: 1, spin: (k % 2 ? 1 : -1) * (2.5 + k), yaw: 0 });
            pp[s] += 1; S.launched++;
          }
          sh.dirty = true;
        } else if (d < 0 && tookIntoBox) {
          for (let k = 0; k < -d; k++) {
            const [from, sc] = world.shelf_unit_pos(sh, s, cur[s] + k);
            flights.push({ sh, s, it: prev.items ? prev.items[s] : box.kind.a[box.kind.a.length - 1], a: from, b: source(), sc, t: -k * GAP, node: null, dir: -1, spin: 3 + k, yaw: 0 });
            S.back++;
          }
        }
        if (pp[s] > cur[s]) pp[s] = cur[s];
      }
      cur.items = sh.slots.slice();
      snap.set(sh, cur);
    }
    lastBox = boxId; lastBoxN = boxN;
    // fly
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i];
      f.t += dt;
      if (f.t < 0) continue;
      if (!f.node) { f.node = spawnCan(f.it, f.a, f.sc); if (f.dir > 0 && f.t < dt * 1.5) play('swish', 0.12, f.a); }
      const u = Math.min(f.t / FLY, 1), e = u * u * (3 - 2 * u);
      const h = 0.22 * Math.sin(Math.PI * u);
      let p = f.a.lerp(f.b, e); p = new Vec3(p.x, p.y + h, p.z);
      let ang = f.yaw + f.spin * (1 - e);
      let tilt = 0.6 * Math.sin(Math.PI * u);
      if (u >= 1) {
        const st = (f.t - FLY) / SETTLE;
        if (f.dir > 0 && !f.ticked) { f.ticked = true; play('tink', 0.18, f.b); }
        p = new Vec3(f.b.x, f.b.y + 0.012 * Math.abs(Math.sin(st * Math.PI * 2)) * (1 - st), f.b.z);
        tilt = 0.08 * Math.sin(st * Math.PI * 3) * (1 - st);
        if (st >= 1 || f.dir < 0) {
          if (f.node) f.node.despawn();
          if (f.dir > 0) { const pp = pend.get(f.sh); if (pp && pp[f.s] > 0) pp[f.s] -= 1; f.sh.dirty = true; S.landed++; }
          flights.splice(i, 1);
          continue;
        }
      }
      if (f.node) {
        f.node.set_pos(p);
        const cy = Math.cos(ang / 2), sy = Math.sin(ang / 2), cx = Math.cos(tilt / 2), sx = Math.sin(tilt / 2);
        f.node.set_quat([sx * cy, cx * sy, -sx * sy, cx * cy]);
      }
    }
  }]);
  return S;
}
