import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from 'react'
import type { Card, Catalog, Deck, DeckSection, PriceBook, PriceEntry } from './types'
import { loadCollection, loadDecks, saveCollection, saveDecks, type Collection } from './storage'
import { loadLang, saveLang, t, type Lang } from './i18n'
import { parseBulkTokens, resolveToken } from './parseBulk'
import {
  SECTION_ADD_LABEL,
  SECTION_CAPS,
  SECTION_LABEL,
  SECTION_ORDER,
  canAddToSection,
  cardFitsSection,
  cardMatchesLegendDomains,
  deckTotalQtyById,
  displayCardName,
  getLegendDomains,
  hasLegend,
  inferSection,
  isLegendSwapState,
  isSingleSlotSection,
  legendCoversRequiredDomains,
  matchCardByName,
  migrateDeck,
  parseDeckImport,
  requiredDomainsFromDeck,
  sanitizeDeckCards,
  sectionCount,
  sectionNeedsLegend,
  sectionOf,
} from './deckHelpers'

type Tab = 'collection' | 'catalog' | 'sales' | 'bulk' | 'decks'

function uid() {
  return crypto.randomUUID()
}

function ownedQty(o?: { qty: number; foil: number }) {
  return (o?.qty || 0) + (o?.foil || 0)
}

/** Reduce non-foil (qty) first, then foil. Never below 0. */
function subtractOwnedCopies(o: { qty: number; foil: number }, sellQty: number) {
  const have = ownedQty(o)
  const want = Math.max(0, Math.floor(sellQty) || 0)
  const sold = Math.min(want, have)
  const short = want - sold
  let rem = sold
  let qty = o.qty || 0
  let foil = o.foil || 0
  const fromNonFoil = Math.min(qty, rem)
  qty -= fromNonFoil
  rem -= fromNonFoil
  if (rem > 0) {
    const fromFoil = Math.min(foil, rem)
    foil -= fromFoil
  }
  return { qty, foil, sold, short }
}


function cardWord(lang: Lang, n: number) {
  return lang === 'de' ? (n === 1 ? 'Karte' : 'Karten') : (n === 1 ? 'card' : 'cards')
}

function copyWord(lang: Lang, n: number) {
  return lang === 'de' ? (n === 1 ? 'Kopie' : 'Kopien') : (n === 1 ? 'copy' : 'copies')
}

function fmtEur(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return null
  return `${n.toFixed(2)}€`
}

function priceLabel(p?: PriceEntry) {
  if (!p) return null
  const low = fmtEur(p.low)
  const high = fmtEur(p.high ?? null)
  const avg30 = fmtEur(p.avg30 ?? null)
  const foil = fmtEur(p.foilLow) || fmtEur(p.foilTrend)
  return { low, high, avg30, foil, cmId: p.cmId || null, cmUrl: p.cmUrl || null }
}

function cmUrl(p?: PriceEntry | null) {
  if (!p) return null
  if (p.cmUrl) return p.cmUrl
  return null
}

const RARITY_ORDER = ['Common', 'Uncommon', 'Rare', 'Epic', 'Showcase'] as const

const DOMAINS = ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order', 'Colorless'] as const

/** Resolve public/ assets against the page URL (Electron loadFile + asar).
 *  Never append ?query — Chromium file:// / asar lookups treat the query as
 *  part of the path and break every domain icon. Cache-bust is unnecessary
 *  because updates replace the whole asar. Matches cards.json / prices.json. */
function publicAsset(rel: string) {
  return new URL(rel, window.location.href).href
}

const DOMAIN_ICON: Record<(typeof DOMAINS)[number], string> = {
  Fury: publicAsset('domains/fury.png'),
  Calm: publicAsset('domains/calm.png'),
  Mind: publicAsset('domains/mind.png'),
  Body: publicAsset('domains/body.png'),
  Chaos: publicAsset('domains/chaos.png'),
  Order: publicAsset('domains/order.png'),
  Colorless: publicAsset('domains/colorless.png'),
}

/** Official Display / box art under public/sets/{CODE}.png (Riot Merch). */
const SET_ART_IDS = new Set(['OGN', 'OGS', 'SFD', 'UNL', 'VEN', 'ARC', 'RAD', 'WRLD25'])


function openCm(p?: PriceEntry | null) {
  const url = cmUrl(p)
  if (!url) return
  if (window.riftbound?.openExternal) {
    void window.riftbound.openExternal(url)
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

export default function App() {
  const [tab, setTab] = useState<Tab>('collection')
  const [lang, setLang] = useState<Lang>(() => loadLang())
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
  const [saleList, setSaleList] = useState<Record<string, number>>({})
  const [saleSelected, setSaleSelected] = useState<Record<string, boolean>>({})
  const [saleQ, setSaleQ] = useState('')
  const [salePaste, setSalePaste] = useState('')
  const [saleReport, setSaleReport] = useState<string | null>(null)
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null)
  const [deckOwnedOnly, setDeckOwnedOnly] = useState(false)
  const [activeSection, setActiveSection] = useState<DeckSection>('main')
  const [deckImportText, setDeckImportText] = useState('')
  const [deckImportOpen, setDeckImportOpen] = useState(false)
  const [deckMissingReport, setDeckMissingReport] = useState<{ name: string; need: number; have: number; short: number }[] | null>(null)
  const [cardPreview, setCardPreview] = useState<{ src: string; x: number; y: number } | null>(null)
  const [appVersion, setAppVersion] = useState('')
  const [updateInfo, setUpdateInfo] = useState<{ status: string; version?: string; message?: string; percent?: number } | null>(null)
  const [isMaximized, setIsMaximized] = useState(false)
  const [priceBook, setPriceBook] = useState<PriceBook | null>(null)
  // null = binder dashboard; 'owned' = all owned; set code = that set binder
  const [binderView, setBinderView] = useState<string | null>(null)
  const [binderOwnedOnly, setBinderOwnedOnly] = useState(false)
  const [binderMissing, setBinderMissing] = useState(false)
  const [binderRarity, setBinderRarity] = useState<string | null>(null)
  const [domainFilter, setDomainFilter] = useState<string | null>(null)
  const [dragOverSection, setDragOverSection] = useState<DeckSection | null>(null)
  const [dropFlashSection, setDropFlashSection] = useState<DeckSection | null>(null)
  const [dragRejectSection, setDragRejectSection] = useState<DeckSection | null>(null)
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null)
  const [dragOverSale, setDragOverSale] = useState(false)
  const [dropFlashSale, setDropFlashSale] = useState(false)
  const [dragRejectSale, setDragRejectSale] = useState(false)
  const [deckNotice, setDeckNotice] = useState<string | null>(null)
  const dragGhostRef = useRef<HTMLElement | null>(null)
  const dragGhostCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    window.riftbound?.getVersion().then(setAppVersion).catch(() => {})
    window.riftbound?.windowIsMaximized?.().then(setIsMaximized).catch(() => {})
    const off = window.riftbound?.onUpdater((p) => setUpdateInfo(p))
    return () => { off?.() }
  }, [])

  async function onVersionClick() {
    const s = updateInfo?.status
    if (s === 'downloading' || s === 'checking') return
    if (s === 'available') {
      setUpdateInfo({ status: 'downloading', percent: 0, version: updateInfo?.version })
      try {
        await window.riftbound?.downloadUpdate?.()
      } catch (e) {
        setUpdateInfo({ status: 'error', message: String(e) })
      }
      return
    }
    if (s === 'downloaded') {
      try {
        await window.riftbound?.installUpdate?.()
      } catch (e) {
        setUpdateInfo({ status: 'error', message: String(e) })
      }
      return
    }
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
    const ver = updateInfo?.version ? `v${updateInfo.version}` : (appVersion ? `v${appVersion}` : 'v?')
    if (s === 'checking') return t(lang, 'update.checking')
    if (s === 'available') return t(lang, 'update.available', { version: ver })
    if (s === 'downloading') return t(lang, 'update.downloading', { percent: updateInfo?.percent ?? 0 })
    if (s === 'downloaded') return t(lang, 'update.downloaded')
    if (s === 'not-available') return appVersion ? `v${appVersion}` : 'v?'
    if (s === 'error') return t(lang, 'update.error')
    return appVersion ? `v${appVersion}` : 'v?'
  }

  function updateTitle() {
    const s = updateInfo?.status
    const ver = updateInfo?.version ? `v${updateInfo.version}` : (appVersion ? `v${appVersion}` : 'v?')
    if (s === 'checking') return t(lang, 'update.titleChecking')
    if (s === 'available') return t(lang, 'update.titleAvailable', { version: ver })
    if (s === 'downloading') return t(lang, 'update.titleDownloading')
    if (s === 'downloaded') return t(lang, 'update.titleDownloaded')
    if (s === 'not-available') return t(lang, 'update.titleNotAvailable')
    if (s === 'error') return updateInfo?.message || t(lang, 'update.error')
    return t(lang, 'update.titleIdle')
  }

  function setAppLang(next: Lang) {
    setLang(next)
    saveLang(next)
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
    if (domainFilter && !(c.domains || []).includes(domainFilter)) return false
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

  useEffect(() => {
    if (!cards.length) return
    setDecks((prev) => {
      let changed = false
      let notice: string | null = null
      const next = prev.map((d) => {
        const m = migrateDeck(d, byId)
        const s = sanitizeDeckCards(m.cards, byId)
        const cardsChanged = s.trimmed > 0 || s.domainRemoved > 0 || m !== d
        if (cardsChanged) {
          changed = true
          if (d.id === activeDeckId && s.notice) notice = s.notice
          return { ...m, cards: s.cards }
        }
        return m
      })
      if (notice) {
        // Defer so we don't call setState of another hook inside this updater
        queueMicrotask(() => setDeckNotice(notice))
      }
      return changed ? next : prev
    })
    // activeDeckId intentionally omitted: only sanitize when catalog/byId changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, byId])

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    return cards.filter((c) => {
      if (ownedOnly && ownedQty(collection[c.id]) <= 0) return false
      return matchesFilters(c, query)
    })
  }, [cards, q, setFilter, typeFilter, domainFilter, signedOnly, overOnly, ownedOnly, collection])

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
      if (binderRarity && (c.rarity || 'Other') !== binderRarity) return false
      if (domainFilter && !(c.domains || []).includes(domainFilter)) return false
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
  }, [binderView, cards, collection, q, binderOwnedOnly, binderMissing, binderRarity, domainFilter, signedOnly, overOnly])

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
      t(lang, 'bulk.found', { ok }) +
        (miss
          ? t(lang, 'bulk.missing', {
              miss,
              list: `${missing.slice(0, 12).join(', ')}${missing.length > 12 ? '...' : ''}`,
            })
          : ''),
    )
  }

  function saleRemaining(id: string) {
    const have = ownedQty(collection[id])
    const inSale = saleList[id] || 0
    return Math.max(0, have - inSale)
  }

  function addToSale(id: string, n = 1) {
    const add = Math.max(0, Math.floor(n) || 0)
    if (add <= 0) return
    setSaleList((prev) => {
      const have = ownedQty(collection[id])
      if (have <= 0) return prev
      const cur = prev[id] || 0
      const nextQty = Math.min(have, cur + add)
      if (nextQty <= 0) return prev
      return { ...prev, [id]: nextQty }
    })
    setSaleReport(null)
  }

  function bumpSale(id: string, delta: number) {
    setSaleList((prev) => {
      const have = ownedQty(collection[id])
      const cur = prev[id] || 0
      const nextQty = Math.max(0, Math.min(have, cur + delta))
      const copy = { ...prev }
      if (nextQty <= 0) {
        delete copy[id]
        setSaleSelected((sel) => {
          if (!(id in sel)) return sel
          const n = { ...sel }
          delete n[id]
          return n
        })
      } else copy[id] = nextQty
      return copy
    })
  }

  function setSaleQty(id: string, raw: number) {
    const have = ownedQty(collection[id])
    const nextQty = Math.max(0, Math.min(have, Math.floor(raw) || 0))
    setSaleList((prev) => {
      const copy = { ...prev }
      if (nextQty <= 0) {
        delete copy[id]
        setSaleSelected((sel) => {
          if (!(id in sel)) return sel
          const n = { ...sel }
          delete n[id]
          return n
        })
      } else copy[id] = nextQty
      return copy
    })
  }

  function toggleSaleSelected(id: string) {
    setSaleSelected((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const saleSelectedEntries = Object.entries(saleList).filter(([id, q]) => q > 0 && saleSelected[id])
  const saleSelectedCount = saleSelectedEntries.length
  const saleSelectedCopies = saleSelectedEntries.reduce((sum, [, q]) => sum + q, 0)

  function applySalePaste() {
    const lines = salePaste.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    let added = 0
    let copies = 0
    const problems: string[] = []
    const next = { ...saleList }
    for (const line of lines) {
      const m = line.match(/^(\d+)\s*[xX]?\s+(.+)$/)
      const qty = m ? Math.max(1, Number(m[1]) || 1) : 1
      const token = (m ? m[2] : line).trim()
      const card = resolveToken(token, cards) || matchCardByName(cards, token)
      if (!card) {
        problems.push(t(lang, 'sales.notFound', { line }))
        continue
      }
      const have = ownedQty(collection[card.id])
      if (have <= 0) {
        problems.push(t(lang, 'sales.notOwned', { name: displayName(card) }))
        continue
      }
      const cur = next[card.id] || 0
      const room = Math.max(0, have - cur)
      if (room <= 0) {
        problems.push(t(lang, 'sales.limitReached', { name: displayName(card) }))
        continue
      }
      const take = Math.min(qty, room)
      next[card.id] = cur + take
      added += 1
      copies += take
      if (take < qty) problems.push(t(lang, 'sales.onlyPartial', { take, qty, name: displayName(card) }))
    }
    setSaleList(next)
    const ok = t(lang, 'sales.added', { copies, cards: added, copyWord: copyWord(lang, copies), cardWord: cardWord(lang, added) })
    setSaleReport(
      problems.length
        ? `${ok}. ${problems.slice(0, 8).join(' · ')}${problems.length > 8 ? '…' : ''}`
        : ok,
    )
  }

  function confirmSale() {
    const entries = Object.entries(saleList).filter(([id, q]) => q > 0 && saleSelected[id])
    if (!entries.length) {
      setSaleReport(t(lang, 'sales.noneSelected'))
      return
    }
    let soldCards = 0
    let soldCopies = 0
    const notes: string[] = []
    const next = { ...collection }
    const soldIds = new Set<string>()
    for (const [id, want] of entries) {
      const cur = next[id] || { qty: 0, foil: 0 }
      const r = subtractOwnedCopies(cur, want)
      if (r.sold > 0) {
        soldCards += 1
        soldCopies += r.sold
        soldIds.add(id)
      }
      if (r.short > 0) {
        const c = byId.get(id)
        notes.push(t(lang, 'sales.short', { name: c ? displayName(c) : id, short: r.short }))
      }
      if (r.qty === 0 && r.foil === 0) delete next[id]
      else next[id] = { qty: r.qty, foil: r.foil }
    }
    setCollection(next)
    setSaleList((prev) => {
      const copy = { ...prev }
      for (const id of soldIds) delete copy[id]
      return copy
    })
    setSaleSelected((prev) => {
      const copy = { ...prev }
      for (const id of soldIds) delete copy[id]
      return copy
    })
    setSaleReport(
      t(lang, 'sales.sold', {
        cards: soldCards,
        copies: soldCopies,
        cardWord: cardWord(lang, soldCards),
        copyWord: copyWord(lang, soldCopies),
      }) + (notes.length ? ` ${notes.slice(0, 4).join(' · ')}` : ''),
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
      setBulkReport(t(lang, 'catalog.csvImported', { name: file.name }))
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
    const d: Deck = { id: uid(), name: t(lang, 'decks.newName', { n: decks.length + 1 }), cards: [], updatedAt: new Date().toISOString() }
    setDecks((prev) => [d, ...prev])
    setActiveDeckId(d.id)
    setActiveSection('legend')
    setDeckMissingReport(null)
    setDeckNotice(null)
  }

  const activeDeck = decks.find((d) => d.id === activeDeckId) || null

  function updateDeck(mut: (d: Deck) => Deck) {
    if (!activeDeckId) return
    setDecks((prev) => prev.map((d) => (d.id === activeDeckId ? { ...mut(d), updatedAt: new Date().toISOString() } : d)))
  }

  function addToDeck(cardId: string, section?: DeckSection) {
    const c = byId.get(cardId)
    if (!c) return
    const sec = section || activeSection || inferSection(c)
    const deck = decks.find((d) => d.id === activeDeckId)
    if (!deck) return
    const check = canAddToSection(deck.cards, c, sec, byId, 1)
    if (!check.ok) {
      setDeckNotice(check.message)
      if (check.reason === 'legend') setActiveSection('legend')
      return
    }
    const legendChanging = sec === 'legend'
    updateDeck((d) => {
      const existing = d.cards.find((x) => x.id === cardId && sectionOf(x) === sec)
      let cards: typeof d.cards
      if (existing) {
        cards = d.cards.map((x) =>
          x.id === cardId && sectionOf(x) === sec ? { ...x, qty: x.qty + 1, section: sec } : x,
        )
      } else {
        cards = [...d.cards, { id: cardId, qty: 1, section: sec }]
      }
      if (legendChanging) {
        const s = sanitizeDeckCards(cards, byId)
        if (s.notice) setDeckNotice(s.notice)
        return { ...d, cards: s.cards }
      }
      return { ...d, cards }
    })
  }

  function onPickerDragStart(e: ReactDragEvent, cardId: string) {
    setDraggingCardId(cardId)
    setCardPreview(null)
    e.dataTransfer.setData('text/riftbound-card', cardId)
    e.dataTransfer.setData('text/plain', cardId)
    e.dataTransfer.effectAllowed = 'copy'
    const row = e.currentTarget as HTMLElement
    const card = byId.get(cardId)
    try {
      clearDragGhost()
      // Opaque card-art ghost: Chromium dims native setDragImage, so hide it
      // and follow the cursor with our own fully-opaque element instead.
      if (card?.image) {
        const ox = 120
        const oy = 168
        const ghost = document.createElement('div')
        ghost.className = 'card-float-preview card-drag-ghost'
        ghost.style.position = 'fixed'
        ghost.style.left = `${e.clientX - ox}px`
        ghost.style.top = `${e.clientY - oy}px`
        ghost.style.opacity = '1'
        const img = document.createElement('img')
        img.src = card.image
        img.alt = ''
        img.draggable = false
        ghost.appendChild(img)
        document.body.appendChild(ghost)
        dragGhostRef.current = ghost

        const blank = document.createElement('canvas')
        blank.width = 1
        blank.height = 1
        e.dataTransfer.setDragImage(blank, 0, 0)

        const move = (ev: DragEvent) => {
          const g = dragGhostRef.current
          if (!g) return
          g.style.left = `${ev.clientX - ox}px`
          g.style.top = `${ev.clientY - oy}px`
        }
        document.addEventListener('dragover', move)
        dragGhostCleanupRef.current = () => document.removeEventListener('dragover', move)
      }
    } catch {}
    row.classList.add('dragging')
  }

  function clearDragGhost() {
    dragGhostCleanupRef.current?.()
    dragGhostCleanupRef.current = null
    dragGhostRef.current?.remove()
    dragGhostRef.current = null
  }

  function onPickerDragEnd(e: ReactDragEvent) {
    (e.currentTarget as HTMLElement).classList.remove('dragging')
    clearDragGhost()
    setDraggingCardId(null)
    setDragOverSection(null)
    setDragRejectSection(null)
    setDragOverSale(false)
    setDragRejectSale(false)
  }

  function onSaleCartDragOver(e: ReactDragEvent) {
    const types = Array.from(e.dataTransfer.types || [])
    const raw = types.includes('text/riftbound-card') || types.includes('text/plain') || !!draggingCardId
    if (!raw) return
    e.preventDefault()
    const id = draggingCardId
    if (id && saleRemaining(id) <= 0) {
      e.dataTransfer.dropEffect = 'none'
      setDragOverSale(false)
      setDragRejectSale(true)
      return
    }
    e.dataTransfer.dropEffect = 'copy'
    setDragRejectSale(false)
    setDragOverSale(true)
  }

  function onSaleCartDragLeave(e: ReactDragEvent) {
    const related = e.relatedTarget as Node | null
    if (related && (e.currentTarget as HTMLElement).contains(related)) return
    setDragOverSale(false)
    setDragRejectSale(false)
  }

  function onSaleCartDrop(e: ReactDragEvent) {
    e.preventDefault()
    e.stopPropagation()
    const cardId = e.dataTransfer.getData('text/riftbound-card') || e.dataTransfer.getData('text/plain')
    setDragOverSale(false)
    setDragRejectSale(false)
    if (!cardId) return
    if (ownedQty(collection[cardId]) <= 0 || saleRemaining(cardId) <= 0) {
      setDragRejectSale(true)
      window.setTimeout(() => setDragRejectSale(false), 450)
      return
    }
    addToSale(cardId, 1)
    setDropFlashSale(true)
    window.setTimeout(() => setDropFlashSale(false), 380)
  }

  function saleCartDropClass() {
    const parts = ['list', 'sale-cart']
    if (dragOverSale) parts.push('drag-over')
    if (dropFlashSale) parts.push('drop-flash')
    if (dragRejectSale) parts.push('drag-reject')
    return parts.join(' ')
  }

  function onSectionDragOver(e: ReactDragEvent, sec: DeckSection) {
    const types = Array.from(e.dataTransfer.types || [])
    const raw = types.includes('text/riftbound-card') || types.includes('text/plain') || !!draggingCardId
    if (!raw) return
    e.preventDefault()
    const c = draggingCardId ? byId.get(draggingCardId) : undefined
    const deck = decks.find((d) => d.id === activeDeckId)
    if (c && deck) {
      const check = canAddToSection(deck.cards, c, sec, byId, 1)
      if (!check.ok) {
        e.dataTransfer.dropEffect = 'none'
        setDragOverSection(null)
        setDragRejectSection(sec)
        return
      }
    } else if (c && !cardFitsSection(c, sec)) {
      e.dataTransfer.dropEffect = 'none'
      setDragOverSection(null)
      setDragRejectSection(sec)
      return
    }
    e.dataTransfer.dropEffect = 'copy'
    setDragRejectSection(null)
    setDragOverSection(sec)
  }

  function onSectionDragLeave(e: ReactDragEvent, sec: DeckSection) {
    const related = e.relatedTarget as Node | null
    if (related && (e.currentTarget as HTMLElement).contains(related)) return
    setDragOverSection((cur) => (cur === sec ? null : cur))
    setDragRejectSection((cur) => (cur === sec ? null : cur))
  }

  function onSectionDrop(e: ReactDragEvent, sec: DeckSection) {
    e.preventDefault()
    e.stopPropagation()
    const cardId = e.dataTransfer.getData('text/riftbound-card') || e.dataTransfer.getData('text/plain')
    setDragOverSection(null)
    setDragRejectSection(null)
    if (!cardId || !activeDeckId) return
    const c = byId.get(cardId)
    const deck = decks.find((d) => d.id === activeDeckId)
    if (!c || !deck) {
      setDragRejectSection(sec)
      window.setTimeout(() => setDragRejectSection((cur) => (cur === sec ? null : cur)), 450)
      return
    }
    const check = canAddToSection(deck.cards, c, sec, byId, 1)
    if (!check.ok) {
      setDeckNotice(check.message)
      if (check.reason === 'legend') setActiveSection('legend')
      setDragRejectSection(sec)
      window.setTimeout(() => setDragRejectSection((cur) => (cur === sec ? null : cur)), 450)
      return
    }
    setActiveSection(sec)
    addToDeck(cardId, sec)
    setDropFlashSection(sec)
    window.setTimeout(() => setDropFlashSection((cur) => (cur === sec ? null : cur)), 380)
  }

  function sectionDropClass(sec: DeckSection, locked = false, atCap = false) {
    const parts = ['deck-sec']
    if (activeSection === sec) parts.push('active')
    if (dragOverSection === sec) parts.push('drag-over')
    if (dropFlashSection === sec) parts.push('drop-flash')
    if (dragRejectSection === sec) parts.push('drag-reject')
    if (locked) parts.push('locked')
    if (atCap) parts.push('at-cap')
    return parts.join(' ')
  }

  function bumpDeckCard(cardId: string, section: DeckSection, delta: number) {
    const c = byId.get(cardId)
    const deck = decks.find((d) => d.id === activeDeckId)
    if (!deck) return
    if (delta > 0) {
      if (!c) return
      const check = canAddToSection(deck.cards, c, section, byId, delta)
      if (!check.ok) {
        setDeckNotice(check.message)
        return
      }
    }
    const legendLeaving = section === 'legend' && delta < 0
    updateDeck((d) => {
      let cards = d.cards
        .map((x) => {
          if (x.id !== cardId || sectionOf(x) !== section) return x
          return { ...x, qty: x.qty + delta, section }
        })
        .filter((x) => x.qty > 0)
      // Removing Legend keeps existing cards; only sanitize when a Legend is (re)set
      if (section === 'legend' && !legendLeaving) {
        const s = sanitizeDeckCards(cards, byId)
        if (s.notice) setDeckNotice(s.notice)
        cards = s.cards
      }
      return { ...d, cards }
    })
    if (legendLeaving) {
      setActiveSection('legend')
      setDeckNotice(null)
    }
  }

  function removeDeckCard(cardId: string, section: DeckSection) {
    const deck = decks.find((d) => d.id === activeDeckId)
    if (!deck) return
    const entry = deck.cards.find((x) => x.id === cardId && sectionOf(x) === section)
    if (!entry) return
    bumpDeckCard(cardId, section, -entry.qty)
  }

  function deckCount(d: Deck) {
    return d.cards.reduce((s, c) => s + c.qty, 0)
  }

  function underOwnedLines(d: Deck) {
    const totals = deckTotalQtyById(d.cards)
    const out: { id: string; name: string; need: number; have: number; short: number }[] = []
    for (const [id, need] of totals) {
      const have = ownedQty(collection[id])
      if (need > have) {
        const c = byId.get(id)
        out.push({ id, name: c ? displayCardName(c) : id, need, have, short: need - have })
      }
    }
    out.sort((a, b) => b.short - a.short || a.name.localeCompare(b.name))
    return out
  }

  /** Deck aggregate using Cardmarket Low (`ab`), non-foil — same primary as Katalog totals. */
  function deckPriceSums(d: Deck) {
    const totals = deckTotalQtyById(d.cards)
    let deckLow = 0
    let missingLow = 0
    let priced = 0
    let missingPriced = 0
    for (const [id, need] of totals) {
      const low = priceBook?.cards[id]?.low
      if (low == null || Number.isNaN(low)) continue
      deckLow += low * need
      priced += need
      const have = ownedQty(collection[id])
      const short = Math.max(0, need - have)
      if (short > 0) {
        missingLow += low * short
        missingPriced += short
      }
    }
    return { deckLow, missingLow, priced, missingPriced }
  }

  function missingReportFor(d: Deck) {
    return underOwnedLines(d).map(({ name, need, have, short }) => ({ name, need, have, short }))
  }

  function runDeckImport(text: string) {
    if (!activeDeckId) return
    const result = parseDeckImport(text, cards)
    const sanitized = sanitizeDeckCards(result.cards, byId)
    updateDeck((d) => ({ ...d, cards: sanitized.cards }))
    if (sanitized.notice) setDeckNotice(t(lang, 'decks.importAdjusted', { notice: sanitized.notice }))
    const report = sanitized.cards
      .map((dc) => {
        const c = byId.get(dc.id) || cards.find((x) => x.id === dc.id)
        const have = ownedQty(collection[dc.id])
        const need = dc.qty
        return {
          name: c ? displayCardName(c) : dc.id,
          need,
          have,
          short: Math.max(0, need - have),
        }
      })
      .filter((r) => r.short > 0)
    for (const u of result.unmatched) {
      report.push({ name: t(lang, 'decks.notFoundPrefix', { name: u }), need: 0, have: 0, short: 0 })
    }
    if (sanitized.trimmed > 0 || sanitized.domainRemoved > 0) {
      report.unshift({
        name: `Limit/Domain: ${sanitized.notice || t(lang, 'decks.cardsRemoved')}`,
        need: 0,
        have: 0,
        short: 0,
      })
    }
    setDeckMissingReport(report)
    setDeckImportOpen(false)
  }

  if (error) return <div className="main err">{t(lang, 'load.error', { message: error })}</div>
  if (!catalog) return <div className="main">{t(lang, 'load.catalog')}</div>


  function showCardPreview(e: ReactMouseEvent, src: string | null | undefined) {
    if (!src) {
      setCardPreview(null)
      return
    }
    const pad = 14
    const pw = 240
    const ph = 336
    let x = e.clientX + pad
    let y = e.clientY + pad
    if (x + pw > window.innerWidth - 8) x = e.clientX - pw - pad
    if (y + ph > window.innerHeight - 8) y = Math.max(8, window.innerHeight - ph - 8)
    if (x < 8) x = 8
    setCardPreview({ src, x, y })
  }

  function hideCardPreview() {
    setCardPreview(null)
  }

  return (
    <div className="app">
      <header className="top titlebar">
        <div className="brand">Deakrix <span>Riftbound Tracker</span></div>
        <nav className="tabs no-drag">
          {([
            ['collection', 'tab.collection'],
            ['catalog', 'tab.catalog'],
            ['sales', 'tab.sales'],
            ['bulk', 'tab.bulk'],
            ['decks', 'tab.decks'],
          ] as const).map(([id, key]) => (
            <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
              {t(lang, key)}
            </button>
          ))}
        </nav>
        <div className="stats no-drag" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span>{t(lang, 'stats.line', { unique: totals.unique, copies: totals.copies, catalog: totals.catalog })}</span>
          {collectionValue && (
            <span className="value-pill" title={t(lang, 'stats.valueTitle')}>
              ~{collectionValue.sum.toFixed(2)} EUR
            </span>
          )}
          <div className="lang-toggle" role="group" aria-label="Language">
            <button
              type="button"
              className={`lang-btn${lang === 'de' ? ' active' : ''}`}
              title={t(lang, 'lang.de')}
              aria-label={t(lang, 'lang.de')}
              aria-pressed={lang === 'de'}
              onClick={() => setAppLang('de')}
            >🇩🇪</button>
            <button
              type="button"
              className={`lang-btn${lang === 'en' ? ' active' : ''}`}
              title={t(lang, 'lang.en')}
              aria-label={t(lang, 'lang.en')}
              aria-pressed={lang === 'en'}
              onClick={() => setAppLang('en')}
            >🇬🇧</button>
          </div>
        </div>
        <div className="chrome no-drag">
          <button
            type="button"
            className={`version-btn${updateInfo?.status ? ` status-${updateInfo.status}` : ' status-not-available'}`}
            title={updateTitle()}
            onClick={onVersionClick}
            disabled={updateInfo?.status === 'downloading' || updateInfo?.status === 'checking'}
          >
            {updateInfo?.status === 'downloading' && (
              <span className="dl-bar" style={{ width: `${Math.min(100, Math.max(0, updateInfo.percent ?? 0))}%` }} />
            )}
            <span className="dl-label">{updateLabel()}</span>
          </button>
          <button type="button" className="win-btn" title={t(lang, 'win.minimize')} aria-label={t(lang, 'win.minimize')} onClick={() => window.riftbound?.windowMinimize?.()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 5h8" stroke="currentColor" strokeWidth="1.2" fill="none" /></svg>
          </button>
          <button type="button" className="win-btn" title={isMaximized ? t(lang, 'win.restore') : t(lang, 'win.maximize')} aria-label={isMaximized ? t(lang, 'win.restore') : t(lang, 'win.maximize')} onClick={toggleMaximize}>
            {isMaximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 3.5h5v5h-5zM3.5 2.5h5v5" stroke="currentColor" strokeWidth="1.1" fill="none" /></svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7" stroke="currentColor" strokeWidth="1.2" fill="none" /></svg>
            )}
          </button>
          <button type="button" className="win-btn win-close" title={t(lang, 'win.close')} aria-label={t(lang, 'win.close')} onClick={() => window.riftbound?.windowClose?.()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.2" fill="none" /></svg>
          </button>
        </div>
      </header>

      <main className="main">
        {tab === 'collection' && binderView == null && (
          <>
            <div className="toolbar">
              <div className="grow">
                <h2 className="section-title">{t(lang, 'collection.title')}</h2>
                <p className="help" style={{ margin: 0 }}>{t(lang, 'collection.help')}</p>
              </div>
              <button className="btn" onClick={exportCsv}>{t(lang, 'catalog.csvExport')}</button>
              <label className="btn">
                {t(lang, 'catalog.csvImport')}
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
                <button key={s.id} type="button" className="binder-tile" onClick={() => { setBinderView(s.id); setBinderRarity(null); setQ(''); setBinderOwnedOnly(false); setBinderMissing(false) }}>
                  <div className="binder-tile-head">
                    <div className="binder-tile-meta">
                      <div className="binder-code">{s.id}</div>
                      <div className="binder-name">{s.name}</div>
                      <div className="binder-progress">{s.owned} / {s.total} ({s.pct}%)</div>
                      <div className="binder-bar"><span style={{ width: `${s.pct}%` }} /></div>
                      {s.eur != null && <div className="binder-eur">~{s.eur.toFixed(2)} EUR</div>}
                    </div>
                    {SET_ART_IDS.has(s.id) && (
                      <img
                        className="binder-set-art"
                        src={publicAsset(`sets/${s.id}.png`)}
                        alt=""
                        loading="lazy"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                      />
                    )}
                  </div>
                  <div className="rarity-block">
                    <div className="rarity-heading">{t(lang, 'collection.byRarity')}</div>
                    {(rarityBySet[s.id] || []).map((row) => {
                      const pct = row.total ? Math.round((row.owned / row.total) * 100) : 0
                      return (
                        <div
                          key={row.rarity}
                          role="button"
                          tabIndex={0}
                          title={t(lang, 'collection.filterRarity', { rarity: row.rarity })}
                          className={`rarity-row rar-${row.rarity.toLowerCase()}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            setBinderView(s.id)
                            setBinderRarity(row.rarity)
                            setQ('')
                            setBinderOwnedOnly(false)
                            setBinderMissing(false)
                          }}
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter' && e.key !== ' ') return
                            e.preventDefault()
                            e.stopPropagation()
                            setBinderView(s.id)
                            setBinderRarity(row.rarity)
                            setQ('')
                            setBinderOwnedOnly(false)
                            setBinderMissing(false)
                          }}
                        >
                          <span className="rarity-label">{row.rarity}</span>
                          <div className="rarity-track"><span style={{ width: `${pct}%` }} /></div>
                          <span className="rarity-count">{row.owned} / {row.total}</span>
                        </div>
                      )
                    })}
                  </div>
                </button>
              ))}
              <button type="button" className="binder-tile binder-tile-owned" onClick={() => { setBinderView('owned'); setBinderRarity(null); setQ(''); setBinderOwnedOnly(false); setBinderMissing(false) }}>
                <div className="binder-code">ALL</div>
                <div className="binder-name">{t(lang, 'collection.allOwned')}</div>
                <div className="binder-progress">{totals.unique} Unique | {totals.copies} {t(lang, 'bulk.copies')}</div>
                <p className="help" style={{ margin: '8px 0 0' }}>{t(lang, 'collection.allOwnedHelp')}</p>
              </button>
            </div>
          </>
        )}

        {tab === 'collection' && binderView != null && (
          <>
            <div className="toolbar binder-toolbar">
              <button className="btn" onClick={() => { setBinderView(null); setBinderRarity(null) }}>{t(lang, 'collection.back')}</button>
              <div className="grow">
                <div className="section-title">
                  {binderView === 'owned'
                    ? t(lang, 'collection.allOwned')
                    : `${activeBinderProgress?.id || binderView} - ${activeBinderProgress?.name || sets[binderView] || binderView}`}
                </div>
                {activeBinderProgress && (
                  <div className="sub">{activeBinderProgress.owned}/{activeBinderProgress.total} ({activeBinderProgress.pct}%)</div>
                )}
                {binderView && binderView !== 'owned' && (rarityBySet[binderView] || []).length > 0 && (
                  <div className="rarity-block rarity-block-inline">
                    <div className="rarity-heading">{t(lang, 'collection.byRarity')}</div>
                    {(rarityBySet[binderView] || []).map((row) => {
                      const pct = row.total ? Math.round((row.owned / row.total) * 100) : 0
                      const active = binderRarity === row.rarity
                      return (
                        <div
                          key={row.rarity}
                          role="button"
                          tabIndex={0}
                          title={active ? t(lang, 'collection.clearFilter') : t(lang, 'collection.filterRarity', { rarity: row.rarity })}
                          className={`rarity-row rar-${row.rarity.toLowerCase()}${active ? ' active' : ''}`}
                          onClick={() => setBinderRarity((cur) => (cur === row.rarity ? null : row.rarity))}
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter' && e.key !== ' ') return
                            e.preventDefault()
                            setBinderRarity((cur) => (cur === row.rarity ? null : row.rarity))
                          }}
                        >
                          <span className="rarity-label">{row.rarity}</span>
                          <div className="rarity-track"><span style={{ width: `${pct}%` }} /></div>
                          <span className="rarity-count">{row.owned} / {row.total}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
                {binderView === 'owned' && (
                  <div className="sub">{totals.unique} Unique | {totals.copies} {t(lang, 'bulk.copies')}</div>
                )}
              </div>
              <input
                className="search grow"
                placeholder={t(lang, 'collection.search')}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <button
                type="button"
                className={`chip ${binderOwnedOnly ? 'active' : ''}`}
                onClick={() => { setBinderOwnedOnly((v) => !v); if (!binderOwnedOnly) setBinderMissing(false) }}
              >
                {t(lang, 'collection.ownedOnly')}
              </button>
              {binderView !== 'owned' && (
                <button
                  type="button"
                  className={`chip ${binderMissing ? 'active' : ''}`}
                  onClick={() => { setBinderMissing((v) => !v); if (!binderMissing) setBinderOwnedOnly(false) }}
                >
                  {t(lang, 'collection.missing')}
                </button>
              )}
              <div className="domain-row" role="group" aria-label="Domain filter">
                {DOMAINS.map((d) => {
                  const active = domainFilter === d
                  return (
                    <button
                      key={d}
                      type="button"
                      className={`domain-btn${active ? ' active' : ''}`}
                      title={active ? t(lang, 'collection.domainClear', { domain: d }) : t(lang, 'collection.domainTitle', { domain: d })}
                      aria-pressed={active}
                      onClick={() => setDomainFilter((cur) => (cur === d ? null : d))}
                    >
                      <img src={DOMAIN_ICON[d]} alt={d} draggable={false} />
                    </button>
                  )
                })}
              </div>
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
                  ? t(lang, 'collection.emptyNone')
                  : t(lang, 'collection.emptyFilter')}
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
                        title={t(lang, 'price.openCm')}
                        disabled={!priceBook?.cards[c.id]?.cmUrl}
                        onClick={() => openCm(priceBook?.cards[c.id])}
                      >{displayName(c)}</button>
                      <div className="sub">{c.code} | {c.set} | {(c.types || []).join('/') || '-'} | {(c.domains || []).join('/') || '-'}</div>
                      {(() => {
                        const pl = priceLabel(priceBook?.cards[c.id])
                        if (!pl || (!pl.low && !pl.avg30 && !pl.high && !pl.foil)) return null
                        return (
                          <div className="price">
                            {pl.low ? <span title={t(lang, 'price.low')}>ab {pl.low}</span> : <span className="na">ab --</span>}
                            {pl.high ? <span className="high" title={t(lang, 'price.high')}>max {pl.high}</span> : null}
                            {pl.avg30 ? <span className="avg30" title={t(lang, 'price.avg30')}>Ø30 {pl.avg30}</span> : null}
                            {pl.foil ? <span className="foil" title={t(lang, 'price.foil')}>F {pl.foil}</span> : null}
                          </div>
                        )
                      })()}
                      <div className="row">
                        <div className="qty" title={t(lang, 'qty.normal')}>
                          <button onClick={() => bump(c.id, 'qty', -1)}>-</button>
                          <b className={o.qty > 0 ? 'ok' : 'muted'}>{o.qty}</b>
                          <button onClick={() => bump(c.id, 'qty', 1)}>+</button>
                        </div>
                        <div className="qty" title={t(lang, 'qty.foil')}>
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
                placeholder={t(lang, 'collection.search')}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <select className="select" style={{ maxWidth: 180 }} value={setFilter} onChange={(e) => setSetFilter(e.target.value)}>
                <option value="">{t(lang, 'catalog.allSets')}</option>
                {Object.entries(sets).map(([id, name]) => (
                  <option key={id} value={id}>{id} - {name}</option>
                ))}
              </select>
              <select className="select" style={{ maxWidth: 150 }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="">{t(lang, 'catalog.allTypes')}</option>
                {allTypes.map((ty) => (
                  <option key={ty} value={ty}>{ty}</option>
                ))}
              </select>
              <div className="domain-row" role="group" aria-label="Domain filter">
                {DOMAINS.map((d) => {
                  const active = domainFilter === d
                  return (
                    <button
                      key={d}
                      type="button"
                      className={`domain-btn${active ? ' active' : ''}`}
                      title={active ? t(lang, 'collection.domainClear', { domain: d }) : t(lang, 'collection.domainTitle', { domain: d })}
                      aria-pressed={active}
                      onClick={() => setDomainFilter((cur) => (cur === d ? null : d))}
                    >
                      <img src={DOMAIN_ICON[d]} alt={d} draggable={false} />
                    </button>
                  )
                })}
              </div>
              <label className="pill">
                <input type="checkbox" checked={signedOnly} onChange={(e) => setSignedOnly(e.target.checked)} /> Signed
              </label>
              <label className="pill">
                <input type="checkbox" checked={overOnly} onChange={(e) => setOverOnly(e.target.checked)} /> Overnumbered
              </label>
              <label className="pill">
                <input type="checkbox" checked={ownedOnly} onChange={(e) => setOwnedOnly(e.target.checked)} /> {t(lang, 'catalog.ownedOnly')}
              </label>
              <button className="btn" onClick={exportCsv}>{t(lang, 'catalog.csvExport')}</button>
              <label className="btn">
                {t(lang, 'catalog.csvImport')}
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
                        title={t(lang, 'price.openCm')}
                        disabled={!priceBook?.cards[c.id]?.cmUrl}
                        onClick={() => openCm(priceBook?.cards[c.id])}
                      >{displayName(c)}</button>
                      <div className="sub">{c.code} | {c.set} | {(c.types || []).join('/') || '-'} | {(c.domains || []).join('/') || '-'}</div>
                      {(() => {
                        const pl = priceLabel(priceBook?.cards[c.id])
                        if (!pl || (!pl.low && !pl.avg30 && !pl.high && !pl.foil)) return null
                        return (
                          <div className="price">
                            {pl.low ? <span title={t(lang, 'price.low')}>ab {pl.low}</span> : <span className="na">ab --</span>}
                            {pl.high ? <span className="high" title={t(lang, 'price.high')}>max {pl.high}</span> : null}
                            {pl.avg30 ? <span className="avg30" title={t(lang, 'price.avg30')}>Ø30 {pl.avg30}</span> : null}
                            {pl.foil ? <span className="foil" title={t(lang, 'price.foil')}>F {pl.foil}</span> : null}
                          </div>
                        )
                      })()}
                      <div className="row">
                        <div className="qty" title={t(lang, 'qty.normal')}>
                          <button onClick={() => bump(c.id, 'qty', -1)}>-</button>
                          <b>{o.qty}</b>
                          <button onClick={() => bump(c.id, 'qty', 1)}>+</button>
                        </div>
                        <div className="qty" title={t(lang, 'qty.foil')}>
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

        {tab === 'sales' && (
          <div className="split deck-split">
            <section className="panel">
              <div className="toolbar">
                <div className="grow">
                  <h2 className="section-title" style={{ margin: 0 }}>{t(lang, 'sales.cart')}</h2>
                  <p className="help" style={{ margin: '4px 0 0' }}>{t(lang, 'sales.help')}{saleSelectedCount > 0 ? t(lang, 'sales.selected', { cards: saleSelectedCount, copies: saleSelectedCopies, cardWord: cardWord(lang, saleSelectedCount), copyWord: copyWord(lang, saleSelectedCopies) }) : ''}</p>
                </div>
                <button
                  className="btn primary"
                  disabled={saleSelectedCount === 0}
                  onClick={confirmSale}
                  title={saleSelectedCount === 0 ? t(lang, 'sales.pickFirst') : undefined}
                >
                  {t(lang, 'sales.markSold')}{saleSelectedCount > 0 ? ` (${saleSelectedCount})` : ''}
                </button>
              </div>
              {saleReport && <p className="help">{saleReport}</p>}
              <div
                className={saleCartDropClass()}
                style={{ maxHeight: '62vh', overflow: 'auto' }}
                onDragOver={onSaleCartDragOver}
                onDragLeave={onSaleCartDragLeave}
                onDrop={onSaleCartDrop}
              >
                {Object.keys(saleList).length === 0 && (
                  <div className="empty">{t(lang, 'sales.emptyCart')}</div>
                )}
                {Object.entries(saleList).map(([id, qty]) => {
                  const c = byId.get(id)
                  if (!c) return null
                  const have = ownedQty(collection[id])
                  return (
                    <div
                      key={id}
                      className="list-item deck-card-row"
                      onMouseEnter={(e) => showCardPreview(e, c.image)}
                      onMouseMove={(e) => showCardPreview(e, c.image)}
                      onMouseLeave={hideCardPreview}
                    >
                      <label className="sale-check" onClick={(e) => e.stopPropagation()} title={t(lang, 'sales.selectForSale')}>
                        <input
                          type="checkbox"
                          checked={!!saleSelected[id]}
                          onChange={() => toggleSaleSelected(id)}
                        />
                      </label>
                      {c.image ? (
                        <img
                          className="deck-thumb"
                          src={c.image}
                          alt=""
                          loading="lazy"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
                        />
                      ) : (
                        <div className="deck-thumb deck-thumb-empty" aria-hidden />
                      )}
                      <div className="grow">
                        <div className="name">{displayName(c)}</div>
                        <div className="sub">{c.code} · {t(lang, 'decks.owns', { have })}</div>
                      </div>
                      <div className="qty" onClick={(e) => e.stopPropagation()}>
                        <button type="button" onClick={() => bumpSale(id, -1)}>−</button>
                        <input
                          className="field"
                          style={{ width: 48, textAlign: 'center', padding: '4px 6px' }}
                          value={qty}
                          onChange={(e) => setSaleQty(id, Number(e.target.value))}
                        />
                        <button type="button" onClick={() => bumpSale(id, 1)} disabled={qty >= have}>+</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
            <section className="panel">
              <h2 style={{ marginTop: 0 }}>{t(lang, 'sales.addTitle')}</h2>
              <p className="help">{t(lang, 'sales.addHelp')}</p>
              <input
                className="field"
                placeholder={t(lang, 'sales.searchOwned')}
                value={saleQ}
                onChange={(e) => setSaleQ(e.target.value)}
                style={{ marginBottom: 10 }}
              />
              <div className="list" style={{ maxHeight: '36vh', overflow: 'auto', marginBottom: 14 }}>
                {ownedCards.filter((c) => {
                  const query = saleQ.trim().toLowerCase()
                  if (!query) return true
                  return (
                    c.name.toLowerCase().includes(query) ||
                    (c.subtitle || '').toLowerCase().includes(query) ||
                    c.code.toLowerCase().includes(query) ||
                    displayName(c).toLowerCase().includes(query)
                  )
                }).slice(0, 80).map((c) => {
                  const have = ownedQty(collection[c.id])
                  const room = saleRemaining(c.id)
                  return (
                    <div
                      key={c.id}
                      className="list-item picker-card"
                      draggable={room > 0}
                      onDragStart={(e) => onPickerDragStart(e, c.id)}
                      onDragEnd={onPickerDragEnd}
                      onMouseEnter={(e) => showCardPreview(e, c.image)}
                      onMouseMove={(e) => showCardPreview(e, c.image)}
                      onMouseLeave={hideCardPreview}
                    >
                      {c.image ? (
                        <img
                          className="deck-thumb"
                          src={c.image}
                          alt=""
                          loading="lazy"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
                        />
                      ) : (
                        <div className="deck-thumb deck-thumb-empty" aria-hidden />
                      )}
                      <div className="grow">
                        <button
                          type="button"
                          className="name name-link"
                          title={t(lang, 'price.openCm')}
                          disabled={!priceBook?.cards[c.id]?.cmUrl}
                          onClick={(e) => { e.stopPropagation(); openCm(priceBook?.cards[c.id]) }}
                        >{displayName(c)}</button>
                        <div className="sub">{c.code} · x{have}{room < have ? t(lang, 'sales.inCart', { n: have - room }) : ''}</div>
                        {(() => {
                          const pl = priceLabel(priceBook?.cards[c.id])
                          if (!pl || (!pl.low && !pl.avg30 && !pl.high && !pl.foil)) return null
                          return (
                            <div className="price">
                              {pl.low ? <span title={t(lang, 'price.low')}>ab {pl.low}</span> : <span className="na">ab --</span>}
                              {pl.avg30 ? <span className="avg30" title={t(lang, 'price.avg30')}>Ø30 {pl.avg30}</span> : null}
                              {pl.foil ? <span className="foil" title={t(lang, 'price.foil')}>F {pl.foil}</span> : null}
                            </div>
                          )
                        })()}
                      </div>
                      <button className="btn small primary" disabled={room <= 0} onClick={() => addToSale(c.id, 1)}>
                        +
                      </button>
                    </div>
                  )
                })}
                {ownedCards.length === 0 && (
                  <div className="empty">{t(lang, 'sales.noOwned')}</div>
                )}
                {ownedCards.length > 0 && ownedCards.filter((c) => {
                  const query = saleQ.trim().toLowerCase()
                  if (!query) return true
                  return (
                    c.name.toLowerCase().includes(query) ||
                    (c.subtitle || '').toLowerCase().includes(query) ||
                    c.code.toLowerCase().includes(query) ||
                    displayName(c).toLowerCase().includes(query)
                  )
                }).length === 0 && (
                  <div className="empty">{t(lang, 'sales.noHits', { q: saleQ.trim() })}</div>
                )}
              </div>
              <h3 style={{ margin: '0 0 6px', fontSize: 14 }}>{t(lang, 'sales.pasteTitle')}</h3>
              <p className="help">Zeilen wie <code>2 Card Name</code> oder Codes (<code>OGN-056</code>). Nur owned.</p>
              <textarea
                className="field"
                rows={5}
                value={salePaste}
                onChange={(e) => setSalePaste(e.target.value)}
                placeholder={'2 Traveling Merchant\nOGN-056/298\n1 Kennen, Heart of the Tempest'}
              />
              <div className="toolbar" style={{ marginTop: 10 }}>
                <button className="btn primary" disabled={!salePaste.trim()} onClick={applySalePaste}>
                  {t(lang, 'sales.toCart')}
                </button>
                <button className="btn" disabled={!salePaste.trim()} onClick={() => setSalePaste('')}>
                  {t(lang, 'sales.clear')}
                </button>
              </div>
            </section>
          </div>
        )}

                {tab === 'bulk' && (
          <div className="split">
            <section className="panel">
              <h2>{t(lang, 'bulk.title')}</h2>
              <p className="help">
                {t(lang, 'bulk.help', { ex1: 'OGN-056/298', ex2: 'OGN-56', ex3: 'UNL 131', ex4: 'OGN-066a' })}
              </p>
              <textarea
                className="field"
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={'OGN-001/298\nOGN-056/298\nSFD-12\nUNL 131'}
              />
              <div className="toolbar" style={{ marginTop: 10 }}>
                <label className="pill">
                  <input type="checkbox" checked={bulkFoil} onChange={(e) => setBulkFoil(e.target.checked)} /> {t(lang, 'bulk.asFoil')}
                </label>
                <button className="btn primary" onClick={() => applyBulk('add')}>{t(lang, 'bulk.add1')}</button>
                <button className="btn" onClick={() => applyBulk('set')}>{t(lang, 'bulk.set1')}</button>
                <button className="btn danger" onClick={() => applyBulk('remove')}>{t(lang, 'bulk.rem1')}</button>
              </div>
              {bulkReport && <p className="help">{bulkReport}</p>}
            </section>
            <section className="panel">
              <h2>{t(lang, 'bulk.overview')}</h2>
              <p className="help">{t(lang, 'bulk.overviewHelp')}</p>
              <div className="list">
                <div className="list-item"><span>{t(lang, 'bulk.unique')}</span><b>{totals.unique}</b></div>
                <div className="list-item"><span>{t(lang, 'bulk.copies')}</span><b>{totals.copies}</b></div>
                <div className="list-item"><span>{t(lang, 'bulk.catalog')}</span><b>{totals.catalog}</b></div>
                {collectionValue && (
                  <div className="list-item"><span>{t(lang, 'bulk.value')}</span><b>~{collectionValue.sum.toFixed(2)}</b></div>
                )}
              </div>
            </section>
          </div>
        )}

        {tab === 'decks' && (
          <div className="split deck-split">
            <section className="panel">
              <div className="toolbar">
                <h2 style={{ margin: 0, flex: 1 }}>{t(lang, 'decks.title')}</h2>
                <button className="btn" onClick={() => { setDeckImportOpen((v) => !v); setDeckImportText('') }}>{t(lang, 'decks.import')}</button>
                <button className="btn primary" onClick={newDeck}>{t(lang, 'decks.new')}</button>
              </div>
              <div className="deck-accordion" style={{ marginBottom: 12 }}>
                {decks.length === 0 && <div className="empty">{t(lang, 'decks.empty')}</div>}
                {decks.map((d) => {
                  const expanded = d.id === activeDeckId
                  const sums = expanded ? deckPriceSums(d) : null
                  const under = expanded ? underOwnedLines(d) : []
                  const missCopies = under.reduce((acc, x) => acc + x.short, 0)
                  return (
                    <div key={d.id} className={`deck-acc-item${expanded ? ' expanded' : ''}${expanded ? ' active' : ''}`}>
                      <div
                        className="deck-acc-head"
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setActiveDeckId(d.id)
                          setDeckMissingReport(missingReportFor(d))
                          if (!expanded) setActiveSection('main')
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setActiveDeckId(d.id)
                            setDeckMissingReport(missingReportFor(d))
                            if (!expanded) setActiveSection('main')
                          }
                        }}
                      >
                        <span className="deck-acc-chevron" aria-hidden>{expanded ? '▾' : '▸'}</span>
                        <div className="grow deck-acc-title">
                          {expanded ? (
                            <input
                              className="field deck-acc-name-input"
                              value={d.name}
                              onChange={(e) => updateDeck((deck) => ({ ...deck, name: e.target.value }))}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                              aria-label={t(lang, 'decks.rename')}
                            />
                          ) : (
                            <span className="name">{d.name}</span>
                          )}
                          <span className="deck-acc-count">· {deckCount(d)} Karten</span>
                        </div>
                        {expanded && <span className="pill ok">{t(lang, 'decks.active')}</span>}
                      </div>
                      {expanded && (
                        <div className="deck-acc-body">
                          <div className="deck-acc-actions">
                            <button
                              type="button"
                              className="btn icon danger deck-trash"
                              title={t(lang, 'decks.delete')}
                              aria-label={t(lang, 'decks.delete')}
                              onClick={(e) => {
                                e.stopPropagation()
                                setDecks((prev) => prev.filter((x) => x.id !== d.id))
                                setActiveDeckId(null)
                                setDeckMissingReport(null)
                              }}
                            >
                              🗑
                            </button>
                          </div>
                          {sums && (
                            <div className="deck-price-sums help">
                              <div>
                                <b>{t(lang, 'decks.totalLow')}</b>{' '}
                                {sums.priced > 0 ? fmtEur(sums.deckLow) : '—'}
                                {sums.priced > 0 && sums.priced < deckCount(d) ? t(lang, 'decks.partialPrice') : ''}
                              </div>
                              {missCopies > 0 && (
                                <div>
                                  <b>{t(lang, 'decks.missingCopies')}</b>{' '}
                                  {sums.missingPriced > 0 ? fmtEur(sums.missingLow) : '—'}
                                  {` (${missCopies} ${t(lang, 'bulk.copies')})`}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {activeDeck && (
                <>
                  {deckImportOpen && (
                    <div className="deck-import-box">
                      <textarea
                        className="field"
                        placeholder={"Legend:\n1 Kennen, Heart of the Tempest\nChampion:\n1 Kennen, Storm of Shuriken\nMainDeck:\n3 Traveling Merchant\n..."}
                        value={deckImportText}
                        onChange={(e) => setDeckImportText(e.target.value)}
                        rows={10}
                      />
                      <div className="toolbar" style={{ marginBottom: 0 }}>
                        <button className="btn primary" disabled={!deckImportText.trim()} onClick={() => runDeckImport(deckImportText)}>{t(lang, 'decks.importBtn')}</button>
                      </div>
                    </div>
                  )}

                  {(() => {
                    const under = underOwnedLines(activeDeck)
                    if (!under.length) return null
                    const totalShort = under.reduce((s, x) => s + x.short, 0)
                    return (
                      <div className="deck-warn">
                        <div>
                          <b>{t(lang, 'decks.missingInCollection')}</b>{' '}
                          {under.length} {cardWord(lang, under.length)} ({totalShort} {copyWord(lang, totalShort)})
                        </div>
                        <ul>
                          {under.slice(0, 12).map((u) => (
                            <li key={u.id}>
                              {t(lang, 'decks.needHaveLine', { name: u.name, need: u.need, have: u.have })}
                            </li>
                          ))}
                          {under.length > 12 && <li>{t(lang, 'decks.andMore', { n: under.length - 12 })}</li>}
                        </ul>
                      </div>
                    )
                  })()}

                  {deckMissingReport && deckMissingReport.length > 0 && (
                    <div className="deck-missing">
                      <b>{t(lang, 'decks.importMissing')}</b>
                      <div className="sub">
                        {t(lang, 'decks.missingCopiesCount', { n: deckMissingReport.filter((r) => r.short > 0).reduce((s, r) => s + r.short, 0) })}
                        {deckMissingReport.some((r) => r.need === 0) ? t(lang, 'decks.namesNotFound') : ''}
                      </div>
                      <ul>
                        {deckMissingReport.slice(0, 16).map((r, i) => (
                          <li key={i}>
                            {r.need === 0 ? r.name : t(lang, 'decks.needHaveLine', { name: r.name, need: r.need, have: r.have })}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {deckNotice && (
                    <div className="deck-notice" role="status">
                      <span>{deckNotice}</span>
                      <button type="button" className="btn small" onClick={() => setDeckNotice(null)}>OK</button>
                    </div>
                  )}

                  {isLegendSwapState(activeDeck.cards) && (() => {
                    const req = requiredDomainsFromDeck(activeDeck.cards, byId)
                    return (
                      <div className="deck-legend-swap" role="status">
                        <b>{t(lang, 'decks.legendRemoved')}</b>
                        {' — '}
                        {req.length > 0
                          ? <>{t(lang, 'decks.legendCover', { domains: req.join(', ') })}</>
                          : <>{t(lang, 'decks.legendAny')}</>}
                        {t(lang, 'decks.legendGateExtra')}
                      </div>
                    )
                  })()}

                  <div className="deck-sections">
                    <div className="deck-sec-row">
                      {(['legend', 'champion'] as DeckSection[]).map((sec) => {
                        const count = sectionCount(activeDeck.cards, sec)
                        const cap = SECTION_CAPS[sec]
                        const over = count > cap
                        const atCap = count >= cap
                        const locked = sectionNeedsLegend(sec) && !hasLegend(activeDeck.cards)
                        const cardsIn = activeDeck.cards.filter((dc) => sectionOf(dc) === sec)
                        return (
                          <div
                            key={sec}
                            className={sectionDropClass(sec, locked, atCap)}
                            onClick={() => setActiveSection(sec)}
                            onDragOver={(e) => onSectionDragOver(e, sec)}
                            onDragLeave={(e) => onSectionDragLeave(e, sec)}
                            onDrop={(e) => onSectionDrop(e, sec)}
                          >
                            <div className="deck-sec-head">
                              <span className="deck-sec-title">{SECTION_LABEL[sec]}</span>
                              <span className={`deck-sec-cap${over ? ' over' : ''}`}>{count}/{cap}</span>
                            </div>
                            <div className="list">
                              {cardsIn.map((dc) => {
                                const c = byId.get(dc.id)
                                if (!c) return null
                                const have = ownedQty(collection[c.id])
                                const short = dc.qty > have
                                return (
                                                                    <div
                                    key={`${dc.id}-${sec}`}
                                    className={`list-item deck-card-row${short ? ' short' : ''}`}
                                    onMouseEnter={(e) => showCardPreview(e, c.image)}
                                    onMouseMove={(e) => showCardPreview(e, c.image)}
                                    onMouseLeave={hideCardPreview}
                                  >
                                    {c.image ? (
                                      <img
                                        className="deck-thumb"
                                        src={c.image}
                                        alt=""
                                        loading="lazy"
                                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
                                      />
                                    ) : (
                                      <div className="deck-thumb deck-thumb-empty" aria-hidden />
                                    )}
                                    <div className="grow">
                                      <button
                                        type="button"
                                        className="name name-link"
                                        title={t(lang, 'price.openCm')}
                                        disabled={!priceBook?.cards[c.id]?.cmUrl}
                                        onClick={(e) => { e.stopPropagation(); openCm(priceBook?.cards[c.id]) }}
                                      >{displayName(c)}</button>
                                      <div className="sub">
                                        {c.energy != null ? `E${c.energy} · ` : ''}{c.code} · {t(lang, 'decks.owns', { have })}
                                      </div>
                                      {(() => {
                                        const pl = priceLabel(priceBook?.cards[c.id])
                                        if (!pl || (!pl.low && !pl.avg30 && !pl.high && !pl.foil)) return null
                                        return (
                                          <div className="price">
                                            {pl.low ? <span title={t(lang, 'price.low')}>ab {pl.low}</span> : <span className="na">ab --</span>}
                                            {pl.avg30 ? <span className="avg30" title={t(lang, 'price.avg30')}>Ø30 {pl.avg30}</span> : null}
                                            {pl.foil ? <span className="foil" title={t(lang, 'price.foil')}>F {pl.foil}</span> : null}
                                          </div>
                                        )
                                      })()}
                                    </div>
                                    {isSingleSlotSection(sec) ? (
                                      <button
                                        type="button"
                                        className="btn icon danger deck-trash deck-card-trash"
                                        title={t(lang, 'decks.removeSection', { section: SECTION_LABEL[sec] })}
                                        aria-label={t(lang, 'decks.removeSection', { section: SECTION_LABEL[sec] })}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          removeDeckCard(dc.id, sec)
                                        }}
                                      >
                                        🗑
                                      </button>
                                    ) : (
                                      <div className="qty" onClick={(e) => e.stopPropagation()}>
                                        <button type="button" onClick={() => bumpDeckCard(dc.id, sec, -1)}>−</button>
                                        <b>{dc.qty}</b>
                                        <button type="button" disabled={atCap || locked} title={locked ? t(lang, 'decks.legendLocked') : atCap ? t(lang, 'decks.limit', { cap }) : undefined} onClick={() => bumpDeckCard(dc.id, sec, 1)}>+</button>
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                            {!(isSingleSlotSection(sec) && atCap) && (
                              <button
                                type="button"
                                className="deck-add"
                                disabled={locked || atCap}
                                title={locked ? t(lang, 'decks.legendLocked') : atCap ? t(lang, 'decks.limitReached', { cap }) : undefined}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (locked) {
                                    setDeckNotice(t(lang, 'decks.legendLocked'))
                                    setActiveSection('legend')
                                    return
                                  }
                                  setActiveSection(sec)
                                }}
                              >
                                {locked ? t(lang, 'decks.legendLocked') : SECTION_ADD_LABEL[sec]}
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {SECTION_ORDER.filter((s) => s !== 'legend' && s !== 'champion').map((sec) => {
                      const count = sectionCount(activeDeck.cards, sec)
                      const cap = SECTION_CAPS[sec]
                      const over = count > cap
                      const atCap = count >= cap
                      const locked = sectionNeedsLegend(sec) && !hasLegend(activeDeck.cards)
                      const cardsIn = activeDeck.cards.filter((dc) => sectionOf(dc) === sec)
                      return (
                        <div
                          key={sec}
                          className={sectionDropClass(sec, locked, atCap)}
                          onClick={() => setActiveSection(sec)}
                          onDragOver={(e) => onSectionDragOver(e, sec)}
                          onDragLeave={(e) => onSectionDragLeave(e, sec)}
                          onDrop={(e) => onSectionDrop(e, sec)}
                        >
                          <div className="deck-sec-head">
                            <span className="deck-sec-title">{SECTION_LABEL[sec]}</span>
                            <span className={`deck-sec-cap${over ? ' over' : ''}`}>{count}/{cap}</span>
                          </div>
                          <div className="list">
                            {cardsIn.map((dc) => {
                              const c = byId.get(dc.id)
                              if (!c) return null
                              const have = ownedQty(collection[c.id])
                              const short = dc.qty > have
                              return (
                                                                <div
                                  key={`${dc.id}-${sec}`}
                                  className={`list-item deck-card-row${short ? ' short' : ''}`}
                                  onMouseEnter={(e) => showCardPreview(e, c.image)}
                                  onMouseMove={(e) => showCardPreview(e, c.image)}
                                  onMouseLeave={hideCardPreview}
                                >
                                  {c.image ? (
                                    <img
                                      className="deck-thumb"
                                      src={c.image}
                                      alt=""
                                      loading="lazy"
                                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
                                    />
                                  ) : (
                                    <div className="deck-thumb deck-thumb-empty" aria-hidden />
                                  )}
                                  <div className="grow">
                                    <button
                                      type="button"
                                      className="name name-link"
                                      title={t(lang, 'price.openCm')}
                                      disabled={!priceBook?.cards[c.id]?.cmUrl}
                                      onClick={(e) => { e.stopPropagation(); openCm(priceBook?.cards[c.id]) }}
                                    >{displayName(c)}</button>
                                    <div className="sub">
                                      {c.energy != null ? `E${c.energy} · ` : ''}{c.code} · {t(lang, 'decks.owns', { have })}
                                    </div>
                                    {(() => {
                                      const pl = priceLabel(priceBook?.cards[c.id])
                                      if (!pl || (!pl.low && !pl.avg30 && !pl.high && !pl.foil)) return null
                                      return (
                                        <div className="price">
                                          {pl.low ? <span title={t(lang, 'price.low')}>ab {pl.low}</span> : <span className="na">ab --</span>}
                                          {pl.avg30 ? <span className="avg30" title={t(lang, 'price.avg30')}>Ø30 {pl.avg30}</span> : null}
                                          {pl.foil ? <span className="foil" title={t(lang, 'price.foil')}>F {pl.foil}</span> : null}
                                        </div>
                                      )
                                    })()}
                                  </div>
                                  <div className="qty" onClick={(e) => e.stopPropagation()}>
                                    <button type="button" onClick={() => bumpDeckCard(dc.id, sec, -1)}>−</button>
                                    <b>{dc.qty}</b>
                                    <button type="button" disabled={atCap || locked} title={locked ? t(lang, 'decks.legendLocked') : atCap ? t(lang, 'decks.limit', { cap }) : undefined} onClick={() => bumpDeckCard(dc.id, sec, 1)}>+</button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                          <button
                            type="button"
                            className="deck-add"
                            disabled={locked || atCap}
                            title={locked ? t(lang, 'decks.legendLocked') : atCap ? t(lang, 'decks.limitReached', { cap }) : undefined}
                            onClick={(e) => {
                              e.stopPropagation()
                              if (locked) {
                                setDeckNotice(t(lang, 'decks.legendLocked'))
                                setActiveSection('legend')
                                return
                              }
                              setActiveSection(sec)
                            }}
                          >
                            {locked ? t(lang, 'decks.legendLocked') : SECTION_ADD_LABEL[sec]}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </section>

            <section className="panel">
              <h2>{t(lang, 'decks.cardsTitle', { section: SECTION_LABEL[activeSection] })}</h2>
              <div className="toolbar">
                <input className="search grow" placeholder={t(lang, 'decks.search')} value={q} onChange={(e) => setQ(e.target.value)} />
                <label className="pill">
                  <input type="checkbox" checked={deckOwnedOnly} onChange={(e) => setDeckOwnedOnly(e.target.checked)} /> {t(lang, 'catalog.ownedOnly')}
                </label>
              </div>
              <div className="list" style={{ maxHeight: '70vh', overflow: 'auto' }}>
                {!activeDeck && <div className="empty">{t(lang, 'decks.pickFirst')}</div>}
                {activeDeck && sectionNeedsLegend(activeSection) && !hasLegend(activeDeck.cards) && (
                  <div className="empty deck-gate">{t(lang, 'decks.legendLocked')}</div>
                )}
                {activeDeck && !(sectionNeedsLegend(activeSection) && !hasLegend(activeDeck.cards)) && cards
                  .filter((c) => {
                    if (!cardFitsSection(c, activeSection)) return false
                    if (deckOwnedOnly && ownedQty(collection[c.id]) <= 0) return false
                    if (sectionNeedsLegend(activeSection)) {
                      const domains = getLegendDomains(activeDeck.cards, byId)
                      if (domains && !cardMatchesLegendDomains(c, domains)) return false
                    }
                    if (activeSection === 'legend') {
                      const required = requiredDomainsFromDeck(activeDeck.cards, byId)
                      if (!legendCoversRequiredDomains(c, required)) return false
                    }
                    const query = q.trim().toLowerCase()
                    if (!query) return true
                    return (
                      c.name.toLowerCase().includes(query) ||
                      (c.subtitle || '').toLowerCase().includes(query) ||
                      c.code.toLowerCase().includes(query)
                    )
                  })
                  .slice(0, 100)
                  .map((c) => (
                                        <div
                      key={c.id}
                      className="list-item picker-card"
                      draggable={!!activeDeck && !(sectionNeedsLegend(activeSection) && !hasLegend(activeDeck.cards)) && sectionCount(activeDeck.cards, activeSection) < SECTION_CAPS[activeSection]}
                      onDragStart={(e) => onPickerDragStart(e, c.id)}
                      onDragEnd={onPickerDragEnd}
                      onMouseEnter={(e) => showCardPreview(e, c.image)}
                      onMouseMove={(e) => showCardPreview(e, c.image)}
                      onMouseLeave={hideCardPreview}
                    >
                      {c.image ? (
                        <img
                          className="deck-thumb"
                          src={c.image}
                          alt=""
                          loading="lazy"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
                        />
                      ) : (
                        <div className="deck-thumb deck-thumb-empty" aria-hidden />
                      )}
                      <div className="grow">
                        <button
                          type="button"
                          className="name name-link"
                          title={t(lang, 'price.openCm')}
                          disabled={!priceBook?.cards[c.id]?.cmUrl}
                          onClick={(e) => { e.stopPropagation(); openCm(priceBook?.cards[c.id]) }}
                        >{displayName(c)}</button>
                        <div className="sub">{c.code} · x{ownedQty(collection[c.id])}{c.energy != null ? ` · E${c.energy}` : ''}</div>
                        {(() => {
                          const pl = priceLabel(priceBook?.cards[c.id])
                          if (!pl || (!pl.low && !pl.avg30 && !pl.high && !pl.foil)) return null
                          return (
                            <div className="price">
                              {pl.low ? <span title={t(lang, 'price.low')}>ab {pl.low}</span> : <span className="na">ab --</span>}
                              {pl.avg30 ? <span className="avg30" title={t(lang, 'price.avg30')}>Ø30 {pl.avg30}</span> : null}
                              {pl.foil ? <span className="foil" title={t(lang, 'price.foil')}>F {pl.foil}</span> : null}
                            </div>
                          )
                        })()}
                      </div>
                      <button
                        className="btn small primary"
                        disabled={
                          sectionCount(activeDeck.cards, activeSection) >= SECTION_CAPS[activeSection]
                          || (sectionNeedsLegend(activeSection) && !hasLegend(activeDeck.cards))
                        }
                        title={
                          sectionNeedsLegend(activeSection) && !hasLegend(activeDeck.cards)
                            ? t(lang, 'decks.legendLocked')
                            : sectionCount(activeDeck.cards, activeSection) >= SECTION_CAPS[activeSection]
                              ? t(lang, 'decks.limitReached', { cap: SECTION_CAPS[activeSection] })
                              : undefined
                        }
                        onClick={() => addToDeck(c.id, activeSection)}
                      >
                        Add
                      </button>
                    </div>
                  ))}
              </div>
            </section>
          </div>
        )}
      </main>
      {cardPreview && (
        <div
          className="card-float-preview"
          style={{ left: cardPreview.x, top: cardPreview.y }}
          aria-hidden
        >
          <img src={cardPreview.src} alt="" />
        </div>
      )}
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
