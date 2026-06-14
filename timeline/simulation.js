'use strict';
/* ═══════════════════════════════════════════════════════════════════════
   Kosmologische Simulation — simulation.js  (full timeline edition)
   ═══════════════════════════════════════════════════════════════════════ */

// ── DOM ───────────────────────────────────────────────────────────────────
const canvas      = document.getElementById('universe');
const ctx         = canvas.getContext('2d');
const btnPlay     = document.getElementById('playPause');
const cbScale     = document.getElementById('showScale');
const cbSkipEarly = document.getElementById('skipEarlyEras');
const langToggle  = document.getElementById('langToggle');
const btnLog      = document.getElementById('btnLog');
const btnLin      = document.getElementById('btnLin');
const sliderDur        = document.getElementById('sliderDuration');
const labelDur         = document.getElementById('labelDuration');
const sliderEraWeight  = document.getElementById('sliderEraWeight');
const labelEraWeight   = document.getElementById('labelEraWeight');
const sliderDensity    = document.getElementById('sliderDensity');
const labelDensity     = document.getElementById('labelDensity');
const sliderLinExp     = document.getElementById('sliderLinExp');
const labelLinExp      = document.getElementById('labelLinExp');
const sliderSpeed      = document.getElementById('sliderSpeed');
const labelSpeed       = document.getElementById('labelSpeed');
const cbTimeBar   = null;
const cbFluctu    = null;

// ── Physikalische Konstanten ──────────────────────────────────────────────
let ANIM_DURATION = 40000;

const R0_PHYS    = 1e-35;
const LOG_RANGE  = 61;

// Full cosmic timeline: Big Bang → Today (~13.8 Gyr)
const T_START_LOG     = -43;
const T_END_LOG_FULL  = 17.64; // log10(13.8e9 yr in seconds) ≈ 17.64
const FULL_LOG_RANGE  = T_END_LOG_FULL - T_START_LOG; // ≈ 60.64

function progressToLogT(p) { return T_START_LOG + FULL_LOG_RANGE * p; }
function logTToProgress(lt) { return (lt - T_START_LOG) / FULL_LOG_RANGE; }

// Era progress boundaries
const P_GUT_START   = logTToProgress(-42);     // 10⁻⁴² s
const P_INFL_START  = logTToProgress(-35);     // 10⁻³⁵ s – inflation start
const P_INFL_END    = logTToProgress(-32);     // 10⁻³² s – inflation end
const P_EW          = logTToProgress(-12);     // 10⁻¹² s – electroweak
const P_QUARK       = logTToProgress(-6);      // 10⁻⁶ s  – quark-hadron
const P_PROTON      = logTToProgress(0);       // 1 s     – proton/neutron
const P_BBN_END     = logTToProgress(2.25);    // ~180 s  – BBN ends
const P_RECOMB      = logTToProgress(13.08);   // 380 000 yr – recombination
const P_FIRST_STARS = logTToProgress(15.5);    // ~300 Myr – first stars

// ── LOG / LIN mode ────────────────────────────────────────────────────────
let expansionMode = 'log';

// LOG mode: weighted time per era — early eras are brief, later eras breathe.
// Inflation (5 %) is a quick flash; Stars/Galaxies → Today dominates at 48 %.
const CTRL_T = [0, 0.03, 0.06, 0.11, 0.21, 0.30, 0.42, 0.52, 1.0];
const CTRL_T_UNIFORM = CTRL_T.map((_,i,a)=>i/(a.length-1)); // equal time per era
let effectiveCTRL_T = [...CTRL_T];
const CTRL_P = [0,
  P_GUT_START,    //  3 % — Planck quantum-gravity era
  P_INFL_START,   //  3 % — GUT symmetry breaking
  P_INFL_END,     //  5 % — Inflation: exponential expansion (brief flash)
  P_QUARK,        // 10 % — QGP: quarks, hadrons, leptons
  P_BBN_END,      //  9 % — Nucleosynthesis (1 μs → 3 min)
  P_RECOMB,       // 12 % — Photon plasma → CMB (380 kyr)
  P_FIRST_STARS,  // 10 % — Dark Ages (CMB → first light)
  1.0];           // 48 % — Stars, galaxies, Solar System, today

// LIN mode: power-law mapping (progress = animT^linExponent).
// No era-boundary awareness — purely mathematical, era-independent.
// Exponent = 1 → linear (uniform), 2 → early eras get more time, 3 → strongest early emphasis.
// Higher exponent = more screen time for early universe phases.
let linExponent = 2.0;
function _linAnimToProgress(t) {
  return Math.pow(Math.max(0, Math.min(1, t)), linExponent);
}
function _linProgressToAnim(p) {
  return Math.pow(Math.max(0, Math.min(1, p)), 1 / linExponent);
}

function _piecewise(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length-1]) return ys[ys.length-1];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) {
      const frac = (x - xs[i-1]) / (xs[i] - xs[i-1]);
      return ys[i-1] + frac * (ys[i] - ys[i-1]);
    }
  }
  return ys[ys.length-1];
}

function computeEffectiveCTRL_T() {
  const w = Math.max(0, Math.min(2, eraWeightIntensity));
  for (let i = 0; i < CTRL_T.length; i++) {
    // w in [0,1]: blend uniform → CTRL_T
    // w in [1,2]: extrapolate further past CTRL_T (stronger era compression)
    const delta = CTRL_T[i] - CTRL_T_UNIFORM[i];
    effectiveCTRL_T[i] = CTRL_T_UNIFORM[i] + w * delta;
  }
  // Clamp endpoints and enforce strict monotonicity
  effectiveCTRL_T[0] = 0;
  effectiveCTRL_T[effectiveCTRL_T.length - 1] = 1;
  for (let i = 1; i < effectiveCTRL_T.length - 1; i++) {
    effectiveCTRL_T[i] = Math.max(effectiveCTRL_T[i - 1] + 0.001, Math.min(0.999, effectiveCTRL_T[i]));
  }
  for (let i = effectiveCTRL_T.length - 2; i >= 1; i--) {
    effectiveCTRL_T[i] = Math.min(effectiveCTRL_T[i], effectiveCTRL_T[i + 1] - 0.001);
    effectiveCTRL_T[i] = Math.max(effectiveCTRL_T[i], effectiveCTRL_T[i - 1] + 0.001);
  }
}

function animToProgress(t) {
  if (expansionMode === 'lin') return _linAnimToProgress(t);
  return _piecewise(effectiveCTRL_T, CTRL_P, t);
}
function progressToAnim(p) {
  if (expansionMode === 'lin') return _linProgressToAnim(p);
  return _piecewise(CTRL_P, effectiveCTRL_T, p);
}

// ── Vergleichsobjekte ─────────────────────────────────────────────────────
const COMPS = [
  { key:'planck',    de:'Planck-Länge',   en:'Planck length',   size:1.616e-35, col:'#ffffff' },
  { key:'preon',     de:'Preon (theor.)', en:'Preon (theor.)',  size:1e-21,     col:'#ff99ff' },
  { key:'quark',     de:'Quark',          en:'Quark',           size:8.6e-19,   col:'#cc55ff' },
  { key:'proton',    de:'Proton',    en:'Proton',    size:9.5e-16,  col:'#bf7060' },
  { key:'atom',      de:'Wasserstoff-Atom',     en:'Hydrogen Atom',       size:1.06e-10, col:'#5888cc' },
  { key:'bacterium', de:'E. coli',              en:'E. coli',             size:2e-6,     col:'#48a860' },
  { key:'human',     de:'Mensch',               en:'Human',               size:1.75,     col:'#c0a070' },
  { key:'earth',     de:'Erde',                 en:'Earth',               size:1.274e7,  col:'#4488cc' },
  { key:'solar',     de:'Sonnensystem',         en:'Solar system',        size:1.2e13,   col:'#d0a030' },
  { key:'milkyway',  de:'Milchstraße',          en:'Milky Way',           size:9.46e20,  col:'#8898b8' },
];

const SCALE_REFS = [
  { de:'Planck-Länge',    en:'Planck length',       size:1.616e-35, special:false },
  { de:'Preon (theor.)',  en:'Preon (theor.)',       size:1e-21,     special:false },
  { de:'Quark',    en:'Quark',     size:8.6e-19,  special:false },
  { de:'Proton',   en:'Proton',    size:9.5e-16,  special:false },
  { de:'Atom',            en:'Atom',                 size:1e-10,     special:false },
  { de:'Bakterium',       en:'Bacterium',            size:1e-6,      special:false },
  { de:'Mensch',          en:'Human',                size:1.75,      special:false },
  { de:'Erde',            en:'Earth',                size:1.274e7,   special:false },
  { de:'Sonnensystem',    en:'Solar system',         size:1.2e13,    special:false },
  { de:'Lichtjahr',       en:'Light year',           size:9.46e15,   special:false },
  { de:'Milchstraße',     en:'Milky Way',            size:9.46e20,   special:false },
  { de:'Beob. Universum', en:'Obs. Universe',        size:8.8e25,    special:true  },
];

// ── Era descriptions (sidebar) ────────────────────────────────────────────
const ERA_INFO = {
  planck: {
    de: { title: 'Planck-Ära', sub: 't < 10⁻⁴² s',
          text: 'Raumzeit ist noch nicht klassisch definiert. Quantengravitation dominiert – alle vier Grundkräfte sind zu einer einzigen Superforce vereint. Physik jenseits bekannter Gesetze.' },
    en: { title: 'Planck Era', sub: 't < 10⁻⁴² s',
          text: 'Space-time is not yet classically defined. Quantum gravity dominates – all four fundamental forces are unified into a single superforce. Physics beyond known laws.' }
  },
  gut: {
    de: { title: 'GUT-Ära', sub: '10⁻⁴² – 10⁻³⁵ s',
          text: 'Die Gravitation trennt sich ab. Starke, schwache und elektromagnetische Kraft bleiben noch vereint (Große Vereinheitlichungstheorie). Das Universum kühlt, erste Phasenübergänge setzen ein.' },
    en: { title: 'GUT Era', sub: '10⁻⁴² – 10⁻³⁵ s',
          text: 'Gravity separates. The strong, weak and electromagnetic forces remain unified (Grand Unified Theory). The universe cools and first phase transitions begin.' }
  },
  inflation: {
    de: { title: 'Inflation', sub: '10⁻³⁵ – 10⁻³² s',
          text: 'Exponentielles Wachstum: In 10⁻³³ s expandiert das Universum um Faktor ~10⁵⁰. Quantenfluktuationen werden auf kosmische Skalen gestreckt – der Ursprung aller heutigen Struktur.' },
    en: { title: 'Inflation', sub: '10⁻³⁵ – 10⁻³² s',
          text: 'Exponential growth: in 10⁻³³ s the universe expands by a factor of ~10⁵⁰. Quantum fluctuations are stretched to cosmic scales – the seed of all structure we see today.' }
  },
  qgp: {
    de: { title: 'Quark-Gluon-Plasma', sub: '10⁻³² s – 1 μs',
          text: 'Eine heiße Suppe aus freien Quarks und Gluonen. Bei ~1 μs kühlt das Universum unter 2×10¹² K ab – Quarks kondensieren zu Protonen und Neutronen (Quark-Hadron-Übergang).' },
    en: { title: 'Quark-Gluon Plasma', sub: '10⁻³² s – 1 μs',
          text: 'A hot soup of free quarks and gluons. At ~1 μs the universe cools below 2×10¹² K – quarks condense into protons and neutrons (quark-hadron transition).' }
  },
  hadron: {
    de: { title: 'Nukleosynthese', sub: '1 μs – ~3 min',
          text: 'Protonen und Neutronen fusionieren zu leichten Kernen. In nur 3 Minuten entsteht fast das gesamte primordiale Helium (25 %) und Lithium des Universums.' },
    en: { title: 'Nucleosynthesis', sub: '1 μs – ~3 min',
          text: 'Protons and neutrons fuse into light nuclei. In just 3 minutes, nearly all primordial helium (25%) and lithium in the universe is forged.' }
  },
  plasma: {
    de: { title: 'Photonenplasma', sub: '3 min – 380 000 Jahre',
          text: 'Ein dichtes, undurchsichtiges Plasma aus Photonen, Elektronen und Kernen. Licht ist gefangen – das Universum glüht, aber bleibt für Beobachter unsichtbar.' },
    en: { title: 'Photon Plasma', sub: '3 min – 380,000 years',
          text: 'A dense, opaque plasma of photons, electrons and nuclei. Light is trapped – the universe glows intensely but remains opaque to any observer.' }
  },
  dark: {
    de: { title: 'Dunkle Zeit', sub: '380 000 J. – 300 Mio. J.',
          text: 'Nach der Rekombination werden CMB-Photonen freigesetzt – das erste Licht. Das Universum füllt sich mit neutralem Wasserstoff und ist dunkel, bis die ersten Sterne zünden.' },
    en: { title: 'Dark Ages', sub: '380,000 yr – 300 Myr',
          text: 'After recombination, CMB photons are released – the first light. The universe fills with neutral hydrogen, dark and silent until the first stars ignite.' }
  },
  stars: {
    de: { title: 'Sterne & Galaxien', sub: '300 Mio. J. – Heute',
          text: 'Erste Sterne und Galaxien entstehen. Dunkle Materie baut kosmische Großstruktur auf. Vor 4,6 Mrd. Jahren bildet sich unser Sonnensystem. Heute: 13,8 Mrd. Jahre.' },
    en: { title: 'Stars & Galaxies', sub: '300 Myr – Today',
          text: 'First stars and galaxies form. Dark matter builds the cosmic web. 4.6 Gyr ago our Solar System forms. Today the universe is 13.8 billion years old.' }
  }
};

let _eraInfoCacheKey = null;
function updateEraInfo(p) {
  const el = document.getElementById('eraInfo');
  if (!el) return;
  const ef = getEraFactors(p);
  const iF = inflF(p);
  let key;
  if      (ef.planckF > 0.3) key = 'planck';
  else if (ef.gutF    > 0.3) key = 'gut';
  else if (iF         > 0.3) key = 'inflation';
  else if (ef.qgpF    > 0.3) key = 'qgp';
  else if (ef.hadronF > 0.3) key = 'hadron';
  else if (ef.plasmaF > 0.3) key = 'plasma';
  else if (ef.darkF   > 0.3) key = 'dark';
  else if (ef.starsF  > 0.3) key = 'stars';
  else return;
  const cacheKey = key + lang;
  if (cacheKey === _eraInfoCacheKey) return;
  _eraInfoCacheKey = cacheKey;
  const info = ERA_INFO[key][lang];
  el.querySelector('.era-info-title').textContent = info.title;
  el.querySelector('.era-info-sub').textContent   = info.sub;
  el.querySelector('.era-info-text').textContent  = info.text;
}

// ── Zustand ───────────────────────────────────────────────────────────────
let playing           = false;
let progress          = 0;
let animT             = 0;
let startTime         = null;
let rafId             = null;
let eraWeightIntensity = 1.0;
let gParticleDensity   = 1.0;
let speedMultiplier    = 1.0;
let lang      = document.documentElement.dataset.lang || 'de';
let dpr       = 1;

let flashAlpha=0, flashTs=0;
let quantumDone=false, quantumTs=0;
let obsDone=false, endDone=false, endTs=0;
let planckMsgDone=false, planckMsgTs=0;
let gutMsgDone=false, gutMsgTs=0;

// ── Feste Zufallsdaten ────────────────────────────────────────────────────
const FLUCT = Array.from({length:8}, () => ({
  a:0.08+Math.random()*0.14, f:3+Math.floor(Math.random()*18), p:Math.random()*Math.PI*2
}));
const QGP_PARTICLES = Array.from({length:260}, () => ({
  a:Math.random()*Math.PI*2, f:Math.random()*0.92,
  vx:(Math.random()-0.5)*0.008, vy:(Math.random()-0.5)*0.008,
  r:0.8+Math.random()*1.4, kind:Math.random(), p:Math.random()*Math.PI*2,
}));
const PHOTON_LINES = Array.from({length:80}, () => ({
  a:Math.random()*Math.PI*2, f0:0.05+Math.random()*0.85,
  len:0.04+Math.random()*0.18, speed:0.003+Math.random()*0.006,
}));
const CMB_CELLS = Array.from({length:180}, () => ({
  a:Math.random()*Math.PI*2, f:Math.random()*0.98, r:2+Math.random()*5,
  hue:190+Math.floor(Math.random()*80), warm:Math.random()<0.45,
}));
const PLANCK_FOAM = Array.from({length:120}, () => ({
  a:Math.random()*Math.PI*2, f:Math.random()*0.88,
  size:0.5+Math.random()*1.8, speed:0.8+Math.random()*2.5, phase:Math.random()*Math.PI*2,
}));
const GUT_PARTICLES = Array.from({length:180}, () => ({
  a:Math.random()*Math.PI*2, f:Math.random()*0.90,
  vx:(Math.random()-0.5)*0.012, vy:(Math.random()-0.5)*0.012,
  r:1.0+Math.random()*2.2, col:`hsl(${Math.floor(Math.random()*360)},80%,65%)`,
  phase:Math.random()*Math.PI*2,
}));
// New era particles
const HADRON_PARTICLES = Array.from({length:200}, () => ({
  a:Math.random()*Math.PI*2, f:Math.random()*0.92,
  vx:(Math.random()-0.5)*0.009, vy:(Math.random()-0.5)*0.009,
  r:0.7+Math.random()*1.6, phase:Math.random()*Math.PI*2,
  col:`hsl(${20+Math.floor(Math.random()*40)},90%,${55+Math.floor(Math.random()*25)}%)`,
}));
const PLASMA_CELLS = Array.from({length:160}, () => ({
  a:Math.random()*Math.PI*2, f:Math.random()*0.95, r:1.8+Math.random()*4,
  warm:Math.random()<0.6, phase:Math.random()*Math.PI*2,
}));
const STAR_SEEDS = Array.from({length:300}, () => ({
  a:Math.random()*Math.PI*2, f:Math.random()*0.93,
  bright:Math.random(), size:0.5+Math.random()*1.8, phase:Math.random()*Math.PI*2,
}));
const GALAXY_SEEDS = Array.from({length:40}, () => ({
  a:Math.random()*Math.PI*2, f:0.1+Math.random()*0.82,
  spin:( Math.random()-0.5)*0.5, arms:2+Math.floor(Math.random()*3),
  phase:Math.random()*Math.PI*2,
}));
const DARK_PARTICLES = Array.from({length:80}, () => ({
  a:Math.random()*Math.PI*2, f:Math.random()*0.90,
  r:0.4+Math.random()*0.9, phase:Math.random()*Math.PI*2,
}));

// ── Canvas ────────────────────────────────────────────────────────────────
function resizeCanvas() {
  const w = canvas.parentElement.clientWidth  || window.innerWidth;
  const h = canvas.parentElement.clientHeight || window.innerHeight;
  dpr = Math.min(window.devicePixelRatio||1, 2);
  canvas.width  = w*dpr; canvas.height = h*dpr;
  canvas.style.width  = w+'px'; canvas.style.height = h+'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);
  drawFrame();
}

// ── Layout ────────────────────────────────────────────────────────────────
function L() {
  const W = canvas.width/dpr, H = canvas.height/dpr;
  const btmH    = Math.min(H*0.175, 96);
  const topRowH = Math.min(H*0.20, 110);
  const topH    = H - btmH - topRowH;
  const mainY0  = topRowH;
  const scaleW  = Math.min(W*0.22, 168);
  const midW    = W - scaleW;
  const divX    = midW * 0.478;

  const leftColW = divX;
  const uR    = Math.min(leftColW * 0.38, topH * 0.38);
  const uCX   = leftColW * 0.50;
  const uCY   = mainY0 + topH * 0.50;

  const rightColX = divX;
  const rightColW = midW - divX;
  const rCX   = rightColX + rightColW * 0.50;
  const rMaxR = Math.min(rightColW * 0.38, topH * 0.38);
  const rCY   = mainY0 + topH * 0.50;

  const ulf = Math.max(13, uR * 0.105);

  return { W, H, btmH, topH, topRowH, mainY0, scaleW, midW, divX,
           uCX, uCY, uR, ulf, rCX, rCY, rMaxR, leftColW, rightColX, rightColW };
}

// ── Physik-Helpers ────────────────────────────────────────────────────────
function univPhys(p) { return R0_PHYS * Math.pow(10, LOG_RANGE * p); }

function compBlend(uPhys) {
  const logU = Math.log10(uPhys);
  let nearI=0, nearD=Infinity;
  for (let i=0;i<COMPS.length;i++) {
    const d=Math.abs(Math.log10(COMPS[i].size)-logU);
    if(d<nearD){nearD=d;nearI=i;}
  }
  const TRANSITION = 1.2;
  const results = [];
  for (let i=0;i<COMPS.length;i++) {
    const logComp  = Math.log10(COMPS[i].size);
    const delta    = logComp - logU;
    const absDelta = Math.abs(delta);
    const prevLogS = i>0 ? Math.log10(COMPS[i-1].size) : logComp-4;
    const nextLogS = i<COMPS.length-1 ? Math.log10(COMPS[i+1].size) : logComp+4;
    const halfGap  = Math.min(Math.abs(logComp-prevLogS)*0.5, Math.abs(nextLogS-logComp)*0.5);
    const fadeRange = Math.min(TRANSITION, halfGap*0.7);
    let alpha;
    if      (absDelta <= halfGap-fadeRange) alpha = 1.0;
    else if (absDelta <= halfGap+fadeRange) alpha = Math.max(0,Math.min(1,1-(absDelta-(halfGap-fadeRange))/(2*fadeRange)));
    else                                    alpha = 0;
    if(alpha>0.005) results.push({...COMPS[i],alpha});
  }
  return results.length ? results : [{...COMPS[nearI],alpha:1.0}];
}

// ── Zeichenhilfen ─────────────────────────────────────────────────────────
function glow(c,b)  { ctx.shadowColor=c; ctx.shadowBlur=b; }
function noGlow()   { ctx.shadowColor='transparent'; ctx.shadowBlur=0; }

function softText(x,y,text,alpha,size,col) {
  ctx.save(); ctx.globalAlpha=alpha;
  ctx.font=`${size}px system-ui,sans-serif`;
  ctx.fillStyle=col; ctx.textAlign='center';
  ctx.shadowColor='rgba(0,0,0,0.9)'; ctx.shadowBlur=14;
  const lines=text.split('\n'), lh=size*1.65;
  const y0=y-(lines.length-1)*lh*0.5;
  lines.forEach((ln,i)=>ctx.fillText(ln,x,y0+i*lh));
  ctx.restore();
}

// ── Era helper (all 8 eras) ───────────────────────────────────────────────
function getEraFactors(p) {
  const FADE = 0.010;
  function eraFactor(start, end) {
    if (p <= start-FADE) return 0;
    if (p < start+FADE)  return (p-(start-FADE))/(2*FADE);
    if (p <= end-FADE)   return 1;
    if (p < end+FADE)    return ((end+FADE)-p)/(2*FADE);
    return 0;
  }
  return {
    planckF : eraFactor(0,              P_GUT_START),
    gutF    : eraFactor(P_GUT_START,    P_INFL_START),
    inflF   : eraFactor(P_INFL_START,   P_INFL_END),
    qgpF    : eraFactor(P_INFL_END,     P_QUARK),
    hadronF : eraFactor(P_QUARK,        P_BBN_END),
    plasmaF : eraFactor(P_BBN_END,      P_RECOMB),
    darkF   : eraFactor(P_RECOMB,       P_FIRST_STARS),
    starsF  : eraFactor(P_FIRST_STARS,  1.0),
  };
}

// ── Tunnel radius profile ────────────────────────────────────────────────
// Returns normalized radius 0→1 for a given animation fraction 0→1
function tunnelNormRadius(frac) {
  const logT = T_START_LOG + FULL_LOG_RANGE * frac;
  if (logT <= -35) {
    const t = (logT - T_START_LOG) / (-35 - T_START_LOG);
    return 0.004 + t * 0.006; // 0.004 → 0.01
  } else if (logT <= -32) {
    const t = (logT + 35) / 3;
    return 0.01 + t * t * 0.73; // explosive inflation
  } else {
    const t = (logT + 32) / (T_END_LOG_FULL + 32);
    return 0.74 + Math.pow(t, 0.52) * 0.26;
  }
}

// ── Universe tunnel visualization (top row) ───────────────────────────────
function drawTopRow(l) {
  const {W, topRowH} = l;
  if (topRowH <= 6) return;

  ctx.save();

  // Background
  ctx.fillStyle = 'rgba(1,3,14,0.99)';
  ctx.fillRect(0, 0, W, topRowH);

  // Bottom separator
  ctx.strokeStyle = 'rgba(18,28,52,1)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, topRowH); ctx.lineTo(W, topRowH); ctx.stroke();

  if (topRowH < 18) { ctx.restore(); return; }

  const CY    = topRowH * 0.5;
  const MAX_R = topRowH * 0.42;
  const PAD_L = W * 0.015;
  const PAD_R = W * 0.008;
  const TW    = W - PAD_L - PAD_R;
  const now   = performance.now() * 0.001;

  // ── Clip to this row ────────────────────────────────────────────────────
  ctx.beginPath();
  ctx.rect(0, 0, W, topRowH);
  ctx.clip();

  // ── Era color bands ─────────────────────────────────────────────────────
  // [t0_log, t1_log, center_fill_color, label_de, label_en]
  const TUNNEL_ERAS = [
    [-43,   -42,   '#180630', 'Planck',             'Planck'          ],
    [-42,   -35,   '#5a1e06', 'GUT-Ära',            'GUT Era'         ],
    [-35,   -32,   '#06208a', 'Inflation',          'Inflation'       ],
    [-32,   -6,    '#8a1e06', 'QGP',                'QGP'             ],
    [-6,     2.25, '#a03010', 'Nukleosynthese',     'Nucleosynthesis' ],
    [ 2.25, 13.08, '#6a103a', 'Plasma/CMB',         'Plasma/CMB'      ],
    [13.08, 15.5,  '#060a18', 'Dunkle Zeit',        'Dark Ages'       ],
    [15.5,  17.64, '#070e22', 'Sterne & Galaxien',  'Stars & Galaxies'],
  ];

  // Draw each era band up to current progress
  for (const [t0, t1, col, labelDe, labelEn] of TUNNEL_ERAS) {
    const f0   = (t0 - T_START_LOG) / FULL_LOG_RANGE;
    const f1   = (t1 - T_START_LOG) / FULL_LOG_RANGE;
    if (f0 >= progress) break;
    const f1d  = Math.min(f1, progress);

    const x0 = PAD_L + f0 * TW;
    const x1 = PAD_L + f1d * TW;
    const r0 = tunnelNormRadius(f0) * MAX_R;
    const r1 = tunnelNormRadius(f1d) * MAX_R;

    // Vertical gradient (darker at top/bottom edges)
    const vg = ctx.createLinearGradient(0, CY - Math.max(r0,r1), 0, CY + Math.max(r0,r1));
    const c = col;
    vg.addColorStop(0,    hexAlpha(c, 0.30));
    vg.addColorStop(0.28, hexAlpha(c, 0.80));
    vg.addColorStop(0.50, hexAlpha(c, 1.00));
    vg.addColorStop(0.72, hexAlpha(c, 0.80));
    vg.addColorStop(1,    hexAlpha(c, 0.30));

    ctx.beginPath();
    ctx.moveTo(x0, CY - r0);
    ctx.lineTo(x1, CY - r1);
    ctx.lineTo(x1, CY + r1);
    ctx.lineTo(x0, CY + r0);
    ctx.closePath();
    ctx.fillStyle = vg;
    ctx.fill();

    // Label inside tunnel if wide enough
    const eraW = x1 - x0;
    const midR = (r0 + r1) * 0.5;
    if (eraW > 30 && midR > 7) {
      const midX = (x0 + x1) * 0.5;
      const fs = Math.max(6, Math.min(10, midR * 0.28));
      ctx.font = `${fs}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(200,210,255,0.42)';
      ctx.textAlign = 'center';
      ctx.fillText(lang === 'en' ? labelEn : labelDe, midX, CY + fs * 0.4);
    }
  }

  // ── Animated content inside tunnel (particles, glow) ─────────────────
  const {planckF,gutF,inflF,qgpF,hadronF,plasmaF,darkF,starsF} = getEraFactors(progress);

  // Inflation glow — pulsing blue inside the inflation band
  if (inflF > 0.01) {
    const inflX0 = PAD_L + ((P_INFL_START)) * TW;
    const inflX1 = PAD_L + (Math.min(P_INFL_END, progress)) * TW;
    const infR   = tunnelNormRadius(Math.min(P_INFL_END, progress) * 0.5 + P_INFL_START * 0.5) * MAX_R;
    const pulse  = 0.5 + 0.5 * Math.sin(now * 3.5);
    const ig     = ctx.createLinearGradient(inflX0, 0, inflX1, 0);
    ig.addColorStop(0,   `rgba(20,60,200,0)`);
    ig.addColorStop(0.5, `rgba(40,100,255,${0.25 * inflF * (0.7 + 0.3 * pulse)})`);
    ig.addColorStop(1,   `rgba(80,150,255,${0.18 * inflF})`);
    ctx.fillStyle = ig;
    const avgR = tunnelNormRadius((P_INFL_START + Math.min(P_INFL_END, progress)) * 0.5) * MAX_R;
    ctx.fillRect(inflX0, CY - avgR, inflX1 - inflX0, avgR * 2);
  }

  // QGP sparkle
  if (qgpF > 0.01) {
    for (let i = 0; i < 30; i++) {
      const qi    = QGP_PARTICLES[i];
      const logT  = T_START_LOG + FULL_LOG_RANGE * progress;
      // spread particles across QGP era
      const fQGP  = (P_INFL_END + qi.a / (2 * Math.PI) * (P_QUARK - P_INFL_END));
      if (fQGP > progress) continue;
      const px    = PAD_L + fQGP * TW;
      const pr    = tunnelNormRadius(fQGP) * MAX_R;
      const py    = CY + (qi.f * 2 - 1) * pr * 0.8;
      ctx.globalAlpha = qgpF * 0.35;
      if      (qi.kind < 0.33) ctx.fillStyle = '#ff5540';
      else if (qi.kind < 0.55) ctx.fillStyle = '#40dd55';
      else if (qi.kind < 0.72) ctx.fillStyle = '#5566ff';
      else                     ctx.fillStyle = '#ffdd22';
      ctx.beginPath(); ctx.arc(px, py, qi.r * 0.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Stars glimmer in stars era
  if (starsF > 0.01) {
    for (const s of STAR_SEEDS) {
      const starFrac = P_FIRST_STARS + s.a / (Math.PI * 2) * (1 - P_FIRST_STARS);
      if (starFrac > progress) continue;
      const sx = PAD_L + starFrac * TW;
      const sr = tunnelNormRadius(starFrac) * MAX_R;
      const sy = CY + (s.f * 2 - 1) * sr * 0.88;
      const flicker = 0.4 + 0.6 * Math.abs(Math.sin(now * (2 + s.bright * 3) + s.phase));
      ctx.globalAlpha = starsF * flicker * (0.3 + s.bright * 0.5) * 0.6;
      const hue = 200 + s.bright * 60;
      ctx.fillStyle = `hsl(${hue},80%,${70 + s.bright * 25}%)`;
      ctx.beginPath(); ctx.arc(sx, sy, s.size * 0.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ── Outline of constructed tunnel ───────────────────────────────────────
  const N_OUT = 350;
  ctx.beginPath();
  for (let i = 0; i <= N_OUT; i++) {
    const frac = (i / N_OUT) * progress;
    const x    = PAD_L + frac * TW;
    const r    = tunnelNormRadius(frac) * MAX_R;
    if (i === 0) ctx.moveTo(x, CY - r);
    else         ctx.lineTo(x, CY - r);
  }
  for (let i = N_OUT; i >= 0; i--) {
    const frac = (i / N_OUT) * progress;
    const x    = PAD_L + frac * TW;
    const r    = tunnelNormRadius(frac) * MAX_R;
    ctx.lineTo(x, CY + r);
  }
  ctx.closePath();
  ctx.strokeStyle = 'rgba(110,175,255,0.55)';
  ctx.lineWidth   = 1.2;
  ctx.stroke();

  // ── Current-position glow line ───────────────────────────────────────────
  const xNow = PAD_L + progress * TW;
  const rNow = tunnelNormRadius(progress) * MAX_R;
  const lineG = ctx.createLinearGradient(xNow, CY - rNow, xNow, CY + rNow);
  lineG.addColorStop(0,   'rgba(80,180,255,0)');
  lineG.addColorStop(0.5, 'rgba(120,210,255,0.92)');
  lineG.addColorStop(1,   'rgba(80,180,255,0)');
  glow('rgba(80,190,255,0.85)', 12);
  ctx.strokeStyle = lineG;
  ctx.lineWidth   = 2.5;
  ctx.beginPath();
  ctx.moveTo(xNow, CY - rNow);
  ctx.lineTo(xNow, CY + rNow);
  ctx.stroke();
  noGlow();

  // Small triangle above the line
  ctx.fillStyle = 'rgba(120,210,255,0.85)';
  ctx.beginPath();
  ctx.moveTo(xNow - 4, 3);
  ctx.lineTo(xNow + 4, 3);
  ctx.lineTo(xNow, 3 + rNow * 0.25 + 5);
  ctx.closePath();
  ctx.fill();

  // ── Epoch tick marks ─────────────────────────────────────────────────────
  const TICKS = [
    { lt: -42,   de: 'GUT',      en: 'GUT'       },
    { lt: -35,   de: 'Infl.↑',   en: 'Infl.↑'    },
    { lt: -32,   de: '10⁻³²s',   en: '10⁻³²s'   },
    { lt: -6,    de: '1 μs',     en: '1 μs'      },
    { lt:  0,    de: '1 s',      en: '1 s'       },
    { lt: 13.08, de: '380 ka',   en: '380 kyr'   },
    { lt: 15.5,  de: '300 Myr',  en: '300 Myr'   },
  ];
  const fTick = Math.max(7, topRowH * 0.095);
  ctx.font = `${fTick}px system-ui, sans-serif`;

  for (const tk of TICKS) {
    const f = (tk.lt - T_START_LOG) / FULL_LOG_RANGE;
    if (f > progress + 0.002) continue;
    const tx = PAD_L + f * TW;
    const tr = tunnelNormRadius(f) * MAX_R;

    ctx.strokeStyle = 'rgba(70,105,160,0.35)';
    ctx.lineWidth   = 0.7;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(tx, CY - tr - 3);
    ctx.lineTo(tx, CY + tr + 3);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle   = 'rgba(85,120,175,0.70)';
    ctx.textAlign   = 'center';
    const label     = lang === 'en' ? tk.en : tk.de;
    const textY     = CY + tr + fTick * 1.55;
    if (textY < topRowH - 1) ctx.fillText(label, tx, textY);
  }

  // ── "Big Bang" label at left ──────────────────────────────────────────────
  if (progress > 0.005) {
    const bbFs = Math.max(7, topRowH * 0.10);
    ctx.font      = `600 ${bbFs}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(180,140,255,0.55)';
    ctx.textAlign = 'left';
    ctx.fillText(lang === 'en' ? 'Big Bang' : 'Urknall', PAD_L + 2, CY - bbFs * 1.2);
  }

  // ── "Today" label at right if near end ───────────────────────────────────
  if (progress > 0.94) {
    const todayFs = Math.max(7, topRowH * 0.10);
    const todayAlpha = Math.min(1, (progress - 0.94) / 0.06);
    ctx.font      = `600 ${todayFs}px system-ui, sans-serif`;
    ctx.fillStyle = `rgba(160,220,255,${0.65 * todayAlpha})`;
    ctx.textAlign = 'right';
    ctx.fillText(lang === 'en' ? 'Today' : 'Heute', PAD_L + TW - 4, CY + todayFs * 0.4);
  }

  // ── Row title ─────────────────────────────────────────────────────────────
  const titleFs = Math.max(7, topRowH * 0.092);
  ctx.font      = `700 ${titleFs}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(55,80,120,0.80)';
  ctx.textAlign = 'left';
  ctx.fillText(
    lang === 'en' ? 'COSMIC EXPANSION HISTORY' : 'KOSMISCHE EXPANSIONSGESCHICHTE',
    PAD_L, titleFs * 1.1
  );

  ctx.restore();
}

// ── Universumsinhalt ──────────────────────────────────────────────────────
function drawUniverseContent(uCX, uCY, uR, p) {
  ctx.save();
  ctx.beginPath(); ctx.arc(uCX, uCY, uR * 0.975, 0, Math.PI * 2); ctx.clip();
  const now = performance.now() * 0.001;
  const {planckF,gutF,inflF,qgpF,hadronF,plasmaF,darkF,starsF} = getEraFactors(p);

  // ── Planck era ────────────────────────────────────────────────────────────
  if (planckF > 0.01) {
    const fa = planckF;
    const bg = ctx.createRadialGradient(uCX,uCY,0,uCX,uCY,uR);
    bg.addColorStop(0,  `rgba(255,255,255,${0.45*fa})`);
    bg.addColorStop(0.25,`rgba(200,180,255,${0.30*fa})`);
    bg.addColorStop(0.6, `rgba(80,40,160,${0.20*fa})`);
    bg.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle=bg; ctx.fillRect(uCX-uR,uCY-uR,uR*2,uR*2);
    for (const q of PLANCK_FOAM) {
      const t  = now*q.speed+q.phase;
      const ang = q.a+t*0.3;
      const rad = q.f*uR*(0.5+0.5*Math.abs(Math.sin(t*1.7)));
      const qx = uCX+rad*Math.cos(ang), qy = uCY+rad*Math.sin(ang);
      const flicker = 0.4+0.6*Math.abs(Math.sin(t*4.3+q.phase));
      ctx.globalAlpha = fa*flicker*0.75;
      const sz  = q.size*(0.5+0.5*flicker);
      const hue = (t*80+q.phase*60)%360;
      ctx.fillStyle = `hsl(${hue},90%,88%)`;
      ctx.beginPath(); ctx.arc(qx,qy,sz,0,Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha=1;
    if (uR>18) {
      const gridN=6; ctx.strokeStyle=`rgba(200,160,255,${0.18*fa})`; ctx.lineWidth=0.8;
      for (let i=0;i<gridN;i++) {
        const y0=uCY-uR+(i+0.5)*(uR*2/gridN);
        ctx.beginPath();
        for (let xi=0;xi<=40;xi++) {
          const xr=uCX-uR+xi*(uR*2/40);
          const warp=Math.sin(xi*0.5+now*1.5+i)*uR*0.06*fa;
          if(xi===0) ctx.moveTo(xr,y0+warp); else ctx.lineTo(xr,y0+warp);
        }
        ctx.stroke();
      }
    }
  }

  // ── GUT era ───────────────────────────────────────────────────────────────
  if (gutF > 0.01) {
    const fa=gutF;
    const bg=ctx.createRadialGradient(uCX,uCY,0,uCX,uCY,uR);
    bg.addColorStop(0, `rgba(255,220,120,${0.22*fa})`);
    bg.addColorStop(0.4,`rgba(255,100,30,${0.14*fa})`);
    bg.addColorStop(0.8,`rgba(180,30,60,${0.08*fa})`);
    bg.addColorStop(1,  'rgba(0,0,0,0)');
    ctx.fillStyle=bg; ctx.fillRect(uCX-uR,uCY-uR,uR*2,uR*2);
    for (const q of GUT_PARTICLES) {
      const ang=q.a+now*(q.vx*60+0.5)+q.phase;
      const rad=q.f*uR*(0.65+0.35*Math.sin(now*1.2+q.phase));
      const qx=uCX+rad*Math.cos(ang), qy=uCY+rad*Math.sin(ang);
      ctx.globalAlpha=fa*0.55*gParticleDensity; ctx.fillStyle=q.col;
      ctx.beginPath(); ctx.arc(qx,qy,q.r,0,Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha=1;
    if (uR>15) {
      for (let i=0;i<16;i++) {
        const a=( i/16)*Math.PI*2+now*0.08;
        const r0=uR*0.05, r1=uR*(0.4+0.5*((i*3+2)%5)/5);
        const grd=ctx.createLinearGradient(uCX+r0*Math.cos(a),uCY+r0*Math.sin(a),uCX+r1*Math.cos(a),uCY+r1*Math.sin(a));
        grd.addColorStop(0,`rgba(255,255,200,${0.18*fa})`); grd.addColorStop(1,'rgba(255,100,50,0)');
        ctx.strokeStyle=grd; ctx.lineWidth=Math.max(0.5,uR*0.018);
        ctx.beginPath(); ctx.moveTo(uCX+r0*Math.cos(a),uCY+r0*Math.sin(a));
        ctx.lineTo(uCX+r1*Math.cos(a),uCY+r1*Math.sin(a)); ctx.stroke();
      }
    }
  }

  // ── Inflation era ─────────────────────────────────────────────────────────
  if (inflF > 0.01) {
    const p_infl = Math.max(0, (p - P_INFL_START) / (P_INFL_END - P_INFL_START));
    if (p_infl < 0.35) {
      const heat=Math.max(0,1-p_infl/0.35);
      const bg=ctx.createRadialGradient(uCX,uCY,0,uCX,uCY,uR);
      bg.addColorStop(0,`rgba(255,${Math.floor(200*heat+30)},${Math.floor(80*heat)},${(0.18*heat+0.02)*inflF})`);
      bg.addColorStop(0.6,`rgba(180,${Math.floor(100*heat)},${Math.floor(20*heat)},${0.10*heat*inflF})`);
      bg.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=bg; ctx.fillRect(uCX-uR,uCY-uR,uR*2,uR*2);
      const fadeIn=Math.min(1,p_infl/0.06), fadeOut=p_infl>0.22?Math.max(0,1-(p_infl-0.22)/0.13):1;
      const fa=fadeIn*fadeOut*inflF;
      if (fa>0.01) {
        for (const q of QGP_PARTICLES) {
          const ang=q.a+now*(q.vx*40+0.3);
          const rad=q.f*uR*(0.6+0.4*Math.sin(now*0.8+(q.p||0)));
          const qx=uCX+rad*Math.cos(ang), qy=uCY+rad*Math.sin(ang);
          ctx.globalAlpha=fa*(0.3+0.5*heat)*gParticleDensity;
          const r=q.r*(0.6+0.4*heat);
          if      (q.kind<0.33) ctx.fillStyle='#ff5540';
          else if (q.kind<0.55) ctx.fillStyle='#40dd55';
          else if (q.kind<0.72) ctx.fillStyle='#5566ff';
          else if (q.kind<0.88) ctx.fillStyle='#ffdd22';
          else                  ctx.fillStyle='#55ffee';
          ctx.beginPath(); ctx.arc(qx,qy,r,0,Math.PI*2); ctx.fill();
        }
        ctx.globalAlpha=1;
      }
      if (p_infl>0.12) {
        const hf=(p_infl-0.12)/0.23;
        for (let i=0;i<18;i++) {
          const a0=(i/18)*Math.PI*2+now*0.15, r0=uR*(0.1+0.8*(i%5)/5);
          const nx=uCX+r0*Math.cos(a0), ny=uCY+r0*Math.sin(a0);
          ctx.globalAlpha=hf*0.55*inflF*gParticleDensity;
          const ng=ctx.createRadialGradient(nx,ny,0,nx,ny,uR*0.055);
          ng.addColorStop(0,'rgba(255,200,160,0.8)'); ng.addColorStop(1,'rgba(180,80,40,0)');
          ctx.fillStyle=ng; ctx.beginPath(); ctx.arc(nx,ny,uR*0.055,0,Math.PI*2); ctx.fill();
          ctx.globalAlpha=1;
        }
      }
    } else if (p_infl < 0.65) {
      const fi=Math.min(1,(p_infl-0.35)/0.12)*inflF, fo=p_infl>0.55?Math.max(0,1-(p_infl-0.55)/0.10):1;
      const fa=fi*fo;
      if (fa>0.01) {
        const bg2=ctx.createRadialGradient(uCX,uCY,0,uCX,uCY,uR);
        bg2.addColorStop(0,`rgba(255,240,200,${0.12*fa})`);
        bg2.addColorStop(0.5,`rgba(220,180,255,${0.06*fa})`);
        bg2.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle=bg2; ctx.fillRect(uCX-uR,uCY-uR,uR*2,uR*2);
      }
      for (const ph of PHOTON_LINES) {
        const ang=ph.a+now*ph.speed*4;
        const r1=((ph.f0+now*ph.speed)%1.0)*uR;
        const r2=Math.min(r1+ph.len*uR,uR*0.97);
        ctx.globalAlpha=fa*0.22*gParticleDensity;
        ctx.strokeStyle=ph.speed>0.005?'#ffe8aa':'#ccccff';
        ctx.lineWidth=0.8;
        ctx.beginPath(); ctx.moveTo(uCX+r1*Math.cos(ang),uCY+r1*Math.sin(ang));
        ctx.lineTo(uCX+r2*Math.cos(ang),uCY+r2*Math.sin(ang)); ctx.stroke();
      }
      ctx.globalAlpha=1;
    } else {
      const fi=Math.min(1,(p_infl-0.65)/0.12)*inflF;
      const bg3=ctx.createRadialGradient(uCX,uCY,0,uCX,uCY,uR);
      bg3.addColorStop(0,`rgba(30,15,50,${0.25*fi})`);
      bg3.addColorStop(0.7,`rgba(15,8,30,${0.15*fi})`);
      bg3.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=bg3; ctx.fillRect(uCX-uR,uCY-uR,uR*2,uR*2);
      for (const c of CMB_CELLS) {
        const cx2=uCX+c.f*uR*Math.cos(c.a), cy2=uCY+c.f*uR*Math.sin(c.a);
        ctx.globalAlpha=fi*(c.warm?0.18:0.12)*gParticleDensity;
        const cg=ctx.createRadialGradient(cx2,cy2,0,cx2,cy2,c.r*uR*0.055);
        if (c.warm){cg.addColorStop(0,'rgba(255,160,80,0.9)');cg.addColorStop(1,'rgba(255,100,40,0)');}
        else       {cg.addColorStop(0,'rgba(80,130,255,0.9)'); cg.addColorStop(1,'rgba(40,80,220,0)');}
        ctx.fillStyle=cg; ctx.beginPath(); ctx.arc(cx2,cy2,c.r*uR*0.055,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=1;
    }
  }

  // ── QGP era ───────────────────────────────────────────────────────────────
  if (qgpF > 0.01) {
    const fa=qgpF;
    const bg=ctx.createRadialGradient(uCX,uCY,0,uCX,uCY,uR);
    bg.addColorStop(0, `rgba(255,120,40,${0.20*fa})`);
    bg.addColorStop(0.5,`rgba(200,40,10,${0.14*fa})`);
    bg.addColorStop(1,  'rgba(0,0,0,0)');
    ctx.fillStyle=bg; ctx.fillRect(uCX-uR,uCY-uR,uR*2,uR*2);
    for (const q of QGP_PARTICLES) {
      const ang=q.a+now*(q.vx*35+0.25);
      const rad=q.f*uR*(0.65+0.35*Math.sin(now*0.9+(q.p||0)));
      const qx=uCX+rad*Math.cos(ang), qy=uCY+rad*Math.sin(ang);
      ctx.globalAlpha=fa*0.50*gParticleDensity;
      if      (q.kind<0.33) ctx.fillStyle='#ff4422';
      else if (q.kind<0.55) ctx.fillStyle='#22cc44';
      else if (q.kind<0.72) ctx.fillStyle='#4455ee';
      else if (q.kind<0.88) ctx.fillStyle='#ffcc22';
      else                  ctx.fillStyle='#44eedd';
      ctx.beginPath(); ctx.arc(qx,qy,q.r,0,Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha=1;
  }

  // ── Hadron / BBN era ──────────────────────────────────────────────────────
  if (hadronF > 0.01) {
    const fa=hadronF;
    const bg=ctx.createRadialGradient(uCX,uCY,0,uCX,uCY,uR);
    bg.addColorStop(0, `rgba(255,180,80,${0.18*fa})`);
    bg.addColorStop(0.5,`rgba(200,80,20,${0.12*fa})`);
    bg.addColorStop(1,  'rgba(0,0,0,0)');
    ctx.fillStyle=bg; ctx.fillRect(uCX-uR,uCY-uR,uR*2,uR*2);
    for (const q of HADRON_PARTICLES) {
      const ang=q.a+now*(q.vx*25+0.15)+q.phase;
      const rad=q.f*uR*(0.55+0.45*Math.sin(now*0.7+q.phase));
      const qx=uCX+rad*Math.cos(ang), qy=uCY+rad*Math.sin(ang);
      ctx.globalAlpha=fa*0.45*gParticleDensity; ctx.fillStyle=q.col;
      ctx.beginPath(); ctx.arc(qx,qy,q.r,0,Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha=1;
    // Nuclear fusion glow jets
    if (uR>15) {
      for (let i=0;i<12;i++) {
        const a=(i/12)*Math.PI*2+now*0.06;
        const r1=uR*0.08, r2=uR*(0.35+0.45*((i*2+1)%5)/5);
        const grd=ctx.createLinearGradient(uCX+r1*Math.cos(a),uCY+r1*Math.sin(a),uCX+r2*Math.cos(a),uCY+r2*Math.sin(a));
        grd.addColorStop(0,`rgba(255,240,180,${0.22*fa})`); grd.addColorStop(1,'rgba(255,140,40,0)');
        ctx.strokeStyle=grd; ctx.lineWidth=Math.max(0.5,uR*0.02);
        ctx.beginPath(); ctx.moveTo(uCX+r1*Math.cos(a),uCY+r1*Math.sin(a));
        ctx.lineTo(uCX+r2*Math.cos(a),uCY+r2*Math.sin(a)); ctx.stroke();
      }
    }
  }

  // ── Photon plasma / CMB era ───────────────────────────────────────────────
  if (plasmaF > 0.01) {
    const fa=plasmaF;
    const bg=ctx.createRadialGradient(uCX,uCY,0,uCX,uCY,uR);
    bg.addColorStop(0, `rgba(255,200,160,${0.18*fa})`);
    bg.addColorStop(0.5,`rgba(200,80,100,${0.12*fa})`);
    bg.addColorStop(1,  'rgba(0,0,0,0)');
    ctx.fillStyle=bg; ctx.fillRect(uCX-uR,uCY-uR,uR*2,uR*2);
    for (const c of PLASMA_CELLS) {
      const cx2=uCX+c.f*uR*Math.cos(c.a+now*0.04);
      const cy2=uCY+c.f*uR*Math.sin(c.a+now*0.04);
      const pulse=0.6+0.4*Math.sin(now*1.8+c.phase);
      ctx.globalAlpha=fa*(c.warm?0.20:0.14)*pulse*gParticleDensity;
      const cg=ctx.createRadialGradient(cx2,cy2,0,cx2,cy2,c.r*uR*0.06);
      if (c.warm){cg.addColorStop(0,'rgba(255,200,120,0.9)');cg.addColorStop(1,'rgba(255,120,60,0)');}
      else       {cg.addColorStop(0,'rgba(180,100,255,0.9)');cg.addColorStop(1,'rgba(120,60,200,0)');}
      ctx.fillStyle=cg; ctx.beginPath(); ctx.arc(cx2,cy2,c.r*uR*0.06,0,Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha=1;
    // Photon lines radiating
    for (const ph of PHOTON_LINES) {
      const ang=ph.a+now*ph.speed*3;
      const r1=((ph.f0+now*ph.speed*0.5)%1.0)*uR;
      const r2=Math.min(r1+ph.len*uR*1.2,uR*0.97);
      ctx.globalAlpha=fa*0.18*gParticleDensity;
      ctx.strokeStyle='#ffddaa'; ctx.lineWidth=0.7;
      ctx.beginPath(); ctx.moveTo(uCX+r1*Math.cos(ang),uCY+r1*Math.sin(ang));
      ctx.lineTo(uCX+r2*Math.cos(ang),uCY+r2*Math.sin(ang)); ctx.stroke();
    }
    ctx.globalAlpha=1;
  }

  // ── Dark Ages ─────────────────────────────────────────────────────────────
  if (darkF > 0.01) {
    const fa=darkF;
    const bg=ctx.createRadialGradient(uCX,uCY,0,uCX,uCY,uR);
    bg.addColorStop(0,  `rgba(10,12,30,${0.35*fa})`);
    bg.addColorStop(0.7,`rgba(5,6,18,${0.25*fa})`);
    bg.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle=bg; ctx.fillRect(uCX-uR,uCY-uR,uR*2,uR*2);
    // Sparse neutral hydrogen glow (21cm equivalent)
    for (const d of DARK_PARTICLES) {
      const ang=d.a+performance.now()*0.0002+d.phase;
      const rad=d.f*uR*0.9;
      const dx=uCX+rad*Math.cos(ang), dy=uCY+rad*Math.sin(ang);
      ctx.globalAlpha=fa*0.12*gParticleDensity;
      ctx.fillStyle='rgba(140,160,220,0.7)';
      ctx.beginPath(); ctx.arc(dx,dy,d.r,0,Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha=1;
  }

  // ── Stars & Galaxies era ──────────────────────────────────────────────────
  if (starsF > 0.01) {
    const fa=starsF;
    const bg=ctx.createRadialGradient(uCX,uCY,0,uCX,uCY,uR);
    bg.addColorStop(0,  `rgba(8,12,28,${0.30*fa})`);
    bg.addColorStop(0.6,`rgba(4,6,18,${0.20*fa})`);
    bg.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle=bg; ctx.fillRect(uCX-uR,uCY-uR,uR*2,uR*2);
    // Stars
    for (const s of STAR_SEEDS) {
      const ang=s.a+s.phase*0.001;
      const rad=s.f*uR*0.9;
      const sx=uCX+rad*Math.cos(ang), sy=uCY+rad*Math.sin(ang);
      const flicker=0.5+0.5*Math.abs(Math.sin(now*(1.5+s.bright*2)+s.phase));
      ctx.globalAlpha=fa*flicker*(0.4+s.bright*0.5);
      const hue=200+s.bright*80;
      ctx.fillStyle=`hsl(${hue},75%,${75+s.bright*20}%)`;
      ctx.beginPath(); ctx.arc(sx,sy,s.size*(0.4+0.6*flicker),0,Math.PI*2); ctx.fill();
    }
    // Galaxy spirals
    for (const g of GALAXY_SEEDS) {
      const cx=uCX+g.f*uR*Math.cos(g.a), cy=uCY+g.f*uR*Math.sin(g.a);
      const gr=uR*(0.06+g.f*0.06);
      if (gr < 2) continue;
      ctx.globalAlpha=fa*0.28;
      for (let arm=0;arm<g.arms;arm++) {
        const aOff=arm*(Math.PI*2/g.arms);
        ctx.beginPath();
        for (let t=0;t<=1;t+=0.05) {
          const ra=gr*t, theta=aOff+t*Math.PI*1.8+now*g.spin+g.phase;
          const px=cx+ra*Math.cos(theta), py=cy+ra*Math.sin(theta);
          if (t===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
        }
        ctx.strokeStyle=`rgba(180,200,255,0.7)`;
        ctx.lineWidth=Math.max(0.4,gr*0.04);
        ctx.stroke();
      }
    }
    ctx.globalAlpha=1;
  }

  ctx.restore();
}

// ── Universumskreis ───────────────────────────────────────────────────────
function drawUniverse(l, p) {
  const {uCX,uCY,uR,ulf,topH,mainY0,leftColW} = l;
  const pFactor = Math.pow(10, LOG_RANGE * p);

  ctx.save();
  ctx.beginPath(); ctx.rect(0,mainY0,leftColW,topH); ctx.clip();

  drawUniverseContent(uCX,uCY,uR,p);

  const ef = getEraFactors(p);

  // Era name label
  const eraName = getEraName(p);
  if (eraName) {
    const eraCol = getEraLabelColor(p);
    ctx.save();
    ctx.globalAlpha=0.62;
    ctx.font=`italic ${Math.max(10,uR*0.095)}px system-ui,sans-serif`;
    ctx.fillStyle=eraCol; ctx.textAlign='center';
    ctx.shadowColor='rgba(0,0,0,0.8)'; ctx.shadowBlur=8;
    ctx.fillText(eraName, uCX, uCY+uR*0.22);
    ctx.restore();
  }

  // Universe circle with fluctuations during inflation
  const showFluctNow = inflF(p) > 0.1;
  const STEPS=500;
  ctx.beginPath();
  for (let i=0;i<=STEPS;i++) {
    const th=(i/STEPS)*Math.PI*2;
    let r=uR;
    if (showFluctNow) {
      const physAmp=uR*0.022;
      const scaledAmp=physAmp/Math.pow(pFactor,0.88);
      const cAmp=Math.min(scaledAmp,uR*0.045);
      for (const f of FLUCT) r+=f.a*cAmp*Math.sin(f.f*th+f.p);
    }
    r=Math.max(1,r);
    const x=uCX+r*Math.cos(th), y=uCY+r*Math.sin(th);
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.closePath();

  // Circle color based on era
  let circleCol, glowCol;
  const {planckF,gutF,qgpF,hadronF,plasmaF,darkF,starsF} = ef;
  const iF = inflF(p);
  if (planckF>0.1) {
    circleCol=`rgba(${Math.floor(200*planckF+50)},${Math.floor(180*planckF+25)},255,${0.85*planckF+0.05})`;
    glowCol=`rgba(180,150,255,${0.55*planckF})`;
  } else if (gutF>0.1) {
    circleCol=`rgba(255,${Math.floor(200*gutF+55)},${Math.floor(80*gutF+20)},${0.85*gutF+0.05})`;
    glowCol=`rgba(255,180,60,${0.55*gutF})`;
  } else if (iF>0.1) {
    circleCol=`rgba(80,150,255,${0.85*iF+0.05})`;
    glowCol=`rgba(80,150,255,${0.55*iF})`;
  } else if (qgpF>0.1) {
    circleCol=`rgba(255,${Math.floor(100*qgpF+20)},20,${0.85*qgpF+0.05})`;
    glowCol=`rgba(255,80,20,${0.55*qgpF})`;
  } else if (hadronF>0.1) {
    circleCol=`rgba(255,${Math.floor(160*hadronF+40)},30,${0.85*hadronF+0.05})`;
    glowCol=`rgba(255,160,40,${0.55*hadronF})`;
  } else if (plasmaF>0.1) {
    circleCol=`rgba(255,${Math.floor(140*plasmaF+60)},${Math.floor(100*plasmaF+30)},${0.85*plasmaF+0.05})`;
    glowCol=`rgba(255,140,80,${0.55*plasmaF})`;
  } else {
    circleCol='rgba(150,205,248,0.90)';
    glowCol='rgba(110,185,245,0.55)';
  }

  ctx.save(); ctx.filter='blur(6px)';
  ctx.strokeStyle='rgba(130,195,255,0.10)'; ctx.lineWidth=12; ctx.stroke();
  ctx.filter='none'; ctx.restore();
  glow(glowCol,9); ctx.strokeStyle=circleCol; ctx.lineWidth=1.5; ctx.stroke(); noGlow();

  ctx.font=`bold ${ulf*1.1}px system-ui,sans-serif`; ctx.textAlign='center';
  glow('rgba(0,0,0,0.9)',10);
  ctx.fillStyle='rgba(165,210,240,0.92)';
  ctx.fillText(lang==='en'?'Universe':'Universum', uCX, uCY+uR+ulf*1.7);
  noGlow();

  const expU=Math.log10(univPhys(p)).toFixed(1);
  const sizeStr='r ≈ 10'+toSup(parseFloat(expU))+' m';
  const sizeFontSize=Math.max(13,uR*0.115);
  ctx.font=`bold ${sizeFontSize}px system-ui,sans-serif`;
  glow('rgba(100,200,255,0.55)',14);
  ctx.fillStyle='rgba(140,210,255,0.96)';
  ctx.fillText(sizeStr, uCX, uCY-uR-sizeFontSize*0.55);
  noGlow();

  ctx.restore();
}

function inflF(p) {
  const FADE=0.010;
  if (p<=P_INFL_START-FADE) return 0;
  if (p< P_INFL_START+FADE) return (p-(P_INFL_START-FADE))/(2*FADE);
  if (p<=P_INFL_END-FADE)   return 1;
  if (p< P_INFL_END+FADE)   return ((P_INFL_END+FADE)-p)/(2*FADE);
  return 0;
}

function getEraName(p) {
  const ef=getEraFactors(p);
  if (ef.planckF>0.5) return lang==='en'?'Planck Era':'Planck-Ära';
  if (ef.gutF>0.5)    return lang==='en'?'GUT Era':'GUT-Ära';
  if (inflF(p)>0.5)   return lang==='en'?'Inflation':'Inflation';
  if (ef.qgpF>0.5)    return lang==='en'?'Quark-Gluon Plasma':'Quark-Gluon-Plasma';
  if (ef.hadronF>0.5) return lang==='en'?'Nucleosynthesis':'Nukleosynthese';
  if (ef.plasmaF>0.5) return lang==='en'?'Photon Plasma':'Photonenplasma';
  if (ef.darkF>0.5)   return lang==='en'?'Dark Ages':'Dunkle Zeit';
  if (ef.starsF>0.5)  return lang==='en'?'Stars & Galaxies':'Sterne & Galaxien';
  return '';
}

function getEraLabelColor(p) {
  const ef=getEraFactors(p);
  if (ef.planckF>0.3)  return 'rgba(220,200,255,0.90)';
  if (ef.gutF>0.3)     return 'rgba(255,200,120,0.90)';
  if (inflF(p)>0.3)    return 'rgba(160,200,255,0.90)';
  if (ef.qgpF>0.3)     return 'rgba(255,150,100,0.90)';
  if (ef.hadronF>0.3)  return 'rgba(255,200,100,0.90)';
  if (ef.plasmaF>0.3)  return 'rgba(255,180,160,0.90)';
  if (ef.darkF>0.3)    return 'rgba(140,160,200,0.90)';
  return 'rgba(180,220,255,0.90)';
}

// ── Referenzobjekt ────────────────────────────────────────────────────────
function drawReference(l, p) {
  const {rCX,rCY,rMaxR,midW,topH,mainY0,divX,leftColW} = l;
  const uPhys = univPhys(p);
  const mpp   = uPhys / (l.uR);

  const blends = compBlend(uPhys);

  ctx.save();
  ctx.beginPath(); ctx.rect(divX+4, mainY0, midW-divX-4, topH); ctx.clip();

  for (const comp of blends) {
    const compPxR = (comp.size * 0.5) / mpp;
    const slightOverflow = compPxR > rMaxR * 1.04 && compPxR <= rMaxR * 3;
    const massiveOverflow= compPxR > rMaxR * 3;
    const dispR = Math.min(Math.max(compPxR, 1.5), rMaxR);

    ctx.save();
    ctx.globalAlpha = comp.alpha;

    if (compPxR < 2.5) {
      ctx.beginPath(); ctx.arc(rCX,rCY,Math.max(1.5,compPxR),0,Math.PI*2);
      ctx.fillStyle=comp.col; ctx.fill();
      ctx.beginPath(); ctx.arc(rCX,rCY,8,0,Math.PI*2);
      ctx.strokeStyle=comp.col+'55';
      ctx.lineWidth=1; ctx.setLineDash([2,3]); ctx.stroke(); ctx.setLineDash([]);
    } else {
      ctx.save();
      ctx.beginPath(); ctx.arc(rCX,rCY,rMaxR*1.02,0,Math.PI*2); ctx.clip();
      drawIcon(comp.key, rCX, rCY, dispR, comp.col, slightOverflow && !massiveOverflow);
      ctx.restore();
      if (slightOverflow && !massiveOverflow) drawClipIndicator(rCX, rCY, rMaxR);
    }

    const rf1  = Math.max(16, rMaxR*0.130);
    const rf2  = Math.max(13, rMaxR*0.108);
    const rf3  = Math.max(14, rMaxR*0.115);
    const visR = Math.min(dispR, rMaxR);
    const top  = rCY - visR;

    ctx.textAlign='center';

    ctx.font=`bold ${rf1}px system-ui,sans-serif`;
    glow('rgba(0,0,0,1)', 12);
    ctx.fillStyle=comp.col;
    ctx.fillText(lang==='de'?comp.de:comp.en, rCX, top - rf1*1.25);
    noGlow();

    ctx.font=`${rf2}px 'Courier New',monospace`;
    glow('rgba(0,0,0,0.95)', 8);
    ctx.fillStyle='rgba(200,225,255,0.92)';
    ctx.fillText(fmtPhysShort(comp.size), rCX, top - rf2*0.15);
    noGlow();

    ctx.font=`bold ${rf3}px system-ui,sans-serif`;
    glow('rgba(0,0,0,0.9)', 10);
    ctx.fillStyle='rgba(145,195,235,0.95)';
    ctx.fillText(fmtRatio(uPhys/comp.size), rCX, rCY + visR + rf3*1.85);
    noGlow();

    ctx.restore();
  }

  ctx.restore();
}

function drawClipIndicator(cx,cy,maxR) {
  for (let i=0;i<8;i++) {
    const a=(i/8)*Math.PI*2;
    ctx.save(); ctx.translate(cx+maxR*Math.cos(a),cy+maxR*Math.sin(a)); ctx.rotate(a);
    ctx.fillStyle='rgba(175,198,220,0.38)';
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-6,-3); ctx.lineTo(-6,3); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

// ── Reference object artwork ───────────────────────────────────────────────
function drawIcon(key,cx,cy,r,col,cl) {
  switch(key) {
    case 'planck':    drawPlanck(cx,cy,r,cl);    break;
    case 'preon':     drawProon(cx,cy,r,cl);     break;
    case 'quark':     drawQuark(cx,cy,r,cl);     break;
    case 'proton':    drawProton(cx,cy,r,cl);    break;
    case 'electron':  drawElectron(cx,cy,r,cl);  break;
    case 'nucleus':   drawNucleus(cx,cy,r,cl);   break;
    case 'atom':      drawAtom(cx,cy,r,cl);      break;
    case 'bacterium': drawBacterium(cx,cy,r,cl); break;
    case 'human':     drawHuman(cx,cy,r,cl);     break;
    case 'earth':     drawEarth(cx,cy,r,cl);     break;
    case 'solar':     drawSolar(cx,cy,r,cl);     break;
    case 'milkyway':  drawGalaxy(cx,cy,r,cl);    break;
  }
}

function drawPlanck(cx,cy,r,cl) {
  // Quantum foam: chaotic spacetime fluctuations
  const g=ctx.createRadialGradient(cx,cy,0,cx,cy,r);
  g.addColorStop(0,'rgba(255,255,255,0.70)');
  g.addColorStop(0.25,'rgba(200,220,255,0.40)');
  g.addColorStop(0.65,'rgba(120,160,255,0.18)');
  g.addColorStop(1,'rgba(60,80,200,0)');
  ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
  if(r>8&&!cl){
    // Foam loops — chaotic micro-geometry
    const seed=42;
    for(let i=0;i<12;i++){
      const a=(i/12)*Math.PI*2;
      const fr=r*(0.30+0.38*Math.abs(Math.sin(i*2.3+1)));
      const fx=cx+fr*Math.cos(a), fy=cy+fr*Math.sin(a);
      const lr=Math.max(2,r*(0.06+0.07*Math.abs(Math.cos(i*1.7))));
      ctx.beginPath(); ctx.arc(fx,fy,lr,0,Math.PI*2);
      ctx.strokeStyle=`rgba(160,200,255,${0.12+0.12*Math.abs(Math.sin(i))})`;
      ctx.lineWidth=0.8; ctx.stroke();
    }
  }
  // Bright singularity core
  const core=ctx.createRadialGradient(cx,cy,0,cx,cy,r*0.12);
  core.addColorStop(0,'rgba(255,255,255,1.0)');
  core.addColorStop(0.5,'rgba(200,215,255,0.80)');
  core.addColorStop(1,'rgba(140,170,255,0)');
  ctx.fillStyle=core; ctx.beginPath(); ctx.arc(cx,cy,r*0.12,0,Math.PI*2); ctx.fill();
  if(!cl){
    ctx.beginPath(); ctx.arc(cx,cy,r*0.82,0,Math.PI*2);
    ctx.strokeStyle='rgba(160,190,255,0.22)';
    ctx.lineWidth=Math.max(0.5,r*0.03);
    ctx.setLineDash([1,6]); ctx.stroke(); ctx.setLineDash([]);
  }
}

function drawProon(cx,cy,r,cl) {
  // Preon: theoretical sub-quark — shown as speculative/dashed
  const g=ctx.createRadialGradient(cx,cy,0,cx,cy,r);
  g.addColorStop(0,'rgba(255,160,255,0.50)');
  g.addColorStop(0.5,'rgba(210,80,230,0.22)');
  g.addColorStop(1,'rgba(150,20,200,0)');
  ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
  const core=ctx.createRadialGradient(cx,cy,0,cx,cy,r*0.14);
  core.addColorStop(0,'rgba(255,255,255,0.96)');
  core.addColorStop(1,'rgba(240,120,255,0.25)');
  ctx.fillStyle=core; ctx.beginPath(); ctx.arc(cx,cy,r*0.14,0,Math.PI*2); ctx.fill();
  if(r<5) return;
  // Dashed outer ring — theoretical/unconfirmed
  ctx.beginPath(); ctx.arc(cx,cy,r*0.80,0,Math.PI*2);
  ctx.strokeStyle='rgba(220,100,255,0.35)';
  ctx.lineWidth=Math.max(0.6,r*0.035);
  ctx.setLineDash([3,5]); ctx.stroke(); ctx.setLineDash([]);
  // Question-mark uncertainty lines
  if(r>20&&!cl){
    for(let i=0;i<6;i++){
      const a=(i/6)*Math.PI*2;
      const x1=cx+r*0.45*Math.cos(a), y1=cy+r*0.45*Math.sin(a);
      const x2=cx+r*0.82*Math.cos(a), y2=cy+r*0.82*Math.sin(a);
      ctx.strokeStyle='rgba(220,100,255,0.12)'; ctx.lineWidth=0.7;
      ctx.setLineDash([2,4]);
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function drawQuark(cx,cy,r,cl) {
  // Single quark: one color charge — smooth glowing sphere
  const g=ctx.createRadialGradient(cx-r*0.25,cy-r*0.25,r*0.02,cx,cy,r);
  g.addColorStop(0,'rgba(240,160,255,0.45)');
  g.addColorStop(0.50,'rgba(180,55,220,0.28)');
  g.addColorStop(1,'rgba(100,10,180,0)');
  ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
  // Color-charge surface sheen
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
  ctx.strokeStyle='rgba(200,90,255,0.40)';
  ctx.lineWidth=Math.max(0.8,r*0.05);
  if(cl){ctx.setLineDash([3,4]);} ctx.stroke(); ctx.setLineDash([]);
  // Bright core highlight
  const core=ctx.createRadialGradient(cx-r*0.28,cy-r*0.28,0,cx,cy,r*0.45);
  core.addColorStop(0,'rgba(255,255,255,0.85)');
  core.addColorStop(0.5,'rgba(230,150,255,0.40)');
  core.addColorStop(1,'rgba(180,60,240,0)');
  ctx.fillStyle=core; ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
  if(r<7) return;
  // Gluon field: soft radial streaks
  if(!cl){
    for(let i=0;i<6;i++){
      const a=(i/6)*Math.PI*2;
      ctx.strokeStyle=`rgba(200,80,255,${0.08+0.06*Math.abs(Math.sin(i*1.3))})`;
      ctx.lineWidth=Math.max(0.5,r*0.04);
      ctx.beginPath();
      ctx.moveTo(cx+r*0.15*Math.cos(a),cy+r*0.15*Math.sin(a));
      ctx.lineTo(cx+r*0.88*Math.cos(a),cy+r*0.88*Math.sin(a));
      ctx.stroke();
    }
  }
}

function drawElectron(cx,cy,r,cl) {
  const g=ctx.createRadialGradient(cx,cy,0,cx,cy,r);
  g.addColorStop(0,'rgba(70,195,255,0.50)');
  g.addColorStop(0.5,'rgba(35,140,220,0.22)');
  g.addColorStop(1,'rgba(15,70,180,0)');
  ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
  const core=ctx.createRadialGradient(cx-r*0.05,cy-r*0.05,0,cx,cy,r*0.13);
  core.addColorStop(0,'rgba(255,255,255,0.98)');
  core.addColorStop(0.6,'rgba(100,215,255,0.70)');
  core.addColorStop(1,'rgba(30,130,220,0)');
  ctx.fillStyle=core; ctx.beginPath(); ctx.arc(cx,cy,r*0.13,0,Math.PI*2); ctx.fill();
  if(r<7||cl) return;
  ctx.beginPath(); ctx.ellipse(cx,cy,r*0.72,r*0.40,-Math.PI/5,0,Math.PI*2);
  ctx.strokeStyle='rgba(75,175,245,0.32)';
  ctx.lineWidth=Math.max(0.5,r*0.03); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(cx,cy,r*0.40,r*0.72,Math.PI/5,0,Math.PI*2);
  ctx.strokeStyle='rgba(75,175,245,0.26)';
  ctx.lineWidth=Math.max(0.5,r*0.03); ctx.stroke();
}

function drawProton(cx,cy,r,cl) {
  const g=ctx.createRadialGradient(cx-r*.32,cy-r*.32,r*.04,cx,cy,r);
  g.addColorStop(0,'rgba(255,200,180,.22)');
  g.addColorStop(.55,'rgba(210,110,80,.10)');
  g.addColorStop(1,'rgba(180,60,40,0)');
  ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
  ctx.strokeStyle='rgba(210,130,105,.50)'; ctx.lineWidth=Math.max(.7,r*.055);
  if(cl){ctx.setLineDash([3,4]);} ctx.stroke(); ctx.setLineDash([]);
  if(r<5) return;
  const qC=['#f03030','#30cc30','#3050f0'];
  const qr=Math.max(2.5,r*.26);
  for(let i=0;i<3;i++){
    const a=(i/3)*Math.PI*2-Math.PI/2;
    const qx=cx+r*.50*Math.cos(a), qy=cy+r*.50*Math.sin(a);
    if(r>12&&!cl){
      ctx.strokeStyle='rgba(255,255,255,.10)'; ctx.lineWidth=.8;
      ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(qx,qy); ctx.stroke();
    }
    const qg=ctx.createRadialGradient(qx-qr*.28,qy-qr*.28,0,qx,qy,qr);
    qg.addColorStop(0,'rgba(255,255,255,.50)'); qg.addColorStop(1,qC[i]);
    ctx.fillStyle=(qr>3&&!cl)?qg:qC[i];
    ctx.beginPath(); ctx.arc(qx,qy,qr,0,Math.PI*2); ctx.fill();
  }
}

function drawNucleus(cx,cy,r,cl) {
  const pos=[
    [0,0],[.42,0],[-.42,0],[0,.42],[0,-.42],
    [.30,.30],[-.30,.30],[.30,-.30],[-.30,-.30],
    [.60,.10],[-.60,-.10],[.10,.60],[-.10,-.60],
  ];
  const nr=Math.max(2,r*.27);
  for(let i=0;i<pos.length;i++){
    const[dx,dy]=pos[i];
    const nx=cx+dx*r*.72, ny=cy+dy*r*.72, isP=i%2===0;
    const ng=ctx.createRadialGradient(nx-nr*.3,ny-nr*.3,0,nx,ny,nr);
    ng.addColorStop(0,isP?'#ffbbaa':'#aac0ff');
    ng.addColorStop(1,isP?'#aa3320':'#2244aa');
    ctx.fillStyle=(nr>3&&!cl)?ng:(isP?'#bb4433':'#3355bb');
    ctx.beginPath(); ctx.arc(nx,ny,nr,0,Math.PI*2); ctx.fill();
  }
}

function drawAtom(cx,cy,r,cl) {
  if(r>12&&!cl){
    const wg=ctx.createRadialGradient(cx,cy,0,cx,cy,r);
    wg.addColorStop(0,'rgba(60,110,200,0)');
    wg.addColorStop(.55,'rgba(60,110,200,.09)');
    wg.addColorStop(.85,'rgba(80,130,220,.05)');
    wg.addColorStop(1,'rgba(80,130,220,0)');
    ctx.fillStyle=wg; ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
  }
  const nR=Math.max(2,r*.082);
  const ng=ctx.createRadialGradient(cx-nR*.3,cy-nR*.3,0,cx,cy,nR*1.4);
  ng.addColorStop(0,'#fff0b0'); ng.addColorStop(1,'#cc5500');
  ctx.fillStyle=(nR>3&&!cl)?ng:'#dd7700';
  ctx.beginPath(); ctx.arc(cx,cy,nR,0,Math.PI*2); ctx.fill();
  for(let i=0;i<3;i++){
    ctx.save(); ctx.translate(cx,cy); ctx.rotate(i*Math.PI/3);
    const oa=r*.90, ob=r*.30;
    ctx.beginPath(); ctx.ellipse(0,0,oa,ob,0,0,Math.PI*2);
    ctx.strokeStyle=`rgba(100,155,238,${i===0?.65:.30})`;
    ctx.lineWidth=Math.max(.7,r*.020);
    if(cl)ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([]);
    const ea=(i*1.1+1.0), eR=Math.max(1.5,r*.058);
    ctx.beginPath(); ctx.arc(oa*Math.cos(ea),ob*Math.sin(ea),eR,0,Math.PI*2);
    ctx.fillStyle='#a0ccee'; ctx.fill();
    ctx.restore();
  }
}

function drawBacterium(cx,cy,r,cl) {
  ctx.save(); ctx.translate(cx,cy); ctx.rotate(-.22);
  const h=r, w=r*.40;
  ctx.save();
  ctx.beginPath(); ctx.ellipse(0,0,w*1.01,h*1.01,0,0,Math.PI*2); ctx.clip();
  const bg=ctx.createRadialGradient(0,0,0,0,0,r*.9);
  bg.addColorStop(0,'rgba(100,205,115,.48)'); bg.addColorStop(1,'rgba(25,105,45,.08)');
  ctx.fillStyle=bg; ctx.beginPath(); ctx.ellipse(0,0,w,h,0,0,Math.PI*2); ctx.fill();
  ctx.restore();
  if(cl) ctx.setLineDash([3,4]);
  ctx.beginPath(); ctx.ellipse(0,0,w,h,0,0,Math.PI*2);
  ctx.strokeStyle='rgba(75,178,92,.88)'; ctx.lineWidth=Math.max(.8,r*.048);
  ctx.stroke(); ctx.setLineDash([]);
  if(r>20){
    ctx.beginPath(); ctx.ellipse(0,0,w*.88,h*.88,0,0,Math.PI*2);
    ctx.strokeStyle='rgba(60,150,78,.25)'; ctx.lineWidth=Math.max(.5,r*.025); ctx.stroke();
  }
  if(r>16){
    ctx.beginPath(); ctx.ellipse(0,0,w*.45,h*.30,0.4,0,Math.PI*2);
    ctx.strokeStyle='rgba(200,240,200,.40)'; ctx.lineWidth=1.1; ctx.stroke();
  }
  if(r>18){
    ctx.fillStyle='rgba(160,228,170,.55)';
    for(let i=0;i<14;i++){
      const a=i*.45, rr=.28+.28*(i%3)*.5;
      ctx.beginPath(); ctx.arc(w*rr*Math.cos(a)*.88,h*rr*Math.sin(a)*.65,1.1,0,Math.PI*2); ctx.fill();
    }
  }
  if(r>14){
    ctx.strokeStyle='rgba(70,168,88,.38)'; ctx.lineWidth=Math.max(.5,r*.022);
    for(let i=0;i<6;i++){
      const a=(i/6)*Math.PI*2-.5;
      const px=w*Math.cos(a), py=h*Math.sin(a);
      ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(px*1.18,py*1.18); ctx.stroke();
    }
  }
  if(r>12 && !cl){
    ctx.beginPath(); ctx.moveTo(0,h);
    ctx.bezierCurveTo(w*.65,h*1.22,w*.92,h*1.52,w*.48,h*1.88);
    ctx.bezierCurveTo(w*.18,h*2.12,-w*.32,h*2.02,-w*.18,h*2.45);
    ctx.strokeStyle='rgba(65,168,85,.42)'; ctx.lineWidth=Math.max(.6,r*.026); ctx.stroke();
  }
  ctx.restore();
}

function drawHuman(cx,cy,r,cl) {
  const h=r*2.4, lw=Math.max(1,h*.024);
  ctx.save();
  ctx.lineCap='round'; ctx.lineJoin='round'; ctx.lineWidth=lw;
  if(cl) ctx.setLineDash([3,4]);
  const top=cy-h*.50;
  const hR=h*.100;
  ctx.strokeStyle='rgba(205,178,138,.92)';
  ctx.beginPath(); ctx.ellipse(cx,top+hR*.98,hR*.88,hR,0,0,Math.PI*2);
  ctx.fillStyle='rgba(195,165,130,.09)'; ctx.fill(); ctx.stroke();
  ctx.strokeStyle='rgba(195,168,130,.80)';
  ctx.beginPath();
  ctx.moveTo(cx-hR*.28,top+hR*1.85); ctx.lineTo(cx-hR*.22,top+hR*2.20);
  ctx.moveTo(cx+hR*.28,top+hR*1.85); ctx.lineTo(cx+hR*.22,top+hR*2.20);
  ctx.stroke();
  ctx.strokeStyle='rgba(200,172,135,.88)';
  const sh=top+h*.230;
  ctx.beginPath();
  ctx.moveTo(cx-h*.195,sh+h*.025);
  ctx.bezierCurveTo(cx-h*.135,sh-h*.005,cx-h*.050,top+hR*2.22,cx,top+hR*2.22);
  ctx.bezierCurveTo(cx+h*.050,top+hR*2.22,cx+h*.135,sh-h*.005,cx+h*.195,sh+h*.025);
  ctx.stroke();
  const tw=h*.138, tw2=h*.108;
  ctx.beginPath();
  ctx.moveTo(cx-tw,sh);
  ctx.bezierCurveTo(cx-tw*.92,sh+h*.15,cx-tw2*.95,sh+h*.28,cx-tw2,sh+h*.365);
  ctx.lineTo(cx-tw2*.70,sh+h*.378); ctx.lineTo(cx-tw2*.88,top+h*.578);
  ctx.lineTo(cx+tw2*.88,top+h*.578); ctx.lineTo(cx+tw2*.70,sh+h*.378);
  ctx.lineTo(cx+tw2,sh+h*.365);
  ctx.bezierCurveTo(cx+tw2*.95,sh+h*.28,cx+tw*.92,sh+h*.15,cx+tw,sh);
  ctx.closePath();
  ctx.fillStyle='rgba(195,165,130,.10)'; ctx.fill(); ctx.stroke();
  if(h>120&&!cl){
    ctx.strokeStyle='rgba(190,160,125,.18)'; ctx.lineWidth=lw*.5;
    for(let i=0;i<3;i++){
      const ry=sh+h*(.055+i*.062);
      ctx.beginPath(); ctx.moveTo(cx-tw*.55,ry); ctx.lineTo(cx,ry+h*.008); ctx.lineTo(cx+tw*.55,ry); ctx.stroke();
    }
    ctx.lineWidth=lw;
  }
  ctx.strokeStyle='rgba(200,172,135,.88)';
  ctx.beginPath();
  ctx.moveTo(cx-tw+lw,sh+h*.022);
  ctx.bezierCurveTo(cx-tw*1.38,sh+h*.18,cx-h*.188,sh+h*.28,cx-h*.175,sh+h*.388);
  ctx.bezierCurveTo(cx-h*.162,sh+h*.46,cx-h*.148,sh+h*.52,cx-h*.155,sh+h*.610);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx+tw-lw,sh+h*.022);
  ctx.bezierCurveTo(cx+tw*1.38,sh+h*.18,cx+h*.188,sh+h*.28,cx+h*.175,sh+h*.388);
  ctx.bezierCurveTo(cx+h*.162,sh+h*.46,ctx+h*.148,sh+h*.52,cx+h*.155,sh+h*.610);
  ctx.stroke();
  if(h>100&&!cl){
    ctx.fillStyle='rgba(200,172,135,.55)';
    ctx.beginPath(); ctx.ellipse(cx-h*.160,sh+h*.632,h*.028,h*.022,-.3,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx+h*.160,sh+h*.632,h*.028,h*.022, .3,0,Math.PI*2); ctx.fill();
  }
  ctx.strokeStyle='rgba(195,165,130,.80)';
  ctx.beginPath();
  ctx.moveTo(cx-tw2*.88,top+h*.578);
  ctx.bezierCurveTo(cx-tw2*.98,top+h*.608,cx-tw2*.68,top+h*.628,cx-tw2*.40,top+h*.622);
  ctx.bezierCurveTo(cx-tw2*.18,top+h*.618,cx,top+h*.610,cx,top+h*.610);
  ctx.bezierCurveTo(cx,top+h*.610,cx+tw2*.18,top+h*.618,cx+tw2*.40,top+h*.622);
  ctx.bezierCurveTo(cx+tw2*.68,top+h*.628,cx+tw2*.98,top+h*.608,cx+tw2*.88,top+h*.578);
  ctx.stroke();
  ctx.strokeStyle='rgba(200,172,135,.88)';
  ctx.beginPath();
  ctx.moveTo(cx-h*.052,top+h*.622);
  ctx.bezierCurveTo(cx-h*.080,top+h*.72,cx-h*.095,top+h*.80,cx-h*.092,top+h*.870);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx+h*.052,top+h*.622);
  ctx.bezierCurveTo(cx+h*.080,top+h*.72,cx+h*.095,top+h*.80,cx+h*.092,top+h*.870);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx-h*.092,top+h*.870);
  ctx.bezierCurveTo(cx-h*.098,top+h*.930,cx-h*.100,top+h*.975,cx-h*.096,top+h*1.000);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx+h*.092,top+h*.870);
  ctx.bezierCurveTo(cx+h*.098,top+h*.930,cx+h*.100,top+h*.975,cx+h*.096,top+h*1.000);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

const CONTS=[
  {dx:-.22,dy:-.10,rx:.26,ry:.38,rot: .14,c0:'#55a848',c1:'#1e4818'},
  {dx: .20,dy:-.04,rx:.19,ry:.32,rot:-.05,c0:'#5aaa50',c1:'#1e4818'},
  {dx: .44,dy: .05,rx:.25,ry:.21,rot: .20,c0:'#58a848',c1:'#1a4015'},
  {dx: .34,dy: .43,rx:.15,ry:.098,rot:.09,c0:'#72b860',c1:'#2a5818'},
  {dx:-.03,dy: .64,rx:.22,ry:.098,rot: 0, c0:'#e8f0ff',c1:'#c0d8ff'},
];
const CLOUDS=[
  {a:.35,f:.55,w:.18,h:.06,rot:.10},{a:1.80,f:.62,w:.22,h:.07,rot:-.08},
  {a:2.90,f:.42,w:.16,h:.05,rot:.20},{a:4.10,f:.70,w:.24,h:.065,rot:-.15},
  {a:5.30,f:.50,w:.15,h:.055,rot:.05},{a:.90,f:.78,w:.20,h:.060,rot:.12},
];
function drawEarth(cx,cy,r,cl) {
  const og=ctx.createRadialGradient(cx-r*.28,cy-r*.28,r*.04,cx,cy,r);
  og.addColorStop(0,'#78ccf5'); og.addColorStop(.30,'#1e78d0'); og.addColorStop(1,'#061a5a');
  ctx.fillStyle=og; ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
  if(r<6){ ctx.strokeStyle='rgba(80,165,245,.5)'; ctx.lineWidth=1.0; ctx.stroke(); return; }
  ctx.save(); ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.clip();
  for(const c of CONTS){
    ctx.save(); ctx.translate(cx+c.dx*r,cy+c.dy*r); ctx.rotate(c.rot);
    const cg=ctx.createRadialGradient(-c.rx*r*.25,-c.ry*r*.15,0,0,0,c.rx*r*1.1);
    cg.addColorStop(0,c.c0); cg.addColorStop(.6,c.c1); cg.addColorStop(1,c.c1+'88');
    ctx.fillStyle=cg; ctx.beginPath(); ctx.ellipse(0,0,c.rx*r,c.ry*r,0,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle='rgba(230,245,255,.65)';
  ctx.beginPath(); ctx.ellipse(cx,cy-r*.86,r*.30,r*.135,0,0,Math.PI*2); ctx.fill();
  if(r>30){
    const now2=performance.now()*0.00008;
    for(const cl2 of CLOUDS){
      const a=cl2.a+now2;
      const wx=cx+cl2.f*r*Math.cos(a), wy=cy+cl2.f*r*Math.sin(a);
      ctx.save(); ctx.translate(wx,wy); ctx.rotate(cl2.rot);
      const wcg=ctx.createRadialGradient(0,0,0,0,0,cl2.w*r);
      wcg.addColorStop(0,'rgba(255,255,255,.82)'); wcg.addColorStop(.5,'rgba(240,245,255,.55)'); wcg.addColorStop(1,'rgba(255,255,255,0)');
      ctx.fillStyle=wcg; ctx.beginPath(); ctx.ellipse(0,0,cl2.w*r,cl2.h*r,0,0,Math.PI*2); ctx.fill();
      ctx.restore();
    }
  }
  if(r>20){
    const tg=ctx.createLinearGradient(cx-r*.4,cy,cx+r*.4,cy);
    tg.addColorStop(0,'rgba(0,0,20,.42)'); tg.addColorStop(.35,'rgba(0,0,10,.18)'); tg.addColorStop(.55,'rgba(0,0,0,0)');
    ctx.fillStyle=tg; ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
  }
  ctx.restore();
  if(cl){ ctx.strokeStyle='rgba(80,165,245,.5)'; ctx.lineWidth=1.5; ctx.setLineDash([3,3]); ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.stroke(); ctx.setLineDash([]); }
  glow('rgba(80,158,250,.22)',r*.20);
  ctx.strokeStyle='rgba(130,210,255,.28)'; ctx.lineWidth=r*.065;
  ctx.beginPath(); ctx.arc(cx,cy,r*1.03,0,Math.PI*2); ctx.stroke();
  noGlow();
}

function drawSolar(cx,cy,r,cl) {
  const sR=Math.max(4,r*.095);
  glow('rgba(255,215,40,.60)',sR*2.2);
  const sg=ctx.createRadialGradient(cx,cy,0,cx,cy,sR*1.35);
  sg.addColorStop(0,'#fffff4'); sg.addColorStop(.35,'#ffe84a'); sg.addColorStop(1,'#ff8c00');
  ctx.fillStyle=sg;
  ctx.beginPath(); ctx.arc(cx,cy,sR,0,Math.PI*2); ctx.fill();
  noGlow();
  const P=[
    {or:.18,pr:.018,col:'#c0c0c0',a:.70},
    {or:.29,pr:.026,col:'#e8c870',a:2.40},
    {or:.40,pr:.028,col:'#4492e0',a:4.20},
    {or:.52,pr:.022,col:'#d04522',a:1.30},
    {or:.67,pr:.058,col:'#d0aa6a',a:3.10},
    {or:.83,pr:.052,col:'#c8ba78',a:5.70,saturn:true},
  ];
  for(const pl of P){
    const oR=pl.or*r; if(oR<sR*1.5) continue;
    ctx.beginPath(); ctx.arc(cx,cy,oR,0,Math.PI*2);
    ctx.strokeStyle='rgba(75,95,128,.16)'; ctx.lineWidth=.6;
    if(cl) ctx.setLineDash([2,4]); ctx.stroke(); ctx.setLineDash([]);
    const px=cx+oR*Math.cos(pl.a), py=cy+oR*Math.sin(pl.a);
    const pR=Math.max(1.4,pl.pr*r);
    const pg=ctx.createRadialGradient(px-pR*.3,py-pR*.3,0,px,py,pR);
    pg.addColorStop(0,'rgba(255,255,255,.42)'); pg.addColorStop(1,pl.col);
    ctx.fillStyle=pR>3?pg:pl.col;
    ctx.beginPath(); ctx.arc(px,py,pR,0,Math.PI*2); ctx.fill();
    if(pl.saturn&&pR>3){
      ctx.save(); ctx.translate(px,py); ctx.rotate(.42);
      ctx.beginPath(); ctx.ellipse(0,0,pR*2.05,pR*.52,0,0,Math.PI*2);
      ctx.strokeStyle='rgba(205,190,145,.58)'; ctx.lineWidth=pR*.40; ctx.stroke();
      ctx.restore();
    }
  }
}

function drawGalaxy(cx,cy,r,cl) {
  ctx.save();
  ctx.translate(cx,cy);
  ctx.save();
  ctx.beginPath(); ctx.ellipse(0,0,r*1.01,r*0.405,0,0,Math.PI*2); ctx.clip();
  const dg=ctx.createRadialGradient(0,0,0,0,0,r);
  dg.addColorStop(0,'rgba(255,252,230,.96)');
  dg.addColorStop(.15,'rgba(240,235,200,.82)');
  dg.addColorStop(.42,'rgba(170,178,225,.45)');
  dg.addColorStop(.75,'rgba(120,130,195,.18)');
  dg.addColorStop(1,'rgba(90,105,175,0)');
  ctx.fillStyle=dg;
  ctx.beginPath(); ctx.ellipse(0,0,r,r*.38,0,0,Math.PI*2); ctx.fill();
  if(r>20){
    for(let arm=0;arm<4;arm++){
      ctx.beginPath();
      const isM=arm<2, phase=arm*(Math.PI/2);
      for(let t=0.15;t<Math.PI*3.4;t+=.045){
        const rr=r*.08+t*r*.085;
        const x=rr*Math.cos(t+phase), y=rr*Math.sin(t+phase)*.38;
        if(t<.20) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.strokeStyle=isM?'rgba(215,225,255,.42)':'rgba(185,195,235,.20)';
      ctx.lineWidth=isM?Math.max(1.6,r*.040):Math.max(.9,r*.020);
      ctx.stroke();
    }
    const bg=ctx.createRadialGradient(0,0,0,0,0,r*.20);
    bg.addColorStop(0,'rgba(255,255,228,.65)'); bg.addColorStop(.55,'rgba(255,215,120,.25)'); bg.addColorStop(1,'rgba(255,180,60,0)');
    ctx.fillStyle=bg; ctx.beginPath(); ctx.ellipse(0,0,r*.20,r*.082,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(12,8,4,.30)';
    ctx.beginPath(); ctx.rect(-r,-r*.026,r*2,r*.052); ctx.fill();
    ctx.save(); ctx.rotate(.18);
    ctx.fillStyle='rgba(10,6,2,.18)';
    ctx.beginPath(); ctx.rect(-r*.6,-r*.020,r*1.2,r*.040); ctx.fill();
    ctx.restore();
    const HII=[[.55,.10],[-.62,.08],[.15,-.60],[-.12,.58],[.42,-.42],[-.40,.40]];
    for(const[hx,hy] of HII){
      const hxR=hx*r, hyR=hy*r*.38;
      const hg=ctx.createRadialGradient(hxR,hyR,0,hxR,hyR,r*.045);
      hg.addColorStop(0,'rgba(255,80,120,.55)'); hg.addColorStop(1,'rgba(255,60,100,0)');
      ctx.fillStyle=hg; ctx.beginPath(); ctx.arc(hxR,hyR,r*.045,0,Math.PI*2); ctx.fill();
    }
    for(let i=0;i<12;i++){
      const a=(i/12)*Math.PI*2+.3;
      const rf=r*(.80+.15*((i*7)%5)/5);
      ctx.globalAlpha=.55;
      ctx.fillStyle='rgba(240,235,210,.90)';
      ctx.beginPath(); ctx.arc(rf*Math.cos(a),rf*Math.sin(a)*.38,1.2,0,Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha=1;
  }
  ctx.restore();
  if(cl){
    ctx.beginPath(); ctx.ellipse(0,0,r,r*.38,0,0,Math.PI*2);
    ctx.strokeStyle='rgba(140,152,184,.60)'; ctx.lineWidth=1.5; ctx.setLineDash([3,4]); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.restore();
}

// ── Scale panel (right column) ────────────────────────────────────────────
function drawScalePanel(l, p) {
  const { W, scaleW, midW, topH, mainY0 } = l;
  const x0     = midW;
  const showS  = cbScale ? cbScale.checked : true;
  if (!showS) return;

  const uPhys  = univPhys(p);
  const logU   = Math.log10(uPhys);

  ctx.save();
  ctx.beginPath(); ctx.rect(x0, mainY0, scaleW, topH); ctx.clip();

  ctx.fillStyle = 'rgba(2,5,16,0.94)';
  ctx.fillRect(x0, mainY0, scaleW, topH);
  ctx.strokeStyle = 'rgba(15,25,48,1)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x0, mainY0); ctx.lineTo(x0, mainY0+topH); ctx.stroke();

  const lineX  = x0 + scaleW * 0.42;
  const topY   = mainY0 + topH * 0.05;
  const botY   = mainY0 + topH * 0.95;
  const lineH  = botY - topY;

  ctx.strokeStyle = 'rgba(40,60,95,0.65)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(lineX, topY); ctx.lineTo(lineX, botY); ctx.stroke();

  const LOG_MIN=-35, LOG_MAX=26;
  const LOG_SPAN=LOG_MAX-LOG_MIN;

  function logToY(lv){ return botY-(lv-LOG_MIN)/LOG_SPAN*lineH; }

  const midY=logToY(logU);
  const grd=ctx.createLinearGradient(0,topY,0,botY);
  grd.addColorStop(0,'rgba(8,130,230,0.28)'); grd.addColorStop(1,'rgba(4,50,110,0.22)');
  ctx.fillStyle=grd; ctx.fillRect(x0,topY,scaleW,lineH);

  for (const ref of SCALE_REFS) {
    const lv=Math.log10(ref.size), refY=logToY(lv);
    if (refY<topY||refY>botY) continue;
    const sp=ref.special;
    const dist=Math.abs(lv-logU);
    // Always show all markers — bright when current universe is near, dim when far
    const near   = dist < 0.6;
    const medium = dist < 3;
    const alpha  = near ? 1.0 : medium ? 0.52 : 0.28;
    const fSize  = near ? Math.max(8,scaleW*.065) : Math.max(7,scaleW*.055);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = sp ? 'rgba(200,170,100,.80)' : near ? 'rgba(120,170,230,.80)' : 'rgba(55,80,130,.55)';
    ctx.lineWidth   = sp ? 1.2 : near ? 1.0 : 0.6;
    ctx.setLineDash(sp ? [] : near ? [] : [2,4]);
    ctx.beginPath(); ctx.moveTo(lineX-10,refY); ctx.lineTo(lineX+10,refY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font=`${fSize}px system-ui,sans-serif`; ctx.textAlign='left';
    ctx.fillStyle = sp ? 'rgba(220,190,120,.90)' : near ? 'rgba(160,200,240,.92)' : 'rgba(75,100,140,.80)';
    ctx.fillText(lang==='en'?ref.en:ref.de,lineX+14,refY+3.5);
    ctx.fillStyle = sp ? 'rgba(162,186,216,.72)' : 'rgba(75,94,120,.72)';
    ctx.fillText(fmtPhys(ref.size),lineX+6,refY+12);
    ctx.globalAlpha=1;
  }

  glow('rgba(108,168,210,.52)',5);
  ctx.fillStyle='rgba(108,168,210,.96)'; ctx.globalAlpha=.88;
  ctx.beginPath(); ctx.moveTo(lineX-14,midY-5); ctx.lineTo(lineX-1,midY); ctx.lineTo(lineX-14,midY+5); ctx.closePath(); ctx.fill();
  noGlow(); ctx.globalAlpha=1;
  ctx.font=`${Math.max(9,scaleW*.055)}px system-ui,sans-serif`;
  ctx.fillStyle='rgba(102,152,192,.82)'; ctx.textAlign='center';
  ctx.fillText(fmtPhys(univPhys(p)),x0+scaleW*.5,mainY0+topH-8);
  ctx.restore();
}

// ── Scale bar (left panel) ─────────────────────────────────────────────────
function drawScaleBar(l, p) {
  const { uCX, uCY, uR, ulf, leftColW, topH, mainY0 } = l;
  const uPhys = univPhys(p);
  const mpp   = uPhys / uR;
  const targetPx  = Math.max(80, uR * 0.55);
  const rawMetres = targetPx * mpp;
  const niceMetres= Math.pow(10, Math.round(Math.log10(rawMetres)));
  const barPx  = niceMetres / mpp;
  const SEGMENTS=4, segPx=barPx/SEGMENTS;
  const barH   = Math.max(7, uR*0.040);
  const fontSize = Math.max(10, barH*1.3);
  const tickH  = barH*0.60;
  const margin = Math.max(10, uR*0.10);
  const barX   = uCX-uR+margin;
  const barY   = uCY+uR+ulf*4.5;

  ctx.save();
  ctx.beginPath(); ctx.rect(0,mainY0,leftColW,topH); ctx.clip();
  ctx.fillStyle='rgba(4,8,20,0.60)';
  ctx.fillRect(barX-margin*0.4,barY-tickH-fontSize*2.0,barPx+margin*0.8,tickH+fontSize*2.0+barH+tickH+fontSize*1.4);
  for (let i=0;i<SEGMENTS;i++) {
    const sx=barX+i*segPx;
    ctx.fillStyle=i%2===0?'rgba(235,242,255,0.95)':'rgba(6,10,26,0.95)';
    ctx.fillRect(sx,barY,segPx,barH);
  }
  ctx.strokeStyle='rgba(120,165,210,0.80)'; ctx.lineWidth=1.1;
  ctx.strokeRect(barX,barY,barPx,barH);
  ctx.strokeStyle='rgba(120,165,210,0.45)'; ctx.lineWidth=0.6;
  for (let i=1;i<SEGMENTS;i++){const tx=barX+i*segPx;ctx.beginPath();ctx.moveTo(tx,barY);ctx.lineTo(tx,barY+barH);ctx.stroke();}
  ctx.strokeStyle='rgba(150,190,225,0.85)'; ctx.lineWidth=1.1;
  for (const i of [0,SEGMENTS]){const tx=barX+i*segPx;ctx.beginPath();ctx.moveTo(tx,barY-tickH);ctx.lineTo(tx,barY+barH+tickH);ctx.stroke();}
  ctx.shadowColor='rgba(0,0,0,0.98)'; ctx.shadowBlur=6;
  ctx.font=`${fontSize}px 'Courier New',monospace`; ctx.fillStyle='rgba(175,210,245,0.95)';
  const labelY=barY-tickH-fontSize*0.3;
  ctx.textAlign='center'; ctx.fillText('0',barX,labelY);
  ctx.textAlign='right'; ctx.fillText(fmtPhys(niceMetres),barX+barPx,labelY);
  const titleFs=Math.max(9,fontSize*0.82);
  ctx.font=`700 ${titleFs}px system-ui,sans-serif`; ctx.fillStyle='rgba(85,125,170,0.90)';
  ctx.textAlign='left'; ctx.fillText(lang==='en'?'SCALE':'MASSSTAB',barX,barY-tickH-fontSize*1.55);
  ctx.shadowBlur=0; ctx.restore();
}

// ── Full cosmic timeline display (bottom bar) ─────────────────────────────
function drawTimeDisplay(l, p) {
  const {W, btmH, topH, mainY0} = l;
  const y0  = mainY0 + topH;
  const pad = Math.max(18, W * 0.018);

  ctx.save();
  ctx.fillStyle='rgba(1,3,11,.98)'; ctx.fillRect(0,y0,W,btmH);
  ctx.strokeStyle='rgba(16,20,34,1)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(0,y0); ctx.lineTo(W,y0); ctx.stroke();

  const logTNow = progressToLogT(p);
  const fBig    = Math.max(20, W * 0.028);
  const fSup    = Math.max(14, W * 0.018);
  const fLbl    = Math.max(11, W * 0.012);
  const fTick   = Math.max(9,  W * 0.010);
  const midY    = y0 + btmH * 0.48;

  // Current time display
  ctx.textAlign='left';
  if (p <= 0 || logTNow <= T_START_LOG + 0.001) {
    ctx.font=`${fBig}px system-ui,sans-serif`;
    ctx.fillStyle='rgba(85,115,165,.95)';
    ctx.fillText('t = 0',pad,midY);
    const bw=ctx.measureText('t = 0').width;
    glow('rgba(90,180,240,.70)',12);
    ctx.font=`bold ${fSup}px system-ui,sans-serif`; ctx.fillStyle='#7ad8f2';
    ctx.fillText('  (Big Bang)',pad+bw,midY-fBig*.10);
    noGlow();
  } else if (logTNow < 0) {
    // Display as 10^X s
    ctx.font=`${fBig}px system-ui,sans-serif`;
    ctx.fillStyle='rgba(85,115,165,.95)';
    ctx.fillText('t = 10',pad,midY);
    const bw=ctx.measureText('t = 10').width;
    glow('rgba(90,180,240,.70)',12);
    ctx.font=`bold ${fSup}px system-ui,sans-serif`; ctx.fillStyle='#7ad8f2';
    ctx.fillText(logTNow.toFixed(2)+' s',pad+bw+2,midY-fBig*.38);
    noGlow();
  } else if (logTNow < 7) {
    // Display as seconds/minutes
    const secs = Math.pow(10, logTNow);
    let timeStr;
    if (secs < 60)        timeStr = secs.toFixed(2) + ' s';
    else if (secs < 3600) timeStr = (secs/60).toFixed(1) + ' min';
    else                  timeStr = (secs/3600).toFixed(1) + ' h';
    ctx.font=`${fBig}px system-ui,sans-serif`; ctx.fillStyle='rgba(85,115,165,.95)';
    ctx.fillText('t ≈ ',pad,midY);
    const bw=ctx.measureText('t ≈ ').width;
    glow('rgba(90,180,240,.70)',12);
    ctx.font=`bold ${fSup}px system-ui,sans-serif`; ctx.fillStyle='#7ad8f2';
    ctx.fillText(timeStr,pad+bw,midY-fBig*.1);
    noGlow();
  } else {
    // Display as years
    const yrs = Math.pow(10, logTNow) / (365.25*24*3600);
    let timeStr;
    if      (yrs < 1e3)  timeStr = yrs.toFixed(0) + ' yr';
    else if (yrs < 1e6)  timeStr = (yrs/1e3).toFixed(1)  + ' kyr';
    else if (yrs < 1e9)  timeStr = (yrs/1e6).toFixed(2)  + ' Myr';
    else                 timeStr = (yrs/1e9).toFixed(3)   + ' Gyr';
    ctx.font=`${fBig}px system-ui,sans-serif`; ctx.fillStyle='rgba(85,115,165,.95)';
    ctx.fillText('t ≈ ',pad,midY);
    const bw=ctx.measureText('t ≈ ').width;
    glow('rgba(90,180,240,.70)',12);
    ctx.font=`bold ${fSup}px system-ui,sans-serif`; ctx.fillStyle='#7ad8f2';
    ctx.fillText(timeStr,pad+bw,midY-fBig*.1);
    noGlow();
  }

  // Era label
  const eraLabel=getEraName(p)||'—';
  ctx.font=`${Math.max(12,fLbl*1.1)}px system-ui,sans-serif`;
  ctx.fillStyle='rgba(62,84,122,.90)';
  ctx.fillText(eraLabel, pad, midY+fLbl*1.8);

  // ── Full cosmic timeline bar ─────────────────────────────────────────────
  // Bar positions are mapped through progressToAnim() so the bar matches the
  // active animation mode. Cursor = animT (animation fraction).
  const bL = W*0.30, bR = W-pad, bW = bR-bL;
  const bTop = y0+btmH*0.10, bH = Math.max(8,btmH*0.24);

  // Helper: progress value → bar x position (mode-aware)
  function barX(prog) { return bL + progressToAnim(prog) * bW; }

  ctx.fillStyle='rgba(7,11,22,1)'; ctx.strokeStyle='rgba(20,28,48,1)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.rect(bL,bTop,bW,bH); ctx.fill(); ctx.stroke();

  // Era colored bands – positions driven by progressToAnim so each era gets
  // proportional bar width matching the selected animation mode
  const BAR_ERAS = [
    { p0:logTToProgress(-43),  p1:logTToProgress(-42),   col:'rgba(40,8,80,.60)'    }, // Planck
    { p0:logTToProgress(-42),  p1:logTToProgress(-35),   col:'rgba(100,40,8,.55)'   }, // GUT
    { p0:logTToProgress(-35),  p1:logTToProgress(-32),   col:'rgba(10,40,160,.70)'  }, // Inflation
    { p0:logTToProgress(-32),  p1:logTToProgress(-6),    col:'rgba(160,30,10,.55)'  }, // QGP
    { p0:logTToProgress(-6),   p1:logTToProgress(2.25),  col:'rgba(180,60,15,.50)'  }, // BBN
    { p0:logTToProgress(2.25), p1:logTToProgress(13.08), col:'rgba(120,20,55,.45)'  }, // Plasma
    { p0:logTToProgress(13.08),p1:logTToProgress(15.5),  col:'rgba(8,10,22,.40)'    }, // Dark Ages
    { p0:logTToProgress(15.5), p1:1.0,                   col:'rgba(8,14,32,.40)'    }, // Stars
  ];
  for (const era of BAR_ERAS) {
    const x0 = barX(era.p0), x1 = barX(era.p1);
    ctx.fillStyle = era.col;
    ctx.fillRect(x0, bTop+1, x1-x0, bH-2);
  }

  // Current position cursor (animT = animation fraction, always 0–1)
  const xCursor = bL + animT * bW;
  glow('rgba(100,188,248,.80)',8);
  ctx.strokeStyle='rgba(115,195,252,.96)'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(xCursor,bTop-2); ctx.lineTo(xCursor,bTop+bH+2); ctx.stroke();
  noGlow();
  ctx.fillStyle='rgba(115,195,252,.90)';
  ctx.beginPath(); ctx.moveTo(xCursor-4,bTop-2); ctx.lineTo(xCursor+4,bTop-2); ctx.lineTo(xCursor,bTop+6); ctx.closePath(); ctx.fill();

  // Era boundary tick marks + labels — placed at their mode-aware bar positions
  const tLabels = [
    { p: logTToProgress(-43),    de:'Urknall',  en:'Big Bang',  align:'left'   },
    { p: logTToProgress(-35),    de:'Infl.',    en:'Infl.',     align:'center' },
    { p: logTToProgress(-32),    de:'10⁻³²s',  en:'10⁻³²s',  align:'center' },
    { p: logTToProgress(-6),     de:'1μs',      en:'1μs',       align:'center' },
    { p: logTToProgress(0),      de:'1s',       en:'1s',        align:'center' },
    { p: logTToProgress(13.08),  de:'CMB',      en:'CMB',       align:'center' },
    { p: logTToProgress(15.5),   de:'Sterne',   en:'Stars',     align:'center' },
    { p: 1.0,                    de:'Heute',    en:'Today',     align:'right'  },
  ];
  ctx.font = `${fTick}px system-ui, sans-serif`;
  let lastLabelX = -999;
  for (const lb of tLabels) {
    const lx = barX(lb.p);
    if (lx < bL || lx > bR) continue;
    // Suppress label if too close to previous one
    if (lx - lastLabelX < fTick * 2.2) continue;
    lastLabelX = lx;
    ctx.strokeStyle='rgba(40,52,80,.90)'; ctx.lineWidth=.8;
    ctx.beginPath(); ctx.moveTo(lx,bTop); ctx.lineTo(lx,bTop+bH); ctx.stroke();
    ctx.fillStyle='rgba(72,95,140,.92)';
    // "Big Bang" goes well above the bar (clear of the "Kosmische Zeitlinie" heading)
    const isFirst = lb.p === logTToProgress(-43);
    ctx.textAlign = isFirst ? 'left' : (lb.align||'center');
    const labelY  = isFirst ? bTop - fTick*4.5 : bTop+bH+fTick*1.6;
    ctx.fillText(lang==='en'?lb.en:lb.de, lx, labelY);
  }

  ctx.font=`${fLbl}px system-ui,sans-serif`;
  ctx.fillStyle='rgba(70,90,132,.80)'; ctx.textAlign='left';
  ctx.fillText(lang==='en' ? 'Cosmic Timeline' : 'Kosmische Zeitlinie', bL, bTop-fLbl*0.4);
  ctx.restore();
}

// ── Overlays ──────────────────────────────────────────────────────────────
function drawOverlays(l, p) {
  const {uCX,uCY,uR,W,topH,mainY0} = l;
  const uPhys=univPhys(p), now=performance.now();
  const ef=getEraFactors(p);
  const iF=inflF(p);

  if (!planckMsgDone&&ef.planckF>0.5){planckMsgDone=true;planckMsgTs=now;}
  if (planckMsgDone&&ef.planckF>0.01){
    const el=now-planckMsgTs;
    const qa=el<500?el/500:el<3500?1:Math.max(0,1-(el-3500)/900);
    if (qa>.01) softText(uCX,uCY+uR*.65,
      lang==='en'?'Planck era: spacetime\nitself is quantized'
                :'Planck-Ära: Die Raumzeit\nist selbst gequantelt',
      qa*ef.planckF*0.9,13,'rgba(220,200,255,.90)');
  }

  if (!gutMsgDone&&ef.gutF>0.5){gutMsgDone=true;gutMsgTs=now;}
  if (gutMsgDone&&ef.gutF>0.01){
    const el=now-gutMsgTs;
    const qa=el<500?el/500:el<3500?1:Math.max(0,1-(el-3500)/900);
    if (qa>.01) softText(uCX,uCY+uR*.65,
      lang==='en'?'GUT era: all forces\nunified except gravity'
                :'GUT-Ära: Alle Kräfte\nvereinigt außer Gravitation',
      qa*ef.gutF*0.9,13,'rgba(255,210,150,.90)');
  }

  if (!quantumDone&&iF>0.5){quantumDone=true;quantumTs=now;}
  if (quantumDone&&iF>0.01){
    const el=now-quantumTs;
    const qa=el<500?el/500:el<3500?1:Math.max(0,1-(el-3500)/900);
    if (qa>.01) softText(uCX,uCY+uR*.70,
      lang==='en'?'Quantum fluctuations\nstretched to cosmic scales'
                :'Quantenfluktuationen\nauf kosmische Skalen gestreckt',
      qa*iF,13,'rgba(168,210,245,.90)');
  }

  // CMB flash at recombination
  if (!obsDone&&p>=P_RECOMB){obsDone=true;flashAlpha=.10;flashTs=now;endDone=false;}
  if (flashAlpha>0){
    const el=now-flashTs; flashAlpha=Math.max(0,.10-el/1100);
    ctx.save(); ctx.globalAlpha=flashAlpha; ctx.fillStyle='#fff8e8'; ctx.fillRect(0,mainY0,W,topH); ctx.restore();
  }
  if (obsDone&&!endDone){endDone=true;endTs=now;}
  if (endDone){
    const el=now-endTs;
    const ea=el<600?el/600:el<4200?1:Math.max(0,1-(el-4200)/900);
    if (ea>.01&&p<.995) softText(uCX,uCY,
      lang==='en'?'Recombination –\nCMB photons released'
                :'Rekombination –\nCMB-Photonen freigesetzt',
      ea,14,'rgba(255,225,128,.92)');
  }
  if (p>=.999&&!playing) softText(uCX,mainY0+topH*.82,
    lang==='en'?'13.8 Gyr  –  Today':'13.8 Mrd. Jahre  –  Heute',
    .84,13,'rgba(158,192,225,.92)');
}

// ── Column headers ─────────────────────────────────────────────────────────
function drawColumnHeaders(l) {
  const {midW,uCX,rCX,divX,mainY0,topH} = l;
  ctx.save();
  ctx.font=`600 9px system-ui,sans-serif`; ctx.textAlign='center';
  ctx.fillStyle='rgba(45,60,92,.85)';
  ctx.fillText(lang==='en'?'UNIVERSE':'UNIVERSUM', uCX, mainY0+13);
  ctx.fillText(lang==='en'?'REFERENCE OBJECT':'REFERENZOBJEKT', rCX, mainY0+13);
  ctx.strokeStyle='rgba(20,28,50,.88)'; ctx.lineWidth=1; ctx.setLineDash([2,5]);
  ctx.beginPath(); ctx.moveTo(divX,mainY0+18); ctx.lineTo(divX,mainY0+topH-18); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// ── Main draw ─────────────────────────────────────────────────────────────
function drawFrame() {
  const lo=L();
  const {W,H}=lo;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#01020c'; ctx.fillRect(0,0,W,H);
  drawTopRow(lo);
  drawColumnHeaders(lo);
  drawUniverse(lo,progress);
  drawReference(lo,progress);
  drawScalePanel(lo,progress);
  drawScaleBar(lo,progress);
  drawTimeDisplay(lo,progress);
  drawOverlays(lo,progress);
  updateEraInfo(progress);
}

// ── Animation ─────────────────────────────────────────────────────────────
function _resync() {
  if (playing && startTime !== null)
    startTime = performance.now() - animT * ANIM_DURATION / speedMultiplier;
}

function animate(ts) {
  if (!playing) return;
  if (!startTime) startTime=ts;
  animT = Math.min((ts-startTime)*speedMultiplier/ANIM_DURATION,1);
  progress = animToProgress(animT);
  drawFrame(); updatePlayButton();
  if (animT<1) rafId=requestAnimationFrame(animate);
  else { playing=false; updatePlayButton(); drawFrame(); }
}

// ── Controls ──────────────────────────────────────────────────────────────
function getStartProgress() {
  return (cbSkipEarly&&cbSkipEarly.checked) ? P_INFL_START : 0;
}

function togglePlay() {
  if (animT>=1){ doReset(false); return; }
  playing=!playing;
  if (playing){
    _resync();
    rafId=requestAnimationFrame(animate);
  } else {
    cancelAnimationFrame(rafId); rafId=null;
  }
  updatePlayButton();
}

function doReset(redraw=true){
  if (rafId){cancelAnimationFrame(rafId);rafId=null;}
  playing=false;
  progress=getStartProgress();
  animT=progressToAnim(progress);
  startTime=null;
  flashAlpha=0; quantumDone=false; obsDone=false; endDone=false;
  planckMsgDone=false; gutMsgDone=false;
  updatePlayButton(); if(redraw) drawFrame();
}

function resetSim(){ doReset(true); }
function onShowScaleChange(){ drawFrame(); }
function onShowTimeBarChange(){ drawFrame(); }
function onSkipEarlyErasChange(){
  if(cbSkipEarly&&cbSkipEarly.checked&&progress<P_INFL_START){ doReset(true); }
  else { drawFrame(); }
}

// ── LOG / LIN mode ─────────────────────────────────────────────────────────
const MODE_DESC = {
  log: {
    de: 'Logarithmische Zeitachse mit konfigurierbarer Ären-Gewichtung — ereignisreiche Phasen bekommen mehr Animationszeit.',
    en: 'Logarithmic time axis with configurable era weighting — event-rich phases get more screen time.'
  },
  lin: {
    de: 'Quadratische Abbildung: frühe Phasen laufen schnell, spätere bekommen mehr Raum — gleichmäßig ohne Ären-Bevorzugung.',
    en: 'Quadratic mapping: early phases run quickly, later ones expand smoothly — no era-specific boosting.'
  }
};

function _syncModeButtons() {
  if (btnLog) {
    btnLog.classList.toggle('active', expansionMode==='log');
    btnLin.classList.toggle('active', expansionMode==='lin');
  }
  const de = document.getElementById('modeDescDe');
  const en = document.getElementById('modeDescEn');
  if (de) de.textContent = MODE_DESC[expansionMode].de;
  if (en) en.textContent = MODE_DESC[expansionMode].en;
  const ewg = document.getElementById('eraWeightGroup');
  if (ewg) ewg.classList.toggle('hidden', expansionMode !== 'log');
  const qeg = document.getElementById('quadExponentGroup');
  if (qeg) qeg.classList.toggle('hidden', expansionMode !== 'lin');
}

function setExpansionMode(mode) {
  if(expansionMode===mode) return;
  expansionMode=mode; _syncModeButtons();
  animT=progressToAnim(progress);
  _resync(); drawFrame();
}

function onModeChange(mode){ setExpansionMode(mode); }

function onDurationChange(){
  if(!sliderDur) return;
  const val=parseInt(sliderDur.value,10);
  ANIM_DURATION=val*1000;
  if(labelDur) labelDur.textContent=val+' s';
  _resync();
}

function onEraWeightChange(){
  if(!sliderEraWeight) return;
  const val=parseInt(sliderEraWeight.value,10);
  eraWeightIntensity=val/100;
  if(labelEraWeight) labelEraWeight.textContent=val+'%';
  computeEffectiveCTRL_T();
  animT=progressToAnim(progress);
  _resync(); drawFrame();
}

function onDensityChange(){
  if(!sliderDensity) return;
  const val=parseInt(sliderDensity.value,10);
  gParticleDensity=val/100;
  if(labelDensity) labelDensity.textContent=val+'%';
  drawFrame();
}

function onLinExpChange(){
  if(!sliderLinExp) return;
  const val=parseInt(sliderLinExp.value,10);
  linExponent=val/10;
  if(labelLinExp) labelLinExp.textContent=(linExponent).toFixed(1);
  animT=progressToAnim(progress);
  _resync(); drawFrame();
}

function onSpeedChange(){
  if(!sliderSpeed) return;
  const val=parseInt(sliderSpeed.value,10);
  speedMultiplier=val/100;
  if(labelSpeed) labelSpeed.textContent=speedMultiplier.toFixed(2)+'×';
  _resync();
}

function updatePlayButton(){
  if(!btnPlay) return;
  let dt,et;
  if     (animT>=1)                    { dt='↺ Nochmal';  et='↺ Replay'; }
  else if(playing)                     { dt='⏸ Pause';    et='⏸ Pause'; }
  else if(progress>getStartProgress()) { dt='▶ Weiter';   et='▶ Continue'; }
  else                                 { dt='▶ Start';    et='▶ Start'; }
  const dEl=btnPlay.querySelector('[data-lang-text="de"]');
  const eEl=btnPlay.querySelector('[data-lang-text="en"]');
  if(dEl) dEl.textContent=dt;
  if(eEl) eEl.textContent=et;
}

function toggleLang(){
  lang=lang==='de'?'en':'de';
  document.documentElement.dataset.lang=lang;
  if(!playing) drawFrame();
}

// ── Format helpers ────────────────────────────────────────────────────────
const SUP='⁰¹²³⁴⁵⁶⁷⁸⁹';
function toSup(n){ return String(n).split('').map(c=>c==='-'?'⁻':SUP[+c]??c).join(''); }
function fmtPhys(m){
  if(!m||m<=0) return '—';
  const e=Math.floor(Math.log10(Math.abs(m)));
  const ms=(m/Math.pow(10,e)).toFixed(2).replace(/\.?0+$/,'');
  return(ms==='1'?'':`${ms}×`)+'10'+toSup(e)+' m';
}
function fmtPhysShort(m){ const e=Math.round(Math.log10(m)); return '10'+toSup(e)+' m'; }
function fmtRatio(ratio){
  const lr=Math.log10(ratio);
  if(Math.abs(lr)<.20) return '≈ '+(lang==='en'?'same size':'gleiche Größe');
  const n=Math.abs(Math.round(lr));
  if(ratio>1) return (lang==='en'?'Universe':'Universum')+' ×10'+toSup(n)+' '+(lang==='en'?'larger':'größer');
  return (lang==='en'?'Universe':'Universum')+' ×10'+toSup(n)+' '+(lang==='en'?'smaller':'kleiner');
}

// ── Hex color with alpha helper ────────────────────────────────────────────
function hexAlpha(hex, alpha) {
  const r=parseInt(hex.slice(1,3),16);
  const g=parseInt(hex.slice(3,5),16);
  const b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Init ──────────────────────────────────────────────────────────────────
if(langToggle) langToggle.addEventListener('click',toggleLang);
if(btnLog)          btnLog.addEventListener('click',()=>setExpansionMode('log'));
if(btnLin)          btnLin.addEventListener('click',()=>setExpansionMode('lin'));
if(sliderDur)       sliderDur.addEventListener('input',onDurationChange);
if(sliderEraWeight) sliderEraWeight.addEventListener('input',onEraWeightChange);
if(sliderDensity)   sliderDensity.addEventListener('input',onDensityChange);
if(sliderLinExp)    sliderLinExp.addEventListener('input',onLinExpChange);
if(sliderSpeed)     sliderSpeed.addEventListener('input',onSpeedChange);

window.addEventListener('resize',resizeCanvas);
window.togglePlay           = togglePlay;
window.resetSim             = resetSim;
window.onShowScaleChange    = onShowScaleChange;
window.onShowTimeBarChange  = onShowTimeBarChange;
window.onSkipEarlyErasChange= onSkipEarlyErasChange;
window.onModeChange         = onModeChange;
window.setExpansionMode     = setExpansionMode;
window.onEraWeightChange    = onEraWeightChange;
window.onDensityChange      = onDensityChange;
window.onLinExpChange       = onLinExpChange;
window.onSpeedChange        = onSpeedChange;

computeEffectiveCTRL_T();
_syncModeButtons();
progress = getStartProgress();
animT    = progressToAnim(progress);
resizeCanvas();
