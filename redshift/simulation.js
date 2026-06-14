"use strict";
 
// ─── Distance scale: 10 logarithmic breakpoints ───────────────────────────────
// Each entry: { label_de, label_en, sourceName, z_edu_factor, z_real }
// slider 0–100 maps to these breakpoints via log interpolation
const DISTANCE_NODES = [
  { km: 0.01,           label_de: '10 m',           label_en: '10 m',          src: 'flashlight', z_real: 0         },
  { km: 100,            label_de: '100 km',          label_en: '100 km',        src: 'flashlight', z_real: 0         },
  { km: 384400,         label_de: '384.400 km (Mond)',label_en: '384,400 km (Moon)', src: 'moon', z_real: 0         },
  { km: 1.5e8,          label_de: '150 Mio. km (Sonne)', label_en: '150 M km (Sun)', src: 'sun', z_real: 0         },
  { km: 4e13,           label_de: '4 Lj (Alpha Cen.)', label_en: '4 ly (Alpha Cen.)', src: 'sun', z_real: 1e-9    },
  { km: 9.46e17,        label_de: '100.000 Lj (Milchstr.)', label_en: '100,000 ly (Milky Way)', src: 'galaxy', z_real: 2e-6 },
  { km: 2.37e19,        label_de: '2,5 Mio. Lj (Andromeda)', label_en: '2.5 M ly (Andromeda)', src: 'galaxy', z_real: 0.00018 },
  { km: 9.46e20,        label_de: '100 Mio. Lj',    label_en: '100 M ly',      src: 'galaxy', z_real: 0.0073     },
  { km: 6.96e21,        label_de: '735 Mio. Lj (3C 273)', label_en: '735 M ly (3C 273)', src: 'quasar', z_real: 0.158 },
  { km: 9.46e22,        label_de: '10 Mrd. Lj',     label_en: '10 B ly',       src: 'quasar', z_real: 1.5        },
];
 
// Educational z factors (0→1 expansion maps to: 0 z to this maximum z)
const EDU_Z_MAX = [0, 0.01, 0.04, 0.08, 0.15, 0.35, 0.55, 0.85, 1.2, 2.5];
 
let sliderPos = 50; // 0–100
let expansionVal = 0;
let showWavelength = true;
let showDynamicSpectrum = true;
let showStarfield = true;
let playing = true;
let t = 0;
let lastTs = null;
let realisticMode = false;
 
const canvas = document.getElementById('universe');
const ctx = canvas.getContext('2d');
 
// ─── Map slider (0–100) to distance node index + interpolation frac ───────────
function sliderToNodeFrac(s) {
  const n = DISTANCE_NODES.length - 1;
  const exact = (s / 100) * n;
  const idx = Math.min(Math.floor(exact), n - 1);
  const frac = exact - idx;
  return { idx, frac };
}
 
function getCurrentNode() {
  const { idx, frac } = sliderToNodeFrac(sliderPos);
  // Blend label by which side we're closer to
  return frac < 0.5 ? DISTANCE_NODES[idx] : DISTANCE_NODES[Math.min(idx + 1, DISTANCE_NODES.length - 1)];
}
 
function getCurrentSource() {
  return getCurrentNode().src;
}
 
function getRedshift() {
  const { idx, frac } = sliderToNodeFrac(sliderPos);
  const n = DISTANCE_NODES.length - 1;
  const nextIdx = Math.min(idx + 1, n);
  if (realisticMode) {
    const z0 = DISTANCE_NODES[idx].z_real;
    const z1 = DISTANCE_NODES[nextIdx].z_real;
    return (z0 + (z1 - z0) * frac) * expansionVal;
  } else {
    const z0max = EDU_Z_MAX[idx];
    const z1max = EDU_Z_MAX[nextIdx];
    const zMax = z0max + (z1max - z0max) * frac;
    return zMax * expansionVal;
  }
}
 
function getDistLabel() {
  const node = getCurrentNode();
  const lang = document.documentElement.dataset.lang || 'de';
  return lang === 'en' ? node.label_en : node.label_de;
}
 
// ─── Stars ───────────────────────────────────────────────────────────────────
const STAR_COUNT = 220;
const stars = [];
function initStars(W, H) {
  stars.length = 0;
  for (let i = 0; i < STAR_COUNT; i++) {
    const size = Math.random();
    stars.push({
      x: Math.random() * W, y: Math.random() * H * 0.85,
      r: 0.4 + size * 1.6,
      phase: Math.random() * Math.PI * 2, speed: 0.3 + Math.random() * 0.9,
      hue: Math.random() < 0.15 ? 210 : Math.random() < 0.1 ? 30 : 0,
      sat: Math.random() < 0.25 ? (20 + Math.random() * 40) : 0,
    });
  }
  for (let i = 0; i < 120; i++) {
    stars.push({
      x: Math.random() * W, y: H * 0.15 + Math.random() * H * 0.45,
      r: 0.25 + Math.random() * 0.6,
      phase: Math.random() * Math.PI * 2, speed: 0.15 + Math.random() * 0.4,
      hue: 220, sat: 15 + Math.random() * 20, milkyWay: true,
    });
  }
}
 
function resize() {
  const wrap = canvas.parentElement;
  canvas.width = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
  initStars(canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
resize();
 
// ─── Emission lines per source type ───────────────────────────────────────────
const SOURCE_LINES = {
  flashlight: [445],
  moon:       [434, 486, 588, 656],
  sun:        [393, 434, 486, 527, 588, 630, 656, 686],
  galaxy:     [372, 434, 486, 527, 588, 630, 656, 686, 720],
  quasar:     [334, 372, 434, 486, 527, 588, 630, 656, 686, 720, 760]
};
 
const SOURCE_CHAR_WAVELENGTH = {
  flashlight: 445, moon: 560, sun: 575, galaxy: 490, quasar: 400,
};
 
function getBaseWavelength(source) {
  return SOURCE_CHAR_WAVELENGTH[source] ?? SOURCE_LINES[source][Math.floor(SOURCE_LINES[source].length / 2)];
}
 
// ─── Color helpers ────────────────────────────────────────────────────────────
function wavelengthToColor(nm, alpha = 1) {
  let r = 0, g = 0, b = 0;
  if (nm < 380)       { r = 0.6;  g = 0;   b = 0.8;  }
  else if (nm < 440)  { r = (440 - nm) / 60; g = 0; b = 1; }
  else if (nm < 490)  { r = 0;   g = (nm - 440) / 50; b = 1; }
  else if (nm < 510)  { r = 0;   g = 1; b = (510 - nm) / 20; }
  else if (nm < 580)  { r = (nm - 510) / 70; g = 1; b = 0; }
  else if (nm < 645)  { r = 1;   g = (645 - nm) / 65; b = 0; }
  else if (nm <= 780) { r = 1;   g = 0; b = 0; }
  else                { r = 0.8; g = 0; b = 0; }
  let factor = 1;
  if (nm < 420) factor = 0.3 + 0.7 * (nm - 380) / 40;
  else if (nm > 700) factor = 0.3 + 0.7 * (780 - nm) / 80;
  r = Math.min(1, r * factor); g = Math.min(1, g * factor); b = Math.min(1, b * factor);
  const ri = Math.round(r * 255), gi = Math.round(g * 255), bi = Math.round(b * 255);
  return alpha < 1 ? `rgba(${ri},${gi},${bi},${alpha})` : `rgb(${ri},${gi},${bi})`;
}
 
// ─── Source icon drawers ───────────────────────────────────────────────────────
function drawSourceIcon(cx, cy, size, source, sourceColor) {
  const s = size / 64;
  ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s);
  if (source === 'flashlight') drawFlashlight(sourceColor);
  else if (source === 'moon') drawMoon(sourceColor);
  else if (source === 'sun') drawSun(sourceColor);
  else if (source === 'quasar') drawQuasar(sourceColor);
  else drawGalaxy(sourceColor);
  ctx.restore();
}
 
function drawFlashlight(col) {
  const bodyGrad = ctx.createLinearGradient(-30, -7, -30, 7);
  bodyGrad.addColorStop(0, '#4a4a5a'); bodyGrad.addColorStop(0.45, '#b0b0c8'); bodyGrad.addColorStop(1, '#2a2a3a');
  ctx.beginPath(); ctx.roundRect(-30, -7, 38, 14, 4); ctx.fillStyle = bodyGrad; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
  [-18, -10, -2].forEach(rx => { ctx.beginPath(); ctx.moveTo(rx, -7); ctx.lineTo(rx, 7); ctx.stroke(); });
  ctx.beginPath(); ctx.moveTo(8, -5); ctx.lineTo(16, -3); ctx.lineTo(16, 3); ctx.lineTo(8, 5); ctx.closePath();
  ctx.fillStyle = '#1a1a2e'; ctx.fill();
  const beam = ctx.createLinearGradient(16, 0, 36, 0);
  beam.addColorStop(0, 'rgba(100,140,255,0.95)'); beam.addColorStop(0.5, 'rgba(80,120,255,0.4)'); beam.addColorStop(1, 'rgba(60,100,255,0)');
  ctx.beginPath(); ctx.moveTo(16, -2); ctx.lineTo(36, -7); ctx.lineTo(36, 7); ctx.lineTo(16, 2); ctx.closePath();
  ctx.fillStyle = beam; ctx.fill();
  ctx.beginPath(); ctx.arc(16, 0, 3.5, 0, Math.PI * 2); ctx.fillStyle = '#c0d0ff'; ctx.globalAlpha = 0.95; ctx.fill(); ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.arc(-20, 0, 3, 0, Math.PI * 2); ctx.fillStyle = '#3050ff'; ctx.fill();
}
 
function drawMoon(col) {
  ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
  ctx.globalAlpha = 0.25; ctx.fillStyle = '#000';
  [[-8, -6, 5], [6, 4, 4], [-4, 9, 3], [10, -10, 3]].forEach(([x, y, r]) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); });
  ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.arc(-6, -6, 7, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fill();
}
 
function drawSun(col) {
  ctx.strokeStyle = col; ctx.lineWidth = 2.5;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * 18, Math.sin(a) * 18); ctx.lineTo(Math.cos(a) * 26, Math.sin(a) * 26); ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
  ctx.beginPath(); ctx.arc(-4, -4, 5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fill();
}
 
function drawGalaxy(col) {
  ctx.lineWidth = 1.8;
  for (let arm = 0; arm < 2; arm++) {
    const offset = arm * Math.PI;
    ctx.beginPath();
    for (let i = 0; i <= 80; i++) {
      const theta = (i / 80) * Math.PI * 2.6 + offset;
      const r = (i / 80) * 24;
      const px = Math.cos(theta) * r, py = Math.sin(theta) * r * 0.38;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    const grad = ctx.createLinearGradient(-24, 0, 24, 0);
    grad.addColorStop(0, 'transparent'); grad.addColorStop(0.25, col); grad.addColorStop(0.75, col); grad.addColorStop(1, 'transparent');
    ctx.strokeStyle = grad; ctx.globalAlpha = 0.72; ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.ellipse(0, 0, 21, 4, 0, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1.5; ctx.stroke();
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, 11);
  core.addColorStop(0, '#ffffff'); core.addColorStop(0.35, col); core.addColorStop(1, 'transparent');
  ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fillStyle = core; ctx.fill();
}
 
function drawQuasar(col) {
  ctx.save(); ctx.scale(1, 0.28);
  const disk = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
  disk.addColorStop(0, '#ffffff'); disk.addColorStop(0.2, col); disk.addColorStop(0.6, 'rgba(255,160,60,0.55)'); disk.addColorStop(1, 'transparent');
  ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.fillStyle = disk; ctx.fill(); ctx.restore();
  const jetU = ctx.createLinearGradient(0, -6, 0, -30); jetU.addColorStop(0, 'rgba(160,210,255,0.92)'); jetU.addColorStop(1, 'rgba(100,170,255,0)');
  ctx.beginPath(); ctx.moveTo(-2.5, -6); ctx.lineTo(0, -30); ctx.lineTo(2.5, -6); ctx.closePath(); ctx.fillStyle = jetU; ctx.fill();
  const jetD = ctx.createLinearGradient(0, 6, 0, 30); jetD.addColorStop(0, 'rgba(160,210,255,0.92)'); jetD.addColorStop(1, 'rgba(100,170,255,0)');
  ctx.beginPath(); ctx.moveTo(-2.5, 6); ctx.lineTo(0, 30); ctx.lineTo(2.5, 6); ctx.closePath(); ctx.fillStyle = jetD; ctx.fill();
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, 9);
  core.addColorStop(0, '#ffffff'); core.addColorStop(0.4, col); core.addColorStop(1, 'transparent');
  ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fillStyle = core; ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,200,120,0.3)'; ctx.lineWidth = 2; ctx.stroke();
}
 
// ─── Eye (Observer) ───────────────────────────────────────────────────────────
function drawEye(cx, cy, size) {
  const s = size / 56;
  ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s);
  ctx.beginPath(); ctx.moveTo(-26, 0); ctx.bezierCurveTo(-26, -14, 26, -14, 26, 0); ctx.bezierCurveTo(26, 14, -26, 14, -26, 0);
  ctx.fillStyle = 'rgba(30,30,50,0.55)'; ctx.fill(); ctx.strokeStyle = 'rgba(200,220,255,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
  const irisFill = ctx.createRadialGradient(0, 0, 1, 0, 0, 9); irisFill.addColorStop(0, '#0a6fff'); irisFill.addColorStop(0.6, '#0044bb'); irisFill.addColorStop(1, '#001166');
  ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fillStyle = irisFill; ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, Math.PI * 2); ctx.fillStyle = '#000'; ctx.fill();
  ctx.beginPath(); ctx.arc(-2.5, -2.5, 2.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill();
  ctx.restore();
}
 
// ─── Observer Viewport Window ─────────────────────────────────────────────────
function drawObserverViewport(cx, cy, radius, source, z) {
  const shiftedLambda = getBaseWavelength(source) * (1 + z);
  const shiftedColor = wavelengthToColor(shiftedLambda, 1);
 
  ctx.save();
 
  // Outer ring glow
  const outerGlow = ctx.createRadialGradient(cx, cy, radius * 0.88, cx, cy, radius * 1.22);
  outerGlow.addColorStop(0, wavelengthToColor(shiftedLambda, 0.38));
  outerGlow.addColorStop(1, wavelengthToColor(shiftedLambda, 0));
  ctx.beginPath(); ctx.arc(cx, cy, radius * 1.22, 0, Math.PI * 2);
  ctx.fillStyle = outerGlow; ctx.fill();
 
  // Dark space background inside viewport
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(4,5,18,0.97)'; ctx.fill();
  ctx.clip();
 
  // Mini starfield inside viewport
  ctx.save();
  for (let i = 0; i < 38; i++) {
    const seed = i * 137.508;
    const sx = cx + (Math.sin(seed) * 0.5 + 0.5 - 0.5) * radius * 1.8;
    const sy = cy + (Math.cos(seed * 1.3) * 0.5 + 0.5 - 0.5) * radius * 1.8;
    const sr = 0.4 + (Math.sin(seed * 2.7) * 0.5 + 0.5) * 1.2;
    const sa = 0.25 + (Math.sin(t * 0.4 + seed) * 0.5 + 0.5) * 0.35;
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(220,230,255,${sa})`; ctx.fill();
  }
  ctx.restore();
 
  // Draw source icon, color-shifted
  ctx.save();
  // Apply color tint overlay based on redshift
  const iconSize = radius * 1.05;
  drawSourceIcon(cx, cy, iconSize, source, shiftedColor);
 
  // Redshift color tint overlay
  if (z > 0.005) {
    const tintStrength = Math.min(0.72, z * 0.55);
    const tintGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.9);
    tintGrad.addColorStop(0, wavelengthToColor(shiftedLambda, tintStrength * 0.5));
    tintGrad.addColorStop(0.6, wavelengthToColor(shiftedLambda, tintStrength * 0.3));
    tintGrad.addColorStop(1, wavelengthToColor(shiftedLambda, 0));
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = tintGrad; ctx.fill();
  }
  ctx.restore();
 
  ctx.restore();
 
  // Viewport border ring
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = wavelengthToColor(shiftedLambda, 0.75);
  ctx.lineWidth = 2.5; ctx.stroke();
 
  // Inner thin highlight ring
  ctx.beginPath(); ctx.arc(cx, cy, radius - 4, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(180,200,255,0.15)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
 
  // Label: "Beobachterperspektive" / "Observer's View"
  const lang = document.documentElement.dataset.lang || 'de';
  const label = lang === 'de' ? 'Beobachter-Perspektive' : "Observer's View";
  ctx.save();
  ctx.font = '12px "Inter", system-ui, sans-serif';
  ctx.fillStyle = 'rgba(190,210,255,0.7)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 6;
  ctx.fillText(label, cx, cy + radius + 8);
  ctx.shadowBlur = 0;
  ctx.restore();
 
  // Wavelength label inside viewport at bottom
  if (showWavelength) {
    const nmText = `${Math.round(shiftedLambda)} nm`;
    ctx.save();
    ctx.font = 'bold 13px "Inter", system-ui, sans-serif';
    ctx.fillStyle = shiftedColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.shadowColor = 'rgba(0,0,0,0.95)'; ctx.shadowBlur = 7;
    ctx.fillText(nmText, cx, cy + radius - 7);
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}
 
// ─── Wave gradient ─────────────────────────────────────────────────────────────
function drawWaveGradient(x0, x1, y, baseLambda, shiftedLambda, wavelengthPx, phase) {
  const amplitude = 22;
  const segments = Math.ceil((x1 - x0) / 4);
  const segWidth = (x1 - x0) / segments;
  for (let s = 0; s < segments; s++) {
    const progress = s / segments;
    const nmAtPoint = baseLambda + (shiftedLambda - baseLambda) * progress;
    const color = wavelengthToColor(nmAtPoint, 0.9);
    const sx0 = x0 + s * segWidth, sx1 = sx0 + segWidth + 1;
    ctx.save(); ctx.beginPath();
    let first = true;
    for (let x = sx0; x <= sx1; x += 1) {
      const globalProgress = (x - x0) / (x1 - x0);
      const nmHere = baseLambda + (shiftedLambda - baseLambda) * globalProgress;
      const localPx = wavelengthPx * (nmHere / baseLambda);
      const wy = y + Math.sin(((x - x0) / localPx) * Math.PI * 2 - phase) * amplitude;
      if (first) { ctx.moveTo(x, wy); first = false; } else ctx.lineTo(x, wy);
    }
    ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.shadowColor = color; ctx.shadowBlur = 5; ctx.stroke(); ctx.shadowBlur = 0; ctx.restore();
  }
  const lastColor = wavelengthToColor(shiftedLambda, 1);
  const prevX = x1 - 4;
  const prevProg = (prevX - x0) / (x1 - x0);
  const nmAtEnd = shiftedLambda, nmAtPrev = baseLambda + (shiftedLambda - baseLambda) * prevProg;
  const localPxEnd = wavelengthPx * (nmAtEnd / baseLambda), localPxPrev = wavelengthPx * (nmAtPrev / baseLambda);
  const lastY = y + Math.sin(((x1 - x0) / localPxEnd) * Math.PI * 2 - phase) * amplitude;
  const prevY = y + Math.sin(((prevX - x0) / localPxPrev) * Math.PI * 2 - phase) * amplitude;
  const angle = Math.atan2(lastY - prevY, x1 - prevX);
  const aLen = 10;
  ctx.save(); ctx.beginPath();
  ctx.moveTo(x1, lastY); ctx.lineTo(x1 - aLen * Math.cos(angle - 0.45), lastY - aLen * Math.sin(angle - 0.45));
  ctx.moveTo(x1, lastY); ctx.lineTo(x1 - aLen * Math.cos(angle + 0.45), lastY - aLen * Math.sin(angle + 0.45));
  ctx.strokeStyle = lastColor; ctx.lineWidth = 2; ctx.shadowColor = lastColor; ctx.shadowBlur = 4; ctx.stroke(); ctx.shadowBlur = 0; ctx.restore();
}
 
// ─── Starfield ────────────────────────────────────────────────────────────────
function drawStarfield(W, H) {
  for (const star of stars) {
    const twinkle = playing ? 0.65 + 0.35 * Math.sin(t * star.speed + star.phase) : 0.85;
    const alpha = (star.milkyWay ? 0.18 : 0.55) * twinkle;
    ctx.save();
    if (star.r > 1.2 && !star.milkyWay) {
      const glow = ctx.createRadialGradient(star.x, star.y, 0, star.x, star.y, star.r * 3.5);
      const col = star.sat > 0 ? `hsla(${star.hue},${star.sat}%,95%,` : `rgba(255,255,255,`;
      glow.addColorStop(0, col + alpha + ')'); glow.addColorStop(0.4, col + (alpha * 0.3) + ')'); glow.addColorStop(1, col + '0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(star.x, star.y, star.r * 3.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    ctx.fillStyle = star.sat > 0 ? `hsla(${star.hue},${star.sat}%,98%,${Math.min(1, alpha * 1.4)})` : `rgba(255,255,255,${Math.min(1, alpha * 1.4)})`;
    ctx.fill(); ctx.restore();
  }
}
 
// ─── Spectrum ─────────────────────────────────────────────────────────────────
const UV_MARGIN = 28, IR_MARGIN = 36, IR_CAP = 1600;
 
function getSpectrumRange(src, z) {
  const lines = SOURCE_LINES[src];
  const minLine = Math.min(...lines), maxLine = Math.max(...lines);
  const shiftedMax = maxLine * (1 + z);
  const extMin = Math.min(minLine - UV_MARGIN, 380 - UV_MARGIN);
  const extMax = Math.min(Math.max(780 + IR_MARGIN, shiftedMax * 1.06), IR_CAP);
  return { extMin, extMax };
}
 
function generateTicks(extMin, extMax) {
  const range = extMax - extMin;
  let step;
  if (range <= 250) step = 30;
  else if (range <= 600) step = 50;
  else if (range <= 1000) step = 100;
  else if (range <= 1500) step = 200;
  else step = 300;
  const ticks = [];
  for (let nm = Math.ceil(extMin / step) * step; nm <= extMax; nm += step) ticks.push(nm);
  return ticks;
}
 
function drawSpectrum(x, y, w, h) {
  const z = getRedshift();
  const src = getCurrentSource();
  const lines = SOURCE_LINES[src];
  const { extMin, extMax } = showDynamicSpectrum ? getSpectrumRange(src, z) : { extMin: 380, extMax: 780 };
  const range = extMax - extMin;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  const specGrad = ctx.createLinearGradient(x, 0, x + w, 0);
  for (let i = 0; i <= 200; i++) specGrad.addColorStop(i / 200, wavelengthToColor(extMin + (i / 200) * range, 1));
  ctx.fillStyle = specGrad; ctx.fillRect(x, y, w, h);
  const gloss = ctx.createLinearGradient(x, y, x, y + h * 0.35);
  gloss.addColorStop(0, 'rgba(255,255,255,0.16)'); gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss; ctx.fillRect(x, y, w, h * 0.35);
  if (showDynamicSpectrum) {
    const lang = document.documentElement.dataset.lang || 'de';
    const visStartX = x + (380 - extMin) / range * w, visEndX = x + (780 - extMin) / range * w;
    const leftMask = ctx.createLinearGradient(x, 0, visStartX, 0);
    leftMask.addColorStop(0, 'rgba(0,0,0,1)'); leftMask.addColorStop(0.55, 'rgba(0,0,0,0.75)'); leftMask.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = leftMask; ctx.fillRect(x, y, visStartX - x, h);
    const rightMask = ctx.createLinearGradient(visEndX, 0, x + w, 0);
    rightMask.addColorStop(0, 'rgba(0,0,0,0)'); rightMask.addColorStop(0.45, 'rgba(0,0,0,0.75)'); rightMask.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = rightMask; ctx.fillRect(visEndX, y, x + w - visEndX, h);
    ctx.font = 'bold 13px "Inter", sans-serif'; ctx.textBaseline = 'middle';
    if (380 - extMin > 40) {
      const uvMidX = x + (((extMin + (380 - extMin) * 0.5) - extMin) / range) * w;
      ctx.fillStyle = 'rgba(210,170,255,0.92)'; ctx.textAlign = 'center'; ctx.fillText('UV', uvMidX, y + h / 2);
    }
    if (extMax - 780 > 40) {
      const irMidX = x + ((780 + (extMax - 780) * 0.5 - extMin) / range) * w;
      ctx.fillStyle = 'rgba(255,150,110,0.92)'; ctx.textAlign = 'center'; ctx.fillText('IR', irMidX, y + h / 2);
    }
  }
  lines.forEach(lam => {
    const xp = x + ((lam - extMin) / range) * w;
    if (xp < x || xp > x + w) return;
    ctx.save(); ctx.beginPath(); ctx.moveTo(xp, y + h * 0.06); ctx.lineTo(xp, y + h * 0.94);
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 4; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(xp, y + h * 0.06); ctx.lineTo(xp, y + h * 0.94);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 1.8; ctx.stroke(); ctx.restore();
  });
  if (z > 0.01) {
    lines.forEach(lam => {
      const shifted = lam * (1 + z);
      const xp = x + ((shifted - extMin) / range) * w;
      if (xp < x || xp > x + w) return;
      const shiftedColor = z > 0.5 ? '#ef4444' : '#f97316';
      ctx.save(); ctx.beginPath(); ctx.moveTo(xp, y + h * 0.06); ctx.lineTo(xp, y + h * 0.94);
      ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 4; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(xp, y + h * 0.06); ctx.lineTo(xp, y + h * 0.94);
      ctx.strokeStyle = shiftedColor; ctx.lineWidth = 2.2; ctx.shadowColor = shiftedColor; ctx.shadowBlur = 5; ctx.stroke(); ctx.shadowBlur = 0; ctx.restore();
    });
    const refLine = lines[Math.floor(lines.length / 2)];
    const x0s = x + ((refLine - extMin) / range) * w;
    const x1s = x + ((refLine * (1 + z) - extMin) / range) * w;
    if (x1s > x && x1s < x + w && x0s >= x) {
      const arrowY = y + h + 10;
      ctx.beginPath(); ctx.moveTo(x0s, arrowY); ctx.lineTo(x1s, arrowY);
      ctx.strokeStyle = '#f97316'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(x1s, arrowY); ctx.lineTo(x1s - 6, arrowY - 4); ctx.moveTo(x1s, arrowY); ctx.lineTo(x1s - 6, arrowY + 4);
      ctx.strokeStyle = '#f97316'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }
  const nmTicks = showDynamicSpectrum ? generateTicks(extMin, extMax) : [380, 430, 480, 530, 580, 630, 680, 730, 780];
  ctx.font = '13px "Inter", sans-serif'; ctx.textBaseline = 'top'; ctx.fillStyle = 'rgba(190,205,240,0.92)';
  nmTicks.forEach(nm => {
    const xp = x + ((nm - extMin) / range) * w;
    if (xp < x || xp > x + w) return;
    ctx.textAlign = 'center'; ctx.fillText(nm, xp, y + h + 16);
    ctx.beginPath(); ctx.moveTo(xp, y + h); ctx.lineTo(xp, y + h + 4);
    ctx.strokeStyle = 'rgba(130,145,180,0.4)'; ctx.lineWidth = 1; ctx.stroke();
  });
  ctx.restore();
}
 
function drawLabel(text, lx, ly, color, size = 19) {
  ctx.save(); ctx.font = `${size}px "Inter", system-ui, sans-serif`; ctx.fillStyle = color;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;
  ctx.fillText(text, lx, ly); ctx.shadowBlur = 0; ctx.restore();
}
 
function drawDistanceIndicator(x0, x1, y, lang) {
  const label = getDistLabel();
  const midX = (x0 + x1) / 2, lineY = y, tickH = 5;
  ctx.save(); ctx.globalAlpha = 0.55;
  ctx.strokeStyle = 'rgba(140,160,220,0.6)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(x0, lineY); ctx.lineTo(x1, lineY); ctx.stroke(); ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(x0, lineY - tickH); ctx.lineTo(x0, lineY + tickH); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x1, lineY - tickH); ctx.lineTo(x1, lineY + tickH); ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.font = '14px "Inter", system-ui, sans-serif'; ctx.fillStyle = 'rgba(195,215,255,0.96)';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 6;
  ctx.fillText(label, midX, lineY - 14); ctx.shadowBlur = 0; ctx.restore();
}
 
function drawExpansionGrid(y, x0, x1, expansion) {
  if (expansion <= 0.01) return;
  ctx.save(); ctx.globalAlpha = expansion * 0.18;
  const spacing = 40;
  for (let x = x0; x < x1; x += spacing) {
    ctx.beginPath(); ctx.moveTo(x, y - 40); ctx.lineTo(x, y + 40);
    ctx.strokeStyle = '#f472b6'; ctx.lineWidth = 0.5; ctx.setLineDash([3, 6]); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.restore();
}
 
// ─── Main draw ────────────────────────────────────────────────────────────────
function draw() {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
  skyGrad.addColorStop(0, '#04050e'); skyGrad.addColorStop(1, '#0a0c1e');
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H);
  if (showStarfield) drawStarfield(W, H);
 
  const z = getRedshift();
  const src = getCurrentSource();
  const lang = document.documentElement.dataset.lang || 'de';
 
  const specH = 85, specMarginBottom = 44, specY = H - specMarginBottom - specH;
  const specPad = 40, specX = specPad, specW = W - specPad * 2;
  const waveAreaH = specY - 10, centerY = waveAreaH / 2;
 
  // Observer viewport radius scales with canvas
  const vpRadius = Math.max(38, Math.min(62, H * 0.09));
  const EMITTER_X = 80;
  const OBSERVER_X = W - 80;
  const vpCenterY = centerY - vpRadius * 1.8; // above the eye
 
  const baseLambdaNm = getBaseWavelength(src);
  const shiftedLambda = baseLambdaNm * (1 + z);
  const sourceColor = wavelengthToColor(baseLambdaNm, 1);
 
  const restWavePx = 40;
 
  if (expansionVal > 0.01) drawExpansionGrid(centerY, EMITTER_X + 50, OBSERVER_X - 50, expansionVal);
 
  const waveStartX = EMITTER_X + 30, waveEndX = OBSERVER_X - 32;
  if (waveEndX > waveStartX + 30) drawWaveGradient(waveStartX, waveEndX, centerY, baseLambdaNm, shiftedLambda, restWavePx, t * 3.5);
 
  // ── Emitter
  const srcNames = {
    de: { flashlight: 'Blaulaser', moon: 'Mond', sun: 'Sonne', galaxy: 'Galaxie', quasar: 'Quasar' },
    en: { flashlight: 'Blue Laser', moon: 'Moon', sun: 'Sun', galaxy: 'Galaxy', quasar: 'Quasar' }
  };
  const srcLabel = (srcNames[lang] ?? srcNames.en)[src];
  const ICON_SIZE = 46;
  ctx.save(); ctx.shadowColor = sourceColor; ctx.shadowBlur = 28;
  ctx.beginPath(); ctx.arc(EMITTER_X, centerY, ICON_SIZE * 0.45, 0, Math.PI * 2); ctx.fillStyle = 'transparent'; ctx.fill(); ctx.restore();
  drawSourceIcon(EMITTER_X, centerY, ICON_SIZE, src, sourceColor);
  drawLabel(srcLabel, EMITTER_X, centerY + ICON_SIZE / 2 + 18, 'rgba(215,225,255,0.95)', 18);
 
  // ── Observer
  const eyeSize = 52;
  drawEye(OBSERVER_X, centerY, eyeSize);
  const eyeLabel = lang === 'de' ? 'Beobachter' : 'Observer';
  drawLabel(eyeLabel, OBSERVER_X, centerY + eyeSize / 2 + 14, 'rgba(215,225,255,0.95)', 18);
 
  // ── Observer viewport window (above eye)
  drawObserverViewport(OBSERVER_X, vpCenterY, vpRadius, src, z);
 
  // Subtle connecting line from viewport to eye
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(OBSERVER_X, vpCenterY + vpRadius);
  ctx.lineTo(OBSERVER_X, centerY - eyeSize * 0.4);
  ctx.strokeStyle = 'rgba(180,200,255,0.18)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 5]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
 
  if (waveEndX > waveStartX + 60) drawDistanceIndicator(EMITTER_X + 30, OBSERVER_X - 30, centerY + 52, lang);
 
  if (showWavelength && waveEndX > waveStartX + 60) {
    const midX = (waveStartX + waveEndX) / 2;
    const nmText = `${Math.round(shiftedLambda)} nm`;
    const colorText = wavelengthToColor(shiftedLambda, 1);
    drawLabel(nmText, midX, centerY - 40, colorText, 21);
    if (z > 0.02) {
      const restText = `(${Math.round(baseLambdaNm)} nm ${lang === 'de' ? 'Ruhe' : 'rest'})`;
      drawLabel(restText, midX, centerY - 65, 'rgba(210,220,255,0.88)', 16);
    }
  }
 
  if (z > 0.005) {
    const zText = `z = ${z.toFixed(2)}`;
    ctx.save(); ctx.font = 'bold 22px "Inter", system-ui, sans-serif'; ctx.fillStyle = '#86efac';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;
    ctx.fillText(zText, OBSERVER_X - 40, centerY - 40); ctx.shadowBlur = 0; ctx.restore();
  }
 
  if (expansionVal > 0.05) {
    const arrowY = centerY + 70, midX2 = (EMITTER_X + OBSERVER_X) / 2;
    const spread = (OBSERVER_X - EMITTER_X) * 0.22 * expansionVal, al = 8;
    ctx.save(); ctx.globalAlpha = Math.min(0.85, expansionVal * 1.2); ctx.strokeStyle = '#f472b6'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(midX2, arrowY); ctx.lineTo(midX2 - spread, arrowY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(midX2 - spread, arrowY); ctx.lineTo(midX2 - spread + al, arrowY - al * 0.5); ctx.moveTo(midX2 - spread, arrowY); ctx.lineTo(midX2 - spread + al, arrowY + al * 0.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(midX2, arrowY); ctx.lineTo(midX2 + spread, arrowY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(midX2 + spread, arrowY); ctx.lineTo(midX2 + spread - al, arrowY - al * 0.5); ctx.moveTo(midX2 + spread, arrowY); ctx.lineTo(midX2 + spread - al, arrowY + al * 0.5); ctx.stroke();
    const expLabel = lang === 'de' ? 'Raum dehnt sich aus' : 'Space is expanding';
    ctx.font = '15px "Inter", system-ui, sans-serif'; ctx.fillStyle = '#fbcfe8';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(expLabel, midX2, arrowY + 14); ctx.restore();
  }
 
  ctx.save(); ctx.font = '15px "Inter", system-ui, sans-serif'; ctx.fillStyle = 'rgba(200,215,255,0.88)';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const specLabel = lang === 'de' ? 'Emissionsspektrum' : 'Emission spectrum';
  ctx.fillText(specLabel, specX + specW / 2, specY - 20); ctx.restore();
 
  drawSpectrum(specX, specY, specW, specH);
}
 
// ─── Animation loop ───────────────────────────────────────────────────────────
function loop(ts) {
  if (lastTs !== null && playing) { const dt = Math.min((ts - lastTs) / 1000, 0.05); t += dt; }
  lastTs = ts; draw(); requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
 
// ─── Control handlers ─────────────────────────────────────────────────────────
function onRealisticModeChange(v) { realisticMode = v; }
 
function onExpansionChange(v) {
  expansionVal = parseFloat(v);
  document.getElementById('expansionVal').textContent = expansionVal.toFixed(2);
}
 
function onDistanceChange(v) {
  sliderPos = parseInt(v);
  updateDistDisplay();
}
 
function updateDistDisplay() {
  const lang = document.documentElement.dataset.lang || 'de';
  const label = getDistLabel();
  document.getElementById('distLabelDisplay').textContent = label;
}
 
function onShowWavelengthChange(v) { showWavelength = v; }
function onShowDynamicSpectrumChange(v) { showDynamicSpectrum = v; }
function onShowStarfieldChange(v) { showStarfield = v; }
 
function togglePlay() {
  playing = !playing;
  const btn = document.getElementById('playPause');
  btn.querySelector('[data-lang-text="de"]').textContent = playing ? 'Pause' : 'Abspielen';
  btn.querySelector('[data-lang-text="en"]').textContent = playing ? 'Pause' : 'Play';
}
 
document.getElementById('langToggle').addEventListener('click', () => {
  const html = document.documentElement;
  const cur = html.dataset.lang || 'de';
  const next = cur === 'de' ? 'en' : 'de';
  html.dataset.lang = next;
  html.lang = next;
  document.querySelectorAll('[data-lang-text]').forEach(el => {
    el.style.display = el.getAttribute('data-lang-text') === next ? '' : 'none';
  });
  updateDistDisplay();
});
 
(function initLang() {
  const lang = document.documentElement.dataset.lang || 'de';
  document.querySelectorAll('[data-lang-text]').forEach(el => {
    el.style.display = el.getAttribute('data-lang-text') === lang ? '' : 'none';
  });
  updateDistDisplay();
})();