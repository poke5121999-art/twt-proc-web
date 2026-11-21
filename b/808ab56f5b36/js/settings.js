// [par-panels] Settings model (C05): every option of the Settings panel, its default, range, saving and what it changes.
// The original's options are `Runtime.Settings.SettingsData` of the decoded 1.1.13 (out/code/decomp/Runtime/Runtime/Settings/
// SettingsData.c: the constructor holds the defaults) with the labels of I2Languages.asset (settings_* terms). Tabs and
// rows follow the original's order; rows of the original this build has no system for are left out (listed in PARITY C05).
// Rows marked `extra: true` are the owner's additions (2026-11-18: separate SFX / music, graphics options, vibration...).
//
// Node-safe: no DOM at import. attach(G) (main.js, after the plug-ins) applies everything to the running game:
//   renderer pixel ratio + post targets (render scale, MSAA), sun shadow on/off + map size, post passes (AO, SSR, bloom,
//   volumetric fog, reduce post-processing / flashing, brightness), ground mirror + rain instance count, frame cap,
//   FPS counter, audio buses (audio.js / synth.js gain nodes), camera shake scale, gamepad rumble.

export const VERSION = 1;
export const KEY = 'twt-settings';

export const PRESETS = ['Low', 'Medium', 'High', 'Ultra'];
export const FPS_CAPS = [0, 30, 60, 120, 144]; // 0 = Uncapped (original TargetFramerate -1)
const FPS_LABELS = ['Uncapped', '30', '60', '120', '144'];
const SHADOW_SIZES = [0, 1024, 2048, 4096];

// What each Quality preset writes into the individual graphics rows. Low / Medium / High are the boot tiers this build
// always had (main.js QUALITY: pixel ratio .75 / 1 / 1, MSAA 0 / 2 / 4, AO, SSR, shadow 1024 / 2048 / 4096, ground mirror
// off below Medium, rain .45 / .75 / 1); Low now also drops bloom. Ultra (owner) renders at 125 % and adds SSR / mirror detail.
export const PRESET_ROWS = [
  { scale: 75, aa: 0, shadows: 1, ao: false, ssr: false, planar: false, bloom: false, fog: true, rain: 45 },
  { scale: 100, aa: 1, shadows: 2, ao: true, ssr: false, planar: true, bloom: true, fog: true, rain: 75 },
  { scale: 100, aa: 2, shadows: 3, ao: true, ssr: true, planar: true, bloom: true, fog: true, rain: 100 },
  { scale: 125, aa: 2, shadows: 3, ao: true, ssr: true, planar: true, bloom: true, fog: true, rain: 100 },
];

/** Defaults: the original's where this build has the same option (SettingsData()), else this build's own. */
export const DEFAULTS = Object.freeze({
  // VIDEO
  fps: 0, preset: 2, fov: 68, ...PRESET_ROWS[2], showFps: false,
  // AUDIO (original: muted false, Master 1, Music .25, SFX 1; Master keeps this build's 0.8 level of g.volume)
  mute: false, master: 0.8, music: 0.25, sfx: 1, amb: 1, ui: 1,
  // CONTROLS (original: MouseSensitivity 1, InvertMouseY false, RumbleEnabled true, Rumble*Scale 1)
  sens: 1, invert: false, rumble: true, rumbleMaster: 1, rumbleCombat: 1, rumbleInteract: 1,
  // ACCESSIBILITY (original: ReduceFlashing false, Gamma 1, ReducePostProcessing false, CameraShakeScale 1)
  reduceFlash: false, bright: 1, reducePost: false, shake: 1,
});

const pct = (v) => `${Math.round(v * 100)}%`;
// Row kinds: slider {min, max, step, fmt}, toggle, seg {opts}. `key` = the keyboard hint shown on the row.
const R = {
  display: { label: 'Display Mode', kind: 'seg', opts: ['Windowed', 'Fullscreen'], live: true },
  fps: { label: 'Target Framerate', kind: 'seg', opts: FPS_LABELS },
  preset: { label: 'Quality', kind: 'seg', opts: PRESETS, key: 'G' },
  aa: { label: 'Anti-Aliasing', kind: 'seg', opts: ['Off', 'MSAA x2', 'MSAA x4'] },
  fov: { label: 'Field Of View', kind: 'slider', min: 50, max: 110, step: 1, fmt: (v) => `${v}` },
  scale: { label: 'Render Scale', kind: 'slider', min: 50, max: 150, step: 5, fmt: (v) => `${v}%`, extra: true },
  shadows: { label: 'Shadows', kind: 'seg', opts: ['Off', '1024', '2048', '4096'], extra: true },
  ao: { label: 'Ambient Occlusion', kind: 'toggle', extra: true },
  ssr: { label: 'Screen-Space Reflections', kind: 'toggle', extra: true },
  planar: { label: 'Puddle Reflections', kind: 'toggle', extra: true },
  bloom: { label: 'Bloom', kind: 'toggle', extra: true },
  fog: { label: 'Volumetric Fog', kind: 'toggle', extra: true },
  rain: { label: 'Rain Density', kind: 'slider', min: 25, max: 100, step: 5, fmt: (v) => `${v}%`, extra: true },
  showFps: { label: 'Show FPS', kind: 'toggle', extra: true },
  mute: { label: 'Mute All', kind: 'toggle' },
  master: { label: 'Master', kind: 'slider', min: 0, max: 1, step: 0.05, fmt: pct },
  music: { label: 'Music', kind: 'slider', min: 0, max: 1, step: 0.05, fmt: pct },
  sfx: { label: 'Sound Effects', kind: 'slider', min: 0, max: 1, step: 0.05, fmt: pct },
  amb: { label: 'Ambience', kind: 'slider', min: 0, max: 1, step: 0.05, fmt: pct, extra: true },
  ui: { label: 'Interface', kind: 'slider', min: 0, max: 1, step: 0.05, fmt: pct, extra: true },
  sens: { label: 'Mouse Sensitivity', kind: 'slider', min: 0.3, max: 3, step: 0.1, fmt: (v) => v.toFixed(2), key: '[ / ]' },
  invert: { label: 'Invert Mouse Y', kind: 'toggle', key: 'I' },
  rumble: { label: 'Gamepad Vibration', kind: 'toggle' },
  rumbleMaster: { label: 'Vibration Master Strength', kind: 'slider', min: 0, max: 1, step: 0.05, fmt: pct },
  rumbleCombat: { label: 'Vibration Combat Strength', kind: 'slider', min: 0, max: 1, step: 0.05, fmt: pct },
  rumbleInteract: { label: 'Vibration Interaction Strength', kind: 'slider', min: 0, max: 1, step: 0.05, fmt: pct },
  reduceFlash: { label: 'Reduce Flashing', kind: 'toggle' },
  bright: { label: 'Brightness', kind: 'slider', min: 0.5, max: 1.5, step: 0.05, fmt: (v) => v.toFixed(2) },
  reducePost: { label: 'Reduce Post-Processing', kind: 'toggle' },
  shake: { label: 'Camera Shake', kind: 'slider', min: 0, max: 1.5, step: 0.05, fmt: pct },
  lang: { label: 'Language', kind: 'seg', opts: ['English'], live: true },
};
export const ROWS = R;

// Tabs in the original's order (settings_video / audio / game / controls / keybindings / accessibility / language).
// ACCESSIBILITY is in 1.1.13 (SettingsData v7) but not in clip 06 (older build): its place before LANGUAGE is a guess.
export const TABS = ['VIDEO', 'AUDIO', 'GAME', 'CONTROLS', 'KEYBINDINGS', 'ACCESSIBILITY', 'LANGUAGE'];
export const TAB_ROWS = [
  ['display', 'fps', 'preset', 'aa', 'fov', 'scale', 'shadows', 'ao', 'ssr', 'planar', 'bloom', 'fog', 'rain', 'showFps'],
  ['mute', 'master', 'music', 'sfx', 'amb', 'ui'],
  [],
  ['sens', 'invert', 'rumble', 'rumbleMaster', 'rumbleCombat', 'rumbleInteract'],
  [],
  ['reduceFlash', 'bright', 'reducePost', 'shake'],
  ['lang'],
];
export const KB_TAB = 4;
/** Row the keyboard cursor starts on when a tab opens (AUDIO: Master, so - / = keep changing the master volume). */
export const row0 = (tab) => (tab === 1 ? 1 : 0);

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const snap = (r, v) => { const n = Math.round((v - r.min) / r.step); return +(r.min + n * r.step).toFixed(4); };

/** A clean, valid value for option `id`, or the default. */
export function valid(id, v) {
  const d = DEFAULTS[id], r = R[id];
  if (d === undefined) return undefined;
  if (typeof d === 'boolean') return typeof v === 'boolean' ? v : d;
  if (typeof v !== 'number' || !Number.isFinite(v)) return d;
  if (r && r.kind === 'slider') return snap(r, clamp(v, r.min, r.max));
  if (r && r.kind === 'seg') return clamp(Math.round(v), 0, r.opts.length - 1);
  return v;
}

/** Settings from a storage object (getItem); missing / broken / throwing storage gives the defaults. */
export function load(storage) {
  const s = { ...DEFAULTS };
  let raw = null;
  try { raw = storage ? storage.getItem(KEY) : null; } catch (e) { raw = null; }
  if (raw) {
    try {
      const o = JSON.parse(raw);
      if (o && typeof o === 'object') for (const k of Object.keys(DEFAULTS)) if (k in o) s[k] = valid(k, o[k]);
      s.chosen = !!(o && o.chosen);
    } catch (e) { /* broken JSON: defaults */ }
  }
  return s;
}
/** Write `s` to storage; false when the storage refused (private window, quota): the session keeps its values. */
export function save(storage, s) {
  const o = { v: VERSION, chosen: !!s.chosen };
  for (const k of Object.keys(DEFAULTS)) o[k] = s[k];
  try { if (!storage) return false; storage.setItem(KEY, JSON.stringify(o)); return true; } catch (e) { return false; }
}

/** The preset whose rows `s` matches, or -1 (Custom: the original shows "Custom" for a hand-made mix too). */
export function preset_of(s) {
  return PRESET_ROWS.findIndex((p) => Object.keys(p).every((k) => s[k] === p[k]));
}
/** Pick a quality preset: writes its rows. */
export function set_preset(s, i) {
  s.preset = clamp(i | 0, 0, PRESETS.length - 1);
  Object.assign(s, PRESET_ROWS[s.preset]);
  s.chosen = true;
}

/** Concrete render numbers for the settings (`dpr` = devicePixelRatio). */
export function render_params(s, dpr = 1) {
  const ultra = preset_of(s) === 3;
  return {
    pr: +(Math.min(dpr || 1, 1.5) * s.scale / 100).toFixed(4),
    msaa: [0, 2, 4][s.aa],
    shadow: SHADOW_SIZES[s.shadows], castShadow: s.shadows > 0,
    ao: s.ao, ssr: s.ssr, ssrSteps: ultra ? 64 : 40,
    planar: s.planar ? (ultra ? 0.75 : 0.5) : 0,
    bloom: s.bloom && !s.reducePost, fog: s.fog, rain: s.rain / 100,
    fpsCap: FPS_CAPS[s.fps], tier: Math.min(s.preset, 2),
    reducePost: s.reducePost, reduceFlash: s.reduceFlash, bright: s.bright,
  };
}

/** Bus levels for the audio engine: master already folds in Mute All. */
export function mix_params(s) {
  return { master: s.mute ? 0 : s.master, music: s.music, sfx: s.sfx, amb: s.amb, ui: s.ui };
}

/** Rumble strength 0..1 of an event (original SettingsData.EffectiveCombatRumble / EffectiveInteractRumble). */
export function rumble_k(s, kind, amount = 1) {
  if (!s.rumble) return 0;
  return clamp(amount, 0, 1) * s.rumbleMaster * (kind === 'combat' ? s.rumbleCombat : s.rumbleInteract);
}

/** Reset one tab's rows to the defaults (VIDEO also returns to the auto quality the game starts with). */
export function revert_tab(s, tab) {
  for (const id of TAB_ROWS[tab] || []) if (id in DEFAULTS) s[id] = DEFAULTS[id];
  if (tab === 0) s.chosen = false;
}
export function revert_all(s) { Object.assign(s, DEFAULTS); s.chosen = false; }

/** Step option `id` by `dir` (+1 / -1): slider by its step, seg to the next option, toggle flips. */
export function step(s, id, dir) {
  const r = R[id];
  if (!r || !(id in DEFAULTS)) return false;
  if (r.kind === 'toggle') s[id] = !s[id];
  else if (r.kind === 'seg') s[id] = clamp(s[id] + (dir < 0 ? -1 : 1), 0, r.opts.length - 1);
  else s[id] = valid(id, s[id] + (dir < 0 ? -r.step : r.step));
  return true;
}
/** Slider value from a click position 0..1. */
export function from_frac(id, f) { const r = R[id]; return valid(id, r.min + clamp(f, 0, 1) * (r.max - r.min)); }
export function frac_of(id, v) { const r = R[id]; return (v - r.min) / (r.max - r.min); }

// ------------------------------------------------------------------------------------------------ live (browser)
const LS = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } };
export const S = load(LS());
const ST = { G: null, saved: '', fps: { el: null, n: 0, t0: 0, v: 0 }, lastRumble: { combat: 0, interact: 0 }, stats: { rumbles: 0, pads: 0, last: null, applied: 0 } };
export const stats = ST.stats;

// one-time move of the values the build kept before (twtproc.settings.v1 "tier,sens,vol,invert", twt-view {fov})
if (!S.chosen && LS()) {
  try {
    const old = LS().getItem('twtproc.settings.v1');
    if (old && LS().getItem(KEY) === null) {
      const p = old.split(',');
      S.sens = valid('sens', parseFloat(p[1])); S.master = valid('master', parseFloat(p[2])); S.invert = p[3] === '1';
    }
    const v = JSON.parse(LS().getItem('twt-view') || '{}');
    if (LS().getItem(KEY) === null && v && v.fov) S.fov = valid('fov', v.fov);
  } catch (e) { /* defaults */ }
}

function persist() {
  const j = JSON.stringify(S);
  if (j === ST.saved) return;
  ST.saved = j;
  save(LS(), S);
}

/** Set option `id` (validated), apply it, save. */
export function set(id, v) {
  if (id === 'preset') { set_preset(S, v); apply(); persist(); return; }
  S[id] = valid(id, v);
  if (R[id] && R[id].kind !== undefined && id in PRESET_ROWS[0]) { const p = preset_of(S); if (p >= 0) S.preset = p; S.chosen = true; }
  if (id === 'fps') S.chosen = true;
  apply(); persist();
}
export function bump(id, dir) {
  if (id === 'preset') { set('preset', S.preset + (dir < 0 ? -1 : 1)); return; }
  if (id === 'display') { fullscreen(dir > 0); return; }
  if (!step(S, id, dir)) return;
  set(id, S[id]);
}
/** G key: next quality preset, Ultra wraps to Low. */
export function cycle_preset() { set('preset', (S.preset + 1) % PRESETS.length); }
export function revert(tab) {
  if (tab === KB_TAB) { const I = ST.G && ST.G.input; if (I) { I.remap.clear(); try { LS() && LS().setItem('twt-keymap', '{}'); } catch (e) { /* session only */ } } }
  else revert_tab(S, tab);
  apply(); persist();
}
export function revert_everything() { revert_all(S); revert(KB_TAB); }
/** Rules-side keys ([ / ] sensitivity, I invert) change g; keep the saved settings in step. */
export function pull(g) {
  if (!g) return;
  if (S.sens !== valid('sens', g.sens) || S.invert !== !!g.invert) { S.sens = valid('sens', g.sens); S.invert = !!g.invert; persist(); }
}

export function is_fullscreen() { return typeof document !== 'undefined' && !!document.fullscreenElement; }
export function fullscreen(on) {
  try {
    if (on && !is_fullscreen()) document.documentElement.requestFullscreen().catch(() => {});
    else if (!on && is_fullscreen()) document.exitFullscreen().catch(() => {});
  } catch (e) { /* not allowed here */ }
}

/** Gamepad rumble for an event (kind 'combat' | 'interact', amount 0..1). Plays on every pad with a vibration actuator;
 *  this build has no gamepad controls yet, so it only matters when a pad is connected (Gamepad API). */
export function rumble(kind, amount = 1, ms = 160) {
  const k = rumble_k(S, kind, amount);
  if (k <= 0.001) return 0;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (now - ST.lastRumble[kind] < 70) return 0; // minigun: one pulse per 70 ms
  ST.lastRumble[kind] = now;
  let n = 0;
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads || []) {
    const a = p && p.vibrationActuator;
    if (!a || !a.playEffect) continue;
    try { const r = a.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: Math.min(1, k), weakMagnitude: Math.min(1, k * 0.7) }); if (r && r.catch) r.catch(() => {}); n++; } catch (e) { /* pad gone */ }
  }
  ST.stats.rumbles++; ST.stats.pads = n; ST.stats.last = { kind, k: +k.toFixed(3), ms };
  return n;
}

/** Apply every setting to the running game (no-op before attach). */
export function apply() {
  const G = ST.G;
  if (!G) return;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const P = render_params(S, dpr);
  const q = G.quality;
  // render scale + MSAA: new drawing buffer and post targets
  const resize = q.msaa !== P.msaa || Math.abs(G.renderer.getPixelRatio() - P.pr) > 1e-4;
  Object.assign(q, { msaa: P.msaa, ao: P.ao, ssr: P.ssr, ssrSteps: P.ssrSteps, bloom: P.bloom, fog: P.fog, reducePost: P.reducePost, reduceFlash: P.reduceFlash, pr: P.pr });
  if (resize) { G.renderer.setPixelRatio(P.pr); if (G.applyResize) G.applyResize(); }
  // sun shadow: on / off (materials relink on the next frame) and map size (the map is rebuilt at the new size)
  const sun = G.lights && G.lights.sun;
  if (sun) {
    if (sun.castShadow !== P.castShadow) sun.castShadow = P.castShadow;
    if (P.castShadow && sun.shadow.mapSize.x !== P.shadow) {
      sun.shadow.mapSize.set(P.shadow, P.shadow);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    q.shadow = P.shadow;
  }
  const ground = G.plugins && G.plugins.env && G.plugins.env.ground;
  if (ground && ground.setQuality) ground.setQuality({ planar: P.planar, rain: P.rain });
  if (G.post && G.post.grade) G.post.grade.u.uExposure.value = P.bright;
  G.fpsCap = P.fpsCap;
  const ctx = G.ctx;
  if (ctx) {
    if (S.chosen && ctx.quality) { ctx.quality.tier = P.tier; ctx.quality.auto = false; }
    if (!S.chosen && ctx.quality && ctx.quality.auto === false && G.simQuality0) { ctx.quality.auto = G.simQuality0.auto; }
    if (ctx.quality) ctx.quality.preset = preset_of(S);
    ctx.shake_scale = S.shake;
    if (ctx.cam) ctx.cam.fov = S.fov * Math.PI / 180;
  }
  // audio: Master (+ Mute All) through the facade the rules use, the buses through the engine
  const M = mix_params(S);
  if (G.g) { G.g.volume = S.master; G.g.sens = S.sens; G.g.invert = S.invert; }
  if (G.audioFacade) { G.audioFacade.set_volume(M.master); G.audioFacade.set_mix(M); }
  fps_counter(S.showFps);
  ST.stats.applied++;
}

function fps_counter(on) {
  if (typeof document === 'undefined') return;
  const F = ST.fps;
  if (on && !F.el) {
    F.el = document.createElement('div');
    F.el.id = 'twt-fps';
    F.el.style.cssText = 'position:fixed;right:10px;top:8px;z-index:40;font:600 13px/1.2 ui-monospace,monospace;color:#e3c11c;background:rgba(0,0,0,.55);padding:3px 7px;border-radius:3px;pointer-events:none';
    document.body.appendChild(F.el);
  } else if (!on && F.el) { F.el.remove(); F.el = null; }
}
function fps_tick() {
  const F = ST.fps; if (!F.el) return;
  const t = performance.now(); F.n++;
  if (t - F.t0 >= 500) { F.v = F.n * 1000 / (t - F.t0); F.n = 0; F.t0 = t; F.el.textContent = `${F.v.toFixed(0)} FPS`; }
}

/** Hook into the running game (main.js after the plug-ins) and apply the saved settings. */
export function attach(G, audioFacade) {
  ST.G = G;
  G.audioFacade = audioFacade;
  G.simQuality0 = { auto: G.ctx && G.ctx.quality ? G.ctx.quality.auto : true };
  G.settings = { S, set, bump, revert, revert_everything, cycle_preset, render_params: () => render_params(S, window.devicePixelRatio || 1), preset_of: () => preset_of(S), stats, rumble };
  G.rumble = rumble;
  // URL ?q=low|medium|high|ultra picks the preset for this session (bots, fps probes); nothing is saved
  const qp = G.params && G.params.q;
  const named = qp === undefined ? -1 : ['low', 'medium', 'high', 'ultra'].indexOf(qp === 'med' ? 'medium' : qp);
  if (named >= 0) { S.preset = named; Object.assign(S, PRESET_ROWS[named]); S.chosen = true; ST.saved = JSON.stringify(S); }
  else ST.saved = JSON.stringify(S);
  // interaction rumble on the rules' interaction sounds
  if (audioFacade && audioFacade.taps) {
    const INTERACT = { pick: 0.25, place: 0.3, loot: 0.45, pay: 0.35, door: 0.4, switch: 0.3, lid: 0.3, break: 0.6 };
    audioFacade.taps.push((name) => { const a = INTERACT[name]; if (a) rumble('interact', a, 90); });
  }
  G.preRender.push(['settings-fps', () => fps_tick()]);
  apply();
  globalThis.__twtSettings = { TABS, TAB_ROWS, KB_TAB, row0, bump, revert, revert_everything, cycle_preset, pull };
  return G.settings;
}
