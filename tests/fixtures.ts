/// <reference types="node" />
import { readFileSync } from 'node:fs';
import type { AuthenticateResponse, Round } from 'stake-engine';
import { decodeOutcome, payoutFor } from '../src/game/PinballOutcome';
export const demo = JSON.parse(
  readFileSync(new URL('../public/demo-books.json', import.meta.url), 'utf8'),
) as { outcomes: Round[]; weights: number[] };
export function roundFor(
  power = 85,
  multiplier: number | undefined = power === 85 ? 100 : undefined,
  drain?: string,
): Round {
  const source = demo.outcomes.find((r) => {
    const event = decodeOutcome(r, 1_000_000);
    return (
      event.power === power &&
      (multiplier === undefined
        ? event.multiplier > 0
        : event.multiplier === multiplier) &&
      (!drain || event.drain === drain)
    );
  });
  if (!source) throw new Error('Missing fixture');
  const round = structuredClone(source);
  return {
    ...round,
    amount: 1_000_000,
    payout: payoutFor(1_000_000, decodeOutcome(source, 1_000_000).multiplier),
    active: decodeOutcome(source, 1_000_000).multiplier > 0,
  };
}
export function session(round: Round | null = null): AuthenticateResponse {
  return {
    balance: { amount: 100_000_000, currency: 'USD' },
    config: {
      minBet: 100_000,
      maxBet: 10_000_000,
      stepBet: 100_000,
      defaultBetLevel: 1_000_000,
      betLevels: [100_000, 500_000, 1_000_000, 5_000_000],
    },
    jurisdictionFlags: {
      socialCasino: false,
      disabledFullscreen: false,
      disabledTurbo: false,
      disabledSuperTurbo: false,
      disabledAutoplay: true,
      disabledSlamstop: false,
      disabledSpacebar: true,
      disabledBuyFeature: false,
      displayNetPosition: false,
      displayRTP: false,
      displaySessionTimer: false,
      minimumRoundDuration: 0,
    },
    round,
  };
}

// Protocol-only closed-loss fixture; never included in the physics publication library.
export function closedLossRound(): Round {
  const round = roundFor(90);
  const event = decodeOutcome(round, 1_000_000);
  event.multiplier = 0;
  for (const point of event.path) {
    point.score = 0;
    point.bank = 0;
    point.reward = 0;
    point.ops = [];
    if (point.action !== 'drain') point.action = 'travel';
  }
  return { ...round, payout: 0, active: false };
}
