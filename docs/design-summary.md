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

- Click-to-move on a tile grid. The server finds the path; characters move one tile per tick at base speed.
- A new click replaces the path on the next tick. Hovering shows the planned path.
- Movement is in 8 directions. A diagonal step takes one tick, like any other step. *(Peter, 2026-11-19.)*
- A diagonal step is only allowed when both tiles you'd pass between are walkable, as in Old School RuneScape. No cutting corners. *(Peter, 2026-11-19.)*
- Clicking a blocked or unreachable tile walks you to the nearest reachable tile, like RuneScape. If two are equally near, the one with the shorter path wins. The hover preview shows the same path. *(Peter, 2026-11-19.)*
- Players pass through each other and can share tiles. Enemy collision is decided in Phase 2. *(Peter, 2026-11-19.)*
- *Builder's interpretation, to confirm with Peter:* "nearest" is straight-line distance (dx² + dy²), and any remaining tie goes to the lower y, then the lower x.
- Attack-move, like League of Legends, comes later.
- Movement speed is a stat: faster characters act on earlier subticks.

## Technology

- PixiJS 8 draws the client; the server talks to browsers over WebSockets with the `ws` library. *(Peter, 2026-11-19.)*

## Combat (later phases)

- **Perfect accuracy.** Attacks never miss by chance. If you're in a telegraphed area, you're hit; if you moved out, you're not. Damage has only a small random spread.
- **Telegraphs.** Big attacks wind up over 0.5 to 1.5 seconds, shown clearly on the grid. Some bosses hide their telegraphs as puzzles.
- **Damage kinds:** Force, Precision, Arcane, Holy. Weapons split their damage across one or two kinds. Enemies resist or are weak to kinds.
- **Armor** reduces damage, but never below a small minimum.
- **Up to 5 ability slots** and 1 or 2 item slots, rearranged only at rest stops.
- **Wounds** last: bleeding, poison, fractures, lost limbs, curses, and more.
- **No stamina.** Casters use mana; fighters use no resource.

## Characters

- **Level 1 to 50,** from experience scaled by danger and difficulty. Each level gives one attribute point, placed immediately, and a small rise in most stats.
- **Five attributes:** Might, Finesse, Vigor, Wits, Spirit. Each boosts its damage kind (Vigor has none) and does things beyond damage. Points cost more past 20 and 30.
- **Classes** in four tiers (capacity cost 1, 2, 3, 5), equipped within class capacity that grows with level. Swapped at rest stops.
- **Gear** has a damage split, quality, and low attribute requirements.

## Content is data

Everything game-specific is a data file: classes, abilities, items, enemies, structures, events, feats, imprints. The engine reads them; adding content never means changing code.

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
