# Stake Engine pinball integration

The frontend uses the installed official `stake-engine@0.1.32` TypeScript SDK, preserving its request formats and raw integer monetary units (1,000,000 = one displayed currency unit). Authoritative SDK and protocol sources:

- [TypeScript client](https://github.com/engineio/ts-client)
- [Play protocol](https://github.com/engineio/docs/blob/main/src/routes/docs/api/play/%2Bpage.svx)
- [End-round protocol](https://github.com/engineio/docs/blob/main/src/routes/docs/api/end-round/%2Bpage.svx)
- [Math SDK](https://github.com/engineio/math-sdk)

## Round lifecycle

A launch without either session parameter is explicitly a local demo. Partial or malformed platform parameters fail closed. Platform initialization calls `Authenticate` once, reads the balance and configured bet levels, and checks for an active saved round.

**Launch power** is optional and available before the bet amount. It defaults to 85% and retains the last used setting for subsequent bets. **Bet** immediately locks both controls, launches the ball and calls `Play({ amount, mode: 'POWER_<power>' })` once. Every power mode has cost 1. The round presenter decodes the returned event before rendering. A mismatched power or stake is preserved and blocked.

After the last measured drain sample has been shown, the controller honors the configured minimum round duration in milliseconds, then calls `EndRound` only if the returned round is active. The resulting server balance is displayed; the frontend never credits a platform payout itself.

A transport failure enters recovery and disables new wagers. Reconnect creates a fresh official client and authenticates to determine whether the server accepted the wager or settlement. A pending round is replayed with its original power, stake and payout; an already-settled round uses the authoritative balance. The app never blindly repeats a Play request.

There is one event per book, so interrupted presentation deliberately replays that single event from the start. There is no additional wager or intermediate player choice. Automatic flippers are part of one shot; the app has no automatic betting feature, keyboard wager shortcut, nudge, or manual flipper input.

## Version 3 event contract

Each round.state contains one event with `index: 0`, `type: 'pinball'`, `version: 3`, `physics: '247-expert-dividers-v1'`, `step: 2`, its power and deterministic seed. Round modes remain POWER_70 through POWER_100. `multiplier` is the final settled payout in integer hundredths of the stake, not a sampled payout tier.

Each path sample stores time, position, floor, automatic button states, original score, the current credit `bank`, signed net `reward`, and ordered `ops`:

- `award`: original points and their fixed monetary amount. Price is `max(10, floor((points + 125) / 250) * 10)`. All modes and rounds use the same price.
- `halve`: bumper ID 0 or 1. It divides the bank collected so far by two. It does not add points or change the wallet balance.
- `settle`: present only on the last natural-drain sample when necessary. It rounds the bank upward to the next 0.1× stake, preserving small awards while meeting the RGS payout resolution.

The frontend independently checks every operation with BigInt numerator/denominator arithmetic, verifies every score and bank change, and checks the final payout against the RGS amount. Unknown versions, changed prices, invalid halves or early settlement block the round. Version 2 books are unsupported: deploy the version 3 frontend and math together.

## Native divider physics and presentation

The new bumpers are at table coordinates (690,1190) and (1030,1390), shown with the original red artwork and no text overlay. The three regular scoring bumpers use bumper_plus_off.webp. They use the original createBumper implementation, collision sensor, actuator, impulse, light and sound. Their original scoring call is suppressed; instead they record a halve operation on the credit bank. The original three scoring bumpers, gravity, collision step, plunger, ramps and flippers are retained.

Generation and playback share the same scene constructor, automatic inputs and seeded random stream. Every physical sample and credit operation is verified during playback. Native scoring and mission code remains active, preserving the original bonus animations. Each scoring call records its fixed award before any subsequent divider operation, so event ordering is unambiguous.

Sampling weights are calibrated from the actual settled banks, with an exact 96.7% expectation in each mode. Prices are never rescaled to fit a selected payout. The current 99-book development library has a maximum payout of 6.2×; published rules are generated in src/game/credit-rules.json. It includes both divider IDs, repeated reductions and a native Hold’em Showdown sequence.

## Publishing and verification limits

The bundled table fonts include both WOFF2 and TTF files. Stake hosting blocks
`data:` font URLs, including the original loader's WOFF2 capability probe. That
causes the loader to select its TTF fallback even in browsers supporting WOFF2.
Keep both formats in the frontend upload; omitting TTF files stalls the table
preloader with "Sorry, we couldn't load the game". The browser integration suite
checks loading with Stake's `font-src 'self' https://fonts.gstatic.com` policy.

`game_math/library/publish_files/index.json` references seven mode-specific `.jsonl.zst` book files and lookup CSVs. These are generated through the official Math SDK's Book serializer; publication tests decode every compressed file and compare IDs, weights, events, payouts and exact RTP to the demo pool. `game_math/physics-provenance.json` records the bundle and simulator hashes.

Live Stake authentication, math upload acceptance, production hosting, currencies, jurisdiction approval and game approval require a real developer environment and remain unverified. The automated browser tests intercept RGS responses.

SDK 0.1.32 does not expose a disposal API for the balance interval started by Play and EndRound. Browser unload clears it; reconnect can leave an older client's read-only balance polling active until unload. The SDK also maps only part of newer authentication configuration and supports desktop/mobile device values. The seven cost-1 mode definitions come from this game's own published index, not incomplete dynamic mode metadata. Tablet launches and broader operator UI requirements need representative platform validation before submission.
