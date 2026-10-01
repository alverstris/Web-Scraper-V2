import test from 'node:test';
import assert from 'node:assert/strict';
import { CommuteService } from '../server/service.ts';
import { MemoryRepository, MemoryBlobStore } from '../server/storage.ts';
import { SyntheticRouteProvider, SyntheticLocationResolver, SyntheticListingProvider } from '../server/providers/synthetic.ts';
import type { Queue, TaskPayload } from '../server/queue.ts';
import type { Actor, CreateRunRequest, RouteProvider, RunManifest, Source } from '../shared/contracts.ts';

const alice: Actor = { uid: 'alice', admin: false };
const admin: Actor = { uid: 'admin', admin: true };

class ObservedBlobs extends MemoryBlobStore {
  afterUniverseRead?: (key: string) => Promise<void>;
  failNextDelete = false;
  override async get<T>(key: string): Promise<T | undefined> {
    const result = await super.get<T>(key);
    if (key.endsWith('/universe.json')) await this.afterUniverseRead?.(key);
    return result;
  }
  override async delete(key: string): Promise<void> {
    if (this.failNextDelete) { this.failNextDelete = false; throw new Error('Synthetic object-store deletion failure'); }
    await super.delete(key);
  }
}

async function setup() {
  const repository = new MemoryRepository(), blobs = new ObservedBlobs();
  const queued: TaskPayload[] = [];
  let now = Date.parse('2026-10-01T06:00:00Z'), routingCalls = 0;
  const underlying = new SyntheticRouteProvider();
  const provider: RouteProvider = {
    id: underlying.id, version: underlying.version, maxBatchSize: underlying.maxBatchSize,
    async route(listings, definition) { routingCalls++; return underlying.route(listings, definition); },
  };
  const queue: Queue = { async enqueue(task) { queued.push(task); } };
  const service = new CommuteService({ mode: 'demo', repo: repository, blobs, route: provider, location: new SyntheticLocationResolver(), listings: [new SyntheticListingProvider()], queue, clock: () => new Date(now), ttlMs: 60_000 });
  await service.initialise(false);
  await service.searchLocations(alice, 'EPFL');
  const selection = await service.confirmLocation(alice, 'epfl-east');
  const request: CreateRunRequest = {
    idempotencyKey: 'regression-submission-1', destinationSelectionId: selection.selectionId, marketId: 'ch-vaud-demo', searchScope: 'STANDARD',
    routeDefinition: { direction: 'HOME_TO_DESTINATION', mode: 'TRANSIT', transitPreference: 'DEFAULT', preferredTransitModes: [], timeBasis: { kind: 'ARRIVAL', at: '2026-10-06T08:00:00+02:00', timezone: 'Europe/Zurich' } },
  };
  return { service, repository, blobs, queued, request, advance: (milliseconds: number) => { now += milliseconds; }, now: () => now, routingCalls: () => routingCalls };
}

test('A20 expired run cannot begin provider work after its batch was claimed', { timeout: 10_000 }, async () => {
  const harness = await setup();
  const run = await harness.service.createRun(alice, harness.request);
  harness.blobs.afterUniverseRead = async () => { harness.advance(60_001); };
  await harness.service.processBatch(harness.queued[0]);
  assert.equal(harness.routingCalls(), 0);
  assert.equal((await harness.repository.get<RunManifest>('runs', run.id))?.externalRequests, 0);
  await assert.rejects(harness.service.run(alice, run.id), (error: any) => error.code === 'RUN_EXPIRED');
});

test('A06 stale lease claimant cannot spend after another worker owns the batch', { timeout: 10_000 }, async () => {
  const harness = await setup();
  const run = await harness.service.createRun(alice, harness.request);
  const task = harness.queued[0];
  harness.blobs.afterUniverseRead = async () => {
    await harness.repository.transaction(async transaction => {
      const batch = await transaction.get<any>('batches', task.batchId);
      transaction.put('batches', task.batchId, { ...batch, leaseToken: 'a-different-worker', leaseUntil: new Date(harness.now() + 120_000).toISOString() });
    });
  };
  await harness.service.processBatch(task);
  assert.equal(harness.routingCalls(), 0);
  assert.equal((await harness.repository.get<RunManifest>('runs', run.id))?.counts.completed, 0);
});

test('A20 cleanup retries object deletion without orphaning its manifest', { timeout: 10_000 }, async () => {
  const harness = await setup();
  const run = await harness.service.createRun(alice, harness.request);
  harness.advance(60_001);
  harness.blobs.failNextDelete = true;
  await harness.service.cleanup().catch(() => undefined);
  assert.ok(await harness.repository.get('runs', run.id), 'A cleanup reference must remain when object deletion fails.');
  assert.ok((await harness.blobs.list(`runs/${run.id}/`)).length > 0);
  await harness.service.cleanup();
  assert.equal(await harness.repository.get('runs', run.id), undefined);
  assert.deepEqual(await harness.blobs.list(`runs/${run.id}/`), []);
  assert.equal((await harness.service.entitlement(alice)).remainingRuns, 2, 'An expired reservation that never called a provider is released.');
});

test('A06 partial queue dispatch failure reports retained allowance honestly', { timeout: 10_000 }, async () => {
  const harness = await setup();
  let dispatches = 0;
  harness.service.queue = { async enqueue(task) { dispatches++; if (dispatches === 1) await harness.service.processBatch(task); else throw new Error('Synthetic queue failure'); } };
  await assert.rejects(harness.service.createRun(alice, harness.request), (error: any) => {
    assert.equal(error.code, 'DISPATCH_FAILED');
    assert.doesNotMatch(error.message, /allowance was released|unused allowance was released/i);
    return true;
  });
  assert.equal(harness.routingCalls(), 1);
  const runs = await harness.repository.query<RunManifest>('runs');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].accounting, 'FINALISED');
  assert.equal((await harness.service.entitlement(alice)).remainingRuns, 1);
});

test('A31 spending stop applies to popular maintenance as well as custom batches', { timeout: 10_000 }, async () => {
  const harness = await setup();
  await harness.service.setKillSwitch(admin, true, 'Regression test of provider spending stop');
  await harness.service.maintainPopular().catch(() => undefined);
  assert.equal(harness.routingCalls(), 0);
  assert.deepEqual(await harness.service.popularProfiles(), []);
});

test('A31 disabled listing source cannot remain in a new eligible routing universe', { timeout: 10_000 }, async () => {
  const harness = await setup();
  await harness.repository.transaction(async transaction => {
    const source = await transaction.get<Source>('sources', 'synthetic-rentals');
    transaction.put('sources', source!.id, { ...source!, enabled: false });
  });
  await assert.rejects(harness.service.createRun(alice, harness.request));
  assert.equal(harness.routingCalls(), 0);
  assert.equal(harness.queued.length, 0);
  assert.equal((await harness.service.entitlement(alice)).remainingRuns, 2);
});

test('A16 missing stored result chunks cannot be returned as a complete dataset', { timeout: 10_000 }, async () => {
  const harness = await setup();
  const run = await harness.service.createRun(alice, harness.request);
  for (const task of [...harness.queued]) await harness.service.processBatch(task);
  assert.equal((await harness.service.run(alice, run.id)).state, 'COMPLETE');
  const stored = await harness.repository.get<RunManifest>('runs', run.id);
  assert.ok(stored?.chunkRefs.length);
  await harness.blobs.delete(stored!.chunkRefs[0]);
  await assert.rejects(harness.service.results(alice, run.id), (error: any) => {
    assert.ok([409, 503].includes(error.status));
    assert.match(error.message, /incomplete|missing|unavailable|reconcile/i);
    return true;
  });
});
