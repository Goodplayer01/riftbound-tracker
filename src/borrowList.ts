import type { BorrowedCard, BorrowedGroup, Card, Owned } from './types'
import { subtractOwnedCopies } from './collection.ts'
import { displayCardName, parseDeckImport } from './deckHelpers.ts'

/** First line of an exported lent list; importing it into an empty entry marks that entry as borrowed from someone. */
export const LENT_HEADER = '# Deakrix Riftbound Tracker: lent cards'

/** One line per card, `qty code name`, so the import gets the exact print back. */
export function formatBorrowList(cards: BorrowedCard[], byId: Map<string, Card>, name: string, lent: boolean): string {
  const lines = [lent ? LENT_HEADER : '# Deakrix Riftbound Tracker: borrowed cards', `# ${name}`]
  for (const bc of cards) {
    const c = byId.get(bc.id)
    lines.push(c ? `${bc.qty} ${c.code} ${displayCardName(c)}` : `${bc.qty} ${bc.id}`)
  }
  return lines.join('\n')
}

/** Lines starting with `qty code` match by card code, everything else goes through the deck list parser (names). */
export function parseBorrowList(text: string, cards: Card[]): { cards: BorrowedCard[]; unmatched: string[] } {
  const byCode = new Map(cards.map((c) => [c.code.toUpperCase(), c]))
  const m = new Map<string, number>()
  const rest: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const hit = raw.trim().match(/^(\d+)\s*[xX]?\s+(\S+)/)
    const card = hit && byCode.get(hit[2].toUpperCase())
    if (hit && card) m.set(card.id, (m.get(card.id) || 0) + Math.max(1, Number(hit[1])))
    else rest.push(raw)
  }
  const named = parseDeckImport(rest.join('\n'), cards)
  for (const c of named.cards) m.set(c.id, (m.get(c.id) || 0) + c.qty)
  return { cards: [...m.entries()].map(([id, qty]) => ({ id, qty })), unmatched: named.unmatched }
}

/**
 * The cards `ids` of entry `groupId` changed hands for good (traded, sold, kept): borrowed-from copies join
 * the collection as normal copies, lent copies leave it (normal first, then foil, like a sale). Either way they
 * leave the entry. Returns new groups and collection, the inputs stay untouched.
 */
export function settleBorrowed(groups: BorrowedGroup[], groupId: string, ids: string[], collection: Record<string, Owned>) {
  const g = groups.find((x) => x.id === groupId)
  if (!g) return { groups, collection, copies: 0 }
  const pick = new Set(ids)
  const out = { ...collection }
  let copies = 0
  for (const bc of g.cards) {
    if (!pick.has(bc.id) || bc.qty <= 0) continue
    const cur = out[bc.id] || { qty: 0, foil: 0 }
    const next = g.direction === 'from' ? { ...cur, qty: (cur.qty || 0) + bc.qty } : (({ qty, foil }) => ({ ...cur, qty, foil }))(subtractOwnedCopies(cur, bc.qty))
    copies += bc.qty
    if (next.qty + next.foil > 0) out[bc.id] = next
    else delete out[bc.id]
  }
  const left = { ...g, cards: g.cards.filter((c) => !pick.has(c.id)), updatedAt: new Date().toISOString() }
  return { groups: groups.map((x) => (x.id === groupId ? left : x)), collection: out, copies }
}
