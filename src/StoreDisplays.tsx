import { useEffect, useMemo, useState } from 'react'
import { Icon } from './Icon'
import { fmtEur, t, type Lang } from './i18n'
import {
  BOOSTERS_PER_DISPLAY,
  CardTraderError,
  bakedOffers,
  cardTraderOffers,
  cmReference,
  cmSealedLink,
  liveShopOffers,
  loadCtToken,
  loadSealed,
  loadTargets,
  saveCtToken,
  saveTargets,
  type DisplayOffer,
  type SealedFile,
} from './displays'

const DISPLAY_IMG: Record<string, string> = {
  OGN: 'displays/ogn.jpg',
  SFD: 'displays/sfd.jpg',
  UNL: 'displays/unl.jpg',
  VEN: 'displays/ven.jpg',
  RAD: 'packs/rad.jpg',
}
const LANGS = ['EN', 'ZH', 'FR', 'KO', 'ALL'] as const
type LangFilter = (typeof LANGS)[number]
const ROWS_PREVIEW = 5

// Live results survive tab switches: shops and CardTrader are asked once per app start.
let liveCache: { offers: DisplayOffer[]; at: Date | null; answered: number } | null = null
let ctCache: { offers: DisplayOffer[]; at: Date; token: string } | null = null

/** Max price per set and print language; English keeps the plain set code. */
function targetKey(set: string, lang: string | null) {
  return !lang || lang === 'EN' ? set : `${set}:${lang}`
}

function publicAsset(rel: string) {
  return new URL(rel, window.location.href).href
}

function fmtTime(lang: Lang, d: Date) {
  return d.toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })
}

export function StoreDisplays({ lang, openLink }: { lang: Lang; openLink: (url: string) => void }) {
  const [file, setFile] = useState<SealedFile | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [shopOffers, setShopOffers] = useState<DisplayOffer[]>(liveCache?.offers ?? [])
  const [liveAt, setLiveAt] = useState<Date | null>(liveCache?.at ?? null)
  const [liveProgress, setLiveProgress] = useState<{ done: number; total: number } | null>(null)
  const [ctToken, setCtToken] = useState(loadCtToken)
  const [ctDraft, setCtDraft] = useState('')
  const [ctOpen, setCtOpen] = useState(false)
  const [ctOffers, setCtOffers] = useState<DisplayOffer[]>(ctCache && ctCache.token === loadCtToken() ? ctCache.offers : [])
  const [ctAt, setCtAt] = useState<Date | null>(ctCache && ctCache.token === loadCtToken() ? ctCache.at : null)
  const [ctProgress, setCtProgress] = useState<{ done: number; total: number } | null>(null)
  const [ctError, setCtError] = useState<string | null>(null)
  const [langFilter, setLangFilter] = useState<LangFilter>('EN')
  const [stockOnly, setStockOnly] = useState(false)
  const [targets, setTargets] = useState<Record<string, number>>(loadTargets)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let alive = true
    void loadSealed().then((f) => {
      if (!alive) return
      if (!f) {
        setLoadFailed(true)
        return
      }
      setFile(f)
      if (!liveCache) {
        setShopOffers(bakedOffers(f))
        void refreshShops(f)
      }
      const token = loadCtToken()
      if (token && (!ctCache || ctCache.token !== token)) void refreshCardTrader(f, token)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function refreshShops(f = file) {
    if (!f || liveProgress) return
    setLiveProgress({ done: 0, total: f.shops.length })
    try {
      const res = await liveShopOffers(f, (done, total) => setLiveProgress({ done, total }))
      // Offline or every shop failed: keep showing the baked time, not a fake live one.
      liveCache = { offers: res.offers, at: res.answered ? new Date() : null, answered: res.answered }
      setShopOffers(res.offers)
      setLiveAt(liveCache.at)
    } finally {
      setLiveProgress(null)
    }
  }

  async function refreshCardTrader(f = file, token = ctToken) {
    if (!f || !token || ctProgress) return
    setCtError(null)
    setCtProgress({ done: 0, total: 0 })
    try {
      const offers = await cardTraderOffers(token, f.sets, (done, total) => setCtProgress({ done, total }))
      ctCache = { offers, at: new Date(), token }
      setCtOffers(offers)
      setCtAt(ctCache.at)
    } catch (e) {
      setCtError(
        e instanceof CardTraderError && e.unauthorized
          ? t(lang, 'disp.ctBadToken')
          : t(lang, 'disp.ctError', { message: e instanceof Error ? e.message : String(e) }),
      )
    } finally {
      setCtProgress(null)
    }
  }

  function saveToken() {
    const token = ctDraft.trim()
    saveCtToken(token)
    setCtToken(token)
    setCtDraft('')
    setCtOpen(false)
    setCtOffers([])
    setCtAt(null)
    ctCache = null
    if (token) void refreshCardTrader(file, token)
  }

  function setTarget(key: string, raw: string) {
    const n = Number(raw.replace(',', '.'))
    const next = { ...targets }
    if (raw.trim() && Number.isFinite(n) && n > 0) next[key] = Math.round(n * 100) / 100
    else delete next[key]
    setTargets(next)
    saveTargets(next)
  }

  const sets = useMemo(() => (file ? Object.keys(file.sets).reverse() : []), [file])

  const bySet = useMemo(() => {
    const out: Record<string, DisplayOffer[]> = {}
    for (const o of [...shopOffers, ...ctOffers]) {
      // Shops rarely name English, so an offer without a language counts as English.
      const l = o.lang ?? 'EN'
      if (langFilter !== 'ALL' && l !== langFilter) continue
      if (stockOnly && o.available === false) continue
      ;(out[o.set] ??= []).push(o)
    }
    for (const list of Object.values(out)) {
      list.sort((a, b) => Number(a.available === false) - Number(b.available === false) || a.price - b.price)
    }
    return out
  }, [shopOffers, ctOffers, langFilter, stockOnly])

  if (loadFailed) return <div className="empty">{t(lang, 'disp.loadFail')}</div>
  if (!file) return <div className="empty">{t(lang, 'disp.loading')}</div>

  const refLang = langFilter === 'ALL' ? 'EN' : langFilter

  return (
    <div className="disp-page">
      <div className="stores-search disp-toolbar">
        <div className="disp-chips" role="group" aria-label={t(lang, 'disp.language')}>
          {LANGS.map((l) => (
            <button
              key={l}
              type="button"
              className={`chip${langFilter === l ? ' active' : ''}`}
              aria-pressed={langFilter === l}
              onClick={() => setLangFilter(l)}
            >{t(lang, `disp.lang.${l}`)}</button>
          ))}
        </div>
        <button
          type="button"
          className={`btn${stockOnly ? ' on' : ''}`}
          aria-pressed={stockOnly}
          onClick={() => setStockOnly((v) => !v)}
        ><Icon name="package" />{t(lang, 'disp.stockOnly')}</button>
        <span className="disp-spacer" />
        <button type="button" className="btn" disabled={!!liveProgress} onClick={() => void refreshShops()}>
          <Icon name="refresh-cw" />
          {liveProgress
            ? t(lang, 'disp.asking', { done: liveProgress.done, total: liveProgress.total })
            : t(lang, 'disp.refresh')}
        </button>
        <button
          type="button"
          className={`btn${ctToken ? ' on' : ''}`}
          onClick={() => setCtOpen((v) => !v)}
          title={t(lang, 'disp.ctHint')}
        ><Icon name="shopping-cart" />CardTrader</button>
      </div>

      {ctOpen && (
        <div className="panel disp-ct">
          <p className="help">{t(lang, 'disp.ctHelp')}</p>
          <div className="disp-ct-row">
            <input
              type="password"
              className="field"
              value={ctDraft}
              placeholder={ctToken ? t(lang, 'disp.ctTokenSet') : t(lang, 'disp.ctTokenPh')}
              onChange={(e) => setCtDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveToken() }}
              aria-label={t(lang, 'disp.ctToken')}
            />
            <button type="button" className="btn primary" disabled={!ctDraft.trim()} onClick={saveToken}>
              <Icon name="check" />{t(lang, 'disp.ctSave')}
            </button>
            {ctToken && (
              <button type="button" className="btn" disabled={!!ctProgress} onClick={() => void refreshCardTrader()}>
                <Icon name="refresh-cw" />{t(lang, 'disp.ctRefresh')}
              </button>
            )}
            {ctToken && (
              <button type="button" className="btn ghost" onClick={() => { setCtDraft(''); saveCtToken(''); setCtToken(''); setCtOffers([]); setCtAt(null); ctCache = null }}>
                <Icon name="x" />{t(lang, 'disp.ctRemove')}
              </button>
            )}
            <button type="button" className="btn ghost" onClick={() => openLink('https://www.cardtrader.com/en/docs/api/full')}>
              <Icon name="external-link" />{t(lang, 'disp.ctDocs')}
            </button>
          </div>
        </div>
      )}

      <p className="help stores-help">
        {t(lang, 'disp.help')}
        {' · '}
        {liveAt
          ? t(lang, 'disp.liveAt', { time: fmtTime(lang, liveAt), n: file.shops.length })
          : t(lang, 'disp.bakedAt', { time: fmtTime(lang, new Date(file.updatedAt)), n: file.shops.length })}
        {ctProgress && ` · ${t(lang, 'disp.ctAsking', { done: ctProgress.done, total: ctProgress.total || '…' })}`}
        {!ctProgress && ctAt && ` · ${t(lang, 'disp.ctAt', { time: fmtTime(lang, ctAt) })}`}
      </p>
      {ctError && <p className="help" style={{ color: 'var(--danger)' }}>{ctError}</p>}

      <div className="disp-sets">
        {sets.map((code) => {
          const offers = bySet[code] ?? []
          const ref = cmReference(file, code, refLang)
          const refAll = file.cardmarket.products.filter((p) => p.display && p.set === code && p.lang === refLang)
          if (!offers.length && !refAll.length) return null
          const key = targetKey(code, refLang)
          const target = targets[key]
          const inBudget = (o: DisplayOffer) => {
            const max = targets[targetKey(code, o.lang ?? 'EN')]
            return max != null && o.available !== false && o.price <= max
          }
          const best = offers.find((o) => o.available !== false)
          const underTarget = offers.filter(inBudget).length
          const isOpen = !!open[code]
          const shown = isOpen ? offers : offers.slice(0, ROWS_PREVIEW)
          const img = DISPLAY_IMG[code]
          return (
            <section key={code} className="panel disp-set">
              <header className="disp-head">
                {img ? <img className="disp-img" src={publicAsset(img)} alt="" loading="lazy" /> : <div className="disp-img disp-img-none"><Icon name="package" size={28} /></div>}
                <div className="disp-head-main">
                  <h2>{file.sets[code]}</h2>
                  <div className="disp-ref">
                    {refAll.length === 0 && <span className="sub">{t(lang, 'disp.noCm')}</span>}
                    {refAll.map((p) => (
                      <button key={p.id} type="button" className="disp-ref-item" onClick={() => openLink(cmSealedLink(p, lang))} title={p.name}>
                        <span className="disp-ref-label">Cardmarket{refAll.length > 1 ? ` · ${/slim/i.test(p.name) ? 'Slim' : /jumbo/i.test(p.name) ? 'Jumbo' : p.name}` : ''}</span>
                        <span className="disp-ref-val">{t(lang, 'disp.trend')} <b>{fmtEur(lang, p.trend) ?? '–'}</b></span>
                        {p.low != null && <span className="disp-ref-val">{t(lang, 'disp.from')} {fmtEur(lang, p.low)}</span>}
                        {refLang === 'EN' && p.trend != null && (
                          <span className="disp-ref-val sub">{t(lang, 'disp.perBooster', { price: fmtEur(lang, p.trend / BOOSTERS_PER_DISPLAY) ?? '' })}</span>
                        )}
                        <Icon name="external-link" size={12} />
                      </button>
                    ))}
                  </div>
                  {best && (
                    <div className="disp-best">
                      {t(lang, 'disp.best')} <b>{fmtEur(lang, best.price)}</b> · {best.seller}
                      {ref?.trend != null && best.price < ref.trend && (
                        <span className="disp-delta good">{t(lang, 'disp.save', { price: fmtEur(lang, ref.trend - best.price) ?? '' })}</span>
                      )}
                    </div>
                  )}
                </div>
                <label className="disp-target" title={t(lang, 'disp.targetHint')}>
                  <span className="sub">{t(lang, 'disp.target')}</span>
                  <input
                    type="number"
                    className="field"
                    min={0}
                    step={1}
                    placeholder="€"
                    key={key}
                    defaultValue={target ?? ''}
                    onBlur={(e) => setTarget(key, e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                  />
                  {target != null && (
                    <span className={`disp-target-hits${underTarget ? ' hit' : ''}`}>
                      {underTarget ? t(lang, 'disp.underTarget', { n: underTarget }) : t(lang, 'disp.noneUnder')}
                    </span>
                  )}
                </label>
              </header>
              {offers.length === 0 ? (
                <div className="sub disp-none">{t(lang, 'disp.noOffers')}</div>
              ) : (
                <ul className="disp-offers">
                  {shown.map((o, i) => {
                    const r = cmReference(file, code, o.lang ?? 'EN', o.title)
                    const delta = r?.trend ? (o.price - r.trend) / r.trend : null
                    const ok = inBudget(o)
                    return (
                      <li key={`${o.source}-${o.url}-${o.seller}-${i}`} className={`disp-offer${o.available === false ? ' out' : ''}${ok ? ' ok' : ''}`}>
                        <span className="disp-price">{fmtEur(lang, o.price)}</span>
                        <span className={`disp-delta${delta == null ? '' : delta <= -0.03 ? ' good' : delta >= 0.03 ? ' bad' : ''}`}>
                          {delta == null ? '–' : `${delta > 0 ? '+' : ''}${Math.round(delta * 100)} %`}
                        </span>
                        <span className="disp-seller">
                          <span className="name">{o.seller}</span>
                          <span className="sub">
                            {o.source === 'cardtrader' ? 'CardTrader' : t(lang, 'disp.shop')}
                            {o.where ? ` · ${o.where}` : ''}
                          </span>
                        </span>
                        <span className="disp-title" title={o.title}>{o.title}</span>
                        <span className="disp-tags">
                          {ok && <span className="pill disp-pill-ok"><Icon name="check" size={11} />{t(lang, 'disp.inBudget')}</span>}
                          {o.preorder && <span className="pill">{t(lang, 'disp.preorder')}</span>}
                          {o.available === false && <span className="pill">{t(lang, 'disp.soldOut')}</span>}
                          {o.zero && <span className="pill" title={t(lang, 'disp.zeroHint')}>Zero</span>}
                          {o.qty != null && o.qty > 1 && <span className="pill">{o.qty}×</span>}
                          {(langFilter === 'ALL' || !o.lang) && <span className="pill">{o.lang ?? '?'}</span>}
                        </span>
                        <button type="button" className="btn small" onClick={() => openLink(o.url)}>
                          <Icon name="external-link" />{t(lang, 'disp.open')}
                        </button>
                      </li>
                    )
                  })}
                  {offers.length > ROWS_PREVIEW && (
                    <li>
                      <button type="button" className="store-stock-more" onClick={() => setOpen((p) => ({ ...p, [code]: !isOpen }))}>
                        <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={13} />
                        {isOpen ? t(lang, 'stores.showLess') : t(lang, 'disp.showAll', { n: offers.length })}
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
