import { renderRing } from './ring.js';
import { render as renderSpectrogram } from './spectrogram.js';

const audio = document.querySelector('#audio');
const play = document.querySelector('#play');
const status = document.querySelector('#status');
const line = document.querySelector('#progress');
const elapsed = document.querySelector('#elapsed');
const ringCanvas = document.querySelector('#ring-spectrogram');
const spectrogramCanvas = document.querySelector('#spectrogram');
const spectrogramProgress = document.querySelector('#spectrogram-progress');
let data;
let plotData;
let duration;
let frame;
let complete = false;
let ready = false;
let playbackFailed = false;
const center = 300;
const outer = 250;
let inner;
let startAngle;
let sweep;

// Model +Y points upward; SVG +Y points downward.
function point(radius, angle) {
  return [center + radius * Math.cos(angle), center - radius * Math.sin(angle)];
}
function update() {
  if (!ready) return;
  const time = complete ? duration : Math.min(audio.currentTime, duration);
  const fraction = data.timeScale === 'log'
    ? Math.log1p(time / 0.01) / Math.log1p(duration / 0.01)
    : time / duration;
  const angle = startAngle - sweep * fraction;
  const a = point(inner, angle), b = point(outer, angle);
  line.setAttribute('x1', a[0]); line.setAttribute('y1', a[1]);
  line.setAttribute('x2', b[0]); line.setAttribute('y2', b[1]);
  line.setAttribute('visibility', 'visible');
  elapsed.textContent = time.toFixed(2);
  updateSpectrogramProgress(time);
}
function updateSpectrogramProgress(time) {
  const times = plotData?.timesSeconds;
  if (!times || times.length < 2) return;
  const bounded = Math.max(times[0], Math.min(time, times[times.length - 1]));
  let upper = 1;
  while (upper < times.length - 1 && times[upper] < bounded) upper++;
  const lower = upper - 1;
  const span = times[upper] - times[lower];
  const fraction = (lower + (span ? (bounded - times[lower]) / span : 0)) / (times.length - 1);
  const plotWidth = Math.max(0, spectrogramCanvas.clientWidth - 58 - 74);
  spectrogramProgress.style.left = `${58 + plotWidth * fraction}px`;
  spectrogramProgress.hidden = false;
}
function render() {
  update();
  if (!audio.paused && !audio.ended) frame = requestAnimationFrame(render);
}
function finish() {
  complete = true;
  audio.pause();
  cancelAnimationFrame(frame);
  update();
  play.textContent = 'Replay';
  status.textContent = 'The trace is complete. Listen again.';
}
function waitForAudio() {
  if (audio.error) return Promise.reject(new Error('The recording could not be loaded.'));
  if (audio.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    audio.addEventListener('loadedmetadata', resolve, { once: true });
    audio.addEventListener('error', () => reject(new Error('The recording could not be loaded.')), { once: true });
  });
}
/**
 * Adopts a relief dataset and redraws the outline. Throws when the data cannot
 * be used, so the initial load and a fresh generation report failures the same
 * way.
 */
function applyData(next) {
  data = next;
  if (data.shape !== 'circular') throw new Error('Generate a circular relief to use this player.');
  duration = Math.min(data.timesSeconds[data.timesSeconds.length - 1], audio.duration);
  if (!(duration > 0)) throw new Error('The recording has no playable duration.');
  inner = outer * data.geometryMm.innerDiameter / data.geometryMm.diameter;
  sweep = data.arcDegrees * Math.PI / 180;
  startAngle = (-90 - (360 - data.arcDegrees) / 2) * Math.PI / 180;
  const endAngle = startAngle - sweep;
  const large = data.arcDegrees > 180 ? 1 : 0;
  const os = point(outer, startAngle), oe = point(outer, endAngle);
  const ie = point(inner, endAngle), is = point(inner, startAngle);
  document.querySelector('#outline').setAttribute('d',
    `M ${os} A ${outer} ${outer} 0 ${large} 1 ${oe} L ${ie} A ${inner} ${inner} 0 ${large} 0 ${is} Z`);
  document.querySelector('#duration').textContent = `${duration.toFixed(2)} S / ${data.arcDegrees}°`;
  renderRing(ringCanvas, data);
  complete = false;
  ready = true;
  play.disabled = false;
  play.textContent = 'Play';
  delete status.dataset.kind;
  status.textContent = 'Press play to follow the sound.';
  update();
}
function showFailure(error) {
  ready = false;
  renderRing(ringCanvas, null);
  status.dataset.kind = 'error';
  status.textContent = error.message;
  play.textContent = 'Unavailable';
  play.disabled = true;
}
async function init() {
  try {
    const [response] = await Promise.all([fetch('../generated/landscape-data.json'), waitForAudio()]);
    if (!response.ok) throw new Error('The relief data could not be loaded.');
    applyData(await response.json());
  } catch (error) {
    showFailure(error);
  }
}
// The generator hands over freshly analysed relief data without a page reload.
document.addEventListener('relief:data', event => {
  try { applyData(event.detail); }
  catch (error) { showFailure(error); }
});
document.addEventListener('spectrogram:data', event => {
  plotData = event.detail;
  update();
});
play.addEventListener('click', async () => {
  if (!ready) return;
  if (!audio.paused) { audio.pause(); return; }
  if (complete || audio.ended) { audio.currentTime = 0; complete = false; }
  playbackFailed = false;
  play.disabled = true;
  try { await audio.play(); }
  catch { playbackFailed = true; status.textContent = 'Playback could not start. Press play to retry.'; }
  finally { play.disabled = false; }
});
audio.addEventListener('playing', () => {
  play.textContent = 'Pause';
  status.textContent = 'Following the sound clockwise.';
  cancelAnimationFrame(frame);
  render();
});
audio.addEventListener('pause', () => {
  cancelAnimationFrame(frame);
  update();
  play.textContent = complete ? 'Replay' : 'Play';
  if (!complete && !playbackFailed) status.textContent = 'Paused. Continue when you’re ready.';
});
audio.addEventListener('timeupdate', () => {
  if (ready && audio.currentTime >= duration) finish();
  else update();
});
audio.addEventListener('ended', finish);
audio.addEventListener('error', () => {
  cancelAnimationFrame(frame);
  status.textContent = 'The recording could not be played. Reload the page to try again.';
});
document.querySelectorAll('[data-rate]').forEach(button => {
  button.addEventListener('click', () => {
    const rate = Number(button.dataset.rate);
    try { audio.playbackRate = rate; }
    catch { status.textContent = 'This browser does not support that playback speed.'; return; }
    document.querySelectorAll('[data-rate]').forEach(other => {
      other.setAttribute('aria-pressed', String(other === button));
    });
  });
});
init();
async function initSpectrogram() {
  renderSpectrogram(spectrogramCanvas, null);
  try {
    const response = await fetch('../generated/spectrogram-plot-data.json');
    if (!response.ok) throw new Error('The spectrogram data could not be loaded.');
    plotData = await response.json();
    renderSpectrogram(spectrogramCanvas, plotData);
    update();
  } catch {
    spectrogramProgress.hidden = true;
  }
}
initSpectrogram();
document.querySelectorAll('#tab-listen, #tab-spectrogram').forEach(tab => {
  tab.addEventListener('click', () => requestAnimationFrame(() => update()));
});

// Position is measured in viewport pixels, independent of the drawing's scale.
const drawing = document.querySelector('.drawing');
const scaleControl = document.querySelector('#ring-scale');
const scaleValue = document.querySelector('#scale-value');
const layout = { x: 0, y: 0, scale: 1 };
const layoutStorageKey = 'sulcus:ring-layout:v1';
const legacyLayoutStorageKey = 'sound-form:ring-layout:v1';
try {
  let savedJson = localStorage.getItem(layoutStorageKey);
  if (savedJson === null) {
    savedJson = localStorage.getItem(legacyLayoutStorageKey);
    if (savedJson !== null) {
      localStorage.setItem(layoutStorageKey, savedJson);
      localStorage.removeItem(legacyLayoutStorageKey);
    }
  }
  const saved = JSON.parse(savedJson);
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) &&
      Number.isFinite(saved.scale) && saved.scale >= 0.1 && saved.scale <= 4) {
    layout.x = saved.x;
    layout.y = saved.y;
    layout.scale = saved.scale;
  }
} catch {
  // Missing, malformed, or blocked storage leaves the default layout usable.
}
let drag = null;
function applyLayout() {
  drawing.style.setProperty('--ring-x', `${layout.x}px`);
  drawing.style.setProperty('--ring-y', `${layout.y}px`);
  drawing.style.setProperty('--ring-scale', layout.scale);
  const percent = Math.round(layout.scale * 100);
  scaleControl.value = percent;
  scaleValue.value = `${percent}%`;
  try {
    localStorage.setItem(layoutStorageKey, JSON.stringify(layout));
  } catch {
    // Layout controls still work when browser storage is unavailable.
  }
}
applyLayout();
function setScale(next) {
  layout.scale = Math.max(0.1, Math.min(4, next));
  applyLayout();
}
drawing.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0) return;
  event.preventDefault();
  drawing.focus({ preventScroll: true });
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  drawing.setPointerCapture(event.pointerId);
  drawing.classList.add('is-dragging');
});
drawing.addEventListener('pointermove', event => {
  if (!drag || drag.id !== event.pointerId) return;
  layout.x += event.clientX - drag.x;
  layout.y += event.clientY - drag.y;
  drag.x = event.clientX;
  drag.y = event.clientY;
  applyLayout();
});
function stopDrag(event) {
  if (!drag || drag.id !== event.pointerId) return;
  drag = null;
  drawing.classList.remove('is-dragging');
  if (drawing.hasPointerCapture(event.pointerId)) drawing.releasePointerCapture(event.pointerId);
}
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => drawing.addEventListener(type, stopDrag));
drawing.addEventListener('wheel', event => {
  event.preventDefault();
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
  setScale(layout.scale * Math.exp(-event.deltaY * unit * 0.002));
}, { passive: false });
drawing.addEventListener('keydown', event => {
  const step = event.shiftKey ? 20 : 5;
  switch (event.key) {
    case 'ArrowLeft': layout.x -= step; break;
    case 'ArrowRight': layout.x += step; break;
    case 'ArrowUp': layout.y -= step; break;
    case 'ArrowDown': layout.y += step; break;
    case '+': case '=': setScale(layout.scale + 0.05); break;
    case '-': setScale(layout.scale - 0.05); break;
    default: return;
  }
  event.preventDefault();
  applyLayout();
});
scaleControl.addEventListener('input', () => setScale(Number(scaleControl.value) / 100));
document.querySelector('#reset-layout').addEventListener('click', () => {
  layout.x = 0;
  layout.y = 0;
  layout.scale = 1;
  applyLayout();
});

// H toggles layout controls without changing the ring's position or scale.
const layoutControls = document.querySelector('.layout-controls');
layoutControls.setAttribute('aria-keyshortcuts', 'h');
document.addEventListener('keydown', event => {
  if (event.key.toLowerCase() !== 'h' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  event.preventDefault();
  layoutControls.hidden = !layoutControls.hidden;
  if (layoutControls.hidden && layoutControls.contains(document.activeElement)) {
    drawing.focus({ preventScroll: true });
  }
});
