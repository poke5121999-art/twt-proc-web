// Sound facade for the rules layer (the JS twin of the `audio::` calls in the Rust). The view installs the engine.
let ENGINE = null, DISABLED = false, VOLUME = 1;
export const log = [];
export function install(engine) { ENGINE = engine; if (ENGINE && ENGINE.set_volume) ENGINE.set_volume(VOLUME); }
export function disable() { DISABLED = true; }
export function is_disabled() { return DISABLED; }
export function set_volume(v) { VOLUME = v; if (ENGINE && ENGINE.set_volume) ENGINE.set_volume(v); }
export function volume() { return VOLUME; }
export function play(name, vol, pos = null) { if (log.length < 4096) log.push(name); if (!DISABLED && ENGINE) ENGINE.play(name, vol, pos); }
export function ambience(levels) { if (!DISABLED && ENGINE && ENGINE.ambience) ENGINE.ambience(levels); }
