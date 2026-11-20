/**
 * Fighting: planning paths for attack orders, attack-moves and enemy chases, enemy windups, basic
 * attacks, deaths, respawns and the training dummy's heal (the spec's "One tick", steps 2, 7, 9, 10
 * and 11). This is the engine side of the enemy AI: who an enemy chases comes from
 * `chooseEnemyOrders` (`enemy-ai.ts`), and this file only carries those orders out. Pure: randomness
 * only from `WorldState.rng`. Reachable from the client, so it imports only Zod-free modules (types
 * are erased).
 */
import { sameTile, withBlockers } from './grid';
import type { Grid, Tile } from './grid';
import { findRoute, nearness } from './route';
import { inReach } from './reach';
import { rollSpread } from './rng';
import { computeDamage } from './damage';
import { attributesOf, maxHealthOf } from './character';
import type { PlayerSheet } from './character';
import { lookup } from './content/bundle';
import type { ContentBundle } from './content/bundle';
import type { ItemContent } from './content/schemas';
import { findSpawnTile, isDown, nearestFreeTile } from './waves';
import type { EnemyOrder } from './enemy-ai';
import type { Character, CharacterId, Enemy, EnemyId, Hit, Order, Recap, WorldState } from './world';

/** How many of the hits a player last took the death recap lists (builder's call 12). */
export const RECAP_HITS = 5;

/**
 * How far an enemy's attacks reach, in tiles. Enemy attacks have no range in the content yet: in
 * 2.1 every one (the slime's touch) is melee, so reach is `canStrike`'s.
 */
export const ENEMY_REACH_TILES = 1;

/** A weapon as the rules use it: the item (its name and damage) and its weapon stats. */
export interface EquippedWeapon {
  readonly item: ItemContent;
  readonly stats: NonNullable<ItemContent['weapon']>;
}

/** The armor on a sheet (its flat armor and resistances), or null when there is none. */
export function armorOf(sheet: PlayerSheet, content: ContentBundle): NonNullable<ItemContent['armor']> | null {
  const item = sheet.armorId === null ? undefined : lookup(content.items, sheet.armorId);
  return item?.armor ?? null;
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
 * The grid an enemy routes on: the terrain with the other enemies' tiles and the tiles of players
 * who aren't down blocked.
 */
export function enemyBlockers(state: WorldState, enemy: Enemy): Grid {
  const taken = [
    ...state.enemies.filter((e) => e.id !== enemy.id).map((e) => e.tile),
    ...state.characters.filter((c) => !isDown(c)).map((c) => c.tile),
  ];
  return withBlockers(state.grid, taken);
}

/**
 * The route a player's order asks for from `from`, on `blockers`. One rule for planning (step 7)
 * and for `walk`'s re-route around occupants (step 8):
 * - attack: into reach of the target (`routeIntoReach`); nowhere if it is gone or there's no weapon;
 * - attack-move: nowhere while locked on; otherwise toward the destination;
 * - move: toward the destination;
 * - none: toward the end of the path it has, if any (a hand-made path; orders never leave one).
 */
export function playerRoute(state: WorldState, c: Character, blockers: Grid, from: Tile): readonly Tile[] {
  const { order } = c;
  switch (order.kind) {
    case 'attack': {
      const enemy = state.enemies.find((e) => e.id === order.enemyId);
      const weapon = weaponOf(c.sheet, state.content);
      if (!enemy || !weapon) return [];
      return routeIntoReach(blockers, state.grid, from, enemy.tile, weapon.stats.rangeTiles);
    }
    case 'attack-move':
      return order.lockedOn !== null ? [] : findRoute(blockers, from, order.destination).path;
    case 'move':
      return findRoute(blockers, from, order.destination).path;
    case 'none': {
      const end = c.path[c.path.length - 1];
      return end === undefined ? [] : findRoute(blockers, from, end).path;
    }
  }
}

/**
 * Attack-move locking, from where everyone stands now: keep the lock while that enemy is in the
 * world and in reach; otherwise lock onto the nearest enemy in reach (ties go to the lowest id), or
 * onto none.
 */
function lockAttackMove(state: WorldState, c: Character, order: AttackMoveOrder, rangeTiles: number): AttackMoveOrder {
  const inRange = (tile: Tile): boolean => inReach(state.grid, c.tile, tile, rangeTiles);
  const locked = order.lockedOn === null ? undefined : state.enemies.find((e) => e.id === order.lockedOn);
  if (locked && inRange(locked.tile)) return order;
  let nearest: Enemy | undefined;
  for (const e of state.enemies) {
    if (!inRange(e.tile)) continue;
    if (nearest === undefined || nearness(c.tile, e.tile) < nearness(c.tile, nearest.tile)) nearest = e;
  }
  const lockedOn = nearest?.id ?? null;
  return lockedOn === order.lockedOn ? order : { ...order, lockedOn };
}

type AttackMoveOrder = Extract<Order, { kind: 'attack-move' }>;

/**
 * 7. Plan paths, from where everyone stands at the start of the tick.
 *
 * Players who can act (move orders keep the path they were given):
 * - Attack: the order ends (no order, no path) if the enemy is gone or the player has no weapon.
 *   In reach, stand still; otherwise route into reach (`routeIntoReach`).
 * - Attack-move: the order ends if the player has no weapon (builder's call, as for attack).
 *   Otherwise lock (`lockAttackMove`); while locked, stand still; otherwise route toward the
 *   destination. The order ends on arrival with nothing locked.
 *
 * Enemies, carrying out `enemyOrders` (one per enemy, in `state.enemies` order):
 * - winding up: stand still, whatever the order;
 * - chase: stand still while the target is in reach, otherwise route into reach of it;
 * - idle: keep the path it has (builder's call: planning gives an idle enemy nothing new, as it
 *   gives a player with no order nothing). While players are about, an idle enemy's kept path is
 *   normally empty; once every player has left, an enemy finishes the path it was on.
 */
export function planPaths(state: WorldState, enemyOrders: readonly EnemyOrder[]): WorldState {
  const blockers = playerBlockers(state);
  const none: Order = { kind: 'none' };
  const characters = state.characters.map((c): Character => {
    if (!canAct(c)) return c;
    const { order } = c;
    if (order.kind !== 'attack' && order.kind !== 'attack-move') return c;
    const weapon = weaponOf(c.sheet, state.content);
    if (!weapon) return { ...c, order: none, path: [] };
    if (order.kind === 'attack') {
      if (!state.enemies.some((e) => e.id === order.enemyId)) return { ...c, order: none, path: [] };
      return { ...c, path: playerRoute(state, c, blockers, c.tile) };
    }
    const lock = lockAttackMove(state, c, order, weapon.stats.rangeTiles);
    const path = playerRoute(state, { ...c, order: lock }, blockers, c.tile);
    const arrived = path.length === 0 && lock.lockedOn === null;
    return { ...c, order: arrived ? none : lock, path };
  });
  const enemies = state.enemies.map((e, i): Enemy => {
    const order = enemyOrders[i];
    if (e.windup !== null) return e.path.length === 0 ? e : { ...e, path: [] };
    if (order === undefined || order.kind === 'idle') return e;
    const target = state.characters.find((c) => c.id === order.target);
    if (!target) return { ...e, path: [] };
    return { ...e, path: routeIntoReach(enemyBlockers(state, e), state.grid, e.tile, target.tile, ENEMY_REACH_TILES) };
  });
  return { ...state, characters, enemies };
}

/**
 * 9. Combat, with reach checked from where everyone stands after movement: 9.1 enemy windups due
 * now resolve, 9.2 player basic attacks, 9.3 enemy windups start. Every hit rolls exactly one spread
 * from `rng`, in that order. `enemyOrders` are this tick's, one per enemy in `state.enemies` order.
 */
export function resolveCombat(state: WorldState, now: number, enemyOrders: readonly EnemyOrder[]): WorldState {
  return startWindups(playerBasicAttacks(resolveWindups(state, now), now), now, enemyOrders);
}

/**
 * 9.1. Enemy windups due this tick resolve, in enemy id order. Every player standing on a covered
 * tile who isn't down is hit, in player id order (one spread roll each), through their armor; the
 * hit goes into their recent hits with the attack as its telegraph. Then the enemy may attack again
 * from now + cooldown + 1, and the windup clears.
 */
function resolveWindups(state: WorldState, now: number): WorldState {
  let rng = state.rng;
  const hits: Hit[] = [...state.hits];
  let characters = state.characters;
  const enemies = state.enemies.map((enemy): Enemy => {
    const { windup } = enemy;
    if (windup === null || windup.resolvesAt > now) return enemy;
    const content = lookup(state.content.enemies, enemy.contentId);
    const attack = content?.attacks.find((a) => a.id === windup.attackId);
    if (!content || !attack) return { ...enemy, windup: null };
    characters = characters.map((c): Character => {
      if (isDown(c) || !windup.tiles.some((tile) => sameTile(tile, c.tile))) return c;
      const spread = rollSpread(rng);
      rng = spread.state;
      const armor = armorOf(c.sheet, state.content);
      const amount = computeDamage({
        damage: attack.damage,
        attacker: null,
        spreadPercent: spread.percent,
        resistances: armor?.resistances ?? [],
        armor: armor?.armor ?? 0,
      });
      const hit: Hit = {
        tick: now,
        attacker: { side: 'enemy', id: enemy.id },
        target: { side: 'player', id: c.id },
        amount,
        attackerName: content.name,
        attackName: attack.name,
        telegraph: { name: attack.name, windupTicks: attack.windupTicks },
      };
      hits.push(hit);
      return { ...c, health: c.health - amount, recentHits: rememberHit(c.recentHits, hit) };
    });
    return { ...enemy, windup: null, readyTick: now + attack.cooldownTicks + 1 };
  });
  return { ...state, characters, enemies, hits, rng };
}

/**
 * 9.3. Enemy windups start, in enemy id order. An enemy above 0 health that is chasing, has no
 * windup, has `readyTick` <= now and has its target in reach starts its first attack: it covers the
 * tile the target stands on and resolves on now + windup ticks. Rolls nothing. No windup starts on a
 * target who can't act (down, or brought to 0 health earlier this tick; builder's call): otherwise a
 * touch could land on them right after they respawn on the same tile.
 */
function startWindups(state: WorldState, now: number, enemyOrders: readonly EnemyOrder[]): WorldState {
  const enemies = state.enemies.map((enemy, i): Enemy => {
    const order = enemyOrders[i];
    if (order?.kind !== 'chase' || enemy.health <= 0 || enemy.windup !== null || enemy.readyTick > now) return enemy;
    const target = state.characters.find((c) => c.id === order.target);
    const attack = lookup(state.content.enemies, enemy.contentId)?.attacks[0];
    if (!target || !canAct(target) || !attack) return enemy;
    if (!inReach(state.grid, enemy.tile, target.tile, ENEMY_REACH_TILES)) return enemy;
    return { ...enemy, windup: { attackId: attack.id, tiles: [target.tile], resolvesAt: now + attack.windupTicks } };
  });
  return { ...state, enemies };
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
