# M-1 (Decide + Bootstrap) — Project organization decisions, then initialize

## [DECISION] Choose repo layout + module conventions (monorepo vs single package)

**Objective:** Lock the minimum project organization decisions that impact everything else.
**Key considerations (keep it simple):**

- **Option A: Single package** (recommended for MVP): fastest, fewer moving parts.
- **Option B: Monorepo** (if you expect multiple packages soon): e.g. `apps/collector`, `packages/core` later.
- Import ergonomics:
  - Path alias (e.g. `@/` → `src/`) vs relative imports
  - `index.ts` barrel exports per folder (your preference)
- Where types live:
  - Co-located by feature vs `src/types` / `src/contracts`
- Testing approach baseline (just to wire scripts): unit tests now, integration later.

**Desired output:**

- A short decision note in `/docs/decisions/project-layout.md` stating:
  - chosen layout (single vs monorepo) and why
  - chosen import style (alias + barrels or not)
  - where types/contracts will live

## [BUILD] Initialize the project according to the chosen layout

**Objective:** Create the minimal working scaffold that matches the decisions (no extra empty folders).
**Key considerations:**

- Only create directories/files that are immediately used (e.g., entrypoint + one module).
- Wire scripts (`dev`, `test`, `lint` if you want, `build`) and TS config.
- Set up import alias + barrels if chosen.
- Add minimal logging utility (levels + LOG_LEVEL env), used by entrypoint.

**Desired output:**

- Working repo that runs a hello entrypoint (`pnpm dev` or equivalent),
- imports follow the chosen conventions,
- no dead scaffolding.
