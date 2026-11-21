// Plug-in "heli": after a raid is beaten the original game sends a helicopter that flies over the lot and drops the
// orange "Rare Package" crate (PARITY M04; clip 07 17:28-17:45 and 1:28:28, clip 08 28:55, clip 09 22:32: red raid tint
// ends, a light-tan helicopter crosses the sky, the crate falls into the lot, "Rare Package" to open). The rules still put
// the reward crate on the ground at once (combat.js raid end); this view hangs it under the helicopter and lets it fall
// (world.REWARD_LIFT offsets the crate mesh only). View only, no colliders. ?noplug=heli removes it.
import * as THREE from '../../vendor/three.module.min.js';
import { mat } from '../mats.js';
import { REWARD_LIFT } from '../sim/world.js';

function buildHeli() {
  const g = new THREE.Group();
  const body = mat({ surf: 'paintedMetal', rough: 0.5, metal: 0.2, color: 0xd8c8a4, heli: 1 });
  const dark = mat({ surf: 'paintedMetal', rough: 0.6, metal: 0.4, color: 0x3a3a3a, heli: 2 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1a2630, roughness: 0.1, metalness: 0.6 });
  const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = true; g.add(o); return o; };
  // fuselage along +x (nose) / -x (tail)
  const fus = add(new THREE.SphereGeometry(1, 16, 10), body, 0.3, 0, 0); fus.scale.set(2.1, 1.05, 1.0);
  add(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), glass, 1.25, 0.15, 0, 0, 0, -1.2).scale.set(0.95, 0.75, 0.85);
  add(new THREE.CylinderGeometry(0.16, 0.32, 4.6, 8), body, -3.6, 0.35, 0, 0, 0, Math.PI / 2 - 0.08);
  add(new THREE.BoxGeometry(0.9, 1.1, 0.08), body, -5.7, 0.85, 0, 0, 0, -0.35);
  add(new THREE.BoxGeometry(0.9, 0.07, 1.3), body, -5.4, 0.4, 0);
  for (const z of [-0.8, 0.8]) {
    add(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 6), dark, 0.3, -1.35, z, 0, 0, Math.PI / 2);
    for (const x of [-0.5, 1.0]) add(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 6), dark, x, -1.05, z * 0.85, z > 0 ? -0.35 : 0.35, 0, 0);
  }
  add(new THREE.CylinderGeometry(0.12, 0.18, 0.45, 8), dark, 0.3, 1.15, 0);
  const rotor = new THREE.Group(); rotor.position.set(0.3, 1.4, 0); g.add(rotor);
  for (let k = 0; k < 2; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.05, 0.35), dark); b.rotation.y = k * Math.PI / 2; rotor.add(b); }
  const tail = new THREE.Group(); tail.position.set(-5.75, 0.9, 0.12); g.add(tail);
  for (let k = 0; k < 2; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.03), dark); b.rotation.z = k * Math.PI / 2; tail.add(b); }
  g.userData = { rotor, tail };
  return g;
}

const ease = (t) => t * t * (3 - 2 * t);

export async function install(G) {
  const heli = buildHeli(); heli.visible = false; G.scene.add(heli);
  const seen = new Set(); let primed = false; let fly = null; let wasRaid = false;
  const v = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  G.updaters.push(['heli', (dt) => {
    const g = G.g; if (!g || !g.props) return;
    const raid = !!(g.raid && g.raid.active);
    const ended = wasRaid && !raid; wasRaid = raid;
    for (const p of g.props) {
      if (p.dead || p.kind.k !== 'Reward' || seen.has(p.id)) continue;
      seen.add(p.id);
      // only a crate that lands as a raid ends flies in (not crates from a loaded save at start)
      if (primed && (ended || (g.cine && !raid)) && fly === null) fly = { id: p.id, t: 0, D: new THREE.Vector3(p.pos.x, 0, p.pos.z) };
    }
    primed = true;
    if (fly === null) return;
    fly.t += dt;
    const t = fly.t, D = fly.D;
    A.set(D.x + 70, 30, D.z - 35); B.set(D.x, 15, D.z); C.set(D.x - 85, 34, D.z + 45);
    if (t < 5) v.lerpVectors(A, B, ease(t / 5));
    else if (t < 7) v.copy(B).add(new THREE.Vector3(0, Math.sin((t - 5) * 2.5) * 0.25, 0));
    else v.lerpVectors(B, C, Math.pow((t - 7) / 7, 1.6));
    heli.visible = true; heli.position.copy(v);
    const dir = t < 5 ? B.clone().sub(A) : C.clone().sub(B);
    heli.rotation.set(0, Math.atan2(-dir.z, dir.x), t < 5 ? -0.12 * (1 - t / 5) : t < 7 ? 0 : -0.15 * Math.min(1, (t - 7) / 2));
    heli.userData.rotor.rotation.y += dt * 38; heli.userData.tail.rotation.x += dt * 50;
    // the crate: under the helicopter, released at 5.6 s, falls to the ground
    const p = g.props.find((q) => q.id === fly.id && !q.dead);
    if (p) {
      if (t < 5.6) REWARD_LIFT.set(p.id, [v.x - D.x, v.y - 1.9, v.z - D.z]);
      else { const ft = t - 5.6, y = Math.max(0, (B.y - 1.9) - 4.9 * ft * ft); if (y > 0) REWARD_LIFT.set(p.id, [0, y, 0]); else REWARD_LIFT.delete(p.id); }
    }
    if (t > 14) { heli.visible = false; if (p) REWARD_LIFT.delete(p.id); fly = null; }
  }]);
  G.heliPlug = { heli, fire: (id) => { const p = G.g.props.find((q) => q.id === id); if (p) fly = { id, t: 0, D: new THREE.Vector3(p.pos.x, 0, p.pos.z) }; } };
  return heli;
}
