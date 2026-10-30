// Turns RiftLite's community matrix page (riftlite.com/community/matrix) into public/matchups.json.
// The page is a Next.js server render: its data sits in `self.__next_f.push([1,"..."])` chunks that
// join into a React Server Components stream ("id:json" lines). One line carries
//   matrix:  { rows, cells: [{ myLegend, oppLegend, wins, losses, draws, ... }] }  pooled both directions
//   matches: [{ result, myChampion, oppChampion, superseded, mergedIntoMatchId, deckSnapshot }]
// where deckSnapshot (when the player linked a deck) lists the uploader's own cards.

/** The RSC stream behind a Next.js page. */
export function nextPayload(html) {
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g
  let out = ''
  for (const m of html.matchAll(re)) out += JSON.parse(`"${m[1]}"`)
  return out
}

/** First object anywhere in `node` that has `key`. */
function findWithKey(node, key, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 40) return null
  if (!Array.isArray(node) && key in node) return node
  for (const v of Array.isArray(node) ? node : Object.values(node)) {
    const hit = findWithKey(v, key, depth + 1)
    if (hit) return hit
  }
  return null
}

/** `{ matrix, matches }` from the stream lines (lines that are no JSON are skipped). */
export function findMatrixData(payload) {
  let matrix = null
  let matches = null
  for (const line of payload.split('\n')) {
    const i = line.indexOf(':')
    if (i < 0 || i > 6) continue
    const body = line.slice(i + 1)
    if (!body.includes('"cells"') && !body.includes('"matches"')) continue
    let json
    try { json = JSON.parse(body) } catch { continue }
    matrix ??= findWithKey(json, 'matrix')?.matrix ?? null
    matches ??= findWithKey(json, 'matches')?.matches ?? null
  }
  return { matrix, matches }
}

/** Cards that count for "this card was in the deck": champion + main deck (no sideboard, runes, battlefields). */
function deckCardNames(snap) {
  const names = new Set()
  for (const sec of [snap.champion, snap.mainDeck]) {
    for (const e of sec || []) {
      const n = String(e?.name || '').trim()
      if (n && (e.qty ?? 1) > 0) names.add(n)
    }
  }
  return names
}

/** Cards seen in fewer decks than this against a Legend are left out of the file. */
export const MIN_CARD_GAMES = 2

/**
 * Builds the matchups file body.
 *   legends: { [legend]: [wins, losses] } over all non-mirror cells
 *   matrix:  { [legend]: { [opp]: [wins, losses, draws] } } as RiftLite pools them
 *   vs:      { [opp]: { n: [games, wins], cards: { [card]: [games, wins] } } }  decks of any Legend facing opp
 *   pair:    { [legend]: { [opp]: { n, cards } } }  the same, only decks of that Legend
 * Only decisive matches (Win / Loss) with a deck count for cards; superseded or merged ones are skipped.
 */
export function buildMatchups(matrix, matches) {
  const legends = {}
  const table = {}
  for (const c of matrix?.cells || []) {
    const a = String(c.myLegend || '')
    const b = String(c.oppLegend || '')
    if (!a || !b) continue
    const w = c.wins | 0
    const l = c.losses | 0
    const d = c.draws | 0
    if (w + l + d === 0) continue
    ;(table[a] ??= {})[b] = [w, l, d]
    if (a !== b) {
      const t = (legends[a] ??= [0, 0])
      t[0] += w
      t[1] += l
    }
  }

  const vs = {}
  const pair = {}
  let decks = 0
  const bump = (bucket, names, won) => {
    bucket.n[0]++
    if (won) bucket.n[1]++
    for (const n of names) {
      const e = (bucket.cards[n] ??= [0, 0])
      e[0]++
      if (won) e[1]++
    }
  }
  for (const m of matches || []) {
    if (!m || m.superseded || m.mergedIntoMatchId) continue
    if (m.result !== 'Win' && m.result !== 'Loss') continue
    const snap = m.deckSnapshot
    const me = String(m.myChampion || '')
    const opp = String(m.oppChampion || '')
    if (!snap || !me || !opp || me === opp) continue
    if (snap.legend && snap.legend !== me) continue
    const names = deckCardNames(snap)
    if (!names.size) continue
    decks++
    const won = m.result === 'Win'
    bump((vs[opp] ??= { n: [0, 0], cards: {} }), names, won)
    bump(((pair[me] ??= {})[opp] ??= { n: [0, 0], cards: {} }), names, won)
  }
  const prune = (bucket) => {
    for (const [n, e] of Object.entries(bucket.cards)) if (e[0] < MIN_CARD_GAMES) delete bucket.cards[n]
  }
  for (const b of Object.values(vs)) prune(b)
  for (const byOpp of Object.values(pair)) for (const b of Object.values(byOpp)) prune(b)

  return {
    matches: matrix?.matrixReadyMatchCount ?? (matches || []).length,
    decks,
    legends,
    matrix: table,
    vs,
    pair,
  }
}
