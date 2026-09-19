import { t } from './i18n/index.js';
// Camera and microphone access, behind capability checks. Nothing here assumes a
// Cloud Phone runtime exposes either: every entry point reports what is possible
// so the UI can show a real disabled state instead of failing at press time.
export const MAX_IMAGE_BYTES = 734003;   // ~700 KB, matches the server limit
export const MAX_AUDIO_BYTES = 2.5 * 1024 * 1024;
export const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
export const MAX_EDGE = 1024;
export const JPEG_QUALITY = 0.72;
export const MAX_SECONDS = 30;

export const DEMO_SAMPLES = [
  { id: 'leaf1', label: 'Yellowing rice leaf', src: 'img/sample-leaf-1.jpg' },
  { id: 'leaf2', label: 'Spotted leaf', src: 'img/sample-leaf-2.jpg' },
];

// Cloud Phone exposes its own async feature detection (navigator.hasFeature); the
// standard APIs can exist while the handset client still has no microphone/picker.
// Filled by loadFeatures(); null = unknown, so browsers without hasFeature are unaffected.
const platform = { audioCapture: null, audioUpload: null, image: null, loaded: false };

export async function loadFeatures() {
  if (platform.loaded || typeof navigator.hasFeature !== 'function') return platform;
  const ask = async (name) => {
    try { return Boolean(await navigator.hasFeature(name)); } catch { return null; }
  };
  [platform.audioCapture, platform.audioUpload, platform.image] = await Promise.all([
    ask('AudioCapture'),
    ask('AudioUpload'),
    ask('ImageUpload'),
  ]);
  platform.loaded = true;
  return platform;
}

export function capabilities() {
  const input = document.createElement('input');
  input.type = 'file';
  const cloudPhone = typeof navigator.hasFeature === 'function';
  const voiceCapture = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder)
    && platform.audioCapture !== false;
  const voiceUpload = input.type === 'file' && platform.audioUpload !== false;
  return {
    // A file input exists almost everywhere; `capture` only hints at the camera.
    photo: input.type === 'file' && platform.image !== false,
    camera: 'capture' in input,
    // Keypad Cloud Phone clients must not enter getUserMedia: some expose the
    // API but provide no usable way to confirm its permission dialog.
    voice: cloudPhone ? voiceUpload : voiceCapture || voiceUpload,
    voiceCapture,
    voiceUpload,
    // Cloud Phone's native audio picker avoids a getUserMedia permission dialog
    // that cannot be operated on some keypad handsets (including the NEO R60+).
    // Prefer this while feature detection is still pending too, so a fast key
    // press can never race into the unusable permission prompt. If AudioUpload
    // later resolves false, the Voice option is disabled instead of using GUM.
    preferVoiceUpload: cloudPhone,
    secure: window.isSecureContext !== false,
    platform: { ...platform },
  };
}

/**
 * Opens Cloud Phone's native audio picker/recorder without getUserMedia.
 * `capture` is only a hint; clients may offer an existing recording instead.
 */
export function pickAudio() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.capture = 'microphone';
    input.hidden = true;
    let settled = false;
    const done = (fn, value) => {
      if (!settled) {
        settled = true;
        input.remove();
        fn(value);
      }
    };

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return done(resolve, null);
      if (file.size > MAX_AUDIO_BYTES) {
        return done(reject, new Error(t('Recording is too large. Keep it under 30 seconds.')));
      }
      return done(resolve, file);
    });
    document.body.appendChild(input);
    input.click();
  });
}

// How long to wait for a permission prompt before giving up. A feature-phone
// prompt can take a while to find and confirm, so this is deliberately generous.
export const PERMISSION_WAIT_MS = 30000;

/**
 * Opens the picker and returns a compressed JPEG, or null if the user cancelled.
 * The file input is created per call and removed afterwards so no stale handle
 * survives a screen change.
 */
export function pickPhoto() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.capture = 'environment';
    input.hidden = true;
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; input.remove(); fn(v); } };

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return done(resolve, null);
      try {
        if (file.size > MAX_SOURCE_BYTES) throw new Error(t('Photo is too large.'));
        done(resolve, await compressImage(file));
      } catch (err) { done(reject, err); }
    });
    // No reliable cancel event on a feature phone; the screen drops the promise on Back.
    document.body.appendChild(input);
    input.click();
  });
}

async function decode(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file); } catch { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(t('Photo could not be read.')));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Resize to <=1024px, re-encode as JPEG. Redrawing through a canvas also drops EXIF. */
export async function compressImage(file) {
  const bitmap = await decode(file);
  const w = bitmap.width || bitmap.naturalWidth;
  const h = bitmap.height || bitmap.naturalHeight;
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  let blob = await toBlob(canvas, JPEG_QUALITY);
  // One retry at lower quality rather than refusing a photo the farmer just took.
  if (blob.size > MAX_IMAGE_BYTES) blob = await toBlob(canvas, 0.55);
  if (blob.size > MAX_IMAGE_BYTES) throw new Error(t('Photo is too large. Try again in daylight.'));
  return { blob, width: canvas.width, height: canvas.height, previewUrl: URL.createObjectURL(blob) };
}

function toBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    if (!canvas.toBlob) return reject(new Error(t('Photo could not be prepared.')));
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t('Photo could not be prepared.')))), 'image/jpeg', quality);
  });
}

/** Loads a bundled sample for runtimes without a camera. Returns null if absent. */
export async function loadDemoSample(sample) {
  try {
    const res = await fetch(sample.src);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.size) return null;
    return { blob, previewUrl: URL.createObjectURL(blob), isDemoSample: true };
  } catch {
    return null;
  }
}

/**
 * MediaRecorder wrapper with a hard 30s stop and guaranteed track release.
 * Permission is only requested when start() is called, i.e. after the user chose Voice.
 */
export class VoiceRecorder {
  constructor({ onTick, onStop } = {}) {
    this.onTick = onTick;
    this.onStop = onStop;
    this.chunks = [];
    this.stream = null;
    this.recorder = null;
    this.timer = null;
    this.seconds = 0;
    this.state = 'idle'; // idle | recording | done
  }

  async start() {
    if (this.state === 'recording') return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (this.aborted) { stream.getTracks().forEach((t) => t.stop()); return; } // cancelled while the prompt was open
    this.stream = stream;
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find(
      (m) => window.MediaRecorder?.isTypeSupported?.(m),
    );
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.seconds = 0;
    this.recorder.ondataavailable = (e) => { if (e.data?.size) this.chunks.push(e.data); };
    this.recorder.onstop = () => {
      this.release();
      this.state = 'done';
      const blob = new Blob(this.chunks, { type: this.recorder.mimeType || 'audio/webm' });
      this.blob = blob.size ? blob : null;
      this.onStop?.(this.blob, this.seconds);
    };
    this.recorder.start();
    this.state = 'recording';
    this.timer = setInterval(() => {
      this.seconds += 1;
      this.onTick?.(this.seconds);
      if (this.seconds >= MAX_SECONDS) this.stop();
    }, 1000);
  }

  stop() {
    if (this.state !== 'recording') return;
    clearInterval(this.timer);
    this.timer = null;
    try { this.recorder.stop(); } catch { this.release(); }
  }

  /** Stops everything and discards the recording. Safe to call from onHide. */
  cancel() {
    this.aborted = true;
    clearInterval(this.timer);
    this.timer = null;
    if (this.recorder && this.state === 'recording') {
      this.recorder.onstop = null;
      try { this.recorder.stop(); } catch { /* already stopped */ }
    }
    this.chunks = [];
    this.blob = null;
    this.state = 'idle';
    this.release();
  }

  // Microphone tracks must be released or the handset keeps the mic indicator on.
  release() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
