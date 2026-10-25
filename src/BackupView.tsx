import { useEffect, useMemo, useState } from 'react'
import { BACKUP_GROUPS, isEmptyBackup, makeBackup, parseBackup, restoreBackup, sameGroup, summarizeBackup, type BackupFile, type BackupGroup, type BackupSummary } from './backup'
import { t, type Lang } from './i18n'
import { Icon } from './Icon'
import type { BackupFileInfo, BackupKind } from './vite-env'

type Listed = BackupFileInfo & { summary: BackupSummary | null }
type Confirm = { label: string; file: BackupFile; summary: BackupSummary; same: Record<BackupGroup, boolean> }

/** Parts just restored, kept across the reload so the Backup tab can say what happened. */
const IMPORT_DONE_KEY = 'rb.importDone'

/** The app opens on the Backup tab right after an import. */
export function importJustDone() {
  try {
    return sessionStorage.getItem(IMPORT_DONE_KEY) != null
  } catch {
    return false
  }
}

async function currentJson() {
  const version = (await window.riftbound?.getVersion().catch(() => '')) || ''
  return JSON.stringify(makeBackup(localStorage, version))
}

/** Once a day at startup; the main process skips it when today's file exists. */
export async function autoBackup() {
  if (!window.riftbound?.backupWrite) return
  try {
    const text = await currentJson()
    // A fresh install has nothing yet: an empty "newest" backup would push the real one down after a reinstall.
    if (isEmptyBackup(JSON.parse(text))) return
    await window.riftbound.backupWrite('auto', text)
  } catch {
    // Not fatal: the next start tries again.
  }
}

const SUMMARY_ROWS: [keyof BackupSummary, string][] = [
  ['cards', 'backup.cards'],
  ['copies', 'backup.copies'],
  ['decks', 'backup.decks'],
  ['wish', 'backup.wish'],
  ['sales', 'backup.sales'],
  ['borrowed', 'backup.borrowed'],
]

/** The main count per part for the now / file comparison; "other" has none. */
const GROUP_COUNT: Record<BackupGroup, keyof BackupSummary | null> = {
  collection: 'cards', decks: 'decks', wish: 'wish', sales: 'sales', borrowed: 'borrowed', other: null,
}

export function BackupView({ lang, skip }: { lang: Lang; skip: (id: string) => boolean }) {
  const api = window.riftbound
  const [dir, setDir] = useState('')
  const [files, setFiles] = useState<Listed[] | null>(null)
  const [notice, setNotice] = useState<{ error?: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  /** Parts to replace. Starts empty: nothing is overwritten unless it was ticked on purpose. */
  const [picked, setPicked] = useState<ReadonlySet<BackupGroup>>(new Set())
  const now = useMemo(() => summarizeBackup(makeBackup(localStorage, ''), skip), [skip])
  const fmtDate = (ms: number | string) =>
    new Date(ms).toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })
  const summaryLine = (s: BackupSummary) =>
    SUMMARY_ROWS.filter(([k]) => k !== 'copies').map(([k, key]) => `${s[k].toLocaleString(lang)} ${t(lang, key)}`).join(' · ')

  async function load() {
    if (!api?.backupList) return
    const res = await api.backupList()
    setDir(res.dir)
    const listed: Listed[] = []
    for (const f of res.files) {
      const r = await api.backupRead(f.name)
      const b = r.ok && r.text ? parseBackup(r.text) : 'invalid'
      listed.push({ ...f, summary: typeof b === 'string' ? null : summarizeBackup(b, skip) })
    }
    setFiles(listed)
  }

  useEffect(() => {
    void load()
    // Right after an import (the app reloaded): say which parts were replaced.
    try {
      const done = JSON.parse(sessionStorage.getItem(IMPORT_DONE_KEY) || 'null') as BackupGroup[] | null
      sessionStorage.removeItem(IMPORT_DONE_KEY)
      if (done) setNotice({ text: t(lang, 'backup.imported', { parts: done.map((g) => t(lang, `backup.group.${g}`)).join(', ') }) })
    } catch {
      // No message then; the import itself is done.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function ask(label: string, text: string) {
    const b = parseBackup(text)
    if (typeof b === 'string') {
      setNotice({ error: true, text: t(lang, b === 'newer' ? 'backup.newer' : 'backup.invalid', { name: label }) })
      return
    }
    setPicked(new Set())
    const same = Object.fromEntries(BACKUP_GROUPS.map((g) => [g, sameGroup(localStorage, b, g)])) as Record<BackupGroup, boolean>
    setConfirm({ label, file: b, summary: summarizeBackup(b, skip), same })
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setNotice(null)
    try {
      await fn()
    } catch (e) {
      setNotice({ error: true, text: t(lang, 'backup.failed', { error: String(e) }) })
    } finally {
      setBusy(false)
    }
  }

  const backupNow = () => run(async () => {
    const r = await api!.backupWrite('manual', await currentJson())
    if (!r.ok) throw new Error(r.error)
    setNotice({ text: t(lang, 'backup.saved') })
    await load()
  })

  const exportAs = () => run(async () => {
    const r = await api!.backupExportAs(await currentJson())
    if (r.canceled) return
    if (!r.ok) throw new Error(r.error)
    setNotice({ text: t(lang, 'backup.exported', { path: r.path ?? '' }) })
  })

  const importFile = () => run(async () => {
    const r = await api!.backupImportFile()
    if (r.canceled) return
    if (!r.ok || r.text == null) throw new Error(r.error)
    ask(r.name ?? '', r.text)
  })

  /** New folder for the backups. If it already holds some (the old folder after a reinstall),
   *  the newest opens in the usual replace dialog, so it never loads without asking. */
  const chooseFolder = () => run(async () => {
    const r = await api!.backupChooseFolder()
    if (r.canceled) return
    if (!r.ok) throw new Error(r.error)
    await load()
    const newest = r.files?.[0]
    if (!newest) {
      setNotice({ text: t(lang, 'backup.folderSet', { dir: r.dir ?? '' }) })
      return
    }
    const f = await api!.backupRead(newest.name)
    if (!f.ok || f.text == null) throw new Error(f.error)
    ask(kindLabel(newest.kind), f.text)
  })

  const restoreListed = (f: Listed) => run(async () => {
    const r = await api!.backupRead(f.name)
    if (!r.ok || r.text == null) throw new Error(r.error)
    ask(kindLabel(f.kind), r.text)
  })

  /** The current state goes to a before-import file first; if that fails nothing is overwritten. */
  const applyRestore = () => run(async () => {
    if (!confirm || picked.size === 0) return
    const pre = makeBackup(localStorage, (await api!.getVersion().catch(() => '')) || '')
    // An empty app (fresh install) has nothing to lose, and an empty file would become the newest one.
    if (!isEmptyBackup(pre)) {
      const saved = await api!.backupWrite('before-import', JSON.stringify(pre))
      if (!saved.ok) throw new Error(saved.error)
    }
    try {
      restoreBackup(localStorage, confirm.file, picked)
    } catch (e) {
      restoreBackup(localStorage, pre)
      throw e
    }
    try {
      sessionStorage.setItem(IMPORT_DONE_KEY, JSON.stringify([...picked]))
    } catch {
      // Only the message after the reload is lost.
    }
    location.reload()
  })

  const kindLabel = (k: BackupKind) => t(lang, `backup.kind.${k}`)
  const kindIcon = { auto: 'refresh-cw', manual: 'check', 'before-import': 'rotate-ccw' } as const

  return (
    <>
      <div className="toolbar">
        <div className="grow">
          <h2 className="section-title">{t(lang, 'backup.title')}</h2>
          <p className="help" style={{ margin: 0 }}>{t(lang, 'backup.help')}</p>
        </div>
      </div>
      {!api?.backupList ? (
        <p className="help">{t(lang, 'backup.desktopOnly')}</p>
      ) : (
        <>
          <div className="backup-actions">
            <div className="panel backup-action">
              <Icon name="download" size={22} />
              <h3>{t(lang, 'backup.exportTitle')}</h3>
              <p className="help">{t(lang, 'backup.exportHelp')}</p>
              <button type="button" className="btn primary" disabled={busy} onClick={exportAs}><Icon name="file-down" />{t(lang, 'backup.export')}</button>
            </div>
            <div className="panel backup-action replace">
              <Icon name="upload" size={22} />
              <h3>{t(lang, 'backup.importTitle')}</h3>
              <p className="help">{t(lang, 'backup.importHelp')}</p>
              <button type="button" className="btn danger" disabled={busy} onClick={importFile}><Icon name="file-up" />{t(lang, 'backup.import')}</button>
            </div>
            <div className="panel backup-action">
              <Icon name="database-backup" size={22} />
              <h3>{t(lang, 'backup.nowTitle')}</h3>
              <p className="help">{t(lang, 'backup.nowHelp')}</p>
              <button type="button" className="btn" disabled={busy} onClick={backupNow}><Icon name="check" />{t(lang, 'backup.now')}</button>
            </div>
          </div>
          {notice && (
            <div className={`backup-notice${notice.error ? ' error' : ''}`} role="status">
              <span>{notice.text}</span>
              <button type="button" className="btn small" onClick={() => setNotice(null)}><Icon name="x" /></button>
            </div>
          )}
          <div className="panel backup-files">
            <div className="backup-files-head">
              <div className="backup-count">
                <b>{files?.length ?? '…'}</b>
                <span>{t(lang, 'backup.count')}</span>
              </div>
              <div className="grow">
                <div>{files?.[0] ? t(lang, 'backup.last', { date: fmtDate(files[0].at) }) : t(lang, 'backup.none')}</div>
                <small className="muted" title={dir}>{dir}</small>
              </div>
              <button type="button" className="btn" disabled={busy} title={t(lang, 'backup.chooseFolderHint')} onClick={chooseFolder}><Icon name="folder-open" />{t(lang, 'backup.chooseFolder')}</button>
              <button type="button" className="btn" onClick={() => void api.backupOpenFolder()}><Icon name="external-link" />{t(lang, 'backup.openFolder')}</button>
            </div>
            <p className="help">{t(lang, 'backup.keep')}</p>
            {files?.map((f) => (
              <div key={f.name} className="backup-row">
                <span className={`backup-kind ${f.kind}`}><Icon name={kindIcon[f.kind]} size={13} />{kindLabel(f.kind)}</span>
                <b className="backup-date">{fmtDate(f.at)}</b>
                <span className="backup-sum">{f.summary ? summaryLine(f.summary) : t(lang, 'backup.unreadable')}</span>
                <span className="muted backup-size">{(f.size / 1024).toLocaleString(lang, { maximumFractionDigits: 0 })} KB</span>
                <button type="button" className="btn small" disabled={busy || !f.summary} onClick={() => restoreListed(f)}>
                  <Icon name="rotate-ccw" />{t(lang, 'backup.restore')}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {confirm && (
        <div className="card-lightbox" role="dialog" aria-modal="true" aria-labelledby="backup-confirm-title" onClick={() => !busy && setConfirm(null)}>
          <div className="panel confirm-box backup-confirm" onClick={(e) => e.stopPropagation()}>
            <h2 id="backup-confirm-title">{t(lang, 'backup.confirmTitle')}</h2>
            <p className="help" style={{ margin: 0 }}>
              {t(lang, 'backup.confirmText', { name: confirm.label, date: confirm.file.at ? fmtDate(confirm.file.at) : '?' })}
            </p>
            <table className="backup-compare">
              <thead>
                <tr>
                  <th>
                    <label className="backup-pick">
                      <input
                        type="checkbox"
                        checked={picked.size === BACKUP_GROUPS.length}
                        ref={(el) => { if (el) el.indeterminate = picked.size > 0 && picked.size < BACKUP_GROUPS.length }}
                        onChange={(e) => setPicked(new Set(e.target.checked ? BACKUP_GROUPS : []))}
                      />
                      {t(lang, 'backup.pickAll')}
                    </label>
                  </th>
                  <th>{t(lang, 'backup.now.col')}</th>
                  <th>{t(lang, 'backup.file.col')}</th>
                </tr>
              </thead>
              <tbody>
                {BACKUP_GROUPS.map((g) => {
                  const k = GROUP_COUNT[g]
                  const count = (s: BackupSummary) => (!k ? '—' : g === 'collection'
                    ? t(lang, 'backup.cardsCopies', { cards: s.cards.toLocaleString(lang), copies: s.copies.toLocaleString(lang) })
                    : s[k].toLocaleString(lang))
                  return (
                    <tr key={g} className={`${picked.has(g) ? 'picked' : ''}${k && now[k] > confirm.summary[k] ? ' less' : ''}`}>
                      <th>
                        <label className="backup-pick" title={g === 'other' ? t(lang, 'backup.otherHint') : undefined}>
                          <input
                            type="checkbox"
                            checked={picked.has(g)}
                            onChange={(e) => setPicked((p) => {
                              const n = new Set(p)
                              if (e.target.checked) n.add(g)
                              else n.delete(g)
                              return n
                            })}
                          />
                          {t(lang, `backup.group.${g}`)}
                          {confirm.same[g] && <span className="backup-same" title={t(lang, 'backup.sameHint')}>{t(lang, 'backup.same')}</span>}
                        </label>
                      </th>
                      <td>{count(now)}</td>
                      <td>{count(confirm.summary)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {picked.size > 0 && [...picked].every((g) => confirm.same[g]) && (
              <p className="backup-same-note">{t(lang, 'backup.allSame')}</p>
            )}
            <p className="help" style={{ margin: 0 }}>{t(lang, 'backup.confirmSafe')}</p>
            <div className="confirm-actions">
              <button type="button" className="btn small" disabled={busy} onClick={() => setConfirm(null)}><Icon name="x" />{t(lang, 'decks.clearCancel')}</button>
              <button
                type="button"
                className="btn small deck-trash"
                disabled={busy || picked.size === 0}
                title={picked.size === 0 ? t(lang, 'backup.pickFirst') : undefined}
                onClick={applyRestore}
              ><Icon name="file-up" />{t(lang, 'backup.confirmReplace', { n: picked.size })}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
