/** public/roadmap.json: Riot's official dates (set releases, Pre-Rift weeks, Regionals, Continentals,
 *  Showdowns, Summoner Skirmish, conventions) from the playriftbound.com roadmap article, kept by hand.
 *  Loaded live from main like the rules, so a new date needs a commit, not a release. */

import { loadLiveJson } from './liveJson.ts'

export const ROADMAP_KINDS = ['release', 'prerift', 'skirmish', 'regional', 'continental', 'showdown', 'convention'] as const
export type RoadmapKind = (typeof ROADMAP_KINDS)[number]
/** One date: `from` (and `to` for several days) as YYYY-MM-DD, local to the event's place. */
export type RoadmapItem = { kind: RoadmapKind; name: string; from: string; to?: string; city?: string; country?: string }
export type RoadmapFile = { updatedAt: string; source: string; items: RoadmapItem[] }

const DAY = /^\d{4}-\d{2}-\d{2}$/

export function isRoadmapItem(x: unknown): x is RoadmapItem {
  const i = x as RoadmapItem
  return !!i && (ROADMAP_KINDS as readonly string[]).includes(i.kind) && typeof i.name === 'string' && !!i.name.trim()
    && DAY.test(i.from) && (i.to == null || (DAY.test(i.to) && i.to >= i.from))
    && (i.country == null || /^[A-Z]{2}$/.test(i.country))
}

export function isRoadmapFile(x: unknown): x is RoadmapFile {
  const f = x as RoadmapFile
  return !!f && typeof f.source === 'string' && Array.isArray(f.items) && f.items.length > 0 && f.items.every(isRoadmapItem)
}

/** Live copy from main, the bundled file when offline. */
export function loadRoadmap(): Promise<RoadmapFile | null> {
  return loadLiveJson('roadmap.json', isRoadmapFile)
}

/** Dates not over yet (running ones included), soonest first. `today` is YYYY-MM-DD. */
export function upcoming(items: RoadmapItem[], today: string) {
  return items.filter((i) => (i.to ?? i.from) >= today).sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name))
}

/** Whole days from `today` to the start; 0 while it runs. */
export function daysUntil(item: RoadmapItem, today: string) {
  const d = (Date.parse(`${item.from}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000
  return Math.max(0, Math.round(d))
}
