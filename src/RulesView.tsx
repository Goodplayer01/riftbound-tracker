import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import { t, type Lang } from './i18n'
import { loadRules, searchRules, searchWords, type Rule, type RulesFile } from './rules'
import { SearchInput } from './SearchInput'

/** Search results shown at most; the full list has no limit. */
const MAX_HITS = 400

/** Text with the search words marked. */
function marked(text: string, words: string[]): ReactNode {
  if (!words.length) return text
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))
}

/** "Da Rules": the official Core and Tournament Rules with search. */
export function RulesView({ lang, openLink }: { lang: Lang; openLink: (url: string) => void }) {
  const [file, setFile] = useState<RulesFile | null>(null)
  const [failed, setFailed] = useState(false)
  const [docId, setDocId] = useState('core')
  const [query, setQuery] = useState('')
  const [jumpTo, setJumpTo] = useState<string | null>(null)
  const q = useDeferredValue(query)

  useEffect(() => {
    let alive = true
    loadRules().then((f) => {
      if (!alive) return
      setFile(f)
      setFailed(!f)
    })
    return () => { alive = false }
  }, [])

  const doc = file?.docs.find((d) => d.id === docId) ?? file?.docs[0]
  const words = useMemo(() => searchWords(q), [q])
  const hits = useMemo(() => (doc ? searchRules(doc.rules, q) : []), [doc, q])
  const searching = words.length > 0
  const shown = searching ? hits.slice(0, MAX_HITS) : hits

  // "Show in context": back to the full list, then scroll to the rule once it is rendered.
  useEffect(() => {
    if (!jumpTo || searching) return
    const el = document.getElementById(`rule-${docId}-${jumpTo}`)
    // Center keeps the rule clear of the sticky search bar.
    el?.scrollIntoView({ block: 'center' })
    el?.classList.add('flash')
    const timer = window.setTimeout(() => el?.classList.remove('flash'), 1600)
    setJumpTo(null)
    return () => window.clearTimeout(timer)
  }, [jumpTo, searching, docId])

  const ruleRow = (r: Rule) => (
    <div
      key={r.n}
      id={`rule-${doc?.id}-${r.n}`}
      className={`rule-row${r.h ? ' rule-head' : ''}`}
      style={{ paddingLeft: `${Math.min(r.n.split('.').length - 1, 4) * 18}px` }}
    >
      <button
        type="button"
        className="rule-num"
        title={searching ? t(lang, 'rules.context') : undefined}
        onClick={() => { if (searching) { setQuery(''); setJumpTo(r.n) } }}
      >{r.n}</button>
      <div className="rule-text">
        {r.t.split('\n').map((p, i) => (
          <p key={i} className={/^Example\b/.test(p) ? 'rule-example' : undefined}>{marked(p, words)}</p>
        ))}
      </div>
    </div>
  )

  return (
    <div className="rules-page">
      <div className="toolbar">
        <div className="grow">
          <h2 className="section-title">{t(lang, 'tab.rules')}</h2>
          <p className="help" style={{ margin: 0 }}>{t(lang, 'rules.help')}</p>
        </div>
      </div>
      {!file ? (
        <div className="panel empty">{t(lang, failed ? 'rules.failed' : 'rules.loading')}</div>
      ) : (
        <>
          {/* Stays on top while scrolling, so the search is always one click away. */}
          <div className="rules-sticky">
          <div className="toolbar rules-toolbar">
            <div className="stores-view-switch" role="tablist" style={{ margin: 0 }}>
              {file.docs.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  role="tab"
                  aria-selected={doc?.id === d.id}
                  className={`chip${doc?.id === d.id ? ' active' : ''}`}
                  onClick={() => setDocId(d.id)}
                >{d.title}</button>
              ))}
            </div>
            <SearchInput
              lang={lang}
              wrapClassName="grow"
              value={query}
              onChange={setQuery}
              placeholder={t(lang, 'rules.search')}
              autoFocus
            />
          </div>
          {doc && (
            <div className="rules-meta muted">
              <span>{t(lang, 'rules.updated', { date: doc.lastUpdated })}</span>
              <span>· {searching ? t(lang, 'rules.hits', { n: hits.length }) : t(lang, 'rules.count', { n: doc.rules.length })}</span>
              <button type="button" className="link-btn" onClick={() => openLink(doc.url)}>
                <Icon name="external-link" size={13} /> {t(lang, 'rules.pdf')}
              </button>
            </div>
          )}
          </div>
          <div className="panel rules-list">
            {shown.map(ruleRow)}
            {searching && hits.length === 0 && <div className="empty">{t(lang, 'rules.none')}</div>}
            {searching && hits.length > MAX_HITS && <div className="empty">{t(lang, 'rules.more', { n: hits.length - MAX_HITS })}</div>}
          </div>
        </>
      )}
    </div>
  )
}
