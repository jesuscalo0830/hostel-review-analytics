/**
 * Returns true when the string contains real, analysable feedback --
 * i.e. it isn't empty, a placeholder, or a single punctuation mark.
 *
 * Filters out the common Booking.com placeholders surveyed in the wild:
 *   "-", "--", "n/a", "na", "nothing", "none", "no", "null", "...", "?", "."
 * and any combination of just punctuation / whitespace / numbers.
 *
 * Letter detection uses the Unicode `\p{L}` (any-script letter) class so
 * Vietnamese, Korean, Japanese, Chinese, Cyrillic, Arabic, etc. all pass.
 *
 * Requires at least 2 characters of meaningful content so single-letter
 * replies don't pollute keyword extraction or sentiment.
 */
export const isValidFeedback = (t: string | undefined | null): boolean => {
  if (!t) return false;
  const trimmed = t.trim();
  if (trimmed.length < 2) return false;

  const lower = trimmed.toLowerCase();

  // Exact-match placeholders
  const PLACEHOLDERS = new Set([
    '-', '--', '---', '—', '–',
    'n/a', 'na', 'n.a.', 'n/a.',
    'no', 'nope', 'none', 'nothing', 'nothing.', 'nothing!',
    'null', 'undefined', 'tbd',
    '...', '..', '.', '?', '!',
    'no comments', 'no comment', 'no review', 'no feedback',
  ]);
  if (PLACEHOLDERS.has(lower)) return false;

  // Reject strings made entirely of punctuation / whitespace / numbers --
  // i.e. require at least one letter from any script.
  if (!/\p{L}/u.test(trimmed)) return false;

  return true;
};


/**
 * True when a review carries written feedback in EITHER field.
 *
 * Critical-issue reports use this instead of checking `negativeReview`
 * alone. Two reasons:
 *  1. A 1/10 with no text at all is unactionable -- it drags the average
 *     down but tells you nothing, so it is excluded from the lists.
 *  2. Guests on some platforms type their complaint into the "liked" box,
 *     and formats with a single text column (Agoda, Guest Reviews) put
 *     everything in one field. Checking only `negativeReview` silently
 *     dropped those.
 */
export const hasWrittenFeedback = (r: {
  positiveReview?: string;
  negativeReview?: string;
}): boolean => isValidFeedback(r.negativeReview) || isValidFeedback(r.positiveReview);

/** The review text to show for a critical review, whichever field holds it. */
export const criticalFeedbackText = (r: {
  positiveReview?: string;
  negativeReview?: string;
  translatedPositive?: string;
  translatedNegative?: string;
}): string => {
  const neg = r.translatedNegative || r.negativeReview;
  if (isValidFeedback(neg)) return neg as string;
  return (r.translatedPositive || r.positiveReview || '') as string;
};

/**
 * True when a review is tied to a real reservation, i.e. a "verified stay".
 *
 * There is no explicit `Verified` column in any supported export. The signal
 * is the booking reference: Booking.com, Agoda and Expedia only accept a
 * review from a guest with a completed reservation, and carry that reference
 * on every row. Open platforms like Google let anyone post and supply no
 * reference, so those come through unverified.
 *
 * Placeholder values ("-", "n/a", "undefined") are treated as absent -- some
 * exports fill the column rather than leaving it blank.
 */
export const isVerifiedStay = (r: { reservationNumber?: string }): boolean => {
  const id = (r.reservationNumber || '').trim();
  if (!id) return false;
  const lower = id.toLowerCase();
  if (['-', '--', 'n/a', 'na', 'none', 'null', 'undefined', '0'].includes(lower)) return false;
  // Require at least one alphanumeric character.
  return /[a-z0-9]/i.test(id);
};
