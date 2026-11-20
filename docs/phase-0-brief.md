# Phase 0 brief: Foundations

Phase 0 builds the skeleton everything else hangs on: the project, a server that ticks, a browser that shows the grid, and a checker for content files. Nothing here is a game yet. What matters is that the foundations follow the rules in `CLAUDE.md`, because every later phase builds on them.

There are three milestones. Do them in order. Finish each one, with tests passing and a commit, before starting the next.

## Milestone 0.1: Project setup

**Build:**

- An npm workspaces monorepo with four packages: `shared`, `server`, `client`, `tools`, plus empty `content/` and `docs/reports/` folders.
- TypeScript in strict mode for every package, with one shared base configuration.
- Vitest set up for every package.
- Vite for the client.
- Scripts at the root: `npm run dev` (server and client together), `npm test`, `npm run typecheck`.
- A `.gitignore` suited to Node and Vite.

**Done when:**

- `npm run dev` serves a blank page in the browser from a local server.
- `npm test` and `npm run typecheck` pass.
- The commands section of `CLAUDE.md` is filled in.

## Milestone 0.2: A ticking grid

*Movement pace superseded by 0.2.1: walking is one tile every 2 ticks; see the 0.2.1 section below.*

**Build, in `shared`:**

- A grid type: width, height, and which tiles are blocked.
- Pathfinding from one tile to another on the grid. Peter's decisions (2026-11-19):
  - It moves in 8 directions, and a diagonal step takes one tick like any other step.
  - Old School RuneScape's rule applies: a diagonal step is only allowed when both L-shaped routes are clear, so both tiles you'd pass between must be walkable. No cutting corners.
  - Clicking a blocked or unreachable tile walks you to the nearest reachable tile, like RuneScape. If two are equally near, prefer the one with the shorter path. The hover preview shows the same path.
  - Players pass through each other and can share tiles. Enemy collision is decided in Phase 2.
  - Builder's interpretation (dx² + dy² nearness) was replaced in milestone 0.2.1: "nearest" now counts a diagonal tile as 1 step away (Chebyshev), and the path is the one closest to the straight line. See Milestone 0.2.1 below.
- A pure `step` function: given the world state and the intentions received this tick, return the next world state. No randomness, no clock, no I/O.

**Build, in `server`:**

- A fixed-step tick loop at 250 ms that doesn't drift over time: accumulate elapsed time and run as many steps as are due.
- A small test map, about 32 by 32 tiles, with some blocked tiles.
- WebSocket connections. Each connected client gets one character, a square, on the grid.
- Intentions from clients: "move to tile (x, y)". The server finds a path and moves the character one tile per tick along it.
- A new move intention replaces the current path on the next tick.
- Each tick, send each client only what changed since the last tick.
- Validate every message from a client. Ignore anything malformed or impossible.

**Build, in `client`:**

- Render the grid and characters with PixiJS. *(PixiJS 8 for the client and the `ws` library for the server: Peter, 2026-11-19.)*
- Clicking a tile sends a move intention.
- Hovering a tile shows the planned path, computed with the same pathfinding from `shared`. The server's path is still the one that counts.
- Smooth movement: slide characters between tile positions over the tick, so half-tile jumps never show. The world should feel fluid even though it advances in steps.
- A subtle pulse marking each tick, so the rhythm can be felt. Keep it easy to tone down or turn off.

**Hook in, but don't build out:** each intention carries a subtick (0 to 9) so later phases can order actions by speed. In Phase 0, everything acts on subtick 0.

**Tests:**

- Pathfinding: finds a path, avoids blocked tiles, reports when there's no path.
- Diagonal corner rule: a diagonal step is refused when either tile you'd pass between is blocked.
- Determinism: running the same starting state and the same sequence of intentions through `step` twice produces identical results.
- Tick timing: the loop runs the right number of steps over a simulated stretch of time, with no drift.
- Purity guard: the tests fail if any file in `packages/shared` uses `Math.random`, `Date.now`, or `new Date`.

**Done when:**

- Clicking a tile moves the square there one tile per tick, smoothly, along a path that avoids blocked tiles.
- Clicking somewhere new mid-walk changes course on the next tick: the new path is set then, and the square turns on its next step. (At walking pace the visible turn can be up to half a second later.)
- Two browser tabs show two squares moving on the same grid, each controlled by its own tab.
- All tests pass.

The tick retry-forever problem (a failing tick is retried without end) is not fixed in 0.2 or 0.2.1. It is scheduled first thing in 0.3. *(Peter, 2026-11-19.)*

## Milestone 0.2.1: Movement speeds

Follow-ups to 0.2, decided by Peter after playing it (2026-11-19). The design is in `docs/superpowers/specs/2026-11-19-movement-speeds-design.md`. All of these are *(Peter, 2026-11-19.)* unless marked as an approved builder's call.

1. **Nearest.** When the clicked tile can't be reached, a diagonal tile counts as 1 step away (Chebyshev distance). Ties go to the shorter path, then lower y, then lower x (the last two are approved builder's calls).
2. **Path shape.** Among equally short paths, take the one closest to the straight line from start to end. This replaces diagonal-first.
3. **Spawning** on the nearest free tile is fine.
4. **Search range.** The nearest-tile search covers 16 tiles around the click (about one screen). If nothing reachable is in range, the character stays put.
5. **Stalls.** After a stall, the tick loop catches up at most about one second of ticks, skips the rest, and logs it.
6. **A full server.** The 101st player waits in a queue that shows their position.
7. **Retry-forever.** The tick that retries forever is fixed first thing in 0.3, not here.
8. **Tick.** It stays at 250 ms.
9. **Speeds.** Walking is one tile every 2 ticks (2 tiles/s). Any speed works by letting a step take a fractional number of ticks, built up over time. Moving 2 tiles in one tick is allowed, for fast travel later. A tile is about one metre.
10. **Debug speed keys.** Keys 1, 2 and 3 switch between walk (2 tiles/s), run (4 tiles/s) and horse (8 tiles/s). **These are debug controls**, for testing feel only. Running and riding get real rules later.
11. **Zoom.** Keys zoom in and out (`+` or `=` in, `-` out; approved builder's call).
12. **Pulse.** The tick pulse is off by default (`P` toggles it, `?pulse=1` starts with it on; approved builder's call).
13. **No free steps.** While a character stands still, their progress builds up toward a step but is capped at one tick's worth at the current speed, but never less than one step, so a rested walker still steps on the next tick. Every speed therefore sets off at full pace (a rested rider moves 2 tiles on the first tick), and repeated clicks can never beat their normal pace. There is a test for spam-clicking at every speed. *(Peter, 2026-11-19: this replaces the earlier cap of one full step. The wording "one tick's worth, never less than one step" is the controller's reading, which keeps the earlier rule that a rested walker steps on the next tick.)*

## Milestone 0.3: Content checker

**Build:**

- Schemas in `shared` for four kinds of content: a class, an ability, an item, and an enemy. Use the field outlines below. Keep them small; they'll grow in later phases.
- One sample file of each kind in `content/`, using the examples below.
- `npm run check-content`, a command in `tools` that loads every file in `content/`, validates it, and reports problems clearly: which file, which field, and what's wrong.

**Field outlines:**

- **Class:** id, name, tier (beginner, intermediate, advanced, expert), capacity cost (1, 2, 3, 5), prerequisites (list of class id and rank), unlock condition (a short description for now), signature passive (id and description), starting abilities (list of ability ids), capstone (a short description of the class's bonus at full mastery) *(Peter, 2026-11-19)*.
- **Ability:** id, name, channel time in ticks, shape (single tile, line, cone, burst, wall, touch, self), range in tiles, damage (list of damage kind and amount), conditions applied (list, may be empty).
- **Item:** id, name, kind (plain, trait, storied, holy relic, cursed, consumable, tool), quality (crude, common, fine, superior, masterwork, legendary, mythic), damage split (list of damage kind and amount, for weapons), requirements (list of attribute and minimum).
- **Enemy:** id, name, family, tier, health, damage (list of damage kind and amount), resistances (list of damage kind and multiplier), intelligence (mindless, instinctive, cunning, organized, ancient).

Damage kinds are Force, Precision, Arcane, and Holy. Attributes are Might, Finesse, Vigor, Wits, and Spirit.

**Samples:**

- Class: Militia (beginner, cost 1, no prerequisites), unlocked by holding a gate until a raid ends.
- Ability: a basic strike, 1 tick channel, single tile, Force damage.
- Item: a rusty shortsword, plain, crude quality, mostly Force with a little Precision, low Might requirement.
- Enemy: a slime, family slime, tier 1, resists Precision, mindless.

**Tests:**

- Every sample file passes.
- A deliberately broken file is rejected with a clear message naming the file and field.

**Done when:**

- `npm run check-content` passes on the samples and clearly rejects a broken file.
- All tests pass.

## Not in Phase 0

No combat, no abilities in action, no enemies on the map, no accounts, no database, no world generation, no art beyond simple shapes. Those come in later phases.

## Reporting back

After each milestone, write a short report in `docs/reports/` (for example `0.2-ticking-grid.md`):

- What was built.
- How to run it.
- What to check by hand.
- Anything that felt off, especially how the tick feels.
- Any design questions that came up.
