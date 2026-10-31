#!/usr/bin/env python3
"""Bake public/sealed.json: booster display prices for the Store tab.

Two parts, both from public sources without a key:
  - cardmarket: every Riftbound sealed product from Cardmarket's public price
    guide (products_nonsingles_22.json + price_guide_22.json), with the set code
    learned from the singles of the same expansion. The app shows the booster
    displays as the "fair price" reference.
  - shops / offers: German shops that answer an open product search
    (Shopify /search/suggest.json or the WooCommerce Store API). Candidates are
    the websites of German stores with upcoming events in Riot's official event
    search (events.playriftbound.com) plus a few online shops (ONLINE_SHOPS).
    Only shops that answered make it into the file; the app asks them again live.

The app loads the file live from main (like prices.json), so a daily bake keeps
it current without a release.
"""
from __future__ import annotations

import json
import re
import sys
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode, urlsplit

ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = ROOT / "public" / "sealed.json"
PRICES_PATH = ROOT / "public" / "prices.json"
CARDS_PATH = ROOT / "public" / "cards.json"

CM = "https://downloads.s3.cardmarket.com/productCatalog"
GUIDE_URL = f"{CM}/priceGuide/price_guide_22.json"
SINGLES_URL = f"{CM}/productList/products_singles_22.json"
NONSINGLES_URL = f"{CM}/productList/products_nonsingles_22.json"

# Riot's event search, same persisted queries and ids as net:rbEvents in electron/main.cjs (keep in sync).
RB_EVENTS_URL = "https://events.playriftbound.com/api/gql"
RB_SEARCH = ("CompeteTournamentSearch", "868030f676276bec926c740aada7129713d4097f6e2dd7c3a0451c4fb43852eb")
RB_ORGANIZER = ("OrganizerSummary", "3c1b5c84a25e8c304922e4130a99a196e6eac6c90d740690ba1afd0f040010cf")
# GERMANY_CIRCLES in src/stores.ts: 5x4 grid, every German spot within ~130 km of a center.
GERMANY_CIRCLES = [(lat, lng) for lat in (47.8, 49.4, 51.0, 52.6, 54.2) for lng in (6.8, 9.4, 12.0, 14.6)]
EVENT_SEARCH_METERS = 160_000  # the search answers at most ~160 km around a point
MAX_PAGES = 20
GERMANY_BOX = (47.27, 55.06, 5.87, 15.04)  # south, north, west, east
# "No letter" edges like isGermanEvent: \b fails next to letters like Ö.
NOT_GERMANY = re.compile(
    r"(?<![^\W\d_])(netherlands|nederland|belgium|belgi[eë]|belgique|poland|polska|czechia|czech republic|česko"
    r"|austria|österreich|switzerland|schweiz|suisse|svizzera|denmark|danmark|france|luxembourg|luxemburg)(?![^\W\d_])",
    re.I,
)

# Online shops that sell Riftbound displays in Germany (not all hold events in Riot's search).
ONLINE_SHOPS = [
    ("Cardcosmos", "https://cardcosmos.de"),
    ("Break the Case", "https://www.breakthecase.de"),
    ("Lake Cards", "https://lakecards.de"),
    ("Keep Seven", "https://keepseven.de"),
    ("Duality Games", "https://dualitygames.de"),
    ("Cardcatcher", "https://www.cardcatcher.de"),
    ("Tabletop Dragon", "https://www.tabletop-dragon.de"),
    ("Comicplanet", "https://www.comicplanet.de"),
    ("Games Island", "https://games-island.eu"),
    ("Fantasywelt", "https://www.fantasywelt.de"),
    ("Spiele-Offensive", "https://www.spiele-offensive.de"),
    ("Gate to the Games", "https://www.gate-to-the-games.de"),
]

UA = "riftbound-tracker-bake (+https://github.com/Goodplayer01/riftbound-tracker)"
DISPLAY_RE = re.compile(r"display|booster\s*-?\s*box", re.I)
NOT_DISPLAY_RE = re.compile(
    r"sleeve|playmat|binder|album|deck|h[üu]lle|case\b|acryl|bundle|einzel|single|leer|empty|protector|storage", re.I
)
PREORDER_RE = re.compile(r"vorbestell|vorverkauf|pre-?order|preorder|pre-?sale", re.I)
# Sets with displays that have no cards in cards.json yet.
EXTRA_SETS = {"LEGACY": "Legacy"}


def fetch_json(url: str, timeout: int = 60):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def set_names() -> dict[str, str]:
    """Main sets only (no Nexus Night promos, no Proving Grounds): code -> English name."""
    sets = json.loads(CARDS_PATH.read_text(encoding="utf-8"))["sets"]
    out = {code: name for code, name in sets.items() if "-" not in code and code != "OGS"}
    for code, name in EXTRA_SETS.items():
        if name not in out.values():
            out[code] = name
    return out


def set_from_title(title: str, names: dict[str, str]) -> str | None:
    hits = [code for code, name in names.items() if re.search(rf"\b{re.escape(name)}\b", title, re.I)]
    return hits[0] if len(hits) == 1 else None


LANG_PATTERNS = (
    ("ZH", r"\b(zh|cn|chn|s-ch|chinese|chinesisch\w*)\b|slim|jumbo"),
    ("KO", r"\b(ko|kor|korean|koreanisch\w*)\b"),
    ("JA", r"\b(ja|jp|jap|japanese|japanisch\w*)\b"),
    ("FR", r"\b(fr|french|franz[öo]sisch\w*|fran[çc]ais)\b"),
    ("DE", r"\b(de|deutsch\w*|german)\b"),
    ("EN", r"\b(en|eng|english|englisch\w*)\b"),
)


def lang_from_title(title: str) -> str | None:
    """Print language from a product title. Chinese first: "Slim"/"Jumbo" displays are Chinese only."""
    for code, pat in LANG_PATTERNS:
        if re.search(pat, title, re.I):
            return code
    return None


def is_display(title: str) -> bool:
    return bool(DISPLAY_RE.search(title)) and not NOT_DISPLAY_RE.search(title)


# ---------------------------------------------------------------- Cardmarket


def bake_cardmarket(names: dict[str, str]) -> dict:
    guide_doc = fetch_json(GUIDE_URL)
    guide = {g["idProduct"]: g for g in guide_doc["priceGuides"]}
    singles = fetch_json(SINGLES_URL)["products"]
    nonsingles = fetch_json(NONSINGLES_URL)["products"]
    if len(guide) < 500 or len(singles) < 500:
        raise SystemExit(f"price guide looks incomplete: guide={len(guide)} singles={len(singles)}")

    # idExpansion -> set code, voted by the cmIds we already know per card.
    book = json.loads(PRICES_PATH.read_text(encoding="utf-8"))["cards"]
    exp_of_product = {p["idProduct"]: p["idExpansion"] for p in singles}
    votes: dict[int, Counter] = defaultdict(Counter)
    for card_id, e in book.items():
        cm = e.get("cmId")
        exp = exp_of_product.get(int(cm)) if cm else None
        if exp is not None:
            votes[exp][card_id.split("-")[0].upper()] += 1
    set_of_exp = {exp: c.most_common(1)[0][0] for exp, c in votes.items()}

    out = []
    for p in nonsingles:
        g = guide.get(p["idProduct"]) or {}
        name = p.get("name") or ""
        code = set_of_exp.get(p.get("idExpansion"))
        if code not in names:
            code = set_from_title(name, names)
        out.append({
            "id": p["idProduct"],
            "name": name,
            "set": code,
            "category": p.get("categoryName"),
            "display": is_display(name),
            # Cardmarket names other prints "(Chinese, Slim)", "(French)"; no suffix = English.
            "lang": lang_from_title(name) or "EN",
            "low": g.get("low"),
            "avg1": g.get("avg1"),
            "avg7": g.get("avg7"),
            "avg30": g.get("avg30"),
            "trend": g.get("trend"),
        })
    out.sort(key=lambda r: (r["set"] or "~", not r["display"], r["name"]))
    print(f"cardmarket: {len(out)} sealed products, {sum(r['display'] for r in out)} displays")
    for r in out:
        if r["display"]:
            print(f"  {r['set']} {r['id']} {r['name']!r} [{r['category']}] low={r['low']} trend={r['trend']} avg30={r['avg30']}")
    return {"guideCreatedAt": guide_doc.get("createdAt"), "products": out}


# ---------------------------------------------------------------- shops


def origin_of(website: str | None) -> str | None:
    if not website:
        return None
    raw = website.strip()
    if not re.match(r"^https?://", raw, re.I):
        raw = "https://" + raw
    try:
        sp = urlsplit(raw)
    except ValueError:
        return None
    host = (sp.hostname or "").lower()
    if not host or "." not in host:
        return None
    if re.search(r"(^|\.)(instagram|facebook|fb|tiktok|linktr|discord|youtube)\.", host) or host in ("wa.me", "t.me"):
        return None
    return f"https://{host}"


def rb_events(op: tuple[str, str], variables: dict):
    body = json.dumps({
        "operationName": op[0],
        "variables": variables,
        "extensions": {"persistedQuery": {"version": 1, "sha256Hash": op[1]}},
    }).encode()
    req = urllib.request.Request(RB_EVENTS_URL, data=body, method="POST", headers={
        "User-Agent": UA,
        "Content-Type": "application/json",
        "Accept": "application/graphql-response+json,application/json;q=0.9",
        # The endpoint rejects requests without Apollo client headers.
        "apollographql-client-name": "Esports Web",
        "apollographql-client-version": "bake",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        doc = json.loads(resp.read().decode("utf-8", "replace"))
    if doc.get("errors"):
        raise RuntimeError(f"{op[0]}: {doc['errors'][0].get('message')}")
    return doc.get("data") or {}


def is_german_event(loc: dict | None) -> bool:
    """Same rule as isGermanEvent in src/stores.ts."""
    loc = loc or {}
    text = loc.get("formattedAddress") or ""
    if re.search(r"\b(germany|deutschland)\b", text, re.I):
        return True
    if NOT_GERMANY.search(text):
        return False
    lat, lng = loc.get("latitude"), loc.get("longitude")
    s, n, w, e = GERMANY_BOX
    return isinstance(lat, (int, float)) and isinstance(lng, (int, float)) and s <= lat <= n and w <= lng <= e


def circle_organizers(center: tuple[float, float], start: str) -> dict[str, str | None]:
    """Organizer id -> city of its first German event within one search circle."""
    out: dict[str, str | None] = {}
    after = None
    for _ in range(MAX_PAGES):
        rb = {"coords": {"latitude": center[0], "longitude": center[1]}, "startDate": start,
              "distanceMeters": EVENT_SEARCH_METERS}
        variables = {"sport": "rb", "first": 50, "filter": {"rb": rb}, **({"after": after} if after else {})}
        conn = rb_events(RB_SEARCH, variables).get("competeTournamentSearch") or {}
        for e in conn.get("edges") or []:
            node = e.get("node") or {}
            org = (node.get("organizer") or {}).get("id")
            loc = (node.get("tournament") or {}).get("tournamentLocation")
            if org and org not in out and is_german_event(loc):
                out[org] = (loc or {}).get("city") or None
        info = conn.get("pageInfo") or {}
        after = info.get("endCursor")
        if not info.get("hasNextPage") or not after:
            break
    return out


def organizer_shop(item: tuple[str, str | None]) -> tuple[str, str, str | None] | None:
    org_id, city = item
    try:
        o = rb_events(RB_ORGANIZER, {"id": org_id}).get("organizerSummary") or {}
    except Exception:
        return None
    origin = origin_of(o.get("website"))
    if not origin:
        return None
    return (o.get("name") or origin, origin, city)  # the profile address has no city field


def riot_german_stores() -> list[tuple[str, str, str | None]]:
    """Websites of German stores with upcoming events in Riot's event search (the Store tab's All Germany)."""
    # Same as the site: events that started up to an hour ago still count.
    start = (datetime.now(timezone.utc) - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    orgs: dict[str, str | None] = {}
    failed = 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        for found in pool.map(lambda c: _try(circle_organizers, c, start), GERMANY_CIRCLES):
            if found is None:
                failed += 1
                continue
            for k, v in found.items():
                orgs.setdefault(k, v)
    if failed == len(GERMANY_CIRCLES):
        raise RuntimeError("event search failed for every circle")
    with ThreadPoolExecutor(max_workers=6) as pool:
        stores = [s for s in pool.map(organizer_shop, orgs.items()) if s]
    print(f"event search: {len(orgs)} German organizers, {len(stores)} with a website, {failed} circles failed")
    return stores  # bake_shops merges stores sharing one web shop


def _try(fn, *args):
    try:
        return fn(*args)
    except Exception as e:
        print(f"  {fn.__name__}{args[:1]} failed: {e}")
        return None


def to_eur(v) -> float | None:
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return round(n, 2) if n > 0 else None


def shopify_offers(origin: str) -> list[dict] | None:
    q = urlencode({
        "q": "riftbound display",
        "resources[type]": "product",
        "resources[limit]": 10,
        "resources[options][unavailable_products]": "last",
    })
    data = fetch_json(f"{origin}/search/suggest.json?{q}", timeout=15)
    products = (((data or {}).get("resources") or {}).get("results") or {}).get("products")
    if not isinstance(products, list):
        return None
    out = []
    for p in products:
        title = (p.get("title") or "").strip()
        url = p.get("url") or ""
        url = url if url.startswith("http") else origin + url.split("?")[0]
        offer = {
            "title": title,
            "price": to_eur(p.get("price")),
            "available": p.get("available") if isinstance(p.get("available"), bool) else None,
            "url": url,
        }
        if to_eur(p.get("price_max")) != to_eur(p.get("price_min")):
            # "Display & Booster" products: the suggest price is the cheapest variant (a single booster).
            offer = shopify_display_variant(offer)
            if not offer:
                continue
        out.append(offer)
    return out


def shopify_display_variant(offer: dict) -> dict | None:
    """Pick the display variant from /products/<handle>.js (prices in cents)."""
    try:
        data = fetch_json(offer["url"].split("?")[0] + ".js", timeout=15)
    except Exception:
        return None
    variants = [v for v in data.get("variants") or [] if is_display(v.get("title") or "")]
    if len(variants) != 1:
        return None
    v = variants[0]
    return {
        **offer,
        "price": to_eur((v.get("price") or 0) / 100),
        "available": v.get("available") if isinstance(v.get("available"), bool) else None,
        "url": f"{offer['url'].split('?')[0]}?variant={v.get('id')}",
    }


def woo_offers(origin: str) -> list[dict] | None:
    q = urlencode({"search": "riftbound display", "per_page": 20})
    data = fetch_json(f"{origin}/wp-json/wc/store/v1/products?{q}", timeout=15)
    if not isinstance(data, list):
        return None
    out = []
    for p in data:
        prices = p.get("prices") or {}
        minor = int(prices.get("currency_minor_unit") or 2)
        raw = prices.get("price")
        price = to_eur(int(raw) / 10 ** minor) if raw and str(raw).isdigit() else None
        if prices.get("currency_code") not in (None, "EUR"):
            price = None
        out.append({
            "title": re.sub(r"<[^>]+>", "", p.get("name") or "").strip(),
            "price": price,
            "available": p.get("is_in_stock") if isinstance(p.get("is_in_stock"), bool) else None,
            "url": p.get("permalink") or origin,
        })
    return out


def probe(shop: tuple[str, str, str | None], names: dict[str, str]):
    name, origin, city = shop
    for platform, fn in (("shopify", shopify_offers), ("woo", woo_offers)):
        try:
            offers = fn(origin)
        except Exception:
            offers = None
        if offers is None:
            continue
        keep = []
        for o in offers:
            t = o["title"]
            if not re.search(r"riftbound|league of legends", t, re.I) or not is_display(t):
                continue
            o["set"] = set_from_title(t, names)
            if not o["set"] or not o["price"]:
                continue
            o["lang"] = lang_from_title(t)
            o["preorder"] = bool(PREORDER_RE.search(t))
            keep.append(o)
        return {"name": name, "url": origin, "city": city, "platform": platform}, keep
    return None, []


def bake_shops(names: dict[str, str]) -> dict:
    candidates = [(n, u, None) for n, u in ONLINE_SHOPS]
    try:
        local = riot_german_stores()
    except Exception as e:  # keep the online shops when the event search is down
        print(f"event search failed: {e}")
        local = []
    # Several stores can share one web shop (www. or not, branches): ask it once.
    known: dict[str, int] = {}
    merged = []
    for name, url, city in candidates + local:
        key = url.replace("://www.", "://")
        if key in known:
            prev = merged[known[key]]
            if city and city not in (prev[2] or ""):
                merged[known[key]] = (prev[0], prev[1], f"{prev[2]}, {city}" if prev[2] else city)
            continue
        known[key] = len(merged)
        merged.append((name, url, city))
    candidates = merged
    print(f"shops: {len(candidates)} candidates ({len(local)} from the event search)")

    shops, offers = [], []
    with ThreadPoolExecutor(max_workers=12) as pool:
        for shop, found in pool.map(lambda s: probe(s, names), candidates):
            if not shop:
                continue
            shops.append(shop)
            for o in found:
                offers.append({"shop": shop["url"], **o})
    shops.sort(key=lambda s: s["name"].lower())
    offers.sort(key=lambda o: (o["set"] or "~", o["price"] or 1e9))
    print(f"shops answering: {len(shops)}, display offers: {len(offers)}")
    for s in shops:
        n = sum(1 for o in offers if o["shop"] == s["url"])
        print(f"  {s['platform']:8} {s['url']} ({s['name']}) offers={n}")
    for o in offers:
        print(f"  {o['set']} {o['lang']} {o['price']} {'in' if o['available'] else 'out'} {o['title']!r} {o['url']}")
    return {"shops": shops, "offers": offers}


def main() -> None:
    names = set_names()
    doc = {"updatedAt": now_iso(), "currency": "EUR", "sets": names}
    doc["cardmarket"] = bake_cardmarket(names)
    doc.update(bake_shops(names))
    OUT_PATH.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
