# Phase 2 brief: Combat prototype

Phase 2 answers one question: **does tick combat feel good?** It builds one arena, one player character, three beginner classes, two enemy families, and one puzzle boss.

The prototype stays deliberately ugly: simple shapes, no story, no real art. Every number below is a starting value to be tuned by playtesting. Put numbers in content files or clearly named constants, never buried in logic, so they're easy to change.

Work on one branch per milestone, as in Phase 0. Write a report in `docs/reports/` after each milestone, and wait for Peter's approval before merging.

## Principles for this phase

- **All rules live in `packages/shared`** and stay pure and deterministic. Randomness (the damage spread, potion colors) comes from a seeded generator.
- **Content is data.** Classes, abilities, passives, capstones, conditions, items, enemies, and waves are content files, checked by `npm run check-content`. Engine behaviors, like slime merging, goblin learning, and the boss's states, are code, but their numbers come from data. Signature passives and conditions become their own content files, as decided in 0.3.
- **The server decides everything.** The client draws telegraphs from what the server sends.
- **Some things are hidden on purpose.** Don't show the Colossus's jam window or slime cores with special markers. Players have to work them out.

## Milestones

### 2.1 Fighting basics

- A 24 by 24 arena with pillars and a campfire. The campfire is the rest stop.
- Health, levels 1 to 10, the five attributes, and the damage formula (below).
- Weapons with basic attacks. Click an enemy to attack it; attack-move with **A** then click.
- Armor.
- Dying respawns you at the campfire, with a short death recap: what hit you, how much, and which telegraph you were standing in.
- A debug panel: pick a class preset, set level and class ranks, and start any wave.

**Done when:** you can walk up to a training dummy and a slime, attack them, take damage, die, and read a recap explaining why.

### 2.2 Abilities and classes

- The action model: one action per tick. Abilities have a windup (telegraphed, cancelled by moving or being stunned), resolve on the last windup tick, then a cooldown.
- Ability shapes: single tile, line, the three tiles in front, burst, area, self.
- Telegraphs: affected tiles fill in progressively over the windup, outlined in the damage kind's color.
- Five ability slots on keys 1 to 5. The debug speed keys move to different keys.
- The campfire loadout screen: equip classes within class capacity, and choose which abilities fill the five slots.
- Mana for the Hedge Witch.
- The three classes (below), with passives, ranks, and capstones.

**Done when:** each class can be played, two can be equipped together, and every ability's telegraph is readable.

### 2.3 Conditions, wounds, and items

- Four conditions and their interactions: Wet, Burning, Chilled, Stunned.
- Three wounds: Bleeding, Poison, Fracture.
- Bandages, and three potions whose colors are shuffled every run from the seed.
- A minimal inventory.

**Done when:** Douse then Chill freezes a target, wounds follow their thresholds exactly, and the potions' colors change between runs.

### 2.4 Enemies

- Slimes in three tiers: merging, cores, and being healed while wet.
- Goblins: the goblin, slinger, veteran, and chieftain, with morale, Rally, and learning during the fight.
- Simple AI: approach, attack, keep distance, flee.
- Waves 1 to 4, and experience.

**Done when:** slimes visibly merge, goblins flee when their chieftain dies, and goblins avoid traps after seeing them work.

### 2.5 The Clockwork Colossus

- The boss as a state machine, with its states and transitions in data.
- The gear-diagram plaque on the arena wall.
- Wave 5.

**Done when:** the boss can be beaten both by fighting it straight and by using the jam loop, and the plaque is in the arena.

### Playtest report

After 2.5, write a report answering:

1. Are fights readable: can you see what's coming and react?
2. Do decisions matter more than speed?
3. Does each class feel different?
4. Do two equipped classes combine in interesting ways?
5. Are slime merging, goblin learning, and the freeze combo noticeable without being explained?
6. Is the Colossus's trick discoverable from the plaque?
7. Are fights the right length and difficulty?
8. Does the 0.25-second tick feel fair in combat?

Peter answers most of these by playing.

## The design

### Character numbers

| Stat | Starting formula |
| --- | --- |
| Health | 30, plus 5 per level after 1, plus 3 per point of Vigor |
| Mana (Hedge Witch only) | 15, plus 2 per point of Wits, plus 3 per Hedge Witch rank. Refills 1 point every 2 ticks |
| Attributes | 1 in each, plus 4 birth points from a debug preset per class |
| Levels | 1 to 10. One attribute point per level, placed immediately |
| Class capacity | 2 at level 1, so two of the three beginner classes can be equipped together |

### Damage

For each damage kind an attack carries:

1. Start from the base amount.
2. Add 4% per point of the matching attribute: Might for Force, Finesse for Precision, Wits for Arcane.
3. Add 2% per level.
4. Apply a spread of up to 10% either way, from the seeded generator.
5. Multiply by the target's resistance to that kind.
6. Subtract the target's armor, but at least 20% of the damage always gets through.

Round to whole numbers, minimum 1. Only Force, Precision, and Arcane are in this phase.

Accuracy is perfect: there are no hit rolls. Whatever stands in an ability's area when it resolves is hit. Melee basic attacks hit whatever is adjacent at resolve; ranged attacks need a clear line of sight, and blocked tiles block it.

### Weapons and items

| Item | Damage | Speed | Notes |
| --- | --- | --- | --- |
| Rusty shortsword | Force 4, Precision 2 | Every 4 ticks | Melee |
| Cudgel | Force 6 | Every 5 ticks | Melee |
| Hunting bow | Precision 5 | Every 5 ticks | Range 6, needs line of sight |
| Witch's staff | Arcane 3 | Every 5 ticks | Range 4; costs no mana |
| Leather jerkin | Armor 2 | | |
| Bandage | | 4-tick channel | Stops bleeding |
| Three potions | | 1 tick to drink | Healing, cure poison, and one that sets you Burning. Colors shuffled every run |

### Conditions

| Condition | Effect | Lasts | Interactions |
| --- | --- | --- | --- |
| Wet | None on its own | 12 ticks | Puts out Burning. Wet and Chilled together freeze the target: Stunned for 3 ticks. Slimes are healed 1 per tick while wet |
| Burning | 2 damage per tick, ignoring armor | 8 ticks | Ended by Wet. Slimes take double |
| Chilled | Every step and windup takes 1 extra tick | 8 ticks | With Wet, freezes the target |
| Stunned | No actions; cancels any windup | Varies | |

### Wounds

Wounds follow fixed thresholds, never chance.

| Wound | Caused by | Effect | Ends |
| --- | --- | --- | --- |
| Bleeding | A Precision hit of 6 or more | 1 damage every 2 ticks | A bandage, or after 40 ticks |
| Poison | Goblin slingers' poisoned stones | 1 damage per tick for 16 ticks; healing is halved | The cure-poison potion, or time |
| Fracture | A Force hit of 15 or more | Walking takes 3 ticks per tile, and basic attacks take 1 tick longer | Resting at the campfire for 20 ticks |

### Classes

Every class has exactly six active abilities at full mastery. Beginner classes start with four and gain one at rank 2 and one at rank 3. Each has a signature passive that grows with rank, and a capstone at full mastery. With two classes equipped, a player has eight abilities to choose from for five slots.

**Militia**

- **Passive, Hold the Line:** after standing still for 2 ticks, take 15% less damage; 20% at rank 2, 25% at rank 3.
- **Shield Bash** (start): 1-tick windup, one adjacent tile, Force 6. Pushes the target back a tile and cancels its windup. Cooldown 12 ticks.
- **Brace** (start): instant. For 4 ticks, take half damage and can't be pushed. Cooldown 20 ticks.
- **Sweep** (start): 2-tick windup, the three tiles in front, Force 5. Cooldown 10 ticks.
- **Spear Thrust** (start): 2-tick windup, a line 2 tiles long, Precision 7. Cooldown 10 ticks.
- **Stand Fast** (rank 2): for 8 ticks, Hold the Line works even while moving. Cooldown 40 ticks.
- **Second Wind** (rank 3): heal 20% of health, once per fight.
- **Capstone, Unbreakable Gate:** the first time each fight you fall below a quarter of your health, Brace triggers on its own.

**Hunter**

- **Passive, Study the Prey:** inspecting an enemy reveals its resistances, and you deal 10% more damage to enemy types you've inspected; 15% at rank 2, 20% at rank 3.
- **Aimed Shot** (start): 2-tick windup, one target in range 6, Precision 10. Cooldown 8 ticks.
- **Snare Trap** (start): set on an adjacent tile; arms after 2 ticks. The first enemy to step on it is held in place for 4 ticks and takes Precision 3. At most 2 traps. Cooldown 16 ticks.
- **Quick Shot** (start): no windup, one target in range 6, Precision 4. Cooldown 4 ticks.
- **Double Shot** (start): 2-tick windup, two different targets in range 6, Precision 6 each. Cooldown 12 ticks.
- **Retreat Step** (rank 2): move 2 tiles away immediately. Cooldown 20 ticks.
- **Bait** (rank 3): throw meat that draws mindless and instinctive enemies to it for 8 ticks. Cooldown 30 ticks.
- **Capstone, Read the Wild:** beasts' and slimes' telegraphs appear to you one tick earlier.

**Hedge Witch**

- **Passive, Folk Charms:** conditions you cause last 2 ticks longer; 3 at rank 2, 4 at rank 3.
- **Douse** (start): 1-tick windup, a 3-by-3 area within range 4, Arcane 2, makes targets Wet. 4 mana, cooldown 6 ticks.
- **Chill** (start): 2-tick windup, one target within range 5, Arcane 4, makes it Chilled. 6 mana, cooldown 8 ticks.
- **Ember** (start): 2-tick windup, one target within range 5, Arcane 6, sets it Burning. 8 mana, cooldown 10 ticks.
- **Ward** (start): instant, absorbs the next 15 damage within 8 ticks. 8 mana, cooldown 24 ticks.
- **Wisp** (rank 2): summon a light that draws mindless enemies to it for 8 ticks. 10 mana, cooldown 30 ticks.
- **Nettle Patch** (rank 3): a 2-by-2 area for 12 ticks that Chills anything entering it. 10 mana, cooldown 30 ticks.
- **Capstone, Old Ways:** the first condition you cause in each fight lasts twice as long.

Douse then Chill freezes a target. Players should discover it, not be told.

### Slimes

Mindless. They never learn, only grow.

| Tier | Health | Attack | Speed | Resistances |
| --- | --- | --- | --- | --- |
| Slime | 12 | Touch: 1-tick windup, Force 3 | Walk | Precision 0.5, Arcane 1.25 |
| Gel | 30 | Touch: 1-tick windup, Force 5 | Walk | Precision 0.5, Arcane 1.25 |
| Dense slime | 70 | Touch: Force 9. Engulf: 3-tick windup, every tile around it, Force 14, Stunned 2 ticks | One tile every 3 ticks | Precision 0.5, Arcane 1.25 |

- **Merging.** Two slimes of the same tier that stay next to each other for 8 ticks merge into the next tier. For the last 4 of those ticks they glow and pull together. Pushing one away or killing one stops it.
- **The core.** A Force hit of 8 or more on a dense slime exposes its core for 4 ticks, doubling all damage it takes.

### Goblins

Cunning. They fight as a group and learn during the fight.

| Type | Health | Attack | Resistances | Behavior |
| --- | --- | --- | --- | --- |
| Goblin | 16 | Stab: 1-tick windup, Precision 4 | None | Flees below a quarter health unless the chieftain is near |
| Goblin slinger | 12 | Poisoned stone: 2-tick windup, range 5, Force 3 and Poison | None | Keeps its distance |
| Goblin veteran | 30 | Stab: 1-tick windup, Precision 6 | Precision 0.75 | Stands its ground |
| Goblin chieftain | 60 | Cleave: 2-tick windup, the three tiles in front, Force 10. Rally: 3-tick windup, nearby goblins deal 25% more for 12 ticks | Precision 0.75 | If it dies, every goblin's morale breaks and they flee |

**Learning during the fight.** Goblins only learn from what survivors saw. After an ability hits goblins 3 times, the surviving goblins who saw it adapt:

- **Against traps:** they avoid tiles where they saw a trap.
- **Against ranged attacks:** they spread out and approach in a zigzag.

Killing the witnesses prevents the lesson. Shield Bash cancels Rally.

### The Clockwork Colossus

A 2-by-2 machine with 400 health. It takes half damage from Precision and three-quarters from Arcane. It behaves like a finite state machine: its next move depends only on its current state and what the player last did.

| State | What it does | What comes next |
| --- | --- | --- |
| Guard | Decides, over 1 tick | If the player is in front and adjacent: Slam. Beside or behind: Sweep. Further than 3 tiles away: Bolts |
| Slam | 3-tick windup, a 3-by-3 area in front, Force 20 | If hit by Arcane damage or a cancel during the windup, its gears jam: the Slam fails and it goes to Overheat. Otherwise, Guard |
| Sweep | 2-tick windup, every tile around it, Force 14 | Guard |
| Bolts | 2-tick windup, a straight line toward the player, Force 8; then it steps 2 tiles toward them | Guard |
| Overheat | 6 ticks with no attacks, its back panel open: hits from behind deal double | If hit from behind during Overheat: Reset. Otherwise, an angry Sweep |
| Reset | 8 harmless ticks | Guard |

- **The trick:** stand in front, jam the Slam, hit its back during Overheat, return to the front during Reset. Repeated, this locks it into a harmless loop.
- **The plaque:** a wall plaque shows the state machine drawn as interlocking gears. It's never explained in words.
- **Pillars matter:** the no-corner-cutting rule makes pillars real cover from Bolts.

### Waves

1. Three slimes.
2. Four goblins and a slinger.
3. A goblin chieftain, a veteran, and three goblins.
4. Four slimes placed so they're likely to merge.
5. The Clockwork Colossus.

Each enemy gives experience scaled by its tier relative to the player's level: enough to reach level 10 over a few complete runs.

## Out of scope

Holy damage, every other condition and wound, other classes, gear quality, crafting, the world, other players beyond debug tabs, real art, final death, and the Renewal.

## When to ask Peter

Ask before inventing any rule that isn't here. Likely questions:

- Whether enemies block movement, or players can pass through them.
- How enemies choose between several targets.
- Anything that changes the feel of combat beyond the numbers above.
