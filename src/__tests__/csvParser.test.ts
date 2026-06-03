/**
 * Unit tests for csvParser.ts and validation.ts.
 *
 * Run with:  npx tsx --test src/__tests__/csvParser.test.ts
 *
 * These tests target the bugs that have already bitten us — missing scores,
 * locale decimal commas, BOMs, multi-line quoted reviews, placeholder rejection,
 * Unicode-letter handling. If a regression breaks any of these, the dashboard
 * will silently produce wrong numbers, so keep the bar high.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBookingCSV, calculateAverages } from '../utils/csvParser';
import { isValidFeedback } from '../utils/validation';

const HEADER = '"Review date","Guest name","Reservation number","Review title","Positive review","Negative review","Review score","Staff","Cleanliness","Location","Facilities","Comfort","Value for money","Property reply"';

const row = (cols: string[]) => cols.map(c => `"${c.replace(/"/g, '""')}"`).join(',');

// ----------------------------------------------------------------------
// parseBookingCSV — score robustness
// ----------------------------------------------------------------------

test('parseBookingCSV: standard numeric scores parse correctly', () => {
  const csv = HEADER + '\n' + row(['2026-01-01', 'A', '1', '', 'good', '', '8', '7.5', '8.5', '9', '7', '8', '8', '']);
  const reviews = parseBookingCSV(csv);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].reviewScore, 8);
  assert.equal(reviews[0].staff, 7.5);
  assert.equal(reviews[0].cleanliness, 8.5);
});

test('parseBookingCSV: dash placeholder becomes 0 (the missing-score sentinel)', () => {
  const csv = HEADER + '\n' + row(['2026-01-01', 'A', '1', '', 'good', '', '8', '-', '-', '9', '-', '8', '-', '']);
  const reviews = parseBookingCSV(csv);
  assert.equal(reviews[0].staff, 0);
  assert.equal(reviews[0].cleanliness, 0);
  assert.equal(reviews[0].facilities, 0);
  assert.equal(reviews[0].valueForMoney, 0);
});

test('parseBookingCSV: locale decimal comma is normalised', () => {
  const csv = HEADER + '\n' + row(['2026-01-01', 'A', '1', '', '', '', '8,5', '7,5', '8', '9', '7', '8', '8', '']);
  const reviews = parseBookingCSV(csv);
  assert.equal(reviews[0].reviewScore, 8.5);
  assert.equal(reviews[0].staff, 7.5);
});

test('parseBookingCSV: percent signs stripped', () => {
  const csv = HEADER + '\n' + row(['2026-01-01', 'A', '1', '', '', '', '85%', '70%', '90%', '95%', '80%', '85%', '85%', '']);
  const reviews = parseBookingCSV(csv);
  assert.equal(reviews[0].reviewScore, 85);
});

test('parseBookingCSV: garbage non-numeric becomes 0, not NaN', () => {
  const csv = HEADER + '\n' + row(['2026-01-01', 'A', '1', '', '', '', 'good', 'great', 'excellent', '9', '7', '8', '8', '']);
  const reviews = parseBookingCSV(csv);
  assert.equal(reviews[0].reviewScore, 0);
  assert.equal(reviews[0].staff, 0);
  assert.ok(!Number.isNaN(reviews[0].reviewScore));
});

test('parseBookingCSV: BOM at start of file is stripped', () => {
  const csv = '﻿' + HEADER + '\n' + row(['2026-01-01', 'A', '1', '', 'good', '', '8', '8', '8', '8', '8', '8', '8', '']);
  const reviews = parseBookingCSV(csv);
  assert.equal(reviews.length, 1);
  // Without BOM strip, the first column header would be "﻿Review date" and
  // reviewDate would come back empty.
  assert.equal(reviews[0].reviewDate, '2026-01-01');
});

test('parseBookingCSV: multi-line quoted reviews stay on one row', () => {
  const csv = HEADER + '\n' + row([
    '2026-01-01', 'A', '1', '', 'line one\nline two\nline three', '', '8', '8', '8', '8', '8', '8', '8', '',
  ]);
  const reviews = parseBookingCSV(csv);
  assert.equal(reviews.length, 1);
  assert.match(reviews[0].positiveReview, /line one[\s\S]*line three/);
});

test('parseBookingCSV: roomName falls back to "General" when no rental column', () => {
  const csv = HEADER + '\n' + row(['2026-01-01', 'A', '1', '', '', '', '8', '8', '8', '8', '8', '8', '8', '']);
  const reviews = parseBookingCSV(csv);
  assert.equal(reviews[0].roomName, 'General');
});

// ----------------------------------------------------------------------
// calculateAverages — counts and skipping
// ----------------------------------------------------------------------

test('calculateAverages: returns null on empty input', () => {
  assert.equal(calculateAverages([]), null);
});

test('calculateAverages: missing score (0) excluded from average AND counted separately', () => {
  const reviews = [
    { reviewDate: '', reservationNumber: '', reviewTitle: '', roomName: '', positiveReview: '', negativeReview: '',
      reviewScore: 8, staff: 8, cleanliness: 8, location: 9, facilities: 8, comfort: 8, valueForMoney: 8, propertyReply: '' },
    { reviewDate: '', reservationNumber: '', reviewTitle: '', roomName: '', positiveReview: '', negativeReview: '',
      reviewScore: 6, staff: 0, cleanliness: 6, location: 7, facilities: 6, comfort: 6, valueForMoney: 6, propertyReply: '' },
  ];
  const avg = calculateAverages(reviews);
  assert.ok(avg);
  // Overall: (8+6)/2 = 7.0 (both have non-zero scores)
  assert.equal(avg!.overall, 7);
  assert.equal(avg!.counts.overall, 2);
  // Staff: only the first counted, so avg = 8 and count = 1
  assert.equal(avg!.staff, 8);
  assert.equal(avg!.counts.staff, 1);
  // Total rows is always 2 regardless of missing scores
  assert.equal(avg!.counts.total, 2);
});

test('calculateAverages: all-missing metric returns 0/0 not NaN', () => {
  const reviews = [{
    reviewDate: '', reservationNumber: '', reviewTitle: '', roomName: '', positiveReview: '', negativeReview: '',
    reviewScore: 8, staff: 0, cleanliness: 0, location: 0, facilities: 0, comfort: 0, valueForMoney: 0, propertyReply: ''
  }];
  const avg = calculateAverages(reviews);
  assert.equal(avg!.staff, 0);
  assert.equal(avg!.counts.staff, 0);
  assert.ok(!Number.isNaN(avg!.staff));
});

test('calculateAverages: 1-decimal rounding is consistent', () => {
  const r = (s: number) => ({
    reviewDate: '', reservationNumber: '', reviewTitle: '', roomName: '', positiveReview: '', negativeReview: '',
    reviewScore: s, staff: s, cleanliness: s, location: s, facilities: s, comfort: s, valueForMoney: s, propertyReply: '',
  });
  // Average of [7.3, 8.7] = 8.0; ensure no float weirdness
  const avg = calculateAverages([r(7.3), r(8.7)]);
  assert.equal(avg!.overall, 8);
});

// ----------------------------------------------------------------------
// isValidFeedback — placeholder rejection + Unicode support
// ----------------------------------------------------------------------

test('isValidFeedback: rejects empty / null / single-char', () => {
  assert.equal(isValidFeedback(''), false);
  assert.equal(isValidFeedback(undefined), false);
  assert.equal(isValidFeedback(null), false);
  assert.equal(isValidFeedback(' '), false);
  assert.equal(isValidFeedback('a'), false);
});

test('isValidFeedback: rejects common placeholders', () => {
  for (const p of ['-', '--', 'n/a', 'na', 'NA', 'N/A', 'none', 'nothing', 'no comments', '...', '?', 'null']) {
    assert.equal(isValidFeedback(p), false, `expected "${p}" to be invalid`);
  }
});

test('isValidFeedback: rejects pure numbers / pure punctuation', () => {
  assert.equal(isValidFeedback('1234'), false);
  assert.equal(isValidFeedback('???'), false);
  assert.equal(isValidFeedback('!!!'), false);
});

test('isValidFeedback: accepts real English feedback', () => {
  assert.equal(isValidFeedback('great location, friendly staff'), true);
  assert.equal(isValidFeedback('ok'), true);
});

test('isValidFeedback: accepts non-Latin scripts (Vietnamese, Chinese, Japanese, Korean, Arabic)', () => {
  // Each of these should pass — \p{L} matches letters in any script.
  assert.equal(isValidFeedback('gần khu vực trung tâm khá tiện'), true, 'Vietnamese');
  assert.equal(isValidFeedback('位置很好'), true, 'Chinese');
  assert.equal(isValidFeedback('スタッフが親切でした'), true, 'Japanese');
  assert.equal(isValidFeedback('직원이 친절했어요'), true, 'Korean');
  assert.equal(isValidFeedback('الموقع ممتاز'), true, 'Arabic');
});
