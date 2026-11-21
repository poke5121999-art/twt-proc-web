// Prop builders. Each builds at the kit's current matrix, in local metres (x right, y up, z length).
// They register colliders on the kit and light fixtures / decals on the returned info.
import * as THREE from '../vendor/three.module.min.js';
import { rng } from './rng.js';
import { chamferBox, cylinder, lathe, tubeBetween, extrude, roundRect } from './kit.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function bogie(k, z, axles = 2) {
  k.push().at(0, 0, z);
  const span = axles === 3 ? 1.9 : 1.25;
  k.box(2.3, 0.32, axles === 3 ? 4.6 : 3.2, 'darkSteel', 0, 0.78, 0, 0.04);
  k.box(0.5, 0.5, 1.8, 'darkSteel', 0, 0.98, 0, 0.05);
  for (const sx of [-1, 1]) {
    k.box(0.16, 0.42, axles === 3 ? 4.4 : 3.0, 'darkSteel', sx * 1.0, 0.62, 0, 0.03);
    for (let a = 0; a < axles; a++) {
      const az = axles === 3 ? (a - 1) * span : (a - 0.5) * span * 2;
      k.cyl(0.46, 0.13, 'wheel', sx * 0.72, 0.46, az, 24, 'x');
      k.cyl(0.5, 0.03, 'wheel', sx * 0.66, 0.46, az, 24, 'x');
      k.box(0.26, 0.3, 0.34, 'darkSteel', sx * 1.0, 0.48, az, 0.04);
      for (let s = 0; s < 3; s++) k.cyl(0.07, 0.07, 'spring', sx * 1.0, 0.68 + s * 0.08, az + 0.0, 8);
    }
    for (let s = -1; s <= 1; s += 2) k.cyl(0.09, 0.26, 'spring', sx * 1.0, 0.9, s * 0.25, 10);
  }
  k.cyl(0.06, 1.7, 'darkSteel', 0, 0.46, -span * (axles === 3 ? 1 : 1), 8, 'x');
  k.cyl(0.06, 1.7, 'darkSteel', 0, 0.46, span * (axles === 3 ? 1 : 1), 8, 'x');
  k.pop();
}

function underframe(k, len, info) {
  k.box(0.5, 0.42, len, 'darkSteel', 0, 1.18, 0, 0.03);
  for (const sx of [-1, 1]) k.box(0.18, 0.36, len, 'darkSteel', sx * 1.42, 1.22, 0, 0.03);
  for (const sz of [-1, 1]) {
    const ez = sz * (len / 2);
    k.box(2.9, 0.42, 0.22, 'darkSteel', 0, 1.18, ez, 0.03);
    for (const sx of [-1, 1]) { k.cyl(0.19, 0.42, 'steelBright', sx * 0.88, 1.12, ez + sz * 0.26, 16, 'z'); k.cyl(0.24, 0.05, 'steelBright', sx * 0.88, 1.12, ez + sz * 0.48, 16, 'z'); }
    k.box(0.24, 0.24, 0.6, 'darkSteel', 0, 1.06, ez + sz * 0.3, 0.03);
    // steps and grab irons at corners
    for (const sx of [-1, 1]) {
      k.box(0.42, 0.04, 0.24, 'darkSteel', sx * 1.4, 0.62, ez - sz * 0.4, 0.01);
      k.tube(V(sx * 1.4, 0.62, ez - sz * 0.28), V(sx * 1.4, 1.0, ez - sz * 0.28), 0.018, 'darkSteel', 6);
    }
  }
  // brake cylinder, air reservoir, pipes
  k.cyl(0.22, 1.1, 'darkSteel', 0.6, 0.95, len * 0.12, 14, 'z');
  k.cyl(0.18, 0.5, 'darkSteel', -0.5, 0.95, -len * 0.08, 14, 'x');
  k.tube(V(-0.3, 0.98, -len / 2), V(-0.3, 0.98, len / 2), 0.03, 'darkSteel', 6);
  k.collide(3.0, 1.4, len, 0, 0.7, 0);
}

export function boxcar(k, opts, info) {
  const r = rng(opts.seed || 'boxcar');
  const len = opts.len || 15.2, bodyH = 3.25, y0 = 1.42;
  const paint = opts.paint || 'boxRed';
  underframe(k, len, info);
  bogie(k, -len / 2 + 2.6); bogie(k, len / 2 - 2.6);
  k.box(2.95, bodyH, len, paint, 0, y0 + bodyH / 2, 0, 0.06);
  // posts
  const posts = Math.floor(len / 1.25);
  for (let i = 0; i <= posts; i++) {
    const z = -len / 2 + 0.15 + i * ((len - 0.3) / posts);
    if (Math.abs(z) < 1.9) continue;
    for (const sx of [-1, 1]) k.box(0.08, bodyH - 0.1, 0.16, paint, sx * 1.5, y0 + bodyH / 2, z, 0.025);
  }
  // top & bottom chords
  for (const sx of [-1, 1]) {
    k.box(0.12, 0.16, len, paint, sx * 1.5, y0 + bodyH - 0.06, 0, 0.03);
    k.box(0.12, 0.2, len, paint, sx * 1.5, y0 + 0.08, 0, 0.03);
    // sliding door + rails
    const open = opts.open && sx === 1 ? 1.6 : 0;
    k.box(0.1, bodyH - 0.2, 3.3, paint, sx * 1.57, y0 + bodyH / 2, open, 0.03);
    for (let d = -1; d <= 1; d++) k.box(0.05, bodyH - 0.4, 0.08, paint, sx * 1.63, y0 + bodyH / 2, open + d * 1.1, 0.015);
    k.box(0.12, 0.1, 6.6, 'darkSteel', sx * 1.62, y0 + bodyH - 0.12, 0.8, 0.02);
    k.box(0.12, 0.1, 6.6, 'darkSteel', sx * 1.62, y0 + 0.12, 0.8, 0.02);
    k.box(0.06, 0.6, 0.06, 'darkSteel', sx * 1.66, y0 + 1.4, open + 1.5, 0.01);
  }
  // roof: arched panels + seams
  const roof = new THREE.Shape(); roof.moveTo(-1.55, 0); roof.quadraticCurveTo(0, 0.42, 1.55, 0); roof.lineTo(1.55, -0.05); roof.quadraticCurveTo(0, 0.36, -1.55, -0.05); roof.lineTo(-1.55, 0);
  k.push().at(0, y0 + bodyH, 0); k.add(extrude(roof, len + 0.1, 0.01, 1), paint); k.pop();
  for (let i = 0; i < Math.floor(len / 1.25); i++) {
    const z = -len / 2 + 0.6 + i * 1.25;
    const seam = new THREE.Shape(); seam.moveTo(-1.56, 0); seam.quadraticCurveTo(0, 0.45, 1.56, 0); seam.lineTo(1.56, 0.03); seam.quadraticCurveTo(0, 0.49, -1.56, 0.03);
    k.push().at(0, y0 + bodyH, z); k.add(extrude(seam, 0.06, 0, 0), paint); k.pop();
  }
  k.box(0.55, 0.05, len - 0.6, 'grating', 0, y0 + bodyH + 0.44, 0, 0.01);
  // end details: ladder, brake wheel
  for (const sz of [-1, 1]) {
    const ez = sz * (len / 2 + 0.03);
    for (const sx of [-1, 1]) k.tube(V(sx * 1.2, y0 + 0.2, ez + sz * 0.1), V(sx * 1.2, y0 + bodyH, ez + sz * 0.1), 0.02, 'darkSteel', 6);
    for (let i = 0; i < 7; i++) k.tube(V(-1.2, y0 + 0.4 + i * 0.42, ez + sz * 0.12), V(-0.75, y0 + 0.4 + i * 0.42, ez + sz * 0.12), 0.016, 'darkSteel', 5);
    for (let i = 0; i < 4; i++) k.box(2.9, 0.08, 0.06, paint, 0, y0 + 0.6 + i * 0.8, ez, 0.02);
  }
  k.push().at(0.7, y0 + 2.4, len / 2 + 0.2);
  const wheel = new THREE.TorusGeometry(0.28, 0.025, 6, 20); k.add(wheel, 'darkSteel');
  for (let s = 0; s < 3; s++) { k.push().at(0, 0, 0, 0, 0, s * Math.PI / 3); k.box(0.56, 0.03, 0.03, 'darkSteel'); k.pop(); }
  k.pop();
  k.collide(3.1, bodyH + 0.6, len, 0, y0 + bodyH / 2, 0);
  info.decals.push({ kind: 'wagon', side: 1, len, h: bodyH, y0, seed: opts.seed, mark: opts.mark });
  info.decals.push({ kind: 'wagon', side: -1, len, h: bodyH, y0, seed: opts.seed, mark: opts.mark });
}

export function tankcar(k, opts, info) {
  const len = 13.5; const R = 1.42;
  underframe(k, len, info);
  bogie(k, -len / 2 + 2.3); bogie(k, len / 2 - 2.3);
  const prof = [];
  const L = len / 2 - 0.4;
  prof.push([0, -L - 0.55]);
  for (let i = 1; i <= 8; i++) { const a = (i / 8) * Math.PI / 2; prof.push([Math.sin(a) * R, -L - Math.cos(a) * 0.55]); }
  prof.push([R, L]);
  for (let i = 1; i <= 8; i++) { const a = (i / 8) * Math.PI / 2; prof.push([Math.cos(a) * R, L + Math.sin(a) * 0.55]); }
  prof.push([0, L + 0.55]);
  const g = lathe(prof, 40); g.rotateX(Math.PI / 2);
  k.push().at(0, 1.42 + R + 0.15, 0); k.add(g, opts.paint || 'tankBlack');
  for (const zz of [-L + 0.6, -2, 2, L - 0.6]) { const band = new THREE.TorusGeometry(R + 0.015, 0.03, 6, 40); k.add(band, 'darkSteel', new THREE.Matrix4().makeTranslation(0, 0, zz)); }
  k.cyl(0.55, 0.5, opts.paint || 'tankBlack', 0, R + 0.2, 0, 24);
  k.cyl(0.6, 0.06, 'darkSteel', 0, R + 0.46, 0, 24);
  k.box(1.6, 0.05, 2.0, 'grating', 0, R + 0.02, 0, 0.01);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.tube(V(sx * 0.8, R + 0.05, sz * 1.0), V(sx * 0.8, R + 1.0, sz * 1.0), 0.02, 'paintYellow', 6);
  for (const sx of [-1, 1]) k.tube(V(sx * 0.8, R + 1.0, -1.0), V(sx * 0.8, R + 1.0, 1.0), 0.02, 'paintYellow', 6);
  k.pop();
  for (const sz of [-1, 1]) k.box(2.4, 0.5, 0.5, 'darkSteel', 0, 1.62, sz * (len / 2 - 2.3), 0.04);
  // side ladder
  for (let i = 0; i < 6; i++) k.tube(V(1.52, 1.5 + i * 0.4, -0.25), V(1.52, 1.5 + i * 0.4, 0.25), 0.016, 'paintYellow', 5);
  k.collide(3.0, 3.3, len + 1, 0, 1.6, 0);
  info.decals.push({ kind: 'tank', side: 1, len, R, y: 1.42 + R + 0.15, seed: opts.seed });
  info.decals.push({ kind: 'tank', side: -1, len, R, y: 1.42 + R + 0.15, seed: opts.seed });
}

export function container(k, l, paint, x, y, z, ry, info, seed) {
  k.push().at(x, y, z, ry);
  const w = 2.44, h = 2.59;
  k.box(w, h - 0.12, l - 0.16, paint, 0, h / 2, 0, 0.03);
  for (const sx of [-1, 1]) for (const sy of [0, 1]) k.box(0.16, 0.14, l, 'darkSteel', sx * (w / 2 - 0.08), sy * (h - 0.14) + 0.07, 0, 0.02);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    k.box(0.16, h, 0.16, 'darkSteel', sx * (w / 2 - 0.08), h / 2, sz * (l / 2 - 0.08), 0.02);
    for (const sy of [0, 1]) k.box(0.18, 0.12, 0.18, 'steel', sx * (w / 2 - 0.08), sy * (h - 0.12) + 0.06, sz * (l / 2 - 0.08), 0.015);
  }
  // door end: two leaves with locking bars
  const dz = l / 2 - 0.01;
  k.box(w - 0.3, h - 0.3, 0.05, paint, 0, h / 2, dz, 0.01);
  for (const bx of [-0.85, -0.45, 0.45, 0.85]) {
    k.tube(V(bx, 0.2, dz + 0.06), V(bx, h - 0.2, dz + 0.06), 0.022, 'steel', 6);
    k.box(0.08, 0.12, 0.06, 'steel', bx, h / 2, dz + 0.1, 0.01);
  }
  k.box(0.02, h - 0.3, 0.06, 'darkSteel', 0, h / 2, dz + 0.04, 0.005);
  k.collide(w, h, l, 0, h / 2, 0);
  info.decals.push({ kind: 'container', l, w, h, seed: seed || 'c' + x + z, m: k.m.clone() });
  k.pop();
}

export function flatcar(k, opts, info) {
  const len = 15;
  underframe(k, len, info);
  bogie(k, -len / 2 + 2.4); bogie(k, len / 2 - 2.4);
  k.box(2.9, 0.18, len, 'wood', 0, 1.48, 0, 0.02);
  for (let i = 0; i < 18; i++) k.box(2.92, 0.02, 0.06, 'darkSteel', 0, 1.58, -len / 2 + 0.4 + i * (len - 0.8) / 17, 0.005);
  const pal = ['boxBlue', 'boxGreen', 'boxGrey', 'boxOrange', 'boxRed'];
  const r = rng(opts.seed || 'flat');
  if (opts.load === 'containers') {
    container(k, 6.06, r.pick(pal), 0, 1.57, -3.4, 0, info, opts.seed + 'a');
    container(k, 6.06, r.pick(pal), 0, 1.57, 3.4, Math.PI, info, opts.seed + 'b');
  } else if (opts.load === 'rails') {
    for (let i = 0; i < 9; i++) for (let j = 0; j < 2; j++) k.box(0.15, 0.17, len - 1, 'rust', -1.0 + i * 0.25, 1.66 + j * 0.18, 0, 0.02);
    for (const z of [-5, 0, 5]) k.box(2.6, 0.12, 0.2, 'wood', 0, 1.62, z, 0.02);
  }
  k.collide(3.0, 4.2, len, 0, 2.1, 0);
}

export function hopper(k, opts, info) {
  const len = 14;
  underframe(k, len, info);
  bogie(k, -len / 2 + 2.3); bogie(k, len / 2 - 2.3);
  const s = new THREE.Shape(); s.moveTo(-1.5, 3.4); s.lineTo(1.5, 3.4); s.lineTo(1.5, 1.4); s.lineTo(0.4, 0.2); s.lineTo(-0.4, 0.2); s.lineTo(-1.5, 1.4);
  const paint = opts.paint || 'boxGrey';
  k.push().at(0, 1.0, 0); k.add(extrude(s, len - 0.6, 0.03, 1), paint); k.pop();
  for (let i = 0; i < 9; i++) for (const sx of [-1, 1]) k.box(0.08, 2.0, 0.14, paint, sx * 1.53, 3.4, -len / 2 + 0.8 + i * (len - 1.6) / 8, 0.02);
  for (const z of [-4.5, -1.5, 1.5, 4.5]) k.box(0.9, 0.5, 0.9, 'darkSteel', 0, 1.15, z, 0.04);
  k.collide(3.1, 4.4, len, 0, 2.2, 0);
  info.decals.push({ kind: 'wagon', side: 1, len: len - 0.6, h: 2.0, y0: 2.4, seed: opts.seed, small: true });
  info.decals.push({ kind: 'wagon', side: -1, len: len - 0.6, h: 2.0, y0: 2.4, seed: opts.seed, small: true });
}

export function locomotive(k, opts, info) {
  const len = 19;
  underframe(k, len, info);
  bogie(k, -len / 2 + 3.4, 3); bogie(k, len / 2 - 3.4, 3);
  k.box(3.0, 0.25, len + 0.4, 'locoBody', 0, 1.5, 0, 0.04);
  // fuel tank
  const tank = roundRect(2.6, 1.0, 0.35); k.push().at(0, 0.98, 0); k.add(extrude(tank, 7, 0.03, 2), 'darkSteel'); k.pop();
  // long hood
  k.box(2.3, 2.5, 12.0, 'locoBody', 0, 2.9, -2.8, 0.18);
  for (let i = 0; i < 9; i++) for (const sx of [-1, 1]) {
    k.box(0.04, 1.6, 1.0, 'grating', sx * 1.17, 2.95, -8 + i * 1.25, 0.01);
    k.box(0.05, 1.7, 0.06, 'locoBody', sx * 1.18, 2.95, -8.65 + i * 1.25, 0.01);
  }
  for (let i = 0; i < 3; i++) { k.cyl(0.55, 0.18, 'darkSteel', 0, 4.2, -7 + i * 2.2, 24); k.cyl(0.5, 0.05, 'grating', 0, 4.31, -7 + i * 2.2, 24); }
  k.box(0.6, 0.5, 0.9, 'darkSteel', 0, 4.35, -1.4, 0.06);
  // cab
  k.box(3.0, 2.9, 3.4, 'locoBody', 0, 3.1, 5.0, 0.12);
  k.box(3.1, 0.18, 3.6, 'locoBody', 0, 4.62, 5.0, 0.06);
  for (const sx of [-1, 1]) { k.box(0.06, 0.9, 1.2, 'glass', sx * 1.51, 3.7, 5.4, 0.02); k.box(0.06, 1.0, 1.4, 'locoTrim', sx * 1.5, 3.7, 5.4, 0.02); }
  k.box(1.1, 0.8, 0.06, 'glass', -0.65, 3.85, 6.72, 0.02); k.box(1.1, 0.8, 0.06, 'glass', 0.65, 3.85, 6.72, 0.02);
  // short hood
  k.box(2.3, 2.0, 2.4, 'locoBody', 0, 2.6, 7.9, 0.16);
  // headlights
  k.box(0.7, 0.3, 0.1, 'locoTrim', 0, 3.0, 9.12, 0.03);
  for (const sx of [-0.18, 0.18]) k.cyl(0.11, 0.06, opts.lit ? 'emitHead' : 'glass', sx, 3.0, 9.18, 16, 'z');
  for (const sx of [-1, 1]) k.cyl(0.1, 0.06, opts.lit ? 'emitHead' : 'glass', sx * 1.0, 1.75, 9.6, 16, 'z');
  // handrails along the walkway
  for (const sx of [-1, 1]) {
    k.tube(V(sx * 1.45, 2.45, -8.5), V(sx * 1.45, 2.45, 3.0), 0.025, 'paintYellow', 6);
    for (let i = 0; i < 8; i++) k.tube(V(sx * 1.45, 1.62, -8.5 + i * 1.6), V(sx * 1.45, 2.45, -8.5 + i * 1.6), 0.02, 'paintYellow', 6);
  }
  // nose stripes plate
  k.box(2.9, 0.5, 0.06, 'paintYellow', 0, 1.55, len / 2 + 0.24, 0.01);
  k.collide(3.1, 4.8, len + 1, 0, 2.4, 0);
  info.lamps.push({ pos: V(0, 3.0, 9.6), dir: V(0, -0.08, 1), color: 0xfff1d0, power: opts.lit ? 1 : 0, kind: 'head', id: 'loco', cone: true, coneLen: 34, angle: 0.32, range: 70 });
  info.decals.push({ kind: 'loco', len, seed: opts.seed });
}

export function catenaryPole(k, span, info) {
  // H-beam mast with cantilever arms over `span` metres of track (towards +x)
  k.box(0.32, 8.4, 0.26, 'paintGrey', 0, 4.2, 0, 0.02);
  k.box(0.06, 8.4, 0.26, 'paintGrey', 0.13, 4.2, 0, 0.01);
  k.box(0.7, 0.4, 0.7, 'concrete', 0, 0.2, 0, 0.05);
  // cross girder
  k.box(span, 0.24, 0.2, 'paintGrey', span / 2, 8.1, 0, 0.02);
  k.box(span, 0.12, 0.12, 'paintGrey', span / 2, 7.6, 0, 0.02);
  for (let i = 0; i < Math.floor(span / 1.2); i++) {
    const x0 = i * 1.2, x1 = x0 + 1.2;
    k.tube(V(x0, 7.6, 0), V(x1, 8.1, 0), 0.03, 'paintGrey', 5);
  }
  for (let t = 0; t < info.tracks; t++) {
    const x = info.trackX[t];
    if (x < 0.5 || x > span) continue;
    k.tube(V(x, 7.6, 0), V(x, 6.3, 0), 0.03, 'steel', 6);
    k.cyl(0.07, 0.28, 'insulator', x, 6.85, 0, 10);
    k.tube(V(x - 0.4, 6.3, 0), V(x + 0.25, 5.65, 0), 0.025, 'steel', 6);
  }
  k.collide(0.45, 8.4, 0.45, 0, 4.2, 0);
}

export function floodMast(k, opts, info) {
  const H = opts.h || 19;
  const leg = 1.1;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    k.tube(V(sx * leg, 0, sz * leg), V(sx * 0.35, H, sz * 0.35), 0.06, 'galv', 6);
    k.box(0.5, 0.3, 0.5, 'concrete', sx * leg, 0.15, sz * leg, 0.04);
  }
  const lvls = 8;
  for (let i = 0; i < lvls; i++) {
    const y0 = (i / lvls) * H, y1 = ((i + 1) / lvls) * H;
    const w0 = leg + (0.35 - leg) * (i / lvls), w1 = leg + (0.35 - leg) * ((i + 1) / lvls);
    for (let s = 0; s < 4; s++) {
      const a0 = [[1, 1], [1, -1], [-1, -1], [-1, 1]][s], a1 = [[1, -1], [-1, -1], [-1, 1], [1, 1]][s];
      k.tube(V(a0[0] * w0, y0, a0[1] * w0), V(a1[0] * w1, y1, a1[1] * w1), 0.025, 'galv', 4);
      k.tube(V(a0[0] * w1, y1, a0[1] * w1), V(a1[0] * w1, y1, a1[1] * w1), 0.025, 'galv', 4);
    }
  }
  // platform and light heads
  k.box(2.4, 0.08, 1.4, 'grating', 0, H, 0, 0.01);
  k.tube(V(-1.2, H + 0.9, 0.7), V(1.2, H + 0.9, 0.7), 0.025, 'galv', 5);
  for (const x of [-1.2, 0, 1.2]) k.tube(V(x, H + 0.03, 0.66), V(x, H + 0.92, 0.7), 0.02, 'galv', 4); // rail posts on the platform
  const heads = opts.heads || 4;
  for (let i = 0; i < heads; i++) {
    const x = (i - (heads - 1) / 2) * 0.6;
    k.tube(V(x, H + 0.9, 0.7), V(x, H + 0.55, 0.75), 0.018, 'galv', 4); // each head hangs from the rail on a bracket
    k.push().at(x, H + 0.55, 0.75, 0, -0.75 + (i % 2) * 0.15);
    k.box(0.5, 0.36, 0.22, 'darkSteel', 0, 0, 0, 0.04);
    k.box(0.44, 0.3, 0.03, 'emitSodium', 0, 0, 0.12, 0.01);
    k.pop();
  }
  k.collide(2.4, H, 2.4, 0, H / 2, 0);
  const aim = opts.aim || V(0, -1, 1.2);
  info.lamps.push({ pos: V(0, H + 0.55, 0.9), dir: aim.clone().normalize(), color: 0xffa040, power: 1, kind: 'flood', angle: 0.75, range: 60, cone: true, coneLen: H * 1.3 });
}

export function lampPost(k, opts, info) {
  k.cyl(0.09, 6.2, 'paintGrey', 0, 3.1, 0, 10);
  k.cyl(0.18, 0.4, 'concrete', 0, 0.2, 0, 12);
  k.tube(V(0, 6.1, 0), V(0, 6.35, 1.0), 0.05, 'paintGrey', 8);
  k.box(0.32, 0.12, 0.6, 'darkSteel', 0, 6.33, 1.25, 0.03);
  k.box(0.26, 0.02, 0.5, 'emitSodium', 0, 6.26, 1.25, 0.005);
  k.collide(0.3, 6, 0.3, 0, 3, 0);
  info.lamps.push({ pos: V(0, 6.2, 1.25), dir: V(0, -1, 0.05), color: 0xff9a3a, power: 0.6, kind: 'post', angle: 1.0, range: 22, cone: true, coneLen: 6.4 });
}

export function signalGantry(k, span, info) {
  for (const x of [0, span]) {
    for (const sz of [-0.5, 0.5]) k.box(0.2, 7.2, 0.2, 'paintGrey', x, 3.6, sz, 0.02);
    for (let i = 0; i < 6; i++) k.tube(V(x, i * 1.2, -0.5), V(x, (i + 1) * 1.2, 0.5), 0.025, 'paintGrey', 4);
    k.box(0.9, 0.3, 1.5, 'concrete', x, 0.15, 0, 0.04);
  }
  for (const sz of [-0.5, 0.5]) k.box(span, 0.18, 0.18, 'paintGrey', span / 2, 7.2, sz, 0.02);
  for (let i = 0; i < Math.floor(span / 1.0); i++) k.tube(V(i, 7.2, -0.5), V(i + 1, 7.2, 0.5), 0.022, 'paintGrey', 4);
  k.box(span, 0.06, 1.0, 'grating', span / 2, 7.32, 0, 0.01);
  for (let t = 0; t < info.tracks; t++) {
    const x = info.trackX[t];
    if (x < 1 || x > span - 1) continue;
    k.push().at(x, 6.2, 0.6);
    k.box(0.5, 1.5, 0.3, 'darkSteel', 0, 0, 0, 0.06);
    for (let j = 0; j < 3; j++) {
      k.cyl(0.13, 0.05, j === 0 ? 'emitRed' : 'glass', 0, 0.45 - j * 0.42, 0.17, 16, 'z');
      k.cyl(0.17, 0.2, 'darkSteel', 0, 0.5 - j * 0.42, 0.25, 16, 'z');
    }
    k.pop();
  }
}

export function signalBox(k, opts, info) {
  // two storey brick tower with glazed upper cabin, external stair
  const W = 6.4, D = 4.4;
  k.box(W, 3.2, D, 'brick', 0, 1.6, 0, 0.02);
  k.box(W + 0.2, 0.2, D + 0.2, 'concrete', 0, 3.25, 0, 0.03);
  // upper cabin frame and glass
  k.box(W, 0.9, D, 'boardsGreen', 0, 3.8, 0, 0.02);
  for (const sx of [-1, 1]) {
    k.box(0.05, 1.3, D - 0.4, 'glassLit', sx * (W / 2 - 0.02), 4.9, 0, 0.01);
    for (let i = 0; i < 5; i++) k.box(0.1, 1.4, 0.08, 'boardsGreen', sx * (W / 2), 4.9, -D / 2 + 0.2 + i * (D - 0.4) / 4, 0.01);
  }
  for (const sz of [-1, 1]) {
    k.box(W - 0.4, 1.3, 0.05, 'glassLit', 0, 4.9, sz * (D / 2 - 0.02), 0.01);
    for (let i = 0; i < 7; i++) k.box(0.08, 1.4, 0.1, 'boardsGreen', -W / 2 + 0.2 + i * (W - 0.4) / 6, 4.9, sz * (D / 2), 0.01);
  }
  k.box(W, 0.25, D, 'boardsGreen', 0, 5.7, 0, 0.02);
  // hipped roof
  const roof = new THREE.ConeGeometry(Math.hypot(W, D) / 2 + 0.6, 1.5, 4, 1); roof.rotateY(Math.PI / 4); roof.scale(1, 1, D / W);
  k.push().at(0, 6.55, 0); k.add(roof, 'roofSlate'); k.pop();
  k.cyl(0.25, 1.2, 'brick', 1.8, 7.0, 0.8, 10);
  // ground floor windows (boarded) and door
  for (const x of [-1.8, 1.8]) { k.box(1.0, 1.1, 0.08, 'boards', x, 1.7, D / 2 + 0.02, 0.01); k.box(1.2, 0.12, 0.2, 'concrete', x, 1.1, D / 2 + 0.08, 0.02); }
  k.box(1.0, 2.1, 0.08, 'doorSteel', 0, 1.05, D / 2 + 0.03, 0.02);
  // external stair to cabin
  for (let i = 0; i < 14; i++) k.box(1.0, 0.05, 0.3, 'grating', W / 2 + 0.6, 0.25 + i * 0.25, D / 2 - 0.2 - i * 0.27, 0.01);
  k.tube(V(W / 2 + 1.1, 1.2, D / 2 - 0.2), V(W / 2 + 1.1, 4.6, -D / 2 + 0.4), 0.025, 'paintGrey', 6);
  k.box(1.2, 0.08, 1.2, 'grating', W / 2 + 0.6, 3.6, -D / 2 + 0.2, 0.01);
  k.collide(W, 6.2, D, 0, 3.1, 0);
  k.collide(1.2, 3.6, D, W / 2 + 0.6, 1.8, 0);
  info.lamps.push({ pos: V(0, 4.9, 0), dir: V(0, -1, 0), color: 0xffd9a0, power: 0.0, kind: 'cabin', angle: 1.4, range: 10, id: opts.id });
  info.decals.push({ kind: 'sign', text: opts.name || 'GÁC GHI', w: 2.2, h: 0.5, m: k.m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 3.6, D / 2 + 0.05)) });
}

export function powerCabinet(k, opts, info) {
  k.box(1.4, 1.9, 0.6, 'paintGreyGreen', 0, 0.95 + 0.15, 0, 0.04);
  k.box(1.6, 0.15, 0.8, 'concrete', 0, 0.075, 0, 0.03);
  k.box(1.5, 0.08, 0.7, 'paintGreyGreen', 0, 2.1, 0, 0.02);
  for (const sx of [-0.35, 0.35]) k.box(0.62, 1.7, 0.03, 'paintGreyGreen', sx, 1.05, 0.31, 0.01);
  k.box(0.05, 0.2, 0.05, 'steel', 0.05, 1.2, 0.34, 0.01);
  k.tube(V(0.5, 0.15, 0), V(0.5, -0.3, 0), 0.06, 'rubber', 8);
  k.collide(1.5, 2.2, 0.8, 0, 1.1, 0);
  info.objectives.push({ id: opts.id, m: k.m.clone() });
}

export function shed(k, opts, info) {
  const W = opts.w || 26, L = opts.l || 44, H = 9;
  // walls with big door openings at the ends
  for (const sx of [-1, 1]) {
    k.box(0.15, H, L, 'shedWall', sx * W / 2, H / 2, 0, 0.02);
    for (let i = 0; i <= 11; i++) k.box(0.35, H, 0.3, 'paintGrey', sx * (W / 2 - 0.2), H / 2, -L / 2 + i * (L / 11), 0.02);
    for (let i = 0; i < 6; i++) k.box(0.06, 1.2, 3.0, 'glassLit', sx * (W / 2 + 0.02), H - 1.6, -L / 2 + 3.5 + i * 7.4, 0.01);
  }
  for (const sz of [-1, 1]) {
    k.box(W / 2 - 5, H, 0.15, 'shedWall', -W / 4 - 2.5, H / 2, sz * L / 2, 0.02);
    k.box(W / 2 - 5, H, 0.15, 'shedWall', W / 4 + 2.5, H / 2, sz * L / 2, 0.02);
    k.box(10, H - 6.5, 0.15, 'shedWall', 0, 6.5 + (H - 6.5) / 2, sz * L / 2, 0.02);
    k.box(10.4, 0.4, 0.4, 'paintYellow', 0, 6.3, sz * L / 2, 0.03);
    k.collide(W / 2 - 5, H, 0.5, -W / 4 - 2.5, H / 2, sz * L / 2);
    k.collide(W / 2 - 5, H, 0.5, W / 4 + 2.5, H / 2, sz * L / 2);
  }
  for (const sx of [-1, 1]) k.collide(0.5, H, L, sx * W / 2, H / 2, 0);
  // gable roof
  const rise = 3.0;
  for (const sx of [-1, 1]) {
    k.push().at(sx * W / 4, H + rise / 2, 0, 0, 0, -sx * Math.atan2(rise, W / 2));
    k.box(Math.hypot(W / 2, rise) + 0.6, 0.12, L + 0.8, 'shedRoof', 0, 0, 0, 0.02);
    k.pop();
  }
  for (let i = 0; i <= 11; i++) {
    const z = -L / 2 + i * (L / 11);
    k.tube(V(-W / 2, H, z), V(0, H + rise - 0.2, z), 0.12, 'paintGrey', 6);
    k.tube(V(W / 2, H, z), V(0, H + rise - 0.2, z), 0.12, 'paintGrey', 6);
    k.tube(V(-W / 2, H, z), V(W / 2, H, z), 0.08, 'paintGrey', 6);
  }
  // interior floor (dry, oily concrete) and hanging lamps
  k.box(W - 0.4, 0.1, L - 0.4, 'shedFloor', 0, 0.05, 0, 0.01);
  for (let i = 0; i < 4; i++) {
    const z = -L / 2 + 6 + i * ((L - 12) / 3);
    for (const x of [-W / 4, W / 4]) {
      k.tube(V(x, H, z), V(x, H - 2.5, z), 0.01, 'darkSteel', 4);
      const shade = new THREE.ConeGeometry(0.45, 0.35, 16, 1, true); k.add(shade, 'paintGreenDark', new THREE.Matrix4().makeTranslation(x, H - 2.65, z));
      k.cyl(0.12, 0.1, 'emitWarm', x, H - 2.8, z, 12);
      info.lamps.push({ pos: V(x, H - 2.9, z), dir: V(0, -1, 0), color: 0xffc27a, power: 0.8, kind: 'hang', angle: 1.1, range: 16, cone: true, coneLen: 6.2, inside: true });
    }
  }
  info.dryZones.push({ m: k.m.clone(), w: W, l: L, h: H + rise });
}

export function platform(k, opts, info) {
  const L = opts.l || 70, W = 6;
  k.box(W, 1.05, L, 'concrete', 0, 0.52, 0, 0.04);
  k.box(0.6, 0.08, L, 'paintYellow', -W / 2 + 0.35, 1.07, 0, 0.005);
  k.box(0.1, 0.1, L, 'concrete', -W / 2 + 0.05, 1.0, 0, 0.02);
  k.collide(W, 1.05, L, 0, 0.52, 0);
  // canopy
  const cl = opts.canopy || 40;
  for (let i = 0; i <= Math.floor(cl / 6); i++) {
    const z = -cl / 2 + i * 6;
    k.box(0.22, 4.2, 0.22, 'paintGreenDark', 0.6, 3.15, z, 0.02);
    k.box(5.2, 0.25, 0.18, 'paintGreenDark', 0.3, 5.2, z, 0.02);
    k.tube(V(0.6, 4.2, z), V(-2.0, 5.15, z), 0.05, 'paintGreenDark', 6);
    k.tube(V(0.6, 4.2, z), V(2.6, 5.15, z), 0.05, 'paintGreenDark', 6);
    k.collide(0.3, 4.2, 0.3, 0.6, 3.15, z);
  }
  k.push().at(0.3, 5.42, 0, 0, 0, 0.05); k.box(5.6, 0.1, cl + 0.6, 'shedRoof', 0, 0, 0, 0.02); k.pop();
  for (const sx of [-1, 1]) k.box(0.08, 0.35, cl + 0.6, 'paintGreenDark', 0.3 + sx * 2.8, 5.3 + sx * -0.14, 0, 0.01);
  // benches, signs, bins
  for (let i = 0; i < 4; i++) {
    const z = -cl / 2 + 5 + i * 9;
    k.push().at(1.6, 1.05, z);
    k.box(0.5, 0.06, 1.8, 'wood', 0, 0.45, 0, 0.01); k.box(0.06, 0.45, 1.8, 'wood', 0.25, 0.75, 0, 0.01);
    for (const s of [-0.75, 0.75]) k.box(0.45, 0.45, 0.06, 'darkSteel', 0, 0.22, s, 0.01);
    k.pop();
    k.cyl(0.25, 0.8, 'paintGreenDark', 2.4, 1.45, z + 3, 14);
  }
  info.dryZones.push({ m: k.m.clone().multiply(new THREE.Matrix4().makeTranslation(0.3, 0, 0)), w: 5.4, l: cl, h: 5.4 });
  info.decals.push({ kind: 'sign', text: opts.name || 'GA BẮC', w: 3.2, h: 0.6, m: k.m.clone().multiply(new THREE.Matrix4().makeTranslation(0.3, 4.75, -cl / 2 - 0.3).multiply(new THREE.Matrix4().makeRotationY(Math.PI))) });
}

export function jersey(k) {
  const s = new THREE.Shape(); s.moveTo(-0.3, 0); s.lineTo(0.3, 0); s.lineTo(0.3, 0.08); s.lineTo(0.13, 0.33); s.lineTo(0.1, 0.8); s.lineTo(-0.1, 0.8); s.lineTo(-0.13, 0.33); s.lineTo(-0.3, 0.08);
  const g = extrude(s, 3.0, 0.02, 1); k.add(g, 'concrete');
  k.collide(0.62, 0.8, 3.0, 0, 0.4, 0);
}
export function pallet(k, n = 1, load) {
  for (let j = 0; j < n; j++) {
    const y = j * 0.15;
    for (let i = 0; i < 5; i++) k.box(1.2, 0.022, 0.12, 'woodLight', 0, y + 0.135, -0.4 + i * 0.2, 0.004);
    for (const z of [-0.45, 0, 0.45]) k.box(1.2, 0.1, 0.1, 'woodLight', 0, y + 0.07, z, 0.006);
  }
  if (load === 'sacks') for (let i = 0; i < 6; i++) k.box(0.55, 0.22, 0.4, 'tarp', ((i % 2) - 0.5) * 0.58, n * 0.15 + 0.11 + Math.floor(i / 2) * 0.22, 0, 0.08);
  k.collide(1.2, n * 0.15 + (load ? 0.7 : 0), 1.0, 0, (n * 0.15 + (load ? 0.7 : 0)) / 2, 0);
}
export function barrel(k, paint) {
  const p = [[0, 0], [0.27, 0], [0.29, 0.03], [0.29, 0.3], [0.3, 0.32], [0.29, 0.34], [0.29, 0.56], [0.3, 0.58], [0.29, 0.6], [0.29, 0.86], [0.27, 0.89], [0, 0.89]];
  k.add(lathe(p, 22), paint || 'paintBlue');
  k.collide(0.6, 0.9, 0.6, 0, 0.45, 0);
}
export function cableDrum(k) {
  k.cyl(0.9, 0.08, 'woodLight', 0, 0.9, -0.5, 24, 'z'); k.cyl(0.9, 0.08, 'woodLight', 0, 0.9, 0.5, 24, 'z');
  k.cyl(0.62, 0.92, 'rubber', 0, 0.9, 0, 24, 'z');
  k.collide(1.8, 1.8, 1.1, 0, 0.9, 0);
}
export function sleeperStack(k, n) {
  for (let j = 0; j < n; j++) for (let i = 0; i < 6; i++) {
    if (j % 2 === 0) k.box(2.6, 0.16, 0.26, 'wood', 0, 0.08 + j * 0.16, -0.75 + i * 0.3, 0.02);
    else k.box(0.26, 0.16, 2.6, 'wood', -0.75 + i * 0.3, 0.08 + j * 0.16, 0, 0.02);
  }
  k.collide(2.6, n * 0.16, 2.6, 0, n * 0.08, 0);
}
export function cabin(k, paint) {
  k.box(2.5, 2.6, 6, paint || 'boxGrey', 0, 1.45, 0, 0.06);
  k.box(2.7, 0.15, 6.2, 'darkSteel', 0, 2.82, 0, 0.03);
  for (const z of [-1.6, 1.4]) k.box(0.05, 0.8, 1.0, 'glassLit', 1.26, 1.8, z, 0.01);
  k.box(0.05, 2.0, 0.9, 'doorSteel', 1.26, 1.15, -0.1, 0.01);
  for (const z of [-2.7, 2.7]) for (const x of [-1, 1]) k.box(0.3, 0.15, 0.3, 'concrete', x, 0.08, z, 0.02);
  k.collide(2.6, 2.9, 6.1, 0, 1.45, 0);
}
export function fence(k, len) {
  const n = Math.ceil(len / 2.5);
  for (let i = 0; i <= n; i++) {
    const z = -len / 2 + i * (len / n);
    k.cyl(0.035, 2.4, 'galv', 0, 1.2, z, 8);
    k.tube(V(0, 2.4, z), V(0.25, 2.65, z), 0.02, 'galv', 4);
  }
  k.tube(V(0, 2.35, -len / 2), V(0, 2.35, len / 2), 0.02, 'galv', 5);
  k.tube(V(0, 0.1, -len / 2), V(0, 0.1, len / 2), 0.015, 'galv', 5);
  const pl = new THREE.PlaneGeometry(len, 2.2); const uv = pl.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 0.1, uv.getY(i) * 2.2 / 0.1);
  pl.rotateY(Math.PI / 2); pl.translate(0, 1.2, 0); k.addLoose(pl, 'mesh');
  for (let i = 0; i < 3; i++) k.tube(V(0.08 + i * 0.07, 2.45 + i * 0.07, -len / 2), V(0.08 + i * 0.07, 2.45 + i * 0.07, len / 2), 0.006, 'galv', 3);
  k.collide(0.2, 2.6, len, 0, 1.3, 0);
}

// ---------------------------------------------------------------------------------------------------------------
// Street / roadside kit (The Walking Trade, procedural). Keys are "<surface>#<hex>" resolved by a VKit:
// c concrete, b brick, p plaster, r corrugated, m painted metal, s steel, u rust, w wood, f fabric, y polymer/rubber,
// a asphalt, d decal (flat, polygon offset), g plant (double sided), l plain; plus glass, win (lit at night), lamp
// (emissive at night), blink (red beacon), chain (alpha-tested chain-link with uv). Local axes: y up, front = +z.
// Dimensions are real-world (Saltline props-level.md 4: real sizes, many small bevelled parts).

export function catenary(k, a, b, sag, r, key, seg) {
  const n = seg || 10; let prev = a;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const p = new THREE.Vector3().lerpVectors(a, b, t); p.y -= sag * 4 * t * (1 - t);
    k.tube(prev, p, r, key || 'l#151515', 4); prev = p;
  }
}

export function streetLamp(k, o = {}) {
  const H = o.h || 7.2, reach = o.reach ?? 1.7, pole = 'm#3c4245';
  k.box(0.46, 0.45, 0.46, 'c#8b8780', 0, 0.225, 0, 0.04);
  k.box(0.32, 0.04, 0.32, pole, 0, 0.47, 0, 0.01);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl(0.018, 0.06, 's#9a9a96', sx * 0.12, 0.5, sz * 0.12, 6);
  k.add(lathe([[0.12, 0.47], [0.115, 0.9], [0.1, 1.2], [0.065, H], [0, H]], 8), pole);
  k.box(0.1, 0.32, 0.02, pole, 0, 1.0, 0.105, 0.005);
  let prev = V(0, H - 0.4, 0);
  for (let i = 1; i <= 6; i++) {
    const t = i / 6, a = t * Math.PI / 2;
    const p = V(0, H - 0.4 + Math.sin(a) * 0.55, (1 - Math.cos(a)) * 0.55 + Math.max(0, t - 0.5) * 2 * (reach - 0.55));
    k.tube(prev, p, 0.045, pole, 8); prev = p;
  }
  k.push().at(0, prev.y + 0.02, prev.z + 0.28, 0, 0.06);
  k.box(0.34, 0.13, 0.7, 'm#2a2d2f', 0, 0, 0, 0.04);
  k.box(0.3, 0.05, 0.62, 'm#2a2d2f', 0, 0.08, -0.02, 0.02);
  k.box(0.27, 0.02, 0.54, o.dead ? 'glass' : 'lamp', 0, -0.07, 0, 0.006);
  k.pop();
}

export function utilityBracket(k) {
  k.box(0.1, 0.1, 0.45, 'm#3a3a3a', 0, 0, -0.2, 0.01);
  k.cyl(0.05, 0.12, 'm#5a3018', 0, 0.08, -0.4, 10);
}

export function signPost(k, o = {}) {
  const h = o.h || 2.6, post = 's#8d9296';
  k.cyl(0.032, h, post, 0, h / 2, 0, 8);
  k.cyl(0.036, 0.03, 's#6a6e70', 0, h + 0.015, 0, 8);
  const y = h - 0.35, z = 0.05;
  k.push().at(0, y, z, 0, 0, o.tilt || 0);
  const red = 'm#9c2219', white = 'm#c9c6bc', blue = 'm#1f4a8a', back = 's#7a7e80', ylw = 'm#c09a20';
  if (o.kind === 'tri') {
    const tri = (s) => { const sh = new THREE.Shape(); sh.moveTo(-s, -s * 0.58); sh.lineTo(s, -s * 0.58); sh.lineTo(0, s * 1.15); sh.lineTo(-s, -s * 0.58); return sh; };
    k.add(extrude(tri(0.4), 0.02, 0.006, 1), red, new THREE.Matrix4().makeTranslation(0, 0, 0));
    k.add(extrude(tri(0.3), 0.012, 0, 0), white, new THREE.Matrix4().makeTranslation(0, 0.0, 0.014));
    k.box(0.05, 0.22, 0.01, 'l#151515', 0, 0.02, 0.022, 0.003); k.box(0.05, 0.05, 0.01, 'l#151515', 0, -0.13, 0.022, 0.003);
  } else if (o.kind === 'octa') {
    k.cyl(0.36, 0.02, red, 0, 0, 0, 8, 'z'); k.cyl(0.33, 0.024, white, 0, 0, 0.0, 8, 'z'); k.cyl(0.31, 0.03, red, 0, 0, 0.0, 8, 'z');
    k.box(0.42, 0.08, 0.01, white, 0, 0, 0.018, 0.002);
  } else if (o.kind === 'rect') {
    k.box(0.6, 0.6, 0.02, blue, 0, 0, 0, 0.008); k.box(0.52, 0.52, 0.012, white, 0, 0, 0.012, 0.004); k.box(0.44, 0.44, 0.012, blue, 0, 0, 0.016, 0.004);
    k.box(0.08, 0.3, 0.01, white, -0.06, 0.02, 0.024, 0.002); k.box(0.16, 0.06, 0.01, white, 0.0, 0.14, 0.024, 0.002);
  } else if (o.kind === 'yellow') {
    k.push().at(0, 0, 0, 0, 0, Math.PI / 4); k.box(0.5, 0.5, 0.02, ylw, 0, 0, 0, 0.008); k.box(0.42, 0.42, 0.012, 'l#151515', 0, 0, 0.012, 0.004); k.box(0.38, 0.38, 0.014, ylw, 0, 0, 0.016, 0.004); k.pop();
  } else {
    k.cyl(0.32, 0.02, red, 0, 0, 0, 24, 'z'); k.cyl(0.25, 0.024, white, 0, 0, 0.002, 24, 'z');
    if (o.kind === 'noentry') k.box(0.36, 0.08, 0.01, red, 0, 0, 0.016, 0.003);
    else { k.push().at(0, 0, 0.016, 0, 0, 0.78); k.box(0.46, 0.05, 0.01, red, 0, 0, 0, 0.003); k.pop(); }
  }
  k.box(0.1, 0.06, 0.08, back, 0, 0.18, -0.03, 0.01); k.box(0.1, 0.06, 0.08, back, 0, -0.18, -0.03, 0.01);
  k.pop();
}

export function busShelter(k, o = {}) {
  const W = 4.2, D = 1.5, H = 2.45, frame = 'm#33393c';
  for (const x of [-W / 2, W / 2]) for (const z of [-D / 2, D / 2 - 0.1]) k.box(0.08, H, 0.08, frame, x, H / 2, z, 0.012);
  k.push().at(0, H + 0.06, 0, 0, -0.06);
  k.box(W + 0.4, 0.06, D + 0.4, 'r#6e7478', 0, 0, 0, 0.01);
  k.box(W + 0.44, 0.18, 0.06, frame, 0, -0.04, D / 2 + 0.22, 0.01);
  k.box(W + 0.44, 0.18, 0.06, frame, 0, -0.04, -D / 2 - 0.22, 0.01);
  k.pop();
  for (let i = 0; i < 3; i++) {
    const x = -W / 2 + W / 6 + i * W / 3;
    k.box(W / 3 - 0.08, 1.7, 0.012, i === 1 && o.broken ? 'l#0b0c0d' : 'glass', x, 1.15, -D / 2, 0.002);
    k.box(W / 3 - 0.02, 0.05, 0.05, frame, x, 0.28, -D / 2, 0.01);
    k.box(W / 3 - 0.02, 0.05, 0.05, frame, x, 2.02, -D / 2, 0.01);
  }
  k.box(0.012, 1.7, D - 0.2, 'glass', W / 2, 1.15, -0.05, 0.002);
  k.box(0.05, 0.05, D - 0.2, frame, W / 2, 2.02, -0.05, 0.01);
  // ad lightbox on the west end
  k.box(0.18, 1.8, 1.2, frame, -W / 2, 1.2, -0.1, 0.02);
  k.box(0.012, 1.6, 1.0, 'win', -W / 2 + 0.096, 1.2, -0.1, 0.003);
  k.box(0.012, 1.6, 1.0, o.adColor ? 'l#' + o.adColor : 'l#3a6a7a', -W / 2 - 0.096, 1.2, -0.1, 0.003);
  // bench
  for (const x of [-1.2, 0, 1.2]) k.box(0.05, 0.45, 0.4, frame, x, 0.22, -D / 2 + 0.3, 0.01);
  for (let s = 0; s < 3; s++) k.box(2.8, 0.03, 0.1, 'w#6a4a30', 0, 0.46, -D / 2 + 0.16 + s * 0.13, 0.008);
  k.box(0.5, 0.4, 0.012, 'l#d8d2bc', 1.4, 1.5, -D / 2 + 0.014, 0.002);
}

// Car: lower body extruded from a side profile, glass greenhouse, pillars, wheels, lights; wrecked variants.
export function car(k, o = {}) {
  const r = rng(o.seed || 'car');
  const L = o.len || 4.3, W = 1.76, body = 'm#' + (o.color || '6d7f8f'), wreck = o.wreck || 0;
  const burnt = o.burnt, bodyK = burnt ? 'u#3a2a22' : body;
  const flat = (i) => wreck > 0.3 && r() < 0.5;
  const hl = L / 2;
  const s = new THREE.Shape();
  s.moveTo(-hl, 0.32); s.lineTo(-hl + 0.05, 0.62); s.lineTo(-hl + 0.6, 0.8); s.lineTo(hl - 0.95, 0.82); s.lineTo(hl - 0.15, 0.72); s.lineTo(hl, 0.55); s.lineTo(hl, 0.3); s.lineTo(hl - 0.5, 0.26);
  s.absarc(hl - 0.82, 0.3, 0.38, 0, Math.PI, false); s.lineTo(-hl + 1.15, 0.26); s.absarc(-hl + 0.78, 0.3, 0.38, 0, Math.PI, false); s.lineTo(-hl, 0.3);
  k.push().at(0, 0, 0, Math.PI / 2);
  k.push().at(0, 0, 0, 0, 0, 0);
  k.add(extrude(s, W, 0.05, 1), bodyK);
  k.pop();
  // greenhouse
  const gs = new THREE.Shape();
  gs.moveTo(-hl + 0.62, 0.8); gs.lineTo(-hl + 1.05, 1.32); gs.lineTo(hl - 1.75, 1.36); gs.lineTo(hl - 1.0, 0.82);
  const glassK = burnt ? 'l#0a0a0a' : 'glass';
  k.add(extrude(gs, W - 0.22, 0.02, 1), glassK);
  // roof panel and pillars
  k.box(hl - 1.75 + hl - 1.05 + 0.05, 0.05, W - 0.18, bodyK, ((-hl + 1.05) + (hl - 1.75)) / 2, 1.36, 0, 0.02);
  for (const sz of [-1, 1]) {
    const zz = sz * (W - 0.21) / 2;
    k.push().at(-hl + 0.84, 1.06, zz, 0, 0, -0.88); k.box(0.07, 0.62, 0.05, bodyK, 0, 0, 0, 0.01); k.pop();
    k.push().at(hl - 1.38, 1.09, zz, 0, 0, 0.83); k.box(0.07, 0.68, 0.05, bodyK, 0, 0, 0, 0.01); k.pop();
    k.box(0.08, 0.52, 0.05, bodyK, -0.15, 1.08, zz, 0.01);
    // door seams, handles, mirror
    k.box(0.012, 0.42, 0.01, 'l#141414', -0.18, 0.55, sz * (W / 2 + 0.05), 0.002);
    k.box(0.012, 0.42, 0.01, 'l#141414', 0.85, 0.55, sz * (W / 2 + 0.05), 0.002);
    k.box(0.14, 0.03, 0.03, 's#8a8e90', 0.55, 0.74, sz * (W / 2 + 0.06), 0.006);
    k.box(0.14, 0.03, 0.03, 's#8a8e90', -0.4, 0.74, sz * (W / 2 + 0.06), 0.006);
    if (!(wreck > 0.6 && sz > 0)) k.box(0.06, 0.1, 0.16, bodyK, hl - 1.05, 0.9, sz * (W / 2 + 0.06), 0.02);
  }
  // bumpers, lights, plate, grille
  for (const sx of [-1, 1]) k.box(0.12, 0.16, W + 0.04, 'y#202020', sx * (hl + 0.03), 0.36, 0, 0.04);
  for (const sz of [-1, 1]) {
    k.box(0.04, 0.1, 0.32, burnt ? 'l#151515' : 'l#d8d4c0', hl + 0.005, 0.62, sz * 0.62, 0.01);
    k.box(0.04, 0.1, 0.28, burnt ? 'l#151515' : 'l#7a1410', -hl - 0.005, 0.62, sz * 0.64, 0.01);
  }
  k.box(0.03, 0.14, 0.7, 'l#121212', hl + 0.01, 0.56, 0, 0.01);
  k.box(0.02, 0.11, 0.42, 'l#c8c4b2', -hl - 0.05, 0.4, 0, 0.003);
  k.box(L - 1.2, 0.12, W - 0.1, 'm#161616', 0, 0.2, 0, 0.02);
  k.box(0.6, 0.08, 0.08, 's#555555', -hl + 0.2, 0.2, 0.45, 0.02);
  // wheels
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx > 0 ? hl - 0.82 : -hl + 0.78, fl = flat(), y = fl ? 0.24 : 0.31;
    if (burnt) { k.cyl(0.22, 0.2, 'u#3a2a22', x, 0.24, sz * (W / 2 - 0.1), 12, 'z'); continue; }
    const tyre = new THREE.TorusGeometry(0.24, 0.085, 5, 14);
    k.push().at(x, y, sz * (W / 2 - 0.08)); if (fl) k.scale(1, 0.82, 1); k.add(tyre, 'y#151515');
    k.cyl(0.17, 0.1, 's#6a6e70', 0, 0, 0, 12, 'z'); k.cyl(0.07, 0.12, 's#4a4e50', 0, 0, 0, 8, 'z'); k.pop();
  }
  k.pop();
  // wear plates / rust bloom on the roof and sills
  if (wreck > 0) {
    for (let i = 0; i < 3 + wreck * 4; i++) {
      const x = r.range(-1.2, 1.2), z = r.range(-hl + 0.4, hl - 0.4), w = r.range(0.15, 0.45), d = r.range(0.15, 0.4), roof = r() < 0.5, u = z / (hl - 0.4);
      // the body was built turned a quarter: its length runs along -z here (outer z = -inner x)
      if (roof) k.box(w, 0.006, d, 'u#5a3220', x * 0.47, 1.388, 0.35 + u * (0.7 - d / 2), 0.002);
      else {
        const xi = hl - 0.9 + (u + 1) / 2 * 0.55, y = 0.87 - 0.1 * (xi - (hl - 0.95)) / 0.8 + 0.004;
        k.push().at(x * 0.5, y, -xi, 0, -Math.atan(0.125)); k.box(w, 0.006, d * 0.6, 'u#5a3220', 0, 0, 0, 0.002); k.pop();
      }
    }
  }
}

export function bus(k, o = {}) {
  const r = rng(o.seed || 'bus');
  const L = 11.4, W = 2.5, H = 3.05, body = 'm#' + (o.color || 'b8b29a'), stripe = 'm#' + (o.stripe || '2f5a7a');
  k.box(W, H - 0.45, L, body, 0, 0.45 + (H - 0.45) / 2, 0, 0.12);
  k.box(W + 0.01, 0.22, L - 0.2, stripe, 0, 0.9, 0, 0.02);
  // window band with pillars
  for (const sx of [-1, 1]) {
    k.box(0.02, 1.0, L - 1.6, 'glass', sx * (W / 2 + 0.003), 2.05, -0.3, 0.004);
    for (let i = 0; i <= 8; i++) k.box(0.03, 1.02, 0.1, body, sx * (W / 2 + 0.012), 2.05, -L / 2 + 0.5 + i * (L - 1.6) / 8, 0.005);
    if (sx > 0) { k.box(0.03, 2.2, 1.1, 'glass', sx * (W / 2 + 0.01), 1.6, L / 2 - 1.3, 0.004); k.box(0.035, 2.2, 0.05, 'l#151515', sx * (W / 2 + 0.02), 1.6, L / 2 - 1.3, 0.003); k.box(0.03, 2.2, 1.1, 'glass', sx * (W / 2 + 0.01), 1.6, -0.6, 0.004); }
    for (const z of [L / 2 - 2.3, -L / 2 + 2.4]) k.box(0.06, 0.12, 1.3, 'y#1a1a1a', sx * (W / 2 + 0.01), 1.02, z, 0.03);
  }
  k.box(W - 0.2, 1.4, 0.03, o.broken ? 'l#0c0c0c' : 'glass', 0, 2.0, L / 2 + 0.01, 0.005);
  k.box(W - 0.3, 0.26, 0.04, 'l#121212', 0, 2.88, L / 2 + 0.01, 0.005);
  k.box(W - 0.2, 1.0, 0.03, 'glass', 0, 2.15, -L / 2 - 0.01, 0.005);
  for (const s of [-1, 1]) for (const zz of [L / 2 + 0.03, -L / 2 - 0.03]) k.box(0.3, 0.14, 0.03, zz > 0 ? 'l#d0ccb8' : 'l#6a1410', s * 0.95, 0.75, zz, 0.01);
  k.box(W + 0.04, 0.3, 0.14, 'y#1e1e1e', 0, 0.5, L / 2 + 0.04, 0.05); k.box(W + 0.04, 0.3, 0.14, 'y#1e1e1e', 0, 0.5, -L / 2 - 0.04, 0.05);
  k.box(1.3, 0.3, 2.2, 'm#8a8a84', 0, H + 0.15, -1.0, 0.06);
  for (let i = 0; i < 4; i++) k.box(1.1, 0.02, 0.06, 'm#5a5a56', 0, H + 0.31, -1.8 + i * 0.5, 0.005);
  k.box(W - 0.3, 0.3, L - 4.6, 'm#151515', 0, 0.3, 0, 0.02);
  for (const z of [L / 2 - 2.3, -L / 2 + 2.4]) for (const sx of [-1, 1]) {
    const fl = o.wreck && r() < 0.5;
    k.push().at(sx * (W / 2 - 0.25), fl ? 0.4 : 0.5, z); if (fl) k.scale(1, 0.8, 1);
    k.add(new THREE.TorusGeometry(0.36, 0.14, 5, 14).rotateY(Math.PI / 2), 'y#141414');
    k.cyl(0.26, 0.24, 's#5a5e60', 0, 0, 0, 14, 'x'); k.pop();
  }
  for (let i = 0; i < 6; i++) k.box(0.01, r.range(0.3, 0.9), r.range(0.2, 0.6), 'u#4e2c1c', (r() < 0.5 ? -1 : 1) * (W / 2 + 0.006), r.range(0.6, 1.4), r.range(-5, 5), 0.002);
}

export function tyreStack(k, n, r, key) {
  for (let i = 0; i < n; i++) {
    const t = new THREE.TorusGeometry(0.28, 0.105, 5, 14); t.rotateX(Math.PI / 2);
    k.push().at(r ? r.range(-0.04, 0.04) : 0, 0.105 + i * 0.205, r ? r.range(-0.04, 0.04) : 0, 0, r ? r.range(-0.08, 0.08) : 0);
    k.add(t, key || 'y#161616'); k.pop();
  }
}

export function trolley(k, o = {}) {
  const m = 's#9aa0a4';
  k.push(); if (o.tipped) k.at(0, 0.32, 0, 0, 0, Math.PI / 2 - 0.12);
  const fz0 = -0.45, fz1 = 0.45, w0 = 0.26, w1 = 0.3;
  for (const sx of [-1, 1]) {
    k.tube(V(sx * w0, 0.15, fz0), V(sx * w1, 0.15, fz1), 0.012, m, 5);
    k.tube(V(sx * w0, 0.15, fz0), V(sx * w0, 0.95, fz0 - 0.05), 0.012, m, 5);
    for (const [y0, y1] of [[0.45, 0.45], [0.95, 0.98]]) k.tube(V(sx * w0, y0, fz0 - (y0 > 0.5 ? 0.05 : 0)), V(sx * w1, y1, fz1), 0.01, m, 4);
    k.tube(V(sx * w1, 0.45, fz1), V(sx * w1, 0.98, fz1), 0.01, m, 4);
    for (let i = 1; i < 6; i++) { const z = fz0 + (i / 6) * (fz1 - fz0); k.tube(V(sx * (w0 + (w1 - w0) * i / 6), 0.45, z), V(sx * (w0 + (w1 - w0) * i / 6), 0.97, z), 0.006, m, 3); }
    for (const z of [fz0 + 0.05, fz1 - 0.05]) { k.cyl(0.05, 0.03, 'y#1a1a1a', sx * 0.24, 0.05, z, 10, 'x'); k.tube(V(sx * 0.24, 0.05, z), V(sx * 0.25, 0.15, z), 0.01, m, 4); }
  }
  for (let i = 0; i < 6; i++) { const z = fz0 + (i / 5) * (fz1 - fz0); const w = w0 + (w1 - w0) * i / 5; k.tube(V(-w, 0.45, z), V(w, 0.45, z), 0.006, m, 3); k.tube(V(-w, 0.15, z), V(w, 0.15, z), 0.008, m, 3); }
  k.tube(V(-w0 - 0.02, 1.05, fz0 - 0.12), V(w0 + 0.02, 1.05, fz0 - 0.12), 0.016, 'y#a02a20', 6);
  for (const sx of [-1, 1]) k.tube(V(sx * w0, 0.95, fz0 - 0.05), V(sx * w0, 1.05, fz0 - 0.12), 0.01, m, 4);
  for (let i = 0; i < 6; i++) k.tube(V(-w1, 0.45 + i * 0.1, fz1), V(w1, 0.45 + i * 0.1, fz1), 0.006, m, 3);
  k.pop();
}

export function wheelieBin(k, o = {}) {
  const c = 'y#' + (o.color || '2d4a33');
  k.push().at(0, 0.05, 0, 0, 0, 0);
  const g = chamferBox(0.58, 0.95, 0.72, 0.04); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const t = (p.getY(i) + 0.475) / 0.95; p.setX(i, p.getX(i) * (0.88 + 0.12 * t)); p.setZ(i, p.getZ(i) * (0.88 + 0.12 * t)); }
  k.add(g, c, new THREE.Matrix4().makeTranslation(0, 0.525, 0));
  k.box(0.64, 0.05, 0.8, c, 0, 1.03, 0.02, 0.02);
  k.box(0.6, 0.06, 0.06, c, 0, 0.98, -0.4, 0.02);
  k.box(0.5, 0.05, 0.08, 'y#151515', 0, 0.95, -0.46, 0.02);
  for (const sx of [-1, 1]) k.cyl(0.1, 0.05, 'y#121212', sx * 0.27, 0.06, -0.3, 12, 'x');
  k.cyl(0.02, 0.62, 's#555555', 0, 0.06, -0.3, 6, 'x');
  k.pop();
}

export function rubblePile(k, r, size, keys) {
  const n = Math.round(10 * size * size + 6);
  const ks = keys || ['c#8a8780', 'c#6f6c66', 'b#7a5040', 'c#9a968e', 'b#6a4434'];
  // a low mound of broken concrete and dust: every chunk rests on it or on the ground (no chunk hangs in the air)
  const R = size * 1.05, Hm = size * 0.34, hm = (d) => (d >= R ? 0 : Hm * (1 - (d / R) * (d / R)));
  k.add(lathe([[0, 0], [R, 0], [R * 0.9, Hm * 0.19], [R * 0.75, Hm * 0.44], [R * 0.55, Hm * 0.7], [R * 0.3, Hm * 0.91], [0, Hm]], 9), ks[1]);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * size;
    const sz = (0.12 + r() * 0.42) * (1 - d / size * 0.5);
    const y = hm(d) * (0.7 + 0.3 * r()) + sz * 0.12;
    k.push().at(Math.cos(a) * d, y, Math.sin(a) * d, r() * 6, r() * 0.8 - 0.4, r() * 0.8 - 0.4);
    k.box(sz * (0.8 + r()), sz * (0.4 + r() * 0.5), sz * (0.7 + r() * 0.6), ks[Math.floor(r() * ks.length)], 0, 0, 0, sz > 0.3 ? sz * 0.12 : 0);
    k.pop();
  }
  for (let i = 0; i < Math.round(size * 3); i++) {
    const a = r() * 6.28, d = r() * size * 0.7;
    const p0 = V(Math.cos(a) * d, hm(d) * (0.4 + 0.5 * r()), Math.sin(a) * d);
    const p1 = p0.clone().add(V(r() - 0.5, 0.2 + r() * 0.6, r() - 0.5));
    k.tube(p0, p1, 0.008, 'u#4a2a1a', 4);
  }
}

export function sandbagWall(k, n, rows, r) {
  for (let j = 0; j < rows; j++) for (let i = 0; i < n - (j % 2); i++) {
    const x = (i - (n - 1) / 2 + (j % 2) * 0.5) * 0.56 + r.range(-0.03, 0.03);
    k.push().at(x, 0.075 + j * 0.15, r.range(-0.03, 0.03), r.range(-0.1, 0.1), 0, r.range(-0.05, 0.05));
    k.box(0.58, 0.17, 0.36, j % 3 === 2 ? 'f#7a7050' : 'f#8a7d5c', 0, 0, 0, 0.075);
    k.pop();
  }
}

export function palletLoad(k, r, o = {}) {
  for (let i = 0; i < 5; i++) k.box(1.2, 0.022, 0.12, 'w#9a8058', 0, 0.133, -0.4 + i * 0.2, 0.004);
  for (const z of [-0.45, 0, 0.45]) for (const x of [-0.5, 0, 0.5]) k.box(0.14, 0.1, 0.12, 'w#8a7050', x, 0.07, z, 0);
  for (const z of [-0.45, 0, 0.45]) k.box(1.2, 0.022, 0.12, 'w#8a7050', 0, 0.011, z, 0.004);
  const h = o.h || r.range(0.6, 1.2);
  if (o.sacks) {
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) k.box(0.55, 0.16, 0.42, 'f#b8ad8c', ((i % 2) - 0.5) * 0.58, 0.23 + j * 0.16, (Math.floor(i / 2) - 0.5) * 0.46, 0.06);
    return;
  }
  // shrink-wrapped stack of cartons: cartons slightly proud, film over them with rounded corners and straps
  const nx = 3, nz = 2, ny = Math.max(2, Math.round(h / 0.32));
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) for (let q = 0; q < nz; q++) {
    if (j === ny - 1 && r() < 0.35) continue;
    k.box(0.38, 0.3, 0.47, 'l#9a7a52', (i - 1) * 0.39 + r.range(-0.01, 0.01), 0.3 + j * 0.31, (q - 0.5) * 0.48, 0);
  }
  k.box(1.2, Math.min(ny, 2) * 0.31 + 0.04, 0.99, 'y#c8ccd0', 0, 0.15 + Math.min(ny, 2) * 0.155, 0, 0.06);
  for (const x of [-0.3, 0.3]) k.box(0.03, ny * 0.31 + 0.02, 1.0, 'y#2a3a6a', x, 0.15 + ny * 0.155, 0, 0.004);
}

export function gasBottles(k, n, r) {
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 0.27, c = r.pick(['m#5a6a4a', 'm#3a4a6a', 'm#8a2a1e', 'm#4a4a48']);
    k.add(lathe([[0, 0], [0.11, 0], [0.12, 0.03], [0.12, 1.0], [0.1, 1.12], [0.05, 1.18], [0, 1.18]], 14), c, new THREE.Matrix4().makeTranslation(x, 0, 0));
    k.cyl(0.03, 0.1, 's#8a8a80', x, 1.22, 0, 8); k.box(0.08, 0.03, 0.03, 's#6a6a60', x, 1.27, 0, 0.005);
  }
  k.box(n * 0.27 + 0.06, 0.04, 0.04, 'u#5a3a2a', 0, 0.9, 0.13, 0.01);
}

export function crate(k, r, w = 1.0, h = 0.8, d = 0.8) {
  k.box(w - 0.04, h - 0.04, d - 0.04, 'w#7a6040', 0, h / 2, 0, 0.01);
  for (const y of [0.05, h - 0.05]) for (const sz of [-1, 1]) k.box(w, 0.09, 0.025, 'w#6a5034', 0, y, sz * (d / 2), 0.006);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.09, h, 0.025, 'w#6a5034', sx * (w / 2 - 0.045), h / 2, sz * d / 2, 0.006);
  for (const sz of [-1, 1]) { k.push().at(0, h / 2, sz * d / 2, 0, 0, Math.atan2(h - 0.18, w - 0.18)); k.box(Math.hypot(w - 0.18, h - 0.18), 0.08, 0.02, 'w#6a5034', 0, 0, 0, 0.005); k.pop(); }
}

export function acUnit(k, o = {}) {
  const c = 'm#' + (o.color || 'a8aaa4');
  k.box(0.85, 0.6, 0.32, c, 0, 0, 0, 0.025);
  k.cyl(0.22, 0.02, 'l#1a1a1a', -0.15, 0, 0.165, 18, 'z');
  for (let i = -4; i <= 4; i++) k.box(0.46, 0.012, 0.012, 's#6a6e70', -0.15, i * 0.05, 0.18, 0);
  for (let i = 0; i < 5; i++) k.box(0.2, 0.012, 0.01, 'm#7a7c78', 0.28, -0.2 + i * 0.1, 0.165, 0);
  for (const sx of [-1, 1]) { k.box(0.04, 0.04, 0.4, 's#6a6e70', sx * 0.3, -0.32, -0.04, 0.005); k.box(0.04, 0.3, 0.04, 's#6a6e70', sx * 0.3, -0.2, -0.22, 0.005); }
  k.tube(V(0.36, -0.15, -0.1), V(0.42, -0.6, -0.12), 0.012, 'l#d8d4c8', 5);
  k.tube(V(0.32, -0.18, -0.1), V(0.37, -0.65, -0.12), 0.01, 'l#1a1a1a', 5);
}

export function waterTank(k, o = {}) {
  const R = o.r || 0.9, H = o.h || 1.6;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.08, 0.8, 0.08, 'u#5a3a2a', sx * R * 0.6, 0.4, sz * R * 0.6, 0.01);
  k.box(R * 1.5, 0.06, R * 1.5, 'u#5a3a2a', 0, 0.82, 0, 0.01);
  k.add(lathe([[0, 0], [R, 0], [R, H], [R * 0.3, H + 0.25], [0, H + 0.27]], 16), o.key || 'y#2a2c2e', new THREE.Matrix4().makeTranslation(0, 0.85, 0));
  for (let i = 1; i < 4; i++) k.add(new THREE.TorusGeometry(R + 0.01, 0.015, 3, 14).rotateX(Math.PI / 2), o.key || 'y#2a2c2e', new THREE.Matrix4().makeTranslation(0, 0.85 + i * H / 4, 0));
  k.tube(V(R * 0.7, 0.9, 0), V(R * 0.7, -0.1, 0.2), 0.03, 's#6a6e70', 6);
}

export function antenna(k, o = {}) {
  const H = o.h || 3.5, m = 's#8a8e90';
  k.box(0.3, 0.05, 0.3, m, 0, 0.025, 0, 0.01);
  k.cyl(0.025, H, m, 0, H / 2, 0, 6);
  for (let i = 0; i < 4; i++) { const y = H * (0.6 + i * 0.12), l = 1.2 - i * 0.22; k.tube(V(-l / 2, y, 0), V(l / 2, y, 0), 0.008, m, 3); for (let j = 0; j < 5; j++) k.tube(V(-l / 2 + j * l / 4, y, -0.12), V(-l / 2 + j * l / 4, y, 0.12), 0.005, m, 3); }
  for (const a of [0, 2.1, 4.2]) k.tube(V(0, H * 0.55, 0), V(Math.cos(a) * 1.0, 0, Math.sin(a) * 1.0), 0.004, 's#5a5e60', 3);
  if (o.dish) { k.push().at(0.2, H * 0.35, 0.2, 0.6, -0.5); k.add(lathe([[0, -0.08], [0.25, 0], [0.32, 0.06]], 16).rotateX(Math.PI / 2), 'm#c0bfb8'); k.tube(V(0, 0, 0), V(0, 0, 0.3), 0.01, m, 4); k.pop(); }
}

export function billboard(k, o = {}) {
  const W = o.w || 6, H = o.h || 3, post = o.post || 4, m = 'u#5a4030';
  for (const x of [-W * 0.3, W * 0.3]) { k.box(0.3, post + H * 0.6, 0.3, 'm#3a3e40', x, (post + H * 0.6) / 2, -0.2, 0.02); for (let i = 0; i < 4; i++) k.tube(V(x - 0.15, post * i / 4, -0.05), V(x + 0.15, post * (i + 1) / 4, -0.35), 0.02, m, 4); }
  k.box(W + 0.2, H + 0.2, 0.15, 'm#2a2e30', 0, post + H / 2, 0, 0.03);
  const r = rng(o.seed || 'bb');
  const pal = ['l#c8b070', 'l#8a3a2a', 'l#3a6a8a', 'l#d0ccc0', 'l#2a4a3a', 'l#b85a2a'];
  // torn paper panels in a few colours (no text)
  for (let i = 0; i < 8; i++) {
    const ph = H / 2, pw = W / 4;
    if (r() < 0.12) continue;
    k.box(pw - 0.02, ph - 0.02, 0.01, pal[Math.floor(r() * pal.length)], -W / 2 + pw / 2 + (i % 4) * pw, post + ph / 2 + Math.floor(i / 4) * ph, 0.08, 0.002);
  }
  k.box(W * 0.5, H * 0.18, 0.012, 'l#e8e2d0', -W * 0.1, post + H * 0.7, 0.09, 0.002);
  k.box(W + 0.2, 0.05, 0.7, 'm#2a2e30', 0, post - 0.1, 0.3, 0.01);
  k.tube(V(-W / 2, post + 0.9, 0.62), V(W / 2, post + 0.9, 0.62), 0.015, 'm#2a2e30', 4);
  for (const x of [-W / 2, 0, W / 2]) k.tube(V(x, post - 0.08, 0.62), V(x, post + 0.92, 0.62), 0.015, 'm#2a2e30', 4);
  for (const x of [-W / 3, 0, W / 3]) { k.tube(V(x, post + H + 0.1, 0.05), V(x, post + H + 0.5, 0.6), 0.02, 'm#2a2e30', 4); k.box(0.3, 0.1, 0.18, 'm#2a2e30', x, post + H + 0.5, 0.65, 0.02); k.box(0.24, 0.02, 0.12, 'lamp', x, post + H + 0.44, 0.65, 0.005); }
}

export function fireEscape(k, floors, w, o = {}) {
  const m = 'm#2a2c2c', y0 = o.y0 || 3.0, fh = o.fh || 2.8, D = 1.1;
  for (let f = 0; f < floors; f++) {
    const y = y0 + f * fh;
    k.box(w, 0.05, D, 's#3a3c3c', 0, y, D / 2, 0.005);
    for (let i = 0; i < Math.floor(w / 0.12); i++) k.box(0.02, 0.06, D, m, -w / 2 + 0.06 + i * 0.12, y + 0.005, D / 2, 0);
    k.tube(V(-w / 2, y + 1.0, D), V(w / 2, y + 1.0, D), 0.022, m, 5);
    k.tube(V(-w / 2, y + 0.5, D), V(w / 2, y + 0.5, D), 0.015, m, 4);
    for (const x of [-w / 2, w / 2]) { k.tube(V(x, y, D), V(x, y + 1.0, D), 0.02, m, 4); k.tube(V(x, y + 1.0, D), V(x, y + 1.0, 0), 0.02, m, 4); k.tube(V(x, y, 0), V(x, y - 0.6, 0), 0.03, m, 4); k.tube(V(x, y - 0.6, 0), V(x, y, D), 0.02, m, 4); }
    for (let i = 1; i < Math.floor(w / 0.4); i++) k.tube(V(-w / 2 + i * 0.4, y, D), V(-w / 2 + i * 0.4, y + 1.0, D), 0.008, m, 3);
    // stair to the floor above (or drop ladder from the lowest)
    if (f < floors - 1) {
      const sx = (f % 2 ? -1 : 1) * (w / 2 - 0.4);
      const a = V(sx - 0.9 * (f % 2 ? -1 : 1), y, D * 0.5), b = V(sx + 0.9 * (f % 2 ? -1 : 1), y + fh, D * 0.5);
      for (const dz of [-0.32, 0.32]) k.tube(a.clone().add(V(0, 0, dz)), b.clone().add(V(0, 0, dz)), 0.025, m, 4);
      for (let s = 1; s < 12; s++) { const p = a.clone().lerp(b, s / 12); k.box(0.16, 0.02, 0.62, 's#3a3c3c', p.x, p.y, p.z, 0); }
      k.tube(a.clone().add(V(0, 0.9, 0.36)), b.clone().add(V(0, 0.9, 0.36)), 0.015, m, 4);
    } else if (f === 0 || floors === 1) { /* nothing */ }
  }
  // drop ladder from the lowest landing, stowed up
  for (const dx of [-0.2, 0.2]) k.tube(V(w / 2 - 0.5 + dx, y0 + 0.05, D - 0.1), V(w / 2 - 0.5 + dx, y0 - 1.4, D - 0.1), 0.015, m, 4);
  for (let i = 0; i < 5; i++) k.tube(V(w / 2 - 0.7, y0 - 1.3 + i * 0.3, D - 0.1), V(w / 2 - 0.3, y0 - 1.3 + i * 0.3, D - 0.1), 0.01, m, 3);
}

export function awning(k, w, d, o = {}) {
  const r = rng(o.seed || 'aw'), fr = 'm#3a3c3e';
  const c1 = 'f#' + (o.c1 || '7a2a22'), c2 = 'f#' + (o.c2 || 'b8b098');
  k.tube(V(-w / 2, 0, 0), V(w / 2, 0, 0), 0.03, fr, 6);
  k.tube(V(-w / 2, -0.55, d), V(w / 2, -0.55, d), 0.025, fr, 6);
  for (const x of [-w / 2, 0, w / 2]) k.tube(V(x, 0, 0), V(x, -0.55, d), 0.02, fr, 5);
  const n = Math.round(w / 0.5), torn = o.torn || 0;
  for (let i = 0; i < n; i++) {
    if (r() < torn) continue;
    const x = -w / 2 + (i + 0.5) * w / n, len = Math.hypot(d, 0.55) * (r() < torn ? r.range(0.4, 0.8) : 1);
    k.push().at(x, -0.02, 0, 0, Math.atan2(0.55, d) + 0, 0);
    k.box(w / n + 0.005, 0.012, len, i % 2 ? c1 : c2, 0, -0.03, len / 2, 0.003);
    k.pop();
    if (len > d) k.box(w / n, 0.18, 0.012, i % 2 ? c1 : c2, x, -0.62, d + 0.01, 0.002);
  }
}

export function rollerShutter(k, w, h, open, o = {}) {
  const c = 'r#' + (o.color || '7a7e80');
  k.box(w + 0.2, 0.32, 0.32, 'm#' + (o.box || '5a5e60'), 0, h + 0.16, 0.12, 0.03);
  for (const sx of [-1, 1]) k.box(0.06, h, 0.08, 's#5a5e60', sx * (w / 2 + 0.02), h / 2, 0.02, 0.01);
  const hh = h * (1 - open);
  if (hh > 0.05) {
    k.box(w, hh, 0.03, c, 0, h - hh / 2, 0.0, 0.004);
    for (let i = 0; i < hh / 0.09; i++) k.box(w, 0.012, 0.012, 'l#3a3c3c', 0, h - i * 0.09, 0.018, 0);
    k.box(w, 0.06, 0.05, 's#4a4e50', 0, h - hh, 0.0, 0.01);
  }
}

// window opening on a facade (front = +z). kind: glass | lit | boarded | broken | curtain
export function windowUnit(k, w, h, kind, r, o = {}) {
  const fr = o.frame || 'm#5a5a56', sill = o.sill || 'c#9a968c';
  k.box(w + 0.14, 0.07, 0.16, sill, 0, -h / 2 - 0.035, 0.05, 0);
  k.box(w + 0.18, 0.12, 0.08, o.lintel || sill, 0, h / 2 + 0.06, 0.02, 0);
  for (const sx of [-1, 1]) k.box(0.05, h, 0.06, fr, sx * (w / 2 - 0.025), 0, 0.0, 0);
  k.box(w, 0.05, 0.06, fr, 0, h / 2 - 0.025, 0, 0); k.box(w, 0.05, 0.06, fr, 0, -h / 2 + 0.025, 0, 0);
  if (kind !== 'broken') { k.box(0.04, h - 0.05, 0.05, fr, 0, 0, 0.0, 0); k.box(w - 0.05, 0.035, 0.05, fr, 0, h * 0.18, 0.0, 0); }
  const pane = kind === 'lit' ? 'win' : kind === 'broken' ? 'l#07080a' : 'glass';
  k.box(w - 0.06, h - 0.06, 0.01, pane, 0, 0, -0.02, 0);
  if (kind === 'curtain') k.box(w * 0.45, h - 0.1, 0.01, 'f#' + r.pick(['6a5a3a', '4a5a6a', '7a4a3a', '8a8270']), -w * 0.22, 0, -0.04, 0);
  if (kind === 'broken') {
    for (let i = 0; i < 4; i++) {
      const sh = new THREE.Shape(); const a = r.range(0.1, 0.35), b = r.range(0.1, 0.4);
      sh.moveTo(0, 0); sh.lineTo(a, 0); sh.lineTo(0, b); sh.lineTo(0, 0);
      const cx = (i % 2 ? 1 : -1) * (w / 2 - 0.05), cy = (i < 2 ? 1 : -1) * (h / 2 - 0.05);
      k.push().at(cx, cy, -0.015, 0, 0, Math.atan2(-cy, -cx) - Math.PI / 4); k.add(new THREE.ShapeGeometry(sh), 'glass'); k.pop();
    }
  }
  if (kind === 'boarded') {
    const n = 3 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      k.push().at(r.range(-0.05, 0.05), -h / 2 + (i + 0.5) * h / n, 0.05, 0, 0, r.range(-0.18, 0.18));
      k.box(w + r.range(0.05, 0.3), 0.18, 0.025, r.pick(['w#6a5236', 'w#7a6040', 'w#5a4630']), 0, 0, 0, 0.006);
      
      k.pop();
    }
  }
}

export function downpipe(k, h, o = {}) {
  const c = o.key || 'm#4a4f52';
  k.cyl(0.05, h, c, 0, h / 2, 0, 8);
  for (let y = 0.6; y < h; y += 1.2) k.box(0.13, 0.04, 0.1, c, 0, y, -0.03, 0.005);
  k.tube(V(0, 0.15, 0), V(0, 0.02, 0.22), 0.05, c, 8);
  k.box(0.14, 0.18, 0.14, c, 0, h - 0.05, 0, 0.02);
}

export function wallLamp(k) {
  k.box(0.14, 0.2, 0.04, 'm#2a2c2e', 0, 0, 0.02, 0.01);
  k.tube(V(0, 0.05, 0.04), V(0, 0.12, 0.3), 0.015, 'm#2a2c2e', 5);
  k.add(new THREE.ConeGeometry(0.16, 0.12, 14, 1, true).translate(0, 0.04, 0), 'm#3a4a3c', new THREE.Matrix4().makeTranslation(0, 0.08, 0.32));
  k.cyl(0.05, 0.06, 'lamp', 0, 0.06, 0.32, 10);
}

export function skipRusty(k, r) {
  const s = new THREE.Shape(); s.moveTo(-1.0, 0); s.lineTo(1.0, 0); s.lineTo(1.6, 1.2); s.lineTo(-1.6, 1.2); s.lineTo(-1.0, 0);
  const hole = new THREE.Path(); hole.moveTo(-0.95, 0.08); hole.lineTo(0.95, 0.08); hole.lineTo(1.5, 1.2); hole.lineTo(-1.5, 1.2); hole.lineTo(-0.95, 0.08);
  s.holes.push(hole);
  k.add(extrude(s, 1.7, 0.02, 1), 'u#6a3a24');
  k.box(2.0, 0.08, 1.7, 'u#5a3020', 0, 0.04, 0, 0.01);
  for (const sz of [-1, 1]) { const end = new THREE.Shape(); end.moveTo(-1.0, 0); end.lineTo(1.0, 0); end.lineTo(1.6, 1.2); end.lineTo(-1.6, 1.2); k.add(extrude(end, 0.05, 0.01, 1), 'u#6a3a24', new THREE.Matrix4().makeTranslation(0, 0, sz * 0.85)); }
  for (const sx of [-1, 1]) { k.box(0.12, 0.1, 1.9, 'u#4a2a1a', sx * 1.55, 1.15, 0, 0.02); k.add(new THREE.TorusGeometry(0.12, 0.025, 4, 10), 's#4a3a2a', new THREE.Matrix4().makeTranslation(sx * 1.25, 0.9, 0.9)); }
  for (let i = 0; i < 10; i++) {
    const x = r.range(-1, 1); r.range(0.3, 1.05); const z = r.range(-0.6, 0.6), ry = r() * 6, rx = (r() - 0.5) * 0.5, rz = (r() - 0.5) * 0.5;
    const w = r.range(0.2, 0.7), h = r.range(0.05, 0.2), d = r.range(0.1, 0.4), key = r.pick(['w#6a5236', 'c#8a8680', 'l#2a2c2e']);
    k.push().at(x, 0.08 + h * 0.4, z, ry, rx, rz); k.box(w, h, d, key, 0, 0, 0, 0.01); k.pop(); // on the floor (tilted ends dip into it)
  }
}

export function generator(k) {
  k.box(2.2, 0.12, 1.0, 'u#4a3a2a', 0, 0.06, 0, 0.01);
  k.box(1.9, 1.1, 0.9, 'm#5a6a3e', 0, 0.68, 0, 0.04);
  for (let i = 0; i < 9; i++) for (const sz of [-1, 1]) k.box(0.05, 0.6, 0.02, 'm#3a4a2a', -0.75 + i * 0.09, 0.7, sz * 0.455, 0.004);
  k.box(0.5, 0.4, 0.03, 'l#1a1c1c', 0.55, 0.85, 0.455, 0.004);
  k.box(0.12, 0.05, 0.03, 'lamp', 0.42, 0.98, 0.47, 0.004);
  k.cyl(0.05, 0.6, 'u#3a2a20', -0.7, 1.4, -0.25, 8);
  k.cyl(0.07, 0.1, 'u#2a2020', -0.7, 1.72, -0.25, 8);
  k.box(1.9, 0.04, 0.95, 'm#4a5a32', 0, 1.25, 0, 0.01);
  for (const sx of [-1, 1]) k.add(new THREE.TorusGeometry(0.08, 0.015, 4, 10), 's#5a5a50', new THREE.Matrix4().makeTranslation(sx * 0.8, 1.3, 0));
  const pts = [V(0.95, 0.5, 0.2), V(1.3, 0.05, 0.4), V(2.2, 0.03, 0.9), V(3.2, 0.03, 0.6)];
  for (let i = 1; i < pts.length; i++) k.tube(pts[i - 1], pts[i], 0.025, 'y#141414', 5);
}

export function manhole(k, r) {
  k.add(new THREE.CircleGeometry(0.36, 20).rotateX(-Math.PI / 2).translate(0, 0.008, 0), 'd#34363a');
  for (let i = -3; i <= 3; i++) k.box(0.56 * Math.sqrt(1 - (i / 3.6) ** 2), 0.006, 0.025, 'd#222426', 0, 0.01, i * 0.08, 0);
  k.add(new THREE.RingGeometry(0.36, 0.42, 20).rotateX(-Math.PI / 2).translate(0, 0.006, 0), 'd#5a5850');
}
export function drainGrate(k) {
  k.add(new THREE.PlaneGeometry(0.5, 0.32).rotateX(-Math.PI / 2).translate(0, 0.008, 0), 'd#2a2a28');
  for (let i = 0; i < 7; i++) k.add(new THREE.PlaneGeometry(0.025, 0.28).rotateX(-Math.PI / 2).translate(-0.2 + i * 0.066, 0.01, 0), 'd#060606');
}

export function pylon(k, H, key) {
  const m = key || 'l#4a4e52', base = H * 0.07, top = H * 0.02;
  const lv = 7;
  for (let i = 0; i < lv; i++) {
    const t0 = i / lv, t1 = (i + 1) / lv, w0 = base + (top - base) * t0, w1 = base + (top - base) * t1, y0 = H * 0.85 * t0, y1 = H * 0.85 * t1;
    for (let s = 0; s < 4; s++) {
      const c = [[1, 1], [1, -1], [-1, -1], [-1, 1]], a = c[s], b = c[(s + 1) % 4];
      k.tube(V(a[0] * w0, y0, a[1] * w0), V(a[0] * w1, y1, a[1] * w1), H * 0.004, m, 4);
      k.tube(V(a[0] * w0, y0, a[1] * w0), V(b[0] * w1, y1, b[1] * w1), H * 0.0015, m, 3);
    }
  }
  const wAt = (y) => base + (top - base) * Math.min(1, y / (H * 0.85));
  for (const [y, l] of [[H * 0.62, H * 0.22], [H * 0.78, H * 0.17], [H * 0.9, H * 0.12]]) {
    const w = wAt(y), y2 = y + H * 0.06, w2 = wAt(y2);
    for (const zs of [-1, 1]) {
      k.tube(V(-l, y, zs * w), V(l, y, zs * w), H * 0.004, m, 4);
      for (const s of [-1, 1]) k.tube(V(s * l, y, zs * w), V(s * w2, y2, zs * w2), H * 0.002, m, 3);
    }
    for (const s of [-1, 1]) { k.tube(V(s * l, y, -w), V(s * l, y, w), H * 0.002, m, 3); k.tube(V(s * l, y, 0), V(s * l, y - H * 0.04, 0), H * 0.002, m, 3); }
  }
  for (const [a, b] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) k.tube(V(a * top, H * 0.85, b * top), V(0, H * 0.85, 0), H * 0.002, m, 3);
  k.tube(V(0, H * 0.85, 0), V(0, H, 0), H * 0.003, m, 3);
}

export function waterTower(k, key) {
  const m = key || 'l#5a5e60', H = 22, R = 5;
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; k.tube(V(Math.cos(a) * 4.2, 0, Math.sin(a) * 4.2), V(Math.cos(a) * 3.2, H, Math.sin(a) * 3.2), 0.3, m, 6); }
  for (const y of [6, 12, 18]) for (let i = 0; i < 6; i++) { const a = i / 6 * 6.283, b = (i + 1) / 6 * 6.283, rr = 4.2 - y / H; k.tube(V(Math.cos(a) * rr, y, Math.sin(a) * rr), V(Math.cos(b) * rr, y, Math.sin(b) * rr), 0.12, m, 4); }
  k.add(lathe([[0, -2.4], [2.2, -2.0], [R, -0.2], [R, 4.5], [R * 0.6, 6.0], [0.3, 6.6], [0, 6.7]], 20), m, new THREE.Matrix4().makeTranslation(0, H + 1.5, 0));
  k.cyl(0.6, H + 2, m, 0, (H + 2) / 2, 0, 8);
  k.add(new THREE.TorusGeometry(R + 0.4, 0.08, 4, 24).rotateX(Math.PI / 2), m, new THREE.Matrix4().makeTranslation(0, H + 1.6, 0));
}

export function radioMast(k, H, key) {
  const m = key || 'l#6a3a32', w = 0.9;
  const lv = Math.round(H / 3);
  for (let i = 0; i < lv; i++) {
    const y0 = i * H / lv, y1 = (i + 1) * H / lv;
    for (let s = 0; s < 3; s++) {
      const a = s / 3 * 6.283, b = (s + 1) / 3 * 6.283;
      k.tube(V(Math.cos(a) * w, y0, Math.sin(a) * w), V(Math.cos(a) * w, y1, Math.sin(a) * w), 0.07, i % 4 < 2 ? m : 'l#a8a49a', 4);
      k.tube(V(Math.cos(a) * w, y0, Math.sin(a) * w), V(Math.cos(b) * w, y1, Math.sin(b) * w), 0.03, m, 3);
    }
  }
  for (let i = 0; i < 3; i++) { const a = i / 3 * 6.283 + 0.5; for (const f of [0.35, 0.7]) k.tube(V(0, H * f, 0), V(Math.cos(a) * H * 0.45, 0, Math.sin(a) * H * 0.45), 0.02, 'l#3a3a3a', 3); }
  k.box(1.6, 0.6, 0.3, 'l#8a8a84', 0, H * 0.82, 0.9, 0.02);
}
