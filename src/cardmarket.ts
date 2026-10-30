import { CM_LANGUAGE, CONDITION_FACTOR, type CopyGroup } from './copies'
import type { Card, PriceEntry } from './types'

/** One export row: a card and how many copies (normal / foil). */
export type CmLine = {
  card: Card
  qty: number
  foil: number
  price?: PriceEntry | null
  /** The seller's own asking price per copy (sales cart); replaces the trend in sell lists. */
  ask?: number | null
  /** Language and condition of the copies; without it every copy is English NM. */
  groups?: Pick<CopyGroup, 'foil' | 'n' | 'lang' | 'cond'>[]
}

/** Cardmarket product name, e.g. "Darius - Trifarian". */
export function cmName(c: Card) {
  return c.subtitle ? `${c.name} - ${c.subtitle}` : c.name
}

/** Version number from the Cardmarket URL (".../Darius-Trifarian-V2-Showcase" -> 2). */
export function cmVersion(p?: PriceEntry | null) {
  const m = p?.cmUrl?.match(/-V(\d+)(?:-[^/]*)?$/)
  return m ? Number(m[1]) : null
}

/** Expansion name as Cardmarket spells it in the product URL ("Origins", "Spiritforged"). */
function cmExpansion(c: Card, p?: PriceEntry | null) {
  const m = p?.cmUrl?.match(/\/Singles\/([^/]+)\//)
  return m ? decodeURIComponent(m[1]).replace(/-/g, ' ') : c.setName
}

/** Asking price per copy: the trend, not the low. The low is often a single
 *  cheap listing and would undersell the card. */
function sellUnit(p: PriceEntry | null | undefined, foil: boolean) {
  if (!p) return null
  const n = p.trend ?? p.avg30 ?? p.low
  return foil ? p.foilTrend ?? p.foilLow ?? n : n
}

/** Wants list text for Cardmarket's "add cards from text": "2x Name (V.2)", one card per line.
 *  The version is only added for V2 and up, so V1 lines match any print. */
export function wantsText(lines: CmLine[]) {
  return lines
    .filter((l) => l.qty + l.foil > 0)
    .map((l) => {
      const v = cmVersion(l.price)
      return `${l.qty + l.foil}x ${cmName(l.card)}${v && v > 1 ? ` (V.${v})` : ''}`
    })
    .join('\n')
}

/** Readable sell list with the own asking price per copy, else the trend. */
export function sellText(lines: CmLine[], fmt: (eur: number) => string | null) {
  const out: string[] = []
  for (const l of lines) {
    for (const foil of [false, true]) {
      const n = foil ? l.foil : l.qty
      if (n <= 0) continue
      const u = l.ask ?? sellUnit(l.price, foil)
      out.push(`${n}x ${cmName(l.card)} (${l.card.code})${foil ? ' Foil' : ''}${u != null ? ` – ${fmt(u)}` : ''}`)
    }
  }
  return out.join('\n')
}

function csvCell(v: string | number) {
  const s = String(v)
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Stock list as CSV with Cardmarket product ids (idProduct), language and condition per copy
 *  (English NM when unknown), priced at the own asking price, else the trend minus the usual condition discount. */
export function stockCsv(lines: CmLine[]) {
  const rows = [['idProduct', 'Count', 'Name', 'Expansion', 'Language', 'Condition', 'isFoil', 'Price'].join(';')]
  for (const l of lines) {
    const groups = l.groups ?? [
      { foil: false, n: l.qty, lang: 'EN' as const, cond: 'NM' as const },
      { foil: true, n: l.foil, lang: 'EN' as const, cond: 'NM' as const },
    ]
    for (const g of groups) {
      if (g.n <= 0) continue
      // The own price is final; the trend gets the usual discount for worse conditions.
      const trend = sellUnit(l.price, g.foil)
      const unit = l.ask ?? (trend != null ? trend * CONDITION_FACTOR[g.cond] : null)
      rows.push([
        l.price?.cmId ?? '',
        g.n,
        cmName(l.card),
        cmExpansion(l.card, l.price),
        CM_LANGUAGE[g.lang],
        g.cond,
        g.foil ? 'true' : 'false',
        unit != null ? unit.toFixed(2) : '',
      ].map(csvCell).join(';'))
    }
  }
  return rows.join('\r\n')
}
