// Plug-in "title": the title screen as a living postcard of the robot world. While the game sits on the title screen
// the view clock shows the shop at dusk (lamps coming on, sunset behind the yard; ctx.hour_view, the rules' clock is
// untouched), a customer robot strolls along the shop front and a broken zombie robot limps about the far lot.
// The two robots are view-only actors (people.spawn + desc), never in the rules' lists; they leave with the title.
// ?noplug=title gives the old title back.
export async function install(G) {
  const g = G.g, P = G.people;
  if (!g || !P || !P.spawn) return false;
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
