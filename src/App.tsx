import { useEffect, useMemo, useState } from 'react'
import type { Card, Catalog, Deck } from './types'
import { loadCollection, loadDecks, saveCollection, saveDecks, type Collection } from './storage'
import { parseBulkTokens, resolveToken } from './parseBulk'

type Tab = 'collection' | 'catalog' | 'bulk' | 'decks'

function uid() {
  return crypto.randomUUID()
}

function ownedQty(o?: { qty: number; foil: number }) {
  return (o?.qty || 0) + (o?.foil || 0)
}

export default function App() {
  const [tab, setTab] = useState<Tab>('collection')
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [collection, setCollection] = useState<Collection>({})
  const [decks, setDecks] = useState<Deck[]>([])
  const [q, setQ] = useState('')
  const [setFilter, setSetFilter] = useState('')
  const [ownedOnly, setOwnedOnly] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkFoil, setBulkFoil] = useState(false)
  const [bulkReport, setBulkReport] = useState<string | null>(null)
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null)
  const [deckOwnedOnly, setDeckOwnedOnly] = useState(true)
  const [appVersion, setAppVersion] = useState('')
  const [updateInfo, setUpdateInfo] = useState<{ status: string; version?: string; message?: string } | null>(null)

  useEffect(() => {
    window.riftbound?.getVersion().then(setAppVersion).catch(() => {})
    const off = window.riftbound?.onUpdater((p) => setUpdateInfo(p))
    return () => { off?.() }
  }, [])

  useEffect(() => {
    setCollection(loadCollection())
    const d = loadDecks()
    setDecks(d)
    if (d[0]) setActiveDeckId(d[0].id)
    fetch('/cards.json')
      .then((r) => {
        if (!r.ok) throw new Error('cards.json fehlt')
        return r.json()
      })
      .then((data: Catalog) => setCatalog(data))
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => saveCollection(collection), [collection])
  useEffect(() => saveDecks(decks), [decks])

  const cards = catalog?.cards || []
  const sets = catalog?.sets || {}

  const byId = useMemo(() => {
    const m = new Map<string, Card>()
    for (const c of cards) m.set(c.id, c)
    return m
  }, [cards])

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    return cards.filter((c) => {
      if (setFilter && c.set !== setFilter) return false
      if (ownedOnly && ownedQty(collection[c.id]) <= 0) return false
      if (!query) return true
      return (
        c.name.toLowerCase().includes(query) ||
        c.code.toLowerCase().includes(query) ||
        c.id.toLowerCase().includes(query) ||
        c.domains.some((d) => d.toLowerCase().includes(query)) ||
        c.types.some((t) => t.toLowerCase().includes(query)) ||
        (c.rarity || '').toLowerCase().includes(query)
      )
    })
  }, [cards, q, setFilter, ownedOnly, collection])

  const ownedCards = useMemo(
    () => cards.filter((c) => ownedQty(collection[c.id]) > 0),
    [cards, collection],
  )

  const totals = useMemo(() => {
    let copies = 0
    let unique = 0
    for (const id of Object.keys(collection)) {
      const n = ownedQty(collection[id])
      if (n > 0) {
        unique += 1
        copies += n
      }
    }
    return { unique, copies, catalog: cards.length }
  }, [collection, cards.length])

  function bump(id: string, field: 'qty' | 'foil', delta: number) {
    setCollection((prev) => {
      const cur = prev[id] || { qty: 0, foil: 0 }
      const next = { ...cur, [field]: Math.max(0, (cur[field] || 0) + delta) }
      const copy = { ...prev }
      if (next.qty === 0 && next.foil === 0) delete copy[id]
      else copy[id] = next
      return copy
    })
  }

  function applyBulk(mode: 'add' | 'set' | 'remove') {
    const tokens = parseBulkTokens(bulkText)
    let ok = 0
    let miss = 0
    const missing: string[] = []
    setCollection((prev) => {
      const next = { ...prev }
      for (const token of tokens) {
        const card = resolveToken(token, cards)
        if (!card) {
          miss += 1
          missing.push(token)
          continue
        }
        ok += 1
        const cur = next[card.id] || { qty: 0, foil: 0 }
        const field = bulkFoil ? 'foil' : 'qty'
        if (mode === 'remove') {
          const v = { ...cur, [field]: Math.max(0, cur[field] - 1) }
          if (v.qty === 0 && v.foil === 0) delete next[card.id]
          else next[card.id] = v
        } else if (mode === 'set') {
          next[card.id] = bulkFoil ? { qty: cur.qty, foil: 1 } : { qty: 1, foil: cur.foil }
        } else {
          next[card.id] = { ...cur, [field]: cur[field] + 1 }
        }
      }
      return next
    })
    setBulkReport(
      `${ok} erkannt` +
        (miss ? `, ${miss} nicht gefunden: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? '…' : ''}` : ''),
    )
  }

  function exportCsv() {
    const lines = ['id,code,name,set,qty,foil']
    for (const [id, o] of Object.entries(collection)) {
      const c = byId.get(id)
      if (!c || ownedQty(o) <= 0) continue
      lines.push([id, c.code, JSON.stringify(c.name), c.set, o.qty, o.foil].join(','))
    }
    download('riftbound-collection.csv', lines.join('\n'))
  }

  function importCsv(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result || '')
      const lines = text.split(/\r?\n/).filter(Boolean)
      const start = lines[0]?.toLowerCase().includes('id') ? 1 : 0
      setCollection((prev) => {
        const next = { ...prev }
        for (let i = start; i < lines.length; i++) {
          const cols = splitCsv(lines[i])
          if (cols.length < 5) continue
          const [id, , , , qty, foil] = cols
          const card = byId.get(id) || resolveToken(cols[1] || id, cards)
          if (!card) continue
          next[card.id] = {
            qty: Math.max(0, Number(qty) || 0),
            foil: Math.max(0, Number(foil) || 0),
          }
        }
        return next
      })
      setBulkReport(`CSV importiert (${file.name})`)
      setTab('collection')
    }
    reader.readAsText(file)
  }

  function download(name: string, content: string) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  function newDeck() {
    const d: Deck = { id: uid(), name: `Deck ${decks.length + 1}`, cards: [], updatedAt: new Date().toISOString() }
    setDecks((prev) => [d, ...prev])
    setActiveDeckId(d.id)
  }

  const activeDeck = decks.find((d) => d.id === activeDeckId) || null

  function updateDeck(mut: (d: Deck) => Deck) {
    if (!activeDeckId) return
    setDecks((prev) => prev.map((d) => (d.id === activeDeckId ? { ...mut(d), updatedAt: new Date().toISOString() } : d)))
  }

  function addToDeck(cardId: string) {
    updateDeck((d) => {
      const existing = d.cards.find((x) => x.id === cardId)
      if (existing) {
        return { ...d, cards: d.cards.map((x) => (x.id === cardId ? { ...x, qty: x.qty + 1 } : x)) }
      }
      return { ...d, cards: [...d.cards, { id: cardId, qty: 1 }] }
    })
  }

  function deckCount(d: Deck) {
    return d.cards.reduce((s, c) => s + c.qty, 0)
  }

  if (error) return <div className="main err">Fehler: {error}</div>
  if (!catalog) return <div className="main">Lade Riftbound-Katalog…</div>

  return (
    <div className="app">
      <header className="top">
        <div className="brand">Riftbound <span>Tracker</span>{appVersion ? <span className="pill" style={{ marginLeft: 8 }}>v{appVersion}</span> : null}</div>
        <nav className="tabs">
          {([
            ['collection', 'Sammlung'],
            ['catalog', 'Katalog'],
            ['bulk', 'Bulk'],
            ['decks', 'Decks'],
          ] as const).map(([id, label]) => (
            <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="stats">
          {totals.unique} Unique · {totals.copies} Kopien · {totals.catalog} im Katalog
        </div>
      </header>

      <main className="main">
        {updateInfo?.status === 'downloaded' && (
        <div className="panel" style={{ marginBottom: 12, textAlign: 'left' }}>
          <strong className="ok">Update {updateInfo.version} ready.</strong>{' '}
          <button className="btn small primary" onClick={() => window.riftbound?.installUpdate()}>Restart & install</button>
        </div>
      )}
      {updateInfo?.status === 'available' && (
        <div className="help" style={{ marginBottom: 10 }}>Downloading update {updateInfo.version}…</div>
      )}

        {(tab === 'collection' || tab === 'catalog') && (
          <>
            <div className="toolbar">
              <input
                className="search grow"
                placeholder="Suche Name, Code, Domain…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <select className="select" style={{ maxWidth: 180 }} value={setFilter} onChange={(e) => setSetFilter(e.target.value)}>
                <option value="">Alle Sets</option>
                {Object.entries(sets).map(([id, name]) => (
                  <option key={id} value={id}>{id} — {name}</option>
                ))}
              </select>
              {tab === 'catalog' && (
                <label className="pill">
                  <input type="checkbox" checked={ownedOnly} onChange={(e) => setOwnedOnly(e.target.checked)} /> nur Owned
                </label>
              )}
              <button className="btn" onClick={exportCsv}>CSV Export</button>
              <label className="btn">
                CSV Import
                <input
                  type="file"
                  accept=".csv,text/csv"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) importCsv(f)
                    e.target.value = ''
                  }}
                />
              </label>
            </div>

            {tab === 'collection' && ownedCards.length === 0 && (
              <div className="empty">Noch keine Karten. Geh zu Bulk oder Katalog und füge welche hinzu.</div>
            )}

            <div className="grid">
              {(tab === 'collection' ? ownedCards.filter((c) => {
                const query = q.trim().toLowerCase()
                if (setFilter && c.set !== setFilter) return false
                if (!query) return true
                return c.name.toLowerCase().includes(query) || c.code.toLowerCase().includes(query)
              }) : filtered).map((c) => {
                const o = collection[c.id] || { qty: 0, foil: 0 }
                return (
                  <article key={c.id} className={`card ${ownedQty(o) ? 'owned' : ''}`}>
                    <div className="art" style={{ backgroundImage: c.image ? `url(${c.image})` : undefined }}>
                      {ownedQty(o) > 0 && <div className="badge">×{ownedQty(o)}</div>}
                    </div>
                    <div className="meta">
                      <div className="name">{c.name}</div>
                      <div className="sub">{c.code} · {c.set} · {(c.domains || []).join('/') || '—'}</div>
                      <div className="row">
                        <div className="qty" title="Normal">
                          <button onClick={() => bump(c.id, 'qty', -1)}>-</button>
                          <b>{o.qty}</b>
                          <button onClick={() => bump(c.id, 'qty', 1)}>+</button>
                        </div>
                        <div className="qty" title="Foil">
                          <button onClick={() => bump(c.id, 'foil', -1)}>-</button>
                          <b className="ok">{o.foil}✦</b>
                          <button onClick={() => bump(c.id, 'foil', 1)}>+</button>
                        </div>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          </>
        )}

        {tab === 'bulk' && (
          <div className="split">
            <section className="panel">
              <h2>Bulk hinzufügen</h2>
              <p className="help">
                Codes reinpasten — Leerzeichen, Komma oder Zeilen. Beispiele: <code>OGN-056/298</code>, <code>OGN-56</code>, <code>UNL 131</code>, Alt-Art <code>OGN-066a</code>.
                Für ADF/Phone-Scanner: Bilder separat scannen, Codes hier einfügen (Bilderkennung kommt später).
              </p>
              <textarea
                className="field"
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={'OGN-001/298\nOGN-056/298\nSFD-12\nUNL 131'}
              />
              <div className="toolbar" style={{ marginTop: 10 }}>
                <label className="pill">
                  <input type="checkbox" checked={bulkFoil} onChange={(e) => setBulkFoil(e.target.checked)} /> als Foil
                </label>
                <button className="btn primary" onClick={() => applyBulk('add')}>+1 je Token</button>
                <button className="btn" onClick={() => applyBulk('set')}>Setze auf 1</button>
                <button className="btn danger" onClick={() => applyBulk('remove')}>-1 je Token</button>
              </div>
              {bulkReport && <p className="help">{bulkReport}</p>}
            </section>
            <section className="panel">
              <h2>Schnell</h2>
              <p className="help">Sammlung liegt lokal im Browser (localStorage). CSV Export als Backup nutzen.</p>
              <div className="list">
                <div className="list-item"><span>Unique</span><b>{totals.unique}</b></div>
                <div className="list-item"><span>Kopien</span><b>{totals.copies}</b></div>
                <div className="list-item"><span>Katalog</span><b>{totals.catalog}</b></div>
              </div>
            </section>
          </div>
        )}

        {tab === 'decks' && (
          <div className="split">
            <section className="panel">
              <div className="toolbar">
                <h2 style={{ margin: 0, flex: 1 }}>Decks</h2>
                <button className="btn primary" onClick={newDeck}>Neues Deck</button>
              </div>
              <div className="list">
                {decks.length === 0 && <div className="empty">Noch kein Deck.</div>}
                {decks.map((d) => (
                  <button
                    key={d.id}
                    className="list-item"
                    style={{ textAlign: 'left', width: '100%' }}
                    onClick={() => setActiveDeckId(d.id)}
                  >
                    <div>
                      <div className="name">{d.name}</div>
                      <div className="sub">{deckCount(d)} Karten</div>
                    </div>
                    {d.id === activeDeckId && <span className="pill ok">aktiv</span>}
                  </button>
                ))}
              </div>

              {activeDeck && (
                <>
                  <div className="toolbar" style={{ marginTop: 14 }}>
                    <input
                      className="field grow"
                      value={activeDeck.name}
                      onChange={(e) => updateDeck((d) => ({ ...d, name: e.target.value }))}
                    />
                    <button
                      className="btn danger"
                      onClick={() => {
                        setDecks((prev) => prev.filter((d) => d.id !== activeDeck.id))
                        setActiveDeckId(null)
                      }}
                    >
                      Löschen
                    </button>
                  </div>
                  <div className="list">
                    {activeDeck.cards.length === 0 && <div className="empty">Karten aus der Liste rechts hinzufügen.</div>}
                    {activeDeck.cards.map((dc) => {
                      const c = byId.get(dc.id)
                      if (!c) return null
                      const have = ownedQty(collection[c.id])
                      return (
                        <div key={dc.id} className="list-item">
                          <div>
                            <div className="name">{c.name}</div>
                            <div className="sub">{c.code} · besitzt {have}</div>
                          </div>
                          <div className="qty">
                            <button onClick={() => updateDeck((d) => ({
                              ...d,
                              cards: d.cards
                                .map((x) => (x.id === dc.id ? { ...x, qty: x.qty - 1 } : x))
                                .filter((x) => x.qty > 0),
                            }))}>-</button>
                            <b>{dc.qty}</b>
                            <button onClick={() => addToDeck(dc.id)}>+</button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </section>

            <section className="panel">
              <h2>Karten ins Deck</h2>
              <div className="toolbar">
                <input className="search grow" placeholder="Suche…" value={q} onChange={(e) => setQ(e.target.value)} />
                <label className="pill">
                  <input type="checkbox" checked={deckOwnedOnly} onChange={(e) => setDeckOwnedOnly(e.target.checked)} /> nur Owned
                </label>
              </div>
              <div className="list" style={{ maxHeight: '70vh', overflow: 'auto' }}>
                {cards
                  .filter((c) => {
                    if (deckOwnedOnly && ownedQty(collection[c.id]) <= 0) return false
                    const query = q.trim().toLowerCase()
                    if (!query) return deckOwnedOnly ? true : false
                    return (
                      c.name.toLowerCase().includes(query) ||
                      c.code.toLowerCase().includes(query)
                    )
                  })
                  .slice(0, 80)
                  .map((c) => (
                    <div key={c.id} className="list-item">
                      <div>
                        <div className="name">{c.name}</div>
                        <div className="sub">{c.code} · ×{ownedQty(collection[c.id])}</div>
                      </div>
                      <button className="btn small primary" disabled={!activeDeck} onClick={() => addToDeck(c.id)}>
                        Add
                      </button>
                    </div>
                  ))}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}

function splitCsv(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; continue }
      inQ = !inQ
      continue
    }
    if (ch === ',' && !inQ) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  out.push(cur)
  return out
}
