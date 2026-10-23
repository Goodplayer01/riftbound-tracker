import { readFileSync } from 'node:fs'
import { bakedOffers, cmReference, isDisplayTitle, langFromTitle, setFromTitle } from '../src/displays.ts'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const sets = { OGN: 'Origins', SFD: 'Spiritforged', UNL: 'Unleashed', VEN: 'Vendetta', RAD: 'Radiance', LEGACY: 'Legacy' }

// Shop titles seen in the wild: displays in, cases / decks / acrylic boxes / bundles out.
assert(isDisplayTitle('Riftbound Origins (OGN) Display - EN'), 'display')
assert(isDisplayTitle('Riftbound: League of Legends-TCG – Vendetta-Boosterbox - EN'), 'boosterbox')
assert(isDisplayTitle('Origins Booster Box (Chinese, Jumbo)'), 'cardmarket booster box')
assert(!isDisplayTitle('Origins Case (6x Booster Box)'), 'case is not a display')
assert(!isDisplayTitle('Riftbound: League of Legends - VENDETTA SHOWDOWN ZED VS SHEN DECK DISP'), 'deck display')
assert(!isDisplayTitle('The Acrylic Box - Riftbound - League of Legends Booster Box'), 'acrylic box')
assert(!isDisplayTitle('Riftbound: League of Legends - Legacy Vault Bundle - Display - englisch'), 'bundle')

// Print language: Chinese wins over a stray "EN", Slim / Jumbo are Chinese only.
assert(langFromTitle('Riftbound Spiritforged Booster Display EN') === 'EN', 'EN')
assert(langFromTitle('Riftbound Vendetta Display (24 Booster) Englisch') === 'EN', 'Englisch')
assert(langFromTitle('Riftbound Unleashed Slim Booster Display S-CH') === 'ZH', 'S-CH')
assert(langFromTitle('[KOR] Riftbound: League of Legends - Origins - Booster Display') === 'KO', 'KOR')
assert(langFromTitle('Origins Booster Box (French)') === 'FR', 'French')
assert(langFromTitle('League of Legends Riftbound Unleashed Display') === null, 'no language')

// Set from title; "League of Legends" must not match Legacy.
assert(setFromTitle('Riftbound: League of Legends - RADIANCE - Display - englisch -', sets) === 'RAD', 'RAD upper case')
assert(setFromTitle('Riftbound Legacy Display EN (Vorbestellung)', sets) === 'LEGACY', 'Legacy')
assert(setFromTitle('League of Legends Riftbound TCG - Origins - Display', sets) === 'OGN', 'League of Legends is no set')

// The bundled file parses and every Chinese Slim offer finds its own Cardmarket row.
const file = JSON.parse(readFileSync(new URL('../public/sealed.json', import.meta.url), 'utf8'))
const offers = bakedOffers(file)
assert(offers.length > 0 && offers.every((o) => o.price > 0 && file.sets[o.set]), 'baked offers have price and set')
for (const o of offers) {
  if (o.lang !== 'ZH') continue
  const ref = cmReference(file, o.set, 'ZH', o.title)
  const kind = /slim/i.test(o.title) ? 'Slim' : /jumbo/i.test(o.title) ? 'Jumbo' : null
  if (ref && kind) assert(ref.name.includes(kind), `${o.title} -> ${ref.name}`)
}
const en = cmReference(file, 'OGN', 'EN')
assert(en && en.name === 'Origins Booster Box', 'English Origins reference')

console.log('check_displays ok')
