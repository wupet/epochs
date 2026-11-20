# Milestone 0.3: Content Checker (plus server fixes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ticks that fail twice drop their intentions instead of retrying forever; the queue is capped at 100; and the content schemas, samples and `npm run check-content` are built.

**Architecture:**
- The server fixes live in `packages/server/src/world-server.ts`, with a `full` message added to the shared protocol and shown by the client.
- The content schemas (Zod) and a pure `checkContent` function live in `packages/shared/src/content/`.
- A thin CLI in `packages/tools` reads `content/` from disk.

**Tech Stack:** TypeScript 7 (strict), npm workspaces, Vitest 5, Zod 4.6.7 (new, in `@epochs/shared`), ws 8.23, Node 22.

**Spec:** `docs/superpowers/specs/2026-11-19-content-checker-design.md`. Read it first; it is binding.

## Global Constraints

- `packages/shared` is pure: no `Math.random`, `Date.now`, `new Date`, `Date()`, I/O, Node or DOM (a guard test enforces this). `checkContent` takes file contents as input and never touches the file system.
- Content files: one JSON file per piece of content, in `content/<kind>/<id>.json`, where kind is `classes`, `abilities`, `items` or `enemies`.
  - Field names are camelCase.
  - Every fixed choice and every id is lowercase with hyphens. Ids match `^[a-z][a-z0-9-]*$`.
  - Unknown fields are errors.
- A problem is reported as `{ file, field, message }` and printed as `<file>: <field>: <message>`. The field is `""` for whole-file problems, and then the line is `<file>: <message>`.
- Messages to clients never carry hidden fields (`path`, `progress`, `stepped`).
- Imports inside a package use extensionless relative paths, and packages import each other as `@epochs/shared`.
- Tests sit next to their sources as `*.test.ts`. Use `npx vitest run --project <shared|server|client|tools>`, then `npm test` and `npm run typecheck` before each commit. Both must pass.
- Implementers commit; they do not push.

## Review Focus

1. **A join dropped after two failed ticks.** That socket must not hang: it is closed with code 1011, its slot is freed, and the next person in the queue is admitted. Pinned in Task 1.
2. **A ghost character** (in the world, with no connection) gets a leave and disappears for everyone. Pinned in Task 1.
3. **A queued connection when the queue is full** gets `full` and is closed. The people already queued keep their positions. Pinned in Task 2.
4. **A broken content file** names the exact file and field, and one bad file doesn't stop the others being checked. Pinned in Task 3.
5. **Running `npm run check-content` from any working directory** still finds `content/` at the repository root. Pinned in Task 4.

---

### Task 1: Retry once, then drop; ghost cleanup

**Files:** modify `packages/server/src/world-server.ts` and `world-server.test.ts`.

**Interfaces:**
- `WorldServerOptions` gains `readonly step?: typeof step` (the test seam, defaulting to the shared `step`).
- The log line is exactly `[epochs] tick failed twice: dropped ${n} intentions` (`console.error`).

**Behaviour** (from the spec):
- Count consecutive failed ticks.
- **On the first failure,** keep everything queued, as today.
- **On the second consecutive failure:**
  - count all held intentions (lifecycle, modes and moves) as `n`, and clear them;
  - log the line above once;
  - for every dropped `join` whose socket is still connected, close that socket with code 1011 and the reason `Could not join, please reconnect`, forget it, and admit the next waiting socket, exactly as when a playing socket closes;
  - reset the counter.
- **A success** resets the counter.
- **Ghost cleanup:** before taking intentions each tick, every character in `state.characters` whose id has no connection gets a queued `leave`.
  - A character counts as connected if a playing connection holds its id.
  - A just-admitted socket whose join is still queued counts as connected, so it is not treated as a ghost.

- [ ] **Step 1: Write the failing tests.**
  - **Throws once:** a step function that throws on its first call only. A client's join is retried and its welcome arrives one tick later than normal. No error line is logged; only the existing per-tick error log appears.
  - **Throws twice:**
    - A step that throws on two consecutive calls, then works.
    - The pending join's socket is closed with code 1011.
    - The log line is called once, with the right count.
    - The tick after that succeeds, and other clients keep receiving ticks.
  - **Review Focus 1:** with `maxPlayers: 1`, a waiting socket is admitted after the dropped-join socket is closed.
  - **Review Focus 2:**
    - Build a server whose step function, on one tick, returns a state with an extra character (id 99) that has no connection.
    - On the next tick that character is in `left` for the connected client.
    - Use the seam: wrap the real step and inject the character once.
- [ ] **Step 2: Run** `npx vitest run --project server`. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expect PASS.
- [ ] **Step 5: Commit** `World server: retry a failed tick once, then drop and log; clear ghost characters`.

---

### Task 2: Queue cap and the `full` message

**Files:**
- Modify `packages/shared/src/protocol.ts` and `protocol.test.ts`.
- Modify `packages/server/src/world-server.ts` and `world-server.test.ts`.
- Modify `packages/client/src/client-world.ts`, `connection.ts`, `render.ts` and the related tests.

**Interfaces:**
- **Shared:** `FullMessage { readonly type: 'full' }`. `ServerMessage` includes it. Add `fullMessage(): FullMessage`.
- **Server:** `MAX_QUEUE = 100` (exported). `WorldServerOptions.maxQueue?: number`.
- **Client:**
  - `parseServerMessage` accepts `full`.
  - `ClientWorld` gains `serverFull: boolean`, set by `applyFull()`.
  - The status line shows `The server and its queue are full. Try again later.` when `serverFull` is true. This takes priority over "disconnected".

**Behaviour:** a new connection that would join a waiting list already holding `maxQueue` sockets receives `fullMessage()` and is closed with code 1013 and the reason `Server full`. It never gets an id, a queue position or a slot.

- [ ] **Step 1: Write the failing tests.**
  - **Protocol:** `fullMessage()` is `{type:'full'}`.
  - **Server**, with `maxPlayers: 1` and `maxQueue: 2`:
    - A plays, and B and C wait at positions 1 and 2.
    - D receives `full` and is closed with 1013.
    - B and C keep their positions (no new queue message is sent to them).
    - When A leaves, B is admitted and C moves to 1.
  - **Client:** `parseServerMessage('{"type":"full"}')` is accepted, and `applyFull` sets `serverFull`.
- [ ] **Step 2: Run** the server, shared and client projects. Expect FAIL.
- [ ] **Step 3: Implement,** including the status line in `render.ts` and the routing in `main.ts` or `connection.ts`.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expect PASS.
- [ ] **Step 5: Commit** `Queue cap of 100: a full server says so and closes the connection`.

---

### Task 3: Content schemas and `checkContent` (shared)

**Files:**
- Install Zod: from the repo root, `npm install zod@4.6.7 -w @epochs/shared`. Check that `package-lock.json` only gains entries.
- Create `packages/shared/src/content/schemas.ts` (the Zod schemas and inferred types), `check.ts` (`checkContent`) and `index.ts`.
- Create the tests `schemas.test.ts` and `check.test.ts`.
- Modify `packages/shared/src/index.ts` (`export * from './content'`).

**Interfaces:**
```ts
export const DAMAGE_KINDS = ['force', 'precision', 'arcane', 'holy'] as const;
export const ATTRIBUTES = ['might', 'finesse', 'vigor', 'wits', 'spirit'] as const;
export const classSchema, abilitySchema, itemSchema, enemySchema;   // z.strictObject(...) per the spec's table
export type ClassContent, AbilityContent, ItemContent, EnemyContent;  // z.infer
export const CONTENT_KINDS = { classes: classSchema, abilities: abilitySchema, items: itemSchema, enemies: enemySchema } as const;
export interface ContentFile { readonly path: string; readonly text: string }   // path relative to the repo, forward slashes, e.g. "content/items/rusty-shortsword.json"
export interface ContentProblem { readonly file: string; readonly field: string; readonly message: string }
export function checkContent(files: readonly ContentFile[]): ContentProblem[];  // sorted by file, then field
export function formatProblem(p: ContentProblem): string;                       // "<file>: <field>: <message>" or "<file>: <message>"
```

**`checkContent` order for each file:**
1. The path must be `content/<kind>/<name>.json`, with a known kind. Otherwise it's a whole-file problem, such as `unknown content folder "spells" (expected classes, abilities, items, enemies)` or `not a .json file`.
2. `JSON.parse`. On failure: `invalid JSON: <parser message>`.
3. Validate the schema. Map each Zod issue to `field` (its path joined as `a.b[1].c`) and a plain message:
   - an unknown key: `unknown field`;
   - a missing field: `required`;
   - a bad choice: `expected one of a, b, c`;
   - a wrong type: `expected <type>`;
   - number bounds: a plain sentence.
4. `id` must equal `<name>`. If not: field `id`, message `must match the file name "<name>"`.
5. The rules within a file, from the spec:
   - no repeated damage kind or attribute;
   - no repeated prerequisite class or starting ability;
   - at most 2 kinds in an item's damage split.
6. After all files, the cross-file rules:
   - duplicate ids within a kind: reported on each file after the first, field `id`, `duplicate id, also used by <other file>`;
   - missing starting abilities: field `startingAbilities[i]`, `no ability with id "<x>"`;
   - missing prerequisite classes: field `prerequisites[i].classId`, `no class with id "<x>"`;
   - a self-prerequisite: field `prerequisites[i].classId`, `a class can't require itself`.

   Files that failed to parse or validate are skipped for cross-references.

- [ ] **Step 1: Write the failing tests.** `check.test.ts` builds in-memory `ContentFile`s. Every spec test case gets its own test asserting the exact `{file, field}` and a message substring:
  - unknown choice;
  - missing field;
  - extra field;
  - invalid JSON;
  - wrong type;
  - id does not match the file name;
  - duplicate id;
  - missing ability reference;
  - self-prerequisite;
  - repeated damage kind;
  - 3 damage kinds on an item;
  - unknown folder.

  **Review Focus 4:** one broken file plus one valid file gives problems only for the broken file.

  Also test `formatProblem`, and that a fully valid set of four files returns `[]`.
- [ ] **Step 2: Run** `npx vitest run --project shared`. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. The purity guard must still pass. Expect PASS.
- [ ] **Step 5: Commit** `Content schemas (Zod) and a pure checkContent with cross-reference checks`.

---

### Task 4: Samples, `npm run check-content`, and docs

**Files:**
- Create `content/classes/militia.json`, `content/abilities/basic-strike.json`, `content/items/rusty-shortsword.json` and `content/enemies/slime.json`. Remove `content/.gitkeep`.
- Create `packages/tools/src/check-content.ts` (the CLI) and `packages/tools/src/content-files.ts`, which exports `readContentFiles(repoRoot: string): ContentFile[]`. It walks `content/` recursively, skips dotfiles, and gives paths relative to the repo with forward slashes.
- Create the tests `content-files.test.ts` and `check-content.test.ts`.
- Modify the root `package.json` (the `check-content` script), `CLAUDE.md` (the `check-content` line), `docs/phase-0-brief.md` (the capstone in the class outline) and `docs/design-summary.md` (the capstone under "Characters").

**Samples** (values are placeholder drafts):
- **militia:**
  - tier `beginner`, capacityCost 1, prerequisites `[]`, unlockCondition `"Hold a gate until a raid ends."`;
  - signaturePassive `{ "id": "hold-the-line", "description": "Placeholder: takes less damage while standing still." }`;
  - startingAbilities `["basic-strike"]`;
  - capstone `"Placeholder: allies next to you take less damage."`.
- **basic-strike:** channelTicks 1, shape `single-tile`, rangeTiles 1, damage `[{ "kind": "force", "amount": 10 }]`, conditionsApplied `[]`.
- **rusty-shortsword:** kind `plain`, quality `crude`, damageSplit `[{ "kind": "force", "amount": 8 }, { "kind": "precision", "amount": 2 }]`, requirements `[{ "attribute": "might", "minimum": 3 }]`.
- **slime:** family `slime`, tier 1, health 20, damage `[{ "kind": "force", "amount": 3 }]`, resistances `[{ "kind": "precision", "multiplier": 0.5 }]`, intelligence `mindless`.

**CLI:**
- `check-content.ts` finds the repo root from `import.meta.url` (as `check-links.ts` does), so it works from any working directory.
- It prints each problem with `formatProblem`, then `Found N problems in M files.`, and exits 1.
- With no problems it prints `All N content files are valid.` and exits 0.
- Export a `runCheck(repoRoot): { problems: ContentProblem[]; fileCount: number }` for testing.

- [ ] **Step 1: Write the failing tests.**
  - `readContentFiles` on a temp repo finds nested files with forward-slash relative paths and skips dotfiles.
  - `runCheck(<real repo root>)` returns no problems and a `fileCount` of 4.
  - `runCheck(temp repo)` with `content/items/broken.json` containing `{"id":"broken","name":"x","kind":"sword"}` returns problems naming `content/items/broken.json`, including the field `kind`.
  - **Review Focus 5:** spawn `node --import tsx packages/tools/src/check-content.ts` with `cwd` set to a temp folder.
    - It exits 0 and prints `All 4 content files are valid.`.
    - Spawning it against a temp repo copy holding a broken file exits 1. A `repoRoot` override through the environment variable `EPOCHS_REPO_ROOT` is acceptable for this.
- [ ] **Step 2: Run** `npx vitest run --project tools`. Expect FAIL.
- [ ] **Step 3: Implement.** Add the root script `"check-content": "node --import tsx packages/tools/src/check-content.ts"` and write the samples.
- [ ] **Step 4: Run** `npm run check-content` (expect `All 4 content files are valid.`), then `npm test` and `npm run typecheck`. Expect PASS.
- [ ] **Step 5: Update the docs.**
  - **Brief, class outline:** append "capstone (a short description of the class's bonus at full mastery) *(Peter, 2026-11-19)*".
  - **Design summary, "Characters":** "Each class has a capstone: a bonus at full mastery. *(Peter, 2026-11-19.)*"
  - **CLAUDE.md:** `npm run check-content`: validate everything in `content/` and report each problem as file, field and message.
- [ ] **Step 6: Commit** `Content samples and npm run check-content`.

---

### Task 5: Report (the controller)

- [ ] Run `npm run check-content` on the samples and on a deliberately broken copy, and capture the output.
- [ ] Write `docs/reports/0.3-content-checker.md`, covering:
  - what was built, how to run it, and what to check by hand;
  - that the sample values are placeholders;
  - design questions: whether a class's tier and capacity cost are linked; the id style; whether conditions and passives become content kinds.
- [ ] Run `npm test` and `npm run typecheck`, then commit and push.
