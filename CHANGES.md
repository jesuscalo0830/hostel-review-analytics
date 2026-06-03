# Hostel Analyzer - Changelog (Session April 28 - May 7, 2026)

Cumulative changelog for the Hostel Analyzer dashboard. Run `npm test` to
verify behaviour; `npm run build` to bundle; `npm run deploy` to push hosting +
Firestore rules.

## Status

| Area | Value |
|---|---|
| Build | green (vite build, 7 chunks, entry ~103 KB gzip) |
| TypeScript | clean (`tsc --noEmit`) |
| Tests | 35 / 35 passing (`npm test`) |
| Brand | Hostel Analyzer (consistent across title, sidebar, footer) |
| Verified | Booking <-> Agoda agreement within 0.6 pts on Radzone Jan-Apr 2026 |

## What you can do in the dashboard

### Data ingestion
* Upload Booking, Agoda, or PMS CSVs - parser auto-detects the format from the
  header row and tags every row with the source platform.
* Uploads stack: multiple CSVs merge in localStorage by reservation number;
  Booking + Agoda + PMS data for the same property coexist with different IDs.
* Property auto-detection: at upload time, the file's majority-mentioned
  property name (Hipstercity / Radzone / CoZzzee) is tagged on every row so
  Room Performance and Property Comparison reports get real groupings even
  when the CSV has no rental-name column.
* Best-effort translation, sentiment, and negative-theme categorisation via
  Gemini (requires `GEMINI_API_KEY` in `.env`).
* Schema-validated AI responses: malformed JSON is dropped with a console
  warning, never written to state.

### Trust signals
* Per-metric `n=X/Y` on KPI score cards so users see when sub-scores are
  missing.
* Data-quality banner counts unparseable dates and missing scores.
* Low-sample-size banner when filtered set is below 20 reviews.
* Cloud-sync status banner when Firestore writes are denied (with the exact
  fix command).
* AI-key-missing banner when `GEMINI_API_KEY` is unset or placeholder.

### Critical-issue workflow
* Critical review cards now have an action bar with three buttons:
  * Draft Reply (Gemini-generated hospitality reply, opens editable modal,
    one-click copy to clipboard)
  * Copy Review (review text to clipboard)
  * Mark Handled (per-review flag stored in localStorage)
* Actions appear in 3 places: Executive Summary's "Recent Critical Feedback",
  Critical Issues report main list, and the facilities-focused critical cards.

### Filtering and views
* Property segment filter (All / Hipstercity / Radzone / CoZzzee) backed by
  the new `property` field.
* Platform filter (All / Booking / Agoda / PMS) - only shows buttons for
  platforms actually present in the data.
* Time period filter labelled "Latest 24h / 7d / 30d (relative to data)" to
  reflect that filtering is anchored to the most recent review, not today.
* Property + location display on every review card (e.g. "Radzone * 9A
  Circular Road, Singapore").
* Guest name and booking ID pills on full review cards; inline guest/booking
  line in compact lists.

### Reliability
* localStorage is authoritative; Firestore is best-effort sync. Clears stay
  cleared even when Firestore delete is denied. Uploads work whether or not
  the rules are deployed.
* SAMPLE_CSV replaced with synthetic data - no PII in source code.
* Mojibake recovery triggers on >=1 marker with all-byte-codepoint and
  improvement-verification guards.

## Architecture notes

* `src/services/firestore.ts` - `saveReviews` returns `{ merged, localSaved,
  remoteSaved, remoteError }`; callers use `merged` directly to avoid stale
  Firestore reads.
* `src/utils/csvParser.ts` - `parseReviewCSV` dispatches to per-format
  helpers, then `tagWithMajorityProperty` for property attribution.
* `src/constants.ts` - `PROPERTY_NAMES`, `PROPERTY_LOCATIONS`,
  `resolvePropertyForReview` helper.
* `src/services/gemini.ts` - `validateTranslationArray`,
  `validateSentimentArray`, `validateCategoriesPayload`, `safeParseJSON`,
  `draftReplyToReview`.
* `src/components/Dashboard.tsx` - `matchesPropertyName`,
  `reviewLocationLabel`, `CriticalReviewActions` component.
* `vite.config.ts` - `manualChunks` groups recharts / motion / lucide /
  gemini / firebase / date-fns into separate chunks; entry dropped from
  ~377 KB gzip to ~103 KB gzip.

## Test coverage

35 tests in `src/__tests__/`:
* CSV parsing: numeric, dash placeholder, locale comma, percent signs,
  garbage->0, BOM strip, multi-line quoted reviews
* calculateAverages: empty input, missing-score exclusion + counts, NaN
  avoidance, decimal rounding
* isValidFeedback: empty / null / single-char rejection, placeholder filter,
  pure numbers/punctuation rejection, English, Vietnamese, Chinese,
  Japanese, Korean, Arabic
* detectPlatform: Booking / Agoda / PMS / Other / BOM-prefixed
* parseReviewCSV: Booking, Agoda (Service->staff, BID strip, header row
  skip), PMS (1-5 -> 1-10 normalisation, missing scores), empty body,
  unknown format
* guestName extraction: Booking, Agoda, PMS first+last combination
* tagWithMajorityProperty: majority vote across file, no property when none
  mentioned

## Cross-platform verification (Radzone, Jan-Apr 2026)

| metric        | Booking /10  | Agoda /10  | PMS /5 *2  | spread |
|---------------|--------------|------------|------------|--------|
| overall       | 7.26 (n=100) | 7.85 (n=71)| 8.68 (n=394)| 1.42  |
| staff         | 7.53 (n=97)  | 7.44 (n=71)| 8.78 (n=394)| 1.34  |
| cleanliness   | 7.35 (n=98)  | 7.72 (n=71)| 8.92 (n=394)| 1.57  |
| location      | 8.80 (n=98)  | 8.99 (n=71)| -          | 0.19  |
| facilities    | 7.17 (n=99)  | 7.41 (n=71)| -          | 0.24  |
| value         | 7.65 (n=98)  | 7.66 (n=71)| -          | 0.01  |

Math is sound; spread within selection-bias range.

## Outstanding before public launch

1. Wire Firebase Auth and re-tighten firestore.rules with `if request.auth != null`.
2. Move Gemini calls server-side (Cloud Function) so the API key isn't in the
   browser bundle.
3. Browser-side XLSX upload (SheetJS) for PMS files.
4. Rate limiting on Gemini calls.
5. React error boundary at the root.
6. Monitoring (Sentry / Firebase Performance).
7. Privacy policy + per-guest delete flow.

## How to verify locally

```
cd "C:\Users\jesus\Downloads\hostel-review-analytics revised3172026"
npm test          # 35 / 35 passing
npm run build     # vite build, ~20 s
npm run dev       # localhost:3000
npm run deploy    # pushes hosting + firestore rules to active Firebase project
```

## Deploy notes

* Active Firebase project is set in `.firebaserc`. If you have multiple
  Firebase projects, run `npx firebase use <project-id>` to switch before
  deploying.
* Hostel Analyzer is currently deployed to whichever project `.firebaserc`
  points to (was `hostel-analyzer`; may now be `vibe-collective--online-con`
  depending on history).
* To re-enable cloud sync after rules-denial: `npx firebase deploy --only firestore`.
