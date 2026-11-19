# Technical plan

What gets built, how the pieces fit, and the rules that keep it manageable for a team of two. The order of work is in `implementation-plan.md`.

## Guiding rules

- **The server decides everything.** Browsers display the world and send intentions, never results.
- **Content is data, not code.**
- **Everything runs without graphics,** which is how balance gets tested.
- **Same seed, same world.** World generation and simulation are deterministic.
- **Tools before content.** Most balance questions can only be answered by running many simulated Epochs.

## Recommended stack

A starting point, to be confirmed with small tests.

| Part | Recommendation | Why |
| --- | --- | --- |
| Language | TypeScript everywhere | Rules written once, shared by browser, server, and tools |
| Rendering | PixiJS | Fast 2D rendering for pixel-art grids |
| Menus and interface | Plain HTML and CSS over the canvas | Simple and accessible |
| Server | Node.js | Same language as the client |
| Networking | WebSockets | Persistent two-way connection for a ticking world |
| Database | PostgreSQL | Accounts, imprints, feats, Chronicles, the Library (not needed until later) |
| Build and tests | Vite and Vitest | Fast builds and tests in one toolchain |
| Hosting | One rented server to start | Enough for a single world |

## The pieces

| Piece | What it does |
| --- | --- |
| Shared rules | Pure game logic: grid, pathfinding, combat, conditions, classes, crafting, world generation |
| Client | Draws the world, plays sound, reads input, smooths movement between ticks |
| World server | Runs the tick loop for everything near players, talks to clients |
| Simulation | Runs the macro tick: kingdoms, research, distant armies, threats, planned events |
| Storage | Accounts and meta-progress permanently; the current Epoch as snapshots |
| Content | Data files, with a checker that rejects mistakes |
| Tools | Headless runner, history viewer, map replay, dashboards, director console, batch reports |

## What happens every tick

1. Collect each player's latest intention; discard older ones.
2. Order actions by subtick, so faster characters act first.
3. Resolve movement, one tile per step, checking for blocked tiles.
4. Advance channeled abilities and telegraphs by one tick; fire the ones that finish.
5. Apply damage, wounds, and conditions.
6. Let nearby NPCs and enemies choose their next action.
7. Record anything notable to the event log, which later feeds rumors, echoes, and the Chronicle.
8. Send each client only what changed within its view.

## Networking

- Clients send intentions: move to this tile, use this ability on that target.
- The server sends changes once per tick, limited to what each player can see.
- Hidden things, such as ghosts, secret doors, and what's behind walls, are never sent to a client that shouldn't see them.
- The client slides characters between ticks so the steps never show.
- Reconnecting restores the player's view from the server's state.

## World size and regions

At walking speed (2 tiles a second, about 1 m a tile), a character covers 120 tiles a minute, so a 30-to-60-minute crossing means a world roughly 3,600 to 7,200 tiles across. That's very large, and movement speed may be tuned. Running and riding are faster, so those crossings are shorter. The world is cut into regions of 64 by 64 tiles, each loaded and simulated independently. Unvisited regions exist only as a seed and statistics until someone arrives.

## Simulation detail by distance

| Tier | Where | How it's simulated | How often |
| --- | --- | --- | --- |
| Present | Around each player | Every creature and NPC as individuals | Every tick |
| Local | The rest of a player's region | Individuals, simplified behavior | Every few seconds |
| Regional | Regions near activity | Important NPCs individually; armies and hordes as units | Every macro tick |
| Distant | Everywhere else | Settlements and kingdoms as statistics | Every macro tick |

Regions turn from statistics into individuals when a player arrives, generated from the region's seed so they match its history, and fold back when everyone leaves.

## World generation

Once at the start of each Epoch, in order: terrain, water, climate and biomes, ley lines, resources, settlements, kingdoms and cultures, structures, planned events and bosses, then a short pre-simulation so the world has some history at opening.

## Stored data

| Kept forever | Kept for one Epoch |
| --- | --- |
| Accounts and friends lists | The world's seed and everything changed since generation |
| Feats, imprints, facets | Characters, classes, items, wounds |
| Remembered classes and mastery | Kingdoms, research, threats |
| Every past Chronicle | The event log |
| The Library | Ghosts and the Veil |
| Completed Anchors | Anchor progress |

The current Epoch is saved as a full snapshot every few minutes, plus a log of events since, so a crash loses seconds.

## The weekly pipeline

During the Sunday 2:00 to 3:00 a.m. maintenance hour: freeze the world, build each player's Chronicle, award feats and imprints, save completed Anchors and Library changes, roll the new world, and pre-simulate its opening.

## Security

- Every input is checked against the rules on the server.
- Rate limits on actions and messages.
- Hidden information is never sent to clients.
- Standard account protection when accounts exist.

## Testing

| Kind | What it checks |
| --- | --- |
| Rule tests | Each rule does what the design says |
| Replay tests | The same seed and inputs always give the same world |
| Batch runs | Hundreds of headless Epochs, checking how often things happen |
| Bot players | Load, and whole weeks at high speed |
| Compressed Epochs | A full Epoch in a couple of hours, for playtesting |
