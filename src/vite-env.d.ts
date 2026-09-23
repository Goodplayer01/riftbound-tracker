/// <reference types="vite/client" />

export type UpdaterPayload =
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'not-available'; version?: string }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; message: string }

declare global {
  interface Window {
    riftbound?: {
      getVersion: () => Promise<string>
      installUpdate: () => Promise<void>
      checkForUpdates: () => Promise<{ ok: boolean; dev?: boolean; version?: string; error?: string }>
      onUpdater: (cb: (p: UpdaterPayload) => void) => () => void
      windowMinimize: () => Promise<void>
      windowMaximize: () => Promise<boolean>
      windowIsMaximized: () => Promise<boolean>
      windowClose: () => Promise<void>
      openExternal: (url: string) => Promise<{ ok: boolean }>
    }
  }
}

export {}
