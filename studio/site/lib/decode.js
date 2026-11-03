// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

/**
 * Analysis rates offered in the UI. A preset list is used rather than a free
 * number field because some browsers only accept a limited set of rates for an
 * OfflineAudioContext.
 */
export const ANALYSIS_RATES = [22050, 44100, 48000, 96000];

/**
 * Decodes an audio file into mono float samples at a fixed analysis rate.
 *
 * The file is resampled to `rate` during decoding, so the result never depends
 * on the file's own sample rate or on the audio hardware. That makes the
 * generated model reproducible across machines, but it also means the analysis
 * window (fft / rate seconds) and bin width (rate / fft Hz) are set by `rate`
 * rather than inherited from the file.
 *
 * MUST run on the main thread: Web Audio, including OfflineAudioContext, is not
 * exposed in WorkerGlobalScope.
 *
 * @param {ArrayBuffer} bytes raw file bytes. Note that decodeAudioData detaches
 *   this buffer, so it cannot be reused afterwards.
 * @param {{ rate: number, channel: number }} settings
 * @returns {Promise<{ samples: Float32Array, sampleRate: number, channels: number }>}
 */
export async function decodeAudio(bytes, { rate, channel }) {
  let context;
  try {
    context = new OfflineAudioContext(1, 1, rate);
  } catch {
    throw new Error(`This browser cannot decode at ${rate} Hz.`);
  }

  let buffer;
  try {
    buffer = await context.decodeAudioData(bytes);
  } catch {
    throw new Error('This file could not be decoded. Try a WAV, AIFF, MP3, or Ogg file.');
  }

  // decodeAudioData always returns the file's own channel count.
  const channels = buffer.numberOfChannels;
  if (channel >= channels) {
    throw new Error(`Channel ${channel} does not exist; this file has ${channels}.`);
  }

  // Copy out of the AudioBuffer so the result can be transferred to the worker.
  const samples = buffer.getChannelData(channel).slice();
  return { samples, sampleRate: rate, channels };
}
