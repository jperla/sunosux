// Built-in instruments. Each one is just a recipe (plain data) that the engine
// turns into sound. Copy one, change a number, give it a new name: new instrument!
// See the recipe fields documented in src/engine.js (renderTone / renderDrum).
(function (root) {
  'use strict';

  const instruments = {
    // ---- drums ----
    kick:  { emoji: '🥁', label: 'Boom Kick',   kind: 'kick',  decay: 0.45, gain: 1.0 },
    snare: { emoji: '💥', label: 'Snap Snare',  kind: 'snare', decay: 0.25, gain: 0.55 },
    clap:  { emoji: '👏', label: 'Big Clap',    kind: 'clap',  decay: 0.3,  gain: 0.6, pan: 0.1 },
    hat:   { emoji: '✨', label: 'Tiny Hat',    kind: 'hat',   decay: 0.08, gain: 0.35, pan: 0.25 },
    tom:   { emoji: '🪘', label: 'Thump Tom',   kind: 'tom',   decay: 0.3,  gain: 0.7, pan: -0.2 },
    zap:   { emoji: '⚡', label: 'Hunter Zap',  kind: 'zap',   decay: 0.25, gain: 0.35, pan: -0.3 },

    // ---- melodic ----
    bass: {
      emoji: '🐉', label: 'Dragon Bass',
      wave: 'saw', voices: 1, octave: 0, sub: 0.8,
      env: { a: 0.005, d: 0.15, s: 0.6, r: 0.08 },
      filter: { cutoff: 500, q: 1.2, envAmount: 2.5 }, gain: 0.45,
    },
    sparkle: {
      emoji: '🌟', label: 'Star Sparkle',
      wave: 'triangle', voices: 2, detune: 8, octave: 1,
      env: { a: 0.002, d: 0.25, s: 0.0, r: 0.3 }, gain: 0.22, pan: 0.3,
    },
    lead: {
      emoji: '🎤', label: 'Pop Star Lead',
      wave: 'saw', voices: 3, detune: 14,
      env: { a: 0.01, d: 0.2, s: 0.75, r: 0.15 },
      filter: { cutoff: 2600, q: 1.0, envAmount: 1.0 },
      vibrato: { rate: 5.5, depth: 0.12 }, gain: 0.26,
    },
    supersaw: {
      emoji: '🗡️', label: 'Sword Synth',
      wave: 'saw', voices: 7, detune: 30,
      env: { a: 0.01, d: 0.3, s: 0.6, r: 0.25 },
      filter: { cutoff: 3200, q: 0.8, envAmount: 0.6 }, gain: 0.22,
    },
    pad: {
      emoji: '🌙', label: 'Moon Pad',
      wave: 'saw', voices: 5, detune: 22,
      env: { a: 0.4, d: 0.5, s: 0.8, r: 0.9 },
      filter: { cutoff: 1100, q: 0.7 }, gain: 0.16, legato: 1.0,
    },
    bell: {
      emoji: '🔔', label: 'Magic Bell',
      wave: 'sine', voices: 2, detune: 1200, octave: 1,
      env: { a: 0.001, d: 0.6, s: 0.0, r: 0.6 }, gain: 0.2, pan: -0.25,
    },
    choir: {
      emoji: '👑', label: 'Crown Choir',
      wave: 'triangle', voices: 4, detune: 18, noise: 0.03,
      env: { a: 0.15, d: 0.3, s: 0.85, r: 0.5 },
      filter: { cutoff: 1800, q: 2.0 },
      vibrato: { rate: 4.8, depth: 0.08 }, gain: 0.2, legato: 1.0,
    },
  };

  root.SunosuxInstruments = instruments;
  if (typeof module !== 'undefined' && module.exports) module.exports = instruments;
})(typeof globalThis !== 'undefined' ? globalThis : this);
