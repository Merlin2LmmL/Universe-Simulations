(() => {
  const canvas = document.getElementById('universe');
  const ctx = canvas.getContext('2d');

  const H0Input = document.getElementById('H0');
  const H0Val = document.getElementById('H0Val');
  const countInput = document.getElementById('count');
  const countVal = document.getElementById('countVal');
  const timeScaleInput = document.getElementById('timeScale');
  const timeScaleVal = document.getElementById('timeScaleVal');
  const accelInput = document.getElementById('accel');
  const accelVal = document.getElementById('accelVal');
  const playPauseBtn = document.getElementById('playPause');
  const regenBtn = document.getElementById('regenerate');

  let galaxies = [];
  let worldW = 5000;
  let worldH = 5000;
  let camX = worldW / 2;
  let camY = worldH / 2;

  let running = true;
  let lastT = null;
  let simTime = 0; // simulated time in arbitrary units

  function resize() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
  }

  window.addEventListener('resize', resize);
  // make canvas fill panel area
  resize();

  function rand(min, max) { return min + Math.random() * (max - min); }

  function makeGalaxy() {
    return {
      x: Math.random() * worldW,
      y: Math.random() * worldH,
      r: rand(3, 12),
      hue: Math.floor(rand(0, 360)),
      spin: rand(-0.5, 0.5),
      phase: Math.random() * Math.PI * 2,
    };
  }

  function createGalaxies(n) {
    galaxies = new Array(n).fill(0).map(() => makeGalaxy());
  }

  function mod(a, n) {
    return ((a % n) + n) % n;
  }

  function shortestDelta(coord, camCoord, size) {
    let d = coord - camCoord;
    d = mod(d + size / 2, size) - size / 2;
    return d;
  }

  function update(dt) {
    const H0 = parseFloat(H0Input.value);
    const accel = parseFloat(accelInput.value);
    const timeScale = parseFloat(timeScaleInput.value);

    simTime += dt * timeScale;
    const H = H0 * (1 + accel * simTime);

    for (let g of galaxies) {
      const dx = shortestDelta(g.x, camX, worldW);
      const dy = shortestDelta(g.y, camY, worldH);
      const vx = H * dx;
      const vy = H * dy;

      g.x = mod(g.x + vx * dt, worldW);
      g.y = mod(g.y + vy * dt, worldH);
      g.phase += g.spin * dt;
    }
  }

  function drawGalaxy(ctx, x, y, g) {
    const r = g.r;
    // soft core
    const grad = ctx.createRadialGradient(x, y, r * 0.1, x, y, r * 2.5);
    grad.addColorStop(0, `hsla(${g.hue},80%,90%,1)`);
    grad.addColorStop(0.2, `hsla(${g.hue},70%,70%,0.9)`);
    grad.addColorStop(1, `rgba(0,0,0,0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.5, 0, Math.PI * 2);
    ctx.fill();

    // arms - draw a few arcs rotated by phase
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(g.phase);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = `hsla(${g.hue},50%,60%,0.9)`;
    ctx.lineWidth = Math.max(1, r * 0.12);
    for (let a = 0; a < 3; a++) {
      ctx.beginPath();
      const sign = a % 2 === 0 ? 1 : -1;
      for (let t = 0; t < 1.2; t += 0.06) {
        const ang = t * Math.PI * 2 * sign + a * 0.8;
        const rad = r * (1 + 4 * t);
        const px = Math.cos(ang) * rad;
        const py = Math.sin(ang) * rad * 0.6;
        if (t === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();

    // nucleus
    ctx.beginPath();
    ctx.fillStyle = `rgba(255,255,255,0.9)`;
    ctx.arc(x, y, Math.max(0.8, r * 0.35), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#031018';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // draw grid / subtle reference
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(0, canvas.height / 2 + i * 50);
      ctx.lineTo(canvas.width, canvas.height / 2 + i * 50);
      ctx.stroke();
    }

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    // draw galaxies
    for (let g of galaxies) {
      const dx = shortestDelta(g.x, camX, worldW);
      const dy = shortestDelta(g.y, camY, worldH);
      const sx = cx + dx;
      const sy = cy + dy;
      // skip if not visible
      if (sx < -50 || sx > canvas.width + 50 || sy < -50 || sy > canvas.height + 50) continue;
      drawGalaxy(ctx, sx, sy, g);
    }

    // HUD: sample central marker
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  function frame(ts) {
    if (!lastT) lastT = ts;
    const dt = Math.min(0.1, (ts - lastT) / 1000);
    lastT = ts;
    if (running) update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  // interaction: drag to pan
  let dragging = false;
  let dragStart = null;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    dragStart = {x: e.clientX, y: e.clientY, camX, camY};
    canvas.setPointerCapture(e.pointerId);
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging || !dragStart) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    // move camera opposite to pointer movement so it feels like dragging the space
    camX = dragStart.camX - dx;
    camY = dragStart.camY - dy;
    // keep within world by wrapping
    camX = mod(camX, worldW);
    camY = mod(camY, worldH);
  });
  window.addEventListener('pointerup', (e) => {
    dragging = false;
    dragStart = null;
  });

  // UI bindings
  H0Input.addEventListener('input', () => { H0Val.textContent = H0Input.value; });
  countInput.addEventListener('input', () => { countVal.textContent = countInput.value; });
  timeScaleInput.addEventListener('input', () => { timeScaleVal.textContent = timeScaleInput.value; });
  accelInput.addEventListener('input', () => { accelVal.textContent = accelInput.value; });

  playPauseBtn.addEventListener('click', () => {
    running = !running;
    playPauseBtn.textContent = running ? 'Pause' : 'Play';
  });

  regenBtn.addEventListener('click', () => {
    createGalaxies(parseInt(countInput.value, 10));
  });

  // initial setup
  createGalaxies(parseInt(countInput.value, 10));
  H0Val.textContent = H0Input.value;
  countVal.textContent = countInput.value;
  timeScaleVal.textContent = timeScaleInput.value;
  accelVal.textContent = accelInput.value;

  // autosize observer: make canvas fill parent width
  function fitCanvasToParent() {
    const parent = canvas.parentElement;
    const style = getComputedStyle(parent);
    const w = parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const h = parent.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    resize();
  }
  // try to fit once and on resize
  fitCanvasToParent();
  window.addEventListener('resize', fitCanvasToParent);

  requestAnimationFrame(frame);
})();
