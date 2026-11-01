import type { Round } from 'stake-engine';
import rules from './credit-rules.json' with { type: 'json' };

export type Drain = 'center' | 'left-gutter' | 'right-gutter';
export type CreditOperation =
  | { kind: 'award'; points: number; amount: number }
  | { kind: 'halve'; bumper: 0 | 1 }
  | { kind: 'settle'; amount: number };
export interface PathPoint {
  t: number;
  x: number;
  y: number;
  reward: number;
  floor: number;
  left: boolean;
  right: boolean;
  score: number;
  bank: number;
  ops: CreditOperation[];
  action: 'travel' | 'bonus' | 'halve' | 'drain';
}
export interface PinballOutcome {
  index: number;
  type: 'pinball';
  version: 3;
  power: number;
  seed: number;
  physics: '247-expert-dividers-v1';
  step: 2;
  multiplier: number; // Final payout, in hundredths of the stake.
  drain: Drain;
  path: PathPoint[];
}
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;
export function awardFor(points: number): number {
  if (!Number.isSafeInteger(points) || points <= 0)
    throw new Error('Invalid award');
  return Math.max(
    rules.awardUnitMultiplier,
    Math.floor((points + rules.awardUnitPoints / 2) / rules.awardUnitPoints) *
      rules.awardUnitMultiplier,
  );
}

// Replay the monetary ledger independently of the animation, using exact fractions.
export function decodeOutcome(round: Round, stake: number): PinballOutcome {
  if (!Array.isArray(round.state) || round.state.length !== 1)
    throw new Error('Unsupported book');
  const event: unknown = round.state[0];
  if (
    !record(event) ||
    event.type !== 'pinball' ||
    event.version !== 3 ||
    event.index !== 0 ||
    event.physics !== '247-expert-dividers-v1' ||
    event.step !== 2 ||
    typeof event.power !== 'number' ||
    ![70, 75, 80, 85, 90, 95, 100].includes(event.power) ||
    !Number.isSafeInteger(event.seed) ||
    (event.seed as number) < 0 ||
    (event.seed as number) > 0xffffffff ||
    !Number.isSafeInteger(event.multiplier) ||
    (event.multiplier as number) < 0 ||
    (event.multiplier as number) > rules.maxMultiplier ||
    (event.multiplier as number) % rules.settlementIncrement !== 0 ||
    !['center', 'left-gutter', 'right-gutter'].includes(String(event.drain)) ||
    !Array.isArray(event.path) ||
    event.path.length < 100 ||
    event.path.length > 9000
  )
    throw new Error('Invalid pinball outcome');
  let time = -1,
    score = 0,
    bank = 0;
  let numerator = 0n,
    denominator = 1n;
  for (const value of event.path as unknown[]) {
    if (
      !record(value) ||
      typeof value.t !== 'number' ||
      !Number.isFinite(value.t) ||
      value.t <= time ||
      value.t < 0 ||
      value.t > 150000 ||
      typeof value.x !== 'number' ||
      !Number.isFinite(value.x) ||
      value.x < 20 ||
      value.x > 1648 ||
      typeof value.y !== 'number' ||
      !Number.isFinite(value.y) ||
      value.y < 25 ||
      value.y > 2460 ||
      typeof value.floor !== 'number' ||
      ![5, 6, 7].includes(value.floor) ||
      typeof value.left !== 'boolean' ||
      typeof value.right !== 'boolean' ||
      !Number.isSafeInteger(value.score) ||
      (value.score as number) < score ||
      typeof value.bank !== 'number' ||
      !Number.isFinite(value.bank) ||
      value.bank < 0 ||
      value.bank > 1000000 ||
      typeof value.reward !== 'number' ||
      !Number.isFinite(value.reward) ||
      !Array.isArray(value.ops) ||
      value.ops.length > 100 ||
      !['travel', 'bonus', 'halve', 'drain'].includes(String(value.action))
    )
      throw new Error('Invalid pinball path');
    const last = value === event.path.at(-1);
    let awardedPoints = 0;
    for (const operation of value.ops as unknown[]) {
      if (!record(operation)) throw new Error('Invalid credit operation');
      if (operation.kind === 'award') {
        if (
          typeof operation.points !== 'number' ||
          operation.amount !== awardFor(operation.points)
        )
          throw new Error('Invalid fixed bonus price');
        numerator += BigInt(operation.amount as number) * denominator;
        awardedPoints += operation.points;
      } else if (operation.kind === 'halve') {
        if (operation.bumper !== 0 && operation.bumper !== 1)
          throw new Error('Unknown divider');
        denominator *= 2n;
      } else if (operation.kind === 'settle') {
        if (!last) throw new Error('Early settlement');
        const unit = BigInt(rules.settlementIncrement);
        const rounded =
          ((numerator + unit * denominator - 1n) / (unit * denominator)) * unit;
        if (operation.amount !== Number(rounded))
          throw new Error('Invalid settlement rounding');
        numerator = rounded;
        denominator = 1n;
      } else throw new Error('Unknown credit operation');
    }
    const current = Number(numerator) / Number(denominator);
    if (
      (value.score as number) - score !== awardedPoints ||
      value.bank !== current ||
      value.reward !== current - bank
    )
      throw new Error('Credit ledger mismatch');
    if (value.action === 'drain' && !last) throw new Error('Early drain');
    time = value.t;
    score = value.score as number;
    bank = current;
  }
  const result = event as unknown as PinballOutcome;
  const first = result.path[0]!,
    end = result.path.at(-1)!;
  const approach = [...result.path]
    .reverse()
    .find((p) => p.y >= 1800 && p.y < 1970);
  if (
    first.t !== 0 ||
    first.x !== 1581 ||
    first.y < 1800 ||
    first.y > 2000 ||
    end.action !== 'drain' ||
    end.y <= 2388 ||
    time < 2000 ||
    !approach ||
    numerator !== BigInt(result.multiplier) * denominator ||
    (result.drain === 'center' && (approach.x < 150 || approach.x > 1390)) ||
    (result.drain === 'left-gutter' && approach.x >= 150) ||
    (result.drain === 'right-gutter' && approach.x <= 1390) ||
    round.mode !== `POWER_${result.power}`
  )
    throw new Error('Invalid drain or payout');
  if (
    round.payout !== undefined &&
    round.payout !== payoutFor(stake, result.multiplier)
  )
    throw new Error('Payout mismatch');
  return result;
}
export function payoutForRatio(
  stake: number,
  numerator: string,
  denominator: string,
): number {
  if (!Number.isSafeInteger(stake) || stake < 0)
    throw new Error('Invalid stake');
  const n = BigInt(numerator),
    d = BigInt(denominator);
  if (n < 0n || d <= 0n) throw new Error('Invalid credit fraction');
  const amount = (BigInt(stake) * n) / (100n * d);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('Payout overflow');
  return Number(amount);
}
export function payoutFor(stake: number, multiplier: number): number {
  return payoutForRatio(stake, String(multiplier), '1');
}
