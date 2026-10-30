import { nextPayload, findMatrixData, buildMatchups } from './matchups_parse.mjs'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// A page as Next.js streams it: two push chunks, the data line split across them.
const line = JSON.stringify(['$', 'div', null, { children: [
  ['$', '$L1e', null, { matches: [
    { result: 'Win', myChampion: 'Rengar', oppChampion: 'Akali', deckSnapshot: { legend: 'Rengar', champion: [{ qty: 1, name: 'Rengar, Trophy Hunter' }], mainDeck: [{ qty: 3, name: 'Decree of Rage' }, { qty: 2, name: 'Cannon Barrage' }], sideboard: [{ qty: 1, name: 'Repulse' }] } },
    { result: 'Loss', myChampion: 'Rengar', oppChampion: 'Akali', deckSnapshot: { legend: 'Rengar', mainDeck: [{ qty: 3, name: 'Cannon Barrage' }] } },
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
assert(JSON.stringify(vsAkali.cards['Cannon Barrage']) === '[2,1]', 'card in a won and a lost deck')
assert(!vsAkali.cards['Repulse'], 'sideboard does not count')
assert(!vsAkali.cards['Rengar, Trophy Hunter'], 'cards seen once are pruned')
assert(JSON.stringify(m.pair.Rengar.Akali.n) === '[2,1]', 'pair keeps only that legend\'s decks')
assert(!m.pair.Rengar.Akali.cards['Decree of Rage'], 'pair prunes by its own count')

console.log('check_matchups: ok')
