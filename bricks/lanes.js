// lanes brick (for grown-ups): the selected piece as plain text, and instrument recipes as JSON.
// This is exactly what lives in songs/*.json, so what you type here is what Claude edits too.
//   drums:  x...x...x...x...      x hit, X loud, o soft, . rest, | bar line
//   tunes:  A4 . C5 - E5 - . .    note, - hold, . rest, A3+C4+E4 chord
//   either: "x...x... *4" repeats
(function () {
  'use strict';
  const Kit = Sunosux.Kit, h = Kit.h, H = Kit.helpers, S = Sunosux;

  Kit.components.lanes = (el, app) => {
    const { store, player } = app;
    let recipeKey = null;
    const check = (song, part, lane) => {
      try {
        const p = S.parseLane(lane), want = H.partSteps(song, part);
        p.events.forEach((e) => (e.notes || []).forEach(S.noteToMidi));
        return p.steps === want ? '✓ ' + p.steps + ' steps' : '⚠️ ' + p.steps + ' steps, the piece has ' + want;
      } catch (e) { return '⚠️ ' + e.message; }
    };
    const draw = (what) => {
      if (what === 'lyrics') return;
      if ((what === 'lane' || what === 'jam') && el.contains(document.activeElement)) return; // do not yank the cursor while typing
      const song = store.song, name = store.selectedPart, part = song.parts[name], inst = H.instrumentsOf(song);
      if (!part) return el.replaceChildren(h('h2', {}, '⌨️ Lanes'));
      if (!inst[recipeKey]) recipeKey = (part.tracks[0] || {}).instrument || Object.keys(inst)[0];
      const rows = part.tracks.map((tr, ti) => {
        const status = h('span', { class: 'sx-small' }, check(song, part, tr.lane));
        return h('div', { class: 'sx-lane' },
          h('select', { class: 'sx-select', onchange: (e) => store.change((s) => { s.parts[name].tracks[ti].instrument = e.target.value; }) },
            Object.entries(inst).map(([k, r]) => h('option', { value: k, selected: k === tr.instrument }, (r.emoji || '') + ' ' + k))),
          h('input', { class: 'sx-num', type: 'number', step: 0.1, min: 0, max: 3, value: tr.gain ?? 1, title: 'volume', onchange: (e) => store.change((s) => { s.parts[name].tracks[ti].gain = +e.target.value; }, 'lane') }),
          h('input', { class: 'sx-num', type: 'number', step: 0.1, min: -1, max: 1, value: tr.pan ?? '', placeholder: 'pan', title: 'left -1 … right 1', onchange: (e) => store.change((s) => { const t = s.parts[name].tracks[ti]; if (e.target.value === '') delete t.pan; else t.pan = +e.target.value; }, 'lane') }),
          h('button', { class: 'sx-btn tiny', title: 'edit this instrument', onclick: () => { recipeKey = tr.instrument; draw(); } }, '🔧'),
          h('textarea', { class: 'sx-code', rows: Math.max(1, Math.ceil(tr.lane.length / 90)), spellcheck: 'false',
            oninput: (e) => { status.textContent = check(song, part, e.target.value); },
            onchange: (e) => {
              const v = e.target.value.trim();
              try { S.parseLane(v).events.forEach((ev) => (ev.notes || []).forEach(S.noteToMidi)); } catch (err) { return Kit.toast(err.message); }
              store.change((s) => { s.parts[name].tracks[ti].lane = v; }, 'lane');
            } }, tr.lane),
          status);
      });
      const recipeBox = h('textarea', { class: 'sx-code', rows: 6, spellcheck: 'false' }, JSON.stringify(inst[recipeKey], null, 1));
      const applyRecipe = (key) => {
        let r;
        try { r = JSON.parse(recipeBox.value); } catch (e) { return Kit.toast('that is not JSON: ' + e.message); }
        store.change((s) => { s.instruments = s.instruments || {}; s.instruments[key] = r; });
        player.trigger(r, 'C5');
      };
      el.replaceChildren(
        h('h2', {}, '⌨️ Lanes: ' + part.emoji + ' ' + name),
        h('div', { class: 'sx-small' }, 'drums: x hit, X loud, o soft, . rest   ·   tunes: A4 note, - hold, . rest, A3+C4+E4 chord   ·   "… *4" repeats   ·   16 steps a bar'),
        ...rows,
        h('div', { class: 'sx-row' },
          h('button', { class: 'sx-btn', onclick: () => player.playPart(name) }, '▶️ piece'),
          h('button', { class: 'sx-btn', onclick: () => player.looping ? player.stop() : player.loopPart(name) }, '🔁 loop'),
          h('button', { class: 'sx-btn', onclick: () => store.change((s) => s.parts[name].tracks.push({ instrument: 'lead', lane: H.emptyLane(inst.lead, H.partSteps(s, s.parts[name])) })) }, '➕ lane')),
        h('h2', {}, '🔧 Instrument recipe: ' + recipeKey),
        h('div', { class: 'sx-small' }, 'wave sine|square|saw|triangle · voices · detune (cents) · octave · env {a,d,s,r} · filter {cutoff,q,envAmount} · vibrato {rate,depth} · sub · noise · gain  ·  drums: kind kick|snare|clap|hat|tom|zap, decay, pitch  ·  recordings: sample, pitched, root'),
        recipeBox,
        h('div', { class: 'sx-row' },
          h('button', { class: 'sx-btn', onclick: () => { try { player.trigger(JSON.parse(recipeBox.value), 'C5'); } catch (e) { Kit.toast(e.message); } } }, '👂 try'),
          h('button', { class: 'sx-btn', onclick: () => applyRecipe(recipeKey) }, '💾 save for this song'),
          h('button', { class: 'sx-btn', onclick: () => { const k = (prompt('Name for the new instrument (letters, numbers, dashes)') || '').replace(/[^\w-]/g, ''); if (k) { applyRecipe(k); recipeKey = k; draw(); } } }, '✨ save as new')));
    };
    store.subscribe(draw); draw();
  };
})();
