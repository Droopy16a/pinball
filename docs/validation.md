# Pinball validation

Verified locally on 2026-10-31, with Node 24.22.0 and Python 3.12.10.

- Production build and Svelte/TypeScript checks pass.
- ESLint, Ruff and strict Python type checks pass.
- 23 frontend unit tests cover launch validation, duplicate-wager protection, power-specific SDK modes, saved-round recovery, settlement recovery, unsupported books, exact payouts and the generated event contract.
- Ten Chromium integration tests cover the original table and local assets, mobile layout, all three measured exits, SDK request bodies, settlement ordering, recovery without a new wager, safe authentication failure, reproduction of published paths with the original physics implementation, and an original collision-driven Hold’em Showdown bonus cutscene before settlement.
- 15 Python tests cover the existing mathematics and every generated upload book, lookup row, payout, weight, measured sample and exact per-mode 96.7% return.
- Physics generation repeats one simulation per power and compares its full result byte for byte. Browser verification independently compares every sample at two powers.

The generated library has 99 natural-drain trajectories across seven powers. Every published physical sample comes from the original Expert table. Original scene updates use a fixed 60 Hz cadence, retaining Matter's original 2 ms physics substeps. No waypoint fitting, gravity changes, trajectory redirection, or artificial timeout loss is used.

Browser RGS tests use intercepted responses. A live Stake developer session, math acceptance, production outcome diversity and platform approval remain unverified. The production frontend is built under `dist/`; math upload files are under `game_math/library/publish_files/`.

Every award is verified against one fixed price schedule. Both divider IDs and repeated exact halves are tested independently with Fraction and BigInt. Settlement rounding is upward only. All seven actual lookup tables verify at exactly 96.7% RTP. Browser tests verify an actual 0.90× to 0.45× divider hit before wallet settlement.

The Bet action launches immediately with the selected or unchanged power. Tests cover choosing power before betting, betting at the default power without an extra confirmation, retaining power across bets and preventing duplicate requests.

Version 3 replaces proportional rewards with ordered fixed awards, divider hits and settlement operations. Native physics includes the two requested middle bumper bodies. Original bonus animations remain collision-driven.
