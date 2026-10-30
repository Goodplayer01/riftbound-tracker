import { useEffect, useMemo, useState } from 'react'
import { t, type Lang } from './i18n'
import { Icon } from './Icon'
import { daysUntil, loadRoadmap, upcoming, type RoadmapFile, type RoadmapItem } from './roadmap'
import { localDay } from './soldLog'

/** "Dates" view of the Stores tab: Riot's official dates still ahead, soonest first, by month. */
export function RoadmapView({ lang, openLink }: { lang: Lang; openLink: (url: string) => void }) {
  const [file, setFile] = useState<RoadmapFile | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    loadRoadmap().then((f) => {
      if (!alive) return
      setFile(f)
      setFailed(!f)
    })
    return () => { alive = false }
  }, [])

  const locale = lang === 'de' ? 'de-DE' : 'en-GB'
  const today = localDay()
  const months = useMemo(() => {
    const out = new Map<string, RoadmapItem[]>()
    for (const i of upcoming(file?.items ?? [], today)) out.set(i.from.slice(0, 7), [...(out.get(i.from.slice(0, 7)) || []), i])
    return [...out]
  }, [file, today])
  const countries = useMemo(() => new Intl.DisplayNames([locale], { type: 'region' }), [locale])
  const day = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00`).toLocaleDateString(locale, opts)
  const range = (i: RoadmapItem) =>
    i.to && i.to !== i.from ? `${day(i.from, { day: '2-digit', month: '2-digit' })} – ${day(i.to, { day: '2-digit', month: '2-digit' })}` : day(i.from, { weekday: 'short', day: '2-digit', month: '2-digit' })

  return (
    <div className="rules-page roadmap-page">
      <h2 className="section-title">{t(lang, 'roadmap.title')}</h2>
      <p className="help">{t(lang, 'roadmap.help')}</p>
      {!file ? (
        <div className="panel empty">{t(lang, failed ? 'roadmap.failed' : 'roadmap.loading')}</div>
      ) : months.length === 0 ? (
        <div className="panel empty">{t(lang, 'roadmap.empty')}</div>
      ) : (
        months.map(([month, items]) => (
          <section key={month} className="panel roadmap-month" aria-label={month}>
            <h3>{day(`${month}-15`, { month: 'long', year: 'numeric' })}</h3>
            {items.map((i) => {
              const n = daysUntil(i, today)
              const inGermany = i.country === 'DE'
              return (
                <div key={`${i.kind}-${i.name}-${i.from}`} className={`roadmap-row${inGermany ? ' roadmap-home' : ''}`}>
                  <span className="roadmap-date">{range(i)}</span>
                  <span className={`roadmap-kind roadmap-${i.kind}`}>{t(lang, `roadmap.kind.${i.kind}`)}</span>
                  <span className="roadmap-name">
                    <b>{i.name}</b>
                    {(i.city || i.country) && (
                      <small>{[i.city, i.country ? countries.of(i.country) : ''].filter(Boolean).join(', ')}</small>
                    )}
                  </span>
                  <span className="roadmap-when">{n === 0 ? t(lang, i.from < today ? 'roadmap.running' : 'roadmap.today') : t(lang, n === 1 ? 'roadmap.tomorrow' : 'roadmap.inDays', { n })}</span>
                </div>
              )
            })}
          </section>
        ))
      )}
      {file && (
        <p className="rules-meta muted">
          {t(lang, 'roadmap.updated', { date: day(file.updatedAt, { day: '2-digit', month: '2-digit', year: 'numeric' }) })}
          <button type="button" className="link-btn" onClick={() => openLink(file.source)}>
            <Icon name="external-link" size={13} />{t(lang, 'roadmap.source')}
          </button>
        </p>
      )}
    </div>
  )
}
