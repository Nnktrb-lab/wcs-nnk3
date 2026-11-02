# Main flows (v2.2 baseline, must keep working in v3)

## Play – new puzzle
- Start: index.html → "Main"
- Steps: choose variant Classic, difficulty Easy, press "Jana Puzzle"
- Expect: toast "Puzzle baharu dijana (Easy)", 9x9 board, timer running, mistakes 0/3

## Play – input, pencil, undo, hint, explain, check, solution, reset, pause
- Steps: select empty cell, press number; toggle Pensel and add notes; Undo; Hint; Explain; Semak; Penyelesaian; Reset; Jeda/Sambung
- Expect: values shown, notes shown, solver panel shows technique, pause overlay locks input

## Load by Puzzle ID / Custom puzzle
- Steps: enter E-XXXXXXXX, press Muat ID; choose Custom, paste 81 chars, start
- Expect: same puzzle regenerated; custom validated (unique solution)

## Killer Sudoku solo
- Steps: variant Killer → Jana Puzzle
- Expect: cages with sums drawn

## Bot autoplay
- Steps: Bot Play / Pause / Resume / Next / Previous / Undo / Reset, speed select
- Expect: steps applied visually, history list grows/shrinks

## Backtracking mode
- Steps: press backtracking run
- Expect: solution count reported separately from logical solver

## Teknik library
- Steps: nav "Teknik", click each technique
- Expect: detail with definition, example board, status badge

## Cabaran
- Steps: nav "Cabaran", select a challenge, find target
- Expect: validation + explanation

## Statistik
- Expect: stat cards + technique table; reset stats (confirm)

## Tetapan
- Steps: BM/EN toggle, dark/light toggle, toggles; reload
- Expect: settings persist; component status table renders

## 1vs1 casual room (public relay, no account)
- Steps: "Cipta" room → code shown; second browser "Sertai" with code
- Expect: lobby with both players, agree → countdown → shared puzzle

# Requested v3 checks
- Server accounts: register / login / logout / recovery / cross-device (2 contexts)
- Ranked: mode + difficulty must be chosen before Find Match; no default Medium
- Matchmaking: same mode+difficulty, rating window ±100 expanding, cancel, no self/double match
- Server-side Elo (K=40 first 30, then 20), 7 tiers, history w/ rating changes
- Server-validated moves, 3 mistakes, finish, surrender, disconnect forfeit after grace
- Private rooms with code (server), friend invites (friends only)
- Friends: add by Friend ID, accept, reject, remove, online/playing status
- Leaderboard: global / country / region, search, pagination, sort, my position
- Emoji/phrases rate-limited 1.5s server-side; no free text in server rooms
- Voice: signaling via server, ICE from /api/ice (TURN env optional)
- Mobile: bottom nav + More sheet, no horizontal overflow; BM/EN; Light/Dark
