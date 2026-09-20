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

New rooms default to a **25:00 Standard** per-player countdown, with no setup required. The home timer tile can switch between Standard, Farzher, and no timer, and remembers the preference.

**Farzher Timer** starts both players with equal time (5:00 by default) and an Expected Turn Time (ETT) equal to 10% of the current total time pool. When a turn takes `d` milliseconds with expected time `e`:

1. the active player spends `d`;
2. each opponent receives `d`;
3. every clock receives the adjustment `d - e`.

The ETT is recalculated from the settled pool after every turn, so fast play contracts the pool and slow play expands it. Standard clocks expire in real time; Farzher clocks settle when a valid turn is submitted because the turn-duration adjustment is part of the clock result.

Timer state belongs to the host-authoritative game state and is included in reconnect snapshots, so refreshing does not reset a clock.

## Wordbook

The initial build loads **ENABLE (Enhanced North American Benchmark Lexicon)** at runtime from the `dolph/dictionary` mirror. ENABLE contains roughly 172,800 words and was released into the public domain.

It is a strong no-license default, but it is **not the official North American tournament Scrabble lexicon (NWL)** and some accepted/rejected words will differ.

Dictionary loading is isolated in `src/app.js`; the game engine accepts any `Lexicon`, so switching to another newline-delimited lexicon later is straightforward.

## Run

No build step and no package install are required. Serve the repository as static files:

```sh
python -m http.server 8080
```

Then open `http://localhost:8080`.

GitHub Pages can serve the repository as-is.

## Files

- `index.html` — application shell
- `styles.css` — responsive visual design
- `src/game.js` — board rules, scoring, bag/racks, validation, move generation
- `src/app.js` — UI, rooms, host authority, reconnect behavior

## Multiplayer protocol

A room maps directly to one `Serverless_Lobby` channel. The lobby library attempts WebRTC DataChannels and falls back to its WebSocket relay when direct P2P is unavailable.

The guest sends intentions (`play`, `exchange`, `pass`) with the game revision they were based on. The host independently validates the action, mutates canonical state, increments the revision, persists it, then broadcasts individualized snapshots. Hidden racks and the bag order are never intentionally sent to the guest.

This is designed for trusted family/friend play rather than adversarial online competition: the host browser necessarily holds the entire canonical game state and could inspect it with developer tools.
