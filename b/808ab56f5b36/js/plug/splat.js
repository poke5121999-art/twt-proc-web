// Plug-in "splat" ([par-counter B29]): getting hit in the original throws a red blood splatter across the screen (clip 05
// 16:00, HP 63 / 100: a big blob with long spikes and scattered drops, over the view but under the HUD), not an even red
// tint. Each hit (g.hurt_flash jumping up) paints one splatter shape drawn in code on a 2D canvas, held for a moment then
// faded out; at most three at once. View only: damage and hurt_flash are the rules'. ?noplug=splat turns it off.
const HOLD = 0.35, FADE = 0.9, MAX = 3;

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** One splatter on its own canvas (w x h): central blob, tapered spikes ending in drops, loose droplets. */
function paint(w, h, seed) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  const r = rng(seed);
  const H = Math.min(w, h);
  const cx = w * (0.28 + r() * 0.44), cy = h * (0.3 + r() * 0.4);
  const col = ['#c4060a', '#b3050a', '#d10c10'];
  x.fillStyle = col[0];
  // blob: wobbly polygon
  const R0 = H * (0.07 + r() * 0.05);
  x.beginPath();
  for (let i = 0; i <= 28; i++) {
    const a = (i / 28) * Math.PI * 2, rr = R0 * (0.75 + r() * 0.5);
    const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
    if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
  }
  x.closePath(); x.fill();
  // spikes: tapered wedges from the blob edge, each ending in a round drop
  const n = 14 + Math.floor(r() * 10);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, len = H * (0.12 + r() * r() * 0.42), wd = H * (0.012 + r() * 0.022);
    const ex = cx + Math.cos(a) * (R0 + len), ey = cy + Math.sin(a) * (R0 + len);
    const nx = -Math.sin(a), ny = Math.cos(a);
    const bx = cx + Math.cos(a) * R0 * 0.6, by = cy + Math.sin(a) * R0 * 0.6;
    x.fillStyle = col[i % 3];
    x.beginPath();
    x.moveTo(bx + nx * wd, by + ny * wd);
    x.quadraticCurveTo((bx + ex) / 2 + nx * wd * 0.5, (by + ey) / 2 + ny * wd * 0.5, ex, ey);
    x.quadraticCurveTo((bx + ex) / 2 - nx * wd * 0.5, (by + ey) / 2 - ny * wd * 0.5, bx - nx * wd, by - ny * wd);
    x.closePath(); x.fill();
    x.beginPath(); x.arc(ex, ey, wd * (0.9 + r() * 1.3), 0, Math.PI * 2); x.fill();
  }
  // loose drops
  const m = 22 + Math.floor(r() * 26);
  for (let i = 0; i < m; i++) {
    const a = r() * Math.PI * 2, d = R0 + H * (0.05 + r() * 0.5);
    const rr = H * (0.004 + r() * r() * 0.03);
    x.fillStyle = col[i % 3];
    x.beginPath(); x.arc(cx + Math.cos(a) * d * (w / H > 1.3 ? 1.35 : 1), cy + Math.sin(a) * d, rr, 0, Math.PI * 2); x.fill();
  }
  return c;
}

export async function install(G) {
  const g = G.g;
  const hud = document.getElementById('hud');
  if (!hud) return null;
  const cv = document.createElement('canvas');
  cv.className = 'hd-splat';
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';
  hud.insertBefore(cv, hud.firstChild);
  const ctx = cv.getContext('2d');
  const S = { splats: [], hits: 0 };
  let last = 0, seed = 0x51a7, dirty = false;
  G.splat = S;
  G.updaters.push(['splat', (dt) => {
    const hf = g.hurt_flash || 0;
    const w = Math.max(2, Math.round(window.innerWidth / 2)), h = Math.max(2, Math.round(window.innerHeight / 2));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; dirty = true; }
    if (hf > last + 0.4 && g.mode === 'Play') {
      seed = (seed * 1103515245 + 12345 + S.hits) >>> 0;
      S.splats.push({ t: 0, c: paint(w, h, seed) });
      if (S.splats.length > MAX) S.splats.shift();
      S.hits++;
    }
    last = hf;
    if (g.mode !== 'Play' && S.splats.length) S.splats.length = 0;
    for (const s of S.splats) s.t += dt;
    S.splats = S.splats.filter((s) => s.t < HOLD + FADE);
    if (!S.splats.length && !dirty) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const s of S.splats) {
      ctx.globalAlpha = s.t < HOLD ? 0.92 : 0.92 * (1 - (s.t - HOLD) / FADE);
      if (s.c.width === cv.width && s.c.height === cv.height) ctx.drawImage(s.c, 0, 0);
    }
    ctx.globalAlpha = 1;
    dirty = S.splats.length > 0;
  }]);
  return S;
}
