// Plug-in `fxaudio` (?plug=fxaudio, off with ?noplug=fxaudio): combat feel, effects and sound at Saltline's bar.
// Effects are Saltline's FX pools (js/sl/fx-sl.js) and sound is Saltline's audio engine (js/sl/audio-sl.js), both
// generated from Saltline by Felix Rieseberg (claude.ai artifact BGY1SztrAYcJQHSsnHHGmp); camera recoil and shake use
// Saltline's numbers (recoil hold .09 s, decay 6.5/s, chase 34/s; shake decay 1.7/s, two-sine noise per axis).
// The rules layer (js/sim) is read, never written: its particle bursts (g.fxq -> ctx.parts.burst), shot visuals
// (g.fx2: tracers, casings, rockets, muzzle, decals), fire zones and sound queue (g.sfx -> audio.play) are routed here.
import * as THREE from '../../vendor/three.module.min.js';
import { createSaltlineFx } from '../sl/fx-sl.js';
import { TwtAudio, Bus } from '../audio.js';
import * as audio from '../sim/audio.js';
import * as fxs from '../sim/fx.js';
import * as items from '../sim/items.js';
import * as guns from '../sim/guns.js';
import * as fp from '../sim/fp.js';
import { Vec3 } from '../sim/vec.js';
import * as lay from '../sim/lay.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
// camera recoil (rad) and shake per shot, per weapon class
const FEEL = {
  pistol: [0.0095, 0.09], revolver: [0.016, 0.16], smg: [0.0055, 0.07], rifle: [0.0085, 0.12], shotgun: [0.024, 0.3], sniper: [0.03, 0.34],
  minigun: [0.0035, 0.05], launcher: [0.028, 0.45], bow: [0.004, 0.02], crossbow: [0.01, 0.08], nail: [0.004, 0.03], saw: [0.012, 0.1], flame: [0, 0.01],
};
const CLASS_ROW = { Pistol: 'pistol', Revolver: 'revolver', Smg: 'smg', Shotgun: 'shotgun', Rifle: 'rifle', Sniper: 'sniper', Minigun: 'minigun',
  Launcher: 'launcher', Bow: 'bow', Crossbow: 'crossbow', Nail: 'nail', Saw: 'saw', Flame: 'flame' };
const inBox = (b, x, z, m = 0) => x > b[0] - m && x < b[2] + m && z > b[1] - m && z < b[3] + m;
const BUILDING = [-9.75, -5.25, 5.25, 5.25], WAREHOUSE = [-5.25, -19.2, 15.0, -5.25], LOT = [-23.4, -20.5, 31.1, 40.0];

export async function install(G) {
  const g = G.g, ctx = G.ctx, scene = G.scene;
  const bus = new Bus();
  const stats = { ms: 0, n: 0, msMax: 0, impacts: 0, tracers: 0, shells: 0, flashes: 0, booms: 0, blood: 0, fires: 0, routed: {}, passed: {} };

  // ---- light pool: two flash lights (muzzle, impacts, explosions) and two fire lights; counts never change ------------
  const mk = (c) => { const l = new THREE.PointLight(c, 0, 8, 2); l.layers.enableAll(); scene.add(l); return l; };
  // every extra PointLight costs every lit pixel of the frame, so the pool is small: the game's muzzle light plus one
  // more flash and one fire light (?fxlights=0: only the muzzle light)
  const nl = G.params.fxlights !== undefined ? +G.params.fxlights : 2;
  const flashes = [{ l: G.muzzle || mk(0xffb060), I: 0, t: 0, d: 1 }]; if (nl >= 1) flashes.push({ l: mk(0xffb060), I: 0, t: 0, d: 1 });
  const fireLights = (nl >= 2 ? [mk(0xff8a3a)] : []).map((l) => ({ light: l, used: false }));
  const lightPool = {
    flash(pos, color, intensity, distance, dur) {
      let f = flashes[0];
      for (const c of flashes) if (c.I * c.t / c.d < f.I * f.t / f.d) f = c;
      // a flash right at the lens also lights the first-person gun from 20 cm: half as strong there
      const near = G.camera.position.distanceTo(pos) < 1.5 ? 0.45 : 1;
      f.l.position.copy(pos); f.l.color.set(color); f.l.distance = distance; f.I = intensity * near; f.t = dur; f.d = dur; f.l.intensity = f.I;
      stats.flashes++;
    },
    acquire() {
      const s = fireLights.find((x) => !x.used); if (!s) return null;
      s.used = true; const h = { light: s.light, release() { s.used = false; s.light.intensity = 0; } }; return h;
    },
  };

  // ---- Saltline FX pools -------------------------------------------------------------------------------------------
  const surfaceAt = (x, z) => inBox(BUILDING, x, z) ? 'wood' : inBox(WAREHOUSE, x, z) || inBox(LOT, x, z) ? 'concrete' : 'dirt';
  const physics = {
    // down rays find the floor (y 0) and its surface; other rays (sun shading of smoke) hit the roof inside buildings
    raycast(o, d, max) {
      if (d.y < -0.5) return { point: V(o.x, 0, o.z), surface: surfaceAt(o.x, o.z) };
      const inside = (inBox(BUILDING, o.x, o.z) && o.y < 3.25) || (inBox(WAREHOUSE, o.x, o.z) && o.y < 6.9);
      return inside ? { point: V(o.x, 3.25, o.z) } : null;
    },
  };
  const fxShim = {
    scene, events: bus, params: G.params, physics,
    get camera() { return G.camera; },
    render: { lightPool },
    ground: { isPuddle: () => false },
    mats: { get: () => null },
    player: { get pos() { return V(g.player.x, g.player.y, g.player.z); } },
  };
  const fx = await createSaltlineFx(fxShim);
  const fxLit = fx.root.children.find((m) => m.name === 'fx_lit');
  const lit0 = fxLit ? { amb: fxLit.material.uniforms.uAmbHi.value.clone(), lo: fxLit.material.uniforms.uAmbLo.value.clone() } : null;

  // ---- sound: Saltline engine + the game's synth on one context, installed as the rules' audio engine --------------
  const snd = new TwtAudio(G, { bus, mods: { items, guns }, silent: audio.is_disabled() || !!G.params.noaudio });
  try { await snd.start(); } catch (e) { console.error('[fxaudio] audio failed, running silent: ' + (e && e.stack || e)); snd.silent = true; snd.sl = null; }
  audio.install(snd);
  window.__twtEnter = () => { try { snd.ensure(); } catch (e) { /* ignore */ } };

  // ---- extra meshes the hidden 'dynamic' node used to draw: rockets, arrows, saw discs, lure ball, blood decals -----
  const metal = new THREE.MeshStandardMaterial({ color: 0x8a8f86, roughness: 0.45, metalness: 0.6 });
  const red = new THREE.MeshStandardMaterial({ color: 0xb0342a, roughness: 0.5, metalness: 0.2 });
  const flameM = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.2, 1.0), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.7 });
  const pool = (n, make) => { const a = []; for (let i = 0; i < n; i++) { const o = make(); o.visible = false; scene.add(o); a.push(o); } return a; };
  const rockets = pool(4, () => {
    const gr = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.4, 10), metal); body.rotation.x = Math.PI / 2; gr.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 10), red); nose.rotation.x = -Math.PI / 2; nose.position.z = -0.26; gr.add(nose);
    const fl = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.3, 8, 1, true), flameM); fl.rotation.x = Math.PI / 2; fl.position.z = 0.35; gr.add(fl); gr.userData.fl = fl;
    return gr;
  });
  const arrows = pool(8, () => {
    const gr = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.56, 5), wood); shaft.rotation.x = Math.PI / 2; gr.add(shaft);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.04, 6), metal); head.rotation.x = -Math.PI / 2; head.position.z = -0.3; gr.add(head);
    return gr;
  });
  const discs = pool(4, () => new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.004, 24), metal));
  const lure = pool(1, () => new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.5, 0.35) })))[0];
  const bloodTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d");
    let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 9; i++) { // an irregular pool from overlapping blobs...
      const a = r() * 6.28, d = r() * 22, rr = 7 + r() * 16, cx = 64 + Math.cos(a) * d, cy = 64 + Math.sin(a) * d;
      const gr = x.createRadialGradient(cx, cy, 0, cx, cy, rr); gr.addColorStop(0, 'rgba(38,3,2,0.92)'); gr.addColorStop(0.75, 'rgba(30,2,2,0.85)'); gr.addColorStop(1, 'rgba(24,1,1,0)');
      x.fillStyle = gr; x.beginPath(); x.arc(cx, cy, rr, 0, 6.29); x.fill();
    }
    for (let i = 0; i < 46; i++) { // ...and flung droplets, elongated away from the centre
      const a = r() * 6.28, d = 26 + r() * 34, rr = 0.8 + r() * 3.2;
      x.save(); x.translate(64 + Math.cos(a) * d, 64 + Math.sin(a) * d); x.rotate(a); x.scale(1 + r() * 1.8, 1);
      x.fillStyle = 'rgba(34,2,2,' + (0.55 + r() * 0.4).toFixed(2) + ')'; x.beginPath(); x.arc(0, 0, rr, 0, 6.29); x.fill(); x.restore();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const NBLOOD = 64;
  const bloodMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: bloodTex, transparent: true, depthWrite: false, roughness: 0.18, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), NBLOOD);
  bloodMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); bloodMesh.frustumCulled = false; bloodMesh.renderOrder = -4; bloodMesh.receiveShadow = true; bloodMesh.name = 'fx_blood';
  scene.add(bloodMesh);
  // Twin Terrors (gốc clip 13 19:00-19:20): quầng sáng tím (Buff) và xanh lá (Healer) phủ mặt đất quanh từng con
  const auraTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    const gr = x.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); return t;
  })();
  const auras = [0xa040ff, 0x30ff60].map((col) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: auraTex, color: col, transparent: true, opacity: 1.0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    m.material.color.multiplyScalar(1.8); m.material.fog = false;
    m.visible = false; m.renderOrder = 5; m.frustumCulled = false; scene.add(m); return m;
  });
  // vệt máu dẹt dài bay toả (gốc clip 04 34:12, c01 5:44:56): hộp mỏng kéo dài theo hướng bay, rơi theo trọng lực
  const streakGeo = new THREE.BoxGeometry(1, 1, 1), streakMat = new THREE.MeshBasicMaterial({ color: 0xb00a0e });
  const streaks = [];
  for (let k = 0; k < 72; k++) { const m = new THREE.Mesh(streakGeo, streakMat); m.visible = false; m.frustumCulled = false; scene.add(m); streaks.push({ m, p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, max: 1, len: 0.3, w: 0.06 }); }
  let streakI = 0;
  // Lựu đạn / bom đinh nổ (gốc clip 19 21:12-21:14): từng cụm khối đa giác cứng mặt phẳng, vàng ở ngoài, trắng ở giữa,
  // các khối rời nhau thấy rõ cạnh (không phải một đám khói mềm); nở nhanh, đứng ~1 s, co lại biến mất.
  const puffGeo = (() => {
    const gg = new THREE.IcosahedronGeometry(1, 0).toNonIndexed();
    const n = gg.attributes.position.count, col = new Float32Array(n * 3);
    for (let f = 0; f < n; f += 3) { const k = 0.72 + 0.28 * ((f * 7919) % 13) / 12; for (let j = 0; j < 3; j++) col.set([k, k, k], (f + j) * 3); }
    gg.setAttribute('color', new THREE.BufferAttribute(col, 3)); return gg;
  })();
  // đợt 7: raid tối nên phơi sáng tự chỉnh nâng cao, màu sáng vào vai tone map AgX bị bạc thành kem (gr7, cả khi tắt sương);
  // màu vào thấp để ra vàng đậm như gốc, chỉ lõi trắng sáng
  // gốc đo HSV ~(0,17; 0,5; 0,9) (clip 19 g036, g066): vàng chanh, G ~ R
  const puffMats = [[0.7, 0.72, 0.0], [0.8, 0.8, 0.06], [1.1, 1.1, 0.95]].map((c) => { const m = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false }); m.color.setRGB(c[0], c[1], c[2]); return m; }); // đợt 7: sương raid làm cụm ngả kem nhạt ở ~15 m (gr7-*.png), gốc vàng đậm
  G.fxPuffMats = puffMats; // chỉ để chụp thử màu (cmp/parity/_tools/pc-n.json)
  const puffs = [];
  for (let k = 0; k < 64; k++) { const m = new THREE.Mesh(puffGeo, puffMats[0]); m.visible = false; m.frustumCulled = false; scene.add(m); puffs.push({ m, p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0, life: 0, r: 0.5, spin: new THREE.Vector3() }); }
  let puffI = 0;
  // đợt 7 (clip 19 21:11-21:15.5, tờ 10 khung/giây g7/): cụm gốc to hơn ~20 % và giữ vàng đậm lõi trắng >= 3,5 s tới khi
  // camera quay đi (21:12.5 và 21:15.5 cùng màu); trước ta 1,5-2,1 s, co lại từ 55 % đời nên ~0,3 s sau đã ngả nhạt / nhỏ đi.
  const PUFF_SCALE = 1.2;
  const addPuffCluster = (at, size0) => {
    const n = 14, size = size0 * PUFF_SCALE;
    for (let k = 0; k < n; k++) {
      const q = puffs[puffI++ % puffs.length];
      const core = k < 4, a = Math.random() * 6.283, rr = (core ? 0.2 + Math.random() * 0.3 : 0.7 + Math.random() * 0.8) * size;
      q.p.set(at.x + Math.cos(a) * rr, at.y + (core ? 0.6 : 0.3 + Math.random() * 1.3) * size, at.z + Math.sin(a) * rr);
      q.v.set(Math.cos(a) * (0.25 + Math.random() * 0.3), 0.25 + Math.random() * 0.25, Math.sin(a) * (0.25 + Math.random() * 0.3));
      q.r = (core ? 0.62 + Math.random() * 0.15 : 0.5 + Math.random() * 0.3) * size;
      q.age = 0; q.life = 3.4 + Math.random() * 0.8;
      q.m.material = puffMats[core ? 2 : k < 7 ? 1 : 0];
      q.m.rotation.set(Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3);
      q.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
      q.m.visible = true;
    }
  };
  const tickPuffs = (dt) => {
    for (const q of puffs) {
      if (!q.m.visible) continue;
      q.age += dt;
      if (q.age >= q.life) { q.m.visible = false; continue; }
      q.p.addScaledVector(q.v, dt); q.v.multiplyScalar(Math.max(0, 1 - 1.5 * dt));
      const grow = Math.min(1, q.age / 0.12), shrink = 1 - Math.max(0, (q.age - q.life * 0.8) / (q.life * 0.2));
      const k = q.r * grow * Math.max(0, shrink);
      q.m.position.copy(q.p); q.m.scale.setScalar(Math.max(k, 1e-3));
      q.m.rotation.x += q.spin.x * dt; q.m.rotation.y += q.spin.y * dt;
    }
  };
  // Vệt quét trắng khi vung tay ném (gốc clip 19 21:10): một dải trắng đặc hình lưỡi liềm ngay trước mặt, từ giữa dưới
  // (đầu nhọn, ~50 %, 69 % màn) cong lên sang phải (đầu dày ~5 % chiều cao màn, ~67 %, 58 %), mép trên lồi; hiện ~0,25 s.
  const SW_N = 20;
  const swMat = new THREE.MeshBasicMaterial({ color: 0xf6f6f2, vertexColors: true, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
  const swGeo = new THREE.BufferGeometry();
  swGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SW_N * 2 * 3), 3));
  swGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SW_N * 2 * 4), 4));
  { const idx = []; for (let k = 0; k < SW_N - 1; k++) { const q = k * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); } swGeo.setIndex(idx); }
  const swoosh = new THREE.Mesh(swGeo, swMat); swoosh.frustumCulled = false; swoosh.renderOrder = 20; swoosh.visible = false; scene.add(swoosh);
  const SW_LIFE = 0.25;
  let swT = -1, lastProjs = 0;
  const swP = new THREE.Vector3();
  const tickTrails = (dt) => {
    const np = g.cb.projs.length;
    if (np > lastProjs) swT = 0; // a throw just left the hand
    lastProjs = np;
    if (swT < 0) { swoosh.visible = false; return; }
    swT += dt;
    if (swT > SW_LIFE) { swT = -1; swoosh.visible = false; return; }
    const cam = G.camera, d = 0.6, th = Math.tan((cam.fov || 68) * Math.PI / 360) * d, asp = cam.aspect || 16 / 9;
    const toWorld = (sx, sy) => swP.set((sx * 2 - 1) * th * asp, (1 - sy * 2) * th, -d).applyMatrix4(cam.matrixWorld);
    const pos = swGeo.attributes.position, col = swGeo.attributes.color;
    const u = swT / SW_LIFE, grow = Math.min(1, swT / 0.06), al = 1 - Math.max(0, (u - 0.35) / 0.65);
    for (let k = 0; k < SW_N; k++) {
      const t = (k / (SW_N - 1)) * grow, it = 1 - t;
      // quadratic Bézier A (0.50, 0.69) -> control (0.53, 0.56) -> B (0.667, 0.585), screen fractions
      const cx = it * it * 0.5 + 2 * it * t * 0.53 + t * t * 0.667, cy = it * it * 0.69 + 2 * it * t * 0.56 + t * t * 0.585;
      const tx = 2 * it * (0.53 - 0.5) + 2 * t * (0.667 - 0.53), ty = 2 * it * (0.56 - 0.69) + 2 * t * (0.585 - 0.56);
      const tl = Math.hypot(tx * asp, ty) || 1, nx = -ty / tl, ny = tx * asp / tl;
      const w = (0.002 + 0.026 * Math.pow(t, 1.4)) ;
      const p0 = toWorld(cx + nx * w / asp, cy + ny * w); pos.setXYZ(k * 2, p0.x, p0.y, p0.z);
      const p1 = toWorld(cx - nx * w / asp, cy - ny * w); pos.setXYZ(k * 2 + 1, p1.x, p1.y, p1.z);
      const a2 = al * (0.55 + 0.45 * t);
      col.setXYZW(k * 2, 1, 1, 1, a2); col.setXYZW(k * 2 + 1, 1, 1, 1, a2);
    }
    pos.needsUpdate = true; col.needsUpdate = true;
    swoosh.visible = true;
  };
  const addStreaks = (P, dir, n) => {
    for (let k = 0; k < n; k++) {
      const s = streaks[streakI++ % streaks.length];
      s.p.copy(P);
      s.v.set(dir.x + (Math.random() - 0.5) * 2.4, dir.y + 0.4 + (Math.random() - 0.3) * 1.6, dir.z + (Math.random() - 0.5) * 2.4).normalize().multiplyScalar(3 + Math.random() * 5);
      s.life = s.max = 0.35 + Math.random() * 0.35; s.len = 0.22 + Math.random() * 0.4; s.w = 0.045 + Math.random() * 0.05;
      s.m.visible = true;
    }
  };
  const tickStreaks = (dt) => {
    for (const s of streaks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { s.m.visible = false; continue; }
      s.v.y -= 9.8 * dt; s.p.addScaledVector(s.v, dt);
      if (s.p.y < 0.02) { s.p.y = 0.02; s.v.set(0, 0, 0); }
      const k = Math.min(1, s.life / (s.max * 0.4));
      s.m.position.copy(s.p);
      if (s.v.lengthSq() > 1e-4) s.m.lookAt(tmpS.copy(s.p).add(s.v));
      s.m.scale.set(s.w * k, 0.012, s.len * (0.4 + 0.6 * Math.min(1, s.v.length() / 5)) * k);
    }
  };
  const tmpS = new THREE.Vector3();
  // chế tạo (gốc c01 4:03:00): chùm sáng xanh lơ rọi từ trên xuống bàn, chớp trắng mỗi nhát búa
  const rayTex = (() => { const c = document.createElement('canvas'); c.width = 4; c.height = 64; const x = c.getContext('2d'); const gr = x.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, 'rgba(255,255,255,0.8)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.95)'); gr.addColorStop(1, 'rgba(255,255,255,1)'); x.fillStyle = gr; x.fillRect(0, 0, 4, 64); const t = new THREE.CanvasTexture(c); return t; })();
  // gốc c01 4:03:00: chùm xanh lơ đậm gần như đặc, sáng nhất ở lõi; lõi trắng xanh hẹp bên trong
  const rays = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.06, 2.4, 14, 1, true), new THREE.MeshBasicMaterial({ map: rayTex, color: 0x30f4ff, transparent: true, opacity: 0.97, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  // gốc đo (131, 255, 252) trong chùm: chùm gần như đặc (màu quá 1 thì hậu kỳ đẩy thành trắng nhạt)
  rays.material.color.setRGB(0.12, 1.06, 1.1); // đo mép chùm: gốc (150, 255, 249); 0x30f4ff ra (95, 196, 192); (0.3, 1.2, 1.25) ra (158, 209, 200) bạc màu; 1,6 thì trắng
  rays.material.fog = false; rays.visible = false; rays.renderOrder = 6; scene.add(rays);
  const rayCore = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.03, 2.4, 12, 1, true), new THREE.MeshBasicMaterial({ map: rayTex, color: 0xa8fbff, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  rayCore.material.fog = false; rayCore.renderOrder = 7; rays.add(rayCore);
  let craftTap = 0;
  const tickCraft = (dt) => {
    const job = g.craft_job, wb = lay.WORKBENCH;
    const on = !!job && g.panel.k === 'None' && !!wb && Math.hypot(g.player.x - wb.x, g.player.z - wb.z) < 3.5;
    rays.visible = on;
    if (!on) { craftTap = 0; return; }
    rays.position.set(wb.x, 0.95 + 1.2, wb.z); rays.rotation.y += dt * 0.6;
    craftTap -= dt;
    if (craftTap <= 0) { craftTap = 0.55; const at = V(wb.x, 1.0, wb.z); fx.sparks(at, UP, 14); }
  };
  const bloods = []; // { x, z, r, life, max, rot, src }
  const addBlood = (x, z, r, life, src) => { if (bloods.length >= NBLOOD) bloods.shift(); bloods.push({ x, z, r, life, max: life, rot: Math.random() * 6.28, src: src || null }); };

  // ---- routing the rules' particle bursts --------------------------------------------------------------------------
  const tracerReg = new Map();   // sim tracer object -> { a, b, kind, fx, seen }
  const cbTracerSeen = new WeakSet();
  const booms = [];              // { p, t }
  const zHp = new Map();
  let frameBlood = 0;
  const eye = () => V(G.camera.position.x, G.camera.position.y, G.camera.position.z);
  const viewDir = () => G.camera.getWorldDirection(V());
  const nearBoom = (at, r = 2.5) => booms.some((b) => G.t - b.t < 0.25 && b.p.distanceTo(at) < r);
  const wallNormal = (dir) => (Math.abs(dir.x) > Math.abs(dir.z) ? V(-Math.sign(dir.x), 0, 0) : V(0, 0, -Math.sign(dir.z)));
  const curClass = () => {
    try { const w = g.cur_w ? g.cur_w() : null; if (w && items.gun(w.item) !== null) return CLASS_ROW[guns.class(w.item)] || 'rifle'; } catch (e) { /* none */ }
    return null;
  };
  // The rules' bullet ray ignores the shop's closed doors and the window boards, so a shot at the front can end on a
  // wall inside. The visible hit is where the segment first enters the building's outer box from outside.
  const SHELLS = [[...BUILDING, 3.3, 'wood'], [...WAREHOUSE, 6.9, 'concrete']];
  const clipSeg = (a, b) => {
    let best = null;
    for (const [x0, z0, x1, z1, h, surf] of SHELLS) {
      if (a.x > x0 && a.x < x1 && a.z > z0 && a.z < z1 && a.y < h) continue; // starts inside: the rules' ray is right
      const d = V(b.x - a.x, b.y - a.y, b.z - a.z); let tn = 0, tf = 1, nrm = null;
      for (const [ax, lo, hi] of [['x', x0, x1], ['y', -1, h], ['z', z0, z1]]) {
        const o = a[ax], dd = d[ax];
        if (Math.abs(dd) < 1e-9) { if (o < lo || o > hi) { tn = 2; break; } continue; }
        let t1 = (lo - o) / dd, t2 = (hi - o) / dd, sgn = -1;
        if (t1 > t2) { [t1, t2] = [t2, t1]; sgn = 1; }
        if (t1 > tn) { tn = t1; nrm = V(ax === 'x' ? sgn : 0, ax === 'y' ? sgn : 0, ax === 'z' ? sgn : 0); }
        tf = Math.min(tf, t2);
      }
      if (nrm && tn <= tf && tn > 0 && tn < 1 && (!best || tn < best.t)) {
        const p = a.clone().addScaledVector(d, tn);
        // shop: the front doors and the boarded windows are wood, the rest of the shell is brick
        const woodFront = surf === 'wood' && nrm.z > 0.5 && (Math.abs(p.x) < 1.05 || (p.y > 1.0 && p.y < 2.3 && ((p.x > -6.6 && p.x < -2.4) || (p.x > 2.0 && p.x < 4.6))));
        best = { t: tn, p, n: nrm, surf: nrm.y > 0.5 ? 'concrete' : woodFront ? 'wood' : surf === 'wood' ? 'concrete' : surf };
      }
    }
    return best;
  };
  // The rules resolve bullets and melee against XZ collider boxes 3.2 m tall. A shelf is an open frame inside its box, so
  // a hit on its box face is often empty air: a decal there floats (owner screenshot 2026-11-16). Hits on a shelf box get
  // chips and the sound but no decal; real surfaces found by the shell clip (normal given) are untouched.
  const onShelf = (P) => {
    for (const sh of g.shelves || []) {
      const dx = P.x - sh.pos.x, dz = P.z - sh.pos.z, c = Math.cos(sh.yaw), s = Math.sin(sh.yaw);
      const lx = dx * c - dz * s, lz = dx * s + dz * c, half = sh.cols * 0.3 + 0.35;
      if (Math.abs(lx) < half && Math.abs(lz) < 0.7 && P.y < 2.6) return true;
    }
    return false;
  };
  // Player-built objects (g.props Placed / Wire) are not in the rules' bullet ray at all, so a bullet flew through them and
  // marked the wall or the ground behind. The visible bullet now stops on the first built mesh it really crosses: chips or
  // sparks and the sound there, never a decal (built things are open frames, thin planks, or get picked up / destroyed, so
  // a mark would hang in the air). Through the gaps of a frame the bullet goes on to the real surface behind as before.
  const METAL_BUILT = new Set([175, 176, 188, 162, 219, 130, 9]); // secure shelf / table, special unit, fridge, rack, turret, auto minigun
  const rc = new THREE.Raycaster(), _bA = V(), _bD = V(), _bN = V(), _bBox = new THREE.Box3();
  const builtHit = (a, b) => {
    _bD.subVectors(b, a); const len = _bD.length(); if (len < 0.1) return null; _bD.divideScalar(len);
    const objs = [], who = new Map();
    for (const q of g.props) {
      if (q.dead || !q.ent || !q.ent.obj || !(q.kind.k === 'Placed' || q.kind.k === 'Wire')) continue;
      // segment vs the prop's rough bounds (3 m around its foot) before any triangle test
      const qx = q.pos.x, qz = q.pos.z, t = clamp((qx - a.x) * _bD.x + (qz - a.z) * _bD.z, 0, len) / Math.max(Math.hypot(_bD.x, _bD.z), 1e-6);
      if (Math.hypot(a.x + _bD.x * t - qx, a.z + _bD.z * t - qz) > 3) continue;
      if (!q.ent.obj.visible) continue;
      objs.push(q.ent.obj); who.set(q.ent.obj, q);
    }
    if (!objs.length) return null;
    rc.set(_bA.copy(a), _bD); rc.near = 0.05; rc.far = len - 0.03;
    const hits = rc.intersectObjects(objs, true);
    for (const h of hits) {
      if (!h.face) continue;
      let o = h.object; while (o && !who.has(o)) o = o.parent;
      if (!o) continue;
      const q = who.get(o);
      _bN.copy(h.face.normal).transformDirection(h.object.matrixWorld);
      if (_bN.dot(_bD) > 0) _bN.negate();
      return { p: h.point.clone(), n: _bN.clone(), metal: q.kind.k === 'Wire' || METAL_BUILT.has(q.kind.a), prop: q.id };
    }
    return null;
  };
  const builtImpact = (bh, dir) => {
    stats.impacts++; stats.built = (stats.built || 0) + 1;
    if (bh.metal) {
      fx.sparks(bh.p, bh.n, 6);
      if (snd.sl) snd.sl_play('impact_metal', { pos: bh.p, gain: 0.5, pitch: 1.0, jitter: 0.12 });
    } else {
      fx.debris(bh.p, { color: [0.42, 0.3, 0.2], count: 6, size: 0.03, speed: 2.5, normal: bh.n });
      fx.dust(bh.p, bh.n, 0.18, 0.45, 0.38, 0.3);
      if (snd.sl) snd.sl_play('impact_wood', { pos: bh.p, gain: 0.5, pitch: 1.0, jitter: 0.1 });
    }
  };
  const worldImpact = (P, dir, surface, normal) => {
    stats.impacts++;
    if (!normal && P.y > 0.08 && G.params.decalfix !== '0' && onShelf(P)) {
      stats.noDecal = (stats.noDecal || 0) + 1;
      fx.debris(P, { color: [0.42, 0.3, 0.2], count: 5, size: 0.03, speed: 2.5, normal: dir.clone().negate() });
      if (snd.sl) snd.sl_play('impact_wood', { pos: P, gain: 0.5, pitch: 1.0, jitter: 0.1 });
      return;
    }
    bus.emit('impact', { point: P, normal: normal || (P.y < 0.08 ? UP.clone() : wallNormal(dir)), dir, surface, enemy: false, from: 'player' });
  };
  const flesh = (P, dir) => {
    stats.blood++; frameBlood++;
    const n = dir.clone().negate();
    // gốc (c01 5:44:56, clip 04 34:12, clip 05 16:00): bung một chùm mảnh đỏ tươi to, phẳng, bay toả rộng quanh chỗ trúng
    // vệt gốc to cỡ nửa đầu zombie, phủ quanh cả thân khi đánh sát (clip 04 34:12): mảnh to + mảnh nhỏ bay xa + đám sương đỏ to
    addStreaks(P, n, 16);
    fx.debris(P, { color: [0.72, 0.03, 0.04], count: 14, size: 0.035, speed: 7.5, normal: n, spread: 1.7 });
    fx.smoke(P, { color: [0.62, 0.03, 0.04], size: 1.0, count: 5, life: 0.6, rise: 0.05, alpha: 0.75, vel: dir.clone().multiplyScalar(0.8) });
    if (snd.sl) { snd.sl_play('impact_water', { pos: P, gain: 0.45, pitch: 0.62, jitter: 0.1 }); snd.sl_play('impact_wood', { pos: P, gain: 0.5, pitch: 0.48, jitter: 0.08 }); }
    addBlood(P.x + dir.x * 0.5, P.z + dir.z * 0.5, 0.2 + Math.random() * 0.16, 18);
  };
  const humanNear = (at) => {
    if (Math.hypot(g.player.x - at.x, g.player.z - at.z) < 1.0) return true;
    for (const s of g.staff || []) if (s.hired && !s.gone && !s.away && s.pos && Math.hypot(s.pos.x - at.x, s.pos.z - at.z) < 1.6) return true;
    for (const c of g.customers || []) if (c.pos && Math.hypot(c.pos.x - at.x, c.pos.z - at.z) < 1.2) return true;
    return false;
  };
  const zombieHurtNear = (at) => {
    for (const z of g.zombies) {
      if (Math.hypot(z.pos.x - at.x, z.pos.z - at.z) > 1.6) continue;
      const h0 = zHp.get(z); if (h0 === undefined || z.hp < h0 - 1e-6 || z.dead) return true;
    }
    return false;
  };
  // flamethrower: the rules light zombies in an 8 m cone every few frames; the jet is Saltline flash sprites along it
  let flameUntil = -1;
  const flameJet = () => {
    const c = eye(), dir = viewDir();
    let m = c.clone().addScaledVector(dir, 0.6);
    try { const w = g.cur_w(); const mp = fp.muzzle_pos(w.item, new Vec3(c.x, c.y, c.z), new Vec3(dir.x, dir.y, dir.z)); m = V(mp.x, mp.y, mp.z); } catch (e) { /* eye fallback */ }
    const col = [1, 0.42, 0.1];
    if (Math.random() < 0.6) fx.sparks(m.clone().addScaledVector(dir, 0.3), dir, 3); // burning droplets thrown along the jet
    for (const [s, k] of [[0.05, 0.32], [1.1, 0.9], [2.5, 1.5], [4.2, 2.1]]) {
      const p = m.clone().addScaledVector(dir, s + Math.random() * 0.5); p.y -= s * s * 0.022; // the fuel arcs down
      fx.muzzleFlash(p, dir, { scale: k * (0.75 + Math.random() * 0.5), color: col });
    }
    if (Math.random() < 0.12) fx.addEmitter(m.clone().addScaledVector(dir, 5.5 + Math.random()).setY(0.1), 'fire', { ttl: 0.4, scale: 0.9 });
    if (Math.random() < 0.06) fx.smoke(m.clone().addScaledVector(dir, 5), { size: 0.8, count: 1, life: 2, color: [0.12, 0.11, 0.1], alpha: 0.4, rise: 1 });
  };
  const route = (k, a) => {
    const at = V(a.x, a.y, a.z);
    // a tracer the player fired that just arrived: bullet impact by surface
    if (k === fxs.FX_DUST || k === fxs.FX_SPARK || k === fxs.FX_DEBRIS) {
      for (const [t, r] of tracerReg) {
        if (r.b.distanceToSquared(at) < 1e-6) {
          tracerReg.delete(t);
          const dir = r.b.clone().sub(r.a).normalize();
          if (r.built) { builtImpact(r.built, dir); return true; }
          if (r.clip) { worldImpact(r.clip.p, dir, r.clip.surf, r.clip.n); return true; }
          const surf = k === fxs.FX_DUST ? surfaceAt(at.x, at.z) : k === fxs.FX_DEBRIS ? 'wood' : (inBox(BUILDING, at.x, at.z, 0.5) || inBox(WAREHOUSE, at.x, at.z, 0.5) ? 'concrete' : 'metal');
          worldImpact(at, dir, surf);
          return true;
        }
      }
      for (const tr of g.cb.tracers) {
        const b = tr[1];
        if (Math.abs(b.x - at.x) + Math.abs(b.y - at.y) + Math.abs(b.z - at.z) < 1e-4) {
          if (!cbTracerSeen.has(tr)) { cbTracerSeen.add(tr); fx.tracer(V(tr[0].x, tr[0].y, tr[0].z), at, { speed: 300 }); stats.tracers++; }
          worldImpact(at, at.clone().sub(V(tr[0].x, tr[0].y, tr[0].z)).normalize(), 'metal');
          return true;
        }
      }
    }
    switch (k) {
      case fxs.FX_BLOOD: {
        if (humanNear(at) && !zombieHurtNear(at)) { fx.dust(at, UP, 0.35, 0.36, 0.34, 0.31); return true; } // a human hurt: no gore
        flesh(at, viewDir()); return true;
      }
      case fxs.FX_PUFF: return true; // Saltline's muzzle flash carries its own smoke puff
      case fxs.FX_BOOM: {
        let size = 1.2;
        for (const r of g.fx2.rings) if (r[2] < 0.05 && Math.hypot(r[0].x - at.x, r[0].z - at.z) < 2) size = clamp(r[1] / 3.4, 0.6, 2.2);
        booms.push({ p: at.clone(), t: G.t }); stats.booms++;
        // gốc không có lõi lửa cam: quả cầu lửa vàng xanh, lõi trắng mờ đi (fx-sl K: O.fire, O.core)
        const yi = fxs.YELLOW_BOOMS.findIndex((p) => Math.hypot(p.x - at.x, p.y - at.y, p.z - at.z) < 0.6);
        fx.explosion(at, size, { fire: [1.9, 1.8, 0.3], core: 0.15, nosmoke: yi >= 0, nofire: yi >= 0 }); // emits 'explosion' on the bus: Saltline's explosion sound, camera shake
        if (yi >= 0) {
          // lựu đạn / bom đinh gốc (clip 19 21:12-21:14): vài cụm khói đa giác vàng lõi trắng to, ở lâu ~2 s, không khói xám xanh
          fxs.YELLOW_BOOMS.splice(yi, 1);
          // đợt 6: khối đa giác cứng rời nhau thay đám khói mềm (sprite khói của fx-sl hoà các khối thành một khối)
          addPuffCluster(at, size);
          for (const col of [[1, 0.8, 0.2], [1, 0.95, 0.5], [1, 0.55, 0.15]]) fx.debris(at, { color: col, count: 8, size: 0.035, speed: 6, normal: UP, spread: 1.2 });
          return true;
        }
        // gốc (c01 6:54:50, 6:55:17): khối khói đa giác vàng to + khói xanh xám, chùm hạt nhiều màu bay toả
        fx.smoke(at.clone().setY(at.y + 0.6), { color: [0.92, 0.86, 0.2], size: 3.4 * size, count: 10, life: 1.4, rise: 0.6, alpha: 1.0 });
        fx.smoke(at.clone().setY(at.y + 0.9), { color: [0.42, 0.5, 0.6], size: 2.6 * size, count: 6, life: 2.4, rise: 0.4, alpha: 0.7 });
        // khói xám xanh rời từng cụm quanh và trên vụ nổ, thấy ngay từ đầu (gốc c01 6:54:50)
        for (let k = 0; k < 6; k++) { const a = k * 1.05 + Math.random() * 0.5, r = (1.2 + Math.random() * 1.2) * size; fx.smoke(V(at.x + Math.cos(a) * r, at.y + 0.6 + Math.random() * 1.8 * size, at.z + Math.sin(a) * r), { color: [0.22, 0.4, 0.78], size: 2.2 * size, count: 2, life: 2.2, rise: 0.35, alpha: 1.0 }); }
        for (const col of [[1, 0.25, 0.3], [0.3, 1, 0.4], [0.35, 0.6, 1], [1, 0.95, 0.4], [1, 1, 1]]) fx.debris(at, { color: col, count: 10, size: 0.035, speed: 7, normal: UP, spread: 1.4 });
        return true;
      }
      case fxs.FX_TRAIL: if (!nearBoom(at, 3)) fx.smoke(at, { size: 0.45, count: 1, life: 1.8, alpha: 0.32, rise: 0.25 }); return true;
      case fxs.FX_SMOKE: fx.smoke(at, { size: 0.9, count: 4, life: 2.4, color: [0.22, 0.22, 0.22], alpha: 0.45 }); return true;
      case fxs.FX_SPARK: {
        for (const f of g.cb.fires) if (Math.hypot(f[0].x - at.x, f[0].z - at.z) < f[1] + 0.5 && at.y < 0.5) return true; // fire zones burn as emitters
        const c = eye(); const d = at.distanceTo(c);
        if (curClass() === 'flame' && d > 2.2 && d < 2.8) { flameUntil = G.t + 0.3; return true; } // the jet is drawn every frame
        for (const z of g.zombies) if (z.burn > 0 && Math.hypot(z.pos.x - at.x, z.pos.z - at.z) < 0.3) { fx.addEmitter(at, 'fire', { ttl: 0.3, scale: 0.45 }); return true; }
        fx.sparks(at, UP, 10); return true;
      }
      case fxs.FX_DEBRIS: {
        if (nearBoom(at)) return true;
        fx.debris(at, { color: [0.42, 0.3, 0.2], count: 8, size: 0.05, speed: 4, normal: UP });
        fx.dust(at, UP, 0.6, 0.45, 0.41, 0.36); return true;
      }
      case fxs.FX_DUST: {
        if (nearBoom(at)) return true;
        const c = eye(), dir = viewDir(), rel = at.clone().sub(c), t = rel.dot(dir);
        if (t > 0.3 && rel.clone().addScaledVector(dir, -t).length() < 0.35) { worldImpact(at, dir, surfaceAt(at.x, at.z)); return true; } // a bullet that arrived the frame it was fired
        if (at.distanceTo(c) < 2.2 && curClass() === 'launcher') { fx.smoke(at, { size: 0.9, count: 4, life: 1.6, alpha: 0.4 }); return true; } // back-blast
        fx.dust(at, UP, 0.5, 0.45, 0.42, 0.37); return true;
      }
    }
    return false;
  };
  const parts = ctx.parts;
  if (parts && parts.burst) {
    const orig = parts.burst.bind(parts);
    parts.burst = (k, at, amb) => {
      let done = false;
      try { done = route(k, at); } catch (e) { console.error('[fxaudio] route ' + k + ' threw: ' + (e && e.stack || e)); }
      (done ? stats.routed : stats.passed)[k] = ((done ? stats.routed : stats.passed)[k] || 0) + 1;
      if (!done) orig(k, at, amb);
    };
  }

  // ---- camera feel (visual only: applied after main.js set the camera from the rules, never fed back) ----------------
  const cam = { x: 0, y: 0, b: 0, m: 0, hold: 0, shake: 0, T: 0, burst: 0, lastShot: -9, phase: Math.random() * 6 };
  const addRecoil = (pitch, yaw) => { cam.x = clamp(cam.x + pitch * 0.65, -0.3, 0.3); cam.y = clamp(cam.y + yaw * 0.65, -0.2, 0.2); cam.hold = 0.09; };
  const addShake = (a) => { cam.shake = Math.min(1, cam.shake + a); };
  // [par-panels] Settings > Vibration Combat Strength: gamepad rumble on explosions, hits taken and own shots
  const rumble = (a, ms) => { if (G.rumble) G.rumble('combat', a, ms); };
  bus.on('explosion', (e) => {
    snd.lastBoom = snd.now();
    const p = e.pos; if (!p) { addShake(0.4); rumble(0.6, 300); return; }
    const d = Math.hypot(p.x - G.camera.position.x, p.y - G.camera.position.y, p.z - G.camera.position.z), s = e.size || 1;
    const k = clamp(1 - d / (14 + s * 10), 0, 1) * (0.35 + 0.35 * s);
    addShake(k); if (k > 0.02) rumble(Math.min(1, k * 1.4), 320);
  });
  const qE = new THREE.Quaternion(), eE = new THREE.Euler(0, 0, 0, 'YXZ');

  // ---- thunder: Saltline thunder buffers plus a sky flash ---------------------------------------------------------
  let lightning = 0, lightningDelay = 0;
  snd.onThunder = () => { lightningDelay = 0.05; };
  snd.onStep = (surface, sprint, wet) => {
    if (G.inside || surface === 'wood' || wet > 0.05) return; // `wet` is the rain level here
    const p = g.player; const f = V(p.x + (Math.random() - 0.5) * 0.3, 0.02, p.z + (Math.random() - 0.5) * 0.3);
    if (surface === 'dirt') fx.dust(f, UP, sprint ? 0.42 : 0.3, 0.42, 0.37, 0.3); else if (sprint) fx.dust(f, UP, 0.22, 0.4, 0.39, 0.37);
  };

  // A bullet can arrive in the frame it is fired (fire in player_system, arrival in actors), before any updater runs;
  // the tracer list keeps its identity, so its push is observed to register every tracer the moment it exists.
  function registerTracer(t) {
    const a = V(t.a.x, t.a.y, t.a.z), b = V(t.b.x, t.b.y, t.b.z);
    const clip = clipSeg(a, b);
    // only bullets that end on the world (fx set) can stop on a built thing; a zombie hit is the rules' call
    let built = t.fx !== null && t.fx !== undefined && G.params.builtfix !== '0' ? builtHit(a, clip ? clip.p : b) : null;
    if (t.built && !built) {
      // the rules stopped the bullet on a built object's box (combat.ray_built): find the mesh inside the box, else the box face
      const dir = b.clone().sub(a).normalize();
      built = builtHit(a, b.clone().addScaledVector(dir, 1.6)) || { p: b.clone(), n: dir.clone().negate(), metal: t.fx === fxs.FX_SPARK, prop: -1 };
    }
    tracerReg.set(t, { a, b, kind: t.kind, seen: G.t, clip, built });
    if (t.kind === 0 || t.kind === 3) { fx.tracer(a, built ? built.p : clip ? clip.p : b, { speed: Math.max(60, a.distanceTo(b) / Math.max(t.dur, 1e-3)), width: t.kind === 3 ? 0.012 : 0.024, intensity: t.kind === 3 ? 6 : 16, trail: t.kind === 0 }); stats.tracers++; }
  }
  function hookTracers() {
    const arr = g.fx2 && g.fx2.tracers;
    if (!arr || arr.__fxaudio) return;
    Object.defineProperty(arr, '__fxaudio', { value: true });
    Object.defineProperty(arr, 'push', { value(...xs) { for (const t of xs) { try { if (!tracerReg.has(t)) registerTracer(t); } catch (e) { /* never break the rules */ } } return Array.prototype.push.apply(this, xs); } });
  }
  hookTracers();

  // ---- per frame ---------------------------------------------------------------------------------------------------
  const seenCasings = new WeakSet(); const fireEm = new Map(); let lastMuzzle = null, lastShots = g.fx2.shots, lastHp = g.hp, lastSwingHit = false;
  const tmp = V(), tmp2 = V();
  function frame(dt) {
    [G.g.cb.buff_at, G.g.cb.heal_at].forEach((p, k) => { const m = auras[k]; m.visible = !!p; if (p) m.position.set(p.x, 0.04, p.z); });
    tickStreaks(dt); tickCraft(dt); tickPuffs(dt); tickTrails(dt);
    const t0 = performance.now();
    const v = g.fx2;
    // new tracers from the player's guns (normally caught at push time, see hookTracers)
    hookTracers();
    for (const t of v.tracers) { if (tracerReg.has(t)) tracerReg.get(t).seen = G.t; else registerTracer(t); }
    for (const [t, r] of tracerReg) if (G.t - r.seen > 0.5) tracerReg.delete(t);
    // turret tracers that did not hit anything solid
    for (const tr of g.cb.tracers) if (!cbTracerSeen.has(tr)) { cbTracerSeen.add(tr); fx.tracer(V(tr[0].x, tr[0].y, tr[0].z), V(tr[1].x, tr[1].y, tr[1].z), { speed: 300 }); stats.tracers++; }
    // arrows and saw discs in flight
    let ia = 0, id = 0;
    for (const t of v.tracers) {
      if (t.kind !== 1 && t.kind !== 2) continue;
      const f = clamp(t.t / t.dur, 0, 1);
      tmp.set(t.a.x + (t.b.x - t.a.x) * f, t.a.y + (t.b.y - t.a.y) * f, t.a.z + (t.b.z - t.a.z) * f);
      tmp2.set(t.b.x - t.a.x, t.b.y - t.a.y, t.b.z - t.a.z).normalize();
      if (t.kind === 1 && ia < arrows.length) { const o = arrows[ia++]; o.visible = true; o.position.copy(tmp); o.lookAt(tmp.clone().sub(tmp2)); }
      if (t.kind === 2 && id < discs.length) { const o = discs[id++]; o.visible = true; o.position.copy(tmp); o.rotation.set(0, G.t * 40, 0); }
    }
    for (; ia < arrows.length; ia++) arrows[ia].visible = false;
    for (; id < discs.length; id++) discs[id].visible = false;
    // muzzle flash (new muzzle array = a new shot)
    if (v.muzzle && v.muzzle !== lastMuzzle) {
      const [m, d, , size] = v.muzzle;
      // gốc (c01 5:44:59): chớp nòng là ngôi sao vàng trắng to gần bằng đầu zombie gần đó
      fx.muzzleFlash(V(m.x, m.y, m.z), V(d.x, d.y, d.z), { scale: size * 1.15, color: [1, 0.92, 0.14] }); // vàng, không cam
    }
    lastMuzzle = v.muzzle;
    if (flameUntil > G.t && ctx.mouse.pressed('Left') && curClass() === 'flame') flameJet();
    // brass: Saltline's world-space shells (bounce .32, rest 4 s, shrink .7 s, clinks by surface)
    for (const c of v.casings) {
      if (seenCasings.has(c)) continue; seenCasings.add(c);
      fx.shell(V(c.p.x, c.p.y, c.p.z), V(c.v.x, c.v.y, c.v.z)); stats.shells++;
    }
    // rockets
    for (let i = 0; i < rockets.length; i++) {
      const r = v.rockets[i], o = rockets[i];
      if (!r) { o.visible = false; continue; }
      o.visible = true; o.position.set(r.p.x, r.p.y, r.p.z);
      tmp.set(r.v.x, r.v.y, r.v.z).normalize(); o.lookAt(tmp2.copy(o.position).sub(tmp));
      o.userData.fl.scale.set(1, 0.8 + 0.35 * Math.sin(G.t * 60), 1);
    }
    // fire zones (molotov, incendiary): Saltline fire emitters with flickering light, smoulder after
    const alive = new Set();
    for (const f of g.cb.fires) {
      alive.add(f);
      if (!fireEm.has(f)) {
        const c = f[0], r = f[1], em = [];
        for (let i = 0; i < 7; i++) { const a = i * 2.39 + 0.4, d = i === 0 ? 0 : r * (i < 4 ? 0.38 : 0.72); em.push(fx.addEmitter(V(c.x + Math.cos(a) * d, 0.05, c.z + Math.sin(a) * d), 'fire', { ttl: f[2] + 0.2, scale: i === 0 ? 1.7 : i < 4 ? 1.3 : 0.95 })); }
        em.push(fx.addEmitter(V(c.x, 0.3, c.z), 'smolder', { ttl: f[2] + 4, scale: 1.4 }));
        fireEm.set(f, em); stats.fires++;
      }
    }
    for (const [f, em] of fireEm) if (!alive.has(f)) { for (const e of em.slice(0, 7)) e.stop(); fireEm.delete(f); }
    // lure ball
    if (g.cb.lure !== null && g.cb.lure !== undefined) { const p = g.cb.lure[0], s = 0.12 + 0.04 * Math.sin(G.t * 9); lure.visible = true; lure.position.set(p.x, p.y + 0.25, p.z); lure.scale.setScalar(s); } else lure.visible = false;
    // blood decals: the rules' own (kind 2: dragged corpses) mirrored, plus splats under hit zombies
    const simBlood = new Set();
    for (const d of v.decals) if (d[3] === 2) { simBlood.add(d); if (!bloods.some((b) => b.src === d)) addBlood(d[0].x, d[0].z, d[1] * 2.2, d[2], d); }
    for (let i = bloods.length - 1; i >= 0; i--) {
      const b = bloods[i];
      if (b.src) { if (!simBlood.has(b.src)) bloods.splice(i, 1); else b.life = b.src[2]; } else { b.life -= dt; if (b.life <= 0) bloods.splice(i, 1); }
    }
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = V(), P = V();
    for (let i = 0; i < NBLOOD; i++) {
      const b = bloods[i];
      if (!b) { M.makeScale(0, 0, 0); bloodMesh.setMatrixAt(i, M); continue; }
      const a = clamp(b.life / 6, 0, 1), r = b.r * (0.4 + 0.6 * a) * 2;
      Q.setFromAxisAngle(UP, b.rot); S.set(r, 1, r); P.set(b.x, 0.006 + i * 0.0002, b.z); M.compose(P, Q, S); bloodMesh.setMatrixAt(i, M);
    }
    bloodMesh.instanceMatrix.needsUpdate = true;
    // melee on a wall: sparks on metal outside, splinters inside (the rules only resolve hits on zombies)
    const w = g.cur_w ? g.cur_w() : null;
    if (g.swing_hit && !lastSwingHit && w && items.melee(w.item) !== null && frameBlood === 0) {
      const mw = items.melee(w.item);
      const eyeP = V(g.player.x, g.player.y + 1.62, g.player.z);
      const dir = V(-Math.sin(g.yaw) * Math.cos(g.pitch), Math.sin(g.pitch), -Math.cos(g.yaw) * Math.cos(g.pitch));
      try {
        const reach = (mw.range || 1.2) + 0.5;
        const hit = fp.ray_world(g, new Vec3(eyeP.x, eyeP.y, eyeP.z), new Vec3(dir.x, dir.y, dir.z), reach);
        const shellHit = clipSeg(eyeP, eyeP.clone().addScaledVector(dir, reach));
        if (shellHit && (hit === null || shellHit.t * reach < hit[0])) worldImpact(shellHit.p, dir, shellHit.surf, shellHit.n);
        else if (hit !== null) {
          const P2 = eyeP.clone().addScaledVector(dir, hit[0]);
          const shell = inBox(BUILDING, P2.x, P2.z, 0.3) || inBox(WAREHOUSE, P2.x, P2.z, 0.3);
          const surf = hit[1] === 0 ? surfaceAt(P2.x, P2.z) : inBox(BUILDING, eyeP.x, eyeP.z) ? 'wood' : shell ? 'concrete' : 'metal'; // fences, cars, containers
          worldImpact(P2, dir, surf);
          if (surf === 'metal') { fx.sparks(P2, wallNormal(dir), 16); addShake(0.12); }
        }
      } catch (err) { if (!stats.meleeErr) { stats.meleeErr = String(err); console.warn('[fxaudio] melee ray: ' + err); } }
    }
    lastSwingHit = !!g.swing_hit;
    frameBlood = 0;
    for (const z of g.zombies) zHp.set(z, z.hp);
    // camera: recoil per shot (class numbers), shake from damage
    if (v.shots > lastShots) {
      const cls = curClass() || 'rifle', [kp, ks] = FEEL[cls] || FEEL.rifle;
      cam.burst = G.t - cam.lastShot < 0.25 ? cam.burst + 1 : 1; cam.lastShot = G.t;
      const pn = cam.burst <= 9 ? 1 : 0.38;
      const yaw = cam.burst < 4 ? (Math.random() - 0.5) * 0.0022 : Math.sin(cam.burst * 0.57 + cam.phase) * 0.0042 + (Math.random() - 0.5) * 0.002;
      addRecoil(kp * pn * (0.85 + Math.random() * 0.3), yaw * (kp / 0.0068));
      addShake(ks); rumble(Math.min(1, ks * 2.5), 70);
    }
    lastShots = v.shots;
    if (g.hp < lastHp - 0.5) { addShake(0.22 + (lastHp - g.hp) / 70); rumble(Math.min(1, 0.4 + (lastHp - g.hp) / 40), 200); }
    lastHp = g.hp;
    cam.hold -= dt;
    if (cam.hold <= 0) { cam.x = damp(cam.x, 0, 6.5, dt); cam.y = damp(cam.y, 0, 6.5, dt); }
    cam.b = damp(cam.b, cam.x, 34, dt); cam.m = damp(cam.m, cam.y, 34, dt);
    cam.shake = Math.max(0, cam.shake - dt * 1.7); cam.T += dt;
    const sk = typeof G.ctx.shake_scale === 'number' ? G.ctx.shake_scale : 1; // [par-panels] Settings > Camera Shake
    const sh = cam.shake * cam.shake * sk, T = cam.T;
    const sp = sh * 0.03 * (Math.sin(T * 43.1) + 0.6 * Math.sin(T * 71.7 + 1.3)), sy = sh * 0.03 * (Math.sin(T * 37.3) + 0.6 * Math.sin(T * 83.9 + 0.7)), sr = sh * 0.045 * (Math.sin(T * 29.7) + 0.6 * Math.sin(T * 61.3 + 2.1));
    if (!G.params.nocamfx && (Math.abs(cam.b) + Math.abs(cam.m) + sh) > 1e-6) {
      eE.set(cam.b + sp, cam.m + sy, sr, 'YXZ'); qE.setFromEuler(eE);
      G.camera.quaternion.multiply(qE); G.camera.updateMatrixWorld();
      G.viewCam.quaternion.copy(G.camera.quaternion); G.viewCam.updateMatrixWorld();
      G.sg.syncView(G.camera);
    }
    // lights: flashes decay, lightning
    for (const f of flashes) { if (f.t > 0) { f.t = Math.max(0, f.t - dt); f.l.intensity = f.I * Math.sqrt(f.t / f.d); } else if (f.l !== G.muzzle || f.I) { f.l.intensity = 0; f.I = 0; } }
    if (lightningDelay > 0) { lightningDelay -= dt; if (lightningDelay <= 0) lightning = 1; }
    // nothing else drives postFx.flash in this build, so the plug-in owns it while a strike lasts and zeroes it after
    if (lightning > 0) { lightning = Math.max(0, lightning - dt * 3.2); G.postFx.flash = lightning * (0.6 + 0.4 * Math.sin(G.t * 70)); if (lightning === 0) G.postFx.flash = 0; }
    // lit particles follow the time of day (the generated pool was built with the noon sun)
    if (fxLit && G.lights && G.lights.sun) {
      const u = fxLit.material.uniforms, s = G.lights.sun;
      u.uSun.value.set(s.color.r, s.color.g, s.color.b).multiplyScalar(s.intensity / Math.PI * 0.9);
      u.uSunDir.value.copy(s.position).sub(s.target.position).normalize();
      const k = G.U && G.U.uAmbK ? G.U.uAmbK.value : 1;
      u.uAmbHi.value.copy(lit0.amb).multiplyScalar(k); u.uAmbLo.value.copy(lit0.lo).multiplyScalar(k);
    }
    for (let i = booms.length - 1; i >= 0; i--) if (G.t - booms[i].t > 1) booms.splice(i, 1);
    fx.update(dt);
    snd.update(dt);
    const ms = performance.now() - t0; stats.ms += ms; stats.n++; stats.msMax = Math.max(stats.msMax, ms);
  }
  G.updaters.push(['fxaudio', frame]);
  // the rules' 'dynamic' mesh (box tracers, casings, muzzle cones, rockets, decals, fire cones, lure) is replaced above
  G.preRender.push(['fxaudio', () => {
    if (g.zoo) return;
    for (const n of G.sg.byName('dynamic')) n.obj.visible = false;
  }]);

  const api = {
    fx, audio: snd, bus, stats, cam,
    frameMs: () => (stats.n ? +(stats.ms / stats.n).toFixed(3) : 0),
    resetStats: () => { stats.ms = 0; stats.n = 0; stats.msMax = 0; },
    selfTest: (o) => snd.selfTest(o), shotTable: () => snd.shotTable(),
  };
  G.fxaudio = api;
  console.info('[fxaudio] installed: Saltline FX pools, ' + (snd.silent ? 'silent audio' : 'Saltline audio engine + game synth'));
  return api;
}
