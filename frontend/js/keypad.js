// Central key map. Verified on the Cloud Phone simulator (2026-09-19):
//  - arrows / Enter: standard key values
//  - left soft key: Escape (kc 27)
//  - right soft key: NO keydown reaches the page; the platform handles it as history.back()/close
//  - digits report code=DigitN, star = NumpadMultiply (kc 106)
//  - '#' arrives as key="#" code=Digit3 kc=51 shift=false, so e.key tells it apart from '3'
export const KEYMAP = {
  ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
  Enter: 'ENTER',
  SoftLeft: 'SOFT_L', SoftRight: 'SOFT_R',
  Escape: 'SOFT_L', F12: 'SOFT_R', // official sample: desktop Escape/F12 = left/right soft key
  Backspace: 'BACK',
  '*': 'STAR', NumpadMultiply: 'STAR',
  '#': 'HASH',
};
for (let i = 0; i <= 9; i++) {
  KEYMAP[String(i)] = `NUM_${i}`;
  KEYMAP[`Digit${i}`] = `NUM_${i}`;
  KEYMAP[`Numpad${i}`] = `NUM_${i}`;
}

const KEYCODE_MAP = { 106: 'STAR', 112: 'SOFT_L', 113: 'SOFT_R' };

// Pure: KeyboardEvent-like -> action name (or undefined).
export function resolveAction(e) {
  // '#' is Shift+3 on a PC layout; some devices report it as Digit3 only.
  if (e.key === '#' || (e.shiftKey && e.code === 'Digit3')) return 'HASH';
  return KEYMAP[e.key] || KEYMAP[e.code] || KEYCODE_MAP[e.keyCode];
}

export function initKeypad(dispatch) {
  addEventListener('keydown', (e) => {
    const action = resolveAction(e);
    if (!action) return;
    e.preventDefault();
    dispatch(action);
  });
}
