# Milestone 2.1.1: Playtest Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** fix what Peter's 2.1 playtest found.
- Slimes are slower, with a 3-tick telegraph.
- Every enemy attack winds up for at least 2 ticks.
- Enemies are easy to click, with a highlight.
- A closer default zoom.
- Auto-retaliate, on by default.
- A half-speed replay of your last 5 seconds when you die.

**Architecture:**
- **Pacing** is content plus a checker rule.
- **Respawn safety** and **auto-retaliate** are pure rules in `packages/shared`, added as phases of `step`. They come with a protocol field and a server message.
- **Clicking, zoom and the toggle** are client input.
- **The replay** is client-only: a second `ClientWorld` fed from a ring buffer of tick messages on a half-speed virtual clock.

**Tech Stack:** TypeScript 7 (strict), npm workspaces, Vitest 5, Zod (server and tools only), ws, PixiJS 8, Node 22. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-20-playtest-fixes-design.md`, binding, with the rules in `docs/phase-2-brief.md` ("Settled for 2.1.1", "Windups and dodging"). The 2.1 spec and plan (`…/2026-11-20-fighting-basics*`) describe the code this builds on.

## Global Constraints

- **The 2.1 global constraints still hold:**
  - pure, deterministic shared code;
  - same seed, same world;
  - hidden fields never leave the server;
  - `Object.hasOwn` lookups;
  - Zod out of the client;
  - numbers in content or named constants;
  - debug code marked as debug.
- **New named constants:**
  - `MIN_ENEMY_WINDUP_TICKS = 2` (content vocabulary);
  - `CLICK_AREA_TILES = 1.0` and `DEFAULT_TILE_SIZE = 40` (client);
  - `REPLAY_TICKS = 20` and `REPLAY_SPEED = 0.5` (client).
- **Slime content:** `windupTicks` 3, `cooldownTicks` 6, `speed` 334.
- **Auto-retaliate is not debug.** Its message type is `auto-retaliate`, outside the debug cap, and it reaches clients only in the owner's `sheet`.
- **No weakened assertions.** When the new defaults change behaviour, a test that relies on the old behaviour sets its fixture explicitly. For example, it turns auto-retaliate off for idle-under-attack tests, or reads slime timings from content. It never loosens what it asserts.
- **Running tests:** `npx vitest run --project <shared|server|client|tools>` while working. Before each commit, `npm test`, `npm run typecheck` and `npm run check-content` must all pass.
- **Git:** all work is on branch `milestone-2.1.1`. Implementers commit; the controller pushes.

## Review Focus

1. **Dying under a windup** started before your death, then respawning on the telegraphed tile. You must not be hit. Pinned in Task 1 with the exact trace from the spec.
2. **A dodge click next to a slime** must stay a walk unless the pointer is inside that slime's 1-tile click area, centred on where it's drawn. Pinned in Task 3.
3. **Auto-retaliate on a busy player.** A player who is walking, attacking or attack-moving keeps their order. A player with no weapon doesn't retaliate, and nobody retaliates against an enemy that died this tick. Pinned in Task 2.
4. **Dying again during a replay,** or within 5 seconds of joining. The new replay replaces the old one, or plays a shorter window, and nothing throws. Pinned in Task 4.
5. **Replay accuracy.** Replaying the buffer leaves every character and enemy on the same final tiles as the live world. Pinned in Task 4.

---

### Task 1: Pacing, the minimum windup, and respawn safety

**Files:**
- Modify:
  - `content/enemies/slime.json`;
  - `packages/shared/src/content/{vocabulary,schemas,check}.ts` and their tests;
  - `packages/tools/src/check-content.test.ts` (fixtures with `windupTicks: 1`);
  - `packages/shared/src/waves.ts` (`findSpawnTile`, or the respawn's tile choice) or `combat.ts` (`respawnDowned`);
  - the shared combat, enemy-AI, world, determinism and protocol tests that pin slime timings.

**Interfaces:**
- `MIN_ENEMY_WINDUP_TICKS = 2` in `vocabulary.ts`. An enemy attack's `windupTicks` below it is a schema error, with the message `must be at least 2`.
- Respawn: a tile covered by any enemy's active `windup.tiles` counts as taken when choosing a respawn tile. Joins and wave spawns are unchanged.

- [ ] **Step 1: Write the failing tests.**
  - **Checker:** an enemy attack with `windupTicks: 1` gives the error `attacks[0].windupTicks: must be at least 2`; with 2 it is valid.
  - **Slime cadence** (combat.test): read `windupTicks` and `cooldownTicks` from the content.
    - A windup that starts on T resolves on T+3.
    - The next windup starts no earlier than T+3+6+1 = T+10.
  - **Slime speed:** a slime chasing a far player steps every 3 ticks over 30 ticks: 10 steps, with gaps of exactly 3.
  - **Respawn safety** (Review Focus 1, the exact trace):
    1. Slime A starts a touch on the spawn tile while you stand there.
    2. Slime B kills you on the next tick.
    3. You respawn the tick after, on a tile other than the telegraphed one.
    4. A's touch resolves without hitting you.
  - **Migrated timing tests:** the 2.1 slime tests now read their timings from the content. They keep the same T, T+windup, T+windup+cooldown+1 shape.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The constant and the schema change.
  - Slime content: `windupTicks` 3, `cooldownTicks` 6, `speed` 334.
  - The respawn rule.
  - Update the tools fixtures.
  - Scripts whose coverage assertions need a death or a recap (determinism, protocol hidden-keys, invariant) may run longer or start without armor, but must keep asserting the same coverage.
- [ ] **Step 4: Verify.** `npm test`, `npm run typecheck` and `npm run check-content` all pass.
- [ ] **Step 5: Commit** with the message `Pacing: slime touch winds up 3 ticks, 6-tick cooldown, one tile every 3 ticks; enemy windups at least 2 ticks; respawn avoids telegraphed tiles`.

### Task 2: Auto-retaliate (rules, protocol, server)

**Files:**
- Modify:
  - `packages/shared/src/world.ts` (the `Character.autoRetaliate` field, the intention, and the phase call in `step`);
  - `combat.ts` (a new `autoRetaliate(state)`);
  - `protocol.ts` (the client message, and the sheet field);
  - `packages/server/src/world-server.ts`;
  - tests in each package.

**Interfaces:**
- `Character.autoRetaliate: boolean`, true on join, kept through respawn.
- Intention `{ kind: 'set-auto-retaliate'; characterId; on: boolean; subtick }`. The last one per character per tick wins, and it is applied in the same phase as modes.
- `autoRetaliate(state: WorldState): WorldState` runs in `step` right after `resolveDeaths`. It gives a player an order `{ kind: 'attack', enemyId }` when all of these hold:
  - the player can act;
  - their order is `none`;
  - they have a weapon;
  - `autoRetaliate` is true;
  - this tick's `hits` holds a hit on them from an enemy still in `state.enemies`, with an amount above 0.
  - The first such hit, in `hits` order, picks the enemy.
- The client message `{ type: 'auto-retaliate', on: boolean }` uses exact keys, and `on` must be a boolean.
- `SheetMessage` gains `autoRetaliate: boolean`.
- Server: queue the last `auto-retaliate` per character per tick, the way modes are queued. It doesn't count toward the debug cap.

- [ ] **Step 1: Write the failing tests.**
  - **Retaliating:** an idle militia hit by a slime gets `order = attack(slime)` in the state after that tick, and hits it on the first tick in reach after that.
  - **No retaliation** in any of these cases:
    - the setting is off;
    - the player is walking, attacking another enemy, or attack-moving;
    - the player has no weapon;
    - the only enemy that hit them died this tick;
    - the player is down;
    - the hit did 0 damage.
  - **Two slimes hit in the same tick:** the player retaliates against the first in hit order.
  - **The setting survives:** after `set-auto-retaliate false`, it stays false through death and respawn.
  - **Parsing:** `parseClientMessage` accepts `{"type":"auto-retaliate","on":false}`. It rejects `on: "no"`, extra keys, and a missing `on`.
  - **Server:** an `auto-retaliate` message reaches `step`. It doesn't use up debug slots: 8 debug messages plus 1 `auto-retaliate` in a tick are all applied. The owner's next `sheet` shows the new value, and other players get no sheet.
  - **Determinism:** the combat script still gives equal states across two runs. Hidden keys still never appear: `autoRetaliate` is allowed in the owner's sheet only, never in tick or welcome messages.
  - **Existing idle-under-attack tests** (death, recap, invariant, dodge) set `set-auto-retaliate false` in their fixtures where retaliation would change what they test.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** `npm test`, `npm run typecheck` and `npm run check-content` all pass.
- [ ] **Step 5: Commit** with the message `Auto-retaliate: idle players hit by an enemy attack it back; on by default, with a setting`.

### Task 3: Client: clicking enemies, highlight, zoom, the auto-retaliate toggle

**Files:**
- Modify:
  - `packages/client/src/client-world.ts` (replace `enemyUnderPoint` with `enemyAtPoint`);
  - `render.ts`, `layout.ts`, `connection.ts`, `main.ts`, `style.css`, `combat-style.ts`;
  - tests.
- Create `packages/client/src/retaliate-toggle.ts`, plus a test if it has pure logic.

**Interfaces:**
- `ClientWorld.enemyAtPoint(point: Point, nowMs: number): EnemyId | undefined`. It picks the enemy whose click area contains the point, where the area is a square `CLICK_AREA_TILES` wide centred on the drawn centre `(pos.x + 0.5, pos.y + 0.5)`. The nearest centre wins (squared distance), and ties go to the lowest id. There is no tile fallback, because the area already covers the drawn tile.
- Click handling:
  - if `enemyAtPoint` finds an enemy, send `attack`, whether or not A is armed;
  - otherwise a walk, or an attack-move if armed.
- **Hover:** the same `enemyAtPoint` result gets a white 2 px outline around the drawn body (`HIGHLIGHT_COLOR = 0xffffff`), plus the CSS `crosshair` cursor on the canvas. The route preview to an enemy uses `routeIntoReach`, as in 2.1.
- **Zoom:** the initial `zoomTileSize` is `DEFAULT_TILE_SIZE` (40). `0` returns to fit. The layout's view width excludes the debug panel's width, measured from the DOM, so the camera never centres you under the panel.
- `connection.sendAutoRetaliate(on: boolean)`.
- The toggle is an HTML button at the bottom left showing `Auto-retaliate: on (R)` or `off`. **R** toggles it, and key handlers ignore form controls as before. It shows `sheet.autoRetaliate`.
- **Hint line:** `HINT = '(debug: 1 walk · 2 run · 3 horse) · R auto-retaliate · A attack-move · +/− zoom · 0 fit · P pulse'`.

- [ ] **Step 1: Write the failing tests** (client-world.test).
  - A point on the drawn body mid-slide picks the enemy.
  - A point 0.45 tiles from the drawn centre picks it; 0.55 tiles away does not.
  - A point on the neighbouring tile, more than 0.5 from the centre, does not pick it (Review Focus 2).
  - When two enemies' areas overlap, the nearest centre wins, and an exact tie goes to the lower id.
  - A pure `clickAction`-style helper: an enemy picked plus A armed gives `attack`; no enemy plus A armed gives `attack-move`; no enemy and not armed gives `move`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.**
  - `npm test` and `npm run typecheck` pass.
  - Build the client. A search of its output for `ZodError` and `invalid_type` finds nothing.
  - `npm run dev` serves the client and the server. Then stop every process; on Windows, stop the processes listening on ports 8787 and 5173.
- [ ] **Step 5: Commit** with the message `Client: bigger click area with highlight, clicks on enemies always attack, closer default zoom, auto-retaliate toggle`.

### Task 4: Death replay

**Files:**
- Create:
  - `packages/client/src/replay.ts` (the recorder and the half-speed playback, pure);
  - `replay.test.ts`.
- Modify:
  - `client-world.ts` (add `snapshot()`);
  - `recap.ts` (becomes the replay's side panel, with a hit highlight);
  - `render.ts` (draws from a chosen world at a chosen time, and ignores input while a replay is showing);
  - `main.ts`;
  - `style.css`.

**Interfaces:**
- `ClientWorld.snapshot(): WelcomeMessage` builds a welcome from the latest server tiles, health, enemies, telegraphs, campfire, `you`, `tick` and catalog. Applying it to a fresh `ClientWorld` reproduces the same tiles and health.
- `class ReplayRecorder`:
  - `record(before: WelcomeMessage, tick: TickMessage)` keeps the last `REPLAY_TICKS`;
  - `clear()`;
  - `frames(): readonly { before; tick }[]`.
- `class ReplayPlayer`:
  - the constructor takes `(frames, startMs)`;
  - `world(nowMs): ClientWorld` applies the tick messages whose virtual time is due;
  - the virtual time is `(nowMs − startMs) × REPLAY_SPEED`, with tick i due at `i × TICK_MS`;
  - `virtualNow(nowMs)`;
  - `currentTick(nowMs)`;
  - `finished(nowMs)`;
  - `restart(nowMs)`.
- **Recording in `main.ts`:**
  - before applying each tick, record `(world.snapshot(), message)`;
  - on `welcome`, clear the buffer and close any replay;
  - on `recap`, start a `ReplayPlayer` over the frames, ending with the tick whose `downed` includes you.
- **Renderer:** draws from `{ world, nowMs }`, the replay's world and virtual time while a replay is showing, otherwise the live ones. It shows the banner `Replay: your last 5 seconds (half speed)`. Canvas input is ignored during a replay, except Esc.
- **Side panel:** the title "You died" and the recap lines, oldest first. The line whose hit tick equals the replay's current tick gets a `current` class. The buttons are `Watch again` and `Back to the game`, and Esc also goes back. After the last frame the replay holds there until you leave.

- [ ] **Step 1: Write the failing tests** (replay.test, client-world.test).
  - `snapshot()` round trip: the same tiles, health, enemies and telegraphs.
  - The recorder keeps only the last 20, and `clear()` empties it.
  - Playback: at real time t, the virtual time is t × 0.5. Tick i is applied once the virtual time reaches i × 250 ms. `finished` turns true after the last frame. `restart` starts again.
  - **Accuracy (Review Focus 5):** record 20 ticks of a scripted fight, replay to the end, and get the same final tiles and health as the live `ClientWorld`.
  - **Edge cases (Review Focus 4):**
    - With only 7 recorded ticks, the replay plays 7.
    - A second recap during a replay starts a new replay from the current buffer.
    - A welcome clears the buffer.
  - **Recap highlight:** the line for the hit on the current replay tick is marked.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.**
  - `npm test` and `npm run typecheck` pass.
  - The client build has no Zod. Note its compressed size.
  - `npm run dev` serves the client and the server. Then stop every process.
- [ ] **Step 5: Commit** with the message `Death replay: the last 5 seconds at half speed, with the recap beside it`.

### Task 5: Report, and the controller's browser walkthrough

- [ ] **Step 1: Browser walkthrough** (controller).
  - Slime pacing: a 3-tick telegraph you can step out of.
  - Hover highlight and clicks on a moving slime.
  - A dodge click next to a slime is a walk.
  - Auto-retaliate on and off.
  - Default zoom.
  - Die, watch the replay, Watch again, and Esc back.
- [ ] **Step 2: Write `docs/reports/2.1.1-playtest-fixes.md`** in the 2.1 report's style. Cover:
  - what changed;
  - how to run it;
  - what to check by hand;
  - the builder's calls 1 to 6 from the spec;
  - Peter's answers to Q1–Q4;
  - dodging fairness, answered again from the new timings, with the reaction window now about 2.5 ticks;
  - open questions.
- [ ] **Step 3: Verify.** `npm test`, `npm run typecheck` and `npm run check-content` pass. Put the real figures in the report.
- [ ] **Step 4: Commit** with the message `Milestone 2.1.1 report`.
