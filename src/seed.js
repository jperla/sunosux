// sunosux seed: start a song from a bit of singing.
//
//   analyze(piece)  listens to a recording and works out how many bars it is,
//                   the tempo that makes it fit, how sharp or flat the singer is,
//                   the key, the tune as notes, and a chord for every bar.
//   build(analysis) writes a whole first-draft song around it: the recording is
//                   the hook, with a band, an intro that plays the tune, a verse
//                   to sing over next, and an outro.
//
// Pure functions, so the page and the command line build the same song.
// The draft is a starting point: every lane it writes is ordinary song data
// that people (and Claude) keep changing.
(function (root) {
  'use strict';
  const S = root.Sunosux || require('./engine.js');
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  // how strongly each note of the scale "belongs" in a major or minor key (Krumhansl and Kessler)
  const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  // chords worth trying in a key: [semitones above the tonic, is it minor, how common it is]
  const CHORDS = {
    major: [[0, false, 0.12], [5, false, 0.08], [7, false, 0.08], [9, true, 0.08], [2, true, 0.03], [4, true, 0.01]],
    minor: [[0, true, 0.12], [8, false, 0.08], [10, false, 0.08], [3, false, 0.06], [5, true, 0.05], [7, true, 0.03]],
  };
  // what a pop song does when the singer gives no clue
  const USUAL = { major: [0, 7, 9, 5], minor: [0, 8, 3, 10] };
  const mod = (n) => ((n % 12) + 12) % 12;
  const midiName = (m) => NAMES[mod(m)] + (Math.floor(m / 12) - 1);

  // How many bars a piece of this length most likely is: the count that gives a singable tempo.
  function guessBars(seconds) {
    let bars = 1;
    while (bars * 240 / seconds < 76 && bars < 32) bars *= 2;
    return bars;
  }

  function correlate(hist, profile, tonic) {
    let mh = 0, mp = 0;
    for (let i = 0; i < 12; i++) { mh += hist[i] / 12; mp += profile[i] / 12; }
    let num = 0, dh = 0, dp = 0;
    for (let i = 0; i < 12; i++) { const a = hist[mod(i + tonic)] - mh, b = profile[i] - mp; num += a * b; dh += a * a; dp += b * b; }
    return dh && dp ? num / Math.sqrt(dh * dp) : 0;
  }

  // opts: { bars } to say how many bars the piece is instead of guessing
  function analyze(data, opts) {
    opts = opts || {};
    const seconds = data.length / S.SR;
    const bars = opts.bars || guessBars(seconds);
    const bpm = +(bars * 240 / seconds).toFixed(3); // the tempo at which the piece is exactly that many bars
    const pitch = S.pitchFrames(data);
    const voiced = pitch.frames.filter((f) => f.midi != null && f.rms > pitch.maxRms * 0.15);

    // nobody sings exactly at concert pitch: find how far off, so the band can move to the singer
    let sx = 0, sy = 0;
    voiced.forEach((f) => { const a = 2 * Math.PI * (f.midi - Math.round(f.midi)); sx += Math.cos(a); sy += Math.sin(a); });
    const tuning = voiced.length ? Math.round(Math.atan2(sy, sx) / (2 * Math.PI) * 100) : 0;
    const pc = (f) => mod(Math.round(f.midi - tuning / 100));

    // which notes were sung, and for how long -> the key
    const hist = new Array(12).fill(0);
    voiced.forEach((f) => { hist[pc(f)]++; });
    let tonic = 9, mode = 'minor', best = -2;
    if (voiced.length) for (let t = 0; t < 12; t++) for (const [m, profile] of [['major', MAJOR], ['minor', MINOR]]) {
      const c = correlate(hist, profile, t);
      if (c > best) { best = c; tonic = t; mode = m; }
    }
    const seven = (mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10]).map((i) => NAMES[mod(tonic + i)]);
    const five = (mode === 'major' ? [0, 2, 4, 7, 9] : [0, 3, 5, 7, 10]).map((i) => NAMES[mod(tonic + i)]);

    // the tune, written on the beat grid
    const tune = S.detectMelody(data, { pitch, bpm, stepsPerBeat: 4, steps: bars * 16, grid: 2, origin: 0, tuning, scale: seven });
    const melody = tune.lane || Array(bars).fill(Array(16).fill('.').join(' ')).join(' | ');

    // a chord for every bar: the one that holds most of what was sung in that bar
    const barSec = seconds / bars, chordData = [];
    for (let b = 0; b < bars; b++) {
      const inBar = voiced.filter((f) => f.t >= b * barSec && f.t < (b + 1) * barSec);
      let pick = null, top = -1;
      for (const [deg, minor, common] of CHORDS[mode]) {
        const rootPc = mod(tonic + deg), tones = [rootPc, mod(rootPc + (minor ? 3 : 4)), mod(rootPc + 7)];
        const fits = inBar.length ? inBar.filter((f) => tones.includes(pc(f))).length / inBar.length : 0;
        const score = fits + common + (deg === USUAL[mode][b % 4] ? 0.08 : 0) + (b === 0 && deg === 0 ? 0.1 : 0);
        if (score > top) { top = score; pick = { root: rootPc, minor, name: NAMES[rootPc] + (minor ? 'm' : '') }; }
      }
      chordData.push(pick);
    }
    return { seconds: +seconds.toFixed(3), bars, bpm, tuning, tonic, mode, key: NAMES[tonic] + ' ' + mode, scale: five, fullScale: seven,
      melody, notes: tune.notes, sung: +(voiced.length / Math.max(1, pitch.frames.length)).toFixed(2), chords: chordData.map((c) => c.name), chordData };
  }

  // opts: { title, lyrics, sample (the recording's name in sounds/), recording (the full take), from, to }
  function build(a, opts) {
    opts = opts || {};
    const B = a.bars, half = Math.max(1, B >> 1), sample = opts.sample || 'hook';
    const place = (pcl, lo) => { let m = pcl; while (m < lo) m += 12; return m; };
    const triad = (c, lo) => { const r = place(c.root, lo); return [r, r + (c.minor ? 3 : 4), r + 7]; };
    const bars = (fn, n) => a.chordData.slice(0, n || B).map(fn).join(' | ');
    const every = (bar, n) => Array(n || B).fill(bar).join('|');

    const bass = (n) => bars((c) => { const r = midiName(place(c.root, 33)), u = midiName(place(c.root, 33) + 12); return `${r} - ${r} - ${u} . ${r} - ${r} - ${r} . ${u} - ${r} .`; }, n);
    const calm = (n) => bars((c) => { const r = midiName(place(c.root, 33)); return `${r} - - - - - - - ${r} - - - - - - .`; }, n);
    const pad = (n) => bars((c) => [triad(c, 48).map(midiName).join('+')].concat(Array(15).fill('-')).join(' '), n);
    const arp = (n) => bars((c) => { const [x, y, z] = triad(c, 60).map(midiName); return `${x} . ${y} . ${z} . ${y} . ${x} . ${y} . ${z} . ${y} .`; }, n);
    const tuneBars = a.melody.split(' | ');
    const tune = (n) => tuneBars.slice(0, n || B).join(' | ');
    const hasTune = a.notes > 0;

    const parts = {
      intro: { emoji: '🌙', color: '#7b5cff', bars: half, lyrics: '',
        tracks: [{ instrument: 'pad', lane: pad(half) }, hasTune ? { instrument: 'bell', lane: tune(half) } : { instrument: 'sparkle', lane: arp(half), gain: 0.7 }] },
      hook: { emoji: '🌟', color: '#ff4fa3', bars: B, lyrics: opts.lyrics || '',
        tracks: [
          { instrument: sample, lane: 'X' + '.'.repeat(15) + ('|' + '.'.repeat(16)).repeat(B - 1) },
          { instrument: 'kick', lane: every('x...x...x...x...') },
          { instrument: 'clap', lane: every('....x.......x...') },
          { instrument: 'hat', lane: every('..x...x...x...x.') },
          { instrument: 'bass', lane: bass(), gain: 0.9 },
          { instrument: 'pad', lane: pad(), gain: 0.7 },
          { instrument: 'sparkle', lane: arp(), gain: 0.45 }] },
      verse: { emoji: '🎵', color: '#00b3a4', bars: B, lyrics: '',
        tracks: [
          { instrument: 'kick', lane: every('x.......x.......') },
          { instrument: 'snare', lane: every('....x.......x...') },
          { instrument: 'hat', lane: every('o.o.o.o.o.o.o.o.') },
          { instrument: 'bass', lane: calm(), gain: 0.9 },
          { instrument: 'pad', lane: pad(), gain: 0.6 }] },
      outro: { emoji: '💖', color: '#c86bfa', bars: half, lyrics: '',
        tracks: [{ instrument: 'pad', lane: pad(half) }, { instrument: hasTune ? 'bell' : 'sparkle', lane: hasTune ? tune(half) : arp(half), gain: 0.7 },
          { instrument: 'kick', lane: every('x...............', half) }] },
    };
    return {
      title: opts.title || 'Our Song', artist: '', bpm: a.bpm, key: a.key, scale: a.scale, tuning: a.tuning, stepsPerBeat: 4, reverb: 0.2,
      instruments: { [sample]: { emoji: '🎙️', label: 'our singing', sample, pitched: false, vocal: true, gain: 1, offset: 0 } },
      parts,
      arrangement: ['intro', 'hook', 'verse', 'hook', 'outro'],
      // what the song grew from: kept so the next ideas (new verses, other chords) can start from the singing again
      seed: { recording: opts.recording || null, piece: sample, from: opts.from ?? null, to: opts.to ?? null, seconds: a.seconds, bars: B, bpm: a.bpm,
        key: a.key, tuning: a.tuning, chords: a.chords, melody: a.melody, lyrics: opts.lyrics || '' },
    };
  }

  const api = { analyze, build, guessBars };
  (root.Sunosux || {}).Seed = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
