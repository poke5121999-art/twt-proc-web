// Browser facade for the rules layer (the JS twin of the helpers in src/web.rs). Works in node too (tests).
const W = typeof window !== 'undefined' ? window : null;
const mem = new Map();
let SEARCH = W ? W.location.search : (globalThis.__twtSearch || '');
export function set_search(s) { SEARCH = s; }
export function query(name) {
  for (const part of SEARCH.replace(/^\?/, '').split('&')) {
    const i = part.indexOf('=');
    const k = i < 0 ? part : part.slice(0, i);
    if (k === name) { const v = i < 0 ? '' : part.slice(i + 1); try { return decodeURIComponent(v); } catch (e) { return v; } }
  }
  return null;
}
export function pointer_locked() { return W ? !!document.pointerLockElement : true; }
export function store_get(key) { try { if (W) { const v = W.localStorage.getItem(key); return v === null ? null : v; } } catch (e) {} return mem.has(key) ? mem.get(key) : null; }
export function store_set(key, value) { try { if (W) { W.localStorage.setItem(key, value); return; } } catch (e) {} mem.set(key, value); }
export function store_del(key) { try { if (W) { W.localStorage.removeItem(key); return; } } catch (e) {} mem.delete(key); }
export function number(name) { const v = W ? W[name] : globalThis[name]; return typeof v === 'number' && isFinite(v) ? v : null; }
export function now() { return Date.now(); }
export function seed() { const q = query('seed'); const v = q !== null ? parseInt(q, 10) : NaN; return Number.isFinite(v) ? v >>> 0 : ((Date.now() >>> 0) | 1) >>> 0; }
export function stage(name) { if (W && typeof W.twtStage === 'function') W.twtStage(name); }
export function set_global(name, value) { (W || globalThis)[name] = value; }
const SETTINGS_KEY = 'twtproc.settings.v1';
/** Lưu Settings (mức đồ hoạ, độ nhạy, âm lượng, đảo Y) vào localStorage; chỉ ghi khi đổi. */
export function save_settings(g, tier) {
  const v = `${tier},${g.sens.toFixed(2)},${g.volume.toFixed(2)},${g.invert ? 1 : 0}`;
  if (store_get(SETTINGS_KEY) !== v) store_set(SETTINGS_KEY, v);
}
/** Settings đã lưu: [mức đồ hoạ, độ nhạy, âm lượng, đảo Y] hoặc null. */
export function settings() {
  const s = store_get(SETTINGS_KEY); if (s === null) return null;
  const p = s.split(','); if (p.length < 4) return null;
  const t = parseInt(p[0], 10), se = parseFloat(p[1]), vo = parseFloat(p[2]);
  if (!Number.isFinite(t) || !Number.isFinite(se) || !Number.isFinite(vo)) return null;
  return [Math.min(Math.max(t, 0), 2), Math.min(Math.max(se, 0.3), 3.0), Math.min(Math.max(vo, 0), 1), p[3] === '1'];
}
let RAIN = 0;
export function set_rain(v) { RAIN = v; }
export function rain_level() { return RAIN; }
