// Bakes public/rules.json from the official Riftbound rules PDFs (workflow "Bake rules", daily).
// The rules hub on playriftbound.com always links the current Core Rules and Tournament Rules PDFs;
// both are read, split into numbered rules and written only when the text changed.
import { readFileSync, writeFileSync } from 'node:fs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { parseRules } from './rules_parse.mjs'

const HUB = 'https://playriftbound.com/en-us/rules-hub/'
const OUT = new URL('../public/rules.json', import.meta.url)
/** Fewer rules than this means the PDF layout changed or the download broke: keep the old file. */
const MIN_RULES = 200

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'riftbound-tracker-bake' } })
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  return r
}

/** Text lines of a PDF in reading order. Items of one line are joined with a space where there is a gap
 *  (font changes such as "a" + "Riftbound" come as separate items without one). */
async function pdfLines(data) {
  const doc = await getDocument({ data, useSystemFonts: true }).promise
  const out = []
  for (let p = 1; p <= doc.numPages; p++) {
    const { items } = await (await doc.getPage(p)).getTextContent()
    const rows = new Map()
    for (const it of items) {
      if (!('str' in it) || !it.str) continue
      const y = Math.round(it.transform[5])
      if (!rows.has(y)) rows.set(y, [])
      rows.get(y).push(it)
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) {
      const parts = rows.get(y).sort((a, b) => a.transform[4] - b.transform[4])
      let text = ''
      let end = null
      for (const it of parts) {
        const x = it.transform[4]
        if (end != null && x - end > 0.8 && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' '
        text += it.str
        end = x + it.width
      }
      out.push({ x: parts[0].transform[4], text })
    }
  }
  return out
}

const html = await (await get(HUB)).text()
const urls = [...new Set(html.match(/https:\/\/cmsassets\.rgpub\.io\/[^"'\s<>]+?\.pdf/g) || [])]
if (!urls.length) throw new Error('no rules PDF linked on the rules hub')

const docs = []
for (const url of urls) {
  const data = new Uint8Array(await (await get(url)).arrayBuffer())
  const { title, lastUpdated, rules } = parseRules(await pdfLines(data))
  const id = /tournament/i.test(title) ? 'tournament' : /core/i.test(title) ? 'core' : null
  if (!id) continue
  if (rules.length < MIN_RULES) throw new Error(`${title}: only ${rules.length} rules parsed`)
  docs.push({ id, title: title.replace(/^Riftbound\s+/i, ''), lastUpdated, url, rules })
  console.log(`${id}: ${rules.length} rules, last updated ${lastUpdated}`)
}
if (!docs.some((d) => d.id === 'core')) throw new Error('Core Rules not found')
docs.sort((a, b) => (a.id === 'core' ? -1 : b.id === 'core' ? 1 : 0))

let old = null
try {
  old = JSON.parse(readFileSync(OUT, 'utf8'))
} catch {
  // first bake
}
if (old && JSON.stringify(old.docs) === JSON.stringify(docs)) {
  console.log('rules unchanged')
} else {
  writeFileSync(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), docs }) + '\n')
  console.log('rules.json written')
}
