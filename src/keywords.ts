/**
 * Static Riftbound keyword glossary (no runtime scrape).
 *
 * Sources (cite briefly in UI/README):
 * - Core Rules keywords: Riftbound Core Rules last updated 2026-07-16
 *   (Rules Hub PDF https://playriftbound.com/en-us/rules-hub/ ; functional
 *   summaries match the public Rift Watcher Core Rules glossary, rule 800+).
 * - Show Off / Disarm / Deploy: official Radiance overview on playriftbound.com
 *   (set mechanics, not Core Rules keyword numbers).
 *
 * Do not invent rulings — blurbs are short official-style functional text only.
 */

import type { Card } from './types'
import type { Lang } from './i18n'
import { t } from './i18n'

/** Stable keyword ids used in i18n keys `kw.{id}.name` / `kw.{id}.blurb`. */
export const KEYWORD_IDS = [
  'accelerate',
  'action',
  'ambush',
  'assault',
  'backline',
  'deathknell',
  'deflect',
  'deploy',
  'disarm',
  'empower',
  'empowered',
  'equip',
  'flow',
  'ganking',
  'hidden',
  'hunt',
  'legion',
  'level',
  'quickDraw',
  'reaction',
  'repeat',
  'shield',
  'showOff',
  'tank',
  'temporary',
  'unique',
  'vision',
  'weaponmaster',
] as const

export type KeywordId = (typeof KEYWORD_IDS)[number]

/** Display label (EN) → id. Used when matching baked card-keyword hits. */
export const KEYWORD_LABEL_TO_ID: Record<string, KeywordId> = {
  Accelerate: 'accelerate',
  Action: 'action',
  Ambush: 'ambush',
  Assault: 'assault',
  Backline: 'backline',
  Deathknell: 'deathknell',
  Deflect: 'deflect',
  Deploy: 'deploy',
  Disarm: 'disarm',
  Empower: 'empower',
  Empowered: 'empowered',
  Equip: 'equip',
  Flow: 'flow',
  Ganking: 'ganking',
  Hidden: 'hidden',
  Hunt: 'hunt',
  Legion: 'legion',
  Level: 'level',
  'Quick-Draw': 'quickDraw',
  'Quick Draw': 'quickDraw',
  Reaction: 'reaction',
  Repeat: 'repeat',
  Shield: 'shield',
  'Show Off': 'showOff',
  Tank: 'tank',
  Temporary: 'temporary',
  Unique: 'unique',
  Vision: 'vision',
  Weaponmaster: 'weaponmaster',
}

/** Match aliases for scanning free text / labels (longer first). */
const DETECT_PATTERNS: { id: KeywordId; re: RegExp }[] = [
  { id: 'quickDraw', re: /\bQuick[\s-]?Draw\b/i },
  { id: 'showOff', re: /\bShow[\s-]?Off\b/i },
  { id: 'weaponmaster', re: /\bWeaponmaster\b/i },
  { id: 'deathknell', re: /\bDeathknell\b/i },
  { id: 'empowered', re: /\bEmpowered\b/i },
  { id: 'temporary', re: /\bTemporary\b/i },
  { id: 'accelerate', re: /\bAccelerate\b/i },
  { id: 'backline', re: /\bBackline\b/i },
  { id: 'reaction', re: /\bReaction\b/i },
  { id: 'ambush', re: /\bAmbush\b/i },
  { id: 'assault', re: /\bAssault\b/i },
  { id: 'deflect', re: /\bDeflect\b/i },
  { id: 'ganking', re: /\bGanking\b/i },
  { id: 'hidden', re: /\bHidden\b/i },
  { id: 'legion', re: /\bLegion\b/i },
  { id: 'shield', re: /\bShield\b/i },
  { id: 'disarm', re: /\bDisarm\b/i },
  { id: 'deploy', re: /\bDeploy\b/i },
  { id: 'empower', re: /\bEmpower\b/i },
  { id: 'action', re: /\bAction\b/i },
  { id: 'equip', re: /\bEquip\b/i },
  { id: 'repeat', re: /\bRepeat\b/i },
  { id: 'vision', re: /\bVision\b/i },
  { id: 'unique', re: /\bUnique\b/i },
  { id: 'level', re: /\bLevel\b/i },
  { id: 'hunt', re: /\bHunt\b/i },
  { id: 'flow', re: /\bFlow\b/i },
  { id: 'tank', re: /\bTank\b/i },
]

export type CardKeywordBook = {
  byCardId: Record<string, string[]>
  sourceNote?: string
}

let cardKeywordBook: CardKeywordBook | null = null

export function setCardKeywordBook(book: CardKeywordBook | null) {
  cardKeywordBook = book
}

export function getCardKeywordBook() {
  return cardKeywordBook
}

function labelsToIds(labels: string[]): KeywordId[] {
  const out: KeywordId[] = []
  const seen = new Set<KeywordId>()
  for (const raw of labels) {
    const id = KEYWORD_LABEL_TO_ID[raw] || KEYWORD_LABEL_TO_ID[raw.replace(/\s+/g, ' ').trim()]
    if (id && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    } else if (!id) {
      // try pattern match on label
      for (const { id: pid, re } of DETECT_PATTERNS) {
        if (re.test(raw) && !seen.has(pid)) {
          seen.add(pid)
          out.push(pid)
          break
        }
      }
    }
  }
  return out
}

/** Detect keyword ids mentioned in free text (e.g. OCR output). */
export function detectKeywordsInText(text: string): KeywordId[] {
  if (!text) return []
  const found: KeywordId[] = []
  const seen = new Set<KeywordId>()
  for (const { id, re } of DETECT_PATTERNS) {
    if (re.test(text) && !seen.has(id)) {
      seen.add(id)
      found.push(id)
    }
  }
  return found
}

/** Keywords known for this printing (baked map), else empty. */
export function keywordsForCard(card: Card): KeywordId[] {
  const labels = cardKeywordBook?.byCardId?.[card.id]
  if (labels && labels.length) return labelsToIds(labels)
  // Light fallback: whole-word match in name/subtitle/tags (rarely hits keyword names)
  const hay = [card.name, card.subtitle || '', ...(card.tags || []), ...(card.types || [])].join(' ')
  const found: KeywordId[] = []
  const seen = new Set<KeywordId>()
  for (const { id, re } of DETECT_PATTERNS) {
    if (re.test(hay) && !seen.has(id)) {
      seen.add(id)
      found.push(id)
    }
  }
  return found
}

export function keywordName(lang: Lang, id: KeywordId): string {
  return t(lang, `kw.${id}.name`)
}

export function keywordBlurb(lang: Lang, id: KeywordId): string {
  return t(lang, `kw.${id}.blurb`)
}

/** Full glossary order for browse-all in lightbox. */
export function allKeywordIds(): KeywordId[] {
  return [...KEYWORD_IDS]
}
