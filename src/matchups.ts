/** public/matchups.json: Legend matchups and counter cards from RiftLite's community match data,
 *  baked daily by scripts/bake_matchups.mjs (workflow "Bake matchups"). Loaded live from main like the
 *  prices, so new numbers reach every app without a release; the bundled copy covers offline. */

import { loadLiveJson } from './liveJson.ts'

/** [games, wins] */
export type Rec = [number, number]
export type Bucket = { n: Rec; cards: Record<string, Rec> }
export type MatchupsFile = {
  updatedAt: string
  source: string
  matches: number
  decks: number
  /** [wins, losses] over every non-mirror match */
  legends: Record<string, [number, number]>
  /** legend → opponent → [wins, losses, draws] */
  matrix: Record<string, Record<string, [number, number, number]>>
  /** opponent → decks of any Legend that faced it */
  vs: Record<string, Bucket>
  /** legend → opponent → decks of that Legend that faced it */
  pair: Record<string, Record<string, Bucket>>
  /** legend → every deck of that Legend */
  by: Record<string, Bucket>
}

function isMatchupsFile(x: unknown): x is MatchupsFile {
  const f = x as MatchupsFile
  return !!f && ['legends', 'matrix', 'vs', 'pair', 'by'].every((k) => !!f[k as keyof MatchupsFile] && typeof f[k as keyof MatchupsFile] === 'object')
}

let cached: Promise<MatchupsFile | null> | null = null

/** Live copy from main (once per app start), the bundled file when offline. */
export function loadMatchups(): Promise<MatchupsFile | null> {
  cached ??= loadLiveJson('matchups.json', isMatchupsFile)
  cached.then((f) => { if (!f) cached = null })
  return cached
}

/** RiftLite names a Legend by its champion ("Rengar"); champions with several Legends by the full name
 *  ("Master Yi, Wuju Bladesman"). `full` is the catalogue's "name, subtitle". */
export function legendKey(file: MatchupsFile, name: string, full: string): string | null {
  if (file.legends[full] || file.matrix[full]) return full
  if (file.legends[name] || file.matrix[name]) return name
  return null
}

export type MatchupRow = { opp: string; wins: number; losses: number; draws: number; games: number; wr: number | null }

/** Every opponent the Legend has games against, best win rate first (ties: more games first). */
export function matchupRows(file: MatchupsFile, legend: string): MatchupRow[] {
  const rows: MatchupRow[] = []
  for (const [opp, [wins, losses, draws]] of Object.entries(file.matrix[legend] || {})) {
    if (opp === legend) continue
    const decisive = wins + losses
    rows.push({ opp, wins, losses, draws, games: decisive + draws, wr: decisive ? wins / decisive : null })
  }
  return rows.sort((a, b) => (b.wr ?? -1) - (a.wr ?? -1) || b.games - a.games || a.opp.localeCompare(b.opp))
}

/** Overall [wins, losses] and win rate of a Legend. */
export function legendRecord(file: MatchupsFile, legend: string) {
  const [wins, losses] = file.legends[legend] || [0, 0]
  return { wins, losses, wr: wins + losses ? wins / (wins + losses) : null }
}

/** Games a card needs against a Legend before it is ranked. */
export const MIN_COUNTER_GAMES = 3
/** Weight of the baseline in the smoothed win rate: a card needs real games to move away from it. */
export const COUNTER_PRIOR = 8

export type CounterCard = {
  name: string
  games: number
  wins: number
  /** win rate of decks running the card against this opponent */
  wr: number
  /** smoothed win rate minus the baseline of all decks against this opponent; ranks the list */
  lift: number
  /** the same card in decks of the player's own Legend, when there are any */
  own?: Rec
  /** share of all decks of the player's Legend that run the card */
  inLegend?: number
}

/**
 * Cards that win more against `opp` than the average deck does, over decks of every Legend
 * (one Legend alone has too few games). `allowed` keeps only cards the player's deck can run.
 */
export function counterCards(
  file: MatchupsFile,
  legend: string | null,
  opp: string,
  allowed: (name: string) => boolean,
  limit = 12,
): { base: Rec; cards: CounterCard[] } {
  const bucket = file.vs[opp]
  if (!bucket || !bucket.n[0]) return { base: [0, 0], cards: [] }
  const base = bucket.n[1] / bucket.n[0]
  const own = legend ? file.pair[legend]?.[opp]?.cards : undefined
  const mine = legend ? file.by?.[legend] : undefined
  const out: CounterCard[] = []
  for (const [name, [games, wins]] of Object.entries(bucket.cards)) {
    if (games < MIN_COUNTER_GAMES || !allowed(name)) continue
    const smooth = (wins + COUNTER_PRIOR * base) / (games + COUNTER_PRIOR)
    const lift = smooth - base
    if (lift <= 0) continue
    const inLegend = mine?.n[0] ? (mine.cards[name]?.[0] ?? 0) / mine.n[0] : undefined
    out.push({ name, games, wins, wr: wins / games, lift, own: own?.[name], inLegend })
  }
  out.sort((a, b) => b.lift - a.lift || b.games - a.games || a.name.localeCompare(b.name))
  return { base: bucket.n, cards: out.slice(0, limit) }
}

export type PlayedCard = { name: string; decks: number; share: number }

/** What decks of `legend` usually run: cards by the share of its uploaded decks. */
export function typicalCards(file: MatchupsFile, legend: string, limit = 12): { decks: number; cards: PlayedCard[] } {
  const b = file.by?.[legend]
  if (!b || !b.n[0]) return { decks: 0, cards: [] }
  const cards = Object.entries(b.cards).map(([name, [n]]) => ({ name, decks: n, share: n / b.n[0] }))
  cards.sort((a, b) => b.decks - a.decks || a.name.localeCompare(b.name))
  return { decks: b.n[0], cards: cards.slice(0, limit) }
}

/** How a card can catch you out: face down for 0 later, any time (also in your turn), or their turn and showdowns. */
export type TrickKind = 'hidden' | 'reaction' | 'action'

/** Keywords at line start only, so a card that merely mentions [Reaction] in its prose is no trick. */
export function trickKind(text: string): TrickKind | null {
  if (/(^|\n)\[Hidden\]/.test(text)) return 'hidden'
  if (/(^|\n)\[(Reaction|Quick-Draw|Ambush)\]/.test(text)) return 'reaction'
  if (/(^|\n)\[Action\]/.test(text)) return 'action'
  return null
}

export type Trick = PlayedCard & { kind: TrickKind }

/** Tricks most decks of `legend` run (at least `minShare` of its uploaded lists), most common first. */
export function typicalTricks(file: MatchupsFile, legend: string, textOf: (name: string) => string, minShare = 0.25, limit = 8): Trick[] {
  const out: Trick[] = []
  for (const p of typicalCards(file, legend, Infinity).cards) {
    if (p.share < minShare) break
    const kind = trickKind(textOf(p.name))
    if (kind) out.push({ ...p, kind })
  }
  return out.slice(0, limit)
}

/** A card has to lead or trail the average by this much before the deck check names it. */
export const DECK_NOTE_LIFT = 0.05

export type DeckCardStat = { name: string; side: boolean; games: number; wins: number; wr: number; lift: number }

/**
 * The open deck's cards against `opp` (decks of every Legend, smoothed like counterCards):
 * `better` / `worse` lead or trail the average by DECK_NOTE_LIFT, `unknown` counts cards without enough games.
 * `side` marks cards that are only in the sideboard, so a better one is a candidate to bring in.
 */
export function deckInMatchup(file: MatchupsFile, opp: string, lines: { name: string; side: boolean }[]) {
  const bucket = file.vs[opp]
  const better: DeckCardStat[] = []
  const worse: DeckCardStat[] = []
  let unknown = 0
  if (!bucket || !bucket.n[0]) return { better, worse, unknown: lines.length }
  const base = bucket.n[1] / bucket.n[0]
  for (const { name, side } of lines) {
    const [games, wins] = bucket.cards[name] || [0, 0]
    if (games < MIN_COUNTER_GAMES) { unknown++; continue }
    const lift = (wins + COUNTER_PRIOR * base) / (games + COUNTER_PRIOR) - base
    const row = { name, side, games, wins, wr: wins / games, lift }
    if (lift >= DECK_NOTE_LIFT) better.push(row)
    else if (lift <= -DECK_NOTE_LIFT) worse.push(row)
  }
  better.sort((a, b) => b.lift - a.lift || a.name.localeCompare(b.name))
  worse.sort((a, b) => a.lift - b.lift || a.name.localeCompare(b.name))
  return { better, worse, unknown }
}
