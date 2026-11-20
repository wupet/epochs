import { describe, expect, it } from 'vitest';
import {
  BIRTH_POINTS,
  EMPTY_CONTENT,
  applyPreset,
  attributesOf,
  maxHealthOf,
  movePoint,
  newSheet,
  setArmor,
  setClassRank,
  setLevel,
  setWeapon,
} from './index';
import type { ClassContent, ContentBundle, ItemContent, PresetContent } from './index';

const militia: PresetContent = {
  id: 'militia',
  name: 'Militia',
  mainAttribute: 'might',
  birthPoints: [
    { attribute: 'might', points: 3 },
    { attribute: 'vigor', points: 1 },
  ],
  weapon: 'rusty-shortsword',
  armor: 'leather-jerkin',
};
const witch: PresetContent = {
  id: 'hedge-witch',
  name: 'Hedge Witch',
  mainAttribute: 'wits',
  birthPoints: [
    { attribute: 'wits', points: 3 },
    { attribute: 'vigor', points: 1 },
  ],
  weapon: 'witchs-staff',
  armor: null,
};
const sword: ItemContent = {
  id: 'rusty-shortsword',
  name: 'Rusty Shortsword',
  kind: 'plain',
  quality: 'crude',
  damageSplit: [{ kind: 'force', amount: 4 }],
  requirements: [],
  weapon: { attackIntervalTicks: 4, rangeTiles: 1 },
};
const staff: ItemContent = {
  ...sword,
  id: 'witchs-staff',
  name: 'Staff',
  weapon: { attackIntervalTicks: 5, rangeTiles: 4 },
};
const jerkin: ItemContent = {
  id: 'leather-jerkin',
  name: 'Jerkin',
  kind: 'plain',
  quality: 'crude',
  damageSplit: [],
  requirements: [],
  armor: { armor: 1, resistances: [] },
};
const militiaClass = { id: 'militia', name: 'Militia' } as unknown as ClassContent;

const content: ContentBundle = {
  ...EMPTY_CONTENT,
  classes: { militia: militiaClass },
  items: { 'rusty-shortsword': sword, 'witchs-staff': staff, 'leather-jerkin': jerkin },
  presets: { militia, 'hedge-witch': witch },
};

describe('BIRTH_POINTS', () => {
  it('is 4', () => {
    expect(BIRTH_POINTS).toBe(4);
  });
});

describe('newSheet', () => {
  it('is level 1 with no points, the preset gear and rank 1 in every content class', () => {
    expect(newSheet(content, 'militia')).toEqual({
      presetId: 'militia',
      level: 1,
      levelPoints: { might: 0, finesse: 0, vigor: 0, wits: 0, spirit: 0 },
      weaponId: 'rusty-shortsword',
      armorId: 'leather-jerkin',
      classRanks: { militia: 1 },
    });
  });

  it('with no preset, has no gear and base attributes', () => {
    const sheet = newSheet(content, null);
    expect(sheet.presetId).toBeNull();
    expect(sheet.weaponId).toBeNull();
    expect(attributesOf(sheet, content)).toEqual({ might: 1, finesse: 1, vigor: 1, wits: 1, spirit: 1 });
  });

  it('treats an unknown preset id (such as "constructor") like no preset', () => {
    expect(newSheet(content, 'constructor').presetId).toBeNull();
  });
});

describe('derived values', () => {
  it('militia at level 1: Might 4, Finesse 1, Vigor 2, max health 36', () => {
    const sheet = newSheet(content, 'militia');
    expect(attributesOf(sheet, content)).toEqual({ might: 4, finesse: 1, vigor: 2, wits: 1, spirit: 1 });
    expect(maxHealthOf(sheet, content)).toBe(36);
  });

  it('level 10: Might 13, max health 81; back to level 3: Might 6', () => {
    const ten = setLevel(newSheet(content, 'militia'), content, 10);
    expect(attributesOf(ten, content).might).toBe(13);
    expect(maxHealthOf(ten, content)).toBe(81);
    const three = setLevel(ten, content, 3);
    expect(attributesOf(three, content).might).toBe(6);
  });
});

describe('setLevel', () => {
  it('removes from the main attribute first, then in attribute order', () => {
    let sheet = setLevel(newSheet(content, 'militia'), content, 4); // 3 points, all in might
    sheet = movePoint(sheet, 'might', 'wits');
    sheet = movePoint(sheet, 'might', 'spirit'); // might 1, wits 1, spirit 1
    sheet = setLevel(sheet, content, 3); // one point goes: might's
    expect(sheet.levelPoints).toEqual({ might: 0, finesse: 0, vigor: 0, wits: 1, spirit: 1 });
    sheet = setLevel(sheet, content, 2); // might, finesse and vigor are empty: wits's goes
    expect(sheet.levelPoints).toEqual({ might: 0, finesse: 0, vigor: 0, wits: 0, spirit: 1 });
  });

  it('is a no-op above the maximum, below 1, or for a fraction', () => {
    const sheet = newSheet(content, 'militia');
    expect(setLevel(sheet, content, 11)).toBe(sheet);
    expect(setLevel(sheet, content, 0)).toBe(sheet);
    expect(setLevel(sheet, content, 2.5)).toBe(sheet);
  });

  it('puts new points on the preset main attribute', () => {
    const sheet = setLevel(newSheet(content, 'hedge-witch'), content, 3);
    expect(sheet.levelPoints.wits).toBe(2);
  });
});

describe('movePoint', () => {
  it('is a no-op when the source has no level points', () => {
    const sheet = newSheet(content, 'militia');
    expect(movePoint(sheet, 'might', 'wits')).toBe(sheet);
  });

  it('moves one point between attributes, and is a no-op onto itself or with unknown names', () => {
    const sheet = setLevel(newSheet(content, 'militia'), content, 3);
    const moved = movePoint(sheet, 'might', 'wits');
    expect(moved.levelPoints.might).toBe(1);
    expect(moved.levelPoints.wits).toBe(1);
    expect(movePoint(sheet, 'might', 'might')).toBe(sheet);
    expect(movePoint(sheet, 'might', 'constructor' as never)).toBe(sheet);
  });
});

describe('gear', () => {
  it('setWeapon with a weapon works, with the jerkin or an unknown id is a no-op, null empties', () => {
    const sheet = newSheet(content, 'militia');
    expect(setWeapon(sheet, content, 'witchs-staff').weaponId).toBe('witchs-staff');
    expect(setWeapon(sheet, content, 'leather-jerkin')).toBe(sheet);
    expect(setWeapon(sheet, content, 'constructor')).toBe(sheet);
    expect(setWeapon(sheet, content, null).weaponId).toBeNull();
  });

  it('setArmor with armor works, with a weapon is a no-op, null empties', () => {
    const sheet = newSheet(content, 'hedge-witch');
    expect(setArmor(sheet, content, 'leather-jerkin').armorId).toBe('leather-jerkin');
    expect(setArmor(sheet, content, 'witchs-staff')).toBe(sheet);
    expect(setArmor(newSheet(content, 'militia'), content, null).armorId).toBeNull();
  });
});

describe('setClassRank', () => {
  it('sets ranks 1 to 3 on a content class; everything else is a no-op', () => {
    const sheet = newSheet(content, 'militia');
    expect(setClassRank(sheet, content, 'militia', 3).classRanks).toEqual({ militia: 3 });
    expect(setClassRank(sheet, content, 'militia', 4)).toBe(sheet);
    expect(setClassRank(sheet, content, 'militia', 0)).toBe(sheet);
    expect(setClassRank(sheet, content, 'constructor', 2)).toBe(sheet);
  });
});

describe('applyPreset', () => {
  it('switches preset and gear, and re-places level points on the new main attribute', () => {
    const sheet = setLevel(newSheet(content, 'militia'), content, 4);
    const witchy = applyPreset(sheet, content, 'hedge-witch');
    expect(witchy.presetId).toBe('hedge-witch');
    expect(witchy.level).toBe(4);
    expect(witchy.weaponId).toBe('witchs-staff');
    expect(witchy.armorId).toBeNull();
    expect(witchy.levelPoints).toEqual({ might: 0, finesse: 0, vigor: 0, wits: 3, spirit: 0 });
  });

  it('is a no-op for an unknown id', () => {
    const sheet = newSheet(content, 'militia');
    expect(applyPreset(sheet, content, 'constructor')).toBe(sheet);
    expect(applyPreset(sheet, content, 'nope')).toBe(sheet);
  });
});
