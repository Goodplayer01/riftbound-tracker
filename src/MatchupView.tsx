import { useEffect, useMemo, useState } from 'react'
import { banStatus } from './banlist'
import { cardThumb } from './cardImages'
import { cardMatchesLegendDomains, displayCardName, matchCardByName } from './deckHelpers'
import { Icon } from './Icon'
import { t, type Lang } from './i18n'
import {
  counterCards,
  legendKey,
  legendRecord,
  loadMatchups,
  matchupRows,
  typicalCards,
  type MatchupRow,
  type MatchupsFile,
} from './matchups'
import type { Card } from './types'

/** Matchups with fewer games are hidden unless the player lowers the filter. */
const MIN_GAMES_CHOICES = [1, 5, 10] as const
/** Below this many games a number is shown as uncertain. */
const FEW_GAMES = 10

const pct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)} %`)

/** Win rate colour from red (0.35 and below) over neutral to green (0.65 and above). */
function wrClass(wr: number | null) {
  if (wr == null) return ''
  if (wr >= 0.56) return ' good'
  if (wr >= 0.5) return ' ok'
  if (wr > 0.44) return ' meh'
  return ' bad'
}

function Thumb({ c }: { c?: Card }) {
  const src = c ? cardThumb(c) : undefined
  return src
    ? <img className="mu-thumb" src={src} alt="" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
    : <span className="mu-thumb mu-thumb-empty" aria-hidden />
}

/**
 * The deck builder's Matchup view: how the deck's Legend does against every other Legend
 * (RiftLite community games), and per opponent the cards that win more against it.
 */
export function MatchupView({
  lang,
  legend,
  cards,
  deckCopies,
  owned,
  onOpenCard,
  openLink,
  onClose,
}: {
  lang: Lang
  legend: Card
  cards: Card[]
  /** copies in the open deck by card name */
  deckCopies: Map<string, number>
  /** copies the player can use of a card, all prints */
  owned: (c: Card) => number
  onOpenCard: (c: Card) => void
  openLink: (url: string) => void
  onClose: () => void
}) {
  const [file, setFile] = useState<MatchupsFile | null>(null)
  const [failed, setFailed] = useState(false)
  const [minGames, setMinGames] = useState<number>(5)
  const [opp, setOpp] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    loadMatchups().then((f) => {
      if (!alive) return
      setFile(f)
      setFailed(!f)
    })
    return () => { alive = false }
  }, [])

  const byName = useMemo(() => {
    const m = new Map<string, Card | undefined>()
    return (name: string) => {
      if (!m.has(name)) m.set(name, matchCardByName(cards, name))
      return m.get(name)
    }
  }, [cards])

  const legendCards = useMemo(() => cards.filter((c) => c.types.includes('Legend') && !c.altArt && !c.overnumbered && !c.signed), [cards])
  /** RiftLite's key as a catalogue Legend; a bare champion name only when that champion has one Legend
   *  (old "Master Yi" games cannot be told apart from "Master Yi, Wuju Bladesman" ones). */
  const legendCard = (key: string) => {
    const exact = legendCards.find((c) => displayCardName(c) === key)
    if (exact) return exact
    const byChamp = legendCards.filter((c) => c.name === key)
    return new Set(byChamp.map(displayCardName)).size === 1 ? byChamp[0] : undefined
  }

  const key = file ? legendKey(file, legend.name, displayCardName(legend)) : null
  const rows = useMemo(() => (file && key ? matchupRows(file, key) : []), [file, key])
  const shown = rows.filter((r) => r.games >= minGames)
  const good = shown.filter((r) => r.wr != null && r.wr >= 0.5)
  const bad = shown.filter((r) => r.wr != null && r.wr < 0.5).reverse()
  const hidden = rows.length - shown.length
  const record = file && key ? legendRecord(file, key) : null

  const allowed = (name: string) => {
    const c = byName(name)
    if (!c || c.types.includes('Legend') || c.types.includes('Rune') || c.types.includes('Battlefield')) return false
    return cardMatchesLegendDomains(c, legend.domains) && !banStatus(c)
  }
  const detail = useMemo(() => {
    if (!file || !opp) return null
    return {
      row: rows.find((r) => r.opp === opp),
      counters: counterCards(file, key, opp, allowed),
      typical: typicalCards(file, opp, 10),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- allowed only depends on legend and cards
  }, [file, key, opp, rows, legend, cards])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelectorAll('.card-lightbox').length > 1) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const updated = file ? new Date(file.updatedAt).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB') : ''

  const renderRow = (r: MatchupRow) => {
    const c = legendCard(r.opp)
    const few = r.games < FEW_GAMES
    return (
      <li key={r.opp} className={`mu-row${opp === r.opp ? ' active' : ''}`}>
        <button type="button" className="mu-row-btn" onClick={() => setOpp(opp === r.opp ? null : r.opp)} aria-pressed={opp === r.opp}>
          <Thumb c={c} />
          <span className="mu-row-name">
            <b>{c ? displayCardName(c) : r.opp}</b>
            <small>{t(lang, 'mu.games', { n: r.games })}{few ? ` · ${t(lang, 'mu.few')}` : ''}</small>
          </span>
          <span className={`mu-wr${wrClass(r.wr)}${few ? ' few' : ''}`}>
            <span className="mu-bar" aria-hidden><span style={{ width: `${Math.round((r.wr ?? 0) * 100)}%` }} /></span>
            <b>{pct(r.wr)}</b>
          </span>
          <span className="mu-details">{t(lang, 'mu.details')}<Icon name="chevron-right" size={14} /></span>
        </button>
      </li>
    )
  }

  const tagFor = (c: Card | undefined, name: string) => {
    const inDeck = deckCopies.get(name) || 0
    if (inDeck) return <span className="mu-tag in-deck">{t(lang, 'mu.inDeck', { n: inDeck })}</span>
    const n = c ? owned(c) : 0
    return n > 0 ? <span className="mu-tag">{t(lang, 'mu.owns', { n })}</span> : <span className="mu-tag none">{t(lang, 'mu.notOwned')}</span>
  }

  const oppCard = opp ? legendCard(opp) : undefined
  const oppName = oppCard ? displayCardName(oppCard) : opp || ''

  return (
    <div className="card-lightbox" role="dialog" aria-modal="true" aria-labelledby="mu-title" onClick={onClose}>
      <div className="panel mu-box" onClick={(e) => e.stopPropagation()}>
        <div className="mu-head">
          <Thumb c={legend} />
          <div className="grow">
            <h2 id="mu-title">{t(lang, 'mu.title', { legend: displayCardName(legend) })}</h2>
            {record && record.wr != null && (
              <p className="sub">
                {t(lang, 'mu.overall', { wr: pct(record.wr), n: record.wins + record.losses })}
              </p>
            )}
          </div>
          <button type="button" className="btn small" onClick={onClose}><Icon name="x" />{t(lang, 'decks.shareClose')}</button>
        </div>

        {!file && !failed && <div className="empty">{t(lang, 'mu.loading')}</div>}
        {failed && <div className="empty">{t(lang, 'mu.failed')}</div>}
        {file && !key && <div className="empty">{t(lang, 'mu.noLegend', { legend: displayCardName(legend) })}</div>}

        {file && key && (
          <div className="mu-body">
            <div className="mu-lists">
              <div className="mu-filter" role="group" aria-label={t(lang, 'mu.minGames')}>
                <span className="sub">{t(lang, 'mu.minGames')}</span>
                {MIN_GAMES_CHOICES.map((n) => (
                  <button key={n} type="button" className={`chip${minGames === n ? ' active' : ''}`} onClick={() => setMinGames(n)}>
                    {n === 1 ? t(lang, 'mu.all') : `${n}+`}
                  </button>
                ))}
                {hidden > 0 && <span className="sub">{t(lang, 'mu.hidden', { n: hidden })}</span>}
              </div>
              <section>
                <h3 className="mu-h good">{t(lang, 'mu.good')}</h3>
                {good.length ? <ul className="mu-list">{good.map(renderRow)}</ul> : <p className="sub">{t(lang, 'mu.none')}</p>}
              </section>
              <section>
                <h3 className="mu-h bad">{t(lang, 'mu.bad')}</h3>
                {bad.length ? <ul className="mu-list">{bad.map(renderRow)}</ul> : <p className="sub">{t(lang, 'mu.none')}</p>}
              </section>
            </div>

            <div className="mu-detail">
              {!detail && <div className="empty">{t(lang, 'mu.pick')}</div>}
              {detail && (
                <>
                  <div className="mu-detail-head">
                    <Thumb c={oppCard} />
                    <div className="grow">
                      <h3>{t(lang, 'mu.vs', { legend: legend.name, opp: oppName })}</h3>
                      {detail.row && (
                        <p className="sub">
                          <b className={`mu-wr-text${wrClass(detail.row.wr)}`}>{pct(detail.row.wr)}</b>{' '}
                          {t(lang, 'mu.record', { w: detail.row.wins, l: detail.row.losses, d: detail.row.draws })}
                          {detail.row.games < FEW_GAMES ? ` · ${t(lang, 'mu.fewLong')}` : ''}
                        </p>
                      )}
                    </div>
                  </div>

                  <h4>{t(lang, 'mu.counters', { opp: oppName })}</h4>
                  <p className="help">{t(lang, 'mu.countersHelp', { n: detail.counters.base[0], wr: pct(detail.counters.base[0] ? detail.counters.base[1] / detail.counters.base[0] : null), opp: oppCard?.name ?? oppName })}</p>
                  {detail.counters.cards.length === 0 && <p className="sub">{t(lang, 'mu.noCounters')}</p>}
                  <ul className="mu-cards">
                    {detail.counters.cards.map((cc) => {
                      const c = byName(cc.name)
                      return (
                        <li key={cc.name}>
                          <button type="button" className="mu-card" onClick={() => c && onOpenCard(c)} disabled={!c}>
                            <Thumb c={c} />
                            <span className="mu-row-name">
                              <b>{cc.name}</b>
                              <small>
                                {t(lang, 'mu.cardRecord', { wr: pct(cc.wr), n: cc.games })}
                                {cc.own ? ` · ${t(lang, 'mu.ownLegend', { legend: legend.name, n: cc.own[0], w: cc.own[1] })}` : ''}
                              </small>
                            </span>
                            <span className="mu-lift">+{Math.round(cc.lift * 100)}</span>
                            {tagFor(c, c ? displayCardName(c) : cc.name)}
                          </button>
                        </li>
                      )
                    })}
                  </ul>

                  {detail.typical.decks > 0 && (
                    <>
                      <h4>{t(lang, 'mu.typical', { opp: oppCard?.name ?? oppName })}</h4>
                      <p className="help">{t(lang, 'mu.typicalHelp', { n: detail.typical.decks })}</p>
                      <div className="mu-typical">
                        {detail.typical.cards.map((p) => {
                          const c = byName(p.name)
                          return (
                            <button key={p.name} type="button" className="chip" onClick={() => c && onOpenCard(c)} disabled={!c}>
                              {p.name} <small>{pct(p.share)}</small>
                            </button>
                          )
                        })}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {file && (
          <p className="mu-source sub">
            {t(lang, 'mu.source', { n: file.matches.toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB'), date: updated })}{' '}
            <button type="button" className="link-btn" onClick={() => openLink(file.source)}>RiftLite<Icon name="external-link" size={12} /></button>
          </p>
        )}
      </div>
    </div>
  )
}
