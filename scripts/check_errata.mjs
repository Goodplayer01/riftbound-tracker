import { readFileSync } from 'node:fs'
import { parseErrata } from './bake_errata.mjs'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// Heading levels differ between articles; section headings must not end up in a card's text.
const html =
  '<h1>Spiritforged Cards</h1><h2>Guards!</h2><p><strong>[NEW TEXT]&nbsp;</strong></p><p>New &#x27;one&#x27;</p>' +
  '<p>Line <em>two</em></p><p>▲</p><p><strong>[OLD TEXT]</strong></p><p>Old</p>' +
  '<h1>Vendetta Cards</h1><h2>Rek’Sai, Swarm Queen</h2><h5>[NEW TEXT]</h5><p>B new</p><h4>▲</h4><h5>[OLD TEXT]</h5><p>B old</p>'
const out = parseErrata(html)
assert(Object.keys(out).join('|') === "Guards!|Rek'Sai, Swarm Queen", 'card names, apostrophe normalised')
assert(out['Guards!'].newText === "New 'one'\nLine two", 'new text lines, inline tags stripped')
assert(out['Guards!'].oldText === 'Old', 'old text stops at the next section')
assert(out["Rek'Sai, Swarm Queen"].oldText === 'B old', 'h5/h4 markers')

// Every baked errata belongs to a catalog card (lookup is by lower case "name" or "name, subtitle").
const { byName } = JSON.parse(readFileSync(new URL('../public/card-errata.json', import.meta.url), 'utf8'))
const { cards } = JSON.parse(readFileSync(new URL('../public/cards.json', import.meta.url), 'utf8'))
const names = new Set(cards.flatMap((c) => [c.name, `${c.name}, ${c.subtitle}`].map((n) => n.toLowerCase())))
const orphans = Object.keys(byName).filter((n) => !names.has(n))
assert(!orphans.length, `errata without a card: ${orphans.join(', ')}`)

console.log('check_errata ok')
