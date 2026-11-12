// sing brick: the vocal booth. Pick a piece, press 🎤, hear a count of four,
// and sing along while the piece plays. The take is cut to start exactly where
// the piece starts and is added to that piece, so it plays wherever the piece
// is in the song. Sing again to add another voice (a harmony, or a duet).
//
// A take is an ordinary recording instrument with two extras:
//   { sample: 'take-abc', pitched: false, vocal: true, offset: 0.02 }
// `offset` (seconds) slides it later or earlier if it sounds off the beat,
// which happens with Bluetooth headphones and some microphones.
(function () {
  'use strict';
  const Kit = Sunosux.Kit, h = Kit.h, H = Kit.helpers, S = Sunosux;

  // Runs on the audio thread: hands over the microphone samples with the exact
  // audio-clock time they belong to, so the take can be lined up with the band.
  const WORKLET = `registerProcessor('sx-capture', class extends AudioWorkletProcessor {
    constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; this.t = 0; }
    process(inputs) {
      const ch = inputs[0] && inputs[0][0];
      if (!ch) return true;
      if (this.n === 0) this.t = currentTime;
      this.buf.set(ch, this.n); this.n += ch.length;
      if (this.n >= 2048) { this.port.postMessage({ t: this.t, data: this.buf.slice(0, this.n) }); this.n = 0; }
      return true;
    }
  });`;

  async function startCapture(player, raw) {
    const ctx = player.audioContext();
    // raw (headphones): no phone-call processing, the cleanest voice.
    // not raw (speakers): let the browser remove the band from the microphone.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: !raw, noiseSuppression: !raw, autoGainControl: !raw } });
    const src = ctx.createMediaStreamSource(stream), mute = ctx.createGain();
    mute.gain.value = 0; mute.connect(ctx.destination);
    const chunks = [];
    let t0 = null, level = 0, node;
    const take = (t, data) => {
      if (t0 == null) t0 = t;
      chunks.push(data);
      let peak = 0;
      for (let i = 0; i < data.length; i += 4) peak = Math.max(peak, Math.abs(data[i]));
      level = peak;
    };
    if (ctx.audioWorklet) {
      if (!ctx.sxCapture) ctx.sxCapture = ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })));
      await ctx.sxCapture;
      node = new AudioWorkletNode(ctx, 'sx-capture');
      node.port.onmessage = (e) => take(e.data.t, e.data.data);
    } else {
      node = ctx.createScriptProcessor(2048, 1, 1);
      node.onaudioprocess = (e) => take(ctx.currentTime - 2048 / ctx.sampleRate, new Float32Array(e.inputBuffer.getChannelData(0)));
    }
    src.connect(node); node.connect(mute);
    const track = stream.getAudioTracks()[0], settings = track && track.getSettings ? track.getSettings() : {};
    return {
      level: () => level,
      stop() {
        H.safe(() => { src.disconnect(); node.disconnect(); mute.disconnect(); });
        stream.getTracks().forEach((t) => t.stop());
        const data = new Float32Array(chunks.reduce((a, c) => a + c.length, 0));
        let o = 0;
        for (const c of chunks) { data.set(c, o); o += c.length; }
        // how long sound takes to leave the speakers plus how long the microphone takes to deliver it
        return { data, t0: t0 || 0, rate: ctx.sampleRate, latency: (ctx.outputLatency || 0) + (ctx.baseLatency || 0) + (settings.latency || 0) };
      },
    };
  }

  // Make a raw take sit nicely over the band. Returns how loud the raw take was.
  function polish(x) {
    const a = Math.exp(-2 * Math.PI * 85 / S.SR);
    let low = 0, peak = 0;
    for (let i = 0; i < x.length; i++) { low = a * low + (1 - a) * x[i]; x[i] -= low; peak = Math.max(peak, Math.abs(x[i])); } // rumble out
    if (peak < 0.005) return peak;
    // a gentle squeeze so quiet words are not lost and loud ones do not jump out
    const att = Math.exp(-1 / (0.005 * S.SR)), rel = Math.exp(-1 / (0.15 * S.SR)), thr = 0.25;
    let env = 0, top = 0;
    for (let i = 0; i < x.length; i++) {
      const v = Math.abs(x[i] /= peak);
      env = v > env ? att * env + (1 - att) * v : rel * env + (1 - rel) * v;
      if (env > thr) x[i] *= Math.pow(env / thr, -0.55);
      top = Math.max(top, Math.abs(x[i]));
    }
    const fin = Math.min(x.length, Math.round(0.01 * S.SR)), fout = Math.min(x.length, Math.round(0.08 * S.SR));
    for (let i = 0; i < x.length; i++) x[i] *= 0.9 / top;
    for (let i = 0; i < fin; i++) x[i] *= i / fin;
    for (let i = 0; i < fout; i++) x[x.length - 1 - i] *= i / fout;
    return peak;
  }

  const pref = (k, v) => v === undefined ? H.safe(() => localStorage.getItem('sunosux:' + k), null) : H.safe(() => localStorage.setItem('sunosux:' + k, v));

  Kit.components.sing = (el, app) => {
    const { store, player } = app;
    let rec = null;
    let headphones = pref('headphones') === '1';
    const count = h('div', { class: 'sx-sing-count' }), words = h('div', { class: 'sx-sing-words' });
    const meter = h('div', { class: 'sx-meter' }, h('i')), progress = h('div', { class: 'sx-meter sx-progress' }, h('i'));

    async function start() {
      const name = store.selectedPart, song = store.song, part = song.parts[name];
      if (!part || rec) return;
      let cap;
      try { cap = await startCapture(player, headphones); }
      catch (e) { return Kit.toast('🙈 The microphone is blocked in this window. Open this page in Chrome or Safari and allow the microphone.'); }
      const inst = H.instrumentsOf(song), backing = H.clone(song), COUNT = '(count-in)';
      // through speakers the older takes would leak back into the microphone, so they stay quiet while you sing
      if (!headphones) backing.parts[name].tracks = backing.parts[name].tracks.filter((t) => !(inst[t.instrument] || {}).vocal);
      backing.parts[COUNT] = { bars: 1, tracks: [{ instrument: 'tom', lane: 'X...x...x...x...' }] };
      backing.arrangement = [COUNT, name];
      let audio;
      try { audio = await Kit.busy(() => S.render(backing, { samples: store.samples })); } catch (e) { cap.stop(); return; }
      rec = { cap, name, lead: audio.timeline[1].start, dur: audio.timeline[1].duration, beat: 60 / song.bpm, lyrics: part.lyrics || '🎵 la la la 🎵' };
      count.textContent = '1'; words.textContent = rec.lyrics;
      Kit.fill(el, h('h2', {}, '🔴 Singing ' + (part.emoji || '') + ' ' + name), count, words, meter, progress,
        h('div', { class: 'sx-row' }, h('button', { class: 'sx-big on', onclick: () => player.stop() }, '⏹️ done')));
      player.playAudio(audio, 0);
      rec.tPart = player.startedAt + rec.lead;
      rec.timer = setTimeout(() => player.stop(), (rec.lead + rec.dur + 0.45) * 1000);
    }

    function finish() {
      const r = rec;
      rec = null;
      clearTimeout(r.timer);
      const out = r.cap.stop();
      // where the piece began inside the recording
      const i0 = Math.max(0, Math.round((r.tPart + out.latency - out.t0) * out.rate));
      if (out.data.length - i0 < out.rate) { draw(); return Kit.toast('That was too short to keep. Start singing after the count of four!'); }
      const data = S.resample(out.data.slice(i0, i0 + Math.round((r.dur + 0.5) * out.rate)), out.rate);
      if (polish(data) < 0.005) { draw(); return Kit.toast('🙉 I could not hear any singing. Is the right microphone picked?'); }
      const key = 'take-' + Date.now().toString(36);
      store.addSample(key, data);
      store.change((s) => {
        const p = s.parts[r.name];
        if (!p) return;
        s.instruments = s.instruments || {};
        const n = Object.values(s.instruments).filter((x) => x.vocal).length + 1;
        s.instruments[key] = { emoji: '🎙️', label: 'take ' + n, sample: key, pitched: false, vocal: true, gain: 1, offset: +(pref('nudge') || 0) };
        p.tracks.push({ instrument: key, lane: H.eventsToLane([{ step: 0, vel: 1, len: 1 }], H.partSteps(s, p), true) });
      });
      draw();
      Kit.toast('🎉 Your singing is in ' + r.name + '!');
      player.playPart(r.name);
    }

    player.onTick(() => {
      if (!rec) return;
      if (!player.playing) return finish();
      const t = player.time(), counting = t < rec.lead;
      count.textContent = counting ? String(Math.min(4, Math.floor(t / rec.beat) + 1)) : '🔴';
      meter.firstChild.style.width = Math.min(100, rec.cap.level() * 130) + '%';
      progress.firstChild.style.width = Math.max(0, Math.min(100, (t - rec.lead) / rec.dur * 100)) + '%';
    });

    function draw(what) {
      if (rec || what === 'jam' || what === 'lane' || what === 'lyrics') return;
      const song = store.song, name = store.selectedPart, part = song.parts[name];
      if (!part) return Kit.fill(el, h('h2', {}, '🎤 Sing a piece'));
      const inst = H.instrumentsOf(song);
      const takes = part.tracks.map((tr, ti) => ({ tr, ti, key: tr.instrument, recipe: inst[tr.instrument] })).filter((x) => x.recipe && x.recipe.vocal);
      const nudge = (key, d) => store.change((s) => {
        const v = +(((s.instruments[key].offset || 0) + d).toFixed(3));
        s.instruments[key].offset = v;
        pref('nudge', String(v)); // the next take starts with the same correction
      });
      Kit.fill(el, 
        h('h2', {}, '🎤 Sing a piece'),
        h('div', { class: 'sx-row' },
          h('button', { class: 'sx-big sx-rec', onclick: start }, '🎤 sing ' + (part.emoji || '') + ' ' + name),
          h('button', { class: 'sx-btn' + (headphones ? ' on' : ''), onclick: () => { headphones = !headphones; pref('headphones', headphones ? '1' : '0'); draw(); } }, headphones ? '🎧 headphones on' : '🎧 headphones off')),
        h('div', { class: 'sx-small' }, headphones
          ? 'Headphones on: the cleanest voice, and you hear your other takes while you sing.'
          : 'You get a count of four, then sing along. Wearing headphones? Turn 🎧 on for a cleaner voice.'),
        h('textarea', { class: 'sx-text', rows: 2, placeholder: 'the words for this piece…',
          onchange: (e) => store.change((s) => { s.parts[name].lyrics = e.target.value; }, 'lyrics') }, part.lyrics || ''),
        takes.map(({ tr, ti, key, recipe }) => {
          const ms = Math.round((recipe.offset || 0) * 1000), silent = tr.gain === 0;
          const setGain = (g) => store.change((s) => { s.parts[name].tracks[ti].gain = Math.max(0, +g.toFixed(2)); });
          return h('div', { class: 'sx-take' },
            h('b', {}, '🎙️ ' + (recipe.label || key)),
            h('button', { class: 'sx-btn', title: 'hear this take alone', onclick: () => player.trigger(recipe) }, '👂'),
            h('button', { class: 'sx-btn' + (silent ? ' on' : ''), title: silent ? 'bring it back' : 'silence it', onclick: () => setGain(silent ? 1 : 0) }, silent ? '🔇' : '🔈'),
            h('button', { class: 'sx-btn tiny', title: 'quieter', onclick: () => setGain((tr.gain ?? 1) - 0.2) }, '🔉'),
            h('button', { class: 'sx-btn tiny', title: 'louder', onclick: () => setGain((tr.gain ?? 1) + 0.2) }, '🔊'),
            h('button', { class: 'sx-btn tiny', title: 'it sounds late: move it earlier', onclick: () => nudge(key, -0.02) }, '◀ earlier'),
            h('span', { class: 'sx-small' }, (ms > 0 ? '+' : '') + ms + ' ms'),
            h('button', { class: 'sx-btn tiny', title: 'it sounds early: move it later', onclick: () => nudge(key, 0.02) }, 'later ▶'),
            h('button', { class: 'sx-btn tiny', title: 'throw this take away', onclick: () => { if (confirm('Throw away this take?')) store.change((s) => {
              s.parts[name].tracks.splice(ti, 1);
              if (!Object.values(s.parts).some((p) => p.tracks.some((t) => t.instrument === key))) delete s.instruments[key];
            }); } }, '🗑️'));
        }),
        takes.length ? h('div', { class: 'sx-row' },
          h('button', { class: 'sx-btn', onclick: () => player.playPart(name) }, '▶️ hear ' + name + ' with the singing'),
          h('button', { class: 'sx-btn', onclick: () => store.undo() }, '↩️ undo')) : null);
    }
    store.subscribe(draw); draw();
  };
})();
