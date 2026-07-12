# LEGO Collection Manager

Local web app to track your LEGO collection valuations, refresh market prices, and record sales.

## Quick start (local)

```bash
npm install
npm start
```

Open **http://localhost:3456**

On first run, the app imports `../lego_collection_valuation.csv` if present.

## Docker / Unraid

Image: **`bal0o/legocollection:latest`** (built automatically on push to `main`)

### Unraid Docker template

| Setting | Value |
|---------|-------|
| Repository | `bal0o/legocollection:latest` |
| Network type | Bridge |
| Port | `3456` → container `3456` |
| Path | `/mnt/user/appdata/legocollection/data` → `/app/data` |

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Default `3456` |
| `REBRICKABLE_API_KEY` | No | Better set names on add |
| `BRICKLINK_*` | No | BrickLink API credentials (see `.env.example`) |
| `DAILY_REFRESH_ENABLED` | No | `true` (default) — auto-refresh held sets daily |
| `DAILY_REFRESH_HOUR` | No | Hour in local time (default `3`) |
| `DAILY_REFRESH_MINUTE` | No | Minute (default `0`) |
| `PUID` / `PGID` | No | Unraid: usually `99` / `100` for `nobody:users` |

Copy your existing `collection.json` into the mounted `data` folder before first start, or add sets via the UI.

### docker compose

```bash
docker compose up -d
```

## GitHub Actions → Docker Hub

Uses the same secrets as [ticket-bot](https://github.com/bal0o/ticket-bot):

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

Add these under **GitHub repo → Settings → Secrets and variables → Actions**.

## Features

- View all sets with UK valuation data
- Search & add sets (auto-fetches Rebrickable, BrickLink, eBay prices)
- Refresh pricing per set or bulk refresh all held sets
- Daily automatic price refresh (history snapshots)
- Mark sold / for sale with listed quantities
- Filter by status, search by name or set number

## Data

- JSON database: `data/collection.json` (persist via Docker volume)
- Re-import CSV: `npm run import` with optional `IMPORT_CSV_PATH`

## Price sources

- **BrickLink API** — 6-month sold averages in GBP
- **BrickEconomy** — RRP, retirement metadata
- **PriceCharting** — eBay sold history
