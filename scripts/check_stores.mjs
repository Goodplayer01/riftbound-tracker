import { eventsToStores } from '../src/stores.ts'

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

console.log('ok')
