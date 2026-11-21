// Plug-in "outline" ([par-counter A02, D06]): the original draws a thin white outline around the object under the crosshair
// (c01 4:04 Cardboard Box, clip 02 2:56 "Unlabelled Tin" while filling a box) and around the trash bag being carried
// (clip 01 0:40). Done here as an inverted hull: a back-face-only white copy of the object's mesh, scaled up about its own
// centre by a fixed world margin, so only the rim shows around the silhouette. One hull at a time.
// fin-build: a placed object that can be grabbed with empty hands (g.look_grab, clip 10 1:59 "Grab") and the object held in
// build mode get the same rim; while the upgrade panel is open the station gets a dashed white footprint on the floor
// (sheet 0:16:40 Basket Stand; the yellow body is the build-mode hologram in world.js sync_edit).
// View only: what is aimed at is the rules' (g.look_id, g.look_grab, g.held). ?noplug=outline turns it off.
import * as THREE from '../../vendor/three.module.min.js';
import { noMask } from '../mats.js';
import { ViewModels } from '../sim/player.js';
import * as build from '../sim/build.js';

const KINDS = new Set(['Item', 'Box', 'BoxPile', 'Trash', 'Crate', 'Reward', 'Corpse', 'WBox']);
const MARGIN = 0.018; // metres of rim (world); the held bag's hull uses VM_MARGIN in camera space
const VM_MARGIN = 0.012;

export async function install(G) {
  const g = G.g;
  const mat = noMask(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.35, 1.35, 1.35), side: THREE.BackSide, toneMapped: false, fog: false }));
  // [FTUE A11] gốc InteractableProximityHinter: không nhắm gì thì vật tương tác gần nhất trong 2,5 m, nón 90 độ, viền trắng
  // mờ (alpha 0,125)
  const matHint = noMask(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.35, 1.35, 1.35), side: THREE.BackSide, toneMapped: false, fog: false, transparent: true, opacity: 0.125, depthWrite: false }));
  let hull = null, hullOf = null, hullGeo = null, hullMat = null;
  const drop = () => {
    if (hull && hull.parent) hull.parent.remove(hull);
    if (hull && hull.userData.ownGeo) hull.geometry.dispose();
    hull = null; hullOf = null; hullGeo = null; hullMat = null;
  };
  // open shapes (the cardboard box): the copy's inner walls would show through the open top, so the hull is the box's
  // bounding box instead (its silhouette is that box anyway)
  const attach = (mesh3, margin, viewmodel, bbox, m = mat) => {
    if (!mesh3 || !mesh3.geometry) { drop(); return; }
    if (hullOf === mesh3 && hullGeo === mesh3.geometry && hullMat === m) return;
    drop();
    const geo = mesh3.geometry;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox, c = new THREE.Vector3(), sz = new THREE.Vector3();
    bb.getCenter(c); bb.getSize(sz);
    let h;
    if (bbox) {
      h = new THREE.Mesh(new THREE.BoxGeometry(sz.x, sz.y, sz.z), m);
      h.userData.ownGeo = true;
    } else h = new THREE.Mesh(geo, m);
    h.userData.keepGeo = !bbox; // a hull sharing the object's geometry must never dispose it
    // per-axis scale so the rim is the same width on a flat tin and a tall bag
    const sx = 1 + (2 * margin) / Math.max(sz.x, 0.02), sy = 1 + (2 * margin) / Math.max(sz.y, 0.02), sz2 = 1 + (2 * margin) / Math.max(sz.z, 0.02);
    h.scale.set(sx, sy, sz2);
    if (bbox) h.position.copy(c);
    else h.position.set(c.x * (1 - sx), c.y * (1 - sy), c.z * (1 - sz2));
    h.castShadow = false; h.receiveShadow = false; h.frustumCulled = false; h.renderOrder = -1;
    if (viewmodel) h.layers.set(1);
    mesh3.add(h);
    hull = h; hullOf = mesh3; hullGeo = geo; hullMat = m;
  };
  G.updaters.push(['outline', () => {
    const playing = g.mode === 'Play' && g.cine === null && g.panel.k === 'None';
    if (!playing) { drop(); return; }
    // the carried trash bag (view model, left part) when nothing else is aimed at
    const hp = g.held !== null ? g.props.find((p) => p.id === g.held) : undefined;
    // [par-counter D16] the carried package floats in front (rules place it), white rim like c01 5:05
    if (hp !== undefined && hp.kind.k === 'Crate' && hp.ent && !hp.ent.dead && hp.ent.mesh3) { attach(hp.ent.mesh3, MARGIN, false, true); return; }
    if (hp !== undefined && hp.kind.k === 'Trash' && !g.look_id) {
      const vm = ViewModels[1];
      if (vm && vm.visible && vm.mesh3) { attach(vm.mesh3, VM_MARGIN, true); return; }
    }
    if (g.look_grab) {
      const p = g.prop(g.look_grab | 0);
      if (p && !p.dead && p.ent && p.ent.mesh3) { attach(p.ent.mesh3, MARGIN, false, false); return; }
    }
    if (g.look_id) {
      const p = g.props.find((q) => q.id === g.look_id && !q.dead);
      if (p !== undefined && KINDS.has(p.kind.k) && p.ent && !p.ent.dead && p.ent.visible && p.ent.mesh3) { attach(p.ent.mesh3, MARGIN, false, p.kind.k === 'Box' || p.kind.k === 'BoxPile'); return; }
    }
    {
      // [FTUE A11] viền gợi ý: vật tương tác gần nhất trong 2,5 m phía trước (nón 90 độ), mờ
      const fx = -Math.sin(g.yaw), fz = -Math.cos(g.yaw);
      let best = null, bd = 2.5;
      for (const p of g.props) {
        if (p.dead || !KINDS.has(p.kind.k) || !p.ent || p.ent.dead || !p.ent.visible || !p.ent.mesh3 || g.held === p.id) continue;
        const dx = p.pos.x - g.player.x, dz = p.pos.z - g.player.z, d = Math.hypot(dx, dz);
        if (d >= bd || (d > 0.3 && (dx * fx + dz * fz) / d < 0.0)) continue;
        bd = d; best = p;
      }
      if (best !== null) { attach(best.ent.mesh3, MARGIN, false, best.kind.k === 'Box' || best.kind.k === 'BoxPile', matHint); return; }
    }
    drop();
  }]);
  // upgrade highlight (fin-build): dashed footprint under the station whose upgrade panel is open
  const dash = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineDashedMaterial({ color: new THREE.Color(1.6, 1.6, 1.6), dashSize: 0.12, gapSize: 0.08 }));
  dash.rotation.x = -Math.PI / 2; dash.visible = false; dash.frustumCulled = false; G.scene.add(dash);
  G.updaters.push(['outline-upgrade', () => {
    let hit = null;
    if (g.mode === 'Play' && g.panel.k === 'Trade' && g.ev.trade.k === 'Upgrade') {
      const t = g.ev.trade.a;
      for (const [st, mn, mx] of build.targets(g)) if (build.tier_of(st) === t) { hit = [mn, mx]; break; }
    }
    dash.visible = hit !== null;
    if (hit !== null) {
      const [mn, mx] = hit;
      dash.position.set((mn.x + mx.x) / 2, 0.02, (mn.z + mx.z) / 2);
      dash.scale.set(mx.x - mn.x + 0.5, mx.z - mn.z + 0.5, 1);
      dash.computeLineDistances();
    }
  }]);
  G.outline = { current: () => (hullOf !== null ? (g.look_grab || g.look_id || 0) : 0), upgrade: () => dash.visible };
  return { drop };
}
