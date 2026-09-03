import { initializeApp } from "firebase/app";
import {
  getFirestore,
  enableIndexedDbPersistence,
} from "firebase/firestore";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  onAuthStateChanged,
  type User,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyARDxZy2tSoCiePy4I05RTztHqfYs9ctHI",
  authDomain: "hostel-analyzer.firebaseapp.com",
  projectId: "hostel-analyzer",
  storageBucket: "hostel-analyzer.firebasestorage.app",
  messagingSenderId: "928259806921",
  appId: "1:928259806921:web:50e29268fb8408e6d45f18"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

/**
 * Cache Firestore data in IndexedDB so the dashboard still renders when the
 * network is slow or unavailable, and page loads don't block on a round trip.
 *
 * Only one tab can hold the lease: `failed-precondition` means another tab
 * already has it, and `unimplemented` means the browser doesn't support it.
 * Both are fine -- the app works, just without the offline cache.
 */
try {
  enableIndexedDbPersistence(db).catch((err: { code?: string }) => {
    if (err?.code === 'failed-precondition') {
      console.info('[firestore] offline cache active in another tab.');
    } else if (err?.code === 'unimplemented') {
      console.info('[firestore] offline cache unsupported in this browser.');
    } else {
      console.warn('[firestore] offline cache unavailable:', err);
    }
  });
} catch (err) {
  console.warn('[firestore] offline cache could not be enabled:', err);
}

export type { User };

/**
 * Sign in with Google.
 *
 * Popups are blocked by default in some browsers and in embedded webviews,
 * so fall back to a full-page redirect rather than failing silently.
 */
export const signInWithGoogle = async (): Promise<void> => {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (err: any) {
    const code = err?.code || '';
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
      return;
    }
    // A user closing the popup is not an error worth surfacing.
    if (code === 'auth/cancelled-popup-request' || code === 'auth/popup-closed-by-user') return;
    throw err;
  }
};

export const signOutUser = (): Promise<void> => signOut(auth);

/** Subscribe to sign-in state. Returns the unsubscribe function. */
export const onAuthChange = (cb: (user: User | null) => void): (() => void) =>
  onAuthStateChanged(auth, cb);

export default app;
