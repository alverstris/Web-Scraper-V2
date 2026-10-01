/** Small trust-boundary proxy. Identity, allowance and spending checks belong to the API. */
export interface EdgeEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  API_ORIGIN?: string;
  EDGE_ORIGIN_SECRET?: string;
  APP_ENV?: string;
  FIREBASE_AUTH_DOMAIN?: string;
  API_ENABLED?: string;
  GOOGLE_MAPS_ENABLED?: string;
  TURNSTILE_ENABLED?: string;
}

const noStore = 'private, no-store, max-age=0';
const safeRequestHeaders = ['accept', 'authorization', 'content-type', 'idempotency-key', 'x-request-id'];

function secure(response: Response, api: boolean, env: EdgeEnv): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Strict-Transport-Security', 'max-age=31536000');
  if (api) {
    headers.set('Cache-Control', noStore);
    headers.set('CDN-Cache-Control', 'no-store');
    headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
    headers.set('Pragma', 'no-cache');
    headers.set('Vary', 'Authorization');
    headers.delete('ETag');
    headers.delete('Last-Modified');
    headers.delete('Set-Cookie');
  } else {
    // OAuth popup communication needs same-origin-allow-popups rather than same-origin.
    headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    const auth = env.FIREBASE_AUTH_DOMAIN && /^[a-z0-9.-]+$/i.test(env.FIREBASE_AUTH_DOMAIN)
      ? `https://${env.FIREBASE_AUTH_DOMAIN}` : '';
    const maps = env.GOOGLE_MAPS_ENABLED === 'true';
    const challenge = env.TURNSTILE_ENABLED === 'true' ? ' https://challenges.cloudflare.com' : '';
    // Google's Maps JavaScript runtime currently documents an unsafe-eval requirement.
    // Keep that capability absent from ordinary demo/auth deployments.
    const mapScripts = maps ? " https://*.googleapis.com https://*.gstatic.com 'unsafe-eval' blob:" : '';
    const mapImages = maps ? ' https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.googleusercontent.com' : '';
    const mapConnections = maps ? ' https://*.googleapis.com https://*.google.com https://*.gstatic.com data: blob:' : '';
    const frames = [auth, maps ? 'https://*.google.com' : '', challenge.trim()].filter(Boolean).join(' ') || "'none'";
    headers.set('Content-Security-Policy', [
      "default-src 'self'", `script-src 'self' https://apis.google.com${mapScripts}${challenge}`,
      // React marker positions and later motion use style attributes; scripts remain strict.
      `style-src 'self' 'unsafe-inline'${maps ? ' https://fonts.googleapis.com' : ''}`,
      `img-src 'self' data:${mapImages}`, `font-src 'self'${maps ? ' https://fonts.gstatic.com' : ''}`,
      `connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com ${auth}${mapConnections}${challenge}`,
      `frame-src ${frames}`, "object-src 'none'", "base-uri 'self'",
      "form-action 'self'", "frame-ancestors 'none'", "worker-src 'self' blob:",
    ].join('; '));
    if (headers.get('Content-Type')?.includes('text/html')) headers.set('Cache-Control', 'no-cache');
  }
  headers.delete('X-Edge-Secret');
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
}

function error(status: number, code: string, message: string, env: EdgeEnv): Response {
  return secure(Response.json({ error: {code, message, correlationId: crypto.randomUUID()} }, {status}), true, env);
}

export async function handleRequest(request: Request, env: EdgeEnv, fetchOrigin: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');
  if (!isApi) return secure(await env.ASSETS.fetch(request), false, env);
  if (!url.pathname.startsWith('/api/v1/')) return error(404, 'NOT_FOUND', 'API endpoint not found.', env);
  if (!['GET', 'HEAD', 'POST', 'DELETE', 'PATCH', 'PUT'].includes(request.method)) {
    return error(405, 'METHOD_NOT_ALLOWED', 'This API method is not supported.', env);
  }
  // Reject cross-origin mutation before reaching the origin. Tokens are never cookie credentials.
  const callerOrigin = request.headers.get('Origin');
  if (callerOrigin && callerOrigin !== url.origin) return error(403, 'ORIGIN_DENIED', 'Use this site to access the API.', env);
  if (env.API_ENABLED !== 'true') return error(503, 'API_PAUSED', 'The service is temporarily paused.', env);
  if (!env.API_ORIGIN || !env.EDGE_ORIGIN_SECRET || env.EDGE_ORIGIN_SECRET.length < 32) {
    return error(503, 'ORIGIN_UNAVAILABLE', 'The API connection has not been configured.', env);
  }
  let origin: URL;
  try { origin = new URL(env.API_ORIGIN); } catch { return error(503, 'ORIGIN_UNAVAILABLE', 'Invalid API configuration.', env); }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    return error(503, 'ORIGIN_UNAVAILABLE', 'The API origin must be an HTTPS origin.', env);
  }
  const announcedSize = Number(request.headers.get('Content-Length') || 0);
  if (!Number.isFinite(announcedSize) || announcedSize < 0 || announcedSize > 65_536) {
    return error(413, 'REQUEST_TOO_LARGE', 'The request exceeds the API size limit.', env);
  }
  // Construct a new header set: no caller-supplied edge credential, demo identity,
  // forwarded identity, host, cookies, challenge bypass or Cloud Tasks headers survives.
  const headers = new Headers();
  for (const key of safeRequestHeaders) {
    const value = request.headers.get(key);
    if (value !== null) headers.set(key, value);
  }
  headers.set('X-Edge-Secret', env.EDGE_ORIGIN_SECRET);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Request-ID', crypto.randomUUID());
  const target = new URL(url.pathname + url.search, origin);
  let body: ArrayBuffer | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    // API rejects oversized streams too; bound edge buffering independently of Content-Length.
    const reader = request.body?.getReader();
    const parts: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.length;
        if (total > 65_536) { await reader.cancel(); return error(413, 'REQUEST_TOO_LARGE', 'The request exceeds the API size limit.', env); }
        parts.push(part.value);
      }
    }
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) { joined.set(part, offset); offset += part.length; }
    body = joined.buffer;
  }
  try {
    const result = await fetchOrigin(target, {method: request.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(25_000)});
    // Never follow a provider/origin redirect with either identity or edge credentials.
    if (result.status >= 300 && result.status < 400) return error(502, 'ORIGIN_REDIRECT', 'Unexpected API redirect.', env);
    return secure(result, true, env);
  } catch {
    return error(502, 'ORIGIN_UNAVAILABLE', 'The API could not be reached. Please retry.', env);
  }
}

export default { fetch(request: Request, env: EdgeEnv) { return handleRequest(request, env); } };
