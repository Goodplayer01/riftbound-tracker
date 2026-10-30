const REMOTE_BASE = 'https://raw.githubusercontent.com/Goodplayer01/riftbound-tracker/main/public/'
const REMOTE_TIMEOUT_MS = 10000

async function getJson<T>(url: string | URL, isValid: (x: unknown) => x is T, init?: RequestInit) {
  const r = await fetch(url, init)
  if (!r.ok) return null
  const data = await r.json()
  return isValid(data) ? data : null
}

/** A data file from public/, live from main so new data reaches every app without a release; the bundled
 *  copy when offline or when the live file does not pass `isValid`. */
export async function loadLiveJson<T>(file: string, isValid: (x: unknown) => x is T): Promise<T | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REMOTE_TIMEOUT_MS)
  try {
    const remote = await getJson(REMOTE_BASE + file, isValid, { cache: 'no-cache', signal: ctrl.signal })
    if (remote) return remote
  } catch {
    // offline: fall through to the bundled copy
  } finally {
    clearTimeout(timer)
  }
  try {
    return await getJson(new URL(file, window.location.href), isValid)
  } catch {
    return null
  }
}
