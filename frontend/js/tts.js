import { t } from './i18n/index.js';
// Native TTS client: fetches translated text from backend and plays it using browser API.
// Shows a toast overlay while loading/playing.

let currentAudio = null;
let currentUtterance = null;
let currentAbort = null;
let isSpeaking = false;
let toastEl = null;
let hideTimer = null;

function showToast(text) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'tts-toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(hideTimer);
}

function hideToast(delay = 1200) {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { if (toastEl) toastEl.hidden = true; }, delay);
}

function playNativeTTS(translatedText, language) {
  if (!('speechSynthesis' in window)) {
    showToast(t('⚠ Native TTS not supported'));
    hideToast(2500);
    return;
  }
  
  const utterance = new SpeechSynthesisUtterance(translatedText);
  utterance.lang = language;
  utterance.rate = 1.0;
  utterance.pitch = 1.0;

  utterance.onstart = () => {
    isSpeaking = true;
    showToast(t('🔊 Reading…'));
  };

  utterance.onend = () => {
    isSpeaking = false;
    currentUtterance = null;
    showToast(t('🔊 Done'));
    hideToast();
  };

  utterance.onerror = (e) => {
    isSpeaking = false;
    currentUtterance = null;
    showToast(t('⚠ Playback failed'));
    console.error('SpeechSynthesisError:', e);
    hideToast(2500);
  };

  currentUtterance = utterance;
  window.speechSynthesis.speak(utterance);
}

export async function readAloud(text, language = 'en') {
  stop(); // cancel anything in flight

  if (!text || !text.trim()) return;

  const controller = new AbortController();
  currentAbort = controller;

  showToast(t('🔊 Translating…'));

  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, language }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      if (body?.error?.code === 'TTS_FALLBACK_NATIVE' && body.error.fallbackText) {
        // Both cloud MP3 methods failed, fallback to native window.speechSynthesis
        playNativeTTS(body.error.fallbackText, language);
        return;
      }
      
      const msg = body?.error?.message || 'Translation unavailable';
      showToast(`⚠ ${t(msg)}`);
      hideToast(2500);
      return;
    }

    // Success! We got an MP3 blob back.
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    currentAudio = new Audio(url);
    
    currentAudio.onplay = () => {
      isSpeaking = true;
      showToast(t('🔊 Reading…'));
    };

    currentAudio.onended = () => {
      isSpeaking = false;
      currentAudio = null;
      URL.revokeObjectURL(url);
      showToast(t('🔊 Done'));
      hideToast();
    };

    currentAudio.onerror = () => {
      isSpeaking = false;
      currentAudio = null;
      URL.revokeObjectURL(url);
      showToast(t('⚠ Playback failed'));
      hideToast(2500);
    };

    await currentAudio.play();
    
  } catch (err) {
    if (err.name === 'AbortError') return; // intentional stop
    showToast(t('⚠ TTS failed'));
    hideToast(2500);
  }
}

/** Stop playback and abort any pending fetch. */
export function stop() {
  clearTimeout(hideTimer);
  if (currentAbort) { currentAbort.abort(); currentAbort = null; }
  
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  
  isSpeaking = false;
  currentUtterance = null;
  if (toastEl) toastEl.hidden = true;
}

/** @returns {boolean} Whether audio is currently playing. */
export function isPlaying() {
  if (currentAudio && !currentAudio.paused) return true;
  if ('speechSynthesis' in window) {
    return window.speechSynthesis.speaking || isSpeaking;
  }
  return false;
}
