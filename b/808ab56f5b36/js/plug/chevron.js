// Plug-in "chevron" (FTUE A3): the original's WorldChevronPrefab, a yellow downward chevron with a dark rim that bobs above the
// object of each quest on the To Do list (clip 02 sheet 1: on the cardboard box; sheet 3: on the battery at the counter).
// Positions come from the rules (sim/quests.js chevrons(): one per displayed quest that has an object, plus the open-switch
// reminder from day 2). Code-only geometry: an extruded "V" outline, turned to face the camera around the vertical axis.
// View only. ?noplug=chevron turns it off.
import * as THREE from '../../vendor/three.module.min.js';
import * as quests from '../sim/quests.js';

const MAX = 8;

function chevronGeo(w, h, t, depth) {
  // a "V" pointing down: outer edge, then inner edge offset by thickness t
  const s = new THREE.Shape();
  s.moveTo(-w / 2, h / 2);
  s.lineTo(0, -h / 2);
  s.lineTo(w / 2, h / 2);
  s.lineTo(w / 2 - t, h / 2);
  s.lineTo(0, -h / 2 + t * 1.4);
  s.lineTo(-w / 2 + t, h / 2);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}

export async function install(G) {
  const yel = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.65, 0.12), toneMapped: false, fog: false });
  const rim = new THREE.MeshBasicMaterial({ color: 0x1a1406, toneMapped: false, fog: false, side: THREE.BackSide });
  const gIn = chevronGeo(0.42, 0.3, 0.12, 0.06);
  const gOut = chevronGeo(0.5, 0.38, 0.17, 0.09);
  const pool = [];
  for (let k = 0; k < MAX; k++) {
    const o = new THREE.Group();
    const a = new THREE.Mesh(gIn, yel), b = new THREE.Mesh(gOut, rim);
    b.position.y = 0.01;
    // tên "ui/chevron": dấu chỉ nổi trên vật (cố ý lơ lửng, như WorldChevronPrefab gốc), float-scan bỏ qua
    o.name = 'ui/chevron';
    for (const m of [a, b]) { m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; m.name = 'ui/chevron'; }
    o.add(b, a);
    o.visible = false;
    o.renderOrder = 8;
    G.scene.add(o);
    pool.push(o);
  }
  // [FTUE A8] gốc NotesObject._glowEffect: tờ Notes trên bàn radio phát sáng từ ngày 3 khi còn trang chưa đọc
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.0, 0.9), transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false, fog: false }));
  glow.visible = false; glow.renderOrder = 7; G.scene.add(glow);
  let t = 0;
  G.updaters.push(['chevron', (dt) => {
    t += dt || 0.016;
    const g = G.g;
    const list = g ? quests.chevrons(g) : [];
    const cam = G.camera;
    const np = g && g.notes_glow ? g.props.find((p) => !p.dead && p.kind.k === 'Notes') : null;
    glow.visible = !!np;
    if (np) { glow.position.set(np.pos.x, np.pos.y + 0.05, np.pos.z); const k = 1 + 0.25 * Math.sin(t * 4.0); glow.scale.set(k, 0.45 * k, k); glow.material.opacity = 0.22 + 0.14 * Math.sin(t * 4.0); }
    for (let k = 0; k < MAX; k++) {
      const o = pool[k];
      const c = list[k];
      o.visible = !!c && !(g.panel && g.panel.k !== 'None');
      if (!o.visible) continue;
      o.position.set(c[0], c[1] + Math.sin(t * 3.2 + k) * 0.08, c[2]);
      if (cam) o.rotation.y = Math.atan2(cam.position.x - c[0], cam.position.z - c[2]);
    }
  }]);
  G.chevron = { count: () => pool.filter((o) => o.visible).length };
}
