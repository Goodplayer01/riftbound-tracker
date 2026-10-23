import type { BorrowedCard, Card } from './types'
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
