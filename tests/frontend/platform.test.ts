import { afterEach, describe, expect, it, vi } from 'vitest';
import { readLaunch } from '../../src/services/stake-engine/platform';
import { GameController } from '../../src/game/GameController';
import { demo } from '../fixtures';
afterEach(() => vi.unstubAllGlobals());
describe('launch boundary', () => {
  it('runs locally without inventing a session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => demo }),
    );
    expect(readLaunch('http://localhost/')).toEqual({ mode: 'local' });
    const state = await new GameController().initialize('http://localhost/');
    expect(state.status).toBe('local');
    expect(state.phase).toBe('ready');
    expect(state.session).toBeNull();
  });
  it('preserves platform parameters', () => {
    const url =
      'https://game.example/?sessionID=test&rgs_url=rgs.example&demo=true';
    expect(readLaunch(url)).toEqual({ mode: 'platform', url });
  });
  it.each([
    '?sessionID=x',
    '?rgs_url=rgs.example',
    '?sessionID=&rgs_url=rgs.example',
    '?sessionID=x&rgs_url=https://rgs.example',
    '?sessionID=x&rgs_url=user@rgs.example',
    '?sessionID=x&rgs_url=rgs.example/path',
  ])('rejects malformed launch %s', (query) => {
    expect(() => readLaunch(`https://game.example/${query}`)).toThrow();
  });
  it('returns a safe error without echoing credentials', async () => {
    const result = await new GameController().initialize(
      'https://game.example/?sessionID=secret',
    );
    expect(result.status).toBe('error');
    expect(result.message).not.toContain('secret');
  });
});
