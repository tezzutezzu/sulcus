// ---------------------------------------------------------------------------
// Generator UI
// ---------------------------------------------------------------------------

/**
 * Wires the generate form to the analysis pipeline.
 *
 * Order of operations per run:
 *   read form -> validate -> fetch/read audio -> decode (main thread)
 *   -> worker (STFT, mesh, STL) -> downloads -> viewer -> ring player.
 *
 * The viewer is imported dynamically so that an unreachable CDN degrades to
 * "no 3D preview" instead of breaking the page.
 */

import { DEFAULTS, validateOptions } from './lib/landscape.js';
import { decodeAudio } from './lib/decode.js';
import { readDuration, readWavFormat } from './lib/inspect.js';
import { render as renderSpectrogram } from './spectrogram.js';

const DEFAULT_AUDIO = '../impulse.wav';

const form = document.querySelector('#generate-form');
const fileInput = document.querySelector('#audio-file');
const secondsInput = document.querySelector('#seconds');
const rateSelect = document.querySelector('#analysisRate');
const generateButton = document.querySelector('#generate');
const statusLine = document.querySelector('#generate-status');
const rateWarning = document.querySelector('#rate-warning');
const viewerHost = document.querySelector('#viewer');
const spectrogramCanvas = document.querySelector('#spectrogram');
const viewerNote = document.querySelector('#viewer-note');
const previewSelect = document.querySelector('#preview-model');
const downloadRow = document.querySelector('#downloads');
const downloadStl = document.querySelector('#download-stl');
const downloadMould = document.querySelector('#download-mould');
const downloadLandscape = document.querySelector('#download-landscape');
const downloadSpectrogram = document.querySelector('#download-spectrogram');
const downloadPlot = document.querySelector('#download-plot');

let worker = null;
let viewerModule = null;
let objectUrls = [];
let audioUrl = null;
let currentResult = null;

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

/** Reads the form into a plain options object, coercing numeric fields. */
function readOptions() {
  const options = { ...DEFAULTS };

  for (const [key, value] of new FormData(form)) {
    if (key === 'audio-file') continue;
    if (key.startsWith('mould-')) continue;

    if (typeof DEFAULTS[key] === 'number') {
      const number = Number(value);
      if (!Number.isFinite(number)) throw new Error(`Enter a number for "${key}".`);
      options[key] = number;
    } else {
      options[key] = value;
    }
  }

  return options;
}

/** Reads the clay mould controls and checks them before the worker runs. */
function readMouldOptions() {
  const read = (name) => {
    const number = Number(form.elements[name].value);
    if (!Number.isFinite(number)) throw new Error(`Enter a number for "${name}".`);
    return number;
  };

  const options = {
    relief: read('mould-relief'),
    slope: read('mould-slope'),
    scale: read('mould-scale'),
    back: read('mould-back'),
  };

  if (options.relief <= 0) throw new Error('The mould relief must be positive.');
  if (options.slope <= 0 || options.slope >= 90) {
    throw new Error('The slope limit must lie between 0 and 90 degrees.');
  }
  if (options.scale <= 0) throw new Error('The mould scale must be positive.');
  if (options.back <= 0) throw new Error('The back thickness must be positive.');

  return options;
}

/** The analysis rate caps the highest usable frequency, so say so up front. */
function syncRateWarning() {
  const rate = Number(rateSelect.value);
  const fmax = Number(form.elements.fmax.value);

  if (Number.isFinite(fmax) && fmax > rate / 2) {
    rateWarning.hidden = false;
    rateWarning.textContent =
      `fmax ${fmax} Hz is above the ${rate / 2} Hz Nyquist limit of a ${rate} Hz analysis rate, so it will be clamped.`;
  } else {
    rateWarning.hidden = true;
    rateWarning.textContent = '';
  }
}

function setStatus(kind, message) {
  statusLine.dataset.kind = kind;
  statusLine.textContent = message;
}

function noteViewer(message) {
  viewerNote.hidden = false;
  viewerNote.textContent = message;
}

function clearViewerNote() {
  viewerNote.hidden = true;
  viewerNote.textContent = '';
}

// ---------------------------------------------------------------------------
// File inspection
// ---------------------------------------------------------------------------

/** Rates an OfflineAudioContext is widely expected to accept. */
const USABLE_RATE = { min: 8000, max: 192000 };

function clearCustomRates() {
  rateSelect.querySelectorAll('option[data-custom]').forEach((option) => option.remove());
}

/**
 * Selects the file's own rate, adding an option when it is not one of the
 * presets so the detected value stays visible in the control.
 */
function setAnalysisRate(rate) {
  clearCustomRates();

  const preset = Array.from(rateSelect.options).find((option) => Number(option.value) === rate);
  if (preset) {
    rateSelect.value = preset.value;
    return;
  }

  const custom = document.createElement('option');
  custom.value = String(rate);
  custom.textContent = `${rate} Hz (file)`;
  custom.dataset.custom = 'true';
  rateSelect.append(custom);
  rateSelect.value = custom.value;
}

/** Fills in whatever the chosen file reveals about itself. */
async function inspectFile(file) {
  const header = await file.slice(0, 65536).arrayBuffer();
  const format = readWavFormat(header);

  const url = URL.createObjectURL(file);
  const seconds = await readDuration(url);
  URL.revokeObjectURL(url);

  const found = [];
  let unusableRate = null;

  if (seconds) {
    // Round up to two decimals; the analysis clamps to the real length anyway.
    secondsInput.value = String(Math.ceil(seconds * 100) / 100);
    found.push(`${seconds.toFixed(2)} s`);
  }

  if (format && format.sampleRate) {
    if (format.sampleRate >= USABLE_RATE.min && format.sampleRate <= USABLE_RATE.max) {
      setAnalysisRate(format.sampleRate);
      found.push(`${format.sampleRate} Hz`);
    } else {
      unusableRate = format.sampleRate;
    }
  }

  syncRateWarning();

  if (found.length) {
    setStatus('ok', `${file.name}: ${found.join(', ')} — fields updated.`);
  } else if (unusableRate) {
    setStatus('error', `${file.name}: ${unusableRate} Hz is outside the range this browser can analyse.`);
  } else {
    setStatus('error', `Could not read the format of ${file.name}; fields left unchanged.`);
  }
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

function runWorker(payload) {
  if (!worker) worker = new Worker('./worker.js', { type: 'module' });

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    };
    const onMessage = (event) => {
      cleanup();
      if (event.data && event.data.ok) resolve(event.data);
      else reject(new Error((event.data && event.data.error) || 'The analysis failed.'));
    };
    const onError = (event) => {
      cleanup();
      reject(new Error(event.message || 'The analysis worker could not be started.'));
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);

    // The sample buffer moves to the worker; the main thread no longer owns it.
    worker.postMessage(payload, [payload.samples.buffer]);
  });
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

async function readSource() {
  const file = fileInput.files && fileInput.files[0];

  if (file) {
    return { bytes: await file.arrayBuffer(), fileName: file.name, file };
  }

  const response = await fetch(DEFAULT_AUDIO);
  if (!response.ok) throw new Error(`Could not load ${DEFAULT_AUDIO}.`);
  return { bytes: await response.arrayBuffer(), fileName: DEFAULT_AUDIO.split('/').pop(), file: null };
}

/** Makes playback follow the file that was actually analysed. */
async function pointAudioAtFile(file) {
  const audio = document.querySelector('#audio');
  if (!audio) return;

  audio.pause();
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(file);
  audio.src = audioUrl;

  await new Promise((resolve) => {
    audio.addEventListener('loadedmetadata', resolve, { once: true });
    audio.addEventListener('error', resolve, { once: true });
  });
}

function publishRelief(data) {
  document.dispatchEvent(new CustomEvent('relief:data', { detail: data }));
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

function setDownload(link, name, blob) {
  const url = URL.createObjectURL(blob);
  objectUrls.push(url);
  link.href = url;
  link.download = name;
}

function offerDownloads(result) {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls = [];
  currentResult = result;

  const json = (value) => new Blob([JSON.stringify(value)], { type: 'application/json' });

  setDownload(downloadStl, 'landscape.stl', new Blob([result.stlBytes], { type: 'model/stl' }));
  setDownload(downloadMould, 'mould.stl', new Blob([result.mouldStlBytes], { type: 'model/stl' }));
  downloadMould.hidden = false;

  previewSelect.querySelector('option[value="mould"]').disabled = false;
  previewSelect.disabled = false;

  setDownload(downloadLandscape, 'landscape-data.json', json(result.landscapeData));
  setDownload(downloadSpectrogram, 'spectrogram.json', json(result.spectrogram));
  setDownload(downloadPlot, 'spectrogram-plot-data.json', json(result.plotData));

  downloadRow.hidden = false;
}

async function showCurrentModel() {
  if (!currentResult) return;

  const useMould = previewSelect.value === 'mould';
  const bytes = useMould ? currentResult.mouldStlBytes : currentResult.stlBytes;

  try {
    if (!viewerModule) viewerModule = await import('../../live/lib/viewer.js');
    viewerModule.mount(viewerHost);
    viewerModule.show(bytes);
    clearViewerNote();
  } catch (error) {
    noteViewer(`The 3D preview is unavailable: ${error.message} Files can still be downloaded.`);
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function run(event) {
  event.preventDefault();

  let options;
  let mouldOptions;
  try {
    options = readOptions();
    validateOptions(options);
    mouldOptions = readMouldOptions();
  } catch (error) {
    setStatus('error', error.message);
    return;
  }

  generateButton.disabled = true;
  const started = performance.now();

  try {
    const { bytes, fileName, file } = await readSource();

    setStatus('busy', `Decoding at ${options.analysisRate} Hz…`);
    const { samples, sampleRate, channels } = await decodeAudio(bytes, {
      rate: options.analysisRate,
      channel: options.channel,
    });

    setStatus('busy', `Analysing ${samples.length.toLocaleString()} samples…`);
    const result = await runWorker({ samples, sampleRate, channels, fileName, options, mouldOptions });

    offerDownloads(result);
    renderSpectrogram(spectrogramCanvas, result.plotData);
    document.dispatchEvent(new CustomEvent('spectrogram:data', { detail: result.plotData }));
    await showCurrentModel();

    if (file) await pointAudioAtFile(file);
    publishRelief(result.landscapeData);

    const megabytes = (result.stlBytes.byteLength / 1048576).toFixed(1);
    const mouldInfo = `, mould ${(result.mouldStlBytes.byteLength / 1048576).toFixed(1)} MB`;
    const elapsed = Math.round(performance.now() - started);
    setStatus('ok', `Generated ${megabytes} MB of STL${mouldInfo} in ${elapsed} ms at ${sampleRate} Hz.`);
  } catch (error) {
    setStatus('error', error.message);
  } finally {
    generateButton.disabled = false;
  }
}

form.addEventListener('submit', run);
rateSelect.addEventListener('change', syncRateWarning);
form.elements.fmax.addEventListener('input', syncRateWarning);
previewSelect.addEventListener('change', showCurrentModel);

fileInput.addEventListener('change', () => {
  const file = fileInput.files && fileInput.files[0];

  if (!file) {
    clearCustomRates();
    return;
  }

  inspectFile(file).catch((error) => setStatus('error', error.message));
});

syncRateWarning();
renderSpectrogram(spectrogramCanvas, null);
