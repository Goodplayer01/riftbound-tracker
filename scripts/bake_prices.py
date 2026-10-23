#!/usr/bin/env python3
"""Refresh public/prices.json from Cardmarket's public price guide.

Cardmarket publishes a daily price guide and product list per game as plain JSON
(no API key, no account). Riftbound is game 22:
  - price_guide_22.json: per idProduct low / trend / avg1 / avg7 / avg30, same for foil
  - products_singles_22.json: idProduct, name, idExpansion

Rows are matched by the cmId (Cardmarket idProduct) already stored per card.
Rows without a cmId (mostly promos) are matched once by name inside the
expansion their cmUrl points at; only unambiguous matches are taken.

Language policy (EN-first, fallback):
  - Prefer English site-locale cmUrls (/en/...) and append ?language=1 (English
    article filter; keep other query params).
  - The price guide is product-level and covers all article languages; it has no
    per-language split and no seller-country filter.
"""
from __future__ import annotations

import json
import re
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sanitize_prices import sanitize

ROOT = Path(__file__).resolve().parents[1]
PRICES_PATH = ROOT / "public" / "prices.json"
CARDS_PATH = ROOT / "public" / "cards.json"
CM_GAME_ID = 22
GUIDE_URL = f"https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_{CM_GAME_ID}.json"
PRODUCTS_URL = f"https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_{CM_GAME_ID}.json"

CARDMARKET_SITE_LOCALE = "en"
CARDMARKET_PRODUCT_LANGUAGE_ID = 1
CARDMARKET_PRODUCT_LANGUAGE = "English"


def fetch_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "riftbound-tracker-bake", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode())


def prefer_english_url(url: str | None) -> str | None:
    if not url:
        return url
    sp = urlsplit(url)
    segs = sp.path.split("/")
    # /{locale}/Riftbound/...
    if sp.netloc.endswith("cardmarket.com") and len(segs) > 1:
        segs[1] = CARDMARKET_SITE_LOCALE
    q = dict(parse_qsl(sp.query, keep_blank_values=True))
    q.pop("languageId", None)
    q["language"] = str(CARDMARKET_PRODUCT_LANGUAGE_ID)
    return urlunsplit((sp.scheme, sp.netloc, "/".join(segs), urlencode(q), sp.fragment))


def slug(s: str) -> str:
    """Cardmarket URL slug of a product name ("Kai'Sa, Survivor" -> "kaisa-survivor"); apostrophes are dropped."""
    s = re.sub(r"['’]", "", s)
    return re.sub(r"-+", "-", re.sub(r"[^A-Za-z0-9]+", "-", s)).strip("-").lower()


def url_parts(url: str | None) -> tuple[str, str, int | None] | None:
    """(expansion slug, product slug without version, version) from a cmUrl."""
    if not url:
        return None
    m = re.search(r"/Singles/([^/?#]+)/([^/?#]+)", url)
    if not m:
        return None
    name = m.group(2)
    v = re.search(r"-V(\d+)(?:-[A-Za-z-]+)?$", name)
    base = name[: v.start()] if v else name
    return m.group(1).lower(), base.lower(), int(v.group(1)) if v else None


def match_missing(book: dict, products: list[dict]) -> int:
    """Fill cmId for rows that have a cmUrl but no id, by expansion + name (+ V number)."""
    by_id = {p["idProduct"]: p for p in products}
    # Learn expansion slug -> idExpansion from rows that already have both.
    exp_votes: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    for e in book.values():
        parts = url_parts(e.get("cmUrl"))
        p = by_id.get(int(e["cmId"])) if e.get("cmId") else None
        if parts and p:
            exp_votes[parts[0]][p["idExpansion"]] += 1
    exp_of = {s: max(v, key=v.get) for s, v in exp_votes.items()}
    taken = {int(e["cmId"]) for e in book.values() if e.get("cmId")}
    by_name: dict[tuple[int, str], list[int]] = defaultdict(list)
    by_name_any: dict[str, list[int]] = defaultdict(list)
    for p in products:
        by_name[(p["idExpansion"], slug(p["name"]))].append(p["idProduct"])
        by_name_any[slug(p["name"])].append(p["idProduct"])
    matched = 0
    for e in book.values():
        if e.get("cmId"):
            continue
        parts = url_parts(e.get("cmUrl"))
        if not parts:
            continue
        exp_slug, name_slug, _version = parts
        cands = by_name.get((exp_of[exp_slug], name_slug), []) if exp_slug in exp_of else by_name_any.get(name_slug, [])
        # Only a single product with that name is safe: Cardmarket's V1/V2/... does not follow idProduct order.
        if len(cands) != 1 or cands[0] in taken:
            continue
        pick = cands[0]
        e["cmId"] = str(pick)
        taken.add(pick)
        matched += 1
    return matched


def apply_guide(entry: dict, g: dict) -> None:
    entry["low"] = g.get("low")
    entry["avg30"] = g.get("avg30")
    entry["trend"] = g.get("trend")
    entry["foilLow"] = g.get("low-foil")
    entry["foilTrend"] = g.get("trend-foil")


def main() -> None:
    prices_doc = json.loads(PRICES_PATH.read_text(encoding="utf-8"))
    cards = {c["id"]: c for c in json.loads(CARDS_PATH.read_text(encoding="utf-8"))["cards"]}
    book = prices_doc.setdefault("cards", {})

    guide_doc = fetch_json(GUIDE_URL)
    guide = {g["idProduct"]: g for g in guide_doc["priceGuides"]}
    products = fetch_json(PRODUCTS_URL)["products"]
    if len(guide) < 500 or len(products) < 500:
        # A truncated download must never wipe the prices on main.
        raise SystemExit(f"price guide looks incomplete: guide={len(guide)} products={len(products)}")

    newly_matched = match_missing(book, products)

    updated = 0
    missing = 0
    for entry in book.values():
        cm = entry.get("cmId")
        g = guide.get(int(cm)) if cm else None
        if not g:
            missing += 1 if cm else 0
            continue
        apply_guide(entry, g)
        entry["languageId"] = CARDMARKET_PRODUCT_LANGUAGE_ID
        updated += 1

    prices_doc["updatedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    prices_doc["guideCreatedAt"] = guide_doc.get("createdAt")
    prices_doc["currency"] = prices_doc.get("currency") or "EUR"
    prices_doc["source"] = "cardmarket"
    prices_doc["language"] = CARDMARKET_PRODUCT_LANGUAGE
    prices_doc["languageId"] = CARDMARKET_PRODUCT_LANGUAGE_ID
    prices_doc["languagePreference"] = "en-first"
    prices_doc["languageFallback"] = True
    prices_doc["sellerCountryFilter"] = None
    prices_doc["sellerCountryNote"] = (
        "Prices come from Cardmarket's public price guide, which is product-level "
        "across all article languages and seller countries."
    )

    # Ensure every priced row has EN-preferred URL + languageId
    for entry in book.values():
        entry["cmUrl"] = prefer_english_url(entry.get("cmUrl"))
        if entry.get("languageId") is None:
            entry["languageId"] = CARDMARKET_PRODUCT_LANGUAGE_ID

    no_id = sum(1 for e in book.values() if not e.get("cmId"))
    unmatched = [cid for cid in cards if cid not in book]
    print(
        f"guide={guide_doc.get('createdAt')} updated={updated} newly_matched={newly_matched} "
        f"id_not_in_guide={missing} rows_without_id={no_id} catalog_without_price={len(unmatched)}"
    )
    print(f"dropped_outliers={len(sanitize(book))}")

    PRICES_PATH.write_text(
        json.dumps(prices_doc, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    sys.exit(main())
