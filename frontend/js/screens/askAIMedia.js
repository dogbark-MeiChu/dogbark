import { t } from '../i18n/index.js';
import { el, isCompact } from '../dom.js';
import { composer, ask, history, track } from '../askAI.js';
import { capabilities, loadFeatures, pickPhoto, pickAudio, loadDemoSample, DEMO_SAMPLES, VoiceRecorder, MAX_SECONDS, PERMISSION_WAIT_MS } from '../media.js';

// Options, Photo, Voice and History screens. Options *replaces* itself with the
// chosen screen so the back stack stays Home → (Input) → Photo/Voice, never
// Home → Options → Photo.

const DEBUG = new URLSearchParams(location.search).has('debug');

const fromInput = (ctx) => ctx.params?.from === 'input';

// Photo/Voice hand the attachment to the composer. From Input we pop back to it;
// from Home we swap ourselves for the composer.
function returnToComposer(ctx) {
  if (fromInput(ctx)) ctx.router.pop();
  else ctx.router.replace('AskAIInput');
}

// ---------------------------------------------------------------- Options

function optionItems() {
  const media = capabilities();
  const items = [
    { id: 'photo', label: t('Photo'), note: t(media.photo ? (media.camera ? 'Camera or gallery' : 'Choose a file') : 'Demo samples only') },
    {
      id: 'voice',
      label: t('Voice'),
      note: t(media.voice
        ? (media.preferVoiceUpload || !media.voiceCapture ? 'Use phone recorder' : 'Up to 30 seconds')
        : 'Not available on this device'),
      disabled: !media.voice,
    },
    { id: 'history', label: t('Recent questions'), note: t('{n} recent', { n: history().length }) },
    { id: 'language', label: t('Answer language'), note: composer.language === 'hi' ? 'हिंदी (Hindi)' : 'English' },
  ];
  if (composer.image || composer.audio) items.push({ id: 'remove', label: t('Remove attachment'), note: composer.attachmentLabel });
  return items;
}

export const AskAIMedia = {
  name: 'AskAIMedia',
  title: 'Tools',
  numericSelect: true,
  softLeft: { label: '', handler() {} },
  onShow(ctx) {
    if (capabilities().platform.loaded) return;
    loadFeatures().then(() => { if (capabilities().platform.loaded) { const i = ctx.focus.index; ctx.rerender(); ctx.focus.set(i); } });
  },
  render() {
    const list = el('ai-screen list ai-options');
    optionItems().forEach((it, i) => {
      const row = el(`item ai-option${it.disabled ? ' disabled' : ''}`);
      const text = el('ai-line-text');
      text.append(el('', it.label));
      if (!isCompact()) text.append(el('dim ai-option-note', it.note));
      row.append(el('ai-preset-num', String(i + 1)), text);
      list.appendChild(row);
    });
    return list;
  },
  onEnter(_el, ctx, i) {
    const it = optionItems()[i];
    if (!it) return;
    const from = ctx.params?.from;
    switch (it.id) {
      case 'photo': ctx.router.replace('AskAIPhoto', { from }); break;
      case 'voice':
        // Kept visible but inert when unsupported, and the composer is one key away.
        if (it.disabled) ctx.router.replace('AskAIInput', { notice: t('Voice is not available. Type instead.') });
        else ctx.router.replace('AskAIVoice', { from });
        break;
      case 'history': ctx.router.replace('AskAIHistory'); break;
      case 'language': {
        composer.language = composer.language === 'hi' ? 'en' : 'hi';
        ctx.rerender();
        ctx.focus.set(i);
        break;
      }
      case 'remove':
        composer.clearMedia();
        ctx.router.pop();
        break;
      default:
    }
  },
};

// ---------------------------------------------------------------- Photo

const photo = { preview: null, status: '' };

function photoItems() {
  if (photo.preview) return ['use', 'retake', 'remove'];
  const media = capabilities();
  return [...(media.photo ? ['capture'] : []), ...DEMO_SAMPLES.map((s) => s.id)];
}

const PHOTO_LABEL = {
  capture: () => t(capabilities().camera ? 'Take photo' : 'Choose photo'),
  use: () => t('Use this photo'),
  retake: () => t('Retake'),
  remove: () => t('Remove'),
};

export const AskAIPhoto = {
  name: 'AskAIPhoto',
  title: 'Photo',
  statusBadge: () => (photo.preview ? (photo.preview.isDemoSample ? t('DEMO') : t('READY')) : ''),
  softLeft: { label: '', handler() {} },
  render() {
    const wrap = el('ai-screen ai-photo');
    if (photo.preview) {
      const row = el('ai-photo-preview');
      const img = el('ai-thumb', null, 'img');
      img.src = photo.preview.previewUrl;
      img.alt = t('Selected crop photo');
      row.append(img, el('ai-attachment on', photo.preview.isDemoSample ? t('DEMO SAMPLE') : t('PHOTO READY')));
      wrap.appendChild(row);
    } else if (!isCompact()) {
      wrap.appendChild(el('ai-privacy', t('Photo is sent to AI for this answer only. Shoot one leaf in daylight.')));
    }
    if (photo.status) wrap.appendChild(el('ai-hint', photo.status));

    const list = el('list');
    photoItems().forEach((id) => {
      const sample = DEMO_SAMPLES.find((s) => s.id === id);
      const row = el('item');
      if (sample) row.append(el('ai-chip dim', t('DEMO SAMPLE')), el('', ` ${t(sample.label)}`, 'span'));
      else row.textContent = PHOTO_LABEL[id]();
      list.appendChild(row);
    });
    wrap.appendChild(list);
    return wrap;
  },
  onShow() {
    // Re-entering with an attachment already on the composer shows it for review.
    if (!photo.preview && composer.image) photo.preview = composer.image;
  },
  onHide() { photo.status = ''; },
  async onEnter(_el, ctx, i) {
    const id = photoItems()[i];
    const refresh = () => { ctx.rerender(); };
    if (id === 'capture') {
      photo.status = t('Opening camera…');
      refresh();
      try {
        const picked = await pickPhoto();
        photo.status = picked ? '' : t('No photo chosen.');
        if (picked) photo.preview = picked;
      } catch (err) {
        photo.status = err.message || t('Photo could not be read.');
      }
      refresh();
      return;
    }
    const sample = DEMO_SAMPLES.find((s) => s.id === id);
    if (sample) {
      const loaded = await loadDemoSample(sample);
      if (loaded) photo.preview = loaded;
      else photo.status = t('Demo sample missing on server.');
      refresh();
      return;
    }
    if (id === 'use') {
      composer.image = photo.preview;
      composer.audio = null; // one attachment type per question keeps the model focused
      composer.mode = 'photo';
      photo.preview = null;
      track('photo_attached', { demo: Boolean(composer.image.isDemoSample) });
      returnToComposer(ctx);
      return;
    }
    if (id === 'retake' || id === 'remove') {
      if (photo.preview && photo.preview !== composer.image) URL.revokeObjectURL(photo.preview.previewUrl);
      if (id === 'remove' && composer.image) composer.clearMedia();
      photo.preview = null;
      refresh();
    }
  },
};

// ---------------------------------------------------------------- Voice

let recorder = null;
let player = null;
let voiceGeneration = 0;
const voice = { state: 'idle', seconds: 0, blob: null, error: '' };

function resetVoice() {
  voiceGeneration += 1;
  recorder?.cancel();
  recorder = null;
  player?.pause();
  player = null;
  Object.assign(voice, { state: 'idle', seconds: 0, blob: null, error: '' });
}

async function chooseVoiceFile(ctx) {
  resetVoice();
  const generation = voiceGeneration;
  voice.state = 'choosing';
  ctx.rerender();
  try {
    const blob = await pickAudio();
    if (generation !== voiceGeneration) return;
    voice.blob = blob;
    voice.seconds = null;
    voice.state = blob ? 'done' : 'idle';
    voice.error = blob ? '' : t('No recording chosen.');
  } catch (err) {
    if (generation !== voiceGeneration) return;
    voice.state = 'idle';
    voice.error = err?.message || t('Recording could not be read.');
  }
  ctx.rerender();
}

function sendVoice(ctx) {
  if (!voice.blob) return;
  composer.audio = { blob: voice.blob, seconds: voice.seconds };
  composer.image = null;
  composer.mode = 'voice';
  track('voice_recorded', { seconds: voice.seconds });
  voice.state = 'sent'; // keep the blob: a failed request returns to the composer with it
  ask(ctx, { text: composer.text, audio: composer.audio, replace: true, origin: 'input' });
}

async function toggleRecord(ctx) {
  if (voice.state === 'choosing') return;
  if (voice.state === 'starting') return; // waiting on the permission prompt
  if (voice.state === 'recording') { recorder.stop(); return; }
  if (voice.state === 'done') { sendVoice(ctx); return; }
  if (capabilities().preferVoiceUpload || !capabilities().voiceCapture) {
    await chooseVoiceFile(ctx);
    return;
  }
  resetVoice();
  recorder = new VoiceRecorder({
    onTick: (s) => {
      voice.seconds = s;
      const timer = ctx.root.querySelector('.ai-timer');
      if (timer) timer.textContent = `${String(s).padStart(2, '0')}s / ${MAX_SECONDS}s`;
    },
    onStop: (blob, s) => {
      voice.blob = blob;
      voice.seconds = s;
      voice.state = blob ? 'done' : 'idle';
      voice.error = blob ? '' : t('Nothing was recorded. Try again.');
      ctx.rerender();
    },
  });
  const mine = recorder;
  voice.state = 'starting';
  ctx.rerender(); // show "Allow the microphone…" while the browser prompt is open
  // An ignored permission prompt never settles; give up eventually instead of
  // sitting on 00s forever.
  const giveUp = setTimeout(() => {
    if (recorder !== mine || voice.state !== 'starting') return;
    mine.cancel();
    recorder = null;
    voice.state = 'idle';
    voice.error = `${t('No microphone permission. Press Enter to retry.')}${DEBUG ? ' [no response]' : ''}`;
    console.warn('voice: getUserMedia never settled (no prompt or no mic on this runtime)');
    ctx.rerender();
  }, PERMISSION_WAIT_MS);
  try {
    await mine.start();
    if (recorder !== mine || voice.state !== 'starting') return; // cancelled meanwhile
    voice.state = 'recording';
  } catch (err) {
    if (recorder !== mine) return;
    // With ?debug=1 the raw error name is appended so a device can be diagnosed
    // (NotAllowedError, NotFoundError, NotReadableError, SecurityError, ...).
    const why = DEBUG ? ` [${err?.name || 'error'}]` : '';
    voice.error = (err?.name === 'NotAllowedError' ? t('Microphone blocked. Type instead.') : t('Microphone not available.')) + why;
    console.warn('voice: getUserMedia failed', err?.name, err?.message);
    recorder = null;
    voice.state = 'idle';
  } finally {
    clearTimeout(giveUp);
  }
  ctx.rerender();
}

export const AskAIVoice = {
  name: 'AskAIVoice',
  title: 'Voice',
  statusBadge: () => ({ choosing: t('… FILE'), starting: t('… MIC'), recording: t('● REC'), done: voice.seconds ? `${voice.seconds}s` : t('READY') }[voice.state] || ''),
  softLeft: {
    label: () => (voice.state === 'done' ? t('Redo') : ''),
    handler: (ctx) => { if (voice.state === 'done') { resetVoice(); ctx.rerender(); } },
  },
  softCenter: {
    label: () => ({ choosing: '…', starting: '…', recording: t('Stop'), done: t('Send') }[voice.state]
      || t(capabilities().preferVoiceUpload || !capabilities().voiceCapture ? 'Choose' : 'Record')),
    handler: (ctx) => toggleRecord(ctx),
  },
  softRight: { label: 'Cancel', handler: (ctx) => { resetVoice(); ctx.router.pop(); } },

  render() {
    const wrap = el('ai-screen ai-voice');
    const mic = el(`ai-mic${voice.state === 'recording' ? ' live' : ''}`);
    const level = el('ai-level');
    for (let i = 0; i < 5; i++) level.appendChild(el('ai-level-bar'));
    mic.append(el('ai-orb'), level);
    wrap.appendChild(mic);
    wrap.appendChild(el('ai-timer', voice.seconds == null ? t('RECORDING READY') : `${String(voice.seconds).padStart(2, '0')}s / ${MAX_SECONDS}s`));

    const hint = t({
      idle: capabilities().preferVoiceUpload || !capabilities().voiceCapture
        ? 'Press Enter to open the phone recorder.'
        : 'Press Enter and ask your question.',
      choosing: 'Opening phone recorder…',
      starting: 'Allow the microphone when the phone asks.',
      recording: 'Listening… Enter to stop.',
      done: '1 Play · Enter Send · Left Redo',
    }[voice.state] || '');
    wrap.appendChild(el('ai-hint', voice.error || hint));
    if (voice.state === 'idle' && !isCompact()) {
      wrap.appendChild(el('ai-privacy', t('Voice is sent to AI for this answer only.')));
    }
    return wrap;
  },
  onShow() {
    // A sent clip now lives on the composer (for one retry); start fresh here.
    if (voice.state === 'sent') resetVoice();
  },
  // Leaving mid-recording must release the microphone.
  onHide() {
    if (voice.state === 'recording' || voice.state === 'starting' || voice.state === 'choosing') resetVoice();
    player?.pause();
  },
  onKey(action) {
    if (action === 'NUM_1' && voice.state === 'done' && voice.blob) {
      player?.pause();
      player = new Audio(URL.createObjectURL(voice.blob));
      player.onended = () => URL.revokeObjectURL(player.src);
      player.play().catch(() => { /* playback unsupported: sending still works */ });
      return true;
    }
    return false;
  },
};

// ---------------------------------------------------------------- History

export const AskAIHistory = {
  name: 'AskAIHistory',
  title: 'Recent',
  numericSelect: true,
  softLeft: { label: '', handler() {} },
  render() {
    const list = el('ai-screen list');
    const items = history();
    if (!items.length) {
      list.appendChild(el('msg', t('No questions yet. Your last five appear here.')));
      return list;
    }
    items.forEach((q, i) => {
      const row = el('item ai-preset');
      row.append(el('ai-preset-num', String(i + 1)), el('ai-preset-label', q));
      list.appendChild(row);
    });
    return list;
  },
  onEnter(_el, ctx, i) {
    const q = history()[i];
    if (!q) return;
    composer.reset();
    ask(ctx, { text: q, replace: true, origin: 'home' });
  },
};
