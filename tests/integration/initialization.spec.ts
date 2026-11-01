import { test, expect, type Page } from '@playwright/test';
import { demo, session } from '../fixtures';
import { decodeOutcome, payoutFor } from '../../src/game/PinballOutcome';
import type { Round } from 'stake-engine';

function shortest(drain: string, paying = false): Round {
  const books = demo.outcomes.filter((r) => {
    const e = decodeOutcome(r, 1_000_000);
    return e.drain === drain && (!paying || e.multiplier > 0);
  });
  const source = books.sort(
    (a, b) =>
      decodeOutcome(a, 1_000_000).path.at(-1)!.t -
      decodeOutcome(b, 1_000_000).path.at(-1)!.t,
  )[0]!;
  const event = decodeOutcome(source, 1_000_000);
  return {
    ...structuredClone(source),
    amount: 1_000_000,
    payout: payoutFor(1_000_000, event.multiplier),
    active: event.multiplier > 0,
  };
}
async function tableReady(page: Page) {
  await expect(page.frameLocator('iframe').locator('#preloader')).toHaveClass(
    'close',
  );
}
async function mockRgs(page: Page, round: Round, resume = false) {
  const requests: { path: string; body: unknown }[] = [];
  await page.route('https://rgs.example/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push({ path, body: route.request().postDataJSON() });
    if (path === '/wallet/authenticate') {
      const s = session(resume ? round : null);
      await route.fulfill({
        json: {
          balance: s.balance,
          config: { ...s.config, jurisdiction: s.jurisdictionFlags },
          round: s.round,
        },
      });
    } else if (path === '/wallet/play') {
      await route.fulfill({
        json: { balance: { amount: 99_000_000, currency: 'USD' }, round },
      });
    } else if (path === '/wallet/end-round') {
      await route.fulfill({
        json: {
          balance: { amount: 99_000_000 + round.payout!, currency: 'USD' },
        },
      });
    } else await route.fulfill({ json: { balance: session().balance } });
  });
  return requests;
}

test('table loads with Stake hosting font security policy', async ({ page }) => {
  const missing: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400) missing.push(response.url());
  });
  await page.route('**/reference-game/index.html', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        'content-security-policy': "font-src 'self' https://fonts.gstatic.com",
      },
    });
  });
  await page.goto('/');
  await tableReady(page);
  await expect(page.getByRole('button', { name: 'Bet', exact: true })).toBeEnabled();
  expect(missing).toEqual([]);
});

test('original Expert table and wager controls load locally, fit mobile, and make no external requests', async ({
  page,
}, testInfo) => {
  const errors: string[] = [],
    external: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (req) => {
    if (
      !req.url().startsWith('http://127.0.0.1:5173') &&
      !req.url().startsWith('data:')
    )
      external.push(req.url());
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await tableReady(page);
  await expect(
    page.getByRole('button', { name: 'Bet', exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel('Launch power')).toBeEnabled();
  await expect(page.getByLabel('Launch power')).toHaveValue('85');
  await expect(page.getByText('DEMO BALANCE')).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('stake-pinball-desktop.png'),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.getByLabel('Launch power').fill('90');
  await expect(page.getByLabel('Bet amount')).toBeEnabled();
  await page
    .getByRole('button', { name: 'Bet', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath('stake-pinball-mobile.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

for (const drain of ['center', 'left-gutter', 'right-gutter']) {
  test(`SDK wager plays a measured ${drain} drain and settles only after presentation`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const round = shortest(drain, drain === 'right-gutter');
    const event = decodeOutcome(round, 1_000_000);
    const requests = await mockRgs(page, round);
    await page.goto('/?sessionID=test-only&rgs_url=rgs.example&demo=true');
    await tableReady(page);
    expect(requests.map((r) => r.path)).toEqual(['/wallet/authenticate']);
    await page.getByLabel('Launch power').fill(String(event.power));
    await page.getByRole('button', { name: 'Bet', exact: true }).click();
    await expect(page.locator('.status')).toContainText('Ball in play');
    expect(requests.find((r) => r.path === '/wallet/play')?.body).toEqual({
      sessionID: 'test-only',
      amount: 1_000_000,
      mode: `POWER_${event.power}`,
    });
    expect(requests.filter((r) => r.path === '/wallet/end-round')).toHaveLength(
      0,
    );
    await expect(page.getByLabel('Bet amount')).toBeDisabled();
    // Keyboard inputs cannot introduce a tilt, manual miss, or additional wallet request.
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowLeft');
    await expect(
      page.getByRole('button', { name: 'Bet', exact: true }),
    ).toBeEnabled({ timeout: 15000 });
    const label =
      drain === 'center'
        ? 'Straight down the middle'
        : drain === 'left-gutter'
          ? 'Left gutter'
          : 'Right gutter';
    await expect(page.locator('.status')).toContainText(label);
    expect(requests.filter((r) => r.path === '/wallet/play')).toHaveLength(1);
    expect(requests.filter((r) => r.path === '/wallet/end-round')).toHaveLength(
      round.active ? 1 : 0,
    );
    expect(errors).toEqual([]);
  });
}

test('an interrupted round resumes its original power without a second wager', async ({
  page,
}) => {
  const round = shortest('right-gutter', true);
  const requests = await mockRgs(page, round, true);
  await page.goto('/?sessionID=test-only&rgs_url=rgs.example');
  await tableReady(page);
  await expect(page.locator('.status')).toContainText('Ball in play');
  await expect(
    page.getByRole('button', { name: 'Bet', exact: true }),
  ).toBeEnabled({ timeout: 15000 });
  expect(requests.map((r) => r.path)).toEqual([
    '/wallet/authenticate',
    '/wallet/end-round',
  ]);
});

test('published motion reproduces the original fixed-step physics for two launch powers', async ({
  page,
}) => {
  await page.goto('/');
  await tableReady(page);
  const frame = page
    .frames()
    .find((f) => f.url().includes('/reference-game/'))!;
  for (const power of [70, 100]) {
    const round = demo.outcomes.find(
      (r) => decodeOutcome(r, 1_000_000).power === power,
    )!;
    const event = decodeOutcome(round, 1_000_000);
    const measured = await frame.evaluate(({ power, seed }) => {
      const table = (
        window as unknown as {
          pinballTable: {
            simulate: (
              power: number,
              seed: number,
              horizon: number,
            ) => { path: unknown[] };
          };
        }
      ).pinballTable;
      return table.simulate(power, seed, 45000).path;
    }, event);
    expect(measured).toEqual(
      event.path.map(({ t, x, y, floor, left, right, score, bank, ops }) => ({
        t,
        x,
        y,
        floor,
        left,
        right,
        score,
        bank,
        ops,
      })),
    );
  }
});

test('failed authentication shows a safe error and blocks bets', async ({
  page,
}) => {
  await page.route('https://rgs.example/**', (route) =>
    route.fulfill({ status: 400, json: { code: 'ERR_IS' } }),
  );
  await page.goto('/?sessionID=test-only&rgs_url=rgs.example');
  await expect(page.locator('.status')).toContainText(
    'Platform initialization failed',
  );
  await expect(
    page.getByRole('button', { name: 'Bet', exact: true }),
  ).toBeDisabled();
});

test('original collision-driven bonus cutscene plays before the wager settles', async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  const source = demo.outcomes
    .filter((round) => {
      const path = decodeOutcome(round, 1_000_000).path;
      return path.some(
        (point, index) =>
          index > 0 && point.score - path[index - 1]!.score >= 10_000,
      );
    })
    .sort(
      (a, b) =>
        decodeOutcome(a, 1_000_000).path.at(-1)!.t -
        decodeOutcome(b, 1_000_000).path.at(-1)!.t,
    )[0]!;
  const event = decodeOutcome(source, 1_000_000);
  const round = {
    ...structuredClone(source),
    amount: 1_000_000,
    payout: payoutFor(1_000_000, event.multiplier),
    active: true,
  };
  const requests = await mockRgs(page, round);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?sessionID=test-only&rgs_url=rgs.example');
  await tableReady(page);
  await page.getByLabel('Launch power').fill(String(event.power));
  await page.getByRole('button', { name: 'Bet', exact: true }).click();
  const frame = page
    .frames()
    .find((f) => f.url().includes('/reference-game/'))!;
  const presentation = () =>
    frame.evaluate(
      () =>
        (
          window as unknown as {
            pinballTable: {
              presentation: {
                score: number;
                cutscene: boolean;
                bonusVisible: boolean;
              };
            };
          }
        ).pinballTable.presentation,
    );
  await expect
    .poll(async () => (await presentation()).cutscene, {
      timeout: 40000,
      intervals: [100],
    })
    .toBe(true);
  expect((await presentation()).bonusVisible).toBe(true);
  expect((await presentation()).score).toBeGreaterThan(10_000);
  expect(requests.filter((r) => r.path === '/wallet/end-round')).toHaveLength(
    0,
  );
  await expect(page.locator('.status')).toContainText('Ball in play');
  await page.screenshot({
    path: testInfo.outputPath('original-bonus-cutscene.png'),
  });
  await expect(
    page.getByRole('button', { name: 'Bet', exact: true }),
  ).toBeEnabled({ timeout: 20000 });
  expect(requests.filter((r) => r.path === '/wallet/play')).toHaveLength(1);
  expect(requests.filter((r) => r.path === '/wallet/end-round')).toHaveLength(
    1,
  );
  expect(errors).toEqual([]);
});

test('Bet launches directly without changing power and retains the setting for the next bet', async ({
  page,
}) => {
  const source = demo.outcomes
    .filter((round) => round.mode === 'POWER_85')
    .sort(
      (a, b) =>
        decodeOutcome(a, 1_000_000).path.at(-1)!.t -
        decodeOutcome(b, 1_000_000).path.at(-1)!.t,
    )[0]!;
  const event = decodeOutcome(source, 1_000_000);
  const round = {
    ...structuredClone(source),
    amount: 1_000_000,
    payout: payoutFor(1_000_000, event.multiplier),
    active: true,
  };
  const requests = await mockRgs(page, round);
  await page.goto('/?sessionID=test-only&rgs_url=rgs.example');
  await tableReady(page);
  await expect(page.getByLabel('Launch power')).toBeEnabled();
  await expect(page.getByLabel('Launch power')).toHaveValue('85');
  await expect(page.getByLabel('Bet amount')).toBeEnabled();
  await page.getByRole('button', { name: 'Bet', exact: true }).click();
  await expect(page.locator('.status')).toContainText('Ball in play');
  expect(requests.find((r) => r.path === '/wallet/play')?.body).toEqual({
    sessionID: 'test-only',
    amount: 1_000_000,
    mode: 'POWER_85',
  });
  await expect(page.getByLabel('Launch power')).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Bet', exact: true }),
  ).toBeEnabled({ timeout: 15000 });
  await expect(page.getByLabel('Launch power')).toHaveValue('85');
  await page.getByRole('button', { name: 'Bet', exact: true }).click();
  await expect(page.locator('.status')).toContainText('Ball in play');
  expect(requests.filter((r) => r.path === '/wallet/play')).toHaveLength(2);
});

test('both middle dividers are visible and a physical hit halves the live round credits', async ({
  page,
}, testInfo) => {
  const source = demo.outcomes.find((r) => {
    const e = decodeOutcome(r, 1_000_000);
    return e.power === 70 && e.seed === 7351;
  })!;
  const event = decodeOutcome(source, 1_000_000);
  const round = {
    ...structuredClone(source),
    amount: 1_000_000,
    payout: payoutFor(1_000_000, event.multiplier),
    active: true,
  };
  const requests = await mockRgs(page, round);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/?sessionID=test-only&rgs_url=rgs.example');
  await tableReady(page);
  const frame = page
    .frames()
    .find((f) => f.url().includes('/reference-game/'))!;
  const positions = await frame.evaluate(
    () =>
      (
        window as unknown as {
          pinballTable: {
            presentation: { dividers: { x: number; y: number }[] };
          };
        }
      ).pinballTable.presentation.dividers,
  );
  expect(positions).toEqual([
    { x: 690, y: 1190 },
    { x: 1030, y: 1390 },
  ]);
  await page.getByLabel('Launch power').fill('70');
  await page.getByRole('button', { name: 'Bet', exact: true }).click();
  await expect
    .poll(() => page.locator('.table-score span').textContent(), {
      timeout: 10000,
      intervals: [20],
    })
    .toContain('÷2 HIT');
  const presentation = await frame.evaluate(
    () =>
      (
        window as unknown as {
          pinballTable: { presentation: { bank: number } };
        }
      ).pinballTable.presentation,
  );
  expect(presentation.bank).toBe(45); // 0.90x becomes 0.45x at the actual bumper collision.
  await page.screenshot({
    path: testInfo.outputPath('middle-divider-hit.png'),
  });
  expect(requests.filter((r) => r.path === '/wallet/end-round')).toHaveLength(
    0,
  );
  await expect(
    page.getByRole('button', { name: 'Bet', exact: true }),
  ).toBeEnabled({ timeout: 10000 });
  expect(requests.filter((r) => r.path === '/wallet/end-round')).toHaveLength(
    1,
  );
});
