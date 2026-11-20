/**
 * A player sheet and the numbers derived from it. Pure, and reachable from the client: it imports
 * only Zod-free modules. Setters return the new sheet, or the same sheet when the request is
 * invalid (so callers can tell that nothing changed with `===`).
 */
import { lookup } from './content/bundle';
import type { ContentBundle } from './content/bundle';
import { ATTRIBUTES } from './content/vocabulary';
import type { Attribute } from './content/vocabulary';

export const BASE_HEALTH = 30;
export const HEALTH_PER_LEVEL = 5;
export const HEALTH_PER_VIGOR = 3;
export const BASE_ATTRIBUTE = 1;
export const MAX_LEVEL = 10;
export const MAX_CLASS_RANK = 3;

export type Attributes = Readonly<Record<Attribute, number>>;

/** What a player is, apart from where they stand. Attributes and max health are derived, never stored. */
export interface PlayerSheet {
  readonly presetId: string | null;
  readonly level: number;
  /** The points placed from levelling: always `level - 1` in total. */
  readonly levelPoints: Attributes;
  readonly weaponId: string | null;
  readonly armorId: string | null;
  readonly classRanks: Readonly<Record<string, number>>;
}

function pointsOn(attribute: Attribute, amount: number): Attributes {
  return { might: 0, finesse: 0, vigor: 0, wits: 0, spirit: 0, [attribute]: amount };
}

/**
 * Where new level points go: the preset main attribute. A sheet with no preset has none, so the
 * first attribute stands in (builder call; the debug sheets always start from a preset).
 */
function mainAttributeOf(sheet: PlayerSheet, content: ContentBundle): Attribute {
  const preset = sheet.presetId === null ? undefined : lookup(content.presets, sheet.presetId);
  return preset ? preset.mainAttribute : ATTRIBUTES[0];
}

/** A fresh level-1 sheet with the preset gear and rank 1 in every content class. An unknown preset id counts as none. */
export function newSheet(content: ContentBundle, presetId: string | null): PlayerSheet {
  const preset = presetId === null ? undefined : lookup(content.presets, presetId);
  return {
    presetId: preset ? preset.id : null,
    level: 1,
    levelPoints: pointsOn(ATTRIBUTES[0], 0),
    weaponId: preset ? preset.weapon : null,
    armorId: preset ? preset.armor : null,
    classRanks: Object.fromEntries(Object.keys(content.classes).map((id) => [id, 1])),
  };
}

/** Each attribute: 1, plus the preset birth points, plus the points placed from levelling. */
export function attributesOf(sheet: PlayerSheet, content: ContentBundle): Attributes {
  const preset = sheet.presetId === null ? undefined : lookup(content.presets, sheet.presetId);
  const birth = (attribute: Attribute): number =>
    (preset?.birthPoints ?? []).reduce((sum, b) => sum + (b.attribute === attribute ? b.points : 0), 0);
  const total = (attribute: Attribute): number => BASE_ATTRIBUTE + birth(attribute) + sheet.levelPoints[attribute];
  return {
    might: total('might'),
    finesse: total('finesse'),
    vigor: total('vigor'),
    wits: total('wits'),
    spirit: total('spirit'),
  };
}

/** 30, plus 5 per level after the first, plus 3 per point of Vigor. */
export function maxHealthOf(sheet: PlayerSheet, content: ContentBundle): number {
  return BASE_HEALTH + HEALTH_PER_LEVEL * (sheet.level - 1) + HEALTH_PER_VIGOR * attributesOf(sheet, content).vigor;
}

/**
 * Switches to a preset: its gear, and the level points placed on its main attribute (points placed
 * before are not carried over). Level and class ranks stay. Unknown id: no change.
 */
export function applyPreset(sheet: PlayerSheet, content: ContentBundle, presetId: string): PlayerSheet {
  const preset = lookup(content.presets, presetId);
  if (!preset) return sheet;
  return {
    ...sheet,
    presetId: preset.id,
    levelPoints: pointsOn(preset.mainAttribute, sheet.level - 1),
    weaponId: preset.weapon,
    armorId: preset.armor,
  };
}

/**
 * Sets the level (a whole number, 1 to 10). Raising it puts the new points on the main attribute;
 * lowering it takes points off the main attribute first, then the others in attribute order.
 */
export function setLevel(sheet: PlayerSheet, content: ContentBundle, level: number): PlayerSheet {
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL || level === sheet.level) return sheet;
  const main = mainAttributeOf(sheet, content);
  const points: Record<Attribute, number> = { ...sheet.levelPoints };
  if (level > sheet.level) {
    points[main] += level - sheet.level;
  } else {
    let toRemove = sheet.level - level;
    for (const attribute of [main, ...ATTRIBUTES]) {
      const taken = Math.min(points[attribute], toRemove);
      points[attribute] -= taken;
      toRemove -= taken;
    }
  }
  return { ...sheet, level, levelPoints: points };
}

/** Moves one level point from one attribute to another. Nothing to move, or the same attribute: no change. */
export function movePoint(sheet: PlayerSheet, from: Attribute, to: Attribute): PlayerSheet {
  if (!ATTRIBUTES.includes(from) || !ATTRIBUTES.includes(to) || from === to) return sheet;
  if (sheet.levelPoints[from] < 1) return sheet;
  return {
    ...sheet,
    levelPoints: { ...sheet.levelPoints, [from]: sheet.levelPoints[from] - 1, [to]: sheet.levelPoints[to] + 1 },
  };
}

/** Equips a weapon (an item with weapon stats), or nothing for `null`. Anything else: no change. */
export function setWeapon(sheet: PlayerSheet, content: ContentBundle, itemId: string | null): PlayerSheet {
  if (itemId !== null && !lookup(content.items, itemId)?.weapon) return sheet;
  return { ...sheet, weaponId: itemId };
}

/** Equips armor (an item with armor stats), or nothing for `null`. Anything else: no change. */
export function setArmor(sheet: PlayerSheet, content: ContentBundle, itemId: string | null): PlayerSheet {
  if (itemId !== null && !lookup(content.items, itemId)?.armor) return sheet;
  return { ...sheet, armorId: itemId };
}

/** Sets the rank (a whole number, 1 to 3) of a class that exists in the content. Anything else: no change. */
export function setClassRank(sheet: PlayerSheet, content: ContentBundle, classId: string, rank: number): PlayerSheet {
  if (!lookup(content.classes, classId)) return sheet;
  if (!Number.isInteger(rank) || rank < 1 || rank > MAX_CLASS_RANK) return sheet;
  return { ...sheet, classRanks: { ...sheet.classRanks, [classId]: rank } };
}
