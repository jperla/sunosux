#!/usr/bin/env node
// grow: turn a seed song (a free-time sung take plus a plain draft) into a real arrangement.
//
//   node tools/grow.js <song-name> [--bpm 100] [--root A]
//
// What it does, in order:
//   1. listens: finds every phrase and note in the take
//   2. tidies: moves whole phrases onto strong beats (never stretches), splits the take into parts
//   3. harmony: holds a drone and lets one inner voice follow what she mostly sings in each bar
//   4. her voice as the choir: freezes her steadiest held note into a playable pad
//   5. arranges: strings, cello, music box, harp and small-sound beats, shaped as an arc across the parts
//   6. balances: keeps the voice clearly over the band where voices are heard
// The result is ordinary song data. It is a starting point for people (and Claude) to keep changing.
'use strict';
const fs = require('fs');
const path = require('path');
global.SunosuxInstruments = global.SunosuxInstruments || require('../src/instruments.js');
const S = require('../src/engine.js');
const L = require('./listen.js');
const T = require('./tidy.js');
const ROOT = path.resolve(__dirname, '..');
const rel = (...p) => path.join(ROOT, ...p);
const UNIT = 1;  // every phrase starts on a beat (2 would be every half bar: stronger, but it moves her further)
const PRE = 0.3; // each part's recording starts this long before its bar line, to keep the breath before the first word

const pcOf = (name) => L.NAMES.indexOf(name);
const nameAt = (midi) => L.noteName(midi);
const atOrAbove = (pc, lo) => { let m = pc; while (m < lo) m += 12; return m; };
const softFit = (pcs, total, tones) => {
  if (!total) return 0;
  let s = 0;
  for (let k = 0; k < 12; k++) { const d = Math.min(...tones.map((x) => Math.min(L.mod(k - x), L.mod(x - k)))); s += pcs[k] * (d === 0 ? 1 : d === 1 ? 0.35 : 0); }
  return s / total;
};
// the colours an inner voice can make over a drone of root and fifth
const COLOURS = [['m', 3], ['', 4], ['sus2', 2], ['sus4', 5]];

// ---------- 2. split the take into parts of 4 or 8 bars ----------
function sectionsOf(phrases, bpm) {
  const BAR = 240 / bpm, out = [];
  let cur = [];
  const fits = (list, limit) => { const lay = T.layout(list, bpm, { unit: UNIT, first: PRE }), last = list[list.length - 1]; return lay.starts[lay.starts.length - 1] - PRE + last.dur <= limit * BAR; };
  for (const p of phrases) {
    if (cur.length && !fits(cur.concat([p]), 7)) { out.push(cur); cur = []; } // leave about a bar free at the end for the band to answer
    cur.push(p);
  }
  if (cur.length) out.push(cur);
  return out.map((list) => {
    const lay = T.layout(list, bpm, { unit: UNIT, first: PRE }), last = list[list.length - 1];
    const end = lay.starts[lay.starts.length - 1] - PRE + last.dur;
    return { phrases: list, starts: lay.starts, bars: end <= 4 * BAR + 0.05 ? 4 : 8, end };
  });
}

// what is sung in each bar of a part: seconds on each of the 12 notes
function barsSung(sec, bpm, tuning) {
  const BAR = 240 / bpm, rows = [];
  for (let b = 0; b < sec.bars; b++) {
    const pcs = new Array(12).fill(0);
    sec.phrases.forEach((p, i) => p.notes.forEach((n) => {
      const t = sec.starts[i] - PRE + n.t - p.t, s = Math.max(b * BAR, t), e = Math.min((b + 1) * BAR, t + n.dur);
      if (e > s && n.dur >= 0.12) pcs[L.mod(Math.round(n.midi - tuning / 100))] += e - s;
    }));
    rows.push({ pcs, total: pcs.reduce((x, y) => x + y, 0) });
  }
  return rows;
}

// ---------- 3. the drone and its colours ----------
function harmonise(sections, bpm, tuning, forcedRoot) {
  const sung = sections.map((sec) => barsSung(sec, bpm, tuning));
  const tryRoot = (r) => {
    let held = 0, all = 0;
    const colours = sung.map((rows) => rows.map((row, b) => {
      let best = COLOURS[0], top = -1;
      for (const c of COLOURS) { const f = softFit(row.pcs, row.total, [r, L.mod(r + 7), L.mod(r + c[1])]) + (c === COLOURS[0] ? 0.01 : 0); if (f > top) { top = f; best = c; } }
      if (!row.total) return b % 2 ? COLOURS[2] : null; // nobody singing: fill in below
      held += top * row.total; all += row.total;
      return best;
    }));
    return { root: r, colours, score: all ? held / all : 0 };
  };
  const ranked = Array.from({ length: 12 }, (_, r) => tryRoot(r)).sort((a, b) => b.score - a.score);
  const pick = forcedRoot != null ? tryRoot(forcedRoot) : ranked[0];
  // bars with no singing take the song's usual third (so the answer phrases sound like home)
  const count = { m: 0, '': 0 };
  pick.colours.flat().forEach((c) => { if (c && c[0] in count) count[c[0]]++; });
  const home = count[''] > count.m ? COLOURS[1] : COLOURS[0];
  pick.colours = pick.colours.map((row) => row.map((c) => c || home));
  return { pick, ranked, home, minor: home === COLOURS[0] };
}

// ---------- 4. her steadiest note, to freeze into a choir ----------
function steadiest(data) {
  const pitch = S.pitchFrames(data), found = L.findNotes(data, { pitch });
  let best = null;
  for (const n of found.notes) {
    if (n.dur < 0.4) continue;
    const fr = pitch.frames.filter((f) => f.t >= n.t + 0.06 && f.t <= n.t + n.dur - 0.05 && f.midi != null);
    for (let i = 0; i + 30 < fr.length; i += 3) {
      const w = fr.slice(i, i + 30), m = L.median(w.map((f) => f.midi)), sd = Math.sqrt(w.reduce((a, f) => a + (f.midi - m) ** 2, 0) / w.length);
      if (!best || sd < best.sd) best = { t0: w[0].t, t1: w[w.length - 1].t, midi: m, sd };
    }
  }
  return best;
}

// ---------- 5. lanes ----------
const REST = '. . . . . . . . . . . . . . . .';
const hold = (n) => n + ' -'.repeat(15);
const dr = (...b) => b.join('|');
const cyc = (pats, n) => Array.from({ length: n }, (_, i) => pats[i % pats.length]);
const silent = (n) => cyc(['................'], n);

function arrange(ctx) {
  const { sections, root, colours, motif, hasChoir } = ctx;
  // drone voicing: root between C3 and B3 with its fifth above. A low root gets an open voicing (inner voice
  // above the fifth) because thirds that low are mud; a higher root keeps the inner voice between the two.
  const r3 = atOrAbove(root, 48), fifth = r3 + 7, open = r3 <= 53;
  const innerMidi = (c) => r3 + c[1] + (open ? 12 : 0);
  const innerOf = (c) => nameAt(innerMidi(c));
  const drone = nameAt(r3) + '+' + nameAt(fifth);
  const chord = (c) => nameAt(r3) + '+' + innerOf(c) + '+' + nameAt(fifth);
  const celloNote = nameAt(atOrAbove(root, 36)), subNote = nameAt(atOrAbove(root, 28));
  const pad = hasChoir ? 'voice-choir' : 'choir';
  const lanes = (cols) => ({
    drone: cols.map(() => hold(drone)).join(' | '),
    inner: cols.map((c) => hold(innerOf(c))).join(' | '),
    high: cols.map((c) => hold(nameAt(innerMidi(c) + 12))).join(' | '),
    chords: cols.map((c) => hold(chord(c))).join(' | '),
    cello: cols.map(() => hold(celloNote)).join(' | '),
    sub: cols.map(() => `${subNote} - - . . . ${subNote} - . . ${subNote} - - . . .`).join(' | '),
    harp: cols.map((c) => { const a = nameAt(r3), e = nameAt(fifth), i = innerOf(c), a2 = nameAt(r3 + 12); return open ? `${a} . ${e} . ${a2} . ${i} . ${e} . ${a2} . ${i} . ${e} .` : `${a} . ${e} . ${i} . ${e} . ${a2} . ${e} . ${i} . ${e} .`; }).join(' | '),
    pings: cols.map((c) => `. . . . ${nameAt(atOrAbove(L.mod(root + c[1]), 72))} . . . . . . . . . ${nameAt(atOrAbove(L.mod(root + 7), 72))} .`),
  });
  const answers = (sec, bars, fn) => bars.map((bar, b) => (b >= sec.freeFrom ? fn(b - sec.freeFrom) : bar)); // the band answers in the bars after she stops
  const voice = (sec) => ({ instrument: sec.sample, lane: 'X' + '.'.repeat(15) + ('|' + '.'.repeat(16)).repeat(sec.bars - 1) });
  const tune = (sec) => ({ instrument: 'voice-tune', lane: sec.tune, gain: 0 });
  const [RISE, FALL, LAND] = motif;
  const reply = (k) => [RISE, LAND, FALL][k % 3];

  const kinds = {
    // just her, strings and a music box
    intimate: (sec, l) => [
      { instrument: 'strings', lane: l.drone, gain: 0.55 }, { instrument: 'strings', lane: l.inner, gain: 0.5 }, { instrument: 'cello', lane: l.cello, gain: 0.55 },
      { instrument: 'musicbox', lane: answers(sec, l.pings, reply).join(' | '), gain: 0.8 },
      { instrument: 'kick', lane: dr(...cyc(['x...............'], sec.bars)), gain: 0.55 },
      { instrument: 'click', lane: dr(...cyc(['..x...x..x....x.', '.x....x...x..x..'], sec.bars)), gain: 1.3 },
      { instrument: 'rim', lane: dr(...cyc(['................', '..........x.....'], sec.bars)), gain: 0.7 }],
    // a heartbeat arrives
    pulse: (sec, l) => [
      { instrument: 'strings', lane: l.drone, gain: 0.55 }, { instrument: 'strings', lane: l.inner, gain: 0.5 }, { instrument: 'cello', lane: l.cello, gain: 0.55 },
      { instrument: 'harp', lane: l.harp, gain: 0.45 }, { instrument: 'bass', lane: l.sub, gain: 0.5 },
      { instrument: 'musicbox', lane: answers(sec, cyc([REST], sec.bars), reply).join(' | '), gain: 0.8 },
      { instrument: 'kick', lane: dr(...cyc(['x.....x...x.....', 'x.........x.....'], sec.bars)), gain: 0.55 },
      { instrument: 'click', lane: dr(...cyc(['..x..x....x..x.x', 'x..x....x.x...x.'], sec.bars)), gain: 1.3 },
      { instrument: 'shaker', lane: dr(...cyc(['x.o.x.o.x.o.x.o.'], sec.bars)), gain: 1.6 }],
    // marching towards something
    build: (sec, l) => {
      const n = sec.bars, last4 = ['o...o...o...o...', 'o.o.o.o.o.o.o.o.', 'o.oxo.oxo.oxo.ox', 'xxoxxxoxxxxxXXXX'], lastBoom = ['x...............', 'x.......x.......', 'x.......x.......', 'x...x...x...x...'];
      return [
        { instrument: 'strings', lane: l.drone, gain: 0.6 }, { instrument: 'strings', lane: l.inner, gain: 0.5 },
        { instrument: 'strings', lane: [...cyc([REST], n - 2), ...l.high.split(' | ').slice(n - 2)].join(' | '), gain: 0.5 },
        { instrument: 'cello', lane: l.cello, gain: 0.6 }, { instrument: 'bass', lane: l.sub, gain: 0.6 },
        { instrument: 'snare', lane: dr(...cyc(['o...o...o...o...'], n - 4), ...last4), gain: 0.5 },
        { instrument: 'boom', lane: dr(...cyc(['x...............'], n - 4), ...lastBoom), gain: 0.7 },
        { instrument: 'click', lane: dr(...cyc(['x.xxx.xxx.xxx.xx'], n)), gain: 1.0 }];
    },
    // everything, with her own voice behind her
    full: (sec, l) => {
      const n = sec.bars, thin = (pats, lastBar) => dr(...cyc(pats, n - 1), lastBar);
      return [
        { instrument: 'strings', lane: l.drone, gain: 0.55 },
        { instrument: 'strings', lane: answers(sec, l.inner.split(' | '), (k) => reply(k).replace(/5/g, '4')).join(' | '), gain: 0.5 },
        { instrument: pad, lane: l.drone, gain: 0.45 },
        { instrument: 'cello', lane: l.cello, gain: 0.55 }, { instrument: 'bass', lane: l.sub, gain: 0.65 }, { instrument: 'harp', lane: l.harp, gain: 0.45 },
        { instrument: 'kick', lane: thin(['x.....x...x.....', 'x.....x..x..x...'], 'x...............'), gain: 0.6 },
        { instrument: 'click', lane: dr(...cyc(['x.xx..x.x..xx.x.', '.xx.x.x..x.xx..x'], n)), gain: 1.3 },
        { instrument: 'glitch', lane: thin(['.......x......x.', '...x.........x..'], '................'), gain: 3 },
        { instrument: 'rim', lane: thin(['....x.......x..x', '....x..x....x...'], '....x...........'), gain: 1.1 },
        { instrument: 'shaker', lane: thin(['x.o.x.o.x.o.x.o.'], 'x...o...o.......'), gain: 2 }];
    },
    // almost only voices
    bare: (sec, l) => [
      { instrument: pad, lane: l.chords, gain: 0.7 },
      { instrument: 'musicbox', lane: cyc([RISE, FALL], sec.bars).map((m) => '. . . . . . . . ' + m.split(' ').slice(0, 8).join(' ')).join(' | '), gain: 0.8 },
      { instrument: 'kick', lane: dr(...cyc(['x...............', '................'], sec.bars)), gain: 0.5 },
      { instrument: 'click', lane: dr(...cyc(['....x.......x...', '..x.......x....x'], sec.bars)), gain: 1.3 },
      { instrument: 'rim', lane: dr(...cyc(['..........x.....', '......x.......x.'], sec.bars)), gain: 0.7 }],
  };
  const look = { intimate: ['🎀', '#ff4fa3'], pulse: ['🌊', '#3ec1ff'], build: ['⚡', '#c86bfa'], full: ['🗡️', '#00b3a4'], bare: ['🧚', '#ff9f1c'] };
  const arcs = { 1: ['full'], 2: ['intimate', 'full'], 3: ['intimate', 'full', 'bare'], 4: ['intimate', 'build', 'full', 'bare'] };
  const arc = arcs[sections.length] || ['intimate', 'pulse', 'build', 'full', 'bare'].concat(cyc(['pulse', 'build', 'full', 'bare'], Math.max(0, sections.length - 5)));
  const home = [ctx.home, ctx.home, ctx.home, COLOURS[2]];
  const parts = {
    intro: { emoji: '🌙', color: '#7b5cff', bars: 4, lyrics: '', tracks: [
      { instrument: pad, lane: [hold(drone), hold(drone), hold(chord(ctx.home)), hold(chord(COLOURS[2]))].join(' | '), gain: 0.8 },
      { instrument: 'musicbox', lane: [RISE, FALL, RISE, LAND].join(' | ') },
      { instrument: 'cello', lane: [REST, REST, hold(celloNote), hold(celloNote)].join(' | '), gain: 0.6 },
      { instrument: 'click', lane: dr('................', '................', '..x...x..x....x.', '.x....x...x..x.x'), gain: 1.3 }] },
  };
  sections.forEach((sec, i) => {
    sec.kind = arc[i];
    const [emoji, color] = look[sec.kind];
    parts[sec.name] = { emoji, color, bars: sec.bars, lyrics: '', feel: sec.kind, tracks: [voice(sec), tune(sec), ...kinds[sec.kind](sec, lanes(colours[i]))] };
  });
  parts.outro = { emoji: '💖', color: '#ff7ad9', bars: 4, lyrics: '', tracks: [
    { instrument: pad, lane: home.map((c, k) => hold(k === 3 ? drone : chord(c))).join(' | '), gain: 0.8 },
    { instrument: 'musicbox', lane: [RISE, FALL, RISE.split(' ').slice(0, 8).join(' ') + ' . . . . . . . .', REST].join(' | ') },
    { instrument: 'cello', lane: cyc([hold(celloNote)], 4).join(' | '), gain: 0.55 },
    { instrument: 'click', lane: dr('..x...x..x....x.', '.x....x...x.....', '......x.........', '................'), gain: 1.3 }] };
  return parts;
}

// ---------- 6. balance ----------
function balance(song, samples, names, want) {
  const dbOf = (x, mask) => { let e = 0, n = 0; for (let i = 0; i < x.length; i++) if (mask[i]) { e += x[i] * x[i]; n++; } return 10 * Math.log10(e / Math.max(1, n) + 1e-12); };
  const isVoice = (t) => (song.instruments[t.instrument] || {}).vocal;
  const report = [];
  for (const name of names) {
    const part = song.parts[name], only = (keep) => Object.assign({}, song, { reverb: 0, arrangement: [name], parts: { [name]: Object.assign({}, part, { tracks: part.tracks.filter(keep) }) } });
    const v = S.render(only(isVoice), { samples, master: false }).left;
    const mask = new Uint8Array(v.length), w = 2205;
    for (let i = 0; i + w < v.length; i += w) { let e = 0; for (let j = 0; j < w; j++) e += v[i + j] ** 2; if (Math.sqrt(e / w) > 0.03) mask.fill(1, i, i + w); }
    const measure = () => dbOf(T.voiceBand(v), mask) - dbOf(T.voiceBand(S.render(only((t) => !isVoice(t)), { samples, master: false }).left), mask);
    const before = measure();
    if (before < want) { const k = Math.max(0.3, Math.pow(10, (before - want) / 20)); part.tracks.forEach((t) => { if (!isVoice(t) && t.gain !== 0) t.gain = +(((t.gain ?? 1) * k).toFixed(2)); }); }
    report.push({ name, before: +before.toFixed(1), after: +measure().toFixed(1) });
  }
  return report;
}

function grow(id, opts) {
  opts = opts || {};
  const file = rel('songs', id + '.json'), old = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!old.seed || !old.seed.recording) throw new Error('this song did not start from a recording (no seed.recording)');
  // growing replaces every part, so a song that people have been working on is only regrown on purpose
  if (old.seed.grown && !opts.again) throw new Error('this song is already grown. Add --again to redo it from the recording (that replaces every part).');
  const log = opts.log || (() => {});
  let raw = L.readWav(rel('sounds', old.seed.recording + '.wav'));
  if (old.seed.to && (old.seed.from || old.seed.to < raw.length / S.SR - 0.05)) raw = raw.slice(Math.round((old.seed.from || 0) * S.SR), Math.round(old.seed.to * S.SR)); // only the bit they picked
  const data = T.highpass(raw, 110), P = T.phrasesIn(data, { gap: 0.4, maxLen: 4 });
  // tempo: if the singing keeps a beat of its own, use that beat; free-time singing gets a comfortable 100
  let bpm = +opts.bpm || 100;
  if (!opts.bpm && P.notes.length > 8) {
    const g = L.fitGrid(P.notes, 105, 0.3); // looks from about 74 to 136 beats a minute
    if (g.strength >= 0.6) { // (below 0.6 the 'beat' is usually an accident)
      bpm = Math.round(g.bpm); log(`the singing keeps its own beat (${g.bpm} bpm, strength ${g.strength}), so the band follows it`); }
  }
  const BAR = 240 / bpm;
  if (!P.phrases.length) throw new Error('I could not find any singing in the recording');

  // tuning: only trust it if her long notes agree with each other
  let sx = 0, sy = 0, w = 0;
  for (const n of P.notes) if (n.dur >= 0.3) { const a = 2 * Math.PI * (n.midi - Math.round(n.midi)); sx += Math.cos(a) * n.dur; sy += Math.sin(a) * n.dur; w += n.dur; }
  const sure = w ? Math.hypot(sx, sy) / w : 0, tuning = sure >= 0.25 ? Math.round(Math.atan2(sy, sx) / (2 * Math.PI) * 100) : 0;

  const sections = sectionsOf(P.phrases, bpm);
  const H = harmonise(sections, bpm, tuning, opts.root ? pcOf(opts.root) : null), root = H.pick.root;
  const scale7 = (H.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11]).map((i) => L.NAMES[L.mod(root + i)]);
  const scale5 = (H.minor ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9]).map((i) => L.NAMES[L.mod(root + i)]);
  log(`${P.phrases.length} phrases, ${sections.length} parts at ${bpm} bpm; tuning ${tuning} cents (certainty ${sure.toFixed(2)})`);
  log(`drone on ${L.NAMES[root]} holds ${Math.min(100, Math.round(H.pick.score * 100))}% of the singing (next best: ${H.ranked.filter((x) => x.root !== root).slice(0, 2).map((x) => L.NAMES[x.root] + ' ' + Math.round(x.score * 100) + '%').join(', ')})`);

  // the parts: tidied audio, her tune as notes, the bars where the band can answer
  const seedPhrases = [], samples = {};
  sections.forEach((sec, k) => {
    sec.name = 'sing' + (k + 1); sec.sample = id + '-s' + (k + 1);
    const audio = T.retime(data, sec.phrases, sec.starts, { seconds: sec.bars * BAR + PRE + 0.6 });
    S.polishVoice(audio); T.level(audio, -15);
    fs.writeFileSync(rel('sounds', sec.sample + '.wav'), Buffer.from(S.encodeWav({ sampleRate: S.SR, left: audio })));
    samples[sec.sample] = audio;
    sec.tune = T.notesToLane(sec.phrases, sec.starts, { bpm, steps: sec.bars * 16, tuning, origin: PRE, scale: scale7 });
    sec.freeFrom = Math.min(sec.bars, Math.ceil(sec.end / BAR + 0.1));
    sec.phrases.forEach((p, i) => seedPhrases.push({ phrase: p.index, sungAt: +p.t.toFixed(2), seconds: +p.dur.toFixed(2), part: sec.name, bar: +((sec.starts[i] - PRE) / BAR + 1).toFixed(2),
      notes: p.notes.filter((n) => n.dur >= 0.15).map((n) => L.noteName(n.midi - tuning / 100)).join(' ') }));
    const names = H.pick.colours[k].map((c) => L.NAMES[root] + c[0]);
    log(`  ${sec.name}: phrases ${sec.phrases[0].index}-${sec.phrases[sec.phrases.length - 1].index}, ${sec.bars} bars, sung until bar ${(sec.end / BAR + 1).toFixed(1)}: ${names.join(' | ')}`);
  });

  // a little tune of her own to pass around the band: the first clear notes she sang
  const allowed = scale7.map(pcOf), snap = (m) => { let best = Math.round(m), d = 9; for (let n = Math.floor(m) - 2; n <= Math.ceil(m) + 2; n++) if (allowed.includes(L.mod(n)) && Math.abs(n - m) < d) { d = Math.abs(n - m); best = n; } return best; };
  const time = new Array(12).fill(0);
  for (const n of P.notes) if (n.dur >= 0.12) time[L.mod(snap(n.midi - tuning / 100))] += n.dur;
  const top = allowed.slice().sort((x, y) => time[y] - time[x]), main = top[0];
  // the three scale notes she sings most, in rising order around the one she sings most of all
  let first = top.slice(0, 3).map((pc) => { let m = 60 + pc; if (m - (60 + main) > 6) m -= 12; if ((60 + main) - m > 6) m += 12; return m; }).sort((x, y) => x - y);
  if (first[2] - first[0] > 7) first = [snap(60 + main - 2), 60 + main, snap(60 + main + 2)];
  const lift = Math.round((76 - first[1]) / 12) * 12, [a, b, c] = first.map((m) => nameAt(m + lift));
  const motif = [`${a} - ${b} - ${c} - - - - - - - . . . .`, `${c} - ${b} - ${a} - - - - - - - . . . .`, `${c} - ${b} - ${nameAt(atOrAbove(L.mod(root + 7), 67))} - - - - - - - . . . .`];
  log(`  the notes she sings most, used as the song's little tune: ${a} ${b} ${c}`);

  // her own voice as the choir
  const st = steadiest(data), instruments = {
    'voice-tune': { emoji: '🎼', label: 'The sung tune as notes', wave: 'triangle', voices: 2, detune: 6, octave: 1, env: { a: 0.005, d: 0.25, s: 0.3, r: 0.2 }, gain: 0.2 },
  };
  const hasChoir = !!st && st.sd < 0.2;
  if (hasChoir) {
    const from = Math.max(0, st.t0 - 0.2), ah = data.slice(Math.round(from * S.SR), Math.round((st.t1 + 0.3) * S.SR));
    let pk = 0; for (const v of ah) pk = Math.max(pk, Math.abs(v));
    for (let i = 0; i < ah.length; i++) ah[i] *= 0.9 / pk * Math.min(1, i / 400, (ah.length - 1 - i) / 2000);
    fs.writeFileSync(rel('sounds', id + '-ah.wav'), Buffer.from(S.encodeWav({ sampleRate: S.SR, left: ah })));
    samples[id + '-ah'] = ah;
    instruments['voice-choir'] = { emoji: '🧚', label: 'Choir made of the singer', sample: id + '-ah', pitched: true, rootHz: +(440 * Math.pow(2, (st.midi - 69) / 12)).toFixed(2),
      grain: { from: +(st.t0 - from).toFixed(3), to: +(st.t1 - from + 0.04).toFixed(3), size: 0.16 }, env: { a: 0.08, d: 0.3, s: 0.9, r: 0.9 }, gain: 0.5 };
    log(`  choir frozen from her note at ${st.t0.toFixed(1)}s (${L.noteName(st.midi)}, wobble ${st.sd.toFixed(2)} semitones)`);
  } else log('  no note steady enough to freeze into a choir: using the built-in one');
  sections.forEach((sec) => { instruments[sec.sample] = { emoji: '🎙️', label: 'singing ' + sec.name.slice(4), sample: sec.sample, pitched: false, vocal: true, gain: 1.4, offset: -PRE }; });

  const parts = arrange({ sections, root, colours: H.pick.colours, home: H.home, motif, hasChoir });
  const song = {
    title: old.title, artist: old.artist || '', bpm, key: `${L.NAMES[root]} drone, ${H.minor ? 'minor' : 'major'} leaning`, scale: scale5, tuning, stepsPerBeat: 4, reverb: 0.28,
    style: 'Free-time singing over a held drone: one inner voice follows what is sung, the beat is made of small sounds, and the choir is the singer\'s own voice.',
    instruments, parts, arrangement: ['intro', ...sections.map((s) => s.name), 'outro'],
    seed: Object.assign({}, old.seed, { grown: true, bpm, key: L.NAMES[root] + ' drone', tuning, drone: { root: L.NAMES[root], holds: +Math.min(1, H.pick.score).toFixed(2) },
      chords: Object.fromEntries(sections.map((s, k) => [s.name, H.pick.colours[k].map((c) => L.NAMES[root] + c[0]).join(' ')])), motif: [a, b, c].join(' '), phrases: seedPhrases }),
  };
  for (const [name, p] of Object.entries(old.parts)) if (p.lyrics && song.parts[name]) song.parts[name].lyrics = p.lyrics;
  const report = balance(song, samples, sections.map((s) => s.name), 8);
  report.forEach((r) => log(`  ${r.name}: voice over band in the voice range ${r.before} dB${r.after !== r.before ? ' -> ' + r.after + ' dB' : ''}`));
  fs.mkdirSync(rel('out'), { recursive: true });
  fs.writeFileSync(rel('out', id + '-before-grow.json'), JSON.stringify(old, null, 2) + '\n');
  fs.writeFileSync(file, JSON.stringify(song, null, 2) + '\n');
  return song;
}

module.exports = { grow, sectionsOf, harmonise, steadiest, arrange, balance };

if (require.main === module) {
  const args = process.argv.slice(2), flags = {}, rest = [];
  for (let i = 0; i < args.length; i++) { if (args[i].startsWith('--')) { const k = args[i].slice(2); flags[k] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true; } else rest.push(args[i]); }
  if (!rest[0]) { console.error('usage: node tools/grow.js <song-name> [--bpm 100] [--root A] [--again]'); process.exit(1); }
  try { const song = grow(rest[0], Object.assign({ log: console.log }, flags)); console.log(`✓ songs/${rest[0]}.json: ${song.arrangement.join(' > ')}`); }
  catch (e) { console.error('✖ ' + e.message); process.exit(1); }
}
