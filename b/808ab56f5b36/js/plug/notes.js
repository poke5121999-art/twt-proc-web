// Plug-in "notes": the original's notification column on the right of the HUD, under the OPEN / CLOSED plate
// (PARITY M06 / M07 / M08; clip 18 4:00 and 24:42):
//   - blue card tracking the running Drop Dead Docks contract: "Sell *15 Rope", "1 Days" + clock, "0 / 15", the item square
//     on the right, thin progress bar (M07);
//   - green card "You are currently promoting X..." + "N Days" while a Mobile News Crew campaign runs (M08);
//   - green notice cards with a check square, e.g. "Contract complete, good job! A reward has been delivered outside the
//     store." (M06). The rules push notices into globalThis.__twtNotes ({ kind: 'ok', text }); without this plug-in they
//     fall back to the bottom line (g.say).
// View only: reads G.g, never writes rules state. Own DOM node appended to the HUD's top-right stack (re-attached if the HUD
// rebuilds), own stylesheet (notes.css). ?noplug=notes removes it.
import * as icons from '../icons.js';
import * as items from '../sim/items.js';
import * as combat from '../sim/combat.js';

const CLOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#fff"/><path d="M12 6v6l4 2" stroke="#2a3a4a" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.5l5 5 10-11" stroke="#fff" stroke-width="3.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const BUBBLE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v10H10l-4 4v-4H4z" fill="#d8ffe0"/><path d="M7.5 9h9M7.5 12h6" stroke="#1f9a3e" stroke-width="1.6" stroke-linecap="round"/></svg>';
const NOTE_S = 8; // seconds a notice card stays (real time)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const daysTxt = (n) => `${n} Days`; // the original writes "1 Days"

export async function install(G) {
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = new URL('./notes.css', import.meta.url).href;
  document.head.appendChild(link);
  const col = document.createElement('div');
  col.className = 'tn-col'; col.dataset.plug = 'notes';
  const promo = document.createElement('div'); promo.className = 'tn-card tn-promo'; promo.hidden = true;
  const con = document.createElement('div'); con.className = 'tn-card tn-con'; con.hidden = true;
  // [FTUE A6] gốc UpcomingRaidDetailsView "Raid Rumour" (MajorNotificationLayout/RaidIntelDetails): thẻ cam từ lúc raid lộ ra
  const rum = document.createElement('div'); rum.className = 'tn-card tn-rumour'; rum.hidden = true;
  col.append(rum, promo, con);
  let rumSig = '';
  const queue = globalThis.__twtNotes = [];
  const live = []; // { el, t }
  let promoSig = '', conSig = '';

  const attach = () => {
    if (col.isConnected) return true;
    const tr = document.querySelector('#hud .hd-tr');
    if (!tr) return false;
    tr.appendChild(col);
    return true;
  };

  G.updaters.push(['notes', (dt) => {
    if (!attach()) return;
    const g = G.g;
    if (!g) return;
    // [FTUE A6] Raid Rumour: raid lộ ra (sáng ngày raid như gốc EnsureRaidRevealedIfDue, hoặc radio báo sớm), chưa bắt đầu
    const rv = g.raid.next_day < 9000 && !g.raid.active && (g.day >= g.raid.next_day || g.raid.announced === true);
    let rs = '';
    if (rv) {
      let nw = 0;
      try { nw = combat.waves_of(g, g.raid.index).length; } catch (e) { nw = 0; }
      rs = `${Math.max(g.raid.next_day - g.day, 0)}|${nw}`;
    }
    if (rs !== rumSig) {
      rumSig = rs;
      rum.hidden = !rv;
      if (rv) {
        const [d, nw] = rs.split('|');
        rum.innerHTML = `<span class="tn-t"><b class="tn-h">Raid Rumour</b><span class="tn-rr">${daysTxt(d)}${CLOCK}</span><span class="tn-rr">${nw} Waves</span><span class="tn-rr">East</span></span>`;
      }
    }
    // M08: running promotion
    const ad = g.ev && g.ev.ad;
    const ps = ad ? `${ad[0]}|${ad[2]}` : '';
    if (ps !== promoSig) {
      promoSig = ps;
      promo.hidden = !ad;
      if (ad) promo.innerHTML = `<span class="tn-ic">${BUBBLE}</span><span class="tn-t">You are currently promoting <em>${esc(items.iname(ad[0]))}</em></span><span class="tn-days">${daysTxt(ad[2])}${CLOCK}</span>`;
    }
    // M07: contract being tracked
    const a = g.ev && g.ev.active;
    const icon = a ? icons.item_icon(a.item) : null;
    const cs = a ? `${a.item}|${a.have}|${a.target}|${a.expire - g.day}|${icon ? 1 : 0}` : '';
    if (cs !== conSig) {
      conSig = cs;
      con.hidden = !a;
      if (a) {
        const left = Math.max(a.expire - g.day, 0);
        const img = icon ? `<img src="${icon}" alt="" draggable="false">` : '';
        con.innerHTML = `<span class="tn-t"><span class="tn-sell">Sell *${a.target} <em>${esc(items.iname(a.item))}</em></span><span class="tn-days">${daysTxt(left)}${CLOCK}</span><span class="tn-prog">${Math.min(a.have, a.target)} / ${a.target}</span></span><span class="tn-item">${img}</span><i class="tn-bar"><b style="transform:scaleX(${Math.min(a.have / Math.max(a.target, 1), 1).toFixed(3)})"></b></i>`;
      }
    }
    // M06 and other notices
    while (queue.length) {
      const n = queue.shift();
      const el = document.createElement('div');
      el.className = 'tn-card tn-' + (n.kind || 'ok');
      el.innerHTML = `<span class="tn-ic">${CHECK}</span><span class="tn-t">${esc(n.text)}</span>`;
      col.appendChild(el);
      live.push({ el, t: 0 });
      while (live.length > 4) live.shift().el.remove();
    }
    for (let k = live.length - 1; k >= 0; k--) {
      const n = live[k];
      n.t += Math.min(dt, 0.1);
      if (n.t > NOTE_S && !n.el.classList.contains('out')) n.el.classList.add('out');
      if (n.t > NOTE_S + 0.4) { n.el.remove(); live.splice(k, 1); }
    }
  }]);
  return { col };
}
