# Milestone 2.1: Fighting Basics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a player can walk up to a training dummy and a slime in a 24 × 24 arena, attack them (click, or A then click), take damage, die, respawn at the campfire, and read a death recap. A debug panel sets the preset, level, points, gear and class ranks, and starts waves.

**Architecture:**

- **All rules are pure functions in `packages/shared`.** `step` runs a fixed sequence of phases each tick: lifecycle, debug, modes, orders, enemy AI, path planning, movement, combat, deaths, dummy healing.
- **The enemy AI is one placeholder file,** `enemy-ai.ts`. It returns orders that the engine then carries out.
- **Content (presets, the arena and waves too) is checked by Zod.** The server loads it at startup into a plain `ContentBundle` stored in the world state.
- **The client stays free of Zod** and gets names from server messages.

**Tech Stack:** TypeScript 7 (strict), npm workspaces, Vitest 5, Zod 4.6.7 (in `@epochs/shared`, server and tools only), ws 8.23, PixiJS 8, Node 22.

**Spec:** `docs/superpowers/specs/2026-11-20-fighting-basics-design.md`, with the rules in `docs/phase-2-brief.md` (milestone 2.1, "Damage", "Collision and targeting", "Settled for 2.1"). Read both before starting; they are binding.

## Global Constraints

- **`packages/shared` is pure.** No `Math.random`, `Date.now`, `new Date`, `Date()`, I/O, or Node or DOM types; a guard test enforces this. Randomness comes only from `WorldState.rng` through `rng.ts`.
- **Same seed and same intentions give the same world.** `determinism.test.ts` must cover combat.
- **The server decides.** Clients send only intentions: `move`, `mode`, `attack`, `attack-move`, `debug-*`. Every id a client sends is checked against content with `Object.hasOwn`, never with `in` or plain indexing (`"constructor"` passes `ID_PATTERN`).
- **Hidden fields never leave the server:** resistances, `lastDamagedBy`, `lastHitTick`, `order`, `recentHits` (except in the owner's recap), `rng`, `path`, `progress`, `stepped`, `readyTick`, `nextAttackTick`, other players' sheets.
- **Numbers live in content or named constants,** never inline in logic. Constants (in `character.ts` and `damage.ts`):
  - `BASE_HEALTH = 30`, `HEALTH_PER_LEVEL = 5`, `HEALTH_PER_VIGOR = 3`;
  - `BASE_ATTRIBUTE = 1`, `BIRTH_POINTS = 4`, `MAX_LEVEL = 10`, `MAX_CLASS_RANK = 3`;
  - `ATTRIBUTE_BONUS_PERCENT = 4`, `LEVEL_BONUS_PERCENT = 2`, `SPREAD_PERCENT = 10`, `ARMOR_FLOOR_PERCENT = 10`;
  - `RECAP_HITS = 5`, `MAX_DEBUG_INTENTIONS_PER_TICK = 8`.
- **Zod stays out of the client bundle.**
  - Modules the client can reach (`grid`, `route`, `movement`, `time`, `protocol`, `world` and everything they import) may import from `content/schemas.ts`, `content/check.ts` or `content/load.ts` with `import type` only.
  - Shared constants such as `ATTRIBUTES` and `ID_PATTERN` move to the Zod-free `content/vocabulary.ts`.
- **Debug code is marked as debug** in comments, message type names (`debug-…`) and docs. Speed keys 1, 2 and 3 stay as they are until 2.2.
- **Code style:**
  - Imports inside a package use extensionless relative paths.
  - Packages import each other as `@epochs/shared` and `@epochs/tools/...`.
  - Tests sit next to their sources as `*.test.ts`.
- **Running tests:** `npx vitest run --project <shared|server|client|tools>` while working. Before each commit, `npm test`, `npm run typecheck` and `npm run check-content` must all pass.
- **Git:** all work is on branch `milestone-2.1`. Implementers commit; the controller pushes.

## Review Focus

1. **A chase target that dies or is cleared mid-chase.** This covers an enemy killed by another player, and an enemy removed by a wave start. The attacker's order ends cleanly: no hit lands on a removed enemy and nothing throws. Pinned in Task 4.
2. **Hostile ids in debug messages,** such as `debug-start-wave` with `"constructor"`, or `debug-weapon` given the jerkin's id. The tick goes on and the intention does nothing. Pinned in Tasks 3 and 5.
3. **Starting a wave while players stand on its spawn tiles.** Each enemy appears on the nearest free tile and never shares a tile with anyone. Pinned in Task 3.
4. **Dying while a slime's windup is aimed at you.** You respawn at once, and the windup still resolves on the old tile without hitting the respawned you. Pinned in Task 4.
5. **Crowding.** Over a long scripted fight with several slimes and players, an enemy never shares a tile with another enemy or a player. Pinned by an invariant test in Task 4.

---

### Task 1: Content: schemas, checker rules, bundle, files

**Files:**
- Create:
  - `packages/shared/src/content/vocabulary.ts`;
  - `packages/shared/src/content/bundle.ts` (Zod-free);
  - `packages/shared/src/content/load.ts`;
  - `load.test.ts`;
  - `content/items/{cudgel,hunting-bow,witchs-staff,leather-jerkin}.json`;
  - `content/enemies/training-dummy.json`;
  - `content/presets/{militia,hunter,hedge-witch}.json`;
  - `content/arenas/arena.json`;
  - `content/waves/{practice,wave-1}.json`.
- Modify:
  - `packages/shared/src/content/{schemas,check,index}.ts` and their tests;
  - `content/items/rusty-shortsword.json`;
  - `content/enemies/slime.json`;
  - `packages/tools/src/check-content.test.ts` (file counts);
  - `packages/tools/package.json` (add `"exports": { "./content-files": "./src/content-files.ts", "./paths": "./src/paths.ts" }`).

**Interfaces:**
- **Produces in `vocabulary.ts`:** `DAMAGE_KINDS`, `ATTRIBUTES`, `CLASS_TIERS`, `CAPACITY_COSTS`, `TIER_CAPACITY_COST`, `ABILITY_SHAPES`, `ITEM_KINDS`, `ITEM_QUALITIES`, `INTELLIGENCES`, `ID_PATTERN`, plus the types `DamageKind` and `Attribute`. `schemas.ts` re-exports them unchanged.
- **Produces new and changed schema fields** (strict objects, camelCase):
  - **enemy:**
    - `speed` is an int from 0 to 2000;
    - `attacks` is an array of `{ id, name, windupTicks: int ≥ 1, cooldownTicks: int ≥ 0, damage: damageAmount[] (min 1) }`;
    - `healsAfterTicks` is an optional int ≥ 1;
    - `resistances[].multiplier` is a number ≥ 0;
    - `damage` is removed.
  - **item:**
    - `weapon` is optional: `{ attackIntervalTicks: int ≥ 1, rangeTiles: int ≥ 1 }`;
    - `armor` is optional: `{ armor: int ≥ 0, resistances: [{ kind, multiplier ≥ 0 }] }`.
  - **`presets`:** `{ id, name, mainAttribute, birthPoints: [{ attribute, points: int ≥ 1 }], weapon: id | null, armor: id | null }`.
  - **`arenas`:** `{ id, name, rows: string[], campfire: {x,y}, spawn: {x,y}, startingPreset: id }`.
  - **`waves`:** `{ id, name, arena: id, enemies: [{ enemy: id, x, y }] (min 1) }`.
- **Produces in `bundle.ts`:**
  - `ContentBundle`: readonly records keyed by id, `{ classes, items, enemies, presets, arenas, waves }`;
  - `EMPTY_CONTENT`;
  - `lookup<T>(record: Readonly<Record<string, T>>, id: string): T | undefined`, which uses `Object.hasOwn`.
- **Produces in `load.ts`:** `buildContentBundle(files: readonly ContentFile[]): { bundle: ContentBundle | null; problems: ContentProblem[] }`. The bundle is null if any problem is an error.

- [ ] **Step 1: Write the failing checker tests** in `check.test.ts`, one per new rule. Each asserts the exact `{ file, field, message }`.
  - Resistance `0` gives one warning `0 is outside the usual range 0.25–3`, and no error (for both enemies and armor).
  - Resistance `-0.5` is an error.
  - Preset birth points totalling 3 or 5: error at `birthPoints`, `must total 4, found 3`.
  - A repeated birth-point attribute is an error.
  - A preset `weapon` naming an item without `weapon`: `"leather-jerkin" is not a weapon`. A preset `armor` naming an item without `armor`: `"…" is not armor`. An unknown id: `no item with id "…"`.
  - An item with `weapon` and an empty `damageSplit`: error at `damageSplit`, `a weapon needs at least 1 damage kind`.
  - Arena:
    - rows of unequal length;
    - a character other than `#` or `.`;
    - a campfire out of bounds or on `#`;
    - a spawn that isn't walkable, or isn't a neighbour of the campfire (Chebyshev 1);
    - an unknown `startingPreset`.
  - Wave:
    - an unknown arena or enemy;
    - a tile out of bounds, on `#`, on the campfire or on the spawn;
    - a repeated tile.
  - An enemy with a repeated attack id, or with repeated damage kinds within an attack.
- [ ] **Step 2: Write the failing `load.test.ts`.**
  - The real repo content (read through `readContentFiles` in the tools test, or inline fixtures) builds a bundle with `bundle.presets.militia.weapon === 'rusty-shortsword'`.
  - Any error makes `bundle` null.
  - `lookup(bundle.waves, 'constructor')` is `undefined`.
- [ ] **Step 3: Run** `npx vitest run --project shared`. Expected: the new tests fail.
- [ ] **Step 4: Implement** the vocabulary split, schema changes, new `CONTENT_KINDS` entries (`presets`, `arenas`, `waves`), the rules above in `rulesWithinFile` and `rulesAcrossFiles`, `bundle.ts`, and `load.ts`. Extend the resistance warning to `items[].armor.resistances`.
- [ ] **Step 5: Write the content files.** Use the values from the brief.
  - **Weapons:** `damageSplit` and `weapon`, with `kind: "plain"`, `quality: "crude"` and `requirements: []`:
    - shortsword: force 4, precision 2; interval 4, range 1;
    - cudgel: force 6; interval 5, range 1;
    - bow: precision 5; interval 5, range 6;
    - staff: arcane 3; interval 5, range 4.
  - **Jerkin:** `damageSplit: []`, `armor: { armor: 2, resistances: [] }`.
  - **Slime:** 12 health, speed 500, attack `touch` "Touch" (windup 1, cooldown 3, force 3), precision 0.5, arcane 1.25, family `slime`, tier 1, mindless.
  - **Dummy:** id `training-dummy`, "Training Dummy", family `construct`, tier 1, 1000 health, speed 0, `attacks: []`, `resistances: []`, mindless, `healsAfterTicks: 20`.
  - **Presets:** each has `armor: "leather-jerkin"`:
    - militia: might 3, vigor 1, main might, shortsword;
    - hunter: finesse 3, vigor 1, main finesse, hunting-bow;
    - hedge-witch: wits 3, vigor 1, main wits, witchs-staff.
  - **Arena** `arena`: these rows, with campfire `{x:12,y:20}`, spawn `{x:12,y:19}` and starting preset `militia`:
    ```
    ########################
    #......................#
    #......................#
    #......................#
    #......................#
    #......................#
    #....##..........##....#
    #....##..........##....#
    #......................#
    #......................#
    #..........##..........#
    #..........##..........#
    #.......#......#.......#
    #........#....#........#
    #......................#
    #....##..........##....#
    #....##..........##....#
    #......................#
    #......................#
    #......................#
    #......................#
    #......................#
    #......................#
    ########################
    ```
  - **Waves:**
    - `practice` "Practice: dummy and slime": the dummy at (8,4) and a slime at (15,4);
    - `wave-1` "Wave 1": slimes at (6,3), (12,3) and (18,3).
- [ ] **Step 6: Run** `npm run check-content`, then `npm test` and `npm run typecheck`. Expected: `All 15 content files are valid.` Update the tools test's expected counts. Everything else passes.
- [ ] **Step 7: Commit** with the message `Content for 2.1: weapons, armor, slime and dummy, presets, arena, waves; resistances may be 0`.

### Task 2: Pure combat rules: generator, damage, sheet, reach

**Files:**
- Create in `packages/shared/src/`, each with a `.test.ts`:
  - `rng.ts`;
  - `damage.ts`;
  - `character.ts`;
  - `reach.ts`.
- Modify `grid.ts` (add `withBlockers`), `grid.test.ts`, and `index.ts`.

**Interfaces:**
- **`rng.ts`:**
  - `nextRandom(state: number): { value: number; state: number }`, using mulberry32 with 32-bit integer maths. `value` is from 0 to 2³²−1.
  - `rollSpread(state: number): { percent: number; state: number }`, where `percent = value % 21 − 10`.
- **`damage.ts`:**
  - `interface DamageInput { damage: readonly { kind: DamageKind; amount: number }[]; attacker: { attributes: Attributes; level: number } | null; spreadPercent: number; resistances: readonly { kind: DamageKind; multiplier: number }[]; armor: number }`
  - `computeDamage(input: DamageInput): number`, using the integer formula from the spec.
  - `ATTRIBUTE_FOR_KIND`: force→might, precision→finesse, arcane→wits, holy→spirit.
- **`character.ts`:**
  - `type Attributes = Readonly<Record<Attribute, number>>`;
  - `interface PlayerSheet { presetId: string | null; level: number; levelPoints: Attributes; weaponId: string | null; armorId: string | null; classRanks: Readonly<Record<string, number>> }`;
  - `newSheet(content, presetId | null): PlayerSheet` (level 1, no points, the preset's gear, rank 1 in every content class);
  - `attributesOf(sheet, content): Attributes`;
  - `maxHealthOf(sheet, content): number`;
  - `applyPreset(sheet, content, presetId)`;
  - `setLevel(sheet, content, level)`;
  - `movePoint(sheet, from, to)`;
  - `setWeapon(sheet, content, itemId | null)`;
  - `setArmor(sheet, content, itemId | null)`;
  - `setClassRank(sheet, content, classId, rank)`.
  - Each setter returns the new sheet, or the same sheet when the request is invalid.
- **`reach.ts`:**
  - `canStrike(grid, from, to): boolean`;
  - `hasLineOfSight(grid, from, to): boolean`;
  - `inReach(grid, from, to, rangeTiles): boolean`, which is `canStrike` when range is 1, and nearness ≤ range plus line of sight otherwise.
- **`grid.ts`:** `withBlockers(grid: Grid, tiles: readonly Tile[]): Grid` returns a new grid with those in-bounds tiles blocked.

- [ ] **Step 1: Write the failing tests.**
  - **`computeDamage`:** each case lists its inputs and the expected result.
    - Shortsword (F4, P2), Might 4, Finesse 1, level 1, against the slime's resistances, no armor:
      - spread 0 → `6`;
      - spread +10 → `6`;
      - spread −10 → `5`.
    - Same weapon and attacker against the dummy (no resistances, no armor), spread 0 → `7`.
    - Bow (P5), Finesse 4, against the slime → `3`. Staff (A3), Wits 4, against the slime → `4`.
    - Shortsword, Might 1, level 10, against no resistances: force 4 × 1.22 = 4.88 plus precision 2 × 1.22 = 2.44, total 7.32 → `7`.
    - The slime's touch (F3, attacker null) against armor 2: spread 0 → `1`, spread +10 → `1`.
    - Floor: attacker null, F5, armor 10 → `1`, because 0.5 rounds half up. F30 against armor 100 → `3`.
    - Half up: F5 against force 0.5 → `3`.
    - Immune: force 0 against an F4 hit → `0`. Force 0 against F4 + P2 → `2`.
  - **`rollSpread`:** for 10 000 rolls from seed 1, every percent is in −10 to +10 and all 21 values occur. The same seed gives the same sequence.
  - **`character`:**
    - The militia preset at level 1 → Might 4, Finesse 1, Vigor 2, max health 36.
    - `setLevel(…, 10)` → Might 13, max health 81.
    - `setLevel` back to 3 → Might 6.
    - `movePoint('might', 'wits')` with no level points in Might is a no-op.
    - `setWeapon` with `'leather-jerkin'` is a no-op.
    - `setLevel(…, 11)` and `setClassRank(…, 'militia', 4)` are no-ops.
    - `setClassRank(…, 'constructor', 2)` is a no-op.
  - **`reach`:** on a grid with a pillar at (2,2):
    - `canStrike` (1,1)→(2,1) is true;
    - a diagonal (1,2)→(2,3) past the pillar's corner is false;
    - line of sight (0,0)→(2,1) on an open grid is true; with (0,1) blocked it's true; with (1,1) blocked it's false;
    - a corner touch: (0,0)→(2,2) with (1,0) blocked is false;
    - `inReach` with range 6 at distance 6 with a clear line is true, at distance 7 it's false, and behind a pillar it's false.
  - **`withBlockers`:** leaves the original grid unchanged, and out-of-bounds tiles are ignored.
- [ ] **Step 2: Run** `npx vitest run --project shared`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Line of sight: walk the segment between tile centres in doubled integer coordinates (a supercover). When the segment passes exactly through a grid corner, both side tiles count as touched.
  - `setLevel` adds points to the main attribute, and removes them from the main attribute first, then in `ATTRIBUTES` order.
- [ ] **Step 4: Run** the tests, `npm run typecheck` and `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Combat rules: seeded spread, the damage formula, character sheets, reach and line of sight`.

### Task 3: World model: characters, enemies, debug intentions, waves, collision

**Files:**
- Create:
  - `packages/shared/src/walking.ts`;
  - `packages/shared/src/waves.ts`;
  - their tests.
- Modify `world.ts`, `world.test.ts` and `determinism.test.ts`; update their literal `Character`s through a helper.

**Interfaces:**
- **Consumes:** Task 1's `ContentBundle` and `lookup`; Task 2's sheet functions and `withBlockers`.
- **Produces in `world.ts`:**
  - `EnemyId = number`;
  - `Ref = { side: 'player' | 'enemy'; id: number }`;
  - `Order`;
  - `Enemy` and `Windup = { attackId: string; tiles: readonly Tile[]; resolvesAt: number }`;
  - `Hit = { tick; attacker: Ref; target: Ref; amount; attackerName; attackName; telegraph: { name: string; windupTicks: number } | null }`;
  - `Recap = { characterId; tick; hits: readonly Hit[] }`;
  - the extended `Character` and `WorldState` (field names exactly as in the spec);
  - `interface WorldSetup { content: ContentBundle; seed: number; campfire: Tile | null; startingPresetId: string | null }`;
  - `createWorld(grid, spawn, setup?: Partial<WorldSetup>)`, whose defaults are `EMPTY_CONTENT`, seed 1, no campfire, no preset;
  - `createArenaWorld(content, arenaId, seed): WorldState`, which blocks the campfire tile and throws on an unknown arena.
- **Produces intention kinds:**
  - `'debug-preset' {presetId}`;
  - `'debug-level' {level}`;
  - `'debug-move-point' {from, to}`;
  - `'debug-weapon' {itemId | null}`;
  - `'debug-armor' {itemId | null}`;
  - `'debug-class-rank' {classId, rank}`;
  - `'debug-heal'`;
  - `'debug-start-wave' {waveId}`;
  - `'debug-clear-enemies'`.
  - Each also carries `characterId` and `subtick`.
- **Produces in `walking.ts`:** `walk<T extends Walker>(mover: T, blockers: Grid, terrain: Grid, reroute: () => readonly Tile[]): T & { stepped }`. It holds the 0.2.1 stepping and resting rules, plus spec call 7.
- **Produces in `waves.ts`:**
  - `startWave(state, waveId): WorldState`;
  - `clearEnemies(state): WorldState`;
  - `nearestFreeTile(grid, from, isTaken): Tile | null`.
  - `findSpawnTile` now also treats enemy tiles as taken.

- [ ] **Step 1: Write the failing tests.**
  - **Joining:** in an arena world, a joining player has the militia sheet, 36 health, and stands on (12,19).
  - **Debug intentions:**
    - `debug-level 5` → Might 8 and full health.
    - `debug-weapon 'hunting-bow'` → `weaponId` is the bow; `'leather-jerkin'` changes nothing.
    - `debug-heal` restores full health.
    - `debug-start-wave 'practice'` → enemies `[{id:1, contentId:'training-dummy', tile:(8,4)}, {id:2, contentId:'slime', tile:(15,4)}]`.
    - A second `start-wave 'wave-1'` → ids 3, 4 and 5, and the old enemies are gone.
    - `'constructor'` and `'nope'` change nothing.
    - `debug-clear-enemies` → no enemies left.
  - **Spawn tiles:** a player standing on (15,4) when the practice wave starts → the slime appears on a free neighbouring tile, never on (15,4).
  - **Collision:**
    - A player ordered to `move` onto the dummy's tile stops next to it.
    - A player walking a corridor whose next tile an enemy steps into re-routes, and never shares a tile with the enemy.
    - Two players can still share a tile.
  - **Determinism:** the existing determinism script still passes unchanged on `createWorld(grid, spawn)`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Add steps 2 to 4 of the spec's tick and movement step 8, with `move` orders only. The existing `move` intention becomes an `Order { kind: 'move' }` whose path comes from `findRoute(withBlockers(grid, enemyTiles), …)`.
  - The new event lists are empty for now.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `World model for combat: sheets, enemies, debug intentions, waves, enemies block movement`.

### Task 4: Orders, the placeholder AI, combat, death and respawn

**Files:**
- Create:
  - `packages/shared/src/enemy-ai.ts`;
  - `packages/shared/src/combat.ts`;
  - `enemy-ai.test.ts`;
  - `combat.test.ts`.
- Modify `world.ts` and `determinism.test.ts`.

**Interfaces:**
- **Consumes:** Tasks 2 and 3.
- **Produces in `enemy-ai.ts`:**
  - `type EnemyOrder = { kind: 'chase'; target: CharacterId } | { kind: 'idle' }`;
  - `chooseEnemyOrders(state: WorldState): readonly EnemyOrder[]`, with one order per enemy, in `state.enemies` order.
  - The file's doc comment says it is the Phase 2 placeholder, to be replaced.
- **Produces in `combat.ts`:**
  - `resolveCombat(state, now): WorldState`: spec step 9;
  - `resolveDeaths(state, now): WorldState`: spec step 10;
  - `healDummies(state, now): WorldState`: spec step 11.
  - All of them fill `hits`, `recaps` and `respawned`.
- **Produces intention kinds:** `'attack' {enemyId}` and `'attack-move' {target: Tile}`.

- [ ] **Step 1: Write the failing tests** (`combat.test.ts`, arena world, seed fixed).
  - **Expected amounts:** assert each hit's amount equals `computeDamage` with `rollSpread(stateBefore.rng).percent`, never a hard-coded spread.
  - **Melee hits:** militia next to the dummy with an `attack` order → hits on ticks t, t+4 and t+8. `hits[0]` is `{attacker:{side:'player',id:1}, target:{side:'enemy',id:1}, …}`.
  - **The interval holds:** the attacker walks away at t+1 and comes back at t+2 → no hit before t+4.
  - **Chasing:** an `attack` order on a slime 5 tiles away → the player walks, and hits on the first tick it's in reach.
  - **Ranged:**
    - Hunter with the bow and an `attack` order from 6 tiles with a clear line → hits without moving.
    - With a pillar between, the player moves until it has a line, then hits.
  - **Corners:** a shortsword diagonal past a pillar's corner → no hit; the player steps to an orthogonal tile first.
  - **Slime touch:**
    - The slime chases the nearest player.
    - The windup starts on tick T with `tiles` = [the player's tile] and `resolvesAt` T+1.
    - A player still there at T+1 takes the hit, and the hit has `telegraph: {name:'Touch', windupTicks:1}`.
    - A player who stepped off at T+1 takes nothing.
    - The next windup starts no earlier than T+5.
  - **Targeting** (`enemy-ai.test.ts`):
    - Players A (near) and B (far) → the slime chases A.
    - After B hits it, it chases B.
    - After B dies, it chases the nearest player again.
    - After B leaves, likewise.
    - The dummy idles.
  - **Death:**
    - A player at 1 health hit by a touch → in the same tick: back on the spawn tile at full health, order `none`;
    - `recaps` has one entry whose last hit is the slime's touch;
    - `respawned` contains the player.
    - Review Focus 4: the slime's next windup, aimed at the old tile, resolves without hitting.
  - **Attack-move:**
    - Walking past the slime → locks onto it while it's in reach, attacks it, and resumes toward the destination once it dies.
    - With the dummy and the slime both in reach → locks onto the nearer one (ties go to the lower id).
  - **Review Focus 1:** two players attack one slime, and it dies to the first hit of the tick → the second hit lands on its body this tick (≤ 0 health), and next tick both orders are `none` with nothing thrown. A wave start during a chase ends the order.
  - **The dummy** never moves. With 900 health at tick h → full again at h+20, not at h+19.
  - **Invariant (Review Focus 5):** 300 ticks of `wave-1` with 3 players attack-moving across the arena, on 3 seeds. After every tick, no enemy shares a tile with an enemy or a player.
  - **Determinism:** extend `determinism.test.ts` with a combat script on `createArenaWorld(content, 'arena', 12345)` covering the practice wave, attacks, attack-move, a death and `wave-1`. Two runs give `JSON.stringify`-equal final states. Seed 54321 gives different `hits` amounts somewhere.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** spec steps 5 to 11 in `step`. Every enemy-AI decision lives in `enemy-ai.ts`; the engine only carries out `EnemyOrder`s.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Combat: attack orders, attack-move, slime touch with telegraphs, placeholder enemy AI, death and respawn`.

### Task 5: Protocol

**Files:** modify `packages/shared/src/protocol.ts` and `protocol.test.ts`.

**Interfaces:**
- **Consumes:** Task 4's state and events.
- **Produces views:**
  - `CharacterView` gains `health` and `maxHealth`;
  - `EnemyView { id, x, y, speed, name, family, health, maxHealth }` and `MovedEnemyView` (with `via`);
  - `VitalsView { id, health, maxHealth }`;
  - `TelegraphView { enemyId, tiles: {x,y}[], kind: DamageKind, resolvesAt: number }`, where `resolvesAt` is the message tick on which it lands: `windup.resolvesAt + 1`;
  - `HitView { attacker: Ref; target: Ref; amount }`.
- **Produces `TickMessage` additions:**
  - `vitals: VitalsView[]` and `respawned: CharacterId[]`;
  - `enemies: { spawned: EnemyView[]; moved: MovedEnemyView[]; removed: EnemyId[]; vitals: VitalsView[] }`;
  - `telegraphs: TelegraphView[]` and `hits: HitView[]`.
  - All lists are sorted by id; hits keep their event order.
- **Produces `WelcomeMessage` additions:**
  - `campfire: {x,y} | null`;
  - `enemies: EnemyView[]`;
  - `telegraphs`;
  - `catalog: DebugCatalog { presets, weapons, armors, classes, waves: {id,name}[]; maxLevel; maxClassRank }`.
- **Produces new server messages:**
  - `SheetMessage { type:'sheet'; presetId; level; attributes; levelPoints; weaponId; armorId; classRanks; maxHealth }`;
  - `RecapMessage { type:'recap'; tick; hits: { tick; attacker: string; attack: string; amount; telegraph: {name; windupTicks} | null }[] }`.
  - Builders: `sheetMessage(state, id)`, `recapMessage(recap)`, `debugCatalog(content)`.
- **Produces new client messages:**
  - `AttackMessage {type:'attack', enemyId}`;
  - `AttackMoveMessage {type:'attack-move', x, y}`;
  - the nine `debug-*` messages, mirroring Task 3's intentions.
  - `parseClientMessage` accepts exact key sets only:
    - ids match `ID_PATTERN` and are at most 64 characters;
    - `level` is an integer from 1 to `MAX_LEVEL`;
    - `rank` is from 1 to `MAX_CLASS_RANK`;
    - attributes come from `ATTRIBUTES`;
    - `enemyId` is a positive integer.

- [ ] **Step 1: Write the failing tests.**
  - The new tick and welcome fields, after a scripted fight.
  - A respawn appears in `respawned` and `moved`.
  - **Hidden information:** `JSON.stringify` of every welcome, tick, sheet and recap message from the Task 4 determinism script contains none of the keys `resistances`, `lastDamagedBy`, `lastHitTick`, `order`, `recentHits`, `rng`, `path`, `progress`, `stepped`, `readyTick`, `nextAttackTick`.
  - **`parseClientMessage`:**
    - accepts each new message;
    - rejects extra keys, `level: 11`, `rank: 0`, `enemyId: 1.5`, `waveId: "Wave 1"`, and a 65-character id.
    - `waveId: "constructor"` parses; the step ignores it, as tested in Task 3.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Protocol for combat: health, enemies, telegraphs, hits, sheet, recap, debug catalog and messages`.

### Task 6: Server: content, arena, seed, combat intentions, private messages

**Files:**
- Create `packages/server/src/load-content.ts` and `load-content.test.ts`.
- Modify:
  - `packages/server/src/main.ts`;
  - `world-server.ts` and `world-server.test.ts`;
  - `packages/server/package.json` (add `"@epochs/tools": "*"`; then run `npm install` to update the lock file).

**Interfaces:**
- **Consumes:** `readContentFiles` from `@epochs/tools/content-files`, `CONTENT_DIR` from `@epochs/tools/paths`, `buildContentBundle`, `formatProblem`, `createArenaWorld`, and the Task 5 builders.
- **Produces:**
  - `loadContent(contentDir: string): ContentBundle`, which throws an `Error` whose message lists every problem line;
  - `WorldServerOptions.world?: WorldState`, the initial world, which overrides `rows` and `spawn`.
- **Startup in `main.ts`:**
  - the seed is `EPOCHS_SEED`, or else `randomInt(2 ** 32)` from `node:crypto`;
  - it logs `[epochs] seed <n>`;
  - it runs `createArenaWorld(loadContent(CONTENT_DIR), 'arena', seed)`;
  - on a content error it prints the problems and exits with code 1.

- [ ] **Step 1: Write the failing tests.**
  - `loadContent` on the repo returns a bundle; on a temp copy with a broken file it throws, naming the file and field.
  - Over a real WebSocket, with a `ManualClock` and an arena world built from the repo content:
    - the welcome carries the catalog and the campfire, and is followed by a `sheet`;
    - `debug-start-wave practice` then `attack 1` → later ticks carry `hits` with the attacker `{side:'player', id: you}`;
    - a sheet change sends a new `sheet` to that client only;
    - a death sends `recap` to that client only;
    - the 9th `debug-*` message in one tick is dropped;
    - the last of `move`, `attack` and `attack-move` in a tick wins.
  - The existing tests still pass with an empty-content world.
- [ ] **Step 2: Run** `npx vitest run --project server`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Replace `latestMoves` with `latestOrders: Map<CharacterId, OrderIntention>`.
  - Add `queuedDebug`, a list in arrival order, capped per character per tick.
  - `takeIntentions` returns lifecycle, then debug, then modes, then orders.
  - After the broadcast tick message, send each connection its `sheet` (only if it changed between `prev` and `state`, compared by JSON) and its `recap`s.
  - `dropIntentions` also clears orders and debug.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Then run `npm run dev` and check that `/health` answers and the log shows the seed.
- [ ] **Step 5: Commit** with the message `Server: load content and the arena at startup, seed, combat and debug intentions, private sheet and recap`.

### Task 7: Client state and connection

**Files:**
- Create `packages/client/src/floating-numbers.ts` and its test.
- Modify `client-world.ts`, `client-world.test.ts` and `connection.ts`.

**Interfaces:**
- **Consumes:** Task 5's messages.
- **`ClientWorld` gains:**
  - `enemyIds()`, `enemyPositionOf(id, now)`, `enemyTileOf(id)`, `enemyAt(tile): EnemyId | undefined`, `enemyInfo(id): { name; family; health; maxHealth }`;
  - `healthOf(id)` and `maxHealthOf(id)` for players;
  - `telegraphs`, `campfire`, `catalog`, `sheet`;
  - `recap` and `dismissRecap()`;
  - `blockerTiles(): Tile[]` (enemy tiles, for the hover preview);
  - `floatingNumbers(now): { x; y; amount; mine: 'dealt' | 'taken'; age }[]`.
  - `applySheet(msg)` and `applyRecap(msg)`.
  - Respawned characters are drawn at their new tile at once, with no slide.
- **`connection.ts` gains:** `sendAttack(enemyId)`, `sendAttackMove(tile)`, `sendDebug(message: DebugClientMessage)`.
- **`floating-numbers.ts`:**
  - `FLOAT_MS = 900`;
  - `addHits(list, hits, you, positions, now)` keeps only hits you dealt or took;
  - `visible(list, now)` drops entries older than `FLOAT_MS`.

- [ ] **Step 1: Write the failing tests.**
  - Welcome and tick application for enemies: spawned, moved with `via`, removed, vitals.
  - A respawn snaps to the new tile.
  - Telegraphs are replaced every tick.
  - Numbers appear only for your hits and expire after 900 ms.
  - `enemyAt` finds the latest server tile.
  - `blockerTiles` lists enemy tiles.
  - Recap is set, then cleared by `dismissRecap`.
- [ ] **Step 2: Run** `npx vitest run --project client`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Client state for combat: enemies, health, telegraphs, damage numbers, sheet and recap`.

### Task 8: Client interface: drawing, attack input, debug panel, recap

**Files:**
- Create `packages/client/src/debug-panel.ts` and `packages/client/src/recap.ts`.
- Modify `render.ts`, `main.ts` and `style.css`.

**Interfaces:** consumes Task 7.

**Fixed values:**
- **Enemy colours by family:** slime `0x6fcf6f`, construct `0xa08060`, anything else `0xd05050`.
- **Campfire:** `0xe08a2e`.
- **Telegraph colour by kind:** force `0xe07a3a`, precision `0xe0d24a`, arcane `0xa070ff`, holy `0xf5f5dc`. Fill alpha 0.25, with a 2 px outline.
- **Health bar:** 3 px tall above each square, green `0x5ec45e` over dark red `0x5a1e1e`, shown on enemies always and on players when hurt.
- **Floating numbers:** white for dealt, `0xff6b6b` for taken. They rise 0.6 tiles over `FLOAT_MS`.
- **Hint:** `HINT = '(debug: 1 walk · 2 run · 3 horse) · A attack-move · +/− zoom · P pulse'`.

- [ ] **Step 1: Wire up input.**
  - A left click on a tile with an enemy → `sendAttack`.
  - **A** arms attack-move, and the status line shows `attack-move: click a tile`. The next left click → `sendAttackMove`, or `sendAttack` if it lands on an enemy. Esc or a right click disarms.
  - Key handlers ignore events whose target is an `input`, `select`, `textarea` or `button`.
  - The hover preview and the click marker use `findRoute(withBlockers(grid, world.blockerTiles()), …)`.
- [ ] **Step 2: Draw** the campfire, enemies, health bars, telegraphs and floating numbers. Reuse Pixi `Text` objects from a pool, not one per frame.
- [ ] **Step 3: Build the debug panel**, a fixed panel on the right, collapsible, titled "Debug". It's built from `catalog` and kept in sync with `sheet`:
  - selects for preset, level, weapon and armor (with a "none" option);
  - each attribute with − / + buttons, which send `debug-move-point` (− moves a point to the main attribute, + moves one from it);
  - a rank select for each class;
  - "Heal";
  - a "Start" button for each wave;
  - "Clear enemies".
- [ ] **Step 4: Build the recap overlay.**
  - Title: "You died". One line per hit, oldest first, for example `Slime — Touch — 3 damage — you were standing in its Touch telegraph (1-tick windup)`. Without a telegraph, end the line at `damage`.
  - A "Close" button; Esc also closes it.
- [ ] **Step 5: Verify.**
  - `npm test` and `npm run typecheck`.
  - `npm run build -w @epochs/client`, then search `packages/client/dist` for `ZodError`. Expected: no match.
  - `npm run dev`. Check every item on the brief's Done-when list by hand in a browser: walk to the dummy and slime, attack both (click, and A-click), take damage, die, read the recap.
- [ ] **Step 6: Commit** with the message `Client: enemies, telegraphs, health bars, damage numbers, attack and attack-move, debug panel, death recap`.

### Task 9: Report

**Files:** create `docs/reports/2.1-fighting-basics.md`.

- [ ] **Step 1: Write the report,** in the style of `docs/reports/0.3-content-checker.md`. Include:
  - what was built;
  - how to run it;
  - what to check by hand, a numbered walkthrough of the Done-when list using the practice wave;
  - things to know: the builder's calls 1 to 14 from the spec, for Peter to confirm;
  - open design questions, such as campfire healing, how slime damage against the jerkin feels (1 per touch), and what the class ranks will do once 2.2 gives them meaning;
  - the test count.
- [ ] **Step 2: Final verification.** Run `npm test`, `npm run typecheck` and `npm run check-content`, and put the real output figures in the report.
- [ ] **Step 3: Commit** with the message `Milestone 2.1 report`. The controller then pushes `milestone-2.1` and waits for Peter's approval to merge.
