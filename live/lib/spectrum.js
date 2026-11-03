// ---------------------------------------------------------------------------
// Live spectrum
// ---------------------------------------------------------------------------

/**
 * Spectrum analysis for the live microphone view.
 *
 * The file pipeline normalises a whole recording to its loudest sample. A live
 * stream has no such reference, so levels stay in dBFS and are clamped to the
 * same floor; the ring then reflects how loud the room actually is and does
 * not pump when it goes quiet.
 *
 * The grid is deliberately smaller than the exported relief: its heights are
 * rewritten thirty times a second, together with the mesh positions. Time
 * columns come from the chosen history length; frequency rows stay fixed.
 */

export const FFT_SIZE = 4096;
export const FPS = 30;
export const ROWS = 51;
export const MIN_DB = -100;

/**
 * Resamples analyser bins onto logarithmically spaced frequency rows.
 *
 * Each row takes the loudest bin in its own band rather than a single point
 * sample: the bands are contiguous, so a narrow tone cannot slip between rows
 * and disappear. Bands narrower than one bin fall back to interpolated power,
 * matching the file pipeline.
 *
 * @param {Float32Array} bins dBFS per FFT bin
 * @param {{ rows: number, fmin: number, fmax: number, fftSize: number, sampleRate: number }} options
 * @returns {Float64Array} one dB value per row
 */
export function rowsFromBins(bins, { rows, fmin, fmax, fftSize, sampleRate }) {
  const top = Math.min(fmax, sampleRate / 2);
  const lastBin = fftSize / 2 - 1;
  const ratio = top / fmin;
  const frequencyAt = (position) => fmin * ratio ** (position / (rows - 1));
  const binAt = (frequency) => Math.min(Math.max((frequency * fftSize) / sampleRate, 0), lastBin);
  const result = new Float64Array(rows);

  for (let j = 0; j < rows; j++) {
    const centre = frequencyAt(j);
    const lower = j > 0 ? Math.sqrt(frequencyAt(j - 1) * centre) : fmin;
    const upper = j < rows - 1 ? Math.sqrt(centre * frequencyAt(j + 1)) : top;

    const start = Math.ceil(binAt(lower));
    const end = Math.floor(binAt(upper));

    if (end < start) {
      const bin = binAt(centre);
      const k = Math.min(Math.floor(bin), lastBin);
      const l = Math.min(k + 1, lastBin);
      const frac = bin - k;
      result[j] = 10 * Math.log10(
        10 ** (bins[k] / 10) * (1 - frac) + 10 ** (bins[l] / 10) * frac
      );
      continue;
    }

    let peak = -Infinity;
    for (let b = start; b <= end; b++) peak = Math.max(peak, bins[b]);
    result[j] = peak;
  }

  return result;
}

/**
 * 1-2-1 smoothing along time only.
 *
 * Frequency smoothing is deliberately absent: on this coarse grid a narrow
 * tone occupies a single row, and averaging it with silent neighbours would
 * flatten it into the base.
 */
function smoothTime(values, cols) {
  return values.map((row) => {
    const smoothed = new Float64Array(cols);

    for (let i = 0; i < cols; i++) {
      const previous = row[Math.max(0, i - 1)];
      const next = row[Math.min(cols - 1, i + 1)];
      smoothed[i] = (previous + 2 * row[i] + next) / 4;
    }

    return smoothed;
  });
}

/**
 * Rolling frequency × time history. The newest column is the last one, so the
 * relief fills from its arc start and advances clockwise, as in the player.
 *
 * @param {{ rows: number, cols: number, floor: number }} options
 */
export function createHistory({ rows, cols, floor }) {
  const columns = Array.from({ length: rows }, () => new Float64Array(cols).fill(floor));

  return {
    /** Appends one measured row, dropping the oldest column. */
    push(row) {
      for (let j = 0; j < rows; j++) {
        const values = columns[j];
        values.copyWithin(0, 1);
        values[cols - 1] = Math.max(floor, Math.min(0, row[j]));
      }
    },

    /** The history after smoothing, ready to turn into heights. */
    smoothed() {
      return smoothTime(columns, cols);
    },

    /** Returns to a flat, silent ring. */
    reset() {
      for (const values of columns) values.fill(floor);
    },
  };
}
