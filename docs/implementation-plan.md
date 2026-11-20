# Implementation plan

The order of work, phase by phase. Each phase ends with something playable or runnable, and a gate that must pass before the next phase begins.

## How we work

- **Roles.** Claude writes code, designs systems, and drafts content. Peter plays, decides, tunes by feel, hosts the server, and moderates.
- **Small steps.** Every working session ends with something that runs.
- **Placeholders everywhere.** Nothing waits on final art, sound, or writing.
- **Cut freely.** Each phase uses only a small slice of the full design.

## Phase 0: Foundations

| Milestone | What gets built | Done when |
| --- | --- | --- |
| 0.1 Project setup | The project, build tools, tests, and shared rules package | A blank page loads from a local server |
| 0.2 A ticking grid | A server ticking every 0.25 seconds and a browser showing a grid and a moving square | Clicking moves the square one tile per tick, smoothly |
| 0.3 Content checker | Data formats for a class, an ability, an item, and an enemy, with a checker | A broken file is rejected with a clear message |

Details in `phase-0-brief.md`.

## Phase 1: Paper design

Write down just enough to build the scope below: the 12 classes in full, enemy growth rules, the first feats and imprints, the first version of the lore, and an art style test.

**Gate:** the core rules are written down clearly enough to build from.

## Phase 2: Combat prototype

**The question:** does tick combat feel good? Deliberately tiny and deliberately ugly: placeholder art, no story.

| Area | In scope |
| --- | --- |
| Place | One arena |
| Character | One, with all five attributes and level-ups |
| Classes | Militia, Hunter, Hedge Witch |
| Enemies | Slimes and goblins, three tiers each |
| Boss | The Clockwork Colossus, a puzzle boss |
| Combat rules | Force, Precision, and Arcane damage; 4 conditions; bleeding, poison, fracture |

| Milestone | What gets built | Done when |
| --- | --- | --- |
| 2.1 Fighting basics | The arena, health, levels, attributes, the damage formula, weapons and armor, attack-move, death and recap, a debug panel | You can fight a training dummy and a slime, die, and read why |
| 2.2 Abilities and classes | The action model, ability shapes, telegraphs, five slots, the campfire loadout, mana, the three classes | Each class plays, two combine, every telegraph is readable |
| 2.3 Conditions, wounds, and items | Wet, Burning, Chilled, Stunned; bleeding, poison, fracture; bandages and shuffled potions | Douse then Chill freezes; wounds follow their thresholds |
| 2.4 Enemies | Slimes that merge, goblins that learn, simple AI, waves 1 to 4, experience | Slimes merge, goblins flee and learn |
| 2.5 A puzzle boss | The Clockwork Colossus, the plaque, wave 5 | It falls to both straight fighting and the jam loop |

The milestones follow `docs/phase-2-brief.md`, which replaced the earlier outline.

**Gate:** a tick-based fight feels fluid and fair.

## Phase 3: Headless world simulation

**The question:** does history come out interesting? The simulation generates most of the world's content, so how well it scales is the real test of whether two people can build this game.

| Area | In scope |
| --- | --- |
| World | One region with 3 to 4 kingdoms of one culture |
| Research | War, Agriculture, and Communication, eras I to III |
| Enemies | Slimes, goblins, wolves, bandits |
| Events | Flood, plague, blood moon |
| Tools | History log, map replay, batch reports |

**Gate:** simulated history is interesting to read, and frequencies match their targets.

## Phase 4: A single-player Epoch

**The question:** is a whole week fun alone?

| Area | In scope |
| --- | --- |
| World | One region, 10 to 15 minutes to cross, 2 to 3 kingdoms, the Old Crown culture |
| Classes | Farmer, Cook, Apprentice Smith, Hunter, Militia, Scribe; Warrior, Archer, Baker, Blacksmith, Mage; Battle Mage |
| Enemies | Slimes, goblins, wolves, bandits, undead, the demon king's brood on day 7 |
| Bosses | The Clockwork Colossus and one more |
| Gods | Brannagh, Vael, Morwen |
| Minigames | The Kitchen, the Forge, fishing |
| Places | Village, town, castle, cave, deepening dungeon, ancient ruins, goblin warren, graveyard, roadside inn, waystone |
| Birth | Common and uncommon origins, a small poem vocabulary |
| Metaprogression | About 20 feats, 10 imprints, the first two milestones |
| Death | Ghosts with echoes, whispers, a few abilities |
| Society | Witnesses, notoriety, guards; idle cooking and training |
| Events | The day-1 roll, 3 planned events, 2 limited-time events |
| Anchor | A simplified Great Bastion, with simulated players |

**Left out on purpose:** multiplayer, the Library, most classes, most magic, faith classes, titles, research past era III, lore beyond chapter 1, other cultures.

**Gate:** a full week is fun alone.

## Phase 5: Multiplayer

Accounts, sending each player only what they can see, chat and friends, player conflict and law, titles, the real weekly reset, moderation tools, and closed tests with real players and bots.

**Gate:** a real week with real players runs smoothly.

## Phase 6: Expansion

Content arrives in waves: more classes, enemies, and places; magic in depth; gods and faith; the Library; more cultures; the remaining Anchors; and finally the endgame.

## Biggest risks

| Risk | How we handle it |
| --- | --- |
| The scope is enormous | Each phase uses a small slice; expansion only after the core is fun |
| The simulation is hard to balance | Tools and batch runs come early |
| Tick combat may not feel good | It's the first thing built and tested |
| Multiplayer is the hardest engineering | It comes after everything works alone, on a server-run design from the start |
| Art and audio take longer than code | Placeholders throughout |
