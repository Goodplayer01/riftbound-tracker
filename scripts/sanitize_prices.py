#!/usr/bin/env python3
"""Drop placeholder offers from public/prices.json.

Fresh sets often have a single foil listing at 10000 EUR as the only offer, so
Cardmarket's foil low is 10000 while the card trades for cents. A price more
than OUTLIER_FACTOR times the card's other prices is set to None.
Runs on its own or via sanitize() from the bake scripts.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRICES_PATH = ROOT / "public" / "prices.json"
PRICE_FIELDS = ("low", "avg30", "trend", "foilLow", "foilTrend")
OUTLIER_FACTOR = 50
MIN_OUTLIER = 20  # never touch prices below this


def sanitize(book: dict) -> list[str]:
    dropped = []
    for cid, entry in book.items():
        for field in PRICE_FIELDS:
            x = entry.get(field)
            if x == 0:
                entry[field] = None
                dropped.append(f"{cid}.{field}=0")
                continue
            if not isinstance(x, (int, float)) or x < MIN_OUTLIER:
                continue
            others = [entry.get(f) for f in PRICE_FIELDS if f != field]
            ref = max([y for y in others if isinstance(y, (int, float)) and y > 0], default=0)
            if ref and x > OUTLIER_FACTOR * ref:
                entry[field] = None
                dropped.append(f"{cid}.{field}={x}")
    return dropped


def main() -> None:
    doc = json.loads(PRICES_PATH.read_text(encoding="utf-8"))
    dropped = sanitize(doc["cards"])
    if dropped and "--touch" in sys.argv:
        # Installed apps keep the newest updatedAt, so a fix needs a new stamp.
        doc["updatedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    PRICES_PATH.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"dropped={len(dropped)} {dropped}")


if __name__ == "__main__":
    main()
