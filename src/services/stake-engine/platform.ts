import { RGSClient } from 'stake-engine';
import type {
  AuthenticateResponse,
  PlayParameters,
  PlayResponse,
  Round,
} from 'stake-engine';

export type BetRequest = PlayParameters;
export type BetResult = PlayResponse;
export type GameRound = Round;
export type Launch = { mode: 'local' } | { mode: 'platform'; url: string };
export type PlatformClient = Pick<
  ReturnType<typeof RGSClient>,
  'Authenticate' | 'Play' | 'EndRound' | 'Event'
>;
export function createPlatform(
  launch: Extract<Launch, { mode: 'platform' }>,
): PlatformClient {
  return RGSClient({ url: launch.url });
}

export function readLaunch(href: string): Launch {
  const url = new URL(href);
  const session = url.searchParams.get('sessionID');
  const host = url.searchParams.get('rgs_url');
  if (!url.searchParams.has('sessionID') && !url.searchParams.has('rgs_url'))
    return { mode: 'local' };
  if (!session || !host)
    throw new Error('Platform launch requires both sessionID and rgs_url.');
  // The official client prepends HTTPS; reject paths, schemes and credentials.
  const endpoint = new URL(`https://${host}`);
  if (
    endpoint.host !== host ||
    endpoint.pathname !== '/' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error('rgs_url must be a bare RGS host.');
  }
  return { mode: 'platform', url: url.href };
}

export async function authenticateLaunch(
  launch: Extract<Launch, { mode: 'platform' }>,
): Promise<AuthenticateResponse> {
  return createPlatform(launch).Authenticate();
}
