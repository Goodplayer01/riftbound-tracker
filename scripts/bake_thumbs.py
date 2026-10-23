#!/usr/bin/env python3
"""Bake small WebP thumbnails of every card image into public/thumbs/.

The card grids show ~200 px wide tiles, but the image URLs in cards.json point
at the full 744x1039 originals (~1 MB each). The installer ships these
thumbnails so grids render instantly from disk; the original is only loaded
for the large card view (and cached on disk by the Electron main process).

public/thumbs/index.json maps card id -> source image URL. The app only uses a
thumbnail whose source matches the card's current image. Thumbnails already in
the folder for an unchanged URL are kept, so repeat runs only fetch new images.

Runs in the Release workflow (the sandbox proxy blocks the image hosts).
Usage: python scripts/bake_thumbs.py [--cards PATH] [--out DIR]
"""
from __future__ import annotations

import argparse
import io
import json
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MAX_W = 400  # 2x the widest grid tile
MAX_H = 560
QUALITY = 82
WORKERS = 16
UA = "DeakrixRiftboundTracker/thumbs (card images)"


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "image/*,*/*"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError("unreachable")


def make_thumb(data: bytes) -> bytes:
    im = Image.open(io.BytesIO(data))
    im = im.convert("RGBA") if im.mode in ("P", "LA", "RGBA") else im.convert("RGB")
    # Battlefields are landscape, so bound both sides.
    im.thumbnail((MAX_W, MAX_W) if im.width > im.height else (MAX_W, MAX_H), Image.LANCZOS)
    out = io.BytesIO()
    im.save(out, "WEBP", quality=QUALITY, method=6)
    return out.getvalue()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cards", default=str(ROOT / "public" / "cards.json"))
    ap.add_argument("--out", default=str(ROOT / "public" / "thumbs"))
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    index_path = out / "index.json"
    try:
        old = json.loads(index_path.read_text(encoding="utf-8")).get("byId", {})
    except (OSError, ValueError):
        old = {}

    cards = [c for c in json.loads(Path(args.cards).read_text(encoding="utf-8"))["cards"] if c.get("image")]
    by_id: dict[str, str] = {}
    todo: list[dict] = []
    for c in cards:
        if old.get(c["id"]) == c["image"] and (out / f"{c['id']}.webp").exists():
            by_id[c["id"]] = c["image"]
        else:
            todo.append(c)

    failed: list[str] = []

    def work(c: dict) -> None:
        try:
            (out / f"{c['id']}.webp").write_bytes(make_thumb(fetch(c["image"])))
            by_id[c["id"]] = c["image"]
        except Exception as e:  # noqa: BLE001 - one bad image must not stop the bake
            failed.append(f"{c['id']}: {e}")

    with ThreadPoolExecutor(WORKERS) as pool:
        list(pool.map(work, todo))

    # Drop thumbnails of cards that left the catalog or failed this run.
    for f in out.glob("*.webp"):
        if f.stem not in by_id:
            f.unlink()

    index_path.write_text(json.dumps({"v": 1, "byId": dict(sorted(by_id.items()))}, separators=(",", ":")), encoding="utf-8")
    size = sum(f.stat().st_size for f in out.glob("*.webp"))
    print(f"thumbs: {len(by_id)}/{len(cards)} ready ({len(todo) - len(failed)} new, {len(failed)} failed), {size / 1e6:.1f} MB")
    for line in failed[:20]:
        print("  failed", line)
    if len(by_id) < len(cards) * 0.9:
        sys.exit("too many thumbnails missing")


if __name__ == "__main__":
    main()
