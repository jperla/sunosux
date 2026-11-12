#!/usr/bin/env node
// listen: a careful look at a recording of singing.
//
//   node tools/listen.js <recording.wav | song-name> [--bars 16] [--from 0 --to 30]
//
// Prints every sung note (when, how long, which pitch, how far off), the phrases,
// the tuning and key, how well the singing sits on a beat grid, and a bar-by-bar
// table with the chords that fit. Also usable as a library (see module.exports).
'use strict';
const fs = require('fs');
const path = require('path');
global.SunosuxInstruments = global.SunosuxInstruments || require('../src/instruments.js');
const S = require('../src/engine.js');

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const mod = (n) => ((n % 12) + 12) % 12;
const noteName = (m) => NAMES[mod(Math.round(m))] + (Math.floor(Math.round(m) / 12) - 1);
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

function readWav(file) {
  const b = fs.readFileSync(file);
  return S.decodeWav(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

// Split the pitch track into notes: stretches where the voice stays on one pitch.
function findNotes(data, opts) {
  opts = opts || {};
  const pitch = opts.pitch || S.pitchFrames(data), frames = pitch.frames;
  if (!frames.length) return { notes: [], frames, hop: 0, loud: 0 };
  const hop = frames.length > 1 ? frames[1].t - frames[0].t : 0.0116;
  const loud = frames.map((f) => f.rms).sort((a, b) => a - b)[Math.floor(frames.length * 0.95)];
  const floor = loud * (opts.quiet || 0.08);
  const voiced = (f) => f.midi != null && f.rms > floor;
  // smooth single-frame octave slips and flutters
  const sm = frames.map((f, i) => {
    if (!voiced(f)) return null;
    const near = [];
    for (let k = -2; k <= 2; k++) { const g = frames[i + k]; if (g && voiced(g)) near.push(g.midi); }
    return median(near);
  });
  const notes = [];
  let cur = null, gap = 0, off = 0;
  const close = () => { if (cur) { notes.push(cur); cur = null; } gap = 0; off = 0; };
  for (let i = 0; i < frames.length; i++) {
    const m = sm[i];
    if (m == null) { if (cur && ++gap > 4) close(); continue; }
    if (!cur) { cur = { i0: i, i1: i, vals: [m] }; gap = 0; off = 0; continue; }
    const centre = median(cur.vals);
    if (Math.abs(m - centre) > 0.8) {
      // moved away: a new note once it stays away for ~45 ms (shorter than that is a wobble)
      if (++off >= 4) { const startAt = i - off + 1; cur.vals.length = Math.max(1, cur.vals.length); cur.i1 = startAt - 1; notes.push(cur); cur = { i0: startAt, i1: i, vals: sm.slice(startAt, i + 1).filter((x) => x != null) }; off = 0; gap = 0; }
      continue;
    }
    off = 0; gap = 0; cur.vals.push(m); cur.i1 = i;
  }
  close();
  let out = notes.map((n) => {
    const v = n.vals, core = v.length > 6 ? v.slice(Math.floor(v.length * 0.15), Math.ceil(v.length * 0.85)) : v;
    let e = 0, c = 0;
    for (let i = n.i0; i <= n.i1; i++) { e += frames[i].rms; c++; }
    return { t: frames[n.i0].t - hop / 2, dur: (n.i1 - n.i0 + 1) * hop, midi: median(core), level: e / Math.max(1, c) / loud };
  });
  // very short blips are slides between notes: fold them into a neighbour or drop them
  const minDur = opts.minDur || 0.07;
  const kept = [];
  for (const n of out) {
    const prev = kept[kept.length - 1];
    if (n.dur < minDur) { if (prev && Math.abs(prev.midi - n.midi) < 1 && n.t - (prev.t + prev.dur) < 0.06) prev.dur = n.t + n.dur - prev.t; continue; }
    if (prev && Math.abs(prev.midi - n.midi) < 0.5 && n.t - (prev.t + prev.dur) < 0.03) { prev.dur = n.t + n.dur - prev.t; continue; } // same note, tiny break
    kept.push(n);
  }
  // the same pitch sung twice in a row ("la la") only shows as a dip in loudness: split there
  const win = Math.round(0.01 * S.SR), step = Math.round(0.005 * S.SR), split = [];
  for (const n of kept) {
    if (n.dur < 0.25) { split.push(n); continue; }
    const i0 = Math.max(0, Math.round(n.t * S.SR)), i1 = Math.min(data.length - win, Math.round((n.t + n.dur) * S.SR)), env = [];
    for (let i = i0; i < i1; i += step) { let e = 0; for (let j = 0; j < win; j++) e += data[i + j] * data[i + j]; env.push(Math.sqrt(e / win)); }
    const plateau = median(env), cuts = [];
    let run = -1;
    for (let k = 0; k <= env.length; k++) {
      const low = k < env.length && env[k] < plateau * 0.45;
      if (low && run < 0) run = k;
      if (!low && run >= 0) {
        const mid = (run + k) / 2 * step / S.SR;
        if (k - run >= 2 && mid > 0.08 && n.dur - mid > 0.08) cuts.push(mid);
        run = -1;
      }
    }
    let at = 0;
    for (const c of cuts.concat([n.dur])) { split.push(Object.assign({}, n, { t: n.t + at, dur: c - at })); at = c; }
  }
  return { notes: split, frames, hop, loud };
}

function tuningOf(notes) {
  let sx = 0, sy = 0;
  notes.forEach((n) => { const a = 2 * Math.PI * (n.midi - Math.round(n.midi)); sx += Math.cos(a) * n.dur; sy += Math.sin(a) * n.dur; });
  return notes.length ? Math.round(Math.atan2(sy, sx) / (2 * Math.PI) * 100) : 0;
}

function keyOf(notes, tuning) {
  const hist = new Array(12).fill(0);
  notes.forEach((n) => { hist[mod(Math.round(n.midi - tuning / 100))] += n.dur; });
  const ranked = [];
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  for (let t = 0; t < 12; t++) for (const [mode, prof] of [['major', MAJOR], ['minor', MINOR]]) {
    const mh = mean(hist), mp = mean(prof);
    let num = 0, dh = 0, dp = 0;
    for (let i = 0; i < 12; i++) { const a = hist[mod(i + t)] - mh, b = prof[i] - mp; num += a * b; dh += a * a; dp += b * b; }
    ranked.push({ tonic: t, mode, name: NAMES[t] + ' ' + mode, score: dh && dp ? num / Math.sqrt(dh * dp) : 0 });
  }
  ranked.sort((a, b) => b.score - a.score);
  return { hist, ranked };
}

// How well do the note starts sit on a grid of eighth notes? Tries tempos near the
// expected one and every phase; strength 1 = perfectly on the grid, 0 = no relation.
function fitGrid(notes, bpmGuess, spread) {
  let best = { bpm: bpmGuess, phase: 0, strength: -1 };
  const lo = bpmGuess * (1 - (spread ?? 0.08)), hi = bpmGuess * (1 + (spread ?? 0.08));
  for (let bpm = lo; bpm <= hi; bpm += bpmGuess * 0.0025) {
    const cell = 60 / bpm / 2;
    let sx = 0, sy = 0, w = 0;
    for (const n of notes) { const a = 2 * Math.PI * n.t / cell, wt = Math.min(n.dur, 0.5); sx += Math.cos(a) * wt; sy += Math.sin(a) * wt; w += wt; }
    const strength = w ? Math.hypot(sx, sy) / w : 0;
    if (strength > best.strength) best = { bpm: +bpm.toFixed(2), phase: +(mod2(Math.atan2(sy, sx) / (2 * Math.PI)) * cell).toFixed(3), strength: +strength.toFixed(2) };
  }
  return best;
}
const mod2 = (x) => ((x % 1) + 1) % 1;

function phrasesOf(notes, gapSec) {
  const out = [];
  for (const n of notes) {
    const last = out[out.length - 1];
    if (last && n.t - (last.t + last.dur) < (gapSec || 0.35)) { last.notes.push(n); last.dur = n.t + n.dur - last.t; }
    else out.push({ t: n.t, dur: n.dur, notes: [n] });
  }
  return out;
}

// chords of a key, as pitch classes
function chordsOf(tonic, mode) {
  const degs = mode === 'major'
    ? [[0, 0, 'I'], [2, 1, 'ii'], [4, 1, 'iii'], [5, 0, 'IV'], [7, 0, 'V'], [9, 1, 'vi']]
    : [[0, 1, 'i'], [3, 0, 'III'], [5, 1, 'iv'], [7, 1, 'v'], [8, 0, 'VI'], [10, 0, 'VII']];
  return degs.map(([d, minor, roman]) => { const r = mod(tonic + d); return { root: r, minor: !!minor, roman, name: NAMES[r] + (minor ? 'm' : ''), tones: [r, mod(r + (minor ? 3 : 4)), mod(r + 7)] }; });
}

// For every bar: what was sung (seconds on each pitch class) and how well each chord holds it.
function barTable(notes, tuning, barSec, bars, chords, origin) {
  const rows = [];
  for (let b = 0; b < bars; b++) {
    const a = (origin || 0) + b * barSec, z = a + barSec, pcs = new Array(12).fill(0), inBar = [];
    for (const n of notes) {
      const s = Math.max(a, n.t), e = Math.min(z, n.t + n.dur);
      if (e <= s) continue;
      pcs[mod(Math.round(n.midi - tuning / 100))] += e - s;
      if (n.t >= a && n.t < z) inBar.push(n);
    }
    const total = pcs.reduce((x, y) => x + y, 0);
    const fits = chords.map((c) => ({ name: c.name, roman: c.roman, fit: total ? c.tones.reduce((x, t) => x + pcs[t], 0) / total : 0 })).sort((x, y) => y.fit - x.fit);
    rows.push({ bar: b + 1, sung: total, pcs, notes: inBar, fits });
  }
  return rows;
}

function report(data, opts) {
  opts = opts || {};
  const seconds = data.length / S.SR;
  const found = findNotes(data), notes = found.notes;
  const tuning = tuningOf(notes), key = keyOf(notes, tuning), top = key.ranked[0];
  const bars = opts.bars || require('../src/seed.js').guessBars(seconds), bpm0 = bars * 240 / seconds;
  const grid = fitGrid(notes, bpm0), phrases = phrasesOf(notes);
  const chords = chordsOf(top.tonic, top.mode);
  return { seconds, notes, tuning, key, top, bars, bpm0, grid, phrases, chords, table: barTable(notes, tuning, seconds / bars, bars, chords, 0) };
}

function print(r) {
  const cents = (n) => { const c = Math.round((n.midi - r.tuning / 100 - Math.round(n.midi - r.tuning / 100)) * 100); return (c >= 0 ? '+' : '') + c; };
  const nm = (n) => noteName(n.midi - r.tuning / 100);
  console.log(`${r.seconds.toFixed(2)} s, ${r.notes.length} notes in ${r.phrases.length} phrases`);
  console.log(`tuning: ${r.tuning} cents from concert pitch`);
  console.log(`key guesses: ${r.key.ranked.slice(0, 4).map((k) => `${k.name} (${k.score.toFixed(2)})`).join(', ')}`);
  console.log(`time on each note: ${NAMES.map((n, i) => [n, r.key.hist[i]]).filter((x) => x[1] > 0.05).sort((a, b) => b[1] - a[1]).map(([n, s]) => `${n} ${s.toFixed(1)}s`).join('  ')}`);
  console.log(`as ${r.bars} bars it is ${r.bpm0.toFixed(1)} bpm; best nearby grid: ${r.grid.bpm} bpm, first eighth at ${r.grid.phase}s, strength ${r.grid.strength} (1 = on the beat, <0.3 = free time)`);
  console.log('\nphrases:');
  r.phrases.forEach((p, i) => console.log(`  ${String(i + 1).padStart(2)}  ${p.t.toFixed(2).padStart(6)}s  ${p.dur.toFixed(2)}s  ${p.notes.map(nm).join(' ')}`));
  console.log('\nnotes (time, length, note, cents off after tuning, loudness):');
  r.notes.forEach((n) => console.log(`  ${n.t.toFixed(2).padStart(6)}  ${n.dur.toFixed(2)}  ${nm(n).padEnd(4)} ${cents(n).padStart(4)}  ${'#'.repeat(Math.max(1, Math.round(n.level * 10)))}`));
  console.log(`\nbar by bar (${(r.seconds / r.bars).toFixed(2)} s a bar), chords of ${r.top.name}:`);
  r.table.forEach((row) => {
    const sung = NAMES.map((n, i) => [n, row.pcs[i]]).filter((x) => x[1] > 0.04).sort((a, b) => b[1] - a[1]).map(([n, s]) => `${n}:${s.toFixed(1)}`).join(' ');
    console.log(`  ${String(row.bar).padStart(2)}  ${row.notes.map(nm).join(' ').padEnd(34)}  [${sung}]  -> ${row.fits.slice(0, 3).map((f) => `${f.name} ${Math.round(f.fit * 100)}%`).join(', ')}`);
  });
}

module.exports = { readWav, findNotes, tuningOf, keyOf, fitGrid, phrasesOf, chordsOf, barTable, report, print, noteName, NAMES, mod, median };

if (require.main === module) {
  const args = process.argv.slice(2), flags = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) { if (args[i].startsWith('--')) flags[args[i].slice(2)] = args[++i]; else rest.push(args[i]); }
  let file = rest[0];
  if (!file) { console.error('usage: node tools/listen.js <recording.wav | song-name> [--bars 16] [--from s --to s]'); process.exit(1); }
  if (!fs.existsSync(file)) {
    const song = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'songs', file + '.json'), 'utf8'));
    file = path.join(__dirname, '..', 'sounds', (flags.full ? song.seed.recording : song.seed.piece) + '.wav');
    if (!flags.bars) flags.bars = song.seed.bars;
  }
  let data = readWav(file);
  if (flags.from || flags.to) data = data.slice(Math.round((+flags.from || 0) * S.SR), flags.to ? Math.round(+flags.to * S.SR) : undefined);
  print(report(data, { bars: +flags.bars || undefined }));
}
