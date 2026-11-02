import { SHARE_MAX_BYTES, SHARE_MAX_PIXELS, dataUrlBytes, shareScale } from '../src/deckScreenshot.ts'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// Small layouts keep the crisp 3× scale; big ones drop just enough to stay at 16 megapixels.
assert(shareScale(1000, 700) === 3, 'small layout keeps 3x')
const s = shareScale(1600, 1300)
assert(s < 3 && Math.floor(1600 * s) * Math.floor(1300 * s) <= SHARE_MAX_PIXELS, `big layout fits 16 MP: ${s}`)
assert(SHARE_MAX_PIXELS === 16_000_000 && SHARE_MAX_BYTES === 8_000_000, 'limits')

// Decoded size of a base64 data URL, padding included.
const url = (bytes) => 'data:image/png;base64,' + Buffer.alloc(bytes, 7).toString('base64')
assert([1, 2, 3, 10, 1000].every((n) => dataUrlBytes(url(n)) === n), 'data URL bytes')

console.log('check_share ok')
