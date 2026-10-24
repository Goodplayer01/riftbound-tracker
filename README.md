# Deakrix Riftbound Tracker

I play Riftbound and got tired of keeping my collection in spreadsheets, so I built this. It's a Windows app for Riftbound only. No other card games, no account, everything stays on your PC.

Made by Stefan.

## Install

Grab the latest setup from the [Releases page](https://github.com/Goodplayer01/riftbound-tracker/releases) and run it. Windows only. After that the app updates itself when a new version is out.

Windows SmartScreen might complain the first time because the installer isn't signed.

## What it does

**Sets and All owned**

- Sets tab: binders per set: OGN, OGS, SFD, UNL, VEN and RAD. Nexus Night binders can be hidden
- All owned tab: every card you own in one place, with a filter per set and a Borrowed only filter, sorted by set or by price
- Each card shows which of your decks use it
- Set, ban and errata tags on every card tile
- Progress per rarity so you see what's still missing. In a set, click a rarity to show only those cards
- Filters for owned, missing and missing foils in each set
- Foil progress per set, what the missing cards would cost, and a missing list for Cardmarket or the wishlist
- Language, condition and purchase price per copy, with profit or loss against today's price
- Normal and foil counts for every card. Cards that only exist as foil get a single counter
- Quick import: paste card codes or a whole deck list
- CSV import and export

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

- Legend, Champion, Main Deck (39), Battlefields, Runes and Sideboard, with the usual limits
- Find a Legend by typing the champion name
- Drag cards from the search list into a deck section, and drag them out again to remove one copy per drag
- Every deck card shows how many you own and how many the deck needs, with buttons to add or remove normal and foil copies in your collection
- Runes as one big counter per domain of your Legend. Add Runes only lists the alt art runes, the counters cover the normal ones
- The open deck shows its Legend big, with the deck's value and what the missing copies would cost. Click the missing tile to list those cards by set with big images, add them to your collection, or copy them as a Cardmarket wants list
- Import and export deck lists as text
- Drag decks around to sort them
- Delete asks first, and Delete all can be undone until you close the app
- Once a deck is full you get a Share button that makes a clean image of the whole deck: Legend, runes, battlefields, main deck and sideboard with counts
- Hand tester with mulligan

**Sales**

Put cards you want to sell in a cart by dragging them in, pasting a list or clicking the cart button, and drag them out again to take them back. Each card shows its price and the cart shows the total. Mark them as sold when they're gone and your collection is updated. You can't add more copies than you own. Export the cart as a list with trend prices or as a CSV with Cardmarket product ids.

**Borrowed**

Keep track of cards you lent to friends, sorted by person. Drag cards in from the search and out again when you get them back. Those copies don't count as available when you build decks.

It works the other way round too: switch an entry to "Borrowed from" for cards a friend lent you. They show up in All owned and count when you build decks, with a purple tag that says who you borrowed them from and how many, so you know they aren't yours. Export a list with one click and send it over. Your friend pastes it into Import and gets the exact same prints as cards borrowed from you.

**Stores**

Compare booster display prices before you buy. For each set you see the Cardmarket trend (and the price per booster), then every offer from German online shops sorted by price, marked green or red against the trend, with stock and pre-order info. Filter by print language (English, Chinese Slim / Jumbo, French, Korean), set a max price per display and see which offers fit your budget. With your own CardTrader API token the cheapest CardTrader listings show up too.

The second view lists Riftbound shops in Germany on a map with a radius around you, contact info, and a stock hint where the shop publishes one.

**Dopamin**

Open simulated booster packs for each set with the real pack art. Cards flip one at a time, with price and pull chance, and a counter shows how many packs you've opened. The odds only use what Riot has published, nothing made up.

**Look and feel**

- Dark design in the style of macOS, with Dante's amber as the accent color
- Domain icons drawn for the app, sharp at every size
- The window button maximizes the app and leaves the Windows taskbar visible, and the app then uses the full width of the screen
- Click anywhere on a card to open its detail view, and drag a card from anywhere on its tile
- In the wishlist, sales and deck builder you can hide the card search on the right to get more room
- The app runs in German or English
- Card images load fast: small previews ship with the app, full-size art is cached on your PC after the first view

## Feedback

Found a bug, have an idea or just want to say something? Write me at [riftbound@mr-internet.de](mailto:riftbound@mr-internet.de).

## Note

This is a fan project. It's not affiliated with or endorsed by Riot Games or UVS Games.

## Credits

Icons are from [Lucide](https://lucide.dev) (ISC License, Copyright (c) Lucide Icons and Contributors). The torn booster pack icon on the Dopamin tab is my own drawing in the same style. The domain icons were drawn for this app and are not Riot's artwork.
