# Riftbound Tracker

Windows desktop app for **Riftbound only**: collection tracking, bulk code import, CSV, and deck building.

## Download

Get the latest `RiftboundTracker-Setup-*.exe` from [Releases](https://github.com/Goodplayer01/riftbound-tracker/releases).

The app checks GitHub Releases for updates on startup.

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
- No other TCGs.
- Unsigned installer may trigger Windows SmartScreen until a code-signing cert is added.
