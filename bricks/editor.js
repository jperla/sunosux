// editor brick: a tap grid for the selected piece.
// Drums get on/off boxes. Tunes get a note grid that only shows notes from the
// song's scale (so everything sounds good) plus any notes already in the tune.
(function () {
  'use strict';
  const Kit = Sunosux.Kit, h = Kit.h, H = Kit.helpers, S = Sunosux;

  Kit.components.editor = (el, app) => {
    const { store, player } = app;
    let bar = 0;
    const draw = (what) => {
      if (what === 'lyrics') return;
      const song = store.song, name = store.selectedPart, part = song.parts[name];
      if (!part) return Kit.fill(el, h('h2', {}, '✏️ Pick a piece to change it'));
      const spb = H.stepsPerBar(song), bars = part.bars || 1, steps = bars * spb, inst = H.instrumentsOf(song);
      if (bar >= bars) bar = 0;
      const cols = Array.from({ length: spb }, (_, k) => bar * spb + k);

      const head = h('div', { class: 'sx-row sx-ed-head', style: { '--c': part.color } },
        h('span', { class: 'sx-emoji' }, part.emoji), h('b', {}, name),
        h('button', { class: 'sx-btn', onclick: () => player.looping === name ? player.stop() : player.loopPart(name) }, '🔁 round and round'),
        h('span', { class: 'sx-small' }, 'bar'),
        Array.from({ length: bars }, (_, b) => h('button', { class: 'sx-btn' + (b === bar ? ' on' : ''), onclick: () => { bar = b; draw(); } }, String(b + 1))),
        h('button', { class: 'sx-btn', title: 'longer', onclick: () => store.change((s) => H.setBars(s, s.parts[name], bars + 1)) }, '➕'),
        bars > 1 && h('button', { class: 'sx-btn', title: 'shorter', onclick: () => store.change((s) => H.setBars(s, s.parts[name], bars - 1)) }, '➖'),
        h('button', { class: 'sx-btn', title: 'emoji', onclick: () => { const e = prompt('Pick an emoji for this piece', part.emoji); if (e) store.change((s) => { s.parts[name].emoji = e; }); } }, '😀'),
        h('input', { type: 'color', class: 'sx-color', value: part.color || '#ff4fa3', title: 'color', onchange: (e) => store.change((s) => { s.parts[name].color = e.target.value; }) }),
        h('button', { class: 'sx-btn', title: 'rename', onclick: () => {
          const n = (prompt('New name for this piece', name) || '').trim();
          if (!n || n === name || song.parts[n]) return;
          store.change((s) => { s.parts[n] = s.parts[name]; delete s.parts[name]; s.arrangement = s.arrangement.map((x) => x === name ? n : x); store.selectedPart = n; });
        } }, '🏷️'),
        h('button', { class: 'sx-btn', title: 'throw away', onclick: () => { if (confirm('Throw away ' + name + '?')) store.change((s) => { delete s.parts[name]; s.arrangement = s.arrangement.filter((x) => x !== name); }); } }, '🗑️'));

      const rows = part.tracks.map((tr, ti) => {
        const recipe = inst[tr.instrument] || {}, drum = H.isDrumRecipe(recipe), events = H.laneEvents(tr.lane, steps);
        const setLane = (evs) => store.change((s) => { s.parts[name].tracks[ti].lane = H.eventsToLane(evs, steps, drum); }, 'lane');
        const vol = (d) => store.change((s) => { const t = s.parts[name].tracks[ti]; t.gain = Math.max(0, +((t.gain ?? 1) + d).toFixed(2)); }, 'lane');
        const label = h('div', { class: 'sx-track-label' },
          h('button', { class: 'sx-btn', title: 'hear it', onclick: () => player.trigger(recipe, 'C5') }, recipe.emoji || '🎵'),
          h('span', { class: 'sx-small' }, recipe.label || tr.instrument),
          h('button', { class: 'sx-btn tiny', title: 'quieter', onclick: () => vol(-0.2) }, '🔉'),
          h('button', { class: 'sx-btn tiny', title: 'louder', onclick: () => vol(0.2) }, '🔊'),
          h('button', { class: 'sx-btn tiny', title: 'take out', onclick: () => store.change((s) => s.parts[name].tracks.splice(ti, 1)) }, '✖'));
        if (recipe.vocal) return h('div', { class: 'sx-track' }, label, h('div', { class: 'sx-small' }, '🎙️ a sung take: it plays from the start of this piece (change it in "Sing a piece")'));
        if (drum) {
          return h('div', { class: 'sx-track' }, label, h('div', { class: 'sx-grid', style: { '--n': spb } }, cols.map((st) => {
            const on = events.find((e) => e.step === st);
            return h('button', { class: 'sx-cell' + (on ? ' on' : '') + (st % 4 === 0 ? ' beat' : ''), style: { '--c': part.color },
              onclick: () => { if (!on) player.trigger(recipe); setLane(on ? events.filter((e) => e !== on) : events.concat([{ step: st, vel: 0.8, len: 1 }])); } });
          })));
        }
        const used = new Set();
        events.forEach((e) => (e.notes || []).forEach((n) => used.add(n)));
        const midis = [...used].map(S.noteToMidi);
        const lo = midis.length ? Math.min(...midis) : S.noteToMidi('A4'), hi = midis.length ? Math.max(...midis) : S.noteToMidi('A5');
        const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const nm = (m) => NAMES[m % 12] + (Math.floor(m / 12) - 1);
        H.scaleNotes(song, nm(Math.max(12, lo - 4)), nm(Math.min(108, Math.max(hi + 4, lo + 12)))).forEach((n) => used.add(n));
        const noteRows = [...used].sort((a, b) => S.noteToMidi(b) - S.noteToMidi(a));
        return h('div', { class: 'sx-track' }, label, h('div', { class: 'sx-roll' }, noteRows.map((n) => h('div', { class: 'sx-grid', style: { '--n': spb } }, cols.map((st) => {
          const start = events.find((e) => e.step === st && e.notes && e.notes.includes(n));
          const hold = !start && events.find((e) => e.notes && e.notes.includes(n) && st > e.step && st < e.step + e.len);
          return h('button', { class: 'sx-cell note' + (start ? ' on' : hold ? ' hold' : '') + (st % 4 === 0 ? ' beat' : ''), title: n, style: { '--c': part.color }, onclick: () => {
            let evs = events;
            const at = evs.find((e) => e.step === st);
            if (start) { at.notes = at.notes.filter((x) => x !== n); if (!at.notes.length) evs = evs.filter((e) => e !== at); }
            else if (at) at.notes.push(n);
            else evs.push({ step: st, notes: [n], len: 2, vel: 0.85 });
            if (!start) player.trigger(recipe, n);
            setLane(evs);
          } }, st === bar * spb ? h('span', { class: 'sx-note-name' }, n) : null);
        })))));
      });

      const picker = h('select', { class: 'sx-select', onchange: (e) => {
        const key = e.target.value;
        if (key) store.change((s) => s.parts[name].tracks.push({ instrument: key, lane: H.emptyLane(inst[key], steps) }));
      } }, h('option', { value: '' }, '➕ add an instrument…'), Object.entries(inst).filter(([, r]) => !r.vocal).map(([k, r]) => h('option', { value: k }, (r.emoji || '🎵') + ' ' + (r.label || k))));
      Kit.fill(el, h('h2', {}, '✏️ Change a piece'), head, ...rows, picker);
    };
    store.subscribe(draw); draw();
  };
})();
