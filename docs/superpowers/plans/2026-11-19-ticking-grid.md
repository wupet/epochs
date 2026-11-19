# Milestone 0.2: A Ticking Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A server ticking every 250 ms, and browser tabs that each walk a square around a 32×32 grid by clicking, one tile per tick, sliding smoothly.

**Architecture:**
- Pure rules live in `packages/shared`: the grid, step legality, route finding, world state, `step`, and the wire protocol.
- The server owns the world. It queues intentions from WebSocket clients, runs `step` from a drift-free tick loop, and sends each client a per-tick diff built from an id/x/y view.
- The client (PixiJS 8) renders the server's view, tweens moves over one tick, and previews routes with the same `findRoute`.

**Tech Stack:** TypeScript 7 (strict), npm workspaces, Vitest 5, Vite 8, PixiJS 8.23.0, ws 8.23.0 with @types/ws 8.18.2, Node 22.

**Spec:** `docs/superpowers/specs/2026-11-19-ticking-grid-design.md` (read it first), plus milestone 0.2 in `docs/phase-0-brief.md`.

## Global Constraints

- `packages/shared` is pure: no `Math.random`, `Date.now`, `new Date`, no I/O, no Node or DOM APIs. Its tsconfig has `types: []` and `lib: ["ES2022"]`.
- The server decides everything. A client sends only `{ "type": "move", "x": <int>, "y": <int> }`.
- Messages to clients carry characters only as `{ id, x, y }`. A character's `path` or target never leaves the server.
- `TICK_MS` = 250 comes from `@epochs/shared`. Every intention carries `subtick`, which is 0 in Phase 0.
- Grid blocked tiles are stored as a flat `boolean[]` (index `y * width + x`), never as a `Set`.
- Character ids are positive integers from a server counter. They are never reused and are compared numerically.
- Imports inside a package use extensionless relative paths, like the existing code (`from './time'`). Packages import each other as `@epochs/shared`.
- Each test file sits next to its source as `*.test.ts`. Run all tests with `npm test`, and one package with `npx vitest run --project <shared|server|client|tools>`.
- `npm run typecheck` must pass at the end of every task.
- Commit at the end of every task, then `git push`. If the push is blocked, report it; don't work around it.

## Review Focus

1. **A tab closes mid-walk.** Its square disappears for everyone (`left`) on the next tick. Pinned in Task 7.
2. **A tab closes before its first welcome.** Its join and leave land in the same tick. Nothing is sent to it, nothing crashes, and other clients never see it. Pinned in Task 7.
3. **A backgrounded tab** stops animation frames while tick messages keep arriving. When it returns, every square sits exactly on its latest tile with no backlog of slides. Pinned in Task 8.
4. **A tick message at or before the welcome's tick** (it can arrive around the welcome) is ignored rather than applied twice. Pinned in Task 8.
5. **Several clicks in one tick:** only the last one counts. **Clicking your own tile:** no movement. Pinned in Task 4.

---

### Task 1: Purity guard for `packages/shared`

**Files:**
- Create: `packages/tools/src/purity.ts`
- Test: `packages/tools/src/purity.test.ts` (unit tests on fixture text)
- Test: `packages/tools/src/shared-purity.test.ts` (scans the real `packages/shared`)

**Interfaces:**
- Produces: `stripComments(source: string): string`. It replaces comment text with spaces and keeps newlines, so line numbers survive.
- Produces: `findForbidden(source: string): { line: number; match: string }[]`
- Produces: `scanForForbidden(dir: string): { file: string; line: number; match: string }[]`. It walks `.ts`, `.mts`, `.js` and `.mjs` files recursively and skips `node_modules`.
- Produces: `FORBIDDEN_PATTERNS: readonly RegExp[]`, being `/\bMath\s*\.\s*random\b/`, `/\bDate\s*\.\s*now\b/` and `/\bnew\s+Date\b/`.

The scanner lives in `tools`, not `shared`, because it reads files. That also keeps the fixture strings out of the scanned folder.

- [ ] **Step 1: Write failing unit tests** in `purity.test.ts`.
  - `findForbidden('const r = Math.random();')` → one hit on line 1.
  - The same holds for `Date.now()`, `new Date()`, `new  Date(0)` and `Math . random()`.
  - `findForbidden('// Math.random is banned\n/* Date.now */ const x = 1;')` → `[]`.
  - `findForbidden("const u = 'http://x'; Math.random()")` → one hit, which proves `//` inside a string is not a comment.
  - `findForbidden('const a = "/*"; Date.now()')` → one hit.
  - `findForbidden('const a = `//${1}`; new Date()')` → one hit.
  - A multi-line source with the call on line 3 → reports `line: 3`.
  - `findForbidden('const MathRandom = 1; myDate.nowish();')` → `[]`.
- [ ] **Step 2: Run** `npx vitest run --project tools`. Expect FAIL (module missing).
- [ ] **Step 3: Implement `purity.ts`.**
  - `stripComments` is a single left-to-right scan with states: code, `'`, `"`, `` ` ``, line comment and block comment. It honours backslash escapes inside strings.
  - Regex literals and `${}` nesting are not handled. Note that in a comment.
- [ ] **Step 4: Write the guard test** in `shared-purity.test.ts`.
  - `scanForForbidden(<repo>/packages/shared)` equals `[]`. Find the repo path like `paths.ts` does, with `new URL('../../shared/', import.meta.url)`.
  - On failure the message lists `file:line match`.
  - A second test copies the scan onto a temp folder holding a file with `Math.random()`, and expects one hit naming that file.
- [ ] **Step 5: Run** `npm test`. Expect PASS, with 12 earlier tests plus the new ones.
- [ ] **Step 6: Run** `npm run typecheck`. Expect exit 0.
- [ ] **Step 7: Commit** `Guard shared against Math.random, Date.now and new Date`, then push.

---

### Task 2: Grid and step legality, and record Peter's decisions

**Files:**
- Create: `packages/shared/src/grid.ts`
- Test: `packages/shared/src/grid.test.ts`
- Modify: `packages/shared/src/index.ts` (export it)
- Modify: `docs/phase-0-brief.md` and `docs/design-summary.md`

**Interfaces:**
- Produces:
  ```ts
  export interface Tile { readonly x: number; readonly y: number }
  export interface Grid { readonly width: number; readonly height: number; readonly blocked: readonly boolean[] }
  export function gridFromRows(rows: readonly string[]): Grid   // '#' blocked, '.' open; throws Error on ragged rows, unknown characters, or zero size
  export function gridToRows(grid: Grid): string[]
  export function inBounds(grid: Grid, tile: Tile): boolean
  export function isWalkable(grid: Grid, tile: Tile): boolean   // in bounds and not blocked
  export function canStep(grid: Grid, from: Tile, to: Tile): boolean
  export function sameTile(a: Tile, b: Tile): boolean
  export const STEP_DIRECTIONS: readonly Tile[]  // N, E, S, W, NE, SE, SW, NW as {x,y} deltas, y grows downward
  ```

- [ ] **Step 1: Write failing tests** in `grid.test.ts`.
  - `gridFromRows` round-trips through `gridToRows`.
  - It throws on `['..', '.']` and on `['.x']`.
  - `isWalkable` is false for out-of-bounds tiles and for `#`.
  - `canStep` is true for each of the 8 neighbours on an open 3×3 grid from (1,1).
  - `canStep` is false for a non-neighbour such as (0,0)→(2,0), and for the same tile.
  - `canStep` is false into a blocked tile.
  - On `['.#', '..']`, the diagonal (0,0)→(1,1) is false, because one side tile is blocked.
  - On `['..', '#.']` it is false too.
  - On `['..', '..']` it is true.
  - The corner rule is symmetric: `canStep(g, a, b) === canStep(g, b, a)` for every pair of neighbours on a small grid with some walls.
- [ ] **Step 2: Run** `npx vitest run --project shared`. Expect FAIL.
- [ ] **Step 3: Implement `grid.ts`.**
- [ ] **Step 4: Run** the shared tests. Expect PASS. Then run `npm run typecheck`.
- [ ] **Step 5: Update the docs.**
  - **`docs/phase-0-brief.md`, 0.2 "Build, in shared":** replace the line "Pathfinding (A* is fine) … moving in four directions. Diagonal movement is undecided; keep it easy to switch on later, and ask Peter if it matters." with a pathfinding bullet that records:
    - Peter's decisions:
      - Pathfinding moves in 8 directions, and a diagonal step takes one tick like any other step.
      - Old School RuneScape's rule applies: a diagonal step is only allowed when both L-shaped routes are clear, so both tiles you'd pass between must be walkable. No cutting corners.
      - Clicking a blocked or unreachable tile walks you to the nearest reachable tile, like RuneScape. If two are equally near, prefer the one with the shorter path. The hover preview shows the same path.
      - Players pass through each other and can share tiles. Enemy collision is decided in Phase 2.
    - The builder's interpretations, clearly marked: "nearest" is measured as straight-line distance (dx² + dy²), and any remaining tie goes to the lower y, then the lower x.
  - **The brief's 0.2 "Tests" list:** add the purity guard ("the tests fail if any file in `packages/shared` uses `Math.random`, `Date.now`, or `new Date`") and the diagonal corner rule.
  - **`docs/design-summary.md`, "Movement":** add bullets for the diagonal rule, passing through, and nearest-reachable, with the same marked interpretations.
- [ ] **Step 6: Commit** `Add the grid and the diagonal step rule; record movement decisions`, then push.

---

### Task 3: Route finding

**Files:**
- Create: `packages/shared/src/route.ts`
- Test: `packages/shared/src/route.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `Grid`, `Tile`, `canStep`, `STEP_DIRECTIONS` and `sameTile` from Task 2.
- Produces:
  ```ts
  export interface Route { readonly destination: Tile; readonly path: readonly Tile[]; readonly reachedTarget: boolean }
  export function findRoute(grid: Grid, from: Tile, to: Tile): Route   // path excludes `from`; empty when already at destination
  export function nearness(a: Tile, b: Tile): number                   // dx*dx + dy*dy; the one place "nearest" is defined
  ```

**Algorithm (the tests don't fully determine it):**
1. **Forward BFS from `from`** over `canStep`, recording the step count to every reachable tile.
2. **Pick the destination.**
   - If `to` was reached, the destination is `to`.
   - Otherwise, take the reachable tile with the smallest `(nearness(tile, to), steps, y, x)`, compared in that order.
3. **Reverse BFS from the destination** over `canStep`, giving `toDest[tile]`.
4. **Walk from `from` until at the destination.** At each tile, let `d = toDest[current]`.
   - Try the neighbour in direction `(sign(dest.x - cur.x), sign(dest.y - cur.y))` first.
   - Then try `STEP_DIRECTIONS` in order.
   - Take the first neighbour where `canStep(current, n)` holds and `toDest[n] === d - 1`.

`to` may be out of bounds; `nearness` still works. `from` is assumed in bounds.

- [ ] **Step 1: Write failing tests.**
  - **Open 5×5, (0,0)→(3,1):** the path is `[(1,1),(2,1),(3,1)]` (diagonal first), and `reachedTarget` is true.
  - **Open grid, (0,0)→(1,3):** the path is `[(1,1),(1,2),(1,3)]`.
  - **Path length equals Chebyshev distance on an open grid:** (0,0)→(4,2) is 4 steps.
  - **Avoids blocked tiles:** a wall with one gap is passed through the gap, and no path tile is blocked.
  - **Every consecutive pair in every returned path satisfies `canStep`.** Check this in a helper used by all tests.
  - **No corner cutting:** on `['.#', '#.']` from (0,0) to (1,1), the result is `reachedTarget: false`, the destination is (0,0) and the path is empty.
  - **Blocked target:** on an open 5×5 with (2,2) blocked, (0,2)→(2,2) gives destination (1,2), `reachedTarget: false`, and a path ending at (1,2).
  - **Walled-off room:** the target inside a closed ring gives the nearest outside tile by `nearness`.
  - **The shared fixture `ROW_WALL`** is `['.....', '.....', '.###.', '.....', '.....']`, with target (2,2), which is blocked.
    - Its nearness-1 candidates are (2,1) and (2,3).
    - The no-corner-cutting rule stops the start from slipping diagonally past the wall ends at (1,2) and (3,2).
  - **Tie on nearness goes to the shorter path, even against y order.**
    - `ROW_WALL` from (0,3): (2,3) takes 2 steps and (2,1) takes 4.
    - Expect destination (2,3), although (2,1) has the lower y.
  - **The remaining tie goes to the lower y.**
    - `ROW_WALL` from (0,2): both candidates take 3 steps.
    - Expect (2,1).
  - **Then the lower x.**
    - Use the transposed fixture `COLUMN_WALL`: `['.....', '..#..', '..#..', '..#..']`, from (2,0), with target (2,2) blocked.
    - (1,2) and (3,2) are both nearness 1 and both 3 steps away, at the same y.
    - Expect (1,2).
  - **Already there:** `findRoute(g, a, a)` gives an empty path, `reachedTarget: true` and destination `a`.
  - **Deterministic:** calling twice gives deep-equal results.
- [ ] **Step 2: Run** the shared tests. Expect FAIL.
- [ ] **Step 3: Implement `route.ts`** as above, using flat arrays indexed by `y * width + x` and a plain array queue with a head index.
- [ ] **Step 4: Run** the shared tests and `npm run typecheck`. Expect PASS.
- [ ] **Step 5: Commit** `Add route finding with nearest-reachable fallback`, then push.

---

### Task 4: World state, intentions, and `step`

**Files:**
- Create: `packages/shared/src/world.ts` (types, `createWorld`, `findSpawnTile`, `step`)
- Test: `packages/shared/src/world.test.ts` and `packages/shared/src/determinism.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: Task 2 (`Grid`, `Tile`, `canStep`, `isWalkable`, `STEP_DIRECTIONS`, `sameTile`) and Task 3 (`findRoute`).
- Produces:
  ```ts
  export type CharacterId = number;
  export interface Character { readonly id: CharacterId; readonly tile: Tile; readonly path: readonly Tile[] }
  export interface WorldState { readonly tick: number; readonly grid: Grid; readonly spawn: Tile; readonly characters: readonly Character[] } // sorted by id ascending
  export type Intention =
    | { readonly kind: 'move'; readonly characterId: CharacterId; readonly target: Tile; readonly subtick: number }
    | { readonly kind: 'join'; readonly characterId: CharacterId; readonly subtick: number }
    | { readonly kind: 'leave'; readonly characterId: CharacterId; readonly subtick: number };
  export function createWorld(grid: Grid, spawn: Tile): WorldState   // tick 0, no characters; throws if spawn not walkable
  export function findSpawnTile(state: WorldState): Tile             // BFS over canStep from spawn; first tile with no character; else spawn
  export function step(state: WorldState, intentions: readonly Intention[]): WorldState
  ```

**`step` order** (from the spec):
1. Stable-sort the intentions by `(subtick, characterId)`.
2. Apply joins and leaves in that order.
   - A join of an existing id is ignored; otherwise the character is added at `findSpawnTile` with an empty path.
   - A leave of an unknown id is ignored.
3. For each character, take the last `move` in the sorted order and set `path = findRoute(grid, tile, target).path`. A move for an unknown id is ignored.
4. Move every character one step: if `path[0]` exists and `canStep(tile, path[0])`, move there and drop it; otherwise clear the path.
5. `tick + 1`.

Never mutate the input.

- [ ] **Step 1: Write failing tests** in `world.test.ts`.
  - A join adds a character at the spawn, the second join lands on a different free tile next to it, and `tick` is 1.
  - A leave removes the character.
  - A move to a tile 3 away advances exactly one tile per `step`, and arrives after 3 steps.
  - **A new move mid-walk:** the very next `step` moves toward the new target.
  - **Several moves for one character in one tick:** only the last counts.
  - **Moving to your own tile:** the character stays put with an empty path.
  - **Sharing tiles:** two characters can be sent to the same tile and both end up there.
  - **Diagonal:** a single step from (2,2) to (3,3) on an open grid takes one tick.
  - The input state is unchanged (deep-equal to a `structuredClone` taken before the call).
  - `characters` stays sorted by id.
  - A move intention carrying `subtick: 0` is honoured.
- [ ] **Step 2: Write the failing determinism test** in `determinism.test.ts`.
  - Build a fixed 12×12 grid with walls, and a scripted list of 60 ticks of intentions: joins of ids 1–3, moves including blocked targets, a re-route mid-walk, and a leave.
  - Run it twice from `createWorld`, collecting every intermediate state.
  - Expect `toEqual` across all states, and that `JSON.stringify(final)` is identical.
- [ ] **Step 3: Run** the shared tests. Expect FAIL.
- [ ] **Step 4: Implement `world.ts`.**
- [ ] **Step 5: Run** the shared tests and `npm run typecheck`. Expect PASS.
- [ ] **Step 6: Commit** `Add world state, intentions and the pure step function`, then push.

---

### Task 5: Wire protocol and views

**Files:**
- Create: `packages/shared/src/protocol.ts`
- Test: `packages/shared/src/protocol.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: Tasks 2 and 4.
- Produces:
  ```ts
  export interface CharacterView { readonly id: CharacterId; readonly x: number; readonly y: number }
  export interface GridView { readonly width: number; readonly height: number; readonly rows: readonly string[] }
  export interface WelcomeMessage { readonly type: 'welcome'; readonly you: CharacterId; readonly tick: number; readonly grid: GridView; readonly characters: readonly CharacterView[] }
  export interface TickMessage { readonly type: 'tick'; readonly tick: number; readonly moved: readonly CharacterView[]; readonly joined: readonly CharacterView[]; readonly left: readonly CharacterId[] }
  export type ServerMessage = WelcomeMessage | TickMessage;
  export interface MoveMessage { readonly type: 'move'; readonly x: number; readonly y: number }
  export type ClientMessage = MoveMessage;
  export const MAX_CLIENT_MESSAGE_LENGTH = 256;
  export function viewOf(character: Character): CharacterView          // copies only id, x, y
  export function welcomeMessage(state: WorldState, you: CharacterId): WelcomeMessage
  export function tickMessage(prev: WorldState, next: WorldState): TickMessage
  export function parseClientMessage(raw: string, grid: Grid): ClientMessage | null
  ```

**Details:**
- `tickMessage`:
  - `joined` lists ids in `next` but not in `prev`.
  - `left` lists ids in `prev` but not in `next`.
  - `moved` lists ids in both whose tile changed.
  - All three are sorted by id.
- `parseClientMessage` returns `null` when:
  - the input is longer than `MAX_CLIENT_MESSAGE_LENGTH`, or isn't valid JSON;
  - the value isn't a plain object, or has keys other than exactly `type`, `x` and `y`;
  - `type !== 'move'`;
  - `x` or `y` isn't an integer (`Number.isInteger`), or is out of bounds.
- A blocked target is still valid.

- [ ] **Step 1: Write failing tests.**
  - The welcome's grid rows equal `gridToRows(state.grid)`.
  - Welcome and tick messages never contain a `path` key. Check `JSON.stringify(msg)` for `"path"` after a character has a path.
  - `tickMessage` reports joins, leaves and moves correctly across one `step`, and returns empty arrays when nothing changed.
  - `parseClientMessage` accepts `{"type":"move","x":3,"y":4}`.
  - It rejects:
    - `'not json'`, `'null'`, `'[]'` and `'{"type":"move","x":1.5,"y":2}'`;
    - x = -1, x = width, and a string `"3"`;
    - an extra key, an unknown type, and a 300-character string.
  - It accepts a blocked in-bounds tile.
- [ ] **Step 2: Run.** Expect FAIL.
- [ ] **Step 3: Implement `protocol.ts`.**
- [ ] **Step 4: Run** the shared tests and `npm run typecheck`. Expect PASS.
- [ ] **Step 5: Commit** `Add the wire protocol, views and client message validation`, then push.

---

### Task 6: Drift-free tick loop

**Files:**
- Create: `packages/server/src/tick-loop.ts`
- Create: `packages/server/src/manual-clock.ts` (test helper, also used in Task 7)
- Test: `packages/server/src/tick-loop.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface TickClock { now(): number; schedule(delayMs: number, run: () => void): () => void } // returns cancel
  export const systemClock: TickClock     // performance.now() and setTimeout/clearTimeout
  export interface TickLoop { stop(): void; ticksRun(): number }
  export function startTickLoop(onTick: () => void, clock?: TickClock, tickMs?: number): TickLoop // defaults: systemClock, TICK_MS
  // manual-clock.ts
  export class ManualClock implements TickClock {
    now(): number;
    schedule(delayMs: number, run: () => void): () => void;
    advance(ms: number, lateByMs?: number): void   // moves time forward; fires due callbacks, each `lateByMs` after its due time (but never past the new now)
  }
  ```

**Behaviour:**
- `start = clock.now()`.
- On each wake, `due = Math.floor((now - start) / tickMs)`. Run `onTick` while `ran < due`.
- Then schedule the next wake at `start + (ran + 1) * tickMs - now`, clamped to at least 0.
- Nothing is run at start.
- After `stop()`, nothing more runs.

- [ ] **Step 1: Write failing tests.**
  - **Over 10 000 ms advanced in irregular chunks** (for example 7, 300, 1, 999 … that sum to 10 000), exactly 40 ticks have run.
  - **Over a simulated hour** (3 600 000 ms in chunks of 1 000, with every callback firing 37 ms late), exactly 14 400 ticks have run. The 14 400th tick ran no later than 37 ms after its due time. This is the no-drift check: lateness doesn't accumulate.
  - **A stall:** advancing 1 000 ms in one go after a 600 ms late wake catches up with all 4 ticks.
  - **`stop()` halts:** no ticks after stopping, and the scheduled callback was cancelled.
  - **No early ticks:** advancing 249 ms runs 0 ticks, and one more ms runs 1.
- [ ] **Step 2: Run** `npx vitest run --project server`. Expect FAIL.
- [ ] **Step 3: Implement** `tick-loop.ts` and `manual-clock.ts`.
- [ ] **Step 4: Run** the server tests and `npm run typecheck`. Expect PASS.
- [ ] **Step 5: Commit** `Add the drift-free tick loop`, then push.

---

### Task 7: World server (WebSockets, test map, intentions in, diffs out)

**Files:**
- Install: from the repo root, run `npm install ws@8.23.0 -w @epochs/server` and `npm install -D @types/ws@8.18.2 -w @epochs/server`. Check that `package-lock.json` changes only by adding entries.
- Create: `packages/server/src/test-map.ts`
- Create: `packages/server/src/world-server.ts`
- Delete: `packages/server/src/server.ts` (its `/health` handler moves into `world-server.ts`)
- Modify: `packages/server/src/main.ts`
- Rename and expand: `packages/server/src/server.test.ts` becomes `world-server.test.ts`
- Test: `packages/server/src/test-map.test.ts`

**Interfaces:**
- Consumes: everything from `@epochs/shared` in Tasks 2–5; `startTickLoop`, `TickClock` and `ManualClock` from Task 6.
- Produces:
  ```ts
  // test-map.ts
  export const TEST_MAP_ROWS: readonly string[];  // 32 strings of 32 chars, '.' and '#'
  export const TEST_MAP_SPAWN: Tile;
  // world-server.ts
  export interface WorldServerOptions { readonly clock?: TickClock; readonly rows?: readonly string[]; readonly spawn?: Tile }
  export interface WorldServer { listen(port: number): Promise<number>; close(): Promise<void> } // listen resolves the actual port (0 = any)
  export function createWorldServer(options?: WorldServerOptions): WorldServer
  ```

**Test map requirements:**
- A wall border.
- A few wall runs with gaps.
- A fully enclosed room, so clicking inside it shows nearest-reachable.
- At least one diagonal pinch, where two walls touch only at a corner, so the no-corner-cutting rule shows.
- A walkable spawn near the middle.

**Server behaviour:**
- `GET /health` → `{"ok":true,"tickMs":250}`. Anything else → 404.
- A `WebSocketServer` runs on the same HTTP server at path `/world`, with `maxPayload: 4096`.
- **On connection:**
  - Assign `nextId++` (starting at 1).
  - Queue `{kind:'join', characterId, subtick:0}`.
  - Mark the socket "awaiting welcome".
- **On a message:**
  - If it is binary, ignore it.
  - Otherwise `parseClientMessage(text, grid)`. If valid, queue `{kind:'move', characterId, target:{x,y}, subtick:0}`; if not, ignore it.
  - Never close the socket for a bad message.
- **On close:** queue `{kind:'leave', …}` and forget the socket.
- **On each tick:**
  - `prev = state; state = step(prev, queued); queued = []`.
  - `msg = tickMessage(prev, state)`.
  - Send `JSON.stringify(msg)` to every *welcomed*, open socket.
  - Then, for each socket awaiting welcome whose character is now in `state`, send `welcomeMessage(state, id)` and mark it welcomed.
  - Use `readyState === WebSocket.OPEN` before every send.
- `listen` starts the tick loop. `close` stops it, terminates sockets, and closes the WS and HTTP servers.
- `main.ts` calls `createWorldServer().listen(SERVER_PORT)` and logs the existing line: `Epochs world server listening on http://localhost:${port} (tick ${TICK_MS} ms)`.

**Test helper** (inside the test file): `connect(port)` returns a ws client that records the parsed messages, plus `nextMessage(type)`. Drive ticks with `ManualClock.advance(250)`, then await a microtask or the socket flush with a small `waitFor(predicate)` polling helper of at most 1 s.

- [ ] **Step 1: Write failing tests** in `test-map.test.ts`.
  - The map is 32 rows of 32 characters, and `gridFromRows` accepts it.
  - The spawn is walkable.
  - Some walkable tile is unreachable from the spawn: the enclosed room exists.
  - Some pair of diagonal neighbours, both walkable, has `canStep === false`: the pinch exists.
- [ ] **Step 2: Write failing tests** in `world-server.test.ts`. Use `listen(0)` and a `ManualClock` throughout.
  - **Health:** the health check still answers `{ok:true, tickMs:250}`.
  - **Join and welcome:** one client connects. After one tick it gets `welcome` with `you: 1`, a 32×32 grid and itself in `characters`.
  - **Two clients see each other:** A connects and ticks. B connects and ticks. A's tick message has `joined` containing B. B's welcome lists both.
  - **Walking:** A sends a move 3 tiles away. Over the next 3 ticks, A's tick messages show `moved` for A one tile at a time, and the 3rd ends on the target.
  - **Re-routing:** A sends a new move mid-walk, and the next tick's `moved` heads to the new target.
  - **Bad messages:** `'garbage'`, `'{"type":"move","x":99,"y":0}'`, `'{"type":"teleport"}'` and a binary frame are all ignored. The socket stays open, and a valid move afterwards still works.
  - **Hidden information:** while A walks a long route, every message B receives has the following shape, and no raw string contains `"path"`:
    - The top-level keys are exactly `type, you, tick, grid, characters` for a welcome, or exactly `type, tick, moved, joined, left` for a tick.
    - Every character entry has exactly the keys `id, x, y`.
  - **Review Focus 1:** A closes mid-walk, and B's next tick message has `left: [A's id]`.
  - **Review Focus 2:** C connects and closes before any tick. After the next tick, B never saw C in `joined`, and nothing threw.
- [ ] **Step 3: Run** `npx vitest run --project server`. Expect FAIL.
- [ ] **Step 4: Implement** `test-map.ts`, `world-server.ts` and `main.ts`, and delete `server.ts`.
- [ ] **Step 5: Run** `npm test` and `npm run typecheck`. Expect PASS.
- [ ] **Step 6: Smoke test.** Start `npm run dev` in the background and run `curl -s localhost:8787/health`. Expect `{"ok":true,"tickMs":250}`. Then stop it.
- [ ] **Step 7: Commit** `Add the world server: WebSocket intentions, ticking world, per-tick diffs`, then push.

---

### Task 8: Client model (no canvas): world mirror, motion, pulse, tick timing

**Files:**
- Install: `npm install pixi.js@8.23.0 -w @epochs/client` (here so the dependency lands with the client work; check the lockfile only adds entries)
- Create: `packages/client/src/motion.ts`, `packages/client/src/pulse.ts`, `packages/client/src/client-world.ts` and `packages/client/src/tick-timing.ts`
- Test: one `*.test.ts` next to each

**Interfaces:**
- Consumes: `TICK_MS`, `ServerMessage`, `WelcomeMessage`, `TickMessage`, `Tile`, `Grid`, `gridFromRows` and `CharacterId` from `@epochs/shared`.
- Produces:
  ```ts
  // motion.ts
  export const TWEEN_MS: number;   // = TICK_MS; the one knob for slide length
  export interface Point { readonly x: number; readonly y: number }
  export interface Motion { readonly from: Point; readonly to: Point; readonly startMs: number }
  export function stillAt(tile: Point, nowMs: number): Motion
  export function positionAt(motion: Motion, nowMs: number, durationMs?: number): Point   // linear, clamped to [from, to]
  export function retarget(motion: Motion, to: Point, nowMs: number): Motion              // new slide starting from positionAt(motion, nowMs)
  // pulse.ts
  export const PULSE_STRENGTH: number;  // 0.12 to start; 0 disables
  export const PULSE_MS: number;        // 120
  export function pulseLevel(msSinceTick: number, strength?: number): number  // strength at 0 ms, falling linearly to 0 at PULSE_MS, 0 after
  export function pulseEnabledFromSearch(search: string): boolean             // false only for pulse=0 / pulse=off
  // client-world.ts
  export class ClientWorld {
    readonly you: CharacterId | null; readonly tick: number; readonly grid: Grid | null;
    applyWelcome(msg: WelcomeMessage, nowMs: number): void;
    applyTick(msg: TickMessage, nowMs: number): boolean;     // false and no change when msg.tick <= current tick
    tileOf(id: CharacterId): Tile | undefined;                // latest server tile
    positionOf(id: CharacterId, nowMs: number): Point | undefined;  // drawn position
    ids(): CharacterId[];
  }
  export function parseServerMessage(raw: string): ServerMessage | null  // light check: JSON object with type 'welcome' | 'tick'
  // tick-timing.ts
  export class TickTiming {
    record(arrivalMs: number): void;
    summary(): { count: number; meanMs: number; p95Ms: number; maxMs: number; minMs: number }  // over intervals between arrivals
  }
  ```

- [ ] **Step 1: Write failing tests.**
  - **`positionAt`:** returns `from` at the start, the midpoint at `TWEEN_MS / 2`, and `to` at and after `TWEEN_MS`.
  - **`retarget`** mid-slide starts from the current drawn point, so there is no jump.
  - **`pulseLevel`:** `pulseLevel(0) === PULSE_STRENGTH`, `pulseLevel(PULSE_MS) === 0`, monotone in between, and `pulseLevel(x, 0) === 0`.
  - **`pulseEnabledFromSearch`:** `'?pulse=0'` gives false, `''` gives true, `'?pulse=1'` gives true.
  - **`ClientWorld`, after a welcome:**
    - `tileOf(you)` matches.
    - A tick with `moved` slides that character: halfway at `TWEEN_MS / 2`, and on the tile at `TWEEN_MS`.
    - `joined` and `left` add and remove characters.
  - **Review Focus 4:** a tick with `tick <= welcome.tick` returns false and changes nothing, and so does a repeated tick number.
  - **Review Focus 3:** 40 ticks applied at the same `nowMs` (a backgrounded tab) followed by `positionOf` at `nowMs + TWEEN_MS` gives exactly the last tile.
  - **`parseServerMessage`** returns null for `'x'`, `'{}'` and `'{"type":"nope"}'`.
  - **`TickTiming`:** arrivals at 0, 250, 500 and 760 give count 3, minMs 250, maxMs 260 and meanMs ≈ 253.3.
- [ ] **Step 2: Run** `npx vitest run --project client`. Expect FAIL.
- [ ] **Step 3: Implement** the four modules.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expect PASS.
- [ ] **Step 5: Commit** `Add the client world mirror, motion tweening, tick pulse and tick timing`, then push.

---

### Task 9: Client rendering and input (PixiJS)

**Files:**
- Modify: `packages/client/vite.config.ts`. Add `server.proxy: { '/world': { target: 'ws://localhost:8787', ws: true } }`, keeping port 5173 and `strictPort`.
- Create: `packages/client/src/render.ts` (all Pixi drawing) and `packages/client/src/connection.ts` (the WebSocket: open `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/world`, parse with `parseServerMessage`, and expose `sendMove(tile)`)
- Modify: `packages/client/src/main.ts` (wiring) and `packages/client/src/style.css` (full-window canvas)

**Interfaces:**
- Consumes: Task 8's modules, plus `findRoute`, `TICK_MS` and `Tile` from `@epochs/shared`.
- Produces: no exports needed by other tasks.

**Behaviour:**
- **Tile size:** `Math.max(12, Math.floor(Math.min(innerWidth, innerHeight) / 32))`, recomputed on resize. The grid is centred.
- **Drawing:**
  - Open tiles are dark grey, blocked tiles darker or near-black, and grid lines are faint.
  - Your square is gold (`0xf2c14e`). Others are blue (`0x4ea3f2`).
  - Squares are inset by about 15% of the tile.
- **Hover:**
  - Convert the pointer to a tile.
  - If it is in bounds and your tile is known, draw `findRoute(grid, world.tileOf(you), hovered).path` as translucent tiles, with the route's `destination` outlined.
  - The preview always starts from the latest server tile.
- **Click** (left button, in bounds):
  - `sendMove(tile)`.
  - Mark `findRoute(...).destination` with a small cross until your square's server tile equals it, or until a new click.
- **Each frame:** draw every character at `world.positionOf(id, performance.now())`.
- **Pulse:** on each applied tick, record the arrival time. Each frame, lay a full-grid white overlay at alpha `pulseLevel(now - lastTickAt)` when the pulse is enabled.
  - Toggle it with the `P` key.
  - Start disabled if `pulseEnabledFromSearch(location.search)` is false.
- **Timing:** `TickTiming.record(performance.now())` on each applied tick. Every 10 s, `console.log('[epochs] tick timing', summary)`. Also expose it as `window.epochsTiming = () => timing.summary()` for manual checks.
- **Status line:** a small HTML overlay (not canvas) shows `connected` or `disconnected`, the tick number, and a hint: "click to move · P toggles tick pulse".
- Keep `console.log(describeClient())`.

- [ ] **Step 1: Implement** the files above. These are rendering and input glue; the logic under them was tested in Task 8.
- [ ] **Step 2: Run** `npm test` and `npm run typecheck`. Expect PASS.
- [ ] **Step 3: Smoke test.**
  - Start `npm run dev` in the background.
  - `curl -s localhost:5173/` returns HTML.
  - `curl -s localhost:5173/src/main.ts` returns 200 with no `Failed to resolve`.
  - Stop it.
- [ ] **Step 4: Commit** `Render the grid with PixiJS: click to move, path preview, smooth movement, tick pulse`, then push.

---

### Task 10: Hand check, feel measurement, and the 0.2 report (the controller does this, not a subagent)

- [ ] **Step 1: Two-tab check.**
  - Run `npm run dev`. With the Chrome tools, open two tabs at http://localhost:5173.
  - Click to walk, re-click mid-walk, click inside the closed room, and click across the diagonal pinch.
  - Record a GIF.
  - Confirm each "Done when" item in the brief.
- [ ] **Step 2: Measure.**
  - After about 60 s of walking, read `epochsTiming()` in each tab.
  - Note how smooth the walking looks frame to frame.
- [ ] **Step 3: Write `docs/reports/0.2-ticking-grid.md`.** It covers:
  - What was built, and how to run it.
  - What to check by hand, including the Ctrl+C check.
  - What I measured, separated from what Peter should judge by feel.
  - How the 0.25 s tick feels and what I'd tune: `TWEEN_MS`, `PULSE_STRENGTH`, `PULSE_MS`, buffered interpolation, and the search bound.
  - Design questions:
    - The "nearest" interpretation and the y-then-x tie.
    - Diagonal-first path shape.
    - The spawn spreading.
    - No catch-up cap.
    - The 10-tile search radius in RuneScape versus the whole map here.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Commit `Milestone 0.2 report`, then push.
