# Milestone 2.1.1: Playtest fixes (design)

These changes come from Peter's 2.1 playtest (2026-11-20). The rules are in `docs/phase-2-brief.md`, in "Settled for 2.1.1" and "Windups and dodging". The 2.1 design (`2026-11-20-fighting-basics-design.md`) still holds except where this changes it. The questions to Peter are marked **(Q)**, each with the default the plan uses.

## Pacing

- **The slime's touch** has a windup of 3 ticks (was 1) and a cooldown of 6 ticks (was 3). It now repeats every 10 ticks: a windup on T, a hit on T+3, waiting on T+4 to T+9, and the next windup on T+10.
- **The slime's speed is 334 millitiles per tick,** for "one tile every 3 ticks". A third of a tile isn't a whole number of millitiles.
  - At 333, a rested slime's first gap is 4 ticks, because 3 × 333 = 999.
  - At 334 the gap is 3 ticks, with one step coming a tick early after about 500 steps, roughly every 6 minutes of non-stop walking.
- **Every enemy attack needs a windup of at least 2 ticks.** The content checker enforces this through the named constant `MIN_ENEMY_WINDUP_TICKS = 2`.
- **(Q4) Enemies still to come in 2.4 break the new rule.** The brief gives a 1-tick windup to the gel, the goblin and the goblin veteran, and no windup for the dense slime's touch. *Default:* each becomes 2 ticks when 2.4 builds it. Nothing changes now.

## No hit right after you respawn (Q1)

With a 3-tick windup, a hit can land after a respawn again:
1. Slime A starts a touch on your tile on tick S.
2. Slime B kills you on S+1.
3. You respawn on S+2, possibly on that same tile.
4. A's touch lands on S+3, at full health.

The 2.1 guard only stops a windup *starting* on a player at 0 health, so it doesn't catch this.

- *Default (builder's call):* **respawn avoids telegraphed tiles.** When choosing your respawn tile, a tile covered by any active windup counts as taken. "Whoever stands there is hit" stays true.
- *Alternative (a rule change, Peter's call):* an enemy cancels a windup aimed at a player who goes down.

## Clicking enemies

- **The click area** of an enemy is a square `CLICK_AREA_TILES` = 1.0 tile wide, centred on where the enemy is drawn. The drawn body is 0.7 tiles wide, so the area is larger than the body.
- **(Q2) The area doesn't spill onto neighbouring tiles.** Stepping out of a telegraph means clicking a tile next to the slime. A larger area would turn some of those dodge clicks into attacks, and a melee attack stands still inside the telegraph. *Default:* 1.0 tile. If clicking still feels hard, raise it.
- **One function picks the enemy** under the pointer, `enemyAtPoint`. The highlight and the click both use it, so the highlight always shows what a click will do.
  - When areas overlap, the nearest drawn centre wins, and ties go to the lowest id.
  - The highlight is a bright outline around the body, plus the crosshair cursor.
- **A click on a highlighted enemy always attacks it,** whether or not attack-move is armed. It never becomes a walk.
- **Default zoom.** The game starts at `DEFAULT_TILE_SIZE` = 40 px tiles instead of fitting the whole arena. `0` still returns to fit, and `+`/`−` work as before. The camera follows you. The view is measured without the debug panel's width, so you never end up under the panel.

## Auto-retaliate

- **It's a real setting, not debug.** The character has `autoRetaliate`, true when you join. The setting survives respawn.
- **Changing it.**
  - The client message is `{ type: 'auto-retaliate', on }`.
  - The intention is `set-auto-retaliate`, and the last one in a tick wins.
  - It doesn't count toward the debug cap.
- **Privacy.** The setting is sent only in its owner's `sheet` message.
- **The rule** runs as a new phase after deaths in each tick. A player who meets all of these gets an `attack` order on the enemy, which takes effect from the next tick:
  - can act (not down, health above 0);
  - has order `none`;
  - has a weapon;
  - has auto-retaliate on;
  - took a hit this tick from an enemy that is still in the world, for more than 0 damage.
- **Which enemy:** if several enemies hit the player in the same tick, the **first** such hit in resolve order wins.
- **Not "idle":** a player who is walking, attacking or attack-moving is left alone.
- **The client** has a toggle button showing "Auto-retaliate: on/off (R)", and the **R** key toggles it. Attack-move stays as an optional extra.

## Death replay (client only)

- **The client remembers the last 20 ticks** (`REPLAY_TICKS` = 20, 5 seconds). For each one it keeps the tick message and a snapshot of what it showed just before that tick. A snapshot has the shape of a `WelcomeMessage`, built by `ClientWorld.snapshot()` from the latest server tiles.
- **When your recap arrives,** the client builds a second `ClientWorld` from the oldest saved snapshot. It then replays the saved tick messages on a virtual clock running at half speed, so a 5-second replay takes 10 seconds. The replay ends on the tick you died: the one whose `downed` lists you.
- **(Q3) Where it shows.** *Default:* the replay **takes over the main view.**
  - A banner reads "Replay: your last 5 seconds (half speed)".
  - The recap sits in a panel beside it, and the line for each hit lights up as that hit lands in the replay.
  - The buttons are "Watch again" and "Back to the game". Esc also goes back at any time.
  - Clicks and keys don't reach the live game during the replay, except Esc.
  - The world keeps running during the replay. With auto-retaliate on, your character fights back by itself.
  - *Alternative:* a smaller replay window beside the live view, which keeps you in control but shows less.
- **Edge cases:**
  - Dying during a replay starts the new one.
  - Dying less than 5 seconds after joining gives a shorter replay.
  - A welcome (after a reconnect) clears the saved ticks and closes the replay.
- **Hidden information:** the replay uses only messages the client already received.

## Builder's calls (to confirm in the report)

1. The slime's speed is 334 millitiles per tick (see Pacing).
2. Respawn avoids telegraphed tiles (Q1 default).
3. The click area is 1.0 tile around the drawn body, with the nearest centre winning (Q2 default).
4. Auto-retaliate takes the first hit in a tick, starts on the next tick, needs a weapon and leaves busy players alone.
5. The default zoom is 40 px, and the camera keeps you clear of the debug panel.
6. The replay takes over the main view, Esc leaves at any time, and the world keeps running (Q3 default).
