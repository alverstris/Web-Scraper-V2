import type { ApiErrorBody } from '../shared/contracts';

let csrfToken: string | null = null;
export function setCsrfToken(value: string | null) { csrfToken = value; }
const expiryListeners = new Set<(token: string | null) => void>();
export function subscribeSessionExpiry(listener: (token: string | null) => void) {
  expiryListeners.add(listener);
  return () => { expiryListeners.delete(listener); };
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public correlationId: string) {
    super(message);
  }
}

export async function api<T>(path: string, token: string | null, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: options.method ?? 'GET', credentials: 'same-origin', cache: 'no-store',
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(csrfToken && !['GET', 'HEAD'].includes(options.method ?? 'GET') ? { 'X-CSRF-Token': csrfToken } : {}), ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: options.signal,
  });
  const text = await response.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : null; } catch { throw new Error(`The API returned an unreadable response (${response.status}). Check the API connection.`); }
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) for (const listener of expiryListeners) listener(token);
    const error = (data as ApiErrorBody | null)?.error;
    throw new ApiError(response.status, error?.code ?? 'REQUEST_FAILED', error?.message ?? `Request failed (${response.status}).`, error?.correlationId ?? 'unavailable');
  }
  return data as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? `${error.message} Reference: ${error.correlationId}` : error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.';
}
