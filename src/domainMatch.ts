/** OR domain filter: empty selection means no filter. */
export function cardMatchesDomains(domains: string[] | undefined, selected: string[]): boolean {
  if (selected.length === 0) return true
  return (domains || []).some((d) => selected.includes(d))
}

/** Move fromId to toId's index. Same id or unknown id returns the same array. */
export function moveDeck<T extends { id: string }>(list: T[], fromId: string, toId: string): T[] {
  if (!fromId || fromId === toId) return list
  const i = list.findIndex((x) => x.id === fromId)
  const j = list.findIndex((x) => x.id === toId)
  if (i < 0 || j < 0) return list
  const next = list.slice()
  const [item] = next.splice(i, 1)
  next.splice(j, 0, item)
  return next
}

/** Post-removal index for a vertical drop. pointerY uses the same origin as row tops. */
export function deckDropIndex(
  pointerY: number,
  rows: { top: number; height: number }[],
  from: number,
): number {
  const drag = rows[from]
  if (!drag || rows.length === 0) return 0
  const gap = rows.length > 1 ? rows[1].top - (rows[0].top + rows[0].height) : 0
  let to = 0
  for (let i = 0; i < rows.length; i++) {
    if (i === from) continue
    const top = rows[i].top + (i > from ? -(drag.height + gap) : 0)
    if (pointerY > top + rows[i].height / 2) to++
  }
  return to
}

/** Insert fromId at a post-removal index. Same place or unknown id returns the same array. */
export function moveDeckTo<T extends { id: string }>(list: T[], fromId: string, toIndex: number): T[] {
  const i = list.findIndex((x) => x.id === fromId)
  if (i < 0) return list
  const next = list.slice()
  const [item] = next.splice(i, 1)
  const dest = Math.max(0, Math.min(next.length, toIndex))
  if (dest === i) return list
  next.splice(dest, 0, item)
  return next
}
