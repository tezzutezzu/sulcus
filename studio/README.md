# Sound / Form — acoustic relief generator

Turns a recording into an acoustic relief: its spectrogram shaped as a ring,
shown as a listenable player and exported as a 3D-printable STL.

Everything runs in the browser. No build step, no `npm install`, no server code.

## Running it

This folder is the private workshop: the generator, the legacy tools and the
media. The published live visualiser is a separate, self-contained app in
`../live`.

Serve the repository root over HTTP. Opening `site/index.html` as a file will not
work, because module scripts and `fetch` are blocked on `file://`:

```bash
# from the repository root (the folder that contains live/ and studio/)
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open <http://localhost:8000/studio/site/>. The shared ring shape and 3D
viewer are imported from `../live/lib`, so that the published tool stays
self-contained.

The 3D preview loads Three.js (pinned to `three@0.169.0`) from unpkg, so it needs
network access. If the CDN is unreachable the generator still runs — you keep the
downloads and the player, you only lose the live preview.

On first visit the player reads `generated/landscape-data.json` and plays
`impulse.wav`. Those are the shipped defaults; generating replaces them in memory
for the rest of the session.

## Generating

Choose a file, or leave the field empty to use `impulse.wav`, then press
**Generate**:

decode → STFT → relative dB → 3x3 smoothing → mesh → binary STL → clay mould

Decoding runs on the main thread, because Web Audio is not exposed in workers;
the analysis runs in a worker, so the page stays responsive.

Results are offered as downloads rather than written to disk, since a browser
page cannot write files:

- `landscape.stl` (positive master)
- `mould.stl` (optional TPU negative)
- `landscape-data.json`
- `spectrogram.json`
- `spectrogram-plot-data.json`

The ring player adopts the new relief immediately, without a reload, and switches
its audio source to the file you generated from.

## Options

Geometry:
The relief is always the ring: `diameter` 160, `inner-diameter` 40 and `arc`
330 degrees, with `base` 3 mm and `relief` 27 mm. For the plaster workflow set
`relief` to 14 mm. The inner diameter must be positive and smaller than the
outer diameter; the arc must be strictly between 0 and 360 degrees and must not
exceed 180 degrees per time frame.

Clay mould:
The chosen workflow is a PLA positive (`landscape.stl`) cast in plaster, then
pressed with clay; see `tools/mould-explained.en.txt` (and the Italian version).
The site also exports `mould.stl`, a one-piece negative for direct TPU printing.
The `mould-relief` 14 mm, `mould-slope` 60°, `mould-scale` and `mould-back`
controls affect only that negative. `npm run mould` writes it offline through
`tools/make-mould.mjs`.

Analysis:
`analysisRate` 48000 Hz (see below), `seconds` 3, `channel` 0, `fft` 4096,
`rows` 101, `cols` 241, `fmin` 50 Hz, `fmax` 20000 Hz, `floor` -80 dB.

Channels are zero-indexed and never averaged. Duration is limited by the
recording, and t=0 is the file start — there is no automatic onset alignment.
Increasing `rows` does not increase FFT resolution; it resamples the existing
spectrum more densely.

Time axis:
The relief always samples time linearly. `plot-time` independently controls
sampling for the exported spectrogram data (default `linear`; log includes
zero using a 10 ms offset). Frequency is logarithmic throughout.

## The analysis rate

The input is always resampled to a fixed analysis rate during decoding, so the
same file yields the same model on every machine, regardless of the audio
hardware. That choice has consequences worth knowing:

- the window length is `fft / analysisRate` seconds, and the frequency resolution
  is `analysisRate / fft` Hz — the rate sets both, not the input file;
- setting the rate to the file's own sample rate reproduces the analysis the
  legacy command-line tool produced;
- `fmax` above `analysisRate / 2` is clamped, and the form warns when that
  applies.

## Decoding and levels

Decoding accepts whatever the browser can decode — WAV, AIFF, MP3, Ogg, FLAC —
rather than uncompressed PCM only.

The STFT uses centred Hann windows, zero padding at recording boundaries, and
interpolated FFT-bin power. Spectral values are 10 log10(power / reference),
where the reference is the maximum interpolated power across both the relief and
plot grids, so changing either grid can shift both. These are relative levels,
not calibrated dB SPL; values are clipped to `floor` and silence maps to it. Only
geometry is smoothed, with two weighted 3x3 passes.

## Outputs

- `landscape.stl` — positive relief mesh (the PLA master), millimetres, Z-up,
  no colours.
- `mould.stl` — one-piece press-mould negative of the ring relief, millimetres,
  Z-up. The cavity opens at +Z and the flat back sits at z = 0.
- `landscape-data.json` — smoothed frequency × time matrix, coordinates, shape,
  `geometryMm`, and circular arc/orientation metadata.
- `spectrogram.json` — unsmoothed values at the relief's time samples.
- `spectrogram-plot-data.json` — unsmoothed values at the plot's time samples.

The checked-in files in `generated/` are the defaults the page loads. They come
from the legacy command-line tool, analysed at the file's native sample rate, so
they are not byte-identical to a browser run at 48000 Hz.

## Geometry

Viewed from +Z, time runs clockwise around the arc and the 30° gap is centred at
the bottom (-Y); logarithmic frequency increases outward, and smoothed relative
spectral level controls height. The solid has a flat bottom, inner and outer
walls, and both arc-end walls, leaving the central opening and the gap open.

## The player

The player draws the ring boundary and a radial line that follows the relief's
time mapping from the audio position — including while paused and at 0.5× or
0.245× speed. Play, Pause, and Replay; the ring itself is display-only. Pitch
preservation is the browser default. Playback stops at the end of the represented
segment when the source is longer than the relief. Drag the ring to move it,
scroll to scale it, nudge it with the arrow keys, and press `H` to hide the layout
controls.

## Live visualiser

The real-time tool lives in its own published app: see `../live/README.md`.
It shares the ring geometry and the Three.js viewer with this generator
(`../live/lib/relief.js`, `../live/lib/viewer.js`), so both draw the same object.

## Legacy

`acoustic-vase.cjs` is an earlier, unrelated hollow-vase generator. It still needs
Node.js 18+ and the `node-wav` / `fft.js` packages in `package.json`, and writes
`generated/geometry.json` and `generated/vase.stl`. The site does not use it.
