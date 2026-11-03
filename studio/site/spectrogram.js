// ---------------------------------------------------------------------------
// 2D spectrogram
// ---------------------------------------------------------------------------

/**
 * Draws the unsmoothed spectrogram: time across, logarithmic frequency up, and
 * level as colour.
 *
 * The frequency rows are already log-spaced by the analysis, so each row maps
 * straight onto a band of pixels — no interpolation on the way in. Only the
 * tick labels need to convert back to hertz.
 *
 * No dependencies: the heatmap is an ImageData scaled onto the canvas, and the
 * axes and colour bar are drawn directly.
 */

import { buildImage, samplePalette } from './lib/heatmap.js';

const MARGIN = { left: 58, right: 74, top: 14, bottom: 34 };
const INK = '#a4a5a0';
const AXIS = '#3a3f41';

const state = { canvas: null, observer: null, image: null, data: null };

/** 1, 2, 5 per decade, trimmed to the analysed range. */
function frequencyTicks(fmin, fmax) {
  const ticks = [];
  for (let e = Math.floor(Math.log10(fmin)); e <= Math.ceil(Math.log10(fmax)); e++) {
    for (const multiplier of [1, 2, 5]) {
      const f = multiplier * 10 ** e;
      if (f >= fmin && f <= fmax) ticks.push(f);
    }
  }
  return ticks;
}

const label = (f) => (f >= 1000 ? `${Number((f / 1000).toPrecision(3))}k` : `${Number(f.toPrecision(3))}`);

function draw() {
  const canvas = state.canvas;
  if (!canvas || !canvas.clientWidth || !canvas.clientHeight) return;

  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);

  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = '#0d0f10';
  ctx.fillRect(0, 0, width, height);

  const data = state.data;
  const left = MARGIN.left;
  const top = MARGIN.top;
  const plotWidth = Math.max(10, width - MARGIN.left - MARGIN.right);
  const plotHeight = Math.max(10, height - MARGIN.top - MARGIN.bottom);

  ctx.font = '10px Arial, Helvetica, sans-serif';
  ctx.textBaseline = 'middle';

  if (!state.image) {
    ctx.fillStyle = '#7d8280';
    ctx.font = '12px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Generate to see the spectrogram', width / 2, height / 2);
    return;
  }

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(state.image, left, top, plotWidth, plotHeight);
  ctx.imageSmoothingEnabled = true;

  const cols = data.timesSeconds.length;
  const fmin = data.frequenciesHz[0];
  const fmax = data.frequenciesHz[data.frequenciesHz.length - 1];
  const freqSpan = Math.log(fmax / fmin);

  // Frame
  ctx.strokeStyle = AXIS;
  ctx.lineWidth = 1;
  ctx.strokeRect(left + 0.5, top + 0.5, plotWidth - 1, plotHeight - 1);

  // Time axis (values come from the data, so a log time axis labels correctly).
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  for (let n = 0; n <= 6; n++) {
    const fraction = n / 6;
    const x = left + fraction * plotWidth;
    const t = data.timesSeconds[Math.round(fraction * (cols - 1))];
    ctx.beginPath();
    ctx.moveTo(x, top + plotHeight);
    ctx.lineTo(x, top + plotHeight + 4);
    ctx.stroke();
    ctx.fillText(Number(t.toPrecision(3)).toString(), x, top + plotHeight + 15);
  }
  ctx.fillText(`time (s) · ${data.timeScale}`, left + plotWidth / 2, top + plotHeight + 28);

  // Frequency axis.
  ctx.textAlign = 'right';
  for (const f of frequencyTicks(fmin, fmax)) {
    const y = top + plotHeight * (1 - Math.log(f / fmin) / freqSpan);
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left - 4, y);
    ctx.stroke();
    ctx.fillText(label(f), left - 8, y);
  }

  // Colour bar.
  const barX = left + plotWidth + 16;
  const barWidth = 12;
  for (let n = 0; n < 64; n++) {
    const [r, g, b] = samplePalette(1 - n / 63);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(barX, top + (plotHeight * n) / 64, barWidth, plotHeight / 64 + 1);
  }
  ctx.strokeRect(barX + 0.5, top + 0.5, barWidth - 1, plotHeight - 1);

  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.fillText(`${data.dbMax} dB`, barX + barWidth + 5, top + 6);
  ctx.fillText(`${data.dbMin}`, barX + barWidth + 5, top + plotHeight - 6);
}

/**
 * Draws `plotData`, or a placeholder when it is null.
 * @param {HTMLCanvasElement} canvas
 * @param {object|null} plotData the `spectrogram-plot-data.json` structure
 */
export function render(canvas, plotData) {
  if (!canvas) return;
  if (state.canvas !== canvas) {
    state.observer = null;
    state.canvas = canvas;
  }

  state.data = plotData;
  state.image = plotData ? buildImage(plotData.values, plotData.dbMin, plotData.dbMax) : null;

  if (!state.observer) {
    state.observer = new ResizeObserver(draw);
    state.observer.observe(canvas);
  }

  draw();
}
