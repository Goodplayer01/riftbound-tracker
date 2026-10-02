# Deakrix Riftbound Tracker

Windows desktop app for **Riftbound** (Riot’s TCG) only. Track a physical collection, browse the catalog with Cardmarket prices, build and import decks, and test opening hands — all offline on your PC.

## Download

Get the latest `RiftboundTracker-Setup-*.exe` from [Releases](https://github.com/Goodplayer01/riftbound-tracker/releases).

The app checks GitHub Releases for updates on startup.

## Features

- **Collection** — track owned copies (normal + foil) per printing; binder-style overview by set; optional hide for Nexus Night binders; click art to enlarge card scan
- **Catalog** — full Riftbound card list with domain, rarity, promo / signed / overnumbered filters and “owned only”; enlarge card art to read effects
- **Keywords** — official short glossary (Ambush, Reaction, Show Off, …) in the card enlarge lightbox (DE/EN); static map, no runtime scrape. Sources: Core Rules 2026-07-16 (Rules Hub) + Radiance overview for set mechanics
- **Prices** — Cardmarket Low and Avg30 (English products preferred; other languages only when no EN printing exists); deep links to Cardmarket
- **Deck builder** — Legend, Champion, Main Deck, Battlefields, Runes, Sideboard; drag-and-drop; max 3 copies per card name; ban badges (Standard and 2v2)
- **Ban badges** — Standard and 2v2-only marks on Sammlung / Katalog tiles and in the deck builder (non-blocking)
- **Deck import** — paste deck lists (including Rune Pool); missing-copy summary with Cardmarket links; add missing copies to the collection in one click
- **Hand tester** — opening hand / mulligan for First or Second
- **Verkauf** — mark cards sold and track sale totals
- **Händler / Stores** — official UVS store locator by city/PLZ or GPS; KM slider + map with radius circle (no live stock)
- **UI** — German and English; data stays local on your PC (no account, no cloud)

Not a multi-TCG tool. Riftbound only.

## Develop

```bash
npm install
npm run dev:app
```

## Build installer

```bash
npm run dist
```

Output: `release/RiftboundTracker-Setup-<version>.exe`

## Notes

- Collection data stays on your PC (localStorage in the app profile).
- Unsigned installer may trigger Windows SmartScreen until a code-signing cert is added.
