# Reference and fidelity record

Reference: https://www.247pinball.com/

Inspected on 2026-10-31 using the reverse-engineer-anything (REA) skill and `capture_browser_scenario`, launching Chrome and waiting for the title screen. Runtime Evidence ID: `ev_473d742277511421ef40ab476796342fbe06bfc86e87649685b2295b9e545944`.

## Observed

The runtime capture recorded the title-screen pixels, DOM, and requested game assets. It identified `/game/js/main.js?v=1793033450749`, whose internal game version is 1.2.0.0 and asset build timestamp is 1778623750721. The game bundle includes Matter.js 0.18.0.

The downloaded bundle declares difficulty labels Easy, Medium, Hard, Expert at indices 0–3 and gravity scales `[0.0015, 0.0018, 0.0021, 0.0024]`. New Hard games use the existing `wa(0, 2)` state initialization. The local adapter sets `levelSelectPage` to 2 before loading the game, preserving the original selection workflow.

183 observed image, audio, and font resources were downloaded with their original paths. The source bundle and all play assets are served locally under `public/reference-game/`.

## Changes from the reference host

- A Svelte wrapper supplies a full-window frame and preserves the existing platform initialization.
- A small bootstrap supplies the original game's expected host elements and initialization callbacks.
- Hard is selected by default. Automatic fullscreen is disabled by default.
- Advertising, tracking, and the surrounding editorial content are omitted.
- The daily challenge client's `_disabled` flag is changed from false to true. The original error path handles its unavailable external leaderboard. This is the only game-bundle change; physics and game rules are unchanged.
- The host uses the available viewport height and a narrow-screen layout without advertising margins.

The REA observation established page loading and the requested asset inventory; it did not itself exercise gameplay. Subsequent local browser checks exercised selection, the instructions overlay, the Hard table, launch, keyboard controls, and resizing. Tests inspect runtime state through a read-only probe injected into the test response only; no inspection API ships in the application.

## Limits

Daily leaderboard parity is intentionally unavailable. Keyboard/ball/mode checks do not prove every mission, multiball sequence, or every possible physics trajectory. Exact game rendering comes from reusing the observed original assets and bundle; the containing page differs as described above. The original menu retains other difficulties and daily challenge UI.

The original game code and assets remain copyright 24/7 Games LLC.

## Expert-only update

The current version starts directly with `wa(0, 3)` (Expert, gravity scale 0.0024). The header is removed and the table fills the viewport. A small adapter inside the game closure skips the instructions overlay, hides and disables navigation, prevents menu shortcuts, and routes exit/game-over transitions into a new Expert game. No title, difficulty, daily, settings, or game-over menu is presented. Simulation constants and table mechanics remain unchanged. This supersedes the Hard-selection workflow and menu availability described in the initial reference record above.

## Stake wager and physics library update

The current host adds betting controls around the original Expert table. The original engine constants, table geometry, collision handling, ball, plunger, and flipper forces are preserved. A narrow closure bridge creates an isolated original scene for offline simulation. The automatic player taps the original flipper buttons with seeded timing; it does not inject ball forces or redirect trajectories.

`game_math/physics-traces.json` contains measured original trajectories, including bridge floors, original scores and automatic button states. The generated event books use those samples verbatim with added payout annotations. The live table reruns the selected original simulation and verifies its motion against every recorded sample. Native collisions and mission phases remain active, preserving the original bonus cutscenes, sounds, particles and score animations. Original free saves, extra balls, player nudges, manual flipper controls and automatic fresh games are disabled for the one-ball wager flow. There are no scripted waypoint paths.

The generation script repeats shots to verify deterministic motion. Browser tests reproduce published paths at two powers, comparing every recorded sample to a fresh original-physics run. This supersedes the manual-control and unchanged-game-rule descriptions above; the reference physics implementation remains the source of every published path.

## Middle divider bumpers and fixed awards

The current table adds two original-style bumper bodies at (690,1190) and (1030,1390), with original red artwork and no text overlays. The regular scoring bumpers use the supplied blue bumper_plus_off.webp image. They reuse native bumper collisions and impulses but halve the round credit bank instead of awarding score. Other physics constants and the original three scoring bumpers are retained. Fixed-price bonus awards and ordered half operations replace the previous proportional payout annotations. The 99 measured version 3 trajectories include native bonus animation playback and both divider IDs.
