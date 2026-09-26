export type Lang = 'de' | 'en'

const STORAGE_KEY = 'riftbound-lang'

export function loadLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'en' || v === 'de') return v
  } catch {
    /* ignore */
  }
  return 'de'
}

export function saveLang(lang: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    /* ignore */
  }
}

type Vars = Record<string, string | number>

const de: Record<string, string> = {
  'tab.collection': 'Sammlung',
  'tab.catalog': 'Katalog',
  'tab.sales': 'Verkauf',
  'tab.bulk': 'Codes',
  'tab.decks': 'Decks',

  'stats.line': '{unique} Unique | {copies} Kopien | {catalog} im Katalog',
  'stats.valueTitle': 'Schätzung: Owned * ab (Low) + Foil * FoilLow (EUR, Cardmarket)',
  'stats.restart': 'Neustart',

  'update.checking': 'Suche Updates...',
  'update.available': 'Update {version}...',
  'update.downloaded': 'Update bereit {version}',
  'update.error': 'Update-Fehler',
  'update.titleChecking': 'Suche nach Updates...',
  'update.titleAvailable': 'Update {version} verfügbar',
  'update.titleDownloaded': 'Update {version} bereit - Neustart',
  'update.titleNotAvailable': 'Keine Updates - aktuell',
  'update.titleIdle': 'Nach Updates suchen',

  'win.minimize': 'Minimieren',
  'win.maximize': 'Maximieren',
  'win.restore': 'Wiederherstellen',
  'win.close': 'Schließen',

  'load.error': 'Fehler: {message}',
  'load.catalog': 'Lade Riftbound-Katalog...',

  'collection.title': 'Sammlung',
  'collection.help': 'Set-Binder öffnen, um Karten zu browsen und zu verwalten.',
  'collection.byRarity': 'Nach Seltenheit',
  'collection.filterRarity': '{rarity} filtern',
  'collection.clearFilter': 'Filter entfernen',
  'collection.allOwned': 'Alle Owned',
  'collection.allOwnedHelp': 'Nur besessene Karten (alte Sammlung)',
  'collection.back': 'Zurück',
  'collection.search': 'Suche Name, Code, Domain...',
  'collection.ownedOnly': 'Owned only',
  'collection.missing': 'Missing',
  'collection.emptyNone': 'Noch keine Karten. Geh zu Bulk oder Katalog und füge welche hinzu.',
  'collection.emptyFilter': 'Keine Karten für diese Filter.',
  'collection.domainClear': '{domain} Filter entfernen',
  'collection.domainTitle': 'Domain {domain}',

  'catalog.allSets': 'Alle Sets',
  'catalog.allTypes': 'Alle Typen',
  'catalog.ownedOnly': 'nur Owned',
  'catalog.csvExport': 'CSV Export',
  'catalog.csvImport': 'CSV Import',
  'catalog.csvImported': 'CSV importiert ({name})',

  'price.openCm': 'Auf Cardmarket öffnen',
  'price.low': 'Niedrigster Preis (ab)',
  'price.high': 'Höchster Preis',
  'price.avg30': '30-Tage-Durchschnitt',
  'price.foil': 'Foil Low',
  'qty.normal': 'Normal',
  'qty.foil': 'Foil',

  'sales.cart': 'Warenkorb',
  'sales.help': 'Karten zum Verkauf — auswählen, Mengen anpassen, dann nur die markierten als verkauft markieren.',
  'sales.selected': ' Ausgewählt: {cards} {cardWord} ({copies} {copyWord}).',
  'sales.markSold': 'Als verkauft markieren',
  'sales.pickFirst': 'Zuerst Karten per Checkbox auswählen',
  'sales.emptyCart': 'Warenkorb leer. Rechts owned Karten suchen, ziehen oder Liste einfügen.',
  'sales.selectForSale': 'Zum Verkauf auswählen',
  'sales.addTitle': 'Karten hinzufügen',
  'sales.addHelp': 'Nur Karten mit Bestand (qty > 0). Menge auf Restbestand begrenzt — Ziehen in den Warenkorb oder +.',
  'sales.searchOwned': 'Suche in Owned…',
  'sales.inCart': ' · im Warenkorb {n}',
  'sales.noOwned': 'Keine owned Karten. Zuerst Sammlung füllen.',
  'sales.noHits': 'Keine Treffer für „{q}“.',
  'sales.pasteTitle': 'Liste einfügen',
  'sales.toCart': 'In Warenkorb',
  'sales.clear': 'Leeren',
  'sales.added': '{copies} {copyWord} ({cards} {cardWord}) hinzugefügt',
  'sales.notFound': 'nicht gefunden: {line}',
  'sales.notOwned': 'nicht owned: {name}',
  'sales.limitReached': 'Limit erreicht: {name}',
  'sales.onlyPartial': 'nur {take}/{qty}: {name}',
  'sales.noneSelected': 'Keine Karten ausgewählt. Bitte per Checkbox markieren.',
  'sales.sold': 'Verkauft: {cards} {cardWord} ({copies} {copyWord}) aus der Sammlung entfernt.',
  'sales.short': 'knapp: {name} (−{short})',

  'bulk.title': 'Karten per Code',
  'bulk.help': 'Sammlercodes einfügen: Leerzeichen, Komma oder je Zeile einen Code. Beispiele: {ex1}, {ex2}, {ex3}, Alt-Art {ex4}. Scanner: Codes aus dem Scan hier einfügen (Bilderkennung folgt später).',
  'bulk.asFoil': 'Als Foil',
  'bulk.add1': '+1 je Code',
  'bulk.set1': 'Auf 1 setzen',
  'bulk.rem1': '-1 je Code',
  'bulk.found': '{ok} gefunden',
  'bulk.missing': ', {miss} nicht gefunden: {list}',
  'bulk.overview': 'Übersicht',
  'bulk.overviewHelp': 'Sammlung liegt lokal auf diesem PC. CSV Export als Backup nutzen.',
  'bulk.unique': 'Unique',
  'bulk.copies': 'Kopien',
  'bulk.catalog': 'Katalog',
  'bulk.value': 'Wert (EUR)',

  'decks.title': 'Decks',
  'decks.import': 'Import',
  'decks.new': 'Neues Deck',
  'decks.empty': 'Noch kein Deck.',
  'decks.rename': 'Deck umbenennen',
  'decks.delete': 'Deck löschen',
  'decks.active': 'aktiv',
  'decks.totalLow': 'Gesamt (ab Low):',
  'decks.partialPrice': ' · teilweise ohne Preis',
  'decks.missingCopies': 'Fehlende Kopien:',
  'decks.missingInCollection': 'Fehlende Kopien in der Sammlung:',
  'decks.andMore': '… und {n} weitere',
  'decks.importMissing': 'Import / Fehlende Karten',
  'decks.missingCopiesCount': '{n} fehlende Kopien',
  'decks.namesNotFound': ' · manche Namen nicht gefunden',
  'decks.importBtn': 'Importieren',
  'decks.importAdjusted': 'Import angepasst: {notice}',
  'decks.legendRemoved': 'Legend entfernt',
  'decks.legendCover': 'Nur Legends wählbar, die die aktuellen Deck-Domains abdecken: {domains}.',
  'decks.legendAny': 'Bestehende Karten bleiben — beliebige Legend wählbar.',
  'decks.legendLocked': 'Zuerst eine Legend wählen',
  'decks.legendGateExtra': ' Champion/Main/Sideboard/Runes sind für neue Karten gesperrt, bis eine passende Legend gesetzt ist.',
  'decks.limit': 'Limit {cap}',
  'decks.limitReached': 'Limit {cap} erreicht',
  'decks.removeSection': '{section} entfernen',
  'decks.cardsTitle': 'Karten · {section}',
  'decks.search': 'Suche...',
  'decks.ownedOnly': 'nur Owned',
  'decks.pickFirst': 'Zuerst ein Deck wählen oder anlegen.',
  'decks.defaultName': 'Deck {n}',
  'decks.newName': 'Deck {n}',
  'decks.cardsRemoved': 'Karten entfernt',
  'decks.notFoundPrefix': 'Nicht gefunden: {name}',
  'decks.needHave': 'benötigt {need}, vorhanden {have}',
  'decks.owns': 'besitzt {have}',
  'decks.unmatchedName': '{name}',
  'decks.needHaveLine': '{name} — benötigt {need}, vorhanden {have}',

  'deck.needLegend': 'Zuerst eine Legend wählen',
  'deck.typeMismatch': 'Kartentyp passt nicht in diese Sektion.',
  'deck.domainMismatch': 'Domain passt nicht zur Legend.',
  'deck.legendSwapAny': 'Legend muss zum bestehenden Deck passen.',
  'deck.legendSwapDomains': 'Legend muss die Deck-Domains abdecken: {domains}',
  'deck.capReached': 'Limit {cap} für {section} erreicht.',
  'deck.sanitizedCap': '{n} Karte{plural} über dem Sektionslimit entfernt',
  'deck.sanitizedDomain': '{n} Karte{plural} passen nicht zur Legend-Domain',

  'lang.de': 'Deutsch',
  'lang.en': 'English',
}

const en: Record<string, string> = {
  'tab.collection': 'Collection',
  'tab.catalog': 'Catalogue',
  'tab.sales': 'Sales',
  'tab.bulk': 'Codes',
  'tab.decks': 'Decks',

  'stats.line': '{unique} Unique | {copies} Copies | {catalog} in catalogue',
  'stats.valueTitle': 'Estimate: Owned * low + Foil * FoilLow (EUR, Cardmarket)',
  'stats.restart': 'Restart',

  'update.checking': 'Checking updates...',
  'update.available': 'Update {version}...',
  'update.downloaded': 'Update ready {version}',
  'update.error': 'Update error',
  'update.titleChecking': 'Checking for updates...',
  'update.titleAvailable': 'Update {version} available',
  'update.titleDownloaded': 'Update {version} ready - restart',
  'update.titleNotAvailable': 'No updates - up to date',
  'update.titleIdle': 'Check for updates',

  'win.minimize': 'Minimise',
  'win.maximize': 'Maximise',
  'win.restore': 'Restore',
  'win.close': 'Close',

  'load.error': 'Error: {message}',
  'load.catalog': 'Loading Riftbound catalogue...',

  'collection.title': 'Collection',
  'collection.help': 'Open a set binder to browse and manage cards.',
  'collection.byRarity': 'By rarity',
  'collection.filterRarity': 'Filter {rarity}',
  'collection.clearFilter': 'Clear filter',
  'collection.allOwned': 'All owned',
  'collection.allOwnedHelp': 'Owned cards only (legacy collection)',
  'collection.back': 'Back',
  'collection.search': 'Search name, code, domain...',
  'collection.ownedOnly': 'Owned only',
  'collection.missing': 'Missing',
  'collection.emptyNone': 'No cards yet. Go to Codes or Catalogue and add some.',
  'collection.emptyFilter': 'No cards for these filters.',
  'collection.domainClear': 'Clear {domain} filter',
  'collection.domainTitle': 'Domain {domain}',

  'catalog.allSets': 'All sets',
  'catalog.allTypes': 'All types',
  'catalog.ownedOnly': 'owned only',
  'catalog.csvExport': 'CSV Export',
  'catalog.csvImport': 'CSV Import',
  'catalog.csvImported': 'CSV imported ({name})',

  'price.openCm': 'Open on Cardmarket',
  'price.low': 'Lowest price (from)',
  'price.high': 'Highest price',
  'price.avg30': '30-day average',
  'price.foil': 'Foil Low',
  'qty.normal': 'Normal',
  'qty.foil': 'Foil',

  'sales.cart': 'Cart',
  'sales.help': 'Cards for sale — select, adjust quantities, then mark only the checked ones as sold.',
  'sales.selected': ' Selected: {cards} {cardWord} ({copies} {copyWord}).',
  'sales.markSold': 'Mark as sold',
  'sales.pickFirst': 'Select cards with the checkbox first',
  'sales.emptyCart': 'Cart empty. Search owned cards on the right, drag, or paste a list.',
  'sales.selectForSale': 'Select for sale',
  'sales.addTitle': 'Add cards',
  'sales.addHelp': 'Only cards in stock (qty > 0). Quantity capped at remaining stock — drag into cart or use +.',
  'sales.searchOwned': 'Search owned…',
  'sales.inCart': ' · in cart {n}',
  'sales.noOwned': 'No owned cards. Fill the collection first.',
  'sales.noHits': 'No matches for “{q}”.',
  'sales.pasteTitle': 'Paste list',
  'sales.toCart': 'Add to cart',
  'sales.clear': 'Clear',
  'sales.added': 'Added {copies} {copyWord} ({cards} {cardWord})',
  'sales.notFound': 'not found: {line}',
  'sales.notOwned': 'not owned: {name}',
  'sales.limitReached': 'limit reached: {name}',
  'sales.onlyPartial': 'only {take}/{qty}: {name}',
  'sales.noneSelected': 'No cards selected. Please tick the checkboxes.',
  'sales.sold': 'Sold: removed {cards} {cardWord} ({copies} {copyWord}) from collection.',
  'sales.short': 'short: {name} (−{short})',

  'bulk.title': 'Cards by code',
  'bulk.help': 'Paste collector codes: spaces, commas, or one code per line. Examples: {ex1}, {ex2}, {ex3}, alt art {ex4}. Scanner: paste codes from a scan here (image recognition later).',
  'bulk.asFoil': 'As foil',
  'bulk.add1': '+1 per code',
  'bulk.set1': 'Set to 1',
  'bulk.rem1': '−1 per code',
  'bulk.found': '{ok} found',
  'bulk.missing': ', {miss} not found: {list}',
  'bulk.overview': 'Overview',
  'bulk.overviewHelp': 'Collection is stored locally on this PC. Use CSV export as a backup.',
  'bulk.unique': 'Unique',
  'bulk.copies': 'Copies',
  'bulk.catalog': 'Catalogue',
  'bulk.value': 'Value (EUR)',

  'decks.title': 'Decks',
  'decks.import': 'Import',
  'decks.new': 'New deck',
  'decks.empty': 'No decks yet.',
  'decks.rename': 'Rename deck',
  'decks.delete': 'Delete deck',
  'decks.active': 'active',
  'decks.totalLow': 'Total (low):',
  'decks.partialPrice': ' · some without price',
  'decks.missingCopies': 'Missing copies:',
  'decks.missingInCollection': 'Missing copies in collection:',
  'decks.andMore': '… and {n} more',
  'decks.importMissing': 'Import / missing cards',
  'decks.missingCopiesCount': '{n} missing copies',
  'decks.namesNotFound': ' · some names not found',
  'decks.importBtn': 'Import',
  'decks.importAdjusted': 'Import adjusted: {notice}',
  'decks.legendRemoved': 'Legend removed',
  'decks.legendCover': 'Only legends that cover the current deck domains: {domains}.',
  'decks.legendAny': 'Existing cards stay — any legend is fine.',
  'decks.legendLocked': 'Choose a Legend first',
  'decks.legendGateExtra': ' Champion/Main/Sideboard/Runes are locked for new cards until a matching Legend is set.',
  'decks.limit': 'Limit {cap}',
  'decks.limitReached': 'Limit {cap} reached',
  'decks.removeSection': 'Remove {section}',
  'decks.cardsTitle': 'Cards · {section}',
  'decks.search': 'Search...',
  'decks.ownedOnly': 'owned only',
  'decks.pickFirst': 'Choose or create a deck first.',
  'decks.defaultName': 'Deck {n}',
  'decks.newName': 'Deck {n}',
  'decks.cardsRemoved': 'cards removed',
  'decks.notFoundPrefix': 'Not found: {name}',
  'decks.needHave': 'need {need}, have {have}',
  'decks.owns': 'owns {have}',
  'decks.unmatchedName': '{name}',
  'decks.needHaveLine': '{name} — need {need}, have {have}',

  'deck.needLegend': 'Choose a Legend first',
  'deck.typeMismatch': 'Card type does not fit this section.',
  'deck.domainMismatch': 'Domain does not match the Legend.',
  'deck.legendSwapAny': 'Legend must match the existing deck.',
  'deck.legendSwapDomains': 'Legend must cover deck domains: {domains}',
  'deck.capReached': 'Limit {cap} for {section} reached.',
  'deck.sanitizedCap': 'removed {n} card{plural} over section limit',
  'deck.sanitizedDomain': '{n} card{plural} do not match Legend domain',

  'lang.de': 'Deutsch',
  'lang.en': 'English',
}

export const messages: Record<Lang, Record<string, string>> = { de, en }

export function t(lang: Lang, key: string, vars?: Vars): string {
  const table = messages[lang] || messages.de
  let s = table[key] ?? messages.de[key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v))
    }
  }
  return s
}

/** Plural helper: light singular/plural pick (no ICU). */
export function plural(_lang: Lang, n: number, one: string, many: string) {
  return n === 1 ? one : many
}
