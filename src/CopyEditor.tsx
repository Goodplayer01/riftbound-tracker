import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import {
  CARD_LANGS,
  CONDITIONS,
  DEFAULT_COND,
  DEFAULT_LANG,
  cardEur,
  cardInvest,
  copyGroups,
  freeCopies,
  groupEur,
  parseEur,
  splitLot,
  type CopyLot,
} from './copies'
import { fmtEur, t, type Lang } from './i18n'
import type { Owned, PriceEntry } from './types'

export function fmtSignedEur(lang: Lang, n: number) {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtEur(lang, Math.abs(n))}`
}

/** Euro amount field that accepts "3,50" and commits on blur or Enter. */
export function MoneyInput({ lang, value, onChange, placeholder, label }: {
  lang: Lang
  value: number | null
  onChange: (v: number | null) => void
  placeholder?: string
  label: string
}) {
  const shown = value == null ? '' : value.toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const [draft, setDraft] = useState(shown)
  const [bad, setBad] = useState(false)
  useEffect(() => { setDraft(shown); setBad(false) }, [shown])
  function commit() {
    const v = parseEur(draft)
    if (v === undefined) { setBad(true); return }
    setBad(false)
    if (v !== value) onChange(v)
    else setDraft(shown)
  }
  return (
    <span className={`money-input${bad ? ' bad' : ''}`}>
      <input
        className="field"
        inputMode="decimal"
        aria-label={label}
        title={label}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur() }}
      />
      <span className="money-unit">€</span>
    </span>
  )
}

/** "My copies" block in the card lightbox: language, condition and purchase price per copy. */
export function CopyEditor({ lang, owned, lots, foilOnly, price, onChange }: {
  lang: Lang
  owned: Owned | undefined
  lots: CopyLot[]
  foilOnly: boolean
  price: PriceEntry | undefined
  onChange: (lots: CopyLot[]) => void
}) {
  const total = (owned?.qty || 0) + (owned?.foil || 0)
  const groups = copyGroups(lots, owned, foilOnly)
  const fitted = groups.flatMap((g) => (g.lot ? [g.lot] : []))
  const freeNormal = freeCopies(fitted, owned, foilOnly, false)
  const freeFoil = freeCopies(fitted, owned, foilOnly, true)
  const value = cardEur(lots, owned, foilOnly, price)
  const inv = cardInvest(lots, owned, foilOnly, price)
  const pulledN = fitted.filter((l) => l.pulled).reduce((s, l) => s + l.n, 0)

  function patch(id: string, change: Partial<CopyLot>) {
    onChange(fitted.map((l) => (l.id === id ? { ...l, ...change } : l)))
  }

  function addLot() {
    const foil = foilOnly || freeNormal === 0
    onChange([...fitted, { id: crypto.randomUUID(), foil, n: 1, lang: DEFAULT_LANG, cond: DEFAULT_COND, buy: null }])
  }

  function setCount(l: CopyLot, n: number) {
    if (n <= 0) onChange(fitted.filter((x) => x.id !== l.id))
    else patch(l.id, { n })
  }

  /** Bought (with a price per copy) or pulled from a pack (no price, not in paid / profit). */
  function setPulled(l: CopyLot, pulled: boolean) {
    if (pulled === !!l.pulled) return
    // undefined drops the flag when the book is saved as JSON.
    onChange(fitted.map((x) => (x.id !== l.id ? x : pulled ? { ...x, buy: null, pulled: true } : { ...x, pulled: undefined })))
  }

  function setFoil(l: CopyLot, foil: boolean) {
    if (foil === l.foil) return
    const room = foil ? freeFoil : freeNormal
    if (room <= 0) return
    patch(l.id, { foil, n: Math.min(l.n, room) })
  }

  return (
    <div className="copy-editor">
      <div className="card-ocr-head">
        <strong>{t(lang, 'copies.title')}</strong>
        {total > 0 && <span className="card-ocr-note">{t(lang, 'copies.note')}</span>}
      </div>
      {total === 0 ? (
        <p className="card-ocr-status muted">{t(lang, 'copies.none')}</p>
      ) : (
        <>
          <div className="copy-rows">
            {groups.map((g) => {
              const eur = groupEur(g, price)
              const l = g.lot
              const room = l ? (l.foil ? freeFoil : freeNormal) : 0
              return (
                <div key={l ? l.id : `free-${g.foil}`} className={`copy-row${l ? '' : ' copy-row-free'}`}>
                  {l ? (
                    <div className="copy-lines">
                      {/* Line 1: what the copies are. */}
                      <div className="copy-line">
                      <div className="qty copy-qty">
                        <button aria-label={`${t(lang, 'copies.count')} −1`} onClick={() => setCount(l, l.n - 1)}>−</button>
                        <b className="have">{l.n}</b>
                        <button aria-label={`${t(lang, 'copies.count')} +1`} disabled={room <= 0} onClick={() => setCount(l, l.n + 1)}>+</button>
                      </div>
                      {foilOnly ? (
                        <span className="copy-tag">Foil</span>
                      ) : (
                        <select className="select copy-select" aria-label={t(lang, 'qty.foil')} value={l.foil ? 'foil' : 'normal'} onChange={(e) => setFoil(l, e.target.value === 'foil')}>
                          <option value="normal" disabled={l.foil && freeNormal <= 0}>{t(lang, 'qty.normal')}</option>
                          <option value="foil" disabled={!l.foil && freeFoil <= 0}>{t(lang, 'qty.foil')}</option>
                        </select>
                      )}
                      <select className="select copy-select" aria-label={t(lang, 'copies.lang')} title={t(lang, 'copies.lang')} value={l.lang} onChange={(e) => patch(l.id, { lang: e.target.value as CopyLot['lang'] })}>
                        {CARD_LANGS.map((x) => <option key={x} value={x}>{x}</option>)}
                      </select>
                      <select className="select copy-select" aria-label={t(lang, 'copies.cond')} title={t(lang, 'copies.cond')} value={l.cond} onChange={(e) => patch(l.id, { cond: e.target.value as CopyLot['cond'] })}>
                        {CONDITIONS.map((x) => <option key={x} value={x}>{x}</option>)}
                      </select>
                      <button
                        type="button"
                        className="btn icon small danger deck-trash"
                        title={t(lang, 'copies.remove')}
                        aria-label={t(lang, 'copies.remove')}
                        onClick={() => onChange(fitted.filter((x) => x.id !== l.id))}
                      ><Icon name="trash-2" size={14} /></button>
                      </div>
                      {/* Line 2: where they came from, what they cost, what they are worth. */}
                      <div className="copy-line">
                      <div className="copy-source" role="group" aria-label={t(lang, 'copies.source')}>
                        <button type="button" className={l.pulled ? '' : 'on'} aria-pressed={!l.pulled} onClick={() => setPulled(l, false)}>{t(lang, 'copies.bought')}</button>
                        <button type="button" className={l.pulled ? 'on' : ''} aria-pressed={!!l.pulled} onClick={() => setPulled(l, true)}>{t(lang, 'copies.pulled')}</button>
                      </div>
                      {!l.pulled && (
                        <MoneyInput lang={lang} value={l.buy} label={t(lang, 'copies.buy')} placeholder={t(lang, 'copies.buyPh')} onChange={(buy) => patch(l.id, { buy })} />
                      )}
                      {l.n > 1 && (
                        <button
                          type="button"
                          className="btn icon small"
                          title={t(lang, 'copies.split')}
                          aria-label={t(lang, 'copies.split')}
                          onClick={() => onChange(splitLot(fitted, l.id, crypto.randomUUID()))}
                        ><Icon name="copy" size={14} /></button>
                      )}
                      <span className="copy-eur">
                        {eur != null && <span>~{fmtEur(lang, eur)}</span>}
                        {eur != null && l.buy != null && (
                          <b className={eur - l.n * l.buy >= 0 ? 'value-up' : 'value-down'}>{fmtSignedEur(lang, eur - l.n * l.buy)}</b>
                        )}
                      </span>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="copy-free-text">
                        {t(lang, 'copies.free', { n: g.n, kind: g.foil ? t(lang, 'qty.foil') : t(lang, 'qty.normal') })}
                      </span>
                      <span className="copy-eur">{eur != null && <span>~{fmtEur(lang, eur)}</span>}</span>
                    </>
                  )}
                </div>
              )
            })}
          </div>
          <div className="copy-foot">
            <button type="button" className="btn small add" disabled={freeNormal + freeFoil <= 0} onClick={addLot}>
              <Icon name="tag" />{t(lang, 'copies.add')}
            </button>
            <span className="sub">
              {t(lang, 'copies.value', { eur: fmtEur(lang, value) ?? '' })}
              {inv.copies > 0 && (
                <>
                  {' · '}{t(lang, 'copies.paid', { eur: fmtEur(lang, inv.paid) ?? '' })}{' · '}
                  <b className={inv.worth - inv.paid >= 0 ? 'value-up' : 'value-down'}>{fmtSignedEur(lang, inv.worth - inv.paid)}</b>
                </>
              )}
              {pulledN > 0 && <>{' · '}{t(lang, 'copies.pulledCount', { n: pulledN })}</>}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
