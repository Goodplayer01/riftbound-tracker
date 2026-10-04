import { useEffect, useMemo, useRef, useState } from 'react'
import type { Card, PriceBook } from './types'
import { t, type Lang } from './i18n'
import { displayCardName } from './deckHelpers'
import { boosterSets, pullChance, rollPack, type PackSlot } from './dopamin'

type Face = 'down' | 'hold' | 'up'
type Phase = 'sealed' | 'tear' | 'open'

const HOLD: Record<string, number> = {
  Rare: 620,
  Epic: 900,
  Showcase: 900,
  'Ultimate Rare': 1200,
}

const PACK_IMG: Record<string, string> = {
  OGN: 'packs/ogn.jpg',
  SFD: 'packs/sfd.jpg',
  UNL: 'packs/unl.jpg',
  VEN: 'packs/ven.jpg',
  RAD: 'packs/rad.jpg',
}

function publicAsset(rel: string) {
  return new URL(rel, window.location.href).href
}

function holdKind(r: string | null): '' | 'rare' | 'epic' | 'show' | 'ur' {
  if (r === 'Rare') return 'rare'
  if (r === 'Epic') return 'epic'
  if (r === 'Showcase') return 'show'
  if (r === 'Ultimate Rare') return 'ur'
  return ''
}

function fmtChance(p: number) {
  const pct = p * 100
  const text = pct >= 0.1 ? pct.toFixed(1) : pct.toFixed(3).replace(/0+$/, '')
  return `${text}%`
}

function slotPrice(slot: PackSlot, prices: PriceBook | null) {
  const p = prices?.cards[slot.card.id]
  if (!p) return null
  const n = slot.foil ? (p.foilLow ?? p.foilTrend) : p.low
  if (n == null || Number.isNaN(n)) return null
  return `${n.toFixed(2)} EUR`
}

export function Dopamin({ cards, lang, prices }: { cards: Card[]; lang: Lang; prices: PriceBook | null }) {
  const sets = useMemo(() => boosterSets(cards), [cards])
  const [setId, setSetId] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('sealed')
  const [pack, setPack] = useState<PackSlot[] | null>(null)
  const [idx, setIdx] = useState(0)
  const [face, setFace] = useState<Face>('down')
  const gen = useRef(0)
  const opening = useRef(false)
  const lock = useRef(false)
  const timers = useRef<number[]>([])

  useEffect(() => () => {
    for (const id of timers.current) window.clearTimeout(id)
  }, [])

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
    const at = face === 'up' ? idx + 1 : idx
    if (at >= pack.length) return
    const slot = pack[at]
    const g = gen.current
    const finishUp = () => {
      if (gen.current !== g) return
      lock.current = false
      setFace('up')
    }
    const start = () => {
      if (gen.current !== g) return
      const kind = holdKind(slot.card.rarity)
      const slow = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (!kind || slow) {
        finishUp()
        return
      }
      setFace('hold')
      const id = window.setTimeout(finishUp, HOLD[slot.card.rarity || ''] || 620)
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

  const chosen = sets.find((s) => s.id === setId) || null
  const slot = pack ? pack[idx] : null
  const up = face === 'up' && !!slot
  const done = phase === 'open' && !!pack && idx === pack.length - 1 && face === 'up'
  const kind = slot ? holdKind(slot.card.rarity) : ''
  const price = up && slot ? slotPrice(slot, prices) : null
  const chance = up && slot && setId ? pullChance(cards, setId, slot) : null

  if (!chosen) {
    return (
      <div className="dopamin">
        <h2 className="section-title">{t(lang, 'dopamin.choose')}</h2>
        {sets.length === 0 ? <p className="help">{t(lang, 'dopamin.empty')}</p> : null}
        <div className="dop-sets">
          {sets.map((s) => (
            <button key={s.id} type="button" className="dop-set" style={{ ['--pack' as string]: s.tint }} onClick={() => { setSetId(s.id); setPhase('sealed') }}>
              {s.name} ({s.id})
            </button>
          ))}
        </div>
      </div>
    )
  }

  const art = PACK_IMG[chosen.id]

  return (
    <div className="dopamin">
      {phase !== 'open' && art && (
        <button
          type="button"
          className={`dop-pack${phase === 'tear' ? ' tear' : ''}`}
          aria-label={t(lang, 'dopamin.open')}
          onClick={() => openPack()}
        >
          <img src={publicAsset(art)} alt="" draggable={false} />
        </button>
      )}
      {phase === 'open' && pack && slot && (
        <div className="dop-one">
          <div className="dop-count">{idx + 1} / {pack.length}</div>
          <button type="button" className={`dop-flip${face === 'hold' ? ` hold hold-${kind}` : ''}${up && kind ? ` glow glow-${kind}` : ''}`} onClick={reveal} aria-label={up ? displayCardName(slot.card) : t(lang, 'dopamin.open')}>
            <span className={`dop-inner${kind && face !== 'down' ? ' rareflip' : ''}${up ? ' up' : ''}`}>
              <span className="dop-back" />
              <span className="dop-face">
                <span className={`card dop-face-inner${slot.foil ? ' shimmer' : ''}`}>
                  <span className="art" style={{ backgroundImage: slot.card.image ? `url(${slot.card.image})` : undefined }} />
                </span>
              </span>
            </span>
          </button>
          {up && (
            <div className="dop-meta">
              <div className="dop-name">{displayCardName(slot.card)}</div>
              {price ? <div className="dop-price">{price}</div> : null}
              {chance != null ? <div className="dop-chance">{t(lang, 'dopamin.chance')} {fmtChance(chance)}</div> : null}
            </div>
          )}
        </div>
      )}
      {done && (
        <div className="dop-actions">
          <button type="button" className="chip active" onClick={resetPack}>{t(lang, 'dopamin.again')}</button>
          <button type="button" className="chip" onClick={() => { resetPack(); setSetId(null) }}>{t(lang, 'dopamin.back')}</button>
        </div>
      )}
    </div>
  )
}
