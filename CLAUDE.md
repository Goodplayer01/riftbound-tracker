# CLAUDE.md

Notes for Claude Code working in this repo. The README is the user-facing feature list; this file is how the code and the release process fit together.

## Project

- Deakrix Riftbound Tracker: Windows desktop app for the Riftbound TCG (collection, wishlist, decks, prices, sales, borrowed cards, stores, booster sim "Dopamin").
- Made by Stefan (GitHub `Goodplayer01`). The app icon is his Bengal cat Dante.
- Riftbound only. Don't add other card games or make things generic for other TCGs.
- Stefan writes German. Answer him in German. Code, comments, commit messages and the README stay in English. The app UI is German and English (`src/i18n.ts`, German is the default).

## Stack

- Electron 37 + React 19 + Vite 7 + TypeScript. Windows NSIS installer via electron-builder, auto-update via electron-updater from GitHub Releases.
- `electron/main.cjs`: window, updater, IPC (`net:fetchJson`, `net:fetchImageDataUrl`, `shell:openExternal`, window controls) and the `rbimg://` image cache protocol. `electron/preload.cjs` exposes these to the renderer.
- `src/App.tsx` holds most of the UI (one big file, ~4700 lines). Helpers live in their own modules (`prices.ts`, `priceHistory.ts`, `copies.ts`, `cardmarket.ts`, `cardImages.ts`, `deckHelpers.ts`, `banlist.ts`, `storage.ts`, ...).
- Styling in `src/styles.css`: dark "Apple look", graphite surfaces with amber accent, sidebar navigation. Icons from Lucide (`src/Icon.tsx`).
- No test framework. The `scripts/check_*.mjs` / `check-dopamin.mjs` files are plain assertion scripts that run in the Release workflow.

## Commands

```
npm ci
npm run dev:app      # Vite + Electron for local development
npm run build        # tsc --noEmit + vite build (use this to check a change compiles)
npm run dist         # build + Windows installer into release/
node --experimental-strip-types scripts/check_v050.mjs   # same for check_v080, check_copies, check-dopamin
node scripts/check_errata.mjs
```

## Data files (public/)

- `cards.json`: all cards (type `Card` in `src/types.ts`). Images point at Riot's official gallery; `scripts/bake_images.py` (workflow "Bake card images") swaps in official art.
- `prices.json`: Cardmarket prices from the public daily price guide (`downloads.s3.cardmarket.com`, low, 30 day avg, trend, foil), matched by `cmId` (Cardmarket idProduct). The app loads it live from `raw.githubusercontent.com/.../main/public/prices.json` at startup (cached as `rb.prices.remote.v1`), falling back to the bundled copy. New prices therefore need no release, only a push to main. Prices have no per-language split, so a copy's language does not change its value.
- `price-history.json`: one snapshot per price update, also loaded live from main. Drives the Wertverlauf view (`src/ValueHistory.tsx`).
- `card-errata.json`: official errata keyed by lower case card name. Baked by `scripts/bake_errata.mjs` from playriftbound.com articles (add new articles to `PAGES`). Shown as a blue "Errata" pill next to the ban badge and under the card in the detail view.
- `card-keywords.json`, `sets/`, `packs/`, `displays/`, `domains/`, `symbols/`, `flags/`: static assets.
- `thumbs/`: WebP thumbnails, gitignored. Baked by `scripts/bake_thumbs.py` in the Release workflow and shipped in the installer.

## Card images

- Grids use the bundled thumbnails from `public/thumbs/` (only when `thumbs/index.json` says the source URL still matches the card's image).
- Full art goes through `rbimg://card/?u=<url>`, which the Electron main process caches on disk.
- Grids are lazy. Speed matters more than app size or memory: Stefan and his users run high-end PCs, so prefer caching and preloading over saving space.

## localStorage keys

Keep these keys and their shapes backward compatible. Users' collections live here, and there is no server.

- `rb.collection.v1`: `{ [cardId]: { qty, foil } }`. Don't change this shape.
- `rb.copies.v1`: per-copy language, condition and purchase price (`src/copies.ts`), layered on top of the collection counts.
- `rb.backup.v1`: automatic backup.
- `rb.decks.v1`, `rb.wishlist.v1`, `rb.wishTargets.v1` (price alert targets), `rb.wishAlertsSeen.v1`, `rb.sales.v1`, `rb.borrowed.v1`, `rb.poolHidden`, `riftbound-lang`.

If a shape has to change, add a new versioned key and migrate from the old one.

## Workflows (.github/workflows)

- `release.yml` (manual, "Run workflow"): runs the check scripts, bakes thumbnails, builds the installer on windows-latest and publishes the GitHub release `v<package.json version>`. **All releases go through this workflow.** Claude cannot create releases directly (403). To release: bump `version` in `package.json` on main, then start the workflow (`gh workflow run release.yml` or via the GitHub MCP).
- `prices.yml` (daily 04:00 UTC + manual): `bake_prices.py` (Cardmarket's public price guide for game 22, no secret) and `bake_price_history.py`, commits `prices.json` and `price-history.json` to main.
- `thumbs.yml`: checks thumbnail baking on PRs that touch `cards.json`.
- `bake-images.yml` (manual): official Riot card images into `cards.json`.

The cloud sandbox proxy blocks the card image hosts and playriftbound.com, so image and errata baking runs in workflows (or errata get added by hand).

## Conventions

- Commit messages: `vX.Y.Z: short summary` for releases, plain summary otherwise.
- Work on a branch and open a PR; Stefan merges.
- Cardmarket export: wants list as text, sell list as CSV with `idProduct` and trend price (`src/cardmarket.ts`).
- Fan project, not affiliated with Riot Games or UVS Games. Domain icons are drawn for the app, not Riot's artwork.
