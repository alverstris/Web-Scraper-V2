import test from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError, errorMessage, subscribeSessionExpiry } from '../src/api.ts';

for (const status of [500, 502, 503, 504]) {
  test(`an unstructured ${status} response gives a useful availability message without an invented reference`, async context => {
    for (const body of ['', '<html><body>Bad gateway</body></html>', '{"error":"upstream unavailable"}']) {
      context.mock.method(globalThis, 'fetch', async () => new Response(body, { status }));
      await assert.rejects(api('/auth/login', null, { method: 'POST', body: { email: 'alice@keywise.test' } }), error => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, status);
        assert.equal(error.code, 'SERVICE_UNAVAILABLE');
        assert.equal(errorMessage(error), 'Keywise is temporarily unavailable. Please try again in a moment.');
        return true;
      });
      context.mock.restoreAll();
    }
  });
}

test('structured server errors preserve their message, code and real support reference', async context => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    error: { code: 'AUTH_PROVIDER_UNAVAILABLE', message: 'External sign-in provider linking is deferred.', correlationId: 'request-123' },
  }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
  await assert.rejects(api('/auth/staff-login', null, { method: 'POST' }), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'AUTH_PROVIDER_UNAVAILABLE');
    assert.equal(errorMessage(error), 'External sign-in provider linking is deferred. Reference: request-123');
    return true;
  });
});

test('gateway support references come from real headers while missing or placeholder references are omitted', async context => {
  context.mock.method(globalThis, 'fetch', async () => new Response('Bad gateway', { status: 502, headers: { 'X-Correlation-ID': 'gateway-456' } }));
  await assert.rejects(api('/auth/staff-login', null, { method: 'POST' }), error => {
    assert.equal(errorMessage(error), 'Keywise is temporarily unavailable. Please try again in a moment. Reference: gateway-456');
    return true;
  });
  context.mock.restoreAll();
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: { code: 'INVALID_CREDENTIALS', message: 'Check your email and password.', correlationId: 'unavailable' } }), { status: 401 }));
  await assert.rejects(api('/auth/login', null, { method: 'POST' }), error => {
    assert.equal(errorMessage(error), 'Check your email and password.');
    return true;
  });
});

test('a missing body reference still uses a real server header reference', async context => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: { code: 'INVALID_CREDENTIALS', message: 'Check your email and password.', correlationId: 'unavailable' } }), { status: 401, headers: { 'X-Correlation-ID': 'server-789' } }));
  await assert.rejects(api('/auth/login', null, { method: 'POST' }), error => {
    assert.equal(errorMessage(error), 'Check your email and password. Reference: server-789');
    return true;
  });
});

test('failed connections show retry guidance without exposing browser transport details', async context => {
  context.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(api('/auth/login', null, { method: 'POST' }), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'CONNECTION_FAILED');
    assert.equal(errorMessage(error), 'Could not connect to Keywise. Check your connection and try again.');
    return true;
  });
});

test('interrupted response bodies receive the same connection guidance', async context => {
  context.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('terminated')); } })));
  await assert.rejects(api('/auth/session', null), error => {
    assert.equal(errorMessage(error), 'Could not connect to Keywise. Check your connection and try again.');
    return true;
  });
});

test('intentional request cancellation remains an AbortError', async context => {
  const controller = new AbortController();
  controller.abort();
  context.mock.method(globalThis, 'fetch', async () => { throw controller.signal.reason; });
  await assert.rejects(api('/auth/session', null, { signal: controller.signal }), error => error === controller.signal.reason);
});

test('authentication errors do not expire a session but protected 401 responses do', async context => {
  const expired: (string | null)[] = [];
  const unsubscribe = subscribeSessionExpiry(token => expired.push(token));
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in again.' } }), { status: 401 }));
  try {
    await assert.rejects(api('/auth/login', null, { method: 'POST' }));
    assert.deepEqual(expired, []);
    await assert.rejects(api('/me/account', 'expired-token'));
    assert.deepEqual(expired, ['expired-token']);
  } finally { unsubscribe(); }
});

test('successful JSON responses still return data and malformed success responses have plain retry guidance', async context => {
  context.mock.method(globalThis, 'fetch', async () => new Response('{"account":{"name":"Alice"}}', { status: 200 }));
  assert.deepEqual(await api('/auth/session', null), { account: { name: 'Alice' } });
  context.mock.restoreAll();
  context.mock.method(globalThis, 'fetch', async () => new Response('<html>Unexpected page</html>', { status: 200 }));
  await assert.rejects(api('/auth/session', null), error => {
    assert.equal(errorMessage(error), 'Keywise sent an unexpected response. Please try again.');
    return true;
  });
});
