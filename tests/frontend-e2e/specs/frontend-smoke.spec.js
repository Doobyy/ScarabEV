import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function extractScarabNamesFromConfig() {
  const configPath = join(process.cwd(), '..', '..', 'js', 'config.js');
  const text = readFileSync(configPath, 'utf8');
  const start = text.indexOf('export const POE_RE_TOKENS = {');
  const end = text.indexOf('};', start);
  const block = start >= 0 && end > start ? text.slice(start, end) : text;
  const names = [];
  const rx = /"([^"]+)":\s*"[^"]+"/g;
  let match;
  while ((match = rx.exec(block)) !== null) names.push(match[1]);
  return names.slice(0, 25);
}

function mockWorkerPayload(names) {
  const items = names.map((name, i) => ({
    id: `id-${i + 1}`,
    name,
    image: '/image/Art/2DItems/Currency/Scarabs/DivinationScarab.png'
  }));
  const lines = names.map((name, i) => ({
    id: `id-${i + 1}`,
    primaryValue: 20 + i,
    sparkline: { totalChange: 0, data: [0, 0, 0, 0, 0, 0, 0] }
  }));
  return { items, lines };
}

test('frontend loads and main tab interactions work', async ({ page }) => {
  const names = extractScarabNamesFromConfig();
  const scarabPayload = mockWorkerPayload(names);

  await page.route('**/scarabev-market-worker.paperpandastacks.workers.dev/**', async (route) => {
    const reqUrl = route.request().url();
    if (reqUrl.includes('type=CurrentLeague')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ league: 'Mirage' })
      });
      return;
    }
    if (reqUrl.includes('type=Currency')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [{ id: 'cur-1', name: 'Divine Orb', image: '/image/Art/2DItems/Currency/CurrencyModValues.dds' }],
          lines: [{ id: 'cur-1', primaryValue: 300 }]
        })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(scarabPayload)
    });
  });

  await page.route('**/scarabev-backend-*.paperpandastacks.workers.dev/public/token-set/latest', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        versionId: 'e2e-token-set',
        itemCount: names.length,
        tokensByName: Object.fromEntries(names.map((n, i) => [n, `tok${i + 1}`]))
      })
    });
  });

  await page.route('**/scarabev-api.paperpandastacks.workers.dev/**', async (route) => {
    const reqUrl = route.request().url();
    if (reqUrl.includes('/api/aggregate')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ weights: {}, totalTrades: 0, weightMeta: { reason: 'e2e' } })
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/');
  await expect(page.locator('#ninjaStatus')).toBeVisible();
  await page.click('#tab-ninja');
  await page.evaluate(() => {
    if (typeof window.fetchMarketScarabPrices === 'function') {
      return window.fetchMarketScarabPrices();
    }
    return null;
  });
  await expect(page.locator('#n-tableBody .scarab-row').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#ninjaStatus')).toContainText(/loaded/i, { timeout: 15000 });

  await page.getByRole('button', { name: 'Session Logger' }).first().click();
  await expect(page).toHaveURL(/#logger/);
  await expect(page.locator('#tab-logger')).toBeVisible();
});

test('slider ROI source follows recommendation maturity rules', async ({ page }) => {
  const names = extractScarabNamesFromConfig();
  const scarabPayload = mockWorkerPayload(names);
  let aggregatePayload = {
    weights: {},
    totalTrades: 0,
    weightMeta: { reason: 'e2e' }
  };

  await page.route('**/scarabev-market-worker.paperpandastacks.workers.dev/**', async (route) => {
    const reqUrl = route.request().url();
    if (reqUrl.includes('type=CurrentLeague')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ league: 'Mirage' })
      });
      return;
    }
    if (reqUrl.includes('type=Currency')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [{ id: 'cur-1', name: 'Divine Orb', image: '/image/Art/2DItems/Currency/CurrencyModValues.dds' }],
          lines: [{ id: 'cur-1', primaryValue: 300 }]
        })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(scarabPayload)
    });
  });

  await page.route('**/scarabev-backend-*.paperpandastacks.workers.dev/public/token-set/latest', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        versionId: 'e2e-token-set',
        itemCount: names.length,
        tokensByName: Object.fromEntries(names.map((n, i) => [n, `tok${i + 1}`]))
      })
    });
  });

  await page.route('**/scarabev-api*.paperpandastacks.workers.dev/**', async (route) => {
    const reqUrl = route.request().url();
    if (reqUrl.includes('/api/aggregate')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(aggregatePayload)
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/');
  await expect(page.locator('#ninjaStatus')).toBeVisible();
  await page.click('#tab-ninja');
  await page.evaluate(() => {
    if (typeof window.fetchMarketScarabPrices === 'function') {
      return window.fetchMarketScarabPrices();
    }
    return null;
  });
  await expect(page.locator('#n-tableBody .scarab-row').first()).toBeVisible({ timeout: 15000 });

  const weightedName = names[names.length - 1];
  const weightMap = { [weightedName]: 1 };

  // Immature recommendation: harmonic is recommended, so harmonic/weighted modes use different ROI sources.
  aggregatePayload = {
    weights: weightMap,
    totalTrades: 100,
    weightMeta: { alphaGlobal: 0.5 }
  };
  const immatureResult = await page.evaluate(async () => {
    await window.fetchObservedWeights();
    window.setEVMode('harmonic');
    window.updateSliderROI(30);
    const harmonicRoi = document.getElementById('sliderROI')?.textContent || '';
    window.setEVMode('weighted');
    window.updateSliderROI(30);
    const weightedRoi = document.getElementById('sliderROI')?.textContent || '';
    return { harmonicRoi, weightedRoi };
  });
  expect(immatureResult.harmonicRoi).not.toBe(immatureResult.weightedRoi);

  // Mature recommendation: weighted is recommended, so both modes must use weighted ROI evaluation.
  aggregatePayload = {
    weights: weightMap,
    totalTrades: 100,
    weightMeta: { mode: 'challenge-current-only' }
  };
  const matureResult = await page.evaluate(async () => {
    await window.fetchObservedWeights();
    window.setEVMode('weighted');
    window.updateSliderROI(30);
    const weightedRoi = document.getElementById('sliderROI')?.textContent || '';
    window.setEVMode('harmonic');
    window.updateSliderROI(30);
    const harmonicRoi = document.getElementById('sliderROI')?.textContent || '';
    return { harmonicRoi, weightedRoi };
  });
  expect(matureResult.harmonicRoi).toBe(matureResult.weightedRoi);
});
