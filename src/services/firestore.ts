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
 * Reviews live in ONE shared workspace that every signed-in user reads and
 * writes: `workspaces/{WORKSPACE_ID}/reviews`.
 *
 * This is a deliberate choice over per-user storage -- the team needs a
 * single view of the properties, so a colleague's upload has to show up for
 * everyone. Sign-in is still required (see firestore.rules); it gates who
 * can reach the workspace, it does not partition the data.
 *
 * To split teams later, make WORKSPACE_ID configurable and give each team
 * its own id; the rules already scope on the workspace segment.
 */
const WORKSPACE_ID = 'shared';

const reviewsCollection = (): CollectionReference => {
  if (!auth.currentUser) throw new Error('Not signed in');
  return collection(db, 'workspaces', WORKSPACE_ID, 'reviews');
};

export const isSignedIn = (): boolean => !!auth.currentUser;

// ----------------------------------------------------------------------
// localStorage is only a fast-paint cache, never the source of truth.
// Keyed by workspace rather than by user: everyone in the workspace sees the
// same reviews, so caching per uid would just duplicate identical data.
// ----------------------------------------------------------------------

const cacheKey = (): string => `${LOCAL_STORAGE_KEY}_ws_${WORKSPACE_ID}`;

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
 * Live subscription to the shared workspace.
 *
 * This is what keeps browsers consistent: an upload in one tab, browser or
 * machine reaches every other signed-in viewer without a refresh. Returns an
 * unsubscribe function.
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

/**
 * Deletion is not exposed by this module, by design.
 *
 * The workspace is shared, so a single "clear" would destroy the dataset for
 * the whole team, and the only way back is re-uploading every source file.
 * firestore.rules denies `delete` as well, so restoring a UI button here
 * would not be enough to re-enable it -- the rules have to change too.
 *
 * If a per-guest erasure flow is needed (GDPR requests), add it deliberately:
 * a narrow function scoped to one guest, not a blanket clear.
 */
