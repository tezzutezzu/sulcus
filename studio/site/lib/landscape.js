// ---------------------------------------------------------------------------
// Landscape analysis
// ---------------------------------------------------------------------------

/**
 * The acoustic relief pipeline.
 *
 * Everything here is plain arithmetic with no platform APIs, so it runs in a
 * Web Worker. Audio decoding is not part of this module (see decode.js).
 *
 * Two things to keep in mind:
 *   - the sample rate is a caller-supplied analysis rate rather than the file's,
 *     so results do not depend on the input file or the audio hardware;
 *   - nothing is written to disk. Callers get the artifacts back as data.
 *
 * The signal path itself (Hann window, zero padding, radix-2 FFT, interpolated
 * bin power, dB clamping, two weighted 3x3 smoothing passes, mesh and STL
 * encoding) is the reference implementation: reordering it changes every output.
 */

import { fft } from './fft.js';
import { RELIEF_DEFAULTS, reliefHeight, reliefTopology } from '../../../live/lib/relief.js';

/**
 * Defaults for every option. Numeric entries are coerced from form strings.
 * The ring shape itself is shared with the published live view.
 */
export const DEFAULTS = {
  analysisRate: 48000, // fixed rate every input is decoded to, Hz
  channel: 0, // 0-based channel of the source file
  seconds: 3, // length of audio to analyse
  ...RELIEF_DEFAULTS,
  fft: 4096, // STFT window size in samples
  rows: 101, // frequency samples
  cols: 241, // time frames
  fmin: 50, // lowest analysed frequency, Hz
  fmax: 20000, // highest analysed frequency, Hz (clamped to Nyquist)
  'plot-time': 'linear', // exported plot time axis: 'linear' or 'log'
};

const isPowerOfTwo = (n) => (n & (n - 1)) === 0;

/**
 * Names the first option that cannot be used, or null when everything is fine.
 * Reporting the field matters because the form opts out of native validation:
 * a control inside a collapsed <details> cannot be focused by the browser, so
 * it would otherwise fail silently with no indication of which value is wrong.
 */
function firstInvalidOption(options) {
  for (const [key, value] of Object.entries(options)) {
    if (typeof value === 'number' && !Number.isFinite(value)) return key;
  }

  if (options.analysisRate <= 0) return 'analysisRate';
  if (options.diameter <= 0) return 'diameter';
  if (options['inner-diameter'] <= 0) return 'inner-diameter';
  if (options['inner-diameter'] >= options.diameter) return 'inner-diameter';
  if (options.arc <= 0 || options.arc >= 360) return 'arc';
  if (!Number.isInteger(options.cols) || options.cols < 2) return 'cols';
  if (options.arc / (options.cols - 1) >= 180) return 'arc';
  if (options.base <= 0) return 'base';
  if (options.relief < 0) return 'relief';
  if (options.seconds <= 0) return 'seconds';
  if (options.floor >= 0) return 'floor';
  if (options.fmin <= 0) return 'fmin';
  if (options.fmax <= options.fmin) return 'fmax';
  if (!Number.isInteger(options.rows) || options.rows < 2) return 'rows';
  if (!Number.isInteger(options.channel) || options.channel < 0) return 'channel';
  if (!Number.isInteger(options.fft) || options.fft < 128 || options.fft > 65536 ||
      !isPowerOfTwo(options.fft)) return 'fft';
  if (!['linear', 'log'].includes(options['plot-time'])) return 'plot-time';

  return null;
}

/**
 * Throws if the options are not usable. The relief is always the ring, so only
 * the circular geometry is validated.
 */
export function validateOptions(options) {
  const field = firstInvalidOption(options);
  if (field) throw new Error(`Invalid value for "${field}".`);
}

/**
 * Time positions across the model width.
 * The log scale includes t = 0 by using a 10 ms offset.
 */
function frameTimes(scale, duration, cols) {
  return Array.from({ length: cols }, (_, i) => {
    if (scale === 'linear') return (duration * i) / (cols - 1);
    const offset = 0.01;
    return offset * ((1 + duration / offset) ** (i / (cols - 1)) - 1);
  });
}

/** Top surface: one vertex per (time, frequency) sample, z scaled from dB. */
function buildMesh(options, values) {
  const { vertices, faces, topCount, nx } = reliefTopology(options);

  for (let k = 0; k < topCount; k++) {
    const j = Math.floor(k / nx);
    const i = k - j * nx;
    vertices[k].push(reliefHeight(values[j][i], options));
  }
  for (let k = topCount; k < vertices.length; k++) vertices[k].push(0);

  return { vertices, faces };
}

/**
 * Weighted 3x3 smoothing applied `passes` times, clamping at the edges.
 * Only geometry is smoothed; exported dB values stay as measured.
 */
function smoothGrid(values, rows, cols, passes = 2) {
  let result = values;

  for (let pass = 0; pass < passes; pass++) {
    result = result.map((row, j) =>
      row.map((_, i) => {
        let sum = 0;
        let weightSum = 0;

        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const y = Math.max(0, Math.min(rows - 1, j + dj));
            const x = Math.max(0, Math.min(cols - 1, i + di));
            const weight = (dj === 0 ? 2 : 1) * (di === 0 ? 2 : 1);

            sum += result[y][x] * weight;
            weightSum += weight;
          }
        }

        return sum / weightSum;
      })
    );
  }

  return result;
}

/**
 * Binary STL. Layout: 80-byte header + 4-byte triangle count + 50 bytes each.
 * The header describes the geometry only, so it holds for non-WAV inputs too.
 */
function encodeStl(vertices, faces) {
  const buffer = new ArrayBuffer(84 + 50 * faces.length);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  const header = 'Acoustic relief; units mm';
  for (let i = 0; i < header.length; i++) bytes[i] = header.charCodeAt(i);
  view.setUint32(80, faces.length, true);

  faces.forEach((face, index) => {
    const triangle = face.map((k) => vertices[k]);
    const u = triangle[1].map((x, k) => x - triangle[0][k]);
    const w = triangle[2].map((x, k) => x - triangle[0][k]);

    // Face normal = u x w, normalised.
    let normal = [
      u[1] * w[2] - u[2] * w[1],
      u[2] * w[0] - u[0] * w[2],
      u[0] * w[1] - u[1] * w[0],
    ];
    const length = Math.hypot(...normal);
    normal = normal.map((x) => x / length);

    // 12 floats per triangle: normal (3) + three vertices (9).
    const record = [...normal, ...triangle.flat()];
    record.forEach((value, k) => view.setFloat32(84 + 50 * index + 4 * k, value, true));
  });

  return buffer;
}

/**
 * Runs the whole pipeline.
 *
 * @param {object} input
 * @param {Float32Array} input.samples mono samples already decoded at the analysis rate
 * @param {number} input.sampleRate the analysis rate those samples were decoded to
 * @param {number} input.channels channel count of the source file
 * @param {string} input.fileName source name, recorded in the artifacts
 * @param {object} input.options
 * @returns {{ spectrogram: object, plotData: object, landscapeData: object, stlBytes: ArrayBuffer }}
 */
export function generate({ samples, sampleRate, channels, fileName, options }) {
  validateOptions(options);

  if (!samples.length) throw new Error('The audio is empty.');

  const duration = Math.min(options.seconds, (samples.length - 1) / sampleRate);
  if (duration <= 0) throw new Error('The audio is too short to analyse.');

  const fmax = Math.min(options.fmax, sampleRate / 2);
  if (options.fmin >= fmax) throw new Error('fmin exceeds Nyquist for this analysis rate.');

  const fftSize = options.fft;

  // Logarithmically spaced analysis frequencies from fmin to fmax.
  const frequencies = Array.from(
    { length: options.rows },
    (_, j) => options.fmin * (fmax / options.fmin) ** (j / (options.rows - 1))
  );

  // The relief always samples time linearly; only the plot axis is a choice.
  const times = frameTimes('linear', duration, options.cols);
  const plotTimes = frameTimes(options['plot-time'], duration, options.cols);

  // Short-time Fourier transform: Hann-windowed, frame-centred, zero-padded.
  // `peak` spans every frame of both grids, so it is shared deliberately.
  let peak = 0;
  const analyse = (frameList) => {
    const raw = Array.from({ length: options.rows }, () => []);

    for (const t of frameList) {
      const re = new Float64Array(fftSize);
      const im = new Float64Array(fftSize);
      const start = Math.round(t * sampleRate) - fftSize / 2;

      for (let k = 0; k < fftSize; k++) {
        const i = start + k;
        const sample = i >= 0 && i < samples.length ? samples[i] : 0;
        // Hann window.
        re[k] = sample * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (fftSize - 1)));
      }

      fft(re, im);

      for (let j = 0; j < options.rows; j++) {
        // Linear interpolation between the two nearest FFT bins.
        const bin = (frequencies[j] * fftSize) / sampleRate;
        const k = Math.min(Math.floor(bin), fftSize / 2);
        const l = Math.min(k + 1, fftSize / 2);
        const frac = bin - k;

        const power = (re[k] ** 2 + im[k] ** 2) * (1 - frac) + (re[l] ** 2 + im[l] ** 2) * frac;

        raw[j].push(power);
        peak = Math.max(peak, power);
      }
    }

    return raw;
  };

  const raw = analyse(times);
  const plotRaw = options['plot-time'] === 'linear' ? raw : analyse(plotTimes);

  const toDb = (matrix) => matrix.map((row) => row.map((power) =>
    peak === 0 || power === 0 ? options.floor
      : Math.max(options.floor, 10 * (Math.log10(power) - Math.log10(peak)))
  ));

  const db = toDb(raw);
  const plotDb = toDb(plotRaw);

  // Only the geometry is smoothed; the unsmoothed dB values are kept for export.
  const values = smoothGrid(db, options.rows, options.cols);

  const geometryMm = {
    diameter: options.diameter,
    innerDiameter: options['inner-diameter'],
    base: options.base,
    relief: options.relief,
  };

  const spectrogram = {
    source: fileName,
    sampleRate,
    channel: options.channel,
    channels,
    fftSize,
    window: 'Hann; centered frames, zero padding',
    reference: 'maximum interpolated spectral power across landscape and plot grids = 0 dB',
    timesSeconds: times,
    frequenciesHz: frequencies,
    values: db,
    layout: 'frequency rows × time columns',
    dbMin: options.floor,
    dbMax: 0,
  };

  const plotData = {
    source: fileName, sampleRate, channel: options.channel, channels,
    fftSize, window: 'Hann; centered frames, zero padding',
    reference: 'maximum interpolated spectral power across landscape and plot grids = 0 dB',
    timesSeconds: plotTimes, frequenciesHz: frequencies, values: plotDb,
    layout: 'frequency rows × time columns', timeScale: options['plot-time'],
    frequencyScale: 'log', dbMin: options.floor, dbMax: 0,
  };

  const landscapeData = {
    timesSeconds: times,
    frequenciesHz: frequencies,
    values,
    dbMin: options.floor,
    dbMax: 0,
    timeScale: 'linear',
    frequencyScale: 'log',
    shape: 'circular',
    arcDegrees: options.arc,
    timeDirection: 'clockwise',
    gapDirection: '-Y',
    geometryMm,
  };

  const { vertices, faces } = buildMesh(options, values);

  return {
    spectrogram,
    plotData,
    landscapeData,
    stlBytes: encodeStl(vertices, faces),
  };
}
