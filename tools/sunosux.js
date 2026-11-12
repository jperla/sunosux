#!/usr/bin/env node
// sunosux command line: the tools for making sounds, pieces, songs and interfaces.
// No dependencies. Run `node tools/sunosux.js help`.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
global.SunosuxInstruments = require('../src/instruments.js');
const S = require('../src/engine.js');
const Seed = require('../src/seed.js');
const rel = (...p) => path.join(ROOT, ...p);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------- args ----------
const argv = process.argv.slice(2);
const cmd = argv[0] || 'help';
const flags = {}, rest = [];
for (let i = 1; i < argv.length; i++) {
  if (argv[i].startsWith('--')) { const k = argv[i].slice(2); flags[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
  else if (argv[i] === '-o') flags.o = argv[++i];
  else rest.push(argv[i]);
}

// ---------- songs ----------
function songPath(name) {
  if (!name) { const all = listSongs(); if (all.length === 1) return rel('songs', all[0] + '.json'); die('which song? one of: ' + all.join(', ')); }
  if (fs.existsSync(name)) return path.resolve(name);
  const p = rel('songs', name.replace(/\.json$/, '') + '.json');
  if (!fs.existsSync(p)) die('no song at ' + p);
  return p;
}
const listSongs = () => fs.readdirSync(rel('songs')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
const loadSong = (name) => JSON.parse(fs.readFileSync(songPath(name), 'utf8'));
function loadSamples(song) {
  const samples = {};
  for (const r of Object.values(song.instruments || {})) {
    if (!r.sample || samples[r.sample]) continue;
    const p = rel('sounds', r.sample + '.wav');
    if (fs.existsSync(p)) { const b = fs.readFileSync(p); samples[r.sample] = S.decodeWav(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
  }
  return samples;
}
function die(msg) { console.error('✖ ' + msg); process.exit(1); }

// Everything that can be wrong with a song, as plain sentences.
function checkSong(song, warnings = []) {
  const errors = [], inst = Object.assign({}, global.SunosuxInstruments, song.instruments || {});
  if (!(song.bpm > 30 && song.bpm < 300)) errors.push('bpm should be a number between 30 and 300');
  if (!song.parts || !Object.keys(song.parts).length) errors.push('the song has no parts');
  const spb = (song.stepsPerBeat || 4) * 4;
  for (const [name, part] of Object.entries(song.parts || {})) {
    const want = (part.bars || 1) * spb;
    (part.tracks || []).forEach((tr, i) => {
      const where = `part "${name}" lane ${i + 1} (${tr.instrument})`;
      const recipe = inst[tr.instrument];
      if (!recipe) return errors.push(`${where}: no instrument called "${tr.instrument}"`);
      if (recipe.sample && !fs.existsSync(rel('sounds', recipe.sample + '.wav'))) warnings.push(`${where}: recording sounds/${recipe.sample}.wav is not on this computer, so it will be silent`);
      try {
        const lane = S.parseLane(tr.lane);
        lane.events.forEach((e) => (e.notes || []).forEach(S.noteToMidi));
        if (lane.steps !== want) errors.push(`${where}: has ${lane.steps} steps but ${part.bars || 1} bars need ${want}`);
      } catch (e) { errors.push(`${where}: ${e.message}`); }
    });
  }
  (song.arrangement || []).forEach((n) => { if (!song.parts[n]) errors.push(`arrangement uses "${n}" but there is no part with that name`); });
  if (!(song.arrangement || []).length) errors.push('the arrangement is empty');
  return errors;
}

// ---------- commands ----------
const commands = {
  help() {
    console.log(`sunosux: make songs out of parts

  dev [--port 4747]                 the live studio: hot reload, autosave to songs/ and sounds/, wish inbox
  check [song]                      find mistakes in a song (or all songs) before anyone hears them
  render [song] [-o out.wav]        song -> WAV   (--part chorus renders one piece)
  sound <instrument> [-o out.wav]   one instrument -> WAV, to hear a recipe   (--note C5 --song name)
  list                              songs, pieces, instruments, recordings, bricks, interfaces
  new-song <name>                   start an empty song (--bpm 110)
  new-interface <name>              start a page from bricks (--bricks stage,pads,wish --kid --song name)
  seed <recording> --title "Name"   grow a new song from a bit of singing (--start 2.5 --end 9 --bars 4 --lyrics "…")
  grow <song>                       tidy a seed song's singing onto the beat and arrange a band around it (--bpm 100 --root A)
  listen <song-or-wav>              print every sung note, the phrases, tuning, key and a bar-by-bar chord table
  wishes                            show wishes waiting in wishes/inbox.md
  test                              check every song and the hum catcher

Agent hook: SUNOSUX_AGENT='<command that reads a prompt on stdin>' npm run dev
runs that command for each wish (for example a coding agent CLI in non-interactive mode).`);
  },

  check() {
    const names = rest.length ? rest : listSongs();
    let bad = 0;
    for (const n of names) {
      const warnings = [], song = loadSong(n), errors = checkSong(song, warnings);
      [...new Set(warnings)].forEach((w) => console.log('⚠ ' + w));
      if (errors.length) { bad++; console.log(`✖ ${n}`); errors.forEach((e) => console.log('   ' + e)); }
      else {
        const tl = S.songTimeline(song), secs = tl.reduce((a, b) => a + b.duration, 0);
        console.log(`✓ ${n}: "${song.title}" ${song.bpm} bpm, ${Object.keys(song.parts).length} parts, ${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}`);
      }
    }
    if (bad) process.exit(1);
  },

  render() {
    const p = songPath(rest[0]), song = JSON.parse(fs.readFileSync(p, 'utf8'));
    const errors = checkSong(song);
    if (errors.length) die('fix these first:\n   ' + errors.join('\n   '));
    if (flags.part) { if (!song.parts[flags.part]) die('no part called ' + flags.part); song.arrangement = [flags.part]; }
    const out = flags.o || rel('out', path.basename(p, '.json') + (flags.part ? '-' + flags.part : '') + '.wav');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const t = Date.now(), audio = S.render(song, { samples: loadSamples(song) });
    fs.writeFileSync(out, Buffer.from(S.encodeWav(audio)));
    console.log(`✓ ${path.relative(process.cwd(), out)}  ${audio.duration.toFixed(1)}s  (rendered in ${Date.now() - t} ms)`);
  },

  sound() {
    const key = rest[0] || die('which instrument? try: node tools/sunosux.js list');
    const song = flags.song ? loadSong(flags.song) : { instruments: {} };
    const recipe = Object.assign({}, global.SunosuxInstruments, song.instruments || {})[key] || die('no instrument called ' + key);
    // a little phrase so you can hear how it plays, not just one note
    const drum = recipe.kind || (recipe.sample && !recipe.pitched);
    const demo = { bpm: 110, reverb: 0.15, instruments: song.instruments, arrangement: ['a'],
      parts: { a: { bars: 1, tracks: [{ instrument: key, lane: drum ? 'x...x...x.x.x...' : (flags.note ? `${flags.note} - - - - - - - . . . . . . . .` : 'A4 - C5 - E5 - A5 - - - E5 - C5 - - .') }] } } };
    const out = flags.o || rel('out', 'sound-' + key + '.wav');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(S.encodeWav(S.render(demo, { samples: loadSamples(song) }))));
    console.log('✓ ' + path.relative(process.cwd(), out));
  },

  list() {
    console.log('songs:');
    for (const n of listSongs()) { const s = loadSong(n); console.log(`  ${n}  "${s.title}"  parts: ${Object.keys(s.parts).join(', ')}`); }
    console.log('built-in instruments:');
    for (const [k, r] of Object.entries(global.SunosuxInstruments)) console.log(`  ${r.emoji || ' '} ${k.padEnd(10)} ${r.label || ''}`);
    for (const n of listSongs()) { const own = Object.entries(loadSong(n).instruments || {}); if (own.length) { console.log(`instruments in ${n}:`); own.forEach(([k, r]) => console.log(`  ${r.emoji || ' '} ${k.padEnd(10)} ${r.label || ''}${r.sample ? '  (recording ' + r.sample + '.wav)' : ''}`)); } }
    console.log('recordings: ' + (fs.readdirSync(rel('sounds')).filter((f) => f.endsWith('.wav')).join(', ') || '(none yet)'));
    console.log('bricks: ' + bricks().map((b) => `${b.name} (${b.file})`).join(', '));
    console.log('interfaces: ' + fs.readdirSync(rel('interfaces')).filter((d) => fs.existsSync(rel('interfaces', d, 'index.html'))).join(', '));
  },

  'new-song'() {
    const name = slug(rest[0] || die('give the song a name')), p = rel('songs', name + '.json');
    if (fs.existsSync(p)) die(p + ' already exists');
    const song = { title: rest[0], artist: '', bpm: +flags.bpm || 110, stepsPerBeat: 4, scale: ['A', 'C', 'D', 'E', 'G'], reverb: 0.18, instruments: {},
      parts: { beat: { emoji: '🥁', color: '#ff4fa3', bars: 2, lyrics: '', tracks: [
        { instrument: 'kick', lane: 'x...x...x...x...|x...x...x...x...' },
        { instrument: 'clap', lane: '....x.......x...|....x.......x...' },
        { instrument: 'lead', lane: '. . . . . . . . . . . . . . . . | . . . . . . . . . . . . . . . .' }] } },
      arrangement: ['beat', 'beat'] };
    fs.writeFileSync(p, JSON.stringify(song, null, 2) + '\n');
    console.log(`✓ songs/${name}.json   open it with  interfaces/studio/?song=${name}`);
  },

  'new-interface'() {
    const name = slug(rest[0] || die('give the interface a name')), dir = rel('interfaces', name);
    if (fs.existsSync(dir)) die(dir + ' already exists');
    const wanted = String(flags.bricks || 'stage,timeline,parts,pads,wish').split(',').map((s) => s.trim()).filter(Boolean);
    const known = bricks(), files = new Set();
    for (const b of wanted) { const hit = known.find((k) => k.name === b); if (!hit) die(`no brick called "${b}". There are: ${known.map((k) => k.name).join(', ')}`); files.add(hit.file); }
    const song = flags.song || listSongs()[0];
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${rest[0]}</title>
<link rel="stylesheet" href="../../src/kit.css">
</head>
<body${flags.kid ? ' class="kid"' : ''}>
<script type="application/json" id="song" data-src="../../songs/${song}.json"></script>
<main>
${wanted.map((b) => `  <div data-kit="${b}"></div>`).join('\n')}
</main>
<script src="../../src/engine.js"></script>
<script src="../../src/instruments.js"></script>
<script src="../../src/kit.js"></script>
${[...files].map((f) => `<script src="../../${f}"></script>`).join('\n')}
<script>Sunosux.Kit.boot();</script>
</body>
</html>
`;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    const home = rel('index.html');
    if (fs.existsSync(home)) {
      const marker = '<!-- new interfaces go here -->';
      fs.writeFileSync(home, fs.readFileSync(home, 'utf8').replace(marker, `<a class="sx-card-link" href="interfaces/${name}/">🧱 ${rest[0]}</a>\n  ${marker}`));
    }
    console.log(`✓ interfaces/${name}/index.html  with bricks: ${wanted.join(', ')}`);
  },

  // Grow a song from a recording. Any audio file works if ffmpeg is installed; WAV always works.
  seed() {
    const file = rest[0] || die('give me a recording: node tools/sunosux.js seed singing.wav --title "Our Song"');
    if (!fs.existsSync(file)) die('no file at ' + file);
    let wavPath = file;
    if (path.extname(file).toLowerCase() !== '.wav') {
      wavPath = rel('out', 'seed-in.wav');
      fs.mkdirSync(rel('out'), { recursive: true });
      const r = require('child_process').spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', file, '-ac', '1', '-ar', String(S.SR), wavPath]);
      if (r.status !== 0) die('could not read that file. Convert it to WAV first (ffmpeg is needed for other formats).');
    }
    const buf = fs.readFileSync(wavPath), data = S.decodeWav(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const from = +flags.start || 0, to = flags.end ? +flags.end : data.length / S.SR;
    const piece = data.slice(Math.round(from * S.SR), Math.round(to * S.SR));
    if (piece.length < S.SR / 2) die('that piece is shorter than half a second');
    const name = flags.title && flags.title !== true ? flags.title : path.basename(file, path.extname(file));
    const id = slug(name);
    if (fs.existsSync(rel('songs', id + '.json')) && !flags.force) die(`songs/${id}.json already exists (pick another --title, or add --force)`);
    const a = Seed.analyze(piece, { bars: +flags.bars || undefined });
    const voice = piece.slice();
    S.polishVoice(voice);
    fs.writeFileSync(rel('sounds', id + '-hook.wav'), Buffer.from(S.encodeWav({ sampleRate: S.SR, left: voice })));
    fs.writeFileSync(rel('sounds', id + '-full.wav'), Buffer.from(S.encodeWav({ sampleRate: S.SR, left: data })));
    const song = Seed.build(a, { title: name, lyrics: flags.lyrics && flags.lyrics !== true ? flags.lyrics : '', sample: id + '-hook', recording: id + '-full', from, to: +to.toFixed(3) });
    fs.writeFileSync(rel('songs', id + '.json'), JSON.stringify(song, null, 2) + '\n');
    console.log(`✓ songs/${id}.json grown from ${a.seconds}s of singing`);
    console.log(`  ${a.bars} bars at ${a.bpm} bpm, key ${a.key}, singer is ${Math.abs(a.tuning)} cents ${a.tuning < 0 ? 'flat' : 'sharp'} (the band follows), pitch found in ${Math.round(a.sung * 100)}% of it`);
    console.log('  chords: ' + a.chords.join(' | '));
    console.log('  tune:   ' + a.melody);
    console.log(`  open http://localhost:4747/interfaces/stage/?song=${id}`);
  },

  grow() {
    const id = rest[0] || die('which song? node tools/sunosux.js grow <song-name>');
    try { const song = require('./grow.js').grow(id.replace(/\.json$/, ''), Object.assign({ log: console.log }, flags)); console.log(`✓ songs/${id}.json: ${song.arrangement.join(' > ')}`); }
    catch (e) { die(e.message); }
  },

  listen() {
    const r = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'listen.js'), ...process.argv.slice(3)], { stdio: 'inherit' });
    process.exit(r.status || 0);
  },

  wishes() {
    const p = rel('wishes', 'inbox.md');
    console.log(fs.existsSync(p) && fs.readFileSync(p, 'utf8').trim() ? fs.readFileSync(p, 'utf8') : 'no wishes waiting ⭐');
  },

  test() {
    commands.check();
    for (const n of listSongs()) { const song = loadSong(n), a = S.render(song, { samples: loadSamples(song) }); for (const v of a.left) if (!Number.isFinite(v)) die(n + ' rendered a broken sample'); console.log(`✓ ${n} renders ${a.duration.toFixed(1)}s, ${a.hits.length} notes`); }
    const hum = [];
    let ph = 0;
    for (const [f, d] of [[220, 0.5], [261.63, 0.5], [0, 0.25], [329.63, 0.5]]) for (let i = 0; i < d * S.SR; i++) { ph += f / S.SR; hum.push(f ? 0.5 * Math.sin(2 * Math.PI * ph) + 0.2 * Math.sin(4 * Math.PI * ph) : 0); }
    const got = S.detectMelody(Float32Array.from(hum), { bpm: 120, steps: 16 }).lane, want = 'A4 - - - C5 - - - . . E5 - - - . .';
    if (got !== want) die(`hum catcher heard "${got}", expected "${want}"`);
    console.log('✓ hum catcher hears A, C, rest, E');
    const wav = S.decodeWav(S.encodeWav({ sampleRate: S.SR, left: Float32Array.from(hum), right: Float32Array.from(hum) }));
    if (wav.length !== hum.length) die('WAV round trip changed the length');
    console.log('✓ WAV write and read agree');
    // a pretend singer: G major tune, 20 cents sharp, 2 bars at 100 bpm
    const sung = [];
    let p2 = 0, n2 = 0;
    for (const [note, beats] of [['G3', 2], ['B3', 1], ['D4', 1], ['C4', 2], ['E4', 1], ['C4', 1]]) {
      const len = Math.round(beats * 0.6 * S.SR), f0 = S.noteToFreq(note) * Math.pow(2, 20 / 1200);
      for (let i = 0; i < len; i++, n2++) { p2 += f0 * Math.pow(2, 0.3 * Math.sin(2 * Math.PI * 5.5 * n2 / S.SR) / 12) / S.SR; sung.push(i > len - 1800 ? 0 : Math.min(1, i / 1500) * (0.5 * Math.sin(2 * Math.PI * p2) + 0.25 * Math.sin(4 * Math.PI * p2))); }
    }
    const an = Seed.analyze(Float32Array.from(sung));
    const tuneWant = 'G4 - - - - - - - B4 - - - D5 - - - | C5 - - - - - - - E5 - - - C5 - - -';
    if (an.bars !== 2 || Math.abs(an.bpm - 100) > 0.5) die(`seed: expected 2 bars at 100 bpm, got ${an.bars} at ${an.bpm}`);
    if (Math.abs(an.tuning - 20) > 6) die(`seed: expected the singer about 20 cents sharp, got ${an.tuning}`);
    if (an.melody !== tuneWant) die(`seed: heard "${an.melody}"`);
    if (an.chords.join(' ') !== 'G C') die(`seed: expected chords G C, got ${an.chords.join(' ')}`);
    const grown = Seed.build(an, { title: 'T', sample: 'hook' }), problems = checkSong(grown, []);
    if (problems.length) die('seed: the grown song has mistakes: ' + problems.join('; '));
    console.log(`✓ song seed: 2 bars at ${an.bpm} bpm, ${an.tuning} cents sharp, chords ${an.chords.join(' ')}, and the grown song checks out`);
  },

  dev() { devServer(+flags.port || +process.env.PORT || 4747); },
};

const H_title = (name) => { try { return loadSong(name).title || name; } catch (e) { return name; } };

function bricks() {
  const out = [];
  for (const f of fs.readdirSync(rel('bricks')).filter((x) => x.endsWith('.js'))) {
    const text = fs.readFileSync(rel('bricks', f), 'utf8');
    for (const m of text.matchAll(/(?:components|C)\.(\w+)\s*=\s*\(/g)) out.push({ name: m[1], file: 'bricks/' + f });
  }
  return out;
}

// ---------- the live studio ----------
function devServer(port) {
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wav': 'audio/wav', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/plain; charset=utf-8' };
  const clients = new Set();
  const send = (event, data) => clients.forEach((res) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  const agent = process.env.SUNOSUX_AGENT || '';
  const queue = [];
  let working = false;

  // files changed on disk -> tell every open page
  const pending = new Map();
  fs.watch(ROOT, { recursive: true }, (_, file) => {
    if (!file) return;
    const p = file.split(path.sep).join('/');
    if (/^(\.git|node_modules|out|wishes)\//.test(p) || /(^|\/)\.|~$|\.tmp$/.test(p)) return;
    clearTimeout(pending.get(p));
    pending.set(p, setTimeout(() => { pending.delete(p); send('change', { path: p }); }, 80));
  });

  function grantNext() {
    if (working || !queue.length || !agent) return;
    working = true;
    const wish = queue.shift();
    send('wish', { text: wish.text, status: 'working' });
    const prompt = `You are the song-making helper for this repo. Read CLAUDE.md first and follow it.\n\nGrant this wish from the studio page ${wish.interface || ''} (song file: ${wish.song || 'unknown'}, selected piece: ${wish.part || 'none'}):\n\n${wish.text}\n\nWhen it is done, move the wish from wishes/inbox.md to wishes/granted.md.\n`;
    const child = spawn(agent, { cwd: ROOT, shell: true, stdio: ['pipe', 'inherit', 'inherit'] });
    child.stdin.end(prompt);
    child.on('close', (code) => { working = false; send('wish', { text: wish.text, status: code === 0 ? 'done' : 'failed' }); grantNext(); });
    child.on('error', () => { working = false; send('wish', { text: wish.text, status: 'failed' }); grantNext(); });
  }

  const body = (req, limit) => new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const end = (code, text, headers) => { res.writeHead(code, Object.assign({ 'cache-control': 'no-store' }, headers)); res.end(text); };
    // only this computer, only this page: no other website may talk to the studio
    const host = (req.headers.host || '').replace(/:\d+$/, '');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return end(403, 'local only');
    try {
      if (url.pathname.startsWith('/api/')) {
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return end(403, 'wrong origin');
        if (url.pathname === '/api/ping') return end(200, 'ok', { 'x-sunosux': '1' });
        if (url.pathname === '/api/events') {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
          res.write('retry: 1000\n\n');
          clients.add(res);
          req.on('close', () => clients.delete(res));
          return;
        }
        if (url.pathname === '/api/songs') return end(200, JSON.stringify(listSongs().map((name) => ({ name, title: H_title(name) }))), { 'content-type': 'application/json' });
        if (req.method !== 'GET' && req.headers['x-sunosux'] !== '1') return end(403, 'missing header');
        if (url.pathname === '/api/file' && req.method === 'PUT') {
          const p = url.searchParams.get('path') || '';
          if (!/^songs\/[\w-]+\.json$/.test(p) && !/^sounds\/[\w-]+\.wav$/.test(p)) return end(400, 'only songs/*.json and sounds/*.wav can be saved');
          const data = await body(req, 30e6);
          if (p.endsWith('.json')) { const song = JSON.parse(data.toString('utf8')); if (!song.parts || !song.arrangement) return end(400, 'that is not a song'); }
          else S.decodeWav(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
          const tmp = rel(p + '.tmp');
          fs.writeFileSync(tmp, data); fs.renameSync(tmp, rel(p));
          return end(200, 'saved');
        }
        if (url.pathname === '/api/grow' && req.method === 'POST') {
          // the seed page asks for this right after saving a new song: tidy the singing and arrange a band around it
          const id = (url.searchParams.get('song') || '').replace(/[^\w-]/g, '');
          if (!id || !fs.existsSync(rel('songs', id + '.json'))) return end(404, 'no such song');
          const lines = [];
          try { require('./grow.js').grow(id, { log: (l) => lines.push(l) }); console.log('🌱 grew ' + id + '\n' + lines.join('\n')); return end(200, JSON.stringify({ ok: true, log: lines }), { 'content-type': 'application/json' }); }
          catch (e) { console.log('🌱 could not grow ' + id + ': ' + e.message); return end(200, JSON.stringify({ ok: false, error: String(e.message || e) }), { 'content-type': 'application/json' }); }
        }
        if (url.pathname === '/api/wish' && req.method === 'POST') {
          const wish = JSON.parse((await body(req, 20000)).toString('utf8'));
          const text = String(wish.text || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
          if (!text) return end(400, 'empty wish');
          const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
          const clean = (s) => String(s || '').replace(/[^\w ./-]/g, '').slice(0, 120);
          fs.mkdirSync(rel('wishes'), { recursive: true });
          fs.appendFileSync(rel('wishes', 'inbox.md'), `\n## ${stamp}\n- page: ${clean(wish.interface)}\n- song: ${clean(wish.song)}\n- piece: ${clean(wish.part)}\n\n> ${text}\n`);
          console.log('⭐ wish: ' + text);
          if (agent) { queue.push({ text, interface: clean(wish.interface), song: clean(wish.song), part: clean(wish.part) }); grantNext(); }
          return end(200, JSON.stringify({ ok: true, agent: !!agent }), { 'content-type': 'application/json' });
        }
        return end(404, 'no such api');
      }
      // plain files
      let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
      if (p.split(/[/\\]/).some((seg) => seg.startsWith('.') || seg === 'node_modules')) return end(404, 'not found');
      let file = rel(p);
      if (!file.startsWith(ROOT)) return end(404, 'not found');
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
        if (!url.pathname.endsWith('/')) return end(302, '', { location: url.pathname + '/' + url.search });
        file = path.join(file, 'index.html');
      }
      if (!fs.existsSync(file)) return end(404, 'not found');
      end(200, fs.readFileSync(file), { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    } catch (e) { end(500, String(e.message || e)); }
  });
  setInterval(() => clients.forEach((res) => res.write(': still here\n\n')), 20000);
  server.listen(port, '127.0.0.1', () => {
    console.log(`\n  🎤 sunosux studio   http://localhost:${port}/\n     for kids:        http://localhost:${port}/interfaces/stage/\n     for grown-ups:   http://localhost:${port}/interfaces/studio/\n`);
    console.log(`  Changes in the page are saved to songs/ and sounds/. Edits to files show up in the page.`);
    console.log(agent ? `  Wishes are granted by: ${agent}\n` : `  Wishes are collected in wishes/inbox.md (set SUNOSUX_AGENT to grant them automatically).\n`);
  });
}

if (!commands[cmd]) { console.error('unknown command: ' + cmd); commands.help(); process.exit(1); }
commands[cmd]();
