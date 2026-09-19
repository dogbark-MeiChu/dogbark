import { el } from '../dom.js';
import { MultiTap } from '../t9.js';
import { getJSON, postJSON, ApiError } from '../api.js';
import { identity } from '../state.js';
import { t, language, setLanguage, LANGUAGES } from '../i18n/index.js';

const draft = { mode: 'signup', phone: '', pin: '', pinConfirm: '', name: new MultiTap({ max: 60 }), village: new MultiTap({ max: 80 }), regionId: null, language, cropIds: [], cropUserId: null };
const digits = (value, max) => String(value).replace(/\D/g, '').slice(0, max);
const note = (text) => el('msg', text);
function input(label, value, { secret = false, hint } = {}) {
  const box = el('entry');
  box.append(el('entry-label', t(label)));
  box.append(el('entry-value', secret ? '•'.repeat(value.length) : value || '—'));
  if (hint) box.append(el('entry-hint dim', t(hint)));
  return box;
}
function errorText(err) { return err instanceof ApiError || err?.message ? err.message : t('Network problem. Try again.'); }
async function options() {
  if (!identity.options) identity.options = await getJSON('/api/auth/options');
  return identity.options;
}
function enterMain(ctx, profile) {
  identity.profile = profile;
  if (setLanguage(profile.language)) return; // reloads in the member's language
  ctx.router.replace('Home');
}
function editKey(action, tap, ctx, next) {
  if (action.startsWith('NUM_')) { tap.press(Number(action.slice(4))); ctx.rerender(); return true; }
  if (action === 'HASH') { tap.hash(); ctx.rerender(); return true; }
  if (action === 'SOFT_L') { tap.backspace(); ctx.rerender(); return true; }
  if (action === 'ENTER') { tap.commit(); if (tap.value.trim()) next(); else ctx.rerender(); return true; }
  return false;
}

export const AuthWelcome = {
  name: 'Welcome', title: 'AgriLink', numericSelect: true,
  softLeft: { label: '' }, softRight: { label: '' },
  render() { const root = el('list'); root.append(note(t('Your market, your community.'))); ['Sign in', 'Create account', 'Language'].forEach((label, i) => root.append(el('item', `${i + 1}  ${t(label)}`))); return root; },
  onEnter(_el, ctx, i) { if (i === 2) return ctx.router.push('WelcomeLanguage'); draft.mode = i ? 'signup' : 'login'; draft.phone = ''; draft.pin = ''; draft.pinConfirm = ''; ctx.router.push('AuthPhone'); },
};

export const AuthPhone = {
  name: 'Phone number', title: () => draft.mode === 'signup' ? 'Create account' : 'Sign in',
  softLeft: { label: 'Delete', handler(ctx) { draft.phone = draft.phone.slice(0, -1); ctx.rerender(); } },
  softCenter: { label: 'Next', handler(ctx) { if (draft.phone.length >= 8) ctx.router.push('AuthPin'); else ctx.rerender(); } },
  render() { const root = el('form-screen'); root.append(input('Mobile number', draft.phone, { hint: 'Digits only · 8–15 digits' })); root.append(note(t('Use your phone number as your account ID.'))); return root; },
  onKey(action, ctx) { if (action.startsWith('NUM_')) { draft.phone = digits(draft.phone + action.slice(4), 15); ctx.rerender(); return true; } return false; },
};

export const AuthPin = {
  name: 'PIN', title: () => draft.mode === 'signup' ? (draft.pin ? 'Confirm PIN' : 'Choose PIN') : 'Enter PIN',
  softLeft: { label: 'Delete', handler(ctx) { const key = draft.mode === 'signup' && draft.pin ? 'pinConfirm' : 'pin'; draft[key] = draft[key].slice(0, -1); ctx.rerender(); } },
  softCenter: { label: 'Next', handler(ctx) { advancePin(ctx); } },
  render() {
    const confirming = draft.mode === 'signup' && draft.pin.length === 6;
    const value = confirming ? draft.pinConfirm : draft.pin;
    const root = el('form-screen'); root.append(input(confirming ? 'Enter PIN again' : '6-digit PIN', value, { secret: true, hint: 'Use six digits you can remember. Not your birth date.' }));
    root.append(note(t(draft.mode === 'signup' ? 'Your PIN is private and can be changed later.' : 'Enter the PIN for this phone number.')));
    return root;
  },
  onKey(action, ctx) { if (action.startsWith('NUM_')) { const key = draft.mode === 'signup' && draft.pin.length === 6 ? 'pinConfirm' : 'pin'; draft[key] = digits(draft[key] + action.slice(4), 6); ctx.rerender(); return true; } return false; },
};
async function advancePin(ctx) {
  const confirming = draft.mode === 'signup' && draft.pin.length === 6;
  const value = confirming ? draft.pinConfirm : draft.pin;
  if (value.length !== 6) return ctx.rerender();
  if (draft.mode === 'login') {
    try { const result = await postJSON('/api/auth/login', { phone: draft.phone, pin: draft.pin }); enterMain(ctx, result.user); } catch (err) { ctx.router.replace('AuthResult', { message: errorText(err), retry: 'AuthPhone' }); }
  } else if (!confirming) ctx.rerender();
  else if (draft.pin !== draft.pinConfirm) { draft.pinConfirm = ''; ctx.router.replace('AuthResult', { message: t('PINs did not match. Please enter it again.'), retry: 'AuthPin' }); }
  else ctx.router.push('ProfileName');
}

export const ProfileName = {
  name: 'Your name', title: () => draft.mode === 'edit' ? 'Edit profile' : 'Create account', softLeft: { label: 'Delete', handler(ctx) { draft.name.backspace(); ctx.rerender(); } }, softCenter: { label: 'Next', handler(ctx) { draft.name.commit(); if (draft.name.value.trim()) ctx.router.push('ProfileVillage'); else ctx.rerender(); } },
  render() { const root = el('form-screen'); root.append(input('Your name', draft.name.value, { hint: '2–9 keys type letters · # confirms a letter' })); return root; },
  onKey(action, ctx) { return editKey(action, draft.name, ctx, () => ctx.router.push('ProfileVillage')); },
};
export const ProfileVillage = {
  name: 'Your village', title: () => draft.mode === 'edit' ? 'Edit profile' : 'Create account', softLeft: { label: 'Delete', handler(ctx) { draft.village.backspace(); ctx.rerender(); } }, softCenter: { label: 'Next', handler(ctx) { draft.village.commit(); if (draft.village.value.trim()) ctx.router.push('ProfileRegion'); else ctx.rerender(); } },
  render() { const root = el('form-screen'); root.append(input('Village / town', draft.village.value, { hint: '2–9 keys type letters · # confirms a letter' })); return root; },
  onKey(action, ctx) { return editKey(action, draft.village, ctx, () => ctx.router.push('ProfileRegion')); },
};
export const ProfileRegion = {
  name: 'Your region', title: () => draft.mode === 'edit' ? 'Edit profile' : 'Create account', numericSelect: true,
  softLeft: { label: 'Back', handler(ctx) { ctx.router.pop(); } }, softCenter: { label: () => draft.mode === 'edit' ? 'Save' : 'Create', handler(ctx, _el, i) { saveSignup(ctx, i); } },
  render(ctx) { const root = el('list'); const regions = identity.options?.regions || []; if (!regions.length) { root.append(note(t('Loading regions…'))); options().then(ctx.rerender).catch(() => {}); return root; } regions.forEach((region, i) => root.append(el('item', `${i + 1}  ${region.name}`))); return root; },
  onEnter(_el, ctx, i) { saveSignup(ctx, i); },
};
async function saveSignup(ctx, index) {
  try {
    const list = (await options()).regions;
    const region = list[index];
    if (!region) return;
    if (draft.mode === 'edit') {
      const result = await fetch('/api/auth/profile', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: draft.name.commit().trim(), village: draft.village.commit().trim(), regionId: region.id, language: draft.language, cropIds: draft.cropIds }) });
      const body = await result.json();
      if (!result.ok || body.ok === false) throw new Error(body.error?.message || t('Could not save profile.'));
      identity.profile = body.user;
      ctx.router.replace('ProfileSummary');
      return;
    }
    const result = await postJSON('/api/auth/signup', { phone: draft.phone, pin: draft.pin, displayName: draft.name.commit().trim(), village: draft.village.commit().trim(), regionId: region.id, language: draft.language, cropIds: draft.cropIds });
    enterMain(ctx, result.user);
  } catch (err) { ctx.router.push('AuthResult', { message: errorText(err), retry: 'ProfileRegion' }); }
}

export const AuthResult = {
  name: 'Account', title: 'Account', softCenter: { label: 'Try again', handler(ctx) { ctx.router.replace(ctx.params.retry); } },
  render(ctx) { return note(ctx.params.message); },
};

export const Settings = {
  name: 'Settings', title: 'Settings', numericSelect: true,
  render() { const root = el('list'); ['My profile', 'Language', 'My crops', 'Sign out'].forEach((label, i) => root.append(el('item', `${i + 1}  ${t(label)}`))); return root; },
  onEnter(_el, ctx, i) { if (i === 0) ctx.router.push('ProfileSummary'); else if (i === 1) ctx.router.push('LanguageSettings'); else if (i === 2) ctx.router.push('CropSettings'); else logout(ctx); },
};
export const ProfileSummary = {
  name: 'My profile', title: 'My profile',
  softCenter: { label: 'Edit', handler(ctx) { beginProfileEdit(ctx); } },
  render() { const p = identity.profile; const root = el('form-screen'); root.append(input('Name', p?.displayName)); root.append(input('Village', p?.village)); root.append(input('Region', p?.regionName)); root.append(input('Language', LANGUAGES.find(([code]) => code === p?.language)?.[1] || p?.language)); return root; },
};
function beginProfileEdit(ctx) {
  const p = identity.profile;
  draft.mode = 'edit'; draft.name.set(p.displayName); draft.village.set(p.village); draft.regionId = p.regionId; draft.language = p.language; draft.cropIds = p.cropIds || [];
  ctx.router.push('ProfileName');
}
async function saveProfile(ctx, changes, returnTo) {
  try {
    const p = identity.profile;
    const result = await fetch('/api/auth/profile', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: p.displayName, village: p.village, regionId: p.regionId, language: p.language, cropIds: p.cropIds || [], ...changes }) });
    const body = await result.json();
    if (!result.ok || body.ok === false) throw new Error(body.error?.message || t('Could not save profile.'));
    identity.profile = body.user;
    if (setLanguage(body.user.language)) return; // reloads in the new language
    ctx.router.replace(returnTo);
  } catch (err) { ctx.router.push('AuthResult', { message: errorText(err), retry: returnTo }); }
}
export const LanguageSettings = {
  name: 'Language', title: 'Language', numericSelect: true,
  render() { const root = el('list'); LANGUAGES.forEach(([code, label], i) => root.append(el('item', `${i + 1}  ${identity.profile?.language === code ? '✓ ' : ''}${label}`))); return root; },
  onEnter(_el, ctx, i) { saveProfile(ctx, { language: LANGUAGES[i][0] }, 'Settings'); },
};
export const CropSettings = {
  name: 'My crops', title: 'My crops', numericSelect: true,
  softCenter: { label: 'Save', handler(ctx) { saveProfile(ctx, { cropIds: draft.cropIds }, 'Settings'); } },
  onShow(ctx) { if (draft.cropUserId !== identity.profile?.id) { draft.cropIds = [...(identity.profile?.cropIds || [])]; draft.cropUserId = identity.profile?.id; } if (!identity.options) options().then(ctx.rerender).catch(() => {}); },
  render() { const root = el('list'); const crops = identity.options?.crops || []; if (!crops.length) { root.append(note(t('Loading crops…'))); return root; } crops.forEach((crop, i) => root.append(el('item', `${i + 1}  ${draft.cropIds.includes(crop.id) ? '✓ ' : ''}${t(crop.name)}`))); return root; },
  onEnter(_el, ctx, i) { const crop = identity.options?.crops?.[i]; if (!crop) return; draft.cropIds = draft.cropIds.includes(crop.id) ? draft.cropIds.filter((id) => id !== crop.id) : [...draft.cropIds, crop.id]; ctx.rerender(); },
};
async function logout(ctx) { try { await postJSON('/api/auth/logout', {}); identity.profile = null; ctx.router.resetTo('AuthWelcome'); } catch (err) { ctx.router.push('AuthResult', { message: errorText(err), retry: 'Settings' }); } }

// Before signing in there is no profile to hold the choice, so it is kept in this browser only.
export const WelcomeLanguage = {
  name: 'Language', title: 'Language', numericSelect: true,
  render() { const root = el('list'); LANGUAGES.forEach(([code, label], i) => root.append(el('item', `${i + 1}  ${language === code ? '✓ ' : ''}${label}`))); return root; },
  onEnter(_el, ctx, i) { if (!setLanguage(LANGUAGES[i][0])) ctx.router.pop(); },
};
