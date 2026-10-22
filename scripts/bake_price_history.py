#!/usr/bin/env python3
"""Append the current public/prices.json to public/price-history.json.

The app loads price-history.json live from main (like prices.json) and draws the
value chart and the biggest movers from it. One point per prices.json bake
(keyed by updatedAt); the newest point per day wins. Points from the last
DAILY_DAYS days are kept as they are, older ones thinned to one per week, so the
file stays small enough to download at every start.

Per card the history stores the same unit prices the app uses for the
collection value, in euro cents (0 = no price): normal = low, else trend;
foil = foilLow, else foilTrend, else normal. Card i in "ids" is entry i in
every point's "n" (normal) and "f" (foil) list.

  python scripts/bake_price_history.py             # add the current prices.json
  python scripts/bake_price_history.py --from-git  # rebuild from every committed prices.json
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRICES_PATH = ROOT / "public" / "prices.json"
HISTORY_PATH = ROOT / "public" / "price-history.json"
DAILY_DAYS = 92
# Placeholder listings (10000 EUR foils) must not end up in the chart.
MAX_UNIT = 5000


def units(entry: dict) -> tuple[float | None, float | None]:
    def ok(v):
        return v if isinstance(v, (int, float)) and 0 < v < MAX_UNIT else None

    n = ok(entry.get("low"))
    if n is None:
        n = ok(entry.get("trend"))
    f = ok(entry.get("foilLow"))
    if f is None:
        f = ok(entry.get("foilTrend"))
    if f is None:
        f = n
    return n, f


def load_history() -> dict:
    if HISTORY_PATH.exists():
        return json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
    return {"ids": [], "points": []}


def add_point(history: dict, book: dict) -> bool:
    at = book.get("updatedAt")
    cards = book.get("cards") or {}
    if not at or not cards:
        return False
    if any(p["at"] == at for p in history["points"]):
        return False
    ids: list[str] = history["ids"]
    index = {cid: i for i, cid in enumerate(ids)}
    for cid in cards:
        if cid not in index:
            index[cid] = len(ids)
            ids.append(cid)
    n = [0] * len(ids)
    f = [0] * len(ids)
    for cid, entry in cards.items():
        a, b = units(entry)
        n[index[cid]] = round(a * 100) if a is not None else 0
        f[index[cid]] = round(b * 100) if b is not None else 0
    points = [p for p in history["points"] if p["at"][:10] != at[:10]]
    points.append({"at": at, "n": n, "f": f})
    points.sort(key=lambda p: p["at"])
    history["points"] = thin(points)
    return True


def thin(points: list[dict]) -> list[dict]:
    """Keep every point of the last DAILY_DAYS days, before that the newest per ISO week."""
    latest = date.fromisoformat(points[-1]["at"][:10])
    out: list[dict] = []
    week_seen: set[tuple[int, int]] = set()
    for p in reversed(points):
        d = date.fromisoformat(p["at"][:10])
        if (latest - d).days > DAILY_DAYS:
            week = d.isocalendar()[:2]
            if week in week_seen:
                continue
            week_seen.add(week)
        out.append(p)
    return list(reversed(out))


def committed_books():
    revs = subprocess.run(
        ["git", "log", "--reverse", "--format=%H", "--", "public/prices.json"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    ).stdout.split()
    for rev in revs:
        raw = subprocess.run(
            ["git", "show", f"{rev}:public/prices.json"],
            cwd=ROOT, capture_output=True, text=True, check=True,
        ).stdout
        yield json.loads(raw)


def main() -> None:
    if "--from-git" in sys.argv:
        history = {"ids": [], "points": []}
        for book in committed_books():
            add_point(history, book)
    else:
        history = load_history()
    changed = add_point(history, json.loads(PRICES_PATH.read_text(encoding="utf-8")))
    if not changed and "--from-git" not in sys.argv:
        print("price-history.json already has this prices.json")
        return
    history["updatedAt"] = history["points"][-1]["at"]
    HISTORY_PATH.write_text(json.dumps(history, separators=(",", ":")), encoding="utf-8")
    print(f"price-history.json: {len(history['points'])} points, {len(history['ids'])} cards")


if __name__ == "__main__":
    main()
