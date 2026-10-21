#!/usr/bin/env python3
"""Map RAD cards to Cardmarket products (public catalog + price guide, game 22).

Inputs: /tmp/cm/prod.json, /tmp/cm/pg.json (downloads.s3.cardmarket.com),
optional scripts/cm_rad_slugs.json {idProduct: url} fetched in a browser.
Variants of one name are matched by idProduct order: base, alt (a), SP/ON, signed.
"""
import collections, json, sys
from pathlib import Path

from sanitize_prices import sanitize

ROOT = Path(__file__).resolve().parents[1]
CM = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/cm')
RAD, PROMO = 6659, 6921
ALIAS = {'Evelynn, in Control': 'Evelynn, In Control', 'Ziggs, Short-Fused': 'Ziggs, Short Fused',
         'Riven Deserter': 'Riven, Deserter', "K'Sante Pride of Nazumah": "K'Sante, Pride of Nazumah",
         "Hunter's Circle": "Hunters' Circle"}

cards = [c for c in json.loads((ROOT / 'public/cards.json').read_text())['cards'] if c['set'] == 'RAD']
prods = json.loads((CM / 'prod.json').read_text())['products']
pg = {x['idProduct']: x for x in json.loads((CM / 'pg.json').read_text())['priceGuides']}
slugs_path = ROOT / 'scripts/cm_rad_slugs.json'
slugs = json.loads(slugs_path.read_text()) if slugs_path.exists() else {}

def nm(c):
    n = c['name'] + (', ' + c['subtitle'] if c.get('subtitle') else '')
    return ALIAS.get(n, n)

def rank(c):
    if c.get('signed'): return 3
    if c['id'].startswith('rad-sp') or c.get('overnumbered'): return 2
    if c.get('altArt'): return 1
    return 0

byname = collections.defaultdict(list)
for p in prods:
    if p['idExpansion'] in (RAD, PROMO):
        byname[(p['idExpansion'], p['name'])].append(p['idProduct'])
cg = collections.defaultdict(list)
for c in cards:
    cg[(PROMO if 'promo' in c['tags'] else RAD, nm(c))].append(c)

match, skipped = {}, []
for key, cs in cg.items():
    ids = sorted(byname.get(key, []))
    cs.sort(key=lambda c: (rank(c), c['cn']))
    if len(ids) == len(cs):
        match.update({c['id']: i for c, i in zip(cs, ids)})
    elif len(cs) == 1 and rank(cs[0]) == 1 and len(ids) == 2:
        match[cs[0]['id']] = ids[1]  # showcase rune without base row
    else:
        skipped += [c['id'] for c in cs]

doc = json.loads((ROOT / 'public/prices.json').read_text())
book = doc['cards']
for cid, pid in match.items():
    g = pg.get(pid, {})
    e = book.setdefault(cid, {})
    e.update(low=g.get('low'), avg30=g.get('avg30'), trend=g.get('trend'),
             foilLow=g.get('low-foil'), foilTrend=g.get('trend-foil'), cmId=str(pid), languageId=1)
    if str(pid) in slugs:
        e['cmUrl'] = slugs[str(pid)].split('?')[0] + '?language=1'
    else:
        e.setdefault('cmUrl', None)
print('dropped_outliers=', sanitize(book))
(ROOT / 'public/prices.json').write_text(json.dumps(doc, indent=2, ensure_ascii=False) + '\n')
print(f'matched={len(match)} priced={sum(1 for p in match.values() if pg.get(p, {}).get("low") is not None)} '
      f'urls={sum(1 for p in match.values() if str(p) in slugs)} skipped={skipped}')
