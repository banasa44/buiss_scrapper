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

# RESOLUTION

The project is structured as a **single-package Node.js/TypeScript repository** with modular source layout under `src/`. No monorepo tooling is used; separation of concerns is achieved through directory organization within one `package.json`.

## Repository Layout & Module Conventions

The codebase uses **path alias `@/` → `src/`** configured via `tsconfig.json` (`baseUrl: "."` + `paths: { "@/*": ["src/*"] }`). Runtime resolution in development is handled by `tsconfig-paths/register` via `ts-node`. Production builds use `tsc-alias` to transform aliases to relative paths after TypeScript compilation.

**Barrel exports** are mandatory: every module directory exposes its public surface through an `index.ts` file containing only `export` statements. The convention reserves `index.ts` exclusively for exports; executable code lives in named files. The entrypoint is `src/main.ts`, not `src/index.ts`.

## Types & Constants

Shared **types** live under `src/types/` with a barrel export at `src/types/index.ts`. Module-specific types may remain co-located if not shared across boundaries.

Shared **constants** (lookup tables, enums, configuration mappings) live under `src/constants/` with a barrel export at `src/constants/index.ts`.

This centralization makes cross-module contracts explicit and prevents scattered definitions. Current implementation includes `LogLevel` type and `LOG_LEVELS` mapping used by the logger.

## Initialization & Entrypoint

The entrypoint `src/main.ts` establishes baseline wiring: it imports from `@/clients/infojobs` (a stub client) and `@/logger` (the logging module), executes a smoke test, and logs results. Error handling exits the process on uncaught exceptions.

The `InfoJobsClient` class in `src/clients/infojobs/infojobsClient.ts` is a skeleton with a `smoke()` method returning a static string. This satisfies the "no dead code" constraint while providing a real module for the next integration milestone.

## Logging

The project uses a **micro-logger wrapper** (`src/logger/`) wrapping `console.*` with no external dependencies. It exports four functions: `debug`, `info`, `warn`, `error`, plus a `withContext()` helper for binding metadata.

**Log level filtering** is controlled by the `LOG_LEVEL` environment variable (values: `debug`, `info`, `warn`, `error`; default: `info`). Levels are ordered by priority (`debug=0`, `info=1`, `warn=2`, `error=3`); messages below the current level are suppressed.

Log format is `[timestamp] [LEVEL] message {json_meta}`. Metadata objects are serialized as JSON.

The logger is used in `src/main.ts` for startup, results, and error reporting. Changing `LOG_LEVEL=debug` reveals debug logs; `LOG_LEVEL=error` hides all but errors.

## Build & Execution

Three npm scripts are operational:

- **`npm run dev`**: executes `src/main.ts` directly via `ts-node` with alias resolution
- **`npm run build`**: compiles TypeScript to `dist/`, then transforms path aliases with `tsc-alias`
- **`npm run start`**: runs compiled `dist/main.js`

The repository is **ready** in the sense that `npm run dev` executes successfully, imports resolve via `@/` aliases, the logger filters output based on environment configuration, and the InfoJobsClient stub is wired for immediate expansion into real API calls. No empty scaffolding or unused modules exist.
