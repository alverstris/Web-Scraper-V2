import { test, expect, type Page } from '@playwright/test';
import { allowance, chooseDestination, customerPassword, navigation, setRange, signIn, signOut } from './browser-auth';

function countRunStarts(page: Page) {
  const starts: string[] = [];
  page.on('request',request=>{
    if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/v1/runs') starts.push(request.url());
  });
  return starts;
}
test('public website, customer session and staff boundary behave like separate website areas', async ({ page }) => {
  const starts = countRunStarts(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Find a home that fits your commute.', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Staff sign in', exact: true })).toBeVisible();
  await expect(page.getByText('Demo test controls', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Development identity')).toHaveCount(0);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/sign-in/);
  await signIn(page, 'alice');
  await expect(page.locator('.result-card')).toHaveCount(24);
  const before = await allowance(page.request);
  await page.reload();
  await expect(page.locator('.account-summary')).toContainText('Alice');
  await expect(page.locator('.result-card')).toHaveCount(24);
  expect((await allowance(page.request)).entitlement?.id).toBe(before.entitlement?.id);
  const denied = await page.request.get('/api/v1/admin');
  expect(denied.status()).toBe(403);
  await page.goto('/staff');
  await expect(page.locator('#admin')).toHaveCount(0);
  await page.goto('/dashboard');
  await expect(page.locator('.account-summary')).toBeVisible();
  await signOut(page);
  expect((await page.request.get('/api/v1/me/entitlement')).status()).toBe(401);
  await page.goto('/staff/sign-in');
  await page.getByLabel('Email address', { exact: true }).fill('alice@keywise.test');
  await page.getByLabel('Password', { exact: true }).fill(customerPassword);
  await page.getByRole('button', { name: 'Staff sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/staff\/sign-in$/);
  await expect(page.locator('#admin')).toHaveCount(0);
  expect(starts).toHaveLength(0);
});

test('password sign-in, reload and sign-out preserve one customer allowance', async ({ page }) => {
  const starts = countRunStarts(page);
  await signIn(page, 'alice');
  const before = await allowance(page.request);
  await navigation(page).getByRole('button', { name: 'Your account', exact: true }).click();
  await expect(page.locator('#account')).toContainText('Alice');
  await expect(page.getByRole('button', { name: /Link (Google|Microsoft)/ })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.account-summary')).toContainText('Alice');
  await signOut(page);
  await signIn(page, 'alice');
  const restored = await allowance(page.request);
  expect(restored.entitlement?.id).toBe(before.entitlement?.id);
  expect(restored.remainingRuns).toBe(before.remainingRuns);
  expect(restored.remainingDestinations).toBe(before.remainingDestinations);
  expect(starts).toHaveLength(0);
});

test('new customer deliberately skips verification and starts no calculation',async({page})=>{
  const starts = countRunStarts(page);
  await signIn(page,'new');
  await expect(page.getByLabel('Synthetic verification evidence')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Verify demo evidence',exact:true})).toHaveCount(0);
  const signedUp = await allowance(page.request);
  expect(signedUp.verificationRequired).toBe(false);
  expect(signedUp.entitlement?.status).toBe('ACTIVE');
  expect(signedUp.remainingRuns).toBeGreaterThan(0);
  await navigation(page).getByRole('button',{name:'Custom commute',exact:true}).click();
  await chooseDestination(page,'EPFL',/Confirm this destination: EPFL.*east/);
  await expect(page.getByRole('button',{name:'Review custom run',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Review custom run',exact:true}).click();
  await expect(page.getByRole('region',{name:'Confirm custom run'})).toBeVisible();
  expect(starts).toHaveLength(0);
  expect((await allowance(page.request)).remainingRuns).toBe(signedUp.remainingRuns);
});

test('exhausted user explores popular profiles and snapshots without new runs',async({page})=>{
  const starts = countRunStarts(page);
  await signIn(page,'exhausted');
  await navigation(page).getByRole('button',{name:'Your account',exact:true}).click();
  await expect(page.locator('#account').getByText(/Daily run allowance used/)).toBeVisible();
  await expect(page.locator('#account').getByText(/Browse popular results or reopen a saved snapshot while/)).toBeVisible();
  const before = await allowance(page.request);
  expect(before.remainingRuns).toBe(0);
  await navigation(page).getByRole('button',{name:'Popular destinations',exact:true}).click();
  await expect(page.locator('.result-card')).toHaveCount(24);
  await setRange(page, 'Maximum rent (CHF/month)', 900);
  await expect(page.locator('.result-card')).toHaveCount(4);
  await navigation(page).getByRole('button',{name:'Open / save snapshot',exact:true}).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button',{name:'Export complete snapshot',exact:true}).click();
  const file = await (await downloaded).path();expect(file).toBeTruthy();
  await page.getByLabel('Open a saved search snapshot',{exact:true}).setInputFiles(file!);
  await expect(page.locator('#search-results').getByText('Saved snapshot · complete',{exact:true})).toBeVisible();
  await expect(page.locator('.result-card')).toHaveCount(24);
  await navigation(page).getByRole('button',{name:'Custom commute',exact:true}).click();
  await chooseDestination(page,'EPFL',/Confirm this destination: EPFL.*east/);
  await expect(page.getByRole('button',{name:'Review custom run',exact:true})).toBeDisabled();
  await expect(page.locator('#custom').getByText(/No runs remain today/)).toBeVisible();
  expect(starts).toHaveLength(0);
  expect((await allowance(page.request)).remainingRuns).toBe(before.remainingRuns);
});

test('suspended account keeps public browsing and can request support',async({page})=>{
  const starts = countRunStarts(page);
  await signIn(page,'suspended');
  await navigation(page).getByRole('button',{name:'Your account',exact:true}).click();
  const before = await allowance(page.request);
  expect(before.entitlement?.status).toBe('SUSPENDED');
  await expect(page.locator('#account').getByText(/Custom searches are suspended/).first()).toBeVisible();
  await page.locator('#account').getByRole('button',{name:'Contact account support',exact:true}).click();
  const message = 'Please review access to my suspended local demonstration account.';
  await page.getByLabel('Support message',{exact:true}).fill(message);
  await page.getByRole('button',{name:'Send support request',exact:true}).click();
  await expect(page.getByRole('list',{name:'Your support requests'}).getByText(message,{exact:true})).toBeVisible();
  await navigation(page).getByRole('button',{name:'Popular destinations',exact:true}).click();
  await expect(page.locator('.result-card')).toHaveCount(24);
  await navigation(page).getByRole('button',{name:'Custom commute',exact:true}).click();
  await chooseDestination(page,'EPFL',/Confirm this destination: EPFL.*east/);
  await expect(page.getByRole('button',{name:'Review custom run',exact:true})).toBeDisabled();
  await expect(page.locator('#custom').getByText(/Custom searches are suspended/)).toBeVisible();
  await page.getByRole('button',{name:'Review account access',exact:true}).click();
  await expect(page.locator('#account').getByRole('button',{name:'Contact account support',exact:true})).toBeVisible();
  const after = await allowance(page.request);
  expect(after.entitlement).toEqual(before.entitlement);
  expect(starts).toHaveLength(0);
});

test('destination-limited account can review its existing entrance and blocks a new place',async({page})=>{
  const starts = countRunStarts(page);
  await signIn(page,'destination-limit');
  await navigation(page).getByRole('button',{name:'Your account',exact:true}).click();
  const before = await allowance(page.request);
  expect(before.remainingRuns).toBeGreaterThan(0);
  expect(before.remainingDestinations).toBe(0);
  expect(before.usedDestinationIds).toContain('epfl-east');
  await expect(page.locator('#account').getByText(/another profile for a destination already used today/)).toBeVisible();
  await navigation(page).getByRole('button',{name:'Custom commute',exact:true}).click();
  await chooseDestination(page,'EPFL',/Confirm this destination: EPFL.*east/);
  await page.locator('#custom').getByRole('group', { name: 'Travel mode', exact: true }).getByRole('radio', { name: 'Walking', exact: true }).check();
  await expect(page.getByRole('button',{name:'Review custom run',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Review custom run',exact:true}).click();
  await expect(page.getByRole('region',{name:'Confirm custom run'}).getByText(/for a destination already used today/)).toBeVisible();
  expect(starts).toHaveLength(0);
  await page.getByRole('button',{name:'Return to draft',exact:true}).click();
  await chooseDestination(page,'UNIL',/Confirm this destination: UNIL/);
  await expect(page.getByRole('button',{name:'Review custom run',exact:true})).toBeDisabled();
  await expect(page.locator('#custom').getByText(/Your new-destination allowance is used/)).toBeVisible();
  await expect(page.getByRole('region',{name:'Confirm custom run'})).toHaveCount(0);
  const after = await allowance(page.request);
  expect(after.remainingRuns).toBe(before.remainingRuns);
  expect(after.usedDestinationIds).toEqual(before.usedDestinationIds);
  expect(starts).toHaveLength(0);
});
