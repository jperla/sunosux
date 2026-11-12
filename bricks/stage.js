// stage brick: the show. Three little hunters sing on a rooftop while cute
// shadows float in. Every clap and snare in the song zaps a shadow into
// sparkles, every kick makes the hunters bounce, every note sends up a star,
// and the city lights come on as you go. Tap a shadow to zap it yourself.
//
// Song knobs (all optional, so Claude can restyle the show per song):
//   song.theme.sky    = ['#0b0620', '#3a1466']        top and bottom sky colors
//   song.theme.squad  = [{ hair, dress }, x3]          the three singers
(function () {
  'use strict';
  const Kit = Sunosux.Kit, h = Kit.h, H = Kit.helpers;
  const TAU = Math.PI * 2;

  Kit.components.stage = (el, app) => {
    const { store, player } = app;
    const canvas = h('canvas', { class: 'sx-stage-canvas' });
    const g = canvas.getContext('2d');
    const count = h('div', { class: 'sx-stage-count' }, '⭐ 0');
    const title = h('div', { class: 'sx-stage-title' });
    const words = h('div', { class: 'sx-stage-words' });
    const play = h('button', { class: 'sx-stage-play', title: 'play / stop', onclick: () => player.playing ? player.stop() : player.play() }, '▶️');
    el.append(h('div', { class: 'sx-stage-wrap' }, canvas, title, count), h('div', { class: 'sx-stage-under' }, play, words));

    let W = 600, Hh = 300, zapped = 0, bounce = 0, flash = 0, clock = 0, last = performance.now(), partColor = '#ff4fa3';
    let seed = 11;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const stars = Array.from({ length: 70 }, () => ({ x: rnd(), y: rnd() * 0.7, r: 0.5 + rnd() * 1.5, p: rnd() * TAU }));
    const buildings = [];
    for (let x = 0; x < 1.02;) { const w = 0.05 + rnd() * 0.07; buildings.push({ x, w, h: 0.12 + rnd() * 0.22, win: Array.from({ length: 24 }, () => rnd()) }); x += w + 0.004; }
    const shadows = [], sparks = [], rings = [], notes = [];

    const resize = () => {
      const r = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      if (!r.width) return;
      W = r.width; Hh = r.height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(Hh * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    new ResizeObserver(resize).observe(canvas);

    const squadX = (i) => W * (0.5 + (i - 1) * Math.min(0.17, 90 / W));
    const floorY = () => Hh * 0.95;
    const unit = () => Math.max(0.7, Math.min(1.6, Hh / 250));

    function spawnShadow() {
      shadows.push({ x: 0.08 * W + Math.random() * 0.84 * W, y: -30, ty: Hh * (0.14 + Math.random() * 0.32), r: (14 + Math.random() * 10) * unit(), p: Math.random() * TAU, blink: Math.random() * 4 });
    }
    function burst(x, y, n, color) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, v = 40 + Math.random() * 140;
        sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: 0.6 + Math.random() * 0.6, color: color || ['#ffd23f', '#ff4fa3', '#7bffea', '#ffffff'][i % 4], heart: i % 5 === 0, s: 3 + Math.random() * 5 });
      }
    }
    function zap(s) {
      const i = shadows.indexOf(s);
      if (i < 0) return;
      shadows.splice(i, 1);
      burst(s.x, s.y, 14);
      zapped++; count.textContent = '⭐ ' + zapped;
      count.classList.remove('pop'); void count.offsetWidth; count.classList.add('pop');
    }
    const nearest = (x, y) => shadows.reduce((best, s) => { const d = Math.hypot(s.x - x, s.y - y); return !best || d < best.d ? { s, d } : best; }, null);

    player.onHit((hit) => {
      if (hit.drum) {
        if (hit.kind === 'kick' || hit.kind === 'tom') { bounce = 1; return; }
        if (hit.kind === 'hat') return;
        flash = 1;
        rings.push({ r: 10, life: 1 });
        const target = nearest(W / 2, Hh * 0.3);
        if (target) zap(target.s);
      } else if (hit.midi != null && notes.length < 60) {
        const i = Math.abs(hit.midi) % 3;
        notes.push({ x: squadX(i) + 24 * unit(), y: floorY() - 70 * unit(), tx: W * (0.1 + 0.8 * Math.max(0, Math.min(1, (hit.midi - 45) / 45))), vy: 60 + Math.random() * 50, life: 1.6, color: ['#ffd23f', '#ff7ad9', '#7bffea'][i], s: 5 + Math.min(8, hit.len * 6) });
      }
    });

    canvas.addEventListener('pointerdown', (e) => {
      const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const inst = H.instrumentsOf(store.song), hit = nearest(x, y);
      if (hit && hit.d < hit.s.r + 28) { zap(hit.s); player.trigger(inst.zap, 'C5'); rings.push({ r: 10, life: 1, x, y }); }
      else { burst(x, y, 6); const sc = H.scaleNotes(store.song, 'A4', 'A5'); player.trigger(inst.sparkle || inst.bell, sc[Math.floor((1 - y / Hh) * sc.length)] || 'A4'); }
    });

    function star(x, y, r, color, rot) {
      g.fillStyle = color; g.beginPath();
      for (let i = 0; i < 10; i++) { const a = (rot || 0) - Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      g.closePath(); g.fill();
    }
    function heart(x, y, r, color) {
      g.fillStyle = color; g.beginPath(); g.moveTo(x, y + r);
      g.bezierCurveTo(x - r * 1.6, y - r * 0.2, x - r * 0.6, y - r * 1.2, x, y - r * 0.3);
      g.bezierCurveTo(x + r * 0.6, y - r * 1.2, x + r * 1.6, y - r * 0.2, x, y + r); g.fill();
    }
    const dot = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); };
    const line = (a, b, c, d) => { g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.stroke(); };

    function hunter(i, look) {
      const s = unit(), hop = Math.max(0, bounce) * (i === 1 ? 12 : 8) * (player.playing ? 1 : 0) + Math.sin(clock * 2 + i * 2) * 1.5;
      g.save(); g.translate(squadX(i), floorY() - hop * s); g.scale(s, s);
      g.lineCap = 'round';
      g.strokeStyle = '#2b1b4d'; g.lineWidth = 5; line(-6, -18, -7, -2); line(6, -18, 7, -2);
      const up = player.playing ? Math.sin(clock * 6 + i * 2.1) * 6 + bounce * 6 : 0;
      g.strokeStyle = '#ffd9c2'; g.lineWidth = 4; line(9, -48, 22, -62 - up); line(-9, -48, -17, -36);
      star(24, -70 - up, 7, '#ffd23f', clock * 2);
      g.fillStyle = look.dress; g.beginPath(); g.moveTo(-9, -52); g.lineTo(9, -52); g.lineTo(17, -16); g.quadraticCurveTo(0, -9, -17, -16); g.closePath(); g.fill();
      g.fillStyle = look.hair;
      if (i === 0) { dot(-13, -78, 6); dot(13, -78, 6); }                       // two buns
      if (i === 1) { g.fillRect(-16, -68, 6, 34); g.fillRect(10, -68, 6, 34); } // long hair
      if (i === 2) { g.beginPath(); g.ellipse(15, -60, 5, 14, -0.5, 0, TAU); g.fill(); } // ponytail
      dot(0, -66, 15);
      g.fillStyle = '#ffd9c2'; dot(0, -63, 12);
      g.fillStyle = look.hair; g.beginPath(); g.arc(0, -66, 13.5, Math.PI, TAU); g.fill();
      g.strokeStyle = '#2b1b4d'; g.lineWidth = 1.6;
      g.beginPath(); g.arc(-4.5, -61, 2.4, Math.PI, TAU); g.stroke();
      g.beginPath(); g.arc(4.5, -61, 2.4, Math.PI, TAU); g.stroke();
      g.fillStyle = 'rgba(255,90,150,.55)'; dot(-8, -58, 2.2); dot(8, -58, 2.2);
      g.fillStyle = '#b3305f';
      if (player.playing) { g.beginPath(); g.ellipse(0, -56, 2.6, 2 + Math.abs(Math.sin(clock * 9 + i)) * 2, 0, 0, TAU); g.fill(); }
      else { g.beginPath(); g.arc(0, -57.5, 3, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke(); }
      g.restore();
    }

    function shadowBlob(s) {
      const r = s.r, x = s.x + Math.sin(clock * 1.3 + s.p) * 8, y = s.y + Math.cos(clock * 1.7 + s.p) * 5;
      g.save();
      g.shadowColor = '#b06bff'; g.shadowBlur = 14;
      g.fillStyle = 'rgba(24,10,48,.95)';
      g.beginPath(); g.moveTo(x - r * 0.7, y - r * 0.7); g.lineTo(x - r * 0.9, y - r * 1.5); g.lineTo(x - r * 0.25, y - r * 0.95); g.fill();
      g.beginPath(); g.moveTo(x + r * 0.7, y - r * 0.7); g.lineTo(x + r * 0.9, y - r * 1.5); g.lineTo(x + r * 0.25, y - r * 0.95); g.fill();
      g.beginPath(); g.arc(x, y, r, Math.PI, TAU);
      g.lineTo(x + r, y + r * 0.6);
      for (let k = 0; k < 4; k++) { const x1 = x + r - (k + 0.5) * r / 2, x2 = x + r - (k + 1) * r / 2; g.quadraticCurveTo(x1, y + r * (k % 2 ? 0.5 : 1.1) + Math.sin(clock * 5 + k + s.p) * 2, x2, y + r * 0.6); }
      g.closePath(); g.fill();
      g.restore();
      const blink = (clock + s.blink) % 4 < 0.15 ? 0.15 : 1;
      g.fillStyle = '#ffe66b';
      g.beginPath(); g.ellipse(x - r * 0.35, y - r * 0.1, r * 0.2, r * 0.26 * blink, 0, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(x + r * 0.35, y - r * 0.1, r * 0.2, r * 0.26 * blink, 0, 0, TAU); g.fill();
      g.fillStyle = '#2b1b4d'; dot(x - r * 0.32, y - r * 0.06, r * 0.08 * blink); dot(x + r * 0.38, y - r * 0.06, r * 0.08 * blink);
      s.dx = x; s.dy = y;
    }

    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt;
      bounce *= Math.exp(-dt * 7); flash *= Math.exp(-dt * 6);
      const want = player.playing ? 7 : 3;
      if (shadows.length < want && Math.random() < dt * (player.playing ? 1.6 : 0.5)) spawnShadow();
      shadows.forEach((s) => { s.y += (s.ty - s.y) * dt * 0.9; });
      const theme = store.song.theme || {}, sky = theme.sky || ['#0b0620', '#3a1466'];
      const squad = theme.squad || [{ hair: '#ff5fb0', dress: '#ffd23f' }, { hair: '#8f6bff', dress: '#ff4fa3' }, { hair: '#35d6c4', dress: '#8f6bff' }];

      const grad = g.createLinearGradient(0, 0, 0, Hh);
      grad.addColorStop(0, sky[0]); grad.addColorStop(1, sky[1]);
      g.fillStyle = grad; g.fillRect(0, 0, W, Hh);
      if (flash > 0.02) { g.globalAlpha = flash * 0.22; g.fillStyle = partColor; g.fillRect(0, 0, W, Hh); g.globalAlpha = 1; }
      g.fillStyle = '#fff6c9'; g.shadowColor = '#fff6c9'; g.shadowBlur = 30; dot(W * 0.86, Hh * 0.17, Hh * 0.075); g.shadowBlur = 0;
      stars.forEach((s) => { g.globalAlpha = 0.45 + 0.55 * Math.sin(clock * 2 + s.p) ** 2; g.fillStyle = '#fff'; dot(s.x * W, s.y * Hh, s.r); });
      g.globalAlpha = 1;
      const lit = Math.min(1, 0.12 + zapped / 50);
      buildings.forEach((b) => {
        const bx = b.x * W, bw = b.w * W, bh = b.h * Hh, by = Hh * 0.88 - bh;
        g.fillStyle = '#170b33'; g.fillRect(bx, by, bw + 1, bh + Hh * 0.12);
        const cols = Math.max(2, Math.floor(bw / 12)), rows = Math.max(2, Math.floor(bh / 14));
        for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
          const on = b.win[(c * 5 + r * 3) % b.win.length] < lit;
          g.fillStyle = on ? 'rgba(255,214,102,.9)' : 'rgba(255,255,255,.06)';
          g.fillRect(bx + 4 + c * (bw - 8) / cols, by + 5 + r * (bh - 6) / rows, Math.max(2, (bw - 8) / cols - 4), 5);
        }
      });
      g.fillStyle = '#0d0620'; g.fillRect(0, Hh * 0.93, W, Hh * 0.07);
      const glow = g.createRadialGradient(W / 2, floorY(), 5, W / 2, floorY(), W * 0.3);
      glow.addColorStop(0, 'rgba(255,79,163,' + (0.25 + bounce * 0.3) + ')'); glow.addColorStop(1, 'rgba(255,79,163,0)');
      g.fillStyle = glow; g.fillRect(0, Hh * 0.6, W, Hh * 0.4);

      shadows.forEach(shadowBlob);
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i]; r.r += dt * W * 0.9; r.life -= dt * 1.6;
        if (r.life <= 0) { rings.splice(i, 1); continue; }
        g.strokeStyle = 'rgba(255,230,140,' + r.life * 0.7 + ')'; g.lineWidth = 4;
        g.beginPath(); g.arc(r.x ?? W / 2, r.y ?? floorY() - 40 * unit(), r.r, 0, TAU); g.stroke();
      }
      for (let i = notes.length - 1; i >= 0; i--) {
        const n = notes[i]; n.y -= n.vy * dt * unit(); n.x += (n.tx - n.x) * dt * 1.2; n.life -= dt;
        if (n.life <= 0) { notes.splice(i, 1); continue; }
        g.globalAlpha = Math.min(1, n.life); star(n.x, n.y, n.s, n.color, clock * 3 + i);
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 160 * dt; p.life -= dt;
        if (p.life <= 0) { sparks.splice(i, 1); continue; }
        g.globalAlpha = Math.min(1, p.life * 1.5);
        p.heart ? heart(p.x, p.y, p.s, '#ff7ad9') : star(p.x, p.y, p.s, p.color, clock * 4 + i);
      }
      g.globalAlpha = 1;
      for (let i = 0; i < 3; i++) hunter(i, squad[i] || squad[0]);
      requestAnimationFrame(frame);
    }

    let shown;
    const showWords = (i) => {
      const name = i >= 0 ? store.song.arrangement[i] : null, p = name ? store.song.parts[name] : null;
      const text = p ? (p.emoji || '') + ' ' + (p.lyrics || '🎵') : '✨ Press play to light up the city! ✨';
      if (p) partColor = p.color || partColor;
      if (text !== shown) { shown = text; words.textContent = text; words.style.setProperty('--c', p ? partColor : '#ffd23f'); }
    };
    player.onTick((i) => { play.textContent = player.playing ? '⏹️' : '▶️'; play.classList.toggle('on', player.playing); showWords(i); });
    const sync = () => { title.textContent = (store.song.title || 'Our Song') + (store.song.artist ? ' · ' + store.song.artist : ''); shown = null; showWords(player.current()); };
    store.subscribe(sync); sync();
    resize();
    requestAnimationFrame(frame);
  };
})();
