import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import type { Dataset } from '../shared/contracts';
import { allowance, expandFilters, setRange, signIn } from './browser-auth';

async function snapshot(page: Page) {
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save results snapshot', exact: true }).click();
  const path = await (await downloaded).path();
  expect(path).toBeTruthy();
  return { path: path!, contents: JSON.parse(await readFile(path!, 'utf8')) as { dataset: Dataset } };
}

async function moreFilters(page: Page) {
  await expandFilters(page, 'More filters');
}

async function savedTravelMode(page: Page, label: string) {
  const radio = page.locator('#popular').getByRole('group', { name: 'Travel mode', exact: true }).getByRole('radio', { name: label, exact: true });
  await radio.check();
  await expect(radio).toBeChecked();
}

test('saved EPFL dataset, free filters, explicit private run and portable round trip', async ({ page }) => {
  let starts = 0;
  page.on('request', request => {if(request.method()==='POST' && request.url().endsWith('/api/v1/runs')) starts++;});
  await signIn(page, 'alice');
  const results=page.locator('#search-results');
  await expect(results.getByRole('heading',{name:'Search results',exact:true})).toBeVisible();
  await expect(page.locator('.result-card')).toHaveCount(24);
  await results.scrollIntoViewIfNeeded();
  await page.screenshot({path:'test-results/popular-desktop.png'});
  const calculation = await results.locator('.result-heading p').nth(1).textContent();
  await setRange(page, 'Maximum rent (CHF/month)', 900);
  await expect(page.locator('.result-card')).toHaveCount(4);
  await page.getByRole('group', { name: 'Minimum bedrooms', exact: true }).getByRole('button', { name: '2+', exact: true }).click();
  await expect(page.locator('.result-card')).toHaveCount(2);
  await page.getByLabel('Sort',{exact:true}).selectOption('COMMUTE_DESC');
  expect(starts).toBe(0);

  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Save results snapshot'}).click();
  const download=await downloadPromise;
  const file=await download.path();
  expect(file).toBeTruthy();
  await page.getByRole('button',{name:'Open / save snapshot',exact:true}).click();
  await page.getByLabel('Open a saved search snapshot').setInputFiles(file!);
  await expect(results.getByText('Saved snapshot · complete',{exact:true})).toBeVisible();
  await expect(page.locator('.result-card')).toHaveCount(24);
  await expect(results.locator('.result-heading p').nth(1)).toHaveText(calculation!);
  expect(starts).toBe(0);

  await expect(page.locator('.account-summary')).toContainText('Alice');
  await page.getByRole('button',{name:'Custom commute',exact:true}).click();
  await page.getByLabel('Destination name or address').fill('EPFL');
  await page.getByRole('button',{name:'Find destination',exact:true}).click();
  await page.getByRole('button',{name:/Confirm this destination: EPFL.*east/}).click();
  await page.getByRole('button',{name:'Review custom run',exact:true}).click();
  expect(starts).toBe(0);
  await expect(page.getByRole('region',{name:'Confirm custom run'})).toBeVisible();
  await page.getByRole('button',{name:'Confirm and start one run',exact:true}).click();
  await expect(page.locator('#progress').getByText(/COMPLETE · allowance finalised/)).toBeVisible();
  expect(starts).toBe(1);
  await expect(page.locator('.result-card')).toHaveCount(24);
  await page.locator('#custom').getByRole('group', { name: 'Travel mode', exact: true }).getByRole('radio', { name: 'Walking', exact: true }).check();
  await page.getByLabel('Destination name or address').fill('UNIL');
  await expandFilters(page, 'Search details');
  await expect(results.getByText(/EPFL.*east entrance/).first()).toBeVisible();
  await expect(results.getByText(/Home to destination · Public transport/)).toBeVisible();
  expect(starts).toBe(1);
  const withinFifteenMinutes = (await page.locator('.result-card .commute-result-summary').allTextContents()).filter(text => /^\d+ min/.test(text) && Number(text.match(/^(\d+) min/)![1]) <= 15).length;
  expect(withinFifteenMinutes).toBeGreaterThan(0);
  await setRange(page, 'Maximum commute (minutes)', 15);
  await expect(page.locator('.result-card')).toHaveCount(withinFifteenMinutes);
  const limitedDurations = await page.locator('.result-card .commute-result-summary').allTextContents();
  expect(limitedDurations.length).toBeGreaterThan(0);
  expect(limitedDurations.every(text => Number(text.match(/^(\d+) min/)?.[1]) <= 15)).toBeTruthy();
  expect(starts).toBe(1);
  await page.getByRole('button',{name:'Clear all filters', exact: true}).click();
  await page.getByRole('button',{name:'Map / coordinates',exact:true}).click();
  await expect(page.getByRole('region',{name:'Synthetic coordinate overview'})).toBeVisible();
  await page.locator('.map-marker').first().click();
  await expect(page.locator('.result-card.selected')).toHaveCount(1);
  await expect(page.locator('.details h3')).toBeVisible();
  await expect(page.locator('.details h3')).toBeFocused();
  await page.getByRole('button',{name:'Clear selected property'}).click();
  await expect(page.locator('.result-card.selected')).toHaveCount(0);
  await page.getByRole('button',{name:'Discard stored results'}).click();
  await page.getByRole('button',{name:'Discard results permanently'}).click();
  await expect(page.locator('#search-results')).toHaveCount(0);
});

test('invalid import, mobile controls and keyboard focus remain usable',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:'reduce'});
  await signIn(page, 'bob');
  await page.goto('/dashboard');
  await expect(page.locator('.result-card')).toHaveCount(24);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link',{name:/Skip to/})).toBeFocused();
  await expect(page.locator('.result-card')).toHaveCount(24);
  await page.locator('#commute-filters').evaluate(element => element.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'test-results/filters-mobile.png' });
  await page.getByRole('button',{name:'Map / coordinates',exact:true}).click();
  await page.getByRole('button',{name:'List',exact:true}).click();
  await page.getByRole('button',{name:'Open / save snapshot',exact:true}).click();
  await page.getByLabel('Open a saved search snapshot').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"script":"<script>alert(1)</script>"}')});
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.result-card')).toHaveCount(24);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:'test-results/mobile-reduced-motion.png'});
});



test('EPFL property facts, shared facilities and geographic filters stay local', async ({ page }) => {
  let starts = 0;
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/runs') starts++; });
  await signIn(page, 'new');
  await expect(page.locator('.result-card')).toHaveCount(24);
  const saved = (await snapshot(page)).contents.dataset;
  const sharedLaundry = saved.listings.filter(listing => listing.facilities.washingMachine === 'SHARED');
  expect(sharedLaundry.length).toBeGreaterThan(0);
  expect(sharedLaundry.length).toBeLessThan(saved.listings.length);
  await moreFilters(page);
  await expandFilters(page, 'Facilities');
  await expandFilters(page, /^Washing machine/);
  await page.getByRole('group', { name: 'Washing machine', exact: true }).getByRole('button', { name: 'Shared', exact: true }).click();
  await expect(page.locator('.result-card')).toHaveCount(sharedLaundry.length);
  expect(new Set(await page.locator('.result-card h3 button').allTextContents())).toEqual(new Set(sharedLaundry.map(listing => listing.title)));
  await expandFilters(page, 'Rooms and space');
  await page.getByRole('spinbutton', { name: 'Minimum rooms', exact: true }).fill('2.5');
  const sharedWithRooms = sharedLaundry.filter(listing => listing.rooms !== null && listing.rooms >= 2.5);
  expect(sharedWithRooms.length).toBeGreaterThan(0);
  expect(sharedWithRooms.length).toBeLessThan(sharedLaundry.length);
  await expect(page.locator('.result-card')).toHaveCount(sharedWithRooms.length);
  expect(new Set(await page.locator('.result-card h3 button').allTextContents())).toEqual(new Set(sharedWithRooms.map(listing => listing.title)));
  await page.getByRole('spinbutton', { name: 'Minimum rooms', exact: true }).fill('40');
  await expect(page.locator('.result-card')).toHaveCount(0);
  await expect(page.locator('#search-results')).toContainText('No results match these filters.');
  await page.getByRole('button', { name: 'Clear all filters', exact: true }).click();
  await expandFilters(page, 'Home preferences');
  await page.getByRole('group', { name: 'Furnishing', exact: true }).getByRole('button', { name: 'Not stated', exact: true }).click();
  const furnishingUnknown = saved.listings.filter(listing => listing.furnishing === 'UNKNOWN');
  await expect(page.locator('.result-card')).toHaveCount(furnishingUnknown.length);
  await page.getByRole('spinbutton', { name: 'Minimum bedrooms', exact: true }).fill('0');
  const knownBedrooms = furnishingUnknown.filter(listing => listing.bedrooms !== null);
  expect(knownBedrooms.length).toBeLessThan(furnishingUnknown.length);
  await expect(page.locator('.result-card')).toHaveCount(knownBedrooms.length);
  expect(new Set(await page.locator('.result-card h3 button').allTextContents())).toEqual(new Set(knownBedrooms.map(listing => listing.title)));
  await page.getByRole('button', { name: 'Clear all filters', exact: true }).click();
  await expandFilters(page, 'Areas');
  await page.getByRole('group', { name: 'Area', exact: true }).getByRole('button', { name: 'Ecublens', exact: true }).click();
  await expect(page.locator('.result-card')).toHaveCount(4);
  for (const text of await page.locator('.result-card h3').allTextContents()) expect(text).toContain('Ecublens');
  await page.getByRole('button', { name: 'Remove Area: Ecublens', exact: true }).click();
  await expect(page.locator('.result-card')).toHaveCount(24);
  await page.getByLabel('Include rows without an available route', { exact: true }).uncheck();
  await expect(page.locator('.result-card')).toHaveCount(saved.counts.success);
  expect(starts).toBe(0);
});

test('commute length and transit details filter the entire saved dataset while snapshots keep the original', async ({ page }) => {
  let starts = 0;
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/runs') starts++; });
  await signIn(page, 'exhausted');
  await expect(page.locator('.result-card')).toHaveCount(24);
  await page.locator('#commute-filters').evaluate(element => element.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'test-results/filters-desktop.png' });
  const before = await allowance(page.request);
  const original = await snapshot(page);
  const dataset = original.contents.dataset;
  const expected = dataset.rows.filter(row => row.state === 'SUCCESS' && row.durationSeconds! <= 30 * 60);
  expect(expected.length).toBeGreaterThan(0);
  expect(expected.length).toBeLessThan(dataset.counts.success);

  await setRange(page, 'Maximum commute (minutes)', 30);
  await expect(page.locator('.result-card')).toHaveCount(expected.length);
  const titles = new Set(expected.map(row => dataset.listings.find(listing => listing.id === row.listingId)!.title));
  const shown = await page.locator('.result-card h3 button').allTextContents();
  expect(new Set(shown)).toEqual(titles);
  for (const text of await page.locator('.result-card .commute-result-summary').allTextContents()) {
    expect(text).toMatch(/^\d+ min · Public transport/);
    expect(Number(text.match(/^(\d+) min/)![1])).toBeLessThanOrEqual(30);
  }
  for (const text of await page.locator('.result-card .measured-journey-facts').allTextContents()) {
    expect(text).toMatch(/\d+ min walking/);
    expect(text).toMatch(/\d+ transfers?/);
  }
  await expandFilters(page, 'Transit details');
  await setRange(page, 'Maximum walking (minutes)', 5);
  await page.getByRole('group', { name: 'Maximum transfers', exact: true }).getByRole('button', { name: '0', exact: true }).click();
  const transitLimited = expected.filter(row => row.walkingSeconds !== undefined && row.walkingSeconds <= 5 * 60 && row.transfers === 0);
  await expect(page.locator('.result-card')).toHaveCount(transitLimited.length);
  await page.getByRole('button', { name: 'No walking limit', exact: true }).click();
  await page.getByRole('group', { name: 'Maximum transfers', exact: true }).getByRole('button', { name: 'Any', exact: true }).click();
  const transitTypes = [
    { value: 'BUS', label: 'Bus' }, { value: 'SUBWAY', label: 'Metro' },
    { value: 'TRAIN', label: 'Train' }, { value: 'LIGHT_RAIL', label: 'Light rail' },
    { value: 'RAIL', label: 'Rail' },
  ] as const;
  const allowedSets = [
    ...transitTypes.map(type => [type.value]),
    ...transitTypes.flatMap((first, index) => transitTypes.slice(index + 1).map(second => [first.value, second.value])),
  ];
  const allowed = allowedSets.find(types => {
    const count = expected.filter(row => row.transitModes?.length && row.transitModes.every(type => types.includes(type))).length;
    return count > 0 && count < expected.length;
  });
  expect(allowed).toBeTruthy();
  const transitControls = page.getByRole('group', { name: 'Allowed transit types in measured journey', exact: true });
  for (const type of transitTypes) {
    const control = transitControls.getByLabel(type.label, { exact: true });
    await expect(control).toBeChecked();
    if (!allowed!.includes(type.value)) await control.uncheck();
  }
  const allowedJourneys = expected.filter(row => row.transitModes?.length && row.transitModes.every(type => allowed!.includes(type)));
  await expect(page.locator('.result-card')).toHaveCount(allowedJourneys.length);
  expect(new Set(await page.locator('.result-card h3 button').allTextContents())).toEqual(new Set(allowedJourneys.map(row => dataset.listings.find(listing => listing.id === row.listingId)!.title)));
  const filteredExport = await snapshot(page);
  expect(filteredExport.contents).toEqual(original.contents);
  expect(filteredExport.contents.dataset.listings).toHaveLength(24);
  await page.getByRole('button', { name: 'Open / save snapshot', exact: true }).click();
  await page.getByLabel('Open a saved search snapshot', { exact: true }).setInputFiles(filteredExport.path);
  await expect(page.locator('#search-results').getByText('Saved snapshot · complete', { exact: true })).toBeVisible();
  await expect(page.locator('.result-card')).toHaveCount(24);
  expect((await snapshot(page)).contents).toEqual(original.contents);
  expect(await allowance(page.request)).toEqual(before);
  expect(starts).toBe(0);
});

test('saved travel modes and destinations expose coherent journeys without spending allowance', async ({ page }) => {
  let starts = 0;
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/runs') starts++; });
  await signIn(page, 'exhausted');
  await expect(page.locator('.result-card')).toHaveCount(24);
  const before = await allowance(page.request);
  const popular = page.locator('#popular');
  const results = page.locator('#search-results');
  const durations = new Map<string, number[]>();
  for (const [mode, label] of [['WALK', 'Walking'], ['BICYCLE', 'Cycling'], ['DRIVE', 'Driving'], ['TRANSIT', 'Public transport']] as const) {
    await savedTravelMode(page, label);
    await expect(results.locator('.result-destination')).toContainText(`${label} to `);
    await expandFilters(page, 'Search details');
    await expect(results.getByText(`Home to destination · ${label}`, { exact: false }).first()).toBeVisible();
    await expect(page.locator('.result-card')).toHaveCount(24);
    const saved = (await snapshot(page)).contents.dataset;
    expect(saved.definition.mode).toBe(mode);
    expect(saved.definition.destination.id).toBe('epfl-east');
    const successfulTitles = saved.rows.filter(row => row.state === 'SUCCESS').map(row => saved.listings.find(listing => listing.id === row.listingId)!.title);
    for (const title of successfulTitles) {
      await expect(page.locator('.result-card').filter({ has: page.getByRole('button', { name: title, exact: true }) }).locator('.commute-result-summary')).toContainText(label);
    }
    durations.set(mode, saved.rows.filter(row => row.state === 'SUCCESS').map(row => row.durationSeconds!));
  }
  expect(durations.get('WALK')).not.toEqual(durations.get('BICYCLE'));
  expect(durations.get('BICYCLE')).not.toEqual(durations.get('DRIVE'));
  expect(durations.get('DRIVE')).not.toEqual(durations.get('TRANSIT'));
  await popular.getByLabel('Saved destination', { exact: true }).selectOption('unil-dorigny');
  await expect(results.getByText(/UNIL — Dorigny/).first()).toBeVisible();
  const unil = (await snapshot(page)).contents.dataset;
  expect(unil.definition.destination.id).toBe('unil-dorigny');
  expect(unil.definition.mode).toBe('TRANSIT');
  await setRange(page, 'Maximum rent (CHF/month)', 900);
  await expandFilters(page, 'Transit details');
  await setRange(page, 'Maximum walking (minutes)', 5);
  await savedTravelMode(page, 'Walking');
  await expect(results.locator('.result-destination')).toContainText('Walking to ');
  await expandFilters(page, 'Search details');
  await expect(results.getByText('Home to destination · Walking', { exact: false }).first()).toBeVisible();
  await expect(page.locator('.result-card')).toHaveCount(4);
  await expect(page.getByRole('slider', { name: 'Maximum rent (CHF/month)', exact: true })).toHaveValue('900');
  await expect(page.getByRole('slider', { name: 'Maximum walking (minutes)', exact: true })).toHaveCount(0);
  await savedTravelMode(page, 'Public transport');
  await expect(results.locator('.result-destination')).toContainText('Public transport to ');
  await expandFilters(page, 'Search details');
  await expect(results.getByText('Home to destination · Public transport', { exact: false }).first()).toBeVisible();
  await expandFilters(page, 'Transit details');
  await expect(page.getByRole('slider', { name: 'Maximum walking (minutes)', exact: true })).toHaveAttribute('aria-valuetext', 'No limit');
  await expect(page.locator('.result-card')).toHaveCount(4);
  expect(await allowance(page.request)).toEqual(before);
  expect(starts).toBe(0);
});

test('housing sliders and steppers enforce monthly prices and bounded ranges', async ({ page }) => {
  await signIn(page, 'exhausted');
  await expect(page.locator('.result-card')).toHaveCount(24);
  const saved = (await snapshot(page)).contents.dataset;
  const expected = saved.listings.filter(listing => listing.rent.amount !== null && listing.rent.amount >= 900 && listing.rent.amount <= 1500 && listing.rooms === 3.5 && listing.bedrooms === 2);
  expect(expected.length).toBeGreaterThan(0);
  expect(expected.length).toBeLessThan(saved.listings.length);
  await expect(page.getByRole('spinbutton', { name: 'Minimum rooms', exact: true })).not.toBeVisible();
  const maximumRent = page.getByRole('slider', { name: 'Maximum rent (CHF/month)', exact: true });
  await maximumRent.scrollIntoViewIfNeeded();
  const maximumBox = await maximumRent.boundingBox();
  expect(maximumBox).toBeTruthy();
  await page.mouse.move(maximumBox!.x + maximumBox!.width - 12, maximumBox!.y + maximumBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(maximumBox!.x + maximumBox!.width * 0.4, maximumBox!.y + maximumBox!.height / 2, { steps: 8 });
  await page.mouse.up();
  const draggedMaximum = Number(await maximumRent.inputValue());
  expect(draggedMaximum).toBeGreaterThan(0);
  expect(draggedMaximum).toBeLessThan(5000);
  expect(draggedMaximum % 50).toBe(0);
  await expect(page.locator('.result-card')).toHaveCount(saved.listings.filter(listing => listing.rent.amount !== null && listing.rent.amount <= draggedMaximum).length);
  const minimumRent = page.getByRole('slider', { name: 'Minimum rent (CHF/month)', exact: true });
  const minimumBox = await minimumRent.boundingBox();
  expect(minimumBox).toBeTruthy();
  await page.mouse.move(minimumBox!.x + 12, minimumBox!.y + minimumBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(minimumBox!.x + minimumBox!.width * 0.2, minimumBox!.y + minimumBox!.height / 2, { steps: 8 });
  await page.mouse.up();
  const draggedMinimum = Number(await minimumRent.inputValue());
  expect(draggedMinimum).toBeGreaterThan(0);
  expect(draggedMinimum).toBeLessThan(draggedMaximum);
  expect(draggedMinimum % 50).toBe(0);
  const draggedResults = saved.listings.filter(listing => listing.rent.amount !== null && listing.rent.amount >= draggedMinimum && listing.rent.amount <= draggedMaximum);
  await expect(page.locator('.result-card')).toHaveCount(draggedResults.length);
  expect(new Set(await page.locator('.result-card h3 button').allTextContents())).toEqual(new Set(draggedResults.map(listing => listing.title)));
  await page.getByRole('button', { name: 'Clear rent limits', exact: true }).click();
  await expect(page.locator('.result-card')).toHaveCount(24);
  await setRange(page, 'Minimum rent (CHF/month)', 900);
  await setRange(page, 'Maximum rent (CHF/month)', 1500);
  await moreFilters(page);
  await expandFilters(page, 'Rooms and space');
  await page.getByRole('spinbutton', { name: 'Minimum rooms', exact: true }).fill('3.5');
  await page.getByRole('spinbutton', { name: 'Maximum rooms', exact: true }).fill('3.5');
  await page.getByRole('spinbutton', { name: 'Minimum bedrooms', exact: true }).fill('2');
  await page.getByRole('spinbutton', { name: 'Maximum bedrooms', exact: true }).fill('2');
  await expect(page.locator('.result-card')).toHaveCount(expected.length);
  expect(new Set(await page.locator('.result-card h3 button').allTextContents())).toEqual(new Set(expected.map(listing => listing.title)));
  for (const text of await page.locator('.result-card').allTextContents()) {
    expect(text).toMatch(/CHF [\d,’']+\s*\/\s*month/);
    expect(text).toContain('3.5 rooms');
    expect(text).toContain('2 bedrooms');
  }
  for (const [label, step, maximum] of [
    ['Minimum rent (CHF/month)', '50', '5000'], ['Maximum rent (CHF/month)', '50', '5000'],
    ['Maximum commute (minutes)', '5', '120'],
  ]) {
    const control = page.getByRole('slider', { name: label, exact: true });
    await expect(control).toHaveAttribute('min', '0');
    await expect(control).toHaveAttribute('max', maximum);
    await expect(control).toHaveAttribute('step', step);
  }
  for (const [label, step] of [
    ['Minimum rooms', '0.5'], ['Maximum rooms', '0.5'],
    ['Minimum bedrooms', '1'], ['Maximum bedrooms', '1'],
    ['Minimum bathrooms', '1'], ['Maximum bathrooms', '1'],
    ['Minimum floor area (m²)', '1'], ['Maximum floor area (m²)', '1'],
  ]) {
    const control = page.getByRole('spinbutton', { name: label, exact: true });
    await expect(control).toHaveAttribute('min', '0');
    await expect(control).toHaveAttribute('step', step);
    expect(Number(await control.getAttribute('max'))).toBeGreaterThan(0);
  }
  for (const [label, invalid] of [['Minimum bedrooms', '-1'], ['Maximum bedrooms', '123456789'], ['Minimum bedrooms', '1.5']]) {
    const bedrooms = page.getByRole('spinbutton', { name: label, exact: true });
    await bedrooms.fill(invalid);
    await bedrooms.press('Tab');
    await expect(bedrooms).toHaveValue('2');
    await expect(page.locator('.result-card')).toHaveCount(expected.length);
    await expect(page.locator('#property-filters').getByRole('alert')).toBeVisible();
  }
  expect((await snapshot(page)).contents.dataset).toEqual(saved);
  await page.getByRole('spinbutton', { name: 'Minimum rooms', exact: true }).fill('10');
  await expect(page.getByRole('spinbutton', { name: 'Minimum rooms', exact: true })).toHaveValue('3.5');
  await expect(page.getByRole('spinbutton', { name: 'Maximum rooms', exact: true })).toHaveValue('3.5');
  await expect(page.getByLabel('north', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('south', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Currency', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Rent period', { exact: true })).toHaveCount(0);
});
