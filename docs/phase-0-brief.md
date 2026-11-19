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

**Build, in `shared`:**

- A grid type: width, height, and which tiles are blocked.
- Pathfinding (A* is fine) from one tile to another on the grid, moving in four directions. Diagonal movement is undecided; keep it easy to switch on later, and ask Peter if it matters.
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

- Render the grid and characters with PixiJS.
- Clicking a tile sends a move intention.
- Hovering a tile shows the planned path, computed with the same pathfinding from `shared`. The server's path is still the one that counts.
- Smooth movement: slide characters between tile positions over the tick, so half-tile jumps never show. The world should feel fluid even though it advances in steps.
- A subtle pulse marking each tick, so the rhythm can be felt. Keep it easy to tone down or turn off.

**Hook in, but don't build out:** each intention carries a subtick (0 to 9) so later phases can order actions by speed. In Phase 0, everything acts on subtick 0.

**Tests:**

- Pathfinding: finds a path, avoids blocked tiles, reports when there's no path.
- Determinism: running the same starting state and the same sequence of intentions through `step` twice produces identical results.
- Tick timing: the loop runs the right number of steps over a simulated stretch of time, with no drift.

**Done when:**

- Clicking a tile moves the square there one tile per tick, smoothly, along a path that avoids blocked tiles.
- Clicking somewhere new mid-walk changes course on the next tick.
- Two browser tabs show two squares moving on the same grid, each controlled by its own tab.
- All tests pass.

## Milestone 0.3: Content checker

**Build:**

- Schemas in `shared` for four kinds of content: a class, an ability, an item, and an enemy. Use the field outlines below. Keep them small; they'll grow in later phases.
- One sample file of each kind in `content/`, using the examples below.
- `npm run check-content`, a command in `tools` that loads every file in `content/`, validates it, and reports problems clearly: which file, which field, and what's wrong.

**Field outlines:**

- **Class:** id, name, tier (beginner, intermediate, advanced, expert), capacity cost (1, 2, 3, 5), prerequisites (list of class id and rank), unlock condition (a short description for now), signature passive (id and description), starting abilities (list of ability ids).
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
