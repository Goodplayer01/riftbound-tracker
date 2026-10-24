import { useDeferredValue, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import { fetchRemotePrices, loadBundledPrices, loadCachedPrices, newerPriceBook } from './prices'
import type { BorrowedCard, BorrowedGroup, Card, Catalog, Deck, DeckSection, PriceBook, PriceEntry } from './types'
import { backupOnce, loadAlertsSeen, loadBorrowed, loadCollection, loadCopies, loadDecks, loadSales, loadWish, loadWishTargets, saveAlertsSeen, saveBorrowed, saveCollection, saveCopies, saveDecks, saveSales, saveWish, saveWishTargets, type Collection } from './storage'
import { csvSeparator, ownedQty, splitCsv, subtractOwnedCopies } from './collection'
import { fmtEur, loadLang, saveLang, t, type Lang } from './i18n'
import { Dopamin } from './Dopamin'
import { SearchInput } from './SearchInput'
import {
  detectKeywordsInText,
  keywordsForCard,
  setCardKeywordBook,
  type CardKeywordBook,
} from './keywords'
import { parseBulkTokens, resolveToken } from './parseBulk'
import { LENT_HEADER, formatBorrowList, parseBorrowList } from './borrowList'
import {
  SECTION_CAPS,
  SECTION_LABEL,
  SECTION_ORDER,
  isDeckComplete,
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
import { StoreDisplays } from './StoreDisplays'
import {
  OPENING_HAND_SIZE,
  applyMulligan,
  dealOpeningHand,
  drawPoolSize,
  drawTopCard,
} from './handTester'
import { downloadSharePng, renderDeckShareCanvas } from './deckScreenshot'
import { Icon } from './Icon'
import { sellText, stockCsv, wantsText, type CmLine } from './cardmarket'
import { historyPoints, loadPriceHistory, type PriceHistoryFile } from './priceHistory'
import { ValueHistory, type InvestRow } from './ValueHistory'
import { CONDITION_FACTOR, cardEur, cardInvest, copyGroups, fitCopyBook, soldGroups, unitEur, type CopyBook, type CopyLot } from './copies'
import { CopyEditor, MoneyInput, fmtSignedEur } from './CopyEditor'
import { cardArt, cardThumb, loadThumbIndex, preloadArt, thumbForImage } from './cardImages'

type Tab = 'collection' | 'owned' | 'catalog' | 'sales' | 'decks' | 'borrowed' | 'stores' | 'dopamin'

function uid() {
  return crypto.randomUUID()
}

/** Rare and up (plus alt, overnumbered, signed) only exist as foil: one counter, stored as foil. */
const FOIL_ONLY_RARITIES = new Set(['Rare', 'Epic', 'Showcase', 'Ultimate Rare'])
function isFoilOnly(c: Card) {
  return FOIL_ONLY_RARITIES.has(c.rarity || '') || !!(c.altArt || c.signed || c.overnumbered)
}

/** Plain runes (not alt art) are bulk: no foil version, worth 0 €. */
function isPlainRune(c: Card) {
  return (c.types || []).includes('Rune') && !isFoilOnly(c)
}

/** Plain rune prices as 0 € (no foil price), so every value and total ignores them. */
function zeroPlainRunes(book: PriceBook | null, cards: Card[]): PriceBook | null {
  if (!book) return book
  const out = { ...book.cards }
  for (const c of cards) {
    const p = out[c.id]
    if (p && isPlainRune(c)) out[c.id] = { ...p, low: 0, trend: 0, high: null, avg30: null, foilLow: null, foilTrend: null }
  }
  return { ...book, cards: out }
}

/** At least one foil copy (every copy of a foil only card is foil). */
function hasFoilCopy(c: Card, o?: { qty: number; foil: number }) {
  return (o?.foil || 0) > 0 || (isFoilOnly(c) && ownedQty(o) > 0)
}

/** Moves normal copies of foil only cards to foil, and foil plain runes to normal. Returns the same object when nothing changes. */
function foldFoilOnly(col: Collection, byId: Map<string, Card>): Collection {
  let out = col
  for (const [id, o] of Object.entries(col)) {
    const c = byId.get(id)
    if (!c) continue
    if (o.qty && isFoilOnly(c)) {
      if (out === col) out = { ...col }
      out[id] = { ...o, qty: 0, foil: (o.foil || 0) + o.qty }
    } else if (o.foil && isPlainRune(c)) {
      if (out === col) out = { ...col }
      out[id] = { ...o, qty: (o.qty || 0) + o.foil, foil: 0 }
    }
  }
  return out
}

/** Total copies per card across the lent groups, or across the borrowed-from groups with `from`. */
function borrowedQtyById(groups: BorrowedGroup[], from = false): Map<string, number> {
  const m = new Map<string, number>()
  for (const g of groups) {
    if ((g.direction === 'from') !== from) continue
    for (const c of g.cards) {
      m.set(c.id, (m.get(c.id) || 0) + c.qty)
    }
  }
  return m
}

/** Per card: who you borrowed copies from and how many each (borrowed-from groups only). */
function borrowedFromById(groups: BorrowedGroup[]): Map<string, { name: string; n: number }[]> {
  const m = new Map<string, { name: string; n: number }[]>()
  for (const g of groups) {
    if (g.direction !== 'from') continue
    for (const c of g.cards) {
      if (c.qty > 0) m.set(c.id, [...(m.get(c.id) || []), { name: g.name.trim() || '?', n: c.qty }])
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



function BanBadge({ status, lang }: { status: BanStatus; lang: Lang }) {
  if (!status) return null
  const key = status === 'banned2v2' ? 'decks.banned2v2' : 'decks.banned'
  return (
    <span className={`ban-badge${status === 'banned2v2' ? ' ban-2v2' : ''}`}>
      {t(lang, key)}
    </span>
  )
}

/** Same pill as the ban badge, one per person you borrowed copies from. */
function BorrowedBadge({ from, lang, short }: { from?: { name: string; n: number }[]; lang: Lang; short?: boolean }) {
  if (!from?.length) return null
  // The count sits outside the name span, so a long name is cut but the count stays visible.
  // Short (narrow deck rows): just the name, the purple pill already says borrowed.
  return <>{from.map((b, i) => {
    const label = t(lang, 'borrowed.badge', { name: b.name })
    return <span key={i} className="ban-badge borrowed-badge" title={`${label} ×${b.n}`}><span className="borrowed-name">{short ? b.name : label}</span>&nbsp;×{b.n}</span>
  })}</>
}

/** Same pill as the ban badge, for cards with official errata. */
function ErrataBadge({ show, lang }: { show: boolean; lang: Lang }) {
  if (!show) return null
  return <span className="ban-badge errata-badge" title={t(lang, 'card.errataHint')}>{t(lang, 'card.errata')}</span>
}

/** A row or tile click opens the card detail, except on the row's own buttons and inputs. */
function isControlClick(e: ReactMouseEvent) {
  return !!(e.target as HTMLElement).closest('button, input, select, textarea, a, [role="button"]')
}

/** Set code pill next to the card name; full set name on hover. */
function SetBadge({ c }: { c: Card }) {
  if (!c.set) return null
  return <span className="ban-badge set-badge" title={c.setName || c.set}>{c.set}</span>
}

function cardWord(lang: Lang, n: number) {
  return lang === 'de' ? (n === 1 ? 'Karte' : 'Karten') : (n === 1 ? 'card' : 'cards')
}

function copyWord(lang: Lang, n: number) {
  return lang === 'de' ? (n === 1 ? 'Kopie' : 'Kopien') : (n === 1 ? 'copy' : 'copies')
}

function priceLabel(lang: Lang, p?: PriceEntry) {
  if (!p) return null
  const low = fmtEur(lang, p.low)
  const high = fmtEur(lang, p.high ?? null)
  const avg30 = fmtEur(lang, p.avg30 ?? null)
  const foil = fmtEur(lang, p.foilLow) || fmtEur(lang, p.foilTrend)
  return { low, high, avg30, foil, cmId: p.cmId || null, cmUrl: p.cmUrl || null }
}

function PriceBits({ entry, lang, showHigh = false, foilOnly = false, boxed = false }: { entry?: PriceEntry; lang: Lang; showHigh?: boolean; foilOnly?: boolean; boxed?: boolean }) {
  const pl = priceLabel(lang, entry)
  if (!pl || (!pl.low && !pl.avg30 && !pl.high && !pl.foil)) return null
  if (boxed) {
    // Card tiles: small label over value, like the price tiles in the card detail.
    const p = foilOnly ? fmtEur(lang, entry?.foilLow || entry?.foilTrend || entry?.low || entry?.trend || null) : null
    const boxes = (foilOnly
      ? [{ k: 'Foil', v: p, title: 'price.foil', cls: 'foil' }]
      : [
          { k: t(lang, 'price.from'), v: pl.low, title: 'price.low', cls: '' },
          pl.avg30 && { k: 'Ø30', v: pl.avg30, title: 'price.avg30', cls: '' },
          pl.foil && { k: 'Foil', v: pl.foil, title: 'price.foil', cls: 'foil' },
        ]).filter(Boolean) as { k: string; v: string | null; title: string; cls: string }[]
    return (
      <div className="price-boxes">
        {boxes.map((b) => (
          <div key={b.title} className={`price-box ${b.cls}`} title={t(lang, b.title)}><span>{b.k}</span><b>{b.v || '–'}</b></div>
        ))}
      </div>
    )
  }
  if (foilOnly) {
    const p = fmtEur(lang, entry?.foilLow || entry?.foilTrend || entry?.low || entry?.trend || null)
    return <div className="price">{p ? <span className="foil" title={t(lang, 'price.foil')}>{t(lang, 'price.from')} {p}</span> : <span className="na">{t(lang, 'price.from')} –</span>}</div>
  }
  return (
    <div className="price">
      {pl.low ? <span title={t(lang, 'price.low')}>{t(lang, 'price.from')} {pl.low}</span> : <span className="na">{t(lang, 'price.from')} –</span>}
      {showHigh && pl.high ? <span className="high" title={t(lang, 'price.high')}>max {pl.high}</span> : null}
      {pl.avg30 ? <span className="avg30" title={t(lang, 'price.avg30')}>Ø30 {pl.avg30}</span> : null}
      {pl.foil ? <span className="foil" title={t(lang, 'price.foil')}>Foil {pl.foil}</span> : null}
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

function DeckThumb({ cardId, src, onOpen, openTitle, zoomIcon, lg }: { cardId?: string; src?: string | null; onOpen?: () => void; openTitle?: string; zoomIcon?: boolean; lg?: boolean }) {
  const zoom = onOpen ? ' art-zoomable' : ''
  const size = lg ? ' deck-thumb-lg' : ''
  const open = onOpen
    ? {
        role: 'button' as const,
        title: openTitle,
        'aria-label': openTitle,
        onClick: (e: ReactMouseEvent) => { e.stopPropagation(); onOpen() },
        'data-card-id': cardId,
      }
    : {}
  const node = src ? (
    <img
      className={`deck-thumb${size}${zoom}`}
      src={thumbForImage(src)}
      alt=""
      loading="lazy"
      decoding="async"
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
      {...open}
    />
  ) : (
    <div className={`deck-thumb deck-thumb-empty${size}${zoom}`} {...(onOpen ? open : { 'aria-hidden': true as const })} />
  )
  if (!onOpen || !zoomIcon || !openTitle) return node
  return (
    <span className={`deck-thumb-wrap${size}`}>
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
  Fury: publicAsset('domains/fury.svg'),
  Calm: publicAsset('domains/calm.svg'),
  Mind: publicAsset('domains/mind.svg'),
  Body: publicAsset('domains/body.svg'),
  Chaos: publicAsset('domains/chaos.svg'),
  Order: publicAsset('domains/order.svg'),
  Colorless: publicAsset('domains/colorless.svg'),
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
  const unit = unitEur(p, false)
  const foilUnit = unitEur(p, true)
  let add = 0
  if (qty > 0 && unit != null) add += qty * unit
  if (foil > 0 && foilUnit != null) add += foil * foilUnit
  return add
}

/** Official card errata, baked by scripts/bake_errata.mjs. */
type CardErrata = { newText: string; oldText: string; source: string }

/** Cardmarket page in the app language, filtered to English copies (language=1) from German sellers (sellerCountry=7). */
function cmLink(raw: string, lang: Lang) {
  try {
    const u = new URL(raw)
    const segs = u.pathname.split('/')
    if (segs[1]) segs[1] = lang
    u.pathname = segs.join('/')
    u.searchParams.set('sellerCountry', '7')
    u.searchParams.set('language', '1')
    return u.toString()
  } catch {
    return raw
  }
}

function openCm(p: PriceEntry | null | undefined, lang: Lang) {
  if (p?.cmUrl) openLink(cmLink(p.cmUrl, lang))
}

/** Opens in the system browser (or mail app) from Electron, a new tab in a plain browser. */
function openLink(url: string) {
  if (window.riftbound?.openExternal) void window.riftbound.openExternal(url)
  else window.open(url, '_blank', 'noopener,noreferrer')
}


const RUNE_ICON: Record<string, string> = {
  Fury: publicAsset('domains/fury.svg'),
  Calm: publicAsset('domains/calm.svg'),
  Mind: publicAsset('domains/mind.svg'),
  Body: publicAsset('domains/body.svg'),
  Order: publicAsset('domains/order.svg'),
  C: publicAsset('domains/chaos.svg'),
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

/** Ability filter: add one line per keyword. Matches the keyword at line start, not prose mentions. */
const ABILITIES = [
  { id: 'hidden', label: 'Hidden', re: /(^|\n)\[?Hidden\]?(?=[\s(]|$)/ },
] as const

function AbilityMenu({ lang, open, setOpen, value, onChange, menuRef }: {
  lang: Lang
  open: boolean
  setOpen: (next: boolean | ((o: boolean) => boolean)) => void
  value: string[]
  onChange: (next: string[]) => void
  menuRef: RefObject<HTMLDivElement | null>
}) {
  return (
    <div className={`lang-menu${open ? ' open' : ''}`} ref={menuRef}>
      <button
        type="button"
        className={`lang-trigger${open || value.length ? ' open' : ''}`}
        title={t(lang, 'filter.ability')}
        aria-label={t(lang, 'filter.ability')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {t(lang, 'filter.ability')}
        <svg className="lang-caret" width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="lang-dropdown" role="menu" aria-label={t(lang, 'filter.ability')} style={{ left: 0, right: 'auto' }}>
          {ABILITIES.map((a) => {
            const on = value.includes(a.id)
            return (
              <button
                key={a.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                className={`lang-option${on ? ' active' : ''}`}
                onClick={() => onChange(on ? value.filter((v) => v !== a.id) : [...value, a.id])}
              >
                <input type="checkbox" className="lang-check" checked={on} readOnly tabIndex={-1} />
                <span>{a.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
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

/** Card art inside an .art box: loads lazily and fades in over the placeholder. */
function ArtImg({ src }: { src?: string }) {
  if (!src) return null
  return (
    <img
      className="art-img"
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onLoad={(e) => e.currentTarget.classList.add('loaded')}
      onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
    />
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
  children,
  qtyRow,
  errata,
  inDecks,
  dragProps,
  borrowedFrom,
}: {
  children?: ReactNode
  /** Copies borrowed from someone (one borrowed pill per person). */
  borrowedFrom?: { name: string; n: number }[]
  /** Makes the tile draggable (drag out of a list to remove one copy). */
  dragProps?: { draggable: boolean; onDragStart: (e: ReactDragEvent) => void; onDragEnd: (e: ReactDragEvent) => void }
  /** Names of the decks that use this card. */
  inDecks?: string[]
  /** Card has official errata (shows the errata pill next to the name). */
  errata?: boolean
  /** Replaces the owned counters (sales cart uses its own stepper). */
  qtyRow?: ReactNode
  c: Card
  o: { qty: number; foil: number }
  lang: Lang
  priceEntry?: PriceEntry
  variant: 'binder' | 'catalog'
  onOpen: (c: Card) => void
  onBump: (id: string, field: 'qty' | 'foil', delta: number) => void
}) {
  const n = ownedQty(o)
  const foilOnly = isFoilOnly(c)
  const ownedClass = variant === 'binder' ? (n ? 'owned' : 'missing') : (n ? 'owned' : '')
  return (
    <article
      className={`card ${ownedClass}${c.signed || c.overnumbered ? ' shimmer' : ''}`}
      data-card-id={c.id}
      onClick={(e) => { if (!isControlClick(e)) onOpen(c) }}
      {...dragProps}
    >
      <div
        className="art art-zoomable"
        role="button"
        tabIndex={0}
        title={t(lang, 'card.enlarge')}
        onClick={() => onOpen(c)}
        onMouseEnter={() => preloadArt(c.image)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen(c)
          }
        }}
      >
        <ArtImg src={cardThumb(c)} />
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
            onClick={() => openCm(priceEntry, lang)}
          >{displayCardName(c)}</button>
        </div>
        {/* Tags on their own line, so long names never push them around. */}
        <div className="card-tags">
          <SetBadge c={c} /><BanBadge status={banStatus(c)} lang={lang} />
          <ErrataBadge show={!!errata} lang={lang} />
        </div>
        {borrowedFrom?.length ? <div className="borrowed-tags"><BorrowedBadge from={borrowedFrom} lang={lang} /></div> : null}
        <div className="sub">{c.code} · {(c.types || []).join('/') || '-'} · {(c.domains || []).join('/') || '-'}</div>
        {inDecks && inDecks.length > 0 && (
          <div className="in-decks" title={`${t(lang, 'collection.inDecks')}: ${inDecks.join(', ')}`}>
            <Icon name="layers" size={13} />
            <span>{inDecks.join(', ')}</span>
          </div>
        )}
        {/* Prices and counters sit at the bottom, so they line up across a grid row. */}
        <div className="tile-foot">
        <PriceBits entry={priceEntry} lang={lang} foilOnly={foilOnly} boxed />
        {qtyRow ?? (foilOnly ? (
          <div className="qty-group qty-group-single">
            <div className="qty-col">
              <span className="qty-label">{t(lang, 'qty.foil')}<span className="foil-star" aria-hidden="true">★</span></span>
              <div className="qty">
                <button aria-label={`${t(lang, 'qty.foil')} −1`} onClick={() => onBump(c.id, 'foil', -1)}>−</button>
                <b className={o.foil + o.qty > 0 ? 'have' : undefined}>{o.foil + o.qty}</b>
                <button aria-label={`${t(lang, 'qty.foil')} +1`} onClick={() => onBump(c.id, 'foil', 1)}>+</button>
              </div>
            </div>
          </div>
        ) : isPlainRune(c) ? (
          <div className="qty-group qty-group-single">
            <div className="qty-col">
              <span className="qty-label">{t(lang, 'qty.normal')}</span>
              <div className="qty">
                <button aria-label={`${t(lang, 'qty.normal')} −1`} onClick={() => onBump(c.id, 'qty', -1)}>−</button>
                <b className={o.qty > 0 ? 'have' : undefined}>{o.qty}</b>
                <button aria-label={`${t(lang, 'qty.normal')} +1`} onClick={() => onBump(c.id, 'qty', 1)}>+</button>
              </div>
            </div>
          </div>
        ) : (
        <div className="qty-group">
          <div className="qty-col">
            <span className="qty-label">{t(lang, 'qty.normal')}</span>
            <div className="qty">
              <button aria-label={`${t(lang, 'qty.normal')} −1`} onClick={() => onBump(c.id, 'qty', -1)}>−</button>
              <b className={o.qty > 0 ? 'have' : undefined}>{o.qty}</b>
              <button aria-label={`${t(lang, 'qty.normal')} +1`} onClick={() => onBump(c.id, 'qty', 1)}>+</button>
            </div>
          </div>
          <div className="qty-col">
            <span className="qty-label">{t(lang, 'qty.foil')}</span>
            <div className="qty">
              <button aria-label={`${t(lang, 'qty.foil')} −1`} onClick={() => onBump(c.id, 'foil', -1)}>−</button>
              <b className={o.foil > 0 ? 'have' : undefined}>{o.foil}</b>
              <button aria-label={`${t(lang, 'qty.foil')} +1`} onClick={() => onBump(c.id, 'foil', 1)}>+</button>
            </div>
          </div>
        </div>
        ))}
        {children}
        </div>
      </div>
    </article>
  )
}

const HIDE_NN_KEY = 'riftbound-hide-nexus-night'

/** Last list wiped by delete all. Module scope: gone when the app process exits. */
let deckListUndo: Deck[] | null = null
let borrowedListUndo: BorrowedGroup[] | null = null

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
  const [collection, setCollection] = useState<Collection>(() => { backupOnce(); return loadCollection() })
  const [copies, setCopies] = useState<CopyBook>(loadCopies)
  const [wishTargets, setWishTargets] = useState<Record<string, number>>(loadWishTargets)
  const [alertsSeen, setAlertsSeen] = useState<Record<string, number>>(loadAlertsSeen)
  const [decks, setDecks] = useState<Deck[]>(loadDecks)
  const [borrowed, setBorrowed] = useState<BorrowedGroup[]>(loadBorrowed)
  const [activeBorrowedId, setActiveBorrowedId] = useState<string | null>(() => borrowed[0]?.id ?? null)
  const [wish, setWish] = useState<Collection>(() => loadWish())
  const [wishOpen, setWishOpen] = useState(false)
  const [valueOpen, setValueOpen] = useState(false)
  const [priceHistory, setPriceHistory] = useState<PriceHistoryFile | null>(null)
  /** Cardmarket export dialog (wishlist wants text, sales list + CSV). */
  const [cmExport, setCmExport] = useState<{ title: string; help: string; text: string; csv?: string; wants?: CmLine[] } | null>(null)
  const [cmCopied, setCmCopied] = useState(false)
  const [borrowImportText, setBorrowImportText] = useState('')
  const [borrowImportOpen, setBorrowImportOpen] = useState(false)
  const [borrowNotice, setBorrowNotice] = useState<string | null>(null)
  /** Store tab: display price comparison or the store locator. */
  const [storeView, setStoreView] = useState<'displays' | 'stores'>('displays')
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
  const [abilityFilter, setAbilityFilter] = useState<string[]>([])
  const [abilityMenuOpen, setAbilityMenuOpen] = useState(false)
  const abilityMenuRef = useRef<HTMLDivElement | null>(null)
  const [bulkText, setBulkText] = useState('')
  const [quickOpen, setQuickOpen] = useState(false)
  const [quickMode, setQuickMode] = useState<'codes' | 'list'>('codes')
  const [bulkReport, setBulkReport] = useState<string | null>(null)
  const [saleList, setSaleList] = useState<Record<string, number>>(loadSales)
  const [saleSelected, setSaleSelected] = useState<Record<string, boolean>>({})
  const [saleQ, setSaleQ] = useState('')
  const [salePaste, setSalePaste] = useState('')
  const [saleReport, setSaleReport] = useState<string | null>(null)
  const [activeDeckId, setActiveDeckId] = useState<string | null>(() => decks[0]?.id ?? null)
  const [deckOwnedOnly, setDeckOwnedOnly] = useState(false)
  const [activeSection, setActiveSection] = useState<DeckSection>('main')
  const [deckImportText, setDeckImportText] = useState('')
  const [deckImportOpen, setDeckImportOpen] = useState(false)
  const [deckExportText, setDeckExportText] = useState<string | null>(null)
  /** i18n key of the export dialog title (deck list or borrowed list). */
  const [exportTitleKey, setExportTitleKey] = useState('decks.exportTitle')
  const [deckExportCopied, setDeckExportCopied] = useState(false)
  const [deckShotBusy, setDeckShotBusy] = useState(false)
  const [sharePreview, setSharePreview] = useState<{ dataUrl: string; fileName: string; exportText: string } | null>(null)
  const [missingExpanded, setMissingExpanded] = useState(false)
  const [cardPreview, setCardPreview] = useState<{ src: string; x: number; y: number } | null>(null)
  const [cardLightbox, setCardLightbox] = useState<Card | null>(null)
  const [bfTurn, setBfTurn] = useState(false)
  /** Lightbox art is hidden until fully loaded, so a half drawn PNG never shows. */
  const [artReady, setArtReady] = useState(false)
  const [lbNav, setLbNav] = useState<{ prev?: Card; next?: Card }>({})
  const [clearSec, setClearSec] = useState<DeckSection | null>(null)
  const [deckUndoOn, setDeckUndoOn] = useState(false)
  const [borrowUndoOn, setBorrowUndoOn] = useState(false)
  const [deckConfirm, setDeckConfirm] = useState<null | { kind: 'all' } | { kind: 'one'; id: string; name: string } | { kind: 'borrow'; id: string; name: string } | { kind: 'borrowAll' } | { kind: 'wish'; id: string; name: string }>(null)
  /** Official errata by lower case "name" or "name, subtitle" (public/card-errata.json). */
  const [errata, setErrata] = useState<Record<string, CardErrata>>({})
  const [appVersion, setAppVersion] = useState('')
  const [updateInfo, setUpdateInfo] = useState<{ status: string; version?: string; message?: string; percent?: number } | null>(null)
  const [isFullScreen, setIsFullScreen] = useState(false)
  const [rawPriceBook, setPriceBook] = useState<PriceBook | null>(null)
  // null = binder dashboard; 'owned' = all owned; set code = that set binder
  const [binderView, setBinderView] = useState<string | null>(null)
  const [hideNexusNight, setHideNexusNight] = useState<boolean>(() => loadHideNexusNight())
  const [binderOwnedOnly, setBinderOwnedOnly] = useState(false)
  /** Set filter in the All owned tab ('' = every set). */
  const [ownedSet, setOwnedSet] = useState('')
  const [ownedSort, setOwnedSort] = useState<'set' | 'price-desc' | 'price-asc'>('set')
  const [ownedBorrowedOnly, setOwnedBorrowedOnly] = useState(false)
  const [binderMissing, setBinderMissing] = useState(false)
  const [binderMissingFoil, setBinderMissingFoil] = useState(false)
  const [binderRarity, setBinderRarity] = useState<string | null>(null)
  const [domainFilter, setDomainFilter] = useState<string[]>([])
  const [dragOverSection, setDragOverSection] = useState<DeckSection | null>(null)
  const [dragRejectSection, setDragRejectSection] = useState<DeckSection | null>(null)
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null)
  /** Dragging a card out of a list (deck, wishlist, cart, borrowed): dropping it outside that list removes one copy. */
  const removeDrag = useRef<{ zone: string; remove: () => void } | null>(null)
  const [removing, setRemoving] = useState(false)
  useEffect(() => {
    if (!removing) return
    const inSource = (e: DragEvent) =>
      !!(e.target instanceof Element && e.target.closest(`[data-remove-src="${removeDrag.current?.zone}"]`))
    const over = (e: DragEvent) => {
      if (inSource(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    }
    // Removing the last copy unmounts the dragged row, so its own dragend never fires: end the drag here too.
    const finish = () => {
      removeDrag.current = null
      setRemoving(false)
    }
    const drop = (e: DragEvent) => {
      if (inSource(e)) return
      e.preventDefault()
      removeDrag.current?.remove()
      finish()
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    window.addEventListener('dragend', finish, true)
    document.body.dataset.removing = removeDrag.current?.zone || ''
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
      window.removeEventListener('dragend', finish, true)
      delete document.body.dataset.removing
    }
  }, [removing])
  const [dragOverCart, setDragOverCart] = useState<'sale' | 'wish' | null>(null)
  const [dragRejectCart, setDragRejectCart] = useState<'sale' | 'wish' | null>(null)
  const [poolHidden, setPoolHidden] = useState(() => localStorage.getItem('rb.poolHidden') === '1')
  const [dragOverBorrow, setDragOverBorrow] = useState(false)
  const [dragRejectBorrow, setDragRejectBorrow] = useState(false)
  const [deckNotice, setDeckNotice] = useState<string | null>(null)
  const deckDragged = useRef(false)

  function restoreDecks() {
    const saved = deckListUndo
    if (!saved) return
    deckListUndo = null
    setDeckUndoOn(false)
    setDecks(saved)
    setActiveDeckId(saved[0]?.id ?? null)
  }

  function restoreBorrowed() {
    const saved = borrowedListUndo
    if (!saved) return
    borrowedListUndo = null
    setBorrowUndoOn(false)
    setBorrowed(saved)
    setActiveBorrowedId(saved[0]?.id ?? null)
  }

  function applyDeckConfirm() {
    const pending = deckConfirm
    setDeckConfirm(null)
    if (!pending) return
    if (pending.kind === 'all') {
      if (decks.length === 0) return
      deckListUndo = decks.slice()
      setDeckUndoOn(true)
      setDecks([])
      setActiveDeckId(null)
      return
    }
    if (pending.kind === 'borrowAll') {
      if (borrowed.length === 0) return
      borrowedListUndo = borrowed.slice()
      setBorrowUndoOn(true)
      setBorrowed([])
      setActiveBorrowedId(null)
      return
    }
    if (pending.kind === 'wish') {
      setWish((prev) => { const n = { ...prev }; delete n[pending.id]; return n })
      dropWishTarget(pending.id)
      return
    }
    if (pending.kind === 'borrow') {
      setBorrowed((prev) => prev.filter((x) => x.id !== pending.id))
      setActiveBorrowedId(null)
      return
    }
    setDecks((prev) => prev.filter((x) => x.id !== pending.id))
    setActiveDeckId((id) => (id === pending.id ? null : id))
  }

  function onDeckReorderPointerDown(e: ReactPointerEvent<HTMLSpanElement>, id: string, kind: 'deck' | 'borrow' = 'deck') {
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
      if (to !== from) {
        if (kind === 'borrow') setBorrowed((prev) => moveDeckTo(prev, id, to))
        else setDecks((prev) => moveDeckTo(prev, id, to))
      }
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
    if (!langMenuOpen && !rarityMenuOpen && !abilityMenuOpen) return
    function onDocPointerDown(e: PointerEvent) {
      const t = e.target as Node
      if (langMenuOpen && langMenuRef.current && !langMenuRef.current.contains(t)) setLangMenuOpen(false)
      if (rarityMenuOpen && rarityMenuRef.current && !rarityMenuRef.current.contains(t)) setRarityMenuOpen(false)
      if (abilityMenuOpen && abilityMenuRef.current && !abilityMenuRef.current.contains(t)) setAbilityMenuOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setLangMenuOpen(false)
        setRarityMenuOpen(false)
        setAbilityMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', onDocPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [langMenuOpen, rarityMenuOpen, abilityMenuOpen])

  useEffect(() => {
    // The thumbnail index must be in before the first grid renders, or every tile would start on the full art.
    Promise.all([
      fetch(new URL('cards.json', window.location.href)).then((r) => {
        if (!r.ok) throw new Error('cards.json fehlt')
        return r.json()
      }),
      loadThumbIndex(),
    ])
      .then(([data]: [Catalog, void]) => setCatalog(data))
      .catch((e: Error) => setError(e.message))
    // Bundled prices.json first, then the live copy from GitHub; newest updatedAt wins.
    const keepNewer = (b: PriceBook | null) => { if (b) setPriceBook((prev) => newerPriceBook(prev, b)) }
    keepNewer(loadCachedPrices())
    loadBundledPrices().then(keepNewer)
    fetchRemotePrices().then(keepNewer)
    loadPriceHistory().then(setPriceHistory)
    fetch(new URL('card-keywords.json', window.location.href))
      .then((r) => (r.ok ? r.json() : null))
      .then((data: CardKeywordBook | null) => { if (data?.byCardId) setCardKeywordBook(data) })
      .catch(() => {})
    fetch(new URL('card-errata.json', window.location.href))
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { byName?: Record<string, CardErrata> } | null) => { if (data?.byName) setErrata(data.byName) })
      .catch(() => {})
  }, [])

  useEffect(() => saveCollection(collection), [collection])
  useEffect(() => saveDecks(decks), [decks])
  useEffect(() => saveBorrowed(borrowed), [borrowed])
  useEffect(() => saveWish(wish), [wish])
  useEffect(() => saveSales(saleList), [saleList])
  useEffect(() => saveCopies(copies), [copies])
  useEffect(() => saveWishTargets(wishTargets), [wishTargets])
  useEffect(() => saveAlertsSeen(alertsSeen), [alertsSeen])

  const cards = catalog?.cards || []
  const sets = catalog?.sets || {}
  const priceBook = useMemo(() => zeroPlainRunes(rawPriceBook, cards), [rawPriceBook, cards])
  // Units are errata'd as "Name, Subtitle"; spells carry a champion subtitle but are listed by name.
  const errataFor = (c: Card): CardErrata | undefined =>
    (c.subtitle ? errata[`${c.name}, ${c.subtitle}`.toLowerCase()] : undefined) || errata[c.name.toLowerCase()]
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
    if (!abilityFilter.every((id) => ABILITIES.find((a) => a.id === id)?.re.test(c.rulesText || ''))) return false
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

  // One time fold (and after imports): normal copies of foil only cards become foil.
  useEffect(() => {
    if (!byId.size) return
    setCollection((prev) => foldFoilOnly(prev, byId))
    setWish((prev) => foldFoilOnly(prev, byId))
  }, [byId, collection, wish])

  function foilOnlyId(id: string) {
    const c = byId.get(id)
    return c ? isFoilOnly(c) : false
  }

  // Copy details follow the counts: sold or removed copies drop their details too.
  // An empty collection is skipped so a failed load never wipes the details.
  useEffect(() => {
    if (!byId.size || Object.keys(collection).length === 0) return
    setCopies((prev) => fitCopyBook(prev, collection, foilOnlyId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byId, collection])

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

  // Filter on a deferred copy so typing stays responsive while 1600+ tiles re-render.
  const deferredQ = useDeferredValue(q)
  const filtered = useMemo(() => {
    const query = deferredQ.trim().toLowerCase()
    return cards.filter((c) => {
      if (ownedOnly && ownedQty(collection[c.id]) <= 0) return false
      return matchesFilters(c, query)
    })
  }, [cards, deferredQ, setFilter, typeFilter, domainFilter, raritySigned, rarityOver, rarityPromo, rarityUltimate, abilityFilter, ownedOnly, collection, legendIds])

  const ownedCards = useMemo(
    () => cards.filter((c) => ownedQty(collection[c.id]) > 0),
    [cards, collection],
  )
  const borrowedTotals = useMemo(() => borrowedQtyById(borrowed), [borrowed])
  /** Copies borrowed from other people: shown in All owned and usable in decks, but not part of the collection. */
  const borrowedInTotals = useMemo(() => borrowedQtyById(borrowed, true), [borrowed])
  const borrowedInFrom = useMemo(() => borrowedFromById(borrowed), [borrowed])

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
      const add = cardEur(copies[id], o, foilOnlyId(id), p)
      if (add > 0) {
        sum += add
        priced += 1
      }
    }
    return { sum, priced }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, copies, priceBook, byId])

  /** Collection with every copy weighted by its condition factor, for the value history line. */
  const weightedCollection = useMemo(() => {
    const out: Collection = {}
    for (const [id, o] of Object.entries(collection)) {
      if (!copies[id]) { out[id] = o; continue }
      const w = { qty: 0, foil: 0 }
      for (const g of copyGroups(copies[id], o, foilOnlyId(id))) w[g.foil ? 'foil' : 'qty'] += g.n * CONDITION_FACTOR[g.cond]
      out[id] = w
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, copies, byId])

  /** Purchase price vs. worth today, for copies with a purchase price. */
  const invest = useMemo(() => {
    let copiesN = 0
    let paid = 0
    let worth = 0
    const rows: InvestRow[] = []
    for (const [id, lots] of Object.entries(copies)) {
      const card = byId.get(id)
      if (!card || !lots.some((l) => l.buy != null)) continue
      const r = cardInvest(lots, collection[id], isFoilOnly(card), priceBook?.cards[id])
      if (!r.copies) continue
      copiesN += r.copies
      paid += r.paid
      worth += r.worth
      rows.push({ card, ...r })
    }
    return { copies: copiesN, paid, worth, rows }
  }, [copies, collection, byId, priceBook])

  const pricePoints = useMemo(() => {
    const points = historyPoints(priceHistory, priceBook)
    // Older snapshots still carry rune prices; drop them so plain runes add nothing there too.
    for (const c of cards) {
      if (!isPlainRune(c)) continue
      for (const p of points) {
        delete p.n[c.id]
        delete p.f[c.id]
      }
    }
    return points
  }, [priceHistory, priceBook, cards])

  // The "All owned" tab is the owned binder; leaving it (or opening it from anywhere) keeps binderView in sync.
  useEffect(() => {
    if (tab === 'owned' && binderView !== 'owned') {
      setBinderView('owned')
      setBinderRarity(null)
      setQ('')
      setBinderOwnedOnly(false)
      setBinderMissing(false)
      setBinderMissingFoil(false)
    } else if (tab !== 'owned' && binderView === 'owned') {
      setBinderView(null)
    }
  }, [tab, binderView])

  const decksByCard = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const d of decks) {
      for (const id of new Set(d.cards.map((dc) => dc.id))) m.set(id, [...(m.get(id) || []), d.name])
    }
    return m
  }, [decks])

  const setProgress = useMemo(() => {
    const known = BINDER_SET_ORDER.filter((id) => id in sets)
    const knownSet = new Set<string>(known)
    const rest = Object.keys(sets).filter((id) => !knownSet.has(id))
    let order = [...known, ...rest]
    if (hideNexusNight) order = order.filter((id) => !String(id).endsWith('-NN'))
    const out: { id: string; name: string; total: number; owned: number; pct: number; eur: number | null; foilOwned: number; foilTotal: number; missingEur: number | null }[] = []
    for (const id of order) {
      const setCards = cards.filter((c) => c.set === id)
      let owned = 0
      let foilOwned = 0
      let eur = 0
      let eurAny = false
      let missingEur = 0
      let missingAny = false
      for (const c of setCards) {
        const o = collection[c.id]
        const n = ownedQty(o)
        if (hasFoilCopy(c, o)) foilOwned += 1
        if (n <= 0) {
          // What it costs to finish the set: one copy of every missing card.
          const u = unitEur(priceBook?.cards[c.id], isFoilOnly(c))
          if (u != null) { missingEur += u; missingAny = true }
          continue
        }
        owned += 1
        if (!priceBook) continue
        const add = cardEur(copies[c.id], o, isFoilOnly(c), priceBook.cards[c.id])
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
        foilOwned,
        foilTotal: setCards.filter((c) => !isPlainRune(c)).length,
        missingEur: missingAny ? missingEur : null,
      })
    }
    return out
  }, [cards, sets, collection, copies, priceBook, hideNexusNight])

  // Rebuilt only when what the tiles show changes, not on every keystroke.
  // bump and openCardLightbox only call state setters, so the captured versions stay correct.
  const catalogGrid = useMemo(() => filtered.map((c) => (
    <CardTile
      key={c.id}
      c={c}
      o={collection[c.id] || { qty: 0, foil: 0 }}
      lang={lang}
      priceEntry={priceBook?.cards[c.id]}
      variant="catalog"
      errata={!!errataFor(c)}
      onOpen={openCardLightbox}
      onBump={bump}
    />
  )), [filtered, collection, lang, priceBook, errata])

  const binderCards = useMemo(() => {
    if (binderView == null) return [] as Card[]
    const query = deferredQ.trim().toLowerCase()
    let list: Card[]
    if (binderView === 'owned') {
      list = cards.filter((c) => (ownedBorrowedOnly ? borrowedInTotals.has(c.id) : ownedQty(collection[c.id]) > 0 || borrowedInTotals.has(c.id)) && (!ownedSet || c.set === ownedSet))
    } else {
      list = cards.filter((c) => c.set === binderView)
    }
    list = list.filter((c) => {
      const n = ownedQty(collection[c.id]) + (binderView === 'owned' ? borrowedInTotals.get(c.id) || 0 : 0)
      if (binderOwnedOnly && n <= 0) return false
      if (binderMissing && n > 0) return false
      if (binderMissingFoil && (isPlainRune(c) || hasFoilCopy(c, collection[c.id]))) return false
      if (binderRarity && (c.rarity || 'Other') !== binderRarity) return false
      return matchesSharedFilters(c, query)
    })
    // All owned mixes sets: keep them in binder order, then by card number.
    const rank = (s: string) => { const i = (BINDER_SET_ORDER as readonly string[]).indexOf(s); return i < 0 ? BINDER_SET_ORDER.length : i }
    const bySet = (a: Card, b: Card) => rank(a.set) - rank(b.set) || a.set.localeCompare(b.set) || a.cn - b.cn || a.code.localeCompare(b.code)
    if (binderView !== 'owned' || ownedSort === 'set') return [...list].sort(bySet)
    // Price of one copy you own: the foil price if you only have foils (or the card only exists as foil).
    const price = (c: Card) => {
      const o = collection[c.id]
      return unitEur(priceBook?.cards[c.id], isFoilOnly(c) || !(o?.qty || 0))
    }
    const dir = ownedSort === 'price-asc' ? 1 : -1
    return [...list].sort((a, b) => {
      const pa = price(a), pb = price(b)
      if (pa == null || pb == null) return (pa == null ? 1 : 0) - (pb == null ? 1 : 0) || bySet(a, b)
      return dir * (pa - pb) || bySet(a, b)
    })
  }, [binderView, cards, collection, borrowedInTotals, deferredQ, binderOwnedOnly, binderMissing, binderMissingFoil, binderRarity, ownedSet, ownedSort, ownedBorrowedOnly, priceBook, domainFilter, raritySigned, rarityOver, rarityPromo, rarityUltimate, abilityFilter, legendIds])

  /** Sets with owned cards, in binder order, for the All owned set filter. */
  const ownedSets = useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of cards) if (ownedQty(collection[c.id]) > 0 || borrowedInTotals.has(c.id)) counts.set(c.set, (counts.get(c.set) || 0) + 1)
    const rank = (s: string) => { const i = (BINDER_SET_ORDER as readonly string[]).indexOf(s); return i < 0 ? BINDER_SET_ORDER.length : i }
    return [...counts].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
  }, [cards, collection, borrowedInTotals])

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

  function bumpWish(id: string, field: 'qty' | 'foil', delta: number) {
    bump(id, field, delta, setWish)
  }

  function dropWishTarget(id: string) {
    setWishTargets((prev) => { if (!(id in prev)) return prev; const n = { ...prev }; delete n[id]; return n })
  }

  function setWishTarget(id: string, eur: number | null) {
    if (eur == null || eur <= 0) dropWishTarget(id)
    else setWishTargets((prev) => ({ ...prev, [id]: eur }))
  }

  /** Price per copy the wishlist entry is about: foil when only foil is wanted (or the card is foil only). */
  function wishUnit(id: string) {
    const c = byId.get(id)
    const w = wish[id]
    if (!c || !w) return null
    return unitEur(priceBook?.cards[id], isFoilOnly(c) || ((w.foil || 0) > 0 && !(w.qty || 0)))
  }

  /** Wishlist cards at or below their target price, with the price now. */
  const wishHits = useMemo(() => {
    const m = new Map<string, number>()
    if (!priceBook) return m
    for (const [id, target] of Object.entries(wishTargets)) {
      const u = wishUnit(id)
      if (u != null && u <= target) m.set(id, u)
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wishTargets, wish, priceBook, byId])

  /** Hits the user has not seen yet, or that got cheaper since. */
  const newWishHits = useMemo(
    () => [...wishHits].filter(([id, u]) => alertsSeen[id] == null || u < alertsSeen[id]),
    [wishHits, alertsSeen],
  )

  // Seen prices of cards that went back above the target are forgotten, so the next drop alerts again.
  useEffect(() => {
    if (!priceBook || !byId.size) return
    setAlertsSeen((prev) => {
      const stale = Object.keys(prev).filter((id) => !wishHits.has(id))
      if (!stale.length) return prev
      const n = { ...prev }
      for (const id of stale) delete n[id]
      return n
    })
  }, [wishHits, priceBook, byId])

  function markAlertsSeen() {
    if (!newWishHits.length) return
    setAlertsSeen((prev) => {
      const n = { ...prev }
      for (const [id, u] of wishHits) n[id] = u
      return n
    })
  }

  // One desktop notification per new hit. Waits a moment so the live prices can replace the cached ones first.
  const notifiedRef = useRef(new Set<string>())
  useEffect(() => {
    const fresh = newWishHits.filter(([id, u]) => !notifiedRef.current.has(`${id}:${u}`))
    if (!fresh.length || typeof Notification === 'undefined') return
    const timer = window.setTimeout(() => {
      for (const [id, u] of fresh) notifiedRef.current.add(`${id}:${u}`)
      const names = fresh.map(([id]) => { const c = byId.get(id); return c ? displayCardName(c) : id })
      const body = fresh.length === 1
        ? t(lang, 'alert.notifyOne', { name: names[0], eur: fmtEur(lang, fresh[0][1]) ?? '' })
        : t(lang, 'alert.notifyMany', { n: fresh.length, names: names.slice(0, 3).join(', ') + (names.length > 3 ? ' …' : '') })
      try {
        const note = new Notification(t(lang, 'alert.notifyTitle'), { body, icon: publicAsset('icon.png'), silent: false })
        note.onclick = () => { window.focus(); setTab('collection'); setBinderView(null); setValueOpen(false); setWishOpen(true) }
      } catch {
        // No notifications (permission or platform): the in-app banner still shows.
      }
    }, 4000)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newWishHits])

  // Opening the wishlist counts as seeing its alerts.
  useEffect(() => {
    if (wishOpen) markAlertsSeen()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wishOpen, newWishHits])

  /** Got it: wanted copies go into the collection, entry leaves the wishlist. */
  function gotWish(id: string) {
    const w = wish[id]
    if (!w) return
    bump(id, 'qty', w.qty || 0)
    bump(id, 'foil', w.foil || 0)
    setWish((prev) => { const n = { ...prev }; delete n[id]; return n })
    dropWishTarget(id)
  }

  function bump(id: string, field: 'qty' | 'foil', delta: number, set = setCollection) {
    set((prev) => {
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
      const sep = csvSeparator(lines[0] || '')
      const rows: Collection = {}
      for (let i = start; i < lines.length; i++) {
        const cols = splitCsv(lines[i], sep)
        if (cols.length < 5) continue
        const [id, , , , qty, foil] = cols
        const card = byId.get(id) || resolveToken(cols[1] || id, cards)
        if (!card) continue
        rows[card.id] = {
          qty: Math.max(0, Number(qty) || 0),
          foil: Math.max(0, Number(foil) || 0),
        }
      }
      setCollection((prev) => ({ ...prev, ...rows }))
      setBulkReport(t(lang, 'catalog.csvImported', { name: file.name, count: Object.keys(rows).length }))
      setTab('collection')
    }
    reader.readAsText(file)
  }

  function openWantsExport() {
    const lines: CmLine[] = Object.entries(wish).flatMap(([id, o]) => {
      const card = byId.get(id)
      return card ? [{ card, qty: o.qty || 0, foil: o.foil || 0, price: priceBook?.cards[id] }] : []
    })
    setCmCopied(false)
    setCmExport({ title: t(lang, 'cm.wantsTitle'), help: t(lang, 'cm.wantsHelp'), text: wantsText(lines) })
  }

  /** Missing cards of the open set (current rarity filter), as a Cardmarket wants list. */
  function binderMissingCards(foil: boolean) {
    if (!binderView || binderView === 'owned') return []
    return cards
      .filter((c) => c.set === binderView && (!binderRarity || (c.rarity || 'Other') === binderRarity))
      .filter((c) => (foil ? !isPlainRune(c) && !hasFoilCopy(c, collection[c.id]) : ownedQty(collection[c.id]) <= 0))
      .sort((a, b) => a.cn - b.cn || a.code.localeCompare(b.code))
  }

  function openMissingExport() {
    const foil = binderMissingFoil
    const list = binderMissingCards(foil)
    const lines: CmLine[] = list.map((card) => {
      const asFoil = foil || isFoilOnly(card)
      return { card, qty: asFoil ? 0 : 1, foil: asFoil ? 1 : 0, price: priceBook?.cards[card.id] }
    })
    const cost = lines.reduce((s, l) => s + (unitEur(l.price, l.foil > 0) ?? 0), 0)
    setCmCopied(false)
    setCmExport({
      title: t(lang, foil ? 'missing.titleFoil' : 'missing.title', { set: sets[binderView || ''] || binderView || '' }),
      help: t(lang, 'missing.help', { n: lines.length, eur: fmtEur(lang, cost) ?? '' }),
      text: wantsText(lines),
      wants: lines.length ? lines : undefined,
    })
  }

  /** Puts the missing cards on the wishlist (one copy each; foil when it is about foils). */
  function missingToWish(lines: CmLine[]) {
    setWish((prev) => {
      const n = { ...prev }
      for (const l of lines) {
        const cur = n[l.card.id] || { qty: 0, foil: 0 }
        if (l.foil > 0) n[l.card.id] = { ...cur, foil: Math.max(cur.foil, 1) }
        else n[l.card.id] = { ...cur, qty: Math.max(cur.qty, 1) }
      }
      return n
    })
  }

  function openSellExport() {
    const lines: CmLine[] = Object.entries(saleList).flatMap(([id, n]) => {
      const card = byId.get(id)
      if (!card) return []
      const foil = isFoilOnly(card)
      const groups = soldGroups(copies[id], collection[id], foil, foil, n)
      return [{ card, qty: foil ? 0 : n, foil: foil ? n : 0, price: priceBook?.cards[id], groups }]
    })
    setCmCopied(false)
    setCmExport({
      title: t(lang, 'cm.sellTitle'),
      help: t(lang, 'cm.sellHelp'),
      text: sellText(lines, (eur) => fmtEur(lang, eur)),
      csv: stockCsv(lines),
    })
  }

  async function copyCmExport() {
    if (!cmExport) return
    try {
      await navigator.clipboard.writeText(cmExport.text)
      setCmCopied(true)
    } catch {
      setCmCopied(false)
    }
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

  /** Owned copies minus lent-out copies plus borrowed ones — used for deck missing-copies. */
  function availableForDecks(id: string) {
    return Math.max(0, ownedQty(collection[id]) - (borrowedTotals.get(id) || 0)) + (borrowedInTotals.get(id) || 0)
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

  /** Copies that can still go into the active entry: owned minus all lent copies, no limit when borrowing from someone. */
  function remainingToLend(id: string) {
    if (activeBorrowed?.direction === 'from') return Infinity
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
          const add = g.direction === 'from' ? delta : Math.min(delta, room)
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
    const result = parseBorrowList(text, cards)
    const flat = result.cards
    // Someone else's lent list pasted into an empty entry: these are cards borrowed from them.
    const fromList = text.trim().startsWith(LENT_HEADER)
    updateBorrowed((g) => {
      const m = new Map(g.cards.map((c) => [c.id, c.qty]))
      for (const c of flat) {
        m.set(c.id, (m.get(c.id) || 0) + c.qty)
      }
      const direction = fromList && g.cards.length === 0 ? 'from' : g.direction
      return { ...g, direction, cards: [...m.entries()].map(([id, qty]) => ({ id, qty })) }
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

  /** Drag props for a card in a list: one drag out of the list removes one copy. */
  function removeDragProps(zone: string, remove: () => void) {
    return {
      draggable: true,
      onDragStart: (e: ReactDragEvent) => {
        e.stopPropagation()
        // Own type only, so the add drop zones (deck sections, cart, wishlist, borrowed) ignore it.
        e.dataTransfer.setData('text/riftbound-remove', zone)
        e.dataTransfer.effectAllowed = 'move'
        const el = e.currentTarget as HTMLElement
        const img = el.querySelector('img') as HTMLImageElement | null
        if (img && img.complete && img.naturalWidth > 0) {
          try { e.dataTransfer.setDragImage(img, img.clientWidth / 2, img.clientHeight / 2) } catch {}
        }
        el.classList.add('dragging')
        removeDrag.current = { zone, remove }
        setCardPreview(null)
        setRemoving(true)
      },
      onDragEnd: (e: ReactDragEvent) => {
        (e.currentTarget as HTMLElement).classList.remove('dragging')
        removeDrag.current = null
        setRemoving(false)
      },
    }
  }

  function onPickerDragEnd(e: ReactDragEvent) {
    (e.currentTarget as HTMLElement).classList.remove('dragging')
    setDraggingCardId(null)
    setDragOverSection(null)
    setDragRejectSection(null)
    setDragOverCart(null)
    setDragRejectCart(null)
    setDragOverBorrow(false)
    setDragRejectBorrow(false)
  }

  /** Shared drop zone (same motion as deck sections) for the sales cart and the wishlist. */
  function cartDrop(kind: 'sale' | 'wish', canAdd: (id: string) => boolean, add: (id: string) => void) {
    const reject = () => {
      setDragRejectCart(kind)
      window.setTimeout(() => setDragRejectCart((cur) => (cur === kind ? null : cur)), 450)
    }
    return {
      className: `list sale-cart${dragOverCart === kind ? ' drag-over' : ''}${dragRejectCart === kind ? ' drag-reject' : ''}`,
      onDragOver: (e: ReactDragEvent) => {
        if (removeDrag.current) return
        const types = Array.from(e.dataTransfer.types || [])
        if (!types.includes('text/riftbound-card') && !types.includes('text/plain') && !draggingCardId) return
        e.preventDefault()
        if (draggingCardId && !canAdd(draggingCardId)) {
          e.dataTransfer.dropEffect = 'none'
          setDragOverCart(null)
          setDragRejectCart(kind)
          return
        }
        e.dataTransfer.dropEffect = 'copy'
        setDragRejectCart(null)
        setDragOverCart(kind)
      },
      onDragLeave: (e: ReactDragEvent) => {
        const related = e.relatedTarget as Node | null
        if (related && (e.currentTarget as HTMLElement).contains(related)) return
        setDragOverCart(null)
        setDragRejectCart(null)
      },
      onDrop: (e: ReactDragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        const cardId = e.dataTransfer.getData('text/riftbound-card') || e.dataTransfer.getData('text/plain')
        setDragOverCart(null)
        setDragRejectCart(null)
        if (!cardId || !canAdd(cardId)) return reject()
        add(cardId)
      },
    }
  }

  function poolToggle() {
    return (
      <button
        type="button"
        className="btn"
        aria-pressed={!poolHidden}
        title={t(lang, poolHidden ? 'pool.show' : 'pool.hide')}
        onClick={() => setPoolHidden((v) => { localStorage.setItem('rb.poolHidden', v ? '0' : '1'); return !v })}
      >
        <Icon name="search" />{t(lang, poolHidden ? 'pool.show' : 'pool.hide')}
      </button>
    )
  }

  function onBorrowDragOver(e: ReactDragEvent) {
    if (removeDrag.current) return
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
    if (removeDrag.current) return
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
    const parts = ['deck-sec', `deck-sec-${sec}`]
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
    // Rune deck: plain runes as one big counter per Legend domain, alt art runes stay as rows.
    const runeDomains = sec === 'rune' ? getLegendDomains(deck.cards, byId) || [] : []
    const isPlainIn = (dc: (typeof cardsIn)[number]) => { const c = byId.get(dc.id); return !!c && isPlainRune(c) }
    const listed = runeDomains.length ? cardsIn.filter((dc) => !isPlainIn(dc)) : cardsIn
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
              <Icon name="list-x" />{t(lang, 'decks.clearSection')}
            </button>
          )}
          <span className={`deck-sec-cap${over ? ' over' : ''}`}>{count}/{cap}</span>
        </div>
        {runeDomains.length > 0 && (
          <div className="rune-tiles" onClick={(e) => e.stopPropagation()}>
            {runeDomains.map((d) => {
              const inDeck = cardsIn.filter((dc) => isPlainIn(dc) && (byId.get(dc.id)?.domains || []).includes(d))
              const n = inDeck.reduce((s, dc) => s + dc.qty, 0)
              const owned = cards
                .filter((c) => isPlainRune(c) && (c.domains || []).includes(d))
                .reduce((s, c) => s + availableForDecks(c.id), 0)
              const pick = inDeck[0]?.id ?? plainRuneFor(d)?.id
              const removeOne = () => {
                const last = inDeck[inDeck.length - 1]
                if (last) bumpDeckCard(last.id, 'rune', -1)
              }
              return (
                <div
                  key={d}
                  className={`rune-tile${n > owned ? ' short' : ''}`}
                  {...(n > 0 ? removeDragProps('deck', removeOne) : {})}
                >
                  {d in DOMAIN_ICON && <img src={DOMAIN_ICON[d as keyof typeof DOMAIN_ICON]} alt="" draggable={false} />}
                  <span className="rune-tile-name">{d}</span>
                  <div className="qty">
                    <button
                      type="button"
                      aria-label={`${d} −`}
                      disabled={n === 0}
                      onClick={removeOne}
                    >−</button>
                    <b>{n}</b>
                    <button
                      type="button"
                      aria-label={`${d} +`}
                      disabled={atCap || locked || !pick}
                      title={atCap ? t(lang, 'decks.limit', { cap }) : undefined}
                      onClick={() => pick && addToDeck(pick, 'rune')}
                    >+</button>
                  </div>
                  <span className="sub">{t(lang, 'decks.ownsLabel')} {owned}</span>
                </div>
              )
            })}
          </div>
        )}
        <div className="list">
          {listed.map((dc) => {
            const c = byId.get(dc.id)
            if (!c) return null
            const have = availableForDecks(c.id)
            const shortQty = Math.max(0, dc.qty - have)
            const short = shortQty > 0
            return (
              <div
                key={`${dc.id}-${sec}`}
                className={`list-item deck-card-row${short ? ' short' : ''}`}
                {...removeDragProps('deck', () => bumpDeckCard(dc.id, sec, -1))}
                onMouseEnter={(e) => showCardPreview(e, c.image)}
                onMouseMove={(e) => showCardPreview(e, c.image)}
                onMouseLeave={hideCardPreview}
                onClick={(e) => { if (!isControlClick(e)) openCardLightbox(c) }}
              >
                <DeckThumb cardId={c.id} src={c.image} onOpen={() => openCardLightbox(c)} openTitle={t(lang, 'card.enlarge')} zoomIcon />
                <div className="grow">
                  <div className="name-with-ban">
                    <button
                      type="button"
                      className="name name-link"
                      title={t(lang, 'price.openCm')}
                      disabled={!priceBook?.cards[c.id]?.cmUrl}
                      onClick={(e) => { e.stopPropagation(); openCm(priceBook?.cards[c.id], lang) }}
                    >{displayName(c)}</button>
                  </div>
                  {/* Tags on their own line, so the name keeps the full width in a narrow window. */}
                  <div className="card-tags">
                    <SetBadge c={c} /><BanBadge status={banStatus(c)} lang={lang} />
                    <ErrataBadge show={!!errataFor(c)} lang={lang} />
                    <BorrowedBadge from={borrowedInFrom.get(c.id)} lang={lang} short />
                  </div>
                  <div className="sub">
                    {c.energy != null ? `E${c.energy} · ` : ''}{c.code}
                  </div>
                  <PriceBits entry={priceBook?.cards[c.id]} lang={lang} />
                </div>
                {collectionButtons(c.id)}
                <div className="row-stat">
                  <span className="qty-label">{t(lang, 'decks.ownsLabel')}</span>
                  <b className={short ? 'short' : 'have'}>{have}</b>
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
                    <Icon name="trash-2" size={16} />
                  </button>
                ) : (
                  <div className="row-stat">
                    <span className="qty-label">{t(lang, 'decks.needLabel')}</span>
                    <div className="qty" onClick={(e) => e.stopPropagation()}>
                      <button type="button" onClick={() => bumpDeckCard(dc.id, sec, -1)}>−</button>
                      <b>{dc.qty}</b>
                      <button type="button" disabled={atCap || locked} title={locked ? t(lang, 'decks.legendLocked') : atCap ? t(lang, 'decks.limit', { cap }) : undefined} onClick={() => bumpDeckCard(dc.id, sec, 1)}>+</button>
                    </div>
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
            {locked ? t(lang, 'decks.legendLocked') : t(lang, 'decks.addSection', { section: SECTION_LABEL[sec] })}
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

  /** The deck's missing copies as a Cardmarket wants list. */
  function openDeckMissingExport(d: Deck) {
    const lines: CmLine[] = underOwnedLines(d).flatMap((u) => {
      const card = byId.get(u.id)
      if (!card) return []
      const asFoil = isFoilOnly(card)
      return [{ card, qty: asFoil ? 0 : u.short, foil: asFoil ? u.short : 0, price: priceBook?.cards[u.id] }]
    })
    const cost = lines.reduce((s, l) => s + (unitEur(l.price, l.foil > 0) ?? 0) * (l.qty + l.foil), 0)
    setCmCopied(false)
    setCmExport({
      title: t(lang, 'decks.missingCmTitle', { deck: d.name }),
      help: t(lang, 'decks.missingCmHelp', { n: lines.reduce((s, l) => s + l.qty + l.foil, 0), eur: fmtEur(lang, cost) ?? '' }),
      text: wantsText(lines),
      wants: lines.length ? lines : undefined,
    })
  }

  /** Collection −/+ for deck rows, normal and foil stacked; stays visible once the deck's copies are owned. */
  function collectionButtons(id: string) {
    const c = byId.get(id)
    // Foil only cards have no normal copies, plain runes no foil.
    const fields: ('qty' | 'foil')[] = !c ? ['qty'] : isFoilOnly(c) ? ['foil'] : isPlainRune(c) ? ['qty'] : ['qty', 'foil']
    return (
      <div className="row-coll" onClick={(e) => e.stopPropagation()}>
        <span className="qty-label">{t(lang, 'decks.addToCollection')}</span>
        {fields.map((f) => {
          const n = collection[id]?.[f] || 0
          return (
            <div key={f} className="row-coll-line">
              <span className="row-coll-kind">
                {t(lang, f === 'foil' ? 'qty.foil' : 'qty.normal')}
                {f === 'foil' && <span className="foil-star" aria-hidden="true">★</span>}
              </span>
              <div className="qty">
                <button
                  type="button"
                  title={t(lang, f === 'foil' ? 'decks.removeFoilFromCollection' : 'decks.removeFromCollection')}
                  aria-label={t(lang, f === 'foil' ? 'decks.removeFoilFromCollection' : 'decks.removeFromCollection')}
                  disabled={n === 0}
                  onClick={() => bump(id, f, -1)}
                >−</button>
                <b className={n ? 'have' : ''}>{n}</b>
                <button
                  type="button"
                  title={t(lang, f === 'foil' ? 'decks.addFoilCopy' : 'decks.addCopy')}
                  aria-label={t(lang, f === 'foil' ? 'decks.addFoilCopy' : 'decks.addCopy')}
                  onClick={() => bump(id, f, 1)}
                >+</button>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  /** Plain rune of a domain to add to the rune deck: the print with the most free copies. */
  function plainRuneFor(domain: string) {
    let best: Card | null = null
    for (const c of cards) {
      if (!isPlainRune(c) || !(c.domains || []).includes(domain)) continue
      if (!best || availableForDecks(c.id) > availableForDecks(best.id)) best = c
    }
    return best
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
    setExportTitleKey('decks.exportTitle')
    setDeckExportText(formatDeckList(activeDeck))
  }

  async function openDeckShare(deck: Deck) {
    if (deckShotBusy) return
    setDeckShotBusy(true)
    try {
      const res = await renderDeckShareCanvas(deck, byId)
      if (!res.ok) {
        window.alert(t(lang, 'decks.shareFail'))
        return
      }
      setSharePreview({ dataUrl: res.dataUrl, fileName: res.fileName, exportText: formatDeckList(deck) })
    } catch {
      window.alert(t(lang, 'decks.shareFail'))
    } finally {
      setDeckShotBusy(false)
    }
  }

  function downloadDeckShare() {
    if (!sharePreview) return
    downloadSharePng(sharePreview.dataUrl, sharePreview.fileName)
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
    if (!cardLightbox && !clearSec && deckExportText == null && !sharePreview && !cmExport) return
    const onKey = (e: KeyboardEvent) => {
      const onTop = cmExport || sharePreview || deckExportText != null || clearSec
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && cardLightbox && !onTop) {
        if ((e.target as HTMLElement).closest('input, textarea, select')) return
        e.preventDefault()
        const to = e.key === 'ArrowRight' ? lbNav.next : lbNav.prev
        if (to) openCardLightbox(to)
        return
      }
      if (e.key !== 'Escape') return
      if (cmExport) setCmExport(null)
      else if (sharePreview) setSharePreview(null)
      else if (deckExportText != null) setDeckExportText(null)
      else if (clearSec) setClearSec(null)
      else setCardLightbox(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cardLightbox, clearSec, deckExportText, sharePreview, cmExport, lbNav])

  function openCardLightbox(c: Card) {
    setCardPreview(null)
    setBfTurn(false)
    setArtReady(false)
    setCardLightbox(c)
  }

  /**
   * Previous/next card of the list the open card sits in: every card opener carries
   * data-card-id, and the list is the closest ancestor that holds more than one.
   */
  useEffect(() => {
    if (!cardLightbox) return setLbNav({})
    const outside = (el: Element) => !el.closest('.card-lightbox')
    const self = [...document.querySelectorAll(`[data-card-id="${CSS.escape(cardLightbox.id)}"]`)].find(outside)
    let box = self?.parentElement
    while (box && box.querySelectorAll('[data-card-id]').length < 2) box = box.parentElement
    if (!box) return setLbNav({})
    const ids = [...new Set([...box.querySelectorAll<HTMLElement>('[data-card-id]')].filter(outside).map((el) => el.dataset.cardId))]
    const i = ids.indexOf(cardLightbox.id)
    const prev = byId.get(ids[i - 1] || '')
    const next = byId.get(ids[i + 1] || '')
    // Arrow-key browsing should never wait on the network.
    preloadArt(next?.image)
    preloadArt(prev?.image)
    setLbNav({ prev, next })
  }, [cardLightbox, byId])

  /** Bundled thumbnail shown in the large view until the full art has loaded. */
  const lbThumb = cardLightbox && cardThumb(cardLightbox) !== cardArt(cardLightbox.image) ? cardThumb(cardLightbox) : undefined

  function setCardLots(id: string, lots: CopyLot[]) {
    setCopies((prev) => {
      const n = { ...prev }
      if (lots.length) n[id] = lots
      else delete n[id]
      return n
    })
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
    preloadArt(src)
    setCardPreview({ src: thumbForImage(src) ?? src, x, y })
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
                        <button className="btn primary" disabled={!deckImportText.trim()} onClick={() => runDeckImport(deckImportText)}><Icon name="upload" />{t(lang, 'decks.importBtn')}</button>
                      </div>
                    </div>
                  )}

                  {(() => {
                    // Opened from the "Still missing" tile in the deck header.
                    if (!missingExpanded) return null
                    const under = underOwnedLines(activeDeck)
                    if (!under.length) return null
                    // Grouped by set in binder order, by card code inside a set, so the binder can be flipped through.
                    const setRank = (s: string) => {
                      const i = (BINDER_SET_ORDER as readonly string[]).indexOf(s)
                      return i < 0 ? BINDER_SET_ORDER.length : i
                    }
                    const groups = new Map<string, typeof under>()
                    for (const u of [...under].sort((a, b) => {
                      const ca = byId.get(a.id)
                      const cb = byId.get(b.id)
                      return setRank(ca?.set || '') - setRank(cb?.set || '') ||
                        (ca?.set || '').localeCompare(cb?.set || '') ||
                        (ca?.code || a.id).localeCompare(cb?.code || b.id, undefined, { numeric: true })
                    })) {
                      const s = byId.get(u.id)?.set || ''
                      groups.set(s, [...(groups.get(s) || []), u])
                    }
                    return (
                      <div className="deck-warn">
                        <div className="toolbar deck-warn-tools">
                          <button type="button" className="btn small" onClick={() => openDeckMissingExport(activeDeck)}>
                            <Icon name="download" />{t(lang, 'cm.wantsBtn')}
                          </button>
                        </div>
                        {[...groups].map(([setId, rows]) => (
                          <div key={setId || '-'} className="deck-warn-set">
                          <div className="deck-warn-set-head">
                            <b>{setId || '?'}</b>
                            {sets[setId] && <span>{sets[setId]}</span>}
                            <span className="muted">{rows.reduce((n, u) => n + u.short, 0)}×</span>
                          </div>
                          <div className="deck-warn-list">
                            {rows.map((u) => {
                              const img = byId.get(u.id)?.image
                              const pe = priceBook?.cards[u.id]
                              return (
                                <div
                                  key={u.id}
                                  className="list-item deck-warn-row"
                                  onMouseEnter={(e) => showCardPreview(e, img)}
                                  onMouseMove={(e) => showCardPreview(e, img)}
                                  onMouseLeave={hideCardPreview}
                                  onClick={(e) => { const c = byId.get(u.id); if (c && !isControlClick(e)) openCardLightbox(c) }}
                                >
                                  {img ? (
                                    <img
                                      className="deck-thumb"
                                      src={thumbForImage(img)}
                                      alt=""
                                      loading="lazy"
                                      decoding="async"
                                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
                                    />
                                  ) : (
                                    <div className="deck-thumb deck-thumb-empty" aria-hidden />
                                  )}
                                  <div className="grow">
                                    <div className="name-with-ban">
                                      <button
                                        type="button"
                                        className="name name-link"
                                        title={t(lang, 'price.openCm')}
                                        disabled={!pe?.cmUrl}
                                        onClick={() => openCm(pe, lang)}
                                      >{u.name}</button>
                                      {byId.get(u.id) && <SetBadge c={byId.get(u.id)!} />}
                                    </div>
                                    <div className="sub">{byId.get(u.id)?.code}</div>
                                    <div className="sub">{t(lang, 'decks.needHave', { need: u.need, have: u.have })}</div>
                                    {collectionButtons(u.id)}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                          </div>
                        ))}
                      </div>
                    )
                  })()}

                  {deckNotice && (
                    <div className="deck-notice" role="status">
                      <span>{deckNotice}</span>
                      <button type="button" className="btn small" onClick={() => setDeckNotice(null)}><Icon name="check" />OK</button>
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
                                    <Icon name="hand" />{t(lang, 'hand.new')}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn"
                                    disabled={mulliganUsed || handSelected.length < 1 || handSelected.length > 2 || !handCards}
                                    title={mulliganUsed ? t(lang, 'hand.mulliganDone') : t(lang, 'hand.selectHint')}
                                    onClick={runMulligan}
                                  >
                                    <Icon name="shuffle" />{t(lang, 'hand.mulligan')}
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
                                    <Icon name="arrow-down-to-line" />{t(lang, 'hand.draw')}
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
                                            <div className="art"><ArtImg src={cardThumb(c)} /></div>
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
      <aside className="sidebar">
        <div className="brand titlebar">
          <img className="brand-dante" src={publicAsset('dante.png')} alt="Dante" />
          <div className="brand-text">
            <div className="brand-title">Deakrix</div>
            <div className="brand-sub">Riftbound Tracker</div>
          </div>
        </div>
        <nav className="side-nav no-drag" aria-label="Navigation">
          {([
            ['collection', 'tab.collection', 'album'],
            ['owned', 'collection.allOwned', 'badge-check'],
            ['catalog', 'tab.catalog', 'layout-grid'],
            ['sales', 'tab.sales', 'coins'],
            ['decks', 'tab.decks', 'layers'],
            ['borrowed', 'tab.borrowed', 'handshake'],
            ['stores', 'tab.stores', 'store'],
            ['dopamin', 'tab.dopamin', 'booster-open'],
          ] as const).map(([id, key, icon]) => (
            <button key={id} type="button" className={`side-item ${tab === id ? 'active' : ''}`} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
              <Icon name={icon} />
              <span className="side-label">{t(lang, key)}</span>
              {id === 'collection' && newWishHits.length > 0 && (
                <span className="side-badge" title={t(lang, 'alert.notifyTitle')}>{newWishHits.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="side-footer no-drag">
          <div className="side-stats">
            {collectionValue && (
              <button
                type="button"
                className="side-value"
                title={`${t(lang, 'stats.valueTitle')} · ${t(lang, 'value.open')}`}
                onClick={() => { setTab('collection'); setBinderView(null); setWishOpen(false); setValueOpen(true) }}
              >~{fmtEur(lang, collectionValue.sum)}</button>
            )}
            <div>{t(lang, 'stats.line1', { unique: totals.unique, copies: totals.copies })}</div>
            <div>{t(lang, 'stats.line2', { catalog: totals.catalog })}</div>
          </div>
          <div className="side-actions">
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
                <img className="lang-flag" src={lang === 'de' ? 'flags/de.svg' : 'flags/gb.svg'} alt="" width={18} height={12} />
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
          <div className="maker-credit">made by Stefan</div>
        </div>
      </aside>

      <div className="content">
        <header className="top titlebar">
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

      <main className={`main${tab === 'stores' ? ' main-stores' : ''}${(tab === 'collection' || tab === 'owned') && binderView != null ? ' main-binder' : ''}${tab === 'dopamin' ? ' main-dopamin' : ''}`}>
        {tab === 'collection' && binderView == null && !wishOpen && !valueOpen && (
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
                <Icon name="eye-off" />{t(lang, 'collection.hideNexusNight')}
              </button>
              <button className="btn" onClick={exportCsv}><Icon name="file-down" />{t(lang, 'catalog.csvExport')}</button>
              <label className="btn">
                <Icon name="file-up" />{t(lang, 'catalog.csvImport')}
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
                <Icon name="zap" />{t(lang, 'collection.quickImport')}
              </button>
              <button type="button" className="btn" onClick={() => { setWishOpen(true); setQ(''); setSetFilter('') }}>
                <Icon name="heart" />{t(lang, 'wish.title')}
              </button>
              <button type="button" className="btn" onClick={() => setValueOpen(true)}>
                <Icon name="trending-up" />{t(lang, 'value.open')}
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
                <button className="btn primary small" disabled={!bulkText.trim()} onClick={runQuickImport}><Icon name="upload" />{t(lang, 'decks.importBtn')}</button>
                <button type="button" className="btn small" onClick={() => setQuickOpen(false)}><Icon name="x" />{t(lang, 'decks.exportClose')}</button>
                {bulkReport && <p className="help">{bulkReport}</p>}
              </div>
            )}
            {newWishHits.length > 0 && (
              <div className="deck-notice alert-notice" role="status">
                <span><Icon name="bell" /> {t(lang, newWishHits.length === 1 ? 'alert.bannerOne' : 'alert.bannerMany', { n: newWishHits.length })}</span>
                <button type="button" className="btn small" onClick={() => { setWishOpen(true); setQ(''); setSetFilter('') }}>{t(lang, 'alert.show')}</button>
              </div>
            )}
            {invest.copies > 0 && (
              <button type="button" className="invest-strip" onClick={() => setValueOpen(true)} title={t(lang, 'value.open')}>
                <Icon name="tag" />
                <span>{t(lang, 'invest.strip', { n: invest.copies, paid: fmtEur(lang, invest.paid) ?? '', worth: fmtEur(lang, invest.worth) ?? '' })}</span>
                <b className={invest.worth - invest.paid >= 0 ? 'value-up' : 'value-down'}>{fmtSignedEur(lang, invest.worth - invest.paid)}</b>
              </button>
            )}
            <div className="binder-grid">
              {setProgress.map((s) => (
                <button key={s.id} type="button" className="binder-tile" onClick={() => { setBinderView(s.id); setBinderRarity(null); setQ(''); setBinderOwnedOnly(false); setBinderMissing(false); setBinderMissingFoil(false) }}>
                  <div className="binder-tile-head">
                    <div className="binder-tile-meta">
                      <div className="binder-code">{s.id}</div>
                      <div className="binder-name">{s.name}</div>
                      <div className="binder-progress">{s.owned} / {s.total} ({s.pct}%)</div>
                      <div className="binder-bar"><span style={{ width: `${s.pct}%` }} /></div>
                      <div className="binder-progress binder-foil">{t(lang, 'collection.foils', { owned: s.foilOwned, total: s.foilTotal })}</div>
                      <div className="binder-bar binder-bar-foil"><span style={{ width: `${s.foilTotal ? Math.round((s.foilOwned / s.foilTotal) * 100) : 0}%` }} /></div>
                      {s.eur != null && <div className="binder-eur">~{fmtEur(lang, s.eur)}</div>}
                      {s.missingEur != null && s.owned < s.total && (
                        <div className="binder-progress">{t(lang, 'collection.missingEur', { eur: fmtEur(lang, s.missingEur) ?? '' })}</div>
                      )}
                    </div>
                    {(SET_ART_IDS.has(s.id) || s.id.endsWith('-NN')) && (
                      <img
                        className="binder-set-art"
                        src={publicAsset(s.id.endsWith('-NN') ? 'sets/NN.svg' : `sets/${s.id}.png`)}
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
                            setBinderMissingFoil(false)
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
                            setBinderMissingFoil(false)
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
            </div>
          </>
        )}

        {tab === 'collection' && binderView == null && !wishOpen && valueOpen && (
          <ValueHistory
            lang={lang}
            points={pricePoints}
            collection={collection}
            byId={byId}
            invest={invest}
            weighted={weightedCollection}
            onBack={() => setValueOpen(false)}
            onOpenCard={openCardLightbox}
          />
        )}

        {tab === 'collection' && binderView == null && wishOpen && (() => {
          const ids = Object.keys(wish)
          const total = ids.reduce((s, id) => s + ownedLineEur(wish[id], priceBook?.cards[id]), 0)
          const query = q.trim().toLowerCase()
          const pick = cards.filter((c) => (!setFilter || c.set === setFilter) && matchesSharedFilters(c, query)).slice(0, 120)
          return (
            <div className={`split deck-split${poolHidden ? ' pool-hidden' : ''}`}>
              <section className="panel col-fill" data-remove-src="wish">
                <div className="toolbar">
                  <button className="btn" onClick={() => setWishOpen(false)}><Icon name="arrow-left" />{t(lang, 'collection.back')}</button>
                  <h2 style={{ margin: 0 }}>{t(lang, 'wish.title')}</h2>
                  <span className="deck-list-count">{ids.length} {cardWord(lang, ids.length)}</span>
                  <span style={{ flex: 1 }} />
                  <span className="deck-list-count">{t(lang, 'wish.total', { eur: fmtEur(lang, total) ?? '' })}</span>
                  {wishHits.size > 0 && <span className="deck-list-count alert-count"><Icon name="bell" /> {t(lang, 'alert.count', { n: wishHits.size })}</span>}
                  <button type="button" className="btn" disabled={ids.length === 0} onClick={openWantsExport}><Icon name="external-link" />{t(lang, 'cm.wantsBtn')}</button>
                  {poolToggle()}
                </div>
                <div {...cartDrop('wish', (id) => byId.has(id), (id) => bumpWish(id, 'qty', 1))}>
                  {ids.length === 0 && <div className="empty">{t(lang, 'wish.empty')}</div>}
                  <div className="grid">
                    {ids.map((id) => {
                      const c = byId.get(id)
                      if (!c) return null
                      return (
                        <CardTile
                          key={id}
                          c={c}
                          o={wish[id]}
                          lang={lang}
                          priceEntry={priceBook?.cards[id]}
                          variant="catalog"
                          errata={!!errataFor(c)}
                          onOpen={openCardLightbox}
                          onBump={bumpWish}
                          dragProps={removeDragProps('wish', () => bumpWish(id, wish[id]?.qty ? 'qty' : 'foil', -1))}
                        >
                          <div className={`wish-alert${wishHits.has(id) ? ' hit' : ''}`}>
                            <span className="wish-alert-label"><Icon name="bell" size={13} />{t(lang, 'alert.below')}</span>
                            <MoneyInput lang={lang} value={wishTargets[id] ?? null} label={t(lang, 'alert.target')} placeholder={t(lang, 'alert.targetPh')} onChange={(v) => setWishTarget(id, v)} />
                          </div>
                          {wishHits.has(id) && (
                            <div className="wish-alert-hit">{t(lang, 'alert.hit', { eur: fmtEur(lang, wishHits.get(id)) ?? '' })}</div>
                          )}
                          <div className="row">
                            <button type="button" className="btn small positive" onClick={() => gotWish(id)}><Icon name="check" />{t(lang, 'wish.got')}</button>
                            <button
                              type="button"
                              className="btn icon small danger deck-trash"
                              title={t(lang, 'borrowed.removeCard')}
                              aria-label={t(lang, 'borrowed.removeCard')}
                              onClick={() => setDeckConfirm({ kind: 'wish', id, name: displayCardName(c) })}
                            ><Icon name="trash-2" size={14} /></button>
                          </div>
                        </CardTile>
                      )
                    })}
                  </div>
                </div>
              </section>
              <section className="panel col-fill">
                <div className="toolbar">
                  <SearchInput wrapClassName="grow" lang={lang} placeholder={t(lang, 'decks.search')} value={q} onChange={setQ} />
                  <select className="select" style={{ maxWidth: 160 }} value={setFilter} onChange={(e) => setSetFilter(e.target.value)}>
                    <option value="">{t(lang, 'catalog.allSets')}</option>
                    {Object.entries(sets).map(([sid, name]) => (
                      <option key={sid} value={sid}>{name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn icon ghost"
                    title={t(lang, 'pool.hide')}
                    aria-label={t(lang, 'pool.hide')}
                    onClick={() => { localStorage.setItem('rb.poolHidden', '1'); setPoolHidden(true) }}
                  ><Icon name="x" /></button>
                </div>
                <div className="toolbar">
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
                  <AbilityMenu lang={lang} open={abilityMenuOpen} setOpen={setAbilityMenuOpen} value={abilityFilter} onChange={setAbilityFilter} menuRef={abilityMenuRef} />
                  <DomainFilterRow value={domainFilter} onChange={setDomainFilter} lang={lang} />
                </div>
                <div className="list">
                  {pick.map((c) => (
                    <div
                      key={c.id}
                      className="list-item picker-card"
                      draggable
                      onDragStart={(e) => onPickerDragStart(e, c.id)}
                      onDragEnd={onPickerDragEnd}
                      onMouseEnter={(e) => showCardPreview(e, c.image)}
                      onMouseMove={(e) => showCardPreview(e, c.image)}
                      onMouseLeave={hideCardPreview}
                      onClick={() => openCardLightbox(c)}
                    >
                      <DeckThumb cardId={c.id} src={c.image} onOpen={() => openCardLightbox(c)} openTitle={t(lang, 'card.enlarge')} />
                      <div className="grow">
                        <div className="name-with-ban">
                          <button
                            type="button"
                            className="name name-link"
                            title={t(lang, 'price.openCm')}
                            disabled={!priceBook?.cards[c.id]?.cmUrl}
                            onClick={(e) => { e.stopPropagation(); openCm(priceBook?.cards[c.id], lang) }}
                          >{displayName(c)}</button>
                          <SetBadge c={c} /><BanBadge status={banStatus(c)} lang={lang} />
                          <ErrataBadge show={!!errataFor(c)} lang={lang} />
                        </div>
                        <div className="sub">{c.code} · x{ownedQty(collection[c.id])}{c.energy != null ? ` · E${c.energy}` : ''}</div>
                        <PriceBits entry={priceBook?.cards[c.id]} lang={lang} />
                      </div>
                      <button className="btn small add" onClick={(e) => { e.stopPropagation(); bumpWish(c.id, 'qty', 1) }}><Icon name="plus" />{t(lang, 'decks.add')}</button>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )
        })()}

        {(tab === 'collection' || tab === 'owned') && binderView != null && (
          <div className="binder-view">
            <div className="binder-head">
              {tab === 'collection' && (
                <button type="button" className="btn icon" title={t(lang, 'collection.back')} aria-label={t(lang, 'collection.back')} onClick={() => { setBinderView(null); setBinderRarity(null) }}><Icon name="arrow-left" /></button>
              )}
              <h2 className="binder-head-title">
                {binderView === 'owned'
                  ? t(lang, 'collection.allOwned')
                  : `${activeBinderProgress?.id || binderView} - ${activeBinderProgress?.name || sets[binderView] || binderView}`}
              </h2>
              {activeBinderProgress && (
                <span className="sub">
                  {activeBinderProgress.owned}/{activeBinderProgress.total} ({activeBinderProgress.pct}%)
                  {' · '}{t(lang, 'collection.foils', { owned: activeBinderProgress.foilOwned, total: activeBinderProgress.foilTotal })}
                  {activeBinderProgress.missingEur != null && activeBinderProgress.owned < activeBinderProgress.total && (
                    <>{' · '}{t(lang, 'collection.missingEur', { eur: fmtEur(lang, activeBinderProgress.missingEur) ?? '' })}</>
                  )}
                </span>
              )}
              {binderView === 'owned' && (
                <span className="sub">{totals.unique} Unique | {totals.copies} {t(lang, 'bulk.copies')}</span>
              )}
              <SearchInput
                wrapClassName="binder-search"
                lang={lang}
                placeholder={t(lang, 'collection.search')}
                value={q}
                onChange={setQ}
              />
            </div>
            <div className="toolbar filter-bar">
              {binderView !== 'owned' && (rarityBySet[binderView] || []).map((row) => {
                const pct = row.total ? Math.round((row.owned / row.total) * 100) : 0
                const active = binderRarity === row.rarity
                return (
                  <button
                    key={row.rarity}
                    type="button"
                    aria-pressed={active}
                    title={active ? t(lang, 'collection.clearFilter') : t(lang, 'collection.filterRarity', { rarity: row.rarity })}
                    className={`rarity-chip ${raritySlug(row.rarity)}${active ? ' active' : ''}`}
                    onClick={() => setBinderRarity((cur) => (cur === row.rarity ? null : row.rarity))}
                  >
                    <span className="rarity-label">{row.rarity}</span>
                    <span className="rarity-count">{row.owned}/{row.total}</span>
                    <span className="rarity-track"><span style={{ width: `${pct}%` }} /></span>
                  </button>
                )
              })}
              {binderView !== 'owned' && (rarityBySet[binderView] || []).length > 0 && <span className="toolbar-sep" aria-hidden="true" />}
              {binderView === 'owned' && (
                <>
                  <button type="button" className={`chip set-chip ${!ownedSet ? 'active' : ''}`} aria-pressed={!ownedSet} onClick={() => setOwnedSet('')}>
                    {t(lang, 'catalog.allSets')}
                  </button>
                  {ownedSets.map(([sid, n]) => (
                    <button
                      key={sid}
                      type="button"
                      className={`chip set-chip ${ownedSet === sid ? 'active' : ''}`}
                      aria-pressed={ownedSet === sid}
                      title={sets[sid] || sid}
                      onClick={() => setOwnedSet((cur) => (cur === sid ? '' : sid))}
                    >
                      {sid}<span className="set-chip-count">{n}</span>
                    </button>
                  ))}
                  <span className="toolbar-sep" aria-hidden="true" />
                  <select
                    className="select"
                    aria-label={t(lang, 'owned.sort')}
                    value={ownedSort}
                    onChange={(e) => setOwnedSort(e.target.value as typeof ownedSort)}
                  >
                    <option value="set">{t(lang, 'owned.sortSet')}</option>
                    <option value="price-desc">{t(lang, 'owned.sortPriceDesc')}</option>
                    <option value="price-asc">{t(lang, 'owned.sortPriceAsc')}</option>
                  </select>
                  <button
                    type="button"
                    className={`chip ${ownedBorrowedOnly ? 'active' : ''}`}
                    aria-pressed={ownedBorrowedOnly}
                    onClick={() => setOwnedBorrowedOnly((v) => !v)}
                  >
                    <Icon name="check" />{t(lang, 'owned.borrowedOnly')}
                  </button>
                </>
              )}
              {binderView !== 'owned' && (
                <button
                  type="button"
                  className={`chip ${binderOwnedOnly ? 'active' : ''}`}
                  onClick={() => { setBinderOwnedOnly((v) => !v); if (!binderOwnedOnly) { setBinderMissing(false); setBinderMissingFoil(false) } }}
                >
                  <Icon name="check" />{t(lang, 'collection.ownedOnly')}
                </button>
              )}
              {binderView !== 'owned' && (
                <button
                  type="button"
                  className={`chip ${binderMissing ? 'active' : ''}`}
                  onClick={() => { setBinderMissing((v) => !v); if (!binderMissing) { setBinderOwnedOnly(false); setBinderMissingFoil(false) } }}
                >
                  <Icon name="list-x" />{t(lang, 'collection.missing')}
                </button>
              )}
              {binderView !== 'owned' && (
                <button
                  type="button"
                  className={`chip ${binderMissingFoil ? 'active' : ''}`}
                  onClick={() => { setBinderMissingFoil((v) => !v); if (!binderMissingFoil) { setBinderOwnedOnly(false); setBinderMissing(false) } }}
                >
                  <Icon name="list-x" />{t(lang, 'collection.missingFoil')}
                </button>
              )}
              {binderView !== 'owned' && (
                <button type="button" className="btn" onClick={openMissingExport} title={t(lang, 'missing.btnTitle')}>
                  <Icon name="external-link" />{t(lang, binderMissingFoil ? 'missing.btnFoil' : 'missing.btn')}
                </button>
              )}
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
              <AbilityMenu lang={lang} open={abilityMenuOpen} setOpen={setAbilityMenuOpen} value={abilityFilter} onChange={setAbilityFilter} menuRef={abilityMenuRef} />
              <DomainFilterRow value={domainFilter} onChange={setDomainFilter} lang={lang} />
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
                    errata={!!errataFor(c)}
                    inDecks={decksByCard.get(c.id)}
                    borrowedFrom={binderView === 'owned' ? borrowedInFrom.get(c.id) : undefined}
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
              <SearchInput
                wrapClassName="grow"
                lang={lang}
                placeholder={t(lang, 'collection.search')}
                value={q}
                onChange={setQ}
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
              <button className="btn" onClick={exportCsv}><Icon name="file-down" />{t(lang, 'catalog.csvExport')}</button>
              <label className="btn">
                <Icon name="file-up" />{t(lang, 'catalog.csvImport')}
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
            <div className="toolbar filter-bar">
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
              <AbilityMenu lang={lang} open={abilityMenuOpen} setOpen={setAbilityMenuOpen} value={abilityFilter} onChange={setAbilityFilter} menuRef={abilityMenuRef} />
              <button type="button" className={`chip ${ownedOnly ? 'active' : ''}`} aria-pressed={ownedOnly} onClick={() => setOwnedOnly((v) => !v)}>
                <Icon name="check" />{t(lang, 'catalog.ownedOnly')}
              </button>
              <DomainFilterRow value={domainFilter} onChange={setDomainFilter} lang={lang} />
            </div>

            <div className="grid">{catalogGrid}</div>
          </>
        )}

        {tab === 'sales' && (
          <div className={`split deck-split${poolHidden ? ' pool-hidden' : ''}`}>
            <section className="panel col-fill" data-remove-src="sale">
              <div className="toolbar">
                <h2 style={{ margin: 0 }}>{t(lang, 'sales.cart')}</h2>
                <span className="deck-list-count" style={{ flex: 1 }}>{t(lang, 'wish.total', { eur: fmtEur(lang, Object.entries(saleList).reduce((sum, [id, n]) => { const c = byId.get(id); return sum + (c ? ownedLineEur(isFoilOnly(c) ? { foil: n } : { qty: n }, priceBook?.cards[id]) : 0) }, 0)) ?? '' })}</span>
                <button
                  className="btn primary"
                  disabled={saleSelectedCount === 0}
                  onClick={confirmSale}
                  title={saleSelectedCount === 0 ? t(lang, 'sales.pickFirst') : undefined}
                >
                  <Icon name="badge-check" />{t(lang, 'sales.markSold')}{saleSelectedCount > 0 ? ` (${saleSelectedCount})` : ''}
                </button>
                <button type="button" className="btn" disabled={Object.keys(saleList).length === 0} onClick={openSellExport}><Icon name="file-down" />{t(lang, 'cm.sellBtn')}</button>
                {poolToggle()}
              </div>
              {saleReport && <p className="help">{saleReport}</p>}
              <div {...cartDrop('sale', (id) => ownedQty(collection[id]) > 0 && saleRemaining(id) > 0, (id) => addToSale(id, 1))}>
                {Object.keys(saleList).length === 0 && (
                  <div className="empty">{t(lang, 'sales.emptyCart')}</div>
                )}
                <div className="grid">
                  {Object.entries(saleList).map(([id, qty]) => {
                    const c = byId.get(id)
                    if (!c) return null
                    const have = ownedQty(collection[id])
                    const line = ownedLineEur(isFoilOnly(c) ? { foil: qty } : { qty }, priceBook?.cards[id])
                    return (
                      <CardTile
                        key={id}
                        c={c}
                        o={collection[id] || { qty: 0, foil: 0 }}
                        lang={lang}
                        priceEntry={priceBook?.cards[id]}
                        variant="catalog"
                        errata={!!errataFor(c)}
                        onOpen={openCardLightbox}
                        onBump={() => {}}
                        dragProps={removeDragProps('sale', () => bumpSale(id, -1))}
                        qtyRow={
                          <div className="row row-center">
                            <div className="qty">
                              <button type="button" onClick={() => bumpSale(id, -1)}>-</button>
                              <input
                                className="field"
                                style={{ width: 44, textAlign: 'center', padding: '2px 4px' }}
                                value={qty}
                                onChange={(e) => setSaleQty(id, Number(e.target.value))}
                              />
                              <button type="button" onClick={() => bumpSale(id, 1)} disabled={qty >= have}>+</button>
                            </div>
                          </div>
                        }
                      >
                        <div className="row">
                          <label className="sale-check" title={t(lang, 'sales.selectForSale')}>
                            <input type="checkbox" checked={!!saleSelected[id]} onChange={() => toggleSaleSelected(id)} />
                            <span className="sub">{t(lang, 'decks.owns', { have })}</span>
                          </label>
                          <b>{fmtEur(lang, line)}</b>
                        </div>
                      </CardTile>
                    )
                  })}
                </div>
              </div>
            </section>
            <section className="panel col-fill">
              <h2>{t(lang, 'sales.addTitle')}</h2>
              <SearchInput
                lang={lang}
                placeholder={t(lang, 'sales.searchOwned')}
                value={saleQ}
                onChange={setSaleQ}
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
                      onClick={() => openCardLightbox(c)}
                    >
                      <DeckThumb cardId={c.id} src={c.image} onOpen={() => openCardLightbox(c)} openTitle={t(lang, 'card.enlarge')} zoomIcon />
                      <div className="grow">
                        <button
                          type="button"
                          className="name name-link"
                          title={t(lang, 'price.openCm')}
                          disabled={!priceBook?.cards[c.id]?.cmUrl}
                          onClick={(e) => { e.stopPropagation(); openCm(priceBook?.cards[c.id], lang) }}
                        >{displayName(c)}</button>
                        <div className="sub">{c.code} · x{have}{room < have ? t(lang, 'sales.inCart', { n: have - room }) : ''}</div>
                        <PriceBits entry={priceBook?.cards[c.id]} lang={lang} />
                      </div>
                      <button className="btn small add" disabled={room <= 0} onClick={(e) => { e.stopPropagation(); addToSale(c.id, 1) }} title={t(lang, 'sales.toCart')} aria-label={t(lang, 'sales.toCart')}>
                        <Icon name="shopping-cart" />
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
                  <Icon name="shopping-cart" />{t(lang, 'sales.toCart')}
                </button>
                <button className="btn small" disabled={!salePaste.trim()} onClick={() => setSalePaste('')}>
                  <Icon name="eraser" />{t(lang, 'sales.clear')}
                </button>
              </div>
            </section>
          </div>
        )}

        {tab === 'decks' && (
          <div className={`split deck-split${poolHidden ? ' pool-hidden' : ''}`}>
            <section className="panel deck-list-panel" data-remove-src="deck">
              <div className="toolbar">
                <h2 style={{ margin: 0 }}>{t(lang, 'decks.title')}</h2>
                <span className="deck-list-count">{t(lang, 'decks.count', { n: decks.length })}</span>
                <span style={{ flex: 1 }} />
                {deckUndoOn && (
                  <button type="button" className="btn" onClick={restoreDecks}><Icon name="rotate-ccw" />{t(lang, 'decks.restore')}</button>
                )}
                <button type="button" className="btn deck-trash" disabled={decks.length === 0} onClick={() => setDeckConfirm({ kind: 'all' })}>
                  <Icon name="trash-2" />{t(lang, 'decks.deleteAll')}
                </button>
                <button className="btn primary" onClick={newDeck}><Icon name="plus" />{t(lang, 'decks.new')}</button>
                {poolToggle()}
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
                        {legendImg && <DeckThumb src={legendImg} lg />}
                        {expanded ? (
                          <div className="grow deck-hero">
                            <div className="deck-hero-title">
                              <input
                                className="deck-hero-name"
                                value={d.name}
                                onChange={(e) => updateDeck((deck) => ({ ...deck, name: e.target.value }))}
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => e.stopPropagation()}
                                aria-label={t(lang, 'decks.rename')}
                              />
                              <span className="deck-acc-count">{deckCount(d)} {cardWord(lang, deckCount(d))}</span>
                            </div>
                            {sums && (
                              <div className="deck-hero-stats">
                                <div className="deck-stat">
                                  <span>{t(lang, 'decks.totalLow')}</span>
                                  <b>{sums.priced > 0 ? fmtEur(lang, sums.deckLow) : '—'}</b>
                                  {sums.priced > 0 && sums.priced < deckCount(d) && <small>{t(lang, 'decks.partialPrice')}</small>}
                                </div>
                                {missCopies > 0 && (
                                  <button
                                    type="button"
                                    className="deck-stat deck-stat-warn"
                                    aria-expanded={missingExpanded}
                                    title={t(lang, missingExpanded ? 'decks.hideMissing' : 'decks.showMissing')}
                                    onClick={(e) => { e.stopPropagation(); setMissingExpanded((v) => !v) }}
                                    onKeyDown={(e) => e.stopPropagation()}
                                  >
                                    <span>{t(lang, 'decks.missingCopies')}</span>
                                    <b>{sums.missingPriced > 0 ? fmtEur(lang, sums.missingLow) : '—'}</b>
                                    <small>
                                      {under.length} {cardWord(lang, under.length)} · {missCopies} {copyWord(lang, missCopies)}
                                      <Icon name={missingExpanded ? 'chevron-up' : 'chevron-down'} size={14} />
                                    </small>
                                  </button>
                                )}
                              </div>
                            )}
                            <div className="deck-hero-actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                              {isDeckComplete(d.cards) && (
                                <button type="button" className="btn small primary" disabled={deckShotBusy} onClick={() => void openDeckShare(d)}>
                                  <Icon name="share-2" />{deckShotBusy ? t(lang, 'decks.shareBusy') : t(lang, 'decks.share')}
                                </button>
                              )}
                              <button type="button" className="btn small" onClick={openDeckExport}>
                                <Icon name="download" />{t(lang, 'decks.export')}
                              </button>
                              <button
                                type="button"
                                className="btn small"
                                onClick={() => {
                                  setDeckImportOpen((v) => !v)
                                  setDeckImportText('')
                                }}
                              >
                                <Icon name="upload" />{t(lang, 'decks.import')}
                              </button>
                              <button
                                type="button"
                                className="btn small icon danger deck-trash deck-hero-delete"
                                title={t(lang, 'decks.delete')}
                                aria-label={t(lang, 'decks.delete')}
                                onClick={() => setDeckConfirm({ kind: 'one', id: d.id, name: d.name })}
                              >
                                <Icon name="trash-2" size={16} />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="grow deck-acc-title">
                            <span className="name">{d.name}</span>
                            <span className="deck-acc-count">· {deckCount(d)} {cardWord(lang, deckCount(d))}</span>
                          </div>
                        )}
                        {!expanded && (
                          <button
                            type="button"
                            className="btn icon danger deck-trash"
                            title={t(lang, 'decks.delete')}
                            aria-label={t(lang, 'decks.delete')}
                            onClick={(e) => {
                              e.stopPropagation()
                              setDeckConfirm({ kind: 'one', id: d.id, name: d.name })
                            }}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <Icon name="trash-2" size={16} />
                          </button>
                        )}
                      </div>
                      {expanded && (
                        <div className="deck-acc-body">
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
                <SearchInput wrapClassName="grow" lang={lang} placeholder={t(lang, 'decks.search')} value={q} onChange={setQ} />
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
                    // Plain runes have their own counter per domain, the list only offers alt art runes
                    // (Nexus Night runes with the normal art count as plain here too).
                    if (activeSection === 'rune' && (isPlainRune(c) || (c.set.endsWith('-NN') && !c.altArt))) return false
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
                      // Any section can be a drop target; each one checks its own cap and Legend rule on drop.
                      draggable={!!activeDeck}
                      onDragStart={(e) => onPickerDragStart(e, c.id)}
                      onDragEnd={onPickerDragEnd}
                      onMouseEnter={(e) => showCardPreview(e, c.image)}
                      onMouseMove={(e) => showCardPreview(e, c.image)}
                      onMouseLeave={hideCardPreview}
                      onClick={() => openCardLightbox(c)}
                    >
                      <DeckThumb cardId={c.id} src={c.image} onOpen={() => openCardLightbox(c)} openTitle={t(lang, 'card.enlarge')} />
                      <div className="grow">
                        <div className="name-with-ban">
                          <button
                            type="button"
                            className="name name-link"
                            title={t(lang, 'price.openCm')}
                            disabled={!priceBook?.cards[c.id]?.cmUrl}
                            onClick={(e) => { e.stopPropagation(); openCm(priceBook?.cards[c.id], lang) }}
                          >{displayName(c)}</button>
                          <SetBadge c={c} /><BanBadge status={banStatus(c)} lang={lang} />
                          <ErrataBadge show={!!errataFor(c)} lang={lang} />
                        </div>
                        <div className="sub">{c.code} · x{ownedQty(collection[c.id])}{c.energy != null ? ` · E${c.energy}` : ''}</div>
                        <PriceBits entry={priceBook?.cards[c.id]} lang={lang} />
                      </div>
                      <button
                        className="btn small add"
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
                        onClick={(e) => { e.stopPropagation(); addToDeck(c.id, activeSection) }}
                      >
                        <Icon name="plus" />{t(lang, 'decks.add')}
                      </button>
                    </div>
                  ))}
              </div>
            </section>
          </div>
        )}

        {tab === 'borrowed' && (
          <div className={`split deck-split${poolHidden ? ' pool-hidden' : ''}`}>
            <section className="panel deck-list-panel" data-remove-src="borrow">
              <div className="toolbar">
                <h2 style={{ margin: 0 }}>{t(lang, 'borrowed.title')}</h2>
                <span className="deck-list-count">{t(lang, 'borrowed.count', { n: borrowed.length })}</span>
                <span style={{ flex: 1 }} />
                {borrowUndoOn && (
                  <button type="button" className="btn" onClick={restoreBorrowed}><Icon name="rotate-ccw" />{t(lang, 'decks.restore')}</button>
                )}
                <button type="button" className="btn deck-trash" disabled={borrowed.length === 0} onClick={() => setDeckConfirm({ kind: 'borrowAll' })}>
                  <Icon name="trash-2" />{t(lang, 'borrowed.deleteAll')}
                </button>
                <button
                  className="btn"
                  disabled={!activeBorrowed}
                  onClick={() => {
                    setBorrowImportOpen((v) => !v)
                    setBorrowImportText('')
                  }}
                ><Icon name="upload" />{t(lang, 'borrowed.import')}</button>
                <button className="btn primary" onClick={newBorrowedGroup}><Icon name="plus" />{t(lang, 'borrowed.new')}</button>
                {poolToggle()}
              </div>
              <p className="help">{t(lang, 'borrowed.help')}</p>
              <div className="deck-accordion">
                {borrowed.length === 0 && <div className="empty">{t(lang, 'borrowed.empty')}</div>}
                {borrowed.map((g) => {
                  const expanded = g.id === activeBorrowedId
                  return (
                    <div key={g.id} className={`deck-acc-item${expanded ? ' expanded active' : ''}`}>
                      <div
                        className="deck-acc-head"
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          if (deckDragged.current) return
                          if (expanded) setActiveBorrowedId(null)
                          else setActiveBorrowedId(g.id)
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return
                          e.preventDefault()
                          if (expanded) setActiveBorrowedId(null)
                          else setActiveBorrowedId(g.id)
                        }}
                      >
                        <span
                          className="deck-drag"
                          title={t(lang, 'borrowed.reorder')}
                          aria-label={t(lang, 'borrowed.reorder')}
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => onDeckReorderPointerDown(e, g.id, 'borrow')}
                        >⠿</span>
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
                          {!expanded && g.direction === 'from' && <span className="pill">{t(lang, 'borrowed.dirFrom')}</span>}
                        </div>
                        {expanded && <span className="pill ok">{t(lang, 'borrowed.active')}</span>}
                        {!expanded && (
                          <button
                            type="button"
                            className="btn icon danger deck-trash"
                            title={t(lang, 'borrowed.delete')}
                            aria-label={t(lang, 'borrowed.delete')}
                            onClick={(e) => {
                              e.stopPropagation()
                              setDeckConfirm({ kind: 'borrow', id: g.id, name: g.name })
                            }}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <Icon name="trash-2" size={16} />
                          </button>
                        )}
                      </div>
                      {expanded && (
                        <div className="deck-acc-body">
                          <div className="deck-acc-summary-row">
                            <div className="grow borrow-direction" role="tablist">
                              {([undefined, 'from'] as const).map((d) => (
                                <button
                                  key={d ?? 'lent'}
                                  type="button"
                                  role="tab"
                                  aria-selected={g.direction === d}
                                  className={`chip${g.direction === d ? ' active' : ''}`}
                                  onClick={() => updateBorrowed((group) => ({ ...group, direction: d }))}
                                >
                                  <Icon name={d ? 'arrow-down-left' : 'arrow-up-right'} />
                                  {t(lang, d ? 'borrowed.dirFrom' : 'borrowed.dirLent')}
                                </button>
                              ))}
                            </div>
                            <button
                              type="button"
                              className="btn"
                              disabled={g.cards.length === 0}
                              onClick={() => {
                                setDeckExportCopied(false)
                                setExportTitleKey('borrowed.exportTitle')
                                setDeckExportText(formatBorrowList(g.cards, byId, g.name, g.direction !== 'from'))
                              }}
                            ><Icon name="download" />{t(lang, 'borrowed.export')}</button>
                            <button
                              type="button"
                              className="btn icon danger deck-trash"
                              title={t(lang, 'borrowed.delete')}
                              aria-label={t(lang, 'borrowed.delete')}
                              onClick={(e) => {
                                e.stopPropagation()
                                setDeckConfirm({ kind: 'borrow', id: g.id, name: g.name })
                              }}
                            >
                              <Icon name="trash-2" size={16} />
                            </button>
                          </div>

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
                                ><Icon name="upload" />{t(lang, 'borrowed.importBtn')}</button>
                              </div>
                            </div>
                          )}

                          {borrowNotice && (
                            <div className="deck-notice" role="status">
                              <span>{borrowNotice}</span>
                              <button type="button" className="btn small" onClick={() => setBorrowNotice(null)}><Icon name="check" />OK</button>
                            </div>
                          )}

                          <div
                            className={borrowDropClass()}
                            onDragOver={onBorrowDragOver}
                            onDragLeave={onBorrowDragLeave}
                            onDrop={onBorrowDrop}
                          >
                            {g.cards.length === 0 && (
                              <div className="empty">{t(lang, 'borrowed.emptyCards')}</div>
                            )}
                            {g.cards.map((bc) => {
                              const c = byId.get(bc.id)
                              const have = ownedQty(collection[bc.id])
                              const avail = availableForDecks(bc.id)
                              const room = remainingToLend(bc.id)
                              const img = c?.image
                              return (
                                <div
                                  key={bc.id}
                                  className="list-item deck-card-row"
                                  {...removeDragProps('borrow', () => bumpBorrowedCard(bc.id, -1))}
                                  onMouseEnter={(e) => showCardPreview(e, img)}
                                  onMouseMove={(e) => showCardPreview(e, img)}
                                  onMouseLeave={hideCardPreview}
                                  onClick={(e) => { if (c && !isControlClick(e)) openCardLightbox(c) }}
                                >
                                  <DeckThumb cardId={c?.id} src={img} onOpen={c ? () => openCardLightbox(c) : undefined} openTitle={t(lang, 'card.enlarge')} zoomIcon />
                                  <div className="grow">
                                    <button
                                      type="button"
                                      className="name name-link"
                                      title={t(lang, 'price.openCm')}
                                      disabled={!priceBook?.cards[bc.id]?.cmUrl}
                                      onClick={() => openCm(priceBook?.cards[bc.id], lang)}
                                    >{c ? displayCardName(c) : bc.id}</button>
                                    <div className="sub">
                                      {c ? `${c.code} · ` : ''}{g.direction === 'from' ? t(lang, 'decks.owns', { have }) : t(lang, 'borrowed.ownedAvail', { have, avail })}
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
                                    <Icon name="trash-2" size={16} />
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="panel col-fill">
              <h2>{t(lang, activeBorrowed?.direction === 'from' ? 'borrowed.cardsTitleFrom' : 'borrowed.cardsTitle')}</h2>
              <div className="toolbar">
                <SearchInput
                  wrapClassName="grow"
                  lang={lang}
                  placeholder={t(lang, 'decks.search')}
                  value={q}
                  onChange={setQ}
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
              <div className="list">
                {!activeBorrowed && <div className="empty">{t(lang, 'borrowed.pickFirst')}</div>}
                {activeBorrowed && (() => {
                  const query = q.trim().toLowerCase()
                  const from = activeBorrowed.direction === 'from'
                  const owned = cards.filter((c) => {
                    if (!from && ownedQty(collection[c.id]) <= 0) return false
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
                        onClick={() => openCardLightbox(c)}
                      >
                        <DeckThumb cardId={c.id} src={c.image} onOpen={() => openCardLightbox(c)} openTitle={t(lang, 'card.enlarge')} zoomIcon />
                        <div className="grow">
                          <div className="name-with-ban">
                            <button
                              type="button"
                              className="name name-link"
                              title={t(lang, 'price.openCm')}
                              disabled={!priceBook?.cards[c.id]?.cmUrl}
                              onClick={(e) => { e.stopPropagation(); openCm(priceBook?.cards[c.id], lang) }}
                            >{displayCardName(c)}</button>
                            <SetBadge c={c} /><BanBadge status={banStatus(c)} lang={lang} />
                            <ErrataBadge show={!!errataFor(c)} lang={lang} />
                          </div>
                          <div className="sub">
                            {c.code} · x{have}{from ? '' : ` · ${t(lang, 'borrowed.availShort', { n: room })}`}
                            {c.energy != null ? ` · E${c.energy}` : ''}
                          </div>
                          <PriceBits entry={priceBook?.cards[c.id]} lang={lang} />
                        </div>
                        <button
                          className="btn small add"
                          disabled={!activeBorrowed || room <= 0}
                          title={room <= 0 ? t(lang, 'borrowed.noAvail') : undefined}
                          onClick={(e) => { e.stopPropagation(); bumpBorrowedCard(c.id, 1) }}
                        >
                          <Icon name="plus" />{t(lang, 'decks.add')}
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
          <div className="stores-view-switch" role="tablist">
            {(['displays', 'stores'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={storeView === v}
                className={`chip${storeView === v ? ' active' : ''}`}
                onClick={() => setStoreView(v)}
              >
                <Icon name={v === 'displays' ? 'package' : 'map-pinned'} />
                {t(lang, v === 'displays' ? 'stores.viewDisplays' : 'stores.viewStores')}
              </button>
            ))}
          </div>
        )}

        {tab === 'stores' && storeView === 'displays' && <StoreDisplays lang={lang} openLink={openLink} />}

        {tab === 'stores' && storeView === 'stores' && (
          <div className="stores-page">
            <div className="stores-search">
              <SearchInput
                className="field stores-query"
                wrapClassName="stores-query-wrap"
                lang={lang}
                value={storeQuery}
                onChange={setStoreQuery}
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
                className={`btn${storeAllGermany ? ' on' : ''}`}
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
              ><Icon name="globe" />{t(lang, 'stores.allGermany')}</button>
              <button
                type="button"
                className={`btn${storeStockOnly ? ' on' : ''}`}
                aria-pressed={storeStockOnly}
                title={t(lang, 'stores.stockOnlyHint')}
                onClick={() => setStoreStockOnly((v) => !v)}
              ><Icon name="package" />{t(lang, 'stores.stockOnly')}</button>
              <button className="btn primary" disabled={storeBusy} onClick={() => void runStoreSearch()}>
                <Icon name="search" />{storeBusy ? t(lang, 'stores.searching') : t(lang, 'stores.search')}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => openLink(STORE_LOCATOR_URL)}
              ><Icon name="external-link" />{t(lang, 'stores.openOfficial')}</button>
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
                            <a href={`mailto:${h.email}`} onClick={(e) => { e.preventDefault(); openLink(`mailto:${h.email}`) }}>{h.email}</a>
                          </div>
                        )}
                        <div className="store-actions">
                          {h.website && (
                            <button type="button" className="btn small" onClick={() => openLink(websiteUrl(h.website!))}>
                              <Icon name="external-link" />{t(lang, 'stores.website')}
                            </button>
                          )}
                          <button type="button" className="btn small" onClick={() => openLink(mapsUrl(h))}>
                            <Icon name="map-pinned" />{t(lang, 'stores.maps')}
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
                                  <Icon name={open ? 'chevron-up' : 'chevron-down'} size={13} />{open ? t(lang, 'stores.showLess') : t(lang, 'stores.showMore')}
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

        {tab === 'dopamin' && catalog && <Dopamin cards={catalog.cards} lang={lang} prices={priceBook} />}

      </main>
      </div>

      {sharePreview && (
        <div
          className="card-lightbox deck-share-lightbox"
          role="dialog"
          aria-modal="true"
          aria-labelledby="deck-share-title"
          onClick={() => setSharePreview(null)}
        >
          <div className="deck-share-inner" onClick={(e) => e.stopPropagation()}>
            <div className="deck-share-toolbar">
              <h2 id="deck-share-title">{t(lang, 'decks.sharePreview')}</h2>
              <button type="button" className="btn small" onClick={() => setSharePreview(null)}>
                <Icon name="x" />{t(lang, 'decks.shareClose')}
              </button>
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  if (!sharePreview) return
                  setDeckExportCopied(false)
                  setExportTitleKey('decks.exportTitle')
                  setDeckExportText(sharePreview.exportText)
                }}
              >
                <Icon name="download" />{t(lang, 'decks.export')}
              </button>
              <button type="button" className="btn small primary" onClick={downloadDeckShare}>
                <Icon name="share-2" />{t(lang, 'decks.share')}
              </button>
            </div>
            <div className="deck-share-img-wrap">
              <img src={sharePreview.dataUrl} alt={sharePreview.fileName} />
            </div>
          </div>
        </div>
      )}

      {cmExport && (
        <div
          className="card-lightbox"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cm-export-title"
          onClick={() => setCmExport(null)}
        >
          <div className="panel confirm-box deck-export-box" onClick={(e) => e.stopPropagation()}>
            <h2 id="cm-export-title">{cmExport.title}</h2>
            <p className="help">{cmExport.help}</p>
            <textarea className="field" readOnly rows={12} value={cmExport.text} onFocus={(e) => e.currentTarget.select()} />
            <div className="confirm-actions">
              <button type="button" className="btn small" onClick={() => setCmExport(null)}><Icon name="x" />{t(lang, 'decks.exportClose')}</button>
              {cmExport.csv != null && (
                <button type="button" className="btn small" onClick={() => download('riftbound-cardmarket.csv', '\ufeff' + cmExport.csv)}>
                  <Icon name="file-down" />{t(lang, 'cm.csv')}
                </button>
              )}
              {cmExport.wants && cmExport.wants.length > 0 && (
                <button type="button" className="btn small" onClick={() => { missingToWish(cmExport.wants!); setCmExport({ ...cmExport, wants: [] }) }}>
                  <Icon name="heart" />{t(lang, 'missing.toWish')}
                </button>
              )}
              {cmExport.wants && cmExport.wants.length === 0 && (
                <span className="sub" style={{ alignSelf: 'center' }}><Icon name="check" /> {t(lang, 'missing.added')}</span>
              )}
              <button type="button" className="btn small primary" onClick={() => void copyCmExport()}>
                <Icon name={cmCopied ? 'check' : 'copy'} />{cmCopied ? t(lang, 'decks.copied') : t(lang, 'decks.copy')}
              </button>
            </div>
          </div>
        </div>
      )}

      {deckExportText != null && (
        <div
          className="card-lightbox"
          role="dialog"
          aria-modal="true"
          aria-labelledby="deck-export-title"
          onClick={() => setDeckExportText(null)}
        >
          <div className="panel confirm-box deck-export-box" onClick={(e) => e.stopPropagation()}>
            <h2 id="deck-export-title">{t(lang, exportTitleKey)}</h2>
            <textarea className="field" readOnly rows={12} value={deckExportText} onFocus={(e) => e.currentTarget.select()} />
            <div className="confirm-actions">
              <button type="button" className="btn small" onClick={() => setDeckExportText(null)}><Icon name="x" />{t(lang, 'decks.exportClose')}</button>
              <button type="button" className="btn small primary" onClick={() => void copyDeckExport()}>
                <Icon name={deckExportCopied ? 'check' : 'copy'} />{deckExportCopied ? t(lang, 'decks.copied') : t(lang, 'decks.copy')}
              </button>
            </div>
          </div>
        </div>
      )}
      {deckConfirm && (
        <div
          className="card-lightbox"
          role="dialog"
          aria-modal="true"
          aria-labelledby="deck-del-title"
          onClick={() => setDeckConfirm(null)}
        >
          <div className="panel confirm-box" onClick={(e) => e.stopPropagation()}>
            <p id="deck-del-title" className="help" style={{ margin: 0 }}>
              {deckConfirm.kind === 'all'
                ? t(lang, 'decks.deleteAllConfirm')
                : deckConfirm.kind === 'borrowAll'
                  ? t(lang, 'borrowed.deleteAllConfirm')
                  : deckConfirm.kind === 'borrow'
                    ? t(lang, 'borrowed.deleteConfirm', { name: deckConfirm.name })
                    : deckConfirm.kind === 'wish'
                    ? t(lang, 'wish.deleteConfirm', { name: deckConfirm.name })
                    : t(lang, 'decks.deleteOneConfirm', { name: deckConfirm.name })}
            </p>
            <div className="confirm-actions">
              <button type="button" className="btn small" onClick={() => setDeckConfirm(null)}><Icon name="x" />{t(lang, 'decks.clearCancel')}</button>
              <button type="button" className="btn small deck-trash" onClick={applyDeckConfirm}><Icon name="trash-2" />{t(lang, 'decks.clearConfirm')}</button>
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
            <p id="clear-sec-title" className="help" style={{ margin: 0 }}>{t(lang, 'decks.clearSectionConfirm', { section: SECTION_LABEL[clearSec] })}</p>
            <div className="confirm-actions">
              <button type="button" className="btn small" onClick={() => setClearSec(null)}><Icon name="x" />{t(lang, 'decks.clearCancel')}</button>
              <button
                type="button"
                className="btn small deck-trash"
                onClick={() => {
                  const sec = clearSec
                  setClearSec(null)
                  clearDeckSection(sec)
                }}
              ><Icon name="trash-2" />{t(lang, 'decks.clearConfirm')}</button>
            </div>
          </div>
        </div>
      )}
      {removing && (
        <div className="remove-hint" role="status"><Icon name="minus" size={14} />{t(lang, 'drag.removeHint')}</div>
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
          {(lbNav.prev || lbNav.next) && (['prev', 'next'] as const).map((dir) => (
            <button
              key={dir}
              type="button"
              className={`card-lightbox-nav ${dir}`}
              disabled={!lbNav[dir]}
              title={t(lang, `card.${dir}`)}
              aria-label={t(lang, `card.${dir}`)}
              onClick={(e) => {
                e.stopPropagation()
                const to = lbNav[dir]
                if (to) openCardLightbox(to)
              }}
            ><Icon name={dir === 'prev' ? 'chevron-left' : 'chevron-right'} size={22} /></button>
          ))}
          <div className="card-lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="card-lightbox-close"
              onClick={closeCardLightbox}
              title={t(lang, 'card.enlargeClose')}
              aria-label={t(lang, 'card.enlargeClose')}
            ><Icon name="x" size={18} /></button>
            <div className="card-lightbox-left">
            <div
              className={`card-lightbox-art${artReady ? '' : ' loading'}${lbThumb ? ' has-thumb' : ''}`}
              style={!artReady && lbThumb ? { backgroundImage: `url("${lbThumb}")` } : undefined}
            >
              {cardLightbox.image ? (
                <img
                  key={cardLightbox.id}
                  src={cardArt(cardLightbox.image)}
                  alt={displayName(cardLightbox)}
                  className={bfTurn ? 'bf-on' : undefined}
                  onError={(e) => {
                    // Offline and not cached yet: the bundled thumbnail is better than nothing.
                    if (lbThumb && e.currentTarget.src !== lbThumb) e.currentTarget.src = lbThumb
                    else setArtReady(true)
                  }}
                  onLoad={(e) => {
                    setArtReady(true)
                    const im = e.currentTarget
                    const types = cardLightbox.types || []
                    const supers = cardLightbox.superTypes || []
                    const bf = types.includes('Battlefield') || supers.includes('Battlefield')
                    setBfTurn(bf && im.naturalHeight > im.naturalWidth)
                  }}
                />
              ) : (
                <div className="card-lightbox-noart">{t(lang, 'card.noArt')}</div>
              )}
            </div>
            {(() => {
              const e = errataFor(cardLightbox)
              if (!e) return null
              return (
                <div className="card-errata">
                  <div className="card-errata-head">
                    <strong>{t(lang, 'card.errata')}</strong>
                    <button type="button" className="card-errata-src" onClick={() => openLink(e.source)}>
                      {t(lang, 'card.errataSource')}<Icon name="external-link" size={12} />
                    </button>
                  </div>
                  <p className="card-errata-text"><RulesText text={e.newText} /></p>
                  <details className="card-errata-old">
                    <summary>{t(lang, 'card.errataPrinted')}</summary>
                    <p className="card-errata-text"><RulesText text={e.oldText} /></p>
                  </details>
                </div>
              )
            })()}
            </div>
            <div className="card-lightbox-meta">
              <div className="name-with-ban">
                {priceBook?.cards[cardLightbox.id]?.cmUrl ? (
                  <button
                    type="button"
                    className="card-lightbox-title card-lightbox-title-link"
                    onClick={() => openCm(priceBook?.cards[cardLightbox.id], lang)}
                    title={t(lang, 'card.ocrOpenCm')}
                  >{displayName(cardLightbox)}</button>
                ) : (
                  <h2 className="card-lightbox-title">{displayName(cardLightbox)}</h2>
                )}
                <SetBadge c={cardLightbox} />
                <BanBadge status={banStatus(cardLightbox)} lang={lang} />
                <ErrataBadge show={!!errataFor(cardLightbox)} lang={lang} />
              </div>
              <p className="sub">{cardLightbox.code} · {cardLightbox.setName || cardLightbox.set}</p>
              <div className="card-facts">
                {cardLightbox.energy != null && (
                  <span className="card-fact" title={t(lang, 'card.energy')}><RulesText text={`[${cardLightbox.energy}]`} /></span>
                )}
                {cardLightbox.might != null && (
                  <span className="card-fact" title={t(lang, 'card.might')}><RulesText text={`[S] ${cardLightbox.might}`} /></span>
                )}
                {(cardLightbox.domains || []).map((d) => (
                  <span key={d} className="card-fact" title={t(lang, 'card.domains')}>
                    {RUNE_ICON[d === 'Chaos' ? 'C' : d] && <RulesText text={`[${d === 'Chaos' ? 'C' : d}]`} />}{d}
                  </span>
                ))}
                {[...(cardLightbox.types || []), cardLightbox.rarity].filter(Boolean).map((x) => (
                  <span key={x} className="card-fact">{x}</span>
                ))}
              </div>
              {(() => {
                const pl = priceLabel(lang, priceBook?.cards[cardLightbox.id])
                const foilOnly = isFoilOnly(cardLightbox)
                const tiles = [
                  !foilOnly && pl?.low && { k: 'card.priceLow', v: pl.low },
                  !foilOnly && pl?.avg30 && { k: 'card.priceAvg', v: pl.avg30 },
                  pl?.foil && { k: 'card.priceFoil', v: pl.foil },
                ].filter(Boolean) as { k: string; v: string }[]
                if (!tiles.length) return <p className="card-ocr-status muted">{t(lang, 'card.noPrice')}</p>
                return (
                  <div className="card-price-tiles">
                    {tiles.map((x) => (
                      <div key={x.k} className="deck-stat"><span>{t(lang, x.k)}</span><b>{x.v}</b></div>
                    ))}
                  </div>
                )
              })()}
              <button type="button" className={`chip ${wish[cardLightbox.id] ? 'active' : ''}`} onClick={() => bumpWish(cardLightbox.id, 'qty', 1)}>
                <Icon name="heart" />{t(lang, 'wish.add')}{wish[cardLightbox.id] ? ` (${wish[cardLightbox.id].qty + wish[cardLightbox.id].foil})` : ''}
              </button>
              {wish[cardLightbox.id] && (
                <div className={`wish-alert${wishHits.has(cardLightbox.id) ? ' hit' : ''}`}>
                  <span className="wish-alert-label"><Icon name="bell" size={13} />{t(lang, 'alert.below')}</span>
                  <MoneyInput lang={lang} value={wishTargets[cardLightbox.id] ?? null} label={t(lang, 'alert.target')} placeholder={t(lang, 'alert.targetPh')} onChange={(v) => setWishTarget(cardLightbox.id, v)} />
                  {wishHits.has(cardLightbox.id) && <span className="wish-alert-hit">{t(lang, 'alert.hit', { eur: fmtEur(lang, wishHits.get(cardLightbox.id)) ?? '' })}</span>}
                </div>
              )}
              <CopyEditor
                lang={lang}
                owned={collection[cardLightbox.id]}
                lots={copies[cardLightbox.id] || []}
                foilOnly={isFoilOnly(cardLightbox)}
                price={priceBook?.cards[cardLightbox.id]}
                onChange={(lots) => setCardLots(cardLightbox.id, lots)}
              />
              {(() => {
                // Errata text first: it is the wording the keywords are judged by.
                const text = errataFor(cardLightbox)?.newText || cardLightbox.rulesText || ''
                const kws = [...new Set([...detectKeywordsInText(text), ...keywordsForCard(cardLightbox)])]
                if (!kws.length) return null
                return (
                  <div className="card-keywords">
                    <div className="card-keywords-head">
                      <strong>{t(lang, 'card.keywords')}</strong>
                    </div>
                    <ul className="card-keywords-list">
                      {kws.map((id) => (
                        <li key={id} className="card-keyword on-card">
                          <span className="card-keyword-name">{t(lang, `kw.${id}.name`)}</span>
                          <p className="card-keyword-blurb"><RulesText text={t(lang, `kw.${id}.blurb`)} /></p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })()}
              {priceBook?.cards[cardLightbox.id]?.cmUrl && (
                <button
                  type="button"
                  className="btn"
                  style={{ marginTop: 10 }}
                  onClick={() => openCm(priceBook?.cards[cardLightbox.id], lang)}
                ><Icon name="external-link" />{t(lang, 'price.openCm')}</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
