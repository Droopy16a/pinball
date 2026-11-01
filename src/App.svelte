<script lang="ts">
  import { onMount } from 'svelte';
  import { GameController } from './game/GameController';
  import { initialState } from './game/GameState';
  import creditRules from './game/credit-rules.json' with { type: 'json' };
  import { payoutForRatio, type PinballOutcome } from './game/PinballOutcome';
  interface TableWindow extends Window {
    pinballTable?: {
      ready: boolean;
      setMuted: (muted: boolean) => void;
      play: (
        outcome: PinballOutcome,
        power: number,
        progress: (
          bank: number,
          numerator: string,
          denominator: string,
        ) => void,
      ) => Promise<void>;
    };
  }
  const controller = new GameController();
  let gameState = $state(initialState());
  let frame: HTMLIFrameElement;
  let tableReady = $state(false);
  let presenting = $state(false);
  let bet = $state(1_000_000);
  let power = $state(85);
  let earned = $state(0);
  let previousBank = 0;
  let bankEvent = $state('');
  let muted = $state(true);
  let rules = $state(false);
  let showPayout = $state(false);
  const changeBet = (direction: number) => {
    const index = levels.indexOf(bet);
    bet =
      levels[Math.max(0, Math.min(levels.length - 1, index + direction))] ??
      bet;
  };
  const money = (units: number) =>
    `${(units / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${gameState.status === 'local' ? 'credits' : gameState.balance.currency}`;
  const levels = $derived.by(() => {
    void gameState.session;
    return controller.betLevels();
  });
  const table = () =>
    (frame?.contentWindow as TableWindow | null)?.pinballTable;

  onMount(() => {
    const unsubscribe = controller.subscribe((state) => {
      gameState = state;
      bet = state.bet;
      if (state.phase === 'presenting') power = state.power;
    });
    const message = (event: MessageEvent) => {
      if (
        event.source !== frame?.contentWindow ||
        event.origin !== location.origin
      )
        return;
      if (event.data?.type === 'pinball-ready') tableReady = true;
      if (event.data?.type === 'pinball-error') controller.presentationFailed();
    };
    window.addEventListener('message', message);
    void controller.initialize(location.href);
    return () => {
      unsubscribe();
      controller.destroy();
      window.removeEventListener('message', message);
    };
  });

  $effect(() => {
    if (
      tableReady &&
      gameState.phase === 'presenting' &&
      gameState.outcome &&
      !presenting
    ) {
      presenting = true;
      earned = 0;
      previousBank = 0;
      bankEvent = '';
      const presenter = table();
      if (!presenter) {
        controller.presentationFailed();
        presenting = false;
        return;
      }
      void presenter
        .play(
          gameState.outcome,
          gameState.power,
          (bank, numerator, denominator) => {
            if (bank < previousBank) bankEvent = '÷2 HIT';
            else if (bank > previousBank) bankEvent = '';
            previousBank = bank;
            earned = payoutForRatio(gameState.bet, numerator, denominator);
          },
        )
        .then(() => controller.complete())
        .catch(() => controller.presentationFailed())
        .finally(() => {
          presenting = false;
        });
    }
  });
</script>

<main aria-label="Stake Pinball">
  <div class="brand" aria-label="Pinball Slot">
    <span class="brand-icon" aria-hidden="true">♤</span>
    <h1>PINBALL</h1>
    <span class="brand-subtitle">SLOT</span>
  </div>
  {#if showPayout}<div class="payout-popover">
      <span>LAST PAYOUT</span><strong>{money(gameState.win)}</strong>
    </div>{/if}
  <section class="table-area" aria-label="Pinball table">
    <iframe
      bind:this={frame}
      title="247 Pinball — Expert"
      src={`${import.meta.env.BASE_URL}reference-game/index.html`}
      allow="autoplay"
      onload={() => {
        tableReady = table()?.ready ?? false;
      }}
    ></iframe>
    <div class="table-score" class:reduced={bankEvent !== ''} aria-live="off">
      <span>ROUND PAYOUT {bankEvent ? `· ${bankEvent}` : ''}</span><strong
        >{money(earned)}</strong
      >
    </div>
  </section>
  <aside class="bet-panel" aria-label="Betting controls">
    <div class="balance">
      <svg class="wallet-icon" viewBox="0 0 32 32" aria-hidden="true"
        ><path
          d="M26 10V6L8 10m19 2H6a2 2 0 0 0-2 2v13h23V12Zm0 6h-7v6h7m-4-3h1"
        /></svg
      >
      <div class="balance-copy">
        <span>{gameState.status === 'local' ? 'DEMO BALANCE' : 'BALANCE'}</span
        ><strong>{money(gameState.balance.amount)}</strong>
      </div>
    </div>
    <div class="bet-controls">
      <div class="power-control">
        <div class="power-label">
          <label for="power">Launch power</label><output for="power"
            >{power}%</output
          >
        </div>
        <input
          id="power"
          type="range"
          min="70"
          max="100"
          step="5"
          bind:value={power}
          disabled={gameState.phase !== 'ready'}
          style={`--power:${((power - 70) / 30) * 100}%`}
        />
        <div class="range-labels"><span>SOFT</span><span>FULL POWER</span></div>
      </div>
      <div class="bet-amount">
        <button
          class="stepper"
          aria-label="Decrease bet"
          disabled={gameState.phase !== 'ready' || levels.indexOf(bet) <= 0}
          onclick={() => changeBet(-1)}>−</button
        >
        <select
          id="bet"
          aria-label="Bet amount"
          bind:value={bet}
          disabled={gameState.phase !== 'ready'}
        >
          {#each levels as amount (amount)}<option value={amount}
              >{money(amount)}</option
            >{/each}
        </select>
        <button
          class="stepper"
          aria-label="Increase bet"
          disabled={gameState.phase !== 'ready' ||
            levels.indexOf(bet) >= levels.length - 1}
          onclick={() => changeBet(1)}>+</button
        >
      </div>
      <button
        class="launch"
        disabled={gameState.phase !== 'ready' ||
          !tableReady ||
          bet > gameState.balance.amount}
        onclick={() => {
          earned = 0;
          void controller.placeBet(bet, Number(power));
        }}
      >
        <span class="play-icon" aria-hidden="true"></span>
        {gameState.phase === 'presenting'
          ? '● Ball in play'
          : gameState.phase === 'settling'
            ? 'Settling…'
            : gameState.phase === 'requesting'
              ? 'Launching…'
              : 'Bet'}
      </button>
      <p class="status" role="status">
        {!tableReady && gameState.phase !== 'error'
          ? 'Loading table…'
          : gameState.message}
      </p>
      {#if gameState.phase === 'recovery'}<button
          class="primary"
          onclick={() => controller.recover()}>Reconnect</button
        >{/if}
    </div>
    <nav class="top-actions" aria-label="Game information">
      <button
        class="icon-button"
        aria-label="Last payout"
        aria-expanded={showPayout}
        onclick={() => {
          showPayout = !showPayout;
          rules = false;
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"
          ><path
            d="M7 3h10v5c0 4-2 6-5 6S7 12 7 8V3Zm0 2H3v3c0 3 2 4 5 4m9-7h4v3c0 3-2 4-5 4M12 14v5m-4 2h8m-7-2h6"
          /></svg
        >
      </button>
      <button
        class="icon-button stats-button"
        aria-label="Round statistics"
        aria-expanded={showPayout}
        onclick={() => {
          showPayout = !showPayout;
          rules = false;
        }}>▥</button
      >
      <button
        class="icon-button settings-button"
        aria-label={muted ? 'Enable sound' : 'Mute sound'}
        aria-pressed={!muted}
        onclick={() => {
          muted = !muted;
          table()?.setMuted(muted);
        }}>⚙</button
      >
      <button
        class="icon-button info-button"
        aria-label="How to play"
        aria-expanded={rules}
        onclick={() => {
          rules = !rules;
          showPayout = false;
        }}>i</button
      >
    </nav>
    <footer>
      <button
        aria-pressed={!muted}
        onclick={() => {
          muted = !muted;
          table()?.setMuted(muted);
        }}>{muted ? 'Sound off' : 'Sound on'}</button
      >
    </footer>
    {#if rules}<div class="rules" role="region" aria-label="How to play">
        <div class="rules-heading">
          <h2>How to play</h2>
          <button
            aria-label="Close how to play"
            onclick={() => {
              rules = false;
            }}>×</button
          >
        </div>
        <p>
          Optionally choose launch power, enter your bet amount, and press Bet
          to launch one ball. Leave power unchanged to reuse the current
          setting. Your bet is charged when you press Bet. Flippers play
          automatically; there are no manual flipper or nudge controls.
        </p>
        <p>
          The original Expert table physics generates every path. Powers below
          70% do not reliably clear the shooter lane, so choose from 70–100%.
          Scoring contacts reveal the round payout. Any revealed payout is
          collected when the ball drains through the center gap or an outer
          gutter.
        </p>
        <p>
          Fixed awards: +150 or +250 points pays 0.1× your bet; +1,000 pays
          0.4×; +10,000 pays 4×. Each middle ÷2 bumper halves the credits
          already collected in this round. Your wallet balance is unaffected
          until settlement. Final payout rounds upward to the next 0.1× of your
          bet. Maximum payout: {creditRules.maxMultiplier / 100}×. RTP: 96.7% at
          every power.
        </p>
      </div>{/if}
  </aside>
  <div class="corner-score last-win" aria-label="Last payout">
    <span aria-hidden="true">☆</span><strong>{money(gameState.win)}</strong>
  </div>
  <div class="corner-score wallet-total" aria-label="Wallet balance">
    <span aria-hidden="true">◉</span><strong
      >{money(gameState.balance.amount)}</strong
    >
  </div>
</main>
