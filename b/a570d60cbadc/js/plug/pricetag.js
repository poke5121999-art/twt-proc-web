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
import { tag_y, plank_tag_slot, hover_tag_ok, HOVER_TAG_DY } from '../sim/player.js';

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
  const S = G.pricetags = { count: 0, flips: 0, hover: null };
  // [phiên 8] hover tag: the plank keeps ONE thin row of tags (front-most item per column). A back-row item of another kind
  // gets its own tag only while it is aimed (rules g.hover_tag): it pops up right above that item with a small pointer
  // down to it, framed yellow when the tag itself is aimed ([E] Set price) and soft-framed while the slot is aimed.
  const hov = new THREE.Group(); hov.name = 'price-tag-hover'; hov.visible = false; root.add(hov);
  // phiên 8 đợt 3: thẻ nổi riêng cỡ 0,34 x 0,096 m, tên món chữ to (đọc được ở 1,5 m, 1080p), giá to bên dưới
  const HW = 0.34, HH = 0.096, HCW = 480, HCH = 136;
  const hgeo = new THREE.PlaneGeometry(HW, HH), hframeGeo = new THREE.PlaneGeometry(HW + 0.018, HH + 0.016);
  const htex = new Map();
  const hoverTex = (item, price) => {
    const key = item + ':' + price;
    let m = htex.get(key);
    const im = img.get(item);
    const iconOk = !!(im && im.complete && im.naturalWidth);
    if (m && !m.ready && iconOk) { m.tex.dispose(); m = null; }
    if (m) return m.tex;
    const c = document.createElement('canvas'); c.width = HCW; c.height = HCH;
    const x = c.getContext('2d');
    const [, col] = items.look(item);
    x.fillStyle = '#f3ede0'; x.fillRect(0, 0, HCW, HCH);
    x.fillStyle = hexs(col); x.fillRect(0, 0, 124, HCH);
    x.fillStyle = 'rgba(255,255,255,0.18)'; x.fillRect(0, 0, 124, HCH * 0.45);
    if (iconOk) x.drawImage(im, 8, 12, 108, 108);
    else { const u = item_icon(item); if (u && !img.has(item)) { const I = new Image(); I.src = u; img.set(item, I); } }
    x.strokeStyle = '#2a2c30'; x.lineWidth = 6; x.strokeRect(3, 3, HCW - 6, HCH - 6);
    x.fillStyle = '#2a2c30'; x.fillRect(124, 3, 4, HCH - 6);
    // name: as big as fits (44 px down to 30 px), full name, no "Tinned" cut
    const name = items.iname(item);
    let fs = 52; // phiên 8 đợt 3-4: tên món to (52 px trên thẻ 136 px), co lại tới 36 px nếu tên dài
    x.textBaseline = 'top'; x.textAlign = 'left';
    for (; fs > 36; fs -= 2) { x.font = 'bold ' + fs + 'px sans-serif'; if (x.measureText(name).width <= HCW - 150) break; }
    x.fillStyle = '#1f2023'; x.fillText(name.length > 22 ? name.slice(0, 21) + '.' : name, 140, 6);
    const ps = String(price);
    x.fillStyle = '#16181b'; x.font = 'bold 58px sans-serif'; x.textBaseline = 'alphabetic';
    x.fillText(ps, 140, 121);
    batteryGlyph(x, 140 + x.measureText(ps).width + 26, 99, 34);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    htex.set(key, { tex: t, ready: iconOk });
    return t;
  };
  const hovMesh = new THREE.Mesh(hgeo, noMask(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.3, 1.3) })));
  const hovFrame = new THREE.Mesh(hframeGeo, frameMat); hovFrame.position.z = -0.0015; hovMesh.add(hovFrame);
  const softMat = noMask(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.85, 0.7), transparent: true, opacity: 0.55 }));
  const hovSoft = new THREE.Mesh(hframeGeo, softMat); hovSoft.position.z = -0.0012; hovMesh.add(hovSoft);
  const ptrGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.022, 0, 0), new THREE.Vector3(0, -0.03, 0), new THREE.Vector3(0.022, 0, 0)]);
  const ptr = new THREE.Mesh(ptrGeo, frameMat); ptr.position.y = -HH * 0.5 + 0.001; hovMesh.add(ptr);
  for (const m of [hovMesh, hovFrame, hovSoft, ptr]) { m.castShadow = false; m.receiveShadow = false; }
  hov.add(hovMesh);
  let hovKey = '', hovT = 0;

  G.updaters.push(['pricetag', (dt) => {
    let n = 0;
    const live = new Set(g.shelves);
    for (const [sh, arr] of tags) if (!live.has(sh)) { for (const t of arr) if (t) { root.remove(t.mesh); } tags.delete(sh); }
    const lt = g.look_tag;
    const night = G.sky && G.sky.uniforms ? G.sky.uniforms.uNight.value : 0;
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
        // paper is unlit: dim it a little at night so it does not glow like a screen (lamps still light the shop)
        t.mesh.material.color.setScalar(1.15 * (1 - 0.3 * night) + flash + pulse);
        const sc = (hl ? 1.08 : 1) * t.base;
        t.mesh.scale.set(sc, sc * (sh.plank ? 0.86 : 1), 1);
        t.mesh.visible = true; n++;
      }
      for (let k = sh.slots.length; k < arr.length; k++) if (arr[k]) arr[k].mesh.visible = false;
    }
    for (const [sh, arr] of tags) for (const t of arr) if (t && t.flip <= 0 && t.item >= 0) lastPrice.set(t.item, t.price);
    S.count = n;
    // hover tag of a back-row item
    const ht = g.hover_tag, hsh = ht ? g.shelves[ht[0]] : null;
    if (hsh && hover_tag_ok(hsh, ht[1])) {
      const k = ht[1], it = hsh.slots[k], price = g.prices[it];
      const key = ht[0] + ':' + k;
      if (key !== hovKey) { hovKey = key; hovT = 0; }
      hovT = Math.min(1, hovT + dt / 0.14);
      const tex = hoverTex(it, price);
      if (hovMesh.material.map !== tex) { hovMesh.material.map = tex; hovMesh.material.needsUpdate = true; }
      const col = k % hsh.cols, lvl = Math.trunc(k / hsh.cols);
      const lx = (col + 0.5 - hsh.cols * 0.5) * lay.SLOT_W, lz = lay.PLANK_ROWS[lvl] + 0.02;
      const c = Math.cos(hsh.yaw), sn = Math.sin(hsh.yaw);
      const e = 1 - (1 - hovT) * (1 - hovT);
      hov.position.set(hsh.pos.x + c * lx + sn * lz, hsh.pos.y + lay.PLANK_TOP + HOVER_TAG_DY - 0.04 * (1 - e), hsh.pos.z - sn * lx + c * lz);
      hov.rotation.set(-0.22, hsh.yaw, 0, 'YXZ');
      const aimed = g.look_tag && g.look_tag[0] === ht[0] && g.look_tag[1] === k;
      hovFrame.visible = aimed; hovSoft.visible = !aimed;
      // ban đêm giấy không tự sáng: cùng mức giảm với thẻ trước (vis đợt 3: 1 - 0,3 night)
      hovMesh.material.color.setScalar(1.15 * (1 - 0.3 * night) + (aimed ? 0.22 + 0.1 * Math.sin(G.t * 9) : 0));
      softMat.opacity = 0.55 * (1 - 0.4 * night);
      const sc = (aimed ? 1.1 : 1) * (0.6 + 0.4 * e);
      hovMesh.scale.set(sc, sc, 1);
      hov.visible = true;
      S.hover = [ht[0], k, it];
    } else { hov.visible = false; hovKey = ''; S.hover = null; }
  }]);
  return S;
}
