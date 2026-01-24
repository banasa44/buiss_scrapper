# Database Layer

## Overview

SQLite-based database layer with migrations and thin repositories for idempotent ingestion.

## Structure

```
src/db/
  connection.ts       # Database connection management
  migrate.ts          # Migration runner
  verify.ts           # Verification/smoke tests
  index.ts            # Barrel exports
  repos/
    companiesRepo.ts  # Company CRUD/upsert
    offersRepo.ts     # Offer CRUD/upsert
    runsRepo.ts       # Ingestion run tracking
```

## Configuration

Set `DB_PATH` environment variable to specify database location:

```bash
export DB_PATH=/path/to/database.db
```

Default: `./data/app.db` (created automatically)

## Usage

### Run Migrations

```bash
npm run db:migrate
```

Creates schema from `migrations/*.sql` files. Idempotent (safe to run multiple times).

### Verify Setup

```bash
npm run db:verify
```

Runs smoke tests to verify database layer is working correctly.

### In Code

```typescript
import { openDb, closeDb, upsertCompany, upsertOffer } from "@/db";

openDb();

// Upsert company (idempotent)
const companyId = upsertCompany({
  provider: "infojobs",
  provider_company_id: "123",
  name: "Company Name",
  normalized_name: "company name",
});

// Upsert offer (idempotent)
const offerId = upsertOffer({
  provider: "infojobs",
  provider_offer_id: "456",
  company_id: companyId,
  title: "Job Title",
  description: "Full description...",
});

closeDb();
```

## Schema

See [docs/M1/01_define_db_schema.md](../../docs/M1/01_define_db_schema.md) for full schema definition.

### Tables

- `companies` — Company entities with provider identity
- `offers` — Job offers with full text content
- `matches` — Keyword matching results (1:1 with offers)
- `ingestion_runs` — Run-level audit trail

### Idempotency

- Companies: dedupe by `(provider, provider_company_id)` or `(provider, normalized_name)`
- Offers: dedupe by `(provider, provider_offer_id)`
- Repositories handle upsert logic automatically

## Repository API

### companiesRepo

- `upsertCompany(input)` — Insert or update company, returns company ID
- `getCompanyById(id)` — Retrieve company by ID

### offersRepo

- `upsertOffer(input)` — Insert or update offer, returns offer ID
- `getOfferById(id)` — Retrieve offer by ID
- `getOfferByProviderId(provider, providerId)` — Retrieve by provider identity

### runsRepo

- `createRun(input)` — Create new ingestion run, returns run ID
- `finishRun(runId, update)` — Update run with counters and status
- `getRunById(id)` — Retrieve run by ID
