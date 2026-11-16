// Plug-in "title": the title screen as a living postcard of the robot world. While the game sits on the title screen
// the view clock shows the shop at dusk (lamps coming on, sunset behind the yard; ctx.hour_view, the rules' clock is
// untouched), a customer robot strolls along the shop front and a broken zombie robot limps about the far lot.
// The two robots are view-only actors (people.spawn + desc), never in the rules' lists; they leave with the title.
// ?noplug=title gives the old title back.
// Title menu in the card style of the other panels (fin-shopui batch 3-4): four action cards with icon, title, one line of
// help and the key chip, the Enter action selected by default, hover selects (mouse cursor free on the title), a click
// presses that card's key for one frame. Same four actions and keys as the text menu (hud.js panel_text 'Title'), which
// stays underneath as the fallback (?panels=text or ?noplug=title).
const MENU = [
  { key: 'Enter', chip: 'Enter', title: 'New game', sub: 'Day 1, 05:30: clean up the shop, then open for business', ic: 'play' },
  { key: 'KeyK', chip: 'K', title: 'Skip introduction', sub: 'Start at 09:00 with the shop already cleaned', ic: 'skip' },
  { key: 'KeyC', chip: 'C', title: 'Continue', sub: 'Load the last saved game', ic: 'cont' },
  { key: 'KeyV', chip: 'V', title: 'Saved games', sub: '3 slots: load, rewind a night, delete', ic: 'list' },
];
const ICON = {
  play: '<path d="M8 5l12 7-12 7z"/>',
  skip: '<path d="M4 5l9 7-9 7zM13 5l9 7-9 7z"/>',
  cont: '<path d="M12 4a8 8 0 1 0 8 8h-3a5 5 0 1 1-5-5v3l5-4.5L12 1z"/>',
  list: '<path d="M4 5h16v3H4zM4 10.5h16v3H4zM4 16h16v3H4z"/>',
};
const CSS = `
#hud .tl-menu { display: none; }
/* phiên 8: trang tải (body.loading, nút #go "Vào game") còn hiện thì menu thẻ chưa nhận chuột: trước đây thẻ nằm đè nút #go, bấm
   "Vào game" khi tải lại trang rơi vào thẻ (bot flow / day1loop / craft trên Pages a570d60cbadc kẹt 30 s) */
body.loading #hud .tl-menu { visibility: hidden; pointer-events: none; }
body.loading #hud .tl-menu .tl-card { pointer-events: none; }
#hud [data-pk="Title"] .tl-menu { display: flex; flex-direction: column; gap: 0.45em; }
#hud [data-pk="Title"] .hd-ptext { display: none; }
#hud .tl-menu .tl-card { appearance: none; border: 0; margin: 0; font: inherit; color: inherit; text-align: left; cursor: pointer; pointer-events: auto;
  display: grid; grid-template-columns: 2.6em 1fr auto; align-items: center; gap: 0.15em 0.85em; padding: 0.6em 0.85em; border-radius: 0.45em;
  background: rgba(255,255,255,.065); box-shadow: inset 0 0 0 1px rgba(255,255,255,.07);
  transition: background-color 120ms var(--ease), box-shadow 120ms var(--ease), transform 120ms var(--ease); animation: hd-card-in 200ms var(--ease) both; }
#hud .tl-menu .tl-card:nth-child(2) { animation-delay: 30ms; } #hud .tl-menu .tl-card:nth-child(3) { animation-delay: 60ms; } #hud .tl-menu .tl-card:nth-child(4) { animation-delay: 90ms; }
#hud .tl-menu .tl-ic { grid-row: span 2; width: 2.6em; height: 2.6em; border-radius: 0.4em; display: grid; place-items: center; background: rgba(0,0,0,.35); box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); }
#hud .tl-menu .tl-ic svg { width: 1.45em; height: 1.45em; fill: var(--mute); transition: fill 120ms var(--ease), transform 160ms var(--ease); }
#hud .tl-menu b { font-size: 1.18em; font-weight: 700; color: #f2efe4; letter-spacing: 0.01em; }
#hud .tl-menu small { grid-column: 2; font-size: 0.86em; color: var(--mute); text-wrap: pretty; }
#hud .tl-menu kbd { grid-row: span 2; grid-column: 3; font-size: 0.95em; min-width: 2.2em; }
#hud .tl-menu .tl-card.sel { box-shadow: inset 0 0 0 2px var(--yel), 0 0 1.2em -0.3em rgba(245,209,56,.45); background-color: rgba(245,209,56,.1); }
#hud .tl-menu .tl-card.sel .tl-ic svg { fill: var(--yel); transform: scale(1.08); }
#hud .tl-menu .tl-card.off { opacity: .5; }
#hud .tl-menu .tl-card:active { transform: scale(.98); }
#hud .tl-menu .tl-keys { display: flex; flex-wrap: wrap; gap: 0.3em 1em; margin-top: 0.35em; font-size: 0.86em; color: var(--mute); }
#hud .tl-menu .tl-keys span { display: inline-flex; align-items: center; gap: 0.4em; }
#hud .tl-menu .tl-keys kbd { grid-row: auto; grid-column: auto; font-size: 0.9em; min-width: 1.6em; }
#hud [data-pk="Title"] .hd-panel { width: min(30em, 44vw); min-width: 22em; }
@media (prefers-reduced-motion: reduce) { #hud .tl-menu .tl-card { animation: none; transition: none; } }
`;

function buildMenu(G, save) {
  const panel = document.querySelector('#hud .hd-panel');
  if (!panel || panel.querySelector('.tl-menu')) return null;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const m = document.createElement('div'); m.className = 'tl-menu';
  m.innerHTML = MENU.map((it, i) => `<button class="tl-card${i === 0 ? ' sel' : ''}" type="button" tabindex="-1" data-i="${i}">` +
    `<span class="tl-ic"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[it.ic]}</svg></span><b>${it.title}</b><small>${it.sub}</small><kbd>${it.chip}</kbd></button>`).join('') +
    '<div class="tl-keys"><span><kbd>WASD</kbd>move</span><span><kbd>E</kbd>use</span><span><kbd>LMB</kbd>attack</span><span><kbd>L</kbd>all controls in game</span></div>';
  panel.insertBefore(m, panel.firstChild);
  const cards = [...m.querySelectorAll('.tl-card')];
  let sel = 0;
  const pick = (i) => { sel = i; cards.forEach((c, k) => c.classList.toggle('sel', k === i)); };
  cards.forEach((c, i) => {
    c.addEventListener('mouseenter', () => pick(i));
    c.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (c.classList.contains('off')) return;
      const code = MENU[i].key;
      // one frame of the same key the text menu uses, so the rules do exactly what the key does
      window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code === 'Enter' ? 'Enter' : code.slice(3).toLowerCase() }));
      setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code })), 60);
    });
  });
  m.addEventListener('mouseleave', () => pick(0));
  // Continue greys out when no slot holds a save (the key still does what it did: nothing to load)
  const refresh = () => {
    let any = false;
    try { for (let k = 0; k < (save.SLOTS || 3); k++) if (save.summary(k, false) !== null) { any = true; break; } } catch (e) { any = true; }
    cards[2].classList.toggle('off', !any);
  };
  return { el: m, refresh, pick, get sel() { return sel; } };
}

export async function install(G) {
  const g = G.g, P = G.people;
  if (!g || !P || !P.spawn) return false;
  const TEXT = /[?&]panels=text\b/.test(location.search);
  let menu = null, menuT = 0;
  const save = await import('../sim/save.js');
  const DUSK = 19.15;
  let actors = null, t = 0;
  const pos = (x, z) => ({ x, y: 0, z });
  function spawn() {
    const cust = P.spawn(0x7e57a11, null, pos(-2.6, 6.7), { role: 'customer' });
    const zomb = P.spawn(0x2bad5eed, 'Base', pos(-7.5, 12.0), {});
    actors = { cust, zomb };
  }
  function drop() {
    if (!actors) return;
    for (const k in actors) { try { actors[k].despawn(); } catch (e) { /* already gone */ } }
    actors = null;
  }
  G.updaters.push(['title', (dt) => {
    if (g.mode !== 'Title') {
      if (actors) drop();
      if (G.ctx.hour_view != null) G.ctx.hour_view = null;
      return;
    }
    G.ctx.hour_view = DUSK;
    if (!actors) spawn();
    if (!TEXT && !menu) menu = buildMenu(G, save);
    if (menu && (menuT -= dt) <= 0) { menuT = 1.0; menu.refresh(); }
    t += dt;
    // customer: walks the shop front between the windows, stops to look in at each end
    {
      const per = 16, u = (t % per) / per;                 // 0..1 round trip
      const leg = u < 0.5 ? u * 2 : (1 - u) * 2;            // 0..1..0
      const hold = (k) => Math.min(1, Math.max(0, (k - 0.12) / 0.76)); // pause at the ends
      const s = hold(leg), x = -3.0 + 6.0 * (s * s * (3 - 2 * s));
      const moving = leg > 0.12 && leg < 0.88;
      const dir = u < 0.5 ? 1 : -1;
      const yaw = moving ? (dir > 0 ? -Math.PI / 2 : Math.PI / 2) : 0; // yaw 0 = facing -z (the shop)
      actors.cust.update({ pos: pos(x, 6.7), yaw, moving, state: moving ? 'Walk' : 'Look', timer: 1 });
    }
    // zombie: a slow lurching loop out on the lot, half turned toward the shop
    {
      const a = t * 0.11, x = -7.5 + Math.sin(a) * 2.2, z = 12.0 + Math.sin(a * 2) * 0.9;
      const dx = Math.cos(a) * 2.2, dz = Math.cos(a * 2) * 1.8;
      actors.zomb.update({ pos: pos(x, z), yaw: Math.atan2(-dx, -dz), moving: true });
    }
  }]);
  return { dusk: DUSK };
}
