import { test, expect, type Page } from '@playwright/test';
import { navigation, signIn, signOut } from './browser-auth';

async function scenario(page: Page, id: string) {
  if (await page.getByRole('button', { name: 'Sign out', exact: true }).count()) await signOut(page);
  await signIn(page, id);
}
async function configure(page: Page) {
  await page.getByRole('button', { name: 'Custom commute', exact: true }).click();
  await page.getByLabel('Destination name or address').fill('EPFL');
  await page.getByRole('button', { name: 'Find destination', exact: true }).click();
  await page.getByRole('button', { name: /Confirm this destination: EPFL.*east/ }).click();
  await page.getByRole('button', { name: 'Review custom run', exact: true }).click();
}

test('private run survives reload, refuses another account and recovers without another calculation', async ({ page }) => {
  let starts = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/v1/runs')) starts++; });
  await page.goto('/'); await scenario(page, 'bob'); await configure(page);
  await page.getByRole('button', { name: 'Confirm and start one run', exact: true }).click();
  await expect(page.locator('#progress').getByText('COMPLETE · allowance finalised', { exact: true })).toBeVisible();
  const id = (await page.locator('#progress code').textContent())!;
  await expect(page.locator('.result-card')).toHaveCount(24);
  await page.reload();
  await expect(page.locator('.account-summary')).toContainText('Bob');
  await expect(page.locator('#progress')).toHaveCount(0);
  await expect(page.locator('.result-card')).toHaveCount(24);
  await scenario(page, 'alice');
  await page.getByRole('button', { name: 'Open / save snapshot', exact: true }).click();
  await page.getByLabel('Recover your temporary run by ID').fill(id);
  await page.getByRole('button', { name: 'Recover existing run', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('No accessible run was found');
  await expect(page.locator('#progress')).toHaveCount(0);
  await expect(page.locator('.result-card')).toHaveCount(24);
  await scenario(page, 'bob');
  await page.getByRole('button', { name: 'Open / save snapshot', exact: true }).click();
  await page.getByLabel('Recover your temporary run by ID').fill(id);
  await page.getByRole('button', { name: 'Recover existing run', exact: true }).click();
  await expect(page.locator('.result-card')).toHaveCount(24);
  expect(starts).toBe(1);
  await page.getByRole('button', { name: 'Discard stored results', exact: true }).click();
  await page.getByRole('button', { name: 'Discard results permanently', exact: true }).click();
  await page.getByRole('button', { name: 'Recover existing run', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('expired or were discarded');
  expect(starts).toBe(1);
});

test('cancellation before routing releases allowance and never presents incomplete results as complete', async ({ page }) => {
  await page.goto('/'); await scenario(page, 'destination-limit');
  const before = await page.locator('.account-summary').textContent();
  await configure(page);
  await page.getByRole('button', { name: 'Confirm and start one run', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel pending work', exact: true }).click();
  await expect(page.locator('#progress').getByText('CANCELLED · allowance released', { exact: true })).toBeVisible();
  await expect(page.locator('.account-summary')).toHaveText(before!);
  await expect(page.getByRole('button', { name: 'Save results snapshot' })).toBeDisabled();
  await expect(page.locator('#search-results')).toContainText('cancelled');
  await page.getByRole('button', { name: 'Discard stored results', exact: true }).click();
  await page.getByRole('button', { name: 'Discard results permanently', exact: true }).click();
});

test('late support responses do not reveal another account message after signing into a different account', async ({ page }) => {
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  let submitted!: () => void;
  const submission = new Promise<void>(resolve => { submitted = resolve; });
  await page.route('**/api/v1/account-support-requests', async route => {
    const response = await route.fetch(); submitted(); await wait; await route.fulfill({ response });
  });
  await page.goto('/'); await scenario(page, 'alice');
  await navigation(page).getByRole('button', { name: 'Your account', exact: true }).click();
  await page.getByRole('button', { name: 'Contact account support', exact: true }).click();
  const message = 'Private support message belongs only to Alice ' + Date.now();
  await page.getByLabel('Support message').fill(message);
  await page.getByRole('button', { name: 'Send support request', exact: true }).click();
  await submission;
  await scenario(page, 'bob'); release();
  await navigation(page).getByRole('button', { name: 'Your account', exact: true }).click();
  await page.getByRole('button', { name: 'Contact account support', exact: true }).click();
  await expect(page.getByText(message, { exact: true })).toHaveCount(0);
});

test('original listing handoff opens the simulated source page without private destination details', async ({ page }) => {
  await signIn(page, 'new');
  await expect(page.locator('.result-card')).toHaveCount(24);
  const title = (await page.locator('.result-card h3 button').first().textContent())!;
  const opened = page.waitForEvent('popup');
  await page.locator('.result-card').first().getByRole('button', { name: 'Open original listing', exact: true }).click();
  const source = await opened;
  await expect(source.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(source.getByText(/Simulated property-provider website/)).toBeVisible();
  expect(new URL(source.url()).search).toBe('');
  await source.close();
});
