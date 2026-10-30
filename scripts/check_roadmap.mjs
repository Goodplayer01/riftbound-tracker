import { readFileSync } from 'node:fs'
import { daysUntil, isRoadmapFile, upcoming } from '../src/roadmap.ts'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// The shipped file must pass the same check the app uses, or the app would ignore it.
const file = JSON.parse(readFileSync(new URL('../public/roadmap.json', import.meta.url), 'utf8'))
assert(isRoadmapFile(file), 'public/roadmap.json is valid')
const bad = file.items.findIndex((i, n) => !isRoadmapFile({ ...file, items: [i] }))
assert(bad === -1, `item ${bad} is invalid`)
assert(!isRoadmapFile({ ...file, items: [{ kind: 'release', name: 'X', from: '2027-02-30x' }] }), 'bad day rejected')
assert(!isRoadmapFile({ ...file, items: [{ kind: 'release', name: 'X', from: '2027-02-10', to: '2027-02-01' }] }), 'end before start rejected')
assert(!isRoadmapFile({ ...file, items: [{ kind: 'party', name: 'X', from: '2027-02-10' }] }), 'unknown kind rejected')
assert(!isRoadmapFile({ ...file, items: [{ kind: 'regional', name: 'X', from: '2027-02-10', buy: 3 }] }), 'non-text buy rejected')

// Upcoming: running dates stay, past ones go, soonest first.
const items = [
  { kind: 'release', name: 'Later', from: '2027-01-29' },
  { kind: 'convention', name: 'Running', from: '2026-10-28', to: '2026-11-01' },
  { kind: 'showdown', name: 'Past', from: '2026-10-20' },
  { kind: 'regional', name: 'Soon', from: '2026-11-06', to: '2026-11-08' },
]
assert(upcoming(items, '2026-10-30').map((i) => i.name).join() === 'Running,Soon,Later', 'upcoming order and filter')
assert(daysUntil(items[3], '2026-10-30') === 7 && daysUntil(items[1], '2026-10-30') === 0, 'days until start, 0 while running')

console.log('ok')
