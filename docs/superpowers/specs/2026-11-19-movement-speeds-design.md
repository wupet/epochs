# Milestone 0.2.1: Movement speeds (design)

Approved by Peter on 2026-11-19. These are follow-ups to milestone 0.2, decided after playing it. The 0.2 design (`2026-11-19-ticking-grid-design.md`) still holds except where this changes it.

## Peter's decisions (2026-11-19)

1. **Nearest.** When the clicked tile can't be reached, "nearest" counts a diagonal tile as 1 step away (Chebyshev distance). Ties go to the shorter path, then lower y, then lower x (the last two were approved builder's calls).
2. **Path shape.** Among equally short paths, take the one closest to the straight line between start and end. This replaces diagonal-first, which made curves where a straight line would do.
3. **Spawning** on the nearest free tile is fine.
4. **Search range.** The nearest-tile search is limited to roughly one screen around the click.
5. **Stalls.** After a stall, catch up at most about one second of ticks, skip the rest, and log it.
6. **A full server.** The 101st player waits in a queue that shows their position.
7. **Retry-forever.** The tick that retries forever is fixed first thing in 0.3, not here.
8. **Tick.** It stays at 250 ms.
9. **Speeds.**
   - Walking is one tile every 2 ticks (2 tiles/s).
   - Any speed is supported by letting steps take a fractional number of ticks, built up over time.
   - Moving 2 tiles in one tick is allowed, for fast travel later.
   - A tile is about one metre.
10. **Debug speed keys.** Keys switch between walk (2 tiles/s), run (4 tiles/s) and horse (8 tiles/s). **These are debug controls**, marked as such in the docs and the code. Running and riding get real rules later; this is only for testing feel.
11. **Zoom.** Keys zoom in and out.
12. **Pulse.** The tick pulse is off by default.
13. **No free steps.** *(Updated 2026-11-19 after playtesting.)* While a character stands still, their progress builds up toward a step but is capped at one tick's worth at the current speed, but never less than one step, so a rested walker still steps on the next tick. Every speed therefore sets off at full pace (a rested rider moves 2 tiles on the first tick), and repeated clicks can never beat their normal pace. There is a test for spam-clicking at every speed. *(Peter, 2026-11-19; this replaces the original cap of one full step. The wording "one tick's worth, never less than one step" is the controller's reading.)*

## Approved builder's calls

- **Slide length follows speed.** Each slide is timed from the character's speed (500 ms per tile when walking), so walking doesn't stop and start. Messages carry each character's speed; that isn't hidden, since anyone can see how fast someone moves.
- **Two steps in one tick.** When a character moves 2 tiles in a tick, the message carries the tile passed through, so the slide follows the path instead of cutting across a corner.
- **Zoom keys.** `+` (or `=`) zooms in and `-` zooms out. The default fits the whole map. When zoomed in, the camera follows your square and stops at the map edges.
- **Pulse.** `P` turns it on, and `?pulse=1` starts with it on.

## Rules, precisely

**Speed** is a whole number of thousandths of a tile per tick (*millitiles*), so all the arithmetic stays exact and deterministic.
- `STEP = 1000` millitiles makes one tile.
- The debug modes are walk = 500, run = 1000 and horse = 2000.
- `MAX_STEPS_PER_TICK = 2`, and speeds above 2000 are not allowed.
- Every character starts walking, with `progress = max(STEP, DEFAULT_SPEED)` (= `STEP`): rested, so it can step on the next tick.

**Movement each tick**, per character, after routes are set:
1. While the character has a path, `progress >= STEP` and fewer than 2 steps have been taken this tick:
   - if the next tile is a legal step, take it and subtract `STEP`;
   - otherwise clear the path and stop.
2. Add `speed` to `progress`.
3. If the path is now empty, cap `progress` at `max(STEP, speed)`, using the character's speed after this tick's mode change: one tick's worth at the current speed, but never less than one step, so a rested walker still steps on the next tick. *(Updated 2026-11-19 after playtesting; this was `STEP`.)*

This means:
- A rested walker steps on the next tick, then every 2 ticks.
- A runner steps every tick.
- A rested rider steps 2 tiles every tick, from the first. *(Updated 2026-11-19; it used to take one step on the first tick.)*
- A speed of 750 steps on 3 ticks out of every 4.
- Changing course keeps the built-up progress.
- Spam-clicking can't beat the pace: progress never exceeds `max(STEP, speed)` while standing still (the most it could earn in a tick), and a step always costs a full step of progress.

**Steps taken.** The character records the tiles it entered this tick, as `stepped` (plain data). The tick message uses it so clients can slide through the tile passed on.

**A debug mode change** is an intention: `{ kind: 'mode', characterId, mode: 'walk' | 'run' | 'horse', subtick }`. It is applied after joins and leaves and before moves. It changes `speed` but not `progress`.

**Nearest and search range.**
- `nearness(a, b) = max(|dx|, |dy|)`.
- If the target can't be reached, the destination is the reachable tile with the smallest (nearness, steps, y, x), considering only tiles within `NEAREST_SEARCH_RADIUS = 16` tiles of the click (Chebyshev). That is about one screen at the default zoom.
- If no reachable tile is in range, the character stays put: an empty path, `reachedTarget: false`, and the destination is the start.

**Path shape.**
- Among the shortest paths from start `s` to destination `e`, take the one with the smallest total deviation, summed over every tile on the path.
- A tile `p`'s deviation is `|(p.x − s.x)(e.y − s.y) − (p.y − s.y)(e.x − s.x)|`. That is its distance from the straight line, scaled, as a whole number.
- It is computed exactly with dynamic programming over the shortest-path graph that the reverse search already gives. Remaining ties go to the first step in `STEP_DIRECTIONS` order.

**Catching up after a stall.** The tick loop runs at most `MAX_CATCH_UP_TICKS = 4` ticks per wake-up. If more are due, the extra ones are skipped (the tick count jumps forward), the server logs how many, and the loop stays drift-free from then on.

**The queue.**
- The server admits at most `MAX_PLAYERS = 100` characters. It is an option, so tests can use a small cap.
- Anyone beyond that waits in a first-come queue and receives `{ type: 'queue', position }`, 1-based, again whenever their position changes.
- When a player leaves, the first in line gets an id and a join.
- The page shows "In queue: position N".

**Protocol changes.**
- A character view is `{ id, x, y, speed }`.
- A `moved` entry adds `via`: the tiles passed through this tick before the final one, empty for a single step.
- Clients may also send `{ type: 'mode', mode }` (debug), with exactly those keys and a valid mode.
- The server may also send `queue`.

**Client.**
- **Slides:** the slide time per tile is `TICK_MS × STEP / speed`. A slide goes from the current drawn position through `via` to the new tile, spending that long on each segment.
- **Debug keys:** `1` walk, `2` run, `3` horse. They are labelled as debug in the code and the status line.
- **Zoom:** tile sizes 12, 16, 20, 24, 32, 40, 48 and 64 px, with the default fitting the whole map. The camera centres on your drawn square, clamped to the map. Pointer-to-tile conversion uses the same layout, so hover and clicks stay exact.
- **Pulse:** off by default.

## Docs to update

Record the decisions, dated, in `docs/phase-0-brief.md` and `docs/design-summary.md`, marking the speed keys as debug. Also fix the docs that say "one tile per tick at base speed": CLAUDE.md "Key numbers", the design summary, and the technical plan's world-size note.

## Tests

- **Route:** Chebyshev nearest with all three tie levels; the search radius (one tile in range is used, out of range stays put); the straight-line path shape on fixed fixtures.
- **Movement:**
  - walk, run, horse and 750 step patterns;
  - first step after a rest;
  - spam-clicking between two adjacent tiles for 40 ticks at walk speed gives at most 21 steps;
  - a mode change;
  - `stepped` and `via`;
  - determinism including mode changes.
- **Protocol:** speed in views; `via`; mode-message validation; no hidden fields.
- **Server:** the catch-up cap; the queue with a cap of 2 (positions, admission when a slot frees, a queued socket leaving); mode messages.
- **Client:** polyline slides at each speed; `via`; pulse off by default; the zoom and camera layout maths, including pointer-to-tile.
