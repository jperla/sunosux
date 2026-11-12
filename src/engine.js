// sunosux engine: turns a song (plain data) into audio samples.
// Pure JavaScript DSP with no Web Audio and no dependencies, so the same code
// plays in the browser and renders WAV files in Node.
(function (root) {
  'use strict';

  const SR = 44100;
  const TAU = Math.PI * 2;

  // ---------- notes ----------
  const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function noteToMidi(name) {
    const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(String(name).trim());
    if (!m) throw new Error('bad note: ' + name);
    let n = NOTE_INDEX[m[1].toUpperCase()];
    if (m[2] === '#') n += 1;
    if (m[2] === 'b') n -= 1;
    return n + (parseInt(m[3], 10) + 1) * 12;
  }
  const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const noteToFreq = (n) => midiToFreq(noteToMidi(n));

  // ---------- tiny deterministic random (same song = same sound) ----------
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return (s / 4294967296) * 2 - 1;
    };
  }

  // ---------- building blocks ----------
  function osc(shape, phase) {
    const p = phase - Math.floor(phase);
    switch (shape) {
      case 'sine': return Math.sin(TAU * p);
      case 'square': return p < 0.5 ? 1 : -1;
      case 'saw': return 2 * p - 1;
      case 'triangle': return 1 - 4 * Math.abs(p - 0.5);
      default: return Math.sin(TAU * p);
    }
  }

  // ADSR envelope; holdTime is how long the key is held, in seconds.
  function adsr(t, holdTime, env) {
    const a = env.a ?? 0.005, d = env.d ?? 0.1, s = env.s ?? 0.7, r = env.r ?? 0.1;
    let level;
    if (t < a) level = t / a;
    else if (t < a + d) level = 1 - (1 - s) * ((t - a) / d);
    else level = s;
    if (t > holdTime) {
      const held = holdTime < a ? holdTime / a : holdTime < a + d ? 1 - (1 - s) * ((holdTime - a) / d) : s;
      level = held * Math.max(0, 1 - (t - holdTime) / r);
    }
    return level;
  }

  // Resonant low-pass filter (state-variable), cutoff in Hz.
  function makeFilter() {
    let low = 0, band = 0;
    return (x, cutoff, q) => {
      const f = 2 * Math.sin(Math.PI * Math.min(cutoff, SR / 6) / SR);
      const damp = 1 / Math.max(0.5, q || 0.7);
      low += f * band;
      const high = x - low - damp * band;
      band += f * high;
      return low;
    };
  }

  // ---------- voices ----------
  // A "recipe" is plain data describing a sound, so making new instruments is
  // just writing a new object (see src/instruments.js and the Sound Lab).
  //
  //   wave:    'sine' | 'square' | 'saw' | 'triangle'
  //   voices:  number of detuned copies (chorus/supersaw shimmer)
  //   stack:   instead of voices: exact pitches in cents above the note, e.g. [0, 1200] for a bell
  //   detune:  cents between copies
  //   octave:  shift the note up (+1) or down (-1)
  //   env:     { a, d, s, r } seconds and sustain level
  //   filter:  { cutoff, q, envAmount } low-pass; envAmount opens it at note start
  //   vibrato: { rate, depth } Hz and semitones
  //   noise:   0..1 amount of hiss mixed in
  //   sub:     0..1 sine an octave down (fat bass)
  //   gain:    volume
  //   drive:   grit (soft clipping), 1 = a little, 4 = a lot
  function renderTone(recipe, freq, holdTime, velocity, seed) {
    const env = recipe.env || {};
    const len = Math.ceil((holdTime + (env.r ?? 0.1)) * SR) + 1;
    const out = new Float32Array(len);
    // stack: [0, 1200] plays every note as several pitches at once, each so many cents above the note
    // (0 and 1200 = the note and its octave: a bell). Without it, `voices` copies spread `detune` cents around the note.
    const stack = recipe.stack || null;
    const voices = stack ? stack.length : Math.max(1, recipe.voices || 1);
    const detune = recipe.detune || 0;
    const f0 = freq * Math.pow(2, recipe.octave || 0);
    const vib = recipe.vibrato || { rate: 0, depth: 0 };
    const filt = recipe.filter;
    const lp = makeFilter();
    const rand = rng(seed);
    const phases = [];
    for (let v = 0; v < voices; v++) phases.push((rand() + 1) / 2);
    let subPhase = 0;
    const gain = (recipe.gain ?? 0.3) * velocity / Math.sqrt(voices);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const vibAmt = vib.depth ? Math.sin(TAU * vib.rate * t) * vib.depth * Math.min(1, t / 0.25) : 0;
      let x = 0;
      for (let v = 0; v < voices; v++) {
        const cents = stack ? stack[v] : voices === 1 ? 0 : (v / (voices - 1) - 0.5) * detune;
        const f = f0 * Math.pow(2, (cents / 100 + vibAmt) / 12);
        phases[v] += f / SR;
        x += osc(recipe.wave, phases[v]);
      }
      if (recipe.sub) {
        subPhase += f0 / 2 / SR;
        x += recipe.sub * Math.sin(TAU * subPhase) * Math.sqrt(voices);
      }
      if (recipe.noise) x += recipe.noise * rand() * Math.sqrt(voices);
      const e = adsr(t, holdTime, env);
      if (filt) {
        const open = 1 + (filt.envAmount || 0) * Math.exp(-t * 12);
        x = lp(x, filt.cutoff * open, filt.q);
      }
      // drive: push the sound into a soft clip for grit (1 = a little, 4 = a lot)
      out[i] = recipe.drive ? Math.tanh(x * e / Math.sqrt(voices) * recipe.drive) * (recipe.gain ?? 0.3) * velocity : x * e * gain;
    }
    return out;
  }

  // Drum recipes: kind is 'kick' | 'snare' | 'clap' | 'hat' | 'tom' | 'zap' | 'click' | 'rim' | 'shaker' | 'glitch'.
  // Any drum can take drive (grit) and crush (hold every Nth sample, for a crunchy low-fi sound).
  function renderDrum(recipe, velocity, seed) {
    const rand = rng(seed);
    const kind = recipe.kind;
    const decay = recipe.decay ?? 0.3;
    const len = Math.ceil(decay * SR * 1.5);
    const out = new Float32Array(len);
    const g = (recipe.gain ?? 0.8) * velocity;
    let phase = 0;
    const lp = makeFilter();
    let prev = 0, held = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      let x = 0;
      if (kind === 'kick' || kind === 'tom') {
        const base = recipe.pitch ?? (kind === 'kick' ? 48 : 140);
        const f = base + base * 3 * Math.exp(-t * 30);
        phase += f / SR;
        x = Math.sin(TAU * phase) * Math.exp(-t / (decay * 0.4));
        if (kind === 'kick') x += (t < 0.004 ? rand() * 0.6 : 0);
        x = Math.tanh(x * 1.6);
      } else if (kind === 'snare') {
        phase += (recipe.pitch ?? 190) / SR;
        const tone = Math.sin(TAU * phase) * Math.exp(-t * 25) * 0.6;
        const n = rand() * Math.exp(-t / (decay * 0.35));
        x = tone + lp(n, 7000, 0.7) * 0.9;
      } else if (kind === 'clap') {
        // a few fast bursts, then a tail
        const burst = (t < 0.03) ? (Math.floor(t / 0.01) % 2 === 0 ? 1 : 0.3) : Math.exp(-(t - 0.03) / (decay * 0.3));
        const n = rand();
        const hp = n - prev; prev = n;
        x = lp(hp, 2500, 2.5) * burst * 1.8;
      } else if (kind === 'hat') {
        const n = rand();
        const hp = n - prev; prev = n;
        x = hp * Math.exp(-t / (decay * 0.25)) * 0.6;
      } else if (kind === 'zap') {
        const f = 2000 * Math.exp(-t * 18) + 100;
        phase += f / SR;
        x = osc('square', phase) * Math.exp(-t / (decay * 0.4)) * 0.4;
      } else if (kind === 'click') { // a tiny tick, like a twig snapping
        const n = rand();
        const hp = n - prev; prev = n;
        x = hp * Math.exp(-t / 0.004) * 0.9;
      } else if (kind === 'rim') { // a woody knock
        phase += (recipe.pitch ?? 820) / SR;
        x = (Math.sin(TAU * phase) + 0.5 * Math.sin(TAU * phase * 1.51)) * Math.exp(-t / 0.018) * 0.7;
      } else if (kind === 'shaker') { // a soft sandy swish
        const n = rand();
        const hp = n - prev; prev = n;
        x = hp * Math.min(1, t / 0.012) * Math.exp(-t / (decay * 0.3)) * 0.5;
      } else if (kind === 'glitch') { // a little digital hiccup
        phase += (recipe.pitch ?? 1400) * (1 + 0.5 * Math.sin(t * 900)) / SR;
        x = osc('square', phase) * (Math.floor(t * 180) % 2 ? 0.2 : 1) * Math.exp(-t / (decay * 0.25)) * 0.35;
      }
      if (recipe.drive) x = Math.tanh(x * recipe.drive) / Math.tanh(recipe.drive);
      if (recipe.crush) { if (i % recipe.crush === 0) held = x; x = held; }
      out[i] = x * g;
    }
    return out;
  }

  // ---------- recordings / samples ----------
  // A sample instrument recipe looks like:
  //   { sample: 'giggle', root: 'C4', pitched: true, gain: 0.8, env: { a, d, s, r }, offset: 0 }
  //   add rootHz for a recording that is between notes, and grain: { from, to, size } to hold it as a pad
  // The audio itself lives in options.samples[name] = Float32Array at 44.1 kHz
  // (Node: tools load sounds/*.wav; browser: the recorder or file upload adds them).
  // pitched: false -> plays as-is like a drum hit. pitched: true -> plays at the note.
  function renderSampleVoice(recipe, data, freq, holdTime, velocity) {
    // rootHz: the exact pitch of the recording, when it is not right on a note (a sung note never is)
    const ratio = recipe.pitched ? freq / (recipe.rootHz || noteToFreq(recipe.root || 'C4')) : 1;
    const env = recipe.env || { a: 0.002, d: 0, s: 1, r: 0.05 };
    if (recipe.grain) {
      // grain: { from, to, size } freezes a stretch of the recording into a sound that can be held
      // for as long as you like: many short overlapping slices taken from between from and to (seconds).
      const gr = recipe.grain, size = Math.round((gr.size || 0.12) * SR), hop = Math.max(1, Math.round(size / 4));
      const from = Math.round((gr.from || 0) * SR), to = Math.min(data.length - 2, Math.round((gr.to ?? data.length / SR) * SR));
      const span = Math.max(1, to - from - Math.ceil(size * ratio));
      const total = Math.ceil((holdTime + (env.r ?? 0.05)) * SR), sum = new Float32Array(total), rand = rng(Math.round(freq * 100) + 17);
      for (let start = -size; start < total; start += hop) {
        const src = from + Math.floor((rand() + 1) / 2 * span);
        for (let k = 0; k < size; k++) {
          const o = start + k;
          if (o < 0 || o >= total) continue;
          const pos = src + k * ratio, j = Math.floor(pos), f = pos - j;
          sum[o] += ((data[j] || 0) * (1 - f) + (data[j + 1] || 0) * f) * (0.5 - 0.5 * Math.cos(TAU * k / size));
        }
      }
      const gg = (recipe.gain ?? 0.8) * velocity * 0.5; // four overlapping slices add up to 2
      for (let i = 0; i < total; i++) sum[i] *= adsr(i / SR, holdTime, env) * gg;
      return sum;
    }
    const playTime = recipe.pitched || recipe.cut ? holdTime : data.length / SR / ratio;
    const len = Math.min(Math.ceil((playTime + (env.r ?? 0.05)) * SR), Math.floor(data.length / ratio));
    const out = new Float32Array(Math.max(1, len));
    const g = (recipe.gain ?? 0.8) * velocity;
    for (let i = 0; i < len; i++) {
      const pos = i * ratio, j = Math.floor(pos), f = pos - j;
      const x = (data[j] || 0) * (1 - f) + (data[j + 1] || 0) * f;
      out[i] = x * adsr(i / SR, playTime, env) * g;
    }
    return out;
  }

  // Decode a PCM/float WAV (any rate, mono or stereo) into mono Float32 at 44.1 kHz.
  function decodeWav(arrayBuffer) {
    const dv = new DataView(arrayBuffer);
    const tag = (o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
    let o = 12, fmt = null, data = null;
    while (o + 8 <= dv.byteLength) {
      const id = tag(o), size = dv.getUint32(o + 4, true);
      if (id === 'fmt ') fmt = { format: dv.getUint16(o + 8, true), ch: dv.getUint16(o + 10, true), rate: dv.getUint32(o + 12, true), bits: dv.getUint16(o + 22, true) };
      if (id === 'data') data = { start: o + 8, size: Math.min(size, dv.byteLength - o - 8) };
      o += 8 + size + (size & 1);
    }
    if (!fmt || !data) throw new Error('WAV missing fmt or data');
    const bps = fmt.bits / 8, frames = Math.floor(data.size / (bps * fmt.ch));
    const mono = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (let c = 0; c < fmt.ch; c++) {
        const p = data.start + (i * fmt.ch + c) * bps;
        let v;
        if (fmt.format === 3 && bps === 4) v = dv.getFloat32(p, true);
        else if (bps === 2) v = dv.getInt16(p, true) / 32768;
        else if (bps === 3) v = ((dv.getUint8(p) | dv.getUint8(p + 1) << 8 | dv.getInt8(p + 2) << 16)) / 8388608;
        else if (bps === 4) v = dv.getInt32(p, true) / 2147483648;
        else v = (dv.getUint8(p) - 128) / 128;
        sum += v;
      }
      mono[i] = sum / fmt.ch;
    }
    return resample(mono, fmt.rate);
  }

  function resample(data, rate) {
    if (rate === SR) return data;
    const ratio = rate / SR, out = new Float32Array(Math.floor(data.length / ratio));
    for (let i = 0; i < out.length; i++) {
      const pos = i * ratio, j = Math.floor(pos), f = pos - j;
      out[i] = (data[j] || 0) * (1 - f) + (data[j + 1] || 0) * f;
    }
    return out;
  }

  // ---------- patterns ----------
  // Drum lane:   "x...x...x...x..."   x = hit, X = loud hit, o = soft hit, . = rest
  // Melody lane: "A4 . C5 - E5 - - ."  note = play, - = keep holding, . = rest
  //              Chords use +, e.g. "A3+C4+E4 - - -"
  function parseLane(text) {
    // "x...x... *4" repeats the lane 4 times
    let s = String(text).trim();
    const rep = /\s\*(\d+)$/.exec(s);
    if (rep) s = Array(parseInt(rep[1], 10)).fill(s.slice(0, rep.index)).join(' ');
    if (/^[xXo.|\s]+$/.test(s) && !/\s[A-G]/.test(s)) {
      const hits = [];
      let step = 0;
      for (const ch of s.replace(/[\s|]/g, '')) {
        if (ch === 'x') hits.push({ step, vel: 0.8, len: 1, notes: null });
        else if (ch === 'X') hits.push({ step, vel: 1.0, len: 1, notes: null });
        else if (ch === 'o') hits.push({ step, vel: 0.45, len: 1, notes: null });
        step++;
      }
      return { steps: step, events: hits };
    }
    const tokens = s.split(/[\s|]+/).filter(Boolean);
    const events = [];
    let current = null;
    tokens.forEach((tok, step) => {
      if (tok === '-') { if (current) current.len++; return; }
      current = null;
      if (tok === '.') return;
      const notes = tok.split('+');
      current = { step, notes, len: 1, vel: 0.85 };
      events.push(current);
    });
    return { steps: tokens.length, events };
  }

  // ---------- mixing ----------
  function mixInto(bufL, bufR, sound, start, pan, gain) {
    const l = gain * Math.cos((pan + 1) * Math.PI / 4);
    const r = gain * Math.sin((pan + 1) * Math.PI / 4);
    const end = Math.min(sound.length, bufL.length - start);
    for (let i = 0; i < end; i++) {
      bufL[start + i] += sound[i] * l;
      bufR[start + i] += sound[i] * r;
    }
  }

  // Small stereo reverb: a few comb filters per side.
  function reverb(inL, inR, amount) {
    if (!amount) return;
    const combs = [1557, 1617, 1491, 1422].map((d) => d);
    const fb = 0.78;
    const run = (input, offset) => {
      const out = new Float32Array(input.length);
      for (const d0 of combs) {
        const d = d0 + offset;
        const line = new Float32Array(d);
        let idx = 0, lpState = 0;
        for (let i = 0; i < input.length; i++) {
          const y = line[idx];
          lpState = y * 0.6 + lpState * 0.4;
          line[idx] = input[i] + lpState * fb;
          out[i] += y / combs.length;
          idx = (idx + 1) % d;
        }
      }
      return out;
    };
    const wl = run(inL, 0), wr = run(inR, 23);
    for (let i = 0; i < inL.length; i++) {
      inL[i] += wl[i] * amount;
      inR[i] += wr[i] * amount;
    }
  }

  // ---------- the song ----------
  // song = {
  //   title, bpm, stepsPerBeat (default 4),
  //   instruments: { name: recipe },   // optional, merged over the built-ins
  //   parts: { partName: { emoji, color, bars, lyrics, tracks: [{ instrument, lane, gain, pan }] } },
  //   arrangement: ['intro', 'verse', 'chorus', ...]
  // }
  function partSteps(part, stepsPerBar) {
    let steps = (part.bars || 1) * stepsPerBar;
    for (const tr of part.tracks || []) steps = Math.max(steps, parseLane(tr.lane).steps);
    return steps;
  }

  function songTimeline(song) {
    const spb = song.stepsPerBeat || 4;
    const stepSec = 60 / song.bpm / spb;
    const stepsPerBar = spb * 4;
    let t = 0;
    return (song.arrangement || []).map((name) => {
      const part = song.parts[name];
      if (!part) throw new Error('arrangement uses unknown part: ' + name);
      const steps = partSteps(part, stepsPerBar);
      const item = { name, start: t, duration: steps * stepSec, steps };
      t += item.duration;
      return item;
    });
  }

  function render(song, options) {
    options = options || {};
    const instruments = Object.assign({}, root.SunosuxInstruments || {}, song.instruments || {});
    const spb = song.stepsPerBeat || 4;
    const stepSec = 60 / song.bpm / spb;
    const timeline = options.timeline || songTimeline(song);
    const total = timeline.reduce((a, b) => Math.max(a, b.start + b.duration), 0) + 2.5;
    let L = new Float32Array(Math.ceil(total * SR));
    let R = new Float32Array(L.length);
    const samples = options.samples || {};
    const tune = Math.pow(2, (song.tuning || 0) / 1200); // song.tuning (cents) moves the whole band to match a singer
    const cache = new Map();
    const hits = [];
    const missing = new Set();
    const isDrum = (r) => !!(r.kind || (r.sample && !r.pitched));
    let seed = 7;
    for (const item of timeline) {
      const part = song.parts[item.name];
      for (const tr of part.tracks || []) {
        const recipe = instruments[tr.instrument];
        if (!recipe) throw new Error('unknown instrument: ' + tr.instrument);
        const lane = parseLane(tr.lane);
        const pan = tr.pan ?? recipe.pan ?? 0;
        const gain = tr.gain ?? 1;
        for (const ev of lane.events) {
          const start = Math.round((item.start + ev.step * stepSec) * SR);
          if (!isDrum(recipe) && !ev.notes) ev.notes = [recipe.root || 'A4'];
          hits.push({ t: item.start + ev.step * stepSec, inst: tr.instrument, drum: isDrum(recipe), kind: recipe.kind || null,
            midi: ev.notes ? noteToMidi(ev.notes[0]) : null, len: ev.len * stepSec, part: item.name });
          if (recipe.sample) {
            // a recording that is not here (not recorded on this computer) is skipped, not fatal
            const data = samples[recipe.sample];
            if (!data) { missing.add(recipe.sample); continue; }
            const notes = recipe.pitched && ev.notes ? ev.notes : [null];
            for (const n of notes) {
              const hold = ev.len * stepSec;
              const key = tr.instrument + '|' + n + '|' + ev.len + '|' + ev.vel;
              if (!cache.has(key)) cache.set(key, renderSampleVoice(recipe, data, n ? noteToFreq(n) * tune : 0, hold, ev.vel));
              // recipe.offset (seconds) slides a recording later (+) or earlier (-), to line a sung take up with the band
              let at = start + Math.round((recipe.offset || 0) * SR), sound = cache.get(key);
              if (at < 0) { sound = sound.subarray(Math.min(sound.length, -at)); at = 0; }
              mixInto(L, R, sound, at, pan, gain);
            }
          } else if (recipe.kind) {
            const key = tr.instrument + '|' + ev.vel;
            if (!cache.has(key)) cache.set(key, renderDrum(recipe, ev.vel, seed++));
            mixInto(L, R, cache.get(key), start, pan, gain);
          } else {
            const hold = ev.len * stepSec * (recipe.legato ?? 0.92);
            ev.notes.forEach((n, ni) => {
              const key = tr.instrument + '|' + n + '|' + ev.len + '|' + ev.vel;
              if (!cache.has(key)) cache.set(key, renderTone(recipe, noteToFreq(n) * tune, hold, ev.vel, seed++));
              const spread = ev.notes.length > 1 ? (ni / (ev.notes.length - 1) - 0.5) * 0.5 : 0;
              mixInto(L, R, cache.get(key), start, Math.max(-1, Math.min(1, pan + spread)), gain);
            });
          }
        }
      }
    }
    reverb(L, R, song.reverb ?? 0.18);
    if (options.loop) {
      // fold the ringing tail back onto the start so the part loops seamlessly
      const n = Math.round((total - 2.5) * SR);
      for (let i = n; i < L.length; i++) { L[(i - n) % n] += L[i]; R[(i - n) % n] += R[i]; }
      L = L.slice(0, n); R = R.slice(0, n);
    }
    // options.master === false leaves the raw mix alone (for measuring how loud things are against each other)
    if (options.master === false) { hits.sort((a, b) => a.t - b.t); return { sampleRate: SR, left: L, right: R, timeline, hits, duration: L.length / SR, missing: [...missing] }; }
    // master: gentle soft clip, then normalise to -1 dB
    let peak = 0;
    for (let i = 0; i < L.length; i++) {
      L[i] = Math.tanh(L[i] * 1.1);
      R[i] = Math.tanh(R[i] * 1.1);
      peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    }
    const norm = peak > 0 ? 0.89 / peak : 1;
    for (let i = 0; i < L.length; i++) { L[i] *= norm; R[i] *= norm; }
    hits.sort((a, b) => a.t - b.t);
    return { sampleRate: SR, left: L, right: R, timeline, hits, duration: L.length / SR, missing: [...missing] };
  }

  // Render one recipe on its own (for the Sound Lab "try it" button).
  function renderSample(recipe, note, seconds, samples, tuning) {
    const tune = Math.pow(2, (tuning || 0) / 1200);
    if (recipe.sample) {
      const data = (samples || {})[recipe.sample];
      if (!data) throw new Error('missing recording: ' + recipe.sample);
      const s = renderSampleVoice(recipe, data, noteToFreq(note || recipe.root || 'C4') * tune, seconds || 0.6, 0.9);
      return { sampleRate: SR, left: s, right: s };
    }
    const s = recipe.kind ? renderDrum(recipe, 0.9, 3) : renderTone(recipe, noteToFreq(note || 'A4') * tune, seconds || 0.4, 0.9, 3);
    return { sampleRate: SR, left: s, right: s };
  }

  // ---------- listening to a voice ----------
  // The pitch of a recording, frame by frame (YIN). Each frame is { t, rms, midi },
  // with midi null where there is no clear pitch (breaths, consonants, silence).
  function pitchFrames(data) {
    // halve the sample rate: plenty for a voice, 4x cheaper
    const x = new Float32Array(data.length >> 1);
    for (let i = 0; i < x.length; i++) x[i] = (data[2 * i] + data[2 * i + 1]) / 2;
    const sr = SR / 2, W = 1024, hop = 256, minLag = Math.floor(sr / 1000), maxLag = Math.ceil(sr / 80);
    const frames = [];
    let maxRms = 0;
    const d = new Float32Array(maxLag + 1);
    for (let p = 0; p + W + maxLag < x.length; p += hop) {
      let e = 0;
      for (let j = 0; j < W; j++) e += x[p + j] * x[p + j];
      const rms = Math.sqrt(e / W);
      maxRms = Math.max(maxRms, rms);
      let run = 0, best = -1;
      d[0] = 1;
      for (let tau = 1; tau <= maxLag; tau++) {
        let sum = 0;
        for (let j = 0; j < W; j++) { const diff = x[p + j] - x[p + j + tau]; sum += diff * diff; }
        run += sum;
        d[tau] = run > 0 ? sum * tau / run : 1;
      }
      for (let tau = minLag; tau < maxLag; tau++) {
        if (d[tau] < 0.15 && d[tau] <= d[tau + 1]) { best = tau; break; }
      }
      if (best < 0) { let m = 1; for (let tau = minLag; tau <= maxLag; tau++) if (d[tau] < m) { m = d[tau]; best = tau; } if (m > 0.35) best = -1; }
      let lag = best;
      if (best > 1 && best < maxLag) { // a parabola through the dip gives a finer pitch than whole samples
        const y0 = d[best - 1], y1 = d[best], y2 = d[best + 1], den = y0 - 2 * y1 + y2;
        if (den > 0) lag = best + (y0 - y2) / (2 * den);
      }
      frames.push({ t: (p + W / 2) / sr, rms, midi: best > 0 ? 69 + 12 * Math.log2(sr / lag / 440) : null });
    }
    return { frames, maxRms };
  }

  // A recording of humming or singing -> a melody lane.
  // opts: { bpm, stepsPerBeat, steps, grid: 2, scale: ['A','C','D','E','G'],
  //         origin: seconds where step 0 is (default: the first sung note),
  //         tuning: cents the singer is sharp (+) or flat (-), pitch: pitchFrames(data) if you already have it }
  function detectMelody(data, opts) {
    opts = opts || {};
    const spb = opts.stepsPerBeat || 4, grid = opts.grid || 2;
    const cellSec = 60 / (opts.bpm || 120) / spb * grid;
    const scale = (opts.scale || ['A', 'C', 'D', 'E', 'G']).map((n) => NOTE_INDEX[n[0].toUpperCase()] + (n[1] === '#' ? 1 : n[1] === 'b' ? -1 : 0));
    const pitch = opts.pitch || pitchFrames(data), frames = pitch.frames, maxRms = pitch.maxRms, tune = (opts.tuning || 0) / 100;
    const isVoiced = (f) => f.midi != null && f.rms > maxRms * 0.15;
    const voiced = frames.filter(isVoiced);
    if (!voiced.length) return { lane: '', notes: 0, shift: 0 };
    const t0 = opts.origin != null ? opts.origin : voiced[0].t - 0.02;
    // put the whole tune in a comfy octave (so grown-up voices work too)
    const sorted = voiced.map((f) => f.midi - tune).sort((a, b) => a - b);
    const shift = Math.round((72 - sorted[sorted.length >> 1]) / 12) * 12;
    const snap = (m) => {
      let bestN = Math.round(m), bestD = 99;
      for (let n = Math.floor(m) - 3; n <= Math.ceil(m) + 3; n++) {
        if (scale.includes(((n % 12) + 12) % 12) && Math.abs(n - m) < bestD) { bestD = Math.abs(n - m); bestN = n; }
      }
      return bestN;
    };
    const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const name = (n) => NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
    const cells = [];
    const nCells = opts.steps ? Math.ceil(opts.steps / grid) : Math.ceil((frames[frames.length - 1].t - t0) / cellSec + 0.5);
    for (let c = 0; c < nCells; c++) {
      const a = t0 + c * cellSec, b = a + cellSec;
      const inCell = frames.filter((f) => f.t >= a && f.t < b);
      const v = inCell.filter(isVoiced).map((f) => f.midi - tune).sort((p, q) => p - q);
      cells.push(inCell.length && v.length / inCell.length >= 0.4 ? snap(v[v.length >> 1] + shift) : null);
    }
    const total = opts.steps || cells.length * grid;
    const toks = new Array(total).fill('.');
    let count = 0;
    cells.forEach((n, c) => {
      const st = c * grid;
      if (st >= total || n == null) return;
      const held = c > 0 && cells[c - 1] === n;
      if (!held) count++;
      toks[st] = held ? '-' : name(n);
      for (let k = 1; k < grid && st + k < total; k++) toks[st + k] = '-';
    });
    const out = [];
    for (let i = 0; i < total; i += 16) out.push(toks.slice(i, i + 16).join(' '));
    return { lane: out.join(' | '), notes: count, shift };
  }

  // Make a raw voice recording sit nicely over the band: rumble out, a gentle
  // squeeze so quiet words are not lost, full level, soft edges. Changes x in
  // place and returns how loud the raw recording was (0..1).
  function polishVoice(x) {
    const a = Math.exp(-2 * Math.PI * 85 / SR);
    let low = 0, peak = 0;
    for (let i = 0; i < x.length; i++) { low = a * low + (1 - a) * x[i]; x[i] -= low; peak = Math.max(peak, Math.abs(x[i])); }
    if (peak < 0.005) return peak;
    const att = Math.exp(-1 / (0.005 * SR)), rel = Math.exp(-1 / (0.15 * SR)), thr = 0.25;
    let env = 0, top = 0;
    for (let i = 0; i < x.length; i++) {
      const v = Math.abs(x[i] /= peak);
      env = v > env ? att * env + (1 - att) * v : rel * env + (1 - rel) * v;
      if (env > thr) x[i] *= Math.pow(env / thr, -0.55);
      top = Math.max(top, Math.abs(x[i]));
    }
    const fin = Math.min(x.length, Math.round(0.01 * SR)), fout = Math.min(x.length, Math.round(0.08 * SR));
    for (let i = 0; i < x.length; i++) x[i] *= 0.9 / top;
    for (let i = 0; i < fin; i++) x[i] *= i / fin;
    for (let i = 0; i < fout; i++) x[x.length - 1 - i] *= i / fout;
    return peak;
  }

  // audio.right is optional: leave it out for a mono file (recordings)
  function encodeWav(audio) {
    const ch = audio.right ? 2 : 1, n = audio.left.length, bytes = n * ch * 2;
    const buf = new ArrayBuffer(44 + bytes);
    const dv = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); dv.setUint32(4, 36 + bytes, true); str(8, 'WAVE');
    str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
    dv.setUint32(24, audio.sampleRate, true); dv.setUint32(28, audio.sampleRate * ch * 2, true);
    dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
    str(36, 'data'); dv.setUint32(40, bytes, true);
    let o = 44;
    for (let i = 0; i < n; i++) {
      dv.setInt16(o, Math.max(-1, Math.min(1, audio.left[i])) * 32767, true); o += 2;
      if (ch === 2) { dv.setInt16(o, Math.max(-1, Math.min(1, audio.right[i])) * 32767, true); o += 2; }
    }
    return buf;
  }

  const api = { SR, noteToMidi, noteToFreq, parseLane, render, renderSample, songTimeline, encodeWav, decodeWav, resample, pitchFrames, detectMelody, polishVoice };
  root.Sunosux = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
