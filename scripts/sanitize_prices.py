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
# A low this high with no trend and no 30 day average (normal or foil) is a placeholder
# listing (the usual 10000 EUR one), not a price. Real signed cards sell for 300-2000.
UNSOLD_ASK_LIMIT = 5000


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
        unsold = entry.get("trend") is None and entry.get("avg30") is None and entry.get("foilTrend") is None
        for field in ("low", "foilLow"):
            x = entry.get(field)
            if unsold and isinstance(x, (int, float)) and x >= UNSOLD_ASK_LIMIT:
                entry[field] = None
                dropped.append(f"{cid}.{field}={x} (no sales)")
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
