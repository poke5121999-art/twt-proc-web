// GPU-baked PBR sets. Each surface is a GLSL function over a tileable [0,1) square.
// Outputs three textures: albedo (sRGB, alpha = paint mask), ORM (R ao, G rough, B metal), normal (from height).
import * as THREE from '../vendor/three.module.min.js';
import { NOISE } from './glsl.js';

const COMMON = /* glsl */`
${NOISE}
float sat(float x){ return clamp(x,0.,1.); }
float scratches(vec2 uv, float P, float seed){
  float s=0.;
  for(int i=0;i<3;i++){
    float a=h12(vec2(seed,float(i)))*6.283;
    vec2 d=vec2(cos(a),sin(a));
    vec2 q=vec2(dot(uv,d), dot(uv,vec2(-d.y,d.x)))*P*(1.+float(i));
    float line=abs(fract(q.y+pn(q*vec2(.05,1.),P*4.)*.3)-.5);
    float len=step(.72, pn(vec2(q.x*.08, floor(q.y)), P*8.));
    s=max(s, smoothstep(.012,0.,line)*len);
  }
  return s;
}
// per-axis periodic noise (anisotropic streaks that still tile)
float pnA(vec2 p, vec2 P){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  float a=h12(mod(i,P)), b=h12(mod(i+vec2(1,0),P)), c=h12(mod(i+vec2(0,1),P)), d=h12(mod(i+vec2(1,1),P));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y); }
float fbmA(vec2 p, vec2 P, int oct){ float s=0., a=.5, t=0.; for(int i=0;i<6;i++){ if(i>=oct) break; s+=a*pnA(p,P); t+=a; p*=2.; P*=2.; a*=.5; } return s/t; }
`;

// Each entry: GLSL body that sets alb, rough, metal, h (0..1), ao, paint (mask, 1 = takes the tint).
export const SURF = {
  flat: `
    float n = pfbm(uv*6.,6.,5); float f = pfbm(uv*40.,40.,3);
    alb = vec3(.5)*(.94+.1*n+.03*f); paint = 1.;
    rough=.62+.12*n; metal=0.; h=.5+.04*f+.05*n; ao=1.;`,
  dirt: `
    float n = pfbm(uv*5.,5.,6); vec3 v = pvor(uv*34.,34.); float peb = smoothstep(.16,.02,v.x)*step(.72,v.z);
    float gr = smoothstep(.52,.75,pfbm(uv*7.+3.,7.,5));
    vec3 soil = mix(vec3(.23,.19,.14), vec3(.34,.29,.21), n);
    vec3 grass = mix(vec3(.13,.17,.07), vec3(.22,.25,.11), pfbm(uv*23.,23.,3));
    alb = mix(soil, grass, gr*.7); alb = mix(alb, vec3(.42,.40,.36), peb*.8); paint = 0.;
    rough=.95-.1*peb; metal=0.; h=.4+.25*n+.3*peb+.12*gr*pfbm(uv*60.,60.,2); ao=.85+.15*n;`,
  cardboard: `
    float flute = sin(uv.x*3.1416*90.)*.5+.5; float n = pfbm(uv*4.,4.,5); float fib = pfbm(uv*vec2(8.,90.),8.,3);
    alb = vec3(.55,.40,.25)*(.9+.14*n+.06*fib-.05*flute); paint = 0.;
    rough=.9; metal=0.; h=.45+.1*flute+.08*fib; ao=.92+.08*flute;`,
  camoWood: `
    vec2 q = uv + vec2(pfbm(uv*3.,3.,4), pfbm(uv*3.+7.,3.,4))*.25;
    float a = pfbm(q*2.,2.,5), b = pfbm(q*2.+3.3,2.,5), c = pfbm(q*4.+9.1,4.,4);
    vec3 col = vec3(.30,.27,.18);
    col = mix(col, vec3(.16,.21,.12), step(.5,a));
    col = mix(col, vec3(.24,.17,.10), step(.56,b));
    col = mix(col, vec3(.05,.05,.045), step(.62,c));
    vec2 w = uv*vec2(110.,110.); float weave = (sin(w.x*3.1416)*.5+.5)*(sin(w.y*3.1416)*.5+.5);
    float dirt = smoothstep(.55,.9,pfbm(uv*3.+2.,3.,5));
    alb = col*(.85+.25*weave)*(1.-.3*dirt); paint = 0.;
    rough=.9; metal=0.; h=.35+.5*weave; ao=.8+.2*weave;`,
  camoDesert: `
    vec2 q = uv + vec2(pfbm(uv*3.,3.,4), pfbm(uv*3.+7.,3.,4))*.25;
    float a = pfbm(q*2.,2.,5), b = pfbm(q*3.+3.3,3.,5);
    vec3 col = vec3(.50,.43,.31);
    col = mix(col, vec3(.40,.33,.23), step(.5,a));
    col = mix(col, vec3(.30,.24,.17), step(.58,b));
    vec2 w = uv*vec2(110.,110.); float weave = (sin(w.x*3.1416)*.5+.5)*(sin(w.y*3.1416)*.5+.5);
    float dirt = smoothstep(.55,.9,pfbm(uv*3.+2.,3.,5));
    alb = col*(.85+.25*weave)*(1.-.3*dirt); paint = 0.;
    rough=.9; metal=0.; h=.35+.5*weave; ao=.8+.2*weave;`,
  denim: `
    vec2 w = uv*vec2(140.,140.); float tw = fract((w.x+w.y)*.5);
    float twill = smoothstep(.2,.5,tw)*smoothstep(.9,.6,tw);
    float fade = pfbm(uv*2.,2.,5); float worn = smoothstep(.6,.85,pfbm(uv*5.+1.,5.,4));
    alb = mix(vec3(.10,.15,.25), vec3(.32,.38,.48), fade*.6+worn*.5)*(.85+.25*twill); paint = 0.;
    rough=.92; metal=0.; h=.4+.4*twill; ao=.85+.15*twill;`,
  skin: `
    float n = pfbm(uv*6.,6.,5); vec3 v = pvor(uv*60.,60.);
    alb = vec3(.62,.42,.33)*(.9+.15*n); paint = 1.;
    rough=.55+.15*smoothstep(.0,.3,v.x); metal=0.; h=.5+.1*n-.05*smoothstep(.1,0.,v.x); ao=1.;`,
  concrete: `
    vec2 p=uv*4.;
    float m=pfbm(p,4.,6);
    float sp=pvor(uv*48.,48.).x;
    vec2 wq=uv*5.+vec2(pfbm(uv*4.,4.,3),pfbm(uv*4.+5.,4.,3))*.6; vec3 cr=pvor(wq,5.); float crack=smoothstep(.02,.0,cr.y-cr.x)*smoothstep(.55,.65,pfbm(uv*6.,6.,4));
    float stain=smoothstep(.55,.8,pfbm(uv*2.+3.1,2.,5));
    float g=.33+.14*(m-.5)-.05*smoothstep(.25,.0,sp)+.03*h12(floor(uv*256.));
    alb=vec3(g)*vec3(1.,.985,.96); alb*=1.-.35*stain; alb*=1.-.6*crack;
    rough=.86+.08*m-.2*stain; metal=0.;
    h=.55+.25*(m-.5)+.12*smoothstep(.3,0.,sp)-.5*crack; ao=1.-.5*crack; paint=0.;`,
  asphalt: `
    vec2 p=uv*4.;
    float m=pfbm(p,4.,5);
    vec3 v=pvor(uv*64.,64.); float stone=smoothstep(.45,.2,v.x);
    float tar=smoothstep(.62,.66,pfbm(uv*3.+7.,3.,4));
    vec3 cr=pvor(uv*2.,2.); float crack=smoothstep(.03,0.,cr.y-cr.x)*step(.5,pfbm(uv*6.,6.,3));
    float g=.075+.03*(m-.5)+.06*stone*(.4+.6*v.z);
    alb=vec3(g)*vec3(1.,1.,1.02); alb=mix(alb, vec3(.035), tar); alb*=1.-.5*crack;
    rough=mix(.9-.1*stone,.6,tar); metal=0.;
    h=.5+.3*stone*(1.-v.x)-.4*crack-.05*tar; ao=1.-.4*crack-.2*(1.-stone)*.3; paint=0.;`,
  ballast: `
    vec3 v=pvor(uv*14.,14.); vec3 v2=pvor(uv*29.+.5,29.);
    float d=min(v.x*1.1, v2.x*1.6+.15);
    float id=v.x*1.1<v2.x*1.6+.15? v.z : v2.z;
    float dome=sat(1.-d*1.7); float gap=smoothstep(.0,.25,v.y-v.x);
    vec3 c=mix(vec3(.30,.29,.27), vec3(.42,.38,.33), id); c=mix(c, vec3(.22,.2,.19), step(.8,fract(id*7.3)));
    float grime=pfbm(uv*6.,6.,4);
    alb=c*(.75+.35*grime)*(.35+.65*gap); alb*=.85+.15*h12(floor(uv*512.));
    rough=.78+.15*grime; metal=0.;
    h=dome*gap; ao=.25+.75*gap*sqrt(dome+.1); paint=0.;`,
  wood: `
    vec2 p=vec2(uv.x*2., uv.y*12.);
    float grain=pfbm(vec2(p.x*.5, p.y*3.), 12., 5);
    float rings=sin((uv.y*40.+grain*6.)*3.14)*.5+.5;
    float split=smoothstep(.04,.0,abs(fract(uv.y*6.+pn(vec2(uv.x*8.,uv.y*6.),8.)*.4)-.5))*step(.55,pn(vec2(uv.x*3.,floor(uv.y*6.)),3.));
    float tar=pfbm(uv*5.,5.,4);
    vec3 c=mix(vec3(.10,.07,.05), vec3(.20,.14,.09), rings*.6+grain*.4);
    c=mix(c, vec3(.05,.045,.04), smoothstep(.45,.75,tar));
    alb=c*(1.-.7*split); rough=.82+.1*grain; metal=0.;
    h=.5+.25*rings*.3+.2*grain-.6*split; ao=1.-.6*split; paint=0.;`,
  corrugated: `
    float cor=sin(uv.x*6.283*8.); float corA=cor*.5+.5;
    float ridge=pow(abs(cor),2.);
    vec2 p=uv*3.;
    float n=pfbm(p,3.,6);
    float streak=pfbm(vec2(uv.x*24., uv.y*1.5),24.,4);
    float rv=n*.7+streak*.38 + .22*smoothstep(.88,1.,uv.y) + .18*smoothstep(.12,0.,uv.y);
    float rust=smoothstep(.71,.8, rv);
    float rustEdge=smoothstep(.64,.71, rv) - rust;
    float chips=smoothstep(.78,.8,pfbm(uv*12.+4.,12.,4))*(1.-rust);
    float scr=scratches(uv,8.,3.);
    float grime=.72+.28*pfbm(uv*5.+9.,5.,5) - .25*smoothstep(.4,1.,streak)*(1.-uv.y*.5);
    vec3 rc=mix(vec3(.15,.065,.03), vec3(.27,.12,.05), pn(uv*40.,40.));
    alb=mix(vec3(grime*(1.-.25*(1.-corA))), rc, rust);
    alb*=1.-.35*rustEdge; alb=mix(alb, vec3(.16,.155,.15), chips*.8);
    alb=mix(alb, vec3(.4), scr*.25*(1.-rust));
    paint=(1.-rust)*(1.-chips*.6)*(1.-scr*.5)*(1.-rustEdge*.5);
    rough=mix(.5+.15*n, .92, rust); rough=mix(rough,.35,scr); metal=mix(.0,.25,rust)+chips*.5;
    h=corA*.7+.12*rust*pn(uv*90.,90.)+.05*n; ao=.75+.25*corA; `,
  paintedMetal: `
    float n=pfbm(uv*3.,3.,6);
    float rust=smoothstep(.74,.84,n*.85+.2*pfbm(uv*16.,16.,3));
    float chips=smoothstep(.76,.78,pfbm(uv*10.+2.,10.,5));
    float scr=scratches(uv,6.,7.);
    float grime=.78+.22*pfbm(uv*4.+5.,4.,5);
    vec3 rc=mix(vec3(.15,.065,.03), vec3(.27,.12,.05), pn(uv*30.,30.));
    alb=mix(vec3(grime), rc, rust); alb=mix(alb, vec3(.3), chips*(1.-rust));
    paint=(1.-rust)*(1.-chips)*(1.-scr*.7);
    rough=mix(.45+.15*n,.9,rust); rough=mix(rough,.3,max(chips,scr)*(1.-rust)); metal=max(chips,scr)*(1.-rust)*.9;
    h=.5+.1*n-.08*chips+.1*rust*pn(uv*80.,80.); ao=1.; `,
  steel: `
    float n=pfbm(uv*4.,4.,5);
    vec3 sp=pvor(uv*10.,10.);
    float streak=pfbm(vec2(uv.x*30.,uv.y*2.),30.,4);
    float rust=smoothstep(.62,.8,pfbm(uv*3.+1.,3.,6)+.2*streak);
    vec3 c=vec3(.56,.57,.58)*(.85+.15*sp.z)*(.9+.1*streak);
    alb=mix(c, vec3(.3,.15,.07), rust); rough=mix(.38+.2*n+.08*sp.z, .85, rust); metal=mix(1.,.2,rust);
    h=.5+.05*n+.15*rust*pn(uv*70.,70.); ao=1.; paint=0.;`,
  rust: `
    float n=pfbm(uv*4.,4.,7);
    float flake=smoothstep(.5,.7,pfbm(uv*20.,20.,3));
    alb=mix(vec3(.17,.08,.04), vec3(.38,.19,.08), n)*(.8+.3*flake); rough=.9; metal=.25;
    h=.5+.3*n+.2*flake; ao=1.; paint=0.;`,
  brick: `
    vec2 b=vec2(uv.x*4., uv.y*12.); float row=floor(b.y); b.x+=mod(row,2.)*.5;
    vec2 f=fract(b); vec2 id=vec2(floor(b.x), row);
    float mx=smoothstep(.0,.04,f.x)*smoothstep(1.,.96,f.x); float my=smoothstep(.0,.08,f.y)*smoothstep(1.,.92,f.y);
    float brick=mx*my;
    float v=h12(mod(id,vec2(4.,12.)));
    float n=pfbm(uv*8.,8.,5);
    vec3 c=mix(vec3(.33,.12,.07), vec3(.45,.2,.12), v)*(.8+.3*n);
    c=mix(c, vec3(.15,.12,.1), step(.88,v));
    float soot=smoothstep(.4,.9,pfbm(uv*2.,2.,5));
    alb=mix(vec3(.38,.36,.33)*(.8+.2*n), c, brick)*(1.-.5*soot);
    rough=mix(.95,.82,brick); metal=0.; h=brick*(.7+.2*n)+.1*n; ao=.6+.4*brick; paint=0.;`,
  polymer: `
    vec3 v=pvor(uv*90.,90.);
    float st=smoothstep(.0,.5,v.x);
    float n=pfbm(uv*6.,6.,4);
    alb=vec3(.032+.012*n); rough=.62+.12*st; metal=0.;
    h=.5+.35*(1.-st)+.05*n; ao=1.; paint=0.;`,
  anodized: `
    float br=pfbm(vec2(uv.x*2., uv.y*160.),160.,3);
    float scr=scratches(uv,10.,11.);
    float n=pfbm(uv*4.,4.,5);
    alb=vec3(.055+.01*n+.01*br); alb=mix(alb, vec3(.55), scr*.7);
    rough=.34+.1*br+.06*n; rough=mix(rough,.22,scr); metal=.75+.25*scr;
    h=.5+.04*br-.05*scr; ao=1.; paint=0.;`,
  phosphate: `
    float g=h12(floor(uv*512.)); float n=pfbm(uv*8.,8.,5);
    float wear=smoothstep(.62,.8,pfbm(uv*3.,3.,6));
    alb=mix(vec3(.05,.052,.05)*(.85+.3*g), vec3(.4,.41,.42), wear*.6);
    rough=mix(.6+.15*g, .3, wear); metal=mix(.55,1.,wear);
    h=.5+.08*g+.05*n; ao=1.; paint=0.;`,
  fabric: `
    vec2 w=uv*vec2(96.,96.);
    float wx=sin(w.x*3.1416)*.5+.5, wy=sin(w.y*3.1416)*.5+.5;
    float over=step(.5,fract((floor(w.x)+floor(w.y))*.5));
    float weave=mix(wx*(.6+.4*wy), wy*(.6+.4*wx), over);
    float n=pfbm(uv*5.,5.,5);
    float dirt=smoothstep(.5,.85,pfbm(uv*3.+2.,3.,5));
    alb=vec3((.62+.38*weave)*(.85+.25*n))*(1.-.35*dirt); paint=1.-dirt*.4;
    rough=.92; metal=0.; h=.3+.6*weave+.1*n; ao=.7+.3*weave;`,
  leather: `
    vec3 v=pvor(uv*40.,40.); float n=pfbm(uv*6.,6.,5);
    float crease=smoothstep(.06,0.,v.y-v.x);
    alb=vec3(.75+.25*n)*(1.-.45*crease); paint=1.-.3*crease;
    rough=.6+.2*n+.2*crease; metal=0.; h=.6+.2*n-.5*crease; ao=1.-.4*crease;`,
  plasterBlock: `
    vec2 b=vec2(uv.x*2., uv.y*4.); float row=floor(b.y); b.x+=mod(row,2.)*.5; vec2 f=fract(b);
    float joint=smoothstep(.0,.02,f.x)*smoothstep(1.,.98,f.x)*smoothstep(.0,.03,f.y)*smoothstep(1.,.97,f.y);
    float n=pfbm(uv*6.,6.,6); float stain=smoothstep(.45,.9,pfbm(vec2(uv.x*6.,uv.y*1.5),6.,5));
    alb=vec3(.46,.45,.42)*(.85+.25*n)*(1.-.45*stain)*(.6+.4*joint);
    rough=.9; metal=0.; h=.4+.4*joint+.2*n; ao=.6+.4*joint; paint=0.;`,
};

// Sets for the world-look plug-in (js/plug/env.js), sized in metres through the material's scale (1 / tile). Saltline's
// rule for relief: normal xy = 0.002 * bump / tile * dH/du, so k below = 0.002 * bump / tile (Saltline mats.md 2.5).
// Painted sets put paint coverage in alpha: 1 = intact paint (takes the vertex colour), 0 = substrate shows.
export const SURF_ENV = {
  // floor / wall boards, 15 cm wide, butt joints staggered per row (tile 1.2 m)
  planks: { k: 0.0045, body: `
    float rows=8.; float ry=uv.y*rows; float row=floor(ry); float fy=fract(ry);
    float off=h12(vec2(row,3.1)); float ux=fract(uv.x+off);
    float sY=smoothstep(0.,.045,fy)*smoothstep(1.,.955,fy);
    float sX=smoothstep(0.,.007,ux)*smoothstep(1.,.993,ux);
    float seam=sY*sX;
    float tone=.8+.4*h12(vec2(row,9.2));
    float gr=fbmA(vec2(uv.x*3.+row*.37, ry*1.), vec2(3.,rows), 5);
    float lines=fbmA(vec2(uv.x*2., uv.y*rows*14.), vec2(2.,rows*14.), 3);
    float wear=smoothstep(.5,.78, fbmA(uv*vec2(3.,3.), vec2(3.), 5)*.8 + gr*.3 - .05);
    float nail=smoothstep(.012,.006,length(vec2((ux-.03)*8.4,fy-.5)*vec2(1.,.14)))+smoothstep(.012,.006,length(vec2((ux-.97)*8.4,fy-.5)*vec2(1.,.14)));
    vec3 wood=vec3(.27,.19,.12)*tone*(.72+.5*gr)*(.82+.3*lines);
    alb=mix(vec3(.03,.025,.02), wood, seam); alb=mix(alb, vec3(.08,.08,.085), nail*.8);
    paint=seam*(1.-wear)*(1.-nail);
    rough=mix(.82+.1*lines, .62, paint); metal=nail*.6;
    h=.62+.05*gr+.03*lines-.5*(1.-seam)-.02*wear; ao=mix(.55,1.,seam);` },
  // fired bricks 22.5 x 7.5 cm, 1 cm mortar, running bond (tile 0.9 m); per-brick hue in rgb, mortar unpainted
  brick2: { k: 0.007, body: `
    vec2 b=vec2(uv.x*4., uv.y*12.); float row=floor(b.y); b.x+=mod(row,2.)*.5;
    vec2 id=vec2(mod(floor(b.x),4.), row); vec2 f=fract(b);
    float en=pfbm(uv*28.,28.,3)-.5;
    float ex=min(f.x,1.-f.x)*.225, ey=min(f.y,1.-f.y)*.075;
    float m=min(ex,ey)+en*.006;
    float brick=smoothstep(.0045,.0075,m);
    float v=h12(id+vec2(11.,3.)), v2=h12(id+vec2(5.,17.));
    float n=pfbm(uv*16.,16.,4); vec3 po=pvor(uv*70.,70.);
    vec3 c=mix(vec3(.36,.14,.08), vec3(.52,.25,.14), v);
    c=mix(c, vec3(.22,.11,.07), step(.86,v2)); c=mix(c, vec3(.50,.36,.24), step(.94,v2)*.7);
    c*=(.82+.3*n)*(.92+.08*smoothstep(0.,.25,po.x));
    vec3 mort=vec3(.40,.38,.34)*(.75+.35*pfbm(uv*40.,40.,3));
    alb=mix(mort, c, brick); paint=brick;
    rough=mix(.95,.84+.08*n,brick); metal=0.;
    h=mix(.3+.1*n, .75+.08*n-.06*smoothstep(.2,0.,po.x), brick); ao=mix(.55,1.,brick);` },
  // painted cinder block 40 x 20 cm (tile 1.6 m): paint peels to grey block, joints sunk
  block2: { k: 0.004, body: `
    vec2 b=vec2(uv.x*4., uv.y*8.); float row=floor(b.y); b.x+=mod(row,2.)*.5; vec2 f=fract(b);
    float ex=min(f.x,1.-f.x)*.4, ey=min(f.y,1.-f.y)*.2;
    float joint=smoothstep(.003,.008,min(ex,ey));
    float n=pfbm(uv*6.,6.,5); float po=pvor(uv*110.,110.).x;
    float peel=smoothstep(.66,.69, pfbm(uv*3.+vec2(5.,1.),3.,5)*.9+pfbm(uv*12.,12.,3)*.2);
    float streak=fbmA(vec2(uv.x*14., uv.y*1.), vec2(14.,1.), 4);
    vec3 blk=vec3(.42,.41,.38)*(.85+.25*n)*(.88+.12*smoothstep(0.,.3,po));
    alb=blk*mix(.55,1.,joint)*(1.-.18*smoothstep(.55,.85,streak));
    paint=1.-peel;
    rough=mix(.93, .74+.08*n, paint); metal=0.;
    h=.55+.03*n-.25*(1.-joint)-.03*(1.-smoothstep(0.,.3,po))-.04*peel; ao=mix(.6,1.,joint);` },
  // poured concrete (tile 3 m): pores, hairline cracks, formwork joint on the tile edge
  concrete2: { k: 0.0025, body: `
    float m=pfbm(uv*4.,4.,6); vec3 p1=pvor(uv*70.,70.); vec3 p2=pvor(uv*260.,260.);
    vec2 wq=uv*5.+vec2(pfbm(uv*4.,4.,3),pfbm(uv*4.+5.,4.,3))*.6; vec3 cr=pvor(wq,5.);
    float crack=smoothstep(.006,.0,cr.y-cr.x)*smoothstep(.58,.68,pfbm(uv*6.,6.,4));
    float form=smoothstep(.0,.006,min(min(uv.x,1.-uv.x),min(uv.y,1.-uv.y)));
    float stain=smoothstep(.55,.85,pfbm(uv*2.+3.1,2.,5));
    float g=.36+.12*(m-.5);
    alb=vec3(g)*vec3(1.,.985,.955)*(1.-.25*stain)*(1.-.5*crack)*(.94+.06*smoothstep(0.,.3,p1.x))*mix(.7,1.,form);
    rough=.84+.08*(m-.5)-.15*stain; metal=0.;
    h=.55+.12*(m-.5)-.08*smoothstep(.12,0.,p1.x)-.04*smoothstep(.15,0.,p2.x)-.35*crack-.3*(1.-form); ao=1.-.4*crack; paint=0.;` },
  // fine dense asphalt (tile 2 m): two aggregate sizes, binder, rare tar crack
  asphalt2: { k: 0.0016, body: `
    float m=pfbm(uv*4.,4.,5); vec3 v1=pvor(uv*110.,110.); vec3 v2=pvor(uv*230.,230.);
    float s1=smoothstep(.42,.2,v1.x), s2=smoothstep(.4,.2,v2.x);
    vec3 cr=pvor(uv*2.,2.); float crack=smoothstep(.012,0.,cr.y-cr.x)*step(.55,pfbm(uv*6.,6.,3));
    float stone=max(s1*(.4+.6*v1.z), s2*(.3+.5*v2.z));
    alb=vec3(.10+.03*(m-.5))+vec3(.17,.165,.155)*stone*.6; alb=mix(alb, vec3(.03), crack);
    rough=mix(.93,.74,stone); metal=0.;
    h=.45+.3*s1*(1.-v1.x)+.15*s2-.4*crack; ao=1.-.3*crack-.15*(1.-max(s1,s2)); paint=0.;` },
  // corrugated sheet, 7.6 cm pitch (tile 1.52 m, 20 ridges): paint over galvanised steel, rust from scratches and streaks
  corrugated2: { k: 0.04, body: `
    float cz=.5+.5*cos(uv.x*20.*6.2832);
    float n=pfbm(uv*3.,3.,6);
    float streak=fbmA(vec2(uv.x*40., uv.y*2.), vec2(40.,2.), 4);
    float rv=n*.62+streak*.42+(1.-cz)*.06;
    float rust=smoothstep(.71,.80,rv); float rEdge=smoothstep(.63,.71,rv)-rust;
    float scr=scratches(uv,6.,3.);
    float chips=smoothstep(.79,.81,pfbm(uv*12.+4.,12.,4))*(1.-rust);
    vec3 rc=mix(vec3(.16,.07,.03), vec3(.30,.14,.06), pn(uv*40.,40.));
    float grime=.82+.18*pfbm(uv*5.+9.,5.,5)-.22*smoothstep(.45,1.,streak)-.12*(1.-cz);
    vec3 steel=vec3(.42,.43,.44);
    alb=mix(vec3(grime), rc, rust); alb=mix(alb, steel, max(scr,chips)*(1.-rust)); alb*=1.-.35*rEdge;
    paint=(1.-rust)*(1.-max(scr,chips))*(1.-rEdge*.7);
    rough=mix(.48+.15*n, .9, rust); rough=mix(rough,.35,max(scr,chips)*(1.-rust)); metal=max(scr,chips)*(1.-rust)*.85+rust*.1;
    h=cz*.85+.06*rust*pn(uv*90.,90.)+.02*n; ao=.78+.22*cz;` },
  // painted steel (tile 1 m): chip clusters to bare metal with oxide halo, rust patches, dirt runs
  paintChip: { k: 0.0025, body: `
    float zone=smoothstep(.58,.82,pfbm(uv*2.,2.,3));
    vec3 v1=pvor(uv*20.,20.); vec3 v2=pvor(uv*64.,64.);
    float c1=smoothstep(.26,.2,v1.x)*step(1.-(.05+.22*zone), v1.z);
    float c2=smoothstep(.34,.26,v2.x)*step(1.-(.06+.3*zone), v2.z);
    float wn=pfbm(uv*8.+2.,8.,5)+zone*.1;
    float wear=smoothstep(.74,.78,wn); float halo=smoothstep(.69,.74,wn)-wear;
    float chip=max(max(c1,c2),wear);
    float scr=scratches(uv,6.,7.)*(1.-chip);
    float rustA=smoothstep(.76,.84, pfbm(uv*3.,3.,6)*.85+.2*pfbm(uv*16.,16.,3)+zone*.08);
    float streak=fbmA(vec2(uv.x*60., uv.y*1.), vec2(60.,1.), 3);
    float run=smoothstep(.6,.9,streak)*smoothstep(.3,.7,pfbm(uv*2.+7.,2.,3));
    float grime=.84+.16*pfbm(uv*4.+5.,4.,5)-.2*run;
    vec3 rc=mix(vec3(.17,.075,.035), vec3(.33,.16,.07), pn(uv*30.,30.));
    vec3 bare=vec3(.50,.50,.52);
    alb=vec3(grime); alb=mix(alb, bare, max(chip,scr)); alb=mix(alb, vec3(.42,.22,.15), halo*.8); alb=mix(alb, rc, rustA);
    paint=(1.-chip)*(1.-scr*.85)*(1.-halo)*(1.-rustA);
    rough=mix(.42+.12*pfbm(uv*6.,6.,3), .34, max(chip,scr)); rough=mix(rough,.9,rustA); rough=mix(rough,.75,halo);
    metal=max(chip,scr)*(1.-rustA)*.9+rustA*.1;
    h=.55-.05*chip+.08*rustA*pn(uv*80.,80.)+.02*halo; ao=1.;` },
  // bare steel (tile 1 m)
  steel2: { k: 0.0012, body: `
    float n=pfbm(uv*4.,4.,5); vec3 sp=pvor(uv*10.,10.);
    float br=fbmA(vec2(uv.x*2., uv.y*160.), vec2(2.,160.), 3);
    float scr=scratches(uv,9.,5.);
    float rust=smoothstep(.66,.82,pfbm(uv*3.+1.,3.,6)+.15*br);
    vec3 c=vec3(.56,.57,.58)*(.86+.14*sp.z)*(.92+.08*br);
    alb=mix(c, vec3(.3,.15,.07), rust); alb=mix(alb, vec3(.7), scr*.3*(1.-rust));
    rough=mix(.36+.18*n+.06*br, .86, rust); rough=mix(rough,.24,scr); metal=mix(1.,.2,rust);
    h=.5+.04*n+.12*rust*pn(uv*70.,70.)-.03*scr; ao=1.; paint=0.;` },
  // striped canvas awning (tile 1.6 m): coloured stripe takes the vertex colour, cream stripe stays cream
  awning: { k: 0.002, body: `
    vec2 w=uv*vec2(160.,160.); float weave=(sin(w.x*3.1416)*.5+.5)*(sin(w.y*3.1416)*.5+.5);
    float st=step(.5,fract(uv.x*1.));
    float dirt=smoothstep(.5,.9,pfbm(uv*3.+2.,3.,5)); float streak=fbmA(vec2(uv.x*20.,uv.y*1.),vec2(20.,1.),3);
    float g=(.86+.18*weave)*(1.-.3*dirt)*(1.-.15*smoothstep(.55,.9,streak));
    alb=mix(vec3(.72,.68,.57)*g, vec3(g), st); paint=st;
    rough=.9; metal=0.; h=.4+.4*weave+.05*dirt; ao=.85+.15*weave;` },
  // the same older sets with Saltline-scale relief
  cardboard2: { k: 0.0016, from: 'cardboard' },
  dirt2: { k: 0.005, from: 'dirt' },
  flat2: { k: 0.003, from: 'flat' },
};
for (const v of Object.values(SURF_ENV)) if (v.from) v.body = SURF[v.from];

const VERT = 'in vec3 position; in vec2 uv; out vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }';
function frag(body, k = 0.012) {
  return /* glsl */`precision highp float;
in vec2 vUv; out vec4 o; uniform int MODE; uniform float texel;
${COMMON}
void surf(vec2 uv, out vec3 alb, out float rough, out float metal, out float h, out float ao, out float paint){
  alb=vec3(.5); rough=.8; metal=0.; h=.5; ao=1.; paint=0.;
  ${body}
}
float H(vec2 uv){ vec3 a; float r,m,h,ao,p; surf(uv,a,r,m,h,ao,p); return h; }
void main(){
  vec3 alb; float rough, metal, h, ao, paint; surf(vUv, alb, rough, metal, h, ao, paint);
  if(MODE==0){ o=vec4(clamp(alb,0.,1.), paint); }
  else if(MODE==1){ o=vec4(ao, clamp(rough,.02,1.), metal, 1.); }
  else { float e=texel; float hx=H(vUv+vec2(e,0.))-H(vUv-vec2(e,0.)); float hy=H(vUv+vec2(0.,e))-H(vUv-vec2(0.,e));
    float s=1./(e*2.)*${k.toFixed(5)}; vec3 n=normalize(vec3(-hx*s,-hy*s,1.)); o=vec4(n*.5+.5,1.); }
}`;
}

export class Baker {
  constructor(renderer, size) {
    this.r = renderer; this.size = size; this.sets = {};
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }
  makeRT(srgb) {
    const s = this.size;
    const rt = new THREE.WebGLRenderTarget(s, s, {
      type: THREE.UnsignedByteType, depthBuffer: false, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
    });
    rt.texture.anisotropy = Math.min(8, this.r.capabilities.getMaxAnisotropy());
    if (srgb) rt.texture.colorSpace = THREE.SRGBColorSpace;
    return rt;
  }
  // mean linear albedo of a baked set (vertex-coloured meshes divide by it so the texture only adds variation)
  avg(name) {
    const set = this.bake(name);
    if (set._avg) return set._avg;
    const rt = set._rts.albedo, s = rt.width, buf = new Uint8Array(s * s * 4);
    this.r.readRenderTargetPixels(rt, 0, 0, s, s, buf);
    let r = 0, g = 0, b = 0; const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const step = Math.max(1, (s / 64) | 0); let n = 0;
    for (let y = 0; y < s; y += step) for (let x = 0; x < s; x += step) { const i = (y * s + x) * 4; r += lin(buf[i]); g += lin(buf[i + 1]); b += lin(buf[i + 2]); n++; }
    return (set._avg = new THREE.Vector3(Math.max(1e-3, r / n), Math.max(1e-3, g / n), Math.max(1e-3, b / n)));
  }
  // mean linear albedo of the painted texels (alpha-weighted): painted sets divide the paint area by it
  avgPaint(name) {
    const set = this.bake(name);
    if (set._avgP) return set._avgP;
    const rt = set._rts.albedo, s = rt.width, buf = new Uint8Array(s * s * 4);
    this.r.readRenderTargetPixels(rt, 0, 0, s, s, buf);
    let r = 0, g = 0, b = 0, w = 0; const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const step = Math.max(1, (s / 64) | 0);
    for (let y = 0; y < s; y += step) for (let x = 0; x < s; x += step) { const i = (y * s + x) * 4, a = buf[i + 3] / 255; r += lin(buf[i]) * a; g += lin(buf[i + 1]) * a; b += lin(buf[i + 2]) * a; w += a; }
    w = Math.max(w, 1e-3);
    return (set._avgP = new THREE.Vector3(Math.max(1e-3, r / w), Math.max(1e-3, g / w), Math.max(1e-3, b / w)));
  }
  bake(name, size) {
    if (this.sets[name]) return this.sets[name];
    const s = size || this.size;
    const env = SURF_ENV[name];
    const mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: frag(env ? env.body : SURF[name], env ? env.k : 0.012),
      uniforms: { MODE: { value: 0 }, texel: { value: 1 / s } }, depthTest: false, depthWrite: false,
    });
    this.quad.material = mat;
    const prevSize = this.size; this.size = s;
    const out = {};
    const prevRT = this.r.getRenderTarget();
    const prevXR = this.r.xr.enabled;
    ['albedo', 'orm', 'normal'].forEach((k, i) => {
      const rt = this.makeRT(i === 0);
      mat.uniforms.MODE.value = i;
      this.r.setRenderTarget(rt);
      this.r.render(this.scene, this.cam);
      out[k] = rt.texture; (out._rts || (out._rts = {}))[k] = rt;
    });
    this.r.setRenderTarget(prevRT); this.r.xr.enabled = prevXR;
    this.size = prevSize;
    mat.dispose();
    this.sets[name] = out;
    return out;
  }
}
