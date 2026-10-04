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
