import { test, expect, type Page } from '@playwright/test';
import { accountRequest, csrfHeaders, loadProfile, signIn } from './browser-auth';
import type { PopularProfile } from '../shared/contracts';

async function openAdmin(page: Page) { await signIn(page, 'admin'); }

test('administrator can stop and release routing with an audited reason',async({page})=>{
  await openAdmin(page);
  const adminHeaders = await csrfHeaders(page.request);
  const beforeResponse = await page.request.get('/api/v1/admin',{headers:adminHeaders});
  expect(beforeResponse.ok()).toBeTruthy();
  const before = await beforeResponse.json();
  expect(typeof before.killSwitch.enabled).toBe('boolean');
  const original = before.killSwitch.enabled as boolean;
  const reason = 'Browser regression: review temporary routing stop';

  try {
    const admin = page.locator('#admin');
    const stop = admin.getByRole('button',{name:'Stop new routing work',exact:true});
    const release = admin.getByRole('button',{name:'Release spending stop',exact:true});
    await expect(original?release:stop).toBeDisabled();
    await admin.getByLabel('Audit reason',{exact:true}).fill(reason);
    await (original?release:stop).click();
    await expect(admin.getByText(`New run acceptance: ${original?'enabled subject to all gates':'stopped'}`,{exact:true})).toBeVisible();
    const changed = await (await page.request.get('/api/v1/admin',{headers:adminHeaders})).json();
    expect(changed.killSwitch.enabled).toBe(!original);
    expect(changed.audit.some((entry:{actorId:string;action:string;reason:string})=>
      entry.actorId==='admin'&&entry.action==='SPENDING_SWITCH'&&entry.reason===reason)).toBeTruthy();
    await (original?stop:release).click();
    await expect(admin.getByText(`New run acceptance: ${original?'stopped':'enabled subject to all gates'}`,{exact:true})).toBeVisible();
    expect(await admin.innerText()).not.toContain('undefined');
  } finally {
    const restored = await page.request.post('/api/v1/admin/kill-switch',{
      headers:adminHeaders,data:{enabled:original,reason:'Browser cleanup: restore initial routing policy'},
    });
    expect(restored.ok()).toBeTruthy();
  }
});

test('administrator sees and edits the server account policy',async({page})=>{
  await openAdmin(page);
  const adminHeaders = await csrfHeaders(page.request);
  const response = await page.request.get('/api/v1/admin',{headers:adminHeaders});
  const before = await response.json();
  const entitlement = before.entitlements.find((item:{id:string})=>item.id==='demo-bob');
  expect(entitlement).toBeTruthy();
  const changedStatus = entitlement.status==='SUSPENDED'?'ACTIVE':'SUSPENDED';
  try {
    const admin = page.locator('#admin');
    await admin.getByText('Allowance and retention controls',{exact:true}).click();
    await admin.getByLabel('Entitlement ID',{exact:true}).selectOption(entitlement.id);
    await expect(admin.getByLabel('Daily run allowance',{exact:true})).toHaveValue(String(entitlement.dailyRuns));
    await expect(admin.getByLabel('Daily distinct destinations',{exact:true})).toHaveValue(String(entitlement.dailyDestinations));
    await admin.getByLabel('Entitlement status',{exact:true}).selectOption(changedStatus);
    await admin.getByLabel('Audit reason',{exact:true}).fill('Browser regression: review account access policy');
    await admin.getByRole('button',{name:'Apply entitlement policy',exact:true}).click();
    await expect(admin.getByText('Account allowance policy updated. Existing usage remains recorded.',{exact:true})).toBeVisible();
    const state = await (await page.request.get('/api/v1/admin',{headers:adminHeaders})).json();
    expect(state.entitlements.find((item:{id:string})=>item.id===entitlement.id).status).toBe(changedStatus);
    const customer = await accountRequest('bob');
    try {
      const bob = await (await customer.get('/api/v1/me/entitlement')).json();
      expect(bob.entitlement.status).toBe(changedStatus);
    } finally { await customer.dispose(); }
  } finally {
    const restored = await page.request.post('/api/v1/admin/actions',{headers:adminHeaders,data:{
      action:'ENTITLEMENT_POLICY',targetId:entitlement.id,
      value:{dailyRuns:entitlement.dailyRuns,dailyDestinations:entitlement.dailyDestinations,status:entitlement.status},
      reason:'Browser cleanup: restore initial account policy',
    }});
    expect(restored.ok()).toBeTruthy();
  }
});

test('administrator replies to account support without granting a new allowance',async({page})=>{
  await openAdmin(page);
  const adminHeaders = await csrfHeaders(page.request);
  const customer = await accountRequest('suspended');
  const userHeaders = await csrfHeaders(customer);
  const before = await (await customer.get('/api/v1/me/entitlement')).json();
  const created = await customer.post('/api/v1/account-support-requests',{
    headers:userHeaders,data:{category:'ACCESS',message:'Please review access to my synthetic suspended account.'},
  });
  expect(created.status()).toBe(201);
  const support = await created.json();
  await page.getByRole('button', { name: 'Refresh admin state', exact: true }).click();
  const admin = page.locator('#admin');
  const response = 'Your request has been reviewed; account access remains pending a separate policy decision.';
  await admin.getByLabel(`Support response for ${support.id}`,{exact:true}).fill(response);
  await expect(admin.getByRole('button',{name:`Resolve support request ${support.id}`,exact:true})).toBeDisabled();
  await admin.getByLabel('Audit reason',{exact:true}).fill('Browser regression: record account support outcome');
  await admin.getByRole('button',{name:`Resolve support request ${support.id}`,exact:true}).click();
  await expect(admin.getByText('Support response recorded. Account allowance policy remains unchanged.',{exact:true})).toBeVisible();
  const requests = await (await customer.get('/api/v1/me/support-requests')).json();
  const resolved = requests.find((item:{id:string})=>item.id===support.id);
  expect(resolved.status).toBe('RESOLVED');
  expect(resolved.response).toBe(response);
  const after = await (await customer.get('/api/v1/me/entitlement')).json();
  expect(after.entitlement).toEqual(before.entitlement);
  expect(after.remainingRuns).toBe(before.remainingRuns);
  expect(after.remainingDestinations).toBe(before.remainingDestinations);
  await customer.dispose();
});

test('approved nomination is explicitly published, refreshed and publicly browsed',async({page})=>{
  await openAdmin(page);
  const adminHeaders = await csrfHeaders(page.request);
  let publicationCalls = 0;
  let customCalls = 0;
  page.on('request',request=>{
    if(request.method()!=='POST')return;
    const path = new URL(request.url()).pathname;
    if(path==='/api/v1/admin/popular-profiles')publicationCalls++;
    if(path==='/api/v1/runs')customCalls++;
  });
  const beforeAllowance = await (await page.request.get('/api/v1/me/entitlement',{headers:adminHeaders})).json();
  const beforeAdmin = await (await page.request.get('/api/v1/admin',{headers:adminHeaders})).json();
  const profilesBefore = await (await page.request.get('/api/v1/popular-destinations')).json() as PopularProfile[];
  const found = await page.request.post('/api/v1/location-selections',{headers:adminHeaders,data:{query:'Lausanne station'}});
  expect(found.ok()).toBeTruthy();
  const destination = (await found.json()).candidates.find((item:{id:string})=>item.id==='lausanne-station');
  expect(destination).toBeTruthy();
  const selected = await page.request.post('/api/v1/location-selections',{headers:adminHeaders,data:{destinationId:destination.id}});
  expect(selected.ok()).toBeTruthy();
  const nominationResponse = await page.request.post('/api/v1/popular-destination-suggestions',{
    headers:adminHeaders,data:{destinationSelectionId:(await selected.json()).selectionId,locationType:'Station',expectedUsage:'Weekday arrivals'},
  });
  expect(nominationResponse.ok()).toBeTruthy();
  const nomination = await nominationResponse.json();
  if(nomination.status==='APPROVED') {
    const pendingReview = await page.request.post(`/api/v1/admin/suggestions/${nomination.id}`,{
      headers:adminHeaders,data:{status:'REJECTED',reason:'Browser setup: exercise an explicit nomination review'},
    });
    expect(pendingReview.ok()).toBeTruthy();
  }
  await page.getByRole('button', { name: 'Refresh admin state', exact: true }).click();
  let publishedId: string|undefined;
  try {
    const admin = page.locator('#admin');
    const target = admin.getByLabel('Popular profile publication target',{exact:true});
    await expect(target.locator(`option[value="suggestion:${nomination.id}"]`)).toHaveCount(0);
    await admin.getByLabel('Audit reason',{exact:true}).fill('Browser regression: approve the exact station point');
    const nominationRow = admin.locator('li').filter({hasText:'Lausanne station'}).filter({has:page.getByRole('button',{name:'Approve nomination',exact:true})});
    await nominationRow.getByRole('button',{name:'Approve nomination',exact:true}).click();
    await expect(target.locator(`option[value="suggestion:${nomination.id}"]`)).toHaveCount(1);
    expect(publicationCalls).toBe(0);
    const afterApproval = await (await page.request.get('/api/v1/admin',{headers:adminHeaders})).json();
    expect(afterApproval.providerBudget).toEqual(beforeAdmin.providerBudget);
    const approvedProfiles = await (await page.request.get('/api/v1/popular-destinations')).json() as PopularProfile[];
    expect(approvedProfiles.map(profile=>profile.id)).toEqual(profilesBefore.map(profile=>profile.id));

    await target.selectOption(`suggestion:${nomination.id}`);
    const name = `Station commute browser check ${Date.now()}`;
    await admin.getByLabel('Popular profile name',{exact:true}).fill(name);
    await admin.getByLabel('Popular profile travel mode',{exact:true}).selectOption('WALK');
    await admin.getByLabel('Popular profile refresh policy',{exact:true}).fill('Refresh manually after explicit operator review.');
    await admin.getByLabel('Audit reason',{exact:true}).fill('Browser regression: explicitly publish station walking profile');
    const publication = page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/admin/popular-profiles'&&response.request().method()==='POST');
    await admin.getByRole('button',{name:'Publish synthetic profile',exact:true}).click();
    const createdResponse = await publication;expect(createdResponse.status()).toBe(201);
    const published = await createdResponse.json() as PopularProfile;publishedId=published.id;
    expect(published.destination.id).toBe('lausanne-station');
    expect(published.definition.mode).toBe('WALK');
    await expect(admin.getByRole('button',{name:`Unpublish ${name}`,exact:true})).toBeVisible();
    expect(publicationCalls).toBe(1);

    await target.selectOption(`profile:${published.id}`);
    await admin.getByLabel('Popular profile travel mode',{exact:true}).selectOption('BICYCLE');
    const refresh = page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/admin/popular-profiles'&&response.request().method()==='POST');
    await admin.getByRole('button',{name:'Refresh synthetic profile',exact:true}).click();
    const refreshResponse = await refresh;expect(refreshResponse.status()).toBe(201);
    const refreshed = await refreshResponse.json() as PopularProfile;
    expect(refreshed.id).toBe(published.id);
    expect(refreshed.datasetId).not.toBe(published.datasetId);
    expect(refreshed.destination).toEqual(published.destination);
    expect(refreshed.definition.mode).toBe('BICYCLE');
    await expect(admin.getByText('Synthetic profile refreshed and published. Public browsing now uses the coherent new dataset.',{exact:true})).toBeVisible();
    await page.goto('/dashboard');
    await loadProfile(page, name);
    await expect(page.locator('.result-card')).toHaveCount(24);
    await expect(page.locator('#search-results').getByText(/Home to destination · Cycling/)).toBeVisible();
    expect(publicationCalls).toBe(2);
    expect(customCalls).toBe(0);
    const afterAllowance = await (await page.request.get('/api/v1/me/entitlement',{headers:adminHeaders})).json();
    expect(afterAllowance.remainingRuns).toBe(beforeAllowance.remainingRuns);
    expect(afterAllowance.remainingDestinations).toBe(beforeAllowance.remainingDestinations);
  } finally {
    if(publishedId) {
      const unpublished = await page.request.post('/api/v1/admin/actions',{headers:adminHeaders,data:{
        action:'UNPUBLISH_PROFILE',targetId:publishedId,reason:'Browser cleanup: remove the temporary station profile',
      }});
      expect(unpublished.ok()).toBeTruthy();
    }
    if(['APPROVED','REJECTED'].includes(nomination.status)) {
      const restored = await page.request.post(`/api/v1/admin/suggestions/${nomination.id}`,{
        headers:adminHeaders,data:{status:nomination.status,reason:'Browser cleanup: restore the prior nomination decision'},
      });
      expect(restored.ok()).toBeTruthy();
    }
  }
});
