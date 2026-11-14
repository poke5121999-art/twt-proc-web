// Scene facade: the rules-side twin of Bevy `Commands` + `Transform` + `Visibility` for the code that keeps pictures
// in step with the game state (sync_* systems). The three.js view installs the implementation (js/scenegraph.js).
// In node (tests) a recording stub is used, so sync code can run headless.
//
//   const n = scene.spawn(mesh, 'solid' | 'blend', { pos, quat, scale, visible, viewmodel })   mesh = MB.build() result or null
//   n.set_pos(Vec3)  n.set_quat([x,y,z,w])  n.set_yaw(a)  n.set_scale(number | Vec3)  n.set_visible(bool)
//   n.set_tr({ pos?, quat?, scale? })   n.set_mesh(mesh)   n.child(mesh, mat, tr) -> node   n.despawn()
//   n.pos / n.quat / n.scale / n.visible hold the last values written (readable, like a Bevy Transform)
//   scene.people.spawn(seed, kind, pos, opts) -> person   kind: null (living human) | ZKind string
//   person.update(desc)   desc: plain object describing pose / animation state this frame (see VIEW NOTES of the caller)
//   person.despawn()
import { Vec3, Q_ID } from './vec.js';
class StubNode {
  constructor(mesh, mat, tr = {}) { this.mesh = mesh; this.mat = mat; this.pos = tr.pos ? tr.pos.clone() : new Vec3(); this.quat = tr.quat ? tr.quat.slice() : Q_ID.slice(); this.scale = tr.scale === undefined ? 1 : tr.scale; this.visible = tr.visible !== false; this.kids = []; this.dead = false; this.opts = tr; }
  set_pos(p) { this.pos = p.clone(); }
  set_quat(q) { this.quat = q.slice(); }
  set_yaw(a) { this.quat = [0, Math.sin(a / 2), 0, Math.cos(a / 2)]; }
  set_scale(s) { this.scale = s; }
  set_visible(v) { this.visible = !!v; }
  set_mesh(m) { this.mesh = m; }
  set_tr(t) { if (t.pos) this.set_pos(t.pos); if (t.quat) this.set_quat(t.quat); if (t.scale !== undefined) this.set_scale(t.scale); }
  child(mesh, mat, tr) { const n = new StubNode(mesh, mat, tr); this.kids.push(n); return n; }
  despawn() { this.dead = true; }
}
const stub = {
  count: 0,
  spawn(mesh, mat, tr) { this.count++; return new StubNode(mesh, mat, tr); },
  people: { spawn(seed, kind, pos, opts) { return { seed, kind, pos: pos.clone(), opts, last: null, dead: false, update(d) { this.last = d; }, despawn() { this.dead = true; } }; } },
};
let IMPL = stub;
export function install(impl) { IMPL = impl; }
export function spawn(mesh, mat = 'solid', tr = {}) { return IMPL.spawn(mesh, mat, tr); }
export const people = { spawn: (seed, kind, pos, opts) => IMPL.people.spawn(seed, kind, pos, opts) };
export function impl() { return IMPL; }
