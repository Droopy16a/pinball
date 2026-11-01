import { describe, expect, it, vi } from 'vitest';
import { GameController } from '../../src/game/GameController';
import {
  decodeOutcome,
  awardFor,
  payoutForRatio,
} from '../../src/game/PinballOutcome';
import { demo, roundFor, session, closedLossRound } from '../fixtures';
const url = 'https://game.example/?sessionID=test&rgs_url=rgs.example';
function setup() {
  const api = {
    Authenticate: vi.fn().mockResolvedValue(session()),
    Play: vi.fn().mockResolvedValue({
      balance: { amount: 99_000_000, currency: 'USD' },
      round: roundFor(),
    }),
    EndRound: vi
      .fn()
      .mockResolvedValue({ balance: { amount: 100_000_000, currency: 'USD' } }),
    Event: vi.fn(),
  };
  return { api, controller: new GameController(() => api) };
}
describe('one wager, one measured physics book', () => {
  it('locks the bet, sends the chosen physical power, and settles after presentation exactly once', async () => {
    const { api, controller } = setup();
    await controller.initialize(url);
    controller.arm(1_000_000);
    expect(api.Play).not.toHaveBeenCalled();
    await Promise.all([controller.launch(85), controller.launch(85)]);
    expect(api.Play).toHaveBeenCalledExactlyOnceWith({
      amount: 1_000_000,
      mode: 'POWER_85',
    });
    expect(controller.state.phase).toBe('presenting');
    expect(api.EndRound).not.toHaveBeenCalled();
    await Promise.all([controller.complete(), controller.complete()]);
    expect(api.EndRound).toHaveBeenCalledTimes(1);
    expect(controller.state.balance.amount).toBe(100_000_000);
    expect(controller.state.phase).toBe('ready');
  });
  it('never settles a zero-win round that Stake already closed', async () => {
    const { api, controller } = setup();
    api.Play.mockResolvedValue({
      balance: { amount: 99_000_000, currency: 'USD' },
      round: closedLossRound(),
    });
    await controller.initialize(url);
    controller.arm(1_000_000);
    await controller.launch(90);
    await controller.complete();
    expect(api.EndRound).not.toHaveBeenCalled();
    expect(controller.state.win).toBe(0);
  });
  it('resumes a saved round without another bet or changing its launch power', async () => {
    const { api, controller } = setup();
    api.Authenticate.mockResolvedValue(session(roundFor(75, 150)));
    await controller.initialize(url);
    expect(controller.state.power).toBe(75);
    expect(controller.state.phase).toBe('presenting');
    expect(api.Play).not.toHaveBeenCalled();
    await controller.complete();
    expect(api.EndRound).toHaveBeenCalledTimes(1);
  });
  it('checks the server after a lost Play response rather than charging another bet', async () => {
    const { api, controller } = setup();
    api.Play.mockRejectedValue(new Error('Lost response'));
    await controller.initialize(url);
    controller.arm(1_000_000);
    await controller.launch(85);
    expect(controller.state.phase).toBe('recovery');
    await controller.launch(85);
    api.Authenticate.mockResolvedValue(session(roundFor()));
    await controller.recover();
    expect(api.Play).toHaveBeenCalledTimes(1);
    expect(controller.state.phase).toBe('presenting');
  });
  it('uses the server balance when settlement succeeded but its response was lost', async () => {
    const { api, controller } = setup();
    api.EndRound.mockRejectedValue(new Error('Lost response'));
    await controller.initialize(url);
    controller.arm(1_000_000);
    await controller.launch(85);
    await controller.complete();
    expect(controller.state.phase).toBe('recovery');
    api.Authenticate.mockResolvedValue(session());
    await controller.recover();
    expect(api.EndRound).toHaveBeenCalledTimes(1);
    expect(controller.state.phase).toBe('ready');
  });
  it('preserves an unsupported book without settling or rolling a replacement', async () => {
    const { api, controller } = setup();
    const round = { ...roundFor(), state: [] };
    api.Authenticate.mockResolvedValue(session(round));
    await controller.initialize(url);
    expect(controller.state.phase).toBe('error');
    expect(controller.state.round).toEqual(round);
    expect(api.Play).not.toHaveBeenCalled();
    expect(api.EndRound).not.toHaveBeenCalled();
  });
  it('rejects unavailable stakes and powers before calling the SDK', async () => {
    const { api, controller } = setup();
    await controller.initialize(url);
    controller.arm(1_234_567);
    expect(controller.state.phase).toBe('ready');
    controller.arm(1_000_000);
    await controller.launch(65);
    expect(api.Play).not.toHaveBeenCalled();
  });
});
describe('published physics contract', () => {
  it('validates every book, all natural drains, and equal 96.7% return at every physical power', () => {
    const drains = new Set();
    for (const power of [70, 75, 80, 85, 90, 95, 100]) {
      let paid = 0,
        weight = 0;
      demo.outcomes.forEach((round, index) => {
        const event = decodeOutcome(round, 1_000_000);
        drains.add(event.drain);
        if (event.power !== power) return;
        paid += event.multiplier * demo.weights[index]!;
        weight += demo.weights[index]!;
        expect(event.path.at(-1)!.y).toBeGreaterThan(2388);
      });
      expect(paid / (weight * 100)).toBe(0.967);
    }
    expect([...drains].sort()).toEqual([
      'center',
      'left-gutter',
      'right-gutter',
    ]);
  });
  it('rejects inconsistent payouts or power modes', () => {
    const round = roundFor();
    expect(() => decodeOutcome({ ...round, payout: 123 }, 1_000_000)).toThrow();
    expect(() =>
      decodeOutcome({ ...round, mode: 'POWER_70' }, 1_000_000),
    ).toThrow();
  });
});

it('gives each bonus the same price in every mode and keeps divider operations explicit', () => {
  const prices = new Map<number, Set<number>>();
  let dividerHits = 0;
  for (const round of demo.outcomes) {
    const event = decodeOutcome(round, 1_000_000);
    for (const point of event.path)
      for (const operation of point.ops) {
        if (operation.kind === 'award') {
          expect(operation.amount).toBe(awardFor(operation.points));
          const values = prices.get(operation.points) ?? new Set<number>();
          values.add(operation.amount);
          prices.set(operation.points, values);
        } else if (operation.kind === 'halve') dividerHits++;
      }
  }
  expect(dividerHits).toBeGreaterThan(0);
  expect(prices.get(1000)).toEqual(new Set([40]));
  expect(prices.get(10000)).toEqual(new Set([400]));
  for (const values of prices.values()) expect(values.size).toBe(1);
});

it('rejects altered bonus prices and bank reductions', () => {
  const round = roundFor();
  const event = decodeOutcome(round, 1_000_000);
  const operation = event.path
    .flatMap((p) => p.ops)
    .find((o) => o.kind === 'award')!;
  if (operation.kind === 'award') operation.amount++;
  expect(() => decodeOutcome(round, 1_000_000)).toThrow(
    'Invalid fixed bonus price',
  );
  const another = roundFor();
  decodeOutcome(another, 1_000_000).path[5]!.bank = 999;
  expect(() => decodeOutcome(another, 1_000_000)).toThrow(
    'Credit ledger mismatch',
  );
});

it('calculates fractional halved credits without floating point money arithmetic', () => {
  expect(payoutForRatio(1_000_000, '15', '2')).toBe(75000);
  expect(payoutForRatio(100_000, '15', '4')).toBe(3750);
});

it('places one bet immediately with unchanged default power and ignores a duplicate click', async () => {
  const { api, controller } = setup();
  await controller.initialize(url);
  await Promise.all([
    controller.placeBet(1_000_000),
    controller.placeBet(1_000_000),
  ]);
  expect(api.Play).toHaveBeenCalledExactlyOnceWith({
    amount: 1_000_000,
    mode: 'POWER_85',
  });
  expect(controller.state.phase).toBe('presenting');
});

it('allows power selection before the bet and reuses that power for the next bet', async () => {
  const { api, controller } = setup();
  api.Play.mockResolvedValue({
    balance: { amount: 99_000_000, currency: 'USD' },
    round: roundFor(90, 120),
  });
  await controller.initialize(url);
  await controller.placeBet(1_000_000, 90);
  expect(api.Play).toHaveBeenLastCalledWith({
    amount: 1_000_000,
    mode: 'POWER_90',
  });
  await controller.complete();
  await controller.placeBet(1_000_000);
  expect(api.Play).toHaveBeenCalledTimes(2);
  expect(api.Play).toHaveBeenLastCalledWith({
    amount: 1_000_000,
    mode: 'POWER_90',
  });
});
