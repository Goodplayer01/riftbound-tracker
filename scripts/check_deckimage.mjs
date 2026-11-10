import { readFileSync } from 'node:fs'
import { deckReadText, findLayout, tileCounts } from '../src/deckFromImage.ts'
import { parseDeckImport } from '../src/deckHelpers.ts'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// A share image drawn by hand, 2 px per logical px: Legend 210 wide at 28, grid of 100 wide cards from 262,
// 8 apart, two main rows (the second one short), 48 to the sideboard row, two battlefields under the Legend.
const S = 2
const W = 1000 * S
const H = 700 * S
const data = new Uint8ClampedArray(W * H * 4)
for (let i = 0; i < data.length; i += 4) data.set([15, 15, 17, 255], i)
// Card faces are lit inside a black border of 2.2 % (x) and 2.4 % (y).
function tile(x, y, w, h) {
  const bx = w * 0.022, by = h * 0.024
  for (let py = Math.round((y + by) * S); py < Math.round((y + h - by) * S); py++) {
    for (let px = Math.round((x + bx) * S); px < Math.round((x + w - bx) * S); px++) data.set([180, 120, 200, 255], (py * W + px) * 4)
  }
}
const cardH = 100 * 1039 / 744
tile(28, 104, 210, 293)
tile(28, 500, 210, 150)
const rowY = [128, 128 + cardH + 8, 128 + 2 * cardH + 8 + 48]
const perRow = [6, 4, 3]
rowY.forEach((y, r) => { for (let c = 0; c < perRow[r]; c++) tile(262 + c * 108, y, 100, cardH) })

const layout = findLayout({ width: W, height: H, data })
assert(layout, 'layout found')
assert(layout.rows.map((r) => r.length).join() === '6,4,3', `rows: ${layout.rows.map((r) => r.length)}`)
assert(layout.sideRow === 2, `sideboard starts at row 2: ${layout.sideRow}`)
assert(Math.abs(layout.scale - S) < 0.03, `scale: ${layout.scale}`)
assert(layout.battlefields.length === 1 && layout.legend, 'legend and battlefield')
const near = (a, b) => Math.abs(a - b) <= 2 * S
const t0 = layout.rows[0][0]
assert(near(t0.x, 262 * S) && near(t0.y, 128 * S) && near(t0.w, 100 * S) && near(t0.h, cardH * S), `first tile: ${JSON.stringify(t0)}`)
assert(near(layout.legend.x, 28 * S) && near(layout.legend.w, 210 * S), `legend: ${JSON.stringify(layout.legend)}`)
assert(findLayout({ width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) }) === null, 'no deck in an empty picture')

// Counts and text with real cards.
globalThis.localStorage ??= { getItem: () => null, setItem: () => {} }
const cards = JSON.parse(readFileSync(new URL('../public/cards.json', import.meta.url))).cards
const byId = new Map(cards.map((c) => [c.id, c]))
const T = (id, badge = 0, pill = 0) => ({ card: byId.get(id), badge, pill })

// Single tiles take their badge; framed prints share the badge on the last one, the extra copy goes to the "×2" print.
assert(tileCounts([T('ogn-001-298'), T('ogn-043-298', 3)]).join() === '1,3', 'plain badges')
assert(tileCounts([T('unl-028-219', 0, 0.2), T('unl-028a-219', 3, 0.9)]).join() === '1,2', 'frame of two prints, second one twice')
assert(tileCounts([T('unl-028-219', 0, 0.9), T('unl-028a-219', 3, 0.2)]).join() === '2,1', 'frame of two prints, first one twice')
assert(tileCounts([T('unl-028-219'), T('unl-028a-219')]).join() === '1,1', 'frame without badge')

const text = deckReadText({
  legend: byId.get('unl-193-219'),
  battlefields: [byId.get('ogn-278-298')],
  main: [T('unl-150-219'), T('ogn-043-298', 3), T('unl-028-219', 0, 0.9), T('unl-028a-219', 3, 0.2)],
  side: [T('ogn-043-298'), T('rad-114a', 2)],
  runes: [{ domain: 'Calm', qty: 7 }, { domain: 'Chaos', qty: 5 }],
}, cards)
const back = new Map(parseDeckImport(text, cards).cards.map((c) => [`${c.id}|${c.section}`, c.qty]))
const want = {
  'unl-193-219|legend': 1, 'unl-150-219|champion': 1, 'ogn-043-298|main': 3, 'unl-028-219|main': 2, 'unl-028a-219|main': 1,
  'ogn-278-298|battlefield': 1, 'ogn-043-298|sideboard': 1, 'rad-114a|sideboard': 2,
}
for (const [k, q] of Object.entries(want)) assert(back.get(k) === q, `${k}: want ${q}, got ${back.get(k)}\n${text}`)
assert([...back].filter(([k]) => k.endsWith('|rune')).map(([, q]) => q).sort().join() === '5,7', `runes: ${text}`)
assert(back.size === Object.keys(want).length + 2, `nothing else: ${[...back.keys()]}`)

console.log('check_deckimage ok')
