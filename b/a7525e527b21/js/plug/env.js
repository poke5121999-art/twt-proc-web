// World look plug-in (?plug=env): Saltline-grade wet ground with puddles, rain rings and a planar mirror over the car
// park and the street, Saltline rain (streaks, splashes, eave drips) driven by the rules' rain level, a material pass
// per pattern code, and light / post tuning for this game. ?noplug=env gives the default picture back.
// Saltline is by Felix Rieseberg (claude.ai artifact BGY1SztrAYcJQHSsnHHGmp); the generated ports live in js/sl/.
// Switches: ?ground=old (keep the old ground triangles), ?planar=0 (no mirror), ?mat=old (default materials),
// ?envpost=0 (default post / light numbers).
import { HOOKS, PAT_ENV } from '../scenegraph.js';
import { buildGround, APRON_RECTS } from '../ground.js';
import { TUNE } from '../post.js';

const GROUND_PATS = new Set([0, 2, 3]); // paint decals (FLAT), concrete, asphalt top faces

function groundFilter(node, pat, a, b, c, mesh) {
  if (!node || node.name !== 'exterior' || !GROUND_PATS.has(pat)) return false;
  const p = mesh.p, n = mesh.n;
  const ya = p[a * 3 + 1], yb = p[b * 3 + 1], yc = p[c * 3 + 1];
  if (ya < -0.13 || ya > 0.03 || yb < -0.13 || yb > 0.03 || yc < -0.13 || yc > 0.03) return false;
  if (n[a * 3 + 1] < 0.9 || n[b * 3 + 1] < 0.9 || n[c * 3 + 1] < 0.9) return false;
  const x = (p[a * 3] + p[b * 3] + p[c * 3]) / 3, z = (p[a * 3 + 2] + p[b * 3 + 2] + p[c * 3 + 2]) / 3, y = (ya + yb + yc) / 3;
  for (const r of APRON_RECTS) {
    if (x > r[0] - 0.01 && x < r[2] + 0.01 && z > r[1] - 0.01 && z < r[3] + 0.01 && Math.abs(y - r[4]) < 0.016) return true;
  }
  return false;
}

export async function install(G) {
  const P = G.params;
  const out = { times: {} }; let t0 = performance.now();
  const lap = (k) => { const t = performance.now(); out.times[k] = Math.round(t - t0); t0 = t; };
  // 1. wet ground + rain
  if (P.ground !== 'old') {
    HOOKS.filter = groundFilter;
    const ground = out.ground = buildGround(G);
    G.updaters.push(['env-ground', (dt) => ground.update(dt)]);
    G.preRender.push(['env-planar', (r, cam) => ground.prePass(r, cam)]);
    let flash = 0;
    ground.onThunder = (k) => { if (G.ctx.fx.rain > 0.35) flash = Math.max(flash, k); };
    G.updaters.push(['env-thunder', (dt) => { flash = Math.max(0, flash - dt * 2.2); G.U.uFlash.value = flash * flash; }]);
  }
  // 2. material pass per pattern code
  if (P.mat !== 'old') HOOKS.pat = PAT_ENV;
  lap('ground');
  if (HOOKS.pat) for (const k in HOOKS.pat) { const o = HOOKS.pat[k]; G.baker.bake(o.surf); if (o.tint) G.baker.avgPaint(o.surf); else G.baker.avg(o.surf); lap('bake:' + o.surf); }
  if (HOOKS.filter || HOOKS.pat) G.sg.rebuildAll();
  lap('remat');
  // 3. light and post for this game: night dark but readable, lamps and the SHOP sign bloom, dust in the shop so the
  // sun through the window gaps draws shafts, eye adaptation that catches up fast when stepping out into daylight
  if (P.envpost !== '0') {
    const post = G.post, sky = G.sky;
    const expo = [post.comp.u, post.streak.u, post.grade.u];
    const V = G.THREE.Vector3;
    post.setInteriorBox(new V(-9.57, 0.0, -5.07), new V(5.07, 3.2, 5.07), 3.5);
    const lerp = (a, b, k) => a + (b - a) * k;
    let outT = 0, wasInside = !!G.inside;
    G.updaters.push(['env-post', (dt) => {
      const night = sky.uniforms.uNight.value, rain = G.ctx.fx.rain || 0;
      const inside = !!G.inside;
      const maxE = inside ? lerp(2.0, 1.45, night) : lerp(2.0, 1.2, night);
      const key = lerp(0.12, 0.08, night) * lerp(1, 0.9, rain);
      for (const u of expo) { u.uMaxE.value = maxE; u.uKey.value = key; u.uMinE.value = 0.45; }
      TUNE.bloom = lerp(0.065, 0.085, night); TUNE.streakThreshold = lerp(2.2, 1.5, night); TUNE.streak = lerp(0.03, 0.045, night);
      if (wasInside && !inside) outT = 2.5;
      outT -= dt; wasInside = inside;
      TUNE.adaptTau = outT > 0 ? 0.45 : 1.5;
    }]);
    // lamps: physical falloff (decay 2) a bit stronger, so a lamp pools light instead of flooding the room
    G.preRender.push(['env-lights', () => { for (const p of G.lights.points) if (p.visible) { p.decay = 2; } }]);
    lap('post');
  }
  // 4. distant backdrop: a ring of town / tree-line silhouettes at 320 m that the far haze of the fog pass swallows,
  // with a few lit windows at night, so the horizon is not empty between the hills
  if (P.backdrop !== '0') { out.backdrop = backdrop(G); lap('backdrop'); }
  G.envPlug = out;
  return out;
}

const BACK_FS = /* glsl */`
uniform vec3 uHorAway, uFog; uniform float uNight, uLum;
varying vec3 vP;
float bh(float c){ return fract(sin(c * 91.345) * 47453.5453); }
void main(){
  float a = atan(vP.z, vP.x);
  float u = (a + 3.14159265) / 6.2831853;
  // sectors: town on the street side (+z) and to the east / west, woods behind the lot (-z)
  float town = smoothstep(0.08, 0.2, sin(a)) + 0.55 * smoothstep(0.75, 0.95, abs(cos(a)));
  town = clamp(town, 0.0, 1.0);
  float cell = floor(u * 96.0); float f = fract(u * 96.0);
  float h0 = bh(cell), h1 = bh(cell + 17.0);
  float bld = mix(9.0, 32.0, h0 * h0) * step(0.15, h1) + step(0.95, h0) * 12.0;
  float sub = floor(f * 3.0); bld *= 0.8 + 0.25 * bh(cell * 3.0 + sub);
  bld *= step(0.04, f) * step(f, 0.97 - 0.3 * step(0.6, h1));
  float tank = step(0.985, bh(cell + 5.0)) * 9.0 * step(0.3, f) * step(f, 0.7);
  float tree = 13.0 + 5.0 * sin(u * 1900.0 + sin(u * 470.0) * 3.0) * 0.5 + 3.0 * bh(floor(u * 1400.0)) + 4.0 * sin(u * 97.0);
  float h = mix(tree, max(bld + tank, tree * 0.55), town);
  float y = vP.y;
  if (y > h) discard;
  // silhouette a little darker than the sky behind it, cooler and flatter toward the ground (the haze adds the rest)
  vec3 col = uHorAway * 0.32 * mix(0.8, 1.0, smoothstep(0.0, 30.0, y));
  // lit windows at night in the town sectors
  vec2 wc = vec2(floor(u * 96.0 * 12.0), floor(y / 3.1));
  float lit = step(0.93, bh(wc.x * 13.1 + wc.y * 7.7)) * step(2.0, y) * step(y, bld - 1.5) * town;
  vec2 wf = vec2(fract(u * 96.0 * 12.0), fract(y / 3.1));
  lit *= step(0.25, wf.x) * step(wf.x, 0.75) * step(0.3, wf.y) * step(wf.y, 0.7);
  col += vec3(1.0, 0.72, 0.4) * lit * uNight * 0.9;
  gl_FragColor = vec4(col * uLum, 0.0);
}`;

function backdrop(G) {
  const THREE = G.THREE;
  const geo = new THREE.CylinderGeometry(235, 235, 70, 160, 1, true);
  geo.translate(0, 33, 0);
  const m = new THREE.ShaderMaterial({
    uniforms: { uHorAway: { value: G.sky.uniforms.uHorAway.value }, uFog: { value: G.sky.uniforms.uHorAway.value.clone() }, uNight: G.sky.uniforms.uNight, uLum: { value: 1 } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: BACK_FS, side: THREE.BackSide,
  });
  const mesh = new THREE.Mesh(geo, m); mesh.name = 'twt-backdrop'; mesh.frustumCulled = false; mesh.renderOrder = -900;
  G.scene.add(mesh);
  const fogCol = m.uniforms.uFog.value;
  G.updaters.push(['env-backdrop', () => {
    // PALETTE.fog is mutated by the sky every frame; follow it and the overall sky brightness
    const pal = G.sky.uniforms.uHorAway.value; fogCol.copy(pal);
    m.uniforms.uLum.value = 1.0;
    mesh.position.set(G.camera.position.x, 0, G.camera.position.z);
  }]);
  return mesh;
}
