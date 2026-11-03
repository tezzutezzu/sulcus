// ---------------------------------------------------------------------------
// Ring spectrogram
// ---------------------------------------------------------------------------

/**
 * Paints the relief onto a ring: angle is time, radius is logarithmic frequency,
 * colour is level.
 *
 * This is the same data the ring outline in app.js describes, so the two always
 * line up. Rather than drawing ~24,000 wedges, the ring is rasterised by walking
 * the pixels of its bounding box and inverting the polar mapping to find the
 * sample underneath each one.
 *
 * The geometry must match app.js exactly: centre of the 600-unit viewBox, outer
 * radius 250, time running clockwise from the arc start, and everything outside
 * the arc belonging to the gap.
 */

import { buildRamp } from './lib/heatmap.js';

const STEPS = 256;
const RAMP = buildRamp(STEPS);
const TAU = Math.PI * 2;

/**
 * @param {HTMLCanvasElement} canvas square, matching the 600-unit viewBox
 * @param {object|null} data `landscape-data.json`; anything non-circular clears it
 */
export function renderRing(canvas, data) {
  if (!canvas) return;

  const size = canvas.width;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  if (!data || data.shape !== 'circular') return;

  const values = data.values;
  const rows = values.length;
  const cols = values[0].length;
  const span = data.dbMax - data.dbMin || 1;

  const { diameter, innerDiameter } = data.geometryMm;
  const centre = size / 2;
  const outer = (size * 250) / 600;
  const inner = outer * (innerDiameter / diameter);
  const band = outer - inner || 1;

  const sweep = (data.arcDegrees * Math.PI) / 180;
  const startAngle = ((-90 - (360 - data.arcDegrees) / 2) * Math.PI) / 180;

  const image = ctx.createImageData(size, size);
  const out = image.data;

  const from = Math.max(0, Math.floor(centre - outer));
  const to = Math.min(size - 1, Math.ceil(centre + outer));

  for (let y = from; y <= to; y++) {
    const dy = centre - y; // the model is +Y up
    for (let x = from; x <= to; x++) {
      const dx = x - centre;
      const radius = Math.hypot(dx, dy);
      if (radius < inner || radius > outer) continue;

      // Unwrap so the arc, which can span more than a half turn, maps to [0, 1].
      let delta = startAngle - Math.atan2(dy, dx);
      delta = ((delta % TAU) + TAU) % TAU;

      const fraction = delta / sweep;
      if (fraction > 1) continue; // the gap

      const i = Math.round(fraction * (cols - 1));
      const j = Math.round(((radius - inner) / band) * (rows - 1));

      const level = (values[j][i] - data.dbMin) / span;
      const step = Math.max(0, Math.min(STEPS - 1, Math.round(level * (STEPS - 1))));
      const p = (y * size + x) * 4;

      out[p] = RAMP[step * 3];
      out[p + 1] = RAMP[step * 3 + 1];
      out[p + 2] = RAMP[step * 3 + 2];
      out[p + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
}
