// Sound facade for the rules layer (the JS twin of the `audio::` calls in the Rust). The view installs the engine.
let ENGINE = null, DISABLED = false, VOLUME = 1, MIX = null;
export const log = [];
/** [par-panels] view-side listeners of every played sound name (Settings: gamepad rumble on interaction sounds). */
export const taps = [];
export function install(engine) { ENGINE = engine; if (ENGINE && ENGINE.set_volume) ENGINE.set_volume(VOLUME); if (ENGINE && ENGINE.set_mix && MIX) ENGINE.set_mix(MIX); }
export function disable() { DISABLED = true; }
export function is_disabled() { return DISABLED; }
export function set_volume(v) { VOLUME = v; if (ENGINE && ENGINE.set_volume) ENGINE.set_volume(v); }
export function volume() { return VOLUME; }
/** [par-panels] Settings buses { master, music, sfx, amb, ui } (0..1 each; master is also set_volume). */
export function set_mix(m) { MIX = Object.assign({}, m); if (ENGINE && ENGINE.set_mix) ENGINE.set_mix(MIX); }
export function mix() { return MIX; }
export function play(name, vol, pos = null) {
  if (log.length < 4096) log.push(name);
  for (let i = 0; i < taps.length; i++) { try { taps[i](name, vol); } catch (e) { /* a view listener must not break the rules */ } }
  if (!DISABLED && ENGINE) ENGINE.play(name, vol, pos);
}
export function ambience(levels) { if (!DISABLED && ENGINE && ENGINE.ambience) ENGINE.ambience(levels); }
