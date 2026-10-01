import { timingSafeEqual } from 'node:crypto';
import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { OAuth2Client } from 'google-auth-library';
import type { Actor } from '../shared/contracts.ts';
import { ApiError, check } from './errors.ts';

export function firebaseApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault(), projectId: process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT });
}
export function constantEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function authenticate(header: string | undefined, mode: 'demo'|'live'): Promise<Actor> {
  check(header?.startsWith('Bearer '), 401, 'AUTH_REQUIRED', 'Sign in to continue.');
  const token = header!.slice(7);
  if (mode === 'demo') {
    throw new ApiError(401,'LOCAL_SESSION_REQUIRED','Sign in through the Keywise website.');
  }
  try {
    const claims = await getAuth(firebaseApp()).verifyIdToken(token, true);
    return { uid: claims.uid, admin: claims.admin === true };
  } catch { throw new ApiError(401, 'INVALID_TOKEN', 'Your sign-in has expired or is invalid. Sign in again.'); }
}
export async function authenticateTask(header: string | undefined): Promise<void> {
  const audience = process.env.WORKER_URL;
  const serviceAccount = process.env.TASKS_SERVICE_ACCOUNT_EMAIL;
  check(audience && serviceAccount && header?.startsWith('Bearer '), 401, 'TASK_AUTH_REQUIRED', 'Service authentication required.');
  try {
    const ticket = await new OAuth2Client().verifyIdToken({idToken:header!.slice(7), audience});
    const payload = ticket.getPayload();
    check(payload?.email_verified && payload.email === serviceAccount, 403, 'TASK_FORBIDDEN', 'Unexpected service identity.');
  } catch { throw new ApiError(401, 'TASK_AUTH_REQUIRED', 'Invalid task service identity.'); }
}
