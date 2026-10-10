import { fail } from './policy.js';

const named = {
  Enter: [13, 'Enter', 'Enter'], Tab: [9, 'Tab', 'Tab'], Escape: [27, 'Escape', 'Escape'],
  Backspace: [8, 'Backspace', 'Backspace'], Delete: [46, 'Delete', 'Delete'],
  ArrowDown: [40, 'ArrowDown', 'ArrowDown'], ArrowUp: [38, 'ArrowUp', 'ArrowUp'],
  ArrowLeft: [37, 'ArrowLeft', 'ArrowLeft'], ArrowRight: [39, 'ArrowRight', 'ArrowRight'],
  Space: [32, ' ', 'Space'], Home: [36, 'Home', 'Home'], End: [35, 'End', 'End'],
  PageUp: [33, 'PageUp', 'PageUp'], PageDown: [34, 'PageDown', 'PageDown'],
  Plus: [187, '+', 'Equal'], Minus: [189, '-', 'Minus']
};
const modifierBits = { Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Cmd: 4, Shift: 8 };

export function keyEvent(key) {
  if (typeof key !== 'string' || key.length > 80) fail('INVALID_PARAMS', 'key must be a supported key or modifier combination');
  const parts = key.split('+'); const final = parts.pop(); let modifiers = 0;
  for (const modifier of parts) {
    const bit = Object.hasOwn(modifierBits, modifier) ? modifierBits[modifier] : 0;
    if (!bit || modifiers & bit) fail('INVALID_PARAMS', 'Use distinct Alt, Control, Meta and Shift modifiers');
    modifiers |= bit;
  }
  let entry = Object.hasOwn(named, final) ? named[final] : null;
  if (/^[a-z]$/i.test(final)) entry = [final.toUpperCase().charCodeAt(0), modifiers & 8 ? final.toUpperCase() : final.toLowerCase(), `Key${final.toUpperCase()}`];
  if (/^\d$/.test(final)) entry = [final.charCodeAt(0), final, `Digit${final}`];
  if (!entry) fail('INVALID_PARAMS', 'Use a letter, digit, navigation key, Enter, Tab, Escape, Backspace, Delete, Space, Plus or Minus');
  const [windowsVirtualKeyCode, name, code] = entry;
  const text = modifiers & 7 ? undefined : final === 'Enter' ? '\r' : name.length === 1 ? name : undefined;
  const selectAll = name.toLowerCase() === 'a' && (modifiers === 2 || modifiers === 4);
  return { key: name, code, windowsVirtualKeyCode, modifiers, ...(text !== undefined ? { text } : {}), ...(selectAll ? { commands: ['selectAll'] } : {}) };
}
