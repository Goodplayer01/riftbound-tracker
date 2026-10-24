import { readFileSync } from 'node:fs'
import { rollPack, boosterSets, slotValue, EPIC_RATE, ALT_RATE, OVER_RATE, SIGNED_SHARE, ULTIMATE_RATE, ALT_RUNE_RATE } from '../src/dopaminPacks.ts'

const cards = JSON.parse(readFileSync(new URL('../public/cards.json', import.meta.url))).cards

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const near = (a, b) => Math.abs(a - b) < 1e-12
const ORDER = 'common,common,common,common,common,common,common,uncommon,uncommon,uncommon,token,foil,rare,flex'

const sets = boosterSets(cards).map((s) => s.id)
assert(sets.join(',') === 'OGN,SFD,UNL,VEN,RAD', 'booster sets ' + sets.join(','))

// Seeded rng, so a failure can be reproduced.
let x = 123456789
function rnd() {
  x = Math.imul(x ^ (x >>> 15), 1 | x)
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296
}

for (const id of sets) {
  for (const rng of [() => 0, () => 0.5, () => 0.999999, rnd]) {
    const pack = rollPack(cards, id, rng)
    assert(pack && pack.map((s) => s.role).join(',') === ORDER, id + ' order')
    const role = (r) => pack.filter((s) => s.role === r)
    assert(new Set(role('common').map((s) => s.card.id)).size === 7, id + ' common dup')
    assert(new Set(role('uncommon').map((s) => s.card.id)).size === 3, id + ' unc dup')
    for (const s of pack) {
      assert(s.card.set === id, id + ' wrong set ' + s.card.id)
      assert(!(s.card.tags || []).includes('promo'), id + ' promo in pack ' + s.card.id)
      assert(s.chance > 0 && s.chance <= 1, id + ' chance ' + s.card.id)
    }
    for (const s of role('common')) assert(!s.foil && s.card.rarity === 'Common' && !s.card.altArt && !(s.card.types || []).includes('Rune'), id + ' common')
    for (const s of role('uncommon')) assert(!s.foil && s.card.rarity === 'Uncommon', id + ' unc')
    const tok = role('token')[0]
    assert(tok.estimate && ((tok.card.types || []).includes('Rune') || (tok.card.types || []).includes('Token') || (tok.card.superTypes || []).includes('Token')), id + ' token slot')
    assert(tok.hit === 'altrune' ? tok.card.altArt && tok.foil : !tok.card.altArt && !tok.foil, id + ' alt rune')
    const foil = role('foil')[0]
    assert(foil.foil && foil.estimate && ['Common', 'Uncommon', 'Rare', 'Epic'].includes(foil.card.rarity) && !foil.card.altArt, id + ' foil slot')
    const rare = role('rare')[0]
    assert(rare.foil && ['Rare', 'Epic'].includes(rare.card.rarity) && !rare.card.altArt && !rare.card.overnumbered, id + ' rare slot')
    const flex = role('flex')[0]
    assert(flex.hit !== 'ultimate' || !flex.foil, id + ' ultimate foil')
  }
}

// rng 0 hits the rarest tier that exists; just under 1 is always a plain rare.
const radTop = rollPack(cards, 'RAD', () => 0)
assert(radTop[13].hit === 'ultimate' && radTop[13].card.rarity === 'Ultimate Rare', 'rad ultimate')
assert(near(radTop[13].chance, ULTIMATE_RATE.RAD), 'rad ultimate chance')
const ognTop = rollPack(cards, 'OGN', () => 0)
assert(ognTop[13].hit === 'signed' && ognTop[13].card.signed, 'ogn has no ultimate, top is signed')
assert(ognTop[12].hit === 'epic', 'rng 0 rare slot is epic')
const ognEpics = cards.filter((c) => c.set === 'OGN' && c.rarity === 'Epic' && !c.altArt && !c.overnumbered && !c.signed && !(c.tags || []).includes('promo')).length
assert(near(ognTop[12].chance, EPIC_RATE / ognEpics), 'epic chance')
const ognLow = rollPack(cards, 'OGN', () => 0.999999)
assert(ognLow[12].hit === 'rare' && ognLow[13].hit === 'rare', 'rng high gives rares')

// Rates over many packs land near Riot's numbers.
const N = 40000
const count = { epic: 0, alt: 0, over: 0, signed: 0, altrune: 0 }
for (let i = 0; i < N; i++) {
  const pack = rollPack(cards, 'OGN', rnd)
  if (pack.some((s) => s.role === 'rare' && s.hit === 'epic')) count.epic++
  for (const s of pack) if (s.role !== 'foil' && s.hit in count && s.hit !== 'epic') count[s.hit]++
}
const within = (got, rate, tol) => Math.abs(got / N - rate) < tol
assert(within(count.epic, EPIC_RATE, 0.01), 'epic rate ' + count.epic)
assert(within(count.alt, ALT_RATE, 0.006), 'alt rate ' + count.alt)
assert(within(count.over, OVER_RATE * (1 - SIGNED_SHARE), 0.003), 'over rate ' + count.over)
assert(within(count.signed, OVER_RATE * SIGNED_SHARE, 0.001), 'signed rate ' + count.signed)
assert(within(count.altrune, ALT_RUNE_RATE, 0.005), 'alt rune rate ' + count.altrune)

// Slot value: foil trend for foils, normal trend otherwise.
const pe = { low: 1, trend: 2, foilLow: 5, foilTrend: 6 }
assert(slotValue({ foil: true }, pe) === 6 && slotValue({ foil: false }, pe) === 2, 'slot value')
assert(slotValue({ foil: true }, { low: 3, trend: 4, foilTrend: null }) === 4, 'foil without foil trend uses trend')
assert(slotValue({ foil: false }, undefined) === null, 'no price')

console.log('ok', JSON.stringify(count))
