// Plug-in "pricetag": a paper price tag clipped to the front lip of every shelf slot that holds goods (item icon, short
// name, price in batteries with a battery glyph), so a new player sees prices and where to change them. Aiming at a tag
// (rules target 'Tag', sim/player.js tag_box) lights it with a yellow frame and the prompt reads "[E] Set price"; E opens
// the existing price panel (Q still works). When an item's price changes, its tags flip over and flash.
// View only: prices, slots and the target are the rules'. Tags follow g.shelves live (stacking, built shelves, save/load
// all go through the same shelf slots). ?noplug=pricetag turns the tags off (the rules target stays).
import * as THREE from '../../vendor/three.module.min.js';
import { noMask } from '../mats.js';
import * as items from '../sim/items.js';
import { item_icon } from '../icons.js';
import * as lay from '../sim/lay.js';
import { tag_y, plank_tag_slot } from '../sim/player.js';

const W = 0.26, H = 0.09, LIP_Y = 0.41, LIP_Z = 0.2525; // top edge just above the board top (0.445), hanging over the lip
const CW = 320, CH = 116;
const hexs = (c) => '#' + (c & 0xffffff).toString(16).padStart(6, '0');
function shortName(s) {
  const t = s.replace(/^(Tinned|Bottle of|Box of|Can of)\s+/i, '');
  return t.length > 13 ? t.slice(0, 12) + '.' : t;
}
function batteryGlyph(x, cx, cy, s) {
  x.save(); x.translate(cx, cy);
  x.fillStyle = '#2b2f33'; x.fillRect(-s * 0.32, -s * 0.62, s * 0.64, s * 1.18);
  x.fillRect(-s * 0.14, -s * 0.76, s * 0.28, s * 0.16);
  x.fillStyle = '#7ad04a'; x.fillRect(-s * 0.22, -s * 0.05, s * 0.44, s * 0.52);
  x.restore();
}

export async function install(G) {
  const g = G.g;
  const root = new THREE.Group(); root.name = 'price-tags'; G.scene.add(root);
  const geo = new THREE.PlaneGeometry(W, H);
  const frameGeo = new THREE.PlaneGeometry(W + 0.018, H + 0.016);
  const frameMat = noMask(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.9, 0.35), toneMapped: true }));
  const mats = new Map(); // `${item}:${price}` -> { mat, ready }
  const img = new Map(); // item -> Image (icon) once baked
  const draw = (item, price) => {
    const c = document.createElement('canvas'); c.width = CW; c.height = CH;
    const x = c.getContext('2d');
    const [, col] = items.look(item);
    // card: warm paper, item-coloured band on the left, thin dark border
    x.fillStyle = '#f3ede0'; x.fillRect(0, 0, CW, CH);
    x.fillStyle = hexs(col); x.fillRect(0, 0, 108, CH);
    x.fillStyle = 'rgba(255,255,255,0.18)'; x.fillRect(0, 0, 108, CH * 0.45);
    const im = img.get(item);
    let ready = true;
    if (im && im.complete && im.naturalWidth) x.drawImage(im, 6, 10, 96, 96);
    else {
      ready = false;
      const u = item_icon(item);
      if (u && !img.has(item)) { const I = new Image(); I.src = u; img.set(item, I); }
      x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(24, 28, 60, 60);
    }
    x.strokeStyle = '#2a2c30'; x.lineWidth = 6; x.strokeRect(3, 3, CW - 6, CH - 6);
    x.fillStyle = '#2a2c30'; x.fillRect(108, 3, 4, CH - 6);
    // price: big, dark, with a battery glyph; name small above
    x.fillStyle = '#33332f'; x.font = 'bold 28px sans-serif'; x.textBaseline = 'top'; x.textAlign = 'left';
    x.fillText(shortName(items.iname(item)), 122, 10);
    const ps = String(price);
    x.fillStyle = '#16181b'; x.font = 'bold ' + (ps.length > 3 ? 58 : 72) + 'px sans-serif'; x.textBaseline = 'alphabetic';
    x.fillText(ps, 122, 104);
    const pw = x.measureText(ps).width;
    batteryGlyph(x, 122 + pw + 24, 80, 34);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return { tex: t, ready };
  };
  // one texture per (item, price), redrawn once the item's icon has been baked; one material per tag (own tint)
  const texFor = (item, price) => {
    const k = item + ':' + price;
    let m = mats.get(k);
    if (m && !m.ready) {
      const im = img.get(item);
      if ((im && im.complete && im.naturalWidth) || (!im && item_icon(item))) { m.tex.dispose(); m = null; }
    }
    if (!m) { m = draw(item, price); mats.set(k, m); }
    return m.tex;
  };
  const tags = new Map(); // shelf -> array of { mesh, frame, item, price, flip }
  const lastPrice = new Map(); // item -> price seen
  const S = G.pricetags = { count: 0, flips: 0 };

  G.updaters.push(['pricetag', (dt) => {
    let n = 0;
    const live = new Set(g.shelves);
    for (const [sh, arr] of tags) if (!live.has(sh)) { for (const t of arr) if (t) { root.remove(t.mesh); } tags.delete(sh); }
    const lt = g.look_tag;
    for (let si = 0; si < g.shelves.length; si++) {
      const sh = g.shelves[si];
      let arr = tags.get(sh);
      if (!arr) { arr = []; tags.set(sh, arr); }
      for (let k = 0; k < sh.slots.length; k++) {
        const it = sh.slots[k];
        let t = arr[k];
        if (it === null || (sh.plank && plank_tag_slot(sh, k % sh.cols) !== k)) { if (t) t.mesh.visible = false; continue; }
        if (!t) {
          const mesh = new THREE.Mesh(geo, noMask(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.15, 1.15, 1.15) }))); mesh.castShadow = false; mesh.receiveShadow = false;
          const frame = new THREE.Mesh(frameGeo, frameMat); frame.position.z = -0.0015; frame.visible = false; mesh.add(frame);
          root.add(mesh); t = arr[k] = { mesh, frame, item: -1, price: -1, flip: 0 };
        }
        const price = g.prices[it];
        if (t.item !== it || t.price !== price) {
          if (t.item === it && t.price !== price) { t.flip = 0.36; S.flips++; }
          t.item = it; t.price = price;
        }
        // flip about the tag's horizontal axis; the new price shows from half way; flash while it turns
        t.flip = Math.max(0, t.flip - dt);
        const f = t.flip > 0 ? 1 - t.flip / 0.36 : 1;
        const tex = texFor(it, f < 0.5 && t.flip > 0 ? lastPrice.get(it) ?? price : price);
        if (t.mesh.material.map !== tex) { t.mesh.material.map = tex; t.mesh.material.needsUpdate = true; }
        const col = k % sh.cols, lvl = Math.trunc(k / sh.cols);
        const lx = (col + 0.5 - sh.cols * 0.5) * 0.6;
        const c = Math.cos(sh.yaw), s = Math.sin(sh.yaw);
        // kệ ván: một thẻ mỗi cột (món trước nhất) treo dưới mép trước, ngả ra sau 0,35 rad; kệ tầng: mỗi tầng một thẻ dưới mép ván
        const lz = sh.plank ? lay.PLANK_FRONT + 0.006 : LIP_Z, ly = sh.plank ? tag_y() : LIP_Y + lvl * 0.5;
        t.mesh.position.set(sh.pos.x + c * lx + s * lz, ly + sh.pos.y, sh.pos.z - s * lx + c * lz);
        t.base = 1;
        t.mesh.rotation.set((t.flip > 0 ? Math.PI * 2 * f : 0) + (sh.plank ? -0.35 : 0), sh.yaw, 0, 'YXZ');
        const hl = lt && lt[0] === si && lt[1] === k;
        t.frame.visible = !!hl;
        const flash = t.flip > 0 ? Math.sin(Math.PI * f) * 0.9 : 0;
        const pulse = hl ? 0.25 + 0.12 * Math.sin(G.t * 9) : 0;
        t.mesh.material.color.setScalar(1.15 + flash + pulse);
        const sc = (hl ? 1.08 : 1) * t.base;
        t.mesh.scale.set(sc, sc * (sh.plank ? 0.86 : 1), 1);
        t.mesh.visible = true; n++;
      }
      for (let k = sh.slots.length; k < arr.length; k++) if (arr[k]) arr[k].mesh.visible = false;
    }
    for (const [sh, arr] of tags) for (const t of arr) if (t && t.flip <= 0 && t.item >= 0) lastPrice.set(t.item, t.price);
    S.count = n;
  }]);
  return S;
}
