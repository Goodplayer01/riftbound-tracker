#!/usr/bin/env python3
"""Refresh public/prices.json from TCG Cardmarket API.

Language policy (EN-first, fallback):
  - Prefer English site-locale cmUrls (/en/...).
  - Prefer languageId=1 (English) as the article-language preference marker.
  - If a product has no usable English market link, keep whatever cmUrl we already
    have (or build from another locale) — never drop the price row.
  - The upstream TCG Cardmarket API exposes product-level Low/Avg30 only; it has
    no per-language product split for Riftbound and no seller-country filter.

German sellers (sellerCountry / idSellerCountry):
  - Official MKM Articles endpoint supports sellerCountry=7 (Germany) for LIVE
    offers, but product price-guide fields (low / avg30 / trend) are global and
    not filterable by seller country.
  - This bake uses the TCG Cardmarket API product guide (no sellerCountry).
  - Skipping DE-seller Low/Avg30 rather than scraping articles.

Requires env TCG_CARDMARKET_API_KEY.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRICES_PATH = ROOT / "public" / "prices.json"
CARDS_PATH = ROOT / "public" / "cards.json"
BASE = "https://tcg-api-production-5148.up.railway.app"
BATCH = 10  # Free plan max; raise if plan allows

CARDMARKET_SITE_LOCALE = "en"
CARDMARKET_PRODUCT_LANGUAGE_ID = 1
CARDMARKET_PRODUCT_LANGUAGE = "English"


def api_key() -> str:
    k = os.environ.get("TCG_CARDMARKET_API_KEY") or ""
    if not k:
        raise SystemExit("TCG_CARDMARKET_API_KEY missing")
    return k


def http_json(method: str, url: str, body: dict | None = None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "X-API-Key": api_key(),
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "riftbound-tracker-bake/0.2.12",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode())


def prefer_english_url(url: str | None) -> str | None:
    if not url:
        return url
    parts = url.rstrip("/").split("/")
    # https://www.cardmarket.com/{locale}/Riftbound/...
    if len(parts) > 4 and parts[2].endswith("cardmarket.com"):
        parts[3] = CARDMARKET_SITE_LOCALE
        return "/".join(parts)
    return url


def main() -> None:
    prices_doc = json.loads(PRICES_PATH.read_text(encoding="utf-8"))
    cards = {c["id"]: c for c in json.loads(CARDS_PATH.read_text(encoding="utf-8"))["cards"]}
    book = prices_doc.setdefault("cards", {})

    # Collect cmIds to refresh
    id_to_cid: dict[str, str] = {}
    for cid, entry in book.items():
        cm = entry.get("cmId")
        if cm:
            id_to_cid[str(cm)] = cid

    cm_ids = sorted(id_to_cid.keys())
    print(f"refreshing {len(cm_ids)} cmIds via batch...")
    updated = 0
    missing = 0
    for i in range(0, len(cm_ids), BATCH):
        chunk = cm_ids[i : i + BATCH]
        try:
            rows = http_json("POST", f"{BASE}/cards/batch", {"game": "riftbound", "cardIds": chunk})
        except urllib.error.HTTPError as e:
            print(f"batch HTTP {e.code}: {e.read()[:200]!r}", file=sys.stderr)
            raise
        got = {str(r["externalId"]): r for r in rows}
        for cm in chunk:
            cid = id_to_cid[cm]
            entry = book[cid]
            row = got.get(cm)
            if not row or not row.get("price"):
                missing += 1
                # EN-first fallback: keep existing prices; still normalize locale
                entry["cmUrl"] = prefer_english_url(entry.get("cmUrl"))
                entry["languageId"] = entry.get("languageId") or CARDMARKET_PRODUCT_LANGUAGE_ID
                continue
            p = row["price"]
            entry["low"] = p.get("low")
            entry["avg30"] = p.get("avg30")
            entry["trend"] = p.get("trend")
            entry["foilLow"] = p.get("foilLow")
            entry["foilTrend"] = p.get("foilTrend")
            entry["cmId"] = str(row["externalId"])
            entry["cmUrl"] = prefer_english_url(entry.get("cmUrl"))
            # Prefer EN article language marker; keep prior non-1 only if already set
            # and somehow no EN — TCG API has no language field, so default to EN.
            entry["languageId"] = CARDMARKET_PRODUCT_LANGUAGE_ID
            updated += 1
        time.sleep(0.15)

    prices_doc["updatedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    prices_doc["currency"] = prices_doc.get("currency") or "EUR"
    prices_doc["source"] = "cardmarket"
    prices_doc["language"] = CARDMARKET_PRODUCT_LANGUAGE
    prices_doc["languageId"] = CARDMARKET_PRODUCT_LANGUAGE_ID
    prices_doc["languagePreference"] = "en-first"
    prices_doc["languageFallback"] = True
    prices_doc["sellerCountryFilter"] = None
    prices_doc["sellerCountryNote"] = (
        "Product Low/Avg30 from TCG Cardmarket API are global. "
        "MKM Articles supports sellerCountry=7 (DE) for live offers only; "
        "not applied here (would need offer scraping)."
    )

    # Ensure every priced row has EN-preferred URL + languageId
    for entry in book.values():
        entry["cmUrl"] = prefer_english_url(entry.get("cmUrl"))
        if entry.get("languageId") is None:
            entry["languageId"] = CARDMARKET_PRODUCT_LANGUAGE_ID

    # Touch cards without prices? leave missing (RAD spoilers etc.)
    unmatched = [cid for cid in cards if cid not in book]
    print(f"updated={updated} batch_miss={missing} catalog_without_price={len(unmatched)}")

    PRICES_PATH.write_text(
        json.dumps(prices_doc, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
