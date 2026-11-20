# Milestone 0.3: Content checker, plus two server fixes (design)

Approved by Peter on 2026-11-19. This builds milestone 0.3 of `docs/phase-0-brief.md`, with the two server fixes he asked for first.

## Peter's decisions (2026-11-19)

1. **Retry once, then drop.** When a tick fails, retry its intentions once. If it fails again, drop them and log it.
2. **Queue cap.** At most 100 people wait in the queue. The next connection is told "The server and its queue are full. Try again later." and disconnected.
3. **Zod** for the content schemas.
4. **Cross-reference checks** between content files.
5. **Capstone.** The class schema includes a capstone: a short description of the class's bonus at full mastery.
6. **The speed-key leftover from 0.2.1 stays as it is.**

## Server fixes

**Retry, then drop.**
- The world server counts consecutive failed ticks.
- **On the first failure,** the tick's intentions stay queued and are retried on the next tick. That is today's behaviour.
- **On a second consecutive failure,** all held intentions (joins, leaves, modes and moves) are dropped, and the server logs `[epochs] tick failed twice: dropped N intentions`.
- **Dropped joins:** any socket whose join was dropped is closed with code 1011 and the reason "Could not join, please reconnect". Its slot is freed, so the queue admits the next person.
- **A successful tick** resets the counter.
- *Builder's call, ghost cleanup:* each tick, any character in the world with no connection gets a leave intention. A dropped leave therefore can't leave a ghost square behind. A leave only removes a character, so it can't realistically fail.
- *Test seam:* `WorldServerOptions` takes an optional `step` function, defaulting to the real one, so tests can make a tick fail.

**Queue cap.**
- `WorldServerOptions.maxQueue`, default `MAX_QUEUE = 100`.
- When the queue is full, a new connection receives `{ "type": "full" }` and is closed with code 1013 ("Try again later").
- The protocol gains `FullMessage`.
- When it receives `full`, the client shows "The server and its queue are full. Try again later." instead of "disconnected".

## Content

**Layout.** One JSON file per piece of content, in a folder named for its kind:
- `content/classes/`
- `content/abilities/`
- `content/items/`
- `content/enemies/`

The file name must be the content's `id` plus `.json`. Any other folder or file type is reported as a problem. *(Builder's call.)*

**Spelling.**
- Field names are camelCase.
- Every fixed choice is written in lowercase with hyphens: `force`, `might`, `holy-relic`, `single-tile`.
- Ids are lowercase with hyphens: `^[a-z][a-z0-9-]*$`.
- Unknown fields are errors, so a typo is caught.

*(Builder's calls.)*

**Schemas** (Zod, in `packages/shared/src/content/`):

| Kind | Fields |
| --- | --- |
| Class | `id`, `name`, `tier` (beginner, intermediate, advanced, expert), `capacityCost` (1, 2, 3 or 5), `prerequisites` (list of `{ classId, rank }` with rank a positive integer), `unlockCondition` (non-empty text), `signaturePassive` (`{ id, description }`), `startingAbilities` (list of ability ids), `capstone` (non-empty text: the bonus at full mastery) |
| Ability | `id`, `name`, `channelTicks` (integer ≥ 0), `shape` (single-tile, line, cone, burst, wall, touch, self), `rangeTiles` (integer ≥ 0), `damage` (list of `{ kind, amount }`), `conditionsApplied` (list of text, may be empty) |
| Item | `id`, `name`, `kind` (plain, trait, storied, holy-relic, cursed, consumable, tool), `quality` (crude, common, fine, superior, masterwork, legendary, mythic), `damageSplit` (list of `{ kind, amount }`, may be empty for non-weapons), `requirements` (list of `{ attribute, minimum }`) |
| Enemy | `id`, `name`, `family` (text), `tier` (integer ≥ 1), `health` (positive integer), `damage` (list of `{ kind, amount }`), `resistances` (list of `{ kind, multiplier }`), `intelligence` (mindless, instinctive, cunning, organized, ancient) |

- **Damage kinds** are force, precision, arcane and holy. **Attributes** are might, finesse, vigor, wits and spirit.
- **Damage amounts** are positive integers. A resistance multiplier is a number greater than 0: below 1 resists, above 1 is a weakness. A requirement minimum is an integer of at least 0. *(Builder's calls.)*
- **No repeats in a list:** a damage kind appears at most once in any damage or resistance list, and an attribute at most once in requirements. A class lists each prerequisite class and each starting ability at most once.
- **An item's damage split has at most 2 kinds,** from the design summary: "Weapons split their damage across one or two kinds."
- **Not enforced:** any link between a class's tier and its capacity cost. That would be a game rule the docs don't state, so it's a design question in the report.

**Cross-references,** checked across all files:
- Each class's `startingAbilities` must name existing abilities.
- Each prerequisite `classId` must name an existing class other than itself.
- Ids must be unique within each kind.
- `conditionsApplied` and `signaturePassive.id` aren't checked, because conditions and passives aren't content kinds yet.

**The checker.**
- `checkContent(files: { path: string; text: string }[]): ContentProblem[]` in `shared`. It is pure: no file system access.
- A problem is `{ file, field, message }`, where `field` is a readable path such as `damageSplit[1].kind`, or `""` for whole-file problems.
- `packages/tools/src/check-content.ts` reads `content/` recursively and runs `checkContent`.
  - It prints each problem as `content/items/rusty-shortsword.json: damageSplit[1].kind: expected one of force, precision, arcane, holy`.
  - It exits with code 1 if there are any problems.
  - Otherwise it prints `All N content files are valid.` and exits with 0.
- The root script is `"check-content": "node --import tsx packages/tools/src/check-content.ts"`.

**Samples** (from the brief). The numbers and descriptions are Claude's placeholder drafts, marked as such in the report:
- **`militia`:** beginner, cost 1, no prerequisites, unlocked by "Hold a gate until a raid ends.", one signature passive, starting ability `basic-strike`, and a capstone.
- **`basic-strike`:** 1-tick channel, single tile, range 1, force damage.
- **`rusty-shortsword`:** plain, crude, mostly force with a little precision, a low might requirement.
- **`slime`:** family slime, tier 1, resists precision (multiplier below 1), mindless.

**Docs.**
- Add the capstone to the class outline in the brief and to the design summary's "Characters" section, as *(Peter, 2026-11-19)*.
- The CLAUDE.md `check-content` line drops "(Not yet built …)".

## Tests

- **Server:**
  - A step that throws once is retried and then succeeds.
  - A step that throws twice drops the intentions, logs once, closes a socket whose join was dropped, and keeps ticking.
  - A ghost character gets a leave.
  - The 101st waiting connection gets `full` and is closed, with the cap set to 2 in the test.
- **Shared:**
  - Every sample passes.
  - Each broken case is rejected with the right file and field: an unknown enum value, a missing field, an extra field, invalid JSON, the wrong type, an id that doesn't match the file name, a duplicate id, a missing ability reference, a self-prerequisite, a repeated damage kind, 3 damage kinds on an item, and an unknown folder.
- **Tools:**
  - The CLI passes on the real `content/`.
  - It returns problems and exit code 1 on a temp folder holding a broken file.
