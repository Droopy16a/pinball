import type { AuthenticateResponse, Balance, Round } from 'stake-engine';
import type { PinballOutcome } from './PinballOutcome';

export interface GameState {
  status: 'loading' | 'local' | 'connected' | 'error';
  phase:
    | 'loading'
    | 'ready'
    | 'armed'
    | 'requesting'
    | 'presenting'
    | 'settling'
    | 'recovery'
    | 'error';
  message: string;
  session: AuthenticateResponse | null;
  round: Round | null;
  balance: Balance;
  outcome: PinballOutcome | null;
  bet: number;
  power: number;
  win: number;
  minimumDuration: number;
}
export const initialState = (): GameState => ({
  status: 'loading',
  message: 'Initializing platform…',
  session: null,
  round: null,
  phase: 'loading',
  balance: { amount: 0, currency: 'USD' },
  outcome: null,
  bet: 1_000_000,
  power: 85,
  win: 0,
  minimumDuration: 0,
});
