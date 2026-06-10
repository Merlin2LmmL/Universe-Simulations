(() => {
  const canvas = document.getElementById('universe');
  const ctx = canvas.getContext('2d');

  const H0Input        = document.getElementById('H0');
  const H0Val          = document.getElementById('H0Val');
  const countInput     = document.getElementById('count');
  const countVal       = document.getElementById('countVal');
  const timeScaleInput = document.getElementById('timeScale');
  const timeScaleVal   = document.getElementById('timeScaleVal');
  const accelInput     = document.getElementById('accel');
  const accelVal       = document.getElementById('accelVal');
  const gravityToggle  = document.getElementById('gravityToggle');
  const gravityControls= document.getElementById('gravityControls');
  const gravityInput   = document.getElementById('gravityStrength');
  const gravityVal     = document.getElementById('gravityVal');
  const drawStarfieldToggle = document.getElementById('drawStarfield');
  const playPauseBtn   = document.getElementById('playPause');
  const regenBtn       = document.getElementById('regenerate');

  // ─── world & camera ───────────────────────────────────────────────
  // The "cell" defines the finite seed domain. The visible observer is
  // anchored to a hidden local frame that is intentionally offset from the
  // coordinate zero so the expansion does not read as "from world center".
  const cellW = 8000;
  const cellH = 8000;

  // Camera in world-space (unbounded coords, same units as galaxy positions)
  let expansionCenterX = cellW * 0.37;
  let expansionCenterY = cellH * 0.41;
  let camX = expansionCenterX;
  let camY = expansionCenterY;
  let zoom = 0.9;

  let galaxies = [];
  let stars    = [];
  let running  = true;
  let lastT    = null;
  let simTime  = 0;

  // Scale-factor a(t).  Starts at 1 and grows with the simulation.
  // All galaxy positions are stored as comoving coords × a(t), so we only
  // need to track a single scalar per galaxy (its comoving displacement from
  // the observer) rather than an ever-growing absolute position.
  //
  // Strategy chosen:
  //   • Every galaxy stores its COMOVING displacement in a symmetric frame:
  //       comovX = x0   [constant unless we "regenerate"]
  //       comovY = y0
  //   • The physical / proper position at scale-factor a is:
  //       physX = expansionCenterX + comovX * a
  //       physY = expansionCenterY + comovY * a
  //   • a(t) is integrated from  da/dt = H(t) * a  each frame.
  //   • For rendering we use the continuous camera-relative position.
  //   • Galaxies never "disappear and reappear" via screen-edge wrapping;
  //     the physics is exact even when they are off-screen.

  let scaleFactor = 1.0;   // a(t), integrated each frame

  // ─── resize ───────────────────────────────────────────────────────
  function resize() {
    const rect   = canvas.getBoundingClientRect();
    const width  = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width  = width;
      canvas.height = height;
    }
  }
  const resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(canvas);
  window.addEventListener('resize', resize);
  resize();

  // ─── math helpers ─────────────────────────────────────────────────
  function rand(a, b) { return a + Math.random() * (b - a); }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function mod(a, n) { return ((a % n) + n) % n; }

  function getPointerCanvasPosition(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // ─── galaxy factory ───────────────────────────────────────────────
  function makeGalaxy() {
    const rnd  = Math.random();
    const type = rnd < 0.28 ? 1
               : rnd < 0.48 ? 2
               : rnd < 0.63 ? 0
               : rnd < 0.78 ? 4
               : rnd < 0.92 ? 3
               :               5;

    const hueBase = [50, 210, 200, 320, 120, 350][type];

    // Initial physical position inside one symmetric cell around the
    // hidden observer frame.
    const x0 = expansionCenterX + rand(-cellW * 0.5, cellW * 0.5);
    const y0 = expansionCenterY + rand(-cellH * 0.5, cellH * 0.5);

    return {
      // Comoving displacement in the symmetric expanding frame.
      comovX: x0 - expansionCenterX,
      comovY: y0 - expansionCenterY,
      peculiarX: 0,
      peculiarY: 0,
      vx: 0,
      vy: 0,

      type,
      r:          type === 5 ? rand(3, 7) : type === 3 ? rand(6, 14) : rand(8, 20),
      hue:        hueBase + rand(-28, 28),
      sat:        rand(55, 85),
      spin:       rand(-0.4, 0.4),
      phase:      Math.random() * Math.PI * 2,
      tilt:       rand(0.25, 1.0),
      arms:       type === 1 ? Math.floor(rand(2, 5)) : 2,
      barLen:     type === 2 ? rand(0.8, 1.6) : 0,
      spots:      (type === 3 || type === 5) ? Math.floor(rand(3, 8)) : 0,
      spotAngles: Array.from({ length: 8 }, () => Math.random() * Math.PI * 2),
      irregScaleX: rand(0.6, 1.0),
      irregScaleY: rand(0.5, 0.9),
      // offscreen cache
      cache:      null,
      cacheSize:  0,
      cacheHalf:  0,
    };
  }

  // ─── offscreen galaxy cache ────────────────────────────────────────
  const CACHE_MARGIN = 1.15;

  function buildCache(g) {
    let maxR;
    switch (g.type) {
      case 0: maxR = g.r * 2.8;  break;
      case 1: maxR = g.r * 3.5;  break;
      case 2: maxR = g.r * (3.5 + g.barLen); break;
      case 3: maxR = g.r * 2.5;  break;
      case 4: maxR = g.r * 3.2;  break;
      case 5: maxR = g.r * 2.0;  break;
      default: maxR = g.r * 3.5;
    }
    maxR *= CACHE_MARGIN;

    const size = Math.ceil(maxR * 2);
    const half = size / 2;

    const oc   = new OffscreenCanvas(size, size);
    const octx = oc.getContext('2d');
    octx.clearRect(0, 0, size, size);
    octx.save();
    octx.translate(half, half);
    renderGalaxyOnCtx(octx, g);
    octx.restore();

    g.cache     = oc;
    g.cacheSize = size;
    g.cacheHalf = half;
  }

  // ─── star field ───────────────────────────────────────────────────
  function makeStars(n) {
    stars = Array.from({ length: n }, () => ({
      nx:         Math.random(),
      ny:         Math.random(),
      s:          Math.random() < 0.04 ? rand(1.4, 2.4) : rand(0.3, 1.1),
      br:         rand(0.25, 0.9),
      twinkleOff: Math.random() * 100,
    }));
  }

  // ─── simulation update ────────────────────────────────────────────
  // We integrate the Friedmann-like equation:
  //   da/dt = H(t) * a(t)
  // where H(t) = H0 * (1 + accel * simTime).
  //
  // The physical position of galaxy g is:
  //   physX = expansionCenterX + g.comovX * a
  //   physY = expansionCenterY + g.comovY * a
  //
  // The CAMERA tracks the expansion by default so the local neighbourhood
  // stays roughly stable — just like a real observer.  When the user pans,
  // we shift the expansion frame with the camera so the flow is not pinned
  // to the coordinate origin.
  //
  // Off-screen galaxies are updated identically to visible ones because
  // the physics only touches scaleFactor and phase — both are global /
  // per-galaxy scalars, not screen-dependent.

  function update(dt) {
    const H0        = parseFloat(H0Input.value);
    const accel     = parseFloat(accelInput.value);
    const timeScale = parseFloat(timeScaleInput.value);
    const gravityOn = gravityToggle.checked;
    const gravityStrength = gravityOn ? parseFloat(gravityInput.value) : 0;

    const dtSim = dt * timeScale;
    simTime += dtSim;

    // Hubble parameter at current time
    const H = H0 * (1 + accel * simTime);

    if (gravityOn && gravityStrength > 0 && galaxies.length > 1) {
      applyAttraction(dtSim, gravityStrength);
    }

    // Integrate scale factor:  a_new = a * exp(H * dt) ≈ a * (1 + H*dt) for small dt
    // Use the exact exponential for numerical stability at high H or dt.
    const gravityBrake = gravityOn ? Math.min(0.42, gravityStrength * 0.06) : 0;
    scaleFactor *= Math.exp(Math.max(0, H * (1 - gravityBrake)) * dtSim);

    // Update each galaxy's rotation phase (visual only — spin is comoving)
    for (const g of galaxies) {
      g.phase += g.spin * dtSim;
    }
  }

  function recenterExpansionFrame(newCenterX, newCenterY) {
    if (newCenterX === expansionCenterX && newCenterY === expansionCenterY) return;

    const safeScale = Math.max(scaleFactor, 1e-6);
    const dx = newCenterX - expansionCenterX;
    const dy = newCenterY - expansionCenterY;

    for (const g of galaxies) {
      g.comovX -= dx / safeScale;
      g.comovY -= dy / safeScale;
    }

    expansionCenterX = newCenterX;
    expansionCenterY = newCenterY;
  }

  function getGalaxyPhysicalPosition(g) {
    return {
      x: expansionCenterX + g.comovX * scaleFactor + g.peculiarX,
      y: expansionCenterY + g.comovY * scaleFactor + g.peculiarY,
    };
  }

  function applyAttraction(dtSim, strength) {
    const count = galaxies.length;
    if (!count) return;

    const positions = galaxies.map(getGalaxyPhysicalPosition);
    const cellSize = Math.max(140, 220 + strength * 90);
    const attractionRange = 240 + strength * 160;
    const attractionRangeSq = attractionRange * attractionRange;
    const mergeRange = 18 + strength * 12;
    const mergeRangeSq = mergeRange * mergeRange;

    const grid = new Map();
    for (let i = 0; i < count; i++) {
      const pos = positions[i];
      const gx = Math.floor(pos.x / cellSize);
      const gy = Math.floor(pos.y / cellSize);
      const key = `${gx},${gy}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(i);
    }

    const ax = new Float64Array(count);
    const ay = new Float64Array(count);
    const mergeCandidates = [];
    let interactionHits = 0;

    for (let i = 0; i < count; i++) {
      const posI = positions[i];
      const gx = Math.floor(posI.x / cellSize);
      const gy = Math.floor(posI.y / cellSize);

      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const bucket = grid.get(`${gx + ox},${gy + oy}`);
          if (!bucket) continue;

          for (const j of bucket) {
            if (j <= i) continue;
            const posJ = positions[j];
            const dx = posJ.x - posI.x;
            const dy = posJ.y - posI.y;
            const distSq = dx * dx + dy * dy;
            if (distSq > attractionRangeSq) continue;

            interactionHits++;

            const dist = Math.sqrt(distSq) + 0.001;
            const pull = strength * 32 / (distSq + 2600);
            const fx = dx * pull;
            const fy = dy * pull;

            ax[i] += fx;
            ay[i] += fy;
            ax[j] -= fx;
            ay[j] -= fy;

            if (distSq <= mergeRangeSq) {
              const relVx = galaxies[j].vx - galaxies[i].vx;
              const relVy = galaxies[j].vy - galaxies[i].vy;
              const radialVelocity = (relVx * dx + relVy * dy) / dist;
              const closingChance = clamp((strength * 0.05) + Math.max(0, -radialVelocity) / 180, 0, 0.35);
              if (radialVelocity < 0 && Math.random() < closingChance) {
                mergeCandidates.push({ i, j, distSq });
              }
            }
          }
        }
      }
    }

    const damping = clamp(1 - dtSim * (0.025 + strength * 0.01), 0.94, 1);
    const maxSpeed = 140 + strength * 80;

    for (let i = 0; i < count; i++) {
      const g = galaxies[i];
      g.vx = (g.vx + ax[i] * dtSim) * damping;
      g.vy = (g.vy + ay[i] * dtSim) * damping;

      const speed = Math.hypot(g.vx, g.vy);
      if (speed > maxSpeed) {
        const scale = maxSpeed / speed;
        g.vx *= scale;
        g.vy *= scale;
      }

      g.peculiarX += g.vx * dtSim;
      g.peculiarY += g.vy * dtSim;
    }

    if (!mergeCandidates.length) return;

    mergeCandidates.sort((a, b) => {
      const aHigh = Math.max(a.i, a.j);
      const bHigh = Math.max(b.i, b.j);
      if (bHigh !== aHigh) return bHigh - aHigh;
      const aLow = Math.min(a.i, a.j);
      const bLow = Math.min(b.i, b.j);
      return bLow - aLow;
    });
    const merged = new Set();

    for (const pair of mergeCandidates) {
      const low = Math.min(pair.i, pair.j);
      const high = Math.max(pair.i, pair.j);
      if (merged.has(low) || merged.has(high)) continue;
      if (low >= galaxies.length || high >= galaxies.length) continue;

      const gA = galaxies[low];
      const gB = galaxies[high];
      const posA = positions[low];
      const posB = positions[high];
      const massA = gA.r * gA.r;
      const massB = gB.r * gB.r;
      const totalMass = massA + massB;
      const mergedPhysX = (posA.x * massA + posB.x * massB) / totalMass;
      const mergedPhysY = (posA.y * massA + posB.y * massB) / totalMass;
      const dominant = gA.r >= gB.r ? gA : gB;
      const mergedRadius = clamp(Math.max(gA.r, gB.r) * (1.08 + strength * 0.03), Math.max(gA.r, gB.r), Math.max(gA.r, gB.r) * 1.45);

      const mergedGalaxy = {
        ...dominant,
        comovX: (mergedPhysX - expansionCenterX) / Math.max(scaleFactor, 1e-6),
        comovY: (mergedPhysY - expansionCenterY) / Math.max(scaleFactor, 1e-6),
        peculiarX: 0,
        peculiarY: 0,
        vx: ((gA.vx + gB.vx) * 0.5) * 0.35,
        vy: ((gA.vy + gB.vy) * 0.5) * 0.35,
        r: mergedRadius,
        hue: (gA.hue * massA + gB.hue * massB) / totalMass,
        sat: clamp((gA.sat + gB.sat) * 0.5 + 2, 35, 92),
        spin: (gA.spin + gB.spin) * 0.5,
        phase: (gA.phase + gB.phase) * 0.5,
        tilt: clamp(Math.max(gA.tilt, gB.tilt), 0.18, 1.1),
        arms: dominant.arms,
        barLen: dominant.barLen,
        spots: dominant.spots,
        spotAngles: dominant.spotAngles.slice(),
        irregScaleX: dominant.irregScaleX,
        irregScaleY: dominant.irregScaleY,
        cache: null,
        cacheSize: 0,
        cacheHalf: 0,
      };

      buildCache(mergedGalaxy);
      galaxies[low] = mergedGalaxy;
      galaxies.splice(high, 1);
      merged.add(low);
    }

    if (interactionHits > 0 && gravityVal) {
      const brake = clamp((strength * 0.06) + (interactionHits / Math.max(1, count * 3)) * 0.16, 0, 0.38);
      gravityVal.dataset.brake = brake.toFixed(2);
    }
  }

  // ─── galaxy renderers ─────────────────────────────────────────────
  // (identical rendering code — just the physics layer changed above)

  function drawElliptical(octx, r, hue, sat, tilt) {
    const grd = octx.createRadialGradient(0, 0, r * 0.05, 0, 0, r * 2.8);
    grd.addColorStop(0,    `hsla(${hue},${sat}%,95%,1)`);
    grd.addColorStop(0.15, `hsla(${hue},${sat}%,80%,0.95)`);
    grd.addColorStop(0.5,  `hsla(${hue - 10},${sat - 10}%,55%,0.5)`);
    grd.addColorStop(1,    `hsla(${hue},50%,30%,0)`);
    octx.save();
    octx.scale(1, tilt * 0.6);
    octx.fillStyle = grd;
    octx.beginPath(); octx.arc(0, 0, r * 2.8, 0, Math.PI * 2); octx.fill();
    octx.restore();
    const cg = octx.createRadialGradient(0, 0, 0, 0, 0, r * 0.5);
    cg.addColorStop(0,   'rgba(255,255,240,0.98)');
    cg.addColorStop(0.6, `hsla(${hue},60%,80%,0.6)`);
    cg.addColorStop(1,   'rgba(0,0,0,0)');
    octx.fillStyle = cg;
    octx.beginPath(); octx.arc(0, 0, r * 0.5, 0, Math.PI * 2); octx.fill();
  }

  function drawSpiral(octx, r, hue, sat, tilt, arms, barLen) {
    const dg = octx.createRadialGradient(0, 0, r * 0.1, 0, 0, r * 3.5);
    dg.addColorStop(0,   `hsla(${hue},${sat}%,90%,0.9)`);
    dg.addColorStop(0.3, `hsla(${hue},${sat}%,65%,0.45)`);
    dg.addColorStop(0.7, `hsla(${hue - 15},${sat - 10}%,40%,0.15)`);
    dg.addColorStop(1,   'rgba(0,0,0,0)');
    octx.save();
    octx.scale(1, tilt);
    octx.fillStyle = dg;
    octx.beginPath(); octx.arc(0, 0, r * 3.5, 0, Math.PI * 2); octx.fill();
    if (barLen > 0) {
      octx.strokeStyle = `hsla(${hue},${sat}%,88%,0.65)`;
      octx.lineWidth   = r * 0.28;
      octx.lineCap     = 'round';
      octx.beginPath();
      octx.moveTo(-r * barLen, 0); octx.lineTo(r * barLen, 0);
      octx.stroke();
    }
    const numArms = arms || 2;
    for (let a = 0; a < numArms; a++) {
      const aOff = a * (Math.PI * 2 / numArms);
      octx.strokeStyle = `hsla(${hue - 20},${sat - 20}%,25%,0.35)`;
      octx.lineWidth   = Math.max(1, r * 0.13);
      octx.beginPath();
      let first = true;
      for (let t = 0.05; t < 1.4; t += 0.04) {
        const ang = t * Math.PI * 1.9 + aOff;
        const rad = r * (0.5 + barLen * 0.5 + 3.2 * t);
        const px  = Math.cos(ang) * rad;
        const py  = Math.sin(ang) * rad;
        if (first) { octx.moveTo(px, py); first = false; } else octx.lineTo(px, py);
      }
      octx.stroke();
      octx.strokeStyle = `hsla(${hue + 10},${sat}%,80%,0.75)`;
      octx.lineWidth   = Math.max(0.8, r * 0.09);
      octx.beginPath(); first = true;
      for (let t = 0.05; t < 1.4; t += 0.04) {
        const ang = t * Math.PI * 1.9 + aOff + 0.08;
        const rad = r * (0.5 + barLen * 0.5 + 3.2 * t);
        const px  = Math.cos(ang) * rad;
        const py  = Math.sin(ang) * rad;
        if (first) { octx.moveTo(px, py); first = false; } else octx.lineTo(px, py);
      }
      octx.stroke();
      for (let k = 0; k < 4; k++) {
        const t   = 0.15 + k * 0.3;
        const ang = t * Math.PI * 1.9 + aOff;
        const rad = r * (0.5 + barLen * 0.5 + 3.2 * t);
        const kx  = Math.cos(ang) * rad;
        const ky  = Math.sin(ang) * rad;
        const kg  = octx.createRadialGradient(kx, ky, 0, kx, ky, r * 0.25);
        kg.addColorStop(0, `hsla(${hue + 40},90%,90%,0.8)`);
        kg.addColorStop(1, 'rgba(0,0,0,0)');
        octx.fillStyle = kg;
        octx.beginPath(); octx.arc(kx, ky, r * 0.25, 0, Math.PI * 2); octx.fill();
      }
    }
    octx.restore();
    const ng = octx.createRadialGradient(0, 0, 0, 0, 0, r * 0.4);
    ng.addColorStop(0,   'rgba(255,255,245,1)');
    ng.addColorStop(0.5, `hsla(${hue},70%,75%,0.8)`);
    ng.addColorStop(1,   'rgba(0,0,0,0)');
    octx.fillStyle = ng;
    octx.beginPath(); octx.arc(0, 0, r * 0.4, 0, Math.PI * 2); octx.fill();
  }

  function drawIrregular(octx, r, hue, sat, spots, spotAngles, scaleX, scaleY) {
    const ig = octx.createRadialGradient(0, 0, r * 0.1, 0, 0, r * 2.5);
    ig.addColorStop(0,   `hsla(${hue},${sat}%,85%,0.85)`);
    ig.addColorStop(0.4, `hsla(${hue},${sat}%,65%,0.5)`);
    ig.addColorStop(1,   'rgba(0,0,0,0)');
    octx.save();
    octx.scale(scaleX, scaleY);
    octx.fillStyle = ig;
    octx.beginPath(); octx.arc(0, 0, r * 2.5, 0, Math.PI * 2); octx.fill();
    octx.restore();
    for (let i = 0; i < spots; i++) {
      const ang  = spotAngles[i];
      const dist = r * 0.3 + (spotAngles[(i + 4) % 8] / (Math.PI * 2)) * r * 1.2;
      const sx   = Math.cos(ang) * dist;
      const sy   = Math.sin(ang) * dist * 0.7;
      const sg   = octx.createRadialGradient(sx, sy, 0, sx, sy, r * 0.35);
      const hOff = (spotAngles[i] / (Math.PI * 2) * 60) - 20;
      sg.addColorStop(0, `hsla(${hue + hOff},90%,92%,0.9)`);
      sg.addColorStop(1, 'rgba(0,0,0,0)');
      octx.fillStyle = sg;
      octx.beginPath(); octx.arc(sx, sy, r * 0.35, 0, Math.PI * 2); octx.fill();
    }
    octx.beginPath();
    octx.fillStyle = `hsla(${hue},60%,80%,0.7)`;
    octx.arc(0, 0, Math.max(0.8, r * 0.25), 0, Math.PI * 2); octx.fill();
  }

  function drawLenticular(octx, r, hue, sat, tilt) {
    octx.save();
    octx.scale(1, tilt * 0.22);
    const lg = octx.createRadialGradient(0, 0, r * 0.05, 0, 0, r * 3.2);
    lg.addColorStop(0,    `hsla(${hue},${sat}%,90%,0.95)`);
    lg.addColorStop(0.35, `hsla(${hue},${sat - 10}%,68%,0.65)`);
    lg.addColorStop(0.7,  `hsla(${hue - 5},${sat - 20}%,40%,0.25)`);
    lg.addColorStop(1,    'rgba(0,0,0,0)');
    octx.fillStyle = lg;
    octx.beginPath(); octx.arc(0, 0, r * 3.2, 0, Math.PI * 2); octx.fill();
    octx.restore();
    octx.save();
    octx.scale(1, tilt * 0.08);
    octx.strokeStyle = `hsla(${hue},${sat}%,85%,0.5)`;
    octx.lineWidth   = r * 0.5;
    octx.beginPath(); octx.arc(0, 0, r * 1.8, 0, Math.PI * 2); octx.stroke();
    octx.restore();
    const cg = octx.createRadialGradient(0, 0, 0, 0, 0, r * 0.45);
    cg.addColorStop(0,   'rgba(255,255,248,1)');
    cg.addColorStop(0.7, `hsla(${hue},50%,70%,0.5)`);
    cg.addColorStop(1,   'rgba(0,0,0,0)');
    octx.fillStyle = cg;
    octx.beginPath(); octx.arc(0, 0, r * 0.45, 0, Math.PI * 2); octx.fill();
  }

  function drawDwarf(octx, r, hue, sat, spots, spotAngles) {
    const dg = octx.createRadialGradient(0, 0, 0, 0, 0, r * 2);
    dg.addColorStop(0,   `hsla(${hue},${sat}%,90%,0.7)`);
    dg.addColorStop(0.5, `hsla(${hue},${sat - 15}%,65%,0.4)`);
    dg.addColorStop(1,   'rgba(0,0,0,0)');
    octx.fillStyle = dg;
    octx.beginPath(); octx.arc(0, 0, r * 2, 0, Math.PI * 2); octx.fill();
    for (let i = 0; i < Math.min(spots, 4); i++) {
      const ang  = spotAngles[i];
      const dist = r * 0.2 + (spotAngles[(i + 4) % 8] / (Math.PI * 2)) * r * 0.7;
      const sx   = Math.cos(ang) * dist;
      const sy   = Math.sin(ang) * dist;
      const br   = 0.4 + (spotAngles[i] / (Math.PI * 2)) * 0.3;
      octx.fillStyle = `hsla(${hue + 40},90%,90%,${br})`;
      octx.beginPath(); octx.arc(sx, sy, 0.5 + (spotAngles[(i + 2) % 8] / (Math.PI * 2)), 0, Math.PI * 2); octx.fill();
    }
  }

  function renderGalaxyOnCtx(octx, g) {
    switch (g.type) {
      case 0: drawElliptical(octx, g.r, g.hue, g.sat, g.tilt); break;
      case 1: drawSpiral(octx, g.r, g.hue, g.sat, g.tilt, g.arms, 0); break;
      case 2: drawSpiral(octx, g.r, g.hue, g.sat, g.tilt, 2, g.barLen); break;
      case 3: drawIrregular(octx, g.r, g.hue, g.sat, g.spots, g.spotAngles, g.irregScaleX, g.irregScaleY); break;
      case 4: drawLenticular(octx, g.r, g.hue, g.sat, g.tilt); break;
      case 5: drawDwarf(octx, g.r, g.hue, g.sat, g.spots, g.spotAngles); break;
    }
  }

  // ─── galaxy creation ──────────────────────────────────────────────
  function createGalaxies(n) {
    scaleFactor = 1.0;
    simTime     = 0;
    galaxies = Array.from({ length: n }, () => {
      const g = makeGalaxy();
      buildCache(g);
      return g;
    });
  }

  // ─── star field cache ─────────────────────────────────────────────
  let starCanvas = null;

  function buildStarCache() {
    const w = Math.max(canvas.width,  1);
    const h = Math.max(canvas.height, 1);
    starCanvas = new OffscreenCanvas(w, h);
    const sc   = starCanvas.getContext('2d');
    sc.clearRect(0, 0, w, h);
    for (const s of stars) {
      const sx = s.nx * w;
      const sy = s.ny * h;
      sc.fillStyle = `rgba(255,255,255,${s.br})`;
      sc.beginPath(); sc.arc(sx, sy, s.s, 0, Math.PI * 2); sc.fill();
    }
  }

  // ─── draw ─────────────────────────────────────────────────────────
  function drawStarfield() {
    if (!starCanvas || starCanvas.width !== canvas.width || starCanvas.height !== canvas.height) {
      buildStarCache();
    }
    ctx.drawImage(starCanvas, 0, 0);
    for (const s of stars) {
      if (s.s <= 1.3) continue;
      const sx = s.nx * canvas.width;
      const sy = s.ny * canvas.height;
      const tw = 0.65 + 0.35 * Math.sin(simTime * 2 + s.twinkleOff);
      ctx.fillStyle = `rgba(255,255,255,${s.br * tw})`;
      ctx.beginPath(); ctx.arc(sx, sy, s.s, 0, Math.PI * 2); ctx.fill();
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#010810';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (drawStarfieldToggle.checked)
      drawStarfield();

    const cx     = canvas.width  / 2;
    const cy     = canvas.height / 2;

    // Maximum comoving distance for redshift normalisation —
    // half the cell diagonal in comoving units.
    const maxComov = Math.sqrt(cellW * cellW + cellH * cellH) * 0.5;

    for (const g of galaxies) {
      // ── Compute physical position ─────────────────────────────────
      // physX/Y is the galaxy's proper (non-periodic) position.
      const physX = expansionCenterX + g.comovX * scaleFactor + g.peculiarX;
      const physY = expansionCenterY + g.comovY * scaleFactor + g.peculiarY;

      // ── Stable projection into the current camera frame ───────────
      // Use the continuous world position directly. This keeps motion
      // monotonic and avoids any toroidal wrap-around in the view.
      const dx = physX - camX;
      const dy = physY - camY;

      // Screen position
      const sx = cx + dx * zoom;
      const sy = cy + dy * zoom;
      const screenR = g.cacheHalf * zoom;

      // Cull if completely off-screen (still updated every frame via scaleFactor)
      if (sx < -screenR || sx > canvas.width  + screenR ||
          sy < -screenR || sy > canvas.height + screenR) continue;

      // ── Blit cached galaxy ────────────────────────────────────────
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(g.phase);
      ctx.scale(zoom, zoom);
      ctx.drawImage(g.cache, -g.cacheHalf, -g.cacheHalf);
      ctx.restore();

      // ── Redshift halo (based on comoving distance from observer) ──
      const comovDist = Math.sqrt(g.comovX * g.comovX + g.comovY * g.comovY);
      const rf = Math.min(1, (comovDist * scaleFactor) / maxComov);
      if (rf > 0.25) {
        const alpha = rf * 0.18;
        const rHalo = g.r * zoom * 2.5;
        const rsG   = ctx.createRadialGradient(sx, sy, 0, sx, sy, rHalo);
        rsG.addColorStop(0, `rgba(255,40,0,${alpha})`);
        rsG.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = rsG;
        ctx.beginPath(); ctx.arc(sx, sy, rHalo, 0, Math.PI * 2); ctx.fill();
      }
    }

  }

  // ─── animation loop ───────────────────────────────────────────────
  function frame(ts) {
    if (!lastT) lastT = ts;
    const dt = Math.min(0.1, (ts - lastT) / 1000);
    lastT = ts;
    if (running) update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  // ─── pointer / wheel interaction ──────────────────────────────────
  let dragging  = false;
  let dragStart = null;

  canvas.addEventListener('pointerdown', (e) => {
    dragging  = true;
    dragStart = { x: e.clientX, y: e.clientY, camX, camY };
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const { x: pointerX, y: pointerY } = getPointerCanvasPosition(e);
    const cx   = canvas.width  / 2;
    const cy   = canvas.height / 2;
    // Focus point in world-space (unperiodized offset from camera)
    const focusDx = (pointerX - cx) / zoom;
    const focusDy = (pointerY - cy) / zoom;
    const zoomFactor = e.deltaY < 0 ? 1.13 : 0.885;
    const nextZoom   = Math.min(20, Math.max(0.12, zoom * zoomFactor));
    // Adjust camera so the world point under the pointer stays fixed
    camX = camX + focusDx - (pointerX - cx) / nextZoom;
    camY = camY + focusDy - (pointerY - cy) / nextZoom;
    recenterExpansionFrame(camX, camY);
    zoom = nextZoom;
  }, { passive: false });

  window.addEventListener('pointermove', (e) => {
    if (!dragging || !dragStart) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    camX = dragStart.camX - dx / zoom;
    camY = dragStart.camY - dy / zoom;
    recenterExpansionFrame(camX, camY);
  });

  window.addEventListener('pointerup', () => {
    dragging  = false;
    dragStart = null;
  });

  // ─── UI bindings ──────────────────────────────────────────────────
  H0Input.addEventListener('input',        () => { H0Val.textContent        = H0Input.value; });
  countInput.addEventListener('input',     () => { countVal.textContent     = countInput.value; });
  timeScaleInput.addEventListener('input', () => { timeScaleVal.textContent = timeScaleInput.value; });
  accelInput.addEventListener('input',     () => { accelVal.textContent     = accelInput.value; });
  gravityToggle.addEventListener('change', () => {
    gravityControls.hidden = !gravityToggle.checked;
  });
  gravityInput.addEventListener('input', () => { gravityVal.textContent = gravityInput.value; });

  playPauseBtn.addEventListener('click', () => {
    running = !running;
    playPauseBtn.textContent = running ? 'Pause' : 'Play';
  });

  regenBtn.addEventListener('click', () => {
    recenterExpansionFrame(camX, camY);
    createGalaxies(parseInt(countInput.value, 10));
    makeStars(700);
    buildStarCache();
  });

  // ─── initialise ───────────────────────────────────────────────────
  createGalaxies(parseInt(countInput.value, 10));
  makeStars(700);
  buildStarCache();
  H0Val.textContent        = H0Input.value;
  countVal.textContent     = countInput.value;
  timeScaleVal.textContent = timeScaleInput.value;
  accelVal.textContent     = accelInput.value;
  gravityVal.textContent   = gravityInput.value;
  gravityControls.hidden   = !gravityToggle.checked;

  requestAnimationFrame(frame);
})();