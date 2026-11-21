// Plug-in "feedback": state for the hub's F9 bug-report kit (survivor-web-hub js/feedback-capture.js, loaded from index.html
// on the Pages host). The kit calls window.hubFeedbackState() when a player presses F9 and attaches the result to the report,
// so a bug report carries the game state: day, clock, hp, batteries, position, To Do lines, raid state and the last 50
// game events (notices, quest completions, mode / day / raid changes, damage taken). Read-only: nothing here changes the game.
// ?noplug=feedback turns it off.
const MAX = 50;

export async function install(G) {
  const ev = [];
  const push = (k, v) => {
    const g = G.g;
    ev.push({ t: g ? `d${g.day} ${hhmm(g.minutes)}` : '', k, v });
    if (ev.length > MAX) ev.shift();
  };
  let last = null;
  G.updaters.push(['feedback', () => {
    const g = G.g;
    if (!g) return;
    const done = g.done ? g.done.filter(Boolean).length : 0;
    const cur = { mode: g.mode, day: g.day, raid: !!(g.raid && g.raid.active), wave: g.raid ? g.raid.wave : 0, notice: g.notice_t > 0 ? g.notice : '', toast: g.toast_t > 0 ? g.toast : '', hp: Math.round(g.hp), done, panel: g.panel ? g.panel.k : '', open: !!g.open };
    if (last !== null) {
      if (cur.mode !== last.mode) push('mode', cur.mode);
      if (cur.day !== last.day) push('day', cur.day);
      if (cur.raid !== last.raid) push('raid', cur.raid ? 'start' : 'end');
      if (cur.raid && cur.wave !== last.wave) push('wave', cur.wave);
      if (cur.notice && cur.notice !== last.notice) push('notice', cur.notice);
      if (cur.toast && cur.toast !== last.toast) push('quest', cur.toast);
      if (cur.done > last.done) push('done', cur.done);
      if (cur.hp < last.hp) push('hurt', `${last.hp}->${cur.hp}`);
      if (cur.panel !== last.panel && cur.panel !== 'None') push('panel', cur.panel);
      if (cur.open !== last.open) push('store', cur.open ? 'open' : 'closed');
    }
    last = cur;
  }]);
  window.hubFeedbackState = () => {
    const g = G.g;
    if (!g) return { game: 'walking-trade-proc', build: window.__build, ready: false, events: ev.slice() };
    let todo = [];
    try { todo = g.todo().map((t) => t[1]); } catch (e) { todo = []; }
    return {
      game: 'walking-trade-proc', build: window.__build, mode: g.mode, day: g.day, time: hhmm(g.minutes),
      hp: Math.round(g.hp), hpMax: Math.round(g.hp_max || 100), batteries: g.batteries, rep: Math.round((g.rep || 0) * 100) / 100,
      storeOpen: !!g.open, pos: [r2(g.player.x), r2(g.player.y), r2(g.player.z)], yaw: r2(g.yaw), panel: g.panel ? g.panel.k : '',
      todo, raid: g.raid ? { active: !!g.raid.active, wave: g.raid.wave, nextDay: g.raid.next_day } : null,
      zombies: g.zombies ? g.zombies.filter((z) => !z.dead).length : 0, customers: g.customers ? g.customers.filter((c) => !c.gone).length : 0,
      fps: G.fps ? Math.round(G.fps) : undefined, errors: (window.__errors || []).slice(-5), events: ev.slice(),
    };
  };
}

function hhmm(min) {
  const m = Math.floor(min || 0);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
function r2(v) { return Math.round((v || 0) * 100) / 100; }
