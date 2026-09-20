import { el } from '../dom.js';
import { MultiTap } from '../t9.js';
import { getJSON, postJSON, ApiError } from '../api.js';
import { identity } from '../state.js';
import { outdoor, toggleOutdoor } from '../outdoor.js';
import { t, language, setLanguage, LANGUAGES } from '../i18n/index.js';

const draft = {
  mode: 'signup', phone: '', pin: '', pinConfirm: '', name: new MultiTap({ max: 60 }), village: new MultiTap({ max: 80 }),
  regionId: null, language, cropIds: [], cropUserId: null, currentPin: '', newPin: '', newPinConfirm: '',
};
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
  name: 'Your name', title: () => draft.mode === 'edit-name' ? 'Edit name' : 'Create account', softLeft: { label: 'Delete', handler(ctx) { draft.name.backspace(); ctx.rerender(); } }, softCenter: { label: () => draft.mode === 'edit-name' ? 'Save' : 'Next', handler(ctx) { finishName(ctx); } },
  render() { const root = el('form-screen'); root.append(input('Your name', draft.name.value, { hint: '2–9 keys type letters · # confirms a letter' })); return root; },
  onKey(action, ctx) { return editKey(action, draft.name, ctx, () => finishName(ctx)); },
};
function finishName(ctx) {
  const value = draft.name.commit().trim();
  if (!value) return ctx.rerender();
  if (draft.mode === 'edit-name') return saveProfile(ctx, { displayName: value }, 'back');
  ctx.router.push('ProfileVillage');
}
export const ProfileVillage = {
  name: 'Your village', title: () => draft.mode === 'edit-village' ? 'Edit village' : 'Create account', softLeft: { label: 'Delete', handler(ctx) { draft.village.backspace(); ctx.rerender(); } }, softCenter: { label: () => draft.mode === 'edit-village' ? 'Save' : 'Next', handler(ctx) { finishVillage(ctx); } },
  render() { const root = el('form-screen'); root.append(input('Village / town', draft.village.value, { hint: '2–9 keys type letters · # confirms a letter' })); return root; },
  onKey(action, ctx) { return editKey(action, draft.village, ctx, () => finishVillage(ctx)); },
};
function finishVillage(ctx) {
  const value = draft.village.commit().trim();
  if (!value) return ctx.rerender();
  if (draft.mode === 'edit-village') return saveProfile(ctx, { village: value }, 'back');
  ctx.router.push('ProfileRegion');
}
export const ProfileRegion = {
  name: 'Your region', title: () => draft.mode === 'edit-region' ? 'Edit region' : 'Create account', numericSelect: true,
  softLeft: { label: 'Back', handler(ctx) { ctx.router.pop(); } }, softCenter: { label: () => draft.mode === 'edit-region' ? 'Save' : 'Create', handler(ctx, _el, i) { saveSignup(ctx, i); } },
  render(ctx) { const root = el('list'); const regions = identity.options?.regions || []; if (!regions.length) { root.append(note(t('Loading regions…'))); options().then(ctx.rerender).catch(() => {}); return root; } regions.forEach((region, i) => root.append(el('item', `${i + 1}  ${region.name}`))); return root; },
  initialFocus: () => draft.mode === 'edit-region' ? identity.options?.regions?.findIndex((region) => region.id === identity.profile?.regionId) : null,
  onEnter(_el, ctx, i) { saveSignup(ctx, i); },
};
async function saveSignup(ctx, index) {
  try {
    const list = (await options()).regions;
    const region = list[index];
    if (!region) return;
    if (draft.mode === 'edit-region') return saveProfile(ctx, { regionId: region.id }, 'back');
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
  render() {
    const root = el('list');
    ['My profile', 'Language', 'Crops I follow', outdoor ? 'Outdoor mode: On' : 'Outdoor mode: Off', 'Account & security']
      .forEach((label, i) => root.append(el('item', `${i + 1}  ${t(label)}`)));
    return root;
  },
  onEnter(_el, ctx, i) {
    if (i === 0) ctx.router.push('ProfileSummary'); else if (i === 1) ctx.router.push('LanguageSettings'); else if (i === 2) ctx.router.push('CropSettings');
    else if (i === 3) { toggleOutdoor(); ctx.rerender(); ctx.focus.set(3); } else if (i === 4) ctx.router.push('AccountSecurity');
  },
};
export const ProfileSummary = {
  name: 'My profile', title: 'My profile', numericSelect: true,
  softCenter: { label: 'Edit', handler(ctx, _el, i) { beginProfileEdit(ctx, i); } },
  render() {
    const p = identity.profile; const root = el('list');
    [['Name', p?.displayName], ['Village', p?.village], ['Region', p?.regionName]].forEach(([label, value], i) => {
      const row = el('item forum-choice');
      row.append(el('forum-choice-n', String(i + 1), 'span'), el('forum-choice-label', t(label), 'span'), el('forum-choice-value', value || '—', 'span'));
      root.append(row);
    });
    return root;
  },
  onEnter(_el, ctx, i) { beginProfileEdit(ctx, i); },
};
function beginProfileEdit(ctx, index) {
  const p = identity.profile;
  draft.name.set(p.displayName); draft.village.set(p.village); draft.regionId = p.regionId; draft.language = p.language; draft.cropIds = p.cropIds || [];
  if (index === 0) { draft.mode = 'edit-name'; ctx.router.push('ProfileName'); }
  else if (index === 1) { draft.mode = 'edit-village'; ctx.router.push('ProfileVillage'); }
  else if (index === 2) { draft.mode = 'edit-region'; ctx.router.push('ProfileRegion'); }
}
async function saveProfile(ctx, changes, returnTo) {
  try {
    const p = identity.profile;
    const result = await fetch('/api/auth/profile', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: p.displayName, village: p.village, regionId: p.regionId, language: p.language, cropIds: p.cropIds || [], ...changes }) });
    const body = await result.json();
    if (!result.ok || body.ok === false) throw new Error(body.error?.message || t('Could not save profile.'));
    identity.profile = body.user;
    if (setLanguage(body.user.language)) return; // reloads in the new language
    if (returnTo === 'back') ctx.router.pop(); else ctx.router.replace(returnTo);
  } catch (err) { ctx.router.push('AuthResult', { message: errorText(err), retry: returnTo === 'back' ? 'ProfileSummary' : returnTo }); }
}
export const LanguageSettings = {
  name: 'Language', title: 'Language', numericSelect: true,
  render() { const root = el('list'); LANGUAGES.forEach(([code, label], i) => root.append(el('item', `${i + 1}  ${identity.profile?.language === code ? '✓ ' : ''}${label}`))); return root; },
  onEnter(_el, ctx, i) { saveProfile(ctx, { language: LANGUAGES[i][0] }, 'Settings'); },
};
export const CropSettings = {
  name: 'Crops I follow', title: 'Crops I follow', numericSelect: true,
  softCenter: { label: 'Save', handler(ctx) { saveProfile(ctx, { cropIds: draft.cropIds }, 'Settings'); } },
  onShow(ctx) { if (draft.cropUserId !== identity.profile?.id) { draft.cropIds = [...(identity.profile?.cropIds || [])]; draft.cropUserId = identity.profile?.id; } if (!identity.options) options().then(ctx.rerender).catch(() => {}); },
  render() { const root = el('list'); root.append(note(t('Used to personalise prices, AI answers, and your farm dashboard. Choose up to 12.'))); const crops = identity.options?.crops || []; if (!crops.length) { root.append(note(t('Loading crops…'))); return root; } crops.forEach((crop, i) => root.append(el('item', `${i + 1}  ${draft.cropIds.includes(crop.id) ? '✓ ' : ''}${t(crop.name)}`))); return root; },
  onEnter(_el, ctx, i) { const crop = identity.options?.crops?.[i]; if (!crop) return; const selected = draft.cropIds.includes(crop.id); if (!selected && draft.cropIds.length >= 12) return; draft.cropIds = selected ? draft.cropIds.filter((id) => id !== crop.id) : [...draft.cropIds, crop.id]; ctx.rerender(); },
};

export const AccountSecurity = {
  name: 'Account & security', title: 'Account & security', numericSelect: true,
  render() { const root = el('list'); ['Change PIN', 'Sign out other phones', 'Sign out'].forEach((label, i) => root.append(el('item', `${i + 1}  ${t(label)}`))); return root; },
  onEnter(_el, ctx, i) { if (i === 0) beginPinChange(ctx); else if (i === 1) confirmLogoutOthers(ctx); else if (i === 2) confirmLogout(ctx); },
};

let pinReturnDepth = 0;
function beginPinChange(ctx) {
  draft.currentPin = ''; draft.newPin = ''; draft.newPinConfirm = ''; pinReturnDepth = ctx.router.depth;
  ctx.router.push('ChangePinCurrent');
}
function pinStep({ name, title, key, next, submit = false }) {
  const advance = (ctx) => {
    if (draft[key].length !== 6) return ctx.rerender();
    if (submit) return changePin(ctx);
    ctx.router.push(next);
  };
  return {
    name, title,
    softLeft: { label: 'Delete', handler(ctx) { draft[key] = draft[key].slice(0, -1); ctx.rerender(); } },
    softCenter: { label: submit ? 'Save' : 'Next', handler: advance },
    render() { const root = el('form-screen'); root.append(input(title, draft[key], { secret: true, hint: 'Use six digits you can remember. Not your birth date.' })); return root; },
    onKey(action, ctx) { if (action.startsWith('NUM_')) { draft[key] = digits(draft[key] + action.slice(4), 6); ctx.rerender(); return true; } return false; },
  };
}
export const ChangePinCurrent = pinStep({ name: 'Current PIN', title: 'Current PIN', key: 'currentPin', next: 'ChangePinNew' });
export const ChangePinNew = pinStep({ name: 'New PIN', title: 'New PIN', key: 'newPin', next: 'ChangePinConfirm' });
export const ChangePinConfirm = pinStep({ name: 'Confirm new PIN', title: 'Confirm new PIN', key: 'newPinConfirm', submit: true });
async function changePin(ctx) {
  if (draft.newPin !== draft.newPinConfirm) {
    draft.newPinConfirm = '';
    return ctx.router.replace('AuthResult', { message: t('PINs did not match. Please enter it again.'), retry: 'AccountSecurity' });
  }
  try {
    await postJSON('/api/auth/change-pin', { currentPin: draft.currentPin, pin: draft.newPin });
    draft.currentPin = ''; draft.newPin = ''; draft.newPinConfirm = '';
    const toast = document.getElementById('toast');
    if (toast) { toast.textContent = `✓ ${t('PIN changed.')}`; toast.hidden = false; setTimeout(() => { toast.hidden = true; }, 5000); }
    ctx.router.popTo(pinReturnDepth);
  } catch (err) { ctx.router.replace('AuthResult', { message: errorText(err), retry: 'AccountSecurity' }); }
}
// Phone lost or stolen: sign in on the phone in hand, then end every other session from here.
function confirmLogoutOthers(ctx) {
  ctx.router.push('ForumPicker', {
    title: 'Sign out other phones', note: t('Lost a phone? Every other phone signed in to your account is signed out. This phone stays signed in.'),
    options: [{ label: t('Yes, sign them out'), value: true }, { label: t('No, go back'), value: false }],
    async onPick(o, c) {
      if (!o.value) return c.router.pop();
      try {
        const r = await postJSON('/api/auth/logout-others', {});
        c.router.pop();
        const toast = document.getElementById('toast'); // the shared status bar, as the market poller uses
        if (toast) { toast.textContent = `✓ ${t('Signed out other phones: {n}', { n: r.ended })}`; toast.hidden = false; setTimeout(() => { toast.hidden = true; }, 5000); }
      } catch (err) { c.router.replace('AuthResult', { message: errorText(err), retry: 'AccountSecurity' }); }
    },
  });
}
function confirmLogout(ctx) {
  ctx.router.push('ForumPicker', {
    title: 'Sign out?', note: t('You will need your phone number and PIN to sign in again.'),
    options: [{ label: t('Yes, sign out'), value: true }, { label: t('No, stay signed in'), value: false }],
    onPick(o, c) { if (o.value) logout(c); else c.router.pop(); },
  });
}
async function logout(ctx) { try { await postJSON('/api/auth/logout', {}); identity.profile = null; ctx.router.resetTo('AuthWelcome'); } catch (err) { ctx.router.push('AuthResult', { message: errorText(err), retry: 'Settings' }); } }

// Before signing in there is no profile to hold the choice, so it is kept in this browser only.
export const WelcomeLanguage = {
  name: 'Language', title: 'Language', numericSelect: true,
  render() { const root = el('list'); LANGUAGES.forEach(([code, label], i) => root.append(el('item', `${i + 1}  ${language === code ? '✓ ' : ''}${label}`))); return root; },
  onEnter(_el, ctx, i) { if (!setLanguage(LANGUAGES[i][0])) ctx.router.pop(); },
};
