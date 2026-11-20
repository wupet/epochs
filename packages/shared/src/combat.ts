/**
 * Fighting: planning attack orders, basic attacks, deaths, respawns and the training dummy's heal
 * (the spec's "One tick", steps 2, 7, 9, 10 and 11). Pure: randomness only from `WorldState.rng`.
 * Reachable from the client, so it imports only Zod-free modules (types are erased).
 */
import { withBlockers } from './grid';
import type { Grid, Tile } from './grid';
import { findRoute } from './route';
import { inReach } from './reach';
import { rollSpread } from './rng';
import { computeDamage } from './damage';
import { attributesOf, maxHealthOf } from './character';
import type { PlayerSheet } from './character';
import { lookup } from './content/bundle';
import type { ContentBundle } from './content/bundle';
import type { ItemContent } from './content/schemas';
import { findSpawnTile, isDown, nearestFreeTile } from './waves';
import type { Character, CharacterId, EnemyId, Hit, Recap, WorldState } from './world';

/** How many of the hits a player last took the death recap lists (builder's call 12). */
export const RECAP_HITS = 5;

/** A weapon as the rules use it: the item (its name and damage) and its weapon stats. */
export interface EquippedWeapon {
  readonly item: ItemContent;
  readonly stats: NonNullable<ItemContent['weapon']>;
}

/** The weapon on a sheet, or null when there is none (or the id isn't a weapon in the content). */
export function weaponOf(sheet: PlayerSheet, content: ContentBundle): EquippedWeapon | null {
  const item = sheet.weaponId === null ? undefined : lookup(content.items, sheet.weaponId);
  return item?.weapon ? { item, stats: item.weapon } : null;
}

/**
 * Whether a player may act: not down, and above 0 health. A player brought to 0 or below during a
 * tick doesn't act for the rest of it (builder's call 2), but stays on their tile until step 10.
 */
export function canAct(character: Character): boolean {
  return !isDown(character) && character.health > 0;
}

/** A player's recent hits with one more taken: the newest last, keeping only the last `RECAP_HITS`. */
export function rememberHit(recentHits: readonly Hit[], hit: Hit): readonly Hit[] {
  return [...recentHits, hit].slice(-RECAP_HITS);
}

/** The enemy a player's order aims at this tick: the attack target, or the attack-move lock. */
export function targetOf(character: Character): EnemyId | null {
  if (character.order.kind === 'attack') return character.order.enemyId;
  if (character.order.kind === 'attack-move') return character.order.lockedOn;
  return null;
}

/**
 * A path that brings an attacker into reach of a target (builder's call: how "route toward it"
 * reads). The goal is the nearest tile, in steps on `blockers`, from which `inReach` holds on the
 * terrain; with none, the route goes toward the target's tile itself (and so to the nearest tile
 * to it that can be reached). Empty when already in reach.
 *
 * Routing to the target's tile alone would stall: the enemy's tile is blocked, so `findRoute` stops
 * on the nearest tile by distance, which can be a diagonal past a pillar's corner (out of melee
 * reach) or a tile with no line of sight.
 */
export function routeIntoReach(blockers: Grid, terrain: Grid, from: Tile, target: Tile, rangeTiles: number): readonly Tile[] {
  const goal = nearestFreeTile(blockers, from, (tile) => !inReach(terrain, tile, target, rangeTiles));
  return findRoute(blockers, from, goal ?? target).path;
}

/** The grid a player routes on: the terrain with every enemy's tile blocked. */
export function playerBlockers(state: WorldState): Grid {
  return withBlockers(state.grid, state.enemies.map((e) => e.tile));
}

/**
 * 7. Plan paths, from where everyone stands at the start of the tick. Players who can't act are
 * skipped. Move orders keep the path they were given.
 *
 * - Attack: the order ends (no order, no path) if the enemy is gone or the player has no weapon.
 *   In reach, stand still; otherwise route into reach (`routeIntoReach`).
 * - Attack-move (Task 4: no locking yet): route toward the destination; the order ends on arrival.
 */
export function planPaths(state: WorldState): WorldState {
  const blockers = playerBlockers(state);
  const characters = state.characters.map((c): Character => {
    if (!canAct(c)) return c;
    const { order } = c;
    if (order.kind === 'attack') {
      const enemy = state.enemies.find((e) => e.id === order.enemyId);
      const weapon = weaponOf(c.sheet, state.content);
      if (!enemy || !weapon) return { ...c, order: { kind: 'none' }, path: [] };
      return { ...c, path: routeIntoReach(blockers, state.grid, c.tile, enemy.tile, weapon.stats.rangeTiles) };
    }
    if (order.kind === 'attack-move') {
      const path = findRoute(blockers, c.tile, order.destination).path;
      return path.length === 0 && order.lockedOn === null ? { ...c, order: { kind: 'none' }, path } : { ...c, path };
    }
    return c;
  });
  return { ...state, characters };
}

/**
 * 9. Combat, with reach checked from where everyone stands after movement. Every hit rolls exactly
 * one spread from `rng`, in phase order. Task 4 has phase 9.2; Task 5 adds 9.1 and 9.3.
 */
export function resolveCombat(state: WorldState, now: number): WorldState {
  return playerBasicAttacks(state, now);
}

/**
 * 9.2. Player basic attacks, in player id order. A player who can act, whose target (attack or
 * locked) is in the world and in reach, and whose `nextAttackTick` <= now, hits it with the weapon's
 * damage; then `nextAttackTick` = now + interval. An enemy at 0 health or below can still be hit.
 * A hit above 0 sets the enemy's `lastDamagedBy` and `lastHitTick`.
 */
function playerBasicAttacks(state: WorldState, now: number): WorldState {
  const { content } = state;
  let rng = state.rng;
  const enemies = [...state.enemies];
  const hits: Hit[] = [...state.hits];
  const characters = [...state.characters];
  characters.forEach((c, i) => {
    const targetId = targetOf(c);
    if (!canAct(c) || targetId === null || c.nextAttackTick > now) return;
    const index = enemies.findIndex((e) => e.id === targetId);
    const weapon = weaponOf(c.sheet, content);
    if (index === -1 || !weapon) return;
    const enemy = enemies[index]!;
    if (!inReach(state.grid, c.tile, enemy.tile, weapon.stats.rangeTiles)) return;

    const spread = rollSpread(rng);
    rng = spread.state;
    const amount = computeDamage({
      damage: weapon.item.damageSplit,
      attacker: { attributes: attributesOf(c.sheet, content), level: c.sheet.level },
      spreadPercent: spread.percent,
      resistances: lookup(content.enemies, enemy.contentId)?.resistances ?? [],
      armor: 0,
    });
    enemies[index] = {
      ...enemy,
      health: enemy.health - amount,
      ...(amount > 0 ? { lastDamagedBy: c.id, lastHitTick: now } : {}),
    };
    hits.push({
      tick: now,
      attacker: { side: 'player', id: c.id },
      target: { side: 'enemy', id: enemy.id },
      amount,
      attackerName: `Player ${c.id}`,
      attackName: weapon.item.name,
      telegraph: null,
    });
    characters[i] = { ...c, nextAttackTick: now + weapon.stats.attackIntervalTicks };
  });
  return { ...state, characters, enemies, hits, rng };
}

/**
 * 10. Deaths. An enemy at 0 health or below is removed. A player at 0 health or below who isn't
 * already down goes down: a recap of their recent hits, health 0, no order, no path, and
 * `respawnTick` = now + 1. Every enemy that had them as `lastDamagedBy` forgets them.
 */
export function resolveDeaths(state: WorldState, now: number): WorldState {
  const downed: CharacterId[] = [...state.downed];
  const recaps: Recap[] = [...state.recaps];
  const characters = state.characters.map((c): Character => {
    if (isDown(c) || c.health > 0) return c;
    downed.push(c.id);
    recaps.push({ characterId: c.id, tick: now, hits: c.recentHits });
    return { ...c, health: 0, order: { kind: 'none' }, path: [], respawnTick: now + 1 };
  });
  const fallen = new Set(downed);
  const enemies = state.enemies
    .filter((e) => e.health > 0)
    .map((e) => (e.lastDamagedBy !== null && fallen.has(e.lastDamagedBy) ? { ...e, lastDamagedBy: null } : e));
  return { ...state, characters, enemies, downed, recaps };
}

/**
 * The respawn part of step 2. In id order, every down player whose `respawnTick` <= now stands up
 * on the nearest free tile to the spawn (`findSpawnTile`, so each sees the ones before as taken),
 * with full health, no order, no path and no recent hits.
 */
export function respawnDowned(state: WorldState, now: number): WorldState {
  let next = state;
  for (const c of state.characters) {
    if (c.respawnTick === null || c.respawnTick > now) continue;
    const back: Character = {
      ...c,
      tile: findSpawnTile(next),
      health: maxHealthOf(c.sheet, next.content),
      order: { kind: 'none' },
      path: [],
      recentHits: [],
      respawnTick: null,
    };
    next = {
      ...next,
      characters: next.characters.map((x) => (x.id === c.id ? back : x)),
      respawned: [...next.respawned, c.id],
    };
  }
  return next;
}

/**
 * 11. An enemy whose content has `healsAfterTicks` (the training dummy) heals to full once
 * now - `lastHitTick` reaches it, and forgets `lastHitTick`.
 */
export function healDummies(state: WorldState, now: number): WorldState {
  const enemies = state.enemies.map((e) => {
    const content = lookup(state.content.enemies, e.contentId);
    const healsAfter = content?.healsAfterTicks;
    if (!content || healsAfter === undefined || e.lastHitTick === null || now - e.lastHitTick < healsAfter) return e;
    return { ...e, health: content.health, lastHitTick: null };
  });
  return { ...state, enemies };
}
