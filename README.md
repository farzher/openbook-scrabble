# Openbook Scrabble

A browser-first two-player Scrabble variant where vocabulary recall is removed from the game: on every turn, the interface reveals **every legal play** available from your rack. Players still choose the move, manage the board, preserve rack quality, block lanes, time premiums, and make all strategic decisions themselves.

## Play model

- Standard 15×15 Scrabble board and classic 100-tile English distribution.
- Standard letter values, premium squares, 7-tile racks, 50-point bingos, exchanges, passes, and endgame rack adjustment.
- Every legal move is generated locally from the current board + the current player's rack.
- The move browser shows immediate score only. It does **not** calculate equity, win probability, rack-leave value, or a recommended move.
- Two-player rooms use `https://farzher.com/assets/serverless_lobby.js` directly.
- The host browser is authoritative for the bag, racks, validation, scoring, and turn state; the guest receives only player-visible state.
- Game state is snapshot-based rather than delta-synchronized because Scrabble state is tiny and turn-based.
- Host game state is saved locally after each accepted action so a refresh can recover the room.

## Timers

New rooms default to the **Farzher Timer at 5:00/player with a 10% ETT**, with no setup required. The home timer tile can switch between Farzher, Standard, and no timer, and remembers the preference.

**Farzher Timer** starts both players with equal time (5:00 by default) and an Expected Turn Time (ETT) equal to 10% of the current total time pool. When a turn takes `d` milliseconds with expected time `e`:

1. the active player spends `d`;
2. each opponent receives `d`;
3. every clock receives the adjustment `d - e`.

The ETT is recalculated from the settled pool after every turn, so fast play contracts the pool and slow play expands it. Standard clocks expire in real time; Farzher clocks settle when a valid turn is submitted because the turn-duration adjustment is part of the clock result.

Timer state belongs to the host-authoritative game state and is included in reconnect snapshots, so refreshing does not reset a clock.

## Strategy statistics

The game exposes information a perfect human tile-counter could derive from public play without revealing hidden rack contents. The tracker shows every **unseen tile** (bag + opponent rack), including exact remaining counts per letter and blanks, plus bag size and opponent rack size.

### Opponent heatmap

The compact heatmap defaults to **Both**, with **You**, **Opponent**, and **Off** views also available. It refreshes automatically after you preview a placement. In Both mode, each square has split markers: your cyan-outlined half on the left and the opponent's coral-outlined half on the right. Each half independently represents availability probability by size and average best score through that square **when a play there is available** by fill color, on a fixed green-to-red 0–100+ point scale. Hover or tap either half to inspect that player's opportunities. These are separate marginal estimates, not the probability that both players can use a square together. Hover, keyboard-focus, or tap a circle for an instant custom card with separate chance and score metrics and a ghost example. Tap again, tap outside, or press Escape to dismiss. No score cutoff or recommended move is used.

**You** shows exact current-rack opportunities without a preview. With a preview it preserves your unplayed tiles and samples refills up to the remaining bag count. This is follow-up potential on the preview board, not a prediction of the opponent's intervening move; the card labels this limitation.

A separate worker samples 96 possible opponent racks without replacement from public unseen tiles. The same rack samples are reused across previews for stable comparisons. Results refine progressively; changing previews cancels old work. These are rough random-rack estimates, not predictions of what the opponent will choose; they ignore rack inference from prior decisions. Overlapping square probabilities must not be added. Unmarked squares are not guaranteed safe. When all unseen tiles belong to the opponent, the rack is publicly inferable and only one exact evaluation is needed. Hidden host state is never used. Worker support is required for the heatmap.

Run the sampling checks with `node threats.test.mjs`.

The game also surfaces public strategic context such as score differential, turn count, best scoring play, bingo count, scoreless-turn pressure, move history, clocks, and connection transport. It intentionally does not expose the opponent's actual rack or exact bag composition.

## Interface

- Board-first forest-green table, warm tiles, readable move cards, board coordinates, and a bonus legend.
- Select a word to preview its highest-scoring placement, then explore its other placements. Previewed rack tiles dim so the remaining rack is easy to see. Clear with **Escape**; press **/** to search.
- Game insights collapse on desktop; compact scores and the stats button keep smaller screens readable. On mobile, a selected-move dock offers **View board** and **Play** while browsing away from the board.
- The **♪** button enables quiet synthesized sounds for previews, turns, plays, swaps, passes, and game completion. Sound is off by default and the preference is remembered. No audio files are downloaded.
- Dialogs support keyboard focus containment and Escape. Animation respects the system’s reduced-motion preference.
- Move generation runs in a module worker where supported, keeping scrolling, clocks, and input responsive. Older browsers fall back to the main-thread engine.

## Wordbook

The initial build loads **ENABLE (Enhanced North American Benchmark Lexicon)** at runtime from the `dolph/dictionary` mirror. ENABLE contains roughly 172,800 words and was released into the public domain.

It is a strong no-license default, but it is **not the official North American tournament Scrabble lexicon (NWL)** and some accepted/rejected words will differ.

Dictionary loading is isolated in `app.js`; the game engine accepts any `Lexicon`, so switching to another newline-delimited lexicon later is straightforward.

## Run

No build step and no package install are required. Serve the repository as static files:

```sh
python -m http.server 8080
```

Then open `http://localhost:8080`.

GitHub Pages can serve the repository as-is.

## Files

- `index.html` — application shell
- `styles.css` — base visual design
- `polish.css` — board-first theme, readable controls, responsive layouts, and accessibility states
- `sounds.js` — opt-in Web Audio feedback
- `move-worker.js` — background move generation
- `game.js` — board rules, scoring, timers, bag/racks, validation, move generation
- `app.js` — UI, rooms, live lobby directory, strategy statistics, host authority, reconnect behavior

## Multiplayer protocol

A room maps directly to one `Serverless_Lobby` channel. The lobby library attempts WebRTC DataChannels and falls back to its WebSocket relay when direct P2P is unavailable.

The guest sends intentions (`play`, `exchange`, `pass`) with the game revision they were based on. The host independently validates the action, mutates canonical state, increments the revision, persists it, then broadcasts individualized snapshots. Hidden racks and the bag order are never intentionally sent to the guest.

This is designed for trusted family/friend play rather than adversarial online competition: the host browser necessarily holds the entire canonical game state and could inspect it with developer tools.
