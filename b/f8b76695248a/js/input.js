// Keyboard / mouse state with Bevy's ButtonInput semantics (pressed, just_pressed, just_released per frame).
// Codes are DOM KeyboardEvent.code values, which are also Bevy's KeyCode variant names.
class Buttons {
  constructor() { this.down = new Set(); this.jp = new Set(); this.jr = new Set(); this.qp = []; this.qr = []; }
  press(c) { this.qp.push(c); }
  release(c) { this.qr.push(c); }
  // call once at the start of each frame: events since the last frame become this frame's just_pressed / just_released
  begin() {
    this.jp.clear(); this.jr.clear();
    for (const c of this.qp) { if (!this.down.has(c)) this.jp.add(c); this.down.add(c); }
    for (const c of this.qr) { if (this.down.has(c) || this.jp.has(c)) this.jr.add(c); this.down.delete(c); }
    this.qp.length = 0; this.qr.length = 0;
  }
  pressed(c) { return this.down.has(c) || this.jp.has(c); }
  just_pressed(c) { return this.jp.has(c); }
  just_released(c) { return this.jr.has(c); }
  any_pressed(list) { return list.some((c) => this.pressed(c)); }
  any_just_pressed(list) { return list.some((c) => this.jp.has(c)); }
  clear() { for (const c of this.down) this.qr.push(c); }
}
const MB = ['Left', 'Middle', 'Right'];
export class Input {
  constructor(canvas, nolock) {
    this.keys = new Buttons(); this.mouse = new Buttons(); this.motion = { x: 0, y: 0 }; this.acc = { x: 0, y: 0 }; this.wheel = 0; this.accWheel = 0;
    this.canvas = canvas; this.nolock = nolock; this.typing = false;
    const self = this;
    this.cursor = {
      get locked() { return document.pointerLockElement === canvas; },
      want: false,
      lock() { this.want = true; if (!nolock && document.pointerLockElement !== canvas) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {} } },
      unlock() { this.want = false; if (document.pointerLockElement === canvas) document.exitPointerLock(); },
    };
    const block = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash', 'Quote', 'F1', 'F5']);
    window.addEventListener('keydown', (e) => {
      if (self.typing) return;
      if (block.has(e.code) || (e.ctrlKey && 'swda'.includes(e.key.toLowerCase()))) e.preventDefault();
      if (!e.repeat) self.keys.press(e.code);
    });
    window.addEventListener('keyup', (e) => { self.keys.release(e.code); });
    canvas.addEventListener('mousedown', (e) => { self.mouse.press(MB[e.button] || 'Left'); });
    window.addEventListener('mouseup', (e) => { self.mouse.release(MB[e.button] || 'Left'); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) { self.acc.x += e.movementX; self.acc.y += e.movementY; } });
    window.addEventListener('wheel', (e) => { self.accWheel += Math.sign(e.deltaY); }, { passive: true });
    window.addEventListener('blur', () => { self.keys.clear(); self.mouse.clear(); });
  }
  begin() {
    this.keys.begin(); this.mouse.begin();
    this.motion.x = this.acc.x; this.motion.y = this.acc.y; this.acc.x = 0; this.acc.y = 0;
    this.wheel = this.accWheel; this.accWheel = 0;
  }
}
