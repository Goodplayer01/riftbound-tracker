/** public/rules.json: the official Core and Tournament Rules, baked daily from the PDFs on the
 *  playriftbound.com rules hub (scripts/bake_rules.mjs, workflow "Bake rules"). Loaded live from main
 *  like the prices, so new rules reach every app without a release; the bundled copy covers offline. */

import { loadLiveJson } from './liveJson.ts'

export type Rule = { n: string; t: string; h?: true }
export type RulesDoc = { id: string; title: string; lastUpdated: string; url: string; rules: Rule[] }
export type RulesFile = { updatedAt: string; docs: RulesDoc[] }

function isRulesFile(x: unknown): x is RulesFile {
  const f = x as RulesFile
  return !!f && Array.isArray(f.docs) && f.docs.length > 0 && f.docs.every((d) => Array.isArray(d.rules) && d.rules.length > 0)
}

/** Live copy from main, the bundled file when offline. */
export function loadRules(): Promise<RulesFile | null> {
  return loadLiveJson('rules.json', isRulesFile)
}

/** Lower case search words; empty when there is nothing to search for. */
export function searchWords(query: string) {
  return query.toLowerCase().split(/\s+/).filter(Boolean)
}

/**
 * Rules matching a search. A rule number ("350", "350.2", "185.2.a") finds that rule and its sub-rules;
 * anything else needs every word somewhere in the rule text (order free, "token play" finds "play ... token").
 */
export function searchRules(rules: Rule[], query: string): Rule[] {
  const words = searchWords(query)
  if (!words.length) return rules
  if (words.length === 1 && /^\d{1,3}(\.[0-9a-z]+)*\.?$/.test(words[0])) {
    const p = words[0].replace(/\.$/, '')
    return rules.filter((r) => r.n === p || r.n.startsWith(`${p}.`) || (p.length < 3 && !p.includes('.') && r.n.startsWith(p)))
  }
  return rules.filter((r) => {
    const s = r.t.toLowerCase()
    return words.every((w) => s.includes(w))
  })
}
