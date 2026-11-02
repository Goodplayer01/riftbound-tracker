import type { Card } from './types'

/** Lower case without apostrophes, so "Kha'Zix", "Kha’Zix" and "khazix" read the same. */
export function searchNorm(s: string) {
  return s.toLowerCase().replace(/['’‘`´]/g, '')
}

/** Everything a card search looks at: name, title, code, id, domains, types, rarity and tags. */
export function cardSearchHay(c: Card) {
  return searchNorm([
    c.name,
    c.subtitle || '',
    c.code,
    c.id,
    ...(c.domains || []),
    ...(c.types || []),
    c.rarity || '',
    ...(c.tags || []),
  ].join(' '))
}

/** Every word of the query somewhere on the card, in any order: "vex legend" finds "Vex, Gloomist"
 *  (type Legend), "khazix" finds "Kha'Zix". An empty query matches everything. */
export function cardMatchesQuery(c: Card, query: string) {
  const words = searchNorm(query).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = cardSearchHay(c)
  return words.every((w) => hay.includes(w))
}
