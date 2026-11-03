// ---------------------------------------------------------------------------
// Colour ramp
// ---------------------------------------------------------------------------

/**
 * Shared by both spectrogram views, so the ring and the flat plot always agree
 * on what a given level looks like.
 */

/** Viridis-like ramp, quiet to loud. */
export const PALETTE = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];

/** Colour at t in [0, 1]. */
export function samplePalette(t) {
  const clamped = Math.max(0, Math.min(1, t)) * (PALETTE.length - 1);
  const i = Math.min(Math.floor(clamped), PALETTE.length - 2);
  const f = clamped - i;
  const a = PALETTE[i];
  const b = PALETTE[i + 1];
  return [
    Math.round(a[0] + f * (b[0] - a[0])),
    Math.round(a[1] + f * (b[1] - a[1])),
    Math.round(a[2] + f * (b[2] - a[2])),
  ];
}

/**
 * Precomputed lookup table of `steps` colours, as a flat r,g,b byte array.
 * Cheaper than interpolating per pixel in the ring's inner loop.
 */
export function buildRamp(steps = 256) {
  const ramp = new Uint8ClampedArray(steps * 3);
  for (let n = 0; n < steps; n++) {
    const [r, g, b] = samplePalette(n / (steps - 1));
    ramp[n * 3] = r;
    ramp[n * 3 + 1] = g;
    ramp[n * 3 + 2] = b;
  }
  return ramp;
}

/**
 * Renders a dB matrix into an offscreen canvas of cols x rows, one pixel per
 * sample, in screen order: the first row of `values` is the bottom row.
 */
export function buildImage(values, dbMin, dbMax) {
  const rows = values.length;
  const cols = values[0].length;
  const span = dbMax - dbMin || 1;
  const image = new ImageData(cols, rows);

  for (let j = 0; j < rows; j++) {
    const row = values[j];
    for (let i = 0; i < cols; i++) {
      const [r, g, b] = samplePalette((row[i] - dbMin) / span);
      const p = ((rows - 1 - j) * cols + i) * 4;
      image.data[p] = r;
      image.data[p + 1] = g;
      image.data[p + 2] = b;
      image.data[p + 3] = 255;
    }
  }

  const offscreen = document.createElement('canvas');
  offscreen.width = cols;
  offscreen.height = rows;
  offscreen.getContext('2d').putImageData(image, 0, 0);
  return offscreen;
}
