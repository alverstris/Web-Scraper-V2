import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {handleRequest, type EdgeEnv} from '../edge/worker.ts';

const env: EdgeEnv = {ASSETS: {fetch: async () => new Response('<!doctype html>app', {headers: {'Content-Type':'text/html'}})}, API_ENABLED: 'true', API_ORIGIN: 'https://origin.example.com', EDGE_ORIGIN_SECRET: 'a'.repeat(40)};

test('all unknown API paths fail without SPA fallback and are uncacheable', async () => {
  for (const path of ['/api', '/api/', '/api/unknown']) {
    const response = await worker.fetch(new Request(`https://app.example.com${path}`), env);
    assert.equal(response.status, 404);
    assert.match(response.headers.get('Cache-Control')!, /no-store/);
    assert.equal(response.headers.get('Cloudflare-CDN-Cache-Control'), 'no-store');
    assert.equal((await response.json()).error.code, 'NOT_FOUND');
  }
});

test('proxy replaces edge credentials, drops demo identity and preserves Firebase bearer', async () => {
  const request = new Request('https://app.example.com/api/v1/runs', {method:'POST', headers:{Authorization:'Bearer firebase-token', 'X-Edge-Secret':'attacker', 'X-Demo-User':'admin', 'X-Forwarded-User':'other', Cookie:'session=attack','Content-Type':'application/json'}, body:'{}'});
  const response = await handleRequest(request, env, async (target, init) => {
    assert.equal(String(target), 'https://origin.example.com/api/v1/runs');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('X-Edge-Secret'), env.EDGE_ORIGIN_SECRET);
    assert.equal(headers.get('Authorization'), 'Bearer firebase-token');
    assert.equal(headers.get('X-Demo-User'), null);
    assert.equal(headers.get('X-Forwarded-User'), null);
    assert.equal(headers.get('Cookie'), null);
    assert.equal(init?.redirect, 'manual');
    return Response.json({id:'run-1'}, {headers:{'Cache-Control':'public, max-age=9999', ETag:'private'}});
  });
  assert.match(response.headers.get('Cache-Control')!, /no-store/);
  assert.equal(response.headers.get('ETag'), null);
});

test('edge refuses disabled, misconfigured and cross-origin requests without calling origin', async () => {
  let calls = 0;
  const origin = async () => { calls++; return Response.json({}); };
  const request = new Request('https://app.example.com/api/v1/capabilities');
  assert.equal((await handleRequest(request, {...env, API_ENABLED:'false'}, origin)).status, 503);
  assert.equal((await handleRequest(request, {...env, API_ORIGIN:'http://insecure.example.com'}, origin)).status, 503);
  assert.equal((await handleRequest(request, {...env, EDGE_ORIGIN_SECRET:'short'}, origin)).status, 503);
  assert.equal((await handleRequest(new Request(request, {headers:{Origin:'https://attacker.example.com'}}), env, origin)).status, 403);
  assert.equal(calls, 0);
});

test('origin errors, redirects and 404s cannot turn into cached HTML', async () => {
  const request = new Request('https://app.example.com/api/v1/missing');
  for (const status of [404, 500]) {
    const response = await handleRequest(request, env, async () => Response.json({error:'missing'}, {status}));
    assert.equal(response.status, status);
    assert.match(response.headers.get('Cache-Control')!, /no-store/);
  }
  assert.equal((await handleRequest(request, env, async () => new Response(null, {status:302,headers:{Location:'https://attacker.example.com'}}))).status, 502);
});

test('HTML has strict script policy and allows OAuth popup exchange', async () => {
  const response = await handleRequest(new Request('https://app.example.com/search'), env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Security-Policy')!, /frame-ancestors 'none'/);
  assert.match(response.headers.get('Content-Security-Policy')!, /script-src 'self' https:\/\/apis.google.com;/);
  assert.equal(response.headers.get('Cross-Origin-Opener-Policy'), 'same-origin-allow-popups');
});

test('oversized streams cannot bypass the declared content length limit', async () => {
  let calls = 0;
  const response = await handleRequest(new Request('https://app.example.com/api/v1/runs', {method:'POST',body:'x'.repeat(65_537)}), env, async () => {calls++;return Response.json({});});
  assert.equal(response.status, 413);
  assert.equal(calls, 0);
});

test('map-specific CSP permissions require explicit enablement', async () => {
  const request = new Request('https://app.example.com/');
  const ordinary = await handleRequest(request, env);
  assert.doesNotMatch(ordinary.headers.get('Content-Security-Policy')!, /unsafe-eval|fonts.gstatic/);
  const maps = await handleRequest(request, {...env, GOOGLE_MAPS_ENABLED:'true'});
  assert.match(maps.headers.get('Content-Security-Policy')!, /https:\/\/\*\.googleapis.com/);
  assert.match(maps.headers.get('Content-Security-Policy')!, /font-src 'self' https:\/\/fonts.gstatic.com/);
});
