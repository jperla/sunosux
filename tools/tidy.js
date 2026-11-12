// tidy: clean up a free-time sung recording so a band can play with it.
//
// A young singer does not sing to a click. Stretching her voice to fit one
// would wreck it, so tidy leaves every phrase exactly as she sang it and moves
// whole phrases instead: each one is lifted out, cleaned, and set down so it
// starts on a strong beat, keeping the breathing space she left between them.
//
//   phrasesIn(data)                 find the phrases (and the notes inside them)
//   layout(phrases, bpm, opts)      choose a beat-aligned start for every phrase
//   retime(data, phrases, starts)   build the tidied recording
//   notesToLane(notes, ...)         her tune written out as a lane of notes
'use strict';
const S = require('../src/engine.js');
const L = require('./listen.js');

// 2nd-order high-pass: takes out rumble, thumps and mic handling below a child's voice
function highpass(x, hz) {
  const w = 2 * Math.PI * hz / S.SR, cs = Math.cos(w), al = Math.sin(w) / (2 * 0.707);
  const b0 = (1 + cs) / 2, b1 = -(1 + cs), b2 = (1 + cs) / 2, a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

// loudness every 5 ms, in dB
function envelope(x) {
  const win = Math.round(0.02 * S.SR), step = Math.round(0.005 * S.SR), out = [];
  for (let i = 0; i + win < x.length; i += step) { let e = 0; for (let j = 0; j < win; j++) e += x[i + j] * x[i + j]; out.push(10 * Math.log10(e / win + 1e-12)); }
  return { db: out, step: step / S.SR };
}

// Phrases: runs of notes with less than `gap` seconds of silence between them.
// Each phrase's edges are pushed out to take in the breathy starts and trailing
// consonants that have no pitch, without running into the neighbouring phrase.
function phrasesIn(data, opts) {
  opts = opts || {};
  const found = L.findNotes(data), tuning = L.tuningOf(found.notes);
  let raw = L.phrasesOf(found.notes, opts.gap || 0.5);
  // opts.maxLen: someone who hardly pauses gives phrases too long to line up with a beat.
  // Split those at their biggest breath until each is short enough (or has no breath left).
  if (opts.maxLen) {
    const split = (p) => {
      if (p.dur <= opts.maxLen || p.notes.length < 2) return [p];
      let at = -1, big = 0.12;
      for (let i = 1; i < p.notes.length; i++) { const g = p.notes[i].t - (p.notes[i - 1].t + p.notes[i - 1].dur); if (g > big) { big = g; at = i; } }
      if (at < 0) return [p];
      const mk = (ns) => ({ t: ns[0].t, dur: ns[ns.length - 1].t + ns[ns.length - 1].dur - ns[0].t, notes: ns });
      return split(mk(p.notes.slice(0, at))).concat(split(mk(p.notes.slice(at))));
    };
    raw = raw.flatMap(split);
  }
  const env = envelope(data), sorted = env.db.slice().sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)], open = floor + 9;
  const at = (t) => env.db[Math.max(0, Math.min(env.db.length - 1, Math.round(t / env.step)))];
  const phrases = raw.map((p, i) => {
    const prevEnd = i ? raw[i - 1].t + raw[i - 1].dur : 0, nextStart = i + 1 < raw.length ? raw[i + 1].t : data.length / S.SR;
    let a = p.t, b = p.t + p.dur;
    const aMin = Math.max(i ? (prevEnd + p.t) / 2 : 0, p.t - 0.3), bMax = Math.min((b + nextStart) / 2, b + 0.45);
    while (a - 0.005 > aMin && at(a - 0.005) > open) a -= 0.005;
    while (b + 0.005 < bMax && at(b + 0.005) > open) b += 0.005;
    a = Math.max(aMin, a - 0.03); b = Math.min(bMax, b + 0.06);
    return { index: i + 1, t: p.t, dur: p.dur, cutFrom: a, cutTo: b, notes: p.notes };
  });
  return { phrases, tuning, notes: found.notes, floorDb: floor };
}

// Choose where each phrase starts. The first sung note of every phrase lands on a
// grid point (every `unit` beats), and the gap she left before it is kept, rounded.
// opts.bars: { phraseIndex: true } forces that phrase onto a bar line (a new section).
function layout(phrases, bpm, opts) {
  opts = opts || {};
  const beat = 60 / bpm, unit = (opts.unit || 2) * beat, bar = 4 * beat, minGap = opts.minGap ?? 0.25;
  const starts = [], first = opts.first || 0; // opts.first: seconds of lead-in before the grid's zero
  let moved = 0;
  phrases.forEach((p, i) => {
    let s;
    if (i === 0) s = first;
    else {
      const prev = phrases[i - 1], want = starts[i - 1] + (p.t - prev.t);
      const grid = opts.bars && opts.bars[p.index] ? bar * (opts.every || 1) : unit;
      s = first + Math.round((want - first) / grid) * grid;
      const clear = starts[i - 1] + (prev.cutTo - prev.t) + minGap + (p.t - p.cutFrom);
      while (s < clear - 1e-6) s += grid;
      moved += Math.abs(s - want);
    }
    starts.push(+s.toFixed(4));
  });
  return { starts, moved, beat, bar, unit };
}

// Build the tidied recording: every phrase cut out with soft edges, evened in
// loudness a little, and placed so its first note sits at starts[i] seconds.
function retime(data, phrases, starts, opts) {
  opts = opts || {};
  const last = phrases[phrases.length - 1], total = starts[starts.length - 1] + (last.cutTo - last.t) + 0.3;
  const out = new Float32Array(Math.ceil((opts.seconds || total) * S.SR));
  const rmsOf = (p) => { let e = 0, n = 0; for (let i = Math.round(p.t * S.SR); i < Math.round((p.t + p.dur) * S.SR) && i < data.length; i++) { e += data[i] * data[i]; n++; } return Math.sqrt(e / Math.max(1, n)); };
  const levels = phrases.map(rmsOf), mid = L.median(levels);
  phrases.forEach((p, i) => {
    const a = Math.round(p.cutFrom * S.SR), b = Math.min(data.length, Math.round(p.cutTo * S.SR)), n = b - a;
    // bring quiet phrases up and loud ones down part of the way (at most 8 dB)
    const gain = Math.max(0.4, Math.min(2.5, Math.pow(mid / Math.max(1e-6, levels[i]), opts.even ?? 0.6)));
    const dst = Math.round((starts[i] - (p.t - p.cutFrom)) * S.SR), fin = Math.round(0.015 * S.SR), fout = Math.round(0.07 * S.SR);
    for (let k = 0; k < n; k++) {
      const j = dst + k;
      if (j < 0 || j >= out.length) continue;
      const fade = Math.min(1, k / fin, (n - 1 - k) / fout);
      out[j] += data[a + k] * gain * fade;
    }
  });
  return out;
}

// Her tune as a lane: every note at its new time, on the 16th grid, pulled to the
// nearest note of the scale. `origin` is where the lane's step 0 is, in seconds.
function notesToLane(phrases, starts, opts) {
  const stepSec = 60 / opts.bpm / 4, steps = opts.steps, tune = (opts.tuning || 0) / 100;
  const scale = opts.scale.map((n) => L.NAMES.indexOf(n));
  const snap = (m) => { let best = Math.round(m), d = 9; for (let n = Math.floor(m) - 2; n <= Math.ceil(m) + 2; n++) if (scale.includes(L.mod(n)) && Math.abs(n - m) < d) { d = Math.abs(n - m); best = n; } return best; };
  const cells = new Array(steps).fill(null);
  phrases.forEach((p, i) => {
    const centre = L.median(p.notes.map((n) => n.midi));
    for (const n of p.notes) {
      if (n.dur < 0.09 || n.level < 0.25) continue; // slides and blips are not notes
      if (Math.abs(n.midi - centre) > 8 && n.dur < 0.25) continue; // a squeak an octave away is the pitch tracker slipping
      const t = starts[i] + (n.t - p.t) - (opts.origin || 0), s0 = Math.round(t / stepSec), s1 = Math.max(s0 + 1, Math.round((t + n.dur) / stepSec));
      const midi = snap(n.midi - tune) + (opts.shift || 0);
      for (let s = s0; s < s1 && s < steps; s++) if (s >= 0) cells[s] = { midi, start: s === s0 };
    }
  });
  const toks = cells.map((c, s) => {
    if (!c) return '.';
    const prev = cells[s - 1];
    return prev && prev.midi === c.midi && !c.start ? '-' : prev && prev.midi === c.midi && c.start && s % 2 ? '-' : L.noteName(c.midi);
  });
  const out = [];
  for (let i = 0; i < steps; i += 16) out.push(toks.slice(i, i + 16).join(' '));
  return out.join(' | ');
}

// Set how loud the singing is by its average while she is actually singing (not by its
// loudest moment: one squeal or bump would otherwise leave everything else too quiet),
// then round off any peaks that go over.
function level(x, targetDb) {
  const w = Math.round(0.02 * S.SR);
  let power = 0, n = 0;
  for (let i = 0; i + w < x.length; i += w) { let e = 0; for (let j = 0; j < w; j++) e += x[i + j] * x[i + j]; if (e / w > 1e-4) { power += e / w; n++; } }
  if (!n) return x;
  const gain = Math.pow(10, ((targetDb ?? -15) - 10 * Math.log10(power / n)) / 20), knee = 0.6, room = 0.35;
  for (let i = 0; i < x.length; i++) {
    const v = x[i] * gain, a = Math.abs(v);
    x[i] = a <= knee ? v : Math.sign(v) * (knee + room * Math.tanh((a - knee) / room));
  }
  return x;
}

// keep only the part of the sound where a voice has to be heard (about 300 Hz to 3 kHz)
function voiceBand(x) {
  const y = highpass(x, 300), a = Math.exp(-2 * Math.PI * 3000 / S.SR);
  let l1 = 0, l2 = 0;
  for (let i = 0; i < y.length; i++) { l1 = a * l1 + (1 - a) * y[i]; l2 = a * l2 + (1 - a) * l1; y[i] = l2; }
  return y;
}

module.exports = { highpass, envelope, phrasesIn, layout, retime, notesToLane, level, voiceBand };
