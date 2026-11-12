// sunosux kit: the core every interface shares.
//
// An interface is an HTML page that lays out empty elements like
//   <div data-kit="stage"></div>  <div data-kit="pads"></div>
// loads the brick files it wants from bricks/, and calls Sunosux.Kit.boot().
// Every brick gets the same `app`: one store (the song, recordings, undo) and
// one player. A brick is one function:
//   Sunosux.Kit.components.myBrick = (el, app) => { ...build DOM in el... }
//
// Two homes for the song:
//   live   - `npm run dev` is running: every change is written to songs/*.json and
//            sounds/*.wav on disk, and edits to those files (by a person or by Claude)
//            flow straight back into the page.
//   static - opened from GitHub Pages or a file: changes stay in this browser.
(function (root) {
  'use strict';
  const S = root.Sunosux;
  const Kit = { components: {} };

  // ---------- little DOM helper ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') for (const [p, val] of Object.entries(v)) p.startsWith('--') ? el.style.setProperty(p, val) : (el.style[p] = val);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(3)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  }
  // Replace everything inside el. Arrays are flattened; null and false are skipped.
  const fill = (el, ...kids) => el.replaceChildren(...kids.flat(3).filter((k) => k != null && k !== false).map((k) => k.nodeType ? k : document.createTextNode(k)));
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const safe = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };

  // ---------- feedback ----------
  function busy(fn) {
    let el = document.querySelector('.sx-busy');
    if (!el) { el = h('div', { class: 'sx-busy' }, h('div', {}, '✨ making music… ✨')); document.body.append(el); }
    el.classList.add('on');
    return new Promise((resolve, reject) => setTimeout(() => {
      try { resolve(fn()); } catch (e) { toast('Oops: ' + e.message); reject(e); } finally { el.classList.remove('on'); }
    }, 30));
  }
  function toast(msg) {
    const el = h('div', { class: 'sx-toast' }, msg);
    document.body.append(el);
    setTimeout(() => el.remove(), 3000);
  }
  function download(blob, name) {
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
  }

  // ---------- song helpers ----------
  const EMOJI = ['🌟', '💖', '🦄', '🐯', '🗡️', '👑', '🌈', '🔥', '🌙', '⚡', '🐉', '🍓', '🎀', '🪄', '🐱', '🌸'];
  const COLORS = ['#ff4fa3', '#7b5cff', '#00b3a4', '#ff9f1c', '#ffd23f', '#c86bfa', '#3ec1ff', '#ff6b6b'];
  const stepsPerBar = (song) => (song.stepsPerBeat || 4) * 4;
  const partSteps = (song, part) => (part.bars || 1) * stepsPerBar(song);
  const instrumentsOf = (song) => Object.assign({}, root.SunosuxInstruments || {}, song.instruments || {});
  const isDrumRecipe = (r) => !!(r && (r.kind || (r.sample && !r.pitched)));
  const songScale = (song) => song.scale || ['A', 'C', 'D', 'E', 'G'];

  // Notes of the song's "always sounds good" scale between two notes, low to high.
  function scaleNotes(song, lo, hi) {
    const a = S.noteToMidi(lo), b = S.noteToMidi(hi), out = [];
    for (let o = 0; o <= 8; o++) for (const p of songScale(song)) {
      const n = p + o, m = safe(() => S.noteToMidi(n), -1);
      if (m >= a && m <= b) out.push(n);
    }
    return out.sort((x, y) => S.noteToMidi(x) - S.noteToMidi(y));
  }

  function laneEvents(lane, steps) {
    return safe(() => S.parseLane(lane || '').events, []).filter((e) => e.step < steps)
      .map((e) => Object.assign({}, e, { notes: e.notes ? e.notes.slice() : null }));
  }
  function eventsToLane(events, steps, drum) {
    const toks = new Array(steps).fill('.');
    const out = [];
    if (drum) {
      for (const e of events) toks[e.step] = e.vel >= 0.95 ? 'X' : e.vel < 0.6 ? 'o' : 'x';
      for (let i = 0; i < steps; i += 16) out.push(toks.slice(i, i + 16).join(''));
      return out.join('|');
    }
    const sorted = events.filter((e) => e.notes && e.notes.length).sort((a, b) => a.step - b.step);
    sorted.forEach((e, i) => {
      const next = sorted[i + 1] ? sorted[i + 1].step : steps;
      toks[e.step] = e.notes.join('+');
      for (let k = 1; k < e.len && e.step + k < next; k++) toks[e.step + k] = '-';
    });
    for (let i = 0; i < steps; i += 16) out.push(toks.slice(i, i + 16).join(' '));
    return out.join(' | ');
  }
  const emptyLane = (recipe, steps) => eventsToLane([], steps, isDrumRecipe(recipe));

  // Put one hit into a part (used by the pads and by anything that "plays into" the song).
  function addHit(song, partName, instrument, step, note) {
    const part = song.parts[partName], recipe = instrumentsOf(song)[instrument];
    if (!part || !recipe) return;
    const steps = partSteps(song, part), drum = isDrumRecipe(recipe);
    let ti = part.tracks.findIndex((t) => t.instrument === instrument);
    if (ti < 0) { part.tracks.push({ instrument, lane: emptyLane(recipe, steps) }); ti = part.tracks.length - 1; }
    const evs = laneEvents(part.tracks[ti].lane, steps).filter((e) => e.step !== step);
    if (!drum) evs.forEach((e) => { if (e.step < step && e.step + e.len > step) e.len = step - e.step; });
    evs.push(drum ? { step, vel: 0.8, len: 1 } : { step, notes: [note || 'A4'], len: 2, vel: 0.85 });
    part.tracks[ti].lane = eventsToLane(evs, steps, drum);
  }

  function setBars(song, part, bars) {
    const spb = stepsPerBar(song), old = (part.bars || 1) * spb, steps = bars * spb, inst = instrumentsOf(song);
    part.tracks.forEach((tr) => {
      const events = laneEvents(tr.lane, Math.max(old, steps));
      // growing repeats what is there; shrinking cuts
      const grown = steps > old ? events.concat(events.filter((e) => e.step + old < steps).map((e) => Object.assign({}, e, { step: e.step + old }))) : events;
      tr.lane = eventsToLane(grown.filter((e) => e.step < steps), steps, isDrumRecipe(inst[tr.instrument]));
    });
    part.bars = bars;
  }

  function applyTheme(song) {
    const t = song.theme || {}, st = document.documentElement.style;
    ['bg', 'bg2', 'panel', 'ink', 'accent', 'accent2', 'gold'].forEach((k) => t[k] ? st.setProperty('--sx-' + k, t[k]) : st.removeProperty('--sx-' + k));
  }

  // ---------- recordings ----------
  const monoWav = (data) => S.encodeWav({ sampleRate: S.SR, left: data });
  // In static mode recordings live in this browser's IndexedDB (a sung take is far too big for localStorage).
  function idb(mode, fn) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('sunosux', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('samples');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction('samples', mode), req = fn(tx.objectStore('samples'));
        tx.oncomplete = () => resolve(req && req.result);
        tx.onerror = () => reject(tx.error);
      };
    });
  }

  // ---------- where the song lives ----------
  const API = { 'x-sunosux': '1' };
  function serverIO(songPath) {
    const sent = new Set();
    let timer = null;
    return {
      live: true, path: songPath, sent,
      load: () => null,
      saveSong(song) {
        const text = JSON.stringify(song, null, 2) + '\n';
        sent.add(text);
        if (sent.size > 40) sent.delete(sent.values().next().value);
        clearTimeout(timer);
        timer = setTimeout(() => fetch('/api/file?path=' + encodeURIComponent(songPath), { method: 'PUT', headers: API, body: text })
          .then((r) => { if (!r.ok) toast('could not save the song (' + r.status + ')'); }).catch(() => toast('could not save: is the dev server still running?')), 200);
      },
      saveSample(name, data) { sent.add('sample:' + name); return fetch('/api/file?path=sounds/' + name + '.wav', { method: 'PUT', headers: API, body: monoWav(data) }); },
      loadSample: () => null,
      clear() {},
    };
  }
  function localIO(id) {
    const key = 'sunosux:' + id;
    return {
      live: false, path: null, sent: new Set(),
      load: () => safe(() => JSON.parse(localStorage.getItem(key)), null),
      saveSong: (song) => safe(() => localStorage.setItem(key, JSON.stringify(song))),
      saveSample: (name, data) => idb('readwrite', (st) => st.put(data, key + ':' + name)).catch(() => toast('this browser could not keep that recording')),
      loadSample: (name) => idb('readonly', (st) => st.get(key + ':' + name)).catch(() => null),
      clear: () => { safe(() => localStorage.removeItem(key)); return idb('readwrite', (st) => st.delete(IDBKeyRange.bound(key + ':', key + ':\uffff'))).catch(() => null); },
    };
  }

  // ---------- store ----------
  function createStore(song, samples, io) {
    const listeners = new Set(), history = [];
    const fixSelection = () => { if (!store.song.parts[store.selectedPart]) store.selectedPart = Object.keys(store.song.parts)[0] || null; };
    const store = {
      song, samples, version: 0,
      selectedPart: (song.arrangement || []).find((n) => song.parts[n]) || Object.keys(song.parts)[0] || null,
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      emit(what) { store.version++; applyTheme(store.song); listeners.forEach((fn) => safe(() => fn(what || 'song'))); },
      // every change goes through here, so undo always works and the song is always saved
      change(fn, what) {
        history.push(JSON.stringify(store.song));
        if (history.length > 200) history.shift();
        fn(store.song);
        fixSelection();
        io.saveSong(store.song);
        store.emit(what);
      },
      undo() {
        if (!history.length) return toast('nothing to undo');
        store.song = JSON.parse(history.pop());
        fixSelection();
        io.saveSong(store.song);
        store.emit('song');
      },
      // the song changed somewhere else (Claude edited the file): take it, keep undo
      replace(next) {
        history.push(JSON.stringify(store.song));
        store.song = next;
        fixSelection();
        store.emit('song');
      },
      select(name) { store.selectedPart = name; store.emit('select'); },
      addSample(name, data) { store.samples[name] = data; io.saveSample(name, data); },
    };
    return store;
  }

  // ---------- player ----------
  function createPlayer(store) {
    let ctx = null, source = null, cached = null, cachedVersion = -1, startAt = 0, offset = 0, current = null, hits = [], hitIdx = 0, lastPos = 0, swapTimer = null;
    const ticks = new Set(), hitFns = new Set(), shots = new Map();
    const stopSource = () => { if (source) { const s = source; source = null; safe(() => s.stop()); } };
    const player = {
      playing: false, looping: null, timeline: [],
      onTick(fn) { ticks.add(fn); },   // fn(indexInArrangement, seconds) on every frame while playing
      onHit(fn) { hitFns.add(fn); },    // fn({ t, inst, drum, kind, midi, len, part }) as each note sounds
      audioContext() {
        if (!ctx) ctx = new (root.AudioContext || root.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
      },
      toBuffer(audio) {
        const c = player.audioContext(), buf = c.createBuffer(2, audio.left.length, audio.sampleRate);
        buf.copyToChannel(audio.left, 0);
        buf.copyToChannel(audio.right, 1);
        return buf;
      },
      renderSong() {
        if (!cached || cachedVersion !== store.version) { cached = S.render(store.song, { samples: store.samples }); cachedVersion = store.version; }
        return cached;
      },
      renderPart(name, loop) { return S.render(Object.assign({}, store.song, { arrangement: [name] }), { samples: store.samples, loop }); },
      playAudio(audio, fromSec, opts) {
        opts = opts || {};
        stopSource();
        const c = player.audioContext(), me = c.createBufferSource();
        me.buffer = player.toBuffer(audio);
        me.loop = !!opts.loop;
        me.connect(c.destination);
        offset = fromSec || 0; startAt = c.currentTime;
        player.startedAt = startAt; // context time the audio began, for lining recordings up
        me.start(0, offset);
        source = me; current = audio;
        player.playing = true;
        player.looping = opts.loop ? opts.name : null;
        player.timeline = opts.timeline || [];
        hits = audio.hits || [];
        hitIdx = hits.findIndex((x) => x.t >= offset); if (hitIdx < 0) hitIdx = hits.length;
        lastPos = offset;
        me.onended = () => { if (source === me) { source = null; player.playing = false; player.looping = null; frame(); } };
        requestAnimationFrame(loop);
      },
      async play(fromSec) {
        const audio = await busy(() => player.renderSong());
        player.playAudio(audio, fromSec, { timeline: audio.timeline });
      },
      async playFrom(index) {
        const audio = await busy(() => player.renderSong());
        player.playAudio(audio, audio.timeline[index] ? audio.timeline[index].start : 0, { timeline: audio.timeline });
      },
      async playPart(name) { player.playAudio(await busy(() => player.renderPart(name)), 0); },
      // play one part round and round; it re-renders by itself whenever the song changes
      async loopPart(name) { player.playAudio(await busy(() => player.renderPart(name, true)), 0, { loop: true, name }); },
      // one sound right now, on top of whatever is playing (pads, previews)
      trigger(recipe, note) {
        if (!recipe) return;
        try {
          const key = JSON.stringify(recipe) + '|' + note;
          if (!shots.has(key)) { if (shots.size > 300) shots.clear(); shots.set(key, player.toBuffer(S.renderSample(recipe, note || 'C5', 0.5, store.samples, store.song.tuning))); }
          const c = player.audioContext(), s = c.createBufferSource();
          s.buffer = shots.get(key); s.connect(c.destination); s.start();
        } catch (e) { toast(e.message); }
      },
      playData(data) { const c = player.audioContext(), s = c.createBufferSource(); s.buffer = player.toBuffer({ sampleRate: S.SR, left: data, right: data }); s.connect(c.destination); s.start(); },
      stop() { stopSource(); player.playing = false; player.looping = null; frame(); },
      time() {
        if (!player.playing || !ctx) return 0;
        const t = ctx.currentTime - startAt + offset;
        return player.looping ? t % current.duration : t;
      },
      current() {
        const t = player.time();
        return player.playing ? player.timeline.findIndex((it) => t >= it.start && t < it.start + it.duration) : -1;
      },
      async wav() { return new Blob([S.encodeWav(await busy(() => player.renderSong()))], { type: 'audio/wav' }); },
    };
    function frame() { const i = player.current(), t = player.time(); ticks.forEach((fn) => safe(() => fn(i, t))); }
    function loop() {
      if (!player.playing) return;
      const t = player.time();
      if (t < lastPos) hitIdx = 0; // the loop went round
      while (hitIdx < hits.length && hits[hitIdx].t <= t) { const hit = hits[hitIdx++]; hitFns.forEach((fn) => safe(() => fn(hit))); }
      lastPos = t;
      frame();
      requestAnimationFrame(loop);
    }
    store.subscribe((what) => {
      if (what === 'select') {
        // looping follows whichever piece is selected
        if (player.looping && store.selectedPart && store.selectedPart !== player.looping) player.loopPart(store.selectedPart);
        return;
      }
      shots.clear();
      if (!player.looping) return;
      clearTimeout(swapTimer);
      swapTimer = setTimeout(() => {
        const name = player.looping;
        if (!name) return;
        if (!store.song.parts[name]) return player.stop();
        const audio = safe(() => player.renderPart(name, true), null);
        if (audio && player.looping === name) player.playAudio(audio, player.time() % audio.duration, { loop: true, name });
      }, 350);
    });
    return player;
  }

  // ---------- microphone ----------
  // A tap-to-start, tap-to-stop record button. onData gets mono 44.1 kHz audio,
  // trimmed of silence and made nice and loud.
  // opts: { raw: true } turns off the browser's phone-call processing (best for singing with no music playing),
  //       onStart / onStop are called as recording begins and ends.
  function micButton(app, label, onData, maxSeconds, opts) {
    opts = opts || {};
    let rec = null, timer = null;
    const btn = h('button', { class: 'sx-big sx-rec' }, label);
    const finish = async (blob) => {
      try {
        const decoded = await app.player.audioContext().decodeAudioData(await blob.arrayBuffer());
        let data = S.resample(decoded.getChannelData(0), decoded.sampleRate);
        let a = 0, b = data.length - 1;
        while (a < b && Math.abs(data[a]) < 0.02) a++;
        while (b > a && Math.abs(data[b]) < 0.02) b--;
        data = data.slice(Math.max(0, a - 400), Math.min(data.length, b + 3000));
        let peak = 0;
        for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
        if (peak < 0.01 || data.length < 2000) return toast('🙉 I could not hear anything. Try again, a bit louder!');
        for (let i = 0; i < data.length; i++) data[i] *= 0.9 / peak;
        onData(data);
      } catch (e) { toast('🙈 that sound did not work: ' + e.message); }
    };
    const stop = () => { clearTimeout(timer); if (rec && rec.state === 'recording') { rec.stop(); if (opts.onStop) opts.onStop(); } btn.classList.remove('on'); btn.textContent = label; };
    btn.addEventListener('click', async () => {
      if (rec && rec.state === 'recording') return stop();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: opts.raw ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : true });
        const chunks = [];
        rec = new MediaRecorder(stream);
        rec.ondataavailable = (ev) => chunks.push(ev.data);
        rec.onstop = () => { stream.getTracks().forEach((t) => t.stop()); finish(new Blob(chunks, { type: rec.mimeType })); };
        rec.start();
        if (opts.onStart) opts.onStart();
        btn.classList.add('on'); btn.textContent = '🔴 listening… tap to stop';
        timer = setTimeout(stop, (maxSeconds || 8) * 1000);
      } catch (e) { toast('🙈 The microphone is blocked in this window. Open this page in Chrome or Safari and allow the microphone.'); }
    });
    btn.useBlob = finish;
    return btn;
  }

  // ---------- boot ----------
  async function loadSamples(song, io, soundsUrl, into) {
    const samples = into || {};
    for (const r of Object.values(song.instruments || {})) {
      if (!r.sample || samples[r.sample]) continue;
      const stored = await io.loadSample(r.sample);
      if (stored) { samples[r.sample] = stored; continue; }
      try {
        const res = await fetch(soundsUrl + r.sample + '.wav', { cache: 'no-store' });
        if (!res.ok) throw new Error(res.status);
        samples[r.sample] = S.decodeWav(await res.arrayBuffer());
      } catch (e) { console.warn('missing recording', r.sample); }
    }
    return samples;
  }

  Kit.boot = async function boot(opts) {
    opts = opts || {};
    const el = document.querySelector('#song');
    let src = el && el.dataset.src;
    const wanted = new URLSearchParams(location.search).get('song');
    if (wanted && src) src = src.replace(/[^/]+\.json$/, wanted.replace(/[^\w-]/g, '') + '.json');
    const soundsUrl = src ? new URL('../sounds/', new URL(src, location.href)).href : 'sounds/';
    const live = !opts.song && !!src && await fetch('/api/ping').then((r) => r.ok && r.headers.get('x-sunosux') === '1').catch(() => false);
    let original = opts.song || null;
    if (!original) original = el && el.textContent.trim() ? JSON.parse(el.textContent) : await fetch(src, { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).catch(() => null);
    const io = live ? serverIO(new URL(src, location.href).pathname.slice(1)) : localIO(src || (original && original.title) || 'song');
    const saved = io.load();
    if (!original && !(saved && saved.parts)) { // a song made in another browser, or a mistyped name
      document.body.append(h('main', {}, h('h1', {}, '🙈 I could not find that song'), h('a', { href: '../../' }, '🏠 all songs')));
      throw new Error('no song at ' + src);
    }
    const song = saved && saved.parts ? saved : clone(original);
    if (!original) original = clone(song);
    const samples = await loadSamples(song, io, soundsUrl);
    const store = createStore(song, samples, io);
    const player = createPlayer(store);
    const app = { store, player, original, io, live, Kit, S, events: null };
    applyTheme(song);
    document.body.classList.toggle('sx-live', !!live);

    if (live) {
      // hot reload: the song file morphs in place, code changes reload the page
      const es = app.events = new EventSource('/api/events');
      es.addEventListener('change', async (e) => {
        const { path } = JSON.parse(e.data);
        if (path === io.path) {
          const text = await (await fetch('/' + path, { cache: 'no-store' })).text();
          if (io.sent.has(text)) return; // our own save coming back
          const next = safe(() => JSON.parse(text), null);
          if (!next || !next.parts) return;
          await loadSamples(next, io, soundsUrl, store.samples);
          store.replace(next);
          toast('✨ the song just changed by magic ✨');
        } else if (/^sounds\/[\w-]+\.wav$/.test(path)) {
          const name = path.slice(7, -4);
          if (io.sent.delete('sample:' + name)) return; // our own recording coming back
          delete store.samples[name];
          await loadSamples(store.song, io, soundsUrl, store.samples);
          store.emit('song');
        } else if (/^(src|bricks|interfaces)\//.test(path)) location.reload();
      });
    }

    document.querySelectorAll('[data-kit]').forEach((node) => {
      const brick = Kit.components[node.dataset.kit];
      if (!brick) { node.textContent = '🧱 no brick called "' + node.dataset.kit + '" (is its file loaded?)'; return; }
      node.classList.add('sx-brick', 'sxb-' + node.dataset.kit);
      try { brick(node, app); } catch (e) { node.textContent = '🧱 ' + node.dataset.kit + ' broke: ' + e.message; console.error(e); }
    });
    // links between pages keep you on the same song
    if (wanted) document.querySelectorAll('nav.sx-nav a[data-keep-song]').forEach((a) => { a.href = a.getAttribute('href') + '?song=' + encodeURIComponent(wanted); });
    root.app = app;
    return app;
  };

  // Save a brand-new song (and its recordings) next to the others, without touching the one that is open.
  Kit.saveNewSong = async (app, id, song, samples) => {
    if (app.live) {
      const put = async (path, body) => { const r = await fetch('/api/file?path=' + encodeURIComponent(path), { method: 'PUT', headers: API, body }); if (!r.ok) throw new Error('could not save ' + path + ': ' + await r.text()); };
      for (const [name, data] of Object.entries(samples)) await put('sounds/' + name + '.wav', monoWav(data));
      await put('songs/' + id + '.json', JSON.stringify(song, null, 2) + '\n');
    } else {
      const io = localIO('../../songs/' + id + '.json');
      io.saveSong(song);
      for (const [name, data] of Object.entries(samples)) await io.saveSample(name, data);
    }
  };
  Kit.songExists = (app, id) => app.live
    ? fetch('/songs/' + id + '.json', { cache: 'no-store' }).then((r) => r.ok).catch(() => false)
    : Promise.resolve(!!safe(() => localStorage.getItem('sunosux:../../songs/' + id + '.json'), null));

  Object.assign(Kit, { h, fill, toast, busy, download, micButton, monoWav, EMOJI, COLORS, API,
    helpers: { clone, safe, stepsPerBar, partSteps, instrumentsOf, isDrumRecipe, scaleNotes, laneEvents, eventsToLane, emptyLane, addHit, setBars } });
  root.Sunosux.Kit = Kit;
})(typeof globalThis !== 'undefined' ? globalThis : this);
