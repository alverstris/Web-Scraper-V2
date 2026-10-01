import { initializeApp, getApps } from 'firebase/app';
import { browserSessionPersistence, getAuth, GoogleAuthProvider, OAuthProvider, onIdTokenChanged, setPersistence, signInWithPopup, linkWithPopup, signOut, type User } from 'firebase/auth';

export interface Session { token: string | null; label: string; uid?: string; providers: string[]; admin?: boolean; email?: string; name?: string }
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
};
export const firebaseConfigured = Object.values(firebaseConfig).every(Boolean);
function auth() {
  if (!firebaseConfigured) throw new Error('Live sign-in is unavailable until Firebase is configured.');
  return getAuth(getApps()[0] ?? initializeApp(firebaseConfig));
}
function provider(kind: 'google'|'microsoft') { return kind === 'google' ? new GoogleAuthProvider() : new OAuthProvider('microsoft.com'); }
export async function signIn(kind: 'google'|'microsoft') {
  await setPersistence(auth(), browserSessionPersistence);
  await signInWithPopup(auth(), provider(kind));
}
export async function linkProvider(kind: 'google'|'microsoft') {
  const current = auth().currentUser;
  if (!current) throw new Error('Sign in before linking another provider.');
  await linkWithPopup(current, provider(kind));
}
export async function logOut() { await signOut(auth()); }
export function subscribeIdentity(callback: (session: Session) => void) {
  if (!firebaseConfigured) return () => {};
  return onIdTokenChanged(auth(), async (user: User|null) => {
    const result = user ? await user.getIdTokenResult() : null;
    callback(user && result ? { token: result.token, uid: user.uid, label: user.displayName ?? 'Signed-in account', providers: user.providerData.map(p => p.providerId), admin: result.claims.admin === true } : { token: null, label: 'Visitor', providers: [] });
  });
}
