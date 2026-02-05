# buiss-scrapper

InfoJobs offer scraper with scoring and aggregation pipeline.

## Getting Started

### Prerequisites

- Node.js 18+ and npm

### Installation

```bash
npm install
```

### Development

Run the application in development mode with hot-reload support:

```bash
npm run dev
```

### Build

Compile TypeScript to JavaScript:

```bash
npm run build
```

### Production

Run the compiled application:

```bash
npm start
```

## Project Structure

- `src/` - Source code
  - `clients/` - External API clients (InfoJobs, etc.)
  - `types/` - Shared TypeScript types
  - `config/` - Configuration loader (future)
  - `db/` - Database layer (future)
  - `core/` - Business logic (future)
  - `exporters/` - Export modules (future)

## Import Aliases

The project uses `@/` as an alias for `src/` to enable clean imports:

```typescript
import { InfoJobsClient } from "@/clients/infojobs";
```

## Environment Variables

### Optional

- `GOOGLE_SHEETS_SPREADSHEET_ID` - Target spreadsheet ID for company export. If not set, Sheets sync is skipped during ingestion runs.
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` - Service account email for Google Sheets authentication
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` - Service account private key (PEM format)
