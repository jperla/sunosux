# sunosux: how to help here

This repo is a song-making harness for two people: a grown-up and a 5-year-old.
They make songs out of parts. You (Claude, or any coding agent) are the third band
member: you write pieces, invent instruments, and build new pages shaped around
whatever they are making right now. Everything is meant to be changed.

## The loop

`npm run dev` serves the studio at http://localhost:4747 and keeps three things in sync:

- **Page to files.** Every tap in the browser is saved to `songs/<name>.json`. Recordings are saved to `sounds/<name>.wav`.
- **Files to page.** Edit a song file and the open page takes the new song in place, without reloading (undo in the page still works). Edit anything in `src/`, `bricks/` or `interfaces/` and the page reloads itself.
- **Wishes.** The ⭐ wish box in the page appends to `wishes/inbox.md`.

So: you never need to ask anyone to refresh, and you should expect the song file to
change under you while they play. Re-read a song file right before you edit it, and
make small edits rather than rewriting the whole file.

## Granting wishes

1. Read `wishes/inbox.md`. Each wish says which page, song and piece it came from.
2. Grant it with the smallest change that makes the wish come true. A wish from a 5-year-old ("a tiger!") deserves a generous, fun reading.
3. Run `node tools/sunosux.js check` (and `test` if you touched `src/` or `bricks/`).
4. Move the wish from `inbox.md` to `wishes/granted.md` with one line about what you did.

## Map

| Where | What |
|---|---|
| `songs/*.json` | The songs. Plain data: instruments, parts, arrangement. |
| `sounds/*.wav` | Recordings (her voice, claps, anything). |
| `src/engine.js` | Song data to audio. Pure JS DSP, same code in browser and Node. |
| `src/instruments.js` | Built-in instrument recipes. |
| `src/seed.js` | Grows a first-draft song from a bit of singing: tempo, key, tuning, tune, chords. |
| `src/kit.js`, `src/kit.css` | The store, player, hot reload and look shared by every page. |
| `bricks/*.js` | UI bricks: `stage`, `seed`, `sing`, `pads`, `timeline`, `parts`, `editor`, `lanes`, `hum`, `recorder`, `soundLab`, `lyrics`, `wish`, `playBar`, `saveBar`. |
| `interfaces/<name>/index.html` | Pages. Each is a short list of bricks. |
| `tools/sunosux.js` | CLI: `dev`, `check`, `render`, `sound`, `list`, `seed`, `new-song`, `new-interface`, `wishes`, `test`. |

## Song format

```json
{
  "title": "Shine Brighter", "bpm": 118, "stepsPerBeat": 4,
  "scale": ["A", "C", "D", "E", "G"],
  "theme": { "accent": "#ff4fa3", "sky": ["#0b0620", "#3a1466"] },
  "instruments": { "tiger": { "emoji": "🐯", "sample": "rec-abc", "pitched": false } },
  "parts": {
    "chorus": { "emoji": "🌟", "color": "#ff4fa3", "bars": 4, "lyrics": "…",
      "tracks": [ { "instrument": "kick", "lane": "x...x...x...x... *4", "gain": 1, "pan": 0 } ] }
  },
  "arrangement": ["intro", "chorus", "chorus"]
}
```

Lanes are text, 16 steps to a bar, `|` between bars is optional:

- Drums: `x` hit, `X` loud, `o` soft, `.` rest. Example: `x...x...x...x...`
- Tunes: a note name plays, `-` holds it, `.` rests, `+` makes a chord. Example: `A4 - C5 . A3+C4+E4 - - -`
- `… *4` at the end repeats the lane four times.

Every lane in a part must be exactly `bars × 16` steps. `check` tells you when one is not.

`scale` is the set of notes the kid-facing pads, grid and hum catcher are allowed to
use, so nothing she plays can sound wrong. Changing the mood of a song usually means
changing `scale`, `bpm` and the instrument recipes together.

## Songs that grow from singing

The 🌱 seed page (and `node tools/sunosux.js seed <recording>`) starts from a bit of
singing with no backing. It picks a tempo that makes the chosen bit a whole number of
bars, tunes the band to the singer (`song.tuning`, in cents), reads the key and the
tune, picks a chord per bar, and writes a draft: `intro`, `hook` (the singing plus a
band), `verse` (band only, waiting for words) and `outro`.

The draft is deliberately plain. Building the real song around it is your job, with them:

- `song.seed` holds what the singing told us: `melody` (a lane), `chords`, `key`, `bpm`, `lyrics`, and `recording` (the whole take in `sounds/`, of which `piece` is the chosen bit, cut at `from`..`to` seconds).
- Write new parts that answer the hook: a verse tune from the same scale that leaves room and moves less than the hook, a pre-chorus that climbs into it, a bridge on other chords of the key. Reuse a fragment of `seed.melody` somewhere so the song sounds like one idea.
- The detected chords are a guess from the sung notes. If a bar sounds wrong, a neighbouring chord of the key that contains the bar's long notes usually fixes it.
- Never change `bpm` or `tuning` of a seeded song: the recording cannot stretch, so it would fall out of time or out of tune. Change the feel with the drum pattern (half-time, double-time hats) instead.
- Another bit of the same take can become another part: `node tools/sunosux.js seed sounds/<id>-full.wav --start 12 --end 19 --title scratch`, then move that hook lane and instrument into the song.

## Instruments

A recipe is plain data. Put song-specific ones in the song's `instruments`; put ones
worth keeping forever in `src/instruments.js`.

- Synth: `wave` (sine, square, saw, triangle), `voices`, `detune` (cents), `octave`, `env {a,d,s,r}`, `filter {cutoff,q,envAmount}`, `vibrato {rate,depth}`, `sub`, `noise`, `gain`, `pan`.
- Drum: `kind` (kick, snare, clap, hat, tom, zap), `decay`, `pitch`, `gain`.
- Recording: `sample` (file name in `sounds/` without `.wav`), `pitched` (true plays it at each note, false plays it as a hit), `root`, `offset` (seconds later or earlier).
- Sung take: a recording with `vocal: true`, made by the `sing` brick. It sits in a piece as a lane with one hit on step 0 (`X...`), so it plays from the start of that piece wherever the piece is used. Different words for a second verse means a copy of the piece (👯) with its own take. Never re-time, trim or delete a take unless asked: nudge it with `offset`, quiet it with the lane's `gain`.

Hear one without opening the page: `node tools/sunosux.js sound <name>` writes `out/sound-<name>.wav`.
New kinds of sound (a new drum `kind`, an effect) go in `src/engine.js`.

## Bricks and pages

A brick is one function that fills an element and talks to the shared `app`:

```js
Sunosux.Kit.components.tigerButton = (el, app) => {
  const { store, player, Kit } = app;
  el.append(Kit.h('button', { class: 'sx-big', onclick: () =>
    player.trigger(Kit.helpers.instrumentsOf(store.song).tiger) }, '🐯 ROAR'));
};
```

- `store.song` is the song. Change it only through `store.change((song) => { … })`, which gives undo, autosave and redraw for free. `store.subscribe(fn)` redraws.
- `player.play()`, `playPart(name)`, `loopPart(name)`, `trigger(recipe, note)`, `onHit(fn)` (every note as it sounds, for visuals), `onTick(fn)`.
- `Kit.helpers` has `addHit`, `laneEvents`, `eventsToLane`, `scaleNotes`, `instrumentsOf`, `setBars`.
- Redraw with `Kit.fill(el, ...children)`: it flattens arrays and skips `null`, which plain `replaceChildren` does not.

A page is a list of bricks: `node tools/sunosux.js new-interface "Drum Party" --bricks stage,pads --kid`
writes `interfaces/drum-party/index.html` and links it from the home page. When they
start making a different kind of song, or she wants to play a different way, build a
new page for it rather than bending an old one. Pages are cheap.

## What good looks like for a 5-year-old

- She cannot read yet. Emoji and color first, at most a few short words, never a paragraph.
- Every touch makes a sound or moves something right away.
- Big targets (pads around 100 px), nothing that needs a precise drag or a long press.
- She cannot make it sound bad: snap to the beat, keep to `scale`.
- Nothing she makes is lost: go through `store.change` so ↩️ works, and never delete her recordings or pieces unless asked.
- Her own voice in the song beats any feature.

## Rules

- No dependencies and no build step. The browser loads these files as they are.
- Keep `node tools/sunosux.js test` passing.
- Original music only. Borrow a style or a mood (K-pop, lullaby, sea shanty), never the melody, lyrics, names or characters of an existing song or show.
- The dev server only listens on this computer and only saves `songs/*.json` and `sounds/*.wav`. Keep it that way.
- Recordings are real voices, one of them a child's. `sounds/*.wav` is git-ignored: never add, commit or upload recordings unless the grown-up asks for exactly that. A song whose recordings are missing still plays, with those lanes silent.
