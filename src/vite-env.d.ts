/// <reference types="vite/client" />

export type UpdaterPayload =
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'not-available'; version?: string }
  | { status: 'downloading'; percent: number; version?: string }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; message: string }

export type BackupKind = 'auto' | 'manual' | 'before-import'
export type BackupFileInfo = { name: string; kind: BackupKind; size: number; at: number }

declare global {
  interface Window {
    riftbound?: {
      getVersion: () => Promise<string>
      installUpdate: () => Promise<void>
      downloadUpdate: () => Promise<{ ok: boolean; error?: string }>
      checkForUpdates: () => Promise<{ ok: boolean; dev?: boolean; version?: string; error?: string }>
      onUpdater: (cb: (p: UpdaterPayload) => void) => () => void
      windowMinimize: () => Promise<void>
      windowToggleFullscreen: () => Promise<boolean>
      windowIsFullScreen: () => Promise<boolean>
      onFullscreen: (cb: (isFullScreen: boolean) => void) => () => void
      windowClose: () => Promise<void>
      openExternal: (url: string) => Promise<{ ok: boolean }>
      fetchJson: (url: string) => Promise<{ ok: boolean; data?: unknown; error?: string }>
      cardtrader: (path: string, token: string) => Promise<{ ok: boolean; data?: unknown; error?: string; status?: number }>
      rbEvents: (
        req: { op: 'search'; lat: number; lng: number; distanceMeters: number; after?: string } | { op: 'organizer'; id: string },
      ) => Promise<{ ok: boolean; data?: unknown; error?: string }>
      fetchImageDataUrl: (url: string) => Promise<{ ok: boolean; dataUrl?: string; error?: string }>
      backupList: () => Promise<{ ok: boolean; dir: string; files: BackupFileInfo[] }>
      backupWrite: (kind: BackupKind, text: string) => Promise<{ ok: boolean; name?: string; skipped?: boolean; error?: string }>
      backupRead: (name: string) => Promise<{ ok: boolean; text?: string; error?: string }>
      backupExportAs: (text: string) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>
      backupImportFile: () => Promise<{ ok: boolean; name?: string; text?: string; canceled?: boolean; error?: string }>
      backupOpenFolder: () => Promise<{ ok: boolean }>
    }
  }
}

export {}
