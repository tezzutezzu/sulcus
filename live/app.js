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
import { encodeStl } from './lib/stl.js';
import {
  describeError,
  listSources,
  openSource,
  optionFromSource,
  readPreference,
  rememberPreference,
  sourceFromOption,
} from './lib/audio-input.js';

const MIN_SECONDS = 1;
const MAX_SECONDS = 60;
const FREQUENCIES = { fmin: 50, fmax: 20000 };
/** The band plot reduces the spectrum to a finer grid than the ring's. */
const PLOT_ROWS = 121;
const DEFAULT_LENGTH = 15;

/**
 * Capture button icons, inline so the published page needs no icon font and no
 * extra request. Each is a 24×24 drawing using the button's own ink colour.
 */
const ICONS = {
  record: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="currentColor"/></svg>',
  loading: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" ' +
    'stroke="currentColor" stroke-width="2.8" stroke-linecap="round" ' +
    'stroke-dasharray="40 16.5"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="5.5" y="5.5" width="13" height="13" rx="2.6" ' +
    'fill="currentColor"/></svg>',
  retry: '<svg viewBox="0 0 24 24"><path d="M4.2 12a7.8 7.8 0 1 0 2.3-5.5" fill="none" ' +
    'stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' +
    '<path d="M4 3.6v4.4h4.4" fill="none" stroke="currentColor" stroke-width="2.4" ' +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>',
  alert: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" ' +
    'stroke="currentColor" stroke-width="2.2"/><path d="M12 6.8v6.4" ' +
    'stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' +
    '<circle cx="12" cy="16.6" r="1.35" fill="currentColor"/></svg>',
};

const button = document.querySelector('#live-toggle');
const buttonIcon = document.querySelector('#live-toggle-icon');
const buttonLabel = document.querySelector('#live-toggle-label');
const sourceSelect = document.querySelector('#live-source');
const lengthInput = document.querySelector('#live-length');
const lengthValue = document.querySelector('#live-length-value');
const downloadButton = document.querySelector('#live-download');
const status = document.querySelector('#live-status');
const viewerHost = document.querySelector('#viewer');
const filterCanvas = document.querySelector('#filter-canvas');
const filterPlot = document.querySelector('#filter-plot');
const filterLow = document.querySelector('#filter-low');
const filterHigh = document.querySelector('#filter-high');
const filterLowLabel = document.querySelector('#filter-low-label');
const filterHighLabel = document.querySelector('#filter-high-label');

let seconds = DEFAULT_LENGTH;
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
let lengthTimer = null;
let releasing = false;
let selection = readPreference();
let active = null;

/** Whole seconds inside the allowed range; anything else falls back. */
function clampLength(value) {
  if (!Number.isFinite(value)) return DEFAULT_LENGTH;
  return Math.min(Math.max(Math.round(value), MIN_SECONDS), MAX_SECONDS);
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
  setButton({ icon: 'retry', label: 'Retry input', showLabel: true, pressed: false });
  status.textContent = describeError(error, source);
}

/**
 * Paints the capture button. The icon carries the state and the label is its
 * accessible name; it is only shown inline when the state needs words, which
 * happens for the failures where the icon alone cannot say what to do next.
 */
function setButton({ icon, label, showLabel = false, pressed }) {
  buttonIcon.innerHTML = ICONS[icon];
  buttonLabel.textContent = label;
  buttonLabel.classList.toggle('sr-only', !showLabel);
  button.classList.toggle('is-labelled', showLabel);
  button.classList.toggle('is-loading', icon === 'loading');
  if (pressed !== undefined) button.setAttribute('aria-pressed', String(pressed));
}

async function begin(source) {
  const opened = await openSource(source);
  stream = opened.stream;
  active = source;

  const [track] = stream.getAudioTracks();
  track.addEventListener('ended', () => {
    if (releasing) return;
    release();
    setButton({ icon: 'retry', label: 'Reconnect input', showLabel: true, pressed: false });
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
  setButton({ icon: 'stop', label: 'Stop', pressed: true });
  status.textContent = source.kind === 'display'
    ? 'Listening to the shared audio.'
    : 'Listening to the input.';

  // Labels only become available after the first successful capture.
  refreshSources();
}

async function start() {
  button.disabled = true;
  sourceSelect.disabled = true;
  setButton({ icon: 'loading', label: 'Starting', pressed: false });

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
  setButton({ icon: 'record', label: 'Start', pressed: false });
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

/** Adopts a length: rebuilds the ring when it really changed. */
function adoptLength(next) {
  const clamped = clampLength(next);
  const unchanged = clamped === seconds;

  seconds = clamped;
  showLength();

  if (unchanged) return;

  applyRing();
  status.textContent = `Showing the last ${seconds} seconds.`;
}

/** Reflects a length in the slider and its readout, without rebuilding. */
function renderLength(value) {
  const clamped = clampLength(value);
  lengthInput.value = String(clamped);
  lengthInput.setAttribute('aria-valuetext', `${clamped} seconds`);
  lengthValue.textContent = `${clamped} s`;
}

function showLength() {
  renderLength(seconds);
}

/**
 * Commits the slider after a pause: a release is one step, while a held arrow
 * key repeats and would otherwise rebuild the ring on every repeat.
 */
function scheduleLength() {
  clearTimeout(lengthTimer);
  lengthTimer = setTimeout(() => {
    lengthTimer = null;
    adoptLength(lengthInput.valueAsNumber);
  }, 120);
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/**
 * Local YYYYMMDD-HHMMSS. Seconds, not minutes: two downloads in the same minute
 * would otherwise share a name and the second would overwrite the first.
 */
function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * Saves the ring exactly as it is on screen. Nothing is recomputed: the buffers
 * already hold the current band mapping and history length, and capture keeps
 * running while the file is written.
 */
function downloadStl() {
  if (!positions || !indices) return;

  const bytes = encodeStl(positions, indices);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'model/stl' }));
  const link = document.createElement('a');

  link.href = url;
  link.download = `sulcus-live-${stamp()}.stl`;
  link.click();

  // The click needs the URL alive; release it once the browser has read it.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  status.textContent = 'Saved the ring as an STL file.';
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

/** Keeps the band panel clear of the controls, which wrap on narrow screens. */
function trackControlsHeight() {
  const controls = document.querySelector('.live-controls');

  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--controls-height', `${controls.offsetHeight}px`);
  }).observe(controls);
}

async function init() {
  setButton({ icon: 'record', label: 'Start', pressed: false });
  trackControlsHeight();
  showLength();

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
  } catch (error) {
    viewer = null;
    button.disabled = true;
    sourceSelect.disabled = true;
    setButton({ icon: 'alert', label: '3D unavailable', showLabel: true, pressed: false });
    status.textContent = `The 3D visualiser could not start: ${error.message}`;
  }

  // The mesh is built whether or not there is a viewer: without WebGL the page
  // cannot draw the ring, but the STL can still be downloaded.
  applyRing();

  refreshSources();
}

button.addEventListener('click', () => {
  if (stream) stop();
  else start();
});

sourceSelect.addEventListener('change', changeSource);
// The readout follows the thumb; the ring waits for the release, so dragging
// across the whole range does not rebuild the mesh under the pointer.
lengthInput.addEventListener('input', () => renderLength(lengthInput.valueAsNumber));
lengthInput.addEventListener('change', scheduleLength);
downloadButton.addEventListener('click', downloadStl);
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
  setButton({ icon: 'record', label: 'Start', pressed: false });
  status.textContent = 'Press Start to visualise the input.';
});

init();
