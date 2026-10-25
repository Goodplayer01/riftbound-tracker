# Deakrix Riftbound Tracker

I play Riftbound and got tired of keeping my collection in spreadsheets, so I built this. It's a Windows app for Riftbound only. No other card games, no account, everything stays on your PC.

Made by Stefan.

## Install

Grab the latest setup from the [Releases page](https://github.com/Goodplayer01/riftbound-tracker/releases) and run it. Windows only. After that the app updates itself when a new version is out.

Windows SmartScreen might complain the first time because the installer isn't signed.

## What it does

**Sets and All owned**

- Sets tab: binders per set: OGN, OGS, SFD, UNL, VEN and RAD. Nexus Night binders can be hidden
- All owned tab: every card you own in one place, with a filter per set, Borrowed only and Not needed in decks, sorted by set or by price. Not needed in decks shows how many copies no deck needs (all decks added up); together with Borrowed only it lists the borrowed copies you can give back
- Each card shows which of your decks use it and how many copies each: one badge per deck, stacked in the top right of the image, and the same in the card detail. Click one to jump to that deck
- Set, ban and errata tags on every card tile
- Progress per rarity so you see what's still missing. In a set, click a rarity to show only those cards
- Filters for owned, missing and missing foils in each set
- Foil progress per set, what the missing cards would cost, and a missing list for Cardmarket or the wishlist
- Language, condition and purchase price per copy, with profit or loss against today's price. Copies without details get Bought and Pulled buttons, so mixed copies take two clicks. Pulled copies can carry the price of the product they came from (booster, display, Pre-Rift kit, box set like Proving Grounds, vault or precon deck): each card then costs its share of that product and counts for profit or loss. Split off a copy to give it its own price
- Normal and foil counts for every card. Cards that only exist as foil get a single counter
- Plain runes are bulk and not tracked: no counters, not in set progress, All owned or the value, and a deck never misses them. Alt art runes are tracked like any other card
- Quick import: paste card codes or a whole deck list

**Wishlist**

- Cards you still want, shown as tiles like in the catalogue
- Copy the list in Cardmarket's wants format and paste it into a Cardmarket wants list
- Drag cards in from the search on the right, the same way as in the deck builder, and drag them out again to remove a copy
- Total value of the list, and a Got it button that moves a card into your collection
- Price alerts: set a target price per card and get a notification when it drops below

**Catalogue**

- Every card in the game
- Filters for set, type, rarity, domains, abilities like Hidden, and owned only
- Search with an X to clear it in one click
- Card detail with a big zoomed scan and the rules text you can actually read
- Battlefields are shown sideways in the detail view so the text is straight
- Ban badges for Standard and 2v2
- An Errata tag on cards with official errata, and the new text right under the card in the detail view

**Prices**

- Cardmarket prices from Cardmarket's daily price guide: low, 30 day average, trend and foil, Radiance included
- Total value of your collection in EUR
- Click a card name to open it on Cardmarket, in the app's language and filtered to English copies from German sellers
- Prices are updated every morning and the app picks them up at start, you don't need a new version for that
- Value history: a chart of what your collection was worth at each price update, plus the cards that went up or down the most

**Decks**

- Legend, Champion, Main Deck (39), Battlefields, Runes and Sideboard, with the usual limits. The 3 copy limit counts per full name, so "Evelynn, in Control" and "Evelynn, Entrancing" are separate cards
- Find a Legend by typing the champion name
- Drag cards from the search list into a deck section, and drag them out again to remove one copy per drag. The search list shows how many copies are already in the deck
- Every deck card shows how many you own and how many the deck needs, with buttons to add or remove normal and foil copies in your collection. Alt arts, overnumbered, signed and reprinted versions of a card count as the same card, so owning the alt art Kai'Sa covers the normal one in your deck and in the missing list
- Cards that another deck uses get an "Also in Deck ×n" tag in the deck builder, red when your copies don't cover every deck at once. Click it to jump to that deck
- Runes as one big counter per domain of your Legend. Add Runes lists the alt art and Nexus Night runes, the counters cover the normal ones
- The open deck shows its Legend big, with the deck's value and what the missing copies would cost. Click the missing tile to list those cards by set with big images, add them to your collection, or copy them as a Cardmarket wants list
- Import and export deck lists as text. Card codes in brackets like `[RAD-SP3]` (Rift Atlas and similar) pick the exact print, alt arts included
- Drag decks around to sort them
- Delete asks first, and Delete all can be undone until you close the app
- Once a deck is full you get a Share button that makes a clean image of the whole deck: Legend, runes, battlefields, main deck and sideboard with counts. The image goes straight into your clipboard, so you just paste it into Discord or WhatsApp; saving it as a file is still there
- Hand tester with mulligan

**Sales**

Put cards you want to sell in a cart by dragging them in, pasting a list or clicking the cart button, and drag them out again to take them back. Each card shows its price and the cart shows the total. Mark them as sold when they're gone and your collection is updated. You can't add more copies than you own. Export the cart as a list with trend prices or as a CSV with Cardmarket product ids.

The second view, Add sources, works through every card whose copies don't say yet whether you bought or pulled them, one card at a time like a stack, most valuable first, with a counter of what's left. Bulk under 1 € per copy is left out. Set the booster or display you opened once and "+ Pulled" fills it in for every card. Skip a card or press → to move on, stop whenever you like and continue later right where you were.

**Borrowed**

Keep track of cards you lent to friends, sorted by person. Drag cards in from the search and out again when you get them back. Those copies don't count as available when you build decks.

It works the other way round too: switch an entry to "Borrowed from" for cards a friend lent you. They show up in All owned and count when you build decks, with a purple tag that says who you borrowed them from and how many, so you know they aren't yours. Export a list with one click and send it over. Your friend pastes it into Import and gets the exact same prints as cards borrowed from you.

**Stores**

Compare booster display prices before you buy. For each set you see the Cardmarket trend (and the price per booster), then every offer from German online shops sorted by price, marked green or red against the trend, with stock and pre-order info. Filter by print language (English, Chinese Slim / Jumbo, French, Korean), set a max price per display and see which offers fit your budget. With your own CardTrader API token the cheapest CardTrader listings show up too.

The second view shows Riftbound stores on a map with a radius around you, taken from the official event search on playriftbound.com: every store with upcoming events, its contact info, its next events (date, type, entry fee, sign-ups) with a link to each event, and a stock hint where the shop publishes one. Save a place as home location and the search runs there as soon as you open the view.

**Dopamin**

Open simulated booster packs for each set with the real pack art. Every slot of a real pack is in there: commons, uncommons, the token or rune slot, the foil slot, the rare slot and the slot that can turn into an Epic, Alt Art, Overnumbered, Signature or Ultimate. Cards flip one at a time with price and pull chance, or reveal the whole pack at once and see what it was worth. A counter per set adds up what the packs would have cost on Cardmarket against what you pulled, so you see whether you are up or down, plus your best pull. The odds are the ones Riot published (Epic 1 in 4 packs, Alt Art 1 in 12, Overnumbered 1 in 72, 1 in 10 of those signed, Ultimate 0.025 % in Radiance); the few slots Riot gave no numbers for are marked as estimates.

**Da Rules**

The official Riftbound Core Rules and Tournament Rules right in the app, with a search: type a rule number like `350.2` or a few words like `token play` in any order, matches are highlighted, and a click on a rule number shows it in context. The rules come from the PDFs Riot links on playriftbound.com and are checked every day, so a rules update shows up in the app without a new version.

**Backup**

Everything in the app fits in one JSON file: your collection with language, condition and purchase price, all decks, wishlist and price alerts, sales cart, borrowed lists, Dopamin counters and settings (your CardTrader token stays out). Export it to keep it safe or to move to another PC. Importing a file replaces everything in the app, after a warning that compares what you have now with what's in the file, and your current state is backed up first so you can go back. The app also backs up by itself once a day at startup into `Documents\Deakrix Riftbound Tracker\Backups`, outside the app, so the backups survive an uninstall. Pick your own backup folder if you like (a cloud drive folder, say). After a reinstall, choose your old folder again and the newest backup in it is offered for loading right away. The Backup tab lists every backup with its date and contents and restores any of them with one click.

**Look and feel**

- Dark design in the style of macOS, with Dante's amber as the accent color
- Domain icons drawn for the app, sharp at every size
- The window button maximizes the app and leaves the Windows taskbar visible, and the app then uses the full width of the screen
- Click anywhere on a card to open its detail view, and drag a card from anywhere on its tile
- The card search on the right looks and works the same in the wishlist, sales, deck builder and borrowed: tags, prices, how many you own, drag and add. A tag shows every deck the card is in, so you don't sell or lend a card a deck still needs
- Prices show as small boxes (from, 30 day average, foil) on every card and in every list, and the price and counters always sit at the bottom of a card, so a row of cards lines up
- Card names in deck lists get the full width, tags sit on their own line below
- In the wishlist, sales and deck builder you can hide the card search on the right to get more room
- The app runs in German or English
- Card images load fast: small previews ship with the app, full-size art is cached on your PC after the first view

## Feedback

Found a bug, have an idea or just want to say something? Write me at [riftbound@mr-internet.de](mailto:riftbound@mr-internet.de).

## Note

This is a fan project. It's not affiliated with or endorsed by Riot Games or UVS Games.

## Credits

Icons are from [Lucide](https://lucide.dev) (ISC License, Copyright (c) Lucide Icons and Contributors). The torn booster pack icon on the Dopamin tab is my own drawing in the same style. The domain icons were drawn for this app and are not Riot's artwork.
