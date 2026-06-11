document.getElementById('langToggle').addEventListener('click', () => {
  const html = document.documentElement;
  html.dataset.lang = html.dataset.lang === 'en' ? 'de' : 'en';
  html.lang = html.dataset.lang;
});

(() => {
  const canvas = document.getElementById('universe');
  const ctx = canvas.getContext('2d');

  const H0Input             = document.getElementById('H0');
  const H0Val               = document.getElementById('H0Val');
  const countInput          = document.getElementById('count');
  const countVal            = document.getElementById('countVal');
  const timeScaleInput      = document.getElementById('timeScale');
  const timeScaleVal        = document.getElementById('timeScaleVal');
  const accelInput          = document.getElementById('accel');
  const accelVal            = document.getElementById('accelVal');
  const gravityToggle       = document.getElementById('gravityToggle');
  const gravityControls     = document.getElementById('gravityControls');
  const gravityInput        = document.getElementById('gravityStrength');
  const gravityVal          = document.getElementById('gravityVal');
  const drawStarfieldToggle = document.getElementById('drawStarfield');
  const playPauseBtn        = document.getElementById('playPause');
  const regenBtn            = document.getElementById('regenerate');
  const zoomInBtn           = document.getElementById('zoomIn');
  const zoomOutBtn          = document.getElementById('zoomOut');

  // H0 slider: input t ∈ [0,1] → output ∈ [0,1], exponentially distributed.
  // (e^(k·t) − 1) / (e^k − 1) with k = 6: at t=0.5 the output is only ~0.025,
  // so the left 80% of slider travel covers 0..~0.2 — fine control at low values.
  const H0_LOG_K = 6;
  function sliderToH0(t)    { return (Math.exp(H0_LOG_K * t) - 1) / (Math.exp(H0_LOG_K) - 1); }
  const ACCEL_MAX = 20.0;
  function sliderToAccel(t) { return t <= 0 ? 0 : Math.exp(t * Math.log(ACCEL_MAX + 1)) - 1; }
  function readH0()         { return sliderToH0(parseFloat(H0Input.value)); }
  function readAccel()      { return sliderToAccel(parseFloat(accelInput.value)); }

  const cellW = 8000, cellH = 8000;

  // ─── KEY CHANGE ───────────────────────────────────────────────────────────
  // camX / camY are now stored in COMOVING units (not physical pixels).
  // Physical position of a galaxy on screen:
  //   screenX = cx + (comovX - camX) * scaleFactor * zoom
  // This means every galaxy is an equally valid "center of expansion":
  // if you park camX on any galaxy's comovX, that galaxy stays still while
  // all others recede from it in proportion to their comoving distance.
  // ──────────────────────────────────────────────────────────────────────────
  let camX = 0, camY = 0, zoom = 0.38;
  let galaxies = [], stars = [], running = true, lastT = null, simTime = 0, scaleFactor = 1.0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }
  new ResizeObserver(resize).observe(canvas);
  window.addEventListener('resize', resize);
  resize();

  function rand(a, b)          { return a + Math.random() * (b - a); }
  function clamp(v, lo, hi)    { return Math.min(hi, Math.max(lo, v)); }
  function getCanvasXY(cx, cy) { const r = canvas.getBoundingClientRect(); return { x: cx - r.left, y: cy - r.top }; }

  // ─── zoom pivot in comoving space ─────────────────────────────────────────
  // px,py are canvas pixel coords of the pivot point.
  // We compute what comoving point lies under px,py before and keep it fixed.
  function applyZoom(px, py, f) {
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const nz = clamp(zoom * f, 0.06, 20);
    // comoving coord under the pivot:  camX + (px - cx) / (scaleFactor * zoom)
    // must equal after zoom:            camX' + (px - cx) / (scaleFactor * nz)
    camX += (px - cx) / (scaleFactor * zoom) - (px - cx) / (scaleFactor * nz);
    camY += (py - cy) / (scaleFactor * zoom) - (py - cy) / (scaleFactor * nz);
    zoom = nz;
  }

  function wrapComov(v, half) {
    const s = half * 2; v = v % s;
    if (v < -half) v += s; if (v >= half) v -= s; return v;
  }

  // Wrap a comoving coordinate to be nearest to a comoving reference
  function nearestPeriodicComovX(cx, ref) {
    let d = cx - ref; d -= cellW * Math.round(d / cellW); return ref + d;
  }
  function nearestPeriodicComovY(cy, ref) {
    let d = cy - ref; d -= cellH * Math.round(d / cellH); return ref + d;
  }

  // Physical helpers kept for gravity (which works in physical space)
  function physCellW() { return cellW * scaleFactor; }
  function physCellH() { return cellH * scaleFactor; }
  function nearestPeriodicX(px, ref) { const pw = physCellW(); let d = px - ref; d -= pw * Math.round(d / pw); return ref + d; }
  function nearestPeriodicY(py, ref) { const ph = physCellH(); let d = py - ref; d -= ph * Math.round(d / ph); return ref + d; }

  function makeGalaxy() {
    const rnd  = Math.random();
    const type = rnd < 0.28 ? 1 : rnd < 0.48 ? 2 : rnd < 0.63 ? 0 : rnd < 0.78 ? 4 : rnd < 0.92 ? 3 : 5;
    const hueBase = [50, 210, 200, 320, 120, 350][type];
    return {
      comovX: rand(-cellW * .5, cellW * .5), comovY: rand(-cellH * .5, cellH * .5),
      peculiarX: 0, peculiarY: 0, vx: 0, vy: 0, type,
      r: type === 5 ? rand(3,7) : type === 3 ? rand(6,14) : rand(8,20),
      hue: hueBase + rand(-28,28), sat: rand(55,85), spin: rand(-.4,.4),
      phase: Math.random() * Math.PI * 2, tilt: rand(.25,1),
      arms: type === 1 ? Math.floor(rand(2,5)) : 2, barLen: type === 2 ? rand(.8,1.6) : 0,
      spots: (type===3||type===5) ? Math.floor(rand(3,8)) : 0,
      spotAngles: Array.from({length:8}, () => Math.random()*Math.PI*2),
      irregScaleX: rand(.6,1), irregScaleY: rand(.5,.9),
      cache: null, cacheSize: 0, cacheHalf: 0,
    };
  }

  function buildCache(g) {
    const maxR = ([2.8,3.5,3.5+g.barLen,2.5,3.2,2.0][g.type] ?? 3.5) * g.r * 1.15;
    const size = Math.ceil(maxR * 2), half = size / 2;
    const oc = new OffscreenCanvas(size, size), octx = oc.getContext('2d');
    octx.clearRect(0,0,size,size); octx.save(); octx.translate(half,half);
    renderGalaxyOnCtx(octx, g); octx.restore();
    g.cache = oc; g.cacheSize = size; g.cacheHalf = half;
  }

  function makeStars(n) {
    stars = Array.from({length:n}, () => ({
      nx: Math.random(), ny: Math.random(),
      s: Math.random()<.04 ? rand(1.4,2.4) : rand(.3,1.1),
      br: rand(.25,.9), twinkleOff: Math.random()*100,
    }));
  }

  function update(dt) {
    const H0 = readH0(), accel = readAccel();
    const timeScale = parseFloat(timeScaleInput.value);
    const gravityOn = gravityToggle.checked;
    const gravityStrength = gravityOn ? parseFloat(gravityInput.value) : 0;
    const dtSim = dt * timeScale; simTime += dtSim;
    const H = H0 * (1 + accel * simTime);
    if (gravityOn && gravityStrength > 0 && galaxies.length > 1) applyAttraction(dtSim, gravityStrength);
    const brake = gravityOn ? Math.min(.42, gravityStrength * .06) : 0;
    scaleFactor *= Math.exp(Math.max(0, H * (1 - brake)) * dtSim);
    for (const g of galaxies) {
      g.phase += g.spin * dtSim;
      g.comovX = wrapComov(g.comovX, cellW * .5);
      g.comovY = wrapComov(g.comovY, cellH * .5);
    }
  }

  // Returns PHYSICAL position for use in gravity calculations
  function getGalaxyPhysPos(g) {
    return {
      x: nearestPeriodicX(g.comovX * scaleFactor + g.peculiarX, camX * scaleFactor),
      y: nearestPeriodicY(g.comovY * scaleFactor + g.peculiarY, camY * scaleFactor),
    };
  }

  function applyAttraction(dtSim, strength) {
    const count = galaxies.length; if (!count) return;
    const positions = galaxies.map(g => getGalaxyPhysPos(g));
    const cellSize = Math.max(140, 220 + strength * 90);
    const attrRange = 240 + strength * 160, attrRangeSq = attrRange * attrRange;
    const mergeRange = 18 + strength * 12, mergeRangeSq = mergeRange * mergeRange;
    const grid = new Map();
    for (let i = 0; i < count; i++) {
      const p = positions[i], gx = Math.floor(p.x/cellSize), gy = Math.floor(p.y/cellSize);
      const k = `${gx},${gy}`; if (!grid.has(k)) grid.set(k,[]); grid.get(k).push(i);
    }
    const ax = new Float64Array(count), ay = new Float64Array(count), mc = [];
    for (let i = 0; i < count; i++) {
      const pi = positions[i], gx = Math.floor(pi.x/cellSize), gy = Math.floor(pi.y/cellSize);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const bucket = grid.get(`${gx+ox},${gy+oy}`); if (!bucket) continue;
        for (const j of bucket) {
          if (j <= i) continue;
          const pj = positions[j], dx = pj.x-pi.x, dy = pj.y-pi.y, dSq = dx*dx+dy*dy;
          if (dSq > attrRangeSq) continue;
          const dist = Math.sqrt(dSq)+.001, pull = strength*32/(dSq+2600);
          ax[i] += dx*pull; ay[i] += dy*pull; ax[j] -= dx*pull; ay[j] -= dy*pull;
          if (dSq <= mergeRangeSq) {
            const rv = ((galaxies[j].vx-galaxies[i].vx)*dx+(galaxies[j].vy-galaxies[i].vy)*dy)/dist;
            if (rv < 0 && Math.random() < clamp(strength*.05+Math.max(0,-rv)/180, 0, .35)) mc.push({i,j,dSq});
          }
        }
      }
    }
    const damp = clamp(1 - dtSim*(.025+strength*.01), .94, 1), maxSpd = 140+strength*80;
    for (let i = 0; i < count; i++) {
      const g = galaxies[i];
      g.vx = (g.vx+ax[i]*dtSim)*damp; g.vy = (g.vy+ay[i]*dtSim)*damp;
      const spd = Math.hypot(g.vx,g.vy); if (spd>maxSpd) { g.vx*=maxSpd/spd; g.vy*=maxSpd/spd; }
      g.peculiarX += g.vx*dtSim; g.peculiarY += g.vy*dtSim;
      const hpw = physCellW()*.5, hph = physCellH()*.5;
      if (Math.abs(g.peculiarX) > hpw) { g.comovX=wrapComov(g.comovX+g.peculiarX/scaleFactor,cellW*.5); g.peculiarX=0; }
      if (Math.abs(g.peculiarY) > hph) { g.comovY=wrapComov(g.comovY+g.peculiarY/scaleFactor,cellH*.5); g.peculiarY=0; }
    }
    if (!mc.length) return;
    mc.sort((a,b) => { const ah=Math.max(a.i,a.j),bh=Math.max(b.i,b.j); return bh!==ah?bh-ah:Math.min(b.i,b.j)-Math.min(a.i,a.j); });
    const merged = new Set();
    for (const pair of mc) {
      const lo=Math.min(pair.i,pair.j), hi=Math.max(pair.i,pair.j);
      if (merged.has(lo)||merged.has(hi)||lo>=galaxies.length||hi>=galaxies.length) continue;
      const gA=galaxies[lo],gB=galaxies[hi],pA=positions[lo],pB=positions[hi];
      const mA=gA.r*gA.r,mB=gB.r*gB.r,tot=mA+mB;
      const dom=gA.r>=gB.r?gA:gB;
      const mg = {...dom,
        comovX: wrapComov((pA.x*mA+pB.x*mB)/tot/Math.max(scaleFactor,1e-6),cellW*.5),
        comovY: wrapComov((pA.y*mA+pB.y*mB)/tot/Math.max(scaleFactor,1e-6),cellH*.5),
        peculiarX:0,peculiarY:0,vx:((gA.vx+gB.vx)*.5)*.35,vy:((gA.vy+gB.vy)*.5)*.35,
        r: clamp(Math.max(gA.r,gB.r)*(1.08+strength*.03),Math.max(gA.r,gB.r),Math.max(gA.r,gB.r)*1.45),
        hue:(gA.hue*mA+gB.hue*mB)/tot,sat:clamp((gA.sat+gB.sat)*.5+2,35,92),
        spin:(gA.spin+gB.spin)*.5,phase:(gA.phase+gB.phase)*.5,
        tilt:clamp(Math.max(gA.tilt,gB.tilt),.18,1.1),
        spotAngles:dom.spotAngles.slice(),cache:null,cacheSize:0,cacheHalf:0,
      };
      buildCache(mg); galaxies[lo]=mg; galaxies.splice(hi,1); merged.add(lo);
    }
  }

  function drawElliptical(octx,r,hue,sat,tilt) {
    const grd=octx.createRadialGradient(0,0,r*.05,0,0,r*2.8);
    grd.addColorStop(0,`hsla(${hue},${sat}%,95%,1)`);grd.addColorStop(.15,`hsla(${hue},${sat}%,80%,.95)`);
    grd.addColorStop(.5,`hsla(${hue-10},${sat-10}%,55%,.5)`);grd.addColorStop(1,`hsla(${hue},50%,30%,0)`);
    octx.save();octx.scale(1,tilt*.6);octx.fillStyle=grd;octx.beginPath();octx.arc(0,0,r*2.8,0,Math.PI*2);octx.fill();octx.restore();
    const cg=octx.createRadialGradient(0,0,0,0,0,r*.5);
    cg.addColorStop(0,'rgba(255,255,240,.98)');cg.addColorStop(.6,`hsla(${hue},60%,80%,.6)`);cg.addColorStop(1,'rgba(0,0,0,0)');
    octx.fillStyle=cg;octx.beginPath();octx.arc(0,0,r*.5,0,Math.PI*2);octx.fill();
  }

  function drawSpiral(octx,r,hue,sat,tilt,arms,barLen) {
    const dg=octx.createRadialGradient(0,0,r*.1,0,0,r*3.5);
    dg.addColorStop(0,`hsla(${hue},${sat}%,90%,.9)`);dg.addColorStop(.3,`hsla(${hue},${sat}%,65%,.45)`);
    dg.addColorStop(.7,`hsla(${hue-15},${sat-10}%,40%,.15)`);dg.addColorStop(1,'rgba(0,0,0,0)');
    octx.save();octx.scale(1,tilt);octx.fillStyle=dg;octx.beginPath();octx.arc(0,0,r*3.5,0,Math.PI*2);octx.fill();
    if (barLen>0) { octx.strokeStyle=`hsla(${hue},${sat}%,88%,.65)`;octx.lineWidth=r*.28;octx.lineCap='round';octx.beginPath();octx.moveTo(-r*barLen,0);octx.lineTo(r*barLen,0);octx.stroke(); }
    const na=arms||2;
    for (let a=0;a<na;a++) {
      const ao=a*(Math.PI*2/na);
      for (let pass=0;pass<2;pass++) {
        octx.strokeStyle=pass===0?`hsla(${hue-20},${sat-20}%,25%,.35)`:`hsla(${hue+10},${sat}%,80%,.75)`;
        octx.lineWidth=pass===0?Math.max(1,r*.13):Math.max(.8,r*.09);
        octx.beginPath();let first=true;
        for (let t=.05;t<1.4;t+=.04) {
          const ang=t*Math.PI*1.9+ao+(pass*.08),rad=r*(.5+barLen*.5+3.2*t);
          const px=Math.cos(ang)*rad,py=Math.sin(ang)*rad;
          if(first){octx.moveTo(px,py);first=false;}else octx.lineTo(px,py);
        }
        octx.stroke();
      }
      for (let k=0;k<4;k++) {
        const t=.15+k*.3,ang=t*Math.PI*1.9+ao,rad=r*(.5+barLen*.5+3.2*t);
        const kx=Math.cos(ang)*rad,ky=Math.sin(ang)*rad;
        const kg=octx.createRadialGradient(kx,ky,0,kx,ky,r*.25);
        kg.addColorStop(0,`hsla(${hue+40},90%,90%,.8)`);kg.addColorStop(1,'rgba(0,0,0,0)');
        octx.fillStyle=kg;octx.beginPath();octx.arc(kx,ky,r*.25,0,Math.PI*2);octx.fill();
      }
    }
    octx.restore();
    const ng=octx.createRadialGradient(0,0,0,0,0,r*.4);
    ng.addColorStop(0,'rgba(255,255,245,1)');ng.addColorStop(.5,`hsla(${hue},70%,75%,.8)`);ng.addColorStop(1,'rgba(0,0,0,0)');
    octx.fillStyle=ng;octx.beginPath();octx.arc(0,0,r*.4,0,Math.PI*2);octx.fill();
  }

  function drawIrregular(octx,r,hue,sat,spots,sa,sx,sy) {
    const ig=octx.createRadialGradient(0,0,r*.1,0,0,r*2.5);
    ig.addColorStop(0,`hsla(${hue},${sat}%,85%,.85)`);ig.addColorStop(.4,`hsla(${hue},${sat}%,65%,.5)`);ig.addColorStop(1,'rgba(0,0,0,0)');
    octx.save();octx.scale(sx,sy);octx.fillStyle=ig;octx.beginPath();octx.arc(0,0,r*2.5,0,Math.PI*2);octx.fill();octx.restore();
    for (let i=0;i<spots;i++) {
      const ang=sa[i],dist=r*.3+(sa[(i+4)%8]/(Math.PI*2))*r*1.2;
      const spx=Math.cos(ang)*dist,spy=Math.sin(ang)*dist*.7;
      const sg=octx.createRadialGradient(spx,spy,0,spx,spy,r*.35);
      sg.addColorStop(0,`hsla(${hue+(sa[i]/(Math.PI*2)*60-20)},90%,92%,.9)`);sg.addColorStop(1,'rgba(0,0,0,0)');
      octx.fillStyle=sg;octx.beginPath();octx.arc(spx,spy,r*.35,0,Math.PI*2);octx.fill();
    }
    octx.fillStyle=`hsla(${hue},60%,80%,.7)`;octx.beginPath();octx.arc(0,0,Math.max(.8,r*.25),0,Math.PI*2);octx.fill();
  }

  function drawLenticular(octx,r,hue,sat,tilt) {
    octx.save();octx.scale(1,tilt*.22);
    const lg=octx.createRadialGradient(0,0,r*.05,0,0,r*3.2);
    lg.addColorStop(0,`hsla(${hue},${sat}%,90%,.95)`);lg.addColorStop(.35,`hsla(${hue},${sat-10}%,68%,.65)`);
    lg.addColorStop(.7,`hsla(${hue-5},${sat-20}%,40%,.25)`);lg.addColorStop(1,'rgba(0,0,0,0)');
    octx.fillStyle=lg;octx.beginPath();octx.arc(0,0,r*3.2,0,Math.PI*2);octx.fill();octx.restore();
    octx.save();octx.scale(1,tilt*.08);
    octx.strokeStyle=`hsla(${hue},${sat}%,85%,.5)`;octx.lineWidth=r*.5;
    octx.beginPath();octx.arc(0,0,r*1.8,0,Math.PI*2);octx.stroke();octx.restore();
    const cg=octx.createRadialGradient(0,0,0,0,0,r*.45);
    cg.addColorStop(0,'rgba(255,255,248,1)');cg.addColorStop(.7,`hsla(${hue},50%,70%,.5)`);cg.addColorStop(1,'rgba(0,0,0,0)');
    octx.fillStyle=cg;octx.beginPath();octx.arc(0,0,r*.45,0,Math.PI*2);octx.fill();
  }

  function drawDwarf(octx,r,hue,sat,spots,sa) {
    const dg=octx.createRadialGradient(0,0,0,0,0,r*2);
    dg.addColorStop(0,`hsla(${hue},${sat}%,90%,.7)`);dg.addColorStop(.5,`hsla(${hue},${sat-15}%,65%,.4)`);dg.addColorStop(1,'rgba(0,0,0,0)');
    octx.fillStyle=dg;octx.beginPath();octx.arc(0,0,r*2,0,Math.PI*2);octx.fill();
    for (let i=0;i<Math.min(spots,4);i++) {
      const dist=r*.2+(sa[(i+4)%8]/(Math.PI*2))*r*.7;
      octx.fillStyle=`hsla(${hue+40},90%,90%,${.4+(sa[i]/(Math.PI*2))*.3})`;
      octx.beginPath();octx.arc(Math.cos(sa[i])*dist,Math.sin(sa[i])*dist,.5+(sa[(i+2)%8]/(Math.PI*2)),0,Math.PI*2);octx.fill();
    }
  }

  function renderGalaxyOnCtx(octx,g) {
    switch(g.type) {
      case 0: drawElliptical(octx,g.r,g.hue,g.sat,g.tilt); break;
      case 1: drawSpiral(octx,g.r,g.hue,g.sat,g.tilt,g.arms,0); break;
      case 2: drawSpiral(octx,g.r,g.hue,g.sat,g.tilt,2,g.barLen); break;
      case 3: drawIrregular(octx,g.r,g.hue,g.sat,g.spots,g.spotAngles,g.irregScaleX,g.irregScaleY); break;
      case 4: drawLenticular(octx,g.r,g.hue,g.sat,g.tilt); break;
      case 5: drawDwarf(octx,g.r,g.hue,g.sat,g.spots,g.spotAngles); break;
    }
  }

  function createGalaxies(n) {
    scaleFactor=1; simTime=0; camX=0; camY=0;
    galaxies=Array.from({length:n},()=>{ const g=makeGalaxy(); buildCache(g); return g; });
  }

  let starCanvas=null;
  function buildStarCache() {
    const w=Math.max(canvas.width,1),h=Math.max(canvas.height,1);
    starCanvas=new OffscreenCanvas(w,h);
    const sc=starCanvas.getContext('2d'); sc.clearRect(0,0,w,h);
    for (const s of stars) { sc.fillStyle=`rgba(255,255,255,${s.br})`; sc.beginPath();sc.arc(s.nx*w,s.ny*h,s.s,0,Math.PI*2);sc.fill(); }
  }

  function drawStarfield() {
    if (!starCanvas||starCanvas.width!==canvas.width||starCanvas.height!==canvas.height) buildStarCache();
    ctx.drawImage(starCanvas,0,0);
    for (const s of stars) {
      if (s.s<=1.3) continue;
      ctx.fillStyle=`rgba(255,255,255,${s.br*(0.65+0.35*Math.sin(simTime*2+s.twinkleOff))})`;
      ctx.beginPath();ctx.arc(s.nx*canvas.width,s.ny*canvas.height,s.s,0,Math.PI*2);ctx.fill();
    }
  }

  function draw() {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#010810';ctx.fillRect(0,0,canvas.width,canvas.height);
    if (drawStarfieldToggle.checked) drawStarfield();

    const cx=canvas.width/2, cy=canvas.height/2;

    // ─── KEY CHANGE ─────────────────────────────────────────────────────────
    // Screen projection now uses comoving camera:
    //   screenX = cx + (comovX - camX) * scaleFactor * zoom
    // The toroidal tile count is computed in comoving space so it stays correct
    // regardless of scaleFactor growth.
    // ────────────────────────────────────────────────────────────────────────
    const physZoom = scaleFactor * zoom;            // combined scale: comoving → screen pixels
    const tx = Math.ceil((canvas.width  / 2 / physZoom) / cellW) + 1;
    const ty = Math.ceil((canvas.height / 2 / physZoom) / cellH) + 1;

    for (const g of galaxies) {
      // Peculiar displacement in comoving units
      const peculiarComovX = g.peculiarX / scaleFactor;
      const peculiarComovY = g.peculiarY / scaleFactor;
      const baseComovX = g.comovX + peculiarComovX;
      const baseComovY = g.comovY + peculiarComovY;

      // Nearest periodic comoving copy of this galaxy relative to camera
      const ncx = nearestPeriodicComovX(baseComovX, camX);
      const ncy = nearestPeriodicComovY(baseComovY, camY);

      const sr = g.cacheHalf * zoom;

      for (let ix = -tx; ix <= tx; ix++) {
        const comovWorldX = ncx + ix * cellW;
        const sx = cx + (comovWorldX - camX) * physZoom;
        if (sx < -sr || sx > canvas.width + sr) continue;

        for (let iy = -ty; iy <= ty; iy++) {
          const comovWorldY = ncy + iy * cellH;
          const sy = cy + (comovWorldY - camY) * physZoom;
          if (sy < -sr || sy > canvas.height + sr) continue;

          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(g.phase);
          ctx.scale(zoom, zoom);
          ctx.drawImage(g.cache, -g.cacheHalf, -g.cacheHalf);
          ctx.restore();

          // Redshift tint: based on comoving distance from camera
          const dcomovX = comovWorldX - camX;
          const dcomovY = comovWorldY - camY;
          const cd = Math.sqrt(dcomovX*dcomovX + dcomovY*dcomovY);
          const rf = Math.min(1, cd / Math.sqrt((cellW*.5)**2 + (cellH*.5)**2));
          if (rf > .25) {
            const rh = g.r * zoom * 2.5;
            const rg = ctx.createRadialGradient(sx, sy, 0, sx, sy, rh);
            rg.addColorStop(0, `rgba(255,40,0,${rf*.18})`);
            rg.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = rg;
            ctx.beginPath(); ctx.arc(sx, sy, rh, 0, Math.PI*2); ctx.fill();
          }
        }
      }
    }
  }

  function frame(ts) {
    if (!lastT) lastT=ts;
    const dt=Math.min(.1,(ts-lastT)/1000); lastT=ts;
    if (running) update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  const pointers=new Map();
  let lastPinchDist=null,lastPinchMid=null;
  function mid(a,b){return{x:(a.x+b.x)/2,y:(a.y+b.y)/2};}
  function d2d(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}

  canvas.addEventListener('pointerdown',e=>{
    e.preventDefault();canvas.setPointerCapture(e.pointerId);
    const pos=getCanvasXY(e.clientX,e.clientY);pointers.set(e.pointerId,pos);
    if (pointers.size===2){const pts=[...pointers.values()];lastPinchDist=d2d(pts[0],pts[1]);lastPinchMid=mid(pts[0],pts[1]);}
  });
  canvas.addEventListener('pointermove',e=>{
    e.preventDefault();if(!pointers.has(e.pointerId))return;
    const pos=getCanvasXY(e.clientX,e.clientY);
    if (pointers.size===1){
      const prev=pointers.get(e.pointerId);
      // ─── KEY CHANGE: drag delta converted to comoving units ──────────────
      const physZoom = scaleFactor * zoom;
      camX -= (pos.x - prev.x) / physZoom;
      camY -= (pos.y - prev.y) / physZoom;
    } else if (pointers.size===2) {
      pointers.set(e.pointerId,pos);
      const pts=[...pointers.values()],nd=d2d(pts[0],pts[1]),nm=mid(pts[0],pts[1]);
      if (lastPinchDist!==null){
        applyZoom(nm.x,nm.y,nd/lastPinchDist);
        const physZoom = scaleFactor * zoom;
        camX -= (nm.x - lastPinchMid.x) / physZoom;
        camY -= (nm.y - lastPinchMid.y) / physZoom;
      }
      lastPinchDist=nd;lastPinchMid=nm;return;
    }
    pointers.set(e.pointerId,pos);
  });
  function pEnd(e){pointers.delete(e.pointerId);if(pointers.size<2){lastPinchDist=null;lastPinchMid=null;}}
  canvas.addEventListener('pointerup',pEnd);canvas.addEventListener('pointercancel',pEnd);
  canvas.addEventListener('wheel',e=>{
    e.preventDefault();
    const{x,y}=getCanvasXY(e.clientX,e.clientY);
    applyZoom(x,y,e.deltaY<0?1.13:.885);
  },{passive:false});
  zoomInBtn.addEventListener('click',()=>applyZoom(canvas.width/2,canvas.height/2,1.25));
  zoomOutBtn.addEventListener('click',()=>applyZoom(canvas.width/2,canvas.height/2,.8));

  function updateH0Display(){H0Val.textContent=readH0().toFixed(3);}
  function updateAccelDisplay(){accelVal.textContent=readAccel().toFixed(2);}
  H0Input.addEventListener('input',updateH0Display);
  countInput.addEventListener('input',()=>{countVal.textContent=countInput.value;});
  timeScaleInput.addEventListener('input',()=>{timeScaleVal.textContent=parseFloat(timeScaleInput.value).toFixed(1);});
  accelInput.addEventListener('input',updateAccelDisplay);
  gravityToggle.addEventListener('change',()=>{gravityControls.hidden=!gravityToggle.checked;});
  gravityInput.addEventListener('input',()=>{gravityVal.textContent=gravityInput.value;});
  playPauseBtn.addEventListener('click',()=>{
    running=!running;
    playPauseBtn.querySelectorAll('[data-lang-text]').forEach(s=>{
      if(s.dataset.langText==='en') s.textContent=running?'Pause':'Play';
      if(s.dataset.langText==='de') s.textContent=running?'Pause':'Abspielen';
    });
  });
  regenBtn.addEventListener('click',()=>{createGalaxies(parseInt(countInput.value,10));makeStars(700);buildStarCache();});

  createGalaxies(parseInt(countInput.value,10));
  makeStars(700);buildStarCache();
  updateH0Display();
  countVal.textContent=countInput.value;
  timeScaleVal.textContent=parseFloat(timeScaleInput.value).toFixed(1);
  updateAccelDisplay();
  gravityVal.textContent=gravityInput.value;
  gravityControls.hidden=!gravityToggle.checked;
  requestAnimationFrame(frame);
})();