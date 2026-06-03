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
