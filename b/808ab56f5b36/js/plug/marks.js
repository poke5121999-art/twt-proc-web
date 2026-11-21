// Plug-in "marks" ([par-counter B22, B23, D08]): world marks the original draws over things, view only.
// - B22 (c01 2:21:20): a blue disc with a white shopping cart floats over a customer who came to buy (walking in, browsing),
//   not over the one being served at the till. A red disc with a white pistol floats over a hostile day zombie (c01 0:19:00,
//   over the zombie being hit). [ĐỀ XUẤT] which zombies get it: every live non-raid zombie within 30 m.
// - B23 (c01 5:43:00): during a raid, raid zombies further than 14 m get a small red tab and a white "?" over the head.
// - D08 (clip 01 1:35): the hammer lying in the store glows yellow (quest object), no white rim / name tag (outline.js and
//   hud.name_tag skip it): a yellow back-face hull (no extra light: one more point light costs every lit material).
// Positions are the rules' (g.customers, g.zombies, g.props); ?noplug=marks turns it off.
import * as THREE from '../../vendor/three.module.min.js';
import { noMask } from '../mats.js';

const CART = '<svg viewBox="0 0 24 24" width="62%" height="62%"><path fill="#fff" d="M3 4h2.2l2.3 10.2c.1.5.6.8 1.1.8h9.1c.5 0 .9-.3 1-.8L20.6 8H7.1L6.6 5.6C6.4 4.7 5.7 4 4.8 4H3z"/><circle cx="9.5" cy="18.6" r="1.7" fill="#fff"/><circle cx="17" cy="18.6" r="1.7" fill="#fff"/></svg>';
const GUN = '<svg viewBox="0 0 24 24" width="62%" height="62%"><path fill="#fff" d="M3 7h16l1 1v3h-5l-1 1v1.5c0 .8-.7 1.5-1.5 1.5H12l-1.2 5H7l1.5-6H6L5 11H3z"/></svg>';

export async function install(G) {
  const g = G.g;
  const css = document.createElement('style');
  css.textContent = `
.tw-marks{position:fixed;inset:0;pointer-events:none;z-index:4;overflow:hidden}
.tw-mk{position:absolute;left:0;top:0;transform-origin:50% 100%;will-change:transform}
.tw-mk .d{width:4.6vh;height:4.6vh;border-radius:50%;display:flex;align-items:center;justify-content:center;
 box-shadow:0 0 1.2vh rgba(0,0,0,.35);transform:translate(-50%,-100%)}
.tw-mk.buy .d{background:#2f7fe0;border:.25vh solid #9cc8ff}
.tw-mk.foe .d{background:#d2232a;border:.25vh solid #ff8a8a}
.tw-mk.q{font:700 4.2vh/1 system-ui,sans-serif;color:#fff;text-shadow:0 0 .6vh #000}
.tw-mk.q .t{position:absolute;left:-.55vh;top:-6.4vh;width:1.1vh;height:1.3vh;background:#e0262c}
.tw-mk.q .c{transform:translate(-50%,-100%)}`;
  document.head.appendChild(css);
  const root = document.createElement('div');
  root.className = 'tw-marks';
  document.body.appendChild(root);
  const pool = [];
  const get = (i, cls) => {
    let e = pool[i];
    if (!e) { e = document.createElement('div'); root.appendChild(e); pool[i] = e; e.dataset.k = ''; }
    if (e.dataset.k !== cls) {
      e.dataset.k = cls;
      e.className = 'tw-mk ' + cls;
      e.innerHTML = cls === 'buy' ? `<div class="d">${CART}</div>` : cls === 'foe' ? `<div class="d">${GUN}</div>` : '<div class="t"></div><div class="c">?</div>';
    }
    e.style.display = '';
    return e;
  };
  const v = new THREE.Vector3();

  // D08: yellow glow on the hammer
  const glowMat = noMask(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.1, 0.25), side: THREE.BackSide, toneMapped: false, fog: false }));
  // soft yellow pool on the floor under the hammer (additive decal, no light)
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  { const x = cv.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,235,90,0.55)'); gr.addColorStop(0.5, 'rgba(220,230,60,0.22)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); }
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
  halo.rotation.x = -Math.PI / 2; halo.visible = false; halo.renderOrder = 2;
  G.scene.add(halo);
  let glow = null, glowOf = null;
  const dropGlow = () => { if (glow && glow.parent) glow.parent.remove(glow); glow = null; glowOf = null; halo.visible = false; };

  G.updaters.push(['marks', (dt, t) => {
    const playing = g.mode === 'Play' && g.cine === null && g.panel.k === 'None';
    let n = 0;
    // hammer glow
    const hp = g.props.find((p) => !p.dead && p.kind.k === 'Hammer');
    if (hp && hp.ent && !hp.ent.dead && hp.ent.mesh3 && hp.ent.mesh3.geometry) {
      const m = hp.ent.mesh3;
      if (glowOf !== m) {
        dropGlow();
        const geo = m.geometry;
        if (!geo.boundingBox) geo.computeBoundingBox();
        const c = new THREE.Vector3(), sz = new THREE.Vector3();
        geo.boundingBox.getCenter(c); geo.boundingBox.getSize(sz);
        glow = new THREE.Mesh(geo, glowMat);
        glow.userData.keepGeo = true;
        const M = 0.035; // metres of glow rim around the hammer (per axis, like outline.js)
        const kx = 1 + 2 * M / Math.max(sz.x, 0.02), ky = 1 + 2 * M / Math.max(sz.y, 0.02), kz = 1 + 2 * M / Math.max(sz.z, 0.02);
        glow.scale.set(kx, ky, kz);
        glow.position.set(c.x * (1 - kx), c.y * (1 - ky), c.z * (1 - kz));
        glow.renderOrder = -1; glow.frustumCulled = false; glow.castShadow = false;
        m.add(glow);
        glowOf = m;
      }
      const f = 0.85 + 0.15 * Math.sin(t * 3.2);
      glowMat.color.setRGB(2.4 * f, 2.1 * f, 0.25 * f);
      halo.visible = true; halo.position.set(hp.pos.x, 0.012, hp.pos.z); halo.material.opacity = f;
    } else if (glow) dropGlow();

    if (playing) {
      const cam = G.camera;
      const W = window.innerWidth, H = window.innerHeight;
      const me = g.player;
      const put = (cls, x, y, z) => {
        v.set(x, y, z).project(cam);
        if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) return;
        const e = get(n++, cls);
        e.style.transform = `translate3d(${((v.x * 0.5 + 0.5) * W).toFixed(1)}px,${((0.5 - v.y * 0.5) * H).toFixed(1)}px,0)`;
      };
      for (const c of g.customers) {
        if (c.gone || !c.goal || c.goal.k !== 'Buy') continue;
        if (c.state !== 'Walk' && c.state !== 'Look') continue;
        put('buy', c.pos.x, 2.35, c.pos.z);
      }
      for (const z of g.zombies) {
        if (z.dead || z.hp <= 0) continue;
        const d = Math.hypot(z.pos.x - me.x, z.pos.z - me.z);
        const tall = z.kind >= 2 && z.kind !== 4;
        if (z.raid) { if (d > 14) put('q', z.pos.x, tall ? 3.3 : 2.5, z.pos.z); }
        else if (d < 30) put('foe', z.pos.x, tall ? 3.4 : 2.6, z.pos.z);
      }
    }
    for (let i = n; i < pool.length; i++) if (pool[i].style.display !== 'none') pool[i].style.display = 'none';
  }]);
  return { root };
}
