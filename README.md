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
