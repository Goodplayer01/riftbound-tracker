import { nextPayload, findMatrixData, buildMatchups } from './matchups_parse.mjs'
import { counterCards, deckInMatchup, legendKey, legendRecord, matchupRows, trickKind, typicalCards, typicalTricks, MIN_COUNTER_GAMES } from '../src/matchups.ts'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// A page as Next.js streams it: two push chunks, the data line split across them.
const line = JSON.stringify(['$', 'div', null, { children: [
  ['$', '$L1e', null, { matches: [
    { result: 'Win', myChampion: 'Rengar', oppChampion: 'Akali', deckSnapshot: { legend: 'Rengar', champion: [{ qty: 1, name: 'Rengar, Trophy Hunter' }], mainDeck: [{ qty: 3, name: 'Decree of Rage' }, { qty: 2, name: 'Cannon Barrage' }], sideboard: [{ qty: 1, name: 'Repulse' }] } },
    { result: 'Loss', myChampion: 'Rengar', oppChampion: 'Akali', deckSnapshot: { legend: 'Rengar', mainDeck: [{ qty: 3, name: 'Cannon Barrage [OGN-127]' }] } },
    { result: 'Win', myChampion: 'Vex', oppChampion: 'Akali', deckSnapshot: { legend: 'Vex', mainDeck: [{ qty: 3, name: 'Decree of Rage' }] } },
    { result: 'Win', myChampion: 'Rengar', oppChampion: 'Akali', superseded: true, deckSnapshot: { legend: 'Rengar', mainDeck: [{ qty: 3, name: 'Decree of Rage' }] } },
    { result: 'Draw', myChampion: 'Rengar', oppChampion: 'Akali', deckSnapshot: { legend: 'Rengar', mainDeck: [{ qty: 3, name: 'Decree of Rage' }] } },
    { result: 'Win', myChampion: 'Rengar', oppChampion: 'Kennen', deckSnapshot: null },
  ] }],
  ['$', '$L1f', null, { matrix: { rows: ['Rengar', 'Akali'], matrixReadyMatchCount: 9, cells: [
    { myLegend: 'Rengar', oppLegend: 'Akali', wins: 3, losses: 2, draws: 1 },
    { myLegend: 'Akali', oppLegend: 'Rengar', wins: 2, losses: 3, draws: 1 },
    { myLegend: 'Rengar', oppLegend: 'Rengar', wins: 4, losses: 4, draws: 0 },
    { myLegend: 'Rengar', oppLegend: 'Kennen', wins: 0, losses: 0, draws: 0 },
  ] } }],
] }])
const stream = `1:I[1,["a.js"]]\n12:${line}\n13:"$Sreact.suspense"\n`
const cut = 40
const html = `<script>self.__next_f.push([1,${JSON.stringify(stream.slice(0, cut))}])</script>` +
  `<script>self.__next_f.push([1,${JSON.stringify(stream.slice(cut))}])</script>`

const payload = nextPayload(html)
assert(payload === stream, 'push chunks joined and unescaped')
const { matrix, matches } = findMatrixData(payload)
assert(matrix?.cells?.length === 4 && matches?.length === 6, 'matrix and matches found in the stream')

const m = buildMatchups(matrix, matches)
assert(m.matches === 9, 'match count from the matrix')
assert(JSON.stringify(m.matrix.Rengar.Akali) === '[3,2,1]', 'matrix cell kept as wins, losses, draws')
assert(!m.matrix.Rengar.Kennen, 'empty cell dropped')
assert(JSON.stringify(m.legends.Rengar) === '[3,2]', 'legend total leaves the mirror out')
assert(m.decks === 3, 'superseded, draws, mirrors and matches without deck are not counted')
const vsAkali = m.vs.Akali
assert(JSON.stringify(vsAkali.n) === '[3,2]', 'decks facing Akali: 3 games, 2 won')
assert(JSON.stringify(vsAkali.cards['Decree of Rage']) === '[2,2]', 'card counted over every legend facing Akali')
assert(JSON.stringify(vsAkali.cards['Cannon Barrage']) === '[2,1]', 'card in a won and a lost deck, print code stripped')
assert(!vsAkali.cards['Repulse'], 'sideboard does not count')
assert(!vsAkali.cards['Rengar, Trophy Hunter'], 'cards seen once are pruned')
assert(JSON.stringify(m.pair.Rengar.Akali.n) === '[2,1]', 'pair keeps only that legend\'s decks')
assert(!m.pair.Rengar.Akali.cards['Decree of Rage'], 'pair prunes by its own count')

assert(JSON.stringify(m.by.Rengar.n) === '[2,1]' && JSON.stringify(m.by.Rengar.cards['Cannon Barrage']) === '[2,1]', 'all decks of a legend')

// App side: ranking and counter cards.
const file = {
  updatedAt: '', source: '', matches: 0, decks: 0,
  legends: { Rengar: [10, 10], 'Master Yi, Wuju Bladesman': [1, 0] },
  matrix: { Rengar: { Akali: [3, 3, 0], Kennen: [1, 4, 1], Vex: [4, 1, 0], Rengar: [5, 5, 0], Ezreal: [0, 0, 2] } },
  vs: { Akali: { n: [40, 20], cards: {
    'Decree of Rage': [10, 8], // clearly better
    'Cannon Barrage': [30, 16], // a bit better, many games
    'Repulse': [2, 2], // too few games
    'Hextech Ray': [20, 8], // worse than average
    'Akali, Silent': [6, 5], // not allowed for this deck
  } } },
  pair: { Rengar: { Akali: { n: [2, 1], cards: { 'Cannon Barrage': [2, 1] } } } },
  by: { Akali: { n: [4, 2], cards: { 'Akali, Silent': [4, 2], 'Shuriken Flip': [3, 1] } }, Rengar: { n: [10, 5], cards: { 'Cannon Barrage': [5, 3] } } },
}
assert(legendKey(file, 'Rengar', 'Rengar, Pridestalker') === 'Rengar', 'legend by champion name')
assert(legendKey(file, 'Master Yi', 'Master Yi, Wuju Bladesman') === 'Master Yi, Wuju Bladesman', 'full name wins')
assert(legendKey(file, 'Teemo', 'Teemo, Swift Scout') === null, 'unknown legend')
const rows = matchupRows(file, 'Rengar')
assert(rows.map((r) => r.opp).join(' ') === 'Vex Akali Kennen Ezreal', 'best first, mirror left out, no decisive games last')
assert(rows[2].games === 6 && Math.abs(rows[2].wr - 0.2) < 1e-9, 'games include draws, win rate does not')
assert(legendRecord(file, 'Rengar').wr === 0.5, 'overall record')
const cc = counterCards(file, 'Rengar', 'Akali', (n) => n !== 'Akali, Silent')
assert(MIN_COUNTER_GAMES === 3, 'min games')
assert(cc.cards.map((c) => c.name).join(' ') === 'Decree of Rage Cannon Barrage', 'ranked by smoothed lift, weak, rare and banned cards out')
assert(cc.cards[1].own?.join() === '2,1' && !cc.cards[0].own, 'own legend numbers attached')
assert(cc.base.join() === '40,20', 'baseline')
assert(cc.cards[1].inLegend === 0.5 && cc.cards[0].inLegend === 0, 'share of the own Legend decks')
assert(counterCards(file, 'Rengar', 'Teemo', () => true).cards.length === 0, 'no data, no cards')
const typ = typicalCards(file, 'Akali')
assert(typ.decks === 4 && typ.cards[0].name === 'Akali, Silent' && typ.cards[0].share === 1, 'typical cards by deck share')

// Tips: tricks the opponent usually runs, by keyword at line start.
assert(trickKind('[Hidden] (Hide now.)\n[Action] (Play on your turn.)\nStun a unit.') === 'hidden', 'hidden beats action')
assert(trickKind('[Quick-Draw] (This has [Reaction].)\n[Equip] [1]') === 'reaction', 'quick-draw is a reaction')
assert(trickKind('Deal 3 to a unit.\nYour spells have [Reaction].') === null, 'a mention in prose is no trick')
assert(trickKind('[Action] (Play on your turn or in showdowns.)\nDeal 2.') === 'action', 'action')
const text = (n) => (n === 'Shuriken Flip' ? '[Action] Deal 2.' : 'When you play me, draw 1.')
const tricks = typicalTricks(file, 'Akali', text)
assert(tricks.length === 1 && tricks[0].name === 'Shuriken Flip' && tricks[0].kind === 'action' && tricks[0].share === 0.75, 'only tricks, with deck share')
assert(typicalTricks(file, 'Akali', text, 0.8).length === 0, 'rare tricks left out')

// The open deck against Akali: base 50 %, smoothed like the counter cards.
const dm = deckInMatchup(file, 'Akali', [
  { name: 'Decree of Rage', side: true },
  { name: 'Hextech Ray', side: false },
  { name: 'Cannon Barrage', side: false },
  { name: 'Repulse', side: true },
  { name: 'Unknown Card', side: false },
])
assert(dm.better.length === 1 && dm.better[0].name === 'Decree of Rage' && dm.better[0].side, 'clearly better sideboard card')
assert(dm.worse.length === 1 && dm.worse[0].name === 'Hextech Ray' && dm.worse[0].lift < 0, 'clearly worse main deck card')
assert(dm.unknown === 2, 'too few games and unseen cards are counted, Cannon Barrage is too close to the average')
assert(deckInMatchup(file, 'Teemo', [{ name: 'Repulse', side: true }]).unknown === 1, 'no data for the opponent')

console.log('check_matchups: ok')
