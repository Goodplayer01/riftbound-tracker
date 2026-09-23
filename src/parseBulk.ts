import type { Card } from './types'

/** Parse lines/tokens like OGN-056/298, OGN-56, OGN 56, ogn-056a/298, OGN-304* */
export function parseBulkTokens(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

function normalizeCode(token: string): { set?: string; cn?: string; alt?: string; signed?: boolean; raw: string } {
  const t = token.toUpperCase().replaceAll('\\', '/').replace(/★/g, '*')
  // OGN-056A/298 or OGN-304*/298 or OGN-056/298 or OGN-056A or OGN-304*
  let m = t.match(/^([A-Z]{2,4})-?(\d{1,3})([A-Z])?(\*)?(?:\/\d+)?$/)
  if (m) return { set: m[1], cn: String(Number(m[2])), alt: m[3]?.toLowerCase(), signed: !!m[4], raw: t }
  // OGN 56
  m = t.match(/^([A-Z]{2,4})[ \/]+(\d{1,3})([A-Z])?(\*)?$/)
  if (m) return { set: m[1], cn: String(Number(m[2])), alt: m[3]?.toLowerCase(), signed: !!m[4], raw: t }
  return { raw: t }
}

export function resolveToken(token: string, cards: Card[]): Card | undefined {
  const n = normalizeCode(token)
  if (n.set && n.cn) {
    const wantAlt = n.alt
    const wantSigned = !!n.signed
    const matches = cards.filter((c) => {
      if (c.set !== n.set) return false
      if (String(c.cn) !== n.cn) return false
      const codeAlt = (
        c.code.match(/-(\d+)([a-zA-Z])[*/]/)?.[2] ||
        c.id.match(/-(\d+)([a-z])-/)?.[2] ||
        ''
      ).toLowerCase()
      const isSigned = !!(c.signed || /[*★]/.test(c.code) || /-star-/.test(c.id))
      if (wantSigned !== isSigned) return false
      if (wantAlt) return codeAlt === wantAlt
      return !codeAlt
    })
    if (matches[0]) return matches[0]
    return cards.find((c) => c.set === n.set && String(c.cn) === n.cn && !!c.signed === wantSigned)
  }
  const up = token.toUpperCase().replace(/★/g, '*')
  return (
    cards.find((c) => c.code.toUpperCase().replace(/★/g, '*') === up) ||
    cards.find((c) => c.code.toUpperCase().replace(/★/g, '*').replace(/\/\d+$/, '') === up) ||
    cards.find((c) => c.id.toUpperCase() === up) ||
    cards.find((c) => c.name.toUpperCase() === up)
  )
}
