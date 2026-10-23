/** Booster display prices for the Store tab.
 *  public/sealed.json (scripts/bake_sealed.py, daily on main) holds the Cardmarket
 *  price guide rows for sealed products, the German shops that answer an open product
 *  search, and their display offers. The app asks those shops again live and,
 *  with the user's own token, CardTrader's marketplace API. */

export type SealedCmProduct = {
  id: number
  name: string
  set: string | null
  category: string | null
  display: boolean
  lang: string
  low: number | null
  avg30: number | null
  trend: number | null
}

export type SealedShop = {
  name: string
  url: string
  city: string | null
  platform: 'shopify' | 'woo'
}

/** A shop offer as baked. `shop` is the shop's origin (SealedShop.url). */
export type BakedOffer = {
  shop: string
  title: string
  price: number
  available: boolean | null
  url: string
  set: string
  lang: string | null
  preorder: boolean
}

export type SealedFile = {
  updatedAt: string
  currency: string
  sets: Record<string, string>
  cardmarket: { guideCreatedAt: string | null; products: SealedCmProduct[] }
  shops: SealedShop[]
  offers: BakedOffer[]
}

export type DisplayOffer = {
  source: 'shop' | 'cardtrader'
  seller: string
  /** City of a shop, country code of a CardTrader seller. */
  where: string | null
  title: string
  price: number
  available: boolean | null
  url: string
  set: string
  lang: string | null
  preorder: boolean
  /** CardTrader only: copies on offer and CardTrader Zero (shipping via the hub). */
  qty?: number
  zero?: boolean
}

/** A Riftbound display holds 24 boosters (Chinese Slim / Jumbo ones differ). */
export const BOOSTERS_PER_DISPLAY = 24

const REMOTE_SEALED_URL = 'https://raw.githubusercontent.com/Goodplayer01/riftbound-tracker/main/public/sealed.json'
const REMOTE_TIMEOUT_MS = 15000
const TARGETS_KEY = 'rb.displayTargets.v1'
const CT_TOKEN_KEY = 'rb.cardtrader.token.v1'
const CT_BLUEPRINTS_KEY = 'rb.cardtrader.blueprints.v1'
const CT_BLUEPRINTS_TTL_MS = 3 * 24 * 3600 * 1000

// Same rules as scripts/bake_sealed.py, keep both in sync.
const DISPLAY_RE = /display|booster\s*-?\s*box/i
const NOT_DISPLAY_RE = /sleeve|playmat|binder|album|deck|h[üu]lle|case\b|acryl|bundle|einzel|single|leer|empty|protector|storage/i
const PREORDER_RE = /vorbestell|vorverkauf|pre-?order|preorder|pre-?sale/i
const LANG_PATTERNS: [string, RegExp][] = [
  ['ZH', /\b(zh|cn|chn|s-ch|chinese|chinesisch\w*)\b|slim|jumbo/i],
  ['KO', /\b(ko|kor|korean|koreanisch\w*)\b/i],
  ['JA', /\b(ja|jp|jap|japanese|japanisch\w*)\b/i],
  ['FR', /\b(fr|french|franz[öo]sisch\w*|fran[çc]ais)\b/i],
  ['DE', /\b(de|deutsch\w*|german)\b/i],
  ['EN', /\b(en|eng|english|englisch\w*)\b/i],
]

export function isDisplayTitle(title: string) {
  return DISPLAY_RE.test(title) && !NOT_DISPLAY_RE.test(title)
}

/** Print language from a title. Chinese first: "Slim" / "Jumbo" displays are Chinese only. */
export function langFromTitle(title: string): string | null {
  for (const [code, re] of LANG_PATTERNS) if (re.test(title)) return code
  return null
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function setFromTitle(title: string, sets: Record<string, string>): string | null {
  const hits = Object.entries(sets).filter(([, name]) => new RegExp(`\\b${escapeRe(name)}\\b`, 'i').test(title))
  return hits.length === 1 ? hits[0][0] : null
}

function isSealed(x: unknown): x is SealedFile {
  const s = x as SealedFile
  return !!s && !!s.sets && Array.isArray(s.shops) && Array.isArray(s.offers) && Array.isArray(s.cardmarket?.products)
}

async function getSealed(url: string | URL, init?: RequestInit) {
  const r = await fetch(url, init)
  if (!r.ok) return null
  const data = await r.json()
  return isSealed(data) ? data : null
}

/** Live copy from main, the bundled file when offline. */
export async function loadSealed(): Promise<SealedFile | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REMOTE_TIMEOUT_MS)
  try {
    const remote = await getSealed(REMOTE_SEALED_URL, { cache: 'no-cache', signal: ctrl.signal })
    if (remote) return remote
  } catch {
    // offline: fall through to the bundled copy
  } finally {
    clearTimeout(timer)
  }
  try {
    return await getSealed(new URL('sealed.json', window.location.href))
  } catch {
    return null
  }
}

function bakedOffer(o: BakedOffer, shop: SealedShop | undefined): DisplayOffer {
  return {
    source: 'shop',
    seller: shop?.name ?? o.shop.replace(/^https:\/\/(www\.)?/, ''),
    where: shop?.city ?? null,
    title: o.title,
    price: o.price,
    available: o.available,
    url: o.url,
    set: o.set,
    lang: o.lang,
    preorder: !!o.preorder,
  }
}

export function bakedOffers(file: SealedFile): DisplayOffer[] {
  const shops = new Map(file.shops.map((s) => [s.url, s]))
  return file.offers.map((o) => bakedOffer(o, shops.get(o.shop)))
}

/** The Cardmarket rows that are the price reference for an offer: same set and print language. */
export function cmReference(file: SealedFile, set: string, lang: string | null, title = ''): SealedCmProduct | null {
  const rows = file.cardmarket.products.filter((p) => p.display && p.set === set && p.lang === (lang ?? 'EN'))
  if (rows.length <= 1) return rows[0] ?? null
  const kind = /slim/i.test(title) ? /slim/i : /jumbo/i.test(title) ? /jumbo/i : null
  return kind ? rows.find((p) => kind.test(p.name)) ?? null : null
}

/** Cardmarket search for a sealed product, German sellers, in the app language. */
export function cmSealedLink(p: SealedCmProduct, uiLang: 'de' | 'en') {
  const q = new URLSearchParams({ searchString: p.name, sellerCountry: '7' })
  return `https://www.cardmarket.com/${uiLang}/Riftbound/Products/Search?${q}`
}

// ---------------------------------------------------------------- live shop search

async function fetchViaMain(url: string): Promise<unknown> {
  if (window.riftbound?.fetchJson) {
    const res = await window.riftbound.fetchJson(url)
    if (!res.ok) throw new Error(res.error || 'fetch failed')
    return res.data
  }
  const r = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

function eur(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

type RawOffer = { title: string; price: number | null; available: boolean | null; url: string }

async function shopifyDisplayVariant(o: RawOffer): Promise<RawOffer | null> {
  const base = o.url.split('?')[0]
  let data: { variants?: { id?: number; title?: string; price?: number; available?: unknown }[] }
  try {
    data = (await fetchViaMain(`${base}.js`)) as typeof data
  } catch {
    return null
  }
  const variants = (data?.variants ?? []).filter((v) => isDisplayTitle(v.title ?? ''))
  if (variants.length !== 1) return null
  const v = variants[0]
  return {
    ...o,
    price: eur((v.price ?? 0) / 100),
    available: typeof v.available === 'boolean' ? v.available : null,
    url: `${base}?variant=${v.id}`,
  }
}

async function shopifyOffers(origin: string): Promise<RawOffer[]> {
  const q = new URLSearchParams({
    q: 'riftbound display',
    'resources[type]': 'product',
    'resources[limit]': '10',
    'resources[options][unavailable_products]': 'last',
  })
  const data = (await fetchViaMain(`${origin}/search/suggest.json?${q}`)) as {
    resources?: { results?: { products?: Record<string, unknown>[] } }
  }
  const out: RawOffer[] = []
  for (const p of data?.resources?.results?.products ?? []) {
    const rawUrl = typeof p.url === 'string' ? p.url : ''
    let o: RawOffer | null = {
      title: String(p.title ?? '').trim(),
      price: eur(p.price),
      available: typeof p.available === 'boolean' ? p.available : null,
      url: rawUrl.startsWith('http') ? rawUrl : origin + rawUrl.split('?')[0],
    }
    if (!isDisplayTitle(o.title)) continue
    // "Display & Booster" products: the suggest price is the cheapest variant (a single booster).
    if (eur(p.price_max) !== eur(p.price_min)) o = await shopifyDisplayVariant(o)
    if (o) out.push(o)
  }
  return out
}

async function wooOffers(origin: string): Promise<RawOffer[]> {
  const q = new URLSearchParams({ search: 'riftbound display', per_page: '20' })
  const data = await fetchViaMain(`${origin}/wp-json/wc/store/v1/products?${q}`)
  if (!Array.isArray(data)) return []
  return data.map((p: Record<string, unknown>) => {
    const prices = (p.prices ?? {}) as { price?: string; currency_code?: string; currency_minor_unit?: number }
    const minor = Number(prices.currency_minor_unit ?? 2)
    const price = prices.price && /^\d+$/.test(prices.price) && (prices.currency_code ?? 'EUR') === 'EUR'
      ? eur(Number(prices.price) / 10 ** minor)
      : null
    return {
      title: String(p.name ?? '').replace(/<[^>]+>/g, '').trim(),
      price,
      available: typeof p.is_in_stock === 'boolean' ? p.is_in_stock : null,
      url: typeof p.permalink === 'string' ? p.permalink : origin,
    }
  })
}

/** Ask every known shop again. Shops that fail keep their baked offers. */
export async function liveShopOffers(
  file: SealedFile,
  onProgress?: (done: number, total: number) => void,
): Promise<{ offers: DisplayOffer[]; answered: number }> {
  const shops = file.shops
  const shopOf = new Map(shops.map((s) => [s.url, s]))
  const byShop = new Map<string, DisplayOffer[]>()
  for (const o of file.offers) byShop.set(o.shop, [...(byShop.get(o.shop) ?? []), bakedOffer(o, shopOf.get(o.shop))])
  let answered = 0
  let done = 0
  let cursor = 0
  const workers = Array.from({ length: Math.min(8, shops.length) }, async () => {
    while (cursor < shops.length) {
      const shop = shops[cursor++]
      try {
        const raw = shop.platform === 'woo' ? await wooOffers(shop.url) : await shopifyOffers(shop.url)
        const offers: DisplayOffer[] = []
        for (const o of raw) {
          if (!o.price || !/riftbound|league of legends/i.test(o.title) || !isDisplayTitle(o.title)) continue
          const set = setFromTitle(o.title, file.sets)
          if (!set) continue
          offers.push({
            source: 'shop',
            seller: shop.name,
            where: shop.city,
            title: o.title,
            price: o.price,
            available: o.available,
            url: o.url,
            set,
            lang: langFromTitle(o.title),
            preorder: PREORDER_RE.test(o.title),
          })
        }
        byShop.set(shop.url, offers)
        answered++
      } catch {
        // keep the baked offers of this shop
      }
      onProgress?.(++done, shops.length)
    }
  })
  await Promise.all(workers)
  return { offers: [...byShop.values()].flat(), answered }
}

// ---------------------------------------------------------------- CardTrader

export function loadCtToken() {
  try {
    return localStorage.getItem(CT_TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveCtToken(token: string) {
  try {
    if (token) localStorage.setItem(CT_TOKEN_KEY, token)
    else localStorage.removeItem(CT_TOKEN_KEY)
    localStorage.removeItem(CT_BLUEPRINTS_KEY)
  } catch {
    // ignore
  }
}

export class CardTraderError extends Error {
  readonly unauthorized: boolean
  constructor(message: string, unauthorized = false) {
    super(message)
    this.unauthorized = unauthorized
  }
}

async function ct<T>(path: string, token: string): Promise<T> {
  if (!window.riftbound?.cardtrader) throw new CardTraderError('CardTrader only works in the desktop app')
  const res = await window.riftbound.cardtrader(path, token)
  if (!res.ok) throw new CardTraderError(res.error || 'CardTrader failed', res.status === 401 || res.status === 403)
  return res.data as T
}

/** Some CardTrader list endpoints answer with a bare array, some with { array }. */
function list<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[]
  const arr = (data as { array?: unknown })?.array
  return Array.isArray(arr) ? (arr as T[]) : []
}

type CtBlueprint = { id: number; name: string; set: string; lang: string | null }

async function ctBlueprints(token: string, sets: Record<string, string>): Promise<CtBlueprint[]> {
  try {
    const cached = JSON.parse(localStorage.getItem(CT_BLUEPRINTS_KEY) || 'null') as { at: number; items: CtBlueprint[] } | null
    if (cached && Date.now() - cached.at < CT_BLUEPRINTS_TTL_MS && Array.isArray(cached.items)) return cached.items
  } catch {
    // rebuild
  }
  const games = list<{ id: number; name?: string; display_name?: string }>(await ct('/games', token))
  const game = games.find((g) => /riftbound/i.test(`${g.name ?? ''} ${g.display_name ?? ''}`))
  if (!game) throw new CardTraderError('Riftbound not found on CardTrader')
  const cats = list<{ id: number; name?: string; game_id?: number }>(await ct(`/categories?game_id=${game.id}`, token))
  const boxCats = new Set(cats.filter((c) => c.game_id === game.id && isDisplayTitle(c.name ?? '')).map((c) => c.id))
  const exps = list<{ id: number; game_id?: number; name?: string }>(await ct('/expansions', token)).filter((e) => e.game_id === game.id)
  const items: CtBlueprint[] = []
  for (const e of exps) {
    const bps = list<{ id: number; name?: string; category_id?: number }>(await ct(`/blueprints/export?expansion_id=${e.id}`, token))
    for (const b of bps) {
      const name = b.name ?? ''
      // Booster box category, or a display title in an odd category; never cases, decks, sleeves.
      if (NOT_DISPLAY_RE.test(name) || !(boxCats.has(b.category_id ?? -1) || isDisplayTitle(name))) continue
      const set = setFromTitle(name, sets) ?? setFromTitle(e.name ?? '', sets)
      if (!set) continue
      items.push({ id: b.id, name, set, lang: langFromTitle(name) })
    }
  }
  try {
    localStorage.setItem(CT_BLUEPRINTS_KEY, JSON.stringify({ at: Date.now(), items }))
  } catch {
    // no cache, fine
  }
  return items
}

type CtProduct = {
  blueprint_id?: number
  name_en?: string
  quantity?: number
  on_vacation?: boolean
  price?: { cents?: number; currency?: string }
  properties_hash?: Record<string, unknown>
  user?: { username?: string; country_code?: string; can_sell_via_hub?: boolean }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Cheapest CardTrader listings per display (the API returns up to 25 per blueprint). */
export async function cardTraderOffers(
  token: string,
  sets: Record<string, string>,
  onProgress?: (done: number, total: number) => void,
): Promise<DisplayOffer[]> {
  const bps = await ctBlueprints(token, sets)
  const out: DisplayOffer[] = []
  for (let i = 0; i < bps.length; i++) {
    const bp = bps[i]
    // The marketplace endpoint allows about one call per second.
    if (i > 0) await sleep(1050)
    const data = await ct<Record<string, CtProduct[]>>(`/marketplace/products?blueprint_id=${bp.id}`, token)
    const products = (data?.[String(bp.id)] ?? []).filter(
      (p) => !p.on_vacation && p.price?.currency === 'EUR' && (p.price?.cents ?? 0) > 0,
    )
    products.sort((a, b) => (a.price!.cents ?? 0) - (b.price!.cents ?? 0))
    for (const p of products.slice(0, 8)) {
      const langProp = Object.entries(p.properties_hash ?? {}).find(([k]) => /language$/.test(k))?.[1]
      const lang = typeof langProp === 'string' && langProp ? langProp.toUpperCase().slice(0, 2) : bp.lang
      out.push({
        source: 'cardtrader',
        seller: p.user?.username ?? 'CardTrader',
        where: p.user?.country_code?.toUpperCase() ?? null,
        title: p.name_en || bp.name,
        price: Math.round(p.price!.cents!) / 100,
        available: true,
        url: `https://www.cardtrader.com/cards/${bp.id}`,
        set: bp.set,
        lang: lang ?? 'EN',
        preorder: false,
        qty: p.quantity,
        zero: !!p.user?.can_sell_via_hub,
      })
    }
    onProgress?.(i + 1, bps.length)
  }
  return out
}

// ---------------------------------------------------------------- price targets

export function loadTargets(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(TARGETS_KEY) || '{}') as Record<string, unknown>
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && v > 0) out[k] = v
    return out
  } catch {
    return {}
  }
}

export function saveTargets(t: Record<string, number>) {
  try {
    localStorage.setItem(TARGETS_KEY, JSON.stringify(t))
  } catch {
    // ignore
  }
}
