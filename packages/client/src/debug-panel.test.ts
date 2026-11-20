import { describe, expect, it } from 'vitest';
import type { DebugCatalog, SheetMessage } from '@epochs/shared';
import { attributeButtons, mainAttributeOf, movePointMessage } from './debug-panel';

const catalog: DebugCatalog = {
  presets: [
    { id: 'hedge-witch', name: 'Hedge Witch', mainAttribute: 'wits' },
    { id: 'militia', name: 'Militia', mainAttribute: 'might' },
  ],
  weapons: [],
  armors: [],
  classes: [],
  waves: [],
  maxLevel: 10,
  maxClassRank: 3,
};

const zero = { might: 0, finesse: 0, vigor: 0, wits: 0, spirit: 0 };

function sheet(presetId: string | null): SheetMessage {
  return {
    type: 'sheet',
    presetId,
    level: 1,
    attributes: { might: 1, finesse: 1, vigor: 1, wits: 1, spirit: 1 },
    levelPoints: zero,
    weaponId: null,
    armorId: null,
    classRanks: {},
    maxHealth: 30,
  };
}

describe('mainAttributeOf', () => {
  it('is the sheet preset main attribute', () => {
    expect(mainAttributeOf(catalog, sheet('hedge-witch'))).toBe('wits');
    expect(mainAttributeOf(catalog, sheet('militia'))).toBe('might');
  });

  it('is the first attribute with no preset or an unknown one, as on the server', () => {
    expect(mainAttributeOf(catalog, sheet(null))).toBe('might');
    expect(mainAttributeOf(catalog, sheet('constructor'))).toBe('might');
  });
});

describe('attributeButtons', () => {
  it('gives the main attribute no buttons', () => {
    const b = attributeButtons('wits', 'wits', { ...zero, wits: 3 });
    expect(b).toEqual({ isMain: true, canMinus: false, canPlus: false });
  });

  it('enables minus only when that attribute has level points', () => {
    expect(attributeButtons('vigor', 'wits', { ...zero, vigor: 1 }).canMinus).toBe(true);
    expect(attributeButtons('vigor', 'wits', { ...zero, wits: 2 }).canMinus).toBe(false);
  });

  it('enables plus only when the main attribute has level points', () => {
    expect(attributeButtons('vigor', 'wits', { ...zero, wits: 2 }).canPlus).toBe(true);
    expect(attributeButtons('vigor', 'wits', { ...zero, vigor: 1 }).canPlus).toBe(false);
  });
});

describe('movePointMessage', () => {
  it('minus moves a point from the attribute to the main one', () => {
    expect(movePointMessage('minus', 'vigor', 'wits')).toEqual({ type: 'debug-move-point', from: 'vigor', to: 'wits' });
  });

  it('plus moves a point from the main attribute to the attribute', () => {
    expect(movePointMessage('plus', 'vigor', 'wits')).toEqual({ type: 'debug-move-point', from: 'wits', to: 'vigor' });
  });
});
