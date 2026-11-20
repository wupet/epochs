# Epochs (working title)

A free, web-based, computer-only fantasy RPG. Up to 100 players share one huge, simulated world that ends every week and is regenerated as a new one. Combat is decision-based, on a tile grid that advances in short ticks. Built by a team of two: Peter (design, decisions, playtesting, hosting) and Claude.

## Where things are

- `docs/phase-0-brief.md`: **the current task.** Start here.
- `docs/design-summary.md`: the game in brief, and every design decision that affects code.
- `docs/technical-plan.md`: architecture, clocks, networking, storage, testing.
- `docs/implementation-plan.md`: all phases, milestones, and the scope of each prototype.

The full design lives in Peter's design doc on claude.ai. These files are summaries of it. **Never invent game rules.** If the code needs a design decision these docs don't answer, stop and ask Peter.

## Current phase

Phase 0: Foundations. See `docs/phase-0-brief.md`.

## Stack

- TypeScript in strict mode, everywhere.
- npm workspaces (a monorepo).
- Client: Vite and PixiJS for the grid; plain HTML and CSS for menus and interface.
- Server: Node.js with the `ws` WebSocket library.
- Tests: Vitest.
- Content: JSON files validated against schemas (Zod is a reasonable choice).

## Layout

```
packages/shared   pure game rules: grid, pathfinding, ticks, combat, content schemas
packages/server   the world server: tick loop, connections, authority
packages/client   rendering, input, interpolation, interface
packages/tools    headless runner, content checker, later the simulation tools
content/          game content as data files
docs/             design and planning documents
```

## Rules that never bend

1. **The server decides everything.** Clients send intentions ("move to this tile"), never results (positions, damage).
2. **Shared rules are pure and deterministic.** No `Math.random`, `Date.now`, or I/O inside `packages/shared`. Randomness comes from a seeded generator passed in.
3. **Same seed and same inputs give the same world,** every time. This is tested.
4. **Content is data, not code.** Classes, abilities, items, and enemies live in `content/`. Adding one never means touching the engine.
5. **Everything runs headless.** The game must be runnable without graphics, for testing and simulation.
6. **Hidden information never reaches the client.** The server sends each client only what that player can see.

## Key numbers

- Tick: 250 ms. Walking is 2 tiles/s (one tile every 2 ticks); speeds are fractional and may reach 2 tiles per tick. A tile is about 1 m.
- Subtick: 25 ms, 10 per tick. Faster characters act on earlier subticks. (Hook it in; not needed in Phase 0.)
- Macro tick: 60 seconds, for world simulation. (Not needed in Phase 0.)
- Regions: 64 by 64 tiles. (Not needed in Phase 0.)

## Working style

- Small steps. Every session ends with something that runs and tests that pass.
- Commit after each milestone with a clear message.
- Prefer few dependencies. Ask Peter before adding a large one.
- Name things after game concepts: tick, tile, intention, region.
- Write tests for rules, especially anything deterministic.
- At the end of each milestone, write a short report in `docs/reports/`: what was built, how to run it, what to check by hand, and any open design questions. Peter brings these back to the design conversation.

## Commands

Requires Node 22 or later. Run `npm ci` once after cloning (installs exactly what `package-lock.json` lists).

- `npm run dev`: start server and client together. Client at http://localhost:5173, world server at http://localhost:8787 (`/health`). Ctrl+C stops both.
- `npm test`: run all tests once (Vitest, one project per package). `npm run test:watch` to keep watching.
- `npm run typecheck`: type-check every package.
- `npm run check-links`: re-point workspace links in `node_modules` at this repo (Windows junctions are absolute, so they break when the repo moves). Runs automatically before `dev`, `test` and `typecheck`.
- `npm run check-content`: validate everything in `content/` and report each problem as file, field and message.

`packages/shared` is type-checked with no Node or DOM types, so `process`, `setTimeout`, `window`, `fs` and the like fail to compile there. That's deliberate (rule 2). Its tests are checked separately with Node types.
