import type { ApiErrorBody } from '../shared/contracts';

let csrfToken: string | null = null;
export function setCsrfToken(value: string | null) { csrfToken = value; }
const expiryListeners = new Set<(token: string | null) => void>();
export function subscribeSessionExpiry(listener: (token: string | null) => void) {
  expiryListeners.add(listener);
  return () => { expiryListeners.delete(listener); };
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public correlationId: string | null = null) {
    super(message);
  }
}

function connectionError(error: unknown): never {
  if (error instanceof Error && error.name === 'AbortError') throw error;
  throw new ApiError(0, 'CONNECTION_FAILED', 'Could not connect to Keywise. Check your connection and try again.');
}

function nonemptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function supportReference(value: unknown): string | null {
  const reference = nonemptyString(value);
  return reference?.toLowerCase() === 'unavailable' ? null : reference;
}

export async function api<T>(path: string, token: string | null, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: options.method ?? 'GET', credentials: 'same-origin', cache: 'no-store',
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(csrfToken && !['GET', 'HEAD'].includes(options.method ?? 'GET') ? { 'X-CSRF-Token': csrfToken } : {}), ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: options.signal,
  }).catch(connectionError);
  const text = await response.text().catch(connectionError);
  let data: unknown = null;
  let unreadable = false;
  try { data = text ? JSON.parse(text) : null; } catch { unreadable = true; }
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) for (const listener of expiryListeners) listener(token);
    const error = data && typeof data === 'object' && 'error' in data && data.error && typeof data.error === 'object'
      ? data.error as Partial<ApiErrorBody['error']> : null;
    const correlationId = supportReference(error?.correlationId) ?? supportReference(response.headers.get('X-Correlation-ID'));
    const message = nonemptyString(error?.message);
    if (message) throw new ApiError(response.status, nonemptyString(error?.code) ?? 'REQUEST_FAILED', message, correlationId);
    if ([500, 502, 503, 504].includes(response.status)) {
      throw new ApiError(response.status, 'SERVICE_UNAVAILABLE', 'Keywise is temporarily unavailable. Please try again in a moment.', correlationId);
    }
    throw new ApiError(response.status, 'REQUEST_FAILED', 'Your request could not be completed. Please try again.', correlationId);
  }
  if (unreadable) throw new ApiError(response.status, 'INVALID_RESPONSE', 'Keywise sent an unexpected response. Please try again.');
  return data as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? `${error.message}${error.correlationId ? ` Reference: ${error.correlationId}` : ''}` : error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.';
}
