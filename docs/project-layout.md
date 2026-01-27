# Project Layout & Architectural Rules (MVP)

This document defines **non-negotiable architectural rules** for the MVP.  
It is intentionally short and normative.  
Any implementation task must comply with this document.

---

## Repository Shape

- **Single-package Node.js + TypeScript project**
- One `package.json`
- One executable pipeline
- No monorepo tooling

---

## Entrypoint & Barrels

- **Entrypoint:** `src/main.ts`
- `index.ts` files are **barrel exports only**
  - `export * from "./x"`
  - Never executable
  - Never contain logic

---

## Imports

- **No relative imports:** Use `@/...` imports everywhere (including `src/types/**`). Do not use `./` or `../` imports across modules.
- **Types import rule:** In `src/types/**`, import other types using `@/types/...` (or via `@/types` barrel when appropriate). Never deep-link with relative paths like `./clients/...`.
- Provider-specific code must never be imported outside its provider folder

---

## Types vs Interfaces (Strict Separation)

### Types

- Live under `src/types/`
- **No logic-file types:** Do not declare `type`/`interface` in logic files (anything outside `src/types/`).  
  If a function needs a result/input type, it must live under `src/types/` and be imported from there.
- No duplicate types / reuse existing types: before adding a new type, search for an existing one that matches the concept (e.g., counters).
- Represent **data shapes** (inputs / outputs / persisted models)
- Declared using `type`, not `interface`
- Canonical domain types live here
- Aggregated via `src/types/index.ts` (barrel exports only)

### Interfaces

- Live under `src/interfaces/`
- Represent **behavioral contracts**
- Used to define what a class/service must implement
- Never used as data containers

**Types ≠ Interfaces. They are not interchangeable.**

---

## Canonical Domain Model (Client-Agnostic)

- The canonical ingestion model lives under:
  - `src/types/clients/job_offers.ts`
- All external providers **must map their payloads to this model**
- No provider-specific fields are allowed in canonical types

**Rule:**  
Ingestion, DB, and business logic only work with canonical types — never with provider payloads.

---

## Providers / Clients

- External data sources live under `src/clients/<provider>/`
- A client is responsible only for:
  - Authentication
  - HTTP calls
  - Pagination / rate limits
  - Mapping raw payloads → canonical types

**Clients must NOT:**

- Write to the database
- Perform business logic
- Depend on other providers

Provider-specific types must remain inside:

- `src/types/clients/<provider>.ts`
- They must not be re-exported from the global `types` barrel

---

## Ingestion Layer

- Lives under `src/ingestion/`
- Responsible for:
  - Orchestration
  - Run lifecycle
  - Calling repos
- Works only with:
  - Canonical types
  - DB repositories

---

## Database Layer

- Lives under `src/db/`
- Repositories under `src/db/repos/`
- Repos are **thin**
  - No business logic
  - No provider awareness
- DB schema and migrations are the system of record

---

## Utilities

- Stateless helpers live under `src/utils/`
- Examples:
  - Normalization
  - Identity derivation
  - Deterministic transforms

---

## Constants

- Tunable or shared constants live under `src/constants/`
- Aggregated via `src/constants/index.ts`
- No magic numbers inside logic files

---

## Logging (Mandatory)

- Use the project logger from `src/logger/`
- Allowed levels:
  - `debug`, `info`, `warn`, `error`
- **Never use `console.log` or `console.*` directly**

---

## Error Handling Policy (External Data)

External data is unreliable.

**Per-record issues:**

- Log
- Skip
- Continue

**Throw ONLY for:**

- Missing / invalid configuration
- Authentication failures
- Fatal initialization errors
- DB connection failures

---

## No Placeholders / No Dead Code

- No empty folders
- No stubs “for later”
- No commented-out blocks

If intent must be recorded:

- Use a `TODO:` comment
- Do not create unused code

---

## Summary Rule

If a change:

- breaks client isolation
- blurs canonical vs provider models
- mixes DB logic with ingestion
- bypasses the logger
- introduces speculative structure

**It is incorrect for this project.**
