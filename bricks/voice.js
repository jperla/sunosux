// Voice bricks: recorder (your sound becomes an instrument) and hum (your humming becomes the tune),
// plus soundLab (invent a synth by picking kid-sized choices).
(function () {
  'use strict';
  const Kit = Sunosux.Kit, C = Kit.components, h = Kit.h, H = Kit.helpers, S = Sunosux;

  // Record anything: a "hey!", a giggle, a roar. Keep it as a drum pad or as singing notes.
  C.recorder = (el, app) => {
    const { store, player } = app;
    let last = null;
    const say = h('div', { class: 'sx-small' }, 'Tap, make a sound, tap again. A "hey!", a giggle, a roar…');
    const mic = Kit.micButton(app, '🎙️ record a sound', (data) => {
      last = data;
      say.textContent = '🎉 Got it! Now choose what it becomes.';
      player.playData(data);
      draw();
    }, 6);
    const file = h('input', { type: 'file', accept: 'audio/*', onchange: (e) => e.target.files[0] && mic.useBlob(e.target.files[0]) });
    const keep = (pitched) => {
      const emoji = prompt('Pick an emoji for your sound', pitched ? '🎤' : '🐯') || '🎉';
      const key = 'rec-' + Date.now().toString(36);
      store.addSample(key, last);
      const recipe = { emoji, label: 'Our ' + emoji, sample: key, pitched, root: 'C5', gain: 0.9 };
      if (pitched) recipe.env = { a: 0.01, d: 0.1, s: 1, r: 0.15 };
      store.change((s) => { s.instruments = s.instruments || {}; s.instruments[key] = recipe; });
      Kit.toast(emoji + ' is an instrument now! Find it on the pads.');
      last = null; draw();
    };
    const draw = () => Kit.fill(el, h('h2', {}, '🎙️ Our own sounds'), say,
      h('div', { class: 'sx-row' }, mic, h('label', { class: 'sx-btn' }, '📁 or pick a file', file)),
      last && h('div', { class: 'sx-row' },
        h('button', { class: 'sx-btn', onclick: () => player.playData(last) }, '👂 listen'),
        h('button', { class: 'sx-big', onclick: () => keep(false) }, '🥁 make it a pad'),
        h('button', { class: 'sx-big', onclick: () => keep(true) }, '🎹 make it sing notes')));
    draw();
  };

  // Hum or sing "la la la" and the chosen instrument plays your tune in the selected piece.
  C.hum = (el, app) => {
    const { store, player } = app;
    let singer = 'lead';
    const say = h('div', { class: 'sx-small' });
    const mic = Kit.micButton(app, '🎶 hum a tune', async (data) => {
      const song = store.song, name = store.selectedPart, part = song.parts[name];
      if (!part) return;
      const steps = H.partSteps(song, part);
      const found = await Kit.busy(() => S.detectMelody(data, { bpm: song.bpm, stepsPerBeat: song.stepsPerBeat, steps, scale: song.scale }));
      if (!found.notes) return Kit.toast('🙉 I could not find a tune. Try a nice long "laaa laaa"!');
      store.change((s) => {
        const tracks = s.parts[name].tracks, i = tracks.findIndex((t) => t.instrument === singer);
        if (i >= 0) tracks[i].lane = found.lane; else tracks.push({ instrument: singer, lane: found.lane });
      });
      say.textContent = '✨ I heard ' + found.notes + ' notes! Not right? Tap ↩️ and hum again.';
      player.loopPart(name);
    }, 10);
    const draw = (what) => {
      if (what === 'jam' || what === 'lane' || what === 'lyrics') return;
      const inst = H.instrumentsOf(store.song), part = store.song.parts[store.selectedPart];
      const tunes = Object.entries(inst).filter(([, r]) => !H.isDrumRecipe(r));
      if (!inst[singer]) singer = (tunes[0] || [])[0];
      if (!say.textContent || what === 'select') say.textContent = 'Sing "la la la" and ' + ((inst[singer] || {}).emoji || '🎤') + ' will play your tune in ' + (part ? part.emoji + ' ' + store.selectedPart : 'a piece') + '.';
      Kit.fill(el, h('h2', {}, '🎶 Hum catcher'), say,
        h('div', { class: 'sx-row' }, mic, h('button', { class: 'sx-btn', onclick: () => store.undo() }, '↩️'),
          h('span', { class: 'sx-small' }, 'who sings it?'),
          tunes.map(([k, r]) => h('button', { class: 'sx-btn' + (k === singer ? ' on' : ''), title: r.label || k, onclick: () => { singer = k; player.trigger(r, 'C5'); say.textContent = ''; draw(); } }, r.emoji || '🎵'))));
    };
    store.subscribe(draw); draw();
  };

  // Invent an instrument without any numbers
  C.soundLab = (el, app) => {
    const { store, player } = app;
    const pick = { wave: 'triangle', crowd: 1, length: 'medium', wobble: false, octave: 0, sharp: false, emoji: '🦄' };
    const recipe = () => ({
      emoji: pick.emoji, label: 'My ' + pick.emoji, wave: pick.wave, voices: pick.crowd, detune: pick.crowd > 1 ? 20 : 0, octave: pick.octave,
      env: pick.length === 'short' ? { a: 0.002, d: 0.18, s: 0, r: 0.15 } : pick.length === 'long' ? { a: 0.25, d: 0.4, s: 0.8, r: 0.8 } : { a: 0.01, d: 0.2, s: 0.7, r: 0.2 },
      vibrato: pick.wobble ? { rate: 6, depth: 0.25 } : undefined,
      filter: pick.sharp ? undefined : { cutoff: 2400, q: 1, envAmount: 0.8 }, gain: 0.25,
    });
    const group = (title, key, opts) => h('div', { class: 'sx-row' }, h('span', { class: 'sx-small sx-choice-name' }, title),
      opts.map(([v, lab]) => h('button', { class: 'sx-btn' + (pick[key] === v ? ' on' : ''), onclick: () => { pick[key] = v; draw(); player.trigger(recipe(), 'C5'); } }, lab)));
    const draw = () => Kit.fill(el, h('h2', {}, '🧪 Sound Lab: invent an instrument'),
      group('sound', 'wave', [['sine', '🌊 smooth'], ['triangle', '🪈 flute'], ['square', '👾 video game'], ['saw', '🐝 buzzy']]),
      group('how many', 'crowd', [[1, '🧍 one'], [3, '👯 three'], [7, '🏟️ a crowd']]),
      group('how long', 'length', [['short', '🐜 plink'], ['medium', '🐕 note'], ['long', '🐋 looong']]),
      group('high or low', 'octave', [[-1, '🐻 low'], [0, '🐰 middle'], [1, '🐦 high']]),
      group('wobble', 'wobble', [[false, '🧊 still'], [true, '🍮 wobbly']]),
      group('feel', 'sharp', [[false, '🧸 soft'], [true, '🦔 spiky']]),
      group('emoji', 'emoji', Kit.EMOJI.slice(0, 10).map((e) => [e, e])),
      h('div', { class: 'sx-row' },
        h('button', { class: 'sx-big', onclick: () => ['A4', 'C5', 'E5', 'A5'].forEach((n, i) => setTimeout(() => player.trigger(recipe(), n), i * 180)) }, '👂 try it'),
        h('button', { class: 'sx-big', onclick: () => {
          const r = recipe(), key = 'my-' + Date.now().toString(36);
          store.change((s) => { s.instruments = s.instruments || {}; s.instruments[key] = r; });
          Kit.toast(r.emoji + ' saved! Find it on the pads and in the instrument list.');
        } }, '💾 keep it')));
    draw();
  };
})();
