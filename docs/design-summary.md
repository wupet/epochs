# Design summary

A short version of the design, focused on what affects code. The full design lives in Peter's design doc on claude.ai.

## The game in one paragraph

Epochs is a free, web-based, computer-only fantasy RPG. Up to 100 players share one huge world. Each week is an Epoch: the world is generated fresh, simulated for about 168 in-game years (one real hour is one in-game year), and then ends at Sunday 2:00 a.m. Players are born into the world through a random birth, earn classes through great deeds, and grow from villagers into heroes, while the world itself escalates toward the demon king's arrival on day 7. Death is final for the Epoch. What carries over is knowledge, remembered classes and their mastery, feats, and soul imprints. The whole server works together on 8 Anchors, great works that persist across worlds.

## Pillars that shape the code

- **Skill first.** Difficulty comes from decisions and preparation, not reflexes or luck.
- **A living world.** It keeps moving without players: kingdoms, research, threats, and NPCs all simulated.
- **Knowledge is power.** Fixed rules underneath, re-rolled worlds on top. Players learn the rules across Epochs.
- **Small and significant.** Players start weaker than a town guard and can grow into legendary heroes.

## Time

| Clock | Rate | Use |
| --- | --- | --- |
| Subtick | 25 ms, 10 per tick | Ordering actions by speed |
| Tick | 250 ms | Movement, combat, everything near players |
| Macro tick | 1 real minute | World simulation: research, kingdoms, distant armies |

- The tick is invisible to players: characters move smoothly between ticks.
- Time never pauses, including in combat.
- An Epoch runs from Sunday 3:00 a.m. to the following Sunday 2:00 a.m., with an hour of maintenance between.

## Movement

- Click-to-move on a tile grid. The server finds the path. Walking is 2 tiles per second (one tile every 2 ticks); run is 4 and horse is 8. A tile is about one metre. *(Peter, 2026-11-19.)*
- Speeds are fractional: a step can take a fractional number of ticks, built up over time. A character may move up to 2 tiles in one tick, for fast travel later. *(Peter, 2026-11-19.)*
- The 1, 2 and 3 keys that switch between walk, run and horse are **debug controls**, for testing feel only. Running and riding get real rules later. *(Peter, 2026-11-19.)*
- No free steps: while a character stands still, the movement it banks is capped at one tick's worth at its current speed (never less than one step, so a rested walker still steps on the next tick). Every speed therefore sets off at full pace, a rested rider moving 2 tiles on its first tick, and repeated clicks never beat normal pace. This replaces the earlier cap of one full step. *(Peter, 2026-11-19.)*
- A new click replaces the path on the next tick. Hovering shows the planned path.
- Movement is in 8 directions. A diagonal step takes the same time as any other step. *(Peter, 2026-11-19.)*
- A diagonal step is only allowed when both tiles you'd pass between are walkable, as in Old School RuneScape. No cutting corners. *(Peter, 2026-11-19.)*
- Clicking a blocked or unreachable tile walks you to the nearest reachable tile, like RuneScape. A diagonal tile counts as 1 step away. If two are equally near, the one with the shorter path wins, then the lower y, then the lower x. The hover preview shows the same path. *(Peter, 2026-11-19; the last two tie-breaks are approved builder's calls.)*
- The nearest-tile search covers 16 tiles around the click, about one screen. If nothing reachable is in range, the character stays put. *(Peter, 2026-11-19.)*
- Among equally short paths, the one closest to the straight line from start to end wins. *(Peter, 2026-11-19.)*
- A full server (100 players) puts the next player in a queue that shows their position. *(Peter, 2026-11-19.)*
- Players pass through each other and can share tiles. *(Peter, 2026-11-19.)*
- Enemies block movement: every character treats an enemy's tile as blocked, and enemies can't enter a player's tile either. *(Peter, 2026-11-19 and 2026-11-20, for Phase 2.)*
- Attack-move, like League of Legends, comes later.
- Movement speed is a stat: faster characters act on earlier subticks.

## Technology

- PixiJS 8 draws the client; the server talks to browsers over WebSockets with the `ws` library. *(Peter, 2026-11-19.)*

## Combat (later phases)

- **Perfect accuracy.** Attacks never miss by chance. If you're in a telegraphed area, you're hit; if you moved out, you're not. Damage has only a small random spread.
- **Telegraphs.** Big attacks wind up over 0.5 to 1.5 seconds, shown clearly on the grid. Some bosses hide their telegraphs as puzzles.
- **Windups and dodging.** A 1-tick windup is close-range pressure, avoided by positioning, not reaction: at walking pace, whether you can step out depends on your stride. Any attack meant to be dodged by reacting needs a windup of at least 2 ticks. *(Peter, 2026-11-20.)*
- **Damage kinds:** Force, Precision, Arcane, Holy. Weapons split their damage across one or two kinds. Enemies resist or are weak to kinds.
- **Damage** *(Peter, 2026-11-20)*: each kind in a hit gets its bonuses (attribute, level, one spread roll per hit), is multiplied by the target's resistance to that kind, and the kinds are added. Flat armor is subtracted once, but at least 10% of the hit after resistances gets through. Round once, minimum 1, unless the target is immune to every kind in the hit, which does 0.
- **Resistance** is a multiplier per kind, from what the target is and from its gear: 0.5 halves, 1.25 is a weakness, 0 is immunity. No cap, so immunities are possible but rare. *(Peter, 2026-11-20.)*
- **Damage numbers are shown.** Working out resistances by watching them is knowledge players earn. *(Peter, 2026-11-20.)*
- **Up to 5 ability slots** and 1 or 2 item slots, rearranged only at rest stops.
- **Wounds** last: bleeding, poison, fractures, lost limbs, curses, and more.
- **No stamina.** Casters use mana; fighters use no resource.
- **Enemy targeting:** an enemy targets whoever damaged it most recently, otherwise the nearest player. A player who dies is forgotten. The Phase 2 enemy AI is a placeholder, kept easy to replace. *(Peter, 2026-11-19 and 2026-11-20, for Phase 2.)*

## Characters

- **Level 1 to 50,** from experience scaled by danger and difficulty. Each level gives one attribute point, placed immediately, and a small rise in most stats.
- **Five attributes:** Might, Finesse, Vigor, Wits, Spirit. Each boosts its damage kind (Vigor has none) and does things beyond damage. Points cost more past 20 and 30.
- **Classes** in four tiers (capacity cost 1, 2, 3, 5), equipped within class capacity that grows with level. Swapped at rest stops.
- Each class has a capstone: a bonus at full mastery. *(Peter, 2026-11-19.)*
- A class's capacity cost is fixed by its tier: beginner 1, intermediate 2, advanced 3, expert 5. The content checker enforces it. *(Peter, 2026-11-19.)*
- **Gear** has a damage split, quality, and low attribute requirements.

## Content is data

Everything game-specific is a data file: classes, abilities, items, enemies, structures, events, feats, imprints. The engine reads them; adding content never means changing code.

- Conditions and signature passives become their own content files in Phase 1. *(Peter, 2026-11-19.)*
- Ids and fixed choices are lowercase with hyphens, such as `rusty-shortsword` and `holy-relic`. *(Peter, 2026-11-19.)*
- Damage amounts are whole numbers of at least 1. Resistance multipliers are 0 or more (below 1 resists, above 1 is a weakness, 0 is immunity); the checker warns about any outside 0.25 to 3, including 0, so immunities are always deliberate. *(Peter, 2026-11-19 and 2026-11-20.)*

## What resets each Epoch

| Resets | Persists |
| --- | --- |
| The world, characters, levels, attributes, items, gold, titles | Accounts, feats, imprints, remembered classes and mastery, the Library, completed Anchors, past Chronicles |

## Glossary

- **Epoch:** one weekly world.
- **Tick, subtick, macro tick:** the three clocks above.
- **Region:** a 64 by 64 tile area, loaded and simulated independently.
- **Intention:** what a client asks to do. The server decides what actually happens.
- **Rest stop:** a camp, inn, or shrine, where classes and ability slots can be changed.
- **The Renewal:** once per Epoch, redo your attribute points and imprints.
- **Imprints and facets:** cross-Epoch bonuses set into facets of the soul.
- **The Veil:** where dead players continue as ghosts.
- **Anchors:** 8 server-wide great works that persist across Epochs.
