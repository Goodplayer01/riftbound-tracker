// Bakes public/matchups.json from RiftLite's community match matrix (workflow "Bake matchups", daily).
// RiftLite players upload their own matches (with the deck they played); robots.txt allows /community.
// One page load a day: the matrix page already holds the season's pooled matrix and every match.
// The file is only rewritten when the numbers changed. The app loads it live from main like prices.json.
import { readFileSync, writeFileSync } from 'node:fs'
import { nextPayload, findMatrixData, buildMatchups } from './matchups_parse.mjs'

const SOURCE = 'https://www.riftlite.com/community/matrix'
const OUT = new URL('../public/matchups.json', import.meta.url)
/** Fewer matches than this means the page changed or broke: keep the old file. */
const MIN_MATCHES = 200

const r = await fetch(SOURCE, { headers: { 'User-Agent': 'riftbound-tracker-bake (github.com/Goodplayer01/riftbound-tracker)' } })
if (!r.ok) throw new Error(`${SOURCE}: HTTP ${r.status}`)
const { matrix, matches } = findMatrixData(nextPayload(await r.text()))
if (!matrix?.cells?.length) throw new Error('no matrix cells found, page layout changed?')
const body = buildMatchups(matrix, matches)
if (body.matches < MIN_MATCHES) throw new Error(`only ${body.matches} matches`)

let old = null
try { old = JSON.parse(readFileSync(OUT, 'utf8')) } catch { /* first bake */ }
if (old) {
  const { updatedAt: _u, source: _s, ...rest } = old
  if (JSON.stringify(rest) === JSON.stringify(body)) {
    console.log('matchups unchanged')
    process.exit(0)
  }
}
const file = { updatedAt: new Date().toISOString(), source: SOURCE, ...body }
writeFileSync(OUT, JSON.stringify(file) + '\n')
console.log(`matchups.json: ${body.matches} matches, ${body.decks} decks, ${Object.keys(body.legends).length} legends`)
for (const [l, [w, ls]] of Object.entries(body.legends).sort((a, b) => b[1][0] + b[1][1] - a[1][0] - a[1][1]).slice(0, 8)) {
  console.log(`  ${l}: ${w}-${ls}`)
}
