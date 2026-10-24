import { EVENT_SEARCH_MAX_KM, GERMANY_CIRCLES, eventsToStores, formatEntryFee, isGermanEvent, searchCircles } from '../src/stores.ts'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// Two events of one store, one event of another store; a broken edge without organizer.
const ev = (org, id, startsAt, lat, lng, extra = {}) => ({
  node: {
    organizer: { id: org, name: `Store ${org}` },
    tournament: {
      id,
      name: `Event ${id}`,
      startsAt,
      tournamentLocation: { city: 'Berlin', formattedAddress: `Street ${org}`, latitude: lat, longitude: lng },
      config: { tournamentType: 'NEXUS_NIGHT', participantCapacity: 16 },
      registrantCounts: [{ status: 'REGISTERED', count: 5 }, { status: 'WAITLISTED', count: 2 }],
      entryFee: { currency: 'EUR', minorUnits: 500 },
      ...extra,
    },
  },
})
const stores = eventsToStores([
  ev('a', '2', '2026-10-25T15:00:00Z', 52.53, 13.43),
  ev('b', '3', '2026-10-24T13:00:00Z', 52.43, 13.33),
  ev('a', '1', '2026-10-24T12:00:00Z', 52.53, 13.43),
  ev('a', '1', '2026-10-24T12:00:00Z', 52.53, 13.43),
  { node: { organizer: null, tournament: { id: 'x' } } },
], 52.52, 13.405)

assert(stores.length === 2, 'one store per organizer, broken edges skipped')
assert(stores[0].id === 'a' && stores[0].distanceKm < stores[1].distanceKm, 'nearest store first')
assert(stores[0].events.map((e) => e.id).join() === '1,2', 'events soonest first, duplicates once')
const e = stores[0].events[0]
assert(e.registered === 5 && e.capacity === 16 && e.feeMinor === 500 && e.type === 'NEXUS_NIGHT', 'event fields')
assert(stores[0].address === 'Street a' && stores[0].events.length === 2 && stores[1].events.length === 1, 'store fields')

// German events: by country name in the address, else by position, never a neighbour by name.
assert(isGermanEvent({ formattedAddress: 'Danziger Str. 120, 10407 Berlin, Germany' }), 'Germany by name')
assert(isGermanEvent({ formattedAddress: 'Badstraße 4, 13357 Berlin', latitude: 52.55, longitude: 13.38 }), 'no country: inside the box')
assert(!isGermanEvent({ formattedAddress: 'Hauptstraße 1, 6020 Innsbruck, Österreich', latitude: 47.27, longitude: 11.39 }), 'Austria inside the box')
assert(!isGermanEvent({ formattedAddress: 'Rue 1, 75001 Paris', latitude: 48.86, longitude: 2.35 }), 'outside the box')
assert(!isGermanEvent(null), 'no location')

// The event search only reaches ~160 km: circles must cover the whole area.
const km = (a, b) => {
  const r = Math.PI / 180
  const s = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(s))
}
const covered = (circles, p) => circles.some((c) => km(c, p) <= EVENT_SEARCH_MAX_KM - 10)
for (let lat = 47.3; lat <= 55.05; lat += 0.25) {
  for (let lng = 5.9; lng <= 15.0; lng += 0.25) assert(covered(GERMANY_CIRCLES, { lat, lng }), `Germany gap at ${lat},${lng}`)
}
assert(searchCircles(52.5, 13.4, 100).length === 1, 'one circle up to 160 km')
const big = searchCircles(52.5, 13.4, 250)
for (let a = 0; a < 360; a += 15) {
  for (const d of [100, 200, 250]) {
    const p = { lat: 52.5 + (d * Math.cos(a * Math.PI / 180)) / 111.32, lng: 13.4 + (d * Math.sin(a * Math.PI / 180)) / (111.32 * Math.cos(52.5 * Math.PI / 180)) }
    assert(covered(big, p), `250 km gap at ${a}° ${d} km`)
  }
}

// Entry fees: 0 is free, unknown currency codes never throw, currencies keep their own decimals.
assert(formatEntryFee(0, 'EUR', 'de-DE') === null && formatEntryFee(null, 'EUR', 'de-DE') === null, 'free')
assert(/5,00/.test(formatEntryFee(500, 'EUR', 'de-DE')), 'EUR cents')
assert(/1,000|1\.000/.test(formatEntryFee(1000, 'JPY', 'en-US')), 'JPY has no decimals')
assert(formatEntryFee(1250, 'not a code', 'de-DE') === '12.50 not a code', 'bad currency does not throw')

console.log('ok')
