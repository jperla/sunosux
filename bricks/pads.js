// pads brick: big pads you can bang on any time.
// Turn on "catch my taps" and the selected piece plays round and round while
// every tap you make is snapped to the beat and written into the song.
(function () {
  'use strict';
  const Kit = Sunosux.Kit, h = Kit.h, H = Kit.helpers;

  Kit.components.pads = (el, app) => {
    const { store, player } = app;
    let tune = 'lead', catching = false;

    const tap = (key, note, pad) => {
      const song = store.song, recipe = H.instrumentsOf(song)[key];
      player.trigger(recipe, note || 'C5');
      pad.classList.remove('hit'); void pad.offsetWidth; pad.classList.add('hit');
      const name = store.selectedPart;
      if (!catching || player.looping !== name) return;
      // snap to the nearest half-beat so it always lands in time
      const part = song.parts[name], steps = H.partSteps(song, part), grid = 2;
      const stepSec = 60 / song.bpm / (song.stepsPerBeat || 4);
      const step = (Math.round(player.time() / stepSec / grid) * grid) % steps;
      store.change((s) => H.addHit(s, name, key, step, note), 'jam');
    };

    const draw = (what) => {
      if (what === 'jam' || what === 'lane' || what === 'lyrics') return;
      const song = store.song, inst = H.instrumentsOf(song), part = song.parts[store.selectedPart];
      const drums = Object.entries(inst).filter(([, r]) => H.isDrumRecipe(r) && !r.vocal); // sung takes are not pads
      const tunes = Object.entries(inst).filter(([, r]) => !H.isDrumRecipe(r));
      if (!inst[tune] || H.isDrumRecipe(inst[tune])) tune = (tunes[0] || [])[0];
      const notes = H.scaleNotes(song, 'A4', 'C6');
      const pad = (key, r, note, i) => {
        const b = h('button', { class: 'sx-pad' + (note ? ' note' : ''), title: r.label || key, style: { '--c': Kit.COLORS[i % Kit.COLORS.length] } },
          h('span', { class: 'sx-emoji' }, r.emoji || '🎵'), note ? h('span', { class: 'sx-small' }, '♪'.repeat(1 + (i % 3))) : null);
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); tap(key, note, b); });
        return b;
      };
      const catchBtn = h('button', { class: 'sx-big sx-catch' + (catching ? ' on' : ''), onclick: () => {
        const on = !catching;
        player.stop();
        catching = on;
        if (on && store.selectedPart) player.loopPart(store.selectedPart);
        draw();
      } }, catching ? '⏹️ stop catching' : '🔴 catch my taps');
      Kit.fill(el, 
        h('h2', {}, '🪄 Magic pads'),
        h('div', { class: 'sx-row' }, catchBtn, h('button', { class: 'sx-btn', onclick: () => store.undo() }, '↩️ oops'),
          h('span', { class: 'sx-small' }, catching && part ? 'Your taps go into ' + part.emoji + ' ' + store.selectedPart : 'Tap the pads! Press 🔴 to put your taps in a piece.')),
        h('div', { class: 'sx-pads' }, drums.map(([k, r], i) => pad(k, r, null, i))),
        h('div', { class: 'sx-row' }, h('span', { class: 'sx-small' }, 'tune pads play'),
          tunes.map(([k, r]) => h('button', { class: 'sx-btn' + (k === tune ? ' on' : ''), title: r.label || k, onclick: () => { tune = k; draw(); } }, r.emoji || '🎵'))),
        tune ? h('div', { class: 'sx-pads tune' }, notes.map((n, i) => pad(tune, inst[tune], n, i))) : null);
    };
    store.subscribe(draw);
    player.onTick(() => { if (catching && !player.looping) { catching = false; draw(); } });
    draw();
  };
})();
