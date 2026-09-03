import {
  collection,
  getDocs,
  writeBatch,
  doc,
  onSnapshot,
  type CollectionReference,
} from "firebase/firestore";
import { db, auth } from "../lib/firebase";
import { BookingReview } from "../types";

const LOCAL_STORAGE_KEY = "hostel_reviews_fallback";

/**
 * Document id for a review.
 *
 * Prefers the platform's reservation number. Placeholder values ("-", "n/a")
 * are rejected so unrelated rows don't collide on a shared junk id; those
 * fall back to a hash of the content, scoped by property so the same text
 * from two hostels stays distinct.
 */
const idFor = (review: BookingReview): string => {
  const resNum = (review.reservationNumber || '').trim();
  const validResNum = resNum && !['undefined', 'null', '-', '--', 'n/a', 'na', '0'].includes(resNum.toLowerCase());
  const id = validResNum
    ? resNum
    : btoa(encodeURIComponent(
        `${review.property || ''}-${review.reviewDate}-${review.reviewTitle}-${review.reviewScore}` +
        `-${(review.positiveReview || '').substring(0, 10)}` +
        `-${(review.negativeReview || '').substring(0, 10)}`
      )).substring(0, 28);
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
};

/**
 * Reviews are stored per account at `users/{uid}/reviews`, which is what
 * makes the same data appear in every browser you sign into -- and what
 * keeps it invisible to everyone else (see firestore.rules).
 */
const reviewsCollection = (): CollectionReference => {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in');
  return collection(db, 'users', uid, 'reviews');
};

export const isSignedIn = (): boolean => !!auth.currentUser;

// ----------------------------------------------------------------------
// localStorage is now only a fast-paint cache, never the source of truth.
// It is namespaced per uid so switching accounts in one browser cannot show
// the previous account's reviews.
// ----------------------------------------------------------------------

const cacheKey = (): string => `${LOCAL_STORAGE_KEY}_${auth.currentUser?.uid || 'anon'}`;

const readCache = (): BookingReview[] => {
  try {
    const raw = localStorage.getItem(cacheKey());
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const writeCache = (reviews: BookingReview[]): void => {
  try {
    localStorage.setItem(cacheKey(), JSON.stringify(reviews));
  } catch (e) {
    // Quota exceeded is survivable: Firestore still has the data.
    console.warn("[cache] write failed:", e);
  }
};

/** Read whatever the cache holds for the current account, for first paint. */
export const readCachedReviews = (): BookingReview[] => readCache();

/**
 * Saves reviews to Firestore and refreshes the cache.
 *
 * `added` / `updated` are computed against the ids already on the server, so
 * the upload toast can report what actually changed. Counting after the merge
 * always found every row present, which made every upload look like a
 * duplicate.
 */
export const saveReviews = async (
  reviews: BookingReview[]
): Promise<{
  merged: BookingReview[];
  added: number;
  updated: number;
  localSaved: number;
  remoteSaved: number;
  remoteError?: string;
}> => {
  if (!auth.currentUser) {
    return { merged: readCache(), added: 0, updated: 0, localSaved: 0, remoteSaved: 0, remoteError: 'Not signed in' };
  }

  const col = reviewsCollection();

  // Existing server state, to classify each row and to merge into.
  const existing = new Map<string, BookingReview>();
  try {
    const snap = await getDocs(col);
    snap.forEach(d => existing.set(d.id, d.data() as BookingReview));
  } catch (err: any) {
    // Offline: fall back to the cache so an upload isn't lost.
    readCache().forEach(r => existing.set(idFor(r), r));
    console.warn("[firestore] read before save failed, using cache:", err?.message || err);
  }

  let added = 0;
  let updated = 0;
  for (const r of reviews) {
    const id = idFor(r);
    if (existing.has(id)) updated++; else added++;
    existing.set(id, r);
  }
  const merged = [...existing.values()];
  writeCache(merged);

  let remoteSaved = 0;
  let remoteError: string | undefined;
  const BATCH_SIZE = 500;
  try {
    for (let i = 0; i < reviews.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      const chunk = reviews.slice(i, i + BATCH_SIZE);
      chunk.forEach(review => batch.set(doc(col, idFor(review)), review, { merge: true }));
      await batch.commit();
      remoteSaved += chunk.length;
    }
  } catch (err: any) {
    remoteError = err?.message || String(err);
    console.warn(`[firestore] write failed: ${remoteError}`);
  }

  return { merged, added, updated, localSaved: reviews.length, remoteSaved, remoteError };
};

/** One-shot read. Prefer subscribeToReviews for anything long-lived. */
export const fetchReviews = async (): Promise<BookingReview[]> => {
  if (!auth.currentUser) return [];
  try {
    const snap = await getDocs(reviewsCollection());
    const reviews: BookingReview[] = [];
    snap.forEach(d => reviews.push(d.data() as BookingReview));
    writeCache(reviews);
    return reviews;
  } catch (error) {
    console.warn("[firestore] read failed, using cache:", error);
    return readCache();
  }
};

/**
 * Live subscription to the signed-in user's reviews.
 *
 * This is what keeps browsers consistent: an upload in one tab or browser
 * reaches the others without a refresh. Returns an unsubscribe function.
 */
export const subscribeToReviews = (
  onData: (reviews: BookingReview[]) => void,
  onError?: (err: Error) => void
): (() => void) => {
  if (!auth.currentUser) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    reviewsCollection(),
    snap => {
      const reviews: BookingReview[] = [];
      snap.forEach(d => reviews.push(d.data() as BookingReview));
      writeCache(reviews);
      onData(reviews);
    },
    err => {
      console.warn("[firestore] subscription error:", err);
      onError?.(err);
    }
  );
};

/** Deletes every review for the signed-in account. */
export const clearAllReviews = async (): Promise<void> => {
  try {
    localStorage.removeItem(cacheKey());
  } catch (e) {
    console.error("Cache clear failed:", e);
  }

  if (!auth.currentUser) return;

  try {
    const snap = await getDocs(reviewsCollection());
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += 500) {
      const batch = writeBatch(db);
      docs.slice(i, i + 500).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
  } catch (error) {
    console.warn("[firestore] remote clear failed:", error);
    throw error;
  }
};

/**
 * Privacy / GDPR: delete every review for one guest, matched by exact guest
 * name (case-insensitive) or reservation number.
 */
export const deleteReviewsForGuest = async (
  query: string
): Promise<{ removed: number; remaining: BookingReview[] }> => {
  const q = query.trim().toLowerCase();
  if (!q || !auth.currentUser) return { removed: 0, remaining: readCache() };

  const col = reviewsCollection();
  const snap = await getDocs(col);
  const matches: string[] = [];
  const remaining: BookingReview[] = [];
  snap.forEach(d => {
    const r = d.data() as BookingReview;
    const hit =
      (r.guestName || '').trim().toLowerCase() === q ||
      (r.reservationNumber || '').trim().toLowerCase() === q;
    if (hit) matches.push(d.id); else remaining.push(r);
  });

  for (let i = 0; i < matches.length; i += 500) {
    const batch = writeBatch(db);
    matches.slice(i, i + 500).forEach(id => batch.delete(doc(col, id)));
    await batch.commit();
  }
  writeCache(remaining);
  return { removed: matches.length, remaining };
};
