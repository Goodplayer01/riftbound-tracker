/// <reference types="vite/client" />

export type UpdaterPayload =
  | { status: 'available'; version: string }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; message: string }

declare global {
  interface Window {
    riftbound?: {
      getVersion: () => Promise<string>
      installUpdate: () => Promise<void>
      onUpdater: (cb: (p: UpdaterPayload) => void) => () => void
    }
  }
}

export {}
