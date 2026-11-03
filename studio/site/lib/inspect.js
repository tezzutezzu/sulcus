// ---------------------------------------------------------------------------
// File inspection
// ---------------------------------------------------------------------------

/**
 * Reads what can be known about an audio file without decoding it.
 *
 * The sample rate has to come from the container header: `decodeAudioData`
 * always resamples to the target rate, so the decoded buffer never reveals the
 * file's own rate. Only RIFF/WAVE is parsed here; for other formats the rate is
 * simply unknown, while the duration is still available.
 */

function ascii(view, from, to) {
  let text = '';
  for (let i = from; i < to; i++) text += String.fromCharCode(view.getUint8(i));
  return text;
}

/**
 * Reads the `fmt ` chunk of a RIFF/WAVE header.
 * @param {ArrayBuffer} bytes the first part of the file; a few kilobytes is plenty
 * @returns {{ sampleRate: number, channels: number, format: number } | null}
 */
export function readWavFormat(bytes) {
  const view = new DataView(bytes);
  if (view.byteLength < 12) return null;
  if (ascii(view, 0, 4) !== 'RIFF' || ascii(view, 8, 12) !== 'WAVE') return null;

  for (let pos = 12; pos + 8 <= view.byteLength; ) {
    const id = ascii(view, pos, pos + 4);
    const size = view.getUint32(pos + 4, true);
    const start = pos + 8;

    if (id === 'fmt ' && size >= 16 && start + 16 <= view.byteLength) {
      let format = view.getUint16(start, true);
      // WAVE_FORMAT_EXTENSIBLE stores the real format code in the sub-format.
      if (format === 0xfffe && size >= 40 && start + 26 <= view.byteLength) {
        format = view.getUint16(start + 24, true);
      }
      return {
        sampleRate: view.getUint32(start + 4, true),
        channels: view.getUint16(start + 2, true),
        format,
      };
    }

    // A chunk we cannot see the end of: nothing useful further on.
    if (start + size > view.byteLength) return null;
    pos = start + size + (size % 2);
  }

  return null;
}

/**
 * Duration in seconds, via a throwaway audio element. Reading metadata does not
 * decode the whole file, so this stays cheap for large inputs.
 *
 * @param {string} url object URL for the file
 * @returns {Promise<number | null>} null when the browser cannot determine it
 */
export function readDuration(url) {
  return new Promise((resolve) => {
    const probe = new Audio();
    probe.preload = 'metadata';

    const finish = (value) => {
      probe.removeAttribute('src');
      resolve(value);
    };

    probe.addEventListener('loadedmetadata', () => {
      finish(Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration : null);
    }, { once: true });

    probe.addEventListener('error', () => finish(null), { once: true });

    probe.src = url;
  });
}
