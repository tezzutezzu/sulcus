// ---------------------------------------------------------------------------
// Analysis worker
// ---------------------------------------------------------------------------

/**
 * Runs the relief pipeline and the mould build off the main thread.
 *
 * Decoding stays on the main thread because Web Audio is not available here,
 * so the main thread sends already-decoded mono samples and this worker does
 * the STFT, smoothing, mesh, STL and mould.
 */

import { generate } from './lib/landscape.js';
import { buildMould } from './lib/mould.js';

self.onmessage = (event) => {
  const { samples, sampleRate, channels, fileName, options, mouldOptions } = event.data;

  try {
    const result = generate({ samples, sampleRate, channels, fileName, options });
    const mould = buildMould(result.landscapeData, mouldOptions);

    // Hand the buffers over rather than copying them.
    self.postMessage(
      {
        ok: true,
        stlBytes: result.stlBytes,
        mouldStlBytes: mould.stlBytes,
        mouldStats: {
          triangles: mould.triangles,
          bounds: mould.bounds,
          cavityVolume: mould.cavityVolume,
        },
        spectrogram: result.spectrogram,
        plotData: result.plotData,
        landscapeData: result.landscapeData,
      },
      [result.stlBytes, mould.stlBytes]
    );
  } catch (error) {
    self.postMessage({ ok: false, error: error.message });
  }
};
