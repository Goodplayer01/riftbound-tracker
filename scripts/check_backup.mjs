import { backupGroup, isBackupKey, isEmptyBackup, makeBackup, parseBackup, restoreBackup, summarizeBackup } from '../src/backup.ts'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

/** localStorage stand-in. */
function store(init) {
  const m = new Map(Object.entries(init))
  return {
    get length() { return m.size },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    map: m,
  }
}

const user = {
  'rb.collection.v1': JSON.stringify({ a: { qty: 2, foil: 1 }, b: { qty: 0, foil: 0 }, rune: { qty: 12, foil: 0 } }),
  'rb.copies.v1': JSON.stringify({ a: [{ n: 1, lang: 'de', buy: 1.5 }] }),
  'rb.decks.v1': JSON.stringify([{ id: 'd1', cards: [] }, { id: 'd2', cards: [] }]),
  'rb.wishlist.v1': JSON.stringify({ c: { qty: 1, foil: 0 } }),
  'rb.sales.v1': JSON.stringify({ a: 1 }),
  'rb.borrowed.v1': JSON.stringify([{ id: 'g', name: 'Tim', cards: {} }]),
  'rb.storeHome.v1': 'Köln',
  'riftbound-lang': 'de',
  'riftbound-hide-nexus-night': '1',
  // Never in a backup: caches, the personal token, the app's own snapshots.
  'rb.prices.remote.v1': '{"big":1}',
  'rb.cardtrader.token.v1': 'secret',
  'rb.cardtrader.blueprints.v1': '{}',
  'rb.backup.v1': '{}',
  'rb.backup.csvReplace.v1': '{}',
  'other-app': 'x',
}

// Export: every user key, nothing else.
const b = makeBackup(store(user), '0.9.35', new Date('2026-10-25T20:00:00Z'))
for (const k of ['rb.collection.v1', 'rb.copies.v1', 'rb.decks.v1', 'rb.sales.v1', 'rb.borrowed.v1', 'rb.wishlist.v1', 'rb.storeHome.v1', 'riftbound-lang']) {
  assert(b.data[k] === user[k], `${k} is in the backup unchanged`)
}
for (const k of ['rb.prices.remote.v1', 'rb.cardtrader.token.v1', 'rb.cardtrader.blueprints.v1', 'rb.backup.v1', 'rb.backup.csvReplace.v1', 'other-app']) {
  assert(!(k in b.data), `${k} stays out`)
}
assert(isBackupKey('rb.someFutureKey.v1'), 'new rb.* keys are included automatically')

// Round trip through the file text.
const text = JSON.stringify(b)
const parsed = parseBackup(text)
assert(typeof parsed === 'object' && parsed.version === '0.9.35', 'own file parses')
const s = summarizeBackup(parsed, (id) => id === 'rune')
assert(s.cards === 1 && s.copies === 3 && s.decks === 2 && s.wish === 1 && s.sales === 1 && s.borrowed === 1, 'summary counts, untracked cards left out')

// A fresh install (only the language set) is empty, so no automatic backup pushes the real one down.
assert(isEmptyBackup(makeBackup(store({ 'riftbound-lang': 'de', 'rb.collection.v1': '{}' }), '1')), 'fresh install is empty')
assert(!isEmptyBackup(parsed), 'real data is not empty')

// Bad files change nothing.
assert(parseBackup('not json') === 'invalid', 'not json')
assert(parseBackup('{"cards":[]}') === 'invalid', 'foreign json')
assert(parseBackup(JSON.stringify({ ...b, format: 99 })) === 'newer', 'newer format')
assert(parseBackup(JSON.stringify({ ...b, data: {} })) === 'invalid', 'empty data')
assert(parseBackup(JSON.stringify({ ...b, data: { 'evil.key': '1' } })) === 'invalid', 'foreign key')
assert(parseBackup(JSON.stringify({ ...b, data: { 'rb.decks.v1': '[broken' } })) === 'invalid', 'broken value')
assert(parseBackup(JSON.stringify({ ...b, data: { 'rb.decks.v1': 5 } })) === 'invalid', 'non string value')

// Restore replaces everything: keys missing in the file go, caches and the token stay.
const target = store({
  'rb.collection.v1': '{"z":{"qty":9,"foil":0}}',
  'rb.dopamin.v1': '{"OGN":{"packs":3}}',
  'rb.cardtrader.token.v1': 'mine',
  'rb.prices.remote.v1': '{}',
})
restoreBackup(target, parsed)
assert(target.getItem('rb.collection.v1') === user['rb.collection.v1'], 'collection replaced')
assert(target.getItem('rb.decks.v1') === user['rb.decks.v1'], 'decks restored')
assert(target.getItem('rb.dopamin.v1') === null, 'keys not in the file are removed')
assert(target.getItem('rb.cardtrader.token.v1') === 'mine' && target.getItem('rb.prices.remote.v1') === '{}', 'token and caches untouched')

// Restoring only some parts: same collection, own wishlist (and price alerts) and own decks stay.
const mine = store({
  'rb.collection.v1': '{"z":{"qty":9,"foil":0}}',
  'rb.copies.v1': '{"z":[]}',
  'rb.wishlist.v1': '{"mine":{"qty":1,"foil":0}}',
  'rb.wishTargets.v1': '{"mine":5}',
  'rb.decks.v1': '[{"id":"my"}]',
  'rb.dopamin.v1': '{"OGN":{"packs":3}}',
})
restoreBackup(mine, parsed, new Set(['collection']))
assert(mine.getItem('rb.collection.v1') === user['rb.collection.v1'] && mine.getItem('rb.copies.v1') === user['rb.copies.v1'], 'collection and its copy details replaced')
assert(mine.getItem('rb.wishlist.v1') === '{"mine":{"qty":1,"foil":0}}' && mine.getItem('rb.wishTargets.v1') === '{"mine":5}', 'wishlist and alerts kept')
assert(mine.getItem('rb.decks.v1') === '[{"id":"my"}]' && mine.getItem('rb.dopamin.v1') === '{"OGN":{"packs":3}}', 'other parts kept')
restoreBackup(mine, parsed, new Set(['other']))
assert(mine.getItem('rb.dopamin.v1') === null && mine.getItem('rb.storeHome.v1') === 'Köln', 'other: settings from the file, keys missing there removed')
assert(mine.getItem('rb.decks.v1') === '[{"id":"my"}]', 'decks still kept')
assert(backupGroup('rb.wishAlertsSeen.v1') === 'wish' && backupGroup('rb.someFutureKey.v1') === 'other', 'groups')

console.log('check_backup ok')
