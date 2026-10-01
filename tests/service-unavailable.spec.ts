import { test, expect } from '@playwright/test';
import { csrfHeaders, signIn } from './browser-auth';

test('expired session returns to customer sign-in while the public website remains accessible', async ({ page }) => {
  await signIn(page, 'alice');
  await expect(page.locator('.result-card')).toHaveCount(24);
  const ended = await page.request.post('/api/v1/auth/logout', { headers: await csrfHeaders(page.request) });
  expect(ended.ok()).toBeTruthy();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByLabel('Email address', { exact: true })).toBeVisible();
  await expect(page.locator('.account-summary')).toHaveCount(0);
  await expect(page.locator('#progress')).toHaveCount(0);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Find a home that fits your commute.', exact: true })).toBeVisible();
  await signIn(page, 'alice');
  await expect(page.locator('.account-summary')).toContainText('Alice');
});

test('visitor imports, filters and saves a snapshot when the application API is unavailable', async ({ page }) => {
  let starts = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/v1/runs')) starts++; });
  await signIn(page, 'alice');
  await expect(page.locator('.result-card')).toHaveCount(24);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save results snapshot', exact: true }).click();
  const snapshot = await (await downloaded).path(); expect(snapshot).toBeTruthy();
  await page.route('**/api/v1/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'The local API is offline.', correlationId: 'synthetic-offline-check' } }) }));
  await page.goto('/open-snapshot');
  await page.reload();
  await page.getByLabel('Open a saved search snapshot', { exact: true }).setInputFiles(snapshot!);
  await expect(page.locator('.result-card')).toHaveCount(24);
  await expect(page.locator('#search-results').getByText('Saved snapshot · complete', { exact: true })).toBeVisible();
  await page.getByLabel('Maximum rent (source currency / period)', { exact: true }).fill('900');
  await expect(page.locator('.result-card')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Save results snapshot', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Recover your temporary run by ID')).toHaveCount(0);
  const savedAgain = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save results snapshot', exact: true }).click();
  expect(await (await savedAgain).path()).toBeTruthy();
  expect(starts).toBe(0);
});
