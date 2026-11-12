// Basic bricks: playBar, parts, timeline, lyrics, saveBar.
(function () {
  'use strict';
  const Kit = Sunosux.Kit, C = Kit.components, h = Kit.h, H = Kit.helpers;

  // Title, big play/stop, undo, tempo
  C.playBar = (el, app) => {
    const { store, player } = app;
    const title = h('div', { class: 'sx-title' });
    const play = h('button', { class: 'sx-big sx-play', onclick: () => player.playing ? player.stop() : player.play() }, '▶️ Play');
    const tempoLabel = h('span', { class: 'sx-small' });
    const tempo = h('input', { type: 'range', min: 70, max: 170, class: 'sx-tempo',
      oninput: (e) => { tempoLabel.textContent = '🐢 ' + e.target.value + ' 🐇'; },
      onchange: (e) => store.change((s) => { s.bpm = +e.target.value; }) });
    el.append(h('div', { class: 'sx-row' }, title, play,
      h('button', { class: 'sx-btn', onclick: () => store.undo() }, '↩️ Undo'),
      h('label', { class: 'sx-row' }, tempoLabel, tempo)));
    const draw = () => {
      title.textContent = (store.song.title || 'Our Song') + (store.song.artist ? ' · ' + store.song.artist : '');
      tempo.value = store.song.bpm; tempoLabel.textContent = '🐢 ' + Math.round(store.song.bpm) + ' 🐇';
      // a song with singing in it keeps its speed: the recordings cannot stretch
      const sung = Object.values(store.song.instruments || {}).some((r) => r.vocal);
      tempo.disabled = sung; tempo.title = sung ? 'This song has singing in it, so its speed is locked to the singing.' : 'speed';
      if (sung) tempoLabel.textContent = '🔒 ' + Math.round(store.song.bpm) + ' beats a minute';
    };
    store.subscribe(draw); draw();
    player.onTick(() => { play.textContent = player.playing ? '⏹️ Stop' : '▶️ Play'; play.classList.toggle('on', player.playing); });
  };

  // A card for every piece: tap to hear it, ➕ puts it in the song
  C.parts = (el, app) => {
    const { store, player } = app;
    const draw = (what) => {
      if (what === 'jam' || what === 'lane' || what === 'lyrics') return;
      Kit.fill(el, h('h2', {}, '🧩 Song pieces'), h('div', { class: 'sx-cards' },
        Object.entries(store.song.parts).map(([name, p]) => h('div', { class: 'sx-card' + (store.selectedPart === name ? ' sel' : ''), style: { '--c': p.color || '#ff4fa3' } },
          h('button', { class: 'sx-card-face', onclick: () => { const looping = player.looping; store.select(name); if (!looping) player.playPart(name); } },
            h('span', { class: 'sx-emoji' }, p.emoji || '🎵'), h('span', {}, name)),
          h('div', { class: 'sx-card-tools' },
            h('button', { class: 'sx-btn', title: 'put it in the song', onclick: () => store.change((s) => s.arrangement.push(name)) }, '➕'),
            h('button', { class: 'sx-btn', title: 'make a copy to change', onclick: () => store.change((s) => {
              let n = name + '2'; while (s.parts[n]) n += '!';
              s.parts[n] = H.clone(s.parts[name]); store.selectedPart = n;
            }) }, '👯')))),
        h('button', { class: 'sx-card sx-new', onclick: () => store.change((s) => {
          const n = Object.keys(s.parts).length;
          let name = 'piece' + (n + 1); while (s.parts[name]) name += '!';
          const inst = H.instrumentsOf(s), steps = 2 * H.stepsPerBar(s);
          s.parts[name] = { emoji: Kit.EMOJI[n % Kit.EMOJI.length], color: Kit.COLORS[n % Kit.COLORS.length], bars: 2, lyrics: '',
            tracks: [{ instrument: 'kick', lane: 'x...x...x...x...|x...x...x...x...' }, { instrument: 'lead', lane: H.emptyLane(inst.lead, steps) }] };
          store.selectedPart = name;
        }) }, h('span', { class: 'sx-emoji' }, '✨'), h('span', {}, 'new piece'))));
    };
    store.subscribe(draw); draw();
  };

  // The song: a row of blocks in order. Tap one to play from there.
  C.timeline = (el, app) => {
    const { store, player } = app;
    let blocks = [];
    const move = (i, d) => store.change((s) => { const [x] = s.arrangement.splice(i, 1); s.arrangement.splice(i + d, 0, x); });
    const draw = (what) => {
      if (what === 'jam' || what === 'lane' || what === 'lyrics') return;
      const arr = store.song.arrangement;
      blocks = arr.map((name, i) => {
        const p = store.song.parts[name] || {};
        return h('div', { class: 'sx-block', style: { '--c': p.color || '#888', flexGrow: p.bars || 1 } },
          h('button', { class: 'sx-block-face', title: name, onclick: () => player.playFrom(i) }, h('span', { class: 'sx-emoji' }, p.emoji || '🎵')),
          h('div', { class: 'sx-block-tools' },
            h('button', { title: 'earlier', onclick: () => i > 0 && move(i, -1) }, '◀'),
            h('button', { title: 'take out', onclick: () => store.change((s) => s.arrangement.splice(i, 1)) }, '✖'),
            h('button', { title: 'later', onclick: () => i < arr.length - 1 && move(i, 1) }, '▶')));
      });
      Kit.fill(el, h('h2', {}, '🎶 Our song'),
        h('div', { class: 'sx-timeline' }, blocks.length ? blocks : h('div', { class: 'sx-small' }, 'Empty! Tap ➕ on a piece to put it in.')));
    };
    store.subscribe(draw); draw();
    player.onTick((i) => blocks.forEach((b, j) => b.classList.toggle('now', i === j)));
  };

  // Sing-along words for whatever is playing, and a box to change them
  C.lyrics = (el, app) => {
    const { store, player } = app;
    const words = h('div', { class: 'sx-lyrics-now' });
    const edit = h('textarea', { class: 'sx-text', rows: 2, placeholder: 'words for this piece…',
      onchange: (e) => store.change((s) => { s.parts[store.selectedPart].lyrics = e.target.value; }, 'lyrics') });
    el.append(h('h2', {}, '🎤 Sing along'), words, edit);
    let last;
    const show = (i) => {
      const name = i >= 0 ? store.song.arrangement[i] : store.selectedPart;
      const p = store.song.parts[name], text = p ? (p.lyrics || '🎵 la la la 🎵') : '';
      if (text === last) return;
      last = text; words.textContent = text;
      words.style.setProperty('--c', (p && p.color) || '#ff4fa3');
    };
    player.onTick((i) => show(i));
    const sync = () => { show(player.current()); const p = store.song.parts[store.selectedPart]; if (document.activeElement !== edit) edit.value = p ? p.lyrics || '' : ''; };
    store.subscribe(sync); sync();
  };

  // Take the song home
  C.saveBar = (el, app) => {
    const { store, player, io } = app;
    const slug = () => (store.song.title || 'song').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    el.append(h('h2', {}, '💾 Keep it'), h('div', { class: 'sx-row' },
      h('button', { class: 'sx-btn', onclick: async () => Kit.download(await player.wav(), slug() + '.wav') }, '⬇️ download our song'),
      h('button', { class: 'sx-btn', onclick: () => {
        const text = JSON.stringify(store.song, null, 2);
        Kit.download(new Blob([text], { type: 'application/json' }), slug() + '.json');
        H.safe(() => navigator.clipboard.writeText(text));
      } }, '📄 song file'),
      !io.live && h('button', { class: 'sx-btn', onclick: () => Object.values(store.song.instruments || {}).filter((r) => r.sample && store.samples[r.sample])
        .forEach((r) => Kit.download(new Blob([Kit.monoWav(store.samples[r.sample])], { type: 'audio/wav' }), r.sample + '.wav')) }, '🎙️ our recordings'),
      !io.live && h('button', { class: 'sx-btn', onclick: () => { if (confirm('Go back to the starting song? Your changes will be gone.')) Promise.resolve(io.clear()).then(() => location.reload()); } }, '🔄 start over')),
      h('div', { class: 'sx-small' }, io.live ? '✅ Every change is saved in the repo as you go: ' + io.path : 'Changes are remembered in this browser. Download the song file to put it in the repo.'));
  };
})();
