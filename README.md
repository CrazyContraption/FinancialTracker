# Finance Planner

Finance Planner is a local-first personal finance calendar built with React, TypeScript, and Vite. It models accounts, recurring income and expenses, transfers, interest, and reconciliation checkpoints, then projects balances across a calendar view.

The application runs entirely in the browser. Planner data is saved to `localStorage`; there is no server, account system, or remote database in the current implementation.

## Features

### Calendar and projections

- Monthly calendar view with previous, next, and today navigation.
- Balance and daily net-flow display for every calendar day.
- View all accounts together or filter the calendar to one account.
- Forward projection for approximately 720 days.
- Visual indicators for positive flow, negative flow, mixed activity, deficits, weekends, and reconciliation drift.
- Monthly overview with starting balance, ending balance, net flow, and daily-flow summaries.

### Accounts

- Multiple accounts with names and custom colors.
- Standard accounts.
- Interest-bearing accounts with configurable interest rate, interval, frequency, compounding, and start date.
- Account removal and account editing from the Accounts modal.

### Income, expenses, and transfers

- One-time income or expenses.
- Recurring daily, weekly, monthly, and yearly streams.
- Transfers between accounts.
- Optional end dates.
- Excluded individual dates for recurring streams.
- Edit one occurrence, the future portion of a series, or the entire series.
- Delete one occurrence, future occurrences, or a complete series.

### Recurrence rules

The planner supports:

- Every number of days, optionally limited to selected weekdays.
- Every number of weeks on selected weekdays.
- Every number of months on a calendar date.
- Every number of months on an ordinal weekday, such as the second Friday.
- Every number of years on selected months using either a calendar date or ordinal weekday.
- Negative day rules such as last day or second-to-last day of a month.

Dates that do not exist in a month are clamped to the last valid day where appropriate.

### Reconciliation

- Record an actual account balance on a date.
- Add an optional note to a checkpoint.
- Compare projected balances with checkpoint balances.
- Configure the drift alert threshold.
- Review, edit, copy, or remove reconciliation checkpoints.

### Data portability

- Export the current planner state as formatted JSON.
- Import a planner JSON export from a local file.
- Imported files replace the current accounts, streams, and checkpoints after validation.

The current application does not provide QR-code export/import, Brotli transfer, cloud synchronization, or merge-based import.

## Getting Started

### Requirements

- Node.js 20 or newer is recommended. The GitHub Pages workflow uses Node.js 20.
- npm.

### Install dependencies

```bash
npm install
```

### Start the development server

```bash
npm run dev
```

Vite will print the local development URL, normally `http://localhost:5173`.

### Create a production build

```bash
npm run build
```

The generated site is written to `dist/`. This directory is build output and is intentionally ignored by Git.

### Preview the production build

```bash
npm run preview
```

### Run the typecheck

```bash
npm run lint
```

Despite the script name, `lint` currently runs TypeScript with `tsc --noEmit`; it does not run ESLint.

## Project Structure

```text
.
├── .github/
│   └── workflows/
│       └── build-gh-pages.yml  # GitHub Pages build and deployment
├── public/                     # Static public assets
├── src/
│   ├── App.tsx                 # Main application UI and state management
│   ├── App.css                 # Application component styles
│   ├── finance.ts              # Financial types, recurrence, and projections
│   ├── index.css               # Global styles and page background
│   ├── main.tsx                # React entry point
│   └── assets/                 # Imported application assets
├── index.html                  # Vite HTML entry point
├── package.json                # Commands and dependencies
├── package-lock.json           # Locked npm dependency graph
├── tsconfig*.json              # TypeScript configuration
└── vite.config.ts              # Vite configuration
```

## Data Model

The core types are defined in `src/finance.ts`.

### Account

An account has an ID, name, color, opening balance, and optional interest settings. Interest-bearing accounts add recurring interest events to projections.

### MoneyStream

A money stream contains account and optional transfer destination IDs, a name and amount, a direction (`income`, `expense`, or `transfer`), start and optional end dates, optional excluded dates, and a recurrence rule.

### Checkpoint

A checkpoint stores an account ID, date, actual balance, and optional note. Projection calculations use checkpoints to identify balance drift.

### PlannerSnapshot

Exports use a versioned snapshot with this shape:

```json
{
  "version": 2,
  "savedAt": "2026-08-21T12:00:00.000Z",
  "accounts": [],
  "streams": [],
  "checkpoints": []
}
```

## Persistence

The application uses these browser storage keys:

| Key | Purpose |
| --- | --- |
| `finance-planner-v2` | Current planner snapshot |
| `finance-planner-v1` | Legacy snapshot fallback |
| `finance-planner-selected-account` | Current account-view selection |
| `finance-planner-last-active-account` | Last specific account selected |

State is written to `finance-planner-v2` whenever accounts, streams, or checkpoints change. Clearing browser storage removes the local planner data unless it has first been exported.

## Import and Export

Use **Export** to download a file named like:

```text
finance-planner-2026-08-21.json
```

Use **Import** to choose a JSON file. The importer validates that `accounts`, `streams`, and `checkpoints` are arrays before replacing the current state. Invalid files are rejected with an error message.

Because data is local to the browser, regular exports are the project’s current backup strategy.

## Deployment

The workflow in `.github/workflows/build-gh-pages.yml` runs when changes are pushed to `main` or when manually dispatched. It checks out the repository, installs Node.js 20, runs `npm ci`, builds with a repository-specific GitHub Pages base path, and publishes `dist/` to the `gh-pages` branch.

To use this workflow, configure GitHub Pages to serve from the `gh-pages` branch and allow the workflow to write repository contents.

## Git and Generated Files

The following files and directories are ignored because they are generated or machine-local:

- `node_modules/`
- `dist/`
- `coverage/`
- `.vite/`
- TypeScript `*.tsbuildinfo` files
- Local `.env` files, except `.env.example`
- Editor-specific settings and operating-system metadata

`package-lock.json` should be committed. It makes CI and local installs use the same dependency versions.

## Known Maintenance Notes

- `src/App.tsx` contains the active JSON export/import workflow; QR-code transfer is not part of the application.
- The `package.json` manifest still contains a legacy `qrcode` development dependency and `qr:files` script entry. The referenced `scripts/files-to-qr.mjs` file is not part of the current application workflow and can be removed in a future dependency cleanup.
- The project uses TypeScript 5.6.3. TypeScript options introduced in later releases should not be added unless the compiler dependency is upgraded as well.

## License

No license file is currently included in the repository.
