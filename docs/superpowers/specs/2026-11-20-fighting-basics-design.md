# Milestone 2.1: Fighting basics (design)

Approved by Peter on 2026-11-20, with the jerkin at armor 1. The rules come from `docs/phase-2-brief.md`: its milestone 2.1, the "Damage" section, and "Collision and targeting", including "Settled for 2.1" (Peter, 2026-11-19 and 2026-11-20). This document turns them into exact engine behaviour and records the builder's calls. Peter reviews it together with the plan.

**Done when:** you can walk up to a training dummy and a slime, attack them, take damage, die, and read a recap explaining why.

## Builder's calls (to confirm in the report)

1. **Tick order.** Every tick runs the same phases in a fixed order (below). Within each phase, players act in id order, then enemies in id order.
2. **Hits within a tick land one after another,** and deaths are handled once all hits are done. A character at 0 health or below doesn't act for the rest of the tick, but can still be hit.
3. **Down for one tick.** A player who dies on tick T is down until tick T+1, then respawns at the campfire (Peter: "on the next tick").
   - While down they can't act, don't block, can't be targeted and can't be hit.
   - The tick message that reports the killing hit shows them still at the spot where they fell, at 0 health, and their recap arrives with it.
   - The next tick message shows them at the campfire.
4. **Slime cadence.** A touch starts on tick T and resolves on T+1. Ticks T+2 to T+4 are the 3-tick wait, and the next touch can start on T+5.
5. **Weapon cadence.** A swing on tick T allows the next swing on T + interval.
6. **Ranges use the same distance as movement:** a diagonal tile is 1 away (Chebyshev). Melee is range 1. Anything with range above 1 also needs line of sight.
7. **Blocked steps.** When an occupied tile blocks your next step, you re-route around the occupants once. If there's still no legal step, you wait this tick and keep your progress. Squeezing diagonally between two occupied tiles counts as cutting a corner, so it isn't allowed.
8. **Enemies don't block line of sight.** Only blocked tiles do.
9. **Arena data.** The arena, waves, and class presets are content files. The campfire is a blocked tile, and the spawn tile next to it is where players appear and respawn.
10. **Holy maps to Spirit** in the damage bonuses, following the design summary's pairing of attributes and kinds. Holy is out of scope in Phase 2.
11. **Rounding is half up.** All damage maths is in whole numbers. The spread is the generator's 32-bit value mod 21, minus 10; the bias from mod 21 is below one part in 200 million.
12. **The death recap** lists the last 5 hits you took. Each line says who hit you, with what, for how much, and the telegraph you were standing in, if any.
13. **Debug sheet changes heal you to full.** That covers preset, level, point moves, weapon, armor and class rank.
14. **Debug intentions are capped** at 8 per player per tick. Any beyond that are dropped.

## The world state

`WorldState` keeps its Phase 0 fields and gains:

- `enemies`: sorted by id.
- `campfire`: a tile, or null.
- `content`: the loaded content bundle, read-only.
- `rng`: the generator's 32-bit state.
- `nextEnemyId`.
- This tick's events: `hits`, `downed`, `respawned` and `recaps`. Like `stepped`, these are rebuilt every tick.

A **player character** (`Character`) gains:

- `health`;
- `sheet`: preset id, level, the level points placed in each attribute, weapon id, armor id, and class ranks;
- `order`: one of
  - `none`;
  - `move` (a destination);
  - `attack` (an enemy id);
  - `attack-move` (a destination, plus the enemy it's locked onto, or null);
- `nextAttackTick`;
- `recentHits`: the last 5 hits taken, used for the recap;
- `respawnTick`: the tick on which a downed player respawns, or null while alive.

An **enemy** has:

- `id` and `contentId`;
- the walking fields: `tile`, `path`, `speed`, `progress`, `stepped`;
- `health`;
- `lastDamagedBy`: a player id, or null;
- `lastHitTick`;
- `windup`: the attack, the tiles it covers, and the tick it resolves on, or null;
- `readyTick`: the first tick it may start an attack.

**Derived values** (never stored):

- attribute = 1 + the preset's birth points + level points;
- max health = 30 + 5 × (level − 1) + 3 × Vigor.

When the level is raised, the new points go to the preset's main attribute. When it's lowered, points come off the main attribute first, then the other attributes in the order Might, Finesse, Vigor, Wits, Spirit.

## One tick

1. **Sort the intentions** by subtick, then character id, as today.
2. **Joins and leaves.** A joining player gets the arena's starting preset, at level 1 and full health. Then every downed player whose `respawnTick` ≤ now respawns on the nearest free tile to the spawn, with full health, no order and no path. Their recent hits are cleared and `respawnTick` goes back to null.
3. **Debug intentions,** in order:
   - preset, level, move a point, weapon, armor, class rank, and heal all apply to the sender;
   - start a wave, and clear enemies.
   - A debug intention that names an id that doesn't exist, or an item of the wrong kind, does nothing.
4. **Movement modes,** as today.
5. **Orders.** The last order for each player wins: `move`, `attack` or `attack-move`. An attack order is ignored if you have no weapon.
6. **Enemy orders.** These come from `chooseEnemyOrders(state)` in `enemy-ai.ts`, the placeholder AI.
   - It returns `chase(target)` or `idle` for each enemy.
   - An enemy with no attacks or zero speed idles.
   - Otherwise it targets `lastDamagedBy`, if that player is still in the world and not down, or else the nearest player who isn't down (ties go to the lowest id).
7. **Plan paths,** from where everyone stands at the start of this tick.
   - **Attack:** if the enemy is gone, the order ends. If it's in reach, stand still. Otherwise route toward it.
   - **Attack-move:**
     - drop the lock if that enemy is gone or out of reach;
     - with no lock, lock onto the nearest enemy in reach (ties go to the lowest id);
     - while locked, stand still; otherwise route toward the destination;
     - the order ends when you arrive with nothing locked.
   - **Enemy chase:** stand still while winding up or while the target is in reach. Otherwise route toward the target.
   - **Routes and blockers.** Routes use `findRoute` on `withBlockers(grid, tiles)`.
     - For a player, the blocked tiles are the enemies' tiles.
     - For an enemy, they're the other enemies' tiles plus the tiles of players who aren't down.
8. **Movement.**
   - Players move in id order, then enemies in id order. Each mover uses the stepping rule from 0.2.1, checked against blockers that reflect where everyone has already moved this tick.
   - When an occupied tile blocks the next step, re-route once (builder's call 7).
9. **Combat,** with reach checked from where everyone stands after movement:
   1. **Enemy windups due this tick resolve,** in enemy id order. Every player standing on a covered tile who isn't down is hit. Then `readyTick` = now + cooldown + 1, and the windup clears.
   2. **Player basic attacks,** in player id order. A player whose target (attack or locked) is in reach, and whose `nextAttackTick` ≤ now, hits it with the weapon's damage. Then `nextAttackTick` = now + interval. A hit with an amount above 0 sets the enemy's `lastDamagedBy` and `lastHitTick`.
   3. **Enemy windups start,** in enemy id order. An enemy that is chasing, has no windup, has `readyTick` ≤ now, and has its target in reach starts its first attack. The covered tile is the one the target stands on, and the windup resolves on now + windup ticks.
   - Every hit rolls one spread from `rng`, in exactly this order.
10. **Deaths.**
    - An enemy at 0 health or below is removed.
    - A player at 0 health or below goes down:
      - they get a recap event listing their recent hits;
      - their health is set to 0, their order to none and their path to empty;
      - `respawnTick` = now + 1;
      - every enemy that had them as `lastDamagedBy` forgets them.
    - Down players skip planning, movement and attacks until they respawn in step 2.
11. **The training dummy** (an enemy with `healsAfterTicks`) heals to full once now − `lastHitTick` ≥ 20, then clears `lastHitTick`.
12. **The tick counter goes up by 1.**

**Reach:**

- **Melee (range 1):** the target is a neighbouring tile, and for a diagonal, both tiles between are not terrain-blocked. This is `canStep`'s corner rule, using terrain only.
- **Ranged:** Chebyshev distance ≤ range, and line of sight.
- **Line of sight** follows the straight segment between tile centres. Every tile it passes through, including a tile it only touches at a corner, must be unblocked. The two end tiles aren't checked.

**Damage** works exactly as in the brief:

- per kind: amount × (100 + 4 × attribute + 2 × (level − 1)) × (100 + spread) × round(resistance × 10000);
- for an enemy attacker, the bonus factor is 100;
- the sum is reduced by armor, but no further than 10% of it;
- it's rounded half up, with a minimum of 1;
- a target immune to every kind in the hit takes 0;
- a kind the target has no resistance listed for counts as 1.

## Content

New and changed files:

- **Enemies:**
  - `attacks` replaces `damage`: id, name, windup ticks, cooldown ticks, damage.
  - New fields: `speed` (millitiles per tick, 0 to 2000) and optional `healsAfterTicks`.
  - `resistances` may now be 0. Anything outside 0.25 to 3, including 0, still gets a warning.
- **Items:** an optional `weapon` (attack interval ticks, range tiles) and an optional `armor` (armor, resistances).
- **New kinds:**
  - `presets`: name, main attribute, birth points (exactly 4 in total), weapon, armor;
  - `arenas`: rows, campfire, spawn, starting preset;
  - `waves`: name, arena, and enemies with their tiles.

Content files for 2.1:

- the four weapons and the leather jerkin from the brief;
- the slime (12 health, touch with a 1-tick windup and a 3-tick cooldown, Force 3, Precision 0.5, Arcane 1.25, walking speed 500);
- the training dummy (1000 health, speed 0, no attacks, heals after 20 ticks);
- the three presets;
- the 24 × 24 arena;
- the `practice` wave (the dummy and one slime);
- `wave-1` (three slimes).

The server loads and checks `content/` at startup, and refuses to start if there's an error.

## What clients see

- **Characters:**
  - every view adds `health` and `maxHealth`;
  - tick messages add `vitals` (health changes), `downed` (players who died this tick) and `respawned` (draw these at the new tile at once, without a slide).
- **Enemies:**
  - `{ id, x, y, speed, name, family, health, maxHealth }`;
  - tick messages carry them as spawned, moved (with `via`), removed, and vitals.
- **Telegraphs:** the full list of active ones every tick: `{ enemyId, tiles, kind, resolvesAt }`.
- **Hits:** `{ attacker, target, amount }`, where attacker and target are each `{ side, id }`. The client draws numbers only for hits you dealt or took.
- **Welcome:** adds the campfire, the enemies, the telegraphs, and the **debug catalog**: presets, weapons, armors, classes and waves (id and name for each), the top level, and the top class rank.
- **Private, to you only:**
  - `sheet`, after the welcome and whenever your sheet changes;
  - `recap`, when you die: `{ tick, hits: [{ tick, attacker, attack, amount, telegraph }] }`.
- **Never sent:** resistances, `lastDamagedBy`, orders, `recentHits` (except in your own recap), `rng`, paths and progress.

Debug messages are marked as debug in the code and the docs. Their message types start with `debug-`.

## The client

- **Click an enemy** to attack it. **Press A, then click** to attack-move; Esc or a right-click cancels.
- **The hover preview** routes around enemies, exactly as the server does.
- **Drawing:**
  - enemies, coloured by family;
  - health bars;
  - the campfire;
  - telegraph tiles, filled and outlined in the damage kind's colour (the progressive fill comes in 2.2);
  - floating damage numbers.
- **The debug panel** (plain HTML) lets you:
  - pick a preset;
  - set the level (1 to 10);
  - move attribute points with +/−;
  - pick a weapon and armor;
  - set class ranks (1 to 3);
  - heal to full;
  - start the practice setup or wave 1;
  - clear enemies.
- **The recap** is an HTML overlay that stays until you close it (a button or Esc).
- **Keyboard shortcuts** ignore key presses while a form control has focus.
