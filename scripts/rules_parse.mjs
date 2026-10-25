/** Turns the text lines of an official Riftbound rules PDF into numbered rules (used by bake_rules.mjs). */

/** "103.2.b.1. Text" at the left margin starts a rule. */
const RULE = /^(\d{3}(?:\.[0-9a-z]+)*)\.\s+(.*)$/

/**
 * @param {{ x: number, text: string }[]} lines all lines of the document in reading order
 * @returns {{ title: string, lastUpdated: string, rules: { n: string, t: string, h?: true }[] }}
 */
export function parseRules(lines) {
  // The left margin is where most rule numbers sit (a few stray lines sit further left, some rules 1 pt right).
  const votes = new Map()
  for (const l of lines) if (RULE.test(l.text.trim())) votes.set(Math.round(l.x), (votes.get(Math.round(l.x)) || 0) + 1)
  const margin = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0
  const rules = []
  let cur = null
  for (const { x, text } of lines) {
    const s = text.trim()
    if (!s) continue
    // Indented lines are continuations, even when they happen to start with a number.
    const m = x <= margin + 6 ? RULE.exec(s) : null
    if (m) {
      cur = { n: m[1], t: m[2].trim() }
      rules.push(cur)
    } else if (cur) {
      // Examples get their own paragraph; a line ending in "-" is a split compound ("non-" + "Board").
      cur.t += /^Example\b/.test(s) ? `\n${s}` : `${cur.t.endsWith('-') ? '' : ' '}${s}`
    }
  }
  // "101. Deck Construction": top level number, short text without closing punctuation.
  for (const r of rules) {
    if (!r.n.includes('.') && r.t.length < 70 && !/[.:;!?)]$/.test(r.t) && !r.t.includes('\n')) r.h = true
  }
  const head = lines.slice(0, 6).map((l) => l.text.trim())
  const updated = head.map((s) => /Last Updated:?\s*(.+)$/i.exec(s)?.[1]).find(Boolean) || ''
  return { title: head[0] || '', lastUpdated: updated.trim(), rules }
}
