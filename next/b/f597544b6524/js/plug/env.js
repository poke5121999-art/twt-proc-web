// World look plug-in (?plug=env): Saltline-grade wet ground with puddles, rain rings and a planar mirror over the car
// park and the street, Saltline rain (streaks, splashes, eave drips) driven by the rules' rain level, a material pass
// per pattern code, and light / post tuning for this game. ?noplug=env gives the default picture back.
// Saltline is by Felix Rieseberg (claude.ai artifact BGY1SztrAYcJQHSsnHHGmp); the generated ports live in js/sl/.
// Switches: ?ground=old (keep the old ground triangles), ?planar=0 (no mirror), ?mat=old (default materials),
// ?envpost=0 (default post / light numbers).
import { HOOKS, PAT_ENV } from '../scenegraph.js';
import { buildGround, APRON_RECTS } from '../ground.js';

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
  const out = {};
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
  if (HOOKS.filter || HOOKS.pat) G.sg.rebuildAll();
  G.envPlug = out;
  return out;
}
