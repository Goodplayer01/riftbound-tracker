import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'
import type { Card, PriceBook } from './types'
import { fmtEur, t, type Lang } from './i18n'
import { displayCardName } from './deckHelpers'
import { cardThumb, layeredArtBackground, preloadArt } from './cardImages'
import { boosterSets, rollPack, slotValue, type HitKind, type PackSlot } from './dopaminPacks'
import { loadSealed } from './displays'

type Face = 'down' | 'hold' | 'up'
type Phase = 'sealed' | 'tear' | 'open' | 'summary'
type Glow = '' | 'rare' | 'epic' | 'show' | 'ur'

/** Per set: packs opened, money spent on them and value pulled. Kept across restarts. */
type SetStats = { packs: number; spent: number; value: number; best?: { id: string; eur: number } }
const STATS_KEY = 'rb.dopamin.v1'

function loadStats(): Record<string, SetStats> {
  try {
    return JSON.parse(localStorage.getItem(STATS_KEY) || '{}') || {}
  } catch {
    return {}
  }
}

function saveStats(s: Record<string, SetStats>) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

const GLOW: Record<HitKind, Glow> = { '': '', rare: 'rare', epic: 'epic', alt: 'show', altrune: 'show', over: 'show', signed: 'ur', ultimate: 'ur' }
const HOLD: Record<Glow, number> = { '': 0, rare: 620, epic: 900, show: 900, ur: 1200 }

const PACK_IMG: Record<string, string> = {
  OGN: 'packs/ogn.jpg',
  SFD: 'packs/sfd.jpg',
  UNL: 'packs/unl.jpg',
  VEN: 'packs/ven.jpg',
  RAD: 'packs/rad.jpg',
}

const DISPLAY_IMG: Record<string, string> = {
  OGN: 'displays/ogn.jpg',
  SFD: 'displays/sfd.jpg',
  UNL: 'displays/unl.jpg',
  VEN: 'displays/ven.jpg',
}

function publicAsset(rel: string) {
  return new URL(rel, window.location.href).href
}

function fmtChance(lang: Lang, p: number) {
  const pct = p * 100
  const text = pct >= 0.1 ? pct.toFixed(1) : pct.toFixed(3).replace(/0+$/, '')
  // Rare outcomes read better as "1 in N packs"; every slot comes once per pack.
  return p < 0.05 ? `${text}% · ${t(lang, 'dopamin.oneIn', { n: Math.round(1 / p).toLocaleString(lang) })}` : `${text}%`
}

function signedEur(lang: Lang, n: number) {
  return `${n >= 0 ? '+' : '−'}${fmtEur(lang, Math.abs(n))}`
}

export function Dopamin({ cards, lang, prices }: { cards: Card[]; lang: Lang; prices: PriceBook | null }) {
  const sets = useMemo(() => boosterSets(cards), [cards])
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])
  const [setId, setSetId] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('sealed')
  const [pack, setPack] = useState<PackSlot[] | null>(null)
  const [idx, setIdx] = useState(0)
  const [face, setFace] = useState<Face>('down')
  const [stats, setStats] = useState<Record<string, SetStats>>(loadStats)
  /** Cardmarket trend of one English booster per set, from sealed.json (same measure as the card values). */
  const [packPrice, setPackPrice] = useState<Record<string, number>>({})
  const gen = useRef(0)
  const opening = useRef(false)
  const lock = useRef(false)
  const timers = useRef<number[]>([])

  useEffect(() => () => {
    for (const id of timers.current) window.clearTimeout(id)
  }, [])

  useEffect(() => {
    let alive = true
    loadSealed().then((s) => {
      if (!alive || !s) return
      const out: Record<string, number> = {}
      for (const [id, name] of Object.entries(s.sets)) {
        const row = s.cardmarket.products.find((p) => p.set === id && p.lang === 'EN' && p.name === `${name} Booster`)
        const eur = row?.trend ?? row?.low
        if (eur) out[id] = eur
      }
      setPackPrice(out)
    })
    return () => { alive = false }
  }, [])

  useEffect(() => saveStats(stats), [stats])

  function clearTimers() {
    for (const id of timers.current) window.clearTimeout(id)
    timers.current = []
  }

  function resetPack() {
    gen.current++
    opening.current = false
    lock.current = false
    clearTimers()
    setPack(null)
    setIdx(0)
    setFace('down')
    setPhase('sealed')
  }

  function openPack() {
    if (opening.current || phase !== 'sealed' || !setId) return
    const slots = rollPack(cards, setId)
    if (!slots) return
    // The tear animation buys time to fetch the full art of every card in the pack.
    for (const sl of slots) preloadArt(sl.card.image)
    // Count the pack right away, so leaving mid pack still books it.
    let value = 0
    let best: SetStats['best']
    for (const sl of slots) {
      const v = slotValue(sl, prices?.cards[sl.card.id]) || 0
      value += v
      if (!best || v > best.eur) best = { id: sl.card.id, eur: v }
    }
    const cost = packPrice[setId] || 0
    setStats((all) => {
      const cur = all[setId] || { packs: 0, spent: 0, value: 0 }
      return {
        ...all,
        [setId]: {
          packs: cur.packs + 1,
          spent: cur.spent + cost,
          value: cur.value + value,
          best: best && (!cur.best || best.eur > cur.best.eur) ? best : cur.best,
        },
      }
    })
    opening.current = true
    const g = ++gen.current
    setPack(slots)
    setIdx(0)
    setFace('down')
    setPhase('tear')
    const slow = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const id = window.setTimeout(() => {
      if (gen.current !== g) return
      opening.current = false
      setPhase('open')
    }, slow ? 0 : 420)
    timers.current.push(id)
  }

  function reveal() {
    if (lock.current || phase !== 'open' || !pack) return
    if (face === 'up' && idx === pack.length - 1) {
      setPhase('summary')
      return
    }
    const at = face === 'up' ? idx + 1 : idx
    const slot = pack[at]
    const g = gen.current
    const finishUp = () => {
      if (gen.current !== g) return
      lock.current = false
      setFace('up')
    }
    const start = () => {
      if (gen.current !== g) return
      const glow = GLOW[slot.hit]
      const slow = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (!glow || slow) {
        finishUp()
        return
      }
      setFace('hold')
      const id = window.setTimeout(finishUp, HOLD[glow])
      timers.current.push(id)
    }
    lock.current = true
    if (face === 'up') {
      setIdx(at)
      setFace('down')
      const id = window.setTimeout(start, 40)
      timers.current.push(id)
      return
    }
    start()
  }

  function revealAll() {
    clearTimers()
    lock.current = false
    setPhase('summary')
  }

  function resetStats() {
    if (!setId) return
    setStats((all) => {
      const next = { ...all }
      delete next[setId]
      return next
    })
  }

  const chosen = sets.find((s) => s.id === setId) || null

  if (!chosen) {
    return (
      <div className="dopamin">
        <h2 className="section-title">{t(lang, 'dopamin.choose')}</h2>
        {sets.length === 0 ? <p className="help">{t(lang, 'dopamin.empty')}</p> : null}
        <div className="dop-sets">
          {sets.map((s) => {
            const art = DISPLAY_IMG[s.id] || PACK_IMG[s.id]
            const st = stats[s.id]
            const net = st ? st.value - st.spent : 0
            return (
              <button
                key={s.id}
                type="button"
                className="dop-set"
                style={{ ['--pack' as string]: s.tint }}
                onClick={() => { setSetId(s.id); resetPack() }}
              >
                {art ? <img className="dop-set-art" src={publicAsset(art)} alt="" draggable={false} /> : null}
                <span className="dop-set-label">{s.name} ({s.id})</span>
                <span className="dop-set-sub">
                  {packPrice[s.id] ? t(lang, 'dopamin.packPrice', { eur: fmtEur(lang, packPrice[s.id]) ?? '' }) : ' '}
                  {st?.packs ? <b className={net >= 0 ? 'gain' : 'loss'}>{signedEur(lang, net)}</b> : null}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  const st = stats[chosen.id] || { packs: 0, spent: 0, value: 0 }
  const net = st.value - st.spent
  const bestCard = st.best ? byId.get(st.best.id) : null
  const art = PACK_IMG[chosen.id]
  const slot = pack && phase === 'open' ? pack[idx] : null
  const up = face === 'up' && !!slot
  const glow = slot ? GLOW[slot.hit] : ''
  const price = up && slot ? slotValue(slot, prices?.cards[slot.card.id]) : null
  const packValue = pack ? pack.reduce((s, sl) => s + (slotValue(sl, prices?.cards[sl.card.id]) || 0), 0) : 0
  const cost = packPrice[chosen.id]

  return (
    <div className="dopamin">
      <div className="dop-stats">
        <button type="button" className="chip" onClick={() => { resetPack(); setSetId(null) }}><Icon name="arrow-left" />{t(lang, 'dopamin.back')}</button>
        <div className="deck-stat"><span>{t(lang, 'dopamin.statPacks')}</span><b>{st.packs}</b></div>
        <div className="deck-stat" title={cost ? t(lang, 'dopamin.packPrice', { eur: fmtEur(lang, cost) ?? '' }) : t(lang, 'dopamin.noPackPrice')}>
          <span>{t(lang, 'dopamin.statSpent')}</span><b>{fmtEur(lang, st.spent) ?? '–'}</b>
        </div>
        <div className="deck-stat"><span>{t(lang, 'dopamin.statValue')}</span><b>{fmtEur(lang, st.value) ?? '–'}</b></div>
        <div className={`deck-stat ${net >= 0 ? 'gain' : 'loss'}`}><span>{t(lang, 'dopamin.statNet')}</span><b>{signedEur(lang, net)}</b></div>
        {bestCard && st.best ? (
          <div className="deck-stat" title={displayCardName(bestCard)}>
            <span>{t(lang, 'dopamin.statBest')}</span><b className="dop-best">{displayCardName(bestCard)}</b><small>{fmtEur(lang, st.best.eur)}</small>
          </div>
        ) : null}
        {st.packs > 0 && <button type="button" className="chip" onClick={resetStats} title={t(lang, 'dopamin.resetHint')}><Icon name="refresh-cw" />{t(lang, 'dopamin.reset')}</button>}
      </div>

      {(phase === 'sealed' || phase === 'tear') && art && (
        <button
          type="button"
          className={`dop-pack${phase === 'tear' ? ' tear' : ''}`}
          aria-label={t(lang, 'dopamin.open')}
          onClick={() => openPack()}
        >
          <img src={publicAsset(art)} alt="" draggable={false} />
        </button>
      )}
      {phase === 'sealed' && <div className="dop-packs">{t(lang, 'dopamin.clickToOpen')}</div>}

      {phase === 'open' && pack && slot && (
        <div className="dop-one">
          <div className="dop-count">{idx + 1} / {pack.length}</div>
          <button type="button" className={`dop-flip${face === 'hold' ? ` hold hold-${glow}` : ''}${up && glow ? ` glow glow-${glow}` : ''}`} onClick={reveal} aria-label={up ? displayCardName(slot.card) : t(lang, 'dopamin.open')}>
            <span className={`dop-inner${glow && face !== 'down' ? ' rareflip' : ''}${up ? ' up' : ''}`}>
              <span className="dop-back" />
              <span className="dop-face">
                <span className={`card dop-face-inner${slot.foil ? ' shimmer' : ''}`}>
                  <span className="art" style={{ backgroundImage: layeredArtBackground(slot.card) }} />
                </span>
              </span>
            </span>
          </button>
          <div className="dop-meta">
            {up ? (
              <>
                <div className="dop-name">
                  {displayCardName(slot.card)}
                  {slot.hit && slot.hit !== 'rare' ? <span className={`dop-hit dop-hit-${glow}`}>{t(lang, `dopamin.hit.${slot.hit}`)}</span> : null}
                  {slot.foil ? <span className="dop-foil">Foil</span> : null}
                </div>
                {price != null ? <div className="dop-price">{fmtEur(lang, price)}</div> : null}
                <div className="dop-chance" title={slot.estimate ? t(lang, 'dopamin.estimateHint') : undefined}>
                  {t(lang, 'dopamin.chance')} {fmtChance(lang, slot.chance)}{slot.estimate ? ` (${t(lang, 'dopamin.estimate')})` : ''}
                </div>
              </>
            ) : <div className="dop-chance">{t(lang, 'dopamin.clickToFlip')}</div>}
          </div>
          <button type="button" className="chip" onClick={revealAll}><Icon name="layers" />{t(lang, 'dopamin.revealAll')}</button>
        </div>
      )}

      {phase === 'summary' && pack && (
        <div className="dop-summary">
          <div className="dop-summary-head">
            <div className="deck-stat"><span>{t(lang, 'dopamin.packValue')}</span><b>{fmtEur(lang, packValue) ?? '–'}</b></div>
            {cost ? (
              <div className={`deck-stat ${packValue - cost >= 0 ? 'gain' : 'loss'}`}><span>{t(lang, 'dopamin.vsPrice', { eur: fmtEur(lang, cost) ?? '' })}</span><b>{signedEur(lang, packValue - cost)}</b></div>
            ) : null}
          </div>
          <div className="dop-grid">
            {pack.map((sl, i) => {
              const v = slotValue(sl, prices?.cards[sl.card.id])
              const g = GLOW[sl.hit]
              return (
                <div key={i} className={`dop-mini${g ? ` glow-${g}` : ''}`} title={displayCardName(sl.card)}>
                  <span className={`dop-mini-art${sl.foil ? ' shimmer' : ''}`} style={{ backgroundImage: `url("${cardThumb(sl.card) || sl.card.image}")` }} />
                  <span className="dop-mini-name">{displayCardName(sl.card)}</span>
                  <span className="dop-mini-row">
                    {sl.hit && sl.hit !== 'rare' ? <span className={`dop-hit dop-hit-${g}`}>{t(lang, `dopamin.hit.${sl.hit}`)}</span> : sl.foil ? <span className="dop-foil">Foil</span> : <span />}
                    <b>{v != null ? fmtEur(lang, v) : '–'}</b>
                  </span>
                </div>
              )
            })}
          </div>
          <div className="dop-actions">
            <button type="button" className="chip active" onClick={resetPack}><Icon name="refresh-cw" />{t(lang, 'dopamin.again')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
