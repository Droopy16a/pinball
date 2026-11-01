import type { AuthenticateResponse, Round } from 'stake-engine';
import {
  createPlatform,
  readLaunch,
  type PlatformClient,
} from '../services/stake-engine/platform';
import { initialState, type GameState } from './GameState';
import { decodeOutcome, payoutFor } from './PinballOutcome';

export class GameController {
  state = initialState();
  private client: PlatformClient | null = null;
  private listeners = new Set<(state: GameState) => void>();
  private books: Round[] = [];
  private weights: number[] = [];
  private started = 0;
  private disposed = false;
  private launchUrl = '';

  constructor(private factory = createPlatform) {}

  subscribe(listener: (state: GameState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private update(patch: Partial<GameState>): GameState {
    this.state = { ...this.state, ...patch };
    if (!this.disposed)
      for (const listener of this.listeners) listener(this.state);
    return this.state;
  }

  async initialize(href: string): Promise<GameState> {
    this.launchUrl = href;
    try {
      const launch = readLaunch(href);
      if (launch.mode === 'local') {
        const response = await fetch(
          `${import.meta.env.BASE_URL}demo-books.json`,
        );
        if (!response.ok) throw new Error('Demo books unavailable');
        const books = (await response.json()) as {
          outcomes: Round[];
          weights: number[];
        };
        if (
          !Array.isArray(books.outcomes) ||
          !books.outcomes.length ||
          !Array.isArray(books.weights) ||
          books.weights.length !== books.outcomes.length ||
          books.weights.some((w) => !Number.isSafeInteger(w) || w <= 0)
        )
          throw new Error('Invalid demo books');
        this.books = books.outcomes;
        this.weights = books.weights;
        for (const book of this.books) decodeOutcome(book, 1_000_000);
        return this.update({
          status: 'local',
          phase: 'ready',
          balance: { amount: 100_000_000, currency: 'USD' },
          message: 'Demo credits · choose your bet',
        });
      }
      this.client = this.factory(launch);
      return this.acceptSession(await this.client.Authenticate());
    } catch {
      return this.update({
        status: 'error',
        phase: 'error',
        message:
          'Platform initialization failed. Check the launch parameters and platform session, then reload.',
      });
    }
  }

  private acceptSession(session: AuthenticateResponse): GameState {
    const bet = session.round?.active
      ? session.round.amount
      : session.config.defaultBetLevel;
    if (!Number.isSafeInteger(bet) || !bet || bet < 0)
      throw new Error('Invalid bet');
    this.update({
      status: 'connected',
      session,
      balance: session.balance,
      bet,
      minimumDuration: Math.max(
        0,
        session.jurisdictionFlags.minimumRoundDuration || 0,
      ),
    });
    if (session.round?.active) return this.acceptRound(session.round, bet);
    return this.update({
      phase: 'ready',
      round: null,
      message: 'Choose your bet',
    });
  }

  betLevels(): number[] {
    const config = this.state.session?.config;
    return config
      ? config.betLevels.filter(
          (n) =>
            Number.isSafeInteger(n) &&
            n > 0 &&
            n >= config.minBet &&
            n <= config.maxBet &&
            n % config.stepBet === 0,
        )
      : [100_000, 500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000];
  }

  arm(amount: number): void {
    if (this.state.phase !== 'ready') return;
    if (
      !this.betLevels().includes(amount) ||
      amount > this.state.balance.amount
    ) {
      this.update({ message: 'Choose an available bet within your balance.' });
      return;
    }
    this.update({
      phase: 'armed',
      bet: amount,
      win: 0,
      outcome: null,
      message: 'Ready to launch',
    });
  }

  cancel(): void {
    if (this.state.phase === 'armed')
      this.update({ phase: 'ready', message: 'Choose your bet' });
  }

  async placeBet(amount: number, power = this.state.power): Promise<void> {
    if (
      this.state.phase !== 'ready' ||
      ![70, 75, 80, 85, 90, 95, 100].includes(power)
    )
      return;
    this.arm(amount);
    await this.launch(power);
  }

  async launch(power: number): Promise<void> {
    if (
      this.state.phase !== 'armed' ||
      ![70, 75, 80, 85, 90, 95, 100].includes(power)
    )
      return;
    this.update({ phase: 'requesting', power, message: 'Launching…' });
    try {
      if (this.client) {
        const result = await this.client.Play({
          amount: this.state.bet,
          mode: `POWER_${power}`,
        });
        this.update({ balance: result.balance, round: result.round });
        if (
          result.round.mode !== `POWER_${power}` ||
          (result.round.amount !== undefined &&
            result.round.amount !== this.state.bet)
        ) {
          this.update({
            phase: 'error',
            message:
              'The saved round does not match your launch. Reload to check its platform data.',
          });
          return;
        }
        this.acceptRound(result.round, this.state.bet);
      } else {
        const random = new Uint32Array(1);
        crypto.getRandomValues(random);
        const eligible = this.books
          .map((book, index) => ({ book, weight: this.weights[index]! }))
          .filter(({ book }) => book.mode === `POWER_${power}`);
        const totalWeight = eligible.reduce(
          (sum, item) => sum + item.weight,
          0,
        );
        const limit = Math.floor(0x100000000 / totalWeight) * totalWeight;
        while (random[0]! >= limit) crypto.getRandomValues(random);
        let draw = random[0]! % totalWeight;
        let index = 0;
        while (draw >= eligible[index]!.weight)
          draw -= eligible[index++]!.weight;
        const book = eligible[index]!.book;
        const round = {
          ...book,
          amount: this.state.bet,
          payout: payoutFor(
            this.state.bet,
            decodeOutcome(book, 1_000_000).multiplier,
          ),
        };
        this.update({
          balance: {
            ...this.state.balance,
            amount: this.state.balance.amount - this.state.bet,
          },
          round,
        });
        this.acceptRound(round, this.state.bet);
      }
    } catch {
      this.update({
        phase: 'recovery',
        message:
          'Round interrupted. Reconnect to check your bet before continuing.',
      });
    }
  }

  private acceptRound(round: Round, stake: number): GameState {
    this.update({ round });
    try {
      const outcome = decodeOutcome(round, stake);
      this.started = Date.now();
      return this.update({
        phase: 'presenting',
        outcome,
        power: outcome.power,
        win: payoutFor(stake, outcome.multiplier),
        message: 'Ball in play · automatic flippers',
      });
    } catch {
      return this.update({
        phase: 'error',
        message:
          'This round contains unsupported pinball data. Your round is preserved. Reload after checking the published math files.',
      });
    }
  }

  async complete(): Promise<void> {
    if (this.state.phase !== 'presenting') return;
    this.update({ phase: 'settling', message: 'Settling round…' });
    try {
      const remaining =
        this.state.minimumDuration - (Date.now() - this.started);
      if (remaining > 0)
        await new Promise((resolve) => setTimeout(resolve, remaining));
      if (this.disposed) return;
      if (this.client && this.state.round?.active) {
        const result = await this.client.EndRound();
        this.update({ balance: result.balance });
      } else if (!this.client) {
        this.update({
          balance: {
            ...this.state.balance,
            amount: this.state.balance.amount + this.state.win,
          },
        });
      }
      this.finish();
    } catch {
      this.update({
        phase: 'recovery',
        message: 'Settlement interrupted. Reconnect to check the saved round.',
      });
    }
  }

  private finish(): void {
    const drain = this.state.outcome?.drain;
    const reason =
      drain === 'center'
        ? 'Straight down the middle'
        : drain === 'left-gutter'
          ? 'Left gutter'
          : 'Right gutter';
    this.update({
      phase: 'ready',
      round: null,
      message: `${reason} · ${this.state.win > 0 ? 'payout collected' : 'no payout'}`,
    });
  }

  async recover(): Promise<void> {
    if (this.state.phase !== 'recovery') return;
    this.update({ phase: 'loading', message: 'Checking saved round…' });
    try {
      const launch = readLaunch(this.launchUrl);
      if (launch.mode !== 'platform') {
        this.update({
          phase: 'error',
          message: 'Reload to restore demo play.',
        });
        return;
      }
      const previous = this.state.round;
      // Recreate the client: its private request lock may survive a transport failure.
      this.client = this.factory(launch);
      const session = await this.client.Authenticate();
      if (!session.round?.active && previous) {
        this.update({ session, balance: session.balance });
        this.finish();
      } else this.acceptSession(session);
    } catch {
      this.update({
        phase: 'recovery',
        message: 'Connection unavailable. Reconnect to check your saved round.',
      });
    }
  }

  presentationFailed(): void {
    this.update({
      phase: 'error',
      message: 'Table playback failed. Reload to replay the saved round.',
    });
  }
  destroy(): void {
    this.disposed = true;
    this.listeners.clear();
  }
}
