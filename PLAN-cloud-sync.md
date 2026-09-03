# Plan: make Firestore the source of truth (Google sign-in, private)

## The problem

Reviews live in each browser's `localStorage`. `fetchReviews()` sets a
`hostel_user_initialized` flag on first upload and from then on reads only
from that browser, never from Firestore. So Chrome and Brave hold separate
datasets, clearing browser data destroys the reviews, and the counts differ
everywhere.

Current `firestore.rules` also allow **anyone on the internet** to read every
review and create new ones (`allow read: if true`).

## Target

- Sign in with Google. Reviews stored at `users/{uid}/reviews/{reviewId}`.
- Same data in every browser you sign into; invisible to everyone else.
- Firestore authoritative, `localStorage` demoted to an offline cache.
- Starting clean: no migration, re-upload from source files.

---

## Step 1 — Firebase console (manual, ~3 min)

1. [Authentication → Sign-in method](https://console.firebase.google.com/project/hostel-analyzer/authentication/providers)
   → enable **Google**. Set the support email when prompted.
2. [Authentication → Settings → Authorized domains](https://console.firebase.google.com/project/hostel-analyzer/authentication/settings)
   → confirm `hostel-analyzer.web.app` and `localhost` are listed.

Nothing else works until this is done — the sign-in popup will fail with
`auth/operation-not-allowed`.

## Step 2 — Rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/reviews/{reviewId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

Deploy with `npm run deploy:rules`. If `firebaserules.googleapis.com` is
still unreachable locally, paste the rules directly into
[the console rules editor](https://console.firebase.google.com/project/hostel-analyzer/firestore/rules)
and publish there — same result, different network path.

The old top-level `reviews` collection stops being readable. Delete it in the
console once the new flow is confirmed working.

## Step 3 — `src/lib/firebase.ts`

Add `getAuth`, export `auth`, and a `signInWithGoogle()` helper using
`signInWithPopup(auth, new GoogleAuthProvider())`. Export an
`onAuthChange(cb)` wrapper over `onAuthStateChanged` so React can subscribe.

Also call `enableIndexedDbPersistence(db)` so the app still renders offline
and page loads don't block on the network. Wrap it in try/catch — it throws
`failed-precondition` when several tabs are open, which is harmless.

## Step 4 — `src/services/firestore.ts`

Four exported functions, all called only from `App.tsx`, so the surface is
small. Keep the signatures; change what they talk to.

- `reviewsCollection()` — returns `collection(db, 'users', uid, 'reviews')`,
  throwing if no user is signed in.
- `fetchReviews()` — read from Firestore. Drop the `userHasInitialized`
  short-circuit entirely; that flag exists only to protect the localStorage
  model and becomes wrong here.
- `saveReviews()` — write to Firestore, keep returning
  `{ merged, added, updated }`. Compute `added` / `updated` from which doc
  ids already existed, same as now but against the server state.
- `clearAllReviews()` — batch delete under the user's subcollection.
- New `subscribeToReviews(cb)` — `onSnapshot` on the collection so a second
  browser or tab updates live. This is what actually fixes "different
  browsers show different results".

`localStorage` writes stay as a fast first paint, but Firestore data always
wins when it arrives.

## Step 5 — `src/App.tsx`

- Track `user` state via `onAuthChange`.
- Three render states: `loading` → `signed out` (sign-in screen) →
  `signed in` (dashboard). The existing `isLoaded` spinner covers the first.
- Replace the one-shot `fetchReviews()` in the load effect with
  `subscribeToReviews`, cleaning up the listener on unmount.
- Keep the translation-repair pass, but run it after the first snapshot
  arrives rather than before sign-in.

## Step 6 — Sign-in screen

Small component: product name, one "Sign in with Google" button, and an
error line for popup-blocked / cancelled. Popups are blocked by default in
some browsers, so fall back to `signInWithRedirect` when
`signInWithPopup` rejects with `auth/popup-blocked`.

Add a sign-out control to the existing settings/gear menu, showing which
account is active.

## Step 7 — Verify

1. Sign in, upload one file, confirm the count.
2. Open a **different browser**, sign in with the same account → identical
   count without uploading anything. This is the acceptance test.
3. Clear browser data in one, reload → data returns from Firestore.
4. Sign out → dashboard is inaccessible, no reviews readable.
5. Confirm in the console that documents land under `users/{uid}/reviews`.

---

## Risks and trade-offs

- **Writes cost quota.** 274 reviews is 274 document writes per full
  re-upload. The free tier allows 20k writes/day, so this is fine, but a
  runaway loop would not be. `saveReviews` already batches at 500.
- **Sign-in adds friction** for a tool you currently open and use. That is
  the price of the data being private and shared across devices.
- **Firestore becomes a hard dependency.** If it is unreachable the app
  shows cached data (via IndexedDB persistence) but cannot save. Today's
  behaviour degrades more gracefully because local is authoritative.
- **The old `reviews` collection is orphaned.** Anything already synced
  there stays visible to the world until deleted, since the current rules
  are public. Delete it as part of Step 2.
- **Multi-tab persistence.** `enableIndexedDbPersistence` only enables in
  one tab; others still work, just without offline cache.

## Not included

- Sharing with teammates. Adding it later means moving reviews to a
  `properties/{propertyId}` collection with a members list rather than
  scoping by `uid` — worth knowing now, because it changes the data path.
- The `GEMINI_API_KEY` build secret and the exposed-key problem. Separate
  issue, unaffected by any of this.

## Effort

Roughly 1–2 hours of implementation, plus your 3 minutes in the console. The
riskiest part is Step 5, because the load effect currently does several
things at once (fetch, translate, seed sample data) and needs to be
re-ordered around an auth gate.
