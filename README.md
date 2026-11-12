# 🎤 sunosux

Make songs out of parts with a kid, a grown-up, and Claude.

Instead of typing a prompt and getting a finished song back, you build one: tap
drum pads, hum a tune, record your own "hey!", stack pieces into a song. Claude sits
in the loop as a band member who writes pieces, invents instruments, and builds new
pages shaped around whatever you are making.

The first song, **Shine Brighter**, is an original K-pop style anthem about three
singers who chase the shadows away with music.

**Play it in your browser:** https://jperla.github.io/sunosux/

## Start

```bash
git clone https://github.com/jperla/sunosux && cd sunosux
npm run dev
```

Needs Node 18 or newer. Nothing to install.

- http://localhost:4747/interfaces/stage/ for kids
- http://localhost:4747/interfaces/studio/ for grown-ups

## How it works

Everything is plain files, and the page and the files stay in sync:

- Tap in the page and `songs/<name>.json` changes on disk. Record a sound and it lands in `sounds/`.
- Edit a song file (you, or Claude) and the open page takes the change in place, no refresh.
- Edit a brick or a page and the browser reloads itself.
- Type or say a wish into the ⭐ wish box and it lands in `wishes/inbox.md` for Claude.

Open the repo in Claude Code next to the browser, say "grant the wishes", and watch
the page change. [CLAUDE.md](CLAUDE.md) tells Claude how the whole thing fits together.
To have wishes granted the moment they are made, start the server with an agent
command that reads a prompt on standard input:

```bash
SUNOSUX_AGENT='your-agent-cli --non-interactive' npm run dev
```

## The pages

**Hunter Stage** (kids). The song plays as a show: every clap zaps a shadow into
sparkles, every kick makes the singers bounce, the city lights come on as you go.
Under it: the song as a row of blocks, the pieces as cards, a vocal booth, big pads,
a hum catcher that turns singing into a melody, a recorder that turns any sound into
an instrument, and the wish star.

**Studio** (grown-ups). A step grid, the text lanes, instrument recipes as JSON, a
sound lab, lyrics, and WAV export.

### Singing

Pick a piece, press 🎤, wait for the count of four, and sing along. The take is cut to
start exactly where the piece starts and is added to that piece, so it plays wherever
the piece is in the song. Sing again to layer a harmony or a duet. If a take sounds
off the beat (Bluetooth headphones do this), slide it with ◀ earlier / later ▶; the
next take remembers the correction.

Recordings are saved to `sounds/` and are git-ignored, so voices stay on your computer
unless you decide to add them. Use a normal browser tab: embedded preview panes
usually block the microphone.

Pages are made of bricks, so a new one is a few lines:

```bash
node tools/sunosux.js new-interface "Drum Party" --bricks stage,pads --kid
```

## Tools

```
node tools/sunosux.js dev              the live studio
node tools/sunosux.js check [song]     find mistakes in a song
node tools/sunosux.js render [song]    song to WAV (--part chorus for one piece)
node tools/sunosux.js sound <name>     hear one instrument recipe
node tools/sunosux.js list             songs, pieces, instruments, recordings, bricks, pages
node tools/sunosux.js new-song <name>
node tools/sunosux.js new-interface <name> --bricks a,b,c
node tools/sunosux.js wishes
node tools/sunosux.js test
```

## A song is data

```json
{
  "bpm": 118,
  "parts": {
    "chorus": { "emoji": "🌟", "bars": 1, "tracks": [
      { "instrument": "kick", "lane": "x...x...x...x..." },
      { "instrument": "lead", "lane": "E5 . E5 . D5 . C5 - A4 - - . C5 . D5 ." }
    ] }
  },
  "arrangement": ["chorus", "chorus"]
}
```

Drums are `x` and `.`; tunes are note names, `-` to hold and `.` to rest. Instruments
are recipes (a waveform, an envelope, a filter, or a recording). The engine in
`src/engine.js` is a small software synth in plain JavaScript, so the same code plays
in the browser and renders WAV files from the command line. The full format is in
[CLAUDE.md](CLAUDE.md).

## License

MIT. The music in `songs/` is original and under the same license.
