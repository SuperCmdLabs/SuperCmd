# Extension Install Flow

## Overview

SuperCmd installs Raycast-compatible extensions without requiring git or npm on the user's machine. Extensions are discovered via a backend API (supercmd-backend) backed by a PostgreSQL database and S3 storage.

---

## Architecture

```
GitHub Actions (cron every 6h)
  ├── build-catalog.js  → catalog.json → S3 → webhook → DB (extension_catalog table)
  └── build-extensions.js → pre-built .tar.gz bundles → S3 (/bundles/)

supercmd-backend (NestJS)
  ├── GET  /extensions/catalog       → full catalog from DB
  ├── GET  /extensions/search?q=     → fuzzy search (pg_trgm)
  ├── GET  /extensions/popular       → sorted by install count
  ├── GET  /extensions/:name         → single extension metadata
  ├── GET  /extensions/:name/bundle  → pre-signed S3 URL for pre-built tarball
  ├── GET  /extensions/:name/screenshots
  ├── POST /extensions/:name/install → record install count
  ├── POST /extensions/:name/uninstall
  └── POST /extensions/webhook/sync  → re-index catalog from S3

Launcher (Electron)
  ├── extension-api.ts      → API client (Node.js https, no deps)
  ├── extension-registry.ts → install orchestrator (3-tier fallback)
  └── bun-manager.ts        → on-demand Bun binary download & caching
```

---

## Install Fallback Chain

When a user installs an extension, three methods are tried in order:

### 1. Pre-built Bundle (fastest, ~2-3s)
- Calls `GET /extensions/:name/bundle` on the backend
- Backend returns a pre-signed S3 URL for `bundles/{name}.tar.gz`
- Tarball contains: `package.json` + `assets/` + `.sc-build/*.js` (esbuild output)
- **No npm, no Bun, no esbuild needed** — just download, extract, done
- Falls through if: bundle doesn't exist in S3, backend is down, S3 returns non-200

### 2. Source Download + Bun/npm (fallback, ~10-15s)
- Downloads extension source files from `raw.githubusercontent.com` (30 concurrent HTTP requests)
- File list comes from GitHub Tree API (cached 10 min)
- Installs deps: **Bun first** (auto-downloaded on first use), npm as fallback
- Runs esbuild to build commands
- Falls through if: GitHub is unreachable

### 3. Git Sparse-Checkout (last resort, ~30-60s)
- `git clone --depth 1 --filter=blob:none --sparse` of raycast/extensions repo
- `git sparse-checkout set "extensions/{name}"`
- Installs deps: Bun first, npm fallback
- Runs esbuild
- Requires git on the user's machine

---

## Catalog Discovery Fallback Chain

1. **Backend API** (`GET /extensions/catalog`) — returns full catalog from DB
2. **Git sparse-checkout** — clones only `package.json` files (requires git)
3. **Disk cache** — `~/Library/Application Support/SuperCmd/extension-catalog.json` (even if expired)

---

## Bun Manager (`src/main/bun-manager.ts`)

- Downloads the Bun binary on-demand when first needed (~50MB)
- Cached at `~/Library/Application Support/SuperCmd/bun/bun`
- Used instead of npm for installing extension dependencies (~25x faster)
- Deletes lockfiles (`package-lock.json`, `bun.lockb`, etc.) before running to avoid frozen lockfile errors
- Shows "Setting up installer for first use…" status in the Store tab UI during first download

---

## GitHub Actions Pipeline

**Repository:** `supercmd-backend`
**Workflow:** `.github/workflows/sync-extensions.yml`
**Schedule:** Every 6 hours + manual trigger

### Job 1: `catalog` (~3 min)
1. Runs `scripts/build-catalog.js` — fetches all extension `package.json` files via GitHub API
2. Uploads `catalog.json` to S3 (`catalog/catalog.json`)
3. Triggers backend webhook to re-index into `extension_catalog` table

### Job 2: `bundles` (~40-60 min, runs after catalog)
1. Runs `scripts/build-extensions.js`
2. Collects all unique deps used by 2+ extensions → ONE shared `npm install` (deduplication)
3. For each extension: downloads source → esbuild with shared `node_modules` → packages minimal tarball
4. Uploads all tarballs to S3 (`bundles/{name}.tar.gz`)

### Known Issues / Notes
- GitHub Tree API truncates at ~100k entries. `build-catalog.js` works around this by fetching the `extensions/` subtree directly
- `build-extensions.js` also handles truncation by fetching individual extension subtrees for missing extensions
- Some extensions (~930) are skipped during build because they have no commands or no source files

---

## Backend Module

**Location:** `supercmd-backend/src/extensions/`

### Key Files
- `extensions.module.ts` — NestJS module
- `extensions.controller.ts` — REST endpoints (public, no auth except webhook)
- `extensions.service.ts` — catalog cache (5-min TTL), fuzzy search (pg_trgm), install tracking, S3 sync
- `extensions-s3.service.ts` — S3 client for reading catalog and generating pre-signed URLs
- `entities/extension-catalog.entity.ts` — TypeORM entity
- `entities/extension-install.entity.ts` — install tracking entity
- `schemas/search.schema.ts` — Joi validation

### Database Tables
- `extension_catalog` — all extension metadata, indexed with `pg_trgm` for fuzzy search
- `extension_installs` — per-user/machine install events

### Environment Variables
- `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` — S3 access
- `S3_EXTENSIONS_BUCKET` — bucket name (default: `supercmd-extensions`)
- `EXTENSIONS_WEBHOOK_SECRET` — shared secret for GHA webhook auth

---

## Launcher Files

### Key Files
- `src/main/extension-api.ts` — API client for supercmd-backend (Node.js https, zero deps)
- `src/main/extension-registry.ts` — install orchestrator, catalog fetching, 3-tier fallback
- `src/main/bun-manager.ts` — on-demand Bun binary download and dep installation
- `src/main/preload.ts` — IPC bridge for `searchExtensions`, `getPopularExtensions`, `getExtensionDetails`, `onExtensionInstallStatus`
- `src/renderer/types/electron.d.ts` — TypeScript types for new IPC methods
- `src/renderer/src/settings/StoreTab.tsx` — extension store UI (search, install, status)

### IPC Channels
- `search-extensions` → backend API with local catalog filter fallback
- `get-popular-extensions` → backend API, returns `[]` on failure
- `get-extension-details` → backend API with catalog lookup fallback
- `extension-install-status` → main→renderer push for install progress messages

### Settings
- `extensionApiUrl` — backend URL (defaults to `https://api.supercmd.com`, currently `http://localhost:3001` in dev)

---

## S3 Bucket Structure

```
s3://supercmd-extensions/
├── catalog/
│   └── catalog.json          # Full extension metadata index
└── bundles/
    ├── emoji.tar.gz           # Pre-built bundle (~5-500KB each)
    ├── todoist.tar.gz
    ├── world-clock.tar.gz
    └── ... (~1855 bundles)
```

Icons and screenshots are served from `raw.githubusercontent.com` directly — not stored in S3.

---

## Bundle Tarball Format

```
{name}.tar.gz
├── {name}/
│   ├── package.json           # Original metadata
│   ├── assets/                # Extension icons/images
│   │   └── icon.png
│   ├── .sc-build/             # Pre-built esbuild output
│   │   ├── command1.js        # All deps bundled inline
│   │   └── command2.js
│   └── .sc-meta.json          # Build metadata
│       { "builtAt": "...", "prebuilt": true, "commands": [...] }
```

No `node_modules` — all dependencies are bundled into the `.js` files by esbuild. `@raycast/api`, `react`, and Node builtins are marked as external (provided by the SuperCmd runtime).

---

## Local Commands for Manual Sync

```bash
# 1. Build catalog
node supercmd-backend/scripts/build-catalog.js /tmp/catalog-output

# 2. Upload catalog to S3
aws s3 cp /tmp/catalog-output/catalog.json s3://supercmd-extensions/catalog/catalog.json

# 3. Trigger backend re-index
curl -X POST "https://api.supercmd.sh/extensions/webhook/sync" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: YOUR_SECRET"

# 4. Build pre-built bundles (~35 min)
cd supercmd-backend && npm install esbuild --no-save --prefix scripts
node scripts/build-extensions.js /tmp/catalog-output/catalog.json /tmp/build-output

# 5. Upload bundles to S3
aws s3 sync /tmp/build-output/bundles/ s3://supercmd-extensions/bundles/ \
  --cache-control "public, max-age=3600" --size-only

# 6. Clean up
rm -rf /tmp/catalog-output /tmp/build-output
```

---

## Install Count Tracking

- `POST /extensions/:name/install` — called after successful install (fire-and-forget)
- `POST /extensions/:name/uninstall` — called after uninstall
- Optionally authenticated (JWT) — records `user_sub` if logged in, `machine_id` otherwise
- Machine ID is a random UUID stored at `~/Library/Application Support/SuperCmd/.machine-id`
- Install count is incremented on `extension_catalog.install_count` and visible in catalog responses
