// fin-build đợt 5: bảng "Item Details" (chuột phải trên vật cầm tay / vật chưa cố định) theo khung bảng gốc op/05: thanh tiêu đề
// "Item Details" + dấu X vàng, tên món màu độ hiếm, loại món, ô hình viền trắng + mô tả, Current Price / Est. Value, nút tích xanh.
// Tự chứa (CSS chèn một lần ở đây, mô tả lấy từ catalog gốc) để không đụng opanels.js của nhánh par-panels; kích thước theo vh
// như bảng của nhánh đó (đo trên gốc 1280x720).
// fin-build đợt 6: thêm hàng nút giá Est. Value / -1 / -10% / +1 / +10% và 3 công tắc Available for purchase, Ignore by Cleaner
// staff, Set for all <món> như gốc (SetItemPricePlayerStateView), đọc / ghi trạng thái thật qua items.det_state / det_act; vị trí
// đo trên op/05 (nút 60,4-65,2vh, công tắc 70,7 / 75,2 / 79,6vh, tích 82,8vh, đáy bảng 90vh).
import * as items from '../sim/items.js';
import * as data from '../sim/data.js';
import * as icons from '../icons.js';

// mô tả gốc (catalog.ron description) của các món cầm tay / vật dựng; món không có mô tả trong gốc thì để trống
const DESC = {"AutoMinigunItemData":"Impale zombies dumb enough to run head first into spikes.","BarbedWireItemData":"Impale zombies dumb enough to run head first into spikes.","BearTrapItemData":"Impale zombies dumb enough to run head first into spikes.","CheckoutItemData":"Allows customers to buy and sell goods at.","CoffeeTableItemData":"Used to display items on the shop floor.","DoubleStorageCrateItemData":"Use to store large amounts of items to keep your store organised.","DualShelvingUnit":"Used to display items on the shop floor.","ElegantTableItemData":"Used to display items on the shop floor.","ExplosiveBarrelItemData":"Explodes after taking so much damage.","FlimsyWoodenShelf":"Used to display items on the shop floor.","MediumStorageCrateItemData":"Use to store more mixed items to keep your store organised.","PalletItemData":"Used to display items on the shop floor.","Refrigerator":"Used to display items on the shop floor.","RemoteBombItemData":"Explodes after taking so much damage.","SecureShelf":"Used to display items on the shop floor.","SecureTable":"Used to display items on the shop floor.","SleepingBagItemData":"A durable rope used for attaching objects.","SpecialItemUnit":"Used to display items on the shop floor.","SpikeWallItemData":"Impale zombies dumb enough to run head first into spikes.","StorageCrateItemData":"Use to store mixed items to keep your store organised.","StudyDeskItemData":"Used to display items on the shop floor.","WastelandChilledCounterItemData":"Used to display items on the shop floor.","WastelandChillerItemData":"Used to display items on the shop floor.","WideWeaponRack":"Used to display items on the shop floor."};
const TYPES = ['Ammo', 'Appliance', 'Crafting', 'Decoration', 'Defence', 'Food', 'Gun', 'Medicine', 'Melee', 'Seeds', 'Shop', 'Survival', 'Throwable', 'Tool'];
const RARITY = ['Common', 'Uncommon', 'Rare', 'Sparse', 'Limited'];
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const BAT = '<i class="dt-bat" aria-hidden="true"><svg viewBox="0 0 28 14"><rect x="1" y="1" width="24" height="12" rx="6" fill="#fff"/><rect x="25" y="4.5" width="2.5" height="5" rx="1" fill="#fff"/><path d="M14.5 2.6 9.6 7.6h3.2l-1.4 3.8 5-5.2h-3.3z" fill="#111"/></svg></i>';

const CSS = `
#hud .hd-idet { position: fixed; inset: 0; z-index: 40; pointer-events: none; color: #fff; font-weight: 700; line-height: 1.2; }
#hud .hd-idet[hidden] { display: none; }
#hud .hd-idet .dim { position: absolute; inset: 0; background: rgba(0,0,0,.42); }
#hud .hd-idet .pn { position: absolute; left: 50%; top: 11.8vh; width: 66.4vh; transform: translateX(-50%); background: #26282b; box-shadow: 0 1vh 4vh rgba(0,0,0,.6); }
#hud .hd-idet header { position: relative; height: 6.7vh; background: #18191b; display: flex; align-items: center; justify-content: center; }
#hud .hd-idet header h2 { margin: 0; font-size: 3.1vh; font-weight: 900; color: #fff; letter-spacing: normal; }
#hud .hd-idet header .x { position: absolute; right: 2.6vh; top: 1.6vh; color: #f5c518; font-size: 3.3vh; line-height: 1; font-weight: 900; }
#hud .hd-idet .body { padding: 2vh 3.6vh 2.4vh; background: linear-gradient(180deg, #2a2c2f, #232528); }
#hud .hd-idet h1 { margin: 0; text-align: center; font-size: 4.1vh; font-weight: 900; letter-spacing: normal; }
#hud .hd-idet .r0 { color: #f5d138; } #hud .hd-idet .r1 { color: #5fe35f; } #hud .hd-idet .r2 { color: #5aa8ff; } #hud .hd-idet .r3 { color: #c07cff; } #hud .hd-idet .r4 { color: #ff9d2e; }
#hud .hd-idet .ty { text-align: center; font-size: 2.7vh; margin-bottom: 2.5vh; }
#hud .hd-idet .pic { display: flex; align-items: center; gap: 1.6vh; }
#hud .hd-idet .pic .img { flex: none; width: 17.4vh; height: 17.4vh; padding: 1.6vh; box-sizing: border-box; border: .3vh solid #9a9a9a; box-shadow: 0 0 1.2vh rgba(255,255,255,.35); background: #5a5c5f radial-gradient(rgba(0,0,0,.35) 1px, transparent 1.3px) 0 0 / 4px 4px; }
#hud .hd-idet .pic .img img { display: block; width: 100%; height: 100%; object-fit: contain; }
#hud .hd-idet .pic p { margin: 0; font-size: 2vh; line-height: 1.4; }
#hud .hd-idet .sep { display: block; height: .25vh; margin: 1.6vh -1vh; background: linear-gradient(90deg, transparent, #4a4c4f 6%, #4a4c4f 94%, transparent); }
#hud .hd-idet .kv { display: flex; justify-content: space-between; align-items: center; padding: 0 1.5vh; font-size: 2.1vh; font-weight: 600; margin: .8vh 0; }
#hud .hd-idet .kv.big { font-size: 2.8vh; font-weight: 800; }
#hud .hd-idet .kv span:last-child { width: 12vh; display: flex; align-items: center; }
#hud .hd-idet .kv .g { color: #5ff05f; }
#hud .hd-idet .dt-bat { display: inline-block; width: 2.6vh; height: 1.3vh; margin-right: .5vh; }
#hud .hd-idet .dt-bat svg { display: block; width: 100%; height: 100%; }
#hud .hd-idet .btns { display: flex; gap: 3.1vh; padding: 0 2vh; margin: .9vh 0 0; }
#hud .hd-idet .btns button { pointer-events: auto; cursor: pointer; height: 4.8vh; min-width: 6.9vh; padding: 0 .6vh; box-sizing: border-box; font: inherit; font-size: 2.3vh; font-weight: 900; color: #fff; border: .3vh solid; text-shadow: 0 .15vh 0 rgba(0,0,0,.35); }
#hud .hd-idet .btns .be { width: 15.6vh; background: #d9b21c; border-color: #f7dd55; color: #fff8d0; }
#hud .hd-idet .btns .br { background: #a5201f; border-color: #d8403c; color: #ffd6d2; }
#hud .hd-idet .btns .bg { background: #23922a; border-color: #4fd357; color: #e4ffe2; }
#hud .hd-idet .tg { display: flex; justify-content: space-between; align-items: center; height: 4.4vh; padding: 0 1.4vh 0 1.8vh; font-size: 2.15vh; font-weight: 600; border-bottom: .2vh dotted rgba(255,255,255,.12); }
#hud .hd-idet .tg:last-of-type { border-bottom: none; }
#hud .hd-idet .tg .y { color: #f5c518; font-style: normal; }
#hud .hd-idet .tg button { pointer-events: auto; cursor: pointer; position: relative; width: 6vh; height: 2vh; padding: 0; border: none; border-radius: .5vh; background: #141516; }
#hud .hd-idet .tg button i { position: absolute; top: .3vh; bottom: .3vh; width: 2.6vh; border-radius: .3vh; }
#hud .hd-idet .tg button.on i { right: .4vh; background: #3fd06a; box-shadow: 0 0 .8vh rgba(63,208,106,.55); }
#hud .hd-idet .tg button.off i { left: 1.4vh; background: #d03a3a; box-shadow: 0 0 .8vh rgba(208,58,58,.55); }
#hud .hd-idet .tick { display: flex; width: 6vh; height: 6vh; margin: 1.5vh auto 0; padding: .6vh; box-sizing: border-box; background: #1f8f1f; border: .28vh solid #57e057; }
#hud .hd-idet .tick svg { display: block; width: 100%; height: 100%; }
#hud .hd-idet .ft .k { display: inline-block; min-width: 1.5em; padding: .05em .35em; margin: 0 .15em; border-radius: .25em; background: #e9e6dc; color: #111; font-weight: 700; font-size: .9em; text-align: center; box-shadow: 0 .14em 0 #8b887f; }
#hud .hd-idet .ft { position: absolute; left: 50%; bottom: .6vh; transform: translateX(-50%); padding: .35vh 1.2vh; background: rgba(12,13,14,.88); border-radius: .4vh; font-size: 1.45vh; color: rgba(255,255,255,.8); white-space: nowrap; font-weight: 600; }
`;
let styled = false;
function style() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const el = document.createElement('style');
  el.dataset.src = 'plug/details.js';
  el.textContent = CSS;
  document.head.appendChild(el);
}

/** Nội dung bảng cho món `i` và khoá để chỉ dựng lại khi đổi (hình món có thể chưa sẵn ở khung đầu). */
export function details_html(g, i, pid = 0) {
  style();
  const [img, ready] = icons.icon_html({ k: 'Item', a: i });
  const r = Math.min(Math.max(data.INFO[i] ? data.INFO[i].rarity : 0, 0), 4);
  const v = items.ival(i);
  const st = items.det_state(g, i, pid);
  const d = DESC[items.cat_key(i)] || '';
  const sw = (on, act, label) => `<div class="tg"><span>· ${label}</span><button type="button" data-dact="${act}" class="${on ? 'on' : 'off'}" aria-pressed="${on}"><i></i></button></div>`;
  const html = `<div class="dim"></div><div class="pn">
  <header><h2>Item Details</h2><span class="x">✕</span></header>
  <div class="body">
    <h1 class="r${r}">${esc(items.iname(i))}</h1><div class="ty">${TYPES[items.ty_of(i)] || ''} <span class="r${r}">· ${RARITY[r]}</span></div>
    <div class="pic"><span class="img">${img}</span><p>${esc(d)}</p></div>
    <i class="sep"></i>
    <div class="kv big"><span>Current Price:</span><span>${BAT}<b class="g">${st.price}</b></span></div>
    <div class="kv"><span>Est. Value:</span><span>${BAT}<b>${v}</b></span></div>
    <div class="btns"><button type="button" class="be" data-dact="est">Est. Value</button><button type="button" class="br" data-dact="m1">-1</button><button type="button" class="br" data-dact="m10">-10%</button><button type="button" class="bg" data-dact="p1">+1</button><button type="button" class="bg" data-dact="p10">+10%</button></div>
    <i class="sep"></i>
    ${sw(st.avail, 'avail', 'Available for purchase')}
    ${sw(st.noclean, 'clean', 'Ignore by Cleaner staff')}
    ${sw(st.all, 'all', `Set for all <em class="y">${esc(items.iname(i))}</em>`)}
    <span class="tick"><svg viewBox="0 0 24 24"><path d="M3 12.5 9 18.5 21 5.5" fill="none" stroke="#5ff05f" stroke-width="3.4" stroke-linecap="square"/></svg></span>
  </div></div>
  <div class="ft"><b class="k">A</b><b class="k">D</b> -1 / +1 &nbsp;<b class="k">Shift</b> 10% &nbsp;<b class="k">R</b> Est. Value &nbsp;<b class="k">1</b><b class="k">2</b><b class="k">3</b> toggles &nbsp;<b class="k">RMB</b> / <b class="k">Esc</b> close</div>`;
  return [html, `${i}:${ready}:${st.price}:${st.avail}:${st.noclean}:${st.all}`];
}

/** Bấm nút trên bảng (con trỏ nhả): đổi trạng thái thật như phím tắt. */
export function details_click(g, act) {
  if (g === null || g.panel.k !== 'Details') return;
  items.det_act(g, g.panel.a, g.panel.b || 0, act);
}
