import type { Card } from './types'
import { displayCardName } from './deckHelpers'

export type BanStatus = 'banned' | 'banned2v2' | null

/** Normalize for ban-list matching (display name form). */
function normKey(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Official Standard Constructed bans (Rules Hub 2026-09-18).
 * Keys = normalized displayCardName (`name` + optional `, subtitle`).
 * Match all printings/promos of that name — not a single id.
 */
const STANDARD_BANNED = new Set(
  [
    'Called Shot',
    'Ekko, Recurrent',
    'Draven, Vanquisher',
    'Fight or Flight',
    'Scrapheap',
    'Stealthy Pursuer',
    'Stacked Deck',
    "The Arena's Greatest",
    "Aspirant's Climb",
    'The Dreaming Tree',
    // Rules Hub short form
    'Dreaming Tree',
    'Obelisk of Power',
    "Reaver's Row",
  ].map(normKey),
)

/**
 * Extra 2v2-only bans. Catalog: name `Wuju Bladesman`, subtitle `Starter`
 * (ids ogs-019-024 / ogs-019-p). Also accept Rules Hub / display aliases.
 */
const BANNED_2V2 = new Set(
  [
    'Wuju Bladesman',
    'Wuju Bladesman, Starter',
    'Master Yi, Wuju Bladesman',
  ].map(normKey),
)

export function banStatus(c: Card): BanStatus {
  const disp = normKey(displayCardName(c))
  const nameOnly = normKey(c.name)
  if (STANDARD_BANNED.has(disp) || STANDARD_BANNED.has(nameOnly)) return 'banned'
  if (BANNED_2V2.has(disp) || BANNED_2V2.has(nameOnly)) return 'banned2v2'
  return null
}
