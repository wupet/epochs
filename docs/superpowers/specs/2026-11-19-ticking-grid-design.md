# Milestone 0.2: A ticking grid (design)

Approved by Peter on 2026-11-19. Builds milestone 0.2 of `docs/phase-0-brief.md`. The brief is the spec; this records the decisions made on top of it and the builder's calls.

## Intent

The first time the world moves. A server ticks every 250 ms, and each browser tab controls a square that walks where you click, one tile per tick, sliding smoothly. The real question 0.2 answers is how the 0.25-second tick *feels*, so the report must cover that and what to tune.

**Goals:** everything in the brief's 0.2 section; the decisions below; a feel report.
**Non-goals:** combat, enemies, collision between characters, fog of war, accounts, persistence, a map editor.
**Anti-goals:** anything that breaks the rules in CLAUDE.md. Specifically: client-decided positions, randomness or clocks in `shared`, or a hover preview that disagrees with where the server walks you.

## Peter's decisions (2026-11-19)

1. **Diagonal movement** is allowed and takes one tick, like any other step. Old School RuneScape's rule: a diagonal step is allowed only when both L-shaped routes are clear. Both side tiles you'd pass between must be walkable (no corner-cutting).
2. **Players pass through each other** and can share tiles for now. Enemy collision is decided in Phase 2.
3. **Clicking a blocked or unreachable tile** walks you to the nearest reachable tile, like RuneScape. If two are equally near, prefer the one with the shorter path. The hover preview shows the same path.
4. **Purity guard:** tests fail if any file in `packages/shared` uses `Math.random`, `Date.now`, or `new Date`.
5. **Dependencies:** PixiJS 8 (client) and `ws` (server).

These go into `docs/phase-0-brief.md` and `docs/design-summary.md`.

## Approaches considered

**Pathfinding.**
- **Breadth-first search over 8 neighbours (chosen).** Every step costs one tick, diagonal or not, so BFS is optimal and simpler than A*. A single BFS from the start also gives the path length to every reachable tile, which is exactly what the nearest-reachable rule needs. It is also what RuneScape does.
- *A\* with a Chebyshev heuristic* is faster toward a reachable target. However, the unreachable case needs a full flood anyway, so it would be two algorithms instead of one.
- *Jump-point search* is premature.

**Smooth movement on the client.**
- **Tween on arrival (chosen).** When a tick says a character moved, slide it from where it is drawn now to the new tile over one tick (250 ms). This adds no artificial delay and absorbs network jitter, because each slide starts from the current drawn position.
- *A fixed one-tick render delay with a snapshot buffer* is steadier under bad jitter but always adds 250 ms of lag. It can be revisited if the report finds stutter.
- *Client-side prediction* is out: the server decides everything, and Phase 0 doesn't need it.

**Updates.**
- **A message every tick, carrying only changes (chosen).** Each tick message carries the tick number, moves, joins and leaves, and is sent even when empty. The steady beat drives the tick pulse and keeps interpolation timed.
- *Sending only when something changed* leaves the client unable to show the rhythm.

## Rules, precisely

**Grid.** Width, height, and which tiles are blocked, stored as a flat array of booleans or as row strings, never as a JS `Set` (a `Set` turns into `{}` in JSON, so a snapshot would silently lose the walls). A tile is walkable if it is in bounds and not blocked.

**Step legality.** A step goes from a tile to one of its 8 neighbours. The destination must be walkable. A diagonal step from (x, y) to (x+dx, y+dy) also needs (x+dx, y) and (x, y+dy) to be walkable.

**Route finding.** `findRoute(grid, from, to)` runs a BFS from `from` over legal steps.
- If `to` is reachable, the destination is `to`.
- Otherwise, the destination is the reachable tile closest to `to` by straight-line distance (compared as dx² + dy², with no square roots). Ties go to the shorter path, which is Peter's rule, then to the lower y, then the lower x, so the result is always deterministic.
- *Builder's interpretation, to confirm with Peter:* Peter said "nearest". Measuring it as straight-line distance (rather than Chebyshev distance, where a diagonal counts as 1) and breaking the final tie by y then x are my reading. Both are written into the brief and design summary as interpretations and listed under the report's design questions.
  - As far as I know, the community reimplementations of RuneScape's pathfinder also use dx² + dy², but only search within 10 tiles of the clicked tile. Here the search covers the whole map. The distance measure is one small function, so it's cheap to change.
- The result is `{ destination, path, reachedTarget }`. `path` lists the tiles to walk through, excluding the start. It is empty when you are already at the destination, and `reachedTarget` reports whether `to` itself was reached. "No path" is `reachedTarget: false`.
- *Builder's call:* among equally short paths, the walked path takes its diagonal steps first and then goes straight. Neighbour order in a forward BFS doesn't produce this reliably, so the path is built in two passes. The forward BFS picks the destination. A second BFS *from* the destination gives each tile's distance to it. The path then walks forward from the start, at each tile taking the step toward the destination in direction (sign dx, sign dy) if it brings the distance down by one, and otherwise the first such step in a fixed order. This works because step legality is symmetric: the corner rule checks the same two tiles in either direction. Tested.
- *Builder's call:* the search covers the whole grid. That's fine at 32×32, and a search bound will be needed for 64×64 regions and beyond. This is noted in the report.

**World state.** `{ tick, grid, characters }`. Each character has an id, a tile, and the path it is walking. All of this is plain data, so it can be compared and serialized.

**Intentions.** All three kinds are inputs to `step`, so a recorded sequence of them replays the whole world, including who joined when.
- `{ kind: 'move', characterId, target, subtick }`
- `{ kind: 'join', characterId, subtick }`
- `{ kind: 'leave', characterId, subtick }`

Clients send only `{ type: 'move', x, y }`. The server attaches the character id and the subtick, which is always 0 in Phase 0, so a client can't choose its own speed. The server creates `join` when a socket opens and `leave` when it closes.
- *Builder's call:* each character id is a positive integer the server assigns from a counter. Ids are never reused, are compared numerically, and there is no reconnect-resume in Phase 0. Closing a tab removes the square.
- *Builder's call:* a join is queued like any intention and applied at the next tick, so a new tab gets its welcome within about 250 ms.

**`step(state, intentions)`** is pure and returns a new state with `tick` increased by 1.
1. Apply joins and leaves.
   - A join spawns the character in this same `step`.
   - *Builder's call:* it spawns on the walkable tile closest to a fixed spawn point (in BFS order from that point) that has no other character on it. If every reachable tile is taken, it spawns on the spawn point itself. Sharing a tile is allowed, but spreading out makes two tabs easy to tell apart.
   - Messages carry only each character's current tile. The hover preview and the destination marker come from the client's own click.
2. Keep only the latest move intention per character, as the technical plan requires.
3. Order the moves by subtick, then character id.
4. For each move intention, replace that character's path with `findRoute` from its current tile.
5. Move every character one tile along its path. Re-check that the step is legal, and drop the path if it isn't.

As a result, a click mid-walk changes course on the very next tick.

## Server

- **Tick loop.** The tick count is derived from the start time: ticks due = floor((now − start) / 250). Each wake-up runs every tick that is due and then schedules the next boundary. Because nothing accumulates rounding error, there is no drift. The clock is monotonic (`performance.now()`, not `Date.now()`), so wall-clock changes can't cause bursts or stalls. The clock and scheduler are injectable for tests.
  - *Builder's call:* there is no catch-up cap in Phase 0. A long stall runs all missed ticks at once, and the report notes this.
- **Test map.** 32×32, written as rows of `.` and `#` in `packages/server`. It has walls, a closed room (to show nearest-reachable), and diagonal gaps (to show the no-corner-cutting rule).
- **WebSocket** on the same HTTP server, at path `/world`.
  - On connect, the server queues a `join`. After the tick that applies it, the client gets `welcome`, built from that tick's state: its id, the grid, every character and the tick number.
  - Every tick, all welcomed clients get `tick`: the tick number, `moved` (id, x, y), `joined` and `left`. A client ignores any `tick` at or before its welcome's tick.
- **What goes out.** Messages are built from an explicit view containing only id, x and y per character. The server never spreads or serializes `characters` directly, because a character's `path` reveals where its player is going (rule 6). There is nothing else hidden in Phase 0, so every client sees the same view.
- **Validation.** Any message that isn't JSON, isn't an object, has an unknown type, has non-integer or out-of-bounds coordinates, or exceeds a small size limit is ignored, and the connection stays open. A blocked target is valid; the nearest-reachable rule handles it.
- **Protocol** types and the pure message validator live in `shared`, so the server and client agree on them.

## Client

- PixiJS 8 draws the grid: blocked tiles darker, faint grid lines, your square gold and other squares blue.
- **Clicking a tile** sends a move.
- **Hovering** shows `findRoute` from your latest server position. It is the same function the server uses, so the preview matches; the server's path still counts. After a click, the destination tile is marked until you arrive.
- **Movement** uses the tween described above.
- **Tick pulse.** A subtle flash on each tick message, with its strength in one constant. `P` toggles it, and `?pulse=0` turns it off.
- The parts that can be unit-tested without a canvas are tested: interpolation maths, pulse timing, and handling of protocol messages.

## Tests

- **Pathfinding.** Finds a path; avoids blocked tiles; diagonal allowed when both side tiles are open and refused when either is blocked; walks to the nearest reachable tile when the target is blocked or walled off; tie on distance prefers the shorter path; reports `reachedTarget: false`; diagonal-first path shape.
- **Step.** Moves one tile per tick; a new intention replaces the path on the next tick; characters can share a tile; latest intention wins.
- **Determinism.** The same starting state and intention sequence, run through `step` twice, gives deep-equal results.
- **Purity guard.**
  - A scanner function checks every `.ts` file in `packages/shared` for `Math.random`, `Date.now` and `new Date`, and fails naming the file and line.
  - Comments are stripped with a small quote-aware stripper, not the `typescript` compiler API, which TypeScript 7 may not ship. A naive strip would let `'http://x'; Math.random()` through.
  - The scanner is itself unit-tested on fixture text: each pattern is caught, spacing variants like `Math . random` are caught, a mention inside a comment is ignored, and a call after a `//` inside a string is still caught. The guard's own test file must pass its own scan.
- **Tick loop.** The right number of steps over simulated time with irregular wake-ups; no drift over a simulated hour.
- **Server.** Two WebSocket clients join and see each other. A move produces one-tile-per-tick updates. Malformed messages are ignored and the connection survives. Client B's messages never contain client A's path or target.
- **Determinism** includes joins and leaves, since they are intentions.

## Feel report

- Measured with the Chrome tools on two tabs: click, re-click mid-walk, and a recorded GIF.
- The client logs tick-arrival intervals, and the report gives the jitter numbers.
- The tween duration is a named constant, since tween-on-arrival pauses briefly at each tile whenever a tick arrives late.
- The report separates what was measured from what Peter should judge by hand.

## Left to the builder

The exact map layout, colours and tile size, the module layout within each package, and the message field names beyond those above.
