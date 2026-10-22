import { useMemo, useState, type MouseEvent } from 'react'
import { Icon } from './Icon'
import { fmtEur, t, type Lang } from './i18n'
import { valueAt, type PricePoint } from './priceHistory'
import type { Collection } from './storage'
import type { Card } from './types'

type Range = '30' | '90' | '365' | 'all'

type Mover = { card: Card; foil: boolean; copies: number; from: number; to: number; delta: number }

/** Copies of one card with a purchase price: what they cost and what they are worth today. */
export type InvestRow = { card: Card; copies: number; paid: number; worth: number }

const W = 760
const H = 220
const PAD = { top: 16, right: 16, bottom: 26, left: 64 }

function fmtDate(lang: Lang, at: string, withYear = false) {
  return new Date(at).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', withYear
    ? { day: 'numeric', month: 'short', year: 'numeric' }
    : { day: 'numeric', month: 'short' })
}

function pct(from: number, to: number) {
  if (from <= 0) return null
  return ((to - from) / from) * 100
}

function fmtPct(lang: Lang, p: number | null) {
  if (p == null) return ''
  const s = new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-GB', { maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(p)
  return `${s} %`
}

function fmtSigned(lang: Lang, n: number) {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtEur(lang, Math.abs(n))}`
}

export function ValueHistory(props: {
  lang: Lang
  points: PricePoint[]
  collection: Collection
  /** Copies weighted by condition (an EX copy counts 0.85), for the value line. */
  weighted: Collection
  byId: Map<string, Card>
  invest: { copies: number; paid: number; worth: number; rows: InvestRow[] }
  onBack: () => void
  onOpenCard: (c: Card) => void
}) {
  const { lang, points, collection, byId } = props
  const [range, setRange] = useState<Range>('90')
  const [hover, setHover] = useState<number | null>(null)

  const shown = useMemo(() => {
    if (range === 'all' || points.length === 0) return points
    const last = Date.parse(points[points.length - 1].at)
    const cut = last - Number(range) * 86400000
    const inRange = points.filter((p) => Date.parse(p.at) >= cut)
    // Keep the last point before the window so the line starts at the left edge of the range.
    const before = points.filter((p) => Date.parse(p.at) < cut).pop()
    return before ? [before, ...inRange] : inRange
  }, [points, range])

  const series = useMemo(() => shown.map((p) => ({ at: p.at, eur: valueAt(p, props.weighted) })), [shown, props.weighted])

  const movers = useMemo(() => {
    if (shown.length < 2) return { up: [] as Mover[], down: [] as Mover[] }
    const first = shown[0]
    const last = shown[shown.length - 1]
    const all: Mover[] = []
    for (const [id, o] of Object.entries(collection)) {
      const card = byId.get(id)
      if (!card) continue
      for (const foil of [false, true]) {
        const copies = foil ? o.foil : o.qty
        if (!copies) continue
        const from = foil ? first.f[id] ?? first.n[id] : first.n[id]
        const to = foil ? last.f[id] ?? last.n[id] : last.n[id]
        if (from == null || to == null || from === to) continue
        all.push({ card, foil, copies, from, to, delta: (to - from) * copies })
      }
    }
    all.sort((a, b) => b.delta - a.delta)
    return {
      up: all.filter((m) => m.delta > 0).slice(0, 8),
      down: all.filter((m) => m.delta < 0).reverse().slice(0, 8),
    }
  }, [shown, collection, byId])

  const now = series[series.length - 1]?.eur ?? 0
  const start = series[0]?.eur ?? 0
  const change = now - start

  const chart = useMemo(() => {
    if (series.length < 2) return null
    const t0 = Date.parse(series[0].at)
    const t1 = Date.parse(series[series.length - 1].at)
    let lo = Math.min(...series.map((s) => s.eur))
    let hi = Math.max(...series.map((s) => s.eur))
    if (hi - lo < 1) { lo -= 1; hi += 1 }
    const padY = (hi - lo) * 0.1
    lo = Math.max(0, lo - padY)
    hi += padY
    const x = (at: string) => PAD.left + ((Date.parse(at) - t0) / Math.max(1, t1 - t0)) * (W - PAD.left - PAD.right)
    const y = (eur: number) => PAD.top + (1 - (eur - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom)
    const pts = series.map((s) => ({ x: x(s.at), y: y(s.eur), ...s }))
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${H - PAD.bottom} L${pts[0].x.toFixed(1)},${H - PAD.bottom} Z`
    const ticks = [0, 0.5, 1].map((f) => lo + (hi - lo) * f)
    return { pts, line, area, ticks, y }
  }, [series])

  function onMove(e: MouseEvent<SVGSVGElement>) {
    if (!chart) return
    const box = e.currentTarget.getBoundingClientRect()
    const mx = ((e.clientX - box.left) / box.width) * W
    let best = 0
    chart.pts.forEach((p, i) => { if (Math.abs(p.x - mx) < Math.abs(chart.pts[best].x - mx)) best = i })
    setHover(best)
  }

  const investLists = useMemo(() => {
    const rows = [...props.invest.rows].sort((a, b) => (b.worth - b.paid) - (a.worth - a.paid))
    return {
      up: rows.filter((r) => r.worth - r.paid >= 0).slice(0, 10),
      down: rows.filter((r) => r.worth - r.paid < 0).reverse().slice(0, 10),
    }
  }, [props.invest])

  function investList(title: string, list: InvestRow[], cls: string) {
    return (
      <section className="panel value-movers">
        <h3>{title}</h3>
        {list.length === 0 && <div className="empty">{t(lang, 'invest.none')}</div>}
        {list.map((r) => (
          <button key={r.card.id} type="button" className="mover-row" onClick={() => props.onOpenCard(r.card)}>
            {r.card.image ? <img src={r.card.image} alt="" loading="lazy" /> : <span className="mover-img" />}
            <span className="mover-name">
              <b>{r.card.name}</b>
              <span className="sub">{r.card.code} · {r.copies}x</span>
            </span>
            <span className="mover-price">
              <span className="sub">{fmtEur(lang, r.paid)} → {fmtEur(lang, r.worth)}</span>
              <b className={cls}>{fmtSigned(lang, r.worth - r.paid)} <span className="sub">{fmtPct(lang, pct(r.paid, r.worth))}</span></b>
            </span>
          </button>
        ))}
      </section>
    )
  }

  const hp = chart && hover != null ? chart.pts[hover] : null

  function moverList(title: string, list: Mover[], cls: string) {
    return (
      <section className="panel value-movers">
        <h3>{title}</h3>
        {list.length === 0 && <div className="empty">{t(lang, 'value.noMovers')}</div>}
        {list.map((m) => (
          <button key={`${m.card.id}-${m.foil}`} type="button" className="mover-row" onClick={() => props.onOpenCard(m.card)}>
            {m.card.image ? <img src={m.card.image} alt="" loading="lazy" /> : <span className="mover-img" />}
            <span className="mover-name">
              <b>{m.card.name}</b>
              <span className="sub">{m.card.code}{m.foil ? ' · Foil' : ''} · {m.copies}x</span>
            </span>
            <span className="mover-price">
              <span className="sub">{fmtEur(lang, m.from)} → {fmtEur(lang, m.to)}</span>
              <b className={cls}>{fmtSigned(lang, m.delta)} <span className="sub">{fmtPct(lang, pct(m.from, m.to))}</span></b>
            </span>
          </button>
        ))}
      </section>
    )
  }

  return (
    <div className="value-view">
      <div className="toolbar">
        <button className="btn" onClick={props.onBack}><Icon name="arrow-left" />{t(lang, 'collection.back')}</button>
        <h2 style={{ margin: 0 }}>{t(lang, 'value.title')}</h2>
        <span style={{ flex: 1 }} />
        {(['30', '90', '365', 'all'] as const).map((r) => (
          <button key={r} type="button" className={`chip ${range === r ? 'active' : ''}`} onClick={() => setRange(r)}>
            {t(lang, `value.range.${r}`)}
          </button>
        ))}
      </div>

      <section className="panel value-chart-panel">
        <div className="value-stats">
          <div>
            <div className="sub">{t(lang, 'value.now')}</div>
            <div className="value-big">~{fmtEur(lang, now)}</div>
          </div>
          {series.length >= 2 && (
            <div>
              <div className="sub">{t(lang, 'value.since', { date: fmtDate(lang, series[0].at, true) })}</div>
              <div className={`value-big ${change >= 0 ? 'value-up' : 'value-down'}`}>
                {fmtSigned(lang, change)} <span className="value-pct">{fmtPct(lang, pct(start, now))}</span>
              </div>
            </div>
          )}
        </div>
        {chart ? (
          <svg className="value-chart" viewBox={`0 0 ${W} ${H}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={t(lang, 'value.title')}>
            {chart.ticks.map((v) => (
              <g key={v}>
                <line x1={PAD.left} x2={W - PAD.right} y1={chart.y(v)} y2={chart.y(v)} className="value-grid" />
                <text x={PAD.left - 8} y={chart.y(v) + 4} textAnchor="end" className="value-axis">{fmtEur(lang, v)}</text>
              </g>
            ))}
            <text x={PAD.left} y={H - 6} className="value-axis">{fmtDate(lang, series[0].at)}</text>
            <text x={W - PAD.right} y={H - 6} textAnchor="end" className="value-axis">{fmtDate(lang, series[series.length - 1].at)}</text>
            <path d={chart.area} className="value-area" />
            <path d={chart.line} className="value-line" />
            {chart.pts.length <= 40 && chart.pts.map((p) => <circle key={p.at} cx={p.x} cy={p.y} r={3} className="value-dot" />)}
            {hp && (
              <g>
                <line x1={hp.x} x2={hp.x} y1={PAD.top} y2={H - PAD.bottom} className="value-cursor" />
                <circle cx={hp.x} cy={hp.y} r={5} className="value-dot active" />
                <text x={Math.min(Math.max(hp.x, PAD.left + 70), W - PAD.right - 70)} y={PAD.top + 2} textAnchor="middle" className="value-tip">
                  {fmtDate(lang, hp.at, true)}: {fmtEur(lang, hp.eur)}
                </text>
              </g>
            )}
          </svg>
        ) : (
          <p className="help">{t(lang, 'value.tooFew')}</p>
        )}
        <p className="help" style={{ margin: 0 }}>{t(lang, 'value.help')}</p>
      </section>

      <div className="value-movers-row">
        {moverList(t(lang, 'value.up'), movers.up, 'value-up')}
        {moverList(t(lang, 'value.down'), movers.down, 'value-down')}
      </div>

      <section className="panel value-chart-panel">
        <h3 style={{ margin: 0 }}>{t(lang, 'invest.title')}</h3>
        {props.invest.copies > 0 ? (
          <div className="value-stats">
            <div>
              <div className="sub">{t(lang, 'invest.paid', { n: props.invest.copies })}</div>
              <div className="value-big">{fmtEur(lang, props.invest.paid)}</div>
            </div>
            <div>
              <div className="sub">{t(lang, 'invest.worth')}</div>
              <div className="value-big">~{fmtEur(lang, props.invest.worth)}</div>
            </div>
            <div>
              <div className="sub">{t(lang, 'invest.delta')}</div>
              <div className={`value-big ${props.invest.worth >= props.invest.paid ? 'value-up' : 'value-down'}`}>
                {fmtSigned(lang, props.invest.worth - props.invest.paid)} <span className="value-pct">{fmtPct(lang, pct(props.invest.paid, props.invest.worth))}</span>
              </div>
            </div>
          </div>
        ) : null}
        <p className="help" style={{ margin: 0 }}>{t(lang, 'invest.help')}</p>
      </section>
      {props.invest.copies > 0 && (
        <div className="value-movers-row">
          {investList(t(lang, 'invest.up'), investLists.up, 'value-up')}
          {investList(t(lang, 'invest.down'), investLists.down, 'value-down')}
        </div>
      )}
    </div>
  )
}
