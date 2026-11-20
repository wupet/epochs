/**
 * What combat looks like: colours, sizes and the arithmetic behind them. Pure (no Pixi), so it can
 * be tested; `combat-draw.ts` does the drawing with these.
 */
import type { DamageKind } from '@epochs/shared';
import { FLOAT_MS } from './floating-numbers';

export const COLOR_SLIME = 0x6fcf6f;
export const COLOR_CONSTRUCT = 0xa08060;
export const COLOR_ENEMY_OTHER = 0xd05050;
export const COLOR_CAMPFIRE = 0xe08a2e;

/** The fraction of a tile a square is inset on each side. */
export const SQUARE_INSET = 0.15;

/** An enemy's colour by family: slime, construct, anything else. */
export function enemyColor(family: string): number {
  if (family === 'slime') return COLOR_SLIME;
  if (family === 'construct') return COLOR_CONSTRUCT;
  return COLOR_ENEMY_OTHER;
}

const TELEGRAPH_COLORS: Readonly<Record<DamageKind, number>> = {
  force: 0xe07a3a,
  precision: 0xe0d24a,
  arcane: 0xa070ff,
  holy: 0xf5f5dc,
};

/** A telegraph's colour by damage kind. An unknown kind (never sent by this server) draws white. */
export function telegraphColor(kind: string): number {
  return Object.hasOwn(TELEGRAPH_COLORS, kind) ? TELEGRAPH_COLORS[kind as DamageKind] : 0xffffff;
}

export const TELEGRAPH_FILL_ALPHA = 0.25;
export const TELEGRAPH_OUTLINE_PX = 2;

export const HEALTH_BAR_PX = 3;
export const COLOR_HEALTH = 0x5ec45e;
export const COLOR_HEALTH_LOST = 0x5a1e1e;

/** Enemies always show a health bar; players only once hurt. */
export function showsHealthBar(isEnemy: boolean, health: number, maxHealth: number): boolean {
  return maxHealth > 0 && (isEnemy || health < maxHealth);
}

/** Health as a fraction of the maximum, kept between 0 and 1. */
export function healthFraction(health: number, maxHealth: number): number {
  return maxHealth <= 0 ? 0 : Math.min(1, Math.max(0, health / maxHealth));
}

export const COLOR_DEALT = 0xffffff;
export const COLOR_TAKEN = 0xff6b6b;

/** How far a floating number rises over its life, in tiles. */
export const FLOAT_RISE_TILES = 0.6;

/** How far a floating number of this age (ms) has risen, in tiles. */
export function floatRise(ageMs: number): number {
  return FLOAT_RISE_TILES * Math.min(1, Math.max(0, ageMs / FLOAT_MS));
}
