// seed brick: start a song from a bit of singing.
// Sing anything, with no music and no counting. Pick the best bit by dragging
// the two ✂️ edges. Press ✨ and a whole first song is built around that bit:
// the tempo is set so your bit is a whole number of bars, the band tunes itself
// to your voice, and the chords follow the notes you sang.
// Needs src/seed.js loaded before this file.
(function () {
  'use strict';
  const Kit = Sunosux.Kit, h = Kit.h, H = Kit.helpers, S = Sunosux, Seed = Sunosux.Seed;
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  Kit.components.seed = (el, app) => {
    const { player } = app;
    let data = null, a = 0, b = 0, bars = null, drag = null, heard = '', hearing = null, kept = null;
    const say = h('div', { class: 'sx-small' }, 'Sing a little bit of a song, any way you like. No music, no counting. Then we build the song around it.');
    const title = h('input', { class: 'sx-text', placeholder: 'the name of our song' });
    const lyrics = h('textarea', { class: 'sx-text', rows: 3, placeholder: 'the words you sang…' });
    const wave = h('canvas', { class: 'sx-wave' });
    const info = h('div', { class: 'sx-small' }), barRow = h('div', { class: 'sx-row' });
    const dur = () => data ? data.length / S.SR : 0;
    const pieceBars = () => bars || Seed.guessBars(b - a);

    // Best effort: let the browser listen for the words too. Singing confuses it, so the box stays editable.
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    const mic = Kit.micButton(app, '🎙️ sing a bit of a song', (d) => use(d), 90, {
      raw: true,
      onStart() {
        heard = '';
        if (Speech) H.safe(() => {
          hearing = new Speech(); hearing.continuous = true;
          hearing.onresult = (e) => { heard = Array.from(e.results).map((r) => r[0].transcript).join(' '); if (data && !lyrics.dataset.typed) lyrics.value = heard; };
          hearing.onerror = () => {};
          hearing.start();
        });
      },
      onStop() { H.safe(() => hearing && hearing.stop()); },
    });
    lyrics.addEventListener('input', () => { lyrics.dataset.typed = '1'; });
    const file = h('input', { type: 'file', accept: 'audio/*', onchange: (e) => e.target.files[0] && mic.useBlob(e.target.files[0]) });

    function use(d) {
      player.stop();
      data = d; bars = null; kept = null;
      a = 0; b = dur() <= 20 ? dur() : 10; // a long take starts with its first ten seconds picked
      // keep the take on disk straight away, so a refresh or a closed tab cannot lose it
      if (app.live) {
        const name = 'seed-' + Date.now().toString(36);
        fetch('/api/file?path=sounds/' + name + '.wav', { method: 'PUT', headers: Kit.API, body: Kit.monoWav(d) })
          .then((r) => { if (r.ok) { kept = name; say.textContent = '✅ Your singing is saved (sounds/' + name + '.wav). Now pick the best bit.'; } })
          .catch(() => {});
      }
      if (heard && !lyrics.dataset.typed) lyrics.value = heard;
      draw();
    }

    function paint() {
      if (!data) return;
      const r = wave.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      if (!r.width) return;
      wave.width = Math.round(r.width * dpr); wave.height = Math.round(r.height * dpr);
      const g = wave.getContext('2d'), W = wave.width, Hh = wave.height, per = data.length / W;
      const xa = a / dur() * W, xb = b / dur() * W;
      g.clearRect(0, 0, W, Hh);
      g.fillStyle = 'rgba(255, 79, 163, .22)'; g.fillRect(xa, 0, xb - xa, Hh);
      for (let x = 0; x < W; x++) {
        let peak = 0;
        for (let i = Math.floor(x * per), end = Math.min(data.length, Math.floor((x + 1) * per) + 1); i < end; i += 8) peak = Math.max(peak, Math.abs(data[i]));
        g.fillStyle = x >= xa && x <= xb ? '#ffd23f' : 'rgba(255, 255, 255, .35)';
        g.fillRect(x, Hh / 2 - peak * Hh * 0.48, 1, Math.max(1, peak * Hh * 0.96));
      }
      g.fillStyle = '#ff4fa3';
      for (const x of [xa, xb]) { g.fillRect(Math.max(0, Math.min(W - 4 * dpr, x - 2 * dpr)), 0, 4 * dpr, Hh); }
      const n = pieceBars(), bpm = n * 240 / (b - a);
      info.textContent = '✂️ your bit is ' + (b - a).toFixed(1) + ' seconds: ' + n + (n === 1 ? ' bar' : ' bars') + ' at ' + Math.round(bpm) + ' beats a minute';
      Kit.fill(barRow, h('span', { class: 'sx-small' }, 'feels too fast or too slow? it is'),
        [1, 2, 4, 8, 16].filter((k) => { const t = k * 240 / (b - a); return t >= 45 && t <= 220; })
          .map((k) => h('button', { class: 'sx-btn' + (k === n ? ' on' : ''), onclick: () => { bars = k; paint(); } }, k + (k === 1 ? ' bar' : ' bars'))));
    }

    const toTime = (e) => { const r = wave.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur(); };
    const move = (e) => {
      if (!drag) return;
      const t = toTime(e);
      if (drag === 'a') a = Math.max(0, Math.min(t, b - 0.5)); else b = Math.min(dur(), Math.max(t, a + 0.5));
      bars = null;
      paint();
    };
    wave.addEventListener('pointerdown', (e) => { if (!data) return; const t = toTime(e); drag = Math.abs(t - a) < Math.abs(t - b) ? 'a' : 'b'; wave.setPointerCapture(e.pointerId); move(e); });
    wave.addEventListener('pointermove', move);
    wave.addEventListener('pointerup', () => { drag = null; });
    new ResizeObserver(paint).observe(wave);

    const piece = () => data.slice(Math.round(a * S.SR), Math.round(b * S.SR));
    const listen = () => {
      if (player.playing) return player.stop();
      const p = piece();
      player.playAudio({ sampleRate: S.SR, left: p, right: p, duration: p.length / S.SR }, 0, { loop: true });
    };

    async function build() {
      player.stop();
      const name = title.value.trim() || 'Our Song', raw = piece();
      try {
        let id = slug(name) || 'our-song';
        for (let n = 2; await Kit.songExists(app, id); n++) id = (slug(name) || 'our-song') + '-' + n; // never write over another song
        const analysis = await Kit.busy(() => Seed.analyze(raw, { bars: bars || undefined }));
        const voice = raw.slice();
        S.polishVoice(voice);
        const full = kept || id + '-full', files = { [id + '-hook']: voice };
        if (!kept) files[full] = data;
        const song = Seed.build(analysis, { title: name, lyrics: lyrics.value.trim(), sample: id + '-hook', recording: full, from: +a.toFixed(3), to: +b.toFixed(3) });
        await Kit.saveNewSong(app, id, song, files);
        location.href = '../stage/?song=' + id;
      } catch (e) { Kit.toast('🙈 ' + e.message); }
    }

    function draw() {
      Kit.fill(el,
        h('h2', {}, '🌱 Start a song from your singing'), say,
        h('div', { class: 'sx-row' }, mic, h('label', { class: 'sx-btn' }, '📁 or pick a recording', file)),
        data && [
          h('div', { class: 'sx-small' }, 'Drag the two pink edges to keep just the best bit.'),
          wave, info, barRow,
          h('div', { class: 'sx-row' }, h('button', { class: 'sx-btn', onclick: listen }, '👂 hear my bit (round and round)')),
          title, lyrics,
          h('div', { class: 'sx-row' }, h('button', { class: 'sx-big', onclick: build }, '✨ build a song around it')),
        ]);
      requestAnimationFrame(paint);
    }
    draw();
  };
})();
