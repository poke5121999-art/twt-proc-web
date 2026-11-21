// Plug-in "glare": the ceiling lamps of the original light a big bright pool on the ceiling around them (PARITY N06,
// ow/shopfloor_1000: one lamp, the whole middle of the ceiling washed white-yellow). Here each of the three room lamps
// of the rules' light table (sim/mat.js ENV.lpos[0..2], they follow the room the player stands in) gets a soft additive
// disc just under the ceiling plus a small bright core over the bulb, scaled by the lamp's strength. View only.
// ?noplug=glare removes it.
import * as THREE from '../../vendor/three.module.min.js';
import { keepAlpha } from '../mats.js';
import * as mat from '../sim/mat.js';

function discTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 1, 64, 64, 63);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export async function install(G) {
  const tex = discTex();
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2); // facing down
  const pools = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.MeshBasicMaterial({ map: tex, color: 0xfff1d0, transparent: true, depthWrite: false, opacity: 0, fog: false });
    m.userData.additive = true; keepAlpha(m);
    const pool = new THREE.Mesh(geo, m); pool.renderOrder = 3; pool.visible = false;
    G.scene.add(pool); pools.push(pool);
  }
  const SIZE = 5.2;
  G.updaters.push(['glare', () => {
    const E = mat.ENV;
    for (let i = 0; i < 3; i++) {
      const p = pools[i], lp = E.lpos[i], lc = E.lcol[i];
      const k = lc ? Math.max(lc[0], lc[1], lc[2]) : 0;
      // only the low room ceilings (shop 3.2 m, rooms); the 6.9 m warehouse roof is out of reach of the pool look
      if (!lp || k < 0.05 || lp[1] > 3.2 || !G.inside) { p.visible = false; continue; }
      p.visible = true;
      p.position.set(lp[0], 3.17, lp[2]);
      const s = SIZE * Math.min(1.25, 0.6 + 0.4 * k);
      p.scale.set(s, 1, s);
      p.material.opacity = Math.min(1.0, 0.4 + 0.8 * k);
      // HDR: a plain 1.0 white is dim next to the day exposure, so the pool is driven above 1 like the lamp itself
      p.material.color.setRGB(1.0, 0.93, 0.78).multiplyScalar(3.0 + 5.0 * k);
    }
  }]);
  return pools;
}
