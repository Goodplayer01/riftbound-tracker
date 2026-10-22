#!/usr/bin/env python3
"""Replace unofficial card images in public/cards.json with Riot's own.

Spoiler-era images (Piltover Archive, riftcompare, dotgg) are swapped for the
official card gallery image on cmsassets.rgpub.io once Riot lists the card.
Matching is by exact public code (e.g. RAD-001, RAD-172*), so promo and other
printings the gallery does not list keep their current image.

Usage: python scripts/bake_images.py [--dry-run]
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict

from bake_rules_text import CARDS_PATH, fetch_gallery, find_cards

OFFICIAL_HOST = "cmsassets.rgpub.io"


def norm_code(code: str) -> str:
    return (code or "").split("/")[0].strip().lower()


def image_url(card: dict) -> str:
    img = card.get("cardImage") or {}
    return img.get("url") or img.get("src") or ""


def main() -> None:
    dry = "--dry-run" in sys.argv
    pp = fetch_gallery()["props"]["pageProps"]

    by_code: dict[str, set[str]] = defaultdict(set)
    for c in find_cards(pp):
        url = image_url(c)
        if OFFICIAL_HOST in url:
            by_code[norm_code(c.get("publicCode") or "")].add(url)

    doc = json.loads(CARDS_PATH.read_text(encoding="utf-8"))
    replaced: Counter[str] = Counter()
    missing: Counter[str] = Counter()
    for card in doc["cards"]:
        if OFFICIAL_HOST in (card.get("image") or ""):
            continue
        urls = by_code.get(norm_code(card.get("code") or ""), set())
        if len(urls) == 1:
            card["image"] = next(iter(urls))
            replaced[card["set"]] += 1
        else:
            missing[card["set"]] += 1

    for s in sorted(set(replaced) | set(missing)):
        print(f"{s:8} replaced {replaced[s]:4}   still unofficial {missing[s]:4}")
    if dry:
        print("Dry run, cards.json unchanged")
        return
    CARDS_PATH.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Replaced {sum(replaced.values())} images → {CARDS_PATH}")


if __name__ == "__main__":
    main()
