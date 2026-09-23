#!/usr/bin/env python3
"""Rewrite Cardmarket cmUrl version suffixes from catalog roles (not CM price rank).

Rules (per set + name + subtitle group):
  - Leave non-versioned singles alone (no -Vn- suffix).
  - altArt / code *a*: V2-Showcase
  - overnumbered && !signed:
      V2-Overnumbered if no alt-showcase sibling, else V3-Overnumbered
  - signed + Rare rarity: V3-Signed-Showcase  (VEN/UNL style)
  - signed + Showcase (or showcase tags / ON legends):
      V3-Overnumbered when no alt sibling;
      if alt sibling exists (ON already V3-Overnumbered) → V3-Signed-Showcase
  - base (!ON && !signed && !alt) with versioned URL: V1-{Rarity}

Hard overrides (user-verified) win last.
Keeps cmId and all price fields.
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CARDS_PATH = ROOT / "public" / "cards.json"
PRICES_PATH = ROOT / "public" / "prices.json"
OVERRIDES_PATH = ROOT / "scripts" / "cm_url_overrides.json"

VERSIONED = re.compile(r"^(?P<stem>.+)-V(?P<n>\d+)-(?P<rest>.+)$")

# User-verified CM slugs (full URL). Applied after role bake.
HARD_OVERRIDES = {
    "ogn-303-star-298": "https://www.cardmarket.com/de/Riftbound/Products/Singles/Origins/Ahri-Nine-Tailed-Fox-V3-Overnumbered",
    "ogn-303-298": "https://www.cardmarket.com/de/Riftbound/Products/Singles/Origins/Ahri-Nine-Tailed-Fox-V2-Overnumbered",
    "ven-197-star-166": "https://www.cardmarket.com/de/Riftbound/Products/Singles/Vendetta/Kennen-Heart-of-the-Tempest-V3-Signed-Showcase",
}


def is_alt(c: dict) -> bool:
    if c.get("altArt"):
        return True
    code = (c.get("code") or "").split("/")[0]
    return bool(re.search(r"\da$", code, re.I))


def group_key(c: dict) -> tuple:
    return (c.get("set"), c.get("name"), c.get("subtitle"))


def suffix_for(c: dict, has_alt: bool, has_base: bool) -> str | None:
    rarity = c.get("rarity") or "Rare"

    if is_alt(c):
        return "V2-Showcase"

    if c.get("signed"):
        # Rare signed (Kennen VEN / UNL style) → Signed-Showcase
        if rarity == "Rare":
            return "V3-Signed-Showcase"
        # Showcase-style signed ON legends
        if has_alt:
            # Unsigned ON already claims V3-Overnumbered
            return "V3-Signed-Showcase"
        # Daughter/Ahri: base rare exists → signed V3; ON-only groups → signed V2
        return "V3-Overnumbered" if has_base else "V2-Overnumbered"

    if c.get("overnumbered"):
        if has_alt:
            return "V3-Overnumbered"
        # With a base rare/epic sibling → V2 (Daughter). ON-only in set → V1 (CM).
        return "V2-Overnumbered" if has_base else "V1-Overnumbered"

    # Base print with a versioned URL already
    return f"V1-{rarity}"


def rewrite_url(url: str, new_suffix: str) -> str | None:
    if not url:
        return None
    parts = url.rstrip("/").split("/")
    slug = parts[-1]
    m = VERSIONED.match(slug)
    if not m:
        return None  # keep non-versioned
    new_slug = f"{m.group('stem')}-{new_suffix}"
    if new_slug == slug:
        return url
    parts[-1] = new_slug
    return "/".join(parts)


def main() -> None:
    cards_doc = json.loads(CARDS_PATH.read_text(encoding="utf-8"))
    prices_doc = json.loads(PRICES_PATH.read_text(encoding="utf-8"))
    cards = cards_doc["cards"]
    prices = prices_doc["cards"]
    by_id = {c["id"]: c for c in cards}

    groups: dict[tuple, list] = defaultdict(list)
    for c in cards:
        groups[group_key(c)].append(c)

    has_alt_by_key = {
        k: any(is_alt(c) for c in gs) for k, gs in groups.items()
    }
    has_base_by_key = {
        k: any(
            (not c.get("overnumbered"))
            and (not c.get("signed"))
            and (not is_alt(c))
            for c in gs
        )
        for k, gs in groups.items()
    }

    # Merge file overrides if present
    overrides = dict(HARD_OVERRIDES)
    if OVERRIDES_PATH.exists():
        overrides.update(json.loads(OVERRIDES_PATH.read_text(encoding="utf-8")))

    changed = []
    skipped_non_versioned = 0
    missing_card = 0

    for cid, entry in list(prices.items()):
        url = entry.get("cmUrl")
        if not url:
            continue

        if cid in overrides:
            new_url = overrides[cid]
            if new_url != url:
                entry["cmUrl"] = new_url
                changed.append((cid, url, new_url, "override"))
            continue

        card = by_id.get(cid)
        if not card:
            missing_card += 1
            continue

        slug = url.rstrip("/").split("/")[-1]
        if not VERSIONED.match(slug):
            skipped_non_versioned += 1
            continue

        key = group_key(card)
        has_alt = has_alt_by_key[key]
        has_base = has_base_by_key[key]
        suf = suffix_for(card, has_alt, has_base)
        if not suf:
            continue
        new_url = rewrite_url(url, suf)
        if new_url and new_url != url:
            entry["cmUrl"] = new_url
            changed.append((cid, url, new_url, suf))

    # Persist overrides map for known specials
    OVERRIDES_PATH.write_text(
        json.dumps(overrides, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    PRICES_PATH.write_text(
        json.dumps(prices_doc, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(f"changed={len(changed)} non_versioned_kept={skipped_non_versioned} missing_card={missing_card}")
    for cid, old, new, why in changed:
        print(f"  {cid}: {old.split('/')[-1]} -> {new.split('/')[-1]} ({why})")

    # Hard-patch verify
    expect = {
        "ogn-303-star-298": "Ahri-Nine-Tailed-Fox-V3-Overnumbered",
        "ogn-303-298": "Ahri-Nine-Tailed-Fox-V2-Overnumbered",
        "ven-197-star-166": "Kennen-Heart-of-the-Tempest-V3-Signed-Showcase",
        "sfd-225-star-221": "Irelia-Fervent-V3-Signed-Showcase",
    }
    print("\nVERIFY:")
    ok = True
    for cid, slug in expect.items():
        got = (prices[cid].get("cmUrl") or "").split("/")[-1]
        status = "OK" if got == slug else "FAIL"
        if status != "OK":
            ok = False
        print(f"  {status} {cid}: {got}")
    if not ok:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
