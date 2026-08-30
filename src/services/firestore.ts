import {
  collection,
  getDocs,
  writeBatch,
  doc,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { BookingReview } from "../types";

const REVIEWS_COLLECTION = "reviews";
const LOCAL_STORAGE_KEY = "hostel_reviews_fallback";
const USER_INITIALIZED_KEY = "hostel_user_initialized";

const idFor = (review: BookingReview): string => {
  const resNum = (review.reservationNumber || '').trim();
  const validResNum = resNum && !['undefined', 'null', '-', '--', 'n/a', 'na'].includes(resNum.toLowerCase());
  let id = validResNum
    ? resNum
    : btoa(encodeURIComponent(
        `${review.property || ''}-${review.reviewDate}-${review.reviewTitle}-${review.reviewScore}` +
        `-${(review.positiveReview || '').substring(0, 10)}` +
        `-${(review.negativeReview || '').substring(0, 10)}`
      )).substring(0, 28);
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
};

const readLocal = (): BookingReview[] => {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const writeLocal = (reviews: BookingReview[]): void => {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(reviews));
  } catch (e) {
    console.error("Local storage write failed:", e);
  }
};

const userHasInitialized = (): boolean => {
  try {
    return localStorage.getItem(USER_INITIALIZED_KEY) === 'true';
  } catch {
    return false;
  }
};

/**
 * Saves reviews. localStorage is the AUTHORITATIVE store -- this function
 * merges the new batch into local state and returns the merged result so
 * the caller can update React state directly without a round-trip through
 * fetchReviews (which historically caused stale Firestore data to clobber
 * the local view after a clear).
 *
 * Firestore writes are best-effort sync. If they fail (rules denial,
 * offline) the local save still succeeded.
 */
export const saveReviews = async (
  reviews: BookingReview[]
): Promise<{
  merged: BookingReview[];
  /** Rows appended because no existing review shared their id. */
  added: number;
  /** Rows that matched an existing review and replaced it. */
  updated: number;
  localSaved: number;
  remoteSaved: number;
  remoteError?: string;
}> => {
  // 1. Merge into localStorage (authoritative)
  const existingLocal = readLocal();
  const merged = [...existingLocal];
  // Counted here rather than by the caller: only this function can see the
  // pre-merge state, and comparing against `merged` afterwards always finds
  // every row present, which made every upload look like a duplicate.
  let added = 0;
  let updated = 0;
  reviews.forEach(r => {
    const targetId = idFor(r);
    const idx = merged.findIndex(m => idFor(m) === targetId);
    if (idx >= 0) { merged[idx] = r; updated++; }
    else { merged.push(r); added++; }
  });
  writeLocal(merged);

  // 2. Firestore best-effort sync
  let remoteSaved = 0;
  let remoteError: string | undefined;
  const BATCH_SIZE = 500;
  try {
    for (let i = 0; i < reviews.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      const chunk = reviews.slice(i, i + BATCH_SIZE);
      chunk.forEach(review => {
        const docRef = doc(db, REVIEWS_COLLECTION, idFor(review));
        batch.set(docRef, review, { merge: true });
      });
      await batch.commit();
      remoteSaved += chunk.length;
    }
  } catch (err: any) {
    remoteError = err?.message || String(err);
    console.warn(
      `[firestore] write skipped: ${remoteError}. ` +
      `Data is authoritative in localStorage; deploy firestore.rules to enable cloud sync.`
    );
  }

  return { merged, added, updated, localSaved: reviews.length, remoteSaved, remoteError };
};

/**
 * Returns the user's reviews.
 *
 * Source-of-truth rule:
 *  - If the user has ever uploaded or cleared (userInitialized flag set),
 *    localStorage is authoritative. We do NOT pull from Firestore -- that
 *    would re-import stale cloud data after a local clear.
 *  - If the user is brand-new (no flag, no local data), we read Firestore
 *    once as a bootstrap. This preserves the original "first-run pulls
 *    sample data from Firestore" behaviour without breaking clears.
 */
export const fetchReviews = async (): Promise<BookingReview[]> => {
  if (userHasInitialized()) {
    return readLocal();
  }

  // First-run bootstrap path
  try {
    const querySnapshot = await getDocs(collection(db, REVIEWS_COLLECTION));
    const reviews: BookingReview[] = [];
    querySnapshot.forEach(d => {
      reviews.push(d.data() as BookingReview);
    });
    if (reviews.length > 0) {
      writeLocal(reviews);
      return reviews;
    }
  } catch (error) {
    console.warn("[firestore] read failed, using local storage:", error);
  }
  return readLocal();
};

/**
 * Clears reviews everywhere, locally first (always succeeds) then remotely
 * (best-effort). Local clear is what the user actually sees -- a denied
 * remote delete is logged but doesn't undo the clear.
 */
export const clearAllReviews = async (): Promise<void> => {
  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  } catch (e) {
    console.error("Local storage clear failed:", e);
  }

  try {
    const querySnapshot = await getDocs(collection(db, REVIEWS_COLLECTION));
    const batch = writeBatch(db);
    querySnapshot.forEach(d => batch.delete(d.ref));
    await batch.commit();
  } catch (error) {
    console.warn(
      "[firestore] remote clear failed (likely rules denial); " +
      "local clear is still in effect. Deploy firestore.rules to enable cloud delete."
    );
  }
};
