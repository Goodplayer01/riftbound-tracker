import { useEffect, useMemo, useRef, useState } from 'react'
import type { Card } from './types'
import { t, type Lang } from './i18n'
import { displayCardName } from './deckHelpers'
import { boosterSets, rollPack, type PackSlot } from './dopamin'

type Face = 'down' | 'hold' | 'up'
type Phase = 'sealed' | 'tear' | 'open'

const HOLD: Record<string, number> = {
  Rare: 620,
  Epic: 900,
  Showcase: 900,
  'Ultimate Rare': 1200,
}

function holdKind(r: string | null): '' | 'rare' | 'epic' | 'show' | 'ur' {
  if (r === 'Rare') return 'rare'
  if (r === 'Epic') return 'epic'
  if (r === 'Showcase') return 'show'
  if (r === 'Ultimate Rare') return 'ur'
  return ''
}

export function Dopamin({ cards, lang }: { cards: Card[]; lang: Lang }) {
  const sets = useMemo(() => boosterSets(cards), [cards])
  const [setId, setSetId] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('sealed')
  const [pack, setPack] = useState<PackSlot[] | null>(null)
  const [face, setFace] = useState<Face[]>([])
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
    setFace([])
    setPhase('sealed')
  }

  function openPack() {
    if (opening.current || phase !== 'sealed' || !setId) return
    const slots = rollPack(cards, setId)
    if (!slots) return
    opening.current = true
    const g = ++gen.current
    setPack(slots)
    setFace(slots.map(() => 'down'))
    setPhase('tear')
    const slow = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const id = window.setTimeout(() => {
      if (gen.current !== g) return
      opening.current = false
      setPhase('open')
    }, slow ? 0 : 860)
    timers.current.push(id)
  }

  function flip(i: number) {
    if (phase !== 'open' || !pack) return
    if (lock.current || face[i] !== 'down' || face.some((x) => x === 'hold')) return
    const kind = holdKind(pack[i].card.rarity)
    const slow = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!kind || slow) {
      setFace((prev) => prev.map((x, j) => (j === i ? 'up' : x)))
      return
    }
    lock.current = true
    setFace((prev) => prev.map((x, j) => (j === i ? 'hold' : x)))
    const g = gen.current
    const id = window.setTimeout(() => {
      if (gen.current !== g) return
      lock.current = false
      setFace((prev) => prev.map((x, j) => (j === i && x === 'hold' ? 'up' : x)))
    }, HOLD[pack[i].card.rarity || ''] || 620)
    timers.current.push(id)
  }

  const chosen = sets.find((s) => s.id === setId) || null
  const done = phase === 'open' && face.length > 0 && face.every((x) => x === 'up')

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

  return (
    <div className="dopamin">
      {phase !== 'open' && (
        <button
          type="button"
          className={`dop-pack${phase === 'tear' ? ' tear' : ''}`}
          style={{ ['--pack' as string]: chosen.tint }}
          aria-label={t(lang, 'dopamin.open')}
          onPointerDown={() => openPack()}
          onClick={() => openPack()}
          onDragStart={(e) => e.preventDefault()}
        >
          <span className="dop-half top">
            <span className="dop-pack-label">
              <b>{chosen.name}</b>
              <span>{t(lang, 'dopamin.open')}</span>
            </span>
          </span>
          <span className="dop-half bot" />
        </button>
      )}
      {phase === 'open' && pack && (
        <div className="dop-board">
          {pack.map((slot, i) => {
            const up = face[i] === 'up'
            const kind = holdKind(slot.card.rarity)
            const name = displayCardName(slot.card)
            return (
              <div key={i} className={`dop-slot${face[i] === 'hold' ? ` hold hold-${kind}` : ''}`} style={{ ['--tilt' as string]: `${(i % 7 - 3) * 4}deg` }}>
                <button type="button" className="dop-flip" onClick={() => flip(i)} aria-label={up ? name : undefined}>
                  <span className={`dop-inner${kind && face[i] !== 'down' ? ' rareflip' : ''}${up ? ' up' : ''}`}>
                    <span className="dop-back" />
                    <span className="dop-face">
                      <span className={`card dop-face-inner${slot.foil ? ' shimmer' : ''}`}>
                        <span className="art" style={{ backgroundImage: slot.card.image ? `url(${slot.card.image})` : undefined }} />
                      </span>
                    </span>
                  </span>
                  <span className="dop-name">{up ? name : ''}</span>
                </button>
              </div>
            )
          })}
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
