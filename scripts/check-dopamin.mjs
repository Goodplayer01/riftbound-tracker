import { readFileSync } from 'node:fs'
import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url)
const { rollPack, boosterSets, pullChance } = jiti('../src/dopamin.ts')
const cards = JSON.parse(readFileSync(new URL('../public/cards.json', import.meta.url))).cards

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function tally(pack) {
  const n = (role) => pack.filter((s) => s.role === role)
  return { n, pack }
}

const sets = boosterSets(cards).map((s) => s.id)
assert(sets.join(',') === 'OGN,SFD,UNL,VEN,RAD', 'booster sets ' + sets.join(','))

const zero = () => 0
const justUnderEpic = () => 0.249
const atEpic = () => 0.25
const justUnderUr = () => 0.000249
const atUr = () => 0.00025

for (const id of sets) {
  for (const rng of [zero, atEpic, justUnderEpic]) {
    const pack = rollPack(cards, id, rng)
    assert(pack && pack.length === 14, id + ' len')
    const commons = pack.filter((s) => s.role === 'common')
    const uncommons = pack.filter((s) => s.role === 'uncommon')
    const foils = pack.filter((s) => s.role === 'foil')
    const tokens = pack.filter((s) => s.role === 'token')
    const highs = pack.filter((s) => s.role === 'high')
    assert(commons.length === 7 && uncommons.length === 3 && foils.length === 1 && tokens.length === 1 && highs.length === 2, id + ' slots')
    assert(new Set(commons.map((s) => s.card.id)).size === 7, id + ' common dup')
    assert(pack.map((s) => s.role).join(',') === 'common,common,common,common,common,common,common,uncommon,uncommon,uncommon,token,foil,high,high', id + ' order')
    assert(new Set(uncommons.map((s) => s.card.id)).size === 3, id + ' unc dup')
    for (const s of commons) {
      assert(!s.foil && s.card.rarity === 'Common', id + ' common foil/rarity')
      assert(!(s.card.types || []).includes('Rune') && !(s.card.types || []).includes('Token'), id + ' common token')
      assert(!(s.card.tags || []).includes('promo') && !s.card.signed && !s.card.overnumbered, id + ' common junk')
    }
    for (const s of uncommons) assert(!s.foil && s.card.rarity === 'Uncommon', id + ' unc')
    assert(foils[0].foil && (foils[0].card.rarity === 'Common' || foils[0].card.rarity === 'Uncommon'), id + ' foil slot')
    const t = tokens[0]
    const tokenish = (t.card.types || []).includes('Token') || (t.card.superTypes || []).includes('Token') || (t.card.types || []).includes('Rune')
    assert(!t.foil && !t.card.altArt && tokenish, id + ' token slot')
    const epics = highs.filter((s) => s.card.rarity === 'Epic')
    const urs = highs.filter((s) => s.card.rarity === 'Ultimate Rare' || s.card.id === 'rad-164-ur')
    assert(epics.length <= 1, id + ' two epics')
    assert(urs.length <= 1, id + ' two urs')
    for (const s of highs) {
      if (s.card.rarity === 'Rare' || s.card.rarity === 'Epic') assert(s.foil, id + ' high not foil')
      if (s.card.rarity === 'Ultimate Rare') assert(!s.foil, id + ' ur foil')
      assert(!s.card.altArt && !s.card.overnumbered && !(s.card.superTypes || []).includes('Signature') && !s.card.signed, id + ' high junk')
    }
  }
  const epicPack = rollPack(cards, id, justUnderEpic)
  const noEpic = rollPack(cards, id, atEpic)
  const epicN = epicPack.filter((s) => s.card.rarity === 'Epic').length
  const noN = noEpic.filter((s) => s.card.rarity === 'Epic').length
  if (id === 'OGN') {
    assert(epicN === 1, 'ogn epic on')
    assert(noN === 0, 'ogn epic off')
  } else {
    assert(epicN === 0 && noN === 0, id + ' no epic')
  }
  const urOn = rollPack(cards, id, justUnderUr)
  const urOff = rollPack(cards, id, atUr)
  const urCount = (pack) => pack.filter((s) => s.card.rarity === 'Ultimate Rare').length
  if (id === 'RAD') {
    assert(urCount(urOn) === 1 && urOn.find((s) => s.card.rarity === 'Ultimate Rare').card.id === 'rad-164-ur', 'rad ur on')
    assert(urCount(urOff) === 0, 'rad ur off')
    const ur = urOn.find((s) => s.card.id === 'rad-164-ur')
    const other = urOn.filter((s) => s.role === 'high' && s.card.id !== 'rad-164-ur')
    assert(!ur.foil && other.length === 1 && other[0].card.rarity === 'Rare' && other[0].foil, 'rad ur pair')
  } else {
    assert(urCount(urOn) === 0 && urCount(urOff) === 0, id + ' no ur')
  }
}

let hits = 0
const N = 2000
let x = 123456789
function rnd() {
  x = Math.imul(x ^ (x >>> 15), 1 | x)
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296
}
for (let i = 0; i < N; i++) {
  const pack = rollPack(cards, 'OGN', rnd)
  const epics = pack.filter((s) => s.card.rarity === 'Epic')
  assert(epics.length <= 1, 'rate two epics')
  if (epics.length === 1) hits++
}
assert(hits > 400 && hits < 600, 'ogn epic rate ' + hits + '/' + N)

const base = cards.find((c) => c.set === 'OGN' && c.rarity === 'Common' && !(c.types || []).includes('Rune') && !(c.types || []).includes('Token'))
function clone(id, patch) {
  return { ...base, id, signed: false, overnumbered: false, altArt: false, tags: [], types: ['Unit'], superTypes: [], set: 'OGN', ...patch }
}
const tiny = [
  clone('c1', { rarity: 'Common' }),
  clone('u1', { rarity: 'Uncommon' }),
  clone('t1', { rarity: 'Common', types: ['Rune'], superTypes: ['Basic'] }),
  clone('r1', { rarity: 'Rare' }),
]
const tinyPack = rollPack(tiny, 'OGN', () => 0)
assert(tinyPack && tinyPack.length === 14, 'tiny len')
assert(tinyPack.filter((s) => s.role === 'common').every((s) => s.card.id === 'c1'), 'tiny dup common')
assert(tinyPack.filter((s) => s.card.rarity === 'Epic').length === 0, 'tiny no epic pool')

const promo = [...cards, clone('promo-test', { rarity: 'Common', tags: ['promo'] })]
for (let i = 0; i < 30; i++) {
  const pack = rollPack(promo, 'OGN', rnd)
  assert(!pack.some((s) => s.card.id === 'promo-test'), 'promo leaked')
}

const sigOnly = [...tiny, clone('sig1', { rarity: 'Epic', superTypes: ['Signature'] })]
const sigPack = rollPack(sigOnly, 'OGN', () => 0)
assert(sigPack.filter((s) => s.card.rarity === 'Epic').length === 0, 'signature epic excluded')

const altRare = [clone('c1', { rarity: 'Common' }), clone('u1', { rarity: 'Uncommon' }), clone('t1', { rarity: 'Common', types: ['Token'], superTypes: ['Token'] }), clone('ra', { rarity: 'Rare', altArt: true }), clone('r1', { rarity: 'Rare' })]
const altPack = rollPack(altRare, 'OGN', () => 0.9)
assert(altPack.filter((s) => s.role === 'high').every((s) => s.card.id === 'r1'), 'alt rare excluded')

const stripped = cards.map((c) => {
  if (c.set !== 'VEN') return c
  if ((c.types || []).includes('Rune') || (c.types || []).includes('Token') || (c.superTypes || []).includes('Token')) {
    return { ...c, types: ['Spell'], superTypes: [] }
  }
  return c
})
assert(!boosterSets(stripped).some((s) => s.id === 'VEN'), 'empty token pool skips set')
assert(!boosterSets(cards).some((s) => s.id === 'OGS' || s.id.endsWith('-NN')), 'no proving grounds or nexus')


const ORDER = 'common,common,common,common,common,common,common,uncommon,uncommon,uncommon,token,foil,high,high'
const near = (a, b) => Math.abs(a - b) < 1e-12
const sfd = rollPack(cards, 'SFD', () => 0.4)
assert(sfd.map((s) => s.role).join(',') === ORDER, 'sfd order')
assert(near(pullChance(cards, 'SFD', sfd[0]), 7 / 60), 'sfd common ' + pullChance(cards, 'SFD', sfd[0]))
assert(near(pullChance(cards, 'SFD', sfd[7]), 3 / 63), 'sfd unc')
assert(near(pullChance(cards, 'SFD', sfd[10]), 1 / 9), 'sfd token')
assert(near(pullChance(cards, 'SFD', sfd[11]), 1 / (60 + 63)), 'sfd foil')
assert(near(pullChance(cards, 'SFD', sfd[12]), 2 / 60), 'sfd rare')
const unl = rollPack(cards, 'UNL', () => 0.4)
assert(near(pullChance(cards, 'UNL', unl[12]), 2 / 60), 'unl rare')
assert(near(pullChance(cards, 'VEN', rollPack(cards, 'VEN', () => 0.4)[0]), 7 / 48), 'ven common')
assert(near(pullChance(cards, 'VEN', rollPack(cards, 'VEN', () => 0.4)[12]), 2 / 45), 'ven rare')
const ognOff = rollPack(cards, 'OGN', atEpic)
assert(ognOff[12].card.rarity === 'Rare' && ognOff[13].card.rarity === 'Rare', 'ogn highs are rares')
assert(near(pullChance(cards, 'OGN', ognOff[0]), 7 / 78), 'ogn common')
assert(near(pullChance(cards, 'OGN', ognOff[7]), 3 / 84), 'ogn unc')
assert(near(pullChance(cards, 'OGN', ognOff[10]), 1 / 11), 'ogn token')
assert(near(pullChance(cards, 'OGN', ognOff[11]), 1 / (78 + 84)), 'ogn foil')
assert(near(pullChance(cards, 'OGN', ognOff[12]), 1.75 / 84), 'ogn rare')
const ognOn = rollPack(cards, 'OGN', justUnderEpic)
assert(ognOn[12].card.rarity === 'Epic' && ognOn[13].card.rarity === 'Rare', 'ogn epic first high')
assert(near(pullChance(cards, 'OGN', ognOn[12]), (1 / 4) / 30), 'ogn epic chance')
const radOn = rollPack(cards, 'RAD', justUnderUr)
assert(radOn[13].card.id === 'rad-164-ur' && radOn[12].card.rarity === 'Rare', 'rad ur last')
assert(pullChance(cards, 'RAD', radOn[13]) === 0.00025, 'rad ur chance')
// ponytail: pool sizes from the catalog so new RAD reveals do not break this
const rad = cards.filter((c) => c.set === 'RAD')
const radRares = rad.filter((c) => c.rarity === 'Rare' && !c.altArt && !c.overnumbered && !c.signed && !(c.superTypes || []).includes('Signature')).length
const radCommons = rad.filter((c) => c.rarity === 'Common' && !c.signed && !c.overnumbered && !(c.tags || []).includes('showcase') && !(c.tags || []).includes('promo') && !(c.types || []).some((t) => t === 'Rune' || t === 'Token')).length
assert(near(pullChance(cards, 'RAD', radOn[12]), Math.min(1, (2 - 0.00025) / radRares)), 'rad rare')
assert(near(pullChance(cards, 'RAD', radOn[0]), Math.min(1, 7 / radCommons)), 'rad common')
const radOff = rollPack(cards, 'RAD', atUr)
assert(radOff[12].card.rarity === 'Rare' && radOff[13].card.rarity === 'Rare', 'rad no ur')
assert(!rollPack(cards, 'SFD', justUnderEpic).some((s) => s.card.rarity === 'Epic'), 'sfd no invented epic')

console.log('ok', hits)
