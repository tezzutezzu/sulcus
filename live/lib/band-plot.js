// ---------------------------------------------------------------------------
// Band plot
// ---------------------------------------------------------------------------

/**
 * 2D frequency band control for the live view.
 *
 * Draws the newest spectrum column across the whole analysis range on a
 * log-frequency axis and exposes the selected band as two edges. It knows
 * nothing about the ring: every change is reported through `onChange`, and the
 * caller decides what a band means.
 *
 * The edges are ordinary elements with role="slider", so the control works from
 * the keyboard and a screen reader without any pointer at all.
 */

import { logFraction, logFrequency } from './spectrum.js';

/** The edges stay at least this ratio apart, so the ring keeps some spread. */
const MIN_SPAN = 1.2;
/** Arrows move by a fraction of the axis; Page Up/Down by a larger one. */
const KEY_STEP = 0.05;
const KEY_STEP_LARGE = 0.2;

const PAD = { top: 10, bottom: 14 };
const TICKS = [100, 1000, 10000];

const INK = '#e3e1dc';
const MUTED = '#6b7274';

/**
 * @param {{
 *   canvas: HTMLCanvasElement,
 *   surface: HTMLElement,
 *   handles: { low: HTMLElement, high: HTMLElement },
 *   labels: { low: HTMLElement, high: HTMLElement },
 *   min: number, max: number, floor: number,
 *   band: { low: number, high: number },
 *   onChange: (band: { low: number, high: number }) => void,
 * }} options
 */
export function createBandPlot({
  canvas, surface, handles, labels, min, max, floor, band, onChange,
}) {
  const context = canvas.getContext('2d');
  const edges = ['low', 'high'];
  const controller = new AbortController();
  const { signal } = controller;

  let current = { low: band.low, high: band.high };
  let values = null;
  let active = null;
  let size = { width: 0, height: 0, ratio: 1 };

  const fractionOf = (frequency) => logFraction(frequency, { fmin: min, fmax: max });
  const xOf = (frequency) => fractionOf(frequency) * size.width;

  /** Positions the handles and the readout for the current band. */
  function place() {
    for (const edge of edges) {
      const frequency = current[edge];
      const text = formatHz(frequency);
      const handle = handles[edge];

      handle.style.left = `${xOf(frequency)}px`;
      handle.setAttribute('aria-valuenow', String(Math.round(frequency)));
      handle.setAttribute('aria-valuetext', text);
      labels[edge].textContent = text;
    }
  }

  function draw() {
    if (!size.width || !size.height) return;

    const { width, height, ratio } = size;
    const bottom = height - PAD.bottom;
    const span = bottom - PAD.top;
    const yOf = (decibels) => {
      const clamped = Math.min(Math.max(decibels, floor), 0);
      return bottom - ((clamped - floor) / -floor) * span;
    };

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    context.strokeStyle = 'rgba(227, 225, 220, 0.18)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, bottom + 0.5);
    context.lineTo(width, bottom + 0.5);
    context.stroke();

    context.fillStyle = MUTED;
    context.font = '9px Arial, Helvetica, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'top';
    for (const frequency of TICKS) {
      context.fillText(shortLabel(frequency), xOf(frequency), bottom + 3);
    }

    if (values && values.length > 1) {
      const curve = new Path2D();
      for (let i = 0; i < values.length; i++) {
        const x = (i / (values.length - 1)) * width;
        if (i === 0) curve.moveTo(x, yOf(values[i]));
        else curve.lineTo(x, yOf(values[i]));
      }

      const area = new Path2D(curve);
      area.lineTo(width, bottom);
      area.lineTo(0, bottom);
      area.closePath();

      context.fillStyle = 'rgba(227, 225, 220, 0.10)';
      context.fill(area);
      context.strokeStyle = INK;
      context.lineWidth = 1.25;
      context.lineJoin = 'round';
      context.stroke(curve);
    }

    // Dim what the ring is not showing, so the band reads at a glance.
    const lowX = xOf(current.low);
    const highX = xOf(current.high);
    context.fillStyle = 'rgba(17, 19, 21, 0.55)';
    if (lowX > 0) context.fillRect(0, 0, lowX, height);
    if (highX < width) context.fillRect(highX, 0, width - highX, height);
  }

  function apply(next) {
    if (next.low === current.low && next.high === current.high) return;

    current = next;
    place();
    draw();
    onChange({ ...current });
  }

  function setEdge(edge, frequency) {
    apply(
      edge === 'low'
        ? { low: Math.min(Math.max(frequency, min), current.high / MIN_SPAN), high: current.high }
        : { low: current.low, high: Math.max(Math.min(frequency, max), current.low * MIN_SPAN) },
    );
  }

  /** One keyboard step from the edge's current position, along the log axis. */
  function step(edge, delta) {
    const moved = Math.min(Math.max(fractionOf(current[edge]) + delta, 0), 1);
    return logFrequency(moved, { fmin: min, fmax: max });
  }

  function frequencyAt(clientX) {
    const rect = canvas.getBoundingClientRect();
    const moved = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    return logFrequency(moved, { fmin: min, fmax: max });
  }

  // Pointer events land on whichever element is on top — the canvas or one of
  // the handles — so they are bound to the plot container and bubble up.
  surface.addEventListener('pointerdown', (event) => {
    const x = event.clientX - canvas.getBoundingClientRect().left;
    active = Math.abs(x - xOf(current.low)) <= Math.abs(x - xOf(current.high)) ? 'low' : 'high';
    surface.setPointerCapture(event.pointerId);
    setEdge(active, frequencyAt(event.clientX));
    event.preventDefault();
  }, { signal });

  surface.addEventListener('pointermove', (event) => {
    if (!active) return;
    setEdge(active, frequencyAt(event.clientX));
    event.preventDefault();
  }, { signal });

  function endDrag(event) {
    if (!active) return;
    active = null;
    if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
  }

  surface.addEventListener('pointerup', endDrag, { signal });
  surface.addEventListener('pointercancel', endDrag, { signal });

  surface.addEventListener('dblclick', (event) => {
    event.preventDefault();
    apply({ low: min, high: max });
  }, { signal });

  for (const edge of edges) {
    handles[edge].addEventListener('keydown', (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      let frequency;
      switch (event.key) {
        case 'ArrowLeft':
        case 'ArrowDown':
        case 'PageDown':
          frequency = step(edge, event.key === 'PageDown' ? -KEY_STEP_LARGE : -KEY_STEP);
          break;
        case 'ArrowRight':
        case 'ArrowUp':
        case 'PageUp':
          frequency = step(edge, event.key === 'PageUp' ? KEY_STEP_LARGE : KEY_STEP);
          break;
        case 'Home':
          frequency = min;
          break;
        case 'End':
          frequency = max;
          break;
        default:
          return;
      }

      event.preventDefault();
      setEdge(edge, frequency);
    }, { signal });
  }

  const observer = new ResizeObserver(() => measure());
  observer.observe(canvas);

  function measure() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    size = { width, height, ratio };
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);

    place();
    draw();
  }

  place();
  measure();

  return {
    /** Feeds one spectrum column, already reduced to evenly spaced rows. */
    setValues(row) {
      values = row;
      draw();
    },

    setBand(next) {
      apply({ low: next.low, high: next.high });
    },

    destroy() {
      controller.abort();
      observer.disconnect();
      values = null;
    },
  };
}

/** `430 Hz`, `1.2 kHz`, `20 kHz`. */
function formatHz(frequency) {
  if (frequency < 1000) return `${Math.round(frequency)} Hz`;
  const kHz = frequency / 1000;
  return `${kHz >= 10 ? Math.round(kHz) : Number(kHz.toFixed(1))} kHz`;
}

/** Axis ticks stay short: `100`, `1k`, `10k`. */
function shortLabel(frequency) {
  return frequency < 1000 ? String(frequency) : `${frequency / 1000}k`;
}
