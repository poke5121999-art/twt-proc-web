//! Bảng bố cục: nguồn duy nhất cho mọi chỗ có tên trong thế giới. Mọi file nguồn và mọi bot đọc toạ độ từ đây.
//! Đơn vị mét. Trục: +x đông, +z ra phía đường (mặt tiền quán), y lên. Cửa chính ở (0, 5,125).
//! Số đo bản gốc lấy từ `~/twt-bevy/docs/rules/measured/twt-hierarchy-new.jsonl` trên linux2 (cảnh ván mới,
//! ngày 1, 09:27). Cửa chính bản gốc ở thế giới (-99,65; -52,2); `o()` đổi toạ độ so với cửa đó sang hệ của bản này.
//! Bảng được xuất ra trang thành `window.__twtLay` (xem `json()`), bot gọi `T.at('tên')`.
// Port of src/lay.rs (see three/PORT-CONTRACT.md). Every table vector is frozen (k3); store `.clone()` into state.

import { Vec3, v3, k3, signum } from './vec.js';
import * as player from './player.js';

const f32 = Math.fround;
/** Đổi toạ độ bản gốc (so với cửa chính, +z ra đường) sang toạ độ bản này: x + 0,6; z + 5. (f32 sums as in the Rust) */
export function o(x, z) {
  return v3(f32(f32(x) + f32(0.6)), 0.0, f32(f32(z) + f32(5.0)));
}
/** frozen o() for the tables */
const ko = (x, z) => Object.freeze(o(x, z));
const v = k3;
/** Cùng chỗ, đổi độ cao. */
export function up(p, y) {
  return v3(p.x, y, p.z);
}
const fz = (a) => Object.freeze(a);

/** Trạng thái phòng do `build.rs` đặt: 2 bit thấp = số phòng mở rộng đã mở, bit 2 = cửa kho đã mở, bit 3 = cửa phòng y tế đã mở. */
let STATE = 0;

export function set_state(rooms, wh, med) {
  STATE = (Math.min(rooms, 3) | ((wh ? 1 : 0) << 2) | ((med ? 1 : 0) << 3)) & 255;
}
export function rooms() {
  return STATE & 3;
}
export function wh_open() {
  return (STATE & 4) !== 0;
}
export function med_open() {
  return (STATE & 8) !== 0;
}

/** Hộp trên mặt phẳng XZ: [minx, minz, maxx, maxz]. (type Box2 = [f32; 4]) */
export function inside(b, p) {
  return p.x > b[0] && p.x < b[2] && p.z > b[1] && p.z < b[3];
}

// ---------- phòng ----------

/** Sàn quán 10 × 10 m (gốc x -5,6..4,4; z -10,2..-0,2). */
export const SHOP = fz([-5.0, -5.0, 5.0, 5.0]);
/** Phòng ngủ phía -x sau quán (gốc x -10,7..-5,6; z -10,2..-5,7). */
export const BEDROOM = fz([-9.5, -5.0, -5.0, -1.0]);
/** Vỏ phòng y tế (khoá, chưa vào được) phía -x trước quán (gốc `MedicalRoom`, tường trước z -0,2). */
export const MEDICAL = fz([-9.75, -1.0, -5.25, 5.25]);
/** Vỏ hai phần mở rộng SF2 + SF3 phía +x (gốc tâm x 9,4 và 19,4; tường trước z -1,8; chưa mở). */
export const EXPANSION = fz([5.25, -5.25, 25.0, 3.2]);
/** Vỏ nhà kho sau quán (gốc x -5,6..14,4; z -10,2..-24,2; trần 6,9 m; chưa mở). */
export const WAREHOUSE = fz([-5.25, -19.2, 15.0, -5.25]);
/** Chiều cao vỏ nhà kho. */
export const WAREHOUSE_H = 6.9;
/** Bãi trong hàng rào dây (gốc rào ở x ≈ -24, x ≈ 30,5, z ≈ 35; sau nhà kho). */
export const LOT = fz([-23.4, -20.5, 31.1, 40.0]);
/** Chỗ đứng phục vụ sau quầy. */
export const SERVICE = fz([-3.2, -5.0, 3.2, -2.9]);
/** Ranh giới đi lại của người chơi. */
export const BOUNDS = fz([-54.5, -20.0, 58.0, 58.0]);
/** Hộp "trong nhà" của shader (quán + phòng ngủ), rộng hơn mặt tường vài cm để tường không nhấp nháy. */
export const INSIDE_MIN = v(-9.57, -0.2, -5.07);
export const INSIDE_MAX = v(5.07, 3.25, 5.07);
/** Hộp chặn hạt bụi bay vào nhà (quán + phòng ngủ + phòng y tế). */
export const BUILDING = fz([-9.75, -5.25, 5.25, 5.25]);
/** Đường chia nửa trước / nửa sau quầy trong quán (bot dùng để vòng qua quầy). */
export const COUNTER_SPLIT_Z = -2.0;

// ---------- cửa ----------

/** Tâm cửa chính (gốc `StoreEntranceTrigger` (-0,6; -0,4)); hai cánh bản lề ở x = ±1, mở vào trong. */
export const DOOR = v(0.0, 0.0, 5.125);
/** Hộp chặn của cửa chính khi đóng. */
export const DOOR_BOX = fz([-1.0, 5.0, 1.0, 5.25]);
/** Điểm mốc ngay ngoài cửa chính. */
export const DOOR_OUT = v(0.0, 0.0, 6.3);
/** Điểm mốc ngay trong cửa chính. */
export const DOOR_IN = v(0.0, 0.0, 4.2);
/** Bot đứng ngoài cửa (trước khi bước vào). */
export const DOOR_OUT_STAND = v(0.0, 0.0, 6.6);
/** Bot đứng trong cửa. */
export const DOOR_IN_STAND = v(0.0, 0.0, 3.9);
/** Bản lề cửa phòng ngủ (vách x = -5,125; ô cửa z -3,7..-2,5; gốc `BedroomDoor` (-5,6; -8,5)). */
export const BED_DOOR_HINGE = v(-5.125, 0.0, -3.7);
/** Tâm ô cửa phòng ngủ. */
export const BED_DOOR = v(-5.125, 0.0, -3.1);
/** Hộp chặn cửa phòng ngủ còn kẹt. */
export const BED_DOOR_BOX = fz([-5.25, -3.7, -5.0, -2.5]);
/** Chiều mở cửa phòng ngủ quanh trục y: âm là mở vào phòng ngủ (phía -x). */
export const BED_DOOR_SWING = -1.0;
/** Điểm mốc phía quán của cửa phòng ngủ. */
export const BED_A = v(-4.2, 0.0, -3.1);
/** Điểm mốc phía phòng ngủ. */
export const BED_B = v(-6.0, 0.0, -3.1);
/** Bot đứng phía quán khi đi qua cửa phòng ngủ. */
export const BED_A_STAND = v(-3.9, 0.0, -3.1);
/** Bot đứng phía phòng ngủ. */
export const BED_B_STAND = v(-6.3, 0.0, -3.1);
/** Bot đứng trước cửa kẹt để đập búa. */
export const BED_DOOR_STAND = v(-4.0, 0.0, -3.1);
/** Cửa nhà kho trên tường sau quán (gốc `WarehouseDoor` (-2,6; -10,2); chỉ để nhìn). */
export const WAREHOUSE_DOOR = ko(-2.6, -10.2);
/** Cửa phòng y tế trên vách tây của quán, chỉ để nhìn. Gốc `MedicalRoomDoor` ở (-5,6; -2,9) tức z 2,1 ở đây,
 *  nhưng kệ của bản này dài 4,3 m che chỗ đó nên cửa dời về z 3,7. */
export const MEDICAL_DOOR = v(-5.0, 0.0, 3.7);

// ---------- đồ trong quán ----------

/** Công tắc mở quán, trong nhà cạnh cửa phía +x (gốc `OpenSwitch` (0,9; -0,3)). */
export const SWITCH = v(1.73, 1.42, 4.9);
/** Hai hộp nhắm của công tắc (hộp công tắc trong nhà, biển OPEN/CLOSED ngoài cửa). */
export const SWITCH_BOXES = fz([fz([v(1.5, 1.1, 4.8), v(1.96, 1.75, 5.0)]), fz([v(1.3, 1.4, 5.25), v(2.3, 1.85, 5.36)])]);
/** Ngăn tiền trên quầy (gốc `CheckoutItemPrefab` (-0,2; -8,4), quầy ở cuối quán). */
export const TILL = v(0.9, 1.15, -2.6);
export const TILL_BOX = fz([v(0.45, 0.95, -2.95), v(1.35, 1.35, -2.25)]);
/** Bot đứng sau quầy để phục vụ (gốc `ServicePosition` sau quầy). */
export const TILL_STAND = v(0.9, 0.0, -3.75);
/** Bot đứng sau quầy để soi pin (nhìn thấy cả ngăn tiền, các cục pin và nút báo động). */
export const PAY_STAND = v(0.06, 0.0, -3.45);
/** Radio trên quầy. */
export const RADIO = v(-0.6, 1.15, -2.7);
export const RADIO_BOX = fz([v(-0.9, 0.95, -2.95), v(-0.3, 1.4, -2.5)]);
/** Hàng chờ: chỗ người đầu hàng, mỗi người sau lùi thêm `QUEUE_STEP` về +z. */
export const QUEUE0 = v(0.0, 0.0, -1.45);
export const QUEUE_STEP = 0.95;
/** Hai kệ dọc hai tường (x mặt kệ, x chỗ khách đứng, hướng nhìn: +1 quay về +x) (gốc `FlimsyWoodenShelf` (-5,2; -5,4), (4,0; -3,5)). */
export const SHELVES = fz([fz([-4.55, -3.7, 1.0]), fz([4.55, 3.7, -1.0])]);
/** z của mép đầu kệ và bề rộng một ô. */
export const SHELF_Z0 = -1.6;
export const SLOT_W = 0.6;
/** Bot đứng trước kệ (mỗi kệ một chỗ). */
export const SHELF_STANDS = fz([v(-3.3, 0.0, 0.4), v(3.3, 0.0, 0.4)]);
/** Mép quầy bot vòng qua (x hai đầu quầy, z trước quầy, z sau quầy). */
export const COUNTER_SIDE_X = 2.75;
export const COUNTER_FRONT_Z = -1.3;
export const COUNTER_BACK_Z = -3.2;
/** Hộp quầy (vật cản). */
export const COUNTER_BOX = fz([-1.7, -3.0, 1.7, -2.2]);

// ---------- phòng ngủ ----------

/** Giường (nệm sát tường sau phía -x). */
export const BED = v(-8.4, 0.45, -4.4);
export const BED_BOX = fz([v(-9.4, 0.0, -4.9), v(-7.5, 0.7, -3.9)]);
/** Bot đứng cạnh giường. */
export const BED_STAND = v(-7.2, 0.0, -3.3);
/** Chồng thùng gỗ cạnh vách trước phòng ngủ (vật cản). */
export const BED_CRATES = fz([-9.4, -2.4, -8.6, -1.2]);
/** Đèn trần phòng ngủ. */
export const BED_LAMP = v(-7.3, 2.6, -3.0);
/** Chỗ thức dậy (sau khi ngủ, gục, tải ván) và hướng nhìn ra cửa phòng ngủ (+x). */
export const WAKE = v(-7.3, 0.0, -3.0);
export const WAKE_YAW = -f32(Math.PI / 2);
/** Chỗ rơi vật đang cầm khi gục. */
export const WAKE_DROP = v(-6.4, 0.0, -3.8);
/** Hộp các-tông trong phòng ngủ (gốc `CardboardBoxItemPrefab` (-9,4; -6,1)). */
export const CARD_BOX = v(-8.3, 0.0, -3.1);
/** Góc đống 14 hộp thiếc; hàng xếp về phía -x (`TINS_STEP`), dãy lùi về +z. */
export const TINS = v(-6.0, 0.0, -2.0);
export const TINS_STEP = -0.42;

// ---------- ván mới ----------

/** Chỗ đứng đầu ván mới (ngoài bãi, nhìn vào quán). */
export const START = v(0.0, 0.0, 15.5);
/** Chỗ đứng sau "Skip Introduction". */
export const SKIP_INTRO = v(0.0, 0.0, 3.0);
/** Búa trong góc quán. */
export const HAMMER = v(-3.9, 0.0, -4.3);
/** 6 túi rác và 9 đống rác trong quán (x, z). */
export const TRASH = fz([[-2.8, 2.6], [1.9, 3.3], [3.0, 0.4], [-1.4, -0.6], [2.6, -3.9], [-3.2, -3.6]].map(fz));
export const PILES = fz([[-3.4, 3.9], [0.4, 2.0], [3.6, 3.4], [-0.6, 0.6], [1.6, -1.2], [-2.2, -1.5], [3.6, -3.4], [-3.9, -1.9], [0.2, -4.2]].map(fz));

// ---------- trước quán ----------

/** Thùng skip đổ rác (gốc `DumpSkipPrefab` (-13,6; 1,5), dài theo x). */
export const SKIP = ko(-13.6, 1.5);
export const SKIP_BOX = fz([f32(SKIP.x - f32(1.5)), f32(SKIP.z - f32(0.8)), f32(SKIP.x + f32(1.5)), f32(SKIP.z + f32(0.8))]);
/** Bot đứng trước skip (phía đường). */
export const SKIP_STAND = v(SKIP.x, 0.0, f32(SKIP.z + f32(1.85)));
/** Điểm giao hàng có pallet (gốc `DeliveryPoint` (2,9; 2,6)). */
export const DELIVERY = v(3.6, 0.0, 7.2);
/** Chỗ thùng hàng khởi đầu ngày 2 (cạnh pallet). */
export const DELIVERY2 = v(2.6, 0.0, 7.6);
/** Bot đứng mở thùng giao. */
export const DELIVERY_STAND = v(1.8, 0.0, 7.0);
/** Chỗ thả thùng thưởng khi thắng raid. */
export const REWARD_DROP = v(-2.6, 0.0, 9.2);
/** Chỗ bot dựng dây thép gai trước cửa. */
export const WIRE_STAND = v(0.0, 0.0, 8.7);
/** Hàng nhân vật trưng bày của `?zoo=1`. */
export const ZOO_Z = 9.4;

/** 8 chỗ lục đồ, đặt ở chỗ đồ lục được của bản gốc (`DuffleBag…`, `BaseStaticLootable…`). */
export const CACHE_DUFFLE = ko(0.9, 24.8);
export const CACHE_TROLLEY = ko(-21.0, 2.3);
export const CACHE_TOOLBOX = ko(-7.5, 23.8);
export const CACHE_CRATE = ko(-13.2, -12.5);
export const CACHE_BIN = ko(-17.6, 32.3);
export const CACHE_GLOVEBOX = ko(13.2, 13.2);
export const CACHE_MEDBAG = ko(28.9, 29.4);
export const CACHE_SUITCASE = ko(-16.4, -18.9);

/** Xe hỏng: (chỗ, hướng, màu, lật). Ba chiếc trong bãi theo xe hỏng của bản gốc, hai chiếc trên đường. */
export const CARS = fz([
  fz([ko(14.8, 14.6), 0.5, 0x6d7f8f, false]),
  fz([ko(-17.2, 17.1), 0.3, 0x8a4a3a, true]),
  fz([ko(24.9, 38.3), -0.2, 0x8e8a62, false]),
  fz([ko(-1.3, 24.9), 1.45, 0x4f6a57, false]),
  fz([v(52.5, 0.0, 48.0), 1.5, 0x5a5f66, true]),
]);
/** Cột đèn: (x, z, hướng cần đèn theo z). Hai cột trong bãi (gốc `LightPole` (-4,6; 10,8), (11,1; 11,0)), hai cột bên đường. */
export const LAMPS = fz([fz([-4.0, 15.8, -1.0]), fz([11.7, 16.0, -1.0]), fz([-40.0, 54.6, -1.0]), fz([40.0, 54.6, -1.0])]);

// ---------- đường, hàng rào, cổng ----------

/** Cả dãy đường phố (vỉa hè, mặt đường, nhà đối diện) lùi ra xa quán thêm chừng này mét so với bản trước,
 *  để mặt đường nằm ở z 46..54 như bản gốc (chỗ đỗ xe gốc `VehicleParkingSpot` z 42,2 → 47,2). */
export const STREET_DZ = 32.0;
/** Mép gần và mép xa của mặt đường. */
export const ROAD_Z0 = 14.0 + STREET_DZ;
export const ROAD_Z1 = 22.0 + STREET_DZ;
/** Hàng rào dây quanh bãi (hộp vật cản mỏng). Chừa ba cổng: trước, đông, tây. */
export const FENCE = fz([
  fz([LOT[0], f32(LOT[3] - f32(0.05)), 4.6, f32(LOT[3] + f32(0.05))]),
  fz([12.6, f32(LOT[3] - f32(0.05)), LOT[2], f32(LOT[3] + f32(0.05))]),
  fz([f32(LOT[2] - f32(0.05)), 18.0, f32(LOT[2] + f32(0.05)), LOT[3]]),
  fz([f32(LOT[2] - f32(0.05)), LOT[1], f32(LOT[2] + f32(0.05)), 3.3]),
  fz([f32(LOT[0] - f32(0.05)), 19.0, f32(LOT[0] + f32(0.05)), LOT[3]]),
  fz([f32(LOT[0] - f32(0.05)), LOT[1], f32(LOT[0] + f32(0.05)), 6.0]),
  fz([LOT[0], f32(LOT[1] - f32(0.05)), LOT[2], f32(LOT[1] + f32(0.05))]),
]);
/** Cổng bãi: (điểm ngoài, điểm trong). Khách và zombie đi qua đây. */
export const GATES = fz([
  fz([v(8.6, 0.0, 43.0), v(8.6, 0.0, 37.0)]),
  fz([v(34.0, 0.0, 10.5), v(28.0, 0.0, 10.5)]),
  fz([v(-26.5, 0.0, 12.5), v(-20.5, 0.0, 12.5)]),
]);

// ---------- khách, zombie, raid ----------

/** Năm điểm sinh khách (gốc `NPCSpawnPoints/SpawnPoint` 0..4). */
export const CUSTOMER_SPAWNS = fz([ko(-25.9, 65.6), ko(-40.4, 29.5), ko(29.5, 61.2), ko(45.2, 50.6), ko(45.3, 1.8)]);
/** Đường từ mỗi điểm sinh tới cổng ngoài của bãi (không gồm điểm sinh); cổng dùng ở `CUSTOMER_GATE`. */
export const R0 = fz([v(-19.0, 0.0, 71.0), v(-19.0, 0.0, 56.0), v(8.6, 0.0, 47.0)]);
export const R1 = fz([]);
export const R2 = fz([v(31.0, 0.0, 56.0), v(8.6, 0.0, 47.0)]);
export const R3 = fz([]);
export const R4 = fz([]);
export const CUSTOMER_ROUTES = fz([R0, R1, R2, R3, R4]);
export const CUSTOMER_GATE = fz([0, 2, 0, 1, 1]);
/** Ba điểm sinh zombie (gốc `ZombieSpawnPoint` 0..2); điểm 2 (phía đông) là chỗ zombie "Rude Customer" ngày 2. */
export const ZOMBIE_SPAWNS = fz([ko(-41.3, 0.0), ko(24.5, 62.2), ko(45.3, 8.9)]);
/** Điểm zombie tụ lại trước quán (gốc `ZombieGatherPoint` (3,3; 29,6)). */
export const ZOMBIE_GATHER = ko(3.3, 29.6);
/** Vùng zombie lang thang. */
export const WANDER = fz([-50.0, 3.0, 50.0, 58.0]);
/** Vùng sinh quân raid, ngoài cổng đông quanh điểm sinh zombie 2 của bản gốc. */
export const RAID_SPAWN = fz([49.0, 10.5, 53.5, 17.5]);
/** Rào chắn bê tông: (x, [đoạn z]); rào đông chừa khe z 10..18 cho quân raid, chốt tây chặn đường. */
export const BARRIERS = fz([
  fz([48.0, fz([fz([3.0, 10.0]), fz([18.0, 25.0])]), 1.0]),
  fz([-56.0, fz([fz([9.0 + STREET_DZ, 15.5 + STREET_DZ]), fz([20.0 + STREET_DZ, 26.0 + STREET_DZ])]), -1.0]),
]);

// ---------- máy quay ----------

/** Máy quay màn tiêu đề (quay quanh tâm này, bán kính 3 × 1,5 m) và điểm nhìn. */
export const TITLE_CAM = v(9.0, 3.4, 17.5);
export const TITLE_LOOK = v(0.0, 1.6, 4.5);
/** Điểm nhìn của cắt cảnh: mặt tiền quán, quầy radio, nơi quân raid tới, thùng giao. */
export const CINE_SHOP = v(0.0, 2.0, 6.0);
export const CINE_RAID = v(51.0, 1.1, 14.0);
export const CINE_DELIVERY = v(3.1, 0.4, 7.4);
/** Bot đứng trước quán để chụp và nhìn cổng đông khi chờ raid. */
export const VIEW_FRONT = v(5.5, 0.0, 15.5);
export const VIEW_RAID = v(0.0, 0.0, 7.6);
/** Điểm bot nhìn ra đường: trước cổng bãi và phía tây đường. */
export const VIEW_STREET = v(8.6, 2.2, 50.0);
export const VIEW_STREET_W = v(-30.0, 2.5, 50.0);

// ---------- nhà kho, phòng mở rộng, phòng y tế, các trạm ----------

/** Lòng nhà kho sau quán (đi được sau khi cạy cửa kho bằng xà beng). */
export const WAREHOUSE_IN = fz([-5.0, -18.95, 14.75, -5.25]);
/** Cửa kho trên tường sau quán (gốc `WarehouseDoor` (-2,6; -10,2)): hộp chặn khi còn đóng ván, hai điểm mốc hai phía. */
export const WH_DOOR_BOX = fz([-2.55, -5.25, -1.45, -5.0]);
export const WH_A = v(-2.0, 0.0, -4.35);
export const WH_B = v(-2.0, 0.0, -6.1);
/** Bot đứng trước cửa kho (phía quán) để cạy. */
export const WH_DOOR_STAND = v(-2.0, 0.0, -3.95);
/** Bàn chế tạo trong kho, áp tường chung với quán (gốc `CraftingStation` (1,1; -10,8), chỗ đứng `CraftPosition` (1,1; -11,5)). */
export const WORKBENCH = v(1.7, 0.0, -5.75);
export const WORKBENCH_BOX = fz([0.8, -6.2, 2.6, -5.3]);
export const WORKBENCH_STAND = v(1.7, 0.0, -7.0);
/** Tờ công thức Bandage nằm trên sàn cạnh bàn chế tạo (nhiệm vụ "LearnCraftingRecipe" sau khi mở kho). */
export const RECIPE_SPOT = v(3.4, 0.0, -6.3);
/** Máy nghiền cuối kho (gốc `ShredderUpgradeableObject` (4,7; -23,3)). */
export const SHREDDER = v(5.3, 0.0, -18.2);
export const SHREDDER_BOX = fz([4.4, -18.9, 6.2, -17.5]);
export const SHREDDER_STAND = v(5.3, 0.0, -16.6);
/** Máy phát điện ở góc kho (gốc `GeneratorUpgradeableObject` (13,6; -23,0)). */
export const GENERATOR = v(13.9, 0.0, -18.0);
export const GENERATOR_BOX = fz([13.2, -18.8, 14.6, -17.2]);
export const GENERATOR_STAND = v(12.3, 0.0, -17.9);
/** Job Board ngoài trời, áp tường đông của quán trong hốc trước SF2 (gốc `JobBoard` (5,7; 0,2), hàng chờ (6,6; -0,8)). */
export const JOB_BOARD = v(5.42, 1.5, 4.3);
export const JOB_BOARD_BOX = fz([v(5.25, 0.8, 3.5), v(5.5, 2.3, 5.1)]);
export const JOB_BOARD_STAND = v(6.7, 0.0, 4.3);
/** Bàn tin tức trong phòng ngủ (gốc `IntelStation/Notes` (-6,2; -6,2), dời sát tường sau vì chỗ gốc trùng đống hộp thiếc). */
export const INTEL = v(-6.1, 0.0, -4.7);
export const INTEL_BOX = fz([-6.9, -4.95, -5.3, -4.45]);
export const INTEL_STAND = v(-6.1, 0.0, -3.85);
/** Ba thùng rác lớn trong bãi (gốc `SM_Prop_Dumpster` (-23,1; 32,9), (-20,7; 32,3), (0,5; 32,7)): chỗ vứt xác. */
export const DUMPSTERS = fz([v(-22.0, 0.0, 37.9), v(-19.6, 0.0, 37.3), v(1.1, 0.0, 37.7)]);
/** Tháp còi báo động ngoài cổng đông (gốc `SirenUpgradeableObject` (34,9; 28,4)). */
export const SIREN = v(35.5, 0.0, 33.4);
/** Xe của thương nhân Exotic Merchant đỗ bên đường (gốc `VehicleParkingSpot` (22,3; 42,2)); người chơi đứng phía bãi. */
export const MERCHANT = v(22.9, 0.0, 48.4);
export const MERCHANT_STAND = v(22.9, 0.0, 45.6);
/** Xe vòng quay của Dr. Gib. Bản gốc đỗ sau kho, ngoài hàng rào (8,9; -26,2); bản này đỗ trong sân sau phía đông kho [ĐỀ XUẤT]. */
export const GIB = v(21.0, 0.0, -13.0);
export const GIB_STAND = v(21.0, 0.0, -10.4);
/** Lòng hai phòng mở rộng SF2, SF3 (gốc `Rooms/Room2`, `Room3`): mở khi đội phá tường đập xong. */
export const SF2 = fz([5.0, -5.0, 14.875, 2.95]);
export const SF3 = fz([14.875, -5.0, 24.75, 2.95]);
/** Vách SF2 / SF3 (bị phá khi mở SF3). Đoạn tường đông của quán bị phá khi mở SF2 là x 5..5,25, z -5..3,2. */
export const WALL_SF3 = fz([14.75, -5.0, 15.0, 2.95]);
/** Chỗ 5 thợ phá tường đứng (phía trong quán, dọc tường đông; phía SF2 dọc vách SF3). */
export const CREW_SPOTS = fz([v(4.4, 0.0, -1.0), v(14.2, 0.0, -1.0)]);
/** Lòng phòng y tế (gốc `MedicalRoom`) và cửa trên vách tây của quán. */
export const MEDICAL_IN = fz([-9.5, -0.875, -5.25, 5.0]);
export const MED_DOOR_BOX = fz([-5.25, 3.25, -5.0, 4.15]);
export const MED_A = v(-4.3, 0.0, 3.7);
export const MED_B = v(-6.0, 0.0, 3.7);
/** Hulk bị xích trong phòng y tế (gốc `HulkHelperChained` (-16,2; -5,4), dời vào khối phòng 4,5 m của bản này). */
export const HULK = v(-8.6, 0.0, 1.2);
export const HULK_STAND = v(-7.0, 0.0, 1.2);
/** Điểm Hulk Helper đi tuần quanh bãi (gốc `HelperWanderPoint` 0..10, lấy 6 điểm). */
export const HELPER_POINTS = fz([ko(-19.2, 9.9), ko(-8.6, 29.2), ko(-1.5, 18.2), ko(11.3, 26.2), ko(26.2, 21.4), ko(7.5, 4.7)]);

// ---------- xuất cho bot ----------

/** Rust `format!("{:.N}", v)` (exact decimal, ties to even, keeps "-" of negative zero). */
function rfix(x, n) {
  if (Number.isNaN(x)) return 'NaN';
  const neg = x < 0 || Object.is(x, -0);
  const a = Math.abs(x);
  if (a === Infinity) return neg ? '-inf' : 'inf';
  let s = a.toFixed(n);
  if (a < 1e21 && n <= 60) {
    const full = a.toFixed(n + 40);
    if (full.slice(full.length - 40) === '5' + '0'.repeat(39)) {
      let kept = full.slice(0, full.length - 40);
      if (kept.endsWith('.')) kept = kept.slice(0, -1);
      if ((kept.charCodeAt(kept.length - 1) - 48) % 2 === 0) s = kept;
    }
  }
  return (neg ? '-' : '') + s;
}

function p3(s, name, p) {
  s.push(`"${name}":[${rfix(p.x, 3)},${rfix(p.y, 3)},${rfix(p.z, 3)}],`);
}
function b2(s, name, b) {
  s.push(`"${name}":[${rfix(b[0], 3)},${rfix(b[1], 3)},${rfix(b[2], 3)},${rfix(b[3], 3)}],`);
}

/** Bảng dạng JSON cho `window.__twtLay`: điểm là [x, y, z], hộp là [minx, minz, maxx, maxz], danh sách là mảng. */
export function json() {
  const s = ['{'];
  for (const [n, p] of [
    ['door', DOOR],
    ['door_out', DOOR_OUT],
    ['door_in', DOOR_IN],
    ['door_out_stand', DOOR_OUT_STAND],
    ['door_in_stand', DOOR_IN_STAND],
    ['bed_door', BED_DOOR],
    ['bed_a', BED_A],
    ['bed_b', BED_B],
    ['bed_a_stand', BED_A_STAND],
    ['bed_b_stand', BED_B_STAND],
    ['bed_door_stand', BED_DOOR_STAND],
    ['switch', SWITCH],
    ['till', TILL],
    ['till_stand', TILL_STAND],
    ['pay_stand', PAY_STAND],
    ['coin0', player.coin_pos(0)],
    ['coin1', player.coin_pos(1)],
    ['coin5', player.coin_pos(5)],
    ['alarm', player.ALARM],
    ['radio', RADIO],
    ['queue0', QUEUE0],
    ['bed', BED],
    ['bed_stand', BED_STAND],
    ['wake', WAKE],
    ['card_box', CARD_BOX],
    ['tins', TINS],
    ['start', START],
    ['skip_intro', SKIP_INTRO],
    ['hammer', HAMMER],
    ['skip', up(SKIP, 0.9)],
    ['skip_stand', SKIP_STAND],
    ['delivery', DELIVERY],
    ['delivery2', DELIVERY2],
    ['delivery_stand', DELIVERY_STAND],
    ['reward_drop', REWARD_DROP],
    ['wire_stand', WIRE_STAND],
    ['cache_duffle', CACHE_DUFFLE],
    ['cache_trolley', CACHE_TROLLEY],
    ['cache_toolbox', CACHE_TOOLBOX],
    ['cache_crate', CACHE_CRATE],
    ['cache_bin', CACHE_BIN],
    ['cache_glovebox', CACHE_GLOVEBOX],
    ['cache_medbag', CACHE_MEDBAG],
    ['cache_suitcase', CACHE_SUITCASE],
    ['zombie_gather', ZOMBIE_GATHER],
    ['warehouse_door', WAREHOUSE_DOOR],
    ['medical_door', MEDICAL_DOOR],
    ['title_cam', TITLE_CAM],
    ['title_look', TITLE_LOOK],
    ['cine_shop', CINE_SHOP],
    ['cine_raid', CINE_RAID],
    ['cine_delivery', CINE_DELIVERY],
    ['view_front', VIEW_FRONT],
    ['view_raid', VIEW_RAID],
    ['view_street', VIEW_STREET],
    ['view_street_w', VIEW_STREET_W],
    ['car_lot', CARS[0][0]],
    ['zoo', new Vec3(0.0, 0.0, ZOO_Z)],
    ['gate_front_out', GATES[0][0]],
    ['gate_front_in', GATES[0][1]],
    ['gate_east_out', GATES[1][0]],
    ['gate_east_in', GATES[1][1]],
    ['gate_west_out', GATES[2][0]],
    ['gate_west_in', GATES[2][1]],
    ['lamp_lot_w', new Vec3(LAMPS[0][0], 5.5, LAMPS[0][1])],
    ['wh_a', WH_A],
    ['wh_b', WH_B],
    ['wh_door_stand', WH_DOOR_STAND],
    ['workbench', up(WORKBENCH, 0.95)],
    ['workbench_stand', WORKBENCH_STAND],
    ['recipe_spot', RECIPE_SPOT],
    ['shredder', up(SHREDDER, 1.0)],
    ['shredder_stand', SHREDDER_STAND],
    ['generator', up(GENERATOR, 0.8)],
    ['generator_stand', GENERATOR_STAND],
    ['job_board', JOB_BOARD],
    ['job_board_stand', JOB_BOARD_STAND],
    ['intel', up(INTEL, 0.9)],
    ['intel_stand', INTEL_STAND],
    ['dumpster0', up(DUMPSTERS[0], 0.9)],
    ['dumpster1', up(DUMPSTERS[1], 0.9)],
    ['dumpster2', up(DUMPSTERS[2], 0.9)],
    ['siren', up(SIREN, 1.2)],
    ['merchant', up(MERCHANT, 1.3)],
    ['merchant_stand', MERCHANT_STAND],
    ['gib', up(GIB, 1.3)],
    ['gib_stand', GIB_STAND],
    ['med_a', MED_A],
    ['med_b', MED_B],
    ['hulk', up(HULK, 1.2)],
    ['hulk_stand', HULK_STAND],
    ['crew_spot0', CREW_SPOTS[0]],
    ['crew_spot1', CREW_SPOTS[1]],
    ['lamp_lot_e', new Vec3(LAMPS[1][0], 5.5, LAMPS[1][1])],
  ]) {
    p3(s, n, p);
  }
  for (const [n, b] of [
    ['shop', SHOP],
    ['bedroom', BEDROOM],
    ['medical', MEDICAL],
    ['expansion', EXPANSION],
    ['warehouse', WAREHOUSE],
    ['lot', LOT],
    ['service', SERVICE],
    ['bounds', BOUNDS],
    ['skip_box', SKIP_BOX],
    ['counter_box', COUNTER_BOX],
    ['raid_spawn', RAID_SPAWN],
    ['wander', WANDER],
    ['warehouse_in', WAREHOUSE_IN],
    ['sf2', SF2],
    ['sf3', SF3],
    ['medical_in', MEDICAL_IN],
  ]) {
    b2(s, n, b);
  }
  const list = (ps) => ps.map((p) => `[${rfix(p.x, 3)},${rfix(p.y, 3)},${rfix(p.z, 3)}]`).join(',');
  s.push(`"customer_spawns":[${list(CUSTOMER_SPAWNS)}],`);
  s.push(`"zombie_spawns":[${list(ZOMBIE_SPAWNS)}],`);
  s.push(`"shelf_stands":[${list(SHELF_STANDS)}],`);
  const sh = SHELVES.map(([x, sx, f]) => `[${rfix(x, 3)},${rfix(sx, 3)},${rfix(f, 1)}]`);
  s.push(`"shelves":[${sh.join(',')}],`);
  s.push(`"shelf_z0":${rfix(SHELF_Z0, 3)},"slot_w":${rfix(SLOT_W, 3)},"counter_split_z":${rfix(COUNTER_SPLIT_Z, 3)},"counter_side_x":${rfix(COUNTER_SIDE_X, 3)},"counter_front_z":${rfix(COUNTER_FRONT_Z, 3)},"counter_back_z":${rfix(COUNTER_BACK_Z, 3)},"bed_side":${rfix(signum(BED_DOOR.x), 1)},"street_dz":${rfix(STREET_DZ, 1)}`);
  s.push('}');
  return s.join('');
}

/* VIEW NOTES
   lay.rs draws nothing; it is the coordinate table every module (and the view) reads. Boxes are [minx, minz, maxx, maxz]
   on the ground plane, points are frozen Vec3 in metres (+x east, +z toward the street, y up). `json()` is the text the
   bots read from `window.__twtLay`. `set_state(rooms, wh, med)` / `rooms()` / `wh_open()` / `med_open()` hold the
   opened-rooms state build.rs writes (2 low bits = expansion rooms opened, bit 2 warehouse door, bit 3 medical door).
   PORT GAPS: none. `o()` and the derived sums (SKIP_BOX, SKIP_STAND, FENCE) are computed in f32 (Math.fround) like the
   Rust const fns; plain literals stay as written (the JSON prints them with 3 decimals, identical either way).
*/
