import { useEffect, useMemo, useState } from 'react'
import type { Card, Catalog, Deck, PriceBook, PriceEntry } from './types'
import { loadCollection, loadDecks, saveCollection, saveDecks, type Collection } from './storage'
import { parseBulkTokens, resolveToken } from './parseBulk'

type Tab = 'collection' | 'catalog' | 'bulk' | 'decks'

function uid() {
  return crypto.randomUUID()
}

function ownedQty(o?: { qty: number; foil: number }) {
  return (o?.qty || 0) + (o?.foil || 0)
}

function fmtEur(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return null
  return n.toFixed(2)
}

function priceLabel(p?: PriceEntry) {
  if (!p) return null
  const low = fmtEur(p.low)
  const high = fmtEur(p.high ?? null)
  const avg30 = fmtEur(p.avg30 ?? null)
  const foil = fmtEur(p.foilLow) || fmtEur(p.foilTrend)
  return { low, high, avg30, foil, cmId: p.cmId || null }
}

function cmUrl(cmId?: string | null) {
  if (!cmId) return null
  return `https://www.cardmarket.com/de/Riftbound/Products/Singles?idProduct=${cmId}`
}

const RARITY_ORDER = ['Common', 'Uncommon', 'Rare', 'Epic', 'Showcase'] as const

function openCm(cmId?: string | null) {
  const url = cmUrl(cmId)
  if (!url) return
  if (window.riftbound?.openExternal) {
    void window.riftbound.openExternal(url)
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
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
  const [typeFilter, setTypeFilter] = useState('')
  const [signedOnly, setSignedOnly] = useState(false)
  const [overOnly, setOverOnly] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkFoil, setBulkFoil] = useState(false)
  const [bulkReport, setBulkReport] = useState<string | null>(null)
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null)
  const [deckOwnedOnly, setDeckOwnedOnly] = useState(true)
  const [appVersion, setAppVersion] = useState('')
  const [updateInfo, setUpdateInfo] = useState<{ status: string; version?: string; message?: string } | null>(null)
  const [isMaximized, setIsMaximized] = useState(false)
  const [priceBook, setPriceBook] = useState<PriceBook | null>(null)
  // null = binder dashboard; 'owned' = all owned; set code = that set binder
  const [binderView, setBinderView] = useState<string | null>(null)
  const [binderOwnedOnly, setBinderOwnedOnly] = useState(false)
  const [binderMissing, setBinderMissing] = useState(false)

  useEffect(() => {
    window.riftbound?.getVersion().then(setAppVersion).catch(() => {})
    window.riftbound?.windowIsMaximized?.().then(setIsMaximized).catch(() => {})
    const off = window.riftbound?.onUpdater((p) => setUpdateInfo(p))
    return () => { off?.() }
  }, [])

  async function checkUpdates() {
    setUpdateInfo({ status: 'checking' })
    try {
      await window.riftbound?.checkForUpdates?.()
    } catch (e) {
      setUpdateInfo({ status: 'error', message: String(e) })
    }
  }

  async function toggleMaximize() {
    try {
      const next = await window.riftbound?.windowMaximize?.()
      if (typeof next === 'boolean') setIsMaximized(next)
    } catch {}
  }

  function updateLabel() {
    const s = updateInfo?.status
    if (s === 'checking') return 'Suche Updates...'
    if (s === 'available') return `Update ${updateInfo?.version || ''}...`
    if (s === 'downloaded') return `Update bereit ${updateInfo?.version || ''}`.trim()
    if (s === 'not-available') return 'Aktuell'
    if (s === 'error') return 'Update-Fehler'
    return appVersion ? `v${appVersion}` : 'v?'
  }

  function updateTitle() {
    const s = updateInfo?.status
    if (s === 'checking') return 'Suche nach Updates...'
    if (s === 'available') return `Update ${updateInfo?.version} verfügbar`
    if (s === 'downloaded') return `Update ${updateInfo?.version} bereit - Neustart`
    if (s === 'not-available') return 'Keine Updates - aktuell'
    if (s === 'error') return updateInfo?.message || 'Update-Fehler'
    return 'Nach Updates suchen'
  }

  useEffect(() => {
    setCollection(loadCollection())
    const d = loadDecks()
    setDecks(d)
    if (d[0]) setActiveDeckId(d[0].id)
    fetch(new URL('cards.json', window.location.href))
      .then((r) => {
        if (!r.ok) throw new Error('cards.json fehlt')
        return r.json()
      })
      .then((data: Catalog) => setCatalog(data))
      .catch((e: Error) => setError(e.message))
    fetch(new URL('prices.json', window.location.href))
      .then((r) => (r.ok ? r.json() : null))
      .then((data: PriceBook | null) => { if (data) setPriceBook(data) })
      .catch(() => {})
  }, [])

  useEffect(() => saveCollection(collection), [collection])
  useEffect(() => saveDecks(decks), [decks])

  const cards = catalog?.cards || []
  const sets = catalog?.sets || {}
  const allTypes = useMemo(() => {
    const s = new Set<string>()
    for (const c of cards) for (const t of c.types || []) if (t) s.add(t)
    return [...s].sort((a, b) => a.localeCompare(b))
  }, [cards])

  function displayName(c: Card) {
    return c.subtitle ? `${c.name}, ${c.subtitle}` : c.name
  }

  function matchesFilters(c: Card, query: string) {
    if (setFilter && c.set !== setFilter) return false
    if (typeFilter && !(c.types || []).includes(typeFilter)) return false
    if (signedOnly && !c.signed) return false
    if (overOnly && !c.overnumbered) return false
    if (!query) return true
    const hay = [
      c.name,
      c.subtitle || '',
      c.code,
      c.id,
      ...(c.domains || []),
      ...(c.types || []),
      c.rarity || '',
      ...(c.tags || []),
    ].join(' ').toLowerCase()
    return hay.includes(query)
  }

  const byId = useMemo(() => {
    const m = new Map<string, Card>()
    for (const c of cards) m.set(c.id, c)
    return m
  }, [cards])

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    return cards.filter((c) => {
      if (ownedOnly && ownedQty(collection[c.id]) <= 0) return false
      return matchesFilters(c, query)
    })
  }, [cards, q, setFilter, typeFilter, signedOnly, overOnly, ownedOnly, collection])

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

  const collectionValue = useMemo(() => {
    if (!priceBook) return null
    let sum = 0
    let priced = 0
    for (const [id, o] of Object.entries(collection)) {
      const p = priceBook.cards[id]
      if (!p) continue
      const qty = o?.qty || 0
      const foil = o?.foil || 0
      if (qty <= 0 && foil <= 0) continue
      let add = 0
      const unit = p.low != null ? p.low : p.trend
      const foilUnit = p.foilLow != null ? p.foilLow : p.foilTrend != null ? p.foilTrend : unit
      if (qty > 0 && unit != null) add += qty * unit
      if (foil > 0 && foilUnit != null) add += foil * foilUnit
      if (add > 0) {
        sum += add
        priced += 1
      }
    }
    return { sum, priced }
  }, [collection, priceBook])

  const setProgress = useMemo(() => {
    const order = Object.keys(sets)
    const out: { id: string; name: string; total: number; owned: number; pct: number; eur: number | null }[] = []
    for (const id of order) {
      const setCards = cards.filter((c) => c.set === id)
      let owned = 0
      let eur = 0
      let eurAny = false
      for (const c of setCards) {
        const o = collection[c.id]
        const n = ownedQty(o)
        if (n <= 0) continue
        owned += 1
        if (!priceBook) continue
        const p = priceBook.cards[c.id]
        if (!p) continue
        const qty = o?.qty || 0
        const foil = o?.foil || 0
        const unit = p.low != null ? p.low : p.trend
        const foilUnit = p.foilLow != null ? p.foilLow : p.foilTrend != null ? p.foilTrend : unit
        let add = 0
        if (qty > 0 && unit != null) add += qty * unit
        if (foil > 0 && foilUnit != null) add += foil * foilUnit
        if (add > 0) {
          eur += add
          eurAny = true
        }
      }
      const total = setCards.length
      out.push({
        id,
        name: sets[id] || id,
        total,
        owned,
        pct: total ? Math.round((owned / total) * 100) : 0,
        eur: eurAny ? eur : null,
      })
    }
    return out
  }, [cards, sets, collection, priceBook])

  const binderCards = useMemo(() => {
    if (binderView == null) return [] as Card[]
    const query = q.trim().toLowerCase()
    let list: Card[]
    if (binderView === 'owned') {
      list = cards.filter((c) => ownedQty(collection[c.id]) > 0)
    } else {
      list = cards.filter((c) => c.set === binderView)
    }
    list = list.filter((c) => {
      const n = ownedQty(collection[c.id])
      if (binderOwnedOnly && n <= 0) return false
      if (binderMissing && n > 0) return false
      if (signedOnly && !c.signed) return false
      if (overOnly && !c.overnumbered) return false
      if (!query) return true
      const hay = [
        c.name,
        c.subtitle || '',
        c.code,
        c.id,
        ...(c.domains || []),
        ...(c.types || []),
        c.rarity || '',
        ...(c.tags || []),
      ].join(' ').toLowerCase()
      return hay.includes(query)
    })
    return [...list].sort((a, b) => a.cn - b.cn || a.code.localeCompare(b.code))
  }, [binderView, cards, collection, q, binderOwnedOnly, binderMissing, signedOnly, overOnly])

  const rarityBySet = useMemo(() => {
    const out: Record<string, { rarity: string; total: number; owned: number }[]> = {}
    for (const id of Object.keys(sets)) {
      const counts = new Map<string, { total: number; owned: number }>()
      for (const c of cards) {
        if (c.set !== id) continue
        const r = c.rarity || 'Other'
        const cur = counts.get(r) || { total: 0, owned: 0 }
        cur.total += 1
        if (ownedQty(collection[c.id]) > 0) cur.owned += 1
        counts.set(r, cur)
      }
      const rows: { rarity: string; total: number; owned: number }[] = RARITY_ORDER
        .filter((r) => counts.has(r))
        .map((r) => ({ rarity: r, total: counts.get(r)!.total, owned: counts.get(r)!.owned }))
      for (const [r, v] of counts) {
        if (!(RARITY_ORDER as readonly string[]).includes(r)) rows.push({ rarity: r, total: v.total, owned: v.owned })
      }
      out[id] = rows
    }
    return out
  }, [cards, sets, collection])

  const activeBinderProgress = useMemo(() => {
    if (!binderView || binderView === 'owned') return null
    return setProgress.find((s) => s.id === binderView) || null
  }, [binderView, setProgress])

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
      `${ok} gefunden` +
        (miss ? `, ${miss} nicht gefunden: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? '...' : ''}` : ''),
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
  if (!catalog) return <div className="main">Lade Riftbound-Katalog...</div>

  return (
    <div className="app">
      <header className="top titlebar">
        <div className="brand">Riftbound <span>Tracker</span></div>
        <nav className="tabs no-drag">
          {([
            ['collection', 'Sammlung'],
            ['catalog', 'Katalog'],
            ['bulk', 'Codes'],
            ['decks', 'Decks'],
          ] as const).map(([id, label]) => (
            <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="stats no-drag" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span>{totals.unique} Unique | {totals.copies} Kopien | {totals.catalog} im Katalog</span>
          {collectionValue && (
            <span className="value-pill" title="Schätzung: Owned * ab (Low) + Foil * FoilLow (EUR, Cardmarket)">
              ~{collectionValue.sum.toFixed(2)} EUR
            </span>
          )}
          {updateInfo?.status === 'downloaded' && (
            <button className="btn small primary" onClick={() => window.riftbound?.installUpdate()}>Neustart</button>
          )}
        </div>
        <div className="chrome no-drag">
          <button
            type="button"
            className={`version-btn${updateInfo?.status ? ` status-${updateInfo.status}` : ''}`}
            title={updateTitle()}
            onClick={checkUpdates}
          >
            {updateLabel()}
          </button>
          <button type="button" className="win-btn" title="Minimieren" aria-label="Minimieren" onClick={() => window.riftbound?.windowMinimize?.()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 5h8" stroke="currentColor" strokeWidth="1.2" fill="none" /></svg>
          </button>
          <button type="button" className="win-btn" title={isMaximized ? 'Wiederherstellen' : 'Maximieren'} aria-label={isMaximized ? 'Wiederherstellen' : 'Maximieren'} onClick={toggleMaximize}>
            {isMaximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 3.5h5v5h-5zM3.5 2.5h5v5" stroke="currentColor" strokeWidth="1.1" fill="none" /></svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7" stroke="currentColor" strokeWidth="1.2" fill="none" /></svg>
            )}
          </button>
          <button type="button" className="win-btn win-close" title="Schließen" aria-label="Schließen" onClick={() => window.riftbound?.windowClose?.()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.2" fill="none" /></svg>
          </button>
        </div>
      </header>

      <main className="main">
        {tab === 'collection' && binderView == null && (
          <>
            <div className="toolbar">
              <div className="grow">
                <h2 className="section-title">Sammlung</h2>
                <p className="help" style={{ margin: 0 }}>Set-Binder öffnen, um Karten zu browsen und zu verwalten.</p>
              </div>
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
            <div className="binder-grid">
              {setProgress.map((s) => (
                <button key={s.id} type="button" className="binder-tile" onClick={() => { setBinderView(s.id); setQ(''); setBinderOwnedOnly(false); setBinderMissing(false) }}>
                  <div className="binder-code">{s.id}</div>
                  <div className="binder-name">{s.name}</div>
                  <div className="binder-progress">{s.owned} / {s.total} ({s.pct}%)</div>
                  <div className="binder-bar"><span style={{ width: `${s.pct}%` }} /></div>
                  {s.eur != null && <div className="binder-eur">~{s.eur.toFixed(2)} EUR</div>}
                  <div className="rarity-block">
                    <div className="rarity-heading">Nach Seltenheit</div>
                    {(rarityBySet[s.id] || []).map((row) => {
                      const pct = row.total ? Math.round((row.owned / row.total) * 100) : 0
                      return (
                        <div key={row.rarity} className={`rarity-row rar-${row.rarity.toLowerCase()}`}>
                          <span className="rarity-label">{row.rarity}</span>
                          <div className="rarity-track"><span style={{ width: `${pct}%` }} /></div>
                          <span className="rarity-count">{row.owned} / {row.total}</span>
                        </div>
                      )
                    })}
                  </div>
                </button>
              ))}
              <button type="button" className="binder-tile binder-tile-owned" onClick={() => { setBinderView('owned'); setQ(''); setBinderOwnedOnly(false); setBinderMissing(false) }}>
                <div className="binder-code">ALL</div>
                <div className="binder-name">Alle Owned</div>
                <div className="binder-progress">{totals.unique} Unique | {totals.copies} Kopien</div>
                <p className="help" style={{ margin: '8px 0 0' }}>Nur besessene Karten (alte Sammlung)</p>
              </button>
            </div>
          </>
        )}

        {tab === 'collection' && binderView != null && (
          <>
            <div className="toolbar binder-toolbar">
              <button className="btn" onClick={() => setBinderView(null)}>Zurück</button>
              <div className="grow">
                <div className="section-title">
                  {binderView === 'owned'
                    ? 'Alle Owned'
                    : `${activeBinderProgress?.id || binderView} - ${activeBinderProgress?.name || sets[binderView] || binderView}`}
                </div>
                {activeBinderProgress && (
                  <div className="sub">{activeBinderProgress.owned}/{activeBinderProgress.total} ({activeBinderProgress.pct}%)</div>
                )}
                {binderView && binderView !== 'owned' && (rarityBySet[binderView] || []).length > 0 && (
                  <div className="rarity-block rarity-block-inline">
                    <div className="rarity-heading">Nach Seltenheit</div>
                    {(rarityBySet[binderView] || []).map((row) => {
                      const pct = row.total ? Math.round((row.owned / row.total) * 100) : 0
                      return (
                        <div key={row.rarity} className={`rarity-row rar-${row.rarity.toLowerCase()}`}>
                          <span className="rarity-label">{row.rarity}</span>
                          <div className="rarity-track"><span style={{ width: `${pct}%` }} /></div>
                          <span className="rarity-count">{row.owned} / {row.total}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
                {binderView === 'owned' && (
                  <div className="sub">{totals.unique} Unique | {totals.copies} Kopien</div>
                )}
              </div>
              <input
                className="search grow"
                placeholder="Suche Name, Code, Domain..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <button
                type="button"
                className={`chip ${binderOwnedOnly ? 'active' : ''}`}
                onClick={() => { setBinderOwnedOnly((v) => !v); if (!binderOwnedOnly) setBinderMissing(false) }}
              >
                Owned only
              </button>
              {binderView !== 'owned' && (
                <button
                  type="button"
                  className={`chip ${binderMissing ? 'active' : ''}`}
                  onClick={() => { setBinderMissing((v) => !v); if (!binderMissing) setBinderOwnedOnly(false) }}
                >
                  Missing
                </button>
              )}
              <button
                type="button"
                className={`chip ${signedOnly ? 'active' : ''}`}
                onClick={() => setSignedOnly((v) => !v)}
              >
                Signed
              </button>
              <button
                type="button"
                className={`chip ${overOnly ? 'active' : ''}`}
                onClick={() => setOverOnly((v) => !v)}
              >
                Overnumbered
              </button>
            </div>

            {binderCards.length === 0 && (
              <div className="empty">
                {binderView === 'owned' && ownedCards.length === 0
                  ? 'Noch keine Karten. Geh zu Bulk oder Katalog und füge welche hinzu.'
                  : 'Keine Karten für diese Filter.'}
              </div>
            )}

            <div className="grid">
              {binderCards.map((c) => {
                const o = collection[c.id] || { qty: 0, foil: 0 }
                const n = ownedQty(o)
                return (
                  <article key={c.id} className={`card ${n ? 'owned' : 'missing'}${c.signed || c.overnumbered ? ' shimmer' : ''}`}>
                    <div className="art" style={{ backgroundImage: c.image ? `url(${c.image})` : undefined }}>
                      {n > 0 && <div className="badge">x{n}</div>}
                      <div className="flags">
                        {c.signed ? <span className="flag signed">Signed</span> : null}
                        {c.overnumbered && !c.signed ? <span className="flag over">ON</span> : null}
                        {c.altArt ? <span className="flag alt">Alt</span> : null}
                      </div>
                    </div>
                    <div className="meta">
                      <button
                        type="button"
                        className="name name-link"
                        title="Auf Cardmarket öffnen"
                        disabled={!priceBook?.cards[c.id]?.cmId}
                        onClick={() => openCm(priceBook?.cards[c.id]?.cmId)}
                      >{displayName(c)}</button>
                      <div className="sub">{c.code} | {c.set} | {(c.types || []).join('/') || '-'} | {(c.domains || []).join('/') || '-'}</div>
                      {(() => {
                        const pl = priceLabel(priceBook?.cards[c.id])
                        if (!pl || (!pl.low && !pl.avg30 && !pl.high && !pl.foil)) return null
                        return (
                          <div className="price">
                            {pl.low ? <span title="Niedrigster Preis (ab)">ab {pl.low}</span> : <span className="na">ab --</span>}
                            {pl.high ? <span className="high" title="Höchster Preis">max {pl.high}</span> : null}
                            {pl.avg30 ? <span className="avg30" title="30-Tage-Durchschnitt">Ø30 {pl.avg30}</span> : null}
                            {pl.foil ? <span className="foil" title="Foil Low">F {pl.foil}</span> : null}
                          </div>
                        )
                      })()}
                      <div className="row">
                        <div className="qty" title="Normal">
                          <button onClick={() => bump(c.id, 'qty', -1)}>-</button>
                          <b className={o.qty > 0 ? 'ok' : 'muted'}>{o.qty}</b>
                          <button onClick={() => bump(c.id, 'qty', 1)}>+</button>
                        </div>
                        <div className="qty" title="Foil">
                          <button onClick={() => bump(c.id, 'foil', -1)}>-</button>
                          <b className={o.foil > 0 ? 'ok' : 'muted'}>{o.foil}F</b>
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

        {tab === 'catalog' && (
          <>
            <div className="toolbar">
              <input
                className="search grow"
                placeholder="Suche Name, Code, Domain..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <select className="select" style={{ maxWidth: 180 }} value={setFilter} onChange={(e) => setSetFilter(e.target.value)}>
                <option value="">Alle Sets</option>
                {Object.entries(sets).map(([id, name]) => (
                  <option key={id} value={id}>{id} - {name}</option>
                ))}
              </select>
              <select className="select" style={{ maxWidth: 150 }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="">Alle Typen</option>
                {allTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <label className="pill">
                <input type="checkbox" checked={signedOnly} onChange={(e) => setSignedOnly(e.target.checked)} /> Signed
              </label>
              <label className="pill">
                <input type="checkbox" checked={overOnly} onChange={(e) => setOverOnly(e.target.checked)} /> Overnumbered
              </label>
              <label className="pill">
                <input type="checkbox" checked={ownedOnly} onChange={(e) => setOwnedOnly(e.target.checked)} /> nur Owned
              </label>
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

            <div className="grid">
              {filtered.map((c) => {
                const o = collection[c.id] || { qty: 0, foil: 0 }
                return (
                  <article key={c.id} className={`card ${ownedQty(o) ? 'owned' : ''}${c.signed || c.overnumbered ? ' shimmer' : ''}`}>
                    <div className="art" style={{ backgroundImage: c.image ? `url(${c.image})` : undefined }}>
                      {ownedQty(o) > 0 && <div className="badge">x{ownedQty(o)}</div>}
                      <div className="flags">
                        {c.signed ? <span className="flag signed">Signed</span> : null}
                        {c.overnumbered && !c.signed ? <span className="flag over">ON</span> : null}
                        {c.altArt ? <span className="flag alt">Alt</span> : null}
                      </div>
                    </div>
                    <div className="meta">
                      <button
                        type="button"
                        className="name name-link"
                        title="Auf Cardmarket öffnen"
                        disabled={!priceBook?.cards[c.id]?.cmId}
                        onClick={() => openCm(priceBook?.cards[c.id]?.cmId)}
                      >{displayName(c)}</button>
                      <div className="sub">{c.code} | {c.set} | {(c.types || []).join('/') || '-'} | {(c.domains || []).join('/') || '-'}</div>
                      {(() => {
                        const pl = priceLabel(priceBook?.cards[c.id])
                        if (!pl || (!pl.low && !pl.avg30 && !pl.high && !pl.foil)) return null
                        return (
                          <div className="price">
                            {pl.low ? <span title="Niedrigster Preis (ab)">ab {pl.low}</span> : <span className="na">ab --</span>}
                            {pl.high ? <span className="high" title="Höchster Preis">max {pl.high}</span> : null}
                            {pl.avg30 ? <span className="avg30" title="30-Tage-Durchschnitt">Ø30 {pl.avg30}</span> : null}
                            {pl.foil ? <span className="foil" title="Foil Low">F {pl.foil}</span> : null}
                          </div>
                        )
                      })()}
                      <div className="row">
                        <div className="qty" title="Normal">
                          <button onClick={() => bump(c.id, 'qty', -1)}>-</button>
                          <b>{o.qty}</b>
                          <button onClick={() => bump(c.id, 'qty', 1)}>+</button>
                        </div>
                        <div className="qty" title="Foil">
                          <button onClick={() => bump(c.id, 'foil', -1)}>-</button>
                          <b className="ok">{o.foil}F</b>
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
              <h2>Karten per Code</h2>
              <p className="help">
                Sammlercodes einfügen: Leerzeichen, Komma oder je Zeile einen Code. Beispiele: <code>OGN-056/298</code>, <code>OGN-56</code>, <code>UNL 131</code>, Alt-Art <code>OGN-066a</code>. Scanner: Codes aus dem Scan hier einfügen (Bilderkennung folgt später).
              </p>
              <textarea
                className="field"
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={'OGN-001/298\nOGN-056/298\nSFD-12\nUNL 131'}
              />
              <div className="toolbar" style={{ marginTop: 10 }}>
                <label className="pill">
                  <input type="checkbox" checked={bulkFoil} onChange={(e) => setBulkFoil(e.target.checked)} /> Als Foil
                </label>
                <button className="btn primary" onClick={() => applyBulk('add')}>+1 je Code</button>
                <button className="btn" onClick={() => applyBulk('set')}>Auf 1 setzen</button>
                <button className="btn danger" onClick={() => applyBulk('remove')}>-1 je Code</button>
              </div>
              {bulkReport && <p className="help">{bulkReport}</p>}
            </section>
            <section className="panel">
              <h2>Übersicht</h2>
              <p className="help">Sammlung liegt lokal auf diesem PC. CSV Export als Backup nutzen.</p>
              <div className="list">
                <div className="list-item"><span>Unique</span><b>{totals.unique}</b></div>
                <div className="list-item"><span>Kopien</span><b>{totals.copies}</b></div>
                <div className="list-item"><span>Katalog</span><b>{totals.catalog}</b></div>
                {collectionValue && (
                  <div className="list-item"><span>Wert (EUR)</span><b>~{collectionValue.sum.toFixed(2)}</b></div>
                )}
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
                            <div className="sub">{c.code} | besitzt {have}</div>
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
                <input className="search grow" placeholder="Suche..." value={q} onChange={(e) => setQ(e.target.value)} />
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
                        <div className="sub">{c.code} | x{ownedQty(collection[c.id])}</div>
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
