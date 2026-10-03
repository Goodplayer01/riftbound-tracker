#!/usr/bin/env python3
"""Bake official English rulesText into public/cards.json from playriftbound.com card gallery.

Fetches the live card gallery HTML, extracts __NEXT_DATA__ card abilities, converts
Riot glyph tokens to bracket shorthand, and writes rulesText onto matching catalog cards.

Usage (from repo root):
  python3 scripts/bake_rules_text.py
"""
from __future__ import annotations

import html as htmllib
import json
import re
import ssl
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CARDS_PATH = ROOT / "public" / "cards.json"
GALLERY_URL = "https://playriftbound.com/en-us/card-gallery/"

# Manual spoiler / token overrides when gallery has no entry yet (EN oracle).
MANUAL_RULES: dict[str, str] = {
    "rad-t02": (
        "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n"
        "[Deathknell]: Deal 2 to an enemy unit here and kill all other Bombs you control here."
    ),
    "rad-sp3": (
        "[Disarm]\n"
        "When I hold, if you control a facedown card here, score 1 point."
    ),
    "rad-109a": (
        "[Disarm]\n"
        "When I hold, if you control a facedown card here, score 1 point."
    ),
    "rad-109": (
        "[Disarm] (When I attack, give an enemy unit here -1 [S] this turn.)\n"
        "When I hold, if you control a facedown card here, score 1 point."
    ),
    "rad-175": (
        "Once each turn, when you play a card from face down, draw 1. Then, if it's not your turn, discard 1."
    ),
}


def convert(body: str) -> str:
    if not isinstance(body, str) or not body:
        return ""
    s = body
    s = re.sub(r":rb_energy_(\d+):", r"[\1]", s)
    for a, b in [
        (":rb_rune_fury:", "[Fury]"),
        (":rb_rune_calm:", "[Calm]"),
        (":rb_rune_body:", "[Body]"),
        (":rb_rune_mind:", "[Mind]"),
        (":rb_rune_chaos:", "[C]"),
        (":rb_rune_order:", "[Order]"),
        (":rb_rune_rainbow:", "[A]"),
        (":rb_exhaust:", "[T]"),
        (":rb_might:", "[S]"),
    ]:
        s = s.replace(a, b)
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"</p>\s*<p>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = htmllib.unescape(s)
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in s.splitlines()]
    return "\n".join(ln for ln in lines if ln).strip()


def a11y_body(a11y: str) -> str:
    if not a11y:
        return ""
    m = re.match(r"^Riftbound [^:]+: [^.]+\.\s*", a11y)
    return (a11y[m.end() :] if m else a11y).strip()


def find_cards(obj):
    if isinstance(obj, dict):
        if "cardImage" in obj and "name" in obj and "publicCode" in obj:
            yield obj
        for v in obj.values():
            yield from find_cards(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from find_cards(v)


def fetch_gallery() -> dict:
    ctx = ssl.create_default_context()
    req = urllib.request.Request(
        GALLERY_URL,
        headers={"User-Agent": "Mozilla/5.0 (compatible; RiftboundTrackerBake/1.0)"},
    )
    with urllib.request.urlopen(req, context=ctx, timeout=120) as resp:
        html = resp.read().decode("utf-8", errors="ignore")
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html)
    if not m:
        raise SystemExit("No __NEXT_DATA__ in gallery HTML")
    return json.loads(m.group(1))


def main() -> None:
    data = fetch_gallery()
    pp = data["props"]["pageProps"]
    by_id: dict[str, dict] = {}
    by_code: dict[str, dict] = {}
    by_name: dict[str, list] = defaultdict(list)
    by_base: dict[str, list] = defaultdict(list)

    for c in find_cards(pp):
        text_obj = c.get("text")
        body = ""
        if isinstance(text_obj, dict):
            body = ((text_obj.get("richText") or {}).get("body") or "")
        text = convert(body)
        a11y = a11y_body((c.get("cardImage") or {}).get("accessibilityText") or "")
        final = text or a11y
        if text and re.search(r":[a-z0-9_]+:", text) and a11y:
            final = a11y
        entry = {"id": c["id"], "name": c["name"], "code": c.get("publicCode") or "", "text": final}
        by_id[entry["id"]] = entry
        if entry["code"]:
            by_code[entry["code"]] = entry
        by_name[entry["name"]].append(entry)
        parts = entry["id"].split("-")
        for i in range(2, len(parts) + 1):
            by_base["-".join(parts[:i])].append(entry)

    doc = json.loads(CARDS_PATH.read_text(encoding="utf-8"))
    filled = 0
    for card in doc["cards"]:
        oid = card["id"]
        if oid in MANUAL_RULES:
            card["rulesText"] = MANUAL_RULES[oid]
            filled += 1
            continue
        code = card.get("code") or ""
        name = card.get("name") or ""
        hit = by_id.get(oid) or by_code.get(code)
        if not hit:
            cands = by_base.get(oid) or []
            if code:
                for e in cands:
                    if e["code"] == code:
                        hit = e
                        break
            if not hit and len(cands) == 1:
                hit = cands[0]
            elif not hit and cands:
                prefix = code.split("/")[0] if code else ""
                for e in cands:
                    if prefix and e["code"].startswith(prefix):
                        hit = e
                        break
                if not hit:
                    hit = cands[0]
        if (not hit or not hit["text"]) and name:
            named = [e for e in by_name.get(name, []) if e["text"]]
            if len(named) == 1:
                hit = named[0]
            elif named:
                sp = oid.split("-")[0].upper()
                same = [e for e in named if e["id"].startswith(sp.lower()) or e["code"].startswith(sp)]
                hit = same[0] if same else named[0]
        if hit and hit["text"]:
            card["rulesText"] = hit["text"]
            filled += 1
        else:
            card["rulesText"] = None

    CARDS_PATH.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote rulesText for {filled}/{len(doc['cards'])} cards → {CARDS_PATH}")


if __name__ == "__main__":
    main()
