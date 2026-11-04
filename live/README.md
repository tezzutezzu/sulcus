# Sulcus — Live

A real-time visualiser for an audio input. The sound shapes a ring: the last
15 seconds (by default) scroll around it, low frequencies toward the centre and
high frequencies toward the rim, with height following level.

Built for performers and artists to keep open beside their instrument, DAW, or
audio interface. Everything runs in the browser; nothing is uploaded, recorded,
or written to disk.

## Using it

Open the page, pick a source, press **Start**. Press **Stop** when you are done.

| Control | What it does |
| --- | --- |
| Source | Default microphone, a named audio input, or **System / tab audio** |
| Start / Stop | Opens and closes the capture |
| Length | 5, 10, 15, 20 or 30 seconds of rolling history (default 15) |

Shortcuts: `T` top view, `R` reset the camera, `A` toggle a slow auto-orbit, `C`
print the current camera position to the console.
Drag to orbit and scroll to zoom at any time.

Your last source and length are remembered.

### Sources

Microphone permission is asked on the first **Start**. Device names appear once
permission is granted; before that they are listed as `Input 1`, `Input 2`, …

**System / tab audio** uses the browser's own share picker. Chrome can share a
tab's audio; capturing all system audio on macOS needs a loopback driver such as
BlackHole. If the picker is cancelled or the share has no audio track, the page
returns to the previous source and says why.

Capture needs a secure context, which means `localhost` or HTTPS. Opening the
file directly from disk (`file://`) will not work.

### Reading the ring

- Frequency is logarithmic; level is height above the base plate.
- Sound enters at the gap and scrolls clockwise.
- Levels are absolute dBFS clamped to a −80 dB floor: a silent room is flat, and
  there is no automatic gain, so quiet material stays visibly quiet.
- Long tones show as a single crisp ridge; dense material fills the surface.
  Time is smoothed slightly, frequency is not, so individual tones stay legible.

## Running locally

```bash
# from the repository root
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open <http://localhost:8000/live/>.

Three.js is loaded from unpkg (pinned to `three@0.169.0`), so the page needs
network access the first time.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The one page: viewer, source, Start/Stop, length |
| `app.js` | Capture lifecycle, 30 fps analysis tick, in-place mesh updates |
| `style.css` | Full-bleed layout and the three controls |
| `lib/relief.js` | Ring shape: topology, heights, shared with the generator |
| `lib/spectrum.js` | FFT-bin to log-frequency mapping and rolling history |
| `lib/audio-input.js` | Source enumeration, capture, errors, saved choice |
| `lib/viewer.js` | Three.js scene, camera views, in-place mesh updates |

`lib/relief.js` and `lib/viewer.js` are also used by the (unpublished) generator
in `../studio`, so the two always draw the same object.

## Publishing

`.github/workflows/pages.yml` publishes this folder to GitHub Pages on every push
to `main`. Only `live/` is uploaded, so nothing else in the repository is ever
served.

## Licence

Repository licence: Creative Commons Attribution-NonCommercial-ShareAlike 4.0
International, attribution to the Centre for Digital Music, Queen Mary University
of London. See `../LICENSE`.
