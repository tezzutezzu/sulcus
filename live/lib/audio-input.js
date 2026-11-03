// ---------------------------------------------------------------------------
// Audio input
// ---------------------------------------------------------------------------

/**
 * Sources for the live view and the capture lifecycle around them.
 *
 * The default microphone needs no device id. Named inputs come from
 * enumerateDevices(), whose labels only appear after microphone permission has
 * been granted. Display audio uses the browser's own picker; the video track it
 * always includes is stopped immediately, since only audio is used here.
 */

const STORAGE_KEY = 'sound-form:live-source';

const MICROPHONE = {
  channelCount: 1,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

/** The remembered choice; the device may no longer be connected. */
export function readPreference() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (stored && (stored.kind === 'microphone' || stored.kind === 'display')) {
      return { kind: stored.kind, deviceId: stored.deviceId || '' };
    }
  } catch {
    // Corrupted or blocked storage: use the default.
  }

  return { kind: 'microphone', deviceId: '' };
}

export function rememberPreference(source) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(source));
  } catch {
    // Storage may be unavailable; the choice still applies to this session.
  }
}

/** Values for the source select, in display order. */
export async function listSources() {
  const sources = [{ id: 'default', label: 'Default microphone' }];

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    devices
      .filter((device) => device.kind === 'audioinput')
      .forEach((device, index) => {
        // Labels stay blank until microphone permission has been granted.
        sources.push({ id: device.deviceId, label: device.label || `Input ${index + 1}` });
      });
  } catch {
    // No enumeration: offer the default microphone only.
  }

  if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
    sources.push({ id: 'display', label: 'System / tab audio' });
  }

  return sources;
}

export function sourceFromOption(value) {
  if (value === 'display') return { kind: 'display', deviceId: '' };
  return { kind: 'microphone', deviceId: value === 'default' ? '' : value };
}

export function optionFromSource(source) {
  return source.kind === 'display' ? 'display' : source.deviceId || 'default';
}

async function openMicrophone(deviceId) {
  const audio = deviceId ? { ...MICROPHONE, deviceId: { exact: deviceId } } : MICROPHONE;
  return finish(await navigator.mediaDevices.getUserMedia({ audio }));
}

async function openDisplay() {
  // Browsers that share audio still require a video track; drop it at once.
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });

  stream.getVideoTracks().forEach((track) => {
    track.stop();
    stream.removeTrack(track);
  });

  return finish(stream);
}

function finish(stream) {
  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error('That source has no audio track.');
  }

  return {
    stream,
    stop() {
      stream.getTracks().forEach((track) => track.stop());
    },
  };
}

/** Opens the chosen source, or throws with the browser's error. */
export async function openSource(source) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Audio capture needs HTTPS or localhost in this browser.');
  }

  return source.kind === 'display' ? openDisplay() : openMicrophone(source.deviceId);
}

/** A short explanation for a failed capture, suitable for the status region. */
export function describeError(error, source) {
  if (error.name === 'NotAllowedError') {
    return source.kind === 'display'
      ? 'The share was cancelled or blocked. Try another source.'
      : 'Microphone access was blocked. Allow it in the browser, then try again.';
  }

  if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
    return 'That input is no longer available. Choose another source.';
  }

  if (error.name === 'NotSupportedError') {
    return 'This browser cannot capture that source.';
  }

  return `The input could not start: ${error.message}`;
}
