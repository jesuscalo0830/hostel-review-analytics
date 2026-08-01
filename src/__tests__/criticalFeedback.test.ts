import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasWrittenFeedback, criticalFeedbackText } from '../utils/validation';

const r = (o: Partial<{ positiveReview: string; negativeReview: string; translatedNegative: string; translatedPositive: string }>) =>
  ({ positiveReview: '', negativeReview: '', ...o });

test('hasWrittenFeedback: excludes reviews with no text at all', () => {
  assert.equal(hasWrittenFeedback(r({})), false);
});

test('hasWrittenFeedback: excludes placeholder-only text', () => {
  assert.equal(hasWrittenFeedback(r({ negativeReview: '-' })), false);
  assert.equal(hasWrittenFeedback(r({ negativeReview: 'n/a' })), false);
  assert.equal(hasWrittenFeedback(r({ positiveReview: '...' })), false);
  assert.equal(hasWrittenFeedback(r({ negativeReview: '   ' })), false);
});

test('hasWrittenFeedback: accepts text in the negative field', () => {
  assert.equal(hasWrittenFeedback(r({ negativeReview: 'Toilets were filthy' })), true);
});

test('hasWrittenFeedback: accepts text in the positive field only', () => {
  // Single-text-column formats (Agoda, Guest Reviews) and guests who type
  // their complaint into the "liked" box.
  assert.equal(hasWrittenFeedback(r({ positiveReview: 'The mattress is broken' })), true);
});

test('hasWrittenFeedback: non-Latin scripts count as feedback', () => {
  assert.equal(hasWrittenFeedback(r({ negativeReview: '床墊壞了' })), true);
});

test('criticalFeedbackText: prefers the negative field', () => {
  assert.equal(
    criticalFeedbackText(r({ positiveReview: 'Good location', negativeReview: 'Very noisy' })),
    'Very noisy'
  );
});

test('criticalFeedbackText: falls back to the positive field', () => {
  assert.equal(criticalFeedbackText(r({ positiveReview: 'Mattress broken' })), 'Mattress broken');
});

test('criticalFeedbackText: prefers translations when present', () => {
  assert.equal(
    criticalFeedbackText(r({ negativeReview: 'Sehr laut', translatedNegative: 'Very loud' })),
    'Very loud'
  );
});

test('criticalFeedbackText: skips a placeholder negative field', () => {
  assert.equal(criticalFeedbackText(r({ negativeReview: '-', positiveReview: 'Dirty shower' })), 'Dirty shower');
});

test('criticalFeedbackText: returns empty string when there is nothing', () => {
  assert.equal(criticalFeedbackText(r({})), '');
});
