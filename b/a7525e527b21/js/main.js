// twt-proc (three.js r170) boot and frame loop.
// Rules: js/sim/*.js (transliterated from the Bevy build's Rust, same systems in the same order).
// Picture: Saltline-style HDR pipeline (Felix Rieseberg's Saltline: sky, PCSS sun, post chain, wet materials),
// characters from the Lanternfall kit (loktar00). See REBUILD-PLAN.md.
import * as THREE from '../vendor/three.module.min.js';
import { Baker } from './bake.js';
import { U, setBaker } from './mats.js';
import { makeSky, SUN_DIR, SUN_COLOR, PALETTE } from './sky.js';
import { installPCSS } from './lights.js';
import { Post, TUNE } from './post.js';
import { SceneGraph } from './scenegraph.js';
import { Input } from './input.js';
import { Engine as SynthEngine } from './synth.js';
import { Vec3 } from './sim/vec.js';
import * as scene from './sim/scene.js';
import * as web from './sim/web.js';
import * as audio from './sim/audio.js';
import * as boot from './sim/boot.js';
import * as game from './sim/game.js';
import * as player from './sim/player.js';
import * as actors from './sim/actors.js';
import * as world from './sim/world.js';
import * as staff from './sim/staff.js';
import * as cine from './sim/cine.js';
import * as carry from './sim/carry.js';
import * as fxs from './sim/fx.js';
import * as mat from './sim/mat.js';
import * as lay from './sim/lay.js';
import * as exporter from './sim/export.js';
import * as geom from './sim/geom.js';

const params = Object.fromEntries(new URLSearchParams(location.search));
const stage = (n) => { if (window.twtStage) window.twtStage(n); };
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
const QUALITY = [
  { name: 'low', pr: 0.75, msaa: 0, ao: false, aoTaps: 8, volSteps: 10, ssr: false, ssrSteps: 16, shadow: 1024, tex: 512, plights: 4 },
  { name: 'medium', pr: 1, msaa: 2, ao: true, aoTaps: 12, volSteps: 16, ssr: false, ssrSteps: 28, shadow: 2048, tex: 1024, plights: 6 },
  { name: 'high', pr: 1, msaa: 4, ao: true, aoTaps: 12, volSteps: 24, ssr: true, ssrSteps: 40, shadow: 4096, tex: 1024, plights: 8 },
];

// Optional view plug-ins (js/plug/<name>.js exporting install(G)): each upgrades one part of the picture or sound and can
// be switched off with ?noplug=name,name (or all). ?plug=name loads one that is not in the default list yet.
const PLUGINS = ['dress'];
const G = window.__G = { params, U, postFx: { flash: 0, hurt: 0 }, errors: [], t: 0, dt: 1 / 60, frames: 0, updaters: [], preRender: [], plugins: {}, THREE };
const seen = new Set();
G.prof = {};
function guard(tag, fn) {
  const t0 = performance.now();
  try { const r = fn(); const d = performance.now() - t0; if (d > (G.prof[tag] || 0)) G.prof[tag] = d; return r; } catch (e) {
    if (!seen.has(tag)) { seen.add(tag); console.error('[loop] ' + tag + ' threw: ' + (e && e.stack || e)); G.errors.push(tag + ': ' + (e && e.message)); }
  }
}

async function bootGame() {
  stage('boot');
  const canvas = document.getElementById('twt-canvas');
  const made = boot.make_game();
  const g = G.g = made.game;
  const quality = mat.Quality.detect();
  G.simQuality = quality; G.quality = Object.assign({}, QUALITY[quality.tier]);
  geom.set_lod(quality.tier);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: !!params.nolock });
  if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 is not available');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5) * G.quality.pr);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.info.autoReset = false;
  G.renderer = renderer; G.scene = new THREE.Scene();
  G.camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.06, 900);
  G.camera.rotation.order = 'YXZ'; G.camera.position.set(0, 1.62, 15.5);
  G.viewCam = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.02, 10); G.viewCam.layers.set(1);

  stage('bake'); await frame();
  if (params.bootwait) await new Promise((r) => setTimeout(r, +params.bootwait));
  await gpuReady(renderer);
  // measured on linux2 (Chrome 154, ANGLE Vulkan, RTX 2060): programs first used within ~1 s of context creation fail
  // to link with an empty log even though a trivial probe links; 1.5 s later the same programs link. D3D11 is fine.
  { const gl = renderer.getContext(); const dbg = gl.getExtension('WEBGL_debug_renderer_info'); const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    if (/Vulkan/i.test(name) && !params.bootwait) await new Promise((r) => setTimeout(r, 1500)); }
  const baker = new Baker(renderer, G.quality.tex); setBaker(baker); G.baker = baker;
  stage('sky'); await frame();
  G.sky = makeSky(G);

  // sun: one directional light with contact-hardening shadows that follow the camera (Saltline rig)
  stage('lights'); await frame();
  const S = 46;
  if (!params.nopcss) installPCSS({ width: 2 * S, height: 2 * S, depth: 259 }, { taps: quality.tier === 0 ? 10 : 16, searchTaps: 8 });
  const sun = new THREE.DirectionalLight(SUN_COLOR, 9);
  sun.castShadow = true; sun.shadow.mapSize.set(G.quality.shadow, G.quality.shadow);
  Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 260 });
  sun.shadow.bias = -0.00012; sun.shadow.normalBias = 0.02; sun.shadow.radius = 1;
  sun.layers.enableAll(); G.scene.add(sun); G.scene.add(sun.target);
  G.lights = { sun, S, points: [] };
  for (let i = 0; i < G.quality.plights; i++) { const p = new THREE.PointLight(0xffffff, 0, 10, 1.6); p.layers.enableAll(); G.scene.add(p); G.lights.points.push(p); }
  G.muzzle = new THREE.PointLight(0xffb060, 0, 9, 2); G.muzzle.layers.enableAll(); G.scene.add(G.muzzle);

  // the scene facade the rules layer draws through
  stage('world'); await frame();
  const sg = G.sg = new SceneGraph(G, Vec3);
  const peopleStub = { spawn: () => ({ update() {}, despawn() {} }) };
  let people = peopleStub;
  if (params.ppl !== 'none') {
    stage('people');
    try { const m = await import('./people.js'); people = G.people = m.createPeople({ scene: G.scene, camera: G.camera, renderer, quality: G.quality }); }
    catch (e) { console.warn('[people] not available: ' + (e && e.message)); }
  }
  scene.install({ spawn: (mesh, matName, tr) => sg.spawn(mesh, matName, tr), people });

  const input = G.input = new Input(canvas, made.feel_nolock);
  const ctx = G.ctx = {
    keys: input.keys, mouse: input.mouse, motion: input.motion, cursor: input.cursor,
    feel: new player.Feel(), fx: new mat.Fx(), quality, export: new exporter.Export(), parts: fxs.Parts ? new fxs.Parts() : null,
    cam: { pos: new Vec3(0, 1.62, 15.5), quat: [0, 0, 0, 1], fov: 68 * Math.PI / 180 }, icons: null, elapsed: 0, res: { x: 1280, y: 720 },
  };
  ctx.feel.nolock = made.feel_nolock;
  guard('setup_world', () => world.setup_world(g, ctx));
  guard('setup_player', () => player.setup_player(g, ctx));
  await frame();

  stage('post');
  G.post = new Post(G);
  // sound: the game's own synthesised sounds (transliterated from the Bevy build)
  const engine = G.synth = new SynthEngine();
  if (audio.is_disabled()) engine.disable();
  audio.install(engine);

  stage('hud');
  if (params.hud !== 'none') {
    try { const h = await import('./hud.js'); G.hud = h; guard('setup_hud', () => h.setup_hud(g, ctx)); }
    catch (e) { console.error('[hud] failed to load: ' + (e && e.stack || e)); }
  }
  {
    const off = new Set((params.noplug || '').split(',').filter(Boolean));
    const want = PLUGINS.concat((params.plug || '').split(',').filter(Boolean)).filter((n, i, a) => a.indexOf(n) === i && !off.has(n) && !off.has('all'));
    for (const name of want) {
      try { const m = await import('./plug/' + name + '.js'); G.plugins[name] = (await m.install(G)) || true; }
      catch (e) { console.error('[plug] ' + name + ' failed: ' + (e && e.stack || e)); }
    }
  }
  stage('compile'); await frame();
  guard('first-env', () => { mat.update_env(g, 0.016, ctx); applyEnv(0.016); });
  renderer.compile(G.scene, G.camera);
  window.addEventListener('resize', onResize); onResize();
  window.__twtEnter = () => { try { engine.ensure && engine.ensure(); } catch (e) {} };
  G.ready = true;
  renderer.setAnimationLoop(loop);
}

// Chrome's Vulkan back end (Linux) fails to link programs for a moment after the context is created (empty log,
// LINK_STATUS false), which silently breaks the texture bake and the sky capture. Link a trivial program until it works.
async function gpuReady(renderer) {
  const gl = renderer.getContext();
  for (let i = 0; i < 40; i++) {
    const vs = gl.createShader(gl.VERTEX_SHADER), fs = gl.createShader(gl.FRAGMENT_SHADER), p = gl.createProgram();
    const NL = String.fromCharCode(10);
    gl.shaderSource(vs, '#version 300 es' + NL + 'in vec3 position; uniform float k' + i + '; void main(){ gl_Position = vec4(position * k' + i + ', 1.0); }');
    gl.shaderSource(fs, '#version 300 es' + NL + 'precision highp float; out vec4 o; uniform float k' + i + '; void main(){ o = vec4(k' + i + '); }');
    gl.compileShader(vs); gl.compileShader(fs); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    const ok = gl.getProgramParameter(p, gl.LINK_STATUS);
    gl.deleteProgram(p); gl.deleteShader(vs); gl.deleteShader(fs);
    if (ok) { if (i) console.info('[boot] GPU ready after ' + i + ' probes'); return; }
    await new Promise((r) => setTimeout(r, 100));
  }
}

function onResize() {
  const r = G.renderer; r.setSize(window.innerWidth, window.innerHeight, false);
  for (const c of [G.camera, G.viewCam]) { c.aspect = window.innerWidth / window.innerHeight; c.updateProjectionMatrix(); }
  const s = new THREE.Vector2(); r.getDrawingBufferSize(s); G.ctx.res = { x: s.x, y: s.y };
  if (G.post) G.post.resize();
}

// rules-side light table (sim/mat.js ENV) -> sky, sun, fog, point lights, wetness
const _c = new THREE.Vector3(), _f = new THREE.Vector3();
function applyEnv(dt) {
  const E = mat.ENV, fx = G.ctx.fx;
  const night = E.sky_col[3], raid = E.horizon[3], sunK = E.sun_dir[3] / 2.865;
  G.sky.update({
    sunDir: E.sun_dir, sunCol: E.sun_col, sunK, zen: [E.sky_col[0] * 0.42, E.sky_col[1] * 0.58, E.sky_col[2] * 0.73],
    hor: E.horizon, horAway: E.zenith, fog: E.fog_col, night, raid, cloud: E.zenith[3],
  }, dt);
  const sun = G.lights.sun, S = G.lights.S;
  sun.intensity = E.sun_dir[3] * Math.PI;
  const texel = (2 * S) / sun.shadow.mapSize.x;
  G.camera.getWorldDirection(_f); _f.y = 0; _f.normalize();
  _c.copy(G.camera.position).addScaledVector(_f, S * 0.45);
  _c.x = Math.round(_c.x / texel) * texel; _c.z = Math.round(_c.z / texel) * texel; _c.y = 0;
  sun.target.position.copy(_c); sun.position.copy(_c).addScaledVector(SUN_DIR, 140); sun.target.updateMatrixWorld();
  // point lights: ENV.lpos (xyz, radius), ENV.lcol (rgb premultiplied by strength)
  const pts = G.lights.points;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], lp = E.lpos[i], lc = E.lcol[i];
    const k = lc ? Math.max(lc[0], lc[1], lc[2]) : 0;
    if (!lp || k < 0.002) { p.intensity = 0; continue; }
    p.position.set(lp[0], lp[1], lp[2]); p.color.setRGB(lc[0] / k, lc[1] / k, lc[2] / k);
    p.distance = lp[3] * 1.6; p.intensity = k * lp[3] * lp[3] * 0.55;
  }
  U.uRain.value = Math.max(fx.wet, fx.rain);
  U.uAmbK.value = 0.35 + 0.65 * (1 - night);
  U.uSkyC.value.setRGB(E.sky_col[0], E.sky_col[1], E.sky_col[2]);
  TUNE.volSigma = (TUNE.volSigma0 || (TUNE.volSigma0 = TUNE.volSigma)) * (E.fog_col[3] / 0.0034);
  if (G.post) G.post.vol.u.uSigma.value = TUNE.volSigma;
  // "inside" boxes for the material shader (dry, darker ambient) and the dusty-interior volume
  const im = E.inside_min, ix = E.inside_max;
  U.uIndoor.value[0].set((im[0] + ix[0]) / 2, (im[2] + ix[2]) / 2, (ix[0] - im[0]) / 2, (ix[2] - im[2]) / 2); U.uIndoorH.value[0] = ix[1];
  G.inside = G.camera.position.x > im[0] && G.camera.position.x < ix[0] && G.camera.position.z > im[2] && G.camera.position.z < ix[2] && G.camera.position.y < ix[1];
}

let last = performance.now();
function loop() {
  const now = performance.now();
  let dt = Math.min(0.1, Math.max(0.0005, (now - last) / 1000)); last = now;
  if (window.__paused) return;
  step(dt); render();
}
function step(dt) {
  const g = G.g, ctx = G.ctx;
  G.t += dt; G.dt = dt; G.frames++; U.uTime.value = G.t; ctx.elapsed = G.t; ctx.fps = 1 / dt;
  G.input.begin();
  guard('player', () => player.player_system(g, dt, ctx));
  guard('clock', () => boot.clock_system(g, dt));
  guard('actors', () => actors.tick_actors(g, dt, ctx));
  guard('sync_world', () => world.sync_world(g, dt, ctx));
  guard('sync_build_actors', () => world.sync_build_actors(g, dt, ctx));
  guard('sync_actors', () => actors.sync_actors(g, dt, ctx));
  guard('sync_staff', () => staff.sync_staff(g, dt, ctx));
  guard('cine_actors', () => cine.cine_actors(g, dt, ctx));
  guard('sync_bin', () => carry.sync_bin(g, dt, ctx));
  guard('camera', () => applyCam());
  guard('fx', () => fxs.fx_system(g, dt, ctx));
  if (G.people && G.people.update) guard('people', () => G.people.update(dt));
  guard('corpses', () => syncCorpses());
  for (const [tag, fn] of G.updaters) guard('plug:' + tag, () => fn(dt, G.t));
  if (G.hud) guard('hud', () => G.hud.update_hud(g, dt, ctx));
  guard('export', () => exporter.export_system(g, dt, ctx));
  guard('env', () => { mat.update_env(g, dt, ctx); applyEnv(dt); });
  // post-fx driven by the game state
  const fx = G.postFx;
  fx.hurt = Math.min(1, g.hurt_flash || 0); fx.fade = Math.min(1, g.fade || 0); fx.lowHealth = g.mode === 'Play' ? Math.max(0, 1 - g.hp / (g.hp_max * 0.35)) : 0;
  if (G.synth && G.synth.set_listener) G.synth.set_listener(ctx.cam.pos, g.yaw);
}
// Lying corpses: the rules layer draws only the blood pool (the body was baked by the old people code); here each
// corpse prop that is not a live ragdoll gets a fallen Lanternfall figure.
const corpseFigs = new Map();
function syncCorpses() {
  const P = G.people, g = G.g; if (!P || !P.corpseFigure) return;
  const live = new Set();
  for (const p of g.props) {
    if (p.dead || p.kind.k !== 'Corpse') continue;
    if (g.cy && g.cy.rags && g.cy.rags.some((r) => r.id === p.id)) continue;
    live.add(p.id);
    let f = corpseFigs.get(p.id);
    if (!f) { f = P.corpseFigure(Math.imul(p.id, 977) >>> 0, p.kind.a); G.scene.add(f); corpseFigs.set(p.id, f); }
    f.position.set(p.pos.x, p.pos.y, p.pos.z); f.rotation.y = p.yaw; f.visible = g.held !== p.id;
  }
  for (const [id, f] of corpseFigs) if (!live.has(id)) { G.scene.remove(f); if (f.userData.dispose) f.userData.dispose(); corpseFigs.delete(id); }
}
function applyCam() {
  const c = G.ctx.cam, cam = G.camera;
  cam.position.set(c.pos.x, c.pos.y, c.pos.z); cam.quaternion.set(c.quat[0], c.quat[1], c.quat[2], c.quat[3]);
  if (c.fov) { const deg = c.fov * 180 / Math.PI; if (Math.abs(deg - cam.fov) > 0.01) { cam.fov = deg; cam.updateProjectionMatrix(); G.viewCam.fov = deg; G.viewCam.updateProjectionMatrix(); } }
  cam.updateMatrixWorld();
  G.viewCam.position.copy(cam.position); G.viewCam.quaternion.copy(cam.quaternion); G.viewCam.updateMatrixWorld();
  G.sg.syncView(cam);
}
function render() {
  guard('render', () => {
    const r = G.renderer; r.info.reset();
    for (const [tag, fn] of G.preRender) guard('pre:' + tag, () => fn(r, G.camera));
    G.post.render(() => {
      r.render(G.scene, G.camera);
      // first-person models: same HDR target, depth squeezed into 0..0.05 so post passes can tell them from the world
      const gl = r.getContext(); const ac = r.autoClear; const env = G.scene.environmentIntensity;
      r.autoClear = false; G.scene.environmentIntensity = env * 1.35; gl.depthRange(0, 0.05);
      try { r.render(G.scene, G.viewCam); } finally { gl.depthRange(0, 1); G.scene.environmentIntensity = env; r.autoClear = ac; }
    }, G.camera, G.t, G.dt);
    G.calls = r.info.render.calls; G.tris = r.info.render.triangles;
  });
}

// verification hooks
window.__sim = (sec) => { const n = Math.ceil(sec * 60); for (let i = 0; i < n; i++) step(1 / 60); render(); };
window.__px = (rt, x, y) => { const b = new Uint16Array(4); G.renderer.readRenderTargetPixels(rt, x, y, 1, 1, b); return Array.from(b); };

bootGame().catch((e) => {
  console.error('[boot] failed: ' + (e && e.stack || e));
  if (window.twtFatal) window.twtFatal('Không khởi động được: ' + (e && e.stack || e));
});
