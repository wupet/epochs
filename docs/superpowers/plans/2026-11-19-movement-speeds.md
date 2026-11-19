# Milestone 0.2.1: Movement Speeds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fractional movement speeds (walk 2, run 4, horse 8 tiles/s; debug keys), straight-line paths, Chebyshev nearest within a search radius, a catch-up cap, a player queue, zoom, and the pulse off by default.

**Architecture:**
- Speed and progress live on each character in `shared` and are advanced inside the pure `step`.
- The protocol carries `speed` and the tiles passed through (`via`). The client times each slide from the speed.
- The server adds a capped catch-up, a join queue, and debug mode messages.
- The client adds zoom with a following camera.

**Tech Stack:** TypeScript 7 (strict), npm workspaces, Vitest 5, Vite 8, PixiJS 8.23, ws 8.23, Node 22.

**Spec:** `docs/superpowers/specs/2026-11-19-movement-speeds-design.md`. Read it first; its "Rules, precisely" section is binding.

## Global Constraints

- `packages/shared` is pure: no `Math.random`, `Date.now`, `new Date`, `Date()`, I/O, Node or DOM (a guard test enforces this).
- Speeds and progress are integer millitiles: `STEP = 1000` is one tile. Walk is 500, run 1000, horse 2000. `MAX_STEPS_PER_TICK = 2`, and speeds must not exceed 2000.
- The speed keys and mode messages are **debug controls**. Every place they appear in code and docs says "debug" (a comment or a label).
- Messages to clients carry characters only as `{ id, x, y, speed }`, plus `via` on `moved` entries. `path` and `progress` never leave the server.
- `TICK_MS` stays 250. Every intention carries `subtick: 0`.
- Character ids are positive integers from a server counter, never reused, and compared numerically.
- Imports inside a package use extensionless relative paths, and packages import each other as `@epochs/shared`.
- Tests sit next to their sources as `*.test.ts`. Use `npx vitest run --project <shared|server|client|tools>`, then `npm test` and `npm run typecheck` before each commit. Both must pass.
- Implementers commit; they do not push.

## Review Focus

1. **Spam-clicking** between two adjacent tiles never beats the walker's pace (spec rule 13). Pinned in Task 2.
2. **Re-routing mid-walk** keeps the built-up progress: a walker who changes course doesn't get an extra step or lose one. Pinned in Task 2.
3. **A rider's two-step tick around a corner** slides through the passed tile, not across the wall corner. Pinned in Tasks 3 and 5.
4. **A queued tab that closes** before admission never gets a character, and the positions of the people behind it go down. Pinned in Task 4.
5. **When zoomed in,** clicks land on the tile under the pointer, not one offset by the camera. Pinned in Task 5.

---

### Task 1: Route finding (Chebyshev nearest, search radius, straight-line paths) and the docs

**Files:**
- Modify: `packages/shared/src/route.ts` and `packages/shared/src/route.test.ts`
- Modify: `docs/phase-0-brief.md`, `docs/design-summary.md`, `docs/technical-plan.md` and `CLAUDE.md` ("Key numbers" only)

**Interfaces:**
- Unchanged: `findRoute(grid, from, to): Route` and `Route`.
- Changed: `nearness(a, b)` now returns Chebyshev distance, `max(|dx|, |dy|)`.
- New export: `NEAREST_SEARCH_RADIUS = 16`.

**Changes:**
- **Destination choice.** Consider only reachable tiles with `nearness(tile, to) <= NEAREST_SEARCH_RADIUS`. Choose the smallest (nearness, steps, y, x). With none in range, the destination is `from`.
- **Path walk.** Replace the preferred-direction walk with the minimum-deviation dynamic programming from the spec:
  - Deviation is `|(p.x−s.x)(e.y−s.y) − (p.y−s.y)(e.x−s.x)|`.
  - `cost[e] = 0`, and `cost[t] = dev(t) + min cost[n]` over successors `n` (`canStep(t, n)` and `toDest[n] = toDest[t] − 1`), processed in increasing `toDest`.
  - Walk from `s`, taking the successor with the least cost. Ties go to the first in `STEP_DIRECTIONS` order.
  - Use integers only.

- [ ] **Step 1: Update the tests first.**
  - Replace the diagonal-first assertions:
    - Open grid, (0,0)→(3,1): path `[(1,0),(2,1),(3,1)]`.
    - Open grid, (0,0)→(6,2): path `[(1,0),(2,1),(3,1),(4,1),(5,2),(6,2)]`.
    - A straight line stays straight: (0,0)→(5,0) is `[(1,0)…(5,0)]`, and (0,0)→(4,4) is the pure diagonal.
  - Replace the tie fixtures (`ROW_WALL = ['.....','.....','.###.','.....','.....']`, `COLUMN_WALL = ['.....','..#..','..#..','..#..']`, target (2,2) blocked in both):
    - `ROW_WALL` from (0,3) gives destination (1,3), because a diagonal tile is nearness 1 and 1 step away.
    - `ROW_WALL` from (0,2) gives (1,1). (1,1) and (1,3) are both 2 steps away (diagonals past the wall end are blocked), so the lower y wins.
    - `COLUMN_WALL` from (2,0) gives (1,1). (1,1) and (3,1) are both 2 steps away, so the lower x wins.
  - Radius: on `['...' + '#'.repeat(37)]` repeated for 3 rows (40×3, open only at x 0–2):
    - From (0,1), clicking (18,1) gives destination (2,1), because (2,1) is nearness 16.
    - Clicking (19,1) gives `{ destination: (0,1), path: [], reachedTarget: false }`.
  - Keep the existing tests: the `canStep` check on every path pair, blocked targets, the closed ring, already-there and determinism. Update their expected values where the new rules change them, and hand-trace each change.
- [ ] **Step 2: Run** `npx vitest run --project shared`. Expect FAIL.
- [ ] **Step 3: Implement** the changes in `route.ts`, and update its doc comments.
- [ ] **Step 4: Run** the shared tests, `npm test` and `npm run typecheck`. Expect PASS. Tests in other packages that relied on the old paths may need their expected values updated; say which in the report.
- [ ] **Step 5: Update the docs.** Write in the docs' existing plain style. Mark each item as one of "*(Peter, 2026-11-19.)*", an approved builder's call, or "debug".
  - **Brief** (0.2 pathfinding bullet, and a new short "Milestone 0.2.1: Movement speeds" section after 0.2): spec decisions 1–13, with the speed keys marked as debug controls.
  - **Design summary, "Movement":** replace "one tile per tick at base speed" with the speed model (walk 2, run 4, horse 8 tiles/s; fractional progress; at most 2 tiles a tick; a tile is about 1 m). Add the nearest, path-shape, search-range, queue and no-free-steps rules.
  - **CLAUDE.md "Key numbers":** "Tick: 250 ms. Walking is 2 tiles/s (one tile every 2 ticks); speeds are fractional and may reach 2 tiles per tick. A tile is about 1 m."
  - **Technical plan** "World size and regions": recompute the world-size note at walking speed. The numbers become 2 tiles/s, and a 30-to-60-minute crossing becomes 3,600 to 7,200 tiles; label this as walking.
- [ ] **Step 6: Commit** `Route finding: Chebyshev nearest within a search radius, straight-line paths; record 0.2.1 decisions`.

---

### Task 2: Movement speed in `step`

**Files:**
- Create: `packages/shared/src/movement.ts` (constants and modes)
- Modify: `packages/shared/src/world.ts`, `world.test.ts`, `determinism.test.ts` and `index.ts`

**Interfaces:**
- Produces (`movement.ts`):
  ```ts
  export const STEP = 1000;                 // millitiles in one tile
  export const MAX_STEPS_PER_TICK = 2;
  export const MAX_SPEED = STEP * MAX_STEPS_PER_TICK;
  /** Debug movement modes, for testing feel. Running and riding get real rules later. */
  export const DEBUG_MOVEMENT_MODES = { walk: 500, run: 1000, horse: 2000 } as const;
  export type DebugMovementMode = keyof typeof DEBUG_MOVEMENT_MODES;
  export const DEFAULT_SPEED = DEBUG_MOVEMENT_MODES.walk;
  export function isDebugMovementMode(value: unknown): value is DebugMovementMode;
  ```
- `Character` gains `readonly speed: number`, `readonly progress: number` and `readonly stepped: readonly Tile[]` (tiles entered this tick, in order).
- `Intention` gains `| { readonly kind: 'mode'; readonly characterId: CharacterId; readonly mode: DebugMovementMode; readonly subtick: number }`.
- `step` order:
  1. Sort.
  2. Joins and leaves. A join gets `speed: DEFAULT_SPEED`, `progress: STEP` and `stepped: []`.
  3. Modes: the last per character sets `speed`.
  4. Moves: the last per character sets `path`.
  5. Movement, exactly as in the spec's "Movement each tick". Reset `stepped` to `[]` at the start of each character's movement.
  6. `tick + 1`.

- [ ] **Step 1: Write the failing tests** in `world.test.ts`. Use an open 12×12 grid with one joined character. "Steps on ticks" means the step numbers, counted from 1 after the move intention, on which the tile changes.
  - **Walk, rested:** a move 4 tiles away steps on ticks 1, 3, 5 and 7.
  - **Run:** after a mode `run` intention in the same tick as the move, it steps on ticks 1, 2, 3 and 4.
  - **Horse:** a move 5 tiles away moves 1, then 2, then 2 tiles. `stepped` lengths are 1, 2, 2, and `stepped` lists the actual tiles in order.
  - **Speed 750:** set it via a test helper that builds the state directly, since there is no mode for 750. Over 8 ticks of a long walk it steps on ticks 1, 3, 4, 5, 7 and 8. That is 6 steps: 1 + floor(7 × 750 / 1000).
  - **Review Focus 1, spam-clicking:**
    - A rested walker alternates move intentions between (5,5) and (6,5) every tick for 40 ticks, starting at (5,5).
    - The count of ticks where the tile changed is at most 21.
    - No two consecutive ticks both change the tile.
  - **Review Focus 2, re-routing:** a walker that stepped on tick 1 and is re-routed on tick 2 does not step on tick 2, and steps on tick 3.
  - **Rest caps progress:** after 10 idle ticks, `progress === STEP`.
  - **Mode change:** it changes `speed` and keeps `progress`. A mode for an unknown id is ignored.
- [ ] **Step 2: Update `determinism.test.ts`.** Add mode intentions (walk, run, horse) into the scripted 60 ticks. Keep the two independent runs equal.
- [ ] **Step 3: Run.** Expect FAIL.
- [ ] **Step 4: Implement** `movement.ts` and the `world.ts` changes, and export `movement.ts` from the index.
- [ ] **Step 5: Run** `npm test` and `npm run typecheck`. Other packages that build `Character` literals may need the new fields. Fix them minimally and say where.
- [ ] **Step 6: Commit** `Fractional movement speed with capped rest progress`.

---

### Task 3: Protocol (speed, `via`, debug mode, queue)

**Files:**
- Modify: `packages/shared/src/protocol.ts` and `protocol.test.ts`

**Interfaces:**
- `CharacterView` is `{ id, x, y, speed }`.
- `MovedView` is `CharacterView & { readonly via: readonly { x: number; y: number }[] }`.
- `TickMessage.moved` is `readonly MovedView[]`.
- New: `QueueMessage { readonly type: 'queue'; readonly position: number }`. `ServerMessage = WelcomeMessage | TickMessage | QueueMessage`. Add `queueMessage(position: number): QueueMessage`.
- New: `ModeMessage { readonly type: 'mode'; readonly mode: DebugMovementMode }` (debug). `ClientMessage = MoveMessage | ModeMessage`.
- `viewOf` copies id, x, y and speed field by field.
- `tickMessage`:
  - `moved` lists characters in both states whose tile changed;
  - `via` is `next.stepped` without its last element, mapped to `{x, y}`.
- `parseClientMessage`:
  - a `move` keeps today's rules;
  - a `mode` must have keys exactly `{type, mode}`, and `isDebugMovementMode(mode)` must hold;
  - otherwise it returns `null`.

- [ ] **Step 1: Write the failing tests.**
  - Views include `speed`.
  - A horse's 2-step tick gives `via` of length 1, equal to the first stepped tile.
  - A 1-step tick gives an empty `via`.
  - Mode messages are accepted for walk, run and horse. They are rejected for `"fly"`, an extra key, or a missing mode.
  - **Hidden information:** the serialized welcome and tick contain no `"path"`, `"progress"` or `"stepped"`.
  - `queueMessage(3)` is `{type:'queue', position:3}`.
- [ ] **Step 2: Run.** Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Server and client code that consumes these types may need small updates to compile. Keep those minimal and note them.
- [ ] **Step 5: Commit** `Protocol: speed and via in views, debug mode message, queue message`.

---

### Task 4: Server (catch-up cap, debug modes, player queue)

**Files:**
- Modify: `packages/server/src/tick-loop.ts` and `tick-loop.test.ts`
- Modify: `packages/server/src/world-server.ts` and `world-server.test.ts`

**Interfaces:**
- `startTickLoop(onTick, clock?, tickMs?, onSkip?: (skipped: number) => void)`. Also export `MAX_CATCH_UP_TICKS = 4`. `TickLoop` gains `ticksSkipped(): number`.
- On wake, if `due − ran > MAX_CATCH_UP_TICKS`, then:
  - `skipped = due − ran − MAX_CATCH_UP_TICKS`;
  - `ran += skipped`;
  - call `onSkip(skipped)`;
  - then run the remaining 4 ticks.
- `WorldServerOptions` gains `maxPlayers?: number` (default `MAX_PLAYERS = 100`, exported from `world-server.ts`).
- The world server logs `console.warn(\`[epochs] stalled: skipped ${n} ticks\`)` from `onSkip`.

**Queue behaviour:**
- A connection is *playing* once it has an id (a join has been queued, whether or not it has been welcomed).
- If the number playing is below `maxPlayers`, a new connection plays at once, as today. Otherwise it is appended to `waiting` and sent `queueMessage(position)`.
- When a playing connection closes (its leave is queued), the first waiting connection is admitted: it gets an id and a queued join, exactly as a new player today. Every remaining waiting connection whose position changed gets a new `queueMessage`.
- A waiting connection that closes is removed, and the ones behind it get their new positions.
- Messages from waiting connections are ignored.

**Debug modes:** a valid `mode` message from a playing connection sets the latest mode for that character this tick, in a `Map` like the latest moves. At tick time it becomes a `mode` intention, placed after joins and leaves and before moves.

- [ ] **Step 1: Write the failing tick-loop tests.**
  - Advancing 10 000 ms in one go runs 4 ticks, skips 36, and calls `onSkip(36)` once.
  - Afterwards, advancing 1000 ms normally runs exactly 4 more ticks: no drift and no second skip.
  - The existing tests still pass. The hour test advances in 1000 ms chunks with 37 ms lateness; check it doesn't trip the cap, since 4 ticks per 1000 ms is the limit, and adjust the chunking if it does.
- [ ] **Step 2: Write the failing world-server tests,** with `maxPlayers: 2` where needed.
  - A third connection gets `{type:'queue', position:1}` and no welcome. A fourth gets position 2.
  - When player A closes, the third connection gets a welcome after the next tick, and the fourth gets `{type:'queue', position:1}`.
  - **Review Focus 4:** the third connection closes while queued, and the fourth moves to position 1. When a slot frees, the fourth is admitted. The closed third never appears in anyone's `joined`.
  - A debug `mode: 'run'` then a move: the character steps every tick (check `moved` on consecutive ticks).
  - `moved` entries carry `speed` and `via`.
- [ ] **Step 3: Run** `npx vitest run --project server`. Expect FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** `npm test` and `npm run typecheck`. Expect PASS.
- [ ] **Step 6: Commit** `Server: catch-up cap, debug movement modes, join queue`.

---

### Task 5: Client logic (speed-timed slides, `via`, queue, zoom and camera maths, pulse off)

**Files:**
- Modify: `packages/client/src/motion.ts`, `client-world.ts` and `pulse.ts`, plus their tests
- Create: `packages/client/src/layout.ts` and `layout.test.ts` (pure zoom, camera and pointer maths, extracted from `render.ts`)

**Interfaces:**
- **`motion.ts`:**
  ```ts
  export function msPerTile(speed: number): number;   // TICK_MS * STEP / speed; speed <= 0 → Infinity is not allowed: treat as TICK_MS * 2 (walk)
  export interface Motion { readonly points: readonly Point[]; readonly startMs: number; readonly msPerSegment: number }
  export function stillAt(tile: Point, nowMs: number): Motion;
  export function positionAt(motion: Motion, nowMs: number): Point;           // piecewise linear through points, clamped to the last
  export function retarget(motion: Motion, through: readonly Point[], nowMs: number, msPerSegment: number): Motion; // points = [positionAt(motion, now), ...through]
  ```
  `TWEEN_MS` is removed; the slide time comes from speed.
- **`ClientWorld`:**
  - It stores each character's `speed`.
  - `applyTick` uses `retarget(…, [...via, {x,y}], now, msPerTile(speed))`.
  - It adds `queuePosition: number | null`, with `applyQueue(msg)` setting it and `applyWelcome` clearing it.
  - It adds `speedOf(id): number | undefined`.
- **`pulse.ts`:** `pulseEnabledFromSearch(search)` is true only for `pulse=1` or `pulse=on`.
- **`layout.ts`:**
  ```ts
  export const ZOOM_TILE_SIZES = [12, 16, 20, 24, 32, 40, 48, 64] as const;
  export function fitTileSize(viewW: number, viewH: number, gridW: number, gridH: number): number; // max(12, floor(min(viewW/gridW, viewH/gridH)))
  export function zoomIn(current: number): number;   // next larger entry of ZOOM_TILE_SIZES (or the same if at the top)
  export function zoomOut(current: number): number;  // next smaller entry (or the same at the bottom)
  export interface Layout { readonly tileSize: number; readonly originX: number; readonly originY: number } // screen px of tile (0,0)'s top-left corner
  export function computeLayout(viewW: number, viewH: number, gridW: number, gridH: number, tileSize: number, focus: Point): Layout;
  export function tileAtScreen(layout: Layout, sx: number, sy: number): Point; // floor((sx − originX)/tileSize), floor((sy − originY)/tileSize)
  ```
  `computeLayout`, per axis:
  - If the map fits, centre it, rounding down: `origin = Math.floor((view − mapPx) / 2)`.
  - Otherwise put the focus tile's centre at the view centre, clamped so the map edge never comes inside the view edge. That is, `origin ∈ [view − mapPx, 0]`.

- [ ] **Step 1: Write the failing tests.**
  - **`msPerTile`:** 500 → 500 ms, 1000 → 250, 2000 → 125.
  - **Walking slide:** a walk-speed `moved` is halfway at 250 ms and on the tile at 500 ms.
  - **Review Focus 3:** a horse `moved` with `via` [(1,0)] from (0,0) to (1,1) is at (1,0) at 125 ms and at (1,1) at 250 ms. It never passes through (0.5, 0.5).
  - **Queue:** `applyQueue` then `applyWelcome` clears `queuePosition`.
  - **Pulse:** `''` → false, `'?pulse=1'` → true, `'?pulse=0'` → false.
  - **Layout:**
    - `fitTileSize(1280, 665, 32, 32)` is 20.
    - At tile size 20 the 32×32 map is centred: origin (320, 12).
    - At tile size 64 on a 1280×665 view, with focus (0,0), the origin is clamped to (0,0); with focus (31,31) it is clamped to (1280 − 2048, 665 − 2048); with focus (16,16) the focus tile's centre lands at the view centre.
    - **Review Focus 5:** `tileAtScreen(layout, …)` of the screen centre of tile (20,14) at tile size 64 with focus (16,16) returns (20,14). That point is on screen, at about (896, 204.5).
    - `zoomIn(20)` is 24, `zoomOut(12)` is 12, and `zoomIn(64)` is 64.
- [ ] **Step 2: Run** `npx vitest run --project client`. Expect FAIL.
- [ ] **Step 3: Implement.** Keep `render.ts` compiling: replace its use of `TWEEN_MS` and its own layout maths with the new functions only as far as needed to compile. The full wiring is Task 6.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expect PASS.
- [ ] **Step 5: Commit** `Client: speed-timed slides through via, queue state, zoom and camera maths, pulse off by default`.

---

### Task 6: Client wiring (debug speed keys, zoom keys, camera, queue display)

**Files:**
- Modify: `packages/client/src/render.ts`, `main.ts` and `connection.ts`

**Behaviour:**
- **Layout:** `render.ts` uses `layout.ts` for everything: drawing, the static grid layer, hover and clicks.
  - The current tile size starts at `fitTileSize(...)` (the "fit" state) and is recomputed on resize while in fit.
  - The focus is your square's drawn position, so the camera follows smoothly.
  - The static grid is redrawn only when the tile size, view size or grid changes. When the camera moves, reposition the grid layer instead of redrawing it.
- **Zoom keys:** `+` and `=` zoom in; `-` and `_` zoom out. Ignore key repeats with modifiers held, as the `P` handler does.
- **Debug speed keys** (comment: `// Debug controls: running and riding get real rules later.`): `1` walk, `2` run, `3` horse. Each sends `{type:'mode', mode}` through `connection.sendMode(mode)`.
- **Status line:**
  - Connected: `connected · tick N · <mode> (debug: 1 walk · 2 run · 3 horse) · +/− zoom · P pulse`, where `<mode>` is the last requested mode.
  - In a queue: `In queue: position N`.
- **Pulse** starts off unless `?pulse=1`. `P` still toggles it.
- `connection.ts` handles `queue` messages, passing them to `world.applyQueue`, and adds `sendMode`.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `npm test` and `npm run typecheck`. Expect PASS.
- [ ] **Step 3: Smoke test.**
  - Run `npm run dev` in the background.
  - `localhost:5173/` and `/src/main.ts` return 200 with no resolve errors.
  - A Node WebSocket through `ws://localhost:5173/world` receives a welcome whose characters have `speed: 500`.
  - Stop dev, and confirm ports 5173 and 8787 are free.
- [ ] **Step 4: Commit** `Client: debug speed keys, zoom with a following camera, queue display`.

---

### Task 7: Hand check and report (the controller)

- [ ] **Browser check:** walk, run and horse; zoom in and out with the camera following; clicks while zoomed; a straight path across open ground; clicking inside the closed room and far outside the search radius; spam-clicking at walk speed; the pulse off by default.
- [ ] **Queue check:** start the server with a small cap, or use the test, and observe the queue line.
- [ ] **Report:** write `docs/reports/0.2.1-movement-speeds.md` (short): what changed, how to check by hand, what was measured, what to judge by feel, and design questions.
- [ ] **Finish:** `npm test` and `npm run typecheck`, commit, push the branch.
