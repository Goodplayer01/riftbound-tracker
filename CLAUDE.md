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
- `src/App.tsx` holds most of the UI (one big file, ~5100 lines). Helpers live in their own modules (`prices.ts`, `priceHistory.ts`, `copies.ts`, `cardmarket.ts`, `cardImages.ts`, `deckHelpers.ts`, `banlist.ts`, `storage.ts`, ...).
- Styling in `src/styles.css`: dark "Apple look", graphite surfaces with amber accent, sidebar navigation. Icons from Lucide (`src/Icon.tsx`).
- No test framework. The `scripts/check_*.mjs` / `check-dopamin.mjs` files are plain assertion scripts that run in the Release workflow.
- Stefan's PC has no Python (only the Microsoft Store alias), so Python bake scripts run in the GitHub workflows, e.g. `gh workflow run prices.yml --ref <branch>`.

## UI structure

- Sidebar tabs (`Tab` in App.tsx): `collection` is labelled "Sets" (set binders, wishlist, value history); `owned` is "All owned", the owned binder (`binderView === 'owned'`, kept in sync with the tab by an effect) with a set filter (`ownedSet`) a sort select (`ownedSort`: by set, or by the price of one owned copy, foil price when only foils are owned) a Borrowed only toggle (`ownedBorrowedOnly`: only cards borrowed from someone) and a Not in a deck toggle (`ownedNotInDeck`: no deck uses the card, via `decksByCard`); the toggles combine (AND) and none is persisted. Then Catalogue, Sales, Decks, Borrowed, Stores, Dopamin.
- Stores tab has two views (`storeView`): Displays (`src/StoreDisplays.tsx` + `src/displays.ts`, the display price comparison) and the store locator map. Displays reads `sealed.json`, asks the listed shops again live (Shopify `/search/suggest.json`, WooCommerce Store API, both allowed in `net:fetchJson` only for the fixed Riftbound queries) and CardTrader through `net:cardtrader` with the user's token. Title parsing (display / language / set) exists twice, in `displays.ts` and `scripts/bake_sealed.py`: keep both in sync, `scripts/check_displays.mjs` covers the TS side.
- Borrowed tab: a `BorrowedGroup` without `direction` is lent to that person (copies leave `availableForDecks`); `direction: 'from'` means borrowed from them (copies add to `availableForDecks`, show in All owned with the purple `BorrowedBadge`: one pill per person, "Borrowed from <name> ×n" from `borrowedFromById` / `borrowedInFrom`; when space runs out the prefix is cut first, name and count stay visible, never touch `rb.collection.v1`, value or set progress). Export / import format is `src/borrowList.ts` (`qty code name` lines; a lent list pasted into an empty entry turns it into "borrowed from"), covered by `scripts/check_borrow.mjs`.
- Deck builder rune section: the search list hides plain runes (`isPlainRune`), those have the per-domain counter. Every other rune is listed: alt art and the Nexus Night runes (set `*-NN`, rarity Showcase, so not plain and not covered by the counters).
- Search lists on the right (wishlist, sales, decks, borrowed) all render through `pickerCard(c, { owns, draggable, note, add })`: same tags line, price boxes, "Owns" column (`.row-stat`, like the deck rows) and add button. Change the look there once, never per tab. Decks pass `availableForDecks` as owns, the others the owned count.
- Keywords in the card detail come from the rules text (errata first) plus the baked `card-keywords.json`. Never detect them from the card name ("Thrill of the Hunt" is not Hunt).
- Card tiles are `CardTile`; list rows are `.list-item` (`.deck-card-row` in decks and borrowed, `.picker-card` in the search panels on the right). Clicking a tile or row opens the card detail unless the click hits a button or input (`isControlClick`).
- Deck usage: `decksByCard` maps a card id to `DeckUse[]` (deck id, name, copies over all sections). `DeckUses` renders the clickable "Deck ×n" pills on tiles and in the card detail; the tile art also gets an `.in-deck-flag` badge (total copies) in `.flags`. All of them call `openDeck(deckId)`, which closes the detail, switches to Decks and expands that deck.
- Card tile layout: set / ban / errata pills in `.card-tags` on their own line under the name, borrowed pills in `.borrowed-tags` (one line each), then prices and the normal / foil counters in `.tile-foot`, pinned to the bottom so they line up across a grid row. Deck rows put their pills in a `.card-tags` line under the name too, so the name keeps the full width in window mode.
- Prices: `PriceBits` is the only price display, `.price-boxes` with a small label over the value (From / Ø30 / Foil; foil only cards get one Foil box). Tiles stretch the boxes, list rows (`.list-item .price-boxes`) keep them compact and wrap. The card detail uses the bigger `.card-price-tiles`.
- Drag and drop: search cards set `text/riftbound-card` and drop into deck sections, wishlist, sales cart and borrowed (`onSectionDrop`, `cartDrop`, `onBorrowDrop`). Cards in those lists drag out with `removeDragProps` (`text/riftbound-remove`): a drop outside the panel marked `data-remove-src` removes one copy.
- Deck rows: Collection panel (normal / foil steppers, `collectionButtons`) and Owns / Need. The "Still missing" list groups by set and exports a Cardmarket wants list. Runes show one counter per Legend domain.
- Dopamin (`src/Dopamin.tsx`, `src/dopaminPacks.ts`): pack layout from Riot's Radiance overview, rates as constants with their source in `dopaminPacks.ts`. Slots without a published rate (token / alt rune, foil split) set `estimate` and the UI says so. `scripts/check-dopamin.mjs` checks layout and simulated rates.
- Check `styles.css` before naming a new class. Reusing an existing name (e.g. `.deck-stat`, the deck header value tiles) silently pulls in its styles.
- To look at a UI change, load `dist/index.html` in a hidden Electron `BrowserWindow` with a throwaway `userData` dir, seed localStorage, click via `executeJavaScript` and save `webContents.capturePage()` (register an `rbimg` handler that forwards to `net.fetch` so card art loads).

## Commands

```
npm ci
npm run dev:app      # Vite + Electron for local development
npm run build        # tsc --noEmit + vite build (use this to check a change compiles)
npm run dist         # build + Windows installer into release/
node --experimental-strip-types scripts/check_v050.mjs   # same for check_v080, check_copies, check-dopamin, check_displays, check_borrow
node scripts/check_errata.mjs
```

## Data files (public/)

- `cards.json`: all cards (type `Card` in `src/types.ts`). Images point at Riot's official gallery; `scripts/bake_images.py` (workflow "Bake card images") swaps in official art.
- `prices.json`: Cardmarket prices from the public daily price guide (`downloads.s3.cardmarket.com`, game 22: low, 30 day avg, trend, foil; no max), matched by `cmId` (Cardmarket idProduct). Rows without a `cmId` are matched by expansion and name only when exactly one product fits: Cardmarket's V1/V2/... do not follow idProduct order, so never pick a print by V number. `sanitize_prices.py` drops zero values, outliers and placeholder asks of 5000 EUR+ with no sales. Cardmarket product pages answer scripts with 403, so links can only be checked against `products_singles_22.json`.
- `cmUrl` is stored canonical (`/en/...?language=1`). The app builds the real link per click in `cmLink`: site locale from the app language, `sellerCountry=7` (Germany) and `language=1` (English copies). The app loads it live from `raw.githubusercontent.com/.../main/public/prices.json` at startup (cached as `rb.prices.remote.v1`), falling back to the bundled copy. New prices therefore need no release, only a push to main. Prices have no per-language split, so a copy's language does not change its value.
- `sealed.json`: display prices for the Store tab, baked daily by `scripts/bake_sealed.py`: Cardmarket price guide rows for sealed products (`products_nonsingles_22.json`, set learned from the singles' idExpansion), the German shops that answer an open product search (UVS store list + `ONLINE_SHOPS`) and their display offers. Loaded live from main. The Cardmarket API takes no new private apps; CardTrader has a real API but needs each user's own token.
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
- `rb.copies.v1`: per-copy language, condition and purchase price (`src/copies.ts`), layered on top of the collection counts. A lot can carry `pulled: true` (opened from a pack: no `buy`, counted in the value, left out of paid / profit); older lots simply lack the field. `splitLot` moves one copy into its own lot so copies can have different prices.
- `rb.backup.v1`: automatic backup.
- `rb.decks.v1`, `rb.wishlist.v1`, `rb.wishTargets.v1` (price alert targets), `rb.wishAlertsSeen.v1`, `rb.sales.v1`, `rb.borrowed.v1`, `rb.poolHidden`, `riftbound-lang`.
- `rb.dopamin.v1`: Dopamin counters per set, `{ [set]: { packs, spent, value, best?: { id, eur } } }` (Cardmarket trend for packs and cards).
- `rb.displayTargets.v1`: max display price, `{ [set or "SET:LANG"]: eur }` (English uses the plain set code). `rb.cardtrader.token.v1` (the user's CardTrader token) and `rb.cardtrader.blueprints.v1` (3 day cache of CardTrader display blueprints).

If a shape has to change, add a new versioned key and migrate from the old one.

## Workflows (.github/workflows)

- `release.yml` (manual, "Run workflow"): runs the check scripts, bakes thumbnails, builds the installer on windows-latest and publishes the GitHub release `v<package.json version>`. **All releases go through this workflow.** Claude cannot create releases directly (403). To release: bump `version` in `package.json` on main, then start the workflow (`gh workflow run release.yml` or via the GitHub MCP).
- `prices.yml` (daily 04:00 UTC + manual): `bake_prices.py` (Cardmarket's public price guide for game 22, no secret) and `bake_price_history.py`, then `bake_sealed.py` (may fail without blocking prices), commits `prices.json`, `price-history.json` and `sealed.json` to main.
- `thumbs.yml`: checks thumbnail baking on PRs that touch `cards.json`.
- `bake-images.yml` (manual): official Riot card images into `cards.json`.

The cloud sandbox proxy blocks the card image hosts and playriftbound.com, so image and errata baking runs in workflows (or errata get added by hand).

One-off scripts no workflow runs: `bake_rules_text.py` (rules text from the playriftbound.com card gallery into `cards.json`), `bake_rad_cm.py` (maps RAD cards to Cardmarket products, uses `cm_rad_slugs.json`), `rebake_cm_urls.py` (rewrites `cmUrl` to the canonical English form, uses `cm_url_overrides.json`).

## Conventions

- Commit messages: `vX.Y.Z: short summary` for releases, plain summary otherwise.
- Work on a branch and open a PR. Merge and release only when Stefan says so ("merge und release"): then bump the version, `gh pr merge <n> --squash --delete-branch`, and start `release.yml`.
- Cardmarket export: wants list as text, sell list as CSV with `idProduct` and trend price (`src/cardmarket.ts`).
- Fan project, not affiliated with Riot Games or UVS Games. Domain icons are drawn for the app, not Riot's artwork.
