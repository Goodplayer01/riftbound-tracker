// Bakes official card errata into public/card-errata.json from the playriftbound.com
// errata articles. Keyed by lower case card name ("name" or "name, subtitle"), so every printing
// of a card gets its errata. Add new errata articles to PAGES and run:
//   node scripts/bake_errata.mjs
import { writeFileSync } from 'node:fs'

const BASE = 'https://playriftbound.com/en-us/news/'
// Oldest first: a later article overrides an earlier errata of the same card.
const PAGES = [
  'rules-and-releases/riftbound-origins-card-errata',
  'rules-and-releases/riftbound-spiritforged-errata',
  'rules-and-releases/unleashed-errata-updates',
  'announcements/radiance-errata-updates',
]

const decode = (s) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;|&#39;|&rsquo;|’/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

/** Article body HTML: the longest string in __NEXT_DATA__ that holds the errata markers. */
function articleHtml(page) {
  const json = page.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1]
  if (!json) throw new Error('no __NEXT_DATA__')
  let best = ''
  const walk = (v) => {
    if (typeof v === 'string') {
      if (v.includes('[NEW TEXT]') && v.length > best.length) best = v
    } else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(JSON.parse(json))
  if (!best) throw new Error('no errata in article')
  return best
}

/**
 * Card name, [NEW TEXT], lines, ▲, [OLD TEXT], lines. The articles differ in heading
 * levels, so the card name is whatever block comes right before [NEW TEXT].
 */
export function parseErrata(html) {
  const blocks = [...html.matchAll(/<(h\d|p)\b[^>]*>([\s\S]*?)<\/\1>/g)]
    .map(([, tag, inner]) => ({ tag, text: decode(inner) }))
    .filter((b) => b.text && b.text !== '▲')
  const out = {}
  let card = null
  let mode = null
  blocks.forEach(({ tag, text }, i) => {
    if (blocks[i + 1]?.text.startsWith('[NEW TEXT]')) {
      card = out[text] = { newText: [], oldText: [] }
      mode = null
    } else if (text.startsWith('[NEW TEXT]')) mode = 'newText'
    else if (text.startsWith('[OLD TEXT]')) mode = 'oldText'
    else if (tag !== 'p') mode = null // section heading like "Origins Cards"
    else if (card && mode) card[mode].push(text)
  })
  for (const [name, e] of Object.entries(out)) {
    if (!e.newText.length) delete out[name]
    else out[name] = { newText: e.newText.join('\n'), oldText: e.oldText.join('\n') }
  }
  return out
}

if (process.argv[1]?.endsWith('bake_errata.mjs')) {
  // Legends are "Champion, Title" in the articles and in the catalog (name + subtitle), like units.
  const keyFor = (name) => name.toLowerCase()
  const byName = {}
  for (const slug of PAGES) {
    const res = await fetch(`${BASE}${slug}/`, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) throw new Error(`${slug}: HTTP ${res.status}`)
    const found = parseErrata(articleHtml(await res.text()))
    console.log(`${slug}: ${Object.keys(found).length} cards`)
    // Lower case: the articles write "Leblanc", the catalog "LeBlanc".
    for (const [name, e] of Object.entries(found)) byName[keyFor(name)] = { ...e, source: `${BASE}${slug}/` }
  }
  writeFileSync(new URL('../public/card-errata.json', import.meta.url), JSON.stringify({ byName }, null, 1) + '\n')
  console.log(`total: ${Object.keys(byName).length} cards`)
}
