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
| Length | Seconds of rolling history on a slider, 1 to 600 (default 15) |

Shortcuts: `T` top view, `R` reset the camera, `A` toggle a slow auto-orbit, `C`
print the current camera position to the console.
Drag to orbit and scroll to zoom at any time.

Your last source and length are remembered.

### Length

The slider sets the seconds of history the ring shows, from 1 to 600. The
readout follows the thumb while you drag, but the ring only rebuilds when you
let go, so sweeping across the range never reallocates the mesh under the
pointer. Arrow keys step by one second each and commit on the same short pause.

Changing the length rebuilds the ring, which is instant at 15 s and takes
noticeably longer toward 600 s: the mesh then has 51 × 18,000 vertices and about
45 MB of buffers, and the per-frame work grows with the column count. Anything
up to about two minutes stays comfortable on a laptop.

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

### Frequency band

The panel in the bottom-left draws the current spectrum across the full
50 Hz – 20 kHz range and shades it outside the selected band. The two edges are
draggable: the band then becomes the analysis range, so the ring zooms into it —
its inner radius is the start frequency and its rim is the end one.

Drag either edge, or press anywhere on the plot to take the nearer edge, and
release to stop. The edges can be tabbed to and moved with the arrow keys
(±5 %), Page Up/Down (±20 %), and Home/End. They never cross and stay at least a
×1.2 span apart. Double-click the plot to return to the full range.

Changing the band clears the rolling history: stored columns are dB values per
row and mean nothing under a different row-to-frequency mapping, so the ring
starts flat and refills with incoming audio. The band is not remembered between
visits.

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
| `index.html` | The one page: viewer, band filter, source, Start/Stop, length |
| `app.js` | Capture lifecycle, 30 fps analysis tick, in-place mesh updates |
| `style.css` | Full-bleed layout, the controls and the band panel |
| `lib/relief.js` | Ring shape: topology, heights, shared with the generator |
| `lib/spectrum.js` | FFT-bin to log-frequency mapping and rolling history |
| `lib/band-plot.js` | Band panel: spectrum curve, edge dragging, keyboard |
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
