// Sky after the Saltline recipe (Felix Rieseberg's Saltline, render.md sky section): horizon colour toward the sun,
// a clear burning gap under a projected cloud deck with self-shadowed relief and warm rake light, sun aureole.
// twt-proc adds a time of day on top: the palette (SUN_DIR, SUN_COLOR, PALETTE) is MUTATED in place every frame from
// the rules-side light table (sim/mat.js ENV), the whole dome is scaled by uLum, night adds stars and a moon, a raid
// turns it red. The environment capture (uEnv = 1) drops the sun disc and clamps fireflies; it is re-captured when the
// light has moved enough.
import * as THREE from '../vendor/three.module.min.js';
import { U } from './mats.js';

export const SUN_DIR = new THREE.Vector3(-0.33, 0.225, -0.917).normalize();
export const SUN_COLOR = new THREE.Color(1, 0.72, 0.42);
export const PALETTE = { zen: new THREE.Color(0.055, 0.085, 0.13), hor: new THREE.Color(0.95, 0.55, 0.28), horAway: new THREE.Color(0.16, 0.22, 0.30), fog: new THREE.Color(0.42, 0.47, 0.52) };

function noiseTex() {
  const n = 256, d = new Uint8Array(n * n * 4); let x = 2654435769 >>> 0;
  for (let i = 0; i < d.length; i++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; d[i] = x & 255; }
  const t = new THREE.DataTexture(d, n, n); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = t.minFilter = THREE.NearestFilter; t.needsUpdate = true;
  return t;
}

const SKY_FRAG = /* glsl */`
uniform sampler2D tNoise; uniform float uTime, uFlash, uEnv, uLum, uNight, uRaid, uCloud, uSunK;
uniform vec3 uSunDir, uSunCol, uZen, uHor, uHorAway, uFlashDir;
varying vec3 vDir;
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  float a = texture2D(tNoise, (i+.5)/256.).r, b = texture2D(tNoise, (i+vec2(1,0)+.5)/256.).r, c = texture2D(tNoise, (i+vec2(0,1)+.5)/256.).r, d = texture2D(tNoise, (i+vec2(1,1)+.5)/256.).r;
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
float h21(vec2 p){ return texture2D(tNoise, (floor(p)+.5)/256.).g; }
const mat2 RS = mat2(1.6,1.2,-1.2,1.6);
float fbm5(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*n2(p); p=RS*p+17.3; a*=.5; } return s/.96875; }
float fbm3(vec2 p){ float s=0., a=.5; for(int i=0;i<3;i++){ s+=a*n2(p); p=RS*p+17.3; a*=.5; } return s/.875; }
vec3 horizonColor(vec3 d, float ts){
  vec3 c = mix(uHorAway, uHorAway*1.25+vec3(.05,.03,.02)*uLum, smoothstep(.2,.75,ts));
  c = mix(c, uHor*vec3(1.9,1.55,1.2), pow(ts,6.));
  c = mix(c, uSunCol*vec3(1.,.83,.57)*3.4*uSunK, pow(ts,34.));
  return c; }
void main(){
  vec3 d = normalize(vDir); float h = d.y; float mu = dot(d, uSunDir);
  float ts = clamp(dot(normalize(d.xz+1e-5), normalize(uSunDir.xz+1e-5))*.5+.5, 0., 1.);
  vec3 hc = horizonColor(d, ts);
  vec3 col;
  if (h > -0.02) {
    vec3 midC = mix(uHorAway*vec3(.94,1.09,1.2), uHor*vec3(.76,.91,1.21), pow(ts,3.));
    vec3 clearC = mix(hc, midC, smoothstep(0.,.17,h));
    clearC = mix(clearC, uZen, smoothstep(.10,.5,h));
    float s = max(mu,0.);
    clearC += uSunCol*uSunK*vec3(1.,.86,.68)*(pow(s,8.)*.14 + pow(s,64.)*.55 + pow(s,600.)*2.2 + pow(s,6000.)*14.);
    // stars (night only), twinkling, hidden by cloud below
    if (uNight > 0.01 && uEnv < 0.5) {
      vec2 sp = d.xz/(abs(h)+.35)*90.; vec2 ci = floor(sp); vec2 cf = fract(sp)-.5;
      float r = h21(ci); float tw = .7+.3*sin(uTime*(1.+r*3.)+r*40.);
      float star = smoothstep(.09,.0,length(cf - (vec2(h21(ci+7.), h21(ci+13.))-.5)*.6)) * step(.93, r);
      clearC += vec3(.8,.88,1.)*star*tw*uNight*1.6*smoothstep(.0,.25,h);
    }
    // cloud deck
    vec2 cuv = d.xz/(max(h,0.)+.10)*vec2(.62,.95) + vec2(-.012,.004)*uTime;
    vec2 warp = vec2(fbm3(cuv*.7), fbm3(cuv*.7+5.2));
    float dens = fbm5(cuv*1.1 + warp*.8);
    float big = fbm3(cuv*.35 + 3.1);
    float ridge = 1. - abs(2.*fbm3(cuv*3.1 + warp) - 1.);
    float body = dens*.74 + big*.36 + (ridge-.5)*.12 + (uCloud-1.)*.22;
    float edge = mix(.030, .285, pow(ts, 1.7));
    float cov = smoothstep(.31, .50, body) * smoothstep(edge*.0, edge, h + .02);
    cov *= 1. - .93*smoothstep(.972, .9985, mu);
    float scud = smoothstep(.55, .75, fbm3(cuv*2.3 - uTime*.01)) * .35;
    cov = clamp(cov + scud*(1.-cov)*smoothstep(.0,.06,h), 0., 1.);
    float relief = clamp((fbm5(cuv*1.1 + warp*.8 + normalize(uSunDir.xz+1e-5)*.22) - dens)*4.5 + .5, 0., 1.);
    float thick = smoothstep(.35, .9, body);
    vec3 under = mix(uHorAway*vec3(.97,.89,.85), uHorAway*vec3(.19,.19,.21), thick);
    float nearSun = pow(ts, 3.) * smoothstep(.45, .0, h);
    vec3 cloud = under + uHor*vec3(1.30,.66,.40)*nearSun*(.05 + 2.2*pow(relief,3.))*1.15;
    cloud += uHor*vec3(1.4,.8,.45) * pow(1.-cov, 2.) * nearSun * .9;
    cloud += vec3(.55,.68,1.) * uFlash * pow(max(dot(d, uFlashDir),0.), 5.) * (.6 + relief);
    col = mix(clearC, cloud, cov);
    col = mix(hc, col, 1. - exp(-max(h,0.)*11.));
    float veil = 1. - cov;
    // sun disc by day, a small cold moon disc by night
    float disc = mix(smoothstep(.999905, .999955, mu) * 110., smoothstep(.99965, .99975, mu) * 9., uNight);
    col += uSunCol * uSunK * disc * veil * (1. - uEnv);
  } else {
    col = mix(uHorAway*.42, uHorAway*vec3(.37,.29,.23), uEnv) + uHor*pow(ts,8.)*.25*exp(h*20.);
  }
  col = mix(col, vec3(dot(col, vec3(.4,.4,.2)))*vec3(1.6,.22,.2), uRaid*.55);
  col = mix(col, min(col, vec3(6.)), uEnv);
  gl_FragColor = vec4(max(col, vec3(0.)), 0.0);
}`;

export function makeSky(G) {
  const geo = new THREE.BoxGeometry(2, 2, 2);
  const uniforms = {
    tNoise: { value: noiseTex() }, uTime: U.uTime, uFlash: U.uFlash, uEnv: { value: 0 }, uLum: { value: 1 }, uNight: { value: 0 }, uRaid: { value: 0 }, uCloud: { value: 1 }, uSunK: { value: 1 },
    uSunDir: { value: SUN_DIR }, uSunCol: { value: SUN_COLOR }, uZen: { value: PALETTE.zen }, uHor: { value: PALETTE.hor }, uHorAway: { value: PALETTE.horAway },
    uFlashDir: { value: new THREE.Vector3(-0.5, 0.5, -0.7).normalize() },
  };
  const vs = 'varying vec3 vDir; void main(){ vDir = position; gl_Position = (projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0)).xyww; }';
  const m = new THREE.ShaderMaterial({ uniforms, vertexShader: vs, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false });
  const sky = new THREE.Mesh(geo, m); sky.renderOrder = -1000; sky.frustumCulled = false;
  G.scene.add(sky);
  const envU = Object.assign({}, uniforms, { uEnv: { value: 1 } });
  const envM = new THREE.ShaderMaterial({ uniforms: envU, vertexShader: vs, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false });
  const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(geo, envM));
  const pm = new THREE.PMREMGenerator(G.renderer);
  let rt = null; let sig = null; let cool = 0;
  function capture() {
    const next = pm.fromScene(envScene, 0, 0.1, 100);
    G.scene.environment = next.texture; G.scene.environmentIntensity = 2;
    if (rt) rt.dispose();
    rt = next;
  }
  // e: { sunDir:[x,y,z], sunCol:[r,g,b], sunK (1 = Saltline day), zen:[..], hor:[..], horAway:[..], fog:[..], night 0..1, raid 0..1, cloud }
  function update(e, dt) {
    SUN_DIR.set(e.sunDir[0], e.sunDir[1], e.sunDir[2]).normalize();
    SUN_COLOR.setRGB(e.sunCol[0], e.sunCol[1], e.sunCol[2]);
    PALETTE.zen.setRGB(e.zen[0], e.zen[1], e.zen[2]); PALETTE.hor.setRGB(e.hor[0], e.hor[1], e.hor[2]);
    PALETTE.horAway.setRGB(e.horAway[0], e.horAway[1], e.horAway[2]); PALETTE.fog.setRGB(e.fog[0], e.fog[1], e.fog[2]);
    uniforms.uNight.value = e.night; uniforms.uRaid.value = e.raid; uniforms.uCloud.value = e.cloud; uniforms.uSunK.value = e.sunK;
    uniforms.uLum.value = Math.min(1, (e.horAway[0] + e.horAway[1] + e.horAway[2]) / 0.68);
    cool -= dt;
    const s = [e.sunDir[0], e.sunDir[1], e.sunDir[2], e.sunK, e.zen[1], e.hor[0], e.horAway[2], e.raid, e.night];
    let moved = sig === null;
    if (sig) for (let i = 0; i < s.length; i++) if (Math.abs(s[i] - sig[i]) > (i < 3 ? 0.03 : 0.025)) { moved = true; break; }
    if (moved && cool <= 0) { sig = s; cool = 0.4; capture(); }
  }
  capture();
  return { mesh: sky, capture, update, sun: SUN_DIR, uniforms };
}
