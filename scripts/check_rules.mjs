import { parseRules } from './rules_parse.mjs'
import { searchRules } from '../src/rules.ts'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// A page as the PDF gives it: rule numbers at the margin (one 1 pt off), continuations and examples indented.
const lines = [
  { x: 133, text: 'Riftbound Core Rules' },
  { x: 238, text: 'Last Updated: 2026-10-09' },
  { x: 41, text: 'stray line left of the margin' },
  { x: 44, text: '100. Game Concepts' },
  { x: 44, text: '103.2.b.1. Cards included in your deck must abide by your Domain' },
  { x: 236, text: 'Identity.' },
  { x: 45, text: '350.2. Tokens are not cards, but can still be Played. See rule' },
  { x: 236, text: '179. Tokens for more information.' },
  { x: 200, text: 'Example: A Recruit token is played to a battlefield.' },
  { x: 44, text: '351. Permanents are non-' },
  { x: 128, text: 'Board objects too.' },
]
const doc = parseRules(lines)
assert(doc.title === 'Riftbound Core Rules' && doc.lastUpdated === '2026-10-09', 'title and date')
assert(doc.rules.map((r) => r.n).join(' ') === '100 103.2.b.1 350.2 351', 'rule numbers, stray line ignored')
assert(doc.rules[0].h === true && !doc.rules[1].h, 'short top level rule is a heading')
assert(doc.rules[1].t === 'Cards included in your deck must abide by your Domain Identity.', 'continuation joined')
const tok = doc.rules[2].t
assert(tok.includes('See rule 179. Tokens') && tok.endsWith('\nExample: A Recruit token is played to a battlefield.'), 'indented number is no new rule, example is its own paragraph')
assert(doc.rules[3].t === 'Permanents are non-Board objects too.', 'split compound joined without space')

// Search: a number finds the rule and its sub-rules, words match in any order.
const rules = [
  { n: '350', t: 'Playing Cards' },
  { n: '350.2', t: 'Tokens are not cards, but can still be Played.' },
  { n: '351', t: 'Permanents become Game Objects when Played.' },
  { n: '185.2.a', t: 'Tokens can be played by their owner.' },
]
assert(searchRules(rules, '350').length === 2 && searchRules(rules, '350.2.').length === 1, 'number search')
assert(searchRules(rules, '35').length === 3, 'number prefix')
assert(searchRules(rules, 'played token').map((r) => r.n).join() === '350.2,185.2.a', 'words in any order')
assert(searchRules(rules, '  ').length === 4, 'empty search keeps everything')

console.log('check_rules ok')
