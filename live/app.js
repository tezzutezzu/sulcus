// ---------------------------------------------------------------------------
// Live input view
// ---------------------------------------------------------------------------

/**
 * Captures the chosen input and drives the acoustic relief ring in real time.
 *
 * One analyser frame per tick becomes one column of a rolling history; the
 * top-surface heights of a mesh allocated once are rewritten in place. The
 * history length sets the column count, so changing it rebuilds the ring but
 * leaves the open capture and the camera alone. The relief layout, material,
 * lighting and camera come from the generator's viewer.
 */

import { RELIEF_DEFAULTS, reliefHeight, reliefTopology } from './lib/relief.js';
import { FFT_SIZE, FPS, MIN_DB, ROWS, createHistory, rowsFromBins } from './lib/spectrum.js';
import { createBandPlot } from './lib/band-plot.js';
import {
  describeError,
  listSources,
  openSource,
  optionFromSource,
  readPreference,
  rememberPreference,
  sourceFromOption,
} from './lib/audio-input.js';

const LENGTHS = [5, 10, 15, 20, 30];
const FREQUENCIES = { fmin: 50, fmax: 20000 };
/** The band plot reduces the spectrum to a finer grid than the ring's. */
const PLOT_ROWS = 121;
const DEFAULT_LENGTH = 15;
const LENGTH_KEY = 'sulcus:live-length';
const LEGACY_LENGTH_KEY = 'sound-form:live-length';

const button = document.querySelector('#live-toggle');
const sourceSelect = document.querySelector('#live-source');
const lengthSelect = document.querySelector('#live-length');
const status = document.querySelector('#live-status');
const viewerHost = document.querySelector('#viewer');
const filterCanvas = document.querySelector('#filter-canvas');
const filterPlot = document.querySelector('#filter-plot');
const filterLow = document.querySelector('#filter-low');
const filterHigh = document.querySelector('#filter-high');
const filterLowLabel = document.querySelector('#filter-low-label');
const filterHighLabel = document.querySelector('#filter-high-label');

let seconds = readLength();
let band = { low: FREQUENCIES.fmin, high: FREQUENCIES.fmax };
let grid = null;
let positions = null;
let indices = null;
let history = null;
let topCount = 0;
let nx = 0;

let viewer = null;
let plot = null;
let mounted = false;
let stream = null;
let context = null;
let analyser = null;
let bins = null;
let timer = null;
let releasing = false;
let selection = readPreference();
let active = null;

function readLength() {
  try {
    const stored = readStoredLength();
    if (LENGTHS.includes(stored)) return stored;
  } catch {
    // Storage may be unavailable; fall back to the default.
  }

  return DEFAULT_LENGTH;
}

/** Reads the remembered length, moving it off the pre-rename key once. */
function readStoredLength() {
  const current = localStorage.getItem(LENGTH_KEY);
  if (current !== null) return Number(current);

  const legacy = localStorage.getItem(LEGACY_LENGTH_KEY);
  if (legacy === null) return NaN;

  localStorage.setItem(LENGTH_KEY, legacy);
  localStorage.removeItem(LEGACY_LENGTH_KEY);
  return Number(legacy);
}

function rememberLength(value) {
  try {
    localStorage.setItem(LENGTH_KEY, String(value));
  } catch {
    // Storage may be unavailable; the choice still applies to this session.
  }
}

// ---------------------------------------------------------------------------
// Ring
// ---------------------------------------------------------------------------

function buildRing() {
  // The band, not the frequency defaults, decides which range the rows cover.
  grid = { ...RELIEF_DEFAULTS, rows: ROWS, cols: seconds * FPS };

  const topology = reliefTopology(grid);
  topCount = topology.topCount;
  nx = topology.nx;

  positions = new Float32Array(topology.vertices.length * 3);
  for (let k = 0; k < topology.vertices.length; k++) {
    positions[k * 3] = topology.vertices[k][0];
    positions[k * 3 + 1] = topology.vertices[k][1];
    positions[k * 3 + 2] = k < topCount ? grid.base : 0;
  }

  indices = new Uint32Array(topology.faces.length * 3);
  topology.faces.forEach((face, index) => indices.set(face, index * 3));

  history = createHistory({ rows: ROWS, cols: grid.cols, floor: grid.floor });
}

function writeHeights(values) {
  for (let k = 0; k < topCount; k++) {
    const j = Math.floor(k / nx);
    positions[k * 3 + 2] = reliefHeight(values[j][k - j * nx], grid);
  }

  if (viewer) viewer.updateMesh();
}

/** Builds the ring for the selected length and shows it, framing only once. */
function applyRing() {
  buildRing();

  if (viewer) {
    viewer.showMesh(positions, indices, { frame: !mounted });
    mounted = true;
  }

  writeHeights(history.smoothed());
}

/**
 * Appends one measured spectrum (dB per row) and redraws the ring.
 * This is the single path from analysis to geometry, also used by tick().
 */
export function pushRow(row) {
  history.push(row);
  writeHeights(history.smoothed());
}

function tick() {
  analyser.getFloatFrequencyData(bins);

  const options = { fftSize: FFT_SIZE, sampleRate: context.sampleRate };

  // The ring shows only the chosen band; the plot keeps the whole range in view
  // so the band is visible in context.
  pushRow(rowsFromBins(bins, { rows: ROWS, fmin: band.low, fmax: band.high, ...options }));

  if (plot) {
    plot.setValues(rowsFromBins(bins, {
      rows: PLOT_ROWS,
      fmin: FREQUENCIES.fmin,
      fmax: FREQUENCIES.fmax,
      ...options,
    }));
  }
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

async function release() {
  releasing = true;

  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  analyser = null;
  bins = null;

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  if (context) {
    const closing = context;
    context = null;
    try {
      await closing.close();
    } catch {
      // Already closed; nothing to release.
    }
  }

  active = null;
  releasing = false;
}

function showError(error, source) {
  button.textContent = 'Retry input';
  button.setAttribute('aria-pressed', 'false');
  status.textContent = describeError(error, source);
}

async function begin(source) {
  const opened = await openSource(source);
  stream = opened.stream;
  active = source;

  const [track] = stream.getAudioTracks();
  track.addEventListener('ended', () => {
    if (releasing) return;
    release();
    button.textContent = 'Reconnect input';
    button.setAttribute('aria-pressed', 'false');
    status.textContent = 'The input disconnected. Choose a source and try again.';
    refreshSources();
  });

  context = new AudioContext();
  await context.resume();

  const node = context.createMediaStreamSource(stream);
  analyser = context.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  // The history does its own smoothing; no time smoothing here.
  analyser.smoothingTimeConstant = 0;
  analyser.minDecibels = MIN_DB;
  analyser.maxDecibels = 0;

  // A silent sink keeps the graph running without monitoring the input.
  const sink = context.createGain();
  sink.gain.value = 0;
  node.connect(analyser).connect(sink).connect(context.destination);

  bins = new Float32Array(analyser.frequencyBinCount);
  history.reset();
  writeHeights(history.smoothed());

  timer = setInterval(tick, 1000 / FPS);
  button.textContent = 'Stop';
  button.setAttribute('aria-pressed', 'true');
  status.textContent = source.kind === 'display'
    ? 'Listening to the shared audio.'
    : 'Listening to the input.';

  // Labels only become available after the first successful capture.
  refreshSources();
}

async function start() {
  button.disabled = true;
  sourceSelect.disabled = true;
  button.textContent = 'Starting…';

  try {
    await begin(selection);
  } catch (error) {
    await release();
    showError(error, selection);
  } finally {
    button.disabled = false;
    sourceSelect.disabled = false;
  }
}

async function stop() {
  button.disabled = true;
  sourceSelect.disabled = true;
  await release();
  button.textContent = 'Start';
  button.setAttribute('aria-pressed', 'false');
  status.textContent = 'Capture stopped.';
  button.disabled = false;
  sourceSelect.disabled = false;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

async function refreshSources() {
  const sources = await listSources();

  sourceSelect.replaceChildren(...sources.map(({ id, label }) => {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = label;
    return option;
  }));

  let value = optionFromSource(selection);
  if (!sources.some((option) => option.id === value)) {
    // The remembered device is gone; fall back to the default.
    selection = { kind: 'microphone', deviceId: '' };
    rememberPreference(selection);
    value = 'default';
  }

  sourceSelect.value = value;
}

async function changeSource() {
  const next = sourceFromOption(sourceSelect.value);
  const previous = active;
  const wasCapturing = Boolean(stream);

  selection = next;
  rememberPreference(next);

  if (!wasCapturing) {
    status.textContent = `Source: ${sourceSelect.selectedOptions[0].textContent}.`;
    return;
  }

  button.disabled = true;
  sourceSelect.disabled = true;
  await release();

  try {
    await begin(next);
  } catch (error) {
    selection = previous || { kind: 'microphone', deviceId: '' };
    sourceSelect.value = optionFromSource(selection);
    rememberPreference(selection);
    showError(error, next);
  } finally {
    button.disabled = false;
    sourceSelect.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Length
// ---------------------------------------------------------------------------

function changeLength() {
  const next = Number(lengthSelect.value);
  seconds = LENGTHS.includes(next) ? next : DEFAULT_LENGTH;
  lengthSelect.value = String(seconds);
  rememberLength(seconds);

  applyRing();
  status.textContent = `Showing the last ${seconds} seconds.`;
}

// ---------------------------------------------------------------------------
// Band
// ---------------------------------------------------------------------------

/**
 * Adopts a new band. The stored columns are dB values indexed by row, so they
 * only mean something under the row mapping that produced them: the history
 * starts again rather than showing the old audio stretched into the new band.
 */
function changeBand(next) {
  band = next;
  if (!history) return;

  history.reset();
  writeHeights(history.smoothed());
}

// ---------------------------------------------------------------------------
// Camera shortcuts
// ---------------------------------------------------------------------------

function handleShortcut(event) {
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || !viewer) return;

  const target = event.target;
  if (target instanceof HTMLElement &&
      ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;

  const key = event.key.toLowerCase();
  if (key === 't') {
    viewer.setTopView();
    status.textContent = 'Top view.';
  } else if (key === 'r') {
    viewer.resetView();
    status.textContent = 'View reset.';
  } else if (key === 'a') {
    status.textContent = viewer.toggleAutoRotate() ? 'Auto-orbit on.' : 'Auto-orbit off.';
  } else if (key === 'c') {
    if (!viewer.logCamera()) return;
    status.textContent = 'Camera position logged to the console.';
  } else {
    return;
  }

  event.preventDefault();
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  lengthSelect.value = String(seconds);

  plot = createBandPlot({
    canvas: filterCanvas,
    surface: filterPlot,
    handles: { low: filterLow, high: filterHigh },
    labels: { low: filterLowLabel, high: filterHighLabel },
    min: FREQUENCIES.fmin,
    max: FREQUENCIES.fmax,
    floor: RELIEF_DEFAULTS.floor,
    band,
    onChange: changeBand,
  });

  try {
    viewer = await import('./lib/viewer.js');
    viewer.mount(viewerHost);
    applyRing();
  } catch (error) {
    viewer = null;
    button.disabled = true;
    sourceSelect.disabled = true;
    button.textContent = '3D unavailable';
    status.textContent = `The 3D visualiser could not start: ${error.message}`;
  }

  refreshSources();
}

button.addEventListener('click', () => {
  if (stream) stop();
  else start();
});

sourceSelect.addEventListener('change', changeSource);
lengthSelect.addEventListener('change', changeLength);
document.addEventListener('keydown', handleShortcut);

if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', () => {
    refreshSources();
  });
}

// A page restored from the back/forward cache has no live audio anymore.
window.addEventListener('pagehide', (event) => {
  release();

  if (!event.persisted && plot) {
    plot.destroy();
    plot = null;
  }
});

window.addEventListener('pageshow', (event) => {
  if (!event.persisted || stream || !viewer) return;
  button.textContent = 'Start';
  button.setAttribute('aria-pressed', 'false');
  status.textContent = 'Press Start to visualise the input.';
});

init();
