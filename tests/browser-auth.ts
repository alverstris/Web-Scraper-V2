import { expect, request as apiRequest, type APIRequestContext, type Page } from '@playwright/test';
import type { AccountView, EntitlementView } from '../shared/contracts';

export const customerPassword = 'Keywise-Demo-2026!';
export const staffPassword = 'Keywise-Staff-2026!';
export const localOrigin = { Origin: 'http://127.0.0.1:5173' };
export interface BrowserSession { account: AccountView; csrfToken: string; }

export async function signIn(page: Page, account = 'alice', staff = account === 'admin') {
  await page.goto(staff ? '/staff/sign-in' : '/sign-in');
  await page.getByLabel('Email address', { exact: true }).fill(`${account}@keywise.test`);
  await page.getByLabel('Password', { exact: true }).fill(staff ? staffPassword : customerPassword);
  await page.getByRole('button', { name: staff ? 'Staff sign in' : 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(staff ? '/staff/?$' : '/dashboard/?$'));
  if (staff) await expect(page.locator('#admin').getByRole('heading', { name: 'Spending stop', exact: true })).toBeVisible();
  else await expect(page.locator('.account-summary')).toBeVisible();
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out', exact: true }).first().click();
  await expect(page).not.toHaveURL(/\/dashboard(?:\/|$)|\/staff\/?$/);
}

export async function apiSignIn(request: APIRequestContext, account = 'alice', staff = account === 'admin') {
  const response = await request.post(staff ? '/api/v1/auth/staff-login' : '/api/v1/auth/login', {
    headers: localOrigin,
    data: { email: `${account}@keywise.test`, password: staff ? staffPassword : customerPassword },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return await response.json() as BrowserSession;
}

export async function accountRequest(account: string) {
  const context = await apiRequest.newContext({ baseURL: 'http://127.0.0.1:5173' });
  await apiSignIn(context, account);
  return context;
}

export async function csrfHeaders(request: APIRequestContext) {
  const response = await request.get('/api/v1/auth/session');
  expect(response.ok()).toBeTruthy();
  const session = await response.json() as BrowserSession;
  expect(session.account).toBeTruthy();
  expect(session.csrfToken).toBeTruthy();
  return { ...localOrigin, 'X-CSRF-Token': session.csrfToken };
}

export async function allowance(request: APIRequestContext): Promise<EntitlementView> {
  const response = await request.get('/api/v1/me/entitlement');
  expect(response.ok()).toBeTruthy();
  return response.json();
}

export function navigation(page: Page) { return page.getByRole('navigation', { name: 'Search sections' }); }

/** Exercise a native range through its keyboard controls, including its enforced step. */
export async function setRange(page: Page, label: string, value: number) {
  const control = page.getByRole('slider', { name: label, exact: true });
  const minimum = Number(await control.getAttribute('min'));
  const step = Number(await control.getAttribute('step'));
  expect(step).toBeGreaterThan(0);
  expect((value - minimum) % step).toBe(0);
  await control.press('Home');
  const startingValue = Number(await control.inputValue());
  const direction = value >= startingValue ? 'ArrowRight' : 'ArrowLeft';
  for (let index = 0; index < Math.abs(value - startingValue) / step; index++) await control.press(direction);
  await expect(control).toHaveValue(String(value));
}

export async function expandFilters(page: Page, name: string | RegExp) {
  const prefix = typeof name === 'string' ? new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : name;
  const summary = page.locator('summary').filter({ hasText: prefix });
  const details = summary.locator('xpath=ancestor::details[1]');
  if (await details.getAttribute('open') === null) await summary.click();
}

export async function loadProfile(page: Page, name?: string) {
  await expect(page.locator('.result-card')).toHaveCount(24);
  await navigation(page).getByRole('button', { name: 'Popular destinations', exact: true }).click();
  const summary = page.getByText('Change destination profile', { exact: true });
  if (await summary.count() && await page.locator('details.kw-profile-picker').getAttribute('open') === null) await summary.click();
  await page.getByRole('button', { name: name ? `Load ${name}` : /^Load /, exact: !!name }).first().click();
  await expect(page.locator('.result-card')).toHaveCount(24);
}

export async function chooseDestination(page: Page, query = 'EPFL', label: RegExp = /Confirm this destination: EPFL.*east/) {
  await page.getByLabel('Destination name or address', { exact: true }).fill(query);
  await page.getByRole('button', { name: 'Find destination', exact: true }).click();
  await page.getByRole('button', { name: label }).click();
  await expect(page.getByRole('button', { name: 'Review custom run', exact: true })).toBeVisible();
}
