import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import type { BorrowedCard, BorrowedGroup, Card, Catalog, Deck, DeckSection, PriceBook, PriceEntry } from './types'
import { loadBorrowed, loadCollection, loadDecks, saveBorrowed, saveCollection, saveDecks, type Collection } from './storage'
import { loadLang, saveLang, t, type Lang } from './i18n'
import {
  detectKeywordsInText,
  keywordsForCard,
  setCardKeywordBook,
  type CardKeywordBook,
  type KeywordId,
} from './keywords'
import { ocrCardText } from './ocr'
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
import { banStatus, type BanStatus } from './banlist'
import { cardMatchesDomains, deckDropIndex, moveDeckTo } from './domainMatch.ts'
import {
  STORE_LOCATOR_URL,
  STORE_RADIUS_KM_DEFAULT,
  STORE_RADIUS_KM_MAX,
  STORE_RADIUS_KM_MIN,
  clampStoreRadiusKm,
  GERMANY_CENTER,
  geocodeQuery,
  mapsUrl,
  searchStoresInGermany,
  searchStoresNear,
  storeReportsStock,
  websiteUrl,
  type StoreHit,
} from './stores'
import { StoresMap, type MapCenter } from './StoresMap'
import {
  OPENING_HAND_SIZE,
  applyMulligan,
  dealOpeningHand,
  drawPoolSize,
  drawTopCard,
} from './handTester'

type Tab = 'collection' | 'catalog' | 'sales' | 'decks' | 'borrowed' | 'stores'

function uid() {
  return crypto.randomUUID()
}

function ownedQty(o?: { qty: number; foil: number }) {
  return (o?.qty || 0) + (o?.foil || 0)
}

/** Total lent copies of a card across all borrower groups. */
function borrowedQtyById(groups: BorrowedGroup[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const g of groups) {
    for (const c of g.cards) {
      m.set(c.id, (m.get(c.id) || 0) + c.qty)
    }
  }
  return m
}

/** Flatten deck-import result into a flat id+qty list (merge duplicates). */
function flattenImportCards(cards: { id: string; qty: number }[]): BorrowedCard[] {
  const m = new Map<string, number>()
  for (const c of cards) {
    m.set(c.id, (m.get(c.id) || 0) + c.qty)
  }
  return [...m.entries()].map(([id, qty]) => ({ id, qty }))
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



function BanBadge({ status, lang }: { status: BanStatus; lang: Lang }) {
  if (!status) return null
  const key = status === 'banned2v2' ? 'decks.banned2v2' : 'decks.banned'
  return (
    <span className={`ban-badge${status === 'banned2v2' ? ' ban-2v2' : ''}`}>
      {t(lang, key)}
    </span>
  )
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

function PriceBits({ entry, lang, showHigh = false }: { entry?: PriceEntry; lang: Lang; showHigh?: boolean }) {
  const pl = priceLabel(entry)
  if (!pl || (!pl.low && !pl.avg30 && !pl.high && !pl.foil)) return null
  return (
    <div className="price">
      {pl.low ? <span title={t(lang, 'price.low')}>ab {pl.low}</span> : <span className="na">ab --</span>}
      {showHigh && pl.high ? <span className="high" title={t(lang, 'price.high')}>max {pl.high}</span> : null}
      {pl.avg30 ? <span className="avg30" title={t(lang, 'price.avg30')}>Ø30 {pl.avg30}</span> : null}
      {pl.foil ? <span className="foil" title={t(lang, 'price.foil')}>F {pl.foil}</span> : null}
    </div>
  )
}

function ZoomMark({ title, onOpen, tiny }: { title: string; onOpen: () => void; tiny?: boolean }) {
  return (
    <button
      type="button"
      className={`art-zoom-btn${tiny ? ' tiny' : ''}`}
      title={title}
      aria-label={title}
      onClick={(e) => { e.stopPropagation(); onOpen() }}
    >
      <svg width={tiny ? 10 : 14} height={tiny ? 10 : 14} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M15 15l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M8 10h4M10 8v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </button>
  )
}

function DeckThumb({ src, onOpen, openTitle, zoomIcon }: { src?: string | null; onOpen?: () => void; openTitle?: string; zoomIcon?: boolean }) {
  const zoom = onOpen ? ' art-zoomable' : ''
  const open = onOpen
    ? {
        role: 'button' as const,
        title: openTitle,
        'aria-label': openTitle,
        onClick: (e: ReactMouseEvent) => { e.stopPropagation(); onOpen() },
      }
    : {}
  const node = src ? (
    <img
      className={`deck-thumb${zoom}`}
      src={src}
      alt=""
      loading="lazy"
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
      {...open}
    />
  ) : (
    <div className={`deck-thumb deck-thumb-empty${zoom}`} {...(onOpen ? open : { 'aria-hidden': true as const })} />
  )
  if (!onOpen || !zoomIcon || !openTitle) return node
  return (
    <span className="deck-thumb-wrap">
      {node}
      <ZoomMark title={openTitle} onOpen={onOpen} tiny />
    </span>
  )
}

/** Champion name printed on legend art, taken from the Cardmarket slug (Rengar-Pridestalker). */
function legendIdentityByName(cards: Card[], book: PriceBook | null) {
  const m = new Map<string, string>()
  if (!book) return m
  for (const c of cards) {
    if (!(c.types || []).includes('Legend')) continue
    const url = book.cards[c.id]?.cmUrl
    if (!url) continue
    const slug = decodeURIComponent(url.split('?')[0].split('/').pop() || '').toLowerCase().replace(/['’.]/g, '')
    const nameSlug = c.name.toLowerCase().replace(/['’.]/g, '').replace(/\s+/g, '-')
    const idx = slug.indexOf(nameSlug)
    if (idx <= 0) continue
    const prefix = slug.slice(0, idx).replace(/-+$/, '').replace(/-/g, ' ').trim()
    if (!prefix) continue
    const key = c.name.toLowerCase()
    const prev = m.get(key)
    if (!prev) m.set(key, prefix)
    else if (!prev.split(' ').includes(prefix) && prev !== prefix) m.set(key, `${prev} ${prefix}`)
  }
  return m
}

const RARITY_ORDER = ['Common', 'Uncommon', 'Rare', 'Epic', 'Showcase', 'Ultimate Rare'] as const

function raritySlug(rarity: string) {
  return 'rar-' + rarity.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

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
const SET_ART_IDS = new Set(['OGN', 'OGS', 'SFD', 'UNL', 'VEN', 'RAD'])

/** Fixed Sammlung binder tile order (no DnD). Unknown sets append after. */
const BINDER_SET_ORDER = [
  'OGS',
  'OGN',
  'OGN-NN',
  'SFD',
  'SFD-NN',
  'UNL',
  'UNL-NN',
  'VEN',
  'VEN-NN',
  'RAD',
] as const



function ownedLineEur(o: { qty?: number; foil?: number } | undefined, p?: PriceEntry | null) {
  if (!o || !p) return 0
  const qty = o.qty || 0
  const foil = o.foil || 0
  if (qty <= 0 && foil <= 0) return 0
  const unit = p.low != null ? p.low : p.trend
  const foilUnit = p.foilLow != null ? p.foilLow : p.foilTrend != null ? p.foilTrend : unit
  let add = 0
  if (qty > 0 && unit != null) add += qty * unit
  if (foil > 0 && foilUnit != null) add += foil * foilUnit
  return add
}

function openCm(p?: PriceEntry | null) {
  const url = p?.cmUrl
  if (!url) return
  if (window.riftbound?.openExternal) {
    void window.riftbound.openExternal(url)
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}


const RUNE_ICON: Record<string, string> = {
  Fury: publicAsset('domains/fury.png'),
  Calm: publicAsset('domains/calm.png'),
  Mind: publicAsset('domains/mind.png'),
  Body: publicAsset('domains/body.png'),
  Order: publicAsset('domains/order.png'),
  C: publicAsset('domains/chaos.png'),
}

/** Bracket shorthand from the rules bake → printed symbols. Unknown brackets stay text. */
function ruleSymbol(token: string, key: number): ReactNode {
  if (token === 'S') {
    return <img key={key} className="rb-sym rb-might" src={publicAsset('symbols/might.svg')} alt="" title="Might" />
  }
  if (token === 'A') {
    return <img key={key} className="rb-sym" src={publicAsset('symbols/wild.svg')} alt="" title="Any domain" />
  }
  if (token === 'T') {
    return <img key={key} className="rb-sym" src={publicAsset('symbols/exhaust.svg')} alt="" title="Exhaust" />
  }
  const rune = RUNE_ICON[token]
  if (rune) {
    const label = token === 'C' ? 'Chaos' : token
    return <img key={key} className="rb-sym rb-rune" src={rune} alt="" title={label} />
  }
  if (/^\d{1,2}$/.test(token)) {
    return <span key={key} className="rb-energy" title="Energy">{token}</span>
  }
  return null
}

function RulesText({ text }: { text: string }) {
  const parts: ReactNode[] = []
  const re = /\[([^\]]+)\]/g
  let last = 0
  let n = 0
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0
    if (i > last) parts.push(text.slice(last, i))
    const sym = ruleSymbol(m[1], n)
    n += 1
    parts.push(sym ?? m[0])
    last = i + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

function RarityMenu({
  lang,
  open,
  setOpen,
  signed,
  setSigned,
  over,
  setOver,
  promo,
  setPromo,
  ultimate,
  setUltimate,
  menuRef,
}: {
  lang: Lang
  open: boolean
  setOpen: (next: boolean | ((o: boolean) => boolean)) => void
  signed: boolean
  setSigned: (next: boolean | ((v: boolean) => boolean)) => void
  over: boolean
  setOver: (next: boolean | ((v: boolean) => boolean)) => void
  promo: boolean
  setPromo: (next: boolean | ((v: boolean) => boolean)) => void
  ultimate: boolean
  setUltimate: (next: boolean | ((v: boolean) => boolean)) => void
  menuRef: RefObject<HTMLDivElement | null>
}) {
  return (
    <div className={`lang-menu${open ? ' open' : ''}`} ref={menuRef}>
      <button
        type="button"
        className={`lang-trigger${open || signed || over || promo || ultimate ? ' open' : ''}`}
        title={t(lang, 'filter.rarity')}
        aria-label={t(lang, 'filter.rarity')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {t(lang, 'filter.rarity')}
        <svg className="lang-caret" width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="lang-dropdown" role="menu" aria-label={t(lang, 'filter.rarity')} style={{ left: 0, right: 'auto' }}>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={signed}
            className={`lang-option${signed ? ' active' : ''}`}
            onClick={() => setSigned((v) => !v)}
          >
            <input type="checkbox" className="lang-check" checked={signed} readOnly tabIndex={-1} />
            <span>{t(lang, 'filter.signed')}</span>
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={over}
            className={`lang-option${over ? ' active' : ''}`}
            onClick={() => setOver((v) => !v)}
          >
            <input type="checkbox" className="lang-check" checked={over} readOnly tabIndex={-1} />
            <span>{t(lang, 'filter.overnumbered')}</span>
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={promo}
            className={`lang-option${promo ? ' active' : ''}`}
            onClick={() => setPromo((v) => !v)}
          >
            <input type="checkbox" className="lang-check" checked={promo} readOnly tabIndex={-1} />
            <span>{t(lang, 'filter.promo')}</span>
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={ultimate}
            className={`lang-option${ultimate ? ' active' : ''}`}
            onClick={() => setUltimate((v) => !v)}
          >
            <input type="checkbox" className="lang-check" checked={ultimate} readOnly tabIndex={-1} />
            <span>{t(lang, 'filter.ultimate')}</span>
          </button>
        </div>
      )}
    </div>
  )
}

function DomainFilterRow({
  value,
  onChange,
  lang,
}: {
  value: string[]
  onChange: (next: string[]) => void
  lang: Lang
}) {
  return (
    <div className="domain-row" role="group" aria-label={t(lang, 'collection.domainFilter')}>
      {DOMAINS.map((d) => {
        const active = value.includes(d)
        return (
          <button
            key={d}
            type="button"
            className={`domain-btn${active ? ' active' : ''}`}
            title={active ? t(lang, 'collection.domainClear', { domain: d }) : t(lang, 'collection.domainTitle', { domain: d })}
            aria-pressed={active}
            onClick={() => onChange(active ? value.filter((x) => x !== d) : [...value, d])}
          >
            <img src={DOMAIN_ICON[d]} alt={d} draggable={false} />
          </button>
        )
      })}
    </div>
  )
}

function CardTile({
  c,
  o,
  lang,
  priceEntry,
  variant,
  onOpen,
  onBump,
}: {
  c: Card
  o: { qty: number; foil: number }
  lang: Lang
  priceEntry?: PriceEntry
  variant: 'binder' | 'catalog'
  onOpen: (c: Card) => void
  onBump: (id: string, field: 'qty' | 'foil', delta: number) => void
}) {
  const n = ownedQty(o)
  const showFoil = !(c.signed || c.overnumbered) || o.foil > 0
  const ownedClass = variant === 'binder' ? (n ? 'owned' : 'missing') : (n ? 'owned' : '')
  return (
    <article className={`card ${ownedClass}${c.signed || c.overnumbered ? ' shimmer' : ''}`}>
      <div
        className="art art-zoomable"
        style={{ backgroundImage: c.image ? `url(${c.image})` : undefined }}
        role="button"
        tabIndex={0}
        title={t(lang, 'card.enlarge')}
        onClick={() => onOpen(c)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen(c)
          }
        }}
      >
        {n > 0 && <div className="badge">x{n}</div>}
        <div className="flags">
          {c.signed ? <span className="flag signed">Signed</span> : null}
          {c.overnumbered && !c.signed ? <span className="flag over">ON</span> : null}
          {c.altArt ? <span className="flag alt">Alt</span> : null}
        </div>
        <ZoomMark title={t(lang, 'card.enlarge')} onOpen={() => onOpen(c)} />
      </div>
      <div className="meta">
        <div className="name-with-ban">
          <button
            type="button"
            className="name name-link"
            title={t(lang, 'price.openCm')}
            disabled={!priceEntry?.cmUrl}
            onClick={() => openCm(priceEntry)}
          >{displayCardName(c)}</button>
          <BanBadge status={banStatus(c)} lang={lang} />
        </div>
        <div className="sub">{c.code} | {c.set} | {(c.types || []).join('/') || '-'} | {(c.domains || []).join('/') || '-'}</div>
        <PriceBits entry={priceEntry} lang={lang} showHigh />
        <div className="row">
          <div className="qty" title={t(lang, 'qty.normal')}>
            <button onClick={() => onBump(c.id, 'qty', -1)}>-</button>
            <b className={variant === 'binder' ? (o.qty > 0 ? 'ok' : 'muted') : undefined}>{o.qty}</b>
            <button onClick={() => onBump(c.id, 'qty', 1)}>+</button>
          </div>
          {showFoil && (
            <div className="qty" title={t(lang, 'qty.foil')}>
              <button onClick={() => onBump(c.id, 'foil', -1)}>-</button>
              <b className={variant === 'binder' ? (o.foil > 0 ? 'ok' : 'muted') : 'ok'}>{o.foil}F</b>
              <button onClick={() => onBump(c.id, 'foil', 1)}>+</button>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

const HIDE_NN_KEY = 'riftbound-hide-nexus-night'

function loadHideNexusNight(): boolean {
  try {
    return localStorage.getItem(HIDE_NN_KEY) === '1'
  } catch {
    return false
  }
}

function saveHideNexusNight(v: boolean) {
  try {
    localStorage.setItem(HIDE_NN_KEY, v ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export default function App() {
  const [tab, setTab] = useState<Tab>('collection')
  const [lang, setLang] = useState<Lang>(() => loadLang())
  const [langMenuOpen, setLangMenuOpen] = useState(false)
  const langMenuRef = useRef<HTMLDivElement | null>(null)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [collection, setCollection] = useState<Collection>({})
  const [decks, setDecks] = useState<Deck[]>([])
  const [borrowed, setBorrowed] = useState<BorrowedGroup[]>([])
  const [activeBorrowedId, setActiveBorrowedId] = useState<string | null>(null)
  const [borrowImportText, setBorrowImportText] = useState('')
  const [borrowImportOpen, setBorrowImportOpen] = useState(false)
  const [borrowNotice, setBorrowNotice] = useState<string | null>(null)
  const [storeQuery, setStoreQuery] = useState('Berlin')
  const [storeKm, setStoreKm] = useState(STORE_RADIUS_KM_DEFAULT)
  const [storeHits, setStoreHits] = useState<StoreHit[]>([])
  const [storeCenter, setStoreCenter] = useState<MapCenter | null>(null)
  const [storeFetchedKm, setStoreFetchedKm] = useState(STORE_RADIUS_KM_DEFAULT)
  const [storeLabel, setStoreLabel] = useState<string | null>(null)
  const [storeBusy, setStoreBusy] = useState(false)
  const [storeError, setStoreError] = useState<string | null>(null)
  const [storeAllGermany, setStoreAllGermany] = useState(false)
  const [storeStockOnly, setStoreStockOnly] = useState(false)
  /** Store ids whose stock list is expanded past the collapsed preview. */
  const [storeStockOpen, setStoreStockOpen] = useState<Record<string, boolean>>({})
  const [q, setQ] = useState('')
  const [setFilter, setSetFilter] = useState('')
  const [ownedOnly, setOwnedOnly] = useState(false)
  const [typeFilter, setTypeFilter] = useState('')
  const [raritySigned, setRaritySigned] = useState(false)
  const [rarityOver, setRarityOver] = useState(false)
  const [rarityPromo, setRarityPromo] = useState(false)
  const [rarityUltimate, setRarityUltimate] = useState(false)
  const [rarityMenuOpen, setRarityMenuOpen] = useState(false)
  const rarityMenuRef = useRef<HTMLDivElement | null>(null)
  const [bulkText, setBulkText] = useState('')
  const [quickOpen, setQuickOpen] = useState(false)
  const [quickMode, setQuickMode] = useState<'codes' | 'list'>('codes')
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
  const [deckExportText, setDeckExportText] = useState<string | null>(null)
  const [deckExportCopied, setDeckExportCopied] = useState(false)
  const [missingExpanded, setMissingExpanded] = useState(false)
  const [cardPreview, setCardPreview] = useState<{ src: string; x: number; y: number } | null>(null)
  const [cardLightbox, setCardLightbox] = useState<Card | null>(null)
  const [clearSec, setClearSec] = useState<DeckSection | null>(null)
  const [kwExpanded, setKwExpanded] = useState<KeywordId | null>(null)
  const [ocrText, setOcrText] = useState<string | null>(null)
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrEmpty, setOcrEmpty] = useState(false)
  /** 'catalog' = baked Riot rulesText; 'ocr' = tesseract fallback */
  const [rulesSource, setRulesSource] = useState<'catalog' | 'ocr' | null>(null)
  const [appVersion, setAppVersion] = useState('')
  const [updateInfo, setUpdateInfo] = useState<{ status: string; version?: string; message?: string; percent?: number } | null>(null)
  const [isFullScreen, setIsFullScreen] = useState(false)
  const [priceBook, setPriceBook] = useState<PriceBook | null>(null)
  // null = binder dashboard; 'owned' = all owned; set code = that set binder
  const [binderView, setBinderView] = useState<string | null>(null)
  const [hideNexusNight, setHideNexusNight] = useState<boolean>(() => loadHideNexusNight())
  const [binderOwnedOnly, setBinderOwnedOnly] = useState(false)
  const [binderMissing, setBinderMissing] = useState(false)
  const [binderRarity, setBinderRarity] = useState<string | null>(null)
  const [domainFilter, setDomainFilter] = useState<string[]>([])
  const [dragOverSection, setDragOverSection] = useState<DeckSection | null>(null)
  const [dragRejectSection, setDragRejectSection] = useState<DeckSection | null>(null)
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null)
  const [dragOverSale, setDragOverSale] = useState(false)
  const [dragRejectSale, setDragRejectSale] = useState(false)
  const [dragOverBorrow, setDragOverBorrow] = useState(false)
  const [dragRejectBorrow, setDragRejectBorrow] = useState(false)
  const [deckNotice, setDeckNotice] = useState<string | null>(null)
  const deckDragged = useRef(false)

  function onDeckReorderPointerDown(e: ReactPointerEvent<HTMLSpanElement>, id: string) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const row = e.currentTarget.closest('.deck-acc-item') as HTMLElement | null
    const list = e.currentTarget.closest('.deck-accordion') as HTMLElement | null
    if (!row || !list) return
    const items = [...list.querySelectorAll<HTMLElement>('.deck-acc-item')]
    const from = items.indexOf(row)
    if (from < 0) return
    deckDragged.current = true
    const pointerId = e.pointerId
    const origin = list.getBoundingClientRect()
    const grab = e.clientY - row.getBoundingClientRect().top
    const slots = items.map((el) => {
      const r = el.getBoundingClientRect()
      return { el, top: r.top - origin.top + list.scrollTop, height: r.height }
    })
    let to = from
    row.classList.add('is-lifted')
    const shiftOthers = () => {
      const gap = slots.length > 1 ? slots[1].top - slots[0].top - slots[0].height : 0
      const order = slots.map((_, i) => i)
      const [moved] = order.splice(from, 1)
      order.splice(to, 0, moved)
      let cursor = slots[0].top
      const target = new Array<number>(slots.length)
      for (const idx of order) {
        target[idx] = cursor
        cursor += slots[idx].height + gap
      }
      for (let i = 0; i < slots.length; i++) {
        if (i === from) continue
        const delta = target[i] - slots[i].top
        slots[i].el.style.transform = delta ? `translateY(${delta}px)` : ''
      }
    }
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      const acc = list.getBoundingClientRect()
      const h = slots[from].height
      const naturalTop = slots[from].top - list.scrollTop + acc.top
      let visualTop = ev.clientY - grab
      const minTop = acc.top
      const maxTop = acc.bottom - h
      visualTop = maxTop < minTop ? minTop : Math.min(maxTop, Math.max(minTop, visualTop))
      row.style.transform = `translateY(${visualTop - naturalTop}px)`
      const contentY = ev.clientY - acc.top + list.scrollTop
      const atStart = list.scrollTop <= 1
      const atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 1
      if (atStart && ev.clientY <= acc.top + 24) to = 0
      else if (atEnd && ev.clientY >= acc.bottom - 24) to = items.length - 1
      else to = deckDropIndex(contentY, slots, from)
      shiftOthers()
    }
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      for (const s of slots) s.el.style.transform = ''
      row.classList.remove('is-lifted')
      if (to !== from) setDecks((prev) => moveDeckTo(prev, id, to))
      window.setTimeout(() => { deckDragged.current = false }, 0)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  const [handTesterOpen, setHandTesterOpen] = useState(true)
  const [handCards, setHandCards] = useState<string[] | null>(null)
  const [handLibrary, setHandLibrary] = useState<string[]>([])
  const [handSelected, setHandSelected] = useState<number[]>([])
  const [mulliganUsed, setMulliganUsed] = useState(false)
  const [handDrawn, setHandDrawn] = useState(false)

  useEffect(() => {
    window.riftbound?.getVersion().then(setAppVersion).catch(() => {})
    window.riftbound?.windowIsFullScreen?.().then(setIsFullScreen).catch(() => {})
    const offUpdater = window.riftbound?.onUpdater((p) => setUpdateInfo(p))
    const offFs = window.riftbound?.onFullscreen?.((v) => setIsFullScreen(v))
    return () => { offUpdater?.(); offFs?.() }
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

  async function toggleFullscreen() {
    try {
      const next = await window.riftbound?.windowToggleFullscreen?.()
      if (typeof next === 'boolean') setIsFullScreen(next)
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
    setLangMenuOpen(false)
  }

  useEffect(() => {
    if (!langMenuOpen && !rarityMenuOpen) return
    function onDocPointerDown(e: PointerEvent) {
      const t = e.target as Node
      if (langMenuOpen && langMenuRef.current && !langMenuRef.current.contains(t)) setLangMenuOpen(false)
      if (rarityMenuOpen && rarityMenuRef.current && !rarityMenuRef.current.contains(t)) setRarityMenuOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setLangMenuOpen(false)
        setRarityMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', onDocPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [langMenuOpen, rarityMenuOpen])

  useEffect(() => {
    setCollection(loadCollection())
    const d = loadDecks()
    setDecks(d)
    if (d[0]) setActiveDeckId(d[0].id)
    const b = loadBorrowed()
    setBorrowed(b)
    if (b[0]) setActiveBorrowedId(b[0].id)
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
    fetch(new URL('card-keywords.json', window.location.href))
      .then((r) => (r.ok ? r.json() : null))
      .then((data: CardKeywordBook | null) => { if (data?.byCardId) setCardKeywordBook(data) })
      .catch(() => {})
  }, [])

  useEffect(() => saveCollection(collection), [collection])
  useEffect(() => saveDecks(decks), [decks])
  useEffect(() => saveBorrowed(borrowed), [borrowed])

  const cards = catalog?.cards || []
  const sets = catalog?.sets || {}
  const legendIds = useMemo(() => legendIdentityByName(cards, priceBook), [cards, priceBook])
  const allTypes = useMemo(() => {
    const s = new Set<string>()
    for (const c of cards) for (const t of c.types || []) if (t) s.add(t)
    return [...s].sort((a, b) => a.localeCompare(b))
  }, [cards])

  function displayName(c: Card) {
    return displayCardName(c)
  }

  function isPromoCard(c: Card) {
    if ((c.tags || []).includes('promo')) return true
    return String(c.set || '').endsWith('-NN')
  }

  function cardSearchHay(c: Card) {
    return [
      c.name,
      c.subtitle || '',
      c.code,
      c.id,
      ...(c.domains || []),
      ...(c.types || []),
      c.rarity || '',
      ...(c.tags || []),
      legendIds.get(c.name.toLowerCase()) || '',
    ].join(' ').toLowerCase()
  }

  /** Domain, signed/over/promo, and search haystack. Set and type stay catalog-only. */
  function matchesSharedFilters(c: Card, query: string) {
    if (!cardMatchesDomains(c.domains, domainFilter)) return false
    if (raritySigned || rarityOver || rarityPromo || rarityUltimate) {
      const hit =
        (raritySigned && !!c.signed) ||
        (rarityOver && !!c.overnumbered) ||
        (rarityPromo && isPromoCard(c)) ||
        (rarityUltimate && c.rarity === 'Ultimate Rare')
      if (!hit) return false
    }
    if (!query) return true
    return cardSearchHay(c).includes(query)
  }

  function matchesFilters(c: Card, query: string) {
    if (setFilter && c.set !== setFilter) return false
    if (typeFilter && !(c.types || []).includes(typeFilter)) return false
    return matchesSharedFilters(c, query)
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
        const cardsChanged = s.trimmed > 0 || s.copyRemoved > 0 || s.battlefieldRemoved > 0 || s.domainRemoved > 0 || m !== d
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
  }, [cards, q, setFilter, typeFilter, domainFilter, raritySigned, rarityOver, rarityPromo, rarityUltimate, ownedOnly, collection, legendIds])

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
      const add = ownedLineEur(o, p)
      if (add > 0) {
        sum += add
        priced += 1
      }
    }
    return { sum, priced }
  }, [collection, priceBook])

  const setProgress = useMemo(() => {
    const known = BINDER_SET_ORDER.filter((id) => id in sets)
    const knownSet = new Set<string>(known)
    const rest = Object.keys(sets).filter((id) => !knownSet.has(id))
    let order = [...known, ...rest]
    if (hideNexusNight) order = order.filter((id) => !String(id).endsWith('-NN'))
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
        const add = ownedLineEur(o, priceBook.cards[c.id])
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
  }, [cards, sets, collection, priceBook, hideNexusNight])

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
      return matchesSharedFilters(c, query)
    })
    return [...list].sort((a, b) => a.cn - b.cn || a.code.localeCompare(b.code))
  }, [binderView, cards, collection, q, binderOwnedOnly, binderMissing, binderRarity, domainFilter, raritySigned, rarityOver, rarityPromo, rarityUltimate, legendIds])

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

  function addCollectionQty(entries: { id: string; qty: number }[]) {
    if (!entries.length) return
    setCollection((prev) => {
      const next = { ...prev }
      for (const { id, qty } of entries) {
        if (qty <= 0) continue
        const cur = next[id] || { qty: 0, foil: 0 }
        next[id] = { ...cur, qty: cur.qty + qty }
      }
      return next
    })
  }

  function runQuickImport() {
    const text = bulkText.trim()
    if (!text) return
    if (quickMode === 'codes') {
      const tokens = parseBulkTokens(text)
      const missing: string[] = []
      const tally = new Map<string, number>()
      for (const token of tokens) {
        const card = resolveToken(token, cards)
        if (!card) {
          missing.push(token)
          continue
        }
        tally.set(card.id, (tally.get(card.id) || 0) + 1)
      }
      addCollectionQty([...tally.entries()].map(([id, qty]) => ({ id, qty })))
      setBulkReport(
        t(lang, 'bulk.found', { ok: tokens.length - missing.length }) +
          (missing.length
            ? t(lang, 'bulk.missing', {
                miss: missing.length,
                list: `${missing.slice(0, 12).join(', ')}${missing.length > 12 ? '...' : ''}`,
              })
            : ''),
      )
      return
    }
    const result = parseDeckImport(text, cards)
    const flat = flattenImportCards(result.cards)
    addCollectionQty(flat)
    const copies = flat.reduce((sum, c) => sum + c.qty, 0)
    const parts = [t(lang, 'borrowed.importDone', { cards: flat.length, copies })]
    if (result.unmatched.length) {
      const shown = result.unmatched.slice(0, 8)
      const names = shown.map((u) => t(lang, 'decks.notFoundPrefix', { name: u })).join('; ')
      const more = result.unmatched.length > 8
        ? ` ${t(lang, 'decks.andMore', { n: result.unmatched.length - 8 })}`
        : ''
      parts.push(names + more)
    }
    setBulkReport(parts.join(' · '))
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
  const saleQuery = saleQ.trim().toLowerCase()
  const saleHits = ownedCards.filter((c) => {
    if (!saleQuery) return true
    return (
      c.name.toLowerCase().includes(saleQuery) ||
      (c.subtitle || '').toLowerCase().includes(saleQuery) ||
      c.code.toLowerCase().includes(saleQuery) ||
      displayName(c).toLowerCase().includes(saleQuery)
    )
  }).slice(0, 80)

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
    setDeckNotice(null)
  }

  const activeDeck = decks.find((d) => d.id === activeDeckId) || null
  const activeBorrowed = borrowed.find((g) => g.id === activeBorrowedId) || null

  const borrowedTotals = useMemo(() => borrowedQtyById(borrowed), [borrowed])

  /** Owned copies minus lent-out copies — used for deck missing-copies. */
  function availableForDecks(id: string) {
    return Math.max(0, ownedQty(collection[id]) - (borrowedTotals.get(id) || 0))
  }

  function groupCardCount(g: BorrowedGroup) {
    return g.cards.reduce((s, c) => s + c.qty, 0)
  }

  function newBorrowedGroup() {
    const g: BorrowedGroup = {
      id: uid(),
      name: t(lang, 'borrowed.defaultName', { n: borrowed.length + 1 }),
      cards: [],
      updatedAt: new Date().toISOString(),
    }
    setBorrowed((prev) => [g, ...prev])
    setActiveBorrowedId(g.id)
    setBorrowNotice(null)
    setBorrowImportOpen(false)
    setBorrowImportText('')
  }

  function updateBorrowed(mut: (g: BorrowedGroup) => BorrowedGroup) {
    if (!activeBorrowedId) return
    setBorrowed((prev) =>
      prev.map((g) => (g.id === activeBorrowedId ? { ...mut(g), updatedAt: new Date().toISOString() } : g)),
    )
  }

  /** Copies still free to lend (owned minus all borrower groups). */
  function remainingToLend(id: string) {
    return Math.max(0, ownedQty(collection[id]) - (borrowedTotals.get(id) || 0))
  }

  function bumpBorrowedCard(cardId: string, delta: number) {
    if (!activeBorrowedId) return
    setBorrowed((prev) => {
      const owned = ownedQty(collection[cardId])
      const totals = borrowedQtyById(prev)
      const room = Math.max(0, owned - (totals.get(cardId) || 0))
      return prev.map((g) => {
        if (g.id !== activeBorrowedId) return g
        const cards = [...g.cards]
        const i = cards.findIndex((c) => c.id === cardId)
        if (delta > 0) {
          const add = Math.min(delta, room)
          if (add <= 0) return g
          if (i < 0) cards.push({ id: cardId, qty: add })
          else cards[i] = { ...cards[i], qty: cards[i].qty + add }
        } else {
          if (i < 0) return g
          const next = cards[i].qty + delta
          if (next <= 0) cards.splice(i, 1)
          else cards[i] = { ...cards[i], qty: next }
        }
        return { ...g, cards, updatedAt: new Date().toISOString() }
      })
    })
  }

  function removeBorrowedCard(cardId: string) {
    updateBorrowed((g) => ({ ...g, cards: g.cards.filter((c) => c.id !== cardId) }))
  }

  function runBorrowImport(text: string) {
    if (!activeBorrowedId) return
    const result = parseDeckImport(text, cards)
    const flat = flattenImportCards(result.cards)
    updateBorrowed((g) => {
      const m = new Map(g.cards.map((c) => [c.id, c.qty]))
      for (const c of flat) {
        m.set(c.id, (m.get(c.id) || 0) + c.qty)
      }
      return { ...g, cards: [...m.entries()].map(([id, qty]) => ({ id, qty })) }
    })
    const copies = flat.reduce((s, c) => s + c.qty, 0)
    const parts: string[] = [
      t(lang, 'borrowed.importDone', { cards: flat.length, copies }),
    ]
    if (result.unmatched.length) {
      const shown = result.unmatched.slice(0, 8)
      const names = shown.map((u) => t(lang, 'decks.notFoundPrefix', { name: u })).join('; ')
      const more = result.unmatched.length > 8
        ? ` ${t(lang, 'decks.andMore', { n: result.unmatched.length - 8 })}`
        : ''
      parts.push(names + more + t(lang, 'borrowed.namesNotFound'))
    }
    setBorrowNotice(parts.join(' · '))
    setBorrowImportOpen(false)
    setBorrowImportText('')
  }


  useEffect(() => {
    setHandCards(null)
    setHandLibrary([])
    setHandSelected([])
    setMulliganUsed(false)
    setHandDrawn(false)
    setMissingExpanded(false)
  }, [activeDeckId])

  function updateDeck(mut: (d: Deck) => Deck) {
    if (!activeDeckId) return
    setDecks((prev) => prev.map((d) => (d.id === activeDeckId ? { ...mut(d), updatedAt: new Date().toISOString() } : d)))
  }

  function dealNewHand() {
    if (!activeDeck) return
    const dealt = dealOpeningHand(activeDeck.cards)
    if (!dealt) return
    setHandCards(dealt.hand)
    setHandLibrary(dealt.library)
    setHandSelected([])
    setMulliganUsed(false)
    setHandDrawn(false)
  }

  function toggleHandSelect(index: number) {
    if (mulliganUsed || !handCards) return
    setHandSelected((prev) => {
      if (prev.includes(index)) return prev.filter((i) => i !== index)
      if (prev.length >= 2) return prev
      return [...prev, index]
    })
  }

  function runMulligan() {
    if (!handCards || mulliganUsed || handSelected.length < 1 || handSelected.length > 2) return
    const next = applyMulligan(handCards, handLibrary, handSelected)
    if (!next) return
    setHandCards(next.hand)
    setHandLibrary(next.library)
    setHandSelected([])
    setMulliganUsed(true)
  }

  function drawTurnOneCard() {
    if (!handCards || handDrawn) return
    const next = drawTopCard(handCards, handLibrary)
    if (!next) return
    setHandCards(next.hand)
    setHandLibrary(next.library)
    setHandDrawn(true)
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
    const img = row.querySelector('img.deck-thumb') as HTMLImageElement | null
    if (img && img.complete && img.naturalWidth > 0) {
      try { e.dataTransfer.setDragImage(img, img.clientWidth / 2, img.clientHeight / 2) } catch {}
    }
    row.classList.add('dragging')
  }

  function onPickerDragEnd(e: ReactDragEvent) {
    (e.currentTarget as HTMLElement).classList.remove('dragging')
    setDraggingCardId(null)
    setDragOverSection(null)
    setDragRejectSection(null)
    setDragOverSale(false)
    setDragRejectSale(false)
    setDragOverBorrow(false)
    setDragRejectBorrow(false)
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
  }

  function saleCartDropClass() {
    const parts = ['list', 'sale-cart']
    if (dragOverSale) parts.push('drag-over')
    if (dragRejectSale) parts.push('drag-reject')
    return parts.join(' ')
  }

  function onBorrowDragOver(e: ReactDragEvent) {
    const types = Array.from(e.dataTransfer.types || [])
    const raw = types.includes('text/riftbound-card') || types.includes('text/plain') || !!draggingCardId
    if (!raw) return
    e.preventDefault()
    if (!activeBorrowedId) {
      e.dataTransfer.dropEffect = 'none'
      setDragOverBorrow(false)
      setDragRejectBorrow(true)
      return
    }
    const id = draggingCardId
    if (id && remainingToLend(id) <= 0) {
      e.dataTransfer.dropEffect = 'none'
      setDragOverBorrow(false)
      setDragRejectBorrow(true)
      return
    }
    e.dataTransfer.dropEffect = 'copy'
    setDragRejectBorrow(false)
    setDragOverBorrow(true)
  }

  function onBorrowDragLeave(e: ReactDragEvent) {
    const related = e.relatedTarget as Node | null
    if (related && (e.currentTarget as HTMLElement).contains(related)) return
    setDragOverBorrow(false)
    setDragRejectBorrow(false)
  }

  function onBorrowDrop(e: ReactDragEvent) {
    e.preventDefault()
    e.stopPropagation()
    const cardId = e.dataTransfer.getData('text/riftbound-card') || e.dataTransfer.getData('text/plain')
    setDragOverBorrow(false)
    setDragRejectBorrow(false)
    if (!activeBorrowedId || !cardId) return
    if (remainingToLend(cardId) <= 0) {
      setDragRejectBorrow(true)
      window.setTimeout(() => setDragRejectBorrow(false), 450)
      return
    }
    bumpBorrowedCard(cardId, 1)
  }

  function borrowDropClass() {
    const parts = ['list', 'borrow-drop']
    if (dragOverBorrow) parts.push('drag-over')
    if (dragRejectBorrow) parts.push('drag-reject')
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
  }

  function sectionDropClass(sec: DeckSection, locked = false) {
    const parts = ['deck-sec']
    if (activeSection === sec) parts.push('active')
    if (dragOverSection === sec) parts.push('drag-over')
    if (dragRejectSection === sec) parts.push('drag-reject')
    if (locked) parts.push('locked')
    return parts.join(' ')
  }

  function renderDeckSection(sec: DeckSection, deck: Deck) {
    const count = sectionCount(deck.cards, sec)
    const cap = SECTION_CAPS[sec]
    const over = count > cap
    const atCap = count >= cap
    const locked = sectionNeedsLegend(sec) && !hasLegend(deck.cards)
    const cardsIn = deck.cards.filter((dc) => sectionOf(dc) === sec)
    return (
      <div
        key={sec}
        className={sectionDropClass(sec, locked)}
        onClick={() => setActiveSection(sec)}
        onDragOver={(e) => onSectionDragOver(e, sec)}
        onDragLeave={(e) => onSectionDragLeave(e, sec)}
        onDrop={(e) => onSectionDrop(e, sec)}
      >
        <div className="deck-sec-head">
          <span className="deck-sec-title">{SECTION_LABEL[sec]}</span>
          {count > 0 && sec !== 'legend' && sec !== 'champion' && (
            <button
              type="button"
              className="btn small deck-trash"
              style={{ marginLeft: 'auto' }}
              title={t(lang, 'decks.clearSection')}
              aria-label={t(lang, 'decks.clearSection')}
              onClick={(e) => {
                e.stopPropagation()
                setClearSec(sec)
              }}
            >
              {t(lang, 'decks.clearSection')}
            </button>
          )}
          <span className={`deck-sec-cap${over ? ' over' : ''}`}>{count}/{cap}</span>
        </div>
        <div className="list">
          {cardsIn.map((dc) => {
            const c = byId.get(dc.id)
            if (!c) return null
            const have = availableForDecks(c.id)
            const shortQty = Math.max(0, dc.qty - have)
            const short = shortQty > 0
            return (
              <div
                key={`${dc.id}-${sec}`}
                className={`list-item deck-card-row${short ? ' short' : ''}`}
                onMouseEnter={(e) => showCardPreview(e, c.image)}
                onMouseMove={(e) => showCardPreview(e, c.image)}
                onMouseLeave={hideCardPreview}
              >
                <DeckThumb src={c.image} onOpen={() => openCardLightbox(c)} openTitle={t(lang, 'card.enlarge')} zoomIcon />
                <div className="grow">
                  <div className="name-with-ban">
                    <button
                      type="button"
                      className="name name-link"
                      title={t(lang, 'price.openCm')}
                      disabled={!priceBook?.cards[c.id]?.cmUrl}
                      onClick={(e) => { e.stopPropagation(); openCm(priceBook?.cards[c.id]) }}
                    >{displayName(c)}</button>
                    <BanBadge status={banStatus(c)} lang={lang} />
                  </div>
                  <div className="sub">
                    {c.energy != null ? `E${c.energy} · ` : ''}{c.code} · {t(lang, 'decks.owns', { have })}
                  </div>
                  <PriceBits entry={priceBook?.cards[c.id]} lang={lang} />
                </div>
                {shortQty > 0 && (
                  <button
                    type="button"
                    className="btn small deck-add-collection"
                    title={t(lang, 'decks.addToCollection')}
                    onClick={(e) => {
                      e.stopPropagation()
                      bump(c.id, 'qty', 1)
                    }}
                  >
                    {t(lang, 'decks.addToCollection')}
                  </button>
                )}
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
        {!atCap && (
          <button
            type="button"
            className="deck-add"
            disabled={locked}
            title={locked ? t(lang, 'decks.legendLocked') : undefined}
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

  function clearDeckSection(section: DeckSection) {
    updateDeck((d) => ({ ...d, cards: d.cards.filter((x) => sectionOf(x) !== section) }))
    if (section === 'legend') {
      setActiveSection('legend')
      setDeckNotice(null)
    }
  }

  function deckCount(d: Deck) {
    return d.cards.reduce((s, c) => s + c.qty, 0)
  }

  function underOwnedLines(d: Deck) {
    const totals = deckTotalQtyById(d.cards)
    const out: { id: string; name: string; need: number; have: number; short: number }[] = []
    for (const [id, need] of totals) {
      const have = availableForDecks(id)
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
      const have = availableForDecks(id)
      const short = Math.max(0, need - have)
      if (short > 0) {
        missingLow += low * short
        missingPriced += short
      }
    }
    return { deckLow, missingLow, priced, missingPriced }
  }

  function formatDeckList(d: Deck) {
    const lines: string[] = []
    for (const sec of SECTION_ORDER) {
      const rows = d.cards.filter((c) => sectionOf(c) === sec)
      if (!rows.length) continue
      lines.push(`${SECTION_LABEL[sec]}:`)
      for (const row of rows) {
        const card = byId.get(row.id)
        lines.push(`${row.qty} ${card ? displayCardName(card) : row.id}`)
      }
      lines.push('')
    }
    return lines.join('\n').trim()
  }

  function openDeckExport() {
    if (!activeDeck) return
    setDeckExportCopied(false)
    setDeckExportText(formatDeckList(activeDeck))
  }

  async function copyDeckExport() {
    if (!deckExportText) return
    try {
      await navigator.clipboard.writeText(deckExportText)
      setDeckExportCopied(true)
    } catch {
      setDeckExportCopied(false)
    }
  }

  function runDeckImport(text: string) {
    if (!activeDeckId) return
    const result = parseDeckImport(text, cards)
    const sanitized = sanitizeDeckCards(result.cards, byId)
    updateDeck((d) => ({ ...d, cards: sanitized.cards }))
    const parts: string[] = []
    if (sanitized.notice) parts.push(t(lang, 'decks.importAdjusted', { notice: sanitized.notice }))
    if (result.unmatched.length) {
      const shown = result.unmatched.slice(0, 8)
      const names = shown.map((u) => t(lang, 'decks.notFoundPrefix', { name: u })).join('; ')
      const more = result.unmatched.length > 8
        ? ` ${t(lang, 'decks.andMore', { n: result.unmatched.length - 8 })}`
        : ''
      parts.push(names + more)
    }
    setDeckNotice(parts.length ? parts.join(' · ') : null)
    setDeckImportOpen(false)
  }


  async function runGermanySearch() {
    setStoreBusy(true)
    setStoreError(null)
    try {
      // Radius stays ignored; typed city (if any) is only the distance sort origin.
      let sortOrigin: { lat: number; lng: number } | undefined
      const q = storeQuery.trim()
      if (q) {
        const geo = await geocodeQuery(q, 'de')
        if (!geo) {
          setStoreHits([])
          setStoreCenter(null)
          setStoreLabel(null)
          setStoreError(t(lang, 'stores.geoFail'))
          return
        }
        sortOrigin = { lat: geo.lat, lng: geo.lng }
      }
      const hits = await searchStoresInGermany(sortOrigin)
      setStoreHits(hits)
      setStoreStockOpen({})
      setStoreCenter(sortOrigin ?? GERMANY_CENTER)
      setStoreFetchedKm(storeKm)
      setStoreLabel(t(lang, 'stores.allGermany'))
    } catch (e) {
      setStoreHits([])
      setStoreCenter(null)
      setStoreLabel(null)
      setStoreError(t(lang, 'stores.error', { message: e instanceof Error ? e.message : String(e) }))
    } finally {
      setStoreBusy(false)
    }
  }

  async function runStoreSearchAt(lat: number, lng: number, label: string, radiusKm = storeKm) {
    if (storeAllGermany) return runGermanySearch()
    const km = clampStoreRadiusKm(radiusKm)
    setStoreBusy(true)
    setStoreError(null)
    try {
      const hits = await searchStoresNear(lat, lng, km)
      setStoreHits(hits)
      setStoreStockOpen({})
      setStoreCenter({ lat, lng })
      setStoreFetchedKm(km)
      setStoreLabel(label)
    } catch (e) {
      setStoreHits([])
      setStoreCenter(null)
      setStoreLabel(null)
      setStoreError(t(lang, 'stores.error', { message: e instanceof Error ? e.message : String(e) }))
    } finally {
      setStoreBusy(false)
    }
  }

  async function runStoreSearch() {
    if (storeAllGermany) return runGermanySearch()
    const q = storeQuery.trim()
    if (!q) {
      setStoreError(t(lang, 'stores.needQuery'))
      return
    }
    const km = clampStoreRadiusKm(storeKm)
    setStoreBusy(true)
    setStoreError(null)
    try {
      const geo = await geocodeQuery(q, 'de')
      if (!geo) {
        setStoreHits([])
        setStoreCenter(null)
        setStoreLabel(null)
        setStoreError(t(lang, 'stores.geoFail'))
        return
      }
      const hits = await searchStoresNear(geo.lat, geo.lng, km)
      setStoreHits(hits)
      setStoreStockOpen({})
      setStoreCenter({ lat: geo.lat, lng: geo.lng })
      setStoreFetchedKm(km)
      setStoreLabel(geo.label)
    } catch (e) {
      setStoreHits([])
      setStoreCenter(null)
      setStoreLabel(null)
      setStoreError(t(lang, 'stores.error', { message: e instanceof Error ? e.message : String(e) }))
    } finally {
      setStoreBusy(false)
    }
  }

  function openStoreLink(url: string) {
    if (window.riftbound?.openExternal) void window.riftbound.openExternal(url)
    else window.open(url, '_blank', 'noopener,noreferrer')
  }

  function setStoreKmFromUi(raw: number) {
    setStoreKm(clampStoreRadiusKm(raw))
  }

  const visibleStoreHits = storeHits.filter((h) => {
    if (!storeAllGermany && h.distanceKm != null && h.distanceKm > storeKm + 0.05) return false
    if (storeStockOnly && !storeReportsStock(h)) return false
    return true
  })

  // After slider/input settles: re-query UVS if radius changed (circle already updates live).
  useEffect(() => {
    if (storeAllGermany) return
    if (!storeCenter) return
    if (Math.abs(storeKm - storeFetchedKm) < 0.5) return
    const handle = window.setTimeout(() => {
      void runStoreSearchAt(storeCenter.lat, storeCenter.lng, storeLabel || storeQuery.trim() || '…', storeKm)
    }, 850)
    return () => window.clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only when km changes
  }, [storeKm, storeCenter, storeAllGermany])

  useEffect(() => {
    if (!cardLightbox && !clearSec && deckExportText == null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (deckExportText != null) setDeckExportText(null)
      else if (clearSec) setClearSec(null)
      else setCardLightbox(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cardLightbox, clearSec, deckExportText])

  useEffect(() => {
    if (!cardLightbox) {
      setOcrText(null)
      setOcrLoading(false)
      setOcrEmpty(false)
      setRulesSource(null)
      return
    }
    const baked = (cardLightbox.rulesText || '').trim()
    if (baked) {
      setOcrLoading(false)
      setOcrText(baked)
      setOcrEmpty(false)
      setRulesSource('catalog')
      return
    }
    // Runes / blank official text: don't OCR empty text boxes into gibberish
    const types = cardLightbox.types || []
    const runeOnly = types.length > 0 && types.every((t) => t === 'Rune')
    if (runeOnly) {
      setOcrLoading(false)
      setOcrText(null)
      setOcrEmpty(true)
      setRulesSource(null)
      return
    }
    let cancelled = false
    const cardId = cardLightbox.id
    const image = cardLightbox.image
    if (!image) {
      setOcrLoading(false)
      setOcrText(null)
      setOcrEmpty(true)
      setRulesSource(null)
      return
    }
    setRulesSource('ocr')
    setOcrLoading(true)
    setOcrText(null)
    setOcrEmpty(false)
    void ocrCardText(cardId, image).then((res) => {
      if (cancelled) return
      setOcrLoading(false)
      setOcrText(res.text || null)
      setOcrEmpty(res.empty || !res.text)
    }).catch(() => {
      if (cancelled) return
      setOcrLoading(false)
      setOcrText(null)
      setOcrEmpty(true)
    })
    return () => { cancelled = true }
  }, [cardLightbox])

  function openCardLightbox(c: Card) {
    setCardPreview(null)
    setKwExpanded(null)
    setOcrText(null)
    setOcrEmpty(false)
    setRulesSource(null)
    const hasBaked = !!(c.rulesText && c.rulesText.trim())
    setOcrLoading(!hasBaked && !!c.image)
    setCardLightbox(c)
  }

  function closeCardLightbox() {
    setCardLightbox(null)
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

  function renderOpenDeck() {
    if (!activeDeck) return null
    return (
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
                        <button
                          type="button"
                          className="btn small"
                          style={{ marginTop: 6 }}
                          onClick={() => setMissingExpanded((v) => !v)}
                        >
                          {t(lang, missingExpanded ? 'decks.hideMissing' : 'decks.showMissing')}
                        </button>
                        {missingExpanded && (
                          <div className="deck-warn-list">
                            {under.map((u) => {
                              const img = byId.get(u.id)?.image
                              const pe = priceBook?.cards[u.id]
                              return (
                                <div
                                  key={u.id}
                                  className="list-item deck-warn-row"
                                  onMouseEnter={(e) => showCardPreview(e, img)}
                                  onMouseMove={(e) => showCardPreview(e, img)}
                                  onMouseLeave={hideCardPreview}
                                >
                                  {img ? (
                                    <img
                                      className="deck-thumb"
                                      src={img}
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
                                      disabled={!pe?.cmUrl}
                                      onClick={() => openCm(pe)}
                                    >{u.name}</button>
                                    <div className="sub">
                                      {t(lang, 'decks.needHave', { need: u.need, have: u.have })}
                                    </div>
                                  </div>
                                  {u.short > 0 && (
                                    <button
                                      type="button"
                                      className="btn small deck-add-collection"
                                      title={t(lang, 'decks.addToCollection')}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        bump(u.id, 'qty', 1)
                                      }}
                                    >
                                      {t(lang, 'decks.addToCollection')}
                                    </button>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })()}

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
                        {': '}
                        {req.length > 0
                          ? <>{t(lang, 'decks.legendCover', { domains: req.join(', ') })}</>
                          : <>{t(lang, 'decks.legendAny')}</>}
                        {t(lang, 'decks.legendGateExtra')}
                      </div>
                    )
                  })()}

                  <div className="deck-sections">
                    <div className="deck-sec-row">
                      {(['legend', 'champion'] as DeckSection[]).map((sec) => renderDeckSection(sec, activeDeck))}
                    </div>

                    {SECTION_ORDER.filter((s) => s !== 'legend' && s !== 'champion').map((sec) => renderDeckSection(sec, activeDeck))}
                  </div>

                  {(() => {
                    const poolN = drawPoolSize(activeDeck)
                    const canTest = poolN >= OPENING_HAND_SIZE
                    return (
                      <details
                        className="hand-tester"
                        open={handTesterOpen}
                        onToggle={(e) => setHandTesterOpen(e.currentTarget.open)}
                      >
                        <summary
                          className="hand-tester-head"
                          title={t(lang, 'hand.toggle')}
                        >
                          <span className="hand-tester-chevron" aria-hidden />
                          <span className="hand-tester-title">{t(lang, 'hand.title')}</span>
                          <span className="pill">{t(lang, 'hand.poolSize', { n: poolN })}</span>
                        </summary>
                          <div className="hand-tester-body">
                            {!canTest ? (
                              <div className="hand-empty-msg">{t(lang, 'hand.poolTooSmall')}</div>
                            ) : (
                              <>
                                <div className="hand-tester-controls">
                                  <button type="button" className="btn primary" onClick={dealNewHand}>
                                    {t(lang, 'hand.new')}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn"
                                    disabled={mulliganUsed || handSelected.length < 1 || handSelected.length > 2 || !handCards}
                                    title={mulliganUsed ? t(lang, 'hand.mulliganDone') : t(lang, 'hand.selectHint')}
                                    onClick={runMulligan}
                                  >
                                    {t(lang, 'hand.mulligan')}
                                  </button>
                                  {handCards && !mulliganUsed && (
                                    <span className="hand-hint">{t(lang, 'hand.selected', { n: handSelected.length })}</span>
                                  )}
                                  {mulliganUsed && (
                                    <span className="hand-hint">{t(lang, 'hand.mulliganDone')}</span>
                                  )}
                                  <button
                                    type="button"
                                    className="btn"
                                    disabled={!handCards || handDrawn || handLibrary.length < 1}
                                    title={handDrawn ? t(lang, 'hand.drawDone') : handLibrary.length < 1 ? t(lang, 'hand.noLibrary') : undefined}
                                    onClick={drawTurnOneCard}
                                  >
                                    {t(lang, 'hand.draw')}
                                  </button>
                                </div>
                                {!handCards ? (
                                  <div className="hand-empty-msg">{t(lang, 'hand.empty')}</div>
                                ) : (
                                  <>
                                    {!mulliganUsed && (
                                      <div className="hand-hint">{t(lang, 'hand.selectHint')}</div>
                                    )}
                                    <div className="hand-grid">
                                      {handCards.map((id, idx) => {
                                        const c = byId.get(id)
                                        const selected = handSelected.includes(idx)
                                        const name = c ? displayName(c) : id
                                        return (
                                          <button
                                            key={`${id}-${idx}`}
                                            type="button"
                                            className={`hand-card${selected ? ' selected' : ''}`}
                                            disabled={mulliganUsed}
                                            onClick={() => toggleHandSelect(idx)}
                                            onMouseEnter={(e) => c?.image && showCardPreview(e, c.image)}
                                            onMouseMove={(e) => c?.image && showCardPreview(e, c.image)}
                                            onMouseLeave={hideCardPreview}
                                            title={name}
                                          >
                                            <div
                                              className="art"
                                              style={{ backgroundImage: c?.image ? `url(${c.image})` : undefined }}
                                            />
                                            <div className="meta">
                                              <div className="name">{name}</div>
                                              {c && (
                                                <div className="sub">
                                                  {c.energy != null ? `E${c.energy} · ` : ''}{c.code}
                                                </div>
                                              )}
                                            </div>
                                          </button>
                                        )
                                      })}
                                    </div>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                      </details>
                    )
                  })()}
      </>
    )
  }

  return (
    <div className="app">
      <header className="top titlebar">
        <div className="brand"><img className="brand-dante" src={publicAsset('dante.svg')} alt="Dante" />Deakrix <span>Riftbound Tracker</span></div>
        <nav className="tabs no-drag">
          {([
            ['collection', 'tab.collection'],
            ['catalog', 'tab.catalog'],
            ['sales', 'tab.sales'],
            ['decks', 'tab.decks'],
            ['borrowed', 'tab.borrowed'],
            ['stores', 'tab.stores'],
          ] as const).map(([id, key]) => (
            <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
              {t(lang, key)}
            </button>
          ))}
        </nav>
        <div className="stats no-drag" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className="maker-credit">made by Stefan</span>
          <span>{t(lang, 'stats.line', { unique: totals.unique, copies: totals.copies, catalog: totals.catalog })}</span>
          {collectionValue && (
            <span className="value-pill" title={t(lang, 'stats.valueTitle')}>
              ~{collectionValue.sum.toFixed(2)} EUR
            </span>
          )}
          <div className={`lang-menu${langMenuOpen ? ' open' : ''}`} ref={langMenuRef}>
            <button
              type="button"
              className={`lang-trigger${langMenuOpen ? ' open' : ''}`}
              title={t(lang, 'lang.label')}
              aria-label={t(lang, 'lang.label')}
              aria-haspopup="menu"
              aria-expanded={langMenuOpen}
              onClick={() => setLangMenuOpen((o) => !o)}
            >
              {t(lang, 'lang.label')}
              <svg className="lang-caret" width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
                <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {langMenuOpen && (
              <div className="lang-dropdown" role="menu" aria-label={t(lang, 'lang.label')}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={lang === 'de'}
                  className={`lang-option${lang === 'de' ? ' active' : ''}`}
                  onClick={() => setAppLang('de')}
                >
                  <img className="lang-flag" src="flags/de.svg" alt="" width={18} height={12} />
                  <span>{t(lang, 'lang.de')}</span>
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={lang === 'en'}
                  className={`lang-option${lang === 'en' ? ' active' : ''}`}
                  onClick={() => setAppLang('en')}
                >
                  <img className="lang-flag" src="flags/gb.svg" alt="" width={18} height={12} />
                  <span>{t(lang, 'lang.en')}</span>
                </button>
              </div>
            )}
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
        </div>
        <div className="win-controls no-drag">
          <button type="button" className="win-btn" title={t(lang, 'win.minimize')} aria-label={t(lang, 'win.minimize')} onClick={() => window.riftbound?.windowMinimize?.()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 5h8" stroke="currentColor" strokeWidth="1.2" fill="none" /></svg>
          </button>
          <button type="button" className="win-btn" title={isFullScreen ? t(lang, 'win.windowed') : t(lang, 'win.fullscreen')} aria-label={isFullScreen ? t(lang, 'win.windowed') : t(lang, 'win.fullscreen')} onClick={toggleFullscreen}>
            {isFullScreen ? (
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

      <main className={`main${tab === 'stores' ? ' main-stores' : ''}${tab === 'collection' && binderView != null ? ' main-binder' : ''}`}>
        {tab === 'collection' && binderView == null && (
          <>
            <div className="toolbar">
              <div className="grow">
                <h2 className="section-title">{t(lang, 'collection.title')}</h2>
                <p className="help" style={{ margin: 0 }}>{t(lang, 'collection.help')}</p>
              </div>
              <button
                type="button"
                className={`chip ${hideNexusNight ? 'active' : ''}`}
                onClick={() => {
                  setHideNexusNight((v) => {
                    const next = !v
                    saveHideNexusNight(next)
                    return next
                  })
                }}
              >
                {t(lang, 'collection.hideNexusNight')}
              </button>
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
              <button type="button" className="btn" onClick={() => setQuickOpen((v) => !v)}>
                {t(lang, 'collection.quickImport')}
              </button>
            </div>
            {quickOpen && (
              <div className="quick-import">
                <span className="quick-import-label">{t(lang, 'collection.quickImport')}</span>
                <button type="button" className={`chip ${quickMode === 'codes' ? 'active' : ''}`} onClick={() => setQuickMode('codes')}>{t(lang, 'collection.quickCodes')}</button>
                <button type="button" className={`chip ${quickMode === 'list' ? 'active' : ''}`} onClick={() => setQuickMode('list')}>{t(lang, 'collection.quickList')}</button>
                <textarea
                  className="field"
                  rows={2}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={t(lang, quickMode === 'codes' ? 'collection.quickPhCodes' : 'collection.quickPhList')}
                />
                <button className="btn primary small" disabled={!bulkText.trim()} onClick={runQuickImport}>{t(lang, 'decks.importBtn')}</button>
                <button type="button" className="btn small" onClick={() => setQuickOpen(false)}>{t(lang, 'decks.exportClose')}</button>
                {bulkReport && <p className="help">{bulkReport}</p>}
              </div>
            )}
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
                          className={`rarity-row ${raritySlug(row.rarity)}`}
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
          <div className="binder-view">
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
                          className={`rarity-row ${raritySlug(row.rarity)}${active ? ' active' : ''}`}
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
              <DomainFilterRow value={domainFilter} onChange={setDomainFilter} lang={lang} />
              <RarityMenu
                lang={lang}
                open={rarityMenuOpen}
                setOpen={setRarityMenuOpen}
                signed={raritySigned}
                setSigned={setRaritySigned}
                over={rarityOver}
                setOver={setRarityOver}
                promo={rarityPromo}
                setPromo={setRarityPromo}
                ultimate={rarityUltimate}
                setUltimate={setRarityUltimate}
                menuRef={rarityMenuRef}
              />
            </div>

            <div className="binder-scroll">
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
                return (
                  <CardTile
                    key={c.id}
                    c={c}
                    o={o}
                    lang={lang}
                    priceEntry={priceBook?.cards[c.id]}
                    variant="binder"
                    onOpen={openCardLightbox}
                    onBump={bump}
                  />
                )
              })}
            </div>
            </div>
          </div>
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
              <DomainFilterRow value={domainFilter} onChange={setDomainFilter} lang={lang} />
              <RarityMenu
                lang={lang}
                open={rarityMenuOpen}
                setOpen={setRarityMenuOpen}
                signed={raritySigned}
                setSigned={setRaritySigned}
                over={rarityOver}
                setOver={setRarityOver}
                promo={rarityPromo}
                setPromo={setRarityPromo}
                ultimate={rarityUltimate}
                setUltimate={setRarityUltimate}
                menuRef={rarityMenuRef}
              />
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
                  <CardTile
                    key={c.id}
                    c={c}
                    o={o}
                    lang={lang}
                    priceEntry={priceBook?.cards[c.id]}
                    variant="catalog"
                    onOpen={openCardLightbox}
                    onBump={bump}
                  />
                )
              })}
            </div>
          </>
        )}

        {tab === 'sales' && (
          <div className="split deck-split">
            <section className="panel col-fill">
              <div className="toolbar">
                <h2 style={{ margin: 0, flex: 1 }}>{t(lang, 'sales.cart')}</h2>
                {saleSelectedCount > 0 && (
                  <span className="sub">{t(lang, 'sales.selected', { cards: saleSelectedCount, copies: saleSelectedCopies, cardWord: cardWord(lang, saleSelectedCount), copyWord: copyWord(lang, saleSelectedCopies) })}</span>
                )}
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
                className={`list ${saleCartDropClass()}`}
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
                      <DeckThumb src={c.image} onOpen={() => openCardLightbox(c)} openTitle={t(lang, 'card.enlarge')} zoomIcon />
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
            <section className="panel col-fill">
              <h2>{t(lang, 'sales.addTitle')}</h2>
              <input
                className="search"
                placeholder={t(lang, 'sales.searchOwned')}
                value={saleQ}
                onChange={(e) => setSaleQ(e.target.value)}
                style={{ marginBottom: 10 }}
              />
              <div className="list">
                {saleHits.map((c) => {
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
                      <DeckThumb src={c.image} onOpen={() => openCardLightbox(c)} openTitle={t(lang, 'card.enlarge')} zoomIcon />
                      <div className="grow">
                        <button
                          type="button"
                          className="name name-link"
                          title={t(lang, 'price.openCm')}
                          disabled={!priceBook?.cards[c.id]?.cmUrl}
                          onClick={(e) => { e.stopPropagation(); openCm(priceBook?.cards[c.id]) }}
                        >{displayName(c)}</button>
                        <div className="sub">{c.code} · x{have}{room < have ? t(lang, 'sales.inCart', { n: have - room }) : ''}</div>
                        <PriceBits entry={priceBook?.cards[c.id]} lang={lang} />
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
                {ownedCards.length > 0 && saleHits.length === 0 && (
                  <div className="empty">{t(lang, 'sales.noHits', { q: saleQ.trim() })}</div>
                )}
              </div>
              <div className="quick-import" style={{ margin: '10px 0 0' }}>
                <span className="quick-import-label">{t(lang, 'sales.pasteTitle')}</span>
                <textarea
                  className="field"
                  rows={2}
                  value={salePaste}
                  onChange={(e) => setSalePaste(e.target.value)}
                  placeholder={t(lang, 'sales.pastePh')}
                />
                <button className="btn primary small" disabled={!salePaste.trim()} onClick={applySalePaste}>
                  {t(lang, 'sales.toCart')}
                </button>
                <button className="btn small" disabled={!salePaste.trim()} onClick={() => setSalePaste('')}>
                  {t(lang, 'sales.clear')}
                </button>
              </div>
            </section>
          </div>
        )}

        {tab === 'decks' && (
          <div className="split deck-split">
            <section className="panel deck-list-panel">
              <div className="toolbar">
                <h2 style={{ margin: 0, flex: 1 }}>{t(lang, 'decks.title')}</h2>
                <button className="btn" disabled={!activeDeck} onClick={openDeckExport}>{t(lang, 'decks.export')}</button>
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
                  const legendId = d.cards.find((c) => sectionOf(c) === 'legend')?.id
                  const legendImg = legendId ? byId.get(legendId)?.image : undefined
                  return (
                    <div
                      key={d.id}
                      data-deck-id={d.id}
                      className={`deck-acc-item${expanded ? ' expanded active' : ''}`}
                    >
                      <div
                        className="deck-acc-head"
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          if (deckDragged.current) return
                          if (expanded) setActiveDeckId(null)
                          else {
                            setActiveDeckId(d.id)
                            setActiveSection('main')
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return
                          e.preventDefault()
                          if (expanded) setActiveDeckId(null)
                          else {
                            setActiveDeckId(d.id)
                            setActiveSection('main')
                          }
                        }}
                      >
                        <span
                          className="deck-drag"
                          title={t(lang, 'decks.reorder')}
                          aria-label={t(lang, 'decks.reorder')}
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => onDeckReorderPointerDown(e, d.id)}
                        >⠿</span>
                        <span className="deck-acc-chevron" aria-hidden>{expanded ? '▾' : '▸'}</span>
                        {legendImg && <DeckThumb src={legendImg} />}
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
                          <div className="deck-acc-summary-row">
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
                            <button
                              type="button"
                              className="btn icon danger deck-trash"
                              title={t(lang, 'decks.delete')}
                              aria-label={t(lang, 'decks.delete')}
                              onClick={(e) => {
                                e.stopPropagation()
                                setDecks((prev) => prev.filter((x) => x.id !== d.id))
                                setActiveDeckId(null)
                              }}
                            >
                              🗑
                            </button>
                          </div>
                          {renderOpenDeck()}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

            </section>

            <section className="panel col-fill">
              <h2>{t(lang, 'decks.cardsTitle', { section: SECTION_LABEL[activeSection] })}</h2>
              <div className="toolbar">
                <input className="search grow" placeholder={t(lang, 'decks.search')} value={q} onChange={(e) => setQ(e.target.value)} />
                <label className="pill">
                  <input type="checkbox" checked={deckOwnedOnly} onChange={(e) => setDeckOwnedOnly(e.target.checked)} /> {t(lang, 'catalog.ownedOnly')}
                </label>
              </div>
              <div className="list">
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
                      c.code.toLowerCase().includes(query) ||
                      (legendIds.get(c.name.toLowerCase()) || '').includes(query)
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
                      <DeckThumb src={c.image} onOpen={() => openCardLightbox(c)} openTitle={t(lang, 'card.enlarge')} />
                      <div className="grow">
                        <div className="name-with-ban">
                          <button
                            type="button"
                            className="name name-link"
                            title={t(lang, 'price.openCm')}
                            disabled={!priceBook?.cards[c.id]?.cmUrl}
                            onClick={(e) => { e.stopPropagation(); openCm(priceBook?.cards[c.id]) }}
                          >{displayName(c)}</button>
                          <BanBadge status={banStatus(c)} lang={lang} />
                        </div>
                        <div className="sub">{c.code} · x{ownedQty(collection[c.id])}{c.energy != null ? ` · E${c.energy}` : ''}</div>
                        <PriceBits entry={priceBook?.cards[c.id]} lang={lang} />
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

        {tab === 'borrowed' && (
          <div className="split deck-split">
            <section className="panel">
              <div className="toolbar">
                <h2 style={{ margin: 0, flex: 1 }}>{t(lang, 'borrowed.title')}</h2>
                <button
                  className="btn"
                  disabled={!activeBorrowed}
                  onClick={() => {
                    setBorrowImportOpen((v) => !v)
                    setBorrowImportText('')
                  }}
                >{t(lang, 'borrowed.import')}</button>
                <button className="btn primary" onClick={newBorrowedGroup}>{t(lang, 'borrowed.new')}</button>
              </div>
              <p className="help">{t(lang, 'borrowed.help')}</p>
              <div className="deck-accordion" style={{ marginBottom: 12 }}>
                {borrowed.length === 0 && <div className="empty">{t(lang, 'borrowed.empty')}</div>}
                {borrowed.map((g) => {
                  const expanded = g.id === activeBorrowedId
                  return (
                    <div key={g.id} className={`deck-acc-item${expanded ? ' expanded' : ''}${expanded ? ' active' : ''}`}>
                      <div
                        className="deck-acc-head"
                        role="button"
                        tabIndex={0}
                        onClick={() => setActiveBorrowedId(g.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setActiveBorrowedId(g.id)
                          }
                        }}
                      >
                        <span className="deck-acc-chevron" aria-hidden>{expanded ? '▾' : '▸'}</span>
                        <div className="grow deck-acc-title">
                          {expanded ? (
                            <input
                              className="field deck-acc-name-input"
                              value={g.name}
                              onChange={(e) => updateBorrowed((group) => ({ ...group, name: e.target.value }))}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                              aria-label={t(lang, 'borrowed.rename')}
                            />
                          ) : (
                            <span className="name">{g.name}</span>
                          )}
                          <span className="deck-acc-count">· {t(lang, 'borrowed.cardCount', { n: groupCardCount(g) })}</span>
                        </div>
                        {expanded && <span className="pill ok">{t(lang, 'borrowed.active')}</span>}
                      </div>
                      {expanded && (
                        <div className="deck-acc-body">
                          <div className="deck-acc-summary-row">
                            <div className="grow" />
                            <button
                              type="button"
                              className="btn icon danger deck-trash"
                              title={t(lang, 'borrowed.delete')}
                              aria-label={t(lang, 'borrowed.delete')}
                              onClick={(e) => {
                                e.stopPropagation()
                                setBorrowed((prev) => prev.filter((x) => x.id !== g.id))
                                setActiveBorrowedId(null)
                              }}
                            >
                              🗑
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {activeBorrowed && (
                <>
                  {borrowImportOpen && (
                    <div className="deck-import-box">
                      <p className="help" style={{ margin: 0 }}>{t(lang, 'borrowed.importHint')}</p>
                      <textarea
                        className="field"
                        placeholder={"Champion:\n1 Rengar, Trophy Hunter\n\nCards:\n1 Darius, Trifarian\n2 Ferrous Forerunner\n\nBattlefields:\n1 Emperor's Dais"}
                        value={borrowImportText}
                        onChange={(e) => setBorrowImportText(e.target.value)}
                        rows={10}
                      />
                      <div className="toolbar" style={{ marginBottom: 0 }}>
                        <button
                          className="btn primary"
                          disabled={!borrowImportText.trim()}
                          onClick={() => runBorrowImport(borrowImportText)}
                        >{t(lang, 'borrowed.importBtn')}</button>
                      </div>
                    </div>
                  )}

                  {borrowNotice && (
                    <div className="deck-notice" role="status">
                      <span>{borrowNotice}</span>
                      <button type="button" className="btn small" onClick={() => setBorrowNotice(null)}>OK</button>
                    </div>
                  )}

                  <div
                    className={borrowDropClass()}
                    style={{ marginTop: 12 }}
                    onDragOver={onBorrowDragOver}
                    onDragLeave={onBorrowDragLeave}
                    onDrop={onBorrowDrop}
                  >
                    {activeBorrowed.cards.length === 0 && (
                      <div className="empty">{t(lang, 'borrowed.emptyCards')}</div>
                    )}
                    {activeBorrowed.cards.map((bc) => {
                      const c = byId.get(bc.id)
                      const have = ownedQty(collection[bc.id])
                      const avail = availableForDecks(bc.id)
                      const room = remainingToLend(bc.id)
                      const img = c?.image
                      return (
                        <div
                          key={bc.id}
                          className="list-item deck-card-row"
                          onMouseEnter={(e) => showCardPreview(e, img)}
                          onMouseMove={(e) => showCardPreview(e, img)}
                          onMouseLeave={hideCardPreview}
                        >
                          {img ? (
                            <img
                              className="deck-thumb"
                              src={img}
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
                              disabled={!priceBook?.cards[bc.id]?.cmUrl}
                              onClick={() => openCm(priceBook?.cards[bc.id])}
                            >{c ? displayCardName(c) : bc.id}</button>
                            <div className="sub">
                              {c ? `${c.code} · ` : ''}{t(lang, 'borrowed.ownedAvail', { have, avail })}
                            </div>
                          </div>
                          <div className="qty" onClick={(e) => e.stopPropagation()}>
                            <button type="button" onClick={() => bumpBorrowedCard(bc.id, -1)}>−</button>
                            <b>{bc.qty}</b>
                            <button
                              type="button"
                              disabled={room <= 0}
                              title={room <= 0 ? t(lang, 'borrowed.noAvail') : undefined}
                              onClick={() => bumpBorrowedCard(bc.id, 1)}
                            >+</button>
                          </div>
                          <button
                            type="button"
                            className="btn icon danger deck-trash deck-card-trash"
                            title={t(lang, 'borrowed.removeCard')}
                            aria-label={t(lang, 'borrowed.removeCard')}
                            onClick={(e) => {
                              e.stopPropagation()
                              removeBorrowedCard(bc.id)
                            }}
                          >
                            🗑
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}

              {!activeBorrowed && borrowed.length > 0 && (
                <div className="empty">{t(lang, 'borrowed.pickFirst')}</div>
              )}
            </section>

            <section className="panel">
              <h2>{t(lang, 'borrowed.cardsTitle')}</h2>
              <div className="toolbar">
                <input
                  className="search grow"
                  placeholder={t(lang, 'decks.search')}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                <select
                  className="select"
                  style={{ maxWidth: 160 }}
                  value={setFilter}
                  onChange={(e) => setSetFilter(e.target.value)}
                >
                  <option value="">{t(lang, 'catalog.allSets')}</option>
                  {Object.entries(sets).map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
              </div>
              <div className="list" style={{ maxHeight: '70vh', overflow: 'auto' }}>
                {!activeBorrowed && <div className="empty">{t(lang, 'borrowed.pickFirst')}</div>}
                {activeBorrowed && (() => {
                  const query = q.trim().toLowerCase()
                  const owned = cards.filter((c) => {
                    if (ownedQty(collection[c.id]) <= 0) return false
                    if (remainingToLend(c.id) <= 0) return false
                    if (setFilter && c.set !== setFilter) return false
                    if (!query) return true
                    return (
                      c.name.toLowerCase().includes(query) ||
                      (c.subtitle || '').toLowerCase().includes(query) ||
                      c.code.toLowerCase().includes(query)
                    )
                  })
                  if (owned.length === 0) {
                    return <div className="empty">{t(lang, 'borrowed.noneOwned')}</div>
                  }
                  return owned.slice(0, 120).map((c) => {
                    const room = remainingToLend(c.id)
                    const have = ownedQty(collection[c.id])
                    return (
                      <div
                        key={c.id}
                        className="list-item picker-card"
                        draggable={!!activeBorrowed && room > 0}
                        onDragStart={(e) => onPickerDragStart(e, c.id)}
                        onDragEnd={onPickerDragEnd}
                        onMouseEnter={(e) => showCardPreview(e, c.image)}
                        onMouseMove={(e) => showCardPreview(e, c.image)}
                        onMouseLeave={hideCardPreview}
                      >
                        <DeckThumb src={c.image} />
                        <div className="grow">
                          <div className="name-with-ban">
                            <button
                              type="button"
                              className="name name-link"
                              title={t(lang, 'price.openCm')}
                              disabled={!priceBook?.cards[c.id]?.cmUrl}
                              onClick={(e) => { e.stopPropagation(); openCm(priceBook?.cards[c.id]) }}
                            >{displayCardName(c)}</button>
                            <BanBadge status={banStatus(c)} lang={lang} />
                          </div>
                          <div className="sub">
                            {c.code} · x{have} · {t(lang, 'borrowed.availShort', { n: room })}
                            {c.energy != null ? ` · E${c.energy}` : ''}
                          </div>
                          <PriceBits entry={priceBook?.cards[c.id]} lang={lang} />
                        </div>
                        <button
                          className="btn small primary"
                          disabled={!activeBorrowed || room <= 0}
                          title={room <= 0 ? t(lang, 'borrowed.noAvail') : undefined}
                          onClick={() => bumpBorrowedCard(c.id, 1)}
                        >
                          {t(lang, 'borrowed.add')}
                        </button>
                      </div>
                    )
                  })
                })()}
              </div>
            </section>
          </div>
        )}

        {tab === 'stores' && (
          <div className="stores-page">
            <div className="stores-search">
              <input
                className="field stores-query"
                value={storeQuery}
                onChange={(e) => setStoreQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void runStoreSearch() }}
                placeholder={t(lang, 'stores.queryPh')}
                aria-label={t(lang, 'stores.query')}
              />
              <div className="stores-radius-row" title={t(lang, 'stores.radius')}>
                <input
                  type="range"
                  className="stores-km-slider"
                  min={STORE_RADIUS_KM_MIN}
                  max={STORE_RADIUS_KM_MAX}
                  step={1}
                  value={storeKm}
                  disabled={storeAllGermany}
                  onChange={(e) => setStoreKmFromUi(Number(e.target.value))}
                  aria-label={t(lang, 'stores.radius')}
                />
                <input
                  type="number"
                  className="field stores-km-input"
                  min={STORE_RADIUS_KM_MIN}
                  max={STORE_RADIUS_KM_MAX}
                  value={storeKm}
                  disabled={storeAllGermany}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    if (!Number.isFinite(n)) return
                    setStoreKmFromUi(n)
                  }}
                  onBlur={() => setStoreKmFromUi(storeKm)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void runStoreSearch() }}
                />
                <span className="sub stores-km-unit">{t(lang, 'stores.kmUnit')}</span>
              </div>
              <button
                type="button"
                className={`btn${storeAllGermany ? ' primary' : ''}`}
                aria-pressed={storeAllGermany}
                disabled={storeBusy}
                onClick={() => {
                  if (storeAllGermany) {
                    setStoreAllGermany(false)
                    setStoreHits([])
                    setStoreCenter(null)
                    setStoreLabel(null)
                    return
                  }
                  setStoreAllGermany(true)
                  void runGermanySearch()
                }}
              >{t(lang, 'stores.allGermany')}</button>
              <button
                type="button"
                className={`btn${storeStockOnly ? ' primary' : ''}`}
                aria-pressed={storeStockOnly}
                title={t(lang, 'stores.stockOnlyHint')}
                onClick={() => setStoreStockOnly((v) => !v)}
              >{t(lang, 'stores.stockOnly')}</button>
              <button className="btn primary" disabled={storeBusy} onClick={() => void runStoreSearch()}>
                {storeBusy ? t(lang, 'stores.searching') : t(lang, 'stores.search')}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => openStoreLink(STORE_LOCATOR_URL)}
              >{t(lang, 'stores.openOfficial')}</button>
            </div>
            <p className="help stores-help">{t(lang, 'stores.help')}</p>
            {storeError && <p className="help" style={{ color: 'var(--danger)' }}>{storeError}</p>}
            {storeLabel && !storeError && (
              <p className="help stores-help">{storeAllGermany ? t(lang, 'stores.allGermany') : t(lang, 'stores.near', { label: storeLabel })} · {t(lang, 'stores.results', { n: visibleStoreHits.length })}
                {!storeAllGermany && storeKm > storeFetchedKm + 0.5 ? ` · ${t(lang, 'stores.enlargeHint')}` : ''}
              </p>
            )}
            <div className="stores-body">
              <section className="panel stores-map-panel">
                <StoresMap
                  center={storeCenter}
                  radiusKm={storeKm}
                  hits={visibleStoreHits}
                  fitHits={storeAllGermany}
                  emptyHint={t(lang, 'stores.mapHint')}
                />
              </section>
              <section className="panel stores-list-panel">
                <div className="stores-results">
                  {!storeLabel && <div className="empty">{t(lang, 'stores.listHint')}</div>}
                  {!storeBusy && storeLabel && visibleStoreHits.length === 0 && (
                    <div className="empty">{storeStockOnly ? t(lang, 'stores.emptyStock') : storeAllGermany ? t(lang, 'stores.emptyGermany') : t(lang, 'stores.empty')}</div>
                  )}
                  {visibleStoreHits.map((h) => {
                    const STOCK_PREVIEW = 4
                    const products = h.products
                    const open = !!storeStockOpen[h.id]
                    const shown = products
                      ? (open ? products : products.slice(0, STOCK_PREVIEW))
                      : []
                    const canToggle = !!products && products.length > STOCK_PREVIEW
                    return (
                      <article key={h.id} className="store-card">
                        <div className="store-card-top">
                          <div className="name">{h.name}</div>
                          {h.distanceKm != null && (
                            <div className="store-dist">{t(lang, 'stores.distance', { km: h.distanceKm.toFixed(1) })}</div>
                          )}
                        </div>
                        {h.address && <div className="store-contact">{h.address}</div>}
                        {h.phone && <div className="store-contact">{t(lang, 'stores.phone')}: {h.phone}</div>}
                        {h.email && (
                          <div className="store-contact">
                            {t(lang, 'stores.email')}:{' '}
                            <a href={`mailto:${h.email}`} onClick={(e) => { e.preventDefault(); openStoreLink(`mailto:${h.email}`) }}>{h.email}</a>
                          </div>
                        )}
                        <div className="store-actions">
                          {h.website && (
                            <button type="button" className="btn small" onClick={() => openStoreLink(websiteUrl(h.website!))}>
                              {t(lang, 'stores.website')}
                            </button>
                          )}
                          <button type="button" className="btn small" onClick={() => openStoreLink(mapsUrl(h))}>
                            {t(lang, 'stores.maps')}
                          </button>
                        </div>
                        {products && shown.length > 0 ? (
                          <ul className="store-stock">
                            {shown.map((p) => (
                              <li key={p.name}>
                                <span className={p.available ? 'ok' : 'no'}>{p.available ? t(lang, 'stores.inStock') : t(lang, 'stores.outOfStock')}</span>
                                {' · '}{p.name}
                              </li>
                            ))}
                            {canToggle && (
                              <li>
                                <button
                                  type="button"
                                  className="store-stock-more"
                                  onClick={() => setStoreStockOpen((prev) => ({ ...prev, [h.id]: !open }))}
                                >
                                  {open ? t(lang, 'stores.showLess') : t(lang, 'stores.showMore')}
                                </button>
                              </li>
                            )}
                          </ul>
                        ) : (
                          <div className="store-unknown">{t(lang, 'stores.stockUnknown')}</div>
                        )}
                      </article>
                    )
                  })}
                </div>
              </section>
            </div>
          </div>
        )}

      </main>
      {deckExportText != null && (
        <div
          className="card-lightbox"
          role="dialog"
          aria-modal="true"
          aria-labelledby="deck-export-title"
          onClick={() => setDeckExportText(null)}
        >
          <div className="panel confirm-box deck-export-box" onClick={(e) => e.stopPropagation()}>
            <h2 id="deck-export-title">{t(lang, 'decks.exportTitle')}</h2>
            <textarea className="field" readOnly rows={12} value={deckExportText} onFocus={(e) => e.currentTarget.select()} />
            <div className="confirm-actions">
              <button type="button" className="btn small" onClick={() => setDeckExportText(null)}>{t(lang, 'decks.exportClose')}</button>
              <button type="button" className="btn small primary" onClick={() => void copyDeckExport()}>
                {deckExportCopied ? t(lang, 'decks.copied') : t(lang, 'decks.copy')}
              </button>
            </div>
          </div>
        </div>
      )}
      {clearSec && (
        <div
          className="card-lightbox"
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-sec-title"
          onClick={() => setClearSec(null)}
        >
          <div className="panel confirm-box" onClick={(e) => e.stopPropagation()}>
            <h2 id="clear-sec-title">Deakrix Riftbound Tracker</h2>
            <p className="help" style={{ margin: 0 }}>{t(lang, 'decks.clearSectionConfirm', { section: SECTION_LABEL[clearSec] })}</p>
            <div className="confirm-actions">
              <button type="button" className="btn small" onClick={() => setClearSec(null)}>{t(lang, 'decks.clearCancel')}</button>
              <button
                type="button"
                className="btn small deck-trash"
                onClick={() => {
                  const sec = clearSec
                  setClearSec(null)
                  clearDeckSection(sec)
                }}
              >{t(lang, 'decks.clearConfirm')}</button>
            </div>
          </div>
        </div>
      )}
      {cardPreview && !cardLightbox && (
        <div
          className="card-float-preview"
          style={{ left: cardPreview.x, top: cardPreview.y }}
          aria-hidden
        >
          <img src={cardPreview.src} alt="" />
        </div>
      )}
      {cardLightbox && (
        <div
          className="card-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={t(lang, 'card.enlarge')}
          onClick={closeCardLightbox}
        >
          <div className="card-lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="card-lightbox-close"
              onClick={closeCardLightbox}
              title={t(lang, 'card.enlargeClose')}
              aria-label={t(lang, 'card.enlargeClose')}
            >×</button>
            <div className="card-lightbox-art">
              {cardLightbox.image ? (
                <img src={cardLightbox.image} alt={displayName(cardLightbox)} />
              ) : (
                <div className="card-lightbox-noart">{t(lang, 'card.noArt')}</div>
              )}
            </div>
            <div className="card-lightbox-meta">
              <div className="name-with-ban">
                {priceBook?.cards[cardLightbox.id]?.cmUrl ? (
                  <button
                    type="button"
                    className="card-lightbox-title card-lightbox-title-link"
                    onClick={() => openCm(priceBook?.cards[cardLightbox.id])}
                    title={t(lang, 'card.ocrOpenCm')}
                  >{displayName(cardLightbox)}</button>
                ) : (
                  <h2 className="card-lightbox-title">{displayName(cardLightbox)}</h2>
                )}
                <BanBadge status={banStatus(cardLightbox)} lang={lang} />
              </div>
              <p className="sub">{cardLightbox.code} · {cardLightbox.setName || cardLightbox.set}</p>
              <p className="help" style={{ marginTop: 4 }}>{t(lang, rulesSource === 'catalog' ? 'card.enlargeHintCatalog' : 'card.enlargeHint')}</p>
              <dl className="card-lightbox-dl">
                <div><dt>{t(lang, 'card.types')}</dt><dd>{(cardLightbox.types || []).join(', ') || '—'}</dd></div>
                <div><dt>{t(lang, 'card.domains')}</dt><dd>{(cardLightbox.domains || []).join(', ') || '—'}</dd></div>
                <div><dt>{t(lang, 'card.rarity')}</dt><dd>{cardLightbox.rarity || '—'}</dd></div>
                <div><dt>{t(lang, 'card.energy')}</dt><dd>{cardLightbox.energy != null ? cardLightbox.energy : '—'}</dd></div>
                <div><dt>{t(lang, 'card.might')}</dt><dd>{cardLightbox.might != null ? cardLightbox.might : '—'}</dd></div>
              </dl>
              <div className="card-ocr">
                <div className="card-ocr-head">
                  <strong>{t(lang, rulesSource === 'catalog' ? 'card.rulesTitle' : 'card.ocrTitle')}</strong>
                  <span className="card-ocr-note">{t(lang, rulesSource === 'catalog' ? 'card.rulesNote' : 'card.ocrNote')}</span>
                </div>
                {ocrLoading && (
                  <p className="card-ocr-status">{t(lang, 'card.ocrLoading')}</p>
                )}
                {!ocrLoading && ocrEmpty && (
                  <p className="card-ocr-status muted">{t(lang, 'card.ocrEmpty')}</p>
                )}
                {!ocrLoading && ocrText && rulesSource === 'catalog' && (
                  <div className="card-ocr-text"><RulesText text={ocrText} /></div>
                )}
                {!ocrLoading && ocrText && rulesSource !== 'catalog' && (
                  <pre className="card-ocr-text">{ocrText}</pre>
                )}
              </div>
              {(() => {
                const fromOcr = ocrText ? detectKeywordsInText(ocrText) : []
                const fromBook = keywordsForCard(cardLightbox)
                const merged: KeywordId[] = []
                const seen = new Set<KeywordId>()
                for (const id of [...fromOcr, ...fromBook]) {
                  if (!seen.has(id)) { seen.add(id); merged.push(id) }
                }
                if (!merged.length) return null
                return (
                  <div className="card-keywords card-keywords-mini">
                    <div className="card-keywords-head">
                      <strong>{t(lang, 'card.keywords')}</strong>
                      <span className="card-keywords-hint">{t(lang, 'card.keywordsHint')}</span>
                    </div>
                    <ul className="card-keywords-list">
                      {merged.map((id) => {
                        const open = kwExpanded === id
                        return (
                          <li key={id} className="card-keyword on-card">
                            <button
                              type="button"
                              className="card-keyword-toggle"
                              aria-expanded={open}
                              onClick={() => setKwExpanded(open ? null : id)}
                            >
                              <span className="card-keyword-name">{t(lang, `kw.${id}.name`)}</span>
                              <span className="card-keyword-chev">{open ? '▾' : '▸'}</span>
                            </button>
                            {open && (
                              <p className="card-keyword-blurb">{t(lang, `kw.${id}.blurb`)}</p>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )
              })()}
              {priceBook?.cards[cardLightbox.id]?.cmUrl && (
                <button
                  type="button"
                  className="btn"
                  style={{ marginTop: 10 }}
                  onClick={() => openCm(priceBook?.cards[cardLightbox.id])}
                >{t(lang, 'price.openCm')}</button>
              )}
            </div>
          </div>
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
